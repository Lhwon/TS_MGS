<!--
 * 파일명: TeachingEditor.vue
 * 설명: 원본 Teaching 시트의 검증 결과와 선택 행을 지도에 적용하는 가져오기 창
 * 작성자: 이희원
 * 작성일자: 2026-11-18
-->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useEditor } from '@/features/map-editor/model/editor.ts'
import {
  readTeachingFile,
  applyTeaching,
  type TeachingSheet,
} from '@/features/map-editor/model/teaching.ts'
const editor = useEditor(),
  sheets = ref<TeachingSheet[]>([]),
  selected = ref(0),
  selectedRows = ref<number[]>([]),
  error = ref(''),
  loading = ref(false),
  fileInput = ref<HTMLInputElement>()
const rows = computed(() => sheets.value[selected.value]?.rows ?? [])
const checks = computed(() =>
  rows.value.map((row, index) => {
    try {
      applyTeaching(editor.document, [row], true)
      return { index, valid: true, message: '검증 통과' }
    } catch (cause) {
      return {
        index,
        valid: false,
        message: cause instanceof Error ? cause.message : String(cause),
      }
    }
  }),
)
watch(selected, () => {
  selectedRows.value = checks.value.filter((row) => row.valid).map((row) => row.index)
})
/** Excel 또는 CSV를 읽고 실제 지도에 적용하기 전 행별 검증을 수행하는 파일 읽기 */
const load = async (event: Event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  if (!file) return
  loading.value = true
  error.value = ''
  try {
    sheets.value = await readTeachingFile(file)
    selected.value = 0
    selectedRows.value = checks.value.filter((row) => row.valid).map((row) => row.index)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
    input.value = ''
  }
}
/** 선택한 유효 행만 순서대로 반영하고 실행 취소 이력에 보관하는 Teaching 적용 */
const apply = () => {
  try {
    if (!selectedRows.value.length) throw new Error('적용할 유효 행을 선택하세요.')
    const result = applyTeaching(
      editor.document,
      rows.value.filter((_, index) => selectedRows.value.includes(index)),
    )
    editor.commit((map) => Object.assign(map, result.map))
    editor.message = `Teaching ${result.results.length}행 적용 · 저장 필요`
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
/** 선택한 행의 적용 여부를 변경하는 행 선택 */
const selectRow = (index: number, checked: boolean) => {
  selectedRows.value = checked
    ? [...selectedRows.value, index]
    : selectedRows.value.filter((value) => value !== index)
}
</script>
<template>
  <v-dialog
    v-model="editor.teachingOpen"
    max-width="1100"
    scrollable
  >
    <v-card
      class="pa-4"
      data-testid="teaching-editor"
    >
      <div class="d-flex justify-space-between align-center">
        <strong>Apply Teaching</strong>
        <v-btn @click="editor.teachingOpen = false">닫기</v-btn>
      </div>
      <div class="d-flex ga-3 my-3 align-center">
        <v-btn
          :loading="loading"
          @click="fileInput?.click()"
        >
          XLSX / CSV 열기
        </v-btn>
        <input
          ref="fileInput"
          type="file"
          accept=".xlsx,.csv,.tsv"
          class="d-none"
          data-testid="teaching-file"
          @change="load"
        />
        <v-select
          v-if="sheets.length"
          v-model="selected"
          :items="sheets.map((sheet, index) => ({ title: sheet.name, value: index }))"
          label="시트"
        />
      </div>
      <p class="text-caption mb-3">
        Node / To Node는 Real ID 기준 · X/Y와 Offset은 mm · ODS는 슬래시로 구분한 여덟 값 · 빈 값과
        대시는 기존 값 유지
      </p>
      <v-card-text class="pa-0">
        <div class="teaching-table">
          <table>
            <thead>
              <tr>
                <th>적용</th>
                <th>행</th>
                <th>결과</th>
                <th
                  v-for="header in sheets[selected]?.headers ?? []"
                  :key="header"
                >
                  {{ header }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="check in checks"
                :key="check.index"
              >
                <td>
                  <input
                    type="checkbox"
                    :checked="selectedRows.includes(check.index)"
                    :disabled="!check.valid"
                    :aria-label="`${check.index + 2}행 적용`"
                    @change="selectRow(check.index, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td>{{ check.index + 2 }}</td>
                <td :class="{ 'text-error': !check.valid }">{{ check.message }}</td>
                <td
                  v-for="header in sheets[selected]?.headers ?? []"
                  :key="header"
                >
                  {{ rows[check.index][header] }}
                </td>
              </tr>
            </tbody>
          </table>
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
          :disabled="loading || editor.readOnly || !selectedRows.length"
          data-testid="teaching-apply"
          @click="apply"
        >
          선택 행 적용 {{ selectedRows.length }}개
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<style scoped lang="scss">
.teaching-table {
  max-height: 55vh;
  overflow: auto;
}
table {
  border-collapse: collapse;
  min-width: 100%;
  white-space: nowrap;
}
th,
td {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  text-align: left;
}
th {
  position: sticky;
  top: 0;
  background: rgb(var(--v-theme-surface));
}
</style>
