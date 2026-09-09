/**
 * 구슬 지오메트리 · 텍스처.
 *
 * 레퍼런스 확대 관찰: 은색 구슬의 줄무늬는 텍스처가 아니라 실제로 골이 파인 지오메트리다
 * (능선이 개별적으로 빛을 받는다). 그래서 구체 정점을 방향에 따라 변위시켜 만든다.
 * 극 근처에서 골이 수렴해 지저분해지므로 sin(φ)로 진폭을 감쇠시킨다.
 */

import * as THREE from 'three';
import type { BallKind } from './layout';

const geoCache = new Map<string, THREE.BufferGeometry>();

export function ballGeometry(kind: BallKind, ribCount: number, amplitude: number): THREE.BufferGeometry {
  const key = `${kind}:${ribCount}:${amplitude.toFixed(3)}`;
  const hit = geoCache.get(key);
  if (hit) return hit;

  const smooth = kind === 'smooth' || amplitude <= 0;
  const geo = new THREE.SphereGeometry(1, smooth ? 40 : 96, smooth ? 28 : 64);

  if (!smooth) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const len = v.length();
      const phi = Math.acos(THREE.MathUtils.clamp(v.y / len, -1, 1));
      const taper = Math.sin(phi); // 극에서 0, 적도에서 1
      const disp =
        kind === 'ribbed'
          ? Math.sin(Math.atan2(v.z, v.x) * ribCount) * amplitude * taper
          : Math.sin(phi * ribCount) * amplitude * taper;
      v.setLength(len + disp);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  geoCache.set(key, geo);
  return geo;
}

/* ---------------- 텍스처 ---------------- */

const texCache = new Map<string, THREE.Texture>();

/**
 * 로고가 있는 구슬의 텍스처.
 *
 * 주의: three의 `map`은 material.color에 곱해진다. 배경이 투명(RGB 0)이면 구슬이 검게 나온다.
 * 그래서 배경을 구슬 색으로 채운 텍스처를 만들고 material.color는 흰색으로 둔다.
 * 실제 브랜드 에셋이 오면 이 함수를 텍스처 로드로 바꾸고 배경만 색으로 칠하면 된다.
 */
/**
 * 캡슐 데칼.
 *
 * 텍스처 1024×512가 구체에 감기므로 적도 둘레 = 1024px, 즉 **화면상 구슬 지름은 1024/π ≈ 326px**에
 * 해당한다. 레퍼런스(reports/ball-ref.jpg)에서 글자 높이는 구슬 지름의 약 13%였다 → 약 42px.
 * 이전 값은 22px 폰트(대문자 높이 16px ≈ 5%)여서 화면에서는 글자가 아니라 얼룩으로 보였고,
 * 둘레에 6번 반복해 감아 흰 띠처럼 번졌다.
 *
 * 레퍼런스의 절제도 함께 가져온다: 요소는 **감긴 워드마크 1개 + 스티커 라벨 1개**뿐이다.
 * 어느 각도에서 봐도 한 번에 하나만 읽힌다.
 */
const DECAL_VARIANTS = 4;

/**
 * 실제 캔버스 크기. 배치 좌표는 아래 DESIGN_W/H 기준으로 적고 그릴 때 축소한다 —
 * 치수를 다시 튜닝하지 않고 해상도만 바꿀 수 있다.
 *
 * 색상 8종 × 변형 4종이므로 최대 32장이 만들어진다. 1024×512면 밉맵 포함 약 89MB로
 * 과하다. 화면에서 구슬은 150px 안팎이고 이 텍스처의 적도 둘레가 지름 512/π≈163px에
 * 해당하므로 512×256으로 충분하다(약 22MB).
 */
const TEX_W = 512;
const TEX_H = 256;
const DESIGN_W = 1024;
const DESIGN_H = 512;

