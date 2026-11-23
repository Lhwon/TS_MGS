/**
 * 파일명: index.ts
 * 설명: 입력 필드의 공백 입력을 보존하며 두 렌더러의 스페이스 이동 상태를 관리하는 공통 입력 처리
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */

/**
 * 키 해제와 창 포커스 이탈을 포함하여 스페이스 이동 상태를 관리하는 입력 수명주기 구성
 * @param onPanChange 이동 모드 변경에 맞춰 커서와 렌더러 동작을 갱신하는 콜백
 * @param scope 대화상자 내부에서도 이동을 허용할 전용 캔버스 영역
 * @returns 이동 상태 조회와 이벤트 자원 해제 함수 묶음
 */
export const createSpacePan = (onPanChange: (pressed: boolean) => void, scope?: HTMLElement) => {
  let isSpacePressed = false
  /**
   * 텍스트 입력을 제외한 공백 키를 이동 모드로 전환하는 키 누름 처리
   * @param event 현재 포커스와 키 정보를 포함하는 키보드 이벤트
   */
  const handleSpaceKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return
    if (scope && (!(event.target instanceof Node) || !scope.contains(event.target))) return
    if (
      event.target instanceof HTMLElement &&
      (event.target.closest(
        'input,textarea,select,button,a,[role="button"],[role="tab"],[contenteditable="true"]',
      ) ||
        (!scope && document.querySelector('dialog[open], .v-dialog.v-overlay--active')))
    )
      return
    event.preventDefault()
    if (isSpacePressed) return
    isSpacePressed = true
    onPanChange(true)
  }
  /**
   * 포커스 이탈과 키 해제 시 이동 상태를 초기화하는 입력 해제
   */
  const releaseSpacePan = () => {
    if (!isSpacePressed) return
    isSpacePressed = false
    onPanChange(false)
  }
  /**
   * 공백 키 해제를 확인하여 이동 모드를 종료하는 키 해제 처리
   * @param event 해제한 키를 포함하는 키보드 이벤트
   */
  const handleSpaceKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') releaseSpacePan()
  }
  window.addEventListener('keydown', handleSpaceKeyDown, true)
  window.addEventListener('keyup', handleSpaceKeyUp, true)
  window.addEventListener('blur', releaseSpacePan)
  /**
   * 렌더러 종료 시 이동 상태와 등록한 키 이벤트를 정리하는 자원 해제
   */
  const dispose = () => {
    releaseSpacePan()
    window.removeEventListener('keydown', handleSpaceKeyDown, true)
    window.removeEventListener('keyup', handleSpaceKeyUp, true)
    window.removeEventListener('blur', releaseSpacePan)
  }
  /**
   * 현재 공백 키 이동 모드의 활성 여부를 반환하는 상태 조회
   * @returns 스페이스 이동 활성 여부
   */
  const active = () => isSpacePressed
  return { active, dispose }
}
