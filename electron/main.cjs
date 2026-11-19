/**
 * 파일명: main.cjs
 * 설명: 데스크톱 창과 신뢰 경계 및 지도와 설비 파일 입출력 관리
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron')
const { readFile, writeFile, rename, unlink, mkdir } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { randomUUID } = require('node:crypto')
const { readMapFile, openMapFolder } = require('./map-files.cjs')
const { saveMapVersion, backupMapVersion } = require('./save-map.cjs')
const { saveSceneFiles, readSceneProject } = require('./scene-files.cjs')
const { aiStatus, aiPropose, cancelAi, aiAnalyzeDrawing } = require('./ai-service.cjs')
const mapLocations = new Map()
const MAX_BYTES = 32 * 1024 * 1024
let window
let dirty = false
let activeProject
const fileURL = pathToFileURL(path.join(__dirname, '../dist/index.html')).href
const devURL = process.env.TS_MGS_DEV_URL
if (devURL && !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(devURL))
  throw new Error('Invalid development URL')
const entryURL = !app.isPackaged && devURL ? devURL : fileURL
/**
 * 허용한 창과 최상위 프레임 및 주소에서 전달한 요청만 통과시키는 데스크톱 통신 경계 검증
 *
 * @param event 브라우저 또는 데스크톱에서 전달한 입력 이벤트
 */
