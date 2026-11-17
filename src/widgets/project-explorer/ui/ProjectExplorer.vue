<!--
/**
 * 파일명: ProjectExplorer.vue
 * 설명: 지도 노드와 포트 검색 및 표시 레이어를 관리하는 탐색 패널
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useEditor } from '@/features/map-editor/index.ts'
import { AppIcon } from '@/shared/ui/index.ts'
import type { Layers } from '@/entities/map/index.ts'
const props = defineProps<{
  layers: Layers
}>()
const emit = defineEmits<{
  focus: [id: number]
  sample: []
  layer: [key: keyof Layers, value: boolean]
}>()
const editor = useEditor()
const search = ref('')
const tab = ref<'nodes' | 'ports'>('nodes')
watch(
  () => editor.mapRevision,
  () => {
    search.value = ''
    tab.value = 'nodes'
  },
)
const list = ref<HTMLElement>()
watch(
  () => [editor.selectedId, tab.value],
  async () => {
    await nextTick()
    if (tab.value === 'nodes')
      list.value?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' })
  },
)
const filteredNodes = computed(() =>
  editor.document.nodes.filter((node) =>
    `${node.id} ${node.name} ${node.realId ?? ''} ${node.uid ?? ''}`
      .toLowerCase()
      .includes(search.value.trim().toLowerCase()),
  ),
)
const filteredPorts = computed(() =>
  editor.document.ports.filter((port) =>
    `${port.id} ${port.name}`.toLowerCase().includes(search.value.trim().toLowerCase()),
  ),
)
const layerNames: {
  id: keyof Layers
  name: string
  icon: string
}[] = [
  { id: 'nodes', name: '노드', icon: 'node' },
  { id: 'edges', name: '경로', icon: 'connect' },
  { id: 'ports', name: '포트', icon: 'port' },
  { id: 'labels', name: '라벨', icon: 'text' },
  { id: 'grid', name: '그리드', icon: 'grid' },
  { id: 'rulers', name: '눈금자', icon: 'grid' },
]
const identityLayers: {
  id: keyof Layers
  name: string
}[] = [
  { id: 'realIds', name: 'Real ID' },
  { id: 'nodeIds', name: 'Node ID' },
  { id: 'uniqueIds', name: 'Unique ID' },
  { id: 'positions', name: '좌표' },
  { id: 'virtualLabels', name: '가상 노드' },
]
/**
 * 선택한 노드 식별자를 저장하고 해당 위치로 화면 이동을 요청하는 노드 선택
 *
 * @param id 조회하거나 편집할 대상의 고유 식별자
 */
