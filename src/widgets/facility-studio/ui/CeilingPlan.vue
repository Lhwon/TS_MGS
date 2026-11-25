<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { snapToStep } from '../lib/transformSnap'

type PlanPoint = { x: number; y: number }
type Fixture = PlanPoint & { id: string; name: string; width: number; depth: number; rotation: number }
const props = defineProps<{
  name: string
  width: number
  depth: number
  fixtures: Fixture[]
  selected: string | null
  pending: string
  snap: number
  disabled: boolean
}>()
const emit = defineEmits<{
  select: [id: string]
  place: [point: PlanPoint]
  move: [fixture: Fixture]
  'drag-over': [event: DragEvent]
  'drop-fixture': [event: DragEvent, point: PlanPoint]
}>()
const board = ref<HTMLElement>()
const preview = shallowRef<Fixture>()
let gesture: { id: number; start: PlanPoint; fixture: Fixture; rotate: boolean } | undefined
const active = computed(() => preview.value ?? props.fixtures.find((item) => item.id === props.selected))

const pointAt = (event: MouseEvent) => {
  const rect = board.value!.getBoundingClientRect()
  return {
    x: ((event.clientX - rect.left) / rect.width - 0.5) * props.width,
    y: (0.5 - (event.clientY - rect.top) / rect.height) * props.depth,
  }
}
const limit = (value: number, span: number) => Math.min(span / 2, Math.max(-span / 2, value))
const snappedPoint = (point: PlanPoint, free: boolean) => ({
  x: limit(free ? point.x : snapToStep(point.x, props.snap), props.width),
  y: limit(free ? point.y : snapToStep(point.y, props.snap), props.depth),
})

function begin(event: PointerEvent, fixture: Fixture, rotate = false) {
  if (props.disabled || event.button !== 0 || gesture || !board.value) return
  event.preventDefault()
  emit('select', fixture.id)
  gesture = { id: event.pointerId, start: pointAt(event), fixture, rotate }
  board.value.setPointerCapture(event.pointerId)
}

function move(event: PointerEvent) {
  const drag = gesture
  if (event.pointerId !== drag?.id) return
  const { start, fixture, rotate } = drag
  const point = pointAt(event)
  if (!preview.value && start.x === point.x && start.y === point.y) return
  if (rotate) {
    const angle = (p: PlanPoint) => Math.atan2(p.y - fixture.y, p.x - fixture.x)
    const next = fixture.rotation + (angle(point) - angle(start)) * 180 / Math.PI
    preview.value = { ...fixture, rotation: ((event.altKey ? next : snapToStep(next, 15)) % 360 + 360) % 360 }
  } else {
    preview.value = {
      ...fixture,
      ...snappedPoint({ x: fixture.x + point.x - start.x, y: fixture.y + point.y - start.y }, event.altKey),
    }
  }
}

function end(event: PointerEvent) {
  const drag = gesture
  if (!drag || event.pointerId !== drag.id) return
  if (event.type === 'pointerup' && preview.value) {
    move(event)
    const item = preview.value
    if (!props.disabled && item && (item.x !== drag.fixture.x || item.y !== drag.fixture.y ||
      item.rotation !== drag.fixture.rotation)) emit('move', item)
  }
  cancel()
}

function cancel() {
  const id = gesture?.id
  gesture = undefined
  preview.value = undefined
  if (id !== undefined && board.value?.hasPointerCapture(id)) board.value.releasePointerCapture(id)
}

function style(fixture: Fixture) {
  const item = preview.value?.id === fixture.id ? preview.value : fixture
  return {
    left: `${(item.x / props.width + 0.5) * 100}%`,
    top: `${(0.5 - item.y / props.depth) * 100}%`,
    width: `${item.width * 100 / props.width}%`,
    height: `${item.depth * 100 / props.depth}%`,
    transform: `translate(-50%, -50%) rotate(${-item.rotation}deg)`,
  }
}
</script>

<template>
  <section class="ceiling-plan" data-testid="ceiling-plan" @keydown.esc.stop="cancel">
    <header>
      <strong>{{ name }} · 천장 배치도</strong>
      <span>{{ Math.round(width) }} × {{ Math.round(depth) }} mm</span>
    </header>
    <div class="board-space">
      <div
        ref="board"
        class="ceiling-board"
        :class="{ pending }"
        :style="{ '--ratio': width / depth }"
        data-testid="ceiling-plan-board"
        @click.self="!disabled && pending && emit('place', snappedPoint(pointAt($event), $event.altKey))"
        @dragover="emit('drag-over', $event)"
        @drop="emit('drop-fixture', $event, snappedPoint(pointAt($event), $event.altKey))"
        @pointermove="move"
        @pointerup="end"
        @pointercancel="end"
        @lostpointercapture="end"
      >
        <div
          v-for="fixture in fixtures"
          :key="fixture.id"
          class="fixture"
          :class="{ selected: selected === fixture.id }"
          :style="style(fixture)"
        >
          <button
            type="button"
            class="fixture-body"
            data-testid="ceiling-fixture"
            :aria-label="fixture.name"
            :aria-pressed="selected === fixture.id"
            :title="fixture.name"
            @pointerdown="begin($event, fixture)"
            @click.stop="emit('select', fixture.id)"
          />
          <button
            v-if="selected === fixture.id && !disabled"
            type="button"
            class="rotate"
            title="조명 회전"
            aria-label="조명 회전"
            data-testid="ceiling-fixture-rotate"
            @pointerdown.stop="begin($event, fixture, true)"
            @click.stop
          >↻</button>
        </div>
      </div>
    </div>
    <footer aria-live="polite">
      <template v-if="pending">{{ pending }} · 천장 위에 놓을 위치를 클릭하세요.</template>
      <template v-else-if="active">{{ active.name }} · {{ Math.round(active.x) }}, {{ Math.round(active.y) }} mm · {{ Math.round(active.rotation) }}°</template>
      <template v-else>카탈로그에서 조명이나 레일을 끌어 놓으세요.</template>
    </footer>
  </section>
</template>

<style scoped>
.ceiling-plan { display: flex; flex: 1; flex-direction: column; min-height: 0; padding: 16px; gap: 12px; background: var(--surface); }
header { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
header span, footer { color: var(--text-secondary); font-size: 12px; }
.board-space { flex: 1; min-height: 160px; display: grid; place-items: center; container-type: size; }
.ceiling-board {
  position: relative; width: min(95cqw, calc(94cqh * var(--ratio))); aspect-ratio: var(--ratio);
  background: var(--surface-muted); box-shadow: 0 0 0 1px var(--border);
  touch-action: none; user-select: none;
}
.ceiling-board.pending { cursor: crosshair; }
.fixture {
  position: absolute; min-width: 12px; min-height: 12px;
  border: 1px solid var(--accent); border-radius: 3px; background: color-mix(in srgb, var(--accent) 35%, var(--surface));
}
.fixture.selected { z-index: 1; outline: 2px solid var(--accent); }
.fixture-body { display: block; height: 100%; width: 100%; min-height: 12px; cursor: move; }
.rotate {
  position: absolute; inset: 50% auto auto calc(100% + 8px); transform: translateY(-50%);
  width: 23px; height: 23px; border-radius: 50%; background: var(--surface); cursor: grab; color: var(--text);
}
</style>
