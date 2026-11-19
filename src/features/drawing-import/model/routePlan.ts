/**
 * 파일명: routePlan.ts
 * 설명: 도면 기준선과 작업 순서로 주행 경로와 랙 포트를 만드는 설계 계산
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
import {
  appendCurve,
  emptyDocument,
  MAX_NODES,
  parseDocument,
  previewLegacy,
  serializeLegacy,
  type MapNode,
  type MapPoint,
} from '@/entities/map/index.ts'
import { createLayout } from '@/features/drawing-import/model/layout.ts'
import type { DrawingAttachment } from '@/features/drawing-import/model/types.ts'

type Rect = MapPoint & { width: number; height: number }
type Rack = { bounds: Rect; approach: MapPoint; routeIndex: number; levels: number }
type Reference = { axis: 'x' | 'y'; start: number; end: number; mm: number; cross?: number }

/** 영상 인식 후보의 치수선이 실제 픽셀에서 이어지는지 확인하는 판정 */
export const supportedDimensionLine = (
  drawing: DrawingAttachment,
  reference: Reference & { cross: number },
) => {
  const { analysisWidth: w, analysisHeight: h, pixels } = drawing
  const horizontal = reference.axis === 'x'
  const length = horizontal ? w : h
  const depth = horizontal ? h : w
  const start = Math.round((Math.min(reference.start, reference.end) * length) / 1000)
  const end = Math.round((Math.max(reference.start, reference.end) * length) / 1000)
  const cross = Math.round((reference.cross * depth) / 1000)
  if (start < 2 || end > length - 3 || end - start < 12 || cross < 2 || cross > depth - 3)
    return false
  const dark = (along: number, across: number) => {
    const x = horizontal ? along : across
    const y = horizontal ? across : along
    const i = (y * w + x) * 4
    return pixels[i + 3] > 60 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 190
  }
  for (let row = cross - 2; row <= cross + 2; row++) {
    let evidence = 0
    for (let i = start; i <= end; i++) if (dark(i, row)) evidence++
    if (evidence / (end - start + 1) >= 0.8 && dark(start + 2, row) && dark(end - 2, row))
      return true
  }
  return false
}

/** 도면에 표시되는 정규화 좌표인지 검사 */
const isPoint = (p: MapPoint) =>
  p && [p.x, p.y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1000)

/** 입력 배열의 개수 제한과 자료형 검사 */
const list = <T>(value: unknown, max: number): T[] => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > max)
    throw new Error('도면 설계 항목의 개수를 확인하세요.')
  return value as T[]
}

/** 주행 선분과 직사각형 장애물의 교차를 축별 매개변수 범위로 검사 */
const intersects = (a: MapPoint, b: MapPoint, rect: Rect, margin: number) => {
  let from = 0
  let to = 1
  for (const [axis, span] of [
    ['x', 'width'],
    ['y', 'height'],
  ] as const) {
    const delta = b[axis] - a[axis]
    const low = rect[axis] - margin
    const high = rect[axis] + rect[span] + margin
    if (!delta) {
      if (a[axis] < low || a[axis] > high) return false
      continue
    }
    const first = (low - a[axis]) / delta
    const last = (high - a[axis]) / delta
    from = Math.max(from, Math.min(first, last))
    to = Math.min(to, Math.max(first, last))
    if (from > to) return false
  }
  return true
}

