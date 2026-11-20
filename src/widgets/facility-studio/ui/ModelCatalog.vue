<!--
 * 파일명: ModelCatalog.vue
 * 설명: 기본 및 사용자 모델을 사진 카드와 카테고리로 선택하는 팝업
 * 작성자: 이희원
 * 작성일자: 2026-11-20
-->
<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { mdiCubeOutline, mdiFolderOpenOutline } from '@mdi/js'
import { VIcon, VProgressLinear } from 'vuetify/components'
import { facilityModelSize, type FacilityAsset } from '@/entities/facility/index.ts'
import { createModelThumbnails } from '@/widgets/facility-studio/lib/modelThumbnails.ts'

const open = defineModel<boolean>({ required: true })
const category = defineModel<'equipment' | 'interior'>('category', { required: true })
const units = defineModel<'m' | 'mm'>('units', { required: true })
const props = defineProps<{
  assets: FacilityAsset[]
  busy: boolean
  loading: boolean
  selected: string | null
  error: string
}>()
const emit = defineEmits<{ choose: [asset: FacilityAsset]; import: []; importLibrary: []; registerDefaults: [] }>()
const size = ref('')
const search = ref('')
const thumbnails = shallowRef(new Map<string, string>())
const sizes = [
  { title: '전체 크기', value: '' },
  { title: '소 · 1m 미만', value: 'small' },
  { title: '중 · 1m 이상 3m 미만', value: 'medium' },
  { title: '대 · 3m 이상', value: 'large' },
]

const cards = computed(() => {
  const query = search.value.trim().toLowerCase()
  return props.assets
    .filter((asset) => {
      const type =
        asset.catalogCategory ??
        (asset.id.startsWith('interior-') || /책상|가구|유리|벽|문틀|칸막이|TV|desk|table|chair/i.test(asset.name)
          ? 'interior'
          : 'equipment')
      return type === category.value && asset.name.toLowerCase().includes(query)
    })
    .map((asset) => {
      const { x, y, z } = facilityModelSize(asset)
      const longest = Math.max(x, y, z)
      const tier = longest < 1000 ? 'small' : longest < 3000 ? 'medium' : 'large'
      const previewKey = asset.id + ':' + (asset.glb?.data.length ?? JSON.stringify(asset.parts))
      return {
        asset,
        previewKey,
        dimensions: [x, y, z].map(Math.round).join(' × '),
        tier,
        label: tier === 'small' ? '소' : tier === 'medium' ? '중' : '대',
      }
    })
    .filter((card) => !size.value || card.tier === size.value)
})

watch(
  [open, cards],
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
  <v-dialog
    v-model="open"
    max-width="940"
    scrollable
  >
    <v-card
      title="GLB 모델 카탈로그"
      data-testid="model-catalog"
    >
      <v-card-text>
        <div class="d-flex flex-wrap align-center ga-3 mb-4">
          <v-btn-toggle
            v-model="category"
            mandatory
            divided
          >
            <v-btn
              value="equipment"
              text="설비"
            />
            <v-btn
              value="interior"
              text="인테리어"
            />
          </v-btn-toggle>
          <v-select
            v-model="size"
            :items="sizes"
            label="모델 크기"
            hide-details
            density="compact"
          />
          <v-text-field
            v-model="search"
            label="모델 이름 검색"
            hide-details
            density="compact"
          />
        </div>
        <v-alert
          v-if="error"
          class="mb-3"
          density="compact"
          type="error"
          :text="error"
        />
        <v-progress-linear
          v-if="loading"
          indeterminate
        />
        <p
          v-else-if="!cards.length"
          class="text-body-2 py-5"
        >
          조건에 맞는 모델이 없습니다.
        </p>
        <div
          v-else
          class="catalog-grid"
        >
          <button
            v-for="{ asset, previewKey, dimensions, label } in cards"
            :key="asset.id"
            type="button"
            class="model-card text-start"
            :data-testid="`catalog-model-${asset.id}`"
            :class="{ 'model-card-selected': asset.id === selected }"
            :aria-pressed="asset.id === selected"
            :disabled="busy"
            @click="emit('choose', asset)"
          >
            <div class="model-preview d-flex align-center justify-center">
              <img
                v-if="thumbnails.get(previewKey)"
                :src="thumbnails.get(previewKey)"
                alt=""
              />
              <v-icon
                v-else
                :icon="[mdiCubeOutline]"
                size="32"
              />
            </div>
            <div class="d-flex justify-space-between align-center ga-2 px-3 pt-2">
              <strong>{{ asset.name }}</strong>
              <small>{{ label }}</small>
            </div>
            <small class="d-block px-3 pb-3">{{ dimensions }} mm</small>
          </button>
        </div>
      </v-card-text>
      <v-card-actions class="flex-wrap ga-2">
        <v-select
          v-model="units"
          :items="[
            { title: 'm 단위', value: 'm' },
            { title: 'mm 단위', value: 'mm' },
          ]"
          label="가져올 GLB 단위"
          data-testid="glb-units"
          density="compact"
          hide-details
        />
        <v-btn
          text="내 GLB 가져오기"
          data-testid="glb-import"
          :prepend-icon="[mdiFolderOpenOutline]"
          :disabled="busy"
          @click="emit('import')"
        />
        <v-btn
          text="설비 모델 파일 가져오기"
          :disabled="busy"
          @click="emit('importLibrary')"
        />
        <v-spacer />
        <v-btn
          text="기본 모델 전체 등록"
          data-testid="catalog-register-defaults"
          :disabled="busy || loading"
          @click="emit('registerDefaults')"
        />
        <v-btn
          text="닫기"
          @click="open = false"
        />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss">
.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(165px, 1fr));
  gap: 12px;
}
.model-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  overflow: hidden;

  &:hover,
  &.model-card-selected {
    border-color: var(--accent);
  }

  small {
    color: var(--text-secondary);
  }
}
.model-preview {
  aspect-ratio: 5 / 3;
  background: #e3ebf1;
  color: #526879;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}
</style>
