/**
 * 파일명: view.ts
 * 설명: 지도 표시 옵션과 식별 라벨 및 원본 색상과 테마 설정 해석
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { systemPalette } from '@/shared/theme/index.ts'
import type { MapNode, MapDocument, MapPort } from '@/entities/map/model/map.ts'
export interface Layers {
  portIndices?: boolean
  portCaptions?: boolean
  fontStyle?: boolean
  nodeProperties?: boolean
  noSendGoals?: boolean
  loadedGoals?: boolean
  addressTypes?: boolean
  commandRetention?: boolean
  nodeDirections?: boolean
  pathTypes?: boolean
  pathSpeeds?: boolean
  pathReverses?: boolean
  pathDegrees?: boolean
  pathOds?: boolean
  pathWeights?: boolean
  pathSpinturns?: boolean
  pathGuidance?: boolean
  pathControlWeights?: boolean
  pathMeanDev?: boolean
  portReports?: boolean
  portShifts?: boolean
  portHandshake?: boolean
  portDirection?: boolean
  portHeight?: boolean

  pathDistances?: boolean
  pathRadii?: boolean
  portNames?: boolean
  portIds?: boolean
  grid: boolean
  nodes: boolean
  edges: boolean
  ports: boolean
  labels: boolean
  realIds: boolean
  nodeIds: boolean
  uniqueIds: boolean
  positions: boolean
  virtualLabels: boolean
  rulers: boolean
}
export const DEFAULT_LAYERS: Layers = {
  pathDistances: false,
  pathRadii: false,
  portNames: true,
  portIds: false,
  grid: true,
  nodes: true,
  edges: true,
  ports: true,
  labels: true,
  realIds: true,
  nodeIds: true,
  uniqueIds: false,
  positions: false,
  virtualLabels: false,
  rulers: true,
}
/**
 * 표시 옵션과 원본 식별 정보를 조합하는 노드 라벨 생성
 * 가상 노드 표시 여부와 실좌표 표시 설정을 반영하는 화면 문자열 구성
 *
 * @param node 표시 또는 편집 대상 노드 정보
 * @param view 식별자와 좌표 및 가상 노드의 라벨 표시 설정
 * @returns 현재 표시 옵션을 반영한 노드 라벨 문자열
 */
export const nodeLabel = (node: MapNode, view: Layers): string => {
  if (!view.virtualLabels && (node.virtual || node.curve)) return ''
  const real =
    view.realIds && node.realId !== undefined && node.realId >= 0
      ? node.realId.toLocaleString('en-US')
      : ''
  const local = view.nodeIds ? `(N${node.id.toLocaleString('en-US')})` : ''
  const uid =
    view.uniqueIds && node.uid !== undefined && node.uid >= 0
      ? `(U${node.uid.toLocaleString('en-US')})`
      : ''
  const position = view.positions
    ? `(${node.x.toLocaleString('en-US')}, ${node.y.toLocaleString('en-US')})`
    : ''
  const extra = [
    view.nodeProperties ? `Property ${node.property ?? 0}` : '',
    view.noSendGoals && node.noSendGoal ? 'No Send Goal' : '',
    view.loadedGoals && node.noSendGoalLoaded ? 'No Send Goal Loaded' : '',
    view.addressTypes ? `Address ${node.addressType ?? 0}` : '',
    view.commandRetention && node.dontRemoveCmd ? 'Do Not Remove Command' : '',
    view.nodeDirections ? `Dir ${node.direction ?? 0}` : '',
  ]
  return [real + local + uid, position, ...extra].filter(Boolean).join('\n')
}
// 원본 색상 저장 순서와 렌더러의 색상 채널 순서 차이를 보정하는 채널 변환
/**
 * 원본 색상의 적색 및 청색 채널 순서를 렌더러 색상 순서로 바꾸는 색상 변환
 *
 * @param value 현재 처리 단계에서 검증하거나 반영할 입력 값
 * @returns 렌더러 채널 순서에 맞춰 변환한 정수 색상
 */
export const legacyColor = (value: number): number => {
  return ((value & 255) << 16) | (value & 0xff00) | ((value >> 16) & 255)
}
/**
 * 표시 범위와 화면 크기에 적합한 눈금 간격을 선택하는 단계 계산
 *
 * @param distance 눈금 또는 근접 판정에 사용하는 지도 거리
 * @param pixels 눈금 계산에 사용하는 화면 픽셀 길이
 * @param spacing 목표 눈금 사이의 화면 간격
 * @returns 현재 화면 축척에서 사용할 지도 눈금 간격
 */
