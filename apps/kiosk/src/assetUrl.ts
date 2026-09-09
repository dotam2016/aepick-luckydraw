/**
 * public/ 자산의 절대 URL.
 *
 * Vite는 import한 자산만 base에 맞춰 재작성한다. `'/assets/logo.png'` 같은
 * **평범한 문자열은 손대지 않으므로**, base가 '/kiosk/'인 빌드에서 그대로 404가 난다.
 * 실제로 로고와 어트랙트 영상이 이 문제로 빌드본에서 로드되지 않았다.
 *
 * BASE_URL은 개발에서 '/', 빌드에서 '/kiosk/'다.
 */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
