/**
 * 파일명: questions.ts
 * 설명: 작업 종류와 무관한 사용자 질문과 입력값 및 선택 응답의 공통 계약과 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
export type AgentValue = string | number | boolean | string[]
export interface AgentChoice {
  id: string
  label: string
}
export interface AgentField {
  id: string
  label: string
  type: 'text' | 'number' | 'select' | 'multiselect' | 'boolean'
  required: boolean
  placeholder?: string
  units: string[]
  unit?: string
  min?: number
  max?: number
  options: AgentChoice[]
  defaultValue?: AgentValue
}
export interface AgentQuestion {
  id: string
  question: string
  reason?: string
  fields: AgentField[]
  choices: AgentChoice[]
  allowSkip: boolean
  skipLabel: string
  submitLabel: string
}
export interface AgentAnswer {
  status: 'answered' | 'skipped'
  values: Record<string, AgentValue>
  units: Record<string, string>
  choice?: string
  text?: string
}
/** 표시할 문장의 형식과 크기를 제한하는 질문 문자열 검사 */
const text = (value: unknown, maximum = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw new Error('질문과 선택지의 내용을 확인하세요.')
  return value.trim()
}
/** 선택지의 식별자를 중복 없이 보관하는 목록 검사 */
const choices = (value: unknown, maximum: number): AgentChoice[] => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error('선택지 개수가 범위를 초과했습니다.')
  const rows = value.map((item) => ({ id: text(item?.id, 100), label: text(item?.label, 200) }))
  if (new Set(rows.map((item) => item.id)).size !== rows.length)
    throw new Error('선택지 식별자가 중복되었습니다.')
  return rows
}
/**
 * 모델이 요청한 질문을 실행 가능한 입력 카드로 검증하는 공통 질문 구성
 * @param input 검증 전 도구 인수
 * @returns 화면과 작업 재개에 사용할 질문
 */
export const parseAgentQuestion = (input: Record<string, unknown>): AgentQuestion => {
  if (input.fields !== undefined && (!Array.isArray(input.fields) || input.fields.length > 6))
    throw new Error('한 번에 입력 항목 6개까지 질문할 수 있습니다.')
  const fields: AgentField[] = ((input.fields as Record<string, unknown>[]) ?? []).map((item) => {
    if (
      !item ||
      !['text', 'number', 'select', 'multiselect', 'boolean'].includes(String(item.type))
    )
      throw new Error('지원하지 않는 질문 입력 종류입니다.')
    const options = choices(item.options, 200)
    if (['select', 'multiselect'].includes(String(item.type)) && !options.length)
      throw new Error('선택할 항목을 조회한 후 선택지를 제공하세요.')
    if (item.units !== undefined && (!Array.isArray(item.units) || item.units.length > 8))
      throw new Error('단위 선택지를 확인하세요.')
    const units = ((item.units as unknown[]) ?? []).map((value) => text(value, 24))
    const id = text(item.id, 100)
    if (
      !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(id) ||
      ['constructor', 'prototype', '__proto__'].includes(id)
    )
      throw new Error('입력 식별자는 width, targetPort 같은 영문 키로 지정하세요.')
    const field: AgentField = {
      id,
      label: text(item.label, 200),
      type: item.type as AgentField['type'],
      required: item.required !== false,
      units,
      options,
    }
    if (item.placeholder) field.placeholder = text(item.placeholder, 200)
    if (item.unit) {
      field.unit = text(item.unit, 24)
      if (units.length && !units.includes(field.unit))
        throw new Error('기본 단위가 단위 목록에 없습니다.')
    } else if (units.length) field.unit = units[0]
    for (const key of ['min', 'max'] as const)
      if (item[key] !== undefined) {
        if (!Number.isFinite(item[key])) throw new Error('입력 범위를 확인하세요.')
        field[key] = Number(item[key])
      }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max)
      throw new Error('입력 범위의 순서를 확인하세요.')
    if (item.defaultValue !== undefined) {
      const value = item.defaultValue
      if (
        !['string', 'number', 'boolean'].includes(typeof value) &&
        !(Array.isArray(value) && value.every((item) => typeof item === 'string'))
      )
        throw new Error('질문 기본값을 확인하세요.')
      field.defaultValue = value as AgentValue
    }
    return field
  })
  if (new Set(fields.map((field) => field.id)).size !== fields.length)
    throw new Error('입력 항목 식별자가 중복되었습니다.')
  const options = choices(input.choices, 6)
  if (!fields.length && !options.length)
    fields.push({
      id: 'answer',
      label: '답변',
      type: 'text',
      required: true,
      units: [],
      options: [],
    })
  return {
    id: crypto.randomUUID(),
    question: text(input.question),
    reason: input.reason ? text(input.reason) : undefined,
    fields,
    choices: options,
    allowSkip: input.allowSkip === true,
    skipLabel: input.skipLabel ? text(input.skipLabel, 100) : '아니요, 나중에',
    submitLabel: input.submitLabel ? text(input.submitLabel, 100) : '답변 보내기',
  }
}
/**
 * 입력 카드와 자유 답변을 같은 작업 응답으로 검증하는 답변 검사
 * @param question 원본 질문
 * @param answer 사용자 응답
 * @returns 도구 관찰로 전달할 답변
 */
export const validateAgentAnswer = (question: AgentQuestion, answer: AgentAnswer): AgentAnswer => {
  if (answer.status === 'skipped') {
    if (!question.allowSkip) throw new Error('이 질문은 답변이 필요합니다.')
    return { status: 'skipped', values: {}, units: {} }
  }
  if (answer.status !== 'answered') throw new Error('답변 상태를 확인하세요.')
  if (answer.choice) {
    const choice = question.choices.find((item) => item.id === answer.choice)
    if (!choice) throw new Error('질문에 없는 선택지입니다.')
    return { status: 'answered', choice: choice.id, text: choice.label, values: {}, units: {} }
  }
  if (answer.text?.trim())
    return { status: 'answered', values: {}, units: {}, text: text(answer.text, 4000) }
  const values: Record<string, AgentValue> = Object.create(null),
    units: Record<string, string> = Object.create(null)
  for (const field of question.fields) {
    const value = answer.values?.[field.id]
    if (value === undefined || value === '') {
      if (field.required) throw new Error(`${field.label} 항목을 입력하세요.`)
      continue
    }
    if (field.type === 'number') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (field.min !== undefined && value < field.min) ||
        (field.max !== undefined && value > field.max)
      )
        throw new Error(`${field.label} 수치와 입력 범위를 확인하세요.`)
    } else if (field.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`${field.label} 선택을 확인하세요.`)
    } else if (field.type === 'multiselect') {
      if (
        !Array.isArray(value) ||
        value.length > 200 ||
        new Set(value).size !== value.length ||
        value.some((id) => !field.options.some((option) => option.id === id)) ||
        (field.required && !value.length)
      )
        throw new Error(`${field.label} 선택을 확인하세요.`)
    } else if (
      typeof value !== 'string' ||
      value.length > 2000 ||
      (field.required && !value.trim()) ||
      (field.type === 'select' && !field.options.some((option) => option.id === value))
    )
      throw new Error(`${field.label} 값을 확인하세요.`)
    values[field.id] = value
    const unit = answer.units?.[field.id] ?? field.unit
    if (unit) {
      if (field.units.length ? !field.units.includes(unit) : unit !== field.unit)
        throw new Error(`${field.label} 단위를 확인하세요.`)
      units[field.id] = unit
    }
  }
  return { status: 'answered', values, units }
}
