/**
 * 파일명: legacyWriter.ts
 * 설명: 원본 제어 레코드 보존과 직선 및 커브 경로의 JMAPX 저장 동기화
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { PORT_SETTINGS, PORT_RESERVATIONS } from '@/entities/map/model/portSettings.ts'
import { PATH_CONTROLS } from '@/entities/map/model/controls.ts'
import { previewLegacy } from '@/entities/map/model/legacy.ts'
import { parseDocument } from '@/entities/map/model/map.ts'
import type { MapDocument, MapEdge, MapNode } from '@/entities/map/model/map.ts'

export interface LegacySource {
  content: string
  groups: string
  baseline: MapDocument
}
export interface LegacyWriteOptions {
  rebuildControls?: boolean
  autoReverseOrthogonal?: boolean
}

/**
 * 원본과 편집 문서의 동일 속성을 비교하는 변경 판정
 * @param before 원본 객체
 * @param after 편집 객체
 * @returns 직렬화한 속성의 동일 여부
 */
const same = (before: unknown, after: unknown) => JSON.stringify(before) === JSON.stringify(after)

/**
 * 탭 구분 문자열을 훼손하는 사용자 입력을 거부하는 원본 형식 검증
 * @param value 저장할 문자열
 * @returns 원본 공백 표현을 적용한 문자열
 */
const fieldText = (value: string) => {
  if (/[\t\r\n]/.test(value)) throw new Error('JMAPX 문자열에는 탭과 줄바꿈을 사용할 수 없습니다.')
  return value || '(null)'
}

/**
 * 원본 정수 좌표 형식에 맞지 않는 값을 거부하는 저장 수치 검증
 * @param value 저장할 수치
 * @returns 원본 정수 표현
 */
const integer = (value: number) => {
  if (!Number.isSafeInteger(value)) throw new Error('MGS 좌표와 크기는 정수 mm로 입력하세요.')
  return String(value)
}

/**
 * 기존 레코드의 변경 속성만 교체하여 미해석 필드를 유지하는 속성 패치
 * @param row 원본 필드 배열
 * @param before 기존 표시 객체
 * @param after 변경 표시 객체
 * @param columns 속성과 원본 열의 대응
 */
const patch = (
  row: string[],
  before: object | undefined,
  after: object,
  columns: Record<string, number>,
) => {
  const old = before as Record<string, unknown> | undefined
  const next = after as Record<string, unknown>
  for (const [key, column] of Object.entries(columns)) {
    const value = next[key]
    if (value === undefined || (old && same(old[key], value))) continue
    row[column] =
      typeof value === 'string'
        ? fieldText(value)
        : typeof value === 'boolean'
          ? String(Number(value))
          : integer(value as number)
  }
}

/**
 * 원본 가변 길이 경로 레코드에서 연결 블록과 후행 속성을 분리하는 해석
 * @param fields 탭 구분 경로 필드
 * @returns 접두 속성과 연결 블록 및 미해석 후행 속성
 */
const splitPath = (fields: string[]) => {
  const count = Number(fields[9])
  if (!Number.isInteger(count) || count < 0 || count > 10)
    throw new Error('원본 경로의 연결 개수를 확인하세요.')
  let offset = 25
  const blocks: string[][] = []
  for (let index = 0; index < count; index++) {
    // 폐기된 ODS 목록 위치를 그대로 유지하는 Ver 스물셋과 스물다섯의 공통 필드 구성
    const bayCount = Number(fields[offset + 54])
    if (!Number.isInteger(bayCount) || bayCount < 0 || offset + 55 + bayCount > fields.length)
      throw new Error('원본 경로의 Bay 목록이 손상되었습니다.')
    blocks.push(fields.slice(offset, offset + 55 + bayCount))
    offset += 55 + bayCount
  }
  if (fields.length < offset + 31) throw new Error('원본 경로 레코드가 잘렸습니다.')
  return { head: fields.slice(0, 25), blocks, tail: fields.slice(offset) }
}

/**
 * 원본 노드 기준 경로 각도와 거리를 구하는 직선 기하 계산
 * @param from 출발 노드
 * @param to 연결 노드
 * @returns 정수 거리와 정방향 라디안 및 도 단위 각도
 */
const geometry = (from: MapNode, to: MapNode) => {
  const radian = Math.atan2(to.y - from.y, to.x - from.x)
  return {
    distance: Math.trunc(Math.hypot(to.x - from.x, to.y - from.y)),
    radian,
    degree: (radian * 180) / Math.PI,
  }
}

