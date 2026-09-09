/**
 * 추첨 시뮬레이터 — 기획서 v1.1 §15.2
 *
 * 설정 확률·재고·시간대별 참여자 분포를 입력받아 등급별 분포, 소진 시점,
 * 시간대별 당첨률 곡선을 출력한다. 시간대 페이싱(§5.4) 파라미터를 확정하는 근거 자료.
 *
 * 사용:
 *   npm run sim -w server
 *   npm run sim -w server -- --visitors 1200 --iterations 200 --no-pacing
 */

import {
  ALL_TIERS,
  DEFAULT_DEPLETION_POLICY,
  DEFAULT_PACING,
  DEFAULT_PROBABILITIES,
  TOTAL_MILLI,
  WIN_TIERS,
  allAvailable,
  drawResult,
  isPacingBlocked,
  isWinTier,
  resolveBucket,
  seededRng,
  toMilliMap,
  type DepletionPolicy,
  type PacingConfig,
  type ResultTier,
  type TierAvailability,
  type WinTier,
} from '@aepick/shared';

/* ---------- 인자 ---------- */

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const VISITORS = Number(arg('visitors', '900'));
const ITERATIONS = Number(arg('iterations', '300'));
const OPEN_HOUR = Number(arg('open', '10'));
const CLOSE_HOUR = Number(arg('close', '20'));
const SEED = Number(arg('seed', '20260805'));
const USE_PACING = !flag('no-pacing');
const POLICY: DepletionPolicy = flag('renormalize') ? 'renormalize' : DEFAULT_DEPLETION_POLICY;

/** 등급별 재고 — 실제 행사 값으로 교체해 검증한다 */
const STOCK: Record<WinTier, number> = {
  t1: Number(arg('t1', '3')),
  t2: Number(arg('t2', '10')),
  t3: Number(arg('t3', '30')),
  t4: Number(arg('t4', '120')),
  t5: Number(arg('t5', '300')),
};

const DAILY_CAP: Record<WinTier, number | null> = { t1: 1, t2: 3, t3: 8, t4: null, t5: null };

