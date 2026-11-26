/**
 * 파일명: enrichment.ts
 * 설명: 도면 객체의 포트 연결과 편집 모델 생성 및 경로 곡선과 간섭 검사
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
import {
  appendCurve,
  parseDocument,
  type DrawingObject,
  type MapDocument,
  type MapShape,
} from '@/entities/map/index.ts'
import {
  designRack,
  mapGeometryKey,
  validateFacilityDraft,
  type FacilityAsset,
  type FacilityDocument,
} from '@/entities/facility/index.ts'

/** 원본 이미지 경계 상자를 현재 지도 좌표로 변환하는 객체 치수 계산 */
export const drawingObjectBounds = (map: MapDocument, object: DrawingObject) => {
  const drawing = map.drawing,
    scale = drawing?.scaleMmPerPixel ?? drawing?.workingScale ?? 1
  const frame = drawing?.frame,
    angle = ((frame?.rotation ?? 0) * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle)
  const x = (object.x + object.width / 2) * scale,
    y = ((drawing?.height ?? 0) - object.y - object.height / 2) * scale
  return {
    x: (frame?.x ?? 0) + x * cos - y * sin,
    y: (frame?.y ?? 0) + x * sin + y * cos,
    width: object.width * scale,
    height: object.height * scale,
  }
}

/**
 * 지도 좌표의 객체 중심과 크기를 회전 이전의 원본 도면 픽셀 범위로 변환
 * @param drawing 도면 축척과 배치 프레임 및 원본 이미지 높이
 * @param bounds 지도 좌표의 중심과 크기
 * @returns 원본 이미지 좌상단 기준의 위치 및 크기
 */
export const drawingObjectPixelBox = (
  drawing: NonNullable<MapDocument['drawing']>,
  bounds: { x: number; y: number; width: number; height: number },
) => {
  const scale = drawing.scaleMmPerPixel ?? drawing.workingScale ?? 1
  const frame = drawing.frame
  const angle = (-(frame?.rotation ?? 0) * Math.PI) / 180
  const dx = bounds.x - (frame?.x ?? 0)
  const dy = bounds.y - (frame?.y ?? 0)
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle)
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle)
  return {
    x: (localX - bounds.width / 2) / scale,
    y: drawing.height - (localY + bounds.height / 2) / scale,
    width: bounds.width / scale,
    height: bounds.height / scale,
  }
}

/**
 * 지정 도면 객체의 속성을 갱신하고 수동 잠금을 적용한 뒤 연결 포트와 도형 재구성
 * 모든 대상과 변환을 검증된 문서에 한 번에 반영하기 위한 원본 보호
 * @param map 편집할 도면 지도
 * @param ids 변경할 도면 객체 식별자
 * @param getPatch 원본 픽셀과 선택 속성에서 변경값을 계산하는 함수
 * @returns 포트와 도형이 함께 갱신된 지도 문서
 * @throws 도면이나 지정한 객체가 없거나 최종 문서 검증에 실패한 경우
 */
export const patchDrawingObjects = (
  map: MapDocument,
  ids: string[],
  getPatch: (
    object: Readonly<DrawingObject>,
    drawing: NonNullable<MapDocument['drawing']>,
  ) => Partial<DrawingObject>,
) => {
  const drawing = map.drawing
  if (!drawing) throw new Error('도면 맵에서 객체를 적용하세요.')
  const objects = structuredClone(drawing.objects ?? [])
  const byId = new Map(objects.map((item) => [item.id, item]))
  for (const id of ids) {
    const object = byId.get(id)
    if (!object) throw new Error(`도면 객체 ${id}를 찾지 못했습니다.`)
    Object.assign(object, getPatch(object, drawing), { id, locked: true })
  }
  return applyDrawingObjects(map, objects)
}

