import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AttractRender } from './screens/AttractRender';
import './styles.css';

// 키오스크: 컨텍스트 메뉴·핀치줌·더블탭 확대 차단
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

/*
 * `?render=attract` — 대기 영상 렌더 전용 화면.
 * 본 앱 대신 3D 필드만 띄운다. `tools/render-attract.mjs`가 이 경로를 프레임 단위로 캡처한다.
 * 대기 영상을 키오스크에서 렌더해야 본 게임과 룩이 어긋나지 않는다(이전에는 스파이크에서 렌더해
 * 재질·조명 개선이 하나도 반영되지 않은 옛날 영상이 남아 있었다).
 *
 * StrictMode를 끈다 — effect가 두 번 돌면 ClawGame이 두 번 생성돼 시드가 어긋난다.
 */
const params = new URLSearchParams(location.search);
const isAttractRender = params.get('render') === 'attract';

createRoot(document.getElementById('root')!).render(
  isAttractRender ? (
    <AttractRender
      seed={Number(params.get('seed') ?? 424242)}
      ballCount={Number(params.get('balls')) || undefined}
    />
  ) : (
    <StrictMode>
      <App />
    </StrictMode>
  ),
);
