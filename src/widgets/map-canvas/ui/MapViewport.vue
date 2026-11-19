<!--
/**
 * 파일명: MapViewport.vue
 * 설명: 지도 렌더러 수명주기와 우클릭 메뉴 및 노드 입력을 연결하는 뷰포트
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ContextDataEditor,
  DEFAULT_AES_VEHICLE,
  readAesVehicle,
  useEditor,
} from '@/features/map-editor/index.ts'
import { createMapScene } from '@/widgets/map-canvas/lib/MapScene'
import { calibrateDrawingMap } from '@/features/drawing-import/index.ts'
import { calculateCurve, MAX_NODES } from '@/entities/map/index.ts'
import type { Layers, MapShape } from '@/entities/map/index.ts'
const props = defineProps<{
  layers: Layers
}>()
const emit = defineEmits<{
  cursor: [x: number, y: number]
  zoom: [value: number]
}>()
const editor = useEditor()
const host = ref<HTMLElement>()
const error = ref('')
const showDrawing = ref(true)
const referenceFrom = ref<number | null>(null)
const referenceTo = ref<number | null>(null)
const referenceDistance = ref<number | null>(null)
const calibrationError = ref('')
/** 선택한 두 기준점의 실제 거리를 기존 편집 이력에 반영하는 도면 축척 보정 */
const calibrate = () => {
  try {
    if (referenceFrom.value === null || referenceTo.value === null || !referenceDistance.value)
      throw new Error('기준 노드 두 개와 실제 거리 mm를 입력하세요.')
    const calibrated = calibrateDrawingMap(
      editor.document,
      [referenceFrom.value, referenceTo.value],
      referenceDistance.value,
    )
    editor.commit((map) => Object.assign(map, calibrated))
    calibrationError.value = ''
    editor.message = '도면 축척을 mm로 확정했습니다.'
    scene?.fit()
  } catch (cause) {
    calibrationError.value = cause instanceof Error ? cause.message : String(cause)
  }
}
watch(showDrawing, (visible) => scene?.setDrawingVisible(visible))
watch(
  () => editor.mapRevision,
  () => {
    referenceFrom.value = null
    referenceTo.value = null
    calibrationError.value = ''
  },
)
const portMenu = ref<{
  id: string | null
  groupId: string | null
  nodeId: number | null
  x: number
  y: number
  left: number
  top: number
}>()
const shapeMenu = ref<{ id: number; left: number; top: number }>()
const shapeMove = ref<{ id: number; x: number; y: number }>()
const menu = ref<{
  id: number | null
  x: number
  y: number
  left: number
  top: number
  distance: number
  connection: number | null
  tolerance: number
  connectDistance: number
}>()
const repeat = ref<{
  nodeId: number
  edgeId: string
  spacing: number
  origin: 'start' | 'end' | 'both'
  repeat: boolean
}>()
const repeatError = ref('')
const contextData = ref<{ nodeId: number } | { portId: string }>()
const vehicleDegrees = Array.from({ length: 8 }, (_, index) => index * 45)
const vehicleConfig = ref<HTMLInputElement>()
const vehicleDimensions = ref(DEFAULT_AES_VEHICLE)
const vehicleCount = ref(0)
const draft = reactive({ open: false, x: 0, y: 0, connection: null as number | null })
const menuElement = ref<HTMLElement>()
const drawingPoint = reactive({ x: 0, y: 0 })
const draftCurve = computed(() => {
  try {
    return draft.open
      ? calculateCurve(editor.document, draft.connection, draft, editor.curveOptions)
      : null
  } catch {
    return null
  }
})
/** 현재 선택과 마우스 위치 및 입력값을 실제 생성과 같은 계산으로 표시하는 커브 미리보기 */
const refreshCurvePreview = () => {
  try {
    const curve = draft.open
      ? draftCurve.value
      : calculateCurve(editor.document, editor.selectedId, drawingPoint, editor.curveOptions)
    scene?.setCurvePreview(curve?.points)
  } catch {
    scene?.setCurvePreview()
  }
}
watch(
  () => [
    editor.document,
    editor.selectedId,
    { ...editor.curveOptions },
    draft.open,
    draft.x,
    draft.y,
    draft.connection,
  ],
  refreshCurvePreview,
  { flush: 'post' },
)
/**
 * 현재 우클릭 메뉴의 대상과 위치를 제거하는 메뉴 닫기
 */
const closeMenu = () => {
  menu.value = undefined
  portMenu.value = undefined
  shapeMenu.value = undefined
}
/**
 * 포트 편집 모드에서 원본 표시 순서의 가장 앞 포트를 찾는 포트 선택 판정
 * @param x 지도 가로 좌표
 * @param y 지도 세로 좌표
 * @returns 포인터 아래 포트 식별자 또는 빈 결과
 */
const pickPortGroup = (x: number, y: number) =>
  [...(editor.visibleDocument.portGroups ?? [])]
    .reverse()
    .find(
      (group) =>
        Math.abs(x - group.x) <= group.width / 2 && Math.abs(y - group.y) <= group.height / 2,
    )
