/**
 * 파일명: vuetify.ts
 * 설명: 공통 컴포넌트 기본값과 프로젝트 색상을 정의하는 화면 테마 구성
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { vuetifyColors } from '@/shared/theme/index.ts'
import { createVuetify } from 'vuetify'
import {
  VApp,
  VBtn,
  VSheet,
  VTextField,
  VDialog,
  VCard,
  VCardText,
  VCardActions,
  VSelect,
  VBtnToggle,
  VSpacer,
  VAlert,
  VCheckbox,
} from 'vuetify/components'

export const vuetify = createVuetify({
  components: {
    VApp,
    VBtn,
    VSheet,
    VTextField,
    VDialog,
    VCard,
    VCardText,
    VCardActions,
    VSelect,
    VBtnToggle,
    VSpacer,
    VAlert,
    VCheckbox,
  },
  defaults: {
    VBtn: { variant: 'text', size: 'small', minWidth: 0, rounded: 'lg' },
    VSelect: { variant: 'outlined', density: 'compact', hideDetails: true, color: 'primary' },
    VCard: { elevation: 0 },
    VTextField: { variant: 'outlined', density: 'compact', hideDetails: true, color: 'primary' },
  },
  theme: {
    defaultTheme: 'mgs',
    themes: {
      mgsDark: {
        dark: true,
        colors: vuetifyColors('dark'),
      },
      mgs: {
        dark: false,
        colors: vuetifyColors('light'),
      },
    },
  },
})
