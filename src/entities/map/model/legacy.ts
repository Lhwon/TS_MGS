/**
 * 파일명: legacy.ts
 * 설명: 원본 지도 레코드의 원본 토폴로지 해석과 참조 정보 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { PORT_SETTINGS, PORT_RESERVATIONS } from '@/entities/map/model/portSettings.ts'
import { PATH_CONTROLS } from '@/entities/map/model/controls.ts'
import {
  emptyDocument,
  MAX_FILE_BYTES,
  MAX_NODES,
  MAX_PORTS,
  parseDocument,
} from '@/entities/map/model/map.ts'
import type { MapDocument, MapEdge, MapNode } from '@/entities/map/model/map.ts'
// 원본 지도 파서의 지원 버전 레코드 구성을 기준으로 하는 호환 변환
// 별도 연결 사용 플래그 대신 연결 대상 식별자로 판정하는 원본 렌더링 기준
/**
 * 기존 지도 레코드에서 원본 노드와 경로 및 포트를 추출하는 변환
 * 지원 버전과 레코드 수 및 참조 무결성을 확인하여 잘못된 원본을 거부하는 구조 검증
 *
 * @param content 파일에서 읽은 원본 문자열
 * @param name 파일 또는 모델을 구분하는 표시 이름
 * @param groupContent 인접 데이터 폴더에서 읽은 포트 그룹 레코드
 * @returns 원본 식별 정보와 표시 속성을 보존한 지도 문서
 */
