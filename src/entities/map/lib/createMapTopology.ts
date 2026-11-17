/**
 * 파일명: createMapTopology.ts
 * 설명: 평면과 삼차원 화면에서 재사용하는 지도 도형과 선택 식별 정보 생성
 * 작성자: 이희원
 * 작성일자: 2026-11-04
 */
import * as THREE from 'three'
import { createMapShapes } from '@/entities/map/lib/createMapShapes.ts'
import type { MapDocument } from '@/entities/map/model/map.ts'
import { legacyColor, mgsTheme, displayMapPorts } from '@/entities/map/model/view.ts'
// TS_UI의 원본 좌표 반경과 동일한 노드 치수
export const MAP_NODE_RADIUS_MM = 25
// TS_UI의 방향 마커 치수를 원본 밀리미터 좌표로 환산하는 기준
const MAP_MARKER_SIZE_MM = 2 / 0.03

// 평면 편집기와 삼차원 바닥에서 같은 좌표와 형상을 재사용하는 지도 도형 생성
/**
 * 평면과 삼차원 화면에서 공유하는 노드 및 경로와 포트 도형 생성
 * 지도 원본 좌표와 색상을 유지하며 포트 선택에 필요한 식별 정보를 연결하는 토폴로지 구성
 *
 * @param document 기준 노드와 경로 및 포트를 포함하는 지도 문서
 * @param theme 원본 지도 색상과 크기 및 선 두께 설정
 * @returns 도형 그룹과 노드 및 포트 인스턴스 참조
 */
export const createMapTopology = (document: MapDocument, theme = mgsTheme()) => {
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
  const borders = new THREE.InstancedMesh(
    new THREE.CircleGeometry(MAP_NODE_RADIUS_MM, 32),
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
  for (const edge of map.edges) {
    const a = byId.get(edge.from),
      b = byId.get(edge.to)
    if (!a || !b) continue
    const color = new THREE.Color(
      edge.direction === 0 || edge.direction === undefined
        ? theme.oneWay
        : edge.direction === 1
          ? theme.bothWays
          : 0xff0000,
    )
    addSegment(a.x, a.y, b.x, b.y, color)
    if (a.curve) continue
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    {
      // 경로 중간점이 아닌 출발 노드를 기준으로 배치하는 원본 방향 화살표
      const size = theme.arrowSize === 0 ? 0 : MAP_MARKER_SIZE_MM
      color.set(
        a.virtual || a.curve
          ? theme.virtual
          : a.noSendGoal
            ? 0
            : edge.direction === 1
              ? theme.bothWays
              : edge.direction === undefined || edge.direction === 0
                ? theme.oneWay
                : 0xff0000,
      )
      /**
       * 진행 방향과 측면 오프셋을 원본 노드 좌표에 합성하는 화살표 정점 계산
       *
       * @param forward 진행 방향을 기준으로 하는 정점 이동량
       * @param side 진행 방향에 수직인 정점 이동량
       * @returns 원본 출발 노드에 상대 이동을 합성한 화살표 정점 좌표
       */
      const p = (forward: number, side: number) => [
        a.x + Math.cos(angle) * forward - Math.sin(angle) * side,
        a.y + Math.sin(angle) * forward + Math.cos(angle) * side,
        2,
      ]
      const sides = [p(0, -size), p(-(edge.direction === 1 ? 2.5 : 3) * size, 0), p(0, size)]
      arrowPositions.push(...sides.flat())
      for (let index = 0; index < 3; index++) arrowColors.push(color.r, color.g, color.b)
      if (edge.direction === 1) {
        arrowPositions.push(...p(0, -size), ...p(0, size), ...p(2.5 * size, 0))
        for (let index = 0; index < 3; index++) arrowColors.push(color.r, color.g, color.b)
      }
      continue
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

  nodeMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(MAP_NODE_RADIUS_MM - 5, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    Math.max(map.nodes.length, 1),
  )
  nodeMesh.count = map.nodes.length

  map.nodes.forEach((node, index) => {
    const radius = node.curve ? MAP_MARKER_SIZE_MM / 2 : MAP_NODE_RADIUS_MM
    const borderScale = radius / MAP_NODE_RADIUS_MM
    matrix.makeScale(borderScale, borderScale, 1).setPosition(node.x, node.y, 4)
    borders.setMatrixAt(index, matrix)
    borders.setColorAt(
      index,
      new THREE.Color(node.virtual || node.curve ? theme.virtual : 0xc0c0c0),
    )

    // 원형 노드의 외곽 반경과 테두리 두께를 일정하게 유지하는 채움 배치
    const fillScale = (radius - 5) / (MAP_NODE_RADIUS_MM - 5)
    matrix.makeScale(fillScale, fillScale, 1).setPosition(node.x, node.y, 5)
    nodeMesh!.setMatrixAt(index, matrix)
    nodeMesh!.setColorAt(
      index,
      new THREE.Color(
        node.virtual || node.curve
          ? theme.virtual
          : node.noSendGoal
            ? 0
            : node.direction === 1
              ? theme.bothWays
              : node.direction === undefined || node.direction === 0
                ? theme.oneWay
                : 0xff0000,
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
        stroke = theme.portStrokeWidth
      rounded(
        port.x,
        port.y,
        w,
        h,
        Math.min(w, h) / (port.radiusRatio ?? 10),
        94,
        port.strokeColor === undefined || port.strokeColor === 0
          ? theme.portStroke
          : legacyColor(port.strokeColor),
      )
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
  // 압축한 바닥 높이와 무관하게 겹침 순서를 보장하는 지도 전용 페인터 순서
  const orders: Record<string, number> = {
    edges: -100,
    arrows: -99,
    'node-borders': -98,
    ports: -95,
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
