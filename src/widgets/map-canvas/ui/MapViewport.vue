<!--
/**
 * 파일명: MapViewport.vue
 * 설명: 지도 렌더러 수명주기와 우클릭 메뉴 및 노드 입력을 연결하는 뷰포트
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useEditor } from '@/features/map-editor/index.ts'
import { createMapScene } from '@/widgets/map-canvas/lib/MapScene'
import { calibrateDrawingMap } from '@/features/drawing-import/index.ts'
import { calculateCurve } from '@/entities/map/index.ts'
import type { Layers } from '@/entities/map/index.ts'
const props = defineProps<{
  layers: Layers
}>()
const emit = defineEmits<{
  cursor: [x: number, y: number]
  zoom: [value: number]
}>()
const editor = useEditor()
const host = ref<HTMLElement>()
const error = ref('')
const showDrawing = ref(true)
const referenceFrom = ref<number | null>(null)
const referenceTo = ref<number | null>(null)
const referenceDistance = ref<number | null>(null)
const calibrationError = ref('')
/** 선택한 두 기준점의 실제 거리를 기존 편집 이력에 반영하는 도면 축척 보정 */
const calibrate = () => {
  try {
    if (referenceFrom.value === null || referenceTo.value === null || !referenceDistance.value)
      throw new Error('기준 노드 두 개와 실제 거리 mm를 입력하세요.')
    const calibrated = calibrateDrawingMap(
      editor.document,
      [referenceFrom.value, referenceTo.value],
      referenceDistance.value,
    )
    editor.commit((map) => Object.assign(map, calibrated))
    calibrationError.value = ''
    editor.message = '도면 축척을 mm로 확정했습니다.'
    scene?.fit()
  } catch (cause) {
    calibrationError.value = cause instanceof Error ? cause.message : String(cause)
  }
}
watch(showDrawing, (visible) => scene?.setDrawingVisible(visible))
watch(
  () => editor.mapRevision,
  () => {
    referenceFrom.value = null
    referenceTo.value = null
    calibrationError.value = ''
  },
)
const portMenu = ref<{ id: string | null; x: number; y: number; left: number; top: number }>()
const menu = ref<{
  id: number | null
  x: number
  y: number
  left: number
  top: number
  distance: number
  connection: number | null
}>()
const draft = reactive({ open: false, x: 0, y: 0, connection: null as number | null })
const menuElement = ref<HTMLElement>()
const drawingPoint = reactive({ x: 0, y: 0 })
const draftCurve = computed(() => {
  try {
    return draft.open
      ? calculateCurve(editor.document, draft.connection, draft, editor.curveOptions)
      : null
  } catch {
    return null
  }
})
/** 현재 선택과 마우스 위치 및 입력값을 실제 생성과 같은 계산으로 표시하는 커브 미리보기 */
const refreshCurvePreview = () => {
  try {
    const curve = draft.open
      ? draftCurve.value
      : calculateCurve(editor.document, editor.selectedId, drawingPoint, editor.curveOptions)
    scene?.setCurvePreview(curve?.points)
  } catch {
    scene?.setCurvePreview()
  }
}
watch(
  () => [
    editor.document,
    editor.selectedId,
    { ...editor.curveOptions },
    draft.open,
    draft.x,
    draft.y,
    draft.connection,
  ],
  refreshCurvePreview,
  { flush: 'post' },
)
/**
 * 현재 우클릭 메뉴의 대상과 위치를 제거하는 메뉴 닫기
 */
const closeMenu = () => {
  menu.value = undefined
  portMenu.value = undefined
}
/**
 * 포트 편집 모드에서 원본 표시 순서의 가장 앞 포트를 찾는 포트 선택 판정
 * @param x 지도 가로 좌표
 * @param y 지도 세로 좌표
 * @returns 포인터 아래 포트 식별자 또는 빈 결과
 */
