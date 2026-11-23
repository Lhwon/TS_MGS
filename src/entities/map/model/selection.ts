/**
 * 파일명: selection.ts
 * 설명: 선택 노드와 연결 정보를 요약하고 위치 계산 및 복제와 삭제를 원자적으로 적용하는 편집
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { expandCurveSelection } from '@/entities/map/model/curveSelection.ts'
import type { MapDocument } from '@/entities/map/model/map.ts'
import { editMapObjects } from '@/entities/map/model/editing.ts'
/** 실제 선택 노드의 좌표와 연결 경계 및 중심을 계산하는 선택 조회 */
export const inspectSelectedNodes = (map: MapDocument, nodeIds: number[]) => {
  const ids = new Set(nodeIds),
    nodes = map.nodes.filter((node) => ids.has(node.id))
  const connected = map.edges.filter((edge) => ids.has(edge.from) || ids.has(edge.to))
  const bounds = nodes.length
    ? {
        minX: Math.min(...nodes.map((node) => node.x)),
        maxX: Math.max(...nodes.map((node) => node.x)),
        minY: Math.min(...nodes.map((node) => node.y)),
        maxY: Math.max(...nodes.map((node) => node.y)),
      }
    : null
  return {
    count: nodes.length,
    units: map.units,
    bounds,
    center: bounds
      ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
      : null,
    nodes: nodes.slice(0, 100).map(({ id, name, x, y, virtual }) => ({ id, name, x, y, virtual })),
    edges: connected.slice(0, 25).map(({ id, from, to, direction, drivingType, distance }) => ({
      id,
      from,
      to,
      direction,
      drivingType,
      distance,
    })),
    edgeCount: connected.length,
    boundaryEdges: connected
      .filter((edge) => !ids.has(edge.from) || !ids.has(edge.to))
      .slice(0, 25)
      .map(({ id, from, to, direction }) => ({ id, from, to, direction })),
    ports: map.ports
      .filter((port) => port.nodeId !== undefined && ids.has(port.nodeId))
      .slice(0, 25)
      .map(({ id, name, nodeId, x, y, width, height }) => ({
        id,
        name,
        nodeId,
        x,
        y,
        width,
        height,
      })),
    truncated: nodes.length > 100 || connected.length > 25,
  }
}
/** 사용자 단위를 현재 맵의 좌표 단위로 환산하는 거리 변환 */
export const selectionDelta = (
  map: MapDocument,
  center: { x: number; y: number },
  args: Record<string, unknown>,
) => {
  const unit = String(args.unit ?? 'map')
  if (!['map', 'mm', 'm'].includes(unit)) throw new Error('거리 단위를 확인하세요.')
  if (map.units !== 'mm' && unit !== 'map')
    throw new Error('현재 지도는 픽셀 초안입니다. 실제 거리 이동에는 도면 비율이 필요합니다.')
  const scale = unit === 'm' ? 1000 : 1
  for (const key of ['x', 'y', 'dx', 'dy'])
    if (
      args[key] !== undefined &&
      (!Number.isFinite(args[key]) || Math.abs(Number(args[key])) > 1e9)
    )
      throw new Error('위치 수치를 확인하세요.')
  if (args.x !== undefined || args.y !== undefined) {
    if (args.dx !== undefined || args.dy !== undefined)
      throw new Error('목표 위치와 상대 이동량 중 하나만 지정하세요.')
    return {
      dx: args.x === undefined ? 0 : Number(args.x) * scale - center.x,
      dy: args.y === undefined ? 0 : Number(args.y) * scale - center.y,
    }
  }
  if (args.dx === undefined && args.dy === undefined)
    throw new Error(
      '이동 거리나 목표 위치가 필요합니다. 임의 수치를 만들지 말고 사용자에게 질문하세요.',
    )
  return { dx: Number(args.dx ?? 0) * scale, dy: Number(args.dy ?? 0) * scale }
}
/**
 * 선택 그래프의 상대 배치를 유지하며 이동과 복제 및 삭제를 원자적으로 검증
 * @param map 작업 전 기준 지도
 * @param nodeIds 선택 대상 노드 식별자
 * @param args 작업 종류와 입력 좌표 또는 이동량
 * @param sourceMaxUid 기존 원본 헤더의 UID 상한
 * @returns 검증한 지도와 수행된 작업 및 변경 전 선택 정보
 */
