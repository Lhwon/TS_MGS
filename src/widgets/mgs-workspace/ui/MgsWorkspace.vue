<!--
/**
 * 파일명: MgsWorkspace.vue
 * 설명: 원본 상단 리본과 Summary 및 하단 로그와 선택 목록을 재현하는 평면 작업 화면
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
-->
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { DrawingLayout } from '@/features/drawing-import/index.ts'
import type { MapLayout } from '@/entities/map/index.ts'
import {
  TeachingEditor,
  AreaEditor,
  MapOperations,
  useEditor,
} from '@/features/map-editor/index.ts'
import { parseDocument } from '@/entities/map/index.ts'
import type { Layers } from '@/entities/map/index.ts'
import { AppIcon, TextAction } from '@/shared/ui/index.ts'
import { MGS_RIBBON } from '@/widgets/mgs-workspace/model/ribbon.ts'
import MgsSummary from '@/widgets/mgs-workspace/ui/MgsSummary.vue'

const props = defineProps<{
  busy: boolean
  layers: Layers
  cursor: { x: number; y: number }
  zoom: number
}>()
const emit = defineEmits<{
  open: []
  save: []
  saveAs: []
  saveNative: []
  folder: []
  showFolder: []
  create: []
  facility: []
  assistant: []
  fit: []
  focus: [id: number]
  layer: [key: keyof Layers, value: boolean]
  capture: []
}>()
const editor = useEditor()
const tab = ref('File')
const summary = ref<InstanceType<typeof MgsSummary>>()
const layoutOpen = ref(false)
/** 지도 객체를 유지하며 선택한 배경만 적용하는 수동 명령 */
const applyLayout = (layout: MapLayout) => {
  try {
    editor.commit((map) => {
      map.layout = layout
    })
    editor.message = '편집용 배경 도면 적용 완료'
  } catch (cause) {
    editor.message = String(cause)
  }
}
/** 배경 도면의 표시 상태 전환 */
const toggleLayout = () =>
  editor.commit((map) => {
    if (map.layout) map.layout.visible = !map.layout.visible
  })