const pickPort = (x: number, y: number) => {
  return (
    [...editor.visibleDocument.ports]
      .reverse()
      .find(
        (port) =>
          Math.abs(x - port.x) <= (port.width ?? 420) / 2 &&
          Math.abs(y - port.y) <= (port.height ?? 260) / 2,
      )?.id ?? null
  )
}
/** 두 끝점으로 이루어진 선분에 대한 투영 위치와 수직 거리 계산 */
const projectPoint = (
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  const ratio = length
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length ** 2))
    : 0
  return {
    length,
    offset: length * ratio,
    distance: Math.hypot(point.x - start.x - dx * ratio, point.y - start.y - dy * ratio),
  }
}
const nodesById = computed(
  () => new Map(editor.visibleDocument.nodes.map((node) => [node.id, node])),
)
const routes = computed(() =>
  editor.visibleDocument.edges.flatMap((edge) => {
    const from = nodesById.value.get(edge.from)
    const to = nodesById.value.get(edge.to)
    return from && to ? [{ edge, from, to }] : []
  }),
)
const straightRoutes = computed(() =>
  routes.value.filter(
    ({ edge, from, to }) =>
      !from.curve &&
      !to.curve &&
      !from.virtual &&
      !to.virtual &&
      ![2, 3].includes(edge.drivingType ?? 1),
  ),
)
/** 대상 노드가 끝점인 직선 경로만 반복 삽입 대상으로 표시 */
const repeatRoutes = (nodeId: number | null) =>
  straightRoutes.value.filter(({ from, to }) => from.id === nodeId || to.id === nodeId)
const insertTarget = computed(() => {
  const target = menu.value
  if (!target) return
  const point = editor.snapPoint(target.x, target.y, null)
  let nearest: { edgeId: string; startId: number; offset: number; distance: number } | undefined
  for (const { edge, from, to } of straightRoutes.value) {
    const projection = projectPoint(point, from, to)
    if (
      projection.offset <= 0 ||
      projection.offset >= projection.length ||
      projection.distance > target.tolerance
    )
      continue
    if (!nearest || projection.distance < nearest.distance)
      nearest = {
        edgeId: edge.id,
        startId: from.id,
        offset: projection.offset,
        distance: projection.distance,
      }
  }
  return nearest
})
/** 기준 노드에서 일정 거리마다 생성할 노드를 하나의 이력으로 저장 */
const applyRepeat = () => {
  const draft = repeat.value
  if (!draft) return
  try {
    if (editor.document.units !== 'mm')
      throw new Error('도면 축척을 확인한 뒤 mm 간격을 적용하세요.')
    const route = repeatRoutes(draft.nodeId).find(({ edge }) => edge.id === draft.edgeId)
    if (!route || !Number.isSafeInteger(Number(draft.spacing)) || Number(draft.spacing) < 1)
      throw new Error('직선 경로와 양의 정수 간격을 입력하세요.')
    const spacing = Number(draft.spacing)
    const length = Math.hypot(route.to.x - route.from.x, route.to.y - route.from.y)
    const count = draft.repeat ? Math.ceil(length / spacing) - 1 : Number(length > spacing)
    if (count < 1 || count > MAX_NODES - editor.document.nodes.length)
      throw new Error('간격을 조정해 삽입 가능한 노드 수를 확인하세요.')
    const fromStart =
      draft.origin === 'both' ? Math.ceil(count / 2) : draft.origin === 'start' ? count : 0
    const offsets = [
      ...Array.from({ length: fromStart }, (_, index) => (index + 1) * spacing),
      ...Array.from({ length: count - fromStart }, (_, index) => length - (index + 1) * spacing),
    ]
    editor.insertPathNodes(route.edge.id, draft.nodeId, offsets)
    repeat.value = undefined
  } catch (cause) {
    repeatError.value = cause instanceof Error ? cause.message : String(cause)
  }
}
/** 렌더링에 쓰는 도형 크기와 선분 위치로 우클릭 대상 판정 */
const hitShape = (shape: MapShape, x: number, y: number, tolerance: number) => {
  if (shape.type === 6) {
    const lines = shape.text.split('\n')
    const size = Math.max(1, shape.height * 10)
    const width = Math.max(...lines.map((line) => [...line].length)) * size * 0.8
    const left = shape.fontAlign === 2 ? -width : shape.fontAlign === 3 ? -width / 2 : 0
    const dx = x - shape.x1
    const dy = y - shape.y1
    const along = shape.fontDirection === 2 ? dy : dx
    const down = shape.fontDirection === 2 ? dx : -dy
    return (
      along >= left - tolerance &&
      along <= left + width + tolerance &&
      down >= -tolerance &&
      down <= lines.length * size * 1.3 + tolerance
    )
  }
  if (shape.type === 5)
    return (
      projectPoint({ x, y }, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }).distance <=
      tolerance + shape.strokeWidth * 5
    )
  const cx = (shape.x1 + shape.x2) / 2
  const cy = (shape.y1 + shape.y2) / 2
  const halfWidth = (shape.type === 3 ? shape.width : Math.abs(shape.x2 - shape.x1)) / 2 + tolerance
  const halfHeight =
    (shape.type === 3
      ? shape.height
      : shape.type === 4
        ? Math.abs(shape.x2 - shape.x1)
        : Math.abs(shape.y2 - shape.y1)) /
      2 +
    tolerance
  if (shape.type === 3 || shape.type === 4)
    return ((x - cx) / halfWidth) ** 2 + ((y - cy) / halfHeight) ** 2 <= 1
  return Math.abs(x - cx) <= halfWidth && Math.abs(y - cy) <= halfHeight
}
/** 노드의 출발 경로별 차량 각도 또는 지정 각도로 차량 외곽을 배치 */
const placeVehicle = (nodeId: number | null, degree?: number) => {
  if (nodeId === null) return
  const node = nodesById.value.get(nodeId)
  if (!node || editor.document.units !== 'mm') return
  const route = routes.value.find(
    ({ edge, from, to }) => from.id === nodeId || (to.id === nodeId && edge.direction === 1),
  )
  let heading = degree
  if (heading === undefined) {
    if (!route) {
      editor.message = '차량 방향을 결정할 출발 경로가 없습니다. 각도를 지정하세요.'
      return
    }
    const forward = route.from.id === nodeId
    const destination = forward ? route.to : route.from
    const control = forward ? route.edge.controls?.forward : route.edge.controls?.backward
    heading =
      control?.vehicleDegree !== undefined && control.vehicleDegree >= 0
        ? control.vehicleDegree / 1000 - (control.reverse === 1 ? 180 : 0)
        : (Math.atan2(destination.y - node.y, destination.x - node.x) * 180) / Math.PI
  }
  scene?.addVehiclePreview(node.x, node.y, heading, vehicleDimensions.value)
  vehicleCount.value++
  closeMenu()
}
/** 원본 AGV 설정 파일을 읽어 이후 배치할 차량의 규격을 적용 */
const loadVehicleConfig = async (event: Event) => {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    vehicleDimensions.value = readAesVehicle(await file.text())
    editor.message = `${file.name} 차량 치수 적용 완료`
  } catch (cause) {
    editor.message = cause instanceof Error ? cause.message : String(cause)
  }
}
/** 지도에 누적된 차량 외곽을 모두 지우는 미리보기 정리 */
const clearVehicles = () => {
  vehicleCount.value = 0
  scene?.clearVehiclePreviews()
  closeMenu()
}
/** 우클릭 대상이 선택된 상태로 기존 객체 편집창 열기 */
const openObjectEditor = (
  category: NonNullable<typeof editor.objectEditor>,
  target: NonNullable<typeof editor.objectEditorTarget>,
) => {
  editor.objectEditorTarget = target
  editor.objectEditor = category
}
/** 선택 도형의 좌표 이동과 편집 및 삭제를 처리 */
const shapeAction = (action: 'edit' | 'move' | 'delete') => {
  const id = shapeMenu.value?.id
  if (id === undefined) return
  const shape = editor.document.shapes?.find((item) => item.id === id)
  if (!shape) return
  if (action === 'edit') openObjectEditor('shapes', { id: String(id) })
  else if (!editor.readOnly && action === 'move') {
    shapeMove.value = {
      id,
      x: shape.type === 6 ? shape.x1 : (shape.x1 + shape.x2) / 2,
      y: shape.type === 6 ? shape.y1 : (shape.y1 + shape.y2) / 2,
    }
    editor.message = '도형을 배치할 위치를 클릭하세요. Esc로 취소할 수 있습니다.'
  } else if (!editor.readOnly && window.confirm(`도형 ${id}을 삭제하시겠습니까?`)) {
    attempt(() =>
      editor.commit((map) => {
        map.shapes = map.shapes?.filter((item) => item.id !== id)
      }),
    )
  }
  closeMenu()
}
/**
 * 원본 포트 메뉴의 추가와 편집 및 정렬 명령을 편집 이력에 연결하는 포트 작업
 * @param action 원본 포트 메뉴의 명령 이름
 */
