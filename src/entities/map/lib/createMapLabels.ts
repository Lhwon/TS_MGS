/**
 * 파일명: createMapLabels.ts
 * 설명: 두 지도 화면에서 공유하는 원본 라벨 위치와 글꼴 및 색상 구성
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import type { MapDocument, MapPort } from '@/entities/map/model/map.ts'
import {
  legacyColor,
  mgsTheme,
  nodeLabel,
  displayMapPorts,
  type Layers,
} from '@/entities/map/model/view.ts'

// 축소 화면에서 글자 대신 번진 점으로 보이는 라벨을 제외하는 최소 표시 크기
export const MIN_MAP_LABEL_PIXELS = 6

export interface MapLabel {
  text: string
  x: number
  y: number
  size: number
  color: number
  background?: number
  rotation: number
  align: CanvasTextAlign
}

/**
 * 원본 도형의 검정색과 흰색을 현재 지도 밝기에 맞추는 공통 색상 변환
 * @param color 원본 COLORREF 색상
 * @param theme 현재 지도 테마
 * @returns 현재 테마에 맞춘 렌더링 색상
 */
export const mapObjectColor = (color: number, theme: ReturnType<typeof mgsTheme>) =>
  color === 0 ? theme.font : color === 0xffffff ? theme.background : legacyColor(color)

/** 원본 이름 배치와 인출선에서 공유하는 포트 캡션 기준 좌표 계산 */
export const portNameAnchor = (port: MapPort) => {
  const size = port.fontSize || 10,
    distance = Math.trunc((port.nameDistance ?? 0) / 10)
  let x = port.x,
    y = port.y
  switch (port.namePosition) {
    case 0:
      x += size + distance
      y += (port.height ?? 0) + distance
      break
    case 1:
      x += size + distance
      y += -(port.height ?? 0) + distance
      break
    case 2:
      x += (port.width ?? 0) + distance
      y -= size + distance
      break
    case 3:
      x += -(port.width ?? 0) + distance
      y -= size + distance
      break
  }
  return { x, y }
}

/**
 * 원본 좌표와 글자 크기를 유지하는 두 화면의 공통 라벨 목록 생성
 * @param map 현재 지도 문서
 * @param layers 현재 표시 옵션
 * @param theme 현재 지도 테마
 * @returns 지도 좌표 단위의 텍스트 배치 목록
 */
