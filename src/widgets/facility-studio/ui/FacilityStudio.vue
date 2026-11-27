<!--
 * 파일명: FacilityStudio.vue
 * 설명: 설비 모델 제작과 포트 배치 및 실행 데이터 추출을 제공하는 설비 편집 화면
 * 작성자: 이희원
 * 작성일자: 2026-11-04
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { mdiCubeOutline, mdiFolderOpenOutline, mdiRestore } from '@mdi/js'
import { VIcon, VProgressCircular, VTab, VTabs } from 'vuetify/components'
import { AppIcon } from '@/shared/ui/index.ts'
import { registerAppCommands, type AppCommand, type CommandParameter } from '@/shared/lib/input/index.ts'
import { useFacilityEditor } from '@/features/facility-editor/index.ts'
import { useEditor } from '@/features/map-editor/index.ts'
import { DrawingLayout } from '@/features/drawing-import/index.ts'
import {
  mapGeometryKey,
  resolveFacilityInstance,
  MAX_GLB_BYTES,
  facilityModelBounds,
  facilityModelSize,
  facilityCutawayRole,
  facilityScaleLimits,
  facilityLight,
  legacyFacilityLight,
  minLightTemperature,
  maxLightTemperature,
  createInteriorModel,
  floorMaterials,
  interiorModels,
  loadDefaultCatalog,
  MAX_FLOOR_POINTS,
  wallBody,
  wallDoorLimits,
  wallLocalPoint,
  wallMountFrame,
  wallOpeningPose,
  wallWorldPoint,
  emptyFacilityDocument,
} from '@/entities/facility/index.ts'
import type { FacilityAsset, FacilityCutawayRole, FacilityInstance, FacilityLight, FloorArea, FloorMaterial, FloorPoint, Point3, WallDoor } from '@/entities/facility/index.ts'
import { createFacilityScene, type WallMountPreview } from '@/widgets/facility-studio/lib/FacilityScene.ts'
import { defaultTransformSnap, snapToStep, transformSnapSteps, type TransformSnapStep } from '@/widgets/facility-studio/lib/transformSnap.ts'
import { DEFAULT_LAYERS, type Layers, type MapLayout } from '@/entities/map/index.ts'
import { GlbModelCache, glbModelSize } from '@bem/map3d/glb'
import { createGlbImportPreview } from '@/widgets/facility-studio/lib/glbImportPreview.ts'
import ModelDesigner from '@/widgets/facility-studio/ui/ModelDesigner.vue'
import FloorAreaEditor from '@/widgets/facility-studio/ui/FloorAreaEditor.vue'
import ModelCatalog from '@/widgets/facility-studio/ui/ModelCatalog.vue'
import GlbLightFields from '@/widgets/facility-studio/ui/GlbLightFields.vue'
import WallDoorEditor from '@/widgets/facility-studio/ui/WallDoorEditor.vue'
import WallElevation from '@/widgets/facility-studio/ui/WallElevation.vue'
import CeilingPlan from '@/widgets/facility-studio/ui/CeilingPlan.vue'
import SceneExplorerBranch, { type SceneExplorerEntry } from '@/widgets/facility-studio/ui/SceneExplorerBranch.vue'
import SceneTutorial from '@/widgets/facility-studio/ui/SceneTutorial.vue'
import { sceneTutorials, tutorialAssetId, type TutorialScenario, type TutorialState } from '@/widgets/facility-studio/lib/sceneTutorial.ts'

const emit = defineEmits<{ 
  draftDirty: [value: boolean]; 
  layer: [key: keyof Layers, visible: boolean] 
}>()

const props = defineProps<{ layers?: Layers }>()

const platformLabel = window.desktop ? 'DESKTOP' : 'WEB'
const placementPort = ref('')

// GLB 모델
const glbInput = ref<HTMLInputElement>()
const glbImportOpen = ref(false)
const glbFile = shallowRef<File>()
/** 바닥 파일 등록에서 선택한 영역의 대상 식별자 관리 */
const glbFloorTarget = ref('')
const glbDraft = shallowRef<{
  file: File
  bytes: ArrayBuffer
  model: Awaited<ReturnType<GlbModelCache['load']>>
}>()
const glbPreviewHost = ref<HTMLElement>()
const glbPreviewLoading = ref(false)
const glbPreviewError = ref('')
let glbPreview: ReturnType<typeof createGlbImportPreview> | undefined
const glbName = ref('')
const glbUnits = ref<'m' | 'mm'>('m')
const glbCategory = ref<NonNullable<FacilityAsset['catalogCategory']>>('equipment')

// 조명 모델
const lightEditId = ref('')
const lightKind = ref<FacilityLight['kind']>('spot')
const lightTemperature = ref('4000')
const lightSettings = computed<FacilityLight>(() => ({
  kind: lightKind.value, temperature: Number(lightTemperature.value),
}))
const lightError = computed(() => {
  const { temperature } = lightSettings.value
  return Number.isInteger(temperature) && temperature >= minLightTemperature && temperature <= maxLightTemperature
    ? '' : `색온도는 ${minLightTemperature}~${maxLightTemperature} K의 정수로 입력하세요.`
})

// GLB 모델 상태
const glbImportError = ref('')
const glbDimensions = computed(() => glbDraft.value && glbModelSize(glbDraft.value.model, glbUnits.value))
const glbDimensionLabel = computed(() => glbDimensions.value &&
  [glbDimensions.value.x, glbDimensions.value.y, glbDimensions.value.z]
    .map((value) => value.toLocaleString('ko-KR', { maximumFractionDigits: 3 })).join(' × '),
)

// 카테고리
const catalogDragType = 'application/x-ts-mgs-catalog-model'
const draggingModelId = ref('')
const catalogDropTarget = ref(false)
const catalogOpen = ref(false)
const catalogCategory = ref<NonNullable<FacilityAsset['catalogCategory']>>('equipment')
const catalogLoading = ref(false)
const defaultCatalog = shallowRef<FacilityAsset[]>()
const interiorCatalog = (Object.keys(interiorModels) as (keyof typeof interiorModels)[]).map(createInteriorModel)
const studio = useFacilityEditor(),
  map = useEditor()

const host = ref<HTMLElement>()
/** 편집 모드와 독립적으로 리본에 표시할 작업 메뉴 정의 */
const menus = ['File', 'View', 'Facility', 'Building', 'Lighting', 'Tools', 'Help'] as const
const menu = ref<(typeof menus)[number]>('Facility')
/** 연습 상태와 시나리오 선택 화면의 표시 관리 */
const tutorialChooser = ref(false)
const tutorial = shallowRef<TutorialScenario>()
const tutorialRestoring = ref(false)

/** 작업 패널과 탐색 목록의 크기 제한 정의 */
const sizeLimits = {
  context: { initial: 220, min: 180, max: 360, sign: 1 },
  inspector: { initial: 300, min: 260, max: 500, sign: -1 },
  explorer: { initial: 212, min: 80, max: 640, sign: 1 },
} as const

type PanelSize = keyof typeof sizeLimits

const panelStorageKey = 'mgs-facility-panels'
const panelPreferences = reactive({
  context: Number(sizeLimits.context.initial),
  inspector: Number(sizeLimits.inspector.initial),
  explorer: Number(sizeLimits.explorer.initial),
  contextOpen: true,
  inspectorOpen: true,
})

const panelLayout = ref<HTMLElement>()
let panelDrag: { key: PanelSize; pointer: number; origin: number; size: number; next: number } | undefined

/** 사용자가 지정한 크기를 패널별 허용 범위로 제한 */
const limitPanelSize = (key: PanelSize, value: number) => 
  Math.round(Math.min(sizeLimits[key].max, Math.max(sizeLimits[key].min, value)))

  try {
    const saved = JSON.parse(localStorage.getItem(panelStorageKey) ?? 'null')

    if (saved) {
      for (const key of ['context', 'inspector', 'explorer'] as const) {
        if (Number.isFinite(saved[key])) panelPreferences[key] = limitPanelSize(key, saved[key])
      }
      if (typeof saved.contextOpen === 'boolean') panelPreferences.contextOpen = saved.contextOpen
      if (typeof saved.inspectorOpen === 'boolean') panelPreferences.inspectorOpen = saved.inspectorOpen
    }
  } catch { 
    /* 사용자 설정을 읽지 못한 경우 기본 크기 적용 */ 
  }

// 패널 크기와 열림 상태를 로컬 저장소에 반영
watch(() => ({ ...panelPreferences }), (value) => {
  try {
    if (!tutorial.value) localStorage.setItem(panelStorageKey, JSON.stringify(value))
  } catch { 
    /* 저장 공간을 사용할 수 없는 경우 현재 화면 설정 유지 */ 
  }
})

/** 포인터 캡처를 사용해 현재 화면의 실제 패널 크기에서 조절 시작 */
const startPanelResize = (key: PanelSize, event: PointerEvent) => {
  if (event.button !== 0 || panelDrag) return

  const handle = event.currentTarget as HTMLElement
  const bounds = (key === 'explorer' ? handle.previousElementSibling : handle.parentElement)?.getBoundingClientRect()
  
  if (!bounds) return
  
  const size = key === 'explorer' ? bounds.height : bounds.width
  
  panelDrag = { key, pointer: event.pointerId, origin: key === 'explorer' ? event.clientY : event.clientX, size, next: size }
  handle.setPointerCapture(event.pointerId)
}

/** 드래그 중에는 레이아웃 변수만 갱신하여 뷰포트의 기존 크기 관찰 재사용 */
const movePanelResize = (event: PointerEvent) => {
  if (!panelDrag || panelDrag.pointer !== event.pointerId) return

  const { key, size, origin } = panelDrag
  const position = key === 'explorer' ? event.clientY : event.clientX
  const next = limitPanelSize(key, size + (position - origin) * sizeLimits[key].sign)

  if (next === panelDrag.next) return

  panelDrag.next = next
  panelLayout.value?.style.setProperty(`--panel-${key}`, `${next}px`)
}

/** 포인터 조절 결과를 확정하고 사용자 설정에 반영 */
const finishPanelResize = (event: PointerEvent) => {
  if (!panelDrag || panelDrag.pointer !== event.pointerId) return

  if (panelDrag.next !== panelDrag.size) panelPreferences[panelDrag.key] = panelDrag.next

  panelLayout.value?.style.setProperty(`--panel-${panelDrag.key}`, `${panelPreferences[panelDrag.key]}px`)
  panelDrag = undefined
}

/** 방향키와 처음 및 끝 키를 사용하는 패널 크기 조절 처리 */
const resizePanelByKey = (key: PanelSize, event: KeyboardEvent) => {
  const { min, max, sign } = sizeLimits[key]
  const previous = key === 'explorer' ? 'ArrowUp' : 'ArrowLeft'
  const next = key === 'explorer' ? 'ArrowDown' : 'ArrowRight'

  if (event.key === 'Home') {
    panelPreferences[key] = min
  } else if (event.key === 'End') {
    panelPreferences[key] = max
  } else if (event.key === previous || event.key === next) {
    panelPreferences[key] = limitPanelSize(key, panelPreferences[key] + (event.key === next ? 16 : -16) * sign)
  } else {
    return
  }
  
  event.preventDefault()
  event.stopPropagation()
}

const workspace = ref<'equipment' | 'building'>('equipment')
const showBuildingInEquipment = ref(false)
const equipmentGuides = computed(() => workspace.value === 'equipment' && !showBuildingInEquipment.value)
const buildingView = ref<'structure' | 'wall' | 'ceiling'>('structure')
/** 구조 배치 중 천장과 부착 모델의 가림을 해제하는 화면 표시 상태 관리 */
const showCeilingInStructure = ref(false)
const ceilingGuides = computed(() => workspace.value === 'building' && buildingView.value === 'structure' && !showCeilingInStructure.value)
const wallHostId = ref('')
const ceilingHostId = ref('')
const ceilingStart = shallowRef<FloorPoint>()
const ceilingHeight = ref(4000)
const mountAsset = shallowRef<FacilityAsset>()
/** 벽 표면 부착과 GLB 개구부 배치 구분 */
const mountKind = ref<'surface' | 'door' | 'window'>('surface')
const mountBounds = computed(() => mountAsset.value && facilityModelBounds(mountAsset.value))
const wallMountDimensions = computed(() => {
  const bounds = mountBounds.value
  return bounds && !bounds.isEmpty() ? { x: bounds.max.x - bounds.min.x, y: bounds.max.z - bounds.min.z } : undefined
})

// 선택 모델 참조
const selectedModel = computed(() =>
  studio.document.assets.find((asset) => asset.id === studio.selected?.assetId),
)

// 컷어웨이 역할 옵션
const cutawayRoles = [
  { title: '자동', value: 'auto' },
  { title: '벽', value: 'wall' },
  { title: '천장', value: 'ceiling' },
  { title: '일반 객체', value: 'independent' },
]

const attachmentTargets = computed(() => {
  const options = [{ title: '부착 안 함', value: '' }]

  for (const { instance, role } of structures.value) {
    if (instance.id === studio.selectedId) continue

    const { x, y } = resolveFacilityInstance(instance, map.document.ports).position

    options.push({
      value: instance.id,
      title: `${role === 'wall' ? '벽' : '천장'} · ${instance.name} (${Math.round(x)}, ${Math.round(y)} mm)`,
    })
  }

  return options
})

/**
 * 내장 모델 목록
 */
const builtInModels = computed(() =>
  new Map([...interiorCatalog, ...(defaultCatalog.value ?? [])].map((asset) => [asset.id, asset])),
)

const catalogAssets = computed(() => {
  const entries = new Map(builtInModels.value)

  for (const asset of studio.document.assets) {
    entries.set(asset.id, asset)
  }

  return [...entries.values()]
})
const registeredCatalogIds = computed(() => new Set(
  studio.document.assets.filter((asset) => !builtInModels.value.has(asset.id)).map((asset) => asset.id),
))
const placedCatalogIds = computed(() => new Set(studio.document.instances.map((instance) => instance.assetId)))
const editingLight = computed(() => studio.document.assets.find((asset) => asset.id === lightEditId.value))

/** 대소문자와 유니코드 표기 차이를 정규화한 모델명 중복 비교 */
const normalizeModelName = (name: string) => name.trim().normalize('NFC').toLowerCase()

const glbNameError = computed(() => {
  const name = glbName.value.trim()
  if (!name) return '모델 이름을 입력하세요.'
  if (name.length > 300) return '모델 이름은 300자까지 입력할 수 있습니다.'
  if (catalogAssets.value.some((asset) => normalizeModelName(asset.name) === normalizeModelName(name)))
    return '같은 이름의 모델이 이미 있습니다.'
  return ''
})

const doorEditor = ref<HTMLElement>()
const focusedOpening = ref('')
const selectedWall = computed(() => wallBody(selectedModel.value))
const doorLimits = computed(() => wallDoorLimits(studio.selected?.wallDoors ?? []))
const baseSize = computed(() => selectedModel.value && facilityModelSize(selectedModel.value))
const wallPart = computed(() => selectedModel.value?.parts.find((part) => part.wall))
const wallTransparencyDraft = ref<number>()
/** 조작 중 백분율을 우선 표시하고 저장된 불투명도를 투명도로 환산 */
const wallTransparency = computed(() =>
  wallTransparencyDraft.value ?? Math.round(100 * (1 - (studio.selected?.wallOpacity ?? wallPart.value?.opacity ?? 1))),
)
watch([() => studio.selected, wallPart], () => { wallTransparencyDraft.value = undefined })
const wallStart = shallowRef<FloorPoint>()
const wallPreset = createInteriorModel('wall')
const ceilingPreset = createInteriorModel('ceiling')
const wallSize = reactive({ thickness: 150, height: 2600 })
const layoutOpen = ref(false)
const floorPlanVisible = ref<boolean>()
const showFloorPlan = computed(() => floorPlanVisible.value ?? !!map.document.layout?.visible)
const showGrid = computed(() => props.layers?.grid ?? DEFAULT_LAYERS.grid)
const snapStep = ref<TransformSnapStep>(defaultTransformSnap)
const sizeFields = [
  { axis: 'x', label: '가로' },
  { axis: 'y', label: '세로' },
  { axis: 'z', label: '높이' },
] as const
type SizeAxis = (typeof sizeFields)[number]['axis']

// 표시 정밀도를 정리하면서 작은 치수의 유효 숫자를 유지
const displaySize = (size: number) => Number(size.toPrecision(12))

const tool = ref<'select' | 'place' | 'wall' | 'floor' | 'ceiling' | 'port' | 'door' | 'window' | 'measure' | 'mount'>('select')
const sceneTool = computed(() => {
  if (tool.value === 'floor' || tool.value === 'ceiling') return 'place'
  if (tool.value === 'door' || tool.value === 'window') return 'attach'
  return tool.value
})
const sitePreview = ref(false)
const measurement = shallowRef<Point3[]>([])
const floorId = ref('')
const floorAreas = computed(() => studio.document.floors ?? [])
const hasSceneContent = computed(() => studio.document.assets.length > 0 || floorAreas.value.length > 0)
const selectedFloor = computed(() => floorAreas.value.find((area) => area.id === floorId.value))
const floorDraft = shallowRef<{
  shape: 'rectangle' | 'polygon'
  points: FloorPoint[]
  replaceId?: string
}>()
const floorMaterial = ref<FloorMaterial>('concrete')
const floorGuide = computed(() => {
  const draft = floorDraft.value
  if (!draft) return ''
  if (draft.shape === 'rectangle')
    return draft.points.length ? '맞은편 모서리를 클릭하세요.' : '첫 번째 모서리를 클릭하세요.'
  if (draft.points.length < 3) return '경계점을 3개 이상 클릭하세요.'
  return '첫 점 ①을 클릭하거나 Enter를 눌러 바닥을 적용하세요.'
})

/** 바닥 영역을 선택하고 모델 선택 및 변형 핸들을 해제 */
const selectFloor = (id: string) => {
  floorId.value = id
  studio.selectedId = null
  tool.value = 'select'
}

const selectedIds = computed(() => new Set(studio.selectedIds))
const multiSelected = computed(() => studio.selectedIds.length > 1)
const batchOffset = reactive({ x: 0, y: 0 })

/** 작업 화면을 유지하며 클릭과 드래그 선택을 반영하고 단일 객체에서만 핸들 활성화 */
const selectInstances = (ids: string[], operation: 'replace' | 'add' | 'toggle' = 'replace') => {
  if (operation !== 'replace' && !ids.length) return
  const next = new Set(operation === 'replace' ? [] : studio.selectedIds)
  for (const id of ids) {
    if (operation === 'toggle' && next.has(id)) next.delete(id)
    else next.add(id)
  }
  studio.selectedIds = [...next]
  tool.value = 'select'
}

const error = ref('')

const reference = computed(() => ({
  name: map.sourceName,
  geometryKey: mapGeometryKey(map.document.nodes),
}))

const designerOpen = ref(false)
const editingAsset = shallowRef<FacilityAsset | null>(null)
const pose = reactive({
  name: '',
  cutawayRole: 'auto' as FacilityCutawayRole | 'auto',
  attachedTo: '',
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  carrierRotation: '' as string | number,
  size: { x: 0, y: 0, z: 0 },
  portId: '',
  nodeId: '',
})
const posedCutawayRole = computed(() => pose.cutawayRole === 'auto' ? undefined : pose.cutawayRole)
const selectedStructure = computed(() =>
  studio.selected && facilityCutawayRole(
    { ...studio.selected, cutawayRole: posedCutawayRole.value },
    selectedModel.value,
  ),
)
const setCutawayRole = (role: string) => {
  if (role === 'auto' || role === 'wall' || role === 'ceiling' || role === 'independent')
    pose.cutawayRole = role
}

let scene: ReturnType<typeof createFacilityScene> | undefined

/** 지도 편집 위치를 보존한 채 현장 눈높이 미리보기로 전환 */
const toggleSitePreview = () => {
  if (!scene) return
  if (tool.value === 'wall' || tool.value === 'ceiling') tool.value = 'select'
  layoutOpen.value = false
  sitePreview.value = !sitePreview.value
  scene.setSitePreview(sitePreview.value)
}

/**
 * 편집 명령의 예외를 화면 상태로 변환하고 정상 처리 시 이전 오류를 해제하는 작업 실행
 *
 * @param action 검증 범위 안에서 실행할 편집 명령
 * @returns 편집 명령 적용 여부
 */
const attempt = (action: () => void) => {
  try {
    action()
    error.value = ''
    return true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    return false
  }
}

