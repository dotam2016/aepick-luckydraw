import { ClawGame, initPhysics } from '../../apps/kiosk/src/game/clawGame.js';
import { WORLD } from '../../apps/kiosk/src/game/layout.js';

await initPhysics();
const STEP = 1000 / 60;
const N = Number(process.argv[2] ?? '32');
const TRIES = Number(process.argv[3] ?? '40');

let bad = 0;
const samples: string[] = [];

for (let k = 0; k < TRIES; k++) {
  const seed = 1 + Math.floor(Math.random() * 2 ** 31);
  const g = new ClawGame({
    seed, ballCount: N, aimSeconds: 12, speedPreset: 'normal',
    win: k % 2 === 0, missVariant: k % 3, revealMode: k % 2 ? 'grabMiss' : 'capsuleOpen',
    tutorialMs: 2600,
  });

  // 스폰 직후 상태
  const afterSpawn = g.getRenderState().balls;
  const spawnOut = afterSpawn.filter(
    (b) => Math.abs(b.x) > WORLD.boxWidth / 2 || Math.abs(b.z) > WORLD.boxDepth / 2 || b.y < -0.6,
  );

  let step = 0;
  const targets = [0, 1, 0.5, 0.15, 0.85];
  while (g.phase !== 'DONE' && step < 3000) {
    if (step % 72 === 0) g.setTarget(targets[(step / 72) % targets.length]!);
    if (step === 220) g.triggerCatch(false);
    g.tick(STEP);
    step++;
  }
  g.settle(90); g.releaseGrab(); g.settle(600);
  const d = g.diagnostics;
  const moving = g.movingBallCount();
  if (d.outOfBounds > 0 || moving > 0 || spawnOut.length > 0) {
    bad++;
    if (samples.length < 5) {
      const out = g.getRenderState().balls
        .filter((b) => Math.abs(b.x) > WORLD.boxWidth / 2 + 0.5 || Math.abs(b.z) > WORLD.boxDepth / 2 + 0.5 || b.y < -1 || b.y > WORLD.boxHeight + 1)
        .slice(0, 3)
        .map((b) => `(${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)})`);
      samples.push(`seed=${seed} spawnOut=${spawnOut.length} oob=${d.outOfBounds} moving=${moving} pos=${out.join(' ')}`);
    }
  }
  g.destroy();
}
console.log(`\nN=${N}, ${TRIES}회 중 문제 ${bad}회`);
for (const s of samples) console.log('  ' + s);