/** 도면에서 읽은 가로와 세로 길이를 독립 축척으로 처리 */
const calibration = (references: Reference[], drawing: DrawingAttachment) => {
  const scale: Partial<Record<'x' | 'y', number>> = {}
  for (const reference of references) {
    const { axis, start, end, mm, cross } = reference
    const delta = Math.abs(end - start)
    if (
      !['x', 'y'].includes(axis) ||
      scale[axis] !== undefined ||
      ![start, end, mm].every(Number.isFinite) ||
      Math.min(start, end) < 0 ||
      Math.max(start, end) > 1000 ||
      delta < 1 ||
      mm <= 0 ||
      mm > 1e7
    )
      throw new Error('치수선 기준의 축과 양 끝 및 실제 길이를 확인하세요.')
    const candidate = drawing.vision?.references?.find(
      (item) =>
        item.axis === axis &&
        Math.abs(item.start - start) < 2 &&
        Math.abs(item.end - end) < 2 &&
        item.mm === mm,
    )
    const evidence = cross ?? candidate?.cross
    if (
      evidence !== undefined &&
      !supportedDimensionLine(drawing, { ...reference, cross: evidence })
    )
      throw new Error(
        '치수선 후보와 원본 픽셀이 일치하지 않습니다. 확인한 기준 길이를 사용하거나 실제 치수 없이 초안을 만드세요.',
      )
    scale[axis] = (mm * 1000) / (delta * (axis === 'x' ? drawing.width : drawing.height))
  }
  const x = scale.x ?? scale.y ?? 1
  const y = scale.y ?? scale.x ?? 1
  if (drawing.width * x > 1e9 || drawing.height * y > 1e9)
    throw new Error('도면이 지원하는 지도 좌표 범위를 초과합니다.')
  return { x, y }
}

/** 접선 시작과 끝 및 주행 방향이 연속인 원호를 계산 */
const fillet = (a: MapPoint, b: MapPoint, c: MapPoint, radius: number) => {
  const first = Math.hypot(b.x - a.x, b.y - a.y)
  const second = Math.hypot(c.x - b.x, c.y - b.y)
  const u = { x: (b.x - a.x) / first, y: (b.y - a.y) / first }
  const v = { x: (c.x - b.x) / second, y: (c.y - b.y) / second }
  const turn = Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y)
  if (Math.abs(turn) < 0.06 || Math.abs(turn) >= Math.PI - 0.06) return
  const tangent = radius * Math.tan(Math.abs(turn) / 2)
  if (tangent < 1 || tangent > Math.min(first, second) * 0.49) return
  const start = { x: b.x - u.x * tangent, y: b.y - u.y * tangent }
  const center = {
    x: start.x - u.y * radius * Math.sign(turn),
    y: start.y + u.x * radius * Math.sign(turn),
  }
  const begin = Math.atan2(start.y - center.y, start.x - center.x)
  const steps = Math.max(2, Math.ceil(Math.abs(turn) / (Math.PI / 12)))
  const points = Array.from({ length: steps + 1 }, (_, index) => ({
    x: Math.round(center.x + radius * Math.cos(begin + (turn * index) / steps)),
    y: Math.round(center.y + radius * Math.sin(begin + (turn * index) / steps)),
  }))
  return {
    points,
    radius,
    angle: Math.round((Math.abs(turn) * 180) / Math.PI),
    goalDegree: Math.round(
      ((Math.atan2(center.y - start.y, center.x - start.x) * 180) / Math.PI + 360) % 360,
    ),
    drivingType: turn > 0 ? 2 : 3,
  }
}

/** 입고와 각 포트 및 출고의 MGS 주행 방향 연결성을 검증 */
const validateAccess = (map: ReturnType<typeof emptyDocument>, start: number, end: number) => {
  const forward = new Map(map.nodes.map(({ id }) => [id, [] as number[]]))
  const backward = new Map(map.nodes.map(({ id }) => [id, [] as number[]]))
  for (const edge of map.edges) {
    forward.get(edge.to)!.push(edge.from)
    backward.get(edge.from)!.push(edge.to)
    if (edge.direction === 1) {
      forward.get(edge.from)!.push(edge.to)
      backward.get(edge.to)!.push(edge.from)
    }
  }
  const walk = (graph: Map<number, number[]>, origin: number) => {
    const seen = new Set([origin])
    for (const current of seen) for (const next of graph.get(current) ?? []) seen.add(next)
    return seen
  }
  const reachable = walk(forward, start)
  const exits = walk(backward, end)
  if (map.ports.some(({ nodeId }) => !reachable.has(nodeId) || !exits.has(nodeId)))
    throw new Error('입고에서 포트와 출고까지의 주행 방향을 연결할 수 없습니다.')
}