/** 기존 2D 맵의 객체를 유지하면서 3D에서 추적할 도면 배경 적용 */
const applyDrawingLayout = (layout: MapLayout) => {
  if (attempt(() => map.setLayout(layout))) {
    floorPlanVisible.value = true
    void nextTick(() => scene?.fit(true))
  }
}

/** 현재 벽의 상대 위치에 문이나 창을 부착하고 기존 개구부의 치수를 변경 */
const applyWallDoors = (wallDoors: WallDoor[], focus: string) => {
  const id = wallFrame.value?.instance.id
  if (!id || buildingLocked.value) return
  if (attempt(() => studio.updateInstance(id, { wallDoors }))) focusWallOpening(focus)
}

/** 실측 스케일을 사용하는 지도에서 부착이나 측정을 시작 */
const startSiteTool = (mode: 'door' | 'window' | 'measure') => {
  if (mode !== 'measure' && buildingView.value === 'wall') {
    addOpeningToWall(mode)
    return
  }
  attempt(() => {
    if (!tutorial.value && map.document.units !== 'mm') throw new Error('먼저 2D 맵의 실측 축척을 설정하세요.')
    if (mode === 'measure') measurement.value = []
    tool.value = mode
  })
}

/** 벽에서 찍은 점을 로컬 치수로 환산하고 일치하는 높이에 개구부를 부착 */
const attachOpening = (id: string | undefined, point: Point3, free: boolean) => {
  const window = tool.value === 'window'
  const instance = studio.document.instances.find((item) => item.id === id)
  const body = wallBody(studio.document.assets.find((asset) => asset.id === instance?.assetId))
  const applied = attempt(() => {
    if (!instance || !body) throw new Error('문이나 창문을 붙일 단일 직선 벽을 클릭하세요.')
    const placed = resolveFacilityInstance(instance, map.document.ports)
    const sx = placed.scale?.x ?? 1
    const sz = placed.scale?.z ?? 1
    const width = body.size.x * sx
    const height = body.size.z * sz
    if (width < 100 || height < 200) throw new Error('벽이 너무 작아 문이나 창문을 붙일 수 없습니다.')
    const rotation = placed.rotation * Math.PI / 180
    const clickedX =
      (point.x - placed.position.x) * Math.cos(rotation) +
      (point.y - placed.position.y) * Math.sin(rotation) - body.position.x * sx
    const clickedHeight = point.z - placed.position.z - (body.position.z - body.size.z / 2) * sz
    const openingWidth = Math.min(width, window ? 1200 : 1040)
    const openingHeight = Math.min(height, window ? 1000 : 2160)
    const limit = (width - openingWidth) / 2
    const offset = free ? clickedX : snapToStep(clickedX, snapStep.value)
    const sill = clickedHeight - openingHeight / 2
    const opening: WallDoor = {
      id: crypto.randomUUID(),
      offset: Math.max(-limit, Math.min(limit, offset)),
      width: openingWidth,
      height: openingHeight,
      ...(window
        ? { kind: 'window', sill: Math.max(0, Math.min(height - openingHeight, free ? sill : snapToStep(sill, snapStep.value))) }
        : {}),
    }
    studio.updateInstance(instance.id, { wallDoors: [...(instance.wallDoors ?? []), opening] })
    studio.selectedId = instance.id
    if (workspace.value === 'building') switchBuildingView('wall')
    focusedOpening.value = opening.id
    studio.message = window ? '창문을 붙였습니다.' : '문을 붙였습니다.'
  })
  if (!applied) return
  tool.value = 'select'
  void nextTick(() => doorEditor.value?.scrollIntoView({ block: 'nearest' }))
}

/** 처음 두 점으로 치수를 읽고 다음 클릭에서 새 측정 시작 */
const addMeasurePoint = (point: Point3) => {
  measurement.value = measurement.value.length === 1 ? [...measurement.value, point] : [point]
}

/** 선택 객체의 상대 배치를 유지하며 입력한 X와 Y 이동량을 한 번에 적용 */
const applyBatchOffset = () => {
  attempt(() => {
    studio.moveSelectionXY(Number(batchOffset.x), Number(batchOffset.y), map.document.ports)
    Object.assign(batchOffset, { x: 0, y: 0 })
  })
}

/**
 * 새 모델 또는 기존 모델을 자유 부품 편집기로 여는 제작 화면 진입
 * @param asset 편집할 기존 모델 또는 빈 모델을 나타내는 값
 */
const openDesigner = (asset: FacilityAsset | null = null) => {
  editingAsset.value = asset
  designerOpen.value = true
}

/** 확정 배치와 드래그 미리보기의 위치 및 실측 치수를 같은 입력 필드에 동기화 */
const syncPose = (instance?: FacilityInstance) => {
  const size = baseSize.value
  if (instance)
    attempt(() =>
      Object.assign(pose, {
        name: instance.name,
        cutawayRole: instance.cutawayRole ?? 'auto',
        attachedTo: instance.attachedTo ?? '',
        ...resolveFacilityInstance(instance, map.document.ports).position,
        rotation: instance.rotation,
        carrierRotation: instance.carrierRotation ?? '',
        size: {
          x: displaySize((size?.x ?? 0) * (instance.scale?.x ?? 1)),
          y: displaySize((size?.y ?? 0) * (instance.scale?.y ?? 1)),
          z: displaySize((size?.z ?? 0) * (instance.scale?.z ?? 1)),
        },
        portId: instance.portId ?? '',
        nodeId: instance.nodeId === undefined ? '' : String(instance.nodeId),
      }),
    )
}

watch(
  () => [studio.selected, map.document, baseSize.value] as const,
  ([instance]) => syncPose(instance),
  { immediate: true },
)

/** 입력한 배치 치수를 기존 파일 형식에서 사용하는 축별 배율로 환산 */
const scaleFromSize = () => {
  const size = baseSize.value
  if (!size || sizeFields.some(({ axis }) => size[axis] <= 0))
    throw new Error('모델의 기준 치수를 확인하세요.')
  const { minimum, maximum } = facilityScaleLimits(selectedModel.value?.glb?.size)
  const scale = { x: 1, y: 1, z: 1 }
  for (const { axis, label } of sizeFields) {
    const value = Number(pose.size[axis])
    const current = studio.selected?.scale?.[axis] ?? 1
    const ratio = value === displaySize(size[axis] * current) ? current : value / size[axis]
    const doorMinimum = minimumDoorSize(axis)
    if (doorMinimum > 0 && ratio * size[axis] < doorMinimum - 0.000001)
      throw new Error(`부착한 문과 창문을 유지하려면 벽 ${label} 치수를 ${doorMinimum} mm 이상으로 설정하세요.`)
    const min = minimum[axis]
    const max = maximum[axis]
    if (!Number.isFinite(ratio) || ratio < min * (1 - 1e-10) || ratio > max * (1 + 1e-10))
      throw new Error(
        `${label}는 ${displaySize(size[axis] * min)}~${displaySize(size[axis] * max)} mm로 입력하세요.`,
      )
    scale[axis] = Math.max(min, Math.min(max, ratio))
  }
  return scale
}

/** 부착한 문의 위치와 크기를 유지하는 데 필요한 벽의 축별 최소 치수 */
const minimumDoorSize = (axis: SizeAxis) =>
  axis === 'x' ? doorLimits.value.width : axis === 'z' ? doorLimits.value.height : 0

/**
 * 자유 편집한 부품 모델을 라이브러리와 기존 배치에 함께 적용하는 모델 저장
 * @param asset 공유 계약 검증을 통과한 사용자 모델
 */
const applyModel = (asset: FacilityAsset) => {
  studio.setAsset(asset, reference.value)
  error.value = ''
  studio.message =
    '사용자 모델을 적용했습니다. 포트를 선택해 배치할 수 있으며 같은 모델의 기존 배치에도 변경이 반영됩니다.'
}

/** 바닥 지점 입력을 시작하고 기존 경계를 다시 그리는 경우 수정 대상을 고정 */
const startFloor = (shape: 'rectangle' | 'polygon', replaceId?: string) => {
  attempt(() => {
    if (!tutorial.value && map.document.units !== 'mm') throw new Error('바닥을 배치하기 전에 2D 맵 축척을 확정하세요.')
    studio.selectedId = null
    floorId.value = replaceId ?? ''
    floorDraft.value = { shape, points: [], replaceId }
    tool.value = 'floor'
  })
}

/** 유효한 바닥 경계를 기존 3D 문서의 실행 취소 이력에 하나의 변경으로 기록 */
const applyFloorBoundary = (points: FloorPoint[], replaceId?: string) => {
  const floor = floorAreas.value.find((area) => area.id === replaceId)
  const preset = floorMaterials[floorMaterial.value]
  const area: FloorArea = floor
    ? { ...floor, points }
    : {
        id: crypto.randomUUID(),
        name: `바닥 영역 ${floorAreas.value.length + 1}`,
        points,
        material: floorMaterial.value,
        color: preset.color,
        repeatMm: preset.repeatMm,
        rotation: 0,
      }
  studio.commit((document) => {
    document.floors = floor
      ? (document.floors ?? []).map((item) => item.id === floor.id ? area : item)
      : [...(document.floors ?? []), area]
    if (!document.mapRef.geometryKey) document.mapRef = reference.value
  })
  selectFloor(area.id)
}

/** 선택 바닥의 재질과 이름 및 반복 치수를 검증하고 적용 */
const updateFloor = (area: FloorArea) => {
  attempt(() => studio.commit((document) => {
    document.floors = document.floors?.map((item) => item.id === area.id ? area : item)
  }))
}

/** 인접 영역과 그리는 순서를 바꿔 겹치는 부분에서 표시할 재질 지정 */
const moveFloor = (offset: number) => {
  const index = floorAreas.value.findIndex((area) => area.id === floorId.value)
  const next = index + offset
  if (index < 0 || next < 0 || next >= floorAreas.value.length) return
  attempt(() => studio.commit((document) => {
    const areas = document.floors!
    const area = areas[index]!
    areas[index] = areas[next]!
    areas[next] = area
  }))
}

/** 선택 바닥을 제거하고 실행 취소로 복구할 수 있도록 이력 기록 */
const removeFloor = () => {
  attempt(() => studio.commit((document) => {
    document.floors = document.floors?.filter((area) => area.id !== floorId.value)
  }))
  floorId.value = ''
}

/** 마지막 점을 첫 점과 연결하여 다각형을 완성 */
const finishFloor = () => {
  const draft = floorDraft.value
  if (draft?.shape === 'polygon' && draft.points.length >= 3)
    attempt(() => applyFloorBoundary(draft.points, draft.replaceId))
}

/** 캔버스에서 Enter가 입력되면 작성 중인 다각형을 확정 */
const finishFloorOnEnter = (event: KeyboardEvent) => {
  if (!(event.target instanceof HTMLCanvasElement) || event.isComposing || !floorDraft.value) return
  if (floorDraft.value.shape !== 'polygon' || floorDraft.value.points.length < 3) return
  event.preventDefault()
  finishFloor()
}

/** 그리는 도중 마지막으로 찍은 꼭짓점을 제거 */
const undoFloorPoint = () => {
  const draft = floorDraft.value
  if (draft) floorDraft.value = { ...draft, points: draft.points.slice(0, -1) }
}

/** 사각형의 맞은편 모서리를 확정하거나 다각형 꼭짓점을 추가 */
const addFloorBoundaryPoint = (draft: NonNullable<typeof floorDraft.value>, point: FloorPoint) => {
  const firstPoint = draft.points[0]
  if (draft.shape === 'rectangle' && firstPoint) {
    const { x, y } = point
    applyFloorBoundary([
      firstPoint, { x, y: firstPoint.y }, point, { x: firstPoint.x, y },
    ], draft.replaceId)
    return
  }
  if (draft.points.length >= MAX_FLOOR_POINTS) throw new Error('최대 꼭짓점 수에 도달했습니다.')
  floorDraft.value = { ...draft, points: [...draft.points, point] }
}

/** 기준 도면을 위에서 보며 벽의 중심선을 입력하는 전용 도구 시작 */
const startWall = () => {
  attempt(() => {
    if (!tutorial.value && map.document.units !== 'mm') throw new Error('먼저 2D 맵의 실측 축척을 설정하세요.')
    catalogOpen.value = false
    studio.selectedId = null
    floorId.value = ''
    wallStart.value = undefined
    if (map.document.layout) floorPlanVisible.value = true
    tool.value = 'wall'
    void nextTick(() => scene?.fit(true))
  })
}

/**
 * 두 끝점과 실측 치수로 편집 가능한 벽체 배치
 * 벽체 등록과 배치를 하나의 편집 이력으로 기록하고 개구부와 투명도 편집 지원
 *
 * @param start 벽 중심선의 시작점
 * @param end 벽 중심선의 끝점
 */
const placeWallBetweenPoints = (start: FloorPoint, end: FloorPoint) => {
  const model = studio.document.assets.find((asset) => asset.id === wallPreset.id) ?? wallPreset
  const body = wallBody(model)
  if (!body) throw new Error('기본 벽체의 형상이 변경되었습니다. 벽체 부품을 확인하세요.')
  const { thickness, height } = wallSize
  if (!Number.isFinite(thickness) || thickness <= 0 || !Number.isFinite(height) || height <= 0)
    throw new Error('벽 두께와 높이를 0보다 큰 값으로 입력하세요.')
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 10) throw new Error('시작점과 다른 위치에서 벽을 끝내세요.')
  studio.place((start.x + end.x) / 2, (start.y + end.y) / 2, undefined, {
    rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
    scale: { x: length / body.size.x, y: thickness / body.size.y, z: height / body.size.z },
  }, { asset: model, mapRef: reference.value })
}

/** 활성 도구에 따라 바닥 클릭을 경계 입력이나 벽 및 모델 배치로 전달 */
const handleFloorClick = (worldX: number, worldY: number) => {
  attempt(() => {
    const draft = floorDraft.value
    const point = { x: worldX, y: worldY }
    if (tool.value === 'floor' && draft) {
      addFloorBoundaryPoint(draft, point)
      return
    }
    if (tool.value === 'ceiling') {
      if (ceilingStart.value) placeCeilingBetweenPoints(ceilingStart.value, point)
      else ceilingStart.value = point
      return
    }
    if (tool.value === 'wall') {
      const start = wallStart.value
      if (!start) {
        wallStart.value = point
        return
      }
      placeWallBetweenPoints(start, point)
      wallStart.value = undefined
      studio.message = '벽을 생성했습니다.'
      return
    }
    studio.place(worldX, worldY)
    tool.value = 'select'
  })
}

/** 드래그 중 투명도 백분율과 트랙 표시만 즉시 갱신 */
const previewWallTransparency = (event: Event) => {
  wallTransparencyDraft.value = (event.target as HTMLInputElement).valueAsNumber
}

/** 투명도를 저장 형식의 불투명도로 환산하고 조작 완료 시 한 번만 기록 */
const setWallTransparency = (event: Event) => {
  const instance = studio.selected
  if (!instance || !wallPart.value) return
  const opacity = (100 - (event.target as HTMLInputElement).valueAsNumber) / 100
  attempt(() => studio.updateInstance(instance.id, { wallOpacity: opacity }))
  wallTransparencyDraft.value = undefined
}

/**
 * 기준 지도 노드의 중심 좌표에 선택 모델을 추가하고 시점을 맞추는 중앙 배치
 */
const placeCenter = (event: Pick<MouseEvent, 'altKey'> = { altKey: false }) => {
  attempt(() => {
    const nodes = map.document.nodes
    const x = nodes.length ? nodes.reduce((sum, n) => sum + n.x, 0) / nodes.length : 0
    const y = nodes.length ? nodes.reduce((sum, n) => sum + n.y, 0) / nodes.length : 0
    studio.place(
      event.altKey ? x : snapToStep(x, snapStep.value),
      event.altKey ? y : snapToStep(y, snapStep.value),
    )
    tool.value = 'select'
    requestAnimationFrame(() => scene?.fit())
  })
}

/**
 * 현재 기준 맵에서 포트 식별자를 찾아 상대 오프셋이 없는 설비 한 개를 추가하는 포트 배치
 *
 * @param id 조회하거나 편집할 대상의 고유 식별자
 */
const placeAtPort = (id: string) => {
  attempt(() => {
    const port = map.document.ports.find((p) => p.id === id)
    if (!port) throw new Error('배치할 포트를 선택하세요.')
    studio.place(port.x, port.y, port.id)
    placementPort.value = port.id
    tool.value = 'select'
  })
}

/**
 * 노드와 포트 참조를 확인하고 속성 입력값을 배치 문서에 반영하는 설비 속성 적용
 */
const applyPose = () => {
  if (!studio.selected) return
  attempt(() => {
    if (linkedWallOpening.value) {
      studio.updateInstance(studio.selectedId!, { name: pose.name })
      return
    }
    if (pose.nodeId !== '' && !map.document.nodes.some((n) => n.id === Number(pose.nodeId)))
      throw new Error('기준 맵에 연결 Node ID가 없습니다.')
    if (pose.portId && !map.document.ports.some((p) => p.id === pose.portId))
      throw new Error('기준 맵에 연결 Port ID가 없습니다.')
    studio.applyPlacementPose(
      studio.selectedId!,
      {
        name: pose.name,
        cutawayRole: posedCutawayRole.value,
        attachedTo: selectedStructure.value ? undefined : pose.attachedTo || undefined,
        position: { x: Number(pose.x), y: Number(pose.y), z: Number(pose.z) },
        rotation: Number(pose.rotation),
        carrierRotation: pose.carrierRotation === '' ? undefined : Number(pose.carrierRotation),
        scale: scaleFromSize(),
        portId: pose.portId || undefined,
        nodeId: pose.nodeId === '' ? undefined : Number(pose.nodeId),
      },
      map.document.ports,
    )
  })
}

/**
 * 선택한 노드 또는 포트의 중심 좌표로 설비 배치를 맞추는 기준 위치 정렬
 *
 * @param kind 랙과 선반 및 조합 설비를 구분하는 설계 종류
 */
const align = (kind: 'node' | 'port') => {
  const point =
    kind === 'node'
      ? map.document.nodes.find((n) => n.id === Number(pose.nodeId))
      : map.document.ports.find((p) => p.id === pose.portId)
  if (!point) {
    error.value = '연결할 노드 또는 포트를 찾을 수 없습니다.'
    return
  }
  pose.x = point.x
  pose.y = point.y
  applyPose()
}

/** 새 파일과 모델명을 지정하는 등록 팝업 초기화 */
const openGlbImport = () => {
  glbFloorTarget.value = ''
  glbFile.value = undefined
  glbName.value = ''
  glbImportError.value = ''
  glbCategory.value = catalogCategory.value
  lightKind.value = 'spot'
  lightTemperature.value = '4000'
  glbImportOpen.value = true
}

/** 선택한 GLB의 크기와 확장자를 확인하고 파일명을 등록 이름으로 제안 */
const handleGlbFile = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  selectGlbFile(file)
}

/** 파일 선택기와 바닥 등록에서 공통 GLB 검증 및 미리보기 적용 */
const selectGlbFile = (file: File) => {
  const previousFileName = glbFile.value?.name.replace(/\.glb$/i, '')
  glbFile.value = undefined
  glbImportError.value = ''
  if (!file.name.toLowerCase().endsWith('.glb') || file.size > MAX_GLB_BYTES) {
    glbImportError.value = '단일 GLB 파일은 12MB 이하여야 합니다.'
    return
  }
  glbFile.value = file
  const preset = !glbFloorTarget.value && legacyFacilityLight(file.name)
  if (preset) {
    glbCategory.value = 'lighting'
    lightKind.value = preset.kind
    lightTemperature.value = String(preset.temperature)
  }
  if (!glbName.value.trim() || glbName.value === previousFileName)
    glbName.value = file.name.replace(/\.glb$/i, '')
}

/** 선택 바닥의 외곽 치수에 맞출 모델을 기존 등록 화면으로 연결 */
const importFloorModel = (file: File) => {
  if (!selectedFloor.value) return
  openGlbImport()
  glbFloorTarget.value = selectedFloor.value.id
  glbCategory.value = 'interior'
  selectGlbFile(file)
}

/** 선택한 GLB를 한 번만 읽고 같은 결과를 미리보기와 등록에 사용 */
watch([glbFile, glbImportOpen], async ([file, open], _, cleanup) => {
  glbDraft.value = undefined
  glbPreviewError.value = ''
  glbPreviewLoading.value = false
  if (!file || !open) return

  const cache = new GlbModelCache()
  let cancelled = false
  glbPreviewLoading.value = true
  cleanup(() => {
    cancelled = true
    cache.dispose()
  })

  try {
    const bytes = await file.arrayBuffer()
    if (cancelled) return
    const model = await cache.load(bytes)
    if (!cancelled) glbDraft.value = { file, bytes, model }
  } catch (cause) {
    if (!cancelled) glbImportError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (!cancelled) glbPreviewLoading.value = false
  }
})

