/**
 * 파일명: featureBoundaries.ts
 * 설명: 원본 Feature 분할 조건에 따른 경계 노드 조회
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import type { MapDocument } from '@/entities/map/index.ts'

/** 분리 플래그와 연결 개수 및 Bay 변경을 기준으로 분할 대상 노드 계산 */
export const findFeatureBoundaries = (map: MapDocument) => {
  const connections = new Map(
    map.nodes.map((node) => [node.id, { out: [] as Arc[], in: [] as Arc[] }]),
  )
  const divided = new Set<number>()
  const lineCount = new Map<number, number>()
  type Arc = { from: number; to: number; both: boolean; bays: Set<number> }
  /** 지도 연결을 원본 계획 경로 방향으로 누적 */
  const add = (arc: Arc) => {
    connections.get(arc.from)?.out.push(arc)
    connections.get(arc.to)?.in.push(arc)
  }
  for (const edge of map.edges) {
    const both = edge.direction === 1
    const bays = new Set(edge.bays)
    add({ from: edge.to, to: edge.from, both, bays })
    if (both) add({ from: edge.from, to: edge.to, both, bays })
  }
  for (const node of map.nodes) {
    const { out, in: incoming } = connections.get(node.id)!
    const neighbors = new Set([...out.map((arc) => arc.to), ...incoming.map((arc) => arc.from)])
    if (
      (out.length === 1 &&
        incoming.length === 2 &&
        incoming.some((arc) => !arc.both) &&
        out[0].both) ||
      (out.length === 2 &&
        incoming.length === 1 &&
        incoming[0].both &&
        out.some((arc) => !arc.both))
    ) {
      divided.add(node.id)
      lineCount.set(node.id, 2)
    } else if (
      (!out.length && incoming.length > 0) ||
      (out.length > 1 && !incoming.length && !out[0].both)
    ) {
      divided.add(node.id)
      lineCount.set(node.id, 1)
    } else {
      lineCount.set(node.id, neighbors.size)
      if ((node.property ?? 0) & (1 << 1) || neighbors.size === 1 || neighbors.size >= 3)
        divided.add(node.id)
    }
  }
  const virtual = new Set(map.nodes.filter((node) => node.virtual).map((node) => node.id))
  for (const [, { out }] of [...connections].sort(([a], [b]) => a - b))
    for (const arc of out) {
      if (virtual.has(arc.to) || divided.has(arc.to)) continue
      if (
        connections
          .get(arc.to)
          ?.out.some(
            (next) =>
              next.bays.size !== arc.bays.size || [...next.bays].some((bay) => !arc.bays.has(bay)),
          )
      ) {
        divided.add(arc.to)
        break
      }
    }
  return [...divided].sort((a, b) => a - b).map((id) => ({ id, lines: lineCount.get(id) ?? 0 }))
}
