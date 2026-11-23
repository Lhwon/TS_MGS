/**
 * 파일명: interaction.ts
 * 설명: 원본 지도 조작의 근접 선택과 영역 선택 및 화면 맞춤 규칙
 * 작성자: 이희원
 * 작성일자: 2026-10-20
 */
import type { MapDocument, MapNode } from '@/entities/map/model/map.ts'
export interface MapPoint {
  x: number
  y: number
}
/**
 * 마우스 위치에서 선택 가능한 원본 지도 노드를 탐색하는 근접 판정
 * 원본 지도 거리와 마우스 버튼별 대상 제한을 적용하고 축소 화면에서 최소 클릭 영역을 제공
 *
 * @param nodes 노드 식별자와 지도 좌표를 포함하는 노드 목록
 * @param point 판정에 사용하는 지도 평면 좌표
 * @param button 선택 거리와 노드 종류 제한을 결정하는 마우스 버튼
 * @param unitsPerPixel 화면 한 픽셀에 해당하는 지도 거리
 * @returns 선택 가능 노드와 실제 지도 거리
 */
export const pickMgsNode = (
  nodes: MapNode[],
  point: MapPoint,
  button: 'left' | 'right',
  unitsPerPixel = 0,
) => {
  let nearest: MapNode | undefined
  let distance = Infinity
  for (const node of nodes) {
    if (button === 'left' ? node.curve : node.virtual) continue
    const value = Math.hypot(node.x - point.x, node.y - point.y)
    if (value < distance) {
      nearest = node
      distance = value
    }
  }
  const limit = Math.max(button === 'left' ? 700 : 500, unitsPerPixel * 8)
  return { node: distance < limit ? nearest : undefined, distance }
}
// 정방향 드래그는 선택 추가이며 역방향 드래그는 선택 해제인 원본 규칙
/**
 * 드래그 방향에 따라 노드 선택을 추가하거나 제거하는 영역 선택 계산
 * 영역 경계와 곡선 노드를 제외하고 기존 선택을 보존하는 원본 조작 규칙 적용
 *
 * @param nodes 노드 식별자와 지도 좌표를 포함하는 노드 목록
 * @param selected 영역 조작 이전에 선택된 노드 식별자 목록
 * @param start 영역 선택 또는 눈금의 시작 위치
 * @param end 영역 선택 또는 눈금의 종료 위치
 * @param adding 화면 진행 방향으로 판정한 선택 추가 여부
 * @returns 추가 또는 해제 결과를 반영한 선택 식별자 목록
 */
export const mgsAreaSelection = (
  nodes: MapNode[],
  selected: number[],
  start: MapPoint,
  end: MapPoint,
  adding = start.x < end.x,
) => {
  /**
   * 노드 좌표가 드래그 영역의 열린 경계 내부에 포함되는지 확인하는 위치 판정
   *
   * @param node 표시 또는 편집 대상 노드 정보
   * @returns 열린 영역 경계 내부에 포함되는지 여부
   */
  const inside = (node: MapNode) =>
    node.x > Math.min(start.x, end.x) &&
    node.x < Math.max(start.x, end.x) &&
    node.y > Math.min(start.y, end.y) &&
    node.y < Math.max(start.y, end.y)
  const ids = new Set(selected)
  for (const node of nodes) {
    if (!inside(node)) continue
    if (adding) {
      if (!node.curve) ids.add(node.id)
    } else ids.delete(node.id)
  }
  return [...ids]
}
/**
 * 노드와 포트 범위를 기준으로 원본 지도 맞춤 배율과 중심을 계산하는 화면 맞춤
 * 최소 배율과 최대 배율 및 세로 이동량을 반영하는 원본 표시 범위 계산
 *
 * @param map 기준 노드와 경로 및 포트를 포함하는 지도 문서
 * @param width 가로 화면 크기 또는 모델 폭
 * @param height 세로 화면 크기 또는 모델 높이
 * @param margin 화면 맞춤 시 지도 외곽에 추가하는 여백
 * @param offsetY 화면 맞춤 시 적용할 세로 이동량
 * @returns 원본 제한 범위를 적용한 배율과 중심 좌표
 */
export const mgsFit = (
  map: MapDocument,
  width: number,
  height: number,
  margin = 150,
  offsetY = 0,
) => {
  // 원본 포트 외곽 계산과 동일한 범위를 반영하는 지도 맞춤
  const points = [
    ...map.nodes,
    ...(map.layout?.visible ? layoutCorners(map.layout) : []),
    ...(map.portGroups ?? []).flatMap((group) => [
      { x: group.x - group.width / 2, y: group.y - group.height / 2 },
      { x: group.x + group.width / 2, y: group.y + group.height / 2 },
    ]),
    ...(map.shapes ?? []).flatMap((shape) => [
      { x: shape.x1, y: shape.y1 },
      { x: shape.x2, y: shape.y2 },
    ]),
    ...map.ports.map((port) => ({
      x: port.x + (port.width ?? 420),
      y: port.y + (port.height ?? 260),
    })),
  ]
  if (!points.length) return { x: 0, y: 0, scale: 1 }
  const xs = points.map((point) => point.x),
    ys = points.map((point) => point.y)
  const minX = Math.min(...xs),
    maxX = Math.max(...xs)
  const minY = Math.min(...ys),
    maxY = Math.max(...ys)
  const scale = Math.max(
    0.01,
    Math.min(5, ((width - margin) * 10) / (maxX - minX), ((height - margin) * 10) / (maxY - minY)),
  )
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 - offsetY * 10, scale }
}

/** 회전한 배경 도면의 네 모서리를 지도 좌표로 계산하는 표시 범위 */
export const layoutCorners = (layout: import('@/entities/map/model/map.ts').MapLayout) => {
  const radian = (layout.rotation * Math.PI) / 180,
    cos = Math.cos(radian),
    sin = Math.sin(radian)
  return [
    [0, 0],
    [layout.width, 0],
    [layout.width, layout.height],
    [0, layout.height],
  ].map(([x, y]) => ({ x: layout.x + x * cos - y * sin, y: layout.y + x * sin + y * cos }))
}