/**
 * 원본 역방향 각도 함수와 절삭 규칙으로 차량 유지각을 구하는 직선 제어각 계산
 * @param from 도면의 시작 노드
 * @param to 도면의 연결 노드
 * @returns 천분의 도 단위 차량 유지각
 */
const vehicleDegree = (from: MapNode, to: MapNode) => {
  let degree = (Math.atan2(from.y - to.y, from.x - to.x || 1e-11) * 180) / Math.PI
  while (degree < 0) degree += 360
  while (degree >= 360) degree -= 360
  return Math.trunc(degree * 1000)
}

/**
 * MGS 원본과 동일한 역방향 계획 경로를 구성하는 연결 목록 생성
 * @param map 저장할 지도
 * @returns 계획 노드별 연결 경로
 */
const planningEdges = (map: MapDocument) => {
  const result = new Map<number, { target: number; edge: MapEdge; reverse: boolean }[]>()
  for (const node of map.nodes) result.set(node.id, [])
  for (const edge of map.edges) {
    result.get(edge.to)!.push({ target: edge.from, edge, reverse: false })
    if ((edge.direction ?? 0) === 1)
      result.get(edge.from)!.push({ target: edge.to, edge, reverse: true })
  }
  for (const rows of result.values())
    if (rows.length > 10) throw new Error('MGS 노드별 계획 경로는 최대 열 개입니다.')
  return result
}

/**
 * 원본 미해석 제어값과 포트 속성을 보존하며 JMAPX와 포트 그룹을 생성하는 원본 저장 변환
 * @param input 편집을 완료한 지도 문서
 * @param source 처음 열었을 때의 원본 레코드와 표시 문서
 * @returns 원본 지도 문자열과 별도 포트 그룹 문자열
 */
