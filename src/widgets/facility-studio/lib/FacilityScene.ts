/**
 * 파일명: FacilityScene.ts
 * 설명: 기준 지도와 설비 모델 및 포트 선택과 변환 핸들을 관리하는 렌더러
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { createMapLabels, paintMapLabel } from '@/entities/map/index.ts'
import { createSpacePan } from '@/shared/lib/input/index.ts'
import * as THREE from 'three'
import { GlbModelCache } from '@bem/map3d/glb'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { FacilityAsset, FacilityDocument, FacilityInstance, FacilityPart } from '@/entities/facility/index.ts'
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
import { FACILITY_CYLINDER_SEGMENTS, facilityPartMatrix } from '@/entities/facility/index.ts'
import { instanceParts, surfaceForPart, surfaceMaterials, wallBody, wallDoorLimits } from '@/entities/facility/index.ts'
import { getWallOverlapPass } from '@/widgets/facility-studio/lib/wallOverlapPass.ts'
import { createFloorSurfaces } from '@/widgets/facility-studio/lib/floorSurfaces.ts'
import type { FloorPoint } from '@/entities/facility/index.ts'
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
  const room = new RoomEnvironment()
  const environmentGenerator = new THREE.PMREMGenerator(renderer)
  const reflections = environmentGenerator.fromScene(room, 0.06)
  room.dispose()
  environmentGenerator.dispose()
  scene.environment = reflections.texture
  scene.environmentIntensity = 0.55
  let controls: OrbitControls
  let transform: TransformControls
  let proxy = new THREE.Object3D()
  let models = new THREE.Group()
  const selectionBounds = new THREE.Box3()
  const selection = new THREE.Box3Helper(selectionBounds, 0x57d4be)
  selection.visible = false
  for (const material of Array.isArray(selection.material)
    ? selection.material
    : [selection.material]) {
    material.depthTest = false
    material.transparent = true
    material.opacity = 0.75
  }
  selection.renderOrder = 10
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
  const marquee = document.createElement('div')
  marquee.className = 'facility-marquee'
  marquee.hidden = true
  let ground = new THREE.Group()
  const floorSurfaces = createFloorSurfaces(0.001)
  const floorOutline = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x25cfbb, depthWrite: false }),
  )
  floorOutline.visible = false
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
  floorPlan.visible = false
  floorPlan.renderOrder = -180
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
  let grid = new THREE.GridHelper(500, 100, 0x304d5a, 0x1e313d)
  let box = new THREE.BoxGeometry(1, 1, 1)
  let cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, FACILITY_CYLINDER_SEGMENTS)
  let observer: ResizeObserver
  let meshes: THREE.InstancedMesh[] = []
  const batches = new Map<string, {
    asset: FacilityAsset
    instances: FacilityInstance[]
    meshes: THREE.InstancedMesh[]
    source?: THREE.Group
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
  let placing = false
  let toolMode: 'select' | 'place' | 'port' | 'translate' | 'rotate' | 'scale' = 'select'
  let animationFrame = 0
  let down = { x: 0, y: 0 }
  let downGizmo = false
  let selectionDrag: { id: number; additive: boolean } | undefined
  let downWasSpace = false
  let uniformScaleStart: THREE.Vector3 | undefined
  let uniformScaleRatio = 1
  const resizeMinimum = new THREE.Vector3()
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
      wallOverlap.render(scene, camera)
      drawLabels()
      drawFloorStart()
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
      floorPlan.visible = (floorPlanVisible ?? layout.visible) && !!floorPlan.material.map
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
      floorPlan.visible = floorPlanVisible ?? !!mapDocument?.layout?.visible
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
    scene.background = new THREE.Color(theme.background)
    for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
      material.vertexColors = false
      material.color.set(theme.grid)
      material.needsUpdate = true
    }
    if (geometryChanged) {
      clearGround()
      const topology = createMapTopology(map, theme)
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
    grid.visible = layers.grid
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
    if (!mapDocument || !visibleLayers.labels) return
    let occluders: THREE.Box3[] | undefined
    const projection = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))
    for (const label of mapLabels) {
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
    const register = (
      mesh: THREE.InstancedMesh,
      bindings: { instance: FacilityInstance; part?: FacilityPart; local?: THREE.Matrix4 }[],
    ) => {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
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
      source.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity)
        mesh.count = instances.length
        mesh.userData.sharedGlb = true
        const local = scale.clone().multiply(part.matrixWorld)
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
    batches.set(asset.id, { asset, instances, meshes: batchMeshes, source })
  }

  /** 기존 모델의 캐시를 보존하며 문서에서 바뀐 형상 또는 변환만 반영 */
  const setDocument = async (doc: FacilityDocument) => {
    requestedDocument = doc
    const generation = ++documentGeneration
    const ports = mapDocument?.ports ?? emptyPorts
    const instancesByAsset = new Map<string, FacilityInstance[]>()
    const sources = new Map<string, THREE.Group>()
    let changes: { asset: FacilityAsset; instances: FacilityInstance[]; rebuild: boolean }[]
    try {
      for (const instance of doc.instances) {
        resolveFacilityInstance(instance, ports)
        const items = instancesByAsset.get(instance.assetId) ?? []
        items.push(instance)
        instancesByAsset.set(instance.assetId, items)
      }
      changes = doc.assets.flatMap((asset) => {
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
        selection.visible = false
        batchOutline.visible = false
        transform.detach()
        transform.getHelper().visible = false
        requestRender()
      }
      events.error(error instanceof Error ? error.message : String(error))
      return
    }
    if (generation !== documentGeneration) return

    const rebuilt = new Set(changes.filter((change) => change.rebuild).map(({ asset }) => asset.id))
    for (const [id, batch] of batches) {
      if (instancesByAsset.has(id) && !rebuilt.has(id))
        continue
      for (const mesh of batch.meshes) {
        wallOverlap.setWall(mesh, false)
        mesh.removeFromParent()
        mesh.dispose()
        if (!mesh.userData.sharedGlb) (mesh.material as THREE.Material).dispose()
      }
      for (const { id: instanceId } of batch.instances) {
        instanceBindings.delete(instanceId)
        instanceBounds.delete(instanceId)
        seeThroughInstances.delete(instanceId)
      }
      batches.delete(id)
    }

    const libraryChanged = facilityDocument?.assets !== doc.assets
    facilityDocument = doc
    models.visible = true
    floorSurfaces.setAreas(doc.floors)
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
    if (libraryChanged) glbCache.retain(doc.assets)
    setSelected(selectedIds)
  }
  /**
   * 포트 위치와 모델 및 부품 회전을 합성하여 인스턴스 변환 행렬을 갱신하는 설비 위치 반영
   * 이전 경계 캐시를 비워 이동 이후의 가시성 판정을 올바르게 유지하는 공간 정보 초기화
   *
   * @param instance 모델 참조와 위치 및 포트 연결을 포함하는 개별 설비 배치
   */
  const updateMatrices = (instance: FacilityInstance, partial = true) => {
    instance = resolveFacilityInstance(instance, mapDocument?.ports ?? [])
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      THREE.MathUtils.degToRad(instance.rotation),
    )
    const root = new THREE.Matrix4().compose(
      new THREE.Vector3(
        instance.position.x / 1000,
        instance.position.y / 1000,
        instance.position.z / 1000,
      ),
      rotation,
      new THREE.Vector3(instance.scale?.x ?? 1, instance.scale?.y ?? 1, instance.scale?.z ?? 1),
    )
    const matrix = new THREE.Matrix4()
    for (const { mesh, index, local } of instanceBindings.get(instance.id) ?? []) {
      mesh.setMatrixAt(index, matrix.multiplyMatrices(root, local))
      if (partial) mesh.instanceMatrix.addUpdateRange(index * 16, 16)
      mesh.instanceMatrix.needsUpdate = true
      // 이동한 설비가 이전 경계 영역 밖에 배치될 수 있으므로 가시성 경계를 다시 계산하는 캐시 초기화
      mesh.boundingSphere = null
      mesh.boundingBox = null
    }
    updateInstanceBounds(instance.id)
    if (instance.id === selectedId) updateSelectionBounds()
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
  /** 선택 설비의 부품 경계 캐시를 사용하는 선택 외곽 갱신 */
  const updateSelectionBounds = () => {
    selectionBounds.makeEmpty()
    const points: number[] = []
    for (const id of selectedIds) {
      const bounds = instanceBounds.get(id)
      if (!bounds) continue
      selectionBounds.union(bounds)
      if (selectedIds.length < 2) continue
      const { min, max } = bounds
      const corners = [
        [min.x, min.y, min.z], [max.x, min.y, min.z], [max.x, max.y, min.z], [min.x, max.y, min.z],
        [min.x, min.y, max.z], [max.x, min.y, max.z], [max.x, max.y, max.z], [min.x, max.y, max.z],
      ]
      for (const index of [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7])
        points.push(...corners[index]!)
    }
    selection.visible = selectedIds.length === 1 && !selectionBounds.isEmpty()
    batchOutline.visible = points.length > 0
    if (points.length) {
      batchOutline.geometry.dispose()
      batchOutline.geometry = new THREE.BufferGeometry()
      batchOutline.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    }
  }
  /**
   * 현재 선택 대상과 강조 표시 또는 이동 핸들을 갱신하는 렌더러 선택 반영
   *
   * @param ids 선택된 설비 식별자 목록
   */
  const setSelected = (ids: string[]) => {
    selectedIds = ids
    selectedId = ids.length === 1 ? ids[0]! : null
    transform.detach()
    const source = facilityDocument?.instances.find((i) => i.id === selectedId)
    const instance = source ? resolveFacilityInstance(source, mapDocument?.ports ?? []) : undefined
    if (instance) {
      proxy.position.set(
        instance.position.x / 1000,
        instance.position.y / 1000,
        instance.position.z / 1000,
      )
      proxy.rotation.set(0, 0, THREE.MathUtils.degToRad(instance.rotation))
      proxy.scale.set(instance.scale?.x ?? 1, instance.scale?.y ?? 1, instance.scale?.z ?? 1)
      transform.attach(proxy)
    }
    transform.getHelper().visible =
      !!instance && (toolMode === 'translate' || toolMode === 'rotate' || toolMode === 'scale')
    updateSelectionBounds()
    requestRender()
  }
  /**
   * 현재 도구에 맞춰 커서와 이동 및 회전 핸들의 활성 상태를 바꾸는 조작 모드 전환
   *
   * @param tool 현재 활성화할 선택 또는 배치 및 이동 도구
   */
  const setTool = (tool: 'select' | 'place' | 'port' | 'translate' | 'rotate' | 'scale') => {
    toolMode = tool
    placing = tool === 'place' || tool === 'port'
    transform.enabled =
      !spacePan.active() && (tool === 'translate' || tool === 'rotate' || tool === 'scale')
    transform.getHelper().visible = !!selectedId && transform.enabled
    transform.setMode(tool === 'rotate' ? 'rotate' : tool === 'scale' ? 'scale' : 'translate')
    transform.setSpace(tool === 'scale' ? 'local' : 'world')
    transform.showX = tool !== 'rotate'
    transform.showY = tool !== 'rotate'
    transform.showZ = true
    renderer.domElement.style.cursor = spacePan.active()
      ? 'grab'
      : placing
        ? 'crosshair'
        : 'default'
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
    downWasSpace = spacePan.active()
    down = { x: e.clientX, y: e.clientY }
    downGizmo = transform.enabled && transform.axis !== null && !e.shiftKey
    if (e.button !== 0 || !e.isPrimary || downWasSpace || downGizmo || placing || e.pointerType === 'touch') return
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
  /** 중앙 크기 핸들의 시작점 특이점을 방지하는 화면 이동량 기반 균등 배율 계산 */
  const pointerMove = (e: PointerEvent) => {
    if (uniformScaleStart)
      uniformScaleRatio = Math.exp(
        THREE.MathUtils.clamp((e.clientX - down.x - (e.clientY - down.y)) / 180, -8, 8),
      )
    if (e.pointerId !== selectionDrag?.id || Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 4)
      return
    const { left, top, width, height } = dragBounds(e)
    marquee.style.left = `${left}px`
    marquee.style.top = `${top}px`
    marquee.style.width = `${width}px`
    marquee.style.height = `${height}px`
    marquee.hidden = false
  }
  /**
   * 드래그 상태와 이동량을 확인하여 화면 이동 또는 클릭과 영역 선택을 확정하는 입력 종료 처리
   *
   * @param e 클릭 또는 드래그 판정에 사용하는 포인터 이벤트
   */
  const pointerUp = (e: PointerEvent) => {
    const drag = e.pointerId === selectionDrag?.id ? selectionDrag : undefined
    clearMarquee(e)
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4
    if (drag && moved && !spacePan.active() && !placing) {
      events.select(selectInArea(dragBounds(e)), drag.additive ? 'add' : 'replace')
      return
    }
    if (
      e.button !== 0 ||
      downWasSpace ||
      spacePan.active() ||
      downGizmo ||
      transform.dragging ||
      moved
    )
      return
    const rect = renderer.domElement.getBoundingClientRect()
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((e.clientY - rect.top) / rect.height) * 2,
      ),
      camera,
    )
    if (toolMode === 'port') {
      ground.updateMatrixWorld(true)
      const hit = ray.intersectObjects(portMeshes)[0]
      const id =
        hit?.instanceId !== undefined
          ? hit.object.userData.portIds[hit.instanceId]
          : hit?.faceIndex != null
            ? hit.object.userData.portFaces?.[hit.faceIndex]
            : undefined
      if (id) events.placeAtPort(id)
      return
    }
    if (placing) {
      const p = ray.ray.intersectPlane(plane, new THREE.Vector3())
      if (p) events.place(Math.round(p.x * 100) * 10, Math.round(p.y * 100) * 10)
      return
    }
    const hit = ray.intersectObjects(meshes).find((item) => {
      const material = (item.object as THREE.InstancedMesh).material
      return Array.isArray(material) || material.opacity > 0
    })
    const id = hit?.instanceId === undefined ? undefined : hit.object.userData.ids[hit.instanceId]
    events.select(id ? [id] : [], drag?.additive ? 'toggle' : 'replace')
  }
  /**
   * 이벤트와 관찰자 및 렌더링 버퍼를 해제하고 생성한 화면 요소를 제거하는 렌더러 자원 정리
   */
  const dispose = () => {
    spacePan.dispose()
    wallOverlap.dispose()
    documentGeneration++
    glbCache.dispose()
    batches.clear()
    instanceBounds.clear()
    cancelAnimationFrame(animationFrame)
    observer.disconnect()
    window.removeEventListener('resize', resizeViewport)
    controls.dispose()
    transform.dispose()
    renderer.domElement.removeEventListener('pointerdown', pointerDown, true)
    renderer.domElement.removeEventListener('pointermove', pointerMove, true)
    renderer.domElement.removeEventListener('pointerup', pointerUp)
    renderer.domElement.removeEventListener('pointercancel', clearMarquee)
    renderer.domElement.removeEventListener('lostpointercapture', clearMarquee)
    marquee.remove()
    firstFloorPoint.remove()
    batchOutline.geometry.dispose()
    batchOutline.material.dispose()
    for (const mesh of meshes) {
      mesh.dispose()
      if (!mesh.userData.sharedGlb) (mesh.material as THREE.Material).dispose()
    }
    box.dispose()
    selection.geometry.dispose()
    for (const material of Array.isArray(selection.material)
      ? selection.material
      : [selection.material])
      material.dispose()
    cylinder.dispose()
    clearGround()
    floorSurfaces.dispose()
    floorOutline.geometry.dispose()
    floorOutline.material.dispose()
    labels.remove()
    floorPlanGeneration++
    floorPlan.geometry.dispose()
    floorPlan.material.map?.dispose()
    floorPlan.material.dispose()
    grid.geometry.dispose()
    for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
      if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose()
      material.dispose()
    }
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
    transform.enabled =
      !pressed && (toolMode === 'translate' || toolMode === 'rotate' || toolMode === 'scale')
    renderer.domElement.style.cursor = pressed ? 'grab' : placing ? 'crosshair' : 'default'
  })
  transform = new TransformControls(camera, renderer.domElement)
  transform.setSize(0.85)
  transform.setTranslationSnap(0.01)
  transform.setRotationSnap(Math.PI / 12)
  transform.addEventListener('dragging-changed', (event) => {
    controls.enabled = !event.value
    if (event.value) {
      uniformScaleStart =
        transform.mode === 'scale' && transform.axis === 'XYZ' ? proxy.scale.clone() : undefined
      uniformScaleRatio = 1
      resizeMinimum.setScalar(0.001)
      if (transform.mode === 'scale') {
        const instance = facilityDocument?.instances.find((item) => item.id === selectedId)
        const doors = instance?.wallDoors
        if (instance && doors?.length) {
          const wall = wallBody(facilityDocument?.assets.find((asset) => asset.id === instance.assetId))
          if (wall) {
            const limits = wallDoorLimits(doors)
            // 부착한 문의 상대 위치와 실제 치수를 유지하는 벽 크기 제한
            resizeMinimum.x = Math.max(resizeMinimum.x, limits.width / wall.size.x)
            resizeMinimum.z = Math.max(resizeMinimum.z, limits.height / wall.size.z)
          }
        }
      }
    }
    if (!event.value && selectedId) {
      const applied = events.move(
        selectedId,
        {
          x: Math.round(proxy.position.x * 1000),
          y: Math.round(proxy.position.y * 1000),
          z: Math.round(proxy.position.z * 1000),
        },
        THREE.MathUtils.radToDeg(proxy.rotation.z),
        { x: proxy.scale.x, y: proxy.scale.y, z: proxy.scale.z },
      )
      if (!applied) {
        const instance = facilityDocument?.instances.find((item) => item.id === selectedId)
        if (instance) updateMatrices(instance)
        setSelected(selectedIds)
      }
    }
    if (!event.value) uniformScaleStart = undefined
  })
  transform.addEventListener('objectChange', () => {
    if (uniformScaleStart) {
      const minimumRatio = Math.max(
        resizeMinimum.x / uniformScaleStart.x,
        resizeMinimum.y / uniformScaleStart.y,
        resizeMinimum.z / uniformScaleStart.z,
      )
      proxy.scale.copy(uniformScaleStart).multiplyScalar(Math.max(minimumRatio, uniformScaleRatio))
    }
    proxy.scale.clampScalar(0.001, 1000).max(resizeMinimum)
    if (selectedId) {
      previewed.add(selectedId)
      updateMatrices({
        ...facilityDocument!.instances.find((i) => i.id === selectedId)!,
        portOffset: undefined,
        position: {
          x: proxy.position.x * 1000,
          y: proxy.position.y * 1000,
          z: proxy.position.z * 1000,
        },
        rotation: THREE.MathUtils.radToDeg(proxy.rotation.z),
        scale: { x: proxy.scale.x, y: proxy.scale.y, z: proxy.scale.z },
      })
    }
    requestRender()
  })
  grid.renderOrder = -200
  for (const material of Array.isArray(grid.material) ? grid.material : [grid.material])
    material.depthWrite = false
  grid.rotation.x = Math.PI / 2
  const light = new THREE.DirectionalLight(0xffffff, 2.5)
  light.position.set(10, -20, 40)
  scene.add(
    models,
    selection,
    batchOutline,
    ground,
    floorSurfaces.group,
    floorOutline,
    floorPlan,
    grid,
    proxy,
    transform.getHelper(),
    new THREE.AmbientLight(0xffffff, 1.5),
    light,
  )
  renderer.domElement.addEventListener('pointerdown', pointerDown, true)
  renderer.domElement.addEventListener('pointermove', pointerMove, true)
  renderer.domElement.addEventListener('pointerup', pointerUp)
  renderer.domElement.addEventListener('pointercancel', clearMarquee)
  renderer.domElement.addEventListener('lostpointercapture', clearMarquee)
  observer = new ResizeObserver(() => resizeViewport())
  observer.observe(host)
  window.addEventListener('resize', resizeViewport)
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
      floorOutline.visible = outline.length > 1
      requestRender()
    },
    /** 3D 편집 화면에서 도면 배경의 표시 상태를 독립적으로 설정 */
    setFloorPlanVisible: (visible?: boolean) => {
      floorPlanVisible = visible
      updateFloorPlan()
      requestRender()
    },
    /** 선택 도구를 전환하지 않고 배치 크기를 미리 표시하거나 원래 크기를 복원 */
    previewScale: (id: string, scale?: FacilityInstance['scale']) => {
      const instance = facilityDocument?.instances.find((item) => item.id === id)
      if (!instance) return
      previewed.add(id)
      updateMatrices(scale ? { ...instance, scale } : instance)
      requestRender()
    },
    setDocument: setDocument,
    setSelected: setSelected,
    setTool: setTool,
    fit: fit,
    focusSelected,
    dispose: dispose,
  }
}
