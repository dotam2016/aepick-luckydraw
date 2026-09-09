/**
 * 3D 씬 — 캐비닛 + 구슬 + 집게 + 조명 + 후처리.
 *
 * ClawGame이 물리와 상태를 소유하고, 이 컴포넌트는 `RenderState`만 읽어 그린다.
 * 렌더러 교체(Canvas 2D → Three.js)가 국소적으로 끝난 이유가 이 분리다.
 *
 * 조명 방침(비주얼 스파이크에서 확정): 방향광이 아니라 환경광이 셰이딩을 주도한다.
 * 방향광을 세게 두면 구슬마다 작고 단단한 흰 점이 생겨 플라스틱처럼 보인다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import {
  ballGeometry,
  ballRoughnessTexture,
  ballTexture,
  contactShadowTexture,
  wallNormalTexture,
  wallRoughnessTexture,
  wallTexture,
} from './assets';
import {
  BALL_PALETTE,
  CAMERA,
  DEPTH,
  ENV,
  LIGHTING,
  MATERIAL,
  METAL_COLOR,
  FLOOR_LIGHT,
  THEME,
  WALL,
  WORLD,
} from './layout';
import { CLAW_RIG, prongPose, tiltFromOpen } from './clawRig';
import type { ClawGame, RenderState } from './clawGame';
import { assetUrl } from '../assetUrl';

const PRONG_COUNT = 3;

/**
 * 벽이 구슬 그림자를 받을지.
 * 레퍼런스 캐비닛의 벽에는 구슬 그림자가 없다 — 벽 자체가 확산 발광면이라
 * 한 방향에서 오는 그림자가 생기지 않는다. 바닥은 그림자를 받아야 더미가 떠 보이지 않는다.
 */
const WALL_SHADOW: boolean = (globalThis as Record<string, unknown>).__WALL_SHADOW__ === true;

/* ---------------- 렌더러 설정 ---------------- */

export function RendererSettings() {
  const { gl, camera } = useThree();
  useMemo(() => {
    /*
     * 톤 매핑.
     * ACESFilmic은 영화용 필름 커브라 채도가 높은 색을 흰쪽으로 밀어 **탈색시키고**
     * 중간톤을 눌러 어둡게 만든다. 캡슐이 원색 위주인 이 씬에서는 빨강이 벽돌색,
     * 초록이 올리브색이 되어 전체가 칙칙해졌다.
     * Khronos PBR Neutral은 하이라이트만 부드럽게 접고 채도를 유지한다.
     */
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.toneMappingExposure = LIGHTING.exposure;
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = CAMERA.fov;
    cam.position.set(...CAMERA.position);
    cam.lookAt(new THREE.Vector3(...CAMERA.target));
    cam.updateProjectionMatrix();
  }, [gl, camera]);
  return null;
}

/* ---------------- 캐비닛 ---------------- */

function BackWallLogo() {
  const tex = useTexture(assetUrl('/assets/aepick-logo.png'));
  const aspect = 315 / 100;
  const width = WORLD.boxWidth * 0.44 * 0.85;
  return (
    <mesh position={[0, WORLD.boxHeight * 0.74, -WORLD.boxDepth / 2 + 0.05]}>
      <planeGeometry args={[width, width / aspect]} />
      <meshBasicMaterial map={tex} transparent opacity={0.92} toneMapped={false} />
    </mesh>
  );
}

/**
 * 전면 유리. 아주 낮은 불투명도 + 낮은 러프니스로 환경을 반사해
 * "밀폐된 케이스 안을 들여다보는" 느낌을 만든다.
 * depthWrite를 끄고 마지막에 그려 구슬 렌더 순서를 흐트러뜨리지 않는다.
 */
function FrontGlass() {
  const mat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: DEPTH.glassOpacity,
        roughness: 0.06,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        envMapIntensity: 0.85,
        depthWrite: false,
        side: THREE.FrontSide,
      }),
    [],
  );
  return (
    <mesh position={[0, WORLD.boxHeight / 2, WORLD.boxDepth / 2 - 0.02]} material={mat} renderOrder={10}>
      <planeGeometry args={[WORLD.boxWidth, WORLD.boxHeight]} />
    </mesh>
  );
}

