<!--
/**
 * 파일명: FacilityStudio.vue
 * 설명: 설비 모델 제작과 포트 배치 및 실행 데이터 추출을 제공하는 설비 편집 화면
 * 작성자: 이희원
 * 작성일자: 2026-10-21
 */
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useFacilityEditor } from '@/features/facility-editor/index.ts'
import { useEditor } from '@/features/map-editor/index.ts'
import { mapGeometryKey, resolveFacilityInstance } from '@/entities/facility/index.ts'
import type { FacilityAsset } from '@/entities/facility/index.ts'
import { createFacilityScene } from '@/widgets/facility-studio/lib/FacilityScene.ts'
import { DEFAULT_LAYERS, type Layers } from '@/entities/map/index.ts'
import ModelDesigner from '@/widgets/facility-studio/ui/ModelDesigner.vue'
const emit = defineEmits<{ draftDirty: [value: boolean] }>()
const props = defineProps<{
  layers?: Layers
}>()
const placementPort = ref('')
const studio = useFacilityEditor(),
  map = useEditor()
const host = ref<HTMLElement>()
const tool = ref<'select' | 'place' | 'port' | 'translate' | 'rotate'>('select')
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
const pose = reactive({ name: '', x: 0, y: 0, z: 0, rotation: 0, portId: '', nodeId: '' })
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
onMounted(() => {
  try {
    scene = createFacilityScene(host.value!, {
      select: (id) => {
        studio.selectedId = id
      },
      place: (x, y) => attempt(() => studio.place(x, y)),
      placeAtPort,
      move: (id, position, rotation) => attempt(() => updatePose(id, { position, rotation })),
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
        data-testid="scene-open"
        :disabled="studio.busy"
        @click="studio.open"
      >
        설계 프로젝트 열기
      </v-btn>
      <v-btn
        data-testid="scene-save"
        :disabled="studio.busy || mismatch || !studio.document.assets.length"
        @click="studio.save"
      >
        설계 프로젝트 저장{{ studio.dirty ? ' *' : '' }}
      </v-btn>
      <v-btn
        data-testid="scene-export"
        :disabled="studio.busy || mismatch || !studio.document.assets.length"
        @click="studio.exportRuntime(map.document.ports)"
      >
        3D 데이터 추출
      </v-btn>
      <v-btn
        data-testid="scene-undo"
        :disabled="!studio.past.length"
        @click="studio.undo"
      >
        실행 취소</v-btn
      ><v-btn
        data-testid="scene-redo"
        :disabled="!studio.future.length"
        @click="studio.redo"
      >
        다시 실행
      </v-btn>
    </div>
    <div
      v-if="mismatch"
      class="facility-warning py-2 px-4"
    >
      기준 맵의 노드 좌표가 다릅니다. 배치를 확인하고 현재 맵에 연결해야 저장할 수 있습니다.
      <v-btn @click="bind">현재 2D 맵 연결</v-btn>
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
          class="facility-primary w-100 mb-3"
          data-testid="new-model"
          :disabled="studio.busy"
          @click="openDesigner()"
          >새 모델 디자인</v-btn
        >
        <v-btn
          class="w-100 mb-3"
          data-testid="model-edit"
          :disabled="!studio.asset || studio.busy"
          @click="openDesigner(studio.asset ?? null)"
          >선택 모델 편집</v-btn
        >
        <v-btn
          :disabled="studio.busy"
          @click="studio.importModels(reference)"
        >
          설비 모델 파일 가져오기
        </v-btn>
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
          ><small>사용자 모델 · 부품 {{ asset.parts.length }}</small>
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
            ] as const"
            :key="value"
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
            @click="studio.selectedId = instance.id"
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
          시설을 클릭하면 위치·높이·회전과 노드/포트 연결을 편집할 수 있습니다.
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
  color: #698391;
}
.facility-studio button {
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 7px 10px;
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.facility-studio button:hover:enabled {
  border-color: #218a82;
  background: var(--surface-muted);
  color: var(--accent);
}
.facility-studio button.active {
  border-color: #218a82;
  background: var(--surface-muted);
  color: var(--accent);
}
.facility-studio button:disabled {
  opacity: 0.4;
  cursor: default;
}
.facility-studio .facility-primary {
  background: #176c65;
  color: white;
  border-color: #176c65;
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
  color: #78909c;
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
  border-radius: 4px;
  padding: 7px;
  background: var(--surface);
  color: var(--text);
}
.facility-form select {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
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
  color: #6e8794;
  margin: 0;
}
.facility-form p {
  font-size: 11px;
  line-height: 1.65;
  color: #6e8794;
  margin: 0;
}
.facility-muted {
  font-size: 11px;
  line-height: 1.65;
  color: #6e8794;
}
.facility-row {
  display: grid !important;
  gap: 3px;
  margin-bottom: 6px;
}
.facility-row small {
  font-size: 10px;
  color: #78909c;
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
.facility-status.error {
  background: var(--surface-muted);
  color: #9a5500;
}
.facility-warning {
  background: var(--surface-muted);
  color: #9a5500;
}
.facility-warning {
  font-size: 12px;
}
.facility-instance-list {
  max-height: 30%;
  margin-bottom: 18px;
}
@media (max-width: 1250px) {
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
