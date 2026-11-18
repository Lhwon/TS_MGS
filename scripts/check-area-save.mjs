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
    const { makeAesData, makeAroundData, DEFAULT_AES_VEHICLE } =
      await import('/src/features/map-editor/index.ts')
    return {
      native,
      serialized,
      aes: makeAesData(map, DEFAULT_AES_VEHICLE).content,
      around: makeAroundData(map, 30000).content,
    }
  })
  const names = await Promise.all([
    saveMapVersion(directory, output.native.content, output.native.groups, {
      ...output.serialized,
      aes: output.aes,
      path_around: output.around,
    }),
    saveMapVersion(directory, output.native.content, output.native.groups, {
      ...output.serialized,
      aes: output.aes,
      path_around: output.around,
    }),
  ])
  assert.notEqual(names[0], names[1])
  for (const name of names) {
    const file = await readMapFile(path.join(directory, name))
    assert.deepEqual(file.areaFiles, output.serialized)
    assert.equal(file.content, output.native.content)
    const stem = path.parse(name).name
    assert.equal(
      await fs.readFile(path.join(temporary, 'DATA', 'TRAFFIC', `${stem}.aesx`), 'utf8'),
      output.aes,
    )
    assert.equal(
      await fs.readFile(path.join(temporary, 'DATA', `${stem}_path_around.bem`), 'utf8'),
      output.around,
    )
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
  await page.evaluate(async (output) => {
    const e = (await import('/src/features/map-editor/index.ts')).useEditor()
    e.areaEditorOpen = false
    e.load(output.native.content, 'save.jmapx', '', output.native.groups, output.serialized)
    e.commit((map) => {
      map.nodes[0].x = 100
    })
    window.desktop = {
      apiVersion: 2,
      setDirty: () => {},
      saveMap: async (content, name, options) => {
        window.__saveBundle = { content, name, options }
        return { name: '20261118_120000.jmapx', token: 'test-project' }
      },
    }
  }, output)
  await page.keyboard.press('Control+s')
  const dialog = page.getByTestId('map-save-dialog')
  await dialog.waitFor()
  await dialog.getByLabel('AES Data 생성', { exact: true }).check()
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const saved = await page.evaluate(async () => {
    const { previewLegacy } = await import('/src/entities/map/index.ts')
    const e = (await import('/src/features/map-editor/index.ts')).useEditor()
    return {
      auxiliary: window.__saveBundle.options.auxiliary,
      x: previewLegacy(window.__saveBundle.content, 'saved.jmapx').nodes[0].x,
      dirty: e.dirty,
    }
  })
  assert.equal(saved.x, 100)
  assert.equal(saved.dirty, false)
  assert.equal(saved.auxiliary.aes, output.aes)
  assert.equal(saved.auxiliary.path_around, output.around)
  assert.equal(saved.auxiliary.bay, output.serialized.bay)
  await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    const { emptyAreas } = await import('/src/entities/map/index.ts')
    const e = useEditor()
    e.newMap()
    e.commit((map) => {
      map.nodes = [
        { id: 1, name: 'N1', x: 0, y: 0 },
        { id: 2, name: 'N2', x: 1000, y: 0 },
      ]
      map.edges = [{ id: 'e', from: 1, to: 2, bays: [1, 2, 9] }]
      map.ports = [{ id: 'P1', name: '', nodeId: 1, x: 0, y: 500, bays: [1, 2, 9] }]
      map.areas = {
        ...emptyAreas(),
        bays: [
          { name: 'A', zone: 'Z' },
          { name: 'B', zone: 'Z' },
        ],
        zones: [{ name: 'Z', groups: [] }],
      }
    })
    e.areaCategory = 'bays'
    e.areaEditorOpen = true
  })
  const areaDialog = page.getByTestId('area-editor')
  await areaDialog.getByRole('button', { name: '삭제', exact: true }).click()
  await areaDialog.getByRole('button', { name: '지도에 적용', exact: true }).click()
  const refs = await page.evaluate(async () => {
    const e = (await import('/src/features/map-editor/index.ts')).useEditor()
    const result = { edges: e.document.edges[0].bays, ports: e.document.ports[0].bays }
    e.undo()
    return { ...result, undo: e.document.edges[0].bays }
  })
  assert.deepEqual(refs.edges, [1, 9])
  assert.deepEqual(refs.ports, [1, 9])
  assert.deepEqual(refs.undo, [1, 2, 9])
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
