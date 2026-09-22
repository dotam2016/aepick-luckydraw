/**
 * 2D 스킨 — 스프라이트로 조립한 캐비닛·집게·하트 더미.
 *
 * 3D `Scene.tsx`를 대체하는 렌더러다. 게임 로직은 그대로 `ClawGame`이 소유하고,
 * 이 컴포넌트는 `RenderState`만 읽어 스프라이트 위치를 쓴다 — 결과·확률·페이즈는
 * 서버와 엔진이 정하고 화면은 그걸 보여주기만 한다는 제1원칙은 변하지 않는다.
 *
 * 겹침 순서가 이 스킨의 전부다. 깊이감은 예쁜 캐비닛 그림이 아니라 **집게가 하트
 * 더미 사이에 끼어 들어간다**는 사실에서 나온다:
 *
 *   패널 · 앞턱
 *   하트 바깥층            heartsFront   ← 집게를 가린다
 *   몸통 · 관 · 왼팔
 *   잡힌 하트              grabLayer
 *   오른팔                              ← 잡힌 하트에 가린다
 *   하트 중간층 + 안쪽층   heartsBack    ← 집게가 가린다
 *   바닥 · 레일 · 배경
 *
 * 좌표계는 1080×1920 설계 박스. 필드는 상단 1301px(`SCREEN.fieldHeight`).
 */

import { useEffect, useRef } from 'react';
import { assetUrl } from '../assetUrl';
import { WORLD } from './layout';
import type { ClawGame } from './clawGame';

/* ---------- 배치 상수 — layout-test.html에서 눈으로 맞춘 값 ---------- */
export const SKIN = {
  railY: 78,
  floorY: 1223,
  ledgeY: 1256,
  carriageY: 96,
  tubeTop: 268,
  tubeMin: 120,
  tubeMax: 800,
  hubOverlap: 10,
  prongDx: 92,
  prongDy: 96,
  /** 팔 회전각(도). 양수 = 바깥으로 벌림, 음수 = 안으로 오므림 */
  prongOpen: 22,
  prongClose: 2,
  clawRange: 285,
  heartSize: 296.4,
  clawTop: 9,
  heartsTop: 60,
  heartsLeft: -80,
  grabDy: 166,
} as const;

const CONTAINER_H = 1412;
const PILE_BOTTOM = 1275;

/** 하트 더미 — 깊이 3층. 먼 층일수록 화면에서 높고 작다 */
const ROWS = [
  { lift: 112, scale: 0.8, xs: [96, 232, 368, 504, 640, 776, 900] },
  { lift: 55, scale: 0.9, xs: [150, 296, 442, 588, 734, 866] },
  { lift: -20, scale: 1.0, xs: [118, 268, 418, 568, 718, 862] },
];

/**
 * 집게가 더미를 헤집는 정도.
 *
 * 힘은 관 길이가 아니라 **발끝이 그 하트 꼭대기보다 얼마나 아래로 파고들었는지**로
 * 정한다. 관 길이로 재면 집게가 아직 천장 근처인데 더미가 먼저 움직여 가짜로 보인다.
 */
const DIG = {
  radius: 210,
  bite: 100,
  depth: 100,
  push: 48,
  lift: 16,
  spin: 24,
  keep: 0.25,
  drift: 40,
  twist: 22,
} as const;

interface Heart {
  el: HTMLImageElement;
  size: number;
  row: number;
  seed: number;
  /** 원래 자리 — 여러 판에 걸쳐도 여기서 크게 벗어나지 않게 잡아둔다 */
  xOrig: number;
  rotOrig: number;
  /** 판이 끝날 때마다 조금씩 밀리는 기준점 */
  x0: number;
  rot0: number;
  bottom0: number;
  top: number;
  h: number;
}

/**
 * game이 없으면 **대기화면용 정지 모드**다 — 물리 엔진 없이 기계만 세워 둔다.
 * 집게는 가운데·맨 위에서 오므린 자세로 멈춘다.
 */