/** 더미 아래 부드러운 원형 그림자 — 구슬을 바닥에 붙인다 */
function ContactShadow() {
  const tex = useMemo(() => contactShadowTexture(), []);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: DEPTH.contactShadowOpacity,
        depthWrite: false,
      }),
    [tex],
  );
  return (
    <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mat} renderOrder={1}>
      {/* 벽 밖으로 삐져나오면 벽 하단이 어둡게 물든다 — 바닥 안쪽에 가둔다 */}
      <planeGeometry args={[WORLD.boxWidth * 0.96, WORLD.boxDepth * 0.96]} />
    </mesh>
  );
}

function Cabinet({ shadows }: { shadows: boolean }) {
  const { boxWidth: w, boxHeight: h, boxDepth: d } = WORLD;

  // 정면벽만 핫스팟을 갖는다 — 측벽까지 넣으면 모서리에서 밝기가 두 번 튄다
  const wallTex = useMemo(
    () =>
      wallTexture(THEME.wallTop, THEME.wallBottom, DEPTH.vignette, {
        u: WALL.hotspotU,
        v: WALL.hotspotV,
        radius: WALL.hotspotRadius,
        strength: WALL.hotspotStrength,
      }),
    [],
  );
  const sideTex = useMemo(() => wallTexture(THEME.wallTop, THEME.wallBottom, DEPTH.vignette), []);

  const roughTex = useMemo(
    () => wallRoughnessTexture(WALL.roughnessBase, WALL.roughnessVariation),
    [],
  );
  const normalTex = useMemo(() => {
    const t = wallNormalTexture(WALL.normalStrength);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(WALL.normalRepeat[0], WALL.normalRepeat[1]);
    return t;
  }, []);

  /*
   * 벽은 라이트박스다. 다만 완전한 Basic으로 두면 조명·AO에 전혀 반응하지 않아
   * 코너에 음영이 생기지 않고 공간이 납작해진다.
   * 발광(emissive)이 색을 주도하되 albedo를 약간 남겨 AO와 접촉 음영을 받게 한다.
   *
   * 세 면에 같은 재질을 쓰되 색만 다르게 준다 — 측벽·천장이 정면벽보다 어두워야 깊이가 생긴다.
   * 재질을 나누는 대신 color로 조절하면 맵 세 장을 공유하므로 드로우콜·메모리가 늘지 않는다.
   */
  const makeWallMat = (tint: number, tex: THREE.Texture = wallTex) =>
    new THREE.MeshStandardMaterial({
      /*
       * 어두운 albedo(#2a1a22)를 쓰면 조명이 닿는 곳마다 회색기가 돌아
       * 핑크 마감에 얼룩처럼 보인다. albedo도 벽 색으로 두고 발광은 낮춘다.
       * 러프니스는 상수 대신 맵으로 준다 — 반사 선명도가 자리마다 달라야 아크릴로 읽힌다.
       */
      color: new THREE.Color(tint, tint, tint),
      map: tex,
      emissiveMap: tex,
      emissive: new THREE.Color(tint, tint, tint),
      emissiveIntensity: THEME.wallEmissive * 0.62,
      roughness: 1, // roughnessMap과 곱해진다 — 맵 값을 그대로 쓴다
      roughnessMap: roughTex,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(1, 1),
      metalness: 0.02,
      envMapIntensity: DEPTH.wallEnvIntensity,
    });

  const wallMat = useMemo(() => makeWallMat(1), [wallTex, roughTex, normalTex]);
  const sideWallMat = useMemo(() => makeWallMat(WALL.sideTint, sideTex), [sideTex, roughTex, normalTex]);
  const ceilingMat = useMemo(() => makeWallMat(WALL.ceilingTint, sideTex), [sideTex, roughTex, normalTex]);

  const floorMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: THEME.floorGlow,
        emissive: new THREE.Color(THEME.floorGlow),
        emissiveIntensity: THEME.floorGlowIntensity,
        roughness: 0.35,
      }),
    [],
  );

  const edgeMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        emissive: new THREE.Color(THEME.edgeColor),
        emissiveIntensity: THEME.edgeGlowIntensity,
        roughness: 0.5,
      }),
    [],
  );

  /*
   * 천장 조명 패널.
   * 모서리 스트립과 같은 재질(순백 #fff4f7 · 발광 1.0)을 쓰면 상자 footprint 전체를 덮는
   * 이 큰 판이 블룸 임계(0.9)를 넘겨 순백으로 날아간다. 화면 위쪽 1/3이 종이가 되는 원인이었다.
   * 실제 디퓨저는 뒤의 LED 색을 머금는다 — 핑크를 띠고 임계 아래로 낮춘다.
   */
  const panelMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: THEME.bezelColor,
        emissive: new THREE.Color(WALL.lightPanelColor),
        emissiveIntensity: WALL.lightPanelIntensity,
        roughness: 0.55,
      }),
    [],
  );

  /** 바닥 라이트바 — 발광만 하고 조명은 받지 않는다(자기 밝기가 흐려지면 안 된다) */
  const floorBarMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(FLOOR_LIGHT.color).multiplyScalar(FLOOR_LIGHT.intensity),
        toneMapped: true,
      }),
    [],
  );

  const bezelMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: THEME.bezelColor, roughness: 0.6, metalness: 0.15 }),
    [],
  );

  const t = 0.14;

  return (
    <group>
      <mesh position={[0, h / 2, -d / 2]} material={wallMat} receiveShadow={shadows && WALL_SHADOW}>
        <planeGeometry args={[w, h]} />
      </mesh>
      <mesh position={[-w / 2, h / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={sideWallMat} receiveShadow={shadows && WALL_SHADOW}>
        <planeGeometry args={[d, h]} />
      </mesh>
      <mesh position={[w / 2, h / 2, 0]} rotation={[0, -Math.PI / 2, 0]} material={sideWallMat} receiveShadow={shadows && WALL_SHADOW}>
        <planeGeometry args={[d, h]} />
      </mesh>
      <mesh position={[0, h, 0]} rotation={[Math.PI / 2, 0, 0]} material={ceilingMat}>
        <planeGeometry args={[w, d]} />
      </mesh>

      <BackWallLogo />

      {/* 발광 바닥 */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} material={floorMat} receiveShadow={shadows}>
        <planeGeometry args={[w - 0.3, d - 0.3]} />
      </mesh>
      <pointLight
        position={[0, 1.1, 0]}
        color={THEME.floorGlow}
        intensity={THEME.floorGlowIntensity * 5}
        distance={14}
        decay={2}
      />

      {/* 바닥 라이트바 — 전면 모서리를 따라 번지는 띠 */}
      {FLOOR_LIGHT.enabled && (
        <>
          <mesh position={[0, FLOOR_LIGHT.y, d / 2 - FLOOR_LIGHT.inset]} material={floorBarMat}>
            <boxGeometry args={[w - 0.5, FLOOR_LIGHT.thickness, 0.22]} />
          </mesh>
          {/* 뒤쪽에도 하나 — 더미 사이로 빛이 새어 나와 바닥 전체가 밝게 읽힌다 */}
          <mesh position={[0, FLOOR_LIGHT.y, -d / 2 + FLOOR_LIGHT.inset]} material={floorBarMat}>
            <boxGeometry args={[w - 0.5, FLOOR_LIGHT.thickness, 0.22]} />
          </mesh>
          <pointLight
            position={[0, FLOOR_LIGHT.y + 0.25, d / 2 - FLOOR_LIGHT.inset - 0.3]}
            color={FLOOR_LIGHT.color}
            intensity={FLOOR_LIGHT.lampIntensity}
            distance={FLOOR_LIGHT.lampDistance}
            decay={2}
          />
        </>
      )}

      {/* 캐비닛 조명등 — 평평한 벽에 기울기를 만들 수 있는 유일한 광원(거리 감쇠) */}
      <pointLight
        position={WALL.boxLight.position}
        color={WALL.boxLight.color}
        intensity={WALL.boxLight.intensity}
        distance={WALL.boxLight.distance}
        decay={WALL.boxLight.decay}
      />

      {/* 접지 그림자 — 키 라이트가 약해 구슬이 바닥에 얹힌 느낌이 부족하다 */}
      {DEPTH.contactShadow && <ContactShadow />}

      {/* 전면 유리 — 밀폐된 캐비닛으로 읽히게 한다 */}
      {DEPTH.glass && <FrontGlass />}

      {/* 전면 하단 베젤 — 프레임 아래 빈 공간을 가린다 */}
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
      {/* 천장 조명 패널 (디퓨저) */}
      <mesh position={[0, h - 0.35, 0]} material={panelMat}>
        <boxGeometry args={[w - 0.8, 0.18, d - 0.8]} />
      </mesh>
    </group>
  );
}

/* ---------------- 구슬 ---------------- */

function Balls({
  game,
  shadows,
  baked,
  groupRef,
}: {
  game: ClawGame;
  shadows: boolean;
  baked: boolean;
  groupRef?: (el: THREE.Group | null) => void;
}) {
  const state = useMemo(() => game.getRenderState(), [game]);

  const materials = useMemo(() => {
    const map = new Map<string, THREE.Material>();
    return {
      get(isMetal: boolean, colorIndex: number, hasDecal: boolean, variant: number) {
        const useTex = hasDecal && !isMetal;
        // 데칼이 없으면 변형은 의미가 없다 — 키에서 빼야 같은 재질을 공유한다
        const key = `${isMetal}:${colorIndex}:${useTex ? variant : 'plain'}`;
        let m = map.get(key);
        if (m) return m;
        const base = isMetal ? METAL_COLOR : BALL_PALETTE[colorIndex % BALL_PALETTE.length]!.color;
        /*
         * 인쇄 잉크는 캡슐 표면보다 무광이다. three.js는 roughness에 맵을 곱하므로
         * 재질 러프니스를 잉크 값으로 올리고 맵에서 구슬 부분을 낮춰 되돌린다.
         */
        m = new THREE.MeshPhysicalMaterial({
          // 텍스처는 color에 곱해지므로 텍스처를 쓸 때는 color를 흰색으로 둔다
          color: useTex ? '#ffffff' : base,
          map: useTex ? ballTexture(base, variant) : null,
          roughnessMap: useTex
            ? ballRoughnessTexture(variant, MATERIAL.ballRoughness, MATERIAL.inkRoughness)
            : null,
          metalness: isMetal ? 0.88 : 0.02,
          roughness: isMetal
            ? MATERIAL.metalRoughness
            : useTex
              ? MATERIAL.inkRoughness
              : MATERIAL.ballRoughness,
          clearcoat: isMetal ? 0 : MATERIAL.clearcoat,
          clearcoatRoughness: 0.25,
          envMapIntensity: LIGHTING.envIntensity,
        });
        map.set(key, m);
        return m;
      },
      all: map,
    };
  }, []);

  /*
   * 베이크된 환경은 인공 Lightformer보다 어둡다(실제 벽 밝기를 그대로 담기 때문).
   * 베이크가 끝나면 반사 세기를 올려 구슬이 벽을 또렷하게 비추게 한다.
   */
  useEffect(() => {
    if (!baked) return;
    for (const m of materials.all.values()) {
      (m as THREE.MeshPhysicalMaterial).envMapIntensity = ENV.bakedIntensity;
      m.needsUpdate = true;
    }
  }, [baked, materials]);

  // 물리가 매 프레임 위치·회전을 바꾸므로 메시를 직접 동기화한다.
  // React 리렌더로 처리하면 구슬 78개 × 60fps가 낭비다.
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    const s = game.getRenderState();
    for (let i = 0; i < s.balls.length; i++) {
      const m = refs.current[i];
      const b = s.balls[i]!;
      if (!m) continue;
      m.position.set(b.x, b.y, b.z);
      m.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3]);
    }
  });

  return (
    <group ref={groupRef}>
      {state.balls.map((b, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={[b.x, b.y, b.z]}
          scale={b.r}
          geometry={ballGeometry(b.kind, MATERIAL.ribCount, MATERIAL.ribAmplitude)}
          material={materials.get(b.isMetal, b.colorIndex, b.hasDecal, b.decalVariant)}
          castShadow={shadows}
          receiveShadow={shadows}
        />
      ))}
    </group>
  );
}

