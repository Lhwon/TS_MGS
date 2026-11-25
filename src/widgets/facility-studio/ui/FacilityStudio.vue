<!--
/**
 * 파일명: FacilityStudio.vue
 * 설명: 설비 모델 제작과 포트 배치 및 실행 데이터 추출을 제공하는 설비 편집 화면
 * 작성자: 이희원
 * 작성일자: 2026-11-04
 */
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { mdiCubeOutline, mdiFolderOpenOutline, mdiRestore } from '@mdi/js'
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
} from '@/entities/facility/index.ts'
import type { FacilityAsset, FacilityCutawayRole, FacilityInstance, FacilityLight, FloorArea, FloorMaterial, FloorPoint, Point3, WallDoor } from '@/entities/facility/index.ts'
import { createFacilityScene } from '@/widgets/facility-studio/lib/FacilityScene.ts'
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

const emit = defineEmits<{ draftDirty: [value: boolean]; layer: [key: 'grid', visible: boolean] }>()

const props = defineProps<{
  layers?: Layers
}>()

const placementPort = ref('')
const glbInput = ref<HTMLInputElement>()
const glbImportOpen = ref(false)
const glbFile = shallowRef<File>()
const glbDraft = shallowRef<{
  file: File
  data: string
  model: Awaited<ReturnType<GlbModelCache['load']>>
}>()
const glbPreviewHost = ref<HTMLElement>()
const glbPreviewLoading = ref(false)
const glbPreviewError = ref('')
let glbPreview: ReturnType<typeof createGlbImportPreview> | undefined
const glbName = ref('')
const glbUnits = ref<'m' | 'mm'>('m')
const glbCategory = ref<NonNullable<FacilityAsset['catalogCategory']>>('equipment')
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
const glbImportError = ref('')
const glbDimensions = computed(() => glbDraft.value && glbModelSize(glbDraft.value.model, glbUnits.value))
const glbDimensionLabel = computed(() => glbDimensions.value &&
  [glbDimensions.value.x, glbDimensions.value.y, glbDimensions.value.z]
    .map((value) => value.toLocaleString('ko-KR', { maximumFractionDigits: 3 })).join(' × '),
)
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
const workspace = ref<'equipment' | 'building'>('equipment')
const buildingView = ref<'structure' | 'wall' | 'ceiling'>('structure')
const wallHostId = ref('')
const ceilingHostId = ref('')
const ceilingStart = shallowRef<FloorPoint>()
const ceilingHeight = ref(4000)
const mountAsset = shallowRef<FacilityAsset>()

const selectedModel = computed(() =>
  studio.document.assets.find((asset) => asset.id === studio.selected?.assetId),
)

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
const wallTransparency = computed(() =>
  Math.round(100 * (1 - (studio.selected?.wallOpacity ?? wallPart.value?.opacity ?? 1))),
)
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
/** 표시 정밀도를 정리하면서 작은 치수의 유효 숫자를 유지 */
const displaySize = (size: number) => Number(size.toPrecision(12))

const tool = ref<'select' | 'place' | 'wall' | 'floor' | 'ceiling' | 'port' | 'door' | 'window' | 'measure'>('select')
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

/** 클릭과 드래그의 선택 변경을 하나의 목록으로 반영하고 단일 객체에서만 핸들 활성화 */
const selectInstances = (ids: string[], operation: 'replace' | 'add' | 'toggle' = 'replace') => {
  if (operation !== 'replace' && !ids.length) return
  const next = new Set(operation === 'replace' ? [] : studio.selectedIds)
  for (const id of ids) {
    if (operation === 'toggle' && next.has(id)) next.delete(id)
    else next.add(id)
  }
  studio.selectedIds = [...next]
  tool.value = 'select'
  if (workspace.value === 'building' && buildingView.value === 'structure' && selectedWall.value && selectedStructureRole.value === 'wall')
    switchBuildingView('wall')
}

const error = ref('')

const reference = computed(() => ({
  name: map.sourceName,
  geometryKey: mapGeometryKey(map.document.nodes),
}))

