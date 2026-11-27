/**
 * 개별 조명 편집과 실행 취소 및 렌더링 캐시의 실제 화면 회귀 검증
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const {
  chromium,
} = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'mgs-light-angles-'))
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({
    headless: true,
    channel: 'msedge',
    args: ['--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 1540, height: 1100 } })
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (
      /Failed to resolve component/.test(message.text()) ||
      (message.type() === 'error' && /WebGL|shader|GL_INVALID/.test(message.text()))
    )
      errors.push(message.text())
  })
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  await page.getByTestId('mode-facility').click()
  await page.evaluate(async () => {
    const sceneCode = await (
      await fetch('/src/widgets/facility-studio/lib/FacilityScene.ts')
    ).text()
    const THREE = await import(sceneCode.match(/import \* as THREE from "([^"]+)"/)[1])
    const { Scene } = THREE
    const previous = Scene.prototype.onBeforeRender
    Scene.prototype.onBeforeRender = function (renderer, scene, camera, ...rest) {
      if (scene.getObjectByName('showroom-fixtures'))
        window.lightingView = { renderer, scene, camera }
      previous.call(this, renderer, scene, camera, ...rest)
    }
    const glbCode = await (await fetch('/packages/map3d/glb.ts')).text()
    const { GLTFLoader } = await import(glbCode.match(/import { GLTFLoader } from "([^"]+)"/)[1])
    const parse = GLTFLoader.prototype.parse
    window.modelParses = 0
    GLTFLoader.prototype.parse = function (...args) {
      window.modelParses++
      return parse.apply(this, args)
    }
    const { GLTFExporter } =
      await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js')
    const fixture = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.2, 16),
      new THREE.MeshStandardMaterial({
        color: '#cccccc',
        emissive: '#ffffff',
        emissiveIntensity: 0.2,
      }),
    )
    fixture.position.y = 0.1
    const bytes = await new GLTFExporter().parseAsync(fixture, { binary: true })
    const asset = {
      id: 'test-spot',
      name: '검증용 조명',
      kind: 'equipment',
      parts: [],
      catalogCategory: 'lighting',
      glb: {
        data: btoa(String.fromCharCode(...new Uint8Array(bytes))),
        sourceName: 'test-spot.glb',
        size: { x: 200, y: 200, z: 200 },
      },
    }
    const editor = (await import('/src/features/map-editor/index.ts')).useEditor()
    editor.load(
      JSON.stringify({
        format: 'ts-mgs',
        version: 1,
        name: '조명 각도 검증',
        units: 'mm',
        nodes: [{ id: 1, name: 'N1', x: 0, y: 0 }],
        edges: [],
        ports: [],
      }),
      'light-test.json',
    )
    const studio = (await import('/src/features/facility-editor/index.ts')).useFacilityEditor()
    studio.commit((doc) => {
      doc.assets = [{ ...asset, light: { kind: 'spot', temperature: 4000 } }]
      doc.instances = ['lamp-a', 'lamp-b'].map((id, index) => ({
        id,
        assetId: asset.id,
        name: id,
        position: { x: index * 2500, y: 0, z: 3000 },
        rotation: 0,
      }))
      doc.floors = [
        {
          id: 'floor',
          name: '조명 확인 바닥',
          material: 'epoxy',
          color: '#bdbdbd',
          repeatMm: 1000,
          rotation: 0,
          points: [
            { x: -3000, y: -4000 },
            { x: 7000, y: -4000 },
            { x: 7000, y: 4000 },
            { x: -3000, y: 4000 },
          ],
        },
      ]
    })
    studio.selectedId = 'lamp-a'
  })
  await page.waitForFunction(
    () => window.lightingView?.scene.getObjectByName('showroom-fixtures')?.children.length === 2,
  )
  console.log('조명 장면 로딩 완료')
  await page.evaluate(() => {
    window.lightingView.camera.position.set(9, -10, 10)
    window.lightingView.camera.lookAt(1, 0, 1)
    window.lightingView.renderer.render(window.lightingView.scene, window.lightingView.camera)
  })
  const initial = await page.evaluate(() => ({
    parses: window.modelParses,
    camera: window.lightingView.camera.position.toArray(),
    canvas: window.lightingView.renderer.domElement.outerHTML,
  }))
  assert(initial.parses > 0)
  const inspector = page.locator('.facility-inspector')
  await inspector.getByTestId('light-tilt').locator('input').fill('45')
  await inspector.getByTestId('light-direction').locator('input').fill('90')
  await inspector.getByTestId('light-beamAngle').locator('input').fill('35')
  const softness = inspector.getByTestId('light-penumbra').getByRole('slider')
  await softness.press('Home')
  await softness.press('End')
  await inspector.getByTestId('light-angle-apply').click()
  console.log('개별 조명 각도 적용 요청 완료')
  await page.waitForFunction(
    () =>
      window.lightingView.scene.getObjectByName('showroom-fixtures').children[0].userData
        .fixtureAngles.tilt === 45,
  )
  const changed = await page.evaluate(async () => {
    const studio = (await import('/src/features/facility-editor/index.ts')).useFacilityEditor()
    const { scene, camera } = window.lightingView
    return {
      instances: structuredClone(studio.document.instances),
      parses: window.modelParses,
      camera: camera.position.toArray(),
      guide: scene.getObjectByName('facility-light-direction-guide').visible,
      angles: scene
        .getObjectByName('showroom-fixtures')
        .children.map((light) => light.userData.fixtureAngles),
      mask: scene.getObjectByName('showroom-fixtures').children.map((light) => light.layers.mask),
    }
  })
  assert.equal(changed.instances[0].light.tilt, 45)
  assert.equal(changed.instances[0].light.penumbra, 1)
  assert.equal(changed.instances[1].light, undefined)
  assert.equal(changed.angles[1].tilt, 0)
  assert(changed.guide)
  assert.deepEqual(changed.camera, initial.camera)
  assert.deepEqual(changed.mask, [0, 0])
  assert.equal(changed.parses, initial.parses)
  console.log('개별 조명과 GLB 재사용 검증 완료')
  await page.evaluate(async () =>
    (await import('/src/features/facility-editor/index.ts')).useFacilityEditor().undo(),
  )
  await page.waitForFunction(
    () =>
      window.lightingView.scene.getObjectByName('showroom-fixtures').children[0].userData
        .fixtureAngles.tilt === 0,
  )
  await page.evaluate(async () =>
    (await import('/src/features/facility-editor/index.ts')).useFacilityEditor().redo(),
  )
  await page.waitForFunction(
    () =>
      window.lightingView.scene.getObjectByName('showroom-fixtures').children[0].userData
        .fixtureAngles.tilt === 45,
  )
  await page.evaluate(async () => {
    ;(await import('/src/features/facility-editor/index.ts')).useFacilityEditor().selectedId =
      'lamp-a'
  })
  await inspector.getByRole('button', { name: /모델 기본 조명 설정/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByTestId('light-tilt').locator('input').fill('20')
  await dialog.getByTestId('catalog-light-save').click()
  await page.waitForFunction(
    () =>
      window.lightingView.scene.getObjectByName('showroom-fixtures').children[1].userData
        .fixtureAngles.tilt === 20,
  )
  const inherited = await page.evaluate(() =>
    window.lightingView.scene
      .getObjectByName('showroom-fixtures')
      .children.map((light) => light.userData.fixtureAngles.tilt),
  )
  assert.deepEqual(inherited, [45, 20])
  await page.evaluate(async () => {
    ;(await import('/src/features/facility-editor/index.ts')).useFacilityEditor().selectedId =
      'lamp-b'
  })
  await inspector.getByTestId('instance-name').locator('input').fill('이름만 변경한 조명')
  await inspector.getByTestId('light-angle-apply').click()
  const renamed = await page.evaluate(async () => {
    const studio = (await import('/src/features/facility-editor/index.ts')).useFacilityEditor()
    const instance = studio.document.instances.find(({ id }) => id === 'lamp-b')
    return { name: instance.name, light: instance.light }
  })
  assert.equal(renamed.name, '이름만 변경한 조명')
  assert.equal(renamed.light, undefined)
  for (const theme of ['dark', 'light']) {
    await page.evaluate(async (theme) => {
      const editor = (await import('/src/features/map-editor/index.ts')).useEditor()
      if (editor.colorMode !== theme) editor.toggleColorMode()
      await Promise.allSettled(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
          .map((animation) => animation.finished),
      )
    }, theme)
    await page.screenshot({ path: path.join(output, `lighting-${theme}.png`) })
  }
  await page.evaluate(() =>
    window.lightingView.renderer.compile(window.lightingView.scene, window.lightingView.camera),
  )
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      result: '개별 편집과 기본값 상속 및 실행 취소와 다시 실행 검증 통과',
      parseCount: initial.parses,
      shaderErrors: errors,
      output,
    }),
  )
} finally {
  await browser?.close()
  await server.close()
}

/** 관제 프로젝트의 실제 Three 버전과 셰이더로 각도 반영 및 텍스처 해제 검증 */
const checkUiRenderer = async () => {
  const root = path.resolve('../../total_solution/TS_UI')
  const html = `<!doctype html><html><head><meta charset="UTF-8"><link rel="icon" href="data:,"></head><body style="margin:0"><script type="module">
import * as THREE from 'three'
import {createFacilityLights} from '/src/widgets/digital-twin/engine/glbLights.ts'
import {bakeFacilityFloorLightMap} from '/src/widgets/digital-twin/engine/facilityFloorLightMap.ts'
import {createFacilityObjectLighting} from '/src/widgets/digital-twin/engine/facilityObjectLighting.ts'
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
renderer.setSize(1100,800);renderer.outputColorSpace=THREE.SRGBColorSpace;document.body.append(renderer.domElement)
const scene=new THREE.Scene();scene.background=new THREE.Color('#182133')
const camera=new THREE.PerspectiveCamera(40,1100/800,0.1,100);camera.up.set(0,0,1);camera.position.set(8,-10,8);camera.lookAt(1,0,1)
scene.add(new THREE.AmbientLight(0xffffff,0.4))
const fixtures=createFacilityLights();fixtures.group.scale.setScalar(0.001);scene.add(fixtures.group)
const objectLighting=createFacilityObjectLighting(),models=new THREE.Group();models.scale.setScalar(0.001);scene.add(models)
for(const [geometry,position] of [[new THREE.PlaneGeometry(10000,10000),[0,0,0]],[new THREE.BoxGeometry(150,5000,3000),[3000,0,1500]]]){
  const material=new THREE.MeshStandardMaterial({color:'#9098a5',roughness:0.65});objectLighting.apply(material)
  const mesh=new THREE.Mesh(geometry,material);mesh.position.fromArray(position);models.add(mesh)
}
const emitter={fixture:{kind:'spot',temperature:4000},color:0xffffff,bounds:new THREE.Box3(new THREE.Vector3(),new THREE.Vector3())}
const placement=new THREE.Matrix4().makeTranslation(0,0,3000)
let baked
window.renderAngles=(angles)=>{
  fixtures.update('a',emitter,placement,0.001,angles)
  const previous=baked;baked=bakeFacilityFloorLightMap([],fixtures.group,1)
  objectLighting.setLighting(baked,fixtures.group,1);previous?.dispose()
  renderer.render(scene,camera)
  return {image:renderer.domElement.toDataURL(),textures:renderer.info.memory.textures,programs:renderer.info.programs.length,liveLights:fixtures.group.children.filter(light=>light.layers.mask!==0).length}
}
window.ready=true
</script></body></html>`
  const preview = await createServer({
    configFile: false,
    root,
    cacheDir: path.join(output, 'ui-vite-cache'),
    optimizeDeps: { noDiscovery: true, include: ['three'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'lighting-render-check',
        configureServer(server) {
          server.middlewares.use('/__lighting', async (_request, response) => {
            response.setHeader('Content-Type', 'text/html')
            response.end(await server.transformIndexHtml('/__lighting', html))
          })
        },
      },
    ],
  })
  let browser
  try {
    await preview.listen()
    browser = await chromium.launch({
      headless: true,
      channel: 'msedge',
      args: ['--enable-unsafe-swiftshader'],
    })
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
    page.setDefaultTimeout(20000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(`${preview.resolvedUrls.local[0]}__lighting`)
    await page.waitForFunction(() => window.ready)
    const vertical = await page.evaluate(() =>
      window.renderAngles({ direction: 0, tilt: 0, beamAngle: 40, penumbra: 0.65 }),
    )
    const tilted = await page.evaluate(() =>
      window.renderAngles({ direction: 0, tilt: 60, beamAngle: 40, penumbra: 0.65 }),
    )
    assert.notEqual(tilted.image, vertical.image)
    assert.equal(tilted.liveLights, 0)
    await page.screenshot({ path: path.join(output, 'ui-tilted-light.png') })
    const repeated = await page.evaluate(() => {
      let result
      for (let i = 0; i < 12; i++)
        result = window.renderAngles({
          direction: i * 15,
          tilt: 45,
          beamAngle: 60,
          penumbra: i / 12,
        })
      return result
    })
    assert.equal(repeated.textures, tilted.textures)
    assert.equal(repeated.programs, tilted.programs)
    assert.deepEqual(errors, [])
    console.log(
      JSON.stringify({
        result: '관제 렌더링 방향 반영 및 반복 편집 리소스 해제 검증 통과',
        textures: repeated.textures,
        programs: repeated.programs,
        liveLights: repeated.liveLights,
      }),
    )
  } finally {
    await browser?.close()
    await preview.close()
  }
}
await checkUiRenderer()
