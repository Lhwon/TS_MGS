import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'

const focus = new THREE.Vector3()
const focusByGroup = new WeakMap<THREE.Group, THREE.Vector3>()
type Position = Pick<THREE.Vector3, 'x' | 'y' | 'z'>

/** 설비 배치가 바뀌면 카메라가 정지한 상태에서도 조명 선택 갱신 */
export const invalidateFacilityLightSelection = (group: THREE.Group) => {
  focusByGroup.delete(group)
}

/** 가까운 광원만 실시간으로 계산하고 같은 시점에서는 조명 목록 재사용 */
export const selectFacilityLights = (group: THREE.Group, camera: Position, target: Position) => {
  if (!group.visible || !group.children.length) return
  focus.set(
    THREE.MathUtils.lerp(camera.x, target.x, 0.65),
    THREE.MathUtils.lerp(camera.y, target.y, 0.65),
    THREE.MathUtils.lerp(camera.z, target.z, 0.65),
  )
  const previousFocus = focusByGroup.get(group)
  if (previousFocus?.equals(focus)) return
  if (previousFocus) previousFocus.copy(focus)
  else focusByGroup.set(group, focus.clone())
  group.worldToLocal(focus)

  let spot: THREE.Object3D | undefined
  let secondSpot: THREE.Object3D | undefined
  let line: THREE.Object3D | undefined
  let spotDistance = Infinity
  let secondDistance = Infinity
  let lineDistance = Infinity
  for (const light of group.children) {
    const dx = focus.x - light.position.x
    const dy = focus.y - light.position.y
    const weight = light.visible ? 0.8 : 1
    if (light instanceof THREE.RectAreaLight) {
      const angle = light.rotation.z
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const along = Math.max(0, Math.abs(dx * cos + dy * sin) - light.width / (2 * group.scale.x))
      const across = dx * sin - dy * cos
      const distance = (along * along + across * across) * weight
      if (distance < lineDistance) {
        line = light
        lineDistance = distance
      }
    } else {
      const distance = (dx * dx + dy * dy) * weight
      if (distance < spotDistance) {
        secondSpot = spot
        secondDistance = spotDistance
        spot = light
        spotDistance = distance
      } else if (distance < secondDistance) {
        secondSpot = light
        secondDistance = distance
      }
    }
  }
  if (line && !Object.hasOwn(THREE.UniformsLib, 'LTC_FLOAT_1')) RectAreaLightUniformsLib.init()
  // ponytail: keep two spots and one strip live; the cached floor map supplies the distant fixtures.
  for (const light of group.children) light.visible = light === spot || light === secondSpot || light === line
}
