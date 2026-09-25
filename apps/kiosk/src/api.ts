/**
 * 서버 통신 — 기획서 v1.1 §10.2 / §12
 *
 * §12 핵심 규칙: 세션 생성 요청만은 절대 큐에 넣지 않는다.
 * 서버 응답 없이 플레이를 시작할 수 없다. 재시도는 반드시 동일 멱등키로 한다.
 */

import type {
  CreateSessionResponse,
  GameConfig,
  Locale,
  PlayedRequest,
  RevealPlan,
} from '@aepick/shared';

export interface BootstrapConfig {
  ruleVersion: number;
  game: GameConfig;
  event: {
    eventOn: boolean;
    emergencyStop: boolean;
    openAt: string;
    closeAt: string;
    offlineGraceSeconds: number;
  };
  prizeDisplay: { tier: string; name: Record<Locale, string>; imageKey: string | null }[];
  locales: Locale[];
  defaultLocale: Locale;
  i18n: Record<Locale, Record<string, string>>;
  serverTime: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** 미설정 시 빈 문자열 — 같은 origin의 로컬 서버(프록시/동일 배포)를 그대로 쓴다 */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

const DEVICE_KEY = 'ld.deviceId';

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = 'kiosk-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_BASE + path, {
      ...init,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new ApiError(body.error ?? 'HTTP_' + res.status, body.message ?? res.statusText, res.status);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export function fetchConfig(): Promise<BootstrapConfig> {
  return request<BootstrapConfig>('/api/config/active');
}

export function health(): Promise<{ ok: boolean; eventOn: boolean; emergencyStop: boolean }> {
  return request('/api/health', {}, 4000);
}

/**
 * 세션 생성. 타임아웃 시 동일 멱등키로만 재시도한다 (§12 복구 규칙).
 * 새 키를 발급하면 중복 세션이 생길 수 있으므로 절대 금지.
 */
export async function createSession(args: {
  idempotencyKey: string;
  pin: string;
  operatorId: string;
  isTest?: boolean;
  forceTier?: string;
  attempts?: number;
}): Promise<CreateSessionResponse> {
  const { attempts = 3, pin, ...rest } = args;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await request<CreateSessionResponse>('/api/sessions', {
        method: 'POST',
        headers: { 'x-operator-pin': pin },
        body: JSON.stringify({
          idempotencyKey: rest.idempotencyKey,
          deviceId: getDeviceId(),
          operatorId: rest.operatorId,
          isTest: rest.isTest,
          forceTier: rest.forceTier,
        }),
      });
    } catch (err) {
      lastErr = err;
      // 정책 거부(행사 OFF, 미완료 세션 등)는 재시도해도 결과가 같다
      if (err instanceof ApiError && err.status !== 0 && err.status < 500 && err.code !== 'STOCK_RACE') {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

export function reportPlayed(
  sessionId: string,
  resultToken: string,
  body: PlayedRequest,
): Promise<{ status: string }> {
  return request(`/api/sessions/${sessionId}/played`, {
    method: 'POST',
    headers: { 'x-result-token': resultToken },
    body: JSON.stringify(body),
  });
}

export function fetchReveal(sessionId: string, resultToken: string): Promise<RevealPlan> {
  return request(`/api/sessions/${sessionId}/reveal`, {
    headers: { 'x-result-token': resultToken },
  });
}

export function recover(pin: string): Promise<{ session: RecoverableSession | null }> {
  return request(`/api/recover?deviceId=${encodeURIComponent(getDeviceId())}`, {
    headers: { 'x-operator-pin': pin },
  });
}

export interface RecoverableSession {
  sessionId: string;
  status: string;
  createdAt: string;
  resultToken: string;
  physicsSeed: number;
  ruleVersion: number;
  isTest: boolean;
  game: GameConfig;
  motion: { win: boolean; missVariant: number; effectLevel: 1 | 2 | 3; revealMode: string } | null;
}

export function voidSession(sessionId: string, reason: string, pin: string): Promise<unknown> {
  return request(`/api/sessions/${sessionId}/void`, {
    method: 'POST',
    headers: { 'x-operator-pin': pin },
    body: JSON.stringify({ reason, actor: 'operator' }),
  });
}

/** 오류 리포트는 게임 흐름을 막지 않는다 — 실패해도 조용히 무시한다 */
export function reportError(payload: {
  sessionId?: string;
  errorCode: string;
  networkState?: string;
  appVersion?: string;
  recoveryAction?: string;
}): void {
  void fetch(API_BASE + '/api/errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appVersion: __APP_VERSION__, ...payload }),
  }).catch(() => {});
}

declare global {
  const __APP_VERSION__: string;
}
