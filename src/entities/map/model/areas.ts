/**
 * 파일명: areas.ts
 * 설명: 원본 Bay와 Zone 및 그룹과 Offset 및 Port Limit 데이터의 해석과 검증 및 저장
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
export interface AreaData {
  bays: { name: string; zone: string }[]
  groups: {
    name: string
    zone: string
    loadLimit: number
    unloadLimit: number
    agvType: number
    bays: number[]
  }[]
  zones: { name: string; groups: number[] }[]
  offsets: { name: string; realId: number; offset: number; groups: number[] }[]
  limits: { name: string; loadLimit: number; unloadLimit: number }[]
}
export const emptyAreas = (): AreaData => ({
  bays: [],
  groups: [],
  zones: [],
  offsets: [],
  limits: [],
})
/** 참조 번호와 이름 및 목록을 원본 설정 범위로 제한하는 영역 데이터 검증 */
export const validateAreas = (input: unknown, strict = false): AreaData => {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('영역 데이터 형식을 확인하세요.')
  const value = input as Record<string, unknown>,
    result = emptyAreas()
  const text = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 300 || /[\t\r\n]/.test(value))
      throw new Error('영역 이름을 확인하세요.')
    return value
  }
  const number = (value: unknown) => {
    if (!Number.isSafeInteger(value) || Math.abs(Number(value)) > 1e9)
      throw new Error('영역 설정은 정수로 입력하세요.')
    return Number(value)
  }
  const list = (value: unknown, maximum: number) => {
    if (!Array.isArray(value) || value.length > 10000) throw new Error('영역 목록을 확인하세요.')
    const result = value.map(number)
    if (
      result.some((id) => id < 1 || (strict && id > maximum)) ||
      new Set(result).size !== result.length
    )
      throw new Error('영역 참조 번호를 확인하세요.')
    return result
  }
  for (const key of ['bays', 'groups', 'zones', 'offsets', 'limits'] as const) {
    const rows = value[key]
    if (!Array.isArray(rows) || rows.length > 10000) throw new Error('영역 행 목록을 확인하세요.')
    if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row)))
      throw new Error('영역 행을 확인하세요.')
    if (new Set(rows.map((row) => row.name)).size !== rows.length)
      throw new Error('같은 종류의 영역 이름이 중복되었습니다.')
  }
  const rows = value as unknown as AreaData
  result.bays = rows.bays.map((row) => ({ name: text(row.name), zone: text(row.zone) }))
  result.groups = rows.groups.map((row) => ({
    name: text(row.name),
    zone: text(row.zone),
    loadLimit: number(row.loadLimit),
    unloadLimit: number(row.unloadLimit),
    agvType: number(row.agvType),
    bays: list(row.bays, rows.bays.length),
  }))
  result.zones = rows.zones.map((row) => ({
    name: text(row.name),
    groups: list(row.groups, rows.groups.length),
  }))
  result.offsets = rows.offsets.map((row) => ({
    name: text(row.name),
    realId: number(row.realId),
    offset: number(row.offset),
    groups: list(row.groups, rows.groups.length),
  }))
  result.limits = rows.limits.map((row) => ({
    name: text(row.name),
    loadLimit: number(row.loadLimit),
    unloadLimit: number(row.unloadLimit),
  }))
  const zones = new Set(result.zones.map((row) => row.name))
  if (
    strict &&
    (result.bays.some((row) => !zones.has(row.zone)) ||
      result.groups.some((row) => !zones.has(row.zone)))
  )
    throw new Error('Bay와 Bay Group의 Zone 이름을 확인하세요.')
  return result
}
/** 원본 DATA 폴더의 명명 규칙과 가변 길이 목록으로 영역 파일을 해석하는 입력 */
export const parseAreaFiles = (files: Record<string, string>): AreaData => {
  const data = emptyAreas(),
    lines = (name: string) =>
      (files[name] ?? '')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => line.split('\t'))
  const list = (row: string[], offset: number) => {
    const count = Number(row[offset])
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > 10000 ||
      row.length < offset + 1 + count
    )
      throw new Error('영역 파일 목록 개수를 확인하세요.')
    return row.slice(offset + 1, offset + 1 + count).map(Number)
  }
  data.bays = lines('bay').map((row) => ({ name: row[0], zone: row[1] }))
  data.groups = lines('bay_group').map((row) => ({
    name: row[0],
    zone: row[1],
    loadLimit: Number(row[2]),
    unloadLimit: Number(row[3]),
    agvType: Number(row[4]),
    bays: list(row, 5),
  }))
  data.zones = lines('zone').map((row) => ({ name: row[0], groups: list(row, 1) }))
  data.offsets = lines('bay_offset').map((row) => ({
    name: row[0],
    realId: Number(row[1]),
    offset: Number(row[2]),
    groups: list(row, 3),
  }))
  data.limits = lines('limit_ports').map((row) => ({
    name: row[0],
    loadLimit: Number(row[1]),
    unloadLimit: Number(row[2]),
  }))
  return validateAreas(data)
}
/** 원본과 같은 탭 구분 및 한 기반 참조로 영역 데이터 파일을 구성하는 저장 */
export const serializeAreas = (input: AreaData): Record<string, string> => {
  const data = validateAreas(input, true),
    rows = (values: (string | number)[][]) =>
      values.map((row) => row.join('\t') + '\t').join('\r\n') + (values.length ? '\r\n' : '')
  return {
    bay: rows(data.bays.map((row) => [row.name, row.zone])),
    bay_group: rows(
      data.groups.map((row) => [
        row.name,
        row.zone,
        row.loadLimit,
        row.unloadLimit,
        row.agvType,
        row.bays.length,
        ...row.bays,
      ]),
    ),
    zone: rows(data.zones.map((row) => [row.name, row.groups.length, ...row.groups])),
    bay_offset: rows(
      data.offsets.map((row) => [
        row.name,
        row.realId,
        row.offset,
        row.groups.length,
        ...row.groups,
      ]),
    ),
    limit_ports: rows(data.limits.map((row) => [row.name, row.loadLimit, row.unloadLimit])),
  }
}
