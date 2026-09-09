/**
 * 시간대 페이싱 — 기획서 v1.1 §5.4 (신규)
 *
 * 문제: 소진분을 꽝에 귀속시키는 정책만 쓰면 재고가 참여자 수보다 적을 때
 *       행사 후반 꽝률이 100%에 수렴한다.
 * 해결: 등급별 잔여 재고를 남은 시간 버킷 수로 나눠 버킷당 당첨 상한을 둔다.
 *       carryOver=true인 경우 "잔여 재고 / 남은 버킷 수"가 이월을 자연히 표현한다.
 */

import type { PacingConfig, WinTier } from './types.js';

export const DEFAULT_PACING: PacingConfig = {
  enabled: true,
  tiers: ['t1', 't2', 't3'],
  bucketMinutes: 60,
  carryOver: true,
  finalReleaseMinutes: 120,
};

export interface BucketWindow {
  index: number;
  start: Date;
  end: Date;
  /** 이 버킷을 포함해 마감까지 남은 버킷 수 (최소 1) */
  bucketsRemaining: number;
  totalBuckets: number;
}

/** now이 속한 버킷을 계산한다. openAt을 기준점으로 bucketMinutes 단위로 자른다. */
export function resolveBucket(now: Date, openAt: Date, closeAt: Date, bucketMinutes: number): BucketWindow {
  const bucketMs = Math.max(1, bucketMinutes) * 60_000;
  const spanMs = Math.max(bucketMs, closeAt.getTime() - openAt.getTime());
  const totalBuckets = Math.ceil(spanMs / bucketMs);

  const offset = now.getTime() - openAt.getTime();
  const rawIndex = Math.floor(offset / bucketMs);
  const index = Math.min(Math.max(rawIndex, 0), totalBuckets - 1);

  const start = new Date(openAt.getTime() + index * bucketMs);
  const end = new Date(Math.min(start.getTime() + bucketMs, closeAt.getTime()));

  return {
    index,
    start,
    end,
    bucketsRemaining: Math.max(1, totalBuckets - index),
    totalBuckets,
  };
}

export interface QuotaInput {
  pacing: PacingConfig;
  tier: WinTier;
  now: Date;
  openAt: Date;
  closeAt: Date;
  /** 현재 잔여 available 재고 */
  remainingQty: number;
  /** 당일 운영 시작 시점의 available 재고 (carryOver=false일 때 사용) */
  dayStartQty: number;
}

/**
 * 현재 버킷의 당첨 허용 수량. Infinity면 페이싱 제약 없음.
 */
export function bucketQuota(input: QuotaInput): number {
  const { pacing, tier, now, openAt, closeAt, remainingQty, dayStartQty } = input;

  if (!pacing.enabled) return Infinity;
  if (!pacing.tiers.includes(tier)) return Infinity;
  if (remainingQty <= 0) return 0;

  // 마감 N분 전부터는 쿼터를 해제해 잔여 재고 미소진을 방지한다
  const releaseAt = closeAt.getTime() - pacing.finalReleaseMinutes * 60_000;
  if (now.getTime() >= releaseAt) return Infinity;

  const win = resolveBucket(now, openAt, closeAt, pacing.bucketMinutes);

  if (pacing.carryOver) {
    // 잔여 재고를 남은 버킷에 균등 배분 → 미소진분이 자동으로 이월된다
    return Math.max(1, Math.ceil(remainingQty / win.bucketsRemaining));
  }
  // 고정 쿼터: 운영 시작 시점 재고를 전체 버킷 수로 나눈 값
  return Math.max(1, Math.ceil(dayStartQty / win.totalBuckets));
}

export interface PacingCheckInput extends QuotaInput {
  /** 현재 버킷에서 이미 확정된 해당 등급 당첨 수 */
  winsInBucket: number;
}

/** 페이싱 쿼터로 이번 추첨에서 해당 등급을 차단해야 하는지 */
export function isPacingBlocked(input: PacingCheckInput): boolean {
  const quota = bucketQuota(input);
  if (quota === Infinity) return false;
  return input.winsInBucket >= quota;
}
