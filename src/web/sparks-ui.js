// Sparks (✨) and achievements of the study track (macOS host: study-track.js, sparksInfo). The page shows what the host counted:
// the sparks a block gave float up from it, a new achievement slides in at the corner, a new level pops in the middle, and each
// has its own sound, made here with Web Audio (nothing is loaded; the page's CSP allows no media from outside). The sounds can be
// turned off from the sparks card; the choice is kept in this browser only.
const SPARK_TIERS = ['', 'ארד', 'כסף', 'זהב'];
const SPARK_GROUPS = [['streak', 'רצף ושגרה'], ['methods', 'שיטות למידה'], ['quiz', 'בוחן ונסתרים']];
const SPARK_HOW = [['כרטיסיות', 1], ['בוחן', 1.5], ['פיינמן, שליפה מהזיכרון', 2], ['תרגול, תרגיל בית', 2.5], ['מבחן קודם בתנאי מבחן', 3]];
S.sparkNew = new Set();   // achievements reached in this session: marked "חדש" on their card
S.sparkRect = null;       // where the block that was just marked done was, for the sparks to float up from

const sparkFmt = (n) => Number(n || 0).toLocaleString('he-IL');
const sparkImg = (name, cls) => `<img class="${cls || ''}" src="vendor/emoji/3d/${name}.png" alt="" draggable="false">`;
// \u2066…\u2069 keeps "×1.25" in this order inside Hebrew text.
const sparkMultLabel = (x) => '\u2066×' + String(x) + '\u2069';

// ---- Sound
function sparkSoundOn() { try { return localStorage.getItem('sumit-sounds') !== 'off'; } catch { return true; } }
function setSparkSound(on) { try { localStorage.setItem('sumit-sounds', on ? 'on' : 'off'); } catch { } }
let sparkCtx = null;
function sparkAudio() {
  if (!sparkSoundOn()) return null;
  try {
    sparkCtx = sparkCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (sparkCtx.state === 'suspended') sparkCtx.resume();
    return sparkCtx;
  } catch { return null; }
}
// A bell: the note and a quiet octave above it, a fast attack and a long fade.
function sparkBell(ctx, out, freq, t, dur, vol, type) {
  const g = ctx.createGain(), hi = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  hi.gain.value = 0.3; hi.connect(g); g.connect(out);
  const a = ctx.createOscillator(), b = ctx.createOscillator();
  a.type = type || 'sine'; a.frequency.value = freq; b.type = 'sine'; b.frequency.value = freq * 2.003;
  a.connect(g); b.connect(hi);
  a.start(t); b.start(t); a.stop(t + dur + 0.05); b.stop(t + dur + 0.05);
}
// The sparkle: a burst of very high noise that fades out.
function sparkShimmer(ctx, out, t, dur, vol) {
  const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3) * (i % 3 ? 0.4 : 1);
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = buf; f.type = 'highpass'; f.frequency.value = 7000; g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(out); src.start(t);
}
// kind: 'gain' (sparks: three rising bells), 'award' (an achievement: a short fanfare and a chord), 'level' (a new level: a run up and a big chord).
function playSpark(kind) {
  const ctx = sparkAudio(); if (!ctx) return;
  const t = ctx.currentTime + 0.03, out = ctx.createGain(), echo = ctx.createDelay(), fb = ctx.createGain(), wet = ctx.createGain();
  out.gain.value = 0.55; echo.delayTime.value = 0.13; fb.gain.value = 0.3; wet.gain.value = 0.35;
  out.connect(ctx.destination); out.connect(echo); echo.connect(fb); fb.connect(echo); echo.connect(wet); wet.connect(ctx.destination);
  const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.5, G6 = 1568, C7 = 2093;
  if (kind === 'gain') {
    [E6, G6, C7].forEach((f, i) => sparkBell(ctx, out, f, t + i * 0.07, 0.55, 0.16));
    sparkShimmer(ctx, out, t + 0.14, 0.4, 0.05);
  } else if (kind === 'award') {
    [C5, E5, G5].forEach((f, i) => sparkBell(ctx, out, f, t + i * 0.11, 0.32, 0.14, 'triangle'));
    [C5, E5, G5, C6].forEach(f => sparkBell(ctx, out, f, t + 0.36, 1.5, 0.09, 'triangle'));
    [C7, 2637, 3136].forEach((f, i) => sparkBell(ctx, out, f, t + 0.4 + i * 0.06, 0.7, 0.05));
    sparkShimmer(ctx, out, t + 0.36, 0.9, 0.06);
  } else if (kind === 'level') {
    [392, C5, E5, G5, C6, E6].forEach((f, i) => sparkBell(ctx, out, f, t + i * 0.07, 0.42, 0.13, 'triangle'));
    [C5, E5, G5, C6, G6].forEach(f => sparkBell(ctx, out, f, t + 0.46, 2, 0.08, 'triangle'));
    sparkShimmer(ctx, out, t + 0.46, 1.3, 0.07);
  }
}