/** 선분 위에 점을 투영하여 분할 위치와 거리를 구하는 최단점 계산 */
const projection = (
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
) => {
  const dx = b.x - a.x,
    dy = b.y - a.y
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
  )
  const x = a.x + dx * t,
    y = a.y + dy * t
  return { x, y, t, distance: Math.hypot(point.x - x, point.y - y) }
}

/**
 * 인식한 설비와 포트를 도형과 경로 연결 포트로 만드는 문서 보강
 * @param input 기준 지도
 * @param objects 원본 픽셀 좌표의 인식 객체
 * @returns 일반 편집과 저장을 지원하는 지도 문서
 */
export const applyDrawingObjects = (input: MapDocument, objects: DrawingObject[]): MapDocument => {
  const map = structuredClone(input)
  if (!map.drawing) throw new Error('도면 맵에서 객체를 적용하세요.')
  const previous = map.drawing.objects ?? []
  const oldIds = new Set(previous.map((item) => item.portId).filter((id): id is string => !!id))
  const nextIds = new Set(
    objects
      .filter((item) => item.status !== 'rejected')
      .map((item) => item.portId)
      .filter(Boolean),
  )
  map.ports = map.ports.filter((port) => !oldIds.has(port.id) || nextIds.has(port.id))
  const validPorts = new Set(map.ports.map((port) => port.id))
  for (const group of map.portGroups ?? [])
    group.portIds = group.portIds.filter((id) => validPorts.has(id))
  map.portGroups = map.portGroups?.filter((group) => group.portIds.length)
  map.shapes = (map.shapes ?? []).filter((shape) => !shape.description.startsWith('drawing:'))
  map.drawing.objects = structuredClone(objects)
  let shapeId = Math.max(0, ...map.shapes.map((shape) => shape.id))
  let nodeId = Math.max(0, ...map.nodes.map((node) => node.id))
  let uid = Math.max(0, ...map.nodes.map((node) => node.uid ?? node.id))
  const assignedPorts = new Set<string>()
  /** 설비와 연결되는 기존 직선 경로를 분할하는 포트 접속 노드 생성 */
  const attachNode = (point: { x: number; y: number }) => {
    const nodes = new Map(map.nodes.map((node) => [node.id, node]))
    const nearest = map.edges
      .filter((edge) => !edge.radius && (edge.drivingType ?? 1) === 1)
      .map((edge) => ({ edge, ...projection(point, nodes.get(edge.from)!, nodes.get(edge.to)!) }))
      .sort((a, b) => a.distance - b.distance)[0]
    if (!nearest)
      return map.nodes.reduce((best, node) =>
        Math.hypot(node.x - point.x, node.y - point.y) <
        Math.hypot(best.x - point.x, best.y - point.y)
          ? node
          : best,
      ).id
    const a = nodes.get(nearest.edge.from)!,
      b = nodes.get(nearest.edge.to)!
    const tolerance = map.units === 'mm' ? 10 : 1
    if (Math.hypot(a.x - nearest.x, a.y - nearest.y) < tolerance) return a.id
    if (Math.hypot(b.x - nearest.x, b.y - nearest.y) < tolerance) return b.id
    const node = {
      id: ++nodeId,
      uid: ++uid,
      realId: nodeId,
      name: `N${nodeId}`,
      x: Math.round(nearest.x),
      y: Math.round(nearest.y),
      direction: nearest.edge.direction ?? 1,
    }
    map.nodes.push(node)
    const edge = nearest.edge
    map.edges = map.edges.filter((item) => item !== edge)
    map.edges.push(
      {
        ...edge,
        id: `${edge.id}-P${nodeId}a`,
        to: node.id,
        distance: Math.round(Math.hypot(a.x - node.x, a.y - node.y)),
      },
      {
        ...edge,
        id: `${edge.id}-P${nodeId}b`,
        from: node.id,
        distance: Math.round(Math.hypot(b.x - node.x, b.y - node.y)),
      },
    )
    return node.id
  }
  for (const object of map.drawing.objects
    .filter((item) => item.status !== 'rejected')
    .sort((a, b) => Number(b.kind === 'port') - Number(a.kind === 'port'))) {
    const bounds = drawingObjectBounds(map, object)
    const label = object.label || `${object.kind} ${object.id}`
    if (object.kind !== 'port') {
      const color =
        object.kind === 'obstacle' ? 0x5050dc : object.status === 'review' ? 0x0099ff : 0xb48c65
      const shape: MapShape = {
        id: ++shapeId,
        description: `drawing:${object.id}`,
        text: label,
        x1: Math.round(bounds.x - bounds.width / 2),
        y1: Math.round(bounds.y - bounds.height / 2),
        x2: Math.round(bounds.x + bounds.width / 2),
        y2: Math.round(bounds.y + bounds.height / 2),
        centerX: Math.round(bounds.x),
        centerY: Math.round(bounds.y),
        radius: 0,
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        type: object.kind === 'text' ? 6 : 2,
        strokeColor: color,
        strokeStyle: object.status === 'review' ? 1 : 0,
        strokeWidth: map.units === 'mm' ? 15 : 1,
        fillColor: color,
        fontColor: color,
        fontAlign: 0,
        fontDirection: 0,
        fillStyle: 0,
      }
      if (object.kind === 'text') {
        const vertical =
          Math.abs(object.rotation % 180) > 45 && Math.abs(object.rotation % 180) < 135
        const lineWidth = Math.max(
          1,
          ...label
            .split('\n')
            .map((line) =>
              [...line].reduce(
                (sum, character) => sum + (character.charCodeAt(0) > 0x2e80 ? 1 : 0.6),
                0,
              ),
            ),
        )
        const availableWidth = vertical ? bounds.height : bounds.width
        const availableHeight = vertical ? bounds.width : bounds.height
        shape.height = Math.max(
          0.1,
          Math.min(availableHeight / label.split('\n').length, availableWidth / lineWidth) * 0.08,
        )
        shape.y1 = Math.round(bounds.y + ((vertical ? -1 : 1) * bounds.height) / 2)
        shape.fontDirection = vertical ? 2 : 0
      }
      map.shapes.push(shape)
    }
    if (object.kind === 'text' || object.kind === 'obstacle') continue
    if (map.ports.length >= 5000) throw new Error('도면 포트가 최대 5,000개를 초과합니다.')
    let portId = object.portId
    if (!portId && object.kind !== 'port') {
      const nearby = map.drawing.objects
        .filter(
          (item) =>
            item.kind === 'port' &&
            item.status !== 'rejected' &&
            item.portId &&
            !assignedPorts.has(item.portId),
        )
        .map((item) => ({ item, point: drawingObjectBounds(map, item) }))
        .sort(
          (a, b) =>
            Math.hypot(a.point.x - bounds.x, a.point.y - bounds.y) -
            Math.hypot(b.point.x - bounds.x, b.point.y - bounds.y),
        )[0]
      if (
        nearby &&
        Math.hypot(nearby.point.x - bounds.x, nearby.point.y - bounds.y) <=
          Math.max(bounds.width, bounds.height) * 1.25
      ) {
        portId = nearby.item.portId
        object.portId = portId
      }
    }
    if (!portId) {
      const desired =
        object.kind === 'port' && object.label
          ? object.label.replace(/\s+/g, '-').slice(0, 100)
          : `EQ-${object.id}`
      portId = desired
      let suffix = 1
      while (map.ports.some((port) => port.id === portId)) portId = `${desired}-${suffix++}`
      object.portId = portId
    }
    const existing = map.ports.find((port) => port.id === portId)
    const routeNode = existing?.nodeId ?? attachNode(bounds)
    if (object.kind !== 'port') assignedPorts.add(portId)
    const port = {
      id: portId,
      nodeId: routeNode,
      name: label,
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    }
    if (existing) {
      if (
        object.kind === 'port' ||
        !map.drawing.objects.some((item) => item.kind === 'port' && item.portId === portId)
      )
        Object.assign(existing, port)
    } else map.ports.push(port)
  }
  return parseDocument(JSON.stringify(map))
}

