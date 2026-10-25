// The Infinity Stones: a golden gauntlet in the settings with one stone for each thing that is connected (the stones sit in it,
// they do not float), a fly-in on the start-up screen, and, once all five stones are there, a snap that turns half of the app to dust.
// (After a restart everything is back, and the gauntlet is gone for good.)
// Loaded before app.js; it only uses app.js's globals (S, h, helperMode ...) when called.

// x / y are the sockets in the gauntlet's drawing (200 x 240).
const STONES = [
  { id: 'claude', stone: 'Mind Stone', name: 'Claude', color: '#facc15', x: 56, y: 108, ok: () => !!(S.ai && S.ai.claude && S.ai.claude.loggedIn) },
  { id: 'chatgpt', stone: 'Reality Stone', name: 'ChatGPT', color: '#ef4444', x: 84, y: 102, ok: () => helperMode('openai') !== '' },
  { id: 'gemini', stone: 'Space Stone', name: 'Gemini', color: '#38bdf8', x: 114, y: 102, ok: () => helperMode('gemini') !== '' },
  { id: 'cs24', stone: 'Power Stone', name: 'CS24', color: '#a855f7', x: 142, y: 108, ok: () => true },   // CS24 needs no sign-in: it is always there
  { id: 'moodle', stone: 'Time Stone', name: 'Moodle', color: '#22c55e', x: 162, y: 138, ok: () => S.moodle === 'ready' }
];
const snapped = () => { try { return !!(S.settings && S.settings.snapSeen) || localStorage.getItem('sumit.snap') === '1'; } catch { return false; } };

window.stonesHook = (m) => {
  if (m.type === 'brainTest') { S.brainTests = S.brainTests || {}; S.brainTests[m.kind] = m; if (typeof renderProviders === 'function') renderProviders(); }
  if (m.type === 'aiStatus' || m.type === 'moodle' || m.type === 'settings') setTimeout(() => { if (typeof S !== 'undefined' && S.view === 'settings') renderStoneField(); }, 60);
};

// A cartoon gauntlet (flat gold, a thick brown outline), with a socket for every stone and a big gem in the palm.
function gauntletSvg(ready) {
  const finger = (x, y, rot, h) => `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="-11" y="${-h}" width="22" height="${(h * 0.52).toFixed(1)}" rx="7"/><rect x="-11" y="${(-h * 0.48).toFixed(1)}" width="22" height="${(h * 0.5).toFixed(1)}" rx="7"/><path d="M-9 ${(-h * 0.46).toFixed(1)}h18" class="seam"/></g>`;
  return `<svg viewBox="0 0 200 240" class="gauntlet" aria-hidden="true">
    <defs>
      <radialGradient id="gemC" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#fffbe0"/><stop offset=".5" stop-color="#ffd23c"/><stop offset="1" stop-color="#d08a00"/></radialGradient>
      <linearGradient id="gGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd84a"/><stop offset="1" stop-color="#f0b014"/></linearGradient>
    </defs>
    <g fill="url(#gGold)" stroke="#7a4a08" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">
      <path d="M50 148 L150 148 L176 216 Q100 236 24 216 Z"/>
      <path d="M40 200 Q100 218 160 200" fill="none" stroke-width="3"/>
      <path d="M86 150 L114 150 L120 196 L100 212 L80 196 Z" fill="#8c5a10" stroke-width="3"/>
      <path d="M94 160 L100 154 L106 160 M94 172 L100 166 L106 172 M94 184 L100 178 L106 184" fill="none" stroke="#f3c34a" stroke-width="2.4"/>
      ${finger(60, 104, -15, 62)}${finger(86, 100, -5, 74)}${finger(114, 100, 5, 72)}${finger(140, 104, 15, 58)}
      <path d="M46 100 Q42 142 54 156 L146 156 Q160 142 154 100 Z"/>
      <g transform="translate(156 126) rotate(50)"><rect x="-11" y="-42" width="22" height="44" rx="8"/><path d="M-11 -30 L-18 -50 L2 -62 L11 -46 Z"/></g>
    </g>
    <circle cx="100" cy="132" r="19" fill="#7a4a08"/><circle cx="100" cy="132" r="15" fill="url(#gemC)" ${ready ? 'class="gem-on"' : ''}/>
    <ellipse cx="95" cy="126" rx="5" ry="3" fill="#fff" opacity=".8"/>
    ${STONES.map(s => `<circle cx="${s.x}" cy="${s.y}" r="10.5" fill="#3a2406" stroke="#7a4a08" stroke-width="3"/>`).join('')}
  </svg>`;
}
const pct = (s) => `left:${(s.x / 2).toFixed(2)}%;top:${(s.y / 2.4).toFixed(2)}%`;
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
    const W = Math.max(innerWidth, 700), H = Math.max(innerHeight, 500);
    lit.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'infinity-stone'; el.style.cssText = `--c:${s.color};${pct(s)}`;
      stage.append(el);
      const ang = Math.PI * 2 * (i / Math.max(lit.length, 1)) + 0.5;
      el.animate([
        { transform: `translate(calc(-50% + ${Math.cos(ang) * W * 0.55}px), calc(-50% + ${Math.sin(ang) * H * 0.55}px)) scale(2.2)`, opacity: 0 },
        { opacity: 1, offset: 0.2 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }
      ], { duration: 800, delay: 250 + i * 420, easing: 'cubic-bezier(.25,.8,.25,1)', fill: 'both' });
      setTimeout(() => { if (!finished && text) text.textContent = s.stone + ' · ' + s.name; }, 250 + i * 420 + 550);
    });
    const end = lit.length ? 250 + (lit.length - 1) * 420 + 800 : 300;
    setTimeout(finish, end + 700);
  }
};

// ---------- The settings: the gauntlet, with the stones that are connected ----------
function renderStoneField() {
  const old = document.getElementById('stoneField'); if (old) old.remove();
  const main = document.getElementById('main'); if (!main || snapped() || (typeof S !== 'undefined' && S.view !== 'settings')) return;
  const field = document.createElement('div'); field.id = 'stoneField';
  const r = main.getBoundingClientRect();
  field.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  const lit = STONES.filter(s => s.ok());
  const all = lit.length === STONES.length;
  const g = document.createElement('div'); g.className = 'gf-gauntlet' + (all ? ' ready' : '');
  g.style.cssText = `left:${Math.max(12, r.width - 190)}px;top:150px`;
  g.innerHTML = gauntletSvg(all) + (all ? '<div class="gf-hint">לחץ על הכפפה</div>' : '');
  STONES.forEach(s => {
    const el = document.createElement('div');
    if (s.ok()) { el.className = 'float-stone docked'; el.dataset.label = s.stone + ' · ' + s.name; }
    else { el.className = 'float-stone docked off'; el.dataset.label = s.stone + ' · ' + s.name + ' (לא מחובר)'; }
    el.style.cssText = `--c:${s.color};${pct(s)}`;
    g.append(el);
  });
  g.onclick = () => { if (all) snapNow(); };
  field.append(g);
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
