/**
 * 파일명: floorAreas.ts
 * 설명: 작업자가 제작한 바닥 영역과 표면 패턴의 파일 계약
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
import { parseSceneResource, type SceneResource } from './sceneResources'

export const floorMaterials = {
  concrete: { label: '콘크리트', color: '#9b9a94', repeatMm: 1000 },
  epoxy: { label: '에폭시', color: '#67867d', repeatMm: 1000 },
  'showroom-epoxy': { label: '쇼룸 에폭시', color: '#c9c9c9', repeatMm: 4800 },
  tile: { label: '타일', color: '#c7c3b8', repeatMm: 600 },
  wood: { label: '목재', color: '#a77751', repeatMm: 1200 },
} as const

export type FloorMaterial = keyof typeof floorMaterials
export type FloorPoint = { x: number; y: number }
export interface FloorArea {
  id: string
  name: string
  points: FloorPoint[]
  material: FloorMaterial
  color: string
  repeatMm: number
  rotation: number
  texture?: SceneResource
  /** 사용자 등록 이미지의 원본 표시 이름 정의 */
  textureName?: string
}

export const MAX_FLOOR_AREAS = 128
export const MAX_FLOOR_POINTS = 128

/** 두 방향 벡터의 외적으로 선분의 교차 방향을 계산 */
const turn = (a: FloorPoint, b: FloorPoint, c: FloorPoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

/** 교차뿐 아니라 경계를 되짚거나 닿는 구간도 포함하는 선분 충돌 검사 */
const intersects = (a: FloorPoint, b: FloorPoint, c: FloorPoint, d: FloorPoint) =>
  Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
    Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
  Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
    Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) &&
  Math.sign(turn(a, b, c)) * Math.sign(turn(a, b, d)) <= 0 &&
  Math.sign(turn(c, d, a)) * Math.sign(turn(c, d, b)) <= 0

/** 겹치거나 면적이 없는 경계와 잘못된 재질을 파일 열기와 편집 단계에서 거부 */
export const parseFloorAreas = (
  value: unknown,
  externalTextures = false,
): FloorArea[] | undefined => {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > MAX_FLOOR_AREAS)
    throw new Error('바닥 영역은 최대 128개까지 만들 수 있습니다.')
  const ids = new Set<string>()
  return value.map((area: FloorArea) => {
    if (
      !area ||
      typeof area.id !== 'string' ||
      !area.id ||
      area.id.length > 300 ||
      ids.has(area.id) ||
      typeof area.name !== 'string' ||
      !area.name.trim() ||
      area.name.length > 300 ||
      typeof area.material !== 'string' ||
      !Object.hasOwn(floorMaterials, area.material) ||
      typeof area.color !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(area.color) ||
      !Number.isFinite(area.repeatMm) ||
      area.repeatMm < 10 ||
      area.repeatMm > 100000 ||
      !Number.isFinite(area.rotation) ||
      Math.abs(area.rotation) > 360 ||
      !Array.isArray(area.points) ||
      area.points.length < 3 ||
      area.points.length > MAX_FLOOR_POINTS
    )
      throw new Error('바닥 영역의 이름, 재질, 패턴 크기 또는 꼭짓점을 확인하세요.')
    const points = area.points.map((point) => {
      if (
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        Math.abs(point.x) > 1e9 ||
        Math.abs(point.y) > 1e9
      )
        throw new Error('바닥 꼭짓점 좌표를 확인하세요.')
      return { x: point.x, y: point.y }
    })
    let doubledArea = 0
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      if (a.x === b.x && a.y === b.y) throw new Error('바닥 꼭짓점이 중복되었습니다.')
      doubledArea += turn(points[0]!, a, b)
      for (let j = i + 2; j < points.length; j++) {
        if (i === 0 && j === points.length - 1) continue
        if (intersects(a, b, points[j]!, points[(j + 1) % points.length]!))
          throw new Error('바닥 영역의 경계가 서로 교차합니다.')
      }
    }
    if (Math.abs(doubledArea) < 2) throw new Error('바닥 영역의 면적이 너무 작습니다.')
    ids.add(area.id)
    if (area.texture && !externalTextures)
      throw new Error('외부 텍스처를 지원하는 설계 버전이 필요합니다.')
    if (
      area.textureName !== undefined &&
      (typeof area.textureName !== 'string' || area.textureName.length > 300)
    )
      throw new Error('바닥 이미지 이름은 300자 이하여야 합니다.')
    return {
      id: area.id,
      name: area.name.trim(),
      points,
      material: area.material,
      color: area.color,
      repeatMm: area.repeatMm,
      rotation: area.rotation,
      ...(area.texture ? { texture: parseSceneResource(area.texture, true) } : {}),
      ...(area.texture && area.textureName ? { textureName: area.textureName } : {}),
    }
  })
}
