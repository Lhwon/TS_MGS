/**
 * 파일명: check-mgs-workspace.mjs
 * 설명: 기존 MGS 작업 영역의 구성과 작은 화면 배치 및 지도 도구 이관 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-23
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.MGS_PLAYWRIGHT ??
    'C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
)
const { readProjectBayFilter, saveProjectBayFilter } = require('../electron/map-files.cjs')
const root = path.resolve(import.meta.dirname, '..')
const temp = await mkdtemp(path.join(tmpdir(), 'mgs-workspace-'))
const server = await createServer({
  root,
  cacheDir: path.join(temp, 'vite'),
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
  plugins: [
    {
      name: 'mgs-workspace-projection',
      enforce: 'pre',
      transform: (source, id) =>
        id.replaceAll('\\', '/').endsWith('/map-canvas/lib/MapScene.ts')
          ? source.replace(
              '  return {\n    capture,',
              String.raw`
  ;(window as any).__mgsProject = (x: number, y: number) => {
    camera.updateMatrixWorld()
    const point = new THREE.Vector3(x, y, 0).project(camera)
    const rect = renderer.domElement.getBoundingClientRect()
    return { x: rect.left + (1 + point.x) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 }
  }
  return {
    capture,`,
            )
          : undefined,
    },
  ],
})
let browser
try {
  const mapDir = path.join(temp, 'RCS', 'MAP')
  const setting = path.join(temp, 'RCS', 'SETTING')
  await mkdir(mapDir, { recursive: true })
  await mkdir(setting)
  const ini = path.join(setting, 'SYSTEM.INI')
  const original =
    '[Common]\r\nname=테스트\r\n\r\n[Bay]\r\n; keep\r\nbay_to_use=8;3;\r\n\r\n[Other]\r\nvalue=1\r\n'
  for (const encoding of ['utf8', 'utf16le']) {
    const bom = encoding === 'utf16le' ? '\uFEFF' : ''
    await writeFile(ini, bom + original, encoding)
    assert.deepEqual(await readProjectBayFilter(mapDir), [3, 8])
    await saveProjectBayFilter(mapDir, [7, 3, 7])
    assert.equal(await readFile(ini, encoding), bom + original.replace('8;3;', '3;7;'))
  }

  await server.listen()
  browser = await chromium.launch({
    headless: true,
    channel: 'msedge',
    args: ['--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  await page.getByTestId('mgs-workspace').waitFor()
  await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    const { emptyDocument, serializeLegacy, previewLegacy } =
      await import('/src/entities/map/index.ts')
    const editor = useEditor()
    const map = emptyDocument()
    map.nodes = [
      { id: 1, x: -1200, y: -400, name: 'N1', realId: 10 },
      { id: 2, x: 1200, y: -400, name: 'N2', realId: 20 },
      { id: 3, x: 1200, y: 1200, name: 'N3', realId: 30 },
    ]
    map.edges = [
      { id: 'edge-a', from: 1, to: 2, direction: 0, bays: [1] },
      { id: 'edge-b', from: 2, to: 3, direction: 0, bays: [2] },
    ]
    map.ports = [
      {
        id: 'P1',
        name: 'Load',
        nodeId: 2,
        x: 1200,
        y: 100,
        width: 500,
        height: 400,
        bays: [2],
        settings: { b_load_port: 1, b_isolation_port: 1, b_low_height_port: 1 },
      },
    ]
    const legacy = serializeLegacy(map).content
    if (previewLegacy(legacy, 'fixture.jmapx').ports[0].settings.b_low_height_port !== 1)
      throw new Error('포트 후행 유형 설정 저장 복원 실패')
    editor.load(JSON.stringify(map), 'workspace-fixture.json')
    window.__mgsEditor = editor
  })
  const workspace = page.getByTestId('mgs-workspace')
  const quick = page.getByTestId('mgs-quick')
  const ribbon = page.getByTestId('mgs-ribbon')
  const tab = (name) => ribbon.getByRole('tab', { name, exact: true })
  assert.deepEqual(await ribbon.getByRole('tab').allInnerTexts(), [
    'File',
    'View',
    'Drawing',
    'Data',
    'Vehicle',
    'Shape',
    'GRID',
    'Expert / Developer',
  ])
  assert.deepEqual(
    (await quick.locator('button').allInnerTexts()).map((label) => label.trim()).filter(Boolean),
    [
      '[E] Edit Port',
      'Render VHL',
      'Set Real ID',
      'Verify Node',
      'Verify Path',
      'Verify Port',
      '[P] Path Plan Test',
      'Show Layout',
      'Use Crosshair',
      'Capture',
      'Map Copy',
    ],
  )
  await page.getByTestId('mgs-summary').getByLabel('추가할 Bay').selectOption('2')
  await page.getByTestId('mgs-summary').getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByTestId('mgs-summary').getByRole('button', { name: 'Apply', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(() => window.__mgsEditor.visibleDocument.edges.map((e) => e.id)),
    ['edge-b'],
  )
  await page.getByTestId('mgs-summary').getByRole('button', { name: 'Reset', exact: true }).click()
  const point = (x, y) => page.evaluate(([x, y]) => window.__mgsProject(x, y), [x, y])
  const before = await point(1200, -400)
  await quick.getByRole('button', { name: 'Rotate Map' }).click()
  const after = await point(1200, -400)
  assert.notDeepEqual(after, before)
  assert.equal(await page.evaluate(() => window.__mgsEditor.document.nodes[1].x), 1200)
  const canvas = workspace.locator('.map-viewport canvas').first()
  await canvas.hover({ position: { x: 100, y: 110 } })
  await workspace.locator('.map-crosshair:not([hidden])').waitFor()
  await quick.getByRole('button', { name: 'Use Crosshair' }).click()
  assert.equal(await workspace.locator('.map-crosshair:not([hidden])').count(), 0)

  await tab('View').click()
  await ribbon.getByRole('combobox', { name: 'Port Type' }).selectOption('LowHeight Port')
  assert.equal(await page.evaluate(() => window.__mgsEditor.portDisplayType), 'LowHeight Port')
  await page.keyboard.press('m')
  await quick.getByRole('button', { name: 'Path Plan Test' }).click()
  const plan = page.getByTestId('path-plan-test')
  await plan.waitFor()
  for (const [x, y] of [
    [-1200, -400],
    [1200, 1200],
  ]) {
    const screen = await point(x, y)
    const target = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y)
      return [element?.tagName, element?.className, element?.closest('[role="dialog"]')?.className]
    }, screen)
    assert.equal(target[0], 'CANVAS', JSON.stringify({ screen, target }))
    await page.mouse.click(screen.x, screen.y)
  }
  assert.deepEqual(await page.evaluate(() => [...window.__mgsEditor.pathPlanTargets]), [1, 3])
  await plan.getByText('4,000 mm').waitFor({ timeout: 4000 })
  await page.waitForFunction(() => window.__mgsEditor.pathPlanPreview.length === 3)
  await plan.getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByRole('button', { name: 'Verify Blocking Data' }).click()
  const review = page.getByTestId('mgs-block-review')
  await review.locator('input[type=file]').setInputFiles({
    name: 'fixture.blk', mimeType: 'text/plain',
    buffer: Buffer.from('2\n1\t0\t1\t0\t1\t1\t1\t1\t2\t1\t2\t0\t0\t0\n'),
  })
  await review.getByText('PRE_O', { exact: true }).waitFor()
  await review.getByRole('button', { name: '1', exact: true }).click()
  await review.getByRole('button', { name: 'Draw', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => [...window.__mgsEditor.selectedIds]), [1, 2])

  for (const [width, height] of [
    [1440, 900],
    [1024, 640],
    [740, 620],
  ]) {
    await page.setViewportSize({ width, height })
    for (let theme = 0; theme < 2; theme++) {
      await page.getByTestId('theme-toggle').click()
      for (const name of ['File', 'View', 'Drawing', 'Data', 'Vehicle', 'Expert / Developer']) {
        await tab(name).click()
        const violations = await ribbon.locator('.ribbon-label').evaluateAll((labels) =>
          labels
            .filter((label) => {
              const section = label.closest('button').getBoundingClientRect()
              const text = label.getBoundingClientRect()
              return (
                text.bottom > section.bottom + 1 ||
                text.left < section.left - 1 ||
                text.right > section.right + 1 ||
                text.top < section.top - 1
              )
            })
            .map((label) => label.textContent),
        )
        assert.deepEqual(violations, [], `${width}px ${name}`)
      }
      const bounds = await workspace.locator('.mgs-map').boundingBox()
      assert.ok(bounds && bounds.height > 180 && bounds.x + bounds.width <= width + 1)
      const cards = await workspace
        .locator('.selected-actions button')
        .evaluateAll((buttons) => buttons.map((button) => [button.offsetLeft, button.offsetTop]))
      assert.equal(new Set(cards.map(([x]) => x)).size, 3)
      assert.equal(new Set(cards.map(([, y]) => y)).size, 2)
    }
  }

  if (process.env.MGS_WORKSPACE_SCREENSHOT) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await tab('Data').click()
    await page.screenshot({ path: process.env.MGS_WORKSPACE_SCREENSHOT })
  }
  assert.deepEqual(errors, [])
  console.log(
    'MGS workspace layout, both themes, rotate, crosshair, Bay INI, port types and path picking passed',
  )
} finally {
  await browser?.close()
  await server.close()
  await rm(temp, { recursive: true, force: true })
}
