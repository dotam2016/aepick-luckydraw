/**
 * 벽 톤 스윕 — 렌더된 벽 색을 레퍼런스와 수치로 맞춘다.
 *
 * 눈으로 조절하면 "밝게" 했더니 흰색으로 클리핑되는 것을 못 알아챈다.
 * 실제로 그런 일이 있었다: 벽이 RGB(255,255,255)로 포화되어 채도가 0이 됐는데
 * 화면에서는 그냥 "밝다"로 보였다. 레퍼런스 벽(깨끗한 영역)은 L 84.3% · S 67.4%다.
 *
 * 조합마다 캡처해서 벽 영역의 HSL을 재고 목표와의 거리를 출력한다.
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

/*
 * 두 가지를 잰다. 벽과 구슬은 **연동되어 있다** — 벽이 광원(라이트박스 + 환경 베이크)이라
 * 벽을 낮추면 구슬도 같이 어두워진다. 그래서 벽을 맞춘 뒤 구슬을 따로 올려야 한다.
 */
const PRESET = process.argv.includes('--balls') ? 'balls' : 'wall';
/**
 * 재는 영역.
 * 벽: 집게·케이블·로고가 걸리지 않는 오른쪽 벽면. 처음에는 화면 중앙(420,700)을 재다가
 *     집게와 케이블이 섞여 평균이 낮아지는 바람에 클리핑을 못 잡았다.
 */
const WALL_BOX =
  PRESET === 'balls'
    ? { x: 80, y: 960, w: 920, h: 340 }
    : /*
       * x760~960은 아크릴 단면 하이라이트(텍스처 우측 끝의 흰 띠)에 걸린다 —
       * 그 영역을 재면 채도가 실제보다 10p 넘게 낮게 나온다. 벽면 한가운데로 옮겼다.
       */
      { x: 620, y: 560, w: 140, h: 200 };

/** 레퍼런스 w6.jpg 실측값 */
const TARGET = PRESET === 'balls' ? { L: 61.2, S: 13.1 } : { L: 84.3, S: 67.4 };

const COMBOS = [];
if (PRESET === 'balls') {
  // 벽은 확정값으로 고정하고 구슬 조명만 움직인다
  for (const baked of [1.45, 1.9, 2.35]) {
    for (const amb of [0.22, 0.38, 0.54]) COMBOS.push({ baked, amb });
  }
} else {
  // 파이프라인 수정 후 재탐색 — 톤 매핑이 생겨 헤드룸이 늘었고 wallEnvIntensity가 살아났다
  for (const em of [0.3, 0.6, 0.9]) {
    for (const wenv of [0.55, 1.2, 2.0]) {
      COMBOS.push({ em, wenv, top: '#eab4cd', bot: '#f4cfdf' });
    }
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist',
         '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
});

/**
 * 평균 HSL + **포화 픽셀 비율**.
 *
 * 평균만으로 클리핑을 판정하면 안 된다. 실제로 그 실수를 했다 —
 * 평균 RGB는 255 미만인데 픽셀의 89%는 빨강 채널이 255에 붙어 있었다.
 * 채널이 포화되면 그 색은 정보가 잘려 나가 채도 수치도 신뢰할 수 없다.
 */
function measure(buf, W) {
  let r = 0, g = 0, b = 0, n = 0, hot = 0;
  for (let y = WALL_BOX.y; y < WALL_BOX.y + WALL_BOX.h; y++) {
    for (let x = WALL_BOX.x; x < WALL_BOX.x + WALL_BOX.w; x++) {
      const i = (y * W + x) * 4;
      r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
      if (Math.max(buf[i], buf[i + 1], buf[i + 2]) >= 254) hot++;
      n++;
    }
  }
  r /= n * 255; g /= n * 255; b /= n * 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const L = (mx + mn) / 2;
  const S = mx === mn ? 0 : (mx - mn) / (L > 0.5 ? 2 - mx - mn : mx + mn);
  return { L: L * 100, S: S * 100, hot: (hot / n) * 100 };
}

console.log(`\n벽 톤 스윕 — 목표 L ${TARGET.L}% · S ${TARGET.S}% (레퍼런스 실측)\n`);
console.log(PRESET === 'balls'
  ? '  조합                              L%      S%   포화픽셀  목표거리'
  : '  조합                          L%      S%   포화픽셀  목표거리');

