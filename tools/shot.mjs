/**
 * 스파이크 화면 캡처 — 헤드리스 Chrome으로 1080×1920 렌더를 파일로 저장한다.
 *
 * 브라우저 패널이 표시되지 않으면 페이지가 컴포지팅을 하지 않아 캔버스가 렌더되지 않는다.
 * 비주얼 검토는 이미지를 반복 비교하는 작업이므로 재현 가능한 캡처 경로가 필요하다.
 *
 * 사용:
 *   node tools/shot.mjs                                  # 기본 설정으로 1장
 *   node tools/shot.mjs --out reports/shot.png
 *   node tools/shot.mjs --cfg '{"aoIntensity":4}'        # 설정 일부를 덮어써서 캡처
 *   node tools/shot.mjs --ref gameplay --refOpacity 0.5  # 레퍼런스 오버레이 포함
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
  console.error('Chrome/Edge 실행 파일을 찾지 못했습니다.');
  process.exit(1);
}

const URL_BASE = arg('url', 'http://localhost:5175');
const OUT = resolve(arg('out', 'reports/spike-shot.png'));
const WIDTH = Number(arg('width', '1080'));
const HEIGHT = Number(arg('height', '1920'));
const SCALE = Number(arg('scale', '1'));
const WAIT = Number(arg('wait', '2500'));
const CFG_OVERRIDE = arg('cfg', '');
const REF = arg('ref', '');
const REF_OPACITY = arg('refOpacity', '0.5');

mkdirSync(dirname(OUT), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: [
    '--no-sandbox',
    // 헤드리스에서 WebGL을 실제로 돌리려면 소프트웨어 GL 폴백을 허용해야 한다
    // D3D11로 실제 GPU를 쓴다. SwiftShader(소프트웨어)는 프레임당 15초가 걸린다.
    '--use-gl=angle',
    '--use-angle=d3d11',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--hide-scrollbars',
    `--window-size=${WIDTH},${HEIGHT}`,
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const url = REF ? `${URL_BASE}/?ref=${REF}` : URL_BASE;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 40000 });

  // 패널을 접고(캡처 방해) 설정 오버라이드를 적용한다
  await page.evaluate(
    (cfgJson, refOpacity) => {
      const w = window;
      document.querySelector('.head .x')?.click();
      const fab = document.querySelector('.fab');
      if (fab) fab.style.display = 'none';
      if (cfgJson) {
        const patch = JSON.parse(cfgJson);
        w.setCfg((c) => ({ ...c, ...patch }));
      }
      const img = document.querySelector('.refoverlay');
      if (img) img.style.opacity = String(refOpacity);
    },
    CFG_OVERRIDE,
    REF_OPACITY,
  );

  // 렌더·환경맵 생성·후처리 안정화 대기
  await new Promise((r) => setTimeout(r, WAIT));

  const info = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } : null;
  });

  await page.screenshot({ path: OUT, type: 'png' });

  console.log(`저장: ${OUT}`);
  console.log(`캔버스: ${info ? `${info.w}×${info.h} (css ${info.cssW}×${info.cssH})` : '없음'}`);
  if (errors.length) {
    console.log('\n페이지 오류:');
    for (const e of errors.slice(0, 10)) console.log('  ' + e);
  }
} finally {
  await browser.close();
}
