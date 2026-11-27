const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const { createHash } = require('node:crypto')
const { loadSource } = require('./load-source.cjs')
const { openNamedMapScene, createSceneAccess } = require('../packages/map3d/localFiles.cjs')
const { parseFacilityDocument, parseFacilitySceneFile } = loadSource('packages/map3d/index.ts')

/** 실제 파일과 격리된 데스크톱 통신을 사용하는 프로젝트별 저장 검증 */
const main = async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-mgs-scene-'))
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
  const geometry = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }).padEnd(28, ' '))
  const model = Buffer.alloc(20 + geometry.length)
  model.writeUInt32LE(0x46546c67, 0)
  model.writeUInt32LE(2, 4)
  model.writeUInt32LE(model.length, 8)
  model.writeUInt32LE(geometry.length, 12)
  model.writeUInt32LE(0x4e4f534a, 16)
  geometry.copy(model, 20)
  const hash = createHash('sha256').update(model).digest('hex')
  const makeAsset = (id) => ({
    id, name: id, kind: 'equipment', parts: [],
    glb: { data: model.toString('base64'), size: { x: 1, y: 1, z: 1 }, sourceName: 'same.glb' },
  })
  const placed = (id, assetId, x) => ({ id, assetId, name: id, position: { x, y: 10, z: 2 }, rotation: 45 })
  const document = {
    format: 'bem-map3d', version: 1, units: 'mm', coordinates: 'mgs-xy-z-up',
    mapRef: { name: '20261027_120000.jmapx', geometryKey: 'test' },
    assets: ['rack-A', 'rack-B', 'Unplaced'].map(makeAsset),
    instances: [placed('a', 'rack-A', 0), placed('b', 'rack-B', 3), placed('c', 'rack-A', 5)],
    floors: [{
      id: 'floor', name: 'Showroom', material: 'showroom-epoxy', color: '#cccccc', repeatMm: 4800, rotation: 0,
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    }],
  }
  const legacyContent = JSON.stringify(document)
  const operator = createSceneAccess()
  try {
    for (const company of ['site-a', 'site-b']) {
      const folder = path.join(temporary, '!BEM_SOFT', company, 'RCS', 'Line A', 'MAP')
      await fs.mkdir(folder, { recursive: true })
      const map = path.join(folder, document.mapRef.name)
      await fs.writeFile(map, 'Ver.25\\n')
      dialogs.push({ canceled: false, filePaths: [map] })
      const opened = await handlers.get('map:open')(event)
      const read = () => handlers.get('scene:read-project')(event, opened.token)
      const save = (content) => handlers.get('scene:save')(event, content, 'Untitled.map3d.json', opened.token)
      assert.equal(await read(), null)
      const root = path.join(folder, '3D')
      await fs.mkdir(root)
      const manifest = path.join(root, 'project.map3d.json')
      await fs.writeFile(manifest, legacyContent)
      assert.equal((await read()).content, legacyContent)
      assert.deepEqual(await fs.readdir(root), ['project.map3d.json'])

      const saved = await save(legacyContent)
      const v2 = parseFacilityDocument(saved.content)
      assert.equal(v2.version, 2)
      assert.equal(JSON.parse(saved.content).mapRef, undefined)
      assert.equal(saved.name, 'project.map3d.json')
      assert.deepEqual(v2.instances, document.instances)
      assert.deepEqual(v2.assets.map(({ id }) => id), ['rack-A', 'rack-B'])
      assert.deepEqual(v2.assets.map(({ glb }) => glb.hash), [hash, hash])
      assert.equal(v2.assets[0].glb.uri, v2.assets[1].glb.uri)
      assert.ok(v2.assets.every(({ glb }) => !('data' in glb)))
      assert.deepEqual(parseFacilitySceneFile(await read()).assets.map(({ id }) => id), ['rack-A', 'rack-B', 'Unplaced'])
      const backup = (await fs.readdir(root)).find((name) => name.endsWith('.bak'))
      assert.equal(await fs.readFile(path.join(root, backup), 'utf8'), legacyContent)
      const texture = v2.floors[0].texture
      assert.ok(texture.uri.startsWith('textures/'))
      const modelPath = path.join(root, v2.assets[0].glb.uri)
      assert.deepEqual(await fs.readdir(path.dirname(modelPath)), [path.basename(modelPath)])
      const stat = await fs.stat(modelPath)
      const changed = parseFacilitySceneFile(saved)
      changed.instances[0].position.x = 50
      const changedResult = await save(JSON.stringify(changed))
      assert.equal(parseFacilityDocument(changedResult.content).instances[0].position.x, 50)
      assert.equal((await fs.stat(modelPath)).mtimeMs, stat.mtimeMs)
      assert.deepEqual(await fs.readFile(modelPath), model)

      /** 고객사와 공정 이름이 달라진 배포본의 운영 리소스 조회 */
      const copiedRoot = path.join(temporary, '!BEM_SOFT', company + '-copy', 'RCS', 'Line B', 'MAP')
      await fs.cp(folder, copiedRoot, { recursive: true })
      const copied = operator.register(await openNamedMapScene(temporary, company + '-copy', 'Line B'))
      assert(!copied.catalog)
      const ref = v2.assets[0].glb
      assert.deepEqual(await operator.read(ref, copied.grant), model)
      assert.ok((await operator.read(texture, copied.grant, true)).length > 12)
      for (const uri of ['../outside.glb', 'C:/outside.glb', 'https://outside.test/a.glb', 'models/CON.glb'])
        assert.throws(() => operator.read({ uri, hash }, copied.grant), /상대경로/)
      const copiedModel = path.join(copiedRoot, '3D', ref.uri)
      await fs.writeFile(copiedModel, Buffer.alloc(model.length))
      await assert.rejects(() => operator.read(ref, copied.grant), /해시/)
      await fs.unlink(copiedModel)
      await assert.rejects(() => operator.read(ref, copied.grant), /찾을 수/)
      const copiedModels = path.dirname(copiedModel)
      await fs.rmdir(copiedModels)
      await fs.symlink(path.dirname(modelPath), copiedModels, process.platform === 'win32' ? 'junction' : 'dir')
      await assert.rejects(() => operator.read(ref, copied.grant), /링크|정션/)

      const damaged = parseFacilitySceneFile(changedResult)
      damaged.assets[0].glb = { ...document.assets[0].glb, data: 'AAAA' }
      await assert.rejects(() => save(JSON.stringify(damaged)), /헤더|길이/)
      const missingParent = parseFacilitySceneFile(changedResult)
      missingParent.instances[0].attachedTo = 'missing-parent'
      await assert.rejects(() => save(JSON.stringify(missingParent)), /부모 객체/)
      missingParent.instances[0].attachedTo = missingParent.instances[1].id
      missingParent.instances[1].attachedTo = missingParent.instances[0].id
      await assert.rejects(() => save(JSON.stringify(missingParent)), /순환/)
      const invalidPosition = parseFacilitySceneFile(changedResult)
      invalidPosition.instances[0].position.x = null
      await assert.rejects(() => save(JSON.stringify(invalidPosition)), /좌표/)
      assert.equal((await read()).content, changedResult.content)
      assert.ok((await fs.readdir(root)).every((name) => !name.endsWith('.tmp')))
      assert.equal(await fs.readFile(map, 'utf8'), 'Ver.25\\n')

      /** 사용자 이미지의 임시 등록과 중복 저장 방지 및 파일명 복원 검증 */
      const imageBytes = await fs.readFile(path.resolve(__dirname, '../packages/map3d/showroom-epoxy.webp'))
      const imageBuffer = imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength)
      const imageRef = await handlers.get('scene:stage-texture')(event, imageBuffer)
      assert.deepEqual(await handlers.get('scene:stage-texture')(event, imageBuffer), imageRef)
      const readImage = await handlers.get('scene:read-resource')(event, imageRef)
      assert.deepEqual(Buffer.from(readImage), imageBytes)
      await assert.rejects(() => handlers.get('scene:stage-texture')(event, new ArrayBuffer(12)), /이미지/)
      assert.throws(() => handlers.get('scene:stage-texture')({ ...event, sender: {} }, imageBuffer), /허용/)
      const custom = parseFacilitySceneFile(changedResult)
      custom.floors[0] = { ...custom.floors[0], material: 'epoxy', texture: imageRef, textureName: '사용자 바닥.webp' }
      const customSaved = await save(JSON.stringify(custom))
      assert.equal(parseFacilitySceneFile(customSaved).floors[0].textureName, '사용자 바닥.webp')
      const texturePath = path.join(root, imageRef.uri)
      const textureStat = await fs.stat(texturePath)
      custom.floors[0].rotation = 30
      await save(JSON.stringify(custom))
      assert.equal((await fs.stat(texturePath)).mtimeMs, textureStat.mtimeMs)
      assert.equal((await fs.readdir(path.dirname(texturePath))).filter((name) => name === path.basename(texturePath)).length, 1)
      const badName = structuredClone(custom)
      badName.floors[0].textureName = 1
      assert.throws(() => parseFacilityDocument(JSON.stringify({ ...badName, version: 2 })), /이미지 이름/)

      assert.equal(await handlers.get('scene:export')(event, JSON.stringify(custom), opened.token), root)
      const output = await fs.readFile(path.join(root, 'map3d.json'), 'utf8')
      assert.equal(parseFacilityDocument(output).version, 2)
      assert.equal(JSON.parse(output).editorCatalog, undefined)
      assert.equal(parseFacilityDocument(output).floors[0].textureName, '사용자 바닥.webp')
      await fs.rename(manifest, manifest + '.inactive')
      assert.equal((await read()).content, output)
    }
    await assert.rejects(
      () => handlers.get('scene:save')(event, legacyContent, 'project.map3d.json', 'invalid-token'),
      /프로젝트/,
    )
    await assert.rejects(
      () => handlers.get('scene:read-project')(event, 'invalid-token'),
      /프로젝트/,
    )
    await assert.rejects(() => openNamedMapScene(temporary, '../site-a', 'Line A'), /이름/)
    console.log('Scene project storage: Version 1 backup, Version 2, dedup, textures, renamed deployment, integrity, junction, rollback and tokens passed')
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
