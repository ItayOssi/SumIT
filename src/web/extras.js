// The AI team (who does what, and a button that proves each one works) and the Infinity Stones start-up animation.
// Loaded before app.js; it only uses app.js's globals (S, $, h, send, helperMode ...) when called.

// ---------- Who does what ----------
// The work is split so that no single AI pays for everything: the heavy, rare work goes to Claude, the everyday
// questions to Gemini (free tier), and the checking to ChatGPT.
const TEAM = [
  { kind: 'claude', name: 'Claude', stone: 'אבן השכל', color: '#facc15',
    role: 'כותב את סיכום ההרצאה ופותר את שיעורי הבית. עבודה כבדה, פעם אחת להרצאה.' },
  { kind: 'gemini', name: 'Gemini', stone: 'אבן החלל', color: '#3b82f6',
    role: 'עונה על שאלות בצ\'אט, קורא סילבוס ומערכת שעות. הכי הרבה שימוש, ולכן הכי זול.' },
  { kind: 'chatgpt', name: 'ChatGPT', stone: 'אבן המציאות', color: '#ef4444',
    role: 'בודק את הפתרונות של Claude ואת התשובות בצ\'אט, כדי שלא יישארו טעויות.' }
];

function teamState(kind) {
  const a = S.ai || {};
  if (kind === 'claude') return a.claude && a.claude.loggedIn ? 'account' : '';
  return helperMode(kind === 'gemini' ? 'gemini' : 'openai');
}

function renderTeam() {
  const box = document.getElementById('aiTeam'); if (!box) return;
  box.innerHTML = '';
  TEAM.forEach(t => {
    const mode = teamState(t.kind);
    const res = (S.brainTests || {})[t.kind];
    const el = h(`<div class="team-row"><span class="team-stone" style="--c:${t.color}"></span>
      <div class="grow"><b>${t.name}</b><small class="muted">${t.stone} · ${esc(t.role)}</small>
      <small class="team-result${res ? (res.ok ? ' ok' : ' bad') : ''}" data-res></small></div>
      <span class="chip ${mode ? 'ok' : ''}">${mode ? (mode === 'key' ? 'מחובר עם מפתח' : 'מחובר') : 'לא מחובר'}</span>
      <button class="small ghost" data-test${mode ? '' : ' disabled'}>בדוק שזה עובד</button></div>`);
    const out = el.querySelector('[data-res]');
    if (res && res.busy) out.textContent = 'בודק...';
    else if (res) out.textContent = res.ok ? `✓ ענה תוך ${(res.ms / 1000).toFixed(1)} שניות${res.text && t.kind !== 'claude' ? ' · "' + res.text + '"' : ''}` : '✗ ' + (res.text || 'לא ענה');
    el.querySelector('[data-test]').onclick = () => {
      S.brainTests = S.brainTests || {}; S.brainTests[t.kind] = { busy: true }; renderTeam();
      send({ type: 'testBrain', kind: t.kind });
    };
    box.append(el);
  });
  box.append(h('<div class="team-note muted">כך נחסכים טוקנים: Claude מופעל רק על העבודה הכבדה, שאלות רגילות לא מגיעות אליו, ו-ChatGPT בודק רק אחרי שהסיכום מוכן.</div>'));
}

// ---------- Infinity stones ----------
// Six stones, one for each thing the app connects to. They fly into the gauntlet as each one is connected; with all six
// the gauntlet snaps (a white flash) and the app returns to normal.
const STONES = [
  { id: 'chatgpt', name: 'ChatGPT', label: 'אבן המציאות', color: '#ef4444', x: 149, y: 128, ok: () => helperMode('openai') !== '' },
  { id: 'claude', name: 'Claude', label: 'אבן השכל', color: '#facc15', x: 181, y: 122, ok: () => !!(S.ai && S.ai.claude && S.ai.claude.loggedIn) },
  { id: 'gemini', name: 'Gemini', label: 'אבן החלל', color: '#3b82f6', x: 213, y: 124, ok: () => helperMode('gemini') !== '' },
  { id: 'moodle', name: 'Moodle', label: 'אבן הזמן', color: '#22c55e', x: 245, y: 130, ok: () => S.moodle === 'ready' },
  { id: 'cs24', name: 'CS24', label: 'אבן הכוח', color: '#a855f7', x: 112, y: 166, ok: () => seen('cs24') },
  { id: 'zoom', name: 'Zoom', label: 'אבן הנשמה', color: '#f97316', x: 200, y: 182, ok: () => seen('zoom') }
];
function seen(k) { try { return localStorage.getItem('sumit.seen.' + k) === '1'; } catch { return false; } }
function markSeen(k) { try { localStorage.setItem('sumit.seen.' + k, '1'); } catch { } }

// app.js calls this for every message from the app and when a site is opened.
window.stonesHook = (m) => {
  if (m.type === 'openSite' && m.site === 'cs24') markSeen('cs24');
  if (m.type === 'zoomRecording' || (m.type === 'job' && m.state === 'done')) markSeen('zoom');
  if (m.type === 'brainTest') { S.brainTests = S.brainTests || {}; S.brainTests[m.kind] = m; renderTeam(); }
  if (m.type === 'aiStatus' || m.type === 'settings') renderTeam();
};

