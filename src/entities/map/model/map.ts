/**
 * 파일명: map.ts
 * 설명: 지도 데이터 계약과 형식 검증 및 초기 문서와 샘플 데이터 구성
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import { validateAreas, type AreaData } from '@/entities/map/model/areas.ts'
import { PORT_SETTINGS } from '@/entities/map/model/portSettings.ts'
import { PATH_CONTROLS } from '@/entities/map/model/controls.ts'
export interface DrawingVision {
  routeColor: string
  summary: string
  uncertainty: string
  objects?: {
    kind: 'rack' | 'shelf' | 'conveyor' | 'equipment' | 'port' | 'obstacle' | 'text'
    label: string
    x: number
    y: number
    width: number
    height: number
    rotation: number
    confidence: number
  }[]
  routes?: { points: { x: number; y: number }[]; confidence: number }[]
}
export interface DrawingObject {
  id: string
  kind: 'rack' | 'shelf' | 'conveyor' | 'equipment' | 'port' | 'obstacle' | 'text'
  label: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  confidence: number
  status: 'accepted' | 'review' | 'rejected'
  heightMm?: number
  portId?: string
  locked?: boolean
}
export interface MapNode {
  id: number
  x: number
  y: number
  name: string
  drawingKey?: string
  direction?: number
  realId?: number
  uid?: number
  virtual?: boolean
  curve?: boolean
  curveStart?: boolean
  property?: number
  noSendGoalLoaded?: boolean
  dontRemoveCmd?: boolean
  removable?: boolean
  changeable?: boolean
  bayChange?: boolean
  spinturnable?: boolean
  addressType?: number
  noSendGoal?: boolean
  safetyDistance?: number
  safetyViewDistance?: number
}
export interface MapEdge {
  bays?: number[]
  id: string
  from: number
  to: number
  direction?: number
  drivingType?: number
  distance?: number
  speed?: number
  radius?: number
  curveAngle?: number
  goalDegree?: number
  controls?: { forward?: Record<string, number>; backward?: Record<string, number> }
  realConnection?: number
}
export interface MapPort {
  bays?: number[]
  settings?: Record<string, string | number>
  id: string
  nodeId: number
  x: number
  y: number
  name: string
  width?: number
  height?: number
  fillColor?: number
  strokeColor?: number
  fontColor?: number
  floor?: number
  fontSize?: number
  nameDistance?: number
  namePosition?: number
  nameDirection?: number
}
export interface MapPortGroup {
  nodeId?: number
  nodeX?: number
  nodeY?: number
  offsetX?: number
  offsetY?: number
  id: string
  x: number
  y: number
  width: number
  height: number
  strokeColor: number
  fillColor: number
  portIds: string[]
}
export interface MapShape {
  id: number
  description: string
  text: string
  x1: number
  y1: number
  x2: number
  y2: number
  centerX: number
  centerY: number
  radius: number
  width: number
  height: number
  type: number
  strokeColor: number
  strokeStyle: number
  strokeWidth: number
  fillColor: number
  fontColor: number
  fontAlign: number
  fontDirection: number
  fillStyle: number
}
export interface MapLayout {
  id: string
  name: string
  image: string
  sourceImage?: string
  sourceWidth: number
  sourceHeight: number
  crop: { x: number; y: number; width: number; height: number }
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  calibrated: boolean
}
export interface MapDocument {
  format: 'ts-mgs'
  version: 1
  name: string
  units: 'mm' | 'px'
  areas?: AreaData
  layout?: MapLayout
  drawing?: {
    id: string
    name: string
    width: number
    height: number
    image: string
    sourceImage?: string
    routeColor: string
    scaleMmPerPixel: number | null
    workingScale?: number
    frame?: { x: number; y: number; rotation: number }
    objects?: DrawingObject[]
    curveRadiusMm?: number
    vehicleWidthMm?: number
    clearanceMm?: number
    fillets?: { corner: number; end: number; nodes: number[]; x: number; y: number }[]
    analysisWarnings?: string[]
  }
  nodes: MapNode[]
  edges: MapEdge[]
  ports: MapPort[]
  shapes?: MapShape[]
  portGroups?: MapPortGroup[]
  legacy?: {
    version: number
    nodeRecords: number
    pathRecords: number
    shapeRecords: number
  }
}
export const MAX_NODES = 15000
export const MAX_PORTS = 5000
export const MAX_FILE_BYTES = 32 * 1024 * 1024
/**
 * 배열과 빈 값을 제외한 데이터 객체만 허용하는 입력 구조 검증
 *
 * @param value 현재 처리 단계에서 검증하거나 반영할 입력 값
 * @param label 오류 메시지에 포함할 입력 항목 이름
 * @returns 객체 형태 검증을 통과한 데이터 레코드
 */
