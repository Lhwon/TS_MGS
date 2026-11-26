/**
 * 파일명: glbLights.ts
 * 설명: 조명 모델 기능 정의
 * 작성자: 이희원
 * 작성일자: 2026-11-25
 */
import * as THREE from 'three'
import { facilityLight, type FacilityAsset, type FacilityLight } from './index'
import { facilityLightColor } from './facilityLights'

export interface FacilityEmitter {
  fixture: FacilityLight
  color: number
  bounds: THREE.Box3
  lens?: THREE.Mesh
}

/** 이름을 붙인 확산판 또는 기존 발광부를 찾고 일반 GLB는 모델 밑면을 사용 */
export const prepareFacilityEmitter = (
  asset: FacilityAsset, source: THREE.Object3D, modelScale: Pick<THREE.Matrix4, 'elements'>,
): FacilityEmitter | undefined => {
  const fixture = facilityLight(asset)
  if (!fixture) return
  const bounds = new THREE.Box3()
  const scaleMatrix = new THREE.Matrix4().fromArray(modelScale.elements)
  let lens: THREE.Mesh | undefined
  source.traverse((part) => {
    if (!(part instanceof THREE.Mesh) || !(part.material instanceof THREE.MeshStandardMaterial)) return
    if (part.material.name === 'Diffused lamp lens' ||
      (!lens && (part.material.emissiveMap || part.material.emissive.getHex() !== 0)))
      lens = part
  })
  if (lens) {
    lens.geometry.computeBoundingBox()
    bounds.copy(lens.geometry.boundingBox!).applyMatrix4(scaleMatrix.multiply(lens.matrixWorld))
  } else {
    bounds.set(new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0))
    bounds.applyMatrix4(scaleMatrix)
  }
  return { fixture, color: facilityLightColor(fixture.temperature), bounds, lens }
}

/** 공유 GLB 원본을 유지하며 발광 부품만 설정 색상으로 표시 */
export const facilityEmitterMaterial = (part: THREE.Mesh, emitter?: FacilityEmitter) => {
  const material = part.material
  if (part !== emitter?.lens || !(material instanceof THREE.MeshStandardMaterial)) return material
  const glowing = material.clone()
  glowing.emissive.setHex(emitter.color)
  glowing.emissiveIntensity = 4
  return glowing
}

/** GLB 확산판 위치와 배율을 따라가는 광원. 편집기는 m, 운영 설비는 mm로 배치 */
export const createFacilityLights = (localUnitsPerMeter = 1) => {
  const group = new THREE.Group()
  group.name = 'showroom-fixtures'
  const lights = new Map<string, THREE.SpotLight | THREE.RectAreaLight>()
  const point = new THREE.Vector3()
  const size = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const rotation = new THREE.Matrix4()
  const transform = new THREE.Matrix4()

  const update = (
    id: string, { fixture, color, bounds }: FacilityEmitter, placement: Pick<THREE.Matrix4, 'elements'>, parentScale = 1,
  ) => {
    let light = lights.get(id)
    if (!light) {
      if (fixture.kind === 'spot') {
        const worldUnitsPerMeter = localUnitsPerMeter * parentScale
        const spot = new THREE.SpotLight(color, 48 * worldUnitsPerMeter ** 2, 10 * worldUnitsPerMeter,
          THREE.MathUtils.degToRad(60), 0.65)
        spot.target.position.z = -1
        spot.add(spot.target)
        light = spot
      } else {
        light = new THREE.RectAreaLight(color, 145)
      }
      light.userData.temperature = fixture.temperature
      // Keep fixtures as bake sources without adding per-pixel live lights.
      light.layers.disableAll()
      lights.set(id, light)
      group.add(light)
    }
    transform.fromArray(placement.elements)
    bounds.getCenter(point)
    point.z = bounds.min.z
    light.position.copy(point.applyMatrix4(transform))
    light.position.z -= 0.006 * localUnitsPerMeter
    if (light instanceof THREE.RectAreaLight) {
      bounds.getSize(size)
      scale.setFromMatrixScale(transform)
      light.width = Math.max(0.002 * localUnitsPerMeter, size.x * scale.x) * parentScale
      light.height = Math.max(0.002 * localUnitsPerMeter, size.y * scale.y) * parentScale
      light.quaternion.setFromRotationMatrix(rotation.extractRotation(transform))
    }
  }

  const remove = (id: string) => {
    const light = lights.get(id)
    if (!light) return
    light.removeFromParent()
    lights.delete(id)
  }

  const clear = () => {
    group.clear()
    lights.clear()
  }

  return { group, update, remove, clear }
}
