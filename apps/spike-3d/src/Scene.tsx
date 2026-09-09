/**
 * 씬 — 캐비닛 + 구슬 더미 + 집게 + 조명.
 *
 * 좌표계: 바닥 y = 0, 박스 내부는 y 0..boxHeight, z -depth/2..+depth/2.
 *
 * 레퍼런스 관찰 요약:
 *   - 구슬은 matte~soft-glossy. 환경 반사가 없다 → 고품질 HDRI가 필요 없다
 *   - 은색만 metalness 높음. 반사는 넓은 그라데이션뿐 → 절차적 환경맵으로 충분
 *   - 벽이 거의 자체발광하는 라이트박스처럼 밝다 → albedo만으로는 안 나오고 emissive가 필요
 *   - 발광 시안 바닥 + 상단 소프트 광원
 *
 * 중요한 차이: 레퍼런스 캐비닛은 가로형이지만 우리 키오스크는 1080×1920 세로형이다.
 * 세로 프레임에 맞추려면 박스가 폭보다 높아야 하므로 비율을 다시 잡았다.
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Environment, Lightformer, useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { BALL_COLORS, METAL_COLOR, THEMES, type VisualConfig } from './config';
import { ballGeometry, ballTexture, wallGradientTexture } from './geometry';
import { PileSim, buildPile, pileTopY, type Ball } from './pile';
import { Claw, Rail } from './Claw';

/* ---------------- 캐비닛 ---------------- */

function Cabinet({ cfg }: { cfg: VisualConfig }) {
  const { boxWidth: w, boxHeight: h, boxDepth: d } = cfg;

  const wallTex = useMemo(
    () => wallGradientTexture(cfg.wallColorTop, cfg.wallColorBottom),
    [cfg.wallColorTop, cfg.wallColorBottom],
  );

  /**
   * 벽은 라이트박스다 — 조명에 반응하지 않고 지정한 색 그대로 발광해야 한다.
   * MeshStandardMaterial로 조명을 받게 하면 구슬을 밝히려 광량을 올릴 때마다
   * 벽이 먼저 흰색으로 날아간다. Basic으로 두면 벽 색과 구슬 조명을 독립적으로 잡을 수 있다.
   */
  const wallMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ map: wallTex });
    m.color.multiplyScalar(cfg.wallEmissive);
    return m;
  }, [wallTex, cfg.wallEmissive]);

  const floorGlowMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: cfg.floorGlowColor,
        emissive: new THREE.Color(cfg.floorGlowColor),
        emissiveIntensity: cfg.floorGlowIntensity,
        roughness: 0.35,
        metalness: 0,
      }),
    [cfg.floorGlowColor, cfg.floorGlowIntensity],
  );

  const theme = THEMES[cfg.theme];

  const edgeMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        emissive: new THREE.Color(theme.edgeColor),
        emissiveIntensity: cfg.edgeGlowIntensity,
        roughness: 0.5,
      }),
    [cfg.edgeGlowIntensity, theme.edgeColor],
  );

  const bezelMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: theme.bezelColor, roughness: 0.6, metalness: 0.15 }),
    [theme.bezelColor],
  );

  const t = 0.14; // 모서리 스트립 두께

  return (
    <group>
      {/* 뒷벽 */}
      <mesh position={[0, h / 2, -d / 2]} material={wallMat} receiveShadow>
        <planeGeometry args={[w, h]} />
      </mesh>
      {/* 좌우 벽 */}
      <mesh position={[-w / 2, h / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={wallMat} receiveShadow>
        <planeGeometry args={[d, h]} />
      </mesh>
      <mesh position={[w / 2, h / 2, 0]} rotation={[0, -Math.PI / 2, 0]} material={wallMat} receiveShadow>
        <planeGeometry args={[d, h]} />
      </mesh>
      {/* 천장 */}
      <mesh position={[0, h, 0]} rotation={[Math.PI / 2, 0, 0]} material={wallMat}>
        <planeGeometry args={[w, d]} />
      </mesh>

      {/* 뒷벽 로고 — 레퍼런스의 LOTTE DUTY FREE 위치 */}
      {cfg.showLogo && <BackWallLogo cfg={cfg} />}

      {/* 발광 바닥 */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} material={floorGlowMat} receiveShadow>
        <planeGeometry args={[w - 0.3, d - 0.3]} />
      </mesh>
      <pointLight
        position={[0, 1.1, 0]}
        color={cfg.floorGlowColor}
        intensity={cfg.floorGlowIntensity * 5}
        distance={14}
        decay={2}
      />

      {/* 전면 하단 베젤 — 프레임 아래 빈 공간을 가리고 캐비닛 하부처럼 읽히게 한다 */}
      <mesh position={[0, -1.6, d / 2 + 0.05]} material={bezelMat}>
        <boxGeometry args={[w + 1.2, 3.4, 0.35]} />
      </mesh>

      {/* 모서리 발광 스트립 */}
      {[-1, 1].map((sx) => (
        <mesh key={`f${sx}`} position={[(sx * w) / 2, h / 2, d / 2]} material={edgeMat}>
          <boxGeometry args={[t, h, t]} />
        </mesh>
      ))}
      <mesh position={[0, h, d / 2]} material={edgeMat}>
        <boxGeometry args={[w, t, t]} />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={`b${sx}`} position={[(sx * w) / 2, h / 2, -d / 2]} material={edgeMat}>
          <boxGeometry args={[t, h, t]} />
        </mesh>
      ))}
      {/* 천장 하단 라인 라이트 — 레퍼런스 상단의 밝은 띠 */}
      <mesh position={[0, h - 0.35, 0]} material={edgeMat}>
        <boxGeometry args={[w - 0.8, 0.18, d - 0.8]} />
      </mesh>
    </group>
  );
}

