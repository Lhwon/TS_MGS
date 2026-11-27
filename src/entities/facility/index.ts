/**
 * 파일명: index.ts
 * 설명: 슬라이스의 컴포넌트와 데이터 및 기능을 외부에 제공하는 공개 진입점
 * 작성자: 이희원
 * 작성일자: 2026-10-20
 */
export * from '@bem/map3d'
export { buildWipRacks, wipRackKey } from './wipRacks'
export { createInteriorModel, fillLegacyStainlessPipe, interiorModels, type InteriorModel } from './interiorModels'
export {
  FACILITY_CYLINDER_SEGMENTS,
  facilityModelBounds,
  facilityModelSize,
  facilityPartMatrix,
} from './facilityDimensions'

import { parseEquipmentLibrary, type SceneResource, type SceneResourceReader } from '@bem/map3d'

/** 웹 편집에서 등록한 바닥 이미지의 해시별 원본 보관 */
const registeredTextures = new Map<string, ArrayBuffer>()

/** 편집기에서 등록하거나 연 설계의 외부 리소스 읽기 */
export const readSceneResource: SceneResourceReader = (reference) => {
  const bytes = registeredTextures.get(reference.hash)
  if (reference.uri === `textures/${reference.hash}.webp` && bytes) return Promise.resolve(bytes)
  if (window.desktop?.readSceneResource) return window.desktop.readSceneResource(reference)
  return Promise.reject(new Error('외부 리소스가 포함된 설계는 데스크톱 앱에서 열어 주세요.'))
}

/** 사용자 이미지를 제한된 해상도의 정적 바닥 텍스처로 변환하여 등록 */
export const registerFloorTexture = async (file: File): Promise<SceneResource> => {
  if (!/\.(png|jpe?g|webp|bmp|gif|avif)$/i.test(file.name) || !file.size || file.size > 12 * 1024 * 1024)
    throw new Error('PNG, JPG, WEBP, BMP, GIF, AVIF 이미지 중 12MB 이하 파일을 선택하세요.')
  if (window.desktop && !window.desktop.stageSceneTexture)
    throw new Error('바닥 이미지 등록을 사용하려면 편집 내용을 저장한 뒤 앱을 재실행하세요.')
  const url = URL.createObjectURL(file)
  const image = new Image()
  try {
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 64 * 1024 * 1024)
      throw new Error('이미지 해상도는 총 6400만 픽셀 이하여야 합니다.')
    const ratio = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('바닥 이미지를 변환할 수 없습니다.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value?.type === 'image/webp' ? resolve(value) : reject(new Error('WebP 이미지 변환을 지원하지 않습니다.')),
      'image/webp', 0.92,
    ))
    if (blob.size > 12 * 1024 * 1024) throw new Error('변환된 바닥 이미지는 12MB 이하여야 합니다.')
    const bytes = await blob.arrayBuffer()
    if (window.desktop?.stageSceneTexture) return window.desktop.stageSceneTexture(bytes)
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
      value.toString(16).padStart(2, '0'),
    ).join('')
    registeredTextures.set(hash, bytes)
    return { uri: `textures/${hash}.webp`, hash }
  } catch (cause) {
    if (cause instanceof DOMException) throw new Error('이미지 파일을 해석할 수 없습니다. 파일 형식을 확인하세요.')
    throw cause
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 도면 기반 개략 설비 라이브러리의 지연 로딩과 계약 검증 */
export const loadDefaultCatalog = async () =>
  parseEquipmentLibrary(JSON.stringify((await import('./ceram-mp5.equipment.json')).default))

/** 이전 기본 모델과 배치 이름에서 제품명 접두어 제거 */
export const defaultModelLabel = (name: string) =>
  name.replace(/(?<![a-z0-9])(?:ceram|mp[45])(?![a-z0-9])[\s_-]*/gi, '').trim()
