/**
 * 파일명: directTransform.ts
 * 설명: 선택한 삼차원 설비를 화면에서 직접 변형하는 조작 핸들
 * 작성자: 이희원
 * 작성일자: 2026-11-23
 */
import * as THREE from 'three'
import type { FacilityInstance, facilityScaleLimits, Point3 } from '@/entities/facility/index.ts'
import { projectSelectionHandles, type SelectionProjection } from '@/widgets/facility-studio/lib/selectionHandles.ts'
import { snapToStep } from '@/widgets/facility-studio/lib/transformSnap.ts'

type Handle = 'uniform' | 'x' | 'y' | 'z' | 'rotate'
type Pose = { position: Point3; rotation: number; scale: Point3 }
type ScaleLimits = ReturnType<typeof facilityScaleLimits>

const identityScale = { x: 1, y: 1, z: 1 }
const verticalAxis = new THREE.Vector3(0, 0, 1)
const modelAxes = ['x', 'y', 'z'] as const

/**
 * 마우스와 키보드에서 동일한 축별 범위를 적용하는 직접 크기 조절
 * @param scale 조작 시작 시 원본 배율
 * @param handle 크기를 바꿀 단일 축 또는 전체 크기 조절 핸들
 * @param factor 화면 조작으로 변환한 크기 변경 비율
 * @param limits 원본 모델과 벽 부착물에 맞는 축별 배율 범위
 * @returns 편집 가능한 범위로 보정한 배치 배율
 */
const resizeScale = (scale: Point3, handle: Exclude<Handle, 'rotate'>, factor: number, limits: ScaleLimits) => {
  const { minimum, maximum } = limits
  const next = { ...scale }
  const axes = handle === 'uniform' ? modelAxes : [handle]
  const ratio = handle === 'uniform'
    ? THREE.MathUtils.clamp(
        factor,
        Math.max(...axes.map((axis) => minimum[axis] / scale[axis])),
        Math.min(...axes.map((axis) => maximum[axis] / scale[axis])),
      )
    : factor
  for (const axis of axes)
    next[axis] = THREE.MathUtils.clamp(scale[axis] * ratio, minimum[axis], maximum[axis])
  return next
}

/**
 * 조작 전후 기준점의 월드 위치를 유지하도록 배치 원점 보정
 * @param instance 조작 시작 시 확정된 원본 모델 배치
 * @param anchor 모델 로컬 미터 좌표의 고정점
 * @param scale 변경할 축별 배율
 * @param rotation 변경할 지도 평면의 회전 각도
 * @returns 지도 밀리미터 좌표와 배율 및 회전 각도를 포함한 변형 결과
 */
const anchoredPose = (instance: FacilityInstance, anchor: THREE.Vector3, scale: Point3, rotation: number): Pose => {
  const previousScale = instance.scale ?? identityScale
  const before = anchor.clone().multiply(previousScale)
    .applyAxisAngle(verticalAxis, THREE.MathUtils.degToRad(instance.rotation))
  const after = anchor.clone().multiply(scale)
    .applyAxisAngle(verticalAxis, THREE.MathUtils.degToRad(rotation))
  const offset = before.sub(after).multiplyScalar(1000)
  return {
    position: {
      x: instance.position.x + offset.x,
      y: instance.position.y + offset.y,
      z: instance.position.z + offset.z,
    },
    scale,
    rotation,
  }
}

