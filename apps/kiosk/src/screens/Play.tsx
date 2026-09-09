/**
 * 플레이화면 G-00 — 기획서 v1.1 §6.2 / 부록 A
 *
 * 내부 상태 G-01 READY → G-02 AIM → G-03 DROP → G-04 GRAB → G-05 LIFT → G-06 REVEAL
 * ClawGame(Rapier 3D)이 물리와 페이즈를 소유하고, 이 컴포넌트는
 * 렌더 루프·입력·HUD·상위 보고만 담당한다.
 *
 * 화면 분할: 상단 1080×1344 3D 필드 / 하단 1080×576 조작부.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bloom, DepthOfField, EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { CreateSessionResponse } from '@aepick/shared';
import { ClawGame, initPhysics, physicsDebug, type Phase, type PlayOutcome } from '../game/clawGame';
import { Scene } from '../game/Scene';
import { CAMERA, POST, QUALITY, resolveBallCount, type QualityLevel } from '../game/layout';
import { Controller } from './Controller';
import { t } from '../i18n';

export interface PlayProps {
  session: CreateSessionResponse;
  quality: 'high' | 'mid' | 'low';
  disableTimeout: boolean;
  onCatchLocked: () => void;
  onFinished: (
    outcome: PlayOutcome,
    perf: { minFps: number },
    verify: { consistent: boolean; detail: string },
  ) => void;
  onPhase?: (phase: Phase) => void;
  onQualityDown?: () => void;
  debug?: boolean;
}

/**
 * 후처리.
 *
 * **톤 매핑은 여기서 해야 한다.** three.js r169는 렌더타깃에 그릴 때 톤 매핑을 강제로 끈다:
 *
 *   let toneMapping = NoToneMapping;
 *   if (material.toneMapped) {
 *     if (currentRenderTarget === null || currentRenderTarget.isXRRenderTarget) {
 *       toneMapping = renderer.toneMapping;
 *     }
 *   }
 *
 * EffectComposer는 항상 렌더타깃에 그리므로 `gl.toneMapping`·`gl.toneMappingExposure`가
 * 통째로 무시된다. 그래서 지금까지 **톤 매핑이 전혀 걸려 있지 않았고**, 하이라이트가
 * 롤오프 없이 그대로 잘렸다 — 벽 채도를 올리려 할 때마다 부딪힌 포화 한계의 정체다.
 */
function Post({ q }: { q: QualityLevel }) {
  if (!q.bloom && !q.dof && !q.ao) return null;
  return (
    <EffectComposer enableNormalPass multisampling={0}>
      {q.ao ? <N8AO
          aoRadius={POST.aoRadius}
          intensity={POST.aoIntensity}
          color={POST.aoColor}
          distanceFalloff={POST.aoFalloff}
          quality="medium"
        /> : <></>}
      {q.bloom ? (
        <Bloom
          intensity={POST.bloomIntensity}
          luminanceThreshold={POST.bloomThreshold}
          luminanceSmoothing={POST.bloomSmoothing}
          mipmapBlur
        />
      ) : (
        <></>
      )}
      {q.dof ? (
        <DepthOfField target={POST.dofTarget} focalLength={POST.dofFocalLength} bokehScale={POST.dofBokehScale} />
      ) : (
        <></>
      )}
      {/* 반드시 마지막 — 앞 효과들은 톤 매핑 전 값에서 동작해야 한다 */}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  );
}

