<!--
/**
 * 파일명: MapObjectEditor.vue
 * 설명: 원본 지도 포트와 연결 경로 및 도형의 수치와 표시 속성을 편집하는 객체 편집창
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
-->
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useEditor } from '@/features/map-editor/index.ts'
import {
  PORT_SETTINGS,
  PATH_CONTROLS,
  type MapEdge,
  type MapPort,
  type MapPortGroup,
  type MapShape,
} from '@/entities/map/index.ts'

const props = defineProps<{ initialCategory: 'ports' | 'edges' | 'shapes' | 'portGroups' }>()
const editor = useEditor()
const open = defineModel<boolean>({ required: true })
const category = ref<'ports' | 'edges' | 'shapes' | 'portGroups'>('ports')
const selected = ref('')
const query = ref('')
const fieldQuery = ref('')
const initialDraft = ref<Record<string, string>>({})
const error = ref('')
const draft = reactive<Record<string, string>>({})
const stringFields = new Set([
  'name',
  'text',
  'description',
  'bays',
  'portIds',
  ...PORT_SETTINGS.filter((field) => field.kind === 'text').map((field) => `settings.${field.key}`),
])
const fields = computed(() => {
  if (category.value === 'ports')
    return {
      nodeId: '연결 노드 ID',
      name: '포트 이름',
      x: 'X 좌표 mm',
      y: 'Y 좌표 mm',
      width: '폭 mm',
      height: '높이 mm',
      floor: '층',
      strokeColor: '테두리 색상 BGR',
      fillColor: '채움 색상 BGR',
      fontColor: '글자 색상 BGR',
      fontSize: '글자 크기',
      nameDistance: '이름 간격',
      namePosition: '이름 위치 상 하 우 좌',
      nameDirection: '이름 방향',
      bays: 'Bay 목록 쉼표 구분',
      ...Object.fromEntries(PORT_SETTINGS.map((field) => [`settings.${field.key}`, field.label])),
    }
  if (category.value === 'portGroups')
    return {
      nodeId: '기준 노드 ID',
      x: 'X 좌표 mm',
      y: 'Y 좌표 mm',
      width: '폭 mm',
      height: '높이 mm',
      offsetX: '노드 기준 X 간격',
      offsetY: '노드 기준 Y 간격',
      strokeColor: '테두리 색상 BGR',
      fillColor: '채움 색상 BGR',
      portIds: '소속 포트 ID 쉼표 구분',
    }
  if (category.value === 'edges')
    return {
      direction: '방향 단방향 영 양방향 일',
      distance: '주행 거리 mm',
      speed: '속도 cm/s',
      bays: 'Bay 목록 쉼표 구분',
      ...Object.fromEntries(
        ['forward', 'backward'].flatMap((direction) =>
          PATH_CONTROLS.map((field) => [
            `controls.${direction}.${field.key}`,
            `${direction === 'forward' ? '정방향' : '역방향'} ${field.label}`,
          ]),
        ),
      ),
    }
  return {
    description: '설명',
    text: '표시 문자열',
    type: '종류 사각 둥근사각 타원 원 선 문자',
    x1: '시작 X mm',
    y1: '시작 Y mm',
    x2: '끝 X mm',
    y2: '끝 Y mm',
    centerX: '중심 X mm',
    centerY: '중심 Y mm',
    radius: '반지름 mm',
    width: '폭 mm',
    height: '높이 mm',
    strokeColor: '선 색상 BGR',
    strokeStyle: '선 종류',
    strokeWidth: '선 두께',
    fillColor: '채움 색상 BGR',
    fontColor: '글자 색상 BGR',
    fontAlign: '글자 정렬',
    fontDirection: '글자 방향',
    fillStyle: '채움 종류',
  }
})
const visibleFields = computed(() =>
  Object.fromEntries(
    Object.entries(fields.value).filter(([key, label]) =>
      `${key} ${label}`.toLowerCase().includes(fieldQuery.value.trim().toLowerCase()),
    ),
  ),
)
const items = computed(() => {
  const values = editor.document[category.value] ?? []
  return values.map((value) => ({
    id: String(value.id),
    label:
      'from' in value
        ? `${value.from} → ${value.to}`
        : `${value.id} ${'name' in value ? value.name : 'description' in value ? value.description : '포트 그룹'}`,
    value,
  }))
})
const filtered = computed(() =>
  items.value.filter((item) => item.label.toLowerCase().includes(query.value.toLowerCase())),
)
const current = computed(() => items.value.find((item) => item.id === selected.value))

/**
 * 선택 객체의 적용한 속성으로 입력 초안을 다시 구성하는 선택 복원
 */
