<!--
 * 파일명: AssistantModelPicker.vue
 * 설명: 설치된 Ollama 대화 모델을 검색하고 선택하는 팝업
 * 작성자: 이희원
 * 작성일자: 2026-11-17
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { VIcon } from 'vuetify/components'
import { mdiCheckCircle, mdiClose, mdiCubeOutline, mdiMagnify } from '@mdi/js'
import type { AssistantModel } from '@/features/ai-assistant/model/transport.ts'
const open = defineModel<boolean>({ default: false })
const props = defineProps<{
  models: AssistantModel[]
  selected: string
  loading: boolean
  error: string
}>()
const emit = defineEmits<{ select: [name: string] }>()
const search = ref('')
const filtered = computed(() =>
  props.models.filter((model) =>
    model.name.toLowerCase().includes(search.value.trim().toLowerCase()),
  ),
)
/** 설치 모델의 크기를 읽기 쉬운 단위로 표시하는 파일 용량 변환 */
const sizeLabel = (size: number) => (size > 0 ? `${(size / 1024 ** 3).toFixed(1)} GB` : '')
/** 선택한 모델을 다음 요청에 반영하고 목록을 닫는 선택 */
const select = (name: string) => {
  emit('select', name)
  open.value = false
}
</script>
<template>
  <v-dialog
    v-model="open"
    max-width="480"
    aria-label="설치된 AI 모델"
  >
    <v-card
      class="pa-4"
      data-testid="ai-model-dialog"
    >
      <div class="d-flex align-center justify-space-between mb-2">
        <strong>AI 모델 선택</strong>
        <v-btn
          :icon="[mdiClose]"
          title="닫기"
          aria-label="모델 목록 닫기"
          @click="open = false"
        />
      </div>
      <p class="text-caption text-medium-emphasis mb-4">Ollama 설치 모델 · 다음 요청부터 적용</p>
      <v-text-field
        v-model="search"
        label="모델 검색"
        :prepend-inner-icon="[mdiMagnify]"
        class="mb-3"
      />
      <p
        v-if="loading"
        class="text-body-2 pa-3"
        role="status"
      >
        설치 모델을 불러오고 있습니다…
      </p>
      <p
        v-else-if="error"
        class="text-error pa-3"
        role="alert"
      >
        {{ error }}
      </p>
      <p
        v-else-if="!models.length"
        class="text-body-2 pa-3"
      >
        설치된 모델이 없습니다.
      </p>
      <p
        v-else-if="!filtered.length"
        class="text-body-2 pa-3"
      >
        검색 결과가 없습니다.
      </p>
      <div
        v-else
        class="model-list d-flex flex-column ga-2"
      >
        <button
          v-for="model in filtered"
          :key="model.name"
          type="button"
          class="model-option d-flex align-center ga-3 pa-3 text-left"
          :class="{ selected: selected === model.name }"
          :aria-pressed="selected === model.name"
          :data-model="model.name"
          @click="select(model.name)"
        >
          <VIcon
            :icon="[mdiCubeOutline]"
            size="24"
          />
          <span class="flex-grow-1 overflow-hidden">
            <strong class="d-block text-truncate">{{ model.name }}</strong>
            <span class="text-caption text-medium-emphasis">
              {{
                [model.parameterSize, model.quantization, sizeLabel(model.size)]
                  .filter(Boolean)
                  .join(' · ')
              }}
            </span>
          </span>
          <VIcon
            v-if="selected === model.name"
            :icon="[mdiCheckCircle]"
            color="primary"
            size="20"
          />
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>
<style scoped lang="scss">
.model-list {
  max-height: min(52vh, 440px);
  overflow-y: auto;
}
.model-option {
  width: 100%;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
}
.model-option:hover,
.model-option:focus-visible {
  background: rgba(var(--v-theme-primary), 0.07);
}
.model-option.selected {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}
</style>
