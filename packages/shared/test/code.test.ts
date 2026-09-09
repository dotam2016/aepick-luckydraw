import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  CLAIM_CODE_ALPHABET,
  CLAIM_CODE_LENGTH,
  CLAIM_CODE_SPACE,
  generateClaimCode,
  isValidClaimCode,
  normalizeClaimCode,
} from '../src/index.js';
import { findMissingKeys } from '../src/index.js';

const rb = (n: number) => new Uint8Array(randomBytes(n));

describe('세션 코드 (§10.3)', () => {
  it('혼동 문자를 포함하지 않는다', () => {
    for (const ch of '01ILO') {
      expect(CLAIM_CODE_ALPHABET).not.toContain(ch);
    }
    expect(CLAIM_CODE_ALPHABET.length).toBe(31);
    expect(CLAIM_CODE_SPACE).toBe(887_503_681);
  });

  it('항상 6자리 유효 코드를 생성한다', () => {
    for (let i = 0; i < 2000; i++) {
      const code = generateClaimCode(rb);
      expect(code).toHaveLength(CLAIM_CODE_LENGTH);
      expect(isValidClaimCode(code)).toBe(true);
    }
  });

  it('문자 분포에 뚜렷한 편향이 없다', () => {
    const counts = new Map<string, number>();
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      for (const ch of generateClaimCode(rb)) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    const total = N * CLAIM_CODE_LENGTH;
    const expectedPer = total / CLAIM_CODE_ALPHABET.length;
    for (const ch of CLAIM_CODE_ALPHABET) {
      const c = counts.get(ch) ?? 0;
      // 기대값의 ±12% 이내
      expect(c).toBeGreaterThan(expectedPer * 0.88);
      expect(c).toBeLessThan(expectedPer * 1.12);
    }
  });

  it('20만 개 생성 시 중복이 없다 (유니크 인덱스 부담 확인)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200_000; i++) seen.add(generateClaimCode(rb));
    // 생일 문제상 887M 공간에서 20만 개면 기대 충돌 약 22개 — 실제 운영 규모(수천)에서는 사실상 0
    expect(seen.size).toBeGreaterThan(199_900);
  });

  it('운영자 입력을 정규화한다 — 추측 교정은 하지 않는다', () => {
    expect(normalizeClaimCode(' ab-cd2 3 ')).toBe('ABCD23');
    expect(normalizeClaimCode('abcd23xyz')).toBe('ABCD23');
    // 혼동 문자는 유효 코드가 아니므로 그대로 실패해야 한다
    expect(isValidClaimCode(normalizeClaimCode('ABCD0I'))).toBe(false);
  });
});

describe('i18n 완전성 (§14 현지화)', () => {
  it('모든 로케일이 동일한 키 집합을 갖는다', () => {
    const missing = findMissingKeys();
    expect(missing).toEqual({ vi: [], en: [], ko: [] });
  });
});
