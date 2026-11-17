/**
 * 파일명: types.ts
 * 설명: 도면 첨부와 색상 경로 추출 결과의 데이터 계약
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
export type RouteColor = 'green' | 'magenta' | 'cyan' | 'blue' | 'red' | 'black'
import type { DrawingVision } from '@/entities/map/index.ts'
export type { DrawingVision } from '@/entities/map/index.ts'
export interface DrawingGraph {
  points: { x: number; y: number }[]
  edges: [number, number][]
  components: number
  maskPixels: number
  color: RouteColor
}
export interface DrawingAttachment {
  id: string
  name: string
  width: number
  height: number
  analysisWidth: number
  analysisHeight: number
  image: string
  sourceImage?: string
  visionImage: string
  source?: Blob
  objectsAnalyzed?: boolean
  analyzedTiles?: number
  tileResults?: Map<string, DrawingVision>
  detections?: import('@/entities/map/index.ts').DrawingObject[]
  routes?: NonNullable<DrawingVision['routes']>
  pixels: Uint8ClampedArray
  colors: Record<RouteColor, number>
  vision?: DrawingVision
}
