/**
 * 화면 상태머신 (Layer 1) — 기획서 v1.1 §11 / 부록 A
 *
 * 불변 규칙:
 *   - 화면 상태는 세션 상태(Layer 2)를 변경하지 않는다.
 *   - 앱이 재시작되면 화면 상태는 무조건 WAITING에서 시작한다.
 *   - 결과를 받지 못하면 임의 결과를 표시하지 않고 OPERATOR_HOLD로 간다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CreateSessionResponse,
  Locale,
  ResultTier,
  RevealMode,
  RevealPlan,
  ScreenState,
} from '@aepick/shared';
import {
  ApiError,
  createSession,
  fetchConfig,
  fetchReveal,
  health,
  recover,
  reportError,
  reportPlayed,
  voidSession,
  type BootstrapConfig,
  type RecoverableSession,
} from './api';
import { installDicts, setLocale, t } from './i18n';
import { Attract } from './screens/Attract';
import { OperatorPanel } from './screens/OperatorPanel';
import { Play } from './screens/Play';
import { Result } from './screens/Result';
import type { Phase, PlayOutcome } from './game/clawGame';

const params = new URLSearchParams(location.search);
const DISABLE_TIMEOUT = params.get('noTimeout') === '1';
const DEBUG = params.get('debug') === '1';
const REVEAL_OVERRIDE = params.get('reveal') as RevealMode | null;
/** 벤치마크에서 품질 단계를 고정한다. 고정 시 §13 자동 축소도 멈춘다 — 측정 중 단계가 바뀌면 수치가 섞인다 */
const QUALITY_OVERRIDE = (globalThis as Record<string, unknown>).__Q_LEVEL__ as
  | 'high'
  | 'mid'
  | 'low'
  | undefined;
const PIN_STORAGE = 'ld.pin';

/** §12 — 단절 허용 시간을 넘기면 신규 플레이를 차단한다 */
const HEALTH_INTERVAL_MS = 15_000;

interface HoldState {
  code: string;
  message: string;
}

