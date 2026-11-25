/**
 * 파일명: selectionOutline.ts
 * 설명: 선택한 인스턴스의 실제 렌더링 윤곽을 화면 위에 합성
 * 작성자: 이희원
 * 작성일자: 2026-11-24
 */
import * as THREE from 'three'

type InstanceBinding = { mesh: THREE.InstancedMesh; index: number }

/** 선택한 인스턴스의 메시만 마스크로 그려 카메라 각도에 맞는 외곽 픽셀 강조 */
export const createSelectionOutline = (renderer: THREE.WebGLRenderer) => {
  const mask = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  })
  const maskScene = new THREE.Scene()
  maskScene.name = 'facility-selection-mask'
  maskScene.background = new THREE.Color(0)
  const overlay = new THREE.Scene()
  overlay.name = 'facility-selection-outline'
  const overlayCamera = new THREE.Camera()
  const opaqueMask = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  const cutoutMaterials = new Map<THREE.Material, THREE.MeshBasicMaterial>()
  const outlineMaterial = new THREE.ShaderMaterial({
    uniforms: {
      maskTexture: { value: mask.texture },
      offset: { value: new THREE.Vector2() },
      accent: { value: new THREE.Color(0x48bdac) },
    },
    vertexShader: `
      varying vec2 screenUv;
      void main() {
        screenUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D maskTexture;
      uniform vec2 offset;
      uniform vec3 accent;
      varying vec2 screenUv;

      void main() {
        float center = texture2D(maskTexture, screenUv).r;
        vec2 u = vec2(offset.x, 0.0);
        vec2 v = vec2(0.0, offset.y);
        float edge = max(
          max(texture2D(maskTexture, screenUv + u).r, texture2D(maskTexture, screenUv - u).r),
          max(texture2D(maskTexture, screenUv + v).r, texture2D(maskTexture, screenUv - v).r)
        ) - center;
        if (edge <= 0.0) discard;
        gl_FragColor = vec4(accent, edge);
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), outlineMaterial)
  quad.frustumCulled = false
  overlay.add(quad)
  let current: readonly InstanceBinding[] | undefined
  let proxies: { binding: InstanceBinding; object: THREE.Mesh }[] = []
  const dimensions = new THREE.Vector2()
  const instanceMatrix = new THREE.Matrix4()

  /** 원본 재질의 투명 구멍을 유지하며 선택 마스크 전용 재질 준비 */
  const maskMaterial = (original: THREE.Material) => {
    if (!original.visible || original.opacity <= 0) {
      const hidden = new THREE.MeshBasicMaterial({ visible: false })
      cutoutMaterials.set(original, hidden)
      return hidden
    }
    if (original.alphaTest <= 0) return opaqueMask
    const { map, alphaMap } = original as THREE.MeshStandardMaterial
    const material = new THREE.MeshBasicMaterial({ map, alphaMap, alphaTest: original.alphaTest, side: THREE.DoubleSide })
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        'diffuseColor.rgb = vec3(1.0);\n#include <opaque_fragment>',
      )
    }
    cutoutMaterials.set(original, material)
    return material
  }

  /** 기존 인스턴스 메시의 형상과 행렬을 재사용하는 외곽 합성 */
  const render = (bindings: readonly InstanceBinding[] | undefined, camera: THREE.Camera) => {
    if (current !== bindings) {
      current = bindings
      maskScene.clear()
      for (const material of cutoutMaterials.values()) material.dispose()
      cutoutMaterials.clear()
      proxies = (bindings ?? []).map((binding) => {
        const readMask = (material: THREE.Material) => cutoutMaterials.get(material) ?? maskMaterial(material)
        const original = binding.mesh.material
        const object = new THREE.Mesh(binding.mesh.geometry, Array.isArray(original) ? original.map(readMask) : readMask(original))
        object.matrixAutoUpdate = false
        maskScene.add(object)
        return { binding, object }
      })
    }
    if (!proxies.length) return

    for (const { binding: { mesh, index }, object } of proxies) {
      mesh.getMatrixAt(index, instanceMatrix)
      object.matrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix)
      object.matrixWorldNeedsUpdate = true
      object.visible = mesh.visible
    }
    renderer.getDrawingBufferSize(dimensions)
    mask.setSize(dimensions.x, dimensions.y)
    const thickness = renderer.getPixelRatio() * 2
    outlineMaterial.uniforms.offset!.value.set(thickness / dimensions.x, thickness / dimensions.y)

    const previousTarget = renderer.getRenderTarget()
    const previousAutoClear = renderer.autoClear
    const previousShadows = renderer.shadowMap.needsUpdate
    try {
      renderer.setRenderTarget(mask)
      renderer.autoClear = true
      renderer.shadowMap.needsUpdate = false
      renderer.render(maskScene, camera)
      renderer.setRenderTarget(previousTarget)
      renderer.autoClear = false
      renderer.render(overlay, overlayCamera)
    } finally {
      renderer.setRenderTarget(previousTarget)
      renderer.autoClear = previousAutoClear
      renderer.shadowMap.needsUpdate = previousShadows
    }
  }

  /** 윤곽 렌더러 소유의 합성 자원 해제 */
  const dispose = () => {
    mask.dispose()
    quad.geometry.dispose()
    outlineMaterial.dispose()
    opaqueMask.dispose()
    for (const material of cutoutMaterials.values()) material.dispose()
    maskScene.clear()
  }
  return { render, dispose }
}
