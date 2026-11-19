/**
 * 파일명: mgsTraining.ts
 * 설명: 교육 슬라이드와 실습 영상에서 확인한 작업 근거의 폐쇄망 검색
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
const sources = import.meta.glob('/agent-knowledge/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

// Markdown 제목과 검색어 및 출처 필드를 함께 읽어 교육 항목으로 구성
const training = Object.entries(sources).flatMap(([file, markdown]) => {
  const sourceName = file.split('/').at(-1)!
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const [title, ...lines] = section.split(/\r?\n/)
      const field = (name: string) =>
        lines
          .find((line) => line.startsWith(name))
          ?.slice(name.length)
          .trim()
      const guidance = lines
        .filter((line) => !/^(검색어|출처):/.test(line))
        .join('\n')
        .trim()
      return {
        title: title.trim(),
        terms:
          field('검색어:')
            ?.split(',')
            .map((word) => word.trim()) ?? title.split(/\s+/),
        source: field('출처:') ?? sourceName,
        guidance,
      }
    })
})
/** 한글 표현과 영문 용어를 비교해 관련 작업 근거만 선별하는 로컬 검색 */
export const searchMgsTraining = (query: string) => {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]/gu, '')
  const input = normalize(query)
  if (!input || query.length > 500) throw new Error('교육 자료에서 찾을 주제를 입력하세요.')
  return training
    .map(({ terms, ...entry }) => ({
      entry,
      score: terms.reduce((sum, term) => {
        const key = normalize(term)
        return (
          sum +
          (input.includes(key) || (input.length >= 2 && key.includes(input))
            ? Math.min(8, key.length)
            : 0)
        )
      }, 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ entry }) => entry)
}
