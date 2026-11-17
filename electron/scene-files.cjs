const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { readMapFile } = require('./map-files.cjs')

/** 현재 프로젝트의 통합 설계 또는 분리 실행 파일을 조회하는 삼차원 자동 로딩 */
const readSceneProject = async (mapDirectory) => {
  if (typeof mapDirectory !== 'string' || !path.isAbsolute(mapDirectory))
    throw new Error('프로젝트 지도 폴더를 먼저 선택하세요.')
  const directory = path.join(mapDirectory, '3D')
  try {
    return await readMapFile(path.join(directory, 'project.map3d.json'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  try {
    const layout = await readMapFile(path.join(directory, 'map3d.json'))
    const library = await readMapFile(path.join(directory, 'equipment.json'))
    return { name: 'project.map3d.json', content: layout.content, library: library.content }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return null
  }
}

/** 프로젝트 지도 폴더 아래의 삼차원 저장 폴더 생성 */
const sceneDirectory = async (mapDirectory) => {
  if (typeof mapDirectory !== 'string' || !path.isAbsolute(mapDirectory))
    throw new Error('프로젝트 지도 폴더를 먼저 선택하세요.')
  const directory = path.join(mapDirectory, '3D')
  await fs.mkdir(directory, { recursive: true })
  return directory
}

/** 기존 파일의 복구본을 유지하며 관련 파일을 함께 교체하는 저장 처리 */
const saveSceneFiles = async (mapDirectory, files) => {
  for (const [name, content] of files) {
    if (path.basename(name) !== name || !name.endsWith('.json'))
      throw new Error('삼차원 파일명이 유효하지 않습니다.')
    if (typeof content !== 'string' || Buffer.byteLength(content) > 32 * 1024 * 1024)
      throw new Error('삼차원 데이터는 파일마다 32MB 이하 문자열이어야 합니다.')
    JSON.parse(content)
  }
  const directory = await sceneDirectory(mapDirectory)
  const transaction = randomUUID()
  const staged = []
  const backups = []
  const committed = []
  try {
    for (const [name, content] of files) {
      const target = path.join(directory, name)
      const temporary = `${target}.${transaction}.tmp`
      staged.push(temporary)
      await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
      try {
        const stat = await fs.lstat(target)
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error(`일반 파일이 아닙니다: ${name}`)
        const backup = `${target}.${transaction}.bak`
        await fs.rename(target, backup)
        backups.push([target, backup])
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    for (const [index, [name]] of files.entries()) {
      const target = path.join(directory, name)
      await fs.rename(staged[index], target)
      committed.push(target)
    }
  } catch (error) {
    for (const target of committed) await fs.unlink(target).catch(() => {})
    for (const [target, backup] of backups) await fs.rename(backup, target)
    throw error
  } finally {
    for (const temporary of staged) await fs.unlink(temporary).catch(() => {})
  }
  for (const [, backup] of backups) await fs.unlink(backup).catch(() => {})
  return directory
}

module.exports = { sceneDirectory, saveSceneFiles, readSceneProject }
