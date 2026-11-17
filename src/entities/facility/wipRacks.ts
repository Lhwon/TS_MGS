import type { FacilityAsset, FacilityInstance } from '@bem/map3d'

export interface WipRackPort {
  id: string
  name: string
  nodeId: number
  x: number
  y: number
  width?: number
  height?: number
}

/** 포트 표시명 또는 식별자에서 층과 적재 순번을 제외한 물리 보관 위치 추출 */
export const wipRackKey = (port: Pick<WipRackPort, 'name' | 'id'>) => {
  const tag = [port.name, port.id]
    .map((value) => value.trim().toUpperCase())
    .find((value) => /^WIP\d*(?:_|$)/.test(value))
  return tag?.replace(/_\d+F(?:_\d+T)?$/, '').replace(/_\d+T$/, '')
}

/** 같은 보관 위치의 층별 포트를 합치고 포트 범위에 맞추는 랙 배치 구성 */
export const buildWipRacks = (ports: WipRackPort[], asset: FacilityAsset): FacilityInstance[] => {
  if (!asset.glb || asset.kind !== 'rack') throw new Error('GLB 랙 모델이 필요합니다.')
  const groups = new Map<string, WipRackPort[]>()
  for (const port of ports) {
    const key = wipRackKey(port)
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(port)
    groups.set(key, group)
  }
  const bounds = [...groups].map(([key, group]) => {
    const minX = Math.min(...group.map((port) => port.x - (port.width ?? 2000) / 2))
    const maxX = Math.max(...group.map((port) => port.x + (port.width ?? 2000) / 2))
    const minY = Math.min(...group.map((port) => port.y - (port.height ?? 500) / 2))
    const maxY = Math.max(...group.map((port) => port.y + (port.height ?? 500) / 2))
    return {
      key,
      group,
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      width: maxX - minX,
      depth: maxY - minY,
    }
  })
  return bounds
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((rack) => {
      let width = rack.width
      let depth = rack.depth
      for (const other of bounds) {
        if (rack === other) continue
        const dx = Math.abs(rack.x - other.x)
        const dy = Math.abs(rack.y - other.y)
        if (dx > Math.min(rack.width, other.width) / 2 && dy < (rack.depth + other.depth) / 2)
          width = Math.min(width, dx * 0.94)
        if (dy > Math.min(rack.depth, other.depth) / 2 && dx < (rack.width + other.width) / 2)
          depth = Math.min(depth, dy * 0.94)
      }
      const anchor = [...rack.group].sort((a, b) => a.id.localeCompare(b.id))[0]!
      return {
        id: `wip-rack-${rack.key}`,
        assetId: asset.id,
        name: rack.key,
        position: { x: rack.x, y: rack.y, z: 0 },
        rotation: 0,
        scale: { x: width / asset.glb!.size.x, y: depth / asset.glb!.size.y, z: 1 },
        portId: anchor.id,
        nodeId: anchor.nodeId,
        portOffset: { x: rack.x - anchor.x, y: rack.y - anchor.y, z: 0 },
      }
    })
}
