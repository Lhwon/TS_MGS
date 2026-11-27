import * as THREE from 'three'
import type { FloorArea } from './floorAreas'

/** 바닥과 높이별 조명 캐시 및 해제 책임 정의 */
export interface FacilityBakedLighting {
  texture: THREE.Texture
  bounds: THREE.Box2
  size: THREE.Vector2
  volume?: {
    color: THREE.DataTexture
    direction: THREE.DataTexture
    height: number
    slices: number
    width: number
    rows: number
  }
  dispose: () => void
}

/** 각도 변경 시 높이별 빛의 세기와 입사 방향을 한 번 계산하는 고정 크기 캐시 구성 */
const bakeDirectionalLighting = (
  areas: FloorArea[],
  fixtures: THREE.Group,
  unit: number,
): FacilityBakedLighting | undefined => {
  const bounds = new THREE.Box2(),
    point = new THREE.Vector2()
  for (const area of areas)
    for (const vertex of area.points) bounds.expandByPoint(point.set(vertex.x, vertex.y))
  const lights = fixtures.children.flatMap((light) => {
    if (!(light instanceof THREE.SpotLight) && !(light instanceof THREE.RectAreaLight)) return []
    const direction = new THREE.Vector3()
      .fromArray(light.userData.fixtureDirection ?? [0, 0, -1])
      .normalize()
    const { beamAngle = light instanceof THREE.RectAreaLight ? 110 : 80, penumbra = 0.65 } =
      light.userData.fixtureAngles ?? {}
    const position = light.position.clone().divideScalar(unit)
    const half = THREE.MathUtils.degToRad(beamAngle / 2)
    const reach = 10000
    bounds.expandByPoint(point.set(position.x - reach, position.y - reach))
    bounds.expandByPoint(point.set(position.x + reach, position.y + reach))
    const line = light instanceof THREE.RectAreaLight
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(light.quaternion)
    return [
      {
        position,
        direction,
        color: light.color,
        cosOuter: Math.cos(half),
        sinOuter: Math.sin(half),
        narrow: beamAngle < 10,
        cosInner: Math.cos(half * (1 - penumbra)),
        penumbra,
        line,
        axis,
        length: line ? light.width / (2 * fixtures.scale.x * unit) : 0,
      },
    ]
  })
  if (!lights.length) return
  const size = bounds.getSize(new THREE.Vector2()),
    longest = Math.max(size.x, size.y)
  const width = Math.max(2, Math.ceil((128 * size.x) / longest)),
    rows = Math.max(2, Math.ceil((128 * size.y) / longest)),
    slices = 8
  const height = Math.max(3000, ...lights.map(({ position }) => position.z + 1000))
  const cellRadius = Math.hypot(size.x / width, size.y / rows) / 2
  const count = width * rows * slices,
    colors = new Float32Array(count * 3),
    directions = new Float32Array(count * 3)
  for (const light of lights) {
    for (let layer = 0; layer < slices; layer++) {
      const z = (layer * height) / (slices - 1),
        dz = z - light.position.z
      if (Math.abs(dz) > 10000) continue
      for (let row = 0; row < rows; row++) {
        const y = bounds.min.y + ((row + 0.5) * size.y) / rows
        for (let column = 0; column < width; column++) {
          const x = bounds.min.x + ((column + 0.5) * size.x) / width
          let dx = x - light.position.x,
            dy = y - light.position.y,
            adjustedZ = dz
          if (light.line) {
            const along = THREE.MathUtils.clamp(
              dx * light.axis.x + dy * light.axis.y + dz * light.axis.z,
              -light.length,
              light.length,
            )
            dx -= along * light.axis.x
            dy -= along * light.axis.y
            adjustedZ -= along * light.axis.z
          }
          const distanceSq = dx * dx + dy * dy + adjustedZ * adjustedZ
          if (distanceSq < 1 || distanceSq > 100000000) continue
          const inverse = 1 / Math.sqrt(distanceSq)
          let facing =
            (dx * light.direction.x + dy * light.direction.y + adjustedZ * light.direction.z) *
            inverse
          /** 좁은 배광이 텍스처 셀 사이에서 누락되지 않도록 셀 면적 반영 */
          if (light.narrow) {
            const footprint = Math.min(1, cellRadius * inverse)
            facing = Math.min(1, facing + light.sinOuter * footprint + (footprint * footprint) / 2)
          }
          if (facing < light.cosOuter) continue
          const edge =
            light.penumbra === 0
              ? 1
              : THREE.MathUtils.smoothstep(facing, light.cosOuter, light.cosInner)
          const strength =
            Math.min(0.42, (light.line ? 2700000 : 3300000) / Math.max(250000, distanceSq)) * edge
          const at = ((layer * rows + row) * width + column) * 3
          colors[at]! += light.color.r * strength
          colors[at + 1]! += light.color.g * strength
          colors[at + 2]! += light.color.b * strength
          directions[at]! -= dx * inverse * strength
          directions[at + 1]! -= dy * inverse * strength
          directions[at + 2]! -= adjustedZ * inverse * strength
        }
      }
    }
  }
  const colorBytes = new Uint8Array(count * 4),
    directionBytes = new Uint8Array(count * 4)
  for (let i = 0; i < count; i++) {
    const p = i * 3,
      q = i * 4,
      length = Math.hypot(directions[p]!, directions[p + 1]!, directions[p + 2]!) || 1
    for (let c = 0; c < 3; c++) {
      colorBytes[q + c] = Math.round(255 * Math.min(1, colors[p + c]!))
      directionBytes[q + c] = Math.round(127.5 + (127.5 * directions[p + c]!) / length)
    }
    colorBytes[q + 3] = directionBytes[q + 3] = 255
  }
  /** 바닥과 객체에서 공유하는 선형 보간 텍스처 생성 */
  const texture = (bytes: Uint8Array, h: number) => {
    const result = new THREE.DataTexture(bytes, width, h, THREE.RGBAFormat)
    result.minFilter = result.magFilter = THREE.LinearFilter
    result.needsUpdate = true
    return result
  }
  const floor = texture(colorBytes.slice(0, width * rows * 4), rows)
  floor.channel = 1
  const color = texture(colorBytes, rows * slices),
    direction = texture(directionBytes, rows * slices)
  return {
    texture: floor,
    bounds,
    size,
    volume: { color, direction, height, slices, width, rows },
    dispose: () => {
      floor.dispose()
      color.dispose()
      direction.dispose()
    },
  }
}

