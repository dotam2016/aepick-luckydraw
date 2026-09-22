/**
 * 구슬(하트) 지오메트리 — 풍선처럼 통통한 3D 하트.
 *
 * 레퍼런스(heart1.png): 광택 캔디 하트가 어느 방향에서도 평평한 면 없이 매끄럽게
 * 둥글다. 이전 시도(ExtrudeGeometry+bevel)는 캡을 부풀려도 옆면이 곧은 벽이라
 * 옆에서 보면 알약처럼 보였다.
 *
 * 그래서 SphereGeometry와 같은 방식으로 만든다: 위도 원을 sin(theta)로 좁혀
 * 극에서 하나로 모으는 대신, "원" 자리에 하트 2D 윤곽을 그대로 쓴다. 적도
 * (theta=90°)에서는 원본 하트 윤곽이 그대로 나오고, 앞/뒤 극으로 갈수록 같은
 * 윤곽이 통째로 축소되며 한 점에 모인다.
 *
 * 처음엔 모든 고리에서 같은(자기닮음) 윤곽을 그대로 축소해 썼는데, 노치처럼
 * 오목한 자리는 아무리 부드럽게 다듬어도 앞극→뒤극까지 이어지는 골로 남아
 * 앞면 한가운데를 가로지르는 선처럼 보였다 — 국소 곡률을 아무리 다듬어도
 * "그 골이 깊이 방향으로 끝까지 이어진다"는 사실 자체는 바뀌지 않기 때문이다.
 * 그래서 적도에서 멀어질수록(극에 가까워질수록) 윤곽 자체를 매끄럽게 뭉갠
 * 버전(roundOutline)과 섞어, 노치·끝점 같은 하트만의 굴곡이 적도 부근에서만
 * 나타나고 극 쪽은 둥글게 마무리되게 한다 — 정면(적도 부근)에서는 참고
 * 이미지처럼 또렷한 하트 실루엣이, 옆·비스듬한 각도(극 쪽)에서는 골이나
 * 능선 없이 풍선처럼 매끈하게 보인다.
 *
 * 물리 콜라이더는 그대로 구(sphere)를 쓴다(clawGame.ts 참조) — 게임플레이(간격,
 * 집게 하강 깊이 등)는 그 반지름 그대로 유지해야 하므로 건드리지 않는다.
 *
 * VISUAL_SCALE(바운딩 스피어 반지름)을 1보다 크게 두면(한때 2, 이후 1.6을
 * 써봤다) 옆 구슬의 콜라이더는 서로 닿기만 해도 실제로 더 큰 시각 메시끼리는
 * 서로의 안쪽까지 파고들어 겹쳐 보인다 — "구슬처럼 서로 맞닿기만 하고 안으로
 * 파고들면 안 된다"는 피드백을 받고 1로 되돌렸다. 하트가 자기 바운딩 스피어를
 * 꽉 채우지 않는 방향도 있어서(모서리 쪽), 콜라이더가 맞닿아도 대부분은 살짝
 * 틈이 생기고 최악의 경우(하트의 가장 볼록한 부분끼리 정면으로 마주칠 때)에만
 * 딱 맞닿는다 — 실제 구슬 더미와 같은 방식으로 겹친다.
 */

import * as THREE from 'three';

