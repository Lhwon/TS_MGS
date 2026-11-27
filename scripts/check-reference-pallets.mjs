/**
 * 단품 파렛트의 내장 리소스와 모델 로딩 호환성 및 다각도 미리보기 검증
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const {
  chromium,
} = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const directory = path.resolve('public/models/pallets')
const review = await fs.mkdtemp(path.join(os.tmpdir(), 'mgs-pallet-review-'))
const validatorSource = await fs.readFile('packages/map3d/glbData.ts', 'utf8')
const validator = await import(
  `data:text/javascript;base64,${Buffer.from(ts.transpile(validatorSource, { module: ts.ModuleKind.ESNext })).toString('base64')}`
)
const reports = []
for (const color of ['blue', 'yellow']) {
  const bytes = await fs.readFile(path.join(directory, `plastic-pallet-${color}.glb`))
  validator.validateGlbBytes(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  )
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)))
  assert.equal(json.scenes.length, 1)
  assert.equal(json.scenes[0].nodes.length, 1)
  assert.equal(json.nodes[json.scenes[0].nodes[0]].extras.quantity, 1)
  assert.equal(json.meshes.length, 2)
  assert.equal(json.images.length, 3)
  assert(json.images.every((image) => Number.isInteger(image.bufferView)))
  assert(json.buffers.every((buffer) => !buffer.uri))
}

const html = `<!doctype html><html><head><meta charset="UTF-8"><style>
body{margin:0;background:#e9edf0;font-family:Segoe UI,sans-serif}canvas{display:block}
#caption{position:absolute;left:58px;top:42px;color:#303e4b;pointer-events:none}
h1{font-size:27px;letter-spacing:1px;margin:0 0 8px}p{font-size:15px;color:#60717e;margin:0}
</style></head><body><div id="caption"><h1 id="title"></h1><p>1100 × 1100 × 150 mm · Single pallet · HDPE</p></div><script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GlbModelCache } from '/packages/map3d/glb.ts'
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
renderer.setSize(innerWidth,innerHeight); renderer.setPixelRatio(1.5)
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=0.9
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;document.body.append(renderer.domElement)
const scene=new THREE.Scene();scene.background=new THREE.Color('#e9edf0')
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment()
scene.environment=pmrem.fromScene(room,0.04).texture;scene.environmentIntensity=0.6;room.dispose();pmrem.dispose()
const key=new THREE.DirectionalLight(0xfff4e7,2.2);key.position.set(-1.2,2.4,1.6);key.castShadow=true
key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-1,right:1,top:1,bottom:-1,near:0.1,far:8})
key.shadow.bias=-0.00008;key.shadow.normalBias=0.001;key.shadow.radius=3;scene.add(key)
const fill=new THREE.DirectionalLight(0xdce9ff,1.0);fill.position.set(1,1,-1.5);scene.add(fill)
const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#e2e6e9',roughness:0.9}))
floor.rotation.x=-Math.PI/2;floor.position.y=-0.002;floor.receiveShadow=true;scene.add(floor)
const camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,0.01,100)
let model;const cache=new GlbModelCache()
window.loadPallet=async(color)=>{
  if(model)scene.remove(model)
  const bytes=await(await fetch('/models/pallets/plastic-pallet-'+color+'.glb')).arrayBuffer()
  const started=performance.now();model=(await new GLTFLoader().parseAsync(bytes,'')).scene
  const rawBounds=new THREE.Box3().setFromObject(model)
  const shared=await cache.load(bytes);const again=await cache.load(bytes)
  let meshes=0,vertices=0,triangles=0;model.traverse(child=>{if(child.isMesh){meshes++;vertices+=child.geometry.attributes.position.count;triangles+=child.geometry.index.count/3;child.castShadow=true;child.receiveShadow=true}})
  let cacheShared=true;shared.traverse(child=>{if(child.isMesh){let match;again.traverse(other=>{if(other.isMesh&&other.name===child.name)match=other});cacheShared&&=match.geometry===child.geometry}})
  model.updateMatrixWorld(true)
  const ray=new THREE.Raycaster(), forkChannels=[]
  for(const axis of ['x','z'])for(const sign of [-1,1])for(const channel of [-0.256,0.256]){
    const start=axis==='z'?new THREE.Vector3(channel,0.075,sign*2):new THREE.Vector3(sign*2,0.075,channel)
    const direction=axis==='z'?new THREE.Vector3(0,0,-sign):new THREE.Vector3(-sign,0,0)
    ray.set(start,direction);forkChannels.push(ray.intersectObject(model,true).length===0)
  }
  scene.add(model);document.querySelector('#title').textContent=color.toUpperCase()+' / MOLDED PLASTIC PALLET'
  window.angle('hero')
  return {color,meshes,vertices,triangles,bytes:bytes.byteLength,bounds:{min:rawBounds.min.toArray(),max:rawBounds.max.toArray()},cacheShared,forkChannels,parseAndCacheMs:performance.now()-started}
}
window.angle=(angle)=>{
  const positions={hero:[1.35,0.91,1.45],side:[0,0.32,1.82],top:[0,2.05,0.001],underside:[1.3,-0.9,1.3]}
  floor.visible=angle!=='underside';camera.position.fromArray(positions[angle]);camera.lookAt(0,0.065,0);renderer.render(scene,camera)
}
window.ready=true
</script></body></html>`

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  cacheDir: path.join(os.tmpdir(), 'mgs-pallet-vite-cache'),
  optimizeDeps: {
    noDiscovery: true,
    include: [
      'three',
      'three/examples/jsm/environments/RoomEnvironment.js',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/utils/SkeletonUtils.js',
    ],
  },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  plugins: [
    {
      name: 'pallet-preview',
      configureServer(server) {
        server.middlewares.use('/__pallet', async (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(await server.transformIndexHtml('/__pallet', html))
        })
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
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${server.resolvedUrls.local[0]}__pallet`)
  await page.waitForFunction(() => window.ready)
  for (const color of ['blue', 'yellow']) {
    const report = await page.evaluate((color) => window.loadPallet(color), color)
    assert.equal(report.meshes, 2)
    assert(report.vertices < 1000000)
    assert(report.cacheShared)
    assert(report.forkChannels.every(Boolean))
    const size = report.bounds.max.map((value, axis) => value - report.bounds.min[axis])
    for (const [axis, expected] of [1.1, 0.15, 1.1].entries())
      assert(Math.abs(size[axis] - expected) < 0.000001)
    assert(Math.abs(report.bounds.min[1]) < 0.000001)
    for (const angle of ['hero', 'side', 'top', 'underside']) {
      await page.evaluate((angle) => window.angle(angle), angle)
      await page.screenshot({
        path: path.join(angle === 'hero' ? directory : review, `${color}-${angle}.png`),
      })
    }
    reports.push(report)
  }
  assert.deepEqual(errors, [])
  await fs.writeFile(
    path.join(review, 'validation.json'),
    `${JSON.stringify({ errors, models: reports }, null, 2)}\n`,
  )
  console.log(JSON.stringify(reports))
} finally {
  await browser?.close()
  await server.close()
}
