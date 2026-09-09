/**
 * 비주얼 파라미터 단일 소스.
 *
 * 스파이크의 목적은 "Three.js로 레퍼런스 룩에 도달 가능한가"를 실물로 답하는 것이다.
 * 검토 후 수정이 전제이므로 모든 값을 여기 모아두고 화면 패널에서 실시간으로 바꾼다.
 * 확정된 값은 그대로 키오스크 앱으로 옮길 수 있다.
 */

export type BallKind = 'smooth' | 'ribbed' | 'coiled';

export interface VisualConfig {
  /* 씬 규모 — 레퍼런스 게임플레이 구간 실측 25~30개 */
  ballCount: number;
  ballRadius: number;
  /** 더미 깊이(칸). 1이면 완전 평면(현재 2D 물리와 동일), 3이면 레퍼런스 뷰티샷 수준 */
  pileDepthLayers: number;

  /* 캐비닛 */
  boxWidth: number;
  boxHeight: number;
  boxDepth: number;
  wallColorTop: string;
  wallColorBottom: string;
  /** 벽을 라이트박스처럼 만드는 자체발광. albedo만으로는 레퍼런스의 밝은 연보라가 안 나온다 */
  wallEmissive: number;
  floorGlowColor: string;
  floorGlowIntensity: number;
  edgeGlowIntensity: number;

  /* 재질 */
  ballRoughness: number;
  metalRoughness: number;
  clearcoat: number;
  ribAmplitude: number;
  ribCount: number;
  showDecals: boolean;

  /* 집게 — 이동은 1축(X)이지만 발 개수는 비주얼 선택 사항 */
  prongCount: 2 | 3;
  /** 집게 전체 배율 — 레퍼런스 집게는 우리 것보다 굵고 크다 */
  clawScale: number;
  clawColor: string;
  clawMetalness: number;
  clawOpen: number;
  clawX: number;
  clawY: number;

  /* 조명 */
  keyIntensity: number;
  keyPosition: [number, number, number];
  fillIntensity: number;
  ambientIntensity: number;
  envIntensity: number;
  exposure: number;

  /* 후처리 */
  bloomEnabled: boolean;
  bloomIntensity: number;
  bloomThreshold: number;
  bloomSmoothing: number;
  dofEnabled: boolean;
  dofFocusDistance: number;
  dofFocalLength: number;
  dofBokehScale: number;
  aoEnabled: boolean;
  aoIntensity: number;
  aoRadius: number;

  /* 카메라 */
  cameraFov: number;
  cameraPos: [number, number, number];
  cameraTarget: [number, number, number];

  /* 성능 */
  dpr: number;
  shadowsEnabled: boolean;

  /* 테마 — 레퍼런스(연보라) vs Aepick(핑크) */
  theme: ThemeName;
  /** 뒷벽 로고 표시 */
  showLogo: boolean;
  logoScale: number;

  /**
   * 조작 축. 집게 이동은 1축(X) 유지가 기본.
   * 2로 두면 D-pad 4방향이 되고 Z 이동이 활성화된다 — 3D 물리로 전환했으므로 가능하지만
   * 조준 시간·하네스 커버리지 등 게임 설계가 함께 바뀐다.
   */
  inputAxes: 1 | 2;
  /** 조작부 오버레이 표시 */
  showController: boolean;

  /** 구슬 낙하 시뮬레이션 애니메이션 — 대기화면 영상 렌더에 사용 */
  animate: boolean;
}

export type ThemeName = 'reference' | 'aepick';

/**
 * Aepick 브랜드 팔레트.
 * 출처: Aepick Beauty DNA 프로젝트(`Aepick 6core Value`)의 확정 토큰.
 * 단일 핑크 시스템으로 통합되어 있다 — mint/violet 계열은 핑크로 흡수됨.
 */
export const AEPICK = {
  bg0: '#fae2e9',
  bg1: '#fdf2f5',
  accent: '#f25c7c',
  accentDeep: '#e8446b',
  accentSoft: '#fbd7e0',
  gold: '#e8b84b',
  ink: '#26191e',
} as const;

/** 테마별 캐비닛 색. 구슬 팔레트는 공통(레퍼런스 품질이 승인됨). */
export const THEMES: Record<ThemeName, {
  wallColorTop: string;
  wallColorBottom: string;
  floorGlowColor: string;
  clawColor: string;
  edgeColor: string;
  bezelColor: string;
}> = {
  reference: {
    wallColorTop: '#d6cdf2',
    wallColorBottom: '#bdb2e8',
    floorGlowColor: '#7ff0e8',
    clawColor: '#f25c7c',
    edgeColor: '#efe8ff',
    bezelColor: '#b3a6da',
  },
  aepick: {
    // 벽은 밝은 핑크 그라데이션, 바닥 발광은 골드로 대비를 준다.
    // 핑크 벽에 핑크 글로우를 쓰면 뭉개져서 캐비닛 구조가 읽히지 않는다.
    wallColorTop: AEPICK.bg1,
    wallColorBottom: AEPICK.bg0,
    floorGlowColor: '#f8ead2',
    clawColor: AEPICK.accent,
    edgeColor: '#fff4f7',
    bezelColor: AEPICK.accentSoft,
  },
};

/**
 * 레퍼런스 프레임(2번 영상 t7.6 게임플레이 구간)을 눈으로 맞춘 시작값.
 * 단위는 임의 — 구슬 반지름 1을 기준으로 잡았다.
 */
