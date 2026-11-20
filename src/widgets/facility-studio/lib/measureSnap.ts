/**
 * 파일명: measureSnap.ts
 * 설명: 줄자 포인터 가까이의 삼차원 객체 가장자리와 꼭짓점에 측정 위치 보정
 * 작성자: 이희원
 * 작성일자: 2026-11-20
 */
import * as THREE from 'three'

const edgeCache = new WeakMap<THREE.BufferGeometry, Set<string>>()
const snapRadius = 12

export interface MeasurementSnap {
  point: THREE.Vector3
  edge?: readonly [THREE.Vector3, THREE.Vector3]
}

/** 같은 위치의 정점과 방향이 반대인 선분을 동일한 키로 변환 */
const vertexKey = ({ x, y, z }: THREE.Vector3) =>
  [x, y, z].map((value) => Math.round(value * 10_000)).join(',')

/** 선분을 구성하는 두 정점의 방향과 무관한 키 생성 */
const edgeKey = (a: THREE.Vector3, b: THREE.Vector3) =>
  [vertexKey(a), vertexKey(b)].sort().join(':')

/** 평면을 분할한 대각선을 제외하고 실제 외곽과 각진 접합부만 캐시 */
const hardEdges = (geometry: THREE.BufferGeometry) => {
  const cached = edgeCache.get(geometry)
  if (cached) return cached
  const edges = new THREE.EdgesGeometry(geometry, 25)
  const positions = edges.getAttribute('position')
  const keys = new Set<string>()
  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  for (let i = 0; i < positions.count; i += 2) {
    start.fromBufferAttribute(positions, i)
    end.fromBufferAttribute(positions, i + 1)
    keys.add(edgeKey(start, end))
  }
  edges.dispose()
  edgeCache.set(geometry, keys)
  return keys
}

/** 클릭한 면의 실제 가장자리 또는 꼭짓점 중 화면에서 가장 가까운 위치 탐색 */
export const snapMeasureHit = (
  hit: THREE.Intersection,
  camera: THREE.PerspectiveCamera,
  viewport: DOMRect,
  cursor: THREE.Vector2,
  vertexOnly: boolean,
): MeasurementSnap | undefined => {
  const mesh = hit.object as THREE.InstancedMesh
  if (!hit.face || hit.instanceId === undefined) return
  const positions = mesh.geometry.getAttribute('position')
  const matrix = new THREE.Matrix4()
  mesh.getMatrixAt(hit.instanceId, matrix)
  matrix.premultiply(mesh.matrixWorld)
  const cursorPixels = new THREE.Vector2(cursor.x * viewport.width / 2, cursor.y * viewport.height / 2)
  const vertices = [hit.face.a, hit.face.b, hit.face.c].map((index) => {
    const local = new THREE.Vector3().fromBufferAttribute(positions, index)
    const world = local.clone().applyMatrix4(matrix)
    const depth = -world.clone().applyMatrix4(camera.matrixWorldInverse).z
    const projected = world.clone().project(camera)
    const pixels = new THREE.Vector2(projected.x * viewport.width / 2, projected.y * viewport.height / 2)
    return { local, world, depth, pixels }
  })
  let nearest: THREE.Vector3 | undefined
  let distance = snapRadius ** 2
  if (vertexOnly) {
    for (const vertex of vertices) {
      if (vertex.depth <= camera.near) continue
      const squared = cursorPixels.distanceToSquared(vertex.pixels)
      if (squared >= distance) continue
      distance = squared
      nearest = vertex.world
    }
    return nearest ? { point: nearest } : undefined
  }
  const edges = hardEdges(mesh.geometry)
  let result: MeasurementSnap | undefined
  for (const [index, a] of vertices.entries()) {
    const b = vertices[(index + 1) % vertices.length]!
    if (a.depth <= camera.near || b.depth <= camera.near || !edges.has(edgeKey(a.local, b.local))) continue
    const segment = b.pixels.clone().sub(a.pixels)
    const length = segment.lengthSq()
    if (!length) continue
    const fromStart = cursorPixels.clone().sub(a.pixels)
    const t = THREE.MathUtils.clamp(fromStart.dot(segment) / length, 0, 1)
    const squared = fromStart.distanceToSquared(segment.multiplyScalar(t))
    if (squared >= distance) continue
    distance = squared
    // 화면에서 구한 분할 비율을 원근 투영 이전의 선분 거리 비율로 보정
    const worldT = (t * a.depth) / ((1 - t) * b.depth + t * a.depth)
    result = { point: a.world.clone().lerp(b.world, worldT), edge: [a.world, b.world] }
  }
  return result
}
