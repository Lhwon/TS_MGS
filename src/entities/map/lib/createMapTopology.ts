/**
 * 파일명: createMapTopology.ts
 * 설명: 평면과 삼차원 화면에서 재사용하는 지도 도형과 선택 식별 정보 생성
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import * as THREE from 'three'
import { createMapShapes } from '@/entities/map/lib/createMapShapes.ts'
import { portNameAnchor } from '@/entities/map/lib/createMapLabels.ts'
import type { MapDocument } from '@/entities/map/model/map.ts'
import { legacyColor, mgsTheme, displayMapPorts } from '@/entities/map/model/view.ts'
// TS_UI의 원본 좌표 반경과 동일한 노드 치수
export const MAP_NODE_RADIUS_MM = 25
// 원형 실제 노드와 곡선 보간점을 구분하는 표시 반경
const MAP_CURVE_NODE_RADIUS_MM = 17.5
const MGS_NODE_RADIUS_MM = 50
const MGS_VIRTUAL_NODE_RADIUS_MM = 30

/** 원본 편집 화면에서 노드 종류와 방향에 맞는 채움 색상 */
const mgsNodeFill = (node: MapDocument['nodes'][number], theme: ReturnType<typeof mgsTheme>) =>
  node.virtual || node.curve
    ? theme.virtual
    : node.noSendGoal
      ? 0x000000
      : node.direction === 1
        ? theme.bothWays
        : node.direction === undefined || node.direction === 0
          ? theme.oneWay
          : 0xff0000

// 평면 편집기와 삼차원 바닥에서 같은 좌표와 형상을 재사용하는 지도 도형 생성
/**
 * 평면과 삼차원 화면에서 공유하는 노드 및 경로와 포트 도형 생성
 * 지도 원본 좌표와 색상을 유지하며 포트 선택에 필요한 식별 정보를 연결하는 토폴로지 구성
 *
 * @param document 기준 노드와 경로 및 포트를 포함하는 지도 문서
 * @param theme 원본 지도 색상과 크기 및 선 두께 설정
 * @param mgs2d 원본 편집 화면의 노드와 방향 표식 규칙 적용 여부
 * @returns 도형 그룹과 노드 및 포트 인스턴스 참조
 */
