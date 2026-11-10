// The study-track wizard (macOS host: study-track.js). Opens the first time the student enters the study track, and from "השגרה שלי".
// Five steps: the student's day (questions), what is already taken (the connected calendars and things added by hand), the courses of
// the semester, a difficulty and an energy for each course (suggested by the app, decided by the student), and the plan of the week.
// Nothing is saved until the last step; closing in the middle keeps the answers for this session.
const TW_STEPS = ['היום שלך', 'מה כבר תפוס', 'הקורסים', 'קושי ואנרגיה', 'התוכנית'];
const TW_PEAKS = [['morning', 'בוקר', 'עד 12:00'], ['noon', 'צהריים', '12:00–16:00'], ['evening', 'ערב', 'מ-16:00']];
const TW_BLOCKS = [[30, 'חצי שעה'], [45, '45 דקות'], [60, 'שעה'], [90, 'שעה וחצי']];
const TW_LEVELS = [[1, 'קל'], [2, 'בינוני'], [3, 'קשה']];
const TW_ENERGY = [[1, 'נמוכה'], [2, 'בינונית'], [3, 'גבוהה']];
S.tw = null;            // the open wizard: { step, routine, scan, courses, ratings, busy, dialog }
S.twDismissed = false;  // closed without finishing: not opened again by itself in this session

const twMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const twSame = (a, b) => a.day === b.day && a.start === b.start && a.end === b.end;

function openTrackWizard() {
  if (!S.track) return;
  if (S.tw && S.tw.dialog && S.tw.dialog.open) return;
  const t = S.track, p = t.profile, rt = p.routine || {};
  // Answers from an earlier wizard in this session win; then the saved routine; then sensible defaults.
  const prev = S.twAnswers;
  const w = prev || {
    step: 0,
    routine: { wake: rt.wake || '07:30', sleep: rt.sleep || '23:30', peak: rt.peak || 'morning', days: (rt.days || [0, 1, 2, 3, 4]).slice(), hours: rt.hours || 10, block: rt.block || 45,
      commitments: (rt.commitments || []).map(c => Object.assign({ on: true }, c)) },
    scan: null, scanning: false, ratings: {}, ratingsAsked: '',
    // The first time, every course starts from the app's suggestion; after that, from what the student chose last time.
    courses: p.courses.map(c => ({ name: c.name, on: true, level: rt.done ? c.level : 0, energy: rt.done ? (c.energy || 2) : 0, examDate: c.examDate || '', mine: !!rt.done }))
      .concat((t.suggested || []).map(s => ({ name: s.name, on: !p.courses.length, where: s.where, examDate: s.examDate || '', level: 0, energy: 0 }))),
  };
  w.busy = false;
  S.tw = w;
  const dialog = h(`<dialog class="summary-options track-wizard" dir="rtl" aria-labelledby="twTitle">
    <div class="row"><div class="grow"><small class="muted" data-stepname></small><h2 id="twTitle"></h2></div><button class="ghost small" data-close aria-label="סגור">×</button></div>
    <div class="step-dots tw-dots" aria-hidden="true"></div>
    <div class="tw-body"></div>
    <div class="row tw-nav"><button class="ghost" data-back>הקודם</button><div class="grow"></div><span class="muted tw-hint"></span><button class="primary" data-next></button></div>
  </dialog>`);
  w.dialog = dialog;
  document.body.append(dialog);
  const close = (finished) => { if (!finished) { S.twDismissed = true; S.twAnswers = w; } else S.twAnswers = null; w.dialog = null; S.tw = null; dialog.close(); dialog.remove(); };
  dialog.querySelectorAll('[data-close]').forEach(b => b.onclick = () => close(false));
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
  w.close = close;
  dialog.querySelector('[data-back]').onclick = () => { if (w.step > 0 && !w.busy) { w.step--; twRender(); } };
  dialog.querySelector('[data-next]').onclick = () => twNext();
  dialog.showModal();
  twRender();
}

