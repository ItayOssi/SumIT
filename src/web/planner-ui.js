// "What to do today" on the home page (the maths is in planner.js), its settings - study hours, energy, fixed weekly blocks -
// and the daily review of the flashcards that are due (the schedule is kept by the host, reviews.js, macOS only).
let reviewRun = null;   // { cards, i, back, repeats } while the review dialog is open

const KIND_LABEL = { deadline: 'הגשה', exam: 'מבחן', review: 'חזרה' };
const ENERGY_LABEL = { high: 'שעה חזקה', medium: 'שעה בינונית', low: 'שעה רגועה' };
const BAND_LABEL = { morning: 'בוקר (6-12)', noon: 'צהריים (12-16)', evening: 'ערב (16-21)', night: 'לילה (21-24)' };

function minLabel(m) { const hr = Math.floor(m / 60), r = m % 60; return hr ? (r ? `${hr} שע׳ ${r} דק׳` : `${hr} שע׳`) : `${r} דק׳`; }
function daysLabel(d) { return d == null ? '' : d < 0 ? 'עבר המועד' : d === 0 ? 'היום' : d === 1 ? 'מחר' : 'בעוד ' + d + ' ימים'; }

function todayContext() {
  return { now: new Date(), events: homeEvents(), timetable: S.timetable, calendar: S.calOcc || [], review: S.review && S.review.count > 0 ? S.review : null, planner: S.settings && S.settings.planner };
}

function renderToday() {
  const list = $('todayList'); if (!list || typeof Planner === 'undefined') return;
  const quick = S.todayQuick || 0;
  const plan = Planner.planDay(todayContext(), quick ? { quick } : {});
  $('todayFree').textContent = quick ? `יש לי ${quick} דקות` : plan.noSlots ? 'אין זמן פנוי היום' : 'זמן פנוי: ' + minLabel(plan.freeMinutes);
  $('todayQuick').textContent = quick ? 'חזרה לתוכנית היום' : 'יש לי רק 30 דקות';
  list.innerHTML = '';
  if (plan.noSlots && !quick && plan.items.length) list.append(h('<div class="muted today-note">היום כבר אין זמן פנוי בחלון הלימוד שהגדרת. כך כדאי להתחיל מחר:</div>'));
  if (!plan.items.length) {
    list.append(h('<div class="empty" style="border:none;padding:14px"><b>אין שום דבר דחוף להיום</b>זמן טוב לחזור על חומר או להתקדם בסיכומים.</div>'));
  }
  for (const it of plan.items) {
    const when = it.start != null ? `${Planner.fmt(it.start)}–${Planner.fmt(it.end)}` : minLabel(it.minutes);
    // A step of "I'm stuck" says what it is (a small start, practice, cards), a deadline says "submission".
    const label = it.ref && it.ref.manual && it.ref.kind && typeof COACH_KINDS !== 'undefined' ? COACH_KINDS[it.ref.kind] : KIND_LABEL[it.kind];
    const sub = [label, it.course, it.kind === 'deadline' ? daysLabel(it.days) : it.kind === 'exam' ? daysLabel(it.days) : '', it.start != null ? ENERGY_LABEL[it.energy] : ''].filter(Boolean).join(' · ');
    const el = h(`<div class="today-row"><span dir="ltr" class="chip${it.days != null && it.days < 0 ? ' bad' : ''}"></span><div class="grow"><b dir="auto"></b><small class="muted" dir="auto"></small></div><button class="ghost small" data-pomo title="התחל סבב ריכוז עם המשימה הזאת" aria-label="התחל סבב ריכוז עם המשימה הזאת"><span data-ic="clock"></span></button><button class="soft small" data-start>התחל</button></div>`);
    el.querySelector('.chip').textContent = when;
    el.querySelector('b').textContent = it.title;
    el.querySelector('small').textContent = sub;
    el.querySelector('[data-start]').onclick = () => startToday(it);
    el.querySelector('[data-pomo]').onclick = () => { if (typeof startPomodoroFor === 'function') startPomodoroFor(it.title); };
    list.append(el);
  }
  const p = S.settings && S.settings.planner;
  if (!p || !p.setup) {
    const hint = h('<div class="muted today-note">התוכנית משתמשת בשעות ברירת מחדל. <button class="ghost small" data-setup>הגדר שעות לימוד ואנרגיה</button></div>');
    hint.querySelector('[data-setup]').onclick = openPlannerSettings;
    list.append(hint);
  }
  icons(list);
  if (typeof renderBlocks === 'function') renderBlocks();
}

function startToday(it) {
  if (it.kind === 'review') return startReview();
  if (it.kind === 'exam') { const c = (S.courses || []).find(x => x.name === it.course); if (c) { openCourse(c); setTab('exams'); } else show('courses'); return; }
  if (it.ref && it.ref.manual) return startTask(it.ref);
  if (it.ref && it.ref.url) openSite('moodle', it.ref.url); else show('tasks');
}

