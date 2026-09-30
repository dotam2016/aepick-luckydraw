/**
 * 현지화 — 문구는 서버가 내려주므로 앱 업데이트 없이 어드민에서 교체할 수 있다 (§8.2)
 */

import { DICTS, DEFAULT_LOCALE, type Locale } from '@aepick/shared';

let dicts: Record<Locale, Record<string, string>> = DICTS;
let locale: Locale = DEFAULT_LOCALE;

// 서버 문구가 키 단위로 우선하고, 서버 버전이 더 오래돼 빠진 키는 번들 문구로 채운다
export function installDicts(next: Record<Locale, Record<string, string>>) {
  const merged = { ...DICTS } as Record<Locale, Record<string, string>>;
  for (const l of Object.keys(next) as Locale[]) merged[l] = { ...DICTS[l], ...next[l] };
  dicts = merged;
}

export function setLocale(next: Locale) {
  locale = next;
}

export function getLocale(): Locale {
  return locale;
}

export function t(key: string, vars?: Record<string, string>): string {
  const dict = dicts[locale] ?? dicts[DEFAULT_LOCALE] ?? {};
  let out = dict[key] ?? dicts[DEFAULT_LOCALE]?.[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  return out;
}

export function localized(text: Record<Locale, string> | undefined): string {
  if (!text) return '';
  return text[locale] ?? text[DEFAULT_LOCALE] ?? Object.values(text)[0] ?? '';
}
