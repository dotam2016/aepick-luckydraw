/**
 * 설정 검증 — 기획서 v1.1 §5.3 / §9.3
 *
 * "확률 합계가 100.000%가 아니면 설정을 게시할 수 없다" (§16.1 인수 기준)를
 * 게시 경로에서 강제하는 단일 진입점.
 */

import {
  ALL_TIERS,
  PCT_SCALE,
  TOTAL_MILLI,
  WIN_TIERS,
  toMilli,
  type GameConfig,
  type PacingConfig,
  type TierProbability,
} from './types.js';

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export function validateProbabilities(probabilities: TierProbability[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  for (const p of probabilities) {
    if (!ALL_TIERS.includes(p.tier)) {
      issues.push({ field: p.tier, message: `알 수 없는 등급: ${p.tier}` });
      continue;
    }
    if (seen.has(p.tier)) {
      issues.push({ field: p.tier, message: `등급이 중복되었습니다: ${p.tier}` });
    }
    seen.add(p.tier);

    if (!Number.isFinite(p.probability) || p.probability < 0) {
      issues.push({ field: p.tier, message: '확률은 0 이상이어야 합니다.' });
      continue;
    }
    if (p.probability > 100) {
      issues.push({ field: p.tier, message: '확률은 100을 넘을 수 없습니다.' });
    }
    // 소수점 3자리 초과 거부
    if (Math.abs(p.probability * PCT_SCALE - Math.round(p.probability * PCT_SCALE)) > 1e-9) {
      issues.push({ field: p.tier, message: '확률은 소수점 3자리까지만 허용됩니다.' });
    }
  }

  for (const tier of ALL_TIERS) {
    if (!seen.has(tier)) {
      issues.push({ field: tier, message: `${tier} 확률이 누락되었습니다.` });
    }
  }

  const sum = probabilities.reduce((acc, p) => acc + toMilli(p.probability), 0);
  if (sum !== TOTAL_MILLI) {
    issues.push({
      field: 'total',
      message: `확률 합계는 100.000%여야 합니다. 현재 ${(sum / PCT_SCALE).toFixed(3)}%`,
    });
  }

  return { ok: issues.length === 0, issues };
}

export function validatePacing(pacing: PacingConfig): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (pacing.bucketMinutes < 5 || pacing.bucketMinutes > 240) {
    issues.push({ field: 'bucketMinutes', message: '버킷 길이는 5~240분 사이여야 합니다.' });
  }
  if (pacing.finalReleaseMinutes < 0 || pacing.finalReleaseMinutes > 480) {
    issues.push({ field: 'finalReleaseMinutes', message: '쿼터 해제 시점은 0~480분 사이여야 합니다.' });
  }
  for (const tier of pacing.tiers) {
    if (!WIN_TIERS.includes(tier)) {
      issues.push({ field: 'tiers', message: `페이싱 대상은 당첨 등급만 가능합니다: ${tier}` });
    }
  }
  return { ok: issues.length === 0, issues };
}

export function validateGameConfig(cfg: GameConfig): ValidationResult {
  const issues: ValidationIssue[] = [];

  // §4 어드민 설정 범위
  if (cfg.aimSeconds < 8 || cfg.aimSeconds > 20) {
    issues.push({ field: 'aimSeconds', message: '조준 시간은 8~20초 사이여야 합니다.' });
  }
  if (cfg.resultSecondsWin < 5 || cfg.resultSecondsWin > 20) {
    issues.push({ field: 'resultSecondsWin', message: '당첨 결과 노출은 5~20초 사이여야 합니다.' });
  }
  if (cfg.resultSecondsMiss < 3 || cfg.resultSecondsMiss > 20) {
    issues.push({ field: 'resultSecondsMiss', message: '꽝 결과 노출은 3~20초 사이여야 합니다.' });
  }
  if (cfg.ballCount < 25 || cfg.ballCount > 140) {
    // 기획서 §7.3은 Android 태블릿 전제로 25~40이었다.
    // 실기기가 PC로 확정되어 상한을 올렸다. 하한은 더미가 빈약해지는 지점.
    issues.push({ field: 'ballCount', message: '구슬 수는 25~140개 사이여야 합니다.' });
  }
  for (const key of ['bgmVolume', 'sfxVolume'] as const) {
    const v = cfg[key];
    if (v < 0 || v > 1) issues.push({ field: key, message: '볼륨은 0~1 사이여야 합니다.' });
  }
  return { ok: issues.length === 0, issues };
}

export function mergeValidation(...results: ValidationResult[]): ValidationResult {
  const issues = results.flatMap((r) => r.issues);
  return { ok: issues.length === 0, issues };
}
