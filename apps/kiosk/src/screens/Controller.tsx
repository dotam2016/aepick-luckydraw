/**
 * 조작부 — 화면 하단 576px. 레퍼런스(Lotte Lucky Picker) 컨트롤러 디자인을 따른다.
 *
 * 축 처리: 집게 이동은 1축(X)이므로 좌·우 두 버튼만 둔다.
 * 동작하지 않는 상·하 버튼을 그려두면 사용자가 누르고 반응이 없어 고장으로 인지한다.
 * 레퍼런스의 시각 언어(광택 금속 베젤 + 유리 버튼 + 장식 아이콘 + 중앙 타이머)는 유지한다.
 */

import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

export interface ControllerProps {
  /** 남은 조준 시간(ms) */
  remainingMs: number;
  totalMs: number;
  /** 조작 가능 여부 — AIM 상태에서만 true */
  active: boolean;
  onHold: (dir: -1 | 1 | 0) => void;
  onDrop: () => void;
}

export function Controller({ remainingMs, totalMs, active, onHold, onDrop }: ControllerProps) {
  const [held, setHeld] = useState<-1 | 1 | 0>(0);
  const [pressed, setPressed] = useState(false);
  const heldRef = useRef<-1 | 1 | 0>(0);
  heldRef.current = held;

  // 입력이 잠기면 홀드 상태도 해제한다 (버튼을 누른 채 페이즈가 넘어가는 경우)
  useEffect(() => {
    if (!active && held !== 0) {
      setHeld(0);
      onHold(0);
    }
  }, [active, held, onHold]);

  const press = (dir: -1 | 1) => {
    if (!active) return;
    setHeld(dir);
    onHold(dir);
  };
  const release = () => {
    if (heldRef.current === 0) return;
    setHeld(0);
    onHold(0);
  };

  const seconds = Math.max(0, remainingMs / 1000);
  const hurry = active && remainingMs <= 3000;

  return (
    <div className="controller">
      <span className="deco d1">✦</span>
      <span className="deco d2">♥</span>
      <span className="deco d3">☁</span>
      <span className="deco d4">✧</span>

      <div className={'ctl-timer' + (hurry ? ' hurry' : '')}>
        {seconds.toFixed(2).replace('.', ':')}
      </div>
      <div className={'ctl-timerbar' + (hurry ? ' hurry' : '')}>
        <i style={{ width: `${(remainingMs / totalMs) * 100}%` }} />
      </div>

      <div className="ctl-row">
        <div className="dpad">
          {([-1, 1] as const).map((dir) => (
            <button
              key={dir}
              className={'pad' + (held === dir ? ' on' : '')}
              disabled={!active}
              onPointerDown={() => press(dir)}
              onPointerUp={release}
              onPointerLeave={release}
              onPointerCancel={release}
              aria-label={dir === -1 ? 'left' : 'right'}
            >
              <span className="glyph" style={{ transform: `rotate(${dir === -1 ? 180 : 0}deg)` }}>
                ➤
              </span>
            </button>
          ))}
        </div>

        <button
          className={'dropbtn' + (pressed ? ' pressed' : '')}
          disabled={!active}
          onPointerDown={() => {
            setPressed(true);
            onDrop();
          }}
          onPointerUp={() => setPressed(false)}
        >
          <span className="ring" />
          <span className="glyph">▼</span>
        </button>
      </div>

      <div className="ctl-hints">
        <span>{t('aim.guide')}</span>
        <span>{t('action.catch')}</span>
      </div>
    </div>
  );
}
