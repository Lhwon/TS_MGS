/**
 * 화면 기능의 실행 계약과 가용 상태를 사용자 인터페이스 및 에이전트에 공통 제공
 */

/** 화면 기능의 입력값 검증과 도구 안내에 공유하는 매개변수 규격 정의 */
export interface CommandParameter {
  type: 'string' | 'number' | 'boolean' | 'array'
  description?: string
  enum?: readonly (string | number | boolean)[]
  minimum?: number
  maximum?: number
  items?: CommandParameter
  maxItems?: number
}

/** 기존 화면 동작과 실행 결과의 의미를 연결하는 기능 계약 정의 */
export interface AppCommand {
  id: string
  label: string
  category: string
  description: string
  effect: 'view' | 'edit' | 'dialog' | 'interactive'
  available?: boolean
  unavailableReason?: string
  parameters?: Record<string, CommandParameter>
  required?: string[]
  resolves?: string[]
  run: (args: Record<string, unknown>) => unknown | Promise<unknown>
}

/** 화면이 소유한 기능 공급자만 보관하여 별도 문서 상태 생성 방지 */
const sources = new Map<symbol, () => AppCommand[]>()

/** 화면 수명과 함께 실제 기능을 등록하고 해당 소유자의 해제 함수 반환 */
export const registerAppCommands = (provide: () => AppCommand[]) => {
  const owner = Symbol()
  sources.set(owner, provide)
  return () => {
    sources.delete(owner)
  }
}

/** 활성 화면의 기능만 수집하고 식별자 충돌을 명시적으로 검증 */
const currentCommands = () => {
  const commands = [...sources.values()].flatMap((provide) => provide())
  if (new Set(commands.map((command) => command.id)).size !== commands.length)
    throw new Error('중복된 화면 기능 식별자가 있습니다.')
  return commands
}

/** 실행 함수를 노출하지 않고 기능의 매개변수와 상태만 반환 */
const describe = ({ run: _run, ...command }: AppCommand) => ({
  ...command,
  available: command.available !== false,
  unavailableReason: command.available === false ? command.unavailableReason : undefined,
  parameters: {
    type: 'object',
    properties: command.parameters ?? {},
    required: command.required ?? [],
    additionalProperties: false,
  },
})

/** 활성 화면의 입력 규격을 추론용 도구 계약으로 일괄 반환 */
export const getAppCommandContracts = () => currentCommands().map(describe)

/** 페이지 조회 또는 정확한 기능 식별자로 현재 지원 기능과 입력 규격 반환 */
export const listAppCommands = (
  options: { id?: string; query?: string; category?: string; offset?: number; limit?: number } = {},
) => {
  for (const key of ['id', 'query', 'category'] as const)
    if (options[key] !== undefined && typeof options[key] !== 'string')
      throw new Error(`${key} 검색 입력을 확인하세요.`)
  const commands = currentCommands()
  if (options.id) {
    const command = commands.find((item) => item.id === options.id)
    if (command) return { command: describe(command) }
    const related = commands.filter((item) =>
      item.id.toLowerCase().includes(options.id!.toLowerCase()),
    )
    if (related.length === 1)
      return {
        requestedId: options.id,
        command: describe(related[0]!),
        note: '실행 시 command의 정확한 id 사용 필요',
      }
  }
  const query = (options.query || options.id || '').toLowerCase()
  const category = (options.category ?? '').toLowerCase()
  const inCategory = (command: AppCommand) =>
    !category ||
    command.category.toLowerCase() === category ||
    command.category.toLowerCase().startsWith(category + '/') ||
    command.category.toLowerCase().endsWith('/' + category)
  const matchedCategory = commands.filter(inCategory)
  const categorized = matchedCategory.length || !category ? matchedCategory : commands
  const terms = query.trim().split(/\s+/).filter(Boolean)
  const filtered = categorized
    .map((command) => {
      const haystack =
        `${command.id} ${command.label} ${command.description} ${command.category} ${Object.keys(command.parameters ?? {}).join(' ')}`.toLowerCase()
      return { command, score: terms.filter((term) => haystack.includes(term)).length }
    })
    .filter(({ score }) => !terms.length || score > 0)
    .sort((left, right) => right.score - left.score)
    .map(({ command }) => command)
  const offset = Number.isFinite(options.offset) ? Math.max(0, Math.trunc(options.offset!)) : 0
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(30, Math.trunc(options.limit!)))
    : 15
  const modeSwitch = commands.find((item) => item.id === 'workspace.mode')
  return {
    scope: '현재 화면에 등록된 기능만 조회',
    ...(modeSwitch ? { modeSwitch: describe(modeSwitch) } : {}),
    note: '검색 결과가 없으면 기능 미지원으로 판단하지 말고 작업 화면 전환 후 다시 조회 필요. 모델이나 객체 이름은 get_map_context로 조회하고 기능 식별자와 구분 필요',
    ...(filtered.length === 0
      ? { availableCommands: commands.slice(0, 60).map(({ id, label }) => ({ id, label })) }
      : {}),
    ...(filtered.length === 0 && category && categorized.length
      ? { suggestions: categorized.slice(0, 5).map(describe) }
      : {}),
    ...(category && !matchedCategory.length
      ? { categoryFallback: '해당 분류가 없어 현재 화면 전체에서 검색한 결과' }
      : {}),
    total: filtered.length,
    offset,
    categories: [...new Set(commands.map((item) => item.category))],
    commands: filtered.slice(offset, offset + limit).map((command) => {
      if (filtered.length === 1) return describe(command)
      const { parameters: _parameters, required: _required, ...summary } = describe(command)
      return summary
    }),
    hasMore: offset + limit < filtered.length,
  }
}

