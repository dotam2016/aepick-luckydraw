/**
 * 대기화면 W-00 — 기획서 v1.1 §6.1
 *
 * 3D를 실시간으로 돌리지 않고 프리렌더 영상 루프를 쓴다(레퍼런스와 같은 방식).
 * 대기화면은 인터랙션이 없고 방문자가 사진을 찍는 화면이므로,
 * 오프라인 렌더로 실시간 예산을 넘는 품질을 확보하는 편이 유리하다.
 * 영상은 `tools/render-attract.mjs`가 동일한 Three.js 씬에서 렌더한다.
 *
 * 사용자용 Start 버튼은 노출하지 않는다. 운영자 승인만이 세션을 시작한다.
 */

import { useEffect, useRef, useState } from 'react';
import { LOCALES, type Locale } from '@aepick/shared';
import type { BootstrapConfig } from '../api';
import { getLocale, localized, setLocale, t } from '../i18n';
import { assetUrl } from '../assetUrl';

export interface AttractProps {
  config: BootstrapConfig | null;
  online: boolean;
  blockedReason: string | null;
  onOperatorEnter: () => void;
  onLocaleChange: (l: Locale) => void;
}

const ATTRACT_VIDEO = assetUrl('/assets/attract.mp4');

export function Attract({ config, online, blockedReason, onOperatorEnter, onLocaleChange }: AttractProps) {
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pressTimer = useRef<number | null>(null);

  // 키오스크는 자동재생이 막힐 수 있다 — muted + playsInline이면 통과하지만
  // 실패하면 정적 배경으로 폴백해 화면이 비지 않게 한다.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => setVideoFailed(true));
  }, []);

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

  const notice = blockedReason ?? t('attract.staffNotice');

  return (
    <div className="layer attract">
      {!videoFailed ? (
        <video
          ref={videoRef}
          className="attract-video"
          src={ATTRACT_VIDEO}
          muted
          loop
          playsInline
          preload="auto"
          onError={() => setVideoFailed(true)}
        />
      ) : (
        <div className="attract-fallback" />
      )}

      <div
        className="hotspot tl"
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
      />

      <div className="locale-switch">
        {LOCALES.map((l) => (
          <button key={l} className={l === locale ? 'on' : ''} onPointerDown={() => pick(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="attract-brand">
        <h1 className="attract-title">{t('attract.title')}</h1>
        <div className="attract-sub">{t('attract.subtitle')}</div>
      </div>

      <div className="attract-notice">
        {notice}
        {!blockedReason && (
          <small>
            {t('tutorial.line1')} · {t('tutorial.line2')}
          </small>
        )}
        {!online && <small>· offline ·</small>}
      </div>

      {config && config.prizeDisplay.length > 0 && (
        <div className="prize-strip">
          {config.prizeDisplay.slice(0, 5).map((p) => (
            <div className="prize-chip" key={p.tier}>
              {localized(p.name)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
