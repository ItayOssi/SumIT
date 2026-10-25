// The Infinity Stones: a golden gauntlet floating in the settings with one stone for each thing that is connected,
// a fly-in on the start-up screen, and, once all five stones are there, a snap that turns half of the app to dust.
// (After a restart everything is back, and the gauntlet is gone for good.)
// Loaded before app.js; it only uses app.js's globals (S, h, helperMode ...) when called.

const STONES = [
  { id: 'chatgpt', stone: 'Reality Stone', name: 'ChatGPT', color: '#ef4444', x: 57, y: 62, ok: () => helperMode('openai') !== '' },
  { id: 'claude', stone: 'Mind Stone', name: 'Claude', color: '#facc15', x: 82, y: 62, ok: () => !!(S.ai && S.ai.claude && S.ai.claude.loggedIn) },
  { id: 'gemini', stone: 'Space Stone', name: 'Gemini', color: '#3b82f6', x: 107, y: 62, ok: () => helperMode('gemini') !== '' },
  { id: 'moodle', stone: 'Time Stone', name: 'Moodle', color: '#22c55e', x: 132, y: 62, ok: () => S.moodle === 'ready' },
  { id: 'cs24', stone: 'Power Stone', name: 'CS24', color: '#a855f7', x: 29, y: 95, ok: () => true }   // CS24 needs no sign-in: it is always there
];
const snapped = () => { try { return !!(S.settings && S.settings.snapSeen) || localStorage.getItem('sumit.snap') === '1'; } catch { return false; } };

window.stonesHook = (m) => {
  if (m.type === 'brainTest') { S.brainTests = S.brainTests || {}; S.brainTests[m.kind] = m; if (typeof renderProviders === 'function') renderProviders(); }
  if (m.type === 'aiStatus' || m.type === 'moodle' || m.type === 'settings') setTimeout(() => { if (typeof S !== 'undefined' && S.view === 'settings') renderStoneField(); }, 60);
};

// A golden glove seen from the back (viewBox 200 x 150), with a socket for every stone.
function gauntletSvg() {
  return `<svg viewBox="0 0 200 150" class="gauntlet" aria-hidden="true">
    <defs>
      <linearGradient id="gGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b0"/><stop offset=".45" stop-color="#e0a912"/><stop offset="1" stop-color="#7a4b00"/></linearGradient>
      <linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b6fd8"/><stop offset="1" stop-color="#1b2f73"/></linearGradient>
    </defs>
    <g stroke="#5c3a00" stroke-width="1.2" stroke-linejoin="round">
      <path d="M62 108 L138 108 L144 142 L56 142 Z" fill="url(#gBlue)"/>
      <rect x="58" y="116" width="84" height="7" fill="url(#gGold)" stroke="none"/>
      <path d="M44 62 Q40 108 70 112 L130 112 Q160 108 156 62 Z" fill="url(#gGold)"/>
      <rect x="46" y="14" width="22" height="52" rx="10" fill="url(#gGold)"/>
      <rect x="71" y="6" width="22" height="60" rx="10" fill="url(#gGold)"/>
      <rect x="96" y="4" width="22" height="62" rx="10" fill="url(#gGold)"/>
      <rect x="121" y="12" width="22" height="54" rx="10" fill="url(#gGold)"/>
      <path d="M44 84 Q16 80 14 96 Q14 110 40 104 Z" fill="url(#gGold)"/>
      <path d="M52 62 L148 62" stroke="#8a5a00" stroke-width="1.5" fill="none"/>
    </g>
    ${STONES.map(s => `<circle cx="${s.x}" cy="${s.y}" r="9.5" fill="#1d1200" stroke="#fde68a" stroke-width="1.6"/>`).join('')}
  </svg>`;
}
window.gauntletStage = () => `<div class="gauntlet-stage" id="gauntletStage">${gauntletSvg()}</div>`;

