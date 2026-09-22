/**
 * 대기화면 W-00 — 기획서 v1.1 §6.1
 *
 * 프리렌더 영상 루프 대신 **플레이와 같은 2D 기계**를 그대로 세워 둔다
 * (layout-test.html에서 확정한 구성). 기계는 물리 없이 정지 자세로만 뜬다.
 *
 * 사용자용 Start 버튼은 노출하지 않는다. 운영자 승인만이 세션을 시작한다.
 */

import { useRef, useState } from 'react';
import type { Locale } from '@aepick/shared';
import { getLocale, setLocale, t } from '../i18n';
import { assetUrl } from '../assetUrl';
import { Cabinet2D } from '../game/Cabinet2D';
import { Controller } from './Controller';

export interface AttractProps {
  online: boolean;
  blockedReason: string | null;
  onOperatorEnter: () => void;
  onLocaleChange: (l: Locale) => void;
}

const noop = () => {};

/* 손님용 언어 스위처는 vi/en만 노출한다 — ko는 Locale 타입·사전에는 남아 있지만
   (다른 경로에서 쓰일 수 있어 손대지 않는다) 이 버튼 목록에서만 뺀다. */
const KIOSK_LOCALES: Locale[] = ['vi', 'en'];

export function Attract({ online, blockedReason, onOperatorEnter, onLocaleChange }: AttractProps) {
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const pressTimer = useRef<number | null>(null);

  /* 숨김 핫스팟 2초 롱프레스 → 운영자 패널 (§6.1) */
  const startPress = () => {
    pressTimer.current = window.setTimeout(onOperatorEnter, 2000);
  };
  const cancelPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const pick = (l: Locale) => {
    setLocale(l);
    setLocaleState(l);
    onLocaleChange(l);
  };

  return (
    <div className="layer attract">
      {/* 배경은 플레이와 같은 기계. game을 주지 않아 정지 자세로만 선다 */}
      <div className="field">
        <Cabinet2D />
      </div>
      {/* 조작부는 같은 컴포넌트를 재사용한다 — 입력·안내문은 막되 타이머는 0:00으로 남겨 둔다 */}
      <Controller remainingMs={0} totalMs={1} active={false} finished onHold={noop} onDrop={noop} />

      <div
        className="hotspot tl"
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
      />

      <div className="locale-switch">
        {KIOSK_LOCALES.map((l) => (
          <button key={l} className={l === locale ? 'on' : ''} onPointerDown={() => pick(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="attract-brand">
        {/* 제목 이미지에 부제까지 그려져 있다 — 언어별로 파일을 통째로 바꾼다
            (Result.tsx의 Chucmung.png/Chucmung2.png와 같은 방식) */}
        <img
          className="attract-title"
          src={assetUrl(`/assets/cabinet/${locale === 'vi' ? 'tittle.png' : 'tittle2.png'}`)}
          alt={t('attract.title')}
        />
      </div>

      {/*
        평상시에는 아무것도 띄우지 않는다(확정된 대기화면 구성). 다만 이벤트 종료·
        점검 같은 blockedReason과 오프라인 표시는 손님이 볼 유일한 통로라 남긴다.
      */}
      {(blockedReason || !online) && (
        <div className="attract-notice">
          {blockedReason}
          {!online && <small>· offline ·</small>}
        </div>
      )}
    </div>
  );
}
