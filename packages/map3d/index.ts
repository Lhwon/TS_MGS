import { decodeEmbeddedGlb, embeddedGlbPartCount } from './glbData'
import { normalizeCargoDocument } from './cargo'
import { parseFloorAreas, type FloorArea } from './floorAreas'
import { legacyFacilityLight, minLightTemperature, maxLightTemperature, type FacilityLight } from './facilityLights'
import { parseWallDoors, wallOpeningPartBudget, type WallDoor } from './wallDoors'
import { parseSceneResource } from './sceneResources'
import type { SceneResource } from './sceneResources'
export * from './sceneResources'
export * from './wallDoors'
export * from './floorAreas'
export * from './facilityLights'
export { normalizeCargoDocument, standardCargoAsset } from './cargo'
export { decodeEmbeddedGlb, MAX_GLB_BYTES } from './glbData'
export * from './surfaceMaterials'
/**
 * 파일명: index.ts
 * 설명: 편집기와 사용자 화면이 공유하는 설비 모델 계약과 파일 검증 및 형상 생성
 * 작성자: 이희원
 * 작성일자: 2026-10-20
 */
// 편집기와 사용자 화면이 공유하는 평면 좌표 및 높이와 밀리미터 단위 계약
import { surfaceMaterials, type SurfaceMaterial } from './surfaceMaterials'

export interface Point3 {
  x: number
  y: number
  z: number
}
export interface FacilityPart {
  id: string
  name: string
  shape: 'box' | 'cylinder'
  position: Point3
  size: Point3
  rotation: number
  tiltX?: number
  tiltY?: number
  color: string
  surface?: SurfaceMaterial
  opacity?: number
  wall?: true
}
/** 내장 바이너리와 외부 리소스 참조를 공통 치수로 표현 */
export type FacilityGlb = { size: Point3; sourceName: string } &
  ({ data: string; uri?: never; hash?: never } | (SceneResource & { data?: never }))

export interface FacilityAsset {
  id: string
  name: string
  kind: 'rack' | 'shelf' | 'equipment' | 'conveyor'
  parts: FacilityPart[]
  catalogCategory?: 'equipment' | 'interior' | 'lighting'
  light?: FacilityLight
  glb?: FacilityGlb
  design?: {
    width: number
    depth: number
    height: number
    bays: number
    levels: number
    frame: number
    color: string
  }
}
export type FacilityCutawayRole = 'wall' | 'ceiling' | 'independent'
export const facilityCeilingAssetId = 'interior-ceiling'

export interface FacilityInstance {
  id: string
  assetId: string
  name: string
  position: Point3
  rotation: number
  scale?: Point3
  cutawayRole?: FacilityCutawayRole
  attachedTo?: string
  wallOpacity?: number
  wallDoors?: WallDoor[]
  carrierRotation?: number
  portId?: string
  // 실제 포트 연결을 위한 상대 위치이며 구버전 포트 식별자만 있는 경우에는 메타데이터로 유지하는 정보
  portOffset?: Point3
  nodeId?: number
}

export const facilityLight = (asset: FacilityAsset) =>
  asset.glb ? asset.light ?? legacyFacilityLight(asset.glb.sourceName) : undefined
export const facilityCutawayRole = (instance: FacilityInstance, asset?: FacilityAsset) => {
  if (instance.cutawayRole === 'independent') return undefined
  if (instance.cutawayRole) return instance.cutawayRole
  if (asset?.id === facilityCeilingAssetId) return 'ceiling'
  if (asset?.parts.some((part) => part.wall)) return 'wall'
  return undefined
}

export interface FacilityDocument {
  format: 'bem-map3d'
  version: 1 | 2
  units: 'mm'
  coordinates: 'mgs-xy-z-up'
  mapRef: {
    name: string
    geometryKey: string
  }
  assets: FacilityAsset[]
  instances: FacilityInstance[]
  floors?: FloorArea[]
}
export const MAX_SCENE_BYTES = 32 * 1024 * 1024
export const MAX_PART_INSTANCES = 100000
const minModelSizeMm = 1
const maxModelSizeMm = 100000
const minPlacementScale = 0.001
const maxPlacementScale = 1000
const defaultScaleLimits = {
  minimum: { x: minPlacementScale, y: minPlacementScale, z: minPlacementScale },
  maximum: { x: maxPlacementScale, y: maxPlacementScale, z: maxPlacementScale },
}

/**
 * 기존 배치 배율을 보존하면서 GLB는 기준 치수와 관계없이 제작 가능한 실측 크기까지 허용
 * @param glbSize 밀리미터로 기록된 GLB의 가로와 세로 및 높이
 * @returns 배치 입력과 파일 검증에서 공통으로 사용하는 축별 배율 범위
 */
