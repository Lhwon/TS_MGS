<!--
 * 파일명: App.vue
 * 설명: 전역 테마와 최소 공통 스타일을 제공하는 애플리케이션 루트
 * 작성자: 이희원
 * 작성일자: 2026-11-16
-->
<script setup lang="ts">
import { watch } from 'vue'
import { applySystemPalette } from '@/shared/theme/index.ts'
import { useTheme } from 'vuetify'
import { useEditor } from '@/features/map-editor/index.ts'
import { StudioPage } from '@/pages/studio/index.ts'

const editor = useEditor()
const theme = useTheme()
watch(
  () => editor.colorMode,
  (mode) => {
    applySystemPalette(mode)
    theme.change(mode === 'dark' ? 'mgsDark' : 'mgs')
  },
  { immediate: true },
)
</script>

<template>
  <v-app :class="{ 'app-dark': editor.colorMode === 'dark' }">
    <StudioPage />
  </v-app>
</template>

<style lang="scss" src="@/shared/theme/styles.scss"></style>
