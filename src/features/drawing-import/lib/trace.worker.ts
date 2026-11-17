/**
 * 파일명: trace.worker.ts
 * 설명: 색상 마스크와 세선화 및 연결 추적으로 중심선 그래프를 생성하는 도면 워커
 * 작성자: 이희원
 * 작성일자: 2026-11-17
 */
import type { DrawingGraph, RouteColor } from '@/features/drawing-import/model/types.ts'
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage: (value: unknown) => void
}
/** 색상 경계의 보간값을 허용하며 지정한 경로 색상을 분리하는 픽셀 판정 */
const matches = (r: number, g: number, b: number, color: RouteColor) => {
  if (color === 'black') return Math.max(r, g, b) < 110
  if (color === 'green') return g > 100 && g > r * 1.45 && g > b * 1.45
  if (color === 'magenta') return r > 120 && b > 120 && g < Math.min(r, b) * 0.65
  if (color === 'cyan') return g > 120 && b > 120 && r < Math.min(g, b) * 0.65
  if (color === 'blue') return b > 100 && b > r * 1.45 && b > g * 1.45
  return r > 100 && r > g * 1.45 && r > b * 1.45
}
/**
 * 끝점과 교차점 사이의 경로에서 허용 오차 이내의 점을 줄이는 선분 단순화
 * @param path 중심선을 구성하는 픽셀 인덱스
 * @param width 영상 폭
 * @returns 직선과 코너를 유지한 경로 인덱스
 */
