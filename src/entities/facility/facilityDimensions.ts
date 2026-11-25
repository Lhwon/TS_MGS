/**
 * 파일명: facilityDimensions.ts
 * 설명: 모델 부품의 렌더링 변환과 배치 기준 치수 계산
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
import * as THREE from 'three'
import type { FacilityAsset, FacilityPart } from '@bem/map3d'

export const FACILITY_CYLINDER_SEGMENTS = 24

/** 부품의 위치와 회전 및 크기를 모델 좌표계의 미터 단위 행렬로 변환 */
export const facilityPartMatrix = (part: FacilityPart) => {
  const radians = THREE.MathUtils.degToRad
  const rotation = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 0, 1), radians(part.rotation))
    .multiply(
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(radians(part.tiltX ?? 0), radians(part.tiltY ?? 0), 0),
      ),
    )
  const { x, y, z } = part.size
  const scale = new THREE.Vector3(x, y, z)
  if (part.shape === 'cylinder') {
    rotation.multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
    )
    scale.set(x, z, y)
  }
  return new THREE.Matrix4().compose(
    new THREE.Vector3(part.position.x, part.position.y, part.position.z).multiplyScalar(0.001),
    rotation,
    scale.multiplyScalar(0.001),
  )
}

/** 배치 변환 전 모델의 밀리미터 단위 외곽 */
export const facilityModelBounds = (asset: FacilityAsset) => {
  if (asset.glb) {
    const { x, y, z } = asset.glb.size
    return new THREE.Box3(new THREE.Vector3(-x / 2, -y / 2, 0), new THREE.Vector3(x / 2, y / 2, z))
  }
  const bounds = new THREE.Box3()
  const unitBox = new THREE.Box3(
    new THREE.Vector3(-0.5, -0.5, -0.5),
    new THREE.Vector3(0.5, 0.5, 0.5),
  )
  const partBounds = new THREE.Box3()
  const point = new THREE.Vector3()
  for (const part of asset.parts) {
    const matrix = facilityPartMatrix(part)
    if (part.shape === 'box') {
      bounds.union(partBounds.copy(unitBox).applyMatrix4(matrix))
      continue
    }
    // 원통은 렌더링에 사용한 외곽 꼭짓점으로 기울어진 면의 실제 치수를 계산
    for (let index = 0; index < FACILITY_CYLINDER_SEGMENTS; index++) {
      const angle = (index * Math.PI * 2) / FACILITY_CYLINDER_SEGMENTS
      const x = Math.sin(angle) / 2
      const z = Math.cos(angle) / 2
      bounds.expandByPoint(point.set(x, 0.5, z).applyMatrix4(matrix))
      bounds.expandByPoint(point.set(x, -0.5, z).applyMatrix4(matrix))
    }
  }
  bounds.min.multiplyScalar(1000)
  bounds.max.multiplyScalar(1000)
  return bounds
}

/** 배치 배율과 방향을 적용하기 전 모델 외곽의 가로와 세로 및 높이를 밀리미터로 계산 */
export const facilityModelSize = (asset: FacilityAsset) => {
  if (asset.glb) return asset.glb.size
  const { x, y, z } = facilityModelBounds(asset).getSize(new THREE.Vector3())
  return { x, y, z }
}
