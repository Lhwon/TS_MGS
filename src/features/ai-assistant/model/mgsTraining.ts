/**
 * 파일명: mgsTraining.ts
 * 설명: 교육 슬라이드와 실습 영상에서 확인한 작업 근거의 폐쇄망 검색
 * 작성자: 이희원
 * 작성일자: 2026-11-18
 */
const training = [
  {
    title: '노드와 포트 식별자',
    terms: ['노드', '포트', 'real id', 'node id', 'uid', 'virtual node', '가상 노드'],
    source: '솔루션 사업부 통합 교육 자료 Rev01 · 슬라이드 26',
    guidance:
      'Node ID는 맵과 CORE의 연결 식별자이고 Real ID는 실제 시스템에서 사용하는 번호다. UID는 노드 고유 식별자다. 가상 노드는 경로 주행 정밀도에 사용한다. 사용자가 선택한 포트의 연결 노드를 먼저 조회한다.',
  },
  {
    title: '도면 PNG와 실제 축척',
    terms: ['도면', '축척', '스케일', '크기', '배경', 'png', 'mm', '가로'],
    source: '솔루션 사업부 통합 교육 자료 Rev01 · 슬라이드 46',
    guidance:
      '이미지 출력 크기와 실제 도면 길이는 별도 값이다. 배경을 줄여 출력해도 보정에는 원 도면의 실제 가로 길이나 확인한 기준 거리를 사용한다.',
  },
  {
    title: '포트 진입과 후면 포크',
    terms: ['포트', '진입', '후진', '전진', '포크', 'fork', 'reverse', '차량 방향'],
    source: '최신 MGS 교육영상 · 41분 40초 부근 / 통합 교육 자료 Rev01 · 슬라이드 59',
    guidance:
      '영상은 후면 포크 차량의 포트 진입 경로에 Reverse를 적용하는 사례다. 포크 장착 방향과 실제 진입 대상 경로를 확인한다. 포트 연결 노드의 진입 방향 제어만 변경하고 반대편 제어와 경로 연결을 유지한다.',
  },
  {
    title: '차량 각도와 경로 각도',
    terms: ['각도', '방향', 'path degree', 'vehicle degree', 'reverse', '수동각'],
    source: '솔루션 사업부 통합 교육 자료 Rev01 · 슬라이드 59',
    guidance:
      'Path Degree는 경로의 방향이며 Vehicle Degree는 차량 전면의 방향이다. Reverse는 차량 기본 각도를 반대로 하며 단방향과 양방향 연결 설정은 별도로 확인한다.',
  },
  {
    title: '직선과 커브 생성',
    terms: ['커브', '곡선', '반경', '회전', '경로 생성', 'curve', 'dynamic radius'],
    source: '최신 MGS 맵 제작 흐름 및 교육영상 · 5분 부근 / 최신 MGS 교육영상 · 7분 30초 부근',
    guidance:
      '경로 생성에서 직선과 곡선을 연결한다. 커브 조정에는 Dynamic Radius 또는 Curve Setting을 사용한다. 영상에서 사용한 값의 적용 범위는 해당 실습이며 현장 작업의 반경은 차량 제원과 통로 여유로 확인한다.',
  },
  {
    title: '지도 저장과 운행 부가 데이터',
    terms: [
      '저장',
      '파일',
      'jmapx',
      'feature',
      'blocking',
      'around',
      '선점',
      'occupation',
      'bay',
      'scmd',
    ],
    source:
      '솔루션 사업부 통합 교육 자료 Rev01 · 슬라이드 25, 29, 43 / 맵 제작 흐름 영상 · 19분 10초 부근',
    guidance:
      'JMAPX는 노드와 경로 등 지도 데이터다. Feature, Blocking, PO, SCMD는 별도 운행 데이터다. 저장 요청에서 지도만 필요한지 부가 데이터까지 필요한지 구분한다. 부가 파일의 생성과 검증 범위는 현재 앱 기능을 확인한다.',
  },
]

/** 한글 표현과 영문 용어를 비교해 관련 작업 근거만 선별하는 로컬 검색 */
export const searchMgsTraining = (query: string) => {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]/gu, '')
  const input = normalize(query)
  if (!input || query.length > 500) throw new Error('교육 자료에서 찾을 주제를 입력하세요.')
  return training
    .map(({ terms, ...entry }) => ({
      entry,
      score: terms.reduce((sum, term) => {
        const key = normalize(term)
        return (
          sum +
          (input.includes(key) || (input.length >= 2 && key.includes(input))
            ? Math.min(8, key.length)
            : 0)
        )
      }, 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ entry }) => entry)
}
