/**
 * 파일명: FacilityScene.ts
 * 설명: 기준 지도와 설비 모델 및 포트 선택과 변환 핸들을 관리하는 렌더러
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { createMapLabels, paintMapLabel } from '@/entities/map/index.ts'
import { createSpacePan } from '@/shared/lib/input/index.ts'
import * as THREE from 'three'
import { createFacilityLights, facilityEmitterMaterial, GlbModelCache, prepareFacilityEmitter, selectFacilityLights, type FacilityEmitter } from '@bem/map3d/glb'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { FacilityAsset, FacilityDocument, FacilityInstance, FacilityPart, Point3 } from '@/entities/facility/index.ts'
import { resolveFacilityInstance } from '@/entities/facility/index.ts'
import {
  createMapTopology,
  cropLayoutImage,
  DEFAULT_LAYERS,
  layoutCorners,
  type Layers,
  mgsTheme,
  MIN_MAP_LABEL_PIXELS,
} from '@/entities/map/index.ts'
import type { MapDocument } from '@/entities/map/index.ts'
import { FACILITY_CYLINDER_SEGMENTS, facilityPartMatrix, facilityScaleLimits } from '@/entities/facility/index.ts'
import { instanceParts, surfaceForPart, surfaceMaterials, wallBody, wallDoorLimits } from '@/entities/facility/index.ts'
import { getWallOverlapPass } from '@/widgets/facility-studio/lib/wallOverlapPass.ts'
import { createFloorSurfaces } from '@bem/map3d/floor-surfaces'
import { drawFacilityRulers } from '@/widgets/facility-studio/lib/facilityRulers.ts'
import { createMinorGrid } from '@/widgets/facility-studio/lib/createMinorGrid.ts'
import { snapMeasureHit } from '@/widgets/facility-studio/lib/measureSnap.ts'
import { createDirectTransform } from '@/widgets/facility-studio/lib/directTransform.ts'
import { createSelectionOutline } from '@/widgets/facility-studio/lib/selectionOutline.ts'
import { defaultTransformSnap, snapToStep, type TransformSnapStep } from '@/widgets/facility-studio/lib/transformSnap.ts'
import type { FloorPoint } from '@/entities/facility/index.ts'

type FacilitySceneTool = 'select' | 'place' | 'port' | 'attach' | 'measure' | 'wall'
/**
 * 기준 지도와 설비 모델을 합성하는 삼차원 렌더러 생성
 * 포트 기준 배치와 이동 핸들 및 시점 조작을 독립적으로 관리하는 편집 화면 구성
 *
 * @param host 렌더러와 라벨 요소를 부착할 화면 컨테이너
 * @param callbacks 선택과 배치 및 좌표 변경을 외부 상태에 전달하는 이벤트 묶음
 * @returns 모델과 기준 지도를 갱신하고 선택 및 자원을 관리하는 렌더러 공개 함수 묶음
 */
