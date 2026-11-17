/**
 * 파일명: recognition.ts
 * 설명: 고해상도 구역 인식과 중복 제거 및 흑백 도면 통로 그래프 구성
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
import type { DrawingObject } from '@/entities/map/index.ts'
import type {
  DrawingAttachment,
  DrawingGraph,
  DrawingVision,
} from '@/features/drawing-import/model/types.ts'

/** 인식 경계 상자의 겹침 비율로 구역 경계의 중복을 판정하는 교집합 계산 */
const overlap = (a: DrawingObject, b: DrawingObject) => {
  const area =
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return area / Math.min(a.width * a.height, b.width * b.height)
}

/**
 * 원본 영상을 겹치는 구역으로 나누어 객체와 문자를 인식하는 순차 분석
 * @param drawing 첨부 도면과 기존 인식 결과
 * @param analyze 내부망 비전 요청 함수
 * @param signal 취소 신호
 * @param progress 분석 구역과 실패를 표시하는 진행 알림
 * @param count 목표 구역 수
 * @returns 원본 이미지 좌표의 객체와 부분 실패 목록
 */
export const recognizeDrawing = async (
  drawing: DrawingAttachment,
  analyze: (image: string, signal: AbortSignal, task: 'objects') => Promise<DrawingVision>,
  signal: AbortSignal,
  progress: (message: string) => void,
  count = 12,
) => {
  if (drawing.objectsAnalyzed && drawing.analyzedTiles === count)
    return { objects: drawing.detections ?? [], warnings: [] as string[] }
  const image = new Image()
  const url = drawing.source ? URL.createObjectURL(drawing.source) : drawing.image
  image.src = url
  const warnings: string[] = []
  const candidates: DrawingObject[] = []
  drawing.tileResults ??= new Map()
  const routes: NonNullable<DrawingVision['routes']> = [...(drawing.vision?.routes ?? [])]
  try {
    await image.decode()
    if (image.naturalWidth < drawing.width / 2 || image.naturalHeight < drawing.height / 2)
      warnings.push('저장된 축소 영상으로 분석 중 · 작은 문자는 원본 도면을 다시 첨부해 확인 필요')
    const wideColumns = count === 4 ? 2 : count === 12 ? 4 : 8
    const columns = drawing.width >= drawing.height ? wideColumns : count / wideColumns
    const rows = count / columns
    let successful = 0
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < columns; col++) {
        signal.throwIfAborted()
        progress(`설비·포트·문자 인식 중 · ${row * columns + col + 1}/${columns * rows} 구역`)
        const left = Math.max(0, (col - 0.08) / columns),
          top = Math.max(0, (row - 0.08) / rows)
        const right = Math.min(1, (col + 1.08) / columns),
          bottom = Math.min(1, (row + 1.08) / rows)
        const w = (right - left) * image.naturalWidth,
          h = (bottom - top) * image.naturalHeight
        const ratio = Math.min(1, 1536 / Math.max(w, h))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(w * ratio))
        canvas.height = Math.max(1, Math.round(h * ratio))
        canvas
          .getContext('2d')!
          .drawImage(
            image,
            left * image.naturalWidth,
            top * image.naturalHeight,
            w,
            h,
            0,
            0,
            canvas.width,
            canvas.height,
          )
        const tileKey = `${columns}:${rows}:${col}:${row}`
        let result: DrawingVision | undefined = drawing.tileResults.get(tileKey)
        for (let attempt = 0; attempt < 2; attempt++) {
          if (result) break
          try {
            result = await analyze(canvas.toDataURL('image/jpeg', 0.9), signal, 'objects')
            drawing.tileResults.set(tileKey, result)
            break
          } catch (cause) {
            signal.throwIfAborted()
            if (attempt === 1)
              warnings.push(
                `구역 ${row * columns + col + 1} 인식 실패 · ${cause instanceof Error ? cause.message : String(cause)}`,
              )
          }
        }
        if (!result) continue
        successful++
        if (result.uncertainty?.includes('경계 밖 객체'))
          warnings.push(
            `구역 ${row * columns + col + 1} · ${result.uncertainty.slice(result.uncertainty.indexOf('경계 밖 객체'), result.uncertainty.indexOf('경계 밖 객체') + 240)}`,
          )
        const uncertain = (result.objects ?? []).filter((item) => item.confidence < 0.25).length
        if (uncertain)
          warnings.push(
            `구역 ${row * columns + col + 1} · 신뢰도 25% 미만 ${uncertain}개 제외 · 상세 분석 또는 확대 도면 필요`,
          )
        for (const item of result.objects ?? []) {
          if (item.confidence < 0.25) continue
          // 방 이름과 상부 치수 및 통로 식별자를 바닥 설비로 배치하지 않는 의미 보정
          const annotation =
            /계단실|장실\s*\(|회의실|실험실|사무실|문서고|임원실|부서장실|품질경영실|수입검사실|후처리실|양정|상부\s*OPEN|GIRDER\s*CRANE|^PA[-\s]?P\d+/i.test(
              item.label,
            )
          const x = (left + (item.x / 1000) * (right - left)) * drawing.width
          const y = (top + (item.y / 1000) * (bottom - top)) * drawing.height
          candidates.push({
            ...item,
            kind: annotation ? 'text' : item.kind,
            id: '',
            label: item.label.trim().slice(0, 200),
            x,
            y,
            width: Math.min(
              (item.width / 1000) * (right - left) * drawing.width,
              drawing.width - x,
            ),
            height: Math.min(
              (item.height / 1000) * (bottom - top) * drawing.height,
              drawing.height - y,
            ),
            status: annotation || item.confidence < 0.75 ? 'review' : 'accepted',
          })
        }
        for (const route of result.routes ?? [])
          routes.push({
            confidence: route.confidence,
            points: route.points.map((point) => ({
              x: (left + (point.x / 1000) * (right - left)) * 1000,
              y: (top + (point.y / 1000) * (bottom - top)) * 1000,
            })),
          })
      }
    if (!successful)
      throw new Error('모든 구역의 도면 인식에 실패했습니다. 비전 서비스 상태를 확인하세요.')
    const objects: DrawingObject[] = []
    for (const item of candidates.sort((a, b) => b.confidence - a.confidence)) {
      const duplicate = objects.some(
        (existing) => existing.kind === item.kind && overlap(existing, item) > 0.55,
      )
      if (!duplicate) objects.push(item)
    }
    objects.sort((a, b) => a.y - b.y || a.x - b.x)
    const old = drawing.detections ?? []
    let next = Math.max(0, ...old.map((item) => Number(item.id.replace(/^O/, '')) || 0))
    const used = new Set<string>()
    for (const object of objects) {
      const match = old.find(
        (item) => !used.has(item.id) && item.kind === object.kind && overlap(item, object) > 0.55,
      )
      object.id = match?.id ?? `O${++next}`
      used.add(object.id)
      if (match?.status === 'rejected') object.status = 'rejected'
      if (match?.heightMm) object.heightMm = match.heightMm
      if (!object.label && object.kind !== 'text') {
        const text = objects
          .filter((item) => item.kind === 'text' && item.label && overlap(object, item) > 0.5)
          .sort((a, b) => b.confidence - a.confidence)[0]
        if (text) object.label = text.label
      }
    }
    const locked = old.filter((item) => item.locked)
    const merged = [
      ...locked,
      ...objects.filter((item) => !locked.some((previous) => overlap(previous, item) > 0.55)),
    ]
    const ids = new Set<string>()
    for (const item of merged) {
      if (ids.has(item.id)) item.id = `O${++next}`
      ids.add(item.id)
    }
    drawing.detections = merged.slice(0, 5000)
    drawing.routes = routes
    drawing.analyzedTiles = count
    // 부분 실패는 다음 요청에서 재분석할 수 있도록 완료 캐시에서 제외하는 상태
    drawing.objectsAnalyzed = warnings.length === 0
    return { objects: drawing.detections, warnings }
  } finally {
    image.src = ''
    if (drawing.source) URL.revokeObjectURL(url)
  }
}

