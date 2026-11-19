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
                '  return {',
            )
          : undefined,
    },
  ],
})
await server.listen()
let browser
try {
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 1520, height: 980 } })
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
  await page.getByRole('button', { name: '위에서 보기' }).click()
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
  assert.equal(await page.getByTestId('tool-scale').isDisabled(), true)
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
  assert.deepEqual(errors, [])
  console.log(
    'Facility selection: marquee, Shift toggle, port offsets, XY-only edits, and undo passed',
  )
} finally {
  await browser?.close()
  await server.close()
}