export const facilityScaleLimits = (glbSize?: Point3) => {
  if (!glbSize) return defaultScaleLimits

  const min = (size: number) => Math.min(minPlacementScale, minModelSizeMm / size)
  const max = (size: number) => Math.max(maxPlacementScale, maxModelSizeMm / size)
  return {
    minimum: { x: min(glbSize.x), y: min(glbSize.y), z: min(glbSize.z) },
    maximum: { x: max(glbSize.x), y: max(glbSize.y), z: max(glbSize.z) },
  }
}
/**
 * 단위와 좌표계를 고정한 빈 설비 설계 문서를 만드는 초기 데이터 생성
 * @returns 모델과 배치가 비어 있는 기본 설계 문서
 */
export const emptyFacilityDocument = (): FacilityDocument => {
  return {
    format: 'bem-map3d',
    version: 1,
    units: 'mm',
    coordinates: 'mgs-xy-z-up',
    mapRef: { name: '', geometryKey: '' },
    assets: [],
    instances: [],
  }
}
// 레코드 순서와 분기 중복을 제외하고 노드 위치를 대조하기 위한 맵 연결 식별값
/**
 * 고유 노드 식별자와 좌표를 정렬하여 기준 맵 식별값을 만드는 연결 키 생성
 * 레코드 순서와 동일 분기 중복을 제외하며 보안 무결성 검증으로 사용하지 않는 맵 정합성 확인
 *
 * @param nodes 노드 식별자와 지도 좌표를 포함하는 노드 목록
 * @returns 노드 집합과 위치를 구분하는 기준 맵 연결 식별값
 */
export const mapGeometryKey = (
  nodes: {
    id: number
    x: number
    y: number
  }[],
): string => {
  const unique = new Map(nodes.map((n) => [n.id, n]))
  const text = [...unique.values()]
    .sort((a, b) => a.id - b.id)
    .map((n) => `${n.id},${n.x},${n.y}`)
    .join(';')
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0
  return `mgs1-${unique.size}-${hash.toString(16).padStart(8, '0')}`
}
/**
 * 설비 문서의 형식과 단위 및 모델 참조를 검증하는 설계 데이터 역직렬화
 * 모델과 부품 및 배치의 제한과 치수 및 포트 연결 구조를 확인하는 공유 데이터 검증
 *
 * @param content 파일에서 읽은 원본 문자열
 * @param upgradeCargo 구형 내장 캐리어의 기준 원본 교체 여부
 * @returns 모델과 배치의 공유 계약 검증을 통과한 설계 문서
 */
export const parseFacilityDocument = (content: string, upgradeCargo = true): FacilityDocument => {
  if (new TextEncoder().encode(content).length > MAX_SCENE_BYTES)
    throw new Error('3D 지도는 32MB 이하여야 합니다.')
  return validateFacilityDocument(JSON.parse(content.replace(/^\uFEFF/, '')), upgradeCargo)
}

/** 편집 중에는 기존 내장 모델과 신규 외부 모델을 함께 검증 */
export const validateFacilityDraft = (document: FacilityDocument) =>
  validateFacilityDocument(document, false, undefined, true)

/** 운영 설계와 선택적인 미배치 편집 라이브러리를 복원 */
export const parseFacilitySceneFile = (file: import('./sceneResources').SceneFile) => {
  if (file.library) return importFacilityFiles(file.content, file.library)
  const project = parseFacilityDocument(file.content)
  if (!file.catalog || project.version !== 2) return project
  const catalog = JSON.parse(file.catalog)
  if (catalog.format !== 'bem-map3d-catalog' || catalog.version !== 2 || !Array.isArray(catalog.assets))
    throw new Error('편집용 모델 목록 형식을 확인하세요.')
  return validateFacilityDraft({ ...project, assets: [...project.assets, ...catalog.assets] })
}

const glbCosts = new WeakMap<FacilityAsset, number>()
const libraryBytes = new WeakMap<FacilityAsset[], number>()

/** 편집 중에는 이미 검증한 라이브러리를 재사용하고 새 배치 데이터만 검증 */
export const validateFacilityPlacements = (source: FacilityDocument, instances: FacilityInstance[]) => {
  let bytes = libraryBytes.get(source.assets)
  if (bytes === undefined) {
    const library = source.assets.map((asset) =>
      asset.glb ? { ...asset, glb: { ...asset.glb, data: '' } } : asset,
    )
    bytes = new TextEncoder().encode(JSON.stringify(library)).length +
      source.assets.reduce((length, asset) => length + (asset.glb?.data?.length ?? 0), 0)
    libraryBytes.set(source.assets, bytes)
  }
  const next = { ...source, instances }
  const withoutLibrary = new TextEncoder().encode(JSON.stringify({ ...next, assets: [] })).length
  if (bytes + withoutLibrary - 2 > MAX_SCENE_BYTES)
    throw new Error('3D 지도는 32MB 이하여야 합니다.')
  return validateFacilityDocument(next, false, source, true)
}

