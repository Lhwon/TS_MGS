/**
 * 파일명: realIds.ts
 * 설명: 선택 범위의 실제 식별자 정렬과 삽입 및 중복 검증과 Offset 참조 동기화
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { parseDocument, type MapDocument } from '@/entities/map/index.ts'
/** 실제 식별자를 순서대로 부여하고 기존 범위 삽입을 지원하는 Real ID 편집 */
export const assignRealIds = (
  input: MapDocument,
  ids: number[],
  options: { start: number; step: number; order: 'id' | 'xy' | 'yx'; insert: boolean },
) => {
  const { start, step, order, insert } = options
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(step) || start < 1 || step < 1)
    throw new Error('시작 Real ID와 간격은 양의 정수여야 합니다.')
  const map = structuredClone(input),
    selected = new Set(ids),
    nodes = map.nodes.filter((node) => selected.has(node.id) && !node.virtual && !node.curve)
  if (!nodes.length) throw new Error('실제 노드를 선택하세요.')
  nodes.sort((a, b) =>
    order === 'xy' ? a.x - b.x || b.y - a.y : order === 'yx' ? b.y - a.y || a.x - b.x : a.id - b.id,
  )
  if (start + (nodes.length - 1) * step >= 100000)
    throw new Error('실제 노드 Real ID는 가상 노드 범위 미만으로 지정하세요.')
  const oldIds = new Map(map.nodes.map((node) => [node.id, node.realId]))
  if (insert)
    for (const node of map.nodes)
      if (!selected.has(node.id) && !node.virtual && !node.curve && (node.realId ?? -1) >= start) {
        if (node.changeable === false)
          throw new Error(`N${node.id}의 Real ID Changeable 설정이 해제되어 있습니다.`)
        node.realId = (node.realId ?? node.id) + nodes.length * step
      }
  for (const [index, node] of nodes.entries()) {
    const value = start + index * step
    if (node.changeable === false && node.realId !== -1 && node.realId !== value)
      throw new Error(`N${node.id}의 Real ID Changeable 설정이 해제되어 있습니다.`)
    node.realId = value
  }
  const seen = new Set<number>()
  for (const node of map.nodes)
    if (node.realId !== undefined && node.realId >= 0) {
      if (seen.has(node.realId))
        throw new Error(`Real ID ${node.realId} 중복입니다. 시작값이나 삽입 설정을 확인하세요.`)
      seen.add(node.realId)
    }
  const references = new Map<number, number>()
  for (const node of map.nodes) {
    const before = oldIds.get(node.id)
    if (before !== undefined && before >= 0 && node.realId !== undefined)
      references.set(before, node.realId)
  }
  for (const offset of map.areas?.offsets ?? [])
    offset.realId = references.get(offset.realId) ?? offset.realId
  return { map: parseDocument(JSON.stringify(map)), changed: nodes.length }
}