const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}: 객체가 필요합니다.`)
  return value as Record<string, unknown>
}
/**
 * 좌표 및 속성 값을 유한한 숫자와 허용 범위로 제한하는 수치 검증
 *
 * @param value 현재 처리 단계에서 검증하거나 반영할 입력 값
 * @param label 오류 메시지에 포함할 입력 항목 이름
 * @returns 좌표 범위를 통과한 유한한 수치
 */
const numeric = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9)
    throw new Error(`${label}: 유효한 좌표/숫자가 아닙니다.`)
  return value
}
/**
 * 비어 있거나 허용 범위를 벗어난 식별자를 거부하는 참조 식별자 검증
 *
 * @param value 현재 처리 단계에서 검증하거나 반영할 입력 값
 * @param label 오류 메시지에 포함할 입력 항목 이름
 * @returns 형식 검증을 통과한 고유 식별자
 */
const identifier = (value: unknown, label: string): number => {
  const number = numeric(value, label)
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error(`${label}: 0 이상의 정수가 필요합니다.`)
  return number
}
/**
 * 문자열 자료형과 최대 길이를 확인하는 표시 문자열 검증
 *
 * @param value 현재 처리 단계에서 검증하거나 반영할 입력 값
 * @param label 오류 메시지에 포함할 입력 항목 이름
 * @returns 자료형과 길이를 검증한 문자열
 */
const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length > 300)
    throw new Error(`${label}: 300자 이하 문자열이 필요합니다.`)
  return value
}
/**
 * 배열 자료형과 최대 항목 수를 확인하는 지도 목록 검증
 *
 * @param value 현재 처리 단계에서 검증하거나 반영할 입력 값
 * @param label 오류 메시지에 포함할 입력 항목 이름
 * @param max 허용되는 최댓값
 * @returns 최대 항목 수 검증을 통과한 지도 데이터 배열
 */
const array = (value: unknown, label: string, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${label}: 최대 ${max.toLocaleString()}개까지 지원합니다.`)
  return value
}
/**
 * 동일 식별자가 여러 항목에 사용되는 것을 방지하는 중복 검증
 *
 * @param values 검증 대상 식별자 또는 설정 값 목록
 * @param label 오류 메시지에 포함할 입력 항목 이름
 */
const unique = (values: (string | number)[], label: string): void => {
  if (new Set(values).size !== values.length) throw new Error(`${label}: 중복 ID가 있습니다.`)
}
/**
 * 존재하는 선택 수치 속성만 검증하여 보존하는 추가 메타데이터 추출
 *
 * @param value 현재 처리 단계에서 검증하거나 반영할 입력 값
 * @param keys 허용된 선택 속성 이름 목록
 * @returns 유효한 선택 수치 속성만 포함하는 메타데이터 객체
 */
const optionalNumbers = (
  value: Record<string, unknown>,
  keys: string[],
): Record<string, number> => {
  const result: Record<string, number> = {}
  for (const key of keys) if (value[key] !== undefined) result[key] = numeric(value[key], key)
  return result
}
/**
 * 존재하는 선택 논리 속성만 검증하여 보존하는 추가 상태 정보 추출
 *
 * @param value 현재 처리 단계에서 검증하거나 반영할 입력 값
 * @param keys 허용된 선택 속성 이름 목록
 * @returns 유효한 선택 논리 속성만 포함하는 상태 객체
 */
const optionalFlags = (value: Record<string, unknown>, keys: string[]): Record<string, boolean> => {
  const result: Record<string, boolean> = {}
  for (const key of keys) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'boolean') throw new Error(`${key}: boolean 값이 필요합니다.`)
    result[key] = value[key] as boolean
  }
  return result
}
/**
 * 지도 파일을 읽고 노드와 경로 및 포트의 참조를 확인하는 지도 역직렬화
 * 식별자 중복과 허용 개수 및 좌표 범위를 검증한 새 문서 반환
 *
 * @param content 파일에서 읽은 원본 문자열
 * @returns 형식과 참조 무결성 검증을 통과한 지도 문서
 */
