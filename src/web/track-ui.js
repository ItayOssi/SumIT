// "Study track" (macOS host: study-track.js), beta. One page with: the student's courses (from the timetable, from the app, or typed by hand),
// a strategy for each course (how to study it), a week of study blocks that fits around the timetable, and the progress. The profile
// is a file on this computer, and can be exported and imported. The item in the sidebar stays hidden until the host answers,
// so it is not shown on Windows.
const TRACK_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const TRACK_LEVELS = [[1, 'קל לי'], [2, 'בינוני'], [3, 'קשה לי']];
S.trackOk = false;
S.track = null;           // the last state the host sent: { profile, suggested, today, weekStart, stats }
S.trackDays = [0, 1, 2, 3, 4];
let trackStrategyRun = null;   // { course, show } while the strategy dialog is open

function askTrack() { send({ type: 'trackPing' }); }
function trackSend(m) { send(Object.assign({ type: 'track' }, m)); }
function trackLoad() { trackSend({ op: 'load', courses: (typeof thisSemester === 'function' ? thisSemester(S.courses || []) : (S.courses || [])).map(c => c.name) }); trackSend({ op: 'tasks' }); }
S.trackTasks = null;      // { tasks, total }: what to do next, from the course folders (study-track.js, TrackTasks)
const TRACK_TASK_IC = { homework: 'clipboard', exam: 'exam', review: 'refresh', summary: 'sparkles', cards: 'brain', practice: 'edit', transcribe: 'video' };

function trackEvent(m) {
  if (m.type === 'trackReady') { S.trackOk = true; const n = $('navTrack'); if (n) n.hidden = false; return; }
  if (m.type === 'trackTopics') {
    const was = S.trackTopics[m.course] || {};
    S.trackTopics[m.course] = Object.assign(was, { lectures: m.lectures || [], hints: m.hints || {}, reading: !!m.reading }, m.syllabus ? { syllabus: m.syllabus } : {});
    window.dispatchEvent(new CustomEvent('sumit-track-topics', { detail: { course: m.course } })); return;
  }
  if (m.type === 'trackState') {
    const before = S.track && S.track.stats && S.track.stats.streakInfo;
    // The tasks leave out what the week already has as a goal, so a change in the blocks asks for them again.
    const planSig = (t) => JSON.stringify(((t && t.profile && t.profile.plan) || {}).blocks || []);
    const replan = S.track && S.trackTasks && planSig(S.track) !== planSig(m);
    S.track = m;
    if (replan) trackSend({ op: 'tasks' });
    const after = m.stats && m.stats.streakInfo;
    // The first thing finished today lights the flame: a small celebration, a bigger one on a milestone.
    const lit = before && after && !before.todayDone && after.todayDone;
    if (lit) streakCelebrate(after);
    // Sparks, achievements and a new level earned by what was just done (after the flame, when it just lit).
    if ((m.sparkGain || (m.unlocked && m.unlocked.length) || m.levelUp) && typeof sparksReward === 'function') {
      const rect = S.sparkRect; S.sparkRect = null;
      setTimeout(() => sparksReward(m, rect), lit ? (after.milestone ? 3000 : 2100) : 0);
    }
    if (m.wizardDone) S.trackTab = 'overview';
    if (m.built && !m.wizardDone) toast(m.built.unplaced ? 'השבוע נבנה. ' + minLabel(m.built.unplaced) + ' לא נכנסו, אפשר להרחיב ימים או שעות.' : 'השבוע נבנה סביב מערכת השעות');
    renderTrack(); window.dispatchEvent(new Event('sumit-track')); if (typeof renderHeroBadges === 'function') renderHeroBadges();
    if (typeof twEvent === 'function') twEvent(m);
    // The first time in the study track, the wizard opens by itself (once per session if the student closes it).
    if (!m.wizardDone && m.profile && !(m.profile.routine && m.profile.routine.done) && !S.twDismissed && typeof openTrackWizard === 'function' && document.getElementById('view-track').classList.contains('active')) openTrackWizard();
    return;
  }
  if (m.type === 'trackTasks') { S.trackTasks = m; renderTrackTasks(); return; }
  if ((m.type === 'trackRoutineScan' || m.type === 'trackRatings' || m.type === 'trackWizard') && typeof twEvent === 'function') { twEvent(m); return; }
  if (m.type === 'trackStrategy' && trackStrategyRun && m.course === trackStrategyRun.course) trackStrategyRun.show(m);
  if (m.type === 'calSync') { S.calSync = Object.assign({}, m, { calendars: m.calendars || (m.listError ? null : S.calSync && S.calSync.calendars) || null }); renderCalSync(); return; }
  if (m.type === 'icloudExport') {
    S.icloud = m;
    if (m.state === 'done') toast(m.text);
    else if (m.state === 'error') toast(m.error, { error: true });
    renderICloud();
  }
}

// The iCloud card's button and status line, from the last { type: 'icloudExport' } the host sent.
function renderICloud() {
  const card = document.querySelector('[data-icloud-card]'); if (!card) return;
  const btn = card.querySelector('[data-icloud]'), st = card.querySelector('[data-icloud-status]'), rv = card.querySelector('[data-icloud-reveal]');
  const m = S.icloud, busy = !!m && m.state === 'busy';
  btn.disabled = busy;
  btn.innerHTML = busy ? '<span data-ic="spin"></span>מסנכרן...' : '<span data-ic="cloud"></span>ייצא ל-iCloud / iPad';
  st.className = 'track-icloud-status' + (m && m.state === 'error' ? ' err' : m && m.state === 'done' ? ' ok' : '');
  st.textContent = !m ? '' : busy ? 'מעתיק ' + m.done + '/' + m.total + (m.course ? ' · ' + m.course : '') : m.state === 'error' ? m.error : '✓ ' + m.text;
  rv.hidden = !(m && m.state === 'done');
  rv.onclick = () => send({ type: 'exportTool', op: 'icloudReveal', course: m.course });
  icons(card);
}

// The card that keeps the Calendar app of the Mac (and through it Google Calendar) in step with the blocks: off, choosing a calendar, or on.
// S.calSync is the last { type: 'calSync' } the host sent: { on, calendar, nth, count, last, error, busy, calendars }.
function renderCalSync() {
  const card = document.querySelector('[data-calsync-card]'); if (!card) return;
  const body = card.querySelector('[data-calsync]'), m = S.calSync; body.innerHTML = '';
  if (!m) { body.append(h('<small class="muted">בודק...</small>')); return; }
  const btn = (label, cls, fn, ic) => { const b = h(`<button type="button" class="${cls}">${ic ? `<span data-ic="${ic}"></span>` : ''}</button>`); b.append(document.createTextNode(label)); b.disabled = !!m.busy; b.onclick = fn; return b; };
  const act = (action, extra) => { S.calSync = Object.assign({}, m, { busy: true }); renderCalSync(); send(Object.assign({ type: 'calSync', action }, extra || {})); };
  if (m.on) {
    const st = h('<small class="track-icloud-status" aria-live="polite" dir="auto"></small>');
    st.classList.add(m.error ? 'err' : 'ok'); st.dir = 'rtl';
    if (m.error) st.textContent = m.error;
    else {
      // The name of the calendar is often an e-mail address: it is kept apart, so it does not turn the Hebrew around it.
      const name = document.createElement('bdi'); name.textContent = m.calendar;
      st.append('✓ מסונכרן ליומן ', name, ' · ' + (m.count === 1 ? 'בלוק אחד' : m.count + ' בלוקים') + (m.last && typeof agoLabel === 'function' ? ' · ' + agoLabel(m.last) : ''));
    }
    body.append(st);
    const row = h('<div class="row wrap"></div>');
    row.append(btn(m.busy ? 'מסנכרן...' : 'סנכרן עכשיו', 'soft', () => act('now'), m.busy ? 'spin' : 'refresh'));
    row.append(btn('כבה', 'ghost small', () => act('off', { remove: false })));
    row.append(btn('כבה והסר מהיומן', 'ghost small', () => { if (confirm('לכבות את הסנכרון ולהסיר מהיומן את הבלוקים ש-SumIT הוסיפה? בלוקים שכבר למדת נשארים.')) act('off', { remove: true }); }));
    body.append(row);
  } else if (m.calendars) {
    if (!m.calendars.length) { body.append(h('<small class="track-icloud-status err">לא נמצא ב-Calendar יומן שאפשר לכתוב אליו.</small>')); }
    else {
      const sel = h('<select aria-label="היומן שאליו ייכתבו הבלוקים"></select>');
      m.calendars.forEach((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = c.name + (c.nth ? ' (' + (c.nth + 1) + ')' : ''); sel.append(o); });
      const prev = m.calendars.findIndex(c => c.name === m.calendar && c.nth === (m.nth || 0)); if (prev >= 0) sel.value = String(prev);
      body.append(h('<small class="muted">בחר יומן. כדי שהבלוקים יגיעו ל-Google, בחר יומן של חשבון ה-Google שלך.</small>'));
      body.append(sel);
      body.append(btn('התחל לסנכרן', 'primary', () => { const c = m.calendars[Number(sel.value)]; act('set', { calendar: c.name, nth: c.nth }); }, 'check'));
    }
  } else {
    body.append(btn(m.busy ? 'קורא את היומנים...' : 'הפעל סנכרון', 'soft', () => act('list'), m.busy ? 'spin' : 'refresh'));
    if (m.listError) { const e = h('<small class="track-icloud-status err" dir="auto"></small>'); e.textContent = m.listError; body.append(e); }
  }
  icons(card);
}

