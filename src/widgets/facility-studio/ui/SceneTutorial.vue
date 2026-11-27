<!-- 실제 조작 대상을 강조하고 편집 결과를 확인하는 단계별 연습 안내 구성 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  TutorialScenario,
  TutorialState,
} from '@/widgets/facility-studio/lib/sceneTutorial.ts'

const props = defineProps<{ scenario: TutorialScenario; state: TutorialState }>()
const emit = defineEmits<{ close: []; complete: [] }>()
const index = ref(0)
const card = ref<HTMLElement>()
const root = ref<HTMLElement>()
const rect = ref<{ left: number; top: number; width: number; height: number }>()
const cardStyle = ref<Record<string, string>>({ left: '16px', bottom: '16px' })
const step = computed(() => props.scenario.steps[index.value]!)
const done = computed(() => step.value.done(props.state))
const selector = computed(() =>
  typeof step.value.target === 'function' ? step.value.target(props.state) : step.value.target,
)
const task = computed(() =>
  typeof step.value.task === 'function' ? step.value.task(props.state) : step.value.task,
)
const focusBefore = document.activeElement as HTMLElement | null
let target: HTMLElement | null = null
let frame = 0
let observer: ResizeObserver | undefined

/** 현재 화면 안으로 제한한 강조 영역과 안내 카드 위치 갱신 */
const measure = () => {
  frame = 0
  if (!target?.isConnected) {
    rect.value = undefined
    return
  }
  const bounds = target.getBoundingClientRect()
  const left = Math.max(0, bounds.left - 4),
    top = Math.max(0, bounds.top - 4)
  const right = Math.min(innerWidth, bounds.right + 4),
    bottom = Math.min(innerHeight, bounds.bottom + 4)
  if (right <= left || bottom <= top) {
    rect.value = undefined
    return
  }
  rect.value = { left, top, width: right - left, height: bottom - top }
  const width = Math.min(340, innerWidth - 24),
    height = Math.min(card.value?.offsetHeight ?? 290, innerHeight - 24)
  const candidates = [
    { left: 12, top: innerHeight - height - 12 },
    { left: innerWidth - width - 12, top: innerHeight - height - 12 },
    { left: 12, top: 170 },
    { left: innerWidth - width - 12, top: 170 },
  ].map((position) => ({
    ...position,
    top: Math.max(12, Math.min(position.top, innerHeight - height - 12)),
  }))
  const overlap = (p: { left: number; top: number }) =>
    Math.max(0, Math.min(right, p.left + width) - Math.max(left, p.left)) *
    Math.max(0, Math.min(bottom, p.top + height) - Math.max(top, p.top))
  candidates.sort((a, b) => overlap(a) - overlap(b))
  cardStyle.value = { left: `${candidates[0]!.left}px`, top: `${candidates[0]!.top}px` }
}

/** 크기 및 스크롤 변경을 하나의 화면 갱신으로 병합 */
const scheduleMeasure = () => {
  if (!frame) frame = requestAnimationFrame(measure)
}

/** 단계 전환 후 표시된 실제 조작 요소를 찾아 강조하고 키보드 초점 이동 */
const locate = async () => {
  observer?.disconnect()
  await nextTick()
  target = document.querySelector<HTMLElement>(selector.value)
  target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
  if (target) observer?.observe(target)
  if (card.value) observer?.observe(card.value)
  measure()
  if (!step.value.readOnly) target?.focus({ preventScroll: true })
  else card.value?.focus({ preventScroll: true })
}

/** 연습 대상과 안내 카드 이외의 파일 작업 및 화면 전환 방지 */
const allowEvent = (event: Event) => {
  const element = event.target as Node | null
  const insideCard = !!element && !!root.value?.contains(element)
  const insideTarget = !!element && !step.value.readOnly && !!target?.contains(element)
  if (!insideCard && !insideTarget) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}

/** 연습 중 저장 단축키를 차단하고 초점을 현재 단계 안에서 유지 */
const keydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    emit('close')
    return
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    ['s', 'o', 'z', 'y', 'n'].includes(event.key.toLowerCase())
  ) {
    event.preventDefault()
    event.stopImmediatePropagation()
    return
  }
  if (event.key === 'Tab') {
    const elements = [
      ...(!step.value.readOnly && target
        ? [target, ...target.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"]')]
        : []),
      ...(root.value?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []),
    ].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.hasAttribute('disabled') &&
        element.getClientRects().length,
    )
    const current = elements.indexOf(document.activeElement as HTMLElement)
    event.preventDefault()
    event.stopImmediatePropagation()
    elements[(current + (event.shiftKey ? -1 : 1) + elements.length) % elements.length]?.focus()
    return
  }
  allowEvent(event)
}

/** 완료 조건을 통과한 단계만 다음 설명으로 이동 */
const next = () => {
  if (!done.value) return
  if (index.value === props.scenario.steps.length - 1) emit('complete')
  else index.value++
}