// ---- What the student sees when they earn something
const sparkReduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// "+94 ✨" floating up from where the block was (or from the bottom of the page), with the multiplier of the streak under it.
function sparkFloat(points, mult, rect) {
  if (!(points > 0)) return;
  const f = h(`<div class="spark-float" role="status" aria-live="polite"><b></b>${sparkImg('sparkles')}<small></small></div>`);
  f.querySelector('b').textContent = '\u2066+' + sparkFmt(points) + '\u2069';
  f.querySelector('small').textContent = mult > 1 ? sparkMultLabel(mult) + ' רצף' : '';
  const r = rect || { left: window.innerWidth / 2 - 60, top: window.innerHeight - 140, width: 120 };
  f.style.left = Math.round(r.left + (r.width || 0) / 2 - 60) + 'px';
  f.style.top = Math.round(Math.max(8, r.top - 30)) + 'px';
  if (sparkReduced()) f.classList.add('still');
  for (let i = 0; i < 8 && !sparkReduced(); i++) { const s = h('<i class="spark-dot"></i>'); s.style.setProperty('--a', (i * 45 + 10) + 'deg'); f.append(s); }
  document.body.append(f);
  setTimeout(() => f.remove(), 1700);
}

// The new achievements, one after the other, at the corner of the page.
const sparkQueue = [];
function sparkAward(a) { sparkQueue.push(a); if (sparkQueue.length === 1) sparkNextAward(); }
function sparkNextAward() {
  const a = sparkQueue[0]; if (!a) return;
  S.sparkNew.add(a.id);
  const t = h(`<div class="spark-award tier-${a.tier}" role="status" aria-live="polite">${sparkImg(a.emoji)}<div class="grow"><small></small><b></b><span></span></div></div>`);
  t.querySelector('small').textContent = 'הישג חדש · ' + SPARK_TIERS[a.tier];
  t.querySelector('b').textContent = a.title;
  t.querySelector('span').textContent = a.desc + ' · \u2066+' + sparkFmt(a.sparks) + '\u2069 ניצוצות';
  t.onclick = () => { if (typeof show === 'function') show('track'); S.trackTab = 'awards'; if (typeof renderTrack === 'function') renderTrack(); };
  document.body.append(t);
  playSpark('award');
  if (a.tier === 3 && typeof confetti === 'function' && !sparkReduced()) confetti();
  setTimeout(() => t.classList.add('out'), 3600);
  setTimeout(() => { t.remove(); sparkQueue.shift(); sparkNextAward(); }, 4000);
}

// A new level: a card in the middle of the screen.
function sparkLevelUp(lv) {
  const o = h(`<div class="streak-pop big spark-level" role="status" aria-live="polite"><div class="streak-pop-card">${sparkImg('star', 'spark-level-ic')}<b></b><p></p></div></div>`);
  o.querySelector('b').textContent = 'רמה ' + lv.level;
  o.querySelector('p').textContent = 'עלית רמה! עכשיו אתה ' + lv.name + '.';
  o.onclick = () => o.remove();
  document.body.append(o);
  playSpark('level');
  if (typeof confetti === 'function' && !sparkReduced()) confetti();
  setTimeout(() => o.classList.add('out'), 2600);
  setTimeout(() => o.remove(), 3100);
}

// What the host sent after something was done: { sparkGain: { points, mult }, unlocked: [...], levelUp }.
function sparksReward(m, rect) {
  const g = m.sparkGain || {}, list = m.unlocked || [];
  let wait = 0;
  if (g.points > 0) { sparkFloat(g.points, g.mult, rect); playSpark('gain'); wait = 900; }
  if (m.levelUp) { setTimeout(() => sparkLevelUp(m.levelUp), wait); wait += 2000; }
  list.forEach(a => setTimeout(() => sparkAward(a), wait));
}

// A memory card rated or a quiz finished somewhere else in the app: the sparks float at the bottom, and the study track is fresh again.
function sparksEvent(m) {
  if (m.type !== 'sparks') return;
  // A card at a time is a small sound and no number; the achievements and a new level still show.
  if (m.kind === 'card') { if (m.sparkGain && m.sparkGain.points > 0 && sparkSoundOn()) playSpark('gain'); sparksReward(Object.assign({}, m, { sparkGain: null })); }
  else sparksReward(m, null);
  if (S.track && typeof trackSend === 'function') trackSend({ op: 'load' });
}

// ---- The cards of the study track

