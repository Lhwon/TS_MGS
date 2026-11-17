/**
 * 파일명: preload.cjs
 * 설명: 허용한 파일 명령만 렌더러에 전달하는 격리된 데스크톱 브리지
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
const { contextBridge, ipcRenderer } = require('electron')
/**
 * 운영체제 파일 선택기로 지도 파일을 여는 요청
 * @returns 파일 내용과 선택적인 테마를 포함하는 비동기 열기 결과
 */
const openMap = () => ipcRenderer.invoke('map:open')
/**
 * 지도 폴더에서 최신 원본 지도를 찾는 요청
 * @returns 선택한 최신 지도 파일의 비동기 읽기 결과
 */
const openMapFolder = () => ipcRenderer.invoke('map:open-folder')
/**
 * 메인 프로세스가 발급한 위치 식별자의 프로젝트 폴더를 탐색기로 여는 요청
 * @param token 프로젝트 위치 식별자
 * @returns 운영체제 탐색기 실행 완료 결과
 */
const showProjectFolder = (token) => ipcRenderer.invoke('map:show-folder', token)
/**
 * 검증한 지도 문서를 운영체제 파일로 저장하는 요청
 * @param content 직렬화한 지도 문서 문자열
 * @param name 저장 대화상자에 표시할 기본 파일명
 * @param options 원본 저장 위치 식별자와 그룹 및 다른 위치 저장 여부
 * @returns 저장을 완료한 파일명과 위치 식별자 또는 취소 결과
 */
const saveMap = (content, name, options) => ipcRenderer.invoke('map:save', content, name, options)
/**
 * 편집용 설계 프로젝트 파일을 여는 요청
 * @returns 선택한 설계 파일명과 내용 또는 취소 결과
 */
const openScene = () => ipcRenderer.invoke('scene:open')
/** 현재 지도 프로젝트의 삼차원 설계를 파일 선택 없이 조회하는 요청 */
const readProjectScene = (token) => ipcRenderer.invoke('scene:read-project', token)
/**
 * 모델과 배치를 포함하는 설계 프로젝트를 저장하는 요청
 * @param content 공유 계약을 검증한 설계 문자열
 * @param name 저장할 설계 프로젝트의 기본 파일명
 * @returns 저장한 파일명 또는 취소 결과
 */
const saveScene = (content, name, token) => ipcRenderer.invoke('scene:save', content, name, token)
/**
 * 모델 라이브러리와 포트 배치를 분리하여 내보내는 요청
 * @param layout 기준 맵과 모델 참조를 포함하는 배치 문자열
 * @param library 부품 형상을 포함하는 모델 라이브러리 문자열
 * @returns 두 실행 파일을 기록한 출력 폴더 또는 취소 결과
 */
const exportScene = (layout, library, token) =>
  ipcRenderer.invoke('scene:export', layout, library, token)
/**
 * 저장하지 않은 문서의 존재 여부를 메인 창에 전달하는 상태 알림
 * @param dirty 종료 시 변경 폐기 확인이 필요한 문서 상태
 */
const setDirty = (dirty) => ipcRenderer.send('map:dirty', dirty)

/** AI 서비스의 사용 가능 상태 조회 */
const aiStatus = () => ipcRenderer.invoke('ai:status')
/** 입력한 요청과 지도 정보를 전달하는 작업 제안 조회 */
const aiPropose = (payload) => ipcRenderer.invoke('ai:propose', payload)
/** 도면 이미지의 색상과 의미 분석 요청 */
const aiAnalyzeDrawing = (payload) => ipcRenderer.invoke('ai:drawing', payload)
/** 진행 중인 추론 요청 중단 */
const cancelAi = (id) => ipcRenderer.send('ai:cancel', id)

// 격리된 렌더러에 파일 명령과 변경 상태 알림만 제공하는 공개 브리지
contextBridge.exposeInMainWorld('desktop', {
  apiVersion: 2,
  aiStatus,
  aiPropose,
  aiAnalyzeDrawing,
  cancelAi,
  openMap,
  openMapFolder,
  showProjectFolder,
  saveMap,
  openScene,
  readProjectScene,
  saveScene,
  exportScene,
  setDirty,
})