const portAction = (
  action:
    | 'add'
    | 'edit'
    | 'delete'
    | 'front'
    | 'back'
    | 'forward'
    | 'backward'
    | 'addGroup'
    | 'editGroup'
    | 'deleteGroup'
    | 'schedule',
) => {
  const target = portMenu.value
  if (!target) return
  attempt(() => {
    if (editor.readOnly && action !== 'edit' && action !== 'editGroup' && action !== 'schedule')
      return
    if (action === 'addGroup' && target.nodeId !== null) {
      openObjectEditor('portGroups', { nodeId: target.nodeId, add: true })
    } else if (action === 'editGroup' && target.groupId !== null) {
      openObjectEditor('portGroups', { id: target.groupId })
    } else if (action === 'deleteGroup' && target.groupId !== null) {
      if (window.confirm(`포트 그룹 ${target.groupId}을 삭제하시겠습니까?`))
        editor.commit((map) => {
          map.portGroups = map.portGroups?.filter((group) => group.id !== target.groupId)
        })
    } else if (action === 'add') {
      const node = editor.document.nodes.find((item) => item.id === target.nodeId)
      if (!node) throw new Error('포트를 연결할 노드를 먼저 선택하세요.')
      const id = editor.addPort(node.id, target.x, target.y)
      if (id !== undefined) openObjectEditor('ports', { id })
    } else if (target.id) {
      editor.selectedPortId = target.id
      if (action === 'edit') openObjectEditor('ports', { id: target.id })
      else if (action === 'schedule') contextData.value = { portId: target.id }
      else if (action === 'delete') {
        if (window.confirm(`Do you really want to delete Port ${target.id}?`))
          editor.removePort(target.id)
      } else if (
        action === 'front' ||
        action === 'back' ||
        action === 'forward' ||
        action === 'backward'
      )
        editor.orderPort(target.id, action)
    }
  })
  closeMenu()
}
/** 포트와 도형 메뉴에서 원본 명령 키를 마우스 동작과 동일하게 실행 */
const objectMenuKey = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase()
  if (portMenu.value) {
    const actions: Partial<Record<string, Parameters<typeof portAction>[0]>> = {
      a: 'add',
      e: 'edit',
      d: 'delete',
      s: 'schedule',
      g: 'addGroup',
      t: 'editGroup',
      u: 'deleteGroup',
    }
    const action = actions[key]
    if (action) {
      event.preventDefault()
      portAction(action)
    }
  } else if (shapeMenu.value) {
    const actions: Partial<Record<string, Parameters<typeof shapeAction>[0]>> = {
      e: 'edit',
      m: 'move',
      d: 'delete',
    }
    const action = actions[key]
    if (action) {
      event.preventDefault()
      shapeAction(action)
    }
  }
}
/**
 * 메뉴 바깥 영역의 입력을 감지하여 열린 메뉴를 정리하는 외부 클릭 처리
 *
 * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
 */
const outsideMenu = (event: PointerEvent) => {
  if (!menuElement.value?.contains(event.target as Node)) closeMenu()
}
/**
 * 취소 키에 맞춰 메뉴와 노드 입력창 및 진행 중인 조작을 닫는 입력 취소
 *
 * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
 */
