<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { WallDoor } from '@/entities/facility/index.ts'
import { snapToStep } from '../lib/transformSnap'

const props = defineProps<{
  name: string
  doors: WallDoor[]
  width: number
  height: number
  focus: string
  snap: number
  disabled: boolean
  mountedObjects: { id: string; name: string; x: number; y: number }[]
  pending: string
}>()
const emit = defineEmits<{
  focus: [id: string]
  apply: [doors: WallDoor[], focus: string]
  select: [id: string]
  place: [point: { x: number; y: number }]
  'drag-over': [event: DragEvent]
  'drop-fixture': [event: DragEvent, point: { x: number; y: number }]
}>()
const board = ref<HTMLElement>()
const handles = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as const
type Handle = (typeof handles)[number]
let gesture: { id: number; startX: number; startY: number; original: WallDoor; handle?: Handle } | undefined
const preview = shallowRef<WallDoor>()
const invalid = computed(() => {
  const door = preview.value
  return !!door && props.doors.some((other) => other.id !== door.id &&
    door.offset - door.width / 2 < other.offset + other.width / 2 &&
    other.offset - other.width / 2 < door.offset + door.width / 2)
})
const selected = computed(() => preview.value ?? props.doors.find((door) => door.id === props.focus))
const dimensions = (value: number) => Math.round(value * 10) / 10
const current = (door: WallDoor) => preview.value?.id === door.id ? preview.value : door

