/**
 * public/ 자산의 절대 URL.
 *
 * Vite는 import한 자산만 base에 맞춰 재작성한다. `'/assets/logo.png'` 같은
 * **평범한 문자열은 손대지 않으므로**, base가 '/kiosk/'인 빌드에서 그대로 404가 난다.
 * 실제로 로고와 어트랙트 영상이 이 문제로 빌드본에서 로드되지 않았다.
 *
 * BASE_URL은 개발에서 '/', 빌드에서 '/kiosk/'다.
 */
import { useEffect, useState } from 'react';

export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}

/* ---------- 이미지 선로딩 ----------
 * 안내·결과 화면은 액자 이미지 위에 HTML 글자를 얹는다. 이미지가 화면이 뜬 뒤에 로드되면
 * 글자만 먼저 보이다가 액자가 늦게 나타난다. 앱 시작 때 미리 받아 두고(decode까지),
 * 화면은 useImagesReady가 true가 될 때까지 내용을 숨긴다. */
const preloaded = new Map<string, Promise<void>>();
const ready = new Set<string>();

export function preloadImages(urls: string[]): Promise<void> {
  return Promise.all(
    urls.map((u) => {
      let p = preloaded.get(u);
      if (!p) {
        const img = new Image();
        img.src = u;
        // 실패해도 ready로 취급한다 — 깨진 이미지 때문에 화면이 영영 숨겨지면 안 된다
        p = img
          .decode()
          .catch(() => {})
          .then(() => {
            ready.add(u);
          });
        preloaded.set(u, p);
      }
      return p;
    }),
  ).then(() => {});
}

export function useImagesReady(urls: string[]): boolean {
  const [ok, setOk] = useState(() => urls.every((u) => ready.has(u)));
  useEffect(() => {
    if (ok) return;
    let alive = true;
    preloadImages(urls).then(() => alive && setOk(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ok;
}