const escape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeMenu()
    draft.open = false
    repeat.value = undefined
    shapeMove.value = undefined
    scene?.cancelInteraction()
  }
}
/**
 * 원본 노드 종류와 거리 및 읽기 전용 상태를 확인한 뒤 메뉴 명령을 실행하는 노드 메뉴 처리
 *
 * @param action 검증 범위 안에서 실행할 편집 명령
 */
const menuAction = (
  action:
    | 'add'
    | 'edit'
    | 'delete'
    | 'connect'
    | 'path'
    | 'pathSetting'
    | 'insert'
    | 'repeat'
    | 'fitCurrent'
    | 'fitTarget',
) => {
  const target = menu.value
  if (!target) return
  if (action === 'pathSetting' && target.id !== null && hasIncoming(target.id)) {
    contextData.value = { nodeId: target.id }
    closeMenu()
    return
  }
  if (action === 'path') {
    const route = routes.value.find(({ from, to }) => from.id === target.id || to.id === target.id)
    if (route && target.id !== null)
      openObjectEditor('edges', { id: route.edge.id, nodeId: target.id })
    closeMenu()
    return
  }
  if (action !== 'insert' && target.id !== null && nodesById.value.get(target.id)?.curve) {
    closeMenu()
    return
  }
  if (action === 'insert' && !editor.readOnly && insertTarget.value) {
    const { edgeId, startId, offset } = insertTarget.value
    attempt(() => editor.insertPathNodes(edgeId, startId, [offset]))
  }
  if (action === 'repeat' && !editor.readOnly && target.id !== null) {
    const route = repeatRoutes(target.id)[0]
    if (route) {
      repeatError.value = ''
      repeat.value = {
        nodeId: target.id,
        edgeId: route.edge.id,
        spacing: 1000,
        origin: 'start',
        repeat: true,
      }
    }
  }
  if (
    (action === 'fitCurrent' || action === 'fitTarget') &&
    canFit.value &&
    target.id !== null &&
    target.connection !== null
  ) {
    const { id, connection } = target
    attempt(() => editor.fitAndConnect(connection, id, target, action === 'fitCurrent'))
  }
  if (action === 'add' && !editor.readOnly && target.distance >= 100) {
    Object.assign(draft, {
      open: true,
      x: Math.trunc(target.x),
      y: Math.trunc(target.y),
      connection: target.connection,
    })
  } else if (target.id !== null) {
    if (action === 'edit') {
      editor.selectedId = target.id
      editor.nodeEditorOpen = true
      void nextTick(() =>
        document.querySelector<HTMLInputElement>('[data-testid="node-x"]')?.focus(),
      )
    }
    if (action === 'delete' && !editor.readOnly) {
      if (window.confirm(`Do you really want to delete Node ${target.id}?`)) {
        editor.selectedId = target.id
        attempt(() => editor.removeSelected())
      }
    }
    if (
      action === 'connect' &&
      !editor.readOnly &&
      target.connection !== null &&
      target.distance < target.connectDistance
    ) {
      if (window.confirm(`Do you really want to connect ${target.id}→${target.connection} node?`))
        attempt(() => editor.connect(target.id!, target.connection!))
    }
  }
  closeMenu()
}
const canFit = computed(() => {
  const target = menu.value
  if (
    editor.readOnly ||
    !target ||
    target.id === null ||
    target.connection === null ||
    target.id === target.connection
  )
    return false
  return [target.id, target.connection].every((id) => {
    const node = nodesById.value.get(id)
    return node && !node.curve && !node.virtual
  })
})
/** 연결 설정에 필요한 진입 방향 경로가 존재하는지 확인 */
const hasIncoming = (id: number) =>
  routes.value.some(
    ({ edge, from, to }) => to.id === id || (from.id === id && edge.direction === 1),
  )
/**
 * 우클릭 메뉴에서 이동 및 실행과 닫기를 지원하는 메뉴 키보드 탐색
 *
 * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
 */
const menuKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeMenu()
    draft.open = false
    return
  }
  const key = event.key.toLowerCase()
  const fitOptions = menuElement.value?.querySelector<HTMLDetailsElement>('[data-fit-options]')
  if (fitOptions && key === 'f') {
    event.preventDefault()
    fitOptions.open = !fitOptions.open
    return
  }
  if (fitOptions?.open && (key === 'c' || key === 't')) {
    event.preventDefault()
    menuAction(key === 'c' ? 'fitCurrent' : 'fitTarget')
    return
  }
  const action = (
    {
      a: 'add',
      e: 'edit',
      d: 'delete',
      c: 'connect',
      q: 'path',
      s: 'pathSetting',
      i: 'insert',
      r: 'repeat',
    } as const
  )[key as 'a']
  if (action) {
    event.preventDefault()
    event.stopPropagation()
    menuAction(action)
  }
}
/**
 * 입력 좌표와 연결 기준 노드를 사용하여 새 지도 노드를 만드는 노드 생성 적용
 */
const add = () => {
  attempt(() => {
    editor.addNode(Number(draft.x), Number(draft.y), draft.connection)
    draft.open = false
  })
}
let scene: ReturnType<typeof createMapScene> | undefined
/**
 * 편집 명령의 예외를 화면 상태로 변환하고 정상 처리 시 이전 오류를 해제하는 작업 실행
 *
 * @param action 검증 범위 안에서 실행할 편집 명령
 */
