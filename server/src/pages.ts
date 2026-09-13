/**
 * 어드민 웹 (§9.2) — 서버 렌더 셸 + fetch 기반 SPA
 * 태블릿에서 현장 운영자가 직접 쓰는 "지급 큐"(§6.4)를 첫 탭으로 둔다.
 */

import type { FastifyInstance } from 'fastify';

const HTML = String.raw;

const PAGE = HTML`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AEPICK Lucky Draw · 어드민</title>
<style>
  :root{
    --bg:#0f1420; --panel:#171e2d; --panel2:#1e2739;
    --line:#2b3549; --text:#e8edf6; --dim:#8fa0bd; --accent:#5b8cff;
    --ok:#3fbf7f; --warn:#e8a53d; --bad:#e8564f; --gold:#e9c46a;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
       font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","맑은 고딕",sans-serif}
  header{display:flex;align-items:center;gap:16px;padding:14px 20px;
         background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:10;flex-wrap:wrap}
  h1{font-size:16px;margin:0;letter-spacing:.5px}
  .badge{font-size:11px;padding:3px 8px;border-radius:99px;background:var(--panel2);color:var(--dim)}
  .badge.on{background:rgba(63,191,127,.15);color:var(--ok)}
  .badge.off{background:rgba(232,86,79,.15);color:var(--bad)}
  nav{display:flex;gap:4px;padding:0 20px;background:var(--panel);border-bottom:1px solid var(--line);
      overflow-x:auto;position:sticky;top:53px;z-index:9}
  nav button{background:none;border:0;color:var(--dim);padding:11px 14px;cursor:pointer;
             font-size:13px;border-bottom:2px solid transparent;white-space:nowrap}
  nav button.active{color:var(--text);border-bottom-color:var(--accent)}
  main{padding:20px;max-width:1280px}
  section{display:none} section.active{display:block}
  .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:20px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
  .card .k{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.6px}
  .card .v{font-size:26px;font-weight:600;margin-top:4px}
  .card .s{font-size:11px;color:var(--dim);margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:middle}
  th{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;font-weight:600}
  tbody tr:hover{background:var(--panel2)}
  .wrap{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;overflow-x:auto;margin-bottom:20px}
  .wrap h2{font-size:13px;margin:0;padding:12px 14px;border-bottom:1px solid var(--line);color:var(--dim)}
  button.act{background:var(--accent);color:#fff;border:0;border-radius:7px;padding:7px 13px;cursor:pointer;font-size:13px}
  button.act:hover{filter:brightness(1.12)}
  button.act.ghost{background:var(--panel2);color:var(--text);border:1px solid var(--line)}
  button.act.danger{background:var(--bad)}
  button.act:disabled{opacity:.45;cursor:default}
  input,select{background:var(--panel2);border:1px solid var(--line);color:var(--text);
               border-radius:7px;padding:7px 9px;font:inherit;width:100%}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
  .row>*{flex:0 0 auto}
  .code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:17px;letter-spacing:2px;font-weight:600}
  .tier{font-weight:600}
  .t1{color:var(--gold)} .t2{color:#f2a6c0} .t3{color:#8fd3f4} .t4{color:#a9e5c0} .t5{color:#c9d5e8}
  .miss{color:var(--dim)}
  .age-warn{color:var(--warn)} .age-bad{color:var(--bad);font-weight:600}
  .msg{padding:10px 12px;border-radius:8px;margin-bottom:12px;font-size:13px;display:none}
  .msg.ok{display:block;background:rgba(63,191,127,.13);color:var(--ok)}
  .msg.err{display:block;background:rgba(232,86,79,.13);color:var(--bad)}
  .pin{display:flex;gap:8px;align-items:center}
  .pin input{width:160px}
  .empty{padding:26px;text-align:center;color:var(--dim);font-size:13px}
  .bar{height:6px;border-radius:99px;background:var(--panel2);overflow:hidden;margin-top:6px}
  .bar i{display:block;height:100%;background:var(--accent)}
  .dev{font-size:11px;color:var(--dim)}
  .blocked{font-size:11px;color:var(--warn)}
  label.lbl{font-size:11px;color:var(--dim);display:block;margin-bottom:3px}
  .fields{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));padding:14px}
</style>
</head>
<body>
<header>
  <h1>AEPICK LUCKY DRAW</h1>
  <span id="evBadge" class="badge">…</span>
  <span id="ruleBadge" class="badge">…</span>
  <div style="flex:1"></div>
  <div class="pin">
    <input id="key" type="password" placeholder="관리자 키 / 운영자 PIN">
    <button class="act ghost" onclick="saveKey()">저장</button>
  </div>
</header>

<nav>
  <button class="active" data-tab="queue">지급 큐</button>
  <button data-tab="dash">운영 대시보드</button>
  <button data-tab="prizes">경품 · 재고</button>
  <button data-tab="rules">확률 설정</button>
  <button data-tab="sessions">세션 로그</button>
  <button data-tab="audit">감사 로그</button>
</nav>

<main>
  <div id="msg" class="msg"></div>

  <!-- 지급 큐 -->
  <section id="queue" class="active">
    <div class="row">
      <input id="codeInput" placeholder="코드 6자리" style="width:190px" class="code">
      <button class="act" onclick="claimByCode()">코드로 지급 완료</button>
      <button class="act ghost" onclick="load()">새로고침</button>
      <span class="dev">경과 10분 초과 주황 · 30분 초과 적색</span>
    </div>
    <div class="wrap">
      <h2>지급 대기 (PENDING_CLAIM · EXPIRED)</h2>
      <table><thead><tr>
        <th>코드</th><th>등급</th><th>경품</th><th>경과</th><th>기기</th><th>만료</th><th style="width:200px">처리</th>
      </tr></thead><tbody id="queueBody"></tbody></table>
      <div id="queueEmpty" class="empty">지급 대기 세션이 없습니다.</div>
    </div>
  </section>

  <!-- 대시보드 -->
  <section id="dash">
    <div class="grid" id="kpis"></div>
    <div class="wrap">
      <h2>등급별 분포 — 설정 확률 대비 실제</h2>
      <table><thead><tr>
        <th>등급</th><th>당첨 수</th><th>실제 %</th><th>설정 %</th><th>편차</th><th>가용성</th>
      </tr></thead><tbody id="drawBody"></tbody></table>
    </div>
    <div class="wrap">
      <h2>세션 상태</h2>
      <table><thead><tr><th>상태</th><th>건수</th></tr></thead><tbody id="statusBody"></tbody></table>
    </div>
  </section>

  <!-- 경품 -->
  <section id="prizes">
    <div class="row">
      <button class="act ghost" onclick="dayStart()">일일 오픈 — 기준 재고 리셋</button>
      <span class="dev">고정 쿼터 페이싱의 기준값(day_start_qty)을 현재 잔여로 맞춥니다.</span>
    </div>
    <div class="wrap">
      <h2>경품 · 재고</h2>
      <table><thead><tr>
        <th>등급</th><th>경품명(ko)</th><th>총</th><th>available</th><th>reserved</th><th>claimed</th>
        <th>일일상한</th><th>행사상한</th><th>활성</th><th style="width:230px">재고 조정</th>
      </tr></thead><tbody id="prizeBody"></tbody></table>
    </div>
  </section>

  <!-- 확률 -->
  <section id="rules">
    <div class="wrap">
      <h2>확률 설정 — 합계 100.000%가 아니면 게시할 수 없습니다</h2>
      <div class="fields" id="probFields"></div>
      <div style="padding:0 14px 14px">
        <div class="row">
          <div style="width:180px"><label class="lbl">합계</label><div id="sum" class="code">—</div></div>
          <div style="width:200px"><label class="lbl">소진 정책</label>
            <select id="policy">
              <option value="toMiss">꽝 귀속 (권고)</option>
              <option value="renormalize">비례 재정규화</option>
            </select></div>
        </div>
        <div class="row">
          <div style="width:130px"><label class="lbl">페이싱</label>
            <select id="pacingOn"><option value="1">사용</option><option value="0">미사용</option></select></div>
          <div style="width:130px"><label class="lbl">버킷(분)</label><input id="bucket" type="number"></div>
          <div style="width:150px"><label class="lbl">쿼터 해제(분 전)</label><input id="release" type="number"></div>
          <div style="width:130px"><label class="lbl">이월</label>
            <select id="carry"><option value="1">이월</option><option value="0">고정</option></select></div>
          <div style="width:210px"><label class="lbl">페이싱 대상 등급</label><input id="ptiers" placeholder="t1,t2,t3"></div>
        </div>
        <div class="row">
          <div style="width:130px"><label class="lbl">조준(초)</label><input id="aim" type="number"></div>
          <div style="width:150px"><label class="lbl">당첨 노출(초)</label><input id="rw" type="number"></div>
          <div style="width:150px"><label class="lbl">꽝 노출(초)</label><input id="rm" type="number"></div>
          <div style="width:150px"><label class="lbl">구슬 수</label><input id="balls" type="number"></div>
          <div style="width:190px"><label class="lbl">결과 공개 연출 (§4.3)</label>
            <select id="reveal">
              <option value="capsuleOpen">B안 — 캡슐 개봉</option>
              <option value="grabMiss">A안 — 획득/미획득</option>
            </select></div>
        </div>
        <div class="row">
          <div style="flex:1;min-width:260px"><label class="lbl">변경 사유 (필수)</label><input id="reason"></div>
          <button class="act ghost" onclick="validateRules()">검증</button>
          <button class="act" id="pubBtn" onclick="publishRules()">게시</button>
        </div>
        <div id="preview" class="dev"></div>
      </div>
    </div>
    <div class="wrap">
      <h2>설정 버전 이력</h2>
      <table><thead><tr><th>버전</th><th>게시 시각</th><th>게시자</th><th>사유</th><th>확률</th><th></th></tr></thead>
      <tbody id="ruleBody"></tbody></table>
    </div>
  </section>

  <!-- 세션 로그 -->
  <section id="sessions">
    <div class="row">
      <select id="stFilter" style="width:180px">
        <option value="">전체 상태</option>
        <option>DRAWN</option><option>PLAYED</option><option>PENDING_CLAIM</option>
        <option>CLAIMED</option><option>VOIDED</option><option>EXPIRED</option><option>ABORTED</option>
      </select>
      <label class="dev"><input type="checkbox" id="incTest" style="width:auto"> 테스트 세션 포함</label>
      <button class="act ghost" onclick="loadSessions()">조회</button>
      <button class="act ghost" onclick="downloadCsv()">CSV 내보내기</button>
      <button class="act ghost" onclick="downloadXlsx()">Excel 내보내기</button>
    </div>
    <div class="wrap">
      <h2>세션 로그</h2>
      <table><thead><tr>
        <th>생성</th><th>상태</th><th>등급</th><th>코드</th><th>조준</th><th>자동</th><th>최소fps</th>
        <th>규칙</th><th>테스트</th><th>지급/사유</th>
      </tr></thead><tbody id="sessBody"></tbody></table>
    </div>
  </section>

  <!-- 감사 -->
  <section id="audit">
    <div class="wrap">
      <h2>감사 로그</h2>
      <table><thead><tr><th>시각</th><th>처리자</th><th>액션</th><th>대상</th><th>사유</th></tr></thead>
      <tbody id="auditBody"></tbody></table>
    </div>
  </section>
</main>

<script>
const TIERS = ['t1','t2','t3','t4','t5','miss'];
const TIER_KO = {t1:'1등',t2:'2등',t3:'3등',t4:'4등',t5:'5등',miss:'꽝'};
const REASON_KO = {inactive:'비활성',noStock:'재고 없음',dailyCap:'일일 상한',eventCap:'행사 상한',pacingQuota:'시간대 쿼터'};
let KEY = localStorage.getItem('ldKey') || '';
let CURRENT = null;

document.getElementById('key').value = KEY;
function saveKey(){ KEY = document.getElementById('key').value.trim(); localStorage.setItem('ldKey', KEY); load(); }

function headers(){ return { 'content-type':'application/json', 'x-admin-key': KEY, 'x-operator-pin': KEY }; }
function show(text, ok){ const m=document.getElementById('msg'); m.textContent=text; m.className='msg '+(ok?'ok':'err');
  clearTimeout(show._t); show._t=setTimeout(()=>{m.className='msg';},4500); }

async function api(path, opts){
  const r = await fetch(path, Object.assign({ headers: headers() }, opts||{}));
  const text = await r.text();
  let data; try{ data = text ? JSON.parse(text) : {}; }catch{ data = { message:text }; }
  if(!r.ok) throw new Error(data.message || data.error || ('HTTP '+r.status));
  return data;
}

document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('section').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  document.getElementById(b.dataset.tab).classList.add('active');
  if(b.dataset.tab==='sessions') loadSessions();
  if(b.dataset.tab==='audit') loadAudit();
  if(b.dataset.tab==='rules') loadRules();
});

function tierSpan(t){ return '<span class="tier '+t+'">'+(TIER_KO[t]||t)+'</span>'; }
function ageCls(m){ return m>=30?'age-bad':(m>=10?'age-warn':''); }
function fmt(iso){ return iso ? new Date(iso).toLocaleString('ko-KR',{hour12:false}) : '-'; }

/* ---------- 지급 큐 ---------- */
async function loadQueue(){
  const d = await api('/api/sessions/pending');
  const body = document.getElementById('queueBody');
  document.getElementById('queueEmpty').style.display = d.items.length ? 'none' : 'block';
  body.innerHTML = d.items.map(function(i){
    return '<tr>'
      + '<td class="code">'+i.claimCode+'</td>'
      + '<td>'+tierSpan(i.tier)+'</td>'
      + '<td>'+(i.prizeName.ko||i.prizeName.vi)+'</td>'
      + '<td class="'+ageCls(i.elapsedMinutes)+'">'+i.elapsedMinutes+'분</td>'
      + '<td class="dev">'+i.deviceId+'</td>'
      + '<td class="dev">'+fmt(i.expiresAt)+'</td>'
      + '<td>'
        + '<button class="act" onclick="claimId(\''+i.sessionId+'\')">지급 완료</button> '
        + '<button class="act danger" onclick="voidId(\''+i.sessionId+'\')">무효</button>'
      + '</td></tr>';
  }).join('');
}
async function claimId(id){
  if(!confirm('지급 완료로 처리합니다. 계속할까요?')) return;
  try{ const r = await api('/api/sessions/'+id+'/claim',{method:'POST',body:JSON.stringify({operatorId:'operator'})});
       show('지급 완료 — '+TIER_KO[r.tier], true); load(); }
  catch(e){ show(e.message, false); }
}
async function claimByCode(){
  const code = document.getElementById('codeInput').value.trim();
  if(!code) return;
  try{ const r = await api('/api/claims/by-code',{method:'POST',body:JSON.stringify({code, operatorId:'operator'})});
       show('지급 완료 — '+TIER_KO[r.tier], true);
       document.getElementById('codeInput').value=''; load(); }
  catch(e){ show(e.message, false); }
}
async function voidId(id){
  const reason = prompt('무효 사유를 입력하세요 (필수)');
  if(!reason) return;
  try{ await api('/api/sessions/'+id+'/void',{method:'POST',body:JSON.stringify({reason, actor:'manager'})});
       show('무효 처리 완료', true); load(); }
  catch(e){ show(e.message, false); }
}

/* ---------- 대시보드 ---------- */
async function loadDash(){
  const d = await api('/api/admin/dashboard');
  CURRENT = d;
  document.getElementById('evBadge').textContent = d.event.emergencyStop ? '긴급 중지'
    : (d.event.eventOn ? '운영 중' : '행사 OFF');
  document.getElementById('evBadge').className = 'badge ' + (d.event.eventOn && !d.event.emergencyStop ? 'on':'off');
  document.getElementById('ruleBadge').textContent = '규칙 v'+d.ruleVersion;

  const k = d.kpi;
  document.getElementById('kpis').innerHTML = [
    card('플레이', d.kpi.playCount, '완료 세션'),
    card('지급 대기', d.sessions.pending, 'PENDING_CLAIM'),
    card('지급 완료', d.sessions.claimed, 'CLAIMED'),
    card('평균 조준', k.avgAimMs!=null ? (k.avgAimMs/1000).toFixed(1)+'초' : '-', '§10.4'),
    card('결과→지급 격차', k.avgClaimGapMinutes!=null ? k.avgClaimGapMinutes+'분' : '-', '지급 큐 동선 지표'),
    card('평균 최소fps', k.avgMinFps ?? '-', k.lowFpsCount+'건 30fps 미만'),
    card('무효/만료', d.sessions.voided+' / '+d.sessions.expired, 'VOIDED / EXPIRED'),
    card('오류', k.errorCount, 'app_errors'),
  ].join('');

  document.getElementById('drawBody').innerHTML = d.draws.map(function(r){
    const av = r.tier==='miss' ? '<span class="dev">—</span>'
      : (d.availability[r.tier] && d.availability[r.tier].available
          ? '<span style="color:var(--ok)">가능</span>'
          : '<span class="blocked">차단 · '+(REASON_KO[(d.availability[r.tier]||{}).reason]||'-')+'</span>');
    const dev = r.deviation>0 ? '+'+r.deviation : r.deviation;
    return '<tr><td>'+tierSpan(r.tier)+'</td><td>'+r.count+'</td><td>'+r.actualPercent+'%</td>'
      + '<td class="dev">'+r.configuredPercent+'%</td><td class="dev">'+dev+'</td><td>'+av+'</td></tr>';
  }).join('');

  document.getElementById('statusBody').innerHTML = Object.entries(d.sessions.byStatus)
    .map(([s,c])=>'<tr><td>'+s+'</td><td>'+c+'</td></tr>').join('') || '<tr><td colspan=2 class="dev">없음</td></tr>';

  document.getElementById('prizeBody').innerHTML = d.prizes.map(function(p){
    const pct = p.totalQty ? Math.round(p.claimedQty/p.totalQty*100) : 0;
    return '<tr>'
      +'<td>'+tierSpan(p.tier)+'</td>'
      +'<td>'+(p.name.ko||'')+'<div class="bar"><i style="width:'+pct+'%"></i></div></td>'
      +'<td>'+p.totalQty+'</td><td><b>'+p.remainingQty+'</b></td><td>'+p.reservedQty+'</td><td>'+p.claimedQty+'</td>'
      +'<td class="dev">'+(p.dailyCap??'-')+'</td><td class="dev">'+(p.eventCap??'-')+'</td>'
      +'<td>'+(p.active?'<span style="color:var(--ok)">ON</span>':'<span style="color:var(--bad)">OFF</span>')+'</td>'
      +'<td><input id="adj-'+p.tier+'" type="number" placeholder="±수량" style="width:88px;display:inline-block">'
      +' <button class="act ghost" onclick="adjust(\''+p.tier+'\')">조정</button>'
      +' <button class="act ghost" onclick="toggle(\''+p.tier+'\','+(!p.active)+')">'+(p.active?'중지':'활성')+'</button></td>'
      +'</tr>';
  }).join('');
}
function card(k,v,s){ return '<div class="card"><div class="k">'+k+'</div><div class="v">'+v+'</div><div class="s">'+s+'</div></div>'; }

async function adjust(tier){
  const delta = Number(document.getElementById('adj-'+tier).value);
  if(!delta){ show('증감 수량을 입력하세요.', false); return; }
  const reason = prompt('재고 조정 사유 (필수)');
  if(!reason) return;
  try{ const r = await api('/api/admin/prizes/'+tier+'/adjust',{method:'POST',body:JSON.stringify({delta,reason,actor:'manager'})});
       show(tier+' 잔여 '+r.remainingQty+'개', true); load(); }
  catch(e){ show(e.message,false); }
}
async function toggle(tier, active){
  try{ await api('/api/admin/prizes/'+tier,{method:'POST',body:JSON.stringify({active, reason:'수동 토글', actor:'admin'})});
       show(tier+' '+(active?'활성':'중지'), true); load(); }
  catch(e){ show(e.message,false); }
}
async function dayStart(){
  if(!confirm('기준 재고를 현재 잔여 수량으로 리셋합니다.')) return;
  try{ await api('/api/admin/prizes/day-start',{method:'POST'}); show('기준 재고 리셋 완료', true); load(); }
  catch(e){ show(e.message,false); }
}

/* ---------- 확률 설정 ---------- */
function collectProbs(){
  return TIERS.map(t=>({tier:t, probability: Number(document.getElementById('p-'+t).value||0)}));
}
function collectPacing(){
  return {
    enabled: document.getElementById('pacingOn').value==='1',
    tiers: document.getElementById('ptiers').value.split(',').map(s=>s.trim()).filter(Boolean),
    bucketMinutes: Number(document.getElementById('bucket').value),
    carryOver: document.getElementById('carry').value==='1',
    finalReleaseMinutes: Number(document.getElementById('release').value),
  };
}
function collectGame(){
  const g = Object.assign({}, (CURRENT_RULE&&CURRENT_RULE.game)||{});
  g.aimSeconds = Number(document.getElementById('aim').value);
  g.resultSecondsWin = Number(document.getElementById('rw').value);
  g.resultSecondsMiss = Number(document.getElementById('rm').value);
  g.ballCount = Number(document.getElementById('balls').value);
  g.revealMode = document.getElementById('reveal').value;
  return g;
}
function updateSum(){
  const sum = collectProbs().reduce((a,p)=>a+p.probability,0);
  const el = document.getElementById('sum');
  el.textContent = sum.toFixed(3)+'%';
  const ok = Math.abs(sum-100) < 1e-9;
  el.style.color = ok ? 'var(--ok)' : 'var(--bad)';
  document.getElementById('pubBtn').disabled = !ok;
}
let CURRENT_RULE = null;
async function loadRules(){
  const cfg = await api('/api/config/active');
  const list = await api('/api/admin/rules');
  const active = list.items.find(r=>r.active) || list.items[0];
  CURRENT_RULE = { game: cfg.game };

  document.getElementById('probFields').innerHTML = TIERS.map(function(t){
    const p = active.probabilities.find(x=>x.tier===t);
    return '<div><label class="lbl">'+TIER_KO[t]+' %</label>'
      +'<input id="p-'+t+'" type="number" step="0.001" value="'+(p?p.probability:0)+'" oninput="updateSum()"></div>';
  }).join('');
  document.getElementById('policy').value = active.depletionPolicy;
  document.getElementById('pacingOn').value = active.pacing.enabled ? '1':'0';
  document.getElementById('bucket').value = active.pacing.bucketMinutes;
  document.getElementById('release').value = active.pacing.finalReleaseMinutes;
  document.getElementById('carry').value = active.pacing.carryOver ? '1':'0';
  document.getElementById('ptiers').value = active.pacing.tiers.join(',');
  document.getElementById('aim').value = cfg.game.aimSeconds;
  document.getElementById('rw').value = cfg.game.resultSecondsWin;
  document.getElementById('rm').value = cfg.game.resultSecondsMiss;
  document.getElementById('balls').value = cfg.game.ballCount;
  document.getElementById('reveal').value = cfg.game.revealMode;
  updateSum();

  document.getElementById('ruleBody').innerHTML = list.items.map(function(r){
    const probs = r.probabilities.map(p=>TIER_KO[p.tier]+' '+p.probability+'%').join(' · ');
    return '<tr><td>v'+r.versionId+'</td><td class="dev">'+fmt(r.publishedAt)+'</td><td class="dev">'+r.publishedBy+'</td>'
      +'<td class="dev">'+r.reason+'</td><td class="dev">'+probs+'</td>'
      +'<td>'+(r.active?'<span style="color:var(--ok)">활성</span>':'')+'</td></tr>';
  }).join('');
}
async function validateRules(){
  try{
    const r = await api('/api/admin/rules/validate',{method:'POST',
      body:JSON.stringify({probabilities:collectProbs(), pacing:collectPacing(), gameConfig:collectGame()})});
    document.getElementById('preview').textContent =
      '예상 1,000회: ' + r.preview.map(p=>TIER_KO[p.tier]+' '+p.per1000+'회').join(' · ');
    if(r.ok) show('검증 통과', true);
    else show(r.issues.map(i=>i.message).join(' / '), false);
  }catch(e){ show(e.message,false); }
}
async function publishRules(){
  const reason = document.getElementById('reason').value.trim();
  if(!reason){ show('변경 사유는 필수입니다.', false); return; }
  if(!confirm('새 설정 버전을 게시합니다. 진행 중 세션은 이전 규칙을 유지합니다.')) return;
  try{
    const r = await api('/api/admin/rules/publish',{method:'POST',body:JSON.stringify({
      probabilities:collectProbs(), depletionPolicy:document.getElementById('policy').value,
      pacing:collectPacing(), gameConfig:collectGame(), reason, publishedBy:'admin'})});
    show('v'+r.versionId+' 게시 완료 — 신규 세션부터 적용', true);
    document.getElementById('reason').value='';
    loadRules(); loadDash();
  }catch(e){ show(e.message,false); }
}

/* ---------- 세션 로그 ---------- */
async function loadSessions(){
  const st = document.getElementById('stFilter').value;
  const inc = document.getElementById('incTest').checked ? '1':'0';
  const d = await api('/api/admin/sessions?limit=200&includeTest='+inc+(st?'&status='+st:''));
  document.getElementById('sessBody').innerHTML = d.items.map(function(r){
    const blocked = r.blocked_tiers && r.blocked_tiers !== '{}' ? '<div class="blocked">차단 '+r.blocked_tiers+'</div>' : '';
    return '<tr>'
      +'<td class="dev">'+fmt(r.created_at)+'</td>'
      +'<td>'+r.status+blocked+'</td>'
      +'<td>'+(r.result_tier?tierSpan(r.result_tier):'-')+'</td>'
      +'<td class="dev">'+(r.claim_code||'-')+'</td>'
      +'<td class="dev">'+(r.aim_duration_ms!=null?(r.aim_duration_ms/1000).toFixed(1)+'s':'-')+'</td>'
      +'<td class="dev">'+(r.auto_catch?'Y':'')+'</td>'
      +'<td class="dev">'+(r.min_fps??'-')+'</td>'
      +'<td class="dev">v'+r.rule_version+'</td>'
      +'<td class="dev">'+(r.is_test?'TEST':'')+'</td>'
      +'<td class="dev">'+(r.claimed_at?fmt(r.claimed_at)+' / '+r.claimed_by : (r.void_reason||'-'))+'</td>'
      +'</tr>';
  }).join('') || '<tr><td colspan=10 class="dev">없음</td></tr>';
}
function downloadCsv(){
  fetch('/api/admin/report.csv',{headers:headers()}).then(r=>r.blob()).then(b=>{
    const a=document.createElement('a'); a.href=URL.createObjectURL(b);
    a.download='luckydraw-sessions.csv'; a.click();
  });
}
function downloadXlsx(){
  fetch('/api/admin/report.xlsx',{headers:headers()}).then(r=>r.blob()).then(b=>{
    const a=document.createElement('a'); a.href=URL.createObjectURL(b);
    a.download='luckydraw-report.xlsx'; a.click();
  });
}
async function loadAudit(){
  const d = await api('/api/admin/audit');
  document.getElementById('auditBody').innerHTML = d.items.map(r=>
    '<tr><td class="dev">'+fmt(r.at)+'</td><td>'+r.actor+'</td><td>'+r.action+'</td>'
    +'<td class="dev">'+(r.target||'-')+'</td><td class="dev">'+(r.reason||'-')+'</td></tr>').join('')
    || '<tr><td colspan=5 class="dev">없음</td></tr>';
}

async function load(){
  if(!KEY){ show('관리자 키 또는 운영자 PIN을 입력하세요.', false); return; }
  try{ await loadQueue(); await loadDash(); }
  catch(e){ show(e.message, false); }
}
load();
setInterval(()=>{ if(document.getElementById('queue').classList.contains('active')) loadQueue().catch(()=>{}); }, 15000);
</script>
</body></html>`;

export async function registerAdminPages(app: FastifyInstance): Promise<void> {
  app.get('/admin', async (_req, reply) => reply.type('text/html; charset=utf-8').send(PAGE));
}
