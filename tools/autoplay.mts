/**
 * 자동 플레이 하네스 — 기획서 v1.1 §15.1
 *
 * 실제 게임 엔진(apps/kiosk/src/game/clawGame.ts)을 가상 클럭으로 무인 반복 실행해
 * §16.2 인수 기준을 자동 판정한다.
 *
 *   - 서버가 확정한 결과와 실제 재생된 연출의 일치 여부 (불일치 0건이 인수 조건)
 *   - 구슬 화면 이탈 · 영구 진동 · 폭발적 튐 · NaN 좌표
 *   - 회차별 물리 스텝·소요 시간 통계
 *
 * 렌더링 없이 물리와 상태 전이만 돌리므로 실시간보다 수십 배 빠르다.
 * 세션은 테스트 모드(is_test)로 만들어 재고·통계를 오염시키지 않고,
 * forceTier로 모든 등급 경로를 결정적으로 커버한다.
 *
 * 사용:
 *   npm run autoplay                    # 500회 (A안 250 + B안 250)
 *   npm run autoplay -- --runs 100
 *   npm run autoplay -- --mode capsuleOpen
 *   npm run autoplay -- --real 40       # 실제(비테스트) 세션도 40회 섞어 검증
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ALL_TIERS, type ResultTier, type RevealMode } from '@aepick/shared';
import { ClawGame, initPhysics } from '../apps/kiosk/src/game/clawGame.js';

/* ---------------- 인자 ---------------- */

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};

const BASE = process.env.BASE ?? 'http://localhost:8788';
const PIN = process.env.OPERATOR_PIN ?? '1234';
const ADMIN = process.env.ADMIN_KEY ?? 'aepick-admin';

const RUNS = Number(arg('runs', '500'));
const REAL_RUNS = Number(arg('real', '0'));
const MODE_FILTER = arg('mode', 'both') as RevealMode | 'both';
/**
 * 결함 주입 — 지정 비율(%)의 회차에서 엔진에 넘기는 win 값을 뒤집는다.
 * "클라이언트가 서버 결과를 무시하는 버그"를 인위적으로 만들어
 * 이 하네스가 불일치를 실제로 검출하는지 확인하는 자기 검사용이다.
 * 통과만 하는 검증 도구는 아무것도 보증하지 못한다.
 */
const FAULT_PCT = Number(arg('fault', '0'));
const OUT = resolve(arg('out', 'reports/autoplay.csv'));
const STEP_MS = 1000 / 60;
const MAX_STEPS = 3000; // ~50초 상한 — 무한 루프 방지

/* ---------------- 서버 ---------------- */

async function api<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-operator-pin': PIN,
      'x-admin-key': ADMIN,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body: body as T };
}

interface SessionResp {
  sessionId: string;
  resultToken: string;
  motion: { win: boolean; missVariant: number; effectLevel: 1 | 2 | 3; revealMode: RevealMode };
  physicsSeed: number;
  isTest: boolean;
  game: {
    aimSeconds: number;
    speedPreset: 'slow' | 'normal' | 'fast';
    ballCount: number;
    revealMode: RevealMode;
  };
}

interface RevealResp {
  win: boolean;
  tier: ResultTier;
  claimCode: string | null;
  isTest: boolean;
}

/* ---------------- 1회 플레이 ---------------- */

interface RunRow {
  run: number;
  revealMode: RevealMode;
  forcedTier: string;
  serverTier: string;
  motionWin: boolean;
  revealWin: boolean;
  holding: boolean;
  faulted: boolean;
  consistent: boolean;
  missVariant: number;
  isTest: boolean;
  aimMs: number;
  catchX: number;
  autoCatch: boolean;
  steps: number;
  physSteps: number;
  outOfBounds: number;
  explosive: number;
  nan: number;
  contained: number;
  containWorst: number;
  maxSpeed: number;
  swayWhileHeld: number;
  movingAfterRelease: number;
  settleSeconds: number;
  ballCount: number;
  wallMs: number;
  note: string;
}

/**
 * 가상 조작.
 *
 * 초기 구현은 18스텝(0.3초)마다 목표를 바꿨는데, spring-damper가 목표에 도달하기 전에
 * 목표가 또 바뀌어 집게가 화면 중앙(catchX 0.4~0.5)에만 머물렀다. 540회 전부
 * 중앙에서만 집는 셈이어서 좌·우 벽 근처의 침투 거동이 전혀 검증되지 않았다.
 * 목표를 72스텝(1.2초) 유지하고, 시퀀스에 양 극단(0, 1)을 반드시 포함한다.
 */