/** 배치와 조명 설정이 변경될 때만 바닥 및 객체 조명 캐시 갱신 */
export const bakeFacilityFloorLightMap = (
  areas: FloorArea[],
  fixtures: THREE.Group,
  unit: number,
): FacilityBakedLighting | undefined => {
  if (typeof document === 'undefined') return
  if (fixtures.children.some((light) => light.userData.directional))
    return bakeDirectionalLighting(areas, fixtures, unit)
  const bounds = new THREE.Box2()
  const position = new THREE.Vector2()
  for (const area of areas)
    for (const point of area.points) bounds.expandByPoint(position.set(point.x, point.y))
  const emitters = fixtures.children.flatMap((light) => {
    if (!(light instanceof THREE.RectAreaLight) && !(light instanceof THREE.SpotLight)) return []
    const height = Math.max(500, light.position.z / unit)
    const line = light instanceof THREE.RectAreaLight
    const spread = height * (line ? 1.4 : 0.82)
    const length = line ? spread + light.width / (2 * fixtures.scale.x * unit) : spread
    const angle = line ? light.rotation.z : 0
    const x = light.position.x / unit
    const y = light.position.y / unit
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const reachX = Math.hypot(length * cos, spread * sin)
    const reachY = Math.hypot(length * sin, spread * cos)
    bounds.expandByPoint(position.set(x - reachX, y - reachY))
    bounds.expandByPoint(position.set(x + reachX, y + reachY))
    const strength = Math.min(0.42, (line ? 2700000 : 3300000) / (height * height))
    return [{ x, y, angle, length, spread, strength, color: light.color }]
  })
  if (!emitters.length) return
  const size = bounds.getSize(new THREE.Vector2())
  if (size.x <= 0 || size.y <= 0) return

  const canvas = document.createElement('canvas')
  const longest = Math.max(size.x, size.y)
  canvas.width = Math.max(2, Math.ceil((192 * size.x) / longest))
  canvas.height = Math.max(2, Math.ceil((192 * size.y) / longest))
  const context = canvas.getContext('2d')
  if (!context) return

  context.fillStyle = '#000'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.globalCompositeOperation = 'lighter'
  context.scale(canvas.width / size.x, canvas.height / size.y)
  context.translate(-bounds.min.x, -bounds.min.y)
  const pixels = (v: number) => Math.round(255 * THREE.MathUtils.clamp(v, 0, 1))
  for (const { x, y, angle, length, spread, strength, color: tint } of emitters) {
    const color = (alpha: number) =>
      `rgba(${pixels(tint.r)},${pixels(tint.g)},${pixels(tint.b)},${alpha})`
    context.save()
    context.translate(x, y)
    context.rotate(angle)
    context.scale(length, spread)
    const falloff = context.createRadialGradient(0, 0, 0, 0, 0, 1)
    falloff.addColorStop(0, color(strength))
    falloff.addColorStop(0.48, color(strength * 0.65))
    falloff.addColorStop(1, color(0))
    context.fillStyle = falloff
    context.fillRect(-1, -1, 2, 2)
    context.restore()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.channel = 1
  texture.flipY = false
  return { texture, bounds, size, dispose: () => texture.dispose() }
}
