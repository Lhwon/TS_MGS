export const transformSnapSteps = [10, 50, 100] as const
export type TransformSnapStep = (typeof transformSnapSteps)[number]
export const defaultTransformSnap: TransformSnapStep = 100

/** 원점 기준의 가장 가까운 격자 간격으로 좌표나 치수 보정 */
export const snapToStep = (value: number, step: number) =>
  Math.round(value / step) * step + 0
