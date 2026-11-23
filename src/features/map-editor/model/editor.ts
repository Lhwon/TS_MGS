/**
 * 파일명: editor.ts
 * 설명: 지도 문서와 선택 및 원본 저장 상태와 편집 이력 관리
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { computed, reactive, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import {
  demoDocument,
  calculateCurve,
  appendCurve,
  emptyDocument,
  MAX_NODES,
  mgsAreaSelection,
  mgsTheme,
  parseDocument,
  previewLegacy,
  serializeLegacySnapshot,
  remapLegacySource,
  parseAreaFiles,
  expandCurveSelection,
  repairPortGroups,
  createMapEdge,
  createMapNode,
  createMapPort,
  createMapShape,
  editMapObjects,
  editSelectedNodes,
  patchMapNode,
  removeMapNode,
} from '@/entities/map/index.ts'
import type {
  LegacySource,
  CurveOptions,
  MapDocument,
  MapLayout,
  MapNode,
  MapPort,
  PortDisplayType,
  MapEdge,
} from '@/entities/map/index.ts'
import { renumberMap, subdividePaths } from '@/features/map-editor/model/operations.ts'
import { inspectPortApproach, setPortApproachReverse } from '@/features/map-editor/model/portApproach.ts'
export type Tool = 'select' | 'add' | 'connect'

/**
 * 지도 문서와 선택 및 편집 이력을 제공하는 지도 편집 저장소 생성
 * @returns 지도 문서와 선택 및 편집 명령을 제공하는 상태 저장소
 */
