/**
 * 대기 영상의 캐비닛 흔들림.
 *
 * 레퍼런스(AQOkIKQO….mp4) 실측으로 확정한 형태다.
 *
 *  - 정지 구간에서는 박스 엣지가 **픽셀 단위로 고정**된다(x=36, y=46 불변).
 *    구슬도 사실상 움직이지 않는다. 즉 "항상 조금씩 떨리는" 그림이 아니다.
 *  - 대신 **약 3초마다 흔들림 버스트**가 오고 1.3초쯤에 걸쳐 잦아든다.
 *    프레임 전체 변화량이 0.15 → 12.75 → 0.15로 오르내린다.
 *  - 버스트 중 박스는 **약 1.9Hz**로 화면폭의 **±4.8%** 만큼 이동한다.
 *
 * 그래서 흔들림은 "감쇠하는 정현파 버스트"로 모델링한다.
 * x와 y의 주파수를 살짝 다르게 두어 직선 왕복으로 보이지 않게 한다.
 */

export const SHAKE = {
  /** 버스트 간격(초) — 레퍼런스에서 3.8s·6.8s에 발생 */
  periodSec: 3.0,
  /** 감쇠 시상수(초). 버스트가 잦아드는 속도 */
  decaySec: 0.42,
  /** 기본 진동수(Hz) */
  freqHz: 1.9,
  /** 월드 단위 진폭. 화면폭 11.06유닛의 4.8% ≈ 0.53 */
  amplitude: ((globalThis as Record<string, unknown>).__SHAKE_AMP__ as number) ?? 0.53,
  /** 카메라 흔들림만 끄고 구슬 반응만 보고 싶을 때(진단용) */
  cameraShake: ((globalThis as Record<string, unknown>).__SHAKE_CAM__ as boolean) ?? true,
  /**
   * 구슬에 실리는 관성력 배율.
   *
   * 한 번 0으로 껐다가 되돌렸다. 끌 때 근거로 쓴 지표가 **전체 프레임 변화량**이었는데,
   * 그 값은 카메라 흔들림이 압도해 **구슬 움직임을 볼 수 없는 지표**였다.
   * 카메라 흔들림을 끄고 다시 재니 구슬은 분명히 반응하고 있었다.
   *
   * 레퍼런스와 같은 방법으로 비교했다 — 더미 영역을 잘라 **박스 이동을 픽셀 정렬로 보정**한 뒤
   * 프레임 차를 낸다(그래야 박스가 움직인 몫이 빠지고 구슬만 남는다).
   *
   *   레퍼런스   버스트 중앙 8.43 · 정지 0.021
   *   배율 0.35  버스트 중앙 4.98 · 정지 0.047
   *   배율 0.70  버스트 중앙 7.42 · 정지 0.155   ← 채택
   *   배율 1.20  버스트 중앙 11.01 · 정지 0.804
   */
  accelScale: ((globalThis as Record<string, unknown>).__SHAKE_ACCEL__ as number) ?? 0.7,
  /**
   * 집게 진자에 실을 비율.
   *
   * 구슬과 같은 값(0.7)을 그대로 주면 진자가 `SWAY_MAX_OFFSET`(0.5)에 붙어
   * 위아래가 잘린 움직임이 된다. 실측 clawX 최대치:
   *   0.70 → 0.500 (상한에 붙음)
   *   0.35 → 0.500 (여전히 붙음)
   *   0.22 → 0.332 (여유)  ← 채택
   */
  clawScale: ((globalThis as Record<string, unknown>).__SHAKE_CLAW__ as number) ?? 0.22,
} as const;

export interface ShakeState {
  /** 카메라(=박스)를 옮길 오프셋 */
  x: number;
  y: number;
  /** 구슬에 실을 관성 가속도 */
  ax: number;
  ay: number;
  /** 집게 진자에 실을 가속도 */
  clawAx: number;
}

/**
 * 시각 t(초)에서의 흔들림.
 *
 * 버스트 위상은 `t % periodSec`이며, 감쇠가 충분히 진행된 뒤에는 값이 0에 수렴해
 * 레퍼런스처럼 완전히 멎은 구간이 생긴다.
 */
export function shakeAt(t: number): ShakeState {
  const u = t % SHAKE.periodSec; // 버스트 시작부터의 경과
  const env = Math.exp(-u / SHAKE.decaySec);
  // 진폭이 1% 아래로 떨어지면 완전히 멈춘 것으로 본다 — 미세한 잔떨림이 남으면 정지 구간이 흐려진다
  if (env < 0.01) return { x: 0, y: 0, ax: 0, ay: 0, clawAx: 0 };

  const wx = 2 * Math.PI * SHAKE.freqHz;
  const wy = 2 * Math.PI * SHAKE.freqHz * 1.37; // 세로는 조금 빠르게 — 직선 왕복 방지
  const x = SHAKE.amplitude * env * Math.sin(wx * u);
  const y = SHAKE.amplitude * 0.45 * env * Math.sin(wy * u + 1.1);
  const cam = SHAKE.cameraShake ? 1 : 0;

  /*
   * 관성력은 박스 가속도의 반대 방향이다.
   * 감쇠 정현파의 2차 미분은 근사적으로 −ω²·(변위)이므로 부호를 뒤집어 그대로 쓴다.
   */
  return {
    x: x * cam,
    y: y * cam,
    ax: x * wx * wx * SHAKE.accelScale,
    ay: y * wy * wy * SHAKE.accelScale,
    clawAx: x * wx * wx * SHAKE.clawScale,
  };
}
