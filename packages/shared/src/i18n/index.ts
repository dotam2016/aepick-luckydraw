import en from './en.json' with { type: 'json' };
import ko from './ko.json' with { type: 'json' };
import vi from './vi.json' with { type: 'json' };
import { LOCALES, type Locale } from '../types.js';

export type Dict = Record<string, string>;

/** 사용자 화면은 베트남어 우선, 영어 보조 (§1.2) */
export const DICTS: Record<Locale, Dict> = { vi, en, ko };

export const DEFAULT_LOCALE: Locale = 'vi';

export function translate(locale: Locale, key: string, vars?: Record<string, string>): string {
  const dict = DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
  let out = dict[key] ?? DICTS[DEFAULT_LOCALE][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, v);
    }
  }
  return out;
}

/** 모든 로케일이 동일한 키 집합을 갖는지 — 현지화 누락 방지 (§14 현지화) */
export function findMissingKeys(): Record<Locale, string[]> {
  const allKeys = new Set<string>();
  for (const locale of LOCALES) {
    for (const key of Object.keys(DICTS[locale])) allKeys.add(key);
  }
  const out = {} as Record<Locale, string[]>;
  for (const locale of LOCALES) {
    out[locale] = [...allKeys].filter((k) => !(k in DICTS[locale])).sort();
  }
  return out;
}