const attempt = (action: () => void) => {
  try {
    action()
  } catch (cause) {
    editor.message = cause instanceof Error ? cause.message : String(cause)
  }
}
onMounted(() => {
  document.addEventListener('pointerdown', outsideMenu, true)
  window.addEventListener('keydown', escape)
  try {
    scene = createMapScene(host.value!, {
      click: (id, x, y) =>
        attempt(() => {
          closeMenu()
          const move = shapeMove.value
          if (move) {
            const dx = Math.round(x - move.x)
            const dy = Math.round(y - move.y)
            if (dx || dy)
              editor.commit((map) => {
                const shape = map.shapes?.find((item) => item.id === move.id)
                if (!shape) throw new Error('이동할 도형이 없습니다.')
                shape.x1 += dx
                shape.x2 += dx
                shape.centerX += dx
                shape.y1 += dy
                shape.y2 += dy
                shape.centerY += dy
              })
            shapeMove.value = undefined
            editor.message = `도형 ${move.id} 이동 완료`
            return
          }
          if (editor.shapeTool !== null) return
          if (editor.portMode) {
            editor.selectedPortId = pickPortGroup(x, y)?.portIds[0] ?? pickPort(x, y)
            return
          }
          if (draft.open) {
            draft.x = Math.trunc(x)
            draft.y = Math.trunc(y)
            return
          }
          if (editor.tool === 'add') {
            editor.addNode(
              Math.round(x / 10) * 10,
              Math.round(y / 10) * 10,
              editor.curveOptions.force || editor.curveOptions.autoSelect
                ? editor.selectedId
                : null,
            )
            return
          }
          if (editor.tool === 'connect' && id !== null) {
            editor.connectNode(id)
            return
          }
          if (id !== null) editor.selectedId = id
        }),
      context: (id, x, y, left, top, distance, unitsPerPixel) => {
        closeMenu()
        const position = {
          left: Math.max(0, Math.min(left + 10, host.value!.clientWidth - 270)),
          top: Math.max(0, Math.min(top + 10, host.value!.clientHeight - 200)),
        }
        if (shapeMove.value) {
          shapeMove.value = undefined
          return
        }
        if (editor.portMode) {
          const group = pickPortGroup(x, y)
          const portId = group ? null : pickPort(x, y)
          const port = editor.visibleDocument.ports.find((item) => item.id === portId)
          portMenu.value = {
            ...position,
            id: portId,
            groupId: group?.id ?? null,
            nodeId: group?.nodeId ?? port?.nodeId ?? id ?? editor.selectedId,
            x,
            y,
          }
        } else {
          const shape = [...(editor.visibleDocument.shapes ?? [])]
            .reverse()
            .find((item) => hitShape(item, x, y, unitsPerPixel * 5))
          if (shape && (editor.shapeTool !== null || id === null))
            shapeMenu.value = { ...position, id: shape.id }
          else {
            editor.selectedIds = []
            menu.value = {
              ...position,
              id,
              x,
              y,
              distance,
              connection: editor.selectedId,
              tolerance: unitsPerPixel * 12,
              connectDistance: Math.max(50, unitsPerPixel * 4),
            }
          }
        }
        void nextTick(() => {
          const element = menuElement.value
          if (!element || !host.value) return
          const top = Math.max(
            0,
            Math.min(position.top, host.value.clientHeight - element.offsetHeight),
          )
          element.style.top = `${top}px`
          element.style.maxHeight = `${host.value.clientHeight - top}px`
          element.focus({ preventScroll: true })
        })
      },
      area: (start, end) =>
        attempt(() => {
          if (editor.shapeTool !== null) editor.addShape(start, end)
          else if (props.layers.nodes && !editor.portMode) editor.selectArea(start, end)
        }),
      cursor: (x, y) => {
        drawingPoint.x = x
        drawingPoint.y = y
        refreshCurvePreview()
        emit('cursor', x, y)
      },
      zoom: (value) => emit('zoom', value),
    })
    scene.setRenderPaused(editor.renderPaused)
    scene.setDocument(editor.visibleDocument, editor.theme)
    scene.setLayers(props.layers)
    scene.setSelectedPort(editor.selectedPortId)
    scene.setTool(editor.tool, editor.readOnly)
    scene.fit()
  } catch (cause) {
    error.value = `Three.js 초기화 실패: ${cause instanceof Error ? cause.message : String(cause)}`
  }
})
watch(
  () => editor.selectedIds,
  (ids) => scene?.setAreaSelection(ids),
)
watch(
  () => [editor.visibleDocument, editor.theme] as const,
  ([map, theme], [previous]) => {
    if (map !== previous) {
      closeMenu()
      draft.open = false
    }
    scene?.setDocument(map, theme)
    if (!editor.canUndo && !editor.canRedo && map !== previous) scene?.fit()
  },
)
watch(
  () => editor.selectedId,
  (id) => scene?.setSelected(id),
)
watch(
  () => editor.selectedPortId,
  (id) => scene?.setSelectedPort(id),
)
watch(
  () => [editor.tool, editor.readOnly] as const,
  ([tool, readonly]) => scene?.setTool(tool, readonly),
)
watch(
  () => props.layers,
  (layers) => scene?.setLayers(layers),
  { deep: true },
)
watch(
  () => editor.renderPaused,
  (paused) => scene?.setRenderPaused(paused),
)
watch(
  () => editor.mapRevision,
  () => {
    error.value = ''
    closeMenu()
    draft.open = false
    repeat.value = undefined
    shapeMove.value = undefined
    scene?.cancelInteraction()
    scene?.setDocument(editor.visibleDocument, editor.theme)
    contextData.value = undefined
    clearVehicles()
    scene?.fit()
  },
  { flush: 'post' },
)
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outsideMenu, true)
  window.removeEventListener('keydown', escape)
  scene?.dispose()
})
/**
 * 원본 지도 맞춤 규칙을 렌더러에 전달하는 화면 맞춤
 * @param alternate 여백 없는 원본 맞춤 규칙의 적용 여부
 */
