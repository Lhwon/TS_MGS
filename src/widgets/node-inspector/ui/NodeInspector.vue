<!--
/**
 * 파일명: NodeInspector.vue
 * 설명: 선택한 노드의 속성과 경로 및 포트 연결을 편집하는 속성 패널
 * 작성자: 이희원
 * 작성일자: 2026-11-04
 */
-->
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useEditor } from '@/features/map-editor/index.ts'
import { AppIcon } from '@/shared/ui/index.ts'
const emit = defineEmits<{
  focus: [id: number]
}>()
const editor = useEditor()
const tab = ref<'properties' | 'connections'>('properties')
const draft = reactive({ name: '', x: 0, y: 0 })
const changed = computed(
  () =>
    !!editor.selectedNode &&
    (draft.name !== editor.selectedNode.name ||
      Number(draft.x) !== editor.selectedNode.x ||
      Number(draft.y) !== editor.selectedNode.y),
)
const connections = computed(() =>
  editor.document.edges.filter(
    (edge) => edge.from === editor.selectedId || edge.to === editor.selectedId,
  ),
)
const ports = computed(() =>
  editor.document.ports.filter((port) => port.nodeId === editor.selectedId),
)
watch(
  () => editor.selectedNode,
  (node) => {
    if (node) Object.assign(draft, { name: node.name, x: node.x, y: node.y })
  },
  { immediate: true },
)
/**
 * 입력한 노드 이름과 좌표를 저장소에 반영하는 속성 변경 적용
 */
const apply = () => {
  if (editor.selectedId === null || editor.readOnly || !changed.value) return
  try {
    editor.updateNode(editor.selectedId, {
      name: draft.name,
      x: Number(draft.x),
      y: Number(draft.y),
    })
    editor.message = '노드 속성을 적용했습니다. 연결 포트도 함께 이동했습니다.'
  } catch (error) {
    editor.message = error instanceof Error ? error.message : String(error)
  }
}
/**
 * 선택한 노드 식별자를 저장하고 해당 위치로 화면 이동을 요청하는 노드 선택
 *
 * @param id 조회하거나 편집할 대상의 고유 식별자
 */
