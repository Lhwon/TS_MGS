/**
 * 파일명: portAudit.ts
 * 설명: 원본 불법 포트 검사 기준과 현재 맵의 포트 및 노드 참조 진단
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { PORT_RESERVATIONS, type MapDocument } from '@/entities/map/index.ts'

/** 부모 포트와 대기 노드 및 예약 포트의 누락 참조를 조회하는 진단 */
export const auditPortReferences = (map: MapDocument, portId?: string) => {
  const portIds = new Set(map.ports.map((port) => port.id))
  if (portId && !portIds.has(portId)) throw new Error('검사할 Port ID를 확인하세요.')
  const portUids = new Set(
    map.ports.map((port) => port.uid).filter((uid) => uid !== undefined && uid >= 0),
  )
  const nodeUids = new Set(
    map.nodes.map((node) => node.uid).filter((uid) => uid !== undefined && uid > 0),
  )
  const issues: { portId: string; nodeId: number; field: string; reference: string | number }[] = []
  let checked = 0
  for (const port of map.ports) {
    if (portId && port.id !== portId) continue
    checked++
    const parent = String(port.settings?.id_port_parent ?? '').trim()
    if (parent && parent !== '(null)' && !portIds.has(parent))
      issues.push({ portId: port.id, nodeId: port.nodeId, field: '부모 포트', reference: parent })
    for (let index = 0; index < 10; index++) {
      const uid = port.settings?.['standby_node_uid' + index]
      if (typeof uid === 'number' && uid > 0 && !nodeUids.has(uid))
        issues.push({
          portId: port.id,
          nodeId: port.nodeId,
          field: `대기 노드 UID ${index + 1}`,
          reference: uid,
        })
    }
    for (const { key, label } of PORT_RESERVATIONS) {
      const missing = new Set((port.reservations?.[key] ?? []).filter((uid) => !portUids.has(uid)))
      for (const uid of missing)
        issues.push({ portId: port.id, nodeId: port.nodeId, field: label, reference: uid })
    }
  }
  return { checked, issues }
}
