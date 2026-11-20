const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const cache = new Map()
/** 공유 계약의 타입 제거와 로컬 모듈 로딩 */
const load = (filename) => {
  const target = path.resolve(filename)
  if (cache.has(target)) return cache.get(target)
  const exports = {}
  cache.set(target, exports)
  const code = ts.transpileModule(fs.readFileSync(target, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('exports', 'require', code)(exports, (name) =>
    load(path.resolve(path.dirname(target), `${name}.ts`)),
  )
  return exports
}
const contract = load('packages/map3d/index.ts')
const library = contract.parseEquipmentLibrary(
  fs.readFileSync('src/entities/facility/ceram-mp5.equipment.json', 'utf8'),
)
assert.equal(library.assets.length, 23)
assert.ok(library.assets.every((asset) => !/\b(?:ceram|mp[45])\b/i.test(asset.name)))
for (const tier of [1, 2, 3, 4]) {
  const rack = library.assets.find((asset) => asset.name === `보관 랙 · ${tier}단`)
  const buffer = Buffer.from(rack.glb.data, 'base64')
  const { nodes, materials, images } = JSON.parse(
    buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)),
  )
  assert.equal(nodes.filter((node) => node.name?.startsWith('storage-deck-')).length, tier)
  assert.equal(nodes.filter((node) => node.name === 'rack-diagonal-brace').length, tier * 2)
  assert.equal(images[0].mimeType, 'image/png')
  assert.ok(
    materials.find((material) => material.name === 'rackDeck').pbrMetallicRoughness
      .baseColorTexture,
  )
}
assert.deepEqual(library.assets[0].glb.size, { x: 2500, y: 2500, z: 3850 })
const document = contract.emptyFacilityDocument()
document.mapRef = {
  name: 'fixture',
  geometryKey: contract.mapGeometryKey([{ id: 1, x: 1000, y: 2000 }]),
}
document.assets = library.assets
document.instances = [
  {
    id: 'placed',
    assetId: library.assets[0].id,
    name: 'Rack',
    position: { x: 100, y: 200, z: 300 },
    rotation: 90,
    scale: { x: 1.5, y: 0.8, z: 1.2 },
  },
]
const files = contract.exportFacilityFiles(document)
const roundtrip = contract.importFacilityFiles(
  JSON.stringify(files.layout),
  JSON.stringify(files.library),
)
assert.deepEqual(roundtrip.instances, document.instances)
assert.equal(roundtrip.assets[0].glb.data, library.assets[0].glb.data)
const movedPlacements = contract.validateFacilityPlacements(roundtrip, [
  { ...roundtrip.instances[0], position: { x: 123, y: 456, z: 789 } },
])
assert.equal(movedPlacements.assets, roundtrip.assets)
assert.deepEqual(movedPlacements.instances[0].position, { x: 123, y: 456, z: 789 })
assert.throws(() => contract.validateFacilityPlacements(roundtrip, [
  { ...roundtrip.instances[0], scale: { x: 0, y: 1, z: 1 } },
]))
const { createInteriorModel } = load('src/entities/facility/interiorModels.ts')
const interior = contract.emptyFacilityDocument()
interior.assets = [createInteriorModel('doorway'), createInteriorModel('glass')]
interior.instances = [
  { ...document.instances[0], assetId: interior.assets[0].id, wallOpacity: 0.35 },
]
const interiorFiles = contract.exportFacilityFiles(interior)
const restoredInterior = contract.importFacilityFiles(
  JSON.stringify(interiorFiles.layout),
  JSON.stringify(interiorFiles.library),
)
assert.equal(restoredInterior.instances[0].wallOpacity, 0.35)
assert.equal(restoredInterior.assets[0].parts.filter((part) => part.wall).length, 3)
assert.equal(restoredInterior.assets[0].parts.find((part) => part.name === '문짝').wall, undefined)
assert.equal(restoredInterior.assets[1].parts.find((part) => part.name === '유리').opacity, 0.32)
assert.equal(restoredInterior.assets[1].parts.length, 1)
const pipe = createInteriorModel('stainless-pipe')
const restoredPipe = contract.parseFacilityDocument(JSON.stringify({
  ...contract.emptyFacilityDocument(),
  assets: [pipe],
})).assets[0]
assert.equal(restoredPipe.catalogCategory, 'interior')
assert.equal(restoredPipe.parts.length, 4)
assert.ok(restoredPipe.parts.every((part) => part.surface === 'stainlessSteel'))
assert.equal(restoredPipe.parts.reduce((area, part) => area + part.size.x * part.size.y, 0), 40 ** 2 - 36 ** 2)
const doorWall = createInteriorModel('wall')
assert.equal(contract.surfaceForPart(doorWall.parts[0]), 'plaster')
doorWall.parts[0].surface = 'wood'
const withDoor = {
  ...document.instances[0],
  assetId: doorWall.id,
  scale: { x: 2, y: 1, z: 1 },
  wallDoors: [{ id: 'entrance', offset: 500, width: 1040, height: 2160 }],
}
const attached = contract.exportFacilityFiles({
  ...contract.emptyFacilityDocument(),
  assets: [doorWall],
  instances: [withDoor],
})
const restoredWall = contract.importFacilityFiles(JSON.stringify(attached.layout), JSON.stringify(attached.library))
assert.deepEqual(restoredWall.instances[0].wallDoors, withDoor.wallDoors)
assert.equal(restoredWall.assets[0].parts[0].surface, 'wood')
const opening = contract.instanceParts(restoredWall.assets[0], restoredWall.instances[0])
assert.equal(opening.find((part) => part.name === '상부 벽체').size.x * 2, 1040)
assert.ok(opening.filter((part) => part.wall).every((part) => contract.surfaceForPart(part) === 'wood'))
assert.equal(contract.surfaceForPart(opening.find((part) => part.name === '문틀')), 'paintedSteel')
assert.equal(contract.surfaceForPart(opening.find((part) => part.name === '문짝')), 'wood')
assert.equal(opening.find((part) => part.name === '문짝').wall, undefined)
assert.throws(() => contract.parseWallDoors([
  ...withDoor.wallDoors,
  { ...withDoor.wallDoors[0], id: 'duplicate-position' },
], withDoor, doorWall), /겹칩니다/)
const floor = {
  id: 'showroom-tile',
  name: '관람 구역',
  points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1200 }, { x: 0, y: 1200 }],
  material: 'tile',
  color: '#c7c3b8',
  repeatMm: 600,
  rotation: 30,
}
const floorFiles = contract.exportFacilityFiles({ ...contract.emptyFacilityDocument(), floors: [floor] })
assert.deepEqual(floorFiles.layout.floors, [floor])
assert.deepEqual(
  contract.importFacilityFiles(JSON.stringify(floorFiles.layout), JSON.stringify(floorFiles.library)).floors,
  [floor],
)
assert.throws(() => contract.parseFloorAreas([{
  ...floor,
  points: [floor.points[0], floor.points[2], floor.points[1], floor.points[3]],
}]), /교차/)
assert.throws(() =>
  contract.exportFacilityFiles({
    ...interior,
    instances: [{ ...interior.instances[0], wallOpacity: 1.01 }],
  }),
)
assert.throws(() =>
  contract.parseFacilityDocument(
    JSON.stringify({
      ...document,
      instances: [{ ...document.instances[0], scale: { x: 0, y: 1, z: 1 } }],
    }),
  ),
)
assert.throws(
  () =>
    contract.parseFacilityDocument(
      JSON.stringify({
        ...document,
        instances: Array.from({ length: 10000 }, (_, i) => ({
          ...document.instances[0],
          id: `rack-${i}`,
        })),
      }),
    ),
  /100,000/,
)
assert.throws(() => contract.decodeEmbeddedGlb('abcd'))
const original = Buffer.from(library.assets[0].glb.data, 'base64')
const jsonLength = original.readUInt32LE(12)
const json = JSON.parse(original.subarray(20, 20 + jsonLength).toString())
assert.equal(json.nodes.filter((node) => node.name?.startsWith('storage-deck-')).length, 2)
assert.equal(json.nodes.filter((node) => node.name?.startsWith('stacked-load-')).length, 0)
const deckHeights = json.nodes
  .filter((node) => node.name?.startsWith('storage-deck-'))
  .map((node) => Math.round((node.translation?.[1] ?? node.matrix[13]) * 1000))
