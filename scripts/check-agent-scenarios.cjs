/**
 * 대화 문맥과 도구 연속 실행의 회귀 시나리오 및 실제 추론 응답 성능 검증
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { execFileSync } = require('node:child_process')
const args = process.argv.slice(2)
const baseline = args.includes('--baseline')
const serviceFile = path.resolve(__dirname, '../electron/ai-service.cjs')
const baselineModule = { exports: {} }
if (baseline)
  new Function(
    'require',
    'module',
    '__dirname',
    'fetch',
    execFileSync('git', ['show', 'HEAD:electron/ai-service.cjs'], {
      cwd: path.dirname(serviceFile),
      encoding: 'utf8',
    }),
  )(createRequire(serviceFile), baselineModule, path.dirname(serviceFile), (...input) =>
    global.fetch(...input),
  )
const service = baseline ? baselineModule.exports : require(serviceFile)
const { tools } = require('../electron/assistant-tools.cjs')
const rows = []
const model = args.find((value) => value.startsWith('--model='))?.slice(8) ?? 'gpt-oss:20b'
const prompt = '현재 맵을 검사하고 결과를 요약해줘.'
const call = (name = 'get_map_context', parameters = { entity: 'nodes' }) => ({
  function: { name, arguments: parameters },
})
const user = (content = prompt) => ({ role: 'user', content })
const assistant = (calls = [call()]) => ({ role: 'assistant', content: '', tool_calls: calls })
const observation = (content, name = 'get_map_context') => ({
  role: 'tool',
  tool_name: name,
  content,
})
const hugeResult = JSON.stringify({ ok: true, result: '검사대상노드연결경로상태정보'.repeat(1600) })
const largeHistory = [
  user(),
  assistant(Array.from({ length: 8 }, () => call())),
  ...Array.from({ length: 8 }, () => observation(hugeResult)),
]
const payload = (overrides = {}) => ({
  id: crypto.randomUUID(),
  prompt,
  context: '{}',
  history: [],
  model,
  ...overrides,
})
const answer = { done: true, message: { role: 'assistant', content: '확인했습니다.' } }

/** 성공 여부와 지연 시간을 함께 기록하고 나머지 시나리오를 이어서 검증 */
const scenario = async (name, run) => {
  const started = performance.now()
  try {
    const detail = await run()
    rows.push({ name, passed: true, ms: Math.round(performance.now() - started), ...detail })
  } catch (error) {
    rows.push({
      name,
      passed: false,
      ms: Math.round(performance.now() - started),
      error: error.message,
    })
  }
  console.log(JSON.stringify(rows.at(-1)))
}

/** 지정한 응답과 문맥 유실 조건으로 실제 서비스 전송 경계를 검증 */
const mocked = async (name, verify, config = {}) =>
  scenario(name, async () => {
    const original = global.fetch
    const requests = []
    global.fetch = async (url, options) => {
      if (String(url).endsWith('/api/show'))
        return Response.json({
          capabilities: config.capabilities ?? ['completion', 'tools', 'thinking'],
          model_info: { 'general.architecture': 'gptoss' },
        })
      const request = JSON.parse(options.body)
      requests.push(request)
      if (config.chat) return config.chat(request, requests.length, options.signal)
      const toolCharacters = request.messages
        .filter((message) => message.role === 'tool')
        .reduce((sum, message) => sum + message.content.length, 0)
      if (toolCharacters > 24000)
        return Response.json({ error: 'no user query found in messages' }, { status: 500 })
      return Response.json(answer)
    }
    try {
      await verify(requests)
      return { chatRequests: requests.length }
    } finally {
      global.fetch = original
    }
  })

