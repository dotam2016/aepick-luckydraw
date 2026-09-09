import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_CONFIG,
  DEFAULT_PACING,
  DEFAULT_PROBABILITIES,
  validateGameConfig,
  validatePacing,
  validateProbabilities,
  type TierProbability,
} from '../src/index.js';

describe('확률 설정 검증 (§5.3 / §16.1)', () => {
  it('기본 프로필은 유효하다', () => {
    expect(validateProbabilities(DEFAULT_PROBABILITIES).ok).toBe(true);
  });

  it('합계가 100.000%가 아니면 거부한다', () => {
    const bad: TierProbability[] = [
      { tier: 't1', probability: 1 },
      { tier: 't2', probability: 4 },
      { tier: 't3', probability: 10 },
      { tier: 't4', probability: 20 },
      { tier: 't5', probability: 35 },
      { tier: 'miss', probability: 29.5 },
    ];
    const r = validateProbabilities(bad);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'total')).toBe(true);
  });

  it('소수점 3자리 초과를 거부한다', () => {
    const bad = DEFAULT_PROBABILITIES.map((p) =>
      p.tier === 't1' ? { ...p, probability: 1.00005 } : p,
    );
    const r = validateProbabilities(bad);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('소수점 3자리'))).toBe(true);
  });

  it('소수점 3자리는 허용한다', () => {
    const ok: TierProbability[] = [
      { tier: 't1', probability: 0.125 },
      { tier: 't2', probability: 4 },
      { tier: 't3', probability: 10 },
      { tier: 't4', probability: 20 },
      { tier: 't5', probability: 35 },
      { tier: 'miss', probability: 30.875 },
    ];
    expect(validateProbabilities(ok).ok).toBe(true);
  });

  it('음수 확률을 거부한다', () => {
    const bad = DEFAULT_PROBABILITIES.map((p) => (p.tier === 't1' ? { ...p, probability: -1 } : p));
    expect(validateProbabilities(bad).ok).toBe(false);
  });

  it('등급 누락을 거부한다', () => {
    const bad = DEFAULT_PROBABILITIES.filter((p) => p.tier !== 't3');
    const r = validateProbabilities(bad);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 't3')).toBe(true);
  });

  it('등급 중복을 거부한다', () => {
    const bad = [...DEFAULT_PROBABILITIES, { tier: 't1' as const, probability: 0 }];
    const r = validateProbabilities(bad);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('중복'))).toBe(true);
  });
});

describe('페이싱 설정 검증', () => {
  it('기본값은 유효하다', () => {
    expect(validatePacing(DEFAULT_PACING).ok).toBe(true);
  });

  it('버킷 길이 범위를 강제한다', () => {
    expect(validatePacing({ ...DEFAULT_PACING, bucketMinutes: 1 }).ok).toBe(false);
    expect(validatePacing({ ...DEFAULT_PACING, bucketMinutes: 999 }).ok).toBe(false);
  });
});

describe('게임 설정 검증 (§4)', () => {
  it('기본값은 유효하다', () => {
    expect(validateGameConfig(DEFAULT_GAME_CONFIG).ok).toBe(true);
  });

  it('조준 시간 8~20초 범위를 강제한다', () => {
    expect(validateGameConfig({ ...DEFAULT_GAME_CONFIG, aimSeconds: 7 }).ok).toBe(false);
    expect(validateGameConfig({ ...DEFAULT_GAME_CONFIG, aimSeconds: 21 }).ok).toBe(false);
    expect(validateGameConfig({ ...DEFAULT_GAME_CONFIG, aimSeconds: 8 }).ok).toBe(true);
  });

  it('구슬 수 범위를 강제한다 — PC 타깃 확정으로 상한 140', () => {
    expect(validateGameConfig({ ...DEFAULT_GAME_CONFIG, ballCount: 24 }).ok).toBe(false);
    expect(validateGameConfig({ ...DEFAULT_GAME_CONFIG, ballCount: 141 }).ok).toBe(false);
    expect(validateGameConfig({ ...DEFAULT_GAME_CONFIG, ballCount: 78 }).ok).toBe(true);
  });
});
