/**
 * 집게 게임 엔진 (Rapier 3D) — 기획서 v1.1 §7 / 부록 A
 *
 * 제1원칙: 물리는 결과를 만들지 않는다.
 *   - 구슬 더미의 밀림·회전·연쇄 충돌은 Rapier가 실제로 계산한다.
 *   - 대상 구슬의 획득 여부는 서버가 내려준 motion.win에 맞춰
 *     구형 조인트(spherical joint)를 연결·해제하는 방식으로 확정한다.
 *
 * 2D(matter-js)에서 3D(Rapier)로 전환한 이유:
 *   구슬 78개를 z=0 평면에 두면 위로 쌓여 "구슬 벽"이 되어 볼 피트로 읽히지 않는다.
 *   비주얼 스파이크의 depth=1 vs depth=3 비교에서 확인했다.
 *
 * 집게 이동은 1축(X)을 유지한다 — 물리 차원과 조작 축은 별개 결정이다.
 *
 * 렌더링은 포함하지 않는다. 자동 플레이 하네스가 Node에서 이 엔진만 돌려
 * 결과-연출 일치와 물리 안정성을 검증한다 (Rapier는 WASM이라 Node에서 실행된다).
 */

import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { MOTION_TIMING, SPEED_PRESETS, type RevealMode, type SpeedPreset } from '@aepick/shared';
import { MATERIAL, WORLD, pickColorIndex, type BallKind } from './layout';
import { CLAW_RIG, grabAnchorY, prongPose, tiltFromOpen } from './clawRig';

type Rapier = typeof RAPIER_NS;
type World = RAPIER_NS.World;
type RigidBody = RAPIER_NS.RigidBody;
type Collider = RAPIER_NS.Collider;
type ImpulseJoint = RAPIER_NS.ImpulseJoint;

/* ---------------- Rapier 초기화 ---------------- */

let rapier: Rapier | null = null;
let instanceSeq = 0;
/** 진단용 — 생성·해제 추적. 문제가 정리되면 제거한다. */
export const physicsDebug = { created: 0, destroyed: 0, initCalls: 0, live: new Set<number>() };

/**
 * Rapier WASM 초기화.
 *
 * 반드시 **프로미스를 캐시**해야 한다. 결과만 캐시하면 동시 호출이 둘 다
 * `rapier === null`을 보고 `RAPIER.init()`을 두 번 부르는데,
 * 두 번째 init이 WASM 메모리를 교체해 이미 만들어진 World가 무효화된다
 * (증상: "memory access out of bounds"). React StrictMode가 effect를 두 번
 * 실행하므로 개발 모드에서 반드시 재현된다.
 */
let rapierPromise: Promise<Rapier> | null = null;

export function initPhysics(): Promise<Rapier> {
  if (!rapierPromise) {
    rapierPromise = (async () => {
      const mod = await import('@dimforge/rapier3d-compat');
      const R = ((mod as unknown as { default?: Rapier }).default ?? mod) as Rapier;
      physicsDebug.initCalls++;
      await R.init();
      rapier = R;
      return R;
    })();
  }
  return rapierPromise;
}

export function isPhysicsReady(): boolean {
  return rapier !== null;
}

/* ---------------- 페이즈 ---------------- */

export type Phase = 'READY' | 'AIM' | 'DROP' | 'GRAB' | 'LIFT' | 'REVEAL' | 'DONE';

export interface ClawGameOptions {
  seed: number;
  ballCount?: number;
  aimSeconds: number;
  speedPreset: SpeedPreset;
  /** 서버가 확정한 결과. 물리는 이 값을 표현할 뿐이다. */
  win: boolean;
  missVariant: number;
  revealMode: RevealMode;
  tutorialMs: number;
  disableTimeout?: boolean;
  onPhase?: (phase: Phase) => void;
  onCatchLocked?: () => void;
}

export interface PlayOutcome {
  aimDurationMs: number;
  /** 정규화 좌표 0~1 */
  catchX: number;
  autoCatch: boolean;
}

/* ---------------- 유틸 ---------------- */

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

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInQuad = (t: number) => t * t;

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** (0,1,0)에서 dir로 향하는 회전 쿼터니언. three.js 의존 없이 계산한다(Node 실행 유지). */
function quatFromUpTo(dx: number, dy: number, dz: number): Quat {
  const len = Math.hypot(dx, dy, dz) || 1;
  const x = dx / len;
  const y = dy / len;
  const z = dz / len;
  // up = (0,1,0). 축 = up × dir, 각 = acos(up·dir)
  const dot = y;
  if (dot > 0.999999) return { x: 0, y: 0, z: 0, w: 1 };
  if (dot < -0.999999) return { x: 1, y: 0, z: 0, w: 0 }; // 180° around X
  const ax = -z;
  const ay = 0;
  const az = x;
  const alen = Math.hypot(ax, ay, az) || 1;
  const angle = Math.acos(clamp(dot, -1, 1));
  const s = Math.sin(angle / 2);
  return { x: (ax / alen) * s, y: (ay / alen) * s, z: (az / alen) * s, w: Math.cos(angle / 2) };
}

/* ---------------- 구슬 메타 ---------------- */

export interface BallMeta {
  handle: number;
  colorIndex: number;
  kind: BallKind;
  isMetal: boolean;
  hasDecal: boolean;
  /** 데칼 배치 변형. 전 구슬이 같은 배치면 더미에서 반복이 눈에 띈다 */
  decalVariant: number;
  radius: number;
}

export interface BallView {
  x: number;
  y: number;
  z: number;
  /** 쿼터니언 */
  q: [number, number, number, number];
  r: number;
  colorIndex: number;
  kind: BallKind;
  isMetal: boolean;
  hasDecal: boolean;
  decalVariant: number;
  grabbed: boolean;
}

