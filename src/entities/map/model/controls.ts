/**
 * 파일명: controls.ts
 * 설명: 원본 JMAPX 계획 경로 블록의 제어 속성과 열 위치 및 표시 이름
 * 작성자: 이희원
 * 작성일자: 2026-11-17
 */
export const PATH_CONTROLS = [
  { key: 'spinturnableDegree', column: 8, label: 'Spinturnable Degree' },
  { key: 'vehicleDegree', column: 15, label: 'Vehicle Degree 천분의 도' },
  { key: 'reverse', column: 16, label: 'Reverse', flag: true },
  { key: 'spinturnCount', column: 17, label: 'Spinturn Count' },
  { key: 'ignore', column: 18, label: 'Ignore' },
  { key: 'guideCorrection', column: 19, label: 'Guide Correction mm' },
  { key: 'door', column: 20, label: 'Door' },
  { key: 'pathWeight', column: 21, label: 'Path Weight' },
  { key: 'mark', column: 22, label: 'Mark' },
  { key: 'controlSpeed', column: 23, label: 'Control Speed' },
  { key: 'reverseSpinturn', column: 25, label: 'Reverse Spinturn', flag: true },
  { key: 'manualDegree', column: 27, label: 'Manual Degree', flag: true },
  { key: 'vehicleCorrection', column: 28, label: 'Vehicle Correction 천분의 도' },
  ...Array.from({ length: 8 }, (_, index) => ({
    key: `odsField${index}`,
    column: 29 + index,
    label: `ODS Field ${index}`,
  })),
  { key: 'dynamicPath', column: 37, label: 'Dynamic Path' },
  ...Array.from({ length: 8 }, (_, index) => ({
    key: `pathSetting${index}`,
    column: 38 + index,
    label: `Path Setting ${index}`,
  })),
  { key: 'controlWeight', column: 46, label: 'Control Weight' },
  { key: 'derailOffset', column: 47, label: 'Derail Offset' },
  { key: 'meandevIgnore', column: 51, label: 'Meandev Ignore' },
  { key: 'guidanceType', column: 52, label: 'Guidance Type' },
] as const
export const NODE_FLAGS = [
  { key: 'noSendGoal', label: 'No Send Goal' },
  { key: 'noSendGoalLoaded', label: 'No Send Goal Loaded' },
  { key: 'dontRemoveCmd', label: 'Do Not Remove Command' },
  { key: 'removable', label: 'Removable' },
  { key: 'changeable', label: 'Changeable' },
  { key: 'bayChange', label: 'Bay Change' },
  { key: 'spinturnable', label: 'Spinturnable' },
] as const
