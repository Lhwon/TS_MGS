/**
 * 파일명: index.ts
 * 설명: 슬라이스의 컴포넌트와 데이터 및 기능을 외부에 제공하는 공개 진입점
 * 작성자: 이희원
 * 작성일자: 2026-10-20
 */
export * from '@bem/map3d'
export { buildWipRacks, wipRackKey } from './wipRacks'
export { createInteriorModel, fillLegacyStainlessPipe, interiorModels, type InteriorModel } from './interiorModels'
export {
  FACILITY_CYLINDER_SEGMENTS,
  facilityModelBounds,
  facilityModelSize,
  facilityPartMatrix,
} from './facilityDimensions'

import { parseEquipmentLibrary } from '@bem/map3d'

/** 도면 기반 개략 설비 라이브러리의 지연 로딩과 계약 검증 */
export const loadDefaultCatalog = async () =>
  parseEquipmentLibrary(JSON.stringify((await import('./ceram-mp5.equipment.json')).default))

/** 이전 기본 모델과 배치 이름에서 제품명 접두어 제거 */
export const defaultModelLabel = (name: string) =>
  name.replace(/(?<![a-z0-9])(?:ceram|mp[45])(?![a-z0-9])[\s_-]*/gi, '').trim()
