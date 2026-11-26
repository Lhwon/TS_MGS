/**
 * 편집기와 관제의 삼차원 설계 파일 및 외부 리소스 접근 관리
 */
const fs = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')

const jsonLimit = 32 * 1024 * 1024
const resourceLimit = 12 * 1024 * 1024
const projectName = 'project.map3d.json'
const backupHash = (data) => createHash('sha256').update(data).digest('hex')
const parse = (content) => JSON.parse(content.replace(/^\uFEFF/, ''))
const missing = (cause) => cause?.code === 'ENOENT'

/** 비교에 사용하는 운영체제별 실제 경로 정규화 */
const comparable = (file) => process.platform === 'win32' ? file.toLowerCase() : file

/** 심볼릭 링크와 정션을 허용하지 않는 일반 디렉터리 확인 */
const directoryAt = async (directory, create = false) => {
  if (create) await fs.mkdir(directory).catch((cause) => { if (cause.code !== 'EEXIST') throw cause })
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      comparable(await fs.realpath(directory)) !== comparable(directory))
    throw new Error('삼차원 리소스 폴더에 링크 또는 정션을 사용할 수 없습니다.')
  return directory
}

/** 물리적 경로와 열린 파일의 동일성을 확인하고 제한 크기 안에서 읽기 */
const readRegular = async (file, limit) => {
  const before = await fs.lstat(file)
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit ||
      comparable(await fs.realpath(file)) !== comparable(file))
    throw new Error('삼차원 파일 크기 또는 실제 경로를 확인하세요.')
  const handle = await fs.open(file, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > limit || stat.ino !== before.ino || stat.dev !== before.dev ||
        comparable(await fs.realpath(file)) !== comparable(file))
      throw new Error('삼차원 파일을 읽는 중 경로가 변경되었습니다.')
    const bytes = await handle.readFile()
    if (bytes.length !== stat.size) throw new Error('삼차원 파일을 읽는 중 크기가 변경되었습니다.')
    return bytes
  } finally {
    await handle.close()
  }
}

/** 외부 참조의 파일 형식과 상대경로 제약 검증 */
const checkReference = (value, image = false, allowCatalog = false) => {
  const { uri, hash } = value ?? {}
  const pattern = image ? /^textures\/[a-z0-9][a-z0-9._-]{0,150}\.(webp|png|jpe?g)$/i
    : allowCatalog ? /^(?:catalog\/)?models\/[a-z0-9][a-z0-9._-]{0,150}\.glb$/i
      : /^models\/[a-z0-9][a-z0-9._-]{0,150}\.glb$/i
  if (typeof uri !== 'string' || !pattern.test(uri) || /[\x00-\x1f]/.test(uri) || uri.includes('..') ||
      /\/(?:con|prn|aux|nul|com[0-9]|lpt[0-9])\./i.test(uri) ||
      typeof hash !== 'string' || hash.length !== 64 || !/^[0-9a-f]{64}$/.test(hash))
    throw new Error('삼차원 리소스 상대경로 또는 해시가 유효하지 않습니다.')
  return { uri, hash }
}

/** GLB 헤더와 청크 범위 및 프로젝트 이미지 형식 검증 */
const checkBytes = (bytes, uri) => {
  if (!bytes.length || bytes.length > resourceLimit) throw new Error('리소스 파일 크기를 확인하세요.')
  const ext = path.extname(uri).toLowerCase()
  if (ext === '.glb') {
    if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 ||
        bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length ||
        bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + bytes.readUInt32LE(12) > bytes.length)
      throw new Error('GLB 이진 파일 헤더 또는 길이가 유효하지 않습니다.')
    for (let offset = 12; offset < bytes.length;) {
      if (offset + 8 > bytes.length) throw new Error('GLB 청크 헤더가 손상되었습니다.')
      offset += 8 + bytes.readUInt32LE(offset)
      if (offset > bytes.length) throw new Error('GLB 청크 길이가 손상되었습니다.')
    }
    const model = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)))
    const inspect = (value) => {
      if (!value || typeof value !== 'object') return
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'uri' && (typeof entry !== 'string' ||
            !/^data:(image\/(png|jpeg|webp)|application\/octet-stream);base64,/i.test(entry)))
          throw new Error('외부 종속 파일을 사용하는 GLB는 저장할 수 없습니다.')
        inspect(entry)
      }
    }
    inspect(model)
    if (Array.isArray(model.extensionsRequired) && model.extensionsRequired.some((name) =>
      ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(name)))
      throw new Error('압축 확장 없는 표준 GLB로 내보내세요.')
    if (Array.isArray(model.nodes) && Array.isArray(model.meshes) && model.nodes.reduce((count, node) =>
      count + (typeof node?.mesh === 'number' ? model.meshes[node.mesh]?.primitives?.length ?? 0 : 0), 0) > 2048)
      throw new Error('GLB 도형은 모델당 2048개 이하여야 합니다.')
  } else if (!(ext === '.webp' && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) &&
      !(ext === '.png' && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') &&
      !((ext === '.jpg' || ext === '.jpeg') && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255))
    throw new Error('외부 이미지 파일의 형식이 유효하지 않습니다.')
}