export interface RenderState {
  phase: Phase;
  /** 레일 위 캐리지의 X — 집게는 여기 매달려 흔들린다 */
  carriageX: number;
  clawX: number;
  clawY: number;
  /** 케이블 진자 각도(rad). 렌더러는 이 각도로 집게 그룹을 회전시킨다 */
  swayAngle: number;
  /** 0 = 완전 닫힘, 1 = 완전 열림 */
  clawOpen: number;
  prongSkew: number;
  balls: BallView[];
  aimRemainingMs: number;
  aimTotalMs: number;
  revealProgress: number;
  capsuleOpenProgress: number;
  grabbedColorIndex: number | null;
  shake: number;
}

const PRONG_COUNT = 3;

/*
 * 충돌 그룹 (상위 16비트 = 소속, 하위 16비트 = 충돌 대상 필터).
 *
 * 잡힌 구슬은 구형 조인트가 앵커로 끌어당기는 동시에 발 콜라이더가 밀어낸다.
 * 두 힘이 매 스텝 싸우면 구슬이 집게 안에서 미세하게 떨린다("덜그럭").
 * 잡는 동안만 구슬↔집게 충돌을 꺼서 이 다툼을 없앤다 —
 * 조인트가 이미 위치를 확정하므로 콜라이더가 할 일이 없다.
 */
const G_BALL = 0x0001;
const G_CLAW = 0x0002;
const ALL = 0xffff;
const GROUPS_BALL = (G_BALL << 16) | ALL;
const GROUPS_BALL_HELD = (G_BALL << 16) | (ALL & ~G_CLAW);
const GROUPS_CLAW = (G_CLAW << 16) | ALL;

/* 발 형상·각도는 clawRig.ts가 단독으로 정한다. 여기서 다시 정의하면 화면과 어긋난다. */
const GRAB_ANCHOR_Y = grabAnchorY();

const EMPTY_STATE: RenderState = {
  phase: 'DONE',
  carriageX: 0,
  clawX: 0,
  swayAngle: 0,
  clawY: WORLD.clawHomeY,
  clawOpen: 0,
  prongSkew: 0,
  balls: [],
  aimRemainingMs: 0,
  aimTotalMs: 1,
  revealProgress: 0,
  capsuleOpenProgress: 0,
  grabbedColorIndex: null,
  shake: 0,
};

/* ---------------- 엔진 ---------------- */

export class ClawGame {
  private R: Rapier;
  private world: World;
  private balls: RigidBody[] = [];
  private meta = new Map<number, BallMeta>();
  private clawBody: RigidBody;
  private prongColliders: Collider[] = [];
  private palm: Collider;
  private grabJoint: ImpulseJoint | null = null;
  private grabbedBall: RigidBody | null = null;
  private grabPrevAngularDamping: number | null = null;

  private opts: ClawGameOptions;
  private rng: () => number;

  phase: Phase = 'READY';
  private phaseElapsed = 0;
  private clock = 0;

  private targetT = 0.5;
  /** 레일 캐리지 위치 — 조작 대상 */
  private carriageX = 0;
  /** 실제 집게 위치 = 캐리지 + 진자 오프셋 */
  private clawX = 0;
  private clawVx = 0;
  private clawY: number = WORLD.clawHomeY;
  private clawOpen = 1;
  private prongSkew = 0;

  private aimElapsed = 0;
  private aimTotalMs: number;
  private inputLocked = true;
  private catchXAtLock = 0.5;
  private autoCatch = false;
  private shake = 0;
  private missDetached = false;
  private capsuleOpen = 0;

  /*
   * 집게는 케이블에 매달려 있다. 캐리지(레일 블록)가 좌우로 움직이면 집게는
   * 진자처럼 뒤따라 흔들려야 한다. 강체 조인트 대신 진자 운동방정식을 직접 적분한다 —
   * 페이즈 타이밍이 결정적으로 유지되고(하네스가 이에 의존한다), 거동은 물리적으로 동일하다.
   *
   *   θ'' = -(g/L)·sinθ − c·θ' − (a/L)·cosθ      a = 캐리지 수평 가속도
   */
  private swayAngle = 0;
  private swayVel = 0;
  private prevVx = 0;
  /** 캐비닛 흔들림 가속도(대기 영상 전용). 진자 구동항에 더해진다 */
  private shakeAx = 0;
  private static readonly SWAY_DAMPING = 2.4;
  /**
   * 흔들림 상한은 각도가 아니라 **수평 변위**로 건다.
   * 케이블 길이 L은 하강할수록 길어지므로(홈 2.6 → 하강 8.15), 각도로만 제한하면
   * 같은 각도에서도 하강 중 변위가 3배로 커진다. 집게가 옆으로 끌려가며 구슬을
   * 벽에 끼워 안전망이 발동했다(실측: 최대 초과 0.441 → 0.752, 영구 진동 5회차).
   */
  private static readonly SWAY_MAX_OFFSET = 0.5;

  private accumulator = 0;
  private static readonly FIXED_STEP_MS = 1000 / 60;

  /**
   * 해제 여부. world.free() 이후 Rapier WASM 메모리에 접근하면
   * "memory access out of bounds"로 죽는다. R3F 렌더 루프는 자체 rAF로 돌기 때문에
   * Play 언마운트 직후에도 프레임 하나가 더 들어올 수 있으므로 가드가 필요하다.
   */
  readonly id: number;
  private destroyed = false;
  /** 해제 후에도 렌더러가 마지막 프레임을 안전하게 그릴 수 있도록 스냅샷을 남긴다 */
  private lastState: RenderState | null = null;

  /** 물리 안정성 계측 — §16.2 / §14 인수 기준 */
  readonly diagnostics = {
    outOfBounds: 0,
    explosive: 0,
    nan: 0,
    maxSpeed: 0,
    steps: 0,
    /** 격리 안전망이 구슬을 되돌린 횟수 */
    contained: 0,
    /** 안전망이 되돌린 최대 초과 거리. 구슬 반지름 미만이면 순간 오버슈트로 본다. */
    containWorst: 0,
  };

