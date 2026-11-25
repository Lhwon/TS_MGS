<script setup lang="ts">
import { maxLightTemperature, minLightTemperature, type FacilityLight } from '@/entities/facility/index.ts'

const kind = defineModel<FacilityLight['kind']>('kind', { required: true })
const temperature = defineModel<string>('temperature', { required: true })
defineProps<{ error: string }>()
</script>

<template>
  <v-select
    v-model="kind"
    :items="[{ title: '원통 스폿', value: 'spot' }, { title: '일자 면광원', value: 'line' }]"
    label="조명 종류"
    density="compact"
    hide-details
  />
  <v-text-field
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
</template>
