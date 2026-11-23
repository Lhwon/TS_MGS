<!--
 * 파일명: SelectedMapEditor.vue
 * 설명: 원본 선택 목록과 탭별 설정을 유지하는 노드 및 경로와 포트 일괄 편집 화면
 * 작성자: 이희원
 * 작성일자: 2026-11-18
-->
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  legacyColor,
  MAX_PORTS,
  NODE_FLAGS,
  PATH_CONTROLS,
  PORT_SETTINGS,
  PORT_TAIL_FLAGS,
  repairPortGroups,
} from '@/entities/map/index.ts'
import { useEditor } from '@/features/map-editor/model/editor.ts'

type Mode = 'node' | 'path' | 'port'
type Field = { key: string; label: string; kind?: 'text' | 'flag' | 'color'; additive?: boolean }
const mode = defineModel<Mode | null>({ required: true })
const emit = defineEmits<{ focus: [id: number] }>()
const editor = useEditor()
const titles = {
  node: 'Selected Node Edit',
  path: 'Selected Path Edit',
  port: 'Selected Port Edit',
}
const tabs = {
  node: ['Node Setting', 'Node Shift'],
  path: ['Main', 'Advanced', 'ODS Field'],
  port: ['Main', 'Shape', 'Setting', 'Bay'],
}
const tab = ref(''),
  side = ref<'all' | 'forward' | 'backward'>('all')
const portSetting = ref('Basic')
const message = ref(''),
  error = ref('')