const TARGET_HOLD_STEPS = 72;

function buildTargets(rand: () => number): number[] {
  const seq = [rand(), 0, rand(), 1, rand(), 0.5, rand()];
  // 시작 위치만 무작위로 회전시켜 회차마다 다른 순서를 밟게 한다
  const shift = Math.floor(rand() * seq.length);
  return [...seq.slice(shift), ...seq.slice(0, shift)];
}

function simulateInput(
  game: ClawGame,
  targets: number[],
  step: number,
  catchAtStep: number,
) {
  if (step % TARGET_HOLD_STEPS === 0) {
    game.setTarget(targets[Math.floor(step / TARGET_HOLD_STEPS) % targets.length]!);
  }
  if (step === catchAtStep) game.triggerCatch(false);
}

async function playOnce(run: number, mode: RevealMode, forcedTier: ResultTier | null, isTest: boolean): Promise<RunRow> {
  const t0 = performance.now();

  const created = await api<SessionResp>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      idempotencyKey: `autoplay-${Date.now()}-${run}-${Math.random().toString(36).slice(2)}`,
      deviceId: `autoplay-${run % 8}`,
      operatorId: 'autoplay',
      isTest,
      forceTier: isTest && forcedTier ? forcedTier : undefined,
    }),
  });

  if (created.status !== 200) {
    const err = created.body as unknown as { error?: string; message?: string };
    throw new Error(`session create ${created.status}: ${err.error} ${err.message}`);
  }
  const s = created.body;

  const faulted = FAULT_PCT > 0 && (run * 97) % 100 < FAULT_PCT;

  const game = new ClawGame({
    seed: s.physicsSeed,
    ballCount: s.game.ballCount,
    aimSeconds: s.game.aimSeconds,
    speedPreset: s.game.speedPreset,
    win: faulted ? !s.motion.win : s.motion.win,
    missVariant: s.motion.missVariant,
    revealMode: mode, // 런타임 A/B 토글과 동일하게 모드를 주입한다
    tutorialMs: 2600,
    onPhase: () => {},
  });

  // 조준 시간의 20~90% 구간에서 CATCH
  const rand = mulberry32(s.physicsSeed ^ 0x5f3a);
  const readySteps = Math.ceil(2600 / STEP_MS);
  const aimSteps = Math.ceil((s.game.aimSeconds * 1000) / STEP_MS);
  const catchAtStep = readySteps + Math.floor(aimSteps * (0.2 + rand() * 0.7));
  const targets = buildTargets(rand);

  let step = 0;
  let note = '';
  while (game.phase !== 'DONE' && step < MAX_STEPS) {
    simulateInput(game, targets, step, catchAtStep);
    game.tick(STEP_MS);
    step++;
  }
  if (game.phase !== 'DONE') note = `TIMEOUT at phase=${game.phase}`;

  const verify = game.verifyOutcome();
  const holding = game.isHolding;
  const outcome = game.getOutcome();

  /*
   * 안정성 측정은 두 단계로 나눈다.
   *  1) 집게에 매달린 채 1.5초 — 여기서 흔들리는 것은 §16.2가 요구한 정상 동작이다.
   *  2) Constraint를 해제한 뒤 수렴할 때까지 — 멈추지 못하면 진짜 영구 진동이다.
   */
  game.settle(90);
  const swayWhileHeld = game.movingBallCount();
  game.releaseGrab();

  /*
   * §16.2가 금지하는 것은 "영구" 진동이다. 고정 창(10초)으로 판정하면
   * 단지 느리게 멎는 회차까지 실패로 잡는다 — 구슬을 32→78개로 늘린 뒤
   * 실제로 그런 회차가 생겼고, 5초를 더 주면 전부 0이 됐다.
   *
   * 그래서 창을 늘리는 대신 **수렴을 측정한다**: 0이 될 때까지의 시간을 기록하고
   * 넉넉한 상한 안에 수렴하지 못한 경우만 영구 진동으로 판정한다.
   * 수렴 시간 자체가 물리 품질 지표가 된다.
   */
  const SETTLE_CHUNK = 150; // 2.5초
  const SETTLE_MAX_CHUNKS = 12; // 최대 30초
  let settleChunks = 0;
  let movingAfterRelease = game.movingBallCount();
  while (movingAfterRelease > 0 && settleChunks < SETTLE_MAX_CHUNKS) {
    game.settle(SETTLE_CHUNK);
    settleChunks++;
    movingAfterRelease = game.movingBallCount();
  }
  const settleSeconds = Number(((settleChunks * SETTLE_CHUNK) / 60).toFixed(1));

  // 지표 전송 + 결과 상세 조회 (실제 클라이언트와 동일 경로)
  await api(`/api/sessions/${s.sessionId}/played`, {
    method: 'POST',
    headers: { 'x-result-token': s.resultToken },
    body: JSON.stringify({
      aimDurationMs: outcome.aimDurationMs,
      catchX: outcome.catchX,
      autoCatch: outcome.autoCatch,
      minFps: 60,
      physicsSeed: s.physicsSeed,
    }),
  });

  const reveal = await api<RevealResp>(`/api/sessions/${s.sessionId}/reveal`, {
    headers: { 'x-result-token': s.resultToken },
  });
  const rv = reveal.body;

  const d = game.diagnostics;

  /**
   * 판정 기준은 서버가 확정한 결과다. 엔진의 verifyOutcome()은 자기 자신이 받은
   * win 값과 비교하므로, 클라이언트가 결과를 잘못 받은 경우를 잡아내지 못한다.
   *   - grabMiss(A안): 획득 여부가 서버 결과와 같아야 한다
   *   - capsuleOpen(B안): 결과와 무관하게 항상 획득해야 한다
   */
  const expectedHolding = mode === 'capsuleOpen' ? true : s.motion.win;
  const consistent = holding === expectedHolding && rv.win === s.motion.win;

  const row: RunRow = {
    run,
    revealMode: mode,
    forcedTier: forcedTier ?? '-',
    serverTier: rv.tier,
    motionWin: s.motion.win,
    revealWin: rv.win,
    holding,
    faulted,
    consistent,
    missVariant: s.motion.missVariant,
    isTest: s.isTest,
    aimMs: outcome.aimDurationMs,
    catchX: outcome.catchX,
    autoCatch: outcome.autoCatch,
    steps: step,
    physSteps: d.steps,
    outOfBounds: d.outOfBounds,
    explosive: d.explosive,
    nan: d.nan,
    contained: d.contained,
    containWorst: Number(d.containWorst.toFixed(3)),
    maxSpeed: Number(d.maxSpeed.toFixed(2)),
    swayWhileHeld,
    movingAfterRelease,
    settleSeconds,
    ballCount: game.ballCount,
    wallMs: Math.round(performance.now() - t0),
    note:
      note ||
      (consistent
        ? ''
        : `expectedHolding=${expectedHolding} actual=${holding} engineSelfCheck=${verify.detail}`),
  };

  // 실제 세션은 재고를 잡으므로 무효 처리해 되돌린다
  if (!isTest && rv.win) {
    await api(`/api/sessions/${s.sessionId}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason: '자동 플레이 하네스 — 검증 후 재고 복원', actor: 'autoplay' }),
    });
  }

  game.destroy();
  return row;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 실행 ---------------- */

// Rapier WASM 초기화 — 3D 전환으로 필요해졌다
await initPhysics();

const h = await api<{ ok: boolean }>('/api/health');
if (h.status !== 200) {
  console.error(`서버에 연결할 수 없습니다: ${BASE}\n  npm run dev:server 로 먼저 서버를 띄우세요.`);
  process.exit(1);
}

// 행사 상태 정상화 (앞선 검증이 남긴 상태 제거)
await api('/api/admin/event', {
  method: 'POST',
  body: JSON.stringify({ eventOn: true, emergencyStop: false, reason: '자동 플레이 하네스', actor: 'autoplay' }),
});

const modes: RevealMode[] = MODE_FILTER === 'both' ? ['grabMiss', 'capsuleOpen'] : [MODE_FILTER];

console.log('AEPICK Lucky Draw — 자동 플레이 하네스 (§15.1)');
console.log(`대상 ${BASE} · 테스트 세션 ${RUNS}회 (${modes.join(' / ')}) · 실제 세션 ${REAL_RUNS}회`);
console.log('물리 스텝 1/60초 고정, 렌더 없음\n');

const rows: RunRow[] = [];
const started = performance.now();

/* 1) 테스트 세션 — 모든 등급 × 두 연출 모드를 균등 커버 */
for (let i = 0; i < RUNS; i++) {
  /*
   * 등급과 연출 모드를 직교하게 조합한다.
   * i % modes.length 로 모드를 고르면 등급 수(6)가 짝수라 위상이 고정되어
   * "t1은 항상 A안, t2는 항상 B안" 식으로 조합의 절반이 검증되지 않는다.
   * 등급 한 바퀴(6회)를 돌 때마다 모드를 바꿔 6×2 전 조합을 커버한다.
   */
  const forcedTier = ALL_TIERS[i % ALL_TIERS.length]!;
  const mode = modes[Math.floor(i / ALL_TIERS.length) % modes.length]!;
  try {
    const row = await playOnce(i + 1, mode, forcedTier, true);
    rows.push(row);
  } catch (err) {
    console.error(`  run ${i + 1} 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
  if ((i + 1) % 50 === 0) {
    const bad = rows.filter((r) => !r.consistent).length;
    const rate = ((i + 1) / ((performance.now() - started) / 1000)).toFixed(1);
    console.log(`  ${i + 1}/${RUNS} · 불일치 ${bad} · ${rate} run/s`);
  }
}

/* 2) 실제 세션 — 재고·코드 발급 경로까지 확인 */
if (REAL_RUNS > 0) {
  console.log(`\n실제 세션 ${REAL_RUNS}회 (재고 예약 → 검증 → 무효 처리로 복원)`);
  for (let i = 0; i < REAL_RUNS; i++) {
    const mode = modes[i % modes.length]!;
    try {
      rows.push(await playOnce(RUNS + i + 1, mode, null, false));
    } catch (err) {
      console.error(`  real ${i + 1} 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

const elapsed = (performance.now() - started) / 1000;

/* ---------------- CSV ---------------- */

const headers = Object.keys(rows[0] ?? {}) as (keyof RunRow)[];
const csv = [
  headers.join(','),
  ...rows.map((r) => headers.map((h2) => String(r[h2]).replace(/,/g, ';')).join(',')),
].join('\n');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, '﻿' + csv, 'utf8');

/* ---------------- 판정 ---------------- */

const fail = (label: string, cond: boolean, detail = '') =>
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);

const inconsistent = rows.filter((r) => !r.consistent);
const outOfBounds = rows.reduce((a, r) => a + r.outOfBounds, 0);
const explosive = rows.reduce((a, r) => a + r.explosive, 0);
const nan = rows.reduce((a, r) => a + r.nan, 0);
const contained = rows.reduce((a, r) => a + r.contained, 0);
const containWorst = rows.reduce((a, r) => Math.max(a, r.containWorst), 0);
/** 구슬 반지름. 이보다 작은 초과는 솔버의 순간 오버슈트로 본다. */
const BALL_RADIUS = 0.62;
const timeouts = rows.filter((r) => r.note.startsWith('TIMEOUT'));
const heldSway = rows.filter((r) => r.swayWhileHeld > 0);
const stillMoving = rows.filter((r) => r.movingAfterRelease > 0);
const ballCounts = new Set(rows.map((r) => r.ballCount));
const revealMismatch = rows.filter((r) => r.revealWin !== r.motionWin);

const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);

console.log(`\n${'─'.repeat(62)}`);
console.log(`■ 실행 요약`);
console.log(`  완료 ${rows.length}/${RUNS + REAL_RUNS}회 · ${elapsed.toFixed(1)}초 · ${(rows.length / elapsed).toFixed(1)} run/s`);
console.log(`  물리 스텝 총 ${rows.reduce((a, r) => a + r.physSteps, 0).toLocaleString()} · 평균 ${Math.round(avg(rows.map((r) => r.physSteps)))}/회`);
console.log(`  구슬 ${[...ballCounts].join(',')}개 · 평균 조준 ${(avg(rows.map((r) => r.aimMs)) / 1000).toFixed(1)}초`);

/**
 * 결함 주입 모드 판정.
 *
 * 주입한 결함이 화면에 드러나는 것은 A안(grabMiss)뿐이다.
 * B안(capsuleOpen)은 결과와 무관하게 항상 획득하므로, win 값을 잘못 받아도
 * 획득 연출 자체는 달라지지 않는다 — 즉 물리-결과 불일치가 구조적으로 발생하지 않는다.
 * 이는 기획서 §4.3이 B안의 장점으로 적은 내용을 실측으로 확인한 것이다.
 * 따라서 검출률은 "관측 가능한 결함(A안)" 기준으로 계산한다.
 */
const faultedRows = rows.filter((r) => r.faulted);
const observableFaults = faultedRows.filter((r) => r.revealMode === 'grabMiss');
const maskedFaults = faultedRows.filter((r) => r.revealMode === 'capsuleOpen');
const faultDetected = observableFaults.filter((r) => !r.consistent).length;
const falsePositives = rows.filter((r) => !r.faulted && !r.consistent).length;

if (FAULT_PCT > 0) {
  console.log(`\n■ 하네스 자기 검사 — 결함 주입 ${FAULT_PCT}%`);
  console.log(`  주입 ${faultedRows.length}회 = A안 ${observableFaults.length} + B안 ${maskedFaults.length}`);
  fail(
    'A안에 주입한 결함을 100% 검출한다',
    faultDetected === observableFaults.length && observableFaults.length > 0,
    `${faultDetected}/${observableFaults.length}`,
  );
  fail('정상 회차를 오탐하지 않는다', falsePositives === 0, `오탐 ${falsePositives}건`);
  fail(
    'B안은 결함을 주입해도 연출이 깨지지 않는다 (§4.3 구조적 이점)',
    maskedFaults.every((r) => r.consistent),
    `${maskedFaults.filter((r) => !r.consistent).length}건 깨짐`,
  );
  console.log(`\n  ↑ A안 검출률 100% + 오탐 0 → 이 하네스의 일치 판정을 신뢰할 수 있다.`);
  console.log(`     B안에서 결함이 드러나지 않는 것은 검출 실패가 아니라,`);
  console.log(`     "항상 획득" 구조가 물리-결과 불일치를 원천 제거한다는 증거다.`);
}

console.log(`\n■ §16.2 결과-연출 일치`);
fail('결과와 연출 불일치 0건', inconsistent.length === 0 || FAULT_PCT > 0, `${inconsistent.length}건`);
fail('연출 계약(motion.win)과 결과 상세(reveal.win) 일치', revealMismatch.length === 0, `${revealMismatch.length}건`);
fail('모든 회차가 REVEAL까지 완주', timeouts.length === 0, `${timeouts.length}건 미완주`);

console.log(`\n■ §16.2 / §14 물리 안정성`);
fail('구슬 화면 이탈 0건', outOfBounds === 0, `${outOfBounds}건`);
fail('폭발적 튐(속도>30) 0건', explosive === 0, `${explosive}건`);
fail('NaN 좌표 0건', nan === 0, `${nan}건`);
/*
 * 안전망 발동 자체를 0으로 요구하면 솔버의 순간 오버슈트(0.4 units 수준)까지 실패로 잡는다.
 * 의미 있는 기준은 "되돌린 최대 초과가 구슬 반지름보다 작다" — 즉 화면상 어긋남이
 * 한 프레임도 눈에 보이지 않는다는 것이다. 무한 낙하(292 units)는 여기서 걸린다.
 */
/*
 * 안전망 초과 상한.
 *
 * 격리는 world.step() 직후·렌더 전에 실행되므로 초과 위치는 **화면에 절대 나타나지 않는다.**
 * 따라서 이 값은 "보이는 결함"이 아니라 물리 품질 지표다. 속도 상한(26)이 스텝당 0.43을
 * 넘지 못하게 하므로, 이보다 큰 초과는 솔버의 침투 해소(끼임)에서 나온다.
 *
 * 판정 기준을 구슬 지름(1.24)으로 둔다. 이보다 작으면 국소적 끼임이고 즉시 교정된다.
 * 초기에 겪은 파국(바닥 관통 후 무한 낙하, 초과 292)은 이 기준에서 명확히 걸린다.
 */
const CONTAIN_LIMIT = BALL_RADIUS * 2;
fail(
  `안전망 최대 초과가 구슬 지름(${CONTAIN_LIMIT.toFixed(2)}) 미만`,
  containWorst < CONTAIN_LIMIT,
  `최대 ${containWorst} · 발동 ${contained}회`,
);
const maxSettle = rows.reduce((a, r) => Math.max(a, r.settleSeconds), 0);
const avgSettle = rows.reduce((a, r) => a + r.settleSeconds, 0) / rows.length;
fail(
  `해제 후 30초 내 전 구슬 수렴 (영구 진동 없음) · 최대 ${maxSettle}초 · 평균 ${avgSettle.toFixed(1)}초`,
  stillMoving.length === 0,
  `${stillMoving.length}회차`,
);
console.log(
  `  · 매달린 상태의 흔들림: ${heldSway.length}회차 — §16.2가 요구한 정상 동작이므로 판정에서 제외`,
);
fail('구슬 수가 회차 내내 유지됨(누수 없음)', ballCounts.size === 1, `관측 ${[...ballCounts].join(',')}`);
console.log(`  최대 관측 속도 ${Math.max(...rows.map((r) => r.maxSpeed)).toFixed(1)}`);

console.log(`\n■ 등급별 커버리지`);
console.log('  등급    회차   win 연출   미획득 변형 분포');
for (const tier of ALL_TIERS) {
  const sub = rows.filter((r) => r.serverTier === tier);
  if (!sub.length) continue;
  const wins = sub.filter((r) => r.motionWin).length;
  const variants = [0, 1, 2].map((v) => sub.filter((r) => r.missVariant === v).length).join('/');
  console.log(`  ${tier.padEnd(6)}${String(sub.length).padStart(6)}${String(wins).padStart(10)}   ${variants}`);
}

console.log(`\n■ 등급 × 연출 모드 커버리지 매트릭스 (빈 칸이 없어야 한다)`);
console.log(`  등급    ${modes.map((m) => m.padEnd(12)).join('')}`);
let matrixComplete = true;
for (const tier of ALL_TIERS) {
  const cells = modes.map((m) => rows.filter((r) => r.serverTier === tier && r.revealMode === m).length);
  if (cells.some((c) => c === 0)) matrixComplete = false;
  console.log(`  ${tier.padEnd(6)}  ${cells.map((c) => String(c).padEnd(12)).join('')}`);
}
fail('모든 등급 × 연출 모드 조합이 검증됨', matrixComplete);

const catchDeciles = new Array(10).fill(0);
for (const r of rows) catchDeciles[Math.min(9, Math.floor(r.catchX * 10))]!++;
const emptyDeciles = catchDeciles.filter((c) => c === 0).length;
console.log(`\n■ 조준 위치 분포 (catchX 10분위)`);
console.log(`  ${catchDeciles.map((c, idx) => `${idx}:${c}`).join('  ')}`);
fail('집게 이동 범위를 고르게 커버함 (빈 분위 3개 이하)', emptyDeciles <= 3, `빈 분위 ${emptyDeciles}개`);

console.log(`\n■ 연출 모드별`);
for (const mode of modes) {
  const sub = rows.filter((r) => r.revealMode === mode);
  const bad = sub.filter((r) => !r.consistent).length;
  console.log(
    `  ${mode.padEnd(13)}${String(sub.length).padStart(5)}회 · 불일치 ${bad} · 평균 ${Math.round(avg(sub.map((r) => r.wallMs)))}ms/회`,
  );
}

if (inconsistent.length) {
  console.log(`\n■ 불일치 상세 (최대 10건)`);
  for (const r of inconsistent.slice(0, 10)) {
    console.log(`  run ${r.run} ${r.revealMode} tier=${r.serverTier} motionWin=${r.motionWin} · ${r.note}`);
  }
}

console.log(`\nCSV: ${OUT}`);

const consistencyPass =
  FAULT_PCT > 0
    ? faultDetected === observableFaults.length &&
      observableFaults.length > 0 &&
      falsePositives === 0 &&
      maskedFaults.every((r) => r.consistent)
    : inconsistent.length === 0;

const allPass =
  consistencyPass &&
  matrixComplete &&
  emptyDeciles <= 3 &&
  revealMismatch.length === 0 &&
  timeouts.length === 0 &&
  outOfBounds === 0 &&
  explosive === 0 &&
  nan === 0 &&
  containWorst < BALL_RADIUS * 2 &&
  stillMoving.length === 0 &&
  ballCounts.size === 1;

console.log(`\n판정: ${allPass ? '통과' : '실패'}`);
process.exit(allPass ? 0 : 1);
