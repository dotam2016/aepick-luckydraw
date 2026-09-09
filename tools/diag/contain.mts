import { ClawGame, initPhysics } from '../../apps/kiosk/src/game/clawGame.js';
await initPhysics();
const STEP = 1000 / 60;
const agg = { contained: 0, x: 0, y: 0, z: 0, worst: 0, phases: {} as Record<string, number> };
const TRIES = Number(process.argv[2] ?? '12');
for (let k = 0; k < TRIES; k++) {
  const g = new ClawGame({
    seed: 1 + Math.floor(Math.random() * 2 ** 31), ballCount: 78, aimSeconds: 12,
    speedPreset: 'normal', win: k % 2 === 0, missVariant: k % 3,
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
  const d = g.diagnostics;
  agg.contained += d.contained; agg.x += d.containDetail.x; agg.y += d.containDetail.y; agg.z += d.containDetail.z;
  agg.worst = Math.max(agg.worst, d.containWorst);
  for (const [ph, n] of Object.entries(d.containPhase)) agg.phases[ph] = (agg.phases[ph] ?? 0) + n;
  g.destroy();
}
console.log(`\n${TRIES}회 집계`);
console.log('  총 발동:', agg.contained, ' 축별 x=' + agg.x, 'y=' + agg.y, 'z=' + agg.z);
console.log('  최대 초과 거리:', agg.worst.toFixed(3));
console.log('  페이즈별:', JSON.stringify(agg.phases));
