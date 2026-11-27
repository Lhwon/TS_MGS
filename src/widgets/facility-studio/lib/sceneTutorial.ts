/**
 * 실제 편집 상태를 완료 조건으로 사용하는 삼차원 입문 연습 시나리오 정의
 */

/** 연습 안내에서 관찰하는 화면 및 편집 결과 정의 */
export interface TutorialState {
  menu: string
  catalog: boolean
  tool: string
  assetId: string | null
  instanceId: string
  selectedFromExplorer: boolean
  name: string
  storedName: string
  x: number
  storedX: number
  initialX: number
  targetX: number
  floorCount: number
  floorMaterial: string
  walls: number
  ceilings: number
  ceilingVisible: boolean
}

/** 강조 대상과 사용자 동작의 완료 조건 및 안내 문구 구성 */
export interface TutorialStep {
  id: string
  title: string
  description: string
  task: string | ((state: TutorialState) => string)
  target: string | ((state: TutorialState) => string)
  done: (state: TutorialState) => boolean
  readOnly?: boolean
}

/** 동일한 연습 장면에서 제공하는 기능별 학습 경로 정의 */
export interface TutorialScenario {
  id: 'equipment' | 'building'
  title: string
  description: string
  steps: TutorialStep[]
}

/** 외부 파일 없이 카탈로그에서 선택하는 연습 모델 식별자 정의 */
export const tutorialAssetId = 'tutorial-practice-equipment'

