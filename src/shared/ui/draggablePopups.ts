/**
 * 파일명: draggablePopups.ts
 * 설명: 팝업 제목 표시줄 드래그와 앱 화면 경계 처리
 * 작성자: 이희원
 * 작성일자: 2026-11-19
 */

const headingSelector = '.popup-drag-handle, .v-dialog > .v-overlay__content > .v-card > .v-card-item'
const popupSelector = 'dialog, .v-dialog > .v-overlay__content'

/** 화면 안에 팝업이 들어오도록 이동량을 제한하는 계산 */
const clampOffset = (offset: number, start: number, end: number, viewport: number) =>
  Math.max(-start, Math.min(offset, viewport - end))

/** 기존 팝업 위치에 화면 경계를 적용한 이동량을 더하는 처리 */
const movePopup = (popup: HTMLElement, bounds: DOMRect, dx: number, dy: number, x: number, y: number) => {
  const viewport = document.documentElement
  const nextX = x + clampOffset(dx, bounds.left, bounds.right, viewport.clientWidth)
  const nextY = y + clampOffset(dy, bounds.top, bounds.bottom, viewport.clientHeight)
  popup.style.translate = `${nextX}px ${nextY}px`
  popup.dataset.popupMoved = ''
}

/** Teleport로 열린 팝업을 포함하여 공통 드래그 이벤트를 연결하는 설정 */
export const enablePopupDragging = () => {
  const listeners = new AbortController()
  const options = { signal: listeners.signal }
  let drag:
    | {
        popup: HTMLElement
        pointer: number
        bounds: DOMRect
        startX: number
        startY: number
        x: number
        y: number
      }
    | undefined

  /** 현재 팝업의 위치를 기준으로 새 드래그를 시작하는 처리 */
  const start = (event: PointerEvent) => {
    if (drag || event.button !== 0 || !(event.target instanceof Element)) return
    const handle = event.target.closest<HTMLElement>(headingSelector)
    const popup = handle?.closest<HTMLElement>(popupSelector)
    if (
      !handle ||
      !popup ||
      event.target.closest('button, a, input, select, textarea, [role="button"]')
    )
      return

    const [x = 0, y = 0] = popup.style.translate.split(' ').map((value) => parseFloat(value) || 0)
    drag = {
      popup,
      pointer: event.pointerId,
      bounds: popup.getBoundingClientRect(),
      startX: event.clientX,
      startY: event.clientY,
      x,
      y,
    }
    handle.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  /** 포인터가 제목 표시줄을 벗어나도 팝업을 계속 이동하는 처리 */
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return
    movePopup(
      drag.popup,
      drag.bounds,
      event.clientX - drag.startX,
      event.clientY - drag.startY,
      drag.x,
      drag.y,
    )
  }

  /** 포인터 해제와 취소 시 드래그를 종료하는 처리 */
  const stop = (event: PointerEvent) => {
    if (event.pointerId === drag?.pointer) drag = undefined
  }

  /** 앱 창 크기가 변경되면 이동한 팝업을 화면 안으로 보정하는 처리 */
  const fitMovedPopups = () => {
    for (const popup of document.querySelectorAll<HTMLElement>('[data-popup-moved]')) {
      if (!popup.getClientRects().length) continue
      const [x = 0, y = 0] = popup.style.translate.split(' ').map(parseFloat)
      movePopup(popup, popup.getBoundingClientRect(), 0, 0, x, y)
      if (drag?.popup === popup) drag = undefined
    }
  }

  /** 네이티브 팝업을 다시 열 때 원래 위치로 표시하는 초기화 */
  const resetNativePosition = (event: Event) => {
    if (!(event.target instanceof HTMLDialogElement) || event.target.open) return
    event.target.style.removeProperty('translate')
    delete event.target.dataset.popupMoved
    if (drag?.popup === event.target) drag = undefined
  }

  document.addEventListener('pointerdown', start, options)
  document.addEventListener('pointermove', move, options)
  document.addEventListener('pointerup', stop, options)
  document.addEventListener('pointercancel', stop, options)
  document.addEventListener('lostpointercapture', stop, options)
  document.addEventListener('close', resetNativePosition, { ...options, capture: true })
  window.addEventListener('resize', fitMovedPopups, options)

  return () => listeners.abort()
}
