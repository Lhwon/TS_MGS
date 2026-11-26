<!--
/**
 * 파일명: EditorToolbar.vue
 * 설명: 편집 도구와 실행 이력 및 지도 시점을 선택하는 도구 모음
 * 작성자: 이희원
 * 작성일자: 2026-10-20
 */
-->
<script setup lang="ts">
import { useEditor } from '@/features/map-editor/index.ts'
import type { Tool } from '@/features/map-editor/index.ts'
import { AppIcon } from '@/shared/ui/index.ts'
defineEmits<{ fit: [] }>()
const editor = useEditor()
const tools: {
  id: Tool
  icon: string
  name: string
  key: string
}[] = [
  { id: 'select', icon: 'select', name: '선택', key: 'V' },
  { id: 'add', icon: 'add', name: '노드', key: '' },
  { id: 'connect', icon: 'connect', name: '연결', key: 'C' },
]
</script>
<template>
  <div
    class="editor-toolbar d-flex align-center flex-shrink-0"
    role="toolbar"
    aria-label="지도 편집 도구"
  >
    <div class="tool-group d-flex ga-1">
      <v-btn
        v-for="tool in tools"
        :key="tool.id"
        :data-tool="tool.id"
        :class="{ active: editor.tool === tool.id }"
        :aria-label="tool.name"
        :aria-pressed="editor.tool === tool.id"
        :title="`${tool.name} (${tool.key})`"
        :disabled="editor.readOnly && ['add', 'connect'].includes(tool.id)"
        @click="editor.tool = tool.id"
      >
        <AppIcon
          :name="tool.icon"
          :size="18"
        /><span>{{ tool.name }}</span
        ><kbd>{{ tool.key }}</kbd>
      </v-btn>
    </div>
    <span class="toolbar-divider"></span>
    <div class="history-tools d-flex">
      <v-btn
        class="icon-button pa-0 flex-shrink-0"
        aria-label="실행 취소"
        title="실행 취소 (Ctrl+Z)"
        :disabled="!editor.canUndo"
        data-testid="undo"
        @click="editor.undo"
      >
        <AppIcon
          name="undo"
          :size="17" /></v-btn
      ><v-btn
        class="icon-button pa-0 flex-shrink-0"
        aria-label="다시 실행"
        title="다시 실행 (Ctrl+Shift+Z)"
        :disabled="!editor.canRedo"
        data-testid="redo"
        @click="editor.redo"
      >
        <AppIcon
          name="redo"
          :size="17" /></v-btn
      ><v-btn
        class="icon-button delete-tool pa-0 flex-shrink-0"
        aria-label="선택 노드 삭제"
        title="선택 노드 삭제 (Delete)"
        :disabled="editor.selectedId === null || editor.readOnly"
        @click="editor.removeSelected"
      >
        <AppIcon
          name="trash"
          :size="17"
        />
      </v-btn>
    </div>
    <v-btn
      class="ml-auto"
      data-testid="fit"
      @click="$emit('fit')"
      >전체 보기</v-btn
    >
  </div>
</template>

<style scoped lang="scss">
// 화면 구성과 고유 시각 요소에 필요한 컴포넌트 전용 스타일

kbd {
  font: 10px var(--font-mono);
  border: 1px solid var(--border);
  background: var(--surface-muted);
  border-radius: 4px;
  padding: 3px 5px;
  white-space: nowrap;
  color: var(--text-secondary);
}
.icon-button {
  width: 32px;
  height: 32px;
}
.editor-toolbar {
  gap: 10px;
  height: 58px;
  background: var(--surface);
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
}
.tool-group button {
  height: 34px;
  padding: 0 9px;
  color: var(--text-secondary);
  gap: 7px;
  font-size: 11px;
}
.tool-group button.active {
  font-weight: 600;
}
.tool-group kbd {
  border: 0;
  background: none;
  padding: 0;
  color: var(--text-muted);
  font-size: 8px;
}
.tool-group button.active kbd {
  color: var(--accent);
}
.toolbar-divider {
  height: 21px;
  width: 1px;
  background: var(--border);
}
.history-tools {
  gap: 2px;
  color: #7d929f;
}
.history-tools .icon-button {
  height: 30px;
  width: 29px;
}
.history-tools .delete-tool:hover:not(:disabled) {
  color: #bd5d5d;
  background: var(--surface);
}
.view-switch {
  padding: 3px;
  background: var(--surface-muted);
  border-radius: 6px;
  border: 1px solid var(--border);
}
.view-switch button {
  font-size: 10px;
  color: var(--text-secondary);
  height: 25px;
  padding: 0 9px;
  gap: 4px;
}
.view-switch button.active {
  font-weight: 600;
}
@media (max-width: 1330px) {
  .tool-group button {
    padding: 0 6px;
    gap: 5px;
  }
  .tool-group kbd {
    display: none;
  }
  .editor-toolbar {
    gap: 8px;
    padding: 0 10px;
  }
  .history-tools .icon-button {
    width: 26px;
  }
}
</style>