export const parseDocument = (content: string): MapDocument => {
  if (new TextEncoder().encode(content).length > MAX_FILE_BYTES)
    throw new Error('지도 파일은 32MB 이하여야 합니다.')
  const value = record(JSON.parse(content.replace(/^\uFEFF/, '')), '지도')
  if (
    value.format !== 'ts-mgs' ||
    value.version !== 1 ||
    !['mm', 'px'].includes(String(value.units))
  )
    throw new Error('TS_MGS JSON v1 지도 또는 픽셀 초안만 지원합니다.')
  const nodes = array(value.nodes, '노드', MAX_NODES).map((item) => {
    const node = record(item, '노드')
    return {
      id: identifier(node.id, '노드 ID'),
      x: numeric(node.x, 'X'),
      y: numeric(node.y, 'Y'),
      name: text(node.name, '노드 이름'),
      ...(node.drawingKey === undefined ? {} : { drawingKey: text(node.drawingKey, '도면 정점') }),
      ...optionalNumbers(node, [
        'realId',
        'direction',
        'uid',
        'property',
        'safetyDistance',
        'safetyViewDistance',
        'addressType',
      ]),
      ...optionalFlags(node, [
        'virtual',
        'curve',
        'curveStart',
        'noSendGoal',
        'noSendGoalLoaded',
        'dontRemoveCmd',
        'removable',
        'changeable',
        'bayChange',
        'spinturnable',
      ]),
    }
  })
  unique(
    nodes.map((node) => node.id),
    '노드',
  )
  const ids = new Set(nodes.map((node) => node.id))
  const edges = array(value.edges, '경로', MAX_NODES * 10).map((item) => {
    const edge = record(item, '경로')
    const result: MapEdge = {
      id: text(edge.id, '경로 ID'),
      from: identifier(edge.from, '시작 노드'),
      to: identifier(edge.to, '끝 노드'),
      ...optionalNumbers(edge, [
        'direction',
        'drivingType',
        'distance',
        'speed',
        'radius',
        'curveAngle',
        'goalDegree',
        'realConnection',
      ]),
    }
    if (edge.bays !== undefined)
      result.bays = array(edge.bays, '경로 Bay', 10000).map((value) => identifier(value, 'Bay'))
    if (edge.controls !== undefined) {
      const inputControls = record(edge.controls, '경로 제어 설정')
      result.controls = {}
      for (const direction of ['forward', 'backward'] as const)
        if (inputControls[direction] !== undefined) {
          const values = record(inputControls[direction], '방향별 제어 설정'),
            output: Record<string, number> = {}
          for (const field of PATH_CONTROLS)
            if (values[field.key] !== undefined) {
              const value = numeric(values[field.key], field.label)
              if ('flag' in field && field.flag && ![0, 1].includes(value))
                throw new Error(`${field.label}: 영 또는 일이 필요합니다.`)
              output[field.key] = value
            }
          result.controls[direction] = output
        }
    }
    if (!result.id || !ids.has(result.from) || !ids.has(result.to) || result.from === result.to)
      throw new Error('경로의 시작/끝 노드를 확인하세요.')
    if (
      result.realConnection !== undefined &&
      result.realConnection !== -1 &&
      (!Number.isSafeInteger(result.realConnection) || !ids.has(result.realConnection))
    )
      throw new Error('경로의 실제 연결 노드를 확인하세요.')
    return result
  })
  unique(
    edges.map((edge) => edge.id),
    '경로',
  )
  const ports = array(value.ports, '포트', MAX_PORTS).map((item) => {
    const port = record(item, '포트')
    const result: MapPort = {
      id: text(port.id, '포트 ID'),
      nodeId: identifier(port.nodeId, '연결 노드'),
      x: numeric(port.x, '포트 X'),
      y: numeric(port.y, '포트 Y'),
      name: text(port.name, '포트 이름'),
      ...optionalNumbers(port, [
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
      ]),
    }
    if (!result.id || !ids.has(result.nodeId)) throw new Error('포트 연결 노드를 확인하세요.')
    if (
      (result.width !== undefined && result.width < 0) ||
      (result.height !== undefined && result.height < 0)
    )
      throw new Error('포트 크기는 0 이상이어야 합니다.')
    if (port.bays !== undefined)
      result.bays = array(port.bays, '포트 Bay', 10000).map((value) => identifier(value, 'Bay'))
    if (port.settings !== undefined) {
      const values = record(port.settings, '포트 운행 설정')
      result.settings = {}
      for (const field of PORT_SETTINGS)
        if (values[field.key] !== undefined) {
          if (field.kind === 'text')
            result.settings[field.key] = text(values[field.key], field.label)
          else {
            const value = numeric(values[field.key], field.label)
            if (field.kind === 'flag' && ![0, 1].includes(value))
              throw new Error(`${field.label}: 영 또는 일이 필요합니다.`)
            result.settings[field.key] = value
          }
        }
    }
    return result
  })
  unique(
    ports.map((port) => port.id),
    '포트',
  )
  const result: MapDocument = {
    format: 'ts-mgs',
    version: 1,
    name: text(value.name, '지도 이름'),
    units: value.units as 'mm' | 'px',
    nodes,
    edges,
    ports,
  }
  if (value.layout !== undefined) {
    const layout = record(value.layout, '배경 도면')
    const crop = record(layout.crop, '도면 자르기')
    if (
      typeof layout.image !== 'string' ||
      layout.image.length > 16000000 ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(layout.image)
    )
      throw new Error('배경 도면 이미지 형식을 확인하세요.')
    const checked = {
      id: text(layout.id, '도면 식별자'),
      name: text(layout.name, '도면 이름'),
      image: layout.image,
      sourceWidth: numeric(layout.sourceWidth, '원본 폭'),
      sourceHeight: numeric(layout.sourceHeight, '원본 높이'),
      crop: {
        x: numeric(crop.x, '잘라내기 X'),
        y: numeric(crop.y, '잘라내기 Y'),
        width: numeric(crop.width, '잘라내기 폭'),
        height: numeric(crop.height, '잘라내기 높이'),
      },
      x: numeric(layout.x, '배경 X'),
      y: numeric(layout.y, '배경 Y'),
      width: numeric(layout.width, '배경 폭'),
      height: numeric(layout.height, '배경 높이'),
      rotation: numeric(layout.rotation, '배경 회전'),
      opacity: numeric(layout.opacity, '배경 투명도'),
      visible: layout.visible,
      calibrated: layout.calibrated,
    } as MapLayout
    if (
      typeof layout.visible !== 'boolean' ||
      typeof layout.calibrated !== 'boolean' ||
      checked.width <= 0 ||
      checked.height <= 0 ||
      checked.opacity < 0 ||
      checked.opacity > 1 ||
      checked.sourceWidth < 1 ||
      checked.sourceWidth > 50000 ||
      checked.sourceHeight < 1 ||
      checked.sourceHeight > 50000 ||
      checked.crop.x < 0 ||
      checked.crop.y < 0 ||
      checked.crop.width < 1 ||
      checked.crop.height < 1 ||
      checked.crop.x + checked.crop.width > checked.sourceWidth + 0.01 ||
      checked.crop.y + checked.crop.height > checked.sourceHeight + 0.01
    )
      throw new Error('배경 도면의 범위와 표시 설정을 확인하세요.')
    if (layout.sourceImage !== undefined) {
      if (
        typeof layout.sourceImage !== 'string' ||
        layout.sourceImage.length > 16000000 ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(layout.sourceImage)
      )
        throw new Error('배경 원본 형식을 확인하세요.')
      checked.sourceImage = layout.sourceImage
    }
    result.layout = checked
  }
  if (value.drawing !== undefined) {
    const drawing = record(value.drawing, '원본 도면')
    const image = drawing.image
    if (typeof image !== 'string') throw new Error('도면 이미지가 필요합니다.')
    if (
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) ||
      image.length > 16000000
    )
      throw new Error('도면 이미지 형식을 확인하세요.')
    const width = numeric(drawing.width, '도면 폭'),
      height = numeric(drawing.height, '도면 높이')
    if (width < 1 || height < 1 || width > 50000 || height > 50000)
      throw new Error('도면 크기를 확인하세요.')
    const scale =
      drawing.scaleMmPerPixel === null ? null : numeric(drawing.scaleMmPerPixel, '도면 축척')
    if ((scale === null) !== (result.units === 'px') || (scale !== null && scale <= 0))
      throw new Error('도면 축척과 좌표 단위가 일치하지 않습니다.')
    result.drawing = {
      id: text(drawing.id, '도면 식별자'),
      name: text(drawing.name, '도면 이름'),
      image,
      width,
      height,
      routeColor: text(drawing.routeColor, '경로 색상'),
      scaleMmPerPixel: scale,
    }
    if (drawing.workingScale !== undefined) {
      const value = numeric(drawing.workingScale, '도면 작업 비율')
      if (value <= 0 || value > 1000000) throw new Error('도면 작업 비율을 확인하세요.')
      result.drawing.workingScale = value
    }
    if (drawing.frame !== undefined) {
      const frame = record(drawing.frame, '도면 좌표 맞춤')
      result.drawing.frame = {
        x: numeric(frame.x, '도면 원점 X'),
        y: numeric(frame.y, '도면 원점 Y'),
        rotation: numeric(frame.rotation, '도면 회전'),
      }
    }
    if (drawing.sourceImage !== undefined) {
      if (
        typeof drawing.sourceImage !== 'string' ||
        drawing.sourceImage.length > 16000000 ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(drawing.sourceImage)
      )
        throw new Error('도면 원본 이미지 형식을 확인하세요.')
      result.drawing.sourceImage = drawing.sourceImage
    }
    if (drawing.objects !== undefined) {
      result.drawing.objects = array(drawing.objects, '도면 인식 객체', 5000).map((item) => {
        const object = record(item, '도면 객체')
        const kind = text(object.kind, '객체 종류') as DrawingObject['kind']
        const status = text(object.status, '검토 상태') as DrawingObject['status']
        if (
          !['rack', 'shelf', 'conveyor', 'equipment', 'port', 'obstacle', 'text'].includes(kind) ||
          !['accepted', 'review', 'rejected'].includes(status)
        )
          throw new Error('도면 객체 종류나 상태를 확인하세요.')
        const checked: DrawingObject = {
          id: text(object.id, '도면 객체 ID'),
          kind,
          status,
          label: text(object.label, '인식 이름'),
          x: numeric(object.x, '객체 X'),
          y: numeric(object.y, '객체 Y'),
          width: numeric(object.width, '객체 폭'),
          height: numeric(object.height, '객체 깊이'),
          rotation: numeric(object.rotation, '객체 회전'),
          confidence: numeric(object.confidence, '인식 신뢰도'),
        }
        if (
          checked.x < 0 ||
          checked.y < 0 ||
          checked.width <= 0 ||
          checked.height <= 0 ||
          checked.x + checked.width > width + 1 ||
          checked.y + checked.height > height + 1 ||
          checked.confidence < 0 ||
          checked.confidence > 1
        )
          throw new Error('도면 객체 범위를 확인하세요.')
        if (object.heightMm !== undefined) {
          checked.heightMm = numeric(object.heightMm, '설비 높이')
          if (checked.heightMm <= 0 || checked.heightMm > 1000000)
            throw new Error('설비 높이를 확인하세요.')
        }
        if (object.portId !== undefined) checked.portId = text(object.portId, '연결 포트')
        if (object.locked !== undefined) {
          if (typeof object.locked !== 'boolean')
            throw new Error('도면 객체 수정 상태를 확인하세요.')
          checked.locked = object.locked
        }
        return checked
      })
      unique(
        result.drawing.objects.map((object) => object.id),
        '도면 객체',
      )
    }
    for (const key of ['curveRadiusMm', 'vehicleWidthMm', 'clearanceMm'] as const) {
      if (drawing[key] !== undefined) {
        const number = numeric(drawing[key], key)
        if (number < 0 || number > 1000000) throw new Error('도면 검증 치수를 확인하세요.')
        result.drawing[key] = number
      }
    }
    if (drawing.analysisWarnings !== undefined)
      result.drawing.analysisWarnings = array(drawing.analysisWarnings, '도면 분석 알림', 200).map(
        (item) => text(item, '분석 알림'),
      )
    if (drawing.fillets !== undefined)
      result.drawing.fillets = array(drawing.fillets, '자동 곡선', MAX_NODES).map((item) => {
        const fillet = record(item, '자동 곡선')
        return {
          corner: identifier(fillet.corner, '곡선 시작'),
          end: identifier(fillet.end, '곡선 끝'),
          nodes: array(fillet.nodes, '곡선 정점', 1000).map((id) => identifier(id, '곡선 정점')),
          x: numeric(fillet.x, '원본 모서리 X'),
          y: numeric(fillet.y, '원본 모서리 Y'),
        }
      })
  }
  if (value.areas !== undefined) result.areas = validateAreas(value.areas)
  if (value.portGroups !== undefined) {
    const portIds = new Set(ports.map((port) => port.id))
    result.portGroups = array(value.portGroups, '포트 그룹', MAX_PORTS).map((item) => {
      const group = record(item, '포트 그룹')
      const checked: MapPortGroup = {
        id: text(group.id, '그룹 ID'),
        ...optionalNumbers(group, ['nodeId', 'nodeX', 'nodeY', 'offsetX', 'offsetY']),
        x: numeric(group.x, '그룹 X'),
        y: numeric(group.y, '그룹 Y'),
        width: numeric(group.width, '그룹 폭'),
        height: numeric(group.height, '그룹 높이'),
        strokeColor: numeric(group.strokeColor, '그룹 테두리'),
        fillColor: numeric(group.fillColor, '그룹 채움'),
        portIds: array(group.portIds, '그룹 포트', MAX_PORTS).map((id) => text(id, '그룹 포트 ID')),
      }
      if (checked.width < 0 || checked.height < 0 || checked.portIds.some((id) => !portIds.has(id)))
        throw new Error('포트 그룹 크기와 연결을 확인하세요.')
      return checked
    })
    unique(
      result.portGroups.map((group) => group.id),
      '포트 그룹',
    )
  }
  if (value.shapes !== undefined) {
    result.shapes = array(value.shapes, '도형', MAX_NODES).map((item) => {
      const shape = record(item, '도형')
      const fields = [
        'x1',
        'y1',
        'x2',
        'y2',
        'centerX',
        'centerY',
        'radius',
        'width',
        'height',
        'type',
        'strokeColor',
        'strokeStyle',
        'strokeWidth',
        'fillColor',
        'fontColor',
        'fontAlign',
        'fontDirection',
        'fillStyle',
      ] as const
      const checked = {
        id: identifier(shape.id, '도형 ID'),
        description: text(shape.description, '도형 설명'),
        text: text(shape.text, '도형 텍스트'),
      } as MapShape
      for (const field of fields) checked[field] = numeric(shape[field], `도형 ${field}`)
      if (
        !Number.isInteger(checked.type) ||
        checked.type < 1 ||
        checked.type > 6 ||
        checked.strokeWidth < 0 ||
        checked.width < 0 ||
        checked.height < 0
      )
        throw new Error('도형 종류와 크기를 확인하세요.')
      return checked
    })
    unique(
      result.shapes.map((shape) => shape.id),
      '도형',
    )
  }
  if (value.legacy !== undefined) {
    const legacy = record(value.legacy, '기존 지도 정보')
    result.legacy = {
      version: identifier(legacy.version, '원본 버전'),
      nodeRecords: identifier(legacy.nodeRecords, '원본 노드 레코드'),
      pathRecords: identifier(legacy.pathRecords, '원본 경로 레코드'),
      shapeRecords: identifier(legacy.shapeRecords, '원본 도형 레코드'),
    }
  }
  return result
}
/**
 * 새 지도 편집에 사용할 기본 메타데이터와 빈 목록을 만드는 초기 문서 생성
 * @returns 노드와 경로 및 포트가 비어 있는 기본 지도 문서
 */
