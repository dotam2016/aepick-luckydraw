/**
 * 조절 패널 — 외부 GUI 의존 없이 최소 구현.
 * 확정된 값은 "설정 복사" 버튼으로 그대로 config.ts에 붙여넣을 수 있게 한다.
 */

import { useState } from 'react';
import { DEFAULT_CONFIG, QUALITY_PRESETS, applyTheme, type ThemeName, type VisualConfig } from './config';

interface PanelProps {
  cfg: VisualConfig;
  set: <K extends keyof VisualConfig>(key: K, value: VisualConfig[K]) => void;
  replace: (next: VisualConfig) => void;
  reseed: () => void;
  fps: number;
  refMode: 'off' | 'gameplay' | 'attract';
  setRefMode: (m: 'off' | 'gameplay' | 'attract') => void;
  refOpacity: number;
  setRefOpacity: (v: number) => void;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="row">
      <span className="lbl">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="val">{value.toFixed(step < 1 ? (step < 0.01 ? 3 : 2) : 0)}</span>
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row toggle">
      <span className="lbl">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="row">
      <span className="lbl">{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="val mono">{value}</span>
    </label>
  );
}

export function Panel(props: PanelProps) {
  const { cfg, set, replace, reseed, fps, refMode, setRefMode, refOpacity, setRefOpacity } = props;
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<'scene' | 'material' | 'light' | 'post' | 'perf'>('scene');
  const [copied, setCopied] = useState(false);

  const copyConfig = async () => {
    await navigator.clipboard.writeText(JSON.stringify(cfg, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const applyQuality = (q: 'high' | 'mid' | 'low') => replace({ ...cfg, ...QUALITY_PRESETS[q] });

  if (!open) {
    return (
      <button className="fab" onClick={() => setOpen(true)}>
        ⚙ 패널 {fps}fps
      </button>
    );
  }

  return (
    <div className="panel">
      <div className="head">
        <b>비주얼 스파이크</b>
        <span className={'fps' + (fps < 45 ? ' bad' : fps < 55 ? ' warn' : '')}>{fps} fps</span>
        <button className="x" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>

      <div className="tabs">
        {(
          [
            ['scene', '씬'],
            ['material', '재질'],
            ['light', '조명'],
            ['post', '후처리'],
            ['perf', '성능'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      <div className="body">
        {tab === 'scene' && (
          <>
            <label className="row">
              <span className="lbl">테마</span>
              <select value={cfg.theme} onChange={(e) => replace(applyTheme(cfg, e.target.value as ThemeName))}>
                <option value="aepick">Aepick (핑크)</option>
                <option value="reference">레퍼런스 (연보라)</option>
              </select>
            </label>
            <label className="row">
              <span className="lbl">조작 축</span>
              <select value={cfg.inputAxes} onChange={(e) => set('inputAxes', Number(e.target.value) as 1 | 2)}>
                <option value={1}>1축 좌우 (현재 설계)</option>
                <option value={2}>2축 4방향 (레퍼런스)</option>
              </select>
            </label>
            <Toggle label="조작부 표시" value={cfg.showController} onChange={(v) => set('showController', v)} />
            <Toggle label="로고" value={cfg.showLogo} onChange={(v) => set('showLogo', v)} />
            <Toggle label="낙하 애니메이션" value={cfg.animate} onChange={(v) => set('animate', v)} />
            <Slider label="구슬 수" value={cfg.ballCount} min={10} max={140} step={1} onChange={(v) => set('ballCount', v)} />
            <Slider
              label="더미 깊이(겹)"
              value={cfg.pileDepthLayers}
              min={1}
              max={4}
              step={1}
              onChange={(v) => set('pileDepthLayers', v)}
            />
            <div className="note">깊이 1 = 현재 2D 물리와 동일한 평면 배치. 레퍼런스는 2~3.</div>
            <Slider label="박스 폭" value={cfg.boxWidth} min={6} max={18} step={0.25} onChange={(v) => set('boxWidth', v)} />
            <Slider label="박스 깊이" value={cfg.boxDepth} min={3} max={14} step={0.5} onChange={(v) => set('boxDepth', v)} />
            <Slider label="박스 높이" value={cfg.boxHeight} min={10} max={26} step={0.5} onChange={(v) => set('boxHeight', v)} />
            <Slider label="집게 X" value={cfg.clawX} min={-5} max={5} step={0.1} onChange={(v) => set('clawX', v)} />
            <Slider label="집게 Y" value={cfg.clawY} min={1} max={19} step={0.1} onChange={(v) => set('clawY', v)} />
            <Slider label="집게 열림" value={cfg.clawOpen} min={0} max={1} step={0.01} onChange={(v) => set('clawOpen', v)} />
            <Slider label="집게 크기" value={cfg.clawScale} min={0.6} max={2.4} step={0.05} onChange={(v) => set('clawScale', v)} />
            <label className="row">
              <span className="lbl">집게 발</span>
              <select value={cfg.prongCount} onChange={(e) => set('prongCount', Number(e.target.value) as 2 | 3)}>
                <option value={2}>2발 (현재 구현)</option>
                <option value={3}>3발 (레퍼런스)</option>
              </select>
            </label>
            <Slider label="카메라 FOV" value={cfg.cameraFov} min={18} max={55} step={1} onChange={(v) => set('cameraFov', v)} />
            <button className="act" onClick={reseed}>
              더미 다시 쌓기
            </button>
          </>
        )}

        {tab === 'material' && (
          <>
            <Slider label="구슬 러프니스" value={cfg.ballRoughness} min={0} max={1} step={0.01} onChange={(v) => set('ballRoughness', v)} />
            <Slider label="금속 러프니스" value={cfg.metalRoughness} min={0} max={1} step={0.01} onChange={(v) => set('metalRoughness', v)} />
            <Slider label="클리어코트" value={cfg.clearcoat} min={0} max={1} step={0.01} onChange={(v) => set('clearcoat', v)} />
            <Slider label="골 깊이" value={cfg.ribAmplitude} min={0} max={0.25} step={0.005} onChange={(v) => set('ribAmplitude', v)} />
            <Slider label="골 개수" value={cfg.ribCount} min={4} max={28} step={1} onChange={(v) => set('ribCount', v)} />
            <Toggle label="로고 데칼" value={cfg.showDecals} onChange={(v) => set('showDecals', v)} />
            <Color label="집게 색" value={cfg.clawColor} onChange={(v) => set('clawColor', v)} />
            <Color label="벽 상단" value={cfg.wallColorTop} onChange={(v) => set('wallColorTop', v)} />
            <Color label="벽 하단" value={cfg.wallColorBottom} onChange={(v) => set('wallColorBottom', v)} />
            <Color label="바닥 발광" value={cfg.floorGlowColor} onChange={(v) => set('floorGlowColor', v)} />
            <Slider label="벽 자체발광" value={cfg.wallEmissive} min={0} max={1.5} step={0.02} onChange={(v) => set('wallEmissive', v)} />
          </>
        )}

        {tab === 'light' && (
          <>
            <Slider label="키 라이트" value={cfg.keyIntensity} min={0} max={6} step={0.05} onChange={(v) => set('keyIntensity', v)} />
            <Slider label="필 라이트" value={cfg.fillIntensity} min={0} max={3} step={0.05} onChange={(v) => set('fillIntensity', v)} />
            <Slider label="앰비언트" value={cfg.ambientIntensity} min={0} max={2} step={0.05} onChange={(v) => set('ambientIntensity', v)} />
            <Slider label="환경맵 세기" value={cfg.envIntensity} min={0} max={3} step={0.05} onChange={(v) => set('envIntensity', v)} />
            <Slider label="바닥 발광 세기" value={cfg.floorGlowIntensity} min={0} max={8} step={0.1} onChange={(v) => set('floorGlowIntensity', v)} />
            <Slider label="모서리 발광" value={cfg.edgeGlowIntensity} min={0} max={4} step={0.05} onChange={(v) => set('edgeGlowIntensity', v)} />
            <Slider label="노출" value={cfg.exposure} min={0.4} max={2} step={0.01} onChange={(v) => set('exposure', v)} />
            <Toggle label="그림자" value={cfg.shadowsEnabled} onChange={(v) => set('shadowsEnabled', v)} />
          </>
        )}

        {tab === 'post' && (
          <>
            <Toggle label="블룸" value={cfg.bloomEnabled} onChange={(v) => set('bloomEnabled', v)} />
            <Slider label="블룸 세기" value={cfg.bloomIntensity} min={0} max={2} step={0.01} onChange={(v) => set('bloomIntensity', v)} />
            <Slider label="블룸 임계" value={cfg.bloomThreshold} min={0} max={1} step={0.01} onChange={(v) => set('bloomThreshold', v)} />
            <Toggle label="피사계심도" value={cfg.dofEnabled} onChange={(v) => set('dofEnabled', v)} />
            <Slider label="초점 거리" value={cfg.dofFocusDistance} min={0} max={0.05} step={0.0005} onChange={(v) => set('dofFocusDistance', v)} />
            <Slider label="보케 크기" value={cfg.dofBokehScale} min={0} max={8} step={0.1} onChange={(v) => set('dofBokehScale', v)} />
            <Toggle label="앰비언트 오클루전" value={cfg.aoEnabled} onChange={(v) => set('aoEnabled', v)} />
            <Slider label="AO 세기" value={cfg.aoIntensity} min={0} max={4} step={0.05} onChange={(v) => set('aoIntensity', v)} />
            <Slider label="AO 반경" value={cfg.aoRadius} min={0.1} max={3} step={0.05} onChange={(v) => set('aoRadius', v)} />
          </>
        )}

        {tab === 'perf' && (
          <>
            <div className="note">키오스크 §13 자동 품질 축소와 연결될 단계입니다.</div>
            <div className="btnrow">
              <button className="act" onClick={() => applyQuality('high')}>
                high
              </button>
              <button className="act" onClick={() => applyQuality('mid')}>
                mid
              </button>
              <button className="act" onClick={() => applyQuality('low')}>
                low
              </button>
            </div>
            <Slider label="렌더 배율(DPR)" value={cfg.dpr} min={0.5} max={2} step={0.1} onChange={(v) => set('dpr', v)} />
            <div className="note">
              실기기 확정 전이므로 이 값은 개발 기기 기준입니다. §14의 60fps 기준은 실기기에서 다시 측정해야 합니다.
            </div>
          </>
        )}
      </div>

      <div className="refbox">
        <div className="lbl">레퍼런스 겹쳐 보기</div>
        <div className="btnrow">
          {(
            [
              ['off', '끔'],
              ['gameplay', '게임플레이'],
              ['attract', '대기화면'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={'act' + (refMode === k ? ' on' : '')} onClick={() => setRefMode(k)}>
              {l}
            </button>
          ))}
        </div>
        {refMode !== 'off' && (
          <Slider label="불투명도" value={refOpacity} min={0} max={1} step={0.02} onChange={setRefOpacity} />
        )}
      </div>

      <div className="foot">
        <button className="act" onClick={copyConfig}>
          {copied ? '복사됨' : '설정 복사'}
        </button>
        <button className="act ghost" onClick={() => replace(DEFAULT_CONFIG)}>
          초기화
        </button>
      </div>
    </div>
  );
}
