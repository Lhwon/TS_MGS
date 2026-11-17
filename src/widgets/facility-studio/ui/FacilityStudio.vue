<!--
/**
 * 파일명: FacilityStudio.vue
 * 설명: 설비 모델 제작과 포트 배치 및 실행 데이터 추출을 제공하는 설비 편집 화면
 * 작성자: 이희원
 * 작성일자: 2026-11-04
 */
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useFacilityEditor } from '@/features/facility-editor/index.ts'
import { useEditor } from '@/features/map-editor/index.ts'
import {
  mapGeometryKey,
  resolveFacilityInstance,
  MAX_GLB_BYTES,
  loadCeramCatalog,
} from '@/entities/facility/index.ts'
import type { FacilityAsset } from '@/entities/facility/index.ts'
import { createFacilityScene } from '@/widgets/facility-studio/lib/FacilityScene.ts'
import { DEFAULT_LAYERS, type Layers } from '@/entities/map/index.ts'
import { GlbModelCache } from '@bem/map3d/glb'
import ModelDesigner from '@/widgets/facility-studio/ui/ModelDesigner.vue'

const emit = defineEmits<{ draftDirty: [value: boolean] }>()

const props = defineProps<{
  layers?: Layers
}>()

const placementPort = ref('')
const glbInput = ref<HTMLInputElement>()
const glbUnits = ref<'m' | 'mm'>('m')
const studio = useFacilityEditor(),
  map = useEditor()

const host = ref<HTMLElement>()

const selectedModel = computed(() =>
  studio.document.assets.find((asset) => asset.id === studio.selected?.assetId),
)

const tool = ref<'select' | 'place' | 'port' | 'translate' | 'rotate' | 'scale'>('select')

/** 배치 모델의 선택과 즉시 사용 가능한 이동 핸들 활성화 */
const selectInstance = (id: string | null) => {
  studio.selectedId = id
  if (id && tool.value !== 'rotate' && tool.value !== 'scale') tool.value = 'translate'
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
  sx: 1,
  sy: 1,
  sz: 1,
  portId: '',
  nodeId: '',
})

let scene: ReturnType<typeof createFacilityScene> | undefined

/**
 * 편집 명령의 예외를 화면 상태로 변환하고 정상 처리 시 이전 오류를 해제하는 작업 실행
 *
 * @param action 검증 범위 안에서 실행할 편집 명령
 */
