/**
 * 파일명: ModelPreview.ts
 * 설명: 사용자 모델의 부품 선택과 변형 및 원점 확인을 제공하는 독립 제작 화면
 * 작성자: 이희원
 * 작성일자: 2026-10-21
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { FacilityPart } from '@/entities/facility/index.ts'
import { createSpacePan } from '@/shared/lib/input/index.ts'
import { mgsTheme } from '@/entities/map/index.ts'

/**
 * 지도 배치와 독립된 부품 선택 및 이동과 회전 및 크기 조절 화면 생성
 * @param host 제작 캔버스를 부착할 화면 요소
 * @param events 부품 선택과 변형 및 연속 조작 시작을 전달하는 콜백
 * @returns 부품과 테마 및 선택 도구를 갱신하는 제작 화면 명령
 */
export const createModelPreview = (
  host: HTMLElement,
  events: {
    select: (id: string | null) => void
    change: (id: string, patch: Partial<FacilityPart>) => void
    gesture: (active: boolean) => void
  },
) => {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000)
  camera.up.set(0, 0, 1)
  camera.position.set(6, -8, 6)
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.domElement.tabIndex = 0
  renderer.domElement.setAttribute(
    'aria-label',
    '모델 제작 화면: 클릭 부품 선택, 핸들로 변형, 오른쪽 드래그 회전, Space와 왼쪽 드래그 이동',
  )
  host.append(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.screenSpacePanning = false
  controls.enableDamping = false
  controls.minDistance = 0.1
  controls.maxDistance = 1000
  controls.maxPolarAngle = Math.PI / 2.2
  controls.zoomSpeed = 2
  controls.mouseButtons.LEFT = null
  controls.mouseButtons.MIDDLE = null
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE
  const transform = new TransformControls(camera, renderer.domElement)
  transform.setTranslationSnap(0.01)
  transform.setRotationSnap(Math.PI / 12)
  transform.setScaleSnap(0.01)
  const model = new THREE.Group()
  const grid = new THREE.GridHelper(20, 40)
  grid.rotation.x = Math.PI / 2
  grid.position.z = -0.001
  const axes = new THREE.AxesHelper(1)
  const outline = new THREE.BoxHelper(model, 0x19c6a3)
  outline.visible = false
  outline.material.depthTest = false
  outline.renderOrder = 10
  const light = new THREE.DirectionalLight(0xffffff, 2.5)
  light.position.set(5, -8, 12)
  const box = new THREE.BoxGeometry(1, 1, 1)
  // 부품의 높이 축과 동일한 Z 방향을 기준으로 구성하는 원통 형상
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
  cylinder.rotateX(Math.PI / 2)
  const roots = new Map<string, THREE.Group>()
  let parts: FacilityPart[] = []
  let selected: string | null = null
  let batchSelected = new Set<string>()
  let mode: 'translate' | 'rotate' | 'scale' = 'translate'
  let frame = 0
  let disposed = false
  let down: { id: number; x: number; y: number; skip: boolean } | null = null
  let moved = false
  const raycaster = new THREE.Raycaster()

  /**
   * 연속 변경을 한 프레임으로 병합하며 선택 외곽선을 갱신하는 화면 렌더링 예약
   */
  const render = () => {
    if (frame || disposed) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const root = selected ? roots.get(selected) : undefined
      outline.visible = !!root
      if (root) outline.setFromObject(root)
      renderer.render(scene, camera)
    })
  }
  /**
   * 스페이스 상태에 맞춰 카메라와 부품 핸들의 입력 소유권을 조정하는 이동 모드 전환
   * @param pressed 스페이스 이동 모드 활성 여부
   */
  const spacePan = createSpacePan((pressed) => {
    controls.mouseButtons.LEFT = pressed ? THREE.MOUSE.PAN : null
    transform.enabled = !pressed
    renderer.domElement.style.cursor = pressed ? 'grab' : 'default'
  }, host)

  /**
   * 선택 부품을 변형 핸들에 연결하거나 선택 해제하는 제작 대상 갱신
   * @param id 선택한 부품 식별자
   */
  const setSelected = (id: string | null) => {
    selected = id
    const root = id ? roots.get(id) : undefined
    if (root && transform.object !== root) transform.attach(root)
    else if (!root) transform.detach()
    render()
  }
  /**
   * 일괄 좌표 편집 대상을 기존 부품 색상을 보존하는 발광색으로 강조하는 대상 표시
   * @param ids 체크한 부품 식별자 목록
   */
  const setBatchSelection = (ids: string[]) => {
    batchSelected = new Set(ids)
    for (const [id, root] of roots) {
      const material = (
        root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
      ).material
      material.emissive.set(batchSelected.has(id) ? 0x087e70 : 0)
      material.emissiveIntensity = 0.5
    }
    render()
  }
  /**
   * 원본 부품 식별자를 유지하며 제작 화면의 도형과 속성을 동기화하는 부품 목록 갱신
   * 변형 중인 도형을 재생성하지 않아 핸들의 드래그 상태를 보존하는 화면 반영
   * @param values 현재 제작 중인 부품 목록
   */
  const setParts = (values: FacilityPart[]) => {
    parts = values
    const ids = new Set(values.map((part) => part.id))
    for (const [id, root] of roots)
      if (!ids.has(id)) {
        const mesh = root.children[0] as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshStandardMaterial
        >
        mesh.material.dispose()
        model.remove(root)
        roots.delete(id)
      }
    for (const part of values) {
      const numbers = [
        ...Object.values(part.position),
        ...Object.values(part.size),
        part.rotation,
        part.tiltX ?? 0,
        part.tiltY ?? 0,
      ]
      if (
        numbers.some((value) => !Number.isFinite(value)) ||
        Object.values(part.size).some((value) => value < 1)
      )
        continue
      let root = roots.get(part.id)
      if (!root) {
        root = new THREE.Group()
        root.userData.id = part.id
        const mesh = new THREE.Mesh(
          part.shape === 'box' ? box : cylinder,
          new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.2 }),
        )
        mesh.userData.id = part.id
        root.add(mesh)
        roots.set(part.id, root)
        model.add(root)
      }
      const mesh = root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
      mesh.geometry = part.shape === 'box' ? box : cylinder
      mesh.material.color.set(part.color)
      mesh.material.emissive.set(batchSelected.has(part.id) ? 0x087e70 : 0)
      mesh.material.emissiveIntensity = 0.5
      root.position.set(part.position.x / 1000, part.position.y / 1000, part.position.z / 1000)
      root.rotation.set(
        THREE.MathUtils.degToRad(part.tiltX ?? 0),
        THREE.MathUtils.degToRad(part.tiltY ?? 0),
        THREE.MathUtils.degToRad(part.rotation),
        'ZXY',
      )
      root.scale.set(part.size.x / 1000, part.size.y / 1000, part.size.z / 1000)
    }
    setSelected(selected)
  }
  /**
   * 현재 부품 범위에 카메라를 맞추고 바닥 원점을 확인하는 전체 보기
   */
  const fit = () => {
    model.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(model)
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, 1, 2))
    const centre = bounds.getCenter(new THREE.Vector3())
    const size = bounds.getSize(new THREE.Vector3())
    const distance = Math.max(
      1,
      (size.length() /
        (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
        Math.min(1, camera.aspect)) *
        1.2,
    )
    camera.far = Math.max(100000, distance * 10)
    camera.updateProjectionMatrix()
    controls.maxDistance = Math.max(1000, distance * 3)
    controls.target.copy(centre)
    camera.position
      .copy(centre)
      .addScaledVector(new THREE.Vector3(1, -1.4, 1).normalize(), distance)
    controls.update()
    grid.scale.setScalar(Math.max(1, Math.ceil(Math.max(size.x, size.y) / 15)))
    render()
  }
  /**
   * 현재 화면 밝기에 맞춰 제작 화면과 바닥 격자의 색상을 변경하는 테마 반영
   * @param theme 지도와 공유하는 화면 테마
   */
  const setTheme = (theme: ReturnType<typeof mgsTheme>) => {
    scene.background = new THREE.Color(theme.background)
    const material = grid.material as THREE.LineBasicMaterial
    material.vertexColors = false
    material.color.set(theme.grid)
    render()
  }
  /**
   * 이동과 회전 및 크기 핸들의 좌표 기준을 변경하는 제작 도구 전환
   * @param value 현재 사용할 변형 도구
   */
  const setMode = (value: typeof mode) => {
    mode = value
    transform.setMode(value)
    transform.setSpace(value === 'scale' ? 'local' : 'world')
    render()
  }
  /**
   * 회전한 부품의 실제 최저점을 바닥에 정렬하는 위치 보정
   */
  const groundSelected = () => {
    const root = selected ? roots.get(selected) : undefined
    const part = parts.find((part) => part.id === selected)
    if (!root || !part) return
    root.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(root, true)
    events.change(part.id, {
      position: { ...part.position, z: part.position.z - bounds.min.z * 1000 },
    })
  }
  /**
   * 화면 크기에 맞춰 카메라 투영과 렌더러 크기를 갱신하는 제작 화면 리사이즈
   */
  const resize = () => {
    const width = Math.max(1, host.clientWidth),
      height = Math.max(1, host.clientHeight)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height)
    render()
  }
  /**
   * 핸들 조작과 화면 이동을 일반 부품 클릭과 구분하는 포인터 시작 기록
   * @param event 부품 선택 또는 변형을 시작한 포인터 입력
   */
  const pointerDown = (event: PointerEvent) => {
    renderer.domElement.focus()
    down = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      skip:
        event.button !== 0 || spacePan.active() || transform.dragging || transform.axis !== null,
    }
    moved = false
  }
  /**
   * 시작 위치로 돌아오는 드래그도 클릭으로 오인하지 않는 이동 기록
   * @param event 현재 포인터 위치
   */
  const pointerMove = (event: PointerEvent) => {
    if (
      down &&
      down.id === event.pointerId &&
      Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4
    )
      moved = true
  }
  /**
   * 일반 클릭 위치의 부품만 선택하는 제작 화면 클릭 판정
   * @param event 선택을 종료한 포인터 입력
   */
  const pointerUp = (event: PointerEvent) => {
    const previous = down
    down = null
    if (
      !previous ||
      previous.id !== event.pointerId ||
      previous.skip ||
      moved ||
      event.button !== 0 ||
      transform.dragging
    )
      return
    const rect = renderer.domElement.getBoundingClientRect()
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      ),
      camera,
    )
    events.select(raycaster.intersectObjects(model.children, true)[0]?.object.userData.id ?? null)
  }
  /**
   * 포인터 취소 시 진행 중인 부품 클릭을 폐기하는 입력 정리
   */
  const pointerCancel = () => {
    down = null
  }
  /**
   * 핸들 변형을 원본 밀리미터와 축별 회전 정보로 환산하는 부품 속성 반영
   */
  const objectChange = () => {
    const root = transform.object
    if (!root || !selected) return
    root.scale.clamp(new THREE.Vector3(0.001, 0.001, 0.001), new THREE.Vector3(100, 100, 100))
    const rotation = new THREE.Euler().setFromQuaternion(root.quaternion, 'ZXY')
    events.change(selected, {
      position: { x: root.position.x * 1000, y: root.position.y * 1000, z: root.position.z * 1000 },
      size: { x: root.scale.x * 1000, y: root.scale.y * 1000, z: root.scale.z * 1000 },
      tiltX: THREE.MathUtils.radToDeg(rotation.x),
      tiltY: THREE.MathUtils.radToDeg(rotation.y),
      rotation: THREE.MathUtils.radToDeg(rotation.z),
    })
    render()
  }
  transform.addEventListener('objectChange', objectChange)
  transform.addEventListener('dragging-changed', (event) => {
    controls.enabled = !event.value
    events.gesture(event.value === true)
  })
  controls.addEventListener('change', render)
  renderer.domElement.addEventListener('pointerdown', pointerDown)
  renderer.domElement.addEventListener('pointermove', pointerMove)
  renderer.domElement.addEventListener('pointerup', pointerUp)
  renderer.domElement.addEventListener('pointercancel', pointerCancel)
  scene.add(
    model,
    grid,
    axes,
    outline,
    transform.getHelper(),
    new THREE.AmbientLight(0xffffff, 1.5),
    light,
  )
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()
  /**
   * 제작 화면 종료 시 입력과 관찰자 및 그래픽 자원을 해제하는 수명주기 정리
   */
  const dispose = () => {
    disposed = true
    spacePan.dispose()
    cancelAnimationFrame(frame)
    observer.disconnect()
    controls.dispose()
    transform.dispose()
    renderer.domElement.removeEventListener('pointerdown', pointerDown)
    renderer.domElement.removeEventListener('pointermove', pointerMove)
    renderer.domElement.removeEventListener('pointerup', pointerUp)
    renderer.domElement.removeEventListener('pointercancel', pointerCancel)
    for (const root of roots.values())
      (
        root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
      ).material.dispose()
    box.dispose()
    cylinder.dispose()
    grid.geometry.dispose()
    ;(grid.material as THREE.Material).dispose()
    axes.geometry.dispose()
    ;(axes.material as THREE.Material).dispose()
    outline.geometry.dispose()
    outline.material.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }
  return {
    setParts,
    setSelected,
    setBatchSelection,
    setMode,
    setTheme,
    fit,
    groundSelected,
    dispose,
  }
}
