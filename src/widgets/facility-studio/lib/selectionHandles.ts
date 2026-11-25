/**
 * 파일명: selectionHandles.ts
 * 설명: 모델의 바깥 모서리를 화면으로 투영하여 편집 핸들 위치 계산
 * 작성자: 이희원
 * 작성일자: 2026-11-24
 */
import * as THREE from 'three'

export type SelectionProjection = { bounds: THREE.Box3; transform: THREE.Matrix4 }
type Corner = { local: THREE.Vector3; screen: THREE.Vector2; index: number }
type HandlePoint = { screen: THREE.Vector2; anchor: THREE.Vector3; outward: THREE.Vector2 }

/** 외곽선에서 보이는 변의 중앙과 모서리를 실제 모델 축과 연결 */
export const projectSelectionHandles = (
  selection: SelectionProjection,
  camera: THREE.Camera,
  width: number,
  height: number,
) => {
  const { bounds, transform } = selection
  if (bounds.isEmpty()) return
  const points = new Map<string, HandlePoint>()
  const project = (local: THREE.Vector3) => {
    const p = local.clone().applyMatrix4(transform).project(camera)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.z < -1 || p.z > 1) return
    return new THREE.Vector2((p.x + 1) * width / 2, (1 - p.y) * height / 2)
  }
  const center = bounds.getCenter(new THREE.Vector3())
  const centerScreen = project(center)
  if (!centerScreen) return
  const corners: Corner[] = []
  for (let index = 0; index < 8; index++) {
    const local = new THREE.Vector3(
      index & 1 ? bounds.max.x : bounds.min.x,
      index & 2 ? bounds.max.y : bounds.min.y,
      index & 4 ? bounds.max.z : bounds.min.z,
    )
    const screen = project(local)
    if (!screen) return
    corners.push({ local, screen, index })
  }
  const sorted = [...corners].sort((a, b) => a.screen.x - b.screen.x || a.screen.y - b.screen.y)
  const hullHalf = (row: Corner[]) => {
    const hull: Corner[] = []
    for (const corner of row) {
      while (hull.length >= 2) {
        const a = hull.at(-2)!.screen
        const b = hull.at(-1)!.screen
        if (b.clone().sub(a).cross(corner.screen.clone().sub(a)) > 0.01) break
        hull.pop()
      }
      hull.push(corner)
    }
    return hull.slice(0, -1)
  }
  const hull = [...hullHalf(sorted), ...hullHalf(sorted.reverse())]
  if (hull.length < 3) return
  const edges = hull.map((a, index) => {
    const b = hull[(index + 1) % hull.length]!
    const direction = b.screen.clone().sub(a.screen)
    return { a, b, length: direction.length(), normal: new THREE.Vector2(direction.y, -direction.x).normalize() }
  })
  const usedEdges = new Set<(typeof edges)[number]>()
  for (const [axis, bit] of [['x', 1], ['z', 4], ['y', 2]] as const) {
    for (const positive of [true, false]) {
      const face = positive ? bounds.max[axis] : bounds.min[axis]
      const opposite = positive ? bounds.min[axis] : bounds.max[axis]
      const sidePoint = center.clone()
      sidePoint[axis] = face
      const oppositePoint = center.clone()
      oppositePoint[axis] = opposite
      const direction = project(sidePoint)!.sub(project(oppositePoint)!)
      if (direction.length() < 6) continue
      direction.normalize()
      let edge: (typeof edges)[number] | undefined
      let score = 0.35
      for (const candidate of edges) {
        if (candidate.length < 16 || usedEdges.has(candidate) ||
            !!(candidate.a.index & bit) !== positive || !!(candidate.b.index & bit) !== positive) continue
        const alignment = candidate.normal.dot(direction)
        if (alignment <= score) continue
        score = alignment
        edge = candidate
      }
      if (!edge) continue
      usedEdges.add(edge)
      const centerOfEdge = edge.a.local.clone().lerp(edge.b.local, 0.5)
      const anchor = centerOfEdge.clone()
      anchor[axis] = opposite
      points.set(positive ? axis : `${axis}-min`, {
        screen: edge.a.screen.clone().lerp(edge.b.screen, 0.5),
        anchor,
        outward: project(centerOfEdge)!.sub(project(anchor)!),
      })
    }
  }

  const usedCorners = new Set<Corner>()
  for (const [name, x, y] of [['nw', -1, -1], ['ne', 1, -1], ['sw', -1, 1], ['se', 1, 1]] as const) {
    const corner = hull.filter((point) => !usedCorners.has(point)).sort((a, b) =>
      (b.screen.x - a.screen.x) * x + (b.screen.y - a.screen.y) * y,
    )[0]
    if (!corner) continue
    usedCorners.add(corner)
    const opposite = corners[corner.index ^ 7]!
    points.set(name, { screen: corner.screen, anchor: opposite.local, outward: corner.screen.clone().sub(opposite.screen) })
  }
  const top = Math.min(...hull.map(({ screen }) => screen.y))
  points.set('rotate', {
    screen: new THREE.Vector2(centerScreen.x, Math.max(14, top - 24)),
    anchor: center,
    outward: new THREE.Vector2(),
  })
  return { points, center: centerScreen, baseSize: bounds.getSize(new THREE.Vector3()) }
}
