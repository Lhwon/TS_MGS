/**
 * 이름 변경의 실제 편집 이력과 다단계 대화 완료 및 후속 질문 회귀 검증
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.MGS_PLAYWRIGHT ??
    'C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
)
const { aiPropose, cancelAi } = require('../electron/ai-service.cjs')
const root = path.resolve(import.meta.dirname, '..')
const cacheDir = await mkdtemp(path.join(tmpdir(), 'mgs-agent-naming-'))
const server = await createServer({
  root,
  cacheDir,
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
})
const live = process.argv.includes('--live')
const model = process.argv.find((arg) => arg.startsWith('--model='))?.slice(8) ?? 'gpt-oss:20b'
const results = []
const originalFetch = global.fetch
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const metrics = []
  if (live)
    global.fetch = async (...args) => {
      const response = await originalFetch(...args)
      if (String(args[0]).endsWith('/api/chat')) {
        const data = await response.clone().json()
        metrics.push({
          done: data.done,
          reason: data.done_reason,
          tokens: data.eval_count,
          promptTokens: data.prompt_eval_count,
          thinkingCharacters: data.message?.thinking?.length ?? 0,
        })
      }
      return response
    }
  await page.exposeFunction('namingInfer', (request) => aiPropose(request))
  await page.exposeFunction('namingCancel', (id) => cancelAi(id))
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  await page.getByTestId('undo').waitFor()
  await page.evaluate(async () => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/index.ts')
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    const { emptyFacilityDocument } = await import('/src/entities/facility/index.ts')
    const { executeAgentTool, agentContext } =
      await import('/src/widgets/ai-assistant/model/tools.ts')
    const { runAgent } = await import('/src/features/ai-assistant/model/agent.ts')
    const facility = useFacilityEditor(),
      editor = useEditor()
    const doc = emptyFacilityDocument()
    doc.version = 2
    doc.assets = ['랙', '작업대'].map((name, index) => ({
      id: 'asset-' + index,
      name,
      kind: 'equipment',
      parts: [],
      glb: {
        uri: 'models/model-' + index + '.glb',
        hash: String(index + 1).repeat(64),
        sourceName: name + '.glb',
        size: { x: 1000, y: 500, z: 1200 },
      },
    }))
    doc.instances = Array.from({ length: 199 }, (_, index) => ({
      id: 'instance-' + index,
      name: 'OBJECT_' + index,
      assetId: 'asset-' + (index % 2),
      position: { x: index * 1000, y: 2000, z: 0 },
      rotation: 90,
      scale: { x: 1, y: 2, z: 1 },
      ...(index ? { attachedTo: 'instance-0' } : {}),
    }))
    doc.instances[0].cutawayRole = 'wall'
    const options = {
      context: () => agentContext(),
      drawing: async () => {
        throw Error('도면 접근 금지')
      },
      internal: () => {},
      generated: () => {},
      focus: () => {},
      progress: () => {},
      findings: { value: [] },
      settings: { tiles: 4, radius: 0, vehicleWidth: 900, clearance: 150 },
    }
    const execute = (name, args) =>
      executeAgentTool({ function: { name, arguments: args } }, new AbortController(), options)
    window.namingTest = {
      reset: () => {
        facility.load(JSON.stringify(doc), 'naming.map3d.json')
        editor.readOnly = false
      },
      snapshot: () => JSON.parse(JSON.stringify(facility.document)),
      facility,
      execute,
      history: [],
      run: async (question) => {
        const request = new AbortController(),
          steps = [],
          before = JSON.stringify(facility.document)
        let asked = false
        try {
          const answer = await runAgent({
            question,
            model: window.namingModel,
            history: window.namingTest.history,
            signal: request.signal,
            context: () => agentContext(),
            execute: async (call) => {
              steps.push(call.function.name)
              return execute(call.function.name, call.function.arguments)
            },
            ask: async () => {
              asked = true
              request.abort()
              throw Error('사용자 응답 대기')
            },
            remember: (history) => {
              window.namingTest.history = history
            },
            progress: () => {},
            step: () => {},
          })
          return { answer, steps, asked, changed: before !== JSON.stringify(facility.document) }
        } catch (error) {
          if (asked) return { asked, steps, changed: before !== JSON.stringify(facility.document) }
          throw error
        }
      },
    }
    window.namingTest.reset()
  })
  if (live) {
    await page.evaluate((name) => {
      window.namingModel = name
      window.desktop = {
        aiPropose: window.namingInfer,
        cancelAi: window.namingCancel,
        setDirty: () => {},
      }
    }, model)
    for (const [question, action] of [
      ['배치된 3D 객체 전체의 이름을 원본 모델 이름과 일련번호 기준으로 변경해줘.', true],
      ['3D 모델에 적용된 이름을 다 알맞게 변경 가능한가?', false],
      ['가능한지 불가능한지만 알려줘', false],
    ]) {
      const started = performance.now()
      const result = await page.evaluate((prompt) => window.namingTest.run(prompt), question)
      assert.equal(result.changed, action)
      assert.equal(result.asked, false)
      if (!action) assert.equal(result.steps.length, 0)
      assert(result.answer?.trim())
      results.push({ question, ...result, ms: Math.round(performance.now() - started) })
      console.log(JSON.stringify(results.at(-1)))
    }
    const ambiguous = await page.evaluate(() =>
      window.namingTest.run('facility에 등록된 객체들 이름 알맞게 변경해줘'),
    )
    assert(ambiguous.asked || ambiguous.answer?.trim())
    results.push({ question: 'facility에 등록된 객체들 이름 알맞게 변경해줘', ...ambiguous })
  } else {
    const output = await page.evaluate(async () => {
      const test = window.namingTest,
        results = [],
        assert = (value, message) => {
          if (!value) throw Error(message)
        }
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
      const withoutNames = (doc) => ({
        ...doc,
        assets: doc.assets.map(({ name, ...rest }) => rest),
        instances: doc.instances.map(({ name, ...rest }) => rest),
      })
      const before = test.snapshot(),
        past = test.facility.past.length
      await test.execute('edit_equipment', {
        operation: 'update',
        assetId: 'asset-0',
        name: '철제 랙',
      })
      assert(test.snapshot().assets[0].name === '철제 랙', '기존 모델명 수정 실패')
      test.facility.undo()
      assert(same(test.snapshot(), before), '기존 모델명 실행 취소 실패')
      const changed = await test.execute('rename_equipment', {
        target: 'instances',
        mode: 'model_names',
        scope: 'all',
      })
      assert(changed.changed === 199, '전체 배치 변경 수량 오류')
      assert(test.facility.past.length === past + 1, '일괄 변경 이력 중복')
      const after = test.snapshot()
      assert(same(withoutNames(before), withoutNames(after)), '이름 이외 속성 변경')
      assert(
        after.instances[0].name === '랙 1' && after.instances[2].name === '랙 2',
        '모델별 일련번호 오류',
      )
      await test.execute('rename_equipment', {
        target: 'instances',
        mode: 'model_names',
        scope: 'all',
      })
      assert(test.facility.past.length === past + 1, '동일 이름 재적용 이력 생성')
      test.facility.undo()
      assert(same(test.snapshot(), before), '일괄 이름 변경 실행 취소 실패')
      test.facility.redo()
      assert(same(test.snapshot(), after), '일괄 이름 변경 다시 실행 실패')
      results.push(
        '기존 모델명 수정과 일괄 배치 이름 및 GLB 참조와 변형 보존과 실행 취소 및 다시 실행 통과',
      )
      for (const changes of [
        [
          { id: 'instance-0', name: '입구 랙' },
          { id: 'missing', name: '누락' },
        ],
        [{ id: 'instance-0', name: '' }],
        [
          { id: 'instance-0', name: 'A' },
          { id: 'instance-0', name: 'B' },
        ],
      ]) {
        let rejected = false
        try {
          await test.execute('rename_equipment', { target: 'instances', mode: 'explicit', changes })
        } catch {
          rejected = true
        }
        assert(rejected && same(test.snapshot(), after), '잘못된 목록의 부분 적용')
      }
      await test.execute('rename_equipment', {
        target: 'models',
        mode: 'explicit',
        changes: [{ id: 'asset-0', name: '보관 랙' }],
      })
      assert(test.snapshot().assets[0].name === '보관 랙', '카탈로그 모델명 변경 실패')
      assert(same(test.snapshot().instances, after.instances), '모델명 변경의 배치명 전파')
      results.push('모델명과 배치명 구분 및 잘못된 목록 원자성 검증 통과')
      return results
    })
    results.push(...output)
    console.log(JSON.stringify(output))
  }
  global.fetch = originalFetch
  assert.deepEqual(pageErrors, [])
  const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9)
  if (output)
    await writeFile(output, JSON.stringify({ live, model, results, metrics }, null, 2) + '\n')
} finally {
  global.fetch = originalFetch
  await browser?.close()
  await server.close()
  assert(path.resolve(cacheDir).startsWith(path.resolve(tmpdir()) + path.sep))
  await rm(cacheDir, { recursive: true, force: true })
}
