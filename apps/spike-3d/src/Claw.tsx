/**
 * 집게 — 레퍼런스는 3발 기계식(로즈메탈, 볼트·힌지 디테일).
 *
 * 이동은 1축(X)을 유지하되 발 개수는 비주얼 선택 사항이므로 2/3발을 전환 가능하게 둔다.
 * 프리미티브 조합으로 만들어 외부 모델 의존이 없다 — 실제 에셋이 오면 glTF로 교체하면 된다.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { THEMES, type VisualConfig } from './config';

interface ClawProps {
  cfg: VisualConfig;
  topY: number;
}

export function Claw({ cfg, topY }: ClawProps) {
  const { prongCount, clawColor, clawMetalness, clawOpen, clawX, clawY, clawScale } = cfg;

  const metal = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: clawColor,
        metalness: clawMetalness,
        roughness: 0.28,
      }),
    [clawColor, clawMetalness],
  );

  const darkMetal = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#8c8f98', metalness: 0.95, roughness: 0.22 }),
    [],
  );

  const boltMetal = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#e8eaee', metalness: 1, roughness: 0.16 }),
    [],
  );

  // 열림 0 → 닫힘, 1 → 활짝
  const spread = 0.16 + clawOpen * 0.5;

  const prongs = Array.from({ length: prongCount }, (_, i) => {
    const angle = (i / prongCount) * Math.PI * 2;
    return { angle, key: i };
  });

  return (
    <group position={[clawX, clawY, 0]}>
      {/* 케이블 — 레일에서 헤드까지. 배율과 무관하게 굵기를 유지한다 */}
      <mesh position={[0, (topY - clawY) / 2 + 0.1, 0]} material={darkMetal}>
        <cylinderGeometry args={[0.05, 0.05, Math.max(0.1, topY - clawY), 8]} />
      </mesh>

      <group scale={clawScale}>

      {/* 상부 조인트 */}
      <mesh position={[0, 0.52, 0]} material={boltMetal}>
        <sphereGeometry args={[0.2, 20, 14]} />
      </mesh>

      {/* 중앙 몸통 */}
      <mesh position={[0, 0.12, 0]} material={metal}>
        <cylinderGeometry args={[0.17, 0.17, 0.92, 16]} />
      </mesh>

      {/* 몸통 밴드 2개 — 레퍼런스의 기계적 디테일 */}
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

      {/* 발 */}
      {prongs.map(({ angle, key }) => (
        <group key={key} rotation={[0, angle, 0]}>
          {/* 상단 링크 — 바깥으로 벌어짐 */}
          <group position={[0, -0.32, 0]} rotation={[0, 0, -spread]}>
            <mesh position={[0.42, -0.06, 0]} rotation={[0, 0, Math.PI / 2]} material={metal}>
              <capsuleGeometry args={[0.075, 0.78, 4, 12]} />
            </mesh>
            {/* 힌지 볼트 */}
            <mesh position={[0.84, -0.06, 0]} rotation={[Math.PI / 2, 0, 0]} material={boltMetal}>
              <cylinderGeometry args={[0.085, 0.085, 0.12, 12]} />
            </mesh>

            {/* 하단 링크 — 안쪽으로 감기며 발끝 형성 */}
            <group position={[0.84, -0.06, 0]} rotation={[0, 0, -1.05 + clawOpen * 0.15]}>
              <mesh position={[0.38, -0.02, 0]} rotation={[0, 0, Math.PI / 2]} material={metal}>
                <capsuleGeometry args={[0.062, 0.66, 4, 12]} />
              </mesh>
              {/* 발끝 */}
              <mesh position={[0.74, -0.02, 0]} material={darkMetal}>
                <sphereGeometry args={[0.085, 14, 10]} />
              </mesh>
            </group>
          </group>
        </group>
      ))}
      </group>
    </group>
  );
}

/** 레일 — 집게가 X축으로만 이동하는 것을 시각적으로 설명한다 */
export function Rail({ cfg, y }: { cfg: VisualConfig; y: number }) {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: THEMES[cfg.theme].bezelColor,
        metalness: 0.6,
        roughness: 0.35,
      }),
    [cfg.theme],
  );
  return (
    <group position={[0, y, 0]}>
      <mesh material={mat}>
        <boxGeometry args={[cfg.boxWidth - 1.2, 0.22, 0.5]} />
      </mesh>
      <mesh position={[cfg.clawX, -0.2, 0]} material={mat}>
        <boxGeometry args={[1.1, 0.3, 0.62]} />
      </mesh>
    </group>
  );
}
