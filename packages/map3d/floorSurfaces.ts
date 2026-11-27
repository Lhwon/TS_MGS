/**
 * 파일명: floorSurfaces.ts
 * 설명: 밀리미터 단위 바닥 경계와 반복 재질을 지도 하단에 표시하는 렌더러
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
import * as THREE from 'three'
import { MAX_FLOOR_AREAS, type FloorArea, type FloorMaterial } from './floorAreas'
import showroomEpoxyUrl from './showroom-epoxy.webp'
import { bakeFacilityFloorLightMap } from './facilityFloorLightMap'
import { createFacilityObjectLighting } from './facilityObjectLighting'
import type { SceneResourceReader } from './sceneResources'

/** 면적과 관계없이 일정한 간격으로 반복할 기본 재질 텍스처 생성 */
const createProceduralTexture = (material: FloorMaterial) => {
  const canvas = document.createElement('canvas')
  const size = 256
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  context.fillStyle = '#f4f4f4'
  context.fillRect(0, 0, size, size)
  let seed = 5839
  /** 다시 불러와도 같은 픽셀에서 동일한 무늬를 생성하는 난수 */
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }

  if (material === 'tile') {
    context.strokeStyle = '#a4a4a4'
    context.lineWidth = 3
    context.strokeRect(0, 0, size, size)
  } else if (material === 'wood') {
    for (let y = 0; y < size; y += 64) {
      const shade = 212 + Math.floor(random() * 39)
      context.fillStyle = 'rgb(' + shade + ' ' + shade + ' ' + shade + ')'
      context.fillRect(0, y, size, 64)
      context.fillStyle = '#a9a9a9'
      context.fillRect(0, y, size, 1)
      context.fillRect(y % 128 ? 0 : 128, y, 1, 64)
    }
    for (let i = 0; i < 280; i++) {
      context.fillStyle = 'rgba(50,50,50,' + random() * 0.14 + ')'
      context.fillRect(random() * size, random() * size, 12 + random() * 70, 1)
    }
  } else {
    const concrete = material === 'concrete'
    for (let i = 0; i < (concrete ? 1800 : 750); i++) {
      context.fillStyle = 'rgba(70,70,70,' + random() * (concrete ? 0.38 : 0.13) + ')'
      context.fillRect(random() * size, random() * size, concrete ? 2 : 1, 1)
    }
  }

  return new THREE.CanvasTexture(canvas)
}

// 바닥 재질의 반사 특성과 표면 요철 높이
const floorFinish = {
  concrete: { roughness: 0.87, reliefMm: 0.65 },
  epoxy: { roughness: 0.34, reliefMm: 0 },
  'showroom-epoxy': { roughness: 0.42, reliefMm: 0 },
  tile: { roughness: 0.49, reliefMm: 0.45 },
  wood: { roughness: 0.62, reliefMm: 0.25 },
} as const

/**
 * 지도 객체 아래에 바닥 마감을 표시하고 영역 목록의 순서대로 합성
 * @param unit 지도 밀리미터에서 렌더링 단위로 변환하는 배율
 * @param environment 쇼룸 에폭시에 비치는 장면의 실내 조명 맵
 * @param onTextureReady 이미지 텍스처 로딩 완료 후 화면 갱신 요청
 */
