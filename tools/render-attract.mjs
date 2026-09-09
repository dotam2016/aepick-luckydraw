/**
 * 대기화면(어트랙트) 영상 렌더 — 프레임 단위 오프라인 렌더 후 mp4로 인코딩.
 *
 * 왜 오프라인인가:
 *   실시간 예산(60fps)에 묶이지 않으므로 구슬 수·후처리·해상도를 실기기 한계 이상으로
 *   올릴 수 있다. 레퍼런스도 어트랙트 루프는 프리렌더로 보인다.
 *
 * **키오스크에서 렌더한다** (`?render=attract`).
 *   이전에는 비주얼 스파이크(5175)에서 렌더했는데, 스파이크는 키오스크가 거쳐온
 *   재질·조명·팔레트·파이프라인 수정을 하나도 받지 않았다. 그래서 대기 영상만
 *   옛날 룩(흰 벽·구형 집게·구형 팔레트)으로 남아 있었다. 씬을 키오스크에서 렌더하면
 *   대기 영상이 본 게임과 자동으로 같은 룩을 갖는다.
 *
 * 모션:
 *   구슬이 쏟아지는 장면을 **반복하지 않는다.** 루프마다 낙하가 되풀이되는 것이
 *   부자연스러웠다. 시작부터 쌓여 있는 더미가 미세하게 덜그럭거리기만 한다
 *   (엔진의 `ClawGame.agitate()`).
 *
 * 루프 이음새:
 *   물리는 정확히 주기적이지 않으므로 끝과 시작이 딱 맞지 않는다.
 *   여분 프레임을 더 찍어 앞부분에 **크로스페이드**로 녹여 이음새를 없앤다(--xfade).
 *
 * 결정성:
 *   wall-clock이 아니라 `window.tickSim(n)`으로 시뮬레이션을 명시적으로 진행시킨다.
 *   같은 시드 + 같은 스텝 = 같은 영상.
 *
 * 사용:
 *   node tools/render-attract.mjs                     # 8초 @30fps, 크로스페이드 0.8초
 *   node tools/render-attract.mjs --seconds 12
 *   node tools/render-attract.mjs --out apps/kiosk/public/assets/attract.mp4
 */

import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) {
  console.error('Chrome/Edge를 찾지 못했습니다.');
  process.exit(1);
}

const FFMPEG = resolve(
  'C:/Users/HIVELAB/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe',
);

const SEED = arg('seed', '424242');
const URL_BASE = arg('url', `http://localhost:5174/?render=attract&seed=${SEED}`);
const SECONDS = Number(arg('seconds', '8'));
const FPS = Number(arg('fps', '30'));
const WIDTH = Number(arg('width', '1080'));
const HEIGHT = Number(arg('height', '1920'));
const OUT = resolve(arg('out', 'reports/attract.mp4'));
/** 프레임당 시뮬레이션 스텝. 엔진은 60Hz이므로 30fps 출력에서 2면 실시간 속도다 */
const STEPS_PER_FRAME = Number(arg('steps', '2'));
/** 크로스페이드 길이(초) */
const XFADE_SEC = Number(arg('xfade', '0.8'));

// 프레임을 Dropbox 안에 쓰면 동기화가 파일을 잠가 rmSync가 EBUSY/EPERM으로 실패한다.
const FRAME_DIR = join(tmpdir(), 'aepick-attract-frames');

const N = Math.round(SECONDS * FPS); // 출력 프레임 수
const X = Math.max(1, Math.round(XFADE_SEC * FPS)); // 크로스페이드 프레임 수
const TOTAL = N + X; // 실제로 찍는 프레임 수

try {
  rmSync(FRAME_DIR, { recursive: true, force: true });
} catch {
  /* 남아 있어도 덮어쓰므로 무시 */
}
mkdirSync(FRAME_DIR, { recursive: true });

