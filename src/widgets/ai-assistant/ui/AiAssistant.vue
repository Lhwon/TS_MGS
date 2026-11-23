<!--
 * 파일명: AiAssistant.vue
 * 설명: 자연스러운 대화와 관찰 기반 도구 실행을 제공하는 비모달 에이전트 채팅
 * 작성자: 이희원
 * 작성일자: 2026-11-17
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { VIcon } from 'vuetify/components'
import {
  mdiAttachment,
  mdiSend,
  mdiStop,
  mdiClose,
  mdiChatPlusOutline,
  mdiCubeOutline,
  mdiImageEditOutline,
  mdiFileImageOutline,
} from '@mdi/js'
import { useEditor } from '@/features/map-editor/index.ts'
import { useFacilityEditor } from '@/features/facility-editor/index.ts'
import {
  checkAssistant,
  AssistantModelPicker,
  type AssistantModel,
  runAgent,
  AgentQuestionCard,
  validateAgentAnswer,
  type AgentQuestion,
  type AgentAnswer,
  type AssistantHistory,
} from '@/features/ai-assistant/index.ts'
import { emptyFacilityDocument } from '@/entities/facility/index.ts'
import {
  prepareDrawing,
  patchDrawingObjects,
  drawingFacility,
  validateDrawingMap,
  type DrawingAttachment,
  type DrawingFinding,
} from '@/features/drawing-import/index.ts'
import type { DrawingObject, MapDocument } from '@/entities/map/index.ts'
import DrawingTools from '@/widgets/ai-assistant/ui/DrawingTools.vue'
import { agentContext, executeAgentTool } from '@/widgets/ai-assistant/model/tools.ts'
const emit = defineEmits<{ generated: []; focus: [point: { x: number; y: number }] }>()
const open = defineModel<boolean>({ default: false })
const props = defineProps<{ busy: boolean }>()
const editor = useEditor()
const facility = useFacilityEditor()
const prompt = ref('')
const showTools = ref(false)
const attachment = shallowRef<DrawingAttachment>()
const pendingAttachment = shallowRef<DrawingAttachment>()
const attaching = ref(false)
const fileInput = ref<HTMLInputElement>()
const drawingSettings = ref({
  recognize: true,
  curves: true,
  tiles: 12,
  radius: 0,
  vehicleWidth: 900,
  clearance: 150,
})
const findings = shallowRef<DrawingFinding[]>([])
let attachmentSequence = 0
let conversationSequence = 0
let internalDrawingChange = false
const sceneSessions = new WeakMap<MapDocument, ReturnType<typeof facility.captureSession>>()

/**
 * 분석용 도면을 준비하고 오래된 첨부 결과를 제외하는 이미지 읽기
 * @param file 사용자가 첨부한 도면 이미지
 */
const attachDrawing = async (file?: File) => {
  if (!file || (sending.value && !awaiting.value)) return
  const sequence = ++attachmentSequence
  attaching.value = true
  error.value = ''
  try {
    const drawing = await prepareDrawing(file)
    if (sequence === attachmentSequence) {
      pendingAttachment.value = drawing
      drawingSettings.value.tiles = Math.max(drawing.width, drawing.height) > 8000 ? 32 : 12
    }
  } catch (cause) {
    if (sequence === attachmentSequence)
      error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (sequence === attachmentSequence) attaching.value = false
  }
}

/** 파일 선택 입력을 도면 준비로 전달하는 첨부 처리 */
const chooseDrawing = (event: Event) => {
  const input = event.target as HTMLInputElement
  void attachDrawing(input.files?.[0])
  input.value = ''
}

/** 클립보드 이미지와 텍스트 입력을 구분하는 도면 붙여넣기 */
const pasteDrawing = (event: ClipboardEvent) => {
  const file = [...(event.clipboardData?.files ?? [])].find((item) =>
    item.type.startsWith('image/'),
  )
  if (file) {
    event.preventDefault()
    void attachDrawing(file)
  }
}

/** 도면 이미지 파일을 받는 드래그 앤 드롭 입력 */
const dropDrawing = (event: DragEvent) => {
  event.preventDefault()
  void attachDrawing(event.dataTransfer?.files[0])
}

