<!--
/**
 * 파일명: StudioPage.vue
 * 설명: 지도와 설비 편집 화면 및 파일 작업과 단축키를 조합하는 편집 페이지
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
-->
<script setup lang="ts">
import {
  computed,
  nextTick,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue'
import { AiAssistant } from '@/widgets/ai-assistant/index.ts'
import { WorkspaceHeader } from '@/widgets/workspace-header/index.ts'
import { MgsWorkspace } from '@/widgets/mgs-workspace/index.ts'
import { NodeInspector, MapObjectEditor } from '@/widgets/node-inspector/index.ts'
import { MapViewport } from '@/widgets/map-canvas/index.ts'
import { useEditor, useMapFiles, MapSaveDialog } from '@/features/map-editor/index.ts'
import type { Tool, NativeSaveOptions } from '@/features/map-editor/index.ts'
import type { Layers } from '@/entities/map/index.ts'
import { DEFAULT_LAYERS } from '@/entities/map/index.ts'
import { registerAppCommands, type AppCommand } from '@/shared/lib/input/index.ts'
import { AppIcon, TextAction } from '@/shared/ui/index.ts'
import { useFacilityEditor } from '@/features/facility-editor/index.ts'
import {
  parseFacilitySceneFile,
} from '@/entities/facility/index.ts'
const FacilityStudio = defineAsyncComponent(() =>
  import('@/widgets/facility-studio/index.ts').then((module) => module.FacilityStudio),
)
const editor = useEditor()
const facility = useFacilityEditor()
const assistantOpen = ref(false)
const mode = ref<'map' | 'facility'>('map')
/** 실제 도면 축척이 확정된 맵의 설비 배치 화면 전환 */
const openFacility = () => {
  if (editor.document.units === 'px') {
    editor.message = '도면의 기준 거리를 지정해 mm 축척을 확정한 후 3D 배치를 사용하세요.'
    return
  }
  mode.value = 'facility'
}

/** 도면 생성과 축척 보정 이후 맵 화면을 표시하고 전체 도면으로 맞추는 화면 갱신 */
/** 인식 객체와 가장 가까운 노드를 화면 중심에 배치하는 도면 포커스 */
const focusDrawingObject = async (point: { x: number; y: number }) => {
  mode.value = 'map'
  await nextTick()
  const node = editor.document.nodes.reduce(
    (nearest, current) =>
      !nearest ||
      Math.hypot(current.x - point.x, current.y - point.y) <
        Math.hypot(nearest.x - point.x, nearest.y - point.y)
        ? current
        : nearest,
    undefined as (typeof editor.document.nodes)[number] | undefined,
  )
  if (node) canvas.value?.focus(node.id)
}
const showGeneratedMap = async () => {
  mode.value = 'map'
  await nextTick()
  canvas.value?.fit()
}
const modelDraftDirty = ref(false)
watch(
  () => editor.dirty || facility.dirty || modelDraftDirty.value,
  (dirty) => window.desktop?.setDirty(dirty),
  { immediate: true },
)
/** 이차원 지도 교체 중에도 독립 삼차원 설계와 편집 상태 유지 */
const files = useMapFiles(() => !facility.busy)
const saveDialogOpen = ref(false),
  saveToNewProject = ref(false),
  saveProjectToken = ref<string>()
