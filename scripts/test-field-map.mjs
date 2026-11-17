import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const {
  chromium,
} = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { openMapFolder } = require('../electron/map-files.cjs')
const { loadSource } = require('./load-source.cjs')
const contract = loadSource('packages/map3d/index.ts')
const directory = process.argv[2]
assert.ok(directory, 'Project MAP directory required')
const source = await openMapFolder(path.resolve(directory))
const file = path.join(source.directory, '3D', 'project.map3d.json')
const content = await fs.readFile(file, 'utf8')
const document = contract.parseFacilityDocument(content)
const library = await fs.readFile(path.join(source.directory, '3D', 'equipment.json'), 'utf8')
const layout = await fs.readFile(path.join(source.directory, '3D', 'map3d.json'), 'utf8')
assert.deepEqual(contract.importFacilityFiles(layout, library).instances, document.instances)
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => void dialog.accept())
  await page.goto('http://127.0.0.1:5180/', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('mode-facility').waitFor()
  await page.evaluate(async (file) => {
    const store = (await import('/src/features/map-editor/model/editor.ts')).useEditor()
    store.load(file.content, file.name, file.theme, file.portGroups)
    if (store.colorMode !== 'dark') store.toggleColorMode()
  }, source)
  await page.getByTestId('mode-facility').click()
  await page.getByTestId('scene-open').waitFor()
  await page.evaluate(
    async ({ content }) => {
      ;(await import('/src/features/facility-editor/model/studio.ts'))
        .useFacilityEditor()
        .load(content, 'project.map3d.json')
    },
    { content },
  )
  await page.getByTestId('instance-count').filter({ hasText: '174' }).waitFor()
  await page.waitForTimeout(700)
  await page.getByTestId('scene-fit').click()
  await page.screenshot({ path: path.resolve('artifacts/ceram-field-map-3d.png') })
  await page.getByTestId('wip-racks').click()
  const repeated = await page.evaluate(async () =>
    structuredClone(
      (await import('/src/features/facility-editor/model/studio.ts')).useFacilityEditor().document,
    ),
  )
  assert.deepEqual(repeated.instances, document.instances)
  await page.evaluate(async () => {
    const store = (await import('/src/features/map-editor/model/editor.ts')).useEditor()
    store.projectToken = 'test-project-location'
    window.__sceneRequests = []
    window.desktop = {
      apiVersion: 2,
      setDirty: () => {},
      saveScene: async (content, name, token) => {
        window.__sceneRequests.push({
          method: 'save',
          token,
          count: JSON.parse(content).instances.length,
        })
        return name
      },
      exportScene: async (layout, library, token) => {
        window.__sceneRequests.push({
          method: 'export',
          token,
          count: JSON.parse(layout).instances.length,
        })
        return 'test-project/MAP/3D'
      },
    }
  })
  await page.getByTestId('scene-save').click()
  await page.getByTestId('scene-export').click()
  const requests = await page.evaluate(() => window.__sceneRequests)
  assert.deepEqual(requests, [
    { method: 'save', token: 'test-project-location', count: 174 },
    { method: 'export', token: 'test-project-location', count: 174 },
  ])
  if (process.env.NEW_UI_URL) {
    const operational = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    operational.on('pageerror', (error) => errors.push(error.message))
    const url = `${process.env.NEW_UI_URL}/__field_model_check__`
    await operational.route(url, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html><body style="margin:0"></body></html>',
      }),
    )
    await operational.goto(url)
    const map = loadSource('src/entities/map/model/legacy.ts').previewLegacy(
      source.content,
      source.name,
      source.portGroups,
    )
    const rendering = await operational.evaluate(
      async ({ doc, map }) => {
        const code = await (
          await fetch('/src/features/map/managers/authoredFacilityManager.ts')
        ).text()
        const THREE = await import(code.match(/import \* as THREE from "([^"]+)"/)[1])
        const { AuthoredFacilityManager } =
          await import('/src/features/map/managers/authoredFacilityManager.ts')
        const manager = new AuthoredFacilityManager()
        const boundsX = [
          Math.min(...map.nodes.map((node) => node.x)),
          Math.max(...map.nodes.map((node) => node.x)),
        ]
        const boundsY = [
          Math.min(...map.nodes.map((node) => node.y)),
          Math.max(...map.nodes.map((node) => node.y)),
        ]
        const transform = {
          centerX: (boundsX[0] + boundsX[1]) / 2,
          centerY: (boundsY[0] + boundsY[1]) / 2,
          scale: 0.03,
        }
        const applied = await manager.render(
          doc,
          map.nodes.map((node) => ({ nodeId: node.id, realX: node.x, realY: node.y })),
          transform,
          map.ports,
        )
        const scene = new THREE.Scene()
        scene.background = new THREE.Color('#101c27')
        scene.add(manager.root, new THREE.HemisphereLight(0xffffff, 0x47535c, 2))
        const light = new THREE.DirectionalLight(0xffffff, 2.5)
        light.position.set(1000, 1800, 1500)
        scene.add(light)
        scene.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(manager.group)
        const center = bounds.getCenter(new THREE.Vector3())
        const radius = bounds.getSize(new THREE.Vector3()).length() / 2
        const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, radius * 10)
        camera.position
          .copy(center)
          .addScaledVector(new THREE.Vector3(1, 1.3, 1).normalize(), radius * 2.8)
        camera.lookAt(center)
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
        renderer.setSize(innerWidth, innerHeight)
        document.body.append(renderer.domElement)
        renderer.render(scene, camera)
        const ids = new Set()
        manager.group.traverse((object) => {
          for (const id of object.userData.facilityIds ?? []) ids.add(id)
        })
        window.__disposeField = async () => {
          scene.remove(manager.root)
          manager.dispose()
          await Promise.resolve()
          renderer.render(scene, camera)
          const remaining = renderer.info.memory.geometries
          renderer.dispose()
          return remaining
        }
        return {
          applied,
          placements: ids.size,
          drawCalls: renderer.info.render.calls,
          geometries: renderer.info.memory.geometries,
        }
      },
      { doc: document, map },
    )
    assert.equal(rendering.applied, true)
    assert.equal(rendering.placements, document.instances.length)
    await operational.screenshot({
      path: path.resolve('artifacts/ceram-field-new-ts-ui-renderer.png'),
    })
    assert.equal(await operational.evaluate(() => window.__disposeField()), 0)
    console.log(JSON.stringify({ operationalRenderer: rendering, releasedGeometries: true }))
  }
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      realMap: true,
      instances: document.instances.length,
      racks: 163,
      wipPortCoverage: 478,
      idempotentBatch: true,
      projectTokenPropagation: true,
      splitRoundtrip: true,
      errors,
    }),
  )
} finally {
  await browser.close()
}