export const createMapLabels = (
  map: MapDocument,
  layers: Layers,
  theme: ReturnType<typeof mgsTheme>,
) => {
  const labels: MapLabel[] = []
  if (!layers.labels) return labels
  if (layers.nodes)
    for (const node of map.nodes) {
      const text = nodeLabel(node, layers)
      if (!text) continue
      labels.push({
        text: [
          text,
          ...(node.safetyDistance
            ? [`Safety : ${node.safetyDistance.toLocaleString('en-US')}`]
            : []),
          ...(node.safetyViewDistance
            ? [`View : ${node.safetyViewDistance.toLocaleString('en-US')}`]
            : []),
        ].join('\n'),
        x: node.x + 250,
        y: node.y - 100,
        size: layers.fontStyle ? theme.nodeFontSize : node.virtual || node.curve ? 70 : 100,
        color:
          node.safetyDistance || node.safetyViewDistance
            ? 0xff0000
            : !layers.fontStyle && (node.virtual || node.curve)
              ? theme.virtual
              : theme.font,
        background: theme.fontBackground,
        rotation: 0,
        align: 'center',
      })
    }
  if (layers.ports)
    for (const port of displayMapPorts(map)) {
      const extra = [
        layers.portIndices
          ? `${map.ports.findIndex((item) => item.id === port.id) + 1}\nUCS Idx : ${port.settings?.ucs_setting_idx ?? -1}`
          : '',
        layers.portReports ? String(port.settings?.report_id ?? '') : '',
        layers.portShifts ? `LU Shift ${port.settings?.lu_shift ?? 0}` : '',
        layers.portHandshake ? `PIO ${port.settings?.handshaking ?? 0}` : '',
        layers.portDirection ? `LU Dir ${port.settings?.lu_dir ?? 0}` : '',
        layers.portHeight ? `LU Height ${port.settings?.lu_height0 ?? 0}` : '',
      ]
        .filter(Boolean)
        .join('\n')
      if (extra)
        labels.push({
          text: extra,
          x: port.x,
          y: port.y - 200,
          size: 100,
          color: theme.font,
          rotation: 0,
          align: 'center',
        })
      if (layers.portIds)
        labels.push({
          text: port.id,
          x: port.x,
          y: port.y + 100,
          size: 100,
          color: 0xff0000,
          rotation: (port.nameDirection ?? 0) > 0 ? Math.PI / 2 : 0,
          align: 'center',
        })
      if (!port.name || layers.portNames === false) continue
      const size = port.fontSize || 10
      const { x, y } = portNameAnchor(port)
      labels.push({
        text: port.name,
        x,
        y: y + 100,
        size: size * 10,
        color: mapObjectColor(port.fontColor ?? 0, theme),
        rotation: (port.nameDirection ?? 0) > 0 ? Math.PI / 2 : 0,
        align: 'center',
      })
    }
  const controlViews = [
    ['pathReverses', 'reverse', 'Reverse'],
    ['pathDegrees', 'vehicleDegree', 'Vehicle Degree'],
    ['pathOds', 'odsField0', 'ODS Field'],
    ['pathWeights', 'pathWeight', 'Weight'],
    ['pathSpinturns', 'spinturnableDegree', 'Spinturnable'],
    ['pathGuidance', 'guidanceType', 'Guidance'],
    ['pathControlWeights', 'controlWeight', 'Control Weight'],
    ['pathMeanDev', 'meandevIgnore', 'Meandev'],
  ] as const
  if (
    layers.edges &&
    (layers.pathDistances ||
      layers.pathRadii ||
      layers.pathTypes ||
      layers.pathSpeeds ||
      controlViews.some(([key]) => layers[key]))
  ) {
    const nodes = new Map(map.nodes.map((node) => [node.id, node]))
    for (const edge of map.edges) {
      const from = nodes.get(edge.from)!,
        to = nodes.get(edge.to)!
      const controls = edge.controls?.forward ?? edge.controls?.backward
      const text = [
        ...(layers.pathTypes ? [`Type ${edge.drivingType ?? 1}`] : []),
        ...(layers.pathSpeeds ? [`Speed ${edge.speed ?? 0}`] : []),
        ...controlViews.flatMap(([key, field, label]) =>
          layers[key] ? [`${label} ${controls?.[field] ?? 0}`] : [],
        ),
        ...(layers.pathDistances
          ? [
              `${Math.trunc(edge.distance ?? Math.hypot(to.x - from.x, to.y - from.y)).toLocaleString('en-US')} mm`,
            ]
          : []),
        ...(layers.pathRadii && [2, 3].includes(edge.drivingType ?? 1) && !to.curve
          ? [`(R${Math.trunc(edge.radius ?? 0)})`]
          : []),
      ].join('\n')
      if (text)
        labels.push({
          text,
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2,
          size: 80,
          color: theme.font,
          background: theme.fontBackground,
          rotation: 0,
          align: 'center',
        })
    }
  }
  for (const shape of map.shapes ?? [])
    if (shape.type === 6)
      labels.push({
        text: shape.text,
        x: shape.x1,
        y: shape.y1,
        size: Math.max(1, shape.height * 10),
        color: mapObjectColor(shape.fontColor, theme),
        rotation: shape.fontDirection === 2 ? -Math.PI / 2 : 0,
        align: shape.fontAlign === 2 ? 'right' : shape.fontAlign === 3 ? 'center' : 'left',
      })
  return labels
}

/**
 * 두 화면에서 동일한 정렬과 행간 및 배경을 적용하는 라벨 페인팅
 * @param ctx 화면 문자 컨텍스트
 * @param label 원본 지도 라벨
 * @param x 투영된 화면 가로 좌표
 * @param y 투영된 화면 세로 좌표
 * @param size 투영된 화면 글자 크기
 */
export const paintMapLabel = (
  ctx: CanvasRenderingContext2D,
  label: MapLabel,
  x: number,
  y: number,
  size: number,
) => {
  if (!Number.isFinite(size) || size < MIN_MAP_LABEL_PIXELS) return
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(label.rotation)
  ctx.font = `${size}px "Pretendard", sans-serif`
  ctx.textAlign = label.align
  ctx.textBaseline = 'top'
  const lines = label.text.split('\n')
  if (label.background !== undefined) {
    const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + size * 0.4
    ctx.globalAlpha = 0.8
    ctx.fillStyle = `#${label.background.toString(16).padStart(6, '0')}`
    ctx.fillRect(
      label.align === 'center' ? -width / 2 : label.align === 'right' ? -width : 0,
      0,
      width,
      size * 1.3 * lines.length,
    )
    ctx.globalAlpha = 1
  }
  ctx.fillStyle = `#${label.color.toString(16).padStart(6, '0')}`
  lines.forEach((line, index) => ctx.fillText(line, 0, index * size * 1.3))
  ctx.restore()
}
