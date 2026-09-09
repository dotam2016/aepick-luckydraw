/** 브라우저 입력 계층 검증 — 버튼 홀드/클릭 시 집게가 실제로 어떻게 움직이는지 샘플링 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox','--use-gl=angle','--use-angle=d3d11','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920 });
await page.goto('http://localhost:5174/?debug=1', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 2000));

// 운영자 진입 → PIN → 테스트 시작
await page.evaluate(() => document.querySelector('.hotspot.tl')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1})));
await new Promise(r => setTimeout(r, 2300));
for (const d of '1234') {
  await page.evaluate((x)=>{[...document.querySelectorAll('.keypad button')].find(b=>b.textContent.trim()===x)?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));}, d);
  await new Promise(r => setTimeout(r, 100));
}
await new Promise(r => setTimeout(r, 1000));
await page.evaluate(()=>{[...document.querySelectorAll('.op-actions .btn')].find(b=>b.textContent.includes('테스트 세션'))?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));});
await new Promise(r => setTimeout(r, 300));
await page.evaluate(()=>{[...document.querySelectorAll('.op-actions .btn')].find(b=>b.textContent.includes('테스트 시작'))?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));});
await new Promise(r => setTimeout(r, 4200));  // READY 통과

const phase = await page.evaluate(() => window.__game?.phase);
console.log('페이즈:', phase);

// [A] 오른쪽 버튼 1초 홀드하며 clawX 샘플링
const hold = await page.evaluate(async () => {
  const pads = [...document.querySelectorAll('.pad')];
  const right = pads[1];
  const samples = [];
  right.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }));
  const t0 = performance.now();
  while (performance.now() - t0 < 1000) {
    samples.push(+(window.__game?.getRenderState().clawX ?? 0).toFixed(4));
    await new Promise(r => requestAnimationFrame(r));
  }
  right.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
  return samples;
});
const d = hold.slice(1).map((v,i)=>v-hold[i]);
console.log(`\n[A] 홀드 1초: 샘플 ${hold.length}개, 총 이동 ${(hold.at(-1)-hold[0]).toFixed(3)}`);
console.log('  clawX:', hold.filter((_,i)=>i%8===0).map(v=>v.toFixed(2)).join(' → '));
console.log(`  프레임당: 평균 ${(d.reduce((a,b)=>a+b,0)/d.length).toFixed(4)}, 최대 ${Math.max(...d).toFixed(4)}, 0인 프레임 ${d.filter(v=>Math.abs(v)<1e-6).length}개`);

// [B] 하강 — clawY 샘플링
const drop = await page.evaluate(async () => {
  document.querySelector('.dropbtn')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 8 }));
  const samples = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 1400) {
    const st = window.__game?.getRenderState();
    samples.push({ t: Math.round(performance.now() - t0), y: +(st?.clawY ?? 0).toFixed(3), p: st?.phase });
    await new Promise(r => requestAnimationFrame(r));
  }
  return samples;
});
console.log(`\n[B] 하강: 샘플 ${drop.length}개`);
console.log('  ' + drop.filter((_,i)=>i%7===0).map(s=>`${s.t}ms:${s.y}`).join(' '));
const dropOnly = drop.filter(s=>s.p==='DROP');
console.log(`  DROP 지속 ${dropOnly.length}프레임, 시간 ${dropOnly.length ? dropOnly.at(-1).t - dropOnly[0].t : 0}ms`);
const yd = drop.slice(1).map((s,i)=>Math.abs(s.y-drop[i].y));
console.log(`  프레임당 하강 최대 ${Math.max(...yd).toFixed(4)}`);

await browser.close();
