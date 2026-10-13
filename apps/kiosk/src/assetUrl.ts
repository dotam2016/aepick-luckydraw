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

const rawUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;

/* 선로딩이 끝난 자산은 blob: URL을 돌려준다 — 아래 설명 참고 */
const blobs = new Map<string, string>();

export function assetUrl(path: string): string {
  const u = rawUrl(path);
  return blobs.get(u) ?? u;
}

/* ---------- 이미지 선로딩 ----------
 * 안내·결과 화면은 액자 이미지 위에 HTML 글자를 얹는다. 이미지가 화면이 뜬 뒤에 로드되면
 * 글자만 먼저 보이다가 액자가 늦게 나타난다.
 *
 * 그냥 Image()로 미리 받아 두는 것으로는 부족했다. Cloudflare Pages는 이미지를
 * `Cache-Control: max-age=0, must-revalidate`로 내려서, 같은 URL의 <img>를 나중에 또 만들면
 * 브라우저가 서버에 재검증을 한 번 더 보낸다(실측: 왕복 시간만큼 글자가 먼저 보임).
 * 그래서 각 이미지를 한 번만 받아 blob으로 메모리에 쥐고, 화면은 그 blob: URL을 쓴다 —
 * 이후로는 네트워크 요청이 아예 없고 서버 캐시 헤더와도 무관하다.
 * 앱은 모든 이미지가 준비될 때까지 화면을 숨긴다(App.tsx assetsReady, useImagesReady). */
const preloaded = new Map<string, Promise<void>>();
const ready = new Set<string>();
/* 디코드된 비트맵이 버려지지 않게 Image 객체도 쥐고 있는다 */
const pinned: HTMLImageElement[] = [];

function load(path: string): Promise<void> {
  const u = rawUrl(path);
  let p = preloaded.get(u);
  if (!p) {
    p = fetch(u)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        const blobUrl = URL.createObjectURL(b);
        blobs.set(u, blobUrl);
        const img = new Image();
        pinned.push(img);
        img.src = blobUrl;
        return img.decode();
      })
      // 실패해도 ready로 취급한다 — 깨진 이미지 때문에 화면이 영영 숨겨지면 안 된다
      .catch(() => {})
      .then(() => {
        ready.add(u);
      });
    preloaded.set(u, p);
  }
  return p;
}

/** paths는 assetUrl과 같은 형식('/assets/cabinet/webp/Guide.webp') */
export function preloadImages(paths: string[]): Promise<void> {
  return Promise.all(paths.map(load)).then(() => {});
}

/* 글꼴도 첫 글자가 그려질 때에야 받기 시작한다. 라틴·베트남어 서브셋을 미리 받아
   두지 않으면 결과 화면에서 글자가 늦게 나타나거나 대체 글꼴로 먼저 보인다. */
export function preloadFonts(): Promise<void> {
  if (!document.fonts) return Promise.resolve();
  return Promise.all([document.fonts.load('700 40px Quicksand', 'aàảẫ'), document.fonts.load('400 40px Quicksand', 'aàảẫ')])
    .then(() => {})
    .catch(() => {});
}

export function useImagesReady(paths: string[]): boolean {
  const [ok, setOk] = useState(() => paths.every((p) => ready.has(rawUrl(p))));
  useEffect(() => {
    if (ok) return;
    let alive = true;
    preloadImages(paths).then(() => alive && setOk(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ok;
}
