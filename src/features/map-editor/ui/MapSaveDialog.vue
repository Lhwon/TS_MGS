<!--
 * 파일명: MapSaveDialog.vue
 * 설명: 지도와 영역 및 Around와 AES를 같은 버전으로 저장할 항목을 구성하는 저장창
 * 작성자: 이희원
 * 작성일자: 2026-11-18
-->
<script setup lang="ts">
import { reactive, ref } from 'vue'
import {
  DEFAULT_AES_VEHICLE,
  readAesVehicle,
  validateAesVehicle,
} from '@/features/map-editor/model/aes.ts'
import type { NativeSaveOptions } from '@/features/map-editor/model/useMapFiles.ts'
const props = defineProps<{ busy: boolean; message: string }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ save: [options: NativeSaveOptions] }>()
const options = reactive<NativeSaveOptions>({
  includeAreas: true,
  includeAround: true,
  aroundRadius: 30000,
  includeAes: false,
  vehicle: { ...DEFAULT_AES_VEHICLE },
})
const error = ref(''),
  vehicleName = ref('원본 MGS 기본 치수')
/** 원본 첫 번째 AGV의 형상과 외곽 검사 설정을 저장 구성에 적용하는 파일 열기 */
const loadVehicle = async (event: Event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  if (!file) return
  try {
    if (file.size > 1024 * 1024) throw new Error('차량 설정 파일은 일 MB 이하여야 합니다.')
    options.vehicle = readAesVehicle(await file.text())
    vehicleName.value = file.name
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    input.value = ''
  }
}
/** 선택 항목의 수치를 검증하고 독립된 저장 스냅샷 구성을 전달하는 저장 요청 */
const save = () => {
  try {
    const radius = Number(options.aroundRadius),
      vehicle = { ...options.vehicle }
    for (const key of Object.keys(vehicle) as (keyof typeof vehicle)[])
      vehicle[key] = Number(vehicle[key])
    if (options.includeAround && (!Number.isSafeInteger(radius) || radius < 1 || radius > 1e8))
      throw new Error('주변 반경은 양의 정수 mm로 입력하세요.')
    if (options.includeAes) validateAesVehicle(vehicle)
    error.value = ''
    emit('save', { ...options, aroundRadius: radius, vehicle })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
</script>
<template>
  <v-dialog
    v-model="open"
    max-width="760"
    scrollable
    :persistent="busy"
  >
    <v-card
      title="Map Save"
      data-testid="map-save-dialog"
    >
      <v-card-text>
        <p class="mb-3">JMAPX와 선택한 부가 데이터를 같은 새 버전으로 저장</p>
        <v-checkbox
          v-model="options.includeAreas"
          label="Bay · Bay Group · Zone · Offset · Port Limit"
          hide-details
          :disabled="busy"
        />
        <v-checkbox
          v-model="options.includeAround"
          label="Around Data 생성"
          hide-details
          :disabled="busy"
        />
        <v-text-field
          v-if="options.includeAround"
          v-model="options.aroundRadius"
          label="주변 조회 반경 mm"
          type="number"
          class="mt-3"
          :disabled="busy"
        />
        <v-checkbox
          v-model="options.includeAes"
          label="AES Data 생성"
          hide-details
          :disabled="busy"
        />
        <div
          v-if="options.includeAes"
          class="mt-4"
        >
          <label class="d-block mb-3">
            AGV_TYPE.INI · AGV_TYPE_01
            <input
              class="d-block mt-2"
              type="file"
              accept=".ini"
              :disabled="busy"
              @change="loadVehicle"
            />
          </label>
          <p class="text-caption mb-3">{{ vehicleName }}</p>
          <div class="vehicle-fields">
            <v-text-field
              v-for="field in [
                { key: 'width', label: '차량 폭 mm' },
                { key: 'height', label: '차량 높이 mm' },
                { key: 'leftWidth', label: '왼쪽 중심 Offset mm' },
                { key: 'topHeight', label: '위쪽 중심 Offset mm' },
                { key: 'sampleLength', label: '외곽 표본 간격 mm' },
                { key: 'detectionDistance', label: '검출 여유 mm' },
                { key: 'searchRatio', label: '탐색 반경 배율' },
              ]"
              :key="field.key"
              v-model="options.vehicle[field.key as keyof typeof options.vehicle]"
              :label="field.label"
              type="number"
              :disabled="busy"
            />
          </div>
        </div>
        <p
          v-if="error"
          class="text-error mt-3"
          role="alert"
        >
          {{ error }}
        </p>
        <p
          v-if="props.message"
          class="text-body-2 mt-3"
          role="status"
        >
          {{ props.message }}
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          :disabled="busy"
          @click="open = false"
        >
          취소
        </v-btn>
        <v-btn
          variant="flat"
          color="primary"
          :loading="busy"
          @click="save"
        >
          저장
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<style scoped lang="scss">
.vehicle-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}
</style>
