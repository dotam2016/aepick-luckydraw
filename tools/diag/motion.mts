import { ClawGame, initPhysics } from '../../apps/kiosk/src/game/clawGame.js';
import { WORLD } from '../../apps/kiosk/src/game/layout.js';

await initPhysics();
const STEP = 1000 / 60;
const g = new ClawGame({
  seed: 4242, ballCount: 78, aimSeconds: 12, speedPreset: 'normal',
  win: true, missVariant: 0, revealMode: 'capsuleOpen', tutorialMs: 2600,
});

// READY 통과
let step = 0;
while (g.phase === 'READY') { g.tick(STEP); step++; }
console.log(`READY 종료 @ ${step}스텝 (${(step*STEP/1000).toFixed(2)}초)`);

// 1) 버튼을 1초간 "누르고 있는" 경우 — 프레임별 집게 X
console.log('\n[A] 오른쪽 버튼 홀드 1초 — 프레임별 clawX');
const holdSamples: number[] = [];
for (let i = 0; i < 60; i++) {
  g.nudge(1, STEP);
  g.tick(STEP);
  holdSamples.push(g.getRenderState().clawX);
}
const deltas = holdSamples.map((v, i) => (i ? v - holdSamples[i-1]! : 0)).slice(1);
console.log('  clawX: ' + holdSamples.filter((_, i) => i % 10 === 0).map(v => v.toFixed(3)).join(' → '));
console.log(`  프레임당 이동: 평균 ${(deltas.reduce((a,b)=>a+b,0)/deltas.length).toFixed(4)}, 최소 ${Math.min(...deltas).toFixed(4)}, 최대 ${Math.max(...deltas).toFixed(4)}`);
console.log(`  1초간 총 이동 ${(holdSamples.at(-1)! - holdSamples[0]!).toFixed(3)} / 전체 폭 ${(WORLD.clawMaxX*2).toFixed(2)} = ${(((holdSamples.at(-1)!-holdSamples[0]!)/(WORLD.clawMaxX*2))*100).toFixed(1)}%`);

// 2) 짧게 "클릭"하는 경우 (100ms)
console.log('\n[B] 오른쪽 버튼 클릭 100ms (6프레임)');
const before = g.getRenderState().clawX;
for (let i = 0; i < 6; i++) { g.nudge(1, STEP); g.tick(STEP); }
for (let i = 0; i < 40; i++) g.tick(STEP);  // 놓은 뒤 정착
console.log(`  이동량 ${(g.getRenderState().clawX - before).toFixed(3)} = 전체 폭의 ${(((g.getRenderState().clawX-before)/(WORLD.clawMaxX*2))*100).toFixed(1)}%`);

// 3) 하강 — 프레임별 집게 Y
console.log('\n[C] CATCH 후 하강 — 프레임별 clawY');
g.triggerCatch(false);
const ySamples: { f: number; y: number; phase: string }[] = [];
for (let i = 0; i < 80; i++) {
  g.tick(STEP);
  ySamples.push({ f: i, y: g.getRenderState().clawY, phase: g.phase });
}
console.log('  ' + ySamples.filter((s) => s.f % 6 === 0).map(s => `${s.f}f:${s.y.toFixed(2)}`).join(' '));
const dropFrames = ySamples.filter(s => s.phase === 'DROP').length;
console.log(`  DROP 페이즈 지속: ${dropFrames}프레임 = ${(dropFrames*STEP/1000).toFixed(2)}초`);
const yDeltas = ySamples.slice(1).map((s, i) => Math.abs(s.y - ySamples[i]!.y));
console.log(`  프레임당 하강: 최대 ${Math.max(...yDeltas).toFixed(4)} (한 프레임에 전부 내려가면 ${(WORLD.clawHomeY-WORLD.clawDropY).toFixed(2)})`);
g.destroy();
