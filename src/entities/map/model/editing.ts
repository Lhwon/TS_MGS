/**
 * 파일명: editing.ts
 * 설명: 지도 객체 생성과 연결 참조 변경 및 일괄 편집 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { repairPortGroups } from '@/entities/map/model/repairReferences.ts'
import {
  parseDocument,
  type MapDocument,
  type MapEdge,
  type MapNode,
  type MapPort,
  type MapShape,
} from '@/entities/map/model/map.ts'
// 외부 편집 요청에서 변경할 수 있는 객체 속성 범위
const editableFields: Record<string, string[]> = {
  node: [
    'x',
    'y',
    'name',
    'direction',
    'virtual',
    'curve',
    'curveStart',
    'property',
    'noSendGoal',
    'noSendGoalLoaded',
    'dontRemoveCmd',
    'removable',
    'changeable',
    'bayChange',
    'spinturnable',
    'addressType',
    'safetyDistance',
    'safetyViewDistance',
  ],
  edge: [
    'from',
    'to',
    'direction',
    'drivingType',
    'distance',
    'speed',
    'radius',
    'curveAngle',
    'goalDegree',
    'realConnection',
    'controls',
    'bays',
  ],
  port: [
    'x',
    'y',
    'nodeId',
    'name',
    'width',
    'height',
    'fillColor',
    'strokeColor',
    'fontColor',
    'floor',
    'fontSize',
    'nameDistance',
    'namePosition',
    'nameDirection',
    'settings',
    'reservations',
    'bays',
  ],
  shape: [
    'x1',
    'y1',
    'x2',
    'y2',
    'width',
    'height',
    'type',
    'text',
    'strokeColor',
    'fillColor',
    'fontColor',
  ],
}

/**
 * 지도와 원본 헤더를 기준으로 새 직선 노드의 표시 번호와 UID 및 실제 번호 구성
 * @param map 번호가 이미 사용된 기준 지도
 * @param attributes 입력에서 지정한 좌표와 표시 속성
 * @param id 요청에서 지정한 표시 번호 또는 자동 할당에 사용할 생략값
 * @param sourceMaxUid 기존 원본 헤더의 UID 상한
 * @returns 지도에 삽입할 노드 데이터
 */
export const createMapNode = (
  map: MapDocument,
  attributes: Pick<MapNode, 'x' | 'y'> & Partial<Omit<MapNode, 'id'>>,
  id = Math.max(0, ...map.nodes.map((node) => node.id)) + 1,
  sourceMaxUid = 0,
): MapNode => ({
  id,
  name: `N${id}`,
  uid: Math.max(sourceMaxUid, 0, ...map.nodes.map((node) => node.uid ?? node.id)) + 1,
  realId:
    Math.max(
      0,
      ...map.nodes.filter((node) => !node.virtual && !node.curve).map((node) => node.realId ?? node.id),
    ) + 1,
  direction: 1,
  ...attributes,
})

/**
 * 노드 좌표 변경에 따른 연결 포트와 그룹의 상대 배치 및 기준 좌표 유지
 * @param map 같은 편집 단위에서 변경할 지도
 * @param node 변경 대상 노드
 * @param patch 변경할 노드 속성
 */
export const patchMapNode = (map: MapDocument, node: MapNode, patch: Partial<Omit<MapNode, 'id'>>) => {
  const { x: previousX, y: previousY } = node
  Object.assign(node, patch)
  const dx = node.x - previousX
  const dy = node.y - previousY
  for (const port of map.ports)
    if (port.nodeId === node.id) {
      port.x += dx
      port.y += dy
    }
  for (const group of map.portGroups ?? [])
    if (group.nodeId === node.id) {
      group.x += dx
      group.y += dy
      group.nodeX = node.x
      group.nodeY = node.y
    }
}

/**
 * 노드의 삭제 가능 설정 검사와 해당 노드를 참조하는 경로 및 포트 정리
 * 일괄 편집에서는 전체 작업 후 포트 그룹의 최종 소속을 검증하기 위한 참조 정리 위임
 * @param map 변경할 지도
 * @param node 삭제할 노드
 * @param reconnect 삭제 전 이웃을 연결하는 수동 편집 옵션 처리
 */
export const removeMapNode = (map: MapDocument, node: MapNode, reconnect?: () => void) => {
  if (node.removable === false)
    throw new Error(`N${node.id}의 Removable 설정이 해제되어 있습니다.`)
  reconnect?.()
  map.nodes = map.nodes.filter((item) => item.id !== node.id)
  map.edges = map.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id)
  map.ports = map.ports.filter((port) => port.nodeId !== node.id)
}

/**
 * 요청 속성을 유지하고 생략된 이름과 크기에 기본값을 적용하는 포트 데이터 생성
 * @param id 신규 포트 식별자
 * @param attributes 배치 좌표와 연결 노드 및 입력에서 지정한 속성
 * @returns 지도에 삽입할 포트 데이터
 */
export const createMapPort = (
  id: string,
  attributes: Pick<MapPort, 'nodeId' | 'x' | 'y'> & Partial<Omit<MapPort, 'id'>>,
): MapPort => ({ id, name: '', width: 100, height: 100, ...attributes })

