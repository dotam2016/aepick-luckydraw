/**
 * AEPICK Lucky Draw — 공유 도메인 타입
 * 기획서 v1.1 §5, §10, §11, 부록 A·B 대응
 */

/* ---------- 결과 등급 ---------- */

export type WinTier = 't1' | 't2' | 't3' | 't4' | 't5';
export type ResultTier = WinTier | 'miss';

export const WIN_TIERS: readonly WinTier[] = ['t1', 't2', 't3', 't4', 't5'];
export const ALL_TIERS: readonly ResultTier[] = [...WIN_TIERS, 'miss'];

export function isWinTier(t: ResultTier): t is WinTier {
  return t !== 'miss';
}

/** 등급 표시 순서용 라벨 키 (i18n 키와 1:1) */
export const TIER_LABEL_KEY: Record<ResultTier, string> = {
  t1: 'tier.t1',
  t2: 'tier.t2',
  t3: 'tier.t3',
  t4: 'tier.t4',
  t5: 'tier.t5',
  miss: 'tier.miss',
};

/* ---------- 확률: milli-percent 정수 연산 ----------
 * 기획서 §5.2 — 확률(%)은 소수점 3자리까지. 부동소수 드리프트를 막기 위해
 * 내부 계산은 전부 milli-percent 정수(0 ~ 100000)로 수행한다.
 */

export const PCT_SCALE = 1000;
export const TOTAL_MILLI = 100 * PCT_SCALE;

export function toMilli(percent: number): number {
  return Math.round(percent * PCT_SCALE);
}

export function fromMilli(milli: number): number {
  return milli / PCT_SCALE;
}

export interface TierProbability {
  tier: ResultTier;
  /** 퍼센트. 소수점 3자리까지 허용 */
  probability: number;
}

/* ---------- 설정 버전 ---------- */

export type DepletionPolicy = 'toMiss' | 'renormalize';

export interface PacingConfig {
  enabled: boolean;
  /** 페이싱을 적용할 등급. 기본 1~3등 (§5.4) */
  tiers: WinTier[];
  /** 쿼터 버킷 길이(분). 기본 60 */
  bucketMinutes: number;
  /** 미소진 쿼터를 다음 버킷으로 이월할지. 기본 true */
  carryOver: boolean;
  /** 마감 N분 전부터 쿼터 해제(잔여 재배분). 기본 120 */
  finalReleaseMinutes: number;
}

export interface RuleVersion {
  versionId: number;
  probabilities: TierProbability[];
  depletionPolicy: DepletionPolicy;
  pacing: PacingConfig;
  publishedAt: string;
  publishedBy: string;
  reason: string;
}

/* ---------- 경품 / 재고 (§5.5) ---------- */

export type Locale = 'vi' | 'en' | 'ko';
export const LOCALES: readonly Locale[] = ['vi', 'en', 'ko'];

export type LocalizedText = Record<Locale, string>;

export interface Prize {
  prizeId: string;
  tier: WinTier;
  name: LocalizedText;
  imageKey: string | null;
  totalQty: number;
  /** available — 추첨 가능 재고 */
  remainingQty: number;
  /** reserved — 당첨 확정, 지급 전 */
  reservedQty: number;
  /** claimed — 지급 완료 */
  claimedQty: number;
  /** 일일 당첨 상한. null이면 무제한 */
  dailyCap: number | null;
  /** 행사 전체 당첨 상한. null이면 무제한 */
  eventCap: number | null;
  active: boolean;
}

/* ---------- 세션 상태 (부록 B — Layer 2) ---------- */

export type SessionStatus =
  | 'CREATED'
  | 'DRAWN'
  | 'PLAYED'
  | 'PENDING_CLAIM'
  | 'CLAIMED'
  | 'VOIDED'
  | 'EXPIRED'
  | 'ABORTED';

export const TERMINAL_STATUSES: readonly SessionStatus[] = ['CLAIMED', 'VOIDED', 'EXPIRED', 'ABORTED'];

export function isTerminal(s: SessionStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}

/** 부록 B 전이표. 허용되지 않은 전이는 서버에서 거부한다. */
export const SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  CREATED: ['DRAWN', 'ABORTED', 'VOIDED'],
  DRAWN: ['PLAYED', 'ABORTED', 'VOIDED'],
  PLAYED: ['PENDING_CLAIM', 'CLAIMED'],
  PENDING_CLAIM: ['CLAIMED', 'VOIDED', 'EXPIRED'],
  CLAIMED: [],
  VOIDED: [],
  EXPIRED: ['CLAIMED', 'VOIDED'],
  ABORTED: [],
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

/* ---------- 화면 상태 (부록 A — Layer 1) ---------- */

export type ScreenState =
  | 'WAITING'
  | 'SESSION_PREPARE'
  | 'READY'
  | 'AIM'
  | 'DROP'
  | 'GRAB'
  | 'LIFT'
  | 'REVEAL'
  | 'RESULT'
  | 'OPERATOR_HOLD';

/* ---------- 세션 / 추첨 / 지급 ---------- */

