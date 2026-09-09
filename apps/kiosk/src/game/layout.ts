/**
 * 월드 좌표계 · 비주얼 파라미터.
 *
 * 값의 출처는 비주얼 스파이크(`apps/spike-3d`)에서 레퍼런스와 나란히 비교해 확정한 것이다.
 * 스파이크 패널로 값을 다시 조절한 뒤 "설정 복사"한 JSON을 여기에 옮기면 된다.
 *
 * 좌표계: 바닥 y = 0, 박스 내부는 y 0..boxHeight, z -depth/2..+depth/2.
 * 집게 이동은 1축(X)만. 깊이(z)는 구슬 더미에만 쓰인다.
 */

export const WORLD = {
  /** 스파이크에서 확정한 폭 */
  boxWidth: 10.5,
  boxHeight: 13,
  boxDepth: 5,

  ballRadius: 0.62,
  /** PC 타깃으로 확정되어 기획서 §7.3의 25~40 범위를 상향했다 */
  ballCount: 78,

  /**
   * 집게 X 이동 한계.
   *
   * 제약은 **활짝 벌린 발끝과 벽 사이 간격**이다. 이 간격이 좁으면 더미 안의 구슬이
   * 끼여 밖으로 밀려난다(폭 9.5 시절 실측: 간격 0.83에서 132회 중 안전망 279회 발동).
   *
   * 폭이 9.5 → 10.5가 되어 벽이 4.75 → 5.25로 물러났으므로 한계도 같이 넓힌다.
   * 상자만 넓히고 이 값을 두면 집게가 양쪽 끝 구슬에 닿지 못한다.
   * 간격 = 5.25 − 3.4 − 발끝 반경 0.975 = 0.875 — 이전(0.885)과 사실상 같다.
   */
  clawMaxX: 3.4,
  clawHomeY: 8.5,
  /**
   * 하강 목표.
   * 발끝이 바닥에 놓인 구슬(상단 y=1.24)보다 아래로 내려가면 구슬을 바닥에 짓눌러
   * 솔버가 바닥 밑으로 밀어내는 사고가 난다(실측: 40회 중 2회, y=-884로 무한 낙하).
   * 발끝 y = clawDropY − pivot(0.435) − armLen(1.044) 이므로 2.9 이상을 유지한다.
   */
  clawDropY: 2.95,
  clawScale: 1.45,
  railY: 11.4,

  gravity: -24,
} as const;

/** 화면 분할 — 상단 3D 필드 / 하단 조작부 (1080×1920 기준) */
export const SCREEN = {
  width: 1080,
  height: 1920,
  fieldHeight: 1344,
  controllerHeight: 576,
} as const;

/**
 * 대기 영상용 카메라.
 *
 * 게임 화면은 1080×1344(가로세로비 0.80)이고 대기화면은 **1080×1920**(0.5625)이다.
 * three의 fov는 세로 기준이라 화면이 세로로 길어지면 **가로 시야가 좁아진다** —
 * 게임용 카메라를 그대로 쓰면 폭 10.5의 캐비닛이 좌우로 잘려 나간다.
 *   가로 반폭 = 거리 × tan(fov/2) × 화면비 = 19 × 0.364 × 0.5625 = 3.89  (필요: 5.25)
 * 거리 27이면 5.53으로 폭 5.25가 여유 0.28을 두고 들어온다(더 당기면 좌우가 잘린다).
 */
export const CAMERA_ATTRACT = {
  fov: 40,
  position: [0, 6.6, 27] as [number, number, number],
  target: [0, 6.2, 0] as [number, number, number],
};

export const CAMERA = {
  fov: 40,
  position: [0, 8.6, 19.0] as [number, number, number],
  target: [0, 6.4, 0] as [number, number, number],
};

/** Aepick 브랜드 토큰 — `Aepick 6core Value` 프로젝트 확정값 */
export const AEPICK = {
  bg0: '#fae2e9',
  bg1: '#fdf2f5',
  accent: '#f25c7c',
  accentDeep: '#e8446b',
  accentSoft: '#fbd7e0',
  gold: '#e8b84b',
  ink: '#26191e',
} as const;