/** 팝업 캔버스와 GLB 미리보기의 생성과 정리를 연결 */
watch([glbPreviewHost, glbDraft], ([element, draft], _, cleanup) => {
  if (!element || !draft) return
  try {
    const preview = createGlbImportPreview(element, draft.model, map.colorMode === 'dark')
    glbPreview = preview
    cleanup(() => {
      preview.dispose()
      glbPreview = undefined
    })
  } catch {
    glbPreviewError.value = '3D 미리보기를 표시할 수 없습니다.'
  }
}, { flush: 'post' })

/** 검증된 GLB에 UUID를 발급하고 지정한 치수와 이름으로 등록 */
const registerGlb = async () => {
  const file = glbFile.value
  const draft = glbDraft.value
  const size = glbDimensions.value
  if (!file || draft?.file !== file || !size || studio.busy || catalogLoading.value || glbNameError.value) return
  if (glbCategory.value === 'lighting' && lightError.value) return

  glbImportError.value = ''
  studio.busy = true
  try {
    const resource = window.desktop?.stageSceneModel
      ? await window.desktop.stageSceneModel(draft.bytes)
      : { data: await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
          reader.onerror = () => reject(new Error('GLB 파일을 읽을 수 없습니다.'))
          reader.readAsDataURL(file)
        }) }
    const asset: FacilityAsset = {
      id: crypto.randomUUID(),
      name: glbName.value.trim(),
      kind: 'equipment',
      parts: [],
      catalogCategory: glbCategory.value,
      glb: { ...resource, size, sourceName: file.name },
      ...(glbCategory.value === 'lighting' ? { light: lightSettings.value } : {}),
    }
    if (glbFloorTarget.value) {
      const area = floorAreas.value.find(({ id }) => id === glbFloorTarget.value)
      if (!area) throw new Error('GLB를 배치할 바닥 영역을 다시 선택하세요.')
      const minX = Math.min(...area.points.map(({ x }) => x))
      const maxX = Math.max(...area.points.map(({ x }) => x))
      const minY = Math.min(...area.points.map(({ y }) => y))
      const maxY = Math.max(...area.points.map(({ y }) => y))
      const instance: FacilityInstance = {
        id: crypto.randomUUID(), assetId: asset.id, name: asset.name,
        position: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: 0 }, rotation: 0,
        scale: { x: (maxX - minX) / size.x, y: (maxY - minY) / size.y, z: 1 },
      }
      studio.addPlacements(asset, [instance], reference.value)
      floorId.value = ''
      studio.selectedId = instance.id
      tool.value = 'select'
    } else studio.setAsset(asset, reference.value)

    error.value = ''
    catalogCategory.value = glbCategory.value
    glbImportOpen.value = false
    glbFile.value = undefined
    studio.message = glbFloorTarget.value
      ? '바닥 영역의 외곽 크기에 맞춰 GLB를 배치했습니다. 위치와 두께를 속성에서 조정하세요.'
      : 'GLB 모델을 등록했습니다. 카탈로그에서 맵으로 끌어다 놓으세요.'
    glbFloorTarget.value = ''
  } catch (cause) {
    glbImportError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    studio.busy = false
  }
}

const openLightSettings = (asset: FacilityAsset) => {
  const light = facilityLight(asset)
  if (!light) return
  lightKind.value = light.kind
  lightTemperature.value = String(light.temperature)
  lightEditId.value = asset.id
}

const saveLightSettings = () => {
  const asset = editingLight.value
  if (!asset || lightError.value) return
  if (attempt(() => studio.setAsset({ ...asset, catalogCategory: 'lighting', light: lightSettings.value }, reference.value)))
    lightEditId.value = ''
}

const assetById = computed(() => new Map(studio.document.assets.map((asset) => [asset.id, asset])))
const structures = computed(() => studio.document.instances.flatMap((instance) => {
  const asset = assetById.value.get(instance.assetId)
  if (!asset) return []
  const role = facilityCutawayRole(instance, asset)
  return role ? [{ instance, asset, role }] : []
}))
const wallTargets = computed(() => structures.value.filter(({ role, asset }) => role === 'wall' && wallBody(asset)))
const ceilingTargets = computed(() => structures.value.filter(({ role }) => role === 'ceiling'))
const structureIds = computed(() => new Set(structures.value.map(({ instance }) => instance.id)))
const wallMounts = computed(() => {
  const frame = wallFrame.value
  if (!frame) return []
  const openingModels = new Set(frame.instance.wallDoors?.map(({ modelId }) => modelId))
  return studio.document.instances.flatMap((instance) => {
    if (instance.attachedTo !== frame.instance.id || openingModels.has(instance.id)) return []
    const asset = assetById.value.get(instance.assetId)
    if (!asset) return []
    const placed = resolveFacilityInstance(instance, map.document.ports)
    const bounds = facilityModelBounds(asset)
    const sx = placed.scale?.x ?? 1
    const sy = placed.scale?.y ?? 1
    const sz = placed.scale?.z ?? 1
    const assetCenter = transformPlanPoint({
      x: (bounds.min.x + bounds.max.x) * sx / 2, y: (bounds.min.y + bounds.max.y) * sy / 2,
    }, placed.rotation - frame.instance.rotation)
    const point = transformPlanPoint({
      x: placed.position.x - frame.instance.position.x, y: placed.position.y - frame.instance.position.y,
    }, -frame.instance.rotation)
    return [{
      id: placed.id, name: placed.name, x: point.x - frame.center.x + assetCenter.x,
      y: placed.position.z - frame.instance.position.z - frame.center.z + (bounds.min.z + bounds.max.z) * sz / 2,
    }]
  })
})
const independentInstances = computed(() => studio.document.instances.filter(({ id }) => !structureIds.value.has(id)))
const selectedStructureRole = computed(() => studio.selected && facilityCutawayRole(studio.selected, selectedModel.value))
/** 구조물과 부착 관계에 따라 모델을 한 위치에 표시하는 탐색 계층 구성 */
const sceneGroups = computed(() => {
  const facility: SceneExplorerEntry[] = [], building: SceneExplorerEntry[] = [], lighting: SceneExplorerEntry[] = []
  const walls: SceneExplorerEntry[] = [], ceilings: SceneExplorerEntry[] = []
  const mounted = new Map<string, SceneExplorerEntry[]>()
  const entry = (instance: FacilityInstance): SceneExplorerEntry => ({
    id: instance.id, name: instance.name, kind: 'instance', detail: assetById.value.get(instance.assetId)?.name ?? instance.assetId,
    selected: selectedIds.value.has(instance.id),
  })
  for (const instance of studio.document.instances) {
    const host = instance.attachedTo
    if (!host || !structureIds.value.has(host)) continue
    const children = mounted.get(host) ?? []
    children.push(entry(instance))
    mounted.set(host, children)
  }
  for (const instance of studio.document.instances) {
    if (instance.attachedTo && structureIds.value.has(instance.attachedTo)) continue
    const asset = assetById.value.get(instance.assetId)
    const role = facilityCutawayRole(instance, asset)
    const row = entry(instance)
    if (role) {
      const children = mounted.get(instance.id) ?? []
      for (const opening of instance.wallDoors ?? []) {
        if (opening.modelId) continue
        children.push({
          id: opening.id, parentId: instance.id, name: opening.kind === 'window' ? '창문' : '문', kind: 'opening',
          detail: `${displaySize(opening.width)} × ${displaySize(opening.height)} mm`,
          selected: wallHostId.value === instance.id && focusedOpening.value === opening.id &&
            workspace.value === 'building' && buildingView.value === 'wall',
        })
      }
      ;(role === 'wall' ? walls : ceilings).push({ ...row, children })
    } else if (asset && (asset.catalogCategory === 'lighting' || facilityLight(asset))) lighting.push(row)
    else if (asset?.catalogCategory === 'interior') building.push(row)
    else facility.push(row)
  }
  for (const area of floorAreas.value) building.push({
    id: area.id, name: area.name, detail: '바닥 영역', kind: 'floor', selected: floorId.value === area.id,
    disabled: studio.busy || !!floorDraft.value,
  })
  return [
    { id: 'facility', name: 'Facility', kind: 'group', children: facility },
    { id: 'building', name: 'Building', kind: 'group', count: building.length + walls.length + ceilings.length, children: [
      ...building,
      { id: 'walls', name: '벽', kind: 'group', children: walls },
      { id: 'ceilings', name: '천장', kind: 'group', children: ceilings },
    ] },
    { id: 'lighting', name: 'Lighting', kind: 'group', children: lighting },
  ] satisfies SceneExplorerEntry[]
})
const explorer = ref<HTMLElement>()
/** 뷰포트와 편집기에서 선택한 객체의 접힌 상위 경로 펼치기 */
watch([() => studio.selectedIds, floorId, focusedOpening, () => studio.document], () => {
  for (const row of explorer.value?.querySelectorAll('[aria-pressed="true"]') ?? []) {
    let branch = row.closest('details')
    while (branch) {
      branch.open = true
      branch = branch.parentElement?.closest('details') ?? null
    }
  }
}, { flush: 'post' })

/** 장면 탐색 항목을 기존 바닥과 설비 또는 개구부 선택에 연결 */
const selectExplorerItem = (item: SceneExplorerEntry, toggle: boolean) => {
  if (tutorial.value && item.kind === 'instance' && item.id === tutorialInstance.value?.id)
    tutorialExplorerSelected.value = true
  if (item.kind === 'floor') selectFloor(item.id)
  else if (item.kind === 'opening' && item.parentId) showOpeningEditor(item.parentId, item.id)
  else if (item.kind === 'instance') selectInstances([item.id], toggle ? 'toggle' : 'replace')
}

/** 연결된 개구부의 벽 정면과 편집 손잡이 활성화 */
function showOpeningEditor(wallId: string, openingId: string) {
  switchWorkspace('building')
  menu.value = 'Building'
  if (buildingView.value !== 'wall') switchBuildingView('wall')
  openWall(wallId)
  focusWallOpening(openingId)
}
/** 선택된 모델과 함께 편집할 벽 개구부 조회 */
const linkedWallOpening = computed(() => {
  const host = studio.selected?.attachedTo
  if (!host) return
  const wall = wallTargets.value.find(({ instance }) => instance.id === host)?.instance
  const opening = wall?.wallDoors?.find(({ modelId }) => modelId === studio.selected?.id)
  if (opening) return { wallId: host, openingId: opening.id }
})
/** 선택 모델이 부착된 벽의 편집 좌표계 조회 */
const selectedMountFrame = computed(() => {
  const target = wallTargets.value.find(({ instance }) => instance.id === studio.selected?.attachedTo)
  return target && wallMountFrame(resolveFacilityInstance(target.instance, map.document.ports), target.asset)
})
const mountedOffset = computed(() => {
  const frame = selectedMountFrame.value
  if (!frame) return
  const local = wallLocalPoint(frame.instance, { x: pose.x, y: pose.y, z: pose.z })
  return { x: displaySize(local.x - frame.center.x), z: displaySize(local.z - frame.center.z) }
})

/** 부착면까지의 거리를 유지하면서 벽 기준 위치와 높이 변경 */
const setMountedOffset = (axis: 'x' | 'z', value: string) => {
  const frame = selectedMountFrame.value
  if (!frame || !value.trim() || !Number.isFinite(Number(value))) return
  const local = wallLocalPoint(frame.instance, { x: pose.x, y: pose.y, z: pose.z })
  local[axis] = frame.center[axis] + Number(value)
  Object.assign(pose, wallWorldPoint(frame.instance, local))
}
const selectedLight = computed(() => selectedModel.value && facilityLight(selectedModel.value))
const placementLight = computed(() => studio.asset && facilityLight(studio.asset))
const wallFrame = computed(() => {
  const target = wallTargets.value.find(({ instance }) => instance.id === wallHostId.value)
  if (!target) return
  return wallMountFrame(resolveFacilityInstance(target.instance, map.document.ports), target.asset)
})
const ceilingFrame = computed(() => {
  const target = ceilingTargets.value.find(({ instance }) => instance.id === ceilingHostId.value)
  if (!target) return
  const bounds = facilityModelBounds(target.asset)
  if (bounds.isEmpty()) return
  const instance = resolveFacilityInstance(target.instance, map.document.ports)
  const sx = instance.scale?.x ?? 1
  const sy = instance.scale?.y ?? 1
  const sz = instance.scale?.z ?? 1
  const width = (bounds.max.x - bounds.min.x) * sx
  const depth = (bounds.max.y - bounds.min.y) * sy
  if (width <= 0 || depth <= 0) return
  return {
    instance, width, depth,
    center: { x: (bounds.min.x + bounds.max.x) * sx / 2, y: (bounds.min.y + bounds.max.y) * sy / 2 },
    underside: instance.position.z + bounds.min.z * sz,
  }
})
const ceilingFixtures = computed(() => {
  const frame = ceilingFrame.value
  if (!frame) return []
  return studio.document.instances.flatMap((fixture) => {
    if (fixture.attachedTo !== frame.instance.id) return []
    const asset = assetById.value.get(fixture.assetId)
    if (!asset) return []
    const placed = resolveFacilityInstance(fixture, map.document.ports)
    const bounds = facilityModelBounds(asset)
    const size = facilityModelSize(asset)
    const rotation = placed.rotation - frame.instance.rotation
    const assetCenter = transformPlanPoint({
      x: (bounds.min.x + bounds.max.x) * (placed.scale?.x ?? 1) / 2,
      y: (bounds.min.y + bounds.max.y) * (placed.scale?.y ?? 1) / 2,
    }, rotation)
    const local = transformPlanPoint({
      x: placed.position.x - frame.instance.position.x,
      y: placed.position.y - frame.instance.position.y,
    }, -frame.instance.rotation)
    return [{
      id: fixture.id, name: fixture.name, x: local.x - frame.center.x + assetCenter.x, y: local.y - frame.center.y + assetCenter.y,
      width: size.x * (fixture.scale?.x ?? 1), depth: size.y * (fixture.scale?.y ?? 1),
      rotation,
    }]
  })
})
const buildingLocked = computed(() => studio.busy)
const showScene = computed(() => sitePreview.value || workspace.value === 'equipment' || buildingView.value === 'structure')
const mounting = computed(() => workspace.value === 'building' && buildingView.value !== 'structure')
const canAttachSelection = computed(() => studio.selectedIds.length > 0 &&
  studio.selectedIds.every((id) => !structureIds.value.has(id)))

