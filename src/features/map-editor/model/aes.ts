/**
 * 파일명: aes.ts
 * 설명: 원본 차량 외곽 표본과 경로 순서로 현재 및 다음 위치의 AES 충돌 데이터를 구성하는 생성
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { serializeLegacy, type LegacySource, type MapDocument } from '@/entities/map/index.ts'

export interface AesVehicle {
  width: number
  height: number
  leftWidth: number
  topHeight: number
  sampleLength: number
  detectionDistance: number
  searchRatio: number
}

export const DEFAULT_AES_VEHICLE: AesVehicle = {
  width: 1370,
  height: 900,
  leftWidth: 685,
  topHeight: 450,
  sampleLength: 200,
  detectionDistance: 100,
  searchRatio: 2.5,
}

type Point = { x: number; y: number }
type Connection = {
  head: number
  target: number
  degree: number
  index: number
  pre: Point
  next: Point
}

/** 차량 형상과 표본 수 및 탐색 반경의 유효 범위를 확인하는 생성 사전 검사 */
export const validateAesVehicle = (vehicle: AesVehicle) => {
  for (const [key, value] of Object.entries(vehicle))
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1e7 ||
      (key !== 'searchRatio' && !Number.isSafeInteger(value))
    )
      throw new Error('차량 치수는 영 이상의 정수 mm이며 탐색 비율은 유한한 양수여야 합니다.')
  if (
    vehicle.width < 1 ||
    vehicle.height < 1 ||
    vehicle.sampleLength < 1 ||
    vehicle.searchRatio <= 0
  )
    throw new Error('차량 폭과 높이 및 표본 간격과 탐색 비율은 양수여야 합니다.')
  if (vehicle.leftWidth > vehicle.width || vehicle.topHeight > vehicle.height)
    throw new Error('차량 중심 Offset은 외곽 치수 안에 있어야 합니다.')
  if (vehicle.sampleLength > Math.min(vehicle.width, vehicle.height))
    throw new Error('외곽 표본 간격은 차량 폭과 높이 이하여야 합니다.')
  if (
    2 *
      (Math.trunc(vehicle.width / vehicle.sampleLength) +
        Math.trunc(vehicle.height / vehicle.sampleLength)) >
    20000
  )
    throw new Error('외곽 표본은 차량당 이만 개 이하로 설정하세요.')
  return { ...vehicle }
}

