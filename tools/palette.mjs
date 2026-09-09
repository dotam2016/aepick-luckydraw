/**
 * 구슬 팔레트 추출 — 레퍼런스와 현재 화면의 지배색을 같은 방법으로 뽑아 비교한다.
 *
 * 주의: 여기서 나오는 것은 **렌더된 색**이지 알베도가 아니다. 조명·환경 반사·톤 매핑을
 * 거친 결과이므로, 레퍼런스에서 뽑은 색을 그대로 팔레트에 넣으면 화면에서는 더 밝게 나온다.
 * 그래서 양쪽을 같은 방법으로 재고 **차이만큼** 알베도를 옮긴다.
 *
 * 사용:
 *   node tools/palette.mjs                       # 레퍼런스 vs 현재 비교
 *   node tools/palette.mjs --shot <png> --box x,y,w,h
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import jpegDecode from 'jpeg-js';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

function loadPixels(path) {
  const buf = readFileSync(path);
  if (path.endsWith('.png')) {
    const p = PNG.sync.read(buf);
    return { data: p.data, width: p.width, height: p.height, stride: 4 };
  }
  const j = jpegDecode.decode(buf, { useTArray: true });
  return { data: j.data, width: j.width, height: j.height, stride: 4 };
}

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

const hex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

/**
 * 구슬 색 후보 픽셀만 고른다.
 * 하이라이트(거의 흰색)와 그림자(거의 검정)는 재질 색이 아니라 조명이므로 뺀다.
 */
function collect(path, box) {
  const { data, width, stride } = loadPixels(path);
  const [bx, by, bw, bh] = box;
  const out = [];
  out.clipped = 0;
  out.total = 0;
  for (let y = by; y < by + bh; y += 2) {
    for (let x = bx; x < bx + bw; x += 2) {
      const i = (y * width + x) * stride;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const [, s, l] = rgb2hsl(r, g, b);
      out.total++;
      /*
       * 포화 픽셀은 따로 센다. 이걸 그냥 버리면 **밝기를 올려 픽셀을 날려버릴수록
       * 남은 픽셀의 통계가 좋아 보이는** 착시가 생긴다. 실제로 그 함정에 빠졌다 —
       * 키 라이트를 올려 S/L이 레퍼런스와 일치했는데 벽의 97.7%가 포화된 상태였다.
       */
      if (Math.max(r, g, b) >= 254) out.clipped++;
      if (l < 0.18 || l > 0.92) continue; // 그림자·하이라이트 제외
      if (s < 0.28) continue; // 무채색(은색 구슬·벽 반사) 제외
      out.push([r, g, b]);
    }
  }
  return out;
}

/** 색상(hue) 기준 k-means. 초기 중심을 색상환에 고르게 놓아 실행마다 같은 결과가 나오게 한다 */
function cluster(px, k) {
  let cent = Array.from({ length: k }, (_, i) => {
    const h = i / k;
    const [r, g, b] = hsl2rgb(h, 0.7, 0.55);
    return [r, g, b];
  });
  for (let iter = 0; iter < 24; iter++) {
    const sum = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (const p of px) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (p[0] - cent[c][0]) ** 2 + (p[1] - cent[c][1]) ** 2 + (p[2] - cent[c][2]) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      sum[best][0] += p[0]; sum[best][1] += p[1]; sum[best][2] += p[2]; sum[best][3]++;
    }
    cent = cent.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
    var counts = sum.map((s) => s[3]);
  }
  return cent
    .map((c, i) => ({ rgb: c, n: counts[i] }))
    .filter((c) => c.n > px.length * 0.02)
    .sort((a, b) => b.n - a.n);
}

function hsl2rgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

/*
 * 레퍼런스 표본 영역은 **더미 안쪽**으로 좁혀야 한다.
 * 넓게 잡으면 구슬 사이로 보이는 라벤더 벽이 섞여 들어오는데, 벽도 채도가 높아
 * 채도 필터로 걸러지지 않는다. 실제로 넓게 잡았을 때 비중 1위(25.2%) 클러스터가
 * 구슬이 아니라 벽(#c4bcf0)이었다.
 */
const REF = { path: 'reports/refwall/w12.jpg', box: [40, 300, 640, 150] };
const OURS = { path: arg('shot', 'reports/final-look2/05-aim.png'), box: [80, 960, 920, 340] };

for (const [label, src] of [['레퍼런스', REF], ['현재', OURS]]) {
  const px = collect(src.path, src.box);
  const cs = cluster(px, 9);
  console.log(`\n■ ${label}  (${src.path})  유효 픽셀 ${px.length}`);
  console.log('   색상        hex        H°     S%     L%    비중');
  for (const c of cs) {
    const [r, g, b] = c.rgb;
    const [h, s, l] = rgb2hsl(r, g, b);
    console.log(
      `   ${hex(r, g, b)}   ${hex(r, g, b)}  ${(h * 360).toFixed(0).padStart(4)}` +
        `  ${(s * 100).toFixed(0).padStart(5)}  ${(l * 100).toFixed(0).padStart(5)}` +
        `  ${((c.n / px.length) * 100).toFixed(1).padStart(5)}%`,
    );
  }
  const avgS = cs.reduce((a, c) => a + rgb2hsl(...c.rgb)[1] * c.n, 0) / cs.reduce((a, c) => a + c.n, 0);
  const avgL = cs.reduce((a, c) => a + rgb2hsl(...c.rgb)[2] * c.n, 0) / cs.reduce((a, c) => a + c.n, 0);
  console.log(
    `   가중 평균 — S ${(avgS * 100).toFixed(1)}%  L ${(avgL * 100).toFixed(1)}%` +
      `  ·  포화 픽셀 ${((px.clipped / px.total) * 100).toFixed(1)}%`,
  );
}
