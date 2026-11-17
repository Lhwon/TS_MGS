/**
 * 파일명: check-area-save.mjs
 * 설명: 영역 데이터의 원본 형식과 새 지도 버전 묶음 저장 및 실패 복구 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
const require = createRequire(import.meta.url),
  {
    chromium,
  } = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { saveMapVersion } = require('../electron/save-map.cjs'),
  { readMapFile } = require('../electron/map-files.cjs')
const root = path.resolve(import.meta.dirname, '..'),
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-mgs-area-')),
  directory = path.join(temporary, 'MAP')
const server = await createServer({
  root,
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
})
await server.listen()
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage()
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  const output = await page.evaluate(async () => {
    const { emptyDocument, serializeLegacy, parseAreaFiles, serializeAreas } =
      await import('/src/entities/map/index.ts')
    const files = {
      bay: 'BAY_1\tZONE_1\t\r\n',
      bay_group: 'GROUP_1\tZONE_1\t-1\t-1\t0\t1\t1\t\r\n',
      zone: 'ZONE_1\t1\t1\t\r\n',
      bay_offset: 'OFFSET_1\t1\t100\t1\t1\t\r\n',
      limit_ports: 'LIMIT_1\t1\t1\t\r\n',
    }
    const area = parseAreaFiles(files),
      serialized = serializeAreas(area)
    if (JSON.stringify(files) !== JSON.stringify(serialized)) throw Error('Area roundtrip')
    const map = emptyDocument()
    map.nodes = [{ id: 1, name: 'N1', x: 0, y: 0 }]
    map.areas = area
    const native = serializeLegacy(map)
    return { native, serialized }
  })
  const names = await Promise.all([
    saveMapVersion(directory, output.native.content, output.native.groups, output.serialized),
    saveMapVersion(directory, output.native.content, output.native.groups, output.serialized),
  ])
  assert.notEqual(names[0], names[1])
  for (const name of names) {
    const file = await readMapFile(path.join(directory, name))
    assert.deepEqual(file.areaFiles, output.serialized)
    assert.equal(file.content, output.native.content)
  }
  await assert.rejects(
    saveMapVersion(directory, output.native.content, '', { '../bad': 'invalid' }),
    /허용되지/,
  )
  const all = await fs.readdir(directory)
  assert.equal(all.filter((name) => name.endsWith('.tmp')).length, 0)
  await page.locator('[data-command="BT_area"]').count()
  await page.evaluate(async () => {
    const e = (await import('/src/features/map-editor/index.ts')).useEditor()
    e.areaEditorOpen = true
  })
  await page.getByTestId('area-editor').waitFor()
  console.log(
    'Area roundtrip, concurrent atomic version bundles, folder load, forbidden path rejection and editor UI OK',
  )
} finally {
  await browser.close()
  await server.close()
  const relative = path.relative(os.tmpdir(), temporary)
  assert.ok(relative.startsWith('ts-mgs-area-') && !relative.includes('..'))
  await fs.rm(temporary, { recursive: true, force: true })
}