watch(
  () => editor.document,
  (next, previous) => {
    const oldPorts = new Map(previous.ports.map((port) => [port.id, port]))
    const portsChanged =
      next.ports.length !== previous.ports.length ||
      next.ports.some((port) => {
        const old = oldPorts.get(port.id)
        return !old || old.x !== port.x || old.y !== port.y
      })
    if (!previous.drawing && !next.drawing && !portsChanged && !sceneSessions.has(next)) return
    sceneSessions.set(previous, facility.captureSession())
    const snapshot = sceneSessions.get(next)
    const baseline =
      next.drawing?.id === previous.drawing?.id ? facility.document : emptyFacilityDocument()
    void nextTick(() => {
      if (editor.document !== next) return
      if (snapshot) {
        internalDrawingChange = true
        facility.restoreSession(snapshot)
        internalDrawingChange = false
      } else if (next.drawing?.objects) {
        try {
          internalDrawingChange = true
          facility.commit((document) => {
            const generated = drawingFacility(
              next,
              baseline,
              next.drawing?.id === previous.drawing?.id ? previous : undefined,
            )
            generated.mapRef.name = editor.sourceName
            Object.assign(document, generated)
          })
          internalDrawingChange = false
          sceneSessions.set(next, facility.captureSession())
        } catch (cause) {
          internalDrawingChange = false
          editor.message = `도면 3D 동기화 실패 · ${cause instanceof Error ? cause.message : String(cause)}`
        }
      }
      if (!snapshot && !next.drawing && portsChanged) {
        const ports = new Map(next.ports.map((port) => [port.id, port]))
        const attached = facility.document.instances.filter(
          (instance) => instance.portId && oldPorts.has(instance.portId),
        )
        if (attached.length) {
          internalDrawingChange = true
          try {
            facility.commit((document) => {
              for (const instance of document.instances) {
                if (!instance.portId) continue
                const old = oldPorts.get(instance.portId),
                  port = ports.get(instance.portId)
                if (!old) continue
                if (!port) {
                  delete instance.portId
                  delete instance.portOffset
                  continue
                }
                const offset = instance.portOffset ?? {
                  x: instance.position.x - old.x,
                  y: instance.position.y - old.y,
                  z: instance.position.z,
                }
                instance.portOffset = offset
                instance.position.x = port.x + offset.x
                instance.position.y = port.y + offset.y
              }
            })
          } finally {
            internalDrawingChange = false
          }
        }
        sceneSessions.set(next, facility.captureSession())
      }
      findings.value = validateDrawingMap(
        next,
        attachment.value?.id === next.drawing?.id ? attachment.value : undefined,
        drawingSettings.value.vehicleWidth,
        drawingSettings.value.clearance,
      )
    })
  },
  { flush: 'sync' },
)

