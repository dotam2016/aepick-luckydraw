/**
 * 추첨 엔진 — 기획서 v1.1 §5.1 / §5.3
 *
 * 제1원칙: 결과는 이 함수가 결정한다. 물리 시뮬레이션은 결정된 결과를 표현할 뿐이다.
 * 모든 확률 연산은 milli-percent 정수로 수행해 부동소수 드리프트를 배제한다.
 */

import {
  ALL_TIERS,
  WIN_TIERS,
  TOTAL_MILLI,
  toMilli,
  type BlockReason,
  type DrawInput,
  type DrawOutcome,
  type ResultTier,
  type TierProbability,
  type WinTier,
} from './types.js';

/** 확률 배열을 milli-percent 맵으로 변환. 누락 등급은 0으로 채운다. */
export function toMilliMap(probabilities: TierProbability[]): Record<ResultTier, number> {
  const map = {} as Record<ResultTier, number>;
  for (const tier of ALL_TIERS) map[tier] = 0;
  for (const p of probabilities) map[p.tier] = toMilli(p.probability);
  return map;
}

export function drawResult(input: DrawInput): DrawOutcome {
  const { depletionPolicy, availability, rng } = input;
  const effective = toMilliMap(input.probabilities);

  /* 1. 차단된 등급의 확률을 회수한다 */
  const blocked: Partial<Record<WinTier, BlockReason>> = {};
  let freed = 0;

  for (const tier of WIN_TIERS) {
    const a = availability[tier];
    if (a && a.available) continue;
    if (effective[tier] > 0) freed += effective[tier];
    effective[tier] = 0;
    blocked[tier] = a?.reason ?? 'inactive';
  }

  /* 2. 소진 정책에 따라 회수분을 배분한다 (§5.3) */
  if (freed > 0) {
    if (depletionPolicy === 'toMiss') {
      // 기본 정책: 다른 경품에 재분배하지 않고 꽝에 귀속
      effective.miss += freed;
    } else {
      // 선택 정책: 남은 활성 결과끼리 비례 재정규화
      const survivors = ALL_TIERS.filter((t) => effective[t] > 0);
      const weights = survivors.map((t) => effective[t]);
      const weightSum = weights.reduce((a, b) => a + b, 0);

      if (weightSum === 0) {
        effective.miss = TOTAL_MILLI;
      } else {
        let distributed = 0;
        survivors.forEach((tier, i) => {
          // 마지막 항목이 잔여를 모두 흡수해 합계 오차를 0으로 만든다
          const add =
            i === survivors.length - 1
              ? freed - distributed
              : Math.floor((freed * weights[i]) / weightSum);
          effective[tier] += add;
          distributed += add;
        });
      }
    }
  }

  /* 3. 추첨 */
  const total = ALL_TIERS.reduce((sum, t) => sum + effective[t], 0);
  const rollMilli = Math.floor(rng() * total);

  let cursor = 0;
  let picked: ResultTier = 'miss';
  for (const tier of ALL_TIERS) {
    cursor += effective[tier];
    if (rollMilli < cursor) {
      picked = tier;
      break;
    }
  }

  return { tier: picked, effectiveMilli: effective, blocked, rollMilli };
}

/**
 * 모든 등급이 사용 가능한 상태를 만든다. 테스트·시뮬레이터 편의용.
 */
export function allAvailable(): Record<WinTier, import('./types.js').TierAvailability> {
  const map = {} as Record<WinTier, import('./types.js').TierAvailability>;
  for (const tier of WIN_TIERS) map[tier] = { available: true };
  return map;
}

/**
 * 결정론적 난수 생성기 (mulberry32).
 * 시뮬레이터와 물리 연출 랜덤화의 재현성을 위해 사용한다 (§7.3).
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
