/**
 * 파일명: facilityRulers.ts
 * 설명: 카메라 투영을 기준으로 3D 지도 상단과 좌측에 좌표 눈금 표시
 * 작성자: 이희원
 * 작성일자: 2026-11-24
 */
import * as THREE from 'three'
import { viewStep, type MapDocument } from '@/entities/map/index.ts'

const rulerSize = 24
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
const formatCoordinate = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 })

/**
 * 바닥과 교차하는 화면 위치에 실제 지도 좌표의 눈금을 배치
 * 원근 카메라의 눈금 위치를 다시 투영하고 수평선 근처에서는 화면 중앙과 가까운 바닥을 기준으로 사용
 * @param context 지도 라벨과 눈금을 합성하는 픽셀 보정 컨텍스트
 * @param camera 바닥 좌표를 화면으로 투영하는 편집 카메라
 * @param width 지도 영역의 가로 화면 길이
 * @param height 지도 영역의 세로 화면 길이
 * @param colors 지도 테마의 바탕색과 글자색 및 격자색
 * @param units 실측 축척을 반영한 현재 지도 좌표 단위
 */
export const drawFacilityRulers = (
  context: CanvasRenderingContext2D,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  colors: { background: number; font: number; grid: number },
  units: MapDocument['units'],
) => {
  if (width < 100 || height < 100) return

  const ray = new THREE.Raycaster()
  const screen = new THREE.Vector2()
  const projected = new THREE.Vector3()

  /** 화면 좌표를 바닥 평면과 만나는 3D 좌표로 변환 */
  const groundAt = (x: number, y: number) => {
    ray.setFromCamera(screen.set((x * 2) / width - 1, 1 - (y * 2) / height), camera)
    return ray.ray.intersectPlane(groundPlane, new THREE.Vector3())
  }

  const center = groundAt(width / 2, height / 2)
  const distanceLimit = center ? camera.position.distanceTo(center) * 6 : camera.far
  const corner = groundAt(rulerSize, rulerSize)
  const upperRight = groundAt(width, rulerSize)
  const lowerLeft = groundAt(rulerSize, height)
  const nearGround = (point: THREE.Vector3 | null) =>
    point !== null && camera.position.distanceTo(point) <= distanceLimit
  const [rightX, rightY] = camera.matrixWorld.elements
  const topAxis = Math.abs(rightX) + 1e-8 >= Math.abs(rightY) ? 'x' : 'y'
  const leftAxis = topAxis === 'x' ? 'y' : 'x'

  context.save()
  context.fillStyle = `#${colors.background.toString(16).padStart(6, '0')}`
  context.fillRect(0, 0, width, rulerSize)
  context.fillRect(0, rulerSize, rulerSize, height - rulerSize)
  context.strokeStyle = `#${colors.grid.toString(16).padStart(6, '0')}`
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(rulerSize - 0.5, height)
  context.lineTo(rulerSize - 0.5, rulerSize - 0.5)
  context.lineTo(width, rulerSize - 0.5)
  context.stroke()
  context.fillStyle = `#${colors.font.toString(16).padStart(6, '0')}`
  context.font = '11px Pretendard, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  /** 가로 또는 좌측 눈금의 단위와 좌표를 띠에 맞춰 같은 방향으로 표시 */
  const drawAxis = (
    axis: 'x' | 'y',
    horizontal: boolean,
    start: THREE.Vector3 | null,
    end: THREE.Vector3 | null,
  ) => {
    const length = horizontal ? width : height
    context.save()
    if (!horizontal) {
      context.translate(0, height)
      context.rotate(-Math.PI / 2)
    }
    const header = horizontal ? 50 : height - 50
    const label = `${axis.toUpperCase()} · ${units}`
    const headerPadding = context.measureText(label).width / 2 + 12
    const minPixel = horizontal ? header + headerPadding : 6
    const maxPixel = horizontal ? length - 6 : header - headerPadding
    context.fillText(label, header, 10)
    if (start && end) {
      const from = start[axis] * 1000
      const to = end[axis] * 1000
      const span = Math.abs(to - from)
      const step = Math.max(1, viewStep(span, length, 105))
      const first = Math.ceil(Math.min(from, to) / step)
      const last = Math.floor(Math.max(from, to) / step)
      let previousPixel = -Infinity
      let previousHalfWidth = 0
      for (let index = first; index <= last && span >= 1; index++) {
        const value = index * step
        projected.copy(start).lerp(end, (value - from) / (to - from)).project(camera)
        const pixel = (((horizontal ? projected.x : projected.y) + 1) * length) / 2
        const coordinate = formatCoordinate.format(value === 0 ? 0 : value)
        const halfWidth = context.measureText(coordinate).width / 2
        if (
          pixel - halfWidth < minPixel ||
          pixel + halfWidth > maxPixel ||
          Math.abs(pixel - previousPixel) < Math.max(66, halfWidth + previousHalfWidth + 10)
        ) continue
        context.beginPath()
        context.moveTo(pixel, rulerSize - 6)
        context.lineTo(pixel, rulerSize)
        context.stroke()
        context.fillText(coordinate, pixel, 10)
        previousPixel = pixel
        previousHalfWidth = halfWidth
      }
    }
    context.restore()
  }

  const topAtEdge = nearGround(corner) && nearGround(upperRight)
  drawAxis(
    topAxis,
    true,
    topAtEdge ? corner : groundAt(rulerSize, height / 2),
    topAtEdge ? upperRight : groundAt(width, height / 2),
  )
  drawAxis(leftAxis, false, nearGround(corner) ? corner : groundAt(rulerSize, height / 2), lowerLeft)
  context.restore()
}