export default function App() {
  const [screen, setScreen] = useState<ScreenState>('WAITING');
  const [config, setConfig] = useState<BootstrapConfig | null>(null);
  const [session, setSession] = useState<CreateSessionResponse | null>(null);
  const [reveal, setReveal] = useState<RevealPlan | null>(null);
  const [hold, setHold] = useState<HoldState | null>(null);

  const [opOpen, setOpOpen] = useState(false);
  const [opBusy, setOpBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState('');
  const [recoverable, setRecoverable] = useState<RecoverableSession | null>(null);

  const [online, setOnline] = useState(true);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);
  const [revealMode, setRevealMode] = useState<RevealMode>(REVEAL_OVERRIDE ?? 'capsuleOpen');
  const [quality, setQuality] = useState<'high' | 'mid' | 'low'>(QUALITY_OVERRIDE ?? 'high');
  const [scale, setScale] = useState(1);

  const outcomeRef = useRef<PlayOutcome | null>(null);
  const verifyRef = useRef<{ consistent: boolean; detail: string } | null>(null);

  /* ---------- 스테이지 스케일 ---------- */
  useEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
      setScale(s);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  /* ---------- 부트스트랩 ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await fetchConfig();
        if (cancelled) return;
        installDicts(cfg.i18n);
        setLocale(cfg.defaultLocale);
        setConfig(cfg);
        if (!REVEAL_OVERRIDE) setRevealMode(cfg.game.revealMode);
        if (!QUALITY_OVERRIDE && cfg.game.effectQuality !== 'auto') setQuality(cfg.game.effectQuality);
        setOnline(true);
      } catch (err) {
        if (!cancelled) {
          setOnline(false);
          setOfflineSince(Date.now());
          reportError({ errorCode: 'BOOTSTRAP_FAILED', networkState: 'offline' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------- 헬스 폴링 ---------- */
  useEffect(() => {
    const check = async () => {
      try {
        const h = await health();
        setOnline(true);
        setOfflineSince(null);
        if (config) {
          setConfig({ ...config, event: { ...config.event, eventOn: h.eventOn, emergencyStop: h.emergencyStop } });
        }
      } catch {
        setOnline(false);
        setOfflineSince((prev) => prev ?? Date.now());
      }
    };
    const id = window.setInterval(check, HEALTH_INTERVAL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.event.eventOn, config?.event.emergencyStop]);

  /* ---------- 앱 재시작 시 미완료 세션 확인 (§11 불변 규칙) ---------- */
  useEffect(() => {
    const saved = localStorage.getItem(PIN_STORAGE);
    if (!saved) return;
    recover(saved)
      .then((r) => {
        if (r.session) {
          setRecoverable(r.session);
          setHold({
            code: 'SESSION_RECOVERY',
            message: t('error.callStaff'),
          });
          setScreen('OPERATOR_HOLD');
        }
      })
      .catch(() => {});
  }, []);

  /* ---------- 자동 품질 조정 (§13 프레임 저하) ---------- */
  const downgradeQuality = useCallback(() => {
    if (QUALITY_OVERRIDE) return;
    setQuality((q) => (q === 'high' ? 'mid' : 'low'));
  }, []);

  /* ---------- 운영자: 세션 시작 ---------- */
  const startSession = async ({ isTest, forceTier }: { isTest: boolean; forceTier?: ResultTier }) => {
    setOpBusy(true);
    setOpError(null);
    // 동일 멱등키로만 재시도한다 — createSession 내부에서 처리 (§12)
    const idempotencyKey = crypto.randomUUID();

    setScreen('SESSION_PREPARE');
    try {
      const created = await createSession({
        idempotencyKey,
        pin,
        operatorId: 'operator',
        isTest,
        forceTier,
      });
      // 런타임 A/B 토글을 반영한다 (§4.3)
      const withMode: CreateSessionResponse = {
        ...created,
        motion: { ...created.motion, revealMode },
        game: { ...created.game, revealMode },
      };
      setSession(withMode);
      setReveal(null);
      outcomeRef.current = null;
      verifyRef.current = null;
      setOpOpen(false);
      setOpBusy(false);
      setScreen('READY');
    } catch (err) {
      setOpBusy(false);
      const code = err instanceof ApiError ? err.code : 'NETWORK';
      const message = err instanceof Error ? err.message : String(err);
      reportError({ errorCode: code, networkState: online ? 'online' : 'offline' });

      if (code === 'SESSION_IN_PROGRESS') {
        try {
          const r = await recover(pin);
          if (r.session) setRecoverable(r.session);
        } catch {
          /* 무시 */
        }
        setOpError(message);
        setScreen('WAITING');
        return;
      }
      // 부록 A: draw_failed / network_timeout → OPERATOR_HOLD
      setOpError(message);
      setHold({ code, message });
      setScreen('OPERATOR_HOLD');
    }
  };

  /* ---------- 이어하기 ---------- */
  const resumeSession = (r: RecoverableSession) => {
    if (!r.motion) {
      setOpError('추첨 결과가 없는 세션입니다. 무효 처리해 주세요.');
      return;
    }
    setSession({
      sessionId: r.sessionId,
      resultToken: r.resultToken,
      motion: { ...r.motion, revealMode } as CreateSessionResponse['motion'],
      ruleVersion: r.ruleVersion,
      physicsSeed: r.physicsSeed,
      game: { ...r.game, revealMode },
      isTest: r.isTest,
      createdAt: r.createdAt,
    });
    setRecoverable(null);
    setHold(null);
    setOpOpen(false);
    setReveal(null);
    setScreen('READY');
  };

  const voidRecoverable = async (sessionId: string) => {
    setOpBusy(true);
    try {
      await voidSession(sessionId, '운영자 무효 처리 — 미완료 세션', pin);
      setRecoverable(null);
      setHold(null);
      setOpError(null);
      setScreen('WAITING');
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpBusy(false);
    }
  };

  /* ---------- 플레이 완료 → REVEAL ---------- */
  const onPlayFinished = async (
    outcome: PlayOutcome,
    perf: { minFps: number },
    verify: { consistent: boolean; detail: string },
  ) => {
    if (!session) return;
    outcomeRef.current = outcome;
    verifyRef.current = verify;
    setScreen('REVEAL');

    // §16.2 — 연출과 결과 불일치는 즉시 오류로 기록한다
    if (!verify.consistent) {
      reportError({
        sessionId: session.sessionId,
        errorCode: 'REVEAL_MISMATCH',
        recoveryAction: verify.detail,
      });
    }
    if (perf.minFps < 30) {
      downgradeQuality();
      reportError({
        sessionId: session.sessionId,
        errorCode: 'LOW_FPS',
        recoveryAction: `minFps=${perf.minFps} → quality down`,
      });
    }

    try {
      // 지표 전송은 실패해도 흐름을 막지 않는다 (재시도 큐 대상)
      reportPlayed(session.sessionId, session.resultToken, {
        aimDurationMs: outcome.aimDurationMs,
        catchX: outcome.catchX,
        autoCatch: outcome.autoCatch,
        minFps: perf.minFps,
        physicsSeed: session.physicsSeed,
      }).catch(() => {
        reportError({ sessionId: session.sessionId, errorCode: 'PLAYED_REPORT_FAILED' });
      });

      const plan = await fetchReveal(session.sessionId, session.resultToken);
      setReveal(plan);
      setScreen('RESULT');
    } catch (err) {
      // 부록 A: result_unavailable → OPERATOR_HOLD. 임의 결과 표시 금지.
      const code = err instanceof ApiError ? err.code : 'RESULT_UNAVAILABLE';
      reportError({ sessionId: session.sessionId, errorCode: code });
      setHold({ code, message: t('error.generic') });
      setScreen('OPERATOR_HOLD');
    }
  };

  /* ---------- 결과화면 자동 복귀 ---------- */
  const returnToWaiting = () => {
    setSession(null);
    setReveal(null);
    setHold(null);
    setScreen('WAITING');
  };

  /* ---------- 차단 사유 문구 ---------- */
  const graceExceeded =
    offlineSince !== null &&
    config !== null &&
    Date.now() - offlineSince > config.event.offlineGraceSeconds * 1000;

  let blockedReason: string | null = null;
  if (config?.event.emergencyStop) blockedReason = t('attract.blocked');
  else if (config && !config.event.eventOn) blockedReason = t('attract.eventClosed');
  else if (graceExceeded) blockedReason = t('error.network');

  const canStart = !!config && config.event.eventOn && !config.event.emergencyStop && online;

  /* ---------- 렌더 ---------- */
  return (
    <div className="viewport">
      <div
        className="stage"
        style={{ transform: `translate(${-540 * scale}px, ${-960 * scale}px) scale(${scale})` }}
      >
        {(screen === 'WAITING' || screen === 'SESSION_PREPARE') && (
          <Attract
            online={online}
            blockedReason={blockedReason}
            onOperatorEnter={() => {
              setOpOpen(true);
              setOpError(null);
            }}
            onLocaleChange={(l: Locale) => setLocale(l)}
          />
        )}

        {/* RESULT까지 남겨 둔다 — 결과 화면 배경이 투명해서 그 뒤로 기계가 그대로 보여야 한다.
            phase가 DONE이면 Play의 rAF 루프는 스스로 멈추므로 추가 비용은 없다. */}
        {session && ['READY', 'AIM', 'DROP', 'GRAB', 'LIFT', 'REVEAL', 'RESULT'].includes(screen) && (
          <Play
            session={session}
            quality={quality}
            disableTimeout={DISABLE_TIMEOUT}
            debug={DEBUG}
            onCatchLocked={() => {
              if (navigator.vibrate) navigator.vibrate(18); // §8.3 CATCH 시 짧은 햅틱 1회
            }}
            onPhase={(p: Phase) => {
              if (p !== 'DONE') setScreen(p as ScreenState);
            }}
            onFinished={onPlayFinished}
          />
        )}

        {screen === 'RESULT' && reveal && (
          <Result reveal={reveal} onReturn={returnToWaiting} disableTimeout={DISABLE_TIMEOUT} />
        )}

        {screen === 'OPERATOR_HOLD' && hold && (
          <div className="hold">
            <div className="icon">🛎️</div>
            <div className="msg">{hold.message}</div>
            <div className="code">{hold.code}</div>
            <div className="hotspot tl" onPointerDown={() => setOpOpen(true)} />
          </div>
        )}

        {opOpen && (
          <OperatorPanel
            busy={opBusy}
            error={opError}
            recoverable={recoverable}
            online={online}
            eventOn={canStart}
            revealMode={revealMode}
            authed={authed}
            onAuth={(entered) => {
              // PIN은 서버가 검증한다. 여기서는 보관만 하고 첫 요청에서 확인된다.
              setPin(entered);
              localStorage.setItem(PIN_STORAGE, entered);
              setAuthed(true);
              setOpError(null);
            }}
            onCheckRecover={() => {
              recover(localStorage.getItem(PIN_STORAGE) ?? pin)
                .then((r) => setRecoverable(r.session))
                .catch((err) => {
                  if (err instanceof ApiError && err.status === 401) {
                    setAuthed(false);
                    setPin('');
                    setOpError('PIN이 올바르지 않습니다.');
                  }
                });
            }}
            onStart={startSession}
            onResume={resumeSession}
            onVoid={voidRecoverable}
            onRevealModeChange={setRevealMode}
            onClose={() => {
              setOpOpen(false);
              setOpError(null);
            }}
          />
        )}

        {DEBUG && screen !== 'AIM' && !session && (
          <div className="debug">
            {`screen  ${screen}
online  ${online}${graceExceeded ? ' (grace exceeded)' : ''}
event   ${config ? (config.event.eventOn ? 'ON' : 'OFF') : '-'}${config?.event.emergencyStop ? ' STOP' : ''}
rule    v${config?.ruleVersion ?? '-'}
reveal  ${revealMode}
quality ${quality}`}
          </div>
        )}
      </div>
    </div>
  );
}
