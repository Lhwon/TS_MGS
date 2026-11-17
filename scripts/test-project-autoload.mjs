import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const {
  chromium,
} = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { openMapFolder } = require('../electron/map-files.cjs')
const source = await openMapFolder(path.resolve(process.argv[2]))
const content = await fs.readFile(path.join(source.directory, '3D', 'project.map3d.json'), 'utf8')
const doc = JSON.parse(content)
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 960 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => void dialog.accept())
  await page.addInitScript(
    ({ source, content }) => {
      window.__sceneReads = []
      window.__project = 'project-a'
      window.__projectScene = content
      window.desktop = {
        apiVersion: 2,
        setDirty: () => {},
        openMap: async () => ({ ...source, token: window.__project }),
        readProjectScene: async (token) => {
          window.__sceneReads.push(token)
          return window.__projectScene === null
            ? null
            : { name: 'project.map3d.json', content: window.__projectScene }
        },
      }
    },
    { source, content },
  )
  await page.goto('http://127.0.0.1:5180/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-command="BT_open_file"]').click()
  assert.deepEqual(await page.evaluate(() => window.__sceneReads), [])
  await page.getByTestId('mode-facility').click()
  await page.getByTestId('instance-count').filter({ hasText: '174' }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.__sceneReads), ['project-a'])
  await page.evaluate(async () => {
    const store = (
      await import('/src/features/facility-editor/model/studio.ts')
    ).useFacilityEditor()
    store.updateInstance(store.document.instances[0].id, { name: '사용자 편집 랙' })
  })
  await page.getByTestId('mode-map').click()
  await page.getByTestId('mode-facility').click()
  assert.deepEqual(await page.evaluate(() => window.__sceneReads), ['project-a'])
  assert.equal(
    await page.evaluate(
      async () =>
        (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().document
          .instances[0].name,
    ),
    '사용자 편집 랙',
  )
  /** 다른 프로젝트 지도를 다시 열고 삼차원 자동 로딩을 실행하는 화면 전환 */
  const openProject = async (token, scene) => {
    await page.getByTestId('mode-map').click()
    await page.evaluate(
      ({ token, scene }) => {
        window.__project = token
        window.__projectScene = scene
      },
      { token, scene },
    )
    await page.locator('[data-command="BT_open_file"]').click()
    await page.getByTestId('mode-facility').click()
  }
  await openProject('project-b', JSON.stringify({ ...doc, instances: doc.instances.slice(0, 1) }))
  await page.waitForFunction(
    async () =>
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().document
        .instances.length === 1,
  )
  await openProject(
    'project-mismatch',
    JSON.stringify({ ...doc, mapRef: { ...doc.mapRef, geometryKey: 'different-map' } }),
  )
  await page.getByRole('status').filter({ hasText: '기준 좌표와 현재 2D 맵이 다릅니다' }).first().waitFor()
  assert.equal(await page.getByTestId('instance-count').textContent(), '0')
  await openProject('project-empty', null)
  await page.getByRole('status').filter({ hasText: '3D 설계 파일이 없습니다' }).first().waitFor()
  assert.equal(await page.getByTestId('instance-count').textContent(), '0')
  assert.deepEqual(await page.evaluate(() => window.__sceneReads), [
    'project-a',
    'project-b',
    'project-mismatch',
    'project-empty',
  ])
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      automatic3D: true,
      projectSwitch: true,
      preservesEdits: true,
      missingFile: true,
      geometryMismatch: true,
      noRepeatedImport: true,
      errors,
    }),
  )
} finally {
  await browser.close()
}