export const serializeLegacy = (
  input: MapDocument,
  source?: LegacySource | null,
  options: LegacyWriteOptions = {},
) => {
  const map = parseDocument(JSON.stringify(input))
  if (map.units !== 'mm')
    throw new Error('도면 기준 거리를 지정해 mm 축척을 확정한 후 JMAPX로 저장하세요.')
  const before = source?.baseline
  if (before && same(before, map) && !options.rebuildControls && !options.autoReverseOrthogonal)
    return { content: source!.content, groups: source!.groups }
  const lines = source?.content.replace(/^\uFEFF/, '').split(/\r?\n/) ?? []
  const header = lines[1]?.split('\t') ?? ['0', '-111', '0', '0', '1', '0', '0', '0', '']
  const nodeCount = Number(header[0])
  const pathCount = Number(header[3])
  const portCount = Number(header[2])
  const version = before?.legacy?.version ?? 25
  const nodes = new Map(map.nodes.map((node) => [node.id, node]))
  const oldNodes = new Map(before?.nodes.map((node) => [node.id, node]) ?? [])
  const oldEdges = new Map(before?.edges.map((edge) => [`${edge.from}-${edge.to}`, edge]) ?? [])
  const edges = new Map(map.edges.map((edge) => [`${edge.from}-${edge.to}`, edge]))
  const topologyChanged =
    !before ||
    !same(
      before.nodes.map((node) => node.id),
      map.nodes.map((node) => node.id),
    ) ||
    !same(
      before.edges.map((edge) => [edge.from, edge.to, edge.direction ?? 0, edge.drivingType ?? 1]),
      map.edges.map((edge) => [edge.from, edge.to, edge.direction ?? 0, edge.drivingType ?? 1]),
    )
  const sortedIds = [...nodes.keys()].sort((a, b) => a - b)
  if (topologyChanged && sortedIds.some((id, index) => id !== index + 1))
    throw new Error('원본 저장은 연속된 노드 ID가 필요합니다. 편집기의 ID 재정렬을 적용하세요.')
  const moved = new Set(
    map.nodes
      .filter((node) => {
        const old = oldNodes.get(node.id)
        return old && (old.x !== node.x || old.y !== node.y)
      })
      .map((node) => node.id),
  )
  // 기존 곡선 연결은 유지하고 새로 생성한 곡선 체인은 독립적으로 추가하는 저장 경계
  if (
    topologyChanged &&
    before?.edges.some((edge) => {
      if (
        ![2, 3].includes(edge.drivingType ?? 1) &&
        !oldNodes.get(edge.from)?.curve &&
        !oldNodes.get(edge.to)?.curve
      )
        return false
      const current = edges.get(`${edge.from}-${edge.to}`)
      return (
        !current || current.direction !== edge.direction || current.drivingType !== edge.drivingType
      )
    })
  )
    throw new Error('기존 커브의 연결 변경은 커브 체인을 함께 편집해야 합니다.')
  const straightReferences = new Map<number, MapEdge>(),
    firstConnections = new Map<number, MapEdge>()
  for (const edge of map.edges) {
    if (!firstConnections.has(edge.from)) firstConnections.set(edge.from, edge)
    const realId = nodes.get(edge.from)!.realId ?? edge.from
    if ((edge.drivingType ?? 1) === 1 && !straightReferences.has(realId))
      straightReferences.set(realId, edge)
  }
  /** 원본의 직선 기준 탐색을 따르며 닫힌 순환에서 무한 탐색을 차단하는 특수 주행 각도 계산 */
  const automaticDegree = (edge: MapEdge) => {
    const manual = edge.controls?.forward
    if (
      manual?.manualDegree === 1 &&
      manual.vehicleDegree !== undefined &&
      manual.vehicleDegree !== -1
    )
      return manual.vehicleDegree
    if ((edge.drivingType ?? 1) <= 3)
      return vehicleDegree(nodes.get(edge.from)!, nodes.get(edge.to)!)
    let current = nodes.get(edge.to)!
    const visited = new Set<number>()
    while (!visited.has(current.id)) {
      visited.add(current.id)
      const straight = straightReferences.get(current.realId ?? current.id)
      if (straight) return vehicleDegree(nodes.get(straight.from)!, nodes.get(straight.to)!)
      const next = firstConnections.get(current.id)
      if (!next) break
      current = nodes.get(next.to)!
    }
    throw new Error(
      `경로 N${edge.from}-N${edge.to}의 사행·직각·Crab 기준 직선을 찾을 수 없습니다. 연결 또는 수동 차량 각도를 확인하세요.`,
    )
  }
  for (const node of map.nodes) {
    integer(node.x)
    integer(node.y)
    if (oldNodes.has(node.id) && node.name !== oldNodes.get(node.id)!.name)
      throw new Error('원본 MGS 노드는 ID를 이름으로 표시합니다.')
    if (node.id < 1) throw new Error('MGS 노드 ID는 하나 이상이어야 합니다.')
  }
  const nodeColumns = {
    x: 1,
    y: 2,
    direction: 3,
    realId: 28,
    uid: 29,
    virtual: 10,
    curve: 11,
    curveStart: 12,
    property: 32,
    removable: 33,
    changeable: 34,
    bayChange: 35,
    spinturnable: 36,
    dontRemoveCmd: 40,
    addressType: 43,
    noSendGoalLoaded: 44,
    noSendGoal: 37,
    safetyViewDistance: 41,
    safetyDistance: 42,
  }
  const edgeColumns = {
    direction: 3,
    drivingType: 4,
    distance: 5,
    speed: 6,
    radius: 7,
    curveAngle: 8,
    goalDegree: 9,
  }
  const originalRows = lines.slice(2, 2 + nodeCount).map((line) => line.split('\t'))
  const rows: string[][] = []
  const represented = new Set<string>()
  const representedNodes = new Set<number>()
  for (const original of originalRows) {
    const id = Number(original[0])
    const node = nodes.get(id)
    if (!node) continue
    const target = Number(original[14])
    if (target === -1 && map.edges.some((edge) => edge.from === id)) continue
    const key = `${id}-${target}`
    const edge = edges.get(key)
    if (target !== -1 && !edge) continue
    const row = [...original]
    patch(row, oldNodes.get(id), node, nodeColumns)
    if (edge) {
      patch(row, oldEdges.get(key), edge, edgeColumns)
      const to = nodes.get(target)!
      if (moved.has(id) || moved.has(target)) {
        const geo = geometry(node, to)
        row[5] = String(geo.distance)
      }
      if (moved.has(target)) {
        row[16] = integer(to.x)
        row[17] = integer(to.y)
      }
      if (to.uid !== oldNodes.get(to.id)?.uid) row[30] = String(to.uid ?? to.id)
      represented.add(key)
    }
    const realTarget = nodes.get(Number(row[21]))
    if (realTarget && moved.has(realTarget.id)) {
      row[23] = integer(realTarget.x)
      row[24] = integer(realTarget.y)
    }
    if (realTarget && realTarget.uid !== oldNodes.get(realTarget.id)?.uid)
      row[31] = String(realTarget.uid ?? realTarget.id)
    rows.push(row)
    representedNodes.add(id)
  }
  for (const node of map.nodes) {
    const outgoing = map.edges.filter(
      (edge) => edge.from === node.id && !represented.has(`${edge.from}-${edge.to}`),
    )
    if (!outgoing.length && representedNodes.has(node.id)) continue
    for (const edge of outgoing.length ? outgoing : [undefined]) {
      const template =
        originalRows.find((row) => Number(row[0]) === node.id && Number(row[14]) === -1) ??
        originalRows.find((row) => Number(row[0]) === node.id)
      const row = template ? [...template] : [...Array<string>(58).fill('0'), '']
      row[0] = String(node.id)
      row[7] = row[8] = '-1'
      row[14] = row[15] = row[21] = row[22] = row[30] = row[31] = '-1'
      row[28] = String(node.realId ?? node.id)
      row[29] = String(node.uid ?? node.id)
      if (!template) {
        row[33] = '1'
        row[34] = row[36] = '0'
      }
      patch(row, undefined, { ...node, removable: node.removable ?? true }, nodeColumns)
      if (edge) {
        const to = nodes.get(edge.to)!
        const geo = geometry(node, to)
        row[3] = String(edge.direction ?? 0)
        row[4] = String(edge.drivingType ?? 1)
        row[5] = String(edge.distance ?? geo.distance)
        row[6] = String(edge.speed ?? 0)
        row[7] = String(edge.radius ?? -1)
        row[8] = String(edge.curveAngle ?? 0)
        row[13] = '1'
        row[9] = String(Math.trunc(edge.goalDegree ?? (geo.degree + 360) % 360))
        const realTarget = nodes.get(edge.realConnection ?? to.id) ?? to
        row[14] = String(to.id)
        row[21] = String(realTarget.id)
        row[16] = integer(to.x)
        row[17] = integer(to.y)
        row[23] = integer(realTarget.x)
        row[24] = integer(realTarget.y)
        row[18] = String(map.edges.find((item) => item.from === to.id)?.drivingType ?? 1)
        row[25] = String(map.edges.find((item) => item.from === realTarget.id)?.drivingType ?? 1)
        row[19] = String(Number(to.virtual ?? false))
        row[20] = String(Number(to.curve ?? false))
        row[26] = String(Number(realTarget.virtual ?? false))
        row[27] = String(Number(realTarget.curve ?? false))
        row[30] = String(to.uid ?? to.id)
        row[31] = String(realTarget.uid ?? realTarget.id)
        row[38] = String(geo.radian)
      }
      rows.push(row)
    }
  }
  // 원본 중복 노드의 연결 인덱스를 최종 레코드 순서에 맞추는 참조 갱신
  if (topologyChanged) {
    const indexes = new Map(rows.map((row, index) => [Number(row[0]), index]))
    for (const row of rows) {
      if (rows[Number(row[15])]?.[0] !== row[14])
        row[15] = String(indexes.get(Number(row[14])) ?? -1)
      if (rows[Number(row[22])]?.[0] !== row[21])
        row[22] = String(indexes.get(Number(row[21])) ?? -1)
    }
  }
  const rawPaths = new Map(
    lines.slice(2 + nodeCount, 2 + nodeCount + pathCount).map((line) => {
      const fields = line.split('\t')
      return [Number(fields[0]), fields] as const
    }),
  )
  const planning = topologyChanged ? planningEdges(map) : null
  let paths: string[][] = []
  for (const node of [...map.nodes].sort((a, b) => a.id - b.id)) {
    const raw = rawPaths.get(node.id)
    if (!raw && !topologyChanged) throw new Error(`노드 ${node.id}의 원본 계획 경로가 없습니다.`)
    const path = raw
      ? splitPath(raw)
      : {
          head: Array<string>(25).fill('0'),
          blocks: [] as string[][],
          tail: [...Array<string>(30).fill('0'), '0', '-1', '-1', '-1', '-1', ''],
        }
    if (!raw) {
      path.head[0] = String(node.id)
      path.head[1] = String(node.realId ?? node.id)
      path.head[20] = '1'
      path.head[21] = '-1'
      path.tail[0] = '-1'
      path.tail[1] = String(node.uid ?? node.id)
    }
    patch(path.head, oldNodes.get(node.id), node, {
      x: 6,
      y: 7,
      realId: 1,
      virtual: 3,
      curve: 4,
      curveStart: 5,
      direction: 22,
      noSendGoal: 23,
      addressType: 18,
      bayChange: 19,
      spinturnable: 20,
      dontRemoveCmd: 24,
    })
    patch(path.tail, oldNodes.get(node.id), node, {
      uid: 1,
      property: 4,
      safetyViewDistance: 5,
      safetyDistance: 6,
      noSendGoalLoaded: 7,
      addressType: 8,
    })
    const incoming = map.edges.find((edge) => edge.from === node.id)
    if (
      incoming?.curveAngle !== undefined &&
      (!raw || !oldEdges.has(`${incoming.from}-${incoming.to}`))
    ) {
      path.head[8] = String((incoming.curveAngle * Math.PI) / 180)
      path.tail[0] = String(incoming.radius ?? -1)
    }
    if (planning) {
      const oldBlocks = new Map(path.blocks.map((block) => [Number(block[0]), block]))
      path.blocks = planning.get(node.id)!.map(({ target, edge, reverse }) => {
        const to = nodes.get(target)!
        const block = oldBlocks.get(target) ?? Array<string>(55).fill('0')
        const geo = geometry(node, to)
        const reversedType = edge.drivingType ?? 1
        block[0] = String(target)
        block[1] = String(to.realId ?? to.id)
        block[2] = String(Number(to.virtual ?? false))
        block[3] = String(Number(to.curve ?? false))
        block[4] = String(Number(to.curveStart ?? false))
        block[5] = String(
          reverse && reversedType > 1
            ? reversedType % 2 === 0
              ? reversedType + 1
              : reversedType - 1
            : reversedType,
        )
        block[6] = String(edge.distance ?? geo.distance)
        block[7] = String(edge.speed ?? 0)
        if (
          !oldBlocks.has(target) ||
          !same(edge.curveAngle, oldEdges.get(`${edge.from}-${edge.to}`)?.curveAngle)
        ) {
          block[12] = String(((edge.curveAngle ?? 0) * Math.PI) / 180)
          block[13] = String(Number(to.noSendGoalLoaded ?? false))
        }
        block[24] = reverse ? '2' : '1'
        block[26] = String(to.uid ?? to.id)
        block[48] = String(edge.direction ?? 0)
        return block
      })
      path.head[9] = String(path.blocks.length)
    } else {
      for (const block of path.blocks) {
        const to = nodes.get(Number(block[0]))
        if (!to) throw new Error('원본 계획 경로에 없는 노드 참조가 있습니다.')
        const edge = edges.get(`${to.id}-${node.id}`) ?? edges.get(`${node.id}-${to.id}`)
        if (!edge) continue
        const oldEdge = oldEdges.get(`${edge.from}-${edge.to}`)
        if (moved.has(node.id) || moved.has(to.id)) {
          const geo = geometry(node, to)
          block[6] = String(geo.distance)
        }
        if (edge.speed !== oldEdge?.speed && edge.speed !== undefined)
          block[7] = integer(edge.speed)
        if (edge.distance !== oldEdge?.distance && edge.distance !== undefined)
          block[6] = integer(edge.distance)
      }
    }
    for (const block of path.blocks) {
      const target = Number(block[0]),
        backward = Number(block[24]) === 2
      const edge = edges.get(backward ? `${node.id}-${target}` : `${target}-${node.id}`)
      if (!edge) continue
      const linked = nodes.get(target)!,
        oldLinked = oldNodes.get(target)
      patch(block, oldLinked, linked, {
        realId: 1,
        uid: 26,
        virtual: 2,
        curve: 3,
        curveStart: 4,
        noSendGoal: 9,
        noSendGoalLoaded: 13,
      })
      const direction = backward ? 'backward' : 'forward'
      const control = edge.controls?.[direction],
        oldControl = oldEdges.get(`${edge.from}-${edge.to}`)?.controls?.[direction]
      for (const field of PATH_CONTROLS)
        if (control?.[field.key] !== undefined && control[field.key] !== oldControl?.[field.key])
          block[field.column] = integer(control[field.key])
    }
    path.blocks = path.blocks.map((block) => {
      const target = Number(block[0]),
        backward = Number(block[24]) === 2,
        key = backward ? `${node.id}-${target}` : `${target}-${node.id}`,
        edge = edges.get(key)
      if (edge?.bays !== undefined && !same(edge.bays, oldEdges.get(key)?.bays))
        return [...block.slice(0, 54), String(edge.bays.length), ...edge.bays.map(String)]
      return block
    })
    paths.push([...path.head, ...path.blocks.flat(), ...path.tail])
  }
  if (
    options.rebuildControls ||
    options.autoReverseOrthogonal ||
    topologyChanged ||
    moved.size ||
    map.edges.some(
      (edge) => !same(edge.controls, oldEdges.get(`${edge.from}-${edge.to}`)?.controls),
    )
  ) {
    const pathParts = paths.map(splitPath)
    if (options.autoReverseOrthogonal) {
      const byRealId = new Map<string, (typeof pathParts)[number][]>()
      for (const part of pathParts) {
        const matches = byRealId.get(part.head[1]) ?? []
        matches.push(part)
        byRealId.set(part.head[1], matches)
      }
      for (const part of pathParts)
        for (const block of part.blocks) {
          const kind = Number(block[5])
          if (
            Number(block[24]) !== 2 ||
            kind < 4 ||
            kind > 9 ||
            (Number(block[27]) === 1 && Number(block[15]) !== -1)
          )
            continue
          // 연결 하나인 경우 상대 Real ID를 기준으로 찾고 분기에서는 같은 노드의 다른 경로를 사용
          const candidates =
            part.blocks.length === 1
              ? (byRealId.get(block[1]) ?? []).flatMap((source) => source.blocks)
              : part.blocks
          for (const candidate of candidates) {
            const type = Number(candidate[5])
            if (candidate !== block && type >= 4 && type <= 9) block[16] = candidate[16]
          }
        }
    }
    const indexes = new Map<string, number>()
    let sequence = 1
    for (const part of pathParts) {
      const id = Number(part.head[0])
      if (topologyChanged || options.rebuildControls)
        part.tail[2] = part.blocks.length ? String(sequence) : '0'
      for (const block of part.blocks) indexes.set(`${id}-${block[0]}`, sequence++)
    }
    const orientations = new Map<string, { forward: number; backward: number }>()
    for (const part of pathParts) {
      const id = Number(part.head[0])
      for (const block of part.blocks) {
        const target = Number(block[0])
        const key = Number(block[24]) === 2 ? `${id}-${target}` : `${target}-${id}`
        const edge = edges.get(key)
        if (!edge) continue
        if (topologyChanged || options.rebuildControls) {
          const reverse = indexes.get(`${target}-${id}`) ?? -1
          block[49] = block[50] = String(reverse)
        }
        // 수동 각도를 유지하며 양방향에서도 동일한 차량 유지각을 사용하는 원본 제어 규칙
        if (Number(block[27]) !== 1 || Number(block[15]) === -1)
          block[15] = String(automaticDegree(edge))
        let degree = Math.fround(Number(block[15]) / 1000)
        if (Number(block[16]) === 1) {
          degree -= 180
          if (degree < 0) degree += 360
        }
        const value = orientations.get(key) ?? { forward: -999, backward: -999 }
        value[Number(block[24]) === 2 ? 'backward' : 'forward'] = (degree * Math.PI) / 180
        orientations.set(key, value)
      }
    }
    for (const row of rows) {
      const orientation = orientations.get(`${row[0]}-${row[14]}`)
      if (orientation) {
        row[38] = String(orientation.forward)
        row[39] = String(orientation.backward)
      }
    }
    for (const part of pathParts) {
      for (const block of part.blocks) {
        const key =
          Number(block[24]) === 2 ? `${part.head[0]}-${block[0]}` : `${block[0]}-${part.head[0]}`
        const orientation = orientations.get(key)
        if (orientation) {
          block[10] = String(orientation.forward)
          block[11] = String(orientation.backward)
        }
      }
    }
    paths = pathParts.map((part) => [...part.head, ...part.blocks.flat(), ...part.tail])
  }
  const oldPorts = new Map(before?.ports.map((port) => [port.id, port]) ?? [])
  const rawPorts = new Map(
    lines.slice(2 + nodeCount + pathCount, 2 + nodeCount + pathCount + portCount).map((line) => {
      const row = line.split('\t')
      return [row[4], row] as const
    }),
  )
  const removedPorts = new Set(
    [...rawPorts.keys()].filter((id) => !map.ports.some((port) => port.id === id)),
  )
  if (removedPorts.size) {
    const removedUids = new Set([...removedPorts].map((id) => Number(rawPorts.get(id)![208])))
    for (const [id, row] of rawPorts) {
      if (removedPorts.has(id)) continue
      let referenced = removedPorts.has(
        String(map.ports.find((port) => port.id === id)?.settings?.id_port_parent ?? row[164]),
      )
      let offset = 246
      for (let index = 0; index < 8; index++) {
        const count = Number(row[offset])
        if (!Number.isInteger(count) || count < 0 || offset + count >= row.length)
          throw new Error('포트 예약 목록의 원본 개수를 확인하세요.')
        const effective =
          map.ports.find((port) => port.id === id)?.reservations?.[PORT_RESERVATIONS[index].key] ??
          row.slice(offset + 1, offset + 1 + count).map(Number)
        referenced ||= effective.some((uid) => removedUids.has(uid))
        offset += 1 + count
      }
      if (referenced)
        throw new Error(
          `포트 ${id}의 부모 또는 예약 목록에서 삭제 대상 포트를 참조합니다. 연결 데이터를 먼저 정리하세요.`,
        )
    }
  }
  if (
    map.portGroups?.some(
      (group) =>
        group.nodeId !== undefined && oldNodes.has(group.nodeId) && !nodes.has(group.nodeId),
    )
  )
    throw new Error('포트 그룹의 기준 노드를 먼저 변경한 후 삭제하세요.')
  const allocatedPortUids = new Set([...rawPorts.values()].map((row) => Number(row[208])))
  let maximumPortUid = Math.max(
    Number(header[7]) || 0,
    0,
    ...map.ports.map((port) => port.uid ?? 0),
  )
  const ports = map.ports.map((port) => {
    const original = rawPorts.get(port.id)
    const row = original ?? [...Array<string>(259).fill('0'), '']
    if (!original) {
      row[4] = fieldText(port.id)
      row[6] = '16711935'
      row[7] = '16777215'
      row[11] = row[12] = '1000'
      row[17] = '100'
      row[207] = '40'
      const uid =
        port.uid !== undefined && port.uid > (Number(header[7]) || 0) ? port.uid : ++maximumPortUid
      if (!Number.isSafeInteger(uid) || uid < 1 || allocatedPortUids.has(uid))
        throw new Error('새 포트의 UID 중복 또는 범위를 확인하세요.')
      allocatedPortUids.add(uid)
      row[208] = String(uid)
      row[226] = String(nodes.get(port.nodeId)!.realId ?? port.nodeId)
      row[244] = '-1'
    }
    patch(row, oldPorts.get(port.id), port, {
      nodeId: 1,
      name: 5,
      strokeColor: 6,
      fillColor: 7,
      fontColor: 8,
      x: 9,
      y: 10,
      width: 11,
      height: 12,
      nameDistance: 17,
      namePosition: 18,
      nameDirection: 19,
      floor: 22,
      fontSize: 207,
    })
    for (const field of PORT_SETTINGS) {
      const value = port.settings?.[field.key]
      if (value !== undefined && value !== oldPorts.get(port.id)?.settings?.[field.key])
        row[field.column] =
          field.kind === 'text' ? fieldText(String(value)) : integer(Number(value))
    }
    let reservationOffset = 246
    for (const field of PORT_RESERVATIONS) {
      const count = Number(row[reservationOffset])
      if (!Number.isSafeInteger(count) || count < 0 || reservationOffset + count >= row.length)
        throw new Error('포트 예약 목록의 개수를 확인하세요.')
      const list = port.reservations?.[field.key]
      if (list !== undefined && !same(list, oldPorts.get(port.id)?.reservations?.[field.key])) {
        row.splice(reservationOffset, 1 + count, String(list.length), ...list.map(integer))
        reservationOffset += 1 + list.length
      } else reservationOffset += 1 + count
    }
    const node = nodes.get(port.nodeId)!
    if (
      moved.has(node.id) ||
      oldPorts.get(port.id)?.nodeId !== port.nodeId ||
      oldNodes.get(node.id)?.uid !== node.uid ||
      oldNodes.get(node.id)?.realId !== node.realId
    ) {
      row[2] = integer(node.x)
      row[3] = integer(node.y)
      row[154] = String(node.uid ?? node.id)
      row[226] = String(node.realId ?? node.id)
    }
    if (oldPorts.get(port.id)?.x !== port.x || oldPorts.get(port.id)?.y !== port.y) {
      row[13] = integer(port.x - node.x)
      row[14] = integer(port.y - node.y)
    }
    if (port.bays !== undefined && !same(port.bays, oldPorts.get(port.id)?.bays)) {
      let offset = 246
      for (let list = 0; list < 8; list++) {
        const count = Number(row[offset])
        if (!Number.isSafeInteger(count) || count < 0 || offset + count >= row.length)
          throw new Error('포트 예약 개수를 확인하세요.')
        offset += 1 + count
      }
      const count = Number(row[offset])
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('포트 Bay 개수를 확인하세요.')
      row.splice(offset, 1 + count, String(port.bays.length), ...port.bays.map(String))
    }
    if (!same(before?.portGroups, map.portGroups))
      row[244] = String(
        (map.portGroups ?? []).findIndex((group) => group.portIds.includes(port.id)),
      )
    return row
  })
  const shapeStart = 2 + nodeCount + pathCount + portCount
  const oldShapes = new Map(before?.shapes?.map((shape) => [shape.id, shape]) ?? [])
  const rawShapes = new Map(
    lines.slice(shapeStart, shapeStart + Math.max(0, Number(header[4]) - 1)).map((line) => {
      const row = line.split('\t')
      return [Number(row[0]), row] as const
    }),
  )
  const shapeColumns = {
    description: 1,
    text: 2,
    x1: 3,
    y1: 4,
    x2: 5,
    y2: 6,
    centerX: 7,
    centerY: 8,
    radius: 9,
    width: 10,
    height: 11,
    type: 12,
    strokeColor: 13,
    strokeStyle: 14,
    strokeWidth: 15,
    fillColor: 16,
    fontColor: 17,
    fontAlign: 18,
    fontDirection: 19,
    fillStyle: 20,
  }
  const shapes = (map.shapes ?? []).map((shape) => {
    const row = rawShapes.get(shape.id) ?? [...Array<string>(30).fill('0'), '']
    row[0] = String(shape.id)
    patch(row, oldShapes.get(shape.id), shape, shapeColumns)
    return row
  })
  header[0] = String(rows.length)
  header[1] = String(
    Math.max(
      -111,
      ...map.nodes
        .filter((node) => !node.curve && !node.virtual)
        .map((node) => node.realId ?? node.id),
    ),
  )
  header[2] = String(ports.length)
  header[3] = String(paths.length)
  header[4] = String(shapes.length + 1)
  header[6] = String(Math.max(Number(header[6]), ...map.nodes.map((node) => node.uid ?? node.id)))
  const ending = source && !source.content.includes('\r\n') ? '\n' : '\r\n'
  header[7] = String(Math.max(Number(header[7]), ...ports.map((row) => Number(row[208]))))
  let groups = source?.groups ?? ''
  if (
    !same(before?.portGroups, map.portGroups) ||
    map.nodes.some((node) => node.uid !== oldNodes.get(node.id)?.uid)
  ) {
    const rawGroups = new Map(
      groups
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => {
          const row = line.split('\t')
          return [row[0], row] as const
        }),
    )
    const oldGroups = new Map(before?.portGroups?.map((group) => [group.id, group]) ?? [])
    const portUids = new Map(ports.map((row) => [row[4], row[208]]))
    groups = (map.portGroups ?? [])
      .map((group) => {
        const row = rawGroups.get(group.id) ?? [...Array<string>(19).fill('0')]
        row[0] = fieldText(group.id)
        if (group.nodeId !== undefined)
          row[8] = String(nodes.get(group.nodeId)?.uid ?? group.nodeId)
        if (!rawGroups.has(group.id)) {
          const node = nodes.get(
            group.nodeId ?? map.ports.find((port) => group.portIds.includes(port.id))?.nodeId ?? -1,
          )
          if (!node) throw new Error('포트 그룹의 기준 노드가 필요합니다.')
          row[7] = String(node.id)
          row[8] = String(node.uid ?? node.id)
          row[9] = String(node.x)
          row[10] = String(node.y)
        }
        patch(row, oldGroups.get(group.id), group, {
          nodeId: 7,
          nodeX: 9,
          nodeY: 10,
          offsetX: 5,
          offsetY: 6,
          x: 1,
          y: 2,
          width: 3,
          height: 4,
          strokeColor: 11,
          fillColor: 12,
          fontColor: 13,
          fontSize: 14,
          nameDistance: 15,
          namePosition: 16,
          nameDirection: 17,
          nameAlign: 18,
        })
        const anchor = nodes.get(Number(row[7]))
        if (!anchor) throw new Error('포트 그룹의 기준 노드를 확인하세요.')
        row[5] = integer(group.x - anchor.x)
        row[6] = integer(group.y - anchor.y)
        row[8] = integer(anchor.uid ?? anchor.id)
        row[9] = integer(anchor.x)
        row[10] = integer(anchor.y)
        return [
          ...row.slice(0, 19),
          String(group.portIds.length),
          ...group.portIds.map((id) => portUids.get(id)!),
          '-1',
          '',
        ].join('\t')
      })
      .join(ending)
    if (groups) groups += ending
  }
  const content = `${source?.content.startsWith('\uFEFF') ? '\uFEFF' : ''}${[
    lines[0] ?? `Ver.${version}`,
    header.join('\t'),
    ...rows.map((row) => row.join('\t')),
    ...paths.map((row) => row.join('\t')),
    ...ports.map((row) => row.join('\t')),
    ...shapes.map((row) => row.join('\t')),
  ].join(ending)}${ending}`
  // 표시 객체에서 누락된 원본 식별자를 포함하여 저장 결과의 참조를 재검증하는 읽기 검증
  previewLegacy(content, map.name, groups)
  return { content, groups }
}
