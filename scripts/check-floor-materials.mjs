/**
 * 사용자 바닥 이미지 등록과 재사용 및 모델 배치의 화면 회귀 검증
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
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  await page.getByTestId('mode-facility').click()
  await page.evaluate(async () => {
    const studio = (await import('/src/features/facility-editor/index.ts')).useFacilityEditor()
    studio.commit((doc) => {
      doc.floors = [0, 5000].map((x, index) => ({
        id: `floor-${index}`,
        name: `등록 바닥 ${index}`,
        material: 'epoxy',
        color: '#cccccc',
        repeatMm: 1000,
        rotation: 0,
        points: [
          { x, y: 0 },
          { x: x + 4000, y: 0 },
          { x: x + 4000, y: 2000 },
          { x, y: 2000 },
        ],
      }))
    })
  })
  await page.getByRole('button', { name: /^등록 바닥 0/ }).click()
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 8
    const context = canvas.getContext('2d')
    context.fillStyle = '#73a089'
    context.fillRect(0, 0, 16, 8)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page
    .getByTestId('floor-file')
    .setInputFiles({
      name: '직접 등록.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    })
  await page.waitForFunction(
    async () =>
      (await import('/src/features/facility-editor/index.ts')).useFacilityEditor().document
        .floors[0].textureName === '직접 등록.png',
  )
  const registered = await page.evaluate(async () => {
    const { readSceneResource } = await import('/src/entities/facility/index.ts')
    const { createFloorSurfaces } = await import('/packages/map3d/floorSurfaces.ts')
    const studio = (await import('/src/features/facility-editor/index.ts')).useFacilityEditor()
    const area = studio.document.floors[0]
    const bytes = await readSceneResource(area.texture)
    const floors = createFloorSurfaces(1, null, () => {})
    await floors.prepareTextures([area], readSceneResource)
    floors.setAreas([area])
    const uv = floors.group.children[0].geometry.getAttribute('uv')
    const us = [],
      vs = []
    for (let i = 0; i < uv.count; i++) {
      us.push(uv.getX(i))
      vs.push(uv.getY(i))
    }
    floors.dispose()
    return {
      uri: area.texture.uri,
      hash: area.texture.hash,
      name: area.textureName,
      header: String.fromCharCode(...new Uint8Array(bytes).slice(8, 12)),
      u: Math.max(...us) - Math.min(...us),
      v: Math.max(...vs) - Math.min(...vs),
    }
  })
  assert.equal(registered.header, 'WEBP')
  assert.equal(registered.u, 4)
  assert.equal(registered.v, 4)
  assert.match(registered.uri, /^textures\/[a-f0-9]{64}\.webp$/)
  await page.getByRole('button', { name: /^등록 바닥 1/ }).click()
  await page.getByTestId('floor-texture').selectOption(registered.hash)
  await page.waitForFunction(
    async () =>
      (await import('/src/features/facility-editor/index.ts')).useFacilityEditor().document
        .floors[1].texture?.hash ===
      (await import('/src/features/facility-editor/index.ts')).useFacilityEditor().document
        .floors[0].texture.hash,
  )
  await page.getByTestId('floor-material').selectOption('wood')
  await page.getByTestId('floor-apply').click()
  assert.equal(
    await page.evaluate(
      async () =>
        (await import('/src/features/facility-editor/index.ts')).useFacilityEditor().document
          .floors[1].texture.hash,
    ),
    registered.hash,
  )
  await page.getByTestId('floor-texture').selectOption('')
  assert.equal(
    await page.evaluate(
      async () =>
        !!(await import('/src/features/facility-editor/index.ts')).useFacilityEditor().document
          .floors[1].texture,
    ),
    false,
  )
  await page.evaluate(async () =>
    (await import('/src/features/facility-editor/index.ts')).useFacilityEditor().undo(),
  )
  await page.waitForFunction(
    async () =>
      !!(await import('/src/features/facility-editor/index.ts')).useFacilityEditor().document
        .floors[1].texture,
  )
  await page
    .getByTestId('floor-file')
    .setInputFiles({ name: '손상.png', mimeType: 'image/png', buffer: Buffer.from('invalid') })
  await page.getByRole('alert').filter({ hasText: '해석할 수 없습니다' }).waitFor()
  await page
    .getByTestId('floor-file')
    .setInputFiles({
      name: '지원하지않음.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('invalid'),
    })
  await page.getByRole('alert').filter({ hasText: '12MB 이하' }).waitFor()
  assert.equal(
    await page.evaluate(
      async () =>
        (await import('/src/features/facility-editor/index.ts')).useFacilityEditor().document
          .floors[1].texture.hash,
    ),
    registered.hash,
  )
  await page.getByTestId('floor-file').setInputFiles('public/models/ceram-mp5/crate.glb')
  await page.getByTestId('glb-register').waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('[data-testid="glb-register"]').disabled)
  await page.getByTestId('glb-register').click()
  await page.waitForFunction(
    async () =>
      (await import('/src/features/facility-editor/index.ts')).useFacilityEditor().document
        .instances.length === 1,
  )
  const model = await page.evaluate(async () => {
    const studio = (await import('/src/features/facility-editor/index.ts')).useFacilityEditor()
    const instance = studio.document.instances[0],
      asset = studio.document.assets[0]
    const result = {
      x: asset.glb.size.x * instance.scale.x,
      y: asset.glb.size.y * instance.scale.y,
      px: instance.position.x,
      py: instance.position.y,
    }
    studio.undo()
    return {
      ...result,
      afterUndo: studio.document.instances.length,
      afterUndoAssets: studio.document.assets.length,
    }
  })
  assert.deepEqual(model, {
    x: 4000,
    y: 2000,
    px: 7000,
    py: 1000,
    afterUndo: 0,
    afterUndoAssets: 0,
  })
  /** 여러 래스터 형식과 파일 용량 제한 및 브라우저의 불완전한 다운로드 차단 검증 */
  await page.getByRole('button', { name: /^등록 바닥 0/ }).click()
  const formats = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 8
    canvas.getContext('2d').fillRect(0, 0, 8, 8)
    return ['image/jpeg', 'image/webp'].map((type) => ({
      type,
      data: canvas.toDataURL(type).split(',')[1],
    }))
  })
  const bitmap = Buffer.alloc(62)
  bitmap.write('BM')
  bitmap.writeUInt32LE(62, 2)
  bitmap.writeUInt32LE(54, 10)
  bitmap.writeUInt32LE(40, 14)
  bitmap.writeInt32LE(2, 18)
  bitmap.writeInt32LE(1, 22)
  bitmap.writeUInt16LE(1, 26)
  bitmap.writeUInt16LE(24, 28)
  bitmap.writeUInt32LE(8, 34)
  const files = [
    ...formats.map(({ type, data }) => ({
      name: '직접 등록.' + (type === 'image/jpeg' ? 'jpg' : 'webp'),
      mimeType: type,
      buffer: Buffer.from(data, 'base64'),
    })),
    { name: '직접 등록.bmp', mimeType: 'image/bmp', buffer: bitmap },
    {
      name: '직접 등록.gif',
      mimeType: 'image/gif',
      buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
    },
  ]
  for (const file of files) {
    await page.getByTestId('floor-file').setInputFiles(file)
    await page.waitForFunction(
      async (name) =>
        (await import('/src/features/facility-editor/index.ts')).useFacilityEditor().document
          .floors[0].textureName === name,
      file.name,
    )
  }
  await page
    .getByTestId('floor-file')
    .setInputFiles({
      name: '용량초과.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(12 * 1024 * 1024 + 1),
    })
  await page.getByRole('alert').filter({ hasText: '12MB 이하' }).waitFor()
  const browserSave = await page.evaluate(async () => {
    const studio = (await import('/src/features/facility-editor/index.ts')).useFacilityEditor()
    return { save: (await studio.save()).status, export: (await studio.exportRuntime([])).status }
  })
  assert.deepEqual(browserSave, { save: 'error', export: 'error' })
  assert.deepEqual(errors, [])
  console.log(
    'Floor materials: image registration, WebP conversion, aspect ratio, reuse, finish changes, removal, undo, malformed files and atomic GLB placement passed',
  )
} finally {
  await browser?.close()
  await server.close()
}