/**
 * 직선 두 개가 만나는 모서리에 접선 원호를 삽입하는 자동 곡선 생성
 * @param input 편집 지도
 * @param radiusMm 요청 반경과 자동 반경 표시
 * @returns 곡선 반경과 가상 노드를 포함하는 지도
 */
export const roundDrawingPaths = (input: MapDocument, radiusMm = 0) => {
  const map = structuredClone(input)
  if (!map.drawing) throw new Error('도면 맵에서 곡선을 생성하세요.')
  const factor = map.drawing.scaleMmPerPixel ?? map.drawing.workingScale ?? 1
  for (const fillet of map.drawing.fillets ?? []) {
    const corner = map.nodes.find((node) => node.id === fillet.corner)
    if (!corner) continue
    const ids = new Set(fillet.nodes)
    if (map.ports.some((port) => ids.has(port.nodeId)))
      throw new Error(
        `곡선 N${fillet.corner}의 분할 노드에 포트가 연결되어 있습니다. 포트 연결을 옮긴 후 반경을 변경하세요.`,
      )
    if (
      map.edges.some(
        (edge) =>
          (ids.has(edge.from) || ids.has(edge.to)) &&
          edge.realConnection !== fillet.corner &&
          edge.from !== fillet.end &&
          edge.to !== fillet.end,
      )
    )
      throw new Error(
        `곡선 N${fillet.corner}에 수동 분기가 있습니다. 수동 연결을 정리한 후 반경을 변경하세요.`,
      )
    map.edges = map.edges.filter(
      (edge) => edge.realConnection !== fillet.corner || ![2, 3].includes(edge.drivingType ?? 1),
    )
    for (const edge of map.edges) {
      if (edge.from === fillet.end) edge.from = corner.id
      if (edge.to === fillet.end) edge.to = corner.id
    }
    map.nodes = map.nodes.filter((node) => !ids.has(node.id))
    corner.x = Math.round(fillet.x * factor)
    corner.y = Math.round(fillet.y * factor)
    delete corner.curveStart
  }
  map.drawing.fillets = []
  const protectedIds = new Set(map.ports.map((port) => port.nodeId))
  const candidates = map.nodes
    .filter((node) => !node.curve && !node.curveStart && !protectedIds.has(node.id))
    .map((node) => node.id)
  let rounded = 0
  for (const id of candidates) {
    const b = map.nodes.find((node) => node.id === id)!
    const edges = map.edges.filter((edge) => edge.from === id || edge.to === id)
    if (edges.length !== 2 || edges.some((edge) => edge.radius || edge.direction === 0)) continue
    const a = map.nodes.find(
      (node) => node.id === (edges[0].from === id ? edges[0].to : edges[0].from),
    )!
    const c = map.nodes.find(
      (node) => node.id === (edges[1].from === id ? edges[1].to : edges[1].from),
    )!
    const la = Math.hypot(a.x - b.x, a.y - b.y),
      lc = Math.hypot(c.x - b.x, c.y - b.y)
    const u = { x: (a.x - b.x) / la, y: (a.y - b.y) / la },
      v = { x: (c.x - b.x) / lc, y: (c.y - b.y) / lc }
    const angle = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y)))
    if (!Number.isFinite(angle) || angle < Math.PI / 6 || angle > Math.PI * 0.94) continue
    const desired =
      map.units === 'mm'
        ? radiusMm || 1000
        : map.drawing.width * (map.drawing.workingScale ?? 1) * 0.003
    const radius = Math.floor(Math.min(desired, Math.min(la, lc) * 0.35 * Math.tan(angle / 2)))
    if (radius < (map.units === 'mm' ? 20 : 2)) continue
    const tangent = radius / Math.tan(angle / 2)
    const px = Math.round(b.x + u.x * tangent),
      py = Math.round(b.y + u.y * tangent)
    const qx = Math.round(b.x + v.x * tangent),
      qy = Math.round(b.y + v.y * tangent)
    const bisector = Math.hypot(u.x + v.x, u.y + v.y)
    const center = {
      x: b.x + (((u.x + v.x) / bisector) * radius) / Math.sin(angle / 2),
      y: b.y + (((u.y + v.y) / bisector) * radius) / Math.sin(angle / 2),
    }
    const start = Math.atan2(py - center.y, px - center.x)
    let sweep = Math.atan2(qy - center.y, qx - center.x) - start
    if (sweep > Math.PI) sweep -= 2 * Math.PI
    if (sweep < -Math.PI) sweep += 2 * Math.PI
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 12)))
    const points = Array.from({ length: steps + 1 }, (_, i) => ({
      x: Math.round(center.x + radius * Math.cos(start + (sweep * i) / steps)),
      y: Math.round(center.y + radius * Math.sin(start + (sweep * i) / steps)),
    }))
    points[0] = { x: px, y: py }
    points[steps] = { x: qx, y: qy }
    if (
      points.some((point, i) => i > 0 && point.x === points[i - 1].x && point.y === points[i - 1].y)
    )
      continue
    const nextId = Math.max(0, ...map.nodes.map((node) => node.id)) + 1
    const sourceCorner = { x: b.x / factor, y: b.y / factor }
    const maxUid = Math.max(0, ...map.nodes.map((node) => node.uid ?? node.id))
    b.x = px
    b.y = py
    map.nodes.push({
      id: nextId,
      uid: maxUid + 1,
      realId:
        Math.max(
          0,
          ...map.nodes.filter((node) => !node.virtual).map((node) => node.realId ?? node.id),
        ) + 1,
      name: `N${nextId}`,
      x: qx,
      y: qy,
      direction: 1,
    })
    const edge = edges[1]
    if (edge.from === id) edge.from = nextId
    else edge.to = nextId
    appendCurve(
      map,
      id,
      {
        points,
        radius,
        angle: Math.round((Math.abs(sweep) * 180) / Math.PI),
        goalDegree: Math.round(
          ((Math.atan2(center.y - py, center.x - px) * 180) / Math.PI + 360) % 360,
        ),
        drivingType: sweep >= 0 ? 2 : 3,
      },
      1,
      maxUid + 1,
      nextId,
    )
    for (const node of map.nodes.filter((node) => node.id >= nextId))
      node.drawingKey = `auto:${b.drawingKey ?? b.id}:${node.id}`
    map.drawing.fillets.push({
      corner: b.id,
      end: nextId,
      nodes: map.nodes.filter((node) => node.id >= nextId).map((node) => node.id),
      ...sourceCorner,
    })
    rounded++
  }
  const nodes = new Map(map.nodes.map((node) => [node.id, node]))
  for (const edge of map.edges)
    edge.distance = Math.round(
      Math.hypot(
        nodes.get(edge.from)!.x - nodes.get(edge.to)!.x,
        nodes.get(edge.from)!.y - nodes.get(edge.to)!.y,
      ),
    )
  map.drawing.curveRadiusMm = radiusMm
  return { map: parseDocument(JSON.stringify(map)), rounded }
}

