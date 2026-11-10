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
  if (m.type === 'trackState') {
    S.track = m;
    if (m.wizardDone) S.trackTab = 'overview';
    if (m.built && !m.wizardDone) toast(m.built.unplaced ? 'השבוע נבנה. ' + minLabel(m.built.unplaced) + ' לא נכנסו, אפשר להרחיב ימים או שעות.' : 'השבוע נבנה סביב מערכת השעות');
    renderTrack(); window.dispatchEvent(new Event('sumit-track'));
    if (typeof twEvent === 'function') twEvent(m);
    // The first time in the study track, the wizard opens by itself (once per session if the student closes it).
    if (!m.wizardDone && m.profile && !(m.profile.routine && m.profile.routine.done) && !S.twDismissed && typeof openTrackWizard === 'function' && document.getElementById('view-track').classList.contains('active')) openTrackWizard();
    return;
  }
  if (m.type === 'trackTasks') { S.trackTasks = m; renderTrackTasks(); return; }
  if ((m.type === 'trackRoutineScan' || m.type === 'trackRatings' || m.type === 'trackWizard') && typeof twEvent === 'function') { twEvent(m); return; }
  if (m.type === 'trackStrategy' && trackStrategyRun && m.course === trackStrategyRun.course) trackStrategyRun.show(m);
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