export const THEME = {
  /*
   * 벽 그라데이션 — `tools/wallsweep.mjs`로 레퍼런스와 수치를 맞춘 값.
   *
   * 눈으로 조절하다 함정에 빠졌다. "칙칙하다"는 지적에 벽을 밝게 올렸더니
   * 렌더된 벽이 RGB(255,255,255)로 **포화되어 채도가 0**이 됐는데, 화면에서는
   * 그냥 "밝다"로 보여서 알아채지 못했다. 실제 원인은 벽이 어두운 게 아니라
   * 색을 잃은 것이었다.
   *
   *   레퍼런스 벽   L 84.3% · S 67.4% · 포화 픽셀 0%
   *   확정값        L 85.7% · S 68.1% · 포화 픽셀 0%
   *
   * 밝기가 아니라 **채도**가 화사함을 만든다.
   */
  wallTop: (globalThis as any).__WALL_TOP__ ?? '#eab4cd',
  wallBottom: (globalThis as any).__WALL_BOT__ ?? '#f4cfdf',
  /** 캐비닛 조명등이 들어온 뒤 재측정. 발광이 높으면 조명 기울기를 덮어 벽이 다시 평평해진다 */
  wallEmissive: (globalThis as any).__WALL_EM__ ?? 0.15,
  floorGlow: (globalThis as any).__FLOOR_C__ ?? '#f8ead2',
  floorGlowIntensity: (globalThis as any).__FLOOR_I__ ?? 0.55,
  edgeColor: '#fff4f7',
  edgeGlowIntensity: 1.0,
  bezelColor: AEPICK.accentSoft,
  clawColor: AEPICK.accent,
  /*
   * 금속도 0.85는 확산 성분이 거의 없어, 환경이 조금만 어두워져도 집게가 검붉게 죽는다.
   * 0.58이면 Aepick 핑크가 확산광으로 남으면서 금속 하이라이트도 유지된다.
   */
  clawMetalness: 0.58,
  clawEnvIntensity: 1.15,
} as const;

export const MATERIAL = {
  /*
   * 재질 기본값 — 비주얼 스파이크 패널에서 조절해 확정한 값.
   * 러프니스를 크게 낮춰(0.32→0.07) 구슬이 베이크된 캐비닛 환경을 또렷하게 반사한다.
   * 환경 베이크가 들어간 뒤에야 성립하는 값이다 — 반사할 대상이 없으면 그냥 검게 죽는다.
   */
  ballRoughness: 0.07,
  metalRoughness: 0.2,
  clearcoat: (globalThis as any).__CLEARCOAT__ ?? 0.71,
  ribAmplitude: 0.15,
  ribCount: 12,
  /** 은색 캡슐 비율. 0.26 이상이면 흰색·은색이 화면을 지배한다 */
  metalRatio: 0.18,
  decalRatio: 0.26,
  /**
   * 인쇄 데칼의 러프니스. 구슬(0.07)보다 확실히 높아야 잉크가 표면에 인쇄된 것으로 읽힌다.
   * 같으면 글자가 "표면에 투영된 그림"처럼 보인다.
   */
  inkRoughness: 0.42,
} as const;

export const LIGHTING = {
  /*
   * 키 라이트.
   *
   * 0.45는 "환경광이 셰이딩을 주도한다"는 초기 방침에서 나온 값인데, 실측해 보니
   * 그 방침의 전제가 성립하지 않았다 — 환경 반사의 세기 조절이 구슬에 먹히지 않는다(아래 ENV 주석).
   * 결과적으로 구슬이 저조도에 놓여 분홍 앰비언트 워시가 확산색을 덮었고, 그게 "칙칙함"의 정체였다.
   *
   * `tools/palette.mjs` 실측 (레퍼런스 더미 S 61.8% · L 64.9%):
   *   amb 0.38 · key 0.45 → S 44.0% · L 57.5%
   *   amb 0.10 · key 1.40 → S 51.0% · L 60.3%
   *   amb 0.10 · key 2.00 → S 59.9% · L 64.0%
   *   amb 0.10 · key 1.40 → S 51.9% · L 58.8%   ← 채택
   *
   * 수치만 보면 2.00이 레퍼런스에 가깝지만, 그 값에서는 **벽 픽셀의 97.7%가 포화**된다.
   * 포화 픽셀은 측정에서 제외되므로 밝기를 올려 픽셀을 날려버릴수록 남은 통계가
   * 좋아 보이는 착시가 생긴다 — 실제로 그 함정에 한 번 빠졌다.
   * 포화 없이 얻을 수 있는 최대가 1.40이다.
   */
  keyIntensity: (globalThis as any).__KEY__ ?? 1.4,
  keyOffset: [2, 3, 8] as [number, number, number],
  fillIntensity: (globalThis as any).__FILL__ ?? 0.18,
  /*
   * 앰비언트.
   * 흰 앰비언트는 모든 채널에 같은 값을 더하므로 **채도를 깎는다.**
   * 키 라이트를 올려 확산색이 주도하게 만들고 앰비언트는 낮게 둔다.
   */
  ambientIntensity: (globalThis as any).__AMB__ ?? 0.1,
  envIntensity: (globalThis as any).__ENVI__ ?? 1.5,
  /* NeutralToneMapping은 ACES보다 하이라이트를 덜 접어 같은 노출에서 조금 어둡게 읽힌다 */
  exposure: (globalThis as any).__EXPO__ ?? 1.0,
} as const;