export const DEFAULT_CONFIG: VisualConfig = {
  // 실기기가 PC로 확정되어 성능 여유가 커졌다. 레퍼런스 밀도에 맞춰 상향.
  ballCount: 78,
  ballRadius: 0.62,
  pileDepthLayers: 3,

  // 레퍼런스 캐비닛은 가로형이지만 우리 프레임은 1080×1920 세로형이다.
  // 세로 프레임을 채우려면 폭보다 높아야 한다.
  boxWidth: 9.5,
  boxHeight: 13,
  boxDepth: 5,
  // THEMES.aepick 값을 그대로 반영. 테마 전환은 applyTheme()로 한다.
  wallColorTop: '#fdf2f5',
  wallColorBottom: '#fae2e9',
  wallEmissive: 1.0,
  floorGlowColor: '#f8ead2',
  floorGlowIntensity: 0.55,
  edgeGlowIntensity: 1.0,

  ballRoughness: 0.07,
  metalRoughness: 0.2,
  clearcoat: 0.71,
  ribAmplitude: 0.15,
  ribCount: 12,
  showDecals: true,

  prongCount: 3,
  clawScale: 1.45,
  clawColor: '#f25c7c',
  clawMetalness: 0.85,
  clawOpen: 1,
  clawX: 0,
  clawY: 8.5,

  // keyPosition의 y는 boxHeight에 더해지는 상대값이다
  // 레퍼런스의 하이라이트는 넓고 부드럽다 = 면광원/환경광이 셰이딩을 주도한다.
  // 방향광을 세게 두면 구슬마다 작고 단단한 흰 점이 생겨 플라스틱처럼 보인다.
  keyIntensity: 0.45,
  keyPosition: [2, 3, 8],
  fillIntensity: 0.18,
  ambientIntensity: 0.22,
  envIntensity: 1.5,
  exposure: 1.0,

  bloomEnabled: true,
  bloomIntensity: 0.32,
  bloomThreshold: 0.9,
  bloomSmoothing: 0.35,
  dofEnabled: true,
  dofFocusDistance: 0.1,
  dofFocalLength: 0.045,
  dofBokehScale: 6,
  aoEnabled: true,
  aoIntensity: 2.2,
  aoRadius: 1.0,

  /*
   * 조작부가 하단 30%를 차지해 3D 필드는 1080×1344(종횡비 0.804)다.
   * 박스 폭(9.5)이 가로를 채우도록 잡으면 가시 높이 = 10.2/0.804 ≈ 12.7.
   * fov 40에서 필요한 거리 = 12.7 / (2·tan20°) ≈ 17.4.
   */
  cameraFov: 40,
  cameraPos: [0, 8.6, 19.0],
  cameraTarget: [0, 6.4, 0],

  dpr: 1.5,
  shadowsEnabled: true,

  theme: 'aepick',
  showLogo: true,
  logoScale: 0.85,
  inputAxes: 1,
  showController: true,
  animate: false,
};

/** 테마를 설정에 적용한다 */
export function applyTheme(cfg: VisualConfig, theme: ThemeName): VisualConfig {
  return { ...cfg, theme, ...THEMES[theme] };
}

/**
 * 캡슐 색과 등장 빈도.
 *
 * 레퍼런스 프레임을 세어 보면 빨강과 흰색이 지배적이고 파랑·초록이 뒤따른다.
 * 균등 분포로 두면 마젠타·라임이 과하게 눈에 띄어 전체 인상이 달라진다.
 * 실제 브랜드 컬러가 확정되면 이 표만 교체하면 된다.
 */
export const BALL_PALETTE: { color: string; weight: number }[] = [
  { color: '#e0392f', weight: 5.5 }, // 빨강 — 로고 캡슐. 레퍼런스에서 가장 많다
  { color: '#f4f3f7', weight: 3.0 }, // 화이트
  { color: '#3f92e2', weight: 3.0 }, // 블루
  { color: '#4cb85c', weight: 2.5 }, // 그린 (라임이 아니라 중간 초록)
  { color: '#efe97a', weight: 2.0 }, // 옐로
  { color: '#f05fae', weight: 0.6 }, // 마젠타 — 레퍼런스엔 거의 없다
  { color: '#9d6ee4', weight: 1.5 }, // 퍼플
  { color: '#37c9b8', weight: 0.8 }, // 틸
];

export const BALL_COLORS = BALL_PALETTE.map((p) => p.color);

/** 가중치 누적합 — 색 추첨에 사용 */
export const BALL_CUM_WEIGHTS = (() => {
  const out: number[] = [];
  let acc = 0;
  for (const p of BALL_PALETTE) {
    acc += p.weight;
    out.push(acc);
  }
  return out;
})();

export function pickColorIndex(r: number): number {
  const total = BALL_CUM_WEIGHTS[BALL_CUM_WEIGHTS.length - 1]!;
  const x = r * total;
  for (let i = 0; i < BALL_CUM_WEIGHTS.length; i++) {
    if (x < BALL_CUM_WEIGHTS[i]!) return i;
  }
  return BALL_CUM_WEIGHTS.length - 1;
}

export const METAL_COLOR = '#dfe4ea';

/** 저사양 대비 품질 단계 — 키오스크 §13 자동 축소와 연결될 값 */
export const QUALITY_PRESETS: Record<'high' | 'mid' | 'low', Partial<VisualConfig>> = {
  high: { dpr: 1.5, bloomEnabled: true, dofEnabled: true, aoEnabled: true, shadowsEnabled: true },
  mid: { dpr: 1.2, bloomEnabled: true, dofEnabled: false, aoEnabled: true, shadowsEnabled: true },
  low: { dpr: 1.0, bloomEnabled: true, dofEnabled: false, aoEnabled: false, shadowsEnabled: false },
};
