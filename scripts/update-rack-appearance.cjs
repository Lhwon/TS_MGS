const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { loadSource } = require('./load-source.cjs')
const { saveSceneFiles } = require('../electron/scene-files.cjs')
const contract = loadSource('packages/map3d/index.ts')

/** 사용자 배치와 기본 치수를 보존한 내장 랙 형상 교체 */
const main = async () => {
  if (!process.argv[2]) throw new Error('프로젝트 MAP 폴더가 필요합니다.')
  const directory = path.resolve(process.argv[2])
  const folder = path.join(directory, '3D')
  const catalog = contract.parseEquipmentLibrary(
    await fs.readFile(
      path.resolve(__dirname, '../src/entities/facility/ceram-mp5.equipment.json'),
      'utf8',
    ),
  )
  const rack = catalog.assets.find((asset) => asset.id === 'ceram-mp5-storage-rack')
  if (!rack?.glb) throw new Error('랙 원본 GLB가 없습니다.')
  const originals = new Map()
  const documents = new Map()
  for (const name of ['project.map3d.json', 'equipment.json', 'map3d.json']) {
    try {
      const content = await fs.readFile(path.join(folder, name), 'utf8')
      originals.set(name, content)
      documents.set(name, JSON.parse(content.replace(/^\uFEFF/, '')))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (!documents.size) throw new Error('프로젝트의 3D 설계 파일이 없습니다.')
  const files = new Map()
  for (const [name, document] of documents) {
    const asset = document.assets?.find((item) => item.id === rack.id)
    if (!asset?.glb) continue
    asset.glb.data = rack.glb.data
    files.set(name, JSON.stringify(document, null, 2))
    const before = JSON.parse(originals.get(name).replace(/^\uFEFF/, ''))
    const expected = structuredClone(before)
    expected.assets.find((item) => item.id === rack.id).glb.data = rack.glb.data
    assert.deepEqual(document, expected)
    assert.deepEqual(document.instances, before.instances)
  }
  const library = documents.get('equipment.json')
  const layout = documents.get('map3d.json')
  if (files.has('equipment.json') && layout) {
    layout.libraryRef.key = contract.equipmentLibraryKey(
      contract.parseEquipmentLibrary(JSON.stringify(library)).assets,
    )
    files.set('map3d.json', JSON.stringify(layout, null, 2))
    contract.importFacilityFiles(JSON.stringify(layout), JSON.stringify(library))
    assert.deepEqual(layout.instances, JSON.parse(originals.get('map3d.json')).instances)
  }
  if (files.has('project.map3d.json'))
    contract.parseFacilityDocument(files.get('project.map3d.json'))
  if (!files.size) throw new Error('교체할 Ceram MP5 GLB 랙이 없습니다.')
  const backup = path.resolve(__dirname, '../artifacts', `rack-appearance-backup-${randomUUID()}`)
  await fs.mkdir(backup, { recursive: true })
  for (const [name] of files) {
    await fs.writeFile(path.join(backup, name), originals.get(name), { flag: 'wx' })
    assert.equal(
      await fs.readFile(path.join(folder, name), 'utf8'),
      originals.get(name),
      '작업 중 설계가 변경되어 저장을 중단했습니다.',
    )
  }
  await saveSceneFiles(directory, [...files])
  for (const [name, expected] of files)
    assert.equal(await fs.readFile(path.join(folder, name), 'utf8'), expected)
  console.log(
    JSON.stringify({
      updated: [...files.keys()],
      backup,
      preservedPlacements: documents.get('project.map3d.json')?.instances.length,
      preservedModelDimensions: true,
      onlyRackGeometryChanged: true,
    }),
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
