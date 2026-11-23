/**
 * 파일명: map-files.cjs
 * 설명: 지도 확장자와 파일 크기 및 날짜 기반 최신 파일 선택 처리
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
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
const openMapFolder = async (folder, allowEmpty = false) => {
  let directory = folder
  if (!(await fs.stat(folder)).isDirectory()) throw new Error('프로젝트 폴더를 선택하세요.')
  if (allowEmpty && path.basename(folder).toLowerCase() !== 'map')
    directory = path.join(folder, 'MAP')
  try {
    if ((await fs.stat(path.join(folder, 'MAP'))).isDirectory())
      directory = path.join(folder, 'MAP')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (allowEmpty && error.code === 'ENOENT') return []
    throw error
  })
  const maps = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, time: timestamp(entry.name) }))
    .filter((entry) => entry.time !== null)
    .sort((a, b) => b.time - a.time)
  if (!maps.length && allowEmpty) return { directory }
  if (!maps.length)
    throw new Error('MAP 폴더 또는 RCS 폴더를 선택하세요. YYYYMMDD_HHmmss.jmapx 파일이 필요합니다.')
  return { ...(await readMapFile(path.join(directory, maps[0].name))), directory }
}
/** 연결 MAP 폴더에 대응하는 SYSTEM.INI의 기존 문자 인코딩과 본문 읽기 */
const readBaySettings = async (directory) => {
  if (path.basename(directory).toLowerCase() !== 'map')
    throw new Error('먼저 RCS 프로젝트 또는 MAP 폴더를 선택하세요.')
  const target = path.join(directory, '..', 'SETTING', 'SYSTEM.INI')
  let raw
  try {
    if ((await fs.stat(target)).size > 1024 * 1024) throw new Error('SYSTEM.INI 파일이 너무 큽니다.')
    raw = await fs.readFile(target)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    raw = Buffer.alloc(0)
  }
  const encoding = raw[0] === 255 && raw[1] === 254 ? 'utf16le' : 'latin1'
  const encodedBom = encoding === 'utf16le' ? 2 : raw.subarray(0, 3).equals(Buffer.from([239, 187, 191])) ? 3 : 0
  return { target, encoding, bom: raw.subarray(0, encodedBom), content: raw.subarray(encodedBom).toString(encoding) }
}

const bayLine = /^[ \t]*bay_to_use[ \t]*=[ \t]*([^\r\n]*)/im

/** 다른 섹션과 줄바꿈을 그대로 두기 위한 Bay 본문 범위 조회 */
const locateBaySection = (content) => {
  const header = /^[ \t]*\[bay\][^\r\n]*(?:\r?\n|$)/im.exec(content)
  if (!header) return undefined
  const start = header.index + header[0].length
  const boundary = content.slice(start).search(/^[ \t]*\[[^\r\n]+]/m)
  return { start, end: boundary === -1 ? content.length : start + boundary }
}

/**
 * 프로젝트 원본 설정에서 적용 후보로 저장한 Bay 번호 조회
 * @param directory 발급한 프로젝트 식별자와 연결된 MAP 폴더
 * @returns 오름차순의 유효한 Bay 번호
 */
const readProjectBayFilter = async (directory) => {
  if (path.basename(directory).toLowerCase() !== 'map') return []
  const { content } = await readBaySettings(directory)
  const section = locateBaySection(content)
  const value = section ? (content.slice(section.start, section.end).match(bayLine)?.[1] ?? '') : ''
  return [...new Set(value.split(';').filter((item) => /^\d+$/.test(item.trim())).map(Number))]
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .sort((a, b) => a - b)
}

/**
 * 다른 INI 섹션과 기존 인코딩을 보존하면서 Bay 필터 목록만 원자적으로 저장
 * @param directory 발급한 프로젝트 식별자와 연결된 MAP 폴더
 * @param bayIds 화면에서 지정한 Bay 번호
 */
const saveProjectBayFilter = async (directory, bayIds) => {
  if (!Array.isArray(bayIds) || bayIds.length > 9999 ||
    bayIds.some((id) => !Number.isSafeInteger(id) || id < 1 || id > 1000000))
    throw new Error('저장할 Bay 번호 목록을 확인하세요.')
  const { target, encoding, bom, content } = await readBaySettings(directory)
  const newline = content.includes('\n') && !content.includes('\r\n') ? '\n' : '\r\n'
  const unique = [...new Set(bayIds)].sort((a, b) => a - b)
  const assignment = 'bay_to_use=' + (unique.length ? unique.join(';') + ';' : '')
  const section = locateBaySection(content)
  let next
  if (!section) {
    const separator = content && !content.endsWith('\n') ? newline : ''
    next = content + separator + '[Bay]' + newline + assignment + newline
  } else {
    const { start, end } = section
    const body = content.slice(start, end)
    const updatedBody = bayLine.test(body) ? body.replace(bayLine, assignment) : assignment + newline + body
    const header = content.slice(0, start)
    next = header + (header.endsWith('\n') ? '' : newline) + updatedBody + content.slice(end)
  }
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = target + '.' + randomUUID() + '.tmp'
  try {
    await fs.writeFile(temporary, Buffer.concat([bom, Buffer.from(next, encoding)]), { flag: 'wx' })
    await fs.rename(temporary, target)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

/**
 * 원본 지도 파일과 이름이 일치하는 Block 또는 Blocking 검토 자료 조회
 * @param directory 승인된 프로젝트의 지도 디렉터리
 * @param name 현재 열린 JMAPX 파일명
 * @param type 읽을 고정 자료 확장자
 * @returns 원본 검토 자료 또는 파일 부재를 나타내는 값
 */
const readProjectBlockData = async (directory, name, type) => {
  if (path.basename(directory).toLowerCase() !== 'map') return null
  if (typeof name !== 'string' || !/^[^\\/:*?"<>|\u0000-\u001f]+\.jmapx$/i.test(name) ||
    name !== path.basename(name) || !['fmd', 'blk'].includes(type))
    throw new Error('Block 자료의 기준 지도와 형식을 확인하세요.')
  const target = path.join(directory, '..', 'DATA', path.parse(name).name + '.' + type)
  try {
    if ((await fs.stat(target)).size > MAX_BYTES) throw new Error('Block 자료가 32MB를 초과합니다.')
    return { name: path.basename(target), content: await fs.readFile(target, 'utf8') }
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

module.exports = { readMapFile, openMapFolder, readProjectBayFilter, saveProjectBayFilter, readProjectBlockData }