const trackDate = (iso) => { const p = String(iso).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const trackDM = (iso) => { const p = String(iso).split('-'); return p[2] + '/' + p[1]; };
const trackClock = (hhmm, plus) => { const [a, b] = hhmm.split(':').map(Number), t = a * 60 + b + (plus || 0); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };

// The page is a header (the week at a glance, the wizard and "build again") and five tabs, so only one part is on the screen at a time.
const TRACK_DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
// Short minutes under a column: "1.5 ש׳" or "45 ד׳".
const trackShort = (m) => !m ? '' : m >= 60 ? (Math.round(m / 30) / 2) + ' ש׳' : m + ' ד׳';
const TRACK_TABS = [['overview', 'home', 'סקירה'], ['week', 'calendar', 'השבוע'], ['courses', 'book', 'קורסים'], ['progress', 'chart', 'התקדמות'], ['awards', 'trophy', 'הישגים'], ['board', 'users', 'חברים'], ['tools', 'settings', 'כלים']];
const trackTabs = () => TRACK_TABS.filter(x => x[0] !== 'board' || (S.board && S.board.configured));
S.trackTab = 'overview';
const trackIso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const trackDayIso = (weekStart, d) => { const x = new Date(trackDate(weekStart).getTime()); x.setDate(x.getDate() + d); return trackIso(x); };

// The plan shown: this week's, or next week's when it was built after the last study day.
function trackPlan(t) {
  const p = t.profile, planWeek = p.plan.weekStart, current = !!planWeek && planWeek >= t.weekStart;
  return { blocks: current ? p.plan.blocks : [], current, planWeek, next: current && planWeek > t.weekStart, old: !!planWeek && !current,
    shownWeek: current ? planWeek : t.weekStart };
}

// One tooltip for every chart on the page: it follows the bar under the pointer (or the keyboard focus).
function trackTip(el, text) {
  el.setAttribute('aria-label', text); el.tabIndex = 0;
  const show = () => {
    let tip = document.querySelector('.track-tip'); if (!tip) { tip = h('<div class="track-tip" role="tooltip"></div>'); document.body.append(tip); }
    tip.textContent = text; tip.classList.add('on');
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + 'px';
    tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + 'px';
  };
  const hide = () => { const tip = document.querySelector('.track-tip'); if (tip) tip.classList.remove('on'); };
  el.onmouseenter = show; el.onfocus = show; el.onmouseleave = hide; el.onblur = hide;
}

// A ring for one share (0..1), with the number in the middle.
function trackRing(share, big, small) {
  const r = 42, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, share || 0));
  const el = h(`<div class="track-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${r}" class="track-ring-bg"/><circle cx="50" cy="50" r="${r}" class="track-ring-fg" stroke-dasharray="${(c * v).toFixed(1)} ${c.toFixed(1)}"/></svg><div><b></b><small></small></div></div>`);
  el.querySelector('b').textContent = big; el.querySelector('small').textContent = small;
  return el;
}

// Columns with a baseline: each item { label, sub, value, part, tip, today }. `part` (≤ value) is drawn strong, the rest of `value` light.
function trackColumns(items, opts) {
  const o = opts || {}, max = Math.max(o.min || 30, ...items.map(i => Math.max(i.value, i.part || 0))) * 1.12;   // a little room above the tallest
  const el = h(`<div class="track-cols${o.dense ? ' dense' : ''}"></div>`);
  for (const it of items) {
    const col = h('<div class="track-col"><div class="track-col-plot"><div class="track-col-bar"><i class="rest"></i><i class="part"></i></div></div><b></b><small class="muted"></small></div>');
    const full = Math.max(it.value, it.part || 0), bar = col.querySelector('.track-col-bar');
    bar.style.height = full ? Math.max(4, Math.round(full * 100 / max)) + '%' : '0';
    bar.querySelector('.part').style.height = full ? Math.round((it.part || 0) * 100 / full) + '%' : '0';
    col.classList.toggle('no-data', !full);
    col.classList.toggle('today', !!it.today);
    col.querySelector('b').textContent = it.label; col.querySelector('small').textContent = it.sub || '';
    trackTip(col.querySelector('.track-col-plot'), it.tip);
    el.append(col);
  }
  return el;
}

function trackLegend(items) {
  const el = h('<div class="track-legend"></div>');
  for (const [cls, label] of items) { const x = h(`<span><i class="${cls}"></i></span>`); x.append(document.createTextNode(label)); el.append(x); }
  return el;
}

function renderTrack() {
  const box = $('trackPage'); if (!box || !S.track) return;
  const t = S.track, p = t.profile, st = t.stats, plan = trackPlan(t);
  if (!trackTabs().some(x => x[0] === S.trackTab)) S.trackTab = 'overview';
  if (!S.boardAsked) { S.boardAsked = true; send({ type: 'board', op: 'state' }); }
  const keepY = window.scrollY;
  box.innerHTML = '';

  // ---- The header: the week in a ring, the routine in one line, the wizard and "build again".
  const hasRoutine = !!(p.routine && p.routine.done);
  const hero = h(`<div class="card pad-lg track-hero"><div class="track-hero-text"><h2></h2><p class="muted" data-line></p>
    <div class="row wrap track-hero-actions"><button class="primary" data-wizard><span data-ic="sparkles"></span></button><button class="soft" data-rebuild><span data-ic="refresh"></span>בנה שוב את השבוע</button></div></div></div>`);
  const share = st.plannedMinutes ? st.weekMinutes / st.plannedMinutes : 0;
  hero.prepend(trackRing(share, st.plannedMinutes ? Math.round(share * 100) + '%' : minLabel(st.weekMinutes), st.plannedMinutes ? 'מהשבוע' : 'השבוע'));
  if (st.streakInfo) hero.append(streakBadge(st.streakInfo));
  hero.querySelector('h2').textContent = p.name ? 'היי ' + p.name + ', זה השבוע שלך' : 'זה השבוע שלך';
  const peak = hasRoutine ? { morning: 'בבוקר', noon: 'בצהריים', evening: 'בערב' }[p.routine.peak] : '';
  hero.querySelector('[data-line]').textContent = hasRoutine
    ? minLabel(st.weekMinutes) + (st.plannedMinutes ? ' מתוך ' + minLabel(st.plannedMinutes) : '') + ' · ' + st.doneBlocks + '/' + st.plannedBlocks + ' בלוקים · בלוקים של ' + p.routine.block + ' דק׳, הכי הרבה אנרגיה ' + peak
    : 'עוד לא בנית תוכנית. האשף שואל על השגרה שלך, קורא את היומן ובונה שבוע שמתאים לך.';
  const wiz = hero.querySelector('[data-wizard]');
  wiz.append(document.createTextNode(hasRoutine ? 'תכנן מחדש עם האשף' : 'התחל באשף התכנון'));
  wiz.title = 'עוברים שוב על השגרה, ההתחייבויות והקורסים, ובונים שבוע חדש';
  wiz.onclick = () => { S.twAnswers = null; openTrackWizard(); };
  const rb = hero.querySelector('[data-rebuild]');
  rb.hidden = !p.courses.length;
  rb.title = 'אותה שגרה ואותם קורסים, שבוע חדש מההתחלה';
  rb.onclick = () => trackBuild(p, plan);
  box.append(hero);

  // ---- The tabs
  const counts = { week: plan.blocks.length ? st.doneBlocks + '/' + st.plannedBlocks : '', courses: p.courses.length || '', overview: S.trackTasks && S.trackTasks.total ? S.trackTasks.total : '', awards: t.sparks && t.sparks.count.reached ? t.sparks.count.reached : '' };
  const tabs = h('<div class="tabs track-tabs" role="tablist" aria-label="מסלול הלמידה"></div>');
  for (const [id, ic, label] of trackTabs()) {
    const b = h(`<button type="button" role="tab" data-tab="${id}"><span data-ic="${ic}"></span></button>`);
    b.append(document.createTextNode(label));
    if (counts[id]) { const n = h('<span class="badge"></span>'); n.textContent = counts[id]; if (id === 'awards') n.classList.add('gold'); b.append(n); }
    b.classList.toggle('active', id === S.trackTab); b.setAttribute('aria-selected', String(id === S.trackTab));
    b.onclick = () => {
      const ids = trackTabs().map(x => x[0]), from = ids.indexOf(S.trackTab), to = ids.indexOf(id);
      if (to !== from) S.trackPaneDx = to > from ? '-28px' : '28px';   // the next pane slides in from that side, once
      S.trackTab = id; renderTrack();
    };
    tabs.append(b);
  }
  box.append(tabs);

  const pane = h('<div class="track-pane" role="tabpanel"></div>');
  if (S.trackPaneDx) { pane.classList.add('pane-in'); pane.style.setProperty('--pane-dx', S.trackPaneDx); S.trackPaneDx = ''; }
  ({ overview: trackOverview, week: trackWeekPane, courses: trackCoursesPane, progress: trackProgressPane, awards: trackAwardsPane, board: trackBoardPane, tools: trackToolsPane })[S.trackTab](pane, t, p, st, plan);
  box.append(pane);
  if (S.trackTab === 'tools') { renderICloud(); renderCalSync(); if (!S.calSyncAsked) { S.calSyncAsked = true; send({ type: 'calSync', action: 'state' }); } }
  icons(box);
  window.scrollTo(0, keepY);
}

// "Build again": the same routine and courses, from the form of the week. Blocks already done or added by hand are lost, so it asks first.
function trackBuild(p, plan) {
  if (!p.courses.length) { toast('קודם הוסף קורסים', { error: true }); return; }
  const done = plan.blocks.filter(b => b.done).length;
  if (done && !confirm('לבנות את השבוע מחדש? ' + done + ' בלוקים שסימנת כבוצעו יוחלפו בבלוקים חדשים. הזמן שרשמת נשאר בהתקדמות.')) return;
  const f = S.trackForm || {};
  trackSend({ op: 'build', hours: Number(f.hours) || (p.routine && p.routine.hours) || 10, days: S.trackDays.slice().sort(), from: f.from || '09:00', to: f.to || '20:00' });
}