export const viewStep = (distance: number, pixels: number, spacing = 70): number => {
  const target = Math.abs(distance) / Math.max(1, pixels / spacing)
  if (!Number.isFinite(target) || target <= 0) return 1
  const base = 10 ** Math.floor(Math.log10(target))
  return [1, 2, 5, 10].find((value) => value * base >= target)! * base
}
// 원본 테마 설정과 노드 렌더링에서 사용하는 설정 키 해석
/**
 * 설정 파일에서 선택한 테마와 지도 표시 속성을 읽는 테마 해석
 * 누락된 설정에는 원본 기본 색상과 제한된 크기를 적용하는 표시 설정 구성
 *
 * @param content 파일에서 읽은 원본 문자열
 * @param mode 두 화면과 사용자 인터페이스가 공유할 밝기 모드
 * @returns 누락 항목의 기본값을 포함하는 지도 표시 테마
 */
export const mgsTheme = (content = '', mode?: 'light' | 'dark') => {
  const sections: Record<string, Record<string, number>> = {}
  let current = ''
  for (const raw of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (/^\[.+\]$/.test(line)) {
      current = line.slice(1, -1).toLowerCase()
      sections[current] ??= {}
    } else {
      const pair = /^([^=;]+)=(-?\d+(?:\.\d+)?)\s*(?:;.*)?$/.exec(line)
      if (pair && current && Number.isFinite(Number(pair[2])))
        sections[current]![pair[1]!.trim().toLowerCase()] = Number(pair[2])
    }
  }
  const selected = sections.theme?.selected_theme ?? 0
  const selectedName =
    ['white', 'dark', ...Array.from({ length: 8 }, (_, i) => `user${i + 1}`)][selected] ?? 'white'
  const name = mode ? (mode === 'dark' ? 'dark' : 'white') : selectedName
  const dark = name === 'dark'
  const values = sections[name] ?? {}
  /**
   * 색상 표현의 유효성을 확인하고 기본값을 반영하는 색상 값 구성
   *
   * @param key 설정 파일에서 조회할 항목 이름
   * @param fallback 해당 설정이 없을 때 사용할 기본값
   * @returns 검증과 기본값 적용을 완료한 색상 값
   */
  const color = (key: string, fallback: number) => legacyColor(Math.trunc(values[key] ?? fallback))
  return {
    name,
    dark,
    pathWidth: Math.max(1, Math.min(100, values.path_width ?? values.path_pen_width ?? 3)) * 10,
    portStroke: dark ? 0xc4d1d8 : 0x000000,
    portFill: dark ? 0x243b49 : 0xffffff,
    background: color(
      'grid_color',
      dark ? legacyColor(parseInt(systemPalette.dark.background.slice(1), 16)) : 16777215,
    ),
    grid: color('grid_color_bold', dark ? 0x4a392c : 14211288),
    oneWay: color('node_oneway_color', dark ? 0xe6b05c : 16711680),
    bothWays: color('node_bothway_color', dark ? 0xbce175 : 2920046),
    virtual: color('node_virtual_color', dark ? 0x9f9078 : 8421504),
    font: color('node_font_color', dark ? 0xe8e8e8 : 0),
    fontBackground: color(
      'node_font_brush_color',
      dark ? legacyColor(parseInt(systemPalette.dark.background.slice(1), 16)) : 16777215,
    ),
    nodeFontSize: Math.max(1, Math.min(200, values.node_font_size ?? 10)) * 10,
    arrowSize: Math.max(0, Math.min(1000, values.path_setting_tri_size ?? 20)) * 10,
    portStrokeWidth: Math.max(0, Math.min(1000, values.port_pen_width ?? 15)) * 10,
  }
}

/**
 * 그룹 소속 포트를 숨기고 원본 그룹 외형으로 교체하는 표시용 포트 목록 구성
 * @param map 그룹과 개별 포트를 포함하는 원본 지도
 * @returns 선택 참조와 모서리 비율을 포함하는 표시용 포트 목록
 */
export const displayMapPorts = (map: MapDocument): (MapPort & { radiusRatio?: number })[] => {
  const grouped = new Set(map.portGroups?.flatMap((group) => group.portIds) ?? [])
  return [
    ...map.ports.filter((port) => !grouped.has(port.id)),
    ...(map.portGroups ?? []).map((group) => ({
      ...group,
      id: group.portIds[0] ?? '',
      nodeId: map.ports.find((port) => port.id === group.portIds[0])?.nodeId ?? 0,
      name: '',
      radiusRatio: 2,
    })),
  ]
}
