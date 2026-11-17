/**
 * 파일명: drawing.ts
 * 설명: 원본 도면의 첨부 준비와 워커 실행 및 편집 가능한 맵과 축척 변환
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
import { emptyDocument, parseDocument } from '@/entities/map/index.ts'
import type { MapDocument } from '@/entities/map/index.ts'
import type {
  DrawingAttachment,
  DrawingGraph,
  RouteColor,
} from '@/features/drawing-import/model/types.ts'

/**
 * 원본 해상도와 식별값을 보관하며 분석 영상과 비전 입력을 생성하는 도면 첨부 준비
 * @param file 사용자가 첨부한 이미지
 * @returns 워커 분석용 픽셀과 도면 표시용 이미지
 */
export const prepareDrawing = async (file: File): Promise<DrawingAttachment> => {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 40 * 1024 * 1024
  )
    throw new Error('도면은 40MB 이하의 PNG, JPEG, WebP 이미지로 첨부하세요.')
  const url = URL.createObjectURL(file)
  const image = new Image()
  try {
    image.src = url
    await image.decode()
    const width = image.naturalWidth,
      height = image.naturalHeight
    if (width * height > 180000000 || Math.max(width, height) > 50000)
      throw new Error('도면 크기가 분석 범위를 초과합니다. 구역별 이미지로 나누어 주세요.')
    const ratio = Math.min(1, 2816 / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(height * ratio))
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const colors = { green: 0, magenta: 0, cyan: 0, blue: 0, red: 0, black: 0 }
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i],
        g = pixels[i + 1],
        b = pixels[i + 2]
      if (g > 100 && g > r * 1.45 && g > b * 1.45) colors.green++
      if (r > 120 && b > 120 && g < Math.min(r, b) * 0.65) colors.magenta++
      if (g > 120 && b > 120 && r < Math.min(g, b) * 0.65) colors.cyan++
      if (b > 100 && b > r * 1.45 && b > g * 1.45) colors.blue++
      if (r > 100 && r > g * 1.45 && r > b * 1.45) colors.red++
      if (Math.max(r, g, b) < 110) colors.black++
    }
    const preview = document.createElement('canvas')
    const previewRatio = Math.min(1, 1280 / canvas.width)
    preview.width = Math.round(canvas.width * previewRatio)
    preview.height = Math.round(canvas.height * previewRatio)
    preview.getContext('2d')!.drawImage(canvas, 0, 0, preview.width, preview.height)
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    const sourceImage =
      file.size <= 10 * 1024 * 1024
        ? await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(new Error('도면 원본을 읽지 못했습니다.'))
            reader.readAsDataURL(file)
          })
        : undefined
    return {
      id: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      name: file.name,
      source: file,
      width,
      height,
      analysisWidth: canvas.width,
      analysisHeight: canvas.height,
      image: canvas.toDataURL('image/png'),
      sourceImage,
      visionImage: preview.toDataURL('image/jpeg', 0.85),
      pixels,
      colors,
    }
  } finally {
    image.src = ''
    URL.revokeObjectURL(url)
  }
}
/**
 * 취소 가능한 전용 워커에서 도면 경로를 추출하는 비동기 작업
 * @param drawing 첨부한 도면
 * @param color 추출할 경로 색상
 * @param signal 작업 취소 신호
 * @param progress 현재 작업을 표시할 콜백
 * @returns 도면 분석 좌표계의 그래프
 */