/**
 * 환경·공간감 설정.
 *
 * 절차적 Lightformer만으로는 구슬이 "실제 캐비닛"을 반사하지 못한다.
 * 씬을 큐브맵에 한 번 구워 환경맵으로 쓰면 구슬이 핑크 벽·발광 바닥·로고를 그대로 비춘다.
 * 캐비닛은 정적이므로 1회 굽고 재사용하면 런타임 비용이 없다.
 */
export const ENV = {
  /** 씬 베이크 사용. false면 Lightformer만 쓴다(비교용) */
  bake: (globalThis as any).__ENV_BAKE__ ?? true,
  resolution: 256,
  /** 큐브맵을 찍는 높이 — 더미 상단 부근이 구슬 반사에 가장 자연스럽다 */
  bakeY: 3.0,
  /** 베이크된 환경은 인공 Lightformer보다 어두우므로 세기를 따로 잡는다 */
  /*
   * 베이크 환경 반사 세기.
   *
   * 오랫동안 이 값이 화면에 아무 영향도 주지 않았다("스윕에서 1.45~2.35가 차이를 주지
   * 않는다"고 기록해 뒀던 것이 그 증상이다). 원인은 three가 scene.environment만 쓰는 재질의
   * envMapIntensity를 덮어쓰는 것이었고, 재질에 envMap을 직접 물려 해결했다(Scene.tsx 참조).
   *
   * 살아난 뒤 재탐색 — `tools/palette.mjs` 실측 (레퍼런스 더미 S 61.8% · L 64.9%):
   *   1.9 → S 73.2% · L 74.6%   (과함)
   *   1.2 → S 60.6% · L 67.7%
   *
   * 이후 바닥 라이트바(FLOOR_LIGHT)가 들어오면서 더미가 다시 밝아져 재보정했다.
   *   1.2 → S 65.8% · L 72.2%   (레퍼런스 초과)
   *   1.0 → S 62.1% · L 69.8%   ← 채택
   *   0.85 → S 58.8% · L 67.7%
   */
  bakedIntensity: (globalThis as any).__BAKED__ ?? 1.0,
  /** 캐비닛 전면은 열려 있다. 구울 때 이 색으로 채워 구슬 앞면 반사가 검게 죽는 것을 막는다 */
  openSideColor: '#f6e2ea',
} as const;

/** 공간감 요소 */
export const DEPTH = {
  /** 전면 유리 — 밀폐된 캐비닛으로 읽히게 한다 */
  glass: (globalThis as any).__DEPTH_GLASS__ ?? true,
  glassOpacity: 0.03,
  /**
   * 접지 그림자 — 키 라이트가 약해 구슬이 바닥에 얹힌 느낌이 부족하다.
   * 0.55에 더미보다 넓은 판(깊이 1.35배)을 깔면 벽 하단까지 어두운 구름이 번져
   * 핑크 마감에 얼룩처럼 보인다. AO가 접촉 음영을 이미 만들고 있으므로
   * 이 판은 더미 바로 아래만 눌러주는 역할로 줄인다.
   */
  contactShadow: (globalThis as any).__DEPTH_CS__ ?? true,
  contactShadowOpacity: 0.3,
  contactShadowBlur: 2.4,
  /**
   * 벽 코너 음영.
   * 초기값 0.34는 회색(60,30,45)을 얹어 핑크 마감에 얼룩처럼 보였다.
   * 코너 깊이는 AO와 환경 반사가 만들게 하고 텍스처 음영은 최소로 둔다.
   */
  vignette: (globalThis as any).__DEPTH_VIG__ ?? 0.06,
  /** 벽 반사. 완전 무광이면 조명·구슬이 비치지 않아 회색 그림자만 남는다 */
  wallRoughness: 0.34,
  /*
   * 벽 환경 반사.
   * 파이프라인 수정 전에는 이 값이 통째로 무시되고 있었다(three가 scene.environment 사용 시
   * 재질의 envMapIntensity를 덮어씀). 살아난 뒤 재탐색해 확정.
   */
  wallEnvIntensity: (globalThis as any).__WALL_ENV__ ?? 1.2,
} as const;

