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
function trackLoad() { trackSend({ op: 'load', courses: (typeof thisSemester === 'function' ? thisSemester(S.courses || []) : (S.courses || [])).map(c => c.name) }); }

function trackEvent(m) {
  if (m.type === 'trackReady') { S.trackOk = true; const n = $('navTrack'); if (n) n.hidden = false; return; }
  if (m.type === 'trackState') {
    S.track = m;
    if (m.built) toast(m.built.unplaced ? 'השבוע נבנה. ' + minLabel(m.built.unplaced) + ' לא נכנסו, אפשר להרחיב ימים או שעות.' : 'השבוע נבנה סביב מערכת השעות');
    renderTrack(); window.dispatchEvent(new Event('sumit-track')); return;
  }
  if (m.type === 'trackStrategy' && trackStrategyRun && m.course === trackStrategyRun.course) trackStrategyRun.show(m);
}

const trackDate = (iso) => { const p = String(iso).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const trackDM = (iso) => { const p = String(iso).split('-'); return p[2] + '/' + p[1]; };
const trackClock = (hhmm, plus) => { const [a, b] = hhmm.split(':').map(Number), t = a * 60 + b + (plus || 0); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };

function renderTrack() {
  const box = $('trackPage'); if (!box || !S.track) return;
  const t = S.track, p = t.profile, st = t.stats;
  box.innerHTML = '';

  // ---- Profile and progress at a glance
  const top = h(`<div class="card pad-lg track-top"><div class="row wrap"><label class="grow">איך לקרוא לך?<input type="text" data-name maxlength="60" placeholder="השם שלך (לא חובה)"></label>
    <button class="soft" data-export><span data-ic="download"></span>ייצוא ההתקדמות</button><button class="soft" data-import><span data-ic="file"></span>ייבוא</button></div>
    <div class="track-stats"></div>
    <p class="muted track-note">הפרופיל נשמר רק במחשב הזה, בלי שרת ובלי סיסמה. כדי להעביר למחשב אחר: ייצוא, ואז ייבוא שם.</p></div>`);
  top.querySelector('[data-name]').value = p.name || '';
  top.querySelector('[data-name]').onchange = (e) => trackSend({ op: 'name', value: e.target.value });
  top.querySelector('[data-export]').onclick = () => trackSend({ op: 'export' });
  top.querySelector('[data-import]').onclick = () => trackSend({ op: 'import' });
  const stats = top.querySelector('.track-stats');
  const tile = (label, value, sub) => { const d = h(`<div class="track-stat"><b></b><small class="muted"></small><span class="muted"></span></div>`); d.querySelector('b').textContent = value; d.querySelector('small').textContent = label; d.querySelector('span').textContent = sub || ''; stats.append(d); };
  tile('השבוע', minLabel(st.weekMinutes), st.plannedMinutes ? 'מתוך ' + minLabel(st.plannedMinutes) + ' מתוכננות' : '');
  tile('בלוקים שבוצעו', st.doneBlocks + '/' + st.plannedBlocks, '');
  tile('רצף למידה', st.streak + (st.streak === 1 ? ' יום' : ' ימים'), st.streak ? '' : 'רשום זמן כדי להתחיל');
  tile('סך הכל', minLabel(st.totalMinutes), '');
  if (st.plannedMinutes) {
    const bar = h('<div class="bar big"><i></i></div>'); bar.firstElementChild.style.width = Math.min(100, Math.round(st.weekMinutes * 100 / st.plannedMinutes)) + '%'; top.insertBefore(bar, top.querySelector('.track-note'));
  }
  box.append(top);

  // ---- Courses
  const cc = h('<div class="card pad-lg track-card"><h2>הקורסים שלי</h2><p class="muted">הקורסים נלקחים ממערכת השעות ומלוח המבחנים אם שמרת אותם, ומהקורסים שהאפליקציה כבר מכירה. אפשר גם להוסיף ידנית.</p><div class="track-suggest" hidden></div><div class="track-courses"></div><div class="row track-add"><input type="text" data-new maxlength="120" placeholder="קורס חדש, למשל: מבני נתונים" class="grow"><button class="soft" data-addbtn><span data-ic="plus"></span>הוסף</button></div></div>');
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
    const row = h(`<div class="track-course"><div class="row wrap"><b class="grow" dir="auto"></b><button class="soft small" data-how><span data-ic="sparkles"></span>איך ללמוד את זה?</button><button class="ghost small" data-topics>נושאים</button><button class="ghost small" data-del aria-label="הסר קורס">×</button></div>
      <div class="row wrap track-fields"><label>קושי<select data-level>${TRACK_LEVELS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
      <label>שעות בשבוע<input type="number" data-hours min="0" max="30" step="0.5" placeholder="אוטומטי"></label>
      <label>מבחן<input type="date" data-exam></label><span class="chip" data-examchip hidden></span></div></div>`);
    row.querySelector('b').textContent = c.name;
    row.querySelector('[data-level]').value = String(c.level);
    row.querySelector('[data-hours]').value = c.hoursPerWeek || '';
    row.querySelector('[data-exam]').value = c.examDate || '';
    const fromTt = !c.examDate && c.examFromTimetable;
    const chip = row.querySelector('[data-examchip]');
    const examDay = c.examDate || c.examFromTimetable;
    if (examDay) { const days = Math.round((trackDate(examDay) - trackDate(t.today)) / 86400000); if (days >= 0) { chip.hidden = false; chip.textContent = (fromTt ? 'מהמערכת: ' : '') + (days === 0 ? 'המבחן היום' : days === 1 ? 'המבחן מחר' : 'המבחן בעוד ' + days + ' ימים'); chip.classList.toggle('warn', days < 14); } }
    const edit = (values) => trackSend({ op: 'editCourse', course: c.name, values });
    row.querySelector('[data-level]').onchange = (e) => edit({ level: Number(e.target.value) });
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
  box.append(cc);

  // ---- The week
  const wk = h(`<div class="card pad-lg track-card"><h2>השבוע שלי</h2><p class="muted">בלוקי הלמידה נבנים סביב ההרצאות במערכת השעות, ולפי הקושי של כל קורס והמבחן הקרוב.</p>
    <div class="row wrap track-fields"><label>שעות למידה בשבוע<input type="number" data-hours min="1" max="60" step="1" value="10"></label>
    <label>מ-<input type="time" data-from value="09:00"></label><label>עד<input type="time" data-to value="20:00"></label></div>
    <div class="coach-chips track-days" role="group" aria-label="ימי למידה"></div>
    <div class="row"><button class="primary" data-build><span data-ic="sparkles"></span>בנה לי שבוע</button><span class="muted track-note" data-planinfo></span></div><div class="track-week"></div></div>`);
  // The form of the week keeps its values when the page is drawn again after a click on "done".
  const form = S.trackForm || (S.trackForm = { hours: 10, from: '09:00', to: '20:00' });
  for (const k of ['hours', 'from', 'to']) { const el = wk.querySelector('[data-' + k + ']'); el.value = form[k]; el.onchange = () => { form[k] = el.value; }; }
  const days = wk.querySelector('.track-days');
  TRACK_DAYS.slice(0, 6).forEach((n, i) => {
    const b = h(`<button type="button" class="coach-chip" role="checkbox" aria-checked="${S.trackDays.includes(i)}"></button>`); b.textContent = n;
    b.onclick = () => { const on = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(on)); S.trackDays = on ? S.trackDays.concat(i) : S.trackDays.filter(x => x !== i); };
    days.append(b);
  });
  wk.querySelector('[data-build]').onclick = () => {
    if (!p.courses.length) { toast('קודם הוסף קורסים', { error: true }); return; }
    trackSend({ op: 'build', hours: Number(wk.querySelector('[data-hours]').value) || 10, days: S.trackDays.slice().sort(), from: wk.querySelector('[data-from]').value || '09:00', to: wk.querySelector('[data-to]').value || '20:00' });
  };
  // The plan is for this week, or for the next one when it was built after the last study day.
  const planWeek = p.plan.weekStart, current = planWeek && planWeek >= t.weekStart;
  const blocks = current ? p.plan.blocks : [];
  const info = wk.querySelector('[data-planinfo]');
  if (planWeek && !current) info.textContent = 'התוכנית שנשמרה היא משבוע שעבר. בנה שבוע חדש.';
  else if (current && planWeek > t.weekStart) { wk.querySelector('h2').textContent = 'השבוע הבא שלי'; info.textContent = 'התוכנית בנויה לשבוע הבא, כי הימים שנבחרו כבר עברו.'; }
  const weekEl = wk.querySelector('.track-week');
  const shownWeek = current ? planWeek : (planWeek && planWeek > t.weekStart ? planWeek : t.weekStart);
  TRACK_DAYS.forEach((dn, d) => {
    const day = blocks.filter(b => b.day === d);
    if (!day.length && d === 6) return; // an empty Saturday stays out of the way; the other days always offer "add"
    const date = new Date(trackDate(shownWeek).getTime()); date.setDate(date.getDate() + d);
    const iso = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    const sec = h('<div class="track-day"><div class="track-day-head"><b></b><span class="muted"></span></div></div>');
    sec.querySelector('b').textContent = 'יום ' + dn; sec.querySelector('span').textContent = trackDM(iso) + (iso === t.today ? ' · היום' : '');
    const addB = h('<button type="button" class="ghost small track-add-block" aria-label="הוסף בלוק ליום זה"><span data-ic="plus"></span>בלוק</button>');
    addB.onclick = () => openBlockEditor(p, d, null);
    sec.querySelector('.track-day-head').append(addB);
    for (const b of day) {
      const row = h(`<div class="today-row track-block${b.done ? ' done' : ''}"><span dir="ltr" class="chip"></span><div class="grow"><b dir="auto"></b><small class="muted" dir="auto"></small></div></div>`);
      row.querySelector('.chip').textContent = b.start + '–' + trackClock(b.start, b.minutes);
      row.querySelector('b').textContent = b.course;
      row.querySelector('small').textContent = b.done ? 'בוצע · ' + minLabel(b.doneMinutes) : b.goal;
      const btn = (label, cls, fn, ic) => { const x = h(`<button class="${cls} small">${ic ? `<span data-ic="${ic}"></span>` : ''}${label}</button>`); x.onclick = fn; row.append(x); };
      if (b.done) btn('בטל', 'ghost', () => trackSend({ op: 'undo', id: b.id }));
      else {
        btn('בוצע', 'soft', () => trackSend({ op: 'done', id: b.id }), 'check');
        if (S.blockOk && typeof openBlock === 'function') btn('מה לעשות?', 'ghost', () => {
          const s = new Date(trackDate(iso)); const [hh, mm] = b.start.split(':').map(Number); s.setHours(hh, mm, 0, 0);
          openBlock({ title: (b.course + ' · ' + b.goal.split(':')[0]).slice(0, 110), start: s.getTime(), end: s.getTime() + b.minutes * 60000, uid: 'track-' + b.id });
        });
        btn('ל-Google', 'ghost', () => send({ type: 'exportTool', op: 'gcalBlock', id: b.id }), 'calendar');
        btn('ערוך', 'ghost', () => openBlockEditor(p, d, b));
        btn('×', 'ghost', () => trackSend({ op: 'removeBlock', id: b.id }));
      }
      sec.append(row);
    }
    weekEl.append(sec);
  });
  if (!blocks.length) weekEl.append(h('<p class="muted">עוד אין בלוקים לשבוע הזה. אפשר ללחוץ "בנה לי שבוע", או להוסיף בלוק ליום שבחרת.</p>'));
  box.append(wk);

  // ---- Progress per course
  const pr = h('<div class="card pad-lg track-card"><h2>ההתקדמות שלי</h2><div class="track-progress"></div><div class="row wrap track-fields track-log"><label>רשום זמן שלמדת<select data-course></select></label><label>דקות<input type="number" data-min min="1" max="600" step="5" value="30"></label><button class="soft" data-log><span data-ic="plus"></span>רשום</button></div></div>');
  const pg = pr.querySelector('.track-progress');
  if (!p.courses.length) pg.append(h('<p class="muted">ההתקדמות תופיע כאן אחרי שתוסיף קורסים ותסמן בלוקים כבוצעו.</p>'));
  const maxMin = Math.max(60, ...p.courses.map(c => (st.perCourse[c.name] || {}).total || 0));
  for (const c of p.courses) {
    const s = st.perCourse[c.name] || { week: 0, total: 0, topicsDone: 0, topics: 0 };
    const row = h('<div class="track-prow"><div class="row wrap"><b class="grow" dir="auto"></b><span class="chip"></span><span class="chip" data-topicchip></span></div><div class="bar"><i></i></div></div>');
    row.querySelector('b').textContent = c.name;
    row.querySelector('.chip').textContent = 'השבוע ' + minLabel(s.week) + ' · סך הכל ' + minLabel(s.total);
    const tc = row.querySelector('[data-topicchip]'); tc.textContent = s.topics ? 'נושאים ' + s.topicsDone + '/' + s.topics : 'אין נושאים'; tc.classList.toggle('ok', s.topics > 0 && s.topicsDone === s.topics);
    row.querySelector('.bar i').style.width = Math.round(s.total * 100 / maxMin) + '%';
    pg.append(row);
    const o = document.createElement('option'); o.textContent = c.name; pr.querySelector('[data-course]').append(o);
  }
  pr.querySelector('[data-log]').onclick = () => { const course = pr.querySelector('[data-course]').value; if (course) trackSend({ op: 'log', course, minutes: Number(pr.querySelector('[data-min]').value) || 0 }); };
  box.append(pr);

  // ---- Tools that take the material to other places
  const tl = h(`<div class="card pad-lg track-card"><h2>כלים ללמידה במקומות אחרים</h2><p class="muted">הקבצים נשמרים אצלך, ושום דבר לא נשלח לשום שירות.</p>
    <label class="track-tool-course">קורס<select data-course><option value="">כל הקורסים (ל-Anki)</option></select></label>
    <div class="track-tools">
      <div class="track-tool"><b>יומן</b><small class="muted">הבלוקים של השבוע ליומן של Google: פותח את Google Calendar עם הקובץ מוכן לייבוא, עם תזכורת 10 דקות לפני. לבלוק בודד יש כפתור "ל-Google" בתוך השבוע. אפשר גם לשמור קובץ iCal ל-Apple.</small><button class="soft" data-gcal><span data-ic="calendar"></span>הוסף ל-Google Calendar</button><button class="ghost small" data-ics>שמור כקובץ iCal</button></div>
      <div class="track-tool"><b>NotebookLM</b><small class="muted">תיקייה עם הסיכומים, המידע על הקורס והכרטיסים כשאלות ותשובות. מעלים ל-NotebookLM בלחיצה אחת, ומקבלים שם סיכום קולי ושאלות על החומר.</small><button class="soft" data-nb><span data-ic="book"></span>הכן חבילה</button></div>
      <div class="track-tool"><b>Anki</b><small class="muted">כרטיסי הזיכרון כקובץ שאפשר לייבא ל-Anki ולחזור עליו בטלפון.</small><button class="soft" data-anki><span data-ic="download"></span>ייצוא כרטיסים</button></div>
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
  box.append(tl);
  icons(box);
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
function openBlockEditor(profile, day, block) {
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
  $d('[data-course]').value = block ? block.course : profile.courses[0].name;
  $d('[data-day]').value = String(day);
  $d('[data-start]').value = block ? block.start : '17:00';
  $d('[data-min]').value = block ? block.minutes : 60;
  $d('[data-goal]').value = block ? block.goal : '';
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
