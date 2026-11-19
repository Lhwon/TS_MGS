/**
 * 파일명: tools.ts
 * 설명: 에이전트의 조회와 배경 및 지도와 설비 편집 도구 실행
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import type { Ref } from 'vue'
import {
  subdividePaths,
  shortestMapPath,
  useEditor,
  inspectPortApproach,
  auditPortReferences,
  setPortApproachReverse,
} from '@/features/map-editor/index.ts'
import { useFacilityEditor } from '@/features/facility-editor/index.ts'
import {
  analyzeDrawing,
  editMapObjects,
  inspectSelectedNodes,
  editSelectedNodes,
  selectionDelta,
  searchMgsTraining,
  type AssistantToolCall,
} from '@/features/ai-assistant/index.ts'
import {
  mapGeometryKey,
  designRack,
  type FacilityAsset,
  type FacilityInstance,
} from '@/entities/facility/index.ts'
import {
  createLayout,
  recognizeDrawing,
  calibrateDrawingMap,
  supportedDimensionLine,
  type DrawingAttachment,
  type LayoutOptions,
  type DrawingFinding,
} from '@/features/drawing-import/index.ts'
import { executeDrawingTool } from '@/widgets/ai-assistant/model/drawingTools.ts'
import type { MapDocument } from '@/entities/map/index.ts'
const inspectedApproaches = new WeakMap<
  AbortController,
  { map: MapDocument; portIds: Set<string> }
>()
/** 편집 작업 전체에 적용할 실제 화면 선택 범위 */
const selectedNodeIds = (editor: ReturnType<typeof useEditor>) => [
  ...new Set([...editor.selectedIds, ...(editor.selectedId === null ? [] : [editor.selectedId])]),
]

interface Options {
  context: () => ReturnType<typeof agentContext>
  drawing: () => Promise<DrawingAttachment>
  internal: (value: boolean) => void
  generated: () => void
  focus: (point: { x: number; y: number }) => void
  progress: (message: string) => void
  findings: Ref<DrawingFinding[]>
  settings: { tiles: number; radius: number; vehicleWidth: number; clearance: number }
}
/** 영상 분석 없이 현재 작업 환경을 전달하는 문맥 요약 */
export const agentContext = (attachment?: DrawingAttachment) => {
  const editor = useEditor(),
    facility = useFacilityEditor(),
    map = editor.document
  const nodeIds = selectedNodeIds(editor)
  return {
    map: {
      name: editor.sourceName,
      units: map.units,
      readOnly: editor.readOnly,
      nodes: map.nodes.length,
      edges: map.edges.length,
      ports: map.ports.length,
    },
    selection: {
      nodeIds: nodeIds.slice(0, 100),
      nodeCount: nodeIds.length,
      nodeIdsTruncated: nodeIds.length > 100,
      details: inspectSelectedNodes(map, nodeIds),
      port: map.ports.find((port) => port.id === editor.selectedPortId) ?? null,
      instance:
        facility.document.instances.find((instance) => instance.id === facility.selectedId) ?? null,
      portId: editor.selectedPortId,
      assetId: facility.selectedAssetId,
    },
    attachment: attachment
      ? {
          name: attachment.name,
          width: attachment.width,
          height: attachment.height,
          colors: attachment.colors,
        }
      : null,
    drawing: map.drawing
      ? {
          name: map.drawing.name,
          calibrated: map.units === 'mm',
          objects: map.drawing.objects?.length ?? 0,
        }
      : null,
    layout: map.layout
      ? {
          name: map.layout.name,
          x: map.layout.x,
          y: map.layout.y,
          width: map.layout.width,
          height: map.layout.height,
          rotation: map.layout.rotation,
          opacity: map.layout.opacity,
          visible: map.layout.visible,
          calibrated: map.layout.calibrated,
        }
      : null,
    equipment: {
      models: facility.document.assets.length,
      instances: facility.document.instances.length,
    },
  }
}
/** 필요한 객체만 이름과 페이지로 조회하는 지도 읽기 */
const readContext = (args: Record<string, unknown>) => {
  const editor = useEditor(),
    facility = useFacilityEditor(),
    map = editor.document
  const tables: Record<string, unknown[]> = {
    nodes: map.nodes,
    edges: map.edges,
    ports: map.ports,
    objects: map.drawing?.objects ?? [],
    models: facility.document.assets.map(({ id, name, kind, parts }) => ({
      id,
      name,
      kind,
      partCount: parts.length,
    })),
    instances: facility.document.instances,
    shapes: map.shapes ?? [],
  }
  const rows = tables[String(args.entity)]
  if (!rows) throw new Error('조회할 객체 종류를 확인하세요.')
  const query = String(args.query ?? '').toLowerCase(),
    filtered = query
      ? rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query))
      : rows
  const offset = Math.max(0, Math.trunc(Number(args.offset) || 0)),
    limit = Math.max(1, Math.min(100, Math.trunc(Number(args.limit) || 30)))
  return {
    total: filtered.length,
    offset,
    rows: filtered.slice(offset, offset + limit),
    hasMore: offset + limit < filtered.length,
  }
}
/**
 * 현재 문서에서 선택한 도구를 실행하고 관찰할 결과를 반환하는 에이전트 작업
 * @param call 모델이 선택한 도구와 인수
 * @param request 취소와 오래된 응답을 차단할 요청
 * @param options 화면과 편집 이력을 연결하는 콜백
 * @returns 실제 수행 결과
 */
