/**
 * 파일명: agent.ts
 * 설명: 대화와 도구 호출을 구분하고 실제 관찰 결과로 작업을 이어가는 에이전트 반복
 * 작성자: 이희원
 * 작성일자: 2026-11-17
 */
import { requestProposal } from '@/features/ai-assistant/model/transport.ts'
import {
  parseAgentQuestion,
  validateAgentAnswer,
  type AgentQuestion,
  type AgentAnswer,
} from '@/features/ai-assistant/model/questions.ts'
import type {
  AssistantHistory,
  AssistantToolCall,
  AssistantTurn,
} from '@/features/ai-assistant/model/proposal.ts'

/** 완결된 이전 대화와 도구 실행 묶음을 기준으로 전송 이력 크기 제한 */
export const compactAgentHistory = (history: AssistantHistory[]) => {
  let start = 0
  while (
    (JSON.stringify(history.slice(start)).length > 120000 || history.length - start > 80) &&
    start < history.length - 1
  ) {
    const next = history.findIndex((message, index) => index > start && message.role === 'user')
    if (next < 0) break
    start = next
  }
  const messages = history.slice(start).map((message) => ({ ...message }))
  /** 긴 단일 작업의 결과를 제한하되 실패 결과를 성공으로 표시하는 오류 방지 */
  for (const message of messages) {
    if (message.role !== 'tool' || message.content.length <= 4000) continue
    let status: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(message.content)
      if (parsed && typeof parsed === 'object')
        status = Object.fromEntries(
          ['ok', 'category', 'cancelled', 'deferred', 'userInputCanFix']
            .filter((key) => parsed[key] !== undefined)
            .map((key) => [key, parsed[key]]),
        )
    } catch {
      // 일반 문자열 결과는 원문 미리보기로 전달
    }
    message.content = JSON.stringify({
      ...status,
      truncated: true,
      preview: message.content.slice(0, 3000),
      note: '일부 결과 생략됨. 완료한 변경은 반복하지 말고 필요한 대상만 조회하세요.',
    })
  }
  while (JSON.stringify(messages).length > 120000 || messages.length > 80) {
    const calls = messages
      .map((message, index) => (message.tool_calls?.length ? index : -1))
      .filter((index) => index >= 0)
    if (calls.length < 2) break
    const first = calls[0]!
    const next = calls[1]!
    const previous =
      messages[first - 1]?.role === 'assistant' && !messages[first - 1]?.tool_calls
        ? first - 1
        : first
    const summary = messages
      .slice(first, next)
      .filter((message) => message.role === 'tool')
      .map((message) => ({ tool: message.tool_name, result: message.content.slice(0, 300) }))
    messages.splice(previous, next - previous, {
      role: 'assistant',
      content: JSON.stringify({
        note: '이전 도구 실행 기록 일부 생략됨. 완료 작업을 반복하지 말고 현재 상태를 조회해 확인 필요',
        records: summary,
      }),
    })
  }
  return messages
}

/**
 * 필요한 도구만 실행하고 완료 또는 질문 응답까지 이어가는 대화 실행
 * @param options 현재 문맥과 도구 실행 및 상태 콜백
 * @returns 실제 실행 이력과 최종 응답
 */