function begin(event: PointerEvent, door: WallDoor, handle?: Handle) {
  if (props.disabled || event.button !== 0 || gesture || !board.value) return
  event.preventDefault()
  emit('focus', door.id)
  gesture = { id: event.pointerId, startX: event.clientX, startY: event.clientY, original: door, handle }
  board.value.setPointerCapture(event.pointerId)
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function move(event: PointerEvent) {
  const drag = gesture
  if (!drag || event.pointerId !== drag.id || !board.value) return
  if (!preview.value && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) return
  const rect = board.value.getBoundingClientRect()
  const dx = (event.clientX - drag.startX) * props.width / rect.width
  const dz = (drag.startY - event.clientY) * props.height / rect.height
  const snap = (value: number) => event.altKey ? value : snapToStep(value, props.snap)
  const { original, handle } = drag
  const window = original.kind === 'window'
  const sill = original.sill ?? 0
  const half = props.width / 2
  if (!handle) {
    const limit = half - original.width / 2
    preview.value = {
      ...original,
      offset: clamp(snap(original.offset + dx), -limit, limit),
      ...(window ? { sill: clamp(snap(sill + dz), 0, props.height - original.height) } : {}),
    }
    return
  }
  let left = original.offset - original.width / 2
  let right = original.offset + original.width / 2
  let bottom = sill
  let top = sill + original.height
  if (handle.includes('w')) left = clamp(snap(left + dx), -half, right - 100)
  if (handle.includes('e')) right = clamp(snap(right + dx), left + 100, half)
  if (handle.includes('n')) top = clamp(snap(top + dz), bottom + 200, props.height)
  if (window && handle.includes('s')) bottom = clamp(snap(bottom + dz), 0, top - 200)
  preview.value = {
    ...original, offset: (right + left) / 2, width: right - left, height: top - bottom,
    ...(window ? { sill: bottom } : {}),
  }
}

function end(event: PointerEvent) {
  const drag = gesture
  if (!drag || event.pointerId !== drag.id) return
  if (event.type === 'pointerup' && preview.value) move(event)
  const door = preview.value
  const original = drag.original
  const changed = door && (door.offset !== original.offset || door.width !== original.width ||
    door.height !== original.height || door.sill !== original.sill)
  if (event.type === 'pointerup' && changed && !invalid.value && !props.disabled)
    emit('apply', props.doors.map((item) => item.id === door.id ? door : item), door.id)
  cancel()
}

function cancel() {
  const id = gesture?.id
  gesture = undefined
  preview.value = undefined
  if (id !== undefined && board.value?.hasPointerCapture(id)) board.value.releasePointerCapture(id)
}

function mountPoint(event: MouseEvent) {
  const rect = board.value!.getBoundingClientRect()
  const snap = (value: number) => event.altKey ? value : snapToStep(value, props.snap)
  return {
    x: clamp(snap(((event.clientX - rect.left) / rect.width - 0.5) * props.width), -props.width / 2, props.width / 2),
    y: clamp(snap((1 - (event.clientY - rect.top) / rect.height) * props.height), 0, props.height),
  }
}

function rectangle(door: WallDoor) {
  const item = current(door)
  return {
    left: `${(item.offset - item.width / 2 + props.width / 2) * 100 / props.width}%`,
    bottom: `${(item.sill ?? 0) * 100 / props.height}%`,
    width: `${item.width * 100 / props.width}%`,
    height: `${item.height * 100 / props.height}%`,
  }
}
</script>

<template>
  <section class="wall-elevation" data-testid="wall-elevation" @keydown.esc.stop="cancel">
    <header>
      <strong>{{ name }} · 정면</strong>
      <span>{{ dimensions(width) }} × {{ dimensions(height) }} mm</span>
    </header>
    <div class="board-space">
      <div
        ref="board"
        class="wall-board"
        data-testid="wall-elevation-board"
        :style="{ '--ratio': width / height }"
        :class="{ pending }"
        @click.self="!disabled && pending && emit('place', mountPoint($event))"
        @dragover="emit('drag-over', $event)"
        @drop="emit('drop-fixture', $event, mountPoint($event))"
        @pointermove="move"
        @pointerup="end"
        @pointercancel="end"
        @lostpointercapture="end"
      >
        <div
          v-for="door in doors"
          :key="door.id"
          class="opening"
          :class="{ selected: focus === door.id, window: door.kind === 'window', invalid: preview?.id === door.id && invalid }"
          :style="rectangle(door)"
        >
          <button
            type="button"
            class="opening-body"
            data-testid="wall-opening-move"
            :aria-label="door.kind === 'window' ? '창문 선택 또는 이동' : '문 선택 또는 이동'"
            :aria-pressed="focus === door.id"
            :disabled="disabled"
            @click="emit('focus', door.id)"
            @pointerdown="begin($event, door)"
          >
            {{ door.kind === 'window' ? '창문' : '문' }}
          </button>
          <template v-if="focus === door.id && !disabled">
            <span
              v-for="handle in (door.kind === 'window' ? handles : handles.slice(0, 5))"
              :key="handle"
              class="handle"
              :class="handle"
              :data-testid="`wall-opening-resize-${handle}`"
              aria-hidden="true"
              @pointerdown.stop="begin($event, door, handle)"
            />
          </template>
        </div>
        <button
          v-for="item in mountedObjects"
          :key="item.id"
          type="button"
          class="mounted-object"
          :style="{ left: `${(item.x / width + 0.5) * 100}%`, bottom: `${item.y * 100 / height}%` }"
          :title="item.name"
          :aria-label="item.name"
          @click.stop="emit('select', item.id)"
        >{{ item.name }}</button>
      </div>
    </div>
    <footer :class="{ warning: invalid }" aria-live="polite">
      <template v-if="invalid">같은 벽에서 문과 창문의 가로 위치가 겹칩니다.</template>
      <template v-else-if="pending">{{ pending }} · 벽에 놓을 위치를 클릭하세요.</template>
      <template v-else-if="selected">
        {{ dimensions(selected.width) }} × {{ dimensions(selected.height) }} mm
        <span v-if="selected.kind === 'window'"> · 하단 {{ dimensions(selected.sill ?? 0) }} mm</span>
      </template>
      <template v-else>문이나 창문을 추가한 뒤 본체를 끌어 이동하고 손잡이를 끌어 크기를 조절하세요.</template>
    </footer>
  </section>
</template>

<style scoped>
.wall-elevation { display: flex; flex: 1; flex-direction: column; min-height: 0; padding: 16px; gap: 12px; background: var(--surface); }
header { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
header span, footer { color: var(--text-secondary); font-size: 12px; }
.board-space { flex: 1; min-height: 160px; display: grid; place-items: center; container-type: size; }
.wall-board {
  position: relative; width: min(96cqw, calc(94cqh * var(--ratio))); aspect-ratio: var(--ratio);
  background: var(--surface-muted); box-shadow: 0 0 0 1px var(--border), 0 3px 0 var(--text-secondary);
  touch-action: none; user-select: none;
}
.wall-board.pending { cursor: crosshair; }
.mounted-object {
  position: absolute; transform: translate(-50%, 50%); border-radius: 4px;
  padding: 2px 5px; font-size: 11px; background: var(--surface); color: var(--text);
}
.opening { position: absolute; border: 1px solid var(--text-secondary); background: var(--surface); }
.opening.window { background: color-mix(in srgb, var(--accent) 13%, var(--surface)); }
.opening.selected { z-index: 1; outline: 2px solid var(--accent); }
.opening.invalid { outline-color: #d05252; }
.opening-body { width: 100%; height: 100%; border: 0; cursor: move; overflow: hidden; color: var(--text); font-size: 12px; }
.handle { position: absolute; width: 12px; height: 12px; border-radius: 3px; background: var(--accent); border: 1px solid var(--surface); }
.nw, .n, .ne { top: -6px; }
.sw, .s, .se { bottom: -6px; }
.nw, .w, .sw { left: -6px; }
.ne, .e, .se { right: -6px; }
.n, .s { left: calc(50% - 6px); cursor: ns-resize; }
.w, .e { top: calc(50% - 6px); cursor: ew-resize; }
.nw, .se { cursor: nwse-resize; }
.ne, .sw { cursor: nesw-resize; }
.warning { color: #d05252; }
</style>
