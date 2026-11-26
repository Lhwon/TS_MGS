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
import { aliases } from 'vuetify/iconsets/mdi-svg'

/** 공통 스타일과 팔레트를 사용하는 Vuetify 기본 구성 정의 */
export const vuetify = createVuetify({
  icons: { aliases },
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
    VBtn: { variant: 'text', size: 'small', minWidth: 0 },
    VCheckbox: { color: 'primary' },
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