const curveForm = reactive({ radius: 1000, angle: 90, divide: 15, direction: 0 })
watch(
  () => editor.curveSettingsOpen,
  (open) => {
    if (open) {
      const { radius, angle, divide, direction } = editor.curveOptions
      Object.assign(curveForm, { radius, angle, divide, direction })
    }
  },
)
/** 반경과 회전각 및 분할각을 검증한 설정 폼의 커브 옵션 적용 */
const applyCurveSettings = () => {
  Object.assign(editor.curveOptions, curveForm)
  editor.curveSettingsOpen = false
}
const hiddenMenu = ref(false)
const nodeEditor = computed({
  get: () => editor.nodeEditorOpen,
  set: (value: boolean) => {
    editor.nodeEditorOpen = value
  },
})
const report = ref('')
const reportTitle = ref('')
const messages = ref<string[]>([])
const activeTab = computed(() => MGS_RIBBON.find((item) => item.name === tab.value)!)
const selected = computed(() => [
  ...new Set([...editor.selectedIds, ...(editor.selectedId === null ? [] : [editor.selectedId])]),
])
watch(
  () => editor.message,
  (message) => {
    messages.value = [
      ...messages.value.slice(-99),
      `${new Date().toLocaleTimeString()}  ${message}`,
    ]
  },
  { immediate: true },
)
const viewCommands: Record<string, keyof Layers> = {
  TBT_show_real_id: 'realIds',
  TBT_show_node_id: 'nodeIds',
  TBT_show_unique_id: 'uniqueIds',
  TBT_show_virtual_node: 'virtualLabels',
  TBT_show_position: 'positions',
  TBT_show_direction: 'edges',
  TBT_show_grid: 'grid',
  TBT_show_distance: 'pathDistances',
  TBT_show_radius: 'pathRadii',
  TBT_show_port_name: 'portNames',
  TBT_show_port_id: 'portIds',
  TBT_show_property: 'nodeProperties',
  TBT_show_no_send_goal: 'noSendGoals',
  TBT_show_no_send_goal_loaded: 'loadedGoals',
  TBT_show_address_type: 'addressTypes',
  TBT_show_dont_remove_cmd: 'commandRetention',
  TBT_show_node_dir: 'nodeDirections',
  TBT_show_curve_type: 'pathTypes',
  TBT_show_vhl_speed: 'pathSpeeds',
  TBT_show_reverse: 'pathReverses',
  TBT_show_manual_deg: 'pathDegrees',
  TBT_show_ods_field: 'pathOds',
  TBT_show_path_weight: 'pathWeights',
  TBT_show_spinturnable: 'pathSpinturns',
  TBT_show_guidance_type: 'pathGuidance',
  TBT_show_control_weight: 'pathControlWeights',
  TBT_show_meandev_ignore: 'pathMeanDev',
  TBT_show_report_id: 'portReports',
  TBT_show_lu_shift: 'portShifts',
  TBT_show_handshaking: 'portHandshake',
  TBT_show_lu_direction: 'portDirection',
  TBT_show_lu_height: 'portHeight',
}
const drawingChecks = computed<Record<string, boolean>>(() => ({
  BT_force_curve: editor.curveOptions.force,
  BT_auto_straight_curve: editor.curveOptions.autoSelect,
  BT_curve_reverse: editor.curveOptions.reverse,
  BT_dynamic_radius: editor.curveOptions.dynamicRadius,
  BT_right_angle: editor.drawingOptions.rightAngle,
  BT_x_magnet: editor.drawingOptions.xMagnet,
  BT_y_magnet: editor.drawingOptions.yMagnet,
  BT_select_pre_node: editor.drawingOptions.autoPrevious,
  BT_check_overlab: editor.drawingOptions.checkOverlap,
  TBT_check_auto_conn: editor.drawingOptions.autoConnectDelete,
}))
const icons: Record<string, string> = {
  BT_open_file: 'folder',
  BT_save_file: 'save',
  BT_show_report: 'panel',
  BT_select_project: 'folder',
  BT_load_layout: 'layers',
  BT_init_project: 'new',
  BT_open_project_folder: 'folder',
  BT_save_jmapx: 'save',
}

/** 필요한 작업 탭을 지정하고 공통 편집창을 여는 메뉴 전환 */
const openOperations = (tab: string) => {
  editor.operationTab = tab
  editor.operationsOpen = true
}

/**
 * 선택 목록의 노드를 선택하고 지도 중심으로 이동하는 목록 탐색
 * @param id 선택한 노드 식별자
 */
const focusSelected = (id: number) => {
  editor.selectedId = id
  emit('focus', id)
}

/**
 * 선택한 노드를 원본 별도 속성창에서 편집하는 창 열기
 */
const editNode = () => {
  editor.operationTab = 'nodes'
  editor.operationsOpen = true
}

/**
 * 원본 지도와 선택 목록을 기준으로 무결성과 통계 결과를 표시하는 보고서 열기
 * @param title 보고서 창 제목
 */