// ---- Overview: the numbers, the week as columns, today, and the next three tasks.
function trackOverview(pane, t, p, st, plan) {
  const stats = h('<div class="track-stats"></div>');
  const tile = (label, value, sub) => { const d = h('<div class="track-stat"><small class="muted"></small><b></b><span class="muted"></span></div>'); d.querySelector('b').textContent = value; d.querySelector('small').textContent = label; d.querySelector('span').textContent = sub || ''; stats.append(d); };
  tile('למדת השבוע', minLabel(st.weekMinutes), st.plannedMinutes ? 'מתוך ' + minLabel(st.plannedMinutes) : '');
  tile('בלוקים', st.doneBlocks + '/' + st.plannedBlocks, st.plannedBlocks ? 'בוצעו' : 'אין עדיין תוכנית');
  tile('הרצף הכי ארוך', st.streakInfo ? streakDays(st.streakInfo.best) : '0 ימים', 'ימים ברצף שבהם השלמת משהו');
  tile('סך הכל', minLabel(st.totalMinutes), 'מאז שהתחלת');
  // The sparks and the streak side by side; the streak card has the multiplier of the sparks.
  if (t.sparks && typeof sparksCard === 'function') {
    const row = h('<div class="spark-row"></div>');
    row.append(sparksCard(t.sparks));
    if (st.streakInfo) row.append(streakCard(st.streakInfo, t.sparks));
    pane.append(row);
  } else if (st.streakInfo) pane.append(streakCard(st.streakInfo));
  const ex = trackExamsCard(st.lights);
  if (ex) pane.append(ex);
  pane.append(stats);

  const grid = h('<div class="track-grid"></div>');
  // The week as columns: planned per day, and what was done of it.
  const wc = h('<div class="card pad-lg track-card"><div class="track-card-head"><h3>השבוע במבט אחד</h3></div></div>');
  if (plan.blocks.length) {
    const items = TRACK_DAYS.map((dn, d) => {
      const day = plan.blocks.filter(b => b.day === d), planned = day.reduce((s, b) => s + b.minutes, 0), done = day.filter(b => b.done).reduce((s, b) => s + (b.doneMinutes || b.minutes), 0);
      const iso = trackDayIso(plan.shownWeek, d);
      return { d, label: TRACK_DAY_LETTERS[d], sub: trackShort(planned), value: planned, part: Math.min(planned, done), today: iso === t.today,
        tip: 'יום ' + dn + ': ' + (planned ? minLabel(planned) + ' מתוכננות, ' + minLabel(Math.min(planned, done)) + ' בוצעו' : 'אין בלוקים') };
    }).filter(it => it.value || it.d !== 6);
    wc.append(trackColumns(items, { min: 60 }));
    wc.append(trackLegend([['part', 'בוצע'], ['rest', 'מתוכנן']]));
  } else wc.append(h('<p class="muted">עוד אין בלוקים לשבוע הזה. האשף יבנה לך שבוע בכמה לחיצות.</p>'));
  grid.append(wc);

  // Today (or the next day with blocks).
  const td = h('<div class="card pad-lg track-card"><div class="track-card-head"><h3></h3><button class="ghost small" data-all>לכל השבוע</button></div><div class="track-today"></div></div>');
  td.querySelector('[data-all]').onclick = () => { S.trackTab = 'week'; renderTrack(); };
  const todayIdx = TRACK_DAYS.findIndex((_, d) => trackDayIso(plan.shownWeek, d) === t.today);
  const order = todayIdx >= 0 ? [0, 1, 2, 3, 4, 5, 6].map(i => (todayIdx + i) % 7).filter(d => d >= todayIdx) : [0, 1, 2, 3, 4, 5, 6];
  const nextDay = order.find(d => plan.blocks.some(b => b.day === d && !b.done));
  td.querySelector('h3').textContent = nextDay === undefined ? 'היום' : nextDay === todayIdx ? 'היום' : 'הבא בתור: יום ' + TRACK_DAYS[nextDay];
  const tl = td.querySelector('.track-today');
  if (nextDay === undefined) tl.append(h('<p class="muted">' + (plan.blocks.length ? 'סיימת את כל הבלוקים שנשארו השבוע. כל הכבוד!' : 'כשתהיה תוכנית, הבלוקים של היום יופיעו כאן.') + '</p>'));
  else plan.blocks.filter(b => b.day === nextDay).forEach(b => tl.append(trackBlockRow(p, b, trackDayIso(plan.shownWeek, nextDay), true)));
  grid.append(td);
  pane.append(grid);

  // What to do next, from the material in the course folders.
  pane.append(h('<div class="card pad-lg track-card" data-tasks><div class="track-card-head"><h3>מה כדאי לעשות עכשיו</h3><small class="muted">מתוך החומר בתיקיות הקורסים</small></div><div class="track-tasks"></div></div>'));
  renderTrackTasks(pane);
}

// One block: the hours, the course and the goal, "done", and the other actions as small icons.
function trackBlockRow(p, b, iso, compact) {
  const row = h(`<div class="track-block${b.done ? ' done' : ''}"><span dir="ltr" class="track-time"></span><div class="grow"><b dir="auto"></b><small class="muted" dir="auto"></small></div><div class="track-block-acts"></div></div>`);
  row.querySelector('.track-time').textContent = b.start + '–' + trackClock(b.start, b.minutes);
  row.querySelector('b').textContent = b.course;
  // A goal that starts with its study method ("שיטת פיינמן: ...") shows the method in bold.
  // A few cards due go at the end of a block (study-track.js adds them after ", ובסוף הבלוק: "): they get a line of their own.
  const tailAt = b.goal.indexOf(', ובסוף הבלוק: '), goal = tailAt > 0 ? b.goal.slice(0, tailAt) : b.goal;
  const goalEl = row.querySelector('small'), cut = b.done ? -1 : goal.indexOf(':');
  if (cut > 0 && cut <= 24) { const m = document.createElement('b'); m.className = 'track-method'; m.textContent = goal.slice(0, cut + 1); goalEl.append(m, ' ' + goal.slice(cut + 1).trim()); }
  else goalEl.textContent = b.done ? 'בוצע · ' + minLabel(b.doneMinutes) : goal;
  goalEl.title = b.goal;
  if (tailAt > 0 && !b.done) { const t = h(`<small class="track-cards" dir="auto"><span data-ic="${TRACK_TASK_IC.review}"></span><span></span></small>`); const n = (/\d+/.exec(b.goal.slice(tailAt)) || [''])[0]; t.lastChild.textContent = n ? 'בסוף: ' + n + ' כרטיסיות לחזרה' : b.goal.slice(tailAt + 2); goalEl.after(t); if (typeof icons === 'function') icons(t); }
  const acts = row.querySelector('.track-block-acts');
  const btn = (label, cls, fn, ic, iconOnly) => { const x = h(`<button type="button" class="${cls} small${iconOnly ? ' icon-only' : ''}">${ic ? `<span data-ic="${ic}"></span>` : ''}</button>`); if (!iconOnly) x.append(document.createTextNode(label)); x.title = label; x.setAttribute('aria-label', label); x.onclick = fn; acts.append(x); };
  const chip = typeof sparksChip === 'function' ? sparksChip(S.track && S.track.sparks, b) : null;
  if (chip) acts.append(chip);
  if (b.done) { btn('בטל', 'ghost', () => trackSend({ op: 'undo', id: b.id }), 'back', true); return row; }
  btn('בוצע', 'soft', () => { S.sparkRect = row.getBoundingClientRect(); trackSend({ op: 'done', id: b.id }); }, 'check');
  if (S.blockOk && typeof openBlock === 'function') btn('מה לעשות בבלוק?', 'ghost', () => {
    const s = new Date(trackDate(iso)); const [hh, mm] = b.start.split(':').map(Number); s.setHours(hh, mm, 0, 0);
    openBlock({ title: (b.course + ' · ' + b.goal.split(':')[0]).slice(0, 110), start: s.getTime(), end: s.getTime() + b.minutes * 60000, uid: 'track-' + b.id });
  }, 'sparkles', true);
  if (compact) return row;
  btn('הוסף ל-Google Calendar', 'ghost', () => send({ type: 'exportTool', op: 'gcalBlock', id: b.id }), 'calendar', true);
  btn('ערוך', 'ghost', () => openBlockEditor(p, b.day, b), 'edit', true);
  btn('הסר', 'ghost', () => trackSend({ op: 'removeBlock', id: b.id }), 'x', true);
  return row;
}