$('todayQuick').onclick = () => { S.todayQuick = S.todayQuick ? 0 : 30; renderToday(); };
$('todaySetup').onclick = () => openPlannerSettings();

// "Start" of a task of the student. A step that "I'm stuck" made opens what it is about; a first small step on paper starts the timer.
function startTask(task) {
  const course = (S.courses || []).find(c => c.name === task.course);
  if (task.kind === 'cards') return startReview();
  if (['start', 'recall', 'plan'].includes(task.kind)) { if (typeof startPomodoroFor === 'function') startPomodoroFor(task.name); return; }
  if (course && task.kind) { openCourse(course); if (task.kind === 'exam') setTab('exams'); return; }
  show('tasks');
}

// ---------- Settings: study hours, energy, fixed blocks ----------
function openPlannerSettings() {
  const p = Planner.settings(S.settings && S.settings.planner);
  const blocks = p.blocks.map(b => ({ day: b.day, from: Planner.fmt(b.from), to: Planner.fmt(b.to), name: b.name }));
  const opt = (v, cur, label) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
  const level = (band) => `<label>${BAND_LABEL[band]}<select data-energy="${band}">${opt('high', p.energy[band], 'אנרגיה גבוהה')}${opt('medium', p.energy[band], 'בינונית')}${opt('low', p.energy[band], 'נמוכה')}</select></label>`;
  const dialog = h(`<dialog class="summary-options" dir="rtl" aria-labelledby="plannerTitle"><form method="dialog">
    <h2 id="plannerTitle">מתי אתה לומד, ומתי יש לך אנרגיה?</h2>
    <p class="muted">משימות כבדות (תרגילים, הכנה למבחן) ישובצו בשעות עם אנרגיה גבוהה, וחזרות קלות בשעות נמוכות. אפשר לשנות בכל עת.</p>
    <div class="row wrap"><label>מתחיל ללמוד ב<input type="time" data-from value="${Planner.fmt(p.from)}" class="ltr"></label><label>מסיים עד<input type="time" data-to value="${Planner.fmt(p.to)}" class="ltr"></label></div>
    <div class="planner-energy">${['morning', 'noon', 'evening', 'night'].map(level).join('')}</div>
    <h3>חסימות קבועות בשבוע</h3><p class="muted">עבודה, אימונים, ארוחות, כל מה שלא פנוי ללימוד. שיעורי המערכת כבר נלקחים בחשבון.</p>
    <div data-blocks></div>
    <div class="row"><button type="button" class="soft small" data-add>הוסף חסימה</button><div class="grow"></div><button type="submit" class="primary">שמור</button><button type="button" class="ghost" data-cancel>ביטול</button></div>
  </form></dialog>`);
  document.body.append(dialog);
  const box = dialog.querySelector('[data-blocks]');
  const draw = () => {
    box.innerHTML = '';
    blocks.forEach((b, i) => {
      const row = h(`<div class="row wrap block-row"><select data-d>${Planner.DAYS.map(d => opt(d, b.day, d)).join('')}</select><input type="time" data-f class="ltr" value="${b.from}"><input type="time" data-t class="ltr" value="${b.to}"><input data-n maxlength="60" placeholder="מה זה? (עבודה)" value="${esc(b.name)}"><button type="button" class="ghost small" data-x aria-label="הסר חסימה">×</button></div>`);
      row.querySelector('[data-d]').onchange = (e) => { b.day = e.target.value; };
      row.querySelector('[data-f]').onchange = (e) => { b.from = e.target.value; };
      row.querySelector('[data-t]').onchange = (e) => { b.to = e.target.value; };
      row.querySelector('[data-n]').oninput = (e) => { b.name = e.target.value; };
      row.querySelector('[data-x]').onclick = () => { blocks.splice(i, 1); draw(); };
      box.append(row);
    });
  };
  draw();
  dialog.querySelector('[data-add]').onclick = () => { if (blocks.length < 40) { blocks.push({ day: Planner.DAYS[new Date().getDay()], from: '17:00', to: '19:00', name: '' }); draw(); } };
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    const energy = {}; dialog.querySelectorAll('[data-energy]').forEach(s => { energy[s.dataset.energy] = s.value; });
    const planner = { setup: true, studyFrom: dialog.querySelector('[data-from]').value, studyTo: dialog.querySelector('[data-to]').value, energy, blocks: blocks.filter(b => b.from && b.to && b.to > b.from) };
    if (Planner.toMin(planner.studyTo) <= Planner.toMin(planner.studyFrom)) { toast('שעת הסיום צריכה להיות אחרי שעת ההתחלה', { error: true }); return; }
    S.settings = Object.assign({}, S.settings, { planner });
    send({ type: 'savePlanner', planner });
    dialog.close(); renderToday();
  };
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