const fit = (alternate = false) => scene?.fit(alternate)
/**
 * 지정 노드를 중심으로 지도 화면을 이동하는 포커스 전달
 * @param id 화면 중심에 배치할 노드 식별자
 */
const focus = (id: number) => scene?.focus(id)
/**
 * 확대 배수를 지도 렌더러에 전달하는 배율 변경
 * @param factor 현재 화면 배율에 적용할 확대 또는 축소 비율
 */
const zoomBy = (factor: number) => scene?.zoomBy(factor)
/**
 * 현재 지도와 라벨의 합성 이미지를 다운로드하는 지도 캡처
 */
const capture = () => {
  const image = scene?.capture()
  if (!image) return
  const anchor = document.createElement('a')
  anchor.href = image
  anchor.download = `${editor.sourceName.replace(/\.[^.]+$/, '')}.png`
  anchor.click()
}
defineExpose({ fit, focus, zoomBy, capture })
</script>

<template>
  <div
    ref="host"
    class="map-viewport w-100 h-100 position-absolute"
    @scene-error="error = ($event as CustomEvent).detail"
  >
    <div
      v-if="error"
      class="gpu-error position-absolute pa-5"
      role="alert"
    >
      {{ error }}
    </div>
    <details
      v-if="editor.document.drawing"
      class="drawing-controls position-absolute pa-2"
      data-testid="drawing-controls"
      @pointerdown.stop
      @keydown.stop
    >
      <summary>도면 비율 직접 맞추기</summary>
      <form
        class="mt-2"
        @submit.prevent="calibrate"
      >
        <label>
          기준 노드 A
          <select
            v-model="referenceFrom"
            required
            data-testid="drawing-reference-from"
          >
            <option :value="null">선택</option>
            <option
              v-for="node in editor.document.nodes.filter((node) => !node.curve)"
              :key="node.id"
              :value="node.id"
            >
              N{{ node.id }}
            </option>
          </select>
        </label>
        <label>
          기준 노드 B
          <select
            v-model="referenceTo"
            required
            data-testid="drawing-reference-to"
          >
            <option :value="null">선택</option>
            <option
              v-for="node in editor.document.nodes.filter((node) => !node.curve)"
              :key="node.id"
              :value="node.id"
            >
              N{{ node.id }}
            </option>
          </select>
        </label>
        <label>
          실제 거리 (mm)
          <input
            v-model.number="referenceDistance"
            type="number"
            min="1"
            required
            data-testid="drawing-reference-distance"
          />
        </label>
        <v-btn
          type="submit"
          data-testid="drawing-calibrate"
        >
          축척 적용
        </v-btn>
      </form>
      <p
        v-if="calibrationError"
        role="alert"
      >
        {{ calibrationError }}
      </p>
    </details>
    <div
      v-if="portMenu"
      ref="menuElement"
      class="mgs-context-menu position-absolute pa-2"
      role="menu"
      tabindex="-1"
      :style="{ left: `${portMenu.left}px`, top: `${portMenu.top}px` }"
      @pointerdown.stop
      @keydown.stop="objectMenuKey"
      @keydown.esc.stop="closeMenu"
    >
      <strong>
        {{
          portMenu.groupId
            ? `포트 그룹 ${portMenu.groupId}`
            : portMenu.id
              ? `포트 ${portMenu.id}`
              : '포트를 추가할 수 있습니다'
        }}
      </strong>
      <v-btn
        role="menuitem"
        :disabled="editor.readOnly || portMenu.nodeId === null"
        @click="portAction('add')"
      >
        [A] Add
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="!portMenu.id"
        @click="portAction('edit')"
      >
        [E] Edit
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="editor.readOnly || !portMenu.id"
        @click="portAction('delete')"
      >
        [D] Delete
      </v-btn>
      <hr />
      <v-btn
        role="menuitem"
        :disabled="editor.readOnly || !portMenu.id"
        @click="portAction('front')"
      >
        Bring to Front
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="editor.readOnly || !portMenu.id"
        @click="portAction('back')"
      >
        Send to Back
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="editor.readOnly || !portMenu.id"
        @click="portAction('forward')"
      >
        Bring Forward
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="editor.readOnly || !portMenu.id"
        @click="portAction('backward')"
      >
        Send Backward
      </v-btn>
      <hr />
      <v-btn
        role="menuitem"
        :disabled="!portMenu.id"
        @click="portAction('schedule')"
      >
        포트 SCMD 설정
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="editor.readOnly || portMenu.nodeId === null"
        @click="portAction('addGroup')"
      >
        포트 그룹 추가
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="portMenu.groupId === null"
        @click="portAction('editGroup')"
      >
        포트 그룹 편집
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="editor.readOnly || portMenu.groupId === null"
        @click="portAction('deleteGroup')"
      >
        포트 그룹 삭제
      </v-btn>
    </div>
    <div
      v-if="shapeMenu"
      ref="menuElement"
      class="mgs-context-menu position-absolute pa-2"
      role="menu"
      tabindex="-1"
      :style="{ left: `${shapeMenu.left}px`, top: `${shapeMenu.top}px` }"
      @pointerdown.stop
      @keydown.stop="objectMenuKey"
      @keydown.esc.stop="closeMenu"
    >
      <strong>도형 {{ shapeMenu.id }}</strong>
      <v-btn
        role="menuitem"
        @click="shapeAction('edit')"
      >
        도형 편집
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="editor.readOnly"
        @click="shapeAction('move')"
      >
        도형 이동
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="editor.readOnly"
        @click="shapeAction('delete')"
      >
        도형 삭제
      </v-btn>
    </div>
    <div
      v-if="menu"
      ref="menuElement"
      class="mgs-context-menu position-absolute pa-2"
      role="menu"
      tabindex="-1"
      :style="{ left: `${menu.left}px`, top: `${menu.top}px` }"
      @keydown.stop="menuKey"
      @pointerdown.stop
    >
      <strong>
        {{ menu.id === null ? 'You can add a node.' : `Node[${menu.id}] is selected.` }}
      </strong>
      <v-btn
        role="menuitem"
        data-testid="context-add"
        :disabled="
          editor.readOnly ||
          menu.distance < 100 ||
          !!editor.document.nodes.find((n) => n.id === menu?.id)?.curve
        "
        @click="menuAction('add')"
      >
        [A] Add (Node)
      </v-btn>
      <hr />
      <v-btn
        role="menuitem"
        :disabled="
          menu.id === null || !!editor.document.nodes.find((n) => n.id === menu?.id)?.curve
        "
        @click="menuAction('edit')"
      >
        [E] Edit (Node)
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="
          menu.id === null ||
          !routes.some(({ from, to }) => from.id === menu?.id || to.id === menu?.id)
        "
        @click="menuAction('path')"
      >
        [Q] Edit (Path)
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="menu.id === null || !hasIncoming(menu.id)"
        @click="menuAction('pathSetting')"
      >
        [S] Setting (Connected Path)
      </v-btn>
      <hr />
      <v-btn
        role="menuitem"
        :disabled="
          editor.readOnly ||
          menu.id === null ||
          !!editor.document.nodes.find((n) => n.id === menu?.id)?.curve
        "
        @click="menuAction('delete')"
      >
        [D] Delete
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="editor.readOnly || !repeatRoutes(menu.id).length"
        @click="menuAction('repeat')"
      >
        [R] Repeat Insert
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="editor.readOnly || !insertTarget"
        @click="menuAction('insert')"
      >
        [I] Insert (1)
      </v-btn>
      <details
        v-if="canFit"
        data-fit-options
      >
        <summary>[F] Fit and Connect</summary>
        <v-btn
          role="menuitem"
          @click="menuAction('fitCurrent')"
        >
          Current Node Fit to Target
        </v-btn>
        <v-btn
          role="menuitem"
          @click="menuAction('fitTarget')"
        >
          Target Node Fit to Current
        </v-btn>
      </details>
      <hr />
      <v-btn
        role="menuitem"
        :disabled="
          editor.readOnly ||
          menu.id === null ||
          menu.connection === null ||
          menu.distance >= menu.connectDistance ||
          !!editor.document.nodes.find((n) => n.id === menu?.id)?.curve
        "
        @click="menuAction('connect')"
      >
        [C] Connect
      </v-btn>
      <details
        v-if="
          editor.document.units === 'mm' &&
          (menu.id !== null || editor.selectedId !== null || vehicleCount)
        "
      >
        <summary>차량 배치 미리보기</summary>
        <v-btn
          role="menuitem"
          @click="vehicleConfig?.click()"
        >
          차량 규격 불러오기
        </v-btn>
        <v-btn
          role="menuitem"
          :disabled="menu.id === null"
          @click="placeVehicle(menu.id)"
        >
          우클릭 노드에 배치
        </v-btn>
        <v-btn
          role="menuitem"
          :disabled="editor.selectedId === null"
          @click="placeVehicle(editor.selectedId)"
        >
          선택 노드에 배치
        </v-btn>
        <details v-if="menu.id !== null">
          <summary>차량 각도 지정</summary>
          <v-btn
            v-for="degree in vehicleDegrees"
            :key="degree"
            role="menuitem"
            @click="placeVehicle(menu.id, degree)"
          >
            {{ degree }}°
          </v-btn>
        </details>
        <v-btn
          role="menuitem"
          :disabled="!vehicleCount"
          @click="clearVehicles"
        >
          차량 미리보기 지우기
        </v-btn>
      </details>
    </div>
    <input
      ref="vehicleConfig"
      type="file"
      accept=".ini"
      class="d-none"
      @change="loadVehicleConfig"
    />
    <ContextDataEditor
      :key="editor.mapRevision"
      v-model="contextData"
    />
    <v-dialog
      :model-value="!!repeat"
      max-width="420"
      @update:model-value="repeat = undefined"
    >
      <v-card
        v-if="repeat"
        title="Repeat Insert"
      >
        <v-card-text>
          <v-select
            v-model="repeat.edgeId"
            label="연결 경로"
            :items="
              repeatRoutes(repeat.nodeId).map(({ edge, from, to }) => ({
                title: `N${from.id} → N${to.id}`,
                value: edge.id,
              }))
            "
          />
          <v-text-field
            v-model.number="repeat.spacing"
            type="number"
            min="1"
            step="1"
            label="삽입 간격 mm"
            @keydown.enter="applyRepeat"
          />
          <v-select
            v-model="repeat.origin"
            label="간격 계산 방향"
            :items="[
              { title: '현재 노드에서 시작', value: 'start' },
              { title: '연결 노드에서 시작', value: 'end' },
              { title: '양 끝에서 시작', value: 'both' },
            ]"
          />
          <v-checkbox
            v-model="repeat.repeat"
            label="간격마다 반복 삽입"
            hide-details
          />
          <p
            v-if="repeatError"
            role="alert"
            class="text-error"
          >
            {{ repeatError }}
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="repeat = undefined">취소</v-btn>
          <v-btn
            color="primary"
            :disabled="editor.readOnly"
            @click="applyRepeat"
          >
            삽입
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <form
      v-if="draft.open"
      class="mgs-node-form position-absolute pa-2"
      @submit.prevent="add"
      @pointerdown.stop
      @keydown.stop
      @keydown.esc="draft.open = false"
    >
      <strong>
        Add Node · {{ editor.curveOptions.force || draftCurve ? '커브 노드' : '직선 노드' }}
      </strong>
      <label>
        X ({{ editor.document.units }})
        <input
          v-model.number="draft.x"
          type="number"
          required
          data-testid="add-x"
        />
      </label>
      <label>
        Y ({{ editor.document.units }})
        <input
          v-model.number="draft.y"
          type="number"
          required
        />
      </label>
      <label>
        Connected Node
        <select v-model="draft.connection">
          <option :value="null">없음</option>
          <option
            v-for="node in editor.document.nodes.filter((n) => !n.curve)"
            :key="node.id"
            :value="node.id"
          >
            {{ node.id }}
          </option>
        </select>
      </label>
      <template v-if="editor.curveOptions.force || editor.curveOptions.autoSelect">
        <label>
          Radius (mm)
          <input
            v-model.number="editor.curveOptions.radius"
            type="number"
            min="1"
            step="1"
            :disabled="editor.curveOptions.dynamicRadius"
            required
            data-testid="add-curve-radius"
          />
        </label>
        <label>
          Curve Degree (°)
          <input
            v-model.number="editor.curveOptions.angle"
            type="number"
            min="1"
            max="359"
            step="1"
            required
            data-testid="add-curve-angle"
          />
        </label>
        <label>
          Divide Degree (°)
          <input
            v-model.number="editor.curveOptions.divide"
            type="number"
            min="1"
            :max="editor.curveOptions.angle"
            step="1"
            required
            data-testid="add-curve-divide"
          />
        </label>
        <small v-if="draftCurve">
          끝점 {{ draftCurve.points.at(-1)?.x }}, {{ draftCurve.points.at(-1)?.y }} mm · 커브 가상
          노드 {{ draftCurve.points.length - 2 }}개
        </small>
      </template>
      <div>
        <v-btn
          type="submit"
          data-testid="confirm-add"
        >
          Add
        </v-btn>
        <v-btn
          type="button"
          @click="draft.open = false"
        >
          Close
        </v-btn>
      </div>
    </form>
  </div>
