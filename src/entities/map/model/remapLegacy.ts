/**
 * 파일명: remapLegacy.ts
 * 설명: 로컬 노드 식별자 변경 시 원본 노드와 계획 경로 및 포트 참조를 동기화하는 변환
 * 작성자: 이희원
 * 작성일자: 2026-11-17
 */
import { MAX_NODES } from '@/entities/map/model/map.ts'
import type { LegacySource } from '@/entities/map/model/legacyWriter.ts'
/** UID와 실제 식별자를 바꾸지 않고 원본 로컬 노드 참조만 재배치하는 원본 변환 */
export const remapLegacySource = (
  source: LegacySource,
  references: { before: number; after: number }[],
): LegacySource => {
  const refs = new Map(references.map((item) => [item.before, item.after]))
  let deleted = MAX_NODES
  for (const node of source.baseline.nodes) if (!refs.has(node.id)) refs.set(node.id, ++deleted)
  const id = (value: number) => refs.get(value) ?? value
  const baseline = structuredClone(source.baseline)
  for (const node of baseline.nodes) {
    node.id = id(node.id)
    node.name = `N${node.id}`
  }
  for (const edge of baseline.edges) {
    edge.from = id(edge.from)
    edge.to = id(edge.to)
    if (edge.realConnection !== undefined) edge.realConnection = id(edge.realConnection)
  }
  for (const port of baseline.ports) port.nodeId = id(port.nodeId)
  for (const group of baseline.portGroups ?? [])
    if (group.nodeId !== undefined) group.nodeId = id(group.nodeId)
  const ending = source.content.includes('\r\n') ? '\r\n' : '\n',
    bom = source.content.startsWith('\uFEFF') ? '\uFEFF' : '',
    lines = source.content.replace(/^\uFEFF/, '').split(/\r?\n/),
    header = lines[1].split('\t')
  const nodeCount = Number(header[0]),
    pathCount = Number(header[3]),
    portCount = Number(header[2])
  for (let index = 2; index < 2 + nodeCount; index++) {
    const row = lines[index].split('\t')
    for (const column of [0, 14, 21]) row[column] = String(id(Number(row[column])))
    lines[index] = row.join('\t')
  }
  for (let index = 2 + nodeCount; index < 2 + nodeCount + pathCount; index++) {
    const row = lines[index].split('\t')
    row[0] = String(id(Number(row[0])))
    let offset = 25
    for (let block = 0; block < Number(row[9]); block++) {
      row[offset] = String(id(Number(row[offset])))
      const bays = Number(row[offset + 54])
      if (!Number.isSafeInteger(bays) || bays < 0)
        throw new Error('계획 경로 Bay 참조를 확인하세요.')
      offset += 55 + bays
    }
    lines[index] = row.join('\t')
  }
  for (
    let index = 2 + nodeCount + pathCount;
    index < 2 + nodeCount + pathCount + portCount;
    index++
  ) {
    const row = lines[index].split('\t')
    row[1] = String(id(Number(row[1])))
    lines[index] = row.join('\t')
  }
  const groups = source.groups
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line
      const row = line.split('\t')
      row[7] = String(id(Number(row[7])))
      return row.join('\t')
    })
    .join(ending)
  return { content: bom + lines.join(ending), groups, baseline }
}
