/**
 * 파일명: proposal.ts
 * 설명: 지도 점검과 제한된 AI 문맥 및 구조화된 편집 제안 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
import type { MapDocument } from '@/entities/map/index.ts'
import type { FacilityDocument } from '@/entities/facility/index.ts'

export interface AssistantHistory {
  role: 'user' | 'assistant' | 'tool'
  tool_name?: string
  tool_calls?: AssistantToolCall[]
  content: string
}

export interface AssistantToolCall {
  type?: string
  function: { name: string; arguments: Record<string, unknown> }
}
export interface AssistantTurn {
  role: 'assistant'
  content: string
  tool_calls?: AssistantToolCall[]
}

export interface AssistantProposal {
  action:
    | 'message'
    | 'inspect_map'
    | 'move_nodes'
    | 'place_equipment'
    | 'generate_drawing_map'
    | 'calibrate_drawing'
    | 'set_path_direction'
    | 'recognize_drawing'
    | 'round_drawing_paths'
    | 'validate_drawing'
    | 'edit_drawing_objects'
  message: string
  nodeIds: number[]
  portIds: string[]
  dx: number
  dy: number
  rotation: number
  assetId: string
  drawingColor?: 'auto' | 'green' | 'magenta' | 'cyan' | 'blue' | 'red' | 'black' | 'vision'
  scaleMmPerPixel?: number
  referenceDistanceMm?: number
  region?: 'all' | 'left' | 'right' | 'top' | 'bottom' | 'selection'
  direction?: number
  objectIds?: string[]
  operation?: 'move' | 'resize' | 'rename' | 'rotate' | 'classify' | 'accept' | 'reject' | 'height'
  objectKind?: string
  label?: string
  width?: number
  height?: number
  heightMm?: number
  curveRadiusMm?: number
  vehicleWidthMm?: number
  clearanceMm?: number
}

/**
 * 전체 문서에서 연결과 중복 좌표 및 설비 포트 참조를 확인하는 결정적 지도 검사
 * @param map 현재 지도 문서
 * @param facility 현재 설비 문서
 * @returns 검사 범위와 개수 및 최대 표시 개수로 제한한 확인 항목
 */
export const inspectMap = (map: MapDocument, facility: FacilityDocument) => {
  const nodes = new Set(map.nodes.map((node) => node.id))
  const ports = new Set(map.ports.map((port) => port.id))
  const linked = new Set(map.edges.flatMap((edge) => [edge.from, edge.to]))
  const coordinates = new Map<string, number>()
  const findings: string[] = []

  for (const node of map.nodes) {
    const key = `${node.x},${node.y}`
    const previous = coordinates.get(key)
    if (previous !== undefined) findings.push(`동일 좌표 노드 N${previous}, N${node.id}`)
    else coordinates.set(key, node.id)
    if (!linked.has(node.id)) findings.push(`경로 연결이 없는 노드 N${node.id}`)
  }

  for (const edge of map.edges)
    if (!nodes.has(edge.from) || !nodes.has(edge.to))
      findings.push(`노드 참조 누락 경로 ${edge.id}`)

  for (const port of map.ports)
    if (!nodes.has(port.nodeId)) findings.push(`노드 참조 누락 포트 ${port.id}`)

  for (const instance of facility.instances)
    if (instance.portId && !ports.has(instance.portId))
      findings.push(`포트 참조 누락 설비 ${instance.name}`)

  return { count: findings.length, findings: findings.slice(0, 30) }
}

/**
 * 선택 대상을 우선 전달하고 대형 맵의 데이터 전송량을 제한하는 추론 문맥 구성
 * @param map 현재 지도 문서
 * @param facility 현재 설비 문서
 * @param selectedNodeIds 선택 노드 식별자
 * @param selectedPortId 선택 포트 식별자
 * @param selectedAssetId 선택 설비 모델 식별자
 * @returns 수량 요약과 제한된 대상 목록 및 검사 결과
 */
export const assistantContext = (
  map: MapDocument,
  facility: FacilityDocument,
  selectedNodeIds: number[],
  selectedPortId: string | null,
  selectedAssetId: string | null,
) => {
  const selected = new Set(selectedNodeIds)
  const nodes = [
    ...map.nodes.filter((node) => selected.has(node.id)),
    ...map.nodes.filter((node) => !selected.has(node.id)),
  ]
    .slice(0, 200)
    .map(({ id, x, y, name }) => ({ id, x, y, name: name.slice(0, 100) }))
  const ports = [
    ...map.ports.filter((port) => port.id === selectedPortId),
    ...map.ports.filter((port) => port.id !== selectedPortId),
  ]
    .slice(0, 200)
    .map(({ id, x, y, nodeId, name }) => ({ id, x, y, nodeId, name: name.slice(0, 100) }))
  return {
    units: map.units,
    name: map.name,
    selectedNodeIds: selectedNodeIds.slice(0, 200),
    selectionTruncated: selectedNodeIds.length > 200,
    selectedPortId,
    selectedAssetId,
    totals: {
      nodes: map.nodes.length,
      edges: map.edges.length,
      ports: map.ports.length,
      instances: facility.instances.length,
    },
    truncated: {
      nodes: nodes.length < map.nodes.length,
      ports: ports.length < map.ports.length,
      assets: facility.assets.length > 100,
    },
    nodes,
    ports,
    assets: facility.assets.slice(0, 100).map(({ id, name, kind }) => ({ id, name, kind })),
    occupiedPortIds: [
      ...new Set(
        facility.instances.flatMap((instance) => (instance.portId ? [instance.portId] : [])),
      ),
    ],
    inspection: inspectMap(map, facility),
  }
}
/**
 * 추론 응답의 작업 종류와 수치 및 전달한 대상 범위를 확인하는 실행 전 제안 검증
 * @param value 검증 전 추론 응답
 * @param context 추론에 전달한 지도 문맥
 * @returns 허용 작업과 대상만 포함하는 검증 완료 제안
 */
