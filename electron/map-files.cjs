/**
 * 파일명: map-files.cjs
 * 설명: 지도 확장자와 파일 크기 및 날짜 기반 최신 파일 선택 처리
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
const fs = require('node:fs/promises')
const path = require('node:path')
const MAX_BYTES = 32 * 1024 * 1024
/**
 * 지원 확장자와 파일 크기를 확인하고 인접 테마를 함께 읽는 지도 파일 로딩
 *
 * @param file 읽거나 경로를 해석할 대상 파일
 * @returns 원본 지도 내용과 선택적으로 포함한 테마 정보
 */
const readMapFile = async (file) => {
  if (!/\.(json|jmapx)$/i.test(file)) throw new Error('JSON 또는 JMAPX 파일을 선택하세요.')
  if ((await fs.stat(file)).size > MAX_BYTES) throw new Error('파일 크기는 32MB 이하여야 합니다.')
  const content = await fs.readFile(file, 'utf8')
  if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('파일 크기는 32MB 이하여야 합니다.')
  let theme
  let portGroups
  if (/\.jmapx$/i.test(file) && path.basename(path.dirname(file)).toLowerCase() === 'map') {
    const themeFile = path.join(path.dirname(file), '..', 'SETTING', 'Theme.INI')
    try {
      if ((await fs.stat(themeFile)).size > 65536) throw new Error('Theme.INI 파일이 너무 큽니다.')
      theme = await fs.readFile(themeFile, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (/\.jmapx$/i.test(file) && path.basename(path.dirname(file)).toLowerCase() === 'map') {
    const groupFile = path.join(
      path.dirname(file),
      '..',
      'DATA',
      `${path.parse(file).name}_port_group.bem`,
    )
    try {
      if ((await fs.stat(groupFile)).size > MAX_BYTES)
        throw new Error('포트 그룹 파일이 너무 큽니다.')
      portGroups = await fs.readFile(groupFile, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  const areaFiles = {}
  if (/\.jmapx$/i.test(file) && path.basename(path.dirname(file)).toLowerCase() === 'map')
    for (const suffix of ['bay', 'bay_group', 'zone', 'bay_offset', 'limit_ports']) {
      const target = path.join(
        path.dirname(file),
        '..',
        'DATA',
        `${path.parse(file).name}_${suffix}.bem`,
      )
      try {
        if ((await fs.stat(target)).size > MAX_BYTES)
          throw new Error('영역 설정 파일이 너무 큽니다.')
        areaFiles[suffix] = await fs.readFile(target, 'utf8')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  return {
    name: path.basename(file),
    content,
    ...(Object.keys(areaFiles).length ? { areaFiles } : {}),
    ...(theme === undefined ? {} : { theme }),
    ...(portGroups === undefined ? {} : { portGroups }),
  }
}
/**
 * 원본 지도 파일명에 포함된 날짜와 시각을 비교값으로 해석하는 최신 지도 판정 기준 추출
 *
 * @param name 파일 또는 모델을 구분하는 표시 이름
 * @returns 지도 파일명에 기록된 날짜와 시각의 비교용 값
 */
const timestamp = (name) => {
  const match = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.jmapx$/i.exec(name)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  )
    return null
  return date.getTime()
}
/**
 * 지정 폴더의 지도 파일명을 비교하여 가장 최근 원본 지도를 선택하는 폴더 열기
 *
 * @param folder 최신 지도 탐색을 시작할 기준 폴더
 * @returns 최신 지도 파일의 내용과 테마 정보
 */
const openMapFolder = async (folder) => {
  let directory = folder
  try {
    if ((await fs.stat(path.join(folder, 'MAP'))).isDirectory())
      directory = path.join(folder, 'MAP')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const maps = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, time: timestamp(entry.name) }))
    .filter((entry) => entry.time !== null)
    .sort((a, b) => b.time - a.time)
  if (!maps.length)
    throw new Error('MAP 폴더 또는 RCS 폴더를 선택하세요. YYYYMMDD_HHmmss.jmapx 파일이 필요합니다.')
  return { ...(await readMapFile(path.join(directory, maps[0].name))), directory }
}
module.exports = { readMapFile, openMapFolder }