/** 주행 중심선과 정차점을 검증 가능한 미저장 지도 문서로 구성 */
export const planDrawingRoute = (drawing: DrawingAttachment, args: Record<string, unknown>) => {
  const waypoints = list<MapPoint>(args.waypoints, 80)
  const references = list<Reference>(args.references, 2)
  const racks = list<Rack>(args.racks, 40)
  const obstacles = list<Rect>(args.obstacles, 100)
  const scale = calibration(references, drawing)
  const map = emptyDocument()
  map.name = drawing.name.replace(/\.[^.]+$/, '')
  map.units = references.length ? 'mm' : 'px'
  const spacing =
    map.units === 'mm'
      ? Number(args.spacingMm ?? 1200)
      : Math.max(drawing.width, drawing.height) / 30
  const radius = map.units === 'mm' ? Number(args.radiusMm ?? 0) : 0
  const vehicleWidth = Number(args.vehicleWidthMm ?? 0)
  const clearance = Number(args.clearanceMm ?? 0)
  if (
    waypoints.length < 2 ||
    waypoints.some((p) => !isPoint(p)) ||
    !Number.isFinite(spacing) ||
    spacing < 1 ||
    !Number.isSafeInteger(radius) ||
    radius < 0 ||
    [vehicleWidth, clearance].some((value) => !Number.isFinite(value) || value < 0 || value > 1e6)
  )
    throw new Error('입고부터 출고까지의 좌표와 간격 및 반경을 확인하세요.')
  const bounds = [...obstacles, ...racks.map((rack) => rack.bounds)]
  if (
    bounds.some(
      (r) =>
        !isPoint(r) ||
        r.width <= 0 ||
        r.height <= 0 ||
        !isPoint({ x: r.x + r.width, y: r.y + r.height }),
    ) ||
    racks.some(
      (rack) =>
        !isPoint(rack.approach) ||
        !Number.isInteger(rack.routeIndex) ||
        rack.routeIndex <= 0 ||
        rack.routeIndex >= waypoints.length - 1 ||
        !Number.isInteger(rack.levels) ||
        rack.levels < 1 ||
        rack.levels > 20,
    )
  )
    throw new Error('장애물과 랙 경계 및 접근 노드와 층수를 확인하세요.')
  const sx = (scale.x * drawing.width) / 1000
  const sy = (scale.y * drawing.height) / 1000
  const world = (p: MapPoint) => ({ x: Math.round(p.x * sx), y: Math.round((1000 - p.y) * sy) })
  const rectWorld = (r: Rect) => ({
    ...world({ x: r.x, y: r.y + r.height }),
    width: r.width * sx,
    height: r.height * sy,
  })
  const blocked = bounds.map(rectWorld)
  const route = waypoints.map(world)
  if (route.some((p, i) => i > 0 && p.x === route[i - 1].x && p.y === route[i - 1].y))
    throw new Error('연속된 경유점의 좌표가 같습니다.')
  const addNode = (p: MapPoint) => {
    if (map.nodes.length >= MAX_NODES) throw new Error('노드 수를 줄이도록 간격을 조정하세요.')
    const id = map.nodes.length + 1
    const n = { ...p, id, uid: id, realId: id, name: `N${id}`, direction: 0 }
    map.nodes.push(n)
    return n
  }
  const start = addNode(route[0])
  let cursor: MapNode = start
  const anchors = new Map<number, MapNode>([[0, start]])
  const segment = (from: MapNode, to: MapNode, direction = 0) =>
    map.edges.push({
      id: `E${to.id}-${from.id}`,
      from: to.id,
      to: from.id,
      drivingType: 1,
      direction,
    })
  const extend = (target: MapPoint) => {
    const from = cursor
    const count = Math.ceil(Math.hypot(target.x - from.x, target.y - from.y) / spacing)
    if (map.nodes.length + count > MAX_NODES) throw new Error('노드 간격이 너무 작습니다.')
    for (let i = 1; i <= count; i++) {
      const x = Math.round(from.x + ((target.x - from.x) * i) / count)
      const y = Math.round(from.y + ((target.y - from.y) * i) / count)
      if (x === cursor.x && y === cursor.y) continue
      const next = addNode({ x, y })
      segment(cursor, next)
      cursor = next
    }
  }
  let rounded = 0
  for (let i = 1; i < route.length; i++) {
    const curve =
      radius && i < route.length - 1 && !racks.some((rack) => rack.routeIndex === i)
        ? fillet(route[i - 1], route[i], route[i + 1], radius)
        : undefined
    if (curve) {
      extend(curve.points[0])
      appendCurve(map, cursor.id, curve, 0, map.nodes.length)
      cursor = map.nodes.at(-1)!
      rounded++
    } else {
      extend(route[i])
      anchors.set(i, cursor)
    }
  }
  const end = cursor
  const port = (id: string, node: MapNode, p: MapPoint, floor = 1, width = 250, height = 450) =>
    map.ports.push({ ...p, id, name: id, nodeId: node.id, floor, width, height })
  port('IN_01', start, start)
  map.shapes = []
  for (const [index, rack] of racks.entries()) {
    const anchor = anchors.get(rack.routeIndex)!
    const approach = world(rack.approach)
    const stop = approach.x === anchor.x && approach.y === anchor.y ? anchor : addNode(approach)
    if (stop !== anchor) segment(anchor, stop, 1)
    const box = rectWorld(rack.bounds)
    const w = Math.round(box.width)
    const h = Math.round(box.height)
    const number = String(index + 1).padStart(2, '0')
    map.shapes.push({
      id: index + 1,
      type: 1,
      description: `RACK ${number} · ${rack.levels}단`,
      text: '',
      x1: box.x,
      y1: box.y,
      x2: box.x + w,
      y2: box.y + h,
      centerX: box.x + Math.floor(w / 2),
      centerY: box.y + Math.floor(h / 2),
      width: w,
      height: h,
      radius: 0,
      strokeColor: 0x766242,
      strokeStyle: 0,
      strokeWidth: 2,
      fillColor: 0xffffff,
      fontColor: 0,
      fontAlign: 0,
      fontDirection: 0,
      fillStyle: 9,
    })
    for (let floor = 1; floor <= rack.levels; floor++)
      port(
        `ST_${number}_${floor}F`,
        stop,
        { x: box.x + Math.round(((floor - 0.5) * w) / rack.levels), y: box.y + Math.floor(h / 2) },
        floor,
        Math.max(1, Math.floor((w / rack.levels) * 0.6)),
        Math.max(1, Math.round(h * 0.3)),
      )
  }
  port('OUT_01', end, end)
  const nodes = new Map(map.nodes.map((n) => [n.id, n]))
  const margin = map.units === 'mm' ? vehicleWidth / 2 + clearance : 0
  for (const edge of map.edges)
    if (
      blocked.some((rect) => intersects(nodes.get(edge.from)!, nodes.get(edge.to)!, rect, margin))
    )
      throw new Error(
        `경로 N${edge.to} → N${edge.from}이 장애물 또는 랙의 여유 범위와 겹칩니다. 경유점이나 접근점을 옮겨주세요.`,
      )
  if (args.applyBackground === true) {
    const layout = createLayout(map, drawing, { x: 0, y: 0, widthMm: drawing.width * scale.x })
    layout.height = drawing.height * scale.y
    map.layout = layout
  }
  if (scale.x === scale.y) {
    map.drawing = {
      id: drawing.id,
      name: drawing.name,
      width: drawing.width,
      height: drawing.height,
      image: drawing.image,
      sourceImage: drawing.sourceImage,
      routeColor: 'vision',
      scaleMmPerPixel: map.units === 'mm' ? scale.x : null,
    }
  }
  const checked = parseDocument(JSON.stringify(map))
  if (map.units === 'mm') {
    const native = serializeLegacy(checked)
    validateAccess(previewLegacy(native.content, 'draft.jmapx', native.groups), start.id, end.id)
  } else validateAccess(checked, start.id, end.id)
  return { map: checked, rounded, dimensionAxes: references.length }
}
