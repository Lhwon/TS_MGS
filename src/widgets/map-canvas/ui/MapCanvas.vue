<!--
/**
 * 파일명: MapCanvas.vue
 * 설명: 지도 도구와 렌더링 화면 및 확대 상태를 조합하는 캔버스 위젯
 * 작성자: 이희원
 * 작성일자: 2026-10-23
 */
-->
<script setup lang="ts">
import { ref } from 'vue'
import { useEditor } from '@/features/map-editor/index.ts'
import { AppIcon } from '@/shared/ui/index.ts'
import type { Layers } from '@/entities/map/index.ts'
import MapViewport from '@/widgets/map-canvas/ui/MapViewport.vue'
import EditorToolbar from '@/widgets/map-canvas/ui/EditorToolbar.vue'

defineProps<{
  layers: Layers
}>()

const emit = defineEmits<{
  cursor: [x: number, y: number]
  zoom: [value: number]
}>()

const editor = useEditor()
const viewport = ref<InstanceType<typeof MapViewport>>()
const zoom = ref(1)

/**
 * 지도와 표시 객체의 범위를 사용 가능한 화면에 맞추는 카메라 맞춤
 * @param alternate 원본의 여백 없는 맞춤 규칙의 적용 여부
 */
const fit = (alternate = false) => {
  viewport.value?.fit(alternate)
}

/**
 * 렌더러가 알린 실제 배율을 화면의 확대 표시 상태에 반영하는 표시 갱신
 * @param value 현재 처리 단계에서 검증하거나 반영할 입력 값
 */
const onZoom = (value: number) => {
  zoom.value = value
  emit('zoom', value)
}

/**
 * 지정 노드의 위치로 하위 지도 화면을 이동하는 포커스 전달
 * @param id 화면 중심으로 이동할 노드 식별자
 */
const focus = (id: number) => viewport.value?.focus(id)

defineExpose({ fit, focus })
</script>

