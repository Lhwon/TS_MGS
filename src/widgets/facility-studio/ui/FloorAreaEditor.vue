<!--
 * 파일명: FloorAreaEditor.vue
 * 설명: 작업자가 바닥 영역의 재질과 패턴 및 중첩 순서를 편집하는 속성 패널
 * 작성자: 이희원
 * 작성일자: 2026-11-19
-->
<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { floorMaterials, readSceneResource, registerFloorTexture, type FloorArea, type FloorMaterial, type SceneResource } from '@/entities/facility/index.ts'

const props = defineProps<{ areas: FloorArea[]; selected?: FloorArea; busy: boolean }>()
const emit = defineEmits<{
  select: [id: string]
  apply: [area: FloorArea]
  order: [offset: number]
  remove: []
  redraw: []
  modelFile: [file: File]
}>()

/** 선택 바닥 이미지와 파일 등록 상태 관리 */
const texture = shallowRef<SceneResource>()
const textureName = ref('')
const fileInput = ref<HTMLInputElement>()
const importing = ref(false)
const importError = ref('')
const previewUrl = ref('')
const locked = computed(() => props.busy || importing.value)
const registeredImages = computed(() => [...new Map(props.areas.flatMap((area) =>
  area.texture ? [[area.texture.hash, { texture: area.texture, name: area.textureName || area.name }] as const] : [],
)).values()])

const form = reactive({
  name: '',
  material: 'concrete' as FloorMaterial,
  color: '#9b9a94',
  repeatMm: 1000,
  rotation: 0,
})
const index = computed(() => props.areas.findIndex((area) => area.id === props.selected?.id))
watch(
  () => props.selected,
  (area) => {
    if (!area) return
    const { name, material, color, repeatMm, rotation } = area
    Object.assign(form, { name, material, color, repeatMm, rotation })
    texture.value = area.texture
    textureName.value = area.textureName ?? ''
    importError.value = ''
  },
  { immediate: true },
)

/** 재질을 변경하면 해당 재질의 기본 색상과 반복 치수로 시작 */
const setMaterial = (event: Event) => {
  const material = (event.target as HTMLSelectElement).value as FloorMaterial
  const { color, repeatMm } = floorMaterials[material]
  Object.assign(form, { material, color: texture.value ? form.color : color, repeatMm: texture.value ? form.repeatMm : repeatMm })
}

/** 기존 경계와 사용자 이미지를 보존하고 표면 마감 및 반복 설정 적용 */
const apply = () => {
  if (!props.selected) return
  const area = { ...props.selected, ...form }
  delete area.texture
  delete area.textureName
  if (texture.value) {
    area.texture = texture.value
    area.textureName = textureName.value
  }
  emit('apply', area)
}

/** 등록된 프로젝트 이미지를 다른 바닥에 재사용하거나 기본 패턴으로 복원 */
const selectImage = (event: Event) => {
  const selected = registeredImages.value.find((item) => item.texture.hash === (event.target as HTMLSelectElement).value)
  texture.value = selected?.texture
  textureName.value = selected?.name ?? ''
  if (selected) form.color = '#ffffff'
  apply()
}

/** 사용자 파일을 이미지 재질 또는 기존 삼차원 바닥 모델 등록으로 분기 */
const importFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !props.selected || locked.value) return
  importError.value = ''
  if (/\.glb$/i.test(file.name)) {
    emit('modelFile', file)
    return
  }
  const areaId = props.selected.id
  importing.value = true
  try {
    const resource = await registerFloorTexture(file)
    if (props.selected?.id !== areaId) return
    texture.value = resource
    textureName.value = file.name.slice(0, 300)
    form.color = '#ffffff'
    apply()
  } catch (cause) {
    importError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    importing.value = false
  }
}

/** 바닥 이미지 미리보기의 이전 요청 취소와 임시 주소 해제 */
watch(texture, async (reference, _, cleanup) => {
  previewUrl.value = ''
  if (!reference) return
  let cancelled = false
  let url = ''
  cleanup(() => {
    cancelled = true
    if (url) URL.revokeObjectURL(url)
  })
  try {
    const bytes = await readSceneResource(reference)
    if (!cancelled) previewUrl.value = url = URL.createObjectURL(new Blob([bytes]))
  } catch {
    if (!cancelled) importError.value = '등록된 바닥 이미지를 읽을 수 없습니다.'
  }
}, { immediate: true })
</script>

