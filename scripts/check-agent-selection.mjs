/**
 * 파일명: check-agent-selection.mjs
 * 설명: 경로 잡음과 실제 교차 구조 및 선택 편집과 첨부 전송 상태의 회귀 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-17
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import path from 'node:path'
const require = createRequire(import.meta.url)
const {
  chromium,
} = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const root = path.resolve(import.meta.dirname, '..')
const server = await createServer({
  root,
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
})
await server.listen()
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage()
  await page.route('**/api/assistant/status', (r) =>
    r.fulfill({ json: { ready: true, models: [], defaultModel: '' } }),
  )
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  console.log(
    await page.evaluate(async () => {
      const { prepareDrawing, extractDrawingGraph } =
        await import('/src/features/drawing-import/index.ts')
      const results = []
      for (const kind of ['punctured', 'loop', 'junction']) {
        const c = document.createElement('canvas')
        c.width = 600
        c.height = 300
        const x = c.getContext('2d')
        x.fillStyle = 'white'
        x.fillRect(0, 0, 600, 300)
        x.fillStyle = '#00ff00'
        if (kind === 'loop') {
          x.fillRect(40, 50, 500, 200)
          x.fillStyle = 'white'
          x.fillRect(60, 70, 460, 160)
        } else {
          x.fillRect(30, 140, 540, 20)
          if (kind === 'junction') x.fillRect(290, 40, 20, 110)
          else {
            x.fillStyle = 'white'
            for (let i = 100; i < 500; i += 70) x.fillRect(i, 146, 8, 8)
          }
        }
        const d = await prepareDrawing(
          new File([await new Promise((r) => c.toBlob(r))], kind + '.png', { type: 'image/png' }),
        )
        const g = await extractDrawingGraph(d, 'green', new AbortController().signal, () => {})
        const degrees = g.points.map(() => 0)
        for (const [a, b] of g.edges) {
          degrees[a]++
          degrees[b]++
        }
        const row = {
          kind,
          nodes: g.points.length,
          edges: g.edges.length,
          endpoints: degrees.filter((d) => d === 1).length,
          branches: degrees.filter((d) => d > 2).length,
        }
        if (kind === 'punctured' && (row.nodes !== 2 || row.edges !== 1))
          throw Error(JSON.stringify(row))
        if (kind === 'loop' && row.edges !== row.nodes) throw Error('real loop lost')
        if (kind === 'junction' && row.endpoints !== 3) throw Error('junction lost')
        results.push(row)
      }
      return results
    }),
  )
  await page.getByTestId('open-ai').click()
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 600
    c.height = 300
    const x = c.getContext('2d')
    x.fillStyle = '#fff'
    x.fillRect(0, 0, 600, 300)
    x.fillStyle = '#00ff00'
    x.fillRect(20, 140, 560, 20)
    return c.toDataURL().split(',')[1]
  })
  await page.getByTestId('drawing-file').setInputFiles({
    name: 'drawing.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  })
  await page.getByTestId('drawing-attachment').waitFor()
  let request
  await page.route('**/api/assistant/propose', (r) => {
    request = r.request().postDataJSON()
    return r.fulfill({ json: { role: 'assistant', content: 'received' } })
  })
  await page.getByTestId('ai-prompt').fill('read this')
  await page.getByTestId('ai-send').click()
  await page.getByTestId('ai-answer').filter({ hasText: 'received' }).waitFor()
  assert.equal(await page.getByTestId('drawing-attachment').count(), 0)
  assert.equal(await page.locator('.chat-message.user img').count(), 1)
  assert.ok(JSON.parse(request.context).attachment)
  console.log(
    await page.evaluate(async () => {
      const { useEditor } = await import('/src/features/map-editor/index.ts')
      const { emptyDocument, serializeLegacy, previewLegacy } =
        await import('/src/entities/map/index.ts')
      const { executeAgentTool, agentContext } =
        await import('/src/widgets/ai-assistant/model/tools.ts')
      const { ref } = await import('/node_modules/vue/dist/vue.runtime.esm-bundler.js')
      const e = useEditor()
      const map = emptyDocument()
      map.nodes = [
        { id: 1, name: 'N1', x: 0, y: 0 },
        { id: 2, name: 'N2', x: 1000, y: 0 },
        { id: 3, name: 'N3', x: 2000, y: 0 },
      ]
      map.edges = [
        { id: 'e1', from: 1, to: 2, direction: 1 },
        { id: 'e2', from: 2, to: 3, direction: 1 },
      ]
      map.ports = [{ id: 'P1', name: 'P1', nodeId: 1, x: 10, y: 50, width: 100, height: 100 }]
      e.importGeneratedMap(map)
      e.selectedIds = [1, 2]
      const options = {
        context: () => agentContext(),
        drawing: () => {
          throw Error('must not reread drawing')
        },
        internal: () => {},
        generated: () => {},
        focus: () => {},
        progress: () => {},
        findings: ref([]),
        settings: { tiles: 4, radius: 0, vehicleWidth: 900, clearance: 150 },
      }
      const call = async (args) =>
        executeAgentTool(
          { function: { name: 'edit_selection', arguments: args } },
          new AbortController(),
          options,
        )
      const before = await call({ operation: 'inspect' })
      if (before.details.center.x !== 500 || before.details.boundaryEdges.length !== 1)
        throw Error('selection context')
      await call({ operation: 'move', dx: 1, dy: 0, unit: 'm' })
      if (
        e.document.nodes[0].x !== 1000 ||
        e.document.ports[0].x !== 1010 ||
        e.document.nodes[2].x !== 2000
      )
        throw Error('move failure')
      await call({ operation: 'duplicate', dx: 0, dy: 2000 })
      if (
        e.document.nodes.length !== 5 ||
        e.document.edges.length !== 3 ||
        e.document.ports.length !== 2
      )
        throw Error('duplicate connections')
      await call({ operation: 'delete' })
      if (
        e.document.nodes.some((n) => n.id === 1 || n.id === 2) ||
        e.document.edges.length !== 1 ||
        e.document.ports.length !== 1
      )
        throw Error('delete cascade')
      e.undo()
      if (e.document.nodes.length !== 5) throw Error('undo')
      map.ports[0].settings = { id_port_parent: 'MissingParent', standby_node_uid0: 54321 }
      map.ports[0].reservations = { startBuffer: [98765] }
      e.load(serializeLegacy(map).content, 'training.jmapx')
      e.selectedPortId = 'P1'
      const trainingRequest = new AbortController()
      const invoke = (name, args) =>
        executeAgentTool({ function: { name, arguments: args } }, trainingRequest, options)
      const evidence = await invoke('search_mgs_training', { query: '후면 포크 포트 진입 Reverse' })
      if (!evidence[0]?.source.includes('41분 40초')) throw Error('Training evidence')
      const audit = await invoke('audit_port_references', { portId: 'P1' })
      if (audit.total !== 3 || audit.issues.some((issue) => issue.portId !== 'P1'))
        throw Error('Port reference audit')
      const port = await invoke('port_approach', { operation: 'inspect' })
      const route = port.approaches[0]
      if (port.approaches.length !== 1 || route.direction !== 'backward' || route.fromNodeId !== 2)
        throw Error('Port approach direction')
      const change = await invoke('port_approach', {
        operation: 'set_reverse',
        edgeId: route.edgeId,
        reverse: true,
      })
      const saved = previewLegacy(
        serializeLegacy(e.document, e.legacySource).content,
        'training.jmapx',
      )
      const edge = saved.edges.find((item) => item.from === 1 && item.to === 2)
      if (
        !change.after.reverse ||
        edge.controls.backward.reverse !== 1 ||
        edge.controls.forward.reverse !== 0 ||
        edge.direction !== 1
      )
        throw Error('Directional Reverse round trip')
      let rejected = false
      try {
        await invoke('port_approach', { operation: 'inspect' })
        await invoke('port_approach', {
          operation: 'set_reverse',
          edgeId: saved.edges.find((item) => item.from === 2).id,
          reverse: true,
        })
      } catch {
        rejected = true
      }
      if (!rejected) throw Error('Unrelated approach accepted')
      e.undo()
      if (
        (await invoke('port_approach', { operation: 'inspect', portId: 'P1' })).approaches[0]
          .reverse
      )
        throw Error('Approach undo')
      e.selectedPortId = 'P1'
      return 'PASS selection, attachments, training references and direction-specific native port Reverse with undo'
    }),
  )
  await page.getByRole('button', { name: /포트.*진입 설정/ }).click()
  await page.getByRole('button', { name: '후진 · Reverse' }).click()
  await page.getByTestId('apply-map-operation').click()
  await page.getByText('P1 진입 · 후진 적용', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: '포트 참조 점검', exact: true }).click()
  await page.getByText('검사 포트 1개 · 누락 참조 3건', { exact: true }).waitFor()
  if (process.env.MGS_LIVE_AGENT === '1') {
    await page.evaluate(async () => {
      const { useEditor } = await import('/src/features/map-editor/index.ts')
      const editor = useEditor()
      editor.operationsOpen = false
      editor.undo()
      editor.selectedPortId = 'P1'
    })
    await page.unroute('**/api/assistant/propose')
    const observation = page.waitForRequest(
      (request) => {
        if (!request.url().endsWith('/api/assistant/propose')) return false
        return request
          .postDataJSON()
          .history.some(
            (item) =>
              item.tool_name === 'port_approach' &&
              JSON.parse(item.content).result?.changed === true,
          )
      },
      { timeout: 120000 },
    )
    await page
      .getByTestId('ai-prompt')
      .fill(
        '교육 자료에서 후면 포크 사례를 찾아줘. 먼저 선택한 P1 포트의 진입 경로와 현재 설정을 조회한 다음, 진입 경로가 하나라면 그 방향의 Reverse를 설정해줘.',
      )
    await page.getByTestId('ai-send').click()
    await page.waitForFunction(
      async () => {
        const { useEditor } = await import('/src/features/map-editor/index.ts')
        return useEditor().document.edges.some(
          (edge) =>
            edge.from === 1 &&
            edge.to === 2 &&
            edge.direction === 1 &&
            edge.controls?.backward?.reverse === 1 &&
            edge.controls?.forward?.reverse === 0,
        )
      },
      undefined,
      { timeout: 120000 },
    )
    const history = (await observation).postDataJSON().history
    assert.ok(
      history.some(
        (item) => item.tool_name === 'search_mgs_training' && JSON.parse(item.content).ok,
      ),
    )
    assert.ok(
      history.some(
        (item) =>
          item.tool_name === 'port_approach' &&
          JSON.parse(item.content).result?.approaches?.length === 1,
      ),
    )
    console.log('Live Ollama applied only the selected port approach direction')
  }
} finally {
  await browser.close()
  await server.close()
}
