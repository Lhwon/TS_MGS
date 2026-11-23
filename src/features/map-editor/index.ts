/**
 * 파일명: index.ts
 * 설명: 슬라이스의 컴포넌트와 데이터 및 기능을 외부에 제공하는 공개 진입점
 * 작성자: 이희원
 * 작성일자: 2026-10-20
 */
export { useEditor } from '@/features/map-editor/model/editor.ts'
export { default as SelectedMapEditor } from '@/features/map-editor/ui/SelectedMapEditor.vue'
export { default as ContextDataEditor } from '@/features/map-editor/ui/ContextDataEditor.vue'
export { findFeatureBoundaries } from '@/features/map-editor/model/featureBoundaries.ts'
export { makeLotDistance } from '@/features/map-editor/model/lotDistance.ts'
export { auditPortReferences } from '@/features/map-editor/model/portAudit.ts'
export {
  inspectPortApproach,
  setPortApproachReverse,
} from '@/features/map-editor/model/portApproach.ts'
export type { Tool } from '@/features/map-editor/model/editor.ts'
export { useMapFiles } from '@/features/map-editor/model/useMapFiles.ts'
export type { NativeSaveOptions } from '@/features/map-editor/model/useMapFiles.ts'
export { default as MapSaveDialog } from '@/features/map-editor/ui/MapSaveDialog.vue'

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
export { findNearbyNodes } from '@/features/map-editor/model/nearby.ts'
export {
  MAP_CONTROL_ACTIONS,
  applyAutomaticControls,
  rebuildPathControls,
} from '@/features/map-editor/model/automaticControls.ts'
export {
  makeAesData,
  readAesVehicle,
  DEFAULT_AES_VEHICLE,
} from '@/features/map-editor/model/aes.ts'
export { readBlockReview, type BlockReviewType } from '@/features/map-editor/model/blockReview.ts'