export const extractDrawingGraph = (
  drawing: DrawingAttachment,
  color: RouteColor,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<DrawingGraph> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('도면 분석을 취소했습니다.'))
      return
    }
    const worker = new Worker(new URL('../lib/trace.worker.ts', import.meta.url), {
      type: 'module',
    })
    /** 워커와 취소 이벤트를 함께 정리하는 작업 종료 */
    const finish = () => {
      worker.terminate()
      signal.removeEventListener('abort', cancel)
    }
    /** 도면 분석 취소 신호를 처리하는 작업 중단 */
    const cancel = () => {
      finish()
      reject(new Error('도면 분석을 취소했습니다.'))
    }
    signal.addEventListener('abort', cancel, { once: true })
    worker.onerror = () => {
      finish()
      reject(new Error('도면 분석 워커를 실행하지 못했습니다.'))
    }
    worker.onmessage = (event) => {
      if (event.data.progress) progress(event.data.progress)
      else if (event.data.error) {
        finish()
        reject(new Error(event.data.error))
      } else if (event.data.result) {
        finish()
        resolve(event.data.result)
      }
    }
    // 원본 픽셀을 유지하여 색상을 바꾼 후속 요청도 같은 도면에서 분석 가능한 전달
    const pixels = drawing.pixels.slice()
    worker.postMessage(
      {
        pixels: pixels.buffer,
        width: drawing.analysisWidth,
        height: drawing.analysisHeight,
        color,
      },
      [pixels.buffer],
    )
  })
/**
 * 분석 좌표를 원본 이미지 좌표와 실제 치수로 변환하는 편집용 지도 생성
 * @param drawing 원본 도면 정보
 * @param graph 추출한 중심선 그래프
 * @param scale 원본 픽셀당 밀리미터 또는 축척 미확정 표시
 * @returns 일반 편집기에서 선택과 수정이 가능한 맵 문서
 */
export const buildDrawingMap = (
  drawing: DrawingAttachment,
  graph: DrawingGraph,
  scale: number | null = null,
): MapDocument => {
  if (scale !== null && (!Number.isFinite(scale) || scale <= 0 || scale > 100000))
    throw new Error('도면 축척을 확인하세요.')
  const map = emptyDocument()
  map.name = drawing.name.replace(/\.[^.]+$/, '')
  map.units = scale === null ? 'px' : 'mm'
  const factor = scale ?? 1
  map.nodes = graph.points.map((point, index) => ({
    id: index + 1,
    name: `N${index + 1}`,
    realId: index + 1,
    uid: index + 1,
    direction: 1,
    x: Math.round(((point.x * drawing.width) / drawing.analysisWidth) * factor),
    y: Math.round((drawing.height - (point.y * drawing.height) / drawing.analysisHeight) * factor),
    drawingKey: `${point.x},${point.y}`,
  }))
  map.edges = graph.edges.map(([a, b], index) => ({
    id: `D${index + 1}`,
    from: a + 1,
    to: b + 1,
    direction: 1,
    drivingType: 1,
    distance: Math.round(
      Math.hypot(map.nodes[a].x - map.nodes[b].x, map.nodes[a].y - map.nodes[b].y),
    ),
  }))
  map.drawing = {
    id: drawing.id,
    name: drawing.name,
    width: drawing.width,
    height: drawing.height,
    image: drawing.image,
    sourceImage: drawing.sourceImage,
    routeColor: graph.color,
    scaleMmPerPixel: scale,
  }
  return parseDocument(JSON.stringify(map))
}
/**
 * 선택한 두 기준 노드의 실제 거리로 수동 편집을 포함한 전체 도면 맵의 축척 적용
 * @param input 원본 도면 맵
 * @param ids 기준 노드 두 개
 * @param distanceMm 실제 거리
 * @returns 밀리미터 좌표로 보정한 지도
 */