/** 원본 지도는 저장 항목을 구성하고 전용 JSON은 기존 방식으로 저장하는 파일 명령 */
const requestSave = async (saveAs = false) => {
  if (files.busy.value || editor.readOnly) return
  if (editor.document.units === 'px') {
    editor.message = '도면의 기준 길이로 축척을 확정한 후 JMAPX를 저장하세요.'
    return
  }
  if (
    mode.value === 'map' &&
    (editor.legacySource || editor.sourceName.toLowerCase().endsWith('.jmapx'))
  ) {
    saveToNewProject.value = saveAs
    saveProjectToken.value = undefined
    if (window.desktop?.selectSaveProject && (saveAs || !editor.projectToken)) {
      files.busy.value = true
      try {
        const target = await window.desktop.selectSaveProject()
        if (!target) return
        saveProjectToken.value = target
      } catch (cause) {
        editor.message = cause instanceof Error ? cause.message : String(cause)
        return
      } finally {
        files.busy.value = false
      }
    }
    saveDialogOpen.value = true
  } else void files.save(saveAs)
}
/** 같은 문서 스냅샷의 부가 데이터를 생성하고 새 버전의 저장 성공 후 창을 닫는 저장 실행 */
const saveWithOptions = async (options: NativeSaveOptions) => {
  if (await files.save(saveToNewProject.value, false, options, saveProjectToken.value))
    saveDialogOpen.value = false
}
/** 현재 프로젝트 폴더에서 빈 편집 화면의 독립 삼차원 설계 자동 로딩 */
const readProjectScene = async () => {
  const token = editor.projectToken
  if (
    mode.value !== 'facility' ||
    !token ||
    !window.desktop?.readProjectScene ||
    facility.busy ||
    facility.dirty ||
    modelDraftDirty.value ||
    facility.document.assets.length ||
    facility.document.instances.length ||
    facility.document.floors?.length
  )
    return
  const snapshot = facility.document
  const revision = editor.mapRevision
  facility.busy = true
  facility.message = '현재 프로젝트의 3D 설계를 불러오는 중입니다.'
  try {
    const file = await window.desktop.readProjectScene(token)
    if (
      mode.value !== 'facility' ||
      editor.projectToken !== token ||
      editor.mapRevision !== revision ||
      facility.document !== snapshot ||
      facility.dirty
    )
      return
    if (!file) {
      facility.message = '현재 프로젝트의 MAP/3D 폴더에 3D 설계 파일이 없습니다.'
      return
    }
    const document = parseFacilitySceneFile(file)
    facility.loadDocument(document, file.name)
    facility.message = `프로젝트 3D 설계 자동 로딩 완료: ${file.name}`
  } catch (error) {
    if (editor.mapRevision === revision && editor.projectToken === token)
      facility.message = error instanceof Error ? error.message : String(error)
  } finally {
    facility.busy = false
  }
}
/** 사용자 화면 전환과 에이전트 전환이 동일한 프로젝트 로딩 완료를 대기하도록 공유 */
let projectSceneLoading: Promise<void> | undefined
const loadProjectScene = () => {
  if (!projectSceneLoading) projectSceneLoading = readProjectScene().finally(() => { projectSceneLoading = undefined })
  return projectSceneLoading
}
watch(() => [mode.value, editor.projectToken, editor.mapRevision], loadProjectScene)
const canvas = ref<InstanceType<typeof MapViewport>>()
const help = ref<HTMLDialogElement>()
const layers = reactive<Layers>({ ...DEFAULT_LAYERS })
const cursor = reactive({ x: 0, y: 0 })
const mapZoom = ref(1)
const objectOpen = computed({
  get: () => editor.objectEditor !== null,
  set: (value: boolean) => {
    if (!value) {
      editor.objectEditor = null
      editor.objectEditorTarget = undefined
    }
  },
})
const mapShortcuts = [
  ['M / N', '전체 지도 보기 / 여백 없는 전체 보기'],
  ['Delete / Esc', '선택 노드 삭제 / 선택 해제'],
  ['Ctrl + O / Ctrl + S', '지도 열기 / 저장'],
  ['Ctrl + Z', '실행 취소'],
  ['Ctrl + Shift + Z / Ctrl + Y', '다시 실행'],
  ['마우스 휠', '커서 위치를 중심으로 확대·축소'],
  ['Space + 왼쪽 드래그 / 휠 버튼 드래그', '화면 이동'],
  ['오른쪽 클릭', '노드 편집 메뉴'],
  ['왼쪽 더블클릭', '클릭 위치로 이동·배율 60%'],
  ['왼쪽 드래그 → / ←', '영역 선택 추가 / 영역 선택 해제'],
]
const shortcuts = computed(() =>
  mode.value === 'map'
    ? mapShortcuts
    : [
        ['오른쪽 드래그', '3D 시점 회전'],
        ['Space + 왼쪽 드래그 / 휠 버튼 드래그', '화면 이동'],
        ['휠', '확대·축소'],
        ['이동 / 회전 도구', '선택 시설에 핸들 표시 (10mm / 15° 스냅)'],
        ['Ctrl+O / Ctrl+S', '지도 열기 / 3D 설계 저장'],
        ['Ctrl+Z / Ctrl+Shift+Z', '3D 설계 실행 취소 / 다시 실행'],
        ['Ctrl+C / Ctrl+V', '선택한 3D 시설 복사 / 붙여넣기'],
        ['Delete / Escape', '선택 시설 삭제 / 선택 해제'],
      ],
)
/**
 * 현재 편집 모드와 입력 요소의 포커스에 따라 단축키를 분기하는 키보드 명령 처리
 *
 * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
 */
