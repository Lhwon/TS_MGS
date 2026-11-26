/**
 * 파일명: main.ts
 * 설명: 상태 저장소와 화면 테마를 연결하는 애플리케이션 시작 구성
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
import 'vuetify/styles'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/app/App.vue'
import { vuetify } from '@/app/plugins/vuetify.ts'

/** 로컬 글꼴 준비 후 지도 라벨과 화면을 함께 시작하는 앱 초기화 */
const startApplication = async () => {
  await document.fonts.load('13px Pretendard').catch(() => undefined)
  createApp(App).use(createPinia()).use(vuetify).mount('#app')
}
void startApplication()