const verify = (title = 'Map Report') => {
  reportTitle.value = title
  try {
    parseDocument(JSON.stringify(editor.document))
    const map = editor.document
    const duplicatePositions = map.nodes.filter(
      (node, index, nodes) =>
        nodes.findIndex((other) => other.x === node.x && other.y === node.y) !== index,
    )
    report.value = [
      `Map : ${editor.sourceName}`,
      `Version : ${map.legacy?.version ?? 25}`,
      `Node : ${map.nodes.length}`,
      `Path : ${map.edges.length}`,
      `Port : ${map.ports.length}`,
      `Shape : ${map.shapes?.length ?? 0}`,
      `Port Group : ${map.portGroups?.length ?? 0}`,
      `Selected Node : ${selected.value.length}`,
      `Duplicate Position : ${duplicatePositions.map((node) => node.id).join(', ') || 'None'}`,
      '',
      '현재 문서의 ID 중복과 노드 참조 및 수치 형식 검증 통과',
      '운행 제어값과 AES 및 Blocking 검증은 원본 전용 검증의 추가 이관 대상',
    ].join('\n')
  } catch (cause) {
    report.value = cause instanceof Error ? cause.message : String(cause)
  }
}
/** 방향별 경로 제어값을 원본 도구와 같은 전체 범위에 적용하는 초기화 */
const clearControl = (key: string, toggle = false) => {
  editor.commit((map) => {
    for (const edge of map.edges) {
      edge.controls ??= {}
      for (const direction of ['forward', 'backward'] as const) {
        if (direction === 'backward' && (edge.direction ?? 1) === 0) continue
        edge.controls[direction] ??= {}
        edge.controls[direction][key] = toggle ? (edge.controls[direction][key] === 1 ? 0 : 1) : 0
      }
    }
  })
  editor.message = '경로 제어값 적용'
}
const commands: Record<string, () => void> = {
  BT_right_angle: () => {
    editor.drawingOptions.rightAngle = !editor.drawingOptions.rightAngle
  },
  BT_x_magnet: () => {
    editor.drawingOptions.xMagnet = !editor.drawingOptions.xMagnet
  },
  BT_y_magnet: () => {
    editor.drawingOptions.yMagnet = !editor.drawingOptions.yMagnet
  },
  BT_select_pre_node: () => {
    editor.drawingOptions.autoPrevious = !editor.drawingOptions.autoPrevious
  },
  BT_check_overlab: () => {
    editor.drawingOptions.checkOverlap = !editor.drawingOptions.checkOverlap
  },
  BT_make_grid: () => {
    editor.operationTab = 'grid'
    editor.operationsOpen = true
  },
  BT_area: () => {
    editor.areaCategory = 'bays'
    editor.areaEditorOpen = true
  },
  BT_bay_offset: () => {
    editor.areaCategory = 'offsets'
    editor.areaEditorOpen = true
  },
  BT_limit_ports: () => {
    editor.areaCategory = 'limits'
    editor.areaEditorOpen = true
  },
  BT_apply_xlsx: () => {
    editor.teachingOpen = true
  },
  BT_control_map_data: () => {
    editor.operationTab = 'nodes'
    editor.operationsOpen = true
  },
  BT_capture_minimap: () => summary.value?.capture(),
  BT_set_real_id_in_area: () => openOperations('ids'),
  BT_set_port_color: () => {
    editor.commit((map) => {
      const colors: Record<string, number> = {
        P: 0xebce87,
        F: 0x000080,
        C: 0x0000ff,
        I: 0xffffff,
        S: 0x008000,
        R: 0x00ffff,
        W: 0,
        B: 0xc0c0c0,
        E: 0xc0c0c0,
        X: 0xc0c0c0,
      }
      for (const port of map.ports) {
        const type = port.id[1]
        if (type in colors) port.fillColor = colors[type]
        else if (type === 'G')
          port.fillColor =
            Math.floor(Math.random() * 200 + 55) | (Math.floor(Math.random() * 255) << 8)
      }
    })
  },
  TBT_check_auto_conn: () => {
    editor.drawingOptions.autoConnectDelete = !editor.drawingOptions.autoConnectDelete
  },
  BT_path_distance: () => {
    editor.operationTab = 'distance'
    editor.operationsOpen = true
  },
  BT_clear_manual_deg: () => clearControl('manualDegree'),
  BT_clear_correct_deg: () => clearControl('vehicleCorrection'),
  BT_reverse_reverse: () => clearControl('reverse', true),
  BT_clear_address_type: () => {
    editor.commit((map) => {
      for (const node of map.nodes) node.addressType = 0
    })
  },
  BT_clear_no_send_goal_loaded: () => {
    editor.commit((map) => {
      for (const node of map.nodes) node.noSendGoalLoaded = false
    })
  },
  BT_create_uid: () => {
    editor.commit((map) => {
      let uid = Math.max(0, ...map.nodes.map((node) => node.uid ?? 0))
      for (const node of map.nodes) if (!node.uid) node.uid = ++uid
    })
  },
  BT_force_curve: () => {
    editor.curveOptions.force = !editor.curveOptions.force
  },
  BT_auto_straight_curve: () => {
    editor.curveOptions.autoSelect = !editor.curveOptions.autoSelect
  },
  BT_curve_reverse: () => {
    editor.curveOptions.reverse = !editor.curveOptions.reverse
  },
  BT_dynamic_radius: () => {
    editor.curveOptions.dynamicRadius = !editor.curveOptions.dynamicRadius
  },
  BT_setting_curve: () => {
    editor.curveSettingsOpen = true
  },
  BT_load_layout: () => {
    layoutOpen.value = true
  },
  BT_open_file: () => emit('open'),
  BT_save_file: () => emit('save'),
  BT_save_jmapx: () => emit('saveNative'),
  BT_select_project: () => emit('folder'),
  BT_open_project_folder: () => emit('showFolder'),
  BT_init_project: () => emit('create'),
  BT_show_report: () => verify(),
  BT_set_theme_Office2010Black: () => {
    if (editor.colorMode !== 'dark') editor.toggleColorMode()
  },
  BT_set_theme_Office2010Blue: () => {
    if (editor.colorMode !== 'light') editor.toggleColorMode()
  },
  BT_set_theme_Office2010Silver: () => {
    if (editor.colorMode !== 'light') editor.toggleColorMode()
  },
  BT_select_theme: () => editor.toggleColorMode(),
  BT_clear_property: () => {
    editor.commit((map) => {
      for (const node of map.nodes)
        if (!selected.value.length || selected.value.includes(node.id)) node.property = 0
    })
    editor.message = '선택 범위의 Property를 초기화했습니다.'
  },
}

