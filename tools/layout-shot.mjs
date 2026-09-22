/**
 * 2D 스킨 배치 캡처 — apps/kiosk/public/layout-test.html 을 헤드리스로 찍는다.
 *
 * 브라우저 패널이 뜨지 않는 환경에서도 배치 수치를 눈으로 맞춰야 하므로
 * 재현 가능한 캡처 경로를 따로 둔다(tools/shot.mjs 와 같은 이유).
 *
 * 사용:
 *   node tools/layout-shot.mjs --out reports/skin2d/01.png
 *   node tools/layout-shot.mjs --phase drop --out reports/skin2d/02.png
 *   node tools/layout-shot.mjs --clawx -300 --tube 620
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.error('Chrome/Edge를 찾지 못했습니다.');
  process.exit(1);
}

const PAGE = pathToFileURL(resolve('apps/kiosk/public/layout-test.html')).href;
const OUT = resolve(arg('out', 'reports/skin2d/shot.png'));
const CLAWX = arg('clawx', null);
const TUBE = arg('tube', null);
const OPEN = arg('open', null);
const HIDE = arg('hide', ''); // csv: hearts,hud
const WAIT = Number(arg('wait', '900'));

mkdirSync(dirname(OUT), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--allow-file-access-from-files', '--force-device-scale-factor=1'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
await page.goto(PAGE, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, WAIT));

await page.evaluate(
  ({ clawx, tube, open, hide }) => {
    // 페이지의 rAF 루프가 매 프레임 CSS 변수를 덮어쓰므로 상태 자체를 바꾼다
    if (clawx !== null || tube !== null || open !== null) {
      window.__set(Number(clawx ?? 0), Number(tube ?? 120), Number(open ?? 1));
    }
    for (const id of hide) {
      const el = document.getElementById(id) || document.querySelector('.' + id);
      if (el) el.style.display = 'none';
    }
  },
  {
    clawx: CLAWX,
    tube: TUBE,
    open: OPEN,
    hide: HIDE ? HIDE.split(',').map((s) => s.trim()).filter(Boolean) : [],
  },
);

await page.addStyleTag({ content: '.hud{display:none!important}' });
await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: OUT });
await browser.close();
console.log('saved', OUT);
