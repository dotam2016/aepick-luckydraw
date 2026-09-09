/**
 * 선명도 측정 — 무엇이 구슬을 흐리게 만드는지 가린다.
 *
 * 지표는 **라플라시안 분산**이다. 이웃 픽셀과의 2차 차분이 크면 경계가 또렷하다는 뜻이고,
 * 블러가 걸리면 급격히 떨어진다. 값이 클수록 선명하다.
 *
 * 주의: 레퍼런스와 직접 비교하면 안 된다. 레퍼런스는 압축된 영상 프레임이라
 * 코덱 블러가 이미 섞여 있어 우리 렌더보다 낮게 나온다.
 * 여기서는 **우리 설정끼리** 비교해 원인을 가린다.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

/** 라플라시안 분산 + 상위 1% 엣지 세기(하이라이트 경계의 또렷함) */
export function sharpness(path, [bx, by, bw, bh]) {
  const png = PNG.sync.read(readFileSync(path));
  const { data, width } = png;
  const lum = (x, y) => {
    const i = (y * width + x) * 4;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  const vals = [];
  for (let y = by + 1; y < by + bh - 1; y++) {
    for (let x = bx + 1; x < bx + bw - 1; x++) {
      // 4-이웃 라플라시안
      const l = Math.abs(4 * lum(x, y) - lum(x - 1, y) - lum(x + 1, y) - lum(x, y - 1) - lum(x, y + 1));
      vals.push(l);
    }
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const varc = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  vals.sort((a, b) => b - a);
  const top1 = vals.slice(0, Math.max(1, Math.floor(vals.length * 0.01)));
  return {
    variance: varc,
    edge: top1.reduce((a, b) => a + b, 0) / top1.length,
  };
}

// Windows 경로는 문자열 비교가 어긋난다(file:// vs file:///, 공백 인코딩) — pathToFileURL로 맞춘다
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const box = (arg('box', '150,1000,800,290')).split(',').map(Number);
  const r = sharpness(arg('shot', 'reports/aofinal/05-aim.png'), box);
  console.log(`선명도 — 분산 ${r.variance.toFixed(0)}  ·  상위1% 엣지 ${r.edge.toFixed(1)}`);
}