/**
 * 외부 모델 참조를 보존하며 인식 설비의 부품과 포트 기준 배치를 갱신하는 삼차원 동기화
 * @param map 축척 보정한 도면 지도
 * @param previous 기존 수동 설계를 보존할 설비 문서
 * @returns 도면 설비만 갱신한 밀리미터 설계 문서
 */
export const drawingFacility = (
  map: MapDocument,
  previous: FacilityDocument,
  prior?: MapDocument,
): FacilityDocument => {
  const scene = structuredClone(previous)
  const prefix = `drawing-${map.drawing?.id}-`
  const oldAssets = new Map(scene.assets.map((asset) => [asset.id, asset]))
  const manualAssetIds = new Set(
    scene.instances.filter((item) => !item.id.startsWith(prefix)).map((item) => item.assetId),
  )
  scene.instances = scene.instances.filter((item) => !item.id.startsWith(prefix))
  scene.assets = scene.assets.filter(
    (item) => !item.id.startsWith(prefix) || manualAssetIds.has(item.id),
  )
  if (map.units !== 'mm' || !map.drawing) return validateFacilityDraft(scene)
  for (const object of map.drawing.objects ?? []) {
    if (
      object.status === 'rejected' ||
      !['rack', 'shelf', 'conveyor', 'equipment'].includes(object.kind) ||
      !object.portId
    )
      continue
    const port = map.ports.find((item) => item.id === object.portId)
    if (!port) continue
    const bounds = drawingObjectBounds(map, object),
      id = `${prefix}${object.id}`
    const width = Math.max(50, Math.round(bounds.width)),
      depth = Math.max(50, Math.round(bounds.height))
    const height = object.heightMm ?? (object.kind === 'conveyor' ? 700 : 1800)
    const name = object.label || `${object.kind} ${object.id}`
    let asset: FacilityAsset
    if (object.kind === 'rack' || object.kind === 'shelf')
      asset = designRack(id, name, object.kind, {
        width,
        depth,
        height,
        bays: 1,
        levels: 3,
        frame: Math.max(3, Math.min(45, Math.floor(Math.min(width, depth, height / 3) / 5))),
        color: '#7c92b0',
      })
    else {
      const conveyor = object.kind === 'conveyor'
      asset = {
        id,
        name,
        kind: conveyor ? 'conveyor' : 'equipment',
        parts: [
          {
            id: 'body',
            name: conveyor ? '운반면' : '설비 외형',
            shape: 'box',
            position: { x: 0, y: 0, z: conveyor ? height - 50 : height / 2 },
            size: { x: width, y: depth, z: conveyor ? Math.min(100, height) : height },
            rotation: 0,
            color: conveyor ? '#698390' : '#8c9db0',
          },
        ],
      }
      if (conveyor)
        for (const x of [-1, 1])
          for (const y of [-1, 1])
            asset.parts.push({
              id: `leg-${x}-${y}`,
              name: '지지대',
              shape: 'box',
              position: { x: x * width * 0.4, y: y * depth * 0.4, z: (height - 100) / 2 },
              size: {
                x: Math.min(50, width / 8),
                y: Math.min(50, depth / 8),
                z: Math.max(10, height - 100),
              },
              rotation: 0,
              color: '#536779',
            })
    }
    const oldAsset = oldAssets.get(id)
    const oldObject = prior?.drawing?.objects?.find((item) => item.id === object.id)
    if (oldAsset && oldObject?.kind === object.kind) {
      asset = structuredClone(oldAsset)
      const oldBounds = drawingObjectBounds(prior!, oldObject)
      const sx = bounds.width / oldBounds.width,
        sy = bounds.height / oldBounds.height
      const minZ = Math.min(...asset.parts.map((part) => part.position.z - part.size.z / 2))
      const maxZ = Math.max(...asset.parts.map((part) => part.position.z + part.size.z / 2))
      const sz =
        object.heightMm !== oldObject.heightMm && object.heightMm
          ? object.heightMm / Math.max(1, maxZ - Math.min(0, minZ))
          : 1
      for (const part of asset.parts) {
        part.position.x *= sx
        part.position.y *= sy
        part.position.z *= sz
        part.size.x *= sx
        part.size.y *= sy
        part.size.z *= sz
      }
      if (asset.glb) {
        asset.glb.size.x *= sx
        asset.glb.size.y *= sy
        asset.glb.size.z *= sz
      }
      if (asset.design) {
        asset.design.width *= sx
        asset.design.depth *= sy
        asset.design.height *= sz
      }
      asset.name = name
    } else if (oldAsset && !prior) asset = oldAsset
    if (!scene.assets.some((item) => item.id === id)) scene.assets.push(asset)
    scene.instances.push({
      id,
      assetId: id,
      name,
      position: { x: bounds.x, y: bounds.y, z: 0 },
      rotation: object.rotation + (map.drawing.frame?.rotation ?? 0),
      portId: port.id,
      portOffset: { x: bounds.x - port.x, y: bounds.y - port.y, z: 0 },
    })
  }
  scene.mapRef = { name: map.name, geometryKey: mapGeometryKey(map.nodes) }
  return validateFacilityDraft(scene)
}

