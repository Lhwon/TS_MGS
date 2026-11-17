/**
 * 파일명: save-map.cjs
 * 설명: 원본 시간 기반 파일명과 MAP 및 DATA 폴더를 사용하는 지도 묶음 저장
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const MAX_BYTES = 32 * 1024 * 1024

/**
 * 로컬 시간을 원본 지도 파일명으로 변환하는 저장 이름 생성
 * @param date 저장 기준 시각
 * @returns 날짜와 시각 기반 원본 파일명
 */
const mapName = (date) => {
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ]
  const values = parts.map((value) => String(value).padStart(2, '0'))
  return `${values.slice(0, 3).join('')}_${values.slice(3).join('')}.jmapx`
}

/**
 * 원본 지도와 그룹 파일의 형식 및 크기를 확인하는 저장 경계 검증
 * @param content 원본 지도 문자열
 * @param groups 원본 포트 그룹 문자열
 */
const validate = (content, groups) => {
  for (const text of [content, groups])
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES)
      throw new Error('저장 데이터는 32MB 이하 문자열이어야 합니다.')
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (!/^Ver\.(23|25)$/.test(lines[0])) throw new Error('원본 지도 버전을 확인하세요.')
  const counts = lines[1]?.split('\t').map(Number)
  if (
    !counts ||
    counts.length < 8 ||
    [0, 2, 3, 4].some((index) => !Number.isInteger(counts[index]) || counts[index] < 0)
  )
    throw new Error('원본 지도 헤더를 확인하세요.')
  if (lines.length < 2 + counts[0] + counts[2] + counts[3] + Math.max(0, counts[4] - 1))
    throw new Error('원본 지도 레코드가 잘렸습니다.')
}

/**
 * 임시 파일의 기록 완료 후 그룹과 지도를 순서대로 확정하는 신규 버전 저장
 * 기존 파일을 덮어쓰지 않으며 지도 확정 전 실패 시 이번 작업 파일만 제거하는 복구
 * @param directory 원본 MAP 폴더
 * @param content 검증한 JMAPX 문자열
 * @param groups 포트 그룹 문자열
 * @returns 저장을 완료한 지도 파일명
 */
const saveMapVersion = async (directory, content, groups = '', auxiliary = {}) => {
  validate(content, groups)
  if (!auxiliary || typeof auxiliary !== 'object' || Array.isArray(auxiliary))
    throw new Error('부가 저장 데이터 형식을 확인하세요.')
  for (const [key, value] of Object.entries(auxiliary))
    if (
      !['bay', 'bay_group', 'zone', 'bay_offset', 'limit_ports'].includes(key) ||
      typeof value !== 'string' ||
      Buffer.byteLength(value) > MAX_BYTES
    )
      throw new Error('허용되지 않은 부가 저장 데이터입니다.')
  await fs.mkdir(directory, { recursive: true })
  const dataDirectory = path.join(directory, '..', 'DATA')
  const includeGroups = !!groups || content.replace(/^\uFEFF/, '').startsWith('Ver.25')
  if (includeGroups || Object.keys(auxiliary).length)
    await fs.mkdir(dataDirectory, { recursive: true })
  for (let attempt = 0; attempt < 120; attempt++) {
    const name = mapName(new Date(Date.now() + attempt * 1000))
    const mapFile = path.join(directory, name)
    const groupFile = path.join(dataDirectory, `${path.parse(name).name}_port_group.bem`)
    const staged = []
    const committed = []
    try {
      const files = includeGroups
        ? [
            [groupFile, groups],
            [mapFile, content],
          ]
        : [[mapFile, content]]
      files.unshift(
        ...Object.entries(auxiliary).map(([suffix, text]) => [
          path.join(dataDirectory, `${path.parse(name).name}_${suffix}.bem`),
          text,
        ]),
      )
      for (const [file, text] of files) {
        const temporary = `${file}.${randomUUID()}.tmp`
        staged.push(temporary)
        await fs.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' })
      }
      for (let index = 0; index < files.length; index++) {
        // 동일 볼륨 하드 링크로 완성한 파일만 공개하며 기존 버전의 덮어쓰기를 차단하는 확정
        await fs.link(staged[index], files[index][0])
        committed.push(files[index][0])
      }
      return name
    } catch (error) {
      for (const file of committed) await fs.unlink(file).catch(() => {})
      if (error.code !== 'EEXIST') throw error
    } finally {
      for (const file of staged) await fs.unlink(file).catch(() => {})
    }
  }
  throw new Error('동일 시각의 지도 파일이 너무 많습니다. 잠시 후 저장하세요.')
}

module.exports = { saveMapVersion }