/** 긴 대화와 오류 복구 및 취소 경계의 외부 서버 없는 회귀 검사 */
const regression = async () => {
  const command = {
    id: 'scene.test-edit',
    label: '검증 편집',
    description: '기존 화면 실행 함수 연결',
    available: true,
    parameters: {
      type: 'object',
      properties: { value: { type: 'number', minimum: 0 } },
      required: ['value'],
      additionalProperties: false,
    },
  }
  await mocked(
    '조회한 화면 입력 규격의 정식 도구 제공',
    async (requests) => {
      const result = await service.aiPropose(
        payload({ context: JSON.stringify({ capabilities: { modeSwitch: command } }) }),
      )
      const exposed = requests[0].tools.find((item) => item.function.name === 'app_scene_test_edit')
      assert.deepEqual(exposed.function.parameters.required, ['value'])
      assert.equal(exposed.function.parameters.properties.value.minimum, 0)
      assert.deepEqual(result.tool_calls[0].function, {
        name: 'execute_app_command',
        arguments: { id: command.id, arguments: { value: 12 } },
      })
    },
    {
      chat: () =>
        Response.json({
          done: true,
          message: { content: '', tool_calls: [call('app_scene_test_edit', { value: 12 })] },
        }),
    },
  )
  await mocked('도구 오류의 화면 계약을 다음 추론에 제공', async (requests) => {
    await service.aiPropose(
      payload({
        history: [
          user(),
          assistant([call('execute_app_command', { id: command.id })]),
          observation(
            JSON.stringify({ ok: false, error: '입력 필요', command }),
            'execute_app_command',
          ),
        ],
      }),
    )
    assert(requests[0].tools.some((item) => item.function.name === 'app_scene_test_edit'))
  })
  await mocked('허용하지 않은 화면 입력 규격의 도구 노출 차단', async (requests) => {
    await service.aiPropose(
      payload({
        context: JSON.stringify({
          capabilities: {
            modeSwitch: {
              ...command,
              parameters: {
                type: 'object',
                properties: { value: { type: 'object', additionalProperties: true } },
              },
            },
          },
        }),
      }),
    )
    assert(!requests[0].tools.some((item) => item.function.name === 'app_scene_test_edit'))
  })
  await mocked('기본 대화', async (requests) => {
    await service.aiPropose(payload())
    assert.equal(requests[0].messages.at(-1).content, prompt)
  })
  await mocked('같은 문구의 새 질문', async (requests) => {
    await service.aiPropose(
      payload({
        history: [user(), { role: 'assistant', content: '이전 응답' }, user('다른 질문')],
      }),
    )
    assert.equal(requests[0].messages.at(-1).content, prompt)
  })
  await mocked('완료된 질문을 다시 요청', async (requests) => {
    await service.aiPropose(
      payload({ history: [user(), { role: 'assistant', content: '이전 응답' }] }),
    )
    assert.equal(requests[0].messages.at(-1).role, 'user')
    assert.equal(requests[0].messages.filter((message) => message.role === 'user').length, 2)
  })
  await mocked('도구 실행 후 질문 중복 방지', async (requests) => {
    await service.aiPropose(payload({ history: [user(), assistant(), observation('{"ok":true}')] }))
    assert.equal(requests[0].messages.at(-1).role, 'tool')
    assert.equal(requests[0].messages.filter((message) => message.role === 'user').length, 1)
  })
  await mocked('대용량 병렬 도구 결과', async (requests) => {
    await service.aiPropose(payload({ history: largeHistory }))
    const messages = requests[0].messages
    assert(messages.some((message) => message.role === 'user' && message.content === prompt))
    assert.equal(messages.at(-1).role, 'tool')
    assert(JSON.stringify(messages).length < JSON.stringify(largeHistory).length / 2)
  })
  await mocked('대용량 단일 작업 연속 조회', async (requests) => {
    const history = [
      user(),
      ...Array.from({ length: 20 }, () => [
        assistant(),
        observation(hugeResult.slice(0, 9000)),
      ]).flat(),
    ]
    await service.aiPropose(payload({ history }))
    assert.equal(requests[0].messages.find((message) => message.role === 'user').content, prompt)
    assert.equal(requests[0].messages.at(-1).role, 'tool')
  })
  await mocked('오래된 대화 축약', async (requests) => {
    const history = [
      ...Array.from({ length: 20 }, (_, index) => [
        user('이전 질문 ' + index),
        { role: 'assistant', content: '이전 기록'.repeat(1500) },
      ]).flat(),
      user(),
    ]
    await service.aiPropose(payload({ history }))
    assert.equal(requests[0].messages.at(-1).content, prompt)
    assert(requests[0].messages.length < history.length)
  })
  await mocked('큰 지도 상태', async (requests) => {
    await service.aiPropose(
      payload({ context: JSON.stringify({ map: '노드경로포트'.repeat(13000) }) }),
    )
    assert(requests[0].messages[1].content.length < 10000)
    assert.equal(requests[0].messages.at(-1).content, prompt)
  })
  await mocked('최대 길이 한국어 질문 보존', async (requests) => {
    const question = '검사'.repeat(2000)
    await service.aiPropose(
      payload({ prompt: question, context: JSON.stringify({ map: '노드'.repeat(30000) }) }),
    )
    assert(
      requests[0].messages.some(
        (message) => message.role === 'user' && message.content === question,
      ),
    )
  })
  await mocked('실패 도구 결과 상태 보존', async (requests) => {
    const content = JSON.stringify({
      ok: false,
      category: 'internal_error',
      userInputCanFix: false,
      error: '실행 실패',
      result: '오류정보'.repeat(6000),
    })
    await service.aiPropose(payload({ history: [user(), assistant(), observation(content)] }))
    const result = JSON.parse(requests[0].messages.at(-1).content)
    assert.equal(result.ok, false)
    assert.equal(result.category, 'internal_error')
    assert.equal(result.userInputCanFix, false)
  })
  await mocked('확인 질문 응답 보존', async (requests) => {
    const content = JSON.stringify({ ok: true, result: { answer: { values: { port: 'P1' } } } })
    await service.aiPropose(
      payload({
        history: [
          user(),
          assistant([call('ask_user', { question: '포트 선택' })]),
          observation(content, 'ask_user'),
        ],
      }),
    )
    assert.equal(requests[0].messages.at(-1).content, content)
  })
  await mocked(
    '도구 미지원 모델 전환',
    async (requests) => {
      await service.aiPropose(
        payload({ history: [user(), assistant(), observation('{"ok":true}')] }),
      )
      assert.equal(requests[0].tools, undefined)
      assert(
        requests[0].messages.every((message) => message.role !== 'tool' && !message.tool_calls),
      )
    },
    { capabilities: ['completion'] },
  )
  await mocked(
    '사용자 문맥 유실 오류 단일 복구',
    async (requests) => {
      await service.aiPropose(
        payload({ history: [user(), assistant(), observation('{"ok":true}')] }),
      )
      assert.equal(requests.length, 2)
      assert.equal(requests[1].messages.at(-1).role, 'user')
      assert(JSON.stringify(requests[1].messages).includes('get_map_context'))
    },
    {
      chat: (_request, count) =>
        count === 1
          ? Response.json({ error: 'no user query found in messages' }, { status: 500 })
          : Response.json(answer),
    },
  )
  await mocked(
    '도구 구문 오류의 단일 추론 복구',
    async (requests) => {
      const result = await service.aiPropose(payload())
      assert.equal(requests.length, 2)
      assert.equal(result.tool_calls.length, 0)
      assert.equal(result.content, answer.message.content)
    },
    {
      chat: (_request, count) =>
        count === 1
          ? Response.json(
              { error: 'error parsing tool call: unexpected end of JSON input' },
              { status: 500 },
            )
          : Response.json(answer),
    },
  )
  await mocked(
    '복구 재실패 재시도 제한',
    async (requests) => {
      await assert.rejects(service.aiPropose(payload()), /no user query/)
      assert.equal(requests.length, 2)
    },
    { chat: () => Response.json({ error: 'no user query found in messages' }, { status: 500 }) },
  )
  await mocked(
    '일반 서버 오류 재시도 방지',
    async (requests) => {
      await assert.rejects(service.aiPropose(payload()), /runner resource limit/)
      assert.equal(requests.length, 1)
    },
    { chat: () => Response.json({ error: 'runner resource limit' }, { status: 500 }) },
  )
  await mocked(
    '허용되지 않은 응답 도구',
    async () => {
      await assert.rejects(service.aiPropose(payload()), /지원하지 않는 도구/)
    },
    {
      chat: () =>
        Response.json({
          done: true,
          message: { content: '', tool_calls: [call('execute_shell', {})] },
        }),
    },
  )
  await mocked(
    '빈 모델 응답',
    async () => {
      await assert.rejects(service.aiPropose(payload()), /응답 내용을 반환하지/)
    },
    { chat: () => Response.json({ done: true, message: { content: '' } }) },
  )
  await mocked(
    '출력 토큰 한도 초과',
    async (requests) => {
      await assert.rejects(service.aiPropose(payload()), /출력 한도/)
      assert.equal(requests.length, 2)
    },
    { chat: () => Response.json({ ...answer, done_reason: 'length' }) },
  )
  await mocked(
    '잘린 도구 호출의 실행 방지와 응답 복구',
    async (requests) => {
      const result = await service.aiPropose(payload())
      assert.equal(requests.length, 2)
      assert.equal(result.content, answer.message.content)
      assert.equal(result.tool_calls.length, 0)
      assert.equal(requests[0].options.num_predict, 4096)
      assert(requests[1].messages.at(-1).role === 'user')
    },
    {
      chat: (_request, count) =>
        count === 1
          ? Response.json({
              done: true,
              done_reason: 'length',
              message: {
                content: '작성 중',
                tool_calls: [call('move_nodes', { nodeIds: [1], dx: 100, dy: 0 })],
              },
            })
          : Response.json(answer),
    },
  )
  await mocked('빈 사용자 질문 차단', async (requests) => {
    await assert.rejects(service.aiPropose(payload({ prompt: ' ' })), /요청 데이터/)
    assert.equal(requests.length, 0)
  })
  await mocked('대화 이력 개수 제한', async (requests) => {
    await assert.rejects(
      service.aiPropose(payload({ history: Array.from({ length: 101 }, () => user()) })),
      /대화 데이터/,
    )
    assert.equal(requests.length, 0)
  })
  await mocked('미지원 입력 도구 차단', async () => {
    await assert.rejects(
      service.aiPropose(payload({ history: [observation('입력', 'execute_shell')] })),
      /대화 데이터/,
    )
  })
  await mocked(
    '추론 취소 및 요청 슬롯 반환',
    async (requests) => {
      const request = payload()
      const first = service.aiPropose(request)
      await new Promise((resolve) => setTimeout(resolve, 5))
      service.cancelAi(request.id)
      await assert.rejects(first, /취소/)
      await service.aiPropose(request)
      assert.equal(requests.length, 2)
    },
    {
      chat: (_request, count, signal) =>
        count > 1
          ? Response.json(answer)
          : new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            }),
    },
  )
  await mocked(
    '동일 조회 중복 실행 방지',
    async () => {
      const result = await service.aiPropose(payload())
      assert.equal(result.tool_calls.length, 4)
      assert.equal(
        result.tool_calls.filter((tool) => tool.function.name === 'move_nodes').length,
        2,
      )
    },
    {
      chat: () =>
        Response.json({
          done: true,
          message: {
            content: '',
            tool_calls: [
              call(),
              call(),
              call('get_map_context', { entity: 'ports' }),
              call('move_nodes', { nodeIds: [1], dx: 100, dy: 0 }),
              call('move_nodes', { nodeIds: [1], dx: 100, dy: 0 }),
            ],
          },
        }),
    },
  )
  await mocked(
    '편집 이후 동일 조회 재실행 유지',
    async () => {
      const result = await service.aiPropose(payload())
      assert.equal(result.tool_calls.length, 3)
    },
    {
      chat: () =>
        Response.json({
          done: true,
          message: {
            content: '',
            tool_calls: [call(), call('move_nodes', { nodeIds: [1], dx: 100, dy: 0 }), call()],
          },
        }),
    },
  )
}

