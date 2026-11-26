<!--
 * 파일명: FloorAreaEditor.vue
 * 설명: 작업자가 바닥 영역의 재질과 패턴 및 중첩 순서를 편집하는 속성 패널
 * 작성자: 이희원
 * 작성일자: 2026-11-19
-->
<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { floorMaterials, type FloorArea, type FloorMaterial } from '@/entities/facility/index.ts'

const props = defineProps<{ areas: FloorArea[]; selected?: FloorArea; busy: boolean }>()
const emit = defineEmits<{
  select: [id: string]
  apply: [area: FloorArea]
  order: [offset: number]
  remove: []
  redraw: []
}>()

const form = reactive({
  name: '',
  material: 'concrete' as FloorMaterial,
  color: '#9b9a94',
  repeatMm: 1000,
  rotation: 0,
})
const index = computed(() => props.areas.findIndex((area) => area.id === props.selected?.id))
watch(
  () => props.selected,
  (area) => {
    if (!area) return
    const { name, material, color, repeatMm, rotation } = area
    Object.assign(form, { name, material, color, repeatMm, rotation })
  },
  { immediate: true },
)

/** 재질을 변경하면 해당 재질의 기본 색상과 반복 치수로 시작 */
const setMaterial = (event: Event) => {
  const material = (event.target as HTMLSelectElement).value as FloorMaterial
  const { color, repeatMm } = floorMaterials[material]
  Object.assign(form, { material, color, repeatMm })
}

/** 기존 경계를 보존하고 재질이 바뀌면 이전 이미지 참조 해제 */
const apply = () => {
  if (!props.selected) return
  const area = { ...props.selected, ...form }
  if (area.material !== props.selected.material) delete area.texture
  emit('apply', area)
}
</script>

<template>
  <section
    v-if="areas.length"
    aria-label="바닥 영역 편집"
    data-testid="floor-editor"
  >
    <h2>
      바닥 영역
      <small data-testid="floor-count">{{ areas.length }}</small>
    </h2>
    <select
      class="w-100 mb-3"
      aria-label="편집할 바닥 영역"
      data-testid="floor-select"
      :value="selected?.id ?? ''"
      :disabled="busy"
      @change="emit('select', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">편집할 바닥 선택</option>
      <option
        v-for="area in [...areas].reverse()"
        :key="area.id"
        :value="area.id"
      >
        {{ area.name }}
      </option>
    </select>
    <form
      v-if="selected"
      class="d-flex flex-column ga-2 mb-3"
      @submit.prevent="apply"
    >
      <label>
        영역 이름
        <v-text-field
          v-model="form.name"
          data-testid="floor-name"
          maxlength="300"
          required
          :disabled="busy"
        />
      </label>
      <label class="d-flex flex-column ga-1">
        바닥 재질
        <select
          :value="form.material"
          data-testid="floor-material"
          :disabled="busy"
          @change="setMaterial"
        >
          <option
            v-for="(preset, material) in floorMaterials"
            :key="material"
            :value="material"
          >
            {{ preset.label }}
          </option>
        </select>
      </label>
      <label class="d-flex align-center justify-space-between">
        색상
        <input
          v-model="form.color"
          type="color"
          :disabled="busy"
        />
      </label>
      <div class="d-flex ga-2">
        <label class="flex-1-1">
          패턴 간격 (mm)
          <v-text-field
            v-model.number="form.repeatMm"
            data-testid="floor-repeat"
            type="number"
            min="10"
            max="100000"
            step="any"
            required
            :disabled="busy"
          />
        </label>
        <label class="flex-1-1">
          패턴 방향 (°)
          <v-text-field
            v-model.number="form.rotation"
            data-testid="floor-rotation"
            type="number"
            min="-360"
            max="360"
            step="any"
            required
            :disabled="busy"
          />
        </label>
      </div>
      <v-btn
        type="submit"
        color="primary"
        text="바닥 설정 적용"
        data-testid="floor-apply"
        :disabled="busy"
      />
      <div class="d-flex flex-wrap ga-1">
        <v-btn
          type="button"
          text="앞으로"
          :disabled="busy || index >= areas.length - 1"
          @click="emit('order', 1)"
        />
        <v-btn
          type="button"
          text="뒤로"
          :disabled="busy || index <= 0"
          @click="emit('order', -1)"
        />
        <v-btn
          type="button"
          text="경계 다시 그리기"
          :disabled="busy"
          @click="emit('redraw')"
        />
        <v-btn
          type="button"
          text="영역 삭제"
          :disabled="busy"
          @click="emit('remove')"
        />
      </div>
    </form>
  </section>
</template>

<style scoped lang="scss">
select {
  appearance: auto;
  min-width: 0;
  width: 100%;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text);
  background: var(--surface);
}
</style>