/**
 * 벽 재질 — 프로스티드 아크릴.
 *
 * 성능 벤치(docs/07)에서 전면유리·접지그림자가 사실상 0ms였고 dpr 1.0→1.5도 무차이였다.
 * 즉 이 씬은 픽셀 셰이딩에 여유가 크므로 벽에 맵을 세 장 물려도 예산에 영향이 없다.
 */
export const WALL = {
  /** 흑=매끈. 아크릴은 기본적으로 매끈하고, 얼룩진 곳만 반사가 번진다 */
  roughnessBase: 0.16,
  roughnessVariation: 0.34,
  /** 압출 아크릴의 세로결. 키우면 골판지가 된다 */
  normalStrength: 0.1,
  normalRepeat: [3, 6] as [number, number],
  /** 측벽은 정면벽보다 어둡게 — 세 면이 같은 밝기면 공간이 납작해진다 */
  sideTint: 0.88,
  /*
   * 천장은 카메라가 아래에서 올려다보는 유일한 면이라 그라데이션의 밝은 쪽만 보인다.
   * 벽과 같은 밝기(0.94)로 두면 발광 + 블룸 임계(0.9)를 넘겨 순백으로 날아가
   * 상자 위쪽이 종이처럼 보인다. 벽보다 확실히 눌러야 상자로 닫힌다.
   */
  ceilingTint: 0.74,
  /** 천장 디퓨저 — LED 색을 머금은 핑크. 흰색으로 두면 상단이 순백으로 날아간다 */
  lightPanelColor: '#ffdfea',
  lightPanelIntensity: 0.7,
  /**
   * 캐비닛 조명등.
   *
   * 왜 필요한가 — 평평한 벽에 밝기 기울기를 만들 수 있는 광원은 **거리 감쇠가 있는 것뿐**이다.
   * 방향광은 평면을 균일하게 비추고(N·L이 일정), 앰비언트·발광·환경맵도 모두 균일하다.
   * 실측으로 확인했다: 벽 발광을 0.03까지 낮추고 키 라이트를 6.0까지 올려도
   * 좌우 비대칭은 0.0%p, 대비는 오히려 1.23배로 **더 평평해졌다.**
   *
   * 지금 벽이 위보다 아래가 밝은 것(레퍼런스와 반대)도 같은 이유다 —
   * 거리 감쇠가 있는 광원이 바닥 발광용 pointLight 하나뿐이고 그게 아래에 있다.
   *
   *   레퍼런스  명암 대비 1.53~1.75배 · 좌우 비대칭 −8.0%p (왼쪽이 밝음) · 위가 밝음
   *
   * 천장 디퓨저 패널 뒤에 실제 광원을 두는 셈이라 물리적으로도 앞뒤가 맞는다.
   */
  boxLight: {
    position: [
      (globalThis as any).__BL_X__ ?? -2.4,
      (globalThis as any).__BL_Y__ ?? 10.6,
      (globalThis as any).__BL_Z__ ?? 0.8,
    ] as [number, number, number],
    intensity: (globalThis as any).__BL_I__ ?? 110,
    distance: (globalThis as any).__BL_D__ ?? 12,
    decay: (globalThis as any).__BL_DC__ ?? 2,
    color: (globalThis as any).__BL_C__ ?? '#fff1f6',
  },
  /**
   * 정면벽 조명 핫스팟(텍스처에 구움).
   * 조명등만으로 부족한 방향성을 보완한다. 측벽·천장에는 넣지 않는다 —
   * 각자 다른 텍스처를 쓰면 모서리에서 밝기가 튄다.
   */
  hotspotU: (globalThis as any).__HS_U__ ?? 0.24,
  hotspotV: (globalThis as any).__HS_V__ ?? 0.22,
  hotspotRadius: (globalThis as any).__HS_R__ ?? 0.4,
  hotspotStrength: (globalThis as any).__HS_S__ ?? 0.1,
} as const;