const values = reactive<Record<string, string | number | null>>({})
const shift = reactive({ x: 0, y: 0, target: '', clear: false })
const portCreate = reactive({ prefix: '', suffix: 'number', start: 1 })
const excluded = ref(new Set<string>())
const selected = computed(() => new Set(editor.selectedNodeIds))
const nodes = computed(() => editor.document.nodes.filter((node) => selected.value.has(node.id)))
const realIds = computed(() => new Map(nodes.value.map((node) => [node.id, node.realId])))
const edges = computed(() =>
  editor.document.edges.filter(
    (edge) => selected.value.has(edge.from) && selected.value.has(edge.to),
  ),
)
const ports = computed(() =>
  editor.document.ports.filter(
    (port) =>
      !excluded.value.has(port.id) &&
      (selected.value.has(port.nodeId) || port.id === editor.selectedPortId),
  ),
)
const portGroups = computed(() => {
  const ids = new Set(ports.value.map((port) => port.id))
  return (editor.document.portGroups ?? []).filter((group) =>
    group.portIds.some((id) => ids.has(id)),
  )
})
const rows = computed(() =>
  mode.value === 'node'
    ? nodes.value.map((node) => ({
        id: String(node.id),
        nodeId: node.id,
        label: `N${node.id} · Real ID ${node.realId ?? '—'}`,
      }))
    : mode.value === 'path'
      ? edges.value.map((edge) => ({
          id: edge.id,
          nodeId: edge.from,
          label: `N${edge.from} ${edge.direction === 1 ? '↔' : '→'} N${edge.to} · Real ID ${realIds.value.get(edge.from) ?? '—'} / ${realIds.value.get(edge.to) ?? '—'}`,
        }))
      : ports.value.map((port) => ({
          id: port.id,
          nodeId: port.nodeId,
          label: port.name ? `${port.id} · ${port.name}` : port.id,
        })),
)
const pathFields: Field[] = PATH_CONTROLS.map((field) => ({
  key: field.key,
  label: field.key === 'controlSpeed' ? 'Speed cm/sec' : field.label,
  ...('flag' in field && field.flag ? { kind: 'flag' as const } : {}),
}))
const mainPath = new Set(['vehicleDegree', 'reverse', 'controlSpeed', 'manualDegree', 'pathWeight'])
const mainPort = new Set([
  'report_id',
  'orientation',
  'lu_dir',
  'lu_shift',
  'lu_height0',
  'lu_height1',
  'handshaking',
  'ready_port_vhl_num',
  'limit_ports_idx',
  'ucs_setting_idx',
  'id_port_parent',
])
const portSettings: Field[] = [...PORT_SETTINGS, ...PORT_TAIL_FLAGS.map((field) => ({ ...field, kind: 'flag' as const }))].map((field) => ({
  key: field.key,
  label: field.label,
  kind: field.kind === 'number' ? undefined : field.kind,
}))
const bayField: Field = {
  key: 'bays',
  label: 'Bay 번호 · 쉼표로 구분',
  kind: 'text',
  additive: true,
}
const fields = computed<Field[]>(() => {
  if (mode.value === 'node')
    return tab.value === 'Node Shift'
      ? []
      : [
          { key: 'direction', label: 'Direction Num · 단방향 0 / 양방향 1' },
          { key: 'drivingType', label: 'Driving Type · 1–9' },
          { key: 'virtual', label: 'Virtual Node', kind: 'flag' },
          ...NODE_FLAGS.map(({ key, label }) => ({ key, label, kind: 'flag' as const })),
          { key: 'safetyViewDistance', label: 'View Safety Distance mm' },
          { key: 'safetyDistance', label: 'Safety Distance mm' },
          { key: 'property', label: 'Property · 비트 값' },
          { key: 'addressType', label: 'Address Type · 비트 값' },
        ]
  if (mode.value === 'path') {
    if (tab.value === 'ODS Field')
      return pathFields.filter((field) => field.key.startsWith('odsField'))
    if (tab.value === 'Main')
      return [...pathFields.filter((field) => mainPath.has(field.key)), bayField]
    return pathFields.filter(
      (field) => !mainPath.has(field.key) && !field.key.startsWith('odsField'),
    )
  }
  if (tab.value === 'Bay') return [bayField]
  if (tab.value === 'Shape')
    return [
      { key: 'offsetX', label: 'X Offset mm', additive: true },
      { key: 'offsetY', label: 'Y Offset mm', additive: true },
      { key: 'width', label: 'Port Width mm', additive: true },
      { key: 'height', label: 'Port Height mm', additive: true },
      { key: 'strokeColor', label: 'Pen Color', kind: 'color' },
      { key: 'fillColor', label: 'Brush Color', kind: 'color' },
      { key: 'fontColor', label: 'Font Color', kind: 'color' },
      { key: 'fontSize', label: 'Font Height' },
      { key: 'nameDistance', label: 'Text Offset' },
      { key: 'namePosition', label: 'Text Position · 0–4' },
      { key: 'nameDirection', label: 'Text Direction · 0–1' },
      ...portSettings.filter((field) => field.key === 'name_align'),
    ]
  if (tab.value === 'Main')
    return [
      { key: 'name', label: 'Caption', kind: 'text' },
      { key: 'floor', label: 'Floor' },
      ...portSettings.filter((field) => mainPort.has(field.key) || field.kind === 'flag'),
    ]
  return portSettings.filter((field) => {
    if (field.kind === 'flag' || field.key === 'name_align') return false
    if (portSetting.value === 'Height') return field.key.startsWith('lu_height')
    if (portSetting.value === 'Depth') return field.key.startsWith('lu_depth')
    const command = /_cmd_limit$|_delay_sec$|^lu_position/.test(field.key)
    if (portSetting.value === 'CMD') return command
    return !command && !mainPort.has(field.key) && !/^lu_(height|depth)/.test(field.key)
  })
})
watch(mode, (value) => {
  if (!value) return
  tab.value = tabs[value][0]
  side.value = 'all'
  portSetting.value = 'Basic'
  excluded.value = new Set()
  Object.keys(values).forEach((key) => delete values[key])
  message.value = error.value = ''
})
const speedMetres = computed(() =>
  values.controlSpeed == null || values.controlSpeed === ''
    ? ''
    : Math.round(Number(values.controlSpeed) * 0.6),
)
/** 원본 속도 입력의 미터 분당 값을 센티미터 초당 정수로 변환 */
const assignSpeedMetres = (value: string) => {
  values.controlSpeed = value.trim() ? Math.trunc((Number(value) * 100) / 60) : ''
}
/** 검증을 통과한 작업만 한 번의 편집 이력으로 기록하는 실행 */
const run = (action: () => void, detail: string, hasTarget = rows.value.length > 0) => {
  error.value = message.value = ''
  try {
    if (editor.readOnly) throw new Error('읽기 전용 지도입니다.')
    if (!hasTarget) throw new Error('지도에서 편집할 대상을 선택하세요.')
    action()
    message.value = editor.message = detail
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
/** 필드에 맞는 원본 수치와 문자열 형식을 검증하는 입력 변환 */
const fieldValue = (field: Field) => {
  const raw = values[field.key]
  if (raw === undefined || raw === null) throw new Error('적용할 값을 입력하세요.')
  if (field.kind === 'text') return String(raw)
  if (field.kind === 'color') return legacyColor(Number.parseInt(String(raw).slice(1), 16))
  if (String(raw).trim() === '' || !Number.isSafeInteger(Number(raw)))
    throw new Error('정수 값을 입력하세요.')
  const number = Number(raw)
  if (
    (field.kind === 'flag' || ['direction', 'nameDirection'].includes(field.key)) &&
    ![0, 1].includes(number)
  )
    throw new Error('0 또는 1을 입력하세요.')
  if (field.key === 'drivingType' && (number < 1 || number > 9))
    throw new Error('주행 타입 범위는 1–9입니다.')
  if (field.key === 'vehicleDegree' && (number < 0 || number >= 360000))
    throw new Error('차량 각도 범위는 0–359999입니다.')
  if (
    (field.key.startsWith('odsField') || field.key === 'controlSpeed') &&
    (number < 0 || number > 255)
  )
    throw new Error('설정 범위는 0–255입니다.')
  return number
}
/** 선택 목록과 적용 방향을 스냅샷으로 고정하여 한 필드만 변경하는 일괄 적용 */
const apply = (field: Field, action: 'set' | 'add' | 'remove' | 'clear' = 'set') =>
  run(() => {
    const value = action === 'clear' ? '' : fieldValue(field)
    const append = action === 'add'
    const keys = new Set(rows.value.map((row) => row.id))
    const bayIds =
      field.key === 'bays'
        ? String(value)
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .map(Number)
        : []
    if (bayIds.some((id) => !Number.isSafeInteger(id) || id < 1))
      throw new Error('Bay 번호를 확인하세요.')
    if (mode.value === 'path' && field.key === 'bays' && side.value !== 'all')
      throw new Error('경로 Bay는 연결 전체에 적용됩니다. 적용 방향을 ALL로 지정하세요.')
    /** 선택한 Bay를 기존 목록과 교체하거나 추가 및 제거하는 집합 편집 */
    const editBays = (current: number[] = []) =>
      action === 'remove'
        ? current.filter((id) => !bayIds.includes(id))
        : [...new Set([...(append ? current : []), ...bayIds])]
    if (
      mode.value === 'path' &&
      field.key !== 'bays' &&
      side.value === 'backward' &&
      !edges.value.some((edge) => edge.direction === 1)
    )
      throw new Error('선택된 경로에 OPPOSITE 방향이 없습니다.')
    editor.commit((map) => {
      if (mode.value === 'node') {
        for (const node of map.nodes)
          if (keys.has(String(node.id)) && field.key !== 'drivingType')
            Object.assign(node, { [field.key]: field.kind === 'flag' ? Boolean(value) : value })
        if (field.key === 'direction' || field.key === 'drivingType')
          for (const edge of map.edges)
            if (keys.has(String(edge.from))) Object.assign(edge, { [field.key]: value })
        return
      }
      if (mode.value === 'path') {
        for (const edge of map.edges)
          if (keys.has(edge.id)) {
            if (field.key === 'bays') {
              edge.bays = editBays(edge.bays)
              continue
            }
            const controls = (edge.controls ??= {})
            for (const direction of ['forward', 'backward'] as const) {
              if (
                (side.value !== 'all' && side.value !== direction) ||
                (direction === 'backward' && edge.direction !== 1)
              )
                continue
              const changes = (controls[direction] ??= {})
              changes[field.key] = Number(value)
              if (field.key === 'vehicleDegree') changes.manualDegree = 1
            }
          }
        return
      }
      const anchors = new Map(map.nodes.map((node) => [node.id, node]))
      for (const port of map.ports)
        if (keys.has(port.id)) {
          if (field.key === 'offsetX' || field.key === 'offsetY') {
            const axis = field.key === 'offsetX' ? 'x' : 'y'
            port[axis] = (append ? port[axis] : anchors.get(port.nodeId)![axis]) + Number(value)
          } else if (field.key === 'width' || field.key === 'height') {
            port[field.key] = (append ? (port[field.key] ?? 0) : 0) + Number(value)
          } else if (field.key === 'bays') port.bays = editBays(port.bays)
          else if (portSettings.some((item) => item.key === field.key))
            (port.settings ??= {})[field.key] = value
          else Object.assign(port, { [field.key]: value })
        }
    })
  }, `${field.label} · 선택 항목에 적용`)
/** 상대 이동과 축 좌표 맞춤을 연결 포트와 함께 적용하는 노드 이동 */
const move = (axis?: 'x' | 'y') =>
  run(() => {
    const ids = nodes.value.map((node) => node.id)
    if (!axis) editor.moveNodes(ids, Number(shift.x), Number(shift.y))
    else {
      if (!String(shift.target).trim() || !Number.isSafeInteger(Number(shift.target)))
        throw new Error('맞출 좌표를 정수로 입력하세요.')
      const changes = ids.map((id) => ({
        entity: 'node',
        operation: 'update',
        id: String(id),
        value: { [axis]: Number(shift.target) },
      }))
      editor.applyMapEdits(changes, 15000)
    }
    if (shift.clear) editor.clearSelection()
  }, '선택 노드 이동 완료')
/** 선택 노드에 접두사와 원본 식별자 규칙을 적용하는 포트 추가 */
const addPorts = () =>
  run(
    () => {
      const prefix = portCreate.prefix.trim()
      if (!prefix || /[\t\r\n]/.test(prefix)) throw new Error('Port ID 접두사를 입력하세요.')
      const count = nodes.value.length
      if (editor.document.ports.length + count > MAX_PORTS)
        throw new Error('원본 포트 개수 제한을 초과합니다.')
      const start = Number(portCreate.start)
      if (portCreate.suffix === 'number' && (!Number.isSafeInteger(start) || start < 0))
        throw new Error('시작 번호는 0 이상의 정수로 입력하세요.')
      const sourceMax =
        Number(editor.legacySource?.content.split(/\r?\n/, 2)[1]?.split('\t')[7]) || 0
      const maxUid = Math.max(sourceMax, 0, ...editor.document.ports.map((port) => port.uid ?? 0))
      const byId = new Map(nodes.value.map((node) => [node.id, node]))
      const portIds = new Set(editor.document.ports.map((port) => port.id))
      const portPosition = (key: string, fallback: number) => {
        const field = { key, label: key }
        return values[key] === undefined ? fallback : Number(fieldValue(field))
      }
      const x = portPosition('offsetX', 0),
        y = portPosition('offsetY', 1000),
        width = portPosition('width', 1000),
        height = portPosition('height', 1000)
      if (width < 0 || height < 0) throw new Error('포트 크기는 0 이상이어야 합니다.')
      const additions = [...selected.value].map((id, index) => {
        const node = byId.get(id)!
        const uid = maxUid + index + 1
        const suffix =
          portCreate.suffix === 'uid'
            ? uid
            : portCreate.suffix === 'real'
              ? node.realId
              : start + index
        if (!Number.isSafeInteger(suffix) || suffix === undefined || suffix < 0)
          throw new Error(`N${id}의 접미 번호를 확인하세요.`)
        const portId = `${prefix}_${suffix}`
        if (portIds.has(portId)) throw new Error(`중복 Port ID ${portId}`)
        portIds.add(portId)
        return {
          id: portId,
          uid,
          nodeId: id,
          name: String(values.name ?? ''),
          x: node.x + x,
          y: node.y + y,
          width,
          height,
          floor: portPosition('floor', 1),
          fontSize: 40,
          nameDistance: 100,
          namePosition: 0,
          nameDirection: 0,
        }
      })
      editor.commit((map) => map.ports.push(...additions))
    },
    `포트 ${nodes.value.length}개 추가 완료`,
    nodes.value.length > 0,
  )
/** 삭제 대상 및 종속 참조를 원본 저장 검증과 함께 정리하는 일괄 삭제 */
const remove = () => {
  if (
    !rows.value.length ||
    !window.confirm(`선택한 ${rows.value.length}개 항목을 삭제하시겠습니까?`)
  )
    return
  run(
    () => {
      if (mode.value === 'node') {
        editor.applyNodeSelectionEdit(nodes.value.map((node) => node.id), { operation: 'delete' })
        return
      }
      editor.commit((map) => {
        if (mode.value !== 'port') return
        const ids = new Set(ports.value.map((port) => port.id))
        map.ports = map.ports.filter((port) => !ids.has(port.id))
        repairPortGroups(map)
      })
    },
    '선택 항목 삭제 완료',
  )
}
/** 선택한 목록 항목의 위치를 지도에서 확인하는 이동 */
const focus = (id: number) => emit('focus', id)
/** 포트를 유지한 채 선택 목록이 속한 포트 그룹만 제거 */
const removeGroups = () => {
  if (!portGroups.value.length || !window.confirm('선택 포트가 속한 그룹을 삭제하시겠습니까?'))
    return
  const groups = new Set(portGroups.value.map((group) => group.id))
  run(
    () =>
      editor.commit((map) => {
        map.portGroups = (map.portGroups ?? []).filter((group) => !groups.has(group.id))
      }),
    `포트 그룹 ${groups.size}개 삭제 완료`,
  )
}
/** 지도에서 선택한 노드와 포트를 함께 초기화하는 목록 비우기 */
const clear = () => {
  editor.clearSelection()
  if (mode.value === 'port') editor.selectedPortId = null
  excluded.value = new Set()
}
/** 넓은 단일 객체 편집과 공통 지도 도구의 기존 진입점 제공 */
const openDetails = () => {
  const target = mode.value
  mode.value = null
  if (target === 'node') {
    editor.operationTab = 'nodes'
    editor.operationsOpen = true
  } else editor.objectEditor = target === 'path' ? 'edges' : 'ports'
}
</script>

<template>
  <v-dialog
    :model-value="mode !== null"
    max-width="760"
    scrollable
    persistent
    no-click-animation
    :scrim="false"
    :retain-focus="false"
    :content-props="{ style: { marginInlineStart: 'auto' } }"
    @update:model-value="mode = null"
  >
    <v-card
      v-if="mode"
      :title="titles[mode]"
      data-testid="selected-map-editor"
      @keydown.esc.stop="mode = null"
    >
      <v-card-text class="selected-editor">
        <aside
          class="selection-list"
          aria-label="선택 목록"
        >
          <div class="d-flex align-center justify-space-between ga-2">
            <strong>선택 {{ rows.length }}개</strong>
            <v-btn @click="clear">목록 비우기</v-btn>
          </div>
          <p
            v-if="!rows.length"
            class="text-caption my-2"
          >
            지도에서 {{ mode === 'path' ? '경로 양 끝의 노드를' : '대상 객체를' }} 선택하세요.
          </p>
          <div
            v-for="row in rows"
            :key="row.id"
            class="d-flex align-center"
          >
            <v-btn
              class="justify-start flex-grow-1"
              @click="focus(row.nodeId)"
            >
              {{ row.label }}
            </v-btn>
            <v-btn
              v-if="mode === 'port'"
              title="선택 목록에서만 제외"
              @click="excluded.add(row.id)"
            >
              제외
            </v-btn>
          </div>
        </aside>
        <section class="edit-fields">
          <div class="d-flex flex-wrap ga-1 mb-3">
            <v-btn
              v-for="name in tabs[mode]"
              :key="name"
              :color="tab === name ? 'primary' : undefined"
              :variant="tab === name ? 'tonal' : 'text'"
              @click="tab = name"
            >
              {{ name }}
            </v-btn>
          </div>
          <div
            v-if="mode === 'path'"
            class="d-flex align-center flex-wrap ga-2 mb-4"
          >
            <span class="text-caption">Applied Direction Type</span>
            <v-btn-toggle
              v-model="side"
              mandatory
              color="primary"
              aria-label="Applied Direction Type"
            >
              <v-btn value="all">ALL</v-btn>
              <v-btn value="forward">RIGHT</v-btn>
              <v-btn value="backward">OPPOSITE</v-btn>
            </v-btn-toggle>
          </div>
          <div
            v-if="mode === 'port' && tab === 'Main'"
            class="port-create pa-3 mb-4"
          >
            <div class="text-subtitle-2 mb-2">선택 노드에 포트 추가</div>
            <div class="field-row flex-wrap">
              <v-text-field
                v-model="portCreate.prefix"
                label="Port ID 접두사"
              />
              <v-select
                v-model="portCreate.suffix"
                label="접미사"
                :items="[
                  { title: 'Use Number', value: 'number' },
                  { title: 'Use Real ID', value: 'real' },
                  { title: 'Use Port UID', value: 'uid' },
                ]"
              />
              <v-text-field
                v-if="portCreate.suffix === 'number'"
                v-model="portCreate.start"
                type="number"
                label="Start Num."
              />
              <v-btn
                variant="tonal"
                :disabled="!nodes.length || editor.readOnly"
                @click="addPorts"
              >
                포트 추가
              </v-btn>
            </div>
          </div>
          <div
            v-if="mode === 'port' && tab === 'Setting'"
            class="d-flex flex-wrap ga-1 mb-3"
          >
            <v-btn
              v-for="name in ['Basic', 'Height', 'Depth', 'CMD']"
              :key="name"
              :variant="portSetting === name ? 'tonal' : 'text'"
              :color="portSetting === name ? 'primary' : undefined"
              @click="portSetting = name"
            >
              {{ name }}
            </v-btn>
          </div>
          <div
            v-if="mode === 'node' && tab === 'Node Shift'"
            class="d-flex flex-column ga-3"
          >
            <div class="field-row">
              <v-text-field
                v-model.number="shift.x"
                type="number"
                label="X Offset mm"
              />
              <v-text-field
                v-model.number="shift.y"
                type="number"
                label="Y Offset mm"
              />
              <v-btn
                variant="tonal"
                :disabled="!rows.length || editor.readOnly"
                @click="move()"
              >
                Run
              </v-btn>
            </div>
            <div class="field-row">
              <v-text-field
                v-model="shift.target"
                type="number"
                label="맞출 좌표 mm"
              />
              <v-btn
                :disabled="!rows.length || editor.readOnly"
                @click="move('x')"
              >
                X Move
              </v-btn>
              <v-btn
                :disabled="!rows.length || editor.readOnly"
                @click="move('y')"
              >
                Y Move
              </v-btn>
            </div>
            <v-checkbox
              v-model="shift.clear"
              hide-details
              label="이동 후 선택 목록 비우기"
            />
          </div>
          <div
            v-else
            class="d-flex flex-column ga-2"
          >
            <div
              v-for="field in fields"
              :key="field.key"
              class="field-row"
              :data-field="field.key"
            >
              <v-text-field
                v-if="field.key === 'controlSpeed'"
                :model-value="speedMetres"
                type="number"
                label="Speed m/min"
                @update:model-value="assignSpeedMetres"
              />
              <v-select
                v-if="field.kind === 'flag'"
                v-model="values[field.key]"
                :label="field.label"
                :items="[
                  { title: '설정', value: 1 },
                  { title: '해제', value: 0 },
                ]"
              />
              <v-text-field
                v-else
                v-model="values[field.key]"
                :label="field.label"
                :type="field.kind === 'text' ? 'text' : field.kind === 'color' ? 'color' : 'number'"
              />
              <v-btn
                variant="tonal"
                :disabled="!rows.length || editor.readOnly"
                @click="apply(field)"
              >
                Set
              </v-btn>
              <v-btn
                v-if="field.additive"
                :disabled="!rows.length || editor.readOnly"
                @click="apply(field, 'add')"
              >
                Add
              </v-btn>
              <template v-if="field.key === 'bays'">
                <v-btn
                  :disabled="!rows.length || editor.readOnly"
                  @click="apply(field, 'remove')"
                >
                  Remove
                </v-btn>
                <v-btn
                  :disabled="!rows.length || editor.readOnly"
                  @click="apply(field, 'clear')"
                >
                  Clear
                </v-btn>
              </template>
            </div>
          </div>
          <p
            v-if="error"
            class="text-error mt-3"
            role="alert"
          >
            {{ error }}
          </p>
          <p
            v-if="message"
            class="text-body-2 mt-3"
            role="status"
          >
            {{ message }}
          </p>
        </section>
      </v-card-text>
      <v-card-actions>
        <v-btn
          v-if="mode !== 'path'"
          color="error"
          :disabled="!rows.length || editor.readOnly"
          @click="remove"
        >
          선택 삭제
        </v-btn>
        <v-btn
          v-if="mode === 'port' && portGroups.length"
          :disabled="editor.readOnly"
          @click="removeGroups"
        >
          포트 그룹 삭제
        </v-btn>
        <v-spacer />
        <v-btn @click="openDetails">
          {{ mode === 'node' ? '지도 일괄 편집' : '개별 객체 편집' }}
        </v-btn>
        <v-btn @click="mode = null">닫기</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss">
.selected-editor {
  display: grid;
  grid-template-columns: minmax(150px, 0.8fr) minmax(0, 2fr);
  gap: 16px;
}
.selection-list {
  border-radius: 8px;
  background: var(--surface-muted);
  padding: 8px;
  max-height: 58vh;
  overflow: auto;
}
.edit-fields {
  min-width: 0;
}
.port-create {
  border-radius: 8px;
  background: var(--surface-muted);
}
.port-create .field-row :deep(.v-input) {
  min-width: 110px;
}
.field-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.field-row :deep(.v-input) {
  flex: 1 1 0;
  min-width: 0;
}
@media (max-width: 620px) {
  .selected-editor {
    grid-template-columns: minmax(0, 1fr);
  }
  .selection-list {
    max-height: 140px;
  }
}
</style>
