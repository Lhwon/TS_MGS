/**
 * 파일명: automaticControls.ts
 * 설명: 원본 Control Map Data의 회전과 목표 전송 및 명령 유지 플래그를 계산하는 일괄 설정
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import {
  serializeLegacySnapshot,
  type LegacySource,
  type MapDocument,
} from '@/entities/map/index.ts'
export const MAP_CONTROL_ACTIONS = [
  { value: 'spin-off', title: 'Spinturnable · 전체 해제' },
  { value: 'spin-on', title: 'Spinturnable · 곡선 제외 전체 설정' },
  { value: 'spin-junction', title: 'Spinturnable · IC / JC 경로 자동 설정' },
  { value: 'spin-ports', title: 'Spinturnable · 포트 노드 해제' },
  { value: 'goal-off', title: 'No Send Goal · 전체 해제' },
  { value: 'goal-on', title: 'No Send Goal · 곡선 제외 전체 설정' },
  { value: 'goal-auto', title: 'No Send Goal · 단방향 교차 자동 설정' },
  { value: 'retain-off', title: 'Don’t Remove CMD · 전체 해제' },
  { value: 'retain-on', title: 'Don’t Remove CMD · 전체 설정' },
  { value: 'retain-auto', title: 'Don’t Remove CMD · 양방향 자동 설정' },
] as const
/** 원본 계획 경로와 차량 각도를 다시 생성하여 편집 문서의 제어값을 갱신하는 재계산 */
export const rebuildPathControls = (map: MapDocument, source?: LegacySource | null) =>
  serializeLegacySnapshot(map, source, { rebuildControls: true }).map

/** 원본의 전체 및 조건별 플래그 설정을 독립된 문서에 적용하는 제어 데이터 편집 */
export const applyAutomaticControls = (
  input: MapDocument,
  action: string,
  source?: LegacySource | null,
) => {
  if (!MAP_CONTROL_ACTIONS.some((item) => item.value === action))
    throw new Error('자동 제어 설정 명령을 확인하세요.')
  const map = rebuildPathControls(input, source),
    nodes = new Map(map.nodes.map((node) => [node.id, node]))
  if (action === 'spin-off' || action === 'spin-on') {
    for (const node of map.nodes)
      if (action === 'spin-off' || (!node.curve && !node.curveStart))
        node.spinturnable = action === 'spin-on'
  } else if (action === 'spin-ports') {
    for (const port of map.ports) nodes.get(port.nodeId)!.spinturnable = false
  } else if (action === 'goal-off' || action === 'goal-on') {
    for (const node of map.nodes)
      if (action === 'goal-off' || (!node.curve && !node.curveStart))
        node.noSendGoal = action === 'goal-on'
  } else if (action === 'retain-off' || action === 'retain-on') {
    for (const node of map.nodes) node.dontRemoveCmd = action === 'retain-on'
  } else if (action === 'retain-auto') {
    for (const edge of map.edges)
      if ((edge.direction ?? 0) === 1) nodes.get(edge.from)!.dontRemoveCmd = true
  } else if (action === 'goal-auto') {
    const incoming = new Map<number, number>(),
      outgoing = new Map<number, number>()
    for (const edge of map.edges)
      if ((edge.direction ?? 0) === 0) {
        outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1)
        incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
      }
    for (const node of map.nodes)
      if ((incoming.get(node.id) ?? 0) >= 2 && (outgoing.get(node.id) ?? 0) >= 2)
        node.noSendGoal = true
  } else if (action === 'spin-junction') {
    const planning = new Map<number, { target: number; degree: number }[]>()
    for (const node of map.nodes) planning.set(node.id, [])
    for (const edge of map.edges) {
      planning
        .get(edge.to)!
        .push({
          target: edge.from,
          degree: Math.fround((edge.controls?.forward?.vehicleDegree ?? -1) / 1000),
        })
      if ((edge.direction ?? 0) === 1)
        planning
          .get(edge.from)!
          .push({
            target: edge.to,
            degree: Math.fround((edge.controls?.backward?.vehicleDegree ?? -1) / 1000),
          })
    }
    for (const [head, connections] of planning) {
      if (nodes.get(head)!.virtual) continue
      for (const current of connections) {
        const via = nodes.get(current.target)!
        if (via.virtual || via.curve || via.curveStart) continue
        for (const next of planning.get(via.id) ?? []) {
          if (nodes.get(next.target)!.curve) continue
          const delta = Math.abs((((next.degree - current.degree) % 360) + 360) % 360)
          if (Math.min(delta, 360 - delta) >= 30) via.spinturnable = true
        }
      }
    }
  }
  return map
}