export const calibrateDrawingMap = (
  input: MapDocument,
  ids: number[],
  distanceMm: number,
): MapDocument => {
  if (
    !input.drawing ||
    ids.length !== 2 ||
    ids[0] === ids[1] ||
    !Number.isFinite(distanceMm) ||
    distanceMm <= 0
  )
    throw new Error('기준 노드 두 개와 양의 실제 거리 mm를 지정하세요.')
  const [a, b] = ids.map((id) => input.nodes.find((node) => node.id === id))
  if (!a || !b) throw new Error('기준 노드를 찾지 못했습니다.')
  const distance = Math.hypot(a.x - b.x, a.y - b.y)
  if (distance <= 0) throw new Error('기준 노드의 좌표가 같습니다.')
  const factor = distanceMm / distance
  const map = structuredClone(input)
  for (const node of map.nodes) {
    node.x = Math.round(node.x * factor)
    node.y = Math.round(node.y * factor)
  }
  for (const edge of map.edges) {
    if (edge.distance !== undefined) edge.distance = Math.round(edge.distance * factor)
    if (edge.radius !== undefined) edge.radius = Math.round(edge.radius * factor)
  }
  for (const port of map.ports)
    for (const key of ['x', 'y', 'width', 'height', 'nameDistance', 'fontSize'] as const)
      if (port[key] !== undefined) port[key] = Math.round(port[key]! * factor)
  for (const group of map.portGroups ?? [])
    for (const key of [
      'x',
      'y',
      'width',
      'height',
      'nodeX',
      'nodeY',
      'offsetX',
      'offsetY',
    ] as const)
      if (group[key] !== undefined) group[key] = Math.round(group[key]! * factor)
  for (const shape of map.shapes ?? [])
    for (const key of [
      'x1',
      'x2',
      'y1',
      'y2',
      'centerX',
      'centerY',
      'radius',
      'width',
      'height',
      'strokeWidth',
    ] as const)
      shape[key] = Math.round(shape[key] * factor)
  if (map.layout) {
    map.layout.x *= factor
    map.layout.y *= factor
    map.layout.width *= factor
    map.layout.height *= factor
    if (map.layout.id === map.drawing!.id) map.layout.calibrated = true
  }
  if (map.drawing?.frame) {
    map.drawing.frame.x *= factor
    map.drawing.frame.y *= factor
  }
  map.units = 'mm'
  map.drawing!.scaleMmPerPixel =
    (input.drawing.scaleMmPerPixel ?? input.drawing.workingScale ?? 1) * factor
  return parseDocument(JSON.stringify(map))
}

/**
 * 도면 또는 맵의 중심선을 기준으로 지정한 구역에 포함되는 노드를 판정하는 범위 검사
 * @param map 기준 맵
 * @param region 요청한 구역
 * @param point 판정할 좌표
 * @returns 요청 구역에 포함되는지 여부
 */
export const inDrawingRegion = (
  map: MapDocument,
  region: string,
  point: { x: number; y: number },
) => {
  if (map.drawing?.frame) {
    const frame = map.drawing.frame,
      angle = (-frame.rotation * Math.PI) / 180,
      dx = point.x - frame.x,
      dy = point.y - frame.y
    point = {
      x: dx * Math.cos(angle) - dy * Math.sin(angle),
      y: dx * Math.sin(angle) + dy * Math.cos(angle),
    }
  }
  const xs = map.drawing ? [] : map.nodes.map((node) => node.x),
    ys = map.drawing ? [] : map.nodes.map((node) => node.y)
  const middleX = map.drawing
    ? (map.drawing.width * (map.drawing.scaleMmPerPixel ?? map.drawing.workingScale ?? 1)) / 2
    : (Math.min(...xs) + Math.max(...xs)) / 2
  const middleY = map.drawing
    ? (map.drawing.height * (map.drawing.scaleMmPerPixel ?? map.drawing.workingScale ?? 1)) / 2
    : (Math.min(...ys) + Math.max(...ys)) / 2
  if (region === 'left') return point.x < middleX
  if (region === 'right') return point.x >= middleX
  if (region === 'top') return point.y >= middleY
  if (region === 'bottom') return point.y < middleY
  return true
}
/**
 * 같은 도면의 지정 구역만 재생성하며 외부 구역과 사용자 포트를 보존하는 그래프 병합
 * @param original 현재 편집 맵
 * @param generated 도면에서 다시 추출한 전체 맵
 * @param region 재생성할 도면 구역
 * @returns 지정 구역을 교체한 지도
 */
