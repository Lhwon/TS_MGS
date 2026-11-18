<!--
/**
 * 파일명: MgsSummary.vue
 * 설명: 원본 Summary의 미니맵과 프로젝트 정보 및 노드와 포트 검색 화면
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { mapObjectColor } from '@/entities/map/index.ts'
import { useEditor } from '@/features/map-editor/index.ts'
const emit = defineEmits<{ focus: [id: number] }>()
const editor = useEditor()
const miniatureSvg = ref<SVGSVGElement>()
const findBy = ref<'id' | 'realId' | 'uid'>('realId')
const findId = ref(1)
const portId = ref('')
const bounds = computed(() => {
  const nodes = editor.document.nodes
  const minX = nodes.length ? Math.min(...nodes.map((node) => node.x)) : 0
  const minY = nodes.length ? Math.min(...nodes.map((node) => node.y)) : 0
  const width = Math.max(1000, ...nodes.map((node) => node.x - minX))
  const height = Math.max(1000, ...nodes.map((node) => node.y - minY))
  const scale = 230 / Math.max(width, height)
  return { minX, minY, width, height, scale }
})
const nodesById = computed(() => new Map(editor.document.nodes.map((node) => [node.id, node])))
const miniature = computed(() =>
  editor.document.edges
    .map((edge) => {
      const from = nodesById.value.get(edge.from)!,
        to = nodesById.value.get(edge.to)!
      const b = bounds.value
      return `M${10 + (from.x - b.minX) * b.scale},${250 - (from.y - b.minY) * b.scale}L${10 + (to.x - b.minX) * b.scale},${250 - (to.y - b.minY) * b.scale}`
    })
    .join(''),
)

/**
 * 검색한 객체의 노드를 선택하고 지도 중심으로 이동하는 검색 결과 적용
 * @param id 검색한 노드 식별자
 */
const focus = (id: number | undefined) => {
  if (id === undefined) {
    editor.message = '찾는 객체가 없습니다.'
    return
  }
  editor.selectedId = id
  emit('focus', id)
}

/**
 * 원본 식별자 종류에 따라 노드를 조회하는 노드 검색
 */
const findNode = () =>
  focus(editor.document.nodes.find((node) => node[findBy.value] === Number(findId.value))?.id)

/**
 * 입력한 포트 식별자의 연결 노드로 이동하는 포트 검색
 */
const findPort = () => focus(editor.document.ports.find((port) => port.id === portId.value)?.nodeId)

/**
 * 미니맵에서 클릭한 지점과 가장 가까운 노드를 찾는 전체 지도 탐색
 * @param event 미니맵 클릭 좌표
 */
const overview = (event: MouseEvent) => {
  const svg = event.currentTarget as SVGElement
  const rect = svg.getBoundingClientRect()
  const x = ((event.clientX - rect.left) * 260) / rect.width
  const y = ((event.clientY - rect.top) * 270) / rect.height
  const b = bounds.value
  const nearest = editor.document.nodes.reduce<{ id: number; distance: number } | undefined>(
    (best, node) => {
      const distance = Math.hypot(
        10 + (node.x - b.minX) * b.scale - x,
        250 - (node.y - b.minY) * b.scale - y,
      )
      return !best || distance < best.distance ? { id: node.id, distance } : best
    },
    undefined,
  )
  focus(nearest?.id)
}
/** 미니맵의 현재 축척과 밝기를 PNG로 추출하는 원본 캡처 */
const capture = async () => {
  if (!miniatureSvg.value) return
  const clone = miniatureSvg.value.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', '260')
  clone.setAttribute('height', '270')
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }),
  )
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 520
    canvas.height = 540
    const context = canvas.getContext('2d')!
    context.fillStyle = '#' + editor.theme.background.toString(16).padStart(6, '0')
    context.fillRect(0, 0, 520, 540)
    context.drawImage(image, 0, 0, 520, 540)
    const anchor = document.createElement('a')
    anchor.href = canvas.toDataURL('image/png')
    anchor.download = editor.sourceName.replace(/\.[^.]+$/, '') + '_minimap.png'
    anchor.click()
  } catch (cause) {
    editor.message = cause instanceof Error ? cause.message : String(cause)
  } finally {
    URL.revokeObjectURL(url)
  }
}

defineExpose({ capture })
</script>

