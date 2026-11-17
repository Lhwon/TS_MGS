<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import * as THREE from 'three';
import { MAX_SCENE_BYTES, parseFacilityDocument, importFacilityFiles, type FacilityDocument } from '@bem/map3d';
import type { MapData } from '@/features/map/types/map';
import { createMapCoordinateTransform } from '@/features/map/utils/coordinate';
import { sceneManager } from '@/features/map/engine/SceneManager';
import { ticker } from '@/features/map/engine/Ticker';
import { AuthoredFacilityManager } from '@/features/map/managers/authoredFacilityManager';
const props = defineProps<{
    map: MapData;
    mode: '2d' | '3d';
    ready: boolean;
}>();
const emit = defineEmits<{
    present: [
        present: boolean
    ];
}>();
const document = shallowRef<FacilityDocument | null>(null);
const name = ref(''), error = ref('');
const input = ref<HTMLInputElement>();
let manager: AuthoredFacilityManager | undefined;
const visible = computed(() => props.mode === '3d');
function apply() {
    if (!props.ready || !sceneManager.scene)
        return;
    manager ??= new AuthoredFacilityManager();
    if (!manager.root.parent)
        sceneManager.scene.add(manager.root);
    try {
        if (document.value)
            manager.render(document.value, props.map.mapNode, createMapCoordinateTransform(props.map.mapNode), props.map.mapPort.map(port => ({ id: port.id, x: port.realX, y: port.realY })));
        else
            manager.clear();
        manager.group.visible = visible.value;
        emit('present', !!document.value);
        error.value = '';
    }
    catch (cause) {
        manager.clear();
        emit('present', false);
        error.value = cause instanceof Error ? cause.message : String(cause);
    }
    ticker.requestRender();
}
async function open(event: Event) {
    const element = event.target as HTMLInputElement, files = [...(element.files ?? [])], file = files[0];
    if (!file)
        return;
    try {
        if (files.length > 2)
            throw new Error('배치 파일과 설비 모델 파일 2개를 선택하세요.');
        if (files.some(file => file.size > MAX_SCENE_BYTES))
            throw new Error('3D JSON은 32MB 이하여야 합니다.');
        const contents = await Promise.all(files.map(file => file.text()));
        const formats = contents.map(content => JSON.parse(content.replace(/^\uFEFF/, "")).format);
        const layoutIndex = formats.indexOf("bem-map3d-layout"), libraryIndex = formats.indexOf("bem-equipment-library");
        let next: FacilityDocument;
        if (layoutIndex >= 0 || libraryIndex >= 0) {
            if (layoutIndex < 0 || libraryIndex < 0)
                throw new Error('map3d.json과 equipment.json을 함께 선택하세요.');
            next = importFacilityFiles(contents[layoutIndex]!, contents[libraryIndex]!);
        }
        else {
            if (contents.length !== 1)
                throw new Error('설계 프로젝트는 1개만 선택하세요.');
            next = parseFacilityDocument(contents[0]!);
        }
        // Verify with the manager before replacing a valid loaded document.
        if (!props.ready || !manager)
            throw new Error('2D 맵 로딩이 끝난 뒤 3D 파일을 여세요.');
        manager.render(next, props.map.mapNode, createMapCoordinateTransform(props.map.mapNode), props.map.mapPort.map(port => ({ id: port.id, x: port.realX, y: port.realY })));
        document.value = next;
        name.value = files.map(file => file.name).join(" + ");
        apply();
        fit();
    }
    catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
    }
    finally {
        element.value = '';
    }
}
function clear() { document.value = null; name.value = ''; apply(); }
function fit() {
    if (!manager || !document.value?.instances.length)
        return;
    const bounds = new THREE.Box3().setFromObject(manager.group);
    if (bounds.isEmpty())
        return;
    const centre = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    const distance = Math.max(100, size.length() * 1.3);
    sceneManager.controls.target.copy(centre);
    sceneManager.controls.maxDistance = Math.max(5000, distance * 3);
    sceneManager.camera.far = Math.max(10000, distance * 10);
    sceneManager.camera.updateProjectionMatrix();
    sceneManager.camera.position.copy(centre).add(new THREE.Vector3(distance, distance, distance));
    sceneManager.controls.update();
    ticker.requestRender();
}
watch(() => [props.map, props.mode, props.ready], apply);
function updateLod() {
    if (!manager || !sceneManager.camera || !sceneManager.controls || !sceneManager.renderer) return;
    if (manager.root.update(sceneManager.camera, sceneManager.controls.target, sceneManager.renderer.domElement.clientHeight)) sceneManager.renderer.shadowMap.needsUpdate = true;
}
onMounted(() => { apply(); ticker.subscribe(updateLod); });
onBeforeUnmount(() => { ticker.unsubscribe(updateLod); emit('present', false); manager?.dispose(); ticker.requestRender(); });
</script>
<template>
  <div v-show="visible" class="authored-facility-tools">
    <input ref="input" type="file" multiple accept=".json" hidden @change="open">
    <button type="button" :disabled="!ready" @click="input?.click()">3D 배치·설비 파일 열기</button>
    <span v-if="document">{{ name }} · 시설 {{ document.instances.length }}개</span>
    <button v-if="document" type="button" @click="fit">시설 보기</button>
    <button v-if="document" type="button" data-testid="facility-layer-clear" @click="clear">해제</button>
    <span v-if="error" role="alert" class="authored-facility-error">{{ error }}</span>
  </div>
</template>
<style scoped>
.authored-facility-tools { position:absolute; left:12px; bottom:12px; z-index:8; display:flex; align-items:center; gap:8px; flex-wrap:wrap; max-width:calc(100% - 90px); padding:7px 10px; background:#ffffffed; border:1px solid #b8cdd7; border-radius:6px; color:#264757; font-size:11px; }
.authored-facility-tools button { padding:5px 8px; border:1px solid #aac2cb; border-radius:4px; background:white; cursor:pointer; }.authored-facility-tools button:disabled { opacity:.4; cursor:default; }.authored-facility-error { color:#b54821; }
</style>