function transformPlanPoint({ x, y }: FloorPoint, rotation: number): FloorPoint {
  const angle = rotation * Math.PI / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

function localToMap(instance: FacilityInstance, point: FloorPoint): FloorPoint {
  const rotated = transformPlanPoint(point, instance.rotation)
  return { x: instance.position.x + rotated.x, y: instance.position.y + rotated.y }
}

function switchWorkspace(value: typeof workspace.value) {
  if (workspace.value === value) return
  if (sitePreview.value) toggleSitePreview()
  workspace.value = value
  switchBuildingView('structure')
  if (value === 'equipment') void nextTick(() => scene?.fit())
}

function switchBuildingView(view: typeof buildingView.value) {
  buildingView.value = view
  catalogOpen.value = false
  mountAsset.value = undefined
  endCatalogDrag()
  layoutOpen.value = false
  tool.value = 'select'
  if (view === 'structure') {
    if (workspace.value === 'building') void nextTick(() => scene?.fit(true))
  } else if (view === 'wall') {
    const preferred = selectedStructureRole.value === 'wall' ? studio.selectedId : studio.selected?.attachedTo
    openWall(wallTargets.value.find(({ instance }) => instance.id === preferred)?.instance.id ||
      wallTargets.value.find(({ instance }) => instance.id === wallHostId.value)?.instance.id ||
      wallTargets.value[0]?.instance.id || '')
  } else {
    const preferred = selectedStructureRole.value === 'ceiling' ? studio.selectedId : studio.selected?.attachedTo
    openCeiling(ceilingTargets.value.find(({ instance }) => instance.id === preferred)?.instance.id ||
      ceilingTargets.value.find(({ instance }) => instance.id === ceilingHostId.value)?.instance.id ||
      ceilingTargets.value[0]?.instance.id || '')
  }
}

/** 구조 명령 실행을 선택했을 때 기존 건물 편집 모드로 전환 */
const runBuildingTool = (action: () => void) => {
  if (workspace.value === 'building') action()
  else {
    switchWorkspace('building')
    void nextTick(action)
  }
}

function openWall(id: string) {
  wallHostId.value = id
  studio.selectedId = id || null
  focusedOpening.value = ''
}

function openCeiling(id: string) {
  ceilingHostId.value = id
  studio.selectedId = id || null
}

const markAsWall = () => {
  if (!studio.selected || buildingLocked.value) return
  attempt(() => studio.updateInstance(studio.selected!.id, { cutawayRole: 'wall', attachedTo: undefined }))
}

const pickExistingObject = (id: string) => {
  if (id) selectInstances([id], 'replace')
}

const attachSelected = (target: string) => {
  if (!canAttachSelection.value || buildingLocked.value) return
  if (attempt(() => studio.attachInstances(studio.selectedIds, target || undefined)))
    studio.message = target ? '선택한 객체를 구조물에 연결했습니다.' : '선택한 객체의 연결을 해제했습니다.'
}

const startCeiling = () => {
  attempt(() => {
    if (map.document.units !== 'mm') throw new Error('실측 축척이 있는 기준 맵이 필요합니다.')
    studio.selectedId = null
    floorId.value = ''
    ceilingStart.value = undefined
    tool.value = 'ceiling'
    void nextTick(() => scene?.fit(true))
  })
}

const placeCeilingBetweenPoints = (start: FloorPoint, end: FloorPoint) => {
  const width = Math.abs(end.x - start.x)
  const depth = Math.abs(end.y - start.y)
  if (Math.min(width, depth) < 10) throw new Error('천장 모서리를 서로 다른 위치에 지정하세요.')
  if (!Number.isFinite(ceilingHeight.value) || ceilingHeight.value <= 0)
    throw new Error('천장 높이를 0보다 큰 값으로 입력하세요.')
  const asset = studio.document.assets.find(({ id }) => id === ceilingPreset.id) ?? ceilingPreset
  const size = facilityModelSize(asset)
  studio.place((start.x + end.x) / 2, (start.y + end.y) / 2, undefined, {
    z: ceilingHeight.value, scale: { x: width / size.x, y: depth / size.y, z: 1 },
  }, { asset, mapRef: reference.value })
  studio.message = '천장 패널을 추가했습니다.'
  tool.value = 'select'
}

const addOpeningToWall = (kind: 'door' | 'window') => {
  const frame = wallFrame.value
  if (!frame || buildingLocked.value) return
  const doors = frame.instance.wallDoors ?? []
  const window = kind === 'window'
  attempt(() => {
    const { width, height } = frame
    let best = { left: -width / 2, width: 0 }
    let left = -width / 2
    for (const door of doors) {
      const gap = door.offset - door.width / 2 - left
      if (gap > best.width) best = { left, width: gap }
      left = door.offset + door.width / 2
    }
    const gap = width / 2 - left
    if (gap > best.width) best = { left, width: gap }
    if (best.width < 100 || height < 200) throw new Error('벽에 문이나 창문을 추가할 공간이 없습니다.')
    const openingWidth = Math.min(best.width, window ? 1200 : 1040)
    const openingHeight = Math.min(height, window ? 1000 : 2160)
    const center = snapToStep(best.left + best.width / 2, snapStep.value)
    const offset = Math.max(best.left + openingWidth / 2, Math.min(best.left + best.width - openingWidth / 2, center))
    const opening: WallDoor = {
      id: crypto.randomUUID(), offset, width: openingWidth, height: openingHeight,
      ...(window ? { kind: 'window', sill: Math.min(900, height - openingHeight) } : {}),
    }
    studio.updateInstance(frame.instance.id, { wallDoors: [...doors, opening] })
    focusWallOpening(opening.id)
  })
}

function focusWallOpening(id: string) {
  if (!wallFrame.value) return
  studio.selectedId = wallFrame.value.instance.id
  focusedOpening.value = id
}

/** 벽면 도구의 대기 모델과 화면 상태 초기화 */
const cancelWallMount = () => {
  mountAsset.value = undefined
  if (tool.value === 'mount') tool.value = 'select'
}

/** 현재 모델을 선택한 벽면에 붙이는 도구 실행 */
const startWallMount = () => {
  if (tool.value === 'mount') return cancelWallMount()
  runBuildingTool(() => {
    if (buildingView.value === 'ceiling') switchBuildingView('structure')
    mountKind.value = 'surface'
    tool.value = 'mount'
    if (studio.asset && studio.asset.id !== wallPreset.id && studio.asset.id !== ceilingPreset.id) {
      mountAsset.value = studio.asset
      catalogOpen.value = false
    } else void openCatalog()
  })
}

/** 보이는 면과 스냅 위치를 기준으로 미리보기와 확정에 같은 벽 부착 변환 사용 */
const getWallMount = (
  asset: FacilityAsset,
  frame: NonNullable<ReturnType<typeof wallMountFrame>>,
  point: FloorPoint,
  rear: boolean,
  free: boolean,
  commit: boolean,
): WallMountPreview | undefined => {
  const bounds = asset === mountAsset.value ? mountBounds.value : facilityModelBounds(asset)
  if (!bounds || bounds.isEmpty()) return
  const { min, max } = bounds
  const width = max.x - min.x, height = max.z - min.z
  if (width > frame.width + 0.000001 || height > frame.height + 0.000001) return
  const half = Math.max(0, (frame.width - width) / 2)
  const maxSill = Math.max(0, frame.height - height)
  const snap = (value: number) => free ? value : snapToStep(value, snapStep.value)
  const offset = Math.max(-half, Math.min(half, snap(point.x)))
  const sill = mountKind.value === 'door' ? 0 : Math.max(0, Math.min(maxSill, snap(point.y - height / 2)))
  const side = rear ? -1 : 1
  const rotation = (frame.instance.rotation + (rear ? 180 : 0)) % 360
  const position = wallWorldPoint(frame.instance, {
    x: frame.center.x + offset - side * (min.x + max.x) / 2,
    y: frame.center.y - side * (frame.depth / 2 + max.y),
    z: frame.center.z + sill - min.z,
  })
  let opening: WallDoor | undefined
  const size = asset.glb?.size
  if (mountKind.value !== 'surface') {
    if (!size || width < 100 || height < 200) return
    if ((frame.instance.wallDoors?.length ?? 0) >= 24 || frame.instance.wallDoors?.some((existing) =>
      Math.abs(existing.offset - offset) < (existing.width + width) / 2)) return
    opening = {
      id: commit ? crypto.randomUUID() : '',
      width, height, offset, ...(mountKind.value === 'window' ? { kind: 'window', sill } : {}),
    }
  }
  const pose = opening && size ? wallOpeningPose(frame, opening, size, rear) : { position, rotation, scale: { x: 1, y: 1, z: 1 } }
  if (commit) {
    validateCatalogPlacement(asset)
    if (opening) studio.placeWallOpening(asset, reference.value, frame.instance.id, opening, pose)
    else studio.place(position.x, position.y, undefined, {
      z: position.z, rotation, attachedTo: frame.instance.id, cutawayRole: 'independent',
    }, { asset, mapRef: reference.value })
    cancelWallMount()
    studio.message = `${asset.name} · ${frame.instance.name}에 부착했습니다.`
  }
  return {
    position: pose.position,
    rotation: pose.rotation,
    wall: {
      position: wallWorldPoint(frame.instance, { ...frame.center, z: frame.center.z + frame.height / 2 }),
      size: { x: frame.width, y: frame.depth, z: frame.height },
      rotation: frame.instance.rotation,
    },
  }
}

/** 삼차원 포인터에 닿은 벽의 면을 판별하고 부착 작업 실행 */
const mountWallAtPointer = (id: string, point: Point3, free: boolean, commit: boolean) => {
  const asset = mountAsset.value
  const target = wallTargets.value.find(({ instance }) => instance.id === id)
  if (!asset || !target || buildingLocked.value) return
  const frame = wallMountFrame(resolveFacilityInstance(target.instance, map.document.ports), target.asset)
  if (!frame) return
  const local = wallLocalPoint(frame.instance, point)
  const wallPoint = { x: local.x - frame.center.x, y: local.z - frame.center.z }
  const rear = local.y > frame.center.y
  if (!commit) return getWallMount(asset, frame, wallPoint, rear, free, false)
  attempt(() => {
    if (!getWallMount(asset, frame, wallPoint, rear, free, true))
      throw new Error('모델의 폭과 높이 및 기존 개구부와의 간격을 확인하세요.')
  })
}

const placeMountedAsset = (asset: FacilityAsset, point: FloorPoint, free = false) => {
  if (buildingLocked.value) return
  attempt(() => {
    validateCatalogPlacement(asset)
    const roof = buildingView.value === 'ceiling' ? ceilingFrame.value : undefined
    const wall = buildingView.value === 'wall' ? wallFrame.value : undefined
    if (wall) {
      if (!getWallMount(asset, wall, point, false, free, true))
        throw new Error('모델의 폭과 높이 및 기존 개구부와의 간격을 확인하세요.')
      return
    }
    const frame = roof
    if (!frame) throw new Error('부착할 벽이나 천장을 먼저 선택하세요.')
    const bounds = facilityModelBounds(asset)
    if (bounds.isEmpty()) throw new Error('이 모델의 배치 치수를 확인하세요.')
    const position = localToMap(frame.instance, {
      x: frame.center.x + point.x - (bounds.min.x + bounds.max.x) / 2,
      y: frame.center.y + point.y - (bounds.min.y + bounds.max.y) / 2,
    })
    const z = roof.underside - bounds.max.z
    studio.place(position.x, position.y, undefined, {
      z, cutawayRole: 'independent', attachedTo: frame.instance.id, rotation: frame.instance.rotation,
    }, { asset, mapRef: reference.value })
    mountAsset.value = undefined
    studio.message = `${asset.name} · ${frame.instance.name}에 연결했습니다.`
  })
}

const placePendingMount = (point: FloorPoint, free = false) => {
  if (mountAsset.value) placeMountedAsset(mountAsset.value, point, free)
}

const dropMountedAsset = (event: DragEvent, point: FloorPoint) => {
  const id = event.dataTransfer?.getData(catalogDragType)
  const asset = id && id === draggingModelId.value ? catalogAssets.value.find((item) => item.id === id) : undefined
  endCatalogDrag()
  if (!asset || buildingLocked.value) return
  event.preventDefault()
  placeMountedAsset(asset, point, event.altKey)
}

const moveCeilingFixture = (fixture: Pick<FacilityInstance, 'id' | 'rotation'> & FloorPoint) => {
  const frame = ceilingFrame.value
  const instance = studio.document.instances.find(({ id }) => id === fixture.id)
  const asset = instance && assetById.value.get(instance.assetId)
  if (!frame || !instance || !asset || instance.attachedTo !== frame.instance.id || buildingLocked.value) return
  const bounds = facilityModelBounds(asset)
  const offset = transformPlanPoint({
    x: (bounds.min.x + bounds.max.x) * (instance.scale?.x ?? 1) / 2,
    y: (bounds.min.y + bounds.max.y) * (instance.scale?.y ?? 1) / 2,
  }, fixture.rotation)
  const position = localToMap(frame.instance, {
    x: frame.center.x + fixture.x - offset.x, y: frame.center.y + fixture.y - offset.y,
  })
  const z = resolveFacilityInstance(instance, map.document.ports).position.z
  attempt(() => studio.applyPlacementPose(instance.id, {
    position: { ...position, z }, rotation: (frame.instance.rotation + fixture.rotation) % 360,
  }, map.document.ports))
}

/** 우측 카탈로그를 열고 기본 모델을 한 번만 조회 */
const openCatalog = async (category?: typeof catalogCategory.value) => {
  error.value = ''
  if (category) catalogCategory.value = category
  else if (workspace.value === 'building') catalogCategory.value = buildingView.value === 'ceiling' ? 'lighting' : 'interior'
  catalogOpen.value = true
  if (tutorial.value) return
  if (defaultCatalog.value || catalogLoading.value) return
  catalogLoading.value = true
  try {
    defaultCatalog.value = (await loadDefaultCatalog()).assets
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    catalogLoading.value = false
  }
}

/** 기본 인테리어 배치에 필요한 기준 지도의 실측 축척 검증 */
const validateCatalogPlacement = (asset: FacilityAsset) => {
  if (map.document.units !== 'mm' && interiorCatalog.some((model) => model.id === asset.id))
    throw new Error('인테리어를 배치하기 전에 2D 맵 축척을 확정하세요.')
}

/** 카탈로그에서 모델을 선택하고 벽 그리기 또는 바닥 배치로 전환 */
const chooseCatalogModel = (asset: FacilityAsset) => {
  if (mounting.value || tool.value === 'mount') {
    if (!asset.glb) mountKind.value = 'surface'
    mountAsset.value = asset
    catalogOpen.value = false
    return
  }
  if (asset.id === wallPreset.id && workspace.value === 'building') {
    startWall()
    return
  }
  attempt(() => {
    validateCatalogPlacement(asset)
    if (studio.document.assets.some((item) => item.id === asset.id)) studio.selectedAssetId = asset.id
    else studio.setAsset(asset, reference.value)
    catalogOpen.value = false
    wallStart.value = undefined
    floorId.value = ''
    tool.value = 'place'
    studio.message = `${asset.name} · 배치할 바닥 위치를 클릭하세요.`
  })
}

/** 카탈로그 드래그 상태와 캔버스 강조를 함께 정리 */
const endCatalogDrag = () => {
  draggingModelId.value = ''
  catalogDropTarget.value = false
}

/** 현재 패널에서 끌기 시작한 모델 식별자를 브라우저 드래그 데이터에 등록 */
const startCatalogDrag = (event: DragEvent, asset: FacilityAsset) => {
  if (!event.dataTransfer) return
  draggingModelId.value = asset.id
  if (tool.value === 'mount' && showScene.value) {
    if (!asset.glb) mountKind.value = 'surface'
    mountAsset.value = asset
  }
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(catalogDragType, asset.id)
}

/** 편집 가능한 맵에서 현재 카탈로그 드래그만 모델 복사로 허용 */
const allowCatalogDrop = (event: DragEvent) => {
  if (!draggingModelId.value || sitePreview.value || studio.busy ||
      !event.dataTransfer?.types.includes(catalogDragType)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  catalogDropTarget.value = true
  if (tool.value === 'mount' && showScene.value) scene?.moveMountPointer(event)
}

/** Three.js 캔버스 내부 요소를 지나갈 때 강조를 유지하고 영역을 벗어날 때 해제 */
const leaveCatalogDrop = (event: DragEvent) => {
  if (!(event.relatedTarget instanceof Node) || !host.value?.contains(event.relatedTarget)) {
    catalogDropTarget.value = false
    if (tool.value === 'mount') scene?.moveMountPointer()
  }
}

/** 포트 또는 바닥의 드롭 좌표에 모델 한 개를 추가하고 배열 및 선택 상태를 갱신 */
const dropCatalogModel = (event: DragEvent) => {
  const id = event.dataTransfer?.getData(catalogDragType)
  const isCatalogModel = !!id && id === draggingModelId.value
  endCatalogDrag()
  if (!isCatalogModel) return
  event.preventDefault()
  if (sitePreview.value || studio.busy) return

  const asset = catalogAssets.value.find((model) => model.id === id)
  if (!asset) return
  if (tool.value === 'mount') {
    scene?.commitWallMount(event)
    return
  }
  attempt(() => {
    validateCatalogPlacement(asset)
    const target = scene?.pickCatalogPlacement(event, workspace.value === 'building')
    if (!target) throw new Error('설비를 놓을 바닥이나 포트를 찾을 수 없습니다.')
    const portId = 'portId' in target ? target.portId : undefined
    studio.place(target.x, target.y, portId, undefined, { asset, mapRef: reference.value })
    placementPort.value = portId ?? ''
    floorId.value = ''
    tool.value = 'select'
    studio.message = `${asset.name} 모델을 ${portId ? `포트 ${portId}에` : '바닥에'} 배치했습니다.`
  })
}

/** 삭제할 수 있는 현재 설계의 사용자 모델을 검증하고 일괄 삭제 */
const removeCatalogModels = (ids: string[]) => {
  if (studio.busy || !ids.length) return
  if (attempt(() => {
    if (ids.some((id) => !registeredCatalogIds.value.has(id)))
      throw new Error('등록한 사용자 모델을 선택하세요.')
    studio.removeAssets(ids)
  })) studio.message = `모델 ${ids.length}개를 카탈로그에서 삭제했습니다.`
}

/** 기존 일괄 등록 동작으로 공급 모델을 라이브러리에 추가 */
const registerDefaultModels = () => {
  attempt(() => {
    const assets = defaultCatalog.value
    if (!assets?.length) throw new Error('기본 모델을 불러온 뒤 등록하세요.')
    studio.addAssets(assets, reference.value, assets.map((asset) => asset.id))
    catalogOpen.value = false
  })
}

/** 리본과 빠른 실행 영역에 연결하는 공통 명령 구성 */
const quickActions = computed(() => [
  { id: 'tool-select', label: '선택', icon: 'select', active: tool.value === 'select', disabled: !showScene.value || sitePreview.value, run: () => { tool.value = 'select' } },
  { id: 'scene-undo', label: '실행 취소', icon: 'undo', disabled: !studio.past.length, run: studio.undo },
  { id: 'scene-redo', label: '다시 실행', icon: 'redo', disabled: !studio.future.length, run: studio.redo },
  { id: 'measure-tool', label: '치수 확인', icon: 'target', active: tool.value === 'measure', disabled: !showScene.value || sitePreview.value, run: () => tool.value === 'measure' ? (tool.value = 'select') : startSiteTool('measure') },
  { id: 'scene-fit', label: '전체 보기', icon: 'fit', disabled: !showScene.value || sitePreview.value, run: () => scene?.fit() },
  { id: 'scene-top', label: '위에서 보기', icon: 'layers', disabled: !showScene.value || sitePreview.value, run: () => scene?.fit(true) },
  { id: 'facility-grid-toggle', label: '격자 표시', icon: 'grid', active: showGrid.value, disabled: !showScene.value || sitePreview.value, run: () => emit('layer', 'grid', !showGrid.value) },
])

/** 현재 메뉴나 진행 중인 도구의 설정에 따른 작업 패널 표시 */
const hasContext = computed(() => sitePreview.value || ['Facility', 'Building', 'Lighting', 'View'].includes(menu.value) ||
  ['wall', 'floor', 'ceiling', 'door', 'window', 'measure', 'mount'].includes(tool.value))
const contextTitle = computed(() => {
  if (sitePreview.value) return '현장 미리보기'
  return { Facility: '설비 배치 설정', Building: '건물 편집 설정', Lighting: '조명 설정', View: '화면 표시 설정', File: '현재 작업 설정', Tools: '현재 작업 설정', Help: '사용 도움말' }[menu.value]
})
const contextOpen = computed(() => hasContext.value && panelPreferences.contextOpen)
const inspectorOpen = computed(() => !sitePreview.value && (catalogOpen.value || panelPreferences.inspectorOpen))

/** 장면에서 이미 지원하는 지도 객체 표시 항목 정의 */
const mapVisibility = [['nodes', 'Node'], ['edges', 'Path'], ['ports', 'Port']] as const

/** 원본 이차원 문서와 분리한 연습용 삼차원 바닥 지도 구성 */
const tutorialMap = computed(() => tutorial.value
  ? { ...map.document, units: 'mm' as const, nodes: [], edges: [], ports: [], shapes: [], layout: undefined }
  : map.document)
const tutorialLayers = computed(() => tutorial.value
  ? { ...DEFAULT_LAYERS, nodes: false, edges: false, ports: false, grid: true }
  : props.layers ?? DEFAULT_LAYERS)
const tutorialExplorerSelected = ref(false)
const tutorialPlacement = shallowRef<FacilityInstance>()
const tutorialInstance = computed(() => tutorial.value
  ? studio.document.instances.find(({ assetId }) => assetId === tutorialAssetId) : undefined)
let restoreTutorialSession: ((restoreView: boolean) => Promise<void>) | undefined
const tutorialStarting = ref(false)

/** 배치 직후 좌표를 한 번 기록하여 이동과 실행 취소 결과 대조 */
watch(tutorialInstance, (instance) => {
  if (instance && !tutorialPlacement.value) tutorialPlacement.value = instance
}, { flush: 'sync' })

/** 연습 중에만 기존 선택 및 설계 상태를 관찰하는 완료 조건 구성 */
const tutorialState = computed<TutorialState>(() => {
  const instance = tutorialInstance.value
  const initialX = tutorialPlacement.value?.position.x ?? 0
  return {
    menu: menu.value, catalog: catalogOpen.value, tool: tool.value, assetId: studio.selectedAssetId,
    instanceId: instance?.id ?? '', selectedFromExplorer: tutorialExplorerSelected.value,
    name: pose.name, storedName: instance?.name ?? '', x: Number(pose.x), storedX: instance?.position.x ?? 0,
    initialX, targetX: Math.round(initialX + 1000), floorCount: floorAreas.value.length,
    floorMaterial: floorAreas.value[0]?.material ?? '', walls: tutorial.value ? structures.value.filter(({ role }) => role === 'wall').length : 0,
    ceilings: tutorial.value ? structures.value.filter(({ role }) => role === 'ceiling').length : 0,
    ceilingVisible: showCeilingInStructure.value,
  }
})

/** 연습 종료 시 원래 설계와 선택 및 표시 상태 복원 */
const finishTutorial = async (restoreView = true) => {
  const restore = restoreTutorialSession
  restoreTutorialSession = undefined
  if (!restore) return
  tutorialRestoring.value = true
  try { await restore(restoreView) }
  finally { tutorialRestoring.value = false }
}

/** 원래 설계를 보존하고 외부 파일을 변경하지 않는 연습 장면 초기화 */
const startTutorial = async (scenario: TutorialScenario) => {
  if (studio.busy || tutorial.value || tutorialRestoring.value || floorDraft.value || wallStart.value || ceilingStart.value) return
  const session = studio.captureSession()
  const camera = scene?.captureView()
  const previous = {
    menu: menu.value, workspace: workspace.value, buildingView: buildingView.value, tool: tool.value,
    floorId: floorId.value, wallHostId: wallHostId.value, ceilingHostId: ceilingHostId.value,
    catalogOpen: catalogOpen.value, catalogCategory: catalogCategory.value, sitePreview: sitePreview.value,
    ceilingHeight: ceilingHeight.value, wallSize: { ...wallSize }, floorMaterial: floorMaterial.value,
    ceilingVisible: showCeilingInStructure.value, buildingVisible: showBuildingInEquipment.value,
    snap: snapStep.value, error: error.value, panels: { ...panelPreferences }, pose: { ...pose },
  }
  restoreTutorialSession = async (restoreView) => {
    tutorial.value = undefined
    tutorialStarting.value = false
    floorDraft.value = undefined
    wallStart.value = undefined
    ceilingStart.value = undefined
    cancelWallMount()
    if (sitePreview.value) toggleSitePreview()
    studio.restoreSession(session)
    emit('draftDirty', false)
    menu.value = previous.menu
    workspace.value = previous.workspace
    buildingView.value = previous.buildingView
    tool.value = previous.tool
    floorId.value = previous.floorId
    wallHostId.value = previous.wallHostId
    ceilingHostId.value = previous.ceilingHostId
    catalogOpen.value = previous.catalogOpen
    catalogCategory.value = previous.catalogCategory
    ceilingHeight.value = previous.ceilingHeight
    floorMaterial.value = previous.floorMaterial
    showCeilingInStructure.value = previous.ceilingVisible
    showBuildingInEquipment.value = previous.buildingVisible
    snapStep.value = previous.snap
    error.value = previous.error
    Object.assign(wallSize, previous.wallSize)
    Object.assign(panelPreferences, previous.panels)
    tutorialPlacement.value = undefined
    tutorialExplorerSelected.value = false
    if (!restoreView) return
    await nextTick()
    Object.assign(pose, previous.pose)
    await scene?.setDocument(session.document)
    scene?.retainAssets([])
    if (previous.sitePreview) toggleSitePreview()
    if (camera) scene?.restoreView(camera)
  }
  tutorialStarting.value = true
  tutorial.value = scenario
  tutorialChooser.value = false
  tutorialPlacement.value = undefined
  tutorialExplorerSelected.value = false
  try {
    /** 연습 문서 전환 중에도 원본 미저장 설계의 종료 확인 유지 */
    emit('draftDirty', studio.dirty)
    error.value = ''
    scene?.retainAssets(session.document.assets)
    if (sitePreview.value) toggleSitePreview()
    catalogOpen.value = false
    menu.value = 'Help'
    workspace.value = 'equipment'
    buildingView.value = 'structure'
    tool.value = 'select'
    floorId.value = wallHostId.value = ceilingHostId.value = ''
    catalogCategory.value = 'equipment'
    showCeilingInStructure.value = false
    showBuildingInEquipment.value = false
    snapStep.value = defaultTransformSnap
    ceilingHeight.value = 3000
    floorMaterial.value = 'concrete'
    Object.assign(wallSize, { thickness: 150, height: 2600 })
    Object.assign(panelPreferences, { contextOpen: true, inspectorOpen: true, explorer: 220 })
    const practice = emptyFacilityDocument()
    practice.assets = [{
      id: tutorialAssetId, name: '연습용 설비', kind: 'equipment', catalogCategory: 'equipment',
      parts: [{ id: 'body', name: '본체', shape: 'box', position: { x: 0, y: 0, z: 400 }, size: { x: 1000, y: 600, z: 800 }, rotation: 0, color: '#e49134' }],
    }]
    studio.loadDocument(practice, '튜토리얼 연습')
    await nextTick()
    scene?.setMap(tutorialMap.value, map.theme, tutorialLayers.value)
    await scene?.setDocument(practice)
    scene?.fit(true)
    tutorialStarting.value = false
  } catch (cause) {
    await finishTutorial()
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

onMounted(() => {
  try {
    scene = createFacilityScene(host.value!, {
      error: (message) => {
        error.value = message
      },
      select: selectInstances,
      preview: syncPose,
      place: handleFloorClick,
      finishFloor,
      placeAtPort,
      attachOpening,
      mountWall: mountWallAtPointer,
      measurePoint: addMeasurePoint,
      moveSelection: (x, y) =>
        attempt(() => studio.moveSelectionXY(x, y, map.document.ports)),
      move: (id, position, rotation, scale) =>
        attempt(() => studio.applyPlacementPose(id, { position, rotation, scale }, map.document.ports)),
    })
    scene.setMap(map.document, map.theme, props.layers ?? DEFAULT_LAYERS)
    scene.setDocument(studio.document)
    scene.setSelected(studio.selectedIds)
    scene.setTool(sceneTool.value)
    scene.setEquipmentGuides(equipmentGuides.value)
    scene.setCeilingGuides(ceilingGuides.value)
    scene.setSnapStep(snapStep.value)
    scene.fit()
  } catch (e) {
    error.value = `3D 초기화 실패: ${e instanceof Error ? e.message : String(e)}`
  }
})

watch(
  () => studio.document,
  (doc) => {
    attempt(() => scene?.setDocument(doc))
  },
)

watch(
  () => studio.selectedIds,
  (ids) => {
    if (ids.length) floorId.value = ''
    Object.assign(batchOffset, { x: 0, y: 0 })
    try {
      scene?.setSelected(ids)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  },
)

watch(
  () => [tutorialMap.value, map.theme, tutorialLayers.value],
  () => attempt(() => scene?.setMap(tutorialMap.value, map.theme, tutorialLayers.value)),
  { deep: true },
)

watch(
  () => map.mapRevision,
  () => {
    if (sitePreview.value) toggleSitePreview()
    error.value = ''
    placementPort.value = ''
    floorId.value = ''
    floorPlanVisible.value = undefined
    buildingView.value = 'structure'
    wallHostId.value = ''
    ceilingHostId.value = ''
    mountAsset.value = undefined
    layoutOpen.value = false
    designerOpen.value = false
    catalogOpen.value = false
    glbImportOpen.value = false
    lightEditId.value = ''
    glbFile.value = undefined
    endCatalogDrag()
    editingAsset.value = null
    tool.value = 'select'
    scene?.setMap(map.document, map.theme, props.layers ?? DEFAULT_LAYERS)
    scene?.setDocument(studio.document)
    scene?.fit()
  },
  { flush: 'post' },
)

watch(tool, (value, previous) => {
  if (previous === 'mount' && value !== 'mount') mountAsset.value = undefined
  if (value !== 'wall') wallStart.value = undefined
  if (value !== 'ceiling') ceilingStart.value = undefined
  if (value !== 'floor') floorDraft.value = undefined
  if (value !== 'measure') measurement.value = []
  scene?.setTool(sceneTool.value)
})
watch([tool, mountAsset], ([value, asset]) => {
  scene?.setMountAsset(value === 'mount' ? asset : undefined)
  if (value === 'mount' && asset && showScene.value) host.value?.querySelector('canvas')?.focus()
})
watch(mountKind, () => scene?.refreshMountPreview())
watch(equipmentGuides, (enabled) => scene?.setEquipmentGuides(enabled))
watch(ceilingGuides, (enabled) => scene?.setCeilingGuides(enabled))
watch(measurement, (points) => scene?.setMeasurement(points))
watch(snapStep, (step) => scene?.setSnapStep(step))
watch([wallStart, () => wallSize.thickness], ([start, thickness]) => scene?.setWallDraft(start, thickness))
watch([floorDraft, selectedFloor, ceilingStart], ([draft, area, ceiling]) => {
  scene?.setFloorOutline(
    ceiling ? [ceiling] : draft?.points ?? area?.points ?? [],
    !draft && !!area,
    draft?.shape === 'polygon',
  )
})
watch(floorPlanVisible, (value) => scene?.setFloorPlanVisible(value))
/** 기존 화면 실행 함수가 표시한 실패를 도구 호출자에게도 전달 */
const runWorkspaceAction = async (action: () => unknown) => {
  error.value = ''
  const result = await action()
  if (error.value) throw new Error(error.value)
  return result
}
/** 기존 파일 함수의 결과로 실제 저장과 사용자 취소 및 다운로드 대기 구분 */
const runSceneFileAction = async (action: () => ReturnType<typeof studio.save>) => {
  const result = await action()
  if (result.status === 'error') throw new Error(result.message)
  return { commandStatus: result.status === 'download_requested' ? 'awaiting_user' : result.status, message: result.message }
}
/** 기존 리본과 속성 패널 및 건물 작성 함수의 공통 실행 계약 등록 */
const unregisterCommands = registerAppCommands(() => {
  const ready = !studio.busy && !sitePreview.value
  const editable = ready && !map.readOnly
  const number: CommandParameter = { type: 'number', minimum: -1e9, maximum: 1e9 }
  const positive: CommandParameter = { type: 'number', minimum: 1, maximum: 1e9 }
  const points = { x1: number, y1: number, x2: number, y2: number }
  const commands: AppCommand[] = quickActions.value.map((action) => ({
    id: 'scene.' + action.id, label: action.label, category: '3D/ViewTools',
    description: '현재 리본과 빠른 실행의 동일 기능 실행', effect: action.id === 'measure-tool' ? 'interactive'
      : action.id === 'scene-undo' || action.id === 'scene-redo' ? 'edit' : 'view',
    available: !studio.busy && !action.disabled, run: () => action.run(),
  }))
  commands.push(
    { id: 'scene.project-open', label: '설계 프로젝트 열기', category: 'File', description: '기존 파일 선택과 미저장 변경 확인을 유지하며 실제 파일 로딩 결과 반환', effect: 'dialog', available: ready,
      run: () => runSceneFileAction(studio.open) },
    { id: 'scene.project-save', label: '설계 프로젝트 저장', category: 'File', description: '기존 현재 고객사 경로에 삼차원 설계 저장. 데스크톱 저장 응답으로만 완료 판정하며 다운로드 요청은 저장 완료가 아님', effect: 'dialog', available: ready && (hasSceneContent.value || studio.dirty),
      run: () => runSceneFileAction(() => studio.save(map.projectToken)) },
    { id: 'scene.export', label: '삼차원 운영 데이터 추출', category: 'File', description: '기존 운영 데이터 추출과 파일 선택 및 리소스 저장 방식 유지', effect: 'dialog', available: ready && hasSceneContent.value,
      run: () => runSceneFileAction(() => studio.exportRuntime(map.document.ports, map.projectToken)) },
    { id: 'scene.menu', label: '3D 작업 메뉴 선택', category: '3D/Workspace', description: '기존 리본 메뉴 전환이며 문서 편집 완료가 아님', effect: 'view',
      parameters: { menu: { type: 'string', enum: menus } }, required: ['menu'], run: ({ menu: value }) => { menu.value = value as typeof menu.value } },
    { id: 'scene.workspace', label: '설비 배치 및 건물 편집 전환', category: '3D/Workspace', description: '기존 작업 모드 전환 실행', effect: 'view',
      parameters: { mode: { type: 'string', enum: ['equipment', 'building'] } }, required: ['mode'], run: ({ mode }) => switchWorkspace(mode as typeof workspace.value) },
    { id: 'scene.snap', label: '스냅 간격 설정', category: '3D/Workspace', description: '기존 스냅 간격 선택과 동일한 밀리미터 값 적용', effect: 'view',
      parameters: { step: { type: 'number', enum: transformSnapSteps } }, required: ['step'], run: ({ step }) => { snapStep.value = step as TransformSnapStep } },
    { id: 'scene.select', label: '3D 배치 객체 선택', category: '3D/Selection', description: '조회한 실제 배치 식별자로 선택 상태 동기화', effect: 'view',
      parameters: { ids: { type: 'array', items: { type: 'string' }, maxItems: 200 } }, required: ['ids'], run: ({ ids }) => {
        const selected = ids as string[]
        if (selected.some((id) => !studio.document.instances.some((item) => item.id === id))) throw new Error('선택할 배치 객체를 찾을 수 없습니다.')
        selectInstances(selected, 'replace')
        return { selectedIds: [...studio.selectedIds] }
      } },
    { id: 'scene.focus-selection', label: '선택 객체 보기', category: '3D/ViewTools', description: '기존 선택 객체 카메라 맞춤 실행', effect: 'view', available: !!scene && !!studio.selectedIds.length && !sitePreview.value,
      run: () => scene?.focusSelected() },
    { id: 'scene.catalog-models', label: '모델 카탈로그 검색', category: '3D/Facility', description: '기존 카탈로그를 조회하며 GLB 바이너리 없이 식별자 이름 크기 및 조명 설정 반환', effect: 'view', available: ready,
      parameters: { query: { type: 'string' }, offset: { type: 'number', minimum: 0 }, limit: { type: 'number', minimum: 1, maximum: 50 } },
      run: async ({ query = '', offset = 0, limit = 20 }) => {
        await runWorkspaceAction(openCatalog)
        const rows = catalogAssets.value.filter((asset) => `${asset.id} ${asset.name}`.toLowerCase().includes(String(query).toLowerCase()))
        const start = Math.trunc(offset as number), count = Math.trunc(limit as number)
        return { total: rows.length, rows: rows.slice(start, start + count).map((asset) => ({
          id: asset.id, name: asset.name, kind: asset.kind, catalogCategory: asset.catalogCategory,
          light: facilityLight(asset), size: asset.glb?.size, parts: asset.parts.length,
        })), hasMore: start + count < rows.length }
      } },
    { id: 'scene.model-select', resolves: ['scene.catalog'], label: '배치할 카탈로그 모델 선택', category: '3D/Facility', description: '조회한 모델 식별자로 기존 카탈로그 선택 실행. 이후 배치 좌표나 포트를 지정하여 실제 배치 필요', effect: 'view', available: editable,
      parameters: { assetId: { type: 'string' } }, required: ['assetId'], run: async ({ assetId }) => {
        await runWorkspaceAction(openCatalog)
        const asset = catalogAssets.value.find((item) => item.id === assetId)
        if (!asset) throw new Error('선택할 카탈로그 모델을 찾을 수 없습니다.')
        await runWorkspaceAction(() => chooseCatalogModel(asset))
        return { assetId: asset.id }
      } },
    { id: 'scene.place-port', resolves: ['scene.catalog', 'scene.model-select'], label: '선택 모델을 포트에 배치', category: '3D/Facility', description: '기존 포트 배치 함수로 실제 객체 추가', effect: 'edit', available: editable && !!studio.asset,
      parameters: { portId: { type: 'string' } }, required: ['portId'], run: ({ portId }) => runWorkspaceAction(() => placeAtPort(String(portId))) },
    { id: 'scene.glb-import', label: 'GLB 파일 등록 화면', category: '3D/Facility', description: '기존 GLB 등록 화면 표시이며 사용자 파일 선택과 등록 확정 필요', effect: 'dialog', available: editable,
      run: openGlbImport },
    { id: 'scene.ceiling-display', label: '구조 배치의 천장 표시', category: '3D/Building', description: '구조 배치에서 천장과 부착 모델을 전체 표시하거나 윤곽으로 표시. 설계 데이터와 조명 발광 설정 유지', effect: 'view', available: ready && workspace.value === 'building' && buildingView.value === 'structure',
      parameters: { visible: { type: 'boolean' } }, required: ['visible'], run: ({ visible }) => { showCeilingInStructure.value = visible as boolean; return { visible } } },
    { id: 'scene.building-view', label: '건물 구조 및 벽 정면과 천장 배치도', category: '3D/Building', description: '기존 건물 편집 화면 전환 및 선택한 벽 또는 천장 지정', effect: 'view', available: ready,
      parameters: { view: { type: 'string', enum: ['structure', 'wall', 'ceiling'] }, hostId: { type: 'string' } }, required: ['view'],
      run: ({ view, hostId }) => {
        if (hostId && !(view === 'wall' ? wallTargets.value : view === 'ceiling' ? ceilingTargets.value : []).some(({ instance }) => instance.id === hostId))
          throw new Error('표시할 벽이나 천장을 찾을 수 없습니다.')
        if (workspace.value !== 'building') switchWorkspace('building')
        switchBuildingView(view as typeof buildingView.value)
        if (hostId) { if (view === 'wall') openWall(String(hostId)); else openCeiling(String(hostId)) }
      } },
    { id: 'scene.mount', resolves: ['scene.catalog', 'scene.model-select'], label: '모델을 벽이나 천장에 밀착 배치', category: '3D/Building', description: '기존 부착 계산과 검증 및 배치 함수 사용. 벽 x는 중심 기준 가로 오프셋 y는 바닥 기준 모델 중심 높이. 천장 x y는 중심 기준 평면 좌표. 밀리미터 단위이며 kind door window는 벽 GLB 개구부 전용', effect: 'edit', available: editable && !buildingLocked.value && map.document.units === 'mm',
      parameters: { assetId: { type: 'string' }, hostId: { type: 'string' }, x: number, y: number,
        kind: { type: 'string', enum: ['surface', 'door', 'window'] }, rear: { type: 'boolean' }, free: { type: 'boolean' } }, required: ['assetId', 'hostId', 'x', 'y'],
      run: async ({ assetId, hostId, x, y, kind = 'surface', rear = false, free = false }) => {
        await runWorkspaceAction(openCatalog)
        const asset = catalogAssets.value.find((item) => item.id === assetId)
        if (!asset) throw new Error('부착할 카탈로그 모델을 찾을 수 없습니다.')
        const wall = wallTargets.value.find(({ instance }) => instance.id === hostId)
        const ceiling = ceilingTargets.value.find(({ instance }) => instance.id === hostId)
        if (!wall && !ceiling) throw new Error('부착 대상 벽이나 천장을 찾을 수 없습니다.')
        if (kind !== 'surface' && (!wall || !asset.glb)) throw new Error('문과 창문 개구부는 벽과 GLB 모델이 필요합니다.')
        if (wall) {
          const frame = wallMountFrame(resolveFacilityInstance(wall.instance, map.document.ports), wall.asset)
          if (!frame) throw new Error('이 벽의 부착 면을 확인하세요.')
          mountKind.value = kind as typeof mountKind.value
          if (!getWallMount(asset, frame, { x: x as number, y: y as number }, rear as boolean, free as boolean, true))
            throw new Error('모델의 폭과 높이 및 기존 개구부와의 간격을 확인하세요.')
        } else {
          if (workspace.value !== 'building') switchWorkspace('building')
          switchBuildingView('ceiling')
          openCeiling(String(hostId))
          await nextTick()
          await runWorkspaceAction(() => placeMountedAsset(asset, { x: x as number, y: y as number }, free as boolean))
        }
        return { instance: studio.selected }
      } },
    { id: 'scene.pose', label: '선택 객체 위치 회전 크기 및 연결 속성 적용', category: '3D/Inspector', description: '기존 속성 적용 함수 재사용이며 위치와 치수는 밀리미터 회전은 도 단위. 크기는 width depth height 중 필요한 축만 지정', effect: 'edit',
      available: editable && !!studio.selected,
      parameters: { name: { type: 'string' }, x: number, y: number, z: number, rotation: number,
        width: positive, depth: positive, height: positive, portId: { type: 'string' }, nodeId: { type: 'string' },
        cutawayRole: { type: 'string', enum: ['auto', 'wall', 'ceiling', 'independent'] }, attachedTo: { type: 'string' } },
      run: async ({ width, depth, height, ...args }) => {
        await nextTick()
        if (linkedWallOpening.value && Object.keys(args).some((key) => key !== 'name') || linkedWallOpening.value && [width, depth, height].some((value) => value !== undefined))
          throw new Error('벽에 부착된 문과 창문의 위치와 크기는 개구부 편집에서 변경하세요.')
        Object.assign(pose, args)
        if (width !== undefined) pose.size.x = width as number
        if (depth !== undefined) pose.size.y = depth as number
        if (height !== undefined) pose.size.z = height as number
        await runWorkspaceAction(applyPose)
        return { instance: studio.selected }
      } },
    { id: 'scene.catalog', label: 'GLB 모델 카탈로그 열기', category: '3D/Facility', description: '기존 카탈로그 표시이며 모델 배치는 아직 수행하지 않음', effect: 'dialog', available: ready,
      parameters: { category: { type: 'string', enum: ['equipment', 'interior', 'lighting'] } },
      run: ({ category }) => openCatalog(category as typeof catalogCategory.value | undefined) },
    { id: 'scene.designer', label: '새 모델 디자인', category: '3D/Facility', description: '기존 모델 디자인 창 열기. 모델 생성 완료가 아니며 치수나 부품 지정은 edit_equipment 도구 활용', effect: 'dialog', available: editable,
      run: () => openDesigner() },
    { id: 'scene.duplicate', label: '선택 배치 복제', category: '3D/Facility', description: '기존 복제 함수와 실행 취소 이력 사용', effect: 'edit', available: editable && !!studio.selected,
      run: () => studio.duplicate() },
    { id: 'scene.remove', label: '선택 배치 삭제', category: '3D/Facility', description: '기존 삭제 함수와 실행 취소 이력 사용', effect: 'edit', available: editable && !!studio.selected,
      run: () => studio.remove() },
    { id: 'scene.place-center', resolves: ['scene.catalog', 'scene.model-select'], label: '선택 모델 중앙 배치', category: '3D/Facility', description: '기존 지도 중심 배치 함수 사용', effect: 'edit', available: editable && !!studio.asset,
      run: () => runWorkspaceAction(placeCenter) },
    { id: 'scene.preview', label: '현장 미리보기 전환', category: '3D/ViewTools', description: '기존 현장 미리보기 전환 실행', effect: 'view', available: !!scene,
      parameters: { enabled: { type: 'boolean' } }, required: ['enabled'], run: ({ enabled }) => { if (sitePreview.value !== enabled) toggleSitePreview(); return { enabled: sitePreview.value } } },
    { id: 'scene.light-settings', label: '조명 색온도 및 유형 설정', category: '3D/Lighting', description: '조회한 조명 모델 식별자의 기존 조명 설정 적용 함수를 사용하며 Kelvin 단위 입력', effect: 'edit', available: editable,
      parameters: { assetId: { type: 'string' }, temperature: { type: 'number', minimum: minLightTemperature, maximum: maxLightTemperature }, kind: { type: 'string', enum: ['spot', 'line'] } }, required: ['assetId', 'temperature'],
      run: async ({ assetId, temperature, kind }) => {
        const asset = studio.document.assets.find((item) => item.id === assetId)
        if (!asset || !facilityLight(asset)) throw new Error('설정할 조명 모델을 찾을 수 없습니다.')
        openLightSettings(asset)
        lightTemperature.value = String(temperature)
        if (kind !== undefined) lightKind.value = kind as FacilityLight['kind']
        if (lightError.value) throw new Error(lightError.value)
        await runWorkspaceAction(saveLightSettings)
        return { assetId, light: facilityLight(studio.document.assets.find((item) => item.id === assetId)!) }
      } },
    { id: 'scene.wall-create', label: '두 점으로 벽체 생성', category: '3D/Building', description: '기존 벽 그리기 확정 함수를 재사용. 모든 좌표와 높이 및 두께는 밀리미터', effect: 'edit', available: editable && !buildingLocked.value && map.document.units === 'mm',
      parameters: { ...points, height: positive, thickness: positive }, required: [...Object.keys(points), 'height', 'thickness'],
      run: ({ x1, y1, x2, y2, height, thickness }) => {
        wallSize.height = height as number; wallSize.thickness = thickness as number
        placeWallBetweenPoints({ x: x1 as number, y: y1 as number }, { x: x2 as number, y: y2 as number })
        return { instance: studio.selected }
      } },
    { id: 'scene.ceiling-create', label: '두 모서리로 천장 생성', category: '3D/Building', description: '기존 천장 그리기 확정 함수를 재사용하며 좌표와 높이는 밀리미터', effect: 'edit', available: editable && !buildingLocked.value && map.document.units === 'mm',
      parameters: { ...points, height: positive }, required: [...Object.keys(points), 'height'], run: ({ x1, y1, x2, y2, height }) => {
        ceilingHeight.value = height as number
        placeCeilingBetweenPoints({ x: x1 as number, y: y1 as number }, { x: x2 as number, y: y2 as number })
        return { instance: studio.selected }
      } },
    { id: 'scene.floor-create', label: '꼭짓점으로 바닥 생성', category: '3D/Building', description: '기존 바닥 경계 적용 함수 재사용. points 배열은 밀리미터 좌표를 x y 순서로 반복하며 최소 세 꼭짓점 필요', effect: 'edit', available: editable && map.document.units === 'mm',
      parameters: { points: { type: 'array', items: number, maxItems: MAX_FLOOR_POINTS * 2 } }, required: ['points'], run: ({ points: value }) => {
        const coordinates = value as number[]
        if (coordinates.length < 6 || coordinates.length % 2) throw new Error('바닥 꼭짓점의 좌표 쌍을 확인하세요.')
        applyFloorBoundary(Array.from({ length: coordinates.length / 2 }, (_, index) => ({ x: coordinates[index * 2]!, y: coordinates[index * 2 + 1]! })))
        return { floorId: floorId.value }
      } },
  )
  return commands
})
onBeforeUnmount(() => {
  void finishTutorial(false)
  unregisterCommands()
  glbFile.value = undefined
  scene?.dispose()
})
</script>

<template>
  <section
    class="facility-studio d-flex flex-column"
    aria-label="3D 시설 설계"
    @keydown.esc="sitePreview ? toggleSitePreview() : (scene?.cancelDirectMove(), cancelWallMount(), tool = 'select')"
  >
    <!-- 편집 상태와 독립적인 상단 메뉴 및 리본 명령 구성 -->
    <header class="facility-menu">
      <VTabs v-model="menu" class="ribbon-tabs" aria-label="3D 작업 메뉴" height="32" show-arrows="never" slider-transition="fade" slider-transition-duration="140">
        <VTab v-for="item in menus" :key="item" :value="item" :data-scene-menu="item" aria-controls="facility-ribbon" :ripple="false">
          {{ item }}
        </VTab>
      </VTabs>
      <slot name="header-actions" />
    </header>
    <div class="facility-ribbon">
      <div id="facility-ribbon" class="facility-command-scroll" role="tabpanel" :aria-label="menu + ' 명령'" tabindex="0">
        <div v-if="menu === 'Help'" class="design-ribbon-commands" role="group" aria-label="튜토리얼">
          <v-btn data-testid="scene-tutorial" :disabled="studio.busy || tutorialRestoring || !!floorDraft || !!wallStart || !!ceilingStart" @click="tutorialChooser = true">
            <AppIcon name="help" :size="20" /> 튜토리얼
          </v-btn>
          <span class="text-caption">클릭과 배치를 따라 하며 배우는 3D 사용법</span>
        </div>
        <slot v-if="menu === 'File'" name="file-actions" />
        <div v-if="menu === 'File'" class="design-ribbon-commands facility-file-scene" role="group" aria-label="설계 프로젝트 파일 작업">
          <v-btn data-testid="scene-open" :disabled="studio.busy" @click="studio.open">
            <AppIcon name="folder" :size="20" /> 설계 프로젝트 열기
          </v-btn>
          <v-btn data-testid="scene-save" :disabled="studio.busy || (!hasSceneContent && !studio.dirty)" @click="studio.save(map.projectToken)">
            <AppIcon name="save" :size="20" /> 설계 프로젝트 저장
          </v-btn>
          <v-btn data-testid="scene-export" :disabled="studio.busy || !hasSceneContent" @click="studio.exportRuntime(map.document.ports, map.projectToken)">
            <AppIcon name="arrow" :size="20" /> 3D 데이터 추출
          </v-btn>
        </div>
        <div v-if="menu === 'View' || menu === 'Tools'" class="design-ribbon-commands">
          <v-btn
            v-for="command in (menu === 'View' ? quickActions.slice(4) : quickActions.slice(0, 4))"
            :key="command.id"
            :aria-pressed="command.active"
            :disabled="command.disabled"
            @click="command.run"
          >
            <AppIcon :name="command.icon" :size="20" /> {{ command.label }}
          </v-btn>
          <v-btn v-if="menu === 'View'" data-testid="site-preview" :aria-pressed="sitePreview" @click="toggleSitePreview">
            <AppIcon name="target" :size="20" /> {{ sitePreview ? '편집으로 돌아가기' : '현장 미리보기' }}
          </v-btn>
          <template v-if="menu === 'Tools'">
            <v-btn :disabled="!studio.selectedIds.length || !showScene || sitePreview" @click="scene?.focusSelected()">
              <AppIcon name="target" :size="20" /> 선택 보기
            </v-btn>
            <v-btn :disabled="!studio.selected || sitePreview" @click="studio.duplicate()">
              <AppIcon name="plus" :size="20" /> 복제
            </v-btn>
            <v-btn :disabled="!studio.selected || sitePreview" @click="studio.remove">
              <AppIcon name="trash" :size="20" /> 배치 삭제
            </v-btn>
          </template>
        </div>
        <div v-if="menu === 'Facility' || menu === 'Lighting' || menu === 'Building'" class="design-ribbon-commands">
          <v-btn
            v-if="!mounting || (buildingView === 'wall' ? wallFrame : ceilingFrame)"
            class="facility-primary"
            data-testid="default-catalog"
            :aria-pressed="catalogOpen && (menu !== 'Lighting' || catalogCategory === 'lighting')"
            :disabled="studio.busy || sitePreview"
            @click="catalogOpen && (menu !== 'Lighting' || catalogCategory === 'lighting') ? (catalogOpen = false) : openCatalog(menu === 'Lighting' ? 'lighting' : undefined)"
          >
            <AppIcon name="cube" :size="20" /> {{ menu === 'Lighting' ? '조명 모델 선택' : 'GLB 모델 카탈로그' }}
          </v-btn>
          <template v-if="menu === 'Facility' && workspace === 'equipment'">
            <v-btn data-testid="new-model" :disabled="studio.busy || sitePreview" @click="openDesigner()">
              <AppIcon name="new" :size="20" /> 새 모델 디자인
            </v-btn>
            <v-btn data-testid="model-edit" :disabled="!studio.asset || !!studio.asset.glb || studio.busy || sitePreview" @click="openDesigner(studio.asset ?? null)">
              <AppIcon name="cube" :size="20" /> 선택 모델 편집
            </v-btn>
            <v-btn data-testid="tool-place" :aria-pressed="tool === 'place'" :disabled="!studio.asset || sitePreview" @click="tool = 'place'">
              <AppIcon name="add" :size="20" /> 바닥 배치
            </v-btn>
            <v-btn data-testid="tool-port" :aria-pressed="tool === 'port'" :disabled="!studio.asset || sitePreview" @click="tool = 'port'">
              <AppIcon name="port" :size="20" /> 포트 클릭 배치
            </v-btn>
            <v-btn data-testid="place-center" :disabled="!studio.asset || sitePreview" @click="placeCenter">
              <AppIcon name="target" :size="20" /> 중앙 배치
            </v-btn>
          </template>
          <template v-if="menu === 'Lighting'">
            <v-btn v-if="showScene" :disabled="!placementLight || sitePreview" :aria-pressed="!!placementLight && tool === 'place'" @click="tool = 'place'">
              <AppIcon name="add" :size="20" /> 조명 배치
            </v-btn>
            <v-btn :disabled="(!selectedLight && !placementLight) || sitePreview" @click="openLightSettings((selectedLight ? selectedModel : studio.asset)!)">
              <AppIcon name="cube" :size="20" /> 조명 편집
            </v-btn>
            <v-btn :aria-pressed="sitePreview" @click="toggleSitePreview">
              <AppIcon name="target" :size="20" /> {{ sitePreview ? '편집으로 돌아가기' : '조명 미리보기' }}
            </v-btn>
          </template>
          <template v-if="menu === 'Building'">
            <v-btn v-if="buildingView !== 'ceiling'" data-testid="wall-mount-tool" :aria-pressed="tool === 'mount'" :disabled="buildingLocked || sitePreview" @click="startWallMount">
              <AppIcon name="connect" :size="20" /> 벽에 부착
            </v-btn>
            <v-btn v-if="workspace === 'building' && buildingView === 'structure'" data-testid="building-show-ceiling" :aria-pressed="showCeilingInStructure" :disabled="sitePreview" @click="showCeilingInStructure = !showCeilingInStructure">
              <AppIcon name="layers" :size="20" /> 천장 표시
            </v-btn>
            <v-btn data-testid="building-structure-view" :aria-pressed="buildingView === 'structure'" :disabled="sitePreview" @click="runBuildingTool(() => switchBuildingView('structure'))">
              <AppIcon name="layers" :size="20" /> 구조 배치
            </v-btn>
            <v-btn data-testid="building-wall-view" :aria-pressed="buildingView === 'wall'" :disabled="sitePreview" @click="runBuildingTool(() => switchBuildingView('wall'))">
              <AppIcon name="port" :size="20" /> 벽 정면
            </v-btn>
            <v-btn data-testid="building-ceiling-view" :aria-pressed="buildingView === 'ceiling'" :disabled="sitePreview" @click="runBuildingTool(() => switchBuildingView('ceiling'))">
              <AppIcon name="grid" :size="20" /> 천장 배치도
            </v-btn>
            <template v-if="buildingView === 'structure'">
              <v-btn data-testid="interior-wall" :aria-pressed="tool === 'wall'" :disabled="buildingLocked || sitePreview" @click="runBuildingTool(() => tool === 'wall' ? (tool = 'select') : startWall())">
                <AppIcon name="connect" :size="20" /> 벽 그리기
              </v-btn>
              <v-btn data-testid="floor-rectangle" :aria-pressed="tool === 'floor' && floorDraft?.shape === 'rectangle'" :disabled="studio.busy || sitePreview" @click="runBuildingTool(() => startFloor('rectangle'))">
                <AppIcon name="port" :size="20" /> 사각 바닥
              </v-btn>
              <v-btn data-testid="floor-polygon" :aria-pressed="tool === 'floor' && floorDraft?.shape === 'polygon'" :disabled="studio.busy || sitePreview" @click="runBuildingTool(() => startFloor('polygon'))">
                <AppIcon name="connect" :size="20" /> 다각형 바닥
              </v-btn>
              <v-btn data-testid="place-ceiling" :aria-pressed="tool === 'ceiling'" :disabled="buildingLocked || sitePreview" @click="runBuildingTool(startCeiling)">
                <AppIcon name="grid" :size="20" /> 천장 그리기
              </v-btn>
              <v-btn data-testid="interior-layout" :aria-pressed="layoutOpen" :disabled="sitePreview" @click="runBuildingTool(() => { layoutOpen = !layoutOpen })">
                <AppIcon name="layers" :size="20" /> {{ map.document.layout ? '도면 설정' : '도면 불러오기' }}
              </v-btn>
            </template>
            <template v-if="buildingView !== 'ceiling'">
              <v-btn data-testid="interior-door" :aria-pressed="tool === 'door'" :disabled="sitePreview || buildingLocked || (buildingView === 'wall' && !wallFrame)" @click="runBuildingTool(() => startSiteTool('door'))">
                <AppIcon name="port" :size="20" /> 문 붙이기
              </v-btn>
              <v-btn data-testid="interior-window" :aria-pressed="tool === 'window'" :disabled="sitePreview || buildingLocked || (buildingView === 'wall' && !wallFrame)" @click="runBuildingTool(() => startSiteTool('window'))">
                <AppIcon name="grid" :size="20" /> 창문 붙이기
              </v-btn>
            </template>
          </template>
        </div>
        <div v-if="(menu === 'Building' && workspace !== 'building') || (menu === 'Facility' && workspace !== 'equipment')" class="design-ribbon-commands">
          <v-btn v-if="menu === 'Building'" @click="switchWorkspace('building')">
            <AppIcon name="layers" :size="20" /> 건물 편집
          </v-btn>
          <v-btn v-else @click="switchWorkspace('equipment')">
            <AppIcon name="cube" :size="20" /> 설비 배치
          </v-btn>
        </div>
      </div>
      <div class="facility-project-info">
        <strong :title="map.document.name">{{ map.document.name }}</strong>
        <small :title="studio.filename">{{ studio.filename }} · {{ studio.dirty ? '미저장' : '저장됨' }}</small>
        <small :title="map.sourceName">지도 {{ map.sourceName }} · {{ map.readOnly ? '읽기 전용' : map.dirty ? '미저장' : '저장됨' }}</small>
      </div>
    </div>
    <!-- 뷰포트와 패널에서 공용으로 사용하는 빠른 실행 및 작업 모드 구성 -->
    <div class="facility-quick">
      <v-btn v-if="hasContext" title="작업 설정 패널" :aria-pressed="panelPreferences.contextOpen" data-testid="context-toggle" @click="panelPreferences.contextOpen = !panelPreferences.contextOpen">
        <AppIcon name="panel" :size="15" />
        <span class="facility-quick-label">{{ contextTitle }}</span>
      </v-btn>
      <v-btn text="설비 배치" data-testid="facility-equipment-mode" :aria-pressed="workspace === 'equipment'" @click="switchWorkspace('equipment'); menu = 'Facility'" />
      <v-btn text="건물 편집" data-testid="facility-building-mode" :aria-pressed="workspace === 'building'" @click="switchWorkspace('building'); menu = 'Building'" />
      <div class="facility-quick-commands" role="toolbar" aria-label="빠른 실행">
        <v-btn
          v-for="command in quickActions"
          :key="command.id"
          :data-testid="command.id"
          :title="command.label"
          :aria-label="command.label"
          :aria-pressed="command.active"
          :disabled="command.disabled"
          @click="command.run"
        >
          <AppIcon :name="command.icon" :size="16" />
          <span class="facility-quick-label">{{ command.label }}</span>
        </v-btn>
        <v-btn v-if="sitePreview" text="편집으로 돌아가기" @click="toggleSitePreview" />
      </div>
      <v-btn v-if="!sitePreview" title="장면 탐색 및 속성 패널" :aria-pressed="inspectorOpen" data-testid="inspector-toggle" @click="catalogOpen ? (catalogOpen = false, panelPreferences.inspectorOpen = false) : (panelPreferences.inspectorOpen = !panelPreferences.inspectorOpen)">
        <AppIcon name="panel" :size="15" />
        Explorer
      </v-btn>
    </div>
    <div
      ref="panelLayout"
      class="facility-layout"
      :class="{ 'with-context': contextOpen, 'with-inspector': inspectorOpen }"
      :style="{
        '--panel-context': panelPreferences.context + 'px',
        '--panel-inspector': panelPreferences.inspector + 'px',
        '--panel-explorer': panelPreferences.explorer + 'px',
      }"
    >
      <!-- 선택된 작업 메뉴와 진행 중인 도구의 설정 영역 구성 -->
      <aside v-show="contextOpen" class="facility-context">
        <v-sheet class="facility-tools-panel overflow-auto" aria-label="3D 작업 설정" data-testid="facility-tools-panel">
          <h2>{{ contextTitle }}</h2>
          <p v-if="sitePreview" class="text-caption facility-muted">
            눈높이 1.6 m · 오른쪽 드래그로 회전 · Space + 왼쪽 드래그 또는 휠 버튼 드래그로 이동
          </p>
          <template v-else>
            <label v-if="menu === 'Facility' || menu === 'Building' || menu === 'Lighting'" class="facility-snap-setting d-flex align-center ga-2 mb-2 text-caption">
              스냅 간격
              <select v-model="snapStep" data-testid="facility-snap-step">
                <option v-for="step in transformSnapSteps" :key="step" :value="step">{{ step }} mm</option>
              </select>
            </label>
            <template v-if="menu === 'Facility'">
              <p class="text-caption facility-muted mb-2">{{ studio.asset?.name ?? '카탈로그에서 배치할 모델을 선택하세요.' }}</p>
              <p class="text-caption mb-2">도구 · {{ tool === 'place' ? '바닥 배치' : tool === 'port' ? '포트 클릭 배치' : '객체 선택' }}</p>
              <div v-if="workspace === 'equipment'" class="d-flex flex-column ga-2 mb-3">
                <select v-model="placementPort" aria-label="배치할 포트" data-testid="placement-port">
                  <option value="">Port ID 선택</option>
                  <option v-for="port in map.document.ports" :key="port.id" :value="port.id">{{ port.id }}</option>
                </select>
                <v-btn data-testid="place-port" :disabled="!studio.asset || !placementPort" @click="placeAtPort(placementPort)">
                  선택 포트에 1개 배치
                </v-btn>
              </div>
            </template>
            <template v-if="menu === 'Lighting'">
              <p class="text-caption facility-muted mb-2">{{ mountAsset?.name ?? (placementLight ? studio.asset?.name : '카탈로그에서 조명 모델을 선택하세요.') }}</p>
              <p v-if="mountAsset && mounting" class="text-caption">배치도에서 조명을 부착할 위치를 선택하세요.</p>
              <p v-else-if="placementLight" class="text-caption">{{ placementLight.temperature }} K · {{ placementLight.kind === 'line' ? '선형 조명' : '스폿 조명' }}</p>
              <p v-if="workspace === 'equipment'" class="text-caption mt-2">배치한 조명의 높이와 회전은 Inspector에서 편집할 수 있습니다.</p>
            </template>
            <template v-if="menu === 'Building' || (menu === 'Lighting' && mounting)">
              <!-- 현재 작업 모드의 구조 편집 대상을 선택하는 설정 구성 -->
              <p v-if="workspace !== 'building'" class="text-caption facility-muted">상단의 건물 편집에서 구조 편집을 시작하세요.</p>
              <label v-if="workspace === 'building' && buildingView === 'structure' && independentInstances.length" class="d-block text-caption mb-3">
                기존 객체 선택
                <select data-testid="building-existing-object" :value="studio.selectedId ?? ''" @change="pickExistingObject(($event.target as HTMLSelectElement).value)">
                  <option value="">객체 선택</option>
                  <option v-for="instance in independentInstances" :key="instance.id" :value="instance.id">{{ instance.name }}</option>
                </select>
              </label>
              <label v-if="mounting && buildingView === 'wall'" class="d-block text-caption mb-3">
                편집할 벽
                <select data-testid="building-wall-select" :value="wallHostId" @change="openWall(($event.target as HTMLSelectElement).value)">
                  <option value="">벽 선택</option>
                  <option v-for="{ instance } in wallTargets" :key="instance.id" :value="instance.id">{{ instance.name }}</option>
                </select>
              </label>
              <label v-if="mounting && buildingView === 'ceiling'" class="d-block text-caption mb-3">
                부착할 천장
                <select data-testid="building-ceiling-select" :value="ceilingHostId" @change="openCeiling(($event.target as HTMLSelectElement).value)">
                  <option value="">천장 선택</option>
                  <option v-for="{ instance } in ceilingTargets" :key="instance.id" :value="instance.id">{{ instance.name }}</option>
                </select>
              </label>
              <v-btn v-if="mountAsset && mounting && buildingView === 'ceiling'" text="부착 취소" @click="mountAsset = undefined" />
            </template>
            <div v-if="tool === 'mount' || (mounting && buildingView === 'wall' && mountAsset)" class="d-flex flex-column ga-2 mb-3">
              <label class="text-caption">
                벽 부착 방식
                <select v-model="mountKind" data-testid="wall-mount-kind">
                  <option value="surface">벽 표면에 밀착</option>
                  <option value="door" :disabled="!mountAsset?.glb">문 개구부와 GLB</option>
                  <option value="window" :disabled="!mountAsset?.glb">창 개구부와 GLB</option>
                </select>
              </label>
              <p class="text-caption">{{ mountAsset ? mountAsset.name + ' · 벽에 놓을 위치를 클릭하세요.' : '카탈로그에서 부착할 모델을 선택하세요.' }}</p>
              <v-btn v-if="mountAsset" text="부착 취소" @click="cancelWallMount" />
            </div>
            <div v-if="menu === 'View'" class="d-flex flex-column ga-2">
              <label v-for="[key, label] in mapVisibility" :key="key" class="d-flex align-center ga-2">
                <input type="checkbox" :checked="props.layers?.[key] ?? DEFAULT_LAYERS[key]" @change="emit('layer', key, ($event.target as HTMLInputElement).checked)" />
                {{ label }} 표시
              </label>
              <v-btn v-if="workspace === 'equipment' && structures.length" text="건물 전체 표시" data-testid="equipment-show-building" :aria-pressed="showBuildingInEquipment" @click="showBuildingInEquipment = !showBuildingInEquipment" />
              <v-btn v-if="map.document.layout" text="배경 도면" data-testid="interior-floor-plan" :aria-pressed="showFloorPlan" @click="floorPlanVisible = !showFloorPlan" />
            </div>
            <p v-if="menu === 'Facility' || menu === 'Building' || menu === 'Lighting'" class="text-caption facility-muted mt-2">Alt 자유 조작</p>
            <div v-if="tool === 'wall'" class="d-flex flex-column ga-2 mb-3 text-caption">
              <div class="d-flex ga-2">
                <label class="w-50">
                  두께 mm
                  <input v-model.number="wallSize.thickness" data-testid="wall-thickness" type="number" min="1" />
                </label>
                <label class="w-50">
                  높이 mm
                  <input v-model.number="wallSize.height" data-testid="wall-height" type="number" min="1" />
                </label>
              </div>
              <p role="status">{{ wallStart ? '벽의 끝점을 클릭하세요.' : '벽의 시작점을 클릭하세요.' }}</p>
              <span>Shift 직각 맞춤 · Esc 취소</span>
            </div>
              <label v-if="tool === 'ceiling'" class="text-caption">
                천장 아랫면 높이 (mm)
                <input v-model.number="ceilingHeight" data-testid="building-ceiling-height" type="number" min="1" />
              </label>
              <p v-if="tool === 'ceiling'" class="text-caption" role="status">
                {{ ceilingStart ? '맞은편 모서리를 클릭하세요.' : '천장의 첫 번째 모서리를 클릭하세요.' }}
              </p>
            <p v-if="tool === 'door' || tool === 'window'" class="text-caption mb-3" role="status">
              벽에서 {{ tool === 'door' ? '문' : '창문' }}이 들어갈 위치를 클릭하세요. Esc 취소
            </p>
            <div v-if="tool === 'measure'" class="d-flex flex-column ga-2 mt-3" data-testid="measure-panel">
              <p class="text-caption" role="status">
                {{ measurement.length === 2 ? '다음 점을 클릭하면 새 측정을 시작합니다.' : measurement.length ? '끝점을 클릭하세요.' : '바닥이나 객체에서 시작점을 클릭하세요.' }}
              </p>
              <small>초록색으로 강조된 가장자리에 자동 맞춤 · Shift로 꼭짓점에 맞춤</small>
              <small>수평각은 +X 방향, 수직각은 바닥 평면 기준</small>
              <v-btn text="측정 지우기" :disabled="!measurement.length" @click="measurement = []" />
            </div>
            <div
              v-if="floorDraft"
              class="floor-drawing-tools d-flex flex-column ga-2 mt-3"
            >
              <span class="text-caption" role="status">
                {{ floorGuide }}
                <strong v-if="floorDraft.shape === 'polygon'">{{ floorDraft.points.length }}점</strong>
              </span>
              <select
                v-if="!floorDraft.replaceId"
                v-model="floorMaterial"
                aria-label="새 바닥 재질"
                data-testid="floor-draft-material"
              >
                <option v-for="(preset, type) in floorMaterials" :key="type" :value="type">
                  {{ preset.label }}
                </option>
              </select>
              <v-btn
                v-if="floorDraft.shape === 'polygon'"
                :disabled="floorDraft.points.length < 3"
                class="floor-drawing-apply"
                text="바닥 적용"
                data-testid="floor-finish"
                @click="finishFloor"
              />
              <v-btn :disabled="!floorDraft.points.length" text="마지막 점 취소" @click="undoFloorPoint" />
              <v-btn text="그리기 취소" @click="tool = 'select'" />
            </div>

          </template>
        </v-sheet>
        <div class="facility-splitter context-splitter" role="separator" tabindex="0" aria-label="작업 설정 너비" aria-orientation="vertical"
          :aria-valuemin="sizeLimits.context.min" :aria-valuemax="sizeLimits.context.max" :aria-valuenow="panelPreferences.context"
          @pointerdown.prevent="startPanelResize('context', $event)" @pointermove="movePanelResize" @lostpointercapture="finishPanelResize" @keydown="resizePanelByKey('context', $event)" />
      </aside>
      <div class="facility-canvas-wrap position-relative d-flex flex-column">
        <div
          v-show="showScene"
          ref="host"
          class="facility-canvas position-relative overflow-hidden"
          :class="{ 'facility-drop-target': catalogDropTarget }"
          data-testid="facility-canvas"
          @keydown.enter="finishFloorOnEnter"
          @dragover="allowCatalogDrop"
          @dragleave="leaveCatalogDrop"
          @drop="dropCatalogModel"
        ></div>
        <template v-if="!showScene">
          <WallElevation
            v-if="buildingView === 'wall' && wallFrame"
            :key="wallFrame.instance.id"
            :name="wallFrame.instance.name"
            :doors="wallFrame.instance.wallDoors ?? []"
            :width="wallFrame.width"
            :height="wallFrame.height"
            :focus="focusedOpening"
            :snap="snapStep"
            :disabled="buildingLocked"
            :mounted-objects="wallMounts"
            :pending="mountAsset?.name ?? ''"
            :mount-dimensions="wallMountDimensions"
            :mount-kind="mountKind"
            @focus="focusWallOpening"
            @apply="applyWallDoors"
            @select="studio.selectedId = $event"
            @place="placePendingMount"
            @cancel-mount="cancelWallMount"
            @drag-over="allowCatalogDrop"
            @drop-fixture="dropMountedAsset"
          />
          <CeilingPlan
            v-else-if="buildingView === 'ceiling' && ceilingFrame"
            :key="ceilingFrame.instance.id"
            :name="ceilingFrame.instance.name"
            :width="ceilingFrame.width"
            :depth="ceilingFrame.depth"
            :fixtures="ceilingFixtures"
            :selected="studio.selectedId"
            :pending="mountAsset?.name ?? ''"
            :snap="snapStep"
            :disabled="buildingLocked"
            @select="studio.selectedId = $event"
            @place="placePendingMount"
            @move="moveCeilingFixture"
            @drag-over="allowCatalogDrop"
            @drop-fixture="dropMountedAsset"
          />
          <div v-else class="d-flex flex-column align-center justify-center ga-3 flex-grow-1 text-center">
            <span>{{ buildingView === 'wall' ? '직선 벽을 만들거나 선택하세요.' : '천장을 그린 뒤 패널을 선택하세요.' }}</span>
            <v-btn text="구조 배치로 이동" @click="switchBuildingView('structure')" />
          </div>
        </template>
        <div
          v-if="showScene && tool === 'select' && !sitePreview && !studio.document.instances.length && !map.document.nodes.length && !floorAreas.length && !map.document.layout"
          class="facility-empty position-absolute text-center"
        >
          모델 만들기 → 포트 클릭 또는 Port ID 선택 → 1개 배치
          <br />
          <small>기존 MGS 노드·포트는 2D 맵에서 편집합니다.</small>
        </div>
        <div v-if="showScene && !sitePreview" class="facility-hint position-absolute text-center">
          {{ studio.selected
            ? '객체 드래그: 이동 · 모서리와 X·Y·Z: 크기 · ↻: 회전'
            : '빈 곳 드래그: 영역 선택 · Shift + 클릭: 추가 또는 해제 · Space + 왼쪽 드래그 또는 휠 버튼 드래그: 화면 이동' }}
        </div>
      </div>
      <!-- 설계 문서를 참조하는 분류별 객체 탐색 및 속성 패널 구성 -->
      <aside v-show="inspectorOpen" class="facility-property-panel" :class="{ 'with-catalog': catalogOpen }">
        <div class="facility-splitter inspector-splitter" role="separator" tabindex="0" aria-label="속성 패널 너비" aria-orientation="vertical"
          :aria-valuemin="sizeLimits.inspector.min" :aria-valuemax="sizeLimits.inspector.max" :aria-valuenow="panelPreferences.inspector"
          @pointerdown.prevent="startPanelResize('inspector', $event)" @pointermove="movePanelResize" @lostpointercapture="finishPanelResize" @keydown="resizePanelByKey('inspector', $event)" />
        <ModelCatalog
          v-show="catalogOpen && !sitePreview"
          v-model:category="catalogCategory"
          :visible="catalogOpen && !sitePreview"
          :assets="tutorial ? studio.document.assets : catalogAssets"
          :practice="!!tutorial"
          :registered-ids="registeredCatalogIds"
          :placed-ids="placedCatalogIds"
          :busy="studio.busy"
          :loading="catalogLoading"
          :selected="studio.selectedAssetId"
          :error="error"
          @close="catalogOpen = false"
          @choose="chooseCatalogModel"
          @edit-light="openLightSettings"
          @drag-start="startCatalogDrag"
          @drag-end="endCatalogDrag"
          @remove="removeCatalogModels"
          @import="openGlbImport"
          @import-library="studio.importModels(reference)"
          @register-defaults="registerDefaultModels"
        />
        <section v-show="!catalogOpen" ref="explorer" class="facility-explorer overflow-auto" aria-label="Scene Explorer">
          <h2>Scene Explorer <small data-testid="instance-count">{{ studio.document.instances.length }}</small></h2>
          <SceneExplorerBranch v-for="item in sceneGroups" :key="item.id" :item="item" @select="selectExplorerItem" />
        </section>
        <div v-show="!catalogOpen" class="facility-splitter explorer-splitter" role="separator" tabindex="0" aria-label="장면 탐색 높이" aria-orientation="horizontal"
          :aria-valuemin="sizeLimits.explorer.min" :aria-valuemax="sizeLimits.explorer.max" :aria-valuenow="panelPreferences.explorer"
          @pointerdown.prevent="startPanelResize('explorer', $event)" @pointermove="movePanelResize" @lostpointercapture="finishPanelResize" @keydown="resizePanelByKey('explorer', $event)" />
        <v-sheet v-show="!catalogOpen" tag="section" class="facility-inspector overflow-auto" aria-label="Inspector">
          <h2>Inspector</h2>
          <FloorAreaEditor
            v-if="selectedFloor || (workspace === 'building' && buildingView === 'structure')"
            :areas="floorAreas"
            :selected="selectedFloor"
            :busy="studio.busy || !!floorDraft"
            @select="selectFloor"
            @apply="updateFloor"
            @order="moveFloor"
            @remove="removeFloor"
            @redraw="startFloor('polygon', floorId)"
            @model-file="importFloorModel"
          />
            <div v-if="workspace === 'building' && canAttachSelection" class="d-flex flex-column ga-2 mb-3">
            <v-btn
              v-if="studio.selected"
              text="벽으로 지정"
              data-testid="building-mark-wall"
              :disabled="buildingLocked"
              @click="markAsWall"
            />
            <v-select
              label="선택 객체 부착"
              placeholder="구조물 선택"
              data-testid="building-attach-selection"
              :items="attachmentTargets"
              :model-value="studio.selected?.attachedTo"
              :disabled="buildingLocked || attachmentTargets.length <= 1"
              hide-details
              @update:model-value="attachSelected"
            />
          </div>
          <form
            v-if="multiSelected"
            class="facility-form"
            data-testid="facility-batch-move"
            @submit.prevent="applyBatchOffset"
          >
            <h2>{{ studio.selectedIds.length }}개 객체 이동</h2>
            <div class="d-flex ga-2">
              <label v-for="axis in ['x', 'y'] as const" :key="axis" class="flex-1-1">
                {{ axis.toUpperCase() }} 이동량 (mm)
                <v-text-field
                  v-model.number="batchOffset[axis]"
                  type="number"
                  step="any"
                  required
                  :data-testid="`facility-batch-${axis}`"
                />
              </label>
            </div>
            <v-btn type="submit" class="facility-primary" text="일괄 이동 적용" data-testid="facility-batch-apply" />
            <v-btn type="button" text="선택 객체 보기" @click="scene?.focusSelected()" />
          </form>
          <form
            v-if="studio.selected"
            class="facility-form"
            @submit.prevent="applyPose"
          >
            <h2>{{ selectedWall ? '벽 속성' : '객체 속성' }}</h2>
            <p class="facility-selection-info">
              {{ selectedLight ? '조명' : selectedStructureRole === 'wall' ? '벽' : selectedStructureRole === 'ceiling' ? '천장' : selectedModel?.catalogCategory === 'interior' ? '인테리어' : '설비' }}
              <span v-if="selectedModel"> · {{ selectedModel.name }}</span>
            </p>
            <v-btn v-if="selectedLight && selectedModel" type="button" :disabled="studio.busy" @click="openLightSettings(selectedModel)">
              조명 설정 · {{ selectedLight.temperature }} K
            </v-btn>
            <label>
              이름
              <v-text-field
                v-model="pose.name"
                data-testid="instance-name"
                maxlength="300"
                required
              />
            </label>
            <template v-if="linkedWallOpening">
              <p class="facility-selection-info">배치 위치와 크기는 연결된 개구부에서 조절합니다.</p>
              <v-btn type="button" data-testid="edit-linked-opening" @click="showOpeningEditor(linkedWallOpening.wallId, linkedWallOpening.openingId)">
                벽 정면에서 편집
              </v-btn>
              <v-btn type="button" @click="attachSelected('')">개구부 연결 해제</v-btn>
            </template>
            <template v-else>
              <div v-if="mountedOffset" class="d-flex ga-2">
                <label class="flex-1-1">
                  벽 기준 좌우 mm
                  <v-text-field :model-value="mountedOffset.x" type="number" step="any"
                    data-testid="wall-mounted-x" @update:model-value="setMountedOffset('x', $event)" />
                </label>
                <label class="flex-1-1">
                  벽 기준 높이 mm
                  <v-text-field :model-value="mountedOffset.z" type="number" step="any"
                    data-testid="wall-mounted-z" @update:model-value="setMountedOffset('z', $event)" />
                </label>
              </div>
              <v-select
                label="구조물 분류"
                data-testid="facility-cutaway-role"
                :model-value="pose.cutawayRole"
                :items="cutawayRoles"
                @update:model-value="setCutawayRole"
              />
              <v-select
                v-if="!selectedStructure"
                label="부착 대상"
                data-testid="facility-attachment"
                v-model="pose.attachedTo"
                :items="attachmentTargets"
              />
              <div class="facility-fields">
                <label
                  v-for="axis in ['x', 'y', 'z'] as const"
                  :key="axis"
                >
                  {{ axis.toUpperCase() }} mm
                  <v-text-field
                    v-model.number="pose[axis]"
                    type="number"
                    required
                    :data-testid="`instance-${axis}`"
                  />
                </label>
              </div>
              <label>
                Z축 회전 °
                <v-text-field
                  v-model.number="pose.rotation"
                  type="number"
                  required
                />
              </label>
              <div class="facility-fields">
                <label
                  v-for="{ axis, label } in sizeFields"
                  :key="axis"
                >
                  {{ label }} mm
                  <v-text-field
                    v-model.number="pose.size[axis]"
                    type="number"
                    min="0"
                    step="any"
                    required
                    :data-testid="`instance-size-${axis}`"
                  />
                </label>
              </div>
              <small v-if="baseSize">
                기본 크기 {{ displaySize(baseSize.x) }} × {{ displaySize(baseSize.y) }} ×
                {{ displaySize(baseSize.z) }} mm
              </small>
              <small v-if="doorLimits.width" data-testid="wall-door-limits">
                부착물을 유지하려면 벽의 가로는 {{ doorLimits.width }} mm, 높이는
                {{ doorLimits.height }} mm 이상이어야 합니다.
              </small>
              <label v-if="wallPart" class="d-flex flex-column mt-2">
                <span data-testid="wall-transparency-value">벽 투명도 {{ wallTransparency }}%</span>
                <input
                  class="wall-transparency-slider"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  aria-label="벽 투명도"
                  data-testid="wall-transparency"
                  :value="wallTransparency"
                  :style="{ '--wall-transparency': `${wallTransparency}%` }"
                  @input="previewWallTransparency"
                  @change="setWallTransparency"
                />
                <small>0% 완전 불투명 · 100% 완전 투명</small>
              </label>
              <label>
                연결 Node ID
                <v-text-field
                  v-model="pose.nodeId"
                  type="number"
                  min="0"
                />
              </label>
              <v-btn
                type="button"
                @click="align('node')"
              >
                노드 위치로 맞춤
              </v-btn>
              <label>
                연결 Port ID
                <v-text-field
                  v-model="pose.portId"
                  list="facility-ports"
                />
                <datalist id="facility-ports">
                  <option
                    v-for="p in map.document.ports"
                    :key="p.id"
                    :value="p.id"
                  />
                </datalist>
              </label>
              <v-btn
                type="button"
                @click="align('port')"
              >
                포트 중심으로 연결
              </v-btn>
              <label>
                포트 캐리어 회전 °
                <v-text-field
                  v-model="pose.carrierRotation"
                  type="number"
                  step="90"
                  clearable
                  :disabled="!pose.portId"
                  placeholder="자동"
                  data-testid="instance-carrier-rotation"
                  @click:clear="pose.carrierRotation = ''"
                />
              </label>
              <small>빈 값은 설비 방향 사용 · 포트 대기 자세만 적용 · 운반 중에는 포크 방향 유지</small>
              <small v-if="studio.selected.portOffset">
                포트 기준 오프셋: {{ studio.selected.portOffset.x }},
                {{ studio.selected.portOffset.y }}, {{ studio.selected.portOffset.z }} mm
              </small>
            </template>
            <v-btn
              type="submit"
              class="facility-primary"
              data-testid="instance-apply"
            >
              배치 변경 적용
            </v-btn>
            <div class="facility-tabs mb-3">
              <v-btn type="button" data-testid="selection-focus" @click="scene?.focusSelected()">
                선택 보기
              </v-btn>
              <v-btn
                type="button"
                data-testid="instance-duplicate"
                @click="studio.duplicate()"
              >
                복제
              </v-btn>
              <v-btn
                type="button"
                data-testid="instance-remove"
                @click="studio.remove"
              >
                배치 삭제
              </v-btn>
            </div>
          </form>
          <p
            v-if="!studio.selected && !multiSelected && !selectedFloor"
            class="facility-muted ma-0"
          >
            뷰포트 또는 Scene Explorer에서 객체를 선택하세요.
          </p>
          <div v-if="workspace === 'building' && buildingView === 'wall' && studio.selected?.id === wallHostId && selectedWall" ref="doorEditor">
            <WallDoorEditor
              :key="studio.selected.id"
              :doors="studio.selected.wallDoors ?? []"
              :width="selectedWall.size.x * (studio.selected.scale?.x ?? 1)"
              :height="selectedWall.size.z * (studio.selected.scale?.z ?? 1)"
              :focus="focusedOpening"
              @apply="applyWallDoors"
            />
          </div>
        </v-sheet>
      </aside>
    </div>
    <!-- 지도와 설계 문서의 상태 정보를 조합하는 상태 표시줄 구성 -->
    <footer class="facility-status" :class="{ error: !!error }">
      <strong>{{ sitePreview ? '현장 미리보기' : workspace === 'equipment' ? '설비 배치' : '건물 편집' }}</strong>
      <span class="facility-status-project" :title="map.document.name">{{ map.document.name }}</span>
      <span>Map {{ map.document.legacy?.version ?? map.document.version }} · {{ studio.dirty || map.dirty ? '미저장' : '저장됨' }}</span>
      <span>Node {{ map.document.nodes.length }} · Path {{ map.document.edges.length }} · Port {{ map.document.ports.length }}</span>
      <span>선택 {{ studio.selectedIds.length || Number(!!selectedFloor) }}</span>
      <span class="facility-status-message" role="status" :title="error || studio.message">{{ error || studio.message }}</span>
      <span>{{ platformLabel }}</span>
    </footer>
    <DrawingLayout
      v-model="layoutOpen"
      :map="map.document"
      @apply="applyDrawingLayout"
      @remove="attempt(() => map.setLayout())"
    />
    <!-- 원래 설계 보존 범위와 시나리오별 실습 내용 안내 -->
    <v-dialog v-model="tutorialChooser" max-width="620">
      <v-card title="3D 사용법 튜토리얼" data-testid="tutorial-chooser" class="tutorial-chooser">
        <v-card-text class="tutorial-chooser-content">
          <p class="tutorial-chooser-intro">연습할 시나리오를 선택하세요. 강조된 위치를 클릭하고 직접 배치하며 사용법을 익힐 수 있습니다.</p>
          <v-alert class="tutorial-chooser-notice" type="info" variant="tonal" density="compact">별도의 연습 장면에서 진행합니다. 종료하면 미저장 변경과 실행 취소 이력, 선택 상태 및 카메라를 복원하며 실제 프로젝트 파일은 변경하지 않습니다.</v-alert>
          <v-btn v-for="scenario in sceneTutorials" :key="scenario.id" :data-testid="`tutorial-start-${scenario.id}`" class="tutorial-scenario" :disabled="tutorialStarting" @click="startTutorial(scenario)">
            <span class="tutorial-scenario-copy"><strong>{{ scenario.title }}</strong><span>{{ scenario.description }}</span></span>
            <span class="tutorial-scenario-meta"><span>{{ scenario.steps.length }}단계</span><AppIcon name="arrow" :size="18" /></span>
          </v-btn>
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn text="닫기" @click="tutorialChooser = false" /></v-card-actions>
      </v-card>
    </v-dialog>
    <SceneTutorial v-if="tutorial && !tutorialStarting" :scenario="tutorial" :state="tutorialState" @close="finishTutorial()" @complete="finishTutorial()" />
    <v-dialog v-model="glbImportOpen" :persistent="studio.busy" max-width="820">
      <v-card title="GLB 모델 등록" data-testid="glb-import-dialog" class="glb-import-card">
        <form @submit.prevent="registerGlb">
          <v-card-text class="glb-import-layout">
            <div class="glb-preview-panel">
              <div class="d-flex align-center justify-space-between px-3 py-1">
                <h2 class="text-subtitle-2">3D 미리보기</h2>
                <v-btn
                  :icon="[mdiRestore]"
                  type="button"
                  variant="text"
                  size="small"
                  aria-label="미리보기 시점 초기화"
                  title="미리보기 시점 초기화"
                  :disabled="!glbDraft || !!glbPreviewError"
                  @click="glbPreview?.reset()"
                />
              </div>
              <div class="glb-preview-stage">
                <div v-if="glbDraft" ref="glbPreviewHost" class="glb-preview-canvas" />
                <div
                  v-if="!glbDraft || glbPreviewError"
                  class="glb-preview-empty d-flex flex-column align-center justify-center ga-2"
                >
                  <v-progress-circular v-if="glbPreviewLoading" indeterminate size="26" />
                  <v-icon v-else :icon="[mdiCubeOutline]" size="32" />
                  <span role="status">
                    {{ glbPreviewError || (glbPreviewLoading ? '모델 불러오는 중' : 'GLB 파일을 선택하세요') }}
                  </span>
                </div>
              </div>
              <div class="glb-preview-meta d-flex flex-wrap justify-space-between ga-2 px-3 py-2 text-caption">
                <span v-if="glbDimensionLabel" data-testid="glb-preview-size">{{ glbDimensionLabel }} mm</span>
                <span v-if="glbDraft && !glbPreviewError">드래그 회전 · 휠 확대</span>
              </div>
            </div>
            <div class="glb-import-fields d-flex flex-column ga-3">
              <p v-if="glbFloorTarget" role="status">선택한 바닥 영역의 외곽 크기에 맞춰 배치합니다. 다각형 경계로 모델을 잘라내지는 않습니다.</p>
              <input
                ref="glbInput"
                type="file"
                accept=".glb"
                hidden
                data-testid="glb-file"
                :disabled="studio.busy"
                @change="handleGlbFile"
              />
              <v-btn
                :text="glbFile ? 'GLB 파일 변경' : 'GLB 파일 선택'"
                :prepend-icon="[mdiFolderOpenOutline]"
                type="button"
                variant="outlined"
                :disabled="studio.busy"
                @click="glbInput?.click()"
              />
              <span v-if="glbFile" class="text-caption text-truncate" :title="glbFile.name">
                {{ glbFile.name }}
              </span>
              <v-text-field
                v-model="glbName"
                label="모델 이름"
                maxlength="300"
                density="compact"
                hide-details="auto"
                data-testid="glb-name"
                :disabled="studio.busy"
                :error-messages="glbName.trim() ? glbNameError : ''"
              />
              <div class="glb-import-options">
                <v-select
                  v-model="glbCategory"
                  :items="[
                    { title: '설비', value: 'equipment' },
                    { title: '인테리어', value: 'interior' },
                    { title: '조명', value: 'lighting' },
                  ]"
                  label="카테고리"
                  data-testid="glb-category"
                  density="compact"
                  hide-details
                  :disabled="studio.busy || !!glbFloorTarget"
                />
                <v-select
                  v-model="glbUnits"
                  :items="[
                    { title: 'm', value: 'm' },
                    { title: 'mm', value: 'mm' },
                  ]"
                  label="GLB 원본 단위"
                  data-testid="glb-units"
                  density="compact"
                  hide-details
                  :disabled="studio.busy"
                />
              </div>
              <GlbLightFields
                v-if="glbCategory === 'lighting'"
                v-model:kind="lightKind"
                v-model:temperature="lightTemperature"
                :error="lightError"
              />
              <v-alert v-if="glbImportError" :text="glbImportError" type="error" density="compact" />
            </div>
          </v-card-text>
          <v-card-actions class="glb-import-actions px-5 py-3">
            <v-spacer />
            <v-btn type="button" text="취소" :disabled="studio.busy" @click="glbImportOpen = false" />
            <v-btn
              type="submit"
              text="등록"
              color="primary"
              variant="flat"
              data-testid="glb-register"
              :disabled="!glbDraft || !!glbNameError || catalogLoading || (glbCategory === 'lighting' && !!lightError)"
              :loading="studio.busy"
            />
          </v-card-actions>
        </form>
      </v-card>
    </v-dialog>
    <v-dialog :model-value="!!editingLight" max-width="390" @update:model-value="!$event && (lightEditId = '')">
      <v-card v-if="editingLight" :title="editingLight.name">
        <form @submit.prevent="saveLightSettings">
          <v-card-text class="d-flex flex-column ga-3">
            <GlbLightFields v-model:kind="lightKind" v-model:temperature="lightTemperature" :error="lightError" />
            <p class="text-caption">이 모델의 모든 배치에 적용됩니다.</p>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn type="button" text="취소" @click="lightEditId = ''" />
            <v-btn type="submit" text="적용" color="primary" :disabled="!!lightError" data-testid="catalog-light-save" />
          </v-card-actions>
        </form>
      </v-card>
    </v-dialog>
    <ModelDesigner
      v-if="designerOpen"
      :asset="editingAsset"
      :apply="applyModel"
      @close="designerOpen = false"
      @dirty="emit('draftDirty', $event)"
    />
  </section>
</template>

<style scoped lang="scss">
.glb-import-card {
  overflow-y: auto;
}
.glb-import-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(245px, 1fr);
  align-items: start;
  gap: 20px;
}
.glb-import-fields {
  min-width: 0;
}
.glb-import-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.glb-preview-panel {
  border: 1px solid var(--border);
  border-radius: 9px;
  overflow: hidden;
}
.glb-preview-stage {
  position: relative;
  min-height: 190px;
  height: min(34vh, 315px);
  background: var(--surface-muted);
}
.glb-preview-canvas,
.glb-preview-empty {
  position: absolute;
  inset: 0;
}
.glb-preview-canvas :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  &:active { cursor: grabbing; }
}
.glb-preview-meta {
  min-height: 35px;
  color: var(--text-secondary);
}
.glb-import-actions {
  border-top: 1px solid var(--border);
}
@media (max-width: 660px) {
  .glb-import-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
// 화면 구성과 고유 시각 요소에 필요한 컴포넌트 전용 스타일

input {
  font: inherit;
}
/** 공용 입력 상태를 사용하는 설비 속성 필드의 간격 정의 */
input {
  width: 100%;
  min-width: 0;
  padding: 10px 12px;
}
input[type='checkbox'] {
  accent-color: var(--accent);
  width: 14px;
  height: 14px;
  cursor: pointer;
}
/** 투명도 양 끝에서 남는 색상과 입력 여백을 제거하고 조작 중 채움 비율 적용 */
.wall-transparency-slider {
  appearance: none;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  cursor: pointer;
}
.wall-transparency-slider::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, var(--accent-fill) 0% var(--wall-transparency), var(--input-bg) var(--wall-transparency) 100%);
  box-shadow: inset 0 0 0 1px var(--border);
}
.wall-transparency-slider::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -4px;
  border: 0;
  border-radius: 50%;
  background: var(--accent-fill);
}
.wall-transparency-slider::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, var(--accent-fill) 0% var(--wall-transparency), var(--input-bg) var(--wall-transparency) 100%);
  box-shadow: inset 0 0 0 1px var(--border);
}
.wall-transparency-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: 50%;
  background: var(--accent-fill);
}
strong {
  font-weight: 600;
}
.facility-studio {
  container-type: inline-size;
  flex: 1;
  overflow: hidden;
  min-height: 0;
  background: var(--surface-muted);
  color: var(--text);
}
/** 메뉴와 리본 및 빠른 실행 영역의 높이와 스크롤 정의 */
.facility-menu,
.facility-ribbon,
.facility-quick {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: center;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.facility-menu { min-height: 41px; padding: 4px 10px; gap: 8px; }
.facility-menu :deep(.v-tab:focus-visible) { outline-offset: -2px; }
.facility-ribbon { height: 103px; }
.facility-command-scroll {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  height: 100%;
  padding: 8px 12px;
  overflow-x: auto;
  scrollbar-width: thin;
}
.facility-file-scene { padding-inline-start: 10px; margin-inline-start: 10px; border-inline-start: 1px solid var(--border); }
/** 튜토리얼 선택 창의 공통 시작선과 시나리오 설명 간격 구성 */
.tutorial-chooser :deep(.v-card-item) { padding: 22px 24px 14px; }
.tutorial-chooser :deep(.v-card-title) { padding: 0; font-size: 18px; font-weight: 600; }
.tutorial-chooser-content { display: flex; flex-direction: column; gap: 14px; padding: 0 24px 24px; }
.tutorial-chooser-intro { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.65; }
.tutorial-chooser-notice { font-size: 12px; line-height: 1.65; }
.tutorial-chooser-notice :deep(.v-alert__prepend) { align-self: start; padding-block-start: 2px; }
.tutorial-scenario { width: 100%; height: auto; min-height: 86px; padding: 14px 16px; text-align: start; }
.tutorial-scenario :deep(.v-btn__content) { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; justify-content: stretch; gap: 16px; }
.tutorial-scenario-copy { display: grid; min-width: 0; gap: 6px; white-space: normal; }
.tutorial-scenario-copy strong { font-size: 14px; line-height: 1.5; }
.tutorial-scenario-copy > span { color: var(--text-secondary); font-size: 12px; line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
.tutorial-scenario-meta { display: flex; align-items: center; gap: 8px; color: var(--accent); font-size: 12px; white-space: nowrap; }
@media (max-width: 600px) {
  .tutorial-chooser :deep(.v-card-item) { padding: 18px 16px 12px; }
  .tutorial-chooser-content { padding: 0 16px 16px; }
  .tutorial-scenario { padding: 12px; }
  .tutorial-scenario :deep(.v-btn__content) { grid-template-columns: minmax(0, 1fr); gap: 8px; }
}
.facility-project-info {
  display: grid;
  flex: 0 1 228px;
  min-width: 134px;
  padding: 0 12px;
  border-inline-start: 1px solid var(--border);
  color: var(--text-secondary);
}
.facility-project-info > * {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.facility-quick {
  min-height: 34px;
  justify-content: space-between;
  gap: 4px;
  padding: 0 6px;
  overflow-x: auto;
  scrollbar-width: thin;
  background: var(--surface-muted);
}
.facility-quick-commands { display: flex; flex: 1 0 auto; justify-content: center; gap: 4px; }
.facility-quick :deep(.v-btn) { min-width: 24px; height: 26px; padding: 0 6px; flex-shrink: 0; }
.facility-quick :deep(.v-btn__content) { white-space: nowrap; }
.facility-menu :deep(.workspace-mode) { flex-shrink: 0; }

/** 설계 도구의 버튼 테두리와 선택 필드 간격 정의 */
.facility-studio button.v-btn:not(.v-tab) {
  --button-inner-edge: 0px;
  border: 1px solid var(--button-edge, var(--border));
  font-size: 12px;
}
select { padding: 5px 7px; }
.facility-tools-panel label select { display: block; width: 100%; margin-top: 4px; }
.facility-snap-setting select { flex: 0 0 auto; max-width: 60%; }

/** 뷰포트와 독립 스크롤 패널의 가변 레이아웃 정의 */
.facility-layout {
  --context-track: 0px;
  --inspector-track: 0px;
  display: grid;
  grid-template-columns: var(--context-track) minmax(0, 1fr) var(--inspector-track);
  flex: 1 1 auto;
  min-height: 0;
}
.facility-layout.with-context {
  --context-track: min(var(--panel-context), max(180px, calc((100% - 380px) / 2)));
}
.facility-layout.with-inspector {
  --inspector-track: min(var(--panel-inspector), max(260px, calc(100% - 380px - var(--context-track))));
}
.facility-context { grid-column: 1; border-inline-end: 1px solid var(--border); }
.facility-canvas-wrap { grid-column: 2; }
.facility-property-panel {
  grid-column: 3;
  display: grid;
  grid-template-rows: minmax(0, min(var(--panel-explorer), 68%)) 6px minmax(0, 1fr);
  border-inline-start: 1px solid var(--border);
}
.facility-property-panel.with-catalog { grid-template-rows: minmax(0, 1fr); }
.facility-property-panel > :deep(.model-catalog) { border-inline-start: 0; }
.facility-context,
.facility-property-panel {
  position: relative;
  min-width: 0;
  min-height: 0;
  background: var(--surface);
}
.facility-tools-panel { height: 100%; padding: 12px; }
.facility-explorer,
.facility-inspector {
  min-width: 0;
  min-height: 0;
  padding: 12px;
  scrollbar-width: thin;
  background: var(--surface);
}
.facility-inspector { border-block-start: 1px solid var(--border); }

/** 포인터와 키보드로 조작하는 패널 경계 구성 */
.facility-splitter { touch-action: none; background: var(--surface-muted); }
.facility-splitter:hover,
.facility-splitter:focus-visible,
.facility-splitter:active { background: var(--accent-soft); }
.context-splitter,
.inspector-splitter {
  position: absolute;
  z-index: 2;
  inset-block: 0;
  width: 6px;
  cursor: col-resize;
  background: transparent;
}
.context-splitter { inset-inline-end: -3px; }
.inspector-splitter { inset-inline-start: -3px; }
.explorer-splitter { cursor: row-resize; }

@container (max-width: 900px) {
  .facility-layout.with-context {
    --context-track: min(var(--panel-context), max(0px, calc((100% - 280px) / 2)));
  }
  .facility-layout.with-inspector {
    --inspector-track: min(var(--panel-inspector), max(0px, calc(100% - 280px - var(--context-track))));
  }
  .facility-quick-commands { justify-content: start; }
  .facility-quick-label { display: none; }
}
.facility-studio h2 {
  font-size: 13px;
  margin: 0 0 12px;
}
.facility-studio h2 small {
  color: var(--text-secondary);
  font-weight: normal;
  margin-left: 5px;
}
.facility-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.facility-tabs > * {
  flex: 1;
}
.facility-form {
  display: grid;
  gap: 10px;
  margin-bottom: 22px;
}
.facility-form label {
  display: grid;
  gap: 5px;
  font-size: 11px;
}
.facility-form input:not([type='range']):not(:where(.v-field *)) {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  padding: 7px;
  background: var(--surface);
  color: var(--text);
}
.facility-form select {
  width: 100%;
  min-width: 0;
  padding: 7px;
}
.facility-form input[type='color'] {
  height: 34px;
  padding: 3px;
}
.facility-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.facility-form small {
  font-size: 11px;
  line-height: 1.65;
  color: var(--text-secondary);
  margin: 0;
}
.facility-form p {
  font-size: 11px;
  line-height: 1.65;
  color: var(--text-secondary);
  margin: 0;
}
.facility-muted {
  font-size: 11px;
  line-height: 1.65;
  color: var(--text-secondary);
}
.facility-selection-info { color: var(--text-secondary); }
.facility-canvas-wrap {
  min-width: 0;
  min-height: 0;
  background: var(--surface);
}
.facility-canvas {
  flex: 1;
  min-height: 0;
}
.facility-canvas :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
.facility-drop-target::after {
  position: absolute;
  inset: 0;
  z-index: 5;
  border: 2px solid var(--accent);
  content: '';
  pointer-events: none;
}

.facility-canvas :deep(.facility-direct-frame) {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
}
.facility-canvas :deep(.facility-direct-handle) {
  position: absolute;
  width: 14px;
  height: 14px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid #48bdac;
  border-radius: 3px;
  transform: translate(-50%, -50%);
  background: var(--surface);
  color: var(--text);
  font-size: 9px;
  line-height: 1;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
}
.facility-canvas :deep(.facility-direct-handle:hover),
.facility-canvas :deep(.facility-direct-handle:focus-visible) {
  outline: 2px solid #48bdac;
}
.facility-canvas :deep(.facility-direct-handle[hidden]) {
  display: none;
}
.facility-canvas :deep(.facility-direct-nw),
.facility-canvas :deep(.facility-direct-se) { cursor: nwse-resize; }
.facility-canvas :deep(.facility-direct-ne),
.facility-canvas :deep(.facility-direct-sw) { cursor: nesw-resize; }
.facility-canvas :deep(.facility-direct-x),
.facility-canvas :deep(.facility-direct-x-min) { cursor: ew-resize; }
.facility-canvas :deep(.facility-direct-y),
.facility-canvas :deep(.facility-direct-y-min),
.facility-canvas :deep(.facility-direct-z),
.facility-canvas :deep(.facility-direct-z-min) { cursor: ns-resize; }
.facility-canvas :deep(.facility-direct-rotate) {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 14px;
  cursor: grab;
}

.facility-canvas :deep(.facility-marquee) {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 17%, transparent);
}
.floor-drawing-tools select {
  appearance: auto;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--text);
}
.floor-drawing-tools .floor-drawing-apply:not(:disabled) {
  background: var(--accent-fill);
  border-color: var(--accent-fill);
  color: var(--on-accent);
}
.facility-canvas :deep(.facility-floor-first) {
  position: absolute;
  z-index: 3;
  width: 24px;
  height: 24px;
  transform: translate(-50%, -50%);
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--accent-fill);
  color: var(--on-accent);
  font-weight: 700;
  cursor: pointer;
}
.facility-canvas :deep(.facility-floor-first:disabled) {
  cursor: default;
}
.facility-canvas :deep(.facility-measure-label) {
  position: absolute;
  z-index: 3;
  transform: translate(-50%, calc(-100% - 6px));
  pointer-events: none;
  white-space: nowrap;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}