/**
 * 지원하는 원본 명령 또는 현재 표시 옵션으로 원본 리본 입력을 연결하는 명령 실행
 * @param id 원본 XAML 명령 식별자
 */
const execute = (id: string) => {
  try {
    const layer = viewCommands[id]
    if (layer) {
      emit('layer', layer, !props.layers[layer])
      return
    }
    if (id.startsWith('TBT_shape_')) {
      const types: Record<string, number> = {
        line: 5,
        rectangle: 1,
        round_rectangle: 2,
        circle: 4,
        ellipse: 3,
        text: 6,
      }
      editor.shapeTool = types[id.replace('TBT_shape_', '')] ?? null
      editor.tool = 'select'
      editor.message = '지도에서 왼쪽 드래그로 도형의 범위를 지정하세요. Escape로 종료합니다.'
      return
    }
    commands[id]?.()
  } catch (cause) {
    editor.message = cause instanceof Error ? cause.message : String(cause)
  }
}

/**
 * 실제 연결한 명령만 사용 가능 상태로 노출하는 원본 명령 지원 판정
 * @param id 원본 명령 식별자
 * @returns 실행 가능한 명령 여부
 */
const supported = (id: string) =>
  !!commands[id] || !!viewCommands[id] || id.startsWith('TBT_shape_')
</script>

