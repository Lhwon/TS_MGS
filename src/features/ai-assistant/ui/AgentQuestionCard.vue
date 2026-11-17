<!--
 * 파일명: AgentQuestionCard.vue
 * 설명: 모든 에이전트 작업에서 필요한 입력과 선택을 받는 비모달 대화 카드
 * 작성자: 이희원
 * 작성일자: 2026-11-16
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  validateAgentAnswer,
  type AgentQuestion,
  type AgentAnswer,
  type AgentValue,
  type AgentField,
} from '@/features/ai-assistant/model/questions.ts'
const props = defineProps<{
  question: AgentQuestion
  state: 'waiting' | 'answered' | 'skipped' | 'cancelled'
  summary?: string
}>()
const emit = defineEmits<{ answer: [answer: AgentAnswer]; cancel: [] }>()
const values = ref<Record<string, AgentValue>>({}),
  units = ref<Record<string, string>>({}),
  error = ref('')
watch(
  () => props.question.id,
  () => {
    values.value = Object.create(null)
    units.value = Object.create(null)
    error.value = ''
    for (const field of props.question.fields) {
      if (field.defaultValue !== undefined)
        values.value[field.id] = Array.isArray(field.defaultValue)
          ? [...field.defaultValue]
          : field.defaultValue
      else if (field.type === 'boolean') values.value[field.id] = false
      if (field.unit) units.value[field.id] = field.unit
    }
  },
  { immediate: true },
)
/** 입력 형식을 유지하며 질문별 값을 갱신하는 편집 */
const setValue = (field: AgentField, value: unknown) => {
  if (field.type === 'number')
    values.value[field.id] = value === '' || value === null ? '' : Number(value)
  else if (field.type === 'boolean') values.value[field.id] = Boolean(value)
  else if (field.type === 'multiselect')
    values.value[field.id] = Array.isArray(value) ? value.map(String) : []
  else values.value[field.id] = value == null ? '' : String(value)
}
/** 선택과 수치를 검증하여 원래 작업으로 전달하는 답변 전송 */
const submit = (answer: AgentAnswer) => {
  if (props.state !== 'waiting') return
  try {
    const checked = validateAgentAnswer(props.question, answer)
    error.value = ''
    emit('answer', checked)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
/** 입력 항목을 묶어서 전달하는 답변 */
const submitFields = () => submit({ status: 'answered', values: values.value, units: units.value })
/** 선택 입력을 뒤로 미루고 작업을 이어가는 응답 */
const skip = () => submit({ status: 'skipped', values: {}, units: {} })
/** 질문에 맞는 대안을 전달하는 선택 */
const choose = (id: string) => submit({ status: 'answered', choice: id, values: {}, units: {} })
</script>
<template>
  <section
    class="question-card mt-3 pa-3"
    data-testid="agent-question"
    :data-question-id="question.id"
    :data-state="state"
    aria-label="에이전트 확인"
  >
    <strong class="d-block">{{ question.question }}</strong>
    <p
      v-if="question.reason"
      class="text-caption mt-2"
    >
      {{ question.reason }}
    </p>
    <template v-if="state === 'waiting'">
      <form
        class="mt-3"
        @submit.prevent="submitFields"
        @keydown.stop
      >
        <div
          v-for="field in question.fields"
          :key="field.id"
          class="field-row mb-3"
        >
          <label
            v-if="field.type === 'boolean'"
            class="d-flex align-center ga-2"
          >
            <input
              type="checkbox"
              :checked="values[field.id] === true"
              :data-field-id="field.id"
              @change="setValue(field, ($event.target as HTMLInputElement).checked)"
            />
            {{ field.label }}
          </label>
          <v-select
            v-else-if="field.type === 'select' || field.type === 'multiselect'"
            class="flex-grow-1"
            :label="field.label"
            :model-value="values[field.id]"
            :items="field.options.map((option) => ({ title: option.label, value: option.id }))"
            :multiple="field.type === 'multiselect'"
            :chips="field.type === 'multiselect'"
            :data-field-id="field.id"
            @update:model-value="setValue(field, $event)"
          />
          <v-text-field
            v-else
            class="flex-grow-1"
            :label="field.label"
            :model-value="values[field.id] ?? ''"
            :type="field.type === 'number' ? 'number' : 'text'"
            :placeholder="field.placeholder"
            :min="field.min"
            :max="field.max"
            :step="field.type === 'number' ? 'any' : undefined"
            :maxlength="field.type === 'text' ? 2000 : undefined"
            :data-field-id="field.id"
            @update:model-value="setValue(field, $event)"
          />
          <v-select
            v-if="field.units.length > 1"
            v-model="units[field.id]"
            :label="`${field.label} 단위`"
            :items="field.units"
            class="field-unit"
          />
          <span
            v-else-if="field.unit"
            class="text-caption"
          >
            {{ field.unit }}
          </span>
        </div>
        <p
          v-if="error"
          class="answer-error text-caption mb-2"
          role="alert"
        >
          {{ error }}
        </p>
        <div class="d-flex flex-wrap ga-2">
          <v-btn
            v-if="question.fields.length"
            type="submit"
            variant="flat"
            color="primary"
            data-testid="question-submit"
          >
            {{ question.submitLabel }}
          </v-btn>
          <v-btn
            v-for="choice in question.choices"
            :key="choice.id"
            variant="outlined"
            :data-choice-id="choice.id"
            @click="choose(choice.id)"
          >
            {{ choice.label }}
          </v-btn>
          <v-btn
            v-if="question.allowSkip"
            variant="outlined"
            data-testid="question-skip"
            @click="skip"
          >
            {{ question.skipLabel }}
          </v-btn>
          <v-btn @click="emit('cancel')">작업 중단</v-btn>
        </div>
      </form>
      <p class="text-caption mt-3">아래 채팅창에 직접 답하거나 요청을 바꿀 수도 있습니다.</p>
    </template>
    <p
      v-else
      class="text-caption mt-2"
    >
      {{
        state === 'cancelled'
          ? '종료된 질문'
          : state === 'skipped'
            ? '나중에 확인'
            : summary || '답변 완료'
      }}
    </p>
  </section>
</template>
<style scoped lang="scss">
.question-card {
  border: 1px solid var(--app-border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
}
.question-card[data-state='waiting'] {
  border-color: var(--accent);
  box-shadow: inset 3px 0 var(--accent-fill);
}
.question-card p {
  color: var(--text-secondary);
  white-space: pre-wrap;
}
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.field-row :deep(.v-input) {
  min-width: 0;
}
.field-unit {
  flex: 0 0 100px;
  max-width: 100px;
}
.question-card .answer-error {
  color: var(--app-danger);
}
</style>