const framePath = (i) => `${FRAME_DIR}/f${String(i).padStart(4, '0')}.png`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    // SwiftShader(소프트웨어)로 떨어지면 프레임당 15초가 걸린다.
    '--use-gl=angle',
    `--use-angle=${process.env.ANGLE_BACKEND ?? 'd3d11'}`,
    '--ignore-gpu-blocklist',
    '--hide-scrollbars',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  /* 흔들림 값 등을 코드 수정 없이 바꿔가며 렌더할 수 있게 한다: --set __SHAKE_ACCEL__=0.5 */
  const sets = [];
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === '--set') sets.push(process.argv[i + 1]);
  }
  if (sets.length) {
    await page.evaluateOnNewDocument((pairs) => {
      for (const kv of pairs) {
        const k = kv.slice(0, kv.indexOf('='));
        const v = kv.slice(kv.indexOf('=') + 1);
        if (v === 'true' || v === 'false') globalThis[k] = v === 'true';
        else globalThis[k] = Number.isNaN(Number(v)) ? v : Number(v);
      }
    }, sets);
  }

  await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 40000 });

  // 물리 초기화 + 씬 구성 + 환경맵 베이크 완료 대기
  await page.waitForFunction(() => window.__attractReady === true, { timeout: 40000 });
  await new Promise((r) => setTimeout(r, 2500));

  if (errors.length) {
    console.error('페이지 오류:', errors.slice(0, 3));
    process.exit(1);
  }

  console.log(`프레임 렌더 ${TOTAL}장 (출력 ${N} + 크로스페이드 ${X}) — ${WIDTH}×${HEIGHT} @ ${FPS}fps`);
  for (let f = 0; f < TOTAL; f++) {
    await page.evaluate((n) => window.tickSim?.(n), STEPS_PER_FRAME);
    // 렌더가 반영될 시간을 준다 (rAF 2회)
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    await page.screenshot({ path: framePath(f), type: 'png' });
    if ((f + 1) % 30 === 0) console.log(`  ${f + 1}/${TOTAL}`);
  }
} finally {
  await browser.close();
}

/*
 * 이음새 없는 루프.
 *
 * 렌더한 f[0..N+X) 중 출력은 f[0..N)이고, 앞쪽 X장을 여분 꼬리 f[N..N+X)와 섞는다.
 *
 *   out[i] = mix(f[N+i], f[i], i/X)   (i < X)
 *   out[i] = f[i]                     (그 외)
 *
 * 이렇게 하면 out[N-1] = f[N-1] 다음에 out[0] = f[N]이 와서 **연속**이다
 * (둘은 원래 이웃한 프레임이다). 앞 X장 구간에서 f[N+i] 갈래가 f[i] 갈래로 서서히 녹는다.
 */
console.log(`루프 이음새 크로스페이드 ${X}장…`);
for (let i = 0; i < X; i++) {
  const head = PNG.sync.read(readFileSync(framePath(i)));
  const tail = PNG.sync.read(readFileSync(framePath(N + i)));
  const a = i / X; // 0 → 1 : 꼬리에서 머리로
  for (let p = 0; p < head.data.length; p += 4) {
    head.data[p] = tail.data[p] + (head.data[p] - tail.data[p]) * a;
    head.data[p + 1] = tail.data[p + 1] + (head.data[p + 1] - tail.data[p + 1]) * a;
    head.data[p + 2] = tail.data[p + 2] + (head.data[p + 2] - tail.data[p + 2]) * a;
  }
  writeFileSync(framePath(i), PNG.sync.write(head));
}

console.log('인코딩…');
const enc = spawnSync(
  FFMPEG,
  [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-framerate', String(FPS),
    '-i', `${FRAME_DIR}/f%04d.png`,
    // 크로스페이드용 여분 꼬리는 인코딩에서 제외한다
    '-frames:v', String(N),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '20',
    '-movflags', '+faststart',
    OUT,
  ],
  { stdio: 'inherit' },
);

if (enc.status !== 0) {
  console.error('인코딩 실패');
  process.exit(1);
}
console.log(`완료: ${OUT}  (${SECONDS}초 루프)`);