/* ---------------- 집게 ---------------- */

/**
 * 마디 메시를 두 관절 사이에 놓는다.
 * 캡슐의 기본 축은 +Y이므로, 방향 (ux,uy)에 맞추려면 Z축 회전각은 atan2(-ux, uy)다.
 * 길이는 scale.y로 맞춰 지오메트리를 마디마다 새로 만들지 않는다.
 */
function place(
  mesh: THREE.Mesh | null | undefined,
  a: readonly [number, number],
  b: readonly [number, number],
) {
  if (!mesh) return;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-6;
  mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
  mesh.rotation.z = Math.atan2(-dx / len, dy / len);
  mesh.scale.y = len;
}

function Claw({ game, groupRef }: { game: ClawGame; groupRef?: (el: THREE.Group | null) => void }) {
  const S = WORLD.clawScale;
  const root = useRef<THREE.Group | null>(null);
  const cable = useRef<THREE.Mesh>(null);
  const upperRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lowerRefs = useRef<(THREE.Mesh | null)[]>([]);
  const elbowRefs = useRef<(THREE.Object3D | null)[]>([]);
  const tipRefs = useRef<(THREE.Object3D | null)[]>([]);

  const metal = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: THEME.clawColor,
        metalness: THEME.clawMetalness,
        roughness: 0.26,
        envMapIntensity: THEME.clawEnvIntensity,
      }),
    [],
  );
  const darkMetal = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#8c8f98', metalness: 0.95, roughness: 0.22 }),
    [],
  );
  const boltMetal = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#e8eaee', metalness: 1, roughness: 0.16 }),
    [],
  );
  /** 발끝 고무 패드 — 금속으로 두면 구슬과 닿는 지점이 하이라이트에 묻혀 접점이 안 보인다 */
  const tipPad = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#3a2b31', metalness: 0.1, roughness: 0.72 }),
    [],
  );

  useFrame(() => {
    const s: RenderState = game.getRenderState();
    if (root.current) {
      root.current.position.set(s.clawX, s.clawY, 0);
      // 케이블에 매달린 진자 — 집게 전체가 흔들리는 각도만큼 기운다
      root.current.rotation.z = s.swayAngle;
    }
    if (cable.current) {
      // 케이블은 캐리지에서 집게까지 이어진다. 집게가 기울어도 케이블은 곧게 유지된다.
      const dx = s.carriageX - s.clawX;
      const dy = WORLD.railY - 0.3 - s.clawY;
      const len = Math.max(0.1, Math.hypot(dx, dy));
      cable.current.scale.y = len;
      // 집게 로컬 좌표계가 이미 swayAngle만큼 회전되어 있으므로 그만큼 되돌린다
      cable.current.rotation.z = -s.swayAngle;
      cable.current.position.set(
        (dx / 2) * Math.cos(-s.swayAngle) - (dy / 2) * Math.sin(-s.swayAngle),
        (dx / 2) * Math.sin(-s.swayAngle) + (dy / 2) * Math.cos(-s.swayAngle),
        0,
      );
    }
    /*
     * 팔은 엔진과 **같은 함수**로 배치한다.
     * 예전에는 여기서 회전각만 주고 마디 길이·팔꿈치 굽힘은 JSX에 하드코딩했는데,
     * 그 형상이 콜라이더와 전혀 달랐다(닫힘 발끝 반경 물리 0.574 vs 화면 1.345).
     * 관절 좌표를 직접 계산해 넣으면 어긋날 여지가 없다.
     */
    const tilt = tiltFromOpen(s.clawOpen);
    for (let i = 0; i < PRONG_COUNT; i++) {
      const az = (i / PRONG_COUNT) * Math.PI * 2;
      const pose = prongPose(tilt + Math.sin(az * 1.7) * s.prongSkew * 0.05);
      place(upperRefs.current[i], pose.hub, pose.elbow);
      place(lowerRefs.current[i], pose.elbow, pose.tip);
      const t = tipRefs.current[i];
      if (t) t.position.set(pose.tip[0], pose.tip[1], 0);
      const e = elbowRefs.current[i];
      if (e) e.position.set(pose.elbow[0], pose.elbow[1], 0);
    }
  });

  const prongs = Array.from({ length: PRONG_COUNT }, (_, i) => ({
    angle: (i / PRONG_COUNT) * Math.PI * 2,
    key: i,
  }));

  return (
    <group
      ref={(el) => {
        root.current = el;
        groupRef?.(el);
      }}
      position={[0, WORLD.clawHomeY, 0]}
    >
      <mesh ref={cable} material={darkMetal}>
        <cylinderGeometry args={[0.05, 0.05, 1, 8]} />
      </mesh>

      <group scale={S}>
        <mesh position={[0, 0.52, 0]} material={boltMetal}>
          <sphereGeometry args={[0.2, 20, 14]} />
        </mesh>
        <mesh position={[0, 0.12, 0]} material={metal}>
          <cylinderGeometry args={[0.17, 0.17, 0.92, 16]} />
        </mesh>

        {[0.34, -0.02].map((y) => (
          <group key={y}>
            <mesh position={[0, y, 0]} material={darkMetal}>
              <cylinderGeometry args={[0.235, 0.235, 0.1, 16]} />
            </mesh>
            {prongs.map(({ angle, key }) => (
              <mesh
                key={key}
                position={[Math.cos(angle) * 0.235, y, Math.sin(angle) * 0.235]}
                rotation={[Math.PI / 2, 0, 0]}
                material={boltMetal}
              >
                <cylinderGeometry args={[0.05, 0.05, 0.06, 8]} />
              </mesh>
            ))}
          </group>
        ))}

        {/*
          관절 위치는 매 프레임 clawRig가 계산한다. 여기서는 마디를 하나씩 놓기만 한다 —
          마디 길이·굽힘을 JSX에 적으면 그 순간 콜라이더와 갈라진다.
          축 방향 실린더 + 관절 구체 구성이라 scale.y로 길이를 맞춰도 끝이 찌그러지지 않는다.
        */}
        {prongs.map(({ angle, key }) => (
          <group key={key} rotation={[0, angle, 0]}>
            {/* 어깨 너클 */}
            <mesh
              position={[CLAW_RIG.hubRadius, CLAW_RIG.hubY, 0]}
              rotation={[Math.PI / 2, 0, 0]}
              material={boltMetal}
            >
              <cylinderGeometry args={[0.11, 0.11, 0.17, 14]} />
            </mesh>

            {/* 위팔 */}
            <mesh
              ref={(el) => {
                upperRefs.current[key] = el;
              }}
              material={metal}
            >
              <cylinderGeometry args={[0.072, 0.088, 1, 14]} />
            </mesh>

            {/* 팔꿈치 너클 + 볼트 */}
            <group
              ref={(el) => {
                elbowRefs.current[key] = el;
              }}
            >
              <mesh rotation={[Math.PI / 2, 0, 0]} material={darkMetal}>
                <cylinderGeometry args={[0.098, 0.098, 0.19, 14]} />
              </mesh>
              {[-1, 1].map((sz) => (
                <mesh key={sz} position={[0, 0, sz * 0.1]} rotation={[Math.PI / 2, 0, 0]} material={boltMetal}>
                  <cylinderGeometry args={[0.042, 0.042, 0.04, 10]} />
                </mesh>
              ))}
            </group>

            {/* 아래팔 */}
            <mesh
              ref={(el) => {
                lowerRefs.current[key] = el;
              }}
              material={metal}
            >
              <cylinderGeometry args={[0.052, 0.072, 1, 14]} />
            </mesh>

            {/* 발끝 고무 패드 — 구슬에 실제로 닿는 지점 */}
            <group
              ref={(el) => {
                tipRefs.current[key] = el;
              }}
            >
              <mesh material={tipPad}>
                <sphereGeometry args={[CLAW_RIG.tipRadius, 16, 12]} />
              </mesh>
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}

function Rail({ game }: { game: ClawGame }) {
  const carriage = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: THEME.bezelColor, metalness: 0.6, roughness: 0.35 }),
    [],
  );
  useFrame(() => {
    // 캐리지는 조작 위치를 따르고, 집게는 그 아래에서 흔들린다
    if (carriage.current) carriage.current.position.x = game.getRenderState().carriageX;
  });
  return (
    <group position={[0, WORLD.railY, 0]}>
      <mesh material={mat}>
        <boxGeometry args={[WORLD.boxWidth - 1.2, 0.22, 0.5]} />
      </mesh>
      <mesh ref={carriage} position={[0, -0.2, 0]} material={mat}>
        <boxGeometry args={[1.1, 0.3, 0.62]} />
      </mesh>
    </group>
  );
}