/**
 * 좌우 대칭 2D 하트 윤곽. 원점 근처, 노치는 위쪽 중앙, 끝점은 아래쪽.
 *
 * 이 윤곽을 극점까지 자기닮음 축소하며 앞극→뒤극으로 쌓는 로프트 방식에서는,
 * 윤곽 위의 한 점이 "각지게" 꺾여 있으면(접선이 그 점 앞뒤로 방향이 바뀌면)
 * 그 각도 위치를 따라 앞극→뒤극까지 이어지는 골(오목한 노치)이나 능선(볼록한
 * 끝점)이 곡면 전체에 뚜렷한 선으로 드러난다 — 각을 완만하게(더 둔각으로) 잡는
 * 정도로는 사라지지 않고 옅어지기만 한다.
 *
 * 노치·끝점 둘 다 완전히 매끄럽게(접선 연속, 각짐 없음) 만들어 이 자국 자체를
 * 없앤다 — 곡선이 만나는 지점 양쪽의 제어점을 그 지점과 같은 높이에 둬서
 * 접선이 항상 수평이 되게 한다(대칭축 위의 매끄러운 극소점은 접선이 수평이어야
 * 한다). 끝점(하단)은 하트의 정체성이라 완전히 뭉개지 않지만, 접힘 각도를
 * 넓게 잡아(핸들을 넉넉히 둬서) 참고 이미지처럼 완만하고 둥근 인상으로 만든다
 * — 핸들이 짧을수록 수학적으로는 매끄러워도 육안으로는 더 뾰족해 보인다.
 */
function heartShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0.85);
  s.bezierCurveTo(0.24, 0.85, 0.34, 1.06, 0.62, 1.0);
  s.bezierCurveTo(0.9, 0.96, 1.08, 0.68, 1.0, 0.32);
  s.bezierCurveTo(0.9, -0.15, 0.3, -0.95, 0, -1.15);
  s.bezierCurveTo(-0.3, -0.95, -0.9, -0.15, -1.0, 0.32);
  s.bezierCurveTo(-1.08, 0.68, -0.9, 0.96, -0.62, 1.0);
  s.bezierCurveTo(-0.34, 1.06, -0.24, 0.85, 0, 0.85);
  return s;
}

/** 닫힌 점열을 이웃 평균 쪽으로 살짝 당겨 부드럽게 만든다(라플라시안 완화) */
function smoothClosedPolyline(pts: THREE.Vector2[], iterations: number, alpha: number): THREE.Vector2[] {
  let cur = pts;
  const n = cur.length;
  for (let it = 0; it < iterations; it++) {
    const next: THREE.Vector2[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = cur[(i - 1 + n) % n]!;
      const c = cur[i]!;
      const nxt = cur[(i + 1) % n]!;
      next[i] = new THREE.Vector2(c.x + alpha * ((prev.x + nxt.x) / 2 - c.x), c.y + alpha * ((prev.y + nxt.y) / 2 - c.y));
    }
    cur = next;
  }
  return cur;
}

/**
 * 하트 윤곽을 등호 간격 폐곡선 점열로 샘플링한다.
 *
 * moveTo→bezierCurveTo 순서가 위(0,0.62)에서 오른쪽으로 나가는 시계 방향이라,
 * SphereGeometry 공식이 가정하는 반시계 방향(cos,sin이 각도 증가에 따라 도는
 * 방향)과 반대다. 그대로 두면 삼각형 감김새가 뒤집혀 법선이 안쪽을 향한다 —
 * 뒤집어서 반시계 방향으로 맞춘다.
 *
 * bezierCurveTo 6개가 만나는 이음매마다 접선을 맞춰 뒀지만(위 heartShape 참고),
 * 광택 클리어코트는 접선(1차)은 맞아도 곡률(2차)이 어긋나는 자리를 하이라이트
 * 꺾임으로 드러낸다. 라플라시안 완화를 살짝 얹어 그 잔여 이음매 자국까지 지운다.
 */
function heartOutline(count: number): THREE.Vector2[] {
  const pts = heartShape().getSpacedPoints(count);
  if (pts.length > 1 && pts[0]!.distanceTo(pts[pts.length - 1]!) < 1e-6) pts.pop();
  const smoothed = smoothClosedPolyline(pts, 5, 0.35);
  smoothed.reverse();
  return smoothed;
}

let heartGeo: THREE.BufferGeometry | null = null;

