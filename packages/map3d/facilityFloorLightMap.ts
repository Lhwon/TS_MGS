import * as THREE from 'three'
import type { FloorArea } from './floorAreas'

/** Approximate the diffuse floor contribution once per layout change in map coordinates. */
export const bakeFacilityFloorLightMap = (
  areas: FloorArea[],
  fixtures: THREE.Group,
  unit: number,
) => {
  if (typeof document === 'undefined') return
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
  return { texture, bounds, size }
}
