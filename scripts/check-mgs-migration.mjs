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
    plugins: [
      {
        name: 'map-context-pointer-positions',
        enforce: 'pre',
        transform: (code, id) =>
          id.replaceAll('\\', '/').endsWith('/map-canvas/lib/MapScene.ts')
            ? code.replace(
                '  return {\n    capture,',
                `
  ;(window as any).__contextPoint = (x: number, y: number) => {
    const projected = new THREE.Vector3(x, y, 0).project(camera)
    const box = renderer.domElement.getBoundingClientRect()
    return { x: box.left + (1 + projected.x) * box.width / 2, y: box.top + (1 - projected.y) * box.height / 2 }
  }
  return {
    capture,`,
              )
            : undefined,
      },
    ],
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
      findFeatureBoundaries,
      makeLotDistance,
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
    e.insertPathNodes(
      e.document.edges.find((edge) => edge.from === 1 && edge.to === 2).id,
      2,
      [1000, 2000],
    )
    const split = previewLegacy(serializeLegacy(e.document, e.legacySource).content, 'test.jmapx')
    if (
      split.nodes.length !== 5 ||
      split.nodes.find((node) => node.id === 4).x !== 500 ||
      split.nodes.find((node) => node.id === 5).x !== 1500 ||
      shortestMapPath(split, 1, 3).distance !== 4500 ||
      split.edges
        .filter((edge) => edge.from === 1 || edge.from >= 4)
        .some((edge) => edge.direction !== 1 || edge.controls?.forward?.vehicleDegree !== 12345)
    )
      throw Error('context repeat insertion native round trip: ' + JSON.stringify(split.edges))
    e.undo()
    e.fitAndConnect(1, 3, { x: 2400, y: 1900 }, false)
    if (
      e.document.nodes.find((node) => node.id === 3).x !== 2400 ||
      e.document.ports[0].x !== 2500 ||
      !e.document.edges.some((edge) => edge.from === 3 && edge.to === 1)
    )
      throw Error('context fit and connect with anchored port')
    e.undo()
    const { readRouteSetting, patchRouteSetting, readScheduleGroups, patchScheduleGroup } =
      await import('/src/features/map-editor/model/contextFiles.ts')
    const route = patchRouteSetting('2\t4\t5\t6\t0\t12\t90\t\r\n', [1, 1, 2, 3], [8, 10])
    if (
      readRouteSetting(route, [1, 1, 2, 3]).join(',') !== '2,8,10' ||
      readRouteSetting(route, [2, 4, 5, 6]).join(',') !== '0,12,90'
    )
      throw Error('connected path sidecar preservation')
    const command = ['1', '2', '0', '3', '3', '0', '0', '0', '0', '0', '1', 'FUNC', '100', '1']
    const firstSchedule = patchScheduleGroup('0\t\r\n'.repeat(4), 0, 21, [command, command])
    const secondSchedule = patchScheduleGroup(firstSchedule, 2, 22, [command])
    const groups = readScheduleGroups(secondSchedule)
    if (
      groups[0].get(21).length !== 2 ||
      groups[0].get(21)[0].join(',') !== command.join(',') ||
      groups[2].get(22)[0][11] !== 'FUNC'
    )
      throw Error('SCMD sidecar preservation')
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
          fontSize: 40,
          nameAlign: 2,
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
    if (
      read.ports[0].settings.lu_shift !== 125 ||
      read.portGroups[0].id !== 'PG1' ||
      read.portGroups[0].fontSize !== 40 ||
      read.portGroups[0].nameAlign !== 2
    )
      throw Error('port settings/group roundtrip')
    if (
      read.nodes[0].noSendGoalLoaded !== true ||
      read.nodes[0].addressType !== 4 ||
      read.edges[0].controls.forward.reverse !== 0 ||
      read.edges[0].controls.forward.vehicleCorrection !== 123
    )
      throw Error('control roundtrip')
    const junction = applyAutomaticControls(map, 'spin-junction')
    const boundary = findFeatureBoundaries(map)
    if (boundary.map((node) => node.id).join(',') !== '1,2,3')
      throw Error('Feature boundaries at ends and direction change')
    const lot = structuredClone(map)
    lot.ports = [
      { id: 'CV_1', nodeId: 1, x: 0, y: 3000, name: '' },
      { id: 'RACK_A_1_1_1', nodeId: 3, x: 0, y: 100, name: '' },
      { id: 'RACK_A_1_2_1', nodeId: 2, x: 0, y: 4000, name: '' },
    ]
    if (makeLotDistance(lot).content !== 'RACK_A_1_2_1\t2101\nRACK_A_1_1_1\t200001101\n\r\n')
      throw Error('Original LOT priority based on anchor coordinates')
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
        const controlled = structuredClone(base)
        const specialEdge = controlled.edges.find((edge) => edge.from === 1)
        specialEdge.controls.forward.reverse = 1
        const rebuilt = serializeLegacy(
          controlled,
          { ...first, baseline: base },
          { autoReverseOrthogonal: true },
        )
        const roundTrip = previewLegacy(rebuilt.content, 'auto-reverse.jmapx')
        if (roundTrip.edges.find((edge) => edge.from === 1).controls.backward.reverse !== 1)
          throw Error('Automatic Reverse must propagate to the opposite special path')
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
  await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    const { emptyDocument, serializeLegacy } = await import('/src/entities/map/index.ts')
    const map = emptyDocument()
    map.nodes = [
      { id: 1, name: 'N1', x: 0, y: 0 },
      { id: 2, name: 'N2', x: 1000, y: 0 },
      { id: 3, name: 'N3', x: 2000, y: 0 },
    ]
    map.edges = [
      { id: 'a', from: 1, to: 2, direction: 1 },
      { id: 'b', from: 2, to: 3, direction: 1 },
    ]
    map.ports = [
      { id: 'P1', name: '', nodeId: 1, x: 0, y: 100 },
      { id: 'P2', name: '', nodeId: 2, x: 1000, y: 100 },
      { id: 'P3', name: '', nodeId: 3, x: 2000, y: 100 },
    ]
    const editor = useEditor()
    editor.load(serializeLegacy(map).content, 'selected.jmapx')
    editor.selectedIds = [1, 2]
  })
  const selectedEditor = page.getByTestId('selected-map-editor')
  await page.getByTestId('edit-selected-node').click()
  await selectedEditor.getByText('Selected Node Edit', { exact: true }).waitFor()
  const property = selectedEditor.locator('[data-field="property"]')
  await property.locator('input').fill('2')
  assert.equal(
    await property.locator('input').evaluate((input) => getComputedStyle(input).outlineStyle),
    'none',
  )
  await property.getByRole('button', { name: 'Set' }).click()
  await selectedEditor.getByRole('button', { name: 'Node Shift' }).click()
  await selectedEditor.getByLabel('Y Offset mm', { exact: true }).fill('150')
  await selectedEditor.getByRole('button', { name: 'Run' }).click()
  await selectedEditor.getByRole('button', { name: '닫기' }).click()
  await page.getByRole('button', { name: 'Selected Path Edit', exact: true }).click()
  await selectedEditor.getByRole('button', { name: 'OPPOSITE', exact: true }).click()
  const speed = selectedEditor.locator('[data-field="controlSpeed"]')
  await speed.getByLabel('Speed m/min', { exact: true }).fill('15')
  await speed.getByRole('button', { name: 'Set' }).click()
  await selectedEditor.getByRole('button', { name: '닫기' }).click()
  await page.getByRole('button', { name: 'Selected Port Edit', exact: true }).click()
  await selectedEditor.getByRole('button', { name: 'Shape', exact: true }).click()
  const offset = selectedEditor.locator('[data-field="offsetY"]')
  await offset.locator('input').fill('500')
  await offset.getByRole('button', { name: 'Set' }).click()
  const data = await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    const editor = useEditor()
    const { nodes, edges, ports } = editor.document
    return {
      nodes: nodes.map((node) => [node.id, node.property, node.y]).sort((a, b) => a[0] - b[0]),
      paths: edges
        .map((edge) => [
          edge.from,
          edge.controls.forward.controlSpeed,
          edge.controls.backward.controlSpeed,
        ])
        .sort((a, b) => a[0] - b[0]),
      ports: ports.map((port) => port.y),
    }
  })
  assert.deepEqual(data.nodes, [
    [1, 2, 150],
    [2, 2, 150],
    [3, 0, 0],
  ])
  assert.deepEqual(data.paths, [
    [1, 0, 25],
    [2, 0, 0],
  ])
  assert.deepEqual(data.ports, [650, 650, 100])
  await selectedEditor.getByRole('button', { name: 'Main', exact: true }).click()
  await selectedEditor.getByLabel('Port ID 접두사', { exact: true }).fill('RACK')
  await selectedEditor.getByRole('button', { name: '포트 추가', exact: true }).click()
  const additions = await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    const { previewLegacy, serializeLegacy } = await import('/src/entities/map/index.ts')
    const editor = useEditor()
    const files = serializeLegacy(editor.document, editor.legacySource)
    const native = previewLegacy(files.content, 'test.jmapx')
    const created = native.ports
      .filter((port) => port.id.startsWith('RACK'))
      .map((port) => [port.id, port.uid, port.nodeId])
    editor.undo()
    return { created, remainingPorts: editor.document.ports.length }
  })
  assert.deepEqual(additions, {
    created: [
      ['RACK_1', 4, 1],
      ['RACK_2', 5, 2],
    ],
    remainingPorts: 3,
  })
  await selectedEditor.getByRole('button', { name: '닫기', exact: true }).click()
  await page.getByTestId('theme-toggle').click()
  await page.getByTestId('edit-selected-node').click()
  const focusField = selectedEditor.locator('[data-field="property"]')
  await focusField.locator('input').focus()
  const appearance = await focusField.evaluate((row) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--accent)'
    row.append(probe)
    const result = {
      outline: getComputedStyle(row.querySelector('input')).outlineStyle,
      color: getComputedStyle(row.querySelector('.v-field__outline')).color,
      accent: getComputedStyle(probe).color,
    }
    probe.remove()
    return result
  })
  assert.equal(appearance.outline, 'none')
  assert.equal(appearance.color, appearance.accent)
  await selectedEditor.getByRole('button', { name: '닫기' }).click()
  await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    const { emptyDocument, serializeLegacy } = await import('/src/entities/map/index.ts')
    const map = emptyDocument()
    map.nodes = [
      { id: 1, name: 'N1', x: 0, y: 0 },
      { id: 2, name: 'N2', x: 3000, y: 0 },
    ]
    map.edges = [{ id: 'route', from: 1, to: 2, direction: 1 }]
    map.ports = [{ id: 'P1', name: 'Port 1', nodeId: 1, x: 0, y: 1600, width: 500, height: 500 }]
    map.shapes = [
      {
        id: 1,
        description: '작업 구역',
        text: '',
        type: 1,
        x1: 2200,
        y1: 1000,
        x2: 2600,
        y2: 1400,
        centerX: 2400,
        centerY: 1200,
        radius: 0,
        width: 400,
        height: 400,
        strokeColor: 0,
        strokeStyle: 0,
        strokeWidth: 1,
        fillColor: 0,
        fontColor: 0,
        fontAlign: 0,
        fontDirection: 0,
        fillStyle: 0,
      },
    ]
    const editor = useEditor()
    editor.load(serializeLegacy(map).content, 'context.jmapx')
  })
  await page.waitForFunction(() => !!window.__contextPoint)
  const point = (x, y) => page.evaluate(([x, y]) => window.__contextPoint(x, y), [x, y])
  const rightClick = async (x, y) => {
    const screen = await point(x, y)
    await page.mouse.click(screen.x, screen.y, { button: 'right' })
  }
  await rightClick(1500, 0)
  const context = page.getByRole('menu')
  await context.getByRole('menuitem', { name: 'Insert (1)' }).click()
  assert.equal(
    await page.evaluate(async () => {
      const { useEditor } = await import('/src/features/map-editor/index.ts')
      const editor = useEditor()
      const count = editor.document.nodes.length
      editor.undo()
      return count
    }),
    3,
  )
  await rightClick(0, 0)
  await context.getByRole('menuitem', { name: 'Repeat Insert' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '삽입', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(
    await page.evaluate(async () => {
      const { useEditor } = await import('/src/features/map-editor/index.ts')
      return useEditor().document.nodes.length
    }),
    4,
  )
  await rightClick(0, 0)
  await context.getByRole('menuitem', { name: 'Setting (Connected Path)' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '빈 파일로 시작' }).click()
  await page.getByLabel('제한 사이트 코드 목록').fill('7, 8')
  const routeDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '파일 내보내기', exact: true }).click()
  const routeFile = await routeDownload
  assert.equal(routeFile.suggestedFilename(), 'conn_path_setting.data')
  assert.match(await fs.readFile(await routeFile.path(), 'utf8'), /^1\t\d+\t\d+\t\d+\t2\t7\t8\t/)
  await page.getByRole('dialog').getByRole('button', { name: '닫기' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    useEditor().portMode = true
  })
  await rightClick(0, 1600)
  await context.getByRole('menuitem', { name: '포트 SCMD 설정' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '빈 파일로 시작' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '명령 추가' }).click()
  await page.getByLabel('상위 메시지', { exact: true }).fill('FUNC\t100\t1')
  const scheduleDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '파일 내보내기', exact: true }).click()
  const scheduleFile = await scheduleDownload
  assert.equal(scheduleFile.suggestedFilename(), 'scmd_group.dat')
  assert.match(await fs.readFile(await scheduleFile.path(), 'utf8'), /\t1\tFUNC\t100\t1\t/)
  await page.getByRole('dialog').getByRole('button', { name: '닫기' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await rightClick(0, 1600)
  await context.getByRole('menuitem', { name: '포트 그룹 추가' }).click()
  await page.getByTestId('object-add').click()
  const group = await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    return useEditor().document.portGroups[0]
  })
  assert.equal(group.nodeId, 1)
  assert.deepEqual(group.portIds, ['P1'])
  await page.getByRole('dialog').getByRole('button', { name: '닫기' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    useEditor().portMode = false
  })
  await rightClick(2400, 1200)
  await context.getByRole('menuitem', { name: '도형 이동' }).click()
  const destination = await point(2000, 1200)
  await page.mouse.click(destination.x, destination.y)
  const movedShape = await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    return useEditor().document.shapes[0]
  })
  assert.ok(Math.abs(movedShape.centerX - 2000) < 10)
  assert.equal(movedShape.x2 - movedShape.x1, 400)
  await rightClick(0, 0)
  await context.getByText('차량 배치 미리보기', { exact: true }).click()
  await context.getByRole('menuitem', { name: '우클릭 노드에 배치' }).click()
  await rightClick(0, 0)
  await context.getByText('차량 배치 미리보기', { exact: true }).click()
  await context.getByRole('menuitem', { name: '차량 미리보기 지우기' }).click()
  console.log('Migration core and UI checks OK')
} finally {
  await browser.close()
  await server.close()
}