const pickPort = (x: number, y: number) => {
  const group = [...(editor.visibleDocument.portGroups ?? [])]
    .reverse()
    .find(
      (item) => Math.abs(x - item.x) <= item.width / 2 && Math.abs(y - item.y) <= item.height / 2,
    )
  if (group) return group.portIds[0] ?? null
  return (
    [...editor.visibleDocument.ports]
      .reverse()
      .find(
        (port) =>
          Math.abs(x - port.x) <= (port.width ?? 1000) / 2 &&
          Math.abs(y - port.y) <= (port.height ?? 1000) / 2,
      )?.id ?? null
  )
}
/**
 * 원본 포트 메뉴의 추가와 편집 및 정렬 명령을 편집 이력에 연결하는 포트 작업
 * @param action 원본 포트 메뉴의 명령 이름
 */
const portAction = (
  action: 'add' | 'edit' | 'delete' | 'front' | 'back' | 'forward' | 'backward',
) => {
  const target = portMenu.value
  if (!target) return
  attempt(() => {
    if (action === 'add') {
      const node = editor.selectedNode
      if (!node) throw new Error('포트를 연결할 노드를 먼저 선택하세요.')
      editor.addPort(node.id, target.x, target.y)
      editor.objectEditor = 'ports'
    } else if (target.id) {
      editor.selectedPortId = target.id
      if (action === 'edit') editor.objectEditor = 'ports'
      else if (action === 'delete') {
        if (window.confirm(`Do you really want to delete Port ${target.id}?`))
          editor.removePort(target.id)
      } else editor.orderPort(target.id, action)
    }
  })
  closeMenu()
}
/**
 * 메뉴 바깥 영역의 입력을 감지하여 열린 메뉴를 정리하는 외부 클릭 처리
 *
 * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
 */
const outsideMenu = (event: PointerEvent) => {
  if (!menuElement.value?.contains(event.target as Node)) closeMenu()
}
/**
 * 취소 키에 맞춰 메뉴와 노드 입력창 및 진행 중인 조작을 닫는 입력 취소
 *
 * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
 */
const escape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeMenu()
    draft.open = false
    scene?.cancelInteraction()
  }
}
/**
 * 원본 노드 종류와 거리 및 읽기 전용 상태를 확인한 뒤 메뉴 명령을 실행하는 노드 메뉴 처리
 *
 * @param action 검증 범위 안에서 실행할 편집 명령
 */
const menuAction = (action: 'add' | 'edit' | 'delete' | 'connect' | 'path') => {
  const target = menu.value
  if (!target) return
  if (target.id !== null && editor.document.nodes.find((node) => node.id === target.id)?.curve)
    return
  if (action === 'path') {
    editor.objectEditor = 'edges'
    closeMenu()
    return
  }
  if (action === 'add' && !editor.readOnly && target.distance >= 100) {
    Object.assign(draft, {
      open: true,
      x: Math.trunc(target.x),
      y: Math.trunc(target.y),
      connection: target.connection,
    })
  } else if (target.id !== null) {
    if (action === 'edit') {
      editor.selectedId = target.id
      editor.nodeEditorOpen = true
      void nextTick(() =>
        document.querySelector<HTMLInputElement>('[data-testid="node-x"]')?.focus(),
      )
    }
    if (action === 'delete' && !editor.readOnly) {
      if (window.confirm(`Do you really want to delete Node ${target.id}?`)) {
        editor.selectedId = target.id
        attempt(() => editor.removeSelected())
      }
    }
    if (
      action === 'connect' &&
      !editor.readOnly &&
      target.connection !== null &&
      target.distance < 50
    ) {
      if (window.confirm(`Do you really want to connect ${target.id}→${target.connection} node?`))
        attempt(() => editor.connect(target.id!, target.connection!))
    }
  }
  closeMenu()
}
/**
 * 우클릭 메뉴에서 이동 및 실행과 닫기를 지원하는 메뉴 키보드 탐색
 *
 * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
 */
const menuKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeMenu()
    draft.open = false
    return
  }
  const action = ({ a: 'add', e: 'edit', d: 'delete', c: 'connect', q: 'path' } as const)[
    event.key.toLowerCase() as 'a'
  ]
  if (action) {
    event.preventDefault()
    event.stopPropagation()
    menuAction(action)
  }
}
/**
 * 입력 좌표와 연결 기준 노드를 사용하여 새 지도 노드를 만드는 노드 생성 적용
 */