const reset = () => {
  for (const key of Object.keys(draft)) delete draft[key]
  const value = current.value?.value as unknown as Record<string, unknown> | undefined
  for (const key of Object.keys(fields.value))
    draft[key] = String(
      key.startsWith('controls.')
        ? ((value as unknown as MapEdge)?.controls?.[key.split('.')[1] as 'forward' | 'backward']?.[
            key.split('.')[2]
          ] ?? 0)
        : key === 'bays' || key === 'portIds'
          ? ((value?.[key] as (number | string)[] | undefined)?.join(',') ?? '')
          : key.startsWith('settings.')
            ? ((value as unknown as MapPort)?.settings?.[key.split('.')[1]] ??
              (stringFields.has(key) ? '' : 0))
            : (value?.[key] ?? (stringFields.has(key) ? '' : 0)),
    )
  initialDraft.value = { ...draft }
  error.value = ''
}
watch([current, fields], reset)
watch(category, () => {
  selected.value = ''
  query.value = ''
})
watch(open, (value) => {
  if (value) {
    category.value = props.initialCategory
    selected.value = ''
    error.value = ''
  }
})

/**
 * 객체 속성을 검증한 문서 복제에 적용하며 실패를 초안에 표시하는 변경 적용
 */
const apply = () => {
  if (!current.value) return
  try {
    const changes: Record<string, string | number> = {}
    for (const key of Object.keys(fields.value)) {
      if (draft[key] === initialDraft.value[key]) continue
      if (!stringFields.has(key) && !draft[key]?.trim())
        throw new Error('빈 수치 입력을 확인하세요.')
      changes[key] = stringFields.has(key) ? draft[key] : Number(draft[key])
    }
    editor.commit((map) => {
      const target = map[category.value]?.find((item) => String(item.id) === selected.value)
      if (!target) throw new Error('편집할 객체가 없습니다.')
      if (
        category.value === 'edges' &&
        changes.direction !== undefined &&
        ![0, 1].includes(Number(changes.direction))
      )
        throw new Error('방향은 0 또는 1입니다.')
      for (const [key, value] of Object.entries(changes)) {
        if (key.startsWith('controls.')) {
          const edge = target as MapEdge,
            [, direction, field] = key.split('.')
          edge.controls ??= {}
          const side = direction as 'forward' | 'backward'
          edge.controls[side] ??= {}
          edge.controls[side][field] = Number(value)
        } else if (key === 'portIds') {
          ;(target as MapPortGroup).portIds = String(value)
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        } else if (key === 'bays') {
          ;(target as MapEdge | MapPort).bays = String(value).trim()
            ? String(value)
                .split(',')
                .map((part) => Number(part.trim()))
            : []
        } else if (key.startsWith('settings.')) {
          const port = target as MapPort
          port.settings ??= {}
          port.settings[key.split('.')[1]] = value
        } else Object.assign(target, { [key]: value })
      }
    })
    editor.message = '지도 객체 속성을 적용했습니다.'
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

/**
 * 선택 노드에 기본 포트 또는 원본 도형을 추가하는 객체 생성
 */
const add = () => {
  try {
    const node = editor.selectedNode ?? editor.document.nodes[0]
    if (!node) throw new Error('먼저 기준 노드를 추가하세요.')
    if (category.value === 'ports') {
      let suffix = editor.document.ports.length + 1
      while (editor.document.ports.some((port) => port.id === `P${suffix}`)) suffix++
      const port: MapPort = {
        id: `P${suffix}`,
        nodeId: node.id,
        name: '',
        x: node.x,
        y: node.y + 1000,
        width: 1000,
        height: 1000,
        floor: 1,
        strokeColor: 16711935,
        fillColor: 16777215,
        fontColor: 0,
        fontSize: 40,
        nameDistance: 100,
        namePosition: 0,
        nameDirection: 0,
      }
      editor.commit((map) => map.ports.push(port))
      selected.value = port.id
    } else if (category.value === 'portGroups') {
      let suffix = 1
      while (editor.document.portGroups?.some((group) => group.id === String(suffix))) suffix++
      const grouped = new Set(editor.document.portGroups?.flatMap((group) => group.portIds) ?? [])
      const group: MapPortGroup = {
        id: String(suffix),
        nodeId: node.id,
        nodeX: node.x,
        nodeY: node.y,
        offsetX: 0,
        offsetY: 0,
        x: node.x,
        y: node.y,
        width: 1000,
        height: 1000,
        strokeColor: 8421504,
        fillColor: 16777215,
        portIds: editor.document.ports
          .filter((port) => port.nodeId === node.id && !grouped.has(port.id))
          .map((port) => port.id),
      }
      editor.commit((map) => {
        map.portGroups ??= []
        map.portGroups.push(group)
      })
      selected.value = group.id
    } else if (category.value === 'shapes') {
      const shape: MapShape = {
        id: Math.max(0, ...(editor.document.shapes ?? []).map((item) => item.id)) + 1,
        description: '',
        text: '',
        type: 1,
        x1: node.x,
        y1: node.y,
        x2: node.x + 2000,
        y2: node.y + 1000,
        centerX: node.x + 1000,
        centerY: node.y + 500,
        radius: 500,
        width: 2000,
        height: 1000,
        strokeColor: 8421504,
        strokeStyle: 0,
        strokeWidth: 1,
        fillColor: 16777215,
        fontColor: 0,
        fontAlign: 0,
        fontDirection: 0,
        fillStyle: 9,
      }
      editor.commit((map) => {
        map.shapes ??= []
        map.shapes.push(shape)
      })
      selected.value = String(shape.id)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

/**
 * 선택 객체를 제거하고 포트 그룹의 참조를 함께 정리하는 객체 삭제
 */
const remove = () => {
  if (!current.value || !window.confirm(`${current.value.label} 객체를 삭제하시겠습니까?`)) return
  try {
    editor.commit((map) => {
      if (category.value === 'ports') {
        map.ports = map.ports.filter((item) => item.id !== selected.value)
        for (const group of map.portGroups ?? [])
          group.portIds = group.portIds.filter((id) => id !== selected.value)
      } else if (category.value === 'edges')
        map.edges = map.edges.filter((item) => item.id !== selected.value)
      else if (category.value === 'portGroups')
        map.portGroups = map.portGroups?.filter((group) => group.id !== selected.value)
      else map.shapes = map.shapes?.filter((item) => String(item.id) !== selected.value)
    })
    selected.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="1050"
    scrollable
  >
    <v-card title="2D 지도 객체 편집">
      <v-card-text>
        <v-btn-toggle
          v-model="category"
          mandatory
          divided
          class="mb-4"
        >
          <v-btn value="ports">포트</v-btn>
          <v-btn value="edges">연결 경로</v-btn>
          <v-btn value="shapes">도형</v-btn>
          <v-btn value="portGroups">포트 그룹</v-btn>
        </v-btn-toggle>
        <div class="object-editor d-grid ga-5">
          <div class="d-flex flex-column ga-2">
            <v-text-field
              v-model="query"
              label="객체 검색"
              density="compact"
              hide-details
            />
            <v-select
              v-model="selected"
              :items="filtered"
              item-title="label"
              item-value="id"
              label="편집 객체"
              hide-details
              data-testid="object-select"
            />
            <v-btn
              v-if="category !== 'edges'"
              data-testid="object-add"
              @click="add"
            >
              {{ category === 'ports' ? '포트 추가' : '도형 추가' }}
            </v-btn>
            <v-btn
              :disabled="!current"
              color="error"
              variant="text"
              @click="remove"
            >
              선택 객체 삭제
            </v-btn>
            <p class="text-caption">원본의 미편집 제어값과 예약 필드는 저장 시 보존됩니다.</p>
          </div>
          <form
            class="object-fields d-grid ga-3"
            @submit.prevent="apply"
          >
            <template v-if="current">
              <v-text-field
                v-model="fieldQuery"
                label="속성 검색"
              />
              <v-text-field
                v-for="(label, key) in visibleFields"
                :key="key"
                v-model="draft[key]"
                :label="label"
                :type="stringFields.has(key) ? 'text' : 'number'"
                density="compact"
                hide-details
                :data-field="key"
              />
              <v-btn
                type="submit"
                color="primary"
                data-testid="object-apply"
              >
                변경 사항 적용
              </v-btn>
            </template>
            <p
              v-else
              class="text-body-2"
            >
              편집할 객체를 선택하세요.
            </p>
          </form>
        </div>
        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          class="mt-4"
          role="alert"
        >
          {{ error }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="open = false">닫기</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss">
// 객체 목록과 속성 입력을 나란히 배치하는 편집창 구성
.object-editor {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
}
.object-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
</style>