  /**
   * 구슬 속도 상한. 키네마틱 집게가 더미를 밀 때 드물게 큰 속도가 발생한다.
   * 상한을 두면 §16.2의 "폭발적으로 튀는 현상이 없다"를 운에 맡기지 않고 보장하고,
   * 구슬 지름의 절반 미만이므로 터널링도 함께 막는다.
   */
  private static readonly MAX_BALL_SPEED = 26;

  constructor(opts: ClawGameOptions) {
    if (!rapier) {
      throw new Error('initPhysics()를 먼저 await 하세요. Rapier WASM 초기화가 필요합니다.');
    }
    this.R = rapier;
    this.id = ++instanceSeq;
    physicsDebug.created++;
    physicsDebug.live.add(this.id);
    this.opts = opts;
    this.rng = mulberry32(opts.seed);
    this.aimTotalMs = opts.aimSeconds * 1000;

    this.world = new this.R.World({ x: 0, y: WORLD.gravity, z: 0 });
    this.world.timestep = 1 / 60;

    this.buildCabinet();
    const { body, prongs, palm } = this.buildClaw();
    this.clawBody = body;
    this.prongColliders = prongs;
    this.palm = palm;
    this.spawnBalls();

    /*
     * 사전 안정화 동안 집게를 박스 위로 치워둔다.
     * 홈 위치(y=8.5)에 두면 위에서 떨어지는 구슬이 집게 팔·손바닥에 얹혀
     * AIM 진입 시 이미 구슬을 물고 있는 것처럼 보인다.
     */
    this.clawY = WORLD.boxHeight + 3;
    this.syncClaw();
    for (let i = 0; i < 300; i++) {
      this.syncClaw();
      this.world.step();
      // tick()과 동일하게 상한·안전망을 적용한다.
      // 여기서 빠뜨리면 스폰 겹침으로 튕긴 구슬이 바닥을 뚫고 무한 낙하해
      // 첫 tick에서 y=-292 같은 값으로 발견된다(실측).
      this.clampBallSpeeds();
      this.containBalls();
    }
    this.clawY = WORLD.clawHomeY;
    this.syncClaw();
  }

  /* ---------- 캐비닛 ---------- */

  private buildCabinet() {
    const { R, world } = this;
    const { boxWidth: w, boxHeight: h, boxDepth: d } = WORLD;
    // 벽 두께. 얇으면 끼임 시 솔버가 구슬을 밖으로 밀어낼 수 있다.
    // 두께 2면 터널링에 120 units/s가 필요해 속도 상한(26)으로 원천 차단된다.
    const t = 2;
    const fixed = () => world.createRigidBody(R.RigidBodyDesc.fixed());

    const add = (
      hx: number,
      hy: number,
      hz: number,
      x: number,
      y: number,
      z: number,
      friction = 0.4,
    ) => {
      const body = fixed();
      world.createCollider(
        R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(friction).setRestitution(0.05),
        body,
      );
    };

    add(w / 2 + t, t, d / 2 + t, 0, -t, 0); // 바닥
    add(t, h / 2, d / 2, -w / 2 - t, h / 2, 0); // 좌
    add(t, h / 2, d / 2, w / 2 + t, h / 2, 0); // 우
    add(w / 2, h / 2, t, 0, h / 2, -d / 2 - t); // 뒤
    add(w / 2, h / 2, t, 0, h / 2, d / 2 + t); // 앞(유리)
    add(w / 2, t, d / 2, 0, h + t, 0); // 천장
  }

  /* ---------- 집게 ---------- */

