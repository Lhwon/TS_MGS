/**
 * 파일명: contextFiles.ts
 * 설명: 연결 경로 설정과 SCMD 그룹의 원본 부가 파일 형식을 읽고 갱신하는 모듈
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
export type RouteSettingKey = [type: number, previous: number, current: number, next: number]
type ScheduleGroups = Map<number, string[][]>[]
const scheduleGroupCount = 4

/** 원본 파일의 BOM과 줄 끝을 분리해 행 단위로 읽는 처리 */
const lines = (content: string) => {
  const rows = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (rows.at(-1) === '') rows.pop()
  return rows
}

/** 원본 숫자 필드가 Int32 범위에 드는 정수인지 확인 */
export const nativeInteger = (value: string | number | undefined) => {
  const number = Number(value)
  if (
    value === undefined ||
    !/^-?\d+$/.test(String(value).trim()) ||
    number < -2147483648 ||
    number > 2147483647
  )
    throw new Error('원본 데이터의 정수 값을 확인하세요.')
  return number
}

/** 진입과 현재 및 진출 노드 UID에 해당하는 연결 경로 설정 조회 */
export const readRouteSetting = (content: string, key: RouteSettingKey) => {
  const prefix = `${key.join('\t')}\t`
  const row = lines(content).find((line) => line.startsWith(prefix))
  return row?.slice(prefix.length).replace(/\t$/, '').split('\t').map(nativeInteger) ?? []
}

/** 다른 경로 설정을 그대로 두고 선택 항목만 저장하거나 제거 */
export const patchRouteSetting = (content: string, key: RouteSettingKey, values: number[]) => {
  const prefix = `${key.join('\t')}\t`
  const rows = lines(content).filter((row) => !row.startsWith(prefix))
  if (values.length) {
    const fields = key[0] === 1 ? [values.length, ...values] : values
    rows.push(`${prefix}${fields.map(nativeInteger).join('\t')}\t`)
  }
  return rows.length ? `${rows.join('\r\n')}\r\n` : ''
}

/** 상위 메시지 개수와 명령의 고정 필드를 검증하는 SCMD 명령 행 검사 */
const parseCommand = (row: string | undefined) => {
  if (!row) throw new Error('SCMD 명령 행이 없습니다.')
  const fields = row.replace(/\t$/, '').split('\t')
  fields.slice(0, 10).forEach(nativeInteger)
  const messages = nativeInteger(fields[10])
  if (messages < 0 || fields.length !== 11 + messages * 3)
    throw new Error('SCMD 상위 메시지 개수와 필드 수가 일치하지 않습니다.')
  for (let index = 11; index < fields.length; index += 3) {
    nativeInteger(fields[index + 1])
    nativeInteger(fields[index + 2])
  }
  return fields
}

/** 네 종류의 SCMD 그룹에서 포트 UID별 원본 명령 목록을 읽는 처리 */
export const readScheduleGroups = (content?: string): ScheduleGroups => {
  const groups: ScheduleGroups = Array.from({ length: scheduleGroupCount }, () => new Map())
  if (content === undefined) return groups
  const rows = lines(content)
  let index = 0
  for (const group of groups) {
    const count = nativeInteger(rows[index++]?.split('\t')[0])
    if (count < 0 || count > rows.length - index) throw new Error('SCMD 그룹 개수를 확인하세요.')
    for (let item = 0; item < count; item++) {
      const fields = rows[index++]?.split('\t') ?? []
      const uid = nativeInteger(fields[0])
      const size = nativeInteger(fields[1])
      if (size < 0 || size > rows.length - index || group.has(uid))
        throw new Error('SCMD 명령 개수 또는 중복 포트 UID를 확인하세요.')
      const commands = Array.from({ length: size }, () => parseCommand(rows[index++]))
      group.set(uid, commands)
    }
  }
  if (rows.slice(index).some((row) => row.trim()))
    throw new Error('SCMD 파일에 해석할 수 없는 추가 행이 있습니다.')
  return groups
}

/** 대상 포트 명령만 교체해 원본 그룹 및 상위 메시지 형식으로 저장 */
export const patchScheduleGroup = (
  content: string,
  section: number,
  uid: number,
  commands: string[][],
) => {
  const groups = readScheduleGroups(content)
  const group = groups[section]
  if (!group) throw new Error('SCMD 그룹 종류를 확인하세요.')
  const parsed = commands.map((command) => parseCommand(command.join('\t')))
  if (parsed.length) group.set(uid, parsed)
  else group.delete(uid)
  const rows = groups.flatMap((entries) => [
    String(entries.size),
    ...[...entries].flatMap(([portUid, items]) => [
      `${portUid}\t${items.length}`,
      ...items.map((item) => item.join('\t')),
    ]),
  ])
  return `${rows.join('\t\r\n')}\t\r\n`
}
