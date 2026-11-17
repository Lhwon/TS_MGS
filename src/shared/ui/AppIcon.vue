<!--
/**
 * 파일명: AppIcon.vue
 * 설명: 프로젝트 공통 아이콘 이름과 크기를 표시하는 벡터 아이콘 컴포넌트
 * 작성자: 이희원
 * 작성일자: 2026-10-20
 */
-->
<script setup lang="ts">
withDefaults(
  defineProps<{
    name: string
    size?: number
  }>(),
  { size: 20 },
)
const paths: Record<string, string> = {
  select: 'm5 3 14 9-7 1-3 7-4-17Z',
  pan: 'M8 13V6a2 2 0 0 1 4 0v6m0-5a2 2 0 0 1 4 0v6m0-4a2 2 0 0 1 4 0v6c0 4-2 7-6 7h-1c-2 0-3-1-4-2l-5-6a2 2 0 0 1 3-3l1 1',
  add: 'M12 5v14M5 12h14M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  connect: 'M7 17 17 7M10 7h7v7M7 17H3v4h4v-4ZM21 3h-4v4h4V3Z',
  new: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M12 12v6m-3-3h6',
  folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v1M3 9h18l-2 11H2L3 9Z',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8',
  undo: 'M3 10h11a6 6 0 0 1 0 12M3 10l6-6m-6 6 6 6',
  redo: 'M21 10H10a6 6 0 0 0 0 12M21 10l-6-6m6 6-6 6',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  fit: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8Z',
  layers: 'm12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 5 5',
  close: 'm6 6 12 12M6 18 18 6',
  chevron: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  node: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3',
  port: 'M4 4h16v16H4ZM8 8h8v8H8Z',
  grid: 'M3 3h18v18H3ZM3 9h18M3 15h18M9 3v18M15 3v18',
  text: 'M4 5h16M12 5v15M8 20h8M4 5v3m16-3v3',
  check: 'm5 12 4 4L19 6',
  lock: 'M6 11h12v10H6ZM8 11V7a4 4 0 0 1 8 0v4',
  help: 'M12 16v.1M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  refresh: 'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  cube: 'm12 2 9 5v10l-9 5-9-5V7l9-5ZM3 7l9 5 9-5M12 12v10',
  panel: 'M3 4h18v16H3ZM15 4v16',
  target: 'M12 2v4m0 12v4M2 12h4m12 0h4M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
}
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.node" />
  </svg>
</template>
