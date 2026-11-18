<div align="center">

# TS_MGS

### 2D / 3D Map Generation & Editing Studio

**기존 MGS 지도 편집 기능과 3D 설비 설계, 로컬 AI 기반 편집 워크플로를 통합한 데스크톱 애플리케이션**

![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vuetify](https://img.shields.io/badge/Vuetify-1867C0?logo=vuetify&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-111111?logo=threedotjs&logoColor=white)
![Status](https://img.shields.io/badge/Status-In%20Development-DAA520)

**[주요 기능](#-주요-기능) · [실행 방법](#-시작하기) · [프로젝트 구조](#-프로젝트-구조) · [개발 현황](#-개발-현황) · [검증](#-검증-및-품질-관리)**

</div>

---

## 프로젝트 소개

TS_MGS는 기존 C# 기반 MGS의 2D 지도 편집 워크플로를 웹 기술 스택으로 이관하면서, **3D 설비 모델 제작·배치**와 **로컬 AI 에이전트**를 결합하는 프로젝트입니다.

- **2D 지도 편집:** 노드·경로·포트·도형 및 운행 관련 속성 편집
- **3D 설비 설계:** 부품 조합 모델링, 포트 기반 배치, 데이터 추출
- **AI 지원 작업:** 지도 조회·편집 도구 호출, 도면 인식, 사용자 확인 기반 작업 수행
- **원본 호환성:** JMAPX Ver.23/25 입출력 및 기존 제어 정보 보존
- **오프라인 환경 고려:** 로컬 Ollama 사용, Pretendard Variable 글꼴 내장

> [!IMPORTANT]
> 기존 C# MGS의 모든 기능을 이관한 상태는 아닙니다. 구현 여부와 원본 동등성 검증 여부는 구분해서 관리합니다. 실제 운행에 적용하기 전 별도의 검증이 필요합니다.

## ✨ 주요 기능

| 영역 | 핵심 기능 |
| --- | --- |
| **2D 지도 편집** | 노드·경로·포트·도형 편집, 영역 선택, 속성 수정, Undo / Redo |
| **원본 지도 관리** | JMAPX Ver.23/25 열기·저장, MAP/RCS 프로젝트 탐색, 관련 DATA 파일 처리 |
| **레이아웃 배경** | 이미지 자르기, 여백 제거, 투명도·위치·회전·축척 조정 및 표시 전환 |
| **도면 분석** | 도면 객체 인식, 검토 항목 수정, 경로 및 3D 설비 제작 보조 |
| **3D 모델 제작** | 박스·원통 부품 조합, 이동·회전·크기 편집, 다중 선택·일괄 좌표 변경 |
| **설비 배치** | 포트 기준 모델 배치, 라이브러리 관리, 설계 프로젝트 저장 |
| **AI 에이전트** | 맵 상태 조회, 도구 기반 편집, 부족한 정보 확인, 실행 결과 관찰 |
| **렌더링** | 2D/3D 표시 옵션 공유, 대형 좌표 대응, 라벨 재사용 및 가림 처리 |

### 1. 2D 지도 편집

기존 MGS의 화면 구성과 지도 편집 개념을 기반으로 아래 작업을 지원합니다.

- **노드·경로:** 선택·이동·복제·삭제, 연결 및 방향·거리·속도 관련 설정, 직선 간격 분할
- **포트:** 추가·편집·삭제, 위치·크기·표시 속성, 예약 및 그룹 설정
- **도형·영역:** Shape 생성, Bay / Zone 설정, 주변 노드 검사, 선택 객체 편집
- **Teaching:** XLSX/CSV에서 Real ID 기반 좌표, Offset, 차량 각도 및 운행 속성 적용
- **Control Map Data:** 회전 관련 플래그, No Send Goal, Don't Remove CMD 등의 자동 설정
- **지도 조작:** 영역 선택, Space + 왼쪽 드래그로 패닝, 빠른 검색과 미니맵 이동

> 원본 제어값과 예약 필드 중 현재 버전에서 해석하지 않는 값은 보존하는 방향으로 처리합니다. JMAPX의 좌표·크기 단위는 정수 mm입니다.

### 2. 원본 지도 입출력

| 작업 | 동작 |
| --- | --- |
| **Open / Project Select** | 개별 JMAPX 또는 RCS/MAP 폴더에서 지도 선택, 인접 설정·포트 그룹 파일 로드 |
| **Map Save / Ctrl+S** | 지도와 선택된 운행 부가 데이터 생성, 시각 기반 새 파일명 사용 |
| **Save Only Map** | 운행 부가 데이터 재생성을 제외한 지도 저장 |
| **Save As / Ctrl+Shift+S** | 대상 RCS 또는 MAP 폴더를 지정하여 저장 |
| **JSON** | 기존 TS_MGS JSON을 연 경우 해당 형식 유지 |

저장 산출물의 대표적인 형태는 다음과 같습니다.

```text
MAP/
└── YYYYMMDD_HHmmss.jmapx
DATA/
├── <map-name>_port_group.bem
├── <map-name>_<item>.bem
└── TRAFFIC/
    └── <map-name>.aesx
```

부가 데이터를 먼저 확정한 뒤 지도 파일을 저장하며, 실패 시 해당 저장 작업에서 만든 파일을 정리하도록 설계되어 있습니다. 기존 파일 버전은 유지합니다.

### 3. 3D 설비 모델링 및 배치

1. 2D JMAPX 또는 TS_MGS JSON을 엽니다.
2. **3D** 화면에서 새 모델을 디자인하거나 기존 모델을 수정합니다.
3. 박스·원통 부품의 이름, 좌표, 치수, 회전, 색상을 조정합니다.
4. 모델을 라이브러리에 적용하고 **Port ID**를 기준으로 배치합니다.
5. 설계 프로젝트를 저장하거나 3D 배치 데이터를 추출합니다.

**대표 추출 파일**

```text
equipment.json  # 설비 모델 및 부품 형상
map3d.json      # 기준 맵, 모델·포트 ID, 오프셋·회전·좌표 정보
```

TS_UI에서는 같은 2D 지도를 연 상태에서 두 JSON 파일을 함께 불러와 배치를 표시할 수 있습니다. 공유 3D 계약·검증 코드는 `packages/map3d/`에서 관리합니다.

### 4. 로컬 AI 에이전트

AI 에이전트는 **대화 → 현재 상태 조회 → 도구 선택 및 실행 → 결과 확인** 흐름으로 동작합니다.

```text
사용자 요청 / 첨부 도면
          │
          ▼
   현재 지도·선택 상태 조회
          │
          ▼
     필요한 도구 선택
          │
     ┌────┴────┐
     ▼         ▼
  정보 충분   정보 부족
     │         │
     │      ask_user
     │         │
     └────┬────┘
          ▼
     조회 / 편집 실행
          │
          ▼
   결과 확인 및 후속 작업
```

- `edit_selection`: 선택한 노드·포트·설비의 조회, 이동, 삭제 및 복제
- `edit_map`: 새로운 지도 객체 추가 등 일반 맵 편집
- `ask_user`: 수치·단위·텍스트·선택지·예/아니요 등 필요한 정보 확인
- **첨부 이미지:** 분석 요청과 실제 편집 요청을 구분하며, 단순 첨부만으로 지도를 수정하지 않음
- **안전한 실행 범위:** 앱이 제공하는 도구만 사용하고 임의 코드·셸 실행은 지원하지 않음
- **편집 이력:** AI 편집 역시 기존 Undo / Redo 기록에 포함

도면 인식은 누락·오인식이 가능하므로 실제 크기, 설비 높이, 도킹 방향, 차량 성능 등이 확인되지 않은 경우 확정값으로 취급하지 않습니다.

## 🚀 시작하기

### 요구 환경

| 항목 | 요구 사항 |
| --- | --- |
| 운영체제 | Windows 기준 개발 환경 |
| Node.js | **24** |
| 패키지 관리 | npm |
| 데스크톱 런타임 | Electron |
| AI 기능(선택) | Ollama 및 사용할 모델 사전 설치 |

### 설치 및 실행

```powershell
npm install
npm run dev
```

브라우저 개발 모드:

```powershell
npm run dev:web
```

빌드된 앱을 Electron에서 실행:

```powershell
npm run build
npm start
```

> Electron `main` 또는 `preload` 변경 사항은 앱 재시작 후 반영됩니다.

### 로컬 AI 연결(선택)

Ollama 서버를 실행한 후 환경 변수를 지정합니다.

```powershell
$env:TS_MGS_AI_URL = 'http://127.0.0.1:11434'
$env:TS_MGS_AI_MODEL = 'gpt-oss:20b'
$env:TS_MGS_VISION_MODEL = 'qwen2.5vl:7b'

npm start
```

- AI 작업 모델과 비전 모델은 별도 설정합니다.
- 채팅 상단 모델 선택 UI에서 설치된 Ollama 모델을 검색·선택할 수 있습니다.
- 모델 변경은 다음 요청부터 적용되며 선택 상태는 재실행 후에도 유지됩니다.
- AI 기능은 외부 클라우드 모델이나 런타임 모델 다운로드 호출을 전제로 하지 않습니다.
- 개발 서버 주소는 환경에 맞춰 설정하고, 내부 네트워크 주소 및 인증 정보는 저장소에 기록하지 않습니다.

## 📁 프로젝트 구조

```text
TS_MGS/
├── src/
│   ├── app/          # 앱 초기화, 전역 설정, 플러그인
│   ├── pages/        # 화면 단위 구성
│   ├── widgets/      # 주요 UI 영역 및 복합 기능
│   ├── features/     # 사용자 기능 및 편집 워크플로
│   ├── entities/     # 지도·도메인 모델 및 관련 로직
│   └── shared/       # 공통 UI, 유틸리티, 인프라
├── electron/         # Electron 메인·preload·파일 입출력
├── packages/
│   └── map3d/        # 공유 3D 데이터 계약·검증·설비 생성
└── scripts/          # 개발 실행·검증·이관 테스트
```

아키텍처는 **FSD(Feature-Sliced Design)** 기반입니다. 소스 내부 경로는 `@/` 별칭을 사용하며, 현재 프로젝트 문서 기준 다른 슬라이스의 공개 진입점(`index.ts`)을 통해 참조합니다.

### 코딩 기준

- **TypeScript / Vue:** 함수는 `const` 화살표 함수 사용, 함수 설명·인수·반환값은 JSDoc으로 작성
- **주석:** 소스 파일 헤더에 파일명·설명·작성자·작성일 기록, 일반 설명은 단일 행 주석
- **UI:** Vuetify 컴포넌트 및 유틸리티 클래스 우선 적용
- **스타일:** 화면별 스타일은 Vue 컴포넌트의 `scoped SCSS`에 작성
- **공통 테마:** 루트에는 색상 토큰과 최소한의 전역 스타일 유지
- **JSON:** 표준 JSON 형식 유지를 위해 주석 제외

## 🧪 검증 및 품질 관리

### 개발 명령어

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | Vite + Electron 개발 실행 |
| `npm run dev:web` | 브라우저 개발 실행 |
| `npm run format` | 코드 서식 정리 |
| `npm run format:check` | 코드 서식 검증 |
| `npm run typecheck` | TypeScript 및 FSD 경계 검사 |
| `npm run build` | 타입 검사 후 화면 빌드 |
| `npm start` | 빌드 결과를 Electron으로 실행 |

### 회귀·이관 검사

```powershell
node scripts/test-map-rendering.mjs
node scripts/check-mgs-migration.mjs
node scripts/check-teaching.mjs
node scripts/check-area-save.mjs
node scripts/check-aes.mjs
```

- **지도 렌더링 테스트:** 8,000개 노드·800개 포트, 큰 원점 좌표, 라벨 재사용 및 가림 처리 등 확인
- **원본 데이터 확인:** `MGS_REFERENCE_MAP` 환경 변수로 JMAPX 경로를 지정해 읽기 전용 비교 검사 가능
- **이관 검증:** JMAPX 보존, Teaching, 영역 저장 및 AES 관련 회귀 검사

> [!CAUTION]
> 문서 구조 검사 및 생성 파일 회귀 테스트는 원본 MGS의 전체 운행 검증이나 실제 현장 안전 검증을 대체하지 않습니다.

## 📌 개발 현황

**기존 C# MGS의 2D 기능 이관 진행 중**

원본 리본 명령 107개 중 **22개는 현재 연결되지 않아 비활성 상태**로 기록되어 있습니다. 나머지 명령도 모든 하위 동작의 동등성 검증이 완료됐다는 뜻은 아닙니다.

<details>
<summary><strong>미이관 또는 추가 검증 필요 항목 보기</strong></summary>

- Feature·Blocking·Pre-Occupation 생성·편집, Command·SCMD·Schedule·Vehicle Limited Area·DPP
- AGV·Carrier·Contour·ODS·Grid·Drawing 설정 창 및 SETTING 파일 저장·복제
- 불법 노드·포트의 상세 진단, LOT 거리, IC/JC, 제외 Occupation, AES 상세 조회
- 차량 방향 도형, 곡선 시작 노드 강제 삭제, 곡선 재구성·그래프 복제
- 직각 주행 자동 Reverse 전파
- DB 데이터 적용 및 Ver.23 이전 지도 파일 변환
- 원본 C#에서 생성한 현장 AES·Around 파일의 전수 비교
- 원본 저장 마법사의 전체 단계 동등성 검증

</details>

## 🗂️ 데이터 형식 안내

| 형식 | 용도 | 비고 |
| --- | --- | --- |
| `.jmapx` | 2D 운행 지도 | Ver.23/25 편집 지원, 정수 mm 좌표 |
| `.bem` | 포트 그룹·영역·Around 등 부가 정보 | 지도 파일명과 연계 |
| `.aesx` | AES 운행 관련 데이터 | `DATA/TRAFFIC/` 하위 저장 |
| `.json` | TS_MGS 프로젝트·도면 분석 정보 | 참조 영상·인식 상태 등 포함 가능 |
| `equipment.json` | 3D 설비 모델 및 부품 | TS_UI와 연동 |
| `map3d.json` | 3D 맵 배치 데이터 | 포트 ID·오프셋·회전·좌표 |
| `.layout.json` | 편집용 배경 설정 | JMAPX 배경 영상 미포함 보완 |

---

<div align="center">

**TS_MGS** · Map Editing · 3D Facility Design · Local AI Assistant

<sub>Development in progress · 실제 운행 적용 전 원본 시스템 및 현장 검증 필요</sub>

</div>