const trackDate = (iso) => { const p = String(iso).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const trackDM = (iso) => { const p = String(iso).split('-'); return p[2] + '/' + p[1]; };
const trackClock = (hhmm, plus) => { const [a, b] = hhmm.split(':').map(Number), t = a * 60 + b + (plus || 0); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };

// The page is a header (the week at a glance, the wizard and "build again") and five tabs, so only one part is on the screen at a time.
const TRACK_DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
// Short minutes under a column: "1.5 ש׳" or "45 ד׳".
const trackShort = (m) => !m ? '' : m >= 60 ? (Math.round(m / 30) / 2) + ' ש׳' : m + ' ד׳';
const TRACK_TABS = [['overview', 'home', 'סקירה'], ['week', 'calendar', 'השבוע'], ['courses', 'book', 'קורסים'], ['progress', 'chart', 'התקדמות'], ['tools', 'settings', 'כלים']];
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
  if (!TRACK_TABS.some(x => x[0] === S.trackTab)) S.trackTab = 'overview';
  const keepY = window.scrollY;
  box.innerHTML = '';

  // ---- The header: the week in a ring, the routine in one line, the wizard and "build again".
  const hasRoutine = !!(p.routine && p.routine.done);
  const hero = h(`<div class="card pad-lg track-hero"><div class="track-hero-text"><h2></h2><p class="muted" data-line></p>
    <div class="row wrap track-hero-actions"><button class="primary" data-wizard><span data-ic="sparkles"></span></button><button class="soft" data-rebuild><span data-ic="refresh"></span>בנה שוב את השבוע</button></div></div></div>`);
  const share = st.plannedMinutes ? st.weekMinutes / st.plannedMinutes : 0;
  hero.prepend(trackRing(share, st.plannedMinutes ? Math.round(share * 100) + '%' : minLabel(st.weekMinutes), st.plannedMinutes ? 'מהשבוע' : 'השבוע'));
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
  const counts = { week: plan.blocks.length ? st.doneBlocks + '/' + st.plannedBlocks : '', courses: p.courses.length || '', overview: S.trackTasks && S.trackTasks.total ? S.trackTasks.total : '' };
  const tabs = h('<div class="tabs track-tabs" role="tablist" aria-label="מסלול הלמידה"></div>');
  for (const [id, ic, label] of TRACK_TABS) {
    const b = h(`<button type="button" role="tab" data-tab="${id}"><span data-ic="${ic}"></span></button>`);
    b.append(document.createTextNode(label));
    if (counts[id]) { const n = h('<span class="badge"></span>'); n.textContent = counts[id]; b.append(n); }
    b.classList.toggle('active', id === S.trackTab); b.setAttribute('aria-selected', String(id === S.trackTab));
    b.onclick = () => { S.trackTab = id; renderTrack(); };
    tabs.append(b);
  }
  box.append(tabs);

  const pane = h('<div class="track-pane" role="tabpanel"></div>');
  ({ overview: trackOverview, week: trackWeekPane, courses: trackCoursesPane, progress: trackProgressPane, tools: trackToolsPane })[S.trackTab](pane, t, p, st, plan);
  box.append(pane);
  if (S.trackTab === 'tools') renderICloud();
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
  tile('רצף', st.streak + (st.streak === 1 ? ' יום' : ' ימים'), st.streak ? 'ימים ברצף' : 'רשום זמן כדי להתחיל');
  tile('סך הכל', minLabel(st.totalMinutes), 'מאז שהתחלת');
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
  row.querySelector('small').textContent = b.done ? 'בוצע · ' + minLabel(b.doneMinutes) : b.goal;
  row.querySelector('small').title = b.goal;
  const acts = row.querySelector('.track-block-acts');
  const btn = (label, cls, fn, ic, iconOnly) => { const x = h(`<button type="button" class="${cls} small${iconOnly ? ' icon-only' : ''}">${ic ? `<span data-ic="${ic}"></span>` : ''}</button>`); if (!iconOnly) x.append(document.createTextNode(label)); x.title = label; x.setAttribute('aria-label', label); x.onclick = fn; acts.append(x); };
  if (b.done) { btn('בטל', 'ghost', () => trackSend({ op: 'undo', id: b.id }), 'back', true); return row; }
  btn('בוצע', 'soft', () => trackSend({ op: 'done', id: b.id }), 'check');
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
      <div class="row wrap track-course-acts"><button class="soft small" data-how><span data-ic="sparkles"></span>איך ללמוד את זה?</button><button class="ghost small" data-topics><span data-ic="clipboard"></span>נושאים</button><span class="grow"></span><button class="ghost small icon-only" data-del aria-label="הסר קורס" title="הסר קורס"><span data-ic="trash"></span></button></div></div>`);
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
    const tc = row.querySelector('[data-topicchip]'); tc.hidden = !s.topics; tc.textContent = 'נושאים ' + s.topicsDone + '/' + s.topics; tc.classList.toggle('ok', s.topics > 0 && s.topicsDone === s.topics);
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
      <div class="track-tool"><div class="track-tool-head"><span class="ic" data-ic="calendar"></span><b>יומן</b></div><small class="muted">הבלוקים של השבוע ל-Google Calendar, עם תזכורת 10 דקות לפני. או כקובץ iCal ל-Apple.</small><div class="row wrap"><button class="soft" data-gcal>ל-Google Calendar</button><button class="ghost small" data-ics>קובץ iCal</button></div></div>
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

// The topics of a course, as a checklist: what the student adds and ticks is the progress inside the course.
function openTopics(course) {
  const dialog = h(`<dialog class="summary-options coach-dialog" dir="rtl" aria-labelledby="trackTopicsTitle">
    <div class="row"><h2 id="trackTopicsTitle" class="grow"></h2><button class="ghost small" data-close aria-label="סגור">×</button></div>
    <p class="muted">רשום נושאים או פרקים של הקורס, וסמן את מה שכבר שלטת בו.</p><div data-list></div>
    <div class="row track-add"><input type="text" class="grow" data-new maxlength="100" placeholder="נושא חדש, למשל: עצי חיפוש"><button class="soft" data-add><span data-ic="plus"></span>הוסף</button></div>
    <div class="row wrap coach-actions"><div class="grow"></div><button class="ghost" data-close>סגור</button></div></dialog>`);
  dialog.querySelector('#trackTopicsTitle').textContent = 'נושאים: ' + course;
  document.body.append(dialog);
  const draw = () => {
    const box = dialog.querySelector('[data-list]'); box.innerHTML = '';
    const topics = ((S.track && S.track.profile.progress[course]) || { topics: [] }).topics;
    if (!topics.length) box.append(h('<p class="muted">עוד אין נושאים.</p>'));
    for (const t of topics) {
      const row = h('<label class="track-topic"><input type="checkbox"><span class="grow" dir="auto"></span><button type="button" class="ghost small" aria-label="הסר">×</button></label>');
      row.querySelector('input').checked = t.done; row.querySelector('span').textContent = t.title;
      row.querySelector('input').onchange = () => trackSend({ op: 'topic', course, act: 'toggle', id: t.id });
      row.querySelector('button').onclick = (e) => { e.preventDefault(); trackSend({ op: 'topic', course, act: 'remove', id: t.id }); };
      box.append(row);
    }
  };
  const add = () => { const i = dialog.querySelector('[data-new]'), v = i.value.trim(); if (v) { trackSend({ op: 'topic', course, act: 'add', title: v }); i.value = ''; } };
  dialog.querySelector('[data-add]').onclick = add;
  dialog.querySelector('[data-new]').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  dialog.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dialog.close(); });
  dialog.addEventListener('close', () => { window.removeEventListener('sumit-track', draw); dialog.remove(); });
  window.addEventListener('sumit-track', draw);
  draw(); icons(dialog); dialog.showModal();
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
    if (p.courses.some(c => c.name === t.course)) btn('לבלוק', () => openBlockEditor(p, todayDay, null, { course: t.course, goal: t.title, minutes: Math.max(15, Math.min(240, t.minutes)) }), 'plus');
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