/** 선택 영역을 화면에 투영하고 핸들의 조작을 한 번의 변형으로 반영 */
export const createDirectTransform = (
  host: HTMLElement,
  camera: THREE.PerspectiveCamera,
  events: {
    target(): FacilityInstance | undefined
    scaleLimits(instance: FacilityInstance): ScaleLimits
    snapStep(): number
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
  let handlesProjection: ReturnType<typeof projectSelectionHandles>
  let gesture: {
    id: number
    handle: Handle
    instance: FacilityInstance
    scale: Point3
    limits: ScaleLimits
    anchor: THREE.Vector3
    center: THREE.Vector2
    origin: THREE.Vector2
    outward: THREE.Vector2
    baseSize: THREE.Vector3
    pointer?: PointerEvent
    pose?: Pose
  } | undefined

  /** 조작을 시작한 배치와 화면 기준점 및 배율 제한 기록 */
  const start = (event: PointerEvent, handle: Handle, placement: string) => {
    const instance = events.target()
    const point = handlesProjection?.points.get(placement)
    if (event.button !== 0 || !instance || !point || !handlesProjection || gesture) return
    event.preventDefault()
    const button = event.currentTarget as HTMLButtonElement
    button.focus()
    button.setPointerCapture(event.pointerId)
    const { left, top } = host.getBoundingClientRect()
    gesture = {
      id: event.pointerId,
      handle,
      instance,
      scale: instance.scale ?? identityScale,
      limits: events.scaleLimits(instance),
      anchor: point.anchor,
      center: handlesProjection.center.clone().add(new THREE.Vector2(left, top)),
      origin: new THREE.Vector2(event.clientX, event.clientY),
      outward: point.outward,
      baseSize: handlesProjection.baseSize,
    }
  }

  /** 마우스 이동을 비율 또는 Z축 회전으로 바꾸고 렌더링에만 우선 적용 */
  const applyPointer = (event: PointerEvent, free = event.altKey, commit = false) => {
    const drag = gesture
    if (!drag || event.pointerId !== drag.id) return
    const pointer = new THREE.Vector2(event.clientX, event.clientY)
    const offset = pointer.clone().sub(drag.origin)
    if (!drag.pose && offset.length() < 2) return
    drag.pointer = event
    let scale = drag.scale
    let rotation = drag.instance.rotation
    if (drag.handle === 'rotate') {
      const from = drag.origin.clone().sub(drag.center).angle()
      const to = pointer.sub(drag.center).angle()
      rotation -= THREE.MathUtils.radToDeg(to - from)
      if (!free) rotation = snapToStep(rotation, 15)
      rotation = ((rotation + 180) % 360 + 360) % 360 - 180
    } else {
      const movement = offset.dot(drag.outward.clone().normalize())
      let factor = 1 + movement / Math.max(28, drag.outward.length())
      if (!free) {
        const length = (drag.handle === 'uniform'
          ? Math.max(...modelAxes.map((axis) => drag.baseSize[axis] * scale[axis]))
          : drag.baseSize[drag.handle] * scale[drag.handle]) * 1000
        const step = events.snapStep()
        if (length > 0) factor = Math.max(step, snapToStep(length * factor, step)) / length
      }
      scale = resizeScale(scale, drag.handle, factor, drag.limits)
    }
    if (commit && (rotation - drag.instance.rotation) % 360 === 0 &&
      modelAxes.every((axis) => scale[axis] === drag.scale[axis])) {
      events.restore(drag.instance)
      return
    }
    drag.pose = anchoredPose(drag.instance, drag.anchor, scale, rotation)
    events.update(drag.instance, drag.pose, commit)
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
    ['x', 'x', '가로 X 양의 방향 조절'],
    ['x', 'x-min', '가로 X 음의 방향 조절'],
    ['y', 'y', '세로 Y 양의 방향 조절'],
    ['y', 'y-min', '세로 Y 음의 방향 조절'],
    ['z', 'z', '높이 Z 위쪽 조절'],
    ['z', 'z-min', '높이 Z 아래쪽 조절'],
    ['rotate', 'rotate', '회전'],
  ] as const
  const buttons = handles.map(([handle, placement, label]) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `facility-direct-handle facility-direct-${placement}`
    button.dataset.testid = `direct-${placement}`
    button.title = label
    button.setAttribute('aria-label', label)
    button.textContent = handle === 'rotate' ? '↻' : handle === 'uniform' ? '' : handle.toUpperCase()
    button.addEventListener('pointerdown', (event) => start(event, handle, placement))
    button.addEventListener('pointermove', (event) => applyPointer(event))
    button.addEventListener('pointerup', (event) => {
      if (event.pointerId !== gesture?.id) return
      if (gesture.pose) applyPointer(event, event.altKey, true)
      gesture = undefined
    })
    button.addEventListener('lostpointercapture', cancel)
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!gesture) return
        event.stopPropagation()
        cancel()
        return
      }
      const direction = ['ArrowUp', 'ArrowRight'].includes(event.key)
        ? 1 : ['ArrowDown', 'ArrowLeft'].includes(event.key) ? -1 : 0
      const instance = events.target()
      const point = handlesProjection?.points.get(placement)
      if (!direction || !instance || !point || gesture || event.ctrlKey || event.altKey || event.metaKey) return
      event.preventDefault()
      const previousScale = instance.scale ?? identityScale
      const factor = 1 + direction * (event.shiftKey ? 0.1 : 0.02)
      const scale = handle === 'rotate'
        ? previousScale
        : resizeScale(previousScale, handle, factor, events.scaleLimits(instance))
      const rotation = instance.rotation + (handle === 'rotate' ? direction * (event.shiftKey ? 15 : 1) : 0)
      events.update(instance, anchoredPose(instance, point.anchor, scale, rotation), true)
    })
    frame.append(button)
    return { button, placement }
  })

  /** 카메라와 모델 변형을 반영한 실제 바깥 변의 중앙에 편집 핸들 배치 */
  const draw = (selection?: SelectionProjection) => {
    const { clientWidth, clientHeight } = host
    handlesProjection = selection && projectSelectionHandles(selection, camera, clientWidth, clientHeight)
    frame.hidden = !handlesProjection
    for (const { button, placement } of buttons) {
      const point = handlesProjection?.points.get(placement)?.screen
      button.hidden = !point || point.x < 0 || point.x > clientWidth || point.y < 0 || point.y > clientHeight
      if (!button.hidden && point) {
        button.style.left = `${point.x}px`
        button.style.top = `${point.y}px`
      }
    }
  }

  return {
    draw,
    cancel,
    /** 포인터 위치가 같아도 현재 Alt 상태를 미리보기에 반영 */
    refreshSnap: (free: boolean) => {
      if (!gesture) return false
      if (gesture.pointer) applyPointer(gesture.pointer, free)
      return true
    },
    dispose: () => frame.remove(),
  }
}
