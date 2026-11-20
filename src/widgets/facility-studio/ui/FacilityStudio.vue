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
import { useFacilityEditor } from '@/features/facility-editor/index.ts'
import { useEditor } from '@/features/map-editor/index.ts'
import {
  mapGeometryKey,
  resolveFacilityInstance,
  MAX_GLB_BYTES,
  facilityModelSize,
  createInteriorModel,
  floorMaterials,
  interiorModels,
  loadDefaultCatalog,
  MAX_FLOOR_POINTS,
  wallBody,
  wallDoorLimits,
} from '@/entities/facility/index.ts'
import type { FacilityAsset, FloorArea, FloorMaterial, FloorPoint, Point3, WallDoor } from '@/entities/facility/index.ts'
import { createFacilityScene } from '@/widgets/facility-studio/lib/FacilityScene.ts'
import { DEFAULT_LAYERS, type Layers } from '@/entities/map/index.ts'
import { GlbModelCache } from '@bem/map3d/glb'
import ModelDesigner from '@/widgets/facility-studio/ui/ModelDesigner.vue'
import FloorAreaEditor from '@/widgets/facility-studio/ui/FloorAreaEditor.vue'
import ModelCatalog from '@/widgets/facility-studio/ui/ModelCatalog.vue'
import WallDoorEditor from '@/widgets/facility-studio/ui/WallDoorEditor.vue'

const emit = defineEmits<{ draftDirty: [value: boolean] }>()

const props = defineProps<{
  layers?: Layers
}>()

const placementPort = ref('')
const glbInput = ref<HTMLInputElement>()
const glbUnits = ref<'m' | 'mm'>('m')
const catalogOpen = ref(false)
const catalogCategory = ref<NonNullable<FacilityAsset['catalogCategory']>>('equipment')
const catalogLoading = ref(false)
const defaultCatalog = shallowRef<FacilityAsset[]>()
const interiorCatalog = (Object.keys(interiorModels) as (keyof typeof interiorModels)[]).map(createInteriorModel)
const studio = useFacilityEditor(),
  map = useEditor()

const host = ref<HTMLElement>()

