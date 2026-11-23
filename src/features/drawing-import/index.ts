/**
 * 파일명: index.ts
 * 설명: 도면 첨부와 경로 생성 및 축척 변환의 공개 진입점
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
export {
  prepareDrawing,
  extractDrawingGraph,
  buildDrawingMap,
  calibrateDrawingMap,
  mergeDrawingRegion,
  inDrawingRegion,
} from '@/features/drawing-import/model/drawing.ts'
export type {
  DrawingAttachment,
  DrawingVision,
  DrawingGraph,
  RouteColor,
} from '@/features/drawing-import/model/types.ts'
export {
  recognizeDrawing,
  visionDrawingGraph,
} from '@/features/drawing-import/model/recognition.ts'
export {
  applyDrawingObjects,
  drawingObjectBounds,
  drawingObjectPixelBox,
  patchDrawingObjects,
  roundDrawingPaths,
  drawingFacility,
  validateDrawingMap,
} from '@/features/drawing-import/model/enrichment.ts'
export type { DrawingFinding } from '@/features/drawing-import/model/enrichment.ts'
export {
  createLayout,
  trimDrawing,
  layoutCorners,
  alignDrawingToLayout,
} from '@/features/drawing-import/model/layout.ts'
export type { LayoutOptions } from '@/features/drawing-import/model/layout.ts'
export {
  planDrawingRoute,
  supportedDimensionLine,
} from '@/features/drawing-import/model/routePlan.ts'
export { default as DrawingLayout } from '@/features/drawing-import/ui/DrawingLayout.vue'