export function Cabinet2D({ game }: { game?: ClawGame }) {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<HTMLDivElement | null>(null);
  const frontRef = useRef<HTMLDivElement | null>(null);
  const grabRef = useRef<HTMLDivElement | null>(null);
  const clawBackRef = useRef<HTMLDivElement | null>(null);
  const clawFrontRef = useRef<HTMLDivElement | null>(null);
  const tubeRef = useRef<HTMLImageElement | null>(null);
  const hubRef = useRef<HTMLImageElement | null>(null);
  const prongLRef = useRef<HTMLImageElement | null>(null);
  const prongRRef = useRef<HTMLImageElement | null>(null);

  /* ---------- 더미 생성 (한 번) ---------- */
  const heartsRef = useRef<Heart[]>([]);
  useEffect(() => {
    const back = backRef.current;
    const front = frontRef.current;
    if (!back || !front) return;
    back.replaceChildren();
    front.replaceChildren();

    const list: Heart[] = [];
    ROWS.forEach((row, ri) => {
      row.xs.forEach((x, ci) => {
        const size = SKIN.heartSize * row.scale;
        const im = document.createElement('img');
        im.src = assetUrl(`/assets/cabinet/heart${((ri * 3 + ci) % 5) + 1}.png`);
        im.alt = '';
        im.style.width = `${size}px`;
        im.style.height = 'auto';
        im.style.zIndex = String(ri);

        const jitter = ((ri * 7 + ci * 13) % 11) - 5;
        // 한 바퀴 고르게 — 눕고 서고 뒤집힌 하트가 섞이게
        const rot = ((ri * 137 + ci * 83) % 360) - 180;
        const bottom = CONTAINER_H - PILE_BOTTOM + row.lift - jitter;
        // 파일마다 종횡비가 달라(1.088~1.149) 높이는 로드 후에 재야 한다.
        // 그 전에는 1.12로 어림잡아 첫 프레임이 비지 않게 한다.
        const h: Heart = {
          el: im,
          size,
          row: ri,
          seed: ((ri * 61 + ci * 97) % 100) / 100,
          xOrig: x,
          rotOrig: rot,
          x0: x,
          rot0: rot,
          bottom0: bottom,
          h: size / 1.12,
          top: CONTAINER_H - bottom - size / 1.12,
        };
        im.addEventListener('load', () => {
          h.h = im.offsetHeight;
          h.top = CONTAINER_H - h.bottom0 - h.h;
        });
        im.style.left = `${x}px`;
        im.style.bottom = `${bottom}px`;
        im.style.transform = `rotate(${rot}deg)`;
        (ri === 2 ? front : back).appendChild(im);
        list.push(h);
      });
    });
    heartsRef.current = list;
  }, []);

  /* ---------- 매 프레임 반영 ---------- */
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;

    let raf = 0;
    let grabEl: HTMLImageElement | null = null;
    let grabbedIdx: number | null = null;
    let settled = false;

    const st = field.style;

    /* 정지 모드 — 한 번만 자세를 잡고 루프를 돌지 않는다 */
    if (!game) {
      const hubY = SKIN.tubeTop + SKIN.tubeMin - SKIN.hubOverlap;
      st.setProperty('--claw-x', '0px');
      st.setProperty('--claw-sway', '0deg');
      st.setProperty('--tube-h', `${SKIN.tubeMin}px`);
      st.setProperty('--hub-y', `${hubY}px`);
      st.setProperty('--prong-y', `${hubY + SKIN.prongDy}px`);
      st.setProperty('--prong-a', `${-SKIN.prongClose}deg`);
      return;
    }

    const frame = () => {
      const rs = game.getRenderState();

      /* 집게 가로 위치: 월드 ±clawMaxX → 화면 ±clawRange */
      const clawPx =
        Math.max(-1, Math.min(1, rs.clawX / WORLD.clawMaxX)) * SKIN.clawRange;

      /* 집게 높이: 월드 clawHomeY..clawDropY → 관 길이 tubeMin..tubeMax */
      const span = WORLD.clawHomeY - WORLD.clawDropY;
      const drop = Math.max(0, Math.min(1, (WORLD.clawHomeY - rs.clawY) / span));
      const tube = SKIN.tubeMin + drop * (SKIN.tubeMax - SKIN.tubeMin);

      const open = Math.max(0, Math.min(1, rs.clawOpen));
      const angle = open * SKIN.prongOpen - (1 - open) * SKIN.prongClose;
      const hubY = SKIN.tubeTop + tube - SKIN.hubOverlap;
      const prongY = hubY + SKIN.prongDy;

      st.setProperty('--claw-x', `${clawPx.toFixed(1)}px`);
      st.setProperty('--claw-sway', `${(rs.swayAngle * 12).toFixed(2)}deg`);
      st.setProperty('--tube-h', `${tube.toFixed(1)}px`);
      st.setProperty('--hub-y', `${hubY.toFixed(1)}px`);
      st.setProperty('--prong-y', `${prongY.toFixed(1)}px`);
      st.setProperty('--prong-a', `${angle.toFixed(1)}deg`);

      /* ---- 잡힌 하트 ---- */
      const grab = grabRef.current;
      if (grab) {
        if (rs.grabbedColorIndex !== null && rs.grabbedColorIndex !== grabbedIdx) {
          grabbedIdx = rs.grabbedColorIndex;
          if (!grabEl) {
            grabEl = document.createElement('img');
            grabEl.alt = '';
            grabEl.style.width = `${SKIN.heartSize}px`;
            grabEl.style.height = 'auto';
            grab.appendChild(grabEl);
          }
          grabEl.src = assetUrl(`/assets/cabinet/heart${(grabbedIdx % 5) + 1}.png`);
        } else if (rs.grabbedColorIndex === null && grabEl) {
          grabEl.remove();
          grabEl = null;
          grabbedIdx = null;
        }
        if (grabEl) {
          grabEl.style.left = `${(540 + clawPx - SKIN.heartSize / 2).toFixed(1)}px`;
          grabEl.style.top = `${(hubY + SKIN.clawTop + SKIN.grabDy).toFixed(1)}px`;
        }
      }

      /* ---- 더미 헤집기 ---- */
      const a = (angle * Math.PI) / 180;
      // 팔 이미지 216px, 회전축이 위에서 12% 지점 → 축~발끝 190px.
      // cos를 빼면 팔이 벌어졌을 때 발끝을 실제보다 낮게 잡아 더미가 일찍 움직인다.
      const tipY =
        prongY + 25.9 + 190.1 * Math.cos(a) + SKIN.clawTop - SKIN.heartsTop;
      const cx = 540 + clawPx - SKIN.heartsLeft;

      for (const h of heartsRef.current) {
        const d = h.x0 + h.size / 2 - cx;
        const t = Math.max(0, 1 - Math.abs(d) / DIG.radius);
        const dig = Math.max(0, Math.min(1, (tipY - h.top - DIG.bite) / DIG.depth));
        if (t === 0 || dig === 0) {
          h.el.style.left = `${h.x0}px`;
          h.el.style.bottom = `${h.bottom0}px`;
          h.el.style.transform = `rotate(${h.rot0}deg)`;
          continue;
        }
        const w = t * t * dig * (h.row === 0 ? 0.35 : 1);
        const dir = d === 0 ? (h.seed < 0.5 ? -1 : 1) : Math.sign(d);
        h.el.style.left = `${(h.x0 + dir * DIG.push * w * (0.6 + h.seed * 0.8)).toFixed(1)}px`;
        h.el.style.bottom = `${(h.bottom0 - DIG.lift * w * h.seed).toFixed(1)}px`;
        h.el.style.transform = `rotate(${(h.rot0 + dir * DIG.spin * w * (0.5 + h.seed)).toFixed(1)}deg)`;
      }

      /* 판이 끝나면 헤집힌 자국을 조금 남긴다 — 매 판 똑같은 더미로 되돌아가지 않게.
         원래 자리에서 ±drift/±twist 안으로 묶어 여러 판을 해도 흘러가지 않는다. */
      if (rs.phase === 'LIFT' && !settled) {
        settled = true;
        for (const h of heartsRef.current) {
          const nx = h.x0 + (parseFloat(h.el.style.left) - h.x0) * DIG.keep;
          h.x0 = Math.max(h.xOrig - DIG.drift, Math.min(h.xOrig + DIG.drift, nx));
          const cur = parseFloat(h.el.style.transform.replace(/[^-\d.]/g, '')) || h.rot0;
          const nr = h.rot0 + (cur - h.rot0) * DIG.keep;
          h.rot0 = Math.max(h.rotOrig - DIG.twist, Math.min(h.rotOrig + DIG.twist, nr));
        }
      } else if (rs.phase === 'AIM' || rs.phase === 'READY') {
        settled = false;
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [game]);

  const src = (p: string) => assetUrl(`/assets/cabinet/${p}`);

  return (
    <div className="cab2d" ref={fieldRef}>
      <img className="cab-bg-cloud" src={src('cloud.png')} alt="" />
      <img className="cab-bg" src={src('background.png')} alt="" />
      <img className="cab-rail" src={src('rail.png')} alt="" />
      <img className="cab-floor" src={src('floor.png')} alt="" />

      {/* 안쪽층 + 중간층 — 집게가 이 위를 지나간다 */}
      <div className="cab-hearts" ref={backRef} />

      {/* 오른팔 — 잡힌 하트 뒤 */}
      <div className="cab-claw" ref={clawBackRef}>
        <img className="cab-prongR" ref={prongRRef} src={src('claw-prong-right.png')} alt="" />
      </div>

      <div className="cab-grab" ref={grabRef} />

      {/* 몸통·관·왼팔 — 잡힌 하트 앞 */}
      <div className="cab-claw" ref={clawFrontRef}>
        <img className="cab-carriage" src={src('claw-carriage.png')} alt="" />
        <img className="cab-tube" ref={tubeRef} src={src('claw-tube.png')} alt="" />
        <img className="cab-prongL" ref={prongLRef} src={src('claw-prong-left.png')} alt="" />
        <img className="cab-hub" ref={hubRef} src={src('claw-hub.png')} alt="" />
      </div>

      {/* 바깥층 — 집게를 가린다 */}
      <div className="cab-hearts" ref={frontRef} />

      <img className="cab-ledge" src={src('front-ledge.png')} alt="" />
    </div>
  );
}
