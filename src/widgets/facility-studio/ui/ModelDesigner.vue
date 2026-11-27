<!--
/**
 * 파일명: ModelDesigner.vue
 * 설명: 자유 부품 조합과 실시간 제작 화면 및 독립 이력을 제공하는 사용자 모델 편집기
 * 작성자: 이희원
 * 작성일자: 2026-11-04
 */
-->
<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useEditor } from '@/features/map-editor/index.ts'
import {
  designConveyor,
  designRack,
  createInteriorModel,
  interiorModels,
  emptyFacilityDocument,
  parseFacilityDocument,
  surfaceForPart,
  surfaceMaterials,
  type FacilityAsset,
  type FacilityPart,
  type InteriorModel,
  type SurfaceMaterial,
} from '@/entities/facility/index.ts'
import { createModelPreview } from '@/widgets/facility-studio/lib/ModelPreview.ts'

const props = defineProps<{ asset: FacilityAsset | null; apply: (asset: FacilityAsset) => void }>()
const emit = defineEmits<{ close: []; dirty: [value: boolean] }>()
const map = useEditor()
const dialog = ref<HTMLDialogElement>()
const host = ref<HTMLElement>()
const draft = reactive({
  name: props.asset?.name ?? '새 모델',
  catalogCategory: props.asset?.catalogCategory,
  parts: JSON.parse(JSON.stringify(props.asset?.parts ?? [])) as FacilityPart[],
})
const selectedId = ref<string | null>(draft.parts[0]?.id ?? null)
const batchIds = ref<string[]>([])
const selected = computed(() => draft.parts.find((part) => part.id === selectedId.value))
const surfaceOptions = [
  { title: '자동', value: '' },
  ...Object.entries(surfaceMaterials).map(([value, { label }]) => ({ title: label, value })),
]
const initial = JSON.stringify(draft)
const dirty = computed(() => JSON.stringify(draft) !== initial)
const error = ref('')
const mode = ref<'translate' | 'rotate' | 'scale'>('translate')
const search = ref('')
const filtered = computed(() =>
  draft.parts.filter((part) => part.name.toLowerCase().includes(search.value.toLowerCase())),
)
const array = reactive({ count: 3, x: 1000, y: 0, z: 0 })
const batch = reactive({
  mode: 'offset' as 'set' | 'offset',
  enabled: { x: true, y: false, z: false },
  values: { x: '0', y: '0', z: '0' },
})
const batchSelection = computed(() => new Set(batchIds.value))
const batchParts = computed(() => draft.parts.filter((part) => batchSelection.value.has(part.id)))
const batchResult = ref('')
const past = shallowRef<string[]>([])
const future = shallowRef<string[]>([])
let historyKey = ''
let gesture = 0
let preview: ReturnType<typeof createModelPreview> | undefined

/**
 * 부품과 선택 상태를 함께 보관하는 제작 이력 스냅샷 생성
 * @returns 현재 모델과 선택 부품의 직렬화 스냅샷
 */
const snapshot = () =>
  JSON.stringify({ ...draft, selectedId: selectedId.value, batchIds: batchIds.value })
/**
 * 연속 입력과 핸들 조작을 하나로 병합하며 변경 전 상태를 보관하는 제작 명령
 * @param action 제작 초안에 적용할 변경 함수
 * @param key 같은 입력 필드 또는 핸들 조작을 구분하는 이력 키
 */
const change = (action: () => void, key: string = crypto.randomUUID()) => {
  const previous = snapshot()
  action()
  if (snapshot() === previous) return
  if (!key || historyKey !== key) past.value = [...past.value.slice(-19), previous]
  historyKey = key
  future.value = []
  error.value = ''
}
/**
 * 복원한 모델과 선택 상태를 초안에 적용하는 제작 이력 복원
 * @param value 직렬화한 제작 이력
 */
const restore = (value: string) => {
  const state = JSON.parse(value)
  draft.name = state.name
  draft.catalogCategory = state.catalogCategory
  draft.parts = state.parts
  selectedId.value = state.selectedId
  batchIds.value = state.batchIds ?? []
  batchResult.value = ''
  historyKey = ''
  error.value = ''
}
/**
 * 직전 제작 명령을 취소하고 현재 상태를 다시 실행 목록에 보관하는 실행 취소
 */
