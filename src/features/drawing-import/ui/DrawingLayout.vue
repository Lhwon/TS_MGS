<!--
 * 파일명: DrawingLayout.vue
 * 설명: 편집용 도면의 자르기와 표시 및 실제 폭을 선택적으로 조절하는 비모달 패널
 * 작성자: 이희원
 * 작성일자: 2026-11-16
-->
<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import type { MapDocument, MapLayout } from '@/entities/map/index.ts'
import { createLayout, trimDrawing } from '@/features/drawing-import/model/layout.ts'
import { prepareDrawing } from '@/features/drawing-import/model/drawing.ts'
import type { DrawingAttachment } from '@/features/drawing-import/model/types.ts'
const open = defineModel<boolean>({ default: false })
const props = defineProps<{ map: MapDocument }>()
const emit = defineEmits<{ apply: [layout: MapLayout]; remove: [] }>()
const drawing = shallowRef<DrawingAttachment>(),
  fileInput = ref<HTMLInputElement>()
const error = ref(''),
  busy = ref(false),
  opacity = ref(50),
  width = ref<number | null>(null),
  x = ref(0),
  y = ref(0),
  rotation = ref(0)
const crop = ref({ x: 0, y: 0, width: 1, height: 1 })
let drag: { x: number; y: number } | undefined
/** 원본 픽셀과 배경 표시 설정을 초기화하는 도면 준비 */
const load = async (file: File) => {
  busy.value = true
  error.value = ''
  try {
    const value = await prepareDrawing(file)
    drawing.value = value
    crop.value = { x: 0, y: 0, width: value.width, height: value.height }
    width.value = null
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
/** 기존 배경 설정을 열며 원본 영상과 자르기 범위를 복원하는 수동 도구 초기화 */
watch(open, async (value) => {
  if (!value || !props.map.layout) return
  const layout = props.map.layout,
    source = layout.sourceImage ?? layout.image
  const bytes = Uint8Array.from(atob(source.split(',')[1]), (character) => character.charCodeAt(0))
  await load(new File([bytes], layout.name, { type: source.slice(5, source.indexOf(';')) }))
  if (drawing.value)
    Object.assign(drawing.value, {
      id: layout.id,
      width: layout.sourceWidth,
      height: layout.sourceHeight,
    })
  crop.value = { ...layout.crop }
  opacity.value = layout.opacity * 100
  width.value = layout.calibrated ? layout.width : null
  x.value = layout.x
  y.value = layout.y
  rotation.value = layout.rotation
})
/** 파일 선택으로 참조 도면만 읽는 수동 열기 */
const choose = async (event: Event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.name.endsWith('.json')) {
    try {
      const layout = JSON.parse(await file.text())
      emit('apply', layout)
    } catch (cause) {
      error.value = String(cause)
    }
    return
  }
  await load(file)
}
/** 흰 여백을 제외한 도면 영역 선택 */
const trim = () => {
  if (drawing.value) crop.value = trimDrawing(drawing.value)
}
/** 미리보기 좌표를 원본 이미지 위치로 변환하는 포인터 계산 */
const point = (event: PointerEvent) => {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return {
    x: Math.max(
      0,
      Math.min(
        drawing.value!.width,
        ((event.clientX - rect.left) / rect.width) * drawing.value!.width,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        drawing.value!.height,
        ((event.clientY - rect.top) / rect.height) * drawing.value!.height,
      ),
    ),
  }
}
/** 자르기 시작점을 기록하는 이미지 드래그 시작 */
const begin = (event: PointerEvent) => {
  if (!drawing.value) return
  drag = point(event)
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
/** 원본 크기를 유지하며 자르기 사각형을 갱신하는 이미지 드래그 */
const move = (event: PointerEvent) => {
  if (!drag || !drawing.value) return
  const end = point(event)
  crop.value = {
    x: Math.floor(Math.min(drag.x, end.x)),
    y: Math.floor(Math.min(drag.y, end.y)),
    width: Math.max(1, Math.floor(Math.abs(end.x - drag.x))),
    height: Math.max(1, Math.floor(Math.abs(end.y - drag.y))),
  }
}
/** 도면 배경만 적용하며 원래 지도 객체는 유지하는 저장 */
const apply = () => {
  try {
    if (!drawing.value) throw new Error('도면을 선택하세요.')
    const layout = createLayout(props.map, drawing.value, {
      crop: crop.value,
      opacity: opacity.value / 100,
      x: x.value,
      y: y.value,
      rotation: rotation.value,
      ...(width.value ? { widthMm: width.value } : {}),
    })
    emit('apply', layout)
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
/** 지도와 별도로 배경 설정을 보관하는 파일 저장 */
const save = () => {
  if (!props.map.layout) return
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(props.map.layout, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${props.map.layout.name}.layout.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>
<template>
  <section
    v-if="open"
    class="layout-panel pa-4"
    aria-label="도면 배경 편집"
    data-testid="layout-panel"
    @keydown.stop
    @pointerdown.stop
  >
    <header class="d-flex justify-space-between align-center mb-3">
      <strong>도면 배경</strong>
      <v-btn @click="open = false">닫기</v-btn>
    </header>
    <p class="text-caption mb-3">
      맵을 편집할 때 참고하는 도면입니다. 기존 노드와 경로는 변경하지 않습니다.
    </p>
    <input
      ref="fileInput"
      class="d-none"
      type="file"
      accept="image/png,image/jpeg,image/webp,application/json"
      data-testid="layout-file"
      @change="choose"
    />
    <div class="d-flex ga-1 mb-3">
      <v-btn
        :disabled="busy"
        @click="fileInput?.click()"
      >
        도면 선택
      </v-btn>
      <v-btn
        :disabled="!drawing"
        @click="trim"
      >
        흰 여백 자르기
      </v-btn>
      <v-btn
        :disabled="!drawing"
        @click="crop = { x: 0, y: 0, width: drawing!.width, height: drawing!.height }"
      >
        전체 영역
      </v-btn>
    </div>
    <div
      v-if="drawing"
      class="preview mb-3"
    >
      <img
        :src="drawing.image"
        alt="드래그하여 도면 자르기"
        draggable="false"
        @pointerdown="begin"
        @pointermove="move"
        @pointerup="drag = undefined"
        @pointercancel="drag = undefined"
      />
      <span
        :style="{
          left: (crop.x / drawing.width) * 100 + '%',
          top: (crop.y / drawing.height) * 100 + '%',
          width: (crop.width / drawing.width) * 100 + '%',
          height: (crop.height / drawing.height) * 100 + '%',
        }"
      />
    </div>
    <p
      v-if="drawing"
      class="text-caption mb-3"
    >
      {{ drawing.name }} · 드래그하여 사용할 영역 선택
    </p>
    <label>
      도면 표시 농도 {{ opacity }}%
      <input
        v-model.number="opacity"
        type="range"
        min="0"
        max="100"
      />
    </label>
    <details class="mt-3">
      <summary>위치와 실제 크기 직접 맞추기</summary>
      <div class="fields mt-2">
        <label>
          실제 가로 길이 mm
          <input
            v-model.number="width"
            type="number"
            min="1"
            placeholder="모르면 임시 맞춤"
          />
        </label>
        <label>
          회전 °
          <input
            v-model.number="rotation"
            type="number"
          />
        </label>
        <label>
          X
          <input
            v-model.number="x"
            type="number"
          />
        </label>
        <label>
          Y
          <input
            v-model.number="y"
            type="number"
          />
        </label>
      </div>
    </details>
    <p
      v-if="error"
      class="error mt-2"
      role="alert"
    >
      {{ error }}
    </p>
    <div class="d-flex justify-end ga-1 mt-3">
      <v-btn
        :disabled="!map.layout"
        @click="save"
      >
        설정 저장
      </v-btn>
      <v-btn
        :disabled="!map.layout"
        @click="emit('remove')"
      >
        배경 제거
      </v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :disabled="busy || !drawing"
        data-testid="layout-apply"
        @click="apply"
      >
        배경 적용
      </v-btn>
    </div>
  </section>
</template>
<style scoped lang="scss">
.layout-panel {
  position: absolute;
  top: 138px;
  left: 290px;
  width: 360px;
  max-height: calc(100% - 160px);
  overflow: auto;
  z-index: 60;
  border: 1px solid var(--app-border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow);
}
p {
  color: var(--text-secondary);
}
label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
}
input {
  display: block;
  width: 100%;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px;
  color: var(--text);
}
.fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
.preview {
  position: relative;
  display: inline-block;
  max-width: 100%;
  background: #fff;
}
.preview img {
  display: block;
  max-width: 100%;
  max-height: 240px;
  touch-action: none;
  cursor: crosshair;
}
.preview span {
  position: absolute;
  border: 2px solid var(--accent-fill);
  background: #ff990014;
  pointer-events: none;
}
.error {
  color: var(--app-danger);
}
summary {
  cursor: pointer;
}
</style>
