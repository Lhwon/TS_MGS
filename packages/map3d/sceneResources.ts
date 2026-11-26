/**
 * 삼차원 설계의 외부 바이너리 참조와 파일 데이터 검증 정의
 */
export type SceneResource = { uri: string; hash: string }
export type SceneResourceReader = (reference: SceneResource) => Promise<ArrayBuffer>
export type SceneFile = { name: string; content: string; library?: string | null; catalog?: string; grant?: string }

/** 파일과 해시가 포함된 안전한 프로젝트 상대경로 검증 */
export const parseSceneResource = (value: unknown, image = false, catalog = false): SceneResource => {
  const { uri, hash } = (value ?? {}) as Partial<SceneResource>
  const path = image ? /^textures\/[a-z0-9][a-z0-9._-]{0,150}\.(webp|png|jpe?g)$/i
    : catalog ? /^(?:catalog\/)?models\/[a-z0-9][a-z0-9._-]{0,150}\.glb$/i
      : /^models\/[a-z0-9][a-z0-9._-]{0,150}\.glb$/i
  if (typeof uri !== 'string' || !path.test(uri) || /[\x00-\x1f]/.test(uri) || uri.includes('..') ||
      /\/(?:con|prn|aux|nul|com[0-9]|lpt[0-9])\./i.test(uri) ||
      typeof hash !== 'string' || hash.length !== 64 || !/^[0-9a-f]{64}$/.test(hash))
    throw new Error('삼차원 리소스 상대경로 또는 해시가 유효하지 않습니다.')
  return { uri, hash }
}

/** 바이너리의 전체 콘텐츠 해시 반환 */
const sceneResourceHash = async (bytes: ArrayBuffer) => {
  if (!crypto.subtle) throw new Error('리소스 해시를 검증할 수 있는 보안 연결 또는 데스크톱 앱이 필요합니다.')
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 파일 선택으로 허용된 프로젝트 하위의 리소스 경로만 조회 */
export const sceneFilesReader = (project: File, files: File[]): SceneResourceReader => {
  const prefix = project.webkitRelativePath.slice(0, -project.name.length)
  const entries = new Map<string, File>()
  for (const file of files) {
    const key = file.webkitRelativePath.toLowerCase()
    if (entries.has(key)) throw new Error('프로젝트에 이름이 겹치는 파일이 있습니다.')
    entries.set(key, file)
  }
  return async ({ uri, hash }) => {
    const file = prefix && entries.get((prefix + uri).toLowerCase())
    if (!file) throw new Error(`프로젝트 리소스 파일을 찾을 수 없습니다: ${uri}`)
    if (file.size > 12 * 1024 * 1024) throw new Error(`리소스 파일이 너무 큽니다: ${uri}`)
    const bytes = await file.arrayBuffer()
    if (await sceneResourceHash(bytes) !== hash) throw new Error(`리소스 해시가 일치하지 않습니다: ${uri}`)
    return bytes
  }
}
