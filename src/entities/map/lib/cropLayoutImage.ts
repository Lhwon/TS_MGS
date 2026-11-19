/**
 * 파일명: cropLayoutImage.ts
 * 설명: 지도 배경용 도면의 원본 크롭 범위와 로딩된 이미지 해상도를 일치시키는 처리
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
import type { MapLayout } from '@/entities/map/model/map.ts'

/** 2D와 3D에 표시할 같은 원본 도면 영역을 캔버스로 복사 */
export const cropLayoutImage = (image: HTMLImageElement, layout: MapLayout) => {
  const canvas = document.createElement('canvas')
  const ratio = image.naturalWidth / layout.sourceWidth
  const { x, y, width, height } = layout.crop
  canvas.width = Math.max(1, Math.round(width * ratio))
  canvas.height = Math.max(1, Math.round(height * ratio))
  canvas
    .getContext('2d')!
    .drawImage(
      image,
      x * ratio,
      y * ratio,
      width * ratio,
      height * ratio,
      0,
      0,
      canvas.width,
      canvas.height,
    )
  return canvas
}
