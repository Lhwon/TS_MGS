import type { FacilityAsset, FacilityDocument } from './index'
import { cargoModels } from './cargo-models'

const models = new Map(cargoModels.map((asset) => [asset.id, asset]))

/** 편집기와 관제 화면이 함께 사용하는 캐리어 원본의 독립 사본 조회 */
export const standardCargoAsset = (id: string): FacilityAsset | undefined => {
  const asset = models.get(id)
  return asset ? structuredClone(asset) : undefined
}

/** 구형 프로젝트 내장 모델을 공통 원본으로 교체하는 캐리어 정합 */
export const normalizeCargoDocument = (document: FacilityDocument): FacilityDocument => {
  const original = new Map(document.assets.map((asset) => [asset.id, asset]))
  const assets = document.assets.map((asset) => {
    const current = models.get(asset.id)
    if (
      !current?.glb ||
      (asset.glb && asset.glb.data === current.glb.data &&
        asset.glb.size.x === current.glb.size.x &&
        asset.glb.size.y === current.glb.size.y &&
        asset.glb.size.z === current.glb.size.z)
    )
      return asset
    return { ...asset, kind: current.kind, parts: [], glb: structuredClone(current.glb) }
  })
  const instances = document.instances.map((instance) => {
    const before = original.get(instance.assetId)?.glb?.size
    const after = models.get(instance.assetId)?.glb?.size
    if (
      !before ||
      !after ||
      !instance.scale ||
      (before.x === after.x && before.y === after.y && before.z === after.z)
    )
      return instance
    if (
      Math.abs(before.x * instance.scale.x - after.x) < 0.01 &&
      Math.abs(before.y * instance.scale.y - after.y) < 0.01 &&
      Math.abs(before.z * instance.scale.z - after.z) < 0.01
    )
      return { ...instance, scale: { x: 1, y: 1, z: 1 } }
    return instance
  })
  return { ...document, assets, instances }
}
