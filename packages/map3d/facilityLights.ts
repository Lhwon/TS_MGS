export interface FacilityLight {
  kind: 'spot' | 'line'
  temperature: number
}

export const minLightTemperature = 1000
export const maxLightTemperature = 12000

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