// ---- The week: the days as cards, and the settings of "build" folded away.
function trackWeekPane(pane, t, p, st, plan) {
  const wk = h(`<div class="card pad-lg track-card"><div class="track-card-head"><h3></h3><span class="muted track-note" data-planinfo></span></div>
    <details class="track-build"><summary>הגדרות הבנייה: שעות, ימים וחלון היום</summary>
    <div class="row wrap track-fields"><label>שעות למידה בשבוע<input type="number" data-hours min="1" max="60" step="1" value="10"></label>
    <label>מ-<input type="time" data-from value="09:00"></label><label>עד<input type="time" data-to value="20:00"></label></div>
    <div class="coach-chips track-days" role="group" aria-label="ימי למידה"></div>
    <div class="row"><button class="primary" data-build><span data-ic="sparkles"></span>בנה לפי ההגדרות</button></div></details>
    <div class="track-days-grid"></div></div>`);
  wk.querySelector('h3').textContent = plan.next ? 'השבוע הבא שלי' : 'השבוע שלי';
  const info = wk.querySelector('[data-planinfo]');
  if (plan.old) info.textContent = 'התוכנית שנשמרה היא משבוע שעבר. אפשר לבנות שבוע חדש.';
  else if (plan.next) info.textContent = 'בנוי לשבוע הבא, כי הימים שנבחרו כבר עברו.';
  // The form of the week keeps its values when the page is drawn again; with a routine, it starts from it (and again after it changes).
  const rtKey = p.routine && p.routine.done ? JSON.stringify([p.routine.updated, p.routine.hours, p.routine.days, t.window]) : '';
  if (rtKey && S.trackFormFor !== rtKey) { S.trackFormFor = rtKey; S.trackForm = { hours: p.routine.hours, from: t.window.from, to: t.window.to }; S.trackDays = p.routine.days.slice(); }
  const form = S.trackForm || (S.trackForm = { hours: 10, from: '09:00', to: '20:00' });
  for (const k of ['hours', 'from', 'to']) { const el = wk.querySelector('[data-' + k + ']'); el.value = form[k]; el.onchange = () => { form[k] = el.value; }; }
  const days = wk.querySelector('.track-days');
  TRACK_DAYS.forEach((n, i) => {
    const b = h(`<button type="button" class="coach-chip" role="checkbox" aria-checked="${S.trackDays.includes(i)}"></button>`); b.textContent = n;
    b.onclick = () => { const on = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(on)); S.trackDays = on ? S.trackDays.concat(i) : S.trackDays.filter(x => x !== i); };
    days.append(b);
  });
  const det = wk.querySelector('.track-build'); det.open = !!S.trackBuildOpen || !plan.blocks.length; det.ontoggle = () => { S.trackBuildOpen = det.open; };
  wk.querySelector('[data-build]').onclick = () => trackBuild(p, plan);
  const grid = wk.querySelector('.track-days-grid');
  TRACK_DAYS.forEach((dn, d) => {
    const day = plan.blocks.filter(b => b.day === d);
    if (!day.length && d === 6) return; // an empty Saturday stays out of the way; the other days always offer "add"
    const iso = trackDayIso(plan.shownWeek, d), mins = day.reduce((s, b) => s + b.minutes, 0);
    const sec = h('<div class="track-day"><div class="track-day-head"><b></b><span class="muted"></span></div><div class="track-day-blocks"></div></div>');
    sec.classList.toggle('today', iso === t.today);
    sec.querySelector('b').textContent = 'יום ' + dn;
    sec.querySelector('span').textContent = trackDM(iso) + (iso === t.today ? ' · היום' : '') + (mins ? ' · ' + minLabel(mins) : '');
    const list = sec.querySelector('.track-day-blocks');
    for (const b of day) list.append(trackBlockRow(p, b, iso, false));
    if (!day.length) list.append(h('<p class="muted track-free">יום פנוי</p>'));
    const addB = h('<button type="button" class="ghost small track-add-block"><span data-ic="plus"></span>הוסף בלוק</button>');
    addB.onclick = () => openBlockEditor(p, d, null);
    sec.append(addB);
    grid.append(sec);
  });
  pane.append(wk);
}

// ---- Courses: a card for each, with its difficulty, energy, hours and exam.
function trackCoursesPane(pane, t, p) {
  const cc = h('<div class="card pad-lg track-card"><div class="track-card-head"><h3>הקורסים שלי</h3><small class="muted">ממערכת השעות, מלוח המבחנים ומהאפליקציה</small></div><div class="track-suggest" hidden></div><div class="track-courses"></div><div class="row track-add"><input type="text" data-new maxlength="120" placeholder="קורס חדש, למשל: מבני נתונים" class="grow"><button class="soft" data-addbtn><span data-ic="plus"></span>הוסף</button></div></div>');
  const sg = cc.querySelector('.track-suggest');
  if (t.suggested && t.suggested.length) {
    sg.hidden = false;
    sg.append(h('<div class="muted track-note">להוספה בלחיצה:</div>'));
    const wrap = h('<div class="coach-chips"></div>');
    for (const s of t.suggested.slice(0, 16)) { const b = h('<button type="button" class="coach-chip"></button>'); b.textContent = '+ ' + s.name; b.title = s.where; b.onclick = () => trackSend({ op: 'addCourses', courses: [s] }); wrap.append(b); }
    const all = h('<button type="button" class="coach-chip">הוסף הכל</button>'); all.onclick = () => trackSend({ op: 'addCourses', courses: t.suggested.slice(0, 20) }); wrap.append(all);
    sg.append(wrap);
  }
  const list = cc.querySelector('.track-courses');
  if (!p.courses.length) list.append(h('<p class="muted">עוד אין קורסים. הוסף קורס למטה, או לחץ על אחד מהמוצעים.</p>'));
  for (const c of p.courses) {
    const row = h(`<div class="track-course"><div class="track-course-head"><b class="grow" dir="auto"></b><span class="chip" data-examchip hidden></span></div>
      <div class="track-course-fields track-fields"><label>קושי<select data-level>${TRACK_LEVELS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
      <label>אנרגיה<select data-energy title="כמה ריכוז הקורס דורש: קורס שדורש הרבה נכנס לשעות שבהן יש לך הכי הרבה אנרגיה"><option value="1">נמוכה</option><option value="2">בינונית</option><option value="3">גבוהה</option></select></label>
      <label>שעות בשבוע<input type="number" data-hours min="0" max="30" step="0.5" placeholder="אוטומטי"></label>
      <label>מבחן<input type="date" data-exam></label></div>
      <div class="row wrap track-course-acts"><button class="soft small" data-how><span data-ic="sparkles"></span>איך ללמוד את זה?</button><button class="ghost small" data-topics><span data-ic="clipboard"></span>רמזור נושאים</button><span class="grow"></span><button class="ghost small icon-only" data-del aria-label="הסר קורס" title="הסר קורס"><span data-ic="trash"></span></button></div></div>`);
    row.querySelector('b').textContent = c.name;
    row.querySelector('[data-level]').value = String(c.level);
    row.querySelector('[data-energy]').value = String(c.energy || 2);
    row.querySelector('[data-hours]').value = c.hoursPerWeek || '';
    row.querySelector('[data-exam]').value = c.examDate || '';
    const fromTt = !c.examDate && c.examFromTimetable, chip = row.querySelector('[data-examchip]'), examDay = c.examDate || c.examFromTimetable;
    if (examDay) { const days = Math.round((trackDate(examDay) - trackDate(t.today)) / 86400000); if (days >= 0) { chip.hidden = false; chip.textContent = (fromTt ? 'מהמערכת: ' : '') + (days === 0 ? 'המבחן היום' : days === 1 ? 'המבחן מחר' : 'המבחן בעוד ' + days + ' ימים'); chip.classList.toggle('warn', days < 14); } }
    const edit = (values) => trackSend({ op: 'editCourse', course: c.name, values });
    row.querySelector('[data-level]').onchange = (e) => edit({ level: Number(e.target.value) });
    row.querySelector('[data-energy]').onchange = (e) => edit({ energy: Number(e.target.value) });
    row.querySelector('[data-hours]').onchange = (e) => edit({ hoursPerWeek: Number(e.target.value) || 0 });
    row.querySelector('[data-exam]').onchange = (e) => edit({ examDate: e.target.value });
    row.querySelector('[data-how]').onclick = () => openStrategy(c.name, !!p.strategies[c.name]);
    row.querySelector('[data-topics]').onclick = () => openTopics(c.name);
    const ctop = (p.progress[c.name] || { topics: [] }).topics;
    if (ctop.length) row.querySelector('[data-topics]').append(trackLightBar(ctop, true).bar);
    row.querySelector('[data-del]').onclick = () => trackSend({ op: 'removeCourse', course: c.name });
    list.append(row);
  }
  const add = () => { const i = cc.querySelector('[data-new]'), v = i.value.trim(); if (v) trackSend({ op: 'addCourses', courses: [{ name: v, manual: true }] }); };
  cc.querySelector('[data-addbtn]').onclick = add;
  cc.querySelector('[data-new]').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  pane.append(cc);
}

// ---- Progress: the last two weeks as columns, each course as a bar, and "log time".
function trackProgressPane(pane, t, p, st) {
  const grid = h('<div class="track-grid"></div>');
  const dc = h('<div class="card pad-lg track-card"><div class="track-card-head"><h3>14 הימים האחרונים</h3><small class="muted">דקות למידה ביום</small></div></div>');
  const byDay = {}; for (const e of p.log || []) byDay[e.date] = (byDay[e.date] || 0) + (Number(e.minutes) || 0);
  const items = [];
  for (let i = 13; i >= 0; i--) {
    const d = trackDate(t.today); d.setDate(d.getDate() - i); const iso = trackIso(d), m = byDay[iso] || 0;
    items.push({ label: TRACK_DAY_LETTERS[d.getDay()], sub: d.getDate() + '', value: m, part: m, today: i === 0, tip: TRACK_DAYS[d.getDay()] + ' ' + trackDM(iso) + ': ' + (m ? minLabel(m) : 'לא נרשם זמן') });
  }
  if (items.some(i => i.value)) dc.append(trackColumns(items, { min: 30, dense: true }));
  else dc.append(h('<p class="muted">עוד לא נרשם זמן. סמן בלוק כבוצע, או רשום זמן כאן למטה.</p>'));
  grid.append(dc);

  // Each course: this week and in all, as one bar on the same scale.
  const cp = h('<div class="card pad-lg track-card"><div class="track-card-head"><h3>לפי קורס</h3><small class="muted">סך הכל, והחלק של השבוע</small></div><div class="track-progress"></div></div>');
  const pg = cp.querySelector('.track-progress');
  if (!p.courses.length) pg.append(h('<p class="muted">ההתקדמות תופיע כאן אחרי שתוסיף קורסים ותסמן בלוקים כבוצעו.</p>'));
  const maxMin = Math.max(60, ...p.courses.map(c => (st.perCourse[c.name] || {}).total || 0));
  for (const c of p.courses) {
    const s = st.perCourse[c.name] || { week: 0, total: 0, topicsDone: 0, topics: 0 };
    const row = h('<div class="track-prow"><div class="track-prow-head"><b class="grow" dir="auto"></b><span class="muted" data-min></span><span class="chip" data-topicchip></span></div><div class="track-hbar"><i class="total"><i class="week"></i></i></div></div>');
    row.querySelector('b').textContent = c.name;
    row.querySelector('[data-min]').textContent = minLabel(s.total) + (s.week ? ' · השבוע ' + minLabel(s.week) : '');
    const tc = row.querySelector('[data-topicchip]'), ct = (p.progress[c.name] || { topics: [] }).topics;
    if (ct.length) { const { bar } = trackLightBar(ct, true); tc.replaceWith(bar); bar.onclick = () => openTopics(c.name); } else tc.hidden = true;
    const tot = row.querySelector('.total'); tot.style.width = (s.total ? Math.max(2, Math.round(s.total * 100 / maxMin)) : 0) + '%';
    tot.querySelector('.week').style.width = (s.total ? Math.round(Math.min(s.week, s.total) * 100 / s.total) : 0) + '%';
    trackTip(row.querySelector('.track-hbar'), c.name + ': ' + minLabel(s.total) + ' בסך הכל, ' + minLabel(s.week) + ' השבוע');
    pg.append(row);
  }
  if (p.courses.length) cp.append(trackLegend([['part', 'השבוע'], ['rest', 'לפני כן']]));
  grid.append(cp);
  pane.append(grid);

  const lg = h('<div class="card pad-lg track-card"><div class="track-card-head"><h3>רשום זמן שלמדת</h3></div><div class="row wrap track-fields track-log"><label>קורס<select data-course></select></label><label>דקות<input type="number" data-min min="1" max="600" step="5" value="30"></label><button class="soft" data-log><span data-ic="plus"></span>רשום</button></div></div>');
  for (const c of p.courses) { const o = document.createElement('option'); o.textContent = c.name; lg.querySelector('[data-course]').append(o); }
  lg.querySelector('[data-log]').onclick = () => { const course = lg.querySelector('[data-course]').value; if (course) trackSend({ op: 'log', course, minutes: Number(lg.querySelector('[data-min]').value) || 0 }); };
  lg.hidden = !p.courses.length;
  pane.append(lg);
}