export const createFloorSurfaces = (
  unit: number,
  environment: THREE.Texture | null,
  onTextureReady: () => void,
) => {
  const group = new THREE.Group()
  group.name = 'facility-floor-surfaces'
  const textures = new Map<FloorMaterial, THREE.Texture>()
  const externalTextures = new Map<
    string,
    { pending: Promise<THREE.Texture>; texture?: THREE.Texture }
  >()
  let disposed = false
  const objectLighting = createFacilityObjectLighting()
  let meshes: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshStandardMaterial>[] = []
  let current: FloorArea[] | undefined
  let lightMap: THREE.Texture | undefined
  let lightMapKey = ''

  /** 기존 면의 버퍼와 재질을 해제하며 공용 반복 텍스처는 유지 */
  const clear = () => {
    objectLighting.setLighting()
    lightMap?.dispose()
    lightMap = undefined
    lightMapKey = ''
    for (const mesh of meshes) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    meshes = []
    group.clear()
  }

  const setFixtureLighting = (fixtures?: THREE.Group) => {
    const key =
      fixtures?.children
        .map((light) =>
          [
            light.position.x,
            light.position.y,
            light.position.z,
            light.rotation.z,
            light.userData.temperature,
            light instanceof THREE.RectAreaLight ? light.width / fixtures.scale.x : 0,
          ].join(','),
        )
        .join(';') ?? ''
    if (key === lightMapKey) return
    lightMapKey = key
    const baked = fixtures?.children.length
      ? bakeFacilityFloorLightMap(current ?? [], fixtures, unit)
      : undefined
    const previous = lightMap
    lightMap = baked?.texture
    objectLighting.setLighting(baked, fixtures, unit)
    for (const { geometry, material, position } of meshes) {
      if (baked) {
        const points = geometry.getAttribute('position')
        const uv = new Float32Array(points.count * 2)
        for (let i = 0; i < points.count; i++) {
          uv[i * 2] = (points.getX(i) + position.x / unit - baked.bounds.min.x) / baked.size.x
          uv[i * 2 + 1] = (points.getY(i) + position.y / unit - baked.bounds.min.y) / baked.size.y
        }
        geometry.setAttribute('uv1', new THREE.BufferAttribute(uv, 2))
      }
      if (Boolean(material.lightMap) !== Boolean(lightMap)) material.needsUpdate = true
      material.lightMap = lightMap ?? null
      material.lightMapIntensity = 6
    }
    previous?.dispose()
  }

  /** 프로젝트 이미지의 중복 읽기와 해석 방지 */
  const prepareTextures = async (areas: FloorArea[] | undefined, reader?: SceneResourceReader) => {
    await Promise.all(
      (areas ?? []).flatMap(({ material, texture: reference }) => {
        if (!reference) return []
        if (!reader) throw new Error('바닥 이미지를 읽으려면 프로젝트 폴더를 열어 주세요.')
        const key = material + ':' + reference.hash
        let entry = externalTextures.get(key)
        if (!entry) {
          const pending = reader(reference)
            .then(async (bytes) => {
              const url = URL.createObjectURL(new Blob([bytes]))
              try {
                const texture = await new THREE.TextureLoader().loadAsync(url)
                if (disposed) texture.dispose()
                else entry!.texture = texture
                return texture
              } finally {
                URL.revokeObjectURL(url)
              }
            })
            .catch((error: unknown) => {
              externalTextures.delete(key)
              throw error
            })
          entry = { pending }
          externalTextures.set(key, entry)
        }
        return [entry.pending]
      }),
    )
  }

  /** 바닥 경계의 길이와 설정한 패턴 간격으로 반복 좌표를 구성 */
  const setAreas = (areas?: FloorArea[]) => {
    if (areas === current) return
    current = areas
    clear()
    const requested = new Set(
      (areas ?? []).flatMap(({ material, texture }) =>
        texture ? [material + ':' + texture.hash] : [],
      ),
    )
    for (const [key, entry] of externalTextures)
      if (!requested.has(key) && entry.texture) {
        entry.texture.dispose()
        externalTextures.delete(key)
      }
    for (const [index, area] of (areas ?? []).entries()) {
      const origin = area.points[0]!
      const showroomEpoxy = area.material === 'showroom-epoxy'
      const shape = new THREE.Shape(
        area.points.map((point) => new THREE.Vector2(point.x - origin.x, point.y - origin.y)),
      )
      const geometry = new THREE.ShapeGeometry(shape)
      const radians = THREE.MathUtils.degToRad(area.rotation)
      const cos = Math.cos(radians)
      const sin = Math.sin(radians)
      const positions = geometry.getAttribute('position')
      const uv = geometry.getAttribute('uv')
      const reference = area.texture
      const external =
        reference && externalTextures.get(area.material + ':' + reference.hash)?.texture
      /** 사용자 이미지의 원본 가로 세로 비율을 반복 패턴에 적용 */
      const image = external && external.image
      const aspect =
        area.textureName && image instanceof HTMLImageElement && image.naturalWidth
          ? image.naturalHeight / image.naturalWidth
          : 1
      // 같은 방향과 간격을 쓰는 쇼룸 영역의 경계에서 무늬를 이어 주는 지도 원점 기준
      const patternX = showroomEpoxy ? origin.x : 0
      const patternY = showroomEpoxy ? origin.y : 0
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i) + patternX
        const y = positions.getY(i) + patternY
        uv.setXY(
          i,
          (x * cos + y * sin) / area.repeatMm,
          (-x * sin + y * cos) / (area.repeatMm * aspect),
        )
      }
      let texture = external || textures.get(area.material)
      if (!texture) {
        texture = showroomEpoxy
          ? new THREE.TextureLoader().load(showroomEpoxyUrl, (loaded) => {
              if (textures.get(area.material) === loaded) onTextureReady()
            })
          : createProceduralTexture(area.material)
        textures.set(area.material, texture)
      }
      texture.colorSpace = THREE.SRGBColorSpace
      // 맞닿는 쪽의 색 차이를 줄이기 위한 사진 기반 텍스처의 반전 반복
      texture.wrapS = texture.wrapT = showroomEpoxy
        ? THREE.MirroredRepeatWrapping
        : THREE.RepeatWrapping
      texture.anisotropy = 4
      const { roughness, reliefMm } = floorFinish[area.material]
      const parameters: THREE.MeshStandardMaterialParameters = {
        color: area.color,
        map: texture,
        roughness,
        bumpMap: reliefMm ? texture : null,
        bumpScale: reliefMm * unit,
        // 낮은 시점에서도 기본 바닥 뒤로 사라지지 않도록 바닥끼리는 렌더 순서로 합성
        depthTest: false,
        depthWrite: false,
      }
      const material = showroomEpoxy
        ? new THREE.MeshPhysicalMaterial({
            ...parameters,
            // 저장된 색조를 유지하며 바닥을 살짝 밝히고, 실내 조명 맵의 천장을 지도 Z축에 맞춘다.
            color: new THREE.Color(area.color).lerp(new THREE.Color(0xffffff), 0.18),
            envMap: environment,
            envMapRotation: new THREE.Euler(Math.PI / 2, 0, 0),
            envMapIntensity: 0.68,
            specularIntensity: 0.7,
            clearcoat: 0.65,
            clearcoatRoughness: 0.3,
          })
        : new THREE.MeshStandardMaterial(parameters)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = area.name
      mesh.receiveShadow = true
      mesh.position.set(origin.x * unit, origin.y * unit, 0)
      mesh.scale.setScalar(unit)
      mesh.renderOrder = -160 + index / MAX_FLOOR_AREAS
      group.add(mesh)
      meshes.push(mesh)
    }
  }

  /** 장면이 닫힐 때 바닥의 형상과 캐시한 재질 자원을 함께 해제 */
  const dispose = () => {
    disposed = true
    setAreas()
    externalTextures.clear()
    for (const texture of textures.values()) texture.dispose()
    textures.clear()
  }

  const setEnvironmentEnabled = (enabled: boolean) => {
    if (!environment) return
    const envMap = enabled ? environment : null
    for (const { material } of meshes) {
      if (!(material instanceof THREE.MeshPhysicalMaterial) || material.envMap === envMap) continue
      material.envMap = envMap
      material.needsUpdate = true
    }
  }

  return {
    group,
    setAreas,
    prepareTextures,
    setFixtureLighting,
    applyFixtureLighting: objectLighting.apply,
    setEnvironmentEnabled,
    dispose,
  }
}
