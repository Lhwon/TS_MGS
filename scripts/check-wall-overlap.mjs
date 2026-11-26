/**
 * 파일명: check-wall-overlap.mjs
 * 설명: 실제 WebGL 픽셀을 읽어 두 앱의 반투명 벽 중첩과 유리 재질을 점검
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.MGS_PLAYWRIGHT ??
    'C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
)
const root = path.resolve(process.argv[2] ?? path.resolve(import.meta.dirname, '..'))
const passPath =
  path.basename(root) === 'TS_MGS'
    ? '/src/widgets/facility-studio/lib/wallOverlapPass.ts'
    : '/src/widgets/digital-twin/engine/wallOverlapPass.ts'

/** 일반 메쉬와 다중 인스턴스 및 렌더 타깃을 실제 픽셀로 비교 */
const checkPixels = (THREE, getWallOverlapPass) => {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(2)
  renderer.setSize(64, 64)
  const pass = getWallOverlapPass(renderer)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0)
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20)
  camera.position.z = 6
  const geometry = new THREE.BoxGeometry(1.8, 2, 0.3)
  const target = new THREE.WebGLRenderTarget(52, 48)
  target.viewport.set(2, 3, 48, 42)
  const gl = renderer.getContext()

  const addWall = (x, z, color, instanced = false) => {
    const material = new THREE.MeshStandardMaterial({
      color: 0,
      emissive: color,
      opacity: 0.55,
      transparent: true,
      depthWrite: false,
    })
    const mesh = instanced
      ? new THREE.InstancedMesh(geometry, material, 1)
      : new THREE.Mesh(geometry, material)
    if (mesh instanceof THREE.InstancedMesh)
      mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(x, 0, z))
    else mesh.position.set(x, 0, z)
    scene.add(mesh)
    pass.setWall(mesh, true)
    return mesh
  }
  const near = addWall(-0.4, 1, 0xff0000, true)
  const far = addWall(0.4, 0, 0x0000ff)
  const glass = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      opacity: 0.5,
      transparent: true,
      depthWrite: false,
    }),
  )
  glass.visible = false
  scene.add(glass)
  const opaque = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffff00 }))
  opaque.position.z = 2
  opaque.visible = false
  scene.add(opaque)

  const pixel = (x = 64, y = 64) => {
    pass.render(scene, camera)
    const sample = new Uint8Array(4)
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sample)
    return Array.from(sample)
  }

  try {
    const overlap = pixel()
    const farOnly = pixel(100)
    far.visible = false
    const nearOnly = pixel()
    far.visible = true
    far.position.copy(new THREE.Vector3(-0.4, 0, 1))
    far.material.emissive.set(0xff0000)
    const coplanar = pixel()
    far.position.set(0.4, 0, 0)
    far.material.emissive.set(0x0000ff)

    opaque.visible = true
    const covered = pixel()
    opaque.visible = false
    glass.visible = true
    glass.position.z = 2
    const glassFront = pixel()
    glass.position.z = 0.4
    const glassBack = pixel()
    glass.visible = false

    /** 완전 투명 벽의 색상과 마스크가 뒤쪽 벽 및 배경을 가리지 않는 픽셀 검증 */
    near.material.opacity = 0
    const transparentNear = pixel()
    far.material.opacity = 0
    const fullyClear = pixel()
    near.material.opacity = far.material.opacity = 0.55

    renderer.setRenderTarget(target)
    const inset = pixel(26, 23)
    const targetRestored = renderer.getRenderTarget() === target
    renderer.setRenderTarget(null)
    const mainAgain = pixel()
    near.setMatrixAt(0, new THREE.Matrix4().makeRotationY(Math.PI / 4))
    near.instanceMatrix.needsUpdate = true
    near.position.set(0, 0, 0)
    far.position.set(0, 0, 0)
    far.rotation.y = -Math.PI / 4
    const crossingLeft = pixel(48)
    const crossingRight = pixel(80)
    return {
      overlap,
      nearOnly,
      farOnly,
      coplanar,
      covered,
      glassFront,
      glassBack,
      transparentNear,
      fullyClear,
      inset,
      targetRestored,
      mainAgain,
      crossingLeft,
      crossingRight,
    }
  } finally {
    pass.dispose()
    target.dispose()
    geometry.dispose()
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.material.dispose()
    })
    renderer.dispose()
  }
}

const virtualPath = '/wall-overlap-check.js'
const server = await createServer({
  root,
  configFile: false,
  optimizeDeps: { include: ['three'], noDiscovery: true },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  plugins: [
    {
      name: 'wall-overlap-pixel-check',
      resolveId: (id) => (id === virtualPath ? '\0wall-overlap-check' : undefined),
      load: (id) =>
        id === '\0wall-overlap-check'
          ? 'import * as THREE from "three"; import { getWallOverlapPass } from ' +
            JSON.stringify(passPath) +
            '; export default () => (' +
            checkPixels.toString() +
            ')(THREE, getWallOverlapPass)'
          : undefined,
      configureServer: (server) => {
        server.middlewares.use('/wall-check-view', (_req, res) => {
          res.setHeader('content-type', 'text/html')
          res.end('<!doctype html><title>Wall overlap check</title>')
        })
      },
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
  const page = await browser.newPage()
  const shaderErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('WebGLProgram'))
      shaderErrors.push(message.text())
  })
  await page.goto(new URL('wall-check-view', server.resolvedUrls.local[0]).href)
  const output = await page.evaluate(async (url) => (await import(url)).default(), virtualPath)
  assert.deepEqual(shaderErrors, [])
  assert.deepEqual(output.overlap, output.nearOnly)
  assert.deepEqual(output.coplanar, output.nearOnly)
  assert.deepEqual(output.mainAgain, output.nearOnly)
  assert.ok(output.nearOnly[0] > 20 && output.nearOnly[2] === 0)
  assert.ok(output.farOnly[2] > 20 && output.farOnly[0] === 0)
  assert.ok(output.covered[0] > 240 && output.covered[1] > 240)
  assert.ok(output.glassFront[1] > output.glassBack[1] && output.glassBack[1] > 5)
  assert.deepEqual(output.transparentNear, output.farOnly)
  assert.deepEqual(output.fullyClear, [0, 0, 0, 255])
  assert.ok(output.inset[0] > 20 && output.inset[2] === 0 && output.targetRestored)
  assert.deepEqual(output.crossingLeft, output.nearOnly)
  assert.deepEqual(output.crossingRight, output.farOnly)
  console.log(path.basename(root) + ' wall opacity overlap WebGL checks passed')
} finally {
  await browser?.close()
  await server.close()
}