/** 파일 전체와 검증된 설계의 배치 수정에 공통 계약을 적용 */
const validateFacilityDocument = (
  input: unknown,
  upgradeCargo: boolean,
  validated?: FacilityDocument,
  draft = false,
): FacilityDocument => {
  /**
   * 배열과 빈 값을 제외한 데이터 객체만 허용하는 입력 구조 검증
   *
   * @param v 외부 파일에서 읽어 검증할 원본 값
   * @returns 객체 형태 검증을 통과한 데이터 레코드
   */
  const record = (v: unknown): Record<string, any> => {
    if (!v || typeof v !== 'object' || Array.isArray(v))
      throw new Error('3D 지도 객체가 잘못되었습니다.')
    return v as Record<string, any>
  }
  /**
   * 문자열 자료형과 최대 길이를 확인하는 공유 데이터 문자열 검증
   *
   * @param v 외부 파일에서 읽어 검증할 원본 값
   * @returns 길이 제한 검증을 통과한 문자열
   */
  const str = (v: unknown) => {
    if (typeof v !== 'string' || v.length > 300) throw new Error('3D 지도 문자열이 잘못되었습니다.')
    return v
  }
  /**
   * 유한한 숫자와 허용 범위를 확인하여 잘못된 치수 및 좌표를 거부하는 수치 검증
   *
   * @param v 외부 파일에서 읽어 검증할 원본 값
   * @param min 허용되는 최솟값
   * @param max 허용되는 최댓값
   * @returns 허용 범위 안의 유한한 수치
   */
  const num = (v: unknown, min = -1e9, max = 1e9) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
      throw new Error('치수·좌표 범위를 확인하세요.')
    return v
  }
  /**
   * 유한 범위 검증에 정수 조건을 추가하는 칸수 및 단수 검증
   *
   * @param v 외부 파일에서 읽어 검증할 원본 값
   * @param min 허용되는 최솟값
   * @param max 허용되는 최댓값
   * @returns 허용 범위 안의 정수
   */
  const integer = (v: unknown, min: number, max: number) => {
    const n = num(v, min, max)
    if (!Number.isInteger(n)) throw new Error('칸수·단수는 정수여야 합니다.')
    return n
  }
  /**
   * 색상 문자열의 길이와 채널 표현을 확인하는 부품 색상 검증
   *
   * @param v 외부 파일에서 읽어 검증할 원본 값
   * @returns 검증과 기본값 적용을 완료한 색상 값
   */
  const color = (v: unknown) => {
    const s = str(v)
    if (!/^#[0-9a-f]{6}$/i.test(s)) throw new Error('색상은 #RRGGBB 형식이어야 합니다.')
    return s
  }
  /**
   * 좌표와 크기의 서로 다른 허용 범위를 적용하는 공간 벡터 검증
   *
   * @param v 외부 파일에서 읽어 검증할 원본 값
   * @param size 좌표 범위 대신 양수 치수 범위의 적용 여부
   * @returns 좌표 또는 치수 조건을 통과한 공간 벡터
   */
  const point = (v: unknown, size = false): Point3 => {
    const p = record(v)
    return {
      x: num(p.x, size ? minModelSizeMm : -1e9, size ? maxModelSizeMm : 1e9),
      y: num(p.y, size ? minModelSizeMm : -1e9, size ? maxModelSizeMm : 1e9),
      z: num(p.z, size ? minModelSizeMm : -1e9, size ? maxModelSizeMm : 1e9),
    }
  }
  /**
   * 배열 자료형과 최대 항목 수를 확인하는 설비 목록 검증
   *
   * @param v 외부 파일에서 읽어 검증할 원본 값
   * @param max 허용되는 최댓값
   * @returns 최대 항목 수 검증을 통과한 데이터 목록
   */
  const list = (v: unknown, max: number): unknown[] => {
    if (!Array.isArray(v) || v.length > max)
      throw new Error('3D 지도 항목 수가 제한을 초과했습니다.')
    return v
  }
  /**
   * 비어 있거나 허용 범위를 벗어난 식별자를 거부하는 참조 식별자 검증
   *
   * @param v 외부 파일에서 읽어 검증할 원본 값
   * @returns 형식 검증을 통과한 고유 식별자
   */
  const identifier = (v: unknown) => {
    const s = str(v)
    if (!s) throw new Error('3D ID가 비어 있습니다.')
    return s
  }
  /**
   * 동일 식별자가 여러 항목에 사용되는 것을 방지하는 중복 검증
   *
   * @param ids 중복 여부를 확인할 식별자 목록
   */
  const unique = (ids: string[]) => {
    if (new Set(ids).size !== ids.length) throw new Error('3D ID가 중복되었습니다.')
  }
  const data = record(input)
  if (
    data.format !== 'bem-map3d' ||
    (data.version !== 1 && data.version !== 2) ||
    data.units !== 'mm' ||
    data.coordinates !== 'mgs-xy-z-up'
  )
    throw new Error('지원하는 BEM 3D 설계 파일이 필요합니다.')
  const reference = data.mapRef === undefined ? {} : record(data.mapRef)
  const result = emptyFacilityDocument()
  result.version = data.version
  /** 구형 파일의 맵 참조를 선택적인 편집 메타데이터로 복원 */
  result.mapRef = {
    name: reference.name === undefined ? '' : str(reference.name),
    geometryKey: reference.geometryKey === undefined ? '' : str(reference.geometryKey),
  }
  const floors = validated ? validated.floors : parseFloorAreas(data.floors, draft || data.version === 2)
  if (floors?.length) result.floors = floors
  result.assets = validated?.assets ?? list(data.assets, 500).map((value) => {
    const a = record(value)
    if (!['rack', 'shelf', 'equipment', 'conveyor'].includes(a.kind))
      throw new Error('지원하지 않는 모델 종류입니다.')
    const parts = list(a.parts ?? [], 10000).map((value) => {
      const p = record(value)
      if (!['box', 'cylinder'].includes(p.shape))
        throw new Error('지원하지 않는 설비 부품 도형입니다.')
      if (p.wall !== undefined && p.wall !== true) throw new Error('벽체 부품 표시가 잘못되었습니다.')
      if (p.surface !== undefined && (typeof p.surface !== 'string' || !Object.hasOwn(surfaceMaterials, p.surface)))
        throw new Error('지원하지 않는 부품 재질입니다.')
      return {
        id: identifier(p.id),
        name: str(p.name),
        shape: p.shape,
        position: point(p.position),
        size: point(p.size, true),
        rotation: num(p.rotation),
        color: color(p.color),
        ...(p.surface === undefined ? {} : { surface: p.surface }),
        ...(p.tiltX === undefined ? {} : { tiltX: num(p.tiltX) }),
        ...(p.tiltY === undefined ? {} : { tiltY: num(p.tiltY) }),
        ...(p.opacity === undefined ? {} : { opacity: num(p.opacity, 0, 1) }),
        ...(p.wall === true ? { wall: true } : {}),
      } as FacilityPart
    })
    if (!parts.length && a.glb === undefined) throw new Error('부품 또는 GLB 모델이 필요합니다.')
    if (parts.length && a.glb !== undefined)
      throw new Error('부품 모델과 GLB 모델을 함께 지정할 수 없습니다.')
    unique(parts.map((p) => p.id))
    const asset: FacilityAsset = { id: identifier(a.id), name: str(a.name), kind: a.kind, parts }
    if (a.catalogCategory === 'equipment' || a.catalogCategory === 'interior' || a.catalogCategory === 'lighting')
      asset.catalogCategory = a.catalogCategory
    if (a.glb !== undefined) {
      const glb = record(a.glb)
      const metadata = { size: point(glb.size, true), sourceName: str(glb.sourceName) }
      if ((draft || data.version === 1) && typeof glb.data === 'string' && glb.uri === undefined && glb.hash === undefined) {
        const cost = embeddedGlbPartCount(decodeEmbeddedGlb(glb.data))
        if (cost > 2048) throw new Error('GLB 도형은 모델당 2048개 이하여야 합니다.')
        glbCosts.set(asset, cost)
        asset.glb = { data: glb.data, ...metadata }
      } else if ((draft || data.version === 2) && glb.data === undefined) {
        asset.glb = { ...metadata, ...parseSceneResource(glb, false, draft) }
      } else throw new Error('설계 버전에 맞는 GLB 데이터 또는 외부 참조가 필요합니다.')
    }
    if (a.light !== undefined || a.catalogCategory === 'lighting') {
      const light = record(a.light)
      if (!asset.glb || (light.kind !== 'spot' && light.kind !== 'line'))
        throw new Error('GLB 조명 모델과 조명 종류를 확인하세요.')
      asset.light = {
        kind: light.kind,
        temperature: integer(light.temperature, minLightTemperature, maxLightTemperature),
      }
    }
    if (a.design !== undefined) {
      const d = record(a.design)
      asset.design = {
        width: num(d.width, 100, 100000),
        depth: num(d.depth, 100, 100000),
        height: num(d.height, 100, 100000),
        bays: integer(d.bays, 1, 50),
        levels: integer(d.levels, 1, 50),
        frame: num(d.frame, 5, 500),
        color: color(d.color),
      }
    }
    return asset
  })
  unique(result.assets.map((a) => a.id))
  const assets = new Map(result.assets.map((a) => [a.id, a]))
  result.instances = list(data.instances, 10000).map((value) => {
    const i = record(value)
    const instance: FacilityInstance = {
      id: identifier(i.id),
      assetId: identifier(i.assetId),
      name: str(i.name),
      position: point(i.position),
      rotation: num(i.rotation),
    }
    const asset = assets.get(instance.assetId)
    if (!asset) throw new Error('배치된 시설의 모델이 없습니다.')
    if (i.scale !== undefined) {
      const scale = record(i.scale)
      const { minimum, maximum } = facilityScaleLimits(asset.glb?.size)
      instance.scale = {
        x: num(scale.x, minimum.x, maximum.x),
        y: num(scale.y, minimum.y, maximum.y),
        z: num(scale.z, minimum.z, maximum.z),
      }
    }
    const doors = parseWallDoors(i.wallDoors, instance, asset)
    if (doors?.length) instance.wallDoors = doors
    if (i.wallOpacity !== undefined) instance.wallOpacity = num(i.wallOpacity, 0, 1)
    if (i.portId !== undefined) instance.portId = str(i.portId)
    if (i.carrierRotation !== undefined) instance.carrierRotation = num(i.carrierRotation)
    if (i.portOffset !== undefined) {
      if (!instance.portId) throw new Error('포트 기준 배치에는 Port ID가 필요합니다.')
      instance.portOffset = point(i.portOffset)
    }
    if (i.nodeId !== undefined) instance.nodeId = integer(i.nodeId, 0, 1e9)
    if (i.cutawayRole !== undefined) {
      if (i.cutawayRole !== 'wall' && i.cutawayRole !== 'ceiling' && i.cutawayRole !== 'independent')
        throw new Error('구조물 분류를 확인하세요.')
      instance.cutawayRole = i.cutawayRole
    }
    if (i.attachedTo !== undefined) instance.attachedTo = identifier(i.attachedTo)
    return instance
  })
  unique(result.instances.map((i) => i.id))
  if (result.instances.some((instance) => instance.attachedTo)) {
    const structures = new Set(result.instances
      .filter((instance) => facilityCutawayRole(instance, assets.get(instance.assetId)))
      .map((instance) => instance.id))
    for (const instance of result.instances) {
      if (instance.attachedTo && (structures.has(instance.id) || !structures.has(instance.attachedTo))) {
        if (data.version === 2 && !draft) throw new Error('구조물 부착 대상이 없거나 순환 연결입니다.')
        delete instance.attachedTo
      }
    }
  }
  /** 연결된 모델을 삭제하거나 분리하면 대응 개구부도 정리 */
  if (result.instances.some((instance) => instance.wallDoors?.some((opening) => opening.modelId))) {
    const byId = new Map(result.instances.map((instance) => [instance.id, instance]))
    for (const wall of result.instances) {
      if (!wall.wallDoors?.some((opening) => opening.modelId)) continue
      const linked = new Set<string>()
      wall.wallDoors = wall.wallDoors.filter((opening) => {
        if (!opening.modelId) return true
        const model = byId.get(opening.modelId)
        if (model?.attachedTo !== wall.id || !assets.get(model.assetId)?.glb || linked.has(model.id)) return false
        linked.add(model.id)
        return true
      })
      if (!wall.wallDoors.length) delete wall.wallDoors
    }
  }
  if (
    result.instances.reduce(
      (sum, instance) => {
        const asset = assets.get(instance.assetId)!
        if (!asset.glb) return sum + (instance.wallDoors ? wallOpeningPartBudget(instance.wallDoors) : asset.parts.length)
        if (!asset.glb.data) return sum + 1
        let cost = glbCosts.get(asset)
        if (cost === undefined) {
          cost = embeddedGlbPartCount(decodeEmbeddedGlb(asset.glb.data))
          if (cost > 2048) throw new Error('GLB 도형은 모델당 2048개 이하여야 합니다.')
          glbCosts.set(asset, cost)
        }
        return sum + cost
      },
      0,
    ) > MAX_PART_INSTANCES
  )
    throw new Error('배치 부품은 총 100,000개 이하여야 합니다.')
  return upgradeCargo && result.version === 1 ? normalizeCargoDocument(result) : result
}
/**
 * 검증된 폭과 깊이 및 높이를 기준으로 기둥과 선반 및 보를 만드는 랙 모델 생성
 * 대량 부품 생성 전에 칸수와 단수 및 최소 간격을 확인하는 설계 범위 보호
 *
 * @param id 조회하거나 편집할 대상의 고유 식별자
 * @param name 파일 또는 모델을 구분하는 표시 이름
 * @param kind 랙과 선반 및 조합 설비를 구분하는 설계 종류
 * @param design 폭과 깊이 및 높이와 구조 개수를 포함하는 모델 설계 치수
 * @returns 생성한 기둥과 보 및 선반 부품을 포함하는 랙 모델
 */
