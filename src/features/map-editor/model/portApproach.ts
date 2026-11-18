/**
 * 파일명: portApproach.ts
 * 설명: 원본 계획 경로의 방향별 포트 진입 설정과 변경 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import type { MapDocument } from '@/entities/map/index.ts'

/** 연결 노드에 실제로 도달하는 방향별 경로와 제어값 조회 */
export const inspectPortApproach = (map: MapDocument, portId: string) => {
  const port = map.ports.find((item) => item.id === portId)
  if (!port) throw new Error('지도에서 포트를 선택하거나 정확한 Port ID를 지정하세요.')
  const nodes = new Map(map.nodes.map((node) => [node.id, node]))
  const approaches = map.edges.flatMap((edge) => {
    const direction: 'forward' | 'backward' | undefined =
      edge.to === port.nodeId
        ? 'forward'
        : edge.from === port.nodeId && (edge.direction ?? 1) === 1
          ? 'backward'
          : undefined
    if (!direction) return []
    const approachNode = direction === 'forward' ? edge.from : edge.to
    const control = edge.controls?.[direction]
    return [
      {
        edgeId: edge.id,
        fromNodeId: approachNode,
        fromRealId: nodes.get(approachNode)?.realId,
        toNodeId: port.nodeId,
        direction,
        drivingType: edge.drivingType ?? 1,
        reverse: control?.reverse === 1,
        vehicleDegree:
          control?.vehicleDegree === undefined || control.vehicleDegree < 0
            ? null
            : control.vehicleDegree / 1000,
      },
    ]
  })
  return { portId: port.id, name: port.name, nodeId: port.nodeId, approaches }
}

/** 지정 진입 경로의 Reverse만 바꾸고 동일 방향 제어를 다시 읽는 원자적 편집 */
export const setPortApproachReverse = (
  map: MapDocument,
  portId: string,
  edgeId: string,
  reverse: boolean,
) => {
  const before = inspectPortApproach(map, portId).approaches.find((row) => row.edgeId === edgeId)
  if (!before) throw new Error('선택한 경로는 이 포트로 진입할 수 없습니다.')
  if (typeof reverse !== 'boolean') throw new Error('후진 설정 또는 해제를 지정하세요.')
  if (before.reverse === reverse) return { changed: false, before, after: before }
  const edge = map.edges.find((item) => item.id === edgeId)!
  const controls = (edge.controls ??= {})
  controls[before.direction] = { ...controls[before.direction], reverse: Number(reverse) }
  const after = inspectPortApproach(map, portId).approaches.find((row) => row.edgeId === edgeId)!
  return { changed: true, before, after }
}