<template>
  <section
    class="mgs-workspace"
    :class="{ 'menu-hidden': hiddenMenu, dark: editor.colorMode === 'dark' }"
    data-testid="mgs-workspace"
  >
    <header
      v-if="!hiddenMenu"
      class="mgs-ribbon overflow-hidden"
      data-testid="mgs-ribbon"
    >
      <div
        class="ribbon-tabs d-flex align-center"
        role="tablist"
        aria-label="MGS 작업 메뉴"
      >
        <TextAction
          v-for="item in MGS_RIBBON"
          :key="item.name"
          role="tab"
          :active="tab === item.name"
          :data-tab="item.name"
          @activate="tab = item.name"
        >
          {{ item.name }}
        </TextAction>
        <div class="d-flex ml-auto pr-2 ga-1 flex-shrink-0">
          <TextAction
            data-testid="open-ai"
            @activate="emit('assistant')"
          >
            AI Agent
          </TextAction>
          <TextAction
            active
            data-testid="mode-map"
          >
            2D
          </TextAction>
          <TextAction
            data-testid="mode-facility"
            @activate="emit('facility')"
          >
            3D
          </TextAction>
          <TextAction
            data-testid="theme-toggle"
            @activate="editor.toggleColorMode()"
          >
            {{ editor.colorMode === 'dark' ? 'Light' : 'Dark' }}
          </TextAction>
        </div>
      </div>
      <div class="ribbon-content d-flex overflow-x-auto">
        <fieldset
          v-for="(group, index) in activeTab.groups"
          :key="index"
          :class="{ 'named-group': group.name }"
          class="ribbon-group d-flex align-center ga-1 px-2"
        >
          <legend v-if="group.name">{{ group.name }}</legend>
          <div :class="group.name ? 'compact-buttons' : 'd-flex ga-2'">
            <v-btn
              v-for="button in group.buttons"
              :key="button.id"
              :disabled="busy || !supported(button.id)"
              :class="{
                'large-button': !group.name,
                checked:
                  drawingChecks[button.id] ||
                  (viewCommands[button.id] && layers[viewCommands[button.id]!]),
              }"
              :style="{ width: `${button.width}px` }"
              :title="supported(button.id) ? button.label : `${button.label} · 원본 기능 이관 중`"
              :data-command="button.id"
              @click="execute(button.id)"
            >
              <AppIcon
                v-if="!group.name"
                :name="icons[button.id] ?? 'node'"
                :size="34"
              />
              <span>{{ button.label }}</span>
            </v-btn>
          </div>
        </fieldset>
      </div>
    </header>
    <MgsSummary
      ref="summary"
      v-if="!hiddenMenu"
      @focus="emit('focus', $event)"
    />
    <nav
      class="mgs-quick d-flex align-center overflow-x-auto ga-2 px-1"
      aria-label="MGS 빠른 작업"
      data-testid="mgs-quick"
    >
      <v-btn
        icon
        size="x-small"
        title="Hide Menu"
        @click="hiddenMenu = !hiddenMenu"
      >
        <AppIcon
          name="fit"
          :size="19"
        />
      </v-btn>
      <v-btn
        title="Bay Filter"
        @click="openOperations('bays')"
      >
        Bay Filter
      </v-btn>
      <v-btn
        icon
        size="x-small"
        title="Fit Map"
        @click="emit('fit')"
      >
        <AppIcon
          name="fit"
          :size="19"
        />
      </v-btn>
      <v-btn
        icon
        size="x-small"
        :disabled="!editor.canUndo"
        title="Undo"
        data-testid="undo"
        @click="editor.undo()"
      >
        <AppIcon
          name="undo"
          :size="19"
        />
      </v-btn>
      <v-btn
        icon
        size="x-small"
        :disabled="!editor.canRedo"
        title="Redo"
        data-testid="redo"
        @click="editor.redo()"
      >
        <AppIcon
          name="redo"
          :size="19"
        />
      </v-btn>
      <v-btn
        size="small"
        :class="{ 'port-mode-active': editor.portMode }"
        data-testid="port-mode"
        @click="editor.portMode = !editor.portMode"
      >
        [E] Edit Port
      </v-btn>
      <v-btn
        size="small"
        disabled
        title="원본 차량 외형과 렌더링 이관 중"
      >
        Render VHL
      </v-btn>
      <v-btn
        size="small"
        disabled
        title="원본 식별자 일괄 편집 이관 중"
      >
        Set Real ID
      </v-btn>
      <v-btn
        size="small"
        @click="verify('Verify Node')"
      >
        Verify Node
      </v-btn>
      <v-btn
        size="small"
        @click="verify('Verify Path')"
      >
        Verify Path
      </v-btn>
      <v-btn
        size="small"
        @click="verify('Verify Port')"
      >
        Verify Port
      </v-btn>
      <v-btn
        size="small"
        disabled
        title="운행 경로 탐색 이관 중"
      >
        [P] Path Plan Test
      </v-btn>
      <v-btn
        size="small"
        :disabled="!editor.document.layout"
        :class="{ checked: editor.document.layout?.visible }"
        @click="toggleLayout"
        title="편집용 배경 도면 표시"
      >
        Show Layout
      </v-btn>
      <v-btn
        size="small"
        @click="emit('capture')"
      >
        Capture
      </v-btn>
      <v-btn
        size="small"
        data-testid="new-map"
        @click="emit('create')"
      >
        New
      </v-btn>
      <v-btn
        size="small"
        data-testid="open-map"
        @click="emit('open')"
      >
        Open
      </v-btn>
      <v-btn
        size="small"
        data-testid="save-map"
        :disabled="busy"
        @click="emit('save')"
      >
        Save
      </v-btn>
      <v-btn
        size="small"
        data-testid="save-map-as"
        :disabled="busy"
        @click="emit('saveAs')"
      >
        Save As
      </v-btn>
    </nav>
    <div class="mgs-map position-relative overflow-hidden"><slot /></div>
    <div
      v-if="!hiddenMenu"
      class="mgs-bottom d-flex ga-2 pa-1"
      data-testid="mgs-bottom"
    >
      <div class="memo-info flex-grow-1 overflow-y-auto">
        <div
          v-for="(message, index) in messages"
          :key="index"
        >
          {{ message }}
        </div>
      </div>
      <div class="memo-debug overflow-y-auto">
        Map : {{ editor.sourceName }}
        <br />
        Node {{ editor.document.nodes.length }} / Path {{ editor.document.edges.length }} / Port
        {{ editor.document.ports.length }}
        <br />
        {{ editor.dirty ? 'Modified · Save required' : 'Saved' }}
        <br />
        Space + Left Drag : Pan
      </div>
      <div class="selected-nodes d-flex flex-column">
        <div class="d-flex align-center justify-space-between mb-1">
          <span>Count : {{ selected.length }}</span>
          <v-btn
            size="x-small"
            @click="editor.clearSelection()"
          >
            Clear
          </v-btn>
        </div>
        <div class="node-list overflow-y-auto flex-grow-1">
          <v-btn
            v-for="id in selected"
            :key="id"
            size="x-small"
            variant="text"
            @click="focusSelected(id)"
          >
            {{ id }}
          </v-btn>
        </div>
      </div>
      <div class="selected-actions">
        <v-btn
          data-testid="edit-selected-node"
          @click="editNode"
        >
          Selected
          <br />
          Node Edit
        </v-btn>
        <v-btn @click="editor.objectEditor = 'edges'">
          Selected
          <br />
          Path Edit
        </v-btn>
        <v-btn
          data-testid="edit-map-objects"
          @click="editor.objectEditor = 'ports'"
        >
          Selected
          <br />
          Port Edit
        </v-btn>
        <v-btn
          disabled
          title="원본 Block 데이터 이관 중"
        >
          Verify
          <br />
          Block Data
        </v-btn>
        <v-btn
          disabled
          title="원본 Blocking 데이터 이관 중"
        >
          Verify
          <br />
          Blocking Data
        </v-btn>
        <v-btn @click="openOperations('around')">
          Verify
          <br />
          Around Data
        </v-btn>
      </div>
    </div>
    <footer
      class="mgs-status d-flex align-center"
      data-testid="mgs-status"
    >
      <span class="status-login text-center">
        Map {{ editor.document.legacy?.version ?? 25 }}{{ editor.dirty ? ' *' : '' }}
      </span>
      <span>Real = ({{ Math.trunc(cursor.x) }}, {{ Math.trunc(cursor.y) }})</span>
      <span>Scale = {{ zoom.toFixed(3) }}</span>
      <span
        class="text-truncate flex-grow-1"
        role="status"
      >
        {{ editor.message }}
      </span>
    </footer>
    <v-dialog
      v-model="nodeEditor"
      max-width="420"
      scrollable
    >
      <v-card title="Edit Node">
        <v-card-text class="node-editor-content pa-0"><slot name="node-editor" /></v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="nodeEditor = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog
      v-model="editor.curveSettingsOpen"
      max-width="420"
    >
      <v-card
        title="Curve Setting"
        data-testid="curve-settings"
      >
        <form
          class="pa-5"
          @submit.prevent="applyCurveSettings"
        >
          <v-text-field
            v-model.number="curveForm.radius"
            label="Radius (mm)"
            type="number"
            min="1"
            max="100000000"
            step="1"
            required
            data-testid="curve-radius"
          />
          <v-text-field
            v-model.number="curveForm.angle"
            class="mt-3"
            label="Curve Degree (°)"
            type="number"
            min="1"
            max="359"
            step="1"
            required
            data-testid="curve-angle"
          />
          <v-text-field
            v-model.number="curveForm.divide"
            class="mt-3"
            label="Divide Degree (°)"
            type="number"
            min="1"
            :max="curveForm.angle"
            step="1"
            required
            data-testid="curve-divide"
          />
          <label class="d-block mt-3">
            Direction
            <select
              v-model.number="curveForm.direction"
              class="curve-direction pa-2 ml-2"
            >
              <option :value="0">One Way</option>
              <option :value="1">Both Ways</option>
            </select>
          </label>
          <div class="d-flex justify-end ga-2 mt-4">
            <v-btn @click="editor.curveSettingsOpen = false">Cancel</v-btn>
            <v-btn
              type="submit"
              color="primary"
              variant="flat"
              data-testid="curve-settings-apply"
            >
              Apply
            </v-btn>
          </div>
        </form>
      </v-card>
    </v-dialog>
    <v-dialog
      :model-value="!!report"
      max-width="700"
      @update:model-value="
        (value) => {
          if (!value) report = ''
        }
      "
    >
      <v-card :title="reportTitle">
        <v-card-text>
          <pre class="report-content">{{ report }}</pre>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="report = ''">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
  <MapOperations />
  <AreaEditor />
  <TeachingEditor />
  <DrawingLayout
    v-model="layoutOpen"
    :map="editor.document"
    @apply="applyLayout"
    @remove="
      editor.commit((map) => {
        delete map.layout
      })
    "
  />