/**
 * 바닥 라이트바.
 *
 * 레퍼런스 하단에는 바닥을 따라 밝게 번지는 띠가 있다. 바닥 평면의 발광만 올려서는
 * 재현되지 않는다 — 바닥은 더미에 거의 가려져 보이지 않기 때문이다(세기를 0.55→5.0으로
 * 9배 올려도 하단 밝기가 67.8%→77.2%에 그쳤다).
 *
 * 그래서 **전면 바닥 모서리에 발광 막대**를 놓는다. 구슬 사이로 보이는 띠가 되고,
 * 블룸 임계(0.9)를 넘겨 번진다. 실제 광원도 함께 두어 구슬 아랫면을 비춘다.
 */
export const FLOOR_LIGHT = {
  enabled: (globalThis as any).__FL_ON__ ?? true,
  color: '#fff3e4',
  /** 블룸 임계를 넘어야 "뽀샤시"해진다 */
  intensity: (globalThis as any).__FL_I__ ?? 2.6,
  y: 0.17,
  thickness: 0.26,
  /** 전면에서 안쪽으로 들인 거리 */
  inset: 0.5,
  /** 구슬 아랫면을 실제로 비추는 광원 */
  lampIntensity: (globalThis as any).__FL_LAMP__ ?? 24,
  lampDistance: 9,
} as const;

export const POST = {
  bloomIntensity: (globalThis as any).__BLOOMI__ ?? 0.32,
  bloomThreshold: 0.9,
  bloomSmoothing: 0.35,
  /*
   * 피사계심도 — **전 품질 단계에서 끔**(QUALITY.high.dof = false).
   *
   * "구슬이 흐리다"는 지적을 받고 재보니 DOF가 선명도를 **6배** 깎고 있었다.
   * 라플라시안 분산(클수록 또렷) 실측:
   *   보케 1.4 (당시 값) →  53
   *   보케 0.4           → 160
   *   DOF 끔             → 311
   *
   * 보케를 낮춰도 절반밖에 회복되지 않는데, 더 큰 문제는 **초점 거리를 조절할 수 없다는 것**이다 —
   * dofFocalLength를 0.02·0.05·0.08로 바꿔도 결과가 완전히 동일했다(미해결 파이프라인 문제와 같은 증상).
   * 초점면을 놓을 수 없는 블러는 깊이 표현이 아니라 그냥 흐림이다.
   * 성능도 0.80ms 돌려받는다. 파이프라인 문제가 풀리면 재검토한다.
   */
  dofFocalLength: (globalThis as any).__DOF_F__ ?? 0.02,
  dofBokehScale: (globalThis as any).__DOF_B__ ?? 1.4,
  /** 초점 월드 좌표 — 더미 상단과 집게 하강 구간 사이 */
  dofTarget: [0, 3.6, 1.2] as [number, number, number],
  /*
   * AO 세기·반경.
   *
   * 뒷벽에 구슬 그림자처럼 보이는 어두운 띠가 생긴다는 지적이 있었다.
   * 원인은 그림자가 아니라 **화면공간 AO**다 — 앞 물체 실루엣 주변의 배경 픽셀이
   * 물체의 깊이를 샘플링해 어두워지는, SSAO 특유의 후광이다.
   * (방향광 캐스트 섀도는 무관함을 확인했다: 벽의 그림자 수신을 껐다 켜도 수치가 동일했다.)
   *
   * 벽 단차 실측 — 벽 위 대비 더미 바로 위의 휘도 차:
   *   r 1.00 · f 1.0 · i 1.6 → 7.4%p   (지적된 상태)
   *   r 0.40 · f 3.0 · i 1.6 → 4.6%p
   *   r 0.30 · f 4.0 · i 0.8 → 3.1%p   ← 채택
   *   AO 끔                  → 2.3%p   (벽 자체 그라데이션. 이것이 하한)
   *
   * 반경을 구슬 반지름(0.62)보다 작게 잡아 AO가 구슬끼리의 접촉에만 걸리고
   * 2.5유닛 뒤의 벽까지 번지지 않게 한다. 하한과의 차이는 0.8%p로 눈에 띄지 않는다.
   */
  aoIntensity: (globalThis as any).__AO_I__ ?? 0.8,
  /**
   * AO 반경(월드 단위).
   * 1.0은 구슬 반지름(0.62)보다 커서 **뒷벽까지 물든다** — 화면공간 AO 특유의
   * "앞 물체 주변 배경이 어두워지는" 후광이 생긴다. 레퍼런스 벽에는 그런 것이 없다.
   */
  aoRadius: (globalThis as any).__AO_R__ ?? 0.3,
  /** 깊이 차가 큰 표면 사이의 AO를 줄인다. 값이 클수록 먼 배경에 덜 번진다 */
  aoFalloff: (globalThis as any).__AO_F__ ?? 4.0,
  /**
   * AO 색.
   * 기본값은 검정이라 핑크 마감 위에 얹히면 **회색 얼룩**이 된다 — 레퍼런스의 그림자는
   * 벽 색을 머금은 자주빛이다. 같은 계열의 진한 색으로 어둡게 하면 칙칙해지지 않는다.
   */
  aoColor: '#5e2438',
} as const;

