<!--
/**
 * 파일명 WorkspaceHeader.vue
 * 설명 지도 파일 명령과 단축키 안내를 제공하는 리본 구성
 */
-->
<script setup lang="ts">
import { useEditor } from '@/features/map-editor/index.ts'
import { AppIcon } from '@/shared/ui/index.ts'

defineProps<{ busy: boolean }>()
const emit = defineEmits<{
  create: []
  open: []
  save: []
  saveAs: []
  help: []
  folder: []
}>()
const editor = useEditor()
const desktop = !!window.desktop

/** 설계 프로젝트 명령과 구별하여 표시하는 지도 파일 명령 정의 */
const commands = [
  { id: 'new-map', label: '새 지도', icon: 'new', action: () => emit('create') },
  { id: 'open-map', label: '지도 열기', icon: 'folder', title: '지도 열기 (Ctrl+O)', action: () => emit('open') },
  { id: 'save-map', label: '지도 저장', icon: 'save', title: '지도 저장 (Ctrl+S)', action: () => emit('save') },
  { id: 'save-map-as', label: '다른 위치 저장', icon: 'save', title: '다른 프로젝트 위치에 저장 (Ctrl+Shift+S)', action: () => emit('saveAs') },
  { id: 'open-folder', label: '프로젝트 폴더', icon: 'layers', title: 'RCS 또는 MAP 폴더의 최신 지도를 엽니다 (데스크톱 전용)', action: () => emit('folder') },
] as const
</script>

<template>
  <div class="design-ribbon-commands" role="group" aria-label="지도 파일 작업">
    <v-btn
      v-for="command in commands"
      :key="command.id"
      :data-testid="command.id"
      :title="'title' in command ? command.title : undefined"
      :disabled="busy || (command.id === 'save-map' && editor.readOnly) || (command.id === 'open-folder' && !desktop)"
      @click="command.action"
    >
      <AppIcon :name="command.icon" :size="20" />
      {{ command.label }}
    </v-btn>
    <v-btn title="단축키 도움말 (?)" @click="emit('help')">
      <AppIcon name="help" :size="20" />
      단축키 도움말
    </v-btn>
  </div>
</template>
