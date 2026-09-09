/**
 * 대기 영상 렌더용 화면 (`?render=attract`).
 *
 * 왜 키오스크 안에 두는가:
 *   이전 대기 영상은 비주얼 스파이크(apps/spike-3d)에서 렌더했는데, 스파이크는 키오스크가
 *   거쳐온 재질·조명·팔레트·파이프라인 수정을 하나도 받지 않았다. 그래서 영상만 옛날 룩으로
 *   남아 있었다(흰 벽 · 구형 집게 · 구형 팔레트). 씬을 **키오스크에서 렌더**하면
 *   대기 영상이 본 게임과 자동으로 같은 룩을 갖는다.
 *
 * 모션:
 *   구슬이 쏟아지는 장면을 반복하지 않는다. ClawGame 생성자가 이미 더미를 안정시키므로
 *   시작부터 쌓여 있는 상태이고, 여기서는 **캐비닛을 흔든다**(attractShake.ts).
 *   레퍼런스의 "덜그럭"은 구슬이 각자 튀는 것이 아니라 박스 전체가 흔들리는 것이었다.
 *
 * 결정성:
 *   `window.tickSim(n)`으로만 시뮬레이션이 진행된다. wall-clock에 의존하지 않으므로
 *   같은 시드 + 같은 스텝 수 = 같은 영상이다.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ClawGame, initPhysics } from '../game/clawGame';
import { Scene } from '../game/Scene';
import { CAMERA_ATTRACT, QUALITY, SCREEN } from '../game/layout';
import { shakeAt } from '../game/attractShake';

declare global {
  interface Window {
    tickSim?: (n: number) => void;
    __attractReady?: boolean;
  }
}

/**
 * Scene의 RendererSettings가 게임용 카메라를 강제하므로 매 프레임 대기용으로 되돌린다.
 * 흔들림 오프셋도 여기서 적용한다 — 카메라를 움직이면 박스가 화면에서 움직이는 것과 같다.
 */
function AttractCamera({ shake }: { shake: { x: number; y: number } }) {
  const { camera } = useThree();
  const target = new THREE.Vector3();
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    // 카메라를 흔들림의 반대로 옮기면 화면에서는 박스가 흔들린 것으로 보인다
    cam.position.set(
      CAMERA_ATTRACT.position[0] - shake.x,
      CAMERA_ATTRACT.position[1] - shake.y,
      CAMERA_ATTRACT.position[2],
    );
    target.set(
      CAMERA_ATTRACT.target[0] - shake.x,
      CAMERA_ATTRACT.target[1] - shake.y,
      CAMERA_ATTRACT.target[2],
    );
    cam.lookAt(target);
    cam.updateProjectionMatrix();
  });
  return null;
}

export function AttractRender({ seed, ballCount }: { seed: number; ballCount?: number }) {
  const [game, setGame] = useState<ClawGame | null>(null);
  const q = QUALITY.high;
  /* 매 프레임 갱신되므로 state가 아니라 가변 객체로 넘긴다 — 리렌더를 유발하면 안 된다 */
  const shakeRef = useRef({ x: 0, y: 0 }).current;

  useEffect(() => {
    let disposed = false;
    let instance: ClawGame | null = null;

    (async () => {
      await initPhysics();
      if (disposed) return;
      instance = new ClawGame({
        seed,
        ballCount,
        aimSeconds: 999,
        speedPreset: 'normal',
        win: false,
        missVariant: 0,
        revealMode: 'capsuleOpen',
        // 튜토리얼을 건너뛰고 바로 AIM으로 — 집게는 홈에 매달린 채 유지된다
        tutorialMs: 0,
        disableTimeout: true,
      });

      /*
       * 시뮬레이션 시각은 스텝 수에서만 나온다(wall-clock 아님) — 그래야 결정적이다.
       * 흔들림 위상도 같은 시각에서 뽑으므로 렌더를 다시 돌려도 같은 영상이 나온다.
       */
      let steps = 0;
      window.tickSim = (n: number) => {
        for (let i = 0; i < n; i++) {
          const s = shakeAt(steps / 60);
          instance?.setShakeAccel(s.ax, s.ay, 0, s.clawAx);
          shakeRef.x = s.x;
          shakeRef.y = s.y;
          steps++;
          instance?.tick(1000 / 60);
        }
      };

      // 진단용 핸들 — Play의 window.__game과 같은 성격
      (window as unknown as Record<string, unknown>).__attractGame = instance;
      setGame(instance);
      window.__attractReady = true;
    })();

    return () => {
      disposed = true;
      window.tickSim = undefined;
      window.__attractReady = false;
      instance?.destroy();
    };
  }, [seed, ballCount]);

  if (!game) return <div style={{ width: '100%', height: '100%', background: '#f4cfdf' }} />;

  return (
    <div style={{ width: SCREEN.width, height: SCREEN.height, background: '#f4cfdf' }}>
      <Canvas
        dpr={q.dpr}
        shadows={q.shadows}
        frameloop="always"
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: CAMERA_ATTRACT.fov, position: CAMERA_ATTRACT.position, near: 0.1, far: 200 }}
        style={{ width: '100%', height: '100%' }}
      >
        <AttractCamera shake={shakeRef} />
        <Scene game={game} shadows={q.shadows} />
      </Canvas>
    </div>
  );
}
