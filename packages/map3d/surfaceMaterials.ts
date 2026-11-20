/**
 * 파일명: surfaceMaterials.ts
 * 설명: 설비 부품 표면의 반사 특성과 기존 모델의 기본 재질
 * 작성자: 이희원
 * 작성일자: 2026-11-20
 */
export const surfaceMaterials = {
  plaster: { label: '무광 도장 벽', roughness: 0.91, metalness: 0 },
  paintedSteel: { label: '분체도장 금속', roughness: 0.47, metalness: 0.18 },
  galvanizedSteel: { label: '아연도금 강판', roughness: 0.36, metalness: 0.63 },
  stainlessSteel: { label: '스테인리스', roughness: 0.32, metalness: 0.85 },
  wood: { label: '목재', roughness: 0.59, metalness: 0 },
  glass: { label: '유리', roughness: 0.13, metalness: 0 },
  rubber: { label: '고무', roughness: 0.88, metalness: 0 },
  plastic: { label: '플라스틱', roughness: 0.52, metalness: 0 },
} as const

export type SurfaceMaterial = keyof typeof surfaceMaterials

/** 저장된 표면을 우선하고 이전 파일의 기본 부품 이름에서 대응하는 재질 선택 */
export const surfaceForPart = (part: { surface?: SurfaceMaterial; wall?: true; name: string }): SurfaceMaterial => {
  if (part.surface) return part.surface
  if (part.wall) return 'plaster'
  if (part.name === '유리') return 'glass'
  if (part.name === '문짝') return 'wood'
  if (/^(선반|롤러)$/.test(part.name)) return 'galvanizedSteel'
  if (/문틀|프레임|기둥|가로 보|^지지대$/.test(part.name)) return 'paintedSteel'
  return 'plastic'
}