export function ballGeometry(): THREE.BufferGeometry {
  if (heartGeo) return heartGeo;

  const RING_SEGMENTS = 96; // 하트 둘레 분할
  const POLE_SEGMENTS = 40; // 앞 극 ↔ 뒤 극 분할
  const DEPTH_RADIUS = 1.1; // 적도 하트 반지름(~1~1.3)과 비슷하게 둬야 풍선처럼 둥글다
  const VISUAL_SCALE = 1; // 콜라이더 반지름과 정확히 일치 — 이보다 크면 옆 구슬끼리 안으로 파고든다
  const NOTCH_FADE_POWER = 1.6; // 클수록 적도 부근에서 더 오래 하트 윤곽을 유지하다 늦게 둥글어진다

  const outline = heartOutline(RING_SEGMENTS);
  const M = outline.length;
  // 노치·끝점의 굴곡을 거의 지운 버전 — 극 쪽 고리와 섞을 "둥근" 목표 윤곽
  const roundOutline = smoothClosedPolyline(outline, 60, 0.5);

  const grid: number[][] = [];
  const positions: number[] = [];
  for (let iy = 0; iy <= POLE_SEGMENTS; iy++) {
    const theta = (iy / POLE_SEGMENTS) * Math.PI; // 0(앞 극) → π(뒤 극)
    const rScale = Math.sin(theta);
    const z = DEPTH_RADIUS * Math.cos(theta);
    // 적도(rScale=1)에서 0, 극(rScale=0)에서 1 — 하트 윤곽에서 둥근 윤곽으로 섞는 비율
    const roundT = Math.pow(THREE.MathUtils.clamp(1 - rScale, 0, 1), NOTCH_FADE_POWER);
    const row: number[] = [];
    for (let ix = 0; ix < M; ix++) {
      const p = outline[ix]!;
      const rp = roundOutline[ix]!;
      const x = THREE.MathUtils.lerp(p.x, rp.x, roundT) * rScale;
      const y = THREE.MathUtils.lerp(p.y, rp.y, roundT) * rScale;
      positions.push(x, y, z);
      row.push(positions.length / 3 - 1);
    }
    grid.push(row);
  }

  // 극 고리는 전 정점이 같은 점으로 뭉쳐 있다 — 인접한 두 삼각형 중 하나가
  // 자동으로 면적 0이 되므로, SphereGeometry와 같은 방식으로 그쪽만 건너뛴다.
  const indices: number[] = [];
  for (let iy = 0; iy < POLE_SEGMENTS; iy++) {
    for (let ix = 0; ix < M; ix++) {
      const ix1 = (ix + 1) % M;
      const a = grid[iy]![ix1]!;
      const b = grid[iy]![ix]!;
      const c = grid[iy + 1]![ix]!;
      const d = grid[iy + 1]![ix1]!;
      if (iy !== 0) indices.push(a, b, d);
      if (iy !== POLE_SEGMENTS - 1) indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.center();

  geo.computeBoundingSphere();
  const r = geo.boundingSphere!.radius || 1;
  geo.scale(VISUAL_SCALE / r, VISUAL_SCALE / r, VISUAL_SCALE / r);

  geo.computeVertexNormals();

  heartGeo = geo;
  return geo;
}

/* ---------------- 텍스처 ---------------- */

const texCache = new Map<string, THREE.Texture>();

/**
 * 벽 텍스처 — 프로스티드 아크릴 패널.
 *
 * 레퍼런스 확대 관찰(reports/refwall/w12.jpg)에서 확인한 것:
 * 벽면 자체에는 노이즈도 무늬도 없다. 대신 세 가지가 재질을 만든다.
 *  1) 넓은 세로 그라데이션 — 위가 진하고 아래로 갈수록 옅다. 명도 폭이 크다.
 *  2) 패널 이음선 — 아크릴 시트가 맞닿는 세로선. 대비는 매우 낮다.
 *  3) 시트 가장자리 하이라이트 — 아크릴 단면이 빛을 물어 좌우 끝에 밝은 세로 띠가 생긴다.
 *
 * 이전 버전은 벽을 거의 흰색(#fdf2f5~#fae2e9, 명도 폭 5%)으로 칠해 종이처럼 보였다.
 * 레퍼런스의 벽은 중간톤이라 구슬이 화면에서 가장 밝은 물체가 된다 — 그 대비가 핵심이다.
 */
export interface WallHotspot {
  /** 텍스처 좌표 0~1. u는 좌→우, v는 **위→아래** */
  u: number;
  v: number;
  /** 텍스처 폭 대비 반경 */
  radius: number;
  /** 0~1. 중심에 흰빛을 얼마나 얹을지 */
  strength: number;
}

export function wallTexture(
  top: string,
  bottom: string,
  vignette: number,
  hotspot: WallHotspot | null = null,
): THREE.Texture {
  const key = `wall:${top}:${bottom}:${vignette.toFixed(2)}:${
    hotspot ? `${hotspot.u},${hotspot.v},${hotspot.radius},${hotspot.strength}` : 'flat'
  }`;
  const hit = texCache.get(key);
  if (hit) return hit;

  const W = 512;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  // 3스톱 — 상단이 가장 진하고 중단에서 한 번 밝아진 뒤 하단은 다시 살짝 내려앉는다
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(0.62, bottom);
  g.addColorStop(1, mixHex(bottom, top, 0.22));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 패널 이음선 — 폭의 일정 비율에 놓아 벽 크기가 달라도 같은 자리에 온다
  ctx.save();
  for (const fx of [0.5]) {
    const x = W * fx;
    const seam = ctx.createLinearGradient(x - 5, 0, x + 5, 0);
    seam.addColorStop(0, 'rgba(255,255,255,0)');
    seam.addColorStop(0.45, 'rgba(255,255,255,0.30)');
    seam.addColorStop(0.55, 'rgba(198,140,163,0.22)');
    seam.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = seam;
    ctx.fillRect(x - 5, 0, 10, H);
  }
  ctx.restore();

  // 시트 단면 하이라이트 — 텍스처 좌우 끝. 벽마다 자기 모서리에 정확히 걸린다
  for (const side of [0, 1]) {
    const x0 = side === 0 ? 0 : W;
    const dir = side === 0 ? 1 : -1;
    const edge = ctx.createLinearGradient(x0, 0, x0 + dir * W * 0.075, 0);
    edge.addColorStop(0, 'rgba(255,255,255,0.55)');
    edge.addColorStop(0.35, 'rgba(255,255,255,0.16)');
    edge.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = edge;
    ctx.fillRect(side === 0 ? 0 : W - W * 0.075, 0, W * 0.075, H);
  }

  /*
   * 조명 핫스팟.
   *
   * 레퍼런스 벽은 균일 발광이 아니라 **한쪽이 밝은 방향성**을 갖는다(실측: 명암 대비 1.53~1.75배,
   * 좌우 비대칭 −8.0%p). 우리 벽은 대비 1.30배에 비대칭 0.3%p로 완전히 평평했고,
   * 그래서 "박스가 납작하다"는 인상이 남았다.
   *
   * 실제 조명을 쓰지 않고 텍스처에 굽는 이유: 벽은 발광이 색을 주도하므로
   * 광원을 추가해도 벽면에는 거의 반영되지 않는다. 캐비닛은 정적이라 구워도 손해가 없다.
   * (구슬에 걸리는 방향성은 별도로 LIGHTING.keyIntensity가 담당한다.)
   */
  if (hotspot && hotspot.strength > 0) {
    const cx = W * hotspot.u;
    const cy = H * hotspot.v;
    const r = W * hotspot.radius;
    const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g2.addColorStop(0, `rgba(255,255,255,${hotspot.strength})`);
    g2.addColorStop(0.55, `rgba(255,255,255,${hotspot.strength * 0.42})`);
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
  }

  // 코너 비네트 — 회색을 얹으면 핑크 마감이 탁해지므로 같은 계열의 진한 핑크를 쓴다
  if (vignette > 0) {
    const edge = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.18, W / 2, H / 2, H * 0.72);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, `rgba(196,132,156,${vignette})`);
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

/**
 * 벽 러프니스 맵.
 *
 * 아크릴이 매끈해 보이는 이유는 반사가 선명해서가 아니라 **반사의 선명도가 자리마다 다르기** 때문이다.
 * 러프니스를 상수로 두면 베이크된 환경이 벽 전체에 똑같이 비쳐 비닐처럼 보인다.
 * 저주파 얼룩으로 변화를 주면 같은 반사가 어떤 곳은 또렷하고 어떤 곳은 번져 프로스티드로 읽힌다.
 *
 * 흑=매끈(반사 또렷) · 백=거침(반사 번짐).
 */
export function wallRoughnessTexture(base: number, variation: number): THREE.Texture {
  const key = `wallRough:${base.toFixed(2)}:${variation.toFixed(2)}`;
  const hit = texCache.get(key);
  if (hit) return hit;

  const W = 128;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `rgb(${Math.round(base * 255)},${Math.round(base * 255)},${Math.round(base * 255)})`;
  ctx.fillRect(0, 0, W, H);

  // 저주파 얼룩 — 결정적 배치. 랜덤이면 실행마다 벽이 달라져 A/B 비교가 무의미해진다
  const blobs = [
    [0.18, 0.12, 0.42], [0.72, 0.2, 0.5], [0.35, 0.48, 0.55],
    [0.85, 0.62, 0.38], [0.12, 0.75, 0.46], [0.58, 0.88, 0.5],
  ];
  for (const [fx, fy, fr] of blobs) {
    const g = ctx.createRadialGradient(fx! * W, fy! * H, 0, fx! * W, fy! * H, fr! * W);
    const v = Math.round(Math.min(1, base + variation) * 255);
    g.addColorStop(0, `rgba(${v},${v},${v},0.9)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace; // 러프니스는 선형 데이터다 — sRGB로 읽으면 값이 왜곡된다
  texCache.set(key, tex);
  return tex;
}

/**
 * 벽 노멀 맵 — 압출 아크릴의 세로결.
 *
 * 진폭이 커지면 벽이 골판지가 된다. 하이라이트가 딱 떨어지지 않고 살짝 흔들릴 정도면 충분하다.
 */
export function wallNormalTexture(strength: number): THREE.Texture {
  const key = `wallNormal:${strength.toFixed(2)}`;
  const hit = texCache.get(key);
  if (hit) return hit;

  const W = 256;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const d = img.data;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 주기가 다른 두 파를 겹쳐 반복 티가 나지 않게 한다
      const w = Math.sin((x / W) * Math.PI * 2 * 23) * 0.6 + Math.sin((x / W) * Math.PI * 2 * 7 + 1.7) * 0.4;
      const nx = w * strength;
      const i = (y * W + x) * 4;
      d[i] = Math.round((nx * 0.5 + 0.5) * 255); // x
      d[i + 1] = 128; // y — 세로결이므로 y 성분은 없다
      d[i + 2] = 255; // z
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  texCache.set(key, tex);
  return tex;
}

/** hex 두 색을 t 비율로 섞는다 */
function mixHex(a: string, b: string, t: number): string {
  const pa = new THREE.Color(a);
  const pb = new THREE.Color(b);
  return `#${pa.lerp(pb, t).getHexString()}`;
}

/** 접지 그림자용 방사형 알파 — 바닥에 얹는 부드러운 원형 그림자 */
export function contactShadowTexture(): THREE.Texture {
  const key = 'contactShadow';
  const hit = texCache.get(key);
  if (hit) return hit;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(90,45,65,0.85)');
  g.addColorStop(0.55, 'rgba(90,45,65,0.35)');
  g.addColorStop(1, 'rgba(90,45,65,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}
