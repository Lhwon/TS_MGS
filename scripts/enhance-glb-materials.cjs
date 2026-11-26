/**
 * 삼차원 모델의 내장 표면 맵과 재질을 보강하고 프로젝트 참조를 안전하게 갱신
 */
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { deflateSync } = require('node:zlib')
const assert = require('node:assert/strict')
const { openMapScene, saveMapScene, createSceneAccess } = require('../packages/map3d/localFiles.cjs')
const { loadSource } = require('./load-source.cjs')
const { parseFacilitySceneFile } = loadSource('packages/map3d/index.ts')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** 표준 PNG 청크의 무결성 검사값 계산 */
const crc = (bytes) => {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}

/** 외부 라이브러리 없이 작은 무손실 표면 텍스처 생성 */
const png = (pixels, size) => {
  const chunk = (name, data) => {
    const type = Buffer.from(name)
    const result = Buffer.alloc(data.length + 12)
    result.writeUInt32BE(data.length)
    type.copy(result, 4)
    data.copy(result, 8)
    result.writeUInt32BE(crc(Buffer.concat([type, data])), data.length + 8)
    return result
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  const rows = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

/** 재질 이름과 기존 금속성으로 표면의 물리적 특성 분류 */
const surface = (material) => {
  const name = (material.name ?? '').toLowerCase()
  if (material.alphaMode === 'BLEND' || /glass|glazing|lens|screen|lcd|display|label|print|pictogram|letter|recess|shadow|rubber|tread|tire|tape/.test(name))
    return undefined
  if (material.emissiveFactor?.some((value) => value > 0)) return undefined
  if (/paper|carton|cardboard/.test(name)) return { kind: 'paper', min: 0.82, max: 1, bump: 0.13 }
  if (/wood|oak|plywood|shelf_board/.test(name)) return { kind: 'wood', min: 0.48, max: 0.85, bump: 0.14 }
  if (/powder|coat|rackupright|rackframe|rackbeam|rackfoot|white_metal/.test(name))
    return { kind: 'paint', min: 0.36, max: 0.62, bump: 0.09 }
  if (/steel|alumin|metal|zinc|hardware|fastener|bracket|rackdeck/.test(name) ||
      (material.pbrMetallicRoughness?.metallicFactor ?? 0) >= 0.55)
    return { kind: 'metal', min: 0.22, max: 0.46, bump: 0.11 }
  if (/plastic|polymer|polyprop|mould|mold|pearl|cream|ivory|trim|crate/.test(name) ||
      (material.pbrMetallicRoughness?.metallicFactor ?? 0) < 0.2)
    return { kind: 'plastic', min: 0.29, max: 0.72, bump: 0.07 }
  return { kind: 'paint', min: 0.36, max: 0.65, bump: 0.09 }
}

/** 시점 변화에 따라 미세하게 반응하는 반복 가능한 요철과 거칠기 생성 */
const surfaceMaps = (profile) => {
  const size = 128
  const heights = new Float32Array(size * size)
  let seed = 12371
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const noise = seed / 0xffffffff
      const grain = profile.kind === 'metal' ? Math.sin(y * Math.PI / 2) * 0.38
        : profile.kind === 'wood' ? Math.sin(x * Math.PI / 8 + Math.sin(y * Math.PI / 64) * 0.7) * 0.3 : 0
      heights[y * size + x] = noise * (profile.kind === 'metal' ? 0.12 : 0.65) + grain
    }
  }
  const normal = Buffer.alloc(size * size * 3)
  const roughness = Buffer.alloc(size * size * 3)
  const at = (x, y) => heights[((y + size) % size) * size + (x + size) % size]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 3
      const dx = (at(x + 1, y) - at(x - 1, y)) * profile.bump
      const dy = (at(x, y + 1) - at(x, y - 1)) * profile.bump
      const length = Math.hypot(dx, dy, 1)
      normal[index] = Math.round((0.5 - dx / length * 0.5) * 255)
      normal[index + 1] = Math.round((0.5 - dy / length * 0.5) * 255)
      normal[index + 2] = Math.round((0.5 + 0.5 / length) * 255)
      roughness[index] = 255
      roughness[index + 1] = Math.round(235 + Math.max(-1, Math.min(1, heights[y * size + x])) * 18)
      roughness[index + 2] = 255
    }
  }
  return { normal: png(normal, size), roughness: png(roughness, size) }
}