/** 허용한 매개변수의 형식과 범위만 통과시키는 실행 경계 검증 */
const validateParameter = (value: unknown, parameter: CommandParameter, name: string): void => {
  if (parameter.type === 'array') {
    if (!Array.isArray(value) || value.length > (parameter.maxItems ?? 200))
      throw new Error(`${name} 목록을 확인하세요.`)
    if (parameter.items) for (const item of value) validateParameter(item, parameter.items, name)
    return
  }
  if (typeof value !== parameter.type)
    throw new Error(`${name} 입력값 형식은 ${parameter.type}입니다.`)
  if (parameter.enum && !parameter.enum.includes(value as string | number | boolean))
    throw new Error(`${name} 입력값은 ${parameter.enum.join(', ')} 중에서 선택하세요.`)
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) ||
      (parameter.minimum !== undefined && value < parameter.minimum) ||
      (parameter.maximum !== undefined && value > parameter.maximum))
  )
    throw new Error(`${name} 범위를 확인하세요.`)
  if (typeof value === 'string' && value.length > 4000)
    throw new Error(`${name} 입력 길이를 확인하세요.`)
}

/** 조회 시점 이후의 가용 상태와 입력을 다시 검증하여 기존 화면 기능 실행 */
export const executeAppCommand = async (id: string, args: Record<string, unknown> = {}) => {
  const previous = currentCommands()
  const command = previous.find((item) => item.id === id)
  if (!command)
    throw new Error('현재 화면에서 사용할 수 없는 기능입니다. 기능 목록을 다시 조회하세요.')
  let result: unknown
  try {
    if (command.available === false)
      throw new Error(command.unavailableReason || '현재 상태에서 사용할 수 없는 기능입니다.')
    if (!args || typeof args !== 'object' || Array.isArray(args))
      throw new Error('기능 입력값을 확인하세요.')
    for (const required of command.required ?? [])
      if (args[required] === undefined) throw new Error(`${required} 입력이 필요합니다.`)
    for (const [key, value] of Object.entries(args)) {
      const parameter = command.parameters?.[key]
      if (!parameter) throw new Error(`허용되지 않은 기능 입력입니다: ${key}`)
      validateParameter(value, parameter, key)
    }
    result = await command.run(args)
  } catch (cause) {
    if (cause instanceof Error) Object.assign(cause, { command: describe(command) })
    throw cause
  }
  const next = currentCommands()
  const changed =
    previous.map((item) => item.id).join('|') !== next.map((item) => item.id).join('|')
  const reported =
    result && typeof result === 'object' && 'commandStatus' in result
      ? result.commandStatus
      : undefined
  const status =
    reported === 'completed' || reported === 'cancelled' || reported === 'awaiting_user'
      ? reported
      : command.effect === 'dialog' || command.effect === 'interactive'
        ? 'awaiting_user'
        : 'completed'
  return {
    id,
    label: command.label,
    effect: command.effect,
    resolvedCommands: command.resolves ?? [],
    status,
    result,
    ...(changed ? { availableCommands: next.map(({ id, label }) => ({ id, label })) } : {}),
    ...(status === 'awaiting_user'
      ? { note: '입력 화면 또는 조작 도구 활성화이며 편집 완료가 아님. 추가 입력과 결과 확인 필요' }
      : {}),
  }
}
