/**
 * 파일명: around.ts
 * 설명: 원본 MGS와 같은 정수 직선 거리 및 정렬로 주변 노드 데이터를 생성하는 변환
 * 작성자: 이희원
 * 작성일자: 2026-11-17
 */
import type { MapDocument } from '@/entities/map/index.ts'
/** 거리 반경의 공간 구역을 사용하며 원본 주변 노드 파일을 구성하는 주변 조회 */
export const makeAroundData = (map: MapDocument, radius: number) => {
  if (map.units !== 'mm') throw new Error('주변 거리 데이터에는 실제 mm 축척이 필요합니다.')
  if (!Number.isSafeInteger(radius) || radius < 1 || radius > 1e8)
    throw new Error('주변 반경은 양의 정수 mm로 입력하세요.')
  const sorted = [...map.nodes].sort((a, b) => a.id - b.id)
  if (sorted.some((node, index) => node.id !== index + 1))
    throw new Error('주변 데이터 생성 전에 연속 노드 ID를 적용하세요.')
  const cells = new Map<string, typeof sorted>()
  for (const node of sorted) {
    const key = `${Math.floor(node.x / radius)},${Math.floor(node.y / radius)}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key)!.push(node)
  }
  let pairs = 0
  const rows = [`${radius}\t`]
  for (const node of sorted) {
    const near: { id: number; distance: number }[] = [],
      x = Math.floor(node.x / radius),
      y = Math.floor(node.y / radius)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const other of cells.get(`${x + dx},${y + dy}`) ?? []) {
          if (other.id === node.id) continue
          const distance = Math.trunc(Math.hypot(node.x - other.x, node.y - other.y))
          if (distance < radius) near.push({ id: other.id, distance })
        }
    near.sort((a, b) => a.distance - b.distance || a.id - b.id)
    pairs += near.length
    rows.push(near.map((item) => `${item.id}\t${item.distance}\t`).join(''))
  }
  return { content: rows.join('\r\n') + '\r\n', nodes: sorted.length, pairs, radius }
}
