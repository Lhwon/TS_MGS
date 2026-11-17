/**
 * 파일명: createMapShapes.ts
 * 설명: 원본 사용자 도형의 외곽선과 채움 무늬를 공유하는 지도 도형 생성
 * 작성자: 이희원
 * 작성일자: 2026-11-04
 */
import * as THREE from 'three'
import type { MapDocument } from '@/entities/map/model/map.ts'
import { mgsTheme } from '@/entities/map/model/view.ts'
import { mapObjectColor } from '@/entities/map/lib/createMapLabels.ts'

/**
 * 원본 브러시 스타일을 반복 무늬로 변환하는 채움 텍스처 생성
 * @param style 원본 채움 스타일
 * @param color 원본 채움 색상
 * @returns 지도 좌표에 반복하는 채움 텍스처
 */
const patternTexture = (style: number, color: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
  ctx.strokeStyle = ctx.fillStyle
  ctx.lineWidth = style === 2 || style === 3 || style === 6 ? 16 : 3.2
  ctx.beginPath()
  if (style === 1) {
    ctx.fillRect(0, 0, 32, 32)
    ctx.strokeStyle = '#ffffff'
    ctx.moveTo(0, 0)
    ctx.lineTo(32, 0)
    ctx.moveTo(0, 16)
    ctx.lineTo(32, 16)
    ctx.moveTo(0, 0)
    ctx.lineTo(0, 16)
    ctx.moveTo(16, 16)
    ctx.lineTo(16, 32)
  }
  if (style === 2 || style === 6) {
    ctx.moveTo(0, 16)
    ctx.lineTo(32, 16)
  }
  if (style === 3 || style === 6) {
    ctx.moveTo(16, 0)
    ctx.lineTo(16, 32)
  }
  if (style === 4 || style === 7) {
    ctx.moveTo(0, 0)
    ctx.lineTo(32, 32)
  }
  if (style === 5 || style === 7) {
    ctx.moveTo(0, 32)
    ctx.lineTo(32, 0)
  }
  if (style === 8) {
    ctx.fillRect(0, 0, 16, 16)
    ctx.fillRect(16, 16, 16, 16)
  }
  ctx.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(style === 1 ? 1 / 300 : 1 / 100, style === 1 ? 1 / 400 : 1 / 100)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * 직사각형과 타원 및 선의 원본 좌표와 외곽 두께를 유지하는 도형 생성
 * @param map 원본 사용자 도형을 포함하는 지도
 * @param theme 두 화면에서 공유하는 지도 테마
 * @returns 지도 바닥에 배치하는 도형 그룹
 */
export const createMapShapes = (map: MapDocument, theme: ReturnType<typeof mgsTheme>) => {
  const group = new THREE.Group()
  group.name = 'map-shapes'
  for (const item of map.shapes ?? []) {
    const contour = new THREE.Shape()
    const cx = (item.x1 + item.x2) / 2,
      cy = (item.y1 + item.y2) / 2
    const width = item.type === 3 ? item.width : Math.abs(item.x2 - item.x1)
    const height =
      item.type === 3 ? item.height : item.type === 4 ? width : Math.abs(item.y2 - item.y1)
    if (item.type === 3 || item.type === 4)
      contour.absellipse(cx, cy, width / 2, height / 2, 0, Math.PI * 2, false, 0)
    else if (item.type === 5) {
      contour.moveTo(item.x1, item.y1)
      contour.lineTo(item.x2, item.y2)
    } else if (item.type < 3) {
      const left = cx - width / 2,
        right = cx + width / 2,
        bottom = cy - height / 2,
        top = cy + height / 2
      const r = item.type === 2 ? Math.min(width, height) / 10 : 0
      contour.moveTo(left + r, bottom)
      contour.lineTo(right - r, bottom)
      contour.quadraticCurveTo(right, bottom, right, bottom + r)
      contour.lineTo(right, top - r)
      contour.quadraticCurveTo(right, top, right - r, top)
      contour.lineTo(left + r, top)
      contour.quadraticCurveTo(left, top, left, top - r)
      contour.lineTo(left, bottom + r)
      contour.quadraticCurveTo(left, bottom, left + r, bottom)
      contour.closePath()
    }
    if (item.type < 5 && item.fillStyle !== 9) {
      const color = mapObjectColor(item.fillColor, theme)
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(contour, 32),
        new THREE.MeshBasicMaterial({
          color: item.fillStyle > 0 && item.fillStyle <= 8 ? 0xffffff : color,
          map:
            item.fillStyle > 0 && item.fillStyle <= 8
              ? patternTexture(item.fillStyle, color)
              : null,
          // 투명 정렬로 도형 채움이 노드 위에 덮이는 현상을 방지하는 무늬 절삭
          transparent: false,
          alphaTest: 0.01,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      )
      mesh.position.z = -3
      group.add(mesh)
    }
    if (item.type < 6 && item.strokeWidth > 0) {
      const points = contour.getPoints(32)
      const vertices: number[] = []
      const half = item.strokeWidth * 5
      const dash =
        item.type === 5
          ? ([[], [2, 2], [4, 4, 2, 2], [4, 4, 2, 2, 2, 2], [2, 2, 1, 1, 1, 1]][item.strokeStyle] ??
            [])
          : []
      // 원본 선 스타일의 두께 배수를 적용하는 점선 구간 분할
      if (dash.length && points.length > 1) {
        const start = points[0]!,
          end = points[points.length - 1]!,
          length = start.distanceTo(end)
        const pieces: THREE.Vector2[] = []
        let offset = 0,
          index = 0
        while (offset < length && pieces.length < 200000) {
          const next = Math.min(length, offset + dash[index % dash.length]! * item.strokeWidth * 10)
          if (index % 2 === 0) {
            pieces.push(
              start.clone().lerp(end, offset / length),
              start.clone().lerp(end, next / length),
            )
          }
          offset = next
          index++
        }
        points.splice(0, points.length, ...pieces)
      }
      for (let i = 1; i < points.length; i += dash.length ? 2 : 1) {
        const a = points[i - 1]!,
          b = points[i]!,
          length = a.distanceTo(b)
        if (!length) continue
        const dx = (-(b.y - a.y) / length) * half,
          dy = ((b.x - a.x) / length) * half
        vertices.push(
          a.x + dx,
          a.y + dy,
          -2,
          a.x - dx,
          a.y - dy,
          -2,
          b.x + dx,
          b.y + dy,
          -2,
          b.x + dx,
          b.y + dy,
          -2,
          a.x - dx,
          a.y - dy,
          -2,
          b.x - dx,
          b.y - dy,
          -2,
        )
      }
      group.add(
        new THREE.Mesh(
          new THREE.BufferGeometry().setAttribute(
            'position',
            new THREE.Float32BufferAttribute(vertices, 3),
          ),
          new THREE.MeshBasicMaterial({
            color: mapObjectColor(item.strokeColor, theme),
            side: THREE.DoubleSide,
          }),
        ),
      )
    }
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(20, 25, 16),
      new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide }),
    )
    marker.position.set(item.centerX, item.centerY, -1)
    group.add(marker)
  }
  // 도형 목록의 앞뒤 순서를 유지하며 경로와 포트보다 먼저 그리는 평면 레이어
  group.children.forEach((object, index) => {
    object.renderOrder = -130 + index / (group.children.length + 1)
  })
  return group
}
