<!--
 * 파일명: DrawingTools.vue
 * 설명: 도면 분석 설정과 인식 객체 수정 및 경로 검토 결과 패널
 * 작성자: 이희원
 * 작성일자: 2026-11-16
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DrawingObject, MapDocument } from '@/entities/map/index.ts'
import { drawingObjectBounds, type DrawingFinding } from '@/features/drawing-import/index.ts'
const props = defineProps<{ map: MapDocument; findings: DrawingFinding[]; disabled: boolean }>()
const settings = defineModel<{
  recognize: boolean
  curves: boolean
  tiles: number
  radius: number
  vehicleWidth: number
  clearance: number
}>({ required: true })
const emit = defineEmits<{
  patch: [id: string, patch: Partial<DrawingObject>]
  recognize: []
  round: []
  verify: []
  focus: [point: { x: number; y: number }]
}>()
const filter = ref('')
const selectedId = ref('')
const selected = computed(() =>
  props.map.drawing?.objects?.find((object) => object.id === selectedId.value),
)
const rows = computed(() =>
  (props.map.drawing?.objects ?? []).filter((object) =>
    `${object.id} ${object.label} ${object.kind} ${object.status}`
      .toLowerCase()
      .includes(filter.value.toLowerCase()),
  ),
)
const draft = ref({
  label: '',
  portId: '',
  kind: 'equipment' as DrawingObject['kind'],
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  rotation: 0,
  heightMm: 1800,
  status: 'review' as DrawingObject['status'],
})
watch(selected, (object) => {
  if (!object) return
  const bounds = drawingObjectBounds(props.map, object)
  draft.value = {
    label: object.label,
    portId: object.portId ?? '',
    kind: object.kind,
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    rotation: object.rotation,
    heightMm: object.heightMm ?? (object.kind === 'conveyor' ? 700 : 1800),
    status: object.status,
  }
})
/** 지도 단위의 수정값을 원본 픽셀 좌표로 환산하는 인식 객체 적용 */
const apply = () => {
  if (!selected.value || !props.map.drawing) return
  const scale = props.map.drawing.scaleMmPerPixel ?? props.map.drawing.workingScale ?? 1
  const value = draft.value
  const frame = props.map.drawing.frame,
    angle = (-(frame?.rotation ?? 0) * Math.PI) / 180,
    dx = value.x - (frame?.x ?? 0),
    dy = value.y - (frame?.y ?? 0)
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle),
    localY = dx * Math.sin(angle) + dy * Math.cos(angle)
  emit('patch', selected.value.id, {
    label: value.label,
    portId: value.portId || undefined,
    kind: value.kind,
    x: (localX - value.width / 2) / scale,
    y: props.map.drawing.height - (localY + value.height / 2) / scale,
    width: value.width / scale,
    height: value.height / scale,
    rotation: value.rotation,
    heightMm: value.heightMm,
    status: value.status,
  })
}
/** 인식 객체의 연결 포트와 외형을 확인하는 지도 위치 이동 */
const focus = () => {
  if (selected.value) emit('focus', drawingObjectBounds(props.map, selected.value))
}
/** 검토 항목과 단위를 포함한 독립 보고서를 저장하는 로컬 추출 */
const exportReport = () => {
  const data = {
    map: props.map.name,
    units: props.map.units,
    generatedAt: new Date().toISOString(),
    settings: settings.value,
    objects: props.map.drawing?.objects ?? [],
    findings: props.findings,
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${props.map.name}.drawing-report.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>
<template>
  <details
    class="drawing-tools"
    data-testid="drawing-tools"
  >
    <summary class="d-flex align-center justify-space-between">
      <span>도면 분석 · 객체 검토</span>
      <span class="text-caption">
        {{ map.drawing?.objects?.length ?? 0 }} 객체 · {{ findings.length }} 항목
      </span>
    </summary>
    <div class="tools-body pa-3">
      <div class="d-flex flex-wrap ga-3 mb-3">
        <label>
          <input
            v-model="settings.recognize"
            type="checkbox"
            :disabled="disabled"
          />
          설비·포트·문자 인식
        </label>
        <label>
          <input
            v-model="settings.curves"
            type="checkbox"
            :disabled="disabled"
          />
          모서리 자동 곡선
        </label>
      </div>
      <div class="options-grid">
        <label>
          분석 정밀도
          <select
            v-model.number="settings.tiles"
            :disabled="disabled"
          >
            <option :value="4">빠르게 · 4구역</option>
            <option :value="12">표준 · 12구역</option>
            <option :value="32">상세 · 32구역</option>
          </select>
        </label>
        <label>
          요청 곡선 반경 mm
          <input
            v-model.number="settings.radius"
            type="number"
            min="0"
            max="1000000"
            :disabled="disabled"
          />
        </label>
        <label>
          차량 폭 mm
          <input
            v-model.number="settings.vehicleWidth"
            type="number"
            min="1"
            max="1000000"
            :disabled="disabled"
          />
        </label>
        <label>
          한쪽 여유 mm
          <input
            v-model.number="settings.clearance"
            type="number"
            min="0"
            max="1000000"
            :disabled="disabled"
          />
        </label>
      </div>
      <p class="text-caption my-2">
        반경 0은 자동 맞춤 · 실제 높이가 없는 설비는 임시 높이로 생성 · 분석 중에도 맵 조작 가능
      </p>
      <div
        v-if="map.drawing"
        class="d-flex flex-wrap ga-1 mb-3"
      >
        <v-btn
          :disabled="disabled"
          @click="emit('recognize')"
        >
          재인식
        </v-btn>
        <v-btn
          :disabled="disabled"
          @click="emit('round')"
        >
          곡선 생성
        </v-btn>
        <v-btn
          :disabled="disabled"
          @click="emit('verify')"
        >
          통로 검사
        </v-btn>
        <v-btn
          :disabled="disabled"
          @click="exportReport"
        >
          보고서 저장
        </v-btn>
      </div>
      <template v-if="map.drawing?.objects?.length">
        <input
          v-model="filter"
          aria-label="인식 객체 검색"
          placeholder="객체 ID · 이름 · 종류 검색"
          class="mb-2"
        />
        <div
          class="object-list"
          data-testid="recognized-objects"
        >
          <button
            v-for="object in rows"
            :key="object.id"
            :class="{ active: object.id === selectedId, rejected: object.status === 'rejected' }"
            :aria-pressed="object.id === selectedId"
            @click="selectedId = object.id"
          >
            <span>
              <b>{{ object.id }}</b>
              {{ object.label || object.kind }}
            </span>
            <small>
              {{ Math.round(object.confidence * 100) }}% ·
              {{
                object.status === 'review'
                  ? '검토 필요'
                  : object.status === 'rejected'
                    ? '제외'
                    : '반영'
              }}
            </small>
          </button>
        </div>
        <form
          v-if="selected"
          class="mt-3"
          @submit.prevent="apply"
        >
          <label>
            표시 이름
            <input
              v-model="draft.label"
              maxlength="200"
            />
          </label>
          <label class="mt-2">
            연결 포트 ID
            <select v-model="draft.portId">
              <option value="">자동 연결</option>
              <option
                v-for="port in map.ports"
                :key="port.id"
                :value="port.id"
              >
                {{ port.id }} · {{ port.name }}
              </option>
            </select>
          </label>
          <div class="options-grid mt-2">
            <label>
              종류
              <select v-model="draft.kind">
                <option value="rack">랙</option>
                <option value="shelf">선반</option>
                <option value="conveyor">컨베이어</option>
                <option value="equipment">설비</option>
                <option value="port">포트</option>
                <option value="obstacle">장애물</option>
                <option value="text">문자</option>
              </select>
            </label>
            <label>
              검토 상태
              <select v-model="draft.status">
                <option value="accepted">반영</option>
                <option value="review">검토 필요</option>
                <option value="rejected">제외</option>
              </select>
            </label>
            <label
              v-for="key in ['x', 'y', 'width', 'height', 'rotation', 'heightMm'] as const"
              :key="key"
            >
              {{
                {
                  x: `중심 X ${map.units}`,
                  y: `중심 Y ${map.units}`,
                  width: `폭 ${map.units}`,
                  height: `깊이 ${map.units}`,
                  rotation: '회전 °',
                  heightMm: '실제 높이 mm',
                }[key]
              }}
              <input
                v-model.number="draft[key]"
                type="number"
                required
                :min="['width', 'height', 'heightMm'].includes(key) ? 1 : undefined"
              />
            </label>
          </div>
          <div class="d-flex justify-end ga-2 mt-2">
            <v-btn @click="focus">위치 보기</v-btn>
            <v-btn
              type="submit"
              color="primary"
              variant="flat"
              :disabled="disabled"
            >
              객체 적용
            </v-btn>
          </div>
        </form>
      </template>
      <div
        v-if="findings.length"
        class="findings mt-3"
        data-testid="drawing-findings"
      >
        <strong>검토 항목 {{ findings.length }}건</strong>
        <p
          v-for="(finding, index) in findings.slice(0, 100)"
          :key="index"
          class="mt-2"
        >
          <b>{{ finding.target }}</b>
          · {{ finding.message }}
        </p>
        <p v-if="findings.length > 100">처음 100건 표시 · 전체 목록은 보고서 저장</p>
      </div>
      <p class="text-caption mt-2">
        영상 기반 검사는 운행 승인 결과가 아닙니다. 원본 치수와 차량 회전 성능을 함께 확인하세요.
      </p>
    </div>
  </details>
</template>
<style scoped lang="scss">
.drawing-tools {
  border-block: 1px solid var(--border);
  background: var(--surface-muted);
  font-size: 12px;
}
summary {
  cursor: pointer;
  padding: 10px 14px;
  font-weight: 650;
  gap: 8px;
}
.tools-body {
  max-height: min(48vh, 440px);
  overflow: auto;
}
.options-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
label {
  min-width: 0;
  display: block;
  color: var(--text-secondary);
  font-size: 11px;
}
input:not([type='checkbox']),
select {
  display: block;
  width: 100%;
  background: var(--input-bg);
  color: var(--text);
  border: 1px solid var(--app-border);
  border-radius: 7px;
  min-height: 30px;
  padding: 4px 7px;
  margin-top: 3px;
}
p {
  color: var(--text-secondary);
}
.object-list {
  max-height: 170px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.object-list button {
  appearance: none;
  border: 0;
  display: flex;
  width: 100%;
  text-align: left;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  background: var(--surface);
}
.object-list button:hover {
  background: var(--hover);
}
.object-list button.active {
  background: var(--accent-soft);
  box-shadow: inset 3px 0 var(--accent-fill);
}
.object-list small {
  flex-shrink: 0;
  color: var(--text-secondary);
  white-space: nowrap;
}
.object-list button > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rejected {
  opacity: 0.55;
}
.findings {
  border: 1px solid var(--notice-border);
  color: var(--notice-text);
  background: var(--notice-bg);
  padding: 10px;
  border-radius: 8px;
}
</style>
