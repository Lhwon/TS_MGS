/** 모델 기본값과 배치별 재정의에 사용하는 조명 각도 정의 */
export interface FacilityLightAngles {
  direction?: number
  tilt?: number
  beamAngle?: number
  penumbra?: number
}

/** GLB 조명 유형과 색온도 및 배광 기본값 정의 */
export interface FacilityLight extends FacilityLightAngles {
  kind: 'spot' | 'line'
  temperature: number
}

export const minLightTemperature = 1000
export const maxLightTemperature = 12000

/** 수직 하향 조명의 기존 배광을 유지하는 기본 각도 정의 */
export const defaultFacilityLightAngles: Required<FacilityLightAngles> = {
  direction: 0,
  tilt: 0,
  beamAngle: 80,
  penumbra: 0.65,
}

/** 모델 기본값에 개별 조명의 각도를 합성한 유효 설정 반환 */
export const resolveFacilityLightAngles = (
  light: FacilityLight,
  override?: FacilityLightAngles,
): Required<FacilityLightAngles> => ({
  direction: override?.direction ?? light.direction ?? 0,
  tilt: override?.tilt ?? light.tilt ?? 0,
  beamAngle: override?.beamAngle ?? light.beamAngle ?? (light.kind === 'line' ? 110 : 80),
  penumbra: override?.penumbra ?? light.penumbra ?? 0.65,
})

/** 저장된 각도 범위와 유한 숫자 여부 검증 */
export const parseFacilityLightAngles = (value: unknown): FacilityLightAngles => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('조명 각도 설정을 확인하세요.')
  const input = value as Record<string, unknown>,
    result: FacilityLightAngles = {}
  for (const [key, min, max] of [
    ['direction', 0, 360],
    ['tilt', 0, 90],
    ['beamAngle', 1, 160],
    ['penumbra', 0, 1],
  ] as const) {
    if (input[key] === undefined) continue
    const number = input[key]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max)
      throw new Error('조명 방향과 기울기 및 배광각 범위를 확인하세요.')
    result[key] = number
  }
  return result
}

const legacyLights: Record<string, FacilityLight> = {
  '18_track_spotlight.glb': { kind: 'spot', temperature: 2000 },
  '19_linear_led.glb': { kind: 'line', temperature: 6000 },
}

/** 기존 쇼룸 모델에 새 설정이 저장되기 전에도 같은 조명을 표시 */
export const legacyFacilityLight = (sourceName: string) => {
  const name = sourceName.toLowerCase()
  return Object.hasOwn(legacyLights, name) ? legacyLights[name] : undefined
}

/** 색온도를 화면에 사용할 sRGB 색으로 근사 */
export const facilityLightColor = (temperature: number) => {
  const t = temperature / 100
  const channel = (value: number) => Math.round(Math.min(255, Math.max(0, value)))
  const red = t <= 66 ? 255 : channel(329.6987 * (t - 60) ** -0.133205)
  const green = channel(
    t <= 66 ? 99.4708 * Math.log(t) - 161.1196 : 288.1222 * (t - 60) ** -0.075515,
  )
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : channel(138.5177 * Math.log(t - 10) - 305.0448)
  return red * 0x10000 + green * 0x100 + blue
}
