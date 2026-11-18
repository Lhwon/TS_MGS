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
} from '@/entities/map/index.ts'
import type {
  LegacySource,
  CurveOptions,
  MapDocument,
  MapNode,
  MapPort,
  MapEdge,
  MapShape,
} from '@/entities/map/index.ts'
import { renumberMap } from '@/features/map-editor/model/operations.ts'
export type Tool = 'select' | 'add' | 'connect'

/**
 * 지도 문서와 선택 및 편집 이력을 제공하는 지도 편집 저장소 생성
 * @returns 지도 문서와 선택 및 편집 명령을 제공하는 상태 저장소
 */
export const useEditor = defineStore('editor', () => {
  const document = shallowRef<MapDocument>(emptyDocument())
  const selectedId = ref<number | null>(null)
  const selectedIds = ref<number[]>([])
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
  const selectedPortId = ref<string | null>(null)
  const shapeTool = ref<number | null>(null)
  const nodeEditorOpen = ref(false)
  const objectEditor = ref<'ports' | 'edges' | 'shapes' | 'portGroups' | null>(null)
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

  /**
   * 변경 작업을 복제 문서에 적용한 뒤 검증을 통과한 결과만 반영하는 편집 명령
   * 이전 문서를 제한된 실행 취소 이력에 보관하고 다시 실행 이력을 초기화하는 상태 갱신
   *
   * @param change 검증 전 복제 문서에 적용할 변경 함수
   */
  const commit = (change: (map: MapDocument) => void) => {
    if (readOnly.value) {
      message.value = '기존 MGS 지도는 읽기 전용 미리보기입니다.'
      return
    }
    const next = structuredClone(document.value)
    change(next)
    if (legacySource.value) {
      const header = legacySource.value.content
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)[1]
          ?.split('\t'),
        baseUid = Number(header?.[6]) || 0,
        existing = new Set(document.value.nodes.map((node) => node.id)),
        oldPorts = new Set(document.value.ports.map((port) => port.id)),
        uids = new Map<number, number>()
      let maximum = Math.max(baseUid, 0, ...next.nodes.map((node) => node.uid ?? node.id))
      for (const node of next.nodes)
        if (!existing.has(node.id) && (node.uid === undefined || node.uid <= baseUid)) {
          const previous = node.uid
          node.uid = ++maximum
          if (previous !== undefined) uids.set(previous, node.uid)
        }
      for (const port of next.ports)
        if (!oldPorts.has(port.id) && port.settings)
          for (let index = 0; index < 10; index++) {
            const key = `standby_node_uid${index}`,
              uid = Number(port.settings[key])
            if (uids.has(uid)) port.settings[key] = uids.get(uid)!
          }
    }
    let validated = parseDocument(JSON.stringify(next))
    let nextSource = legacySource.value
    let references: { before: number; after: number }[] | undefined
    if (legacySource.value || sourceName.value.endsWith('.jmapx')) {
      const sorted = validated.nodes.map((node) => node.id).sort((a, b) => a - b)
      if (sorted.some((id, index) => id !== index + 1)) {
        const reordered = renumberMap(validated)
        validated = reordered.map
        references = reordered.references
        if (nextSource) nextSource = remapLegacySource(nextSource, reordered.references)
      }
      validated = serializeLegacySnapshot(validated, nextSource, {
        autoReverseOrthogonal: drawingOptions.autoReverseOrthogonal,
      }).map
    }
    // 전체 지도 스냅샷을 제한된 개수로 보관하며 대형 지도 메모리 부담이 확인되면 변경 명령 단위 이력으로 전환할 수 있는 현재 저장 방식
    captureContext()
    past.value = [...past.value.slice(-49), document.value]
    future.value = []
    document.value = validated
    legacySource.value = nextSource
    if (references) {
      const refs = new Map(references.map((item) => [item.before, item.after]))
      selectedIds.value = selectedIds.value.flatMap((id) => (refs.has(id) ? [refs.get(id)!] : []))
      if (selectedId.value !== null) selectedId.value = refs.get(selectedId.value) ?? null
    }
    selectedIds.value = selectedIds.value.filter((id) =>
      validated.nodes.some((node) => node.id === id),
    )
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
    selectedId.value = null
    selectedIds.value = []
    objectEditor.value = null
    nodeEditorOpen.value = false
    portMode.value = false
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
    captureContext()
    past.value = [...past.value.slice(-49), document.value]
    future.value = []
    document.value = next
    bayFilter.value = []
    renderPaused.value = false
    operationsOpen.value = areaEditorOpen.value = teachingOpen.value = false
    saveState = { saved: saved.value }
    mapRevision.value++
    sourceName.value = `${next.name}.tsmgs.json`
    projectToken.value = undefined
    legacySource.value = null
    themeSource.value = ''
    readOnly.value = false
    selectedId.value = null
    selectedIds.value = []
    selectedPortId.value = null
    objectEditor.value = null
    nodeEditorOpen.value = false
    portMode.value = false
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
    const shape: MapShape = {
      id: Math.max(0, ...(document.value.shapes ?? []).map((item) => item.id)) + 1,
      description: '',
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
      strokeColor: 0,
      strokeStyle: 0,
      strokeWidth: 1,
      fillColor: 16777215,
      fontColor: 0,
      fontAlign: 0,
      fontDirection: 0,
      fillStyle: 9,
    }
    commit((map) => {
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
    commit((map) => {
      if (map.nodes.some((node) => node.id === id)) applyNodePatch(map, id, patch)
    })
  }
  /**
   * 연결 포트와 그룹의 상대 위치를 유지하는 복제 문서의 노드 속성 갱신
   * @param map 편집 중인 복제 지도 문서
   * @param id 대상 노드 식별자
   * @param patch 변경할 좌표와 이름
   */
  const applyNodePatch = (
    map: MapDocument,
    id: number,
    patch: Partial<Pick<MapNode, 'x' | 'y' | 'name'>>,
  ) => {
    const node = map.nodes.find((item) => item.id === id)
    if (!node) throw new Error(`노드를 찾을 수 없습니다: ${id}`)
    const oldX = node.x
    const oldY = node.y
    Object.assign(node, patch)
    for (const port of map.ports.filter((item) => item.nodeId === id)) {
      port.x += node.x - oldX
      port.y += node.y - oldY
    }
    for (const group of map.portGroups ?? []) {
      if (group.nodeId !== id) continue
      group.x += node.x - oldX
      group.y += node.y - oldY
      group.nodeX = node.x
      group.nodeY = node.y
    }
  }
  /**
   * 여러 노드를 연결 포트와 함께 이동하는 단일 실행 취소 단위의 편집
   * @param ids 이동할 노드 식별자 목록
   * @param dx 밀리미터 단위 가로 이동량
   * @param dy 밀리미터 단위 세로 이동량
   */
  const moveNodes = (ids: number[], dx: number, dy: number) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('이동량이 올바르지 않습니다.')
    commit((map) => {
      for (const id of expandCurveSelection(map, ids)) {
        const node = map.nodes.find((item) => item.id === id)
        if (!node) throw new Error(`노드를 찾을 수 없습니다: ${id}`)
        applyNodePatch(map, id, { x: node.x + dx, y: node.y + dy })
      }
    })
  }
  /**
   * 기준 노드와 원본 표시 기본값을 사용하는 포트 생성
   * @param nodeId 연결할 노드 식별자
   * @param x 포트 중심 가로 좌표
   * @param y 포트 중심 세로 좌표
   * @returns 새 포트 식별자
   */
  const addPort = (nodeId: number, x: number, y: number) => {
    let suffix = document.value.ports.length + 1
    while (document.value.ports.some((port) => port.id === `P${suffix}`)) suffix++
    const port: MapPort = {
      id: `P${suffix}`,
      nodeId,
      name: '',
      x: Math.round(x),
      y: Math.round(y),
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
    }
    commit((map) => map.ports.push(port))
    selectedPortId.value = port.id
    return port.id
  }
  /**
   * 포트와 그룹 소속 참조를 함께 제거하는 포트 삭제
   * @param id 삭제할 포트 식별자
   */
  const removePort = (id: string) => {
    commit((map) => {
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
    commit((map) => {
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
    commit((map) => {
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
    commit((map) => {
      const edge = map.edges.find((item) => item.id === id)
      if (!edge) throw new Error('편집할 경로가 없습니다.')
      Object.assign(edge, patch)
    })
  }
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
      const sourceMaxUid = Number(
        legacySource.value?.content
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)[1]
          ?.split('\t')[6] ?? 0,
      )
      commit((map) => {
        endpoint = appendCurve(map, connection, curve, curveOptions.direction, sourceMaxUid)
      })
      selectedId.value = endpoint
      message.value = `커브 생성 완료 · 반경 ${curve.radius}mm · 각도 ${curve.angle}° · 가상 노드 ${curve.points.length - 2}개`
      return
    }
    if (document.value.nodes.length >= MAX_NODES) throw new Error('최대 노드 수는 15,000개입니다.')
    const id = Math.max(0, ...document.value.nodes.map((node) => node.id)) + 1
    commit((map) => {
      const sourceMax = Number(
        legacySource.value?.content
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)[1]
          ?.split('\t')[6] ?? 0,
      )
      const uid = Math.max(sourceMax, 0, ...map.nodes.map((node) => node.uid ?? node.id)) + 1
      const realId =
        Math.max(
          0,
          ...map.nodes
            .filter((node) => !node.virtual && !node.curve)
            .map((node) => node.realId ?? node.id),
        ) + 1
      map.nodes.push({ id, x, y, name: `N${id}`, uid, realId, direction: 0 })
      if (connection !== null)
        map.edges.push({
          id: `E${id}-${connection}`,
          from: id,
          to: connection,
          direction: 0,
          drivingType: 1,
        })
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
      const sourceMaxUid = Number(
        legacySource.value?.content
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)[1]
          ?.split('\t')[6] ?? 0,
      )
      commit((map) => {
        appendCurve(map, to, curve, curveOptions.direction, sourceMaxUid, from)
      })
      selectedId.value = from
      message.value = `커브 연결 완료 · N${to} → N${from}`
      return
    }
    commit((map) =>
      map.edges.push({ id: `E${from}-${to}`, from, to, direction: 0, drivingType: 1 }),
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
        commit((map) => map.edges.push({ id: `E${from}-${id}`, from, to: id }))
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
    commit((map) => {
      if (map.nodes.find((node) => node.id === id)?.removable === false)
        throw new Error(`N${id}의 Removable 설정이 해제되어 있습니다.`)
      if (drawingOptions.autoConnectDelete) {
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
      }
      map.nodes = map.nodes.filter((node) => node.id !== id)
      map.edges = map.edges.filter((edge) => edge.from !== id && edge.to !== id)
      map.ports = map.ports.filter((port) => port.nodeId !== id)
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
  ) => {
    selectedIds.value = mgsAreaSelection(document.value.nodes, selectedIds.value, start, end)
    if (start.x < end.x && selectedIds.value.length) selectedId.value = null
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
    commit,
    shapeTool,
    portMode,
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
    selectedId,
    selectedIds,
    selectedNode,
    tool,
    sourceName,
    projectToken,
    readOnly,
    legacySource,
    updatePort,
    updateEdge,
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
