import { ClawGame, initPhysics } from '../../apps/kiosk/src/game/clawGame.js';
import { WORLD } from '../../apps/kiosk/src/game/layout.js';

await initPhysics();
const STEP = 1000 / 60;
const TRIES = Number(process.argv[2] ?? '60');
let found = 0;

for (let k = 0; k < TRIES && found < 3; k++) {
  const seed = 1 + Math.floor(Math.random() * 2 ** 31);
  const g = new ClawGame({
    seed, ballCount: 78, aimSeconds: 12, speedPreset: 'normal',
    win: k % 2 === 0, missVariant: k % 3,
    revealMode: k % 2 ? 'grabMiss' : 'capsuleOpen', tutorialMs: 2600,
  });
  const targets = [0, 1, 0.5, 0.2, 0.8];
  let step = 0;
  while (g.phase !== 'DONE' && step < 3000) {
    if (step % 72 === 0) g.setTarget(targets[(step / 72) % targets.length]!);
    if (step === 220) g.triggerCatch(false);
    g.tick(STEP);
    step++;
  }
  g.settle(90);
  g.releaseGrab();
  g.settle(600);

  const moving = g.getRenderState().balls
    .map((b, i) => ({ i, b }))
    .filter(({ b }) => true);
  const n = g.movingBallCount();
  if (n === 0) { g.destroy(); continue; }

  found++;
  const st = g.getRenderState();
  console.log(`\n[seed ${seed}] 잔여 운동 ${n}개 / ${g.ballCount}, 안전망 최대 ${g.diagnostics.containWorst.toFixed(3)}`);
  // 위치로 위험 구역 판별
  const susp = st.balls.filter((b) =>
    Math.abs(b.x) > WORLD.boxWidth / 2 - b.r - 0.2 ||
    Math.abs(b.z) > WORLD.boxDepth / 2 - b.r - 0.2 ||
    b.y > 4);
  console.log('  집게 위치 clawX %s clawY %s sway %s',
    st.clawX.toFixed(2), st.clawY.toFixed(2), st.swayAngle.toFixed(3));
  console.log('  벽·상부 근접 구슬:', susp.length,
    susp.slice(0, 6).map((b) => `(${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)})`).join(' '));
  // 추가로 5초 더 두면 멎는지
  g.settle(300);
  console.log('  +5초 후 잔여 운동:', g.movingBallCount());
  void moving;
  g.destroy();
}
if (!found) console.log(`\n${TRIES}회 전부 정착 — 재현 실패`);
