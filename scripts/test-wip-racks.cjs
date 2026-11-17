const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadSource } = require('./load-source.cjs')
const { buildWipRacks, wipRackKey } = loadSource('src/entities/facility/wipRacks.ts')
const contract = loadSource('packages/map3d/index.ts')
const asset = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../src/entities/facility/ceram-mp5.equipment.json')),
).assets[0]
const ports = [
  { id: 'a', name: 'WIP1_01_01_1F_1T', nodeId: 1, x: 0, y: 0, width: 2000, height: 500 },
  { id: 'b', name: 'WIP1_01_01_2F_2T', nodeId: 1, x: 0, y: 1800, width: 2000, height: 500 },
  { id: 'c', name: ' WIP1_01_02_1F_1T ', nodeId: 2, x: 1900, y: 0, width: 2000, height: 500 },
  { id: 'd', name: 'Panel', nodeId: 3, x: 4000, y: 0 },
]
assert.equal(wipRackKey(ports[0]), 'WIP1_01_01')
assert.equal(wipRackKey({ id: 'WIP_A', name: '' }), 'WIP_A')
const instances = buildWipRacks(ports, asset)
assert.equal(instances.length, 2)
assert.equal(instances[0].position.y, 900)
assert.equal(instances[0].portOffset.y, 900)
assert.ok(instances[0].scale.x * asset.glb.size.x < 1900)
assert.deepEqual(
  instances,
  buildWipRacks([...ports].reverse(), asset).sort((a, b) => a.id.localeCompare(b.id)),
)
const doc = contract.emptyFacilityDocument()
doc.assets = [asset]
doc.instances = instances
assert.equal(contract.parseFacilityDocument(JSON.stringify(doc)).instances.length, 2)
assert.deepEqual(buildWipRacks([], asset), [])
console.log(
  'WIP racks: logical floor grouping, anchors, dimensions, deterministic IDs and unrelated ports passed',
)