export const mergeDrawingRegion = (
  original: MapDocument,
  generated: MapDocument,
  region: string,
  selection?: number[],
): MapDocument => {
  if (
    !original.drawing ||
    original.drawing.id !== generated.drawing?.id ||
    original.units !== generated.units
  )
    throw new Error('같은 도면과 축척의 맵에서 구역별 재생성을 요청하세요.')
  if (!['left', 'right', 'top', 'bottom', 'selection'].includes(region))
    throw new Error('재생성할 구역을 왼쪽·오른쪽·상단·하단으로 지정하세요.')
  const selected = original.nodes.filter((node) => selection?.includes(node.id))
  if (region === 'selection' && selected.length < 2)
    throw new Error('재생성할 영역의 노드를 두 개 이상 선택하세요.')
  const left = Math.min(...selected.map((node) => node.x)),
    right = Math.max(...selected.map((node) => node.x))
  const bottom = Math.min(...selected.map((node) => node.y)),
    top = Math.max(...selected.map((node) => node.y))
  /** 선택 경계 또는 도면 절반을 사용하는 재생성 범위 판정 */
  const contains = (map: MapDocument, point: { x: number; y: number }) =>
    region === 'selection'
      ? point.x >= left && point.x <= right && point.y >= bottom && point.y <= top
      : inDrawingRegion(map, region, point)
  const map = structuredClone(original)
  const oldKeys = new Map(
    original.nodes.filter((node) => node.drawingKey).map((node) => [node.drawingKey!, node]),
  )
  const protectedIds = new Set(original.ports.map((port) => port.nodeId))
  const inside = new Set(
    original.nodes
      .filter((node) => node.drawingKey && contains(original, node) && !protectedIds.has(node.id))
      .map((node) => node.id),
  )
  map.nodes = map.nodes.filter((node) => !inside.has(node.id))
  const references = new Map<number, number>()
  let nextId = Math.max(0, ...original.nodes.map((node) => node.id))
  for (const node of generated.nodes) {
    const old = node.drawingKey ? oldKeys.get(node.drawingKey) : undefined
    if (contains(generated, node) && !protectedIds.has(old?.id ?? -1)) {
      const replacement = { ...node, id: old?.id ?? ++nextId }
      replacement.name = `N${replacement.id}`
      replacement.realId = replacement.id
      replacement.uid = replacement.id
      map.nodes.push(replacement)
      references.set(node.id, replacement.id)
    } else if (old) references.set(node.id, old.id)
  }
  const ids = new Set(map.nodes.map((node) => node.id))
  map.edges = original.edges.filter(
    (edge) =>
      ids.has(edge.from) && ids.has(edge.to) && !(inside.has(edge.from) && inside.has(edge.to)),
  )
  const connections = new Set(
    map.edges.map((edge) => [edge.from, edge.to].sort((a, b) => a - b).join('-')),
  )
  for (const edge of generated.edges) {
    const from = references.get(edge.from),
      to = references.get(edge.to)
    if (from === undefined || to === undefined || !ids.has(from) || !ids.has(to)) continue
    const a = generated.nodes.find((node) => node.id === edge.from)!,
      b = generated.nodes.find((node) => node.id === edge.to)!
    if (!contains(generated, a) && !contains(generated, b)) continue
    const key = [from, to].sort((a, b) => a - b).join('-')
    if (connections.has(key)) continue
    map.edges.push({ ...edge, id: `D-${from}-${to}`, from, to })
    connections.add(key)
  }
  if (map.drawing?.fillets)
    map.drawing.fillets = map.drawing.fillets.filter(
      (fillet) => ids.has(fillet.corner) && fillet.nodes.every((id) => ids.has(id)),
    )
  return parseDocument(JSON.stringify(map))
}
