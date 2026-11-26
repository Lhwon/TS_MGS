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
/** 방향 표식 검증에서 무관한 반응형 화면과 모델 카탈로그 시나리오 제외 */
const directionsOnly = process.argv.includes('--directions-only')
// 실행할 때만 삽입하며 배포 소스에 남기지 않는 렌더러 검증 접근점
const server = await createServer({
  root,
  cacheDir: path.join(root, 'node_modules', '.vite-map-rendering'),
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  optimizeDeps: { include: ['three/addons/environments/RoomEnvironment.js'] },
  plugins: [
    {
      name: 'map-rendering-verification',
      enforce: 'pre',
      transform: (code, id) => {
        const filename = id.replaceAll('\\', '/')
        if (filename.endsWith('/map-canvas/lib/MapScene.ts'))
          return code.replace(
            /  return \{\r?\n    capture,/,
            `
  ;(window as any).__mapView = { renderer, scene, camera, labelCanvas, labels: () => mapLabels, setDocument, zoomBy }
  return {\n    capture,`,
          )
        if (filename.endsWith('/facility-studio/lib/FacilityScene.ts'))
          return code.replace(
            /  return \{\r?\n    setMap: setMap,/,
            `
  ;(window as any).__facilityView = { renderer, scene, camera, labels, ground, models, selectionBounds, controls, setMap, requestRender, map: () => mapDocument, theme: () => mapTheme, layers: () => visibleLayers }
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
  const themeToggle = page.getByTestId('theme-toggle')
  const originalTheme = await page.locator('html').getAttribute('data-theme')
  const tabList = page.getByRole('tablist', { name: 'MGS 작업 메뉴' })
  const tabs = await tabList.getByRole('tab').allTextContents()
  /** 기존 화면 폭 검증과 지도 형상 회귀 검증의 선택 실행 지원 */
  for (const theme of directionsOnly ? [] : ['light', 'dark']) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) await themeToggle.click()
    await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme)
    for (const width of [1120, 800, 520]) {
      await page.setViewportSize({ width, height: 720 })
      for (const name of tabs) {
        await tabList.getByRole('tab', { name: name.trim(), exact: true }).click()
        const clipped = await page.evaluate(() => {
          const root = document.querySelector('.mgs-workspace')
          const ribbon = root.querySelector('.ribbon-content')
          const bottom = root.querySelector('.mgs-bottom').getBoundingClientRect()
          const status = root.querySelector('.mgs-status').getBoundingClientRect()
          const map = root.querySelector('.mgs-map').getBoundingClientRect()
          const errors = []
          if (map.height < 140 || bottom.bottom > status.top + 1 || status.bottom > innerHeight + 1)
            errors.push('지도 또는 하단 영역 잘림')
          for (const button of root.querySelectorAll(
            '.ribbon-group .v-btn, .selected-actions .v-btn',
          )) {
            const text = document.createRange()
            text.selectNodeContents(button.querySelector('.v-btn__content'))
            const box = button.getBoundingClientRect()
            const area =
              button.closest('.selected-actions')?.getBoundingClientRect() ??
              ribbon.getBoundingClientRect()
            for (const fragment of text.getClientRects()) {
              if (
                fragment.width &&
                (fragment.left < box.left - 1 ||
                  fragment.right > box.right + 1 ||
                  fragment.top < box.top - 1 ||
                  fragment.bottom > box.bottom + 1 ||
                  fragment.top < area.top - 1 ||
                  fragment.bottom > area.bottom + 1)
              )
                errors.push(button.textContent.trim())
            }
          }
          return errors
        })
        assert.deepEqual(clipped, [], `${theme} ${width}px ${name.trim()} 레이블과 레이아웃`)
      }
      if (width === 1120) {
        for (const name of ['File', 'Data']) {
          await tabList.getByRole('tab', { name, exact: true }).click()
          await page.screenshot({ path: path.join(output, `${theme}-${name}.png`), scale: 'css' })
        }
      }
    }
  }
  await tabList.getByRole('tab', { name: 'File', exact: true }).click()
  if ((await page.locator('html').getAttribute('data-theme')) !== originalTheme)
    await themeToggle.click()
  await page.setViewportSize({ width: 1560, height: 980 })
  await page.evaluate(() => document.activeElement?.blur())
  await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/model/editor.ts')
    const { emptyDocument } = await import('/src/entities/map/model/map.ts')
    const map = emptyDocument()
    map.nodes = [
      { id: 1, name: 'N1', x: 0, y: 0 },
      { id: 2, name: 'N2', x: 1300, y: 0, direction: 1 },
      { id: 3, name: 'N3', x: 2600, y: 0, direction: 1 },
      { id: 4, name: 'N4', x: 2900, y: 160, curve: true, virtual: true },
      { id: 5, name: 'N5', x: 3050, y: 420, curve: true, virtual: true },
      { id: 6, name: 'N6', x: 3050, y: 900 },
    ]
    map.edges = [
      { id: 'a', from: 1, to: 2, direction: 0 },
      { id: 'b', from: 2, to: 3, direction: 1 },
      { id: 'c', from: 3, to: 4, direction: 0, drivingType: 2 },
      { id: 'd', from: 4, to: 5, direction: 0, drivingType: 2 },
      { id: 'e', from: 5, to: 6, direction: 0, drivingType: 2 },
    ]
    map.ports = [
      { id: 'P1', nodeId: 1, name: '입고', x: 400, y: 550, width: 490, height: 310 },
      { id: 'P2', nodeId: 3, name: '출고', x: 2000, y: 620, width: 490, height: 310 },
    ]
    const editor = useEditor()
    editor.load(JSON.stringify(map), 'topology-preview.tsmgs.json')
    editor.selectedPortId = 'P2'
  })
  for (const theme of ['light', 'dark']) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) await themeToggle.click()
    await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme)
    await page.screenshot({
      path: path.join(output, `topology-${theme}.png`),
      scale: 'css',
      animations: 'disabled',
    })
  }
  if ((await page.locator('html').getAttribute('data-theme')) !== originalTheme)
    await themeToggle.click()
  await page.evaluate(() => document.activeElement?.blur())
  await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/model/editor.ts')
    const { emptyDocument } = await import('/src/entities/map/model/map.ts')
    const map = emptyDocument()
    map.nodes = [
      { id: 1, name: 'N1', x: 90000000, y: 90000000, direction: 0 },
      { id: 2, name: 'N2', x: 90030000, y: 90000000, direction: 1 },
      { id: 3, name: 'N3', x: 90060000, y: 90000000, virtual: true },
      { id: 4, name: 'N4', x: 90090000, y: 90000000, curve: true },
    ]
    useEditor().load(JSON.stringify(map), 'node-pointer.tsmgs.json')
  })
  await page.evaluate(() => {
    window.__mapView.zoomBy(0.001)
    window.__mapView.camera.updateMatrixWorld()
  })
  const nodePoint = (index) =>
    page.evaluate((index) => {
      const { camera, scene, renderer } = window.__mapView
      const mesh = scene.getObjectByName('nodes')
      const matrix = mesh.instanceMatrix.array
      const point = mesh.position.clone()
      point.x += matrix[index * 16 + 12]
      point.y += matrix[index * 16 + 13]
      point.project(camera)
      const rect = renderer.domElement.getBoundingClientRect()
      return {
        x: rect.left + ((point.x + 1) * rect.width) / 2,
        y: rect.top + ((1 - point.y) * rect.height) / 2,
      }
    }, index)
  const selected = () =>
    page.evaluate(async () => {
      const { useEditor } = await import('/src/features/map-editor/model/editor.ts')
      const { selectedId, selectedIds } = useEditor()
      return { id: selectedId, ids: [...selectedIds] }
    })
  const firstNode = await nodePoint(0)
  await page.mouse.click(firstNode.x + 3, firstNode.y)
  assert.deepEqual(await selected(), { id: 1, ids: [] })
  const secondNode = await nodePoint(1)
  await page.mouse.move(secondNode.x - 2, secondNode.y)
  await page.mouse.down()
  await page.mouse.move(secondNode.x, secondNode.y, { steps: 2 })
  await page.mouse.up()
  assert.deepEqual(await selected(), { id: 2, ids: [] })
  const virtualNode = await nodePoint(2)
  const curveNode = await nodePoint(3)
  await page.mouse.click(virtualNode.x, virtualNode.y)
  await page.mouse.click(curveNode.x, curveNode.y)
  assert.deepEqual(await selected(), { id: 3, ids: [] })
  await page.mouse.move(firstNode.x - 8, firstNode.y - 12)
  await page.mouse.down()
  await page.mouse.move(secondNode.x + 8, secondNode.y + 12, { steps: 6 })
  await page.mouse.up()
  assert.deepEqual(await selected(), { id: null, ids: [1, 2] })
  await page.mouse.move(secondNode.x + 8, secondNode.y - 12)
  await page.mouse.down()
  await page.mouse.move(secondNode.x - 8, secondNode.y + 12, { steps: 6 })
  await page.mouse.up()
  assert.deepEqual(await selected(), { id: null, ids: [1] })
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
    const bidirectional = {
      ...source,
      nodes: [source.nodes[0], { ...source.nodes[1], curve: false }],
      edges: [
        {
          id: 'E1',
          from: 1,
          to: 2,
          direction: 1,
          controls: { forward: { vehicleDegree: 0 }, backward: { vehicleDegree: 0, reverse: 1 } },
        },
      ],
    }
    const directional = createMapTopology(bidirectional)
    const planar = createMapTopology(bidirectional, undefined, true)
    const hasCenteredDiamond = (topology, expectedRatio) => {
      const geometry = topology.group.getObjectByName('arrows').geometry
      const corners = geometry.getAttribute('position')
      const halfLength = corners.getX(0)
      const halfWidth = corners.getY(1)
      return (
        corners.count === 4 &&
        [...geometry.index.array].join(',') === '0,1,2,0,2,3' &&
        halfLength > 0 &&
        halfWidth > 0 &&
        Math.abs(halfLength / halfWidth - expectedRatio) < 0.00001 &&
        corners.getY(0) === 0 &&
        corners.getX(1) === 0 &&
        corners.getX(2) === -halfLength &&
        corners.getY(2) === 0 &&
        corners.getX(3) === 0 &&
        corners.getY(3) === -halfWidth
      )
    }
    const headings = directional.group.getObjectByName('vehicle-headings')
    const heading = headings.geometry.getAttribute('position')
    const result = {
      unchanged: before === JSON.stringify(source),
      origin: topology.nodeMesh.position.x,
      localX: topology.nodeMesh.instanceMatrix.array[28],
      curveRadiusMm: topology.group.getObjectByName('node-borders').instanceMatrix.array[16] * 25,
      markerLength: arrows.getX(0) - arrows.getX(1),
      markerHalfWidth: Math.abs(arrows.getY(0)),
      nodeCentered: arrows.getX(0) === 0 && arrows.getX(2) === 0 && arrows.getX(1) < 0,
      diamond3D: hasCenteredDiamond(directional, 3),
      diamond2D: hasCenteredDiamond(planar, 3),
      vehicle:
        !headings.visible &&
        heading.count === 6 &&
        heading.getX(0) > heading.getX(1) &&
        heading.getX(3) < heading.getX(4),
      portFill: topology.portMesh.geometry
        .getAttribute('position')
        .array.some((z, index) => index % 3 === 2 && z === 95),
    }
    for (const { group } of [topology, directional, planar])
      group.traverse((object) => {
        object.geometry?.dispose()
        if (object.material)
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            material.dispose()
        if (object.isInstancedMesh) object.dispose()
      })
    return result
  })
  assert.ok(precision.unchanged)
  assert.equal(precision.origin, 900000000)
  assert.equal(precision.localX, 1000)
  assert.ok(Math.abs(precision.curveRadiusMm - 17.5) < 0.00001)
  assert.ok(Math.abs(precision.markerLength - 600) < 0.001)
  assert.ok(Math.abs(precision.markerHalfWidth - 200) < 0.00001)
  assert.ok(precision.nodeCentered && precision.portFill)
  assert.ok(precision.diamond3D && precision.diamond2D && precision.vehicle)
  /** 원본 MGS의 노드 기준 삼각형과 마름모를 모든 연결 방향 및 노드 종류에서 대조 검증 */
  const directions = await page.evaluate(async () => {
    const { createMapTopology } = await import('/src/entities/map/lib/createMapTopology.ts')
    const { mgsTheme } = await import('/src/entities/map/model/view.ts')
    let cases = 0
    const failures = []
    for (const themeName of ['light', 'dark']) {
      const theme = mgsTheme('', themeName)
      for (const [dx, dy] of [
        [1000, 0],
        [-1000, 0],
        [0, 1000],
        [0, -1000],
        [900, 700],
        [-900, 700],
        [900, -700],
        [-900, -700],
        [20, 0],
        [0, 0],
      ]) {
        for (const direction of [0, 1]) {
          for (const flags of [{}, { virtual: true }, { noSendGoal: true }, { curve: true }]) {
            const source = {
              format: 'ts-mgs',
              version: 1,
              units: 'mm',
              name: 'MGS direction parity',
              nodes: [
                { id: 1, x: 100000000, y: -100000000, direction, ...flags },
                { id: 2, x: 100000000 + dx, y: -100000000 + dy },
              ],
              edges: [{ id: 'E1', from: 1, to: 2, direction }],
              ports: [],
            }
            const angle = Math.atan2(dy, dx)
            const side = theme.arrowSize
            const expected =
              !flags.curve && (dx || dy)
                ? direction === 1
                  ? [
                      [3 * side, 0],
                      [0, side],
                      [-3 * side, 0],
                      [0, -side],
                    ]
                  : [
                      [0, -side],
                      [-3 * side, 0],
                      [0, side],
                    ]
                : []
            for (const planar of [false, true]) {
              const { group } = createMapTopology(source, theme, planar)
              const geometry = group.getObjectByName('arrows').geometry
              const vertices = geometry.getAttribute('position')
              if (vertices.count !== expected.length) failures.push('표식 개수')
              expected.forEach(([forward, lateral], index) => {
                const x = Math.cos(angle) * forward - Math.sin(angle) * lateral
                const y = Math.sin(angle) * forward + Math.cos(angle) * lateral
                if (
                  Math.abs(vertices.getX(index) - x) > 0.001 ||
                  Math.abs(vertices.getY(index) - y) > 0.001
                )
                  failures.push(`${themeName} ${dx} ${dy} ${direction} ${planar}`)
              })
              group.traverse((object) => {
                object.geometry?.dispose()
                object.material?.dispose()
                if (object.isInstancedMesh) object.dispose()
              })
              cases++
            }
          }
        }
      }
    }
    return { cases, failures }
  })
  assert.deepEqual(directions.failures, [])
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
  assert.equal(topology.radius, 50)
  assert.equal(topology.nodes, 8000)
  assert.equal(topology.canvas, topology.labels)
  assert.equal(topology.far, 20000)
  assert.ok(topology.meshState.length >= 7)
  const drawOrder = new Map(topology.meshState.map(({ name, order }) => [name, order]))
  assert.ok(drawOrder.get('ports') < drawOrder.get('edges'))
  assert.ok(drawOrder.get('edges') < drawOrder.get('arrows'))
  assert.ok(drawOrder.get('arrows') < drawOrder.get('node-borders'))
  assert.ok(drawOrder.get('node-borders') < drawOrder.get('nodes'))
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
  assert.ok(movement.cache && movement.geometry && movement.panned, JSON.stringify(movement))
  assert.equal(movement.smallText, 0)
  assert.ok(movement.frames >= 20)
  await page.screenshot({ path: path.join(output, 'map-light.png') })
  await page.getByTestId('theme-toggle').click()
  await page.waitForTimeout(100)
  await page.screenshot({ path: path.join(output, 'map-dark.png') })
  /** 동일한 지도 배율에서 평면 화면의 실제 원형 노드 표시 반경 기록 */
  const nodeSize2D = await page.evaluate(() => {
    const view = window.__mapView
    return [0.01, 0.05, 0.15].map((pixelsPerMm) => {
      const current = (view.camera.zoom * view.renderer.domElement.clientHeight) / 8000
      view.zoomBy(pixelsPerMm / current)
      const border = view.scene.getObjectByName('node-borders')
      const radiusMm = border.geometry.getAttribute('position').getX(1)
      return { pixelsPerMm, radiusMm, radiusPixels: radiusMm * pixelsPerMm }
    })
  })
  await page.getByTestId('mode-facility').click()
  await page.waitForFunction(() => !!window.__facilityView)
  /** 삼차원 카메라의 동일 배율에서 평면 화면과 최소 노드 반경 및 확대 비율 대조 검증 */
  const nodeSize3D = await page.evaluate(async (samples) => {
    const view = window.__facilityView
    const results = []
    for (const { pixelsPerMm } of samples) {
      const distance =
        (view.renderer.domElement.clientHeight * view.camera.projectionMatrix.elements[5]) /
        (2 * pixelsPerMm * 1000)
      view.controls.target.set(0, 0, 0)
      view.camera.position.set(0, 0, distance)
      view.controls.update()
      view.requestRender()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const border = view.ground.getObjectByName('node-borders')
      const radiusMm = border.geometry.getAttribute('position').getX(1)
      const center = view.camera.position.clone().set(0, 0, 0).project(view.camera)
      const edge = view.camera.position
        .clone()
        .set(radiusMm / 1000, 0, 0)
        .project(view.camera)
      const radiusPixels = Math.hypot(
        ((edge.x - center.x) * view.renderer.domElement.clientWidth) / 2,
        ((edge.y - center.y) * view.renderer.domElement.clientHeight) / 2,
      )
      results.push({ pixelsPerMm, radiusMm, radiusPixels })
    }
    return results
  }, nodeSize2D)
  nodeSize2D.forEach((sample, index) => {
    assert.ok(Math.abs(sample.radiusMm - nodeSize3D[index].radiusMm) < 0.001)
    assert.ok(Math.abs(sample.radiusPixels - nodeSize3D[index].radiusPixels) < 0.001)
    assert.ok(Math.abs(sample.radiusPixels - Math.max(2.5, 50 * sample.pixelsPerMm)) < 0.001)
  })
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
  let glbBounds
  if (!directionsOnly) {
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
    glbBounds = await page.evaluate(() => {
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
  }
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
    await page.getByTestId('mode-facility').click()
    await page.waitForFunction(() => window.__facilityView.renderer.domElement.isConnected)
    /** 실제 지도 원본의 연결 레코드를 MGS 표식 공식으로 변환해 삼차원 정점과 직접 대조 검증 */
    sourceMap.directions = await page.evaluate((content) => {
      const rows = content.replace(/^\uFEFF/, '').split(/\r?\n/)
      const count = Number(rows[1].split('\t')[0])
      const records = rows.slice(2, count + 2).map((row) => row.split('\t').map(Number))
      const byId = new Map(records.map((record) => [record[0], record]))
      const view = window.__facilityView
      const arrows = view.ground.getObjectByName('arrows')
      const vertices = arrows.geometry.getAttribute('position')
      const side = view.theme().arrowSize
      const seen = new Set()
      let vertex = 0
      let markers = 0
      let maximumErrorMm = 0
      for (const node of records) {
        const connection = byId.get(node[14])
        const key = `${node[0]}-${node[14]}`
        if (!connection || node[0] === node[14] || seen.has(key)) continue
        seen.add(key)
        const dx = connection[1] - node[1]
        const dy = connection[2] - node[2]
        if (node[11] || !side || (!dx && !dy)) continue
        const angle = Math.atan2(dy, dx)
        const points =
          node[3] === 1
            ? [
                [3 * side, 0],
                [0, side],
                [-3 * side, 0],
                [0, -side],
              ]
            : [
                [0, -side],
                [-3 * side, 0],
                [0, side],
              ]
        for (const [forward, lateral] of points) {
          const x = node[1] + Math.cos(angle) * forward - Math.sin(angle) * lateral
          const y = node[2] + Math.sin(angle) * forward + Math.cos(angle) * lateral
          maximumErrorMm = Math.max(
            maximumErrorMm,
            Math.abs(vertices.getX(vertex) + arrows.position.x - x),
            Math.abs(vertices.getY(vertex) + arrows.position.y - y),
          )
          vertex++
        }
        markers++
      }
      return { markers, expectedVertices: vertex, renderedVertices: vertices.count, maximumErrorMm }
    }, file.content)
    assert.equal(sourceMap.directions.expectedVertices, sourceMap.directions.renderedVertices)
    assert.ok(sourceMap.directions.maximumErrorMm < 0.01, JSON.stringify(sourceMap.directions))
    await page.getByRole('button', { name: '위에서 보기', exact: true }).click()
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    await page.screenshot({ path: path.join(output, 'source-map-3d.png') })
  }
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      nodes: 8000,
      nodeRadiusMm: topology.radius,
      precision,
      directions,
      nodeSize2D,
      nodeSize3D,
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
