/**
 * Cloudflare 터널로 키오스크를 외부에 공개한다 (출장/원격 공유용).
 *
 * ⚠ 이 스크립트는 **로컬 서버를 인터넷에 노출한다.** 그래서 자격증명 강화를 강제한다.
 *
 * 왜 강제인가:
 *   기본값은 운영자 PIN `1234`, 어드민 키 `aepick-admin`이고 둘 다 README에 적혀 있다.
 *   그대로 공개하면 URL을 아는 사람이 세션을 만들어 **경품 재고를 소진**시키거나,
 *   어드민 키를 추측해 **확률·재고를 바꿀 수** 있다. 감사 로그도 남의 행동으로 채워진다.
 *   (`/api/*`는 401로 막혀 있지만 막는 값이 공개된 기본값이면 의미가 없다.)
 *
 *   그래서 실행할 때마다 무작위 자격증명을 만들어 서버에 주입한다.
 *   PIN은 키패드가 4자리 고정이라 4자리이지만, 최소한 공개된 값은 아니게 된다.
 *
 * 터널 종류:
 *   Cloudflare 계정 없이 쓰는 **퀵 터널**이다. 주소는 실행할 때마다 바뀌는
 *   무작위 `*.trycloudflare.com`이고, 끄면 사라진다. 상설 운영용이 아니다.
 *
 * 사용:
 *   node tools/tunnel.mjs              # 서버 + 터널 함께 실행
 *   node tools/tunnel.mjs --port 8788
 *   node tools/tunnel.mjs --pin 4821 --admin-key mykey   # 값을 직접 지정
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomInt, randomBytes } from 'node:crypto';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const PORT = Number(arg('port', '8788'));

/* winget으로 설치하면 PATH에 바로 잡히지 않는 경우가 있어 실제 경로를 함께 찾는다 */
const CF =
  [
    'C:/Program Files (x86)/cloudflared/cloudflared.exe',
    'C:/Program Files/cloudflared/cloudflared.exe',
    `${process.env.LOCALAPPDATA}/Microsoft/WinGet/Links/cloudflared.exe`,
  ].find((p) => p && existsSync(p)) ?? 'cloudflared';

if (CF === 'cloudflared') {
  console.log('cloudflared 실행 파일을 찾지 못했습니다. PATH에 있길 기대하고 진행합니다.');
  console.log('없다면:  winget install Cloudflare.cloudflared\n');
}

/* 공개되는 순간 기본값은 쓰면 안 된다 */
const PIN = arg('pin', String(randomInt(1000, 10000)));
const ADMIN_KEY = arg('admin-key', randomBytes(12).toString('base64url'));

const children = [];
const stopAll = () => {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* 이미 종료됨 */
    }
  }
};
process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});
process.on('exit', stopAll);

/* ---------- 1) 서버 ---------- */

/*
 * 포트가 이미 쓰이고 있으면 멈춘다.
 * 그냥 진행하면 **이미 떠 있던 서버**(기본 PIN을 쓰는)가 응답해 준비 완료로 판정되고,
 * 화면에는 새로 만든 자격증명이 찍힌다 — 안 되는 값을 알려주면서 공개까지 되는 최악의 조합이다.
 */
try {
  const r = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(2500) });
  if (r.ok) {
    console.error(
      [
        '',
        `포트 ${PORT}에 이미 서버가 떠 있습니다.`,
        '그 서버는 이 스크립트가 만든 PIN/어드민 키를 모릅니다.',
        '기존 서버를 끄고 다시 실행하거나, --port 로 다른 포트를 지정하세요.',
      ].join('\n'),
    );
    process.exit(1);
  }
} catch {
  /* 응답 없음 = 비어 있음. 정상 경로다 */
}

console.log(`서버 기동 중 (포트 ${PORT})…`);
/* shell:true에 인자 배열을 함께 넘기면 Node가 DEP0190을 낸다 — 명령을 한 문자열로 넘긴다 */
const server = spawn('npm start', {
  env: { ...process.env, PORT: String(PORT), OPERATOR_PIN: PIN, ADMIN_KEY },
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(server);
server.stderr.on('data', (d) => {
  const s = String(d);
  if (/error|EADDRINUSE/i.test(s)) process.stderr.write(s);
});

/** 서버가 실제로 응답할 때까지 기다린다 — 터널이 먼저 뜨면 502가 나간다 */
async function waitForServer(timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`);
      if (r.ok) return true;
    } catch {
      /* 아직 안 떴다 */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

if (!(await waitForServer())) {
  console.error('\n서버가 뜨지 않았습니다. `npm run build`를 먼저 실행했는지 확인하세요.');
  stopAll();
  process.exit(1);
}
console.log('서버 준비됨.\n터널 여는 중…');

/* ---------- 2) 터널 ---------- */

const tunnel = spawn(CF, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(tunnel);

let printed = false;
const onLine = (line) => {
  // cloudflared는 주소를 stderr로 낸다
  const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !printed) {
    printed = true;
    const url = m[0];
    console.log(`
============================================================
  공개 주소 (이 창을 닫으면 사라집니다)

    키오스크   ${url}/kiosk/
    어드민     ${url}/admin

  운영자 PIN   ${PIN}
  어드민 키    ${ADMIN_KEY}

  ⚠ 이 주소를 아는 사람은 누구나 접속할 수 있습니다.
    - 실제 플레이는 경품 재고를 차감합니다.
      재고를 지키려면 운영자 패널에서 [테스트 세션]만 쓰세요.
    - 어드민 키는 확률·재고를 바꿀 수 있습니다. 공유에 주의하세요.
    - 위 값은 실행할 때마다 새로 생성됩니다.

  Ctrl+C 로 서버와 터널을 함께 종료합니다.
============================================================
`);
  }
};
for (const s of [tunnel.stdout, tunnel.stderr]) {
  s.on('data', (d) => String(d).split('\n').forEach(onLine));
}

tunnel.on('exit', (code) => {
  console.log(`\n터널이 종료되었습니다 (code ${code}).`);
  stopAll();
  process.exit(code ?? 0);
});