const add = () => {
  attempt(() => {
    editor.addNode(Number(draft.x), Number(draft.y), draft.connection)
    draft.open = false
  })
}
let scene: ReturnType<typeof createMapScene> | undefined
/**
 * 편집 명령의 예외를 화면 상태로 변환하고 정상 처리 시 이전 오류를 해제하는 작업 실행
 *
 * @param action 검증 범위 안에서 실행할 편집 명령
 */
const attempt = (action: () => void) => {
  try {
    action()
  } catch (cause) {
    editor.message = cause instanceof Error ? cause.message : String(cause)
  }
}
onMounted(() => {
  document.addEventListener('pointerdown', outsideMenu, true)
  window.addEventListener('keydown', escape)
  try {
    scene = createMapScene(host.value!, {
      click: (id, x, y) =>
        attempt(() => {
          closeMenu()
          if (editor.shapeTool !== null) return
          if (editor.portMode) {
            editor.selectedPortId = pickPort(x, y)
            return
          }
          if (draft.open) {
            draft.x = Math.trunc(x)
            draft.y = Math.trunc(y)
            return
          }
          if (editor.tool === 'add') {
            editor.addNode(
              Math.round(x / 10) * 10,
              Math.round(y / 10) * 10,
              editor.curveOptions.force || editor.curveOptions.autoSelect
                ? editor.selectedId
                : null,
            )
            return
          }
          if (editor.tool === 'connect' && id !== null) {
            editor.connectNode(id)
            return
          }
          if (id !== null) editor.selectedId = id
        }),
      context: (id, x, y, left, top, distance) => {
        closeMenu()
        if (editor.portMode) {
          portMenu.value = {
            id: pickPort(x, y),
            x,
            y,
            left: Math.max(0, Math.min(left + 10, host.value!.clientWidth - 270)),
            top: Math.max(0, Math.min(top + 10, host.value!.clientHeight - 350)),
          }
          void nextTick(() => menuElement.value?.focus())
          return
        }
        editor.selectedIds = []
        menu.value = {
          id,
          x,
          y,
          left: Math.max(0, Math.min(left + 10, host.value!.clientWidth - 270)),
          top: Math.max(0, Math.min(top + 10, host.value!.clientHeight - 350)),
          distance,
          connection: editor.selectedId,
        }
        void nextTick(() => menuElement.value?.focus())
      },
      area: (start, end) =>
        attempt(() =>
          editor.shapeTool !== null ? editor.addShape(start, end) : editor.selectArea(start, end),
        ),
      cursor: (x, y) => {
        drawingPoint.x = x
        drawingPoint.y = y
        refreshCurvePreview()
        emit('cursor', x, y)
      },
      zoom: (value) => emit('zoom', value),
    })
    scene.setRenderPaused(editor.renderPaused)
    scene.setDocument(editor.visibleDocument, editor.theme)
    scene.setLayers(props.layers)
    scene.setTool(editor.tool, editor.readOnly)
    scene.fit()
  } catch (cause) {
    error.value = `Three.js 초기화 실패: ${cause instanceof Error ? cause.message : String(cause)}`
  }
})
watch(
  () => editor.selectedIds,
  (ids) => scene?.setAreaSelection(ids),
)
watch(
  () => [editor.visibleDocument, editor.theme] as const,
  ([map, theme], [previous]) => {
    if (map !== previous) {
      closeMenu()
      draft.open = false
    }
    scene?.setDocument(map, theme)
    if (!editor.canUndo && !editor.canRedo && map !== previous) scene?.fit()
  },
)
watch(
  () => editor.selectedId,
  (id) => scene?.setSelected(id),
)
watch(
  () => [editor.tool, editor.readOnly] as const,
  ([tool, readonly]) => scene?.setTool(tool, readonly),
)
watch(
  () => props.layers,
  (layers) => scene?.setLayers(layers),
  { deep: true },
)
watch(
  () => editor.renderPaused,
  (paused) => scene?.setRenderPaused(paused),
)
watch(
  () => editor.mapRevision,
  () => {
    error.value = ''
    closeMenu()
    draft.open = false
    scene?.cancelInteraction()
    scene?.setDocument(editor.visibleDocument, editor.theme)
    scene?.fit()
  },
  { flush: 'post' },
)
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outsideMenu, true)
  window.removeEventListener('keydown', escape)
  scene?.dispose()
})
/**
 * 원본 지도 맞춤 규칙을 렌더러에 전달하는 화면 맞춤
 * @param alternate 여백 없는 원본 맞춤 규칙의 적용 여부
 */
