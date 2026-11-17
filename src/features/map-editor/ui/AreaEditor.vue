<!--
 * 파일명: AreaEditor.vue
 * 설명: 원본 Bay와 Zone 및 그룹과 Offset과 Port Limit을 참조 일관성과 함께 편집하는 설정창
 * 작성자: 이희원
 * 작성일자: 2026-11-18
-->
<script setup lang="ts">
import { computed, ref, reactive, watch } from 'vue'
import { emptyAreas, validateAreas, type AreaData } from '@/entities/map/index.ts'
import { useEditor } from '@/features/map-editor/model/editor.ts'
const editor = useEditor(),
  data = ref<AreaData>(emptyAreas()),
  category = ref<keyof AreaData>('bays'),
  selected = ref(0),
  error = ref(''),
  fields = reactive<Record<string, string>>({})
let bayReferences: number[] = [],
  limitReferences: number[] = []
const titles = {
  bays: 'Bay',
  groups: 'Bay Group',
  zones: 'Zone',
  offsets: 'Bay Offset',
  limits: 'Port Limit',
}
const definitions: Record<keyof AreaData, Record<string, string>> = {
  bays: { name: 'Bay 이름', zone: 'Zone 이름' },
  groups: {
    name: '그룹 이름',
    zone: 'Zone 이름',
    loadLimit: 'Load 차량 제한 수',
    unloadLimit: 'Unload 차량 제한 수',
    agvType: 'AGV Type 영부터 아홉',
    bays: 'Bay 번호 목록 쉼표 구분',
  },
  zones: { name: 'Zone 이름', groups: 'Bay Group 번호 목록 쉼표 구분' },
  offsets: {
    name: 'Offset 이름',
    realId: '기준 Real ID',
    offset: 'Offset 거리 mm',
    groups: 'Bay Group 번호 목록 쉼표 구분',
  },
  limits: { name: '제한 이름', loadLimit: 'Load 차량 제한 수', unloadLimit: 'Unload 차량 제한 수' },
}
const columns = computed(() => definitions[category.value])
const rows = computed(() => data.value[category.value] as unknown as Record<string, unknown>[])
/** 현재 행을 원본 값과 구분되는 입력 초안으로 구성하는 선택 복원 */
const reset = () => {
  for (const key of Object.keys(fields)) delete fields[key]
  const row = rows.value[selected.value]
  if (!row) return
  for (const key of Object.keys(columns.value))
    fields[key] = Array.isArray(row[key])
      ? (row[key] as number[]).join(',')
      : String(row[key] ?? '')
}
watch([category, selected, columns], reset)
watch(
  () => editor.areaEditorOpen,
  (open) => {
    if (!open) return
    data.value = JSON.parse(JSON.stringify(editor.document.areas ?? emptyAreas()))
    bayReferences = data.value.bays.map((_, index) => index + 1)
    limitReferences = data.value.limits.map((_, index) => index + 1)
    category.value = editor.areaCategory as keyof AreaData
    selected.value = 0
    error.value = ''
    reset()
  },
)
/** 입력 행의 수치와 목록을 검증하고 Zone 이름 참조를 같이 바꾸는 행 편집 */
const applyRow = () => {
  const row = rows.value[selected.value]
  if (!row) return
  const oldName = String(row.name),
    patch: Record<string, unknown> = {}
  for (const key of Object.keys(columns.value)) {
    if (key === 'name' || key === 'zone') patch[key] = fields[key].trim()
    else if (key === 'groups' || key === 'bays')
      patch[key] = fields[key].trim()
        ? fields[key].split(',').map((value) => Number(value.trim()))
        : []
    else patch[key] = Number(fields[key])
  }
  Object.assign(row, patch)
  if (category.value === 'zones' && oldName !== row.name) {
    for (const bay of data.value.bays) if (bay.zone === oldName) bay.zone = String(row.name)
    for (const group of data.value.groups) if (group.zone === oldName) group.zone = String(row.name)
  }
}
/** 이름과 참조를 검증한 전체 설정을 지도와 함께 하나의 실행 취소 단위로 반영하는 적용 */
const apply = () => {
  try {
    applyRow()
    const checked = validateAreas(data.value, true),
      bayRefs = new Map(
        bayReferences.map((old, index) => [old, index + 1] as const).filter(([old]) => old > 0),
      ),
      limitRefs = new Map(
        limitReferences.map((old, index) => [old, index + 1] as const).filter(([old]) => old > 0),
      )
    editor.commit((map) => {
      map.areas = checked
      for (const edge of map.edges)
        if (edge.bays)
          edge.bays = edge.bays.flatMap((id) => (bayRefs.has(id) ? [bayRefs.get(id)!] : []))
      for (const port of map.ports) {
        if (port.bays)
          port.bays = port.bays.flatMap((id) => (bayRefs.has(id) ? [bayRefs.get(id)!] : []))
        if (port.settings?.limit_ports_idx !== undefined)
          port.settings.limit_ports_idx = limitRefs.get(Number(port.settings.limit_ports_idx)) ?? 0
      }
    })
    bayReferences = checked.bays.map((_, index) => index + 1)
    limitReferences = checked.limits.map((_, index) => index + 1)
    error.value = ''
    editor.message = '영역 및 제한 데이터 적용 · 저장 필요'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
/** 실제 설정이 없는 값은 제한 없음과 빈 목록으로 초기화하는 새 행 추가 */
const add = () => {
  const name = `${titles[category.value].replaceAll(' ', '_').toUpperCase()}_${rows.value.length + 1}`,
    zone = data.value.zones[0]?.name ?? 'ZONE_1'
  const row =
    category.value === 'bays'
      ? { name, zone }
      : category.value === 'groups'
        ? { name, zone, loadLimit: -1, unloadLimit: -1, agvType: 0, bays: [] }
        : category.value === 'zones'
          ? { name, groups: [] }
          : category.value === 'offsets'
            ? { name, realId: editor.selectedNode?.realId ?? 1, offset: 0, groups: [] }
            : { name, loadLimit: -1, unloadLimit: -1 }
  rows.value.push(row)
  if (category.value === 'bays') bayReferences.push(0)
  if (category.value === 'limits') limitReferences.push(0)
  selected.value = rows.value.length - 1
  reset()
}
/** 행 제거로 변경되는 한 기반 참조를 소속 목록에서 다시 계산하는 삭제 */
const remove = () => {
  try {
    const row = rows.value[selected.value]
    if (!row) return
    const id = selected.value + 1
    if (
      category.value === 'zones' &&
      (data.value.bays.some((bay) => bay.zone === row.name) ||
        data.value.groups.some((group) => group.zone === row.name))
    )
      throw new Error('소속 Bay와 Group의 Zone을 먼저 변경하세요.')
    const remap = (ids: number[]) =>
      ids.filter((value) => value !== id).map((value) => (value > id ? value - 1 : value))
    if (category.value === 'bays') {
      for (const group of data.value.groups) group.bays = remap(group.bays)
      bayReferences.splice(selected.value, 1)
    }
    if (category.value === 'groups') {
      for (const zone of data.value.zones) zone.groups = remap(zone.groups)
      for (const offset of data.value.offsets) offset.groups = remap(offset.groups)
    }
    if (category.value === 'limits') limitReferences.splice(selected.value, 1)
    rows.value.splice(selected.value, 1)
    selected.value = Math.max(0, selected.value - 1)
    reset()
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
/** 현재 초안을 보존하며 설정 종류를 바꾸는 탭 전환 */
const changeCategory = (key: keyof AreaData) => {
  applyRow()
  category.value = key
  selected.value = 0
  reset()
}
/** 다른 행으로 이동하기 전에 현재 초안을 반영하는 행 선택 */
const choose = (index: number) => {
  applyRow()
  selected.value = index
  reset()
}
</script>
<template>
  <v-dialog
    v-model="editor.areaEditorOpen"
    max-width="900"
    scrollable
  >
    <v-card
      class="pa-4"
      data-testid="area-editor"
    >
      <div class="d-flex justify-space-between align-center">
        <strong>Bay / Zone 설정</strong>
        <v-btn @click="editor.areaEditorOpen = false">닫기</v-btn>
      </div>
      <div class="d-flex flex-wrap ga-2 my-3">
        <v-btn
          v-for="(title, key) in titles"
          :key="key"
          :color="category === key ? 'primary' : undefined"
          @click="changeCategory(key)"
        >
          {{ title }}
        </v-btn>
      </div>
      <v-card-text class="pa-0">
        <div class="area-content">
          <div>
            <div class="d-flex ga-2 mb-3">
              <v-btn @click="add">추가</v-btn>
              <v-btn
                :disabled="!rows.length"
                @click="remove"
              >
                삭제
              </v-btn>
            </div>
            <div class="row-list">
              <v-btn
                v-for="(row, index) in rows"
                :key="index"
                class="d-block mb-1 text-left"
                :color="selected === index ? 'primary' : undefined"
                @click="choose(index)"
              >
                {{ index + 1 }} · {{ row.name }}
              </v-btn>
            </div>
          </div>
          <div class="d-flex flex-column ga-3">
            <v-text-field
              v-for="(label, key) in columns"
              :key="key"
              v-model="fields[key]"
              :label="label"
              :disabled="!rows.length"
              :type="['name', 'zone', 'groups', 'bays'].includes(key) ? 'text' : 'number'"
            />
            <p class="text-caption">
              번호는 목록의 한 기반 번호 · 차량 제한 수 마이너스 일은 제한 없음
            </p>
          </div>
        </div>
        <p
          v-if="error"
          class="text-error mt-3"
          role="alert"
        >
          {{ error }}
        </p>
      </v-card-text>
      <v-card-actions class="mt-3">
        <v-btn
          color="primary"
          variant="flat"
          :disabled="editor.readOnly"
          @click="apply"
        >
          지도에 적용
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<style scoped lang="scss">
.area-content {
  display: grid;
  grid-template-columns: minmax(170px, 1fr) minmax(280px, 2fr);
  gap: 24px;
}
.row-list {
  max-height: 45vh;
  overflow-y: auto;
}
</style>
