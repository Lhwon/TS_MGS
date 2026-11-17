<!--
 * 파일명: MapOperations.vue
 * 설명: 선택 노드의 일괄 속성과 연결 간격 및 경로 거리를 편집하는 지도 작업창
 * 작성자: 이희원
 * 작성일자: 2026-11-18
-->
<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useEditor } from '@/features/map-editor/model/editor.ts'
import { subdividePaths, shortestMapPath } from '@/features/map-editor/model/operations.ts'
import { editSelectedNodes, NODE_FLAGS, PATH_CONTROLS } from '@/entities/map/index.ts'
import { createGrid } from '@/features/map-editor/model/grid.ts'
import { makeAroundData } from '@/features/map-editor/model/around.ts'
import { downloadJson } from '@/shared/lib/files/index.ts'
import { assignRealIds } from '@/features/map-editor/model/realIds.ts'
const editor = useEditor(),
  tab = computed({
    get: () => editor.operationTab,
    set: (value) => {
      editor.operationTab = value
    },
  }),
  scope = ref('selection'),
  error = ref(''),
  result = ref('')
const selected = computed(() => [
  ...new Set([...editor.selectedIds, ...(editor.selectedId === null ? [] : [editor.selectedId])]),
])
const ids = computed(() =>
  scope.value === 'all' ? editor.document.nodes.map((node) => node.id) : selected.value,
)
const flags = reactive<Record<string, number>>({}),
  numbers = reactive<Record<string, string>>({}),
  control = ref('manualDegree'),
  controlValue = ref(0)
const realIds = reactive({ start: 1, step: 1, order: 'id' as 'id' | 'xy' | 'yx', insert: false })
const aroundRadius = ref(30000)
const grid = reactive({ rows: 3, columns: 3, spacingX: 1000, spacingY: 1000, x: 0, y: 0 })
const spacing = ref(1000),
  dx = ref(0),
  dy = ref(0),
  start = ref(1),
  end = ref(2)
