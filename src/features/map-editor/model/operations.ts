/**
 * 파일명: operations.ts
 * 설명: 원본 연결과 포트 참조를 유지하는 경로 분할과 식별자 재정렬 및 좌표 변환
 * 작성자: 이희원
 * 작성일자: 2026-11-17
 */
import { parseDocument, MAX_NODES, type MapDocument } from '@/entities/map/index.ts'
/** 원본 UID와 실제 연결을 유지하며 불연속 로컬 식별자를 연속 번호로 바꾸는 재정렬 */
export const renumberMap = (input: MapDocument) => {
  const map = structuredClone(input),
    refs = new Map([...map.nodes].sort((a, b) => a.id - b.id).map((node, i) => [node.id, i + 1]))
  const id = (value: number) => refs.get(value) ?? value
  for (const node of map.nodes) {
    node.id = id(node.id)
    node.name = `N${node.id}`
  }
  for (const edge of map.edges) {
    edge.from = id(edge.from)
    edge.to = id(edge.to)
    if (edge.realConnection !== undefined && edge.realConnection >= 0)
      edge.realConnection = id(edge.realConnection)
  }
  for (const port of map.ports) port.nodeId = id(port.nodeId)
  for (const group of map.portGroups ?? [])
    if (group.nodeId !== undefined) group.nodeId = id(group.nodeId)
  for (const fillet of map.drawing?.fillets ?? []) {
    fillet.corner = id(fillet.corner)
    fillet.end = id(fillet.end)
    fillet.nodes = fillet.nodes.map(id)
  }
  return {
    map: parseDocument(JSON.stringify(map)),
    references: [...refs].map(([before, after]) => ({ before, after })),
  }
}
/** 끝점과 포트 접속점을 보존하며 실제 길이를 기준으로 직선 경로를 세분화하는 노드 간격 적용 */
export const subdividePaths = (input: MapDocument, spacing: number, nodeIds?: number[]) => {
  if (input.units !== 'mm')
    throw new Error(
      '1000mm 같은 실제 간격에는 도면 축척이 필요합니다. 알려진 실제 길이를 먼저 확인하세요.',
    )
  if (!Number.isSafeInteger(spacing) || spacing < 1 || spacing > 1e8)
    throw new Error('노드 간격은 양의 정수 mm로 지정하세요.')
  const map = structuredClone(input),
    selected = nodeIds ? new Set(nodeIds) : null,
    nodes = new Map(map.nodes.map((node) => [node.id, node])),
    edges: MapDocument['edges'] = []
  let nextId = Math.max(0, ...map.nodes.map((node) => node.id)),
    uid = Math.max(0, ...map.nodes.map((node) => node.uid ?? node.id)),
    realId = Math.max(
      0,
      ...map.nodes.filter((node) => !node.virtual).map((node) => node.realId ?? node.id),
    )
  let added = 0,
    changed = 0
  const created = new Map<string, { id: number; x: number; y: number }[]>()
  for (const edge of map.edges) {
    const a = nodes.get(edge.from)!,
      b = nodes.get(edge.to)!,
      length = Math.hypot(b.x - a.x, b.y - a.y)
    if ((selected && (!selected.has(a.id) || !selected.has(b.id))) || length <= spacing) {
      edges.push(edge)
      continue
    }
    if ([2, 3].includes(edge.drivingType ?? 1) || a.curve || b.curve) {
      edges.push(edge)
      continue
    }
    const key = [a.id, b.id].sort((x, y) => x - y).join('-')
    let middle = created.get(key)
    if (!middle) {
      middle = []
      const first = a.id < b.id ? a : b,
        last = a.id < b.id ? b : a
      const count = Math.ceil(length / spacing) - 1
      if (map.nodes.length + count > MAX_NODES)
        throw new Error('분할 후 노드가 15,000개를 초과합니다. 간격이나 범위를 조정하세요.')
      for (let distance = spacing; distance < length - 0.5; distance += spacing) {
        const t = distance / length
        const node = {
          id: ++nextId,
          name: `N${nextId}`,
          x: Math.round(first.x + (last.x - first.x) * t),
          y: Math.round(first.y + (last.y - first.y) * t),
          uid: ++uid,
          realId: ++realId,
          direction: edge.direction ?? 1,
        }
        if ((node.x === first.x && node.y === first.y) || (node.x === last.x && node.y === last.y))
          continue
        map.nodes.push(node)
        middle.push(node)
        added++
      }
      created.set(key, middle)
    }
    const chain = [a, ...(a.id < b.id ? middle : [...middle].reverse()), b]
    for (let i = 1; i < chain.length; i++) {
      const from = chain[i - 1],
        to = chain[i]
      edges.push({
        ...edge,
        id: `${edge.id}-S${i}`,
        from: from.id,
        to: to.id,
        realConnection: to.id,
        distance: Math.round(Math.hypot(to.x - from.x, to.y - from.y)),
      })
    }
    changed++
  }
  map.edges = edges
  return {
    map: parseDocument(JSON.stringify(map)),
    added,
    changed,
    spacing,
    curvesPreserved: map.edges.filter((edge) => [2, 3].includes(edge.drivingType ?? 1)).length,
  }
}
/** 선택 경로의 유향 최단 거리와 실제 노드 순서를 계산하는 경로 탐색 */
export const shortestMapPath = (map: MapDocument, start: number, end: number) => {
  const nodes = new Map(map.nodes.map((node) => [node.id, node]))
  if (!nodes.has(start) || !nodes.has(end)) throw new Error('출발과 도착 노드를 확인하세요.')
  const adjacency = new Map<number, { to: number; distance: number }[]>()
  for (const node of map.nodes) adjacency.set(node.id, [])
  for (const edge of map.edges) {
    const a = nodes.get(edge.from)!,
      b = nodes.get(edge.to)!,
      distance =
        edge.distance !== undefined && edge.distance >= 0
          ? edge.distance
          : Math.hypot(b.x - a.x, b.y - a.y)
    adjacency.get(a.id)!.push({ to: b.id, distance })
    if ((edge.direction ?? 1) === 1) adjacency.get(b.id)!.push({ to: a.id, distance })
  }
  const distances = new Map<number, number>([[start, 0]]),
    previous = new Map<number, number>(),
    visited = new Set<number>()
  while (true) {
    let current: number | undefined,
      best = Infinity
    for (const [id, distance] of distances)
      if (!visited.has(id) && distance < best) {
        best = distance
        current = id
      }
    if (current === undefined) throw new Error('지정한 방향으로 도달할 수 있는 경로가 없습니다.')
    if (current === end) break
    visited.add(current)
    for (const next of adjacency.get(current)!) {
      const distance = best + next.distance
      if (distance < (distances.get(next.to) ?? Infinity)) {
        distances.set(next.to, distance)
        previous.set(next.to, current)
      }
    }
  }
  const path = [end]
  while (path[0] !== start) path.unshift(previous.get(path[0])!)
  return { nodes: path, distance: distances.get(end)!, units: map.units }
}
