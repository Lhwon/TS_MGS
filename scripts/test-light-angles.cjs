/**
 * 편집기와 관제의 개별 조명 계약 및 방향 계산과 조명 캐시 호환성 검증
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { performance } = require('node:perf_hooks')
const ts = require('typescript')
const modules = new Map()

/** 각 프로젝트의 실제 타입스크립트와 의존성을 사용하는 테스트 모듈 로딩 */
const load = (filename) => {
  const target = path.resolve(filename)
  if (modules.has(target)) return modules.get(target)
  const exports = {}
  modules.set(target, exports)
  const source = ts.transpileModule(fs.readFileSync(target, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const external = createRequire(target)
  let project = path.dirname(target)
  while (!fs.existsSync(path.join(project, 'package.json'))) project = path.dirname(project)
  new Function('exports', 'require', source)(exports, (name) => {
    if (!name.startsWith('.') && !name.startsWith('@/')) return external(name)
    const resolved = name.startsWith('@/')
      ? path.join(project, 'src', name.slice(2))
      : path.resolve(path.dirname(target), name)
    return resolved.endsWith('.json')
      ? external(resolved)
      : load(resolved.endsWith('.ts') ? resolved : resolved + '.ts')
  })
  return exports
}

/** 모델 기본값과 배치 재정의 및 오류 입력의 양쪽 계약 일치 검증 */
const checkContract = (contract) => {
  const doc = contract.emptyFacilityDocument()
  doc.version = 2
  const light = {
    kind: 'spot',
    temperature: 4000,
    direction: 15,
    tilt: 10,
    beamAngle: 80,
    penumbra: 0.65,
  }
  doc.assets = [
    {
      id: 'lamp',
      name: '조명',
      kind: 'equipment',
      catalogCategory: 'lighting',
      parts: [],
      light,
      glb: {
        uri: 'models/lamp.glb',
        hash: 'a'.repeat(64),
        sourceName: 'lamp.glb',
        size: { x: 200, y: 200, z: 100 },
      },
    },
  ]
  doc.instances = ['a', 'b'].map((id) => ({
    id,
    assetId: 'lamp',
    name: id,
    position: { x: 0, y: 0, z: 3000 },
    rotation: 0,
  }))
  doc.instances[0].light = { direction: 90, tilt: 45, beamAngle: 35, penumbra: 0.2 }
  const parsed = contract.parseFacilityDocument(JSON.stringify(doc))
  assert.deepEqual(parsed.instances[0].light, doc.instances[0].light)
  assert.equal(parsed.instances[1].light, undefined)
  assert.deepEqual(parsed.assets[0].light, light)
  for (const bad of [
    { direction: -1 },
    { direction: 361 },
    { tilt: 91 },
    { beamAngle: 0 },
    { beamAngle: 161 },
    { penumbra: 1.01 },
    { tilt: '30' },
    { tilt: null },
    [],
  ]) {
    const invalid = structuredClone(doc)
    invalid.instances[0].light = bad
    assert.throws(() => contract.parseFacilityDocument(JSON.stringify(invalid)), /조명/)
    invalid.instances[0].light = {}
    invalid.assets[0].light = { ...light, ...bad }
    if (!Array.isArray(bad))
      assert.throws(() => contract.parseFacilityDocument(JSON.stringify(invalid)), /조명/)
  }
  delete doc.assets[0].light
  doc.assets[0].catalogCategory = 'equipment'
  assert.throws(() => contract.parseFacilityDocument(JSON.stringify(doc)), /조명/)
  return parsed
}

/** 조명 수와 무관한 렌더링 구조와 높이별 입사 방향 계산 검증 */
const checkLighting = (root, utilities, unit) => {
  const THREE = createRequire(path.join(root, 'package.json'))('three')
  const { createFacilityLights } = load(
    path.join(
      root,
      utilities ? 'src/widgets/digital-twin/engine/glbLights.ts' : 'packages/map3d/glbLights.ts',
    ),
  )
  const { bakeFacilityFloorLightMap } = load(
    path.join(
      root,
      utilities
        ? 'src/widgets/digital-twin/engine/facilityFloorLightMap.ts'
        : 'packages/map3d/facilityFloorLightMap.ts',
    ),
  )
  const fixtures = createFacilityLights()
  const fixture = {
    fixture: { kind: 'spot', temperature: 4000 },
    color: 0xffffff,
    bounds: new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()),
  }
  const placement = new THREE.Matrix4().makeTranslation(0, 0, 3000 * unit)
  fixtures.update('a', fixture, placement, 1, {
    direction: 0,
    tilt: 45,
    beamAngle: 40,
    penumbra: 0.3,
  })
  const first = fixtures.group.children[0]
  assert(Math.abs(first.userData.fixtureDirection[0] - Math.SQRT1_2) < 0.000001)
  assert(Math.abs(first.userData.fixtureDirection[2] + Math.SQRT1_2) < 0.000001)
  assert.equal(first.angle, THREE.MathUtils.degToRad(20))
  assert.equal(first.penumbra, 0.3)
  assert.equal(first.layers.mask, 0)
  assert.equal(first.castShadow, false)
  const baked = bakeFacilityFloorLightMap([], fixtures.group, unit)
  assert(baked?.volume)
  assert.equal(baked.volume.slices, 8)
  const pixels = baked.texture.image.data,
    width = baked.volume.width,
    rows = baked.volume.rows
  let energy = 0,
    center = 0
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < width; x++) {
      const weight = pixels[(y * width + x) * 4]
      energy += weight
      center += weight * (baked.bounds.min.x + ((x + 0.5) * baked.size.x) / width)
    }
  assert(energy > 0)
  assert(center / energy > 2000 && center / energy < 4000)
  const data = Array.from(baked.volume.color.image.data)
  let disposed = 0
  for (const texture of [baked.texture, baked.volume.color, baked.volume.direction])
    texture.addEventListener('dispose', () => disposed++)
  baked.dispose()
  assert.equal(disposed, 3)
  fixtures.update('a', fixture, placement, 1, {
    direction: 90,
    tilt: 90,
    beamAngle: 40,
    penumbra: 0,
  })
  assert.equal(fixtures.group.children[0], first)
  assert.equal(fixtures.group.children.length, 1)
  const horizontal = bakeFacilityFloorLightMap([], fixtures.group, unit)
  assert(horizontal.volume.color.image.data.some((value, index) => index % 4 < 3 && value > 0))
  horizontal.dispose()
  fixtures.update('a', fixture, placement, 1, { tilt: 0, beamAngle: 1, penumbra: 1 })
  const narrow = bakeFacilityFloorLightMap([], fixtures.group, unit)
  assert(narrow.texture.image.data.some((value, index) => index % 4 < 3 && value > 0))
  narrow.dispose()
  const started = performance.now()
  for (let i = 0; i < 32; i++)
    fixtures.update(String(i), fixture, placement, 1, { direction: i * 10, tilt: 35 })
  const batch = bakeFacilityFloorLightMap([], fixtures.group, unit)
  const milliseconds = performance.now() - started
  assert(fixtures.group.children.every((light) => light.layers.mask === 0 && !light.castShadow))
  batch.dispose()
  fixtures.clear()
  assert.equal(fixtures.group.children.length, 0)
  return { data, milliseconds }
}

const mgs = process.cwd(),
  ui = path.resolve(mgs, '../../total_solution/TS_UI')
const mgsDocument = checkContract(load('packages/map3d/index.ts'))
global.document = {}
const mgsLighting = checkLighting(mgs, false, 0.001)
if (fs.existsSync(path.join(ui, 'package.json'))) {
  assert.deepEqual(
    checkContract(load(path.join(ui, 'src/widgets/digital-twin/utils/facilityDocument.ts'))),
    mgsDocument,
  )
  const uiLighting = checkLighting(ui, true, 1)
  assert.deepEqual(uiLighting.data, mgsLighting.data)
  console.log(
    `조명 계약 및 배광 캐시 호환 검증 통과 · 조명 일괄 계산 MGS ${mgsLighting.milliseconds.toFixed(1)}ms UI ${uiLighting.milliseconds.toFixed(1)}ms`,
  )
} else console.log('편집기 조명 검증 통과 · 관제 프로젝트 부재로 교차 검증 생략')
delete global.document