// ---------- The start-up screen: the stones fly into the gauntlet ----------
window.splashFinale = (done) => {
  const splash = document.getElementById('splash'), stage = document.getElementById('gauntletStage');
  if (!stage || !splash) { done(); return; }
  let finished = false;
  const finish = () => { if (finished) return; finished = true; done(); };
  splash.addEventListener('click', finish, { once: true });
  const t0 = Date.now();
  const wait = setInterval(() => {
    if (finished) return clearInterval(wait);
    if (S.moodle === 'connecting' || S.moodle === 'checking') { if (Date.now() - t0 < 3000) return; }
    clearInterval(wait);
    play();
  }, 250);
  function play() {
    const lit = STONES.filter(s => s.ok());
    const text = document.getElementById('splashText');
    const track = splash.querySelector('.track'); if (track) track.style.visibility = 'hidden';
    STONES.filter(s => !s.ok()).forEach(s => { const d = document.createElement('div'); d.className = 'stone-missing'; d.style.cssText = `left:${s.x / 2}%;top:${s.y / 1.5}%;--c:${s.color}`; stage.append(d); });
    const W = Math.max(innerWidth, 700), H = Math.max(innerHeight, 500);
    lit.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'infinity-stone'; el.style.cssText = `--c:${s.color};left:${s.x / 2}%;top:${s.y / 1.5}%`;
      stage.append(el);
      const ang = Math.PI * 2 * (i / Math.max(lit.length, 1)) + 0.5;
      el.animate([
        { transform: `translate(${Math.cos(ang) * W * 0.55}px,${Math.sin(ang) * H * 0.55}px) scale(2.2)`, opacity: 0 },
        { opacity: 1, offset: 0.2 },
        { transform: 'translate(0,0) scale(1)', opacity: 1 }
      ], { duration: 800, delay: 250 + i * 420, easing: 'cubic-bezier(.25,.8,.25,1)', fill: 'both' });
      setTimeout(() => { if (!finished && text) text.textContent = s.stone + ' · ' + s.name; }, 250 + i * 420 + 550);
    });
    const end = lit.length ? 250 + (lit.length - 1) * 420 + 800 : 300;
    setTimeout(finish, end + 700);
  }
};

// ---------- The settings: the gauntlet and the stones float around ----------
function renderStoneField() {
  const old = document.getElementById('stoneField'); if (old) old.remove();
  const main = document.getElementById('main'); if (!main || snapped() || (typeof S !== 'undefined' && S.view !== 'settings')) return;
  const field = document.createElement('div'); field.id = 'stoneField';
  const r = main.getBoundingClientRect();
  field.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  const lit = STONES.filter(s => s.ok());
  const all = lit.length === STONES.length;
  const gx = Math.max(12, r.width - 190), gy = 150;      // the gauntlet floats on the right side, where the page is empty
  const g = document.createElement('div'); g.className = 'gf-gauntlet' + (all ? ' ready' : '');
  g.style.cssText = `left:${gx}px;top:${gy}px`;
  g.innerHTML = gauntletSvg() + (all ? '<div class="gf-hint">לחץ על הכפפה</div>' : '');
  g.title = all ? 'Infinity Gauntlet' : 'צריך את כל אבני האינסוף';
  field.append(g);
  // Sockets of the gauntlet (SVG box 200 x 150 shown at 170 x 128 px).
  const sock = (s) => ({ x: gx + s.x * 0.85, y: gy + s.y * 0.85 });
  lit.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'float-stone'; el.dataset.label = s.stone + ' · ' + s.name; el.style.setProperty('--c', s.color);
    const home = { x: 40 + ((i * 197) % Math.max(120, r.width - 260)), y: 90 + ((i * 151) % 560) };
    const to = all ? sock(s) : home;
    el.style.left = to.x + 'px'; el.style.top = to.y + 'px';
    if (!all) { el.style.animationDuration = (7 + i * 1.7) + 's'; el.style.animationDelay = (-i * 1.3) + 's'; }
    else el.classList.add('docked');
    field.append(el);
  });
  g.onclick = () => { if (all) snapNow(); };
  main.append(field);
}
window.renderStoneField = renderStoneField;
addEventListener('resize', () => { if (typeof S !== 'undefined' && S.view === 'settings') renderStoneField(); });

// ---------- The snap ----------
function snapNow() {
  const field = document.getElementById('stoneField'); if (!field || document.body.classList.contains('snapping')) return;
  document.body.classList.add('snapping');
  field.querySelectorAll('.float-stone').forEach(s => s.classList.add('charged'));
  field.querySelector('.gf-gauntlet').classList.add('snap');
  const flash = document.createElement('div'); flash.className = 'snap-flash'; document.body.append(flash);
  setTimeout(() => flash.classList.add('on'), 900);
  setTimeout(() => {
    // Half of everything on the screen turns to dust.
    const sel = '.card, .setting, .nav-item, .provider, .stat-tile, .deadline, .task, .brand-art, .chip, h1, h2, h3, p, .hero, .logo, .avatar-img, .status-pill, .theme-toggle';
    const els = [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null && !e.closest('#stoneField') && !e.closest('.snap-flash'));
    els.forEach(e => { if (Math.random() < 0.5) {
      e.style.setProperty('--dx', (40 + Math.random() * 140) + 'px'); e.style.setProperty('--dy', (-60 - Math.random() * 120) + 'px');
      e.style.setProperty('--rot', (Math.random() * 40 - 20) + 'deg'); e.style.setProperty('--delay', (Math.random() * 1.6) + 's');
      e.classList.add('dusted');
    } });
    document.body.classList.add('snapped');   // the character turns sad and fades away
    flash.classList.remove('on');
    field.remove();
    try { localStorage.setItem('sumit.snap', '1'); } catch { }
    send({ type: 'snapDone' });
  }, 1700);
}
window.snapNow = snapNow;