/** 검증한 상대경로를 링크가 없는 실제 파일 경로로 변환 */
const resourcePath = async (root, uri, create = false) => {
  const segments = uri.split('/')
  let directory = root
  for (const segment of segments.slice(0, -1)) directory = await directoryAt(path.join(directory, segment), create)
  return path.join(directory, segments.at(-1))
}

/** 지정한 리소스의 해시와 실제 바이너리 검증 */
const readResource = async (root, reference, image = false, allowCatalog = false) => {
  const { uri, hash } = checkReference(reference, image, allowCatalog)
  try {
    const bytes = await readRegular(await resourcePath(root, uri), resourceLimit)
    if (backupHash(bytes) !== hash) throw new Error('리소스 해시가 일치하지 않습니다: ' + uri)
    checkBytes(bytes, uri)
    return bytes
  } catch (cause) {
    if (missing(cause)) throw new Error('프로젝트 리소스 파일을 찾을 수 없습니다: ' + uri)
    throw cause
  }
}

/** 설계 파일의 배포용 참조와 편집용 참조를 분리하여 접근 범위 구성 */
const openSceneFile = async (selected, editor = false) => {
  const name = path.basename(selected)
  const root = await directoryAt(path.resolve(path.dirname(selected)))
  const content = (await readRegular(path.join(root, name), jsonLimit)).toString('utf8')
  const doc = parse(content)
  const refs = new Map()
  const addRefs = (assets, allowCatalog) => {
    if (!Array.isArray(assets) || assets.length > 500) throw new Error('모델 정의 형식을 확인하세요.')
    for (const asset of assets) {
      if (!asset?.glb) continue
      if (Object.hasOwn(asset.glb, 'data')) throw new Error('외부 설계에는 내장 모델을 저장할 수 없습니다.')
      const ref = checkReference(asset.glb, false, allowCatalog)
      const key = comparable(ref.uri)
      const previous = refs.get(key)
      if (previous && previous.hash !== ref.hash) throw new Error('같은 파일에 여러 리소스 해시가 지정되었습니다.')
      refs.set(key, ref)
    }
  }
  let catalog
  if (doc.format === 'bem-map3d' && doc.version === 2) {
    addRefs(doc.assets, false)
    for (const area of doc.floors ?? []) if (area.texture) {
      const ref = checkReference(area.texture, true)
      const previous = refs.get(comparable(ref.uri))
      if (previous && previous.hash !== ref.hash) throw new Error('같은 텍스처 파일에 여러 해시가 지정되었습니다.')
      refs.set(comparable(ref.uri), ref)
    }
    if (editor && doc.editorCatalog !== undefined) {
      if (typeof doc.editorCatalog !== 'string' || !/^catalog\/[0-9a-f]{64}\.json$/.test(doc.editorCatalog))
        throw new Error('편집용 모델 목록 경로를 확인하세요.')
      try {
        const file = await resourcePath(root, doc.editorCatalog)
        const bytes = await readRegular(file, jsonLimit)
        if (backupHash(bytes) !== path.basename(file, '.json')) throw new Error('편집용 모델 목록 해시가 일치하지 않습니다.')
        catalog = bytes.toString('utf8')
      } catch (cause) {
        if (missing(cause)) throw new Error('편집용 모델 목록 파일이 없습니다: ' + doc.editorCatalog)
        throw cause
      }
      const parsed = parse(catalog)
      if (parsed.format !== 'bem-map3d-catalog' || parsed.version !== 2) throw new Error('편집용 모델 목록 형식을 확인하세요.')
      addRefs(parsed.assets, true)
    }
  }
  let library
  if (doc.format === 'bem-map3d-layout')
    library = (await readRegular(path.join(root, 'equipment.json'), jsonLimit)).toString('utf8')
  return { root, refs, payload: { name, content, ...(catalog ? { catalog } : {}), ...(library ? { library } : {}) } }
}