const keyboard = (event: KeyboardEvent) => {
  if (help.value?.open || document.querySelector('dialog[open], .v-dialog.v-overlay--active'))
    return
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (mode.value === 'facility') {
    if (mod && key === 's') {
      event.preventDefault()
      void facility.save(editor.projectToken)
      return
    }
    if (mod && key === 'o') {
      event.preventDefault()
      void files.open()
      return
    }
    if (
      event.target instanceof HTMLElement &&
      (event.target.closest('input, textarea, select') || event.target.isContentEditable)
    )
      return
    if (mod && (key === 'c' || key === 'v')) {
      if (key === 'c' && window.getSelection()?.isCollapsed === false) return
      try {
        const handled =
          key === 'c' ? facility.copySelection(editor.document.ports) : facility.pasteSelection()
        if (handled) event.preventDefault()
      } catch (cause) {
        event.preventDefault()
        facility.message = cause instanceof Error ? cause.message : String(cause)
      }
      return
    }
    if (mod && key === 'z') {
      event.preventDefault()
      event.shiftKey ? facility.redo() : facility.undo()
    }
    if (key === 'delete') facility.remove()
    if (key === 'escape') facility.selectedId = null
    return
  }
  if (mod && key === 's') {
    event.preventDefault()
    requestSave(event.shiftKey)
    return
  }
  if (mod && key === 'o') {
    event.preventDefault()
    void files.open()
    return
  }
  if (
    event.target instanceof HTMLElement &&
    (event.target.closest('input, textarea, select') || event.target.isContentEditable)
  )
    return
  if (mod && key === 'z') {
    event.preventDefault()
    event.shiftKey ? editor.redo() : editor.undo()
    return
  }
  if (mod && key === 'y') {
    event.preventDefault()
    editor.redo()
    return
  }
  if (mod || event.altKey) return
  if (key === 'f') editor.curveOptions.force = !editor.curveOptions.force
  if (key === 'r') editor.curveOptions.reverse = !editor.curveOptions.reverse
  if (key === 'e') {
    editor.portMode = !editor.portMode
    editor.vehiclePreviewMode = false
  }
  if (key === 'p' && !mod) editor.openPathPlan()
  if (key === 'escape' && editor.pathPlanOpen) {
    editor.pathPlanOpen = false
    return
  }
  if (key === 'delete') {
    event.preventDefault()
    try {
      editor.removeSelected()
    } catch (cause) {
      editor.message = cause instanceof Error ? cause.message : String(cause)
    }
  }
  if (key === 'escape') {
    editor.clearSelection()
  }
  if (key === 'm' || key === 'n') {
    event.preventDefault()
    canvas.value?.fit(key === 'n')
  }
  if (key === '?') help.value?.showModal()
  const tools: Record<string, Tool> = {
    v: 'select',
    c: 'connect',
  }
  const tool = tools[key]
  if (tool && (!editor.readOnly || tool === 'select')) editor.tool = tool
}
/**
 * 저장하지 않은 설계를 브라우저 종료로 잃지 않도록 보호하는 이탈 확인
 *
 * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
 */