/** 뒷벽에 얹는 브랜드 로고. 발광시켜 라이트박스에 인쇄된 것처럼 보이게 한다. */
function BackWallLogo({ cfg }: { cfg: VisualConfig }) {
  const tex = useTexture('/aepick-logo.png');
  const aspect = 315 / 100;
  const width = cfg.boxWidth * 0.44 * cfg.logoScale;
  return (
    <mesh position={[0, cfg.boxHeight * 0.74, -cfg.boxDepth / 2 + 0.05]}>
      <planeGeometry args={[width, width / aspect]} />
      <meshBasicMaterial map={tex} transparent opacity={0.92} toneMapped={false} />
    </mesh>
  );
}

/* ---------------- 구슬 ---------------- */

function Balls({ cfg, balls }: { cfg: VisualConfig; balls: Ball[] }) {
  const materials = useMemo(() => {
    const map = new Map<string, THREE.Material>();
    const get = (isMetal: boolean, colorIndex: number, hasDecal: boolean) => {
      const key = `${isMetal}:${colorIndex}:${hasDecal}`;
      let m = map.get(key);
      if (m) return m;

      const baseColor = isMetal ? METAL_COLOR : BALL_COLORS[colorIndex % BALL_COLORS.length];
      const useTex = hasDecal && cfg.showDecals && !isMetal;

      m = new THREE.MeshPhysicalMaterial({
        // 텍스처는 material.color에 곱해지므로, 텍스처를 쓸 때는 color를 흰색으로 두고
        // 구슬 색을 텍스처 배경에 담는다. 그러지 않으면 색이 두 번 곱해져 어두워진다.
        color: useTex ? '#ffffff' : baseColor,
        map: useTex ? ballTexture(baseColor) : null,
        metalness: isMetal ? 0.8 : 0.02,
        roughness: isMetal ? cfg.metalRoughness : cfg.ballRoughness,
        clearcoat: isMetal ? 0 : cfg.clearcoat,
        clearcoatRoughness: 0.25,
        envMapIntensity: cfg.envIntensity,
      });
      map.set(key, m);
      return m;
    };
    return { get };
  }, [cfg.ballRoughness, cfg.metalRoughness, cfg.clearcoat, cfg.showDecals, cfg.envIntensity]);

  /*
   * 애니메이션 중에는 Ball 객체가 in-place로 변경된다. React는 그것을 감지하지 못하므로
   * 메시 위치를 매 프레임 직접 동기화한다. 64개 위치 갱신은 비용이 거의 없다.
   */
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    for (let i = 0; i < balls.length; i++) {
      const m = refs.current[i];
      const b = balls[i];
      if (m && b) m.position.set(b.x, b.y, b.z);
    }
  });

  return (
    <group>
      {balls.map((b, i) => (
        <mesh
          key={b.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={[b.x, b.y, b.z]}
          rotation={b.rotation}
          scale={b.r}
          geometry={ballGeometry(b.kind, cfg.ribCount, cfg.ribAmplitude)}
          material={materials.get(b.isMetal, b.colorIndex, b.hasDecal)}
          castShadow={cfg.shadowsEnabled}
          receiveShadow={cfg.shadowsEnabled}
        />
      ))}
    </group>
  );
}

/* ---------------- 조명 ---------------- */