// ---- Tools that take the material to other places, and the profile (name, export, import).
function trackToolsPane(pane, t, p) {
  const tl = h(`<div class="card pad-lg track-card"><div class="track-card-head"><h3>ללמוד גם במקומות אחרים</h3><small class="muted">הקבצים נשמרים אצלך, ושום דבר לא נשלח לשום שירות</small></div>
    <label class="track-tool-course">קורס<select data-course><option value="">כל הקורסים (ל-Anki)</option></select></label>
    <div class="track-tools">
      <div class="track-tool" data-calsync-card><div class="track-tool-head"><span class="ic" data-ic="refresh"></span><b>סנכרון ליומן</b></div><small class="muted">כל שינוי בבלוקים נכתב מיד ליומן של המק (Calendar). אם היומן שייך לחשבון Google שלך, השינוי מגיע משם גם ל-Google Calendar.</small><div class="track-calsync" data-calsync></div></div>
      <div class="track-tool"><div class="track-tool-head"><span class="ic" data-ic="calendar"></span><b>יומן, ידנית</b></div><small class="muted">הבלוקים של השבוע ל-Google Calendar פעם אחת, עם תזכורת 10 דקות לפני. או כקובץ iCal.</small><div class="row wrap"><button class="soft" data-gcal>ל-Google Calendar</button><button class="ghost small" data-ics>קובץ iCal</button></div></div>
      <div class="track-tool"><div class="track-tool-head"><span class="ic" data-ic="book"></span><b>NotebookLM</b></div><small class="muted">תיקייה עם הסיכומים, המידע על הקורס והכרטיסים, להעלאה ל-NotebookLM לסיכום קולי ושאלות.</small><button class="soft" data-nb>הכן חבילה</button></div>
      <div class="track-tool" data-icloud-card><div class="track-tool-head"><span class="ic" data-ic="cloud"></span><b>iPad</b></div><small class="muted">הסיכומים והכרטיסים של הקורס ל-iCloud Drive/SumIT, לאפליקציה באייפד או ל-Notability ו-Goodnotes. קובץ שסימנת עליו באייפד לא נדרס.</small><button class="soft" data-icloud></button><small class="track-icloud-status" data-icloud-status aria-live="polite" dir="auto"></small><button class="ghost small" data-icloud-reveal hidden>הצג ב-Finder</button></div>
      <div class="track-tool"><div class="track-tool-head"><span class="ic" data-ic="brain"></span><b>Anki</b></div><small class="muted">כרטיסי הזיכרון כקובץ לייבוא ל-Anki, לחזרה גם בטלפון.</small><button class="soft" data-anki>ייצוא כרטיסים</button></div>
    </div></div>`);
  const sel = tl.querySelector('[data-course]');
  for (const c of p.courses) { const o = document.createElement('option'); o.textContent = c.name; sel.append(o); }
  if (S.trackToolCourse && p.courses.some(c => c.name === S.trackToolCourse)) sel.value = S.trackToolCourse;
  sel.onchange = () => { S.trackToolCourse = sel.value; };
  const tool = (op, needCourse) => () => {
    if (needCourse && !sel.value) { toast('בחר קורס', { error: true }); return; }
    send({ type: 'exportTool', op, course: sel.value });
  };
  tl.querySelector('[data-gcal]').onclick = tool('gcal', false);
  tl.querySelector('[data-ics]').onclick = tool('ics', false);
  tl.querySelector('[data-nb]').onclick = tool('notebook', true);
  tl.querySelector('[data-anki]').onclick = tool('anki', false);
  tl.querySelector('[data-icloud]').onclick = tool('icloud', true);
  pane.append(tl);

  const pf = h(`<div class="card pad-lg track-card"><div class="track-card-head"><h3>הפרופיל שלי</h3><small class="muted">נשמר רק במחשב הזה. כדי להעביר למחשב אחר: ייצוא, ואז ייבוא שם.</small></div>
    <div class="row wrap track-fields"><label class="grow">איך לקרוא לך?<input type="text" data-name maxlength="60" placeholder="השם שלך (לא חובה)"></label>
    <button class="soft" data-export><span data-ic="download"></span>ייצוא ההתקדמות</button><button class="ghost" data-import><span data-ic="file"></span>ייבוא</button></div></div>`);
  pf.querySelector('[data-name]').value = p.name || '';
  pf.querySelector('[data-name]').onchange = (e) => trackSend({ op: 'name', value: e.target.value });
  pf.querySelector('[data-export]').onclick = () => trackSend({ op: 'export' });
  pf.querySelector('[data-import]').onclick = () => trackSend({ op: 'import' });
  pane.append(pf);
}

// How to study one course: a summary, the steps, the weekly habits, and what to avoid. Built by the AI when one is connected, and by rules when not.
function openStrategy(course, cached) {
  if (trackStrategyRun) return;
  const dialog = h(`<dialog class="summary-options coach-dialog" dir="rtl" aria-labelledby="trackStratTitle">
    <div class="row"><h2 id="trackStratTitle" class="grow"></h2><button class="ghost small" data-close aria-label="סגור">×</button></div>
    <div data-busy><div class="coach-busy"><span data-ic="spin"></span><b>בונה אסטרטגיה לקורס...</b></div><div class="skeleton" style="height:56px;border-radius:14px;margin:10px 0"></div><div class="skeleton" style="height:56px;border-radius:14px;margin:10px 0"></div></div>
    <div data-result hidden><p data-summary></p><div data-steps></div><div data-week></div><div data-routine></div><div data-avoid></div><p class="muted" data-source></p>
    <div class="row wrap coach-actions"><button class="soft" data-again><span data-ic="refresh"></span>בנה מחדש</button><div class="grow"></div><button class="ghost" data-close>סגור</button></div></div>
  </dialog>`);
  dialog.querySelector('#trackStratTitle').textContent = 'איך ללמוד: ' + course;
  document.body.append(dialog);
  const $d = (s) => dialog.querySelector(s);
  const view = (name) => { $d('[data-busy]').hidden = name !== 'busy'; $d('[data-result]').hidden = name !== 'result'; };
  icons(dialog);
  const list = (title, items, cls) => { const el = $d(cls); el.innerHTML = ''; if (!items || !items.length) return; el.append(h('<h3 class="track-h3"></h3>')); el.firstChild.textContent = title; const ul = h('<ul class="track-ul"></ul>'); items.forEach(x => { const li = document.createElement('li'); li.textContent = x; ul.append(li); }); el.append(ul); };
  trackStrategyRun = {
    course,
    show(m) {
      if (m.error) { dialog.close(); toast(m.error, { error: true }); return; }
      const s = m.strategy;
      $d('[data-summary]').textContent = s.summary;
      const box = $d('[data-steps]'); box.innerHTML = '';
      s.steps.forEach((x, i) => {
        const row = h(`<div class="coach-step" style="--i:${i}"><span class="chip accent">${i + 1}</span><div class="grow"><b dir="auto"></b><small class="muted" dir="auto"></small></div></div>`);
        row.querySelector('b').textContent = x.title; row.querySelector('small').textContent = x.detail; box.append(row);
      });
      list('השבוע הזה', s.thisWeek, '[data-week]'); list('הרגלים קבועים לשבוע', s.routine, '[data-routine]'); list('כדאי להימנע', s.avoid, '[data-avoid]');
      $d('[data-source]').textContent = s.source === 'ai' ? 'נבנה לפי הקורס והנתונים שהאפליקציה מכירה.' : 'נבנה לפי כללים, כי אין AI מחובר או שהוא לא ענה.';
      view('result'); icons(dialog);
    },
  };
  const ask = (refresh) => { view('busy'); trackSend({ op: 'strategy', course, refresh: !!refresh }); };
  dialog.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dialog.close(); });
  dialog.addEventListener('close', () => { dialog.remove(); trackStrategyRun = null; });
  $d('[data-again]').onclick = () => ask(true);
  dialog.showModal();
  ask(false);
}

