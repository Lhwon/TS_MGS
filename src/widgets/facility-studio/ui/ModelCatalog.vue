<!--
 * 파일명: ModelCatalog.vue
 * 설명: 기본 및 사용자 모델의 검색과 선택 및 배치를 제공하는 우측 카탈로그
 * 작성자: 이희원
 * 작성일자: 2026-11-20
-->
<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { mdiCheckboxBlankOutline, mdiCheckboxMarked, mdiClose, mdiCubeOutline, mdiFolderOpenOutline } from '@mdi/js'
import { VIcon, VProgressLinear } from 'vuetify/components'
import { facilityLight, facilityModelSize, type FacilityAsset } from '@/entities/facility/index.ts'
import { createModelThumbnails } from '@/widgets/facility-studio/lib/modelThumbnails.ts'

const category = defineModel<NonNullable<FacilityAsset['catalogCategory']>>('category', { required: true })

const props = defineProps<{
  practice?: boolean
  visible: boolean
  assets: FacilityAsset[]
  registeredIds: ReadonlySet<string>
  placedIds: ReadonlySet<string>
  busy: boolean
  loading: boolean
  selected: string | null
  error: string
}>()

const emit = defineEmits<{
  close: []
  choose: [asset: FacilityAsset]
  editLight: [asset: FacilityAsset]
  dragStart: [event: DragEvent, asset: FacilityAsset]
  dragEnd: []
  remove: [ids: string[]]
  import: []
  importLibrary: []
  registerDefaults: []
}>()

const size = ref('')
const search = ref('')
const selecting = ref(false)
const checked = shallowRef(new Set<string>())
const thumbnails = shallowRef(new Map<string, string>())
const sizes = [
  { title: '전체 크기', value: '' },
  { title: '소 · 1m 미만', value: 'small' },
  { title: '중 · 1m 이상 3m 미만', value: 'medium' },
  { title: '대 · 3m 이상', value: 'large' },
]

const cards = computed(() => {
  /** 기존 검색 조건을 보존하면서 연습 모델의 카드 노출 보장 */
  const query = props.practice ? '' : search.value.trim().toLowerCase()

  return props.assets
    .filter((asset) => {
      const type = facilityLight(asset) ? 'lighting' : asset.catalogCategory ??
        (asset.id.startsWith('interior-') || /책상|가구|유리|벽|문틀|칸막이|TV|desk|table|chair/i.test(asset.name)
          ? 'interior'
          : 'equipment')
      return (!selecting.value || props.registeredIds.has(asset.id)) &&
        type === category.value && asset.name.toLowerCase().includes(query)
    })
    .map((asset) => {
      const { x, y, z } = facilityModelSize(asset)
      const longest = Math.max(x, y, z)
      const tier = longest < 1000 ? 'small' : longest < 3000 ? 'medium' : 'large'
      const previewKey = asset.id + ':' + (asset.glb?.hash ?? asset.glb?.data?.length ?? JSON.stringify(asset.parts))

      return {
        asset,
        light: facilityLight(asset),
        previewKey,
        dimensions: [x, y, z].map(Math.round).join(' × '),
        tier,
        label: tier === 'small' ? '소' : tier === 'medium' ? '중' : '대',
      }
    })
    .filter((card) => props.practice || !size.value || card.tier === size.value)
})

/** 관리 모드를 전환하고 카탈로그 카드의 이전 삭제 선택을 초기화 */
const setSelecting = (value: boolean) => {
  selecting.value = value
  checked.value = new Set()
}

/** 일반 모드에서 배치 모델을 선택하고 관리 모드에서 삭제 선택 상태를 전환 */
const activateCard = (asset: FacilityAsset) => {
  if (!selecting.value) {
    emit('choose', asset)
    return
  }
  const next = new Set(checked.value)
  if (!next.delete(asset.id)) next.add(asset.id)
  checked.value = next
}

watch(() => props.visible, (visible) => {
  if (!visible) setSelecting(false)
})

watch(() => [props.registeredIds, props.placedIds] as const, ([registered, placed]) => {
  checked.value = new Set([...checked.value].filter((id) => registered.has(id) && !placed.has(id)))
})

