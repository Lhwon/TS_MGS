import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** 정렬 설비와 나무 적재물 및 두 층 컨베이어의 재사용 모델 생성 */
export const appendHandlingModels = async ({ box, cylinder, save }) => {
  const merged = []
  /** 정적인 부품을 재질별 메시로 합치는 렌더링 묶음 구성 */
  const compact = (root) => {
    root.updateMatrixWorld(true)
    const groups = new Map()
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld)
      const list = groups.get(object.material) ?? []
      list.push(geometry)
      groups.set(object.material, list)
    })
    root.clear()
    for (const [material, geometries] of groups) {
      const geometry = mergeGeometries(geometries)
      geometries.forEach((part) => part.dispose())
      if (!geometry) throw new Error('물류 설비 형상 병합에 실패했습니다.')
      merged.push(geometry)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = `${root.name}-${material.name || 'surface'}`
      root.add(mesh)
    }
  }
  /** 프레임과 구동부의 편집 기준이 되는 이름 있는 조립 그룹 생성 */
  const assembly = (parent, name) => {
    const group = new THREE.Group()
    group.name = name
    parent.add(group)
    return group
  }
  /** 짧은 깊이 방향의 롤러 회전축 구성 */
  const depthRoller = (root, x, y, z, diameter, length) => {
    const roller = cylinder(root, 'steel', x, y, z, diameter, length)
    roller.rotation.x = Math.PI / 2
    return roller
  }
  /** 물리 버튼과 화면을 포함한 소형 조작반 구성 */
  const consolePanel = (root, x, y, z) => {
    box(root, 'paint', x, y, z, 280, 170, 440)
    box(root, 'dark', x, y - 90, z + 60, 230, 15, 190)
    box(root, 'screen', x, y - 100, z + 65, 190, 10, 145)
    box(root, 'buttonGreen', x - 65, y - 100, z - 115, 42, 24, 42)
    box(root, 'buttonRed', x + 65, y - 100, z - 115, 42, 24, 42)
  }

  const crate = new THREE.Group()
  crate.name = 'wooden-crate-single'
  for (const x of [-720, 0, 720]) {
    box(crate, 'woodDark', x, 0, 20, 250, 1000, 40)
    for (const y of [-370, 370]) box(crate, 'woodDark', x, y, 70, 250, 200, 60)
  }
  for (let index = 0; index < 7; index++)
    box(crate, 'woodLight', -768 + index * 256, 0, 112.5, 250, 1000, 25)
  // 측판과 같은 평면에 겹치지 않는 내부 기둥 배치
  for (const x of [-858, 858])
    for (const y of [-458, 458]) box(crate, 'woodDark', x, y, 300, 75, 75, 350)
  for (let level = 0; level < 5; level++) {
    const z = 160 + level * 70
    for (const y of [-480, 480])
      box(crate, level % 2 ? 'woodLight' : 'woodMedium', 0, y, z, 1800, 35, 68)
    for (const x of [-880, 880])
      box(crate, level % 2 ? 'woodMedium' : 'woodLight', x, 0, z, 35, 920, 68)
  }
  for (let index = 0; index < 6; index++)
    box(crate, 'woodLight', 0, -417 + index * 167, 486.5, 1800, 160, 23)
  for (const x of [-630, 630]) {
    for (const y of [-502, 502]) box(crate, 'steelBand', x, y, 300, 28, 12, 350)
    box(crate, 'steelBand', x, 0, 499, 28, 1000, 2)
  }
  compact(crate)
  await save('wooden-crate', '나무 박스 적재물 · 단품', 'equipment', crate)
  const stack = new THREE.Group()
  stack.name = 'wooden-crate-double-stack'
  const lower = crate.clone(true)
  lower.name = 'cargo-lower'
  const upper = crate.clone(true)
  upper.name = 'cargo-upper'
  upper.position.y = 0.5
  stack.add(lower, upper)
  await save('wooden-crate-stack', '나무 박스 적재물 · 수직 2단', 'equipment', stack)

  const centering = new THREE.Group()
  centering.name = 'two-stack-centering-station'
  const frame = assembly(centering, 'centering-frame')
  for (const x of [-1160, 1160])
    for (const y of [-760, 760]) {
      box(frame, 'machineGray', x, y, 1400, 120, 120, 2800)
      box(frame, 'dark', x, y, 20, 200, 200, 40)
    }
  for (const y of [-760, 760]) {
    if (y > 0) box(frame, 'machineGray', 0, y, 2740, 2440, 120, 120)
    box(frame, 'dark', 0, y, 160, 2440, 140, 240)
  }
  for (const x of [-1160, 1160]) box(frame, 'machineGray', x, 0, 2740, 120, 1640, 120)
  const bed = assembly(centering, 'centering-entry-bed')
  for (const x of [-900, 900]) box(bed, 'steel', x, 0, 320, 80, 1400, 160)
  for (let index = 0; index < 14; index++)
    cylinder(bed, 'steel', 0, -620 + index * 95, 390, 60, 1740, true)
  for (const [level, z] of [950, 1950].entries()) {
    for (const side of [-1, 1]) {
      const jaw = assembly(centering, `centering-jaw-${level + 1}-${side < 0 ? 'left' : 'right'}`)
      box(jaw, 'machineGray', side * 1120, 0, z, 170, 1100, 180)
      for (const y of [-340, 340]) {
        cylinder(jaw, 'dark', side * 1040, y, z, 110, 260, true)
        cylinder(jaw, 'steel', side * 900, y, z, 46, 210, true)
      }
      box(jaw, 'paint', side * 780, 0, z, 65, 1020, 480)
      box(jaw, 'rubber', side * 740, 0, z, 22, 940, 400)
    }
    const stop = assembly(centering, `centering-rear-stop-${level + 1}`)
    box(stop, 'machineGray', 0, 725, z, 2000, 110, 110)
    box(stop, 'rubber', 0, 650, z, 1300, 50, 340)
  }
  const controls = assembly(centering, 'centering-operator-panel')
  consolePanel(controls, 1080, -890, 1560)
  for (let index = 0; index < 10; index++)
    box(controls, index % 2 ? 'dark' : 'warning', -540 + index * 120, -840, 180, 112, 25, 100)
  for (const part of centering.children) compact(part)
  await save('centering-station', '2단 적재물 센터 정렬 설비', 'equipment', centering)

  const conveyor = new THREE.Group()
  conveyor.name = 'double-deck-wide-conveyor'
  const supports = assembly(conveyor, 'conveyor-frame')
  for (const x of [-3100, -1030, 1030, 3100])
    for (const y of [-680, 680]) {
      box(supports, 'machineFrame', x, y, 1510, 110, 110, 3020)
      box(supports, 'dark', x, y, 20, 190, 190, 40)
    }
  for (const [index, z] of [401, 3000].entries()) {
    const deck = assembly(conveyor, `conveyor-level-${index + 1}`)
    for (const y of [-690, 690]) {
      box(deck, 'machineFrame', 0, y, z - 70, 6500, 110, 170)
      box(deck, 'paint', 0, y, z + 120, 6500, 60, 80)
      box(deck, 'warning', 0, y, z + 165, 6500, 65, 12)
    }
    for (let roller = 0; roller < 49; roller++)
      depthRoller(deck, -3120 + roller * 130, 0, z, 70, 1260)
    for (const x of [-3190, 3190]) box(deck, 'rubber', x, 0, z + 55, 35, 1260, 60)
    box(deck, 'machineFrame', -2900, 800, z - 70, 350, 220, 220)
    box(deck, 'dark', -2900, 930, z - 70, 260, 60, 170)
    box(deck, 'paint', -3020, -780, z + 45, 160, 20, 200)
    const segments =
      index === 0
        ? [
            [45, 45, 22, 65],
            [45, -45, 22, 65],
          ]
        : [
            [0, 85, 110, 20],
            [45, 45, 22, 65],
            [0, 0, 110, 20],
            [-45, -45, 22, 65],
            [0, -85, 110, 20],
          ]
    for (const [x, dz, width, height] of segments)
      box(deck, 'dark', -3020 + x, -796, z + 45 + dz, width, 12, height)
    compact(deck)
  }
  const panel = assembly(conveyor, 'conveyor-control-panel')
  consolePanel(panel, 2850, -850, 1560)
  compact(supports)
  compact(panel)
  await save('double-deck-conveyor', '가로형 2층 롤러 컨베이어', 'conveyor', conveyor)
  for (const state of ['closed', 'open']) {
    const shutter = new THREE.Group()
    shutter.name = `quick-shutter-${state}`
    const structure = assembly(shutter, 'quick-shutter-frame')
    for (const x of [-1700, 1700]) {
      box(structure, 'steel', x, 0, 1900, 180, 260, 3800)
      box(structure, 'paint', x, -150, 1900, 190, 40, 3800)
      box(structure, 'dark', x, 0, 20, 300, 340, 40)
      box(structure, 'dark', x < 0 ? x + 98 : x - 98, 0, 1900, 16, 170, 3780)
      box(structure, 'warning', x, -180, 280, 150, 28, 480)
      for (let index = 0; index < 4; index++)
        box(structure, 'dark', x, -198, 110 + index * 110, 155, 12, 36)
      box(structure, 'dark', x, -202, 600, 80, 65, 100)
      box(structure, 'buttonGreen', x, -240, 600, 30, 15, 30)
    }
    box(structure, 'steel', 0, 0, 4025, 4100, 500, 450)
    box(structure, 'paint', 0, -265, 4025, 4080, 30, 420)
    box(structure, 'dark', 0, -285, 3820, 3240, 20, 35)
    box(structure, 'machineFrame', 1880, 30, 4030, 250, 350, 300)
    cylinder(structure, 'dark', 2015, 30, 4030, 200, 35, true)
    const curtain = assembly(shutter, 'quick-shutter-curtain')
    const lower = state === 'closed' ? 55 : 3740
    const upper = 3790
    if (state === 'closed') {
      box(curtain, 'shutterCurtain', 0, 0, (lower + 1950) / 2, 3200, 22, 1950 - lower)
      box(curtain, 'shutterCurtain', 0, 0, (2270 + upper) / 2, 3200, 22, upper - 2270)
      for (const x of [-1080, -360, 360, 1080])
        box(curtain, 'shutterWindow', x, 0, 2110, 600, 16, 320)
      for (const [x, width] of [
        [-1490, 220],
        [-720, 120],
        [0, 120],
        [720, 120],
        [1490, 220],
      ])
        box(curtain, 'shutterCurtain', x, 0, 2110, width, 22, 320)
      for (const y of [-13, 13])
        for (const z of [1950, 2270]) box(curtain, 'shutterSeam', 0, y, z, 3200, 5, 20)
      for (const z of [520, 1000, 1480, 2750, 3230, 3700])
        box(curtain, 'shutterSeam', 0, -14, z, 3190, 5, 9)
    } else box(curtain, 'shutterCurtain', 0, 0, (lower + upper) / 2, 3200, 22, upper - lower)
    const railHeight = state === 'closed' ? 32.5 : lower + 20
    box(curtain, 'dark', 0, 0, railHeight, 3220, 75, 65)
    box(curtain, 'warning', 0, -42, railHeight, 3180, 12, 18)
    const operator = assembly(shutter, 'quick-shutter-operator-panel')
    consolePanel(operator, -1850, -240, 1420)
    for (const part of shutter.children) compact(part)
    await save(
      `quick-shutter-${state}`,
      `퀵셔터 · ${state === 'closed' ? '닫힘' : '열림'}`,
      'equipment',
      shutter,
    )
  }
  merged.forEach((geometry) => geometry.dispose())
}