// ---- Moving between steps
function twNext() {
  const w = S.tw; if (!w || w.busy) return;
  if (w.step === 0) {
    const r = w.routine;
    if (!(twMin(r.wake) >= 0) || !(twMin(r.sleep) >= 0)) { toast('מלא שעת קימה ושעת שינה', { error: true }); return; }
    if (!r.days.length) { toast('בחר לפחות יום אחד ללמידה', { error: true }); return; }
  }
  if (w.step === 2 && !w.courses.some(c => c.on)) { toast('בחר לפחות קורס אחד', { error: true }); return; }
  if (w.step === 4) { twFinish(); return; }
  w.step++;
  twRender();
}

function twFinish() {
  const w = S.tw; if (!w) return;
  w.busy = true; twRender();
  const r = w.routine;
  send({ type: 'track', op: 'wizardFinish',
    routine: { wake: r.wake, sleep: r.sleep, peak: r.peak, days: r.days, hours: r.hours, block: r.block,
      commitments: r.commitments.filter(c => c.on).map(c => ({ id: c.id, title: c.title, day: c.day, start: c.start, end: c.end, source: c.source })) },
    courses: w.courses.filter(c => c.on).map(c => ({ name: c.name, level: c.level || 2, energy: c.energy || 2, examDate: c.examDate || '', manual: !!c.manual })) });
}