export const executeAgentTool = async (
  call: AssistantToolCall,
  request: AbortController,
  options: Options,
): Promise<unknown> => {
  const editor = useEditor(),
    facility = useFacilityEditor(),
    map = editor.document,
    scene = facility.document
  const name = call.function.name,
    args = call.function.arguments
  /** 동기 변경 구간만 외부 편집과 구분하는 이력 적용 */
  const mutate = (change: () => void) => {
    options.internal(true)
    try {
      change()
    } finally {
      options.internal(false)
    }
  }
  request.signal.throwIfAborted()
  for (const key of [
    'widthMm',
    'realWidthMm',
    'x',
    'y',
    'dx',
    'dy',
    'rotation',
    'opacity',
    'width',
    'depth',
    'height',
    'heightMm',
    'curveRadiusMm',
    'vehicleWidthMm',
    'clearanceMm',
  ])
    if (
      args[key] !== undefined &&
      (!Number.isFinite(args[key]) || Math.abs(Number(args[key])) > 1e9)
    )
      throw new Error(`${key} 수치를 확인하세요.`)
  if (name === 'get_map_context')
    return args.entity === 'summary' ? options.context() : readContext(args)
  if (name === 'search_mgs_training') return searchMgsTraining(String(args.query ?? ''))
  if (name === 'audit_port_references') {
    const { checked, issues } = auditPortReferences(
      map,
      typeof args.portId === 'string' ? args.portId : undefined,
    )
    const offset = Math.max(0, Math.trunc(Number(args.offset) || 0))
    return {
      checked,
      total: issues.length,
      offset,
      issues: issues.slice(offset, offset + 40),
      hasMore: offset + 40 < issues.length,
    }
  }
  if (name === 'port_approach') {
    const portId = String(args.portId ?? editor.selectedPortId ?? '')
    const state = inspectPortApproach(map, portId)
    const reviewed = inspectedApproaches.get(request)
    if (args.operation === 'inspect') {
      if (reviewed?.map === map) reviewed.portIds.add(portId)
      else inspectedApproaches.set(request, { map, portIds: new Set([portId]) })
      return state
    }
    if (
      args.operation !== 'set_reverse' ||
      typeof args.edgeId !== 'string' ||
      typeof args.reverse !== 'boolean'
    )
      throw new Error('진입 경로와 후진 설정 여부를 지정하세요.')
    if (editor.readOnly) throw new Error('읽기 전용 지도입니다.')
    if (reviewed?.map !== map || !reviewed.portIds.has(portId))
      throw new Error(
        '먼저 현재 지도에서 port_approach inspect로 이 포트의 진입 경로를 조회하세요.',
      )
    const before = state.approaches.find((row) => row.edgeId === args.edgeId)
    if (!before) throw new Error('선택한 경로는 이 포트로 진입할 수 없습니다.')
    if (before.reverse === args.reverse) return { changed: false, portId, before, after: before }
    const { edgeId, reverse } = args
    mutate(() =>
      editor.commit((document) => {
        setPortApproachReverse(document, portId, edgeId, reverse)
      }),
    )
    const after = inspectPortApproach(editor.document, portId).approaches.find(
      (row) => row.edgeId === edgeId,
    )
    if (after?.reverse !== reverse) throw new Error('포트 진입 변경 결과를 확인할 수 없습니다.')
    return { changed: true, portId, before, after, undoAvailable: editor.canUndo }
  }
  if (name === 'subdivide_paths') {
    if (editor.readOnly) throw new Error('읽기 전용 지도입니다.')
    const selected = args.scope === 'selection' ? selectedNodeIds(editor) : undefined
    if (selected && !selected.length) throw new Error('선택한 노드가 없습니다.')
    const output = subdividePaths(map, Number(args.spacingMm), selected)
    mutate(() => editor.commit((document) => Object.assign(document, output.map)))
    return {
      added: output.added,
      changed: output.changed,
      spacingMm: output.spacing,
      curvesPreserved: output.curvesPreserved,
      remaining: '곡선은 원형 유지',
      state: options.context(),
    }
  }
  if (name === 'measure_path') return shortestMapPath(map, Number(args.from), Number(args.to))
  if (name === 'edit_selection') {
    const context = options.context().selection
    if (args.operation === 'inspect') return context
    if (editor.readOnly) throw new Error('읽기 전용 지도는 변경할 수 없습니다.')
    const targets = [
      ...(context.nodeIds.length ? ['nodes'] : []),
      ...(context.port ? ['port'] : []),
      ...(context.instance ? ['instance'] : []),
    ]
    if (!targets.length)
      throw new Error('현재 선택한 객체가 없습니다. 대상을 선택하거나 ID로 지정하세요.')
    if (args.target === undefined && targets.length > 1)
      throw new Error('노드·포트·설비가 함께 선택되어 있습니다. 대상 종류를 확인하세요.')
    const target = String(args.target ?? targets[0])
    if (!targets.includes(target)) throw new Error('선택한 대상 종류를 확인하세요.')
    if (target === 'nodes') {
      const result = editSelectedNodes(map, selectedNodeIds(editor), args)
      mutate(() => editor.commit((document) => Object.assign(document, result.map)))
      return {
        changed: result.results,
        delta: result.delta,
        before: result.selection,
        after: options.context().selection,
      }
    }
    const object = target === 'port' ? context.port! : context.instance!
    const center = 'position' in object ? object.position : object
    const delta = args.operation === 'delete' ? undefined : selectionDelta(map, center, args)
    if (!['move', 'duplicate', 'delete'].includes(String(args.operation)))
      throw new Error('선택 작업 종류를 확인하세요.')
    if (args.operation === 'duplicate' && !delta!.dx && !delta!.dy)
      throw new Error('복제 위치가 필요합니다.')
    if (target === 'port') {
      const port = context.port!
      const result = editMapObjects(map, [
        {
          entity: 'port',
          operation:
            args.operation === 'move'
              ? 'update'
              : args.operation === 'duplicate'
                ? 'create'
                : 'delete',
          ...(args.operation === 'duplicate' ? {} : { id: port.id }),
          ...(delta
            ? {
                value: {
                  name: port.name,
                  nodeId: port.nodeId,
                  width: port.width,
                  height: port.height,
                  x: port.x + delta.dx,
                  y: port.y + delta.dy,
                },
              }
            : {}),
        },
      ])
      mutate(() => editor.commit((document) => Object.assign(document, result.map)))
      return { changed: result.results, delta }
    }
    const instance = context.instance!
    mutate(() =>
      facility.commit((document) => {
        if (args.operation === 'delete') {
          document.instances = document.instances.filter((item) => item.id !== instance.id)
          return
        }
        const copy = JSON.parse(JSON.stringify(instance)) as FacilityInstance
        copy.position.x += delta!.dx
        copy.position.y += delta!.dy
        if (args.operation === 'duplicate') {
          copy.id = crypto.randomUUID()
          delete copy.portId
          delete copy.portOffset
          document.instances.push(copy)
        } else {
          if (copy.portId) {
            copy.portOffset ??= { x: 0, y: 0, z: 0 }
            copy.portOffset.x += delta!.dx
            copy.portOffset.y += delta!.dy
          }
          Object.assign(
            document.instances.find((item) => item.id === instance.id)!,
            copy,
          )
        }
      }),
    )
    return { operation: args.operation, id: instance.id, delta }
  }
  if (name === 'focus_map') {
    const node = map.nodes.find((node) => node.id === args.nodeId)
    if (args.nodeId !== undefined && !node) throw new Error('노드를 찾지 못했습니다.')
    if (node) options.focus(node)
    else options.generated()
    return { focused: true }
  }
  if (name === 'inspect_drawing') {
    const drawing = await options.drawing()
    if (args.detail === 'objects') {
      const result = await recognizeDrawing(
        drawing,
        analyzeDrawing,
        request.signal,
        options.progress,
        [4, 12, 32].includes(Number(args.tiles)) ? Number(args.tiles) : options.settings.tiles,
      )
      return {
        count: result.objects.length,
        objects: result.objects.slice(0, 50),
        warnings: result.warnings,
        mapChanged: false,
      }
    }
    drawing.vision ??= await analyzeDrawing(drawing.visionImage, request.signal)
    const candidates = drawing.vision.references ?? []
    const references = candidates.filter((reference) => supportedDimensionLine(drawing, reference))
    return {
      ...drawing.vision,
      references,
      dimensionCandidatesRejected: candidates.length - references.length,
      dimensionReview:
        candidates.length !== references.length
          ? '치수선 후보가 원본 픽셀과 일치하지 않습니다. 기준 길이를 확인하거나 px 초안을 생성하세요.'
          : '치수선 위치와 인쇄 치수 후보입니다. 숫자가 애매하면 확인 후 적용하세요.',
      mapChanged: false,
    }
  }
  if (editor.readOnly && !['inspect_map', 'validate_drawing'].includes(name))
    throw new Error('읽기 전용 지도는 변경할 수 없습니다.')
  if (name === 'layout_drawing') {
    if (args.mode === 'remove') {
      mutate(() =>
        editor.commit((document) => {
          delete document.layout
        }),
      )
      return { removed: true, mapObjectsChanged: false }
    }
    if (args.mode === 'hide' || args.mode === 'show') {
      if (!map.layout) throw new Error('적용된 배경 도면이 없습니다.')
      mutate(() =>
        editor.commit((document) => {
          document.layout!.visible = args.mode === 'show'
        }),
      )
      return { visible: args.mode === 'show' }
    }
    if (!['apply', 'update'].includes(String(args.mode)))
      throw new Error(
        '배경 mode는 apply, update, show, hide, remove 중 하나여야 합니다. 불필요한 widthMm과 crop은 생략하세요.',
      )
    const drawing = await options.drawing()
    const settings = { ...args } as LayoutOptions
    if (settings.widthMm === 0) delete settings.widthMm
    if (settings.crop && !Object.keys(settings.crop).length) delete settings.crop
    const layout = createLayout(map, drawing, settings)
    if (request.signal.aborted || map !== editor.document)
      throw new Error('지도 변경으로 배경 적용을 중단했습니다.')
    mutate(() =>
      editor.commit((document) => {
        document.layout = layout
      }),
    )
    options.generated()
    return {
      applied: true,
      name: layout.name,
      width: layout.width,
      height: layout.height,
      opacity: layout.opacity,
      calibrated: layout.calibrated,
      mapObjectsChanged: false,
      note: layout.calibrated
        ? '실제 폭 적용'
        : '화면에 맞춘 임시 참고 배치이며 실제 치수는 미확정',
    }
  }
  if (name === 'edit_map') {
    const result = editMapObjects(map, args.operations)
    mutate(() => editor.commit((document) => Object.assign(document, result.map)))
    return { changed: result.results }
  }
  if (name === 'history') {
    if (!['undo', 'redo'].includes(String(args.direction)))
      throw new Error('편집 이력 방향을 확인하세요.')
    const target = args.target === 'equipment' ? facility : editor
    mutate(() => {
      if (args.direction === 'undo') target.undo()
      else target.redo()
    })
    return { completed: args.direction, state: agentContext() }
  }
  if (name === 'move_nodes') {
    if (
      !Array.isArray(args.nodeIds) ||
      !args.nodeIds.length ||
      args.nodeIds.length > 200 ||
      args.nodeIds.some((id) => !map.nodes.some((node) => node.id === id)) ||
      !Number.isFinite(args.dx) ||
      !Number.isFinite(args.dy)
    )
      throw new Error('이동 대상과 거리를 확인하세요.')
    mutate(() => editor.moveNodes(args.nodeIds as number[], Number(args.dx), Number(args.dy)))
    return { moved: args.nodeIds, dx: args.dx, dy: args.dy }
  }
  if (name === 'edit_equipment') return editEquipment(args, mutate)
  if (name === 'place_equipment') {
    if (map.units !== 'mm')
      throw new Error(
        '실제 설비를 배치하려면 알려진 치수로 도면 비율을 맞춰야 합니다. 사용자가 아는 실제 길이를 자연스럽게 질문하세요.',
      )
    const asset = scene.assets.find((asset) => asset.id === args.assetId)
    if (!asset) throw new Error('모델을 찾지 못했습니다.')
    const portIds = Array.isArray(args.portIds) ? (args.portIds as string[]) : [],
      placements: FacilityInstance[] = []
    if (portIds.length > 200) throw new Error('한 번에 포트 200개까지 배치할 수 있습니다.')
    for (const id of portIds) {
      const port = map.ports.find((port) => port.id === id)
      if (!port) throw new Error(`포트 ${id}를 찾지 못했습니다.`)
      if (scene.instances.some((instance) => instance.portId === id))
        throw new Error(`포트 ${id}에 설비가 있습니다.`)
      placements.push({
        id: crypto.randomUUID(),
        assetId: asset.id,
        name: asset.name,
        position: { x: port.x, y: port.y, z: 0 },
        rotation: Number(args.rotation ?? 0),
        portId: id,
        portOffset: { x: 0, y: 0, z: 0 },
      })
    }
    if (!portIds.length) {
      if (!Number.isFinite(args.x) || !Number.isFinite(args.y))
        throw new Error('배치할 포트나 위치가 필요합니다.')
      placements.push({
        id: crypto.randomUUID(),
        assetId: asset.id,
        name: asset.name,
        position: { x: Number(args.x), y: Number(args.y), z: 0 },
        rotation: Number(args.rotation ?? 0),
      })
    }
    mutate(() =>
      facility.addPlacements(asset, placements, {
        name: editor.sourceName,
        geometryKey: mapGeometryKey(map.nodes),
      }),
    )
    return {
      placed: placements.map((instance) => ({
        id: instance.id,
        portId: instance.portId,
        position: instance.position,
      })),
    }
  }
  if (name === 'calibrate_drawing' && Number(args.realWidthMm) > 0) {
    const width = Number(args.realWidthMm)
    if (map.drawing) {
      const a = map.nodes[0],
        b = map.nodes.find((node) => a && Math.hypot(node.x - a.x, node.y - a.y) > 0)
      if (!a || !b) throw new Error('서로 다른 두 기준 지점이 필요합니다.')
      const distance =
        (Math.hypot(a.x - b.x, a.y - b.y) * width) /
        (map.drawing.width * (map.drawing.scaleMmPerPixel ?? map.drawing.workingScale ?? 1))
      const calibrated = calibrateDrawingMap(map, [a.id, b.id], distance)
      mutate(() => editor.commit((document) => Object.assign(document, calibrated)))
    } else if (map.layout) {
      const drawing = await options.drawing(),
        layout = createLayout(map, drawing, { widthMm: width })
      mutate(() =>
        editor.commit((document) => {
          document.layout = layout
        }),
      )
    } else throw new Error('비율을 맞출 도면이 없습니다.')
    options.generated()
    return { calibrated: true, realWidthMm: width }
  }
  const drawing = [
    'plan_drawing_route',
    'generate_drawing_map',
    'recognize_drawing',
    'validate_drawing',
  ].includes(name)
    ? await options.drawing()
    : undefined
  return executeDrawingTool(name, args, request, drawing, {
    ...options,
    settings: {
      ...options.settings,
      tiles: [4, 12, 32].includes(Number(args.tiles)) ? Number(args.tiles) : options.settings.tiles,
    },
  })
}
/** 부품으로 수정 가능한 모델의 제작과 삭제를 연결하는 설비 도구 */
const editEquipment = (args: Record<string, unknown>, mutate: (change: () => void) => void) => {
  const editor = useEditor(),
    facility = useFacilityEditor(),
    current = facility.document.assets.find((asset) => asset.id === args.assetId)
  if (args.operation === 'delete') {
    if (!current) throw new Error('모델을 찾지 못했습니다.')
    if (facility.document.instances.some((instance) => instance.assetId === current.id))
      throw new Error('배치된 모델은 배치를 먼저 정리해야 합니다.')
    mutate(() =>
      facility.commit((document) => {
        document.assets = document.assets.filter((asset) => asset.id !== current.id)
      }),
    )
    return { deleted: current.id }
  }
  if (
    !['create', 'update'].includes(String(args.operation)) ||
    (args.operation === 'update' && !current)
  )
    throw new Error('모델과 작업 종류를 확인하세요.')
  const id = current?.id ?? crypto.randomUUID(),
    name = String(args.name ?? current?.name ?? '설비 모델'),
    kind = String(args.kind ?? current?.kind ?? 'equipment') as FacilityAsset['kind']
  let asset: FacilityAsset
  if (Array.isArray(args.parts) && args.parts.length) {
    if (args.parts.length > 500) throw new Error('부품 500개까지 제작할 수 있습니다.')
    asset = {
      id,
      name,
      kind,
      parts: args.parts.map((part, index) => ({
        id: `part-${index + 1}`,
        name: String(part.name ?? `부품 ${index + 1}`),
        shape: part.shape,
        position: { x: part.x, y: part.y, z: part.z },
        size: { x: part.width, y: part.depth, z: part.height },
        rotation: Number(part.rotation ?? 0),
        color: String(part.color ?? '#8296ad'),
      })),
    }
  } else if (
    current &&
    args.width === undefined &&
    args.depth === undefined &&
    args.height === undefined
  )
    asset = { ...structuredClone(current), name }
  else {
    const width = Number(args.width),
      depth = Number(args.depth),
      height = Number(args.height)
    if (![width, depth, height].every((value) => Number.isFinite(value) && value > 0))
      throw new Error('모델의 폭과 깊이 및 높이가 필요합니다. 실제 크기를 자연스럽게 질문하세요.')
    if (kind === 'rack' || kind === 'shelf')
      asset = designRack(id, name, kind, {
        width,
        depth,
        height,
        bays: Number(args.bays) || 1,
        levels: Number(args.levels) || 3,
        frame: Math.max(1, Math.min(40, Math.floor(Math.min(width, depth, height / 3) / 5))),
        color: '#8296ad',
      })
    else
      asset = {
        id,
        name,
        kind,
        parts: [
          {
            id: 'body',
            name: '본체',
            shape: 'box',
            position: { x: 0, y: 0, z: height / 2 },
            size: { x: width, y: depth, z: height },
            rotation: 0,
            color: '#8296ad',
          },
        ],
      }
  }
  mutate(() =>
    facility.setAsset(asset, {
      name: editor.sourceName,
      geometryKey: mapGeometryKey(editor.document.nodes),
    }),
  )
  return { assetId: id, name, kind, parts: asset.parts.length }
}
