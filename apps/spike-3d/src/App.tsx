import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, DepthOfField, EffectComposer, N8AO } from '@react-three/postprocessing';
import * as THREE from 'three';
import { DEFAULT_CONFIG, type VisualConfig } from './config';
import { Scene } from './Scene';
import { Panel } from './Panel';
import { Controller } from './Controller';

const params = new URLSearchParams(location.search);

/** 톤매핑·노출은 렌더러 속성이라 별도 컴포넌트에서 적용한다 */
function RendererSettings({ cfg }: { cfg: VisualConfig }) {
  const { gl, camera } = useThree();
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = cfg.exposure;
  }, [gl, cfg.exposure]);
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = cfg.cameraFov;
    cam.position.set(...cfg.cameraPos);
    cam.lookAt(new THREE.Vector3(...cfg.cameraTarget));
    cam.updateProjectionMatrix();
  }, [camera, cfg.cameraFov, cfg.cameraPos, cfg.cameraTarget]);
  return null;
}

function FpsMeter({ onFps }: { onFps: (n: number) => void }) {
  const acc = useRef(0);
  const frames = useRef(0);
  useFrame((_, delta) => {
    acc.current += delta;
    frames.current++;
    if (acc.current >= 0.5) {
      onFps(Math.round(frames.current / acc.current));
      acc.current = 0;
      frames.current = 0;
    }
  });
  return null;
}

function Post({ cfg }: { cfg: VisualConfig }) {
  const anyEnabled = cfg.bloomEnabled || cfg.dofEnabled || cfg.aoEnabled;
  if (!anyEnabled) return null;
  return (
    <EffectComposer enableNormalPass multisampling={0}>
      {cfg.aoEnabled ? (
        <N8AO aoRadius={cfg.aoRadius} intensity={cfg.aoIntensity} distanceFalloff={1} quality="medium" />
      ) : (
        <></>
      )}
      {cfg.bloomEnabled ? (
        <Bloom
          intensity={cfg.bloomIntensity}
          luminanceThreshold={cfg.bloomThreshold}
          luminanceSmoothing={cfg.bloomSmoothing}
          mipmapBlur
        />
      ) : (
        <></>
      )}
      {cfg.dofEnabled ? (
        <DepthOfField
          // focusDistance는 near~far 정규화 값이라 감이 안 온다.
          // target으로 월드 좌표(더미 중심)를 주면 초점이 직관적으로 맞는다.
          target={[0, 1.6, 0]}
          focalLength={cfg.dofFocalLength}
          bokehScale={cfg.dofBokehScale}
        />
      ) : (
        <></>
      )}
    </EffectComposer>
  );
}

export default function App() {
  const [cfg, setCfg] = useState<VisualConfig>(DEFAULT_CONFIG);
  const [fps, setFps] = useState(60);
  const [pileSeed, setPileSeed] = useState(20260805);
  const [refMode, setRefMode] = useState<'off' | 'gameplay' | 'attract'>(
    (params.get('ref') as 'gameplay' | 'attract') ?? 'off',
  );
  const [refOpacity, setRefOpacity] = useState(0.5);

  const set = useCallback(<K extends keyof VisualConfig>(key: K, value: VisualConfig[K]) => {
    setCfg((c) => ({ ...c, [key]: value }));
  }, []);

  // 콘솔에서도 만질 수 있게 노출 — 검토 중 빠른 실험용
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.cfg = cfg;
    w.setCfg = setCfg;
    /** 렌더 결과를 축소 JPEG dataURL로 반환 — 레퍼런스와 나란히 비교할 때 쓴다 */
    w.grab = (width = 540) => {
      const src = document.querySelector('canvas') as HTMLCanvasElement | null;
      if (!src) return null;
      const scale = width / src.width;
      const off = document.createElement('canvas');
      off.width = width;
      off.height = Math.round(src.height * scale);
      off.getContext('2d')!.drawImage(src, 0, 0, off.width, off.height);
      return off.toDataURL('image/jpeg', 0.88);
    };
  }, [cfg]);

  const refSrc = refMode === 'gameplay' ? '/ref-gameplay.jpg' : '/ref-attract.jpg';

  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1080, window.innerHeight / 1920));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  return (
    <div className="viewport">
      <div
        className="stage"
        style={{ transform: `translate(${-540 * scale}px, ${-960 * scale}px) scale(${scale})` }}
      >
        <div className="field">
        <Canvas
          dpr={cfg.dpr}
          shadows={cfg.shadowsEnabled}
          // preserveDrawingBuffer: 렌더 결과를 toDataURL로 꺼내 레퍼런스와 나란히 비교하기 위해 켠다.
          // 실제 키오스크 빌드에서는 끄는 편이 낫다(메모리·성능).
          gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
          camera={{ fov: cfg.cameraFov, position: cfg.cameraPos, near: 0.1, far: 200 }}
        >
          <RendererSettings cfg={cfg} />
          <FpsMeter onFps={setFps} />
          <Scene cfg={cfg} pileSeed={pileSeed} />
          <Post cfg={cfg} />
        </Canvas>

        {refMode !== 'off' && (
          <img className="refoverlay" src={refSrc} alt="reference" style={{ opacity: refOpacity }} />
        )}
        </div>

        {cfg.showController && (
          <Controller
            cfg={cfg}
            seconds={12}
            onMove={(dir, pressed) => {
              // 스파이크에서는 집게를 즉시 이동시켜 조작감만 확인한다
              if (!pressed) return;
              const step = dir === 'left' ? -0.6 : dir === 'right' ? 0.6 : 0;
              if (step) setCfg((c) => ({ ...c, clawX: Math.max(-4.5, Math.min(4.5, c.clawX + step)) }));
            }}
            onDrop={() => setCfg((c) => ({ ...c, clawY: c.clawY > 4 ? 1.6 : 13.5 }))}
          />
        )}
      </div>

      <Panel
        cfg={cfg}
        set={set}
        replace={setCfg}
        reseed={() => setPileSeed((s) => s + 1)}
        fps={fps}
        refMode={refMode}
        setRefMode={setRefMode}
        refOpacity={refOpacity}
        setRefOpacity={setRefOpacity}
      />
    </div>
  );
}
