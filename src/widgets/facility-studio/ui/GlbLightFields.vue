<script setup lang="ts">
import { VSlider } from 'vuetify/components'
import { maxLightTemperature, minLightTemperature, type FacilityLight, type FacilityLightAngles } from '@/entities/facility/index.ts'

const kind = defineModel<FacilityLight['kind']>('kind', { required: true })
const temperature = defineModel<string>('temperature', { required: true })
const angles = defineModel<Required<FacilityLightAngles>>('angles')
defineProps<{ error: string; anglesOnly?: boolean }>()
</script>

<template>
  <v-select
    v-if="!anglesOnly"
    v-model="kind"
    :items="[{ title: '원통 스폿', value: 'spot' }, { title: '일자 면광원', value: 'line' }]"
    label="조명 종류"
    density="compact"
    hide-details
  />
  <v-text-field
    v-if="!anglesOnly"
    v-model="temperature"
    label="색온도 (K)"
    type="number"
    :min="minLightTemperature"
    :max="maxLightTemperature"
    step="1"
    density="compact"
    hide-details="auto"
    data-testid="glb-light-temperature"
    :error-messages="error"
  />
  <!-- 조명 모델 기본값과 개별 배치에서 재사용하는 각도 편집 영역 구성 -->
  <div v-if="angles" class="d-flex flex-column ga-2" data-testid="light-angle-fields">
    <v-text-field v-for="field in [
      { key: 'direction', label: '수평 방향 °', max: 360, min: 0 },
      { key: 'tilt', label: '기울기 °', max: 90, min: 0 },
      { key: 'beamAngle', label: '배광각 전체 °', max: 160, min: 1 },
    ] as const" :key="field.key" :model-value="angles[field.key]" :label="field.label"
      type="number" :min="field.min" :max="field.max" step="1" required density="compact" hide-details="auto"
      :data-testid="`light-${field.key}`" @update:model-value="angles = { ...angles!, [field.key]: Number($event) }" />
    <v-slider v-model="angles.penumbra" :min="0" :max="1" :step="0.01" hide-details
      label="경계 부드러움" :aria-label="`경계 부드러움 ${Math.round(angles.penumbra * 100)}%`"
      data-testid="light-penumbra" />
    <small>경계 부드러움 {{ Math.round(angles.penumbra * 100) }}% · 기울기 0° 아래 방향, 90° 수평 방향</small>
    <v-alert v-if="anglesOnly && error" type="error" density="compact">{{ error }}</v-alert>
  </div>
</template>
