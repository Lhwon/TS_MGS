/**
 * 파일명: MapScene.ts
 * 설명: 평면 지도 도형과 원본 입력 동작 및 선택 강조를 관리하는 렌더러
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
import { createMapLabels, paintMapLabel } from '@/entities/map/index.ts'
import { createSpacePan } from '@/shared/lib/input/index.ts'
import * as THREE from 'three'
import type { Layers, MapDocument } from '@/entities/map/index.ts'
import {
  createMapTopology,
  MAP_NODE_RADIUS_MM,
  MIN_MAP_LABEL_PIXELS,
  DEFAULT_LAYERS,
  mgsFit,
  layoutCorners,
  mgsTheme,
  pickMgsNode,
  viewStep,
} from '@/entities/map/index.ts'
interface Callbacks {
  click(id: number | null, x: number, y: number): void
  context(
    id: number | null,
    x: number,
    y: number,
    screenX: number,
    screenY: number,
    distance: number,
  ): void
  area(
    start: {
      x: number
      y: number
    },
    end: {
      x: number
      y: number
    },
  ): void
  cursor(x: number, y: number): void
  zoom(value: number): void
}
/**
 * 노드와 경로 및 포트를 표시하는 지도 렌더러 생성
 * 화면 좌표 변환과 원본 마우스 조작 및 자원 해제를 캡슐화하는 편집 화면 관리
 *
 * @param host 렌더러와 라벨 요소를 부착할 화면 컨테이너
 * @param callbacks 선택과 배치 및 좌표 변경을 외부 상태에 전달하는 이벤트 묶음
 * @returns 문서와 시점 및 입력을 제어하고 자원을 해제하는 렌더러 공개 함수 묶음
 */