  private buildClaw() {
    const { R, world } = this;
    const S = WORLD.clawScale;

    // 키네마틱 위치 기반 — 정적 바디와 달리 구슬에 실제 운동량을 전달한다
    const body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, WORLD.clawHomeY, 0),
    );

    // 손바닥 — 헤드 아래 짧은 원통
    const palm = world.createCollider(
      R.ColliderDesc.cylinder(0.22 * S, 0.26 * S)
        .setTranslation(0, 0.1 * S, 0)
        .setFriction(0.5)
        .setCollisionGroups(GROUPS_CLAW),
      body,
    );

    /*
     * 발 3개 × 마디 2개(위팔·아래팔).
     * 이전에는 발 하나당 캡슐 하나로 곧은 막대였는데, 보이는 팔은 팔꿈치에서 꺾인 2단이었다.
     * 구슬을 실제로 감싸는 것은 안쪽으로 꺾인 **아래팔**이므로 마디를 나눠야
     * 콜라이더와 화면이 일치한다. 콜라이더 3개 추가는 비용상 무시할 수준이다.
     */
    const prongs: Collider[] = [];
    for (let i = 0; i < PRONG_COUNT; i++) {
      prongs.push(
        world.createCollider(
          R.ColliderDesc.capsule((CLAW_RIG.upperLen * S) / 2, 0.085 * S)
            .setFriction(0.7)
            .setRestitution(0.02)
            .setCollisionGroups(GROUPS_CLAW),
          body,
        ),
      );
      prongs.push(
        world.createCollider(
          R.ColliderDesc.capsule((CLAW_RIG.lowerLen * S) / 2, CLAW_RIG.tipRadius * S)
            .setFriction(0.9)
            .setRestitution(0.02)
            .setCollisionGroups(GROUPS_CLAW),
          body,
        ),
      );
    }
    return { body, prongs, palm };
  }

  /** 집게 바디·발 콜라이더를 현재 상태에 맞춰 갱신한다 */
  private syncClaw() {
    const S = WORLD.clawScale;
    this.clawBody.setNextKinematicTranslation({ x: this.clawX, y: this.clawY, z: 0 });

    // 형상은 clawRig가 단독으로 정한다 — 화면의 팔과 같은 함수를 쓴다
    const tilt = tiltFromOpen(this.clawOpen);
    const ca = Math.cos(this.swayAngle);
    const sa = Math.sin(this.swayAngle);

    for (let i = 0; i < PRONG_COUNT; i++) {
      const az = (i / PRONG_COUNT) * Math.PI * 2;
      // §7.1 — 발마다 미세 편차를 주어 기계적 느낌을 강화한다
      const th = tilt + Math.sin(az * 1.7) * this.prongSkew * 0.05;
      const pose = prongPose(th);

      /** (반경, 높이) 로컬 좌표 → 방위각 az·진자각을 적용한 3D 위치 */
      const place = (p: readonly [number, number]): [number, number, number] => {
        const rx = p[0] * S;
        const ry = p[1] * S;
        /*
         * 진자 각도만큼 발도 함께 기울어야 콜라이더가 보이는 것과 일치한다.
         * 부호 주의: swayAngle > 0 은 집게가 +X로 밀린 상태(clawX = carriageX + sin·L)이므로
         * 집게의 아래 방향도 +X 쪽으로 기울어야 한다 = +swayAngle 회전.
         * 이전 코드는 -swayAngle로 돌려 콜라이더가 화면과 반대로 기울어 있었다.
         */
        const x = rx * Math.cos(az);
        const z = rx * Math.sin(az);
        return [x * ca - ry * sa, x * sa + ry * ca, z];
      };

      const hub = place(pose.hub);
      const elbow = place(pose.elbow);
      const tip = place(pose.tip);

      // 위팔 = 어깨→팔꿈치, 아래팔 = 팔꿈치→발끝
      for (const [k, a, b] of [
        [0, hub, elbow],
        [1, elbow, tip],
      ] as const) {
        const c = this.prongColliders[i * 2 + k]!;
        c.setTranslationWrtParent({
          x: (a[0] + b[0]) / 2,
          y: (a[1] + b[1]) / 2,
          z: (a[2] + b[2]) / 2,
        });
        c.setRotationWrtParent(quatFromUpTo(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      }
    }
    void this.palm;
  }

  /* ---------- 구슬 ---------- */

  private spawnBalls() {
    const { R, world, rng } = this;
    const r = WORLD.ballRadius;
    const count = this.opts.ballCount ?? WORLD.ballCount;
    const halfW = WORLD.boxWidth / 2 - r * 1.2;
    const halfD = WORLD.boxDepth / 2 - r * 1.2;

    /*
     * 지터 격자 배치.
     * 완전 무작위로 뿌리면 두 구슬이 거의 같은 좌표에 생겨 솔버가 강하게 밀어내고,
     * 그중 하나가 바닥을 뚫는다. 격자 간격을 지름보다 크게 두고 지터를 여유 안으로 제한한다.
     */
    const spacing = r * 2 * 1.17;
    const cols = Math.max(2, Math.floor((halfW * 2) / spacing));
    const rows = Math.max(1, Math.floor((halfD * 2) / spacing));
    const perLayer = cols * rows;
    const jitter = (spacing - r * 2) / 2;

    for (let i = 0; i < count; i++) {
      const layer = Math.floor(i / perLayer);
      const idx = i % perLayer;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      // 층마다 반 칸 엇갈리게 놓아 자연스럽게 쌓이도록 한다
      const stagger = layer % 2 === 0 ? 0 : spacing * 0.5;
      const isMetal = rng() < MATERIAL.metalRatio;
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
      const radius = r * (0.94 + rng() * 0.12);

      // 위에서 떨어뜨려 자연스러운 더미를 만든다
      const px = clamp(
        -halfW + spacing * 0.5 + col * spacing + stagger + (rng() * 2 - 1) * jitter,
        -halfW,
        halfW,
      );
      const pz = clamp(
        -halfD + spacing * 0.5 + row * spacing + (rng() * 2 - 1) * jitter,
        -halfD,
        halfD,
      );
      const py = r + 0.4 + layer * spacing * 1.05;

      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(px, py, pz)
          .setLinearDamping(0.25)
          .setAngularDamping(0.4)
          .setCcdEnabled(true),
      );
      world.createCollider(
        R.ColliderDesc.ball(radius)
          .setRestitution(0.16) // §7.3 탱탱볼처럼 튀지 않도록 낮게
          .setFriction(0.34)
          .setDensity(1.1)
          .setCollisionGroups(GROUPS_BALL),
        body,
      );

      this.meta.set(body.handle, {
        handle: body.handle,
        colorIndex: pickColorIndex(rng()),
        kind,
        isMetal,
        hasDecal: !isMetal && rng() < MATERIAL.decalRatio,
        decalVariant: Math.floor(rng() * 4),
        radius,
      });
      this.balls.push(body);
    }
  }

  /* ---------- 입력 (1축) ---------- */

  setTarget(t: number) {
    if (this.inputLocked) return;
    this.targetT = clamp(t, 0, 1);
  }

  /** 버튼 홀드 — 조작부의 좌·우 버튼에서 호출 */
  nudge(dir: -1 | 1, dtMs: number) {
    if (this.inputLocked) return;
    const speed = SPEED_PRESETS[this.opts.speedPreset];
    this.targetT = clamp(this.targetT + dir * speed * (dtMs / 1000), 0, 1);
  }

  /** §4.2 — 첫 입력만 상태 전이를 유발한다. 디바운스가 아니라 상태 잠금으로 구현. */
  triggerCatch(auto = false): boolean {
    if (this.phase !== 'AIM') return false;
    this.inputLocked = true;
    this.autoCatch = auto;
    // 조작 결과를 기록하는 값이므로 흔들림이 아닌 캐리지 위치를 쓴다
    this.catchXAtLock = (this.carriageX + WORLD.clawMaxX) / (WORLD.clawMaxX * 2);
    this.opts.onCatchLocked?.();
    this.setPhase('DROP');
    return true;
  }

  get canCatch() {
    return this.phase === 'AIM';
  }

  getOutcome(): PlayOutcome {
    return {
      aimDurationMs: Math.round(this.aimElapsed),
      catchX: Number(clamp(this.catchXAtLock, 0, 1).toFixed(4)),
      autoCatch: this.autoCatch,
    };
  }

  /* ---------- 페이즈 ---------- */

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseElapsed = 0;
    this.opts.onPhase?.(p);
  }

  private phaseDuration(): number {
    switch (this.phase) {
      case 'READY':
        return this.opts.tutorialMs;
      case 'DROP':
        return MOTION_TIMING.drop;
      case 'GRAB':
        return MOTION_TIMING.closeAndCollide;
      case 'LIFT':
        return MOTION_TIMING.lift;
      case 'REVEAL':
        return this.opts.revealMode === 'capsuleOpen'
          ? MOTION_TIMING.reveal + 700
          : MOTION_TIMING.reveal;
      default:
        return Infinity;
    }
  }

  /* ---------- 대상 구슬 선택 · 보조 조인트 ---------- */

  private pickTargetBall(): RigidBody | null {
    let best: RigidBody | null = null;
    let bestScore = Infinity;
    for (const b of this.balls) {
      const p = b.translation();
      const dx = p.x - this.clawX;
      const dy = p.y - (this.clawY - 0.9 * WORLD.clawScale);
      const dz = p.z - 0; // 집게는 z=0에 있다
      // 수평 거리를 우선하되 깊이도 고려한다 (3D 전환으로 z 항이 추가됨)
      const score = Math.abs(dx) * 1.0 + Math.abs(dz) * 0.85 + Math.abs(dy) * 0.55;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  private attachGrab(ball: RigidBody) {
    const S = WORLD.clawScale;
    ball.wakeUp();
    this.grabbedBall = ball;
    /*
     * 구형 조인트(볼-소켓)는 진자처럼 흔들린다 —
     * §16.2 "집게 중심에 고정된 것처럼 보이지 않고 상승 중 제한된 흔들림"에 부합한다.
     * matter-js의 소프트 Spring Constraint를 대체한다.
     */
    /*
     * 앵커 위치는 발끝이 구슬 표면에 닿는 지점이다(기하로 계산).
     * 이전 값(-0.95·S = -1.38)은 발끝보다 훨씬 아래여서 구슬이 발 밖에 매달렸다.
     */
    this.grabJoint = this.world.createImpulseJoint(
      this.R.JointData.spherical({ x: 0, y: GRAB_ANCHOR_Y, z: 0 }, { x: 0, y: 0, z: 0 }),
      this.clawBody,
      ball,
      true,
    );

    /*
     * 구형 조인트는 회전을 구속하지 않아 잡힌 구슬이 공중에서 계속 자전한다.
     * 잡는 동안만 각감쇠를 크게 올려 회전을 멈추고, 위치 진자 흔들림은 남긴다.
     */
    this.grabPrevAngularDamping = ball.angularDamping();
    ball.setAngularDamping(14);
    ball.setAngvel({ x: 0, y: 0, z: 0 }, true);

    // 집게와의 충돌을 끈다 — 조인트와 발 콜라이더가 싸우면 구슬이 집게 안에서 떤다.
    // 진단 도구가 수정 전 거동과 비교할 수 있게 전역 스위치를 남긴다(tools/diag/rattle.mts).
    if (!(globalThis as Record<string, unknown>).__GRAB_COLLIDE__) {
      for (let i = 0; i < ball.numColliders(); i++) {
        ball.collider(i)?.setCollisionGroups(GROUPS_BALL_HELD);
      }
    }
  }

  /**
   * 캐비닛이 흔들릴 때 구슬이 받는 겉보기 힘(관성력)을 준다 — 대기화면(어트랙트)용.
   *
   * 레퍼런스 실측: 대기 영상의 "덜그럭"은 구슬이 각자 튀는 것이 아니라
   * **박스 전체가 약 1.9Hz로 흔들리는** 것이었다(정지 구간에서는 박스 엣지가 픽셀 단위로
   * 고정되고, 버스트 구간에서만 화면폭의 ±4.8%만큼 이동한다).
   *
   * 박스를 실제로 움직이는 대신 **박스 좌표계에서 본 관성력**을 중력에 더한다.
   * 정적인 벽·키네마틱 집게는 중력을 받지 않으므로 자동으로 박스에 붙어 있고,
   * 동적인 구슬만 밀려 상대적으로 출렁인다 — 화면에서는 카메라를 같이 흔들어 완성한다.
   *
   * 처음 시도한 `agitate()`(구슬 개별 충격)는 세기를 26배 올려도 화면이 거의 변하지 않았다.
   * 기구가 틀렸던 것이지 세기가 부족했던 게 아니다.
   */
  setShakeAccel(ax: number, ay: number, az: number, clawAx = ax): void {
    if (this.destroyed) return;
    // 집게는 케이블에 매달려 있으므로 같은 흔들림을 진자 구동항으로 받는다(비율은 별도)
    this.shakeAx = clawAx;
    this.world.gravity = { x: ax, y: WORLD.gravity + ay, z: az };
    // 흔들리는 동안 잠든 구슬도 깨워야 힘이 전달된다
    if (ax !== 0 || ay !== 0 || az !== 0) {
      for (const b of this.balls) b.wakeUp();
    }
  }

  private detachGrab(lateralImpulse = 0) {
    if (this.grabbedBall) {
      // 충돌 복구 — 놓친 구슬은 다시 집게에 부딪히며 떨어져야 한다
      for (let i = 0; i < this.grabbedBall.numColliders(); i++) {
        this.grabbedBall.collider(i)?.setCollisionGroups(GROUPS_BALL);
      }
    }
    if (this.grabbedBall && this.grabPrevAngularDamping !== null) {
      this.grabbedBall.setAngularDamping(this.grabPrevAngularDamping);
      this.grabPrevAngularDamping = null;
    }
    if (this.grabJoint) {
      this.world.removeImpulseJoint(this.grabJoint, true);
      this.grabJoint = null;
    }
    if (this.grabbedBall && lateralImpulse) {
      this.grabbedBall.applyImpulse({ x: lateralImpulse, y: 0, z: lateralImpulse * 0.3 }, true);
    }
    this.grabbedBall = null;
  }

  /** §16.2 — 미획득 연출 최소 3종 변형. 이탈 시점과 방향을 바꾼다. */
  private missReleaseAt(): { progress: number; impulse: number } {
    switch (this.opts.missVariant % 3) {
      case 0:
        return { progress: 0.26, impulse: 1.6 };
      case 1:
        return { progress: 0.4, impulse: -2.0 };
      default:
        return { progress: 0.33, impulse: 0.7 };
    }
  }

  /* ---------- 메인 틱 ---------- */

  tick(dtMs: number) {
    if (this.destroyed) return;
    const dt = Math.min(dtMs, 50);
    this.clock += dt;
    this.phaseElapsed += dt;
    if (this.phase === 'AIM') this.aimElapsed += dt;

    this.updateClawMotion(dt);
    this.advancePhase();

    // 고정 스텝 — 프레임 변동이 물리 결과에 영향을 주지 않는다 (§7.3)
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= ClawGame.FIXED_STEP_MS && steps < 5) {
      this.syncClaw();
      this.world.step();
      this.accumulator -= ClawGame.FIXED_STEP_MS;
      steps++;
      this.diagnostics.steps++;
      this.clampBallSpeeds();
      // audit → contain 순서. audit이 실제 이탈을 먼저 기록하고 contain이 되돌린다.
      // 하네스는 outOfBounds==0으로 물리 자체의 건전성을 판정하고,
      // contained는 운영 안전망이 발동한 횟수로 별도 관측한다.
      this.auditPhysics();
      this.containBalls();
    }
    if (steps === 5) this.accumulator = 0;

    this.shake = Math.max(0, this.shake - dt / 90);
  }

  private updateClawMotion(dt: number) {
    const targetX = (this.targetT * 2 - 1) * WORLD.clawMaxX;

    if (this.phase === 'AIM' || this.phase === 'READY') {
      /*
       * §7.1 Spring-damper. 감쇠진동 표준형: x'' = ω²(target − x) − 2ζω·x'
       *   ζ = 0.70 → 오버슈트 약 4.6%, ω = 11 → 정착 4/(ζω) ≈ 0.52초
       * 실측: 순항 속도가 프리셋 상한과 일치하고 오버슈트는 화면 폭의 0.26%.
       */
      const OMEGA = 11;
      const ZETA = 0.7;
      const dtSec = dt / 1000;
      const ax = OMEGA * OMEGA * (targetX - this.carriageX) - 2 * ZETA * OMEGA * this.clawVx;
      // §4 좌우 이동 속도 프리셋을 그대로 상한으로 쓴다 (월드 단위 환산)
      const maxV = SPEED_PRESETS[this.opts.speedPreset] * WORLD.boxWidth;
      this.clawVx = clamp(this.clawVx + ax * dtSec, -maxV, maxV);
      this.carriageX = clamp(
        this.carriageX + this.clawVx * dtSec,
        -WORLD.clawMaxX,
        WORLD.clawMaxX,
      );
      this.clawOpen = 1;
      // 진자가 흔들림을 담당하므로 발의 유휴 흔들림은 최소로 둔다
      this.prongSkew = Math.sin(this.clock / 620) * 0.18;
      this.updateSway(dtSec);
      return;
    }

    const p = clamp(this.phaseElapsed / this.phaseDuration(), 0, 1);

    if (this.phase === 'DROP') {
      // §7.2 수평 관성 정리 후 하강
      const settle = clamp(this.phaseElapsed / MOTION_TIMING.inertiaSettle, 0, 1);
      this.clawVx *= 1 - settle * 0.12;
      this.carriageX = clamp(
        this.carriageX + this.clawVx * (dt / 1000) * (1 - settle),
        -WORLD.clawMaxX,
        WORLD.clawMaxX,
      );
      this.updateSway(dt / 1000);
      const eased =
        p < 0.82 ? easeInQuad(p / 0.82) * 0.94 : 0.94 + easeOutCubic((p - 0.82) / 0.18) * 0.06;
      this.clawY = WORLD.clawHomeY + eased * (WORLD.clawDropY - WORLD.clawHomeY);
      this.clawOpen = 1;
      return;
    }

    if (this.phase === 'GRAB') {
      this.updateSway(dt / 1000);
      this.clawY = WORLD.clawDropY;
      this.clawOpen = 1 - easeInOutCubic(p);
      this.prongSkew = Math.sin(p * Math.PI);
      return;
    }

    if (this.phase === 'LIFT') {
      this.updateSway(dt / 1000);
      this.clawOpen = 0;
      this.prongSkew = 0;
      const eased = easeInOutCubic(p);
      this.clawY = WORLD.clawDropY + eased * (WORLD.clawHomeY - WORLD.clawDropY);

      if (!this.opts.win && this.opts.revealMode === 'grabMiss' && !this.missDetached) {
        const { progress, impulse } = this.missReleaseAt();
        if (p >= progress) {
          this.detachGrab(impulse);
          this.missDetached = true;
          this.shake = 0.5;
        }
      }
      return;
    }

    if (this.phase === 'REVEAL') {
      this.clawY = WORLD.clawHomeY;
      this.clawOpen = 0;
      if (this.opts.revealMode === 'capsuleOpen') {
        this.capsuleOpen = clamp((this.phaseElapsed - MOTION_TIMING.reveal * 0.4) / 620, 0, 1);
      }
    }
  }

  /**
   * 케이블 진자 적분.
   * 캐리지 가속도가 집게를 뒤로 밀고, 중력이 되돌리고, 감쇠가 잦아들게 한다.
   * 케이블 길이 L은 하강할수록 짧아지므로 하강 중에는 흔들림이 빨라진다 — 실제 기계와 같다.
   */
  private updateSway(dtSec: number) {
    if (dtSec <= 0) return;
    const L = Math.max(0.6, WORLD.railY - 0.3 - this.clawY);
    const g = Math.abs(WORLD.gravity);
    /*
     * 캐리지 가속도에 **캐비닛 흔들림 가속도**를 더한다.
     * 박스가 흔들리면 레일도 함께 움직이므로, 케이블에 매달린 집게는 그만큼 뒤따라 흔들린다.
     * 구슬이 관성력으로 출렁이는 것과 같은 원리이며 값도 같은 출처(attractShake)를 쓴다.
     */
    const a = (this.clawVx - this.prevVx) / dtSec + this.shakeAx;
    this.prevVx = this.clawVx;

    const acc =
      -(g / L) * Math.sin(this.swayAngle) -
      ClawGame.SWAY_DAMPING * this.swayVel -
      (a / L) * Math.cos(this.swayAngle);

    this.swayVel += acc * dtSec;
    this.swayAngle += this.swayVel * dtSec;

    // 수평 변위로 상한을 걸고, 각도를 되풀어 시각·물리가 어긋나지 않게 한다
    let offset = Math.sin(this.swayAngle) * L;
    const maxOff = ClawGame.SWAY_MAX_OFFSET;
    if (Math.abs(offset) > maxOff) {
      offset = Math.sign(offset) * maxOff;
      this.swayAngle = Math.asin(clamp(offset / L, -1, 1));
      this.swayVel *= 0.4;
    }

    // 집게 실제 위치 = 캐리지 + 진자 오프셋. 검증된 안전 범위를 넘지 않는다.
    this.clawX = clamp(this.carriageX + offset, -WORLD.clawMaxX, WORLD.clawMaxX);
  }

  private advancePhase() {
    const dur = this.phaseDuration();
    if (this.phaseElapsed < dur) {
      if (this.phase === 'AIM' && !this.opts.disableTimeout && this.aimElapsed >= this.aimTotalMs) {
        this.triggerCatch(true);
      }
      return;
    }

    switch (this.phase) {
      case 'READY':
        this.inputLocked = false;
        this.setPhase('AIM');
        break;
      case 'DROP':
        this.setPhase('GRAB');
        this.shake = 1;
        break;
      case 'GRAB': {
        const ball = this.pickTargetBall();
        // 획득 연출이 필요한 경우에만 보조 조인트를 연결한다.
        // capsuleOpen(B안)은 결과와 무관하게 항상 획득한다.
        if (ball && (this.opts.win || this.opts.revealMode === 'capsuleOpen')) {
          this.attachGrab(ball);
        } else if (ball && !this.opts.win && this.opts.revealMode === 'grabMiss') {
          // 변형 2는 아예 집히지 않는다(집게가 헛돌음)
          if (this.opts.missVariant % 3 !== 2) this.attachGrab(ball);
          else this.missDetached = true;
        }
        this.setPhase('LIFT');
        break;
      }
      case 'LIFT':
        this.setPhase('REVEAL');
        this.shake = 0.7;
        break;
      case 'REVEAL':
        this.setPhase('DONE');
        break;
      default:
        break;
    }
  }

  /* ---------- 안정성 ---------- */

  private clampBallSpeeds() {
    const max = ClawGame.MAX_BALL_SPEED;
    for (const b of this.balls) {
      const v = b.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed <= max || speed === 0) continue;
      const k = max / speed;
      b.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
    }
  }

  /**
   * §16.2 — "구슬이 화면 밖으로 이탈하거나 영구 진동·폭발적으로 튀는 현상이 없다"
   * 를 런타임에서 실제로 감시한다. 자동 플레이 하네스가 이 카운터를 판정에 쓴다.
   */
  private auditPhysics() {
    const d = this.diagnostics;
    const { boxWidth: w, boxDepth: dp, boxHeight: h } = WORLD;
    for (const b of this.balls) {
      const p = b.translation();
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
        d.nan++;
        continue;
      }
      if (
        Math.abs(p.x) > w / 2 + 1.5 ||
        Math.abs(p.z) > dp / 2 + 1.5 ||
        p.y < -1.5 ||
        p.y > h + 2
      ) {
        d.outOfBounds++;
      }
      const v = b.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed > d.maxSpeed) d.maxSpeed = speed;
      if (speed > 30) d.explosive++;
    }
  }

  /**
   * 격리 안전망. 물리가 어떤 이유로든 뚫려도 구슬이 박스 밖에 남지 않도록
   * 위치를 되돌리고 바깥 방향 속도를 죽인다.
   * §16.2 "구슬이 화면 밖으로 이탈하지 않는다"를 확률이 아니라 구조로 보장한다.
   */
  private containBalls() {
    const { boxWidth: w, boxDepth: d, boxHeight: h } = WORLD;
    /*
     * 솔버 침투 허용치(slop). 바닥에 놓인 구슬의 중심은 반지름보다 살짝 아래에 있고
     * 벽에 닿은 구슬도 미세하게 파고든다. 여유 없이 클램프하면 정상 상태의 구슬을
     * 매 스텝 되돌려(실측 1185만 회) 물리를 망친다. 안전망은 명백한 이탈만 잡아야 한다.
     */
    const EPS = 0.12;
    for (const b of this.balls) {
      const p = b.translation();
      const m = this.meta.get(b.handle)!;
      const maxX = w / 2 - m.radius;
      const maxZ = d / 2 - m.radius;
      const minY = m.radius;
      const maxY = h - m.radius;

      const outX = Math.abs(p.x) > maxX + EPS;
      const outZ = Math.abs(p.z) > maxZ + EPS;
      const outY = p.y < minY - EPS || p.y > maxY + EPS;
      if (!outX && !outZ && !outY) continue;

      const nx = outX ? clamp(p.x, -maxX, maxX) : p.x;
      const nz = outZ ? clamp(p.z, -maxZ, maxZ) : p.z;
      const ny = outY ? clamp(p.y, minY, maxY) : p.y;

      this.diagnostics.contained++;
      const over = Math.max(
        outX ? Math.abs(p.x) - maxX : 0,
        outZ ? Math.abs(p.z) - maxZ : 0,
        outY ? Math.max(minY - p.y, p.y - maxY) : 0,
      );
      if (over > this.diagnostics.containWorst) this.diagnostics.containWorst = over;
      b.setTranslation({ x: nx, y: ny, z: nz }, true);
      const v = b.linvel();
      b.setLinvel(
        {
          x: nx === p.x ? v.x : 0,
          y: ny === p.y ? v.y : 0,
          z: nz === p.z ? v.z : 0,
        },
        true,
      );
    }
  }

  /** 잔여 운동량 — 영구 진동 검출용 */
  movingBallCount(threshold = 0.35): number {
    if (this.destroyed) return 0;
    let n = 0;
    for (const b of this.balls) {
      const v = b.linvel();
      if (Math.hypot(v.x, v.y, v.z) > threshold) n++;
    }
    return n;
  }

  get ballCount(): number {
    return this.balls.length;
  }

  get isHolding(): boolean {
    return this.grabbedBall !== null;
  }

  /** 집게의 정규화 위치(0~1) — 조작부 표시용 */
  get clawTravelT(): number {
    return (this.carriageX + WORLD.clawMaxX) / (WORLD.clawMaxX * 2);
  }

  /** 추가 물리 스텝만 진행 — 정착 여부 확인용 */
  settle(steps: number) {
    if (this.destroyed) return;
    for (let i = 0; i < steps; i++) {
      this.syncClaw();
      this.world.step();
      // tick()과 동일한 보호를 적용한다. 여기서 빠뜨리면 정착 중 이탈한 구슬이
      // 되돌려지지 않아 자유낙하하며 "영구 진동"으로 잡힌다(생성자에서 겪은 것과 같은 누락).
      this.clampBallSpeeds();
      this.containBalls();
    }
  }

  /**
   * 보조 조인트를 해제한다. 하네스가 "영구 진동"을 판정할 때 사용한다.
   * 집게에 매달린 구슬은 조인트 때문에 계속 흔들리는 것이 정상이므로
   * (§16.2 "제한된 흔들림"), 해제 후 정착 여부로 판정해야 한다.
   */
  releaseGrab() {
    if (this.destroyed) return;
    this.detachGrab(0);
  }

  /* ---------- 렌더 상태 ---------- */

  getRenderState(): RenderState {
    // 해제 후에는 마지막 스냅샷을 돌려준다. WASM 메모리에 접근하면 죽는다.
    if (this.destroyed) return this.lastState ?? EMPTY_STATE;

    const balls: BallView[] = this.balls.map((b) => {
      const p = b.translation();
      const q = b.rotation();
      const m = this.meta.get(b.handle)!;
      return {
        x: p.x,
        y: p.y,
        z: p.z,
        q: [q.x, q.y, q.z, q.w],
        r: m.radius,
        colorIndex: m.colorIndex,
        kind: m.kind,
        isMetal: m.isMetal,
        hasDecal: m.hasDecal,
        decalVariant: m.decalVariant,
        grabbed: this.grabbedBall === b,
      };
    });

    this.lastState = {
      phase: this.phase,
      carriageX: this.carriageX,
      clawX: this.clawX,
      swayAngle: this.swayAngle,
      clawY: this.clawY,
      clawOpen: this.clawOpen,
      prongSkew: this.prongSkew,
      balls,
      aimRemainingMs: Math.max(0, this.aimTotalMs - this.aimElapsed),
      aimTotalMs: this.aimTotalMs,
      revealProgress:
        this.phase === 'REVEAL' ? clamp(this.phaseElapsed / this.phaseDuration(), 0, 1) : 0,
      capsuleOpenProgress: this.capsuleOpen,
      grabbedColorIndex: this.grabbedBall
        ? (this.meta.get(this.grabbedBall.handle)?.colorIndex ?? 0)
        : null,
      shake: this.shake,
    };
    return this.lastState;
  }

  /** §16.2 인수 기준 자체 판정 — 연출과 결과가 일치하는지 */
  verifyOutcome(): { consistent: boolean; detail: string } {
    const holding = this.grabbedBall !== null;
    if (this.opts.revealMode === 'capsuleOpen') {
      return { consistent: holding, detail: `capsuleOpen: 항상 획득해야 함. holding=${holding}` };
    }
    return {
      consistent: holding === this.opts.win,
      detail: `grabMiss: win=${this.opts.win} holding=${holding}`,
    };
  }

  destroy() {
    if (this.destroyed) return;
    // 스냅샷을 먼저 확보한 뒤 해제한다 — 렌더러가 마지막 프레임을 그릴 수 있도록
    this.getRenderState();
    this.destroyed = true;
    physicsDebug.destroyed++;
    physicsDebug.live.delete(this.id);
    this.world.free();
    this.balls = [];
    this.meta.clear();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }
}
