import { deflateSync } from 'node:zlib'

/** 내장 이미지 청크의 무결성 검사값 계산 */
const crc32 = (buffer) => {
  let crc = 0xffffffff
  for (const value of buffer) {
    crc ^= value
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 표준 이미지 청크의 길이와 검사값 구성 */
const chunk = (name, data) => {
  const type = Buffer.from(name)
  const result = Buffer.alloc(data.length + 12)
  result.writeUInt32BE(data.length)
  type.copy(result, 4)
  data.copy(result, 8)
  result.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8)
  return result
}

/** 외부 이미지 파일 없이 반복 가능한 합판 나뭇결 이미지 생성 */
const createWoodPng = () => {
  const size = 256
  const pixels = Buffer.alloc((size * 4 + 1) * size)
  let seed = 71239
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const grain =
        Math.sin(x * 0.6 + Math.sin(y * 0.03) * 1.1) * 9 +
        Math.sin(x * 2.1 + Math.sin(y * 0.015)) * 5
      const knot = Math.hypot((x - 110) * 1.7, (y - 130) * 0.65)
      const rings = knot < 35 ? Math.cos(knot * 1.4) * (1 - knot / 35) * 16 : 0
      const value = Math.round(224 + grain + rings + (seed / 0xffffffff - 0.5) * 7)
      const offset = y * (size * 4 + 1) + 1 + x * 4
      pixels[offset] = value
      pixels[offset + 1] = value - 2
      pixels[offset + 2] = value - 6
      pixels[offset + 3] = 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 나무 재질에만 내장 이미지를 연결하는 휴대형 바이너리 모델 구성 */
export const embedWoodTexture = (buffer) => {
  const jsonLength = buffer.readUInt32LE(12)
  const document = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString())
  const materials =
    document.materials?.filter((material) => material.name?.startsWith('wood')) ?? []
  if (!materials.length) return buffer
  const binaryStart = 20 + jsonLength + 8
  const binary = buffer.subarray(binaryStart, binaryStart + document.buffers[0].byteLength)
  const png = createWoodPng()
  const padding = Buffer.alloc((4 - (binary.length % 4)) % 4)
  const view = document.bufferViews.length
  document.bufferViews.push({
    buffer: 0,
    byteOffset: binary.length + padding.length,
    byteLength: png.length,
  })
  document.images = [...(document.images ?? []), { bufferView: view, mimeType: 'image/png' }]
  document.samplers = [
    ...(document.samplers ?? []),
    { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 },
  ]
  document.textures = [
    ...(document.textures ?? []),
    { sampler: document.samplers.length - 1, source: document.images.length - 1 },
  ]
  for (const material of materials)
    material.pbrMetallicRoughness.baseColorTexture = { index: document.textures.length - 1 }
  const rawBinary = Buffer.concat([binary, padding, png])
  const packedBinary = Buffer.concat([rawBinary, Buffer.alloc((4 - (rawBinary.length % 4)) % 4)])
  document.buffers[0].byteLength = packedBinary.length
  const json = Buffer.from(JSON.stringify(document))
  const packedJson = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)])
  const result = Buffer.alloc(12 + 8 + packedJson.length + 8 + packedBinary.length)
  result.writeUInt32LE(0x46546c67)
  result.writeUInt32LE(2, 4)
  result.writeUInt32LE(result.length, 8)
  result.writeUInt32LE(packedJson.length, 12)
  result.writeUInt32LE(0x4e4f534a, 16)
  packedJson.copy(result, 20)
  const offset = 20 + packedJson.length
  result.writeUInt32LE(packedBinary.length, offset)
  result.writeUInt32LE(0x004e4942, offset + 4)
  packedBinary.copy(result, offset + 8)
  return result
}
