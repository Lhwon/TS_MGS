/**
 * 파일명: teaching.ts
 * 설명: 원본 Teaching 열 이름과 Real ID 기준으로 좌표 및 경로 제어와 포트 설정을 적용하는 편집
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { parseDocument, type MapDocument } from '@/entities/map/index.ts'
export interface TeachingSheet {
  name: string
  headers: string[]
  rows: Record<string, string>[]
}
/** 공백과 대소문자 차이가 있는 원본 열 이름을 동일하게 조회하는 정규화 */
const key = (value: string) => value.replace(/\s+/g, '').toLowerCase()
/** 따옴표와 줄바꿈을 보존하며 CSV 또는 탭 구분 표를 해석하는 행 분리 */
const readDelimited = (text: string) => {
  const separator = text.split(/\r?\n/)[0].includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = [],
    cell = '',
    quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && (char === separator || char === '\n' || char === '\r')) {
      row.push(cell)
      cell = ''
      if (char !== separator) {
        if (row.some((value) => value.trim())) rows.push(row)
        row = []
        if (char === '\r' && text[i + 1] === '\n') i++
      }
    } else cell += char
  }
  if (quoted) throw new Error('Teaching 표의 따옴표를 확인하세요.')
  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}
/** 첫 행을 열 이름으로 사용하며 비어 있는 행을 제외하는 Teaching 시트 구성 */
const sheet = (name: string, values: string[][]): TeachingSheet => {
  values = values.filter((row) => row.some((value) => value?.trim()))
  const headers = Array.from(values[0] ?? [], (value) => value ?? '')
  if (headers.length > 256) throw new Error('Teaching 열이 256개를 초과했습니다.')
  if (!headers.some((header) => ['node', 'portid'].includes(key(header))))
    throw new Error('Teaching 첫 행에 Node 또는 Port ID 열이 필요합니다.')
  if (new Set(headers.filter(Boolean).map(key)).size !== headers.filter(Boolean).length)
    throw new Error('Teaching 열 이름이 중복되었습니다.')
  return {
    name,
    headers,
    rows: values
      .slice(1)
      .filter((row) => row.some((value) => value?.trim()))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))),
  }
}
/** 외부 Excel 실행 없이 제한된 ZIP과 XML을 읽는 XLSX 및 CSV 입력 */
export const readTeachingFile = async (file: File): Promise<TeachingSheet[]> => {
  if (file.size > 32 * 1024 * 1024) throw new Error('Teaching 파일은 32MB 이하여야 합니다.')
  if (/\.(csv|tsv)$/i.test(file.name))
    return [sheet(file.name, readDelimited((await file.text()).replace(/^\uFEFF/, '')))]
  if (!/\.xlsx$/i.test(file.name)) throw new Error('XLSX 또는 CSV / TSV 파일을 선택하세요.')
  const bytes = new Uint8Array(await file.arrayBuffer()),
    view = new DataView(bytes.buffer),
    entries = new Map<string, { offset: number; size: number; method: number }>()
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  if (end < 0) throw new Error('XLSX ZIP 정보를 찾지 못했습니다.')
  const count = view.getUint16(end + 10, true)
  if (count > 10000) throw new Error('XLSX 항목이 너무 많습니다.')
  let offset = view.getUint32(end + 16, true),
    total = 0
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('XLSX 디렉터리가 손상되었습니다.')
    const flags = view.getUint16(offset + 8, true),
      method = view.getUint16(offset + 10, true),
      size = view.getUint32(offset + 20, true),
      raw = view.getUint32(offset + 24, true),
      length = view.getUint16(offset + 28, true),
      extra = view.getUint16(offset + 30, true),
      comment = view.getUint16(offset + 32, true),
      local = view.getUint32(offset + 42, true)
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      raw > 32 * 1024 * 1024 ||
      (total += raw) > 64 * 1024 * 1024
    )
      throw new Error('XLSX 압축 크기와 암호화를 확인하세요.')
    entries.set(new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + length)), {
      offset: local,
      size,
      method,
    })
    offset += 46 + length + extra + comment
  }
  const xml = async (name: string) => {
    const entry = entries.get(name)
    if (!entry) return undefined
    if (view.getUint32(entry.offset, true) !== 0x04034b50)
      throw new Error('XLSX 항목이 손상되었습니다.')
    const start =
        entry.offset +
        30 +
        view.getUint16(entry.offset + 26, true) +
        view.getUint16(entry.offset + 28, true),
      data = bytes.slice(start, start + entry.size)
    let result: Uint8Array
    if (entry.method === 0) result = data
    else {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      const reader = stream.getReader(),
        chunks: Uint8Array[] = []
      let length = 0
      while (true) {
        const part = await reader.read()
        if (part.done) break
        length += part.value.length
        if (length > 32 * 1024 * 1024) {
          await reader.cancel()
          throw new Error('XLSX 시트가 너무 큽니다.')
        }
        chunks.push(part.value)
      }
      result = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }
    }
    if (result.length > 32 * 1024 * 1024) throw new Error('XLSX 시트가 너무 큽니다.')
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(result), 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XLSX XML을 확인하세요.')
    return doc
  }
  const elements = (root: Document | Element, name: string) =>
      Array.from(root.getElementsByTagNameNS('*', name)),
    strings = await xml('xl/sharedStrings.xml'),
    shared = strings
      ? elements(strings, 'si').map((item) =>
          elements(item, 't')
            .map((text) => text.textContent ?? '')
            .join(''),
        )
      : [],
    workbook = await xml('xl/workbook.xml'),
    relations = await xml('xl/_rels/workbook.xml.rels')
  if (!workbook || !relations) throw new Error('XLSX 통합 문서 정보를 찾지 못했습니다.')
  const results: TeachingSheet[] = []
  for (const item of elements(workbook, 'sheet')) {
    const id = item.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      ),
      relation = elements(relations, 'Relationship').find((row) => row.getAttribute('Id') === id)
    if (!relation || relation.getAttribute('TargetMode') === 'External') continue
    const target = new URL(
        relation.getAttribute('Target') ?? '',
        'https://local/xl/',
      ).pathname.slice(1),
      doc = await xml(target)
    if (!doc) continue
    const rows = elements(doc, 'row').map((row) => {
      const values: string[] = []
      for (const cell of elements(row, 'c')) {
        const address = cell.getAttribute('r') ?? '',
          letters = /^[A-Z]+/.exec(address)?.[0] ?? 'A'
        let column = 0
        for (const char of letters) column = column * 26 + char.charCodeAt(0) - 64
        const value = elements(cell, 'v')[0]?.textContent ?? ''
        if (column < 1 || column > 16384) throw new Error('XLSX 열 번호를 확인하세요.')
        values[column - 1] =
          cell.getAttribute('t') === 's'
            ? (shared[Number(value)] ?? '')
            : cell.getAttribute('t') === 'inlineStr'
              ? elements(cell, 't')
                  .map((node) => node.textContent ?? '')
                  .join('')
              : value
      }
      return values
    })
    results.push(sheet(item.getAttribute('name') ?? 'Sheet', rows))
  }
  if (!results.length) throw new Error('Teaching 시트를 찾지 못했습니다.')
  return results
}
/** 선택한 Teaching 행을 복제 문서에서 검증하고 원본 열의 단위로 반영하는 일괄 적용 */
export const applyTeaching = (
  input: MapDocument,
  rows: Record<string, string>[],
  validateOnly = false,
) => {
  if (input.units !== 'mm')
    throw new Error('Teaching 좌표는 mm입니다. 도면 축척을 먼저 확정하세요.')
  if (rows.length > 15000) throw new Error('Teaching 행이 너무 많습니다.')
  const map = validateOnly ? input : structuredClone(input),
    results: string[] = [],
    moved = new Set<number>()
  for (const [index, source] of rows.entries()) {
    const row = Object.fromEntries(
        Object.entries(source).map(([name, value]) => [key(name), String(value).trim()]),
      ),
      get = (name: string) => {
        const value = row[key(name)]
        return value && value !== '-' ? value : undefined
      },
      number = (name: string, min = -1e9, max = 1e9) => {
        const value = get(name)
        if (value === undefined) return undefined
        const parsed = Number(value.replaceAll(',', ''))
        if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
          throw new Error(`${index + 2}행 ${name} 값을 확인하세요.`)
        return parsed
      }
    const real = number('Node'),
      found = map.nodes.filter((node) => node.realId === real && !node.virtual),
      node = real === undefined ? undefined : found[0]
    if (real !== undefined && (found.length !== 1 || !node))
      throw new Error(`${index + 2}행 Real ID ${real}가 없거나 중복되었습니다.`)
    if (node) {
      const x = (number('X(mm)') ?? node.x) + (number('XOffset(mm)') ?? 0),
        y = (number('Y(mm)') ?? node.y) + (number('YOffset(mm)') ?? 0),
        dx = x - node.x,
        dy = y - node.y
      if (Math.abs(x) > 1e9 || Math.abs(y) > 1e9)
        throw new Error('Teaching 좌표 범위를 초과했습니다.')
      if (!validateOnly) {
        node.x = x
        node.y = y
        if (dx || dy) moved.add(node.id)
        for (const port of map.ports)
          if (port.nodeId === node.id) {
            port.x += dx
            port.y += dy
          }
        for (const group of map.portGroups ?? [])
          if (group.nodeId === node.id) {
            group.x += dx
            group.y += dy
            group.nodeX = x
            group.nodeY = y
          }
      }
    }
    const toReal = number('ToNode')
    if (toReal !== undefined) {
      if (!node) throw new Error(`${index + 2}행 경로의 Node가 필요합니다.`)
      const target = map.nodes.find((item) => item.realId === toReal && !item.virtual)
      if (!target) throw new Error(`${index + 2}행 To Node가 없습니다.`)
      const edge =
        map.edges.find((edge) => edge.to === node.id && edge.from === target.id) ||
        map.edges.find(
          (edge) => (edge.direction ?? 1) === 1 && edge.from === node.id && edge.to === target.id,
        )
      if (!edge) throw new Error(`${index + 2}행 연결 경로가 없습니다.`)
      const direction = edge.to === node.id ? 'forward' : 'backward'
      const control = { ...(edge.controls?.[direction] ?? {}) }
      const degree =
        number('VehicleDegree(x1000)', 0, 359999) ?? number('VechicleDegree(x1000)', 0, 359999)
      if (degree !== undefined) {
        control.vehicleDegree = degree
        control.manualDegree = 1
      }
      const ods = get('ODS')
      if (ods) {
        const values = ods.split('/').map(Number)
        if (
          values.length !== 8 ||
          values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
        )
          throw new Error(`${index + 2}행 ODS는 영부터 255까지 여덟 값으로 입력하세요.`)
        values.forEach((value, i) => {
          control[`odsField${i}`] = value
        })
      }
      const reverse = get('Reverse')
      if (reverse) {
        if (!['Y', 'N'].includes(reverse.toUpperCase()))
          throw new Error('Reverse는 Y 또는 N입니다.')
        control.reverse = reverse.toUpperCase() === 'Y' ? 1 : 0
      }
      const speed = number('Speed(cm/sec)', 0, 255) ?? number('Speed(cm/s)', 0, 255),
        metres = number('Speed(m/min)', 0, 153)
      if (speed !== undefined || metres !== undefined)
        control.controlSpeed = speed ?? Math.trunc((metres! * 100) / 60)
      if (!validateOnly) {
        edge.controls ??= {}
        edge.controls[direction] = control
      }
    }
    const portId = get('PortID')
    if (portId) {
      const port = map.ports.find((port) => port.id === portId)
      if (!port) throw new Error(`${index + 2}행 포트 ${portId}가 없습니다.`)
      const settings = { ...(port.settings ?? {}) }
      for (const [name, key, maximum] of [
        ['PIOType', 'handshaking', 255],
        ['LUShift', 'lu_shift', 255],
        ['Height[0](mm)', 'lu_height0', 32767],
        ['Height[1](mm)', 'lu_height1', 32767],
      ] as const) {
        const value = number(name, 0, maximum)
        if (value !== undefined) settings[key] = value
      }
      if (!validateOnly) port.settings = settings
    }
    results.push(`${index + 2}행 적용`)
  }
  if (validateOnly) return { map: input, results }
  const nodes = new Map(map.nodes.map((node) => [node.id, node]))
  for (const edge of map.edges)
    if (moved.has(edge.from) || moved.has(edge.to)) {
      const a = nodes.get(edge.from)!,
        b = nodes.get(edge.to)!
      edge.distance = Math.trunc(Math.hypot(b.x - a.x, b.y - a.y))
    }
  return { map: parseDocument(JSON.stringify(map)), results }
}
