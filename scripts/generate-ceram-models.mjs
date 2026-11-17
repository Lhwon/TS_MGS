import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import fs from 'node:fs/promises'
import { appendHandlingModels } from './material-handling-models.mjs'
import { embedWoodTexture } from './wood-texture.mjs'

/** 내장 바이너리 내보내기의 파일 읽기 어댑터 */
class ExportReader {
  result
  onloadend
  /** 바이너리 버퍼 읽기 */
  readAsArrayBuffer = (blob) => {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer
      this.onloadend?.()
    })
  }
  /** 바이너리 데이터 주소 읽기 */
  readAsDataURL = (blob) => {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`
      this.onloadend?.()
    })
  }
}
globalThis.FileReader = ExportReader
const cargoOnly = process.argv.includes('--cargo-only')
const cargoIds = new Set(['wooden-crate', 'wooden-crate-stack'])
const handlingOnly = process.argv.includes('--handling-only')
const handlingIds = new Set(['centering-station', 'double-deck-conveyor'])
const output = 'public/models/ceram-mp5'
await fs.mkdir(output, { recursive: true })
const unitBox = new THREE.BoxGeometry(1, 1, 1),
  unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 16)
const materials = Object.fromEntries(
  Object.entries({
    steel: '#71838c',
    paint: '#c4cdd0',
    dark: '#27333c',
    beam: '#b48558',
    blue: '#4a7080',
    screen: '#294c57',
    rackFrame: '#315570',
    rackBeam: '#D87932',
    rackDeck: '#A5ADB2',
    rackFoot: '#414A50',
    woodLight: '#C69B64',
    woodMedium: '#B68B56',
    woodDark: '#8E673F',
    steelBand: '#50585C',
    machineFrame: '#315570',
    machineGray: '#818B91',
    rubber: '#30383B',
    warning: '#D3AB43',
    buttonGreen: '#467F65',
    buttonRed: '#A6554B',
    shutterCurtain: '#54798D',
    shutterSeam: '#456474',
    shutterWindow: '#A3B7BE',
  }).map(([name, color]) => [
    name,
    new THREE.MeshStandardMaterial({
      name: /^(rack|wood|machine|steelBand|rubber|warning|button|shutter)/.test(name) ? name : '',
      color,
      transparent: name === 'shutterWindow',
      opacity: name === 'shutterWindow' ? 0.5 : 1,
      depthWrite: name !== 'shutterWindow',
      metalness:
        name.startsWith('wood') || name === 'rubber' || name.startsWith('shutter')
          ? 0
          : name === 'steel'
            ? 0.7
            : name === 'rackDeck'
              ? 0.65
              : 0.25,
      roughness:
        name === 'shutterWindow'
          ? 0.25
          : name.startsWith('shutter')
            ? 0.8
            : name.startsWith('wood') || name === 'rubber'
              ? 0.9
              : name === 'steel'
                ? 0.38
                : name === 'rackDeck'
                  ? 0.45
                  : 0.6,
    }),
  ]),
)
const assets = []
/** 평면 좌표와 높이를 표준 모델 축으로 변환 */
const point = (x, y, z) => new THREE.Vector3(x / 1000, z / 1000, -y / 1000)
/** 공유 박스 부품의 형상과 배치 생성 */
const box = (root, material, x, y, z, w, d, h) => {
  const mesh = new THREE.Mesh(unitBox, materials[material])
  mesh.position.copy(point(x, y, z))
  mesh.scale.set(w / 1000, h / 1000, d / 1000)
  root.add(mesh)
  return mesh
}
/** 원통형 롤러와 관절 생성 */
const cylinder = (root, material, x, y, z, diameter, h, horizontal = false) => {
  const mesh = new THREE.Mesh(unitCylinder, materials[material])
  mesh.position.copy(point(x, y, z))
  mesh.scale.set(diameter / 1000, h / 1000, diameter / 1000)
  if (horizontal) mesh.rotation.z = Math.PI / 2
  root.add(mesh)
  return mesh
}
/** 실제 생성 외곽을 기록한 바이너리 모델 저장 */
const save = async (id, name, kind, model) => {
  if (cargoOnly && !cargoIds.has(id)) return
  if (handlingOnly && !handlingIds.has(id)) return
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
  const buffer = embedWoodTexture(
    Buffer.from(await new GLTFExporter().parseAsync(model, { binary: true })),
  )
  await fs.writeFile(`${output}/${id}.glb`, buffer)
  assets.push({
    id: `ceram-mp5-${id}`,
    name,
    kind,
    parts: [],
    glb: {
      data: buffer.toString('base64'),
      size: {
        x: Math.round(size.x * 1000),
        y: Math.round(size.z * 1000),
        z: Math.round(size.y * 1000),
      },
      sourceName: `${id}.glb`,
    },
  })
}
/** 관찰창과 제어 화면을 가진 공정 설비의 개략 형상 생성 */
const cabinet = (w, d, h, doors = 1) => {
  const root = new THREE.Group()
  box(root, 'dark', 0, 0, 80, w, d, 160)
  box(root, 'paint', 0, 0, h / 2, w - 60, d - 60, h - 120)
  for (let i = 0; i < doors; i++) {
    const x = ((i - (doors - 1) / 2) * (w - 100)) / doors
    box(root, 'dark', x, -d / 2, h * 0.55, (w - 160) / doors, 35, h * 0.62)
    box(root, 'blue', x, -d / 2 - 20, h * 0.62, (w - 280) / doors, 10, h * 0.35)
    box(root, 'steel', x + (w - 300) / doors / 2, -d / 2 - 28, h * 0.46, 22, 22, 180)
  }
  box(root, 'screen', w * 0.3, -d / 2 - 32, h * 0.82, 220, 18, 160)
  return root
}
const rack = new THREE.Group(),
  w = 2500,
  d = 2500,
  h = 3850
for (const x of [-1200, 1200])
  for (const y of [-1200, 1200]) {
    box(rack, 'rackFrame', x, y, h / 2, 90, 90, h).name = `rack-upright-${x}-${y}`
    box(rack, 'rackFoot', x, y, 20, 100, 100, 40).name = `rack-foot-${x}-${y}`
  }
// 하단 바닥과 적재물 없이 중간판과 최상단판만 배치하는 랙 구조
for (const [floor, z] of [1915, 3785].entries()) {
  for (const y of [-1205, 1205])
    box(rack, 'rackBeam', 0, y, z, w, 90, 110).name = `rack-beam-${floor + 1}-${y}`
  const deck = box(rack, 'rackDeck', 0, 0, z + 55, w - 110, d - 110, 20)
  deck.name = `storage-deck-${floor + 1}`
}
await save('storage-rack', 'MP5 보관랙 2500×2500×3850', 'rack', rack)
const conveyor = new THREE.Group()
for (const x of [-500, 500])
  for (const y of [-1350, 1350]) box(conveyor, 'dark', x, y, 350, 70, 70, 700)
for (const x of [-520, 520]) box(conveyor, 'steel', x, 0, 740, 60, 3000, 120)
for (let i = 0; i < 20; i++)
  cylinder(conveyor, 'steel', 0, -1400 + (i * 2800) / 19, 790, 60, 1000, true)
await save('roller-conveyor', '기본 롤러 컨베이어 · 개략', 'conveyor', conveyor)
for (const [id, name, w, d, h, doors] of [
  ['rapid-cooling', 'Rapid cooling chambers · 개략', 2800, 3200, 3200, 2],
  ['discrete-spray', 'Discrete Spray 설비 · 개략', 2600, 3600, 3000, 2],
  ['dryer', 'Dryer 건조 설비 · 개략', 3200, 6000, 3000, 3],
  ['lehr', 'Lehr 열처리 설비 · 개략', 4000, 10000, 3500, 4],
  ['robot-controller', 'Robot Controller 제어반 · 개략', 800, 600, 1800, 1],
  ['lift', 'LIFT 승강 설비 · 개략', 2000, 2000, 3500, 2],
  ['agv-power-220', 'AGV 전원·충전 스테이션 220V · 개략', 600, 450, 1200, 1],
  ['agv-power-440', 'AGV 전원·충전 스테이션 440V · 개략', 600, 450, 1200, 1],
])
  await save(id, name, 'equipment', cabinet(w, d, h, doors))
const robot = new THREE.Group()
box(robot, 'dark', 0, 0, 100, 1000, 1000, 200)
cylinder(robot, 'steel', 0, 0, 380, 650, 560)
box(robot, 'beam', 0, 0, 1000, 350, 400, 1200)
cylinder(robot, 'steel', 0, 0, 1400, 420, 440, true)
box(robot, 'beam', 0, -450, 1500, 300, 1100, 260)
cylinder(robot, 'dark', 0, -950, 1500, 260, 300, true)
box(robot, 'steel', 0, -1050, 1300, 220, 200, 400)
await save('robot', 'Robot 작업 로봇 · 개략', 'equipment', robot)
const loader = new THREE.Group()
for (const x of [-900, 900])
  for (const y of [-1300, 1300]) box(loader, 'steel', x, y, 950, 100, 100, 1900)
box(loader, 'dark', 0, 0, 100, 2000, 3000, 200)
box(loader, 'paint', 0, 0, 1200, 1700, 2200, 100)
box(loader, 'beam', 0, 0, 1950, 2000, 3000, 100)
await save('dummy-crate-loader', 'Dummy Crate Loading Unit · 개략', 'equipment', loader)
const crate = new THREE.Group()
box(crate, 'dark', 0, 0, 80, 1100, 1100, 160)
for (const x of [-520, 520]) box(crate, 'paint', x, 0, 500, 60, 1100, 800)
for (const y of [-520, 520]) box(crate, 'paint', 0, y, 500, 1100, 60, 800)
await save('crate', 'Crate 운반 용기 · 개략', 'equipment', crate)
await appendHandlingModels({ box, cylinder, save })
const library = {
  format: 'bem-equipment-library',
  version: 1,
  units: 'mm',
  coordinates: 'mgs-xy-z-up',
  assets,
}
for (const file of [
  'src/entities/facility/ceram-mp5.equipment.json',
  `${output}/ceram-mp5.equipment.json`,
]) {
  const target = cargoOnly || handlingOnly ? JSON.parse(await fs.readFile(file, 'utf8')) : library
  if (cargoOnly || handlingOnly) {
    const replacements = new Map(assets.map((asset) => [asset.id, asset]))
    target.assets = target.assets.map((asset) => replacements.get(asset.id) ?? asset)
    for (const asset of assets)
      if (!target.assets.some((item) => item.id === asset.id)) target.assets.push(asset)
  }
  await fs.writeFile(file, JSON.stringify(target))
}
console.log(`Generated ${assets.length} static GLB models`)
if (!handlingOnly)
  await fs.writeFile(
    'packages/map3d/cargo-models.ts',
    `import type { FacilityAsset } from './index'\n\n// 모델 생성기로 관리하는 공통 캐리어 원본\nexport const cargoModels: readonly FacilityAsset[] = ${JSON.stringify(assets.filter((asset) => cargoIds.has(asset.id.replace('ceram-mp5-', ''))))}\n`,
  )
unitBox.dispose()
unitCylinder.dispose()
Object.values(materials).forEach((material) => material.dispose())