/** 원본 AGV TYPE의 첫 번째 차량 설정을 AES 생성 치수로 읽는 설정 해석 */
export const readAesVehicle = (content: string): AesVehicle => {
  const values: Record<string, number> = {}
  let active = false
  for (const line of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const section = /^\s*\[([^\]]+)\]/.exec(line)
    if (section) active = section[1].toUpperCase() === 'AGV_TYPE_01'
    else if (active) {
      const field = /^\s*([^;#=]+?)\s*=\s*([^;#]*)/.exec(line)
      if (field) values[field[1].toLowerCase()] = Number(field[2].trim())
    }
  }
  const width = values.width ?? 1370,
    height = values.height ?? 900
  return validateAesVehicle({
    width,
    height,
    leftWidth: values.left_width ?? Math.trunc(width / 2),
    topHeight: values.top_height ?? Math.trunc(height / 2),
    sampleLength: values.min_len ?? 200,
    detectionDistance: values.detect_dist_mm ?? 100,
    searchRatio: values.ratio ?? 2.5,
  })
}

/** 정수 각도로 회전한 차량의 원본 모서리 순서를 구성하는 외곽 좌표 계산 */
const corners = (vehicle: AesVehicle, degree: number, expansion: number): Point[] => {
  const left = vehicle.leftWidth + expansion,
    right = vehicle.width - vehicle.leftWidth + expansion,
    top = vehicle.topHeight + expansion,
    bottom = vehicle.height - vehicle.topHeight + expansion,
    radian = (degree * Math.PI) / 180,
    cos = Math.cos(radian),
    sin = Math.sin(radian)
  return [
    { x: -left * cos - bottom * sin, y: -left * sin + bottom * cos },
    { x: right * cos - bottom * sin, y: right * sin + bottom * cos },
    { x: right * cos + top * sin, y: right * sin - top * cos },
    { x: -left * cos + top * sin, y: -left * sin - top * cos },
  ]
}

/** 원본 정수 나눗셈에 따른 변별 표본을 차례대로 구성하는 차량 외곽 분할 */
const sampleContour = (vehicle: AesVehicle, degree: number) => {
  const vertices = corners(vehicle, degree, 0),
    samples: Point[] = []
  for (let side = 0; side < 4; side++) {
    const start = vertices[side],
      end = vertices[(side + 1) % 4],
      count = Math.trunc((side % 2 === 0 ? vehicle.width : vehicle.height) / vehicle.sampleLength)
    for (let index = 0; index < count; index++)
      samples.push({
        x: start.x + ((end.x - start.x) / count) * index,
        y: start.y + ((end.y - start.y) / count) * index,
      })
  }
  return samples
}

/** 원본 수평 반직선 교점 규칙으로 표본의 장애물 내부 포함을 확인하는 충돌 판정 */
const collides = (samples: Point[], obstacle: Point[], delta: Point) => {
  for (const sample of samples) {
    const x = sample.x + delta.x,
      y = sample.y + delta.y
    let crosses = 0
    for (let index = 0; index < 4; index++) {
      const start = obstacle[index],
        end = obstacle[(index + 1) % 4]
      if (
        start.y > y !== end.y > y &&
        x < ((end.x - start.x) * (y - start.y)) / (end.y - start.y) + start.x
      )
        crosses++
    }
    if (crosses % 2) return true
  }
  return false
}

/** 저장 대상과 동일한 계획 경로의 인덱스 및 수동각과 후진각을 해석하는 AES 입력 구성 */
const planningConnections = (map: MapDocument, source?: LegacySource | null) => {
  const content = serializeLegacy(map, source).content,
    lines = content.replace(/^\uFEFF/, '').split(/\r?\n/),
    header = lines[1].split('\t'),
    nodes = new Map(map.nodes.map((node) => [node.id, node])),
    connections: Connection[] = []
  const sorted = [...nodes.keys()].sort((a, b) => a - b)
  if (sorted.some((id, index) => id !== index + 1))
    throw new Error('AES 생성 전에 연속 노드 ID를 적용하세요.')
  const rows = lines
    .slice(2 + Number(header[0]), 2 + Number(header[0]) + Number(header[3]))
    .map((line) => line.split('\t'))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
  for (const row of rows) {
    const head = Number(row[0]),
      pre = nodes.get(head)
    if (!pre) throw new Error('계획 경로의 기준 노드가 없습니다.')
    let offset = 25
    for (let index = 0; index < Number(row[9]); index++) {
      const target = Number(row[offset]),
        next = nodes.get(target)
      if (!next) throw new Error('계획 경로의 연결 노드가 없습니다.')
      let angle = Math.fround(Number(row[offset + 15]) / 1000)
      if (Number(row[offset + 16]) === 1) angle = (((angle - 180) % 360) + 360) % 360
      angle += 0.5
      if (angle > 360) angle = 0
      if (!Number.isFinite(angle) || angle < 0 || angle >= 360)
        throw new Error(`경로 ${head}-${target}의 차량 각도는 원본 AES 허용 범위를 벗어납니다.`)
      connections.push({
        head,
        target,
        degree: Math.trunc(angle),
        index: connections.length + 1,
        pre,
        next,
      })
      offset += 55 + Number(row[offset + 54])
    }
  }
  return connections
}

/** 경로별 현재와 다음 위치의 충돌 인덱스 및 노드 목록을 원본 AESX 형식으로 구성하는 데이터 생성 */
export const makeAesData = (map: MapDocument, input: AesVehicle, source?: LegacySource | null) => {
  const vehicle = validateAesVehicle(input),
    connections = planningConnections(map, source),
    radius = vehicle.width * vehicle.searchRatio,
    cellSize = Math.max(1, radius + 1),
    cells = new Map<string, Connection[]>(),
    contours = new Map<number, { vehicle: Point[]; obstacle: Point[] }>()
  for (const connection of connections) {
    const key = `${Math.floor(connection.pre.x / cellSize)},${Math.floor(connection.pre.y / cellSize)}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key)!.push(connection)
    if (!contours.has(connection.degree))
      contours.set(connection.degree, {
        vehicle: sampleContour(vehicle, connection.degree),
        obstacle: corners(vehicle, connection.degree, vehicle.detectionDistance),
      })
  }
  const pathRows: string[] = [],
    nodeRows: string[] = []
  const review: {
    index: number
    head: number
    target: number
    paths: number[][]
    nodes: number[][]
  }[] = []
  let collisionCount = 0
  for (const connection of connections) {
    const x = Math.floor(connection.pre.x / cellSize),
      y = Math.floor(connection.pre.y / cellSize),
      candidates: Connection[] = []
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const other of cells.get(`${x + dx},${y + dy}`) ?? [])
          if (
            Math.trunc(
              Math.hypot(connection.pre.x - other.pre.x, connection.pre.y - other.pre.y),
            ) <= radius
          )
            candidates.push(other)
    candidates.sort((a, b) => a.index - b.index)
    const paths: number[][] = [[], [], [], []],
      nodes: number[][] = [[], [], [], []]
    for (const [index, position] of ['pre', 'next'].entries()) {
      for (const other of candidates)
        if (
          collides(contours.get(connection.degree)!.vehicle, contours.get(other.degree)!.obstacle, {
            x: connection[position as 'pre' | 'next'].x - other[position as 'pre' | 'next'].x,
            y: connection[position as 'pre' | 'next'].y - other[position as 'pre' | 'next'].y,
          })
        ) {
          paths[index].push(other.index)
          nodes[index].push(other.head)
        }
      nodes[index] = [...new Set(nodes[index])]
    }
    paths[2] = [...new Set([...paths[0], ...paths[1]])]
    nodes[2] = [...new Set([...nodes[0], ...nodes[1]])]
    collisionCount += paths[2].length
    review.push({
      index: connection.index,
      head: connection.head,
      target: connection.target,
      paths,
      nodes,
    })
    pathRows.push(
      [
        connection.head,
        connection.target,
        Math.trunc((connection.pre.x + connection.next.x) / 2),
        Math.trunc((connection.pre.y + connection.next.y) / 2),
        ...paths.flatMap((list) => [list.length, ...list]),
      ].join('\t') + '\t',
    )
    nodeRows.push(
      [connection.head, connection.target, ...nodes.flatMap((list) => [list.length, ...list])].join(
        '\t',
      ) + '\t',
    )
  }
  const count = `${connections.length + 1}\t`
  return {
    content: [count, ...pathRows, count, ...nodeRows].join('\r\n') + '\r\n',
    paths: connections.length,
    collisions: collisionCount,
    review,
  }
}
