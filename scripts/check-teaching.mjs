/**
 * 파일명: check-teaching.mjs
 * 설명: 실제 XLSX 압축 읽기와 원본 Teaching 열의 검증 및 지도와 제어값 적용 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import path from 'node:path'
const require = createRequire(import.meta.url),
  {
    chromium,
  } = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const root = path.resolve(import.meta.dirname, '..'),
  server = await createServer({
    root,
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
  })
await server.listen()
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage()
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  const xlsx = execFileSync('python', [
    '-c',
    `import zipfile,io,sys
b=io.BytesIO()
with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
 z.writestr('xl/workbook.xml','<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Teaching" r:id="rId1"/></sheets></workbook>')
 z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
 z.writestr('xl/sharedStrings.xml','<sst><si><t>Node</t></si><si><t>X(mm)</t></si><si><t>X Offset(mm)</t></si><si><t>To Node</t></si><si><t>Speed(m/min)</t></si><si><t>Port ID</t></si><si><t>LU Shift</t></si><si><t>P1</t></si></sst>')
 z.writestr('xl/worksheets/sheet1.xml','<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c><c r="G1" t="s"><v>6</v></c></row><row><c r="A2"><v>1</v></c><c r="B2"><v>1000</v></c><c r="C2"><v>250</v></c><c r="D2"><v>2</v></c><c r="E2"><v>12</v></c><c r="F2" t="s"><v>7</v></c><c r="G2"><v>25</v></c></row></sheetData></worksheet>')
sys.stdout.buffer.write(b.getvalue())`,
  ])
  const result = await page.evaluate(async (base64) => {
    const { useEditor, readTeachingFile, applyTeaching } =
      await import('/src/features/map-editor/index.ts')
    const { emptyDocument, serializeLegacy, previewLegacy } =
      await import('/src/entities/map/index.ts')
    const file = new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'teaching.xlsx')
    const sheets = await readTeachingFile(file)
    if (sheets[0].rows[0].Node !== '1') throw Error('XLSX shared strings')
    const map = emptyDocument()
    map.nodes = [
      { id: 1, name: 'N1', realId: 1, uid: 1, x: 0, y: 0 },
      { id: 2, name: 'N2', realId: 2, uid: 2, x: 3000, y: 0 },
    ]
    map.edges = [{ id: 'edge', from: 2, to: 1, direction: 1, drivingType: 1 }]
    map.ports = [{ id: 'P1', nodeId: 1, name: 'port', x: 100, y: 200, width: 100, height: 100 }]
    const original = JSON.stringify(map)
    applyTeaching(map, sheets[0].rows, true)
    if (JSON.stringify(map) !== original) throw Error('Preview mutation')
    const result = applyTeaching(map, sheets[0].rows)
    if (
      result.map.nodes[0].x !== 1250 ||
      result.map.ports[0].x !== 1350 ||
      result.map.ports[0].settings.lu_shift !== 25 ||
      result.map.edges[0].controls.forward.controlSpeed !== 20
    )
      throw Error('Teaching semantics')
    const row = {
      Node: '1',
      'To Node': '2',
      'Vehicle Degree(x1000)': '90000',
      ODS: '1/2/3/4/5/6/7/8',
      Reverse: 'Y',
    }
    const controls = applyTeaching(result.map, [row])
    const back = previewLegacy(serializeLegacy(controls.map).content, 'test.jmapx')
    if (
      back.edges[0].controls.forward.vehicleDegree !== 90000 ||
      back.edges[0].controls.forward.reverse !== 1 ||
      back.edges[0].controls.forward.odsField7 !== 8
    )
      throw Error('Teaching control native roundtrip')
    let rejected = false
    try {
      applyTeaching(map, [{ Node: '1', 'To Node': '2', 'Speed(cm/sec)': '999' }])
    } catch {
      rejected = true
    }
    if (!rejected || JSON.stringify(map) !== original) throw Error('Invalid row atomicity')
    const e = useEditor()
    e.importGeneratedMap(map)
    e.teachingOpen = true
    return { sheets: sheets.length, x: 1250, speed: 20, atomic: true }
  }, xlsx.toString('base64'))
  console.log(result)
  await page.getByTestId('teaching-editor').waitFor()
  await page.getByTestId('teaching-file').setInputFiles({
    name: 'teaching.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: xlsx,
  })
  await page.getByTestId('teaching-apply').click()
  const x = await page.evaluate(
    async () => (await import('/src/features/map-editor/index.ts')).useEditor().document.nodes[0].x,
  )
  assert.equal(x, 1250)
  console.log('XLSX preview, row selection and atomic Teaching import OK')
} finally {
  await browser.close()
  await server.close()
}
