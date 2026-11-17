const assert = require('node:assert/strict')
const fs = require('node:fs')
const THREE = require('three')
const { loadSource } = require('./load-source.cjs')
const { decodeEmbeddedGlb } = loadSource('packages/map3d/index.ts')
const catalog = JSON.parse(
  fs.readFileSync('src/entities/facility/ceram-mp5.equipment.json', 'utf8'),
)
/** 생성 모델의 실제 바이너리와 형상 및 재질 계약 조회 */
const model = (id) => {
  const asset = catalog.assets.find((item) => item.id === `ceram-mp5-${id}`)
  const buffer = Buffer.from(decodeEmbeddedGlb(asset.glb.data))
  const length = buffer.readUInt32LE(12)
  const data = JSON.parse(buffer.subarray(20, 20 + length).toString())
  return { asset, buffer, data, binary: 20 + length + 8 }
}
const single = model('wooden-crate')
const stack = model('wooden-crate-stack')
assert.deepEqual(single.asset.glb.size, { x: 1800, y: 1016, z: 500 })
assert.deepEqual(stack.asset.glb.size, { ...single.asset.glb.size, z: 1000 })
assert.equal(single.data.meshes.length, 4)
assert.ok(stack.data.nodes.some((node) => node.name === 'cargo-lower'))
const upper = stack.data.nodes.find((node) => node.name === 'cargo-upper')
assert.equal(upper.matrix?.[13] ?? upper.translation?.[1], 0.5)
/** 저장된 GLB의 실제 정점 경계와 노드 변환으로 외곽 치수 확인 */
const nativeBounds = (data) => {
  const bounds = new THREE.Box3()
  /** 원본 장면 계층의 실제 형상 경계 누적 */
  const visit = (index, parent) => {
    const node = data.nodes[index]
    const local = node.matrix
      ? new THREE.Matrix4().fromArray(node.matrix)
      : new THREE.Matrix4().compose(
          new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
          new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
          new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
        )
    const world = parent.clone().multiply(local)
    if (node.mesh !== undefined)
      for (const primitive of data.meshes[node.mesh].primitives) {
        const position = data.accessors[primitive.attributes.POSITION]
        bounds.union(
          new THREE.Box3(
            new THREE.Vector3().fromArray(position.min),
            new THREE.Vector3().fromArray(position.max),
          ).applyMatrix4(world),
        )
      }
    for (const child of node.children ?? []) visit(child, world)
  }
  for (const index of data.scenes[data.scene ?? 0].nodes) visit(index, new THREE.Matrix4())
  return bounds.getSize(new THREE.Vector3())
}
for (const item of [single, stack]) {
  const size = nativeBounds(item.data)
  assert.ok(Math.abs(size.x * 1000 - item.asset.glb.size.x) < 0.01)
  assert.ok(Math.abs(size.z * 1000 - item.asset.glb.size.y) < 0.01)
  assert.ok(Math.abs(size.y * 1000 - item.asset.glb.size.z) < 0.01)
  assert.deepEqual(
    item.buffer,
    fs.readFileSync(`public/models/ceram-mp5/${item.asset.glb.sourceName}`),
  )
  assert.equal(item.data.images.length, 1)
  const view = item.data.bufferViews[item.data.images[0].bufferView]
  assert.deepEqual(
    [...item.buffer.subarray(item.binary + view.byteOffset, item.binary + view.byteOffset + 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  )
  const wood = item.data.materials.filter((material) => material.name.startsWith('wood'))
  assert.equal(wood.length, 3)
  assert.ok(
    wood.every(
      (material) =>
        material.pbrMetallicRoughness.metallicFactor === 0 &&
        material.pbrMetallicRoughness.baseColorTexture.index === 0,
    ),
  )
  assert.ok(
    item.data.meshes.every((mesh) =>
      mesh.primitives.every((primitive) => primitive.attributes.TEXCOORD_0 !== undefined),
    ),
  )
}
/** 서로 다른 재질의 동일 방향 평면 겹침 검사 */
const overlappingSurfaces = (item) => {
  const faces = []
  for (const mesh of item.data.meshes)
    for (const primitive of mesh.primitives) {
      const accessor = item.data.accessors[primitive.attributes.POSITION]
      const view = item.data.bufferViews[accessor.bufferView]
      const normalAccessor = item.data.accessors[primitive.attributes.NORMAL]
      const normalView = item.data.bufferViews[normalAccessor.bufferView]
      for (let start = 0; start < accessor.count; start += 4) {
        const positions = Array.from({ length: 4 }, (_, vertex) =>
          Array.from({ length: 3 }, (_, axis) =>
            item.buffer.readFloatLE(
              item.binary +
                (view.byteOffset ?? 0) +
                (accessor.byteOffset ?? 0) +
                (start + vertex) * (view.byteStride ?? 12) +
                axis * 4,
            ),
          ),
        )
        const normal = Array.from({ length: 3 }, (_, axis) =>
          item.buffer.readFloatLE(
            item.binary +
              (normalView.byteOffset ?? 0) +
              (normalAccessor.byteOffset ?? 0) +
              start * (normalView.byteStride ?? 12) +
              axis * 4,
          ),
        )
        const axis = normal.findIndex((value) => Math.abs(value) > 0.99)
        if (axis < 0) continue
        faces.push({
          material: primitive.material,
          axis,
          sign: Math.sign(normal[axis]),
          plane: positions[0][axis],
          min: [0, 1, 2].map((a) => Math.min(...positions.map((p) => p[a]))),
          max: [0, 1, 2].map((a) => Math.max(...positions.map((p) => p[a]))),
        })
      }
    }
  return faces.flatMap((a, index) =>
    faces
      .slice(index + 1)
      .filter(
        (b) =>
          a.material !== b.material &&
          a.axis === b.axis &&
          a.sign === b.sign &&
          Math.abs(a.plane - b.plane) < 1e-7 &&
          [0, 1, 2]
            .filter((axis) => axis !== a.axis)
            .every(
              (axis) =>
                Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) > 1e-6,
            ),
      ),
  )
}
assert.equal(
  overlappingSurfaces(single).length,
  0,
  'Carrier surfaces must not compete for the same depth plane',
)
const center = model('centering-station')
assert.equal(
  center.data.nodes.filter((node) => /^centering-jaw-\d-(left|right)$/.test(node.name)).length,
  4,
)
assert.ok(center.asset.glb.size.z > stack.asset.glb.size.z + 400)
assert.ok(center.data.meshes.length < 40)
const conveyor = model('double-deck-conveyor')
assert.ok(conveyor.asset.glb.size.x > conveyor.asset.glb.size.y * 3)
assert.equal(conveyor.data.nodes.filter((node) => /^conveyor-level-\d$/.test(node.name)).length, 2)
assert.ok(conveyor.data.meshes.length <= 20)
/** 설비 그룹의 실제 정점과 재질별 표면 조회 */
const groupSurfaces = (item, name) => {
  const node = item.data.nodes.find((entry) => entry.name === name)
  return node.children.flatMap((index) =>
    item.data.meshes[item.data.nodes[index].mesh].primitives.map((primitive) => ({
      material: item.data.materials[primitive.material],
      position: item.data.accessors[primitive.attributes.POSITION],
    })),
  )
}
const frameSurfaces = groupSurfaces(center, 'centering-frame')
assert.ok(frameSurfaces.some((surface) => surface.material.name === 'machineGray'))
assert.ok(!center.data.materials.some((material) => material.name === 'machineFrame'))
for (const surface of frameSurfaces.filter((surface) => surface.material.name === 'machineGray')) {
  const accessor = surface.position
  const view = center.data.bufferViews[accessor.bufferView]
  for (let index = 0; index < accessor.count; index++) {
    const offset =
      center.binary +
      (view.byteOffset ?? 0) +
      (accessor.byteOffset ?? 0) +
      index * (view.byteStride ?? 12)
    const x = center.buffer.readFloatLE(offset),
      y = center.buffer.readFloatLE(offset + 4),
      z = center.buffer.readFloatLE(offset + 8)
    assert.ok(!(Math.abs(x) < 1 && y > 2.65 && z > 0.65), 'Front upper entry must remain open')
  }
}
for (const [name, height] of [
  ['conveyor-level-1', 436],
  ['conveyor-level-2', 3035],
]) {
  const rollers = groupSurfaces(conveyor, name).filter(
    (surface) => surface.material.pbrMetallicRoughness.metallicFactor === 0.7,
  )
  assert.equal(
    Math.round(Math.max(...rollers.map((surface) => surface.position.max[1])) * 1000),
    height,
  )
}
const closed = model('quick-shutter-closed')
const open = model('quick-shutter-open')
assert.deepEqual(closed.asset.glb.size, open.asset.glb.size)
assert.equal(closed.asset.glb.size.x, 4100)
assert.equal(closed.asset.glb.size.z, 4250)
/** 독립 셔터 커튼의 실제 형상에서 가장 낮은 높이 조회 */
const curtainBottom = (item) => {
  const curtain = item.data.nodes.find((node) => node.name === 'quick-shutter-curtain')
  return Math.min(
    ...curtain.children.flatMap((index) =>
      item.data.meshes[item.data.nodes[index].mesh].primitives.map(
        (primitive) => item.data.accessors[primitive.attributes.POSITION].min[1],
      ),
    ),
  )
}
assert.equal(curtainBottom(closed), 0)
assert.ok(curtainBottom(open) > 3.7)
assert.ok(
  closed.data.materials.some(
    (material) => material.name === 'shutterWindow' && material.alphaMode === 'BLEND',
  ),
)
assert.ok(open.data.meshes.length < 20 && closed.data.meshes.length < 20)
console.log(
  'Handling models: portable wood texture, two aligned cargo units, independent centering jaws and compact two-level conveyor passed',
)

