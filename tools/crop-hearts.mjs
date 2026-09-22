/**
 * 하트 PNG 여백 잘라내기 — design-assets 원본을 읽어 키오스크 에셋으로 내보낸다.
 *
 * 원본 5장은 1254×1254 캔버스 안에 하트가 가로 77~86%, 세로 69~78%만 채우고
 * 나머지는 투명 여백이다. 그래서 집게가 잡은 하트와 발끝 사이에 눈에 띄는 틈이
 * 생겼고, 여백 비율이 파일마다 달라 어느 색이 뽑히느냐에 따라 틈이 달라졌다.
 *
 * 알파 경계까지 바짝 자르면 코드의 heartSize가 곧 하트의 실제 가로 크기가 되어
 * 배치가 예측 가능해진다. 세로는 파일마다 다르므로 높이는 고정하지 않는다 —
 * 화면 배치는 top이 아니라 bottom으로 앵커해서 종횡비 차이를 흡수한다.
 *
 * 사용: node tools/crop-hearts.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

const SRC = 'C:/Users/Irisnguyen/Desktop/Aepick/design-assets';
const DST = resolve('apps/kiosk/public/assets/cabinet');

/** 알파가 이 값 이하면 배경으로 본다. 안티에일리어싱 가장자리를 살리려고 낮게 잡았다 */
const ALPHA_CUT = 8;
/** 자른 뒤 사방에 남기는 여유 — 0으로 자르면 가장자리 픽셀이 계단처럼 보인다 */
const MARGIN = 2;

let report = [];

for (let i = 1; i <= 5; i++) {
  const src = resolve(SRC, `heart${i}.png`);
  if (!existsSync(src)) {
    console.error(`khong tim thay ${src}`);
    process.exit(1);
  }
  const img = PNG.sync.read(readFileSync(src));

  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[((img.width * y + x) << 2) + 3] > ALPHA_CUT) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) { console.error(`heart${i}.png rong`); process.exit(1); }

  x0 = Math.max(0, x0 - MARGIN);
  y0 = Math.max(0, y0 - MARGIN);
  x1 = Math.min(img.width - 1, x1 + MARGIN);
  y1 = Math.min(img.height - 1, y1 + MARGIN);

  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const s = ((y + y0) * img.width + x0) << 2;
    img.data.copy(out.data, (y * w) << 2, s, s + (w << 2));
  }
  writeFileSync(resolve(DST, `heart${i}.png`), PNG.sync.write(out));

  report.push({ i, from: `${img.width}x${img.height}`, to: `${w}x${h}`, ratio: (w / h).toFixed(3) });
}

for (const r of report) {
  console.log(`heart${r.i}.png  ${r.from} -> ${r.to}   ty le ngang/doc ${r.ratio}`);
}
const ratios = report.map((r) => Number(r.ratio));
console.log(`ty le ngang/doc: ${Math.min(...ratios)} .. ${Math.max(...ratios)}`);
