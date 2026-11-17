const assert = require('node:assert/strict')
const fs = require('node:fs')
const { loadSource } = require('./load-source.cjs')
const contract = loadSource('packages/map3d/index.ts')
const catalog = JSON.parse(
  fs.readFileSync('src/entities/facility/ceram-mp5.equipment.json', 'utf8'),
)
const document = contract.emptyFacilityDocument()
const other = catalog.assets.find((asset) => asset.id === 'ceram-mp5-storage-rack')
document.assets = [
  other,
  ...['wooden-crate', 'wooden-crate-stack'].map((name, index) => ({
    ...contract.standardCargoAsset(`ceram-mp5-${name}`),
    glb: {
      ...other.glb,
      size: { x: 1200, y: 1016, z: index ? 2000 : 1000 },
      sourceName: `${name}.glb`,
    },
  })),
]
document.instances = [
  {
    id: 'cargo-reference',
    assetId: 'ceram-mp5-wooden-crate-stack',
    name: '표준 치수 배치',
    position: { x: 1234, y: 5678, z: 90 },
    rotation: 90,
    carrierRotation: 180,
    scale: { x: 1.5, y: 1, z: 0.5 },
  },
]
/** 구형 내장 모델의 실제 바이너리와 치수를 함께 교체하는 확인 */
const check = (value) => {
  for (const id of ['ceram-mp5-wooden-crate', 'ceram-mp5-wooden-crate-stack']) {
    const current = contract.standardCargoAsset(id)
    const actual = value.assets.find((asset) => asset.id === id)
    assert.deepEqual(actual.glb, current.glb)
  }
  assert.deepEqual(value.assets[0], other)
  assert.deepEqual(value.instances[0].position, document.instances[0].position)
  assert.equal(value.instances[0].rotation, 90)
  assert.equal(value.instances[0].carrierRotation, 180)
  assert.deepEqual(value.instances[0].scale, { x: 1, y: 1, z: 1 })
}
for (let index = 0; index < 3; index++) {
  const saved = contract.parseFacilityDocument(JSON.stringify(document))
  check(saved)
  check(contract.parseFacilityDocument(JSON.stringify(saved)))
  const { layout, library } = contract.exportFacilityFiles(document)
  check(contract.importFacilityFiles(JSON.stringify(layout), JSON.stringify(library)))
}
const original = contract.parseFacilityDocument(JSON.stringify(document), false)
const legacyLibrary = {
  format: 'bem-equipment-library',
  version: 1,
  units: 'mm',
  coordinates: 'mgs-xy-z-up',
  assets: original.assets,
}
const legacyLayout = {
  format: 'bem-map3d-layout',
  version: 1,
  units: 'mm',
  coordinates: 'mgs-xy-z-up',
  mapRef: original.mapRef,
  libraryRef: { fileName: 'equipment.json', key: contract.equipmentLibraryKey(original.assets) },
  instances: original.instances,
}
check(contract.importFacilityFiles(JSON.stringify(legacyLayout), JSON.stringify(legacyLibrary)))
legacyLibrary.assets[0].name = 'tampered'
assert.throws(() =>
  contract.importFacilityFiles(JSON.stringify(legacyLayout), JSON.stringify(legacyLibrary)),
)
const copy = contract.standardCargoAsset('ceram-mp5-wooden-crate')
copy.glb.size.x = 9999
assert.equal(contract.standardCargoAsset(copy.id).glb.size.x, 1800)
assert.equal(document.assets[1].glb.size.x, 1200)
console.log(
  'Cargo standard: stale-memory save, repeated reload, legacy split-library key validation, canonical GLB bytes and dimensions, preserved placement and independent copies passed',
)
