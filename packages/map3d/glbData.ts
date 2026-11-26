export const MAX_GLB_BYTES = 12 * 1024 * 1024

/** 외부 의존 파일 없이 이식 가능한 바이너리 모델 검증 */
export const decodeEmbeddedGlb = (data: string): ArrayBuffer => {
  if (
    !data ||
    data.length > Math.ceil(MAX_GLB_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
  )
    throw new Error('GLB 데이터 형식 또는 파일 크기를 확인하세요.')
  const raw = atob(data)
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0))
  validateGlbBytes(bytes.buffer)
  return bytes.buffer
}

/** 바이너리 모델의 파일 헤더와 내장 리소스 및 지원 확장 검증 */
export const validateGlbBytes = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer)
  const header = new DataView(bytes.buffer)
  if (
    bytes.length < 20 ||
    bytes.length > MAX_GLB_BYTES ||
    header.getUint32(0, true) !== 0x46546c67 ||
    header.getUint32(4, true) !== 2 ||
    header.getUint32(8, true) !== bytes.length ||
    header.getUint32(16, true) !== 0x4e4f534a
  )
    throw new Error('GLB 이진 형식 파일이 필요합니다.')
  const length = header.getUint32(12, true)
  if (20 + length > bytes.length) throw new Error('GLB 파일이 손상되었습니다.')
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('GLB 청크 헤더가 손상되었습니다.')
    offset += header.getUint32(offset, true) + 8
    if (offset > bytes.length) throw new Error('GLB 청크 길이가 손상되었습니다.')
  }
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as Record<
    string,
    unknown
  >
  /** 모델 내부의 외부 파일 참조 차단 */
  const check = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (
        key === 'uri' &&
        (typeof child !== 'string' ||
          !/^data:(image\/(png|jpeg|webp)|application\/octet-stream);base64,/i.test(child))
      )
        throw new Error('텍스처와 버퍼가 포함된 단일 GLB 파일을 사용하세요.')
      check(child)
    }
  }
  check(json)
  if (
    Array.isArray(json.extensionsRequired) &&
    json.extensionsRequired.some((name) =>
      ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(
        String(name),
      ),
    )
  )
    throw new Error('압축 확장 없는 표준 GLB로 내보내세요.')
}

/** 모델 노드별 도형 수를 이용한 배치 버퍼 예산 산정 */
export const embeddedGlbPartCount = (buffer: ArrayBuffer) => {
  const length = new DataView(buffer).getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length))) as {
    nodes?: { mesh?: number }[]
    meshes?: { primitives?: unknown[] }[]
  }
  if (!Array.isArray(json.nodes) || !Array.isArray(json.meshes)) return 1
  return Math.max(
    1,
    json.nodes.reduce(
      (sum, node) =>
        sum +
        (typeof node?.mesh === 'number' ? (json.meshes?.[node.mesh]?.primitives?.length ?? 0) : 0),
      0,
    ),
  )
}
