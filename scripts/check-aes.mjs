/**
 * 파일명: check-aes.mjs
 * 설명: AES 경로 순서와 현재 및 다음 위치 충돌 차이 및 원본 파일 형식의 회귀 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import path from 'node:path'
const require = createRequire(import.meta.url)
const {
  chromium,
} = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const server = await createServer({
  root: path.resolve(import.meta.dirname, '..'),
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
})
await server.listen()
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage()
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  const result = await page.evaluate(async () => {
    const { emptyDocument, serializeLegacy, previewLegacy } =
      await import('/src/entities/map/index.ts')
    const { makeAesData, readAesVehicle, DEFAULT_AES_VEHICLE } =
      await import('/src/features/map-editor/index.ts')
    const map = emptyDocument()
    map.nodes = [
      { id: 1, name: 'N1', x: 0, y: 0 },
      { id: 2, name: 'N2', x: 3000, y: 0 },
      { id: 3, name: 'N3', x: 0, y: 500 },
      { id: 4, name: 'N4', x: 6000, y: 500 },
    ]
    map.edges = [
      { id: 'e1', from: 1, to: 2, direction: 0 },
      { id: 'e2', from: 3, to: 4, direction: 0 },
    ]
    for (const edge of map.edges) edge.controls = { forward: { manualDegree: 1, vehicleDegree: 0 } }
    const vehicle = {
      width: 1000,
      height: 1000,
      leftWidth: 500,
      topHeight: 500,
      sampleLength: 200,
      detectionDistance: 100,
      searchRatio: 10,
    }
    const output = makeAesData(map, vehicle)
    const lines = output.content
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim().split('\t').map(Number))
    if (
      JSON.stringify(lines) !==
      JSON.stringify([
        [3],
        [2, 1, 1500, 0, 1, 1, 2, 1, 2, 2, 1, 2, 0],
        [4, 3, 3000, 500, 1, 2, 2, 1, 2, 2, 2, 1, 0],
        [3],
        [2, 1, 1, 2, 2, 2, 4, 2, 2, 4, 0],
        [4, 3, 1, 4, 2, 2, 4, 2, 4, 2, 0],
      ])
    )
      throw Error('AES planning order or PRE/NEXT/BOTH: ' + JSON.stringify(lines))
    const native = serializeLegacy(map),
      baseline = previewLegacy(native.content, 'aes.jmapx')
    const restored = makeAesData(baseline, vehicle, { ...native, baseline })
    if (restored.content !== output.content) throw Error('AES native reference mismatch')
    const read = readAesVehicle(
      '[AGV_TYPE_01]\nwidth=2000\nheight=1000\nratio=3.5\n[AGV_TYPE_02]\nwidth=9000',
    )
    if (read.width !== 2000 || read.leftWidth !== 1000 || read.searchRatio !== 3.5)
      throw Error('INI first vehicle')
    for (const settings of [
      { ...vehicle, sampleLength: 0 },
      { ...vehicle, leftWidth: 1001 },
      { ...vehicle, searchRatio: NaN },
    ]) {
      let rejected = false
      try {
        makeAesData(map, settings)
      } catch {
        rejected = true
      }
      if (!rejected) throw Error('Invalid vehicle accepted')
    }
    map.edges[0].direction = 1
    map.edges[0].controls.backward = { manualDegree: 1, vehicleDegree: 90000, reverse: 1 }
    if (makeAesData(map, DEFAULT_AES_VEHICLE).paths !== 3) throw Error('Bidirectional paths')
    map.nodes = []
    map.edges = []
    if (makeAesData(map, vehicle).content !== '1\t\r\n1\t\r\n') throw Error('Empty dummy table')
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    const editor = useEditor()
    editor.operationTab = 'aes'
    editor.operationsOpen = true
    return { paths: output.paths, collisions: output.collisions, roundtrip: true }
  })
  await page.getByText('AGV_TYPE.INI 열기', { exact: false }).waitFor()
  assert.ok(await page.getByLabel('외곽 표본 간격 mm', { exact: true }).isVisible())
  console.log('AES data and UI OK', result)
} finally {
  await browser.close()
  await server.close()
}