export const emptyDocument = (): MapDocument => {
  return {
    format: 'ts-mgs',
    version: 1,
    name: '새 지도',
    units: 'mm',
    nodes: [],
    edges: [],
    ports: [],
  }
}
/**
 * 기본 화면에서 사용할 샘플 노드와 경로 및 포트를 만드는 예시 지도 생성
 * @returns 기본 표시와 편집에 사용하는 샘플 지도 문서
 */
export const demoDocument = (): MapDocument => {
  const map = emptyDocument()
  map.name = 'BEM · 물류 이송 라인'
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 7; col++) {
      const id = row * 7 + col + 1
      map.nodes.push({
        id,
        x: col * 1200,
        y: row * 1400,
        name: `N${String(id).padStart(3, '0')}`,
      })
      if (col) map.edges.push({ id: `E${id - 1}-${id}`, from: id - 1, to: id })
      if (row && (col === 0 || col === 3 || col === 6))
        map.edges.push({ id: `E${id - 7}-${id}`, from: id - 7, to: id })
      if ((row === 0 || row === 3) && [1, 3, 5].includes(col)) {
        const portId = `P${String(map.ports.length + 1).padStart(2, '0')}`
        map.ports.push({
          id: portId,
          nodeId: id,
          x: col * 1200,
          y: row * 1400 + (row ? 650 : -650),
          name: row ? 'OUTBOUND' : 'INBOUND',
        })
      }
    }
  }
  return map
}
