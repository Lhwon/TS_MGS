/**
 * 파일명: curve.ts
 * 설명: 원본 MGS의 사분면 중심 계산과 분할각에 따른 커브 노드 생성
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
import type { MapDocument } from '@/entities/map/model/map.ts'
import { MAX_NODES } from '@/entities/map/model/map.ts'
export interface CurveOptions {
  force: boolean
  autoSelect: boolean
  reverse: boolean
  dynamicRadius: boolean
  radius: number
  angle: number
  divide: number
  direction: number
}
/** 도 단위 각도를 원본의 양수 범위로 정규화하는 각도 변환 */
const normalize = (degree: number) => {
  const normalized = degree % 360
  return normalized < 0 ? normalized + 360 : normalized
}
/**
 * 수직선의 분모 보정과 양수 정규화를 유지하는 원본 각도 계산
 * @param from 각도를 계산할 기준점
 * @param to 각도 원점
 * @returns 원본 좌표 방향의 도 단위 각도
 */
const legacyDegree = (from: { x: number; y: number }, to: { x: number; y: number }) =>
  normalize((Math.atan2(from.y - to.y, from.x - to.x || 1e-11) * 180) / Math.PI)
/**
 * 시작 노드의 진입 방향과 포인터 사분면에서 원본 커브 중심과 분할 좌표 계산
 * @param map 기준 지도 문서
 * @param connection 커브를 시작할 실제 노드 식별자
 * @param target 사용자가 지정한 커브 방향과 동적 반경 기준점
 * @param options 반경과 회전각 및 분할각과 반전 설정
 * @returns 곡선이 선택된 경우의 분할 좌표와 원본 저장 속성
 */
export const calculateCurve = (
  map: MapDocument,
  connection: number | null,
  target: { x: number; y: number },
  options: CurveOptions,
) => {
  if (!options.force && !options.autoSelect) return null
  if (connection === null) {
    if (options.force) throw new Error('커브를 시작할 노드를 먼저 선택하세요.')
    return null
  }
  const start = map.nodes.find((node) => node.id === connection)
  if (!start || start.curve) throw new Error('커브 시작점에는 실제 노드를 선택하세요.')
  if (![target.x, target.y].every((value) => Number.isFinite(value) && Math.abs(value) <= 1e9))
    throw new Error('커브 방향 기준 좌표를 확인하세요.')
  const pointerDegree = legacyDegree(target, start)
  const straight =
    pointerDegree >= 335 ||
    pointerDegree < 25 ||
    [90, 180, 270].some((degree) => pointerDegree >= degree - 25 && pointerDegree < degree + 25)
  if (!options.force && straight) return null
  const radius = options.dynamicRadius
    ? Math.trunc(Math.hypot(target.x - start.x, target.y - start.y))
    : options.radius
  if (
    ![radius, options.angle, options.divide].every(Number.isSafeInteger) ||
    radius < 1 ||
    radius > 100000000 ||
    options.angle < 1 ||
    options.angle >= 360 ||
    options.divide < 1 ||
    options.divide > options.angle ||
    ![0, 1].includes(options.direction)
  )
    throw new Error(
      '반경은 양의 정수 mm, 각도는 1~359도, 분할각은 각도 이하의 양의 정수로 입력하세요.',
    )
  const previous = map.edges.find((edge) => edge.from === start.id)
  const connected = map.nodes.find((node) => node.id === previous?.to)
  const heading =
    previous && [2, 3].includes(previous.drivingType ?? 1) && previous.goalDegree !== undefined
      ? previous.goalDegree
      : connected
        ? legacyDegree(start, connected)
        : 0
  const relative = normalize(pointerDegree - heading)
  const goalDegree = normalize(
    heading + (Math.floor(relative / 90) + 1) * 90 - (options.reverse ? 90 : 0),
  )
  const centerX = start.x + radius * Math.cos((goalDegree * Math.PI) / 180)
  const centerY = start.y + radius * Math.sin((goalDegree * Math.PI) / 180)
  const centerDegree = legacyDegree(start, { x: centerX, y: centerY })
  const points = [{ x: start.x, y: start.y }]
  for (let degree = options.divide; degree < options.angle; degree += options.divide) {
    const radian = ((centerDegree + (options.reverse ? -degree : degree)) * Math.PI) / 180
    points.push({
      x: Math.trunc(centerX + radius * Math.cos(radian)),
      y: Math.trunc(centerY + radius * Math.sin(radian)),
    })
  }
  const finalRadian =
    ((centerDegree + (options.reverse ? -options.angle : options.angle)) * Math.PI) / 180
  points.push({
    x: Math.trunc(centerX + radius * Math.cos(finalRadian)),
    y: Math.trunc(centerY + radius * Math.sin(finalRadian)),
  })
  if (
    points.some(
      (point, index) =>
        Math.abs(point.x) > 1e9 ||
        Math.abs(point.y) > 1e9 ||
        (index > 0 && point.x === points[index - 1].x && point.y === points[index - 1].y),
    )
  )
    throw new Error('커브 분할 좌표가 중복되거나 범위를 초과합니다. 반경과 분할각을 확인하세요.')
  return {
    points,
    radius,
    angle: options.angle,
    goalDegree: Math.trunc(goalDegree),
    drivingType: options.reverse ? 3 : 2,
  }
}
/**
 * 실제 노드와 커브 가상 노드를 분리하고 역방향 연결 레코드를 만드는 단일 커브 추가
 * @param map 편집 중인 복제 문서
 * @param connection 커브 시작 노드 식별자
 * @param curve 원본 기하 규칙으로 계산한 커브
 * @param direction 단방향과 양방향 설정
 * @param sourceMaxUid 원본 헤더에 기록된 최대 노드 UID
 * @param endpointId 기존 노드에 연결할 때 유지할 끝점 식별자
 * @returns 새 커브 끝점의 실제 노드 식별자
 */
