import * as THREE from 'three'
import type { FloorArea } from './floorAreas'

/** Approximate the diffuse floor contribution once per layout change in map coordinates. */
export const bakeFacilityFloorLightMap = (
  areas: FloorArea[], fixtures: THREE.Group, unit: number,
) => {
  const bounds = new THREE.Box2()
  const position = new THREE.Vector2()
  for (const area of areas)
    for (const point of area.points) bounds.expandByPoint(position.set(point.x, point.y))
  const size = bounds.getSize(new THREE.Vector2())
  if (size.x <= 0 || size.y <= 0) return

  const canvas = document.createElement('canvas')
  const longest = Math.max(size.x, size.y)
  canvas.width = Math.max(2, Math.ceil(192 * size.x / longest))
  canvas.height = Math.max(2, Math.ceil(192 * size.y / longest))
  const context = canvas.getContext('2d')
  if (!context) return

  context.fillStyle = '#000'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.globalCompositeOperation = 'lighter'
  context.scale(canvas.width / size.x, canvas.height / size.y)
  context.translate(-bounds.min.x, -bounds.min.y)
  const pixels = (v: number) => Math.round(255 * THREE.MathUtils.clamp(v, 0, 1))
  for (const light of fixtures.children) {
    if (!(light instanceof THREE.RectAreaLight) && !(light instanceof THREE.SpotLight)) continue
    const height = Math.max(500, light.position.z / unit)
    const line = light instanceof THREE.RectAreaLight
    const spread = height * (line ? 1.4 : 0.82)
    const red = pixels(light.color.r)
    const green = pixels(light.color.g)
    const blue = pixels(light.color.b)
    const strength = Math.min(0.42, (line ? 2700000 : 3300000) / (height * height))
    const color = (alpha: number) => `rgba(${red},${green},${blue},${alpha})`
    context.save()
    context.translate(light.position.x / unit, light.position.y / unit)
    if (line) context.rotate(light.rotation.z)
    context.scale(line ? spread + light.width / (2 * fixtures.scale.x * unit) : spread, spread)
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
