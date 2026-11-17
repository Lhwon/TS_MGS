/**
 * 파일명: FacilityScene.ts
 * 설명: 기준 지도와 설비 모델 및 포트 선택과 변환 핸들을 관리하는 렌더러
 * 작성자: 이희원
 * 작성일자: 2026-10-20
 */
import { createMapLabels, paintMapLabel } from '@/entities/map/index.ts'
import { createSpacePan } from '@/shared/lib/input/index.ts'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { FacilityDocument, FacilityInstance, FacilityPart } from '@/entities/facility/index.ts'
import { resolveFacilityInstance } from '@/entities/facility/index.ts'
import { createMapTopology, DEFAULT_LAYERS, type Layers, mgsTheme } from '@/entities/map/index.ts'
import type { MapDocument } from '@/entities/map/index.ts'
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
    select(id: string | null): void
    place(x: number, y: number): void
    placeAtPort(id: string): void
    move(
      id: string,
      position: {
        x: number
        y: number
        z: number
      },
      rotation: number,
    ): void
  },
) => {
  const viewportHost = host
  const events = callbacks
  let scene = new THREE.Scene()
  let camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000000)
  let renderer = new THREE.WebGLRenderer({ antialias: true })
  let controls: OrbitControls
  let transform: TransformControls
  let proxy = new THREE.Object3D()
  let models = new THREE.Group()
  let ground = new THREE.Group()
  let mapDocument: MapDocument | undefined = undefined
  let portMeshes: THREE.Object3D[] = []
  let labels = document.createElement('canvas')
  let visibleLayers: Layers = { ...DEFAULT_LAYERS }
  let mapTheme = mgsTheme()
  let grid = new THREE.GridHelper(500, 100, 0x304d5a, 0x1e313d)
  let box = new THREE.BoxGeometry(1, 1, 1)
  let cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 24)
  let observer: ResizeObserver
  let meshes: THREE.InstancedMesh[] = []
  let instanceBindings = new Map<
    string,
    {
      mesh: THREE.InstancedMesh
      index: number
      part: FacilityPart
    }[]
  >()
  let facilityDocument: FacilityDocument | undefined
  let selectedId: string | null = null
  let placing = false
  let toolMode: 'select' | 'place' | 'port' | 'translate' | 'rotate' = 'select'
  let animationFrame = 0
  let down = { x: 0, y: 0 }
  let downGizmo = false
  let downWasSpace = false
  let ray = new THREE.Raycaster()
  let plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  /**
   * 컨테이너 크기에 맞게 렌더러와 카메라 투영 범위를 갱신하는 화면 크기 반영
   */
  const resizeViewport = () => {
    const w = Math.max(1, viewportHost.clientWidth),
      h = Math.max(1, viewportHost.clientHeight)
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    requestRender()
  }
  /**
   * 중복 프레임 예약을 합치고 도형과 라벨을 함께 그리는 화면 갱신 예약
   */
  const requestRender = () => {
    if (animationFrame) return
    animationFrame = requestAnimationFrame(() => {
      animationFrame = 0
      renderer.render(scene, camera)
      drawLabels()
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
  /**
   * 평면 지도 도형을 동일 좌표의 바닥으로 구성하고 표시 옵션을 적용하는 기준 맵 갱신
   *
   * @param map 기준 노드와 경로 및 포트를 포함하는 지도 문서
   * @param theme 원본 지도 색상과 크기 및 선 두께 설정
   * @param layers 지도 객체별 표시 여부와 라벨 표시 옵션
   */
  const setMap = (map: MapDocument, theme = mgsTheme(), layers: Layers = DEFAULT_LAYERS) => {
    mapDocument = map
    visibleLayers = layers
    mapTheme = theme
    scene.background = new THREE.Color(theme.background)
    for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
      material.vertexColors = false
      material.color.set(theme.grid)
      material.needsUpdate = true
    }
    clearGround()
    const topology = createMapTopology(map, theme)
    // 원본의 높이 값을 실제 설비 높이가 아닌 평면 도형 겹침 순서로 해석하는 바닥 변환
    ground.scale.set(0.001, 0.001, 0.000001)
    ground.add(...[...topology.group.children])
    topology.nodeMesh.visible = layers.nodes
    topology.portMesh.visible = layers.ports
    for (const object of ground.children) {
      if (['edges', 'arrows'].includes(object.name)) object.visible = layers.edges
      if (object.name === 'node-borders') object.visible = layers.nodes
      if (object.name === 'ports') object.visible = layers.ports
    }
    portMeshes = ground.children.filter(
      (o) => o.visible && (o.userData.portIds || o.userData.portFaces),
    )
    grid.visible = layers.grid
    if (facilityDocument) setDocument(facilityDocument)
    requestRender()
  }
  /**
   * 현재 카메라 투영과 표시 옵션을 사용하여 화면 라벨을 겹쳐 그리는 텍스트 렌더링
   */
  const drawLabels = () => {
    const width = viewportHost.clientWidth,
      height = viewportHost.clientHeight
    labels.width = width
    labels.height = height
    const ctx = labels.getContext('2d')
    if (!ctx || !mapDocument || !visibleLayers.labels) return
    for (const label of createMapLabels(mapDocument, visibleLayers, mapTheme)) {
      const p = new THREE.Vector3(label.x / 1000, label.y / 1000, 0.003).project(camera)
      if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) continue
      const world = new THREE.Vector3(label.x / 1000, label.y / 1000, 0).applyMatrix4(
        camera.matrixWorldInverse,
      )
      const size =
        ((label.size / 1000) * height) /
        (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(0.001, -world.z))
      paintMapLabel(ctx, label, ((p.x + 1) * width) / 2, ((1 - p.y) * height) / 2, size)
    }
  }

  /**
   * 모든 포트 연결을 확인한 뒤 설비 부품을 재질과 도형별 인스턴스로 구성하는 설계 문서 교체
   * 누락 포트가 있는 경우 잘못된 배치를 숨기고 오류를 전달하는 렌더링 보호
   *
   * @param doc 모델과 배치 및 기준 맵 정보를 포함하는 설계 문서
   */
  const setDocument = (doc: FacilityDocument) => {
    try {
      for (const instance of doc.instances)
        resolveFacilityInstance(instance, mapDocument?.ports ?? [])
    } catch (error) {
      models.visible = false
      transform.detach()
      transform.getHelper().visible = false
      requestRender()
      throw error
    }
    models.visible = true
    facilityDocument = doc
    transform.detach()
    for (const mesh of meshes) {
      mesh.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    meshes = []
    models.clear()
    instanceBindings.clear()
    const assets = new Map(doc.assets.map((a) => [a.id, a]))
    const groups = new Map<
      string,
      {
        instance: FacilityInstance
        part: FacilityPart
      }[]
    >()
    for (const instance of doc.instances)
      for (const part of assets.get(instance.assetId)!.parts) {
        const key = `${part.shape}:${part.color}`
        const list = groups.get(key) ?? []
        list.push({ instance, part })
        groups.set(key, list)
      }
    for (const list of groups.values()) {
      const first = list[0]!
      const mesh = new THREE.InstancedMesh(
        first.part.shape === 'box' ? box : cylinder,
        new THREE.MeshStandardMaterial({
          color: first.part.color,
          roughness: 0.65,
          metalness: 0.2,
        }),
        list.length,
      )
      mesh.userData.ids = list.map((item) => item.instance.id)
      list.forEach(({ instance, part }, index) => {
        const bindings = instanceBindings.get(instance.id) ?? []
        bindings.push({ mesh, index, part })
        instanceBindings.set(instance.id, bindings)
      })
      models.add(mesh)
      meshes.push(mesh)
    }
    for (const instance of doc.instances) updateMatrices(instance)
    setSelected(selectedId)
    requestRender()
  }
  /**
   * 포트 위치와 모델 및 부품 회전을 합성하여 인스턴스 변환 행렬을 갱신하는 설비 위치 반영
   * 이전 경계 캐시를 비워 이동 이후의 가시성 판정을 올바르게 유지하는 공간 정보 초기화
   *
   * @param instance 모델 참조와 위치 및 포트 연결을 포함하는 개별 설비 배치
   */
  const updateMatrices = (instance: FacilityInstance) => {
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
      new THREE.Vector3(1, 1, 1),
    )
    for (const { mesh, index, part } of instanceBindings.get(instance.id) ?? []) {
      const q = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        THREE.MathUtils.degToRad(part.rotation),
      )
      q.multiply(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            THREE.MathUtils.degToRad(part.tiltX ?? 0),
            THREE.MathUtils.degToRad(part.tiltY ?? 0),
            0,
          ),
        ),
      )
      if (part.shape === 'cylinder')
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))
      const scale =
        part.shape === 'box'
          ? new THREE.Vector3(part.size.x, part.size.y, part.size.z)
          : new THREE.Vector3(part.size.x, part.size.z, part.size.y)
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(part.position.x / 1000, part.position.y / 1000, part.position.z / 1000),
        q,
        scale.multiplyScalar(0.001),
      )
      mesh.setMatrixAt(index, new THREE.Matrix4().multiplyMatrices(root, local))
      mesh.instanceMatrix.needsUpdate = true
      // 이동한 설비가 이전 경계 영역 밖에 배치될 수 있으므로 가시성 경계를 다시 계산하는 캐시 초기화
      mesh.boundingSphere = null
      mesh.boundingBox = null
    }
  }
  /**
   * 현재 선택 대상과 강조 표시 또는 이동 핸들을 갱신하는 렌더러 선택 반영
   *
   * @param id 조회하거나 편집할 대상의 고유 식별자
   */
  const setSelected = (id: string | null) => {
    selectedId = id
    transform.detach()
    const source = facilityDocument?.instances.find((i) => i.id === id)
    const instance = source ? resolveFacilityInstance(source, mapDocument?.ports ?? []) : undefined
    if (instance) {
      proxy.position.set(
        instance.position.x / 1000,
        instance.position.y / 1000,
        instance.position.z / 1000,
      )
      proxy.rotation.set(0, 0, THREE.MathUtils.degToRad(instance.rotation))
      transform.attach(proxy)
    }
    transform.getHelper().visible =
      !!instance && (toolMode === 'translate' || toolMode === 'rotate')
    requestRender()
  }
  /**
   * 현재 도구에 맞춰 커서와 이동 및 회전 핸들의 활성 상태를 바꾸는 조작 모드 전환
   *
   * @param tool 현재 활성화할 선택 또는 배치 및 이동 도구
   */
  const setTool = (tool: 'select' | 'place' | 'port' | 'translate' | 'rotate') => {
    toolMode = tool
    placing = tool === 'place' || tool === 'port'
    transform.enabled = !spacePan.active() && (tool === 'translate' || tool === 'rotate')
    transform.getHelper().visible = !!selectedId && transform.enabled
    transform.setMode(tool === 'rotate' ? 'rotate' : 'translate')
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
  const fit = () => {
    models.updateMatrixWorld(true)
    ground.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(models)
    bounds.union(new THREE.Box3().setFromObject(ground))
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, 5, 5))
    const centre = bounds.getCenter(new THREE.Vector3())
    const direction = new THREE.Vector3(1, -1, 0.85).normalize()
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
  /**
   * 마우스 버튼과 현재 도구에 맞는 선택 또는 드래그 시작 상태를 기록하는 입력 시작 처리
   *
   * @param e 클릭 또는 드래그 판정에 사용하는 포인터 이벤트
   */
  const pointerDown = (e: PointerEvent) => {
    downWasSpace = spacePan.active()
    down = { x: e.clientX, y: e.clientY }
    downGizmo = transform.enabled && transform.axis !== null
  }
  /**
   * 드래그 상태와 이동량을 확인하여 화면 이동 또는 클릭과 영역 선택을 확정하는 입력 종료 처리
   *
   * @param e 클릭 또는 드래그 판정에 사용하는 포인터 이벤트
   */
  const pointerUp = (e: PointerEvent) => {
    if (
      e.button !== 0 ||
      downWasSpace ||
      downGizmo ||
      transform.dragging ||
      Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4
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
    const hit = ray.intersectObjects(meshes)[0]
    events.select(
      hit && hit.instanceId !== undefined ? hit.object.userData.ids[hit.instanceId] : null,
    )
  }
  /**
   * 이벤트와 관찰자 및 렌더링 버퍼를 해제하고 생성한 화면 요소를 제거하는 렌더러 자원 정리
   */
  const dispose = () => {
    spacePan.dispose()
    cancelAnimationFrame(animationFrame)
    observer.disconnect()
    controls.dispose()
    transform.dispose()
    renderer.domElement.removeEventListener('pointerdown', pointerDown)
    renderer.domElement.removeEventListener('pointerup', pointerUp)
    for (const mesh of meshes) {
      mesh.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    box.dispose()
    cylinder.dispose()
    clearGround()
    labels.remove()
    grid.geometry.dispose()
    for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
      if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose()
      material.dispose()
    }
    renderer.dispose()
    renderer.domElement.remove()
  }
  scene.background = new THREE.Color(0x101c27)
  camera.up.set(0, 0, 1)
  camera.position.set(10, -15, 12)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.domElement.setAttribute(
    'aria-label',
    '3D 시설 설계: 왼쪽 클릭 선택과 배치, 오른쪽 드래그 회전, 스페이스와 왼쪽 드래그 화면 이동, 휠 확대',
  )
  host.append(renderer.domElement)
  labels.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
  host.append(labels)
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
    transform.enabled = !pressed && (toolMode === 'translate' || toolMode === 'rotate')
    renderer.domElement.style.cursor = pressed ? 'grab' : placing ? 'crosshair' : 'default'
  })
  transform = new TransformControls(camera, renderer.domElement)
  transform.setTranslationSnap(0.01)
  transform.setRotationSnap(Math.PI / 12)
  transform.addEventListener('dragging-changed', (event) => {
    controls.enabled = !event.value
    if (!event.value && selectedId)
      events.move(
        selectedId,
        {
          x: Math.round(proxy.position.x * 1000),
          y: Math.round(proxy.position.y * 1000),
          z: Math.round(proxy.position.z * 1000),
        },
        THREE.MathUtils.radToDeg(proxy.rotation.z),
      )
  })
  transform.addEventListener('objectChange', () => {
    if (selectedId)
      updateMatrices({
        ...facilityDocument!.instances.find((i) => i.id === selectedId)!,
        portOffset: undefined,
        position: {
          x: proxy.position.x * 1000,
          y: proxy.position.y * 1000,
          z: proxy.position.z * 1000,
        },
        rotation: THREE.MathUtils.radToDeg(proxy.rotation.z),
      })
    requestRender()
  })
  grid.rotation.x = Math.PI / 2
  const light = new THREE.DirectionalLight(0xffffff, 2.5)
  light.position.set(10, -20, 40)
  scene.add(
    models,
    ground,
    grid,
    proxy,
    transform.getHelper(),
    new THREE.AmbientLight(0xffffff, 1.5),
    light,
  )
  renderer.domElement.addEventListener('pointerdown', pointerDown)
  renderer.domElement.addEventListener('pointerup', pointerUp)
  observer = new ResizeObserver(() => resizeViewport())
  observer.observe(host)
  resizeViewport()
  return {
    setMap: setMap,
    setDocument: setDocument,
    setSelected: setSelected,
    setTool: setTool,
    fit: fit,
    dispose: dispose,
  }
}
