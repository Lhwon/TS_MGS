import * as THREE from 'three'
import type { bakeFacilityFloorLightMap } from './facilityFloorLightMap'

type BakedLighting = NonNullable<ReturnType<typeof bakeFacilityFloorLightMap>>

/** Project the same cached fixture illumination onto 3D surfaces in map coordinates. */
export const createFacilityObjectLighting = () => {
  const matrix = new THREE.Matrix4()
  const worldToMap = new THREE.Matrix4()
  const uniforms = {
    fixtureLightMap: { value: null as THREE.Texture | null },
    fixtureLightMatrix: { value: matrix },
    fixtureLightUp: { value: new THREE.Vector3(0, 0, 1) },
    fixtureLightingEnabled: { value: false },
  }
  const materials = new WeakSet<THREE.Material>()

  const apply = (material: THREE.Material | THREE.Material[]) => {
    if (Array.isArray(material)) {
      material.forEach(apply)
      return
    }
    if (!(material instanceof THREE.MeshStandardMaterial) || materials.has(material)) return
    materials.add(material)
    const compile = material.onBeforeCompile
    const key = material.customProgramCacheKey()
    material.customProgramCacheKey = () => key + ':facility-light-map'
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(material, shader, renderer)
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `
        #include <common>
        uniform mat4 fixtureLightMatrix;
        varying vec2 vFixtureUv;
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
        vFixtureUv = (fixtureLightMatrix * modelMatrix * fixturePosition).xy;
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
        varying vec2 vFixtureUv;
      `,
        )
        .replace(
          '#include <lights_fragment_end>',
          `
        #if defined(RE_IndirectDiffuse)
          if (fixtureLightingEnabled &&
              all(greaterThanEqual(vFixtureUv, vec2(0.0))) &&
              all(lessThanEqual(vFixtureUv, vec2(1.0)))) {
            vec3 up = normalize(mat3(viewMatrix) * fixtureLightUp);
            float facing = max(dot(normal, up), 0.0);
            irradiance += texture2D(fixtureLightMap, vFixtureUv).rgb * mix(2.5, 8.0, facing);
          }
        #endif
        #include <lights_fragment_end>
      `,
        )
    }
    material.needsUpdate = true
  }

  const setLighting = (baked?: BakedLighting, fixtures?: THREE.Group, unit = 1) => {
    uniforms.fixtureLightMap.value = baked?.texture ?? null
    uniforms.fixtureLightingEnabled.value = !!baked
    if (!baked || !fixtures) return
    fixtures.updateWorldMatrix(true, false)
    const { bounds, size } = baked
    matrix.makeScale(1 / (size.x * unit), 1 / (size.y * unit), 1)
    matrix.setPosition(-bounds.min.x / size.x, -bounds.min.y / size.y, 0)
    matrix.multiply(worldToMap.copy(fixtures.matrixWorld).invert())
    uniforms.fixtureLightUp.value.set(0, 0, 1).transformDirection(fixtures.matrixWorld)
  }

  return { apply, setLighting }
}
