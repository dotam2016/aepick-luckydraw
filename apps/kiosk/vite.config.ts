import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * base는 **빌드에서만** '/kiosk/'다.
 *
 * 서버(server/src/index.ts)가 빌드 산출물을 `prefix: '/kiosk/'`로 서빙하는데
 * base가 기본값('/')이면 index.html이 `/assets/index-*.js`를 가리켜 404가 난다.
 * 그 결과 페이지는 200을 주지만 <div id="root">만 남아 **빈 화면**이 된다.
 * (localhost:8788/kiosk/ 가 백지로 나오던 원인. 빌드본은 지금까지 한 번도 동작하지 않았다.)
 *
 * 개발 서버는 '/'로 둔다 — kiosk-shot·bench·wallsweep 등 검증 도구가 전부
 * http://localhost:5174/ 를 직접 연다.
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/kiosk/' : '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
  },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:8788', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', assetsDir: 'assets' },
  // 프로젝트가 Dropbox 안에 있어 동기화가 .vite를 잠그고 EBUSY를 낸다
  cacheDir: join(tmpdir(), 'aepick-kiosk-vite'),
}));
