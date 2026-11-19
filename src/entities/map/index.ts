/**
 * 파일명: index.ts
 * 설명: 슬라이스의 컴포넌트와 데이터 및 기능을 외부에 제공하는 공개 진입점
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
export {
  demoDocument,
  emptyDocument,
  parseDocument,
  MAX_NODES,
  MAX_PORTS,
  MAX_FILE_BYTES,
} from '@/entities/map/model/map.ts'
export { previewLegacy } from '@/entities/map/model/legacy.ts'
export type {
  MapDocument,
  MapLayout,
  DrawingObject,
  DrawingVision,
  MapNode,
  MapPort,
  MapEdge,
  MapShape,
  MapPortGroup,
} from '@/entities/map/model/map.ts'
export type { Layers } from '@/entities/map/model/view.ts'
export {
  pickMgsNode,
  mgsAreaSelection,
  mgsFit,
  layoutCorners,
} from '@/entities/map/model/interaction.ts'
export type { MapPoint } from '@/entities/map/model/interaction.ts'
export {
  DEFAULT_LAYERS,
  nodeLabel,
  legacyColor,
  viewStep,
  mgsTheme,
} from '@/entities/map/model/view.ts'
export { createMapTopology, MAP_NODE_RADIUS_MM } from '@/entities/map/lib/createMapTopology.ts'
export { cropLayoutImage } from '@/entities/map/lib/cropLayoutImage.ts'

export {
  createMapLabels,
  paintMapLabel,
  MIN_MAP_LABEL_PIXELS,
  mapObjectColor,
} from '@/entities/map/lib/createMapLabels.ts'

export { serializeLegacy } from '@/entities/map/model/legacyWriter.ts'
export { serializeLegacySnapshot } from '@/entities/map/model/nativeSnapshot.ts'
export type { LegacySource } from '@/entities/map/model/legacyWriter.ts'

export { calculateCurve, appendCurve } from '@/entities/map/model/curve.ts'
export type { CurveOptions } from '@/entities/map/model/curve.ts'

export { PATH_CONTROLS, NODE_FLAGS } from '@/entities/map/model/controls.ts'
export { remapLegacySource } from '@/entities/map/model/remapLegacy.ts'
export { PORT_SETTINGS, PORT_RESERVATIONS } from '@/entities/map/model/portSettings.ts'
export {
  emptyAreas,
  validateAreas,
  parseAreaFiles,
  serializeAreas,
} from '@/entities/map/model/areas.ts'
export type { AreaData } from '@/entities/map/model/areas.ts'
export { expandCurveSelection } from '@/entities/map/model/curveSelection.ts'
export { repairPortGroups } from '@/entities/map/model/repairReferences.ts'
export { editMapObjects } from '@/entities/map/model/editing.ts'
export {
  inspectSelectedNodes,
  editSelectedNodes,
  selectionDelta,
} from '@/entities/map/model/selection.ts'
