import { describe, expect, it } from 'vitest';
import { DEFAULT_PACING, bucketQuota, isPacingBlocked, resolveBucket } from '../src/index.js';

const OPEN = new Date('2026-09-01T10:00:00Z');
const CLOSE = new Date('2026-09-01T20:00:00Z'); // 10시간 = 10개 버킷(60분)

describe('시간대 페이싱 — 버킷 계산', () => {
  it('운영 시간을 bucketMinutes 단위로 자른다', () => {
    const b = resolveBucket(new Date('2026-09-01T10:30:00Z'), OPEN, CLOSE, 60);
    expect(b.index).toBe(0);
    expect(b.totalBuckets).toBe(10);
    expect(b.bucketsRemaining).toBe(10);
  });

  it('중간 시점의 남은 버킷 수를 정확히 센다', () => {
    const b = resolveBucket(new Date('2026-09-01T16:10:00Z'), OPEN, CLOSE, 60);
    expect(b.index).toBe(6);
    expect(b.bucketsRemaining).toBe(4);
  });

  it('운영 시간 밖 시각은 양 끝 버킷으로 클램프한다', () => {
    expect(resolveBucket(new Date('2026-09-01T08:00:00Z'), OPEN, CLOSE, 60).index).toBe(0);
    expect(resolveBucket(new Date('2026-09-01T23:00:00Z'), OPEN, CLOSE, 60).index).toBe(9);
  });
});

describe('시간대 페이싱 — 쿼터', () => {
  const base = {
    pacing: DEFAULT_PACING,
    tier: 't1' as const,
    openAt: OPEN,
    closeAt: CLOSE,
    dayStartQty: 10,
  };

  it('페이싱 미적용 등급은 제약이 없다', () => {
    const q = bucketQuota({ ...base, tier: 't5', now: OPEN, remainingQty: 10 });
    expect(q).toBe(Infinity);
  });

  it('페이싱이 꺼져 있으면 제약이 없다', () => {
    const q = bucketQuota({
      ...base,
      pacing: { ...DEFAULT_PACING, enabled: false },
      now: OPEN,
      remainingQty: 10,
    });
    expect(q).toBe(Infinity);
  });

  it('잔여 재고를 남은 버킷에 균등 배분한다', () => {
    // 10개 재고 / 10개 버킷 = 버킷당 1개
    expect(bucketQuota({ ...base, now: OPEN, remainingQty: 10 })).toBe(1);
    // 첫 버킷에서 아무도 안 타갔다면 다음 버킷은 10/9 → 2 (이월 효과)
    expect(bucketQuota({ ...base, now: new Date('2026-09-01T11:00:00Z'), remainingQty: 10 })).toBe(2);
  });

  it('마감 N분 전부터 쿼터를 해제해 미소진을 방지한다 (§5.4)', () => {
    // finalReleaseMinutes=120 → 18:00 이후 해제
    expect(bucketQuota({ ...base, now: new Date('2026-09-01T17:59:00Z'), remainingQty: 5 })).not.toBe(
      Infinity,
    );
    expect(bucketQuota({ ...base, now: new Date('2026-09-01T18:00:00Z'), remainingQty: 5 })).toBe(
      Infinity,
    );
  });

  it('carryOver=false는 운영 시작 재고 기준 고정 쿼터를 쓴다', () => {
    const pacing = { ...DEFAULT_PACING, carryOver: false };
    const early = bucketQuota({ ...base, pacing, now: OPEN, remainingQty: 10, dayStartQty: 10 });
    const late = bucketQuota({
      ...base,
      pacing,
      now: new Date('2026-09-01T15:00:00Z'),
      remainingQty: 3,
      dayStartQty: 10,
    });
    expect(early).toBe(1);
    expect(late).toBe(1); // 잔여와 무관하게 고정
  });

  it('재고가 없으면 쿼터는 0이다', () => {
    expect(bucketQuota({ ...base, now: OPEN, remainingQty: 0 })).toBe(0);
  });
});

describe('시간대 페이싱 — 차단 판정', () => {
  const base = {
    pacing: DEFAULT_PACING,
    tier: 't1' as const,
    openAt: OPEN,
    closeAt: CLOSE,
    dayStartQty: 10,
    remainingQty: 10,
    now: OPEN,
  };

  it('쿼터 미달이면 차단하지 않는다', () => {
    expect(isPacingBlocked({ ...base, winsInBucket: 0 })).toBe(false);
  });

  it('쿼터를 채우면 해당 버킷에서 차단한다', () => {
    expect(isPacingBlocked({ ...base, winsInBucket: 1 })).toBe(true);
  });

  it('해제 시점 이후에는 쿼터를 채웠어도 차단하지 않는다', () => {
    expect(
      isPacingBlocked({ ...base, now: new Date('2026-09-01T19:00:00Z'), winsInBucket: 99 }),
    ).toBe(false);
  });

  it('후반 꽝률 수렴 방지 시나리오 — 초반 폭주를 실제로 막는다', () => {
    // 재고 5개, 10버킷. 첫 버킷에서 5명이 연속 당첨 시도
    let remaining = 5;
    let winsInBucket = 0;
    let granted = 0;

    for (let i = 0; i < 20; i++) {
      const blocked = isPacingBlocked({
        ...base,
        remainingQty: remaining,
        dayStartQty: 5,
        winsInBucket,
      });
      if (!blocked) {
        granted++;
        remaining--;
        winsInBucket++;
      }
    }
    // 첫 버킷에서는 ceil(5/10)=1개만 나가야 한다
    expect(granted).toBe(1);
    expect(remaining).toBe(4);
  });
});