watch(
  [() => props.visible, cards],
  ([visible, rows], _, cleanup) => {
    if (!visible) return

    const pending = rows.filter(({ previewKey }) => !thumbnails.value.has(previewKey))
    if (!pending.length) return

    let cancelled = false
    let renderer: ReturnType<typeof createModelThumbnails>

    try {
      renderer = createModelThumbnails()
    } catch {
      return
    }

    cleanup(() => {
      cancelled = true
      renderer.dispose()
    })

    void (async () => {
      for (const { asset, previewKey } of pending) {
        if (cancelled) break

        try {
          const image = await renderer.capture(asset)
          if (!cancelled && image)
            thumbnails.value = new Map(thumbnails.value).set(previewKey, image)
        } catch {
          // 로딩 실패 모델은 공통 모델 아이콘으로 표시
        }
      }
    })()
  },
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <aside
    aria-labelledby="model-catalog-heading"
    class="model-catalog"
    data-testid="model-catalog"
  >
    <header class="px-3 pt-2 pb-3 d-flex flex-column ga-2">
      <div class="d-flex justify-space-between align-center ga-1">
        <h2 id="model-catalog-heading" class="catalog-title">GLB 모델 카탈로그</h2>
        <v-btn
          :icon="[mdiClose]"
          aria-label="카탈로그 닫기"
          title="카탈로그 닫기"
          size="small"
          variant="text"
          data-testid="catalog-close"
          @click="emit('close')"
        />
      </div>
      <div class="catalog-guide text-caption" aria-live="polite">
        {{ selecting ? '삭제할 사용자 모델을 체크하세요.' : '모델을 맵으로 끌어다 놓으세요.' }}
      </div>
      <div class="d-flex flex-wrap justify-space-between align-center ga-1">
        <v-btn-toggle v-model="category" mandatory density="compact" divided>
          <v-btn value="equipment" text="설비" size="small" />
          <v-btn value="interior" text="인테리어" size="small" />
          <v-btn value="lighting" text="조명" size="small" />
        </v-btn-toggle>
        <v-btn
          :text="selecting ? '취소' : '선택'"
          data-testid="catalog-select"
          size="small"
          :aria-pressed="selecting"
          :disabled="busy || loading || (!selecting && !registeredIds.size)"
          @click="setSelecting(!selecting)"
        />
      </div>
      <v-text-field v-model="search" label="모델 이름 검색" density="compact" hide-details />
      <v-select v-model="size" :items="sizes" label="모델 크기" density="compact" hide-details />
    </header>

    <div class="catalog-body flex-grow-1 overflow-auto px-3 pb-3">
      <v-alert v-if="error" class="mb-3" density="compact" type="error" :text="error" />
      <v-progress-linear v-if="loading" indeterminate />
      <p v-else-if="!cards.length" class="catalog-guide text-caption py-3">
        {{ selecting ? '조건에 맞는 사용자 모델이 없습니다.' : '조건에 맞는 모델이 없습니다.' }}
      </p>
      <div v-else class="catalog-grid">
        <div
          v-for="{ asset, light, previewKey, dimensions, label } in cards"
          :key="asset.id"
          class="catalog-card"
        >
          <button
            type="button"
            class="model-card text-start"
            :data-testid="`catalog-model-${asset.id}`"
            :class="{ 'model-card-selected': selecting ? checked.has(asset.id) : asset.id === selected }"
            :title="asset.name"
            :role="selecting ? 'checkbox' : undefined"
            :aria-checked="selecting ? checked.has(asset.id) : undefined"
            :aria-pressed="selecting ? undefined : asset.id === selected"
            :disabled="busy || (selecting && placedIds.has(asset.id))"
            :draggable="!busy && !selecting"
            @click="activateCard(asset)"
            @dragstart="emit('dragStart', $event, asset)"
            @dragend="emit('dragEnd')"
          >
            <div class="model-preview d-flex align-center justify-center position-relative">
              <img v-if="thumbnails.get(previewKey)" :src="thumbnails.get(previewKey)" alt="" draggable="false" />
              <v-icon v-else :icon="[mdiCubeOutline]" size="28" />
              <v-icon
                v-if="selecting"
                :icon="[checked.has(asset.id) ? mdiCheckboxMarked : mdiCheckboxBlankOutline]"
                class="catalog-check"
                size="20"
              />
            </div>
            <div class="model-info px-2 py-1">
              <div class="d-flex align-start justify-space-between ga-1">
                <span class="model-name">{{ asset.name }}</span>
                <small>{{ label }}</small>
              </div>
              <small>{{ selecting && placedIds.has(asset.id) ? '배치 사용 중' : `${dimensions} mm` }}</small>
              <small v-if="light" class="d-block">{{ light.temperature }} K</small>
            </div>
          </button>
          <v-btn
            v-if="light && !selecting"
            text="조명 설정"
            size="x-small"
            variant="text"
            :disabled="busy"
            :data-testid="`catalog-light-edit-${asset.id}`"
            @click="emit('editLight', asset)"
          />
        </div>
      </div>
    </div>

    <footer v-if="selecting" class="catalog-actions px-3 py-2 d-flex align-center justify-space-between ga-2">
      <span class="catalog-guide text-caption" aria-live="polite">{{ checked.size }}개 선택</span>
      <v-btn
        text="삭제"
        color="error"
        variant="flat"
        data-testid="catalog-delete"
        :disabled="busy || !checked.size"S
        @click="emit('remove', [...checked])"
      />
    </footer>
    <footer v-else class="catalog-actions pa-2 d-flex flex-column ga-1">
      <v-btn
        text="내 GLB 가져오기"
        data-testid="glb-import"
        :prepend-icon="[mdiFolderOpenOutline]"
        :disabled="busy || loading"
        @click="emit('import')"
      />
      <v-btn text="설비 모델 파일 가져오기" :disabled="busy" @click="emit('importLibrary')" />
      <v-btn
        text="기본 모델 전체 등록"
        data-testid="catalog-register-defaults"
        :disabled="busy || loading"
        @click="emit('registerDefaults')"
      />
    </footer>
  </aside>
</template>

<style scoped lang="scss">
.model-catalog {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--surface);
}
.catalog-title {
  font-size: 14px;
  line-height: 1.35;
}
.catalog-guide {
  color: var(--text-secondary);
}
.catalog-body {
  min-height: 0;
}
.catalog-actions {
  border-top: 1px solid var(--border);
}
.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(90px, 100%), 1fr));
  align-items: stretch;
  gap: 8px;
}
.model-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  width: 100%;
  flex-grow: 1;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  overflow: hidden;

  &[draggable='true'] {
    cursor: grab;
  }

  &:disabled {
    opacity: 0.65;
  }

  &:hover:not(:disabled),
  &.model-card-selected {
    border-color: var(--accent);
  }

  small {
    color: var(--text-secondary);
  }
}
.catalog-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.model-preview {
  width: 100%;
  height: 66px;
  background: var(--surface-muted);
  color: var(--text-secondary);

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}
.model-info {
  width: 100%;
  font-size: 11px;
  line-height: 1.4;
}
.model-name {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.catalog-check {
  position: absolute;
  top: 4px;
  right: 4px;
  color: var(--text);
  border-radius: 3px;
  background: var(--surface);
}
.model-card-selected .catalog-check {
  color: var(--accent);
}
</style>
