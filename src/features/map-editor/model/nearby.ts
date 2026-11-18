/**
 * 파일명: nearby.ts
 * 설명: 원본 근접 노드 기준에 따라 실제 직선 거리 안의 노드를 공간 구역으로 탐색하는 진단
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import type { MapDocument, MapNode } from '@/entities/map/index.ts'
/** 지정 반경 이하에 다른 노드가 있는 식별자와 가장 가까운 연결을 계산하는 근접 검사 */
export const findNearbyNodes = (map: MapDocument, radius: number) => {
  if (map.units !== 'mm') throw new Error('근접 노드 검사에는 실제 mm 축척이 필요합니다.')
  if (!Number.isSafeInteger(radius) || radius < 0 || radius > 1e8)
    throw new Error('근접 반경은 영 이상의 정수 mm로 입력하세요.')
  const size = Math.max(1, radius),
    cells = new Map<string, MapNode[]>(),
    nearest = new Map<number, { id: number; other: number; distance: number }>()
  let pairs = 0
  for (const node of map.nodes) {
    const x = Math.floor(node.x / size),
      y = Math.floor(node.y / size)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const other of cells.get(`${x + dx},${y + dy}`) ?? []) {
          const distance = Math.hypot(node.x - other.x, node.y - other.y)
          if (distance > radius) continue
          pairs++
          if (!nearest.has(node.id) || nearest.get(node.id)!.distance > distance)
            nearest.set(node.id, { id: node.id, other: other.id, distance })
          if (!nearest.has(other.id) || nearest.get(other.id)!.distance > distance)
            nearest.set(other.id, { id: other.id, other: node.id, distance })
        }
    const key = `${x},${y}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key)!.push(node)
  }
  return { nodes: [...nearest.values()].sort((a, b) => a.id - b.id), pairs }
}
