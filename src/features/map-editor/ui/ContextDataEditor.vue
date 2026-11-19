<!--
/**
 * 파일명: ContextDataEditor.vue
 * 설명: 우클릭한 노드 또는 포트의 원본 부가 데이터를 편집하고 내보내는 창
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VTextarea } from 'vuetify/components/VTextarea'
import { useEditor } from '@/features/map-editor/model/editor.ts'
import {
  nativeInteger,
  patchRouteSetting,
  patchScheduleGroup,
  readRouteSetting,
  readScheduleGroups,
  type RouteSettingKey,
} from '@/features/map-editor/model/contextFiles.ts'
import { downloadJson } from '@/shared/lib/files/index.ts'

const target = defineModel<{ nodeId: number } | { portId: string }>()
const editor = useEditor()
const fileInput = ref<HTMLInputElement>()
const contents = ref<{ route?: string; schedule?: string }>({})
const error = ref('')
const previous = ref<number>()
const next = ref<number>()
const routeType = ref(1)
const section = ref(0)
const commandIndex = ref(0)
const routeValues = ref<string[]>([])
const commands = ref<string[][]>([])
const mode = computed(() => (target.value && 'portId' in target.value ? 'schedule' : 'route'))
const fileName = computed(() =>
  mode.value === 'route' ? 'conn_path_setting.data' : 'scmd_group.dat',
)
const content = computed(() => contents.value[mode.value])
const node = computed(() => {
  const current = target.value
  return current && 'nodeId' in current
    ? editor.document.nodes.find((item) => item.id === current.nodeId)
    : undefined
})
const port = computed(() => {
  const current = target.value
  return current && 'portId' in current
    ? editor.document.ports.find((item) => item.id === current.portId)
    : undefined
})
const routeTypes = [
  { title: '진입 제한 사이트 코드', value: 1 },
  { title: '스핀턴', value: 2 },
  { title: 'ODS', value: 3 },
  { title: '예비 설정', value: 99 },
]
const scheduleTypes = ['Load Right', 'Unload Opposite', 'Wait', 'Rotate']
const commandLabels = [
  '명령 ID',
  '명령 종류 코드',
  '각도',
  '노드 UID',
  '노드 Real ID',
  '거리 mm',
  '높이 인덱스',
  '캐리어 장착',
  '역진입 확인',
  '출발 메시지 전송',
]
/** 양방향 경로의 반대 방향을 포함해 연결 경로 후보 UID를 구하는 처리 */
const neighborOptions = (incoming: boolean) => {
  const id = node.value?.id
  const adjacent = new Set<number>()
  for (const edge of editor.document.edges) {
    const from = incoming ? edge.to : edge.from
    const to = incoming ? edge.from : edge.to
    if (from === id) adjacent.add(to)
    if (to === id && edge.direction === 1) adjacent.add(from)
  }
  return editor.document.nodes
    .filter((item) => adjacent.has(item.id))
    .map((item) => ({
      title: `N${item.id} · UID ${item.uid ?? item.id}`,
      value: item.uid ?? item.id,
    }))
}
const incoming = computed(() => neighborOptions(true))
const outgoing = computed(() => [...neighborOptions(false), { title: '진출 노드 없음', value: 0 }])
const routeKey = computed<RouteSettingKey | undefined>(() => {
  if (!node.value || previous.value === undefined || next.value === undefined) return
  return [routeType.value, previous.value, node.value.uid ?? node.value.id, next.value]
})
const routeLabels = computed(() => {
  if (routeType.value === 1) return ['제한 사이트 코드 목록']
  if (routeType.value === 2) return ['스핀턴 종류 코드', '스핀턴 속도', '허용 각도']
  return Array.from(
    { length: 8 },
    (_, index) => `${routeType.value === 3 ? 'ODS' : '예비 설정'} ${index + 1}`,
  )
})
const selectedCommand = computed(() => commands.value[commandIndex.value])
const commandOptions = computed(() =>
  commands.value.map((row, index) => ({
    title: `${index + 1} · ID ${row[0]} · 종류 ${row[1]}`,
    value: index,
  })),
)

