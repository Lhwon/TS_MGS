/**
 * 파일명: layout.ts
 * 설명: 원본 MGS의 자르기와 폭 및 투명도를 사용하는 독립 편집용 도면 배경
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
import { parseDocument, type MapDocument, type MapLayout } from '@/entities/map/index.ts'
import type { DrawingAttachment } from '@/features/drawing-import/model/types.ts'
export interface LayoutOptions {
  widthMm?: number
  x?: number
  y?: number
  rotation?: number
  opacity?: number
  autoTrim?: boolean
  crop?: MapLayout['crop']
}
/** 흰 여백을 제외하며 원본 픽셀 좌표를 유지하는 자동 잘라내기 */
export const trimDrawing = (drawing: DrawingAttachment): MapLayout['crop'] => {
  let left = drawing.analysisWidth,
    top = drawing.analysisHeight,
    right = -1,
    bottom = -1
  for (let y = 0; y < drawing.analysisHeight; y++)
    for (let x = 0; x < drawing.analysisWidth; x++) {
      const i = (y * drawing.analysisWidth + x) * 4
      if (
        Math.min(drawing.pixels[i], drawing.pixels[i + 1], drawing.pixels[i + 2]) < 245 &&
        drawing.pixels[i + 3] > 20
      ) {
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
      }
    }
  if (right < left) return { x: 0, y: 0, width: drawing.width, height: drawing.height }
  const x = Math.floor((left / drawing.analysisWidth) * drawing.width),
    y = Math.floor((top / drawing.analysisHeight) * drawing.height)
  return {
    x,
    y,
    width: Math.min(
      drawing.width - x,
      Math.ceil(((right - left + 1) / drawing.analysisWidth) * drawing.width),
    ),
    height: Math.min(
      drawing.height - y,
      Math.ceil(((bottom - top + 1) / drawing.analysisHeight) * drawing.height),
    ),
  }
}
/**
 * 기존 지도 객체를 그대로 유지하며 편집 참고용 도면만 적용하는 배경 생성
 * @param map 현재 지도
 * @param drawing 첨부하거나 직접 연 도면
 * @param options 요청한 위치와 실제 폭 및 표시 설정
 * @returns 지도 좌표계와 독립적으로 관리할 배경 도면
 */
export const createLayout = (
  map: MapDocument,
  drawing: DrawingAttachment,
  options: LayoutOptions = {},
): MapLayout => {
  const old = map.layout?.id === drawing.id ? map.layout : undefined
  const crop =
    options.crop ??
    (options.autoTrim
      ? trimDrawing(drawing)
      : (old?.crop ?? { x: 0, y: 0, width: drawing.width, height: drawing.height }))
  const xs = map.nodes.map((node) => node.x),
    ys = map.nodes.map((node) => node.y)
  const span = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
  const width = options.widthMm ?? old?.width ?? (span > 0 ? span : drawing.width)
  const layout: MapLayout = {
    id: drawing.id,
    name: drawing.name,
    image: drawing.image,
    sourceImage: drawing.sourceImage,
    sourceWidth: drawing.width,
    sourceHeight: drawing.height,
    crop,
    width,
    height: (width * crop.height) / crop.width,
    x: options.x ?? old?.x ?? (xs.length ? Math.min(...xs) : 0),
    y: options.y ?? old?.y ?? (ys.length ? Math.min(...ys) : 0),
    rotation: options.rotation ?? old?.rotation ?? 0,
    opacity: options.opacity ?? old?.opacity ?? 0.5,
    visible: true,
    calibrated: options.widthMm !== undefined ? map.units === 'mm' : (old?.calibrated ?? false),
  }
  return parseDocument(JSON.stringify({ ...map, layout })).layout!
}
export { layoutCorners } from '@/entities/map/index.ts'
/**
 * 이미 적용한 배경과 같은 좌표에 생성 경로를 정렬하는 도면 맞춤
 * @param map 새로 생성한 원본 좌표 지도
 * @param layout 사용자가 요청하여 적용한 배경
 * @returns 배경의 자르기와 위치 및 회전을 유지한 지도
 */
export const alignDrawingToLayout = (map: MapDocument, layout: MapLayout) => {
  if (!map.drawing || map.drawing.id !== layout.id) return map
  const scale = layout.width / layout.crop.width,
    original = map.drawing.scaleMmPerPixel ?? 1
  const angle = (layout.rotation * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle)
  const dx = -layout.crop.x * scale,
    dy = -(layout.sourceHeight - layout.crop.y - layout.crop.height) * scale
  const x = layout.x + dx * cos - dy * sin,
    y = layout.y + dx * sin + dy * cos
  for (const node of map.nodes) {
    const px = (node.x / original) * scale,
      py = (node.y / original) * scale
    node.x = Math.round(x + px * cos - py * sin)
    node.y = Math.round(y + px * sin + py * cos)
  }
  const nodes = new Map(map.nodes.map((node) => [node.id, node]))
  for (const edge of map.edges)
    edge.distance = Math.round(
      Math.hypot(
        nodes.get(edge.from)!.x - nodes.get(edge.to)!.x,
        nodes.get(edge.from)!.y - nodes.get(edge.to)!.y,
      ),
    )
  if (layout.calibrated) {
    map.units = 'mm'
    map.drawing.scaleMmPerPixel = scale
  } else {
    map.units = 'px'
    map.drawing.scaleMmPerPixel = null
    map.drawing.workingScale = scale
  }
  map.drawing.frame = { x, y, rotation: layout.rotation }
  map.layout = structuredClone(layout)
  return parseDocument(JSON.stringify(map))
}
