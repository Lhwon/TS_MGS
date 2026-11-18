/**
 * 파일명: test-map-rendering.mjs
 * 설명: 대량 지도 노드 치수와 평면 레이어 및 라벨 캐시와 고해상도 표시 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const {
  chromium,
} = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const root = path.resolve(import.meta.dirname, '..')
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-mgs-render-'))
// 실행할 때만 삽입하며 배포 소스에 남기지 않는 렌더러 검증 접근점
const server = await createServer({
  root,
  cacheDir: path.join(root, 'node_modules', '.vite-map-rendering'),
  server: { host: '127.0.0.1', port: 0 },
  plugins: [
    {
      name: 'map-rendering-verification',
      enforce: 'pre',
      transform: (code, id) => {
        const filename = id.replaceAll('\\', '/')
        if (filename.endsWith('/map-canvas/lib/MapScene.ts'))
          return code.replace(
            '  return {\n    capture,',
            `
  ;(window as any).__mapView = { renderer, scene, camera, labelCanvas, labels: () => mapLabels, setDocument, zoomBy }
  return {\n    capture,`,
          )
        if (filename.endsWith('/facility-studio/lib/FacilityScene.ts'))
          return code.replace(
            '  return {\n    setMap: setMap,',
            `
  ;(window as any).__facilityView = { renderer, scene, camera, labels, ground, models, selectionBounds, controls, setMap, map: () => mapDocument, theme: () => mapTheme, layers: () => visibleLayers }
  return {\n    setMap: setMap,`,
          )
      },
    },
  ],
})
await server.listen()
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const errors = []
try {
  const page = await browser.newPage({
    viewport: { width: 1560, height: 980 },
    deviceScaleFactor: 2,
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    window.__frames = []
    window.__smallText = 0
    window.__labelClears = 0
    window.__labelResizes = 0
    const nativeClear = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = new Proxy(nativeClear, {
      apply: (target, context, args) => {
        if (context.canvas.classList.contains('map-labels')) window.__labelClears++
        if (context.canvas === window.__facilityView?.labels) window.__groundText = []
        return Reflect.apply(target, context, args)
      },
    })
    const nativeText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = new Proxy(nativeText, {
      apply: (target, context, args) => {
        if (
          (context.canvas.classList.contains('map-labels') ||
            context.canvas === window.__facilityView?.labels) &&
          Number(context.font.match(/([\d.]+)px/)?.[1]) < 6
        )
          window.__smallText++
        if (context.canvas === window.__facilityView?.labels)
          window.__groundText.push(String(args[0]))
        return Reflect.apply(target, context, args)
      },
    })
    const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')
    Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
      ...width,
      set: new Proxy(width.set, {
        apply: (target, canvas, args) => {
          if (canvas === window.__facilityView?.labels) window.__labelResizes++
          return Reflect.apply(target, canvas, args)
        },
      }),
    })
    const nativeFrame = requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (callback) =>
      nativeFrame((time) => {
        const clears = window.__labelClears
        const start = performance.now()
        callback(time)
        if (window.__labelClears > clears) window.__frames.push(performance.now() - start)
      })
  })
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__mapView)
  await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/model/editor.ts')
    const { emptyDocument } = await import('/src/entities/map/model/map.ts')
    const map = emptyDocument()
    for (let id = 1; id <= 8000; id++) {
      const x = ((id - 1) % 100) * 1000,
        y = Math.floor((id - 1) / 100) * 1000
      map.nodes.push({ id, x, y, name: `N${id}`, direction: id % 3 === 0 ? 1 : 0 })
      if (id % 100 !== 1) map.edges.push({ id: `E${id}`, from: id - 1, to: id, direction: 0 })
      if (id % 10 === 0)
        map.ports.push({
          id: `P${id}`,
          name: `Port ${id}`,
          nodeId: id,
          x,
          y: y + 300,
          width: 600,
          height: 400,
        })
    }
    map.shapes = [
      {
        id: 1,
        description: '',
        text: '',
        type: 1,
        x1: 0,
        y1: 0,
        x2: 99000,
        y2: 79000,
        centerX: 49500,
        centerY: 39500,
        width: 99000,
        height: 79000,
        radius: 0,
        strokeColor: 0,
        strokeWidth: 1,
        strokeStyle: 0,
        fillColor: 0xeeeeee,
        fontColor: 0,
        fontAlign: 0,
        fontDirection: 0,
        fillStyle: 0,
      },
    ]
    useEditor().load(JSON.stringify(map), 'render-fixture.tsmgs.json')
  })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  const precision = await page.evaluate(async () => {
    const { createMapTopology } = await import('/src/entities/map/lib/createMapTopology.ts')
    const source = {
      format: 'ts-mgs',
      version: 1,
      units: 'mm',
      name: 'large-origin',
      nodes: [
        { id: 1, x: 900000000, y: 900000000, name: 'N1' },
        { id: 2, x: 900001000, y: 900000000, name: 'N2', curve: true },
      ],
      edges: [{ id: 'E1', from: 1, to: 2 }],
      ports: [
        { id: 'P1', name: '', nodeId: 1, x: 900000500, y: 900000500, width: 600, height: 400 },
      ],
    }
    const before = JSON.stringify(source)
    const topology = createMapTopology(source)
    const arrows = topology.group.getObjectByName('arrows').geometry.getAttribute('position')
    const result = {
      unchanged: before === JSON.stringify(source),
      origin: topology.nodeMesh.position.x,
      localX: topology.nodeMesh.instanceMatrix.array[28],
      curveRadiusMm: topology.group.getObjectByName('node-borders').instanceMatrix.array[16] * 25,
      markerLength: Math.abs(arrows.getX(1)),
      markerHalfWidth: Math.abs(arrows.getY(0)),
    }
    topology.group.traverse((object) => {
      object.geometry?.dispose()
      if (object.material)
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          material.dispose()
      if (object.isInstancedMesh) object.dispose()
    })
    return result
  })
  assert.ok(precision.unchanged)
  assert.equal(precision.origin, 900000000)
  assert.equal(precision.localX, 1000)
  assert.ok(Math.abs(precision.curveRadiusMm - 1 / 0.03) < 0.00001)
  assert.equal(precision.markerLength, 200)
  assert.ok(Math.abs(precision.markerHalfWidth - 2 / 0.03) < 0.00001)
  const topology = await page.evaluate(() => {
    const view = window.__mapView
    const nodes = view.scene.getObjectByName('nodes')
    const meshState = []
    view.scene.traverse((object) => {
      if (!object.isMesh || object.renderOrder >= 0) return
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        meshState.push({
          name: object.name,
          order: object.renderOrder,
          depthTest: material.depthTest,
          depthWrite: material.depthWrite,
          transparent: material.transparent,
        })
    })
    window.__panBefore = view.camera.position.clone()
    window.__labelCache = view.labels()
    window.__geometry = nodes.geometry.uuid
    window.__frames = []
    return {
      radius: view.scene.getObjectByName('node-borders').geometry.parameters.radius,
      nodes: nodes.count,
      meshState,
      near: view.camera.near,
      far: view.camera.far,
      canvas: view.renderer.domElement.width,
      labels: view.labelCanvas.width,
    }
  })
  assert.equal(topology.radius, 25)
  assert.equal(topology.nodes, 8000)
  assert.equal(topology.canvas, topology.labels)
  assert.equal(topology.far, 20000)
  assert.ok(topology.meshState.length >= 7)
  assert.ok(
    topology.meshState.every(
      (mesh) =>
        !mesh.depthTest && !mesh.depthWrite && (mesh.name === 'port-captions' || !mesh.transparent),
    ),
  )
  const canvas = page.locator('.map-viewport > canvas').first()
  const rect = await canvas.boundingBox()
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
  await page.keyboard.down('Space')
  await page.mouse.down()
  for (let index = 0; index < 32; index++) {
    await page.mouse.move(rect.x + rect.width / 2 + index * 2, rect.y + rect.height / 2 + index)
    await page.evaluate(() => new Promise(requestAnimationFrame))
  }
  await page.mouse.up()
  await page.keyboard.up('Space')
  const movement = await page.evaluate(() => {
    const view = window.__mapView
    const frames = window.__frames.slice(2).sort((a, b) => a - b)
    const cache = view.labels() === window.__labelCache
    const geometry = view.scene.getObjectByName('nodes').geometry.uuid === window.__geometry
    return {
      cache,
      geometry,
      panned: !view.camera.position.equals(window.__panBefore),
      smallText: window.__smallText,
      frames: frames.length,
      medianMs: frames[Math.floor(frames.length / 2)],
      p95Ms: frames[Math.floor(frames.length * 0.95)],
      calls: view.renderer.info.render.calls,
    }
  })
  assert.ok(movement.cache && movement.geometry && movement.panned)
  assert.equal(movement.smallText, 0)
  assert.ok(movement.frames >= 20)
  await page.screenshot({ path: path.join(output, 'map-light.png') })
  await page.getByTestId('theme-toggle').click()
  await page.waitForTimeout(100)
  await page.screenshot({ path: path.join(output, 'map-dark.png') })
  await page.getByTestId('mode-facility').click()
  await page.waitForFunction(() => !!window.__facilityView)
  await page.evaluate(async () => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
    const studio = useFacilityEditor()
    studio.setAsset(
      {
        id: 'render-box',
        name: 'Render Box',
        kind: 'equipment',
        parts: [
          {
            id: 'body',
            name: 'Body',
            shape: 'box',
            position: { x: 0, y: 0, z: 500 },
            size: { x: 1000, y: 1000, z: 1000 },
            rotation: 0,
            color: '#d5a456',
          },
        ],
      },
      studio.document.mapRef,
    )
    studio.place(50000, 40000)
  })
  await page.getByTestId('selection-focus').click()
  await page.waitForTimeout(150)
  assert.ok(await page.evaluate(() => window.__groundText.length > 0))
  assert.equal(
    await page.evaluate(() => window.__groundText.includes('(N4,051)')),
    false,
    'covered ground label must not float over equipment',
  )
  const facility = await page.evaluate(() => {
    const view = window.__facilityView
    const node = view.ground.getObjectByName('nodes')
    const model = view.models.children.find((object) => object.isMesh)
    const id = node.geometry.uuid
    const modelId = model.uuid
    view.setMap(view.map(), view.theme(), { ...view.layers(), ports: false })
    const preserved =
      view.ground.getObjectByName('nodes').geometry.uuid === id &&
      view.models.children.includes(model)
    view.setMap(view.map(), view.theme(), { ...view.layers(), ports: true })
    window.__labelResizes = 0
    return {
      preserved,
      modelId,
      modelDepth: model.material.depthTest,
      dpi: view.renderer.getPixelRatio(),
      width: view.labels.width,
      canvas: view.renderer.domElement.width,
    }
  })
  assert.ok(facility.preserved && facility.modelDepth)
  assert.equal(facility.dpi, 2)
  assert.equal(facility.width, facility.canvas)
  await page.mouse.move(950, 450)
  await page.keyboard.down('Space')
  await page.mouse.down()
  await page.mouse.move(1000, 475, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  assert.equal(await page.evaluate(() => window.__labelResizes), 0)
  await page.screenshot({ path: path.join(output, 'facility.png') })
  const catalog = JSON.parse(
    await fs.readFile(path.join(root, 'src/entities/facility/ceram-mp5.equipment.json'), 'utf8'),
  )
  const glbAsset = catalog.assets.find((asset) => asset.glb)
  assert.ok(glbAsset)
  await page.evaluate(async (asset) => {
    const studio = (
      await import('/src/features/facility-editor/model/studio.ts')
    ).useFacilityEditor()
    studio.setAsset(asset, studio.document.mapRef)
    studio.place(52000, 40000)
  }, glbAsset)
  await page.waitForFunction(() =>
    window.__facilityView.models.children.some((mesh) => mesh.userData.sharedGlb),
  )
  await page.getByTestId('selection-focus').click()
  const glbBounds = await page.evaluate(() => {
    const bounds = window.__facilityView.selectionBounds
    return {
      x: bounds.max.x - bounds.min.x,
      y: bounds.max.y - bounds.min.y,
      z: bounds.max.z - bounds.min.z,
    }
  })
  for (const axis of ['x', 'y', 'z'])
    assert.ok(Math.abs(glbBounds[axis] * 1000 - glbAsset.glb.size[axis]) < 0.1)
  await page.screenshot({ path: path.join(output, 'facility-glb.png') })
  let sourceMap
  if (process.argv[2]) {
    const { readMapFile } = require('../electron/map-files.cjs')
    const file = await readMapFile(path.resolve(process.argv[2]))
    await page.evaluate(async (file) => {
      const { useEditor } = await import('/src/features/map-editor/model/editor.ts')
      useEditor().load(file.content, file.name, file.theme, file.portGroups)
    }, file)
    await page.getByTestId('mode-map').click()
    await page.waitForFunction(() => window.__mapView.renderer.domElement.isConnected)
    await page.evaluate(() => new Promise(requestAnimationFrame))
    sourceMap = await page.evaluate(async () => {
      const editor = (await import('/src/features/map-editor/model/editor.ts')).useEditor()
      const view = window.__mapView
      return {
        nodes: editor.document.nodes.length,
        ports: editor.document.ports.length,
        renderedNodes: view.scene.getObjectByName('nodes').count,
      }
    })
    assert.equal(sourceMap.nodes, sourceMap.renderedNodes)
    await page.screenshot({ path: path.join(output, 'source-map.png') })
  }
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      nodes: 8000,
      nodeRadiusMm: topology.radius,
      precision,
      movement,
      facility,
      sourceMap,
      glbBounds,
      screenshots: output,
    }),
  )
} finally {
  await browser.close()
  await server.close()
}