export const designRack = (
  id: string,
  name: string,
  kind: 'rack' | 'shelf',
  design: NonNullable<FacilityAsset['design']>,
): FacilityAsset => {
  // 부품 배열을 만들기 전에 칸수와 단수를 검증하는 대량 할당 방지
  const shell = emptyFacilityDocument()
  shell.assets = [
    {
      id,
      name,
      kind,
      design,
      parts: [
        {
          id: 'check',
          name: '',
          shape: 'box',
          position: { x: 0, y: 0, z: 0 },
          size: { x: 1, y: 1, z: 1 },
          rotation: 0,
          color: design.color,
        },
      ],
    },
  ]
  const d = parseFacilityDocument(JSON.stringify(shell)).assets[0]!.design!
  if (d.width / d.bays < d.frame * 3 || d.depth < d.frame * 3 || d.height / d.levels < d.frame * 3)
    throw new Error('기둥 두께보다 칸 폭·선반 간격·깊이가 충분히 커야 합니다.')
  const parts: FacilityPart[] = []
  /**
   * 로컬 중심 위치와 치수를 가진 박스 부품을 모델 목록에 추가하는 기본 부품 생성
   *
   * @param name 파일 또는 모델을 구분하는 표시 이름
   * @param x 지도 또는 모델 기준 가로 좌표
   * @param y 지도 또는 모델 기준 세로 좌표
   * @param z 지도 바닥을 기준으로 하는 높이 좌표
   * @param w 외곽 가로 길이
   * @param depth 모델의 세로 깊이
   * @param h 외곽 높이 또는 세로 길이
   * @param color 렌더링에 사용할 부품 또는 정점 색상
   * @returns 부품 추가 후의 모델 부품 개수
   */
  const box = (
    name: string,
    x: number,
    y: number,
    z: number,
    w: number,
    depth: number,
    h: number,
    color: string,
  ) =>
    parts.push({
      id: `part-${parts.length + 1}`,
      name,
      shape: 'box',
      position: { x, y, z },
      size: { x: w, y: depth, z: h },
      rotation: 0,
      color,
    })
  for (let bay = 0; bay <= d.bays; bay++) {
    const x = -d.width / 2 + d.frame / 2 + (bay * (d.width - d.frame)) / d.bays
    for (const y of [-d.depth / 2 + d.frame / 2, d.depth / 2 - d.frame / 2])
      box('기둥', x, y, d.height / 2, d.frame, d.frame, d.height, d.color)
  }
  const thickness = Math.max(5, d.frame / 3)
  for (let level = 0; level < d.levels; level++) {
    const z = thickness / 2 + (level * (d.height - thickness)) / d.levels
    for (let bay = 0; bay < d.bays; bay++) {
      const w = (d.width - d.frame) / d.bays
      const x = -d.width / 2 + d.frame / 2 + w * (bay + 0.5)
      box(
        '선반',
        x,
        0,
        z,
        w - d.frame,
        d.depth - d.frame,
        thickness,
        kind === 'rack' ? '#b8c7d3' : d.color,
      )
      for (const y of [-d.depth / 2 + d.frame / 2, d.depth / 2 - d.frame / 2])
        box(
          '가로 보',
          x,
          y,
          z + d.frame / 2,
          w,
          d.frame,
          d.frame,
          kind === 'rack' ? '#ed9c40' : d.color,
        )
    }
  }
  return { id, name, kind, design: d, parts }
}
export interface FacilityPort {
  id: string
  x: number
  y: number
}
/**
 * 포트 식별자와 상대 오프셋을 현재 지도 포트 좌표에 합성하는 배치 위치 해석
 * 현재 지도에 연결 포트가 없으면 저장된 절대 위치를 보존하는 독립 로딩 처리
 *
 * @param instance 모델 참조와 위치 및 포트 연결을 포함하는 개별 설비 배치
 * @param ports 현재 기준 맵의 포트 식별자와 위치 목록
 * @returns 현재 포트 위치를 반영한 절대 좌표의 설비 배치
 */
