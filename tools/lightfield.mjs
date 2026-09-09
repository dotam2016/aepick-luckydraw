/**
 * 벽 밝기 분포 측정 — "박스에 별도 조명이 있는가"를 수치로 확인한다.
 *
 * 균일 발광 라이트박스라면 밝기가 세로 그라데이션만 보이고 좌우는 대칭이다.
 * 실제 조명이 한쪽에 있으면 그 지점이 국소적으로 밝고 거리에 따라 떨어진다.
 * 벽 영역을 격자로 나눠 밝기를 재면 둘을 구분할 수 있다.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import jpegDecode from 'jpeg-js';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

function load(path) {
  const buf = readFileSync(path);
  if (path.endsWith('.png')) {
    const p = PNG.sync.read(buf);
    return { data: p.data, width: p.width };
  }
  const j = jpegDecode.decode(buf, { useTArray: true });
  return { data: j.data, width: j.width };
}

/** 격자 칸마다 상대 휘도(Rec.709)를 낸다 */
function field(path, box, cols, rows) {
  const { data, width } = load(path);
  const [bx, by, bw, bh] = box;
  const cw = Math.floor(bw / cols);
  const ch = Math.floor(bh / rows);
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let n = 0;
      for (let y = by + r * ch; y < by + (r + 1) * ch; y += 2) {
        for (let x = bx + c * cw; x < bx + (c + 1) * cw; x += 2) {
          const i = (y * width + x) * 4;
          sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          n++;
        }
      }
      row.push(sum / n / 255);
    }
    grid.push(row);
  }
  return grid;
}

function show(label, grid) {
  const flat = grid.flat();
  const mn = Math.min(...flat);
  const mx = Math.max(...flat);
  console.log(`\n■ ${label}`);
  console.log(`   격자 휘도 (%)                     최소 ${(mn * 100).toFixed(1)} · 최대 ${(mx * 100).toFixed(1)} · 대비 ${(mx / mn).toFixed(2)}배`);
  for (const row of grid) {
    console.log('   ' + row.map((v) => (v * 100).toFixed(0).padStart(5)).join(''));
  }
  // 좌우 비대칭 — 조명이 한쪽에 있으면 커진다
  const asym = grid.map((r) => {
    const half = Math.floor(r.length / 2);
    const L = r.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const R = r.slice(r.length - half).reduce((a, b) => a + b, 0) / half;
    return R - L;
  });
  const avgAsym = asym.reduce((a, b) => a + b, 0) / asym.length;
  // 최대 지점 위치
  let best = [0, 0];
  let bv = -1;
  grid.forEach((row, ri) => row.forEach((v, ci) => { if (v > bv) { bv = v; best = [ri, ci]; } }));
  console.log(
    `   좌우 비대칭(우−좌) ${(avgAsym * 100).toFixed(1)}%p · 최대 지점 = ${best[0] === 0 ? '상' : best[0] === grid.length - 1 ? '하' : '중'}` +
      `${best[1] < grid[0].length / 3 ? '좌' : best[1] > (grid[0].length * 2) / 3 ? '우' : '중앙'}`,
  );
}

/* 벽만 보이는 영역 — 구슬 더미 위쪽 */
show('레퍼런스 (w6.jpg)', field('reports/refwall/w6.jpg', [30, 20, 660, 230], 8, 5));
show('레퍼런스 (w12.jpg)', field('reports/refwall/w12.jpg', [30, 20, 660, 260], 8, 5));
show(`현재 (${arg('shot', 'reports/pal3/05-aim.png')})`, field(arg('shot', 'reports/pal3/05-aim.png'), [90, 330, 900, 560], 8, 5));
