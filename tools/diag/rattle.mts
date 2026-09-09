/**
 * 잡힌 구슬의 "덜그럭" 측정.
 *
 * 사용자 제보: "잡힌 공이 집게 안에서 덜그럭 거림".
 * 원인 가설 — 구형 조인트가 구슬을 앵커로 끌어당기는 동안 발 콜라이더가 밀어내어
 * 매 스텝 두 힘이 싸운다.
 *
 * 측정 방법: LIFT 구간에서 구슬이 집게 기준 **어디에 있는지**를 매 프레임 기록하고,
 * 그 좌표의 프레임 간 변화량을 본다.
 *   - 저주파(진자 흔들림)는 §16.2가 요구하는 정상 동작이다 → 이동평균으로 뺀다
 *   - 남는 고주파 성분이 덜그럭이다
 *
 * `--collide` 로 잡는 동안 충돌을 켠 상태(수정 전 거동)와 비교할 수 있다.
 */

import { ClawGame, initPhysics } from '../../apps/kiosk/src/game/clawGame';

const RUNS = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 20;

// 수정 전 거동(잡는 동안에도 집게와 충돌) 재현용
if (process.argv.includes('--collide')) {
  (globalThis as Record<string, unknown>).__GRAB_COLLIDE__ = true;
}

await initPhysics();

const samples: number[] = [];
const swings: number[] = [];

for (let run = 0; run < RUNS; run++) {
  const game = new ClawGame({
    seed: 1000 + run,
    aimSeconds: 1,
    speedPreset: 'normal',
    win: true,
    missVariant: 0,
    revealMode: 'capsuleOpen',
    tutorialMs: 0,
    disableTimeout: true,
  });

  // AIM을 짧게 끝내고 바로 잡게 한다
  let t = 0;
  const offsets: [number, number, number][] = [];
  while (t < 14000) {
    game.tick(1000 / 60);
    t += 1000 / 60;
    if (game.phase === 'DROP' || game.phase === 'GRAB') {
      // 아직 잡기 전
    }
    if (game.phase === 'LIFT') {
      const s = game.getRenderState();
      const held = s.balls.find((b) => b.grabbed);
      if (held) offsets.push([held.x - s.clawX, held.y - s.clawY, held.z]);
    }
    if (game.phase === 'REVEAL' || game.phase === 'DONE') break;
    if (game.phase === 'AIM') game.triggerCatch();
  }
  game.destroy();

  if (offsets.length < 12) continue;

  /*
   * 진자 흔들림(저주파)과 덜그럭(고주파)을 분리한다.
   * 5프레임 이동평균이 진자 성분이고, 원신호에서 그것을 빼면 고주파만 남는다.
   */
  const W = 5;
  let hf = 0;
  let lf = 0;
  let n = 0;
  for (let i = W; i < offsets.length - W; i++) {
    for (let axis = 0; axis < 3; axis++) {
      let mean = 0;
      for (let k = -W; k <= W; k++) mean += offsets[i + k]![axis];
      mean /= W * 2 + 1;
      hf += Math.abs(offsets[i]![axis] - mean);
      n++;
    }
    lf += Math.hypot(offsets[i]![0], offsets[i]![2]);
  }
  samples.push((hf / n) * 1000); // 밀리 월드유닛
  swings.push(lf / (offsets.length - W * 2));
}

const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const max = (a: number[]) => a.reduce((x, y) => Math.max(x, y), 0);

console.log(`\n잡힌 구슬 거동 — ${samples.length}회차 (LIFT 구간)\n`);
console.log(`  덜그럭(고주파 성분)  평균 ${avg(samples).toFixed(2)} · 최대 ${max(samples).toFixed(2)} m-unit`);
console.log(`  진자 흔들림(저주파)  평균 ${avg(swings).toFixed(3)} unit  ← §16.2가 요구하는 정상 동작`);
console.log(
  `\n  판정: ${avg(samples) < 1.0 ? '✓' : '✗'} 덜그럭 평균 1.0 m-unit 미만` +
    ` (구슬 반지름 620 m-unit 대비 ${((avg(samples) / 620) * 100).toFixed(3)}%)`,
);