/** 원본 버퍼와 형상을 보존하며 부족한 텍스처 좌표와 표면 맵 추가 */
const enhanceGlb = (bytes) => {
  const jsonLength = bytes.readUInt32LE(12)
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength))
  if (document.extras?.bemSurfaceQuality === 1) return bytes
  const binaryOffset = 20 + jsonLength
  assert.equal(bytes.readUInt32LE(binaryOffset + 4), 0x004e4942)
  let binary = bytes.subarray(binaryOffset + 8, binaryOffset + 8 + document.buffers[0].byteLength)
  const append = (data) => {
    const padding = Buffer.alloc((4 - binary.length % 4) % 4)
    const offset = binary.length + padding.length
    binary = Buffer.concat([binary, padding, data])
    document.bufferViews ??= []
    return document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length }) - 1
  }
  const textures = new Map()
  let defaultMaterial
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      if (primitive.material !== undefined) continue
      document.materials ??= []
      defaultMaterial ??= document.materials.push({
        name: 'Factory painted equipment',
        pbrMetallicRoughness: { metallicFactor: 0.15, roughnessFactor: 0.52 },
      }) - 1
      primitive.material = defaultMaterial
    }
  }
  const profiles = new Map((document.materials ?? []).map((material, index) => [
    index, material.normalTexture || material.pbrMetallicRoughness?.metallicRoughnessTexture ? undefined : surface(material),
  ]))
  const addTexture = (data) => {
    document.samplers ??= []
    let sampler = document.samplers.findIndex((value) => value.wrapS === 10497 && value.wrapT === 10497)
    if (sampler < 0) sampler = document.samplers.push({ wrapS: 10497, wrapT: 10497, magFilter: 9729, minFilter: 9987 }) - 1
    document.images ??= []
    document.textures ??= []
    const source = document.images.push({ bufferView: append(data), mimeType: 'image/png' }) - 1
    return document.textures.push({ source, sampler }) - 1
  }
  const readVector = (accessorIndex, index) => {
    const accessor = document.accessors[accessorIndex]
    const componentSize = { 5126: 4, 5120: 1, 5122: 2 }[accessor.componentType]
    assert(componentSize, '지원하지 않는 표면 벡터 형식')
    const view = document.bufferViews[accessor.bufferView]
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + index * (view.byteStride ?? componentSize * 3)
    return [0, 1, 2].map((axis) => {
      const location = offset + axis * componentSize
      if (accessor.componentType === 5126) return binary.readFloatLE(location)
      const value = componentSize === 1 ? binary.readInt8(location) : binary.readInt16LE(location)
      return accessor.normalized ? Math.max(-1, value / (componentSize === 1 ? 127 : 32767)) : value
    })
  }
  let changed = false
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const material = document.materials?.[primitive.material]
      if (!material) continue
      const profile = profiles.get(primitive.material)
      if (!profile) continue
      if (primitive.attributes.TEXCOORD_0 === undefined) {
        const position = document.accessors[primitive.attributes.POSITION]
        if (position.componentType !== 5126 || primitive.attributes.NORMAL === undefined) continue
        const coordinates = Buffer.alloc(position.count * 8)
        const extent = Math.max(...position.max.map((value, axis) => value - position.min[axis]), 0.01)
        const repeat = Math.max(1, Math.min(24, extent * 12)) / extent
        for (let index = 0; index < position.count; index++) {
          const point = readVector(primitive.attributes.POSITION, index)
          const normal = readVector(primitive.attributes.NORMAL, index).map(Math.abs)
          const axis = normal.indexOf(Math.max(...normal))
          const axes = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
          coordinates.writeFloatLE(point[axes[0]] * repeat, index * 8)
          coordinates.writeFloatLE(point[axes[1]] * repeat, index * 8 + 4)
        }
        primitive.attributes.TEXCOORD_0 = document.accessors.push({
          bufferView: append(coordinates), componentType: 5126, count: position.count, type: 'VEC2',
        }) - 1
      }
      let maps = textures.get(profile.kind)
      if (!maps) {
        const data = surfaceMaps(profile)
        maps = { normal: addTexture(data.normal), roughness: addTexture(data.roughness) }
        textures.set(profile.kind, maps)
      }
      material.normalTexture = { index: maps.normal, scale: 1 }
      const pbr = material.pbrMetallicRoughness ??= {}
      pbr.roughnessFactor = Math.max(profile.min, Math.min(profile.max, pbr.roughnessFactor ?? 0.55))
      pbr.metallicRoughnessTexture = { index: maps.roughness }
      if (profile.kind === 'paint' || profile.kind === 'plastic') {
        material.extensions ??= {}
        material.extensions.KHR_materials_clearcoat ??= { clearcoatFactor: 0.12, clearcoatRoughnessFactor: 0.38 }
        document.extensionsUsed = [...new Set([...(document.extensionsUsed ?? []), 'KHR_materials_clearcoat'])]
      }
      changed = true
    }
  }
  if (!changed) return bytes
  document.extras = { ...document.extras, bemSurfaceQuality: 1 }
  document.buffers[0].byteLength = binary.length
  let json = Buffer.from(JSON.stringify(document))
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)])
  binary = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)])
  const output = Buffer.alloc(28 + json.length + binary.length)
  output.writeUInt32LE(0x46546c67)
  output.writeUInt32LE(2, 4)
  output.writeUInt32LE(output.length, 8)
  output.writeUInt32LE(json.length, 12)
  output.writeUInt32LE(0x4e4f534a, 16)
  json.copy(output, 20)
  output.writeUInt32LE(binary.length, 20 + json.length)
  output.writeUInt32LE(0x004e4942, 24 + json.length)
  binary.copy(output, 28 + json.length)
  return output
}