const mismatch = computed(
  () =>
    !!studio.document.mapRef.geometryKey &&
    studio.document.mapRef.geometryKey !== reference.value.geometryKey,
)

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
    if (map.document.units !== 'mm') throw new Error('먼저 2D 맵의 실측 축척을 설정하세요.')
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

watch(
  () => [studio.selected, map.document, baseSize.value] as const,
  ([instance, , size]) => {
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
  },
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
    if (map.document.units !== 'mm') throw new Error('바닥을 배치하기 전에 2D 맵 축척을 확정하세요.')
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
    if (map.document.units !== 'mm') throw new Error('먼저 2D 맵의 실측 축척을 설정하세요.')
    if (mismatch.value) throw new Error('먼저 3D 설계를 현재 2D 맵에 연결하세요.')
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
  if (mismatch.value) throw new Error('먼저 3D 설계를 현재 2D 맵에 연결하세요.')
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

/** 선택한 배치의 벽체에만 투명도를 지정하고 기존 편집 이력에 기록 */
const setWallTransparency = (event: Event) => {
  const instance = studio.selected
  if (!instance || !wallPart.value) return
  const opacity = (100 - (event.target as HTMLInputElement).valueAsNumber) / 100
  attempt(() => studio.updateInstance(instance.id, { wallOpacity: opacity }))
}

/**
 * 기준 지도 노드의 중심 좌표에 선택 모델을 추가하고 시점을 맞추는 중앙 배치
 */
const placeCenter = (event: MouseEvent) => {
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

/**
 * 기준 맵 불일치를 확인한 뒤 기존 좌표를 유지하며 현재 지도에 연결하는 설계 맵 재지정
 */
const bind = () => {
  if (!mismatch.value || window.confirm('3D 배치 좌표를 유지한 채 현재 2D 맵에 연결하시겠습니까?'))
    studio.bindMap(reference.value)
}

/** 새 파일과 모델명을 지정하는 등록 팝업 초기화 */
const openGlbImport = () => {
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
  const previousFileName = glbFile.value?.name.replace(/\.glb$/i, '')
  glbFile.value = undefined
  glbImportError.value = ''
  if (!file.name.toLowerCase().endsWith('.glb') || file.size > MAX_GLB_BYTES) {
    glbImportError.value = '단일 GLB 파일은 12MB 이하여야 합니다.'
    return
  }
  glbFile.value = file
  const preset = legacyFacilityLight(file.name)
  if (preset) {
    glbCategory.value = 'lighting'
    lightKind.value = preset.kind
    lightTemperature.value = String(preset.temperature)
  }
  if (!glbName.value.trim() || glbName.value === previousFileName)
    glbName.value = file.name.replace(/\.glb$/i, '')
}

/** 선택한 GLB를 한 번만 읽고 같은 결과를 미리보기와 등록에 사용 */
watch([glbFile, glbImportOpen], async ([file, open], _, cleanup) => {
  glbDraft.value = undefined
  glbPreviewError.value = ''
  glbPreviewLoading.value = false
  if (!file || !open) return

  const cache = new GlbModelCache()
  const reader = new FileReader()
  let cancelled = false
  glbPreviewLoading.value = true
  cleanup(() => {
    cancelled = true
    cache.dispose()
    if (reader.readyState === FileReader.LOADING) reader.abort()
  })

  try {
    const data = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.onerror = () => reject(new Error('GLB 파일을 읽을 수 없습니다.'))
      reader.onabort = () => reject(new Error('GLB 파일 읽기를 취소했습니다.'))
      reader.readAsDataURL(file)
    })
    if (cancelled) return
    const model = await cache.load(data)
    if (!cancelled) glbDraft.value = { file, data, model }
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
const registerGlb = () => {
  const file = glbFile.value
  const draft = glbDraft.value
  const size = glbDimensions.value
  if (!file || draft?.file !== file || !size || studio.busy || catalogLoading.value || glbNameError.value) return
  if (glbCategory.value === 'lighting' && lightError.value) return

  glbImportError.value = ''
  studio.busy = true
  try {

    studio.setAsset(
      {
        id: crypto.randomUUID(),
        name: glbName.value.trim(),
        kind: 'equipment',
        parts: [],
        catalogCategory: glbCategory.value,
        glb: { data: draft.data, size, sourceName: file.name },
        ...(glbCategory.value === 'lighting' ? { light: lightSettings.value } : {}),
      },
      reference.value,
    )

    error.value = ''
    catalogCategory.value = glbCategory.value
    glbImportOpen.value = false
    glbFile.value = undefined
    studio.message = 'GLB 모델을 등록했습니다. 카탈로그에서 맵으로 끌어다 놓으세요.'
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
  return studio.document.instances.flatMap((instance) => {
    if (instance.attachedTo !== frame.instance.id) return []
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
const listedInstances = computed(() => {
  if (workspace.value === 'equipment') return studio.document.instances
  if (buildingView.value === 'wall' || buildingView.value === 'ceiling') {
    const host = buildingView.value === 'wall' ? wallHostId.value : ceilingHostId.value
    return studio.document.instances.filter((instance) => instance.id === host || instance.attachedTo === host)
  }
  return studio.document.instances.filter(({ id, attachedTo }) =>
    structureIds.value.has(id) || !!attachedTo || selectedIds.value.has(id),
  )
})
const wallFrame = computed(() => {
  const target = wallTargets.value.find(({ instance }) => instance.id === wallHostId.value)
  if (!target) return
  const body = wallBody(target.asset)!
  const instance = resolveFacilityInstance(target.instance, map.document.ports)
  const sx = instance.scale?.x ?? 1
  const sy = instance.scale?.y ?? 1
  const sz = instance.scale?.z ?? 1
  return {
    instance, width: body.size.x * sx, height: body.size.z * sz,
    center: { x: body.position.x * sx, y: body.position.y * sy, z: (body.position.z - body.size.z / 2) * sz },
    depth: body.size.y * sy,
  }
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
const buildingLocked = computed(() => studio.busy || mismatch.value)
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
    if (map.document.units !== 'mm' || mismatch.value) throw new Error('실측 축척이 있는 기준 맵이 필요합니다.')
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

const placeMountedAsset = (asset: FacilityAsset, point: FloorPoint) => {
  if (buildingLocked.value) return
  attempt(() => {
    validateCatalogPlacement(asset)
    const roof = buildingView.value === 'ceiling' ? ceilingFrame.value : undefined
    const wall = buildingView.value === 'wall' ? wallFrame.value : undefined
    const frame = roof ?? wall
    if (!frame) throw new Error('부착할 벽이나 천장을 먼저 선택하세요.')
    const bounds = facilityModelBounds(asset)
    if (bounds.isEmpty()) throw new Error('이 모델의 배치 치수를 확인하세요.')
    const position = localToMap(frame.instance, {
      x: frame.center.x + point.x - (bounds.min.x + bounds.max.x) / 2,
      y: wall ? wall.center.y - wall.depth / 2 - bounds.max.y :
        frame.center.y + point.y - (bounds.min.y + bounds.max.y) / 2,
    })
    const z = wall ? wall.instance.position.z + wall.center.z + point.y - (bounds.min.z + bounds.max.z) / 2 :
      roof!.underside - bounds.max.z
    studio.place(position.x, position.y, undefined, {
      z, cutawayRole: 'independent', attachedTo: frame.instance.id, rotation: frame.instance.rotation,
    }, { asset, mapRef: reference.value })
    mountAsset.value = undefined
    studio.message = `${asset.name} · ${frame.instance.name}에 연결했습니다.`
  })
}

const placePendingMount = (point: FloorPoint) => {
  if (mountAsset.value) placeMountedAsset(mountAsset.value, point)
}

const dropMountedAsset = (event: DragEvent, point: FloorPoint) => {
  const id = event.dataTransfer?.getData(catalogDragType)
  const asset = id && id === draggingModelId.value ? catalogAssets.value.find((item) => item.id === id) : undefined
  endCatalogDrag()
  if (!asset || buildingLocked.value) return
  event.preventDefault()
  placeMountedAsset(asset, point)
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
const openCatalog = async () => {
  error.value = ''
  if (workspace.value === 'building') catalogCategory.value = buildingView.value === 'ceiling' ? 'lighting' : 'interior'
  catalogOpen.value = true
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
  if (mounting.value) {
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
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(catalogDragType, asset.id)
}

/** 편집 가능한 맵에서 현재 카탈로그 드래그만 모델 복사로 허용 */
const allowCatalogDrop = (event: DragEvent) => {
  if (!draggingModelId.value || sitePreview.value || mismatch.value || studio.busy ||
      !event.dataTransfer?.types.includes(catalogDragType)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  catalogDropTarget.value = true
}

/** Three.js 캔버스 내부 요소를 지나갈 때 강조를 유지하고 영역을 벗어날 때 해제 */
const leaveCatalogDrop = (event: DragEvent) => {
  if (!(event.relatedTarget instanceof Node) || !host.value?.contains(event.relatedTarget))
    catalogDropTarget.value = false
}

/** 포트 또는 바닥의 드롭 좌표에 모델 한 개를 추가하고 배열 및 선택 상태를 갱신 */
const dropCatalogModel = (event: DragEvent) => {
  const id = event.dataTransfer?.getData(catalogDragType)
  const isCatalogModel = !!id && id === draggingModelId.value
  endCatalogDrag()
  if (!isCatalogModel) return
  event.preventDefault()
  if (sitePreview.value || mismatch.value || studio.busy) return

  const asset = catalogAssets.value.find((model) => model.id === id)
  if (!asset) return
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

onMounted(() => {
  try {
    scene = createFacilityScene(host.value!, {
      error: (message) => {
        error.value = message
      },
      select: selectInstances,
      place: handleFloorClick,
      finishFloor,
      placeAtPort,
      attachOpening,
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
  () => [map.document, map.theme, props.layers],
  () => attempt(() => scene?.setMap(map.document, map.theme, props.layers ?? DEFAULT_LAYERS)),
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

watch(tool, (value) => {
  if (value !== 'wall') wallStart.value = undefined
  if (value !== 'ceiling') ceilingStart.value = undefined
  if (value !== 'floor') floorDraft.value = undefined
  if (value !== 'measure') measurement.value = []
  scene?.setTool(sceneTool.value)
})
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
onBeforeUnmount(() => {
  glbFile.value = undefined
  scene?.dispose()
})
</script>

<template>
  <section
    class="facility-studio d-flex flex-column"
    aria-label="3D 시설 설계"
    @keydown.esc="sitePreview ? toggleSitePreview() : (scene?.cancelDirectMove(), tool = 'select')"
  >
    <div class="facility-toolbar d-flex flex-wrap align-center ga-2">
      <div>
        <strong>3D 시설·설비 설계</strong>
        <span>기준 2D 맵: {{ map.sourceName }}</span>
      </div>
      <v-btn
        text="설계 프로젝트 열기"
        data-testid="scene-open"
        :disabled="studio.busy"
        @click="studio.open"
      />
      <v-btn
        :text="`설계 프로젝트 저장 ${studio.dirty ? ' *' : ''}`"
        data-testid="scene-save"
        :disabled="studio.busy || mismatch || (!hasSceneContent && !studio.dirty)"
        @click="studio.save(map.projectToken)"
      />
      <v-btn
        text="3D 데이터 추출"
        data-testid="scene-export"
        :disabled="studio.busy || mismatch || !hasSceneContent"
        @click="studio.exportRuntime(map.document.ports, map.projectToken)"
      />
      <v-btn
        text="실행 취소"
        data-testid="scene-undo"
        :disabled="!studio.past.length"
        @click="studio.undo"
      />
      <v-btn
        text="다시 실행"
        data-testid="scene-redo"
        :disabled="!studio.future.length"
        @click="studio.redo"
      />
    </div>
    <div
      v-if="mismatch"
      class="facility-warning py-2 px-4"
    >
      기준 맵의 노드 좌표가 다릅니다. 배치를 확인하고 현재 맵에 연결해야 저장할 수 있습니다.
      <v-btn
        text="현재 2D 맵 연결"
        @click="bind"
      />
    </div>
    <nav class="facility-workspaces d-flex ga-2 px-4 py-2" aria-label="3D 편집 화면">
      <v-btn
        text="설비 배치"
        data-testid="facility-equipment-mode"
        :aria-pressed="workspace === 'equipment'"
        @click="switchWorkspace('equipment')"
      />
      <v-btn
        text="건물 편집"
        data-testid="facility-building-mode"
        :aria-pressed="workspace === 'building'"
        @click="switchWorkspace('building')"
      />
    </nav>
    <div class="facility-layout" :class="{ 'facility-site-preview': sitePreview }">
      <v-sheet
        tag="aside"
        aria-label="3D 작업 도구"
        class="facility-tools-panel overflow-auto"
        data-testid="facility-tools-panel"
      >
        <v-btn
          :text="sitePreview ? '편집으로 돌아가기' : '현장 미리보기'"
          :aria-pressed="sitePreview"
          data-testid="site-preview"
          class="w-100 mb-3"
          @click="toggleSitePreview"
        />
        <p v-if="sitePreview" class="text-caption facility-muted">
          눈높이 1.6 m · 오른쪽 드래그로 회전 · Space와 왼쪽 드래그로 이동
        </p>
        <div v-show="!sitePreview">
          <div v-if="workspace === 'building'" class="d-flex flex-column ga-2 mb-4" aria-label="건물 편집 도구">
            <v-btn text="구조 배치" data-testid="building-structure-view" :aria-pressed="buildingView === 'structure'" @click="switchBuildingView('structure')" />
            <v-btn text="벽 정면" data-testid="building-wall-view" :aria-pressed="buildingView === 'wall'" @click="switchBuildingView('wall')" />
            <v-btn text="천장 배치도" data-testid="building-ceiling-view" :aria-pressed="buildingView === 'ceiling'" @click="switchBuildingView('ceiling')" />
          </div>
          <div v-if="!mounting || (buildingView === 'wall' ? wallFrame : ceilingFrame)" class="d-flex flex-column ga-2 mb-4">
            <v-btn
              text="GLB 모델 카탈로그"
              class="facility-primary"
              data-testid="default-catalog"
              :aria-pressed="catalogOpen"
              :disabled="studio.busy"
              @click="catalogOpen ? (catalogOpen = false) : openCatalog()"
            />
            <span
              v-if="studio.asset"
              class="text-caption text-truncate"
              :title="studio.asset.name"
            >
              {{ studio.asset.name }}
            </span>
            <div v-if="workspace === 'equipment'" class="facility-tabs">
              <v-btn
                text="새 모델 디자인"
                data-testid="new-model"
                :disabled="studio.busy"
                @click="openDesigner()"
              />
              <v-btn
                text="선택 모델 편집"
                data-testid="model-edit"
                :disabled="!studio.asset || !!studio.asset.glb || studio.busy"
                @click="openDesigner(studio.asset ?? null)"
              />
            </div>
          </div>
          <h2>{{ workspace === 'equipment' ? '배치 및 편집' : '편집 기준' }}</h2>
          <label class="facility-snap-setting d-flex align-center justify-space-between ga-2 mb-1 text-caption">
            스냅 간격
            <select v-model="snapStep" data-testid="facility-snap-step">
              <option v-for="step in transformSnapSteps" :key="step" :value="step">{{ step }} mm</option>
            </select>
          </label>
          <p class="text-caption facility-muted mb-2">Alt 자유 조작</p>
          <template v-if="workspace === 'equipment'">
          <div class="facility-tabs mb-2">
            <v-btn
              v-for="[value, label] in [
                ['select', '선택'],
                ['place', '바닥 배치'],
                ['port', '포트 클릭 배치'],
              ] as const"
              :key="value"
              :data-testid="`tool-${value}`"
              :disabled="value !== 'select' && !studio.asset"
              :class="{ active: tool === value }"
              @click="tool = value"
            >
              {{ label }}
            </v-btn>
            <v-btn
              data-testid="place-center"
              :disabled="!studio.asset"
              @click="placeCenter"
            >
              중앙 배치
            </v-btn>
          </div>
          <div class="d-flex flex-column ga-2 mb-4">
            <select
              v-model="placementPort"
              aria-label="배치할 포트"
              data-testid="placement-port"
            >
              <option value="">Port ID 선택</option>
              <option
                v-for="port in map.document.ports"
                :key="port.id"
                :value="port.id"
              >
                {{ port.id }}
              </option>
            </select>
            <v-btn
              data-testid="place-port"
              :disabled="!studio.asset || !placementPort"
              @click="placeAtPort(placementPort)"
            >
              선택 포트에 1개 배치
            </v-btn>
          </div>
          </template>
          <template v-if="workspace === 'building' && buildingView === 'structure'">
          <h2>구조 배치</h2>
          <div class="facility-tabs mb-2">
            <v-btn
              text="벽 그리기"
              data-testid="interior-wall"
              :class="{ active: tool === 'wall' }"
              :aria-pressed="tool === 'wall'"
              :disabled="studio.busy || mismatch"
              @click="tool === 'wall' ? (tool = 'select') : startWall()"
            />
            <v-btn
              :text="map.document.layout ? '도면 설정' : '도면 불러오기'"
              data-testid="interior-layout"
              :aria-pressed="layoutOpen"
              @click="layoutOpen = !layoutOpen"
            />
          </div>
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
          <div class="facility-tabs mb-2">
            <v-btn text="사각 바닥" data-testid="floor-rectangle" :disabled="studio.busy" @click="startFloor('rectangle')" />
            <v-btn text="다각형 바닥" data-testid="floor-polygon" :disabled="studio.busy" @click="startFloor('polygon')" />
          </div>
          <div class="d-flex flex-column ga-2 mb-3">
            <v-btn text="천장 그리기" data-testid="place-ceiling" :aria-pressed="tool === 'ceiling'" :disabled="buildingLocked" @click="startCeiling" />
            <label v-if="tool === 'ceiling'" class="text-caption">
              천장 아랫면 높이 (mm)
              <input v-model.number="ceilingHeight" data-testid="building-ceiling-height" type="number" min="1" />
            </label>
            <p v-if="tool === 'ceiling'" class="text-caption" role="status">
              {{ ceilingStart ? '맞은편 모서리를 클릭하세요.' : '천장의 첫 번째 모서리를 클릭하세요.' }}
            </p>
            <label v-if="independentInstances.length" class="text-caption">
              기존 객체 선택
              <select data-testid="building-existing-object" :value="studio.selectedId ?? ''" @change="pickExistingObject(($event.target as HTMLSelectElement).value)">
                <option value="">객체 선택</option>
                <option v-for="instance in independentInstances" :key="instance.id" :value="instance.id">{{ instance.name }}</option>
              </select>
            </label>
          </div>
          </template>
          <template v-if="workspace === 'building' && buildingView === 'wall'">
            <label class="d-block text-caption mb-3">
              편집할 벽
              <select data-testid="building-wall-select" :value="wallHostId" @change="openWall(($event.target as HTMLSelectElement).value)">
                <option value="">벽 선택</option>
                <option v-for="{ instance } in wallTargets" :key="instance.id" :value="instance.id">{{ instance.name }}</option>
              </select>
            </label>
          </template>
          <div v-if="workspace === 'building' && buildingView !== 'ceiling'" class="facility-tabs mb-4">
            <v-btn
              text="문 붙이기"
              data-testid="interior-door"
              :class="{ active: tool === 'door' }"
              :disabled="buildingLocked || (buildingView === 'wall' && !wallFrame)"
              @click="startSiteTool('door')"
            />
            <v-btn
              text="창문 붙이기"
              data-testid="interior-window"
              :class="{ active: tool === 'window' }"
              :disabled="buildingLocked || (buildingView === 'wall' && !wallFrame)"
              @click="startSiteTool('window')"
            />
          </div>
          <p v-if="tool === 'door' || tool === 'window'" class="text-caption mb-3" role="status">
            벽에서 {{ tool === 'door' ? '문' : '창문' }}이 들어갈 위치를 클릭하세요. Esc 취소
          </p>
          <label v-if="workspace === 'building' && buildingView === 'ceiling'" class="d-block text-caption mb-3">
            부착할 천장
            <select data-testid="building-ceiling-select" :value="ceilingHostId" @change="openCeiling(($event.target as HTMLSelectElement).value)">
              <option value="">천장 선택</option>
              <option v-for="{ instance } in ceilingTargets" :key="instance.id" :value="instance.id">{{ instance.name }}</option>
            </select>
          </label>
          <v-btn v-if="mountAsset && mounting" text="부착 취소" @click="mountAsset = undefined" />
          <template v-if="showScene">
          <h2>보기</h2>
          <div class="facility-tabs">
            <v-btn
              data-testid="measure-tool"
              :aria-pressed="tool === 'measure'"
              @click="tool === 'measure' ? (tool = 'select') : startSiteTool('measure')"
            >
              <span class="facility-view-indicator mr-2" aria-hidden="true"></span>
              치수 확인
            </v-btn>
            <v-btn
              data-testid="scene-fit"
              @click="scene?.fit()"
            >
              전체 보기
            </v-btn>
            <v-btn @click="scene?.fit(true)">위에서 보기</v-btn>
            <v-btn
              data-testid="facility-grid-toggle"
              :aria-pressed="showGrid"
              @click="emit('layer', 'grid', !showGrid)"
            >
              <span class="facility-view-indicator mr-2" aria-hidden="true"></span>
              격자 표시
            </v-btn>
            <v-btn
              v-if="map.document.layout"
              :class="{ active: showFloorPlan }"
              :aria-pressed="showFloorPlan"
              data-testid="interior-floor-plan"
              @click="floorPlanVisible = !showFloorPlan"
            >
              배경 도면
            </v-btn>
          </div>
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
        </div>
      </v-sheet>
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
            @focus="focusWallOpening"
            @apply="applyWallDoors"
            @select="studio.selectedId = $event"
            @place="placePendingMount"
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
            : '빈 곳 드래그: 영역 선택 · Shift + 클릭: 추가 또는 해제 · Space + 드래그: 화면 이동' }}
        </div>
      </div>
      <ModelCatalog
        v-show="catalogOpen && !sitePreview"
        v-model:category="catalogCategory"
        :visible="catalogOpen && !sitePreview"
        :assets="catalogAssets"
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
      <v-sheet
        tag="aside"
        v-show="!sitePreview && !catalogOpen"
        class="facility-inspector overflow-auto"
      >
        <FloorAreaEditor
          v-if="workspace === 'building' && buildingView === 'structure'"
          :areas="floorAreas"
          :selected="selectedFloor"
          :busy="studio.busy || !!floorDraft"
          @select="selectFloor"
          @apply="updateFloor"
          @order="moveFloor"
          @remove="removeFloor"
          @redraw="startFloor('polygon', floorId)"
        />
        <h2>
          배치 목록
          <small data-testid="instance-count">{{ listedInstances.length }}</small>
        </h2>
        <div class="facility-instance-list overflow-auto">
          <v-btn
            v-for="instance in listedInstances"
            :key="instance.id"
            class="facility-row w-100 text-start"
            :class="{ active: selectedIds.has(instance.id) }"
            :aria-pressed="selectedIds.has(instance.id)"
            @click="selectInstances([instance.id], $event.shiftKey ? 'toggle' : 'replace')"
          >
            <strong>{{ instance.name }}</strong>
            <small>
              {{ instance.position.x }}, {{ instance.position.y }}, {{ instance.position.z }} mm
            </small>
          </v-btn>
        </div>
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
          <h2>{{ selectedWall ? '벽 속성' : '선택 시설' }}</h2>
          <label>
            이름
            <v-text-field
              v-model="pose.name"
              maxlength="300"
              required
            />
          </label>
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
            회전 °
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
            벽 투명도 {{ wallTransparency }}%
            <input
              type="range"
              min="0"
              max="100"
              data-testid="wall-transparency"
              :value="wallTransparency"
              @change="setWallTransparency"
            />
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
          v-else
          class="facility-muted ma-0"
        >
          시설을 선택하면 가로·세로·높이를 mm로 설정할 수 있습니다.
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
    </div>
    <div
      class="facility-status py-2 px-4"
      :class="{ error: !!error }"
      role="status"
    >
      {{ error || studio.message }}
    </div>
    <DrawingLayout
      v-model="layoutOpen"
      :map="map.document"
      @apply="applyDrawingLayout"
      @remove="attempt(() => map.setLayout())"
    />
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
                  :disabled="studio.busy"
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
.facility-studio {
  flex: 1;
  min-height: 0;
  background: var(--surface-muted);
  color: var(--text);
}
.facility-toolbar {
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.facility-toolbar > div {
  margin-right: auto;
  display: grid;
  gap: 3px;
}
.facility-toolbar span {
  font-size: 11px;
  color: var(--text-secondary);
}
.facility-studio button {
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 7px 10px;
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.facility-studio button:hover:enabled {
  border-color: var(--accent);
  background: var(--surface-muted);
  color: var(--accent);
}
.facility-studio button.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
.facility-studio button:disabled {
  opacity: 0.4;
  cursor: default;
}
.facility-studio .facility-primary {
  background: var(--accent-fill);
  color: var(--on-accent);
  border-color: var(--accent-fill);
}
.facility-studio .facility-primary:hover:enabled {
  background: color-mix(in srgb, var(--accent-fill) 85%, var(--surface));
  color: var(--on-accent);
  border-color: var(--accent-fill);
}
// 기본 브라우저 회색 배경 대신 테마를 사용하는 포트와 단위 선택 입력
select {
  background: var(--input-bg);
  color: var(--text);
  border: 1px solid var(--app-border);
  border-radius: 7px;
  padding: 5px 7px;
}
.facility-workspaces { background: var(--surface); border-bottom: 1px solid var(--border); }
.facility-workspaces [aria-pressed='true'] { background: var(--accent); color: var(--surface); }
.facility-tools-panel label select { display: block; width: 100%; margin-top: 4px; }
.facility-layout {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr) 270px;
  flex: 1;
  min-height: 0;
}
.facility-layout.facility-site-preview {
  grid-template-columns: 232px minmax(0, 1fr);
}
.facility-tools-panel {
  min-width: 0;
  min-height: 0;
  padding: 12px;
  border-right: 1px solid var(--border);
  background: var(--surface);
}
.facility-inspector {
  background: var(--surface);
  padding: 16px;
}
.facility-inspector {
  border-left: 1px solid var(--border);
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
.facility-view-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #8b929b;
}
[aria-pressed='true'] .facility-view-indicator {
  background: #24ad5f;
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
.facility-form input {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 7px;
  background: var(--surface);
  color: var(--text);
}
.facility-form select {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 7px;
  background: var(--surface);
  color: var(--text);
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
.facility-row {
  justify-content: flex-start;
  height: auto;
  min-height: var(--v-btn-height);
  margin-bottom: 6px;
}
.facility-row :deep(.v-btn__content) {
  display: grid;
  justify-items: start;
  gap: 3px;
  min-width: 0;
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
}
.facility-row small {
  font-size: 10px;
  color: var(--text-secondary);
}
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
.facility-status {
  font-size: 11px;
  background: var(--surface-muted);
}
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
.facility-instance-list {
  max-height: 30%;
  margin-bottom: 18px;
}
@media (max-width: 1250px) {
  .facility-studio .facility-primary:hover:enabled {
    background: color-mix(in srgb, var(--accent-fill) 85%, var(--surface));
    color: var(--on-accent);
    border-color: var(--accent-fill);
  }
  // 기본 브라우저 회색 배경 대신 테마를 사용하는 포트와 단위 선택 입력
  select {
    background: var(--input-bg);
    color: var(--text);
    border: 1px solid var(--app-border);
    border-radius: 7px;
    padding: 5px 7px;
  }
  .facility-layout {
    grid-template-columns: 214px minmax(0, 1fr) 235px;
  }
  .facility-layout.facility-site-preview {
    grid-template-columns: 214px minmax(0, 1fr);
  }
  .facility-inspector {
    padding: 12px;
  }
  .facility-toolbar > div span {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