const beforeUnload = (event: BeforeUnloadEvent) => {
  if ((facility.dirty || modelDraftDirty.value) && !window.desktop) {
    event.preventDefault()
    event.returnValue = ''
  }
}
/** 화면 전환과 공통 표시 및 파일 진입점을 기존 사용자 동작에 연결 */
const unregisterCommands = registerAppCommands((): AppCommand[] => [
  { id: 'workspace.mode', label: '2D 및 3D 화면 전환', category: 'Workspace', description: '문서를 보존하며 작업 화면 전환. map은 노드 경로 포트 도면 편집. facility는 GLB 설비와 조명 설정 및 벽 바닥 천장 설계. 기본 벽 바닥 천장 생성은 카탈로그 Asset ID 없이 치수로 작성 가능', effect: 'view',
    parameters: { mode: { type: 'string', enum: ['map', 'facility'] } }, required: ['mode'],
    run: async ({ mode: value }) => {
      if (value === 'facility') {
        await import('@/widgets/facility-studio/index.ts')
        openFacility()
        if (mode.value !== 'facility') throw new Error(editor.message)
      } else mode.value = 'map'
      await nextTick()
      if (mode.value === 'facility') await loadProjectScene()
      return { mode: mode.value }
    } },
  { id: 'workspace.theme', label: '밝은 테마와 어두운 테마 전환', category: 'Workspace', description: '기존 테마 전환 동작 실행', effect: 'view',
    parameters: { mode: { type: 'string', enum: ['light', 'dark'] } }, required: ['mode'],
    run: ({ mode: value }) => { if (editor.colorMode !== value) editor.toggleColorMode(); return { mode: editor.colorMode } } },
  { id: 'workspace.layer', label: '맵 표시 레이어 설정', category: 'Workspace', description: '격자 grid 및 노드 nodes 경로 edges 포트 ports 와 라벨 등 기존 레이어 표시 설정', effect: 'view',
    parameters: { layer: { type: 'string', enum: Object.keys(DEFAULT_LAYERS) }, visible: { type: 'boolean' } }, required: ['layer', 'visible'],
    run: ({ layer, visible }) => { layers[layer as keyof Layers] = visible as boolean; return { layer, visible } } },
  { id: 'map.fit', label: '2D 전체 지도 보기', category: '2D/View', description: '현재 이차원 뷰포트의 기존 전체 보기 실행', effect: 'view', available: mode.value === 'map',
    run: () => canvas.value?.fit() },
  { id: 'map.tool', label: '2D 선택 및 노드 추가와 경로 연결 도구', category: '2D/Drawing', description: '마우스 입력을 받을 편집 도구 활성화이며 도형 생성 완료가 아님', effect: 'interactive',
    available: mode.value === 'map' && !editor.readOnly,
    parameters: { tool: { type: 'string', enum: ['select', 'add', 'connect'] } }, required: ['tool'],
    run: ({ tool }) => { editor.tool = tool as Tool; return { tool } } },
  { id: 'file.open', label: '지도 열기', category: 'File', description: '기존 확인 및 운영체제 파일 선택 절차 실행', effect: 'dialog', available: !files.busy.value,
    run: () => files.open() },
  { id: 'file.save-options', label: '지도 저장 설정', category: 'File', description: '기존 지도 저장과 저장 옵션 창을 실행하며 실제 저장 여부는 사용자 입력 결과 확인 필요', effect: 'dialog',
    available: !files.busy.value && !editor.readOnly, run: () => requestSave() },
])
onBeforeUnmount(unregisterCommands)
onMounted(() => {
  window.addEventListener('keydown', keyboard)
  window.addEventListener('beforeunload', beforeUnload)
  void files.restoreProject()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keyboard)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>
<template>
  <div
    class="studio-shell d-flex flex-column overflow-hidden"
  >
    <div class="workspace-content d-flex flex-grow-1 overflow-hidden">
      <main class="workspace-main d-flex flex-column">
        <MgsWorkspace
          v-if="mode === 'map'"
          :busy="files.busy.value"
          :layers="layers"
          :cursor="cursor"
          :zoom="mapZoom"
          @open="files.open()"
          @save="requestSave()"
          @save-as="requestSave(true)"
          @save-native="files.save(false, true)"
          @folder="files.openFolder()"
          @show-folder="files.showFolder()"
          @create="files.create()"
          @assistant="assistantOpen = !assistantOpen"
          @facility="openFacility"
          @focus="canvas?.focus($event)"
          @capture="canvas?.capture()"
          @layer="(key, value) => (layers[key] = value)"
        >
          <MapViewport
            ref="canvas"
            :layers="layers"
            @cursor="
              (x, y) => {
                cursor.x = x
                cursor.y = y
              }
            "
            @zoom="mapZoom = $event"
          />
          <template #node-editor><NodeInspector @focus="canvas?.focus($event)" /></template>
        </MgsWorkspace>
        <FacilityStudio
          v-else
          :layers="layers"
          @draft-dirty="modelDraftDirty = $event"
          @layer="(key, value) => (layers[key] = value)"
        >
          <template #header-actions>
            <div class="workspace-mode d-flex align-center">
              <TextAction data-testid="open-ai" :active="assistantOpen" @activate="assistantOpen = !assistantOpen">
                AI Agent
              </TextAction>
              <div class="mode-segments d-flex ga-1" role="group" aria-label="맵 표시 모드">
                <TextAction data-testid="mode-map" :active="false" @activate="mode = 'map'">2D</TextAction>
                <TextAction data-testid="mode-facility" active @activate="openFacility">3D</TextAction>
              </div>
              <TextAction data-testid="theme-toggle" @activate="editor.toggleColorMode">
                {{ editor.colorMode === 'dark' ? 'Light' : 'Dark' }}
              </TextAction>
            </div>
          </template>
          <template #file-actions>
            <WorkspaceHeader
              :busy="files.busy.value || facility.busy"
              @create="files.create()"
              @open="files.open()"
              @save="requestSave()"
              @save-as="requestSave(true)"
              @folder="files.openFolder"
              @help="help?.showModal()"
            />
          </template>
        </FacilityStudio>
      </main>
      <AiAssistant
        v-model="assistantOpen"
        :busy="files.busy.value || facility.busy || modelDraftDirty"
        @generated="showGeneratedMap"
        @focus="focusDrawingObject"
      />
    </div>
    <MapObjectEditor
      v-model="objectOpen"
      :initial-category="editor.objectEditor ?? 'ports'"
      :target="editor.objectEditorTarget"
    />
    <MapSaveDialog
      v-model="saveDialogOpen"
      :busy="files.busy.value"
      :message="editor.message"
      @save="saveWithOptions"
    />
    <dialog
      ref="help"
      class="shortcut-dialog pa-7"
      aria-labelledby="shortcut-title"
      @click="
        ($event) => {
          if ($event.target === $event.currentTarget) {
            help?.close()
          }
        }
      "
    >
      <div class="dialog-heading popup-drag-handle d-flex align-center">
        <div class="dialog-glyph">
          <AppIcon
            name="help"
            :size="24"
          />
        </div>
        <div>
          <span>QUICK REFERENCE</span>
          <h2 id="shortcut-title">편집 단축키</h2>
        </div>
        <v-btn
          class="icon-button pa-0 flex-shrink-0"
          aria-label="도움말 닫기"
          autofocus
          @click="help?.close()"
        >
          <AppIcon
            name="close"
            :size="20"
          />
        </v-btn>
      </div>
      <div class="shortcut-list">
        <div
          v-for="[key, description] in shortcuts"
          :key="key"
        >
          <span>{{ description }}</span>
          <kbd>{{ key }}</kbd>
        </div>
      </div>
      <p class="dialog-tip text-center">
        속성을 입력한 뒤 ‘변경 사항 적용’을 누르면 지도에 반영됩니다.
      </p>
    </dialog>
  </div>
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
.studio-shell {
  height: 100dvh;
  min-width: 0;
}
.workspace-mode {
  gap: 13px;
}
.studio-workspace {
  flex: 1;
  display: grid;
  grid-template-columns: 254px minmax(400px, 1fr) 292px;
  min-height: 0;
}
// 채팅 패널과 캔버스의 크기를 독립적으로 계산하는 작업 영역
.workspace-content {
  position: relative;
  min-height: 0;
}
.workspace-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.shortcut-dialog {
  width: 540px;
  max-width: 90vw;
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 25px 100px #05243540;
  background: var(--surface);
  color: var(--text);
}
.shortcut-dialog::backdrop {
  background: #102a396e;
  backdrop-filter: blur(4px);
}
.dialog-heading {
  gap: 13px;
  margin-bottom: 25px;
}
.dialog-glyph {
  height: 46px;
  width: 46px;
  border-radius: 12px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  display: grid;
  place-items: center;
}
.dialog-heading > div:nth-child(2) > span {
  color: var(--text-secondary);
  font-size: 8px;
  letter-spacing: 1.4px;
}
.dialog-heading h2 {
  font-size: 19px;
  font-weight: 500;
  color: var(--text);
  margin-top: 5px;
}
.dialog-heading > button {
  margin-left: auto;
  color: var(--text-secondary);
}
.shortcut-list > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-secondary);
}
.shortcut-list kbd {
  font-size: 9px;
  color: var(--text-secondary);
  background: var(--surface);
  border-color: var(--border);
}
.dialog-tip {
  color: var(--text-secondary);
  font-size: 10px;
  margin-top: 23px;
}
@media (max-width: 1330px) {
  .studio-workspace {
    grid-template-columns: 225px minmax(400px, 1fr) 260px;
  }
}
</style>
