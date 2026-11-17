/**
 * 파일명: index.ts
 * 설명: 슬라이스의 컴포넌트와 데이터 및 기능을 외부에 제공하는 공개 진입점
 * 작성자: 이희원
 * 작성일자: 2026-10-20
 */
export { useEditor } from '@/features/map-editor/model/editor.ts'
export type { Tool } from '@/features/map-editor/model/editor.ts'
export { useMapFiles } from '@/features/map-editor/model/useMapFiles.ts'

export {
  subdividePaths,
  renumberMap,
  shortestMapPath,
} from '@/features/map-editor/model/operations.ts'
export { default as MapOperations } from '@/features/map-editor/ui/MapOperations.vue'
export { createGrid } from '@/features/map-editor/model/grid.ts'
export { makeAroundData } from '@/features/map-editor/model/around.ts'
export { default as AreaEditor } from '@/features/map-editor/ui/AreaEditor.vue'
export { readTeachingFile, applyTeaching } from '@/features/map-editor/model/teaching.ts'
export { default as TeachingEditor } from '@/features/map-editor/ui/TeachingEditor.vue'
export { assignRealIds } from '@/features/map-editor/model/realIds.ts'
