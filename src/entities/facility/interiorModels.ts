/**
 * 파일명: interiorModels.ts
 * 설명: 벽체와 문 및 유리 칸막이와 사각 파이프의 편집 가능한 시작 모델
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
import type { FacilityAsset, FacilityPart } from '@bem/map3d'

export const interiorModels = {
  wall: '벽',
  glass: '유리 칸막이',
  'stainless-pipe': '스테인리스 사각 파이프',
} as const

export type InteriorModel = keyof typeof interiorModels | 'doorway'

const stainlessPipeId = 'interior-stainless-pipe'
const pipeSection = 40
const pipeHeight = 2600

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
    finish: Pick<FacilityPart, 'wall' | 'opacity' | 'surface'> = {},
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
  } else if (type === 'glass') {
    box('유리', 0, 0, { x: width, y: 12, z: height }, '#80b8c6', {
      opacity: 0.32,
    })
  } else {
    box('스테인리스 본체', 0, 0, { x: pipeSection, y: pipeSection, z: pipeHeight }, '#bdc6ca', {
      surface: 'stainlessSteel',
    })
  }

  return {
    id: `interior-${type}`,
    name: type === 'doorway' ? '문이 있는 벽' : interiorModels[type],
    kind: 'equipment',
    catalogCategory: 'interior',
    parts,
  }
}

/** 이전 기본 파이프를 같은 외곽과 기준점을 가진 솔리드 모델로 교체 */
export const fillLegacyStainlessPipe = (asset: FacilityAsset): FacilityAsset => {
  const plates = [
    [-19, 0, 2, 40],
    [0, -19, 36, 2],
    [19, 0, 2, 40],
    [0, 19, 36, 2],
  ]
  const first = asset.parts[0]
  if (asset.id !== stainlessPipeId || !first || asset.parts.length !== plates.length) return asset

  const matches = plates.every(([x, y, width, depth], index) => {
    const part = asset.parts[index]!
    return (
      part.shape === 'box' && part.position.x === x && part.position.y === y &&
      part.position.z === pipeHeight / 2 && part.size.x === width && part.size.y === depth &&
      part.size.z === pipeHeight && !part.rotation && !part.tiltX && !part.tiltY && !part.wall &&
      part.surface === 'stainlessSteel' && part.color === first.color && part.opacity === first.opacity
    )
  })
  if (!matches) return asset

  const solid = createInteriorModel('stainless-pipe').parts[0]!
  return { ...asset, parts: [{ ...solid, color: first.color, opacity: first.opacity }] }
}
