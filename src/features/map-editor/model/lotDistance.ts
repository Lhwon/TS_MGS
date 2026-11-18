/**
 * 파일명: lotDistance.ts
 * 설명: 원본 LOT Closer 순위와 탭 구분 저장 형식 생성
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
import type { MapDocument } from '@/entities/map/index.ts'

/** 컨베이어 기준 좌표와 랙 행 및 열과 단수를 반영하는 LOT 우선순위 계산 */
export const makeLotDistance = (map: MapDocument) => {
  if (map.units !== 'mm') throw new Error('LOT Closer를 생성하려면 맵 축척을 mm로 확정하세요.')
  const nodes = new Map(map.nodes.map((node) => [node.id, node]))
  const conveyor = map.ports.filter((port) => port.id.includes('CV'))
  const racks = map.ports.filter((port) => port.id.includes('RACK'))
  if (!conveyor.length || !racks.length) throw new Error('CV 포트와 RACK 포트가 필요합니다.')
  let referenceY = 0
  for (const port of conveyor) {
    const y = nodes.get(port.nodeId)!.y
    referenceY = referenceY === 0 ? y : (referenceY + y) / 2
  }
  const rows = racks
    .map((port) => {
      const parts = port.id.split('_')
      const indices = parts.slice(-3)
      if (parts.length <= 3 || !indices.every((part) => /^\d+$/.test(part)))
        throw new Error(`${port.id}의 끝에 있는 행·열·단수 번호를 확인하세요.`)
      if (/[\t\r\n]/.test(port.id)) throw new Error('포트 ID에 탭이나 줄바꿈을 사용할 수 없습니다.')
      const [row, column, level] = indices.map(Number)
      const score =
        Math.trunc(Math.abs(nodes.get(port.nodeId)!.y - referenceY) * 100000) +
        column * 1000 +
        row * 100 +
        level
      if (!Number.isSafeInteger(score) || score > 2147483647)
        throw new Error(`${port.id}의 LOT 점수가 원본 정수 범위를 벗어납니다.`)
      return { port: port.id, score }
    })
    .sort((a, b) => a.score - b.score)
  return { rows, content: rows.map(({ port, score }) => `${port}\t${score}\n`).join('') + '\r\n' }
}
