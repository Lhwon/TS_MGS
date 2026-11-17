import * as THREE from 'three';
import { AtomicLodLayer, MAP_LOD } from '@/features/map/utils/atomicLod';
import { mapGeometryKey, resolveFacilityInstance, type FacilityPort, type FacilityDocument } from '@bem/map3d';
/** Authored facility layer. MGS XY/Z-up millimetres -> TS_UI X/-Z ground, Y-up. */
export class AuthoredFacilityManager {
    readonly group = new THREE.Group();
    readonly root = new AtomicLodLayer([this.group], MAP_LOD.facility.size, MAP_LOD.facility.pixels);
    private box = new THREE.BoxGeometry(1, 1, 1);
    private cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
    private meshes: THREE.InstancedMesh[] = [];
    constructor() { this.group.name = 'authoredFacilities'; this.root.name = 'lod:authoredFacilities'; }
    render(doc: FacilityDocument, nodes: {
        nodeId: number;
        realX: number;
        realY: number;
    }[], transform: {
        centerX: number;
        centerY: number;
        scale: number;
    }, ports: FacilityPort[] = []) {
        const key = mapGeometryKey(nodes.map(n => ({ id: Number(n.nodeId), x: Number(n.realX), y: Number(n.realY) })));
        if (!doc.mapRef.geometryKey || doc.mapRef.geometryKey !== key)
            throw new Error('3D JSON의 기준 2D 맵과 현재 맵의 노드 좌표가 다릅니다.');
        const instances = doc.instances.map(instance => resolveFacilityInstance(instance, ports));
        this.clear();
        this.group.position.set(-transform.centerX * transform.scale, 0, transform.centerY * transform.scale);
        this.group.rotation.set(-Math.PI / 2, 0, 0);
        this.group.scale.setScalar(transform.scale);
        const assets = new Map(doc.assets.map(a => [a.id, a]));
        const groups = new Map<string, {
            matrix: THREE.Matrix4;
            instanceId: string;
        }[]>();
        for (const instance of instances) {
            const root = new THREE.Matrix4().compose(new THREE.Vector3(instance.position.x, instance.position.y, instance.position.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(instance.rotation)), new THREE.Vector3(1, 1, 1));
            for (const part of assets.get(instance.assetId)!.parts) {
                const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(part.rotation));
                q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(part.tiltX ?? 0), THREE.MathUtils.degToRad(part.tiltY ?? 0), 0)));
                if (part.shape === 'cylinder')
                    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
                const scale = part.shape === 'box' ? new THREE.Vector3(part.size.x, part.size.y, part.size.z) : new THREE.Vector3(part.size.x, part.size.z, part.size.y);
                const local = new THREE.Matrix4().compose(new THREE.Vector3(part.position.x, part.position.y, part.position.z), q, scale);
                const key = `${part.shape}:${part.color}`;
                const list = groups.get(key) ?? [];
                list.push({ matrix: new THREE.Matrix4().multiplyMatrices(root, local), instanceId: instance.id });
                groups.set(key, list);
            }
        }
        for (const [key, list] of groups) {
            const [shape, color] = key.split(':');
            const mesh = new THREE.InstancedMesh(shape === 'box' ? this.box : this.cylinder, new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.45 }), list.length);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.facilityIds = list.map(item => item.instanceId);
            list.forEach((item, index) => mesh.setMatrixAt(index, item.matrix));
            mesh.instanceMatrix.needsUpdate = true;
            this.group.add(mesh);
            this.meshes.push(mesh);
        }
        this.root.refresh();
        this.group.updateMatrixWorld(true);
    }
    clear() {
        for (const mesh of this.meshes) {
            mesh.dispose();
            (mesh.material as THREE.Material).dispose();
        }
        this.meshes = [];
        this.group.clear();
    }
    dispose() { this.clear(); this.box.dispose(); this.cylinder.dispose(); this.root.removeFromParent(); }
}
