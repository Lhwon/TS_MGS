/**
 * 파일명: glbImportPreview.ts
 * 설명: 등록할 GLB 모델을 팝업에서 회전하고 확대하는 미리보기 렌더러
 * 작성자: 이희원
 * 작성일자: 2026-11-24
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { Point3 } from '@/entities/facility/index.ts'

/** 팝업 크기에 맞춰 GLB의 실제 비율과 표면 재질을 렌더링하는 독립 뷰 생성 */
export const createGlbImportPreview = (host: HTMLElement, model: THREE.Group, dark: boolean) => {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.03
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.domElement.setAttribute('aria-label', 'GLB 미리보기 · 드래그 회전 · 휠 확대')
  renderer.domElement.dataset.testid = 'glb-preview-canvas'
  host.append(renderer.domElement)

  const scene = new THREE.Scene()
  scene.name = 'glb-import-preview'
  scene.background = new THREE.Color(dark ? '#151e2d' : '#e8edf3')
  const room = new RoomEnvironment()
  const generator = new THREE.PMREMGenerator(renderer)
  const environment = generator.fromScene(room, 0.06)
  room.dispose()
  generator.dispose()
  scene.environment = environment.texture
  const light = new THREE.DirectionalLight(0xffffff, 2)
  light.position.set(2, -3, 4)
  scene.add(light, new THREE.HemisphereLight(0xffffff, 0x99a9c1, 1.4))

  const size = model.userData.nativeSize as Point3
  model.scale.set(size.x, size.y, size.z).divideScalar(Math.max(size.x, size.y, size.z))
  scene.add(model)
  const sphere = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere())
  const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 50)
  camera.up.set(0, 0, 1)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.minDistance = 0.18
  controls.maxDistance = 20

  const render = () => renderer.render(scene, camera)
  /** 모델 전체가 들어오도록 미리보기 시점 복원 */
  const reset = () => {
    const distance = sphere.radius * 3.9 / Math.min(1, camera.aspect)
    controls.target.copy(sphere.center)
    camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(1, -1.4, 0.75).normalize(), distance)
    controls.update()
    render()
  }

  let measured = false
  const resize = () => {
    if (!host.clientWidth || !host.clientHeight) return
    renderer.setSize(host.clientWidth, host.clientHeight, false)
    camera.aspect = host.clientWidth / host.clientHeight
    camera.updateProjectionMatrix()
    if (measured) render()
    else reset()
    measured = true
  }
  controls.addEventListener('change', render)
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  /** 팝업이 소유하는 렌더러와 관찰자를 해제하고 GLB 형상은 파일 캐시에서 회수 */
  const dispose = () => {
    observer.disconnect()
    controls.removeEventListener('change', render)
    controls.dispose()
    model.removeFromParent()
    environment.dispose()
    renderer.dispose()
    renderer.domElement.remove()
    renderer.forceContextLoss()
  }
  return { reset, dispose }
}