const undo = () => {
  const previous = past.value.at(-1)
  if (!previous) return
  future.value = [...future.value, snapshot()]
  past.value = past.value.slice(0, -1)
  restore(previous)
}
/**
 * 취소한 제작 명령을 복원하는 다시 실행
 */
const redo = () => {
  const next = future.value.at(-1)
  if (!next) return
  past.value = [...past.value, snapshot()]
  future.value = future.value.slice(0, -1)
  restore(next)
}
/**
 * 선택 부품을 변경하고 입력 병합 구간을 종료하는 제작 대상 전환
 * @param id 제작 화면 또는 목록에서 선택한 부품 식별자
 */
const select = (id: string | null) => {
  selectedId.value = id
  historyKey = ''
}
/**
 * 개별 부품의 일괄 편집 체크 상태를 전환하는 대상 선택
 * @param id 체크를 변경할 부품 식별자
 */
const toggleBatch = (id: string) => {
  batchIds.value = batchIds.value.includes(id)
    ? batchIds.value.filter((value) => value !== id)
    : [...batchIds.value, id]
}
/**
 * 검색 결과에 해당하는 부품을 기존 일괄 편집 대상에 추가하는 목록 전체 선택
 */
const selectFiltered = () => {
  batchIds.value = [...new Set([...batchIds.value, ...filtered.value.map((part) => part.id)])]
}
/**
 * 현재 개별 선택한 부품을 일괄 편집 대상에 추가하는 화면 선택 연계
 */
const selectCurrent = () => {
  if (selectedId.value && !batchIds.value.includes(selectedId.value))
    batchIds.value = [...batchIds.value, selectedId.value]
}
/**
 * 체크한 부품의 지정 축 좌표를 일괄 지정하거나 동일 거리만큼 이동하는 좌표 편집
 * 모든 결과 좌표를 먼저 검증하여 일부 부품만 변경되는 상태를 방지하는 원자적 반영
 */
const applyBatchPosition = () => {
  try {
    if (!batchParts.value.length) throw new Error('일괄 편집할 부품을 체크하세요.')
    const axes = (['x', 'y', 'z'] as const).filter((axis) => batch.enabled[axis])
    if (!axes.length) throw new Error('변경할 좌표 축을 선택하세요.')
    const values = { x: 0, y: 0, z: 0 }
    for (const axis of axes) {
      const raw = String(batch.values[axis]).trim()
      const value = Number(raw)
      if (!raw || !Number.isFinite(value) || Math.abs(value) > 1e9)
        throw new Error(`${axis.toUpperCase()} 좌표는 ±1,000,000,000mm 이내의 숫자여야 합니다.`)
      values[axis] = value
    }
    const updates = batchParts.value.map((part) => {
      const position = { ...part.position }
      for (const axis of axes)
        position[axis] = batch.mode === 'set' ? values[axis] : part.position[axis] + values[axis]
      if (Object.values(position).some((value) => !Number.isFinite(value) || Math.abs(value) > 1e9))
        throw new Error(`${part.name || '이름 없는 부품'}의 결과 좌표가 허용 범위를 벗어납니다.`)
      return { part, position }
    })
    error.value = ''
    change(() => {
      for (const { part, position } of updates) part.position = position
    })
    batchResult.value = `${updates.length}개 부품의 ${axes.map((axis) => axis.toUpperCase()).join(' · ')} 좌표에 ${batch.mode === 'set' ? '값 지정' : '상대 이동'}을 적용했습니다.`
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    batchResult.value = ''
  }
}
/**
 * 새 부품을 추가하고 첫 부품인 경우 제작 화면에 맞추는 부품 생성
 * @param shape 추가할 기본 도형 종류
 */