export function Play({
  session,
  quality,
  disableTimeout,
  onCatchLocked,
  onFinished,
  onPhase,
  onQualityDown,
  debug,
}: PlayProps) {
  const [game, setGame] = useState<ClawGame | null>(null);
  const [phase, setPhase] = useState<Phase>('READY');
  const [aimLeft, setAimLeft] = useState(session.game.aimSeconds * 1000);
  const [fps, setFps] = useState(60);
  const [error, setError] = useState<string | null>(null);

  const gameRef = useRef<ClawGame | null>(null);
  const rafRef = useRef(0);
  const finishedRef = useRef(false);
  const minFpsRef = useRef(999);
  const holdRef = useRef<-1 | 1 | 0>(0);
  const q = QUALITY[quality];

  /* ---------- 엔진 생성 (Rapier WASM 초기화가 비동기다) ---------- */
  useEffect(() => {
    let disposed = false;
    let instance: ClawGame | null = null;

    (async () => {
      try {
        await initPhysics();
        if (disposed) return;
        instance = new ClawGame({
          // 톤 스윕은 같은 더미를 반복 측정해야 한다 — 시드가 매번 다르면 색 분포가 흔들려
          // 측정값이 조합 차이가 아니라 난수 차이를 반영한다 (실측: L이 17%~55% 사이로 요동)
          seed: ((globalThis as Record<string, unknown>).__SEED__ as number) ?? session.physicsSeed,
          ballCount: resolveBallCount(session.game.ballCount),
          aimSeconds: session.game.aimSeconds,
          speedPreset: session.game.speedPreset,
          win: session.motion.win,
          missVariant: session.motion.missVariant,
          revealMode: session.motion.revealMode,
          tutorialMs: 2600,
          disableTimeout,
          onPhase: (p) => {
            setPhase(p);
            onPhase?.(p);
          },
          onCatchLocked,
        });
        gameRef.current = instance;
        const w = window as unknown as Record<string, unknown>;
        w.__physDebug = physicsDebug;
        // 진단용 — 헤드리스 검증 도구가 집게 좌표를 샘플링할 수 있게 한다
        w.__game = instance;
        setGame(instance);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      instance?.destroy();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);

  /* ---------- 렌더 루프 ---------- */
  useEffect(() => {
    if (!game) return;

    let last = performance.now();
    let fpsAcc = 0;
    let fpsFrames = 0;
    // 워밍업 구간(셰이더 컴파일·환경맵 생성)의 낮은 프레임은 성능 지표에서 제외한다
    let warmup = 900;
    let downgraded = false;

    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      if (warmup > 0) warmup -= dt;

      const inst = dt > 0 ? 1000 / dt : 60;
      fpsAcc += inst;
      fpsFrames++;
      if (fpsFrames >= 20) {
        const avg = fpsAcc / fpsFrames;
        setFps(Math.round(avg));
        if (warmup <= 0 && game.phase !== 'READY') {
          minFpsRef.current = Math.min(minFpsRef.current, avg);
          // §13 프레임 저하 시 효과 품질 자동 축소
          if (avg < 40 && !downgraded) {
            downgraded = true;
            onQualityDown?.();
          }
        }
        fpsAcc = 0;
        fpsFrames = 0;
      }

      if (holdRef.current !== 0) game.nudge(holdRef.current, dt);
      game.tick(dt);
      setAimLeft(game.getRenderState().aimRemainingMs);

      if (game.phase === 'DONE' && !finishedRef.current) {
        finishedRef.current = true;
        const minFps = minFpsRef.current === 999 ? 60 : Math.round(minFpsRef.current * 10) / 10;
        onFinished(game.getOutcome(), { minFps }, game.verifyOutcome());
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  const handleDrop = useCallback(() => {
    gameRef.current?.triggerCatch(false);
  }, []);

  const handleHold = useCallback((dir: -1 | 1 | 0) => {
    holdRef.current = dir;
  }, []);

  if (error) {
    return (
      <div className="hold">
        <div className="icon">🛎️</div>
        <div className="msg">{t('error.generic')}</div>
        <div className="code">PHYSICS_INIT_FAILED</div>
      </div>
    );
  }

  const aimTotal = session.game.aimSeconds * 1000;
  const inputActive = phase === 'AIM';

  return (
    <div className="layer">
      <div className="field">
        {game && (
          <Canvas
            dpr={q.dpr}
            shadows={q.shadows}
            frameloop="always"
            gl={{ antialias: true, powerPreference: 'high-performance' }}
            camera={{ fov: CAMERA.fov, position: CAMERA.position, near: 0.1, far: 200 }}
          >
            <Scene game={game} shadows={q.shadows} />
            <Post q={q} />
          </Canvas>
        )}

        {/* 상단 HUD — 1회 플레이 배지 */}
        <div className="hud">
          <div className="badge-once">{t('aim.oncePerPlay')}</div>
        </div>

        {/* 튜토리얼 오버레이 (G-01 READY) */}
        {phase === 'READY' && (
          <div className="tutorial">
            <div className="tutorial-card">
              <p className="step">① {t('tutorial.line1')}</p>
              <p className="step">② {t('tutorial.line2')}</p>
              <div className="tutorial-dots">
                <i className="on" />
                <i className="on" />
              </div>
            </div>
          </div>
        )}

        {debug && (
          <div className="debug">
            {`phase   ${phase}
fps     ${fps} (min ${minFpsRef.current === 999 ? '-' : minFpsRef.current.toFixed(1)})
balls   ${game?.ballCount ?? '-'}
seed    ${session.physicsSeed}
motion  win=${session.motion.win} v${session.motion.missVariant} lv${session.motion.effectLevel}
reveal  ${session.motion.revealMode}
aim     ${(aimLeft / 1000).toFixed(1)}s / ${session.game.aimSeconds}s
quality ${quality}
test    ${session.isTest ? 'YES' : 'no'}`}
          </div>
        )}
      </div>

      <Controller
        remainingMs={aimLeft}
        totalMs={aimTotal}
        active={inputActive}
        onHold={handleHold}
        onDrop={handleDrop}
      />
    </div>
  );
}