/** 인식 객체를 기존 편집 이력에 반영하는 수동 수정 */
const patchDrawingObject = (id: string, patch: Partial<DrawingObject>) => {
  if (sending.value || props.busy || editor.readOnly) return
  try {
    const updated = patchDrawingObjects(editor.document, [id], () => patch)
    editor.applyComputedMap(updated)
    if (attachment.value?.id === updated.drawing?.id)
      attachment.value!.detections = structuredClone(updated.drawing!.objects ?? [])
    editor.message = `${id} 도면 객체 수정 완료`
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

/** 도면 패널의 작업을 대화 요청으로 연결하는 실행 */
const drawingTask = (message: string) => {
  prompt.value = message
  void handleSendMessage()
}

const history = ref<AssistantHistory[]>([])

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  image?: string
  tasks?: {
    name: string
    state: 'running' | 'waiting' | 'done' | 'error' | 'cancelled'
    summary: string
  }[]
  questions?: {
    question: AgentQuestion
    state: 'waiting' | 'answered' | 'skipped' | 'cancelled'
    summary?: string
  }[]
  state?: 'loading' | 'proposal' | 'applied' | 'cancelled' | 'stale' | 'error'
}

const messages = ref<ChatMessage[]>([])

const conversation = ref<HTMLElement>()

let activeReplyId: string | undefined

const messageStates = {
  loading: '응답 생성 중',
  proposal: '적용 대기',
  applied: '적용 완료',
  cancelled: '취소됨',
  stale: '변경안 해제',
  error: '요청 실패',
}

/**
 * 채팅 목록에 역할과 내용을 추가하는 메시지 생성
 * @param role 사용자와 도우미 및 시스템 역할
 * @param content 표시할 대화 내용
 * @param state 응답과 변경 제안의 현재 상태
 * @returns 추가한 메시지 식별자
 */
const addMessage = (role: ChatMessage['role'], content: string, state?: ChatMessage['state']) => {
  const id = crypto.randomUUID()
  messages.value.push({ id, role, content, state })
  return id
}

/**
 * 기존 응답 메시지의 내용과 작업 상태를 갱신하는 대화 표시
 * @param id 갱신할 메시지 식별자
 * @param content 표시할 응답 내용
 * @param state 응답과 변경 제안의 현재 상태
 */
const updateMessage = (id: string, content: string, state?: ChatMessage['state']) => {
  const message = messages.value.find((item) => item.id === id)
  if (message) Object.assign(message, { content, state })
}

/** DOM 갱신 후 최신 메시지와 변경 목록을 표시하는 대화 스크롤 */
const scrollLatest = async () => {
  await nextTick()
  if (conversation.value) conversation.value.scrollTop = conversation.value.scrollHeight
}

const error = ref('')
const checking = ref(false)
const connected = ref(false)
const models = ref<AssistantModel[]>([])
const modelPickerOpen = ref(false)
const modelError = ref('')
/** 브라우저 저장소 제한을 허용하며 마지막 선택 모델을 복원하는 설정 조회 */
const readSelectedModel = () => {
  try {
    return localStorage.getItem('mgs-ai-model') ?? ''
  } catch {
    return ''
  }
}
const selectedModel = ref(readSelectedModel())
/** 다음 요청의 추론 모델을 선택하고 재실행에도 유지하는 설정 변경 */
const selectModel = (name: string) => {
  selectedModel.value = name
  try {
    localStorage.setItem('mgs-ai-model', name)
  } catch {
    // 저장소 제한 환경에서 현재 실행의 모델 선택을 유지하는 메모리 설정
  }
}
const attachmentType = computed(
  () => pendingAttachment.value?.name.split('.').pop()?.toUpperCase() ?? '이미지',
)
const phase = ref<'idle' | 'running' | 'waiting'>('idle')
const sending = computed(() => phase.value !== 'idle')
const awaiting = shallowRef<{ messageId: string; question: AgentQuestion }>()
let pendingAnswer:
  | {
      questionId: string
      resolve: (answer: AgentAnswer) => void
      reject: (cause: Error) => void
      cleanup: () => void
      continued: () => void
    }
  | undefined
let controller: AbortController | undefined

/** 내부망 AI 서비스의 연결과 모델 준비 상태 확인 */
const connect = async () => {
  checking.value = true
  error.value = ''
  modelError.value = ''
  try {
    const status = await checkAssistant()
    models.value = status.models ?? []
    connected.value = status.ready
    if (!models.value.some((model) => model.name === selectedModel.value))
      selectModel(
        models.value.find((model) => model.name === status.defaultModel)?.name ??
          models.value[0]?.name ??
          '',
      )
  } catch (cause) {
    connected.value = false
    error.value = String(cause instanceof Error ? cause.message : cause)
    modelError.value = error.value
  } finally {
    checking.value = false
  }
}

/** 목록을 열 때 서버의 최신 설치 모델을 조회하는 팝업 열기 */
const openModelPicker = () => {
  modelPickerOpen.value = true
  if (!checking.value) void connect()
}

/** 진행 중인 추론을 취소하고 뒤늦은 응답의 적용을 차단하는 요청 종료 */
const cancel = (reason = '응답 생성을 중단했습니다.') => {
  if (sending.value && activeReplyId) {
    updateMessage(activeReplyId, reason, 'cancelled')
    for (const task of messages.value.find((message) => message.id === activeReplyId)?.tasks ?? [])
      if (task.state === 'running' || task.state === 'waiting') task.state = 'cancelled'
  }
  activeReplyId = undefined
  controller?.abort()
  controller = undefined
  phase.value = 'idle'
}

/** 필요한 작업에서만 원본 도면을 복원하는 첨부 읽기 */
const requireDrawing = async () => {
  if (attachment.value) return attachment.value
  const map = editor.document,
    data = map.drawing ?? map.layout
  if (!data) throw new Error('첨부하거나 불러온 도면이 없습니다.')
  const source = data.sourceImage ?? data.image,
    bytes = Uint8Array.from(atob(source.split(',')[1]), (character) => character.charCodeAt(0))
  const drawing = await prepareDrawing(
    new File([bytes], data.name, { type: source.slice(5, source.indexOf(';')) }),
  )
  Object.assign(drawing, {
    id: data.id,
    width: map.drawing?.width ?? map.layout!.sourceWidth,
    height: map.drawing?.height ?? map.layout!.sourceHeight,
  })
  drawing.detections = structuredClone(map.drawing?.objects ?? [])
  attachment.value = drawing
  return drawing
}
/** 내부 이름 대신 사용자 작업 목적을 표시하는 실행 제목 */
const toolLabel = (name: string) =>
  ({
    ask_user: '사용자 확인',
    search_mgs_training: 'MGS 교육 자료 검색',
    port_approach: '포트 진입 경로 확인 및 설정',
    audit_port_references: '포트 참조 점검',
    edit_selection: '선택 객체 편집',
    subdivide_paths: '노드 간격 적용',
    measure_path: '경로 거리 계산',
    get_map_context: '지도 조회',
    inspect_drawing: '도면 확인',
    layout_drawing: '배경 도면 편집',
    generate_drawing_map: '경로 생성',
    plan_drawing_route: '주행 맵 설계',
    calibrate_drawing: '도면 비율 맞추기',
    recognize_drawing: '시설 인식',
    round_drawing_paths: '곡선 편집',
    validate_drawing: '통로 점검',
    inspect_map: '지도 점검',
    move_nodes: '노드 이동',
    set_path_direction: '경로 방향 편집',
    edit_drawing_objects: '인식 객체 편집',
    place_equipment: '설비 배치',
    edit_map: '지도 객체 편집',
    edit_equipment: '설비 제작',
    history: '편집 이력',
    focus_map: '화면 이동',
  })[name] ?? name
/** 실제 입력값과 선택 이름을 대화에 표시하는 사용자 응답 요약 */
const answerSummary = (question: AgentQuestion, answer: AgentAnswer) => {
  if (answer.status === 'skipped') return question.skipLabel
  if (answer.text) return answer.text
  if (answer.choice)
    return question.choices.find((choice) => choice.id === answer.choice)?.label ?? answer.choice
  return question.fields
    .filter((field) => answer.values[field.id] !== undefined)
    .map((field) => {
      const value = answer.values[field.id],
        selected = Array.isArray(value)
          ? value
              .map((id) => field.options.find((option) => option.id === id)?.label ?? id)
              .join(', ')
          : (field.options.find((option) => option.id === value)?.label ??
            (typeof value === 'boolean' ? (value ? '예' : '아니요') : String(value)))
      return `${field.label}: ${selected}${answer.units[field.id] ? ' ' + answer.units[field.id] : ''}`
    })
    .join(' · ')
}
/** 작업을 유지한 채 비모달 질문 카드의 실제 응답을 기다리는 입력 대기 */
const waitForAnswer = (
  question: AgentQuestion,
  signal: AbortSignal,
  messageId: string,
  continued: () => void,
): Promise<AgentAnswer> =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const message = messages.value.find((message) => message.id === messageId)
    if (!message) {
      reject(new Error('질문을 표시할 대화를 찾지 못했습니다.'))
      return
    }
    message.questions ??= []
    message.questions.push({
      question,
      state: 'waiting' as 'waiting' | 'answered' | 'skipped' | 'cancelled',
      summary: '',
    })
    const record = message.questions.at(-1)!
    const task = message.tasks?.at(-1)
    if (task) task.state = 'waiting'
    message.state = undefined
    message.content = question.reason ?? '작업을 이어가기 위해 확인할 내용이 있습니다.'
    phase.value = 'waiting'
    awaiting.value = { messageId, question }
    /** 중단된 질문과 입력 이벤트를 함께 정리하는 응답 취소 */
    const abort = () => {
      record.state = 'cancelled'
      if (pendingAnswer?.questionId === question.id) {
        pendingAnswer = undefined
        awaiting.value = undefined
      }
      signal.removeEventListener('abort', abort)
      reject(new DOMException('사용자 확인 작업을 중단했습니다.', 'AbortError'))
    }
    pendingAnswer = {
      questionId: question.id,
      resolve,
      reject,
      cleanup: () => signal.removeEventListener('abort', abort),
      continued,
    }
    signal.addEventListener('abort', abort, { once: true })
  })