/** 실패한 변경을 원본에 남기지 않고 결과를 표시하는 작업 실행 */
const run = (work: () => string) => {
  try {
    error.value = ''
    result.value = work()
    editor.message = result.value
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
/** 선택한 속성만 일괄 적용하여 서로 다른 기존 값을 유지하는 노드 편집 */
const applyNodes = () =>
  run(() => {
    if (!ids.value.length) throw new Error('노드를 선택하세요.')
    const target = new Set(ids.value)
    editor.commit((map) => {
      for (const node of map.nodes)
        if (target.has(node.id)) {
          for (const field of NODE_FLAGS)
            if (flags[field.key] !== undefined && flags[field.key] !== -1)
              node[field.key] = flags[field.key] === 1
          for (const key of [
            'property',
            'addressType',
            'safetyDistance',
            'safetyViewDistance',
          ] as const)
            if (numbers[key]?.trim()) {
              const value = Number(numbers[key])
              if (!Number.isSafeInteger(value) || value < 0)
                throw new Error('속성은 영 이상의 정수로 입력하세요.')
              node[key] = value
            }
        }
    })
    return `${target.size}개 노드 속성 적용`
  })
/** 노드와 연결 포트의 상대 위치를 유지하는 이동 */
const move = () =>
  run(() => {
    if (!ids.value.length) throw new Error('노드를 선택하세요.')
    editor.moveNodes(ids.value, Number(dx.value), Number(dy.value))
    return `${ids.value.length}개 노드 이동`
  })
/** 지정 범위에서 끝점과 분기를 보존하는 직선 간격 적용 */
const subdivide = () =>
  run(() => {
    if (scope.value === 'selection' && !ids.value.length) throw new Error('노드를 선택하세요.')
    const output = subdividePaths(
      editor.document,
      Number(spacing.value),
      scope.value === 'all' ? undefined : ids.value,
    )
    editor.commit((map) => Object.assign(map, output.map))
    return `노드 ${output.added}개 추가 · 직선 ${output.changed}개 분할 · 곡선 원형 유지`
  })
/** 선택 노드 사이의 경로에 방향별 운행 제어값을 일괄 적용하는 경로 편집 */
const applyControls = () =>
  run(() => {
    const target = new Set(ids.value)
    let count = 0
    const value = Number(controlValue.value)
    if (!Number.isSafeInteger(value)) throw new Error('제어값은 정수로 입력하세요.')
    editor.commit((map) => {
      for (const edge of map.edges)
        if (target.has(edge.from) && target.has(edge.to)) {
          edge.controls ??= {}
          for (const direction of ['forward', 'backward'] as const) {
            if (direction === 'backward' && (edge.direction ?? 1) === 0) continue
            edge.controls[direction] ??= {}
            edge.controls[direction][control.value] = value
          }
          count++
        }
    })
    return `경로 ${count}개 제어값 적용`
  })
/** 입력한 행과 열 및 간격으로 직교 노드를 생성하는 격자 적용 */
const generateGrid = () =>
  run(() => {
    const map = createGrid(
      editor.document,
      Object.fromEntries(
        Object.entries(grid).map(([key, value]) => [key, Number(value)]),
      ) as typeof grid,
    )
    editor.commit((document) => Object.assign(document, map))
    return '격자 생성 완료'
  })
/** 원본 주변 노드 형식의 파일을 실제 길이로 계산하여 추출하는 데이터 생성 */
const exportAround = () =>
  run(() => {
    const data = makeAroundData(editor.document, Number(aroundRadius.value))
    downloadJson(
      data.content,
      editor.sourceName.replace(/\.(jmapx|tsmgs\.json|json)$/i, '') + '_path_around.bem',
    )
    return `주변 데이터 생성 · ${data.nodes}개 노드 · ${data.pairs}개 참조`
  })
/** 선택 범위의 Real ID를 순서와 삽입 옵션에 따라 지정하는 실제 식별자 적용 */
const applyRealIds = () =>
  run(() => {
    const output = assignRealIds(editor.document, ids.value, {
      start: Number(realIds.start),
      step: Number(realIds.step),
      order: realIds.order,
      insert: realIds.insert,
    })
    editor.commit((map) => Object.assign(map, output.map))
    return `실제 노드 ${output.changed}개 Real ID 적용`
  })
/** 선택한 연결 구조를 보존하는 복제와 종속 참조를 함께 정리하는 삭제 */
const editSelection = (operation: 'duplicate' | 'delete') =>
  run(() => {
    if (!ids.value.length) throw new Error('노드를 선택하세요.')
    if (
      operation === 'delete' &&
      !window.confirm(`${ids.value.length}개 노드와 종속 경로·포트를 삭제하시겠습니까?`)
    )
      return '삭제 취소'
    const output = editSelectedNodes(editor.document, ids.value, {
      operation,
      dx: Number(dx.value),
      dy: Number(dy.value),
    })
    editor.commit((map) => Object.assign(map, output.map))
    return operation === 'delete' ? '선택 노드 삭제 완료' : '선택 연결 구조 복제 완료'
  })
/** 경로 방향을 반영하는 출발과 도착 사이 거리 계산 */
const distance = () =>
  run(() => {
    const path = shortestMapPath(editor.document, Number(start.value), Number(end.value))
    return `${Math.round(path.distance)} ${path.units} · ${path.nodes.join(' → ')}`
  })
</script>
<template>
  <v-dialog
    v-model="editor.operationsOpen"
    max-width="750"
    scrollable
  >
    <v-card
      class="pa-4"
      data-testid="map-operations"
    >
      <div class="d-flex align-center justify-space-between">
        <strong>지도 일괄 편집</strong>
        <v-btn @click="editor.operationsOpen = false">닫기</v-btn>
      </div>
      <div class="d-flex flex-wrap ga-2 my-3">
        <v-btn
          v-for="item in [
            { id: 'nodes', label: '노드 속성' },
            { id: 'move', label: '이동' },
            { id: 'spacing', label: '노드 간격' },
            { id: 'control', label: '경로 제어' },
            { id: 'distance', label: '경로 거리' },
            { id: 'grid', label: '격자 생성' },
            { id: 'bays', label: 'Bay 필터' },
            { id: 'around', label: '주변 데이터' },
            { id: 'ids', label: 'Real ID' },
            { id: 'duplicate', label: '복제' },
            { id: 'delete', label: '삭제' },
          ]"
          :key="item.id"
          :color="tab === item.id ? 'primary' : undefined"
          @click="tab = item.id"
        >
          {{ item.label }}
        </v-btn>
      </div>
      <v-select
        v-model="scope"
        :items="[
          { title: `선택 노드 ${selected.length}개`, value: 'selection' },
          { title: '전체 노드', value: 'all' },
        ]"
        label="적용 범위"
        class="mb-4"
      />
      <v-card-text class="pa-0">
        <div
          v-if="tab === 'nodes'"
          class="fields"
        >
          <v-select
            v-for="field in NODE_FLAGS"
            :key="field.key"
            :model-value="flags[field.key] ?? -1"
            :items="[
              { title: '기존 값 유지', value: -1 },
              { title: '설정', value: 1 },
              { title: '해제', value: 0 },
            ]"
            :label="field.label"
            @update:model-value="flags[field.key] = $event"
          />
          <v-text-field
            v-for="field in [
              { key: 'property', label: 'Property' },
              { key: 'addressType', label: 'Address Type' },
              { key: 'safetyDistance', label: 'Safety Distance mm' },
              { key: 'safetyViewDistance', label: 'Safety View Distance mm' },
            ]"
            :key="field.key"
            v-model="numbers[field.key]"
            :label="field.label"
            type="number"
            placeholder="기존 값 유지"
          />
        </div>
        <div
          v-else-if="tab === 'move' || tab === 'duplicate'"
          class="fields"
        >
          <v-text-field
            v-model="dx"
            label="X 이동량"
            type="number"
          />
          <v-text-field
            v-model="dy"
            label="Y 이동량"
            type="number"
          />
        </div>
        <div v-else-if="tab === 'spacing'">
          <p class="text-caption mb-3">
            실제 축척이 확정된 mm 맵에서 적용 · 끝점과 분기 및 포트 접속점 유지 · 마지막 구간은 지정
            간격 이하
          </p>
          <v-text-field
            v-model="spacing"
            label="직선 노드 간격 mm"
            type="number"
            min="1"
            data-testid="path-spacing"
          />
        </div>
        <div
          v-else-if="tab === 'control'"
          class="fields"
        >
          <v-select
            v-model="control"
            :items="PATH_CONTROLS.map((field) => ({ title: field.label, value: field.key }))"
            label="경로 제어 속성"
          />
          <v-text-field
            v-model="controlValue"
            label="값"
            type="number"
          />
        </div>
        <div
          v-else-if="tab === 'ids'"
          class="fields"
        >
          <v-text-field
            v-model="realIds.start"
            label="시작 Real ID"
            type="number"
          />
          <v-text-field
            v-model="realIds.step"
            label="증가 간격"
            type="number"
          />
          <v-select
            v-model="realIds.order"
            :items="[
              { title: 'Node ID 순서', value: 'id' },
              { title: 'X 증가 후 Y 감소', value: 'xy' },
              { title: 'Y 감소 후 X 증가', value: 'yx' },
            ]"
            label="정렬 순서"
          />
          <label>
            <input
              type="checkbox"
              v-model="realIds.insert"
            />
            기존 번호 사이에 삽입
          </label>
        </div>
        <div v-else-if="tab === 'around'">
          <v-text-field
            v-model="aroundRadius"
            label="주변 조회 반경 mm"
            type="number"
          />
          <p class="text-caption mt-2">
            원본 path_around.bem 형식 · 정수 직선 거리 · 가까운 노드 순서
          </p>
        </div>
        <div v-else-if="tab === 'bays'">
          <v-select
            v-model="editor.bayFilter"
            :items="editor.availableBays"
            label="표시할 Bay · 빈 선택은 전체 표시"
            multiple
            chips
          />
          <p class="text-caption mt-2">
            지도 데이터를 바꾸지 않고 선택 Bay에 속한 경로와 연결 객체를 표시
          </p>
        </div>
        <div
          v-else-if="tab === 'grid'"
          class="fields"
        >
          <v-text-field
            v-for="field in [
              { key: 'rows', label: '행 수' },
              { key: 'columns', label: '열 수' },
              { key: 'spacingX', label: 'X 간격' },
              { key: 'spacingY', label: 'Y 간격' },
              { key: 'x', label: '시작 X' },
              { key: 'y', label: '시작 Y' },
            ]"
            :key="field.key"
            v-model="grid[field.key as keyof typeof grid]"
            :label="field.label"
            type="number"
          />
        </div>
        <div
          v-else
          class="fields"
        >
          <v-text-field
            v-model="start"
            label="출발 노드 ID"
            type="number"
          />
          <v-text-field
            v-model="end"
            label="도착 노드 ID"
            type="number"
          />
        </div>
        <p
          v-if="error"
          class="text-error mt-3"
          role="alert"
        >
          {{ error }}
        </p>
        <p
          v-if="result"
          class="text-body-2 mt-3 result"
        >
          {{ result }}
        </p>
      </v-card-text>
      <v-card-actions class="mt-4 pa-0">
        <v-btn
          color="primary"
          variant="flat"
          :disabled="editor.readOnly"
          data-testid="apply-map-operation"
          @click="
            tab === 'nodes'
              ? applyNodes()
              : tab === 'move'
                ? move()
                : tab === 'spacing'
                  ? subdivide()
                  : tab === 'control'
                    ? applyControls()
                    : tab === 'grid'
                      ? generateGrid()
                      : tab === 'duplicate'
                        ? editSelection('duplicate')
                        : tab === 'delete'
                          ? editSelection('delete')
                          : tab === 'ids'
                            ? applyRealIds()
                            : tab === 'around'
                              ? exportAround()
                              : tab === 'bays'
                                ? (result = 'Bay 표시 적용')
                                : distance()
          "
        >
          {{ tab === 'distance' ? '거리 계산' : '적용' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<style scoped lang="scss">
.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}
.result {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
