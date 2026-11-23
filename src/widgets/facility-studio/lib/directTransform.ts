/**
 * 파일명: directTransform.ts
 * 설명: 선택한 삼차원 설비를 화면에서 직접 변형하는 조작 핸들
 * 작성자: 이희원
 * 작성일자: 2026-11-23
 */
import * as THREE from 'three'
import type { FacilityInstance, Point3 } from '@/entities/facility/index.ts'

type Handle = 'uniform' | 'x' | 'y' | 'z' | 'rotate'
type Pose = { position: Point3; rotation: number; scale: Point3 }

/** 선택 영역을 화면에 투영하고 핸들의 조작을 한 번의 변형으로 반영 */
export const createDirectTransform = (
  host: HTMLElement,
  camera: THREE.PerspectiveCamera,
  events: {
    target(): FacilityInstance | undefined
    minimum(instance: FacilityInstance): Point3
    update(instance: FacilityInstance, pose: Pose, commit: boolean): void
    restore(instance: FacilityInstance): void
  },
) => {
  const frame = document.createElement('div')
  frame.className = 'facility-direct-frame'
  frame.dataset.testid = 'direct-transform'
  frame.hidden = true
  frame.setAttribute('role', 'group')
  frame.setAttribute('aria-label', '객체 직접 편집')
  host.append(frame)
  const projected = new THREE.Vector3()
  let gesture: {
    id: number
    handle: Handle
    instance: FacilityInstance
    scale: Point3
    minimum: Point3
    centerX: number
    centerY: number
    dx: number
    dy: number
    originX: number
    originY: number
    pose?: Pose
  } | undefined

  /** 조작을 시작한 배치와 화면 기준점 및 배율 제한 기록 */
  const start = (event: PointerEvent, handle: Handle) => {
    const instance = events.target()
    if (event.button !== 0 || !instance || gesture) return
    event.preventDefault()
    const button = event.currentTarget as HTMLButtonElement
    button.focus()
    button.setPointerCapture(event.pointerId)
    const bounds = frame.getBoundingClientRect()
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2
    gesture = {
      id: event.pointerId,
      handle,
      instance,
      scale: instance.scale ?? { x: 1, y: 1, z: 1 },
      minimum: events.minimum(instance),
      centerX,
      centerY,
      dx: event.clientX - centerX,
      dy: event.clientY - centerY,
      originX: event.clientX,
      originY: event.clientY,
    }
  }

  /** 마우스 이동을 비율 또는 Z축 회전으로 바꾸고 렌더링에만 우선 적용 */
  const move = (event: PointerEvent) => {
    const drag = gesture
    if (!drag || event.pointerId !== drag.id) return
    const offsetX = event.clientX - drag.originX
    const offsetY = event.clientY - drag.originY
    if (!drag.pose && Math.hypot(offsetX, offsetY) < 2) return
    const scale = { ...drag.scale }
    let rotation = drag.instance.rotation
    if (drag.handle === 'rotate') {
      const from = Math.atan2(drag.dy, drag.dx)
      const to = Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX)
      rotation -= THREE.MathUtils.radToDeg(to - from)
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15
      rotation = ((rotation + 180) % 360 + 360) % 360 - 180
    } else if (drag.handle === 'uniform') {
      const amount = 1 + (offsetX * drag.dx + offsetY * drag.dy) / (drag.dx ** 2 + drag.dy ** 2)
      const min = Math.max(drag.minimum.x / scale.x, drag.minimum.y / scale.y, drag.minimum.z / scale.z)
      const max = 1000 / Math.max(scale.x, scale.y, scale.z)
      const ratio = THREE.MathUtils.clamp(amount, min, max)
      scale.x *= ratio
      scale.y *= ratio
      scale.z *= ratio
    } else {
      const axis = drag.handle
      const movement = axis === 'x' ? offsetX : axis === 'y' ? offsetY : -offsetY
      const extent = axis === 'x' ? Math.abs(drag.dx) : Math.abs(drag.dy)
      scale[axis] = THREE.MathUtils.clamp(scale[axis] * (1 + movement / Math.max(14, extent)), drag.minimum[axis], 1000)
    }
    drag.pose = { position: drag.instance.position, rotation, scale }
    events.update(drag.instance, drag.pose, false)
  }

  /** 확정되지 않은 변경을 해제하고 시작 배치로 복원 */
  const cancel = () => {
    const drag = gesture
    gesture = undefined
    if (drag?.pose) events.restore(drag.instance)
  }

  const handles = [
    ['uniform', 'nw', '전체 크기 조절 왼쪽 위'],
    ['uniform', 'ne', '전체 크기 조절 오른쪽 위'],
    ['uniform', 'sw', '전체 크기 조절 왼쪽 아래'],
    ['uniform', 'se', '전체 크기 조절 오른쪽 아래'],
    ['x', 'x', '가로 조절'],
    ['y', 'y', '세로 조절'],
    ['z', 'z', '높이 조절'],
    ['rotate', 'rotate', '회전'],
  ] as const
  for (const [handle, placement, label] of handles) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `facility-direct-handle facility-direct-${placement}`
    button.dataset.testid = `direct-${placement}`
    button.title = label
    button.setAttribute('aria-label', label)
    button.textContent = handle === 'rotate' ? '↻' : handle === 'uniform' ? '' : handle.toUpperCase()
    button.addEventListener('pointerdown', (event) => start(event, handle))
    button.addEventListener('pointermove', move)
    button.addEventListener('pointerup', (event) => {
      if (event.pointerId !== gesture?.id) return
      const { instance, pose } = gesture
      gesture = undefined
      if (pose) events.update(instance, pose, true)
    })
    button.addEventListener('lostpointercapture', cancel)
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        cancel()
        return
      }
      const direction = ['ArrowUp', 'ArrowRight'].includes(event.key)
        ? 1 : ['ArrowDown', 'ArrowLeft'].includes(event.key) ? -1 : 0
      const instance = events.target()
      if (!direction || !instance || gesture || event.ctrlKey || event.altKey || event.metaKey) return
      event.preventDefault()
      const scale = { ...(instance.scale ?? { x: 1, y: 1, z: 1 }) }
      const minimum = events.minimum(instance)
      const axes = handle === 'uniform' ? ['x', 'y', 'z'] as const : handle === 'rotate' ? [] : [handle]
      const factor = 1 + direction * (event.shiftKey ? 0.1 : 0.02)
      if (handle === 'uniform') {
        const min = Math.max(minimum.x / scale.x, minimum.y / scale.y, minimum.z / scale.z)
        const max = 1000 / Math.max(scale.x, scale.y, scale.z)
        const ratio = THREE.MathUtils.clamp(factor, min, max)
        for (const axis of axes) scale[axis] *= ratio
      } else {
        for (const axis of axes)
          scale[axis] = THREE.MathUtils.clamp(scale[axis] * factor, minimum[axis], 1000)
      }
      const rotation = instance.rotation + (handle === 'rotate' ? direction * (event.shiftKey ? 15 : 1) : 0)
      events.update(instance, { position: instance.position, scale, rotation }, true)
    })
    frame.append(button)
  }

  /** 카메라 이동과 배치 미리보기에서 선택 영역의 화면 위치 갱신 */
  const draw = (bounds?: THREE.Box3) => {
    if (!bounds || bounds.isEmpty()) {
      frame.hidden = true
      return
    }
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          projected.set(x, y, z).project(camera)
          if (projected.z < -1 || projected.z > 1) continue
          const px = (projected.x + 1) * host.clientWidth / 2
          const py = (1 - projected.y) * host.clientHeight / 2
          left = Math.min(left, px)
          right = Math.max(right, px)
          top = Math.min(top, py)
          bottom = Math.max(bottom, py)
        }
    frame.hidden = !Number.isFinite(left) || right < 0 || bottom < 0 ||
      left > host.clientWidth || top > host.clientHeight
    if (frame.hidden) return
    const width = Math.min(host.clientWidth - 20, Math.max(34, right - left))
    const height = Math.min(host.clientHeight - 48, Math.max(34, bottom - top))
    if (width <= 0 || height <= 0) {
      frame.hidden = true
      return
    }
    frame.style.left = `${THREE.MathUtils.clamp((left + right - width) / 2, 10, host.clientWidth - width - 10)}px`
    frame.style.top = `${THREE.MathUtils.clamp((top + bottom - height) / 2, 38, host.clientHeight - height - 10)}px`
    frame.style.width = `${width}px`
    frame.style.height = `${height}px`
  }

  return { draw, cancel, dispose: () => frame.remove() }
}