/** 선택한 답변을 원래 도구 요청으로 전달하며 작업을 다시 진행하는 응답 처리 */
const answerQuestion = (id: string, answer: AgentAnswer) => {
  const waiting = awaiting.value,
    pending = pendingAnswer
  if (!waiting || !pending || waiting.question.id !== id || pending.questionId !== id) return
  if (attaching.value) {
    error.value = '첨부 파일을 준비하고 있습니다. 잠시 후 답변을 보내 주세요.'
    return
  }
  try {
    const checked = validateAgentAnswer(waiting.question, answer)
    const record = messages.value
      .find((message) => message.id === waiting.messageId)
      ?.questions?.find((item) => item.question.id === id)
    const summary = answerSummary(waiting.question, checked)
    if (record) {
      record.state = checked.status === 'skipped' ? 'skipped' : 'answered'
      record.summary = summary
    }
    pending.cleanup()
    pendingAnswer = undefined
    awaiting.value = undefined
    phase.value = 'running'
    error.value = ''
    const answerId = addMessage('user', summary)
    consumeAttachment(answerId)
    pending.continued()
    pending.resolve(checked)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
/** 전송할 첨부를 대화 참조로 옮기며 입력칸의 대기 첨부만 제거하는 전송 처리 */
const consumeAttachment = (messageId: string) => {
  const drawing = pendingAttachment.value
  if (!drawing) return
  attachment.value = drawing
  const message = messages.value.find((message) => message.id === messageId)
  if (message) message.image = drawing.visionImage
  pendingAttachment.value = undefined
}
/** 대기 중인 확인 질문에 답하거나 입력한 메시지로 새 추론 시작 */
const handleSendMessage = async () => {
  const question = prompt.value.trim()
  if (!question || attaching.value) return
  if (awaiting.value) {
    prompt.value = ''
    answerQuestion(awaiting.value.question.id, {
      status: 'answered',
      text: question,
      values: {},
      units: {},
    })
    return
  }
  if (props.busy) return
  await runConversationTurn(question)
}

/**
 * 입력 메시지와 첨부를 기록하고 에이전트 실행 결과를 현재 답변에 반영
 *
 * @param question 입력칸에서 읽은 공백 제거 메시지
 */
const runConversationTurn = async (question: string) => {
  if (controller) cancel('새 메시지를 반영하기 위해 이전 작업을 중단했습니다.')
  const sequence = conversationSequence
  const request = new AbortController()
  controller = request
  phase.value = 'running'
  error.value = ''
  prompt.value = ''
  const userId = addMessage('user', question)
  consumeAttachment(userId)
  /** 추론 시작과 확인 질문 응답 직후에 새 작업 내역을 가진 답변 생성 */
  const createLoadingReply = () => {
    const id = addMessage('assistant', '', 'loading')
    const message = messages.value.find((item) => item.id === id)!
    activeReplyId = id
    message.tasks = []
    return message
  }
  let reply = createLoadingReply()
  let activeTask: NonNullable<ChatMessage['tasks']>[number] | undefined
  const isCurrentRequest = () => controller === request && !request.signal.aborted
  /** 새 지시나 취소 뒤 도착한 이전 진행 표시를 차단하는 상태 갱신 */
  const progress = (message: string) => {
    if (isCurrentRequest()) updateMessage(reply.id, message, 'loading')
  }
  try {
    const answer = await runAgent({
      question,
      model: selectedModel.value || undefined,
      history: history.value,
      signal: request.signal,
      context: () => agentContext(attachment.value),
      ask: (confirmation, signal) =>
        waitForAnswer(confirmation, signal, reply.id, () => {
          reply = createLoadingReply()
        }),
      execute: async (call) => {
        request.signal.throwIfAborted()
        const result = await executeAgentTool(call, request, {
          context: () => agentContext(attachment.value),
          drawing: requireDrawing,
          internal: (value) => {
            internalDrawingChange = value
          },
          generated: () => emit('generated'),
          focus: (point) => emit('focus', point),
          progress,
          findings,
          settings: drawingSettings.value,
        })
        await nextTick()
        return result
      },
      progress,
      step: (name, state, summary) => {
        if (!isCurrentRequest()) return
        if (state === 'running') {
          reply.tasks!.push({ name: toolLabel(name), state, summary: '' })
          activeTask = reply.tasks!.at(-1)
          progress(`${toolLabel(name)} 중…`)
        } else if (activeTask) {
          activeTask.state = state
          activeTask.summary = summary ?? ''
        }
      },
      remember: (conversationHistory) => {
        if (sequence === conversationSequence && (controller === request || !controller))
          history.value = conversationHistory
      },
    })
    if (!isCurrentRequest()) return
    connected.value = true
    updateMessage(reply.id, answer)
  } catch (cause) {
    if (isCurrentRequest())
      updateMessage(reply.id, cause instanceof Error ? cause.message : String(cause), 'error')
  } finally {
    if (controller === request) {
      controller = undefined
      activeReplyId = undefined
      phase.value = 'idle'
    }
  }
}
/** 사용자 직접 편집으로 진행 중인 관찰이 달라진 경우의 작업 취소 */
const invalidate = () => {
  if (!internalDrawingChange)
    cancel('맵이 변경되어 진행 중인 작업을 중단했습니다. 현재 상태에서 이어서 요청할 수 있습니다.')
}
/** 첨부와 대화 이력을 초기화하는 새 대화 */
const newConversation = () => {
  conversationSequence++
  cancel()
  messages.value = []
  history.value = []
  prompt.value = ''
  error.value = ''
  attachmentSequence++
  attachment.value = undefined
  pendingAttachment.value = undefined
  attaching.value = false
}
/** 한글 조합과 줄바꿈을 보존하는 채팅 전송 키 처리 */
const composeKey = (event: KeyboardEvent) => {
  if (event.isComposing || event.keyCode === 229 || event.shiftKey) return
  event.preventDefault()
  void handleSendMessage()
}
watch(() => [editor.document, facility.document, editor.readOnly], invalidate, { flush: 'sync' })
watch(open, (value) => {
  if (value) void connect()
})
watch(
  () => [
    messages.value.map(
      (message) => `${message.content}${message.state}${message.tasks?.map((task) => task.state)}`,
    ),
    sending.value,
    awaiting.value?.question.id,
    open.value,
  ],
  scrollLatest,
  { flush: 'post' },
)
onBeforeUnmount(() => cancel())
</script>
<template>
  <aside
    v-show="open"
    class="assistant-panel flex-column"
    data-testid="ai-assistant"
    aria-label="AI 작업 도우미"
    @keydown.stop
    @paste="pasteDrawing"
    @dragover.prevent
    @drop="dropDrawing"
  >
    <header class="d-flex align-center justify-space-between px-4 py-3 flex-shrink-0">
      <div>
        <strong>
          AI 에이전트
          <span data-testid="ai-selected-model">{{ selectedModel }}</span>
        </strong>
        <span
          class="connection-state d-block"
          :class="{ connected }"
          role="status"
        >
          {{ checking ? '연결 확인 중' : connected ? '사용 가능' : '연결 확인 필요' }}
        </span>
      </div>
      <div class="d-flex ga-1">
        <v-btn
          :icon="[mdiCubeOutline]"
          title="AI 모델 선택"
          aria-label="AI 모델 선택"
          data-testid="ai-models"
          @click="openModelPicker"
        />
        <v-btn
          :icon="[mdiChatPlusOutline]"
          title="새 대화"
          aria-label="새 대화"
          data-testid="ai-new-chat"
          @click="newConversation"
        />

        <v-btn
          :icon="[mdiClose]"
          title="닫기"
          aria-label="AI 대화 닫기"
          @click="open = false"
        />
      </div>
    </header>

    <div
      ref="conversation"
      class="conversation flex-grow-1 pa-4"
      role="log"
      aria-label="AI 대화 내용"
      aria-live="polite"
      aria-relevant="additions text"
      data-testid="ai-conversation"
    >
      <div
        v-if="!messages.length"
        class="empty-chat"
      >
        <strong>어떤 맵 작업을 도와드릴까요?</strong>
        <p class="mt-2">맵을 선택하고 이동하면서 질문하세요.</p>
        <p class="text-caption mt-2">맵 점검 · 노드 이동 · 기존 모델의 포트 배치</p>
      </div>

      <article
        v-for="message in messages"
        :key="message.id"
        class="chat-message mb-4"
        :class="message.role"
        :data-role="message.role"
        :data-state="message.state"
      >
        <span
          v-if="message.role !== 'system'"
          class="message-author d-block mb-1"
        >
          {{ message.role === 'user' ? '나' : 'AI 에이전트' }}
        </span>

        <img
          v-if="message.image"
          :src="message.image"
          alt="첨부한 현장 도면"
          class="drawing-thumbnail mb-2"
        />

        <p
          class="message-content"
          :class="{ 'message-error': message.state === 'error' }"
          :data-testid="
            message.role === 'assistant'
              ? message.state === 'error'
                ? 'ai-error'
                : 'ai-answer'
              : undefined
          "
        >
          {{ message.content || (message.state === 'loading' ? '요청을 분석하고 있습니다…' : '') }}
        </p>

        <AgentQuestionCard
          v-for="record in message.questions ?? []"
          :key="record.question.id"
          :question="record.question"
          :state="record.state"
          :summary="record.summary"
          @answer="answerQuestion(record.question.id, $event)"
          @cancel="cancel()"
        />
        <details
          v-if="message.tasks?.length"
          class="task-log mt-2"
        >
          <summary>작업 내역 {{ message.tasks.length }}건</summary>
          <p
            v-for="(task, index) in message.tasks"
            :key="index"
            class="text-caption mt-2"
          >
            <strong>{{ task.name }}</strong>
            ·
            {{
              task.state === 'cancelled'
                ? '중단됨'
                : task.state === 'waiting'
                  ? '답변 대기'
                  : task.state === 'running'
                    ? '진행 중'
                    : task.state === 'error'
                      ? '확인 필요'
                      : '완료'
            }}
            <span
              v-if="task.summary"
              class="d-block"
            >
              {{ task.summary }}
            </span>
          </p>
        </details>
        <span
          v-if="message.state && message.state !== 'loading'"
          class="message-state text-caption d-block mt-2"
        >
          {{ messageStates[message.state] }}
        </span>
      </article>
    </div>

    <DrawingTools
      v-if="showTools && (attachment || editor.document.drawing)"
      v-model="drawingSettings"
      :map="editor.document"
      :findings="findings"
      :disabled="sending || busy || editor.readOnly"
      @patch="patchDrawingObject"
      @recognize="drawingTask('도면의 설비와 포트 및 문자를 다시 인식해줘')"
      @round="drawingTask('도면 경로의 모서리에 곡선을 만들어줘')"
      @verify="drawingTask('도면 맵의 통로 폭과 설비 간섭을 검사해줘')"
      @focus="emit('focus', $event)"
    />
    <div class="chat-composer px-4 pt-3 pb-4 flex-shrink-0">
      <div
        v-if="error"
        class="connection-error text-caption mb-2"
        role="alert"
      >
        {{ error }}
      </div>

      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        class="d-none"
        data-testid="drawing-file"
        @change="chooseDrawing"
      />

      <div
        v-if="attaching"
        class="text-caption mb-2"
        role="status"
      >
        도면을 준비하고 있습니다…
      </div>

      <div
        v-if="pendingAttachment"
        class="drawing-attachment d-flex align-center ga-3 mb-3 pa-2"
        data-testid="drawing-attachment"
      >
        <img
          v-if="pendingAttachment.visionImage"
          :src="pendingAttachment.visionImage"
          alt="첨부 도면 미리보기"
          class="attachment-preview"
        />
        <VIcon
          v-else
          :icon="[mdiFileImageOutline]"
          size="28"
        />
        <div class="flex-grow-1 overflow-hidden">
          <span
            class="d-block text-truncate text-caption"
            :title="pendingAttachment.name"
          >
            {{ pendingAttachment.name }}
          </span>
          <span class="text-caption text-medium-emphasis">
            {{ attachmentType }} · {{ pendingAttachment.width }} × {{ pendingAttachment.height }}
          </span>
        </div>
      </div>
      <form @submit.prevent="handleSendMessage">
        <textarea
          id="ai-request"
          data-testid="ai-prompt"
          aria-label="AI 메시지 입력"
          rows="3"
          maxlength="4000"
          v-model="prompt"
          :placeholder="
            awaiting
              ? '답변하거나 요청을 바꿔 주세요'
              : sending
                ? '추가 지시를 보내면 현재 작업을 중단하고 반영합니다'
                : '메시지를 입력하세요'
          "
          @keydown.enter="composeKey"
        />
        <div class="d-flex flex-wrap justify-space-between align-center mt-2 ga-2">
          <div class="d-flex ga-1">
            <v-btn
              :icon="[mdiAttachment]"
              title="파일 첨부"
              aria-label="파일 첨부"
              :disabled="(sending && !awaiting) || attaching"
              data-testid="attach-drawing"
              @click="fileInput?.click()"
            />
            <v-btn
              v-if="attachment || pendingAttachment || editor.document.drawing"
              :icon="[mdiImageEditOutline]"
              title="도면 편집 도구"
              aria-label="도면 편집 도구"
              :aria-pressed="showTools"
              @click="showTools = !showTools"
            />
          </div>
          <div class="d-flex ga-1">
            <v-btn
              v-if="sending"
              :icon="[mdiStop]"
              title="작업 중단"
              aria-label="작업 중단"
              data-testid="ai-cancel"
              @click="cancel()"
            />
            <v-btn
              :icon="[mdiSend]"
              title="보내기"
              aria-label="보내기"
              color="primary"
              variant="flat"
              data-testid="ai-send"
              :disabled="!prompt.trim() || (busy && !awaiting) || attaching"
              type="submit"
            />
          </div>
        </div>

        <p class="composer-hint text-caption mt-2">Enter 전송 · Shift + Enter 줄바꿈</p>
      </form>
    </div>
  </aside>
  <AssistantModelPicker
    v-model="modelPickerOpen"
    :models="models"
    :selected="selectedModel"
    :loading="checking"
    :error="modelError"
    @select="selectModel"
  />
</template>

<style scoped lang="scss">
// 맵과 나란히 배치하며 대화 목록만 스크롤하는 비모달 패널 구성
.drawing-thumbnail {
  display: block;
  max-width: 100%;
  max-height: 160px;
  object-fit: contain;
  border-radius: 6px;
  background: white;
}

.drawing-attachment {
  border: 1px solid var(--border);
  border-radius: 8px;
}

.attachment-preview {
  width: 54px;
  height: 54px;
  flex-shrink: 0;
  object-fit: contain;
  border-radius: 6px;
  background: #fff;
}

.assistant-panel {
  display: flex;
  width: clamp(340px, 27vw, 420px);
  flex-shrink: 0;
  min-height: 0;
  color: var(--text);
  background: var(--surface);
  border-left: 1px solid var(--app-border);
  box-shadow: -8px 0 32px color-mix(in srgb, var(--app-background) 24%, transparent);
}

header {
  border-bottom: 1px solid var(--border);
  background: var(--surface-muted);
}

.connection-state {
  font-size: 10px;
  color: var(--text-muted);
}

.connected {
  color: var(--app-success);
}

.connection-state::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 5px;
  border-radius: 50%;
  background: currentColor;
}

.message-author,
.message-state,
.composer-hint {
  color: var(--text-secondary);
}

.conversation {
  line-height: 1.7;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.empty-chat {
  padding-top: 32px;
  color: var(--text-secondary);
}

.chat-message {
  min-width: 0;
}

.chat-message.assistant {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-muted);
}

.chat-message.user {
  margin-left: 28px;
  padding: 10px 12px;
  border-radius: 12px 12px 3px 12px;
  background: var(--accent-soft);
}

.message-author {
  font-size: 10px;
  font-weight: 600;
}

.message-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
}

.chat-message.system {
  color: var(--text-muted);
  font-size: 11px;
}

.message-error,
.connection-error {
  color: var(--app-danger);
}

.chat-composer {
  border-top: 1px solid var(--border);
  background: var(--surface);
}

textarea {
  display: block;
  width: 100%;
  resize: vertical;
  min-height: 78px;
  max-height: 180px;
  padding: 10px 12px;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
}

.task-log {
  color: var(--text-secondary);
  font-size: 12px;
}
.task-log summary {
  cursor: pointer;
}
</style>