/**
 * 캡슐 색과 등장 빈도.
 *
 * `tools/palette.mjs`로 레퍼런스와 현재 화면의 지배색을 같은 방법으로 클러스터링해 맞춘 값.
 * 렌더된 색은 알베도가 아니다(조명·환경 반사·톤 매핑을 거친다) — 그래서 양쪽을 같은
 * 방법으로 재고 차이만큼 알베도를 옮겼다.
 *
 *   레퍼런스 더미  S 61.8% · L 64.9%
 *   이전 팔레트    S 47.3% · L 50.2%   ← 어둡고 탁했다
 *
 * 두 가지를 바꿨다.
 *  1) 각 색을 더 밝고 선명하게. 렌더가 채도를 약 20포인트 떨어뜨리므로 알베도는 그만큼 높게 잡는다.
 *  2) **밝은 색의 비중을 올렸다.** 평균 밝기는 색 자체보다 분포가 좌우한다 —
 *     이전에는 가장 어두운 빨강이 전체 가중치의 29%를 차지했다.
 */
export const BALL_PALETTE: { color: string; weight: number }[] = [
  { color: '#f9564a', weight: 3.6 }, // 빨강
  { color: '#fbfaff', weight: 2.4 }, // 흰색
  { color: '#56b4fa', weight: 3.0 }, // 하늘
  { color: '#9ee256', weight: 2.6 }, // 라임 — 이전의 어두운 초록(#4cb85c)을 대체
  { color: '#f7ef7e', weight: 3.4 }, // 노랑 — 비중 상향
  { color: '#bb90f2', weight: 2.0 }, // 보라
  { color: '#5ce8ce', weight: 1.2 }, // 민트
  { color: '#fd85c6', weight: 1.0 }, // 분홍
];

export const METAL_COLOR = '#dfe4ea';

const CUM_WEIGHTS = (() => {
  const out: number[] = [];
  let acc = 0;
  for (const p of BALL_PALETTE) {
    acc += p.weight;
    out.push(acc);
  }
  return out;
})();

export function pickColorIndex(r: number): number {
  const total = CUM_WEIGHTS[CUM_WEIGHTS.length - 1]!;
  const x = r * total;
  for (let i = 0; i < CUM_WEIGHTS.length; i++) {
    if (x < CUM_WEIGHTS[i]!) return i;
  }
  return CUM_WEIGHTS.length - 1;
}

export type BallKind = 'smooth' | 'ribbed' | 'coiled';

/** 저사양 대비 품질 단계 — §13 프레임 저하 시 자동 축소 */
export interface QualityLevel {
  dpr: number;
  bloom: boolean;
  dof: boolean;
  ao: boolean;
  shadows: boolean;
}

/*
 * 벤치마크용 개별 토글.
 * 효과별 단가를 재려면 하나씩 켜고 끌 수 있어야 한다. globalThis 오버라이드는
 * `?debug=1` 같은 기존 디버그 수단과 같은 성격이며, 값이 없으면 기본값을 쓴다.
 */
const qo = <T,>(key: string, def: T): T => {
  const v = (globalThis as Record<string, unknown>)[`__Q_${key}__`];
  return (v === undefined ? def : v) as T;
};

export const QUALITY: Record<'high' | 'mid' | 'low', QualityLevel> = {
  high: {
    dpr: qo('DPR', 1.5),
    bloom: qo('BLOOM', true),
    dof: qo('DOF', false),
    ao: qo('AO', true),
    shadows: qo('SHADOWS', true),
  },
  mid: { dpr: 1.2, bloom: true, dof: false, ao: true, shadows: true },
  low: { dpr: 1.0, bloom: true, dof: false, ao: false, shadows: false },
};

/** 벤치마크에서 구슬 수를 바꿔 한계 지점을 찾는다 */
export function resolveBallCount(fromServer: number): number {
  const v = (globalThis as Record<string, unknown>).__BALL_COUNT__;
  return typeof v === 'number' ? v : fromServer;
}
