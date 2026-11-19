/**
 * 파일명: index.ts
 * 설명: 공통 화면 자원과 파일 작업을 외부 슬라이스에 제공하는 공개 진입점
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
export { default as AppIcon } from '@/shared/ui/AppIcon.vue'
export { default as TextAction } from '@/shared/ui/TextAction.vue'
export { enablePopupDragging } from '@/shared/ui/draggablePopups.ts'