/** 변형별 배치 — 구슬마다 데칼 위치가 같으면 더미에서 반복이 눈에 띈다 */
const DECAL_LAYOUT = [
  { bandV: 0.5, bandTilt: 0.05, badgeU: 0.62, badgeV: 0.3 },
  { bandV: 0.4, bandTilt: -0.07, badgeU: 0.15, badgeV: 0.68 },
  { bandV: 0.6, bandTilt: 0.09, badgeU: 0.84, badgeV: 0.36 },
  { bandV: 0.46, bandTilt: -0.04, badgeU: 0.38, badgeV: 0.74 },
] as const;

/** 워드마크 띠와 스티커를 그린다. 컬러맵과 러프니스맵이 같은 배치를 공유해야 한다. */
function drawDecal(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  variant: number,
  ink: string,
  badgeFill: string,
  badgeInk: string,
) {
  const L = DECAL_LAYOUT[variant % DECAL_VARIANTS]!;

  // 감긴 워드마크 — 둘레에 2회. 레퍼런스도 2~3회이고 그 이상이면 띠로 뭉갠다.
  ctx.save();
  ctx.translate(w / 2, h * L.bandV);
  ctx.rotate(L.bandTilt);
  ctx.fillStyle = ink;
  ctx.font = 'bold 48px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 2; i++) {
    ctx.fillText('aépick ✳ LUCKY DRAW', -w / 4 + (w / 2) * i, 0);
  }
  ctx.restore();

  // 스티커 라벨 — 레퍼런스의 사각 라벨에 대응
  ctx.save();
  ctx.translate(w * L.badgeU, h * L.badgeV);
  ctx.fillStyle = badgeFill;
  ctx.beginPath();
  ctx.roundRect(-84, -50, 168, 100, 12);
  ctx.fill();
  ctx.fillStyle = badgeInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 52px "Segoe UI", sans-serif';
  ctx.fillText('aépick', 0, -13);
  ctx.font = 'bold 26px "Segoe UI", sans-serif';
  ctx.fillText('LUCKY DRAW', 0, 25);
  ctx.restore();
}

export function ballTexture(colorHex: string, variant = 0): THREE.Texture {
  const key = `ball:${colorHex}:${variant}`;
  const hit = texCache.get(key);
  if (hit) return hit;

  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  const ctx = c.getContext('2d')!;

  // map은 material.color에 곱해지므로 배경을 구슬 색으로 채운다 (비우면 검게 죽는다)
  ctx.fillStyle = colorHex;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  ctx.scale(TEX_W / DESIGN_W, TEX_H / DESIGN_H);
  drawDecal(ctx, DESIGN_W, DESIGN_H, variant, 'rgba(255,255,255,0.92)', 'rgba(255,255,255,0.97)', '#e8446b');

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

/**
 * 데칼 러프니스 맵.
 *
 * 인쇄된 잉크는 캡슐 표면보다 광택이 낮다. 이 차이가 없으면 글자가 "표면에 인쇄된 것"이 아니라
 * "표면에 투영된 그림"으로 보인다 — 구슬 러프니스가 0.07로 매우 낮아 특히 티가 난다.
 *
 * three.js는 material.roughness에 이 맵을 **곱한다.** 그래서 재질 러프니스를 잉크 값으로 올리고
 * 맵에서 구슬 부분을 낮춰 되돌린다. 색과 무관하므로 변형당 한 장이면 전 색상이 공유한다.
 */
export function ballRoughnessTexture(variant: number, ballRough: number, inkRough: number): THREE.Texture {
  const key = `ballRough:${variant}:${ballRough.toFixed(3)}:${inkRough.toFixed(3)}`;
  const hit = texCache.get(key);
  if (hit) return hit;

  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  const ctx = c.getContext('2d')!;

  const g = Math.round(255 * (ballRough / inkRough));
  ctx.fillStyle = `rgb(${g},${g},${g})`;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  // 잉크·라벨 자리는 흰색(=1.0) → material.roughness가 그대로 적용된다
  ctx.scale(TEX_W / DESIGN_W, TEX_H / DESIGN_H);
  drawDecal(ctx, DESIGN_W, DESIGN_H, variant, '#ffffff', '#ffffff', '#ffffff');

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace; // 러프니스는 선형 데이터다
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

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