watch(target, () => {
  previous.value = incoming.value[0]?.value
  next.value = outgoing.value[0]?.value
  error.value = ''
})
watch([routeKey, content, port, section], () => {
  error.value = ''
  try {
    if (mode.value === 'route') {
      const stored = routeKey.value ? readRouteSetting(content.value ?? '', routeKey.value) : []
      routeValues.value =
        routeType.value === 1
          ? [stored.slice(1).join(', ')]
          : routeLabels.value.map((_, index) =>
              String(stored[index] ?? (routeType.value === 3 ? 1 : 0)),
            )
    } else {
      commands.value =
        port.value?.uid === undefined
          ? []
          : (readScheduleGroups(content.value)[section.value]?.get(port.value.uid) ?? [])
      commandIndex.value = 0
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
})

/** 기존 원본 부가 파일을 불러와 다른 대상의 설정을 편집 세션에 보존 */
const importFile = async (event: Event) => {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  const kind = mode.value
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    if (kind === 'schedule') readScheduleGroups(text)
    contents.value[kind] = text
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
/** 부가 파일이 없는 프로젝트에서 원본 형식의 빈 설정을 준비 */
const createFile = () => {
  contents.value[mode.value] = mode.value === 'route' ? '' : '0\t\r\n'.repeat(4)
}
/** 선택 그룹의 다음 명령 ID로 편집 가능한 원본 명령 행 생성 */
const addCommand = () => {
  const id = Math.max(0, ...commands.value.map((row) => Number(row[0]))) + 1
  commands.value.push([String(id), '0', '0', '-1', '-1', '0', '0', '0', '0', '0', '0'])
  commandIndex.value = commands.value.length - 1
}
/** 선택한 명령을 제거하고 앞선 명령을 선택 */
const removeCommand = () => {
  commands.value.splice(commandIndex.value, 1)
  commandIndex.value = Math.max(0, commandIndex.value - 1)
}
/** 기존 상위 메시지를 기능 식별자와 메시지 식별자 및 응답 여부로 편집 */
const setMessages = (value: string) => {
  const command = selectedCommand.value
  if (!command) return
  const messages = value.split(/\r?\n/).filter((row) => row.trim())
  command.splice(
    10,
    command.length,
    String(messages.length),
    ...messages.flatMap((row) => row.split('\t')),
  )
}
/** 현재 작업의 대상만 갱신한 원본 부가 파일 사본을 저장 */
const save = (remove = false) => {
  if (content.value === undefined || editor.readOnly) return
  try {
    if (mode.value === 'route') {
      if (!routeKey.value) throw new Error('진입과 진출 경로를 확인하세요.')
      const values = remove
        ? []
        : (routeType.value === 1
            ? (routeValues.value[0]
                ?.split(',')
                .map((value) => value.trim())
                .filter(Boolean) ?? [])
            : routeValues.value
          ).map(nativeInteger)
      contents.value.route = patchRouteSetting(content.value, routeKey.value, values)
    } else {
      if (port.value?.uid === undefined) throw new Error('원본 포트 UID가 필요합니다.')
      contents.value.schedule = patchScheduleGroup(
        content.value,
        section.value,
        port.value.uid,
        commands.value,
      )
    }
    downloadJson(contents.value[mode.value]!, fileName.value)
    editor.message = `${fileName.value} 내보내기 완료`
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
</script>

<template>
  <v-dialog
    :model-value="!!target"
    max-width="720"
    @update:model-value="target = undefined"
  >
    <v-card :title="mode === 'route' ? '연결 경로 설정' : '포트 SCMD 그룹'">
      <v-card-text class="d-flex flex-column ga-3">
        <div class="d-flex align-center flex-wrap ga-2">
          <v-btn
            variant="tonal"
            @click="fileInput?.click()"
          >
            기존 {{ fileName }} 열기
          </v-btn>
          <v-btn
            v-if="content === undefined"
            variant="text"
            @click="createFile"
          >
            빈 파일로 시작
          </v-btn>
          <input
            ref="fileInput"
            type="file"
            :accept="mode === 'route' ? '.data' : '.dat'"
            class="d-none"
            @change="importFile"
          />
        </div>
        <template v-if="mode === 'route'">
          <div class="d-flex flex-wrap ga-2">
            <v-select
              v-model="previous"
              label="진입 노드"
              :items="incoming"
              hide-details
            />
            <v-text-field
              :model-value="node ? `N${node.id} · UID ${node.uid ?? node.id}` : ''"
              label="현재 노드"
              readonly
              hide-details
            />
            <v-select
              v-model="next"
              label="진출 노드"
              :items="outgoing"
              hide-details
            />
          </div>
          <v-select
            v-model="routeType"
            label="설정 종류"
            :items="routeTypes"
            hide-details
          />
          <div class="context-data-fields">
            <v-text-field
              v-for="(label, index) in routeLabels"
              :key="label"
              v-model="routeValues[index]"
              :label="label"
              :type="routeType === 1 ? 'text' : 'number'"
              :placeholder="routeType === 1 ? '쉼표로 구분' : undefined"
              :readonly="editor.readOnly"
              hide-details
            />
          </div>
        </template>
        <template v-else>
          <p>포트 {{ port?.id }} · UID {{ port?.uid ?? '미지정' }}</p>
          <v-select
            v-model="section"
            label="SCMD 종류"
            :items="scheduleTypes.map((title, value) => ({ title, value }))"
            hide-details
          />
          <div class="d-flex flex-wrap align-center ga-2">
            <v-select
              v-model="commandIndex"
              label="명령 순서"
              :items="commandOptions"
              hide-details
            />
            <v-btn
              :disabled="editor.readOnly || content === undefined"
              @click="addCommand"
            >
              명령 추가
            </v-btn>
            <v-btn
              :disabled="editor.readOnly || !selectedCommand"
              @click="removeCommand"
            >
              명령 삭제
            </v-btn>
          </div>
          <template v-if="selectedCommand">
            <div class="context-data-fields">
              <v-text-field
                v-for="(label, index) in commandLabels"
                :key="label"
                v-model="selectedCommand[index]"
                :label="label"
                type="number"
                :readonly="editor.readOnly"
                hide-details
              />
            </div>
            <v-textarea
              :model-value="
                Array.from({ length: Number(selectedCommand[10]) }, (_, index) =>
                  selectedCommand!.slice(11 + index * 3, 14 + index * 3).join('\t'),
                ).join('\n')
              "
              label="상위 메시지"
              variant="outlined"
              density="compact"
              hint="한 줄에 기능 ID, 메시지 ID, 응답 여부를 탭으로 구분"
              persistent-hint
              :readonly="editor.readOnly"
              rows="2"
              @change="setMessages($event.target.value)"
            />
          </template>
        </template>
        <p
          v-if="error"
          role="alert"
          class="text-error"
        >
          {{ error }}
        </p>
      </v-card-text>
      <v-card-actions>
        <v-btn
          v-if="mode === 'route'"
          :disabled="editor.readOnly || content === undefined || !routeKey"
          color="error"
          variant="text"
          @click="save(true)"
        >
          이 설정 삭제 후 내보내기
        </v-btn>
        <v-spacer />
        <v-btn @click="target = undefined">닫기</v-btn>
        <v-btn
          :disabled="
            editor.readOnly ||
            content === undefined ||
            (mode === 'route' ? !routeKey : port?.uid === undefined)
          "
          color="primary"
          @click="save()"
        >
          파일 내보내기
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.context-data-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}
</style>
