/**
 * 파일명: modelThumbnails.ts
 * 설명: 모델 카탈로그의 실제 형상 미리보기 이미지 생성
 * 작성자: 이희원
 * 작성일자: 2026-11-20
 */
import * as THREE from 'three'
import { GlbModelCache } from '@bem/map3d/glb'
import { facilityPartMatrix, surfaceForPart, surfaceMaterials, type FacilityAsset } from '@/entities/facility/index.ts'

/** 하나의 렌더러에서 GLB와 조합 모델의 카탈로그 이미지를 순서대로 캡처 */
export const createModelThumbnails = () => {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(240, 144, false)
  renderer.setClearColor('#e3ebf1')
  const scene = new THREE.Scene()
  const light = new THREE.DirectionalLight('#ffffff', 2.1)
  light.position.set(2, -3, 4)
  scene.add(light, new THREE.HemisphereLight('#eff6ff', '#637180', 2.2))
  const camera = new THREE.PerspectiveCamera(35, 240 / 144, 0.01, 100000)
  camera.up.set(0, 0, 1)
  const cache = new GlbModelCache()
  const box = new THREE.BoxGeometry(1, 1, 1)
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 16)
  let disposed = false

  /** 모델 크기와 무관하게 썸네일의 화면 중심에 들어오도록 맞춤 */
  const capture = async (asset: FacilityAsset) => {
    const root = new THREE.Group()
    const materials: THREE.Material[] = []
    if (asset.glb) {
      const model = (await cache.load(asset.glb.data)).clone()
      if (disposed) return
      model.scale.set(asset.glb.size.x / 1000, asset.glb.size.y / 1000, asset.glb.size.z / 1000)
      root.add(model)
    } else {
      for (const part of asset.parts) {
        const opacity = part.opacity ?? 1
        const { roughness, metalness } = surfaceMaterials[surfaceForPart(part)]
        const material = new THREE.MeshStandardMaterial({
          color: part.color,
          roughness,
          metalness,
          opacity,
          transparent: opacity < 1,
        })
        materials.push(material)
        const mesh = new THREE.Mesh(part.shape === 'box' ? box : cylinder, material)
        mesh.matrixAutoUpdate = false
        mesh.matrix.copy(facilityPartMatrix(part))
        root.add(mesh)
      }
    }
    try {
      const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere())
      if (sphere.radius <= 0) return
      const distance = sphere.radius * 3.95
      camera.position
        .copy(sphere.center)
        .addScaledVector(new THREE.Vector3(1, -1, 0.7).normalize(), distance)
      camera.lookAt(sphere.center)
      camera.far = distance * 4
      camera.near = distance / 100
      camera.updateProjectionMatrix()
      scene.add(root)
      renderer.render(scene, camera)
      return renderer.domElement.toDataURL('image/webp', 0.85)
    } finally {
      root.removeFromParent()
      for (const material of materials) material.dispose()
    }
  }

  /** 카드 갱신이 취소되면 로더와 렌더러의 자원을 바로 회수 */
  const dispose = () => {
    disposed = true
    cache.dispose()
    box.dispose()
    cylinder.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return { capture, dispose }
}