/** 실제 대화 루프에서 대용량 이력과 실패 관찰 결과의 전송 검증 */
const agentRegression = async () => {
  const { compactAgentHistory, runAgent } = require('./load-source.cjs').loadSource(
    'src/features/ai-assistant/model/agent.ts',
  )
  await scenario('단일 작업 이력의 통신 크기 제한', async () => {
    const history = [
      user(),
      ...Array.from({ length: 30 }, () => [
        assistant(Array.from({ length: 8 }, () => call())),
        ...Array.from({ length: 8 }, () => observation(hugeResult)),
      ]).flat(),
    ]
    const compacted = compactAgentHistory(history)
    assert(JSON.stringify(compacted).length <= 120000)
    assert(compacted.length <= 80)
    assert.equal(compacted.find((message) => message.role === 'user').content, prompt)
    assert.equal(compacted.at(-1).role, 'tool')
    assert.equal(history.at(-1).content, hugeResult)
    let pending = []
    for (const message of compacted) {
      if (message.role === 'tool') assert.equal(message.tool_name, pending.shift())
      else {
        assert.equal(pending.length, 0)
        pending = message.tool_calls?.map((tool) => tool.function.name) ?? []
      }
    }
    assert.equal(pending.length, 0)
  })
  await scenario('실행 루프의 큰 내부 오류 상태 보존', async () => {
    const originalWindow = global.window
    const sent = []
    let executed = 0
    global.window = {
      desktop: {
        aiPropose: async (request) => {
          sent.push(request)
          return sent.length === 1
            ? { role: 'assistant', content: '', tool_calls: [call('inspect_map', {})] }
            : { role: 'assistant', content: '실행 오류를 확인했습니다.' }
        },
      },
    }
    try {
      await runAgent({
        question: prompt,
        history: [],
        signal: new AbortController().signal,
        context: () => ({}),
        execute: async () => {
          executed++
          throw new TypeError('내부 오류 정보'.repeat(4000))
        },
        ask: async () => {
          throw new Error('확인 질문 우회 금지')
        },
        progress: () => {},
        step: () => {},
        remember: () => {},
      })
      assert.equal(executed, 1)
      const failure = JSON.parse(sent[1].history.at(-1).content)
      assert.equal(failure.ok, false)
      assert.equal(failure.category, 'internal_error')
      assert.equal(failure.userInputCanFix, false)
      assert(JSON.stringify(sent[1].history).length < 120000)
    } finally {
      global.window = originalWindow
    }
  })
}

