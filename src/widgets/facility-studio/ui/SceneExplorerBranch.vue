<!--
/**
 * 장면 탐색의 구조물 및 부착 모델 계층과 개별 선택을 표시하는 분기 구성
 */
-->
<script lang="ts">
/** 설계 문서에서 파생된 탐색 항목의 선택과 계층 정보 정의 */
export type SceneExplorerEntry = {
  id: string
  name: string
  kind: 'group' | 'instance' | 'floor' | 'opening'
  detail?: string
  parentId?: string
  selected?: boolean
  disabled?: boolean
  count?: number
  children?: SceneExplorerEntry[]
}
</script>

<script setup lang="ts">
defineProps<{ item: SceneExplorerEntry }>()
const emit = defineEmits<{ select: [item: SceneExplorerEntry, toggle: boolean] }>()
</script>

<template>
  <details v-if="item.children" open class="scene-branch" :data-scene-branch="item.id">
    <summary>
      <template v-if="item.kind === 'group'">{{ item.name }} <small>{{ item.count ?? item.children.length }}</small></template>
      <button v-else type="button" class="facility-row scene-parent"
        :data-scene-id="item.id"
        :aria-pressed="item.selected ?? false"
        @click.stop.prevent="emit('select', item, $event.shiftKey)">
        <strong>{{ item.name }}</strong>
        <small>{{ item.children.length }}</small>
      </button>
    </summary>
    <div class="scene-children">
      <SceneExplorerBranch v-for="child in item.children" :key="child.id" :item="child"
        @select="(entry, toggle) => emit('select', entry, toggle)" />
    </div>
  </details>
  <button v-else type="button" class="facility-row" :aria-pressed="item.selected ?? false"
    :data-scene-id="item.id"
    :disabled="item.disabled"
    @click="emit('select', item, $event.shiftKey)">
    <strong>{{ item.name }}</strong>
    <small v-if="item.detail">{{ item.detail }}</small>
  </button>
</template>

<style scoped>
/** 분기와 개별 행의 접기 및 선택 시각 처리 */
.scene-branch > summary {
  padding: 3px 4px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}
.scene-children { margin-inline-start: 12px; }
.facility-row {
  display: grid;
  gap: 2px;
  width: 100%;
  min-width: 0;
  padding: 4px 6px;
  border: 0;
  border-radius: var(--control-radius);
  background: transparent;
  text-align: start;
  cursor: pointer;
}
.scene-parent { display: inline-grid; width: calc(100% - 18px); grid-template-columns: minmax(0, 1fr) auto; }
.facility-row:hover { background: var(--hover); }
.facility-row[aria-pressed='true'] { background: var(--control-selected); color: var(--accent); }
.facility-row:focus-visible { outline-offset: -2px; }
.facility-row > * { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
small { color: var(--text-secondary); }
</style>
