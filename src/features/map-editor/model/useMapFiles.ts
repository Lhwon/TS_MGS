/**
 * 파일명: useMapFiles.ts
 * 설명: 실행 환경별 지도 파일 열기와 저장 및 변경 폐기 보호
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { serializeAreas, serializeLegacy } from '@/entities/map/index.ts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { downloadJson, pickMapFile } from '@/shared/lib/files/index.ts'
import { useEditor } from '@/features/map-editor/model/editor.ts'
/**
 * 파일 열기와 저장 및 브라우저 이탈 처리를 연결하는 지도 파일 작업 구성
 * @param beforeReplace 함께 연결된 설계의 교체 가능 여부를 확인하는 사전 검사
 * @returns 작업 진행 상태와 환경별 지도 파일 명령 묶음
 */
export const useMapFiles = (beforeReplace: () => boolean = () => true) => {
  const editor = useEditor()
  const busy = ref(false)

  watch(
    () => editor.mapRevision,
    () => {
      editor.projectToken = undefined
    },
    { flush: 'sync' },
  )
  /**
   * 저장하지 않은 변경의 폐기 여부를 사용자에게 확인하는 문서 교체 사전 확인
   * @returns 현재 문서의 교체를 진행할 수 있는지 여부
   */
  const discardAllowed = () =>
    (!editor.dirty || window.confirm('저장하지 않은 2D 변경을 버리시겠습니까?')) && beforeReplace()
  /**
   * 발생한 예외를 사용자가 확인할 수 있는 상태 메시지로 바꾸는 오류 표시
   *
   * @param error 화면 메시지로 전달할 예외 또는 실패 값
   */
  const report = (error: unknown) => {
    editor.message = error instanceof Error ? error.message : String(error)
  }
  /**
   * 진행 중인 파일 작업과 변경 폐기 여부를 확인한 뒤 새 지도를 만드는 생성 처리
   *
   * @param sample 빈 문서 대신 내장 샘플 지도의 사용 여부
   */
  const create = (sample = false) => {
    if (!busy.value && discardAllowed()) editor.newMap(sample)
  }
  /**
   * 현재 실행 환경의 파일 선택기를 사용하여 문서를 검증하고 여는 비동기 파일 작업
   */
  const open = async () => {
    if (busy.value || !discardAllowed()) return
    busy.value = true
    try {
      const file = window.desktop ? await window.desktop.openMap() : await pickMapFile()
      if (file) {
        editor.load(
          file.content,
          file.name,
          'theme' in file ? (file.theme as string) : undefined,
          'portGroups' in file ? (file.portGroups as string) : undefined,
          'areaFiles' in file ? (file.areaFiles as Record<string, string>) : undefined,
        )
        editor.projectToken = 'token' in file ? (file.token as string) : undefined
      }
    } catch (error) {
      report(error)
    } finally {
      busy.value = false
    }
  }
  /**
   * 작업 시작 시점의 문서를 저장하고 완료된 스냅샷만 저장 기준으로 표시하는 비동기 저장
   */
  const save = async (saveAs = false, forceNative = false) => {
    if (busy.value || editor.readOnly) return
    const snapshot = editor.document
    busy.value = true
    try {
      const native =
        forceNative || !!editor.legacySource || editor.sourceName.toLowerCase().endsWith('.jmapx')
      const serialized = native ? serializeLegacy(snapshot, editor.legacySource) : undefined
      const content = serialized?.content ?? JSON.stringify(snapshot, null, 2)
      if (window.desktop?.apiVersion === 2) {
        const result = await window.desktop.saveMap(content, editor.sourceName, {
          token: editor.projectToken,
          groups: serialized?.groups,
          auxiliary:
            native && !forceNative && snapshot.areas ? serializeAreas(snapshot.areas) : undefined,
          saveAs,
        })
        if (result) {
          editor.projectToken = result.token
          editor.markSaved(snapshot, result.name)
        }
      } else {
        downloadJson(
          content,
          native ? editor.sourceName.replace(/\.(?:tsmgs\.)?json$/i, '.jmapx') : editor.sourceName,
        )
        if (serialized?.groups)
          downloadJson(serialized.groups, editor.sourceName.replace(/\.jmapx$/i, '_port_group.bem'))
        editor.message = window.desktop
          ? '지도 파일 다운로드를 요청했습니다. 새 데스크톱 저장 기능은 앱을 재시작하면 적용됩니다.'
          : '지도 파일 다운로드를 요청했습니다.'
      }
    } catch (error) {
      report(error)
    } finally {
      busy.value = false
    }
  }
  watch(
    () => [editor.dirty, editor.sourceName] as const,
    ([dirty, name]) => {
      document.title = `${dirty ? '● ' : ''}${name} — TS_MGS`
    },
    { immediate: true },
  )
  /**
   * 저장하지 않은 설계를 브라우저 종료로 잃지 않도록 보호하는 이탈 확인
   *
   * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
   */
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (editor.dirty && !window.desktop) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
  /**
   * 원본 프로그램의 지도 폴더에서 최신 지도를 찾아 여는 데스크톱 파일 작업
   */
  const openFolder = async () => {
    if (busy.value || !window.desktop || !discardAllowed()) return
    busy.value = true
    try {
      const file = await window.desktop.openMapFolder()
      if (file) {
        editor.load(file.content, file.name, file.theme, file.portGroups, file.areaFiles)
        editor.projectToken = file.token
      }
    } catch (error) {
      report(error)
    } finally {
      busy.value = false
    }
  }
  /**
   * 현재 지도를 불러오거나 저장한 프로젝트 위치를 탐색기로 표시하는 폴더 열기
   */
  const showFolder = async () => {
    if (!window.desktop || !editor.projectToken) {
      editor.message = '먼저 프로젝트 지도를 열거나 저장하세요.'
      return
    }
    try {
      await window.desktop.showProjectFolder(editor.projectToken)
    } catch (error) {
      report(error)
    }
  }
  return { busy, create, open, openFolder, showFolder, save }
}
