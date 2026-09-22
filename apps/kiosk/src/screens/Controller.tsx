/**
 * 조작부 — 화면 하단 619px. 2D 스킨의 `panel.png`를 그대로 깔고 그 위에 버튼
 * 스프라이트를 얹는다. 스티커는 패널 이미지에 이미 구워져 있다.
 *
 * 축 처리: 집게 이동은 1축(X)이므로 좌·우 두 버튼만 둔다.
 * 동작하지 않는 상·하 버튼을 그려두면 사용자가 누르고 반응이 없어 고장으로 인지한다.
 */

import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../assetUrl';
import { t } from '../i18n';

export interface ControllerProps {
  /** 남은 조준 시간(ms) */
  remainingMs: number;
  totalMs: number;
  /** 조작 가능 여부 — AIM 상태에서만 true */
  active: boolean;
  /** 판이 끝나 결과화면이 덮인 상태. 타이머·게이지·안내문은 감추고 버튼만 남긴다 */
  finished?: boolean;
  onHold: (dir: -1 | 1 | 0) => void;
  onDrop: () => void;
}

export function Controller({ remainingMs, totalMs, active, finished, onHold, onDrop }: ControllerProps) {
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
      <img className="ctl-panel" src={assetUrl('/assets/cabinet/panel.png')} alt="" />

      {/* 타이머·게이지는 대기·결과 화면에서도 그대로 남되 0:00으로 멈춘다 —
          입력 안내(ctl-hints)만 플레이 중이 아닐 때 걷는다 */}
      <div className={'ctl-timer' + (hurry ? ' hurry' : '')}>
        {seconds.toFixed(2).replace('.', ':')}
      </div>
      <div className={'ctl-timerbar' + (hurry ? ' hurry' : '')}>
        <i style={{ width: `${(remainingMs / totalMs) * 100}%` }} />
      </div>

      {/*
        버튼 상자는 디자인 좌표 그대로 두면 좌·우가 40px 겹친다(좌 110~345, 우 305~582).
        겹친 구간은 DOM 뒤쪽인 오른쪽 버튼이 가져가 왼쪽 버튼 오른쪽 끝을 눌러도
        오른쪽으로 움직인다. 그래서 왼쪽 버튼의 **누르는 상자만** 195px로 줄이고
        이미지는 원래 폭 그대로 넘치게 뒀다 — 보이는 건 그대로, 판정만 갈라진다.
      */}
      <button
        className={'padimg pad pad-left' + (held === -1 ? ' on' : '')}
        disabled={!active}
        onPointerDown={() => press(-1)}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        aria-label="left"
      >
        <img src={assetUrl('/assets/cabinet/btn-left.png')} alt="" />
      </button>

      <button
        className={'padimg pad pad-right' + (held === 1 ? ' on' : '')}
        disabled={!active}
        onPointerDown={() => press(1)}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        aria-label="right"
      >
        <img src={assetUrl('/assets/cabinet/btn-right.png')} alt="" />
      </button>

      <button
        className={'padimg dropbtn pad-catch' + (pressed ? ' on pressed' : '')}
        disabled={!active}
        onPointerDown={() => {
          setPressed(true);
          onDrop();
        }}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        aria-label={t('action.catch')}
      >
        <img src={assetUrl('/assets/cabinet/btn-catch.png')} alt="" />
      </button>

      {!finished && (
        <div className="ctl-hints">
          <span>{t('aim.guide')}</span>
          <span>{t('action.catch')}</span>
        </div>
      )}
    </div>
  );
}