// Answers from the host while the wizard is open.
function twEvent(m) {
  const w = S.tw;
  if (m.type === 'trackRoutineScan') {
    if (!w) return;
    w.scanning = false; w.scan = m;
    for (const c of m.commitments || []) if (!w.routine.commitments.some(x => twSame(x, c))) w.routine.commitments.push(Object.assign({ on: true, id: 'k' + c.day + c.start.replace(':', '') }, c));
    w.routine.commitments.sort((a, b) => a.day - b.day || twMin(a.start) - twMin(b.start));
    if (w.step === 1) twRender();
    return;
  }
  if (m.type === 'trackRatings') {
    if (!w) return;
    w.ratingsBusy = false;
    for (const [n, r] of Object.entries(m.ratings || {})) {
      w.ratings[n] = r;
      const c = w.courses.find(x => x.name === n);
      if (c && !c.level) { c.level = r.level; c.energy = r.energy; }
    }
    if (w.step === 3) twRender();
    return;
  }
  if (m.type === 'trackWizard' && w) { w.busy = false; twRender(); return; }
  if (m.type === 'trackState' && m.wizardDone && w && w.close) {
    w.close(true);
    toast(m.built && m.built.unplaced ? 'התוכנית נבנתה. ' + minLabel(m.built.unplaced) + ' לא נכנסו לשבוע: אפשר להוסיף ימים או שעות.' : 'התוכנית שלך מוכנה: ' + (m.built ? m.built.blocks : 0) + ' בלוקים לשבוע');
    requestAnimationFrame(() => { const wk = document.querySelector('.track-week'); if (wk) wk.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }
}

// ---- Drawing the current step
function twRender() {
  const w = S.tw; if (!w || !w.dialog) return;
  const d = w.dialog, body = d.querySelector('.tw-body');
  d.querySelector('[data-stepname]').textContent = 'שלב ' + (w.step + 1) + ' מתוך ' + TW_STEPS.length;
  d.querySelector('#twTitle').textContent = TW_STEPS[w.step];
  const dots = d.querySelector('.tw-dots'); dots.innerHTML = '';
  TW_STEPS.forEach((_, i) => { const x = document.createElement('i'); if (i < w.step) x.className = 'on'; else if (i === w.step) x.className = 'now'; dots.append(x); });
  d.querySelector('[data-back]').hidden = w.step === 0;
  d.querySelector('[data-back]').disabled = !!w.busy;
  const next = d.querySelector('[data-next]');
  next.disabled = !!w.busy;
  next.innerHTML = w.step === 4 ? (w.busy ? '<span data-ic="spin"></span>בונה...' : '<span data-ic="sparkles"></span>בנה את התוכנית שלי') : 'הבא';
  d.querySelector('.tw-hint').textContent = '';
  body.innerHTML = '';
  [twStepDay, twStepBusy, twStepCourses, twStepRate, twStepPlan][w.step](body, w);
  icons(d);
}

// A row of chips that work like radio buttons (or checkboxes, when multi).
function twChips(items, isOn, onPick, label) {
  const wrap = h(`<div class="coach-chips" role="group"></div>`);
  if (label) wrap.setAttribute('aria-label', label);
  for (const [value, text, sub] of items) {
    const b = h('<button type="button" class="coach-chip" role="checkbox"></button>');
    b.textContent = text;
    if (sub) { const s = document.createElement('small'); s.className = 'tw-sub'; s.textContent = sub; b.append(s); }
    b.setAttribute('aria-checked', String(isOn(value)));
    b.onclick = () => { onPick(value); twRender(); };
    wrap.append(b);
  }
  return wrap;
}

function twField(label, el) { const l = h('<label class="tw-field"><span></span></label>'); l.firstChild.textContent = label; l.append(el); return l; }

// Step 1: the day.
function twStepDay(body, w) {
  const r = w.routine;
  body.append(h('<p class="muted tw-lead">כמה שאלות קצרות על השגרה שלך, כדי שהבלוקים ייכנסו לחיים שלך ולא להפך. אפשר לשנות הכל אחר כך.</p>'));
  const times = h('<div class="row wrap tw-times"></div>');
  const wake = h('<input type="time" dir="ltr">'); wake.value = r.wake; wake.onchange = () => { r.wake = wake.value; };
  const sleep = h('<input type="time" dir="ltr">'); sleep.value = r.sleep; sleep.onchange = () => { r.sleep = sleep.value; };
  times.append(twField('מתי אתה בדרך כלל קם?', wake), twField('ומתי הולך לישון?', sleep));
  body.append(times);
  body.append(h('<h3 class="tw-q">מתי יש לך הכי הרבה אנרגיה וריכוז?</h3>'));
  body.append(twChips(TW_PEAKS, v => r.peak === v, v => { r.peak = v; }, 'שעות האנרגיה'));
  body.append(h('<h3 class="tw-q">באילו ימים אתה יכול ללמוד?</h3>'));
  body.append(twChips(TRACK_DAYS.map((n, i) => [i, n]), v => r.days.includes(v), v => { r.days = r.days.includes(v) ? r.days.filter(x => x !== v) : r.days.concat(v).sort((a, b) => a - b); }, 'ימי למידה'));
  body.append(h('<h3 class="tw-q">כמה זמן אתה מצליח להתרכז ברצף?</h3>'));
  body.append(twChips(TW_BLOCKS, v => r.block === v, v => { r.block = v; }, 'אורך ריכוז'));
  const hours = h('<input type="number" min="1" max="60" step="1">'); hours.value = r.hours; hours.onchange = () => { r.hours = Math.max(1, Math.min(60, Number(hours.value) || 10)); };
  const hrow = twField('כמה שעות למידה בשבוע, מעבר להרצאות?', hours); hrow.classList.add('tw-hours');
  body.append(hrow);
}

// Step 2: what is taken. The calendars are read once per wizard; things can be added by hand.
function twStepBusy(body, w) {
  const r = w.routine, t = S.track;
  if (!w.scan && !w.scanning && t.calendars) { w.scanning = true; send({ type: 'track', op: 'routineScan' }); }
  body.append(h('<p class="muted tw-lead">עבודה, אימונים, משמרות, הסעות: כל מה שחוזר כל שבוע. הבלוקים לא ייכנסו לזמן הזה, וגם לא לשעות ההרצאות במערכת השעות.</p>'));
  const cal = h('<div class="tw-calendar"></div>');
  if (!t.calendars) {
    cal.append(h('<div class="tw-callout"><span data-ic="calendar"></span><div class="grow"><b>לא חיברת עדיין יומן</b><small class="muted">חבר את Google Calendar (קישור iCal סודי) בהגדרות, יומנים. אחר כך חזור למסלול הלמידה ולחץ "השגרה שלי": התשובות שלך נשמרות, והאירועים הקבועים יופיעו כאן לבחירה.</small></div><button class="soft small" data-cal>להגדרות היומן</button></div>'));
    cal.querySelector('[data-cal]').onclick = () => { if (w.close) w.close(false); show('settings'); setTimeout(() => { const c = $('calendarsCard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200); };
  } else if (w.scanning) {
    cal.append(h('<div class="coach-busy"><span data-ic="spin"></span><b>קורא את היומן...</b></div>'));
  } else if (w.scan) {
    const s = w.scan, lines = [];
    const busiest = (s.busyByDay || []).map((m, i) => [m, i]).filter(x => x[0] >= 120).sort((a, b) => b[0] - a[0]).slice(0, 2);
    lines.push(s.commitments.length ? 'מצאתי ' + s.commitments.length + ' אירועים שחוזרים כל שבוע. סמן את מה שתופס לך זמן.' : 'לא מצאתי ביומן אירועים שחוזרים כל שבוע.');
    if (busiest.length) lines.push('הימים העמוסים ביומן: ' + busiest.map(x => TRACK_DAYS[x[1]] + ' (' + minLabel(x[0]) + ')').join(', ') + '.');
    if (s.firstStart) lines.push('בדרך כלל היום שלך ביומן מתחיל ב-' + s.firstStart + ' ונגמר ב-' + s.lastEnd + '.');
    const p = h('<div class="tw-callout ok"><span data-ic="calendar"></span><div class="grow"></div></div>');
    lines.forEach(l => { const x = document.createElement('div'); x.textContent = l; p.querySelector('.grow').append(x); });
    cal.append(p);
  }
  body.append(cal);

  const list = h('<div class="tw-list"></div>');
  if (!r.commitments.length) list.append(h('<p class="muted">אין עדיין התחייבויות קבועות. הוסף למטה, או המשך אם אין.</p>'));
  for (const c of r.commitments) {
    const row = h('<label class="tw-item"><input type="checkbox"><span class="grow"><b dir="auto"></b><small class="muted"></small></span><span class="chip" data-src hidden>מהיומן</span><button type="button" class="ghost small" data-del aria-label="הסר">×</button></label>');
    row.querySelector('input').checked = c.on !== false;
    row.querySelector('input').onchange = (e) => { c.on = e.target.checked; };
    row.querySelector('b').textContent = c.title;
    row.querySelector('small').textContent = 'יום ' + TRACK_DAYS[c.day] + ' · ' + c.start + '–' + c.end + (c.weeks ? ' · ב-' + c.weeks + ' השבועות האחרונים' : '');
    row.querySelector('[data-src]').hidden = c.source !== 'calendar';
    row.querySelector('[data-del]').onclick = (e) => { e.preventDefault(); r.commitments = r.commitments.filter(x => x !== c); twRender(); };
    list.append(row);
  }
  body.append(list);

  const add = h(`<div class="row wrap tw-add"><input type="text" data-title maxlength="60" placeholder="למשל: עבודה, אימון" class="grow">
    <select data-day>${TRACK_DAYS.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select>
    <input type="time" data-start value="17:00" dir="ltr"><span class="muted">עד</span><input type="time" data-end value="20:00" dir="ltr">
    <button type="button" class="soft small" data-add><span data-ic="plus"></span>הוסף</button></div>`);
  add.querySelector('[data-add]').onclick = () => {
    const title = add.querySelector('[data-title]').value.trim(), day = Number(add.querySelector('[data-day]').value), start = add.querySelector('[data-start]').value, end = add.querySelector('[data-end]').value;
    if (!(twMin(end) > twMin(start))) { toast('השעה של הסוף צריכה להיות אחרי ההתחלה', { error: true }); return; }
    if (r.commitments.length >= 40) return;
    r.commitments.push({ id: 'h' + Date.now().toString(36), title: title || 'התחייבות', day, start, end, source: 'manual', on: true });
    r.commitments.sort((a, b) => a.day - b.day || twMin(a.start) - twMin(b.start));
    twRender();
  };
  body.append(add);
}

// Step 3: the courses of this semester.
function twStepCourses(body, w) {
  body.append(h('<p class="muted tw-lead">אלה הקורסים שמצאתי במערכת השעות, בלוח המבחנים ובקורסים של הסמסטר הנוכחי. סמן את מה שאתה לומד עכשיו.</p>'));
  const list = h('<div class="tw-list"></div>');
  if (!w.courses.length) list.append(h('<p class="muted">לא מצאתי קורסים. הוסף אותם למטה.</p>'));
  for (const c of w.courses) {
    const row = h('<label class="tw-item"><input type="checkbox"><span class="grow"><b dir="auto"></b><small class="muted"></small></span></label>');
    row.querySelector('input').checked = c.on;
    row.querySelector('input').onchange = (e) => { c.on = e.target.checked; };
    row.querySelector('b').textContent = c.name;
    row.querySelector('small').textContent = [c.where || (c.manual ? 'הוספת ידנית' : 'כבר במסלול'), c.examDate ? 'מבחן ' + trackDM(c.examDate) : ''].filter(Boolean).join(' · ');
    list.append(row);
  }
  body.append(list);
  const add = h('<div class="row tw-add"><input type="text" maxlength="120" placeholder="קורס שלא ברשימה, למשל: מבני נתונים" class="grow"><button type="button" class="soft small"><span data-ic="plus"></span>הוסף</button></div>');
  const go = () => { const v = add.querySelector('input').value.replace(/\s+/g, ' ').trim(); if (!v || w.courses.some(c => c.name === v)) return; w.courses.push({ name: v, on: true, manual: true, level: 0, energy: 0, examDate: '' }); twRender(); };
  add.querySelector('button').onclick = go;
  add.querySelector('input').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  body.append(add);
}

// The order in which the plan gives the courses time and the best hours: difficulty first, then energy, then a close exam.
function twOrder(w, today) {
  const examBoost = (c) => { if (!c.examDate) return 1; const d = Math.round((trackDate(c.examDate) - trackDate(today)) / 86400000); return d < 0 ? 1 : d <= 14 ? 2 : d <= 35 ? 1.5 : 1; };
  return w.courses.filter(c => c.on).map(c => ({ c, score: (c.level || 2) * examBoost(c) * 10 + (c.energy || 2) })).sort((a, b) => b.score - a.score).map(x => x.c);
}

// Step 4: difficulty and energy. The app suggests, the student decides.
function twStepRate(body, w) {
  const on = w.courses.filter(c => c.on), key = on.map(c => c.name).join('|');
  if (w.ratingsAsked !== key) {
    w.ratingsAsked = key; w.ratingsBusy = true;
    const exams = {}; on.forEach(c => { if (c.examDate) exams[c.name] = c.examDate; });
    send({ type: 'track', op: 'ratings', courses: on.map(c => c.name), exams });
  }
  body.append(h('<p class="muted tw-lead"><b>קושי</b>: כמה הקורס קשה לך. קורס קשה מקבל יותר זמן. <b>אנרגיה</b>: כמה ריכוז טרי שיעור בו דורש. קורס שדורש הרבה ייכנס לשעות שבהן יש לך הכי הרבה אנרגיה, וקורס קל יחכה לשעות האחרות. סימנתי הצעה לפי מה שידוע על הקורס.</p>'));
  if (w.ratingsBusy) body.append(h('<div class="coach-busy"><span data-ic="spin"></span><b>מכין הצעה לכל קורס...</b></div>'));
  const list = h('<div class="tw-rate-list"></div>');
  for (const c of on) {
    const r = w.ratings[c.name];
    const row = h('<div class="tw-rate"><div class="row"><b class="grow" dir="auto"></b><span class="chip" data-mine hidden>מהפעם הקודמת</span></div><small class="muted tw-why"></small><div class="tw-rate-grid"><div><span class="muted">קושי</span></div><div><span class="muted">אנרגיה</span></div></div></div>');
    row.querySelector('b').textContent = c.name;
    row.querySelector('[data-mine]').hidden = !(r && r.mine);
    row.querySelector('.tw-why').textContent = r && r.reasons && r.reasons.length && !r.mine ? 'הצעה: ' + r.reasons.join(' · ') : '';
    const cells = row.querySelectorAll('.tw-rate-grid > div');
    cells[0].append(twChips(TW_LEVELS, v => (c.level || 0) === v, v => { c.level = v; }, 'קושי של ' + c.name));
    cells[1].append(twChips(TW_ENERGY, v => (c.energy || 0) === v, v => { c.energy = v; }, 'אנרגיה של ' + c.name));
    list.append(row);
  }
  body.append(list);
  const order = twOrder(w, S.track.today);
  if (order.length > 1) {
    const box = h('<div class="tw-order"><b>סדר העדיפות שיוצא מזה</b><ol></ol></div>');
    order.forEach(c => { const li = document.createElement('li'); li.textContent = c.name; box.querySelector('ol').append(li); });
    body.append(box);
  }
}

// Step 5: what the plan will be, before it is built.
function twStepPlan(body, w) {
  const r = w.routine, order = twOrder(w, S.track.today);
  const peak = TW_PEAKS.find(x => x[0] === r.peak);
  const heavy = order.filter(c => (c.level || 2) * (c.energy || 2) >= 6), light = order.filter(c => (c.level || 2) * (c.energy || 2) <= 2);
  const lines = [
    ['clock', r.hours + ' שעות למידה בשבוע, בימים ' + r.days.map(d => TRACK_DAYS[d]).join(', ') + ', בין ' + twWindow(r).from + ' ל-' + twWindow(r).to + '.'],
    ['calendar', 'הזמן של ' + (r.commitments.filter(c => c.on).length ? r.commitments.filter(c => c.on).length + ' התחייבויות קבועות ושל ההרצאות במערכת השעות' : 'ההרצאות במערכת השעות') + ' נשאר פנוי.'],
    ['sparkles', 'בלוקים של ' + TW_BLOCKS.find(x => x[0] === r.block)[1] + ', עם הפסקה של 10 דקות לפחות ביניהם.'],
    ['brain', heavy.length ? 'בשעות ה' + peak[1] + ' (' + peak[2] + '): ' + heavy.map(c => c.name).join(', ') + '.' : 'אין קורס שסימנת כקשה ותובעני, אז הבלוקים מסודרים לפי הסדר הרגיל.'],
  ];
  if (light.length) lines.push(['book', 'מחוץ לשעות האלה: ' + light.map(c => c.name).join(', ') + '.']);
  lines.push(['check', 'הכי הרבה זמן ל: ' + order.slice(0, 3).map(c => c.name).join(', ') + '.']);
  body.append(h('<p class="muted tw-lead">זו התוכנית שאבנה לשבוע. אחרי הבנייה אפשר להזיז, להוסיף ולמחוק בלוקים, ולבנות שוב בכל שבוע.</p>'));
  const ul = h('<div class="tw-summary"></div>');
  for (const [ic, text] of lines) { const row = h(`<div class="tw-sum-row"><span data-ic="${ic}"></span><span></span></div>`); row.lastChild.textContent = text; ul.append(row); }
  body.append(ul);
  if (w.busy) body.append(h('<div class="coach-busy"><span data-ic="spin"></span><b>בונה את השבוע שלך...</b></div>'));
}

// The same window as routineWindow in study-track.js: an hour after getting up, until an hour before sleep (at most 23:45).
function twWindow(r) {
  const hm = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'), cl = (n) => Math.max(0, Math.min(1425, n));
  const wake = twMin(r.wake), sleep = twMin(r.sleep), from = Math.ceil((wake + 60) / 15) * 15, to = sleep > wake ? Math.floor((sleep - 60) / 15) * 15 : 1425;
  return { from: hm(cl(from)), to: hm(cl(Math.max(to, from + 60))) };
}