watch(selector, locate, { flush: 'post' })
onMounted(() => {
  observer = new ResizeObserver(scheduleMeasure)
  window.addEventListener('resize', scheduleMeasure)
  document.addEventListener('scroll', scheduleMeasure, true)
  document.addEventListener('pointerdown', allowEvent, true)
  document.addEventListener('click', allowEvent, true)
  document.addEventListener('keydown', keydown, true)
  void locate()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  cancelAnimationFrame(frame)
  window.removeEventListener('resize', scheduleMeasure)
  document.removeEventListener('scroll', scheduleMeasure, true)
  document.removeEventListener('pointerdown', allowEvent, true)
  document.removeEventListener('click', allowEvent, true)
  document.removeEventListener('keydown', keydown, true)
  if (focusBefore?.isConnected) focusBefore.focus({ preventScroll: true })
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="scene-tutorial"
      :data-tutorial-step="step.id"
      aria-label="3D 사용법 연습"
    >
      <template v-if="rect">
        <div
          class="tutorial-shade"
          :style="{ top: 0, left: 0, width: '100%', height: `${rect.top}px` }"
        />
        <div
          class="tutorial-shade"
          :style="{
            top: `${rect.top}px`,
            left: 0,
            width: `${rect.left}px`,
            height: `${rect.height}px`,
          }"
        />
        <div
          class="tutorial-shade"
          :style="{
            top: `${rect.top}px`,
            left: `${rect.left + rect.width}px`,
            right: 0,
            height: `${rect.height}px`,
          }"
        />
        <div
          class="tutorial-shade"
          :style="{ top: `${rect.top + rect.height}px`, left: 0, right: 0, bottom: 0 }"
        />
        <div
          class="tutorial-target"
          :class="{ 'tutorial-target-blocked': step.readOnly }"
          :style="{
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          }"
        />
      </template>
      <div
        v-else
        class="tutorial-shade tutorial-fallback"
      />
      <section
        ref="card"
        class="tutorial-card"
        :style="cardStyle"
        tabindex="-1"
        role="region"
        aria-labelledby="tutorial-title"
      >
        <div class="tutorial-heading">
          <span>실습 모드 · {{ index + 1 }} / {{ scenario.steps.length }}</span>
          <button
            type="button"
            data-testid="tutorial-exit"
            @click="emit('close')"
          >
            종료
          </button>
        </div>
        <progress
          :value="index + (done ? 1 : 0)"
          :max="scenario.steps.length"
          aria-label="튜토리얼 진행률"
        />
        <div
          aria-live="polite"
          aria-atomic="true"
        >
          <h2 id="tutorial-title">{{ step.title }}</h2>
          <p>{{ step.description }}</p>
          <p class="tutorial-task">{{ task }}</p>
          <small v-if="!rect">안내할 위치가 가려져 있습니다. 위치 다시 찾기를 누르세요.</small>
          <small v-else>
            {{
              done
                ? '완료했습니다. 다음 단계로 진행하세요.'
                : '강조된 위치에서 안내한 동작을 직접 해보세요.'
            }}
          </small>
        </div>
        <div class="tutorial-actions">
          <button
            type="button"
            @click="locate"
          >
            위치 다시 찾기
          </button>
          <button
            type="button"
            class="tutorial-next"
            data-testid="tutorial-next"
            :disabled="!done"
            @click="next"
          >
            {{ index === scenario.steps.length - 1 ? '완료하고 돌아가기' : '다음' }}
          </button>
        </div>
        <small class="tutorial-footnote">연습 변경은 저장되지 않습니다 · Esc로 종료</small>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/** 실제 조작 영역을 제외한 배경 차폐와 브랜드 강조 적용 */
.scene-tutorial {
  position: fixed;
  inset: 0;
  z-index: 2500;
  pointer-events: none;
}
.tutorial-shade {
  position: fixed;
  background: #0009;
  pointer-events: auto;
}
.tutorial-fallback {
  inset: 0;
}
.tutorial-target {
  position: fixed;
  border: 2px solid var(--accent);
  border-radius: 5px;
  pointer-events: none;
  box-shadow: 0 0 0 2px #fff5;
}
.tutorial-target-blocked {
  pointer-events: auto;
}
/** 테마를 공유하는 단계 설명과 실행 조건 안내 카드 구성 */
.tutorial-card {
  position: fixed;
  width: min(340px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 4px 14px #0004;
  pointer-events: auto;
}
.tutorial-heading,
.tutorial-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tutorial-heading {
  font-size: 12px;
  color: var(--text-secondary);
}
progress {
  width: 100%;
  height: 5px;
  accent-color: var(--accent);
  margin: 10px 0;
}
h2 {
  font-size: 17px;
  margin: 0 0 8px;
}
p {
  font-size: 13px;
  line-height: 1.65;
  margin: 0 0 10px;
}
.tutorial-task {
  border-inline-start: 3px solid var(--accent);
  padding-inline-start: 9px;
  font-weight: 600;
}
small {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.tutorial-actions {
  margin-top: 14px;
}
button {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 10px;
  color: var(--text);
  background: var(--surface-soft);
  cursor: pointer;
  font-size: 12px;
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.tutorial-next {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.tutorial-footnote {
  display: block;
  margin-top: 12px;
}
</style>