function Lights({ cfg }: { cfg: VisualConfig }) {
  const h = cfg.boxHeight;
  return (
    <>
      <ambientLight intensity={cfg.ambientIntensity} color="#e2daf8" />

      {/* 키 — 상단 전방에서 아래로 */}
      <directionalLight
        position={[cfg.keyPosition[0], h + cfg.keyPosition[1], cfg.keyPosition[2]]}
        intensity={cfg.keyIntensity}
        color="#fffaff"
        castShadow={cfg.shadowsEnabled}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={12}
        shadow-camera-bottom={-4}
        shadow-camera-near={1}
        shadow-camera-far={45}
        shadow-bias={-0.0009}
      />

      {/* 필 — 좌측 보라 반사광 */}
      <directionalLight position={[-9, h * 0.5, 7]} intensity={cfg.fillIntensity} color="#c4b2f4" />
      {/* 리무 — 우측에서 약하게 */}
      <directionalLight position={[9, h * 0.35, 4]} intensity={cfg.fillIntensity * 0.6} color="#dcd0ff" />

      {/*
        절차적 환경맵. 밀폐 박스라 Lightformer 몇 개로 충분하고 네트워크 의존이 없다
        (키오스크 오프라인 기동에 유리). 금속 구슬이 반사할 "밝은 사방"을 만드는 것이 목적이므로
        면을 크게 잡는다 — 작게 잡으면 금속이 검은 크롬처럼 보인다.
      */}
      <Environment resolution={192} frames={1}>
        {/*
          금속이 반사할 환경. 여기서 중요한 것은 밝기가 아니라 명암 대비다.
          사방을 균일하게 밝게 두면 금속이 흰 플라스틱처럼 납작해진다 —
          크롬은 어두운 영역이 있어야 크롬으로 읽힌다. 위는 강하게, 아래·측면은 어둡게.
        */}
        <Lightformer intensity={3.0} color="#ffffff" position={[0, 10, 1]} rotation={[Math.PI / 2, 0, 0]} scale={[20, 16, 1]} />
        <Lightformer intensity={1.5} color="#f8f4ff" position={[0, 2, 11]} scale={[22, 20, 1]} />
        <Lightformer intensity={0.45} color="#a894d8" position={[-10, 1, 0]} rotation={[0, Math.PI / 2, 0]} scale={[10, 12, 1]} />
        <Lightformer intensity={0.45} color="#a894d8" position={[10, 1, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[10, 12, 1]} />
        <Lightformer intensity={0.3} color="#8d7ac0" position={[0, 1, -10]} rotation={[0, Math.PI, 0]} scale={[12, 12, 1]} />
        <Lightformer
          intensity={1.1}
          color={cfg.floorGlowColor}
          position={[0, -8, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[12, 10, 1]}
        />
      </Environment>
    </>
  );
}

/**
 * 낙하 시뮬레이션 구동.
 * 오프라인 영상 렌더에서는 wall-clock이 아니라 명시적 스텝으로 진행해야 프레임이 결정적이다.
 * window.tickSim(n)으로 외부에서 스텝을 밀어넣을 수 있게 한다.
 */
function PileDriver({ sim }: { sim: PileSim }) {
  const pending = useRef(0);

  useMemo(() => {
    (window as unknown as Record<string, unknown>).tickSim = (n: number) => {
      pending.current += n;
    };
    (window as unknown as Record<string, unknown>).simProgress = () => sim.progress;
  }, [sim]);

  useFrame(() => {
    /*
     * 오프라인 렌더에서는 명시적 스텝만 받는다.
     * 자동 진행을 켜두면 캡처 시작 전 대기 시간(환경맵 생성 등) 동안 시뮬레이션이
     * 이미 정착해버려 영상 앞부분에 낙하가 담기지 않는다.
     */
    const offline = (window as unknown as Record<string, unknown>).__offlineRender === true;
    if (offline && pending.current <= 0) return;
    const steps = pending.current > 0 ? Math.min(pending.current, 40) : 1;
    pending.current = Math.max(0, pending.current - steps);
    sim.step(steps, 0.42 * steps);
  });
  return null;
}

/* ---------------- 씬 ---------------- */

export function Scene({ cfg, pileSeed }: { cfg: VisualConfig; pileSeed: number }) {
  const opts = useMemo(
    () => ({
      count: cfg.ballCount,
      radius: cfg.ballRadius,
      depthLayers: cfg.pileDepthLayers,
      boxWidth: cfg.boxWidth,
      boxDepth: cfg.boxDepth,
      seed: pileSeed,
    }),
    [cfg.ballCount, cfg.ballRadius, cfg.pileDepthLayers, cfg.boxWidth, cfg.boxDepth, pileSeed],
  );

  // animate=false면 수렴 상태를 한 번에 계산해 정적 프레임으로 쓴다.
  // animate=true면 PileSim을 프레임 단위로 돌려 낙하를 보여준다(대기화면 영상용).
  const sim = useMemo(() => (cfg.animate ? new PileSim(opts) : null), [cfg.animate, opts]);
  const staticBalls = useMemo(() => (cfg.animate ? null : buildPile(opts)), [cfg.animate, opts]);
  const balls = sim ? sim.balls : staticBalls!;

  const topY = useMemo(() => pileTopY(balls), [balls]);
  const railY = cfg.boxHeight - 1.6;

  return (
    <>
      <Lights cfg={cfg} />
      <Cabinet cfg={cfg} />
      <Balls cfg={cfg} balls={balls} />
      <Rail cfg={cfg} y={railY} />
      <Claw cfg={cfg} topY={railY - 0.3} />
      {sim && <PileDriver sim={sim} />}
      <group userData={{ pileTopY: topY }} />
    </>
  );
}
