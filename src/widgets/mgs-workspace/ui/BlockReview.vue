<!--
 * 파일명: BlockReview.vue
 * 설명: 원본 Block과 Blocking 검토 자료의 조회 및 지도 노드 표시
 * 작성자: 이희원
 * 작성일자: 2026-11-23
-->
<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { MAX_FILE_BYTES } from '@/entities/map/index.ts'
import { readBlockReview, useEditor, type BlockReviewType } from '@/features/map-editor/index.ts'

const type = defineModel<BlockReviewType | null>({ required: true })
const emit = defineEmits<{ focus: [nodeId: number] }>()
const editor = useEditor()
const fileInput = ref<HTMLInputElement>()
const search = ref('')
const selectedId = ref<number>()
const fileName = ref('')
const error = ref('')
const loading = ref(false)
const currentPage = ref(0)
const pageSize = 60
const review = shallowRef<ReturnType<typeof readBlockReview>>()
let request = 0

const open = computed({
  get: () => type.value !== null,
  set: (value) => { if (!value) type.value = null },
})
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return (review.value?.rows ?? []).filter((row) =>
    !query || row.cells.some((value) => String(value).toLowerCase().includes(query)),
  )
})
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const pageRows = computed(() => filtered.value.slice(currentPage.value * pageSize, (currentPage.value + 1) * pageSize))
const selected = computed(() => review.value?.rows.find((row) => row.id === selectedId.value))
const nodes = computed(() => new Set(editor.document.nodes.map((node) => node.id)))
const knownUids = computed(() => new Set(editor.document.nodes.map((node) => node.uid ?? node.id)))
const validSelection = computed(() => selected.value?.nodeIds.filter((id) => nodes.value.has(id)) ?? [])
const missingNodes = computed(() => selected.value?.nodeIds.filter((id) => id > 0 && !nodes.value.has(id)) ?? [])
const missingUids = computed(() => selected.value?.nodeUids.filter((uid) => uid > 0 && !knownUids.value.has(uid)) ?? [])

watch(search, () => { currentPage.value = 0 })

/** 현재 화면이 요구한 자료에만 읽기 결과 반영 */
const applyReview = (file: { name: string; content: string }, format: BlockReviewType, id: number) => {
  if (request !== id) return
  review.value = readBlockReview(file.content, format)
  fileName.value = file.name
  currentPage.value = 0
  selectedId.value = undefined
}

watch([type, () => editor.projectToken, () => editor.sourceName], async ([format, token, name]) => {
  const id = ++request
  review.value = undefined
  selectedId.value = undefined
  fileName.value = error.value = search.value = ''
  loading.value = false
  if (!format || !token || !name.toLowerCase().endsWith('.jmapx') || !window.desktop?.readProjectBlockData) return
  loading.value = true
  try {
    const result = await window.desktop.readProjectBlockData(token, name, format)
    if (result) applyReview(result, format, id)
  } catch (cause) {
    if (request === id) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (request === id) loading.value = false
  }
})

/** 직접 선택한 원본 자료의 확장자와 크기 확인 후 검토 */
const openReviewFile = async (event: Event) => {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const format = type.value
  if (!file || !format) return
  const id = ++request
  loading.value = true
  error.value = ''
  try {
    if (!file.name.toLowerCase().endsWith('.' + format)) throw new Error('원본 자료의 확장자를 확인하세요.')
    if (file.size > MAX_FILE_BYTES) throw new Error('Block 자료가 32MB를 초과합니다.')
    applyReview({ name: file.name, content: await file.text() }, format, id)
  } catch (cause) {
    if (request === id) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (request === id) loading.value = false
  }
}

/** 선택한 Block의 유효한 지도 노드를 강조하고 첫 노드로 이동 */
const showOnMap = () => {
  const ids = validSelection.value
  if (!ids.length) return
  editor.selectedIds = ids
  editor.selectedId = ids[0]
  emit('focus', ids[0])
  type.value = null
}
</script>

<template>
  <v-dialog v-model="open" max-width="990">
    <v-card class="pa-4" data-testid="mgs-block-review">
      <div class="popup-drag-handle d-flex align-center justify-space-between ga-2">
        <strong>{{ type === 'blk' ? 'Verify Blocking Data' : 'Verify Block Data' }}</strong>
        <v-btn size="small" @click="type = null">Close</v-btn>
      </div>
      <div class="review-toolbar d-flex align-center flex-wrap ga-2 my-3">
        <v-btn size="small" :loading="loading" @click="fileInput?.click()">
          {{ type === 'blk' ? 'BLK Open' : 'FMD Open' }}
        </v-btn>
        <input ref="fileInput" class="d-none" type="file" :accept="'.' + type" @change="openReviewFile" />
        <span class="text-caption">{{ fileName || '원본 DATA 파일을 선택하세요' }}</span>
        <input v-if="review" v-model="search" class="review-search ml-auto"
          type="search" placeholder="IDX 또는 노드 검색" aria-label="Block 검색" />
      </div>
      <p v-if="error" class="text-error" role="alert">{{ error }}</p>
      <div v-if="review" class="review-table">
        <table>
          <thead><tr><th v-for="header in review.headers" :key="header">{{ header }}</th></tr></thead>
          <tbody>
            <tr v-for="row in pageRows" :key="row.id" :class="{ 'selected-review': row.id === selectedId }">
              <td><button type="button" @click="selectedId = row.id">{{ row.id }}</button></td>
              <td v-for="(cell, index) in row.cells.slice(1)" :key="index" @click="selectedId = row.id">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="selected" class="review-selection mt-2">
        <span>{{ selected.description }} · Node {{ selected.nodeIds.join(', ') || '—' }}</span>
        <p v-if="missingNodes.length || missingUids.length" class="text-error">
          없는 Node ID {{ missingNodes.join(', ') || '—' }} · 없는 UID {{ missingUids.join(', ') || '—' }}
        </p>
      </div>
      <div v-if="review" class="d-flex align-center justify-space-between flex-wrap ga-2 mt-3">
        <div class="d-flex align-center ga-2">
          <v-btn size="x-small" :disabled="currentPage <= 0" @click="currentPage--">Prev</v-btn>
          <span>{{ currentPage + 1 }} / {{ totalPages }} · {{ filtered.length }}</span>
          <v-btn size="x-small" :disabled="currentPage + 1 >= totalPages" @click="currentPage++">Next</v-btn>
        </div>
        <v-btn size="small" :disabled="!validSelection.length" @click="showOnMap">Draw</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss">
.review-table {
  max-height: min(52vh, 400px);
  overflow: auto;
  border: 1px solid var(--border);
}

.review-table table {
  min-width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: center;
  white-space: nowrap;
}

.review-table th {
  position: sticky;
  top: 0;
  background: var(--surface-muted);
}

.review-table :is(th, td) {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
}

.review-table button {
  color: var(--accent);
}

.selected-review {
  background: var(--accent-soft);
}

.review-search {
  width: min(210px, 100%);
  padding: 4px 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--input-bg);
  color: var(--text);
}

.review-selection {
  overflow-wrap: anywhere;
  font-size: 12px;
}
</style>

