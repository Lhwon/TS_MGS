/**
 * 파일명: nativeSnapshot.ts
 * 설명: 저장 결과의 UID와 자동 차량 각도 및 연결 거리와 기본값을 편집 문서에도 반영하는 원본 동기화
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import {
  serializeLegacy,
  type LegacySource,
  type LegacyWriteOptions,
} from '@/entities/map/model/legacyWriter.ts'
import { previewLegacy } from '@/entities/map/model/legacy.ts'
import type { MapDocument } from '@/entities/map/model/map.ts'
/** 원본 직렬화 결과를 다시 해석하고 도면 및 영역을 유지한 편집 메타데이터를 구성하는 문서 갱신 */
export const serializeLegacySnapshot = (
  map: MapDocument,
  source?: LegacySource | null,
  options: LegacyWriteOptions = {},
) => {
  const output = serializeLegacy(map, source, options),
    native = previewLegacy(output.content, map.name, output.groups),
    nodes = new Map(native.nodes.map((node) => [node.id, node])),
    edges = new Map(native.edges.map((edge) => [`${edge.from}-${edge.to}`, edge])),
    ports = new Map(native.ports.map((port) => [port.id, port])),
    groups = new Map(native.portGroups?.map((group) => [group.id, group]) ?? [])
  return {
    ...output,
    map: {
      ...map,
      legacy: native.legacy,
      nodes: map.nodes.map((node) => ({ ...node, ...nodes.get(node.id) })),
      edges: map.edges.map((edge) => ({
        ...edge,
        ...edges.get(`${edge.from}-${edge.to}`),
        id: edge.id,
      })),
      ports: map.ports.map((port) => ({ ...port, ...ports.get(port.id) })),
      portGroups: map.portGroups?.map((group) => ({ ...group, ...groups.get(group.id) })),
    } satisfies MapDocument,
  }
}
