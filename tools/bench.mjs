/**
 * 렌더 성능 벤치마크 — 기획서 v1.2 §14
 *
 * 목적은 "몇 fps인가"가 아니라 **무엇이 얼마를 먹는가**다.
 * 효과를 하나씩 켜며 프레임 시간을 재면 설치 PC가 정해지기 전에도 예산 표를 만들 수 있고,
 * 실기기가 확보되면 같은 스크립트를 한 번 돌려 바로 판정할 수 있다.
 *
 * 기본은 vsync off — 켜두면 모든 조합이 60fps로 붙어 헤드룸을 알 수 없다.
 * 대신 300~500fps로 돌면 GPU 큐 압력 때문에 실사용에 없는 스파이크가 섞이므로,
 * 끊김 여부를 판정할 때는 --vsync로 60Hz 고정 상태를 따로 본다. 둘 다 봐야 결론이 난다.
 *
 * 사용:
 *   node tools/bench.mjs                    # 전체 (헤드룸 측정)
 *   node tools/bench.mjs --vsync            # 60Hz 고정 — 실사용 끊김 확인
 *   node tools/bench.mjs --seconds 8        # 조합당 측정 시간
 *   node tools/bench.mjs --only effects     # effects | presets | balls | dpr
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!CHROME) {
  console.error('Chrome/Edge를 찾지 못했습니다.');
  process.exit(1);
}

const BASE = arg('url', 'http://localhost:5174/?debug=1&noTimeout=1');
const PIN = arg('pin', '1234');
const SECONDS = Number(arg('seconds', '6'));
const WARMUP_MS = Number(arg('warmup', '2500'));
const ONLY = arg('only', '');
const OUT = resolve(arg('out', 'reports/bench.csv'));

/* ---------------- 측정 조합 ---------------- */

const ALL_OFF = { BLOOM: false, DOF: false, AO: false, SHADOWS: false };
const ALL_ON = { BLOOM: true, DOF: true, AO: true, SHADOWS: true };

/** group: 표를 나누는 기준 · flags: globalThis 오버라이드 */
const CONFIGS = [
  // 효과별 단가 — 베이스라인에서 하나씩만 켠다
  { group: 'effects', name: '베이스라인 (전부 off)', q: ALL_OFF, glass: false, cs: false },
  { group: 'effects', name: '+ AO만', q: { ...ALL_OFF, AO: true }, glass: false, cs: false },
  { group: 'effects', name: '+ Bloom만', q: { ...ALL_OFF, BLOOM: true }, glass: false, cs: false },
  { group: 'effects', name: '+ DOF만', q: { ...ALL_OFF, DOF: true }, glass: false, cs: false },
  { group: 'effects', name: '+ 그림자만', q: { ...ALL_OFF, SHADOWS: true }, glass: false, cs: false },
  { group: 'effects', name: '+ 전면유리만', q: ALL_OFF, glass: true, cs: false },
  { group: 'effects', name: '+ 접지그림자만', q: ALL_OFF, glass: false, cs: true },
  { group: 'effects', name: '전부 on (현재 배포 설정)', q: ALL_ON, glass: true, cs: true },

  // 품질 프리셋 — §13 자동 축소가 실제로 얼마를 버는지
  { group: 'presets', name: 'high', quality: 'high' },
  { group: 'presets', name: 'mid', quality: 'mid' },
  { group: 'presets', name: 'low', quality: 'low' },

  // 구슬 수 한계
  { group: 'balls', name: '구슬 40', balls: 40 },
  { group: 'balls', name: '구슬 78 (현재)', balls: 78 },
  { group: 'balls', name: '구슬 110', balls: 110 },
  { group: 'balls', name: '구슬 140 (상한)', balls: 140 },

  // 렌더 배율
  { group: 'dpr', name: 'dpr 1.0', q: { ...ALL_ON, DPR: 1.0 } },
  { group: 'dpr', name: 'dpr 1.25', q: { ...ALL_ON, DPR: 1.25 } },
  { group: 'dpr', name: 'dpr 1.5 (현재)', q: { ...ALL_ON, DPR: 1.5 } },
];

const configs = ONLY ? CONFIGS.filter((c) => c.group === ONLY) : CONFIGS;

