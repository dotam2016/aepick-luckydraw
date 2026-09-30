/**
 * 운영자 패널 — 기획서 v1.1 §6.1 / §5.6 / §12
 *
 * PIN 확인 → 1회 플레이 승인 또는 테스트 세션.
 * 미완료 세션이 있으면 이어하기/무효를 선택하게 한다 (§12 복구 규칙).
 */

import { useEffect, useState } from 'react';
import { WIN_TIERS, type ResultTier, type RevealMode } from '@aepick/shared';
import type { RecoverableSession } from '../api';
import { getLocale, t } from '../i18n';

export interface OperatorPanelProps {
  busy: boolean;
  error: string | null;
  recoverable: RecoverableSession | null;
  online: boolean;
  eventOn: boolean;
  revealMode: RevealMode;
  onStart: (opts: { isTest: boolean; forceTier?: ResultTier }) => void;
  onResume: (session: RecoverableSession) => void;
  onVoid: (sessionId: string) => void;
  onRevealModeChange: (m: RevealMode) => void;
  onClose: () => void;
  onCheckRecover: () => void;
  authed: boolean;
  /** PIN 입력 완료 시 호출. 검증은 서버가 한다. */
  onAuth: (pin: string) => void;
}

const PIN_LEN = 4;

export function OperatorPanel(props: OperatorPanelProps) {
  const {
    busy,
    error,
    recoverable,
    online,
    eventOn,
    revealMode,
    onStart,
    onResume,
    onVoid,
    onRevealModeChange,
    onClose,
    onCheckRecover,
    authed,
    onAuth,
  } = props;

  const [testMode, setTestMode] = useState(false);
  const [forceTier, setForceTier] = useState<ResultTier | undefined>(undefined);
  // PIN은 전송 전까지 패널 내부에만 둔다. 상위 state를 쓰면 빠른 연속 입력에서
  // 이전 값을 읽어 자릿수가 유실된다.
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (authed) onCheckRecover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  // PIN 자릿수가 채워지면 상위에 전달한다 (렌더 중 setState를 피하려고 effect에서 처리)
  useEffect(() => {
    if (!authed && pin.length === PIN_LEN) onAuth(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, authed]);

  /* ---------- PIN 입력 ---------- */
  if (!authed) {
    /*
     * 업데이터 함수 안에서 onAuth를 부르면 React가 렌더 중에 부모 setState를 호출해
     * "Cannot update a component while rendering a different component" 경고가 난다.
     * 자릿수 완성은 effect에서 감지한다.
     */
    const press = (d: string) => {
      setPin((cur) => {
        if (d === 'C') return '';
        if (d === '←') return cur.slice(0, -1);
        if (cur.length >= PIN_LEN) return cur;
        return cur + d;
      });
    };

    return (
      <div className="op-overlay">
        <div className="op-card">
          <h2>{t('operator.confirmTitle')}</h2>
          <div className="sub">{t('operator.pinPrompt', { len: String(PIN_LEN) })}</div>
          <div className="pin-display">
            {Array.from({ length: PIN_LEN }, (_, i) => (
              <i key={i} className={i < pin.length ? 'on' : ''} />
            ))}
          </div>
          <div className="keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '←'].map((k) => (
              <button key={k} onPointerDown={() => press(k)}>
                {k}
              </button>
            ))}
          </div>
          {error && <div className="op-error">{error}</div>}
          <div className="op-actions" style={{ marginTop: 22 }}>
            <button className="btn ghost" onPointerDown={onClose}>
              {t('operator.close')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- 미완료 세션 복구 ---------- */
  if (recoverable) {
    return (
      <div className="op-overlay">
        <div className="op-card">
          <h2>{t('operator.recoverTitle')}</h2>
          <div className="sub">{t('operator.recoverSub')}</div>
          <div className="op-status">
            {t('operator.sessionLabel')} <b>{recoverable.sessionId.slice(0, 8)}</b> ·{' '}
            {t('operator.statusLabel')} <b>{recoverable.status}</b>
            <br />
            {t('operator.createdLabel')}{' '}
            <b>{new Date(recoverable.createdAt).toLocaleString(getLocale(), { hour12: false })}</b>
            {recoverable.isTest && (
              <>
                <br />
                <b>{t('operator.testSessionBadge')}</b>
              </>
            )}
          </div>
          {error && <div className="op-error">{error}</div>}
          <div className="op-actions">
            <button className="btn primary" disabled={busy} onPointerDown={() => onResume(recoverable)}>
              {t('operator.resumeBtn')}
            </button>
            <button className="btn warn" disabled={busy} onPointerDown={() => onVoid(recoverable.sessionId)}>
              {t('operator.voidBtn')}
            </button>
            <button className="btn ghost" onPointerDown={onClose}>
              {t('operator.close')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- 플레이 승인 ---------- */
  const blocked = !online || !eventOn;

  return (
    <div className="op-overlay">
      <div className="op-card">
        <h2>{t('operator.approveTitle')}</h2>
        <div className="sub">{t('operator.approveSub')}</div>

        <div className="op-actions">
          <button
            className="btn primary"
            disabled={busy || blocked}
            onPointerDown={() => onStart({ isTest: false })}
          >
            {busy ? t('operator.approving') : t('operator.startPlay')}
          </button>

          {/* "Mở phiên test" — ẩn khỏi UI theo yêu cầu vận hành. testMode vẫn giữ nguyên
              logic bên dưới để bật lại nhanh bằng cách bỏ điều kiện `false &&` này. */}
          {false && (
            <button
              className="btn ghost"
              onPointerDown={() => {
                setTestMode((v) => !v);
                setForceTier(undefined);
              }}
            >
              {testMode ? t('operator.testSessionCollapse') : t('operator.testSessionOpen')}
            </button>
          )}
        </div>

        {testMode && (
          <>
            <div className="op-status">{t('operator.testModeNotice')}</div>
            <div className="tier-grid">
              {[...WIN_TIERS, 'miss' as const].map((tier) => (
                <button
                  key={tier}
                  className={forceTier === tier ? 'on' : ''}
                  onPointerDown={() => setForceTier(tier)}
                >
                  {tier === 'miss' ? t('operator.tierShortMiss') : t(`tier.${tier}`)}
                </button>
              ))}
            </div>
            <div className="op-actions" style={{ marginTop: 16 }}>
              <button
                className="btn primary"
                disabled={busy || blocked}
                onPointerDown={() => onStart({ isTest: true, forceTier })}
              >
                {t('operator.forceTierStart')}
                {forceTier
                  ? ` — ${forceTier === 'miss' ? t('operator.tierShortMiss') : t(`tier.${forceTier}`)}`
                  : t('operator.forceTierAsIs')}
              </button>
            </div>

            {/* §4.3 — A/B안을 현장에서 즉시 비교할 수 있게 런타임 토글로 둔다 */}
            <div className="op-status" style={{ marginTop: 22 }}>
              {t('operator.revealSectionTitle')}
            </div>
            <div className="tier-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <button
                className={revealMode === 'grabMiss' ? 'on' : ''}
                onPointerDown={() => onRevealModeChange('grabMiss')}
              >
                {t('operator.revealOptionA')}
              </button>
              <button
                className={revealMode === 'capsuleOpen' ? 'on' : ''}
                onPointerDown={() => onRevealModeChange('capsuleOpen')}
              >
                {t('operator.revealOptionB')}
              </button>
            </div>
          </>
        )}

        {error && <div className="op-error">{error}</div>}

        <div className="op-actions" style={{ marginTop: 20 }}>
          <button className="btn ghost" onPointerDown={onClose}>
            {t('operator.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