assert.deepEqual(deckHeights, [1970, 3840])
assert.equal(json.nodes.filter((node) => node.name === 'rack-anchor-bolt').length, 8)
assert.equal(json.nodes.filter((node) => node.name?.startsWith('rack-upright-')).length, 4)
assert.equal(json.nodes.filter((node) => /^rack-beam-\d/.test(node.name ?? '')).length, 4)
assert.equal(json.nodes.filter((node) => node.name?.startsWith('rack-foot-')).length, 4)
for (const node of json.nodes.filter((node) =>
  /^(storage-deck-|rack-upright-|rack-beam-\d|rack-foot-)/.test(node.name ?? ''),
)) {
  assert.ok(
    !node.rotation ||
      node.rotation.every((value, index) => Math.abs(value - (index === 3 ? 1 : 0)) < 1e-7),
  )
  if (node.matrix)
    for (const index of [1, 2, 4, 6, 8, 9]) assert.ok(Math.abs(node.matrix[index]) < 1e-7)
}
for (const [name, hex] of Object.entries({
  rackFrame: '#315570',
  rackBeam: '#D87932',
  rackDeck: '#A5ADB2',
  rackFoot: '#414A50',
})) {
  const expected = new (require('three').Color)(hex).toArray()
  const actual = json.materials.find((material) => material.name === name).pbrMetallicRoughness
    .baseColorFactor
  expected.forEach((value, index) => assert.ok(Math.abs(actual[index] - value) < 1e-6))
}
json.buffers[0].uri = 'https://example.com/external.bin'
const content = Buffer.from(
  JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / 4) * 4, ' '),
)
const malicious = Buffer.alloc(20 + content.length)
malicious.writeUInt32LE(0x46546c67, 0)
malicious.writeUInt32LE(2, 4)
malicious.writeUInt32LE(malicious.length, 8)
malicious.writeUInt32LE(content.length, 12)
malicious.writeUInt32LE(0x4e4f534a, 16)
content.copy(malicious, 20)
assert.throws(() => contract.decodeEmbeddedGlb(malicious.toString('base64')), /단일 GLB/)
console.log(
  'Map3D GLB contract: catalog, dimensions, export roundtrip, scaling, buffer budget and self-contained asset validation passed',
)
