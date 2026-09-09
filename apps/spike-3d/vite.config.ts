import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  plugins: [react()],
  server: { port: 5175 },
  // 프로젝트가 Dropbox 안에 있어 동기화가 .vite 폴더를 잠그고 EBUSY를 낸다.
  // 의존성 캐시를 동기화 대상 밖으로 빼서 회피한다.
  cacheDir: join(tmpdir(), 'aepick-spike-3d-vite'),
});
