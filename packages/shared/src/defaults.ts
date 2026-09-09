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

export const DEFAULT_GAME_CONFIG: GameConfig = {
  aimSeconds: 12,
  speedPreset: 'normal',
  timeoutBehavior: 'autoCatch',
  resultSecondsWin: 12,
  resultSecondsMiss: 5,
  // §4.3 — 2주차 A/B 검증 후 확정. 기본값은 물리 불일치 리스크가 낮은 B안.
  revealMode: 'capsuleOpen',
  // PC 타깃으로 확정되어 상향. 레퍼런스 밀도에 맞춘 값(비주얼 스파이크 확정).
  ballCount: 78,
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