export const createFacilityScene = (
  host: HTMLElement,
  callbacks: {
    error(message: string): void
    select(ids: string[], operation: 'replace' | 'add' | 'toggle'): void
    place(x: number, y: number): void
    finishFloor(): void
    placeAtPort(id: string): void
    attachOpening(id: string | undefined, point: Point3, free: boolean): void
    moveSelection(x: number, y: number): boolean
    measurePoint(point: Point3): void
    move(
      id: string,
      position: {
        x: number
        y: number
        z: number
      },
      rotation: number,
      scale: { x: number; y: number; z: number },
    ): boolean
  },
) => {
  const viewportHost = host
  const events = callbacks
  let scene = new THREE.Scene()
  let camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000000)
  let renderer = new THREE.WebGLRenderer({ antialias: true })
  const wallOverlap = getWallOverlapPass(renderer)
  const selectionOutline = createSelectionOutline(renderer)
  const room = new RoomEnvironment()
  const environmentGenerator = new THREE.PMREMGenerator(renderer)
  const reflections = environmentGenerator.fromScene(room, 0.06)
  room.dispose()
  environmentGenerator.dispose()
  scene.environment = reflections.texture
  scene.environmentIntensity = 0.55
  let siteView: { position: THREE.Vector3; target: THREE.Vector3 } | undefined
  let siteLightingDirty = true
  const siteFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0xa6a39b, roughness: 0.82 }),
  )
  siteFloor.name = 'site-preview-floor'
  siteFloor.position.z = -0.005
  siteFloor.renderOrder = -170
  siteFloor.receiveShadow = true
  siteFloor.visible = false
  const light = new THREE.DirectionalLight(0xffffff, 2.5)
  const fill = new THREE.AmbientLight(0xffffff, 1.5)
  const fixtures = createFacilityLights()
  light.shadow.mapSize.set(2048, 2048)
  light.shadow.bias = -0.0001
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.shadowMap.autoUpdate = false
  let controls: OrbitControls
  let models = new THREE.Group()
  const selectionBounds = new THREE.Box3()
  const selectionProjections = new Map<string, { bounds: THREE.Box3; transform: THREE.Matrix4 }>()
  let selectionGeometryDirty = false
  const batchOutline = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: 0x57d4be,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    }),
  )
  batchOutline.renderOrder = 10
  batchOutline.visible = false
  batchOutline.frustumCulled = false
  const floorFootprints = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: 0x57d4be, depthWrite: false, depthTest: false, transparent: true, opacity: 0.76,
    }),
  )
  floorFootprints.name = 'facility-selection-footprints'
  floorFootprints.renderOrder = 10
  floorFootprints.visible = false
  floorFootprints.frustumCulled = false
  const marquee = document.createElement('div')
  marquee.className = 'facility-marquee'
  marquee.hidden = true
  let ground = new THREE.Group()
  let updateMapNodeSize: ((pixelsPerUnit: number) => void) | undefined
  const floorSurfaces = createFloorSurfaces(0.001, reflections.texture, () => requestRender())
  const floorOutline = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x25cfbb, depthWrite: false }),
  )
  floorOutline.visible = false
  const measurement = new THREE.Group()
  measurement.name = 'facility-measurement'
  const measurementPositions = new THREE.BufferAttribute(new Float32Array(6), 3)
  const measurementGeometry = new THREE.BufferGeometry().setAttribute('position', measurementPositions)
  measurementGeometry.setDrawRange(0, 0)
  const measurementLine = new THREE.Line(
    measurementGeometry,
    new THREE.LineBasicMaterial({ color: 0xf3a93b, depthTest: false, depthWrite: false, toneMapped: false }),
  )
  const measurementPoints = new THREE.Points(
    measurementLine.geometry,
    new THREE.PointsMaterial({
      color: 0xf3a93b, size: 8, sizeAttenuation: false, depthTest: false, depthWrite: false, toneMapped: false,
    }),
  )
  const edgePositions = new THREE.BufferAttribute(new Float32Array(6), 3)
  const snapEdge = new THREE.Line(
    new THREE.BufferGeometry().setAttribute('position', edgePositions),
    new THREE.LineBasicMaterial({ color: 0x45e7a1, depthTest: false, depthWrite: false, toneMapped: false }),
  )
  snapEdge.name = 'measurement-snap-edge'
  const snapPositions = new THREE.BufferAttribute(new Float32Array(3), 3)
  const snapPoint = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', snapPositions),
    new THREE.PointsMaterial({
      color: 0x45e7a1, size: 11, sizeAttenuation: false, depthTest: false, depthWrite: false, toneMapped: false,
    }),
  )
  snapPoint.name = 'measurement-snap-point'
  for (const object of [measurementLine, measurementPoints, snapEdge, snapPoint])
    object.frustumCulled = false
  snapEdge.visible = snapPoint.visible = false
  snapEdge.renderOrder = 13
  snapPoint.renderOrder = 14
  measurement.add(measurementLine, measurementPoints, snapEdge, snapPoint)
  measurementLine.renderOrder = measurementPoints.renderOrder = 12
  measurement.visible = false
  const measurementLabel = document.createElement('output')
  measurementLabel.className = 'facility-measure-label'
  measurementLabel.dataset.testid = 'measure-distance'
  measurementLabel.hidden = true
  const measurementScreenStart = new THREE.Vector3()
  const measurementScreenEnd = new THREE.Vector3()
  const measureFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 })
  let measuredPoints: Point3[] = []
  let measurementPointer: PointerEvent | undefined
  const firstFloorPoint = document.createElement('button')
  firstFloorPoint.type = 'button'
  firstFloorPoint.className = 'facility-floor-first'
  firstFloorPoint.dataset.testid = 'facility-floor-first'
  firstFloorPoint.textContent = '1'
  firstFloorPoint.hidden = true
  let floorStartPoint: FloorPoint | undefined
  const floorStartScreen = new THREE.Vector3()
  const floorPlan = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      // 지도의 선과 시설보다 먼저 합성하면서 원본 도면의 투명도를 유지
      blending: THREE.CustomBlending,
    }),
  )
  floorPlan.name = 'facility-floor-plan'
  floorPlan.visible = false
  // 바닥 마감 위에서 도면을 읽고 그 위에 격자와 지도 객체 표시
  floorPlan.renderOrder = -155
  let floorPlanImageKey = ''
  let floorPlanGeneration = 0
  let floorPlanVisible: boolean | undefined
  let mapDocument: MapDocument | undefined = undefined
  let portMeshes: THREE.Object3D[] = []
  let labels = document.createElement('canvas')
  let visibleLayers: Layers = { ...DEFAULT_LAYERS }
  let mapTheme = mgsTheme()
  let mapLabels: ReturnType<typeof createMapLabels> = []
  const projectedLabel = new THREE.Vector3()
  const viewLabel = new THREE.Vector3()
  const instanceBounds = new Map<string, THREE.Box3>()
  const seeThroughInstances = new Set<string>()
  const labelRay = new THREE.Ray()
  const labelIntersection = new THREE.Vector3()
  const labelFrustum = new THREE.Frustum()
  const labelProjection = new THREE.Matrix4()
  const gridSize = 500
  const gridDivisions = 100
  const grid = new THREE.GridHelper(gridSize, gridDivisions)
  const minorGrid = createMinorGrid(gridSize, gridSize / gridDivisions, grid.material.color)
  let box = new THREE.BoxGeometry(1, 1, 1)
  const wallPreview = new THREE.Mesh(
    box,
    new THREE.MeshBasicMaterial({
      color: 0x00a990, transparent: true, opacity: 0.65, depthTest: false, depthWrite: false,
    }),
  )
  wallPreview.name = 'facility-wall-preview'
  wallPreview.renderOrder = 9
  wallPreview.visible = false
  let wallDraft: { start: FloorPoint; thickness: number } | undefined
  let wallPointer: Pick<PointerEvent, 'clientX' | 'clientY' | 'shiftKey' | 'altKey'> | undefined
  let cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, FACILITY_CYLINDER_SEGMENTS)
  let observer: ResizeObserver
  let meshes: THREE.InstancedMesh[] = []
  const batches = new Map<string, {
    asset: FacilityAsset
    instances: FacilityInstance[]
    meshes: THREE.InstancedMesh[]
    source?: THREE.Group
    emitter?: FacilityEmitter
  }>()
  const previewed = new Set<string>()
  let instanceBindings = new Map<
    string,
    {
      mesh: THREE.InstancedMesh
      index: number
      local: THREE.Matrix4
    }[]
  >()
  const glbCache = new GlbModelCache()
  let documentGeneration = 0
  let facilityDocument: FacilityDocument | undefined
  let requestedDocument: FacilityDocument | undefined
  const emptyPorts: MapDocument['ports'] = []
  let drawnPorts = emptyPorts
  let selectedId: string | null = null
  let selectedIds: string[] = []
  let snapStep: TransformSnapStep = defaultTransformSnap
  let placing = false
  let toolMode: FacilitySceneTool = 'select'
  let animationFrame = 0
  let down = { x: 0, y: 0 }
  let selectionDrag: { id: number; additive: boolean } | undefined
  let moveDrag: {
    id: number
    instances: FacilityInstance[]
    reference: FacilityInstance
    start: THREE.Vector3
    offset?: FloorPoint
    pointer?: PointerEvent
  } | undefined
  let downWasSpace = false
  let ray = new THREE.Raycaster()
  let plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  /**
   * 컨테이너 크기에 맞게 렌더러와 카메라 투영 범위를 갱신하는 화면 크기 반영
   */
  const resizeViewport = () => {
    const w = Math.max(1, viewportHost.clientWidth),
      h = Math.max(1, viewportHost.clientHeight)
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio)
    renderer.setSize(w, h)
    const width = Math.round(w * ratio),
      height = Math.round(h * ratio)
    if (labels.width !== width || labels.height !== height) {
      labels.width = width
      labels.height = height
    }
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    requestRender()
  }
  /** 카메라가 이동해도 첫 점의 완료 버튼을 도면 좌표에 맞춰 표시 */
  const drawFloorStart = () => {
    if (!floorStartPoint) {
      firstFloorPoint.hidden = true
      return
    }
    const p = floorStartScreen.set(floorStartPoint.x / 1000, floorStartPoint.y / 1000, 0.02)
    p.project(camera)
    firstFloorPoint.hidden = Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || Math.abs(p.z) > 1
    if (firstFloorPoint.hidden) return
    firstFloorPoint.style.left = `${((p.x + 1) / 2) * viewportHost.clientWidth}px`
    firstFloorPoint.style.top = `${((1 - p.y) / 2) * viewportHost.clientHeight}px`
  }

  /** 카메라가 바뀌어도 측정선의 화면 중앙에 치수 배지를 배치 */
  const drawMeasurementLabel = () => {
    if (siteView || !measurement.visible || measurementGeometry.drawRange.count !== 2) {
      measurementLabel.hidden = true
      return
    }
    const start = measurementScreenStart.fromBufferAttribute(measurementPositions, 0).project(camera)
    const end = measurementScreenEnd.fromBufferAttribute(measurementPositions, 1).project(camera)
    const x = (start.x + end.x) / 2
    const y = (start.y + end.y) / 2
    measurementLabel.hidden =
      !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1 || Math.abs(y) > 1 ||
      Math.abs(start.z) > 1 || Math.abs(end.z) > 1
    if (measurementLabel.hidden) return
    measurementLabel.style.left = `${(x + 1) * 50}%`
    measurementLabel.style.top = `${(1 - y) * 50}%`
  }
  /**
   * 중복 프레임 예약을 합치고 도형과 라벨을 함께 그리는 화면 갱신 예약
   */
  const requestRender = () => {
    if (animationFrame) return
    animationFrame = requestAnimationFrame(() => {
      animationFrame = 0
      // 지도 거리 변화에 맞춰 깊이 정밀도를 확보하는 설비 카메라 절두체 갱신
      const distance = camera.position.distanceTo(controls.target)
      const near = Math.max(0.05, distance * 0.0001)
      const far = Math.max(1000, distance + controls.maxDistance * 4)
      if (Math.abs(camera.near - near) > 0.001 || Math.abs(camera.far - far) > 1) {
        camera.near = near
        camera.far = far
        camera.updateProjectionMatrix()
      }
      /** 카메라 중심 거리의 지도 배율을 평면 화면과 동일한 노드 크기 보정에 전달 */
      updateMapNodeSize?.(
        viewportHost.clientHeight * camera.projectionMatrix.elements[5]! / (2 * distance * 1000),
      )
      if (siteView && siteLightingDirty) fitSiteLighting(siteBounds())
      if (toolMode === 'measure' && !siteView) updateMeasurement()
      updateWallPreview()
      if (selectionGeometryDirty) updateSelectionBounds()
      floorFootprints.visible = models.visible && !siteView && !!floorFootprints.geometry.getAttribute('position') &&
        floorFootprints.geometry.drawRange.count > 0
      selectFacilityLights(fixtures.group, camera.position, controls.target)
      wallOverlap.render(scene, camera)
      const activeSelection = selectedId && models.visible && !siteView ? instanceBindings.get(selectedId) : undefined
      selectionOutline.render(activeSelection, camera)
      directTransform.draw(canEditDirectly() && activeSelection ? selectionProjections.get(selectedId!) : undefined)
      drawMeasurementLabel()
      if (!siteView) {
        drawLabels()
        drawFloorStart()
      }
    })
  }
  /**
   * 기준 지도 도형의 버퍼와 재질을 해제한 뒤 바닥 그룹을 비우는 지도 자원 정리
   */
  const clearGround = () => {
    ground.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      if (mesh.material)
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose()
          material.dispose()
        }
      if (object instanceof THREE.InstancedMesh) object.dispose()
    })
    ground.clear()
    updateMapNodeSize = undefined
  }
  /** 잘라낸 원본 도면을 기준 맵의 좌표와 회전 그대로 3D 바닥에 표시 */
  const updateFloorPlan = () => {
    const layout = mapDocument?.layout
    floorPlan.visible = false
    if (!layout) {
      floorPlanGeneration++
      floorPlanImageKey = ''
      floorPlan.material.map?.dispose()
      floorPlan.material.map = null
      return
    }
    const corners = layoutCorners(layout)
    floorPlan.position.set(
      (corners[0].x + corners[2].x) / 2000,
      (corners[0].y + corners[2].y) / 2000,
      -0.002,
    )
    floorPlan.scale.set(layout.width / 1000, layout.height / 1000, 1)
    floorPlan.rotation.z = THREE.MathUtils.degToRad(layout.rotation)
    floorPlan.material.opacity = layout.opacity

    const key = `${layout.id}:${JSON.stringify(layout.crop)}`
    if (key === floorPlanImageKey) {
      floorPlan.visible = !siteView && (floorPlanVisible ?? layout.visible) && !!floorPlan.material.map
      return
    }
    floorPlanImageKey = key
    const generation = ++floorPlanGeneration
    floorPlan.material.map?.dispose()
    floorPlan.material.map = null
    const image = new Image()
    image.onload = () => {
      if (floorPlanGeneration !== generation) return
      const texture = new THREE.CanvasTexture(cropLayoutImage(image, layout))
      texture.colorSpace = THREE.SRGBColorSpace
      floorPlan.material.map = texture
      floorPlan.material.needsUpdate = true
      floorPlan.visible = !siteView && (floorPlanVisible ?? !!mapDocument?.layout?.visible)
      requestRender()
    }
    image.src = layout.image
  }
  /**
   * 평면 지도 도형을 동일 좌표의 바닥으로 구성하고 표시 옵션을 적용하는 기준 맵 갱신
   *
   * @param map 기준 노드와 경로 및 포트를 포함하는 지도 문서
   * @param theme 원본 지도 색상과 크기 및 선 두께 설정
   * @param layers 지도 객체별 표시 여부와 라벨 표시 옵션
   */
  const setMap = (map: MapDocument, theme = mgsTheme(), layers: Layers = DEFAULT_LAYERS) => {
    const mapChanged = mapDocument !== map
    const geometryChanged = mapChanged || mapTheme !== theme
    mapDocument = map
    visibleLayers = { ...layers }
    mapTheme = theme
    mapLabels = createMapLabels(map, visibleLayers, theme)
    if (!siteView) scene.background = new THREE.Color(theme.background)
    if (geometryChanged) siteLightingDirty = true
    grid.material.color.set(theme.grid)
    if (geometryChanged) {
      clearGround()
      /** 평면 편집기의 노드 반경과 채움 및 방향 표식 생성 규칙 재사용 */
      const topology = createMapTopology(map, theme, true)
      updateMapNodeSize = topology.updateNodeDisplaySize
      // 평면 도형의 앞뒤 순서는 재질 깊이 대신 렌더 순서로 유지하는 바닥 변환
      ground.scale.set(0.001, 0.001, 0.000001)
      ground.add(...[...topology.group.children])
    }
    for (const object of ground.children) {
      if (['edges', 'arrows'].includes(object.name)) object.visible = layers.edges
      if (['node-borders', 'nodes'].includes(object.name)) object.visible = layers.nodes
      if (object.name === 'ports') object.visible = layers.ports
      if (object.name === 'port-captions') object.visible = layers.ports && !!layers.portCaptions
      if (object.name === 'vehicle-headings')
        object.visible = layers.edges && !!layers.vehicleHeadings
    }
    portMeshes = ground.children.filter(
      (o) => o.visible && (o.userData.portIds || o.userData.portFaces),
    )
    grid.visible = !siteView && layers.grid
    minorGrid.visible = map.units === 'mm'
    updateFloorPlan()
    if (mapChanged && requestedDocument) setDocument(requestedDocument)
    requestRender()
  }
  /**
   * 현재 카메라 투영과 표시 옵션을 사용하여 화면 라벨을 겹쳐 그리는 텍스트 렌더링
   */
  const drawLabels = () => {
    const width = Math.max(1, viewportHost.clientWidth),
      height = Math.max(1, viewportHost.clientHeight)
    const ctx = labels.getContext('2d')
    if (!ctx) return
    const ratio = renderer.getPixelRatio()
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, width, height)
    if (!mapDocument) return
    let occluders: THREE.Box3[] | undefined
    const projection = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))
    for (const label of visibleLayers.labels ? mapLabels : []) {
      viewLabel.set(label.x / 1000, label.y / 1000, 0).applyMatrix4(camera.matrixWorldInverse)
      if (viewLabel.z >= 0) continue
      const size = ((label.size / 1000) * projection) / -viewLabel.z
      if (size < MIN_MAP_LABEL_PIXELS) continue
      const p = projectedLabel.set(label.x / 1000, label.y / 1000, 0.003).project(camera)
      if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) continue
      // 설비의 외곽 상자 뒤에 있는 지도 라벨이 설비 표면에 떠 보이지 않도록 하는 가림 처리
      if (models.visible && instanceBounds.size) {
        if (!occluders) {
          labelProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
          labelFrustum.setFromProjectionMatrix(labelProjection)
          occluders = [...instanceBounds]
            .filter(
              ([id, bounds]) => !seeThroughInstances.has(id) && labelFrustum.intersectsBox(bounds),
            )
            .map(([, bounds]) => bounds)
        }
        viewLabel.set(label.x / 1000, label.y / 1000, 0.003)
        const distanceSquared = viewLabel.distanceToSquared(camera.position)
        labelRay.origin.copy(camera.position)
        labelRay.direction.copy(viewLabel).sub(camera.position).normalize()
        if (
          occluders.some(
            (bounds) =>
              labelRay.intersectBox(bounds, labelIntersection) &&
              labelIntersection.distanceToSquared(camera.position) < distanceSquared - 1e-6,
          )
        )
          continue
      }
      paintMapLabel(ctx, label, ((p.x + 1) * width) / 2, ((1 - p.y) * height) / 2, size)
    }
    if (visibleLayers.rulers) drawFacilityRulers(ctx, camera, width, height, mapTheme, mapDocument.units)
  }

  /** 형상 재구성이 필요한지 확인하고 벽의 개구부는 실제 치수가 달라질 때만 다시 생성 */
  const sameGeometry = (a: FacilityInstance, b: FacilityInstance) =>
    a.id === b.id &&
    a.wallOpacity === b.wallOpacity &&
    JSON.stringify(a.wallDoors) === JSON.stringify(b.wallDoors) &&
    (!a.wallDoors?.length ||
      (a.scale?.x === b.scale?.x && a.scale?.y === b.scale?.y && a.scale?.z === b.scale?.z))

  /** 단순 선택과 이름 변경에서는 변환 버퍼의 갱신을 생략 */
  const samePoint = (a?: FacilityInstance['position'], b?: FacilityInstance['position']) =>
    a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z)

  /** 모델별 배치 버퍼를 구성하고 다른 모델의 이미 로딩된 버퍼와 재질을 유지 */
  const buildBatch = (asset: FacilityAsset, instances: FacilityInstance[], source?: THREE.Group) => {
    const batchMeshes: THREE.InstancedMesh[] = []
    let emitter: FacilityEmitter | undefined
    const register = (
      mesh: THREE.InstancedMesh,
      bindings: { instance: FacilityInstance; part?: FacilityPart; local?: THREE.Matrix4 }[],
    ) => {
      const source = mesh.material
      if (source instanceof THREE.MeshStandardMaterial && !source.envMap) {
        const { r, g, b } = source.color
        const metal = source.metalness >= 0.25 || (source.metalness > 0 && source.metalnessMap)
        const darkGloss = source.roughness < 0.68 && Math.max(r, g, b) < 0.13
        if (metal || darkGloss) {
          // The scene owns the room map. Keep it out of the shared GLB cache's resource disposal.
          const material = mesh.userData.sharedGlb ? source.clone() : source
          material.envMap = reflections.texture
          material.envMapRotation.x = Math.PI / 2
          material.envMapIntensity = 0.72
          mesh.material = material
          mesh.userData.sharedGlb = false
        }
      }
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.receiveShadow = true
      mesh.castShadow = !Array.isArray(mesh.material) && !mesh.material.transparent
      mesh.userData.ids = bindings.map(({ instance }) => instance.id)
      bindings.forEach(({ instance, part, local }, index) => {
        const list = instanceBindings.get(instance.id) ?? []
        list.push({ mesh, index, local: local ?? facilityPartMatrix(part!) })
        instanceBindings.set(instance.id, list)
      })
      models.add(mesh)
      batchMeshes.push(mesh)
    }
    if (source && asset.glb) {
      source.updateMatrixWorld(true)
      const { x, y, z } = asset.glb.size
      const scale = new THREE.Matrix4().makeScale(x / 1000, y / 1000, z / 1000)
      const capacity = Math.max(4, 2 ** Math.ceil(Math.log2(instances.length)))
      emitter = prepareFacilityEmitter(asset, source, scale)
      source.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return
        const local = scale.clone().multiply(part.matrixWorld)
        const material = facilityEmitterMaterial(part, emitter)
        const mesh = new THREE.InstancedMesh(part.geometry, material, capacity)
        mesh.count = instances.length
        mesh.userData.sharedGlb = material === part.material
        register(mesh, instances.map((instance) => ({ instance, local })))
      })
    } else {
      const groups = new Map<string, { instance: FacilityInstance; part: FacilityPart; surface: ReturnType<typeof surfaceForPart> }[]>()
      for (const instance of instances)
        for (const part of instanceParts(asset, instance)) {
          const opacity = (part.wall ? instance.wallOpacity : undefined) ?? part.opacity ?? 1
          // 반투명 부품을 따로 정렬하고 불투명 부품은 재질별 배치 버퍼로 재사용
          const surface = surfaceForPart(part)
          const key = opacity < 1
            ? JSON.stringify([instance.id, part.id])
            : `${part.shape}:${part.color}:${surface}`
          if (opacity < 1) seeThroughInstances.add(instance.id)
          const list = groups.get(key) ?? []
          list.push({ instance, part, surface })
          groups.set(key, list)
        }
      for (const list of groups.values()) {
        const { instance, part, surface } = list[0]!
        const opacity = (part.wall ? instance.wallOpacity : undefined) ?? part.opacity ?? 1
        const { roughness, metalness } = surfaceMaterials[surface]
        const mesh = new THREE.InstancedMesh(
          part.shape === 'box' ? box : cylinder,
          new THREE.MeshStandardMaterial({
            color: part.color,
            roughness,
            metalness,
            envMapIntensity: surface === 'glass' ? 1.65 : 1,
            opacity,
            transparent: opacity < 1,
            depthWrite: opacity === 1,
          }),
          list.length,
        )
        wallOverlap.setWall(mesh, part.wall === true && opacity > 0 && opacity < 1)
        register(mesh, list)
      }
    }
    batches.set(asset.id, { asset, instances, meshes: batchMeshes, source, emitter })
  }

  /**
   * 문서 변경에 필요한 모델 재사용 여부와 배치 목록 계산
   *
   * @param document 새로 표시할 삼차원 설계 문서
   * @param ports 상대 오프셋의 기준이 되는 현재 지도 포트
   * @returns 모델별 배치 목록과 다시 생성할 배치 버퍼 및 사용 가능한 원본
   */
  const planDocumentUpdate = (document: FacilityDocument, ports: MapDocument['ports']) => {
    const instancesByAsset = new Map<string, FacilityInstance[]>()
    for (const instance of document.instances) {
      resolveFacilityInstance(instance, ports)
      const instances = instancesByAsset.get(instance.assetId) ?? []
      instances.push(instance)
      instancesByAsset.set(instance.assetId, instances)
    }
    const sources = new Map<string, THREE.Group>()
    const changes = document.assets.flatMap((asset) => {
      const instances = instancesByAsset.get(asset.id)
      if (!instances) return []
      const previous = batches.get(asset.id)
      const canAppend = !!previous?.source && previous.instances.length < instances.length &&
        (previous.meshes[0]?.instanceMatrix.count ?? 0) >= instances.length
      const rebuild = previous?.asset !== asset ||
        (previous.instances.length !== instances.length && !canAppend) ||
        !previous.instances.every((instance, index) => sameGeometry(instance, instances[index]!))
      if (previous?.asset === asset && previous.source) sources.set(asset.id, previous.source)
      return [{ asset, instances, rebuild }]
    })
    return { instancesByAsset, sources, changes }
  }

  /** 배치 버퍼를 해제하고 공유 GLB 재질의 소유권을 모델 캐시에 유지 */
  const disposePlacementMesh = (mesh: THREE.InstancedMesh) => {
    mesh.dispose()
    if (!mesh.userData.sharedGlb) (mesh.material as THREE.Material).dispose()
  }

  /**
   * 비동기 모델 로딩 뒤 최신 요청에 한해 배치 버퍼와 변환 행렬 반영
   *
   * @param document 배치와 모델 및 바닥을 포함하는 최신 설계 문서
   */
  const setDocument = async (document: FacilityDocument) => {
    cancelDirectMove()
    directTransform.cancel()
    requestedDocument = document
    const generation = ++documentGeneration
    const ports = mapDocument?.ports ?? emptyPorts
    let plan: ReturnType<typeof planDocumentUpdate>
    try {
      plan = planDocumentUpdate(document, ports)
      const { changes, sources } = plan
      const loading = changes.filter(({ asset, rebuild }) => rebuild && asset.glb && !sources.has(asset.id))
      if (loading.length) {
        for (const [id, source] of await Promise.all(loading.map(async ({ asset }) =>
          [asset.id, await glbCache.load(asset.glb!.data)] as const,
        ))) sources.set(id, source)
      }
    } catch (error) {
      if (generation !== documentGeneration) return
      if (!facilityDocument || drawnPorts !== ports) {
        models.visible = false
        updateLightingMode()
        batchOutline.visible = false
        requestRender()
      }
      events.error(error instanceof Error ? error.message : String(error))
      return
    }
    if (generation !== documentGeneration) return

    const { instancesByAsset, sources, changes } = plan
    const rebuilt = new Set(changes.filter((change) => change.rebuild).map(({ asset }) => asset.id))
    for (const [id, batch] of batches) {
      if (instancesByAsset.has(id) && !rebuilt.has(id))
        continue
      for (const mesh of batch.meshes) {
        wallOverlap.setWall(mesh, false)
        mesh.removeFromParent()
        disposePlacementMesh(mesh)
      }
      for (const { id: instanceId } of batch.instances) {
        fixtures.remove(instanceId)
        instanceBindings.delete(instanceId)
        instanceBounds.delete(instanceId)
        seeThroughInstances.delete(instanceId)
      }
      batches.delete(id)
    }

    const libraryChanged = facilityDocument?.assets !== document.assets
    facilityDocument = document
    models.visible = true
    floorSurfaces.setAreas(document.floors)
    for (const { asset, instances, rebuild } of changes) {
      if (rebuild) buildBatch(asset, instances, sources.get(asset.id))
      const batch = batches.get(asset.id)!
      if (batch.instances.length < instances.length) {
        const template = instanceBindings.get(batch.instances[0]!.id)!
        const ids = instances.map(({ id }) => id)
        for (const mesh of batch.meshes) {
          mesh.count = instances.length
          mesh.userData.ids = ids
        }
        for (let index = batch.instances.length; index < instances.length; index++)
          instanceBindings.set(instances[index]!.id, template.map((binding) => ({ ...binding, index })))
      }
      for (const [index, instance] of instances.entries()) {
        const before = batch.instances[index]
        if (rebuild || !before || previewed.has(instance.id) ||
            (drawnPorts !== ports && instance.portOffset) ||
            before.rotation !== instance.rotation ||
            before.portId !== instance.portId ||
            !samePoint(before.position, instance.position) ||
            !samePoint(before.scale, instance.scale) ||
            !samePoint(before.portOffset, instance.portOffset))
          updateMatrices(instance, !rebuild)
      }
      batch.instances = instances
    }
    drawnPorts = ports
    previewed.clear()
    meshes = [...batches.values()].flatMap((batch) => batch.meshes)
    if (libraryChanged) glbCache.retain(document.assets)
    floorSurfaces.setFixtureLighting(fixtures.group)
    siteLightingDirty = true
    updateLightingMode()
    setSelected(selectedIds)
  }
  /** 미터 단위 모델 위치와 배율과 회전으로 렌더링과 선택 핸들이 공유하는 루트 행렬 구성 */
  const placementTransform = (instance: FacilityInstance) => {
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      THREE.MathUtils.degToRad(instance.rotation),
    )
    return new THREE.Matrix4().compose(
      new THREE.Vector3(
        instance.position.x / 1000,
        instance.position.y / 1000,
        instance.position.z / 1000,
      ),
      rotation,
      new THREE.Vector3(instance.scale?.x ?? 1, instance.scale?.y ?? 1, instance.scale?.z ?? 1),
    )
  }

  /** 포트 위치를 합성하고 인스턴스의 렌더링과 경계 및 편집 핸들 위치에 변환 반영 */
  const updateMatrices = (instance: FacilityInstance, partial = true) => {
    instance = resolveFacilityInstance(instance, mapDocument?.ports ?? [])
    const root = placementTransform(instance)
    const matrix = new THREE.Matrix4()
    const emitter = batches.get(instance.assetId)?.emitter
    if (emitter) fixtures.update(instance.id, emitter, root)
    for (const { mesh, index, local } of instanceBindings.get(instance.id) ?? []) {
      mesh.setMatrixAt(index, matrix.multiplyMatrices(root, local))
      if (partial) mesh.instanceMatrix.addUpdateRange(index * 16, 16)
      mesh.instanceMatrix.needsUpdate = true
      // 이동한 설비가 이전 경계 영역 밖에 배치될 수 있으므로 가시성 경계를 다시 계산하는 캐시 초기화
      mesh.boundingSphere = null
      mesh.boundingBox = null
    }
    updateInstanceBounds(instance.id)
    const projection = selectionProjections.get(instance.id)
    if (projection) {
      projection.transform.copy(root)
      selectionGeometryDirty = true
    }
  }
  /**
   * 설비 변환 시 부품의 월드 경계를 합성하여 선택과 라벨 가림에 재사용하는 외곽 캐시 갱신
   * @param id 경계를 갱신할 설비 식별자
   */
  const updateInstanceBounds = (id: string) => {
    const bounds = instanceBounds.get(id) ?? new THREE.Box3()
    bounds.makeEmpty()
    const matrix = new THREE.Matrix4()
    const partBounds = new THREE.Box3()
    for (const { mesh, index } of instanceBindings.get(id) ?? []) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      if (!mesh.geometry.boundingBox) continue
      mesh.getMatrixAt(index, matrix)
      bounds.union(partBounds.copy(mesh.geometry.boundingBox).applyMatrix4(matrix))
    }
    if (bounds.isEmpty()) instanceBounds.delete(id)
    else instanceBounds.set(id, bounds)
  }
  /** 모델 축에 맞춘 바닥 투영과 다중 선택 외곽 및 시점 맞춤 경계 갱신 */
  const updateSelectionBounds = () => {
    selectionGeometryDirty = false
    selectionBounds.makeEmpty()
    const points: number[] = []
    const footprintPoints: number[] = []
    const point = new THREE.Vector3()
    for (const id of selectedIds) {
      const bounds = instanceBounds.get(id)
      if (!bounds) continue
      selectionBounds.union(bounds)
      const projection = selectionProjections.get(id)
      if (projection && !projection.bounds.isEmpty()) {
        const { min, max } = projection.bounds
        const corners = [[min.x, min.y], [max.x, min.y], [max.x, max.y], [min.x, max.y]] as const
        for (const index of [0, 1, 1, 2, 2, 3, 3, 0]) {
          const [x, y] = corners[index]!
          point.set(x, y, 0).applyMatrix4(projection.transform)
          footprintPoints.push(point.x, point.y, 0.004)
        }
      }
      if (selectedIds.length < 2) continue
      const { min, max } = bounds
      const corners = [
        [min.x, min.y, min.z], [max.x, min.y, min.z], [max.x, max.y, min.z], [min.x, max.y, min.z],
        [min.x, min.y, max.z], [max.x, min.y, max.z], [max.x, max.y, max.z], [min.x, max.y, max.z],
      ]
      for (const index of [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7])
        points.push(...corners[index]!)
    }
    batchOutline.visible = !siteView && points.length > 0
    for (const [outline, vertices] of [[batchOutline, points], [floorFootprints, footprintPoints]] as const) {
      const count = vertices.length / 3
      let position = outline.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
      if (count > (position?.count ?? 0)) {
        outline.geometry.dispose()
        position = new THREE.BufferAttribute(new Float32Array(2 ** Math.ceil(Math.log2(count)) * 3), 3)
          .setUsage(THREE.DynamicDrawUsage)
        outline.geometry = new THREE.BufferGeometry().setAttribute('position', position)
      }
      if (count && position) {
        position.set(vertices)
        position.needsUpdate = true
      }
      outline.geometry.setDrawRange(0, count)
    }
  }

  /** 모델 치수에 맞춘 편집 범위에 벽 개구부 보존 조건 반영 */
  const scaleLimits = (instance: FacilityInstance) => {
    const asset = facilityDocument?.assets.find((item) => item.id === instance.assetId)
    const limits = facilityScaleLimits(asset?.glb?.size)
    if (!instance.wallDoors?.length) return limits
    const wall = wallBody(asset)
    if (!wall) return limits
    const doors = wallDoorLimits(instance.wallDoors)
    return {
      ...limits,
      minimum: {
        ...limits.minimum,
        x: Math.max(limits.minimum.x, doors.width / wall.size.x),
        z: Math.max(limits.minimum.z, doors.height / wall.size.z),
      },
    }
  }

  /** 선택과 직접 편집이 가능한 도구 상태 확인 */
  const canEditDirectly = () =>
    !!selectedId && models.visible && !siteView && !spacePan.active() && toolMode === 'select'

  const directTransform = createDirectTransform(host, camera, {
    target: () => {
      if (!canEditDirectly()) return
      const instance = facilityDocument?.instances.find((item) => item.id === selectedId)
      return instance && resolveFacilityInstance(instance, mapDocument?.ports ?? [])
    },
    scaleLimits,
    snapStep: () => snapStep,
    update: (instance, pose, commit) => {
      if (commit) {
        if (!events.move(instance.id, pose.position, pose.rotation, pose.scale))
          updateMatrices(instance)
      } else {
        previewed.add(instance.id)
        updateMatrices({ ...instance, ...pose, portOffset: undefined })
      }
      requestRender()
    },
    restore: (instance) => {
      updateMatrices(instance)
      requestRender()
    },
  })
  /**
   * 현재 선택 대상과 강조 표시 또는 이동 핸들을 갱신하는 렌더러 선택 반영
   *
   * @param ids 선택된 설비 식별자 목록
   */
  const setSelected = (ids: string[]) => {
    if (ids.length !== selectedIds.length || ids.some((id, index) => id !== selectedIds[index])) {
      cancelDirectMove()
      directTransform.cancel()
    }
    selectedIds = ids
    selectedId = ids.length === 1 ? ids[0]! : null
    selectionProjections.clear()
    const selectedSet = new Set(ids)
    for (const instance of facilityDocument?.instances ?? []) {
      if (!selectedSet.has(instance.id)) continue
      const bounds = new THREE.Box3()
      const partBounds = new THREE.Box3()
      for (const { mesh, local } of instanceBindings.get(instance.id) ?? []) {
        if (mesh.geometry.boundingBox)
          bounds.union(partBounds.copy(mesh.geometry.boundingBox).applyMatrix4(local))
      }
      const transform = placementTransform(resolveFacilityInstance(instance, mapDocument?.ports ?? []))
      selectionProjections.set(instance.id, { bounds, transform })
    }
    selectionGeometryDirty = true
    requestRender()
  }
  /**
   * 현재 도구에 맞춰 커서와 이동 및 회전 핸들의 활성 상태를 바꾸는 조작 모드 전환
   *
   * @param tool 현재 활성화할 선택 또는 배치 및 이동 도구
   */
  const setTool = (tool: FacilitySceneTool) => {
    if (tool !== toolMode) {
      cancelDirectMove()
      directTransform.cancel()
    }
    toolMode = tool
    if (tool !== 'measure') {
      measurementPointer = undefined
      measurement.visible = false
    }
    if (tool !== 'wall') wallPointer = undefined
    placing = tool === 'place' || tool === 'port' || tool === 'wall'
    renderer.domElement.style.cursor = spacePan.active()
      ? 'grab'
      : (placing || tool === 'attach' || tool === 'measure') && !siteView
        ? 'crosshair'
        : 'default'
    requestRender()
  }
  /** 현장 카메라와 조명이 공유하는 실측 좌표 영역 계산 */
  const siteBounds = () => {
    const bounds = new THREE.Box3().setFromObject(ground)
    bounds.union(new THREE.Box3().setFromObject(floorSurfaces.group))
    for (const instance of instanceBounds.values()) bounds.union(instance)
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, 5, 3))
    return bounds
  }

  /** 현장 크기에 맞춘 바닥과 방향광 그림자 범위 적용 */
  const fitSiteLighting = (bounds: THREE.Box3) => {
    siteLightingDirty = false
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const extent = Math.max(size.x, size.y, size.z, 5)
    siteFloor.position.set(center.x, center.y, -0.005)
    const floorExtent = extent * 2 + 24
    siteFloor.scale.set(floorExtent, floorExtent, 1)
    if (!light.visible) return
    light.position.copy(center).add(new THREE.Vector3(-0.45, -0.55, 1.2).multiplyScalar(extent))
    light.target.position.copy(center)
    light.shadow.normalBias = Math.max(0.004, extent / 1500)
    Object.assign(light.shadow.camera, {
      left: -extent, right: extent, top: extent, bottom: -extent, near: 0.1, far: extent * 4,
    })
    light.shadow.camera.updateProjectionMatrix()
    renderer.shadowMap.needsUpdate = true
  }

  /** 쇼룸 광원이 있는 장면에서는 기본 방향광과 환경 반사를 실제 조명 기구로 대체 */
  const updateLightingMode = () => {
    const fixtureLighting = models.visible && fixtures.group.children.length > 0
    fixtures.group.visible = fixtureLighting
    light.visible = !fixtureLighting
    fill.color.setHex(fixtureLighting ? 0xfff8ee : 0xffffff)
    fill.intensity = fixtureLighting ? 1.4 : siteView ? 0.42 : 1.5
    scene.environment = fixtureLighting ? null : reflections.texture
    scene.environmentIntensity = fixtureLighting ? 0 : siteView ? 0.8 : 0.55
    floorSurfaces.setEnvironmentEnabled(!fixtureLighting)
    renderer.toneMapping = siteView || fixtureLighting ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping
    renderer.shadowMap.enabled = light.castShadow = !!siteView && !fixtureLighting
  }

  /** 편집 시점을 보관하고 눈높이 현장 보기와 편집 화면 사이를 전환 */
  const setSitePreview = (enabled: boolean) => {
    if (enabled === Boolean(siteView)) return
    if (enabled) {
      cancelDirectMove()
      directTransform.cancel()
      siteView = { position: camera.position.clone(), target: controls.target.clone() }
      const bounds = siteBounds()
      const size = bounds.getSize(new THREE.Vector3())
      const center = bounds.getCenter(new THREE.Vector3())
      controls.maxPolarAngle = Math.PI / 2
      camera.position.set(center.x, bounds.min.y + Math.min(size.y * 0.12, 2) - 0.5, 1.6)
      controls.target.copy(camera.position).add(new THREE.Vector3(0, 5, 0))
      scene.background = new THREE.Color(0xc6cbd0)
      light.intensity = 2.4
      light.color.setHex(0xfff1e2)
      siteLightingDirty = true
    } else {
      camera.position.copy(siteView!.position)
      controls.target.copy(siteView!.target)
      siteView = undefined
      controls.maxPolarAngle = Math.PI / 2.2
      scene.background = new THREE.Color(mapTheme.background)
      light.position.set(10, -20, 40)
      light.target.position.set(0, 0, 0)
      light.intensity = 2.5
      light.color.setHex(0xffffff)
    }
    ground.visible = !enabled
    grid.visible = !enabled && visibleLayers.grid
    labels.style.visibility = enabled ? 'hidden' : ''
    firstFloorPoint.style.visibility = enabled ? 'hidden' : ''
    floorOutline.visible = !enabled && floorOutline.geometry.getAttribute('position')?.count > 1
    measurement.visible = !enabled && toolMode === 'measure'
    if (enabled) measurementPointer = undefined
    siteFloor.visible = enabled
    updateLightingMode()
    updateFloorPlan()
    setSelected(selectedIds)
    setTool(toolMode)
    controls.update()
    requestRender()
  }
  /**
   * 지도와 표시 객체의 범위를 사용 가능한 화면에 맞추는 카메라 맞춤
   */
  const fit = (fromAbove = false) => {
    ground.updateMatrixWorld(true)
    const bounds = new THREE.Box3()
    for (const instance of instanceBounds.values()) bounds.union(instance)
    bounds.union(new THREE.Box3().setFromObject(ground))
    bounds.union(new THREE.Box3().setFromObject(floorSurfaces.group))
    if (mapDocument?.layout && (floorPlanVisible ?? mapDocument.layout.visible))
      bounds.union(new THREE.Box3().setFromObject(floorPlan))
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, 5, 5))
    const centre = bounds.getCenter(new THREE.Vector3())
    const direction = (
      fromAbove ? new THREE.Vector3(0, -0.001, 1) : new THREE.Vector3(1, -1, 0.85)
    ).normalize()
    const right = new THREE.Vector3(0, 0, 1).cross(direction).normalize()
    const up = direction.clone().cross(right).normalize()
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    let distance = 1
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(centre)
          distance = Math.max(
            distance,
            corner.dot(direction) +
              Math.max(
                Math.abs(corner.dot(right)) / (tangent * camera.aspect),
                Math.abs(corner.dot(up)) / tangent,
              ) *
                1.15,
          )
        }
    // TS_UI의 지도 축척과 미터 단위 차이를 반영하며 대형 지도 전체 보기를 허용하는 거리 범위
    controls.maxDistance = Math.max(5000 / 30, distance * 3)
    controls.target.copy(centre)
    camera.position.copy(centre).addScaledVector(direction, distance)
    controls.update()
    requestRender()
  }
  /** 선택 설비의 외곽에 맞춰 현재 시점 방향을 유지하는 편집 대상 확대 */
  const focusSelected = () => {
    updateSelectionBounds()
    if (selectionBounds.isEmpty()) return
    const center = selectionBounds.getCenter(new THREE.Vector3())
    const radius = selectionBounds.getSize(new THREE.Vector3()).length() / 2
    const angle = Math.atan(
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect),
    )
    const distance = Math.max(controls.minDistance, (radius / Math.sin(angle)) * 1.15)
    const direction = camera.position.clone().sub(controls.target).normalize()
    controls.target.copy(center)
    camera.position.copy(center).addScaledVector(direction, distance)
    controls.update()
    requestRender()
  }
  /**
   * 마우스 버튼과 현재 도구에 맞는 선택 또는 드래그 시작 상태를 기록하는 입력 시작 처리
   *
   * @param e 클릭 또는 드래그 판정에 사용하는 포인터 이벤트
   */
  const pointerDown = (e: PointerEvent) => {
    renderer.domElement.focus()
    if (siteView) return
    downWasSpace = spacePan.active()
    down = { x: e.clientX, y: e.clientY }
    if (
      e.button !== 0 || !e.isPrimary || downWasSpace || placing ||
      toolMode === 'measure' || toolMode === 'attach' || e.pointerType === 'touch'
    ) return
    if (!e.shiftKey && selectedIds.length && models.visible) {
      setPointerRay(e)
      const hit = firstModelHit()
      const id = hit?.instanceId === undefined ? undefined : hit.object.userData.ids[hit.instanceId]
      if (hit && id && selectedIds.includes(id)) {
        const selectedSet = new Set(selectedIds)
        const instances = (facilityDocument?.instances ?? [])
          .filter((item) => selectedSet.has(item.id))
          .map((item) => resolveFacilityInstance(item, mapDocument?.ports ?? []))
        const reference = instances.find((item) => item.id === id)
        if (!reference) return
        moveDrag = {
          id: e.pointerId,
          instances,
          reference,
          start: hit.point,
        }
        renderer.domElement.setPointerCapture(e.pointerId)
        e.stopImmediatePropagation()
        return
      }
    }
    selectionDrag = { id: e.pointerId, additive: e.shiftKey }
    renderer.domElement.setPointerCapture(e.pointerId)
    e.stopImmediatePropagation()
  }

  /** 드래그 범위를 렌더러 안으로 제한한 화면 픽셀 영역 계산 */
  const dragBounds = (e: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect()
    const x0 = THREE.MathUtils.clamp(down.x - rect.left, 0, rect.width)
    const y0 = THREE.MathUtils.clamp(down.y - rect.top, 0, rect.height)
    const x1 = THREE.MathUtils.clamp(e.clientX - rect.left, 0, rect.width)
    const y1 = THREE.MathUtils.clamp(e.clientY - rect.top, 0, rect.height)
    return {
      left: Math.min(x0, x1),
      top: Math.min(y0, y1),
      width: Math.max(1, Math.abs(x1 - x0)),
      height: Math.max(1, Math.abs(y1 - y0)),
      viewport: rect,
    }
  }

  /** 사각형에 해당하는 카메라 시야를 계산해 겹치는 설비 외곽 조회 */
  const selectInArea = (bounds: ReturnType<typeof dragBounds>) => {
    const { left, top, width, height, viewport } = bounds
    if (!models.visible || !viewport.width || !viewport.height) return []
    const sx = viewport.width / width
    const sy = viewport.height / height
    const crop = new THREE.Matrix4().set(
      sx, 0, 0, (viewport.width - 2 * left - width) / width,
      0, sy, 0, (2 * top + height - viewport.height) / height,
      0, 0, 1, 0,
      0, 0, 0, 1,
    )
    camera.updateMatrixWorld()
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      crop.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse),
    )
    return [...instanceBounds]
      .filter(([id, bounds]) =>
        frustum.intersectsBox(bounds) &&
        instanceBindings.get(id)?.some(({ mesh }) =>
          Array.isArray(mesh.material) || mesh.material.opacity > 0,
        ),
      )
      .map(([id]) => id)
  }

  /** 드래그 완료 및 캡처 해제에서 화면의 선택 박스를 정리 */
  const clearMarquee = (event: PointerEvent) => {
    if (event.pointerId !== selectionDrag?.id) return
    selectionDrag = undefined
    marquee.hidden = true
  }
  /** 잡은 객체의 기준점에만 스냅을 적용하고 선택 그룹에 같은 이동량 사용 */
  const updateMoveDrag = (event: PointerEvent, free = event.altKey, preview = true) => {
    const drag = moveDrag
    if (!drag || (!drag.offset && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4)) return
    setPointerRay(event)
    const hit = ray.ray.intersectPlane(new THREE.Plane(plane.normal, -drag.start.z), new THREE.Vector3())
    if (!hit) return
    drag.pointer = event
    const { position } = drag.reference
    const x = position.x + (hit.x - drag.start.x) * 1000
    const y = position.y + (hit.y - drag.start.y) * 1000
    drag.offset = {
      x: (free ? x : snapToStep(x, snapStep)) - position.x,
      y: (free ? y : snapToStep(y, snapStep)) - position.y,
    }
    if (!preview) return
    for (const instance of drag.instances) {
      previewed.add(instance.id)
      updateMatrices({ ...instance, position: offsetPosition(instance, drag.offset), portOffset: undefined })
    }
    requestRender()
  }

  const offsetPosition = (instance: FacilityInstance, offset: FloorPoint): Point3 => ({
    x: instance.position.x + offset.x,
    y: instance.position.y + offset.y,
    z: instance.position.z,
  })

  /** 포인터 위치에 맞춰 드래그와 측정 및 영역 선택의 미리보기 갱신 */
  const pointerMove = (e: PointerEvent) => {
    if (e.pointerId === moveDrag?.id) {
      updateMoveDrag(e)
      return
    }
    if (toolMode === 'measure' && !siteView) {
      measurementPointer = e.buttons ? undefined : e
      requestRender()
    }
    if (toolMode === 'wall' && wallDraft && !siteView) {
      wallPointer = e.buttons ? undefined : e
      requestRender()
    }
    if (e.pointerId !== selectionDrag?.id || Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 4)
      return
    const { left, top, width, height } = dragBounds(e)
    marquee.style.left = `${left}px`
    marquee.style.top = `${top}px`
    marquee.style.width = `${width}px`
    marquee.style.height = `${height}px`
    marquee.hidden = false
  }

  /** 렌더링 중인 모델의 가시 표면 중 포인터에 닿은 첫 교차점 확인 */
  const firstModelHit = () => ray.intersectObjects(meshes).find((item) => {
    const material = (item.object as THREE.InstancedMesh).material
    return Array.isArray(material) || material.opacity > 0
  })

  /** 캔버스의 포인터를 현재 카메라의 광선으로 변환 */
  const setPointerRay = (event: Pick<MouseEvent, 'clientX' | 'clientY'>) => {
    const rect = renderer.domElement.getBoundingClientRect()
    ray.setFromCamera(new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    ), camera)
  }

  /** 현재 광선이 닿은 포트 메시에서 원본 지도 포트 식별자 조회 */
  const pickPortId = (): string | undefined => {
    ground.updateMatrixWorld(true)
    const hit = ray.intersectObjects(portMeshes)[0]
    if (hit?.instanceId !== undefined) return hit.object.userData.portIds[hit.instanceId]
    if (hit?.faceIndex != null) return hit.object.userData.portFaces?.[hit.faceIndex]
  }

  /** 광선과 바닥의 교차점에 현재 격자 설정 또는 자유 배치 적용 */
  const pickFloorPlacement = (free: boolean) => {
    const point = ray.ray.intersectPlane(plane, new THREE.Vector3())
    if (!point) return
    const x = point.x * 1000
    const y = point.y * 1000
    return free ? { x, y } : { x: snapToStep(x, snapStep), y: snapToStep(y, snapStep) }
  }

  /** 미리보기와 확정에서 같은 바닥 좌표와 Shift 축 맞춤 사용 */
  const pickWallPoint = (alignAxis: boolean, free: boolean) => {
    const point = pickFloorPlacement(free)
    if (!point || !alignAxis || !wallDraft) return point
    const { start } = wallDraft
    if (Math.abs(point.x - start.x) >= Math.abs(point.y - start.y)) point.y = start.y
    else point.x = start.x
    return point
  }

  /** 시작점과 포인터 사이의 벽 두께와 방향을 임시 바닥 영역으로 표시 */
  const updateWallPreview = () => {
    const draft = wallDraft
    wallPreview.visible = toolMode === 'wall' && !siteView && !!draft
    if (!wallPreview.visible || !draft) return

    const { start, thickness } = draft
    let end = start
    if (wallPointer && !spacePan.active()) {
      camera.updateMatrixWorld()
      setPointerRay(wallPointer)
      end = pickWallPoint(wallPointer.shiftKey, wallPointer.altKey) ?? start
    }
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    const width = Number.isFinite(thickness) && thickness > 0 ? thickness : 10
    wallPreview.position.set((start.x + end.x) / 2000, (start.y + end.y) / 2000, 0.02)
    wallPreview.rotation.z = Math.atan2(dy, dx)
    wallPreview.scale.set((length || width) / 1000, width / 1000, 0.001)
  }

  /** 카탈로그 드롭 좌표에서 포트 중심 또는 바닥 배치 위치 확인 */
  const pickCatalogPlacement = (event: DragEvent, floorOnly = false) => {
    setPointerRay(event)
    const portId = floorOnly || event.altKey ? undefined : pickPortId()
    const port = mapDocument?.ports.find((item) => item.id === portId)
    return port ? { x: port.x, y: port.y, portId: port.id } : pickFloorPlacement(event.altKey)
  }

  /** 완료되지 않은 객체 몸체 이동을 취소하고 모델을 원위치에 복원 */
  const cancelDirectMove = (event?: PointerEvent) => {
    const drag = moveDrag
    if (!drag || (event && drag.id !== event.pointerId)) return
    moveDrag = undefined
    if (drag.offset) {
      for (const instance of drag.instances) updateMatrices(instance)
      requestRender()
    }
  }

  /** Alt 변경 시 포인터 이동을 기다리지 않고 진행 중인 스냅 적용 상태 갱신 */
  const refreshSnapModifier = (event: KeyboardEvent) => {
    if (event.key !== 'Alt' || event.repeat) return
    const free = event.type === 'keydown'
    const transforming = directTransform.refreshSnap(free)
    if (moveDrag?.pointer) updateMoveDrag(moveDrag.pointer, free)
    if (wallPointer) {
      const { clientX, clientY, shiftKey } = wallPointer
      wallPointer = { clientX, clientY, shiftKey, altKey: free }
      requestRender()
    }
    if (transforming || moveDrag) event.preventDefault()
  }

  /** 객체 바깥쪽 여백에서도 가까운 실루엣이나 노출된 꼭짓점 탐색 */
  const findNearbyMeasureHit = (cursor: THREE.Vector2, viewport: DOMRect, vertexOnly: boolean) => {
    const probe = new THREE.Vector2()
    const horizontal = 16 / viewport.width
    const vertical = 16 / viewport.height
    for (const [dx, dy] of [[horizontal, 0], [-horizontal, 0], [0, vertical], [0, -vertical]]) {
      probe.set(cursor.x + dx!, cursor.y + dy!)
      ray.setFromCamera(probe, camera)
      const hit = firstModelHit()
      if (!hit) continue
      const snapped = snapMeasureHit(hit, camera, viewport, cursor, vertexOnly)
      if (snapped) return snapped
    }
  }

  /** 커서 미리보기와 최종 클릭에서 동일한 표면과 가장자리를 선택 */
  const pickMeasurement = (event: PointerEvent) => {
    const viewport = renderer.domElement.getBoundingClientRect()
    const cursor = new THREE.Vector2(
      ((event.clientX - viewport.left) / viewport.width) * 2 - 1,
      1 - ((event.clientY - viewport.top) / viewport.height) * 2,
    )
    if (Math.abs(cursor.x) > 1 || Math.abs(cursor.y) > 1) return
    camera.updateMatrixWorld()
    ray.setFromCamera(cursor, camera)
    const hit = firstModelHit()
    const fallback = hit?.point ?? ray.ray.intersectPlane(plane, new THREE.Vector3())
    const snap = hit
      ? snapMeasureHit(hit, camera, viewport, cursor, event.shiftKey)
      : findNearbyMeasureHit(cursor, viewport, event.shiftKey)
    const point = snap?.point ?? fallback
    if (!point) return
    return {
      point: { x: point.x * 1000, y: point.y * 1000, z: point.z * 1000 },
      snap,
    }
  }

  /** 확정 점과 현재 포인터를 잇는 선 및 직선거리와 방향각 갱신 */
  const updateMeasurement = () => {
    const hovered = measurementPointer && !spacePan.active()
      ? pickMeasurement(measurementPointer)
      : undefined
    const snap = hovered?.snap
    snapPoint.visible = !!snap
    snapEdge.visible = !!snap?.edge
    if (snap) {
      snapPositions.setXYZ(0, snap.point.x, snap.point.y, snap.point.z)
      snapPositions.needsUpdate = true
      if (snap.edge) {
        for (const [i, vertex] of snap.edge.entries())
          edgePositions.setXYZ(i, vertex.x, vertex.y, vertex.z)
        edgePositions.needsUpdate = true
      }
    }

    const [start, confirmed] = measuredPoints
    const end = confirmed ?? hovered?.point
    const count = !start ? 0 : end ? 2 : 1
    if (start) measurementPositions.setXYZ(0, start.x / 1000, start.y / 1000, start.z / 1000)
    if (start && end) measurementPositions.setXYZ(1, end.x / 1000, end.y / 1000, end.z / 1000)
    measurementPositions.needsUpdate = true
    measurementGeometry.setDrawRange(0, count)
    measurement.visible = count > 0 || !!snap

    if (!start || !end) return
    const dx = end.x - start.x
    const dy = end.y - start.y
    const dz = end.z - start.z
    const horizontal = Math.hypot(dx, dy)
    const heading = (Math.round(THREE.MathUtils.radToDeg(Math.atan2(dy, dx)) * 10) + 3600) % 3600 / 10
    const slope = THREE.MathUtils.radToDeg(Math.atan2(dz, horizontal))
    const headingText = horizontal >= 0.05 ? `${measureFormat.format(heading)}°` : '—'
    const slopeText = `${measureFormat.format(Math.abs(slope) < 0.05 ? 0 : slope)}°`
    const live = confirmed ? 'polite' : 'off'
    if (measurementLabel.getAttribute('aria-live') !== live) measurementLabel.setAttribute('aria-live', live)
    const label = `${measureFormat.format(Math.hypot(horizontal, dz))} mm · 수평 ${headingText} · 수직 ${slopeText}`
    if (measurementLabel.textContent !== label) measurementLabel.textContent = label
  }

  /** 커서가 캔버스를 벗어나면 가장자리 강조와 미확정 선 제거 */
  const clearMeasurementHover = () => {
    if (!measurementPointer) return
    measurementPointer = undefined
    requestRender()
  }
  /** 포인터가 캔버스를 벗어나면 도구별 임시 끝점 제거 */
  const clearDrawingHover = () => {
    clearMeasurementHover()
    if (!wallPointer) return
    wallPointer = undefined
    requestRender()
  }
  /**
   * 드래그 상태와 이동량을 확인하여 화면 이동 또는 클릭과 영역 선택을 확정하는 입력 종료 처리
   *
   * @param e 클릭 또는 드래그 판정에 사용하는 포인터 이벤트
   */
  const pointerUp = (e: PointerEvent) => {
    if (e.pointerId === moveDrag?.id) {
      const drag = moveDrag
      updateMoveDrag(e, e.altKey, false)
      moveDrag = undefined
      const { instances, reference, offset } = drag
      if (!offset) {
        if (instances.length > 1) events.select([reference.id], 'replace')
        return
      }
      const changed = (offset.x !== 0 || offset.y !== 0) && (instances.length > 1
        ? events.moveSelection(offset.x, offset.y)
        : events.move(reference.id, offsetPosition(reference, offset), reference.rotation, reference.scale ?? { x: 1, y: 1, z: 1 }))
      if (!changed) for (const instance of instances) updateMatrices(instance)
      requestRender()
      return
    }
    const drag = e.pointerId === selectionDrag?.id ? selectionDrag : undefined
    clearMarquee(e)
    if (siteView) return
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4
    if (drag && moved && !spacePan.active() && !placing) {
      events.select(selectInArea(dragBounds(e)), drag.additive ? 'add' : 'replace')
      return
    }
    if (
      e.button !== 0 ||
      downWasSpace ||
      spacePan.active() ||
      moved
    )
      return
    if (toolMode === 'measure') {
      measurementPointer = e
      const picked = pickMeasurement(e)
      if (picked) events.measurePoint(picked.point)
      return
    }
    setPointerRay(e)
    if (toolMode === 'port') {
      const id = pickPortId()
      if (id) events.placeAtPort(id)
      return
    }
    if (placing) {
      const point = toolMode === 'wall' ? pickWallPoint(e.shiftKey, e.altKey) : pickFloorPlacement(e.altKey)
      if (point) events.place(point.x, point.y)
      return
    }
    const hit = firstModelHit()
    const id = hit?.instanceId === undefined ? undefined : hit.object.userData.ids[hit.instanceId]
    if (toolMode === 'attach') {
      const point = hit?.point ?? ray.ray.intersectPlane(plane, new THREE.Vector3())
      if (!point) return
      const position = { x: point.x * 1000, y: point.y * 1000, z: point.z * 1000 }
      events.attachOpening(id, position, e.altKey)
      return
    }
    events.select(id ? [id] : [], drag?.additive ? 'toggle' : 'replace')
  }
  /**
   * 이벤트와 관찰자 및 렌더링 버퍼를 해제하고 생성한 화면 요소를 제거하는 렌더러 자원 정리
   */
  const dispose = () => {
    spacePan.dispose()
    wallOverlap.dispose()
    selectionOutline.dispose()
    documentGeneration++
    glbCache.dispose()
    batches.clear()
    instanceBounds.clear()
    cancelAnimationFrame(animationFrame)
    observer.disconnect()
    window.removeEventListener('resize', resizeViewport)
    window.removeEventListener('keydown', refreshSnapModifier)
    window.removeEventListener('keyup', refreshSnapModifier)
    controls.dispose()
    renderer.domElement.removeEventListener('pointerdown', pointerDown, true)
    renderer.domElement.removeEventListener('pointermove', pointerMove, true)
    renderer.domElement.removeEventListener('pointerleave', clearDrawingHover)
    renderer.domElement.removeEventListener('pointerup', pointerUp)
    renderer.domElement.removeEventListener('pointercancel', clearMarquee)
    renderer.domElement.removeEventListener('pointercancel', cancelDirectMove)
    renderer.domElement.removeEventListener('lostpointercapture', clearMarquee)
    renderer.domElement.removeEventListener('lostpointercapture', cancelDirectMove)
    directTransform.dispose()
    marquee.remove()
    firstFloorPoint.remove()
    batchOutline.geometry.dispose()
    batchOutline.material.dispose()
    floorFootprints.geometry.dispose()
    floorFootprints.material.dispose()
    for (const mesh of meshes) disposePlacementMesh(mesh)
    box.dispose()
    cylinder.dispose()
    clearGround()
    floorSurfaces.dispose()
    siteFloor.geometry.dispose()
    siteFloor.material.dispose()
    light.shadow.dispose()
    floorOutline.geometry.dispose()
    floorOutline.material.dispose()
    wallPreview.material.dispose()
    measurementLine.geometry.dispose()
    measurementLine.material.dispose()
    measurementPoints.material.dispose()
    snapEdge.geometry.dispose()
    snapEdge.material.dispose()
    snapPoint.geometry.dispose()
    snapPoint.material.dispose()
    measurementLabel.remove()
    labels.remove()
    floorPlanGeneration++
    floorPlan.geometry.dispose()
    floorPlan.material.map?.dispose()
    floorPlan.material.dispose()
    grid.geometry.dispose()
    grid.material.dispose()
    minorGrid.geometry.dispose()
    minorGrid.material.dispose()
    reflections.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }
  scene.background = new THREE.Color(0x101c27)
  camera.up.set(0, 0, 1)
  camera.position.set(10, -15, 12)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.domElement.setAttribute(
    'aria-label',
    '3D 시설 설계: 왼쪽 드래그 영역 선택, Shift 클릭 선택 추가 또는 해제, 오른쪽 드래그 회전, Space와 왼쪽 드래그 화면 이동, 휠 확대',
  )
  renderer.domElement.tabIndex = 0
  host.append(renderer.domElement)
  labels.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
  host.append(labels)
  host.append(marquee)
  host.append(firstFloorPoint)
  host.append(measurementLabel)
  firstFloorPoint.addEventListener('click', () => {
    callbacks.finishFloor()
    renderer.domElement.focus()
  })
  controls = new OrbitControls(camera, renderer.domElement)
  // TS_UI의 바닥 기준 패닝과 지면 아래로 내려가지 않는 회전 범위를 Z 높이 좌표에 적용하는 카메라 제어
  controls.enableRotate = true
  controls.enablePan = true
  controls.enableZoom = true
  controls.enableDamping = false
  controls.screenSpacePanning = false
  controls.minDistance = 100 / 30
  controls.maxDistance = 5000 / 30
  controls.zoomSpeed = 2
  controls.minPolarAngle = 0
  controls.maxPolarAngle = Math.PI / 2.2
  controls.mouseButtons.LEFT = null
  controls.mouseButtons.MIDDLE = null
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE
  controls.addEventListener('change', requestRender)
  const spacePan = createSpacePan((pressed) => {
    controls.mouseButtons.LEFT = pressed ? THREE.MOUSE.PAN : null
    renderer.domElement.style.cursor = pressed
      ? 'grab'
      : (placing || toolMode === 'attach' || toolMode === 'measure') && !siteView ? 'crosshair' : 'default'
    if (pressed) clearDrawingHover()
    if (pressed) {
      cancelDirectMove()
      directTransform.cancel()
    }
    requestRender()
  })
  // 바닥 영역 위에 격자를 합성하고 노드와 경로 및 포트의 표시 순서는 유지
  grid.renderOrder = -150
  minorGrid.renderOrder = grid.renderOrder - 1
  // 중심선을 포함해 모든 격자선에 지도 테마의 동일한 색상을 적용
  grid.material.vertexColors = false
  grid.material.depthWrite = false
  grid.geometry.rotateX(Math.PI / 2)
  grid.add(minorGrid)
  light.position.set(10, -20, 40)
  scene.add(
    models,
    fixtures.group,
    batchOutline,
    floorFootprints,
    ground,
    siteFloor,
    floorSurfaces.group,
    floorOutline,
    wallPreview,
    measurement,
    floorPlan,
    grid,
    fill,
    light,
    light.target,
  )
  renderer.domElement.addEventListener('pointerdown', pointerDown, true)
  renderer.domElement.addEventListener('pointermove', pointerMove, true)
  renderer.domElement.addEventListener('pointerleave', clearDrawingHover)
  renderer.domElement.addEventListener('pointerup', pointerUp)
  renderer.domElement.addEventListener('pointercancel', clearMarquee)
  renderer.domElement.addEventListener('pointercancel', cancelDirectMove)
  renderer.domElement.addEventListener('lostpointercapture', clearMarquee)
  renderer.domElement.addEventListener('lostpointercapture', cancelDirectMove)
  observer = new ResizeObserver(() => resizeViewport())
  observer.observe(host)
  window.addEventListener('resize', resizeViewport)
  window.addEventListener('keydown', refreshSnapModifier)
  window.addEventListener('keyup', refreshSnapModifier)
  resizeViewport()
  return {
    setMap: setMap,
    /** 지정 중이거나 목록에서 선택한 바닥 경계를 지도 위에 표시 */
    setFloorOutline: (points: FloorPoint[], closed = false, polygonDraft = false) => {
      const outline = closed && points.length ? [...points, points[0]!] : points
      floorStartPoint = polygonDraft ? points[0] : undefined
      firstFloorPoint.disabled = points.length < 3
      const label = firstFloorPoint.disabled ? '다각형 시작점' : '첫 점에 연결해 바닥 적용'
      firstFloorPoint.setAttribute('aria-label', label)
      firstFloorPoint.title = label
      floorOutline.geometry.dispose()
      floorOutline.geometry = new THREE.BufferGeometry().setFromPoints(
        outline.map((p) => new THREE.Vector3(p.x / 1000, p.y / 1000, 0.02)),
      )
      floorOutline.visible = !siteView && outline.length > 1
      requestRender()
    },
    /** 3D 편집 화면에서 도면 배경의 표시 상태를 독립적으로 설정 */
    setFloorPlanVisible: (visible?: boolean) => {
      floorPlanVisible = visible
      updateFloorPlan()
      requestRender()
    },
    /** 현재 벽 그리기의 시작점과 미리보기 두께 갱신 */
    setWallDraft: (start: FloorPoint | undefined, thickness: number) => {
      wallDraft = start ? { start, thickness } : undefined
      if (!start) wallPointer = undefined
      requestRender()
    },
    setDocument: setDocument,
    /** 줄자 시작점과 끝점 및 직선거리를 화면에 표시 */
    setMeasurement: (points: Point3[]) => {
      measuredPoints = points
      requestRender()
    },
    setSitePreview,
    /** 배치 기준 간격과 보조 격자를 같은 밀리미터 단위로 변경 */
    setSnapStep: (step: TransformSnapStep) => {
      snapStep = step
      minorGrid.material.uniforms.stepMeters!.value = step / 1000
      minorGrid.material.uniforms.cellsPerMajor!.value = (gridSize / gridDivisions) * 1000 / step
      requestRender()
    },
    pickCatalogPlacement,
    cancelDirectMove,
    setSelected: setSelected,
    setTool: setTool,
    fit: fit,
    focusSelected,
    dispose: dispose,
  }
}