/** 최종 설명 실패 시 작업 보존 안내와 데스크톱 오류 문구 정리 검증 */
const completionRegression = async () => {
  const { loadSource } = require('./load-source.cjs')
  const { runAgent } = loadSource('src/features/ai-assistant/model/agent.ts')
  const { requestProposal } = loadSource('src/features/ai-assistant/model/transport.ts')
  await scenario('완료한 작업과 마지막 답변 실패 구분', async () => {
    const original = global.window
    let requests = 0
    let executed = 0
    let remembered
    global.window = {
      desktop: {
        aiPropose: async () => {
          if (++requests === 1)
            return { role: 'assistant', content: '', tool_calls: [call('inspect_map', {})] }
          throw new Error('AI 응답이 출력 한도에 도달했습니다.')
        },
      },
    }
    try {
      await assert.rejects(
        runAgent({
          question: prompt,
          history: [],
          signal: new AbortController().signal,
          context: () => ({}),
          execute: async () => {
            executed++
            return { inspected: true }
          },
          ask: async () => {
            throw Error('불필요한 질문')
          },
          progress: () => {},
          step: () => {},
          remember: (history) => {
            remembered = history
          },
        }),
        /완료한 작업 1건은 유지/,
      )
      assert.equal(executed, 1)
      assert.equal(JSON.parse(remembered.at(-1).content).ok, true)
    } finally {
      global.window = original
    }
  })
  await scenario('입력창 열기를 편집 완료로 보고하는 응답 차단', async () => {
    const original = global.window
    let requests = 0
    const steps = []
    global.window = {
      desktop: {
        aiPropose: async () =>
          ++requests === 1
            ? assistant([call('execute_app_command', { id: 'scene.designer' })])
            : { role: 'assistant', content: '새 모델 생성을 완료했습니다.' },
      },
    }
    try {
      const reply = await runAgent({
        question: '새 모델을 만들어줘',
        history: [],
        signal: new AbortController().signal,
        context: () => ({}),
        execute: async () => ({
          id: 'scene.designer',
          label: '새 모델 디자인',
          status: 'awaiting_user',
        }),
        ask: async () => {
          throw Error('불필요한 질문')
        },
        progress: () => {},
        step: (_name, state) => steps.push(state),
        remember: () => {},
      })
      assert.deepEqual(steps, ['running', 'waiting'])
      assert.match(reply, /아직 완료되지 않았/)
      assert(!reply.includes('생성을 완료했습니다'))
    } finally {
      global.window = original
    }
  })
  await scenario('대기 입력을 실제 배치로 마친 뒤 완료 답변 유지', async () => {
    const original = global.window
    let requests = 0
    global.window = {
      desktop: {
        aiPropose: async () =>
          ++requests === 1
            ? assistant([
                call('execute_app_command', { id: 'scene.catalog' }),
                call('execute_app_command', { id: 'scene.place-center' }),
              ])
            : { role: 'assistant', content: '객체를 배치했습니다.' },
      },
    }
    try {
      const reply = await runAgent({
        question: prompt,
        history: [],
        signal: new AbortController().signal,
        context: () => ({}),
        execute: async (request) =>
          request.function.arguments.id === 'scene.catalog'
            ? { id: 'scene.catalog', label: '카탈로그', status: 'awaiting_user' }
            : {
                id: 'scene.place-center',
                status: 'completed',
                resolvedCommands: ['scene.catalog'],
              },
        ask: async () => {
          throw Error('불필요한 질문')
        },
        progress: () => {},
        step: () => {},
        remember: () => {},
      })
      assert.equal(reply, '객체를 배치했습니다.')
    } finally {
      global.window = original
    }
  })
  await scenario('파일 작업 취소 이후 남은 편집 실행 방지', async () => {
    const original = global.window
    let executed = 0
    global.window = {
      desktop: {
        aiPropose: async () =>
          assistant([
            call('execute_app_command', { id: 'scene.project-open' }),
            call('edit_equipment', {}),
          ]),
      },
    }
    try {
      const reply = await runAgent({
        question: prompt,
        history: [],
        signal: new AbortController().signal,
        context: () => ({}),
        execute: async () => {
          executed++
          return { status: 'cancelled' }
        },
        ask: async () => {
          throw Error('불필요한 질문')
        },
        progress: () => {},
        step: () => {},
        remember: () => {},
      })
      assert.equal(executed, 1)
      assert.match(reply, /취소되어 요청을 중단/)
    } finally {
      global.window = original
    }
  })
  await scenario('Electron 호출 오류 접두어 제거', async () => {
    const original = global.window
    global.window = {
      desktop: {
        aiPropose: async () => {
          throw Error("Error invoking remote method 'ai:propose': Error: 실제 오류 내용")
        },
      },
    }
    try {
      await assert.rejects(
        requestProposal(prompt, '{}', [], new AbortController().signal),
        (error) => error.message === '실제 오류 내용',
      )
    } finally {
      global.window = original
    }
  })
}

