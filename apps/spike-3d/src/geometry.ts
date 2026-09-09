/**
 * 구슬 지오메트리 · 텍스처.
 *
 * 레퍼런스 확대 관찰: 은색 구슬의 줄무늬는 텍스처가 아니라 실제로 골이 파인 지오메트리다
 * (능선이 개별적으로 빛을 받는다). 그래서 구체 정점을 방향에 따라 변위시켜 만든다.
 *   - ribbed : 세로 골 — 방위각 θ 기준 sin(nθ)
 *   - coiled : 가로 나사선 — 극각 φ 기준 sin(mφ)
 * 극 근처에서 골이 수렴해 지저분해지므로 sin(φ)로 진폭을 감쇠시킨다.
 */

import * as THREE from 'three';
import type { BallKind } from './config';

const geoCache = new Map<string, THREE.BufferGeometry>();

export function ballGeometry(kind: BallKind, ribCount: number, amplitude: number): THREE.BufferGeometry {
  const key = `${kind}:${ribCount}:${amplitude.toFixed(3)}`;
  const hit = geoCache.get(key);
  if (hit) return hit;

  const smooth = kind === 'smooth' || amplitude <= 0;
  const geo = new THREE.SphereGeometry(1, smooth ? 48 : 128, smooth ? 32 : 80);

  if (!smooth) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const len = v.length();
      const phi = Math.acos(THREE.MathUtils.clamp(v.y / len, -1, 1));
      // 극에서 0, 적도에서 1 — 골의 수렴으로 생기는 노이즈를 없앤다
      const taper = Math.sin(phi);
      let disp = 0;
      if (kind === 'ribbed') {
        const theta = Math.atan2(v.z, v.x);
        disp = Math.sin(theta * ribCount) * amplitude * taper;
      } else {
        disp = Math.sin(phi * ribCount) * amplitude * taper;
      }
      v.setLength(len + disp);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  geoCache.set(key, geo);
  return geo;
}

/* ---------------- 구슬 텍스처 ---------------- */

const texCache = new Map<string, THREE.Texture>();

/**
 * 로고가 있는 구슬의 텍스처.
 *
 * 주의: three의 `map`은 material.color에 곱해진다. 그래서 배경이 투명(RGB 0)이면
 * 구슬 전체가 검게 나온다. 로고를 얹으려면 배경을 구슬 색으로 채운 텍스처를 만들고
 * material.color는 흰색으로 두어야 한다.
 *
 * 실제 브랜드 에셋이 오면 이 함수를 텍스처 로드로 바꾸고 배경만 색으로 칠하면 된다.
 */
export function ballTexture(colorHex: string): THREE.Texture {
  const hit = texCache.get(colorHex);
  if (hit) return hit;

  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;

  // 배경 = 구슬 본색
  ctx.fillStyle = colorHex;
  ctx.fillRect(0, 0, w, h);

  const drawBadge = (cx: number, cy: number, scale: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    const bw = 150;
    const bh = 78;
    ctx.beginPath();
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 10);
    ctx.fill();
    ctx.fillStyle = '#c9203a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 32px "Segoe UI", sans-serif';
    ctx.fillText('AEPICK', 0, -12);
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillText('LUCKY', 0, 17);
    ctx.restore();
  };

  // 구체 UV에 감기므로 가로로 두 곳 — 어느 각도에서든 하나는 보인다
  drawBadge(w * 0.25, h * 0.46, 1);
  drawBadge(w * 0.75, h * 0.5, 0.85);

  /*
   * 초기 구현에는 v≈0.84에 텍스트 링을 그렸는데, 구체 UV에서 그 높이는 극 근처라
   * 문자가 압축되어 흰 고리 얼룩으로 보였다. 적도 부근에 얇게만 넣는다.
   */
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 22px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 6; i++) {
    ctx.fillText('AEPICK ✳ LUCKY DRAW', (w / 6) * i + w / 12, h * 0.66);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(colorHex, tex);
  return tex;
}

/** 벽 그라데이션 — 세로 방향 2색 보간 */
export function wallGradientTexture(top: string, bottom: string): THREE.Texture {
  const key = `wall:${top}:${bottom}`;
  const hit = texCache.get(key);
  if (hit) return hit;

  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}