const results = [];
for (const c of COMBOS) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(
    (em, top, bot, baked, amb, wenv) => {
      if (em !== undefined) globalThis.__WALL_EM__ = em;
      if (top !== undefined) globalThis.__WALL_TOP__ = top;
      if (bot !== undefined) globalThis.__WALL_BOT__ = bot;
      if (baked !== undefined) globalThis.__BAKED__ = baked;
      if (amb !== undefined) globalThis.__AMB__ = amb;
      if (wenv !== undefined) globalThis.__WALL_ENV__ = wenv;
      // 더미를 고정한다 — 시드가 흔들리면 색 분포 차이가 조합 차이로 오독된다
      globalThis.__SEED__ = 424242;
    },
    c.em, c.top, c.bot, c.baked, c.amb, c.wenv,
  );
  await page.goto('http://localhost:5174/?debug=1&noTimeout=1', { waitUntil: 'networkidle0', timeout: 40000 });
  await new Promise((r) => setTimeout(r, 1200));

  const tap = (sel, text) =>
    page.evaluate((s, t) => {
      const el = t ? [...document.querySelectorAll(s)].find((x) => x.textContent.includes(t))
                   : document.querySelector(s);
      if (!el) return false;
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      return true;
    }, sel, text ?? null);

  await tap('.hotspot.tl');
  await new Promise((r) => setTimeout(r, 2300));
  for (const d of '1234') {
    await page.evaluate((x) => {
      [...document.querySelectorAll('.keypad button')].find((b) => b.textContent.trim() === x)
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    }, d);
    await new Promise((r) => setTimeout(r, 90));
  }
  await new Promise((r) => setTimeout(r, 900));
  if (await tap('.op-actions .btn.warn', '무효 처리')) await new Promise((r) => setTimeout(r, 900));
  await tap('.op-actions .btn', '테스트 세션');
  await new Promise((r) => setTimeout(r, 300));
  const started = await tap('.op-actions .btn', '테스트 시작');
  await new Promise((r) => setTimeout(r, 5200));

  /*
   * 게임 화면 진입 확인. 없으면 어트랙트 화면을 재게 되는데, 그 값(L 17.7%)이
   * 조합 결과인 것처럼 표에 섞여 들어온다 — bench.mjs에서 이미 한 번 당한 함정이다.
   */
  const ok = await page.evaluate(() => (globalThis.__game?.ballCount ?? 0) > 0);
  if (!started || !ok) {
    await page.close();
    console.log(`  ${JSON.stringify(c)}  — 게임 화면 진입 실패, 제외`);
    continue;
  }

  const shot = await page.screenshot({ encoding: 'binary' });
  await page.close();

  // PNG 디코딩 대신 캔버스 픽셀을 직접 읽는 편이 간단하지만 페이지를 닫았으므로 sharp 없이 처리한다
  const { default: pngjs } = await import('pngjs');
  const png = pngjs.PNG.sync.read(Buffer.from(shot));
  const m = measure(png.data, png.width);
  // 포화는 색 정보가 잘린 것이므로 거리 계산에서 강하게 벌점을 준다
  const dist = Math.hypot(m.L - TARGET.L, (m.S - TARGET.S) * 0.6) + m.hot * 0.5;
  results.push({ ...c, ...m, dist });
  const label =
    PRESET === 'balls'
      ? `베이크 ${c.baked.toFixed(2)}  앰비언트 ${c.amb.toFixed(2)}   `
      : `발광 ${c.em.toFixed(2)}  벽환경 ${(c.wenv ?? 0).toFixed(2)}   `;
  console.log(
    `  ${label}  ${m.L.toFixed(1).padStart(6)}  ${m.S.toFixed(1).padStart(6)}` +
    `  ${(m.hot.toFixed(1) + '%').padStart(7)}  ${dist.toFixed(1).padStart(8)}`,
  );
}

await browser.close();
results.sort((a, b) => a.dist - b.dist);
const best = results[0];
console.log(`\n최적: 발광 ${best.em} · top ${best.top} · bottom ${best.bot}`);
console.log(`      L ${best.L.toFixed(1)}% · S ${best.S.toFixed(1)}% · 포화 픽셀 ${best.hot.toFixed(1)}%`);