const fit = (alternate = false) => scene?.fit(alternate)
/**
 * 지정 노드를 중심으로 지도 화면을 이동하는 포커스 전달
 * @param id 화면 중심에 배치할 노드 식별자
 */
const focus = (id: number) => scene?.focus(id)
/**
 * 확대 배수를 지도 렌더러에 전달하는 배율 변경
 * @param factor 현재 화면 배율에 적용할 확대 또는 축소 비율
 */
const zoomBy = (factor: number) => scene?.zoomBy(factor)
/**
 * 현재 지도와 라벨의 합성 이미지를 다운로드하는 지도 캡처
 */
const capture = () => {
  const image = scene?.capture()
  if (!image) return
  const anchor = document.createElement('a')
  anchor.href = image
  anchor.download = `${editor.sourceName.replace(/\.[^.]+$/, '')}.png`
  anchor.click()
}
defineExpose({ fit, focus, zoomBy, capture })
</script>

<template>
  <div
    ref="host"
    class="map-viewport w-100 h-100 position-absolute"
    @scene-error="error = ($event as CustomEvent).detail"
  >
    <div
      v-if="error"
      class="gpu-error position-absolute pa-5"
      role="alert"
    >
      {{ error }}
    </div>
    <details
      v-if="editor.document.drawing"
      class="drawing-controls position-absolute pa-2"
      data-testid="drawing-controls"
      @pointerdown.stop
      @keydown.stop
    >
      <summary>도면 비율 직접 맞추기</summary>
      <form
        class="mt-2"
        @submit.prevent="calibrate"
      >
        <label>
          기준 노드 A
          <select
            v-model="referenceFrom"
            required
            data-testid="drawing-reference-from"
          >
            <option :value="null">선택</option>
            <option
              v-for="node in editor.document.nodes.filter((node) => !node.curve)"
              :key="node.id"
              :value="node.id"
            >
              N{{ node.id }}
            </option>
          </select>
        </label>
        <label>
          기준 노드 B
          <select
            v-model="referenceTo"
            required
            data-testid="drawing-reference-to"
          >
            <option :value="null">선택</option>
            <option
              v-for="node in editor.document.nodes.filter((node) => !node.curve)"
              :key="node.id"
              :value="node.id"
            >
              N{{ node.id }}
            </option>
          </select>
        </label>
        <label>
          실제 거리 (mm)
          <input
            v-model.number="referenceDistance"
            type="number"
            min="1"
            required
            data-testid="drawing-reference-distance"
          />
        </label>
        <v-btn
          type="submit"
          data-testid="drawing-calibrate"
        >
          축척 적용
        </v-btn>
      </form>
      <p
        v-if="calibrationError"
        role="alert"
      >
        {{ calibrationError }}
      </p>
    </details>
    <div
      v-if="portMenu"
      ref="menuElement"
      class="mgs-context-menu position-absolute pa-2"
      role="menu"
      tabindex="-1"
      :style="{ left: `${portMenu.left}px`, top: `${portMenu.top}px` }"
      @pointerdown.stop
      @keydown.esc.stop="closeMenu"
    >
      <strong>
        {{ portMenu.id ? `Port[${portMenu.id}] is selected.` : 'You can add a port.' }}
      </strong>
      <v-btn
        role="menuitem"
        :disabled="!editor.selectedNode"
        @click="portAction('add')"
      >
        [A] Add
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="!portMenu.id"
        @click="portAction('edit')"
      >
        [E] Edit
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="!portMenu.id"
        @click="portAction('delete')"
      >
        [D] Delete
      </v-btn>
      <hr />
      <v-btn
        role="menuitem"
        :disabled="!portMenu.id"
        @click="portAction('front')"
      >
        Bring to Front
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="!portMenu.id"
        @click="portAction('back')"
      >
        Send to Back
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="!portMenu.id"
        @click="portAction('forward')"
      >
        Bring Forward
      </v-btn>
      <v-btn
        role="menuitem"
        :disabled="!portMenu.id"
        @click="portAction('backward')"
      >
        Send Backward
      </v-btn>
    </div>
    <div
      v-if="menu"
      ref="menuElement"
      class="mgs-context-menu position-absolute pa-2"
      role="menu"
      tabindex="-1"
      :style="{ left: `${menu.left}px`, top: `${menu.top}px` }"
      @keydown.stop="menuKey"
      @pointerdown.stop
    >
      <strong>
        {{ menu.id === null ? 'You can add a node.' : `Node[${menu.id}] is selected.` }}
      </strong>
      <v-btn
        role="menuitem"
        data-testid="context-add"
        :disabled="
          editor.readOnly ||
          menu.distance < 100 ||
          !!editor.document.nodes.find((n) => n.id === menu?.id)?.curve
        "
        @click="menuAction('add')"
      >
        [A] Add (Node)
      </v-btn>
      <hr />
      <v-btn
        role="menuitem"
        :disabled="
          menu.id === null || !!editor.document.nodes.find((n) => n.id === menu?.id)?.curve
        "
        @click="menuAction('edit')"
      >
        [E] Edit (Node)
      </v-btn>
      <v-btn
        role="menuitem"
        @click="menuAction('path')"
      >
        [Q] Edit (Path)
      </v-btn>
      <v-btn
        role="menuitem"
        disabled
      >
        [S] Setting (Connected Path) · 미이식
      </v-btn>
      <hr />
      <v-btn
        role="menuitem"
        :disabled="
          editor.readOnly ||
          menu.id === null ||
          !!editor.document.nodes.find((n) => n.id === menu?.id)?.curve
        "
        @click="menuAction('delete')"
      >
        [D] Delete
      </v-btn>
      <v-btn
        role="menuitem"
        disabled
      >
        [R] Repeat Insert · 미이식
      </v-btn>
      <v-btn
        role="menuitem"
        disabled
      >
        [I] Insert (1) · 미이식
      </v-btn>
      <v-btn
        role="menuitem"
        disabled
      >
        [F] Fit and Connect · 미이식
      </v-btn>
      <hr />
      <v-btn
        role="menuitem"
        :disabled="
          editor.readOnly ||
          menu.id === null ||
          menu.connection === null ||
          menu.distance >= 50 ||
          !!editor.document.nodes.find((n) => n.id === menu?.id)?.curve
        "
        @click="menuAction('connect')"
      >
        [C] Connect
      </v-btn>
    </div>
    <form
      v-if="draft.open"
      class="mgs-node-form position-absolute pa-2"
      @submit.prevent="add"
      @pointerdown.stop
      @keydown.stop
      @keydown.esc="draft.open = false"
    >
      <strong>
        Add Node · {{ editor.curveOptions.force || draftCurve ? '커브 노드' : '직선 노드' }}
      </strong>
      <label>
        X ({{ editor.document.units }})
        <input
          v-model.number="draft.x"
          type="number"
          required
          data-testid="add-x"
        />
      </label>
      <label>
        Y ({{ editor.document.units }})
        <input
          v-model.number="draft.y"
          type="number"
          required
        />
      </label>
      <label>
        Connected Node
        <select v-model="draft.connection">
          <option :value="null">없음</option>
          <option
            v-for="node in editor.document.nodes.filter((n) => !n.curve)"
            :key="node.id"
            :value="node.id"
          >
            {{ node.id }}
          </option>
        </select>
      </label>
      <template v-if="editor.curveOptions.force || editor.curveOptions.autoSelect">
        <label>
          Radius (mm)
          <input
            v-model.number="editor.curveOptions.radius"
            type="number"
            min="1"
            step="1"
            :disabled="editor.curveOptions.dynamicRadius"
            required
            data-testid="add-curve-radius"
          />
        </label>
        <label>
          Curve Degree (°)
          <input
            v-model.number="editor.curveOptions.angle"
            type="number"
            min="1"
            max="359"
            step="1"
            required
            data-testid="add-curve-angle"
          />
        </label>
        <label>
          Divide Degree (°)
          <input
            v-model.number="editor.curveOptions.divide"
            type="number"
            min="1"
            :max="editor.curveOptions.angle"
            step="1"
            required
            data-testid="add-curve-divide"
          />
        </label>
        <small v-if="draftCurve">
          끝점 {{ draftCurve.points.at(-1)?.x }}, {{ draftCurve.points.at(-1)?.y }} mm · 커브 가상
          노드 {{ draftCurve.points.length - 2 }}개
        </small>
      </template>
      <div>
        <v-btn
          type="submit"
          data-testid="confirm-add"
        >
          Add
        </v-btn>
        <v-btn
          type="button"
          @click="draft.open = false"
        >
          Close
        </v-btn>
      </div>
    </form>
  </div>