// The topics of a course as a traffic light, before an exam: green known, yellow needs work, red not known. The student sets the
// color (a click, or 1 2 3 on a focused row); the host suggests topics (one for each lecture, and the syllabus's) and a hint where
// a quiz or the cards disagree with the color. Topics can be joined, renamed, and given the lectures they cover.
const TRACK_LIGHTS = [['green', 'יודע', '1'], ['yellow', 'טעון שיפור', '2'], ['red', 'לא יודע', '3']];
const trackLightEmo = { green: '🟢', yellow: '🟡', red: '🔴', '': '⚪' };
S.trackTopics = {};   // course -> the last suggestions and hints of the host
function trackLightBar(topics, small) {
  const n = { green: 0, yellow: 0, red: 0, '': 0 }; topics.forEach(t => { n[t.light || '']++; });
  const bar = h(`<div class="light-bar${small ? ' small' : ''}" role="img"></div>`);
  const all = Math.max(1, topics.length);
  for (const k of ['green', 'yellow', 'red', '']) if (n[k]) { const i = h(`<i class="lb-${k || 'none'}"></i>`); i.style.flexGrow = n[k] / all; bar.append(i); }
  bar.setAttribute('aria-label', `ירוק ${n.green}, צהוב ${n.yellow}, אדום ${n.red}` + (n[''] ? `, לא דורגו ${n['']}` : ''));
  bar.title = bar.getAttribute('aria-label');
  return { bar, n };
}
// "לקראת המבחנים": each course with an exam ahead (or with topics), its colors, what got better this week, and the quick round.
function trackExamsCard(lights) {
  const list = (lights || []).filter(x => x.examDays !== null || x.topics).slice(0, 6);
  if (!list.length) return null;
  const c = h('<div class="card pad-lg track-card exams-card"><div class="track-card-head"><h3>לקראת המבחנים</h3><small class="muted">רמזור הנושאים של כל קורס</small></div><div data-rows></div></div>');
  for (const x of list) {
    const row = h(`<div class="exam-row${x.round ? ' due' : ''}"><div class="exam-when"><b></b><small></small></div><div class="grow exam-main"><b dir="auto"></b><div data-bar></div><small class="muted" data-sub></small></div><div class="exam-acts"></div></div>`);
    row.querySelector('.exam-main b').textContent = x.course;
    const when = row.querySelector('.exam-when');
    if (x.examDays === null) { when.querySelector('b').textContent = '—'; when.querySelector('small').textContent = 'אין תאריך'; }
    else { when.querySelector('b').textContent = x.examDays === 0 ? 'היום' : x.examDays; when.querySelector('small').textContent = x.examDays === 0 ? 'המבחן' : x.examDays === 1 ? 'יום' : 'ימים'; when.classList.toggle('near', x.examDays <= 14); }
    const topics = ((S.track.profile.progress[x.course]) || { topics: [] }).topics;
    const sub = row.querySelector('[data-sub]');
    if (topics.length) {
      row.querySelector('[data-bar]').append(trackLightBar(topics).bar);
      setEmo(sub, `🟢 ${x.green} · 🟡 ${x.yellow} · 🔴 ${x.red}` + (x.none ? ` · ⚪ ${x.none}` : '') + (x.better ? ` · ⬆️ ${x.better === 1 ? 'נושא אחד השתפר' : x.better + ' נושאים השתפרו'} השבוע` : ''));
    } else sub.textContent = 'עוד אין נושאים. אפשר לקבל הצעה מההרצאות ומהסילבוס.';
    const acts = row.querySelector('.exam-acts');
    if (x.round) { const b = h('<button class="primary small"><span data-ic="sparkles"></span>סבב רמזור</button>'); b.title = 'דרג את הנושאים, דקה אחת'; b.onclick = () => openLightRound(x.course); acts.append(b); }
    const o = h(`<button class="ghost small">${topics.length ? 'כל הנושאים' : 'הצע נושאים'}</button>`); o.onclick = () => openTopics(x.course); acts.append(o);
    c.querySelector('[data-rows]').append(row);
  }
  icons(c);
  return c;
}

// The quick round: one topic at a time, big, rated with a click or 1 2 3; the ones not rated, then the oldest rated. About a minute.
function openLightRound(course) {
  const all = ((S.track.profile.progress[course]) || { topics: [] }).topics;
  const weekAgo = trackIso(new Date(Date.now() - 7 * 86400000));
  const queue = all.filter(t => !t.light || !t.rated || t.rated < weekAgo).sort((a, b) => (a.light ? 1 : 0) - (b.light ? 1 : 0) || String(a.rated).localeCompare(String(b.rated)));
  if (!queue.length) { openTopics(course); return; }
  const dialog = h(`<dialog class="summary-options coach-dialog light-round" dir="rtl" aria-labelledby="lightRoundTitle">
    <div class="row"><h2 id="lightRoundTitle" class="grow"></h2><button class="ghost small" data-close aria-label="סגור">×</button></div>
    <div class="round-prog"><i></i></div><div data-body></div></dialog>`);
  dialog.querySelector('h2').textContent = 'סבב רמזור: ' + course;
  document.body.append(dialog);
  let i = 0;
  const done = [];
  const draw = () => {
    const body = dialog.querySelector('[data-body]'); body.innerHTML = '';
    dialog.querySelector('.round-prog i').style.width = Math.round(i / queue.length * 100) + '%';
    if (i >= queue.length) {
      const fin = h('<div class="round-end"><p class="round-big"></p><div data-bar></div><p class="muted" data-txt></p><div class="row" style="gap:8px;justify-content:center"><button class="primary" data-close>סיימתי</button><button class="ghost" data-all>לכל הנושאים</button></div></div>');
      setEmo(fin.querySelector('.round-big'), '✅ דירגת ' + done.length + ' נושאים');
      const now = ((S.track.profile.progress[course]) || { topics: [] }).topics;
      fin.querySelector('[data-bar]').append(trackLightBar(now).bar);
      const red = done.filter(x => x === 'red').length;
      fin.querySelector('[data-txt]').textContent = red ? 'האדומים ייכנסו לבלוקים העמוקים כשתבנה את השבוע מחדש.' : 'אין אדומים בסבב הזה. יפה!';
      fin.querySelector('[data-all]').onclick = () => { dialog.close(); openTopics(course); };
      fin.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dialog.close(); });
      body.append(fin); return;
    }
    const t = queue[i];
    const card = h(`<div class="round-card"><small class="muted" data-n></small><b class="round-title" dir="auto"></b><small class="muted" data-lec></small>
      <div class="round-btns"></div><button class="ghost small" data-skip>דלג</button><small class="muted">מקשים: 1 יודע · 2 טעון שיפור · 3 לא יודע</small></div>`);
    card.querySelector('[data-n]').textContent = (i + 1) + ' מתוך ' + queue.length + (t.light ? ' · עכשיו ' + { green: 'ירוק', yellow: 'צהוב', red: 'אדום' }[t.light] : '');
    card.querySelector('.round-title').textContent = t.title;
    card.querySelector('[data-lec]').textContent = t.lectures && t.lectures.length ? (t.lectures.length === 1 ? 'הרצאה ' : 'הרצאות ') + t.lectures.join(', ') : '';
    for (const [k, label, key] of TRACK_LIGHTS) {
      const b = h(`<button class="round-btn rb-${k}"><i></i><span></span><kbd></kbd></button>`);
      b.querySelector('span').textContent = label; b.querySelector('kbd').textContent = key;
      b.onclick = () => pick(k);
      card.querySelector('.round-btns').append(b);
    }
    card.querySelector('[data-skip]').onclick = () => { i++; draw(); };
    body.append(card);
  };
  // The same color again is still a rating: the date moves, and the host keeps it.
  const pick = (k) => { const t = queue[i]; trackSend({ op: 'topic', course, act: 'light', id: t.id, light: k, again: true }); done.push(k); i++; draw(); };
  const onKey = (e) => { const k = TRACK_LIGHTS.find(x => x[2] === e.key); if (k && i < queue.length) { e.preventDefault(); pick(k[0]); } };
  dialog.addEventListener('keydown', onKey);
  dialog.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove());
  draw(); dialog.showModal();
}

