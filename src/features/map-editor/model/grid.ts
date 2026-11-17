/**
 * 파일명: grid.ts
 * 설명: 일정 간격의 행과 열 노드 및 직교 연결을 생성하는 원본 격자 편집
 * 작성자: 이희원
 * 작성일자: 2026-11-17
 */
import { MAX_NODES, parseDocument, type MapDocument } from '@/entities/map/index.ts'
/** 기존 문서에 격자를 추가하며 개수와 좌표 중복을 확인하는 노드 생성 */
export const createGrid = (
  input: MapDocument,
  options: {
    rows: number
    columns: number
    spacingX: number
    spacingY: number
    x: number
    y: number
  },
) => {
  const { rows, columns, spacingX, spacingY, x, y } = options
  if (
    ![rows, columns, spacingX, spacingY, x, y].every(Number.isSafeInteger) ||
    rows < 1 ||
    columns < 1 ||
    spacingX < 1 ||
    spacingY < 1 ||
    rows * columns + input.nodes.length > MAX_NODES
  )
    throw new Error('격자 개수와 양의 정수 간격 및 최대 15,000개 제한을 확인하세요.')
  const map = structuredClone(input),
    positions = new Set(map.nodes.map((node) => `${node.x},${node.y}`)),
    ids: number[][] = []
  let nextId = Math.max(0, ...map.nodes.map((node) => node.id)),
    uid = Math.max(0, ...map.nodes.map((node) => node.uid ?? node.id)),
    realId = Math.max(
      0,
      ...map.nodes.filter((node) => !node.virtual).map((node) => node.realId ?? node.id),
    )
  for (let row = 0; row < rows; row++) {
    ids[row] = []
    for (let col = 0; col < columns; col++) {
      const px = x + col * spacingX,
        py = y + row * spacingY,
        key = `${px},${py}`
      if (positions.has(key)) throw new Error(`격자 위치 (${px}, ${py})에 기존 노드가 있습니다.`)
      positions.add(key)
      const id = ++nextId
      ids[row][col] = id
      map.nodes.push({
        id,
        name: `N${id}`,
        uid: ++uid,
        realId: ++realId,
        x: px,
        y: py,
        direction: 1,
      })
      for (const previous of [
        col ? ids[row][col - 1] : undefined,
        row ? ids[row - 1][col] : undefined,
      ])
        if (previous !== undefined)
          map.edges.push({
            id: `G-${id}-${previous}`,
            from: previous,
            to: id,
            direction: 1,
            drivingType: 1,
            distance: col && previous === ids[row][col - 1] ? spacingX : spacingY,
          })
    }
  }
  return parseDocument(JSON.stringify(map))
}