</template>

<style scoped lang="scss">
// 도면 배경과 같은 좌표계의 기준점 및 실제 거리 입력
.drawing-controls {
  z-index: 6;
  top: 40px;
  left: 30px;
  width: 235px;
  max-height: 70%;
  overflow: auto;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
  font-size: 11px;
}
.drawing-controls label {
  display: block;
  margin-bottom: 6px;
}
.drawing-controls .drawing-checkbox {
  width: 14px;
  height: 14px;
}
.drawing-controls select {
  width: 100%;
  background: var(--input-bg);
  color: var(--text);
  border: 1px solid var(--border);
}
.drawing-controls summary {
  cursor: pointer;
  font-weight: 600;
}
// 화면 구성과 고유 시각 요소에 필요한 컴포넌트 전용 스타일

input {
  font: inherit;
}
input:focus-visible {
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
.map-viewport {
  inset: 0;
}
.map-viewport > :deep(canvas) {
  display: block;
  touch-action: none;
}
:deep(.map-labels) {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.gpu-error {
  top: 40%;
  left: 10%;
  right: 10%;
  color: var(--text-secondary);
  background: #4d2829;
  border: 1px solid #895050;
  line-height: 1.8;
  border-radius: 8px;
  z-index: 5;
}
:deep(.mgs-selection-box) {
  position: absolute;
  pointer-events: none;
  border: 1px solid #4488ff;
  background: #4488ff18;
  z-index: 10;
}
:deep(.mgs-selection-box)[data-operation='remove'] {
  border-color: var(--border);
  border-style: dashed;
  background: #ff996618;
}
:deep(.mgs-selection-box)[hidden] {
  display: none;
}
.mgs-context-menu {
  z-index: 30;
  width: 260px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--app-border);
  box-shadow: var(--shadow);
  border-radius: 8px;
  font:
    12px 'Pretendard',
    sans-serif;
}
.mgs-node-form {
  z-index: 30;
  width: 260px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--app-border);
  box-shadow: var(--shadow);
  border-radius: 8px;
  font:
    12px 'Pretendard',
    sans-serif;
}
.mgs-context-menu strong {
  display: block;
  padding: 7px;
}
.mgs-context-menu button {
  display: block;
  width: 100%;
  padding: 6px 8px;
  text-align: left;
  border: 0;
  background: transparent;
  color: inherit;
}
.mgs-context-menu button:hover:enabled {
  background: var(--surface-muted);
}
.mgs-context-menu button:focus-visible {
  background: var(--surface-muted);
}
.mgs-context-menu button:disabled {
  color: var(--text-secondary);
  cursor: default;
}
.mgs-context-menu hr {
  border: 0;
  border-top: 1px solid var(--app-border);
  margin: 3px 0;
}
.mgs-node-form {
  top: 70px;
  right: 20px;
  display: grid;
  gap: 10px;
}
.mgs-node-form label {
  display: grid;
  gap: 4px;
}
.mgs-node-form input {
  width: 100%;
  padding: 6px;
  border: 1px solid var(--app-border);
  background: var(--surface);
  color: var(--text);
}
.mgs-node-form select {
  width: 100%;
  padding: 6px;
  border: 1px solid var(--app-border);
  background: var(--surface);
  color: var(--text);
}
.mgs-node-form button {
  padding: 5px 14px;
  margin-right: 6px;
}
</style>