</template>

<style scoped lang="scss">
// 원본 MainWindow 행과 열의 고정 치수를 사용하는 평면 작업 화면 배치
.mgs-workspace {
  --mgs-panel: var(--surface);
  --mgs-tab: var(--surface-muted);
  --mgs-border: var(--border);
  display: grid;
  flex: 1;
  min-height: 0;
  min-width: 0;
  grid-template-columns: 280px minmax(0, 1fr);
  grid-template-rows: 130px 35px minmax(0, 1fr) 128px 28px;
  color: var(--text);
  background: var(--mgs-panel);
}

.mgs-ribbon {
  grid-column: 1 / -1;
  grid-row: 1;
  background: var(--surface);
  border-bottom: 1px solid var(--mgs-border);
}
.ribbon-tabs {
  overflow-x: auto;
  height: 30px;
  border-bottom: 1px solid var(--mgs-border);
}
.ribbon-content {
  height: 100px;
}
.ribbon-group {
  border: 0;
  border-right: 1px solid var(--mgs-border);
  flex-shrink: 0;
  min-width: 0;
  margin: 4px 0;
}
.ribbon-group legend {
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 12px;
  padding: 0 3px;
}
.ribbon-group :deep(.v-btn) {
  font-size: 12px;
  min-width: 0;
  border: 1px solid var(--mgs-border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: none;
  height: 26px;
  padding: 1px 4px;
}
.ribbon-group :deep(.v-btn.checked) {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}
.ribbon-group .large-button {
  height: 70px;
}
.large-button :deep(.v-btn__content) {
  flex-direction: column;
  white-space: pre-line;
  gap: 7px;
  line-height: 1.25;
  font-weight: 550;
  justify-content: center;
}
.large-button :deep(svg) {
  color: var(--text-secondary);
  transition: color 140ms ease;
}
.ribbon-group :deep(.large-button) {
  background: var(--surface-muted);
  border-color: transparent;
  border-radius: 10px;
}
.ribbon-group :deep(.v-btn:not(.v-btn--disabled):hover) {
  border-color: var(--app-border);
  background: var(--hover);
}
.large-button:not(:disabled):hover :deep(svg) {
  color: var(--accent);
}
.ribbon-group :deep(.v-btn--disabled) {
  border-color: transparent;
}

.compact-buttons {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(2, 26px);
  gap: 3px;
}
.mgs-summary {
  grid-column: 1;
  grid-row: 2 / 4;
}
.mgs-quick {
  background: var(--surface-muted);
  grid-column: 2;
  grid-row: 2;
  border-bottom: 1px solid var(--mgs-border);
  white-space: nowrap;
}
.mgs-quick :deep(.v-btn) {
  border-radius: 6px;
  height: 27px;
  min-width: 30px;
  padding: 0 5px;
  border: 1px solid var(--mgs-border);
  font-size: 12px;
  flex-shrink: 0;
  box-shadow: none;
}
.mgs-quick .port-mode-active {
  background: var(--accent-soft);
  color: var(--accent);
}
.mgs-map {
  grid-column: 2;
  grid-row: 3;
  min-height: 0;
  background: var(--canvas);
}
.mgs-bottom {
  grid-column: 1 / -1;
  grid-row: 4;
  border-top: 1px solid var(--mgs-border);
  min-width: 0;
}
.memo-info,
.memo-debug,
.node-list {
  border: 1px solid var(--mgs-border);
  background: var(--surface);
  border-radius: 6px;
  padding: 7px 9px;
  font-size: 11px;
  line-height: 1.6;
}
.memo-info {
  min-width: 100px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.memo-debug {
  width: min(31vw, 500px);
  flex-shrink: 1;
  min-width: 150px;
}
.selected-nodes {
  width: 200px;
  flex-shrink: 0;
  font-size: 12px;
}
.selected-actions {
  width: 330px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
  flex-shrink: 0;
}
.selected-actions :deep(.v-btn) {
  height: 50px;
  font-size: 12px;
  padding: 3px;
  min-width: 0;
  border-radius: 6px;
  border: 1px solid var(--mgs-border);
  box-shadow: none;
}
.mgs-status {
  background: var(--surface-muted);
  color: var(--text-secondary);
  grid-column: 1 / -1;
  grid-row: 5;
  gap: 8px;
  font-size: 12px;
  border-top: 1px solid var(--mgs-border);
  overflow: hidden;
}
.mgs-status > span {
  padding: 0 8px;
  border-right: 1px solid var(--mgs-border);
  white-space: nowrap;
}
.mgs-status .status-login {
  width: 200px;
  background: var(--accent-soft);
  color: var(--accent);
  flex-shrink: 0;
}
.node-editor-content {
  max-height: 70vh;
}
.node-editor-content :deep(.inspector-panel) {
  min-height: 580px;
}
.curve-direction {
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.report-content {
  white-space: pre-wrap;
  font:
    13px/1.8 Pretendard,
    'Pretendard',
    monospace;
}
.menu-hidden {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: 0 35px minmax(0, 1fr) 0 28px;
}
.menu-hidden .mgs-map,
.menu-hidden .mgs-quick {
  background: var(--surface-muted);
  grid-column: 1;
}
</style>
