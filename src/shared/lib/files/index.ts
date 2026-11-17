/**
 * 파일명: index.ts
 * 설명: 공통 화면 자원과 파일 작업을 외부 슬라이스에 제공하는 공개 진입점
 * 작성자: 이희원
 * 작성일자: 2026-10-23
 */
// 브라우저 파일 작업과 데스크톱 브리지 파일 작업을 연결하는 환경별 어댑터
/**
 * 브라우저 파일 선택을 완료 또는 취소 결과로 반환하는 파일 선택 어댑터
 * 파일 크기와 읽기 오류를 확인하고 임시 입력 요소를 제거하는 자원 정리
 * @returns 선택한 파일명과 문자열 또는 취소 결과의 비동기 반환
 */
export const pickMapFile = (): Promise<{
  name: string
  content: string
} | null> => {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.jmapx'
    input.hidden = true
    /**
     * 파일 선택에 사용한 임시 입력 요소를 제거하는 브라우저 자원 정리
     */
    const clean = () => input.remove()
    input.addEventListener(
      'change',
      async () => {
        try {
          const file = input.files?.[0]
          if (!file) {
            resolve(null)
            return
          }
          if (file.size > 32 * 1024 * 1024) throw new Error('파일 크기는 32MB 이하여야 합니다.')
          resolve({ name: file.name, content: await file.text() })
        } catch (error) {
          reject(error)
        } finally {
          clean()
        }
      },
      { once: true },
    )
    input.addEventListener(
      'cancel',
      () => {
        clean()
        resolve(null)
      },
      { once: true },
    )
    document.body.append(input)
    input.click()
  })
}
/**
 * 직렬화한 문서를 파일 다운로드로 전달하고 임시 주소를 해제하는 브라우저 내보내기
 *
 * @param content 파일에서 읽은 원본 문자열
 * @param name 파일 또는 모델을 구분하는 표시 이름
 */
export const downloadJson = (content: string, name: string): void => {
  const url = URL.createObjectURL(
    new Blob([content], {
      type: name.toLowerCase().endsWith('.json') ? 'application/json' : 'text/plain;charset=utf-8',
    }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
