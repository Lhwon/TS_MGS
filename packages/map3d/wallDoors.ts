/**
 * 파일명: wallDoors.ts
 * 설명: 벽에 부착되는 문과 창문의 치수 검증 및 개구부 형상 구성
 * 작성자: 이희원
 * 작성일자: 2026-11-20
 */
import type { FacilityAsset, FacilityInstance, FacilityPart } from './index'

export interface WallDoor {
  id: string
  offset: number
  width: number
  height: number
  kind?: 'window'
  sill?: number
}

/** 문과 창문의 치수와 위치를 보존할 수 있는 벽의 최소 가로와 높이 */
export const wallDoorLimits = (doors: WallDoor[]) => ({
  width: Math.max(0, ...doors.map((door) => 2 * Math.abs(door.offset) + door.width)),
  height: Math.max(0, ...doors.map((door) => door.height + (door.sill ?? 0))),
})

/** 개구부 주변 벽과 부착 부품의 최대 메시 개수 계산 */
export const wallOpeningPartBudget = (doors: WallDoor[]) =>
  1 + doors.reduce((total, door) => total + (door.kind === 'window' ? 8 : 6), 0)

/** 개구부가 가능한 단일 직선 벽체 확인 */
export const wallBody = (asset?: FacilityAsset) => {
  const body = asset?.parts[0]
  return asset?.parts.length === 1 &&
    body?.wall &&
    body.shape === 'box' &&
    !body.rotation &&
    !body.tiltX &&
    !body.tiltY
    ? body
    : undefined
}

/** 마감까지 포함한 실제 폭과 높이 및 벽 중심으로부터의 거리 검증 */
export const parseWallDoors = (
  input: unknown,
  instance: FacilityInstance,
  asset: FacilityAsset,
) => {
  if (input === undefined) return
  const body = wallBody(asset)
  if (!body || !Array.isArray(input) || input.length > 24)
    throw new Error('단일 직선 벽체에 문과 창문을 합계 24개까지 붙일 수 있습니다.')
  const width = body.size.x * (instance.scale?.x ?? 1)
  const height = body.size.z * (instance.scale?.z ?? 1)
  const ids = new Set<string>()
  const doors = input
    .map((item: WallDoor) => {
      const sill = item?.kind === 'window' ? item.sill : 0
      if (
        !item ||
        typeof item.id !== 'string' ||
        !item.id ||
        item.id.length > 300 ||
        ids.has(item.id) ||
        !Number.isFinite(item.offset) ||
        !Number.isFinite(item.width) ||
        !Number.isFinite(item.height) ||
        (item.kind !== undefined && item.kind !== 'window') ||
        typeof sill !== 'number' ||
        !Number.isFinite(sill) ||
        sill < 0 ||
        item.width < 100 ||
        item.height < 200 ||
        sill + item.height > height + 0.000001 ||
        Math.abs(item.offset) + item.width / 2 > width / 2 + 0.000001
      )
        throw new Error('문 또는 창문의 폭, 높이와 위치가 벽 범위 안에 있어야 합니다.')
      ids.add(item.id)
      return {
        id: item.id, offset: item.offset, width: item.width, height: item.height,
        ...(item.kind === 'window' ? { kind: item.kind, sill } : {}),
      }
    })
    .sort((a, b) => a.offset - a.width / 2 - (b.offset - b.width / 2))
  for (let i = 1; i < doors.length; i++) {
    const a = doors[i - 1]!,
      b = doors[i]!
    if (a.offset + a.width / 2 > b.offset - b.width / 2)
      throw new Error('같은 벽에서 문과 창문의 가로 위치가 겹칩니다.')
  }
  return doors
}

/** 벽 로컬 좌표에서 자리를 뚫고 문과 창문의 프레임 및 채움 부품 구성 */
export const instanceParts = (asset: FacilityAsset, instance: FacilityInstance): FacilityPart[] => {
  const body = wallBody(asset)
  if (!body || !instance.wallDoors?.length) return asset.parts
  const sx = instance.scale?.x ?? 1,
    sy = instance.scale?.y ?? 1,
    sz = instance.scale?.z ?? 1
  const left = body.position.x - body.size.x / 2
  const bottom = body.position.z - body.size.z / 2
  const top = bottom + body.size.z
  const parts: FacilityPart[] = []
  /** 벽과 개구부 부품의 외곽 좌표를 박스 중심과 크기로 변환 */
  const box = (
    name: string,
    x1: number,
    x2: number,
    z1: number,
    z2: number,
    color: string,
    wall = false,
    depth = body.size.y,
    finish: Pick<FacilityPart, 'opacity' | 'surface'> = {},
  ) => {
    if (x2 - x1 < 0.000001 || z2 - z1 < 0.000001) return
    parts.push({
      id: 'opening-part-' + parts.length,
      name,
      shape: 'box',
      position: { x: (x1 + x2) / 2, y: body.position.y, z: (z1 + z2) / 2 },
      size: { x: x2 - x1, y: depth, z: z2 - z1 },
      rotation: 0,
      color,
      ...(wall ? { wall: true, opacity: body.opacity, surface: body.surface } : finish),
    })
  }
  let previous = left
  for (const door of instance.wallDoors) {
    const x1 = body.position.x + (door.offset - door.width / 2) / sx
    const x2 = body.position.x + (door.offset + door.width / 2) / sx
    const window = door.kind === 'window'
    const base = bottom + (door.sill ?? 0) / sz
    const z = base + door.height / sz
    const jamb = Math.min(40, door.width / 5) / sx
    const header = 40 / sz
    const trim = '#48525b'
    box('측면 벽체', previous, x1, bottom, top, body.color, true)
    box('상부 벽체', x1, x2, z, top, body.color, true)
    if (window) {
      box('하부 벽체', x1, x2, bottom, base, body.color, true)
      box('하부 창틀', x1 + jamb, x2 - jamb, base, base + header, trim, false, body.size.y, { surface: 'paintedSteel' })
    }
    const frame = window ? '창틀' : '문틀'
    const finish = { surface: 'paintedSteel' } as const
    box(frame, x1, x1 + jamb, base, z, trim, false, body.size.y, finish)
    box(frame, x2 - jamb, x2, base, z, trim, false, body.size.y, finish)
    box(`상부 ${frame}`, x1 + jamb, x2 - jamb, z - header, z, trim, false, body.size.y, finish)
    box(
      window ? '유리' : '문짝',
      x1 + jamb + 3 / sx,
      x2 - jamb - 3 / sx,
      base + (window ? header : 12 / sz),
      z - header - 3 / sz,
      window ? '#9cc1ca' : '#a17a58',
      false,
      Math.min((window ? 10 : 45) / sy, body.size.y),
      window ? { surface: 'glass', opacity: 0.32 } : {},
    )
    previous = x2
  }
  box('측면 벽체', previous, left + body.size.x, bottom, top, body.color, true)
  return parts
}
