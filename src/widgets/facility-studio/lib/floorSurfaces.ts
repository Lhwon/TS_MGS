/**
 * 파일명: floorSurfaces.ts
 * 설명: 밀리미터 단위 바닥 경계와 반복 재질을 지도 하단에 표시하는 렌더러
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */
import * as THREE from 'three'
import { MAX_FLOOR_AREAS, type FloorArea, type FloorMaterial } from '@/entities/facility/index.ts'

/** 면적과 관계없이 일정한 간격으로 반복할 기본 재질 텍스처 생성 */
const createTexture = (material: FloorMaterial) => {
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

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  return texture
}

// 바닥 재질의 반사 특성과 표면 요철 높이
const floorFinish = {
  concrete: { roughness: 0.87, reliefMm: 0.65 },
  epoxy: { roughness: 0.34, reliefMm: 0 },
  tile: { roughness: 0.49, reliefMm: 0.45 },
  wood: { roughness: 0.62, reliefMm: 0.25 },
} as const

/** 바닥 재질을 지도 객체보다 먼저 그리고 목록의 위쪽 영역을 마지막에 합성 */
export const createFloorSurfaces = (unit: number) => {
  const group = new THREE.Group()
  const textures = new Map<FloorMaterial, THREE.Texture>()
  let meshes: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshStandardMaterial>[] = []
  let current: FloorArea[] | undefined

  /** 기존 면의 버퍼와 재질을 해제하며 공용 반복 텍스처는 유지 */
  const clear = () => {
    for (const mesh of meshes) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    meshes = []
    group.clear()
  }

  /** 바닥 경계의 길이와 설정한 패턴 간격으로 반복 좌표를 구성 */
  const setAreas = (areas?: FloorArea[]) => {
    if (areas === current) return
    current = areas
    clear()
    for (const [index, area] of (areas ?? []).entries()) {
      const origin = area.points[0]!
      const shape = new THREE.Shape(
        area.points.map((point) => new THREE.Vector2(point.x - origin.x, point.y - origin.y)),
      )
      const geometry = new THREE.ShapeGeometry(shape)
      const radians = THREE.MathUtils.degToRad(area.rotation)
      const cos = Math.cos(radians)
      const sin = Math.sin(radians)
      const positions = geometry.getAttribute('position')
      const uv = geometry.getAttribute('uv')
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i)
        const y = positions.getY(i)
        uv.setXY(i, (x * cos + y * sin) / area.repeatMm, (-x * sin + y * cos) / area.repeatMm)
      }
      let texture = textures.get(area.material)
      if (!texture) {
        texture = createTexture(area.material)
        textures.set(area.material, texture)
      }
      const { roughness, reliefMm } = floorFinish[area.material]
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: area.color,
          map: texture,
          roughness,
          bumpMap: reliefMm ? texture : null,
          bumpScale: reliefMm * unit,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      )
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
    setAreas()
    for (const texture of textures.values()) texture.dispose()
    textures.clear()
  }

  return { group, setAreas, dispose }
}
