/**
 * 파일명: env.d.ts
 * 설명: 파일 입출력과 문서 변경 상태를 전달하는 데스크톱 브리지 타입 선언
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
/// <reference types="vite/client" />
interface DesktopMapProject {
  name?: string
  content?: string
  theme?: string
  token: string
  project: string
  areaFiles?: Record<string, string>
  portGroups?: string
}
interface Window {
  desktop?: {
    apiVersion?: number
    aiStatus?(): Promise<import('@/features/ai-assistant/index.ts').AssistantStatus>
    aiPropose?(payload: {
      id: string
      prompt: string
      model?: string
      context: string
      history: import('@/features/ai-assistant/index.ts').AssistantHistory[]
    }): Promise<unknown>
    aiAnalyzeDrawing?(payload: {
      id: string
      image: string
      task?: 'overview' | 'objects'
    }): Promise<import('@/features/drawing-import/index.ts').DrawingVision>
    cancelAi?(id: string): void
    openMap(): Promise<{
      name: string
      content: string
      theme?: string
      token?: string
      areaFiles?: Record<string, string>
      portGroups?: string
    } | null>
    openMapFolder(): Promise<DesktopMapProject | null>
    restoreMapProject?(): Promise<DesktopMapProject | null>
    selectSaveProject?(): Promise<string | null>
    showProjectFolder(token: string): Promise<void>
    readProjectBayFilter?(token: string): Promise<number[]>
    saveProjectBayFilter?(token: string, list: number[]): Promise<void>
    readProjectBlockData?(token: string, name: string, type: 'fmd' | 'blk'): Promise<{
      name: string
      content: string
    } | null>
    saveMap(
      content: string,
      name: string,
      options?: {
        token?: string
        groups?: string
        auxiliary?: Record<string, string>
        saveAs?: boolean
        backup?: boolean
      },
    ): Promise<{ name: string; token?: string; warning?: string } | null>
    openScene(): Promise<{
      name: string
      content: string
    } | null>
    readProjectScene?(token: string): Promise<{
      name: string
      content: string
      library?: string
    } | null>
    saveScene(content: string, name: string, token?: string): Promise<string | null>
    exportScene(layout: string, library: string, token?: string): Promise<string | null>
    setDirty(dirty: boolean): void
  }
}
