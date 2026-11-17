import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { FacilityAsset, Point3 } from './index'
import { decodeEmbeddedGlb } from './glbData'

/** 캐시 소유 모델의 공유 형상과 재질 및 텍스처 해제 */
const disposeSource = (source: THREE.Object3D) => {
  const resources = new Set<{ dispose: () => void }>()
  const bitmaps = new Set<ImageBitmap>()
  source.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    resources.add(child.geometry)
    if (child instanceof THREE.SkinnedMesh) resources.add(child.skeleton)
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      resources.add(material)
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) {
          resources.add(value)
          if (typeof ImageBitmap !== 'undefined' && value.source.data instanceof ImageBitmap)
            bitmaps.add(value.source.data)
        }
    }
  })
  resources.forEach((resource) => resource.dispose())
  bitmaps.forEach((bitmap) => bitmap.close())
}

/** 원본 형상을 보존하며 중심 바닥 기준의 단위 크기로 정규화하는 모델 로딩 */
const parseSource = async (data: string) => {
  const gltf = await new GLTFLoader().parseAsync(decodeEmbeddedGlb(data), '')
  const source = gltf.scene
  source.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(source)
  const size = bounds.getSize(new THREE.Vector3())
  if (
    bounds.isEmpty() ||
    !size.toArray().every(Number.isFinite) ||
    Math.min(size.x, size.y, size.z) <= 0
  ) {
    disposeSource(source)
    throw new Error('GLB 모델의 입체 크기를 확인하세요.')
  }
  const center = bounds.getCenter(new THREE.Vector3())
  let vertices = 0
  let deformable = false
  let nestedInstances = false
  source.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    if (child instanceof THREE.InstancedMesh) nestedInstances = true
    vertices += child.geometry.getAttribute('position')?.count ?? 0
    if (
      child instanceof THREE.SkinnedMesh ||
      child.morphTargetInfluences?.some((value) => value !== 0)
    )
      deformable = true
    child.castShadow = true
    child.receiveShadow = true
  })
  if (vertices === 0 || vertices > 1000000) {
    disposeSource(source)
    throw new Error('표면 메시가 있고 정점이 백만 개 이하인 GLB를 사용하세요.')
  }
  if (deformable) {
    disposeSource(source)
    throw new Error('본과 모프를 적용한 뒤 정적 설비 GLB로 내보내세요.')
  }
  if (nestedInstances) {
    disposeSource(source)
    throw new Error('GLB 내부 인스턴스를 일반 메시로 변환해 내보내세요.')
  }
  source.position.x -= center.x
  source.position.y -= bounds.min.y
  source.position.z -= center.z
  const normalized = new THREE.Group()
  const axis = new THREE.Group()
  axis.scale.set(1 / size.x, 1 / size.y, 1 / size.z)
  axis.add(source)
  normalized.add(axis)
  normalized.rotation.x = Math.PI / 2
  const root = new THREE.Group()
  root.add(normalized)
  root.userData.nativeSize = { x: size.x, y: size.z, z: size.y } satisfies Point3
  return root
}

/** 같은 GLB의 형상과 재질을 재사용하는 모델 캐시 */
export class GlbModelCache {
  private sources = new Map<string, Promise<THREE.Group>>()
  private closed = false

  /** 문서에서 제거된 모델의 캐시 자원 정리 */
  retain = (assets: FacilityAsset[]) => {
    const used = new Set(assets.flatMap((asset) => (asset.glb ? [asset.glb.data] : [])))
    this.sources.forEach((source, key) => {
      if (used.has(key)) return
      this.sources.delete(key)
      void source.then(disposeSource, () => undefined)
    })
  }

  /** 공유 원본과 독립 골격을 가진 배치용 모델 복제 */
  load = async (data: string) => {
    if (this.closed) throw new Error('종료된 모델 캐시입니다.')
    let source = this.sources.get(data)
    if (!source) {
      source = parseSource(data).catch((error: unknown) => {
        this.sources.delete(data)
        throw error
      })
      this.sources.set(data, source)
    }
    return clone(await source) as THREE.Group
  }

  /** 원본 단위 선택에 따른 기본 모델 치수 조회 */
  measure = async (data: string, units: 'm' | 'mm' = 'm'): Promise<Point3> => {
    const model = await this.load(data)
    const size = model.userData.nativeSize as Point3
    const factor = units === 'm' ? 1000 : 1
    return {
      x: Math.max(1, size.x * factor),
      y: Math.max(1, size.y * factor),
      z: Math.max(1, size.z * factor),
    }
  }

  /** 비동기 로딩을 포함한 모든 소유 자원 해제 */
  dispose = () => {
    this.closed = true
    this.sources.forEach((source) => {
      void source.then(disposeSource, () => undefined)
    })
    this.sources.clear()
  }
}
