/**
 * 파일명: check-mgs-migration.mjs
 * 설명: 노드 간격과 참조 재정렬 및 원본 제어값의 저장 복원을 검증하는 이관 회귀 점검
 * 작성자: 이희원
 * 작성일자: 2026-11-17
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import path from 'node:path'
import fs from 'node:fs/promises'
const require = createRequire(import.meta.url),
  {
    chromium,
  } = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const root = path.resolve(import.meta.dirname, '..'),
  server = await createServer({
    root,
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
  })
await server.listen()
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage()
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  const results = await page.evaluate(async () => {
    const { emptyDocument, serializeLegacy, previewLegacy } =
      await import('/src/entities/map/index.ts')
    const { subdividePaths, shortestMapPath, useEditor, createGrid, makeAroundData } =
      await import('/src/features/map-editor/index.ts')
    const map = emptyDocument()
    map.nodes = [
      { id: 1, uid: 1, realId: 1, name: 'N1', x: 0, y: 0 },
      { id: 2, uid: 2, realId: 2, name: 'N2', x: 2500, y: 0 },
      { id: 3, uid: 3, realId: 3, name: 'N3', x: 2500, y: 2000 },
    ]
    map.edges = [
      {
        id: 'e1',
        from: 1,
        to: 2,
        direction: 1,
        drivingType: 1,
        controls: { forward: { reverse: 1, manualDegree: 1, vehicleDegree: 12345 } },
      },
      { id: 'e2', from: 2, to: 3, direction: 0, drivingType: 1 },
    ]
    map.ports = [{ id: 'P1', nodeId: 3, name: 'port', x: 2600, y: 2100, width: 100, height: 100 }]
    const output = subdividePaths(map, 1000)
    if (output.added !== 3 || output.map.edges.length !== 5 || output.map.ports[0].nodeId !== 3)
      throw Error('subdivision')
    if (shortestMapPath(output.map, 1, 3).distance !== 4500) throw Error('route distance')
    let rejected = false
    try {
      subdividePaths({ ...map, units: 'px' }, 1000)
    } catch {
      rejected = true
    }
    if (!rejected) throw Error('invented physical scale')
    const grid = createGrid(emptyDocument(), {
      rows: 2,
      columns: 3,
      spacingX: 1000,
      spacingY: 2000,
      x: 0,
      y: 0,
    })
    if (grid.nodes.length !== 6 || grid.edges.length !== 7) throw Error('grid topology')
    const around = makeAroundData(map, 3000)
    if (!around.content.startsWith('3000\t\r\n') || around.pairs !== 4) throw Error('around format')
    const original = serializeLegacy(map)
    const e = useEditor()
    e.load(original.content, 'test.jmapx')
    e.commit((m) => {
      m.nodes = m.nodes.filter((n) => n.id !== 2)
      m.edges = []
    })
    if (e.document.nodes[1].id !== 2 || e.document.ports[0].nodeId !== 2)
      throw Error('renumber references')
    const saved = serializeLegacy(e.document, e.legacySource)
    const back = previewLegacy(saved.content, 'test.jmapx')
    if (back.nodes.find((node) => node.id === 2)?.uid !== 3 || back.ports[0].nodeId !== 2)
      throw Error(
        'renumber native ' +
          JSON.stringify({
            nodes: back.nodes,
            ports: back.ports,
            source: e.legacySource.baseline.nodes,
          }),
      )
    e.undo()
    if (e.document.nodes.length !== 3 || e.document.ports[0].nodeId !== 3)
      throw Error('renumber undo')
    e.commit((m) => {
      m.ports[0].settings = { ...(m.ports[0].settings ?? {}), lu_shift: 125 }
      m.portGroups = [
        {
          id: 'PG1',
          nodeId: 3,
          x: 2500,
          y: 2000,
          width: 1000,
          height: 500,
          strokeColor: 0,
          fillColor: 0,
          portIds: ['P1'],
        },
      ]
      m.nodes[0].noSendGoalLoaded = true
      m.nodes[0].addressType = 4
      m.edges[0].controls.forward.reverse = 0
      m.edges[0].controls.forward.vehicleCorrection = 123
    })
    const control = serializeLegacy(e.document, e.legacySource),
      read = previewLegacy(control.content, 'test.jmapx', control.groups)
    if (read.ports[0].settings.lu_shift !== 125 || read.portGroups[0].id !== 'PG1')
      throw Error('port settings/group roundtrip')
    if (
      read.nodes[0].noSendGoalLoaded !== true ||
      read.nodes[0].addressType !== 4 ||
      read.edges[0].controls.forward.reverse !== 0 ||
      read.edges[0].controls.forward.vehicleCorrection !== 123
    )
      throw Error('control roundtrip')
    return { added: output.added, distance: 4500, renumber: true, controls: true, undo: true }
  })
  console.log(results)
  const actual = process.env.MGS_REFERENCE_MAP
  if (actual) {
    const content = await fs.readFile(actual, 'utf8')
    const result = await page.evaluate(async (content) => {
      const { previewLegacy, serializeLegacy } = await import('/src/entities/map/index.ts')
      const map = previewLegacy(content, 'reference.jmapx')
      const output = serializeLegacy(map, { content, groups: '', baseline: map })
      if (output.content !== content) throw Error('unchanged map modified')
      const changed = structuredClone(map)
      changed.ports[0].settings.lu_shift += 1
      const updated = serializeLegacy(changed, { content, groups: '', baseline: map })
      const read = previewLegacy(updated.content, 'reference.jmapx')
      if (read.ports[0].settings.lu_shift !== changed.ports[0].settings.lu_shift)
        throw Error('actual port edit')
      return {
        nodes: map.nodes.length,
        edges: map.edges.length,
        controls: map.edges.filter((edge) => edge.controls).length,
      }
    }, content)
    console.log('Read-only original map', result)
  }
  await page.getByTestId('edit-selected-node').click()
  await page.getByTestId('map-operations').waitFor()
  assert.ok(await page.getByText('지도 일괄 편집', { exact: true }).isVisible())
  console.log('Migration core and UI checks OK')
} finally {
  await browser.close()
  await server.close()
}