.facility-empty {
  top: 45%;
  left: 0;
  right: 0;
  pointer-events: none;
  color: var(--text-secondary);
  line-height: 2;
}
.facility-empty small {
  color: var(--text-secondary);
}
.facility-hint {
  bottom: 12px;
  left: 12px;
  right: 12px;
  pointer-events: none;
  font-size: 10px;
  color: var(--text-secondary);
  background: var(--surface);
  padding: 6px;
}
/** 현재 작업과 문서 상태를 표시하는 고정 높이 상태 표시줄 구성 */
.facility-status {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 24px;
  flex: 0 0 24px;
  min-width: 0;
  padding: 0 10px;
  border-block-start: 1px solid var(--border);
  overflow-x: auto;
  scrollbar-width: thin;
  white-space: nowrap;
  font-size: 11px;
  background: var(--surface-muted);
}
.facility-status strong { color: var(--accent); }
.facility-status-project { max-width: 190px; overflow: hidden; text-overflow: ellipsis; }
.facility-status-message { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
.facility-status.error {
  background: color-mix(in srgb, var(--app-danger) 12%, var(--surface));
  color: var(--app-danger);
}
.facility-warning {
  background: var(--notice-bg);
  color: var(--notice-text);
}
.facility-warning {
  font-size: 12px;
}
</style>