/** 저장과 편집을 실행하지 않는 실제 모델의 응답 및 도구 선택 검사 */
const live = async () => {
  const context = JSON.stringify({
    map: { units: 'mm', nodes: 3, edges: 2, ports: 1, readOnly: false },
    selection: { nodeIds: [1, 2], nodeCount: 2, instance: null, portId: 'P1', assetId: 'rack-a' },
    equipment: { models: 1, instances: 1 },
    attachment: null,
    drawing: null,
  })
  const cases = [
    { name: '일반 인사', prompt: '안녕하세요. 한 문장으로 인사해줘.', allowed: [] },
    {
      name: '지도 문제 검사',
      prompt: '현재 지도에 문제가 있는지 검사해줘.',
      allowed: ['inspect_map', 'get_map_context', 'audit_port_references'],
    },
    {
      name: '선택 노드 상대 이동',
      prompt: '선택한 노드들을 오른쪽으로 100mm 이동해줘.',
      allowed: ['edit_selection', 'move_nodes'],
      verify: (result) =>
        assert(
          result.tool_calls.some(
            ({ function: tool }) =>
              tool.arguments.dx === 100 &&
              (tool.name === 'move_nodes' || tool.arguments.operation === 'move'),
          ),
        ),
    },
    {
      name: '조회 요청의 편집 방지',
      prompt: '선택한 노드의 현재 좌표만 조회해줘. 수정하지 마.',
      allowed: ['get_map_context', 'edit_selection'],
      verify: (result) => {
        assert(
          result.tool_calls.every(
            ({ function: tool }) =>
              tool.name !== 'edit_selection' || tool.arguments.operation === 'inspect',
          ),
        )
      },
    },
    {
      name: '모델을 지정 포트에 배치',
      prompt: '기존 모델 rack-a를 포트 P1에 배치해줘.',
      allowed: ['get_map_context', 'place_equipment'],
      verify: (result) => {
        for (const { function: tool } of result.tool_calls.filter(
          (tool) => tool.function.name === 'place_equipment',
        )) {
          assert.equal(tool.arguments.assetId, 'rack-a')
          assert.deepEqual(tool.arguments.portIds, ['P1'])
        }
      },
    },
    {
      name: '지도 실행 취소',
      prompt: '직전 2D 지도 편집을 한 번 실행 취소해줘.',
      allowed: ['history'],
      verify: (result) => {
        assert.equal(result.tool_calls.length, 1)
        assert.equal(result.tool_calls[0].function.arguments.direction, 'undo')
        assert(['map', undefined].includes(result.tool_calls[0].function.arguments.target))
      },
    },
    {
      name: '대상 없는 이동 요청',
      prompt: '이동해줘.',
      context: JSON.stringify({
        map: { units: 'mm', readOnly: false },
        selection: { nodeIds: [], nodeCount: 0, instance: null },
      }),
      allowed: ['ask_user', 'get_map_context'],
    },
    {
      name: '사용자 확인 후 이어가기',
      prompt,
      history: [
        user(),
        assistant([call('ask_user', { question: '검사 대상을 선택하세요' })]),
        observation(
          JSON.stringify({ ok: true, result: { answer: { values: { target: '전체 지도' } } } }),
          'ask_user',
        ),
      ],
      allowed: ['inspect_map', 'get_map_context', 'audit_port_references'],
    },
    {
      name: '도구 오류 후 복구 판단',
      prompt,
      history: [
        user(),
        assistant([call('inspect_map', {})]),
        observation(
          '{"ok":false,"category":"internal_error","userInputCanFix":false,"error":"검사 모듈 내부 오류"}',
          'inspect_map',
        ),
      ],
      allowed: ['get_map_context', 'inspect_map', 'audit_port_references'],
      allowText: true,
    },
    {
      name: '대용량 도구 결과 연속 처리',
      prompt,
      history: largeHistory,
      allowed: ['get_map_context', 'inspect_map', 'audit_port_references'],
      allowText: true,
    },
  ]
  for (const item of cases)
    await scenario(item.name, async () => {
      const original = global.fetch
      let requests = 0
      let tokens = 0
      let generated = 0
      global.fetch = async (...input) => {
        const response = await original(...input)
        if (String(input[0]).endsWith('/api/chat')) {
          requests++
          const data = await response.clone().json()
          tokens += data.prompt_eval_count ?? 0
          generated += data.eval_count ?? 0
        }
        return response
      }
      try {
        const result = await service.aiPropose(
          payload({
            prompt: item.prompt,
            context: item.context ?? context,
            history: item.history ?? [],
          }),
        )
        const names = result.tool_calls.map((tool) => tool.function.name)
        assert(
          names.every((name) => item.allowed.includes(name)),
          '요청과 무관한 도구 선택 ' + names.join(','),
        )
        if (item.allowed.length && !item.allowText) assert(names.length, '필요한 도구 호출 누락')
        if (item.allowed.length === 0) assert(result.content.trim())
        for (const tool of result.tool_calls) {
          const schema = tools.find((candidate) => candidate.function.name === tool.function.name)
            .function.parameters
          for (const key of schema.required)
            assert(key in tool.function.arguments, '필수 인수 누락 ' + key)
        }
        item.verify?.(result)
        return {
          model,
          chatRequests: requests,
          promptTokens: tokens,
          generatedTokens: generated,
          selectedTools: names,
          responseCharacters: result.content.length,
        }
      } finally {
        global.fetch = original
      }
    })
}

