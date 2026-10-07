/**
 * 기본값 — 기획서 v1.1 §4 (게임 설정), §5.2 (확률 프로필)
 *
 * §5.2 명시: 아래 확률은 개발·시뮬레이션용 기본값이며 실제 행사 확률이 아니다.
 */

import { DEFAULT_PACING } from './pacing.js';
import type {
  DepletionPolicy,
  EventConfig,
  GameConfig,
  SpeedPreset,
  TierProbability,
  WinTier,
} from './types.js';

export const DEFAULT_PROBABILITIES: TierProbability[] = [
  { tier: 't1', probability: 1 },
  { tier: 't2', probability: 4 },
  { tier: 't3', probability: 10 },
  { tier: 't4', probability: 20 },
  { tier: 't5', probability: 35 },
  { tier: 'miss', probability: 30 },
];

export const DEFAULT_DEPLETION_POLICY: DepletionPolicy = 'toMiss';

/**
 * 매일 0시(Asia/Ho_Chi_Minh)에 자동으로 복원되는 실제 행사 기본 확률.
 * 운영팀 확정값 — 1등 10% / 2등 20% / 3등 35% / 4,5등 미사용(0%) / 꽝 35%.
 */
export const DAILY_RESET_PROBABILITIES: TierProbability[] = [
  { tier: 't1', probability: 10 },
  { tier: 't2', probability: 20 },
  { tier: 't3', probability: 35 },
  { tier: 't4', probability: 0 },
  { tier: 't5', probability: 0 },
  { tier: 'miss', probability: 35 },
];

/**
 * 매일 0시(Asia/Ho_Chi_Minh)에 자동으로 복원되는 등급별 일일 재고 기본값.
 * 운영팀 확정값 — 지정되지 않은 등급(4,5등)은 자동 리셋 대상이 아니다.
 */
export const DAILY_RESET_PRIZE_QTY: Partial<Record<WinTier, number>> = {
  t1: 150,
  t2: 300,
  t3: 525,
};

export const DEFAULT_GAME_CONFIG: GameConfig = {
  aimSeconds: 12,
  speedPreset: 'normal',
  timeoutBehavior: 'autoCatch',
  resultSecondsWin: 12,
  resultSecondsMiss: 5,
  // §4.3 — 2주차 A/B 검증 후 확정. 기본값은 물리 불일치 리스크가 낮은 B안.
  revealMode: 'capsuleOpen',
  // 구슬을 하트 모양으로 바꾸며 반지름을 2배로 키웠다(apps/kiosk/src/game/layout.ts
  // WORLD.ballRadius) — 부피가 8배라 이전 밀도(78)를 유지하면 더미가 상자를
  // 넘친다. validateGameConfig가 허용하는 최소값(25)으로 낮췄다.
  ballCount: 25,
  bgmVolume: 0.5,
  sfxVolume: 0.8,
  effectQuality: 'auto',
};

/** §4 좌우 이동 속도 프리셋 — 화면 폭 기준 왕복 횟수/초 */
export const SPEED_PRESETS: Record<SpeedPreset, number> = {
  slow: 0.4,
  normal: 0.55,
  fast: 0.75,
};

/** §7.2 권고 타이밍 (ms). 물리 연출 구간 길이 */
export const MOTION_TIMING = {
  catchFeedback: 150,
  inertiaSettle: 300,
  drop: 1000,
  closeAndCollide: 420,
  lift: 980,
  reveal: 600,
} as const;

export const DEFAULT_EVENT_CONFIG: Omit<EventConfig, 'openAt' | 'closeAt'> = {
  eventOn: true,
  emergencyStop: false,
  claimTtlHours: 24,
  offlineGraceSeconds: 60,
};

export { DEFAULT_PACING };
