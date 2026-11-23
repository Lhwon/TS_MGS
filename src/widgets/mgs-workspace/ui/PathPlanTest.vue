<!--
 * 파일명: PathPlanTest.vue
 * 설명: 지도에서 출발과 도착 노드를 선택하고 계획 경로와 차량 Bay를 확인하는 작업창
 * 작성자: 이희원
 * 작성일자: 2026-11-23
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { shortestMapPath, useEditor } from '@/features/map-editor/index.ts'

const editor = useEditor()
const showVirtual = ref(false)
const showCurve = ref(false)
const animate = ref(true)
const stepByStep = ref(false)
const bay = ref<number>()
const vehicleBays = ref<number[]>([])
const shownNodes = ref(0)

const nodesById = computed(() => new Map(editor.document.nodes.map((node) => [node.id, node])))
const result = computed(() => {
  const [start, goal] = editor.pathPlanTargets
  if (start === undefined || goal === undefined) return null
  try {
    if (start === goal) throw new Error('출발 노드와 도착 노드가 같습니다.')
    return { path: shortestMapPath(editor.document, start, goal, vehicleBays.value), error: '' }
  } catch (cause) {
    return { path: null, error: cause instanceof Error ? cause.message : String(cause) }
  }
})
const rows = computed(() =>
  (result.value?.path?.nodes ?? []).flatMap((id) => {
    const node = nodesById.value.get(id)
    if (!node || (node.curve && !showCurve.value) || (node.virtual && !node.curve && !showVirtual.value))
      return []
    return [node]
  }),
)

/** 시험용 노드와 화면 경로를 함께 초기화 */
const clear = () => {
  editor.pathPlanTargets = []
  editor.pathPlanPreview = []
}

/** 지정한 차량 Bay를 중복 없이 시험 범위에 추가 */
const addBay = () => {
  if (!Number.isSafeInteger(bay.value) || bay.value! < 1 || bay.value! > 999) return
  if (!vehicleBays.value.includes(bay.value!))
    vehicleBays.value = [...vehicleBays.value, bay.value!].sort((a, b) => a - b)
}

watch(
  [() => editor.pathPlanOpen, result, animate, stepByStep],
  ([open, route], _, onCleanup) => {
    const nodes = open ? route?.path?.nodes ?? [] : []
    shownNodes.value = animate.value || stepByStep.value ? Math.min(nodes.length, 1) : nodes.length
    if (!stepByStep.value && animate.value && nodes.length > shownNodes.value) {
      const timer = window.setInterval(() => {
        shownNodes.value++
        if (shownNodes.value >= nodes.length) window.clearInterval(timer)
      }, 85)
      onCleanup(() => window.clearInterval(timer))
    }
  },
  { immediate: true },
)
watch([result, shownNodes, () => editor.pathPlanOpen], ([route, count, open]) => {
  editor.pathPlanPreview = open ? (route?.path?.nodes.slice(0, count) ?? []) : []
})
watch(() => editor.mapRevision, clear)
onBeforeUnmount(() => {
  editor.pathPlanOpen = false
  clear()
})
</script>

<template>
  <v-dialog
    v-model="editor.pathPlanOpen"
    :scrim="false"
    :retain-focus="false"
    scroll-strategy="none"
    content-class="mgs-path-plan-overlay"
    max-width="720"
    persistent
    @keydown.esc="editor.pathPlanOpen = false"
  >
    <v-card class="pa-4" data-testid="path-plan-test">
      <div class="popup-drag-handle d-flex justify-space-between align-center ga-2">
        <strong>Path Planning Test</strong>
        <v-btn size="small" @click="editor.pathPlanOpen = false">Close</v-btn>
      </div>
      <div class="planning-content mt-3">
        <div class="planning-result">
          <p class="mb-3 text-body-2">
            {{ editor.pathPlanTargets.length === 1 ? '지도에서 도착 노드를 선택하세요.' : '지도에서 출발 노드와 도착 노드를 차례대로 선택하세요.' }}
          </p>
          <p v-if="editor.pathPlanTargets.length" class="mb-2">
            Start N{{ editor.pathPlanTargets[0] }}
            <span v-if="editor.pathPlanTargets.length > 1"> → N{{ editor.pathPlanTargets[1] }}</span>
          </p>
          <p v-if="result?.error" class="text-error" role="alert">{{ result.error }}</p>
          <div v-if="result?.path" class="planning-table">
            <p class="mb-2">{{ Math.round(result.path.distance).toLocaleString() }} {{ result.path.units }}</p>
            <table>
              <thead><tr><th>Order</th><th>Node ID</th><th>Real ID</th></tr></thead>
              <tbody>
                <tr v-for="(node, index) in rows" :key="node.id">
                  <td>{{ index + 1 }}</td><td>{{ node.id }}</td><td>{{ node.realId ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="planning-options d-flex flex-column ga-2">
          <label title="원본 Block PP 엔진 이관 중"><input type="checkbox" disabled /> Use Block PP</label>
          <label><input v-model="animate" type="checkbox" /> Use Animation</label>
          <label><input v-model="stepByStep" type="checkbox" /> One step by step</label>
          <label><input v-model="showVirtual" type="checkbox" /> Show Virtual Node</label>
          <label><input v-model="showCurve" type="checkbox" /> Show Curve Node</label>
          <v-btn
            v-if="stepByStep"
            size="small"
            :disabled="!result?.path || shownNodes >= result.path.nodes.length"
            @click="shownNodes++"
          >Next</v-btn>
          <fieldset class="vehicle-bay pa-2">
            <legend>Vehicle Bay</legend>
            <p class="text-caption">{{ vehicleBays.join(', ') || 'All' }}</p>
            <form class="d-flex ga-1 my-1" @submit.prevent="addBay">
              <input v-model.number="bay" type="number" min="1" max="999" aria-label="Vehicle Bay" />
              <v-btn type="submit" size="x-small">Add</v-btn>
            </form>
            <v-btn size="x-small" :disabled="!vehicleBays.length" @click="vehicleBays = []">Clear</v-btn>
          </fieldset>
          <v-btn size="small" @click="clear">Path Clear</v-btn>
        </div>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss">
:global(.mgs-path-plan-overlay) {
  align-self: flex-end;
  margin-block-end: 36px;
  margin-inline-end: auto;
}

.planning-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(144px, 176px);
  gap: 12px;
  max-height: min(58vh, 360px);
  overflow: auto;
  font-size: 12px;
}

.planning-table {
  max-height: 230px;
  overflow: auto;
}

.planning-table table {
  width: 100%;
  border-collapse: collapse;
}

.planning-table :is(th, td) {
  border-bottom: 1px solid var(--border);
  padding: 4px 6px;
  text-align: start;
}

.vehicle-bay {
  border: 1px solid var(--border);
  border-radius: 6px;
}

.vehicle-bay input {
  width: 60px;
  min-width: 0;
  padding-inline: 4px;
  background: var(--input-bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
}
</style>

