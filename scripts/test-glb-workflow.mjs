import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const {
  chromium,
} = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const output = path.resolve(process.env.TS_MGS_GLB_TEST_OUT || 'artifacts/glb-e2e')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const errors = []
try {
  const page = await browser.newPage({
    viewport: { width: 1536, height: 960 },
    acceptDownloads: true,
  })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /THREE.WebGLProgram|VALIDATE_STATUS/.test(message.text()))
      errors.push(message.text())
  })
  page.on('dialog', (dialog) => void dialog.accept())
  await page.goto('http://127.0.0.1:5180/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByTestId('mode-facility').waitFor()
  await page.evaluate(async () => {
    const code = await (await fetch('/src/widgets/facility-studio/lib/FacilityScene.ts')).text()
    const url = code.match(/import \* as THREE from "([^"]+)"/)[1]
    const THREE = await import(url)
    const previous = THREE.Scene.prototype.onBeforeRender
    THREE.Scene.prototype.onBeforeRender = (renderer, scene, camera, ...rest) => {
      if (scene.children.some(({ type }) => type === 'GridHelper'))
        window.__facilityView = { THREE, scene, camera, renderer }
      if (camera.isOrthographicCamera && renderer.domElement.getAttribute('aria-label')?.startsWith('지도 편집 영역'))
        window.__mapView = { THREE, camera, renderer }
      if (scene.name === 'facility-selection-mask') window.__selectedMask = scene
      if (scene.name === 'glb-import-preview') window.__glbPreviewCamera = camera.position.toArray()
      Reflect.apply(previous, scene, [renderer, scene, camera, ...rest])
    }
  })
  await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/model/editor.ts')
    useEditor().load(
      JSON.stringify({
        format: 'ts-mgs',
        version: 1,
        name: 'GLB cross-app fixture',
        units: 'mm',
        nodes: Array.from({ length: 35 }, (_, i) => ({
          id: i + 1,
          x: (i % 7) * 6000,
          y: Math.floor(i / 7) * 6000,
          name: `N${i + 1}`,
        })),
        edges: [],
        ports: Array.from({ length: 16 }, (_, i) => ({
          id: `PORT-${i + 1}`,
          name: 'Fixture',
          nodeId: i + 1,
          x: 1000 + (i % 8) * 4300,
          y: 7000 + Math.floor(i / 8) * 6500,
        })),
      }),
      'glb-fixture.tsmgs.json',
    )
  })
  const assertSamePan = async (view) => {
    await page.waitForFunction((view) => !!window[view]?.renderer.domElement.isConnected, view)
    const state = () => page.evaluate((view) => {
      const { THREE, camera, renderer } = window[view]
      const rect = renderer.domElement.getBoundingClientRect()
      return {
        x: rect.left + rect.width * 0.42, y: rect.top + rect.height * 0.46,
        position: camera.position.toArray(), zoom: camera.zoom,
        direction: camera.getWorldDirection(new THREE.Vector3()).toArray(),
      }
    }, view)
    const before = await state()
    const drag = async (button) => {
      await page.mouse.move(before.x, before.y)
      await page.mouse.down({ button })
      await page.mouse.move(before.x + 63, before.y + 37, { steps: 5 })
      await page.mouse.up({ button })
      return state()
    }
    const middle = await drag('middle')
    await page.keyboard.down('Space')
    const space = await drag('left')
    await page.keyboard.up('Space')
    const middleDelta = middle.position.map((value, i) => value - before.position[i])
    const spaceDelta = space.position.map((value, i) => value - middle.position[i])
    assert.ok(Math.hypot(...middleDelta) > 0.01)
    assert.ok(Math.hypot(...spaceDelta.map((value, i) => value - middleDelta[i])) < 0.0001)
    assert.equal(middle.zoom, before.zoom)
    assert.ok(Math.hypot(...middle.direction.map((value, i) => value - before.direction[i])) < 0.0001)
  }
  await assertSamePan('__mapView')
  await page.getByTestId('mode-facility').click()
  await page.waitForFunction(() =>
    window.__facilityView?.renderer.domElement.nextElementSibling instanceof HTMLCanvasElement,
  )
  await assertSamePan('__facilityView')
  const ribbon = page.getByRole('tablist', { name: '3D 작업 메뉴' })
  const selectRibbon = (name) => ribbon.getByRole('tab', { name, exact: true }).click()
  /** 현재 리본을 복원하면서 이동한 명령을 실행하는 회귀 검사 */
  const ribbonCommand = async (name, id) => {
    const previous = (await ribbon.getByRole('tab', { selected: true }).textContent()).trim()
    await selectRibbon(name)
    await page.getByTestId(id).click()
    await selectRibbon(previous)
  }
  const facilityCanvas = page.getByTestId('facility-canvas')
  await page.evaluate(() => { window.__ribbonBaseline = window.__facilityView })
  for (const name of ['File', 'View', 'Building', 'Lighting', 'Tools', 'Facility']) {
    await selectRibbon(name)
    await page.getByRole('tabpanel', { name: name + ' 명령' }).waitFor()
  }
  const canvasWidth = (await facilityCanvas.boundingBox()).width
  await page.getByTestId('context-toggle').click()
  assert.ok((await facilityCanvas.boundingBox()).width > canvasWidth)
  await page.getByTestId('context-toggle').click()
  await page.getByTestId('inspector-toggle').click()
  assert.ok((await facilityCanvas.boundingBox()).width > canvasWidth)
  await page.getByTestId('inspector-toggle').click()
  const divider = page.getByRole('separator', { name: '작업 설정 너비' })
  const dividerBox = await divider.boundingBox()
  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + 40)
  await page.mouse.down()
  await page.mouse.move(dividerBox.x + dividerBox.width / 2 + 32, dividerBox.y + 40)
  await page.mouse.up()
  assert.equal(await divider.getAttribute('aria-valuenow'), '252')
  assert.ok((await facilityCanvas.boundingBox()).width < canvasWidth)
  await divider.press('ArrowLeft')
  await divider.press('ArrowLeft')
  assert.equal(await divider.getAttribute('aria-valuenow'), '220')
  await page.waitForFunction(() => {
    const { renderer, scene, camera } = window.__facilityView
    const previous = window.__ribbonBaseline
    return previous.renderer === renderer && previous.scene === scene && previous.camera === camera &&
      Math.abs(camera.aspect - renderer.domElement.clientWidth / renderer.domElement.clientHeight) < 0.005
  })
  await page.evaluate(() => {
    const { renderer } = window.__facilityView
    const context = renderer.domElement.nextElementSibling.getContext('2d')
    const { clearRect, fillText } = context
    window.__rulerText = []
    context.clearRect = function (...args) {
      window.__rulerText = []
      window.__rulerFromAbove = window.__facilityView.camera.matrixWorld.elements[10] > 0.99999
      Reflect.apply(clearRect, this, args)
    }
    context.fillText = function (text, x, y, ...args) {
      if (y === 10 && (/^[XY] · mm$/.test(text) || /^-?[\d,]+$/.test(text)))
        window.__rulerText.push({ text, pixel: x, vertical: Math.abs(this.getTransform().b) > 0.5 })
      Reflect.apply(fillText, this, [text, x, y, ...args])
    }
  })
  await page.getByTestId('scene-top').click()
  await page.waitForFunction(() => window.__rulerFromAbove && window.__rulerText.length > 4)
  const rulerText = await page.evaluate(() => window.__rulerText)
  assert.ok(rulerText.some((tick) => tick.text === 'X · mm' && !tick.vertical))
  assert.ok(rulerText.some((tick) => tick.text === 'Y · mm' && tick.vertical))
  const rulerAccuracy = await page.evaluate((ticks) => {
    const { THREE, renderer, camera } = window.__facilityView
    const { width, height } = renderer.domElement.getBoundingClientRect()
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
    const ray = new THREE.Raycaster()
    return ticks.filter(({ text }) => /^-?[\d,]+$/.test(text)).map(({ text, pixel, vertical }) => {
      const x = vertical ? 24 : pixel
      const y = vertical ? height - pixel : 24
      ray.setFromCamera(new THREE.Vector2(2 * x / width - 1, 1 - 2 * y / height), camera)
      const hit = ray.ray.intersectPlane(plane, new THREE.Vector3())
      return { vertical, error: Math.abs(hit[vertical ? 'y' : 'x'] * 1000 - Number(text.replaceAll(',', ''))) }
    })
  }, rulerText)
  assert.ok(rulerAccuracy.some(({ vertical }) => vertical))
  assert.ok(rulerAccuracy.some(({ vertical }) => !vertical))
  assert.ok(rulerAccuracy.every(({ error }) => error < 0.1), JSON.stringify(rulerAccuracy))
  const canvasBounds = await page.locator('canvas[data-engine]').boundingBox()
  await page.mouse.move(canvasBounds.x + canvasBounds.width / 2, canvasBounds.y + canvasBounds.height / 2)
  await page.mouse.wheel(0, -240)
  await page.waitForFunction((previous) => JSON.stringify(window.__rulerText) !== previous, JSON.stringify(rulerText))

  const gridToggle = page.getByTestId('facility-grid-toggle')
  const gridState = () => page.evaluate(() => {
    const grid = window.__facilityView.scene.children.find(({ type }) => type === 'GridHelper')
    const minor = grid.getObjectByName('minor-grid')
    return {
      visible: grid.visible,
      vertexColors: grid.material.vertexColors,
      minorVisible: grid.visible && minor.visible,
      minorStep: minor.material.uniforms.stepMeters.value,
      sharedColor: minor.material.uniforms.gridColor.value === grid.material.color,
    }
  })
  const visibleGrid = { visible: true, vertexColors: false, minorVisible: true, minorStep: 0.1, sharedColor: true }
  assert.deepEqual(await gridState(), visibleGrid)
  await gridToggle.click()
  assert.equal(await gridToggle.getAttribute('aria-pressed'), 'false')
  assert.deepEqual(await gridState(), { ...visibleGrid, visible: false, minorVisible: false })
  assert.ok(await page.evaluate(() => window.__rulerText.some(({ text }) => text === 'X · mm')))
  await gridToggle.click()
  assert.equal(await gridToggle.getAttribute('aria-pressed'), 'true')
  assert.deepEqual(await gridState(), visibleGrid)
  await page.getByTestId('scene-fit').click()

  await page.getByTestId('default-catalog').click()
  await page.getByTestId('catalog-register-defaults').click()
  await page.waitForFunction(
    async () =>
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().document
        .assets.length === 23,
  )
  assert.equal(await page.locator('.facility-library').count(), 0)
  await page.getByTestId('default-catalog').click()
  await page.getByTestId('catalog-model-ceram-mp5-storage-rack').click()
  await page.getByTestId('placement-port').selectOption('PORT-1')
  await page.getByTestId('place-port').click()
  await page.getByTestId('direct-transform').waitFor()
  await page.waitForFunction(() => {
    let loaded = false
    window.__facilityView?.scene.traverse((object) => {
      const material = object.material
      if (material?.name === 'rackDeck' && material.map?.image?.width === 128) loaded = true
    })
    return loaded
  })
  await page.waitForTimeout(500)
  await page.getByTestId('selection-focus').click()
  await page.screenshot({ path: path.join(output, 'rack-two-tiers.png') })
  const modelPoint = await page.evaluate(async () => {
    const { THREE, scene, camera, renderer } = window.__facilityView
    const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
    const { x, y, z } = useFacilityEditor().selected.position
    const position = new THREE.Vector3(x / 1000, y / 1000, z / 1000)
    renderer.render(scene, camera)
    const p = position
      .clone()
      .add(new THREE.Vector3(1.2, -1.2, 2))
      .project(camera)
    const rect = renderer.domElement.getBoundingClientRect()
    ;(
      await import('/src/features/facility-editor/model/studio.ts')
    ).useFacilityEditor().selectedId = null
    return { x: rect.x + ((p.x + 1) * rect.width) / 2, y: rect.y + ((1 - p.y) * rect.height) / 2 }
  })
  await page.getByTestId('tool-select').click()
  await page.mouse.click(modelPoint.x, modelPoint.y)
  await page.getByTestId('direct-transform').waitFor()
  /** 화면에 붙은 편집 핸들의 실제 포인터 드래그 */
  const dragHandle = async (name, dx, dy) => {
    const bounds = await page.getByTestId('direct-' + name).boundingBox()
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y + dy, { steps: 10 })
    await page.mouse.up()
  }
  await page.mouse.move(modelPoint.x, modelPoint.y)
  await page.mouse.down()
  await page.mouse.move(modelPoint.x + 65, modelPoint.y, { steps: 10 })
  await page.mouse.up()
  const moved = await page.evaluate(async () =>
    structuredClone(
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().selected,
    ),
  )
  assert.notEqual(moved.position.x, 1000)
  assert.equal(moved.position.x % 100, 0)
  assert.equal(moved.position.y % 100, 0)
  assert.equal(moved.portOffset.x, moved.position.x - 1000)
  assert.equal(
    Number(await page.getByTestId('instance-x').locator('input').inputValue()),
    moved.position.x,
  )
  await dragHandle('se', 30, 25)
  const scaled = await page.evaluate(async () =>
    structuredClone(
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().selected,
    ),
  )
  assert.ok(scaled.scale.x > 1 && scaled.scale.x < 3, JSON.stringify(scaled))
  assert.ok(Math.abs(scaled.scale.x - scaled.scale.y) < 0.00001)
  assert.ok(
    Math.abs(
      Number(await page.getByTestId('instance-size-x').locator('input').inputValue()) -
        scaled.scale.x * 2500,
    ) < 0.00001,
  )
  await dragHandle('x', 30, 0)
  const axisScaled = await page.evaluate(async () =>
    structuredClone(
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().selected,
    ),
  )
  assert.ok(Math.abs(axisScaled.scale.x - scaled.scale.x) > 0.01)
  assert.ok(Math.abs(axisScaled.scale.x * 25 - Math.round(axisScaled.scale.x * 25)) < 0.00001)
  assert.equal(axisScaled.scale.y, scaled.scale.y)
  assert.equal(axisScaled.scale.z, scaled.scale.z)
  const fixedRackEdge = (placement) => placement.position.x - 1250 * placement.scale.x
  assert.ok(Math.abs(fixedRackEdge(axisScaled) - fixedRackEdge(scaled)) < 0.001)
  assert.ok(Math.abs(axisScaled.portOffset.x - (axisScaled.position.x - 1000)) < 0.001)
  await page.getByTestId('scene-undo').click()
  await page.getByTestId('scene-redo').click()
  await page.evaluate(async () => {
    const store = (
      await import('/src/features/facility-editor/model/studio.ts')
    ).useFacilityEditor()
    store.setAsset({ ...store.document.assets[0], name: '기존 보관랙' }, store.document.mapRef)
  })
  await page.getByTestId('default-catalog').click()
  await page.getByTestId('catalog-register-defaults').click()
  const refreshed = await page.evaluate(async () =>
    structuredClone(
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().document,
    ),
  )
  assert.equal(refreshed.assets.length, 23)
  assert.equal(refreshed.assets[0].name, '보관 랙 · 2단')
  assert.deepEqual(refreshed.instances[0], axisScaled)
  await page.locator('.facility-explorer .facility-row').first().click()
  for (const [field, value] of [
    ['x', '2500'],
    ['y', '8000'],
    ['z', '100'],
    ['size-x', '3750'],
    ['size-y', '2000'],
    ['size-z', '4620'],
  ])
    await page.getByTestId(`instance-${field}`).locator('input').fill(value)
  await page
    .locator('.facility-form')
    .getByText('Z축 회전 °', { exact: true })
    .locator('input')
    .fill('90')
  await page.getByTestId('instance-apply').click()
  const first = await page.evaluate(async () =>
    structuredClone(
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().selected,
    ),
  )
  assert.deepEqual(first.scale, { x: 1.5, y: 0.8, z: 1.2 })
  assert.deepEqual(first.position, { x: 2500, y: 8000, z: 100 })
  assert.equal(first.rotation, 90)
  await page.getByTestId('scene-undo').click()
  await page.getByTestId('scene-redo').click()
  await page.getByTestId('default-catalog').click()
  const catalog = page.getByTestId('model-catalog')
  const viewport = page.getByTestId('facility-canvas')
  const panelBox = await catalog.boundingBox()
  const mapBox = await viewport.boundingBox()
  assert.ok(panelBox.x >= mapBox.x + mapBox.width - 1)
  const dialog = page.getByTestId('glb-import-dialog')
  const nameInput = page.getByTestId('glb-name').locator('input')
  const registerGlb = page.getByTestId('glb-register')
  const chooseGlb = async (file) => {
    await page.getByTestId('glb-import').click()
    await dialog.waitFor()
    await page.getByTestId('glb-file').setInputFiles(path.resolve(`public/models/ceram-mp5/${file}.glb`))
    await dialog.getByTestId('glb-preview-canvas').waitFor()
  }
  await chooseGlb('robot')
  await page.waitForFunction(() => !!window.__glbPreviewCamera)
  assert.match(await dialog.getByTestId('glb-preview-size').textContent(), /mm/)
  const previewView = await page.evaluate(() => window.__glbPreviewCamera)
  const previewBounds = await dialog.getByTestId('glb-preview-canvas').boundingBox()
  await page.mouse.move(previewBounds.x + previewBounds.width / 2, previewBounds.y + previewBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(previewBounds.x + previewBounds.width / 2 + 45, previewBounds.y + previewBounds.height / 2 + 15, { steps: 5 })
  await page.mouse.up()
  await page.waitForFunction((initial) => window.__glbPreviewCamera.some((value, index) => Math.abs(value - initial[index]) > 0.05), previewView)
  await page.screenshot({ path: path.join(output, 'glb-registration-preview.png') })
  assert.equal(await nameInput.inputValue(), 'robot')
  await nameInput.fill('Catalog Robot')
  await registerGlb.click()
  await dialog.waitFor({ state: 'hidden' })

  await chooseGlb('crate')
  await nameInput.fill('  CATALOG ROBOT  ')
  await dialog.getByText('같은 이름의 모델이 이미 있습니다.').waitFor()
  assert.equal(await registerGlb.isDisabled(), true)
  await nameInput.fill('삭제 검증 모델 A')
  await registerGlb.click()
  await dialog.waitFor({ state: 'hidden' })
  await chooseGlb('crate')
  await nameInput.fill('삭제 검증 모델 B')
  await registerGlb.click()
  await dialog.waitFor({ state: 'hidden' })

  const model = await page.evaluate(async () => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
    const { id, name, glb } = useFacilityEditor().document.assets.find(({ name }) => name === 'Catalog Robot')
    return { id, name, sourceName: glb.sourceName }
  })
  assert.match(model.id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
  assert.equal(model.sourceName, 'robot.glb')
  await page.getByTestId('scene-fit').click()
  const dragModelTo = async (x, y, assetId = model.id) => {
    const targetPosition = await page.evaluate(({ x, y }) => {
      const { renderer, camera, THREE } = window.__facilityView
      camera.updateMatrixWorld()
      const point = new THREE.Vector3(x / 1000, y / 1000, 0).project(camera)
      const { width, height } = renderer.domElement.getBoundingClientRect()
      return { x: ((point.x + 1) * width) / 2, y: ((1 - point.y) * height) / 2 }
    }, { x, y })
    await catalog
      .getByTestId(`catalog-model-${assetId}`)
      .dragTo(viewport.locator('canvas[data-engine]'), { targetPosition })
    return page.evaluate(async () => {
      const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
      return structuredClone(useFacilityEditor().selected)
    })
  }
  const floorPlacement = await dragModelTo(21000, 11900)
  assert.equal(floorPlacement.assetId, model.id)
  assert.equal(floorPlacement.portId, undefined)
  assert.ok(Math.abs(floorPlacement.position.x - 21000) < 150)
  assert.ok(Math.abs(floorPlacement.position.y - 11900) < 150)
  const portPlacement = await dragModelTo(5300, 13500)
  assert.equal(portPlacement.portId, 'PORT-10')
  assert.deepEqual(portPlacement.position, { x: 5300, y: 13500, z: 0 })
  await page.getByTestId('scene-undo').click()

  await catalog.getByTestId('catalog-select').click()
  assert.equal(await catalog.getByRole('checkbox', { name: /Catalog Robot/ }).isDisabled(), true)
  for (const name of ['삭제 검증 모델 A', '삭제 검증 모델 B']) {
    const checkbox = catalog.getByRole('checkbox', { name: new RegExp(name) })
    await checkbox.click()
    assert.equal(await checkbox.getAttribute('aria-checked'), 'true')
  }
  await catalog.getByTestId('catalog-delete').click()
  const assetCount = () => page.evaluate(async () =>
    (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().document.assets.length,
  )
  assert.equal(await assetCount(), 24)
  await page.getByTestId('scene-undo').click()
  assert.equal(await assetCount(), 26)
  await page.getByTestId('scene-redo').click()
  assert.equal(await assetCount(), 24)
  await catalog.getByTestId('catalog-close').click()
  await page.waitForFunction(
    async () =>
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().document
        .assets.length === 24,
  )
  await page.waitForTimeout(500)
  const snapshot = await page.evaluate(async () =>
    structuredClone(
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().document,
    ),
  )
  assert.equal(snapshot.instances.length, 2)
  assert.ok(snapshot.assets.every((asset) => asset.glb?.data))
  await page.getByTestId('scene-fit').click()
  await page.screenshot({ path: path.join(output, 'ts-mgs-glb-editor.png') })
  const downloads = []
  page.on('download', (download) => downloads.push(download))
  await ribbonCommand('File', 'scene-save')
  for (let count = 0; downloads.length < 1 && count < 50; count++) await page.waitForTimeout(100)
  assert.equal(downloads.length, 1)
  await downloads[0].saveAs(path.join(output, 'project.map3d.json'))
  const project = JSON.parse(await fs.readFile(path.join(output, 'project.map3d.json'), 'utf8'))
  assert.equal(project.format, 'bem-map3d')
  assert.equal(project.instances.length, 2)
  downloads.length = 0
  await ribbonCommand('File', 'scene-export')
  for (let count = 0; downloads.length < 2 && count < 50; count++) await page.waitForTimeout(100)
  assert.equal(downloads.length, 2)
  await Promise.all(
    downloads.map((download) => download.saveAs(path.join(output, download.suggestedFilename()))),
  )
  const layout = JSON.parse(await fs.readFile(path.join(output, 'map3d.json'), 'utf8'))
  const library = JSON.parse(await fs.readFile(path.join(output, 'equipment.json'), 'utf8'))
  assert.deepEqual(layout.instances[0].scale, first.scale)
  assert.equal(library.assets.length, 24)
  await fs.writeFile(
    path.join(output, 'expected.json'),
    JSON.stringify({ firstId: first.id, center: [-465, 72.3, 120], size: [60, 138.6, 112.5] }),
  )
  await page.locator('.facility-explorer .facility-row').first().click()
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await page.keyboard.press('Control+v')
  const copies = await page.evaluate(async () => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
    return structuredClone(useFacilityEditor().document.instances.slice(2))
  })
  assert.equal(copies.length, 2)
  for (const [index, copy] of copies.entries()) {
    assert.notEqual(copy.id, first.id)
    assert.equal(copy.assetId, first.assetId)
    assert.equal(copy.rotation, first.rotation)
    assert.deepEqual(copy.scale, first.scale)
    assert.deepEqual(copy.position, { x: 2500 + (index + 1) * 2300, y: 8000, z: 100 })
    assert.equal(copy.portId, undefined)
  }
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  assert.equal(await page.getByTestId('instance-count').textContent(), '2')
  await page.locator('.facility-explorer .facility-row').first().click()
  await page.getByTestId('instance-x').locator('input').focus()
  await page.keyboard.press('Control+v')
  assert.equal(await page.getByTestId('instance-count').textContent(), '2')
  await page.evaluate(async () => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
    const studio = useFacilityEditor()
    studio.setAsset(
      {
        id: 'dimensions-fixture',
        name: '사용자 모델 치수 검증',
        kind: 'equipment',
        parts: [
          {
            id: 'box',
            name: 'Box',
            shape: 'box',
            position: { x: 0, y: 0, z: 650 },
            size: { x: 1000, y: 2000, z: 1000 },
            rotation: 90,
            color: '#dddddd',
          },
          {
            id: 'cylinder',
            name: 'Cylinder',
            shape: 'cylinder',
            position: { x: 1250, y: 0, z: 400 },
            size: { x: 500, y: 1000, z: 500 },
            rotation: 0,
            color: '#dddddd',
          },
        ],
      },
      studio.document.mapRef,
    )
    studio.place(4000, 4000)
  })
  for (const [axis, mm] of [
    ['x', 2500],
    ['y', 1000],
    ['z', 1000],
  ])
    assert.equal(
      Number(await page.getByTestId(`instance-size-${axis}`).locator('input').inputValue()),
      mm,
    )
  await page.getByTestId('instance-size-x').locator('input').fill('3750')
  await page.getByTestId('instance-apply').click()
  const partScale = await page.evaluate(async () => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
    return useFacilityEditor().selected.scale
  })
  assert.equal(partScale.x, 1.5)
  assert.equal(partScale.y, 1)
  assert.equal(partScale.z, 1)
  await page.getByTestId('selection-focus').click()
  const sizeHandle = page.getByTestId('direct-z')
  // 선택 보기 이후 카메라 이동이 반영된 크기 조절 핸들 위치 확인
  await sizeHandle.hover()
  const heightControl = await sizeHandle.boundingBox()
  const dragX = heightControl.x + heightControl.width / 2
  const dragY = heightControl.y + heightControl.height / 2
  await page.mouse.move(dragX, dragY)
  await page.mouse.down()
  await page.mouse.move(dragX, dragY - 25, { steps: 5 })
  const placed = () =>
    page.evaluate(async () => {
      const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
      return structuredClone(useFacilityEditor().selected)
    })
  const beforeQuickResize = await placed()
  assert.equal(beforeQuickResize.scale.z, 1)
  await page.mouse.up()
  const resized = await placed()
  assert.equal(resized.scale.x, 1.5)
  assert.equal(resized.scale.y, 1)
  assert.ok(resized.scale.z > 1)
  assert.equal(resized.position.x, beforeQuickResize.position.x)
  assert.equal(resized.position.y, beforeQuickResize.position.y)
  const fixedBottom = (placement) => placement.position.z + 150 * placement.scale.z
  assert.ok(Math.abs(fixedBottom(resized) - fixedBottom(beforeQuickResize)) < 0.001)
  assert.equal(resized.rotation, beforeQuickResize.rotation)
  assert.ok(Math.abs(Number(await page.getByTestId('instance-size-z').locator('input').inputValue()) - resized.scale.z * 1000) < 0.001)
  await page.getByTestId('scene-undo').click()
  await page
    .locator('.facility-explorer')
    .getByRole('button', { name: /사용자 모델 치수 검증/ })
    .click()
  assert.deepEqual(await placed(), beforeQuickResize)
  await sizeHandle.press('Shift+ArrowRight')
  assert.equal((await placed()).scale.z, 1.1)
  assert.ok(Math.abs(fixedBottom(await placed()) - fixedBottom(beforeQuickResize)) < 0.001)
  const resizedHandle = await sizeHandle.boundingBox()
  const handleX = resizedHandle.x + resizedHandle.width / 2
  const handleY = resizedHandle.y + resizedHandle.height / 2
  await page.mouse.move(handleX, handleY)
  await page.mouse.down()
  await page.mouse.move(handleX, handleY - 20)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  assert.equal((await placed()).scale.z, 1.1)

  const worldCenter = (placement) => {
    const angle = placement.rotation * Math.PI / 180
    const centerX = 250 * placement.scale.x
    return {
      x: placement.position.x + centerX * Math.cos(angle),
      y: placement.position.y + centerX * Math.sin(angle),
    }
  }
  const centerBeforeRotation = worldCenter(await placed())
  await page.getByTestId('direct-rotate').press('Shift+ArrowRight')
  const afterRotation = await placed()
  const centerAfterRotation = worldCenter(afterRotation)
  assert.equal(afterRotation.rotation, 15)
  assert.ok(Math.hypot(centerAfterRotation.x - centerBeforeRotation.x, centerAfterRotation.y - centerBeforeRotation.y) < 0.001)

  const cameraPosition = await page.evaluate(() => window.__facilityView.camera.position.toArray())
  const canvasBox = await viewport.boundingBox()
  const cameraDragX = canvasBox.x + canvasBox.width / 2
  const cameraDragY = canvasBox.y + canvasBox.height / 2
  await page.mouse.move(cameraDragX, cameraDragY)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(cameraDragX + 120, cameraDragY + 25, { steps: 10 })
  await page.mouse.up({ button: 'right' })
  await page.waitForFunction((original) =>
    window.__facilityView.camera.position.toArray().some((value, index) => Math.abs(value - original[index]) > 0.1),
  cameraPosition)
  await page.getByTestId('direct-transform').waitFor()
  const highlight = await page.evaluate(() => ({
    maskParts: window.__selectedMask.children.length,
    boxBorder: getComputedStyle(document.querySelector('[data-testid=direct-transform]')).borderTopWidth,
  }))
  assert.deepEqual(highlight, { maskParts: 2, boxBorder: '0px' })
  assert.deepEqual(await placed(), afterRotation)

  const replaceLibrary = (assets) => page.evaluate(async (assets) => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
    const studio = useFacilityEditor()
    studio.load(JSON.stringify({ ...studio.document, instances: [], assets }), 'catalog-test.map3d.json')
  }, assets)
  await replaceLibrary([project.assets.find(({ id }) => id === model.id)])
  await page.getByTestId('default-catalog').click()
  await catalog.getByTestId('catalog-select').click()
  await catalog.getByRole('checkbox', { name: /Catalog Robot/ }).click()
  await catalog.getByTestId('catalog-delete').click()
  const [emptyDownload] = await Promise.all([
    page.waitForEvent('download'),
    ribbonCommand('File', 'scene-save'),
  ])
  const emptyProject = JSON.parse(await fs.readFile(await emptyDownload.path(), 'utf8'))
  assert.deepEqual(emptyProject.assets, [])
  assert.deepEqual(emptyProject.instances, [])

  await replaceLibrary(emptyProject.assets)
  await catalog.getByTestId('catalog-select').click()
  await page.getByTestId('scene-fit').click()
  const builtInId = 'ceram-mp5-storage-rack'
  assert.equal((await dragModelTo(21000, 11900, builtInId)).assetId, builtInId)
  assert.equal(await assetCount(), 1)
  await page.getByTestId('scene-undo').click()
  assert.equal(await assetCount(), 0)

  await catalog.getByTestId('catalog-close').click()
  const originalGlb = project.assets.find(({ id }) => id === model.id)
  const tinySize = { x: 2.5, y: 2, z: 2.14400005341 }
  await replaceLibrary([{ ...originalGlb, glb: { ...originalGlb.glb, size: tinySize } }])
  await page.getByTestId('place-center').click()
  const targetSize = { x: 1400, y: 1600, z: 2500 }
  for (const [axis, mm] of Object.entries(targetSize))
    await page.getByTestId(`instance-size-${axis}`).locator('input').fill(String(mm))
  await page.getByTestId('instance-apply').click()
  const corrected = await placed()
  for (const [axis, mm] of Object.entries(targetSize))
    assert.ok(Math.abs(corrected.scale[axis] * tinySize[axis] - mm) < 0.0001)
  assert.ok(corrected.scale.z > 1000)
  await page.getByTestId('selection-focus').click()
  await page.getByTestId('direct-z').press('Shift+ArrowRight')
  assert.ok(Math.abs((await placed()).scale.z * tinySize.z - 2750) < 0.0001)
  const [correctedDownload] = await Promise.all([
    page.waitForEvent('download'),
    ribbonCommand('File', 'scene-save'),
  ])
  const correctedProject = JSON.parse(await fs.readFile(await correctedDownload.path(), 'utf8'))
  assert.ok(Math.abs(correctedProject.instances[0].scale.z * correctedProject.assets[0].glb.size.z - 2750) < 0.0001)

  const door = {
    id: 'slim-door-fixture', name: '유리문 핸들 검증', kind: 'equipment',
    parts: [
      { x: -485, z: 1100, width: 30, height: 2200 },
      { x: 485, z: 1100, width: 30, height: 2200 },
      { x: 0, z: 2185, width: 940, height: 30 },
      { x: 0, z: 1100, width: 940, height: 2140, opacity: 0.25 },
    ].map(({ x, z, width, height, opacity }, index) => ({
      id: `door-${index}`, name: `Door part ${index}`, shape: 'box', position: { x, y: 0, z },
      size: { x: width, y: 45, z: height }, rotation: 0, color: '#dddfe2', opacity,
    })),
  }
  await replaceLibrary([door])
  await page.getByTestId('place-center').click()
  await page.getByTestId('direct-x-min').waitFor()
  await page.getByTestId('selection-focus').click()
  await page.getByTestId('direct-x-min').hover()
  const left = await page.getByTestId('direct-x-min').boundingBox()
  const right = await page.getByTestId('direct-x').boundingBox()
  assert.ok(left.x < right.x)
  const doorBefore = await placed()
  await dragHandle('x-min', (left.x - right.x) * 0.2, (left.y - right.y) * 0.2)
  const doorAfter = await placed()
  assert.ok(doorAfter.scale.x > 1.1)
  assert.equal(doorAfter.scale.y, 1)
  assert.equal(doorAfter.scale.z, 1)
  const fixedRight = (placement) => placement.position.x + 500 * (placement.scale?.x ?? 1)
  assert.ok(Math.abs(fixedRight(doorBefore) - fixedRight(doorAfter)) < 0.001)
  assert.equal(await page.evaluate(() => window.__selectedMask.children.length), 4)
  await page.screenshot({ path: path.join(output, 'door-edge-handles.png') })

  await replaceLibrary([])
  await page.getByTestId('facility-building-mode').click()
  await page.getByTestId('interior-layout').click()
  const plan = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const context = canvas.getContext('2d')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, 320, 240)
    context.fillStyle = '#32445d'
    context.fillRect(40, 110, 240, 6)
    return canvas.toDataURL().split(',')[1]
  })
  await page.getByTestId('layout-file').setInputFiles({
    name: 'wall-plan.png', mimeType: 'image/png', buffer: Buffer.from(plan, 'base64'),
  })
  await page.getByText('위치와 실제 크기 직접 맞추기', { exact: true }).click()
  await page.getByRole('spinbutton', { name: '실제 가로 길이 mm' }).fill('24000')
  await page.getByTestId('layout-apply').click()
  await page.getByTestId('layout-panel').getByRole('button', { name: '닫기', exact: true }).click()
  await page.waitForFunction(() => {
    const plan = window.__facilityView.scene.getObjectByName('facility-floor-plan')
    return plan.visible && plan.material.map?.image?.width === 320
  })

  const screenPoint = ([x, y, z]) => page.evaluate(([x, y, z]) => {
    const { THREE, camera, renderer } = window.__facilityView
    camera.updateMatrixWorld()
    const point = new THREE.Vector3(x / 1000, y / 1000, z / 1000).project(camera)
    const bounds = renderer.domElement.getBoundingClientRect()
    return [bounds.x + (point.x + 1) * bounds.width / 2, bounds.y + (1 - point.y) * bounds.height / 2]
  }, [x, y, z])
  const drawWall = page.getByTestId('interior-wall')
  await drawWall.click()
  await page.getByTestId('wall-thickness').fill('210')
  await page.getByTestId('wall-height').fill('3000')
  await page.mouse.click(...await screenPoint([6000, 6000, 0]))
  await page.getByText('벽의 끝점을 클릭하세요.', { exact: true }).waitFor()
  assert.equal(await assetCount(), 0)
  await page.keyboard.press('Escape')
  assert.equal(await drawWall.getAttribute('aria-pressed'), 'false')
  assert.equal(await assetCount(), 0)
  await drawWall.click()
  await page.mouse.click(...await screenPoint([6000, 6000, 0]))
  const end = await screenPoint([10500, 6600, 0])
  await page.keyboard.down('Shift')
  await page.mouse.move(...end)
  await page.waitForFunction(() => {
    const preview = window.__facilityView.scene.getObjectByName('facility-wall-preview')
    return preview.visible && preview.scale.x > 4 && preview.scale.y === 0.21 && preview.rotation.z === 0
  })
  await page.screenshot({ path: path.join(output, 'drawing-wall-on-plan.png') })
  await page.mouse.click(...end)
  await page.keyboard.up('Shift')
  const wall = await placed()
  assert.equal(wall.assetId, 'interior-wall')
  assert.equal(wall.rotation, 0)
  assert.ok(Math.abs(wall.scale.x * 3000 - 4500) < 100)
  assert.ok(Math.abs(wall.scale.y * 150 - 210) < 0.001)
  assert.ok(Math.abs(wall.scale.z * 2600 - 3000) < 0.001)
  assert.equal(await drawWall.getAttribute('aria-pressed'), 'true')
  await drawWall.click()
  await page.getByTestId('scene-undo').click()
  assert.equal(await assetCount(), 0)
  assert.equal(await page.getByTestId('instance-count').textContent(), '0')
  await page.getByTestId('scene-redo').click()
  assert.equal(await page.getByTestId('instance-count').textContent(), '1')
  await page.getByTestId('interior-door').click()
  await page.mouse.click(...await screenPoint([wall.position.x, wall.position.y, 3000]))
  assert.equal((await placed()).wallDoors.length, 1)
  const dragElement = async (locator, dx, dy) => {
    const rect = await locator.boundingBox()
    assert.ok(rect)
    const x = rect.x + rect.width / 2
    const y = rect.y + rect.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y + dy, { steps: 6 })
    await page.mouse.up()
  }
  const elevation = page.getByTestId('wall-elevation-board')
  const elevationSize = await elevation.boundingBox()
  assert.ok(elevationSize)
  const wallWidth = wall.scale.x * 3000
  const opening = (await placed()).wallDoors[0]
  const doorControl = page.getByRole('button', { name: '문 선택 또는 이동', exact: true })
  await dragElement(doorControl, -800 * elevationSize.width / wallWidth, -30)
  const shiftedDoor = (await placed()).wallDoors[0]
  assert.ok(shiftedDoor.offset < opening.offset - 600)
  assert.equal(shiftedDoor.sill, undefined)
  await dragElement(page.getByTestId('wall-opening-resize-e'), 300 * elevationSize.width / wallWidth, 0)
  assert.ok((await placed()).wallDoors[0].width > shiftedDoor.width + 150)
  await page.getByTestId('interior-window').click()
  const windowBefore = (await placed()).wallDoors.find(item => item.kind === 'window')
  await page.keyboard.down('Alt')
  await dragElement(page.getByRole('button', { name: '창문 선택 또는 이동' }), 0, -137 * elevationSize.height / 3000)
  await page.keyboard.up('Alt')
  const windowAfter = (await placed()).wallDoors.find(item => item.kind === 'window')
  assert.ok(windowAfter.sill > windowBefore.sill + 100)
  assert.notEqual(windowAfter.sill % 100, 0)
  await dragElement(
    page.getByRole('button', { name: '창문 선택 또는 이동' }),
    ((await placed()).wallDoors[0].offset - windowAfter.offset) * elevationSize.width / wallWidth, 0,
  )
  assert.deepEqual((await placed()).wallDoors.find(item => item.kind === 'window'), windowAfter)
  const [wallDownload] = await Promise.all([
    page.waitForEvent('download'),
    ribbonCommand('File', 'scene-save'),
  ])
  const wallProject = await fs.readFile(await wallDownload.path(), 'utf8')
  const restoredWall = await page.evaluate(async (content) => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
    const studio = useFacilityEditor()
    studio.load(content, 'drawn-wall.map3d.json')
    return structuredClone(studio.document.instances[0])
  }, wallProject)
  assert.deepEqual(restoredWall, JSON.parse(wallProject).instances[0])

  await page.getByTestId('building-structure-view').click()
  await page.getByTestId('floor-rectangle').click()
  await page.mouse.click(...await screenPoint([3000, 2000, 0]))
  await page.mouse.click(...await screenPoint([15000, 10000, 0]))
  await page.getByTestId('floor-material').selectOption('showroom-epoxy')
  assert.equal(await page.getByTestId('floor-repeat').locator('input').inputValue(), '4800')
  await page.getByTestId('floor-apply').click()
  await page.waitForFunction(() => {
    const { scene, THREE } = window.__facilityView
    const floor = scene.getObjectByName('바닥 영역 1')
    return floor?.material.map?.image?.width === 1024 &&
      floor.material.map.wrapS === THREE.MirroredRepeatWrapping &&
      !floor.material.depthTest &&
      floor.material.color.getHex() > 0xc9c9c9 &&
      floor.material.envMap === scene.environment &&
      floor.material.specularIntensity > 0 &&
      floor.material.clearcoat > 0 &&
      floor.material.clearcoatRoughness > 0
  })
  const [epoxyDownload] = await Promise.all([
    page.waitForEvent('download'),
    ribbonCommand('File', 'scene-save'),
  ])
  const epoxyProject = JSON.parse(await fs.readFile(await epoxyDownload.path(), 'utf8'))
  assert.equal(epoxyProject.floors[0].material, 'showroom-epoxy')
  assert.equal(epoxyProject.floors[0].color, '#c9c9c9')
  assert.equal(epoxyProject.floors[0].repeatMm, 4800)
  assert.equal(epoxyProject.floors[0].points.length, 4)

  await page.getByTestId('building-structure-view').click()
  await page.getByTestId('place-ceiling').click()
  await page.getByTestId('building-ceiling-height').fill('3500')
  await page.mouse.click(...await screenPoint([3000, 3000, 0]))
  await page.getByText('맞은편 모서리를 클릭하세요.', { exact: true }).waitFor()
  await page.mouse.click(...await screenPoint([12000, 9000, 0]))
  const ceiling = await placed()
  assert.equal(ceiling.cutawayRole, 'ceiling')
  assert.equal(ceiling.position.z, 3500)
  assert.ok(Math.abs(ceiling.scale.x * 3000 - 9000) < 125)
  assert.ok(Math.abs(ceiling.scale.y * 3000 - 6000) < 125)
  const glassId = await page.evaluate(async (asset) => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
    const { createInteriorModel } = await import('/src/entities/facility/interiorModels.ts')
    const studio = useFacilityEditor()
    studio.setAsset({
      ...asset, id: 'building-line-fixture', name: 'Building fixture', catalogCategory: 'lighting',
      light: { kind: 'line', temperature: 6000 },
      glb: { ...asset.glb, sourceName: '19_linear_led.glb', size: { x: 1200, y: 100, z: 70 } },
    }, studio.document.mapRef)
    const glass = createInteriorModel('glass')
    studio.setAsset(glass, studio.document.mapRef)
    studio.place(12000, 6000)
    const id = studio.selectedId
    studio.place(15000, 6500)
    return id
  }, originalGlb)
  await page.getByTestId('building-mark-wall').click()
  assert.equal((await placed()).cutawayRole, 'wall')
  await page.getByTestId('building-existing-object').selectOption(glassId)
  await page.getByTestId('building-attach-selection').locator('.v-field__append-inner').click()
  await page.getByRole('option').filter({ hasText: /^벽 · 벽 / }).click()
  assert.equal((await placed()).attachedTo, wall.id)
  await page.getByTestId('building-ceiling-view').click()
  const ceilingPlan = page.getByTestId('ceiling-plan-board')
  await ceilingPlan.waitFor()
  await page.getByTestId('default-catalog').click()
  await page.getByTestId('catalog-model-building-line-fixture').dragTo(ceilingPlan, { targetPosition: { x: 180, y: 120 } })
  await page.getByTestId('ceiling-fixture').waitFor()
  const mounted = await placed()
  assert.equal(mounted.attachedTo, ceiling.id)
  assert.equal(mounted.position.z, 3430)
  await dragElement(page.getByTestId('ceiling-fixture'), 38, 23)
  const shifted = await placed()
  assert.notDeepEqual(shifted.position, mounted.position)
  assert.equal(shifted.position.z, mounted.position.z)
  await dragElement(page.getByTestId('ceiling-fixture-rotate'), -18, -36)
  assert.notEqual((await placed()).rotation, shifted.rotation)
  const buildingExport = await page.evaluate(async () => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
    const { useEditor } = await import('/src/features/map-editor/model/editor.ts')
    const { exportFacilityFiles } = await import('/src/entities/facility/index.ts')
    return { ...exportFacilityFiles(useFacilityEditor().document), nodes: useEditor().document.nodes }
  })
  await fs.writeFile(path.join(output, 'building-editor-cross-app.json'), JSON.stringify(buildingExport))
  await page.getByTestId('facility-equipment-mode').click()
  assert.equal(await page.getByTestId('building-structure-view').count(), 0)
  await page.getByTestId('tool-place').waitFor()
  const expectBuildingView = (full) => page.waitForFunction(({ structures, fixture, full }) => {
    const { THREE, scene } = window.__facilityView
    const matrix = new THREE.Matrix4()
    const models = new Map()
    scene.traverse((mesh) => {
      if (!mesh.isInstancedMesh) return
      mesh.userData.ids?.forEach((id, index) => {
        mesh.getMatrixAt(index, matrix)
        const shown = matrix.getMaxScaleOnAxis() > 0
        const previous = models.get(id)
        models.set(id, { shown, consistent: !previous || (previous.consistent && previous.shown === shown) })
      })
    })
    const guide = scene.getObjectByName('facility-building-guide')
    return guide?.visible === !full && (full || guide.geometry.getAttribute('position').count >= 16) &&
      structures.every((id) => models.get(id)?.consistent && models.get(id)?.shown === full) &&
      models.get(fixture)?.consistent && models.get(fixture)?.shown
  }, { structures: [wall.id, ceiling.id], fixture: shifted.id, full })
  await expectBuildingView(false)
  assert.equal((await placed()).id, shifted.id)
  await page.getByTestId('instance-size-x').locator('input').fill('1800')
  await page.getByTestId('instance-apply').click()
  assert.equal((await placed()).scale?.x, 1.5)
  assert.equal((await placed()).attachedTo, ceiling.id)
  await ribbonCommand('View', 'equipment-show-building')
  await expectBuildingView(true)
  await ribbonCommand('View', 'equipment-show-building')
  await expectBuildingView(false)
  await page.getByTestId('facility-building-mode').click()
  await expectBuildingView(true)
  await page.getByTestId('facility-equipment-mode').click()

  const initialGroup = await page.evaluate(async () => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
    const studio = useFacilityEditor()
    const asset = {
      id: 'snap-block', name: 'Snap block', kind: 'equipment',
      parts: [{
        id: 'body', name: 'Body', shape: 'box', color: '#273039', surface: 'stainlessSteel', rotation: 0,
        position: { x: 0, y: 0, z: 300 }, size: { x: 1200, y: 800, z: 600 },
      }],
    }
    const instances = [
      { id: 'snap-first', position: { x: 7123, y: 5127, z: 250 }, rotation: 30 },
      { id: 'snap-second', position: { x: 8500, y: 5600, z: 0 }, rotation: 0 },
    ].map(item => ({ ...item, assetId: asset.id, name: item.id }))
    studio.load(JSON.stringify({ ...studio.document, assets: [asset], instances, floors: [] }), 'snap-test.map3d.json')
    return instances
  })
  await page.getByTestId('facility-snap-step').selectOption('50')
  await page.getByTestId('scene-top').click()
  const groupPositions = () => page.evaluate(async () =>
    (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().document.instances
      .map(({ position }) => ({ ...position })),
  )
  const footprint = () => page.evaluate(() => {
    const mesh = window.__facilityView.scene.getObjectByName('facility-selection-footprints')
    return Array.from(mesh.geometry.attributes.position.array.slice(0, mesh.geometry.drawRange.count * 3))
  })
  await page.waitForFunction(() => {
    const { scene } = window.__facilityView
    let metal
    scene.traverse((object) => {
      if (object.userData.ids?.includes('snap-first')) metal = object.material
    })
    return !!metal?.envMap && metal.envMapIntensity === 0.72 && metal.color.getHex() === 0x273039
  })
  const groupStart = await screenPoint([7123, 5127, 850])
  await page.mouse.click(...groupStart)
  await page.keyboard.down('Shift')
  await page.mouse.click(...await screenPoint([8500, 5600, 600]))
  await page.keyboard.up('Shift')
  await page.waitForFunction(() =>
    window.__facilityView.scene.getObjectByName('facility-selection-footprints').geometry.drawRange.count === 16,
  )
  const beforeFootprint = await footprint()
  assert.equal(beforeFootprint.length, 48)
  const edge = [beforeFootprint[3] - beforeFootprint[0], beforeFootprint[4] - beforeFootprint[1]]
  assert.ok(Math.abs(Math.hypot(...edge) - 1.2) < 0.00001)
  assert.ok(Math.abs(Math.atan2(edge[1], edge[0]) - Math.PI / 6) < 0.00001)
  assert.ok(beforeFootprint.filter((_, index) => index % 3 === 2).every(z => Math.abs(z - 0.004) < 0.00001))
  await page.mouse.move(...groupStart)
  await page.mouse.down()
  await page.mouse.move(...await screenPoint([7472, 5383, 850]))
  await page.waitForFunction((x) => {
    const mesh = window.__facilityView.scene.getObjectByName('facility-selection-footprints')
    return Math.abs(mesh.geometry.attributes.position.array[0] - x) > 0.1
  }, beforeFootprint[0])
  const snappedPreview = await footprint()
  await page.keyboard.down('Alt')
  await page.waitForFunction((x) => {
    const mesh = window.__facilityView.scene.getObjectByName('facility-selection-footprints')
    const position = mesh.geometry.attributes.position.array
    return Math.hypot(position[0] - x[0], position[1] - x[1]) > 0.004
  }, snappedPreview.slice(0, 2))
  await page.keyboard.up('Alt')
  await page.mouse.up()
  const groupMoved = await groupPositions()
  assert.equal(groupMoved[0].x % 50, 0)
  assert.equal(groupMoved[0].y % 50, 0)
  const initialPositions = initialGroup.map(({ position }) => position)
  for (const axis of ['x', 'y'])
    assert.equal(groupMoved[1][axis] - groupMoved[0][axis], initialPositions[1][axis] - initialPositions[0][axis])
  await page.getByTestId('scene-undo').click()
  assert.deepEqual(await groupPositions(), initialPositions)
  await page.mouse.click(...groupStart)
  await page.mouse.move(...groupStart)
  await page.mouse.down()
  await page.keyboard.down('Alt')
  await page.mouse.move(...await screenPoint([7472, 5383, 850]))
  await page.mouse.up()
  await page.keyboard.up('Alt')
  const freePosition = (await groupPositions())[0]
  assert.ok(Math.abs(freePosition.x - 7472) < 35)
  assert.ok(freePosition.x % 50 !== 0 || freePosition.y % 50 !== 0)
  await page.getByTestId('direct-rotate').waitFor()
  await dragHandle('rotate', 44, 7)
  const snappedRotation = (await placed()).rotation
  assert.notEqual(snappedRotation, 30)
  assert.equal(Math.abs(snappedRotation % 15), 0)
  await page.keyboard.down('Alt')
  await dragHandle('rotate', -31, 12)
  await page.keyboard.up('Alt')
  assert.notEqual(Math.abs((await placed()).rotation % 15), 0)
  await page.getByTestId('scene-fit').click()
  const fromAbove = await footprint()
  await page.getByTestId('scene-top').click()
  assert.deepEqual(await footprint(), fromAbove)

  await page.evaluate(async () => {
    const { THREE } = window.__facilityView
    const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js')
    const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
    const lens = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.06, 0.04),
      new THREE.MeshStandardMaterial({ name: 'Diffused lamp lens' }),
    )
    const binary = await new GLTFExporter().parseAsync(lens, { binary: true })
    const data = btoa(String.fromCharCode(...new Uint8Array(binary)))
    const assets = ['18_track_spotlight.glb', '19_linear_led.glb'].map((sourceName, index) => ({
      id: 'light-' + index, name: sourceName, kind: 'equipment', parts: [],
      glb: { data, size: { x: 2000, y: 40, z: 60 }, sourceName },
    }))
    const instances = assets.flatMap(({ id }, index) => Array.from({ length: 4 }, (_, fixture) => ({
      id: id + '-fixture-' + fixture, assetId: id, name: id, rotation: 90,
      position: { x: index * 4000 + fixture * 2500, y: 2000, z: 3700 },
    })))
    const floors = [{
      id: 'light-floor', name: 'Lighting fixture floor', color: '#c9c9c9', material: 'showroom-epoxy',
      rotation: 0, repeatMm: 4800, points: [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 8000 }, { x: 0, y: 8000 }],
    }]
    const studio = useFacilityEditor()
    studio.load(JSON.stringify({ ...studio.document, assets, instances, floors }), 'fixtures.map3d.json')
  })
  await page.waitForFunction(() => {
    const { scene } = window.__facilityView
    const group = scene.getObjectByName('showroom-fixtures')
    const lights = group.children
    const map = scene.getObjectByName('Lighting fixture floor')?.material.lightMap
    return lights.some(light => light.isSpotLight && light.userData.temperature === 2000) &&
      lights.some(light => light.isRectAreaLight && light.userData.temperature === 6000 &&
        Math.abs(light.width - 2) < 0.00001 && Math.abs(light.rotation.z - Math.PI / 2) < 0.00001) &&
      scene.environmentIntensity === 0 &&
      !scene.children.some(child => child.isDirectionalLight && child.visible) &&
      lights.length === 8 && group.visible && scene.environment === null && map?.channel === 1 &&
      lights.every(light => light.visible && light.layers.mask === 0)
  })
  const bakedId = await page.evaluate(() => window.__facilityView.scene.getObjectByName('Lighting fixture floor').material.lightMap.uuid)
  assert.equal(await page.getByTestId('facility-realtime-reflections').count(), 0)
  const lampView = await page.getByTestId('facility-canvas').locator('canvas[data-engine]').boundingBox()
  await page.mouse.move(lampView.x + lampView.width * 0.45, lampView.y + lampView.height * 0.5)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(lampView.x + lampView.width * 0.65, lampView.y + lampView.height * 0.44, { steps: 4 })
  await page.mouse.up({ button: 'right' })
  assert.deepEqual(await page.evaluate(() => {
    const { scene } = window.__facilityView
    return {
      bakedId: scene.getObjectByName('Lighting fixture floor').material.lightMap.uuid,
      lights: scene.getObjectByName('showroom-fixtures').children.filter(light => light.visible).length,
    }
  }), { bakedId, lights: 8 })
  await page.getByRole('button', { name: 'GLB 모델 카탈로그', exact: true }).click()
  await page.getByTestId('model-catalog').getByRole('button', { name: '조명', exact: true }).click()
  await page.getByTestId('catalog-light-edit-light-0').click()
  const temperatureInput = page.getByTestId('glb-light-temperature').locator('input')
  assert.equal(await temperatureInput.inputValue(), '2000')
  await temperatureInput.fill('950')
  assert.equal(await page.getByTestId('catalog-light-save').isDisabled(), true)
  await temperatureInput.fill('2700')
  await page.getByTestId('catalog-light-save').click()
  await page.waitForFunction((previous) => {
    const { scene } = window.__facilityView
    return scene.getObjectByName('showroom-fixtures').children
      .some(light => light.isSpotLight && light.userData.temperature === 2700) &&
      scene.getObjectByName('Lighting fixture floor').material.lightMap.uuid !== previous
  }, bakedId)
  await chooseGlb('robot')
  await nameInput.fill('Custom light')
  await temperatureInput.fill('5300')
  await registerGlb.click()
  await page.getByTestId('catalog-close').click()
  const [lightingDownload] = await Promise.all([
    page.waitForEvent('download'),
    ribbonCommand('File', 'scene-save'),
  ])
  const lightingProject = JSON.parse(await fs.readFile(await lightingDownload.path(), 'utf8'))
  assert.deepEqual(lightingProject.assets.find(asset => asset.id === 'light-0').light, { kind: 'spot', temperature: 2700 })
  assert.deepEqual(lightingProject.assets.find(asset => asset.name === 'Custom light').light, { kind: 'spot', temperature: 5300 })
  await fs.writeFile(path.join(output, 'lighting.map3d.json'), JSON.stringify(lightingProject))
  await page.evaluate(async () => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
    const studio = useFacilityEditor()
    studio.load(JSON.stringify({ ...studio.document, instances: [] }), 'empty-fixtures.map3d.json')
  })
  await page.waitForFunction(() => {
    const { scene } = window.__facilityView
    return scene.getObjectByName('showroom-fixtures').children.length === 0 &&
      scene.environmentIntensity === 0.55 && !scene.getObjectByName('Lighting fixture floor').material.lightMap
  })


  /** 회전된 벽에서 표면과 개구부 부착이 같은 편집 이력에 남는지 검증 */
  {
    await page.getByTestId('facility-equipment-mode').click()
    const mountedFixture = {
      ...originalGlb,
      id: 'wall-attachment-fixture',
      name: 'Wall attachment fixture',
      glb: { ...originalGlb.glb, size: { x: 800, y: 240, z: 900 } },
    }
    const fixtureLight = lightingProject.assets.find((asset) => asset.id === 'light-0')
    await page.evaluate(async ({ asset, light }) => {
      const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
      const { createInteriorModel } = await import('/src/entities/facility/index.ts')
      const studio = useFacilityEditor()
      const wall = createInteriorModel('wall')
      const ceiling = createInteriorModel('ceiling')
      studio.load(JSON.stringify({
        ...studio.document,
        floors: [],
        assets: [wall, ceiling, asset, light],
        instances: [
          { id: 'wall-host', assetId: wall.id, name: 'Wall host', position: { x: 13000, y: 9000, z: 0 }, rotation: 28, scale: { x: 2, y: 1, z: 1 }, cutawayRole: 'wall' },
          { id: 'ceiling-host', assetId: ceiling.id, name: 'Ceiling host', position: { x: 16500, y: 10500, z: 4500 }, rotation: 0, cutawayRole: 'ceiling' },
          { id: 'attached-light', assetId: light.id, name: 'Attached light', position: { x: 16500, y: 10500, z: 4300 }, rotation: 0, attachedTo: 'ceiling-host' },
        ],
      }), 'wall-mount-fixture.map3d.json')
      studio.selectedAssetId = asset.id
    }, { asset: mountedFixture, light: fixtureLight })
    const explorer = page.getByRole('region', { name: 'Scene Explorer' })
    const wallBranch = explorer.locator('[data-scene-branch=wall-host]')
    const ceilingBranch = explorer.locator('[data-scene-branch=ceiling-host]')
    await ceilingBranch.getByRole('button', { name: /Attached light/ }).waitFor()
    assert.equal(await explorer.locator('[data-scene-branch=lighting]').getByRole('button', { name: /Attached light/ }).count(), 0)
    await page.getByTestId('facility-building-mode').click()
    await page.getByTestId('facility-snap-step').selectOption('100')
    await page.getByTestId('wall-mount-tool').click()
    const wallPoint = (x, z) => page.evaluate(([x, z]) => {
      const { THREE, camera, renderer } = window.__facilityView
      const a = 28 * Math.PI / 180
      const world = (u, v, height) => new THREE.Vector3(13 + u * Math.cos(a) - v * Math.sin(a), 9 + u * Math.sin(a) + v * Math.cos(a), height)
      camera.position.copy(world(0, -11, 4.3))
      camera.lookAt(world(0, 0, 1.4))
      camera.updateMatrixWorld()
      const point = world(x / 1000, -0.075, z / 1000).project(camera)
      const rect = renderer.domElement.getBoundingClientRect()
      return [rect.left + (point.x + 1) * rect.width / 2, rect.top + (1 - point.y) * rect.height / 2]
    }, [x, z])
    await page.mouse.move(...await wallPoint(-1337, 1585))
    await page.waitForFunction(() => {
      const { scene } = window.__facilityView
      return scene.getObjectByName('facility-wall-mount-preview').visible &&
        scene.getObjectByName('facility-wall-mount-outline').visible
    })
    const ghost = () => page.evaluate(() =>
      window.__facilityView.scene.getObjectByName('facility-wall-mount-preview').position.toArray())
    const snapped = await ghost()
    assert.equal(Math.round(snapped[2] * 1000), 1100)
    await page.keyboard.down('Alt')
    await page.waitForFunction((z) =>
      Math.abs(window.__facilityView.scene.getObjectByName('facility-wall-mount-preview').position.z - z) > 0.02, snapped[2])
    const free = await ghost()
    await page.mouse.down()
    await page.mouse.up()
    await page.keyboard.up('Alt')
    const mounted = await placed()
    assert.equal(mounted.attachedTo, 'wall-host')
    assert.equal(mounted.rotation, 28)
    assert.ok(Math.abs(mounted.position.z / 1000 - free[2]) < 0.00001)
    const toLocal = (p, x, y, angle) => {
      const theta = angle * Math.PI / 180
      return [Math.cos(theta) * (p.x - x) + Math.sin(theta) * (p.y - y), Math.cos(theta) * (p.y - y) - Math.sin(theta) * (p.x - x)]
    }
    const surface = toLocal(mounted.position, 13000, 9000, 28)
    assert.ok(Math.abs(surface[1] + 195) < 0.001)
    const mountedRow = wallBranch.getByRole('button', { name: /Wall attachment fixture/ })
    assert.equal(await mountedRow.getAttribute('aria-pressed'), 'true')
    await page.getByTestId('wall-mounted-z').locator('input').fill('1300')
    await page.getByTestId('instance-apply').click()
    assert.equal((await placed()).position.z, 1300)
    await ceilingBranch.locator('summary').click({ position: { x: 4, y: 8 } })
    await page.evaluate(async () => {
      const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
      useFacilityEditor().selectedId = 'attached-light'
    })
    assert.equal(await ceilingBranch.getAttribute('open'), '')
    await page.getByTestId('wall-mount-tool').click()
    await page.getByTestId('wall-mount-kind').selectOption('door')
    await page.mouse.move(...await wallPoint(1400, 960))
    await page.waitForFunction(() => window.__facilityView.scene.getObjectByName('facility-wall-mount-preview').visible)
    await page.mouse.down()
    await page.mouse.up()
    const linked = await placed()
    const readWall = () => page.evaluate(async () => {
      const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
      const { instanceParts, exportFacilityFiles, importFacilityFiles } = await import('/src/entities/facility/index.ts')
      const studio = useFacilityEditor()
      const wall = studio.document.instances.find(({ id }) => id === 'wall-host')
      const wallAsset = studio.document.assets.find(({ id }) => id === wall.assetId)
      const parts = instanceParts(wallAsset, wall)
      const { layout, library } = exportFacilityFiles(studio.document)
      const restored = importFacilityFiles(JSON.stringify(layout), JSON.stringify(library))
      return {
        wall: structuredClone(wall), parts,
        instances: structuredClone(studio.document.instances),
        restored: restored.instances.find(({ id }) => id === wall.id),
      }
    })
    let mountedState = await readWall()
    assert.equal(mountedState.wall.wallDoors[0].modelId, linked.id)
    assert.equal(linked.position.z, 0)
    assert.ok(mountedState.parts.every((part) => part.wall))
    assert.deepEqual(mountedState.restored.wallDoors, mountedState.wall.wallDoors)
    await page.getByTestId('edit-linked-opening').click()
    const linkedDoor = page.getByRole('button', { name: '문 선택 또는 이동', exact: true })
    await linkedDoor.waitFor()
    const boardWidth = (await page.getByTestId('wall-elevation-board').boundingBox()).width
    await dragElement(linkedDoor, -300 * boardWidth / 6000, 0)
    mountedState = await readWall()
    const edited = mountedState.instances.find(({ id }) => id === linked.id)
    assert.ok(Math.abs(toLocal(edited.position, 13000, 9000, 28)[0] - mountedState.wall.wallDoors[0].offset) < 0.001)
    await page.getByTestId('wall-mount-tool').click()
    await page.getByTestId('wall-mount-kind').selectOption('window')
    const board = page.getByTestId('wall-elevation-board')
    const boardBox = await board.boundingBox()
    await page.mouse.move(boardBox.x + boardBox.width * 0.15, boardBox.y + boardBox.height * 0.28)
    await page.getByTestId('wall-mount-preview').waitFor()
    await page.mouse.down()
    await page.mouse.up()
    const windowPlacement = await placed()
    const windowOpening = (await readWall()).wall.wallDoors.find(({ kind }) => kind === 'window')
    assert.equal(windowOpening.modelId, windowPlacement.id)
    assert.ok(windowOpening.sill > 0)
    await page.evaluate(async () => {
      const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
      useFacilityEditor().updateInstance('wall-host', { position: { x: 13500, y: 9400, z: 12 }, rotation: 58 })
    })
    mountedState = await readWall()
    const followed = mountedState.instances.find(({ id }) => id === mounted.id)
    const relative = toLocal(followed.position, 13500, 9400, 58)
    assert.ok(Math.abs(relative[0] - surface[0]) < 0.001)
    assert.ok(Math.abs(relative[1] - surface[1]) < 0.001)
    assert.equal(followed.rotation, 58)
    await page.getByTestId('scene-undo').click()
    assert.equal((await readWall()).wall.rotation, 28)
    await page.getByTestId('scene-redo').click()
    assert.equal((await readWall()).wall.rotation, 58)
    await page.getByTestId('building-structure-view').click()
    await page.getByTestId('wall-mount-tool').click()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByTestId('wall-mount-tool').getAttribute('aria-pressed'), 'false')
  }

  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      editor: true,
      facilityRulers: true,
      facilityGridToggle: true,
      catalog: 23,
      importedGlb: true,
      glbMillimeterSizeCorrection: true,
      catalogDragAndDrop: true,
      catalogBatchDeletion: true,
      catalogEmptySave: true,
      scaled: true,
      mouseSelectionMoveScale: true,
      anchoredResize: true,
      meshSelectionOutline: true,
      transformSnappingAndFootprints: true,
      wallDrawingFromPlan: true,
      wallMountHierarchyAndGlbOpening: true,
      showroomEpoxyFloor: true,
      showroomFixtureLighting: true,
      glbImportPreview: true,
      catalogRefreshPreservesPlacement: true,
      undoRedo: true,
      portableExport: true,
      errors,
    }),
  )
} finally {
  await browser.close()
}