export const resolveFacilityInstance = (
  instance: FacilityInstance,
  ports: FacilityPort[],
): FacilityInstance => {
  if (!instance.portOffset) return instance
  const port = ports.find((p) => p.id === instance.portId)
  if (!port) return instance
  return {
    ...instance,
    position: {
      x: port.x + instance.portOffset.x,
      y: port.y + instance.portOffset.y,
      z: instance.portOffset.z,
    },
  }
}
/**
 * 프레임과 지지대 및 폭 방향 롤러를 조합하는 컨베이어 모델 생성
 * 검증한 외곽 치수 안에서 롤러 수와 직경을 제한하는 설비 형상 구성
 *
 * @param id 조회하거나 편집할 대상의 고유 식별자
 * @param name 파일 또는 모델을 구분하는 표시 이름
 * @param design 폭과 깊이 및 높이와 구조 개수를 포함하는 모델 설계 치수
 * @returns 프레임과 지지대 및 폭 방향 롤러를 포함하는 컨베이어 모델
 */
export const designConveyor = (
  id: string,
  name: string,
  design: NonNullable<FacilityAsset['design']>,
): FacilityAsset => {
  // 랙 편집과 동일한 치수 제한을 재사용하는 설계 범위 검증
  const d = designRack(id, name, 'shelf', { ...design, bays: 1, levels: 1 }).design!
  const parts: FacilityPart[] = []
  /**
   * 로컬 중심 위치와 치수를 가진 박스 부품을 모델 목록에 추가하는 기본 부품 생성
   *
   * @param name 파일 또는 모델을 구분하는 표시 이름
   * @param x 지도 또는 모델 기준 가로 좌표
   * @param y 지도 또는 모델 기준 세로 좌표
   * @param z 지도 바닥을 기준으로 하는 높이 좌표
   * @param w 외곽 가로 길이
   * @param depth 모델의 세로 깊이
   * @param h 외곽 높이 또는 세로 길이
   * @returns 부품 추가 후의 모델 부품 개수
   */
  const box = (
    name: string,
    x: number,
    y: number,
    z: number,
    w: number,
    depth: number,
    h: number,
  ) =>
    parts.push({
      id: `part-${parts.length + 1}`,
      name,
      shape: 'box',
      position: { x, y, z },
      size: { x: w, y: depth, z: h },
      rotation: 0,
      color: d.color,
    })
  for (const y of [-1, 1]) {
    box(
      '측면 프레임',
      0,
      (y * (d.depth - d.frame)) / 2,
      d.height - d.frame / 2,
      d.width,
      d.frame,
      d.frame,
    )
    for (const x of [-1, 1])
      box(
        '지지대',
        (x * (d.width - d.frame)) / 2,
        (y * (d.depth - d.frame)) / 2,
        (d.height - d.frame) / 2,
        d.frame,
        d.frame,
        d.height - d.frame,
      )
  }
  const count = Math.max(2, Math.min(200, Math.floor(d.width / 100)))
  const diameter = Math.min(60, ((d.width - 2 * d.frame) / count) * 0.8)
  for (let i = 0; i < count; i++)
    parts.push({
      id: `part-${parts.length + 1}`,
      name: '롤러',
      shape: 'cylinder',
      position: {
        x:
          -d.width / 2 +
          d.frame +
          diameter / 2 +
          (i * (d.width - 2 * d.frame - diameter)) / (count - 1),
        y: 0,
        z: d.height - diameter / 2,
      },
      size: { x: diameter, y: diameter, z: d.depth - 2 * d.frame },
      rotation: 0,
      tiltX: 90,
      color: '#becbd4',
    })
  return { id, name, kind: 'conveyor', design: d, parts }
}
export interface EquipmentLibrary {
  format: 'bem-equipment-library'
  version: 1
  units: 'mm'
  coordinates: 'mgs-xy-z-up'
  assets: FacilityAsset[]
}
export interface FacilityLayout {
  format: 'bem-map3d-layout'
  version: 1
  units: 'mm'
  coordinates: 'mgs-xy-z-up'
  mapRef: FacilityDocument['mapRef']
  libraryRef: {
    fileName: string
    key: string
  }
  instances: FacilityInstance[]
  floors?: FloorArea[]
}
/**
 * 정규화한 설비 모델 목록에서 배치 파일과 대조할 라이브러리 식별값을 생성하는 연결 키 계산
 *
 * @param assets 식별값 생성에 사용하는 정규화된 설비 모델 목록
 * @returns 정규화한 모델 목록을 구분하는 라이브러리 식별값
 */
