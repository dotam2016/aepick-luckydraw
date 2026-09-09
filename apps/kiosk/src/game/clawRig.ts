/**
 * 집게 기구학 — 물리 콜라이더와 보이는 팔이 공유하는 **단일 출처**.
 *
 * 왜 따로 두는가:
 * 이전에는 `clawGame.ts`(콜라이더)와 `Scene.tsx`(메시)가 각자 팔 형상을 하드코딩했고,
 * 실측 결과 두 값이 전혀 달랐다.
 *
 *   | 닫힘 발끝 | 물리 r=0.574 | 비주얼 r=1.345 |
 *   | 열림 발끝 | 물리 r=0.965 | 비주얼 r=0.986 |
 *
 * 물리는 닫을수록 발끝이 안으로 모이는데(0.965→0.574) 비주얼은 반대로 벌어졌다(0.986→1.345).
 * 벌림 각도의 방향 규약 자체가 서로 반대였다. 결과적으로 화면에서는 발이 구슬 반지름의
 * 두 배 밖에 서 있고 구슬은 집게 몸통을 파고든 채 떠 있었다.
 *
 * 그래서 형상은 여기 한 곳에서만 정의하고, 잡는 위치(구형 조인트 앵커)까지 **기하로 유도한다.**
 * 상수를 손으로 맞추면 언젠가 다시 어긋난다.
 *
 * 좌표: 집게 몸통 원점 기준. 스케일 적용 전(미스케일) 단위.
 * 각도 th: 아래 방향(−Y)에서 벌어진 각. **클수록 열린다** — 물리 쪽 규약으로 통일했다.
 */

import { WORLD } from './layout';

export const CLAW_RIG = {
  /** 어깨(팔 회전축) 높이 */
  hubY: -0.3,
  /** 어깨가 놓인 허브 링의 반지름. 0이면 세 팔이 한 점에서 나와 장난감처럼 보인다 */
  hubRadius: 0.16,
  /** 위팔 — 어깨에서 팔꿈치까지 */
  upperLen: 0.693,
  /** 아래팔 — 팔꿈치에서 발끝까지 */
  lowerLen: 0.801,
  /**
   * 팔꿈치 고정 굽힘각. 아래팔은 위팔보다 이만큼 안쪽으로 꺾인다.
   * 이 굽힘이 있어야 발끝이 구슬 아래로 파고들어 감싼다 — 곧은 팔은 구슬을 밀어낼 뿐이다.
   */
  elbowBend: 1.827,
  /**
   * 잡았을 때. 이 각에서 팔꿈치가 반경 1.15(스케일 적용)에 서는데,
   * 구슬 반지름 0.62의 거의 두 배라 팔이 구슬 실루엣 밖으로 돌아 나온다.
   * 첫 시도(0.85)에서는 팔꿈치가 0.88이라 팔이 구슬에 가려 집게가 덩어리로 보였다.
   */
  closedTilt: 1.15,
  /**
   * 벌렸을 때. 두 제약이 이 값의 상하한을 정한다.
   *  - 발끝 간격(2×0.975=1.95)이 구슬 지름 1.24보다 넓어야 구슬이 발 사이로 들어온다
   *  - 하강 시 발끝(world y 1.41)이 바닥 구슬 상단(1.24)보다 위여야 짓눌러 뚫지 않는다
   */
  openTilt: 1.6,
  /** 발끝 고무 패드 반지름 */
  tipRadius: 0.075,
} as const;

export interface ProngPose {
  /** 어깨 (모든 각도에서 고정) */
  hub: [number, number];
  elbow: [number, number];
  tip: [number, number];
}

/** 벌림각 th에서의 관절 위치 (반경, 높이). 미스케일. */
export function prongPose(th: number): ProngPose {
  const { hubY, hubRadius, upperLen, lowerLen, elbowBend } = CLAW_RIG;
  const ex = hubRadius + upperLen * Math.sin(th);
  const ey = hubY - upperLen * Math.cos(th);
  const lo = th - elbowBend;
  return {
    hub: [hubRadius, hubY],
    elbow: [ex, ey],
    tip: [ex + lowerLen * Math.sin(lo), ey - lowerLen * Math.cos(lo)],
  };
}

/** 0(닫힘)~1(열림) → 벌림각 */
export function tiltFromOpen(open: number): number {
  return CLAW_RIG.closedTilt + open * (CLAW_RIG.openTilt - CLAW_RIG.closedTilt);
}

/**
 * 구형 조인트 앵커 높이 (스케일 적용, 집게 원점 기준).
 *
 * 발끝 3개가 반경 r에 서 있을 때, 반지름 R인 구슬이 그 발끝에 **표면으로 닿는** 중심 높이는
 * 발끝 높이 + √(R² − r²) 이다. 이보다 위면 구슬이 발 사이로 떠오르고(현재 증상),
 * 아래면 발이 구슬을 관통한다.
 */
export function grabAnchorY(ballRadius = WORLD.ballRadius): number {
  const S = WORLD.clawScale;
  const tip = prongPose(CLAW_RIG.closedTilt).tip;
  const r = tip[0] * S;
  const y = tip[1] * S;
  const d2 = ballRadius * ballRadius - r * r;
  // 발끝이 구슬보다 넓게 벌어져 있으면 감쌀 수 없다 — 발끝 높이를 그대로 쓴다(안전값)
  return d2 > 0 ? y + Math.sqrt(d2) : y;
}
