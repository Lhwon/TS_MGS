/**
 * 파일명: check-agent.cjs
 * 설명: 외부 추론 없이 대화와 도구 호출 및 관찰 응답 계약을 확인하는 점검
 * 작성자: 이희원
 * 작성일자: 2026-11-17
 */
const assert = require('node:assert/strict')
const { aiPropose, aiStatus } = require('../electron/ai-service.cjs')
const { tools } = require('../electron/assistant-tools.cjs')
/** 모의 응답으로 원래 도구 호출과 사용자 대화의 분리를 확인하는 계약 점검 */
const check = async () => {
  const original = global.fetch
  const captured = []
  let capabilities = ['completion', 'tools', 'thinking']
  let response = { role: 'assistant', content: '안녕하세요.', tool_calls: [] }
  global.fetch = async (_url, options) => {
    if (String(_url).endsWith('/api/show'))
      return Response.json({
        capabilities,
        model_info: { 'general.architecture': 'gptoss' },
      })
    if (String(_url).endsWith('/api/tags'))
      return Response.json({
        models: [
          {
            name: 'custom:7b',
            size: 123,
            details: { parameter_size: '7B', quantization_level: 'Q4_K_M' },
          },
        ],
      })
    captured.push(JSON.parse(options.body))
    return Response.json({ done: true, message: response })
  }
  try {
    assert.equal(new Set(tools.map((tool) => tool.function.name)).size, tools.length)
    const ask = (history = []) =>
      aiPropose({ id: crypto.randomUUID(), prompt: '배경만 적용해줘', context: '{}', history })
    const status = await aiStatus()
    assert.equal(status.ready, true)
    assert.equal(status.models[0].name, 'custom:7b')
    assert.equal(status.models[0].parameterSize, '7B')
    await aiPropose({
      id: crypto.randomUUID(),
      prompt: '선택 모델',
      context: '{}',
      model: 'custom:7b',
      history: [],
    })
    assert.equal(captured.pop().model, 'custom:7b')
    const chat = await ask()
    assert.equal(chat.content, '안녕하세요.')
    assert.deepEqual(chat.tool_calls, [])
    assert.equal(captured[0].format, undefined)
    assert.ok(captured[0].tools.some((tool) => tool.function.name === 'layout_drawing'))
    response = {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'layout_drawing', arguments: { mode: 'apply' } } }],
    }
    const task = await ask()
    assert.equal(task.tool_calls[0].function.name, 'layout_drawing')
    response = { role: 'assistant', content: '기존 경로를 유지하고 배경을 적용했습니다.' }
    await ask([
      { role: 'user', content: '배경만 적용해줘' },
      task,
      {
        role: 'tool',
        tool_name: 'layout_drawing',
        content: '{"ok":true,"mapObjectsChanged":false}',
      },
    ])
    assert.equal(captured.at(-1).messages.at(-1).role, 'tool')
    response = {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          function: {
            name: 'ask_user',
            arguments: {
              question: '대상 포트를 선택하세요',
              fields: [
                {
                  id: 'port',
                  label: '포트',
                  type: 'select',
                  options: [{ id: 'P1', label: '포트 P1' }],
                },
              ],
            },
          },
        },
      ],
    }
    const clarification = await ask()
    assert.equal(clarification.tool_calls[0].function.name, 'ask_user')
    await ask([
      { role: 'user', content: '설비를 배치해줘' },
      clarification,
      {
        role: 'tool',
        tool_name: 'ask_user',
        content: JSON.stringify({
          ok: true,
          result: { answer: { status: 'answered', values: { port: 'P1' }, units: {} } },
        }),
      },
    ])
    assert.equal(
      captured.at(-1).messages.findLast((message) => message.role === 'tool').tool_name,
      'ask_user',
    )
    capabilities = ['completion']
    response = { role: 'assistant', content: '일반 대화 응답' }
    await ask([
      { role: 'user', content: '배경만 적용해줘' },
      { role: 'tool', tool_name: 'ask_user', content: '{"ok":true}' },
    ])
    assert.equal(captured.at(-1).tools, undefined)
    assert.equal(captured.at(-1).think, undefined)
    assert.ok(captured.at(-1).messages.every((message) => message.role !== 'tool'))
    capabilities = ['embedding']
    await assert.rejects(ask(), /대화를 지원하지 않습니다/)
    capabilities = ['completion', 'tools', 'thinking']
    response = {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'execute_shell', arguments: {} } }],
    }
    await assert.rejects(ask(), /지원하지 않는 도구/)
    process.stdout.write('Agent conversation and tool-result contracts OK\n')
  } finally {
    global.fetch = original
  }
}
void check().catch((error) => {
  process.stderr.write(`${error.stack}\n`)
  process.exitCode = 1
})
