import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'

const require = createRequire(import.meta.url)
const {
  chromium,
} = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1720, height: 1080 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5188/')
  await page.evaluate(async () => {
    const map = (await import('/src/features/map-editor/model/editor.ts')).useEditor()
    map.load(
      JSON.stringify({
        format: 'ts-mgs',
        version: 1,
        name: 'Rotation check',
        units: 'mm',
        nodes: [{ id: 1, x: 0, y: 0, name: 'N1' }],
        edges: [],
        ports: [],
      }),
      'rotation-check.json',
    )
  })
  await page.getByTestId('mode-facility').click()
  await page.getByTestId('default-catalog').click()
  await page
    .getByTestId('model-catalog')
    .getByRole('button', { name: /나무 박스 적재물 · 단품/ })
    .click()
  await page.getByTestId('place-center').click()
  const input = page.getByTestId('instance-carrier-rotation').locator('input')
  await assert.equal(await input.isDisabled(), true)
  await page.evaluate(async () => {
    const studio = (
      await import('/src/features/facility-editor/model/studio.ts')
    ).useFacilityEditor()
    const map = (await import('/src/features/map-editor/model/editor.ts')).useEditor()
    map.document.ports.push({ id: 'P1', x: 0, y: 0 })
    studio.updateInstance(studio.selectedId, { portId: 'P1' })
  })
  await input.fill('90')
  await page.getByTestId('instance-apply').click()
  const saved = await page.evaluate(async () => {
    const studio = (
      await import('/src/features/facility-editor/model/studio.ts')
    ).useFacilityEditor()
    let snapshot
    window.desktop = {
      setDirty: () => {},
      saveScene: async (text) => {
        snapshot = JSON.parse(text)
        return 'rotation-check.json'
      },
    }
    await studio.save()
    return snapshot.instances[0]
  })
  assert.equal(saved.carrierRotation, 90)
  assert.equal(saved.rotation, 0)
  await fs.mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/carrier-rotation.png' })
  await input.fill('')
  await page.getByTestId('instance-apply').click()
  assert.equal(
    await page.evaluate(
      async () =>
        (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().selected
          .carrierRotation,
    ),
    undefined,
  )
  assert.deepEqual(errors, [])
  console.log(
    'Carrier rotation editor: disabled without port, explicit angle, saved JSON, independent facility rotation and automatic reset passed',
  )
} finally {
  await browser.close()
}
