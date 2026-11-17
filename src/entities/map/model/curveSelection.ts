/**
 * 파일명: curveSelection.ts
 * 설명: 원본 선택 이동처럼 실제 노드에 이어진 곡선 가상 노드를 이동 범위에 포함하는 탐색
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import type { MapDocument } from '@/entities/map/model/map.ts'
/** 연결 순서를 따라 곡선 보간 노드를 모으고 순환 연결을 차단하는 이동 범위 확장 */
export const expandCurveSelection = (map: MapDocument, ids: number[]) => {
  const selected = new Set(ids),
    nodes = new Map(map.nodes.map((node) => [node.id, node])),
    outgoing = new Map<number, typeof map.edges>()
  for (const edge of map.edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, [])
    outgoing.get(edge.from)!.push(edge)
  }
  for (const id of ids)
    for (const first of outgoing.get(id) ?? []) {
      if (![2, 3].includes(first.drivingType ?? 1)) continue
      let current = first.to
      const visited = new Set<number>()
      while (nodes.get(current)?.curve && !visited.has(current)) {
        selected.add(current)
        visited.add(current)
        const next = outgoing.get(current)?.find((edge) => [2, 3].includes(edge.drivingType ?? 1))
        if (!next) break
        current = next.to
      }
    }
  return [...selected]
}
