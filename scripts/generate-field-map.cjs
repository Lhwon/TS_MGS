const fs = require('node:fs/promises')
const path = require('node:path')
const { loadSource } = require('./load-source.cjs')
const { openMapFolder } = require('../electron/map-files.cjs')
const { saveSceneFiles } = require('../electron/scene-files.cjs')
const { previewLegacy } = loadSource('src/entities/map/model/legacy.ts')
const { buildWipRacks, wipRackKey } = loadSource('src/entities/facility/wipRacks.ts')
const contract = loadSource('packages/map3d/index.ts')

/** 도면에서 식별한 공정 종류와 실제 현장 포트 범위를 결합하는 편집용 설계 구성 */
const createFieldScene = (map, library) => {
  const document = contract.emptyFacilityDocument()
  document.mapRef = { name: map.name, geometryKey: contract.mapGeometryKey(map.nodes) }
  const rack = library.assets.find((asset) => asset.id === 'ceram-mp5-storage-rack')
  document.instances = buildWipRacks(map.ports, rack)
  const assets = new Map(library.assets.map((asset) => [asset.id.replace('ceram-mp5-', ''), asset]))
  /** 공정 입출력 포트 사이의 방향과 범위를 사용하는 개략 설비 배치 */
  const processLine = (name, model, input, output, width) => {
    if (!input.length || !output.length) return
    /** 공정 포트 집합의 중심 좌표 계산 */
    const center = (ports) => ({
      x: ports.reduce((sum, port) => sum + port.x, 0) / ports.length,
      y: ports.reduce((sum, port) => sum + port.y, 0) / ports.length,
    })
    const start = center(input)
    const end = center(output)
    const distance = Math.hypot(end.x - start.x, end.y - start.y)
    if (distance < 500) return
    const asset = assets.get(model)
    const anchor = input[0]
    const position = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, z: 0 }
    document.instances.push({
      id: `process-${name}`,
      assetId: asset.id,
      name: `${name} · 도면 공정 개략`,
      position,
      rotation: (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI - 90,
      scale: {
        x: width / asset.glb.size.x,
        y: Math.max(500, distance - 1000) / asset.glb.size.y,
        z: 1,
      },
      portId: anchor.id,
      nodeId: anchor.nodeId,
      portOffset: { x: position.x - anchor.x, y: position.y - anchor.y, z: 0 },
    })
  }
  for (const index of [1, 2, 3])
    processLine(
      `SPRAY-${index}`,
      'discrete-spray',
      map.ports.filter((port) => new RegExp(`^SP_SP${index}_IN_\\d+$`).test(port.id)),
      map.ports.filter((port) => new RegExp(`^SP_SP${index}_OUT_\\d+$`).test(port.id)),
      2400,
    )
  for (const index of [4, 5])
    processLine(
      `MP${index}-LEHR`,
      'lehr',
      map.ports.filter((port) => port.id === `LE_MP${index}_LH_1F_1`),
      map.ports.filter((port) => port.id === `LE_MP${index}_LH_1F_2`),
      3200,
    )
  for (const index of [1, 2, 3, 4])
    processLine(
      `VI-${index}`,
      'roller-conveyor',
      map.ports.filter((port) => port.id === `VI_VI${index}_IO`),
      map.ports.filter((port) => new RegExp(`^VI_VI${index}_OUT_\\d+$`).test(port.id)),
      1800,
    )
  for (const index of [4, 5]) {
    const ports = map.ports.filter((port) =>
      new RegExp(`^LE_MP${index}_DM_BUF_\\d+F_\\d+T$`).test(port.id),
    )
    if (!ports.length) continue
    const asset = assets.get('dummy-crate-loader')
    const anchor = ports[0]
    const position = {
      x: ports.reduce((sum, port) => sum + port.x, 0) / ports.length,
      y: ports.reduce((sum, port) => sum + port.y, 0) / ports.length,
      z: 0,
    }
    document.instances.push({
      id: `process-MP${index}-CRATE-LOADER`,
      assetId: asset.id,
      name: `MP${index} Dummy Crate Loading Unit · 개략`,
      position,
      rotation: 0,
      portId: anchor.id,
      nodeId: anchor.nodeId,
      portOffset: { x: position.x - anchor.x, y: position.y - anchor.y, z: 0 },
    })
  }
  const used = new Set(document.instances.map((instance) => instance.assetId))
  document.assets = library.assets.filter((asset) => used.has(asset.id))
  const checked = contract.parseFacilityDocument(JSON.stringify(document))
  const rackKeys = new Set(
    checked.instances
      .filter((instance) => instance.assetId === rack.id)
      .map((instance) => instance.name),
  )
  for (const port of map.ports) {
    const key = wipRackKey(port)
    if (key && !rackKeys.has(key)) throw new Error(`WIP 포트의 랙 배치가 없습니다: ${port.id}`)
  }
  return checked
}

/** 선택한 현장 프로젝트에 맞는 최신 지도와 라이브러리의 삼차원 파일 저장 */
const main = async () => {
  if (!process.argv[2]) throw new Error('프로젝트의 RCS 또는 MAP 폴더 경로가 필요합니다.')
  const source = await openMapFolder(path.resolve(process.argv[2]))
  const map = previewLegacy(source.content, source.name, source.portGroups)
  const library = contract.parseEquipmentLibrary(
    await fs.readFile(
      path.resolve(__dirname, '../src/entities/facility/ceram-mp5.equipment.json'),
      'utf8',
    ),
  )
  const document = createFieldScene(map, library)
  const { layout, library: runtimeLibrary } = contract.exportFacilityFiles(document)
  const files = [
    ['project.map3d.json', JSON.stringify(document, null, 2)],
    ['equipment.json', JSON.stringify(runtimeLibrary, null, 2)],
    ['map3d.json', JSON.stringify(layout, null, 2)],
  ]
  if (!process.argv.includes('--overwrite'))
    for (const [name] of files) {
      try {
        await fs.access(path.join(source.directory, '3D', name))
        throw new Error(`기존 설계를 보호하기 위해 저장을 중단했습니다: ${name}`)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  const folder = await saveSceneFiles(source.directory, files)
  console.log(
    JSON.stringify(
      {
        folder,
        source: source.name,
        wipPorts: map.ports.filter((port) => wipRackKey(port)).length,
        racks: document.instances.filter(
          (instance) => instance.assetId === 'ceram-mp5-storage-rack',
        ).length,
        equipment: document.instances.filter(
          (instance) => instance.assetId !== 'ceram-mp5-storage-rack',
        ).length,
        files: files.map(([name]) => name),
      },
      null,
      2,
    ),
  )
}

if (require.main === module)
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
module.exports = { createFieldScene }