export const useEditor = defineStore('editor', () => {
  const document = shallowRef<MapDocument>(emptyDocument())
  const selectedId = ref<number | null>(null)
  const selectedIds = ref<number[]>([])
  const selectedNodeIds = computed(() => [
    ...new Set([...selectedIds.value, ...(selectedId.value === null ? [] : [selectedId.value])]),
  ])
  const tool = ref<Tool>('select')
  const renderPaused = ref(false)
  const curveOptions = reactive<CurveOptions>({
    force: false,
    autoSelect: false,
    reverse: false,
    dynamicRadius: false,
    radius: 1000,
    angle: 90,
    divide: 15,
    direction: 0,
  })
  const curveSettingsOpen = ref(false)
  const drawingOptions = reactive({
    rightAngle: false,
    xMagnet: false,
    yMagnet: false,
    checkOverlap: false,
    autoPrevious: true,
    autoConnectDelete: false,
    autoReverseOrthogonal: false,
  })
  /** 원본 직각과 축 자석 옵션을 노드 입력에 적용하는 좌표 보정 */
  const snapPoint = (x: number, y: number, connection: number | null) => {
    const origin = document.value.nodes.find((node) => node.id === connection)
    if (drawingOptions.rightAngle && origin) {
      if (Math.abs(x - origin.x) > Math.abs(y - origin.y)) y = origin.y
      else x = origin.x
    }
    if (drawingOptions.xMagnet) {
      const nearest = document.value.nodes.reduce<{ value: number; distance: number } | undefined>(
        (best, node) => {
          const distance = Math.abs(node.x - x)
          return distance < 500 && (!best || distance < best.distance)
            ? { value: node.x, distance }
            : best
        },
        undefined,
      )
      if (nearest) x = nearest.value
    }
    if (drawingOptions.yMagnet) {
      const nearest = document.value.nodes.reduce<{ value: number; distance: number } | undefined>(
        (best, node) => {
          const distance = Math.abs(node.y - y)
          return distance < 500 && (!best || distance < best.distance)
            ? { value: node.y, distance }
            : best
        },
        undefined,
      )
      if (nearest) y = nearest.value
    }
    return { x, y }
  }
  const readOnly = ref(false)
  const portMode = ref(false)
  const portDisplayType = ref<PortDisplayType>('')
  const viewTurns = ref(0)
  const showCrosshair = ref(true)
  const vehiclePreviewMode = ref(false)
  const pathPlanOpen = ref(false)
  const pathPlanTargets = ref<number[]>([])
  const pathPlanPreview = ref<number[]>([])
  const selectedPortId = ref<string | null>(null)
  const shapeTool = ref<number | null>(null)
  const nodeEditorOpen = ref(false)
  const objectEditor = ref<'ports' | 'edges' | 'shapes' | 'portGroups' | null>(null)
  const objectEditorTarget = ref<{ id?: string; nodeId?: number; add?: boolean }>()
  const legacySource = shallowRef<LegacySource | null>(null)

  /**
   * 저장소 사용이 가능한 실행 환경에서 이전 밝기 설정을 복원하는 초기 테마 조회
   * @returns 저장한 밝기 모드 또는 기본 라이트 모드
   */
  const readColorMode = (): 'light' | 'dark' => {
    try {
      return typeof window !== 'undefined' &&
        window.localStorage.getItem('mgs-color-mode') === 'dark'
        ? 'dark'
        : 'light'
    } catch {
      return 'light'
    }
  }

  const colorMode = ref<'light' | 'dark'>(readColorMode())
  const themeSource = shallowRef('')
  const theme = computed(() => mgsTheme(themeSource.value, colorMode.value))
  const mapRevision = ref(0)

  /**
   * 화면과 지도에 공통 적용할 밝기 모드를 전환하는 테마 변경
   */
  const toggleColorMode = () => {
    colorMode.value = colorMode.value === 'light' ? 'dark' : 'light'
    try {
      window.localStorage.setItem('mgs-color-mode', colorMode.value)
    } catch {
      // 저장소 사용이 제한된 환경에서 메모리의 테마 상태를 유지하는 대체 처리
    }
  }

  const sourceName = ref('Untitled.jmapx')
  const projectToken = ref<string | undefined>()
  const generatedDraft = ref(false)
  const message = ref(
    'Map Open 또는 Project Select로 지도를 여세요. 새 노드는 지도 우클릭 Add로 추가합니다.',
  )

  const saved = shallowRef(document.value)
  let saveState = { saved: document.value }
  const past = shallowRef<MapDocument[]>([])
  const future = shallowRef<MapDocument[]>([])
  const contexts = new WeakMap<
    MapDocument,
    {
      name: string
      token: string | undefined
      legacy: LegacySource | null
      theme: string
      saveState: { saved: MapDocument }
      readOnly: boolean
      generated: boolean
    }
  >()
  /** 문서 교체를 되돌릴 때 원래 저장 위치와 원본 형식을 함께 복원하는 상태 기록 */
  const captureContext = () =>
    contexts.set(document.value, {
      name: sourceName.value,
      token: projectToken.value,
      legacy: legacySource.value,
      theme: themeSource.value,
      saveState,
      readOnly: readOnly.value,
      generated: generatedDraft.value,
    })
  /** 문서 이력에 대응하는 파일과 테마 및 저장 기준 복원 */
  const restoreContext = (previous: MapDocument) => {
    const context = contexts.get(document.value)
    if (!context) return
    if (sourceName.value !== context.name || previous.drawing?.id !== document.value.drawing?.id)
      mapRevision.value++
    sourceName.value = context.name
    projectToken.value = context.token
    legacySource.value = context.legacy
    themeSource.value = context.theme
    saveState = context.saveState
    saved.value = saveState.saved
    readOnly.value = context.readOnly
    generatedDraft.value = context.generated
  }
  const operationsOpen = ref(false)
  const operationTab = ref('nodes')
  const areaEditorOpen = ref(false)
  const teachingOpen = ref(false)
  const areaCategory = ref('bays')
  const bayFilter = ref<number[]>([])
  const availableBays = computed(() =>
    [
      ...new Set([
        ...document.value.edges.flatMap((edge) => edge.bays ?? []),
        ...document.value.ports.flatMap((port) => port.bays ?? []),
        ...(document.value.areas?.bays.map((_, index) => index + 1) ?? []),
      ]),
    ].sort((a, b) => a - b),
  )
  const visibleDocument = computed(() => {
    if (!bayFilter.value.length) return document.value
    const selected = new Set(bayFilter.value),
      edges = document.value.edges.filter((edge) => edge.bays?.some((bay) => selected.has(bay))),
      ids = new Set(edges.flatMap((edge) => [edge.from, edge.to]))
    return {
      ...document.value,
      nodes: document.value.nodes.filter((node) => ids.has(node.id)),
      edges,
      ports: document.value.ports.filter((port) => ids.has(port.nodeId)),
      portGroups: document.value.portGroups?.filter(
        (group) => group.nodeId !== undefined && ids.has(group.nodeId),
      ),
    }
  })
  const selectedNode = computed(() =>
    document.value.nodes.find((node) => node.id === selectedId.value),
  )

  const dirty = computed(() => document.value !== saved.value)
  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  /** 원본 JMAPX 헤더에 기록된 마지막 노드 UID 조회 */
  const getLegacyMaxNodeUid = () => Number(
    legacySource.value?.content.replace(/^\uFEFF/, '').split(/\r?\n/)[1]?.split('\t')[6] ?? 0,
  )

  /**
   * 레거시 파일에서 새 노드의 UID와 새 포트의 대기 노드 참조 보정
   *
   * @param editedDocument 편집 콜백이 변경한 검증 전 사본
   */
  const assignLegacyNodeUids = (editedDocument: MapDocument) => {
    if (!legacySource.value) return
    const lastLegacyUid = getLegacyMaxNodeUid() || 0
    const existingNodeIds = new Set(document.value.nodes.map((node) => node.id))
    const existingPortIds = new Set(document.value.ports.map((port) => port.id))
    const replacementUids = new Map<number, number>()
    let maximumUid = Math.max(lastLegacyUid, 0, ...editedDocument.nodes.map((node) => node.uid ?? node.id))
    for (const node of editedDocument.nodes) {
      const previousUid = node.uid
      const needsNewUid = previousUid === undefined || previousUid <= lastLegacyUid
      if (existingNodeIds.has(node.id) || !needsNewUid) continue
      node.uid = ++maximumUid
      if (previousUid !== undefined) replacementUids.set(previousUid, node.uid)
    }
    for (const port of editedDocument.ports) {
      if (existingPortIds.has(port.id) || !port.settings) continue
      for (let index = 0; index < 10; index++) {
        const setting = `standby_node_uid${index}`
        const replacementUid = replacementUids.get(Number(port.settings[setting]))
        if (replacementUid !== undefined) port.settings[setting] = replacementUid
      }
    }
  }

  /** 현재 문서와 저장 기준을 실행 취소 이력에 기록하고 다시 실행 이력 초기화 */
  const recordUndoSnapshot = () => {
    captureContext()
    past.value = [...past.value.slice(-49), document.value]
    future.value = []
  }

  /**
   * 변경 작업을 복제 문서에 적용한 뒤 검증을 통과한 결과만 반영하는 편집 명령
   * 이전 문서를 제한된 실행 취소 이력에 보관하고 다시 실행 이력을 초기화하는 상태 갱신
   *
   * @param changeDocument 검증 전 복제 문서에 적용할 변경 함수
   * @param normalizeIds 전용 도구에서 연속 번호로 정리할지 지정하는 옵션
   */
  const applyDocumentChange = (changeDocument: (map: MapDocument) => void, normalizeIds = false) => {
    if (readOnly.value) {
      message.value = '기존 MGS 지도는 읽기 전용 미리보기입니다.'
      return
    }
    const editedDocument = structuredClone(document.value)
    changeDocument(editedDocument)
    assignLegacyNodeUids(editedDocument)
    let validatedDocument = parseDocument(JSON.stringify(editedDocument))
    let updatedLegacySource = legacySource.value
    let references: { before: number; after: number }[] | undefined
    const legacySnapshot =
      !generatedDraft.value &&
      validatedDocument.units === 'mm' &&
      (legacySource.value !== null || sourceName.value.endsWith('.jmapx'))
    if (legacySnapshot || normalizeIds) {
      const sortedNodeIds = validatedDocument.nodes.map((node) => node.id).sort((a, b) => a - b)
      if (sortedNodeIds.some((id, index) => id !== index + 1)) {
        const reordered = renumberMap(validatedDocument)
        validatedDocument = reordered.map
        references = reordered.references
        if (updatedLegacySource)
          updatedLegacySource = remapLegacySource(updatedLegacySource, reordered.references)
      }
    }
    if (legacySnapshot)
      validatedDocument = serializeLegacySnapshot(validatedDocument, updatedLegacySource, {
        autoReverseOrthogonal: drawingOptions.autoReverseOrthogonal,
      }).map
    recordUndoSnapshot()
    document.value = validatedDocument
    legacySource.value = updatedLegacySource
    if (references) {
      const replacementIds = new Map(references.map(({ before, after }) => [before, after]))
      selectedIds.value = selectedIds.value.flatMap((id) => {
        const replacementId = replacementIds.get(id)
        return replacementId === undefined ? [] : [replacementId]
      })
      if (selectedId.value !== null) selectedId.value = replacementIds.get(selectedId.value) ?? null
    }
    selectedIds.value = selectedIds.value.filter((id) =>
      validatedDocument.nodes.some((node) => node.id === id),
    )
  }
  /** 노드 번호의 빈 구간을 연결 경로와 포트 참조 및 실행 취소 이력과 함께 정리 */
  const renumberNodeIds = () => applyDocumentChange(() => {}, true)

  /**
   * 사전 계산한 지도 변경을 현재 문서와 동일한 검증 및 실행 취소 이력에 반영
   * @param updatedMap 기존 지도에서 계산한 변경 결과
   */
  const applyComputedMap = (updatedMap: MapDocument) =>
    applyDocumentChange((map) => Object.assign(map, updatedMap))

  /**
   * 구조화된 지도 객체 명령 전체의 검증과 단일 이력 반영
   * @param operations 순서대로 실행할 객체 편집 요청
   * @param maximum 작업별 허용 명령 수
   * @returns 성공한 명령의 대상과 식별자 목록
   */
  const applyMapEdits = (operations: unknown, maximum?: number) => {
    const { map, results } = editMapObjects(document.value, operations, maximum, getLegacyMaxNodeUid() || 0)
    applyComputedMap(map)
    return results
  }

  /**
   * 선택 노드의 연결 구조를 보존하는 일괄 복제 및 연쇄 삭제와 이력 반영
   * @param ids 사용자가 지정한 노드 식별자
   * @param operation 복제 또는 삭제와 배치 위치 입력
   * @returns 수행된 객체 명령과 변경 전 선택 및 적용 이동량
   */
  const applyNodeSelectionEdit = (ids: number[], operation: Record<string, unknown>) => {
    const { map, ...result } = editSelectedNodes(document.value, ids, operation, getLegacyMaxNodeUid() || 0)
    applyComputedMap(map)
    return result
  }

  /**
   * 지정한 물리 간격으로 직선을 분할하고 결과를 한 편집 단위로 반영
   * @param spacing 밀리미터 단위의 노드 간격
   * @param ids 구간을 제한할 노드 식별자 또는 전체 범위를 나타내는 생략값
   * @returns 분할된 지도와 추가 노드 및 경로 통계
   */
  const applyPathSpacing = (spacing: number, ids?: number[]) => {
    const result = subdividePaths(document.value, spacing, ids)
    applyComputedMap(result.map)
    return result
  }

  /**
   * 포트에 도달하는 해당 방향의 후진 제어만 변경하고 실제 반영 결과 확인
   * @param portId 진입 기준 포트 식별자
   * @param edgeId 변경할 진입 경로 식별자
   * @param reverse 후진 적용 여부
   * @returns 변경 여부와 변경 전후의 진입 경로 정보
   */
  const applyPortApproachReverse = (portId: string, edgeId: string, reverse: boolean) => {
    const before = inspectPortApproach(document.value, portId).approaches.find(
      (row) => row.edgeId === edgeId,
    )
    if (!before) throw new Error('선택한 경로는 이 포트로 진입할 수 없습니다.')
    if (before.reverse === reverse) return { changed: false, before, after: before }
    applyDocumentChange((map) => {
      setPortApproachReverse(map, portId, edgeId, reverse)
    })
    const after = inspectPortApproach(document.value, portId).approaches.find(
      (row) => row.edgeId === edgeId,
    )
    if (after?.reverse !== reverse) throw new Error('포트 진입 변경 결과를 확인할 수 없습니다.')
    return { changed: true, before, after }
  }

  /**
   * 기존 지도 객체를 유지하며 배경 도면을 교체하거나 제거
   * @param layout 적용할 배경 도면 또는 삭제를 나타내는 생략값
   */
  const setLayout = (layout?: MapLayout) =>
    applyDocumentChange((map) => {
      if (layout) map.layout = layout
      else delete map.layout
    })

  /**
   * 배경 도면의 표시 설정을 현재 지도 편집 이력에 반영
   * @param visible 적용할 표시 설정
   */
  const setLayoutVisible = (visible: boolean) =>
    applyDocumentChange((map) => {
      if (map.layout) map.layout.visible = visible
    })

  /** 포트와 도형 편집을 종료하고 지도에서 출발 및 도착 노드를 선택하는 경로 시험 시작 */
  const openPathPlan = () => {
    if (pathPlanOpen.value) return
    clearSelection()
    portMode.value = false
    shapeTool.value = null
    vehiclePreviewMode.value = false
    pathPlanTargets.value = []
    pathPlanPreview.value = []
    pathPlanOpen.value = true
  }

  /**
   * 문서 교체와 함께 저장 기준 및 선택과 이력을 초기화하는 편집 상태 교체
   *
   * @param map 기준 노드와 경로 및 포트를 포함하는 지도 문서
   * @param name 파일 또는 모델을 구분하는 표시 이름
   */
  const replace = (map: MapDocument, name: string) => {
    document.value = map
    saved.value = map
    saveState = { saved: map }
    sourceName.value = name
    bayFilter.value = []
    renderPaused.value = false
    operationsOpen.value = areaEditorOpen.value = teachingOpen.value = false
    projectToken.value = undefined
    readOnly.value = false
    legacySource.value = null
    generatedDraft.value = false
    selectedId.value = null
    selectedIds.value = []
    objectEditor.value = null
    nodeEditorOpen.value = false
    portMode.value = false
    vehiclePreviewMode.value = false
    pathPlanOpen.value = false
    pathPlanTargets.value = []
    pathPlanPreview.value = []
    selectedPortId.value = null
    shapeTool.value = null
    past.value = []
    future.value = []
    tool.value = 'select'
    themeSource.value = ''
    mapRevision.value += 1
  }
  /**
   * 생성한 지도 전체를 하나의 실행 취소 대상으로 적용하는 에이전트 문서 반영
   * @param input 검증할 생성 지도
   */
  const importGeneratedMap = (input: MapDocument) => {
    const next = parseDocument(JSON.stringify(input))
    recordUndoSnapshot()
    document.value = next
    bayFilter.value = []
    renderPaused.value = false
    operationsOpen.value = areaEditorOpen.value = teachingOpen.value = false
    saveState = { saved: saved.value }
    mapRevision.value++
    sourceName.value = `${next.name}.jmapx`
    generatedDraft.value = true
    legacySource.value = null
    themeSource.value = ''
    readOnly.value = false
    selectedId.value = null
    selectedIds.value = []
    selectedPortId.value = null
    objectEditor.value = null
    nodeEditorOpen.value = false
    portMode.value = false
    vehiclePreviewMode.value = false
    pathPlanOpen.value = false
    pathPlanTargets.value = []
    pathPlanPreview.value = []
    shapeTool.value = null
    tool.value = 'select'
    captureContext()
    message.value = '생성 지도 반영 완료 · 저장 필요'
  }
  /**
   * 기존 지도 여부에 따라 원본 파서 또는 전용 파서를 선택하는 지도 불러오기
   * 인접 테마와 원본 제어 레코드를 유지하는 호환 상태 구성
   *
   * @param content 파일에서 읽은 원본 문자열
   * @param name 파일 또는 모델을 구분하는 표시 이름
   * @param themeContent 지도와 함께 읽은 원본 테마 설정 문자열
   * @param groupContent 지도와 함께 읽은 포트 그룹 레코드
   */
  const load = (
    content: string,
    name: string,
    themeContent = '',
    groupContent = '',
    areaFiles: Record<string, string> = {},
  ) => {
    const legacy = name.toLowerCase().endsWith('.jmapx')
    const map = legacy ? previewLegacy(content, name, groupContent) : parseDocument(content)
    if (Object.keys(areaFiles).length) map.areas = parseAreaFiles(areaFiles)
    replace(map, name)
    if (legacy) legacySource.value = { content, groups: groupContent, baseline: map }
    themeSource.value = themeContent
    message.value = legacy
      ? `MGS Ver.${map.legacy?.version}: 원본 노드 ${map.legacy?.nodeRecords.toLocaleString()}개 레코드 → 고유 노드 ${map.nodes.length.toLocaleString()}개 · 연결 ${map.edges.length.toLocaleString()}개 · 포트 ${map.ports.length.toLocaleString()}개. 편집 가능한 원본 형식으로 열었습니다.`
      : `${name} 파일을 열었습니다.`
  }
  /**
   * 사용자 요청에 따라 빈 지도 또는 내장 샘플 지도를 준비하는 새 문서 생성
   *
   * @param sample 빈 문서 대신 내장 샘플 지도의 사용 여부
   */
  const newMap = (sample = false) => {
    replace(
      sample ? demoDocument() : emptyDocument(),
      sample ? 'BEM_DEMO.tsmgs.json' : 'Untitled.jmapx',
    )
    message.value = sample
      ? '샘플 지도를 열었습니다.'
      : '빈 지도 생성. 노드 추가 도구로 시작하세요.'
  }
  /**
   * 지도에서 드래그한 두 점으로 원본 도형을 추가하는 도형 작성
   * @param start 도형 시작 좌표
   * @param end 도형 끝 좌표
   */
  const addShape = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    const type = shapeTool.value
    if (type === null) return
    const x1 = Math.round(start.x),
      y1 = Math.round(start.y)
    const x2 = Math.round(end.x),
      y2 = Math.round(end.y)
    const width = Math.abs(x2 - x1),
      height = Math.abs(y2 - y1)
    if (!width && !height) return
    const shape = createMapShape(document.value, {
      text: type === 6 ? 'Text' : '',
      type,
      x1,
      y1,
      x2,
      y2,
      centerX: Math.round((x1 + x2) / 2),
      centerY: Math.round((y1 + y2) / 2),
      radius: Math.round(width / 2),
      width,
      height: type === 6 ? 12 : height,
      strokeWidth: 1,
      fillColor: 16777215,
      fillStyle: 9,
    })
    applyDocumentChange((map) => {
      map.shapes ??= []
      map.shapes.push(shape)
    })
    message.value = `도형 ${shape.id} 추가 완료`
  }
  /**
   * 선택 노드의 속성을 변경하고 연결 포트의 상대 위치를 유지하는 노드 편집
   *
   * @param id 조회하거나 편집할 대상의 고유 식별자
   * @param patch 식별자를 유지하면서 교체할 대상 속성
   */
  const updateNode = (id: number, patch: Partial<Pick<MapNode, 'x' | 'y' | 'name'>>) => {
    applyDocumentChange((map) => {
      const node = map.nodes.find((item) => item.id === id)
      if (node) patchMapNode(map, node, patch)
    })
  }
  /**
   * 여러 노드를 연결 포트와 함께 이동하는 단일 실행 취소 단위의 편집
   * @param ids 이동할 노드 식별자 목록
   * @param dx 밀리미터 단위 가로 이동량
   * @param dy 밀리미터 단위 세로 이동량
   */
  const moveNodes = (ids: number[], dx: number, dy: number) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('이동량이 올바르지 않습니다.')
    applyDocumentChange((map) => {
      for (const id of expandCurveSelection(map, ids)) {
        const node = map.nodes.find((item) => item.id === id)
        if (!node) throw new Error(`노드를 찾을 수 없습니다: ${id}`)
        patchMapNode(map, node, { x: node.x + dx, y: node.y + dy })
      }
    })
  }
  /**
   * 직선 경로를 같은 주행 속성의 여러 구간으로 나누는 노드 삽입
   * @param edgeId 분할할 직선 경로 식별자
   * @param startId 반복 간격을 측정할 기준 노드 식별자
   * @param offsets 기준 노드에서 각 삽입 위치까지의 거리
   */
  const insertPathNodes = (edgeId: string, startId: number, offsets: number[]) => {
    if (readOnly.value) return
    const edge = document.value.edges.find((item) => item.id === edgeId)
    const from = document.value.nodes.find((node) => node.id === edge?.from)
    const to = document.value.nodes.find((node) => node.id === edge?.to)
    if (!edge || !from || !to || from.curve || to.curve || [2, 3].includes(edge.drivingType ?? 1))
      throw new Error('일반 노드 사이의 직선 경로를 선택하세요.')
    if (startId !== from.id && startId !== to.id)
      throw new Error('삽입 기준 노드는 경로 양 끝 중 하나여야 합니다.')
    if (!offsets.length || document.value.nodes.length + offsets.length > MAX_NODES)
      throw new Error('삽입할 노드 수를 확인하세요.')
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    const distances = offsets
      .map((offset) => (startId === from.id ? offset : length - offset))
      .sort((a, b) => a - b)
    const ordered = [0, ...distances, length]
    if (
      ordered.some(
        (distance, index) =>
          !Number.isFinite(distance) || (index > 0 && distance <= ordered[index - 1]!),
      )
    )
      throw new Error('삽입 위치는 경로 양 끝 사이여야 합니다.')
    const occupied = new Set(document.value.nodes.map((node) => `${node.x},${node.y}`))
    const directionEdges = document.value.edges.filter(
      (item) =>
        item.id === edgeId ||
        (item.from === to.id && item.to === from.id && ![2, 3].includes(item.drivingType ?? 1)),
    )
    let selection: number | null = null
    applyDocumentChange((map) => {
      let id = Math.max(0, ...map.nodes.map((node) => node.id))
      let uid = Math.max(0, ...map.nodes.map((node) => node.uid ?? node.id))
      let realId = Math.max(
        0,
        ...map.nodes
          .filter((node) => !node.virtual && !node.curve)
          .map((node) => node.realId ?? node.id),
      )
      const inserts = distances.map((distance) => {
        const ratio = distance / length
        const x = Math.round(from.x + (to.x - from.x) * ratio)
        const y = Math.round(from.y + (to.y - from.y) * ratio)
        const key = `${x},${y}`
        if (occupied.has(key)) throw new Error('삽입 위치에 기존 노드가 있습니다.')
        occupied.add(key)
        id++
        return {
          id,
          uid: ++uid,
          realId: ++realId,
          name: `N${id}`,
          x,
          y,
          direction: edge.direction ?? 0,
        }
      })
      map.nodes.push(...inserts)
      selection = (startId === from.id ? inserts[0] : inserts.at(-1))!.id
      const points = [from, ...inserts, to]
      map.edges = map.edges.flatMap((item) => {
        if (!directionEdges.some((route) => route.id === item.id)) return [item]
        const chain = item.from === from.id ? points : [...points].reverse()
        return chain.slice(1).map((end, index) => {
          const start = chain[index]!
          return {
            ...structuredClone(item),
            id: `E${start.id}-${end.id}`,
            from: start.id,
            to: end.id,
            realConnection: end.id,
            distance: Math.trunc(Math.hypot(end.x - start.x, end.y - start.y)),
          }
        })
      })
    })
    selectedId.value = selection
    message.value = `노드 ${offsets.length}개 삽입 완료`
  }
  /**
   * 우클릭에서 생성할 경로의 끝점을 기준으로 기존 노드를 맞춘 뒤 경로를 연결하는 편집
   * @param current 작업 시작점으로 선택한 노드
   * @param target 우클릭한 대상 노드
   * @param point 마그넷 적용 전 우클릭 좌표
   * @param moveCurrent 현재 노드를 이동하는 옵션
   */
  const fitAndConnect = (
    current: number,
    target: number,
    point: { x: number; y: number },
    moveCurrent: boolean,
  ) => {
    if (readOnly.value) return
    const start = document.value.nodes.find((node) => node.id === current)
    const end = document.value.nodes.find((node) => node.id === target)
    if (
      !start ||
      !end ||
      start.id === end.id ||
      start.curve ||
      end.curve ||
      start.virtual ||
      end.virtual
    )
      throw new Error('서로 다른 일반 노드 두 개를 선택하세요.')
    if (
      document.value.edges.some(
        (edge) =>
          (edge.from === target && edge.to === current) ||
          (edge.from === current && edge.to === target && edge.direction === 1),
      )
    )
      throw new Error('이미 연결된 경로입니다.')
    const candidate = snapPoint(point.x, point.y, current)
    const moving = moveCurrent ? start : end
    const dx = Math.trunc(moveCurrent ? end.x - candidate.x : candidate.x - end.x)
    const dy = Math.trunc(moveCurrent ? end.y - candidate.y : candidate.y - end.y)
    const next = { x: moving.x + dx, y: moving.y + dy }
    if (
      document.value.nodes.some(
        (node) => node.id !== moving.id && node.x === next.x && node.y === next.y,
      )
    )
      throw new Error('이동할 좌표에 기존 노드가 있습니다.')
    applyDocumentChange((map) => {
      for (const id of expandCurveSelection(map, [moving.id])) {
        const node = map.nodes.find((item) => item.id === id)!
        patchMapNode(map, node, { x: node.x + dx, y: node.y + dy })
      }
      const endpoint = map.nodes.find((node) => node.id === target)!
      const curve = calculateCurve(map, current, endpoint, curveOptions)
      if (curve) {
        const maxUid = getLegacyMaxNodeUid()
        appendCurve(map, current, curve, curveOptions.direction, maxUid, target)
      } else {
        map.edges.push({
          id: `E${target}-${current}`,
          from: target,
          to: current,
          direction: 0,
          drivingType: 1,
        })
      }
    })
    selectedId.value = target
    message.value = `N${target} → N${current} 정렬 및 연결 완료`
  }
  /**
   * 기준 노드와 원본 표시 기본값을 사용하는 포트 생성
   * @param nodeId 연결할 노드 식별자
   * @param x 포트 중심 가로 좌표
   * @param y 포트 중심 세로 좌표
   * @param fromInspector 속성 창의 포트 선택과 입력 좌표 보존 여부
   * @returns 새 포트 식별자
   */
  const addPort = (nodeId: number, x: number, y: number, fromInspector = false) => {
    let suffix = document.value.ports.length + 1
    while (document.value.ports.some((port) => port.id === `P${suffix}`)) suffix++
    const port = createMapPort(`P${suffix}`, {
      nodeId,
      x: fromInspector ? x : Math.round(x),
      y: fromInspector ? y : Math.round(y),
      width: 1000,
      height: 1000,
      floor: 1,
      strokeColor: 16711935,
      fillColor: 16777215,
      fontColor: 0,
      fontSize: 40,
      nameDistance: 100,
      namePosition: 0,
      nameDirection: 0,
    })
    applyDocumentChange((map) => map.ports.push(port))
    if (!fromInspector) selectedPortId.value = port.id
    return port.id
  }
  /**
   * 포트와 그룹 소속 참조를 함께 제거하는 포트 삭제
   * @param id 삭제할 포트 식별자
   */
  const removePort = (id: string) => {
    applyDocumentChange((map) => {
      map.ports = map.ports.filter((port) => port.id !== id)
      for (const group of map.portGroups ?? [])
        group.portIds = group.portIds.filter((portId) => portId !== id)
    })
    selectedPortId.value = null
  }
  /**
   * 포트 표시 순서를 원본 앞뒤 정렬 명령에 맞게 변경하는 포트 정렬
   * @param id 정렬할 포트 식별자
   * @param action 맨 앞과 맨 뒤 또는 한 단계 이동 명령
   */
  const orderPort = (id: string, action: 'front' | 'back' | 'forward' | 'backward') => {
    applyDocumentChange((map) => {
      const index = map.ports.findIndex((port) => port.id === id)
      if (index < 0) return
      const [port] = map.ports.splice(index, 1)
      const target =
        action === 'front'
          ? map.ports.length
          : action === 'back'
            ? 0
            : Math.max(0, Math.min(map.ports.length, index + (action === 'forward' ? 1 : -1)))
      map.ports.splice(target, 0, port)
    })
  }
  /**
   * 원본 포트의 배치와 크기 및 표시 속성을 이력과 함께 변경하는 포트 편집
   * @param id 편집할 포트 식별자
   * @param patch 교체할 포트 속성
   */
  const updatePort = (id: string, patch: Partial<Omit<MapPort, 'id'>>) => {
    applyDocumentChange((map) => {
      const port = map.ports.find((item) => item.id === id)
      if (!port) throw new Error('편집할 포트가 없습니다.')
      Object.assign(port, patch)
    })
  }
  /**
   * 연결 경로의 방향과 거리 및 속도를 이력과 함께 변경하는 경로 편집
   * @param id 편집할 경로 식별자
   * @param patch 교체할 주행 속성
   */
  const updateEdge = (
    id: string,
    patch: Partial<Pick<MapEdge, 'direction' | 'speed' | 'distance'>>,
  ) => {
    applyDocumentChange((map) => {
      const edge = map.edges.find((item) => item.id === id)
      if (!edge) throw new Error('편집할 경로가 없습니다.')
      Object.assign(edge, patch)
    })
  }
  /**
   * 대상 경로의 통행 방향을 변경하고 모든 노드의 양방향 상태를 연관 경로에서 재계산
   * @param edgeIds 영역 또는 노드 선택에서 확정된 대상 경로
   * @param direction 단방향 또는 양방향 설정
   */
  const setPathDirections = (edgeIds: ReadonlySet<string>, direction: number) =>
    applyDocumentChange((map) => {
      for (const edge of map.edges)
        if (edgeIds.has(edge.id)) edge.direction = direction
      const twoWayNodeIds = new Set<number>()
      for (const edge of map.edges)
        if (edge.direction === 1) {
          twoWayNodeIds.add(edge.from)
          twoWayNodeIds.add(edge.to)
        }
      for (const node of map.nodes) node.direction = twoWayNodeIds.has(node.id) ? 1 : 0
    })

  /**
   * 사용하지 않는 식별자로 노드를 추가하고 선택적인 연결을 생성하는 지도 확장
   *
   * @param x 지도 또는 모델 기준 가로 좌표
   * @param y 지도 또는 모델 기준 세로 좌표
   * @param connection 새 노드와 연결할 기준 노드 식별자 또는 연결 생략 값
   */
  const addNode = (x: number, y: number, connection: number | null = null) => {
    if (readOnly.value) return
    const snapped = snapPoint(x, y, connection)
    x = snapped.x
    y = snapped.y
    if (
      drawingOptions.checkOverlap &&
      document.value.nodes.some((node) => node.x === x && node.y === y)
    )
      throw new Error('같은 좌표에 노드가 있습니다. 기존 노드 연결을 사용하세요.')
    const curve = calculateCurve(document.value, connection, { x, y }, curveOptions)
    if (curve && connection !== null) {
      let endpoint = connection
      const sourceMaxUid = getLegacyMaxNodeUid()
      applyDocumentChange((map) => {
        endpoint = appendCurve(map, connection, curve, curveOptions.direction, sourceMaxUid)
      })
      selectedId.value = endpoint
      message.value = `커브 생성 완료 · 반경 ${curve.radius}mm · 각도 ${curve.angle}° · 가상 노드 ${curve.points.length - 2}개`
      return
    }
    if (document.value.nodes.length >= MAX_NODES) throw new Error('최대 노드 수는 15,000개입니다.')
    const node = createMapNode(
      document.value, { x, y, direction: 0 }, undefined, getLegacyMaxNodeUid(),
    )
    const { id } = node
    applyDocumentChange((map) => {
      map.nodes.push(node)
      if (connection !== null)
        map.edges.push(createMapEdge(`E${id}-${connection}`, { from: id, to: connection, direction: 0 }))
    })
    if (!readOnly.value && drawingOptions.autoPrevious) selectedId.value = id
  }
  /**
   * 자기 자신과의 연결 및 기존 연결의 중복을 방지하는 방향 경로 추가
   *
   * @param from 연결 출발 노드 또는 의존성 검사 출발 경로
   * @param to 연결 도착 노드 또는 의존성 검사 대상 경로
   */
  const connect = (from: number, to: number) => {
    if (readOnly.value || from === to) return
    if (document.value.edges.some((edge) => edge.from === from && edge.to === to)) {
      message.value = 'This Node is already connected'
      return
    }
    const endpoint = document.value.nodes.find((node) => node.id === from)
    const curve = endpoint ? calculateCurve(document.value, to, endpoint, curveOptions) : null
    if (curve) {
      const sourceMaxUid = getLegacyMaxNodeUid()
      applyDocumentChange((map) => {
        appendCurve(map, to, curve, curveOptions.direction, sourceMaxUid, from)
      })
      selectedId.value = from
      message.value = `커브 연결 완료 · N${to} → N${from}`
      return
    }
    applyDocumentChange((map) =>
      map.edges.push(createMapEdge(`E${from}-${to}`, { from, to, direction: 0 })),
    )
    selectedId.value = null
  }
  /**
   * 현재 선택 노드와 클릭 노드를 연결하고 다음 연결 대상을 갱신하는 연결 도구 처리
   *
   * @param id 조회하거나 편집할 대상의 고유 식별자
   */
  const connectNode = (id: number) => {
    if (readOnly.value) return
    const from = selectedId.value
    if (from !== null && from !== id && (curveOptions.force || curveOptions.autoSelect)) {
      connect(id, from)
      selectedId.value = id
      return
    }
    if (from !== null && from !== id) {
      if (!document.value.edges.some((edge) => edge.from === from && edge.to === id)) {
        applyDocumentChange((map) => {
          map.edges.push(createMapEdge(`E${from}-${id}`, {
            from, to: id, direction: undefined, drivingType: undefined,
          }))
        })
        message.value = `경로 연결: N${from} → N${id}`
      }
    }
    selectedId.value = id
  }
  /**
   * 선택 노드와 해당 노드를 참조하는 경로 및 포트를 함께 제거하는 연쇄 삭제
   */
  const removeSelected = () => {
    if (selectedId.value === null || readOnly.value) return
    const id = selectedId.value
    applyDocumentChange((map) => {
      const targetNode = map.nodes.find((node) => node.id === id)
      if (!targetNode) return
      removeMapNode(map, targetNode, () => {
        if (!drawingOptions.autoConnectDelete) return
        const incident = map.edges.filter((edge) => edge.from === id || edge.to === id),
          neighbors = [
            ...new Set(
              incident.flatMap((edge) => [edge.from, edge.to]).filter((value) => value !== id),
            ),
          ]
        if (neighbors.length === 2 && incident.every((edge) => (edge.drivingType ?? 1) === 1)) {
          const arcs = incident.flatMap((edge) =>
            (edge.direction ?? 1) === 1
              ? [
                  [edge.from, edge.to],
                  [edge.to, edge.from],
                ]
              : [[edge.from, edge.to]],
          )
          const [a, b] = neighbors,
            forward =
              arcs.some(([from, to]) => from === a && to === id) &&
              arcs.some(([from, to]) => from === id && to === b),
            backward =
              arcs.some(([from, to]) => from === b && to === id) &&
              arcs.some(([from, to]) => from === id && to === a)
          if (forward || backward) {
            const from = map.nodes.find((node) => node.id === (forward ? a : b))!,
              to = map.nodes.find((node) => node.id === (forward ? b : a))!
            if (!map.edges.some((edge) => edge.from === from.id && edge.to === to.id))
              map.edges.push({
                ...incident[0],
                id: `E-${crypto.randomUUID()}`,
                from: from.id,
                to: to.id,
                realConnection: to.id,
                direction: forward && backward ? 1 : 0,
                distance: Math.trunc(Math.hypot(to.x - from.x, to.y - from.y)),
              })
          }
        }
      })
      repairPortGroups(map)
    })
    selectedId.value = null
    message.value = `노드 ${id}와 연결 경로·포트를 삭제했습니다.`
  }
  /**
   * 드래그 영역 선택 결과를 저장소에 반영하는 선택 상태 갱신
   *
   * @param start 영역 선택 또는 눈금의 시작 위치
   * @param end 영역 선택 또는 눈금의 종료 위치
   * @param adding 화면에서 오른쪽으로 드래그한 선택 추가 여부
   */
  const selectArea = (
    start: {
      x: number
      y: number
    },
    end: {
      x: number
      y: number
    },
    adding = start.x < end.x,
  ) => {
    selectedIds.value = mgsAreaSelection(visibleDocument.value.nodes, selectedIds.value, start, end, adding)
    if (adding && selectedIds.value.length) selectedId.value = null
    message.value = `선택 노드: ${selectedIds.value.length}개`
  }
  /**
   * 단일 선택과 영역 선택을 함께 해제하는 선택 초기화
   */
  const clearSelection = () => {
    selectedId.value = null
    selectedIds.value = []
    tool.value = 'select'
    shapeTool.value = null
  }
  /**
   * 이전 문서를 복원하고 현재 문서를 다시 실행 목록으로 옮기는 실행 취소
   */
  const undo = () => {
    const previous = past.value.at(-1)
    if (!previous) return
    captureContext()
    const current = document.value
    future.value = [...future.value, document.value]
    document.value = previous
    past.value = past.value.slice(0, -1)
    restoreContext(current)
    if (!document.value.nodes.some((node) => node.id === selectedId.value)) selectedId.value = null
  }
  /**
   * 다시 실행 문서를 복원하고 현재 문서를 이전 이력으로 옮기는 다시 실행
   */
  const redo = () => {
    const next = future.value.at(-1)
    if (!next) return
    captureContext()
    const current = document.value
    past.value = [...past.value, document.value]
    document.value = next
    future.value = future.value.slice(0, -1)
    restoreContext(current)
    if (!next.nodes.some((node) => node.id === selectedId.value)) selectedId.value = null
  }
  /**
   * 저장 완료한 문서 스냅샷을 기준으로 변경 여부와 파일명을 갱신하는 저장 상태 반영
   *
   * @param snapshot 저장 작업을 시작한 시점의 문서 참조
   * @param name 파일 또는 모델을 구분하는 표시 이름
   */
  const markSaved = (snapshot: MapDocument, name: string) => {
    saved.value = snapshot
    saveState.saved = snapshot
    sourceName.value = name
    message.value = `${name} 저장 완료`
  }
  return {
    renderPaused,
    document,
    importGeneratedMap,
    curveOptions,
    curveSettingsOpen,
    commit: applyDocumentChange,
    applyComputedMap,
    renumberNodeIds,
    applyMapEdits,
    applyNodeSelectionEdit,
    applyPathSpacing,
    applyPortApproachReverse,
    setLayout,
    setLayoutVisible,
    shapeTool,
    portMode,
    portDisplayType,
    viewTurns,
    showCrosshair,
    vehiclePreviewMode,
    pathPlanOpen,
    openPathPlan,
    pathPlanTargets,
    pathPlanPreview,
    selectedPortId,
    addPort,
    removePort,
    orderPort,
    addShape,
    nodeEditorOpen,
    operationsOpen,
    operationTab,
    areaEditorOpen,
    teachingOpen,
    areaCategory,
    bayFilter,
    availableBays,
    visibleDocument,
    drawingOptions,
    snapPoint,
    objectEditor,
    objectEditorTarget,
    insertPathNodes,
    fitAndConnect,
    selectedId,
    selectedIds,
    selectedNodeIds,
    selectedNode,
    tool,
    sourceName,
    projectToken,
    readOnly,
    legacySource,
    updatePort,
    updateEdge,
    setPathDirections,
    theme,
    colorMode,
    toggleColorMode,
    mapRevision,
    message,
    dirty,
    canUndo,
    canRedo,
    load,
    newMap,
    updateNode,
    moveNodes,
    addNode,
    connectNode,
    connect,
    removeSelected,
    selectArea,
    clearSelection,
    undo,
    redo,
    markSaved,
  }
})