export const equipmentLibraryKey = (assets: FacilityAsset[]): string => {
  const text = JSON.stringify(assets)
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0
  return `equipment1-${assets.length}-${hash.toString(16).padStart(8, '0')}`
}
/**
 * 검증한 설계 문서를 재사용 모델 파일과 맵 배치 파일로 나누는 실행 데이터 구성
 *
 * @param doc 모델과 배치 및 기준 맵 정보를 포함하는 설계 문서
 * @param libraryName 배치 파일이 참조할 설비 라이브러리 파일명
 * @returns 설비 라이브러리와 맵 배치를 분리한 실행 파일 객체
 */
export const exportFacilityFiles = (
  doc: FacilityDocument,
  libraryName = 'equipment.json',
): {
  library: EquipmentLibrary
  layout: FacilityLayout
} => {
  const checked = parseFacilityDocument(JSON.stringify(doc))
  return {
    library: {
      format: 'bem-equipment-library',
      version: 1,
      units: 'mm',
      coordinates: 'mgs-xy-z-up',
      assets: checked.assets,
    },
    layout: {
      format: 'bem-map3d-layout',
      version: 1,
      units: 'mm',
      coordinates: 'mgs-xy-z-up',
      mapRef: checked.mapRef,
      libraryRef: { fileName: libraryName, key: equipmentLibraryKey(checked.assets) },
      instances: checked.instances,
      ...(checked.floors ? { floors: checked.floors } : {}),
    },
  }
}
/**
 * 파일 크기와 버전 및 좌표계가 일치하는 실행 데이터만 읽는 공통 파일 검증
 *
 * @param content 파일에서 읽은 원본 문자열
 * @returns 크기와 버전 및 좌표계 검증을 통과한 파일 객체
 */
