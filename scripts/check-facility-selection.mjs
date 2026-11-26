/**
 * 파일명: check-facility-selection.mjs
 * 설명: 실제 캔버스의 복수 선택과 포트에 연결한 배치의 평면 이동 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.MGS_PLAYWRIGHT ??
    'C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
)
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  plugins: [
    {
      name: 'facility-selection-screen-fixture',
      enforce: 'pre',
      transform: (source, id) =>
        id.replaceAll('\\', '/').endsWith('/facility-studio/lib/FacilityScene.ts')
          ? source.replace(
              /  resizeViewport\(\)\r?\n  return \{/,
              '  resizeViewport()\n' +
                '  window.__facilityPoint = (x, y, z) => {' +
                ' const p = new THREE.Vector3(x / 1000, y / 1000, z / 1000).project(camera);' +
                ' const r = renderer.domElement.getBoundingClientRect();' +
                ' return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 }; };\n' +
                '  window.__facilityInstanceScale = (id) => { const b = instanceBindings.get(id)?.[0]; if (!b) return null; const m = new THREE.Matrix4(); b.mesh.getMatrixAt(b.index, m); return new THREE.Vector3().setFromMatrixScale(m).length(); };\n' +
                '  window.__facilityMaterials = (id) => (instanceBindings.get(id) ?? []).map(({ mesh }) => ({ opacity: mesh.material.opacity, transparent: mesh.material.transparent, depthWrite: mesh.material.depthWrite, castShadow: mesh.castShadow }));\n' +
                '  return {',
            )
          : undefined,
    },
  ],
})
await server.listen()
let browser
let page
try {
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  page = await browser.newPage({ viewport: { width: 1520, height: 980 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    const map = useEditor()
    map.document = {
      ...map.document,
      nodes: [{ id: 1, x: 3000, y: 0, name: 'N1' }],
      edges: [],
      ports: [{ id: 'P1', nodeId: 1, name: 'P1', x: 3000, y: 0, width: 300, height: 200 }],
    }
  })
  await page.getByTestId('mode-facility').click()
  await page.evaluate(async () => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/index.ts')
    const studio = useFacilityEditor()
    studio.setAsset(
      {
        id: 'block',
        name: '선택 검증 객체',
        kind: 'equipment',
        parts: [
          {
            id: 'box',
            name: '외형',
            shape: 'box',
            color: '#537e92',
            rotation: 0,
            position: { x: 0, y: 0, z: 400 },
            size: { x: 900, y: 900, z: 800 },
          },
        ],
      },
      { name: '선택 검증', geometryKey: '' },
    )
    studio.place(-3000, 0)
    studio.updateInstance(studio.selectedId, { position: { x: -3000, y: 0, z: 125 }, rotation: 12 })
    studio.place(3000, 0, 'P1')
    studio.place(0, 2800)
    studio.selectedId = null
  })
  await page.waitForFunction(async () => {
    const studio = (await import('/src/features/facility-editor/index.ts')).useFacilityEditor()
    return (
      typeof window.__facilityInstanceScale === 'function' &&
      studio.document.instances.every(({ id }) => window.__facilityInstanceScale(id) > 0)
    )
  })
  await page.getByRole('button', { name: '위에서 보기' }).click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.waitForFunction(() => typeof window.__facilityPoint === 'function')
  const point = (...v) => page.evaluate((coords) => window.__facilityPoint(...coords), v)
  const left = await point(-3000, 0, 925)
  const right = await point(3000, 0, 800)
  const upper = await point(0, 2800, 800)
  const read = () =>
    page.evaluate(async () => {
      const { useFacilityEditor } = await import('/src/features/facility-editor/index.ts')
      const { selectedIds, document } = useFacilityEditor()
      return { selectedIds, instances: document.instances }
    })
  const baseline = (await read()).instances
  await page.mouse.move(left.x - 35, left.y - 25)
  await page.mouse.down()
  await page.mouse.move(right.x + 35, right.y + 25, { steps: 5 })
  await page.locator('.facility-marquee').waitFor()
  await page.mouse.up()
  const batch = page.getByTestId('facility-batch-move')
  await batch.waitFor()
  assert.deepEqual(
    (await read()).selectedIds,
    baseline.slice(0, 2).map(({ id }) => id),
  )
  await page.keyboard.down('Shift')
  await page.mouse.click(upper.x, upper.y)
  assert.equal((await read()).selectedIds.length, 3)
  await page.mouse.click(upper.x, upper.y)
  await page.keyboard.up('Shift')
  assert.equal((await read()).selectedIds.length, 2)
  assert.equal(await page.getByTestId('direct-transform').isVisible(), false)
  await page.getByTestId('facility-batch-x').locator('input').fill('1234')
  await page.getByTestId('facility-batch-y').locator('input').fill('-780')
  await page.getByTestId('facility-batch-apply').click()
  const moved = (await read()).instances
  assert.deepEqual(moved[0], { ...baseline[0], position: { x: -1766, y: -780, z: 125 } })
  assert.deepEqual(moved[1], {
    ...baseline[1],
    position: { x: 4234, y: -780, z: 0 },
    portOffset: { x: 1234, y: -780, z: 0 },
  })
  assert.deepEqual(moved[2], baseline[2])
  await page.getByTestId('scene-undo').click()
  assert.deepEqual((await read()).instances, baseline)
  await page.getByTestId('tool-select').click()
  await page.mouse.click(left.x, left.y)
  await page.keyboard.down('Shift')
  await page.mouse.click(right.x, right.y)
  await page.keyboard.up('Shift')
  assert.equal((await read()).selectedIds.length, 2)
  await page.keyboard.press('Escape')
  assert.equal((await read()).selectedIds.length, 0)
  await page.keyboard.down('Space')
  await page.mouse.move(left.x - 35, left.y - 25)
  await page.mouse.down()
  await page.mouse.move(left.x + 65, left.y + 40, { steps: 5 })
  await page.locator('.facility-marquee').waitFor({ state: 'hidden' })
  await page.mouse.up()
  await page.keyboard.up('Space')
  assert.notDeepEqual(await point(-3000, 0, 925), left)
  assert.equal((await read()).selectedIds.length, 0)
  /** 천장 아래 구조물의 선택과 이동 및 명시적 벽 정면 전환 회귀 검증 */
  await page.evaluate(async () => {
    const { useFacilityEditor } = await import('/src/features/facility-editor/index.ts')
    const { createInteriorModel } = await import('/src/entities/facility/index.ts')
    const studio = useFacilityEditor()
    const wall = createInteriorModel('wall'),
      roof = createInteriorModel('ceiling')
    const block = { ...studio.document.assets[0], id: 'ceiling-fixture-block' }
    const pillar = {
      ...block,
      id: 'pillar',
      name: '기둥',
      catalogCategory: 'interior',
      parts: [
        {
          ...block.parts[0],
          size: { x: 400, y: 400, z: 2600 },
          position: { x: 0, y: 0, z: 1300 },
        },
      ],
    }
    studio.load(
      JSON.stringify({
        ...studio.document,
        assets: [wall, roof, block, pillar],
        instances: [
          {
            id: 'wall-under-roof',
            assetId: wall.id,
            name: '구조 벽',
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,
          },
          {
            id: 'pillar-under-roof',
            assetId: pillar.id,
            name: '구조 기둥',
            position: { x: 2000, y: 1600, z: 0 },
            rotation: 0,
          },
          {
            id: 'covering-roof',
            assetId: roof.id,
            name: '전체 천장',
            position: { x: 0, y: 0, z: 3500 },
            rotation: 0,
            scale: { x: 4, y: 4, z: 1 },
          },
          {
            id: 'roof-fixture',
            assetId: block.id,
            name: '천장 부착물',
            position: { x: 0, y: 0, z: 2700 },
            rotation: 0,
            attachedTo: 'covering-roof',
          },
          {
            id: 'fixture-child',
            assetId: block.id,
            name: '천장 보조 부착물',
            position: { x: 0, y: 0, z: 2800 },
            rotation: 0,
            attachedTo: 'covering-roof',
          },
        ],
      }),
      'building-selection.map3d.json',
    )
  })
  await page.getByTestId('facility-building-mode').click()
  await page.getByTestId('scene-top').click()
  await page.getByTestId('facility-snap-step').selectOption('100')
  const ceilingToggle = page.getByTestId('building-show-ceiling')
  assert.equal(await ceilingToggle.getAttribute('aria-pressed'), 'false')
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.waitForFunction(() =>
    ['covering-roof', 'roof-fixture', 'fixture-child'].every(
      (id) => window.__facilityInstanceScale(id) === 0,
    ),
  )
  assert.equal(await page.evaluate(() => window.__facilityInstanceScale('roof-fixture')), 0)
  assert.equal(await page.evaluate(() => window.__facilityInstanceScale('fixture-child')), 0)
  const wallPoint = await point(600, 0, 2600)
  const viewport = await page.locator('.facility-studio canvas').first().elementHandle()
  await page.mouse.click(wallPoint.x, wallPoint.y)
  assert.deepEqual((await read()).selectedIds, ['wall-under-roof'])
  assert.equal(await page.getByTestId('wall-elevation-board').count(), 0)
  await page.getByTestId('direct-transform').waitFor()
  const wallEnd = await point(1100, 500, 2600)
  await page.mouse.move(wallPoint.x, wallPoint.y)
  await page.mouse.down()
  await page.mouse.move(wallEnd.x, wallEnd.y, { steps: 8 })
  /** 마우스를 놓기 전 위치 입력값만 갱신하고 저장 배치와 실행 취소 이력 유지 검증 */
  assert.equal(Number(await page.getByTestId('instance-x').locator('input').inputValue()), 500)
  assert.equal(Number(await page.getByTestId('instance-y').locator('input').inputValue()), 500)
  assert.deepEqual((await read()).instances.find(({ id }) => id === 'wall-under-roof').position, {
    x: 0,
    y: 0,
    z: 0,
  })
  await page.mouse.up()
  const movedWall = (await read()).instances.find(({ id }) => id === 'wall-under-roof')
  assert.equal(movedWall.position.x, 500)
  assert.equal(movedWall.position.y, 500)
  await page.getByTestId('scene-undo').click()
  assert.deepEqual((await read()).instances.find(({ id }) => id === 'wall-under-roof').position, {
    x: 0,
    y: 0,
    z: 0,
  })
  /** 크기 조절 중 치수의 연속 갱신과 취소 복원 및 한 번의 확정 검증 */
  await page.mouse.click(wallPoint.x, wallPoint.y)
  const wallWidth = () =>
    page.getByTestId('instance-size-x').locator('input').inputValue().then(Number)
  const originalWallWidth = await wallWidth()
  const resizeWall = async () => {
    await page.getByTestId('direct-ne').waitFor({ state: 'visible' })
    const handle = await page.getByTestId('direct-ne').boundingBox()
    assert.ok(handle)
    const x = handle.x + handle.width / 2,
      y = handle.y + handle.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 35, y, { steps: 5 })
    return { x, y }
  }
  const resizing = await resizeWall()
  const firstWidth = await wallWidth()
  assert.ok(firstWidth > originalWallWidth)
  await page.mouse.move(resizing.x + 65, resizing.y, { steps: 5 })
  assert.ok((await wallWidth()) > firstWidth)
  assert.equal((await read()).instances.find(({ id }) => id === 'wall-under-roof').scale, undefined)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  assert.equal(await wallWidth(), originalWallWidth)
  await resizeWall()
  const committedWidth = await wallWidth()
  await page.mouse.up()
  assert.ok(committedWidth > originalWallWidth)
  assert.ok(
    Math.abs(
      (await read()).instances.find(({ id }) => id === 'wall-under-roof').scale.x *
        originalWallWidth -
        committedWidth,
    ) < 0.001,
  )
  await page.getByTestId('scene-undo').click()
  await page.mouse.click(wallPoint.x, wallPoint.y)
  assert.equal(await wallWidth(), originalWallWidth)
  /** 투명도 양 끝값과 완전 투명 벽의 색상 및 깊이와 그림자 제거 검증 */
  const opacity = page.getByTestId('wall-transparency')
  const transparencyLabel = page.getByTestId('wall-transparency-value')
  assert.equal(await opacity.inputValue(), '0')
  assert.equal(await transparencyLabel.innerText(), '벽 투명도 0%')
  assert.equal(await opacity.evaluate((node) => getComputedStyle(node).paddingLeft), '0px')
  assert.equal(
    await opacity.evaluate((node) => node.style.getPropertyValue('--wall-transparency')),
    '0%',
  )
  await opacity.locator('..').screenshot({ path: 'artifacts/wall-transparency-0.png' })
  await opacity.press('End')
  await page.waitForFunction(
    async () =>
      (await import('/src/features/facility-editor/index.ts')).useFacilityEditor().selected
        .wallOpacity === 0,
  )
  const invisible = await page.evaluate(() => window.__facilityMaterials('wall-under-roof'))
  assert.ok(
    invisible.length > 0 &&
      invisible.every(
        (material) =>
          material.opacity === 0 &&
          material.transparent &&
          !material.depthWrite &&
          !material.castShadow,
      ),
  )
  assert.equal(await transparencyLabel.innerText(), '벽 투명도 100%')
  assert.equal(
    await opacity.evaluate((node) => node.style.getPropertyValue('--wall-transparency')),
    '100%',
  )
  await opacity.locator('..').screenshot({ path: 'artifacts/wall-transparency-100.png' })
  await page.getByTestId('theme-toggle').click()
  await opacity.locator('..').screenshot({ path: 'artifacts/wall-transparency-dark-100.png' })
  await opacity.press('Home')
  await page.waitForFunction(
    async () =>
      (await import('/src/features/facility-editor/index.ts')).useFacilityEditor().selected
        .wallOpacity === 1,
  )
  assert.ok(
    (await page.evaluate(() => window.__facilityMaterials('wall-under-roof'))).every(
      (material) => material.opacity === 1,
    ),
  )
  await opacity.locator('..').screenshot({ path: 'artifacts/wall-transparency-dark-0.png' })
  await page.getByTestId('theme-toggle').click()
  /** 마우스를 누른 상태에서 백분율은 연속 갱신하고 저장은 조작 완료 시 한 번만 처리 검증 */
  await opacity.scrollIntoViewIfNeeded()
  const slider = await opacity.boundingBox()
  await page.mouse.move(slider.x + 7, slider.y + slider.height / 2)
  await page.mouse.down()
  await page.mouse.move(slider.x + slider.width * 0.45, slider.y + slider.height / 2, { steps: 5 })
  const intermediate = Number(await opacity.inputValue())
  assert.ok(intermediate > 0 && intermediate < 100)
  assert.equal(await transparencyLabel.innerText(), `벽 투명도 ${intermediate}%`)
  assert.equal((await read()).instances.find(({ id }) => id === 'wall-under-roof').wallOpacity, 1)
  await page.mouse.move(slider.x + slider.width * 0.75, slider.y + slider.height / 2, { steps: 5 })
  const finalTransparency = Number(await opacity.inputValue())
  assert.ok(finalTransparency > intermediate)
  assert.equal(await transparencyLabel.innerText(), `벽 투명도 ${finalTransparency}%`)
  await page.mouse.up()
  assert.ok(
    Math.abs(
      (await read()).instances.find(({ id }) => id === 'wall-under-roof').wallOpacity -
        (1 - finalTransparency / 100),
    ) < 0.000001,
  )
  await page.getByTestId('scene-undo').click()
  await page.getByTestId('scene-undo').click()
  await page.getByTestId('scene-undo').click()
  const pillarPoint = await point(2000, 1600, 2600)
  await page.mouse.click(pillarPoint.x, pillarPoint.y)
  assert.deepEqual((await read()).selectedIds, ['pillar-under-roof'])
  await page.getByTestId('instance-x').locator('input').fill('2300')
  await page.getByTestId('instance-y').locator('input').fill('1800')
  await page.getByTestId('instance-apply').click()
  assert.deepEqual((await read()).instances.find(({ id }) => id === 'pillar-under-roof').position, {
    x: 2300,
    y: 1800,
    z: 0,
  })
  await page.getByTestId('scene-undo').click()
  await ceilingToggle.click()
  await page.waitForFunction(() => window.__facilityInstanceScale('covering-roof') > 0)
  assert(await page.evaluate(() => window.__facilityInstanceScale('roof-fixture') > 0))
  assert(await page.evaluate(() => window.__facilityInstanceScale('fixture-child') > 0))
  await page.mouse.click(wallPoint.x, wallPoint.y)
  assert.deepEqual((await read()).selectedIds, ['covering-roof'])
  await ceilingToggle.click()
  await page.waitForFunction(() =>
    ['covering-roof', 'roof-fixture', 'fixture-child'].every(
      (id) => window.__facilityInstanceScale(id) === 0,
    ),
  )
  await page.mouse.click(wallPoint.x, wallPoint.y)
  assert.deepEqual((await read()).selectedIds, ['wall-under-roof'])
  assert(await viewport.evaluate((node) => node.isConnected))
  await page.getByTestId('building-wall-view').click()
  await page.getByTestId('wall-elevation-board').waitFor()
  await page.getByTestId('building-structure-view').click()
  assert.equal(await page.getByTestId('wall-elevation-board').count(), 0)
  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await page.getByTestId('site-preview').click()
  await page.waitForFunction(() => window.__facilityInstanceScale('covering-roof') > 0)
  await page.getByTestId('site-preview').click()
  await page.waitForFunction(() =>
    ['covering-roof', 'roof-fixture', 'fixture-child'].every(
      (id) => window.__facilityInstanceScale(id) === 0,
    ),
  )
  assert.deepEqual(errors, [])
  console.log(
    'Facility selection: marquee, Shift toggle, port offsets, live position and dimensions, resize cancel and undo, transparency endpoints and live percentage, structure editing through ceiling, attached visibility, explicit wall editor, and preview restoration passed',
  )
} catch (error) {
  await page?.screenshot({ path: 'artifacts/facility-selection-failure.png' })
  console.error(error.message)
  throw error
} finally {
  await browser?.close()
  await server.close()
}
