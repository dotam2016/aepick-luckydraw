/**
 * 세션 코드 — 기획서 v1.1 §10.3
 *
 * 혼동 문자(0, 1, I, L, O)를 제외한 31자 집합에서 6자리.
 * 운영자가 지급 큐에서 육안으로 읽고 입력하는 값이므로 오독 가능성을 줄이는 것이 목적이다.
 * 애초에 혼동 문자를 발급하지 않으므로, 입력 단계에서 문자를 추측해 교정하지 않는다.
 * (추측 교정은 다른 유효 코드를 만들어낼 수 있어 오지급 위험이 있다.)
 */

export const CLAIM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CLAIM_CODE_LENGTH = 6;

if (CLAIM_CODE_ALPHABET.length !== 31) {
  throw new Error(`claim code alphabet must be 31 chars, got ${CLAIM_CODE_ALPHABET.length}`);
}

/** 조합 수: 31^6 = 887,503,681 */
export const CLAIM_CODE_SPACE = CLAIM_CODE_ALPHABET.length ** CLAIM_CODE_LENGTH;

export type RandomBytes = (size: number) => Uint8Array;

/**
 * 편향 없는 코드 생성. rejection sampling으로 알파벳 길이의 배수 구간(0~247)만 사용한다.
 */
export function generateClaimCode(randomBytes: RandomBytes): string {
  const n = CLAIM_CODE_ALPHABET.length;
  const limit = Math.floor(256 / n) * n; // 248
  let out = '';

  while (out.length < CLAIM_CODE_LENGTH) {
    const buf = randomBytes(CLAIM_CODE_LENGTH * 2);
    for (const byte of buf) {
      if (byte >= limit) continue;
      out += CLAIM_CODE_ALPHABET[byte % n];
      if (out.length === CLAIM_CODE_LENGTH) break;
    }
  }
  return out;
}

/** 운영자 입력 정규화 — 대문자화와 공백·하이픈 제거만 수행한다 */
export function normalizeClaimCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CLAIM_CODE_LENGTH);
}

/** 코드 형식 검증 */
export function isValidClaimCode(code: string): boolean {
  if (code.length !== CLAIM_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!CLAIM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/** 화면 표시용 — 결과화면은 6자리를 한 줄로 크게 노출한다 (§10.3) */
export function formatClaimCode(code: string): string {
  return code;
}
