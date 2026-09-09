import { describe, expect, it } from 'vitest';
import {
  ALL_TIERS,
  DEFAULT_PROBABILITIES,
  TOTAL_MILLI,
  allAvailable,
  drawResult,
  fromMilli,
  seededRng,
  toMilliMap,
  WIN_TIERS,
  type ResultTier,
  type TierAvailability,
  type WinTier,
} from '../src/index.js';

function availabilityWith(blocked: Partial<Record<WinTier, TierAvailability>>) {
  return { ...allAvailable(), ...blocked };
}

describe('추첨 엔진 — 확률 정합성', () => {
  it('실효 확률 합계는 항상 100.000%를 유지한다', () => {
    const cases = [
      availabilityWith({}),
      availabilityWith({ t1: { available: false, reason: 'noStock' } }),
      availabilityWith({
        t1: { available: false, reason: 'noStock' },
        t2: { available: false, reason: 'pacingQuota' },
        t3: { available: false, reason: 'dailyCap' },
      }),
    ];

    for (const policy of ['toMiss', 'renormalize'] as const) {
      for (const availability of cases) {
        const out = drawResult({
          probabilities: DEFAULT_PROBABILITIES,
          depletionPolicy: policy,
          availability,
          rng: seededRng(1),
        });
        const sum = ALL_TIERS.reduce((acc, t) => acc + out.effectiveMilli[t], 0);
        expect(sum).toBe(TOTAL_MILLI);
      }
    }
  });

  it('차단된 등급은 절대 당첨되지 않는다 (§16.1)', () => {
    const availability = availabilityWith({
      t1: { available: false, reason: 'noStock' },
      t2: { available: false, reason: 'inactive' },
      t3: { available: false, reason: 'pacingQuota' },
    });
    const rng = seededRng(42);

    for (let i = 0; i < 20_000; i++) {
      const out = drawResult({
        probabilities: DEFAULT_PROBABILITIES,
        depletionPolicy: 'toMiss',
        availability,
        rng,
      });
      expect(['t4', 't5', 'miss']).toContain(out.tier);
    }
  });

  it('toMiss 정책은 회수분 전액을 꽝에 귀속한다 (§5.3)', () => {
    const out = drawResult({
      probabilities: DEFAULT_PROBABILITIES,
      depletionPolicy: 'toMiss',
      availability: availabilityWith({
        t1: { available: false, reason: 'noStock' }, // 1%
        t2: { available: false, reason: 'noStock' }, // 4%
      }),
      rng: seededRng(7),
    });

    expect(out.effectiveMilli.t1).toBe(0);
    expect(out.effectiveMilli.t2).toBe(0);
    expect(fromMilli(out.effectiveMilli.miss)).toBe(35); // 30 + 5
    expect(fromMilli(out.effectiveMilli.t5)).toBe(35); // 변화 없음
  });

  it('renormalize 정책은 남은 결과에 비례 배분한다 (§5.3)', () => {
    const out = drawResult({
      probabilities: DEFAULT_PROBABILITIES,
      depletionPolicy: 'renormalize',
      availability: availabilityWith({ t1: { available: false, reason: 'noStock' } }),
      rng: seededRng(7),
    });

    expect(out.effectiveMilli.t1).toBe(0);
    // 회수 1%가 나머지(4+10+20+35+30=99)에 비례 배분되므로 모든 등급이 증가한다
    expect(out.effectiveMilli.t5).toBeGreaterThan(toMilliMap(DEFAULT_PROBABILITIES).t5);
    expect(out.effectiveMilli.miss).toBeGreaterThan(toMilliMap(DEFAULT_PROBABILITIES).miss);
    const sum = ALL_TIERS.reduce((acc, t) => acc + out.effectiveMilli[t], 0);
    expect(sum).toBe(TOTAL_MILLI);
  });

  it('모든 당첨 등급이 차단되면 꽝이 100%가 된다', () => {
    const availability = {} as Record<WinTier, TierAvailability>;
    for (const t of WIN_TIERS) availability[t] = { available: false, reason: 'noStock' };

    for (const policy of ['toMiss', 'renormalize'] as const) {
      const out = drawResult({
        probabilities: DEFAULT_PROBABILITIES,
        depletionPolicy: policy,
        availability,
        rng: seededRng(3),
      });
      expect(out.tier).toBe('miss');
      expect(out.effectiveMilli.miss).toBe(TOTAL_MILLI);
    }
  });

  it('차단 사유를 감사용으로 기록한다', () => {
    const out = drawResult({
      probabilities: DEFAULT_PROBABILITIES,
      depletionPolicy: 'toMiss',
      availability: availabilityWith({
        t1: { available: false, reason: 'eventCap' },
        t3: { available: false, reason: 'pacingQuota' },
      }),
      rng: seededRng(11),
    });
    expect(out.blocked).toEqual({ t1: 'eventCap', t3: 'pacingQuota' });
  });
});

describe('추첨 엔진 — 분포 검증 (§16.3)', () => {
  it('10만 회 추첨의 실제 분포가 설정 확률과 허용 편차 내에서 일치한다', () => {
    const N = 100_000;
    const rng = seededRng(20260805);
    const counts = {} as Record<ResultTier, number>;
    for (const t of ALL_TIERS) counts[t] = 0;

    for (let i = 0; i < N; i++) {
      const out = drawResult({
        probabilities: DEFAULT_PROBABILITIES,
        depletionPolicy: 'toMiss',
        availability: allAvailable(),
        rng,
      });
      counts[out.tier]++;
    }

    const expected = toMilliMap(DEFAULT_PROBABILITIES);
    for (const tier of ALL_TIERS) {
      const p = expected[tier] / TOTAL_MILLI;
      const observed = counts[tier] / N;
      // 이항분포 표준편차의 4배를 허용 편차로 둔다 (양측 p<0.0001)
      const sigma = Math.sqrt((p * (1 - p)) / N);
      expect(Math.abs(observed - p)).toBeLessThan(4 * sigma + 1e-9);
    }

    // 총합 확인 — 어떤 추첨도 유실되지 않는다
    expect(ALL_TIERS.reduce((a, t) => a + counts[t], 0)).toBe(N);
  });

  it('같은 시드는 같은 결과 수열을 만든다 (재현성 — §10.1 random_token)', () => {
    const run = () => {
      const rng = seededRng(999);
      return Array.from({ length: 500 }, () =>
        drawResult({
          probabilities: DEFAULT_PROBABILITIES,
          depletionPolicy: 'toMiss',
          availability: allAvailable(),
          rng,
        }).tier,
      );
    };
    expect(run()).toEqual(run());
  });
});