const select = (id: number) => {
  editor.selectedId = id
  emit('focus', id)
}
</script>
<template>
  <v-sheet
    tag="aside"
    class="explorer-panel d-flex flex-column overflow-hidden overflow-y-auto"
  >
    <div class="panel-title d-flex align-center justify-space-between flex-shrink-0 py-0 px-5">
      <h2>프로젝트</h2>
      <span class="panel-caption">EXPLORER</span>
    </div>
    <div class="project-card d-flex align-center">
      <div class="project-glyph flex-shrink-0">
        <AppIcon
          name="layers"
          :size="23"
        />
      </div>
      <div>
        <strong :title="editor.document.name">{{ editor.document.name }}</strong
        ><small
          ><span class="state-dot flex-shrink-0"></span
          >{{ editor.readOnly ? '기존 MGS 미리보기' : '로컬 프로젝트' }}</small
        >
      </div>
    </div>
    <div
      class="object-tabs d-flex ga-1"
      role="tablist"
      aria-label="지도 객체 유형"
    >
      <v-btn
        id="nodes-tab"
        role="tab"
        aria-controls="object-list"
        :aria-selected="tab === 'nodes'"
        :class="{ active: tab === 'nodes' }"
        @click="tab = 'nodes'"
      >
        <AppIcon
          name="node"
          :size="15"
        />노드<span data-testid="node-count">{{ editor.document.nodes.length }}</span></v-btn
      ><v-btn
        id="ports-tab"
        role="tab"
        aria-controls="object-list"
        :aria-selected="tab === 'ports'"
        :class="{ active: tab === 'ports' }"
        data-testid="ports-tab"
        @click="tab = 'ports'"
      >
        <AppIcon
          name="port"
          :size="15"
        />포트<span>{{ editor.document.ports.length }}</span>
      </v-btn>
    </div>
    <div class="search-field d-flex align-center">
      <AppIcon
        name="search"
        :size="17"
      /><input
        v-model="search"
        :aria-label="tab === 'nodes' ? '노드 검색' : '포트 검색'"
        :placeholder="tab === 'nodes' ? '노드 이름 또는 ID 검색' : '포트 이름 또는 ID 검색'"
      /><v-btn
        v-if="search"
        class="icon-button pa-0 flex-shrink-0"
        aria-label="검색 초기화"
        @click="search = ''"
      >
        <AppIcon
          name="close"
          :size="13"
        />
      </v-btn>
    </div>
    <div class="list-heading d-flex justify-space-between">
      <span>{{ tab === 'nodes' ? '이름 / 좌표' : '포트 / 연결 노드' }}</span
      ><span>{{ tab === 'nodes' ? filteredNodes.length : filteredPorts.length }}개</span>
    </div>
    <div
      ref="list"
      id="object-list"
      class="object-list overflow-auto"
      role="tabpanel"
      :aria-labelledby="tab === 'nodes' ? 'nodes-tab' : 'ports-tab'"
      tabindex="0"
    >
      <template v-if="tab === 'nodes'"
        ><v-btn
          v-for="node in filteredNodes.slice(0, 120)"
          :key="node.id"
          class="object-row d-flex w-100 align-center text-start"
          :class="{ selected: editor.selectedId === node.id }"
          :data-node-id="node.id"
          :aria-pressed="editor.selectedId === node.id"
          @click="select(node.id)"
        >
          <span class="object-symbol flex-shrink-0"
            ><AppIcon
              name="node"
              :size="16" /></span
          ><span class="object-details d-flex flex-column ga-1"
            ><strong>{{ node.name || `N${node.id}` }}</strong
            ><small>{{
              node.realId === undefined
                ? `${node.x.toLocaleString()}, ${node.y.toLocaleString()}`
                : `R${node.realId} · U${node.uid ?? '—'}`
            }}</small></span
          ><span class="object-id ml-auto">#{{ node.id }}</span
          ><AppIcon
            v-if="editor.selectedId === node.id"
            name="chevron"
            :size="13"
          />
        </v-btn>
        <div
          v-if="!filteredNodes.length"
          class="list-empty d-flex flex-column align-center ga-3 text-center"
        >
          <AppIcon
            name="search"
            :size="24"
          /><strong>노드를 찾을 수 없습니다</strong
          ><span>검색어를 바꾸거나 노드를 추가하세요.</span>
        </div>
        <p
          v-if="filteredNodes.length > 120"
          class="list-limit text-center my-3 mx-0"
        >
          상위 120개 표시 · 검색으로 좁히세요
        </p></template
      >
      <template v-else
        ><v-btn
          v-for="port in filteredPorts.slice(0, 120)"
          :key="port.id"
          class="object-row port-row d-flex w-100 align-center text-start"
          :class="{ selected: editor.selectedId === port.nodeId }"
          :data-port-id="port.id"
          @click="select(port.nodeId)"
        >
          <span class="object-symbol flex-shrink-0"
            ><AppIcon
              name="port"
              :size="16" /></span
          ><span class="object-details d-flex flex-column ga-1"
            ><strong>{{ port.id }}</strong
            ><small>{{ port.name }}</small></span
          ><span class="object-id ml-auto">N{{ port.nodeId }}</span>
        </v-btn>
        <div
          v-if="!filteredPorts.length"
          class="list-empty d-flex flex-column align-center ga-3 text-center"
        >
          <AppIcon
            name="port"
            :size="24"
          /><strong>표시할 포트가 없습니다</strong><span>포트는 지도 파일에서 불러옵니다.</span>
        </div>
        <p
          v-if="filteredPorts.length > 120"
          class="list-limit text-center my-3 mx-0"
        >
          상위 120개 표시 · 검색으로 좁히세요
        </p></template
      >
    </div>
    <div
      v-if="editor.document.legacy"
      class="legacy-source-info flex-shrink-0 d-flex flex-column"
      data-testid="legacy-summary"
    >
      <strong>MGS Ver.{{ editor.document.legacy.version }}</strong
      ><span>원본 노드 {{ editor.document.legacy.nodeRecords.toLocaleString() }}개 레코드</span
      ><span
        >고유 노드 {{ editor.document.nodes.length.toLocaleString() }}개 · 연결
        {{ editor.document.edges.length.toLocaleString() }}개</span
      >
    </div>
    <details
      class="layer-section flex-shrink-0"
      open
    >
      <summary>
        <AppIcon
          name="layers"
          :size="16"
        /><strong>표시 레이어</strong
        ><AppIcon
          class="details-chevron ml-auto"
          name="down"
          :size="13"
        />
      </summary>
      <div class="layer-options">
        <label
          v-for="layer in layerNames"
          :key="layer.id"
          class="layer-option d-flex align-center"
          :class="{ enabled: props.layers[layer.id] }"
          ><AppIcon
            :name="layer.icon"
            :size="15" /><span>{{ layer.name }}</span
          ><input
            type="checkbox"
            :checked="props.layers[layer.id]"
            :aria-label="`${layer.name} 표시`"
            @change="emit('layer', layer.id, ($event.target as HTMLInputElement).checked)"
        /></label>
      </div>
    </details>
    <details class="layer-section identity-section flex-shrink-0">
      <summary>
        <AppIcon
          name="text"
          :size="16"
        /><strong>ID·좌표 표시</strong
        ><AppIcon
          class="details-chevron ml-auto"
          name="down"
          :size="13"
        />
      </summary>
      <div class="layer-options">
        <label
          v-for="layer in identityLayers"
          :key="layer.id"
          class="layer-option d-flex align-center"
          :class="{ enabled: props.layers[layer.id] }"
          ><span>{{ layer.name }}</span
          ><input
            type="checkbox"
            :checked="props.layers[layer.id]"
            :aria-label="`${layer.name} 표시`"
            @change="emit('layer', layer.id, ($event.target as HTMLInputElement).checked)"
        /></label>
      </div>
    </details>
    <v-btn
      class="sample-button d-flex justify-start flex-shrink-0"
      @click="$emit('sample')"
    >
      <AppIcon
        name="refresh"
        :size="15"
      />샘플 지도 열기<AppIcon
        name="arrow"
        :size="14"
      />
    </v-btn>
  </v-sheet>
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
summary:focus-visible {
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
.icon-button {
  width: 32px;
  height: 32px;
}
.state-dot {
  display: inline-block;
  height: 5px;
  width: 5px;
  border-radius: 50%;
  background: currentColor;
}
.explorer-panel {
  background: var(--surface);
  min-height: 0;
}
.explorer-panel {
  border-right: 1px solid var(--border);
}
.panel-title {
  height: 58px;
}
.panel-title h2 {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.3px;
}
.panel-title > svg {
  color: var(--text-secondary);
}
.panel-caption {
  font-size: 8px;
  letter-spacing: 1.1px;
  color: var(--text-secondary);
}
.project-card {
  gap: 10px;
  margin: 0 14px 20px;
  padding: 13px 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-muted);
}
.project-glyph {
  width: 35px;
  height: 37px;
  border-radius: 7px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  display: grid;
  place-items: center;
}
.project-card > div:last-child {
  min-width: 0;
}
.project-card strong {
  display: block;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.project-card small {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 6px;
}
.project-card .state-dot {
  width: 4px;
  height: 4px;
}
.object-tabs {
  background: var(--surface);
  margin: 0 15px 15px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 7px;
}
.object-tabs button {
  flex: 1;
  padding: 7px 4px;
  color: var(--text-secondary);
  font-size: 11px;
  gap: 5px;
  border-radius: 5px;
}
.object-tabs button.active {
  color: var(--accent);
  background: var(--accent-soft);
  box-shadow: none;
  font-weight: 600;
}
.object-tabs button :deep(.v-btn__content) > span {
  font: 10px var(--font-mono);
  color: var(--text-secondary);
  margin-left: 3px;
}
.object-tabs button.active > span {
  color: var(--text-secondary);
}
.search-field {
  gap: 7px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 6px;
  padding: 0 9px;
  margin: 0 15px 16px;
  height: 36px;
  color: var(--text-secondary);
}
.search-field input {
  border: 0;
  background: transparent;
  padding: 6px 0;
  font-size: 11px;
}
.search-field input::placeholder {
  color: var(--text-secondary);
}
.search-field .icon-button {
  width: 20px;
  height: 22px;
}
.list-heading {
  color: var(--text-secondary);
  font-size: 9px;
  padding: 0 22px 8px;
}
.object-list {
  flex: 1;
  min-height: 80px;
  padding: 0 9px 10px;
}
.object-row {
  gap: 9px;
  height: 52px;
  border-radius: 6px;
  padding: 7px 10px;
  border: 1px solid transparent;
  margin-bottom: 3px;
}
.object-symbol {
  height: 28px;
  width: 28px;
  display: grid;
  place-items: center;
  background: var(--surface);
  color: var(--text-secondary);
  border-radius: 6px;
}
.object-details {
  min-width: 0;
}
.object-details strong {
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
.object-details small {
  color: var(--text-secondary);
  font: 10px var(--font-mono);
  white-space: nowrap;
}
.object-id {
  color: var(--text-secondary);
  font: 9px var(--font-mono);
}
.object-row.selected {
  background: var(--surface-muted);
  border-color: var(--border);
  color: var(--text-secondary);
}
.object-row.selected .object-symbol {
  background: var(--surface-muted);
  color: var(--text-secondary);
}
.object-row.selected .object-details small {
  color: var(--text-secondary);
}
.object-row.selected .object-id {
  color: var(--text-secondary);
}
.object-row.selected > svg {
  color: var(--text-secondary);
  margin-left: -5px;
}
.port-row .object-symbol {
  color: var(--text-secondary);
  background: var(--surface);
}
.list-empty {
  padding: 35px 5px;
  color: var(--text-secondary);
}
.list-empty strong {
  font-size: 11px;
  color: var(--text-secondary);
}
.list-empty span {
  font-size: 10px;
  color: var(--text-secondary);
}
.list-limit {
  color: var(--text-secondary);
  font-size: 10px;
}
.layer-section {
  border-top: 1px solid var(--border);
  padding: 0 18px 14px;
}
.layer-section summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 17px 0 12px;
  color: var(--text-secondary);
}
.layer-section summary::-webkit-details-marker {
  display: none;
}
.layer-section summary strong {
  font-size: 11px;
  color: var(--text-secondary);
}
.details-chevron {
  transition: transform 0.2s;
}
.layer-section:not([open]) .details-chevron {
  transform: rotate(-90deg);
}
.layer-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 11px;
}
.layer-option {
  gap: 6px;
  padding: 5px 0;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}
.layer-option.enabled {
  color: var(--text-secondary);
}
.layer-option input {
  margin: 0 0 0 auto;
  width: 12px;
  height: 12px;
}
.sample-button {
  margin: 0 15px 14px;
  border: 1px solid var(--border);
  padding: 10px;
  font-size: 10px;
  color: var(--text-secondary);
}
.sample-button :deep(.v-btn__content) > svg:last-child {
  margin-left: auto;
}
.legacy-source-info {
  gap: 5px;
  padding: 12px 18px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 10px;
}
.legacy-source-info strong {
  color: var(--text-secondary);
  font-size: 11px;
}
.identity-section {
  border-top-style: dashed;
}
@media (max-height: 800px) {
  .project-card {
    margin-bottom: 13px;
  }
  .object-tabs {
    margin-bottom: 11px;
  }
  .search-field {
    margin-bottom: 11px;
  }
  .layer-section {
    padding-bottom: 10px;
  }
  .layer-section summary {
    padding-top: 12px;
  }
  .layer-option {
    padding: 2px 0;
  }
}
</style>
