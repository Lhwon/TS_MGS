<!--
/**
 * 파일명: StudioPage.vue
 * 설명: 지도와 설비 편집 화면 및 파일 작업과 단축키를 조합하는 편집 페이지
 * 작성자: 이희원
 * 작성일자: 2026-11-16
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
import { useEditor, useMapFiles } from '@/features/map-editor/index.ts'
import type { Tool } from '@/features/map-editor/index.ts'
import type { Layers } from '@/entities/map/index.ts'
import { DEFAULT_LAYERS } from '@/entities/map/index.ts'
import { AppIcon, TextAction } from '@/shared/ui/index.ts'
import { useFacilityEditor } from '@/features/facility-editor/index.ts'
import {
  mapGeometryKey,
  parseFacilityDocument,
  importFacilityFiles,
  resolveFacilityInstance,
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
const mapReference = computed(() => ({
  name: editor.sourceName,
  geometryKey: mapGeometryKey(editor.document.nodes),
}))
watch(
  () => editor.dirty || facility.dirty || modelDraftDirty.value,
  (dirty) => window.desktop?.setDirty(dirty),
  { immediate: true },
)
const files = useMapFiles(
  () =>
    !facility.busy &&
    (!(facility.dirty || modelDraftDirty.value) ||
      window.confirm(
        '맵을 교체하면 현재 3D 설계가 초기화됩니다. 저장하지 않은 변경을 버리시겠습니까?',
      )),
)
watch(
  () => editor.mapRevision,
  () => facility.resetForMap(mapReference.value),
  { flush: 'sync' },
)
/** 프로젝트 위치와 기준 좌표를 확인한 빈 편집 화면의 삼차원 설계 자동 로딩 */
const loadProjectScene = async () => {
  const token = editor.projectToken
  if (
    mode.value !== 'facility' ||
    !token ||
    !window.desktop?.readProjectScene ||
    facility.busy ||
    facility.dirty ||
    modelDraftDirty.value ||
    facility.document.assets.length ||
    facility.document.instances.length
  )
    return
  const snapshot = facility.document
  const revision = editor.mapRevision
  const reference = mapReference.value
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
    const document = file.library
      ? importFacilityFiles(file.content, file.library)
      : parseFacilityDocument(file.content)
    if (document.mapRef.geometryKey !== reference.geometryKey)
      throw new Error('프로젝트 3D 설계의 기준 좌표와 현재 2D 맵이 다릅니다.')
    for (const instance of document.instances)
      resolveFacilityInstance(instance, editor.document.ports)
    facility.load(JSON.stringify(document), file.name)
    facility.message = `프로젝트 3D 설계 자동 로딩 완료: ${file.name}`
  } catch (error) {
    if (editor.mapRevision === revision && editor.projectToken === token)
      facility.message = error instanceof Error ? error.message : String(error)
  } finally {
    facility.busy = false
  }
}
watch(() => [mode.value, editor.projectToken, editor.mapRevision], loadProjectScene)
// 시간 기반 지도 저장으로 파일명이 바뀌어도 같은 지도에 연결한 설비를 유지하는 참조 동기화
watch(
  () => editor.sourceName,
  () => {
    const reference = mapReference.value
    if (
      editor.dirty ||
      facility.document.mapRef.name === reference.name ||
      facility.document.mapRef.geometryKey !== reference.geometryKey
    )
      return
    if (facility.document.assets.length || facility.document.instances.length)
      facility.bindMap(reference)
    else facility.resetForMap(reference)
  },
)
const canvas = ref<InstanceType<typeof MapViewport>>()
const help = ref<HTMLDialogElement>()
const layers = reactive<Layers>({ ...DEFAULT_LAYERS })
const cursor = reactive({ x: 0, y: 0 })
const desktop = !!window.desktop
const mapZoom = ref(1)
const objectOpen = computed({
  get: () => editor.objectEditor !== null,
  set: (value: boolean) => {
    if (!value) editor.objectEditor = null
  },
})
const mapShortcuts = [
  ['M / N', '전체 지도 보기 / 여백 없는 전체 보기'],
  ['Delete / Esc', '선택 노드 삭제 / 선택 해제'],
  ['Ctrl + O / Ctrl + S', '지도 열기 / 저장'],
  ['Ctrl + Z', '실행 취소'],
  ['Ctrl + Shift + Z / Ctrl + Y', '다시 실행'],
  ['마우스 휠', '커서 위치를 중심으로 확대·축소'],
  ['Space + 왼쪽 드래그', '화면 이동'],
  ['오른쪽 클릭', '노드 편집 메뉴'],
  ['왼쪽 더블클릭', '클릭 위치로 이동·배율 60%'],
  ['왼쪽 드래그 → / ←', '영역 선택 추가 / 영역 선택 해제'],
]
const shortcuts = computed(() =>
  mode.value === 'map'
    ? mapShortcuts
    : [
        ['오른쪽 드래그 / Space + 왼쪽 드래그', '3D 시점 회전 / 화면 이동'],
        ['휠', '확대·축소'],
        ['이동 / 회전 도구', '선택 시설에 핸들 표시 (10mm / 15° 스냅)'],
        ['Ctrl+O / Ctrl+S', '지도 열기 / 3D 설계 저장'],
        ['Ctrl+Z / Ctrl+Shift+Z', '3D 설계 실행 취소 / 다시 실행'],
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
      if (facility.document.mapRef.geometryKey !== mapGeometryKey(editor.document.nodes))
        facility.message = '기준 2D 맵 연결을 먼저 확인하세요.'
      else void facility.save(editor.projectToken)
      return
    }
    if (mod && key === 'o') {
      event.preventDefault()
      void files.open()
      return
    }
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select'))
      return
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
    void files.save(event.shiftKey)
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
  if (key === 'e') editor.portMode = !editor.portMode
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
onMounted(() => {
  window.addEventListener('keydown', keyboard)
  window.addEventListener('beforeunload', beforeUnload)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keyboard)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>
<template>
  <div class="studio-shell d-flex flex-column overflow-hidden">
    <WorkspaceHeader
      v-if="mode === 'facility'"
      :busy="files.busy.value || facility.busy"
      @create="files.create()"
      @open="files.open()"
      @save="files.save()"
      @save-as="files.save(true)"
      @folder="files.openFolder"
      @help="help?.showModal()"
    />
    <div
      v-if="mode === 'facility'"
      class="workspace-titlebar d-flex align-center justify-space-between flex-shrink-0"
    >
      <div class="workspace-breadcrumb d-flex align-center">
        <AppIcon
          name="layers"
          :size="17"
        /><span>프로젝트</span
        ><AppIcon
          name="chevron"
          :size="12"
        /><strong>{{ editor.document.name }}</strong>
      </div>
      <div class="workspace-mode d-flex align-center">
        <div
          class="d-flex ga-1"
          aria-label="맵 표시 모드"
        >
          <TextAction
            data-testid="mode-map"
            @activate="mode = 'map'"
            >2D</TextAction
          >
          <TextAction
            data-testid="mode-facility"
            :active="mode === 'facility'"
            @activate="openFacility"
            >3D</TextAction
          >
        </div>
        <TextAction
          data-testid="theme-toggle"
          @activate="editor.toggleColorMode"
          >{{ editor.colorMode === 'dark' ? 'Light' : 'Dark' }}</TextAction
        >
        <TextAction
          data-testid="open-ai"
          :active="assistantOpen"
          @activate="assistantOpen = !assistantOpen"
          >AI 도우미</TextAction
        >
        <span class="workspace-version">v0.6.0</span>
      </div>
    </div>
    <div class="workspace-content d-flex flex-grow-1 overflow-hidden">
      <main class="workspace-main d-flex flex-column">
        <MgsWorkspace
          v-if="mode === 'map'"
          :busy="files.busy.value"
          :layers="layers"
          :cursor="cursor"
          :zoom="mapZoom"
          @open="files.open()"
          @save="files.save()"
          @save-as="files.save(true)"
          @save-native="files.save(false, true)"
          @folder="files.openFolder()"
          @show-folder="files.showFolder()"
          @create="files.create()"
          @assistant="assistantOpen = !assistantOpen"
          @facility="openFacility"
          @fit="canvas?.fit()"
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
        />
        <footer
          v-if="mode === 'facility'"
          class="status-bar d-flex align-center flex-shrink-0"
        >
          <span class="status-ready d-flex align-center"
            ><span class="state-dot flex-shrink-0"></span
            >{{
              mode === 'facility'
                ? '3D EDIT'
                : editor.readOnly
                  ? 'READ ONLY'
                  : files.busy.value
                    ? 'WORKING'
                    : 'READY'
            }}</span
          ><span
            class="status-message overflow-hidden"
            role="status"
            >{{ mode === 'facility' ? facility.message : editor.message }}</span
          ><span class="status-platform">{{ desktop ? 'DESKTOP' : 'WEB' }}</span>
        </footer>
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
      <div class="dialog-heading d-flex align-center">
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
          <span>{{ description }}</span
          ><kbd>{{ key }}</kbd>
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
  min-height: 650px;
  min-width: 1100px;
}
.workspace-titlebar {
  height: 49px;
  padding: 0 23px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.workspace-breadcrumb {
  gap: 11px;
  font-size: 11px;
  color: var(--text-muted);
  min-width: 0;
}
.workspace-breadcrumb > svg:first-child {
  color: var(--accent);
}
.workspace-breadcrumb strong {
  color: var(--text-secondary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.workspace-mode {
  gap: 13px;
}
.workspace-version {
  font: 10px var(--font-mono);
  color: var(--text-secondary);
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
.status-bar {
  gap: 15px;
  height: 30px;
  padding: 0 18px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  font-size: 10px;
}
.status-ready {
  gap: 6px;
  color: var(--app-success);
  font: 9px var(--font-mono);
}
.status-message {
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.status-position {
  color: var(--text-secondary);
  font: 10px var(--font-mono);
}
.status-position > b {
  font-size: 9px;
  font-weight: 400;
  color: var(--text-secondary);
  margin-left: 8px;
}
.status-position small {
  font-size: 9px;
  color: var(--text-secondary);
  margin-left: 3px;
}
.status-platform {
  border-left: 1px solid var(--border);
  padding-left: 13px;
  color: var(--text-secondary);
  font: 8px var(--font-mono);
  letter-spacing: 1px;
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
@media (max-height: 800px) {
  .workspace-titlebar {
    height: 40px;
  }
}
</style>