/** 현재 지도에 속하는 통합 설계 또는 이전 실행 파일 조회 */
const openMapScene = async (mapDirectory, editor = false) => {
  const base = await directoryAt(path.resolve(mapDirectory))
  let scene
  try { scene = await directoryAt(path.join(base, '3D')) } catch (cause) {
    if (missing(cause)) return null
    throw cause
  }
  try { return await openSceneFile(path.join(scene, projectName), editor) } catch (cause) {
    if (!missing(cause)) throw cause
  }
  try {
    return await openSceneFile(path.join(scene, 'map3d.json'), editor)
  } catch (cause) {
    if (missing(cause)) return null
    throw cause
  }
}

/** 선택한 설계에 포함된 참조만 읽을 수 있는 세션 구성 */
const createSceneAccess = () => {
  const files = new Map()
  let staging
  const register = (scene) => {
    if (!scene) return null
    if (!scene.refs.size) return scene.payload
    const grant = randomUUID()
    files.set(grant, { root: scene.root, refs: scene.refs })
    return { ...scene.payload, grant }
  }
  /** IPC에서 복사된 바이너리를 해시 주소로 보관하여 저장 시 재사용 */
  const stage = async (input) => {
    if (!(input instanceof ArrayBuffer)) throw new Error('이진 GLB 파일이 필요합니다.')
    const bytes = Buffer.from(input)
    checkBytes(bytes, 'model.glb')
    const hash = backupHash(bytes)
    const filename = hash + '.glb'
    staging ??= fs.mkdtemp(path.join(tmpdir(), 'bem-map3d-'))
    const folder = await staging
    await writeImmutable(path.join(folder, filename), bytes, hash, resourceLimit, (data) => checkBytes(data, filename))
    return { uri: 'models/' + filename, hash }
  }
  /** 주어진 세션에 등록된 정확한 상대경로와 해시만 읽기 */
  const read = (reference, grant, image = false) => {
    const ref = checkReference(reference, image, true)
    const scene = files.get(grant)
    const allowed = scene?.refs.get(comparable(ref.uri))
    if (allowed?.hash !== ref.hash) throw new Error('선택한 프로젝트의 리소스가 아닙니다.')
    return readResource(scene.root, allowed, image, true)
  }
  /** 저장 원본은 등록한 모델 또는 선택한 설계의 리소스에서만 조회 */
  const readEditor = async (reference, image = false) => {
    const ref = checkReference(reference, image, true)
    if (!image && staging) {
      const folder = await staging
      try {
        const file = path.join(folder, ref.hash + '.glb')
        const bytes = await readRegular(file, resourceLimit)
        if (backupHash(bytes) !== ref.hash) throw new Error('등록된 모델의 해시가 일치하지 않습니다.')
        return bytes
      } catch (cause) {
        if (!missing(cause)) throw cause
      }
    }
    for (const scene of [...files.values()].reverse()) {
      const allowed = scene.refs.get(comparable(ref.uri))
      if (allowed?.hash === ref.hash) return readResource(scene.root, allowed, image, true)
    }
    throw new Error('저장할 모델 원본을 찾을 수 없습니다: ' + ref.uri)
  }
  /** 현재 실행에서만 사용한 등록 임시 폴더 정리 */
  const dispose = async () => {
    if (staging) await fs.rm(await staging, { recursive: true, force: true })
  }
  return { register, stage, read, readEditor, dispose }
}

const verified = new Map()
/** 이미 검증한 불변 파일은 수정 시간과 파일 식별자가 같을 때 재조회 생략 */
const verifyExisting = async (file, hash, limit, validate) => {
  try {
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit ||
        comparable(await fs.realpath(file)) !== comparable(file))
      throw new Error('기존 리소스 파일 경로 또는 크기가 유효하지 않습니다.')
    const stamp = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, hash].join(':')
    if (verified.get(file) !== stamp) {
      const bytes = await readRegular(file, limit)
      if (backupHash(bytes) !== hash) throw new Error('기존 리소스 해시가 일치하지 않습니다: ' + path.basename(file))
      validate?.(bytes)
      verified.set(file, stamp)
    }
    return true
  } catch (cause) {
    if (!missing(cause)) throw cause
    return false
  }
}

/** 임시 파일에 기록한 뒤 기존 리소스를 덮지 않고 연결 */
const writeImmutable = async (file, bytes, hash, limit, validate) => {
  if (await verifyExisting(file, hash, limit, validate)) return
  if (bytes.length > limit || backupHash(bytes) !== hash) throw new Error('저장할 리소스 해시 또는 크기가 유효하지 않습니다.')
  validate?.(bytes)
  const temp = file + '.' + randomUUID() + '.tmp'
  try {
    await fs.writeFile(temp, bytes, { flag: 'wx', flush: true })
    try { await fs.link(temp, file) } catch (cause) {
      if (cause.code !== 'EEXIST' || !await verifyExisting(file, hash, limit, validate)) throw cause
    }
  } finally {
    await fs.unlink(temp).catch(() => {})
  }
}

