<!--
/**
 * 파일명: WorkspaceHeader.vue
 * 설명: 문서 이름과 변경 상태 및 파일 명령을 제공하는 작업 헤더
 * 작성자: 이희원
 * 작성일자: 2026-11-04
 */
-->
<script setup lang="ts">
import { useEditor } from '@/features/map-editor/index.ts'
import { AppIcon } from '@/shared/ui/index.ts'
defineProps<{
  busy: boolean
}>()
defineEmits<{
  create: []
  open: []
  save: []
  saveAs: []
  help: []
  folder: []
}>()
const editor = useEditor()
const desktop = !!window.desktop
</script>
<template>
  <header class="app-header flex-shrink-0 d-flex align-center">
    <div
      class="brand d-flex align-center flex-shrink-0"
      aria-label="TS_MGS 지도 편집기"
    >
      <span class="brand-mark"
        ><svg
          viewBox="0 0 32 32"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M7 24V8l9 10 9-10v16M7 8l18 16"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linejoin="round"
          />
          <circle
            cx="7"
            cy="8"
            r="3"
            fill="currentColor"
          />
          <circle
            cx="25"
            cy="24"
            r="3"
            fill="currentColor"
          /></svg
      ></span>
      <span
        ><strong>TS_MGS<span class="brand-dot">.</span></strong
        ><small>MAP ENGINEERING STUDIO</small></span
      >
    </div>
    <div class="header-divider"></div>
    <div class="header-document">
      <span class="header-eyebrow d-flex align-center"
        >WORKSPACE
        <AppIcon
          name="chevron"
          :size="11"
        />
        기준 지도</span
      >
      <div>
        <strong>{{ editor.sourceName }}</strong
        ><span
          v-if="editor.readOnly"
          class="document-badge readonly d-inline-flex align-center"
          ><AppIcon
            name="lock"
            :size="11"
          />
          읽기 전용</span
        ><span
          v-else
          class="document-badge d-inline-flex align-center"
          :class="{ modified: editor.dirty }"
          ><span class="state-dot flex-shrink-0"></span
          >{{ editor.dirty ? '저장하지 않음' : '저장됨' }}</span
        >
      </div>
    </div>
    <nav
      class="file-actions d-flex align-center ml-auto flex-shrink-0"
      aria-label="파일 작업"
    >
      <v-btn
        :disabled="busy"
        class="header-button"
        data-testid="new-map"
        @click="$emit('create')"
      >
        <AppIcon
          name="new"
          :size="17"
        />새 지도
      </v-btn>
      <v-btn
        :disabled="busy"
        class="header-button"
        data-testid="open-map"
        title="지도 열기 (Ctrl+O)"
        @click="$emit('open')"
      >
        <AppIcon
          name="folder"
          :size="18"
        />열기
      </v-btn>
      <v-btn
        :disabled="busy || editor.readOnly"
        class="save-button"
        data-testid="save-map"
        title="지도 저장 (Ctrl+S)"
        @click="$emit('save')"
      >
        <AppIcon
          name="save"
          :size="17"
        />{{ busy ? '처리 중…' : '지도 저장' }}<kbd>Ctrl S</kbd>
      </v-btn>
      <v-btn
        :disabled="busy"
        class="header-button"
        data-testid="save-map-as"
        title="다른 프로젝트 위치에 저장 (Ctrl+Shift+S)"
        @click="$emit('saveAs')"
        >다른 위치 저장</v-btn
      >
      <v-btn
        class="header-button folder-open"
        :disabled="busy || !desktop"
        data-testid="open-folder"
        title="RCS 또는 MAP 폴더의 최신 지도를 엽니다 (데스크톱 전용)"
        @click="$emit('folder')"
      >
        <AppIcon
          name="layers"
          :size="17"
        />폴더
      </v-btn>
    </nav>
    <v-btn
      class="header-help icon-button pa-0 flex-shrink-0"
      aria-label="단축키 도움말"
      title="단축키 도움말 (?)"
      @click="$emit('help')"
    >
      <AppIcon
        name="help"
        :size="19"
      />
    </v-btn>
    <div
      class="header-avatar"
      title="BEM Engineering"
    >
      B
    </div>
  </header>
</template>

<style scoped lang="scss">
// 화면 구성과 고유 시각 요소에 필요한 컴포넌트 전용 스타일

strong {
  font-weight: 600;
}
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
.state-dot {
  display: inline-block;
  height: 5px;
  width: 5px;
  border-radius: 50%;
  background: currentColor;
}
.app-header {
  height: 76px;
  gap: 22px;
  padding: 0 24px;
  background: var(--header);
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
}
.brand {
  gap: 11px;
  text-decoration: none;
  color: var(--text-secondary);
  width: 218px;
}
.brand-mark {
  width: 39px;
  height: 42px;
  background: var(--surface-muted);
  border-radius: 10px;
  padding: 5px;
  color: var(--accent);
  box-shadow: inset 0 0 0 1px #ffffff30;
}
.brand-mark svg {
  width: 100%;
  height: 100%;
}
.brand strong {
  font-size: 22px;
  letter-spacing: 1.2px;
  font-weight: 700;
}
.brand-dot {
  color: var(--accent);
}
.brand small {
  display: block;
  color: var(--text-secondary);
  letter-spacing: 1.9px;
  font-size: 7px;
  margin-top: 3px;
}
.header-divider {
  width: 1px;
  height: 31px;
  background: var(--surface-muted);
}
.header-document {
  min-width: 100px;
}
.header-eyebrow {
  gap: 7px;
  font-size: 9px;
  letter-spacing: 1px;
  color: var(--text-secondary);
}
.header-document > div {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 7px;
}
.header-document strong {
  max-width: 290px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}
.document-badge {
  color: var(--text-secondary);
  gap: 5px;
  white-space: nowrap;
  font-size: 10px;
}
.document-badge.modified {
  color: var(--text-secondary);
}
.document-badge.readonly {
  color: var(--text-secondary);
}
.file-actions {
  gap: 8px;
}
.file-actions button {
  height: 36px;
  padding: 0 13px;
  white-space: nowrap;
  font-size: 12px;
}
.file-actions .header-button {
  color: var(--text-secondary);
}
.file-actions .header-button:hover:not(:disabled) {
  background: var(--surface-muted);
}
.file-actions .save-button {
  background: var(--accent-fill);
  color: var(--on-accent);
  font-weight: 600;
  border-color: var(--border);
  padding: 0 15px;
  box-shadow: 0 2px 8px #061b2033;
}
.file-actions .save-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-fill) 85%, var(--surface));
}
.save-button kbd {
  background: var(--surface-muted);
  color: var(--text-secondary);
  border-color: var(--border);
  margin-left: 5px;
  font-size: 9px;
}
.header-help {
  color: var(--text-secondary);
}
.header-help:hover:not(:disabled) {
  background: var(--surface-muted);
}
.header-avatar {
  background: var(--surface-muted);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  width: 31px;
  height: 31px;
  border-radius: 50%;
  font-size: 12px;
  display: grid;
  place-items: center;
  margin-left: -9px;
}
@media (max-width: 1330px) {
  .app-header {
    gap: 14px;
    padding: 0 19px;
  }
  .brand {
    width: 190px;
  }
  .header-document strong {
    max-width: 200px;
  }
  .file-actions {
    gap: 2px;
  }
  .header-avatar {
    display: none;
  }
}
@media (max-height: 800px) {
  .app-header {
    height: 64px;
  }
}
</style>