/**
 * 씬 베이크 환경맵.
 *
 * 절차적 Lightformer는 "밝은 사방"을 흉내 낼 뿐이라 구슬이 실제 캐비닛을 반사하지 못한다.
 * 핑크 벽·발광 바닥·로고가 구슬에 비치지 않으니 구슬이 씬과 겉돈다.
 *
 * 캐비닛을 큐브맵에 한 번 구워 scene.environment로 쓰면 구슬이 진짜 주변을 반사한다.
 * 캐비닛은 정적이므로 1회 굽고 재사용하면 런타임 비용이 없다.
 * 구슬·집게는 굽는 동안 숨긴다 — 자기 반사가 섞이면 색이 탁해진다.
 */
function BakedEnvironment({
  hideRefs,
  onBaked,
}: {
  hideRefs: React.MutableRefObject<(THREE.Object3D | null)[]>;
  onBaked: () => void;
}) {
  const { gl, scene } = useThree();
  const done = useRef(false);
  const envTex = useRef<THREE.Texture | null>(null);

  useFrame(() => {
    if (done.current) {
      /*
       * drei의 <Environment>는 언마운트될 때 scene.environment를 이전 값(null)으로 되돌린다.
       * 다른 컴포넌트가 덮어써도 우리 환경맵이 유지되도록 매 프레임 확인한다(속성 비교뿐이라 무비용).
       */
      if (envTex.current && scene.environment !== envTex.current) {
        scene.environment = envTex.current;
      }
      return;
    }
    done.current = true;

    /*
     * 굽기 파이프라인에서 두 가지를 지켜야 한다.
     *  1) 톤매핑을 끈다. 켜둔 채 구우면 톤매핑된 LDR 이미지가 환경맵이 되어
     *     선형 밝기가 손실되고 구슬 전체가 어두워진다(실측).
     *  2) HalfFloat RT + PMREM. 러프니스별 블러가 제대로 되려면 프리필터링이 필요하다.
     *     생 큐브맵을 그대로 쓰면 거친 재질의 반사가 지저분해진다.
     */
    const rt = new THREE.WebGLCubeRenderTarget(ENV.resolution, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    const cam = new THREE.CubeCamera(0.2, 80, rt);
    cam.position.set(0, ENV.bakeY, 0);

    /*
     * 집게만 숨기고 구슬 더미는 포함해 굽는다.
     * 벽만 구우면 사방이 균일하게 밝아 금속 구슬이 흰 플라스틱처럼 납작해진다 —
     * 크롬은 어두운 영역이 있어야 크롬으로 읽힌다. 더미가 하반구에 변화를 만들어준다.
     * 자기 반사는 1회 베이크라 재귀하지 않는다.
     */
    const hidden = hideRefs.current.slice(1).filter(Boolean) as THREE.Object3D[];
    const prev = hidden.map((o) => o.visible);
    for (const o of hidden) o.visible = false;

    const prevTone = gl.toneMapping;
    const prevBg = scene.background;
    scene.environment = null;
    // 캐비닛에는 전면 벽이 없다. 배경을 비워두면 열린 쪽이 검은 공백으로 구워져
    // 구슬 앞면 반사가 어두워진다. 매장 조명에 해당하는 밝은 색을 넣는다.
    scene.background = new THREE.Color(ENV.openSideColor);
    gl.toneMapping = THREE.NoToneMapping;
    cam.update(gl, scene);
    gl.toneMapping = prevTone;
    scene.background = prevBg;

    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileCubemapShader();
    const envRT = pmrem.fromCubemap(rt.texture);
    scene.environment = envRT.texture;
    envTex.current = envRT.texture;

    /*
     * 각 재질에 envMap을 **직접** 물린다.
     *
     * scene.environment만 쓰면 three가 재질의 envMapIntensity를 무시한다 (r169, WebGLRenderer):
     *
     *   if (material.isMeshStandardMaterial && material.envMap === null && scene.environment !== null) {
     *     m_uniforms.envMapIntensity.value = scene.environmentIntensity;   // ← 재질 값을 덮어씀
     *   }
     *
     * 그래서 구슬(ENV.bakedIntensity)·벽(DEPTH.wallEnvIntensity)·집게(THEME.clawEnvIntensity)·
     * 전면유리의 반사 세기 설정이 **전부 무시되고** 일괄 scene.environmentIntensity(기본 1)로 돌았다.
     * 실측: bakedIntensity를 0.05 ↔ 4.0으로 바꿔도 픽셀 차가 0이었다.
     * envMap을 물리면 재질별 값이 정상 동작한다.
     */
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const std = m as THREE.MeshStandardMaterial;
        if (std && (std as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial && !std.envMap) {
          std.envMap = envRT.texture;
          std.needsUpdate = true;
        }
      }
    });
    pmrem.dispose();
    rt.dispose();

    hidden.forEach((o, i) => {
      o.visible = prev[i]!;
    });
    onBaked();
  });

  return null;
}