<template>
  <aside
    class="mgs-summary d-flex flex-column overflow-y-auto"
    data-testid="mgs-summary"
  >
    <div class="summary-tab px-3 d-flex align-center flex-shrink-0">Summary</div>
    <div class="mini-map ma-2 flex-shrink-0">
      <svg
        ref="miniatureSvg"
        viewBox="0 0 260 270"
        role="img"
        aria-label="전체 지도 미니맵"
        @click="overview"
      >
        <path
          :d="miniature"
          fill="none"
          :stroke="'#' + editor.theme.bothWays.toString(16).padStart(6, '0')"
          stroke-width="1"
        />
        <rect
          v-for="port in editor.document.ports"
          :key="port.id"
          :x="10 + (port.x - bounds.minX) * bounds.scale - 2"
          :y="250 - (port.y - bounds.minY) * bounds.scale - 2"
          width="4"
          height="4"
          fill="none"
          :stroke="
            '#' +
            mapObjectColor(port.strokeColor ?? 0, editor.theme)
              .toString(16)
              .padStart(6, '0')
          "
          stroke-width="0.6"
        />
      </svg>
    </div>
    <div class="pa-2 flex-shrink-0">
      <dl class="project-information pa-2">
        <dt>Project Name</dt>
        <dd>{{ editor.document.name }}</dd>
        <dt>AGV Type</dt>
        <dd>—</dd>
        <dt>ACS Name</dt>
        <dd>—</dd>
        <dt>Map Name</dt>
        <dd>{{ editor.sourceName }}</dd>
        <dt>Map Version</dt>
        <dd>{{ editor.document.legacy?.version ?? 25 }}</dd>
      </dl>
      <form
        class="mt-3"
        @submit.prevent="findNode"
      >
        <div class="d-flex flex-wrap ga-2 px-1 mb-2">
          <label
            v-for="(label, key) in { id: 'Node ID', realId: 'Real ID', uid: 'UID' }"
            :key="key"
            class="d-flex ga-1 align-center"
          >
            <input
              v-model="findBy"
              type="radio"
              :value="key"
            />
            {{ label }}
          </label>
        </div>
        <div class="d-flex ga-2">
          <input
            v-model.number="findId"
            type="number"
            min="1"
            class="find-input"
            aria-label="노드 식별자 검색"
          />
          <v-btn
            type="submit"
            size="small"
            data-testid="mgs-find-node"
          >
            Find
          </v-btn>
        </div>
      </form>
      <form
        class="mt-4"
        @submit.prevent="findPort"
      >
        <label for="mgs-port-id">Port ID</label>
        <div class="d-flex ga-2 mt-2">
          <input
            id="mgs-port-id"
            v-model="portId"
            list="mgs-port-list"
            class="find-input"
          />
          <datalist id="mgs-port-list">
            <option
              v-for="port in editor.document.ports"
              :key="port.id"
              :value="port.id"
            />
          </datalist>
          <v-btn
            type="submit"
            size="small"
          >
            Find
          </v-btn>
        </div>
      </form>
      <div class="mt-4 text-caption">
        Node : {{ editor.document.nodes.length.toLocaleString() }} &nbsp; Path :
        {{ editor.document.edges.length.toLocaleString() }}
        <br />
        Port : {{ editor.document.ports.length.toLocaleString() }} &nbsp; Shape :
        {{ editor.document.shapes?.length ?? 0 }}
      </div>
    </div>
  </aside>
</template>

<style scoped lang="scss">
// 창 높이에 맞춰 미니맵과 검색 내용을 함께 탐색하는 요약 영역 배치
.mgs-summary {
  min-height: 0;
  border-right: 1px solid var(--mgs-border);
  background: var(--mgs-panel);
  font-size: 12px;
}
.summary-tab {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--text-secondary);
  font-weight: 600;
  height: 30px;
  border-bottom: 1px solid var(--mgs-border);
  background: var(--mgs-tab);
}
.mini-map {
  height: clamp(104px, 22vh, 214px);
  background: var(--canvas);
  border: 1px solid var(--mgs-border);
  border-radius: 9px;
}
.mini-map svg {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}
.project-information {
  display: grid;
  grid-template-columns: minmax(68px, 42%) minmax(0, 1fr);
  gap: 4px 8px;
  border: 1px solid var(--mgs-border);
  border-radius: 9px;
}
.project-information dt {
  color: var(--text-secondary);
  font-size: 11px;
}
.project-information dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.find-input {
  flex: 1;
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 3px 7px;
  border: 1px solid var(--mgs-border);
  border-radius: 7px;
  color: inherit;
  background: var(--input-bg);
}
</style>