const addPart = (shape: FacilityPart['shape']) => {
  if (draft.parts.length >= 10000) {
    error.value = '모델 부품은 10,000개 이하여야 합니다.'
    return
  }
  const first = !draft.parts.length
  const size = shape === 'box' ? { x: 1000, y: 800, z: 500 } : { x: 500, y: 500, z: 500 }
  const part: FacilityPart = {
    id: crypto.randomUUID(),
    name: `${shape === 'box' ? '박스' : '원통'} ${draft.parts.length + 1}`,
    shape,
    size,
    position: {
      x: selected.value ? selected.value.position.x + selected.value.size.x + 200 : 0,
      y: 0,
      z: size.z / 2,
    },
    rotation: 0,
    tiltX: 0,
    tiltY: 0,
    color: selected.value?.color ?? '#416e9d',
  }
  change(() => {
    draft.parts.push(part)
    selectedId.value = part.id
  })
  if (first) void nextTick(() => preview?.fit())
}
/**
 * 선택 부품을 제거하며 빈 모델을 다시 구성할 수 있도록 허용하는 부품 삭제
 */
const removePart = () => {
  if (!selected.value) return
  change(() => {
    draft.parts = draft.parts.filter((part) => part.id !== selectedId.value)
    selectedId.value = draft.parts[0]?.id ?? null
  })
}
/**
 * 선택 부품의 형상을 유지하며 지정 간격의 복사본을 생성하는 반복 배치
 * @param count 추가할 복사본 개수
 */
const duplicate = (count = 1) => {
  const part = selected.value
  if (!part) return
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100 ||
    draft.parts.length + count > 10000 ||
    [array.x, array.y, array.z].some((value) => !Number.isFinite(Number(value)))
  ) {
    error.value = '복사 개수는 1~100개이며 간격은 유효한 숫자여야 합니다.'
    return
  }
  change(() => {
    for (let index = 1; index <= count; index++) {
      const copy = JSON.parse(JSON.stringify(part)) as FacilityPart
      copy.id = crypto.randomUUID()
      copy.name = `${part.name.slice(0, 280)} 복사 ${index}`
      copy.position = {
        x: part.position.x + Number(array.x) * index,
        y: part.position.y + Number(array.y) * index,
        z: part.position.z + Number(array.z) * index,
      }
      draft.parts.push(copy)
      selectedId.value = copy.id
    }
  })
}
/**
 * 기존 설비 형상을 자유 편집 가능한 부품으로 불러오는 시작 도면 구성
 * @param kind 처음 구성할 설비 형상
 */
const starter = (kind: 'rack' | 'shelf' | 'conveyor' | InteriorModel) => {
  const design = {
    width: kind === 'conveyor' ? 3000 : 2400,
    depth: 1000,
    height: kind === 'conveyor' ? 800 : 3000,
    bays: 2,
    levels: 4,
    frame: 60,
    color: '#416e9d',
  }
  const asset =
    kind === 'conveyor'
      ? designConveyor(crypto.randomUUID(), '컨베이어', design)
      : kind === 'rack' || kind === 'shelf'
        ? designRack(crypto.randomUUID(), kind === 'rack' ? '랙' : '선반', kind, design)
        : createInteriorModel(kind)
  change(() => {
    draft.name = asset.name
    draft.catalogCategory = asset.catalogCategory
    draft.parts = asset.parts
    selectedId.value = asset.parts[0]?.id ?? null
  })
  void nextTick(() => preview?.fit())
}
/**
 * 제작 화면 핸들의 변경을 해당 부품의 속성에 반영하는 부품 패치
 * @param id 변경할 부품 식별자
 * @param patch 위치와 크기 및 회전의 변경 정보
 */
const patchPart = (id: string, patch: Partial<FacilityPart>) => {
  const part = draft.parts.find((item) => item.id === id)
  if (part) change(() => Object.assign(part, patch), `gesture:${gesture}`)
}
/**
 * 숫자 입력을 위치와 치수 또는 회전 속성에 반영하는 부품 수치 편집
 * @param group 편집할 벡터 또는 회전 속성
 * @param axis 벡터를 구성하는 축
 * @param value 입력한 숫자 문자열
 */
const numberPart = (
  group: 'position' | 'size' | 'angles',
  axis: 'x' | 'y' | 'z',
  value: unknown,
) => {
  const part = selected.value
  if (!part) return
  const number = value === '' || value === null ? Number.NaN : Number(value)
  change(() => {
    if (group === 'angles')
      part[axis === 'x' ? 'tiltX' : axis === 'y' ? 'tiltY' : 'rotation'] = number
    else part[group][axis] = number
  }, `${part.id}:${group}:${axis}`)
}
/**
 * 모델 이름과 선택 부품의 이름 및 색상을 반영하는 문자열 편집
 * @param field 현재 편집할 표시 속성
 * @param value 입력한 문자열
 */