function openTopics(course) {
  const dialog = h(`<dialog class="summary-options coach-dialog topics-dialog" dir="rtl" aria-labelledby="trackTopicsTitle">
    <div class="row"><h2 id="trackTopicsTitle" class="grow"></h2><button class="ghost small" data-close aria-label="סגור">×</button></div>
    <p class="muted">סמן כל נושא לפי מה שאתה יודע: 🟢 יודע, 🟡 טעון שיפור, 🔴 לא יודע. האדומים יקבלו בלוקים עמוקים, הצהובים בלוקים קצרים.</p>
    <div class="topics-sum" data-sum></div><div data-hints></div><div class="topics-list" data-list></div>
    <div class="row wrap topics-tools"><button class="soft small" data-suggest><span data-ic="sparkles"></span>הצע נושאים מההרצאות ומהסילבוס</button>
      <button class="ghost small" data-merge hidden><span data-ic="link"></span>אחד נבחרים</button></div>
    <div data-suggestions></div>
    <div class="row track-add"><input type="text" class="grow" data-new maxlength="100" placeholder="נושא חדש, למשל: משוואות מסדר שני"><button class="soft" data-add><span data-ic="plus"></span>הוסף</button></div>
    <div class="row wrap coach-actions"><small class="muted grow">טיפ: עמוד על שורה והקש 1, 2 או 3.</small><button class="ghost" data-close>סגור</button></div></dialog>`);
  dialog.querySelector('#trackTopicsTitle').textContent = 'רמזור הנושאים: ' + course;
  document.body.append(dialog);
  const picked = new Set();
  let wanted = null;   // the suggestions ticked to add
  const offered = new Set();   // the suggestions shown already (one the student unticked stays unticked)
  const topicsOf = () => ((S.track && S.track.profile.progress[course]) || { topics: [] }).topics;
  const setLight = (t, light) => trackSend({ op: 'topic', course, act: 'light', id: t.id, light: t.light === light ? '' : light });
  const draw = () => {
    const topics = topicsOf(), info = S.trackTopics[course] || {};
    const sum = dialog.querySelector('[data-sum]'); sum.innerHTML = '';
    if (topics.length) {
      const { bar, n } = trackLightBar(topics);
      const legend = h('<div class="topics-legend"></div>');
      setEmo(legend, `🟢 ${n.green} · 🟡 ${n.yellow} · 🔴 ${n.red}` + (n[''] ? ` · ⚪ ${n['']} לא דורגו` : ''));
      sum.append(bar, legend);
    }
    // The hints: where a quiz or the cards say something else than the color.
    const hb = dialog.querySelector('[data-hints]'); hb.innerHTML = '';
    for (const t of topics) {
      const x = (info.hints || {})[t.id]; if (!x || x.light === t.light) continue;
      const row = h('<div class="topic-hint"><span class="grow" dir="auto"></span><button class="soft small"></button><button class="ghost small" aria-label="התעלם">×</button></div>');
      setEmo(row.querySelector('span'), trackLightEmo[x.light] + ' ' + t.title + ': ' + x.text);
      const [ok, no] = row.querySelectorAll('button');
      ok.textContent = 'סמן ' + { green: 'ירוק', yellow: 'צהוב', red: 'אדום' }[x.light];
      ok.onclick = () => { delete info.hints[t.id]; setLight(Object.assign({}, t, { light: '' }), x.light); };
      no.onclick = () => { delete info.hints[t.id]; draw(); };
      hb.append(row);
    }
    const box = dialog.querySelector('[data-list]'); box.innerHTML = '';
    if (!topics.length) box.append(h('<p class="muted">עוד אין נושאים. אפשר לקבל הצעה מההרצאות ומהסילבוס, או להוסיף לבד.</p>'));
    for (const t of topics) {
      const row = h(`<div class="topic-row light-${t.light || 'none'}" tabindex="0"><input type="checkbox" aria-label="בחר לאיחוד"><div class="topic-lights" role="radiogroup"></div>
        <div class="grow topic-main"><span class="topic-title" dir="auto"></span><small class="muted" data-lec></small></div>
        <button type="button" class="ghost small icon-only" data-edit aria-label="ערוך"><span data-ic="edit"></span></button><button type="button" class="ghost small" data-remove aria-label="הסר">×</button></div>`);
      row.querySelector('.topic-title').textContent = t.title;
      row.querySelector('[data-lec]').textContent = t.lectures && t.lectures.length ? (t.lectures.length === 1 ? 'הרצאה ' : 'הרצאות ') + t.lectures.join(', ') : '';
      const lights = row.querySelector('.topic-lights');
      lights.setAttribute('aria-label', 'הצבע של ' + t.title);
      for (const [k, label, key] of TRACK_LIGHTS) {
        const b = h(`<button type="button" class="topic-light lt-${k}" role="radio"></button>`);
        b.setAttribute('aria-checked', String(t.light === k)); b.title = label + ' (' + key + ')'; b.setAttribute('aria-label', label);
        b.onclick = () => setLight(t, k);
        lights.append(b);
      }
      row.onkeydown = (e) => { const k = TRACK_LIGHTS.find(x => x[2] === e.key); if (k && e.target === row) { e.preventDefault(); setLight(t, k[0]); } };
      const cb = row.querySelector('input'); cb.checked = picked.has(t.id);
      cb.onchange = () => { cb.checked ? picked.add(t.id) : picked.delete(t.id); dialog.querySelector('[data-merge]').hidden = picked.size < 2; };
      row.querySelector('[data-remove]').onclick = () => trackSend({ op: 'topic', course, act: 'remove', id: t.id });
      row.querySelector('[data-edit]').onclick = () => {
        const title = prompt('שם הנושא:', t.title); if (title === null) return;
        const lec = prompt('ההרצאות שהנושא מכסה (מספרים, מופרדים בפסיק):', (t.lectures || []).join(', ')); if (lec === null) return;
        if (title.trim() && title.trim() !== t.title) trackSend({ op: 'topic', course, act: 'rename', id: t.id, title: title.trim() });
        trackSend({ op: 'topic', course, act: 'lectures', id: t.id, lectures: lec.split(/[^\d]+/).filter(Boolean).map(Number) });
      };
      box.append(row);
    }
    dialog.querySelector('[data-merge]').hidden = picked.size < 2;
    // The suggestions of the host, ticked by default; only the ones not added yet.
    const sg = dialog.querySelector('[data-suggestions]'); sg.innerHTML = '';
    const have = new Set(topics.map(t => t.title));
    const items = [...(info.lectures || []), ...(info.syllabus || [])].filter(x => !have.has(x.title));
    if (info.reading) sg.append(h('<p class="muted topics-reading">קורא את הסילבוס...</p>'));
    if (items.length) {
      if (!wanted) wanted = new Set();
      for (const x of items) if (!offered.has(x.title)) { offered.add(x.title); wanted.add(x.title); }   // a new suggestion comes ticked
      const card = h('<div class="topics-suggest"><b>הצעות</b><div data-items></div><div class="row" style="gap:8px"><button class="primary small" data-addsel></button><button class="ghost small" data-dismiss>לא עכשיו</button></div></div>');
      for (const x of items) {
        const r = h('<label class="topic-sugg"><input type="checkbox"><span class="grow" dir="auto"></span><small class="muted"></small></label>');
        r.querySelector('input').checked = wanted.has(x.title);
        r.querySelector('input').onchange = (e) => { e.target.checked ? wanted.add(x.title) : wanted.delete(x.title); upd(); };
        r.querySelector('span').textContent = x.title;
        r.querySelector('small').textContent = (x.source === 'syllabus' ? 'מהסילבוס' : 'מההרצאות') + (x.lectures && x.lectures.length ? ' · ' + x.lectures.join(', ') : '');
        card.querySelector('[data-items]').append(r);
      }
      const btn = card.querySelector('[data-addsel]'), upd = () => { btn.textContent = 'הוסף ' + wanted.size + ' נושאים'; btn.disabled = !wanted.size; };
      upd();
      btn.onclick = () => { trackSend({ op: 'topic', course, act: 'addMany', items: items.filter(x => wanted.has(x.title)) }); info.lectures = []; info.syllabus = []; wanted = null; };
      card.querySelector('[data-dismiss]').onclick = () => { info.lectures = []; info.syllabus = []; wanted = null; draw(); };
      sg.append(card);
    } else if (info.asked && !info.reading) sg.append(h('<p class="muted">אין הצעות חדשות: כל ההרצאות כבר מכוסות בנושאים.</p>'));
    icons(dialog);
  };
  dialog.querySelector('[data-suggest]').onclick = () => { S.trackTopics[course] = Object.assign(S.trackTopics[course] || {}, { asked: true, reading: true }); wanted = null; offered.clear(); trackSend({ op: 'topicsSuggest', course, syllabus: true }); draw(); };
  dialog.querySelector('[data-merge]').onclick = () => { trackSend({ op: 'topic', course, act: 'merge', ids: topicsOf().filter(t => picked.has(t.id)).map(t => t.id) }); picked.clear(); };
  const add = () => { const i = dialog.querySelector('[data-new]'), v = i.value.trim(); if (v) { trackSend({ op: 'topic', course, act: 'add', title: v }); i.value = ''; } };
  dialog.querySelector('[data-add]').onclick = add;
  dialog.querySelector('[data-new]').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  dialog.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dialog.close(); });
  const onTopics = (e) => { if (e.detail && e.detail.course === course) draw(); };
  dialog.addEventListener('close', () => { window.removeEventListener('sumit-track', draw); window.removeEventListener('sumit-track-topics', onTopics); dialog.remove(); });
  window.addEventListener('sumit-track', draw);
  window.addEventListener('sumit-track-topics', onTopics);
  // The hints come with the first answer, without reading the syllabus (that waits for the button).
  S.trackTopics[course] = Object.assign(S.trackTopics[course] || {}, { reading: false });
  trackSend({ op: 'topicsSuggest', course, syllabus: false });
  draw(); dialog.showModal();
}

// One block made or changed by hand. The day is the one the student clicked on, and can be changed here.
// The tasks card: drawn when the page is drawn and again when the host answers (it reads the folders, so it may take a moment).
function renderTrackTasks(root) {
  const card = (root || document).querySelector('[data-tasks]'); if (!card || !S.track) return;
  const list = card.querySelector('.track-tasks'); list.innerHTML = '';
  const m = S.trackTasks, p = S.track.profile;
  if (!m) { list.append(h('<div class="coach-busy"><span data-ic="spin"></span><b>קורא את תיקיות הקורסים...</b></div>')); icons(card); return; }
  if (!m.tasks.length) { list.append(h('<p class="muted">' + (p.courses.length ? 'אין כרגע משימה שעולה מהתיקיות: כל ההרצאות מסוכמות, אין כרטיסים לחזרה ואין הגשה קרובה. כל הכבוד.' : 'הוסף קורסים למסלול, ואם יש להם תיקייה באפליקציה, המשימות יופיעו כאן.') + '</p>')); return; }
  const todayDay = trackDate(S.track.today).getDay();
  const shown = S.trackAllTasks ? m.tasks : m.tasks.slice(0, 3);
  for (const t of shown) {
    const row = h(`<div class="today-row track-task"><span class="ic" data-ic="${TRACK_TASK_IC[t.kind] || 'check'}"></span><div class="grow"><b dir="auto"></b><small class="muted" dir="auto"></small></div><span class="chip"></span></div>`);
    row.querySelector('b').textContent = t.title;
    row.querySelector('small').textContent = t.course + ' · ' + t.why;
    row.querySelector('.chip').textContent = minLabel(t.minutes);
    const btn = (label, fn, ic) => { const x = h(`<button class="ghost small"><span data-ic="${ic}"></span>${label}</button>`); x.onclick = fn; row.append(x); };
    // Making a summary or transcribing is done by the app, not in a study block.
    if (p.courses.some(c => c.name === t.course) && t.kind !== 'summary' && t.kind !== 'transcribe') btn('לבלוק', () => openBlockEditor(p, todayDay, null, { course: t.course, goal: t.title, minutes: Math.max(15, Math.min(240, t.minutes)) }), 'plus');
    const c = (S.courses || []).find(x => x.name === t.folder || x.name === t.course);
    if (c && typeof openCourse === 'function') btn('לקורס', () => openCourse(c), 'book');
    list.append(row);
  }
  if (m.tasks.length > 3) { const more = h('<button type="button" class="ghost small track-more"></button>'); more.textContent = S.trackAllTasks ? 'הצג פחות' : 'הצג עוד ' + (m.tasks.length - 3); more.onclick = () => { S.trackAllTasks = !S.trackAllTasks; renderTrackTasks(); }; list.append(more); }
  if (S.trackAllTasks && m.total > m.tasks.length) { const more = h('<p class="muted track-note"></p>'); more.textContent = 'ועוד ' + (m.total - m.tasks.length) + ' משימות. הן נכנסות כמטרות לבלוקים כשבונים שבוע.'; list.append(more); }
  icons(card);
}

