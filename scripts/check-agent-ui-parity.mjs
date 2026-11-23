/**
 * 파일명: check-agent-ui-parity.mjs
 * 설명: 동일 초기 문서에서 수동 편집과 AI 도구의 지도 및 설비 결과 비교
 * 작성자: 이희원
 * 작성일자: 2026-11-23
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.MGS_PLAYWRIGHT ??
    'C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
)
const root = path.resolve(import.meta.dirname, '..')
const cacheDir = await mkdtemp(path.join(tmpdir(), 'ts-mgs-agent-parity-'))
const server = await createServer({
  root,
  cacheDir,
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
  optimizeDeps: { include: ['three/examples/jsm/environments/RoomEnvironment.js'] },
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({
    headless: true,
    channel: 'msedge',
    args: ['--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 1550, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  await page.getByTestId('undo').waitFor()
  await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    const { useFacilityEditor } = await import('/src/features/facility-editor/index.ts')
    const { emptyDocument, serializeLegacy, previewLegacy } =
      await import('/src/entities/map/index.ts')
    const { emptyFacilityDocument, exportFacilityFiles, importFacilityFiles } =
      await import('/src/entities/facility/index.ts')
    const { executeAgentTool, agentContext } =
      await import('/src/widgets/ai-assistant/model/tools.ts')
    const editor = useEditor()
    const facility = useFacilityEditor()
    const map = emptyDocument()
    map.nodes = [{ id: 1, name: 'N1', x: 0, y: 0, direction: 0 }]
    map.ports = [{ id: 'P1', name: 'P1', nodeId: 1, x: 100, y: 200, width: 400, height: 500 }]
    const scene = emptyFacilityDocument()
    scene.assets = [
      {
        id: 'model',
        name: 'Block',
        kind: 'equipment',
        parts: [
          {
            id: 'part',
            name: 'Body',
            shape: 'box',
            color: '#8296ad',
            rotation: 0,
            position: { x: 0, y: 0, z: 400 },
            size: { x: 800, y: 800, z: 800 },
          },
        ],
      },
    ]
    scene.instances = [
      {
        id: 'instance',
        assetId: 'model',
        name: 'Block 1',
        portId: 'P1',
        position: { x: 110, y: 220, z: 0 },
        portOffset: { x: 10, y: 20, z: 0 },
        rotation: 30,
        scale: { x: 1, y: 1, z: 1 },
      },
    ]
    const call = (name, args) =>
      executeAgentTool({ function: { name, arguments: args } }, new AbortController(), {
        context: () => agentContext(),
        drawing: async () => {
          throw new Error('Unexpected drawing input')
        },
        internal: () => {},
        generated: () => {},
        focus: () => {},
        progress: () => {},
        findings: { value: [] },
        settings: { tiles: 4, radius: 0, vehicleWidth: 900, clearance: 150 },
      })
    window.agentParity = {
      editor,
      facility,
      call,
      resetMap: () => editor.load(JSON.stringify(map), 'parity.tsmgs.json'),
      resetFacility: () => {
        facility.load(JSON.stringify(scene), 'parity.map3d.json')
        facility.selectedId = 'instance'
      },
      roundTripMap: () => previewLegacy(serializeLegacy(editor.document).content, 'parity.jmapx'),
      roundTripFacility: () => {
        const { layout, library } = exportFacilityFiles(facility.document)
        return importFacilityFiles(JSON.stringify(layout), JSON.stringify(library))
      },
    }
  })
  const call = (name, args) =>
    page.evaluate(([tool, parameters]) => window.agentParity.call(tool, parameters), [name, args])
  const readMap = () => page.evaluate(() => window.agentParity.editor.document)
  const readFacility = () => page.evaluate(() => window.agentParity.facility.document)

  await page.evaluate(() => window.agentParity.resetMap())
  const baseline = await readMap()
  const canvas = page.locator('.map-viewport canvas').first()
  const box = await canvas.boundingBox()
  assert.ok(box)
  await canvas.click({ button: 'right', position: { x: box.width / 4, y: box.height / 4 } })
  await page.getByTestId('context-add').click()
  await page.getByTestId('add-x').fill('2500')
  await page.getByLabel('Y (mm)', { exact: true }).fill('1200')
  await page.getByLabel('Connected Node').selectOption({ label: '없음' })
  await page.getByTestId('confirm-add').click()
  const uiCreated = await readMap()
  assert.equal(uiCreated.nodes.length, 2)
  await page.getByTestId('undo').click()
  assert.deepEqual(await readMap(), baseline)
  await page.getByTestId('redo').click()
  assert.deepEqual(await readMap(), uiCreated)

  await page.evaluate(() => window.agentParity.resetMap())
  await call('edit_map', {
    operations: [
      { entity: 'node', operation: 'create', value: { x: 2500, y: 1200, direction: 0 } },
    ],
  })
  assert.deepEqual(await readMap(), uiCreated)
  await call('history', { direction: 'undo' })
  assert.deepEqual(await readMap(), baseline)
  await call('history', { direction: 'redo' })
  assert.deepEqual(await readMap(), uiCreated)

  await page.evaluate(() => {
    const { editor } = window.agentParity
    editor.selectedId = 1
    editor.nodeEditorOpen = true
  })
  await page.getByTestId('node-x').fill('1000')
  await page.getByTestId('node-y').fill('-500')
  await page.getByTestId('apply').click()
  const uiMoved = await readMap()
  assert.deepEqual([uiMoved.ports[0].x, uiMoved.ports[0].y], [1100, -300])
  const uiNative = await page.evaluate(() => window.agentParity.roundTripMap())
  await page.keyboard.press('Escape')
  await call('history', { direction: 'undo' })
  await page.evaluate(() => {
    window.agentParity.editor.selectedId = 1
  })
  await call('edit_selection', { operation: 'move', target: 'nodes', dx: 1, dy: -0.5, unit: 'm' })
  assert.deepEqual(await readMap(), uiMoved)
  assert.deepEqual(await page.evaluate(() => window.agentParity.roundTripMap()), uiNative)

  await page.evaluate(() => {
    const { editor } = window.agentParity
    editor.nodeEditorOpen = false
    editor.objectEditor = 'ports'
    editor.objectEditorTarget = { id: 'P1' }
  })
  await page.getByLabel('X 좌표 mm', { exact: true }).fill('1750')
  await page.getByTestId('object-apply').click()
  const uiPort = await readMap()
  assert.equal(uiPort.ports[0].x, 1750)
  await page.getByRole('dialog').getByRole('button', { name: '닫기' }).click()
  await call('history', { direction: 'undo' })
  await page.evaluate(() => {
    window.agentParity.editor.selectedPortId = 'P1'
  })
  await call('edit_selection', { operation: 'move', target: 'port', x: 1750 })
  assert.deepEqual(await readMap(), uiPort)
  await assert.rejects(call('move_nodes', { nodeIds: [999], dx: 1, dy: 0 }), /이동 대상/)
  await assert.rejects(
    call('edit_map', {
      operations: [
        { entity: 'node', operation: 'create', value: { x: 50, y: 50 } },
        { entity: 'port', operation: 'delete', id: 'missing' },
      ],
    }),
    /missing/,
  )
  assert.deepEqual(await readMap(), uiPort)
  await call('history', { direction: 'undo' })
  assert.deepEqual(await readMap(), uiMoved)
  await call('history', { direction: 'redo' })
  assert.deepEqual(await readMap(), uiPort)

  await page.getByTestId('mode-facility').click()
  await page.evaluate(() => window.agentParity.resetFacility())
  const facilityBaseline = await readFacility()
  await page.getByTestId('instance-x').locator('input').fill('2100')
  await page.getByTestId('instance-y').locator('input').fill('-650')
  await page.getByTestId('instance-apply').click()
  const uiFacility = await readFacility()
  assert.deepEqual(uiFacility.instances[0].position, { x: 2100, y: -650, z: 0 })
  assert.deepEqual(uiFacility.instances[0].portOffset, { x: 350, y: -350, z: 0 })
  const uiExport = await page.evaluate(() => window.agentParity.roundTripFacility())
  await page.getByTestId('scene-undo').click()
  assert.deepEqual(await readFacility(), facilityBaseline)
  await page.getByTestId('scene-redo').click()
  assert.deepEqual(await readFacility(), uiFacility)

  await page.evaluate(() => window.agentParity.resetFacility())
  await call('edit_selection', { operation: 'move', target: 'instance', x: 2100, y: -650 })
  assert.deepEqual(await readFacility(), uiFacility)
  assert.deepEqual(await page.evaluate(() => window.agentParity.roundTripFacility()), uiExport)
  await assert.rejects(call('place_equipment', { assetId: 'missing', x: 0, y: 0 }), /모델을 찾지/)
  await assert.rejects(
    call('place_equipment', { assetId: 'model', portIds: ['missing'] }),
    /missing/,
  )
  await call('history', { target: 'equipment', direction: 'undo' })
  assert.deepEqual(await readFacility(), facilityBaseline)
  await call('history', { target: 'equipment', direction: 'redo' })
  assert.deepEqual(await readFacility(), uiFacility)

  const placed = await call('place_equipment', { assetId: 'model', x: 2200, y: 1300, rotation: 45 })
  const inserted = (await readFacility()).instances.find(({ id }) => id === placed.placed[0].id)
  assert.deepEqual(inserted.position, { x: 2200, y: 1300, z: 0 })
  assert.equal(inserted.rotation, 45)
  await call('history', { target: 'equipment', direction: 'undo' })
  assert.deepEqual(await readFacility(), uiFacility)

  await page.evaluate(async () => {
    const { editor } = window.agentParity
    const { emptyDocument } = await import('/src/entities/map/index.ts')
    const { drawingObjectBounds, drawingObjectPixelBox, patchDrawingObjects } =
      await import('/src/features/drawing-import/index.ts')
    const map = emptyDocument()
    const image = document.createElement('canvas')
    image.width = image.height = 200
    map.drawing = {
      id: 'drawing',
      name: 'parity.png',
      image: image.toDataURL(),
      width: 200,
      height: 200,
      routeColor: 'green',
      scaleMmPerPixel: 10,
      frame: { x: 105, y: 150, rotation: 90 },
      objects: [
        {
          id: 'object',
          kind: 'text',
          status: 'accepted',
          label: '검증',
          x: 30,
          y: 40,
          width: 25,
          height: 10,
          rotation: 0,
          confidence: 1,
        },
      ],
    }
    window.agentParity.resetDrawing = () =>
      editor.load(JSON.stringify(map), 'parity-drawing.tsmgs.json')
    window.agentParity.moveDrawingFromForm = () => {
      const current = editor.document
      const next = patchDrawingObjects(current, ['object'], (object) => {
        const bounds = drawingObjectBounds(current, object)
        return drawingObjectPixelBox(current.drawing, {
          ...bounds,
          x: bounds.x + 100,
          y: bounds.y - 10,
        })
      })
      editor.applyComputedMap(next)
      return next.drawing.objects[0]
    }
    window.agentParity.resetDrawing()
  })
  const uiDrawing = await page.evaluate(() => window.agentParity.moveDrawingFromForm())
  await page.evaluate(() => window.agentParity.resetDrawing())
  await call('edit_drawing_objects', { objectIds: ['object'], operation: 'move', dx: 100, dy: -10 })
  const aiDrawing = (await readMap()).drawing.objects[0]
  assert.deepEqual(aiDrawing, uiDrawing)
  assert.ok(Math.abs(aiDrawing.x - 29) < 1e-8)
  assert.ok(Math.abs(aiDrawing.y - 50) < 1e-8)
  await assert.rejects(
    call('edit_drawing_objects', {
      objectIds: ['object', 'missing'],
      operation: 'rename',
      label: '수정',
    }),
    /missing/,
  )
  assert.deepEqual((await readMap()).drawing.objects[0], uiDrawing)
  assert.deepEqual(pageErrors, [])
  console.log(
    'UI/AI parity: node creation and movement, port position, facility position, undo/redo, failed batches, rotated drawing, JMAPX and 3D round trips',
  )
} finally {
  await browser?.close()
  await server.close()
  await rm(cacheDir, { recursive: true, force: true })
}