const textValue = (field: 'model' | 'part' | 'color', value: unknown) => {
  change(() => {
    if (field === 'model') draft.name = String(value ?? '')
    else if (selected.value)
      selected.value[field === 'part' ? 'name' : 'color'] = String(value ?? '')
  }, `${selectedId.value}:${field}`)
}

/** 선택 부품의 재질을 변경하거나 기본 재질로 복원 */
const setPartSurface = (value: string) => {
  const part = selected.value
  if (!part || (value && !Object.hasOwn(surfaceMaterials, value))) return
  change(() => {
    if (value) part.surface = value as SurfaceMaterial
    else delete part.surface
  })
}

/** 선택 부품의 재질 투명도를 실시간으로 미리 보고 연속 조작을 하나의 이력으로 기록 */
const setPartTransparency = (event: Event) => {
  const part = selected.value
  if (!part) return
  const opacity = (100 - (event.target as HTMLInputElement).valueAsNumber) / 100
  change(() => {
    if (opacity === 1) delete part.opacity
    else part.opacity = opacity
  }, `${part.id}:opacity`)
}

/** 배치별 벽 투명도에 포함할 사용자 제작 부품 지정 */
const setWallPart = (value: boolean | null) => {
  const part = selected.value
  if (!part) return
  change(() => {
    if (value) part.wall = true
    else delete part.wall
  })
}
/**
 * 선택 부품의 바닥 정렬을 독립적인 제작 이력으로 적용하는 정렬 명령
 */
const groundPart = () => {
  gesture++
  historyKey = ''
  preview?.groundSelected()
}
/**
 * 공유 파일 계약 검증 후 기존 모델 또는 새 모델로 적용하는 제작 완료
 * @param copy 기존 모델을 교체하지 않고 새 식별자로 저장할지 여부
 */
const apply = (copy = false) => {
  try {
    if (!draft.name.trim()) throw new Error('모델 이름을 입력하세요.')
    const doc = emptyFacilityDocument()
    doc.assets = [
      {
        id: !copy && props.asset ? props.asset.id : crypto.randomUUID(),
        name: draft.name.trim(),
        kind: props.asset?.kind ?? 'equipment',
        catalogCategory: draft.catalogCategory,
        parts: JSON.parse(JSON.stringify(draft.parts)),
      },
    ]
    const checked = parseFacilityDocument(JSON.stringify(doc))
    props.apply(checked.assets[0]!)
    emit('dirty', false)
    emit('close')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
/**
 * 적용하지 않은 제작 변경의 폐기를 확인한 뒤 편집기를 닫는 종료 처리
 */
const close = () => {
  if (dirty.value && !window.confirm('적용하지 않은 모델 변경을 버리고 닫으시겠습니까?')) return
  emit('dirty', false)
  emit('close')
}
/**
 * 지도 단축키와 충돌하지 않도록 제작 이력과 삭제 및 저장 명령을 처리하는 키 입력
 * @param event 제작 대화상자에서 발생한 키보드 입력
 */
const keyboard = (event: KeyboardEvent) => {
  const mod = event.ctrlKey || event.metaKey
  if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault()
    apply()
    return
  }
  if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select')) return
  if (mod && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    selectFiltered()
    return
  }
  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    event.shiftKey ? redo() : undo()
  }
  if (mod && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    redo()
  }
  if (event.key === 'Delete') {
    event.preventDefault()
    removePart()
  }
}
watch(dirty, (value) => emit('dirty', value), { immediate: true })
watch(
  () => draft.parts,
  (parts) => preview?.setParts(parts),
  { deep: true },
)
watch(selectedId, (id) => preview?.setSelected(id))
watch(batchIds, (ids) => {
  preview?.setBatchSelection(ids)
  batchResult.value = ''
})
watch(
  () => draft.parts.map((part) => part.id),
  (ids) => {
    const valid = new Set(ids)
    if (batchIds.value.some((id) => !valid.has(id)))
      batchIds.value = batchIds.value.filter((id) => valid.has(id))
  },
)
watch(mode, (value) => preview?.setMode(value))
watch(
  () => map.theme,
  (theme) => preview?.setTheme(theme),
)
onMounted(() => {
  dialog.value?.showModal()
  try {
    preview = createModelPreview(host.value!, {
      select,
      change: patchPart,
      gesture: (active) => {
        if (active) gesture++
        historyKey = ''
      },
    })
    preview.setParts(draft.parts)
    preview.setSelected(selectedId.value)
    preview.setBatchSelection(batchIds.value)
    preview.setTheme(map.theme)
    preview.fit()
  } catch (cause) {
    error.value = `제작 화면 초기화 실패: ${cause instanceof Error ? cause.message : String(cause)}`
  }
})
onBeforeUnmount(() => {
  preview?.dispose()
  emit('dirty', false)
})
</script>