/**
 * 비전 중심선을 분할하고 교차점과 가까운 끝점을 공유하는 흑백 도면 그래프 구성
 * @param drawing 전체 도면과 정규화된 통로 중심선
 * @returns 분석 영상 좌표의 편집 그래프
 */
export const visionDrawingGraph = (drawing: DrawingAttachment): DrawingGraph => {
  const routes = (drawing.routes ?? drawing.vision?.routes ?? []).filter(
    (route) => route.confidence >= 0.5,
  )
  const segments: { a: { x: number; y: number }; b: { x: number; y: number }; cuts: number[] }[] =
    []
  for (const route of routes)
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1],
        b = route.points[i]
      if (Math.hypot(a.x - b.x, a.y - b.y) > 0.2) segments.push({ a, b, cuts: [0, 1] })
    }
  if (segments.length > 4000)
    throw new Error('비전 중심선이 너무 많습니다. 도면을 구역별로 나누세요.')
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const p = segments[i],
        q = segments[j]
      const dx = p.b.x - p.a.x,
        dy = p.b.y - p.a.y,
        ex = q.b.x - q.a.x,
        ey = q.b.y - q.a.y
      const cross = dx * ey - dy * ex
      if (Math.abs(cross) < 1e-8) continue
      const x = q.a.x - p.a.x,
        y = q.a.y - p.a.y
      const t = (x * ey - y * ex) / cross,
        u = (x * dy - y * dx) / cross
      if (t > 0 && t < 1 && u >= 0 && u <= 1) {
        p.cuts.push(t)
        q.cuts.push(u)
      }
    }
  const points: DrawingGraph['points'] = [],
    edges: DrawingGraph['edges'] = [],
    seen = new Set<string>()
  /** 분석 픽셀 한 개 이내의 같은 교차점을 합치는 그래프 정점 조회 */
  const node = (x: number, y: number) => {
    const point = { x: (x / 1000) * drawing.analysisWidth, y: (y / 1000) * drawing.analysisHeight }
    const index = points.findIndex((other) => Math.hypot(other.x - point.x, other.y - point.y) < 1)
    if (index >= 0) return index
    points.push(point)
    return points.length - 1
  }
  for (const segment of segments) {
    const cuts = [...new Set(segment.cuts)].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) {
      const ids = [cuts[i - 1], cuts[i]].map((t) =>
        node(
          segment.a.x + (segment.b.x - segment.a.x) * t,
          segment.a.y + (segment.b.y - segment.a.y) * t,
        ),
      )
      const key = [...ids].sort((a, b) => a - b).join('-')
      if (ids[0] !== ids[1] && !seen.has(key)) {
        seen.add(key)
        edges.push([ids[0], ids[1]])
      }
    }
  }
  if (!edges.length)
    throw new Error(
      '도면에서 주행 통로를 식별하지 못했습니다. 통로를 색상 선으로 표시하거나 구역을 확대해 다시 첨부하세요.',
    )
  return { points, edges, components: 0, maskPixels: 0, color: 'black' }
}
