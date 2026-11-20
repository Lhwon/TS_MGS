<!--
 * 파일명: WallDoorEditor.vue
 * 설명: 기존 벽에 문을 추가하고 위치와 실제 치수를 편집하는 패널
 * 작성자: 이희원
 * 작성일자: 2026-11-20
-->
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { WallDoor } from '@/entities/facility/index.ts'

const props = defineProps<{ doors: WallDoor[]; width: number; height: number }>()
const emit = defineEmits<{ apply: [doors: WallDoor[]] }>()
const id = ref('')
const draft = reactive({ offset: 0, width: 1040, height: 2160 })
const active = computed(() => props.doors.find((door) => door.id === id.value))
const gaps = computed(() => {
  let left = -props.width / 2
  const ranges = []
  for (const door of props.doors) {
    ranges.push([left, door.offset - door.width / 2] as const)
    left = door.offset + door.width / 2
  }
  ranges.push([left, props.width / 2])
  return ranges.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
})
watch(
  [active, gaps, () => props.height],
  ([door, ranges, height]) => {
    if (door) {
      Object.assign(draft, { offset: door.offset, width: door.width, height: door.height })
      return
    }
    const [left, right] = ranges[0]!
    Object.assign(draft, {
      offset: (left + right) / 2,
      width: Math.max(100, Math.min(1040, right - left)),
      height: Math.max(200, Math.min(2160, height)),
    })
  },
  { immediate: true },
)

/** 기존 문을 수정하거나 벽에 문 하나를 추가 */
const apply = () => {
  const door = { id: active.value?.id ?? crypto.randomUUID(), ...draft }
  id.value = door.id
  emit(
    'apply',
    active.value
      ? props.doors.map((item) => (item.id === door.id ? door : item))
      : [...props.doors, door],
  )
}

/** 문을 제거해 벽 개구부를 복원 */
const remove = () => {
  emit(
    'apply',
    props.doors.filter((door) => door.id !== id.value),
  )
  id.value = ''
}
</script>

<template>
  <form
    class="d-flex flex-column ga-2 mb-4"
    data-testid="wall-door-editor"
    @submit.prevent="apply"
  >
    <h2 class="ma-0">벽에 문 붙이기</h2>
    <v-select
      v-model="id"
      label="편집할 문"
      :items="[
        { title: '새 문 추가', value: '' },
        ...doors.map((door, index) => ({ title: '문 ' + (index + 1), value: door.id })),
      ]"
      hide-details
    />
    <v-text-field
      v-model.number="draft.offset"
      type="number"
      step="any"
      required
      label="벽 중심에서 문 중심까지 (mm)"
      data-testid="wall-door-offset"
      persistent-hint
      hint="벽의 길이 방향에서 음수와 양수로 위치를 지정합니다."
    />
    <div class="d-flex ga-2">
      <v-text-field
        v-model.number="draft.width"
        type="number"
        step="any"
        min="100"
        :max="width"
        required
        label="문 폭 (mm)"
        data-testid="wall-door-width"
      />
      <v-text-field
        v-model.number="draft.height"
        type="number"
        step="any"
        min="200"
        :max="height"
        required
        label="문 높이 (mm)"
        data-testid="wall-door-height"
      />
    </div>
    <div class="d-flex ga-2">
      <v-btn
        type="submit"
        color="primary"
        :text="active ? '문 변경 적용' : '문 붙이기'"
        data-testid="wall-door-apply"
      />
      <v-btn
        v-if="active"
        type="button"
        text="문 제거"
        @click="remove"
      />
    </div>
  </form>
</template>
