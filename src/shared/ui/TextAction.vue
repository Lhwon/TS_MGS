<!--
/**
 * 파일명: TextAction.vue
 * 설명: 선택한 텍스트 색상과 키보드 조작을 제공하는 메뉴 항목
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
-->
<script setup lang="ts">
withDefaults(defineProps<{ active?: boolean; role?: 'button' | 'tab' }>(), { role: 'button' })
const emit = defineEmits<{ activate: [] }>()
</script>

<template>
  <span
    class="text-action"
    :class="{ active }"
    :role="role"
    tabindex="0"
    :aria-selected="role === 'tab' ? !!active : undefined"
    :aria-pressed="role === 'button' ? active : undefined"
    @click="emit('activate')"
    @keydown.enter.prevent="emit('activate')"
    @keydown.space.prevent="emit('activate')"
    ><slot
  /></span>
</template>

<style scoped lang="scss">
/** 헤더 텍스트 버튼의 평면 스타일과 조작 상태 정의 */
.text-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--control-radius);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: background-color var(--control-duration) ease, color var(--control-duration) ease;
}

.text-action:hover {
  background-color: var(--hover);
}

.text-action.active {
  color: var(--accent);
}
</style>