<template>
  <section
    class="map-canvas-panel d-flex flex-column"
    aria-label="지도 편집기"
  >
    <EditorToolbar @fit="fit()" />
    <div class="viewport-container position-relative overflow-hidden">
      <MapViewport
        ref="viewport"
        :layers="layers"
        @cursor="(x, y) => emit('cursor', x, y)"
        @zoom="onZoom"
      />
      <div class="canvas-heading position-absolute">
        <span class="scene-state d-flex align-center">
          <span class="state-dot flex-shrink-0" />
          {{ editor.readOnly ? 'LEGACY PREVIEW' : 'TOPOLOGY' }}
        </span>

        <strong>
          2D 지도
          <span>XY / mm</span>
        </strong>
      </div>

      <div
        v-if="editor.readOnly"
        class="legacy-notice position-absolute d-flex align-center"
      >
        <AppIcon
          name="lock"
          :size="15"
        />
        MGS 원본 연결·좌표 미리보기 · 원본 좌표·방향·포트·도형 표시
      </div>

      <div
        v-if="!editor.document.nodes.length"
        class="empty-map position-absolute d-flex align-center justify-center flex-column"
      >
        <div>
          <AppIcon
            name="add"
            :size="34"
          />
        </div>
        <h2>새로운 경로를 그려보세요</h2>
        <p>노드 도구를 선택하고 지도 위를 클릭해 시작합니다.</p>
        <v-btn
          data-testid="empty-add"
          @click="editor.tool = 'add'"
        >
          <AppIcon
            name="plus"
            :size="17"
          />
          첫 노드 추가
        </v-btn>
      </div>
      <div class="canvas-legend d-flex position-absolute">
        <span>
          <i class="legend-node flex-shrink-0" />
          노드
        </span>
        <span>
          <i class="legend-path flex-shrink-0" />
          경로
        </span>
        <span>
          <i class="legend-port flex-shrink-0" />
          포트
        </span>
      </div>
      <div class="canvas-controls position-absolute d-flex align-center pa-1">
        <v-btn
          class="icon-button pa-0 flex-shrink-0"
          aria-label="축소"
          title="축소"
          data-testid="zoom-out"
          @click="viewport?.zoomBy(1 / 1.2)"
        >
          <AppIcon
            name="minus"
            :size="16"
          />
        </v-btn>
        <span data-testid="zoom-level">{{ (zoom * 100).toFixed(0) }}%</span>
        <v-btn
          class="icon-button pa-0 flex-shrink-0"
          aria-label="확대"
          title="확대"
          data-testid="zoom-in"
          @click="viewport?.zoomBy(1.2)"
        >
          <AppIcon
            name="plus"
            :size="16"
          />
        </v-btn>
        <i />
        <v-btn
          class="icon-button pa-0 flex-shrink-0"
          aria-label="전체 보기"
          title="전체 보기 (M)"
          data-testid="fit"
          @click="fit()"
        >
          <AppIcon
            name="fit"
            :size="17"
          />
        </v-btn>
      </div>
      <div class="axis-widget position-absolute">
        <span class="axis-y position-absolute">Y</span>
        <svg
          viewBox="0 0 52 52"
          aria-hidden="true"
        >
          <path
            d="M16 38V10"
            stroke="#6ac7a3"
          />
          <path
            d="m13 15 3-5 3 5"
            stroke="#6ac7a3"
            fill="none"
          />
          <path
            d="M16 38h27"
            stroke="#dc947d"
          />
          <path
            d="m38 35 5 3-5 3"
            stroke="#dc947d"
            fill="none"
          />
          <circle
            cx="16"
            cy="38"
            r="3"
            fill="#17232e"
            stroke="#8ba7bd"
          />
        </svg>
        <span class="axis-x position-absolute">X</span>
      </div>
      <div class="canvas-hint position-absolute d-flex align-center justify-center">
        <span>휠 <b>확대·축소</b></span>
        <i />
        <span>Space + 드래그 <b>화면 이동</b></span>
        <i />
        <span>우클릭 <b>편집 메뉴</b></span>
      </div>
    </div>
    <div class="map-summary d-flex align-center justify-space-between flex-shrink-0">
      <span class="editable-state d-flex align-center"
        ><span class="state-dot flex-shrink-0"></span
        >{{ editor.readOnly ? '읽기 전용' : '편집 모드' }}</span
      >
      <div>
        <span
          ><i class="legend-node flex-shrink-0"></i>노드<strong>{{
            editor.document.nodes.length
          }}</strong></span
        ><span
          ><i class="legend-path flex-shrink-0"></i>경로<strong>{{
            editor.document.edges.length
          }}</strong></span
        ><span
          ><i class="legend-port flex-shrink-0"></i>포트<strong>{{
            editor.document.ports.length
          }}</strong></span
        >
      </div>
      <span class="render-engine align-center">영역 선택 {{ editor.selectedIds.length }}개</span>
    </div>
  </section>
</template>

