/**
 * 파일명: drawingTools.ts
 * 설명: 에이전트가 선택한 도면 편집을 기존 지도 기능으로 실행하는 도구
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
import type { Ref } from 'vue'
import { useEditor } from '@/features/map-editor/index.ts'
import { useFacilityEditor } from '@/features/facility-editor/index.ts'
import {
  assistantContext,
  validateProposal,
  inspectMap,
  analyzeDrawing,
} from '@/features/ai-assistant/index.ts'
import {
  extractDrawingGraph,
  buildDrawingMap,
  alignDrawingToLayout,
  calibrateDrawingMap,
  mergeDrawingRegion,
  inDrawingRegion,
  recognizeDrawing,
  visionDrawingGraph,
  applyDrawingObjects,
  drawingObjectBounds,
  roundDrawingPaths,
  validateDrawingMap,
  type DrawingAttachment,
  type RouteColor,
  type DrawingFinding,
} from '@/features/drawing-import/index.ts'
import type { DrawingObject } from '@/entities/map/index.ts'
/** 기능의 실제 수행 결과를 다음 추론으로 반환하는 도면 편집 */
export const executeDrawingTool = async (
  name: string,
  args: Record<string, unknown>,
  request: AbortController,
  drawing: DrawingAttachment | undefined,
  options: {
    internal: (value: boolean) => void
    generated: () => void
    progress: (message: string) => void
    findings: Ref<DrawingFinding[]>
    settings: { tiles: number; radius: number; vehicleWidth: number; clearance: number }
  },
) => {
  const editor = useEditor(),
    facility = useFacilityEditor(),
    map = editor.document,
    scene = facility.document
  const context = assistantContext(
    map,
    scene,
    [
      ...new Set([
        ...editor.selectedIds,
        ...(editor.selectedId === null ? [] : [editor.selectedId]),
      ]),
    ],
    editor.selectedPortId,
    facility.selectedAssetId,
  )
  if (Array.isArray(args.nodeIds))
    context.nodes = map.nodes
      .filter((node) => args.nodeIds && (args.nodeIds as number[]).includes(node.id))
      .map(({ id, x, y, name }) => ({ id, x, y, name }))
  const mapContext = context
  const plan = validateProposal(
    {
      action: name,
      message: '작업 수행',
      nodeIds: [],
      portIds: [],
      dx: 0,
      dy: 0,
      rotation: 0,
      assetId: '',
      ...args,
    },
    context,
  )
  const drawingSettings = { value: options.settings }
  let lastMessage = ''
  const replyId = ''
  /** 수행 상태와 실제 결과를 기록하는 도구 관찰 */
  const updateMessage = (_id: string, message: string, _state?: string) => {
    lastMessage = message
    options.progress(message)
  }
  if (plan.action === 'generate_drawing_map') {
    if (!drawing) throw new Error('맵을 생성할 도면 이미지를 첨부하세요.')
    const requestedColor =
      plan.drawingColor && plan.drawingColor !== 'auto' ? plan.drawingColor : 'auto'

    const preferredColor = requestedColor !== 'auto' ? requestedColor : drawing.vision?.routeColor

    const color = (
      preferredColor && preferredColor !== 'unknown'
        ? preferredColor
        : Object.entries(drawing.colors)
              .filter(([key]) => key !== 'black')
              .sort((a, b) => b[1] - a[1])[0][1] <
            drawing.analysisWidth * drawing.analysisHeight * 0.002
          ? 'vision'
          : Object.entries(drawing.colors)
              .filter(([key]) => key !== 'black')
              .sort((a, b) => b[1] - a[1])[0][0]
    ) as RouteColor | 'vision'

    let detected = drawing.detections ?? []

    const warnings: string[] = []

    if (args.includeObjects === true || color === 'vision') {
      try {
        const result = await recognizeDrawing(
          drawing,
          analyzeDrawing,
          request.signal,
          (message) => {
            updateMessage(replyId, message, 'loading')
          },
          drawingSettings.value.tiles,
        )

        detected = result.objects

        warnings.push(...result.warnings)
      } catch (cause) {
        if (request.signal.aborted) throw new Error('작업 취소')
        warnings.push(`설비 인식 실패 · ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }

    updateMessage(replyId, '도면의 통로 중심선과 교차점을 구성하고 있습니다.', 'loading')

    const graph =
      color === 'vision'
        ? visionDrawingGraph(drawing)
        : await extractDrawingGraph(drawing, color, request.signal, (message) => {
            updateMessage(replyId, message, 'loading')
          })

    if (request.signal.aborted || editor.document !== map)
      throw new Error('지도 변경으로 작업을 중단했습니다.')

    const scale = map.drawing?.id === drawing.id ? map.drawing.scaleMmPerPixel : null

    let generated = buildDrawingMap(drawing, graph, scale)
    if (map.layout?.id === drawing.id) generated = alignDrawingToLayout(generated, map.layout)
    generated.drawing!.routeColor = color

    if (args.includeObjects === true && detected.length && (!plan.region || plan.region === 'all'))
      generated = applyDrawingObjects(generated, detected)

    let rounded = 0

    if (args.curves === true && (!plan.region || plan.region === 'all')) {
      const result = roundDrawingPaths(
        generated,
        plan.curveRadiusMm || drawingSettings.value.radius,
      )
      generated = result.map
      rounded = result.rounded
    }

    generated.drawing!.analysisWarnings = warnings.map((item) => item.slice(0, 300))
    generated.drawing!.vehicleWidthMm = drawingSettings.value.vehicleWidth
    generated.drawing!.clearanceMm = drawingSettings.value.clearance

    const region = plan.region ?? 'all'
    options.internal(true)

    try {
      if (region === 'all') {
        editor.importGeneratedMap(generated)
      } else {
        let merged = mergeDrawingRegion(
          map,
          generated,
          region,
          region === 'selection' ? mapContext.selectedNodeIds : undefined,
        )

        const selectedNodes = map.nodes.filter((node) =>
          mapContext.selectedNodeIds.includes(node.id),
        )
        const left = Math.min(...selectedNodes.map((node) => node.x)),
          right = Math.max(...selectedNodes.map((node) => node.x))
        const bottom = Math.min(...selectedNodes.map((node) => node.y)),
          top = Math.max(...selectedNodes.map((node) => node.y))
        /** 선택 경계와 명명한 구역을 일치시키는 인식 객체 병합 범위 */
        const inside = (object: DrawingObject) => {
          const point = drawingObjectBounds(map, object)
          return region === 'selection'
            ? point.x >= left && point.x <= right && point.y >= bottom && point.y <= top
            : inDrawingRegion(map, region, point)
        }
        const combined = new Map(
          (map.drawing?.objects ?? [])
            .filter((object) => !inside(object))
            .map((object) => [object.id, object]),
        )
        for (const object of detected.filter(inside)) combined.set(object.id, object)
        merged = applyDrawingObjects(merged, [...combined.values()])
        editor.commit((document) => Object.assign(document, merged))
      }
    } finally {
      options.internal(false)
    }

    options.generated()

    options.findings.value = validateDrawingMap(
      editor.document,
      drawing,
      drawingSettings.value.vehicleWidth,
      drawingSettings.value.clearance,
    )

    const result = `도면 경로 생성 완료 · 노드 ${editor.document.nodes.length}개 · 경로 ${editor.document.edges.length}개 · 포트 ${editor.document.ports.length}개 · 인식 ${detected.length}개 · 곡선 ${rounded}곳 · 실제 비율 ${editor.document.units === 'mm' ? '적용' : '미확정 초안'}${warnings.length ? '\n' + warnings.join('\n') : ''}`
    updateMessage(replyId, result, 'applied')

    editor.message = `도면 맵 생성 완료 · 노드 ${editor.document.nodes.length}개 · ${editor.document.units} 좌표`
    return { message: lastMessage }
  }

  if (
    [
      'recognize_drawing',
      'round_drawing_paths',
      'validate_drawing',
      'edit_drawing_objects',
    ].includes(plan.action)
  ) {
    if (!map.drawing) throw new Error('도면 맵을 먼저 생성하세요.')

    if (editor.readOnly && plan.action !== 'validate_drawing')
      throw new Error('읽기 전용 맵은 수정할 수 없습니다.')

    let next = map
    let report = ''

    if (plan.action === 'recognize_drawing') {
      if (!drawing) throw new Error('분석할 도면을 첨부하세요.')

      drawing.objectsAnalyzed = false
      drawing.tileResults = undefined
      drawing.detections = structuredClone(map.drawing.objects ?? [])

      const result = await recognizeDrawing(
        drawing,
        analyzeDrawing,
        request.signal,
        (message) => {
          updateMessage(replyId, message, 'loading')
        },
        drawingSettings.value.tiles,
      )

      next = applyDrawingObjects(map, result.objects)
      report = `설비·포트·문자 ${result.objects.length}개 인식 완료${result.warnings.length ? '\n' + result.warnings.join('\n') : ''}`
    } else if (plan.action === 'round_drawing_paths') {
      const result = roundDrawingPaths(map, plan.curveRadiusMm || drawingSettings.value.radius)

      next = result.map
      report = `모서리 ${result.rounded}개를 접선 곡선으로 변경했습니다. 공간이 부족한 반경은 구간 길이에 맞춰 줄였습니다.`
    } else if (plan.action === 'edit_drawing_objects') {
      const objects = structuredClone(map.drawing.objects ?? [])
      const factor = map.drawing.scaleMmPerPixel ?? map.drawing.workingScale ?? 1

      for (const id of plan.objectIds ?? []) {
        const object = objects.find((item) => item.id === id)

        if (!object) throw new Error(`도면 객체 ${id}를 찾지 못했습니다.`)

        if (plan.operation === 'move') {
          object.x += plan.dx / factor
          object.y -= plan.dy / factor
        }

        if (plan.operation === 'resize') {
          const cx = object.x + object.width / 2,
            cy = object.y + object.height / 2
          if (plan.width) object.width = plan.width / factor
          if (plan.height) object.height = plan.height / factor
          object.x = cx - object.width / 2
          object.y = cy - object.height / 2
        }

        if (plan.operation === 'rename') object.label = plan.label!
        if (plan.operation === 'rotate') object.rotation = plan.rotation
        if (plan.operation === 'classify') object.kind = plan.objectKind as DrawingObject['kind']
        if (plan.operation === 'height') object.heightMm = plan.heightMm
        if (plan.operation === 'accept') object.status = 'accepted'
        if (plan.operation === 'reject') object.status = 'rejected'

        object.locked = true
      }

      next = applyDrawingObjects(map, objects)
      if (drawing) drawing.detections = structuredClone(next.drawing!.objects ?? [])
      report = `${plan.objectIds?.join(', ')} 객체 수정 완료`
    }

    if (request.signal.aborted || editor.document !== map)
      throw new Error('지도 변경으로 작업을 중단했습니다.')

    if (next !== map) {
      options.internal(true)
      try {
        editor.commit((document) => Object.assign(document, next))
      } finally {
        options.internal(false)
      }
    }
    const width = plan.vehicleWidthMm || drawingSettings.value.vehicleWidth
    const clearance = plan.clearanceMm || drawingSettings.value.clearance
    options.findings.value = validateDrawingMap(editor.document, drawing, width, clearance)
    if (plan.action === 'validate_drawing')
      report = `차량 폭 ${width}mm · 한쪽 여유 ${clearance}mm 기준 검토 ${options.findings.value.length}건\n${
        options.findings.value
          .slice(0, 30)
          .map((item) => `${item.target} · ${item.message}`)
          .join('\n') || '검사 범위에서 검토 항목이 없습니다.'
      }\n전체 결과는 도면 분석 패널에서 확인하세요.`
    updateMessage(replyId, report, 'applied')
    return { message: lastMessage }
  }
  if (plan.action === 'calibrate_drawing') {
    const calibrated = calibrateDrawingMap(map, plan.nodeIds, plan.referenceDistanceMm!)
    options.internal(true)
    try {
      editor.commit((document) => Object.assign(document, calibrated))
    } finally {
      options.internal(false)
    }
    options.generated()
    updateMessage(replyId, '기준 거리를 반영해 도면 맵과 배경을 mm 좌표로 보정했습니다.', 'applied')
    return { message: lastMessage }
  }
  if (plan.action === 'set_path_direction') {
    const selection = new Set(plan.nodeIds.length ? plan.nodeIds : mapContext.selectedNodeIds)
    const region = plan.region ?? 'all'
    if (region === 'selection' && !selection.size)
      throw new Error('방향을 변경할 노드를 선택하세요.')
    const nodes = new Map(map.nodes.map((node) => [node.id, node]))
    const targets = new Set(
      map.edges
        .filter((edge) =>
          region === 'selection'
            ? selection.has(edge.from) && selection.has(edge.to)
            : inDrawingRegion(map, region, {
                x: (nodes.get(edge.from)!.x + nodes.get(edge.to)!.x) / 2,
                y: (nodes.get(edge.from)!.y + nodes.get(edge.to)!.y) / 2,
              }),
        )
        .map((edge) => edge.id),
    )
    if (!targets.size) throw new Error('해당 구역에 변경할 경로가 없습니다.')
    options.internal(true)
    try {
      editor.commit((document) => {
        for (const edge of document.edges) if (targets.has(edge.id)) edge.direction = plan.direction
        for (const node of document.nodes)
          node.direction = document.edges.some(
            (edge) => (edge.from === node.id || edge.to === node.id) && edge.direction === 1,
          )
            ? 1
            : 0
      })
    } finally {
      options.internal(false)
    }
    updateMessage(
      replyId,
      `${targets.size}개 경로를 ${plan.direction === 1 ? '양방향' : '기존 연결 방향의 단방향'}으로 변경했습니다.`,
      'applied',
    )
    return { message: lastMessage }
  }
  if (plan.action === 'inspect_map') {
    const inspection = inspectMap(map, scene)
    const report =
      `연결 참조 · 미연결 노드 · 동일 좌표 · 3D 포트 참조 점검 결과 ${inspection.count}건\n` +
      (inspection.findings.join('\n') || '해당 검사 항목에서 확인할 사항이 없습니다.') +
      (inspection.count > 30 ? '\n처음 30건까지 표시합니다.' : '')
    updateMessage(replyId, report)
    return { message: lastMessage }
  }

  throw new Error(`지원하지 않는 도면 도구 ${name}`)
}