const simplify = (path: number[], width: number, tolerance: number) => {
  const keep = new Set([0, path.length - 1])
  const stack: [number, number][] = [[0, path.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    const ax = path[first] % width,
      ay = Math.floor(path[first] / width)
    const bx = path[last] % width,
      by = Math.floor(path[last] / width)
    const dx = bx - ax,
      dy = by - ay,
      length = dx * dx + dy * dy
    let farthest = -1,
      distance = tolerance ** 2
    for (let index = first + 1; index < last; index++) {
      const x = path[index] % width,
        y = Math.floor(path[index] / width)
      const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0
      const squared = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2
      if (squared > distance) {
        distance = squared
        farthest = index
      }
    }
    if (farthest !== -1) {
      keep.add(farthest)
      stack.push([first, farthest], [farthest, last])
    }
  }
  return [...keep].sort((a, b) => a - b).map((index) => path[index])
}
/**
 * 이진 마스크의 연결을 보존하는 세선화와 그래프 추출
 * @param rgba 분석 영상의 픽셀 배열
 * @param width 분석 영상 폭
 * @param height 분석 영상 높이
 * @param color 추출할 경로 색상
 * @returns 교차점과 코너를 포함하는 도면 좌표 그래프
 */
const trace = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  color: RouteColor,
): DrawingGraph => {
  const size = width * height
  const mask = new Uint8Array(size)
  let foreground: number[] = []
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x,
        pixel = index * 4
      if (rgba[pixel + 3] > 30 && matches(rgba[pixel], rgba[pixel + 1], rgba[pixel + 2], color))
        mask[index] = 1
    }
  // 작은 문자와 색상 잡음을 제외하는 연결 성분 면적 검사
  const seen = new Uint8Array(size)
  const offsets = [-width, -width + 1, 1, width + 1, width, width - 1, -1, -width - 1]
  let components = 0
  for (let index = 0; index < size; index++) {
    if (!mask[index] || seen[index]) continue
    const queue = [index]
    seen[index] = 1
    for (let head = 0; head < queue.length; head++)
      for (const offset of offsets) {
        const next = queue[head] + offset
        if (mask[next] && !seen[next]) {
          seen[next] = 1
          queue.push(next)
        }
      }
    if (queue.length < Math.max(35, size * 0.000008)) for (const pixel of queue) mask[pixel] = 0
    else {
      components++
    }
  }
  for (let index = 0; index < size; index++) if (mask[index]) foreground.push(index)
  // 통로 두께에 비례하는 잡음 기준을 얻기 위한 원본 마스크 거리장
  const thickness = new Uint16Array(size)
  for (const pixel of foreground) thickness[pixel] = 60000
  for (const pixel of foreground)
    thickness[pixel] = Math.min(
      thickness[pixel],
      thickness[pixel - 1] + 1,
      thickness[pixel - width] + 1,
    )
  for (let i = foreground.length - 1; i >= 0; i--) {
    const pixel = foreground[i]
    thickness[pixel] = Math.min(
      thickness[pixel],
      thickness[pixel + 1] + 1,
      thickness[pixel + width] + 1,
    )
  }
  const histogram = new Map<number, number>()
  for (const pixel of foreground)
    histogram.set(thickness[pixel], (histogram.get(thickness[pixel]) ?? 0) + 1)
  let accumulated = 0,
    strokeWidth = 2
  for (const [radius, count] of [...histogram].sort((a, b) => a[0] - b[0])) {
    accumulated += count
    if (accumulated >= foreground.length * 0.9) {
      strokeWidth = Math.max(2, radius * 2)
      break
    }
  }
  // 문자와 보간으로 생긴 미세한 내부 구멍만 메우는 마스크 잡음 정리
  seen.fill(0)
  for (let index = 0; index < size; index++) {
    if (mask[index] || seen[index]) continue
    const queue = [index]
    seen[index] = 1
    let border = false,
      minX = width,
      maxX = 0,
      minY = height,
      maxY = 0
    for (let head = 0; head < queue.length; head++) {
      const pixel = queue[head],
        x = pixel % width,
        y = Math.floor(pixel / width)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      if (!x || !y || x === width - 1 || y === height - 1) border = true
      for (const offset of [-width, 1, width, -1]) {
        const next = pixel + offset
        if (
          next >= 0 &&
          next < size &&
          Math.abs((next % width) - x) <= 1 &&
          !mask[next] &&
          !seen[next]
        ) {
          seen[next] = 1
          queue.push(next)
        }
      }
    }
    if (
      !border &&
      queue.length <= Math.max(24, strokeWidth ** 2) &&
      Math.max(maxX - minX + 1, maxY - minY + 1) <= Math.max(24, strokeWidth * 2)
    )
      for (const pixel of queue) mask[pixel] = 1
  }
  foreground = []
  for (let index = 0; index < size; index++) if (mask[index]) foreground.push(index)
  const distance = new Uint16Array(size)
  for (const pixel of foreground) distance[pixel] = 60000
  for (const pixel of foreground)
    distance[pixel] = Math.min(
      distance[pixel],
      distance[pixel - 1] + 1,
      distance[pixel - width] + 1,
    )
  for (let i = foreground.length - 1; i >= 0; i--) {
    const pixel = foreground[i]
    distance[pixel] = Math.min(
      distance[pixel],
      distance[pixel + 1] + 1,
      distance[pixel + width] + 1,
    )
  }
  const maskPixels = foreground.length
  if (!maskPixels)
    throw new Error(
      '선택한 색상에서 경로 영역을 찾지 못했습니다. 도면 색상을 지정해 다시 요청해 주세요.',
    )
  scope.postMessage({ progress: '중심선과 교차점을 추출하고 있습니다.' })
  // Zhang–Suen 세선화의 두 단계 삭제 조건으로 경로 연결 보존
  let changed = true,
    iteration = 0
  while (changed && iteration++ < 512) {
    changed = false
    for (let phase = 0; phase < 2; phase++) {
      const removed: number[] = []
      for (const pixel of foreground) {
        if (!mask[pixel]) continue
        const p = offsets.map((offset) => mask[pixel + offset] || 0)
        const count = p.reduce((sum: number, value) => sum + value, 0)
        if (count < 2 || count > 6) continue
        let transitions = 0
        for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) transitions++
        if (transitions !== 1) continue
        if (
          phase === 0
            ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6]
            : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]
        )
          continue
        removed.push(pixel)
      }
      for (const pixel of removed) mask[pixel] = 0
      if (removed.length) changed = true
    }
    foreground = foreground.filter((pixel) => mask[pixel])
  }
  if (changed)
    throw new Error(
      '경로 영역이 너무 넓어 중심선 추출이 완료되지 않았습니다. 경로 색상을 확인해 주세요.',
    )
  /** 직교 연결이 있는 코너의 대각 중복을 제외하는 이웃 목록 */
  const neighbors = (pixel: number) =>
    offsets.flatMap((offset, i) => {
      const next = pixel + offset
      if (!mask[next]) return []
      if (i % 2 && (mask[pixel + offsets[i - 1]] || mask[pixel + offsets[(i + 1) % 8]])) return []
      return [next]
    })
  const junctions = new Set(foreground.filter((pixel) => neighbors(pixel).length !== 2))
  const visited = new Set<string>()
  const paths: number[][] = []
  /** 같은 선분의 정방향과 역방향을 묶는 추적 식별자 */
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)
  /** 분기점 사이의 미방문 경로를 끝까지 추적하는 연결선 구성 */
  const walk = (start: number) => {
    for (const first of neighbors(start)) {
      if (visited.has(key(start, first))) continue
      const path = [start]
      let previous = start,
        current = first
      visited.add(key(previous, current))
      while (true) {
        path.push(current)
        if (junctions.has(current) || current === start) break
        const next = neighbors(current).find((pixel) => pixel !== previous)
        if (next === undefined || visited.has(key(current, next))) break
        visited.add(key(current, next))
        previous = current
        current = next
      }
      if (
        path.length > 1 &&
        !(
          path.length < Math.max(8, Math.max(distance[start], distance[current]) * 2) &&
          (neighbors(start).length === 1 || neighbors(current).length === 1)
        )
      )
        paths.push(simplify(path, width, Math.max(1.5, strokeWidth * 0.6)))
    }
  }
  for (const start of junctions) walk(start)
  for (const pixel of foreground)
    if (neighbors(pixel).some((next) => !visited.has(key(pixel, next)))) {
      junctions.add(pixel)
      walk(pixel)
    }
  const points: DrawingGraph['points'] = [],
    edges: DrawingGraph['edges'] = []
  const ids = new Map<string, number>(),
    connections = new Set<string>()
  /** 경로가 공유하는 끝점과 교차점을 같은 그래프 정점으로 묶는 식별자 생성 */
  const pointId = (pixel: number) => {
    const x = pixel % width,
      y = Math.floor(pixel / width),
      id = `${x},${y}`
    if (!ids.has(id)) {
      ids.set(id, points.length)
      points.push({ x, y })
    }
    return ids.get(id)!
  }
  for (const path of paths)
    for (let i = 1; i < path.length; i++) {
      const a = pointId(path[i - 1]),
        b = pointId(path[i]),
        id = key(a, b)
      if (a !== b && !connections.has(id)) {
        connections.add(id)
        edges.push([a, b])
      }
    }
  if (!edges.length)
    throw new Error('연결 가능한 경로를 찾지 못했습니다. 도면 색상을 확인해 주세요.')
  if (points.length > 15000)
    throw new Error('추출한 노드가 15,000개를 초과했습니다. 구역을 나누어 요청해 주세요.')
  // 세선화 교차점 주변의 인접 분기 픽셀만 합치는 국소 그래프 정리
  const degree = new Uint16Array(points.length)
  for (const [a, b] of edges) {
    degree[a]++
    degree[b]++
  }
  const parents = points.map((_, i) => i)
  /** 교차점 병합 집합의 대표 정점 조회 */
  const root = (id: number): number => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]]
      id = parents[id]
    }
    return id
  }
  for (const [a, b] of edges)
    if (
      (degree[a] > 2 || degree[b] > 2) &&
      Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y) <= 3
    )
      parents[root(b)] = root(a)
  const groups = new Map<number, number[]>()
  for (let i = 0; i < points.length; i++) {
    const id = root(i)
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id)!.push(i)
  }
  const output: DrawingGraph['points'] = [],
    references = new Map<number, number>()
  for (const ids of groups.values()) {
    const id = output.length
    output.push({
      x: Math.round(ids.reduce((sum, i) => sum + points[i].x, 0) / ids.length),
      y: Math.round(ids.reduce((sum, i) => sum + points[i].y, 0) / ids.length),
    })
    for (const source of ids) references.set(source, id)
  }
  const links: DrawingGraph['edges'] = [],
    connected = new Set<string>()
  for (const [a, b] of edges) {
    const from = references.get(a)!,
      to = references.get(b)!,
      id = key(from, to)
    if (from !== to && !connected.has(id)) {
      connected.add(id)
      links.push([from, to])
    }
  }
  const used = new Set(links.flat())
  const compact = new Map<number, number>()
  const compactPoints = output.filter((_, i) => {
    if (!used.has(i)) return false
    compact.set(i, compact.size)
    return true
  })
  return {
    points: compactPoints,
    edges: links.map(([a, b]) => [compact.get(a)!, compact.get(b)!]),
    components,
    maskPixels,
    color,
  }
}
scope.onmessage = (event) => {
  try {
    const { pixels, width, height, color } = event.data
    scope.postMessage({ result: trace(new Uint8ClampedArray(pixels), width, height, color) })
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