export const createMapTopology = (document: MapDocument, theme = mgsTheme(), mgs2d = false) => {
  // 큰 현장 좌표를 GPU 정점에 직접 기록할 때 발생하는 떨림과 모서리 손실을 막는 지역 좌표 변환
  const origin = document.nodes[0] ??
    document.ports[0] ?? {
      x: document.shapes?.[0]?.x1 ?? 0,
      y: document.shapes?.[0]?.y1 ?? 0,
    }
  const map: MapDocument = {
    ...document,
    nodes: document.nodes.map((node) => ({ ...node, x: node.x - origin.x, y: node.y - origin.y })),
    ports: document.ports.map((port) => ({ ...port, x: port.x - origin.x, y: port.y - origin.y })),
    portGroups: document.portGroups?.map((item) => ({
      ...item,
      x: item.x - origin.x,
      y: item.y - origin.y,
    })),
    shapes: document.shapes?.map((shape) => ({
      ...shape,
      x1: shape.x1 - origin.x,
      y1: shape.y1 - origin.y,
      x2: shape.x2 - origin.x,
      y2: shape.y2 - origin.y,
      centerX: shape.centerX - origin.x,
      centerY: shape.centerY - origin.y,
    })),
  }
  const group = new THREE.Group()
  group.add(createMapShapes(map, theme))
  const matrix = new THREE.Matrix4()
  let nodeMesh: THREE.InstancedMesh
  let portMesh: THREE.Mesh
  const baseRadius = mgs2d ? MGS_NODE_RADIUS_MM : MAP_NODE_RADIUS_MM
  const strokeWidth = mgs2d ? 10 : 5
  const borders = new THREE.InstancedMesh(
    new THREE.CircleGeometry(baseRadius, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    Math.max(map.nodes.length, 1),
  )
  borders.count = map.nodes.length
  borders.name = 'node-borders'
  const byId = new Map(map.nodes.map((node) => [node.id, node]))
  const positions: number[] = []
  const colors: number[] = []
  const arrowPositions: number[] = []
  const arrowColors: number[] = []
  /**
   * 경로 선분의 양 끝점과 정점별 색상을 버퍼에 추가하는 선분 누적
   *
   * @param x1 선분 시작점의 가로 좌표
   * @param y1 선분 시작점의 세로 좌표
   * @param x2 선분 끝점의 가로 좌표
   * @param y2 선분 끝점의 세로 좌표
   * @param color 렌더링에 사용할 부품 또는 정점 색상
   */
  const addSegment = (x1: number, y1: number, x2: number, y2: number, color: THREE.Color) => {
    const length = Math.hypot(x2 - x1, y2 - y1)
    if (!length) return
    const dx = ((-(y2 - y1) / length) * theme.pathWidth) / 2
    const dy = (((x2 - x1) / length) * theme.pathWidth) / 2
    positions.push(
      x1 + dx,
      y1 + dy,
      0,
      x1 - dx,
      y1 - dy,
      0,
      x2 + dx,
      y2 + dy,
      0,
      x2 + dx,
      y2 + dy,
      0,
      x1 - dx,
      y1 - dy,
      0,
      x2 - dx,
      y2 - dy,
      0,
    )
    for (let i = 0; i < 6; i++) colors.push(color.r, color.g, color.b)
  }
  const vehiclePositions: number[] = []
  const vehicleColors: number[] = []
  /** 정점 중심과 진행 각도로 방향을 나타내는 삼각형 추가 */
  const directionMarker = (
    vertices: number[],
    colors: number[],
    x: number,
    y: number,
    angle: number,
    size: number,
    color: THREE.Color,
  ) => {
    const cos = Math.cos(angle),
      sin = Math.sin(angle)
    for (const [forward, side] of [
      [2 * size, 0],
      [-size, -size],
      [-size, size],
    ]) {
      vertices.push(x + cos * forward - sin * side, y + sin * forward + cos * side, 2)
      colors.push(color.r, color.g, color.b)
    }
  }
  for (const edge of map.edges) {
    const a = byId.get(edge.from),
      b = byId.get(edge.to)
    if (!a || !b) continue
    const both = edge.direction === 1
    const color = new THREE.Color(both ? theme.bothWays : theme.oneWay)
    addSegment(a.x, a.y, b.x, b.y, color)
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy)
    if (!length) continue
    const angle = Math.atan2(dy, dx)
    const size = Math.min(length * 0.14, theme.arrowSize / 3)
    if (mgs2d && theme.arrowSize > 0 && !a.curve) {
      const side = theme.arrowSize
      const ux = dx / length
      const uy = dy / length
      const fill = new THREE.Color(
        mgsNodeFill({ ...a, direction: edge.direction ?? a.direction }, theme),
      )
      const sides = [
        [a.x + uy * side, a.y - ux * side],
        [a.x - uy * side, a.y + ux * side],
      ]
      const triangles = [[sides[0]!, [a.x - ux * side * 3, a.y - uy * side * 3], sides[1]!]]
      if (both) triangles.push([sides[0]!, sides[1]!, [a.x + ux * side * 3, a.y + uy * side * 3]])
      for (const triangle of triangles)
        for (const [x, y] of triangle) {
          arrowPositions.push(x!, y!, 2)
          arrowColors.push(fill.r, fill.g, fill.b)
        }
    } else if (!mgs2d && size > 0 && (!a.curve || !b.curve)) {
      const t = both ? 0.67 : 0.5
      directionMarker(arrowPositions, arrowColors, a.x + dx * t, a.y + dy * t, angle, size, color)
      if (both)
        directionMarker(
          arrowPositions,
          arrowColors,
          a.x + dx * (1 - t),
          a.y + dy * (1 - t),
          angle + Math.PI,
          size,
          color,
        )
    }
    if (a.virtual || b.virtual || a.curve || b.curve) continue
    // 지도 연결 방향과 별도로 방향별 차량 유지각과 후진 설정을 나타내는 표시
    for (const [side, control] of [
      [1, edge.controls?.forward],
      [-1, both ? edge.controls?.backward : undefined],
    ] as const) {
      if (control?.vehicleDegree === undefined || control.vehicleDegree < 0) continue
      const heading =
        ((control.vehicleDegree / 1000 - (control.reverse === 1 ? 180 : 0)) * Math.PI) / 180
      const shift = Math.min(190, length / 4) * side
      const headingColor = new THREE.Color(
        control.reverse === 1
          ? theme.dark
            ? 0xffac59
            : 0x9a520b
          : theme.dark
            ? 0xd6adff
            : 0x7044a9,
      )
      directionMarker(
        vehiclePositions,
        vehicleColors,
        (a.x + b.x) / 2 - Math.sin(angle) * shift,
        (a.y + b.y) / 2 + Math.cos(angle) * shift,
        heading,
        Math.min(80, length / 5),
        headingColor,
      )
    }
  }

  const edges = new THREE.Mesh(
    new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      .setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)),
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  )
  edges.name = 'edges'
  group.add(edges)

  const arrows = new THREE.Mesh(
    new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute(arrowPositions, 3))
      .setAttribute('color', new THREE.Float32BufferAttribute(arrowColors, 3)),
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  )
  arrows.name = 'arrows'
  group.add(arrows)

  const vehicleHeadings = new THREE.Mesh(
    new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute(vehiclePositions, 3))
      .setAttribute('color', new THREE.Float32BufferAttribute(vehicleColors, 3)),
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  )
  vehicleHeadings.name = 'vehicle-headings'
  vehicleHeadings.visible = false
  group.add(vehicleHeadings)

  nodeMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(baseRadius - strokeWidth, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    Math.max(map.nodes.length, 1),
  )
  nodeMesh.count = map.nodes.length
  if (mgs2d) {
    nodeMesh.frustumCulled = false
    borders.frustumCulled = false
  }

  map.nodes.forEach((node, index) => {
    const virtual = node.virtual || node.curve
    const radius = mgs2d
      ? virtual
        ? MGS_VIRTUAL_NODE_RADIUS_MM
        : MGS_NODE_RADIUS_MM
      : node.curve
        ? MAP_CURVE_NODE_RADIUS_MM
        : MAP_NODE_RADIUS_MM
    const borderScale = radius / baseRadius
    matrix.makeScale(borderScale, borderScale, 1).setPosition(node.x, node.y, 4)
    borders.setMatrixAt(index, matrix)
    const color =
      node.virtual || node.curve
        ? theme.virtual
        : node.noSendGoal
          ? theme.dark
            ? 0xfbb673
            : 0x9a520b
          : node.direction === 1
            ? theme.bothWays
            : theme.oneWay
    borders.setColorAt(index, new THREE.Color(mgs2d ? (virtual ? theme.virtual : 0xc0c0c0) : color))

    // 일반 노드는 중앙을 밝게 유지하고 가상 노드는 속을 비워 경로 위에서 구분하는 표현
    const fillScale = (radius - strokeWidth) / (baseRadius - strokeWidth)
    matrix.makeScale(fillScale, fillScale, 1).setPosition(node.x, node.y, 5)
    nodeMesh.setMatrixAt(index, matrix)
    nodeMesh.setColorAt(
      index,
      mgs2d
        ? new THREE.Color(mgsNodeFill(node, theme))
        : new THREE.Color(theme.background).lerp(
            new THREE.Color(color),
            node.virtual || node.curve ? 0 : 0.24,
          ),
    )
  })
  nodeMesh.instanceMatrix.needsUpdate = true
  group.add(borders, nodeMesh)
  {
    const vertices: number[] = [],
      colors: number[] = []
    const portFaces: string[] = []
    let currentPort = ''
    /**
     * 포트의 둥근 모서리와 테두리를 삼각형 정점으로 변환하는 평면 도형 구성
     *
     * @param x 지도 또는 모델 기준 가로 좌표
     * @param y 지도 또는 모델 기준 세로 좌표
     * @param w 외곽 가로 길이
     * @param h 외곽 높이 또는 세로 길이
     * @param radius 둥근 모서리의 반경
     * @param z 지도 바닥을 기준으로 하는 높이 좌표
     * @param color 렌더링에 사용할 부품 또는 정점 색상
     */
    const rounded = (
      x: number,
      y: number,
      w: number,
      h: number,
      radius: number,
      z: number,
      color: number,
    ) => {
      if (w <= 0 || h <= 0) return
      const left = x - w / 2,
        bottom = y - h / 2,
        right = x + w / 2,
        top = y + h / 2
      const r = Math.max(0, Math.min(radius, w / 2, h / 2))
      const shape = new THREE.Shape()
      shape.moveTo(left + r, bottom)
      shape.lineTo(right - r, bottom)
      shape.quadraticCurveTo(right, bottom, right, bottom + r)
      shape.lineTo(right, top - r)
      shape.quadraticCurveTo(right, top, right - r, top)
      shape.lineTo(left + r, top)
      shape.quadraticCurveTo(left, top, left, top - r)
      shape.lineTo(left, bottom + r)
      shape.quadraticCurveTo(left, bottom, left + r, bottom)
      const indexed = new THREE.ShapeGeometry(shape, 5)
      const geometry = indexed.toNonIndexed()
      const p = geometry.getAttribute('position'),
        c = new THREE.Color(color)
      for (let index = 0; index < p.count; index++) {
        vertices.push(p.getX(index), p.getY(index), z)
        colors.push(c.r, c.g, c.b)
      }
      for (let index = 0; index < p.count / 3; index++) portFaces.push(currentPort)
      geometry.dispose()
      indexed.dispose()
    }
    for (const port of displayMapPorts(map)) {
      currentPort = port.id
      const w = port.width ?? 420,
        h = port.height ?? 260,
        stroke = Math.min(theme.portStrokeWidth, Math.min(w, h) * 0.075),
        outline =
          port.strokeColor === undefined || port.strokeColor === 0
            ? theme.portStroke
            : legacyColor(port.strokeColor)
      rounded(port.x, port.y, w, h, Math.min(w, h) / (port.radiusRatio ?? 10), 94, outline)
      rounded(
        port.x,
        port.y,
        w - 2 * stroke,
        h - 2 * stroke,
        Math.max(0, Math.min(w, h) / (port.radiusRatio ?? 10) - stroke),
        95,
        port.fillColor === undefined || port.fillColor === 0xffffff
          ? theme.portFill
          : legacyColor(port.fillColor),
      )
      if (stroke > 0 && !port.radiusRatio) {
        const tabWidth = Math.min(w * 0.24, h * 0.46)
        rounded(
          port.x,
          port.y - h / 2 + stroke * 2,
          tabWidth,
          stroke * 1.2,
          stroke / 2,
          96,
          outline,
        )
      }
    }
    portMesh = new THREE.Mesh(
      new THREE.BufferGeometry()
        .setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
        .setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)),
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    )
    portMesh.name = 'ports'
    portMesh.userData.portFaces = portFaces
    group.add(portMesh)
  }
  const captionVertices: number[] = []
  for (const port of displayMapPorts(map)) {
    if (!port.name) continue
    const end = portNameAnchor(port),
      length = Math.hypot(end.x - port.x, end.y - port.y)
    if (!length) continue
    const dx = (-(end.y - port.y) / length) * 40,
      dy = ((end.x - port.x) / length) * 40
    captionVertices.push(
      port.x + dx,
      port.y + dy,
      0,
      port.x - dx,
      port.y - dy,
      0,
      end.x + dx,
      end.y + dy,
      0,
      end.x + dx,
      end.y + dy,
      0,
      port.x - dx,
      port.y - dy,
      0,
      end.x - dx,
      end.y - dy,
      0,
    )
  }
  const captions = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(captionVertices, 3),
    ),
    new THREE.MeshBasicMaterial({
      color: theme.font,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    }),
  )
  captions.name = 'port-captions'
  captions.visible = false
  group.add(captions)
  // 압축한 바닥 높이와 무관하게 겹침 순서를 보장하는 지도 전용 페인터 순서
  const orders: Record<string, number> = {
    edges: -100,
    arrows: -99,
    'vehicle-headings': -96,
    'node-borders': -98,
    ports: -95,
    'port-captions': -94,
  }
  nodeMesh.name = 'nodes'
  nodeMesh.renderOrder = -97
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (orders[object.name] !== undefined) object.renderOrder = orders[object.name]
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      material.depthTest = false
      material.depthWrite = false
    }
  })
  // 카메라 행렬과 합성하는 배정밀도 객체 위치에 원본 좌표를 복원하는 렌더링 전용 이동
  for (const object of group.children) {
    object.position.x += origin.x
    object.position.y += origin.y
  }
  return { group, nodeMesh, portMesh }
}
