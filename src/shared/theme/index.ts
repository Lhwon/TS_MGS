/**
 * 파일명: index.ts
 * 설명: TS_UI 팔레트와 같은 색상을 화면과 Vuetify에서 공유하는 테마 공개 진입점
 * 작성자: 이희원
 * 작성일자: 2026-11-04
 */
// TS_UI styles/palette.scss의 네이비와 주황색 및 상태 색상 기준
const dark = {
  background: '#00092d',
  surface: '#1d243c',
  'surface-alt': '#16213a',
  input: '#0b1730',
  border: '#465a76',
  'border-subtle': '#2b3a55',
  text: '#f3f7ff',
  secondary: '#c8d6ec',
  muted: '#92a4c0',
  accent: '#ff9900',
  'accent-text': '#ff9900',
  hover: '#1e2a42',
  pressed: '#243b5c',
  selected: '#2a3958',
  info: '#5aa7ff',
  success: '#30d158',
  warning: '#ff9f0a',
  danger: '#ff5c5c',
}
// TS_UI 라이트 팝업의 표면과 입력창 및 읽기 가능한 강조 글자색 기준
const light: typeof dark = {
  background: '#f3f6f8',
  surface: '#ffffff',
  'surface-alt': '#f3f6f8',
  input: '#f3f6f8',
  border: '#cbd6de',
  'border-subtle': '#e1e7ed',
  text: '#20323e',
  secondary: '#586d7b',
  muted: '#65798a',
  accent: '#ff9900',
  'accent-text': '#9a5800',
  hover: '#edf2f7',
  pressed: '#dfe8f2',
  selected: '#fff0da',
  info: '#2196f3',
  success: '#287d37',
  warning: '#9a5800',
  danger: '#bc3030',
}
export const systemPalette = { dark, light }

/**
 * 공통 팔레트에서 Vuetify 테마에 필요한 색상 역할 구성
 * @param mode 화면 밝기 모드
 * @returns 컴포넌트와 화면 배경의 공통 색상
 */
export const vuetifyColors = (mode: keyof typeof systemPalette) => {
  const palette = systemPalette[mode]
  return {
    primary: palette.accent,
    secondary: palette.secondary,
    background: palette.background,
    surface: palette.surface,
    'on-surface': palette.text,
    'on-background': palette.text,
    'on-primary': '#201200',
    error: palette.danger,
    info: palette.info,
    success: palette.success,
    warning: palette.warning,
  }
}

/**
 * 팝업을 포함한 문서 전체에 같은 팔레트를 전달하는 테마 적용
 * @param mode 화면 밝기 모드
 */
export const applySystemPalette = (mode: keyof typeof systemPalette) => {
  document.documentElement.dataset.theme = mode
  for (const [name, value] of Object.entries(systemPalette[mode])) {
    document.documentElement.style.setProperty(`--app-${name}`, value)
  }
}