<template>
  <section
    v-if="areas.length"
    aria-label="바닥 영역 편집"
    data-testid="floor-editor"
  >
    <h2>
      바닥 영역
      <small data-testid="floor-count">{{ areas.length }}</small>
    </h2>
    <select
      class="w-100 mb-3"
      aria-label="편집할 바닥 영역"
      data-testid="floor-select"
      :value="selected?.id ?? ''"
      :disabled="locked"
      @change="emit('select', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">편집할 바닥 선택</option>
      <option
        v-for="area in [...areas].reverse()"
        :key="area.id"
        :value="area.id"
      >
        {{ area.name }}
      </option>
    </select>
    <form
      v-if="selected"
      class="d-flex flex-column ga-2 mb-3"
      @submit.prevent="apply"
    >
      <!-- 사용자 바닥 파일 등록과 프로젝트 이미지 재사용 구성 -->
      <input ref="fileInput" type="file" accept=".png,.jpg,.jpeg,.webp,.bmp,.gif,.avif,.glb" hidden
        data-testid="floor-file" :disabled="locked" @change="importFile" />
      <v-btn type="button" text="바닥 파일 등록" data-testid="floor-file-register" :disabled="locked" :loading="importing" @click="fileInput?.click()" />
      <small>이미지: PNG · JPG · WEBP · BMP · GIF · AVIF, 최대 12MB</small>
      <small>이미지는 최대 4096px의 정적 WebP로 저장, GLB는 별도 바닥 모델로 배치</small>
      <label v-if="registeredImages.length" class="d-flex flex-column ga-1">
        등록된 바닥 이미지
        <select data-testid="floor-texture" :value="texture?.hash ?? ''" :disabled="locked" @change="selectImage">
          <option value="">기본 재질 패턴</option>
          <option v-for="image in registeredImages" :key="image.texture.hash" :value="image.texture.hash">{{ image.name }}</option>
        </select>
      </label>
      <img v-if="previewUrl" :src="previewUrl" alt="등록한 바닥 이미지 미리보기" class="floor-texture-preview" />
      <small v-if="textureName" class="text-truncate" :title="textureName" data-testid="floor-texture-name">{{ textureName }}</small>
      <p v-if="importError" role="alert">{{ importError }}</p>
      <label>
        영역 이름
        <v-text-field
          v-model="form.name"
          data-testid="floor-name"
          maxlength="300"
          required
          :disabled="busy"
        />
      </label>
      <label class="d-flex flex-column ga-1">
        표면 마감
        <select
          :value="form.material"
          data-testid="floor-material"
          :disabled="busy"
          @change="setMaterial"
        >
          <option
            v-for="(preset, material) in floorMaterials"
            :key="material"
            :value="material"
          >
            {{ preset.label }}
          </option>
        </select>
      </label>
      <label class="d-flex align-center justify-space-between">
        색상
        <input
          v-model="form.color"
          type="color"
          :disabled="busy"
        />
      </label>
      <div class="d-flex ga-2">
        <label class="flex-1-1">
          패턴 간격 (mm)
          <v-text-field
            v-model.number="form.repeatMm"
            data-testid="floor-repeat"
            type="number"
            min="10"
            max="100000"
            step="any"
            required
            :disabled="busy"
          />
        </label>
        <label class="flex-1-1">
          패턴 방향 (°)
          <v-text-field
            v-model.number="form.rotation"
            data-testid="floor-rotation"
            type="number"
            min="-360"
            max="360"
            step="any"
            required
            :disabled="busy"
          />
        </label>
      </div>
      <v-btn
        type="submit"
        color="primary"
        text="바닥 설정 적용"
        data-testid="floor-apply"
        :disabled="busy"
      />
      <div class="d-flex flex-wrap ga-1">
        <v-btn
          type="button"
          text="앞으로"
          :disabled="busy || index >= areas.length - 1"
          @click="emit('order', 1)"
        />
        <v-btn
          type="button"
          text="뒤로"
          :disabled="busy || index <= 0"
          @click="emit('order', -1)"
        />
        <v-btn
          type="button"
          text="경계 다시 그리기"
          :disabled="busy"
          @click="emit('redraw')"
        />
        <v-btn
          type="button"
          text="영역 삭제"
          :disabled="busy"
          @click="emit('remove')"
        />
      </div>
    </form>
  </section>
</template>

<style scoped lang="scss">
/** 등록한 바닥 이미지의 패널 크기 내 미리보기 적용 */
.floor-texture-preview {
  width: 100%;
  height: 88px;
  object-fit: contain;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
}

select {
  appearance: auto;
  min-width: 0;
  width: 100%;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  color: var(--text);
  background: var(--surface);
}
</style>
