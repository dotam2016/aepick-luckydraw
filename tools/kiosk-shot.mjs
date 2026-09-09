/**
 * 키오스크 화면 캡처 — 헤드리스 Chrome으로 실제 앱을 조작해 1080×1920 스크린샷을 남긴다.
 * 브라우저 패널이 표시되지 않으면 페이지가 컴포지팅을 안 해 렌더가 되지 않으므로
 * 재현 가능한 검증 경로로 이 도구를 쓴다.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i+1] ? process.argv[i+1] : d; };
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const BASE = arg('url', 'http://localhost:5174/?debug=1');
const OUTDIR = resolve(arg('outdir', 'reports/kiosk'));
const PIN = arg('pin', '1234');
const TIER = arg('tier', '');       // 테스트 세션 강제 등급
const WAIT = Number(arg('wait', '2500'));

mkdirSync(OUTDIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox','--use-gl=angle','--use-angle=d3d11','--ignore-gpu-blocklist',
         '--hide-scrollbars','--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => {
    const st = String(e.stack ?? '').split(/\r?\n/).slice(0, 8).join(' | ');
    errors.push('pageerror: ' + e.message + '  STACK: ' + st);
  });
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  /*
   * 시드 고정. 팔레트·톤 측정은 같은 더미를 반복해서 재야 한다 —
   * 시드가 매번 다르면 색 분포가 흔들려 수치 차이가 조합 차이인지 난수인지 알 수 없다.
   */
  const SEED = arg('seed', '');
  if (SEED) {
    await page.evaluateOnNewDocument((v) => { globalThis.__SEED__ = v; }, Number(SEED));
  }

  /*
   * 임의 전역 주입 — `--set __BAKED__=1.2 --set __CLEARCOAT__=0.2`
   * 재질·조명 값을 코드 수정 없이 바꿔가며 측정할 때 쓴다.
   */
  const sets = [];
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === '--set') sets.push(process.argv[i + 1]);
  }
  if (sets.length) {
    await page.evaluateOnNewDocument((pairs) => {
      for (const kv of pairs) {
        const k = kv.slice(0, kv.indexOf('='));
        const v = kv.slice(kv.indexOf('=') + 1);
        /*
         * 불리언을 반드시 먼저 처리한다. Number('true')는 NaN이라 문자열로 남는데,
         * 문자열 'false'는 **truthy**여서 끄려던 옵션이 켜진 채로 측정된다.
         * 실제로 이 때문에 "AO를 꺼도 결과가 같다"는 잘못된 결론을 낼 뻔했다.
         */
        if (v === 'true' || v === 'false') globalThis[k] = v === 'true';
        else globalThis[k] = Number.isNaN(Number(v)) ? v : Number(v);
      }
    }, sets);
  }

  // 개선 요소를 끈 상태로 캡처할 수 있게 한다 (A/B 비교용)
  const OFF = process.argv.includes('--plain');
  if (OFF) {
    await page.evaluateOnNewDocument(() => {
      globalThis.__ENV_BAKE__ = false;
      globalThis.__DEPTH_GLASS__ = false;
      globalThis.__DEPTH_CS__ = false;
      globalThis.__DEPTH_VIG__ = 0;
    });
  }
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 40000 });
  await new Promise((r) => setTimeout(r, WAIT));
  await page.screenshot({ path: `${OUTDIR}/01-attract.png` });

  // 운영자 진입: 핫스팟 롱프레스
  await page.evaluate(() => {
    document.querySelector('.hotspot.tl')?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
  });
  await new Promise((r) => setTimeout(r, 2400));
  await page.screenshot({ path: `${OUTDIR}/02-pin.png` });

  // PIN 입력 (한 자씩 — 함수형 업데이트라 연속 호출도 안전하지만 실사용과 같게)
  for (const d of PIN.split('')) {
    await page.evaluate((digit) => {
      const b = [...document.querySelectorAll('.keypad button')].find((x) => x.textContent.trim() === digit);
      b?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    }, d);
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `${OUTDIR}/03-operator.png` });

  if (TIER) {
    await page.evaluate(() => {
      [...document.querySelectorAll('.op-actions .btn')]
        .find((x) => x.textContent.includes('테스트 세션'))
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate((tier) => {
      const label = tier === 'miss' ? '꽝' : tier.replace('t', '') + '등';
      [...document.querySelectorAll('.tier-grid button')]
        .find((x) => x.textContent.trim() === label)
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    }, TIER);
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(() => {
      [...document.querySelectorAll('.op-actions .btn')]
        .find((x) => x.textContent.includes('테스트 시작'))
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    });
  } else {
    await page.evaluate(() => {
      [...document.querySelectorAll('.op-actions .btn')]
        .find((x) => x.textContent.includes('1회 플레이 시작'))
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    });
  }

  // READY(튜토리얼) → AIM
  await new Promise((r) => setTimeout(r, 1400));
  await page.screenshot({ path: `${OUTDIR}/04-ready.png` });
  await new Promise((r) => setTimeout(r, 2200));
  await page.screenshot({ path: `${OUTDIR}/05-aim.png` });

  /*
   * 게임 화면 진입 확인은 **여기서** 해야 한다.
   * 측정에 쓰는 것이 05-aim.png이고, 이 시점에는 게임이 반드시 살아 있다.
   * 플로우 끝(결과 화면)에서 확인하면 이미 정리된 뒤라 정상 실행도 실패로 잡힌다.
   */
  if (!(await page.evaluate(() => (globalThis.__game?.ballCount ?? 0) > 0))) {
    errors.push('게임 화면 진입 실패 — 캡처된 이미지는 측정에 쓰면 안 된다');
  }

  // 좌측으로 이동
  await page.evaluate(() => {
    const pads = [...document.querySelectorAll('.pad')];
    pads[0]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3 }));
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => {
    const pads = [...document.querySelectorAll('.pad')];
    pads[0]?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3 }));
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `${OUTDIR}/06-moved.png` });

  const dbgBefore = await page.evaluate(() => document.querySelector('.debug')?.textContent ?? '');

  // 하강
  await page.evaluate(() => {
    document.querySelector('.dropbtn')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 4 }));
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUTDIR}/07-drop.png` });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `${OUTDIR}/08-grab.png` });
  await new Promise((r) => setTimeout(r, 1100));
  await page.screenshot({ path: `${OUTDIR}/09-lift.png` });
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: `${OUTDIR}/10-result.png` });

  const phys = await page.evaluate(() => {
    const w = window;
    return w.__physDebug ? { ...w.__physDebug, live: [...w.__physDebug.live] } : null;
  });
  console.log('physics debug:', JSON.stringify(phys));

  const info = await page.evaluate(() => ({
    debug: document.querySelector('.debug')?.textContent ?? '',
    resultClass: document.querySelector('.result')?.className ?? null,
    title: document.querySelector('.result-title')?.textContent ?? null,
    prize: document.querySelector('.prize-name')?.textContent ?? null,
    code: document.querySelector('.code-box .code')?.textContent ?? null,
    canvas: (() => { const c = document.querySelector('canvas'); return c ? `${c.width}x${c.height}` : null; })(),
  }));
  console.log('아임 시점 디버그:\n' + dbgBefore.split('\n').map(l=>'  '+l).join('\n'));
  console.log('\n결과:', JSON.stringify(info, null, 1));
} finally {
  await browser.close();
}
if (errors.length) { console.log('\n오류:'); for (const e of errors.slice(0, 12)) console.log('  ' + e); }
