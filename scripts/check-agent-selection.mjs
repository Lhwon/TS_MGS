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
  await page
    .getByTestId('drawing-file')
    .setInputFiles({
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
      const { emptyDocument } = await import('/src/entities/map/index.ts')
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
      return 'PASS selection context, boundary, m-unit move, dependent port, connected duplicate, deletion cascade, undo; attachment consumed and retained in chat'
    }),
  )
} finally {
  await browser.close()
  await server.close()
}