/* ---------------- 측정 ---------------- */

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=d3d11',
    '--ignore-gpu-blocklist',
    /*
     * vsync를 끄지 않으면 모든 조합이 60fps에 붙어 헤드룸을 알 수 없다.
     * 다만 300~500fps로 돌리면 GPU 큐 압력 때문에 실사용에 없는 스파이크가 생긴다.
     * 스파이크가 실제인지 벤치 인공물인지 가릴 때는 --vsync로 60fps 고정 상태를 본다.
     */
    ...(process.argv.includes('--vsync') ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit']),
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

async function measure(cfg) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.evaluateOnNewDocument(
    (q, glass, cs, balls, level) => {
      for (const [k, v] of Object.entries(q ?? {})) globalThis[`__Q_${k}__`] = v;
      if (glass !== undefined) globalThis.__DEPTH_GLASS__ = glass;
      if (cs !== undefined) globalThis.__DEPTH_CS__ = cs;
      if (balls !== undefined) globalThis.__BALL_COUNT__ = balls;
      if (level !== undefined) globalThis.__Q_LEVEL__ = level;
    },
    cfg.q ?? null,
    cfg.glass,
    cfg.cs,
    cfg.balls,
    cfg.quality,
  );

  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 40000 });
  await new Promise((r) => setTimeout(r, 1200));

  const tap = (sel, text) =>
    page.evaluate(
      (s, t) => {
        const el = t
          ? [...document.querySelectorAll(s)].find((x) => x.textContent.includes(t))
          : document.querySelector(s);
        if (!el) return false;
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
        return true;
      },
      sel,
      text ?? null,
    );

  // 운영자 승인 → 테스트 세션 (실제 경로와 동일. 테스트 세션은 재고를 차감하지 않는다)
  await tap('.hotspot.tl');
  await new Promise((r) => setTimeout(r, 2300));
  for (const d of PIN.split('')) {
    await page.evaluate((x) => {
      [...document.querySelectorAll('.keypad button')]
        .find((b) => b.textContent.trim() === x)
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    }, d);
    await new Promise((r) => setTimeout(r, 90));
  }
  await new Promise((r) => setTimeout(r, 900));

  /*
   * 벤치는 매 조합마다 플레이 도중 페이지를 닫으므로 미완료 세션이 남는다.
   * 그대로 두면 다음 조합에서 운영자 패널이 복구 화면으로 뜨고 시작 버튼이 없어
   * 어트랙트 화면(=60fps 고정)을 측정하게 된다. 남아 있으면 먼저 무효 처리한다.
   */
  if (await tap('.op-actions .btn.warn', '무효 처리')) {
    await new Promise((r) => setTimeout(r, 900));
  }

  await tap('.op-actions .btn', '테스트 세션');
  await new Promise((r) => setTimeout(r, 300));
  const started = await tap('.op-actions .btn', '테스트 시작');

  // 튜토리얼(2.6초) 통과 + 셰이더 컴파일·환경 베이크 안정화
  await new Promise((r) => setTimeout(r, 2600 + WARMUP_MS));

  const info = await page.evaluate(() => ({
    phase: globalThis.__game?.phase ?? 'none',
    ballCount: globalThis.__game?.ballCount ?? 0,
    canvas: (() => {
      const c = document.querySelector('canvas');
      return c ? `${c.width}x${c.height}` : 'none';
    })(),
  }));
  const { phase, ballCount, canvas } = info;
  // 게임 화면에 도달하지 못했다면 측정값은 어트랙트 화면의 것이다 — 조용히 섞이면 안 된다
  if (!started || !ballCount) {
    await page.close();
    throw new Error(`게임 화면 진입 실패 (started=${started} phase=${phase} canvas=${canvas})`);
  }

  // 프레임 시간 샘플링. 스파이크는 "언제" 났는지가 원인 규명의 대부분이라 시각도 같이 남긴다
  const { frames, spikes } = await page.evaluate(async (sec) => {
    const out = [];
    const at = [];
    let last = performance.now();
    const t0 = last;
    while (performance.now() - t0 < sec * 1000) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      out.push(now - last);
      at.push(now - t0);
      last = now;
    }
    const top = out
      .map((ms, i) => ({ ms: +ms.toFixed(1), t: +(at[i] / 1000).toFixed(2) }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5);
    return { frames: out, spikes: top };
  }, SECONDS);

  await page.close();

  const sorted = [...frames].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const mean = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);

  return {
    name: cfg.name,
    group: cfg.group,
    phase,
    canvas,
    ballCount,
    frames: frames.length,
    meanMs: +mean.toFixed(2),
    medianMs: +pct(0.5).toFixed(2),
    p95Ms: +pct(0.95).toFixed(2),
    p99Ms: +pct(0.99).toFixed(2),
    maxMs: +(sorted[sorted.length - 1] ?? 0).toFixed(2),
    /*
     * 끊김 비율. 기준을 16.7ms로 잡으면 vsync 모드에서 중앙값이 정확히 16.7ms라
     * 절반이 "초과"로 잡혀 아무 의미가 없다. 60Hz에서 한 틱을 실제로 놓친 프레임(>25ms)만 센다.
     */
    dropPct: +((100 * frames.filter((f) => f > 25).length) / (frames.length || 1)).toFixed(2),
    fpsMean: +(1000 / mean).toFixed(1),
    fpsP5: +(1000 / pct(0.95)).toFixed(1), // 하위 5% 프레임 = 체감 최저
    spikes,
    errors: errors.length,
  };
}

