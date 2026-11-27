/**
 * 실제 클릭과 배치 및 속성 편집을 통한 튜토리얼 완료 조건과 원본 복원 검증
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.MGS_PLAYWRIGHT ??
    'C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
)
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  plugins: [
    {
      name: 'tutorial-view-fixture',
      enforce: 'pre',
      transform: (source, id) => {
        if (id.replaceAll('\\', '/').endsWith('/packages/map3d/glb.ts'))
          return source.replace(
            'const parseSource = async (bytes: ArrayBuffer) => {',
            'const parseSource = async (bytes: ArrayBuffer) => { window.__tutorialParses = (window.__tutorialParses ?? 0) + 1;',
          )
        return id.replaceAll('\\', '/').endsWith('/facility-studio/lib/FacilityScene.ts')
          ? source.replace(
              /  resizeViewport\(\)\r?\n  return \{/,
              `
  resizeViewport()
  window.__tutorialScene = { camera, controls, setDocument, point: (x, y) => {
    const point = new THREE.Vector3(x / 1000, y / 1000, 0).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  } };
  return {`,
            )
          : undefined
      },
    },
  ],
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({
    headless: true,
    channel: 'msedge',
    args: ['--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 1520, height: 1000 } })
  const errors = [],
    downloads = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  await page.getByTestId('mode-facility').click()
  await page.waitForFunction(() => !!window.__tutorialScene)
  const glb = (await readFile('public/models/ceram-mp5/crate.glb')).toString('base64')
  await page.evaluate(async (data) => {
    const studio = (await import('/src/features/facility-editor/index.ts')).useFacilityEditor()
    studio.setAsset(
      {
        id: 'original',
        name: '원본 모델',
        kind: 'equipment',
        parts: [],
        glb: { data, size: { x: 1000, y: 800, z: 800 }, sourceName: 'crate.glb' },
      },
      { name: '원본 지도', geometryKey: '' },
    )
    studio.place(1200, 900)
    studio.duplicate()
    studio.undo()
    studio.selectedId = studio.document.instances[0].id
    studio.message = '보존할 원본 작업'
    await window.__tutorialScene.setDocument(studio.document)
  }, glb)
  await page.waitForFunction(() => !!window.__tutorialScene)
  /** 실제 문서와 미저장 상태 및 이력을 함께 비교하는 원본 스냅샷 반환 */
  const snapshot = () =>
    page.evaluate(async () => {
      const studio = (await import('/src/features/facility-editor/index.ts')).useFacilityEditor()
      const map = (await import('/src/features/map-editor/index.ts')).useEditor()
      return JSON.stringify({
        session: studio.captureSession(),
        dirty: studio.dirty,
        map: map.document,
      })
    })
  const original = await snapshot()
  const originalParses = await page.evaluate(() => window.__tutorialParses)
  assert.ok(originalParses > 0)
  const menu = (name) =>
    page.getByRole('tablist', { name: '3D 작업 메뉴' }).getByRole('tab', { name, exact: true })
  assert.deepEqual(
    (await page.getByRole('tablist', { name: '3D 작업 메뉴' }).getByRole('tab').allTextContents())
      .slice(-2)
      .map((name) => name.trim()),
    ['Tools', 'Help'],
  )
  const guide = page.locator('.scene-tutorial')
  /** 화면 단계와 실제 편집 결과를 대기한 뒤 다음 설명으로 이동 */
  const next = async (id) => {
    assert.equal(await guide.getAttribute('data-tutorial-step'), id)
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="tutorial-next"]').disabled,
    )
    await page.getByTestId('tutorial-next').click()
    await page.waitForFunction(
      (previous) =>
        document.querySelector('.scene-tutorial')?.getAttribute('data-tutorial-step') !== previous,
      id,
    )
  }
  /** 실제 뷰포트의 지도 좌표를 투영하여 포인터 클릭 실행 */
  const point = async (x, y) => {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const position = await page.evaluate(([px, py]) => window.__tutorialScene.point(px, py), [x, y])
    await page.mouse.click(position.x, position.y)
  }
  /** 원본 설계를 유지한 상태에서 지정한 연습 시나리오 시작 */
  const start = async (scenario) => {
    await menu('Help').click()
    await page.getByTestId('scene-tutorial').click()
    await page.getByTestId(`tutorial-start-${scenario}`).click()
    await guide.waitFor()
  }
  const camera = await page.evaluate(() => ({
    position: window.__tutorialScene.camera.position.toArray(),
    target: window.__tutorialScene.controls.target.toArray(),
    zoom: window.__tutorialScene.camera.zoom,
  }))
  await start('equipment')
  assert.equal(await page.getByTestId('tutorial-next').isDisabled(), true)
  const protectsOriginal = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
  assert.equal(protectsOriginal, true)
  await page.keyboard.press('Control+s')
  await menu('Facility').click()
  await next('facility-menu')
  await page.getByTestId('default-catalog').click()
  await next('catalog')
  await page.getByTestId('catalog-model-tutorial-practice-equipment').click()
  await next('choose')
  assert.equal(await page.getByTestId('tutorial-next').isDisabled(), true)
  await point(0, 0)
  await next('place')
  await page.locator('[data-scene-id]').filter({ hasText: '연습용 설비' }).click()
  await next('explorer')
  await page.getByTestId('instance-name').locator('input').fill('연습 설비')
  await next('name-input')
  await page.getByTestId('instance-apply').click()
  await next('name-apply')
  const targetX = await page.evaluate(
    async () =>
      (await import('/src/features/facility-editor/index.ts')).useFacilityEditor().document
        .instances[0].position.x + 1000,
  )
  await page.getByTestId('instance-x').locator('input').fill(String(targetX))
  await next('position-input')
  await page.getByTestId('instance-apply').click()
  await next('position-apply')
  await page.getByTestId('scene-undo').click()
  await next('undo')
  await page.getByTestId('scene-redo').click()
  await next('redo')
  await menu('File').click()
  await next('file-menu')
  await page.keyboard.press('Control+s')
  await next('complete')
  await guide.waitFor({ state: 'detached' })
  assert.equal(await snapshot(), original)
  assert.equal(await page.evaluate(() => window.__tutorialParses), originalParses)
  const restoredCamera = await page.evaluate(() => ({
    position: window.__tutorialScene.camera.position.toArray(),
    target: window.__tutorialScene.controls.target.toArray(),
    zoom: window.__tutorialScene.camera.zoom,
  }))
  for (const key of ['position', 'target'])
    restoredCamera[key].forEach((value, index) =>
      assert.ok(Math.abs(value - camera[key][index]) < 1e-9),
    )
  assert.equal(restoredCamera.zoom, camera.zoom)

  await start('building')
  await menu('Building').click()
  await next('building-menu')
  await page.getByTestId('floor-rectangle').click()
  await next('floor-tool')
  await point(-2000, -1000)
  assert.equal(await page.getByTestId('tutorial-next').isDisabled(), true)
  await point(2000, 1000)
  await next('floor-place')
  await page.getByTestId('floor-material').selectOption('tile')
  await page.getByTestId('floor-apply').click()
  await next('floor-material')
  await page.getByTestId('interior-wall').click()
  await next('wall-tool')
  await point(-2000, -1000)
  await point(2000, -1000)
  await next('wall-place')
  await page.getByTestId('place-ceiling').click()
  await next('ceiling-tool')
  await point(-2000, -1000)
  await point(2000, 1000)
  await next('ceiling-place')
  await page.getByTestId('building-show-ceiling').click()
  await next('ceiling-show')
  await page.getByTestId('building-show-ceiling').click()
  await next('ceiling-hide')
  await next('complete')
  await guide.waitFor({ state: 'detached' })
  assert.equal(await snapshot(), original)

  /** 중도 종료와 테마 변경 후 반복 실행에서도 원본 복원 검증 */
  await page.evaluate(async () =>
    (await import('/src/features/map-editor/index.ts')).useEditor().toggleColorMode(),
  )
  const afterTheme = await snapshot()
  await start('equipment')
  await menu('Facility').click()
  await next('facility-menu')
  await page.keyboard.press('Escape')
  await guide.waitFor({ state: 'detached' })
  assert.equal(await snapshot(), afterTheme)
  await start('building')
  await page.getByTestId('tutorial-exit').click()
  await guide.waitFor({ state: 'detached' })
  assert.equal(await snapshot(), afterTheme)
  assert.equal(await page.evaluate(() => window.__tutorialParses), originalParses)
  await start('equipment')
  await page.evaluate(async () =>
    (await import('/src/shared/lib/input/index.ts')).executeAppCommand('workspace.mode', {
      mode: 'map',
    }),
  )
  await guide.waitFor({ state: 'detached' })
  assert.equal(await snapshot(), afterTheme)
  await page.getByTestId('mode-facility').click()
  await menu('Help').waitFor()
  assert.deepEqual(downloads, [])
  assert.deepEqual(errors, [])
  console.log(
    '3D tutorials: both interactive scenarios, action gates, placement, properties, undo/redo, keyboard save protection, cancellation, themes and original document/history/selection/camera restoration passed',
  )
} finally {
  await browser?.close()
  await server.close()
}
