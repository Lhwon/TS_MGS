/**
 * 파일명: wallOverlapPass.ts
 * 설명: 겹치는 반투명 벽의 앞면만 기본 장면에 합성하는 렌더링
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
import * as THREE from 'three'

/** 카메라에 가장 가까운 벽 식별자를 픽셀마다 기록하고 기존 벽 재질에서 조회 */
const createWallOverlapPass = (renderer: THREE.WebGLRenderer) => {
  const maskScene = new THREE.Scene()
  maskScene.background = new THREE.Color(0)
  const masks = new Map<THREE.WebGLRenderTarget | null, THREE.WebGLRenderTarget>()
  const maskTexture = { value: null as THREE.Texture | null }
  const viewport = new THREE.Vector4()
  const entries = new Map<
    THREE.Mesh,
    {
      proxy: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
      id: THREE.Vector3
      restore: () => void
    }
  >()

  /** 원본 형상과 인스턴스 버퍼를 공유하는 벽 식별자 렌더링 등록 */
  const setWall = (mesh: THREE.Mesh, enabled: boolean) => {
    const entry = entries.get(mesh)
    if (!enabled) {
      if (!entry) return
      entry.restore()
      entries.delete(mesh)
      return
    }
    if (entry || !(mesh.material instanceof THREE.MeshStandardMaterial)) return

    const material = mesh.material
    const originalCompile = material.onBeforeCompile
    const originalCacheKey = material.customProgramCacheKey
    const id = new THREE.Vector3()
    const maskMaterial = new THREE.ShaderMaterial({
      uniforms: { wallId: { value: id } },
      vertexShader: [
        'void main() {',
        '  vec4 point = vec4(position, 1.0);',
        '  #ifdef USE_INSTANCING',
        '    point = instanceMatrix * point;',
        '  #endif',
        '  gl_Position = projectionMatrix * modelViewMatrix * point;',
        '}',
      ].join('\n'),
      fragmentShader: 'uniform vec3 wallId; void main() { gl_FragColor = vec4(wallId, 1.0); }',
    })
    const proxy =
      mesh instanceof THREE.InstancedMesh
        ? new THREE.InstancedMesh(mesh.geometry, maskMaterial, mesh.count)
        : new THREE.Mesh(mesh.geometry, maskMaterial)
    if (proxy instanceof THREE.InstancedMesh && mesh instanceof THREE.InstancedMesh)
      proxy.instanceMatrix = mesh.instanceMatrix
    proxy.matrixAutoUpdate = false
    proxy.frustumCulled = false
    maskScene.add(proxy)

    material.onBeforeCompile = (shader, gl) => {
      originalCompile.call(material, shader, gl)
      shader.uniforms.wallMask = maskTexture
      shader.uniforms.wallViewport = { value: viewport }
      shader.uniforms.wallId = { value: id }
      shader.fragmentShader = [
        'uniform sampler2D wallMask; uniform vec4 wallViewport; uniform vec3 wallId;',
        shader.fragmentShader.replace(
          'void main() {',
          [
            'void main() {',
            '  vec2 wallUV = (gl_FragCoord.xy - wallViewport.xy) / wallViewport.zw;',
            '  vec3 nearestWall = texture2D(wallMask, wallUV).rgb;',
            '  if (any(greaterThan(abs(nearestWall - wallId), vec3(0.5 / 255.0)))) discard;',
          ].join('\n'),
        ),
      ].join('\n')
    }
    material.customProgramCacheKey = () => originalCacheKey.call(material) + ':nearest-wall'
    material.needsUpdate = true
    entries.set(mesh, {
      proxy,
      id,
      restore: () => {
        material.onBeforeCompile = originalCompile
        material.customProgramCacheKey = originalCacheKey
        material.needsUpdate = true
        proxy.removeFromParent()
        proxy.material.dispose()
        if (proxy instanceof THREE.InstancedMesh) proxy.dispose()
      },
    })
  }

  /** 현재 장면의 보이는 벽만 카메라별 깊이 검사를 거쳐 식별자 텍스처에 기록 */
  const render = (scene: THREE.Scene, camera: THREE.Camera) => {
    let visible = 0
    for (const [mesh, { proxy, id }] of entries) {
      let parent: THREE.Object3D | null = mesh
      while (parent?.visible && parent !== scene) parent = parent.parent
      proxy.visible = parent === scene && scene.visible && mesh.layers.test(camera.layers)
      if (!proxy.visible) continue
      mesh.updateWorldMatrix(true, false)
      proxy.matrix.copy(mesh.matrixWorld)
      proxy.matrixWorldNeedsUpdate = true
      proxy.geometry = mesh.geometry
      proxy.layers.mask = mesh.layers.mask
      const index = ++visible
      id.set((index & 255) / 255, ((index >> 8) & 255) / 255, ((index >> 16) & 255) / 255)
    }

    if (visible) {
      renderer.getCurrentViewport(viewport)
      const target = renderer.getRenderTarget()
      if (viewport.z > 0 && viewport.w > 0) {
        let mask = masks.get(target)
        if (!mask) {
          mask = new THREE.WebGLRenderTarget(viewport.z, viewport.w, {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
          })
          masks.set(target, mask)
        } else if (mask.width !== viewport.z || mask.height !== viewport.w) {
          mask.setSize(viewport.z, viewport.w)
        }
        maskTexture.value = mask.texture
        const autoClear = renderer.autoClear
        const cubeFace = renderer.getActiveCubeFace()
        const mipLevel = renderer.getActiveMipmapLevel()
        renderer.setRenderTarget(mask)
        renderer.autoClear = true
        try {
          renderer.render(maskScene, camera)
        } finally {
          renderer.autoClear = autoClear
          renderer.setRenderTarget(target, cubeFace, mipLevel)
        }
      }
    }
    renderer.render(scene, camera)
  }

  /** 벽의 임시 형상과 카메라 식별자 텍스처 회수 */
  const dispose = () => {
    for (const { restore } of entries.values()) restore()
    entries.clear()
    for (const mask of masks.values()) mask.dispose()
    masks.clear()
    maskTexture.value = null
    passes.delete(renderer)
  }

  return { setWall, render, dispose }
}

const passes = new WeakMap<THREE.WebGLRenderer, ReturnType<typeof createWallOverlapPass>>()

/** 주 화면과 추가 카메라가 렌더러의 벽 합성 패스를 공유하도록 연결 */
export const getWallOverlapPass = (renderer: THREE.WebGLRenderer) => {
  const existing = passes.get(renderer)
  if (existing) return existing
  const pass = createWallOverlapPass(renderer)
  passes.set(renderer, pass)
  return pass
}