export interface DrawingFinding {
  kind: 'scale' | 'confidence' | 'width' | 'collision' | 'connection' | 'radius'
  target: string
  message: string
}
/**
 * 추출 마스크와 차량 외곽 및 인식 장애물을 대조하는 도면 지도 검사
 * @param map 검사할 지도
 * @param drawing 경로 색상 대조에 사용할 분석 영상
 * @param vehicleWidthMm 차량 폭
 * @param clearanceMm 한쪽 여유 거리
 * @returns 안전 판정 대신 수정 대상을 제공하는 구체적인 검토 항목
 */
export const validateDrawingMap = (
  map: MapDocument,
  drawing?: import('@/features/drawing-import/model/types.ts').DrawingAttachment,
  vehicleWidthMm = 900,
  clearanceMm = 150,
): DrawingFinding[] => {
  const findings: DrawingFinding[] = []
  if (!map.drawing) return findings
  if (map.units !== 'mm')
    findings.push({ kind: 'scale', target: '도면', message: '실제 거리 기준 축척 보정 필요' })
  const objects = map.drawing.objects ?? []
  for (const object of objects) {
    if (object.status === 'review')
      findings.push({
        kind: 'confidence',
        target: object.id,
        message: `${object.label || object.kind} 인식 신뢰도 ${Math.round(object.confidence * 100)}% 확인 필요`,
      })
    if (
      !object.heightMm &&
      ['rack', 'shelf', 'equipment', 'conveyor'].includes(object.kind) &&
      object.status !== 'rejected'
    )
      findings.push({
        kind: 'confidence',
        target: object.id,
        message: '설비 높이 임시값 확인 필요',
      })
  }
  const nodes = new Map(map.nodes.map((node) => [node.id, node]))
  const adjacency = new Map(map.nodes.map((node) => [node.id, [] as number[]]))
  for (const edge of map.edges) {
    adjacency.get(edge.from)?.push(edge.to)
    adjacency.get(edge.to)?.push(edge.from)
  }
  const seen = new Set<number>(),
    components: number[][] = []
  for (const node of map.nodes) {
    if (seen.has(node.id)) continue
    const queue = [node.id]
    seen.add(node.id)
    for (let i = 0; i < queue.length; i++)
      for (const next of adjacency.get(queue[i]) ?? [])
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
    components.push(queue)
  }
  for (const component of components.slice(1))
    findings.push({
      kind: 'connection',
      target: `N${component[0]}`,
      message: `분리된 경로 구역 · 노드 ${component.length}개`,
    })
  const padding = map.units === 'mm' ? vehicleWidthMm / 2 + clearanceMm : 0
  const obstacles = objects
    .filter(
      (object) =>
        object.status !== 'rejected' &&
        ['rack', 'shelf', 'equipment', 'conveyor', 'obstacle'].includes(object.kind),
    )
    .map((object) => ({ object, ...drawingObjectBounds(map, object) }))
  const factor = map.drawing.scaleMmPerPixel ?? map.drawing.workingScale ?? 1
  const colored =
    drawing && ['green', 'magenta', 'cyan', 'blue', 'red'].includes(map.drawing.routeColor)
  /** 경로 픽셀과 색상 마스크를 대조하는 차량 폭 표본 검사 */
  const inside = (x: number, y: number) => {
    if (!drawing) return true
    if (map.drawing?.frame) {
      const frame = map.drawing.frame,
        angle = (-frame.rotation * Math.PI) / 180,
        dx = x - frame.x,
        dy = y - frame.y
      x = dx * Math.cos(angle) - dy * Math.sin(angle)
      y = dx * Math.sin(angle) + dy * Math.cos(angle)
    }
    const px = Math.round((x / factor / map.drawing!.width) * drawing.analysisWidth),
      py = Math.round(
        ((map.drawing!.height - y / factor) / map.drawing!.height) * drawing.analysisHeight,
      )
    if (px < 0 || py < 0 || px >= drawing.analysisWidth || py >= drawing.analysisHeight)
      return false
    const i = (py * drawing.analysisWidth + px) * 4,
      r = drawing.pixels[i],
      g = drawing.pixels[i + 1],
      b = drawing.pixels[i + 2]
    const color = map.drawing!.routeColor
    return color === 'green'
      ? g > 100 && g > r * 1.45 && g > b * 1.45
      : color === 'magenta'
        ? r > 120 && b > 120 && g < Math.min(r, b) * 0.65
        : color === 'cyan'
          ? g > 120 && b > 120 && r < Math.min(g, b) * 0.65
          : color === 'blue'
            ? b > 100 && b > r * 1.45 && b > g * 1.45
            : r > 100 && r > g * 1.45 && r > b * 1.45
  }
  for (const edge of map.edges) {
    const a = nodes.get(edge.from)!,
      b = nodes.get(edge.to)!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) continue
    let collision = false
    for (const obstacle of obstacles) {
      const angle =
        (-(obstacle.object.rotation + (map.drawing?.frame?.rotation ?? 0)) * Math.PI) / 180
      const cos = Math.cos(angle),
        sin = Math.sin(angle)
      const ax = (a.x - obstacle.x) * cos - (a.y - obstacle.y) * sin
      const ay = (a.x - obstacle.x) * sin + (a.y - obstacle.y) * cos
      const bx = (b.x - obstacle.x) * cos - (b.y - obstacle.y) * sin
      const by = (b.x - obstacle.x) * sin + (b.y - obstacle.y) * cos
      let enter = 0,
        leave = 1
      collision = true
      for (const [start, delta, half] of [
        [ax, bx - ax, obstacle.width / 2 + padding],
        [ay, by - ay, obstacle.height / 2 + padding],
      ]) {
        if (Math.abs(delta) < 1e-9) {
          if (Math.abs(start) > half) collision = false
          continue
        }
        const t1 = (-half - start) / delta,
          t2 = (half - start) / delta
        enter = Math.max(enter, Math.min(t1, t2))
        leave = Math.min(leave, Math.max(t1, t2))
        if (enter > leave) collision = false
      }
      if (collision) {
        findings.push({
          kind: 'collision',
          target: edge.id,
          message: `${obstacle.object.id} ${obstacle.object.label || obstacle.object.kind} 외형과 차량 여유 영역 중첩`,
        })
        break
      }
    }
    if (colored && padding) {
      const nx = (-(b.y - a.y) / length) * padding,
        ny = ((b.x - a.x) / length) * padding
      if (
        [0.2, 0.5, 0.8].some(
          (t) =>
            !inside(a.x + (b.x - a.x) * t + nx, a.y + (b.y - a.y) * t + ny) ||
            !inside(a.x + (b.x - a.x) * t - nx, a.y + (b.y - a.y) * t - ny),
        )
      )
        findings.push({
          kind: 'width',
          target: edge.id,
          message: `차량 폭 ${vehicleWidthMm}mm와 양쪽 여유 ${clearanceMm}mm의 색상 통로 이탈`,
        })
    }
    if (edge.radius && map.units === 'mm' && edge.radius < padding)
      findings.push({
        kind: 'radius',
        target: edge.id,
        message: `곡선 반경 ${edge.radius}mm와 차량 회전 조건 확인 필요`,
      })
  }
  return findings
}
