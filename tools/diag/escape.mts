import { ClawGame, initPhysics } from '../../apps/kiosk/src/game/clawGame.js';
import { WORLD } from '../../apps/kiosk/src/game/layout.js';

await initPhysics();
const STEP = 1000 / 60;

const COUNTS = (process.argv[2] ?? '32,48,78').split(',').map(Number);
for (const N of COUNTS)
for (const [label, win, mode] of [
  ['win/grabMiss', true, 'grabMiss'],
  ['miss/grabMiss', false, 'grabMiss'],
] as const) {
  const g = new ClawGame({
    seed: 12345, ballCount: N, aimSeconds: 12, speedPreset: 'normal',
    win, missVariant: 0, revealMode: mode, tutorialMs: 2600,
  });

  // 스폰 직후 이탈 여부
  const spawnBad = g.getRenderState().balls.filter(
    (b) => Math.abs(b.x) > WORLD.boxWidth / 2 || Math.abs(b.z) > WORLD.boxDepth / 2 || b.y < -0.5,
  );

  const escapes: { phase: string; step: number; x: number; y: number; z: number }[] = [];
  let step = 0;
  let lastPhase = g.phase;
  const TGT = Number(process.argv[3] ?? '0.5');
  g.setTarget(TGT);
  while (g.phase !== 'DONE' && step < 3000) {
    if (step === 200) g.triggerCatch(false);
    g.tick(STEP);
    if (step % 3 === 0) {
      for (const b of g.getRenderState().balls) {
        if (Math.abs(b.x) > WORLD.boxWidth / 2 + 0.8 || Math.abs(b.z) > WORLD.boxDepth / 2 + 0.8 || b.y < -1) {
          if (escapes.length < 6) escapes.push({ phase: g.phase, step, x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2) });
        }
      }
    }
    lastPhase = g.phase;
    step++;
  }
  g.settle(90); g.releaseGrab(); g.settle(600);
  const moving = g.getRenderState().balls.filter((b) => true);
  console.log(`\n[${label}]`);
  console.log('  스폰 직후 이탈:', spawnBad.length, spawnBad.slice(0,3).map(b=>`(${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)})`).join(' '));
  console.log('  이탈 발생 (최대 6):', escapes.length ? JSON.stringify(escapes) : '없음');
  console.log('  잔여 운동:', g.movingBallCount(), '/', g.ballCount, ' diag:', JSON.stringify(g.diagnostics));
  void lastPhase; void moving;
  g.destroy();
}
