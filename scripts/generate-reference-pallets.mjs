/**
 * 현장 사진을 참고한 단품 플라스틱 파렛트의 형상과 내장 재질 생성
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { deflateSync } from 'node:zlib'
import fs from 'node:fs/promises'
import path from 'node:path'

/** 브라우저 파일 읽기 인터페이스의 바이너리 내보내기 어댑터 구성 */
class ExportReader {
  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((value) => {
      this.result = value
      this.onloadend?.()
    })
  }
  readAsDataURL(blob) {
    void blob.arrayBuffer().then((value) => {
      this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`
      this.onloadend?.()
    })
  }
}
globalThis.FileReader = ExportReader

const output = path.resolve('public/models/pallets')
await fs.mkdir(output, { recursive: true })
const parts = new Map()
const blue = new THREE.MeshPhysicalMaterial({
  name: 'Molded_HDPE',
  color: '#172d70',
  metalness: 0,
  roughness: 0.37,
  clearcoat: 0.16,
  clearcoatRoughness: 0.38,
  ior: 1.46,
})
const rubber = new THREE.MeshStandardMaterial({
  name: 'Antislip_Rubber',
  color: '#272b2c',
  roughness: 0.86,
  metalness: 0,
})

/** 사출 금형의 부드러운 모서리를 재현하는 둥근 윤곽 구성 */
const rounded = (x, y, width, height, radius, Constructor = THREE.Path) => {
  const p = new Constructor(),
    l = x - width / 2,
    r = x + width / 2,
    b = y - height / 2,
    t = y + height / 2,
    a = Math.min(radius, width / 2, height / 2)
  if (a >= 0.008) {
    for (const [cx, cy, start] of [
      [r - a, b + a, -Math.PI / 2],
      [r - a, t - a, 0],
      [l + a, t - a, Math.PI / 2],
      [l + a, b + a, Math.PI],
    ]) {
      for (let step = 0; step <= 8; step++) {
        const angle = start + (step * Math.PI) / 16,
          px = cx + Math.cos(angle) * a,
          py = cy + Math.sin(angle) * a
        if (!p.curves.length && step === 0 && start === -Math.PI / 2) p.moveTo(px, py)
        else p.lineTo(px, py)
      }
    }
    p.closePath()
    return p
  }
  p.moveTo(l + a, b)
  p.lineTo(r - a, b)
  p.quadraticCurveTo(r, b, r, b + a)
  p.lineTo(r, t - a)
  p.quadraticCurveTo(r, t, r - a, t)
  p.lineTo(l + a, t)
  p.quadraticCurveTo(l, t, l, t - a)
  p.lineTo(l, b + a)
  p.quadraticCurveTo(l, b, l + a, b)
  p.closePath()
  return p
}

/** 동일 재질의 형상 병합을 위한 모델 좌표 변환 적용 */
const add = (geometry, material = blue, matrix = new THREE.Matrix4()) => {
  if (geometry.index) {
    const expanded = geometry.toNonIndexed()
    geometry.dispose()
    geometry = expanded
  }
  geometry.applyMatrix4(matrix)
  const geometries = parts.get(material) ?? []
  geometries.push(geometry)
  parts.set(material, geometries)
}

/** 조명 반사를 표현하는 성형 모서리의 미세한 모따기 적용 */
const extrude = (shape, depth, bevel = 0.0013) =>
  new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 2,
  }).translate(0, 0, bevel)

/** 내부 보강 기둥과 리브의 둥근 입체 형상 구성 */
const block = (x, y, z, w, d, h, radius = 0.003) => {
  add(new RoundedBoxGeometry(w, d, h, 1, radius).translate(x, y, z))
}

/** 배수 구멍과 미끄럼 방지 패드를 포함한 격자 데크 구성 */
const deck = (bottom, underside = false) => {
  const shape = rounded(0, 0, 1.097, 1.097, 0.039, THREE.Shape)
  const pitch = 0.033,
    rows = underside ? 32 : 44,
    pitchY = 1.056 / rows,
    pad = [-0.462, 0, 0.462]
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < 32; column++) {
      const x = (column - 15.5) * pitch,
        y = (row - (rows - 1) / 2) * pitchY
      if (pad.some((px) => Math.abs(x - px) < 0.059) && pad.some((py) => Math.abs(y - py) < 0.059))
        continue
      if (Math.abs(x) > 0.49 && Math.abs(y) > 0.49) continue
      shape.holes.push(rounded(x, y, pitch - 0.0047, pitchY - 0.0047, 0.0019))
    }
  for (const x of pad)
    for (const y of pad) {
      const hole = new THREE.Path()
      for (let i = 0; i <= 32; i++) {
        const angle = (i * Math.PI) / 16,
          px = x + Math.cos(angle) * 0.0186,
          py = y + Math.sin(angle) * 0.0186
        if (i === 0) hole.moveTo(px, py)
        else hole.lineTo(px, py)
      }
      hole.closePath()
      shape.holes.push(hole)
      const z = underside ? 0.0014 : 0.1486
      const disk = new THREE.CylinderGeometry(0.0183, 0.0183, 0.003, 32)
        .rotateX(Math.PI / 2)
        .translate(x, y, z)
      add(disk, rubber)
      for (const radius of [0.0095, 0.0147]) {
        add(
          new THREE.TorusGeometry(radius, 0.00042, 4, 32).translate(
            x,
            y,
            z + (underside ? -0.0016 : 0.0016),
          ),
          rubber,
        )
      }
      for (const sx of [-1, 1])
        for (const sy of [-1, 1]) {
          shape.holes.push(rounded(x + sx * 0.035, y + sy * 0.035, 0.018, 0.018, 0.004))
        }
    }
  add(extrude(shape, 0.017, 0.0012).translate(0, 0, bottom))
}
deck(0.133)
deck(0, true)

/** 데크 외곽의 충격 방지 테두리와 성형 이음선 구성 */
for (const z of [0.001, 0.136]) {
  const rim = rounded(0, 0, 1.095, 1.095, 0.04, THREE.Shape)
  rim.holes.push(rounded(0, 0, 1.073, 1.073, 0.029))
  add(extrude(rim, 0.013, 0.0018).translate(0, 0, z))
}

/** 포크 통로를 확보하는 중공 지지 기둥과 하중 분산 리브 구성 */
for (const x of [-0.462, 0, 0.462])
  for (const y of [-0.462, 0, 0.462]) {
    const shell = rounded(x, y, 0.143, 0.143, 0.021, THREE.Shape)
    shell.holes.push(rounded(x, y, 0.127, 0.127, 0.014))
    add(extrude(shell, 0.12, 0.0014).translate(0, 0, 0.015))
    for (const offset of [-0.035, 0.035]) {
      block(x + offset, y, 0.031, 0.004, 0.121, 0.029, 0.001)
      block(x, y + offset, 0.119, 0.121, 0.004, 0.029, 0.001)
    }
  }

/** 측면의 둥근 포크 삽입구와 작은 배수 구멍 구성 */
for (let side = 0; side < 4; side++) {
  const face = rounded(0, 0.075, 1.0, 0.122, 0.0001, THREE.Shape)
  for (const center of [-0.256, 0.256]) {
    face.holes.push(rounded(center, 0.075, 0.333, 0.094, 0.022))
    for (let i = -5; i <= 5; i++) {
      const hole = new THREE.Path()
      hole.absarc(center + i * 0.025, 0.022, 0.0022, 0, Math.PI * 2)
      face.holes.push(hole)
    }
  }
  const sideMatrix = new THREE.Matrix4().makeRotationX(Math.PI / 2)
  sideMatrix.setPosition(0, -0.537, 0)
  sideMatrix.premultiply(new THREE.Matrix4().makeRotationZ((side * Math.PI) / 2))
  add(extrude(face, 0.006, 0.0015), blue, sideMatrix)
  for (const center of [-0.256, 0.256]) {
    const positions = [],
      indices = [],
      uv = [],
      rings = []
    for (const [depth, width, height, radius] of [
      [0.004, 0.335, 0.096, 0.023],
      [-0.003, 0.328, 0.089, 0.021],
      [-0.019, 0.309, 0.081, 0.019],
    ]) {
      const points = rounded(center, 0.075, width, height, radius).getPoints(1)
      rings.push(points)
      for (const point of points) {
        positions.push(point.x, point.y, depth)
        uv.push(point.x * 12, point.y * 12)
      }
    }
    const count = rings[0].length
    for (let row = 0; row < rings.length - 1; row++)
      for (let i = 0; i < count - 1; i++) {
        const a = row * count + i,
          b = a + count
        indices.push(a, a + 1, b, b, a + 1, b + 1)
      }
    const mouth = new THREE.BufferGeometry()
    mouth.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    mouth.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    mouth.setIndex(indices)
    mouth.computeVertexNormals()
    add(mouth, blue, sideMatrix)
  }
}

/** 측면과 연속되는 둥근 외곽 모서리의 중공 벽체 구성 */
for (let corner = 0; corner < 4; corner++) {
  const shape = new THREE.Shape()
  shape.absarc(0.5, 0.5, 0.043, 0, Math.PI / 2, false)
  shape.lineTo(0.5, 0.537)
  shape.absarc(0.5, 0.5, 0.037, Math.PI / 2, 0, true)
  shape.closePath()
  const geometry = extrude(shape, 0.122, 0.0005)
    .translate(0, 0, 0.014)
    .rotateZ((corner * Math.PI) / 2)
  add(geometry)
}

/** 표면 요철의 일정한 밀도를 유지하는 박스 투영과 메시 병합 적용 */
const compact = () => {
  const root = new THREE.Group()
  root.name = 'Single_Plastic_Pallet_1100x1100x150'
  root.userData = {
    units: 'm',
    quantity: 1,
    reference: 'IMG_2401 IMG_2402 IMG_2403 IMG_2404',
    dimensionsEstimated: true,
  }
  for (const [material, geometries] of parts) {
    const merged = mergeGeometries(geometries)
    geometries.forEach((geometry) => geometry.dispose())
    const p = merged.attributes.position,
      n = merged.attributes.normal,
      uv = merged.attributes.uv
    for (let i = 0; i < p.count; i++) {
      const nx = Math.abs(n.getX(i)),
        ny = Math.abs(n.getY(i)),
        nz = Math.abs(n.getZ(i))
      uv.setXY(
        i,
        (nz > nx && nz > ny ? p.getX(i) : ny > nx ? p.getX(i) : p.getY(i)) * 12,
        (nz > nx && nz > ny ? p.getY(i) : p.getZ(i)) * 12,
      )
    }
    merged.deleteAttribute('normal')
    const geometry = mergeVertices(merged, 0.000001)
    geometry.computeVertexNormals()
    merged.dispose()
    geometry.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = material.name
    root.add(mesh)
  }
  const bounds = new THREE.Box3().setFromObject(root),
    size = bounds.getSize(new THREE.Vector3())
  for (const mesh of root.children) {
    mesh.geometry.translate(
      -(bounds.min.x + bounds.max.x) / 2,
      -bounds.min.y,
      -(bounds.min.z + bounds.max.z) / 2,
    )
    mesh.geometry.scale(1.1 / size.x, 0.15 / size.y, 1.1 / size.z)
  }
  return root
}

/** 내장 이미지 데이터의 체크섬 생성 */
const crc = (bytes) => {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}

/** 외부 파일 참조 없이 사용할 수 있는 표면 이미지 생성 */
const png = (width, pixel) => {
  const chunk = (type, data) => {
    const content = Buffer.concat([Buffer.from(type), data]),
      result = Buffer.alloc(data.length + 12)
    result.writeUInt32BE(data.length)
    content.copy(result, 4)
    result.writeUInt32BE(crc(content), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(width, 4)
  header[8] = 8
  header[9] = 2
  const rows = Buffer.alloc(width * (width * 3 + 1))
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      const at = y * (width * 3 + 1) + x * 3 + 1
      const color = pixel(x, y)
      for (let c = 0; c < 3; c++) rows[at + c] = Math.max(0, Math.min(255, Math.round(color[c])))
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 사출 플라스틱의 미세한 거칠기와 마모를 재현하는 내장 재질 구성 */
const textures = (buffer) => {
  const length = buffer.readUInt32LE(12),
    json = JSON.parse(buffer.subarray(20, 20 + length))
  const raw = buffer.subarray(28 + length, 28 + length + json.buffers[0].byteLength)
  const segments = [raw]
  let offset = raw.length
  const noise = (x, y) => {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
    return h - Math.floor(h)
  }
  const height = (x, y) =>
    noise((x + 512) % 512, (y + 512) % 512) * 0.6 + Math.sin(x * 0.11 + Math.sin(y * 0.07)) * 0.13
  const maps = [
    png(512, (x, y) => [
      128 + (height(x - 1, y) - height(x + 1, y)) * 14,
      128 + (height(x, y - 1) - height(x, y + 1)) * 14,
      255,
    ]),
    png(512, (x, y) => {
      const scratch =
        Math.pow(Math.max(0, Math.sin(x * 0.032 + y * 0.41)), 80) *
        (noise(x >> 3, y >> 3) > 0.8 ? 18 : 0)
      return [255, 230 + noise(x, y) * 15 + scratch, 0]
    }),
    png(512, (x, y) => {
      const grain = noise(x, y) * 4,
        scuff =
          Math.pow(Math.max(0, Math.sin(x * 0.011 + y * 0.23)), 48) *
          (noise(x >> 4, y >> 4) > 0.85 ? 4 : 0)
      return [249 + grain + scuff, 249 + grain + scuff, 249 + grain + scuff]
    }),
  ]
  json.images = []
  json.textures = []
  json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]
  for (const bytes of maps) {
    const padding = Buffer.alloc((4 - (offset % 4)) % 4)
    segments.push(padding, bytes)
    offset += padding.length
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length })
    json.images.push({ bufferView: json.bufferViews.length - 1, mimeType: 'image/png' })
    json.textures.push({ source: json.images.length - 1, sampler: 0 })
    offset += bytes.length
  }
  for (const material of json.materials) {
    material.normalTexture = { index: 0, scale: material.name === 'Antislip_Rubber' ? 0.7 : 0.3 }
    material.pbrMetallicRoughness.metallicRoughnessTexture = { index: 1 }
    if (material.name === 'Molded_HDPE')
      material.pbrMetallicRoughness.baseColorTexture = { index: 2 }
  }
  segments.push(Buffer.alloc((4 - (offset % 4)) % 4))
  const binary = Buffer.concat(segments)
  json.buffers[0].byteLength = binary.length
  json.asset.extras = {
    description:
      'Single reference HDPE pallet, estimated 1100 x 1100 x 150 mm, Y up, bottom centre origin',
  }
  const source = Buffer.from(JSON.stringify(json)),
    text = Buffer.concat([source, Buffer.alloc((4 - (source.length % 4)) % 4, 32)])
  const result = Buffer.alloc(28 + text.length + binary.length)
  result.writeUInt32LE(0x46546c67)
  result.writeUInt32LE(2, 4)
  result.writeUInt32LE(result.length, 8)
  result.writeUInt32LE(text.length, 12)
  result.writeUInt32LE(0x4e4f534a, 16)
  text.copy(result, 20)
  result.writeUInt32LE(binary.length, 20 + text.length)
  result.writeUInt32LE(0x004e4942, 24 + text.length)
  binary.copy(result, 28 + text.length)
  return result
}

const root = compact(),
  reports = []
for (const [name, color] of [
  ['blue', '#172d70'],
  ['yellow', '#f2bf00'],
]) {
  blue.color.set(color)
  const bytes = textures(
    Buffer.from(await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true })),
  )
  if (bytes.length > 12 * 1024 * 1024) throw new Error('카탈로그 모델 용량 제한 초과')
  const filename = `plastic-pallet-${name}.glb`
  await fs.writeFile(path.join(output, filename), bytes)
  reports.push({
    filename,
    bytes: bytes.length,
    meshes: root.children.length,
    vertices: root.children.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0),
    triangles: root.children.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0),
    dimensionsMm: [1100, 150, 1100],
    quantity: 1,
  })
}
await fs.writeFile(
  path.join(output, 'model-info.json'),
  `${JSON.stringify({ units: 'mm', upAxis: 'Y', dimensionSource: '사진 표기 기준 추정 치수', models: reports }, null, 2)}\n`,
)
console.log(JSON.stringify(reports))
