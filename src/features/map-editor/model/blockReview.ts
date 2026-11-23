/**
 * 파일명: blockReview.ts
 * 설명: 원본 FMD와 BLK 레코드의 검토 열과 지도 참조 추출
 * 작성자: 이희원
 * 작성일자: 2026-11-23
 */
export type BlockReviewType = 'fmd' | 'blk'
const blockingTypes = ['NONE', 'PRE_O', 'OPPOSITE', 'SIGNAL', 'DEPTH', 'AVOID']

const blockHeaders = [
  'IDX', 'BLOCK TYPE', 'DIR. TYPE', 'START', 'END', 'ENTRY', 'COLL. END',
  'LIMIT NUM. VHL', 'BLOCK WEIGHT', 'PUSH', 'AVOID', 'WAIT',
  'START DEGREE', 'END DEGREE',
]

const blockingHeaders = ['IDX', 'TYPE', 'PORT', 'ENTRY NODE', 'END BLOCK', 'COLL. END BLOCK']

/**
 * 원본의 개수 접두사와 동적 목록 범위를 검사하고 파일별 검토 행 구성
 * @param content FMD 또는 BLK 원본 파일 내용
 * @param type Block 또는 Blocking 구분
 * @returns 검토표 열과 행 및 지도 표시용 노드 식별자
 * @throws 헤더 개수나 필수 레코드 또는 목록 길이가 원본 형식과 다른 경우
 */
export const readBlockReview = (content: string, type: BlockReviewType) => {
  const [header, ...lines] = content.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/)
  const size = Number(header.split('\t')[0])
  if (!Number.isSafeInteger(size) || size < 1 || size > 150001 || lines.length !== size - 1)
    throw new Error('원본 Block 자료의 레코드 개수가 맞지 않습니다.')

  const rows = lines.map((line, index) => {
    const fields = line.trimEnd().split('\t')
    let offset = 0
    const malformed = () => new Error(`Block 자료 ${index + 2}행의 형식을 확인하세요.`)
    const readNumber = (integer = true) => {
      const raw = fields[offset++]
      const value = Number(raw)
      if (!raw?.trim() || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value)))
        throw malformed()
      return value
    }
    const readList = (pairs = false) => {
      const count = readNumber()
      if (count < 0 || count > 150000 || offset + count * (pairs ? 2 : 1) > fields.length)
        throw malformed()
      return Array.from({ length: count }, () => {
        const id = readNumber()
        if (pairs) readNumber(false)
        return id
      })
    }

    const id = index + 1
    if (type === 'blk') {
      const code = readNumber()
      const portCount = readNumber()
      const endCount = readNumber()
      const collided = readNumber()
      const blocks = readList()
      const entry = readList()
      const nodes = readList()
      readList()
      readList()
      const uids = readList()
      return {
        id,
        cells: [id, blockingTypes[code] ?? code, portCount, entry.length, endCount, collided ? 'Yes' : 'No'],
        description: `Include Block IDX · ${blocks.join(', ') || '—'}`,
        nodeIds: [...new Set([...entry, ...nodes])],
        nodeUids: uids,
        blockIds: blocks,
      }
    }

    const head = Array.from({ length: 18 }, () => readNumber())
    const nodes = readList(true)
    const links = Array.from({ length: 5 }, () => readList(true)).flat()
    const bays = readList()
    return {
      id,
      cells: [
        id, head[2], head[7], head[0], head[1], head[8], head[15] ? 'Yes' : 'No',
        head[12], head[13], head[9], head[10], head[11], head[16], head[17],
      ],
      description: `Bay · ${bays.join(', ') || '—'}`,
      nodeIds: [...new Set([head[0], head[1], ...nodes])],
      nodeUids: [],
      blockIds: links,
    }
  })

  return { headers: type === 'fmd' ? blockHeaders : blockingHeaders, rows }
}

