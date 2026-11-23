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

/** 완결된 이전 사용자 대화부터 줄이며 도구 호출과 결과를 함께 유지하는 문맥 제한 */
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
  return history.slice(start)
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
  step: (name: string, state: 'running' | 'done' | 'error', message?: string) => void
  remember: (history: AssistantHistory[]) => void
}) => {
  const messages: AssistantHistory[] = [
    ...compactAgentHistory(options.history),
    { role: 'user', content: options.question },
  ]
  let calls = 0
  let pending: AssistantToolCall[] = []
  options.remember(compactAgentHistory(messages))
  try {
    for (let round = 0; round < 24; round++) {
      options.signal.throwIfAborted()
      const response = (await requestProposal(
        options.question,
        JSON.stringify(options.context()),
        messages,
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
      if (!response.tool_calls?.length) return response.content
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
        let observation: unknown
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
          options.step(name, 'done')
        } catch (cause) {
          options.signal.throwIfAborted()
          const error = cause instanceof Error ? cause.message : String(cause)
          const internal = cause instanceof TypeError || cause instanceof ReferenceError
          observation = {
            ok: false,
            error,
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
                  ok: true,
                  truncated: true,
                  preview: serialized.slice(0, 14000),
                  note: 'Use paginated get_map_context for full data.',
                })
              : serialized,
        })
        calls++
        pending.shift()
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
