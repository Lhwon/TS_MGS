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
  page.on('dialog', (dialog) => void dialog.accept())
  await page.goto('http://127.0.0.1:5180/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByTestId('mode-facility').waitFor()
  await page.evaluate(async () => {
    const code = await (await fetch('/src/widgets/facility-studio/lib/FacilityScene.ts')).text()
    const url = code.match(/import \* as THREE from "([^"]+)"/)[1]
    const THREE = await import(url)
    const previous = THREE.Scene.prototype.onBeforeRender
    THREE.Scene.prototype.onBeforeRender = (renderer, scene, camera, ...rest) => {
      window.__facilityView = { THREE, scene, camera, renderer }
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
  await page.getByTestId('mode-facility').click()
  await page.getByRole('button', { name: '기본 모델', exact: true }).click()
  await page.waitForFunction(
    async () =>
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().document
        .assets.length === 23,
  )
  const libraryRow = page.locator('.facility-library .facility-row').first()
  const alignment = await libraryRow.evaluate((row) => {
    const title = row.querySelector('strong')
    const detail = row.querySelector('small')
    return {
      leftGap: title.getBoundingClientRect().left - row.getBoundingClientRect().left,
      aligned: title.getBoundingClientRect().left === detail.getBoundingClientRect().left,
    }
  })
  assert.ok(alignment.aligned && alignment.leftGap < 20, JSON.stringify(alignment))
  await page.getByTestId('placement-port').selectOption('PORT-1')
  await page.getByTestId('place-port').click()
  await page.getByTestId('selection-tools').waitFor()
  assert.ok(
    await page.getByTestId('selection-translate').evaluate((el) => el.classList.contains('active')),
  )
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
    const control = scene.children.find((object) => object.isTransformControlsRoot).controls
    const position = control.object.position.clone()
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
  await page.getByTestId('selection-tools').waitFor()
  assert.ok(
    await page.getByTestId('selection-translate').evaluate((el) => el.classList.contains('active')),
  )
  /** 현재 선택 핸들의 화면 좌표 조회 */
  const handlePoint = async (axis) =>
    page.evaluate((name) => {
      const { THREE, scene, camera, renderer } = window.__facilityView
      const control = scene.children.find((object) => object.isTransformControlsRoot).controls
      renderer.render(scene, camera)
      const handles = control._gizmo.gizmo[control.mode].children.filter(
        (part) => part.name === name && part.isMesh && part.visible,
      )
      const handle = handles[0]
      if (!handle) throw new Error(`Missing ${control.mode} ${name} handle`)
      const p = new THREE.Box3()
        .setFromObject(handle)
        .getCenter(new THREE.Vector3())
        .project(camera)
      const rect = renderer.domElement.getBoundingClientRect()
      return { x: rect.x + ((p.x + 1) * rect.width) / 2, y: rect.y + ((1 - p.y) * rect.height) / 2 }
    }, axis)
  /** 실제 포인터 입력에 의한 편집 핸들 드래그 */
  const dragHandle = async (axis, dx, dy) => {
    const p = await handlePoint(axis)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x + dx, p.y + dy, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(200)
  }
  await dragHandle('X', 65, 0)
  const moved = await page.evaluate(async () =>
    structuredClone(
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().selected,
    ),
  )
  assert.notEqual(moved.position.x, 1000)
  assert.equal(moved.portOffset.x, moved.position.x - 1000)
  assert.equal(
    Number(await page.getByTestId('instance-x').locator('input').inputValue()),
    moved.position.x,
  )
  await page.getByTestId('selection-scale').click()
  await dragHandle('XYZ', 55, -45)
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
  await dragHandle('X', 40, 0)
  const axisScaled = await page.evaluate(async () =>
    structuredClone(
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().selected,
    ),
  )
  assert.ok(Math.abs(axisScaled.scale.x - scaled.scale.x) > 0.01)
  assert.equal(axisScaled.scale.y, scaled.scale.y)
  assert.equal(axisScaled.scale.z, scaled.scale.z)
  await page.getByTestId('scene-undo').click()
  await page.getByTestId('scene-redo').click()
  await page.evaluate(async () => {
    const store = (
      await import('/src/features/facility-editor/model/studio.ts')
    ).useFacilityEditor()
    store.setAsset({ ...store.document.assets[0], name: '기존 보관랙' }, store.document.mapRef)
  })
  await page.getByTestId('default-catalog').click()
  const refreshed = await page.evaluate(async () =>
    structuredClone(
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().document,
    ),
  )
  assert.equal(refreshed.assets.length, 23)
  assert.equal(refreshed.assets[0].name, '보관 랙 · 2단')
  assert.deepEqual(refreshed.instances[0], axisScaled)
  await page.locator('.facility-instance-list button').first().click()
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
    .getByText('회전 °', { exact: true })
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
  await page
    .getByTestId('glb-file')
    .setInputFiles(path.resolve('public/models/ceram-mp5/robot.glb'))
  await page.waitForFunction(
    async () =>
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().document
        .assets.length === 24,
  )
  await page.getByTestId('place-center').click()
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
  await page.getByTestId('scene-save').click()
  for (let count = 0; downloads.length < 1 && count < 50; count++) await page.waitForTimeout(100)
  assert.equal(downloads.length, 1)
  await downloads[0].saveAs(path.join(output, 'project.map3d.json'))
  const project = JSON.parse(await fs.readFile(path.join(output, 'project.map3d.json'), 'utf8'))
  assert.equal(project.format, 'bem-map3d')
  assert.equal(project.instances.length, 2)
  downloads.length = 0
  await page.getByTestId('scene-export').click()
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
  await page.locator('.facility-instance-list button').first().click()
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
  await page.locator('.facility-instance-list button').first().click()
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
            position: { x: 0, y: 0, z: 500 },
            size: { x: 1000, y: 2000, z: 1000 },
            rotation: 90,
            color: '#dddddd',
          },
          {
            id: 'cylinder',
            name: 'Cylinder',
            shape: 'cylinder',
            position: { x: 1250, y: 0, z: 250 },
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
  const sizeHandle = page.getByTestId('quick-size-z')
  const heightControl = await sizeHandle.boundingBox()
  const dragX = heightControl.x + heightControl.width / 2
  const dragY = heightControl.y + heightControl.height / 2
  await page.mouse.move(dragX, dragY)
  await page.mouse.down()
  await page.mouse.move(dragX + 25, dragY, { steps: 5 })
  assert.equal(await sizeHandle.getAttribute('aria-label'), '높이 1250 mm')
  const placed = () =>
    page.evaluate(async () => {
      const { useFacilityEditor } = await import('/src/features/facility-editor/model/studio.ts')
      return structuredClone(useFacilityEditor().selected)
    })
  const beforeQuickResize = await placed()
  assert.equal(beforeQuickResize.scale.z, 1)
  await page.mouse.up()
  const resized = await placed()
  assert.deepEqual(resized.scale, { x: 1.5, y: 1, z: 1.25 })
  assert.deepEqual(resized.position, beforeQuickResize.position)
  assert.equal(resized.rotation, beforeQuickResize.rotation)
  assert.ok(
    await page.getByTestId('selection-translate').evaluate((el) => el.classList.contains('active')),
  )
  assert.equal(await page.getByTestId('instance-size-z').locator('input').inputValue(), '1250')
  await page.getByTestId('scene-undo').click()
  await page
    .locator('.facility-instance-list')
    .getByRole('button', { name: /사용자 모델 치수 검증/ })
    .click()
  assert.deepEqual(await placed(), beforeQuickResize)
  await sizeHandle.press('Shift+ArrowRight')
  assert.equal((await placed()).scale.z, 1.1)
  await page.mouse.move(dragX, dragY)
  await page.mouse.down()
  await page.mouse.move(dragX + 20, dragY)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  assert.equal((await placed()).scale.z, 1.1)
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      editor: true,
      catalog: 23,
      importedGlb: true,
      scaled: true,
      mouseSelectionMoveScale: true,
      catalogRefreshPreservesPlacement: true,
      undoRedo: true,
      portableExport: true,
      errors,
    }),
  )
} finally {
  await browser.close()
}
