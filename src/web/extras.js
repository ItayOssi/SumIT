// The start-up screen: the Infinity Gauntlet, and one stone flying into it for each thing that is connected.
// Loaded before app.js; it only uses app.js's globals (S, h, helperMode ...) when called.

// ChatGPT, Claude, Gemini, Moodle, CS24 and Zoom: six stones, six sockets on the gauntlet.
const STONES = [
  { id: 'chatgpt', name: 'ChatGPT', label: 'אבן המציאות', color: '#ef4444', x: 57, y: 62, ok: () => helperMode('openai') !== '' },
  { id: 'claude', name: 'Claude', label: 'אבן השכל', color: '#facc15', x: 82, y: 62, ok: () => !!(S.ai && S.ai.claude && S.ai.claude.loggedIn) },
  { id: 'gemini', name: 'Gemini', label: 'אבן החלל', color: '#3b82f6', x: 107, y: 62, ok: () => helperMode('gemini') !== '' },
  { id: 'moodle', name: 'Moodle', label: 'אבן הזמן', color: '#22c55e', x: 132, y: 62, ok: () => S.moodle === 'ready' },
  { id: 'cs24', name: 'CS24', label: 'אבן הכוח', color: '#a855f7', x: 29, y: 95, ok: () => seen('cs24') },
  { id: 'zoom', name: 'Zoom', label: 'אבן הנשמה', color: '#f97316', x: 100, y: 92, ok: () => seen('zoom') }
];
function seen(k) { try { return localStorage.getItem('sumit.seen.' + k) === '1'; } catch { return false; } }
function markSeen(k) { try { localStorage.setItem('sumit.seen.' + k, '1'); } catch { } }

// app.js calls this for every message from the app and when a site is opened.
window.stonesHook = (m) => {
  if (m.type === 'openSite' && m.site === 'cs24') markSeen('cs24');
  if (m.type === 'zoomRecording' || (m.type === 'job' && m.state === 'done')) markSeen('zoom');
  if (m.type === 'brainTest') { S.brainTests = S.brainTests || {}; S.brainTests[m.kind] = m; if (typeof renderProviders === 'function') renderProviders(); }
};

// A golden glove seen from the back (viewBox 200 x 150), with a socket for every stone.
window.gauntletStage = () => `<div class="gauntlet-stage" id="gauntletStage">
  <svg viewBox="0 0 200 150" class="gauntlet" aria-hidden="true">
    <defs>
      <linearGradient id="gGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b0"/><stop offset=".45" stop-color="#e0a912"/><stop offset="1" stop-color="#7a4b00"/></linearGradient>
      <linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b6fd8"/><stop offset="1" stop-color="#1b2f73"/></linearGradient>
    </defs>
    <g stroke="#5c3a00" stroke-width="1.2" stroke-linejoin="round">
      <path d="M62 108 L138 108 L144 142 L56 142 Z" fill="url(#gBlue)"/>
      <rect x="58" y="116" width="84" height="7" fill="url(#gGold)" stroke="none"/>
      <rect x="66" y="96" width="14" height="38" rx="3" fill="url(#gGold)" stroke="none" opacity="0"/>
      <path d="M44 62 Q40 108 70 112 L130 112 Q160 108 156 62 Z" fill="url(#gGold)"/>
      <rect x="46" y="14" width="22" height="52" rx="10" fill="url(#gGold)"/>
      <rect x="71" y="6" width="22" height="60" rx="10" fill="url(#gGold)"/>
      <rect x="96" y="4" width="22" height="62" rx="10" fill="url(#gGold)"/>
      <rect x="121" y="12" width="22" height="54" rx="10" fill="url(#gGold)"/>
      <path d="M44 84 Q16 80 14 96 Q14 110 40 104 Z" fill="url(#gGold)"/>
      <path d="M52 62 L148 62" stroke="#8a5a00" stroke-width="1.5" fill="none"/>
    </g>
    ${STONES.map(s => `<circle cx="${s.x}" cy="${s.y}" r="9.5" fill="#1d1200" stroke="#fde68a" stroke-width="1.6"/>`).join('')}
  </svg>
</div>`;

// What the start-up screen does when the app knows who is connected: the stones fly in, one after the other.
// With all six, the gauntlet snaps (a white flash) and the app opens as usual. `done` hides the screen.
window.splashFinale = (done) => {
  const splash = document.getElementById('splash'), stage = document.getElementById('gauntletStage');
  if (!stage || !splash) { done(); return; }
  let finished = false;
  const finish = () => { if (finished) return; finished = true; done(); };
  splash.addEventListener('click', finish, { once: true });
  const t0 = Date.now();
  const wait = setInterval(() => {
    if (finished) return clearInterval(wait);
    const known = S.moodle !== 'connecting' && S.moodle !== 'checking';
    if (!known && Date.now() - t0 < 3500) return;
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
      ], { duration: 850, delay: 300 + i * 480, easing: 'cubic-bezier(.25,.8,.25,1)', fill: 'both' });
      setTimeout(() => { if (!finished && text) text.textContent = s.name + ' · ' + s.label; }, 300 + i * 480 + 600);
    });
    const end = lit.length ? 300 + (lit.length - 1) * 480 + 900 : 300;
    if (lit.length === STONES.length) {
      setTimeout(() => stage.classList.add('charged'), end + 100);
      setTimeout(() => splash.classList.add('snap'), end + 1200);   // the white flash
      setTimeout(finish, end + 2000);
    } else {
      setTimeout(finish, end + 700);
    }
  }
};