<template>
  <dialog
    ref="dialog"
    class="model-designer pa-0"
    aria-labelledby="model-designer-title"
    data-testid="model-designer"
    @cancel.prevent="close"
    @keydown.stop="keyboard"
    @focusout="historyKey = ''"
  >
    <header class="popup-drag-handle d-flex align-center ga-3 px-5 py-3 border-b">
      <div class="mr-auto">
        <h2
          id="model-designer-title"
          class="text-subtitle-1 font-weight-bold"
        >
          사용자 모델 디자인
        </h2>
        <p class="ma-0 text-caption">
          부품을 조합해 원하는 시설과 설비 제작 · 원점은 포트 배치 기준
        </p>
      </div>
      <v-btn
        data-testid="designer-undo"
        :disabled="!past.length"
        @click="undo"
        >실행 취소</v-btn
      >
      <v-btn
        data-testid="designer-redo"
        :disabled="!future.length"
        @click="redo"
        >다시 실행</v-btn
      >
      <v-btn
        v-if="asset"
        data-testid="model-save-copy"
        @click="apply(true)"
        >새 모델로 저장</v-btn
      >
      <v-btn
        color="primary"
        variant="flat"
        data-testid="model-apply"
        @click="apply()"
        >{{ asset ? '모델 수정 적용' : '모델 만들기' }}</v-btn
      >
      <v-btn
        data-testid="designer-close"
        @click="close"
        >닫기</v-btn
      >
    </header>
    <div class="designer-layout">
      <aside class="designer-parts pa-4 overflow-auto">
        <label class="text-caption"
          >모델 이름<v-text-field
            :model-value="draft.name"
            maxlength="300"
            data-testid="model-name"
            @update:model-value="textValue('model', $event)"
        /></label>
        <div class="d-flex ga-2 my-3">
          <v-btn
            variant="outlined"
            data-testid="part-box"
            @click="addPart('box')"
            >박스 추가</v-btn
          ><v-btn
            variant="outlined"
            data-testid="part-cylinder"
            @click="addPart('cylinder')"
            >원통 추가</v-btn
          >
        </div>
        <div
          v-if="!draft.parts.length"
          class="designer-starters pa-3 mb-3"
        >
          <strong class="text-caption">빈 모델에서 시작하거나 시작 도면 사용</strong>
          <p class="text-caption my-2">시작 도면의 모든 부품도 자유롭게 수정 가능</p>
          <div class="d-flex flex-wrap ga-1">
            <v-btn
              data-testid="starter-rack"
              @click="starter('rack')"
              >랙</v-btn
            ><v-btn
              data-testid="starter-shelf"
              @click="starter('shelf')"
              >선반</v-btn
            ><v-btn
              data-testid="starter-conveyor"
              @click="starter('conveyor')"
              >컨베이어</v-btn
            >
            <v-btn
              v-for="(label, type) in interiorModels"
              :key="type"
              :text="label"
              :data-testid="`starter-${type}`"
              @click="starter(type)"
            />
          </div>
        </div>
        <h3 class="text-subtitle-2 mb-2">
          부품 <span data-testid="designer-part-count">{{ draft.parts.length }}</span>
        </h3>
        <v-text-field
          v-model="search"
          placeholder="부품 검색"
          aria-label="제작 부품 검색"
        />
        <div class="d-flex flex-wrap ga-1 my-2">
          <v-btn
            data-testid="batch-select-all"
            :disabled="!filtered.length"
            @click="selectFiltered"
            >{{ search ? '검색 결과 선택' : '전체 선택' }}</v-btn
          >
          <v-btn
            data-testid="batch-clear"
            :disabled="!batchIds.length"
            @click="batchIds = []"
            >선택 해제</v-btn
          >
        </div>
        <p class="text-caption ma-0">
          체크한 부품은 3D 화면에서 강조됩니다. Ctrl+A로 검색 결과를 선택할 수 있습니다.
        </p>
        <div class="d-flex flex-column ga-1 mt-2">
          <div
            v-for="part in filtered"
            :key="part.id"
            class="designer-part-row d-flex align-center ga-2"
          >
            <input
              type="checkbox"
              :checked="batchSelection.has(part.id)"
              :data-batch-id="part.id"
              :aria-label="`${part.name || '이름 없는 부품'} 일괄 편집 선택`"
              @change="toggleBatch(part.id)"
            />
            <v-btn
              :data-part-id="part.id"
              class="designer-part flex-grow-1 text-start justify-start"
              :class="{ 'designer-part-selected': selectedId === part.id }"
              :aria-pressed="selectedId === part.id"
              @click="select(part.id)"
              ><span
                class="part-swatch"
                :style="{ background: part.color }"
              ></span
              ><span class="text-truncate">{{ part.name || '이름 없는 부품' }}</span></v-btn
            >
          </div>
        </div>
      </aside>
      <section class="designer-stage d-flex flex-column">
        <div class="d-flex flex-wrap align-center ga-1 px-3 py-2 border-b">
          <v-btn
            v-for="[value, label] in [
              ['translate', '이동'],
              ['rotate', '회전'],
              ['scale', '크기'],
            ] as const"
            :key="value"
            :data-testid="`part-tool-${value}`"
            :color="mode === value ? 'primary' : undefined"
            :aria-pressed="mode === value"
            @click="mode = value"
            >{{ label }}</v-btn
          >
          <v-btn
            class="ml-auto"
            data-testid="designer-fit"
            @click="preview?.fit()"
            >전체 보기</v-btn
          >
        </div>
        <div
          ref="host"
          class="designer-preview position-relative"
          data-testid="designer-preview"
        >
          <p
            v-if="!draft.parts.length"
            class="designer-empty ma-0"
          >
            박스·원통을 추가하거나 시작 도면을 선택하세요.
          </p>
        </div>
        <p class="text-caption ma-0 px-3 py-2 border-t">
          클릭: 부품 선택 · 핸들: 이동/회전/크기 · 오른쪽 드래그: 시점 회전 · Space + 왼쪽 드래그:
          이동
        </p>
      </section>
      <aside class="designer-properties pa-4 overflow-auto">
        <section
          class="batch-position pa-3 mb-4"
          aria-label="좌표 일괄 편집"
        >
          <h3 class="text-subtitle-2">
            좌표 일괄 편집 <span data-testid="batch-count">{{ batchParts.length }}</span
            >개
          </h3>
          <p class="text-caption my-2">부품 목록에서 대상을 체크하고 변경할 축만 선택하세요.</p>
          <v-btn
            class="w-100 mb-2"
            data-testid="batch-select-current"
            :disabled="!selectedId"
            @click="selectCurrent"
            >현재 부품 추가 선택</v-btn
          >
          <div class="d-flex ga-1 mb-2">
            <v-btn
              data-testid="batch-offset-mode"
              :color="batch.mode === 'offset' ? 'primary' : undefined"
              :aria-pressed="batch.mode === 'offset'"
              @click="batch.mode = 'offset'"
              >상대 이동</v-btn
            >
            <v-btn
              data-testid="batch-set-mode"
              :color="batch.mode === 'set' ? 'primary' : undefined"
              :aria-pressed="batch.mode === 'set'"
              @click="batch.mode = 'set'"
              >값 지정</v-btn
            >
          </div>
          <p class="text-caption my-2">
            {{
              batch.mode === 'offset'
                ? '현재 좌표에서 입력한 거리만큼 이동하며 부품 간 간격을 유지합니다.'
                : '선택한 축을 입력한 동일 좌표로 맞춥니다. 나머지 축은 유지합니다.'
            }}
          </p>
          <div class="designer-numbers">
            <label
              v-for="axis in ['x', 'y', 'z'] as const"
              :key="axis"
              class="text-caption"
            >
              <span class="d-flex align-center ga-1"
                ><input
                  v-model="batch.enabled[axis]"
                  type="checkbox"
                  :data-testid="`batch-axis-${axis}`"
                  :aria-label="`${axis.toUpperCase()} 축 변경`"
                />{{ axis.toUpperCase() }} mm</span
              >
              <v-text-field
                v-model="batch.values[axis]"
                type="number"
                :disabled="!batch.enabled[axis]"
                :data-testid="`batch-value-${axis}`"
              />
            </label>
          </div>
          <v-btn
            class="w-100 mt-3"
            variant="outlined"
            data-testid="batch-position-apply"
            :disabled="!batchParts.length || !Object.values(batch.enabled).some(Boolean)"
            @click="applyBatchPosition"
            >선택 부품에 좌표 적용</v-btn
          >
          <p
            v-if="batchResult"
            class="text-caption mt-2 mb-0"
            role="status"
            data-testid="batch-result"
          >
            {{ batchResult }}
          </p>
        </section>

        <template v-if="selected">
          <h3 class="text-subtitle-2 mb-3">개별 부품 편집</h3>
          <label class="text-caption"
            >부품 이름<v-text-field
              :model-value="selected.name"
              maxlength="300"
              data-testid="part-name"
              @update:model-value="textValue('part', $event)"
          /></label>
          <div
            v-for="[group, label] in [
              ['position', '위치 mm'],
              ['size', '치수 mm'],
              ['angles', '회전 °'],
            ] as const"
            :key="group"
            class="my-3"
          >
            <strong class="text-caption">{{ label }}</strong>
            <div class="designer-numbers mt-1">
              <label
                v-for="axis in ['x', 'y', 'z'] as const"
                :key="axis"
                class="text-caption"
                >{{ axis.toUpperCase()
                }}<v-text-field
                  :model-value="
                    group === 'angles'
                      ? (selected[axis === 'x' ? 'tiltX' : axis === 'y' ? 'tiltY' : 'rotation'] ??
                        0)
                      : selected[group][axis]
                  "
                  type="number"
                  :min="group === 'size' ? 1 : undefined"
                  :max="group === 'size' ? 100000 : undefined"
                  :data-testid="`part-${group}-${axis}`"
                  @update:model-value="numberPart(group, axis, $event)"
              /></label>
            </div>
          </div>
          <label class="d-flex align-center justify-space-between text-caption my-3"
            >부품 색상<input
              type="color"
              :value="selected.color"
              data-testid="part-color"
              @input="textValue('color', ($event.target as HTMLInputElement).value)"
          /></label>
          <v-select
            label="부품 재질"
            :model-value="selected.surface ?? ''"
            :items="surfaceOptions"
            :menu-props="{ attach: dialog }"
            :hint="selected.surface ? undefined : surfaceMaterials[surfaceForPart(selected)].label"
            persistent-hint
            data-testid="part-surface"
            @update:model-value="setPartSurface"
          />
          <label class="d-flex flex-column text-caption ga-1">
            부품 투명도 {{ Math.round(100 * (1 - (selected.opacity ?? 1))) }}%
            <input
              type="range"
              min="0"
              max="100"
              data-testid="part-transparency"
              :value="Math.round(100 * (1 - (selected.opacity ?? 1)))"
              @input="setPartTransparency"
              @change="historyKey = ''"
            />
          </label>
          <v-checkbox
            label="벽체 부품"
            :model-value="selected.wall === true"
            hide-details
            density="compact"
            @update:model-value="setWallPart"
          />
          <v-btn
            class="w-100 mb-2"
            variant="outlined"
            data-testid="part-ground"
            @click="groundPart"
            >바닥에 맞춤</v-btn
          >
          <div class="d-flex ga-2 mb-4">
            <v-btn
              data-testid="part-duplicate"
              @click="duplicate()"
              >부품 복제</v-btn
            ><v-btn
              color="error"
              data-testid="part-remove"
              @click="removePart"
              >부품 삭제</v-btn
            >
          </div>
          <h3 class="text-subtitle-2">반복 배치</h3>
          <p class="text-caption my-2">선택 부품에서 지정 간격으로 복사본 추가</p>
          <label class="text-caption"
            >추가 개수<v-text-field
              v-model.number="array.count"
              type="number"
              min="1"
              max="100"
              data-testid="part-array-count"
          /></label>
          <div class="designer-numbers mt-2">
            <label
              v-for="axis in ['x', 'y', 'z'] as const"
              :key="axis"
              class="text-caption"
              >{{ axis.toUpperCase() }} 간격 mm<v-text-field
                v-model.number="array[axis]"
                type="number"
                :data-testid="`part-array-${axis}`"
            /></label>
          </div>
          <v-btn
            class="w-100 mt-3"
            variant="outlined"
            data-testid="part-array"
            @click="duplicate(Number(array.count))"
            >반복 배치 적용</v-btn
          >
        </template>
        <p
          v-else
          class="text-caption"
        >
          목록이나 3D 화면에서 부품을 선택하면 이름·위치·치수·회전·색상을 편집할 수 있습니다.
        </p>
      </aside>
    </div>
    <footer
      class="px-4 py-2 border-t text-caption"
      :class="{ 'designer-error': error }"
      role="status"
      data-testid="designer-status"
    >
      {{
        error ||
        (dirty
          ? '적용하지 않은 변경이 있습니다. 모델 만들기 또는 모델 수정 적용으로 라이브러리에 반영하세요.'
          : '모델 원점은 X 0 · Y 0 · 바닥 Z 0이며 좌표와 치수의 단위는 mm입니다.')
      }}
    </footer>
  </dialog>
