import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const {
  chromium,
} = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const output = path.resolve('artifacts/handling-models')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1720, height: 1080 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:5180/', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('mode-facility').waitFor()
  await page.evaluate(async () => {
    const code = await (await fetch('/src/widgets/facility-studio/lib/FacilityScene.ts')).text()
    const THREE = await import(code.match(/import \* as THREE from "([^"]+)"/)[1])
    const previous = THREE.Scene.prototype.onBeforeRender
    THREE.Scene.prototype.onBeforeRender = (renderer, scene, camera, ...rest) => {
      window.__handlingScene = scene
      Reflect.apply(previous, scene, [renderer, scene, camera, ...rest])
    }
    const map = (await import('/src/features/map-editor/model/editor.ts')).useEditor()
    map.load(
      JSON.stringify({
        format: 'ts-mgs',
        version: 1,
        name: 'Isolated model check',
        units: 'mm',
        nodes: [{ id: 1, x: 0, y: 0, name: 'N1' }],
        edges: [],
        ports: [],
      }),
      'model-check.json',
    )
    if (map.colorMode !== 'dark') map.toggleColorMode()
  })
  await page.getByTestId('mode-facility').click()
  await page.getByTestId('handling-catalog').click()
  await page.waitForFunction(
    async () =>
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().document
        .assets.length === 6,
  )
  assert.equal(await page.getByTestId('instance-count').textContent(), '0')
  await page.getByTestId('handling-catalog').click()
  assert.equal(await page.getByTestId('instance-count').textContent(), '0')
  const assets = await page.evaluate(async () =>
    structuredClone(
      (await import('/src/features/facility-editor/model/studio.ts'))
        .useFacilityEditor()
        .document.assets.map(({ id, name }) => ({ id, name })),
    ),
  )
  const meshes = {}
  for (const asset of assets) {
    await page.locator('.facility-library button').filter({ hasText: asset.name }).click()
    await page.getByTestId('place-center').click()
    await page.waitForFunction(async () => {
      const store = (
        await import('/src/features/facility-editor/model/studio.ts')
      ).useFacilityEditor()
      let count = 0
      window.__handlingScene?.traverse((object) => {
        if (object.userData.ids?.includes(store.selectedId)) count++
      })
      return count > 0
    })
    await page.getByTestId('selection-focus').click()
    await page.getByTestId('tool-select').click()
    await page.waitForTimeout(300)
    assert.equal(await page.locator('.facility-status.error').count(), 0)
    meshes[asset.id] = await page.evaluate(async () => {
      const store = (
        await import('/src/features/facility-editor/model/studio.ts')
      ).useFacilityEditor()
      let count = 0
      window.__handlingScene.traverse((object) => {
        if (object.userData.ids?.includes(store.selectedId)) count++
      })
      return count
    })
    await page
      .locator('.facility-canvas-wrap')
      .screenshot({ path: path.join(output, `${asset.id}.png`) })
    await page.getByTestId('instance-remove').click()
  }
  const stableSave = await page.evaluate(async () => {
    const store = (
      await import('/src/features/facility-editor/model/studio.ts')
    ).useFacilityEditor()
    const stale = structuredClone(store.document)
    const other = stale.assets.find((asset) => !asset.id.includes('wooden-crate'))
    for (const asset of stale.assets.filter((asset) => asset.id.includes('wooden-crate')))
      asset.glb = {
        ...other.glb,
        size: { x: 1200, y: 1016, z: asset.id.endsWith('-stack') ? 2000 : 1000 },
      }
    const previousDesktop = window.desktop
    let saved
    window.desktop = {
      saveScene: async (content) => {
        saved = JSON.parse(content)
        return 'test.map3d.json'
      },
    }
    try {
      store.document = stale
      await store.save()
      const sizes = saved.assets
        .filter((asset) => asset.id.includes('wooden-crate'))
        .map((asset) => asset.glb.size)
      const current = store.document.assets
        .filter((asset) => asset.id.includes('wooden-crate'))
        .map((asset) => asset.glb.size)
      return { sizes, current }
    } finally {
      window.desktop = previousDesktop
    }
  })
  assert.deepEqual(stableSave.sizes, [
    { x: 1800, y: 1016, z: 500 },
    { x: 1800, y: 1016, z: 1000 },
  ])
  assert.deepEqual(stableSave.current, stableSave.sizes)
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      libraryOnly: true,
      noAutomaticPlacement: true,
      repeatedImport: true,
      staleMemorySaveProtected: true,
      renderedModels: meshes,
      errors,
    }),
  )
} finally {
  await browser.close()
}