export const editSelectedNodes = (
  map: MapDocument,
  nodeIds: number[],
  args: Record<string, unknown>,
  sourceMaxUid = 0,
) => {
  const anchor = inspectSelectedNodes(map, nodeIds).center
  if (args.operation === 'move') nodeIds = expandCurveSelection(map, nodeIds)
  const selection = inspectSelectedNodes(map, nodeIds)
  if (!selection.count || selection.count !== new Set(nodeIds).size)
    throw new Error('선택 노드를 다시 확인하세요.')
  const ids = new Set(nodeIds),
    operation = String(args.operation)
  const operations: {
    entity: string
    operation: string
    id?: string
    value?: Record<string, unknown>
  }[] = []
  let delta: { dx: number; dy: number } | undefined
  if (operation === 'delete')
    for (const id of ids) operations.push({ entity: 'node', operation: 'delete', id: String(id) })
  else {
    delta = selectionDelta(map, anchor ?? selection.center!, args)
    if (operation === 'move') {
      for (const node of map.nodes)
        if (ids.has(node.id))
          operations.push({
            entity: 'node',
            operation: 'update',
            id: String(node.id),
            value: { x: node.x + delta.dx, y: node.y + delta.dy },
          })
    } else if (operation === 'duplicate') {
      if (!delta.dx && !delta.dy)
        throw new Error('복제 객체가 겹치지 않도록 배치 위치가 필요합니다.')
      if (map.nodes.some((node) => ids.has(node.id) && node.virtual))
        throw new Error(
          '곡선 가상 노드 복제는 곡선 전체의 재구성이 필요합니다. 일반 노드 선택으로 범위를 좁혀 주세요.',
        )
      const references = new Map<number, number>()
      let nextId = Math.max(0, ...map.nodes.map((node) => node.id))
      for (const node of map.nodes)
        if (ids.has(node.id)) {
          const id = ++nextId
          references.set(node.id, id)
          operations.push({
            entity: 'node',
            operation: 'create',
            id: String(id),
            value: {
              x: node.x + delta.dx,
              y: node.y + delta.dy,
              name: `N${id}`,
              ...Object.fromEntries(
                [
                  'direction',
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
                ].flatMap((key) =>
                  (node as unknown as Record<string, unknown>)[key] === undefined
                    ? []
                    : [[key, (node as unknown as Record<string, unknown>)[key]]],
                ),
              ),
              curveStart:
                !!node.curveStart &&
                map.edges.some(
                  (edge) =>
                    [2, 3].includes(edge.drivingType ?? 1) &&
                    ids.has(edge.from) &&
                    ids.has(edge.to) &&
                    (edge.from === node.id || edge.to === node.id),
                ),
            },
          })
        }
      for (const edge of map.edges)
        if (ids.has(edge.from) && ids.has(edge.to))
          operations.push({
            entity: 'edge',
            operation: 'create',
            value: {
              from: references.get(edge.from)!,
              to: references.get(edge.to)!,
              direction: edge.direction,
              ...Object.fromEntries(
                [
                  'drivingType',
                  'distance',
                  'speed',
                  'radius',
                  'curveAngle',
                  'goalDegree',
                  'controls',
                  'bays',
                ].flatMap((key) =>
                  (edge as unknown as Record<string, unknown>)[key] === undefined
                    ? []
                    : [[key, (edge as unknown as Record<string, unknown>)[key]]],
                ),
              ),
              realConnection:
                references.get(edge.realConnection ?? edge.to) ??
                edge.realConnection ??
                references.get(edge.to),
            },
          })
      for (const port of map.ports)
        if (port.nodeId !== undefined && ids.has(port.nodeId))
          operations.push({
            entity: 'port',
            operation: 'create',
            value: {
              name: port.name,
              nodeId: references.get(port.nodeId),
              x: port.x + delta.dx,
              y: port.y + delta.dy,
              width: port.width,
              height: port.height,
              ...Object.fromEntries(
                [
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
                ].flatMap((key) =>
                  (port as unknown as Record<string, unknown>)[key] === undefined
                    ? []
                    : [[key, (port as unknown as Record<string, unknown>)[key]]],
                ),
              ),
            },
          })
    } else throw new Error('선택 작업 종류를 확인하세요.')
  }
  const result = editMapObjects(map, operations, 45000, sourceMaxUid)
  return { ...result, delta, selection }
}
