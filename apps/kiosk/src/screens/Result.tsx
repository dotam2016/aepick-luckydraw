/**
 * 결과화면 R-00 — 기획서 v1.1 §6.3
 *
 * 핵심: 지급 완료 조작을 두지 않는다. 최대 노출 시간이 지나면 무조건 자동 복귀하고,
 *       지급은 어드민 지급 큐(§6.4)에서 비동기로 처리한다.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { RevealPlan } from '@aepick/shared';
import { getLocale, localized, t } from '../i18n';
import { BALL_PALETTE } from '../game/layout';
import { assetUrl } from '../assetUrl';

function Confetti({ level }: { level: 1 | 2 | 3 }) {
  const pieces = useMemo(() => {
    const count = level === 3 ? 90 : level === 2 ? 50 : 24;
    return Array.from({ length: count }, (_, i) => {
      const light = BALL_PALETTE[i % BALL_PALETTE.length]!.color;
      const dark = BALL_PALETTE[(i + 3) % BALL_PALETTE.length]!.color;
      return {
        left: Math.random() * 100,
        delay: Math.random() * 1.4,
        dur: 2.6 + Math.random() * 2.2,
        color: i % 3 === 0 ? '#e8c04c' : i % 2 === 0 ? light : dark,
        w: 12 + Math.random() * 12,
        h: 20 + Math.random() * 18,
      };
    });
  }, [level]);

  return (
    <div className="confetti">
      {pieces.map((p, i) => (
        <i
          key={i}
          style={{
            left: `${p.left}%`,
            width: p.w,
            height: p.h,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
          }}
        />
      ))}
    </div>
  );
}

export interface ResultProps {
  reveal: RevealPlan;
  onReturn: () => void;
  disableTimeout: boolean;
}

export function Result({ reveal, onReturn, disableTimeout }: ResultProps) {
  const totalMs = reveal.resultSeconds * 1000;
  const startedAt = useRef(performance.now());

  useEffect(() => {
    if (disableTimeout) return;
    let raf = 0;
    const tick = () => {
      if (performance.now() - startedAt.current >= totalMs) {
        onReturn();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalMs, disableTimeout]);

  if (!reveal.win) {
    return (
      <div className="result miss">
        {reveal.isTest && <div className="test-watermark">{t('result.testWatermark')}</div>}
        <div className="result-field">
          <div
            className="result-miss-box"
            style={{ backgroundImage: `url(${assetUrl('/assets/cabinet/Vien2.png')})` }}
          >
            <p className="result-miss-body">{t('result.missBody')}</p>
          </div>
        </div>
      </div>
    );
  }

  const prizeName = localized(reveal.prize?.name);
  /* 당첨 타이틀 이미지는 글자가 그림에 박혀 있어 언어별로 파일을 바꿔야 한다.
     Chucmung.png = 베트남어, Chucmung2.png = 영문(Congratulations). */
  const titleImg = getLocale() === 'vi' ? 'Chucmung.png' : 'Chucmung2.png';

  return (
    <div className="result win">
      {reveal.isTest && <div className="test-watermark">{t('result.testWatermark')}</div>}
      <Confetti level={reveal.effectLevel} />

      <div className="result-field">
        <img
          className="result-title-img"
          src={assetUrl(`/assets/cabinet/${titleImg}`)}
          alt={t('result.winTitle')}
        />

        {/* §6.3 — 등급보다 실제 지급 경품명·이미지를 크게 표시한다 */}
        <div
          className="prize-box"
          style={{ backgroundImage: `url(${assetUrl('/assets/cabinet/Vien.png')})` }}
        >
          <img className="prize-visual" src={assetUrl('/assets/cabinet/gift.png')} alt="" />
          <div className="prize-name">{prizeName}</div>
        </div>
      </div>
    </div>
  );
}
