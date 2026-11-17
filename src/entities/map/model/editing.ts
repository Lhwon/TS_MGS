/**
 * 파일명: editing.ts
 * 설명: 에이전트의 구조화된 지도 편집을 복제 문서에서 검증하는 원자적 도구
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { repairPortGroups } from '@/entities/map/model/repairReferences.ts'
import { parseDocument, type MapDocument } from '@/entities/map/model/map.ts'
/**
 * 생성 식별자를 반환하며 요청한 객체만 변경하는 지도 편집
 * @param input 현재 지도
 * @param value 검증 전 편집 명령 배열
 * @returns 검증한 지도와 실제 편집 결과
 */
export const editMapObjects = (input: MapDocument, value: unknown, maximum = 200) => {
  if (!Array.isArray(value) || !value.length || value.length > maximum)
    throw new Error(`지도 편집 명령은 한 번에 ${maximum}개까지 지원합니다.`)
  const map = structuredClone(input)
  const results: { entity: string; id: string; operation: string }[] = []
  for (const command of value) {
    if (
      !command ||
      !['node', 'edge', 'port', 'shape'].includes(command.entity) ||
      !['create', 'update', 'delete'].includes(command.operation)
    )
      throw new Error('지원하지 않는 지도 편집 명령입니다.')
    const data = command.value ?? {}
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('객체 속성이 올바르지 않습니다.')
    const allowed: Record<string, string[]> = {
      node: [
        'x',
        'y',
        'name',
        'direction',
        'virtual',
        'curve',
        'curveStart',
        'property',
        'noSendGoal',
        'noSendGoalLoaded',
        'dontRemoveCmd',
        'removable',
        'changeable',
        'bayChange',
        'spinturnable',
        'addressType',
        'safetyDistance',
        'safetyViewDistance',
      ],
      edge: [
        'from',
        'to',
        'direction',
        'drivingType',
        'distance',
        'speed',
        'radius',
        'curveAngle',
        'goalDegree',
        'realConnection',
        'controls',
        'bays',
      ],
      port: [
        'x',
        'y',
        'nodeId',
        'name',
        'width',
        'height',
        'fillColor',
        'strokeColor',
        'fontColor',
        'floor',
        'fontSize',
        'nameDistance',
        'namePosition',
        'nameDirection',
        'settings',
        'bays',
      ],
      shape: [
        'x1',
        'y1',
        'x2',
        'y2',
        'width',
        'height',
        'type',
        'text',
        'strokeColor',
        'fillColor',
        'fontColor',
      ],
    }
    if (Object.keys(data).some((key) => !allowed[command.entity].includes(key)))
      throw new Error('지원하지 않는 객체 속성이 있습니다.')
    const key = ({ node: 'nodes', edge: 'edges', port: 'ports', shape: 'shapes' } as const)[
      command.entity as 'node' | 'edge' | 'port' | 'shape'
    ]
    map.shapes ??= []
    const rows = map[key]! as unknown as Record<string, unknown>[]
    let id = String(command.id ?? '')
    const found = rows.find((item) => String(item.id) === id)
    if (command.operation !== 'create' && !found)
      throw new Error(`${command.entity} ${id} 객체를 찾지 못했습니다.`)
    if (command.operation === 'delete') {
      rows.splice(rows.indexOf(found!), 1)
      if (key === 'nodes') {
        map.edges = map.edges.filter((edge) => edge.from !== found!.id && edge.to !== found!.id)
        map.ports = map.ports.filter((port) => port.nodeId !== found!.id)
      }
    } else if (command.operation === 'update') {
      const oldX = Number(found!.x),
        oldY = Number(found!.y)
      Object.assign(found!, data, { id: found!.id })
      if (key === 'nodes') {
        const dx = Number(found!.x) - oldX,
          dy = Number(found!.y) - oldY
        for (const port of map.ports)
          if (port.nodeId === found!.id) {
            port.x += dx
            port.y += dy
          }
        for (const group of map.portGroups ?? [])
          if (group.nodeId === found!.id) {
            group.x += dx
            group.y += dy
            group.nodeX = Number(found!.x)
            group.nodeY = Number(found!.y)
          }
      }
    } else {
      let created: Record<string, unknown>
      if (key === 'nodes') {
        const number = id ? Number(id) : Math.max(0, ...map.nodes.map((node) => node.id)) + 1
        created = {
          id: number,
          name: `N${number}`,
          uid: Math.max(0, ...map.nodes.map((node) => node.uid ?? node.id)) + 1,
          realId:
            Math.max(
              0,
              ...map.nodes.filter((node) => !node.virtual).map((node) => node.realId ?? node.id),
            ) + 1,
          direction: 1,
          ...data,
        }
      } else if (key === 'edges')
        created = { id: id || `E-${crypto.randomUUID()}`, direction: 1, drivingType: 1, ...data }
      else if (key === 'ports')
        created = {
          id: id || `P-${crypto.randomUUID().slice(0, 8)}`,
          name: '',
          width: 100,
          height: 100,
          ...data,
        }
      else
        created = {
          id: id ? Number(id) : Math.max(0, ...map.shapes.map((shape) => shape.id)) + 1,
          description: '',
          text: '',
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 0,
          centerX: 0,
          centerY: 0,
          radius: 0,
          width: 0,
          height: 0,
          type: 2,
          strokeColor: 0,
          fillColor: 0,
          fontColor: 0,
          strokeWidth: 10,
          strokeStyle: 0,
          fontAlign: 0,
          fontDirection: 0,
          fillStyle: 0,
          ...data,
        }
      id = String(created.id)
      if (rows.some((item) => String(item.id) === id))
        throw new Error(`중복 객체 ${id} 생성 요청입니다.`)
      rows.push(created)
    }
    results.push({ entity: command.entity, id, operation: command.operation })
  }
  repairPortGroups(map)
  const nodes = new Map(map.nodes.map((node) => [node.id, node]))
  for (const edge of map.edges) {
    const a = nodes.get(edge.from),
      b = nodes.get(edge.to)
    if (a && b) edge.distance = Math.round(Math.hypot(a.x - b.x, a.y - b.y))
  }
  return { map: parseDocument(JSON.stringify(map)), results }
}