export const createMapScene = (host: HTMLElement, callbacks: Callbacks) => {
  const viewportHost = host
  const events = callbacks
  let renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  let scene = new THREE.Scene()
  let camera = new THREE.OrthographicCamera(-5000, 5000, 4000, -4000, 0.1, 100000)
  let grid: THREE.LineSegments
  let topologyGroup = new THREE.Group()
  let nodeMesh: THREE.InstancedMesh | null = null
  let portMesh: THREE.Mesh | null = null
  let highlightMesh = new THREE.Mesh(
    new THREE.RingGeometry(MAP_NODE_RADIUS_MM * 1.8, MAP_NODE_RADIUS_MM * 2.2, 32),
    new THREE.MeshBasicMaterial({
      color: 0x69efc3,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  )
  const curvePreview = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({
      color: 0xff9900,
      dashSize: 100,
      gapSize: 60,
      depthTest: false,
      depthWrite: false,
    }),
  )
  curvePreview.visible = false
  curvePreview.renderOrder = 20
  /**
   * 원본 커브 설계점을 로컬 좌표로 바꾸어 실제 맵 위에 표시하는 점선 미리보기
   * @param points 계산한 커브 좌표 또는 미리보기 해제용 빈 목록
   */
  const setCurvePreview = (points: { x: number; y: number }[] = []) => {
    if (points.length < 2 && !curvePreview.visible) return
    curvePreview.visible = points.length > 1
    curvePreview.geometry.dispose()
    const origin = points[0] ?? { x: 0, y: 0 }
    curvePreview.position.set(origin.x, origin.y, 0)
    curvePreview.geometry = new THREE.BufferGeometry().setFromPoints(
      points.map((point) => new THREE.Vector3(point.x - origin.x, point.y - origin.y, 0)),
    )
    curvePreview.computeLineDistances()
    requestRender()
  }
  const drawingPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false }),
  )
  drawingPlane.renderOrder = -180
  drawingPlane.visible = false
  let drawingImageKey = ''
  let drawingVisible = true
  let disposed = false
  /** 첨부 도면을 동일한 월드 좌표에 표시하는 배경 갱신 */
  const updateDrawing = () => {
    const drawing = mapDocument?.layout
    if (!drawing) {
      drawingPlane.visible = false
      drawingImageKey = ''
      drawingPlane.material.map?.dispose()
      drawingPlane.material.map = null
      return
    }
    drawingPlane.scale.set(drawing.width, drawing.height, 1)
    const corners = layoutCorners(drawing)
    drawingPlane.position.set(
      (corners[0].x + corners[2].x) / 2,
      (corners[0].y + corners[2].y) / 2,
      0,
    )
    drawingPlane.rotation.z = (drawing.rotation * Math.PI) / 180
    drawingPlane.material.transparent = drawing.opacity < 1
    drawingPlane.material.opacity = drawing.opacity
    const imageKey = `${drawing.id}:${mapTheme.dark}:${JSON.stringify(drawing.crop)}`
    if (drawingImageKey === imageKey) {
      drawingPlane.visible = drawingVisible && !!mapDocument?.layout?.visible
      return
    }
    drawingImageKey = imageKey
    drawingPlane.visible = false
    const image = new Image()
    image.onload = () => {
      if (disposed || drawingImageKey !== imageKey) return
      drawingPlane.material.map?.dispose()
      const clipped = document.createElement('canvas')
      const ratio = image.naturalWidth / drawing.sourceWidth
      clipped.width = Math.max(1, Math.round(drawing.crop.width * ratio))
      clipped.height = Math.max(1, Math.round(drawing.crop.height * ratio))
      clipped
        .getContext('2d')!
        .drawImage(
          image,
          drawing.crop.x * ratio,
          drawing.crop.y * ratio,
          drawing.crop.width * ratio,
          drawing.crop.height * ratio,
          0,
          0,
          clipped.width,
          clipped.height,
        )
      let source: HTMLImageElement | HTMLCanvasElement = clipped
      if (mapTheme.dark) {
        const canvas = document.createElement('canvas')
        canvas.width = clipped.width
        canvas.height = clipped.height
        const context = canvas.getContext('2d')!
        context.drawImage(clipped, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
        const background = new THREE.Color(mapTheme.background).getHex()
        const channels = [background >> 16, (background >> 8) & 255, background & 255]
        for (let i = 0; i < pixels.data.length; i += 4) {
          const r = pixels.data[i],
            g = pixels.data[i + 1],
            b = pixels.data[i + 2]
          if (Math.max(r, g, b) - Math.min(r, g, b) < 35) {
            const ink = 1 - (r + g + b) / (3 * 255)
            for (let c = 0; c < 3; c++)
              pixels.data[i + c] = Math.round(channels[c] + ink * (210 - channels[c]))
          } else
            for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.round(pixels.data[i + c] * 0.72)
        }
        context.putImageData(pixels, 0, 0)
        source = canvas
      }
      const texture = new THREE.Texture(source)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.needsUpdate = true
      drawingPlane.material.map = texture
      drawingPlane.material.needsUpdate = true
      drawingPlane.visible = drawingVisible && !!mapDocument?.layout?.visible
      requestRender()
    }
    image.src = drawing.image
  }
  /** 원본 도면 배경의 표시 여부 전환 */
  const setDrawingVisible = (visible: boolean) => {
    drawingVisible = visible
    drawingPlane.visible = visible && !!mapDocument?.layout?.visible && !!drawingPlane.material.map
    requestRender()
  }
  let labelCanvas = document.createElement('canvas')
  let observer: ResizeObserver
  let mapDocument: MapDocument | null = null
  let mapTheme = mgsTheme()
  let mapLabels: ReturnType<typeof createMapLabels> = []
  const projected = new THREE.Vector3()
  let selectedId: number | null = null
  let selectedNodeIds: number[] = []
  let visibleLayers: Layers = { ...DEFAULT_LAYERS }
  let toolMode: 'select' | 'add' | 'connect' = 'select'
  let animationFrame = 0
  let viewportWidth = 1
  let viewportHeight = 1
  let drag: {
    pan: boolean
    anchor: THREE.Vector3
    startX: number
    startY: number
    currentX: number
    currentY: number
    moved: boolean
  } | null = null
  let selectionBox = document.createElement('div')
  let plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  let raycaster = new THREE.Raycaster()
  /**
   * 렌더러의 사용자 메뉴와 충돌하는 브라우저 기본 메뉴를 억제하는 우클릭 처리
   *
   * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
   */
  const contextMenu = (event: Event) => event.preventDefault()
  /**
   * 그래픽 컨텍스트 중단을 감지하여 작업 저장 안내를 전달하는 렌더링 오류 처리
   *
   * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
   */
  const contextLost = (event: Event) => {
    event.preventDefault()
    viewportHost.dispatchEvent(
      new CustomEvent('scene-error', {
        detail: 'GPU 컨텍스트가 중단되었습니다. 작업을 저장한 후 앱을 다시 열어주세요.',
      }),
    )
  }
  /**
   * 컨테이너 크기에 맞게 렌더러와 카메라 투영 범위를 갱신하는 화면 크기 반영
   */
  const resizeViewport = () => {
    const scale = getScale()
    viewportWidth = Math.max(1, viewportHost.clientWidth)
    viewportHeight = Math.max(1, viewportHost.clientHeight)
    const aspect = viewportWidth / viewportHeight
    camera.left = -4000 * aspect
    camera.right = 4000 * aspect
    camera.top = 4000
    camera.bottom = -4000
    setScale(scale)
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    renderer.setPixelRatio(ratio)
    renderer.setSize(viewportWidth, viewportHeight)
    labelCanvas.width = Math.round(viewportWidth * ratio)
    labelCanvas.height = Math.round(viewportHeight * ratio)
    labelCanvas.style.width = `${viewportWidth}px`
    labelCanvas.style.height = `${viewportHeight}px`
    requestRender()
  }
  /**
   * 현재 문서의 도형을 구성하고 선택 및 표시 상태를 재적용하는 렌더링 문서 교체
   *
   * @param map 기준 노드와 경로 및 포트를 포함하는 지도 문서
   */
  const setDocument = (map: MapDocument, theme = mapTheme) => {
    if (mapDocument === map && mapTheme === theme) return
    mapTheme = theme
    cancelDrag()
    mapDocument = map
    updateDrawing()
    scene.background = new THREE.Color(mapTheme.background)
    ;(grid.material as THREE.LineBasicMaterial).color
      .set(mapTheme.grid)
      .lerp(new THREE.Color(mapTheme.background), 0.5)
    clearTopology()
    const topology = createMapTopology(map, mapTheme)
    topologyGroup.add(...[...topology.group.children])
    nodeMesh = topology.nodeMesh
    portMesh = topology.portMesh
    setLayers(visibleLayers)
    setSelected(selectedId)
  }
  /**
   * 지도 테마를 교체하고 기존 문서를 다시 구성하는 색상 및 표시 설정 적용
   *
   * @param theme 원본 지도 색상과 크기 및 선 두께 설정
   */
  const setTheme = (theme: ReturnType<typeof mgsTheme>) => {
    if (mapDocument) setDocument(mapDocument, theme)
    else mapTheme = theme
  }
  /**
   * 지도 객체별 가시성을 변경하고 선택 강조를 다시 적용하는 표시 레이어 반영
   *
   * @param layers 지도 객체별 표시 여부와 라벨 표시 옵션
   */
  const setLayers = (layers: Layers) => {
    visibleLayers = { ...layers }
    mapLabels = mapDocument ? createMapLabels(mapDocument, visibleLayers, mapTheme) : []
    grid.visible = layers.grid
    if (nodeMesh) nodeMesh.visible = layers.nodes
    if (portMesh) portMesh.visible = layers.ports
    const borders = topologyGroup.getObjectByName('node-borders')
    if (borders) borders.visible = layers.nodes
    const edges = topologyGroup.getObjectByName('edges')
    if (edges) edges.visible = layers.edges
    const arrows = topologyGroup.getObjectByName('arrows')
    if (arrows) arrows.visible = layers.edges
    setSelected(selectedId)
    requestRender()
  }
  /**
   * 현재 도구에 맞춰 커서와 이동 및 회전 핸들의 활성 상태를 바꾸는 조작 모드 전환
   *
   * @param tool 현재 활성화할 선택 또는 배치 및 이동 도구
   * @param readOnly 현재 지도에서 편집 도구의 사용을 제한하는 상태
   */
  const setTool = (tool: 'select' | 'add' | 'connect', readOnly: boolean) => {
    toolMode = tool
    renderer.domElement.style.cursor = spacePan.active()
      ? 'grab'
      : tool === 'add' || tool === 'connect'
        ? 'crosshair'
        : 'default'
  }
  /**
   * 현재 선택 대상과 강조 표시 또는 이동 핸들을 갱신하는 렌더러 선택 반영
   *
   * @param id 조회하거나 편집할 대상의 고유 식별자
   */
  const setSelected = (id: number | null) => {
    selectedId = id
    const node = mapDocument?.nodes.find((item) => item.id === id)
    highlightMesh.visible = !!node && visibleLayers.nodes
    if (node) highlightMesh.position.set(node.x, node.y, 15)
    requestRender()
  }
  /**
   * 영역 선택 목록을 보관하고 화면 강조를 갱신하는 다중 선택 반영
   *
   * @param ids 중복 여부를 확인할 식별자 목록
   */
  const setAreaSelection = (ids: number[]) => {
    selectedNodeIds = ids
    requestRender()
  }
  /**
   * 지도와 표시 객체의 범위를 사용 가능한 화면에 맞추는 카메라 맞춤
   *
   * @param alternate 원본의 여백 없는 맞춤 규칙의 적용 여부
   */
  const fit = (alternate = false) => {
    if (!mapDocument) return
    const view = mgsFit(
      mapDocument,
      viewportWidth,
      viewportHeight,
      alternate ? 0 : 150,
      alternate ? -180 : 0,
    )
    camera.up.set(0, 1, 0)
    camera.far = 20000
    camera.position.set(view.x, view.y, 10000)
    camera.lookAt(view.x, view.y, 0)
    setScale(view.scale)
    requestRender()
  }
  /**
   * 지정 노드 위치를 화면 중심으로 옮기는 선택 대상 시점 이동
   *
   * @param id 조회하거나 편집할 대상의 고유 식별자
   */
  const focus = (id: number) => {
    const node = mapDocument?.nodes.find((item) => item.id === id)
    if (!node) return
    const middle = screenToWorld(viewportWidth / 2, viewportHeight / 2)
    camera.position.x += node.x - middle.x
    camera.position.y += node.y - middle.y
    requestRender()
  }
  /**
   * 현재 화면 중심을 유지하면서 지정 비율만큼 확대 또는 축소하는 배율 변경
   *
   * @param factor 현재 배율에 적용할 확대 또는 축소 배수
   */
  const zoomBy = (factor: number) => {
    const before = screenToWorld(viewportWidth / 2, viewportHeight / 2)
    setScale(getScale() * factor)
    const after = screenToWorld(viewportWidth / 2, viewportHeight / 2)
    camera.position.x += before.x - after.x
    camera.position.y += before.y - after.y
    requestRender()
  }
  /**
   * 현재 직교 카메라 범위에서 원본 지도 화면 배율을 계산하는 배율 조회
   * @returns 현재 직교 카메라의 지도 표시 배율
   */
  const getScale = () => {
    return (camera.zoom * viewportHeight) / 800
  }
  /**
   * 원본 지도 배율 범위를 적용하고 카메라 및 확대 표시를 갱신하는 배율 반영
   *
   * @param value 현재 처리 단계에서 검증하거나 반영할 입력 값
   */
  const setScale = (value: number) => {
    camera.zoom = (Math.max(0.01, Math.min(5, value)) * 800) / viewportHeight
    camera.updateProjectionMatrix()
    events.zoom(getScale())
  }
  /**
   * 뷰포트 픽셀 위치의 광선과 지도 평면의 교점을 계산하는 지도 좌표 변환
   *
   * @param x 지도 또는 모델 기준 가로 좌표
   * @param y 지도 또는 모델 기준 세로 좌표
   * @returns 입력 위치와 지도 평면이 만나는 지도 좌표
   */
  const screenToWorld = (x: number, y: number) => {
    camera.updateMatrixWorld()
    raycaster.setFromCamera(
      new THREE.Vector2((x / viewportWidth) * 2 - 1, 1 - (y / viewportHeight) * 2),
      camera,
    )
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3()) ?? new THREE.Vector3()
  }
  /**
   * 브라우저 입력 위치에서 캔버스 오프셋을 제거하는 화면 상대 좌표 계산
   *
   * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
   * @returns 캔버스 원점 기준 입력 좌표
   */
  const getPointerPosition = (event: PointerEvent | WheelEvent) => {
    const rect = renderer.domElement.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  /**
   * 마우스 버튼과 현재 도구에 맞는 선택 또는 드래그 시작 상태를 기록하는 입력 시작 처리
   *
   * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
   */
  const pointerDown = (event: PointerEvent) => {
    if (drag || ![0, 2].includes(event.button)) return
    event.preventDefault()
    const p = getPointerPosition(event),
      world = screenToWorld(p.x, p.y)
    renderer.domElement.focus()
    if (event.button === 2) {
      const target = pickMgsNode(mapDocument?.nodes ?? [], world, 'right')
      events.context(target.node?.id ?? null, world.x, world.y, p.x, p.y, target.distance)
      return
    }
    // 스페이스 입력 상태에서만 카메라 이동을 허용하는 드래그 분기
    const pan = spacePan.active()
    renderer.domElement.setPointerCapture(event.pointerId)
    if (!pan) {
      const target = pickMgsNode(mapDocument?.nodes ?? [], world, 'left')
      events.click(target.node?.id ?? null, world.x, world.y)
    }
    // 선택 조작으로 좌표를 변경하지 않고 속성 입력에서만 위치를 편집하는 원본 동작
    if (pan || toolMode === 'select')
      drag = {
        pan,
        anchor: world,
        startX: p.x,
        startY: p.y,
        currentX: p.x,
        currentY: p.y,
        moved: false,
      }
  }
  /**
   * 클릭한 지도 위치를 중심으로 원본 기본 배율을 적용하는 더블 클릭 확대
   *
   * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
   */
  const doubleClick = (event: MouseEvent) => {
    if (spacePan.active()) return
    if (event.button !== 0) return
    event.preventDefault()
    cancelDrag()
    const rect = renderer.domElement.getBoundingClientRect()
    const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top)
    const centre = screenToWorld(viewportWidth / 2, viewportHeight / 2)
    camera.position.x += world.x - centre.x
    camera.position.y += world.y - centre.y
    setScale(0.6)
    requestRender()
  }
  /**
   * 지도 커서 좌표를 알리고 드래그 미리보기 또는 선택 상자를 갱신하는 포인터 이동 처리
   *
   * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
   */
  const pointerMove = (event: PointerEvent) => {
    const p = getPointerPosition(event),
      world = screenToWorld(p.x, p.y)
    events.cursor(world.x, world.y)
    if (!drag) return
    drag.moved ||= p.x !== drag.startX || p.y !== drag.startY
    if (!drag.moved) return
    drag.currentX = p.x
    drag.currentY = p.y
    if (drag.pan) {
      // 포인터 아래 지도 좌표를 고정하여 드래그 중 즉시 화면을 옮기는 이동 처리
      camera.position.x += drag.anchor.x - world.x
      camera.position.y += drag.anchor.y - world.y
      renderer.domElement.style.cursor = 'grabbing'
    } else {
      Object.assign(selectionBox.style, {
        left: `${Math.min(p.x, drag.startX)}px`,
        top: `${Math.min(p.y, drag.startY)}px`,
        width: `${Math.abs(p.x - drag.startX)}px`,
        height: `${Math.abs(p.y - drag.startY)}px`,
      })
      selectionBox.dataset.operation = p.x > drag.startX ? 'add' : 'remove'
      selectionBox.hidden = false
    }
    requestRender()
  }
  /**
   * 드래그 상태와 이동량을 확인하여 화면 이동 또는 클릭과 영역 선택을 확정하는 입력 종료 처리
   *
   * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
   */
  const pointerUp = (event: PointerEvent) => {
    const previousDrag = drag
    const p = getPointerPosition(event),
      world = screenToWorld(p.x, p.y)
    cancelDrag()
    if (renderer.domElement.hasPointerCapture(event.pointerId))
      renderer.domElement.releasePointerCapture(event.pointerId)
    if (previousDrag?.moved && previousDrag.pan) {
      camera.position.x += previousDrag.anchor.x - world.x
      camera.position.y += previousDrag.anchor.y - world.y
      requestRender()
    }
    if (previousDrag && !previousDrag.pan && previousDrag.moved)
      events.area(previousDrag.anchor, world)
  }
  /**
   * 진행 중인 드래그 상태와 선택 상자를 초기화하는 조작 취소
   */
  const cancelDrag = () => {
    drag = null
    selectionBox.hidden = true
    renderer.domElement.style.cursor = spacePan.active() ? 'grab' : 'default'
    requestRender()
  }
  /**
   * 입력 취소 또는 포인터 캡처 해제에 맞춰 드래그를 정리하는 입력 중단 처리
   */
  const pointerCancel = () => cancelDrag()
  /**
   * 외부 편집 명령이 실행되기 전에 현재 드래그를 종료하는 조작 상태 정리
   */
  const cancelInteraction = () => {
    cancelDrag()
  }
  /**
   * 마우스가 가리키는 지도 좌표를 유지하면서 배율을 조절하는 커서 기준 확대
   *
   * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
   */
  const wheel = (event: WheelEvent) => {
    event.preventDefault()
    if (drag || !event.deltaY) return
    const p = getPointerPosition(event),
      before = screenToWorld(p.x, p.y)
    setScale(getScale() * (event.deltaY < 0 ? 1.2 : 1 / 1.2))
    const after = screenToWorld(p.x, p.y)
    camera.position.x += before.x - after.x
    camera.position.y += before.y - after.y
    requestRender()
  }
  /**
   * 중복 프레임 예약을 합치고 도형과 라벨을 함께 그리는 화면 갱신 예약
   */
  const requestRender = () => {
    if (animationFrame) return
    animationFrame = requestAnimationFrame(() => {
      animationFrame = 0
      const centre = screenToWorld(viewportWidth / 2, viewportHeight / 2)
      const left = screenToWorld(0, viewportHeight / 2),
        right = screenToWorld(viewportWidth, viewportHeight / 2)
      const scale = viewStep(left.distanceTo(right), viewportWidth) / 500
      grid.scale.set(scale, scale, 1)
      grid.position.set(
        Math.round(centre.x / (500 * scale)) * 500 * scale,
        Math.round(centre.y / (500 * scale)) * 500 * scale,
        0,
      )
      renderer.render(scene, camera)
      drawLabels()
    })
  }
  /**
   * 현재 카메라 투영과 표시 옵션을 사용하여 화면 라벨을 겹쳐 그리는 텍스트 렌더링
   */
  const drawLabels = () => {
    const ctx = labelCanvas.getContext('2d')!
    const ratio = labelCanvas.width / viewportWidth
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, viewportWidth, viewportHeight)
    if (visibleLayers.rulers) drawRulers(ctx)
    if (mapDocument && visibleLayers.nodes) {
      const selected = new Set(selectedNodeIds)
      ctx.strokeStyle = '#ffcc00'
      ctx.lineWidth = 2
      for (const node of mapDocument.nodes)
        if (selected.has(node.id)) {
          const p = projected.set(node.x, node.y, 5).project(camera)
          const x = ((p.x + 1) * viewportWidth) / 2,
            y = ((1 - p.y) * viewportHeight) / 2
          ctx.strokeRect(x - 7, y - 7, 14, 14)
        }
    }
    if (!visibleLayers.labels || !mapDocument) return
    const scale = getScale() / 10
    for (const label of mapLabels) {
      const size = label.size * scale
      if (size < MIN_MAP_LABEL_PIXELS) continue
      const p = projected.set(label.x, label.y, 200).project(camera)
      const x = ((p.x + 1) * viewportWidth) / 2,
        y = ((1 - p.y) * viewportHeight) / 2
      if (
        p.z < -1 ||
        p.z > 1 ||
        x < -300 ||
        y < -300 ||
        x > viewportWidth + 300 ||
        y > viewportHeight + 300
      )
        continue
      paintMapLabel(ctx, label, x, y, size)
    }
  }
  /**
   * 현재 화면의 지도 좌표 범위에 맞춰 가로와 세로 눈금을 그리는 축척 표시
   *
   * @param ctx 라벨과 눈금 표시를 위한 캔버스 드로잉 컨텍스트
   */
  const drawRulers = (ctx: CanvasRenderingContext2D) => {
    ctx.save()
    ctx.fillStyle = `#${mapTheme.background.toString(16).padStart(6, '0')}`
    ctx.fillRect(0, 0, viewportWidth, 18)
    ctx.fillRect(0, 0, 20, viewportHeight)
    ctx.font = '9px Pretendard, monospace'
    ctx.strokeStyle = `#${mapTheme.grid.toString(16).padStart(6, '0')}`
    ctx.fillStyle = `#${mapTheme.font.toString(16).padStart(6, '0')}`
    ctx.lineWidth = 1
    /**
     * 표시 범위 안의 유효한 눈금값을 순회하며 화면 위치를 전달하는 눈금 생성
     *
     * @param start 영역 선택 또는 눈금의 시작 위치
     * @param end 영역 선택 또는 눈금의 종료 위치
     * @param pixels 눈금 계산에 사용하는 화면 픽셀 길이
     * @param draw 눈금 위치와 값을 실제 화면에 그리는 콜백
     */
    const ticks = (
      start: number,
      end: number,
      pixels: number,
      draw: (pixel: number, value: number) => void,
    ) => {
      const distance = Math.abs(end - start)
      if (distance < 0.001) return
      const step = viewStep(distance, pixels, 100)
      const min = Math.min(start, end),
        max = Math.max(start, end)
      for (let value = Math.ceil(min / step) * step; value <= max; value += step)
        draw(((value - start) / (end - start)) * pixels, value)
    }
    ticks(
      screenToWorld(0, 0).x,
      screenToWorld(viewportWidth, 0).x,
      viewportWidth,
      (pixel, value) => {
        if (pixel < 40) return
        ctx.beginPath()
        ctx.moveTo(pixel, 13)
        ctx.lineTo(pixel, 18)
        ctx.stroke()
        ctx.textAlign = 'center'
        ctx.fillText(Math.round(value).toLocaleString('en-US'), pixel, 10)
      },
    )
    ticks(
      screenToWorld(0, 0).y,
      screenToWorld(0, viewportHeight).y,
      viewportHeight,
      (pixel, value) => {
        if (pixel < 35) return
        ctx.beginPath()
        ctx.moveTo(15, pixel)
        ctx.lineTo(20, pixel)
        ctx.stroke()
        ctx.save()
        ctx.translate(9, pixel)
        ctx.rotate(-Math.PI / 2)
        ctx.textAlign = 'center'
        ctx.fillText(Math.round(value).toLocaleString('en-US'), 0, 0)
        ctx.restore()
      },
    )
    ctx.restore()
  }
  /**
   * 기존 노드와 포트 및 경로의 도형과 재질을 해제하는 토폴로지 자원 정리
   */
  const clearTopology = () => {
    topologyGroup.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => {
          if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose()
          material.dispose()
        })
        if (object instanceof THREE.InstancedMesh) object.dispose()
      }
    })
    topologyGroup.clear()
    nodeMesh = null
    portMesh = null
  }
  /**
   * 이벤트와 관찰자 및 렌더링 버퍼를 해제하고 생성한 화면 요소를 제거하는 렌더러 자원 정리
   */
  const dispose = () => {
    disposed = true
    drawingPlane.geometry.dispose()
    drawingPlane.material.map?.dispose()
    drawingPlane.material.dispose()
    curvePreview.geometry.dispose()
    curvePreview.material.dispose()
    spacePan.dispose()
    cancelAnimationFrame(animationFrame)
    observer.disconnect()
    window.removeEventListener('resize', resizeViewport)
    const canvas = renderer.domElement
    canvas.removeEventListener('pointerdown', pointerDown)
    canvas.removeEventListener('dblclick', doubleClick)
    canvas.removeEventListener('pointermove', pointerMove)
    canvas.removeEventListener('pointerup', pointerUp)
    canvas.removeEventListener('pointercancel', pointerCancel)
    canvas.removeEventListener('lostpointercapture', pointerCancel)
    canvas.removeEventListener('wheel', wheel)
    canvas.removeEventListener('contextmenu', contextMenu)
    canvas.removeEventListener('webglcontextlost', contextLost)
    clearTopology()
    grid.geometry.dispose()
    ;(grid.material as THREE.Material).dispose()
    highlightMesh.geometry.dispose()
    highlightMesh.material.dispose()
    renderer.dispose()
    canvas.remove()
    labelCanvas.remove()
    selectionBox.remove()
  }
  const spacePan = createSpacePan((pressed) => {
    if (!pressed && drag?.pan) cancelDrag()
    renderer.domElement.style.cursor = pressed ? 'grab' : 'default'
  })
  scene.background = new THREE.Color('#0d151e')
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.domElement.setAttribute(
    'aria-label',
    '지도 편집 영역: 왼쪽 클릭 노드 선택, 왼쪽 드래그 영역 선택·해제, 스페이스와 왼쪽 드래그 화면 이동, 오른쪽 클릭 편집 메뉴, 더블클릭 위치 확대',
  )
  renderer.domElement.tabIndex = 0
  labelCanvas.className = 'map-labels'
  selectionBox.className = 'mgs-selection-box'
  selectionBox.hidden = true
  host.append(renderer.domElement, labelCanvas, selectionBox)
  camera.position.set(0, 0, 10000)
  camera.lookAt(0, 0, 0)
  const positions: number[] = []
  for (let n = -50000; n <= 50000; n += 500)
    positions.push(n, -50000, -10, n, 50000, -10, -50000, n, -10, 50000, n, -10)
  grid = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    ),
    new THREE.LineBasicMaterial({
      color: 0x24313d,
      depthWrite: false,
    }),
  )
  grid.renderOrder = -200
  highlightMesh.renderOrder = 10
  highlightMesh.visible = false
  scene.add(grid, topologyGroup, highlightMesh, curvePreview, drawingPlane)
  const canvas = renderer.domElement
  canvas.addEventListener('pointerdown', pointerDown)
  canvas.addEventListener('dblclick', doubleClick)
  canvas.addEventListener('pointermove', pointerMove)
  canvas.addEventListener('pointerup', pointerUp)
  canvas.addEventListener('pointercancel', pointerCancel)
  canvas.addEventListener('lostpointercapture', pointerCancel)
  canvas.addEventListener('wheel', wheel, { passive: false })
  canvas.addEventListener('contextmenu', contextMenu)
  canvas.addEventListener('webglcontextlost', contextLost)
  observer = new ResizeObserver(() => resizeViewport())
  observer.observe(host)
  window.addEventListener('resize', resizeViewport)
  resizeViewport()
  /**
   * 현재 도형과 라벨을 하나의 이미지로 합성하는 지도 화면 캡처
   * @returns 현재 지도 화면의 PNG 데이터 주소
   */
  const capture = () => {
    renderer.render(scene, camera)
    drawLabels()
    const output = document.createElement('canvas')
    output.width = renderer.domElement.width
    output.height = renderer.domElement.height
    const context = output.getContext('2d')!
    context.drawImage(renderer.domElement, 0, 0)
    context.drawImage(labelCanvas, 0, 0, output.width, output.height)
    return output.toDataURL('image/png')
  }
  return {
    capture,
    setCurvePreview,
    setDrawingVisible,
    setDocument: setDocument,
    setTheme: setTheme,
    setLayers: setLayers,
    setTool: setTool,
    setSelected: setSelected,
    setAreaSelection: setAreaSelection,
    fit: fit,
    focus: focus,
    zoomBy: zoomBy,
    cancelInteraction: cancelInteraction,
    dispose: dispose,
  }
}
