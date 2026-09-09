/**
 * 조작부 오버레이 — 레퍼런스(Lotte Lucky Picker)의 컨트롤러 디자인을 따른다.
 *
 * 레퍼런스 구성: 좌측 D-pad + 우측 대형 하강 버튼 + 중앙 상단 타이머 + 주변 3D 아이콘.
 * 광택 있는 금속 베젤과 유리 같은 버튼 면이 특징이다.
 *
 * 축 처리:
 *   inputAxes = 1 → 좌·우 두 버튼만 (집게가 X로만 움직이므로)
 *   inputAxes = 2 → 4방향 D-pad (Z 이동까지 활성. 3D 물리 전환으로 가능해졌다)
 *
 * 동작하지 않는 방향 버튼을 그려두면 사용자가 누르고 반응이 없어 고장으로 인지한다.
 * 그래서 1축에서는 상·하 버튼을 아예 그리지 않고, 같은 시각 언어(베젤·광택)만 유지한다.
 */

import { useState } from 'react';
import { AEPICK, type VisualConfig } from './config';

type Dir = 'left' | 'right' | 'up' | 'down';

export interface ControllerProps {
  cfg: VisualConfig;
  /** 남은 시간(초) — 표시용 */
  seconds: number;
  onMove?: (dir: Dir, pressed: boolean) => void;
  onDrop?: () => void;
}

function PadButton({
  dir,
  active,
  onDown,
  onUp,
}: {
  dir: Dir;
  active: boolean;
  onDown: () => void;
  onUp: () => void;
}) {
  const rot = { left: 180, right: 0, up: -90, down: 90 }[dir];
  return (
    <button
      className={'pad' + (active ? ' on' : '')}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      aria-label={dir}
    >
      <span className="glyph" style={{ transform: `rotate(${rot}deg)` }}>
        ➤
      </span>
    </button>
  );
}

export function Controller({ cfg, seconds, onMove, onDrop }: ControllerProps) {
  const [held, setHeld] = useState<Dir | null>(null);
  const [dropped, setDropped] = useState(false);

  const press = (dir: Dir) => {
    setHeld(dir);
    onMove?.(dir, true);
  };
  const release = () => {
    if (held) onMove?.(held, false);
    setHeld(null);
  };

  const twoAxis = cfg.inputAxes === 2;
  const accent = cfg.theme === 'aepick' ? AEPICK.accent : '#b07ad0';

  return (
    <div className="controller" style={{ ['--ctl-accent' as string]: accent }}>
      {/* 장식 아이콘 — 레퍼런스의 3D 스티커 */}
      <span className="deco d1">✦</span>
      <span className="deco d2">♥</span>
      <span className="deco d3">☁</span>
      <span className="deco d4">✧</span>

      <div className="timer">{seconds.toFixed(2).replace('.', ':')}</div>

      <div className="ctl-row">
        {/* 좌: 방향 패드 */}
        <div className={'dpad' + (twoAxis ? ' cross' : ' horizontal')}>
          {twoAxis && (
            <PadButton dir="up" active={held === 'up'} onDown={() => press('up')} onUp={release} />
          )}
          <PadButton dir="left" active={held === 'left'} onDown={() => press('left')} onUp={release} />
          <PadButton dir="right" active={held === 'right'} onDown={() => press('right')} onUp={release} />
          {twoAxis && (
            <PadButton dir="down" active={held === 'down'} onDown={() => press('down')} onUp={release} />
          )}
        </div>

        {/* 우: 하강 버튼 */}
        <button
          className={'dropbtn' + (dropped ? ' pressed' : '')}
          onPointerDown={() => {
            setDropped(true);
            onDrop?.();
          }}
          onPointerUp={() => setDropped(false)}
        >
          <span className="ring" />
          <span className="glyph">▼</span>
        </button>
      </div>

      <div className="hints">
        <span>{twoAxis ? '집게 위치를 조절하세요' : '좌우로 집게 위치를 조절하세요'}</span>
        <span>누르면 집게가 하강해요</span>
      </div>
    </div>
  );
}