export const appendCurve = (
  map: MapDocument,
  connection: number,
  curve: NonNullable<ReturnType<typeof calculateCurve>>,
  direction: number,
  sourceMaxUid: number,
  endpointId?: number,
) => {
  const existingEnd = map.nodes.find((node) => node.id === endpointId)
  const computedEnd = curve.points.at(-1)!
  if (
    endpointId !== undefined &&
    (!existingEnd ||
      existingEnd.curve ||
      Math.hypot(existingEnd.x - computedEnd.x, existingEnd.y - computedEnd.y) >= 50)
  )
    throw new Error('커브 끝점과 연결 노드가 일치하지 않습니다. 반경과 각도 및 반전을 조정하세요.')
  if (map.nodes.length + curve.points.length - (existingEnd ? 2 : 1) > MAX_NODES)
    throw new Error('커브 분할 후 최대 노드 수 15,000개를 초과합니다.')
  let id = Math.max(0, ...map.nodes.map((node) => node.id))
  let uid = Math.max(sourceMaxUid, 0, ...map.nodes.map((node) => node.uid ?? node.id))
  let virtualRealId = Math.max(
    100000,
    ...map.nodes.filter((node) => node.virtual || node.curve).map((node) => node.realId ?? 0),
  )
  const realId =
    Math.max(
      0,
      ...map.nodes
        .filter((node) => !node.virtual && !node.curve)
        .map((node) => node.realId ?? node.id),
    ) + 1
  const start = map.nodes.find((node) => node.id === connection)!
  const previous = map.edges.find((edge) => edge.from === connection)
  const realConnection =
    previous?.drivingType === curve.drivingType
      ? (previous.realConnection ?? connection)
      : connection
  start.curveStart = true
  let lastId = connection
  for (const [index, point] of curve.points.slice(1).entries()) {
    const intermediate = index < curve.points.length - 2
    const node =
      !intermediate && existingEnd
        ? existingEnd
        : {
            id: ++id,
            uid: ++uid,
            realId: intermediate ? ++virtualRealId : realId,
            name: `N${id}`,
            ...point,
            direction,
            virtual: intermediate,
            curve: intermediate,
          }
    const previousPoint = curve.points[index]
    if (node !== existingEnd) map.nodes.push(node)
    map.edges.push({
      id: `E${node.id}-${lastId}`,
      from: node.id,
      to: lastId,
      direction,
      drivingType: curve.drivingType,
      distance: Math.trunc(Math.hypot(node.x - previousPoint.x, node.y - previousPoint.y)),
      speed: 0,
      radius: curve.radius,
      curveAngle: curve.angle,
      goalDegree: curve.goalDegree,
      realConnection,
    })
    lastId = node.id
  }
  return lastId
}
