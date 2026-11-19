/**
 * 파일명: interiorModels.ts
 * 설명: 벽체와 문 및 유리 칸막이의 편집 가능한 시작 모델
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
import type { FacilityAsset, FacilityPart } from '@bem/map3d'

export const interiorModels = {
  wall: '벽',
  doorway: '문이 있는 벽',
  glass: '유리 칸막이',
} as const

export type InteriorModel = keyof typeof interiorModels

/** 지도 바닥을 높이 원점으로 사용하며 문 개구부를 부품 사이에 남기는 시작 모델 생성 */
export const createInteriorModel = (type: InteriorModel): FacilityAsset => {
  const parts: FacilityPart[] = []
  const width = 3000
  const height = 2600
  const wallColor = '#d3cbc0'
  const frameColor = '#48525b'

  /** 치수와 바닥 기준 높이를 부품의 중심 좌표로 변환하는 박스 추가 */
  const box = (
    name: string,
    x: number,
    bottom: number,
    size: FacilityPart['size'],
    color: string,
    finish: Pick<FacilityPart, 'wall' | 'opacity'> = {},
  ) => {
    parts.push({
      id: `part-${parts.length + 1}`,
      name,
      shape: 'box',
      position: { x, y: 0, z: bottom + size.z / 2 },
      size,
      rotation: 0,
      color,
      ...finish,
    })
  }

  if (type === 'wall') {
    box('벽체', 0, 0, { x: width, y: 150, z: height }, wallColor, { wall: true })
  } else if (type === 'doorway') {
    const openingWidth = 1040
    const openingHeight = 2160
    const side = (width - openingWidth) / 2
    for (const direction of [-1, 1]) {
      box(
        '측면 벽체',
        (direction * (openingWidth + side)) / 2,
        0,
        { x: side, y: 150, z: openingHeight },
        wallColor,
        { wall: true },
      )
      box('문틀 기둥', direction * 500, 0, { x: 40, y: 155, z: openingHeight }, frameColor)
    }
    box('상부 벽체', 0, openingHeight, { x: width, y: 150, z: height - openingHeight }, wallColor, {
      wall: true,
    })
    box('상부 문틀', 0, 2120, { x: 960, y: 155, z: 40 }, frameColor)
    box('문짝', 0, 15, { x: 950, y: 45, z: 2100 }, '#a17a58')
  } else {
    const frame = 45
    for (const direction of [-1, 1])
      box(
        '유리 세로 프레임',
        (direction * (width - frame)) / 2,
        0,
        { x: frame, y: 80, z: height },
        frameColor,
      )
    for (const bottom of [0, height - frame])
      box('유리 가로 프레임', 0, bottom, { x: width - 2 * frame, y: 80, z: frame }, frameColor)
    box('유리', 0, frame, { x: width - 2 * frame, y: 12, z: height - 2 * frame }, '#80b8c6', {
      opacity: 0.32,
    })
  }

  return { id: `interior-${type}`, name: interiorModels[type], kind: 'equipment', parts }
}