const PACING_TIERS = arg('pacing-tiers', DEFAULT_PACING.tiers.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter((s): s is WinTier => WIN_TIERS.includes(s as WinTier));

const PACING: PacingConfig = { ...DEFAULT_PACING, enabled: USE_PACING, tiers: PACING_TIERS };

/** 방문자 시간 분포 — 팝업은 점심·저녁에 몰린다고 가정 */
const HOUR_WEIGHTS = [0.6, 0.9, 1.4, 1.3, 0.9, 0.8, 1.0, 1.3, 1.5, 1.1];

/* ---------- 시뮬레이션 ---------- */

interface RunResult {
  counts: Record<ResultTier, number>;
  hourlyWinRate: number[];
  depletedAtVisitor: Partial<Record<WinTier, number>>;
  leftover: Record<WinTier, number>;
  lastHourWinRate: number;
}

function buildArrivalHours(total: number, rng: () => number): number[] {
  const hours = CLOSE_HOUR - OPEN_HOUR;
  const weights = Array.from({ length: hours }, (_, i) => HOUR_WEIGHTS[i % HOUR_WEIGHTS.length]!);
  const sum = weights.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  for (let h = 0; h < hours; h++) {
    const n = Math.round((weights[h]! / sum) * total);
    for (let i = 0; i < n; i++) out.push(h);
  }
  while (out.length < total) out.push(hours - 1);
  return out.slice(0, total).sort((a, b) => a - b);
}

function runOnce(seed: number): RunResult {
  const rng = seededRng(seed);
  const stock: Record<WinTier, number> = { ...STOCK };
  const dayStart: Record<WinTier, number> = { ...STOCK };
  const dailyWins: Record<WinTier, number> = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };
  const bucketWins = new Map<string, number>();

  const counts = {} as Record<ResultTier, number>;
  for (const t of ALL_TIERS) counts[t] = 0;

  const hours = CLOSE_HOUR - OPEN_HOUR;
  const hourPlays = new Array(hours).fill(0);
  const hourWins = new Array(hours).fill(0);

  const base = new Date('2026-09-01T00:00:00Z');
  const openAt = new Date(base.getTime() + OPEN_HOUR * 3_600_000);
  const closeAt = new Date(base.getTime() + CLOSE_HOUR * 3_600_000);

  const arrivals = buildArrivalHours(VISITORS, rng);
  const depletedAtVisitor: Partial<Record<WinTier, number>> = {};

  arrivals.forEach((hourOffset, idx) => {
    // 해당 시간 내 균등 도착
    const now = new Date(openAt.getTime() + hourOffset * 3_600_000 + rng() * 3_600_000);
    const bucket = resolveBucket(now, openAt, closeAt, PACING.bucketMinutes);

    const availability = allAvailable();
    for (const tier of WIN_TIERS) {
      const entry: TierAvailability = { available: true };
      if (stock[tier] <= 0) {
        entry.available = false;
        entry.reason = 'noStock';
      } else if (DAILY_CAP[tier] !== null && dailyWins[tier] >= DAILY_CAP[tier]!) {
        entry.available = false;
        entry.reason = 'dailyCap';
      } else {
        const key = `${tier}:${bucket.index}`;
        const winsInBucket = bucketWins.get(key) ?? 0;
        if (
          isPacingBlocked({
            pacing: PACING,
            tier,
            now,
            openAt,
            closeAt,
            remainingQty: stock[tier],
            dayStartQty: dayStart[tier],
            winsInBucket,
          })
        ) {
          entry.available = false;
          entry.reason = 'pacingQuota';
        }
      }
      availability[tier] = entry;
    }

    const outcome = drawResult({
      probabilities: DEFAULT_PROBABILITIES,
      depletionPolicy: POLICY,
      availability,
      rng,
    });

    counts[outcome.tier]++;
    hourPlays[hourOffset]++;

    if (isWinTier(outcome.tier)) {
      const tier = outcome.tier;
      stock[tier]--;
      dailyWins[tier]++;
      const key = `${tier}:${bucket.index}`;
      bucketWins.set(key, (bucketWins.get(key) ?? 0) + 1);
      hourWins[hourOffset]++;
      if (stock[tier] === 0 && depletedAtVisitor[tier] === undefined) {
        depletedAtVisitor[tier] = idx + 1;
      }
    }
  });

  const hourlyWinRate = hourPlays.map((p, i) => (p ? hourWins[i] / p : 0));
  return {
    counts,
    hourlyWinRate,
    depletedAtVisitor,
    leftover: stock,
    lastHourWinRate: hourlyWinRate[hourlyWinRate.length - 1] ?? 0,
  };
}

/* ---------- 순수 확률 분포 검증 (§16.3) ---------- */

function distributionCheck(n: number): void {
  const rng = seededRng(SEED + 1);
  const counts = {} as Record<ResultTier, number>;
  for (const t of ALL_TIERS) counts[t] = 0;

  for (let i = 0; i < n; i++) {
    const out = drawResult({
      probabilities: DEFAULT_PROBABILITIES,
      depletionPolicy: 'toMiss',
      availability: allAvailable(),
      rng,
    });
    counts[out.tier]++;
  }

  const expected = toMilliMap(DEFAULT_PROBABILITIES);
  console.log(`\n■ 확률 분포 검증 — ${n.toLocaleString()}회 (재고 무제한)`);
  console.log('  등급    설정 %     실제 %     편차       4σ 허용');
  let allPass = true;
  for (const tier of ALL_TIERS) {
    const p = expected[tier] / TOTAL_MILLI;
    const observed = counts[tier] / n;
    const sigma = Math.sqrt((p * (1 - p)) / n);
    const dev = observed - p;
    const pass = Math.abs(dev) < 4 * sigma;
    if (!pass) allPass = false;
    console.log(
      `  ${tier.padEnd(6)}${(p * 100).toFixed(3).padStart(8)}%${(observed * 100).toFixed(3).padStart(11)}%` +
        `${(dev * 100 >= 0 ? '+' : '') + (dev * 100).toFixed(3)}%`.padStart(11) +
        `${(4 * sigma * 100).toFixed(3)}%`.padStart(12) +
        (pass ? '  OK' : '  FAIL'),
    );
  }
  console.log(`  판정: ${allPass ? '통과' : '실패'}`);
}

