import * as THREE from 'three'
import type { bakeFacilityFloorLightMap } from './facilityFloorLightMap'

type BakedLighting = NonNullable<ReturnType<typeof bakeFacilityFloorLightMap>>

/** 조명 수와 무관한 텍스처 조회로 객체의 높이와 입사 방향에 따른 빛 적용 */
export const createFacilityObjectLighting = () => {
  const matrix = new THREE.Matrix4()
  const worldToMap = new THREE.Matrix4()
  const uniforms = {
    fixtureLightMap: { value: null as THREE.Texture | null },
    fixtureLightMatrix: { value: matrix },
    fixtureLightUp: { value: new THREE.Vector3(0, 0, 1) },
    fixtureLightingEnabled: { value: false },
    fixtureVolumeEnabled: { value: false },
    fixtureVolumeColor: { value: null as THREE.Texture | null },
    fixtureVolumeDirection: { value: null as THREE.Texture | null },
    fixtureVolumeSize: { value: new THREE.Vector3(1, 1, 1) },
    fixtureLightBasis: { value: new THREE.Matrix3() },
  }
  const materials = new WeakSet<THREE.Material>()

  /** 공유 재질의 형상을 유지하면서 조명 캐시를 조회하는 셰이더 확장 적용 */
  const apply = (material: THREE.Material | THREE.Material[]) => {
    if (Array.isArray(material)) {
      material.forEach(apply)
      return
    }
    if (!(material instanceof THREE.MeshStandardMaterial) || materials.has(material)) return
    materials.add(material)
    const compile = material.onBeforeCompile
    const key = material.customProgramCacheKey()
    material.customProgramCacheKey = () => key + ':facility-light-volume'
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(material, shader, renderer)
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `
        #include <common>
        uniform mat4 fixtureLightMatrix;
        varying vec3 vFixtureUv;
      `,
        )
        .replace(
          '#include <project_vertex>',
          `
        #include <project_vertex>
        vec4 fixturePosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fixturePosition = instanceMatrix * fixturePosition;
        #endif
        vFixtureUv = (fixtureLightMatrix * modelMatrix * fixturePosition).xyz;
      `,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `
        #include <common>
        uniform sampler2D fixtureLightMap;
        uniform vec3 fixtureLightUp;
        uniform bool fixtureLightingEnabled;
        uniform bool fixtureVolumeEnabled;
        uniform sampler2D fixtureVolumeColor;
        uniform sampler2D fixtureVolumeDirection;
        uniform vec3 fixtureVolumeSize;
        uniform mat3 fixtureLightBasis;
        varying vec3 vFixtureUv;
        vec3 sampleFixtureVolume(sampler2D atlas, vec3 uv) {
          float slice = clamp(uv.z, 0.0, 1.0) * (fixtureVolumeSize.z - 1.0);
          float lower = floor(slice);
          float upper = min(lower + 1.0, fixtureVolumeSize.z - 1.0);
          vec2 pixel = clamp(uv.xy, 0.0, 1.0) * (fixtureVolumeSize.xy - 1.0) + 0.5;
          vec2 lowerUv = vec2(pixel.x / fixtureVolumeSize.x,
            (pixel.y + lower * fixtureVolumeSize.y) / (fixtureVolumeSize.y * fixtureVolumeSize.z));
          vec2 upperUv = vec2(lowerUv.x,
            (pixel.y + upper * fixtureVolumeSize.y) / (fixtureVolumeSize.y * fixtureVolumeSize.z));
          return mix(texture2D(atlas, lowerUv).rgb, texture2D(atlas, upperUv).rgb, fract(slice));
        }
      `,
        )
        .replace(
          '#include <lights_fragment_end>',
          `
        #if defined(RE_IndirectDiffuse)
          if (fixtureLightingEnabled &&
              all(greaterThanEqual(vFixtureUv.xy, vec2(0.0))) &&
              all(lessThanEqual(vFixtureUv.xy, vec2(1.0)))) {
            vec3 up = normalize(mat3(viewMatrix) * fixtureLightUp);
            vec3 illumination = texture2D(fixtureLightMap, vFixtureUv.xy).rgb;
            if (fixtureVolumeEnabled) {
              illumination = vFixtureUv.z < 0.0 || vFixtureUv.z > 1.0 ? vec3(0.0)
                : sampleFixtureVolume(fixtureVolumeColor, vFixtureUv);
              vec3 incoming = sampleFixtureVolume(fixtureVolumeDirection, vFixtureUv) * 2.0 - 1.0;
              up = normalize(mat3(viewMatrix) * fixtureLightBasis * incoming);
            }
            float facing = max(dot(normal, up), 0.0);
            irradiance += illumination * mix(2.5, 8.0, facing);
          }
        #endif
        #include <lights_fragment_end>
      `,
        )
    }
    material.needsUpdate = true
  }

  /** 기존 장면과 재질을 유지하면서 계산 완료된 조명 텍스처만 교체 */
  const setLighting = (baked?: BakedLighting, fixtures?: THREE.Group, unit = 1) => {
    uniforms.fixtureLightMap.value = baked?.texture ?? null
    uniforms.fixtureLightingEnabled.value = !!baked
    uniforms.fixtureVolumeEnabled.value = !!baked?.volume
    uniforms.fixtureVolumeColor.value = baked?.volume?.color ?? null
    uniforms.fixtureVolumeDirection.value = baked?.volume?.direction ?? null
    if (!baked || !fixtures) return
    fixtures.updateWorldMatrix(true, false)
    const { bounds, size } = baked
    matrix.makeScale(
      1 / (size.x * unit),
      1 / (size.y * unit),
      baked.volume ? 1 / (baked.volume.height * unit) : 1,
    )
    matrix.setPosition(-bounds.min.x / size.x, -bounds.min.y / size.y, 0)
    matrix.multiply(worldToMap.copy(fixtures.matrixWorld).invert())
    uniforms.fixtureLightUp.value.set(0, 0, 1).transformDirection(fixtures.matrixWorld)
    uniforms.fixtureLightBasis.value.setFromMatrix4(
      new THREE.Matrix4().extractRotation(fixtures.matrixWorld),
    )
    if (baked.volume)
      uniforms.fixtureVolumeSize.value.set(
        baked.volume.width,
        baked.volume.rows,
        baked.volume.slices,
      )
  }

  return { apply, setLighting }
}