const trusted = (event) => {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== entryURL
  )
    throw new Error('허용되지 않은 요청입니다.')
}
ipcMain.handle('ai:status', async (event) => {
  trusted(event)
  return aiStatus()
})
ipcMain.handle('ai:propose', async (event, payload) => {
  trusted(event)
  return aiPropose(payload)
})
ipcMain.handle('ai:drawing', async (event, payload) => {
  trusted(event)
  return aiAnalyzeDrawing(payload)
})
ipcMain.on('ai:cancel', (event, id) => {
  trusted(event)
  if (typeof id === 'string') cancelAi(id)
})
ipcMain.on('map:dirty', (event, value) => {
  trusted(event)
  dirty = value === true
})
/** 선택한 프로젝트의 최신 지도 또는 빈 상태에 접근할 수 있는 편집 세션 발급 */
const selectProject = async (folder, remember = true) => {
  const { directory, ...data } = await openMapFolder(folder, true)
  if (remember) {
    const settingsDirectory = app.getPath('userData')
    await mkdir(settingsDirectory, { recursive: true })
    await writeFile(
      path.join(settingsDirectory, 'map-project.json'),
      JSON.stringify({ folder }),
      'utf8',
    )
  }
  const token = randomUUID()
  mapLocations.set(token, directory)
  activeProject = { directory, token }
  return { ...data, token, project: path.basename(path.dirname(directory)) }
}
ipcMain.handle('map:restore-project', async (event) => {
  trusted(event)
  try {
    const state = JSON.parse(
      await readFile(path.join(app.getPath('userData'), 'map-project.json'), 'utf8'),
    )
    if (typeof state.folder === 'string' && path.isAbsolute(state.folder))
      return await selectProject(state.folder, false)
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
  return null
})
ipcMain.handle('map:open', async (event) => {
  trusted(event)
  const result = await dialog.showOpenDialog(window, {
    title: 'Select a Map',
    defaultPath: activeProject?.directory,
    properties: ['openFile'],
    filters: [
      { name: 'MGS 지도', extensions: ['jmapx'] },
      { name: 'TS_MGS JSON 지도', extensions: ['json'] },
    ],
  })
  if (result.canceled) return null
  const file = await readMapFile(result.filePaths[0])
  if (activeProject) return { ...file, token: activeProject.token }
  const token = randomUUID()
  mapLocations.set(token, path.dirname(result.filePaths[0]))
  return { ...file, token }
})
ipcMain.handle('map:open-folder', async (event) => {
  trusted(event)
  const result = await dialog.showOpenDialog(window, {
    title: '기존 MGS의 RCS 또는 MAP 폴더 선택',
    properties: ['openDirectory'],
  })
  if (result.canceled) return null
  return selectProject(result.filePaths[0])
})
ipcMain.handle('map:select-save-project', async (event) => {
  trusted(event)
  const result = await dialog.showOpenDialog(window, {
    title: 'Project Select · RCS 또는 MAP 폴더',
    defaultPath: activeProject && path.dirname(activeProject.directory),
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled) return null
  const folder = result.filePaths[0]
  const directory =
    path.basename(folder).toLowerCase() === 'map' ? folder : path.join(folder, 'MAP')
  const token = randomUUID()
  mapLocations.set(token, directory)
  return token
})
ipcMain.handle('map:show-folder', async (event, token) => {
  trusted(event)
  const directory = typeof token === 'string' ? mapLocations.get(token) : undefined
  if (!directory) throw new Error('먼저 프로젝트 지도를 열거나 저장하세요.')
  const folder =
    path.basename(directory).toLowerCase() === 'map' ? path.dirname(directory) : directory
  const error = await shell.openPath(folder)
  if (error) throw new Error(error)
})
ipcMain.handle('map:save', async (event, content, name, options = {}) => {
  trusted(event)
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_BYTES)
    throw new Error('저장 데이터가 유효하지 않습니다.')
  if (content.replace(/^\uFEFF/, '').startsWith('Ver.')) {
    let directory =
      (typeof options.token === 'string' ? mapLocations.get(options.token) : undefined) ??
      activeProject?.directory
    let selectedFolder
    if (!directory || options.saveAs === true) {
      const result = await dialog.showOpenDialog(window, {
        title: 'MGS 프로젝트 저장 위치 선택 · RCS 또는 MAP 폴더',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled) return null
      const folder = result.filePaths[0]
      selectedFolder = folder
      directory = path.basename(folder).toLowerCase() === 'map' ? folder : path.join(folder, 'MAP')
    }
    const savedName = await saveMapVersion(
      directory,
      content,
      options.groups ?? '',
      options.auxiliary ?? {},
    )
    let warning
    if (options.backup !== false) {
      try {
        await backupMapVersion(directory, savedName)
      } catch {
        warning = '지도 저장 완료 · !COMPRESSED 압축 백업 실패'
      }
    }
    if (selectedFolder || activeProject?.directory !== directory) {
      const folder = selectedFolder ?? path.dirname(directory)
      try {
        const project = await selectProject(folder)
        return { name: savedName, token: project.token, warning }
      } catch {
        warning = warning ?? '지도 저장 완료 · 최근 프로젝트 기억 실패'
      }
    }
    const token = activeProject?.directory === directory ? activeProject.token : randomUUID()
    mapLocations.set(token, directory)
    return { name: savedName, token, warning }
  }
  const parsed = JSON.parse(content)
  if (parsed.format !== 'ts-mgs' || parsed.version !== 1)
    throw new Error('TS_MGS JSON 형식만 저장할 수 있습니다.')
  const savedPath = await saveJsonDialog(content, name, 'TS_MGS 지도 저장')
  if (!savedPath) return null
  const token = randomUUID()
  mapLocations.set(token, path.dirname(savedPath))
  return { name: path.basename(savedPath), token }
})
/**
 * 사용자가 선택한 파일에 임시 쓰기와 교체를 적용하는 원자적 문서 저장
 * 쓰기 실패 시 임시 파일을 정리하고 완료한 파일명만 반환하는 저장 결과 처리
 *
 * @param content 파일에서 읽은 원본 문자열
 * @param name 파일 또는 모델을 구분하는 표시 이름
 * @param title 파일 저장 대화상자에 표시할 작업 이름
 * @returns 저장을 완료한 전체 파일 경로 또는 사용자 취소 결과
 */
const saveJsonDialog = async (content, name, title) => {
  const defaultName =
    typeof name === 'string'
      ? path
          .basename(name)
          .replace(/[^\p{L}\p{N}_. -]/gu, '_')
          .slice(0, 120)
      : 'Untitled.tsmgs.json'
  const result = await dialog.showSaveDialog(window, {
    title,
    defaultPath: defaultName.endsWith('.json') ? defaultName : `${defaultName}.tsmgs.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return null
  if (!result.filePath.toLowerCase().endsWith('.json'))
    throw new Error('저장 확장자는 .json이어야 합니다.')
  const temporary = `${result.filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, result.filePath)
  } finally {
    await unlink(temporary).catch(() => {})
  }
  return result.filePath
}
ipcMain.handle('scene:open', async (event) => {
  trusted(event)
  const result = await dialog.showOpenDialog(window, {
    title: '3D 시설·설비 JSON 열기',
    properties: ['openFile'],
    filters: [{ name: 'BEM 3D JSON', extensions: ['json'] }],
  })
  return result.canceled ? null : readMapFile(result.filePaths[0])
})
ipcMain.handle('scene:read-project', async (event, token) => {
  trusted(event)
  const directory = typeof token === 'string' ? mapLocations.get(token) : undefined
  if (!directory) throw new Error('프로젝트 지도를 다시 열어 삼차원 저장 위치를 연결하세요.')
  return readSceneProject(directory)
})
/** 현재 지도 위치 식별자 또는 프로젝트 선택에 따른 삼차원 저장 기준 조회 */
const resolveSceneProject = async (token) => {
  if (token !== undefined) {
    const directory = typeof token === 'string' ? mapLocations.get(token) : undefined
    if (!directory) throw new Error('프로젝트 지도를 다시 열어 저장 위치를 연결하세요.')
    return directory
  }
  const result = await dialog.showOpenDialog(window, {
    title: '3D 데이터를 저장할 프로젝트의 RCS 또는 MAP 폴더 선택',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled) return null
  const directory = result.filePaths[0]
  return path.basename(directory).toLowerCase() === 'map' ? directory : path.join(directory, 'MAP')
}
ipcMain.handle('scene:save', async (event, content, name, token) => {
  trusted(event)
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_BYTES)
    throw new Error('3D 데이터 크기가 유효하지 않습니다.')
  const doc = JSON.parse(content)
  if (
    doc.format !== 'bem-map3d' ||
    doc.version !== 1 ||
    doc.units !== 'mm' ||
    doc.coordinates !== 'mgs-xy-z-up'
  )
    throw new Error('BEM 3D JSON v1 형식이 필요합니다.')
  const directory = await resolveSceneProject(token)
  if (!directory) return null
  const filename =
    typeof name === 'string' && name !== 'Untitled.map3d.json'
      ? path
          .basename(name)
          .replace(/[^\p{L}\p{N}_. -]/gu, '_')
          .slice(0, 120)
      : 'project.map3d.json'
  if (!filename.endsWith('.json')) throw new Error('저장 확장자는 .json이어야 합니다.')
  if (['equipment.json', 'map3d.json'].includes(filename.toLowerCase()))
    throw new Error('실행 파일과 구분되는 설계 파일명을 사용하세요.')
  await saveSceneFiles(directory, [[filename, content]])
  return filename
})
ipcMain.handle('scene:export', async (event, layoutContent, libraryContent, token) => {
  trusted(event)
  for (const content of [layoutContent, libraryContent])
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_BYTES)
      throw new Error('3D 데이터 크기가 유효하지 않습니다.')
  const layout = JSON.parse(layoutContent),
    library = JSON.parse(libraryContent)
  if (
    layout.format !== 'bem-map3d-layout' ||
    library.format !== 'bem-equipment-library' ||
    layout.version !== 1 ||
    library.version !== 1 ||
    layout.libraryRef?.fileName !== 'equipment.json'
  )
    throw new Error('3D 추출 형식이 잘못되었습니다.')
  const directory = await resolveSceneProject(token)
  return directory
    ? saveSceneFiles(directory, [
        ['equipment.json', libraryContent],
        ['map3d.json', layoutContent],
      ])
    : null
})
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  window = new BrowserWindow({
    title: 'TS_MGS · Map Studio',
    width: 1560,
    height: 980,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#101923',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== entryURL) event.preventDefault()
  })
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  )
  window.on('close', (event) => {
    if (dirty) {
      const result = dialog.showMessageBoxSync(window, {
        type: 'warning',
        title: '저장하지 않은 변경',
        message: '저장하지 않은 변경을 버리고 종료하시겠습니까?',
        buttons: ['계속 편집', '버리고 종료'],
        defaultId: 0,
        cancelId: 0,
      })
      if (result !== 1) event.preventDefault()
    }
  })
  await window.loadURL(entryURL)
})
app.on('window-all-closed', () => app.quit())