/**
 * 연결 노드와 지정 식별자로 경로 레코드 구성
 * @param id 명시적 경로 식별자
 * @param attributes 시작과 끝 노드 및 주행 옵션
 * @returns 최종 문서 검증에 전달할 경로 레코드
 */
export const createMapEdge = (
  id: string,
  attributes: Pick<MapEdge, 'from' | 'to'> & Partial<Omit<MapEdge, 'id'>>,
): MapEdge => ({ id, direction: 1, drivingType: 1, ...attributes })

/**
 * 공통 도형 기본값 위에 도구가 계산하거나 사용자가 입력한 속성 적용
 * @param map 자동 번호를 조회할 기준 지도
 * @param attributes 도형의 위치와 크기 및 스타일
 * @param id 명시적 식별자 또는 자동 번호를 나타내는 생략값
 * @returns 검증할 도형 데이터
 */
export const createMapShape = (
  map: MapDocument,
  attributes: Partial<Omit<MapShape, 'id'>>,
  id = Math.max(0, ...(map.shapes ?? []).map((shape) => shape.id)) + 1,
): MapShape => ({
  id,
  description: '',
  text: '',
  x1: 0,
  y1: 0,
  x2: 0,
  y2: 0,
  centerX: 0,
  centerY: 0,
  radius: 0,
  width: 0,
  height: 0,
  type: 2,
  strokeColor: 0,
  fillColor: 0,
  fontColor: 0,
  strokeWidth: 10,
  strokeStyle: 0,
  fontAlign: 0,
  fontDirection: 0,
  fillStyle: 0,
  ...attributes,
})

/**
 * 사본에서 요청한 객체를 순서대로 변경하고 포트 그룹과 경로 거리를 갱신한 뒤 문서 검증
 *
 * @param sourceDocument 현재 기준 지도
 * @param commands 검증 전 편집 명령 배열
 * @param maximum 한 번에 처리할 수 있는 최대 명령 수
 * @param sourceMaxUid 기존 원본 헤더의 UID 상한
 * @returns 검증한 지도와 실제 편집 결과
 * @throws 지원하지 않는 명령이나 속성 또는 유효하지 않은 편집 결과
 */
export const editMapObjects = (
  sourceDocument: MapDocument,
  commands: unknown,
  maximum = 200,
  sourceMaxUid = 0,
) => {
  if (!Array.isArray(commands) || !commands.length || commands.length > maximum)
    throw new Error(`지도 편집 명령은 한 번에 ${maximum}개까지 지원합니다.`)
  const map = structuredClone(sourceDocument)
  const results: { entity: string; id: string; operation: string }[] = []
  for (const command of commands) {
    if (
      !command ||
      !['node', 'edge', 'port', 'shape'].includes(command.entity) ||
      !['create', 'update', 'delete'].includes(command.operation)
    )
      throw new Error('지원하지 않는 지도 편집 명령입니다.')
    const attributes = command.value ?? {}
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes))
      throw new Error('객체 속성이 올바르지 않습니다.')
    if (Object.keys(attributes).some((key) => !editableFields[command.entity].includes(key)))
      throw new Error('지원하지 않는 객체 속성이 있습니다.')
    const key = ({ node: 'nodes', edge: 'edges', port: 'ports', shape: 'shapes' } as const)[
      command.entity as 'node' | 'edge' | 'port' | 'shape'
    ]
    if (key === 'shapes') map.shapes ??= []
    const objects = map[key]! as unknown as Record<string, unknown>[]
    let id = String(command.id ?? '')
    const existingObject = objects.find((item) => String(item.id) === id)
    if (command.operation !== 'create' && !existingObject)
      throw new Error(`${command.entity} ${id} 객체를 찾지 못했습니다.`)
    if (command.operation === 'delete') {
      if (key === 'nodes') removeMapNode(map, existingObject as unknown as MapNode)
      else objects.splice(objects.indexOf(existingObject!), 1)
    } else if (command.operation === 'update') {
      if (key === 'nodes') patchMapNode(map, existingObject as unknown as MapNode, attributes)
      else Object.assign(existingObject!, attributes)
    } else {
      let created: { id: number | string }
      if (key === 'nodes')
        created = createMapNode(map, attributes, id ? Number(id) : undefined, sourceMaxUid)
      else if (key === 'edges')
        created = createMapEdge(id || `E-${crypto.randomUUID()}`, attributes)
      else if (key === 'ports')
        created = createMapPort(id || `P-${crypto.randomUUID().slice(0, 8)}`, attributes)
      else
        created = createMapShape(map, attributes, id ? Number(id) : undefined)
      id = String(created.id)
      if (objects.some((item) => String(item.id) === id))
        throw new Error(`중복 객체 ${id} 생성 요청입니다.`)
      objects.push(created as Record<string, unknown>)
    }
    results.push({ entity: command.entity, id, operation: command.operation })
  }
  repairPortGroups(map)
  const nodes = new Map(map.nodes.map((node) => [node.id, node]))
  for (const edge of map.edges) {
    const a = nodes.get(edge.from),
      b = nodes.get(edge.to)
    if (a && b) edge.distance = Math.round(Math.hypot(a.x - b.x, a.y - b.y))
  }
  return { map: parseDocument(JSON.stringify(map)), results }
}
