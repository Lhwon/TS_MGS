/**
 * 파일명: transport.ts
 * 설명: 데스크톱과 웹 개발 환경의 AI 요청 및 취소를 통합하는 통신
 * 작성자: 이희원
 * 작성일자: 2026-11-17
 */
import type { AssistantHistory } from '@/features/ai-assistant/model/proposal.ts'
import type { DrawingVision } from '@/entities/map/index.ts'

export interface AssistantModel {
  name: string
  size: number
  parameterSize: string
  quantization: string
}
export interface AssistantStatus {
  ready: boolean
  defaultModel: string
  models: AssistantModel[]
}

/**
 * 개발 서버의 동일 출처 AI 경로를 호출하는 JSON 요청
 * @param path 상태 또는 작업 제안 경로
 * @param options 요청 본문과 취소 신호
 * @returns 응답 JSON 데이터
 */
const webRequest = async (path: string, options?: RequestInit): Promise<unknown> => {
  const response = await fetch(`/api/assistant/${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('AI 기능을 사용하려면 데스크톱 앱을 다시 실행해 주세요.')

  const result = await response.json()

  if (!response.ok) throw new Error(result.error || 'AI 요청 실패')

  return result
}

/** AI 서버와 모델의 사용 가능 상태 확인 */
export const checkAssistant = async () => {
  if (window.desktop) {
    if (!window.desktop.aiStatus) throw new Error('AI 기능을 사용하려면 앱을 다시 실행해 주세요.')
    return await window.desktop.aiStatus()
  } else {
    return (await webRequest('status')) as AssistantStatus
  }
}

/**
 * 질문과 현재 지도 정보를 전달하고 요청 취소를 연결하는 작업 제안 조회
 * @param prompt 사용자 질문
 * @param context 제한된 지도 문맥 문자열
 * @param history 이전 사용자 질문과 응답
 * @param signal 요청 취소 신호
 * @returns 검증 전 AI 작업 제안
 */
export const requestProposal = async (
  prompt: string,
  context: string,
  history: AssistantHistory[],
  signal: AbortSignal,
  model?: string,
): Promise<unknown> => {
  if (signal.aborted) throw new Error('AI 요청을 취소했습니다.')

  // 웹 요청과 같은 JSON 계약으로 중첩된 반응형 대화 이력을 일반 데이터로 변환하는 데스크톱 통신 경계
  const payload = JSON.parse(
    JSON.stringify({ id: crypto.randomUUID(), prompt, context, history, model }),
  )

  if (!window.desktop)
    return webRequest('propose', { method: 'POST', body: JSON.stringify(payload), signal })

  if (!window.desktop.aiPropose) throw new Error('AI 기능을 사용하려면 앱을 다시 실행해 주세요.')

  const cancel = () => window.desktop?.cancelAi?.(payload.id)

  signal.addEventListener('abort', cancel, { once: true })

  try {
    return await window.desktop.aiPropose(payload)
  } catch (cause) {
    /** Electron 호출 접두어를 제거하고 실제 서비스 오류 내용만 전달 */
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ''))
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

/**
 * 도면 비전 해석의 취소와 데스크톱 브리지를 연결하는 이미지 요청
 * @param image 축소한 도면의 데이터 주소
 * @param signal 요청 취소 신호
 * @returns 색상과 의미 해석
 */
export const analyzeDrawing = async (
  image: string,
  signal: AbortSignal,
  task: 'overview' | 'objects' = 'overview',
): Promise<DrawingVision> => {
  const payload = { id: crypto.randomUUID(), image, task }
  if (!window.desktop)
    return (await webRequest('drawing', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    })) as DrawingVision
  if (!window.desktop.aiAnalyzeDrawing)
    throw new Error('도면 분석을 사용하려면 앱을 다시 실행하세요.')
  if (signal.aborted) throw new Error('도면 분석을 취소했습니다.')
  const cancel = () => window.desktop?.cancelAi?.(payload.id)
  signal.addEventListener('abort', cancel, { once: true })
  try {
    return await window.desktop.aiAnalyzeDrawing(payload)
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}