</template>

<style scoped lang="scss">
// 도면 배경과 같은 좌표계의 기준점 및 실제 거리 입력
.drawing-controls {
  z-index: 6;
  top: 40px;
  left: 30px;
  width: 235px;
  max-height: 70%;
  overflow: auto;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
  font-size: 11px;
}
.drawing-controls label {
  display: block;
  margin-bottom: 6px;
}
.drawing-controls .drawing-checkbox {
  width: 14px;
  height: 14px;
}
.drawing-controls select {
  width: 100%;
  background: var(--input-bg);
  color: var(--text);
  border: 1px solid var(--border);
}
.drawing-controls summary {
  cursor: pointer;
  font-weight: 600;
}
// 화면 구성과 고유 시각 요소에 필요한 컴포넌트 전용 스타일

input {
  font: inherit;
}
input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
input {
  width: 100%;
  min-width: 0;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 10px 12px;
}
input:focus {
  border-color: var(--accent);
}
input:disabled {
  background: var(--surface-muted);
  color: var(--text-muted);
}
input[type='checkbox'] {
  accent-color: var(--accent);
  width: 14px;
  height: 14px;
  cursor: pointer;
}
strong {
  font-weight: 600;
}
.map-viewport {
  inset: 0;
}
.map-viewport > :deep(canvas) {
  display: block;
  touch-action: none;
}
:deep(.map-labels) {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.gpu-error {
  top: 40%;
  left: 10%;
  right: 10%;
  color: var(--text-secondary);
  background: #4d2829;
  border: 1px solid #895050;
  line-height: 1.8;
  border-radius: 8px;
  z-index: 5;
}
:deep(.mgs-selection-box) {
  position: absolute;
  pointer-events: none;
  border: 1px solid #4488ff;
  background: #4488ff18;
  z-index: 10;
}
:deep(.mgs-selection-box)[data-operation='remove'] {
  border-color: var(--border);
  border-style: dashed;
  background: #ff996618;
}
:deep(.mgs-selection-box)[hidden] {
  display: none;
}
.mgs-context-menu {
  z-index: 30;
  width: 260px;
  max-height: 100%;
  overflow: auto;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--app-border);
  box-shadow: var(--shadow);
  border-radius: 8px;
  font:
    12px 'Pretendard',
    sans-serif;
}
.mgs-node-form {
  z-index: 30;
  width: 260px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--app-border);
  box-shadow: var(--shadow);
  border-radius: 8px;
  font:
    12px 'Pretendard',
    sans-serif;
}
.mgs-context-menu strong {
  display: block;
  padding: 7px;
}
.mgs-context-menu summary {
  cursor: pointer;
  padding: 6px 8px;
}
.mgs-context-menu details button {
  padding-inline-start: 20px;
}
.mgs-context-menu button {
  display: block;
  width: 100%;
  padding: 6px 8px;
  text-align: left;
  border: 0;
  background: transparent;
  color: inherit;
}
.mgs-context-menu button:hover:enabled {
  background: var(--surface-muted);
}
.mgs-context-menu button:focus-visible {
  background: var(--surface-muted);
}
.mgs-context-menu button:disabled {
  color: var(--text-secondary);
  cursor: default;
}
.mgs-context-menu hr {
  border: 0;
  border-top: 1px solid var(--app-border);
  margin: 3px 0;
}
.mgs-node-form {
  top: 70px;
  right: 20px;
  display: grid;
  gap: 10px;
}
.mgs-node-form label {
  display: grid;
  gap: 4px;
}
.mgs-node-form input {
  width: 100%;
  padding: 6px;
  border: 1px solid var(--app-border);
  background: var(--surface);
  color: var(--text);
}
.mgs-node-form select {
  width: 100%;
  padding: 6px;
  border: 1px solid var(--app-border);
  background: var(--surface);
  color: var(--text);
}
.mgs-node-form button {
  padding: 5px 14px;
  margin-right: 6px;
}
</style>
