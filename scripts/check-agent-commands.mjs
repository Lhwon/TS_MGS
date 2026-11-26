/**
 * 공통 기능 탐색과 기존 화면 동작의 일치 및 다단계 에이전트 실행 회귀 검증
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
const live = process.argv.includes('--live')
const model = process.argv.find((arg) => arg.startsWith('--model='))?.slice(8) ?? 'gpt-oss:20b'
const cacheDir = await mkdtemp(path.join(tmpdir(), 'mgs-agent-commands-'))
const server = await createServer({
  root: path.resolve(import.meta.dirname, '..'),
  cacheDir,
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
  optimizeDeps: { include: ['three/examples/jsm/environments/RoomEnvironment.js'] },
})
const tool = (name, args) => ({
  role: 'assistant',
  content: '',
  tool_calls: [{ function: { name, arguments: args } }],
})
const plan = [
  tool('get_app_commands', { id: 'workspace.mode' }),
  tool('execute_app_command', { id: 'workspace.mode', arguments: { mode: 'facility' } }),
  tool('get_app_commands', { id: 'scene.light-settings' }),
  tool('execute_app_command', {
    id: 'scene.light-settings',
    arguments: { assetId: 'lamp', temperature: 5500 },
  }),
  tool('get_app_commands', { id: 'scene.wall-create' }),
  tool('execute_app_command', {
    id: 'scene.wall-create',
    arguments: { x1: 0, y1: 0, x2: 3000, y2: 0, height: 2500, thickness: 100 },
  }),
  { role: 'assistant', content: '조명을 5500 K로 변경하고 벽을 생성했습니다.' },
]
let browser
try {
  await server.listen()
  browser = await chromium.launch({
    headless: true,
    channel: 'msedge',
    args: ['--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 1550, height: 1000 } })
  const errors = [],
    requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/assistant/status', (route) =>
    route.fulfill({
      json: { ready: true, defaultModel: model, models: [{ name: model, size: 0 }] },
    }),
  )
  await page.route('**/api/assistant/propose', async (route) => {
    const request = route.request().postDataJSON()
    requests.push(request)
    if (live) console.log(JSON.stringify({ round: requests.length, at: new Date().toISOString() }))
    try {
      const response = live
        ? await aiPropose(request)
        : (plan.shift() ?? { role: 'assistant', content: '완료했습니다.' })
      if (live) console.log(JSON.stringify({ round: requests.length, response }))
      await route.fulfill({ json: response })
    } catch (error) {
      await route.fulfill({ status: 500, json: { error: error.message } })
    }
  })
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  await page.getByTestId('undo').waitFor()
  await page.evaluate(async () => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/index.ts')
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    const { emptyFacilityDocument, loadDefaultCatalog } =
      await import('/src/entities/facility/index.ts')
    const { executeAgentTool, agentContext } =
      await import('/src/widgets/ai-assistant/model/tools.ts')
    const { listAppCommands, registerAppCommands } = await import('/src/shared/lib/input/index.ts')
    const editor = useEditor(),
      facility = useFacilityEditor()
    const doc = emptyFacilityDocument()
    doc.assets = ['box', 'lamp'].map((id) => ({
      id,
      name: id === 'box' ? '설비' : '원통 조명',
      kind: 'equipment',
      parts: [
        {
          id: 'body',
          name: '본체',
          shape: 'box',
          color: '#999999',
          rotation: 0,
          position: { x: 0, y: 0, z: 500 },
          size: { x: 1000, y: 500, z: 1000 },
        },
      ],
      ...(id === 'lamp'
        ? { catalogCategory: 'lighting', light: { kind: 'spot', temperature: 4000 } }
        : {}),
    }))
    const source = (await loadDefaultCatalog()).assets.find((asset) => asset.glb)
    doc.assets[1].parts = []
    doc.assets[1].glb = JSON.parse(JSON.stringify(source.glb))
    doc.instances = [
      { id: 'placed', assetId: 'box', name: '설비 1', position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    ]
    facility.load(JSON.stringify(doc), 'commands.map3d.json')
    window.commandTest = {
      editor,
      facility,
      list: listAppCommands,
      register: registerAppCommands,
      call: (name, args) =>
        executeAgentTool({ function: { name, arguments: args } }, new AbortController(), {
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
        }),
    }
  })
  const initial = await page.evaluate(() => window.commandTest.list({ limit: 30 }))
  assert(initial.total > 60)
  assert(initial.commands.every((command) => !('run' in command)))
  await assert.rejects(
    page.evaluate(() => window.commandTest.call('execute_app_command', { id: 'unknown' })),
    /사용할 수 없는/,
  )
  await assert.rejects(
    page.evaluate(() =>
      window.commandTest.call('execute_app_command', {
        id: 'workspace.layer',
        arguments: { layer: 'grid', visible: 'yes' },
      }),
    ),
    /입력값/,
  )
  await assert.rejects(
    page.evaluate(() =>
      window.commandTest.call('execute_app_command', {
        id: 'workspace.layer',
        arguments: { layer: 'grid', visible: true, arbitrary: 1 },
      }),
    ),
    /허용되지 않은/,
  )
  const lifecycle = await page.evaluate(async () => {
    let called = 0
    const dispose = window.commandTest.register(() => [
      {
        id: 'test.current',
        label: '상태 검증',
        category: 'Test',
        description: '현재 가용 상태 검증',
        effect: 'view',
        available: false,
        run: () => {
          called++
        },
      },
    ])
    let blocked = false
    try {
      await window.commandTest.call('execute_app_command', { id: 'test.current' })
    } catch {
      blocked = true
    }
    dispose()
    return { blocked, called, remaining: window.commandTest.list({ query: 'test.current' }).total }
  })
  assert.deepEqual(lifecycle, { blocked: true, called: 0, remaining: 0 })
  if (process.argv.includes('--facility'))
    await page.evaluate(() =>
      window.commandTest.call('execute_app_command', {
        id: 'workspace.mode',
        arguments: { mode: 'facility' },
      }),
    )
  const request = live
    ? '3D 화면으로 전환해서 lamp 조명의 색온도를 5500 K로 바꾸고, 시작점 (0,0) 끝점 (3000,0)에 높이 2500mm 두께 100mm의 벽을 만들어줘.'
    : '조명을 5500 K로 바꾸고 높이 2500mm 두께 100mm의 벽을 만들어줘.'
  await page.getByTestId('open-ai').click()
  await page.getByTestId('ai-prompt').fill(request)
  await page.getByTestId('ai-send').click()
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="ai-cancel"]') ||
      !!document.querySelector('[data-testid="agent-question"]'),
    undefined,
    {
      timeout: 300000,
    },
  )
  assert.equal(
    await page.getByTestId('agent-question').count(),
    0,
    await page.getByTestId('agent-question').allTextContents(),
  )
  assert.equal(
    await page.getByTestId('ai-error').count(),
    0,
    await page.locator('[data-testid="ai-answer"]').allTextContents(),
  )
  assert(
    await page.evaluate(() => !!window.commandTest.list({ query: 'scene.wall-create' }).total),
    JSON.stringify(await page.locator('[data-testid="ai-answer"]').allTextContents()),
  )
  const state = await page.evaluate(() => ({
    commands: window.commandTest.list({ limit: 30 }),
    light: window.commandTest.facility.document.assets.find((asset) => asset.id === 'lamp').light,
    instances: window.commandTest.facility.document.instances.length,
    past: window.commandTest.facility.past.length,
  }))
  assert.equal(state.light.temperature, 5500)
  assert.equal(state.instances, 2)
  assert.equal(state.past, 2)
  const canvas = await page.locator('.facility-studio canvas').first().elementHandle()
  await page.evaluate(async () => {
    await window.commandTest.call('execute_app_command', {
      id: 'scene.menu',
      arguments: { menu: 'View' },
    })
    await window.commandTest.call('execute_app_command', {
      id: 'scene.snap',
      arguments: { step: 100 },
    })
    await window.commandTest.call('execute_app_command', {
      id: 'scene.select',
      arguments: { ids: ['placed'] },
    })
    await window.commandTest.call('execute_app_command', {
      id: 'scene.pose',
      arguments: { x: 1500, rotation: 45 },
    })
  })
  assert(await canvas.evaluate((node) => node.isConnected))
  const pose = await page.evaluate(() =>
    window.commandTest.facility.document.instances.find((item) => item.id === 'placed'),
  )
  assert.equal(pose.position.x, 1500)
  assert.equal(pose.rotation, 45)
  const beforeBad = await page.evaluate(() => JSON.stringify(window.commandTest.facility.document))
  await assert.rejects(
    page.evaluate(() =>
      window.commandTest.call('execute_app_command', { id: 'scene.snap', arguments: { step: 42 } }),
    ),
    /입력값/,
  )
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.commandTest.facility.document)),
    beforeBad,
  )
  await page.evaluate(() =>
    window.commandTest.call('execute_app_command', {
      id: 'scene.ceiling-create',
      arguments: { x1: 0, y1: 0, x2: 3000, y2: 2000, height: 3000 },
    }),
  )
  await page.evaluate(() =>
    window.commandTest.call('execute_app_command', {
      id: 'scene.floor-create',
      arguments: { points: [0, 0, 3000, 0, 3000, 2000, 0, 2000] },
    }),
  )
  assert.equal(await page.evaluate(() => window.commandTest.facility.document.floors.length), 1)
  const mounted = await page.evaluate(async () => {
    const wall = window.commandTest.facility.document.instances.find(
      (item) => item.id !== 'placed' && item.assetId.includes('wall'),
    )
    const wallId = wall?.id ?? window.commandTest.facility.document.instances[1].id
    const before = window.commandTest.facility.document.instances.length
    const result = await window.commandTest.call('execute_app_command', {
      id: 'scene.mount',
      arguments: { assetId: 'box', hostId: wallId, x: 0, y: 500 },
    })
    return { before, after: window.commandTest.facility.document.instances.length, result, wallId }
  })
  assert.equal(mounted.after, mounted.before + 1)
  assert.equal(mounted.result.result.instance.attachedTo, mounted.wallId)
  const snapshot = await page.evaluate(() => JSON.stringify(window.commandTest.facility.document))
  await assert.rejects(
    page.evaluate(() =>
      window.commandTest.call('execute_app_command', {
        id: 'scene.mount',
        arguments: { assetId: 'box', hostId: 'missing', x: 0, y: 500 },
      }),
    ),
    /찾을 수 없/,
  )
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.commandTest.facility.document)),
    snapshot,
  )
  const fallback = await page.evaluate(() =>
    window.commandTest.list({ category: 'map', query: 'wall-create' }),
  )
  assert.equal(fallback.commands[0].id, 'scene.wall-create')
  const categorySearch = await page.evaluate(() =>
    window.commandTest.list({ category: 'lighting' }),
  )
  assert(categorySearch.commands.some((command) => command.id === 'scene.light-settings'))
  const files = await page.evaluate(async () => {
    const original = window.desktop
    try {
      window.desktop = {
        setDirty: () => {},
        saveScene: async () => 'verified.map3d.json',
        exportScene: async () => 'isolated-test',
        openScene: async () => null,
      }
      const saved = await window.commandTest.call('execute_app_command', {
        id: 'scene.project-save',
      })
      const exported = await window.commandTest.call('execute_app_command', { id: 'scene.export' })
      window.desktop.saveScene = async () => null
      const cancelled = await window.commandTest.call('execute_app_command', {
        id: 'scene.project-save',
      })
      const before = JSON.stringify(window.commandTest.facility.document)
      window.desktop.saveScene = async () => {
        throw Error('검증용 저장 실패')
      }
      let failed = false
      try {
        await window.commandTest.call('execute_app_command', { id: 'scene.project-save' })
      } catch (error) {
        failed = error.message.includes('검증용 저장 실패')
      }
      return {
        saved: saved.status,
        saveNote: saved.note,
        exported: exported.status,
        cancelled: cancelled.status,
        failed,
        preserved: JSON.stringify(window.commandTest.facility.document) === before,
      }
    } finally {
      if (original) window.desktop = original
      else delete window.desktop
    }
  })
  assert.deepEqual(files, {
    saved: 'completed',
    saveNote: undefined,
    exported: 'completed',
    cancelled: 'cancelled',
    failed: true,
    preserved: true,
  })
  const waiting = await page.evaluate(() =>
    window.commandTest.call('execute_app_command', { id: 'scene.designer' }),
  )
  assert.equal(waiting.status, 'awaiting_user')
  const categories = state.commands.categories
  assert.deepEqual(errors, [])
  const report = {
    live,
    model,
    passed: true,
    initialCommands: initial.total,
    sceneCommands: state.commands.total,
    categories,
    requests: requests.length,
    actualLightTemperature: state.light.temperature,
    checks: [
      '잘못된 기능과 입력 차단',
      '비활성 상태 재검증',
      '화면 수명과 기능 해제',
      '다단계 UI 채팅 실행과 완료 답변',
      '조명 설정 및 벽 생성',
      '속성 편집과 뷰포트 유지',
      '천장 및 바닥 생성',
      '벽 부착 및 잘못된 부모 참조 차단',
      '분류 검색 보정 및 화면 범위 안내',
      '창 열기와 편집 완료 구분',
      '기존 파일 함수의 저장 추출 및 취소와 실패 보존',
    ],
    errors,
  }
  console.log(JSON.stringify(report))
  const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9)
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n')
} catch (error) {
  const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9)
  if (output)
    await writeFile(
      output,
      JSON.stringify({ live, model, passed: false, error: error.message }, null, 2) + '\n',
    )
  throw error
} finally {
  cancelAi('command-test')
  await browser?.close()
  await server.close()
  assert(path.resolve(cacheDir).startsWith(path.resolve(tmpdir()) + path.sep))
  await rm(cacheDir, { recursive: true, force: true })
}