export const validateProposal = (
  value: unknown,
  context: ReturnType<typeof assistantContext>,
): AssistantProposal => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('AI 응답 형식이 올바르지 않습니다.')

  const plan = value as AssistantProposal

  if (
    ![
      'message',
      'inspect_map',
      'move_nodes',
      'place_equipment',
      'generate_drawing_map',
      'calibrate_drawing',
      'set_path_direction',
      'recognize_drawing',
      'round_drawing_paths',
      'validate_drawing',
      'edit_drawing_objects',
    ].includes(plan.action) ||
    typeof plan.message !== 'string' ||
    (!plan.message.trim() &&
      ![
        'generate_drawing_map',
        'calibrate_drawing',
        'set_path_direction',
        'recognize_drawing',
        'round_drawing_paths',
        'validate_drawing',
        'edit_drawing_objects',
      ].includes(plan.action)) ||
    plan.message.length > 5000 ||
    !Array.isArray(plan.nodeIds) ||
    !Array.isArray(plan.portIds) ||
    typeof plan.assetId !== 'string' ||
    ![plan.dx, plan.dy, plan.rotation].every(
      (number) =>
        typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1000000,
    )
  )
    throw new Error('AI 작업 제안의 형식이나 수치가 올바르지 않습니다.')

  if (
    plan.nodeIds.length > 200 ||
    plan.nodeIds.some(
      (id) => !Number.isSafeInteger(id) || !context.nodes.some((node) => node.id === id),
    ) ||
    plan.portIds.length > 200 ||
    plan.portIds.some(
      (id) => typeof id !== 'string' || !context.ports.some((port) => port.id === id),
    )
  )
    throw new Error('AI 제안에 확인되지 않은 대상이 있습니다. 대상을 선택하여 다시 요청해 주세요.')

  if (
    new Set(plan.nodeIds).size !== plan.nodeIds.length ||
    new Set(plan.portIds).size !== plan.portIds.length
  )
    throw new Error('AI 제안에 중복 대상이 있습니다. 다시 요청해 주세요.')

  if (
    plan.action === 'move_nodes' &&
    (!plan.nodeIds.length || (!plan.dx && !plan.dy) || context.selectionTruncated)
  )
    throw new Error('이동 대상이나 이동량을 확인해 주세요. 한 번에 노드 200개까지 처리합니다.')

  if (
    plan.action === 'place_equipment' &&
    (!plan.portIds.length || !context.assets.some((asset) => asset.id === plan.assetId))
  )
    throw new Error('배치할 모델과 포트를 확인해 주세요.')

  if (
    plan.action === 'generate_drawing_map' &&
    (!['auto', 'green', 'magenta', 'cyan', 'blue', 'red', 'black', 'vision'].includes(
      plan.drawingColor ?? 'auto',
    ) ||
      !Number.isFinite(plan.scaleMmPerPixel ?? 0) ||
      (plan.scaleMmPerPixel ?? 0) < 0)
  )
    throw new Error('도면 색상이나 축척 설정을 확인하세요.')
  if (
    plan.action === 'calibrate_drawing' &&
    (plan.nodeIds.length !== 2 ||
      !Number.isFinite(plan.referenceDistanceMm) ||
      plan.referenceDistanceMm! <= 0)
  )
    throw new Error('기준 노드 두 개와 실제 거리 mm를 지정하세요.')
  if (
    plan.action === 'set_path_direction' &&
    (![0, 1].includes(plan.direction!) ||
      !['all', 'left', 'right', 'top', 'bottom', 'selection'].includes(plan.region ?? 'all'))
  )
    throw new Error('경로 방향과 적용 구역을 확인하세요.')
  for (const key of [
    'width',
    'height',
    'heightMm',
    'curveRadiusMm',
    'vehicleWidthMm',
    'clearanceMm',
  ] as const)
    if (
      plan[key] !== undefined &&
      (!Number.isFinite(plan[key]) || plan[key]! < 0 || plan[key]! > 1000000)
    )
      throw new Error('설비와 차량 및 곡선 치수를 확인하세요.')
  if (
    plan.action === 'edit_drawing_objects' &&
    (!Array.isArray(plan.objectIds) ||
      !plan.objectIds.length ||
      plan.objectIds.length > 200 ||
      plan.objectIds.some((id) => typeof id !== 'string') ||
      !['move', 'resize', 'rename', 'rotate', 'classify', 'accept', 'reject', 'height'].includes(
        plan.operation ?? '',
      ) ||
      (plan.operation === 'resize' && !(plan.width! > 0 || plan.height! > 0)) ||
      (plan.operation === 'height' && !(plan.heightMm! > 0)) ||
      (plan.operation === 'rename' && (!plan.label?.trim() || plan.label.length > 200)) ||
      (plan.operation === 'classify' &&
        !['rack', 'shelf', 'equipment', 'conveyor', 'port', 'obstacle', 'text'].includes(
          plan.objectKind ?? '',
        )))
  )
    throw new Error('수정할 인식 객체와 변경 값을 확인하세요.')
  return plan
}
