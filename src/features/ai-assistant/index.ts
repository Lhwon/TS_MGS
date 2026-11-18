/**
 * 파일명: index.ts
 * 설명: AI 통신과 지도 문맥 및 작업 제안 검증의 공개 진입점
 * 작성자: 이희원
 * 작성일자: 2026-11-17
 */
export {
  requestProposal,
  checkAssistant,
  analyzeDrawing,
} from '@/features/ai-assistant/model/transport.ts'
export {
  assistantContext,
  validateProposal,
  inspectMap,
} from '@/features/ai-assistant/model/proposal.ts'
export type {
  AssistantProposal,
  AssistantHistory,
  AssistantTurn,
  AssistantToolCall,
} from '@/features/ai-assistant/model/proposal.ts'
export { editMapObjects } from '@/features/ai-assistant/model/mapTools.ts'
export { searchMgsTraining } from '@/features/ai-assistant/model/mgsTraining.ts'
export { runAgent, compactAgentHistory } from '@/features/ai-assistant/model/agent.ts'
export { parseAgentQuestion, validateAgentAnswer } from '@/features/ai-assistant/model/questions.ts'
export type {
  AgentQuestion,
  AgentAnswer,
  AgentField,
  AgentValue,
} from '@/features/ai-assistant/model/questions.ts'
export { default as AgentQuestionCard } from '@/features/ai-assistant/ui/AgentQuestionCard.vue'

export type { AssistantModel, AssistantStatus } from '@/features/ai-assistant/model/transport.ts'
export { default as AssistantModelPicker } from '@/features/ai-assistant/ui/AssistantModelPicker.vue'
export {
  inspectSelectedNodes,
  editSelectedNodes,
  selectionDelta,
} from '@/features/ai-assistant/model/selection.ts'