/* ---------- 실행 ---------- */

console.log('AEPICK Lucky Draw — 추첨 시뮬레이터');
console.log(
  `설정: 방문자 ${VISITORS}명 × ${ITERATIONS}회 반복 · 운영 ${OPEN_HOUR}~${CLOSE_HOUR}시 · ` +
    `정책 ${POLICY} · 페이싱 ${USE_PACING ? 'ON' : 'OFF'}`,
);
console.log(`재고: ${WIN_TIERS.map((t) => `${t}=${STOCK[t]}`).join(' ')}`);

distributionCheck(100_000);

const runs: RunResult[] = [];
for (let i = 0; i < ITERATIONS; i++) runs.push(runOnce(SEED + i * 7919));

const avg = (nums: number[]) => nums.reduce((a, b) => a + b, 0) / nums.length;

console.log(`\n■ 행사 시뮬레이션 — 재고·상한·페이싱 적용`);
console.log('  등급    평균 당첨   설정 기대   평균 잔여   소진 시점(평균 n번째 방문자)');
for (const tier of WIN_TIERS) {
  const wins = avg(runs.map((r) => r.counts[tier]));
  const expectedWins = (DEFAULT_PROBABILITIES.find((p) => p.tier === tier)!.probability / 100) * VISITORS;
  const leftover = avg(runs.map((r) => r.leftover[tier]));
  const depleted = runs.map((r) => r.depletedAtVisitor[tier]).filter((v): v is number => v !== undefined);
  const depletedStr = depleted.length
    ? `${Math.round(avg(depleted))} (${Math.round((depleted.length / ITERATIONS) * 100)}% 확률로 소진)`
    : '미소진';
  console.log(
    `  ${tier.padEnd(6)}${wins.toFixed(1).padStart(10)}${expectedWins.toFixed(1).padStart(12)}` +
      `${leftover.toFixed(1).padStart(12)}   ${depletedStr}`,
  );
}
const missAvg = avg(runs.map((r) => r.counts.miss));
console.log(`  ${'miss'.padEnd(6)}${missAvg.toFixed(1).padStart(10)}  (꽝률 ${((missAvg / VISITORS) * 100).toFixed(1)}%)`);

console.log(`\n■ 시간대별 당첨률 곡선 — 후반 붕괴 여부 확인 (§5.4)`);
const hours = CLOSE_HOUR - OPEN_HOUR;
for (let h = 0; h < hours; h++) {
  const rate = avg(runs.map((r) => r.hourlyWinRate[h] ?? 0));
  const bar = '█'.repeat(Math.round(rate * 40));
  console.log(`  ${String(OPEN_HOUR + h).padStart(2, '0')}시  ${(rate * 100).toFixed(1).padStart(5)}%  ${bar}`);
}

const lastRate = avg(runs.map((r) => r.lastHourWinRate));
const firstRate = avg(runs.map((r) => r.hourlyWinRate[0] ?? 0));
console.log(`\n  첫 시간 당첨률 ${(firstRate * 100).toFixed(1)}% → 마지막 시간 ${(lastRate * 100).toFixed(1)}%`);
if (lastRate < firstRate * 0.5) {
  console.log('  ⚠ 후반 당첨률이 초반의 절반 미만입니다. 재고 증량 또는 페이싱 조정을 검토하세요.');
} else {
  console.log('  ✓ 후반 당첨률이 초반 대비 50% 이상 유지됩니다.');
}