console.log(`\n렌더 성능 벤치마크 — 조합 ${configs.length}개 × ${SECONDS}초 (vsync off)\n`);

const rows = [];
for (const cfg of configs) {
  process.stdout.write(`  측정: ${cfg.name} … `);
  try {
    const r = await measure(cfg);
    rows.push(r);
    console.log(`${r.fpsMean} fps (하위5% ${r.fpsP5})${r.errors ? ` · 오류 ${r.errors}` : ''}`);
  } catch (err) {
    console.log(`실패 — ${err instanceof Error ? err.message : String(err)}`);
  }
}

await browser.close();

/* ---------------- 출력 ---------------- */

const GROUP_TITLE = {
  effects: '효과별 단가 (베이스라인에서 하나씩만 켬)',
  presets: '품질 프리셋 (§13 자동 축소)',
  balls: '구슬 수',
  dpr: '렌더 배율',
};

const baseline = rows.find((r) => r.name.startsWith('베이스라인'));

for (const g of ['effects', 'presets', 'balls', 'dpr']) {
  const gr = rows.filter((r) => r.group === g);
  if (!gr.length) continue;
  console.log(`\n■ ${GROUP_TITLE[g]}`);
  console.log('  조합                          평균fps  중앙ms   p95ms   최악ms  끊김(>25ms)  단가ms');
  for (const r of gr) {
    const cost =
      g === 'effects' && baseline && r !== baseline
        ? (r.medianMs - baseline.medianMs).toFixed(2)
        : '—';
    console.log(
      `  ${r.name.padEnd(28)}${String(r.fpsMean).padStart(7)}${String(r.medianMs).padStart(8)}` +
        `${String(r.p95Ms).padStart(8)}${String(r.maxMs).padStart(9)}` +
        `${(r.dropPct + '%').padStart(12)}${String(cost).padStart(8)}`,
    );
  }
}

const target = rows.find((r) => r.name.includes('현재 배포 설정'));
if (target) {
  console.log(`\n■ 판정 (§14: 60fps 목표 · 30fps 미만 지속 구간 없음)`);
  /*
   * 판정은 평균이 아니라 중앙값으로 한다. 평균은 베이크·GC 같은 1회성 스파이크에 끌려간다.
   * 대신 스파이크는 "16.7ms 초과 비율"로 따로 본다 — 지속적 저하와 순간 끊김은 대책이 다르다.
   */
  const ok60 = target.medianMs <= 16.7;
  const steady = target.dropPct <= 0.5;
  const headroom = (16.7 / target.medianMs).toFixed(1);
  console.log(
    `  현재 배포 설정: 중앙 ${target.medianMs}ms (${(1000 / target.medianMs).toFixed(0)} fps) · ` +
      `끊김 ${target.dropPct}% · 최악 ${target.maxMs}ms`,
  );
  console.log(`  ${ok60 ? '✓' : '✗'} 60fps 목표 ${ok60 ? `충족 — 여유 ${headroom}배` : '미달'}`);
  console.log(
    `  ${steady ? '✓' : '△'} 프레임 안정성 ${steady ? '양호' : '스파이크 있음 — 워밍업/GC 구간 확인 필요'}`,
  );
  if (!ok60) console.log('  → 품질 단계 하향 또는 효과 제거 검토. 위 단가 표에서 가장 비싼 것부터.');
  console.log(
    `  최악 프레임 발생 시각: ${target.spikes.map((s) => `${s.t}s(${s.ms}ms)`).join(' · ')}`,
  );
}

mkdirSync(dirname(OUT), { recursive: true });
const headers = ['group', 'name', 'phase', 'canvas', 'ballCount', 'frames', 'meanMs', 'medianMs', 'p95Ms', 'p99Ms', 'maxMs', 'dropPct', 'fpsMean', 'fpsP5', 'errors'];
writeFileSync(
  OUT,
  '\ufeff' + [headers.join(','), ...rows.map((r) => headers.map((h) => r[h]).join(','))].join('\n'),
  'utf-8',
);
console.log(`\nCSV: ${OUT}`);
console.log('\n주의: 이 수치는 개발 기기 기준이다. 설치 PC가 확보되면 같은 스크립트를 그대로 돌려 판정한다.');