function openBlockEditor(profile, day, block, preset) {
  if (!profile.courses.length) { toast('קודם הוסף קורסים', { error: true }); return; }
  const dialog = h(`<dialog class="summary-options" dir="rtl" aria-labelledby="trackBlockTitle"><form method="dialog">
    <h2 id="trackBlockTitle"></h2>
    <div class="row wrap track-fields"><label>קורס<select data-course></select></label><label>יום<select data-day></select></label>
    <label>שעת התחלה<input type="time" data-start class="ltr"></label><label>דקות<input type="number" data-min min="10" max="240" step="5"></label></div>
    <label class="track-goal">מה עושים בבלוק<input data-goal maxlength="200" placeholder="למשל: תרגיל 3 מהשיעורי בית"></label>
    <div class="row"><button type="submit" class="primary">שמור</button><button type="button" class="ghost" data-cancel>ביטול</button>${block ? '<div class="grow"></div><button type="button" class="ghost" data-del>מחק בלוק</button>' : ''}</div>
  </form></dialog>`);
  dialog.querySelector('#trackBlockTitle').textContent = block ? 'עריכת בלוק' : 'בלוק חדש ליום ' + TRACK_DAYS[day];
  const $d = (x) => dialog.querySelector(x);
  profile.courses.forEach(c => { const o = document.createElement('option'); o.value = c.name; o.textContent = c.name; $d('[data-course]').append(o); });
  TRACK_DAYS.forEach((n, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = 'יום ' + n; $d('[data-day]').append(o); });
  $d('[data-course]').value = block ? block.course : preset && profile.courses.some(c => c.name === preset.course) ? preset.course : profile.courses[0].name;
  $d('[data-day]').value = String(day);
  $d('[data-start]').value = block ? block.start : '17:00';
  $d('[data-min]').value = block ? block.minutes : preset && preset.minutes ? preset.minutes : 60;
  $d('[data-goal]').value = block ? block.goal : preset && preset.goal ? preset.goal : '';
  document.body.append(dialog);
  $d('[data-cancel]').onclick = () => dialog.close();
  if (block) $d('[data-del]').onclick = () => { trackSend({ op: 'removeBlock', id: block.id }); dialog.close(); };
  $d('form').onsubmit = (e) => {
    e.preventDefault();
    trackSend({ op: 'blockSave', id: block ? block.id : '', course: $d('[data-course]').value, day: Number($d('[data-day]').value), start: $d('[data-start]').value || '17:00', minutes: Number($d('[data-min]').value) || 60, goal: $d('[data-goal]').value });
    dialog.close();
  };
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}


// ---- The streak, as in Duolingo: a day counts when a block or a topic was finished in it.
const streakDays = (n) => n === 1 ? 'יום אחד' : n + ' ימים';
const STREAK_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

// The flame in the header: lit when today counts, gray while the streak waits for today.
function streakBadge(si) {
  const b = h('<div class="streak-badge" role="img"><span class="streak-flame"></span><b></b></div>');
  b.classList.toggle('lit', si.todayDone); b.classList.toggle('cold', !si.current);
  b.querySelector('.streak-flame').innerHTML = emo('🔥', true); b.querySelector('b').textContent = si.current;
  b.setAttribute('aria-label', 'רצף של ' + streakDays(si.current) + (si.todayDone ? ', היום כבר נספר' : si.atRisk ? ', עוד לא נשמר היום' : ''));
  b.title = si.todayDone ? 'היום כבר נספר ברצף' : si.atRisk ? 'סיים היום בלוק או נושא כדי לשמור על הרצף' : 'סיים בלוק או נושא כדי להתחיל רצף';
  b.onclick = () => { S.trackTab = 'overview'; renderTrack(); };
  return b;
}

// The streak card on the overview: the flame and the number, what to do today, the days of this week, the freezes and the next milestone.
function streakCard(si, sp) {
  const c = h(`<div class="card pad-lg streak-card"><div class="streak-main"><div class="streak-big"><span class="streak-flame"></span><b></b></div>
    <div class="streak-text"><h3></h3><p class="muted"></p></div><div class="streak-side"><span class="streak-freeze" data-freeze></span><small class="muted" data-best></small></div></div>
    <div class="streak-week"></div><div class="streak-goal"><div class="streak-bar"><i></i></div><small class="muted" data-next></small></div></div>`);
  c.classList.toggle('lit', si.todayDone); c.classList.toggle('risk', si.atRisk);
  c.querySelector('.streak-flame').innerHTML = emo('🔥', true);
  c.querySelector('.streak-big b').textContent = si.current;
  c.querySelector('h3').textContent = si.current ? 'רצף של ' + streakDays(si.current) : 'מתחילים רצף';
  setEmo(c.querySelector('p'), si.todayDone ? 'כל הכבוד! היום כבר נספר. נתראה מחר 👋'
    : si.atRisk ? 'הרצף בסכנה: סיים היום בלוק לימוד או סמן נושא שהשלמת.' + (si.freezes ? ' אם לא, 🧊 אחד ישמור עליו.' : sp && sp.lost ? ' אם לא, יירדו ' + sp.lost.perDay + ' ✨.' : '')
    : 'סיים בלוק לימוד או סמן נושא שהשלמת, והלהבה נדלקת.');
  // Sparks lost yesterday, a day with nothing done that no freeze covered.
  if (sp && sp.lost && sp.lost.yesterday) {
    const l = h('<p class="streak-lost" role="status"></p>');
    setEmo(l, '−' + sp.lost.yesterday + ' ✨ אתמול לא נעשתה פעילות, ולא הייתה הקפאה שתשמור על הרצף.');
    c.querySelector('.streak-text').append(l);
  }
  const fz = c.querySelector('[data-freeze]');
  fz.innerHTML = emo('🧊') + ' ' + si.freezes; fz.title = 'הקפאות רצף: כל 7 ימים ברצף נותנים אחת (עד 2). הקפאה שומרת על הרצף ביום שפספסת.';
  fz.classList.toggle('none', !si.freezes);
  fz.classList.toggle('used', si.week.some(d => d.state === 'frozen'));
  c.querySelector('[data-best]').textContent = 'שיא: ' + streakDays(si.best);
  const week = c.querySelector('.streak-week');
  si.week.forEach((d, i) => {
    const cell = h('<div class="streak-day"><small></small><span></span></div>');
    const isToday = d.date === S.track.today;
    cell.classList.add(d.state); cell.classList.toggle('is-today', isToday);
    cell.style.setProperty('--i', i);
    cell.querySelector('small').textContent = isToday ? 'היום' : STREAK_LETTERS[d.dow !== undefined ? d.dow : i];
    cell.querySelector('span').innerHTML = isToday && d.state === 'done' ? emo('🔥') : { done: '✓', frozen: emo('🧊'), missed: '', today: '', future: '' }[d.state];
    cell.title = trackDM(d.date) + ' · ' + { done: 'נספר', frozen: 'נשמר בהקפאה', missed: 'לא נספר', today: 'היום: עוד לא', future: '' }[d.state];
    week.append(cell);
  });
  const span = Math.max(1, si.next - si.prev);
  c.querySelector('.streak-bar i').style.width = Math.round((si.current - si.prev) / span * 100) + '%';
  setEmo(c.querySelector('[data-next]'), 'עוד ' + streakDays(si.next - si.current) + ' ליעד הבא: ' + si.next + ' 🔥');
  if (sp && typeof sparksLadder === 'function') c.querySelector('.streak-text').append(sparksLadder(sp));
  return c;
}

function streakCelebrate(si) {
  const big = !!si.milestone;
  const o = h(`<div class="streak-pop${big ? ' big' : ''}" role="status" aria-live="polite"><div class="streak-pop-card"><span class="streak-flame"></span><b></b><p></p></div></div>`);
  o.querySelector('.streak-flame').innerHTML = emo('🔥', true); o.querySelector('b').textContent = si.current;
  setEmo(o.querySelector('p'), big ? 'יעד חדש! ' + streakDays(si.current) + ' ברצף 🎉' : si.current === 1 ? 'הרצף התחיל! חזור מחר כדי להגדיל אותו.' : 'הרצף גדל ל-' + streakDays(si.current) + '!', true);
  if (big) for (let i = 0; i < 18; i++) { const sp = h('<i class="streak-spark"></i>'); sp.style.setProperty('--a', (i * 20) + 'deg'); sp.style.setProperty('--d', (60 + (i % 3) * 25) + 'px'); o.querySelector('.streak-pop-card').append(sp); }
  o.onclick = () => o.remove();
  document.body.append(o);
  setTimeout(() => o.classList.add('out'), big ? 2600 : 1700);
  setTimeout(() => o.remove(), big ? 3100 : 2200);
}