/** 외부 리소스 검증과 이전 설계 백업 후 구성 파일을 원자적으로 교체 */
const saveMapScene = async (mapDirectory, name, content, resolve, options = {}) => {
  if (path.basename(name) !== name || !/^[\p{L}\p{N}_ .()-]+\.json$/iu.test(name) || name.includes('..') ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])\./i.test(name))
    throw new Error('삼차원 프로젝트 파일명이 유효하지 않습니다.')
  if (typeof content !== 'string' || Buffer.byteLength(content) > jsonLimit)
    throw new Error('삼차원 설계 데이터의 크기를 확인하세요.')
  const doc = parse(content)
  if (doc.format !== 'bem-map3d' || ![1, 2].includes(doc.version) || doc.units !== 'mm' || doc.coordinates !== 'mgs-xy-z-up' ||
      !Array.isArray(doc.assets) || doc.assets.length > 500 || !Array.isArray(doc.instances) || doc.instances.length > 10000)
    throw new Error('지원하는 삼차원 설계 형식이 필요합니다.')
  const ids = new Set(doc.assets.map((asset) => asset.id))
  if (ids.size !== doc.assets.length || new Set(doc.instances.map(({ id }) => id)).size !== doc.instances.length ||
      doc.instances.some(({ assetId }) => !ids.has(assetId)))
    throw new Error('중복되거나 누락된 삼차원 모델 참조가 있습니다.')
  const instances = new Map(doc.instances.map((instance) => [instance.id, instance]))
  /** 저장 파일의 좌표와 치수 및 부모 참조 무결성 검증 */
  const vector = (value, positive = false) => value && ['x', 'y', 'z'].every((axis) =>
    typeof value[axis] === 'number' && Number.isFinite(value[axis]) && Math.abs(value[axis]) <= 1e9 &&
      (!positive || value[axis] > 0))
  for (const asset of doc.assets) {
    if (typeof asset.id !== 'string' || !asset.id || (asset.glb && !vector(asset.glb.size, true)))
      throw new Error('모델 식별자 또는 치수 데이터가 유효하지 않습니다.')
    for (const part of asset.parts ?? [])
      if (!vector(part.position) || !vector(part.size, true) || !Number.isFinite(part.rotation))
        throw new Error('모델 부품의 좌표 또는 치수 데이터가 유효하지 않습니다.')
  }
  const parents = new Set()
  for (const instance of doc.instances) {
    if (typeof instance.id !== 'string' || !instance.id || !vector(instance.position) ||
        !Number.isFinite(instance.rotation) || (instance.scale && !vector(instance.scale, true)) ||
        (instance.portOffset && !vector(instance.portOffset)))
      throw new Error('배치 식별자 또는 좌표 데이터가 유효하지 않습니다.')
    const chain = new Set()
    let current = instance
    while (current.attachedTo && !parents.has(current.id)) {
      if (chain.has(current.id)) throw new Error('부모 객체의 연결 관계가 순환합니다.')
      chain.add(current.id)
      current = instances.get(current.attachedTo)
      if (!current) throw new Error('부모 객체 참조가 누락되었습니다.')
    }
    for (const id of chain) parents.add(id)
    for (const opening of instance.wallDoors ?? [])
      if (opening.modelId && instances.get(opening.modelId)?.attachedTo !== instance.id)
        throw new Error('벽체 개구부의 부착 모델 참조가 누락되었습니다.')
  }
  const mapRoot = await directoryAt(path.resolve(mapDirectory))
  const root = await directoryAt(path.join(mapRoot, '3D'), true)
  const used = new Set(doc.instances.map(({ assetId }) => assetId))
  for (const asset of doc.assets) {
    if (asset.id === 'ceram-mp5-quick-shutter-closed' && used.has('ceram-mp5-quick-shutter-open')) used.add(asset.id)
  }
  const operations = doc.assets.filter((asset) => used.has(asset.id))
  const catalog = options.deployment ? [] : doc.assets.filter((asset) => !used.has(asset.id))
  const modelUris = new Map()
  const resource = async (reference, isCatalog) => {
    if (!reference) return reference
    let hash, bytes
    if (Object.hasOwn(reference, 'data')) {
      if (typeof reference.data !== 'string' || reference.data.length > Math.ceil(resourceLimit / 3) * 4 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(reference.data)) throw new Error('기존 GLB 바이너리가 유효하지 않습니다.')
      bytes = Buffer.from(reference.data, 'base64')
      hash = backupHash(bytes)
    } else ({ hash } = checkReference(reference, false, true))
    const { size, sourceName } = reference
    let uri = modelUris.get(hash)
    if (!uri) {
      const deployed = 'models/' + hash + '.glb'
      const deployedPath = path.join(root, 'models', hash + '.glb')
      const existingModels = await directoryAt(path.dirname(deployedPath)).then(() => true, (cause) => {
        if (!missing(cause)) throw cause
        return false
      })
      const deployedExists = existingModels && await verifyExisting(deployedPath, hash, resourceLimit, (data) => checkBytes(data, deployed))
      uri = isCatalog && !deployedExists ? 'catalog/' + deployed : deployed
      const location = await resourcePath(root, uri, true)
      const validate = (data) => checkBytes(data, uri)
      if (!await verifyExisting(location, hash, resourceLimit, validate))
        await writeImmutable(location, bytes ?? await resolve(reference, false), hash, resourceLimit, validate)
      modelUris.set(hash, uri)
    }
    return { uri, hash, size, sourceName }
  }
  for (const asset of operations) if (asset.glb) asset.glb = await resource(asset.glb, false)
  for (const asset of catalog) if (asset.glb) asset.glb = await resource(asset.glb, true)
  delete doc.editorCatalog
  if (catalog.length) {
    const bytes = Buffer.from(JSON.stringify({ format: 'bem-map3d-catalog', version: 2, assets: catalog }))
    const hash = backupHash(bytes)
    doc.editorCatalog = 'catalog/' + hash + '.json'
    await writeImmutable(await resourcePath(root, doc.editorCatalog, true), bytes, hash, jsonLimit)
  }
  for (const area of doc.floors ?? []) {
    let bytes
    if (!area.texture) {
      if (area.material !== 'showroom-epoxy' || !options.builtInTexture) continue
      bytes = await fs.readFile(options.builtInTexture)
      const hash = backupHash(bytes)
      area.texture = { uri: 'textures/' + hash + '.webp', hash }
    }
    const ref = checkReference(area.texture, true)
    const location = await resourcePath(root, ref.uri, true)
    const validate = (data) => checkBytes(data, ref.uri)
    if (!await verifyExisting(location, ref.hash, resourceLimit, validate))
      await writeImmutable(location, bytes ?? await resolve(ref, true), ref.hash, resourceLimit, validate)
  }
  doc.assets = operations
  doc.version = 2
  delete doc.mapRef
  const manifest = JSON.stringify(doc, null, 2)
  if (Buffer.byteLength(manifest) > jsonLimit) throw new Error('삼차원 설계 파일이 너무 큽니다.')
  const target = path.join(root, name)
  let previous
  try { previous = await readRegular(target, jsonLimit) } catch (cause) { if (!missing(cause)) throw cause }
  if (previous && parse(previous.toString('utf8')).version === 1) {
    const hash = backupHash(previous)
    await writeImmutable(target + '.v1-' + hash + '.bak', previous, hash, jsonLimit)
  }
  const temp = target + '.' + randomUUID() + '.tmp'
  try {
    await fs.writeFile(temp, manifest, { encoding: 'utf8', flag: 'wx', flush: true })
    await fs.rename(temp, target)
  } finally {
    await fs.unlink(temp).catch(() => {})
  }
  return { scene: await openSceneFile(target, !options.deployment) }
}

/** 운영 프로젝트 및 공정 이름을 단일 경로 요소로 확인한 뒤 현장 지도 폴더 조회 */
const openNamedMapScene = async (publicRoot, project, processName) => {
  const check = (name) => typeof name === 'string' && name.length <= 120 &&
    /^[\p{L}\p{N}_ .()-]+$/u.test(name) && name.trim() === name && !name.endsWith('.') &&
    name !== '.' && name !== '..' && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)
  if (!check(project) || !check(processName)) throw new Error('운영 프로젝트 또는 공정 이름을 확인하세요.')
  try {
    let base = await fs.realpath(publicRoot)
    for (const part of ['!BEM_SOFT', project, 'RCS', processName, 'MAP']) base = await directoryAt(path.join(base, part))
    return await openMapScene(base)
  } catch (cause) {
    if (missing(cause)) return null
    throw cause
  }
}

module.exports = { openSceneFile, openMapScene, openNamedMapScene, saveMapScene, createSceneAccess }