<style scoped lang="scss">
// 화면 구성과 고유 시각 요소에 필요한 컴포넌트 전용 스타일

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
.map-canvas-panel {
  min-height: 0;
  min-width: 0;
}
.viewport-container {
  flex: 1;
  min-height: 0;
  background: var(--canvas);
}
.canvas-heading {
  top: 25px;
  left: 26px;
  pointer-events: none;
}
.scene-state {
  gap: 6px;
  font-size: 8px;
  letter-spacing: 1.5px;
  color: #77b6a4;
}
.scene-state .state-dot {
  width: 4px;
  height: 4px;
}
.canvas-heading strong {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 9px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
.canvas-heading strong > span {
  font: 9px var(--font-mono);
  color: var(--text-secondary);
  font-weight: 400;
  padding-left: 10px;
  border-left: 1px solid #293c4a;
}
.legacy-notice {
  top: 84px;
  left: 26px;
  right: 26px;
  background: var(--notice-bg);
  color: var(--notice-text);
  padding: 10px 12px;
  border: 1px solid var(--notice-border);
  border-radius: 6px;
  font-size: 11px;
  gap: 7px;
  pointer-events: none;
}
.canvas-legend {
  gap: 17px;
  left: 26px;
  bottom: 58px;
  padding: 9px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 5px;
  pointer-events: none;
}
.canvas-legend > span {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10px;
  color: var(--text-secondary);
}
.legend-node {
  display: inline-block;
  width: 6px;
  height: 6px;
  border: 1px solid #82b4d0;
  border-radius: 50%;
}
.legend-path {
  display: inline-block;
  width: 12px;
  height: 1px;
  background: #46a3d4;
}
.legend-port {
  display: inline-block;
  width: 7px;
  height: 7px;
  background: #368c7a;
  border-radius: 1px;
}
.canvas-controls {
  right: 22px;
  bottom: 55px;
  gap: 3px;
  border: 1px solid #30434f;
  background: var(--surface);
  color: var(--text-secondary);
  border-radius: 7px;
  box-shadow: 0 4px 15px #020a1033;
}
.canvas-controls button {
  width: 29px;
  height: 27px;
}
.canvas-controls button:hover {
  background: var(--hover);
}
.canvas-controls > span {
  min-width: 42px;
  text-align: center;
  font: 10px var(--font-mono);
  color: var(--text-secondary);
}
.canvas-controls > i {
  width: 1px;
  height: 17px;
  background: var(--hover);
  margin: 0 4px;
}
.axis-widget {
  top: 20px;
  right: 24px;
  width: 52px;
  height: 52px;
  pointer-events: none;
}
.axis-widget svg {
  position: absolute;
  inset: 0;
}
.axis-x {
  right: -3px;
  bottom: 8px;
  font: 9px var(--font-mono);
  color: #dc947d;
}
.axis-y {
  top: -1px;
  left: 13px;
  font: 9px var(--font-mono);
  color: #6ac7a3;
}
.canvas-hint {
  bottom: 18px;
  left: 15px;
  right: 15px;
  gap: 11px;
  color: var(--text-secondary);
  font-size: 9px;
  pointer-events: none;
}
.canvas-hint b {
  font-weight: 400;
  color: var(--text-secondary);
  margin-left: 5px;
}
.canvas-hint > i {
  width: 2px;
  height: 2px;
  background: #456274;
  border-radius: 50%;
}
.map-summary {
  height: 37px;
  background: var(--surface);
  color: var(--text-secondary);
  padding: 0 18px;
  font-size: 10px;
  border-top: 1px solid #2a3a46;
}
.editable-state {
  gap: 6px;
  color: #7eb49f;
}
.editable-state .state-dot {
  width: 4px;
  height: 4px;
}
.map-summary > div {
  display: flex;
  gap: 22px;
}
.map-summary > div > span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.map-summary strong {
  font: 10px var(--font-mono);
  color: var(--text-secondary);
  margin-left: 2px;
}
.render-engine {
  display: flex;
  gap: 5px;
  font-size: 9px;
  color: var(--text-secondary);
}
.empty-map {
  inset: 0;
  color: #81a6b7;
  pointer-events: none;
}
.empty-map > div {
  height: 70px;
  width: 70px;
  border: 1px solid #2b4553;
  border-radius: 17px;
  background: var(--surface);
  color: #68aa94;
  display: grid;
  place-items: center;
  margin-bottom: 22px;
}
.empty-map h2 {
  font-size: 21px;
  font-weight: 400;
  color: var(--text-secondary);
}
.empty-map p {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 12px;
}
.empty-map button {
  pointer-events: auto;
  margin-top: 24px;
  padding: 10px 15px;
  background: #234b42;
  color: #90ceb6;
  border-color: #326457;
  font-size: 11px;
}
.empty-map button:hover {
  background: #315e50;
}
.empty-map kbd {
  border-color: #426859;
  background: #2b5548;
  color: #89b49f;
  margin-left: 6px;
  font-size: 9px;
}
@media (max-width: 1330px) {
  .map-summary > div {
    gap: 14px;
  }
  .render-engine {
    display: none;
  }
}
</style>
