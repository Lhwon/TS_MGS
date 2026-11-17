/**
 * 파일명: check-fsd.mjs
 * 설명: 프로젝트 레이어 방향과 슬라이스 공개 진입점을 확인하는 의존성 검사
 * 작성자: 이희원
 * 작성일자: 2026-10-20
 */
import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../src', import.meta.url))
const layers = ['app', 'pages', 'widgets', 'features', 'entities', 'shared']
/**
 * 운영체제별 경로 구분자를 공통 구분자로 바꾸는 소스 경로 정규화
 *
 * @param value 현재 처리 단계에서 검증하거나 반영할 입력 값
 * @returns 공통 경로 구분자로 정규화한 소스 경로
 */
const normalize = (value) => value.split(path.sep).join('/')
/**
 * 소스와 대상 슬라이스의 레이어 방향 및 공개 진입점을 확인하는 의존성 경계 판정
 *
 * @param from 연결 출발 노드 또는 의존성 검사 출발 경로
 * @param to 연결 도착 노드 또는 의존성 검사 대상 경로
 * @returns 의존성 규칙 위반 사유 또는 위반이 없는 경우의 빈 결과
 */
const boundaryError = (from, to) => {
  const source = from.split('/'),
    target = to.split('/')
  if (source.length === 1) return null // 애플리케이션 진입점과 환경 타입 선언의 경계 검사 제외
  const sourceLayer = layers.indexOf(source[0]),
    targetLayer = layers.indexOf(target[0])
  if (sourceLayer < 0 || targetLayer < 0) return '정의되지 않은 레이어'
  const sameLayer = sourceLayer === targetLayer
  const sameSlice = sameLayer && (['app', 'shared'].includes(source[0]) || source[1] === target[1])
  if (!sameSlice && targetLayer <= sourceLayer)
    return '상위 레이어 또는 같은 레이어의 다른 슬라이스 참조'
  if (!sameSlice && !to.endsWith('/index.ts')) return '다른 슬라이스는 index.ts 공개 API로만 참조'
  return null
}
/**
 * 하위 디렉터리를 순회하여 검사 대상 소스 파일을 모으는 파일 목록 조회
 *
 * @param directory 하위 검사 대상 파일을 수집할 디렉터리
 * @returns 검사 대상 소스의 절대 파일 경로 목록
 */
const files = async (directory) => {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await files(file)))
    else if (/\.(ts|vue)$/.test(entry.name)) result.push(file)
  }
  return result
}
/**
 * 소스 별칭과 확장자 생략 및 공개 진입점을 확인하는 모듈 경로 해석
 *
 * @param file 읽거나 경로를 해석할 대상 파일
 * @param specifier 현재 소스 파일에 선언된 별칭 또는 상대 모듈 경로
 * @returns 실제로 존재하는 모듈 경로 또는 경로를 찾지 못한 결과
 */
const resolveImport = async (file, specifier) => {
  const base = specifier.startsWith('@/')
    ? path.resolve(root, specifier.slice(2))
    : path.resolve(path.dirname(file), specifier)
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.vue`,
    `${base}.css`,
    path.join(base, 'index.ts'),
  ]) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // 다음 확장자 후보 확인
    }
  }
  return null
}
const errors = []
let count = 0
for (const file of await files(root)) {
  const from = normalize(path.relative(root, file))
  if (!from.includes('/') && !['main.ts', 'env.d.ts'].includes(from))
    errors.push(`${from}: 최상위에는 진입점과 환경 타입만 둘 수 있습니다.`)
  if (from.includes('/') && !layers.includes(from.split('/')[0]))
    errors.push(`${from}: 정의되지 않은 레이어`)
  const content = await readFile(file, 'utf8')
  const imports = content.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)
  for (const match of imports) {
    const specifier = match[1]
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue
    const target = await resolveImport(file, specifier)
    if (!target) {
      errors.push(`${from}: 없는 모듈 ${specifier}`)
      continue
    }
    const to = normalize(path.relative(root, target))
    const error = boundaryError(from, to)
    if (error) errors.push(`${from} → ${to}: ${error}`)
    count++
  }
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else console.log(`FSD boundaries OK (${count} local imports)`)