const select = (id: number) => {
  editor.selectedId = id
  emit('focus', id)
}
</script>
<template>
  <v-sheet
    tag="aside"
    class="inspector-panel d-flex flex-column overflow-hidden"
  >
    <div class="panel-title d-flex align-center justify-space-between flex-shrink-0 py-0 px-5">
      <h2>속성 검사기</h2>
      <AppIcon
        name="panel"
        :size="17"
      />
      <v-btn
        size="small"
        variant="text"
        data-testid="edit-map-objects"
        @click="editor.objectEditor = 'ports'"
        >객체 편집</v-btn
      >
    </div>
    <template v-if="editor.selectedNode">
      <div class="selection-card d-flex align-center">
        <div class="selection-glyph flex-shrink-0">
          <AppIcon
            name="node"
            :size="25"
          />
        </div>
        <div>
          <small>SELECTED NODE</small
          ><strong data-testid="selected-name">{{
            editor.selectedNode.name || `N${editor.selectedId}`
          }}</strong>
        </div>
        <span class="selection-id ml-auto">#{{ editor.selectedId }}</span>
      </div>
      <div
        class="inspector-tabs d-flex py-0 px-5"
        role="tablist"
        aria-label="노드 상세 정보"
      >
        <v-btn
          id="properties-tab"
          role="tab"
          :aria-selected="tab === 'properties'"
          aria-controls="node-detail"
          :class="{ active: tab === 'properties' }"
          @click="tab = 'properties'"
        >
          기본 속성</v-btn
        ><v-btn
          id="connections-tab"
          role="tab"
          :aria-selected="tab === 'connections'"
          aria-controls="node-detail"
          :class="{ active: tab === 'connections' }"
          data-testid="connections-tab"
          @click="tab = 'connections'"
        >
          연결 정보<span>{{ connections.length }}</span>
        </v-btn>
      </div>
      <div
        id="node-detail"
        class="inspector-content overflow-y-auto"
        role="tabpanel"
        :aria-labelledby="tab === 'properties' ? 'properties-tab' : 'connections-tab'"
      >
        <form
          v-if="tab === 'properties'"
          class="properties-form"
          @submit.prevent="apply"
        >
          <div class="section-heading d-flex align-center justify-space-between mb-4">
            <h3>기본 정보</h3>
            <span
              v-if="changed"
              class="draft-badge"
              >미적용 변경</span
            >
          </div>
          <label
            >노드 이름<input
              v-model="draft.name"
              maxlength="300"
              :disabled="
                editor.readOnly || !!editor.legacySource || editor.sourceName.endsWith('.jmapx')
              "
              data-testid="node-name"
          /></label>
          <label
            >노드 ID
            <div class="locked-input position-relative">
              <input
                :value="editor.selectedId"
                disabled
              /><AppIcon
                name="lock"
                :size="14"
              /></div
          ></label>
          <div
            v-if="editor.selectedNode.realId !== undefined"
            class="legacy-identifiers mt-5"
          >
            <div>
              <span>Real ID</span
              ><strong data-testid="real-id">{{ editor.selectedNode.realId }}</strong>
            </div>
            <div>
              <span>Unique ID</span
              ><strong data-testid="unique-id">{{ editor.selectedNode.uid ?? '—' }}</strong>
            </div>
            <div>
              <span>노드 종류</span
              ><strong>{{
                editor.selectedNode.curve
                  ? '곡선 보간'
                  : editor.selectedNode.virtual
                    ? '가상 노드'
                    : '일반 노드'
              }}</strong>
            </div>
            <div>
              <span>Property</span><strong>{{ editor.selectedNode.property ?? 0 }}</strong>
            </div>
          </div>
          <div
            class="section-heading position-heading d-flex align-center justify-space-between mb-4"
          >
            <h3>위치 좌표</h3>
            <span class="unit-tag">{{ editor.document.units }}</span>
          </div>
          <label class="coordinate-field"
            ><span class="coordinate-symbol x-symbol position-absolute">X</span
            ><input
              v-model.number="draft.x"
              type="number"
              step="10"
              required
              aria-label="X 좌표"
              :disabled="editor.readOnly"
              data-testid="node-x"
            /><span class="coordinate-unit position-absolute">{{
              editor.document.units
            }}</span></label
          >
          <label class="coordinate-field"
            ><span class="coordinate-symbol y-symbol position-absolute">Y</span
            ><input
              v-model.number="draft.y"
              type="number"
              step="10"
              required
              aria-label="Y 좌표"
              :disabled="editor.readOnly"
              data-testid="node-y"
            /><span class="coordinate-unit position-absolute">{{
              editor.document.units
            }}</span></label
          >
          <p class="field-help d-flex align-center">
            <AppIcon
              name="target"
              :size="13"
            />좌표를 입력한 뒤 변경 사항을 적용합니다.
          </p>
          <v-btn
            type="submit"
            class="apply-button w-100"
            :disabled="editor.readOnly || !changed"
            data-testid="apply"
          >
            <AppIcon
              name="check"
              :size="16"
            />변경 사항 적용<span>↵</span>
          </v-btn>
          <div class="node-statistics">
            <div>
              <strong>{{ connections.length }}</strong
              ><span>연결 경로</span>
            </div>
            <div>
              <strong>{{ ports.length }}</strong
              ><span>연결 포트</span>
            </div>
          </div>
        </form>
        <div
          v-else
          class="connection-details"
        >
          <div class="section-heading d-flex align-center justify-space-between mb-4">
            <h3>연결 경로</h3>
            <span>{{ connections.length }}개</span>
          </div>
          <v-btn
            v-for="edge in connections.slice(0, 40)"
            :key="edge.id"
            class="connection-row w-100 d-flex align-center"
            @click="select(edge.from === editor.selectedId ? edge.to : edge.from)"
          >
            <span class="path-dot"></span><strong>N{{ edge.from }}</strong
            ><AppIcon
              name="arrow"
              :size="14"
            /><strong>N{{ edge.to }}</strong
            ><AppIcon
              name="chevron"
              :size="13"
            />
          </v-btn>
          <p
            v-if="!connections.length"
            class="muted-copy"
          >
            연결된 경로가 없습니다.
          </p>
          <p
            v-if="connections.length > 40"
            class="muted-copy"
          >
            상위 40개 연결을 표시합니다.
          </p>
          <div
            class="section-heading position-heading d-flex align-center justify-space-between mb-4"
          >
            <h3>연결 포트</h3>
            <span>{{ ports.length }}개</span>
          </div>
          <div
            v-for="port in ports"
            :key="port.id"
            class="connected-port d-flex align-center"
          >
            <AppIcon
              name="port"
              :size="17"
            />
            <div>
              <strong>{{ port.id }}</strong
              ><small>{{ port.name }}</small>
            </div>
          </div>
          <p
            v-if="!ports.length"
            class="muted-copy"
          >
            연결된 포트가 없습니다.
          </p>
        </div>
      </div>
    </template>
    <div
      v-else
      class="inspector-empty d-flex flex-column align-center text-center"
    >
      <div class="empty-illustration position-relative mb-6">
        <AppIcon
          name="select"
          :size="31"
        /><span></span><i></i>
      </div>
      <h3>선택한 노드가 없습니다</h3>
      <p>지도 또는 객체 목록에서 노드를 선택하면<br />이곳에서 속성을 편집할 수 있습니다.</p>
      <span class="empty-shortcut d-flex align-center"><kbd>V</kbd>선택 도구</span>
    </div>
    <div class="inspector-tip d-flex mt-auto flex-shrink-0">
      <AppIcon
        :name="editor.readOnly ? 'lock' : 'help'"
        :size="17"
      />
      <div>
        <strong>{{
          editor.readOnly
            ? '기존 지도 미리보기'
            : editor.tool === 'connect'
              ? '노드를 순서대로 선택하세요'
              : '연결 관계를 유지합니다'
        }}</strong>
        <p>
          {{
            editor.readOnly
              ? '원본 파일은 수정하지 않습니다. 곡선과 제어 속성의 이전은 진행 중입니다.'
              : editor.tool === 'connect'
                ? '시작 노드와 도착 노드를 클릭하면 단방향 경로가 생성됩니다.'
                : '노드를 이동하면 연결 경로와 포트의 위치가 함께 갱신됩니다.'
          }}
        </p>
      </div>
    </div>
  </v-sheet>