/** 원본 설계 백업과 참조 갱신을 포함한 품질 보강 실행 */
const main = async (mapDirectory) => {
  if (!mapDirectory) throw new Error('MAP 폴더 경로가 필요합니다.')
  const scene = await openMapScene(path.resolve(mapDirectory), true)
  const original = scene.payload.content
  const document = parseFacilitySceneFile(scene.payload)
  const access = createSceneAccess()
  const permission = access.register(scene)
  const replacements = new Map()
  let beforeBytes = 0
  let afterBytes = 0
  let changed = 0
  const seen = new Map()
  for (const asset of document.assets) {
    if (!asset.glb) continue
    const previous = asset.glb
    let replacement = seen.get(previous.hash)
    if (!replacement) {
      const bytes = await access.read(previous, permission.grant)
      const enhanced = enhanceGlb(bytes)
      replacement = { uri: 'models/' + hash(enhanced) + '.glb', hash: hash(enhanced) }
      seen.set(previous.hash, replacement)
      replacements.set(replacement.hash, enhanced)
      beforeBytes += bytes.length
      afterBytes += enhanced.length
      if (replacement.hash !== previous.hash) changed++
    }
    asset.glb = { ...asset.glb, ...replacement }
  }
  const target = path.join(scene.root, scene.payload.name)
  if (!changed) {
    console.log(JSON.stringify({ changed, beforeBytes, afterBytes, instances: document.instances.length }))
    return
  }
  assert.equal(await fs.readFile(target, 'utf8'), original, '작업 도중 원본 설계 변경 감지')
  const backup = target + '.quality-' + randomUUID() + '.bak'
  await fs.writeFile(backup, original, { flag: 'wx', flush: true })
  const resolver = async (reference, image) => replacements.get(reference.hash) ?? access.readEditor(reference, image)
  const { scene: saved } = await saveMapScene(mapDirectory, scene.payload.name, JSON.stringify(document), resolver)
  const restored = parseFacilitySceneFile(saved.payload)
  assert.deepEqual(restored.instances, document.instances)
  assert.equal(restored.assets.length, document.assets.length)
  console.log(JSON.stringify({ changed, beforeBytes, afterBytes, instances: restored.instances.length, backup }))
}
module.exports = { enhanceGlb }
if (require.main === module) main(process.argv[2]).catch((error) => { console.error(error); process.exitCode = 1 })

