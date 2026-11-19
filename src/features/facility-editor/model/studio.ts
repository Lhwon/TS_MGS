/**
 * 파일명: studio.ts
 * 설명: 설비 라이브러리와 포트 기준 배치 및 독립 편집 이력과 파일 관리
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import {
  defaultModelLabel,
  emptyFacilityDocument,
  exportFacilityFiles,
  facilityModelSize,
  type FacilityPort,
  parseEquipmentLibrary,
  parseFacilityDocument,
  resolveFacilityInstance,
} from '@/entities/facility/index.ts'
import type {
  FacilityAsset,
  FacilityDocument,
  FacilityInstance,
} from '@/entities/facility/index.ts'
import { downloadJson, pickMapFile } from '@/shared/lib/files/index.ts'

/**
 * 설비 모델과 개별 배치 및 독립 저장 이력을 제공하는 설비 편집 저장소 생성
 * @returns 설비 모델과 배치 및 파일 명령을 제공하는 상태 저장소
 */
export const useFacilityEditor = defineStore('facility-editor', () => {
  const document = shallowRef(emptyFacilityDocument())
  const saved = shallowRef(document.value)
  const selectedId = ref<string | null>(null)
  const selectedAssetId = ref<string | null>(null)
  const filename = ref('Untitled.map3d.json')
  const message = ref('사용자 모델을 디자인한 뒤 포트 또는 지도 위에 배치하세요.')
  const busy = ref(false)
  let copied: { instance: FacilityInstance; nextX: number; gap: number } | undefined
  const past = shallowRef<FacilityDocument[]>([]),
    future = shallowRef<FacilityDocument[]>([])
  const dirty = computed(() => document.value !== saved.value)
  const selected = computed(() => document.value.instances.find((i) => i.id === selectedId.value))
  const asset = computed(() => document.value.assets.find((a) => a.id === selectedAssetId.value))

  /**
   * 변경 작업을 복제 문서에 적용한 뒤 검증을 통과한 결과만 반영하는 편집 명령
   * 이전 문서를 제한된 실행 취소 이력에 보관하고 다시 실행 이력을 초기화하는 상태 갱신
   *
   * @param change 검증 전 복제 문서에 적용할 변경 함수
   */
  const commit = (change: (doc: FacilityDocument) => void) => {
    const next = structuredClone(document.value)
    change(next)
    const checked = parseFacilityDocument(JSON.stringify(next))
    past.value = [...past.value.slice(-29), document.value]
    future.value = []
    document.value = checked
  }

  /**
   * 같은 식별자의 설비 모델을 추가하거나 교체하고 기준 맵을 연결하는 라이브러리 편집
   *
   * @param value 현재 처리 단계에서 검증하거나 반영할 입력 값
   * @param mapRef 기준 지도 파일명과 노드 좌표 식별값
   */
  const setAsset = (value: FacilityAsset, mapRef: FacilityDocument['mapRef']) => {
    commit((doc) => {
      const index = doc.assets.findIndex((a) => a.id === value.id)
      if (index < 0) doc.assets.push(value)
      else doc.assets[index] = value
      if (!doc.mapRef.geometryKey) doc.mapRef = mapRef
    })
    selectedAssetId.value = value.id
  }

  /**
   * 선택한 설비 모델의 독립 배치를 만들고 선택 상태를 갱신하는 설비 추가
   *
   * @param x 지도 또는 모델 기준 가로 좌표
   * @param y 지도 또는 모델 기준 세로 좌표
   * @param portId 설비 배치의 기준이 되는 원본 포트 식별자
   */
  const place = (x: number, y: number, portId?: string) => {
    if (!asset.value) return
    const model = asset.value
    const id = crypto.randomUUID()
    commit((doc) =>
      doc.instances.push({
        id,
        assetId: model.id,
        name: `${model.name} ${doc.instances.filter((i) => i.assetId === model.id).length + 1}`,
        position: { x, y, z: 0 },
        rotation: 0,
        ...(portId ? { portId, portOffset: { x: 0, y: 0, z: 0 } } : {}),
      }),
    )
    selectedId.value = id
  }

  /**
   * 배치 식별자를 유지하며 위치와 회전 및 연결 속성을 변경하는 설비 배치 편집
   *
   * @param id 조회하거나 편집할 대상의 고유 식별자
   * @param patch 식별자를 유지하면서 교체할 대상 속성
   */
  const updateInstance = (id: string, patch: Partial<FacilityInstance>) => {
    commit((doc) => {
      const instance = doc.instances.find((i) => i.id === id)
      if (instance) Object.assign(instance, patch, { id })
    })
  }

  /**
   * 현재 선택된 설비 배치를 제거하고 선택을 해제하는 설비 삭제
   */
  const remove = () => {
    if (!selectedId.value) return
    commit((doc) => {
      doc.instances = doc.instances.filter((i) => i.id !== selectedId.value)
    })
    selectedId.value = null
  }

  /**
   * 선택 배치를 새로운 식별자로 복제하고 포트 기준 오프셋을 함께 이동하는 배치 복사
   */
  const insertCopy = (source: FacilityInstance, x: number) => {
    const copy = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      name: `${source.name.slice(0, 297)} 복사`,
      position: { ...source.position, x },
    }
    if (copy.portOffset) copy.portOffset.x += x - source.position.x
    commit((doc) => doc.instances.push(copy))
    selectedId.value = copy.id
  }

  /** 선택 시설을 기존 복제 버튼의 포트 연결 규칙으로 추가 */
  const duplicate = () => {
    if (selected.value) insertCopy(selected.value, selected.value.position.x + 1000)
  }

  /** 실제 배치 좌표를 복사하고 원본과 분리되는 붙여넣기 위치를 계산 */
  const copySelection = (ports: FacilityPort[]) => {
    const source = selected.value
    const model = document.value.assets.find((item) => item.id === source?.assetId)
    if (!source || !model) return false
    const instance = structuredClone(resolveFacilityInstance(source, ports))
    delete instance.portId
    delete instance.portOffset
    delete instance.nodeId
    delete instance.carrierRotation
    const size = facilityModelSize(model)
    const angle = (instance.rotation * Math.PI) / 180
    const width =
      Math.abs(Math.cos(angle)) * size.x * (instance.scale?.x ?? 1) +
      Math.abs(Math.sin(angle)) * size.y * (instance.scale?.y ?? 1)
    const gap = Math.ceil((width + 300) / 10) * 10
    copied = { instance, gap, nextX: instance.position.x + gap }
    message.value = `${instance.name} 복사 완료`
    return true
  }

  /** 복사한 모델을 기준 지도 위에 한 개 추가하고 다음 복제 위치를 이동 */
  const pasteSelection = () => {
    if (!copied || busy.value) return false
    if (!document.value.assets.some((item) => item.id === copied?.instance.assetId))
      throw new Error('복사한 시설의 모델이 현재 라이브러리에 없습니다.')
    insertCopy(copied.instance, copied.nextX)
    copied.nextX += copied.gap
    message.value = '복사한 시설을 배치했습니다.'
    return true
  }

  /**
   * 기존 배치 문서를 현재 기준 지도의 식별 정보에 연결하는 맵 참조 갱신
   *
   * @param mapRef 기준 지도 파일명과 노드 좌표 식별값
   */
  const bindMap = (mapRef: FacilityDocument['mapRef']) => {
    commit((doc) => {
      doc.mapRef = mapRef
    })
  }

  /**
   * 이전 문서를 복원하고 현재 문서를 다시 실행 목록으로 옮기는 실행 취소
   */
  const undo = () => {
    const doc = past.value.at(-1)
    if (!doc) return
    future.value = [...future.value, document.value]
    document.value = doc
    past.value = past.value.slice(0, -1)
    selectedId.value = null
  }

  /**
   * 다시 실행 문서를 복원하고 현재 문서를 이전 이력으로 옮기는 다시 실행
   */
  const redo = () => {
    const doc = future.value.at(-1)
    if (!doc) return
    past.value = [...past.value, document.value]
    document.value = doc
    future.value = future.value.slice(0, -1)
    selectedId.value = null
  }

  /**
   * 파일 내용의 형식을 검증한 뒤 문서와 저장 기준을 교체하는 파일 불러오기
   *
   * @param content 파일에서 읽은 원본 문자열
   * @param name 파일 또는 모델을 구분하는 표시 이름
   */
  const load = (content: string, name: string) => {
    const doc = parseFacilityDocument(content)
    for (const asset of doc.assets)
      if (asset.id.startsWith('ceram-mp5-'))
        asset.name = defaultModelLabel(asset.name) || '기본 모델'
    for (const item of doc.instances)
      if (item.assetId.startsWith('ceram-mp5-')) item.name = defaultModelLabel(item.name) || '시설'
    copied = undefined
    document.value = doc
    saved.value = doc
    filename.value = name
    past.value = []
    future.value = []
    selectedId.value = null
    selectedAssetId.value = doc.assets[0]?.id ?? null
  }

  /**
   * 새 기준 맵에 연결한 빈 설계로 문서와 선택 및 이력을 교체하는 맵 전환 초기화
   * @param mapRef 새로 연 기준 지도의 파일명과 좌표 식별값
   */
  const resetForMap = (mapRef: FacilityDocument['mapRef']) => {
    const next = emptyFacilityDocument()
    next.mapRef = mapRef
    load(JSON.stringify(next), 'Untitled.map3d.json')
    message.value = '새 맵에 연결했습니다. 포트에 설비를 배치하세요.'
  }

  /**
   * 저장하지 않은 설계의 폐기를 확인한 뒤 기준 맵에 연결된 빈 설계를 만드는 문서 초기화
   *
   * @param mapRef 기준 지도 파일명과 노드 좌표 식별값
   */
  const newScene = (mapRef: FacilityDocument['mapRef']) => {
    if (
      busy.value ||
      (dirty.value && !window.confirm('저장하지 않은 3D 설계를 버리고 새로 만드시겠습니까?'))
    )
      return
    const next = emptyFacilityDocument()
    next.mapRef = mapRef
    load(JSON.stringify(next), 'Untitled.map3d.json')
    message.value = '새 3D 설계를 만들었습니다. 기준 2D 맵은 유지됩니다.'
  }

  /**
   * 저장하지 않은 설계의 교체 여부를 확인하고 단일 설계 프로젝트를 여는 비동기 파일 작업
   */
  const open = async () => {
    if (
      busy.value ||
      (dirty.value && !window.confirm('저장하지 않은 3D 설계를 버리고 여시겠습니까?'))
    )
      return
    busy.value = true
    try {
      const file = window.desktop ? await window.desktop.openScene() : await pickMapFile()
      if (file) load(file.content, file.name)
    } catch (error) {
      message.value = error instanceof Error ? error.message : String(error)
    } finally {
      busy.value = false
    }
  }

  /**
   * 공유 계약을 재검증한 설계 스냅샷을 저장하고 저장 기준을 갱신하는 프로젝트 저장
   */
  const save = async (projectToken?: string) => {
    if (busy.value) return
    busy.value = true
    const snapshot = document.value
    try {
      const checked = parseFacilityDocument(JSON.stringify(snapshot))
      const content = JSON.stringify(checked, null, 2)
      document.value = checked
      if (window.desktop) {
        const name = await window.desktop.saveScene(content, filename.value, projectToken)
        if (name) {
          saved.value = checked
          filename.value = name
          message.value = `현재 프로젝트 3D 폴더에 저장 완료: ${name}`
        }
      } else {
        downloadJson(content, filename.value)
        message.value = '3D JSON 다운로드를 요청했습니다.'
      }
    } catch (error) {
      message.value = error instanceof Error ? error.message : String(error)
    } finally {
      busy.value = false
    }
  }

  /**
   * 모델 라이브러리와 포트 연결 배치를 분리된 파일로 추출하는 실행 데이터 내보내기
   * 현재 포트 좌표로 절대 위치 캐시를 갱신하고 기존 연결 메타데이터를 상대 오프셋으로 전환하는 배치 정규화
   *
   * @param ports 현재 기준 맵의 포트 식별자와 위치 목록
   */
  const exportRuntime = async (ports: FacilityPort[], projectToken?: string) => {
    if (busy.value) return
    busy.value = true
    try {
      const snapshot = structuredClone(document.value)
      snapshot.instances = snapshot.instances.map((instance) => {
        // 기존 포트 메타데이터를 현재 절대 위치와 포트 좌표의 차이로 변환하는 실제 포트 연결
        if (instance.portId && !instance.portOffset) {
          const port = ports.find((p) => p.id === instance.portId)
          if (!port) throw new Error(`포트가 없습니다: ${instance.portId}`)
          instance.portOffset = {
            x: instance.position.x - port.x,
            y: instance.position.y - port.y,
            z: instance.position.z,
          }
        }
        return resolveFacilityInstance(instance, ports)
      })
      const { library, layout } = exportFacilityFiles(snapshot)
      const libraryJson = JSON.stringify(library, null, 2),
        layoutJson = JSON.stringify(layout, null, 2)
      if (window.desktop) {
        const folder = await window.desktop.exportScene(layoutJson, libraryJson, projectToken)
        if (folder) message.value = `3D 데이터 추출 완료: ${folder} (equipment.json + map3d.json)`
      } else {
        downloadJson(libraryJson, 'equipment.json')
        downloadJson(layoutJson, 'map3d.json')
        message.value =
          'equipment.json과 map3d.json 다운로드를 요청했습니다. 두 파일을 함께 보관하세요.'
      }
    } catch (error) {
      message.value = error instanceof Error ? error.message : String(error)
    } finally {
      busy.value = false
    }
  }

  /**
   * 별도 설비 파일을 검증하고 식별자가 충돌하지 않는 모델을 라이브러리에 병합하는 모델 가져오기
   *
   * @param mapRef 기준 지도 파일명과 노드 좌표 식별값
   */
  const importModels = async (mapRef: FacilityDocument['mapRef']) => {
    if (busy.value) return
    busy.value = true
    try {
      const file = window.desktop ? await window.desktop.openScene() : await pickMapFile()
      if (!file) return
      const library = parseEquipmentLibrary(file.content)
      commit((doc) => {
        if (!doc.mapRef.geometryKey) doc.mapRef = mapRef
        for (const asset of library.assets) {
          if (asset.id.startsWith('ceram-mp5-'))
            asset.name = defaultModelLabel(asset.name) || '기본 모델'
          const old = doc.assets.find((a) => a.id === asset.id)
          if (old && JSON.stringify(old) !== JSON.stringify(asset))
            throw new Error(`같은 ID의 다른 모델이 있습니다: ${asset.name}`)
          if (!old) doc.assets.push(asset)
        }
      })
      selectedAssetId.value = library.assets[0]?.id ?? null
      message.value = '설비 모델을 불러왔습니다.'
    } catch (error) {
      message.value = error instanceof Error ? error.message : String(error)
    } finally {
      busy.value = false
    }
  }

  /** 지정한 모델의 교체와 여러 모델의 추가를 묶는 단일 편집 이력 구성 */
  const addAssets = (
    assets: FacilityAsset[],
    mapRef: FacilityDocument['mapRef'],
    replaceIds: string[] = [],
  ) => {
    commit((doc) => {
      if (!doc.mapRef.geometryKey) doc.mapRef = mapRef
      for (const asset of assets) {
        const old = doc.assets.find((item) => item.id === asset.id)
        if (old && replaceIds.includes(asset.id)) {
          doc.assets[doc.assets.indexOf(old)] = asset
          continue
        }
        if (old && JSON.stringify(old) !== JSON.stringify(asset))
          throw new Error(`같은 ID의 다른 모델이 있습니다: ${asset.name}`)
        if (!old) doc.assets.push(asset)
      }
    })
    selectedAssetId.value = assets[0]?.id ?? null
  }

  /** 기존 사용자 배치를 유지하며 중복 식별자를 제외하는 랙 일괄 배치 */
  const addPlacements = (
    asset: FacilityAsset,
    instances: FacilityInstance[],
    mapRef: FacilityDocument['mapRef'],
  ) => {
    commit((doc) => {
      if (!doc.mapRef.geometryKey) doc.mapRef = mapRef
      if (doc.mapRef.geometryKey !== mapRef.geometryKey)
        throw new Error('현재 지도와 설계의 기준 맵이 다릅니다.')
      if (!doc.assets.some((item) => item.id === asset.id)) doc.assets.push(asset)
      const ids = new Set(doc.instances.map((instance) => instance.id))
      for (const instance of instances)
        if (!ids.has(instance.id)) {
          doc.instances.push(instance)
          ids.add(instance.id)
        }
    })
    selectedAssetId.value = asset.id
  }

  /** 현재 설비 문서와 저장 기준 및 편집 이력의 스냅샷 생성 */
  const captureSession = () => ({
    document: document.value,
    saved: saved.value,
    selectedId: selectedId.value,
    selectedAssetId: selectedAssetId.value,
    filename: filename.value,
    message: message.value,
    past: past.value,
    future: future.value,
  })
  /**
   * 도면 맵 교체 실행 취소에 대응하여 설비 문서와 저장 기준을 복원하는 세션 적용
   * @param snapshot 이전 설비 편집 세션
   */
  const restoreSession = (snapshot: ReturnType<typeof captureSession>) => {
    copied = undefined
    document.value = snapshot.document
    saved.value = snapshot.saved
    selectedId.value = snapshot.selectedId
    selectedAssetId.value = snapshot.selectedAssetId
    filename.value = snapshot.filename
    message.value = snapshot.message
    past.value = snapshot.past
    future.value = snapshot.future
  }
  return {
    commit,
    document,
    captureSession,
    restoreSession,
    selectedId,
    selectedAssetId,
    selected,
    asset,
    dirty,
    filename,
    message,
    busy,
    past,
    future,
    setAsset,
    place,
    updateInstance,
    remove,
    duplicate,
    copySelection,
    pasteSelection,
    bindMap,
    undo,
    redo,
    load,
    newScene,
    resetForMap,
    open,
    save,
    exportRuntime,
    importModels,
    addAssets,
    addPlacements,
  }
})
