/**
 * 구슬 더미 생성 — 정적 비주얼 평가용.
 *
 * 스파이크는 게임 로직이 없으므로 물리 엔진을 붙이지 않고,
 * 간단한 완화(relaxation)로 자연스러운 더미를 만든다.
 * 중력으로 바닥에 붙이고 겹침을 밀어내는 것을 반복하면
 * 물리 엔진 없이도 육안으로 충분한 쌓임이 나온다.
 *
 * pileDepthLayers = 1 이면 z가 0에 고정되어 현재 2D 물리와 같은 평면 배치가 된다.
 * 레퍼런스와 비교해 깊이가 룩에 얼마나 기여하는지 이 값으로 확인할 수 있다.
 */

import { pickColorIndex } from './config';
import type { BallKind } from './config';

export interface Ball {
  id: number;
  x: number;
  y: number;
  z: number;
  r: number;
  colorIndex: number;
  kind: BallKind;
  isMetal: boolean;
  /** 로고 데칼을 붙일 구슬인지 — 레퍼런스는 일부 구슬에만 로고가 있다 */
  hasDecal: boolean;
  rotation: [number, number, number];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PileOptions {
  count: number;
  radius: number;
  depthLayers: number;
  boxWidth: number;
  boxDepth: number;
  seed?: number;
}

export function buildPile(opts: PileOptions): Ball[] {
  const balls = spawn(opts);
  const { radius: r, depthLayers, boxWidth, boxDepth } = opts;
  relax(balls, {
    halfW: boxWidth / 2 - r * 1.05,
    halfD: depthLayers <= 1 ? 0 : boxDepth / 2 - r * 1.15,
    floorY: -r,
    iterations: 420,
  });
  return balls;
}

function spawn(opts: PileOptions): Ball[] {
  const { count, radius: r, depthLayers, boxWidth, boxDepth } = opts;
  const rng = mulberry32(opts.seed ?? 20260805);

  const halfW = boxWidth / 2 - r * 1.05;
  const halfD = depthLayers <= 1 ? 0 : boxDepth / 2 - r * 1.15;
  const floorY = -r;

  const balls: Ball[] = [];
  for (let i = 0; i < count; i++) {
    // 은색 비율. 30%로 두면 화면을 지배해 레퍼런스보다 무거워진다.
    const isMetal = rng() < 0.18;
    const kindRoll = rng();
    const kind: BallKind = isMetal
      ? kindRoll < 0.55
        ? 'ribbed'
        : kindRoll < 0.85
          ? 'coiled'
          : 'smooth'
      : kindRoll < 0.12
        ? 'ribbed'
        : 'smooth';

    balls.push({
      id: i,
      x: (rng() * 2 - 1) * halfW,
      // 위쪽에서 떨어뜨려 완화가 자연스러운 쌓임을 만들게 한다
      y: floorY + r * (1 + rng() * 8),
      z: halfD === 0 ? 0 : (rng() * 2 - 1) * halfD,
      r: r * (0.94 + rng() * 0.12),
      colorIndex: pickColorIndex(rng()),
      kind,
      isMetal,
      hasDecal: !isMetal && rng() < 0.26,
      rotation: [rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2],
    });
  }

  return balls;
}

function relax(
  balls: Ball[],
  { halfW, halfD, floorY, iterations }: { halfW: number; halfD: number; floorY: number; iterations: number },
) {
  for (let it = 0; it < iterations; it++) {
    // 중력 — 뒤로 갈수록 감쇠를 줄여 뭉치지 않게 한다
    for (const b of balls) {
      b.y -= 0.035;
      if (b.y < floorY + b.r) b.y = floorY + b.r;
    }

    // 겹침 해소
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i]!;
      for (let j = i + 1; j < balls.length; j++) {
        const c = balls[j]!;
        let dx = c.x - a.x;
        let dy = c.y - a.y;
        let dz = c.z - a.z;
        const minDist = a.r + c.r;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= minDist * minDist) continue;

        let d = Math.sqrt(d2);
        if (d < 1e-6) {
          // 완전히 겹친 경우 임의 방향으로 분리
          dx = 0.01;
          dy = 0.01;
          dz = 0;
          d = 0.0141;
        }
        const push = (minDist - d) / d / 2;
        const px = dx * push;
        const py = dy * push;
        const pz = dz * push;
        a.x -= px;
        a.y -= py;
        a.z -= pz;
        c.x += px;
        c.y += py;
        c.z += pz;
      }
    }

    // 경계 구속
    for (const b of balls) {
      b.x = Math.max(-halfW, Math.min(halfW, b.x));
      b.z = halfD === 0 ? 0 : Math.max(-halfD, Math.min(halfD, b.z));
      if (b.y < floorY + b.r) b.y = floorY + b.r;
    }
  }
}

/* ---------------- 낙하 시뮬레이션 ---------------- */

/**
 * 완화 솔버를 프레임 단위로 돌려 "구슬이 위에서 떨어져 쌓이는" 애니메이션을 만든다.
 * 대기화면 영상(§레퍼런스 어트랙트 루프)의 핵심 연출이고, 같은 코드로
 * 정적 프레임(수렴까지 한 번에 돌림)과 애니메이션(한 스텝씩)을 모두 얻는다.
 *
 * 물리 정확도가 목적이 아니라 연출이 목적이므로 Rapier 전환 전에도 쓸 수 있다.
 * 실제 게임 플레이는 Rapier 3D로 간다.
 */
export class PileSim {
  readonly balls: Ball[];
  private bounds: { halfW: number; halfD: number; floorY: number };
  private released = 0;

  constructor(opts: PileOptions) {
    const { radius: r, depthLayers, boxWidth, boxDepth } = opts;
    this.balls = spawn(opts);
    this.bounds = {
      halfW: boxWidth / 2 - r * 1.05,
      halfD: depthLayers <= 1 ? 0 : boxDepth / 2 - r * 1.15,
      floorY: -r,
    };
    // 시작 시점에는 전부 박스 위쪽 대기 위치에 둔다
    for (const b of this.balls) b.y += 14;
  }

  /**
   * 한 프레임 진행.
   * releasePerStep: 스텝마다 새로 낙하를 시작할 구슬 수 — 레퍼런스처럼 순차적으로 쏟아지게 한다.
   */
  step(iterations = 1, releasePerStep = 0.5) {
    this.released = Math.min(this.balls.length, this.released + releasePerStep);
    const active = this.balls.slice(0, Math.floor(this.released));
    if (active.length) relax(active, { ...this.bounds, iterations });
  }

  /** 수렴까지 한 번에 — 정적 프레임용 */
  settle(iterations = 420) {
    this.released = this.balls.length;
    relax(this.balls, { ...this.bounds, iterations });
  }

  get progress(): number {
    return this.released / this.balls.length;
  }
}

/** 더미 상단 높이 — 집게 하강 목표 y를 잡을 때 쓴다 */
export function pileTopY(balls: Ball[]): number {
  return balls.reduce((max, b) => Math.max(max, b.y + b.r), -Infinity);
}
