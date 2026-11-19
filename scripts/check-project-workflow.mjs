/**
 * 파일명: check-project-workflow.mjs
 * 설명: 프로젝트 시작과 명시적 저장 및 쇼룸 설계 알고리즘 회귀 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const {
  chromium,
} = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { openMapFolder } = require('../electron/map-files.cjs')
const { saveMapVersion, backupMapVersion } = require('../electron/save-map.cjs')
const root = path.resolve(import.meta.dirname, '..')
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-mgs-project-'))
const server = await createServer({
  root,
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
})
await server.listen()
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage()
  await page.addInitScript(() => {
    window.operations = []
    window.desktop = {
      apiVersion: 2,
      setDirty: () => {},
      restoreMapProject: async () => {
        window.operations.push('restore')
        return null
      },
      openMapFolder: async () => {
        window.operations.push('select')
        return { token: 'workspace', project: 'SHOW_ROOM' }
      },
      saveMap: async (content, name, options) => {
        window.operations.push({ content, name, options })
        return { name: '20261119_110000.jmapx', token: 'workspace' }
      },
    }
  })
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  assert.deepEqual(await page.evaluate(() => window.operations), ['restore', 'select'])
  const result = await page.evaluate(async () => {
    const { useEditor } = await import('/src/features/map-editor/index.ts')
    const { searchMgsTraining } = await import('/src/features/ai-assistant/index.ts')
    const { executeDrawingTool } = await import('/src/widgets/ai-assistant/model/drawingTools.ts')
    const { planDrawingRoute, supportedDimensionLine } =
      await import('/src/features/drawing-import/index.ts')
    const canvas = document.createElement('canvas')
    const image = canvas.toDataURL()
    const pixels = new Uint8ClampedArray(100 * 100 * 4).fill(255)
    for (let x = 20; x <= 80; x++) pixels.set([0, 0, 0, 255], (15 * 100 + x) * 4)
    const sampleLine = { axis: 'x', start: 200, end: 800, cross: 150, mm: 15000 }
    const evidence = { analysisWidth: 100, analysisHeight: 100, pixels }
    if (
      !supportedDimensionLine(evidence, sampleLine) ||
      supportedDimensionLine(evidence, { ...sampleLine, cross: 500 })
    )
      throw new Error('Reference evidence verification')
    const drawing = {
      id: 'showroom-fixture',
      name: '쇼룸.png',
      width: 796,
      height: 1061,
      image,
      visionImage: image,
    }
    const normal = (x, y) => ({ x: (x * 1000) / drawing.width, y: (y * 1000) / drawing.height })
    const request = {
      waypoints: [
        [364, 816],
        [364, 728],
        [364, 660],
        [364, 592],
        [364, 524],
        [364, 476],
        [578, 476],
        [578, 769],
      ].map(([x, y]) => normal(x, y)),
      references: [
        { axis: 'x', start: normal(275, 0).x, end: normal(645, 0).x, mm: 15000 },
        { axis: 'y', start: normal(0, 310).y, end: normal(0, 826).y, mm: 21400 },
      ],
      racks: [728, 660, 592, 524].map((y, i) => ({
        bounds: {
          ...normal(290, y - 26),
          width: (48 * 1000) / drawing.width,
          height: (52 * 1000) / drawing.height,
        },
        approach: normal(352, y),
        routeIndex: i + 1,
        levels: 4,
      })),
      spacingMm: 1200,
      radiusMm: 900,
      applyBackground: true,
    }
    let obstacleRejected = false
    try {
      planDrawingRoute(drawing, {
        ...request,
        obstacles: [{ ...normal(350, 740), width: 30, height: 50 }],
      })
    } catch (error) {
      obstacleRejected = error.message.includes('장애물')
    }
    const output = await executeDrawingTool(
      'plan_drawing_route',
      request,
      new AbortController(),
      drawing,
      {
        internal: () => {},
        generated: () => {},
        progress: () => {},
        findings: { value: [] },
        settings: { tiles: 4, radius: 0, vehicleWidth: 0, clearance: 0 },
      },
    )
    const editor = useEditor()
    return {
      output,
      token: editor.projectToken,
      dirty: editor.dirty,
      filename: editor.sourceName,
      dimensions: [editor.document.layout.width, editor.document.layout.height],
      obstacleRejected,
      training: searchMgsTraining('실제 도면 축척')[0]?.source,
      px: planDrawingRoute(drawing, { waypoints: request.waypoints }).map.units,
    }
  })
  assert.equal(result.output.saved, false)
  assert.equal(result.output.ports, 18)
  assert.equal(result.output.rounded, 2)
  assert.equal(result.output.dimensionAxes, 2)
  assert.equal(result.token, 'workspace')
  assert.equal(result.dirty, true)
  assert.match(result.filename, /\.jmapx$/)
  assert.ok(result.dimensions[0] > 32000 && result.dimensions[1] > 43000)
  assert.equal(result.obstacleRejected, true)
  assert.match(result.training, /슬라이드/)
  assert.equal(result.px, 'px')
  assert.deepEqual(await page.evaluate(() => window.operations), ['restore', 'select'])
  await page.keyboard.press('Control+s')
  const wizard = page.getByTestId('map-save-dialog')
  await wizard.waitFor()
  assert.deepEqual(await page.evaluate(() => window.operations), ['restore', 'select'])
  await wizard.getByRole('button', { name: '저장', exact: true }).click()
  await wizard.waitFor({ state: 'hidden' })
  const operation = await page.evaluate(() => window.operations.at(-1))
  assert.equal(operation.options.token, 'workspace')
  assert.equal(operation.options.backup, true)
  const empty = await openMapFolder(temporary, true)
  assert.equal(empty.content, undefined)
  await assert.rejects(fs.stat(empty.directory), { code: 'ENOENT' })
  const name = await saveMapVersion(
    empty.directory,
    operation.content,
    operation.options.groups,
    operation.options.auxiliary,
  )
  const opened = await openMapFolder(temporary, true)
  assert.equal(opened.name, name)
  if (process.platform === 'win32') {
    await backupMapVersion(empty.directory, name)
    const archive = path.join(temporary, '!COMPRESSED', name.replace('.jmapx', '.zip'))
    const items = execFileSync('tar.exe', ['-tf', archive], { encoding: 'utf8' })
    assert.ok(items.includes('MAP/' + name))
    assert.match(items, /DATA\/.*_port_group\.bem/)
  }
  console.log('Project startup, unsaved agent generation, native save, restart load and backup OK')
} finally {
  await browser.close()
  await server.close()
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()))
  await fs.rm(temporary, { recursive: true, force: true })
}