export const previewLegacy = (content: string, name: string, groupContent = ''): MapDocument => {
  if (new TextEncoder().encode(content).length > MAX_FILE_BYTES)
    throw new Error('지도 파일은 32MB 이하여야 합니다.')
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  const version = /^Ver\.(23|25)(?:\t|$)/.exec(lines[0] ?? '')
  if (!version)
    throw new Error('기존 지도는 Ver.23 / Ver.25만 지원합니다. Ver.24는 폐기 버전입니다.')
  /**
   * 레코드 개수가 유효한 정수이며 허용 범위에 포함되는지 확인하는 크기 검증
   *
   * @param index 원본 레코드에서 읽을 필드의 위치
   * @param maximum 원본 레코드 개수의 허용 상한
   * @returns 최대 레코드 수 제한을 통과한 정수 개수
   */
  const count = (index: number, maximum: number) => {
    const raw = (lines[1] ?? '').split('\t')[index]
    const value = Number(raw)
    if (!raw?.trim() || !Number.isInteger(value) || value < 0 || value > maximum)
      throw new Error('지도 헤더 개수가 범위를 벗어났습니다.')
    return value
  }
  const nodeCount = count(0, MAX_NODES),
    portCount = count(2, MAX_PORTS),
    pathCount = count(3, MAX_NODES),
    shapeCount = count(4, MAX_NODES)
  if (lines.length < 2 + nodeCount + pathCount + portCount)
    throw new Error('지도 파일이 잘렸습니다.')
  /**
   * 원본 탭 구분 필드를 유한한 숫자로 읽고 손상된 레코드를 거부하는 수치 변환
   *
   * @param fields 탭 문자로 분리한 원본 지도 레코드의 필드 목록
   * @param index 원본 레코드에서 읽을 필드의 위치
   * @param line 오류 메시지에 포함할 원본 레코드 줄 위치
   * @returns 원본 레코드에서 읽은 유한한 수치
   */
  const number = (fields: string[], index: number, line: number) => {
    const raw = fields[index],
      value = Number(raw)
    if (!raw?.trim() || !Number.isFinite(value) || Math.abs(value) > 1e9)
      throw new Error(`${line}행 ${index + 1}열: 유효한 숫자가 필요합니다.`)
    return value
  }
  /**
   * 원본 정수 필드를 사용 여부를 나타내는 논리 값으로 변환하는 플래그 해석
   *
   * @param fields 탭 문자로 분리한 원본 지도 레코드의 필드 목록
   * @param index 원본 레코드에서 읽을 필드의 위치
   * @param line 오류 메시지에 포함할 원본 레코드 줄 위치
   * @returns 원본 필드의 사용 상태를 나타내는 논리 값
   */
  const flag = (fields: string[], index: number, line: number) => {
    const value = fields[index]?.toLowerCase()
    if (!['0', '1', 'false', 'true'].includes(value))
      throw new Error(`${line}행 ${index + 1}열: 잘못된 플래그입니다.`)
    return value === '1' || value === 'true'
  }
  const map = emptyDocument()
  map.name = name
  map.legacy = {
    version: Number(version[1]),
    nodeRecords: nodeCount,
    pathRecords: pathCount,
    shapeRecords: shapeCount,
  }
  const nodes = new Map<number, MapNode>()
  const connections: MapEdge[] = []
  for (let index = 0; index < nodeCount; index++) {
    const line = index + 3,
      fields = lines[index + 2].split('\t')
    /**
     * 원본 레코드의 누락 값과 유한 여부를 확인하는 호환 속성 수치 해석
     *
     * @param column 원본 레코드에서 조회할 속성 열 위치
     * @returns 허용 범위 안의 유한한 수치
     */
    const num = (column: number) => number(fields, column, line)
    const node: MapNode = {
      id: num(0),
      x: num(1),
      y: num(2),
      name: `N${num(0)}`,
      direction: num(3),
      realId: num(28),
      uid: num(29),
      virtual: flag(fields, 10, line),
      curve: flag(fields, 11, line),
      curveStart: flag(fields, 12, line),
      property: num(32),
      removable: flag(fields, 33, line),
      changeable: flag(fields, 34, line),
      bayChange: flag(fields, 35, line),
      spinturnable: flag(fields, 36, line),
      dontRemoveCmd: flag(fields, 40, line),
      addressType: num(43),
      noSendGoalLoaded: flag(fields, 44, line),
      noSendGoal: flag(fields, 37, line),
      safetyViewDistance: num(41),
      safetyDistance: num(42),
    }
    const previous = nodes.get(node.id)
    if (
      previous &&
      (previous.x !== node.x ||
        previous.y !== node.y ||
        previous.realId !== node.realId ||
        previous.uid !== node.uid)
    )
      throw new Error(`${line}행: 중복 노드 ${node.id}의 식별 정보 또는 좌표가 다릅니다.`)
    nodes.set(node.id, node)
    const target = num(14)
    if (target !== -1 && target !== node.id)
      connections.push({
        id: `${node.id}-${target}`,
        from: node.id,
        to: target,
        direction: num(3),
        drivingType: num(4),
        distance: num(5),
        speed: num(6),
        radius: num(7),
        curveAngle: num(8),
        goalDegree: num(9),
        realConnection: num(21),
      })
  }
  map.nodes = [...nodes.values()]
  const seen = new Set<string>()
  for (const edge of connections) {
    if (!nodes.has(edge.to)) throw new Error(`경로 ${edge.id}의 도착 노드가 없습니다.`)
    if (!seen.has(edge.id)) {
      seen.add(edge.id)
      map.edges.push(edge)
    }
  }
  // 방향별 계획 경로에 보관된 제어값을 대응하는 도면 연결선으로 해석하는 이관
  for (const line of lines.slice(2 + nodeCount, 2 + nodeCount + pathCount)) {
    const fields = line.split('\t'),
      id = Number(fields[0]),
      count = Number(fields[9])
    let offset = 25
    for (let i = 0; i < count; i++) {
      const target = Number(fields[offset]),
        backward = Number(fields[offset + 24]) === 2
      const edge = map.edges.find((edge) =>
        backward ? edge.from === id && edge.to === target : edge.from === target && edge.to === id,
      )
      if (edge) {
        edge.controls ??= {}
        const values: Record<string, number> = {}
        for (const field of PATH_CONTROLS) {
          const value = Number(fields[offset + field.column])
          if (Number.isFinite(value)) values[field.key] = value
        }
        edge.controls[backward ? 'backward' : 'forward'] = values
      }
      const bays = Number(fields[offset + 54])
      if (edge)
        edge.bays = [
          ...new Set([
            ...(edge.bays ?? []),
            ...fields.slice(offset + 55, offset + 55 + bays).map(Number),
          ]),
        ]
      if (!Number.isSafeInteger(bays) || bays < 0) throw new Error('경로 Bay 개수를 확인하세요.')
      offset += 55 + bays
    }
  }
  const portUids = new Map<number, string>()
  for (let index = 0; index < portCount; index++) {
    const line = 3 + nodeCount + pathCount + index,
      fields = lines[line - 1].split('\t')
    /**
     * 원본 레코드의 누락 값과 유한 여부를 확인하는 호환 속성 수치 해석
     *
     * @param column 원본 레코드에서 조회할 속성 열 위치
     * @returns 허용 범위 안의 유한한 수치
     */
    const num = (column: number) => number(fields, column, line)
    const nodeId = num(1)
    if (!nodes.has(nodeId)) throw new Error(`${line}행: 포트 ${fields[4]}의 연결 노드가 없습니다.`)
    if (fields[208] !== undefined) portUids.set(num(208), fields[4])
    let listOffset = 246
    const reservations: NonNullable<import('@/entities/map/model/map.ts').MapPort['reservations']> =
      {}
    for (let list = 0; list < 8 && fields[listOffset] !== undefined; list++) {
      const count = Number(fields[listOffset])
      if (
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > 5000 ||
        listOffset + count >= fields.length
      )
        throw new Error('포트 예약 개수를 확인하세요.')
      reservations[PORT_RESERVATIONS[list].key] = fields
        .slice(listOffset + 1, listOffset + 1 + count)
        .map(Number)
      listOffset += count + 1
    }
    const bayCount = Number(fields[listOffset] ?? 0)
    const portBays =
      fields[listOffset] !== undefined
        ? fields.slice(listOffset + 1, listOffset + 1 + bayCount).map(Number)
        : []
    map.ports.push({
      id: fields[4],
      uid: num(208),
      reservations,
      name: fields[5] === '(null)' ? '' : fields[5],
      nodeId,
      bays: portBays,
      settings: Object.fromEntries(
        PORT_SETTINGS.flatMap((field) =>
          fields[field.column] === undefined
            ? []
            : [
                [
                  field.key,
                  field.kind === 'text'
                    ? fields[field.column] === '(null)'
                      ? ''
                      : fields[field.column]
                    : Number(fields[field.column]),
                ],
              ],
        ),
      ),
      x: num(9),
      y: num(10),
      width: num(11),
      height: num(12),
      strokeColor: num(6),
      fillColor: num(7),
      fontColor: num(8),
      floor: num(22),
      nameDistance: num(17),
      namePosition: num(18),
      nameDirection: num(19),
      ...(fields[207] === undefined ? {} : { fontSize: num(207) }),
    })
  }
  const shapeRows = Math.max(0, shapeCount - 1)
  const shapeStart = 2 + nodeCount + pathCount + portCount
  if (lines.length < shapeStart + shapeRows) throw new Error('도형 레코드가 잘렸습니다.')
  if (shapeRows) map.shapes = []
  for (let index = 0; index < shapeRows; index++) {
    const fields = lines[shapeStart + index].split('\t')
    const line = shapeStart + index + 1
    map.shapes!.push({
      id: number(fields, 0, line),
      description: fields[1] === '(null)' ? '' : fields[1],
      text: fields[2] === '(null)' ? '' : fields[2],
      x1: number(fields, 3, line),
      y1: number(fields, 4, line),
      x2: number(fields, 5, line),
      y2: number(fields, 6, line),
      centerX: number(fields, 7, line),
      centerY: number(fields, 8, line),
      radius: number(fields, 9, line),
      width: number(fields, 10, line),
      height: number(fields, 11, line),
      type: number(fields, 12, line),
      strokeColor: number(fields, 13, line),
      strokeStyle: number(fields, 14, line),
      strokeWidth: number(fields, 15, line),
      fillColor: number(fields, 16, line),
      fontColor: number(fields, 17, line),
      fontAlign: number(fields, 18, line),
      fontDirection: number(fields, 19, line),
      fillStyle: number(fields, 20, line),
    })
  }
  if (Number(version[1]) >= 25 && groupContent.trim()) {
    map.portGroups = groupContent
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line, index) => {
        const fields = line.split('\t')
        const count = number(fields, 19, index + 1)
        if (
          !Number.isInteger(count) ||
          count < 0 ||
          count > MAX_PORTS ||
          fields.length < 20 + count
        )
          throw new Error('포트 그룹 레코드를 확인하세요.')
        return {
          id: fields[0],
          nodeId: number(fields, 7, index + 1),
          nodeX: number(fields, 9, index + 1),
          nodeY: number(fields, 10, index + 1),
          offsetX: number(fields, 5, index + 1),
          offsetY: number(fields, 6, index + 1),
          x: number(fields, 1, index + 1),
          y: number(fields, 2, index + 1),
          width: number(fields, 3, index + 1),
          height: number(fields, 4, index + 1),
          strokeColor: number(fields, 11, index + 1),
          fillColor: number(fields, 12, index + 1),
          fontColor: number(fields, 13, index + 1),
          fontSize: number(fields, 14, index + 1),
          nameDistance: number(fields, 15, index + 1),
          namePosition: number(fields, 16, index + 1),
          nameDirection: number(fields, 17, index + 1),
          nameAlign: number(fields, 18, index + 1),
          portIds: Array.from({ length: count }, (_, offset) =>
            portUids.get(number(fields, 20 + offset, index + 1)),
          ).filter((id): id is string => id !== undefined),
        }
      })
  }
  return parseDocument(JSON.stringify(map))
}
