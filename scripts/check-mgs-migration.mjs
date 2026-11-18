/**
 * 파일명: check-mgs-migration.mjs
 * 설명: 노드 간격과 참조 재정렬 및 원본 제어값의 저장 복원을 검증하는 이관 회귀 점검
 * 작성자: 이희원
 * 작성일자: 2026-11-18
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
    const {
      emptyDocument,
      serializeLegacy,
      previewLegacy,
      calculateCurve,
      appendCurve,
      editSelectedNodes,
    } = await import('/src/entities/map/index.ts')
    const {
      subdividePaths,
      shortestMapPath,
      useEditor,
      createGrid,
      makeAroundData,
      assignRealIds,
      findNearbyNodes,
      applyAutomaticControls,
    } = await import('/src/features/map-editor/index.ts')
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
    const junction = applyAutomaticControls(map, 'spin-junction')
    if (
      !junction.nodes.find((node) => node.id === 2).spinturnable ||
      map.nodes[1].spinturnable !== undefined
    )
      throw Error('IC JC automatic control atomic update')
    const retained = applyAutomaticControls(map, 'retain-auto')
    if (!retained.nodes[0].dontRemoveCmd || retained.nodes[1].dontRemoveCmd)
      throw Error('Bidirectional command retention')
    const numbered = assignRealIds(map, [2, 3], { start: 10, step: 2, order: 'id', insert: false })
    if (
      numbered.map.nodes[1].realId !== 10 ||
      numbered.map.nodes[2].realId !== 12 ||
      map.nodes[1].realId !== 2
    )
      throw Error('Real ID atomic assignment')
    for (const drivingType of [4, 5, 6, 7, 8, 9]) {
      const special = emptyDocument()
      special.nodes = [
        { id: 1, name: 'N1', x: 0, y: 0 },
        { id: 2, name: 'N2', x: 1000, y: 0 },
        { id: 3, name: 'N3', x: 1000, y: 1000 },
      ]
      special.edges = [
        { id: 'special', from: 1, to: 2, drivingType, direction: 1 },
        { id: 'straight', from: 2, to: 3, drivingType: 1, direction: 1 },
      ]
      const first = serializeLegacy(special),
        base = previewLegacy(first.content, 'special.jmapx')
      const degree = base.edges.find((edge) => edge.from === 1).controls
      if (degree.forward.vehicleDegree !== 270000 || degree.backward.vehicleDegree !== 270000)
        throw Error('Special driving reference degree')
      const changed = structuredClone(base)
      changed.nodes[2].x = 2000
      const updated = previewLegacy(
        serializeLegacy(changed, { ...first, baseline: base }).content,
        'special.jmapx',
      )
      if (updated.edges.find((edge) => edge.from === 1).controls.forward.vehicleDegree !== 225000)
        throw Error('Dependent special angle after remote straight movement')
      if (drivingType === 9) {
        e.load(first.content, 'special.jmapx')
        e.moveNodes([3], 1000, 0)
        if (
          e.document.edges.find((edge) => edge.from === 1).controls.forward.vehicleDegree !== 225000
        )
          throw Error('Editor native metadata synchronization')
      }
    }
    const locked = structuredClone(map)
    locked.nodes[0].removable = false
    let protectedNode = false
    try {
      editSelectedNodes(locked, [1], { operation: 'delete' })
    } catch {
      protectedNode = true
    }
    if (!protectedNode || locked.nodes.length !== 3) throw Error('Removable protection')
    const close = structuredClone(map)
    close.nodes[1].x = 300
    if (
      findNearbyNodes(close, 300).nodes.length !== 2 ||
      findNearbyNodes(close, 299).nodes.length !== 0
    )
      throw Error('Nearby inclusive threshold')
    close.nodes[1].x = 0
    if (findNearbyNodes(close, 0).pairs !== 1) throw Error('Coincident node detection')
    const portMap = structuredClone(map)
    portMap.ports.push({ ...portMap.ports[0], id: 'P2' })
    const portSource = serializeLegacy(portMap),
      portBase = previewLegacy(portSource.content, 'ports.jmapx'),
      edited = structuredClone(portBase)
    edited.ports[0].reservations.startBuffer = [edited.ports[1].uid]
    edited.ports[0].reservations.loadedReserved = [edited.ports[0].uid, edited.ports[1].uid]
    edited.ports[0].bays = [2, 4]
    const reserved = serializeLegacy(edited, { ...portSource, baseline: portBase }),
      reread = previewLegacy(reserved.content, 'ports.jmapx')
    if (
      reread.ports[0].reservations.startBuffer[0] !== edited.ports[1].uid ||
      reread.ports[0].bays.join(',') !== '2,4'
    )
      throw Error('Reservation variable record splice')
    const removed = structuredClone(reread)
    removed.ports.pop()
    let refused = false
    try {
      serializeLegacy(removed, { ...reserved, baseline: reread })
    } catch {
      refused = true
    }
    if (!refused) throw Error('Referenced port deletion accepted')
    removed.ports[0].reservations = { startBuffer: [], loadedReserved: [] }
    if (
      previewLegacy(
        serializeLegacy(removed, { ...reserved, baseline: reread }).content,
        'ports.jmapx',
      ).ports.length !== 1
    )
      throw Error('Reservation repair and delete')
    e.load(reserved.content, 'ports.jmapx')
    const temporaryPort = e.addPort(1, 0, 0),
      stablePort = e.addPort(1, 0, 500)
    const stableUid = e.document.ports.find((port) => port.id === stablePort).uid
    e.removePort(temporaryPort)
    if (e.document.ports.find((port) => port.id === stablePort).uid !== stableUid)
      throw Error('New port UID changed after sibling deletion')
    const curved = emptyDocument()
    curved.nodes = [{ id: 1, name: 'N1', x: 0, y: 0 }]
    const arc = calculateCurve(
      curved,
      1,
      { x: 1000, y: 1000 },
      {
        force: true,
        autoSelect: false,
        reverse: false,
        dynamicRadius: false,
        radius: 1000,
        angle: 90,
        divide: 15,
        direction: 1,
      },
    )
    const curveHead = appendCurve(curved, 1, arc, 1, 0)
    const curveFile = serializeLegacy(curved)
    e.load(curveFile.content, 'curve.jmapx')
    const positions = new Map(
      e.document.nodes.map((node) => [
        node.id,
        { x: node.x, y: node.y, move: node.id === curveHead || node.curve },
      ]),
    )
    e.moveNodes([curveHead], 100, 200)
    for (const node of e.document.nodes) {
      const before = positions.get(node.id)
      if (
        node.x !== before.x + (before.move ? 100 : 0) ||
        node.y !== before.y + (before.move ? 200 : 0)
      )
        throw Error('Curve virtual node move')
    }
    previewLegacy(serializeLegacy(e.document, e.legacySource).content, 'curve.jmapx')
    e.bayFilter = [99]
    e.newMap()
    if (e.bayFilter.length) throw Error('Stale Bay filter after map replacement')
    return {
      added: output.added,
      distance: 4500,
      renumber: true,
      controls: true,
      undo: true,
      reservations: true,
      curveMove: true,
      nearby: true,
    }
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
