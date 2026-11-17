const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const { saveSceneFiles } = require('../electron/scene-files.cjs')

/** 실제 파일과 격리된 데스크톱 통신을 사용하는 프로젝트별 저장 검증 */
const main = async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-mgs-scene-'))
  const created = []
  const directories = []
  const handlers = new Map()
  const mainFile = path.resolve(__dirname, '../electron/main.cjs')
  const localRequire = createRequire(mainFile)
  const dialogs = []
  const frame = { url: pathToFileURL(path.resolve(__dirname, '../dist/index.html')).href }
  const webContents = {
    mainFrame: frame,
    setWindowOpenHandler: () => {},
    on: () => {},
    session: { setPermissionRequestHandler: () => {} },
  }
  let ready
  const electron = {
    app: {
      isPackaged: true,
      whenReady: () => ({
        then: (callback) => {
          ready = callback
        },
      }),
      on: () => {},
    },
    BrowserWindow: class {
      webContents = webContents
      loadURL = async () => {}
      on = () => {}
    },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback), on: () => {} },
    Menu: { setApplicationMenu: () => {} },
    shell: {},
    dialog: {
      showOpenDialog: async () => dialogs.shift(),
      showSaveDialog: async () => dialogs.shift(),
    },
  }
  const context = {
    require: (name) => (name === 'electron' ? electron : localRequire(name)),
    __dirname: path.dirname(mainFile),
    process,
    Buffer,
    console,
    URL,
  }
  vm.runInNewContext(await fs.readFile(mainFile, 'utf8'), context, { filename: mainFile })
  await ready()
  const event = { sender: webContents, senderFrame: frame }
  const scene = JSON.stringify({
    format: 'bem-map3d',
    version: 1,
    units: 'mm',
    coordinates: 'mgs-xy-z-up',
  })
  try {
    for (const project of ['site-a', 'site-b']) {
      const folder = path.join(temporary, project, 'MAP')
      await fs.mkdir(folder, { recursive: true })
      directories.push(path.join(temporary, project), folder)
      const file = path.join(folder, '20261027_120000.jmapx')
      await fs.writeFile(file, 'Ver.25\n')
      created.push(file)
      dialogs.push({ canceled: false, filePaths: [file] })
      const opened = await handlers.get('map:open')(event)
      assert.equal(await handlers.get('scene:read-project')(event, opened.token), null)
      const name = await handlers.get('scene:save')(
        event,
        scene,
        'Untitled.map3d.json',
        opened.token,
      )
      assert.equal(name, 'project.map3d.json')
      const output = path.join(folder, '3D', name)
      directories.push(path.join(folder, '3D'))
      created.push(output)
      assert.equal(await fs.readFile(output, 'utf8'), scene)
      assert.equal((await handlers.get('scene:read-project')(event, opened.token)).content, scene)
      const layout = JSON.stringify({
        format: 'bem-map3d-layout',
        version: 1,
        libraryRef: { fileName: 'equipment.json' },
      })
      const library = JSON.stringify({ format: 'bem-equipment-library', version: 1 })
      assert.equal(
        await handlers.get('scene:export')(event, layout, library, opened.token),
        path.join(folder, '3D'),
      )
      created.push(path.join(folder, '3D', 'map3d.json'), path.join(folder, '3D', 'equipment.json'))
      assert.equal(await fs.readFile(path.join(folder, '3D', 'map3d.json'), 'utf8'), layout)
      await fs.unlink(output)
      const split = await handlers.get('scene:read-project')(event, opened.token)
      assert.equal(split.content, layout)
      assert.equal(split.library, library)
      await fs.writeFile(output, scene)
    }
    const jsonMap = path.join(temporary, 'site-b', 'MAP', 'edited.tsmgs.json')
    dialogs.push({ canceled: false, filePath: jsonMap })
    const savedMap = await handlers.get('map:save')(
      event,
      JSON.stringify({ format: 'ts-mgs', version: 1 }),
      'edited.tsmgs.json',
    )
    created.push(jsonMap)
    assert.ok(savedMap.token)
    const sceneName = await handlers.get('scene:save')(
      event,
      scene,
      'edited.map3d.json',
      savedMap.token,
    )
    const jsonScene = path.join(temporary, 'site-b', 'MAP', '3D', sceneName)
    created.push(jsonScene)
    assert.equal(await fs.readFile(jsonScene, 'utf8'), scene)
    await assert.rejects(
      () => handlers.get('scene:save')(event, scene, 'project.map3d.json', 'invalid-token'),
      /프로젝트/,
    )
    await assert.rejects(
      () => handlers.get('scene:read-project')(event, 'invalid-token'),
      /프로젝트/,
    )
    const mapDirectory = path.join(temporary, 'site-a', 'MAP')
    const blocker = path.join(mapDirectory, '3D', 'blocked.json')
    await fs.mkdir(blocker)
    directories.push(blocker)
    await assert.rejects(
      () =>
        saveSceneFiles(mapDirectory, [
          ['project.map3d.json', '{"replacement":true}'],
          ['blocked.json', '{}'],
        ]),
      /일반 파일/,
    )
    assert.equal(
      await fs.readFile(path.join(mapDirectory, '3D', 'project.map3d.json'), 'utf8'),
      scene,
    )
    assert.ok(
      (await fs.readdir(path.join(mapDirectory, '3D'))).every((name) => !/\.(tmp|bak)$/.test(name)),
    )
    console.log(
      'Scene project storage: dynamic map tokens, automatic 3D directory, paired export, invalid token and rollback passed',
    )
  } finally {
    for (const file of created) await fs.unlink(file).catch(() => {})
    for (const directory of directories.reverse()) await fs.rmdir(directory).catch(() => {})
    await fs.rmdir(temporary)
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
