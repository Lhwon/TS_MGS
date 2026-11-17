/**
 * 파일명: repairReferences.ts
 * 설명: 삭제 후 포트 그룹의 남은 소속과 기준 노드 및 오프셋을 일관되게 정리하는 참조 처리
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import type { MapDocument } from '@/entities/map/model/map.ts'
/** 남아 있는 포트의 기준으로 그룹을 유지하거나 빈 참조를 제거하는 포트 그룹 복구 */
export const repairPortGroups = (map: MapDocument) => {
  const ports = new Map(map.ports.map((port) => [port.id, port])),
    nodes = new Map(map.nodes.map((node) => [node.id, node]))
  map.portGroups = map.portGroups?.filter((group) => {
    group.portIds = group.portIds.filter((id) => ports.has(id))
    if (group.nodeId === undefined || nodes.has(group.nodeId)) return true
    const port = ports.get(group.portIds[0]),
      node = port ? nodes.get(port.nodeId) : undefined
    if (!node) return false
    group.nodeId = node.id
    group.nodeX = node.x
    group.nodeY = node.y
    group.offsetX = group.x - node.x
    group.offsetY = group.y - node.y
    return true
  })
}