// The sparks on the overview: the level, the total, the way to the next level, and the week.
function sparksCard(sp) {
  const lv = sp.level, c = h(`<div class="card pad-lg spark-card">${sparkImg('sparkles', 'spark-ic')}<div class="grow">
    <div class="spark-lvl"></div><div class="spark-big"><b></b><span>ניצוצות</span></div>
    <div class="spark-bar"><i></i></div><small class="muted" data-next></small>
    <div class="spark-week"><span class="muted">השבוע</span><b></b><span class="muted" data-goal></span><div class="spark-bar thin"><i></i></div></div></div>
    <button type="button" class="ghost small icon-only spark-mute"></button></div>`);
  c.querySelector('.spark-lvl').textContent = 'רמה ' + lv.level + ' · ' + lv.name;
  c.querySelector('.spark-big b').textContent = sparkFmt(sp.total);
  c.querySelector('.spark-bar i').style.width = Math.round((sp.total - lv.from) / Math.max(1, lv.to - lv.from) * 100) + '%';
  const nx = c.querySelector('[data-next]');
  nx.append('עוד ' + sparkFmt(lv.to - sp.total) + ' ניצוצות לרמה ' + (lv.level + 1) + ': ');
  const nb = document.createElement('b'); nb.textContent = lv.next; nx.append(nb);
  c.querySelector('.spark-week b').textContent = sparkFmt(sp.week.earned);
  c.querySelector('[data-goal]').textContent = 'מתוך ' + sparkFmt(sp.week.goal);
  c.querySelector('.spark-week .spark-bar i').style.width = Math.min(100, Math.round(sp.week.earned / Math.max(1, sp.week.goal) * 100)) + '%';
  const mute = c.querySelector('.spark-mute');
  const paint = () => { const on = sparkSoundOn(); mute.textContent = on ? '🔊' : '🔇'; mute.title = on ? 'כבה צלילים' : 'הפעל צלילים'; mute.setAttribute('aria-label', mute.title); };
  mute.onclick = () => { setSparkSound(!sparkSoundOn()); paint(); if (sparkSoundOn()) playSpark('gain'); };
  paint();
  return c;
}

// The multiplier inside the streak card: the pill, the ladder of the four steps, and how far the next one is.
function sparksLadder(sp) {
  const box = h('<div class="spark-mult-box"><span class="spark-mult"></span><div class="spark-ladder"></div><small class="muted" data-tier></small></div>');
  box.querySelector('.spark-mult').textContent = sparkMultLabel(sp.mult) + ' ניצוצות';
  box.querySelector('.spark-mult').title = 'הרצף מכפיל את הניצוצות של כל יום. רצף שנשבר מתחיל שוב מ-×1, והקפאה שומרת עליו.';
  const lad = box.querySelector('.spark-ladder');
  sp.tiers.forEach(([d, x]) => { const s = h('<span><b></b><small></small></span>'); s.querySelector('b').textContent = sparkMultLabel(x); s.querySelector('small').textContent = 'מ-' + d + ' ימים'; s.classList.toggle('on', sp.mult === x); s.classList.toggle('past', sp.streak >= d && sp.mult !== x); lad.append(s); });
  box.querySelector('[data-tier]').textContent = sp.nextTier ? 'עוד ' + (sp.nextTier.days === 1 ? 'יום אחד' : sp.nextTier.days + ' ימים') + ' ל-' + sparkMultLabel(sp.nextTier.mult) : 'הגעת למכפיל הכי גבוה';
  return box;
}

// The sparks a block gives: "עד 98 ✨" before, "✓ 94 ✨" after.
function sparksChip(sp, b) {
  if (!sp || !sp.blocks || !(b.id in sp.blocks)) return null;
  const pts = Math.round(sp.blocks[b.id] * (b.done ? sp.mult : sp.multNext));
  const c = h(`<span class="spark-pts">${sparkImg('sparkles')}</span>`);
  c.prepend((b.done ? '✓ ' : 'עד ') + sparkFmt(pts) + ' ');
  c.classList.toggle('done', !!b.done);
  c.title = b.done ? 'הניצוצות שהבלוק נתן' : 'כמה ניצוצות הבלוק ייתן, לפי שיטת הלמידה, האורך והרצף';
  return c;
}