const readRuntimeJson = (content: string): Record<string, any> => {
  if (new TextEncoder().encode(content).length > MAX_SCENE_BYTES)
    throw new Error('3D JSON은 32MB 이하여야 합니다.')
  const data = JSON.parse(content.replace(/^\uFEFF/, ''))
  if (
    !data ||
    typeof data !== 'object' ||
    data.version !== 1 ||
    data.units !== 'mm' ||
    data.coordinates !== 'mgs-xy-z-up'
  )
    throw new Error('BEM 3D v1 파일이 필요합니다.')
  return data
}
/**
 * 별도 모델 파일을 공유 설계 검증기로 정규화하는 라이브러리 역직렬화
 *
 * @param content 파일에서 읽은 원본 문자열
 * @param upgradeCargo 원본 연결 키 검증 전 캐리어 교체 여부
 * @returns 설계 계약 검증을 통과한 재사용 모델 라이브러리
 */
export const parseEquipmentLibrary = (content: string, upgradeCargo = true): EquipmentLibrary => {
  const data = readRuntimeJson(content)
  if (data.format !== 'bem-equipment-library')
    throw new Error('설비 모델 라이브러리 파일이 필요합니다.')
  const checked = parseFacilityDocument(
    JSON.stringify({ ...emptyFacilityDocument(), assets: data.assets }),
    upgradeCargo,
  )
  return {
    format: 'bem-equipment-library',
    version: 1,
    units: 'mm',
    coordinates: 'mgs-xy-z-up',
    assets: checked.assets,
  }
}
/**
 * 모델 파일의 식별값과 배치 참조를 확인한 뒤 하나의 렌더링 문서로 합치는 실행 파일 병합
 *
 * @param layoutContent 포트 연결과 모델 참조를 포함하는 배치 파일 문자열
 * @param libraryContent 재사용 설비 형상을 포함하는 모델 파일 문자열
 * @returns 모델 형상과 포트 기준 배치를 합친 렌더링 문서
 */
export const importFacilityFiles = (
  layoutContent: string,
  libraryContent: string,
): FacilityDocument => {
  const layout = readRuntimeJson(layoutContent),
    library = parseEquipmentLibrary(libraryContent, false)
  if (
    layout.format !== 'bem-map3d-layout' ||
    typeof layout.libraryRef?.fileName !== 'string' ||
    layout.libraryRef.key !== equipmentLibraryKey(library.assets)
  )
    throw new Error('3D 맵 배치와 설비 라이브러리의 연결 정보가 다릅니다.')
  return parseFacilityDocument(
    JSON.stringify({
      ...emptyFacilityDocument(),
      mapRef: layout.mapRef,
      assets: library.assets,
      instances: layout.instances,
      floors: layout.floors,
    }),
  )
}
