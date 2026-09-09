/**
 * 결과화면 R-00 — 기획서 v1.1 §6.3
 *
 * 핵심: 지급 완료 조작을 두지 않는다. 최대 노출 시간이 지나면 무조건 자동 복귀하고,
 *       지급은 어드민 지급 큐(§6.4)에서 비동기로 처리한다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RevealPlan } from '@aepick/shared';
import { localized, t } from '../i18n';
import { BALL_PALETTE } from '../game/layout';

const TIER_KEY: Record<string, string> = {
  t1: 'tier.t1',
  t2: 'tier.t2',
  t3: 'tier.t3',
  t4: 'tier.t4',
  t5: 'tier.t5',
  miss: 'tier.miss',
};

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
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(performance.now());

  useEffect(() => {
    if (disableTimeout) return;
    let raf = 0;
    const tick = () => {
      const e = performance.now() - startedAt.current;
      setElapsed(e);
      if (e >= totalMs) {
        onReturn();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalMs, disableTimeout]);

  const remain = Math.max(0, 1 - elapsed / totalMs);

  if (!reveal.win) {
    return (
      <div className="result miss">
        {reveal.isTest && <div className="test-watermark">{t('result.testWatermark')}</div>}
        <h1 className="result-title">{t('result.missTitle')}</h1>
        <p className="result-miss-body">{t('result.missBody')}</p>
        <div className="tier-pill">{t(TIER_KEY.miss)}</div>
        <div className="result-progress">
          <i style={{ width: `${remain * 100}%` }} />
        </div>
      </div>
    );
  }

  const prizeName = localized(reveal.prize?.name);

  return (
    <div className="result win">
      {reveal.isTest && <div className="test-watermark">{t('result.testWatermark')}</div>}
      <Confetti level={reveal.effectLevel} />

      <h1 className="result-title">{t('result.winTitle')}</h1>
      <div className="tier-pill">{t(TIER_KEY[reveal.tier] ?? 'tier.t5')}</div>

      {/* §6.3 — 등급보다 실제 지급 경품명·이미지를 크게 표시한다 */}
      <div className="prize-box">
        <div className="prize-visual">🎁</div>
        <div className="prize-name">{prizeName}</div>
      </div>

      {/* §10.3 — 6자리를 한 줄로 크게. 운영자가 지급 큐에서 조회하는 값 */}
      {reveal.claimCode && (
        <div className="code-box">
          <div className="label">{t('result.codeLabel')}</div>
          <div className="code">{reveal.claimCode}</div>
          <div className="hint">{t('result.showToStaff')}</div>
        </div>
      )}

      <div className="result-progress">
        <i style={{ width: `${remain * 100}%` }} />
      </div>
    </div>
  );
}