/* ---------------- 조명 ---------------- */

function Lights({ shadows }: { shadows: boolean }) {
  const h = WORLD.boxHeight;
  return (
    <>
      <ambientLight intensity={LIGHTING.ambientIntensity} color="#f4e6ec" />
      <directionalLight
        position={[LIGHTING.keyOffset[0], h + LIGHTING.keyOffset[1], LIGHTING.keyOffset[2]]}
        intensity={LIGHTING.keyIntensity}
        color="#fffaff"
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={12}
        shadow-camera-bottom={-4}
        shadow-camera-near={1}
        shadow-camera-far={45}
        shadow-bias={-0.0009}
      />
      <directionalLight position={[-9, h * 0.5, 7]} intensity={LIGHTING.fillIntensity} color="#f6cdd8" />
      <directionalLight position={[9, h * 0.35, 4]} intensity={LIGHTING.fillIntensity * 0.6} color="#ffe4ec" />

      {/*
        절차적 환경맵 — 네트워크에서 HDRI를 받지 않으므로 오프라인 기동에 유리하다.
        중요한 것은 밝기가 아니라 명암 대비다. 사방을 균일하게 밝게 두면
        금속이 흰 플라스틱처럼 납작해진다 — 크롬은 어두운 영역이 있어야 크롬으로 읽힌다.
      */}
      {/*
        환경맵은 씬 베이크가 전담한다(BakedEnvironment).
        절차적 Lightformer는 구슬이 "실제 캐비닛"을 반사하지 못해 씬과 겉돌고,
        drei <Environment>는 언마운트 시 scene.environment를 되돌려 베이크를 덮어쓴다.
      */}
    </>
  );
}

/* ---------------- 씬 ---------------- */

export function Scene({ game, shadows }: { game: ClawGame; shadows: boolean }) {
  const [baked, setBaked] = useState(false);
  const hideRefs = useRef<(THREE.Object3D | null)[]>([]);

  return (
    <>
      <RendererSettings />
      <Lights shadows={shadows} />
      <Cabinet shadows={shadows} />
      <Balls
        game={game}
        shadows={shadows}
        baked={baked}
        groupRef={(el) => {
          hideRefs.current[0] = el;
        }}
      />
      <Rail game={game} />
      <Claw
        game={game}
        groupRef={(el) => {
          hideRefs.current[1] = el;
        }}
      />
      {ENV.bake && <BakedEnvironment hideRefs={hideRefs} onBaked={() => setBaked(true)} />}
    </>
  );
}