const selectedModel = computed(() =>
  studio.document.assets.find((asset) => asset.id === studio.selected?.assetId),
)
const catalogAssets = computed(() => {
  const entries = new Map([...interiorCatalog, ...(defaultCatalog.value ?? [])].map((asset) => [asset.id, asset]))
  for (const asset of studio.document.assets) entries.set(asset.id, asset)
  return [...entries.values()]
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
const wallStart = shallowRef<{ x: number; y: number }>()
const floorPlanVisible = ref<boolean>()
const showFloorPlan = computed(() => floorPlanVisible.value ?? !!map.document.layout?.visible)
const sizeFields = [
  { axis: 'x', label: '가로' },
  { axis: 'y', label: '세로' },
  { axis: 'z', label: '높이' },
] as const
type SizeAxis = (typeof sizeFields)[number]['axis']
const minScale = 0.001
const maxScale = 1000
const quickStepMm = 10
const quickResize = shallowRef<{
  id: string
  axis: SizeAxis
  pointerId: number
  startX: number
  startSize: number
  scale: Record<SizeAxis, number>
}>()

/** 표시 정밀도를 정리하면서 작은 치수의 유효 숫자를 유지 */
const displaySize = (size: number) => Number(size.toPrecision(12))

const tool = ref<'select' | 'place' | 'wall' | 'floor' | 'port' | 'translate' | 'rotate' | 'scale' | 'door' | 'window' | 'measure'>('select')
const sceneTool = computed(() => {
  if (tool.value === 'wall' || tool.value === 'floor') return 'place'
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
  if (next.size > 1) tool.value = 'select'
  else if (next.size === 1 && tool.value !== 'rotate' && tool.value !== 'scale')
    tool.value = 'translate'
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
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  carrierRotation: '' as string | number,
  size: { x: 0, y: 0, z: 0 },
  portId: '',
  nodeId: '',
})

let scene: ReturnType<typeof createFacilityScene> | undefined

/** 지도 편집 위치를 보존한 채 현장 눈높이 미리보기로 전환 */
const toggleSitePreview = () => {
  if (!scene) return
  cancelQuickResize()
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

/** 현재 벽의 상대 위치에 문이나 창을 부착하고 기존 개구부의 치수를 변경 */
const applyWallDoors = (wallDoors: WallDoor[], focus: string) => {
  if (!studio.selected || !selectedWall.value) return
  if (attempt(() => studio.updateInstance(studio.selected!.id, { wallDoors })))
    focusedOpening.value = focus
}

/** 실측 스케일을 사용하는 지도에서 부착이나 측정을 시작 */
const startSiteTool = (mode: 'door' | 'window' | 'measure') => {
  attempt(() => {
    if (map.document.units !== 'mm') throw new Error('먼저 2D 맵의 실측 축척을 설정하세요.')
    if (mode === 'measure') measurement.value = []
    tool.value = mode
  })
}

/** 벽에서 찍은 점을 로컬 치수로 환산하고 일치하는 높이에 개구부를 부착 */
const attachOpening = (id: string | undefined, point: Point3) => {
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
    const opening: WallDoor = {
      id: crypto.randomUUID(),
      offset: Math.max(-limit, Math.min(limit, Math.round(clickedX))),
      width: openingWidth,
      height: openingHeight,
      ...(window
        ? { kind: 'window', sill: Math.max(0, Math.min(height - openingHeight, Math.round(clickedHeight - openingHeight / 2))) }
        : {}),
    }
    studio.updateInstance(instance.id, { wallDoors: [...(instance.wallDoors ?? []), opening] })
    studio.selectedId = instance.id
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
  const scale = { x: 1, y: 1, z: 1 }
  for (const { axis, label } of sizeFields) {
    const value = Number(pose.size[axis])
    const current = studio.selected?.scale?.[axis] ?? 1
    const ratio = value === displaySize(size[axis] * current) ? current : value / size[axis]
    const doorMinimum = minimumDoorSize(axis)
    if (doorMinimum > 0 && ratio * size[axis] < doorMinimum - 0.000001)
      throw new Error(`부착한 문과 창문을 유지하려면 벽 ${label} 치수를 ${doorMinimum} mm 이상으로 설정하세요.`)
    if (!Number.isFinite(ratio) || ratio < minScale * (1 - 1e-10) || ratio > maxScale * (1 + 1e-10))
      throw new Error(
        `${label}는 ${displaySize(size[axis] * minScale)}~${displaySize(size[axis] * maxScale)} mm로 입력하세요.`,
      )
    scale[axis] = Math.max(minScale, Math.min(maxScale, ratio))
  }
  return scale
}

/** 입력 초안과 독립적으로 실제 배치 크기 또는 드래그 중인 치수 표시 */
const quickSize = (axis: SizeAxis) => {
  const scale = quickResize.value?.scale ?? studio.selected?.scale
  return (baseSize.value?.[axis] ?? 0) * (scale?.[axis] ?? 1)
}

/** 변경할 축의 치수를 적용하면서 나머지 축의 배율 유지 */
const quickScale = (axis: SizeAxis, size: number, source = studio.selected?.scale) => {
  const base = baseSize.value?.[axis]
  if (!base || !Number.isFinite(size)) return
  const scale = { x: source?.x ?? 1, y: source?.y ?? 1, z: source?.z ?? 1 }
  scale[axis] = Math.max(minScale, minimumDoorSize(axis) / base, Math.min(maxScale, size / base))
  return scale
}

/** 부착한 문의 위치와 크기를 유지하는 데 필요한 벽의 축별 최소 치수 */
const minimumDoorSize = (axis: SizeAxis) =>
  axis === 'x' ? doorLimits.value.width : axis === 'z' ? doorLimits.value.height : 0

/** 빠른 크기 조절을 시작할 때 선택 배치와 기준 치수 및 포인터를 기록 */
const startQuickResize = (event: PointerEvent, axis: SizeAxis) => {
  const instance = studio.selected
  if (event.button !== 0 || !instance || quickResize.value || !baseSize.value) return
  const handle = event.currentTarget as HTMLElement
  handle.focus()
  handle.setPointerCapture(event.pointerId)
  quickResize.value = {
    id: instance.id,
    axis,
    pointerId: event.pointerId,
    startX: event.clientX,
    startSize: quickSize(axis),
    scale: { x: instance.scale?.x ?? 1, y: instance.scale?.y ?? 1, z: instance.scale?.z ?? 1 },
  }
}

/** 좌우 드래그를 밀리미터 단위의 변경량으로 바꾸고 씬에 미리 적용 */
const moveQuickResize = (event: PointerEvent) => {
  const draft = quickResize.value
  if (!draft || draft.pointerId !== event.pointerId) return
  const delta = Math.round(event.clientX - draft.startX) * quickStepMm
  const scale = quickScale(draft.axis, draft.startSize + delta, draft.scale)
  if (!scale || scale[draft.axis] === draft.scale[draft.axis]) return
  quickResize.value = { ...draft, scale }
  scene?.previewScale(draft.id, scale)
}

/** 포인터 취소와 선택 변경 시 마지막으로 저장한 배치 크기를 복원 */
const cancelQuickResize = (event?: PointerEvent) => {
  const draft = quickResize.value
  if (!draft || (event && event.pointerId !== draft.pointerId)) return
  quickResize.value = undefined
  scene?.previewScale(draft.id)
}

/** 드래그가 끝난 크기 편집을 하나의 실행 취소 단위로 반영 */
const finishQuickResize = (event: PointerEvent) => {
  if (quickResize.value?.pointerId !== event.pointerId) return
  moveQuickResize(event)
  const draft = quickResize.value
  cancelQuickResize()
  if (
    draft &&
    studio.selected?.id === draft.id &&
    draft.scale[draft.axis] !== (studio.selected.scale?.[draft.axis] ?? 1)
  )
    attempt(() => studio.updateInstance(draft.id, { scale: draft.scale }))
}

/** 크기 조절 버튼에 포커스를 둔 상태에서 키보드로 치수를 변경 */
const quickResizeKey = (event: KeyboardEvent, axis: SizeAxis) => {
  if (event.key === 'Escape' && quickResize.value) {
    event.stopPropagation()
    cancelQuickResize()
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey || quickResize.value) return
  const direction =
    event.key === 'ArrowRight' || event.key === 'ArrowUp'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? -1
        : 0
  const instance = studio.selected
  if (!direction || !instance) return
  event.preventDefault()
  const scale = quickScale(
    axis,
    quickSize(axis) + direction * quickStepMm * (event.shiftKey ? 10 : 1),
  )
  if (scale && scale[axis] !== (instance.scale?.[axis] ?? 1))
    attempt(() => studio.updateInstance(instance.id, { scale }))
}

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

/** 바닥의 두 지점 사이를 연결하는 벽이나 선택 모델 하나를 배치 */
const placeOnFloor = (x: number, y: number) => {
  attempt(() => {
    const draft = floorDraft.value
    if (tool.value === 'floor' && draft) {
      const first = draft.points[0]
      if (draft.shape === 'rectangle' && first) {
        applyFloorBoundary([first, { x, y: first.y }, { x, y }, { x: first.x, y }], draft.replaceId)
      } else {
        if (draft.points.length >= MAX_FLOOR_POINTS) throw new Error('최대 꼭짓점 수에 도달했습니다.')
        floorDraft.value = { ...draft, points: [...draft.points, { x, y }] }
      }
      return
    }
    if (tool.value === 'wall') {
      if (!wallStart.value) {
        wallStart.value = { x, y }
        return
      }
      const start = wallStart.value
      const model = studio.asset
      if (!model) return
      const dx = x - start.x
      const dy = y - start.y
      const length = Math.hypot(dx, dy)
      if (length < 10) throw new Error('시작점과 다른 위치에서 벽을 끝내세요.')
      studio.place((start.x + x) / 2, (start.y + y) / 2, undefined, {
        rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
        scale: { x: length / facilityModelSize(model).x, y: 1, z: 1 },
      })
      wallStart.value = undefined
    } else {
      studio.place(x, y)
    }
    tool.value = 'translate'
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
const placeCenter = () => {
  attempt(() => {
    const nodes = map.document.nodes
    const x = nodes.length ? nodes.reduce((sum, n) => sum + n.x, 0) / nodes.length : 0
    const y = nodes.length ? nodes.reduce((sum, n) => sum + n.y, 0) / nodes.length : 0
    studio.place(Math.round(x / 10) * 10, Math.round(y / 10) * 10)
    tool.value = 'translate'
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
    tool.value = 'translate'
  })
}

/**
 * 편집된 절대 위치를 연결 포트 기준 오프셋으로 환산하여 저장하는 배치 속성 갱신
 *
 * @param id 조회하거나 편집할 대상의 고유 식별자
 * @param patch 식별자를 유지하면서 교체할 대상 속성
 */
const updatePose = (id: string, patch: Parameters<typeof studio.updateInstance>[1]) => {
  const old = studio.document.instances.find((i) => i.id === id)
  if (!old) return
  const portId = 'portId' in patch ? patch.portId : old.portId
  const port = map.document.ports.find((p) => p.id === portId)
  if (portId && !port) throw new Error('연결 포트를 찾을 수 없습니다.')
  const position = patch.position ?? resolveFacilityInstance(old, map.document.ports).position
  studio.updateInstance(id, {
    ...patch,
    position,
    portOffset: port
      ? { x: position.x - port.x, y: position.y - port.y, z: position.z }
      : undefined,
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
    updatePose(studio.selectedId!, {
      name: pose.name,
      position: { x: Number(pose.x), y: Number(pose.y), z: Number(pose.z) },
      rotation: Number(pose.rotation),
      carrierRotation: pose.carrierRotation === '' ? undefined : Number(pose.carrierRotation),
      scale: scaleFromSize(),
      portId: pose.portId || undefined,
      nodeId: pose.nodeId === '' ? undefined : Number(pose.nodeId),
    })
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

/** 로컬 GLB의 내장 형상과 원본 단위를 검증한 라이브러리 등록 */
const importGlb = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || studio.busy) return
  const cache = new GlbModelCache()
  studio.busy = true
  try {
    if (!file.name.toLowerCase().endsWith('.glb') || file.size > MAX_GLB_BYTES)
      throw new Error('단일 GLB 파일은 12MB 이하여야 합니다.')
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.onerror = () => reject(new Error('GLB 파일을 읽을 수 없습니다.'))
      reader.readAsDataURL(file)
    })
    const size = await cache.measure(data, glbUnits.value)
    studio.setAsset(
      {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.glb$/i, ''),
        kind: 'equipment',
        parts: [],
        catalogCategory: catalogCategory.value,
        glb: { data, size, sourceName: file.name },
      },
      reference.value,
    )
    error.value = ''
    studio.message = 'GLB 모델을 가져왔습니다. 바닥이나 포트에 배치하고 크기를 조절하세요.'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    cache.dispose()
    studio.busy = false
    input.value = ''
  }
}

/** 기본 모델을 한 번만 조회하고 팝업에서 선택할 모델을 표시 */
const openCatalog = async () => {
  error.value = ''
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

/** 카탈로그에서 모델을 선택하고 벽 그리기 또는 바닥 배치로 전환 */
const chooseCatalogModel = (asset: FacilityAsset) => {
  attempt(() => {
    if (map.document.units !== 'mm' && interiorCatalog.some((model) => model.id === asset.id))
      throw new Error('인테리어를 배치하기 전에 2D 맵 축척을 확정하세요.')
    if (studio.document.assets.some((item) => item.id === asset.id)) studio.selectedAssetId = asset.id
    else studio.setAsset(asset, reference.value)
    catalogOpen.value = false
    wallStart.value = undefined
    floorId.value = ''
    const drawingWall = asset.id === 'interior-wall'
    tool.value = drawingWall ? 'wall' : 'place'
    studio.message = drawingWall
      ? `${asset.name} · 바닥에서 시작점과 끝점을 클릭하세요.`
      : `${asset.name} · 배치할 바닥 위치를 클릭하세요.`
  })
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
      place: placeOnFloor,
      finishFloor,
      placeAtPort,
      attachOpening,
      measurePoint: addMeasurePoint,
      move: (id, position, rotation, scale) =>
        attempt(() => updatePose(id, { position, rotation, scale })),
    })
    scene.setMap(map.document, map.theme, props.layers ?? DEFAULT_LAYERS)
    scene.setDocument(studio.document)
    scene.setSelected(studio.selectedIds)
    scene.setTool(sceneTool.value)
    scene.fit()
  } catch (e) {
    error.value = `3D 초기화 실패: ${e instanceof Error ? e.message : String(e)}`
  }
})

watch(
  () => studio.document,
  (doc) => {
    cancelQuickResize()
    attempt(() => scene?.setDocument(doc))
  },
)

watch(
  () => studio.selectedIds,
  (ids) => {
    cancelQuickResize()
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
    cancelQuickResize()
    error.value = ''
    placementPort.value = ''
    floorId.value = ''
    floorPlanVisible.value = undefined
    designerOpen.value = false
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
  if (value !== 'floor') floorDraft.value = undefined
  if (value !== 'measure') measurement.value = []
  scene?.setTool(sceneTool.value)
})
watch(measurement, (points) => scene?.setMeasurement(points))
watch([floorDraft, selectedFloor], ([draft, area]) => {
  scene?.setFloorOutline(
    draft?.points ?? area?.points ?? [],
    !draft && !!area,
    draft?.shape === 'polygon',
  )
})
watch(floorPlanVisible, (value) => scene?.setFloorPlanVisible(value))
watch(
  () => studio.selectedAssetId,
  (id) => {
    if (tool.value === 'wall' && id !== 'interior-wall') tool.value = 'select'
  },
)
onBeforeUnmount(() => scene?.dispose())
</script>

<template>
  <section
    class="facility-studio d-flex flex-column"
    aria-label="3D 시설 설계"
    @keydown.esc="sitePreview ? toggleSitePreview() : (['wall', 'floor', 'door', 'window', 'measure'].includes(tool) && (tool = 'select'))"
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
        :disabled="studio.busy || mismatch || !hasSceneContent"
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
          <div class="d-flex flex-column ga-2 mb-4">
            <v-btn
              text="GLB 모델 카탈로그"
              class="facility-primary"
              data-testid="default-catalog"
              :disabled="studio.busy"
              @click="openCatalog"
            />
            <span
              v-if="studio.asset"
              class="text-caption text-truncate"
              :title="studio.asset.name"
            >
              {{ studio.asset.name }}
            </span>
            <div class="facility-tabs">
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
          <h2>배치 및 편집</h2>
          <div class="facility-tabs mb-2">
            <v-btn
              v-for="[value, label] in [
                ['select', '선택'],
                ['place', '바닥 배치'],
                ['port', '포트 클릭 배치'],
                ['translate', '이동'],
                ['rotate', '회전'],
                ['scale', '크기'],
              ] as const"
              :key="value"
              :data-testid="`tool-${value}`"
              :disabled="((value === 'place' || value === 'port') && !studio.asset) ||
                (multiSelected && (value === 'translate' || value === 'rotate' || value === 'scale'))"
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
          <h2>인테리어 편집</h2>
          <div class="facility-tabs mb-2">
            <v-btn text="사각 바닥" data-testid="floor-rectangle" :disabled="studio.busy" @click="startFloor('rectangle')" />
            <v-btn text="다각형 바닥" data-testid="floor-polygon" :disabled="studio.busy" @click="startFloor('polygon')" />
          </div>
          <div class="facility-tabs mb-4">
            <v-btn
              text="문 붙이기"
              data-testid="interior-door"
              :class="{ active: tool === 'door' }"
              :disabled="studio.busy"
              @click="startSiteTool('door')"
            />
            <v-btn
              text="창문 붙이기"
              data-testid="interior-window"
              :class="{ active: tool === 'window' }"
              :disabled="studio.busy"
              @click="startSiteTool('window')"
            />
          </div>
          <p v-if="tool === 'door' || tool === 'window'" class="text-caption mb-3" role="status">
            벽에서 {{ tool === 'door' ? '문' : '창문' }}이 들어갈 위치를 클릭하세요. Esc 취소
          </p>
          <h2>보기</h2>
          <div class="facility-tabs">
            <v-btn
              data-testid="measure-tool"
              :aria-pressed="tool === 'measure'"
              @click="tool === 'measure' ? (tool = 'select') : startSiteTool('measure')"
            >
              <span class="facility-measure-indicator mr-2" aria-hidden="true"></span>
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
          <p v-if="tool === 'wall'" class="text-caption mt-3" role="status">
            {{ wallStart ? '벽의 끝점을 클릭하세요.' : '벽의 시작점을 클릭하세요.' }} Esc 취소
          </p>
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
        </div>
      </v-sheet>
      <div class="facility-canvas-wrap position-relative d-flex flex-column">
        <div
          ref="host"
          class="facility-canvas position-relative overflow-hidden"
          data-testid="facility-canvas"
          @keydown.enter="finishFloorOnEnter"
        ></div>
        <div
          v-if="studio.selected && !sitePreview"
          class="facility-selection-tools"
          data-testid="selection-tools"
        >
          <strong :title="studio.selected.name">{{ studio.selected.name }}</strong>
          <div class="d-flex ga-1">
            <v-btn
              data-testid="selection-focus"
              @click="scene?.focusSelected()"
            >
              선택 보기
            </v-btn>
            <v-btn
              v-for="[value, label] in [
                ['translate', '이동'],
                ['rotate', '회전'],
                ['scale', '크기'],
              ] as const"
              :key="value"
              :class="{ active: tool === value }"
              :data-testid="`selection-${value}`"
              @click="tool = value"
            >
              {{ label }}
            </v-btn>
          </div>
          <div
            v-if="baseSize"
            class="facility-quick-size"
            role="group"
            aria-label="빠른 크기 조절"
          >
            <v-btn
              v-for="{ axis, label } in sizeFields"
              :key="axis"
              :data-testid="`quick-size-${axis}`"
              :class="{ active: quickResize?.axis === axis }"
              :aria-label="`${label} ${displaySize(quickSize(axis))} mm`"
              :title="`${label} 조절 · 좌우 드래그 또는 방향키`"
              @pointerdown.prevent="startQuickResize($event, axis)"
              @pointermove="moveQuickResize"
              @pointerup="finishQuickResize"
              @pointercancel="cancelQuickResize($event)"
              @lostpointercapture="cancelQuickResize($event)"
              @keydown="quickResizeKey($event, axis)"
            >
              <span>{{ label }}</span>
              <b>
                {{
                  displaySize(quickSize(axis)).toLocaleString('ko-KR', { maximumFractionDigits: 2 })
                }}
                mm
              </b>
            </v-btn>
          </div>
          <small v-if="baseSize">치수 버튼을 좌우로 드래그해 빠르게 조절</small>
          <small>
            {{
              tool === 'scale'
                ? '축 끝 사각형 드래그 · 중앙 사각형 전체 크기'
                : tool === 'rotate'
                  ? '회전 링 드래그'
                  : '축 화살표 또는 평면 사각형 드래그'
            }}
            · 우측 패널 정밀 입력
          </small>
        </div>
        <div
          v-if="!sitePreview && !studio.document.instances.length && !map.document.nodes.length && !floorAreas.length && !floorDraft"
          class="facility-empty position-absolute text-center"
        >
          모델 만들기 → 포트 클릭 또는 Port ID 선택 → 1개 배치
          <br />
          <small>기존 MGS 노드·포트는 2D 맵에서 편집합니다.</small>
        </div>
        <div v-if="!sitePreview" class="facility-hint position-absolute text-center">
          왼쪽 드래그: 영역 선택 · Shift + 클릭: 추가 또는 해제 · Space + 왼쪽 드래그: 화면 이동
        </div>
      </div>
      <v-sheet
        tag="aside"
        v-show="!sitePreview"
        class="facility-inspector overflow-auto"
      >
        <FloorAreaEditor
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
          <small data-testid="instance-count">{{ studio.document.instances.length }}</small>
        </h2>
        <div class="facility-instance-list overflow-auto">
          <v-btn
            v-for="instance in studio.document.instances"
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
            <v-btn
              type="button"
              data-testid="instance-duplicate"
              @click="studio.duplicate"
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
        <div v-if="studio.selected && selectedWall" ref="doorEditor">
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
    <input
      ref="glbInput"
      type="file"
      accept=".glb"
      hidden
      data-testid="glb-file"
      @change="importGlb"
    />
    <ModelCatalog
      v-model="catalogOpen"
      v-model:category="catalogCategory"
      v-model:units="glbUnits"
      :assets="catalogAssets"
      :busy="studio.busy"
      :loading="catalogLoading"
      :selected="studio.selectedAssetId"
      :error="error"
      @choose="chooseCatalogModel"
      @import="glbInput?.click()"
      @import-library="studio.importModels(reference)"
      @register-defaults="registerDefaultModels"
    />
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
.facility-measure-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #8b929b;
}
[aria-pressed='true'] .facility-measure-indicator {
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
.facility-selection-tools {
  position: absolute;
  top: 112px;
  left: 12px;
  z-index: 2;
  display: grid;
  gap: 8px;
  max-width: min(360px, calc(100% - 24px));
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}
.facility-selection-tools strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.facility-selection-tools small {
  font-size: 11px;
  color: var(--text-secondary);
}
.facility-quick-size {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}
.facility-studio .facility-quick-size button {
  min-width: 0;
  height: auto;
  padding-inline: 4px;
  cursor: ew-resize;
  touch-action: none;
  user-select: none;
}
.facility-quick-size :deep(.v-btn__content) {
  display: grid;
  gap: 2px;
  min-width: 0;
  white-space: normal;
  font-variant-numeric: tabular-nums;
}
.facility-quick-size span {
  font-size: 10px;
  color: var(--text-secondary);
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