// ---------- Daily review of the cards that are due ----------
function refreshReview() { send({ type: 'getReviewQueue' }); }

function startReview() { send({ type: 'startReview' }); }

function reviewEvent(m) {
  if (m.type === 'reviewQueue') { S.review = { count: m.count, due: m.due, fresh: m.fresh, overdueDays: m.overdueDays || 0, courses: m.courses || {} }; renderToday(); return; }
  if (m.type === 'reviewSession') openReviewDialog(m.cards || []);
}

function openReviewDialog(cards) {
  if (!cards.length) { toast('אין כרטיסים לחזרה עכשיו. כרטיסים נוצרים בכפתור "כרטיסי זיכרון" בכל סיכום.'); return; }
  if (reviewRun) return;
  reviewRun = { cards: cards.slice(), i: 0, back: false, done: 0 };
  const dialog = h(`<dialog class="summary-options review-dialog" dir="rtl" aria-labelledby="reviewTitle"><div class="row"><h2 id="reviewTitle" class="grow">חזרה יומית</h2><button class="ghost small" data-close aria-label="סגור">×</button></div>
    <div class="bar"><i data-bar></i></div><small class="muted" data-count></small>
    <button class="review-card" data-card aria-live="polite"><small data-tag></small><span data-side></span><div data-text></div><small class="muted" data-hint></small></button>
    <div class="row review-rate" data-rate hidden><button class="soft" data-g="again">לא ידעתי <kbd>1</kbd></button><button class="soft" data-g="hard">בערך <kbd>2</kbd></button><button class="primary" data-g="good">ידעתי <kbd>3</kbd></button></div>
    <div data-end hidden></div></dialog>`);
  document.body.append(dialog);
  const $d = (s) => dialog.querySelector(s);
  const finish = () => {
    $d('[data-card]').hidden = true; $d('[data-rate]').hidden = true; $d('[data-bar]').style.width = '100%';
    $d('[data-count]').textContent = '';
    const end = $d('[data-end]'); end.hidden = false;
    end.innerHTML = `<div class="empty" style="border:none"><b>סיימת את החזרה 🎉</b>${reviewRun.done} כרטיסים. הכרטיסים שלא ידעת יחזרו מחר, והשאר בהפרש גדל.</div><div class="row"><div class="grow"></div><button class="primary" data-ok>סגור</button></div>`;
    end.querySelector('[data-ok]').onclick = () => dialog.close();
    refreshReview();
  };
  const draw = () => {
    if (reviewRun.i >= reviewRun.cards.length) return finish();
    const c = reviewRun.cards[reviewRun.i];
    $d('[data-bar]').style.width = Math.round(reviewRun.i / reviewRun.cards.length * 100) + '%';
    $d('[data-count]').textContent = `כרטיס ${reviewRun.i + 1} מתוך ${reviewRun.cards.length}${c.repeat ? ' · חזרה' : ''} · ${c.course}${c.title ? ' · ' + c.title : ''}`;
    $d('[data-card]').classList.toggle('back', reviewRun.back);
    $d('[data-tag]').textContent = c.tag || '';
    $d('[data-side]').textContent = reviewRun.back ? 'תשובה' : 'שאלה';
    $d('[data-text]').innerHTML = md(reviewRun.back ? c.back : c.front);
    $d('[data-hint]').textContent = reviewRun.back ? 'איך היה?' : 'נסה לענות בראש, ואז לחץ כדי להפוך';
    $d('[data-rate]').hidden = !reviewRun.back;
  };
  const flip = () => { if (reviewRun.i < reviewRun.cards.length) { reviewRun.back = !reviewRun.back; draw(); } };
  const rate = (grade) => {
    if (!reviewRun.back || reviewRun.i >= reviewRun.cards.length) return;
    const c = reviewRun.cards[reviewRun.i];
    // A card that was missed comes back once more at the end, as practice only: its schedule is set by the first answer.
    if (!c.repeat) send({ type: 'rateCard', course: c.course, path: c.path, key: c.key, grade });
    if (grade === 'again' && !c.repeat) reviewRun.cards.push(Object.assign({}, c, { repeat: true }));
    if (!c.repeat) reviewRun.done++;
    reviewRun.i++; reviewRun.back = false; draw();
  };
  $d('[data-card]').onclick = flip;
  dialog.querySelectorAll('[data-g]').forEach(b => { b.onclick = () => rate(b.dataset.g); });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === '1') rate('again'); else if (e.key === '2') rate('hard'); else if (e.key === '3') rate('good');
    else if (e.key === ' ' && document.activeElement === $d('[data-card]')) { e.preventDefault(); flip(); }
  });
  $d('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { dialog.remove(); reviewRun = null; refreshReview(); });
  dialog.showModal();
  $d('[data-card]').focus();
  draw();
}