export interface SessionRecord {
  sessionId: string;
  deviceId: string;
  operatorId: string;
  isTest: boolean;
  ruleVersion: number;
  status: SessionStatus;
  createdAt: string;
  playedAt: string | null;
  closedAt: string | null;
  expiresAt: string | null;
}

export interface DrawRecord {
  sessionId: string;
  resultTier: ResultTier;
  prizeId: string | null;
  randomToken: string;
  /** 페이싱/재고로 차단된 등급과 사유 — 감사용 (§5.4) */
  blockedTiers: Partial<Record<WinTier, BlockReason>>;
  rollMilli: number;
}

export interface ClaimRecord {
  sessionId: string;
  claimCode: string | null;
  claimStatus: SessionStatus;
  claimedAt: string | null;
  claimedBy: string | null;
  voidReason: string | null;
}

export interface PlayMetric {
  sessionId: string;
  aimDurationMs: number;
  catchX: number;
  autoCatch: boolean;
  minFps: number;
  fpsBucket: string;
  physicsSeed: number;
}

/* ---------- 추첨 엔진 입출력 (§5.1, §5.3) ---------- */

export type BlockReason = 'inactive' | 'noStock' | 'dailyCap' | 'eventCap' | 'pacingQuota';

export interface TierAvailability {
  available: boolean;
  reason?: BlockReason;
}

export interface DrawInput {
  probabilities: TierProbability[];
  depletionPolicy: DepletionPolicy;
  availability: Record<WinTier, TierAvailability>;
  /** [0, 1) 균등 난수 */
  rng: () => number;
}

export interface DrawOutcome {
  tier: ResultTier;
  /** 차단·재분배가 반영된 실제 사용 확률 (milli-percent) */
  effectiveMilli: Record<ResultTier, number>;
  blocked: Partial<Record<WinTier, BlockReason>>;
  rollMilli: number;
}

/* ---------- 게임 설정 (§4) ---------- */

export type SpeedPreset = 'slow' | 'normal' | 'fast';
export type TimeoutBehavior = 'autoCatch' | 'failSession';
/** §4.3 결과 공개 연출 A/B */
export type RevealMode = 'grabMiss' | 'capsuleOpen';

export interface GameConfig {
  aimSeconds: number;
  speedPreset: SpeedPreset;
  timeoutBehavior: TimeoutBehavior;
  resultSecondsWin: number;
  resultSecondsMiss: number;
  revealMode: RevealMode;
  ballCount: number;
  bgmVolume: number;
  sfxVolume: number;
  effectQuality: 'high' | 'mid' | 'low' | 'auto';
}

/* ---------- 행사 운영 설정 ---------- */

export interface EventConfig {
  eventOn: boolean;
  emergencyStop: boolean;
  /** ISO 8601. 당일 운영 시작/종료 — 페이싱 계산의 기준 */
  openAt: string;
  closeAt: string;
  /** 미지급 세션 만료 시간(시간 단위). 기본 24 */
  claimTtlHours: number;
  /** 네트워크 단절 허용 시간(초). 초과 시 신규 플레이 차단 (§12) */
  offlineGraceSeconds: number;
}

/* ---------- API DTO ---------- */

export interface CreateSessionRequest {
  idempotencyKey: string;
  deviceId: string;
  operatorId: string;
  isTest?: boolean;
  /** 테스트 세션에서만 허용 — 등급 강제 지정 (§5.6) */
  forceTier?: ResultTier;
}

/**
 * 물리 연출 제어에 필요한 최소 정보 (§11.1).
 * 등급·경품명·코드는 포함하지 않는다 — 클라이언트가 결과를 미리 알거나 바꿀 수 없게 한다.
 */
export interface MotionPlan {
  win: boolean;
  /** 미획득 연출 변형 인덱스 (0~2) — §16.2 최소 3종 */
  missVariant: number;
  /** 결과 화면 효과 강도. 등급을 노출하지 않으면서 연출 차별화만 가능하게 한다 */
  effectLevel: 1 | 2 | 3;
  revealMode: RevealMode;
}

export interface CreateSessionResponse {
  sessionId: string;
  /** REVEAL 시점에 결과 상세를 조회할 때 제시하는 1회용 토큰 */
  resultToken: string;
  motion: MotionPlan;
  ruleVersion: number;
  physicsSeed: number;
  game: GameConfig;
  isTest: boolean;
  createdAt: string;
}

/** REVEAL 시점에만 조회되는 결과 상세. resultToken 없이는 얻을 수 없다. */
export interface RevealPlan {
  win: boolean;
  tier: ResultTier;
  prize: { tier: WinTier; name: LocalizedText; imageKey: string | null } | null;
  claimCode: string | null;
  effectLevel: 1 | 2 | 3;
  isTest: boolean;
  resultSeconds: number;
}

export interface PlayedRequest {
  aimDurationMs: number;
  catchX: number;
  autoCatch: boolean;
  minFps: number;
  physicsSeed: number;
}

export interface PendingClaimItem {
  sessionId: string;
  claimCode: string;
  tier: WinTier;
  prizeName: LocalizedText;
  deviceId: string;
  playedAt: string;
  expiresAt: string;
  elapsedMinutes: number;
}