</template>

<style scoped lang="scss">
/** 좁은 패널에서도 문장 단위의 줄바꿈과 상단 실행 버튼 폭 유지 */
.model-designer p,
.model-designer small {
  word-break: keep-all;
  overflow-wrap: anywhere;
}
.model-designer header > div { min-width: 0; }
.model-designer header > .v-btn { flex-shrink: 0; }

.model-designer {
  width: min(1480px, calc(100vw - 40px));
  height: min(920px, calc(100vh - 40px));
  max-width: none;
  max-height: none;
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--text);
  background: var(--surface);
  overflow: hidden;
  &[open] {
    display: flex;
    flex-direction: column;
  }
  &::backdrop {
    background: #081923a6;
  }
  header p {
    color: var(--text-secondary);
  }
  footer {
    min-height: 36px;
  }
}
.designer-layout {
  display: grid;
  grid-template-columns: 240px minmax(260px, 1fr) 300px;
  flex: 1;
  min-height: 0;
}
.designer-parts {
  border-right: 1px solid var(--border);
}
.designer-properties {
  border-left: 1px solid var(--border);
}
.designer-stage {
  min-width: 0;
  min-height: 0;
}
.designer-preview {
  flex: 1;
  min-height: 0;
  :deep(canvas) {
    display: block;
  }
}
.designer-empty {
  position: absolute;
  top: 45%;
  left: 0;
  right: 0;
  text-align: center;
  pointer-events: none;
  color: var(--text-secondary);
}
.batch-position {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-muted);
}
.designer-part-row {
  min-width: 0;
}
input[type='checkbox'] {
  width: 14px;
  height: 14px;
  accent-color: var(--accent);
  flex-shrink: 0;
}
.designer-part {
  max-width: 100%;
  min-width: 0;
  .text-truncate {
    min-width: 0;
  }
}
.designer-part-selected,
.designer-starters {
  background: var(--accent-soft);
}
.designer-numbers {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  :deep(.v-field__input) {
    padding-inline: 5px;
  }
}
.part-swatch {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border: 1px solid var(--border);
  border-radius: 2px;
}
input[type='color'] {
  width: 72px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.designer-error {
  color: rgb(var(--v-theme-error));
}
@media (max-width: 1100px) {
  .designer-layout {
    grid-template-columns: 190px minmax(220px, 1fr) 250px;
  }
  .model-designer {
    width: calc(100vw - 16px);
    height: calc(100vh - 16px);
  }
}
</style>