export const runAgent = async (options: {
  question: string
  model?: string
  history: AssistantHistory[]
  signal: AbortSignal
  context: () => unknown
  execute: (call: AssistantToolCall) => Promise<unknown>
  ask: (question: AgentQuestion, signal: AbortSignal) => Promise<AgentAnswer>
  progress: (message: string) => void
  step: (
    name: string,
    state: 'running' | 'waiting' | 'done' | 'error' | 'cancelled',
    message?: string,
  ) => void
  remember: (history: AssistantHistory[]) => void
}) => {
  const messages: AssistantHistory[] = [
    ...compactAgentHistory(options.history),
    { role: 'user', content: options.question },
  ]
  /** 입력창 활성화를 실제 편집 완료로 표시하지 않도록 대기 작업 관리 */
  const pendingInputs = new Map<string, string>()
  let calls = 0
  let completed = 0
  let pending: AssistantToolCall[] = []
  options.remember(compactAgentHistory(messages))
  try {
    for (let round = 0; round < 24; round++) {
      options.signal.throwIfAborted()
      const response = (await requestProposal(
        options.question,
        JSON.stringify(options.context()),
        compactAgentHistory(messages),
        options.signal,
        options.model,
      )) as AssistantTurn
      options.signal.throwIfAborted()
      if (
        !response ||
        typeof response.content !== 'string' ||
        (response.tool_calls !== undefined &&
          (!Array.isArray(response.tool_calls) || response.tool_calls.length > 8))
      )
        throw new Error('도우미 응답 형식을 확인할 수 없습니다.')
      messages.push({
        role: 'assistant',
        content: response.content,
        ...(response.tool_calls?.length ? { tool_calls: response.tool_calls } : {}),
      })
      if (!response.tool_calls?.length) {
        if (pendingInputs.size)
          return `요청 전체는 아직 완료되지 않았습니다. 다음 기능은 추가 입력이나 화면 조작이 필요합니다: ${[...pendingInputs.values()].join(', ')}. 완료한 변경은 작업 내역에 유지됩니다.`
        return response.content
      }
      pending = [...response.tool_calls]
      if (response.content) options.progress(response.content)
      for (const call of response.tool_calls) {
        if (
          !call?.function ||
          typeof call.function.name !== 'string' ||
          !call.function.arguments ||
          typeof call.function.arguments !== 'object' ||
          Array.isArray(call.function.arguments)
        )
          throw new Error('도구 요청 인수를 확인할 수 없습니다.')
        const name = call.function.name
        options.step(name, 'running')
        let observation: Record<string, unknown>
        try {
          const result =
            name === 'ask_user'
              ? await (async () => {
                  const question = parseAgentQuestion(call.function.arguments)
                  const answer = validateAgentAnswer(
                    question,
                    await options.ask(question, options.signal),
                  )
                  return {
                    question: question.question,
                    fields: question.fields.map(({ id, label }) => ({ id, label })),
                    answer,
                    note: '사용자 응답입니다. 현재 문맥을 다시 확인하고 이 답변을 반영해 작업을 계속하세요.',
                  }
                })()
              : await options.execute(call)
          options.signal.throwIfAborted()
          observation = { ok: true, result }
          const outcome =
            result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined
          if (name === 'execute_app_command' && Array.isArray(outcome?.resolvedCommands))
            for (const id of outcome.resolvedCommands)
              if (typeof id === 'string') pendingInputs.delete(id)
          if (name === 'place_equipment') {
            pendingInputs.delete('scene.catalog')
            pendingInputs.delete('scene.model-select')
          }
          if (
            name === 'edit_equipment' &&
            ['create', 'update'].includes(String(call.function.arguments.operation))
          )
            pendingInputs.delete('scene.designer')
          if (name === 'execute_app_command' && outcome?.status === 'cancelled') {
            options.step(name, 'cancelled', '사용자 파일 작업 취소')
          } else if (name === 'execute_app_command' && outcome?.status === 'awaiting_user') {
            pendingInputs.set(String(outcome.id), String(outcome.label))
            options.step(name, 'waiting', '추가 입력 또는 화면 조작 필요')
          } else {
            if (name === 'execute_app_command' && outcome?.id)
              pendingInputs.delete(String(outcome.id))
            completed++
            options.step(name, 'done')
          }
        } catch (cause) {
          options.signal.throwIfAborted()
          const error = cause instanceof Error ? cause.message : String(cause)
          const internal = cause instanceof TypeError || cause instanceof ReferenceError
          observation = {
            ok: false,
            error,
            ...(cause instanceof Error && 'command' in cause ? { command: cause.command } : {}),
            category: internal ? 'internal_error' : 'tool_error',
            ...(internal
              ? {
                  userInputCanFix: false,
                  note: '앱 내부 실행 오류입니다. 사용자 입력 부족으로 설명하거나 입력 질문으로 우회하지 마세요.',
                }
              : {}),
          }
          options.step(name, 'error', error)
        }
        const serialized = JSON.stringify(observation)
        messages.push({
          role: 'tool',
          tool_name: name,
          content:
            serialized.length > 16000
              ? JSON.stringify({
                  ok: observation.ok,
                  ...(observation.ok === false
                    ? {
                        error: String(observation.error ?? '').slice(0, 1000),
                        category: observation.category,
                        userInputCanFix: observation.userInputCanFix,
                      }
                    : {}),
                  truncated: true,
                  preview: serialized.slice(0, 14000),
                  note: 'Use paginated get_map_context for full data.',
                })
              : serialized,
        })
        calls++
        pending.shift()
        if (
          name === 'execute_app_command' &&
          observation.ok &&
          (observation.result as Record<string, unknown>)?.status === 'cancelled'
        )
          return '파일 작업이 취소되어 요청을 중단했습니다. 이전에 완료한 변경은 유지됩니다.'
        if (name === 'ask_user') {
          for (const deferred of pending)
            messages.push({
              role: 'tool',
              tool_name: deferred.function.name,
              content: JSON.stringify({
                ok: false,
                deferred: true,
                note: '사용자 답변 후에는 최신 문맥으로 다시 계획해야 합니다. 이 작업은 아직 실행하지 않았습니다.',
              }),
            })
          pending = []
          break
        }
      }
      options.remember(compactAgentHistory(messages))
      if (calls >= 32)
        return '진행한 작업은 작업 내역에 남겼습니다. 아직 전체 요청이 끝나지 않았습니다. 이어서 진행할 수 있습니다.'
    }
    return '진행한 작업은 반영했으며 아직 확인할 내용이 남아 있습니다. 이어서 진행할 수 있습니다.'
  } catch (cause) {
    /** 최종 설명 생성 실패와 이미 완료한 작업을 구분하여 중복 실행 오인 방지 */
    if (
      !options.signal.aborted &&
      completed &&
      cause instanceof Error &&
      cause.message.startsWith('AI 응답이 출력 한도')
    )
      throw new Error(
        `완료한 작업 ${completed}건은 유지했습니다. 최종 답변이 출력 한도에 도달하여 설명을 마치지 못했습니다. 작업 내역을 확인하고 이어서 요청할 수 있습니다.`,
      )
    throw cause
  } finally {
    for (const call of pending)
      messages.push({
        role: 'tool',
        tool_name: call.function.name,
        content: JSON.stringify({
          ok: false,
          cancelled: true,
          note: '작업이 중단되어 현재 지도 상태를 다시 확인해야 합니다.',
        }),
      })
    options.remember(compactAgentHistory(messages))
  }
}