const attempt = (action: () => void) => {
  try {
    action()
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
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
  () => [studio.selected, map.document] as const,
  ([instance]) => {
    if (instance)
      attempt(() =>
        Object.assign(pose, {
          name: instance.name,
          ...resolveFacilityInstance(instance, map.document.ports).position,
          rotation: instance.rotation,
          carrierRotation: instance.carrierRotation ?? '',
          sx: instance.scale?.x ?? 1,
          sy: instance.scale?.y ?? 1,
          sz: instance.scale?.z ?? 1,
          portId: instance.portId ?? '',
          nodeId: instance.nodeId === undefined ? '' : String(instance.nodeId),
        }),
      )
  },
  { immediate: true },
)

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
      scale: { x: Number(pose.sx), y: Number(pose.sy), z: Number(pose.sz) },
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

/** 현장 도면 항목을 바탕으로 제작한 재사용 설비 라이브러리 등록 */
const importCeram = async () => {
  studio.busy = true
  try {
    const catalog = await loadCeramCatalog()
    studio.addAssets(catalog.assets, reference.value, [
      'ceram-mp5-storage-rack',
      'ceram-mp5-centering-station',
      'ceram-mp5-double-deck-conveyor',
    ])
    error.value = ''
    studio.message =
      'Ceram MP5 모델을 추가하고 보관랙과 센터 정렬 설비 및 컨베이어를 갱신했습니다. 기존 배치 위치와 배율은 유지됩니다.'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    studio.busy = false
  }
}

onMounted(() => {
  try {
    scene = createFacilityScene(host.value!, {
      error: (message) => {
        error.value = message
      },
      select: selectInstance,
      place: (x, y) =>
        attempt(() => {
          studio.place(x, y)
          tool.value = 'translate'
        }),
      placeAtPort,
      move: (id, position, rotation, scale) =>
        attempt(() => updatePose(id, { position, rotation, scale })),
    })
    scene.setMap(map.document, map.theme, props.layers ?? DEFAULT_LAYERS)
    scene.setDocument(studio.document)
    scene.setSelected(studio.selectedId)
    scene.setTool(tool.value)
    scene.fit()
  } catch (e) {
    error.value = `3D 초기화 실패: ${e instanceof Error ? e.message : String(e)}`
  }
})

watch(
  () => studio.document,
  (doc) => attempt(() => scene?.setDocument(doc)),
)

watch(
  () => studio.selectedId,
  (id) => {
    try {
      scene?.setSelected(id)
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
    error.value = ''
    placementPort.value = ''
    designerOpen.value = false
    editingAsset.value = null
    tool.value = 'select'
    scene?.setMap(map.document, map.theme, props.layers ?? DEFAULT_LAYERS)
    scene?.setDocument(studio.document)
    scene?.fit()
  },
  { flush: 'post' },
)

watch(tool, (value) => scene?.setTool(value))
onBeforeUnmount(() => scene?.dispose())
</script>

<template>
  <section
    class="facility-studio d-flex flex-column"
    aria-label="3D 시설 설계"
  >
    <div class="facility-toolbar d-flex flex-wrap align-center ga-2">
      <div>
        <strong>3D 시설·설비 설계</strong><span>기준 2D 맵: {{ map.sourceName }}</span>
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
        :disabled="studio.busy || mismatch || !studio.document.assets.length"
        @click="studio.save(map.projectToken)"
      />
      <v-btn
        text="3D 데이터 추출"
        data-testid="scene-export"
        :disabled="studio.busy || mismatch || !studio.document.assets.length"
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
    <div class="facility-layout">
      <v-sheet
        tag="aside"
        class="facility-library overflow-auto"
      >
        <h2>사용자 모델</h2>
        <p class="text-caption">
          부품을 직접 조합해 시설과 설비를 디자인하고 포트에 배치할 수 있습니다.
        </p>

        <v-btn
          text="새 모델 디자인"
          class="facility-primary w-100 mb-3"
          data-testid="new-model"
          :disabled="studio.busy"
          @click="openDesigner()"
        />
        <v-btn
          text="선택 모델 편집"
          class="w-100 mb-3"
          data-testid="model-edit"
          :disabled="!studio.asset || !!studio.asset.glb || studio.busy"
          @click="openDesigner(studio.asset ?? null)"
        />
        <v-btn
          text="설비 모델 파일 가져오기"
          :disabled="studio.busy"
          @click="studio.importModels(reference)"
        />
        <input
          ref="glbInput"
          type="file"
          accept=".glb"
          hidden
          data-testid="glb-file"
          @change="importGlb"
        />
        <label class="d-block mt-3">
          GLB 원본 단위
          <select
            v-model="glbUnits"
            data-testid="glb-units"
          >
            <option value="m">m 표준 GLB</option>
            <option value="mm">mm</option>
          </select>
        </label>
        <v-btn
          text="GLB 모델 가져오기"
          class="w-100 mt-2"
          :disabled="studio.busy"
          data-testid="glb-import"
          @click="glbInput?.click()"
        />
        <v-btn
          text="Ceram MP5 모델 가져오기"
          class="w-100 mt-2"
          :disabled="studio.busy"
          data-testid="ceram-catalog"
          @click="importCeram"
        />
        <small class="d-block mt-2">
          도면 항목 기반 개략 모델입니다. 실측 치수를 확인한 후 배율을 조절하세요. 보관랙 치수는
          도면 표기를 반영했습니다.</small
        >
        <h2>
          모델 라이브러리 <small>{{ studio.document.assets.length }}</small>
        </h2>
        <v-btn
          v-for="asset in studio.document.assets"
          :key="asset.id"
          class="facility-row w-100 text-start"
          :class="{ active: studio.selectedAssetId === asset.id }"
          @click="studio.selectedAssetId = asset.id"
        >
          <strong>{{ asset.name }}</strong
          ><small>{{ asset.glb ? 'GLB 모델' : `사용자 모델 · 부품 ${asset.parts.length}` }}</small>
        </v-btn>
      </v-sheet>
      <div class="facility-canvas-wrap position-relative d-flex flex-column">
        <div class="facility-view-tools d-flex flex-wrap">
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
            :disabled="(value === 'place' || value === 'port') && !studio.asset"
            :class="{ active: tool === value }"
            @click="tool = value"
          >
            {{ label }}</v-btn
          ><v-btn
            data-testid="place-center"
            :disabled="!studio.asset"
            @click="placeCenter"
          >
            중앙 배치</v-btn
          ><v-btn
            data-testid="scene-fit"
            @click="scene?.fit()"
          >
            전체 보기
          </v-btn>
        </div>
        <div class="facility-view-tools d-flex flex-wrap">
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
            </option></select
          ><v-btn
            data-testid="place-port"
            :disabled="!studio.asset || !placementPort"
            @click="placeAtPort(placementPort)"
          >
            선택 포트에 1개 배치
          </v-btn>
        </div>
        <div
          ref="host"
          class="facility-canvas position-relative overflow-hidden"
          data-testid="facility-canvas"
        ></div>
        <div
          v-if="studio.selected"
          class="facility-selection-tools"
          data-testid="selection-tools"
        >
          <strong :title="studio.selected.name">{{ studio.selected.name }}</strong>
          <div class="d-flex ga-1">
            <v-btn
              data-testid="selection-focus"
              @click="scene?.focusSelected()"
              >선택 보기</v-btn
            >
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
              >{{ label }}</v-btn
            >
          </div>
          <small
            >{{
              tool === 'scale'
                ? '축 끝 사각형 드래그 · 중앙 사각형 전체 크기'
                : tool === 'rotate'
                  ? '회전 링 드래그'
                  : '축 화살표 또는 평면 사각형 드래그'
            }}
            · 우측 패널 정밀 입력</small
          >
        </div>
        <div
          v-if="!studio.document.instances.length && !map.document.nodes.length"
          class="facility-empty position-absolute text-center"
        >
          모델 만들기 → 포트 클릭 또는 Port ID 선택 → 1개 배치<br /><small
            >기존 MGS 노드·포트는 2D 맵에서 편집합니다.</small
          >
        </div>
        <div class="facility-hint position-absolute text-center">
          오른쪽 드래그: 시점 회전 · Space + 왼쪽 드래그: 화면 이동 · 휠: 확대 · 이동 10mm / 회전
          15° 스냅
        </div>
      </div>
      <v-sheet
        tag="aside"
        class="facility-inspector overflow-auto"
      >
        <h2>
          배치 목록
          <small data-testid="instance-count">{{ studio.document.instances.length }}</small>
        </h2>
        <div class="facility-instance-list overflow-auto">
          <v-btn
            v-for="instance in studio.document.instances"
            :key="instance.id"
            class="facility-row w-100 text-start"
            :class="{ active: studio.selectedId === instance.id }"
            @click="selectInstance(instance.id)"
          >
            <strong>{{ instance.name }}</strong
            ><small
              >{{ instance.position.x }}, {{ instance.position.y }},
              {{ instance.position.z }} mm</small
            >
          </v-btn>
        </div>
        <form
          v-if="studio.selected"
          class="facility-form"
          @submit.prevent="applyPose"
        >
          <h2>선택 시설</h2>
          <label
            >이름<v-text-field
              v-model="pose.name"
              maxlength="300"
              required
          /></label>
          <div class="facility-fields">
            <label
              v-for="axis in ['x', 'y', 'z'] as const"
              :key="axis"
              >{{ axis.toUpperCase() }} mm<v-text-field
                v-model.number="pose[axis]"
                type="number"
                required
                :data-testid="`instance-${axis}`"
            /></label>
          </div>
          <label
            >회전 °<v-text-field
              v-model.number="pose.rotation"
              type="number"
              required
          /></label>
          <div class="facility-fields">
            <label
              v-for="axis in ['sx', 'sy', 'sz'] as const"
              :key="axis"
              >크기 배율 {{ axis.slice(1).toUpperCase() }}
              <v-text-field
                v-model.number="pose[axis]"
                type="number"
                min="0.001"
                max="1000"
                step="any"
                required
                :data-testid="`instance-${axis}`"
              />
            </label>
          </div>
          <small v-if="selectedModel?.glb"
            >기본 크기 {{ selectedModel.glb.size.x }} × {{ selectedModel.glb.size.y }} ×
            {{ selectedModel.glb.size.z }} mm · X 가로 · Y 깊이 · Z 높이</small
          >
          <label
            >연결 Node ID<v-text-field
              v-model="pose.nodeId"
              type="number"
              min="0" /></label
          ><v-btn
            type="button"
            @click="align('node')"
          >
            노드 위치로 맞춤
          </v-btn>
          <label
            >연결 Port ID<v-text-field
              v-model="pose.portId"
              list="facility-ports" /><datalist id="facility-ports">
              <option
                v-for="p in map.document.ports"
                :key="p.id"
                :value="p.id"
              /></datalist></label
          ><v-btn
            type="button"
            @click="align('port')"
          >
            포트 중심으로 연결
          </v-btn>
          <label
            >포트 캐리어 회전 °<v-text-field
              v-model="pose.carrierRotation"
              type="number"
              step="90"
              clearable
              :disabled="!pose.portId"
              placeholder="자동"
              data-testid="instance-carrier-rotation"
              @click:clear="pose.carrierRotation = ''"
          /></label>
          <small>빈 값은 설비 방향 사용 · 포트 대기 자세만 적용 · 운반 중에는 포크 방향 유지</small>
          <small v-if="studio.selected.portOffset"
            >포트 기준 오프셋: {{ studio.selected.portOffset.x }},
            {{ studio.selected.portOffset.y }}, {{ studio.selected.portOffset.z }} mm</small
          >
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
              복제</v-btn
            ><v-btn
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
          시설을 클릭하면 이동 핸들이 표시됩니다. 크기 도구에서 마우스로 배율을 조절하고 우측에서
          수치를 정밀하게 입력할 수 있습니다.
        </p>
      </v-sheet>
    </div>
    <div
      class="facility-status py-2 px-4"
      :class="{ error: !!error }"
      role="status"
    >
      {{ error || studio.message }}
    </div>
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
  grid-template-columns: 268px minmax(300px, 1fr) 270px;
  flex: 1;
  min-height: 0;
}
.facility-library {
  background: var(--surface);
  padding: 16px;
}
.facility-inspector {
  background: var(--surface);
  padding: 16px;
}
.facility-library {
  border-right: 1px solid var(--border);
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
  display: grid !important;
  gap: 3px;
  margin-bottom: 6px;
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
.facility-view-tools {
  gap: 5px;
  padding: 9px;
  background: var(--surface);
}
.facility-view-tools button {
  background: var(--surface);
  color: var(--text-secondary);
  border-color: var(--border);
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
    grid-template-columns: 235px minmax(250px, 1fr) 235px;
  }
  .facility-library {
    padding: 12px;
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
// 라이브러리 항목의 모델 이름과 부품 수를 구분하는 세로 배치
.facility-row {
  height: auto;
  min-height: 50px;
  :deep(.v-btn__content) {
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
  }
}
</style>