// The achievements tab: the level and the medals, how sparks are earned, and every achievement with its tier and the way to the next.
function trackAwardsPane(pane, t) {
  const sp = t.sparks; if (!sp) { pane.append(h('<p class="muted">ההישגים יופיעו כאן.</p>')); return; }
  const top = h(`<div class="card pad-lg spark-awards-top">${sparkImg('trophy', 'spark-ic')}<div class="grow"><b></b><small class="muted">כל הישג נותן ניצוצות: ארד 50, כסף 150, זהב 400</small></div>
    <div class="spark-medals"><div class="b"><b></b><small>ארד</small></div><div class="s"><b></b><small>כסף</small></div><div class="g"><b></b><small>זהב</small></div></div></div>`);
  top.querySelector('.grow b').textContent = 'רמה ' + sp.level.level + ' · ' + sp.level.name + ' · ' + sp.count.reached + ' מתוך ' + sp.count.all + ' הישגים';
  top.querySelector('.b b').textContent = sp.count.bronze; top.querySelector('.s b').textContent = sp.count.silver; top.querySelector('.g b').textContent = sp.count.gold;
  pane.append(top);

  const how = h('<div class="card pad-lg spark-how"><h3>איך מרוויחים ניצוצות</h3><div class="spark-how-grid"><div data-methods></div><div data-more></div></div></div>');
  const ml = how.querySelector('[data-methods]');
  ml.append(h('<small class="muted">כל רבע שעה של בלוק: 10 ניצוצות, כפול השיטה</small>'));
  SPARK_HOW.forEach(([n, x]) => { const r = h('<div class="spark-how-row"><span></span><span class="spark-dots"></span><b></b></div>'); r.querySelector('span').textContent = n; r.querySelector('b').textContent = sparkMultLabel(x); const dots = x >= 2.5 ? 3 : x >= 1.5 ? 2 : 1; r.querySelector('.spark-dots').innerHTML = [1, 2, 3].map(i => `<i class="${i <= dots ? 'f' : ''}"></i>`).join(''); ml.append(r); });
  const more = how.querySelector('[data-more]');
  [['קורס שסימנת כקשה', '30% יותר'], ['כרטיסייה שעברת', '2 כל אחת, עד 60 ביום'], ['בוחן שסיימת', '15, ומ-80% והלאה 30. ציון מלא: 50'], ['נושא שסימנת שהשלמת', '15'], ['הרצף מכפיל את היום', sp.tiers.map(x => sparkMultLabel(x[1])).join(' · ')]]
    .forEach(([n, v]) => { const r = h('<div class="spark-how-row"><span></span><b></b></div>'); r.querySelector('span').textContent = n; r.querySelector('b').textContent = v; more.append(r); });
  more.append(h('<small class="muted">בלוקים, זמן ונושאים שאתה מסמן בעצמך נותנים עד 600 ניצוצות ביום. כרטיסיות ובוחן האפליקציה רואה בעצמה.</small>'));
  pane.append(how);

  for (const [g, label] of SPARK_GROUPS) {
    const sec = h('<div class="spark-sec"><h4 class="muted"></h4><div class="spark-grid stagger"></div></div>');
    sec.querySelector('h4').textContent = label;
    const grid = sec.querySelector('.spark-grid');
    sp.awards.filter(a => a.group === g).forEach((a, i) => grid.append(sparkAwardCard(a, i)));
    pane.append(sec);
  }
}

function sparkAwardCard(a, i) {
  const secret = a.hidden && !a.tier;
  const c = h(`<div class="card spark-a">${sparkImg(secret ? 'lock' : a.emoji)}<b></b><small></small><div class="spark-tier"><i></i><i></i><i></i></div><div class="spark-prog" hidden><i></i></div><span class="spark-pn muted"></span></div>`);
  c.style.setProperty('--i', i);
  c.classList.toggle('gold', a.tier === 3); c.classList.toggle('locked', !a.tier && !secret); c.classList.toggle('secret', secret); c.classList.toggle('new', S.sparkNew.has(a.id));
  c.querySelector('b').textContent = secret ? '???' : a.title;
  c.querySelector('small').textContent = secret ? 'הישג נסתר. המשך ללמוד ותגלה' : a.desc;
  c.querySelectorAll('.spark-tier i').forEach((x, k) => x.classList.toggle(['b', 's', 'g'][k], a.tier > k));
  if (!secret && a.next) {
    const pr = c.querySelector('.spark-prog'); pr.hidden = false;
    const prev = a.tier ? a.tiers[a.tier - 1] : 0;
    pr.querySelector('i').style.width = Math.max(4, Math.round((a.value - prev) / Math.max(1, a.next - prev) * 100)) + '%';
    c.querySelector('.spark-pn').textContent = sparkFmt(a.value) + '/' + sparkFmt(a.next) + ' ל' + SPARK_TIERS[a.tier + 1];
  } else if (a.tier === 3) c.querySelector('.spark-pn').textContent = 'הושלם';
  c.title = secret ? '' : a.title + ': ' + a.tiers.map((x, k) => SPARK_TIERS[k + 1] + ' ' + x).join(' · ');
  return c;
}