const GAUNTLET = `<svg viewBox="0 0 400 300" class="gauntlet" aria-hidden="true">
  <defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset=".5" stop-color="#d4a017"/><stop offset="1" stop-color="#8a5a00"/></linearGradient></defs>
  <rect x="146" y="226" width="108" height="58" rx="12" fill="url(#gold)"/>
  <rect x="134" y="104" width="132" height="136" rx="28" fill="url(#gold)"/>
  <rect x="136" y="50" width="28" height="72" rx="14" fill="url(#gold)"/><rect x="168" y="36" width="28" height="86" rx="14" fill="url(#gold)"/>
  <rect x="200" y="42" width="28" height="80" rx="14" fill="url(#gold)"/><rect x="232" y="58" width="28" height="64" rx="14" fill="url(#gold)"/>
  <rect x="92" y="150" width="52" height="30" rx="15" fill="url(#gold)" transform="rotate(-24 118 165)"/>
  ${STONES.map(s => `<circle cx="${s.x}" cy="${s.y}" r="13" fill="#1f1300" stroke="#fde68a" stroke-width="2"/>`).join('')}
</svg>`;

let stonesShown = false;
function playStones(force) {
  if (stonesShown && !force) return;
  stonesShown = true;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce && !force) return;
  const lit = STONES.filter(s => s.ok());
  const all = lit.length === STONES.length;
  const ov = h(`<div class="stones-overlay"><div class="stones-stage">${GAUNTLET}</div><div class="stones-flash"></div>
    <div class="stones-caption"></div><button class="link stones-skip">דלג</button></div>`);
  const stage = ov.querySelector('.stones-stage');
  const cap = ov.querySelector('.stones-caption');
  let done = false;
  const close = () => { if (done) return; done = true; ov.classList.add('out'); setTimeout(() => ov.remove(), 600); };
  ov.querySelector('.stones-skip').onclick = close;
  ov.onclick = close;
  document.body.append(ov);
  const W = Math.max(innerWidth, 600), H = Math.max(innerHeight, 500);
  const stones = lit.map((s, i) => {
    const el = document.createElement('div');
    el.className = 'infinity-stone';
    el.style.cssText = `--c:${s.color};left:${s.x / 4}%;top:${s.y / 3}%`;
    el.title = s.name + ' · ' + s.label;
    stage.append(el);
    const ang = (i / lit.length) * Math.PI * 2 + 0.6;
    const fromX = Math.cos(ang) * W * 0.6, fromY = Math.sin(ang) * H * 0.6;
    el.animate([
      { transform: `translate(${fromX}px,${fromY}px) scale(2.4)`, opacity: 0 },
      { opacity: 1, offset: 0.15 },
      { transform: 'translate(0,0) scale(1)', opacity: 1 }
    ], { duration: 1100, delay: 500 + i * 650, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    return { el, s, at: 500 + i * 650 + 1100 };
  });
  // Dim sockets for the stones that are not connected, with the reason below.
  STONES.filter(s => !s.ok()).forEach(s => {
    const d = document.createElement('div'); d.className = 'stone-missing'; d.style.cssText = `left:${s.x / 4}%;top:${s.y / 3}%;--c:${s.color}`; d.title = s.name + ' לא מחובר'; stage.append(d);
  });
  const end = lit.length ? Math.max(...stones.map(x => x.at)) : 800;
  stones.forEach(x => setTimeout(() => { if (!done) cap.textContent = x.s.name + ' · ' + x.s.label; }, x.at - 200));
  if (all) {
    setTimeout(() => { if (!done) { cap.textContent = ''; stage.classList.add('charged'); } }, end + 200);
    setTimeout(() => { if (!done) ov.classList.add('snap'); }, end + 1500);   // the white flash
    setTimeout(close, end + 2700);
  } else {
    setTimeout(() => { if (!done) cap.innerHTML = `${lit.length} מתוך ${STONES.length} אבנים. אפשר לחבר עוד בהגדרות`; }, end + 150);
    setTimeout(close, end + 2200);
  }
}
window.playStones = playStones;

// Waits until the app knows who is connected (or 6 seconds), then plays once per launch.
function stonesOnStart() {
  if (typeof DEMO !== 'undefined' && DEMO && !/stones=1/.test(location.search)) return;
  const t0 = Date.now();
  const wait = setInterval(() => {
    const splashGone = !document.getElementById('splash') || document.getElementById('splash').classList.contains('hide');
    const known = S.ready && S.ready.settings && S.ready.ai && S.moodle !== 'connecting' && S.moodle !== 'checking';
    if ((splashGone && known) || Date.now() - t0 > 9000) { clearInterval(wait); if (splashGone || Date.now() - t0 > 9000) playStones(); }
  }, 300);
}
window.addEventListener('load', stonesOnStart);