/** 리본과 빠른 도구 및 실제 객체 배치를 사용하는 입문 시나리오 구성 */
export const sceneTutorials: TutorialScenario[] = [
  {
    id: 'equipment',
    title: '설비 배치와 속성 편집',
    description: '모델 선택부터 배치, 이름과 위치 수정, 실행 취소까지 직접 연습',
    steps: [
      {
        id: 'facility-menu',
        title: '설비 메뉴 열기',
        description: '상단 탭을 바꾸면 아래 리본의 작업 도구가 바뀝니다.',
        task: '강조된 Facility 탭을 클릭하세요.',
        target: '[data-scene-menu="Facility"]',
        done: (s) => s.menu === 'Facility',
      },
      {
        id: 'catalog',
        title: '모델 카탈로그 열기',
        description:
          '카탈로그에서 배치할 모델을 고릅니다. 이번 연습에는 가벼운 연습용 설비가 준비되어 있습니다.',
        task: 'GLB 모델 카탈로그 버튼을 클릭하세요.',
        target: '[data-testid="default-catalog"]',
        done: (s) => s.catalog,
      },
      {
        id: 'choose',
        title: '배치할 설비 선택',
        description:
          '모델 카드를 클릭하면 바닥 배치 도구가 켜집니다. 실제 작업에서는 직접 등록한 GLB도 같은 방식으로 배치합니다.',
        task: '연습용 설비 카드를 클릭하세요.',
        target: `[data-testid="catalog-model-${tutorialAssetId}"]`,
        done: (s) => s.assetId === tutorialAssetId && s.tool === 'place',
      },
      {
        id: 'place',
        title: '바닥에 설비 배치',
        description:
          '설비를 놓을 위치를 직접 지정해 보세요. 스냅 간격에 맞춰 좌표가 정리되며 Alt를 누르면 자유롭게 배치할 수 있습니다.',
        task: '격자가 보이는 화면 중앙의 바닥을 한 번 클릭하세요.',
        target: '[data-testid="facility-canvas"]',
        done: (s) => !!s.instanceId,
      },
      {
        id: 'explorer',
        title: '목록에서 객체 선택',
        description:
          'Scene Explorer와 화면의 선택 상태는 서로 연결됩니다. 목록을 클릭해 방금 배치한 설비를 선택해 보세요.',
        task: '오른쪽 목록의 연습용 설비 항목을 클릭하세요.',
        target: (s) => `[data-scene-id="${s.instanceId}"]`,
        done: (s) => s.selectedFromExplorer,
      },
      {
        id: 'name-input',
        title: '알아보기 쉬운 이름 입력',
        description:
          'Inspector에서 선택한 객체의 이름과 위치, 크기를 편집합니다. 입력 후 적용해야 실제 설계에 반영됩니다.',
        task: '이름에 연습 설비를 입력하세요.',
        target: '[data-testid="instance-name"] input',
        done: (s) => s.name === '연습 설비',
      },
      {
        id: 'name-apply',
        title: '이름 변경 적용',
        description: '입력값을 적용하면 Scene Explorer의 이름도 함께 바뀝니다.',
        task: '속성 적용 버튼을 클릭하세요.',
        target: '[data-testid="instance-apply"]',
        done: (s) => s.storedName === '연습 설비',
      },
      {
        id: 'position-input',
        title: '좌표로 정확하게 이동',
        description:
          '위치와 크기의 단위는 mm입니다. 이번에는 설비를 X축으로 1000mm 이동해 보겠습니다.',
        task: (s) => `X 좌표에 ${s.targetX}을 입력하세요.`,
        target: '[data-testid="instance-x"] input',
        done: (s) => s.x === s.targetX,
      },
      {
        id: 'position-apply',
        title: '위치 변경 적용',
        description:
          '화면에서 직접 끌어 이동할 수도 있고 좌표를 입력해 정확한 위치로 옮길 수도 있습니다.',
        task: '속성 적용 버튼을 다시 클릭하세요.',
        target: '[data-testid="instance-apply"]',
        done: (s) => !!s.instanceId && s.storedX === s.targetX,
      },
      {
        id: 'undo',
        title: '실행 취소',
        description:
          '실수했을 때는 직전 편집을 되돌릴 수 있습니다. 방금 적용한 위치 변경을 취소해 보세요.',
        task: '빠른 도구의 실행 취소 버튼을 클릭하세요.',
        target: '[data-testid="scene-undo"]',
        done: (s) => !!s.instanceId && s.storedX === s.initialX,
      },
      {
        id: 'redo',
        title: '다시 실행',
        description: '취소한 편집을 다시 적용할 수 있습니다.',
        task: '다시 실행 버튼을 클릭하세요.',
        target: '[data-testid="scene-redo"]',
        done: (s) => !!s.instanceId && s.storedX === s.targetX,
      },
      {
        id: 'file-menu',
        title: '저장 기능 위치 확인',
        description:
          '지도 저장과 삼차원 설계 저장은 역할이 다릅니다. File 메뉴에서 설계 프로젝트 저장 위치를 확인해 보세요.',
        task: '상단 File 탭을 클릭하세요.',
        target: '[data-scene-menu="File"]',
        done: (s) => s.menu === 'File',
      },
      {
        id: 'complete',
        title: '설비 편집 연습 완료',
        description:
          '실제 작업에서는 설계 프로젝트 저장으로 모델과 배치를 함께 보관합니다. 연습 중에는 파일을 저장하지 않으며 완료하면 원래 설계와 편집 상태로 돌아갑니다.',
        task: '잘하셨습니다. 완료하고 원래 설계로 돌아가세요.',
        target: '[aria-label="설계 프로젝트 파일 작업"]',
        done: () => true,
        readOnly: true,
      },
    ],
  },
  {
    id: 'building',
    title: '바닥과 벽 및 천장 만들기',
    description: '두 점으로 건물 요소를 만들고 바닥 마감과 천장 표시를 직접 조정',
    steps: [
      {
        id: 'building-menu',
        title: '건물 메뉴 열기',
        description: '건물 구조를 만드는 도구는 Building 메뉴에 모여 있습니다.',
        task: '상단 Building 탭을 클릭하세요.',
        target: '[data-scene-menu="Building"]',
        done: (s) => s.menu === 'Building',
      },
      {
        id: 'floor-tool',
        title: '사각 바닥 도구 선택',
        description:
          '사각 바닥은 마주 보는 두 꼭짓점으로 영역을 만듭니다. 다각형 바닥은 여러 꼭짓점으로 만들 수 있습니다.',
        task: '사각 바닥 버튼을 클릭하세요.',
        target: '[data-testid="floor-rectangle"]',
        done: (s) => s.tool === 'floor',
      },
      {
        id: 'floor-place',
        title: '바닥 영역 만들기',
        description:
          '시작점을 클릭한 뒤 조금 떨어진 곳의 대각선 끝점을 클릭하세요. 점이 너무 가까우면 면적이 만들어지지 않습니다.',
        task: '화면의 서로 떨어진 두 지점을 차례로 클릭하세요.',
        target: '[data-testid="facility-canvas"]',
        done: (s) => s.floorCount > 0,
      },
      {
        id: 'floor-material',
        title: '바닥 마감 바꾸기',
        description:
          '선택한 바닥의 표면 마감을 바꿀 수 있습니다. 실제 작업에서는 바닥 파일 등록으로 이미지나 GLB도 등록할 수 있습니다.',
        task: '표면 마감을 타일로 바꾼 뒤 바닥 설정 적용을 누르세요.',
        target: '[data-testid="floor-editor"]',
        done: (s) => s.floorMaterial === 'tile',
      },
      {
        id: 'wall-tool',
        title: '벽 그리기 도구 선택',
        description:
          '벽의 두께와 높이는 왼쪽 작업 설정에서 조정합니다. 지금은 기본값으로 그려 보겠습니다.',
        task: '벽 그리기 버튼을 클릭하세요.',
        target: '[data-testid="interior-wall"]',
        done: (s) => s.tool === 'wall',
      },
      {
        id: 'wall-place',
        title: '두 점으로 벽 만들기',
        description:
          '바닥과 마찬가지로 시작점과 끝점을 클릭하면 벽이 만들어집니다. 벽 그리기는 여러 벽을 연속으로 만들 수 있습니다.',
        task: '서로 떨어진 두 지점을 클릭해 벽을 하나 만드세요.',
        target: '[data-testid="facility-canvas"]',
        done: (s) => s.walls > 0,
      },
      {
        id: 'ceiling-tool',
        title: '천장 그리기 선택',
        description:
          '천장을 별도로 만들면 조명을 부착하고 관제 화면에서 벽과 함께 숨기는 구성을 만들 수 있습니다.',
        task: '천장 그리기 버튼을 클릭하세요.',
        target: '[data-testid="place-ceiling"]',
        done: (s) => s.tool === 'ceiling',
      },
      {
        id: 'ceiling-place',
        title: '천장 영역 만들기',
        description:
          '마주 보는 두 꼭짓점을 지정해 천장을 만듭니다. 내부 편집을 돕기 위해 기본적으로 천장은 윤곽 위주로 표시됩니다.',
        task: '서로 떨어진 두 지점을 클릭해 천장을 만드세요.',
        target: '[data-testid="facility-canvas"]',
        done: (s) => s.ceilings > 0,
      },
      {
        id: 'ceiling-show',
        title: '천장 표시 켜기',
        description: '천장을 실제 면으로 표시해 전체 건물 형태를 확인할 수 있습니다.',
        task: '천장 표시 버튼을 클릭하세요.',
        target: '[data-testid="building-show-ceiling"]',
        done: (s) => s.ceilingVisible,
      },
      {
        id: 'ceiling-hide',
        title: '내부 편집을 위한 윤곽 표시',
        description: '천장을 다시 윤곽 표시로 전환하면 내부 객체를 선택하고 편집하기 편리합니다.',
        task: '천장 표시 버튼을 한 번 더 클릭하세요.',
        target: '[data-testid="building-show-ceiling"]',
        done: (s) => !s.ceilingVisible,
      },
      {
        id: 'complete',
        title: '건물 만들기 연습 완료',
        description:
          '바닥과 벽 및 천장의 기본 제작 과정을 익혔습니다. 실습 내용은 파일에 저장되지 않으며 원래 작업은 그대로 복원됩니다.',
        task: '완료하고 원래 설계로 돌아가세요.',
        target: '[data-testid="facility-canvas"]',
        done: () => true,
        readOnly: true,
      },
    ],
  },
]