/** 격리된 실제 Electron 메인과 프리로드를 통한 대용량 추론 요청 검증 */
const desktop = async () =>
  scenario('실제 ai:propose IPC 대용량 요청', async () => {
    const { _electron } = require(
      process.env.MGS_PLAYWRIGHT ??
        'C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    )
    const temporary = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'ts-mgs-agent-live-'))
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.TS_MGS_DEV_URL
    let app
    try {
      app = await _electron.launch({
        executablePath: require('electron'),
        args: ['--user-data-dir=' + temporary, path.resolve(__dirname, '..')],
        env,
        timeout: 60000,
      })
      const page = await app.firstWindow()
      await page.waitForFunction(() => !!window.desktop?.aiPropose)
      const result = await page.evaluate(
        (request) => window.desktop.aiPropose(request),
        payload({ history: largeHistory }),
      )
      assert(result.content.trim() || result.tool_calls.length)
      const capability = await page.evaluate(
        (request) => window.desktop.aiPropose(request),
        payload({ prompt: '3D 모델 이름을 변경할 수 있는지 가능한지 불가능한지만 알려줘.' }),
      )
      assert.equal(capability.tool_calls.length, 0)
      assert.match(capability.content, /가능|변경할 수 있/)
      return {
        model,
        selectedTools: result.tool_calls.map((tool) => tool.function.name),
        responseCharacters: result.content.length,
        capabilityReply: capability.content,
      }
    } finally {
      if (app) await app.close()
      const tempRoot = path.resolve(require('node:os').tmpdir()) + path.sep
      assert(path.resolve(temporary).startsWith(tempRoot))
      await fs.rm(temporary, { recursive: true, force: true })
    }
  })

/** 시나리오 결과와 실제 지연 시간 분포를 파일 또는 표준 출력으로 반환 */
const main = async () => {
  if (args.includes('--desktop')) await desktop()
  else if (args.includes('--live')) await live()
  else {
    await regression()
    if (!baseline) {
      await agentRegression()
      await completionRegression()
    }
  }
  const timings = rows.map((row) => row.ms).sort((a, b) => a - b)
  const report = {
    mode: args.includes('--desktop')
      ? 'live-ipc'
      : args.includes('--live')
        ? 'live-proposal'
        : 'mock-regression',
    baseline,
    model: args.includes('--live') ? model : undefined,
    total: rows.length,
    passed: rows.filter((row) => row.passed).length,
    failed: rows.filter((row) => !row.passed).length,
    medianMs: timings[Math.floor(timings.length / 2)],
    p95Ms: timings[Math.ceil(timings.length * 0.95) - 1],
    rows,
  }
  const output = args.find((value) => value.startsWith('--output='))?.slice(9)
  if (output) {
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true })
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n')
  }
  console.log(JSON.stringify({ ...report, rows: undefined }))
  if (report.failed) process.exitCode = 1
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
