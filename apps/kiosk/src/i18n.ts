/**
 * 현지화 — 문구는 서버가 내려주므로 앱 업데이트 없이 어드민에서 교체할 수 있다 (§8.2)
 */

import { DICTS, DEFAULT_LOCALE, type Locale } from '@aepick/shared';

let dicts: Record<Locale, Record<string, string>> = DICTS;
let locale: Locale = DEFAULT_LOCALE;

export function installDicts(next: Record<Locale, Record<string, string>>) {
  dicts = next;
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