</template>

<style scoped lang="scss">
// 화면 구성과 고유 시각 요소에 필요한 컴포넌트 전용 스타일

input {
  font: inherit;
}
input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
input {
  width: 100%;
  min-width: 0;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 10px 12px;
}
input:focus {
  border-color: var(--accent);
}
input:disabled {
  background: var(--surface-muted);
  color: var(--text-muted);
}
input[type='checkbox'] {
  accent-color: var(--accent);
  width: 14px;
  height: 14px;
  cursor: pointer;
}
strong {
  font-weight: 600;
}
kbd {
  font: 10px var(--font-mono);
  border: 1px solid var(--border);
  background: var(--surface-muted);
  border-radius: 4px;
  padding: 3px 5px;
  white-space: nowrap;
  color: var(--text-secondary);
}
.inspector-panel {
  background: var(--surface);
  min-height: 0;
}
.inspector-panel {
  border-left: 1px solid var(--border);
}
.panel-title {
  height: 58px;
}
.panel-title h2 {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.3px;
}
.panel-title > svg {
  color: var(--text-secondary);
}
.legacy-identifiers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 13px 8px;
  padding: 13px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}
.legacy-identifiers span {
  display: block;
  color: var(--text-secondary);
  font-size: 9px;
  margin-bottom: 5px;
}
.legacy-identifiers strong {
  font: 11px var(--font-mono);
  color: var(--text-secondary);
}
.selection-card {
  gap: 11px;
  padding: 17px 20px 22px;
}
.selection-glyph {
  height: 42px;
  width: 42px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
  display: grid;
  place-items: center;
}
.selection-card small {
  display: block;
  font-size: 8px;
  letter-spacing: 1px;
  color: var(--text-secondary);
}
.selection-card strong {
  display: block;
  font: 600 21px var(--font-mono);
  margin-top: 5px;
  color: var(--text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 142px;
}
.selection-id {
  padding: 4px 6px;
  border-radius: 4px;
  background: var(--surface);
  color: var(--text-secondary);
  font: 10px var(--font-mono);
}
.inspector-tabs {
  gap: 15px;
  border-bottom: 1px solid var(--border);
}
.inspector-tabs button {
  border-radius: 0;
  border-bottom: 2px solid transparent;
  font-size: 11px;
  color: var(--text-secondary);
  padding: 0 0 12px;
  gap: 6px;
}
.inspector-tabs button.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}
.inspector-tabs button:hover:not(:disabled) {
  background: none;
  color: var(--accent);
}
.inspector-tabs button :deep(.v-btn__content) > span {
  font: 9px var(--font-mono);
  background: var(--surface);
  border-radius: 4px;
  padding: 2px 5px;
}
.inspector-content {
  flex: 1;
  min-height: 0;
  padding: 21px 20px;
}
.section-heading h3 {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 600;
}
.section-heading > span {
  color: var(--text-secondary);
  font-size: 10px;
}
.section-heading .draft-badge {
  font-size: 9px;
  color: var(--text-secondary);
  background: var(--surface);
  padding: 3px 6px;
  border-radius: 4px;
}
.properties-form > label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 17px;
  font-size: 11px;
  color: var(--text-secondary);
}
.properties-form input {
  height: 38px;
  font-size: 12px;
}
.locked-input svg {
  position: absolute;
  right: 11px;
  top: 12px;
  color: var(--text-secondary);
}
.position-heading {
  margin-top: 28px;
}
.unit-tag {
  background: var(--surface);
  padding: 3px 5px;
  border-radius: 3px;
  font-family: var(--font-mono);
}
.properties-form .coordinate-field {
  display: flex;
  flex-direction: row;
  gap: 0;
  align-items: center;
  position: relative;
  margin-bottom: 10px;
}
.coordinate-field input {
  padding-left: 38px;
  padding-right: 48px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.coordinate-symbol {
  left: 12px;
  top: 12px;
  font: 11px var(--font-mono);
  width: 18px;
  border-right: 1px solid var(--border);
  pointer-events: none;
}
.x-symbol {
  color: var(--app-danger);
}
.y-symbol {
  color: var(--app-success);
}
.coordinate-unit {
  right: 27px;
  font: 9px var(--font-mono);
  color: var(--text-secondary);
  pointer-events: none;
}
.field-help {
  gap: 5px;
  font-size: 9px;
  color: var(--text-secondary);
  margin: 12px 0 23px;
}
.apply-button {
  height: 38px;
  background: var(--accent-soft);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}
.apply-button:not(:disabled):hover {
  background: var(--surface-muted);
}
.apply-button:disabled {
  opacity: 0.65;
  color: var(--text-secondary);
  background: var(--surface);
  border-color: var(--border);
}
.apply-button :deep(.v-btn__content) > span {
  margin-left: auto;
  margin-right: 7px;
  color: var(--text-secondary);
}
.apply-button :deep(.v-btn__content) > svg {
  margin-left: 9px;
}
.node-statistics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin-top: 25px;
  padding-top: 21px;
  border-top: 1px solid var(--border);
}
.node-statistics > div {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}
.node-statistics > div + div {
  border-left: 1px solid var(--border);
}
.node-statistics strong {
  font: 19px var(--font-mono);
  color: var(--text-secondary);
}
.node-statistics span {
  color: var(--text-secondary);
  font-size: 9px;
}
.connection-row {
  gap: 10px;
  padding: 11px 6px;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  color: var(--text-secondary);
}
.connection-row strong {
  font: 11px var(--font-mono);
}
.connection-row > svg:last-child {
  margin-left: auto;
  color: var(--text-secondary);
}
.path-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent-fill);
}
.connected-port {
  gap: 9px;
  padding: 10px 5px;
  color: var(--text-secondary);
}
.connected-port strong {
  font: 11px var(--font-mono);
  display: block;
  color: var(--text-secondary);
}
.connected-port small {
  display: block;
  font-size: 9px;
  color: var(--text-secondary);
  margin-top: 4px;
}
.muted-copy {
  color: var(--text-secondary);
  font-size: 11px;
  padding: 10px 0;
}
.inspector-empty {
  flex: 1;
  padding: 90px 15px 25px;
}
.empty-illustration {
  height: 74px;
  width: 74px;
  display: grid;
  place-items: center;
  background: var(--surface);
  border-radius: 20px;
  color: var(--text-secondary);
}
.empty-illustration span {
  position: absolute;
  inset: 14px;
  border: 1px dashed var(--border);
  border-radius: 5px;
}
.empty-illustration > svg {
  position: relative;
  z-index: 1;
  transform: translate(9px, 8px);
  filter: none;
}
.empty-illustration i {
  width: 5px;
  height: 5px;
  position: absolute;
  top: 12px;
  left: 12px;
  background: var(--surface-muted);
  border: 1px solid white;
}
.inspector-empty h3 {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
}
.inspector-empty p {
  font-size: 11px;
  line-height: 1.9;
  color: var(--text-secondary);
  margin-top: 11px;
}
.empty-shortcut {
  gap: 7px;
  margin-top: 23px;
  color: var(--text-secondary);
  font-size: 10px;
}
.empty-shortcut kbd {
  color: var(--text-secondary);
}
.inspector-tip {
  gap: 9px;
  padding: 18px 20px;
  background: var(--surface);
  border-top: 1px solid var(--border);
}
.inspector-tip > svg {
  color: var(--text-secondary);
  flex-shrink: 0;
  margin-top: 1px;
}
.inspector-tip strong {
  font-size: 10px;
  color: var(--text-secondary);
  font-weight: 500;
}
.inspector-tip p {
  font-size: 10px;
  color: var(--text-secondary);
  line-height: 1.8;
  margin-top: 6px;
}
@media (max-width: 1330px) {
  .selection-card {
    padding-left: 17px;
    padding-right: 17px;
  }
  .selection-card strong {
    max-width: 125px;
  }
}
@media (max-height: 800px) {
  .inspector-tip {
    padding-top: 12px;
    padding-bottom: 12px;
  }
  .position-heading {
    margin-top: 19px;
  }
  .properties-form > label {
    margin-bottom: 12px;
  }
  .inspector-content {
    padding-top: 16px;
  }
  .node-statistics {
    margin-top: 17px;
    padding-top: 15px;
  }
}
</style>
