// "I'm stuck, where do I start?" (macOS host: coach.js). A short form, a few small study steps back, and the chosen ones become
// tasks for today, which "what to do today" then plans. The button stays hidden until the host answers, so it is not shown on Windows.
const COACH_REASONS = [['start', 'לא יודע מאיפה להתחיל'], ['confused', 'לא מבין את החומר'], ['toomuch', 'יש יותר מדי דברים'], ['exam', 'מבחן מתקרב'], ['homework', 'נתקעתי בתרגיל']];
const COACH_KINDS = { start: 'התחלה קטנה', recall: 'שליפה מהזיכרון', read: 'קריאה פעילה', practice: 'תרגול', cards: 'כרטיסי זיכרון', chat: 'שאל את הצ\'אט', exam: 'מבחן קודם', plan: 'תכנון' };
let coachRun = null;   // { requestId, dialog } while the dialog is open

function askCoach() { send({ type: 'coachPing' }); }

function coachEvent(m) {
  if (m.type === 'coachReady') { S.coachOk = true; const b = $('todayStuck'); if (b) b.hidden = false; return; }
  if (m.type === 'stuckResult' && coachRun && m.requestId === coachRun.requestId) coachRun.show(m);
}

// The course that is most pressing: the one with the nearest deadline, else the first of the semester.
function coachDefaultCourse(names) {
  const e = homeEvents().find(x => !x.manual && names.includes(x.course));
  return e ? e.course : names[0] || '';
}

function openCoach() {
  if (coachRun) return;
  const courses = thisSemester(S.courses || []).map(c => c.name);
  if (!courses.length) { toast('אין קורסים להצגה. התחבר ל-Moodle ופתח את הקורסים שלך.', { error: true }); return; }
  const esc2 = esc;
  const dialog = h(`<dialog class="summary-options coach-dialog" dir="rtl" aria-labelledby="coachTitle">
    <div class="row"><h2 id="coachTitle" class="grow">אני תקוע, מאיפה מתחילים?</h2><button class="ghost small" data-close aria-label="סגור">×</button></div>
    <div data-form>
      <label>קורס<select data-course>${courses.map(c => `<option>${esc2(c)}</option>`).join('')}</select></label>
      <div class="coach-field"><b id="coachReasonLabel">מה קורה?</b><div class="coach-chips" role="radiogroup" aria-labelledby="coachReasonLabel">${COACH_REASONS.map(([v, t], i) => `<button type="button" class="coach-chip" role="radio" data-reason="${v}" aria-checked="${i === 0}">${t}</button>`).join('')}</div></div>
      <label>רוצה להוסיף משהו? <small class="muted">(לא חובה)</small><textarea data-note rows="2" maxlength="300" placeholder="למשל: אני לא מבין למה צריך את משפט ערך הביניים"></textarea></label>
      <div class="coach-field"><b id="coachTimeLabel">כמה זמן יש לך?</b><div class="coach-chips" role="radiogroup" aria-labelledby="coachTimeLabel">${[20, 45, 90].map(n => `<button type="button" class="coach-chip" role="radio" data-min="${n}" aria-checked="${n === 45}">${n} דקות</button>`).join('')}</div></div>
      <div class="row"><div class="grow"></div><button class="primary" data-go><span data-ic="sparkles"></span>בנה לי צעדים</button><button type="button" class="ghost" data-close>ביטול</button></div>
    </div>
    <div data-busy hidden><div class="coach-busy"><span data-ic="spin"></span><b>בונה צעדים לפי החומר שלך...</b></div><div class="skeleton" style="height:56px;border-radius:14px;margin:10px 0"></div><div class="skeleton" style="height:56px;border-radius:14px;margin:10px 0"></div><div class="skeleton" style="height:56px;border-radius:14px;margin:10px 0"></div></div>
    <div data-result hidden><p class="muted" data-source></p><div data-steps></div><div class="row wrap coach-actions"><button class="primary" data-add><span data-ic="plus"></span>הוסף למטלות</button><button class="soft" data-addgo><span data-ic="clock"></span>הוסף והתחל ריכוז</button><div class="grow"></div><button type="button" class="ghost" data-again>בנה מחדש</button></div></div>
  </dialog>`);
  document.body.append(dialog);
  const $d = (s) => dialog.querySelector(s);
  const sections = { form: $d('[data-form]'), busy: $d('[data-busy]'), result: $d('[data-result]') };
  const view = (name) => { for (const [k, el] of Object.entries(sections)) el.hidden = k !== name; };
  $d('[data-course]').value = coachDefaultCourse(courses);
  icons(dialog);

  // One chip of each group is chosen at a time.
  for (const group of dialog.querySelectorAll('.coach-chips')) {
    group.addEventListener('click', (e) => { const b = e.target.closest('.coach-chip'); if (!b) return; group.querySelectorAll('.coach-chip').forEach(x => x.setAttribute('aria-checked', String(x === b))); });
  }

  let steps = [], course = '';
  const run = {
    requestId: '',
    show(m) {
      if (m.error) { view('form'); toast(m.text || 'לא הצלחתי לבנות צעדים', { error: true }); return; }
      steps = (m.steps || []).map(s => Object.assign({ on: true }, s));
      $d('[data-source]').textContent = m.source === 'ai' ? 'הצעדים נבנו לפי החומר והנתונים של הקורס שלך.' : 'הצעדים נבנו לפי כללים והנתונים של הקורס, כי אין AI מחובר או שהוא לא ענה.';
      const box = $d('[data-steps]'); box.innerHTML = '';
      steps.forEach((s, i) => {
        const row = h(`<div class="coach-step" style="--i:${i}"><label class="task-check"><input type="checkbox" checked aria-label="בחר את הצעד"><span class="box"></span></label><div class="grow"><b dir="auto"></b><small class="muted" dir="auto"></small></div><span class="chip"></span></div>`);
        row.querySelector('b').textContent = (i + 1) + '. ' + s.title;
        row.querySelector('small').textContent = [COACH_KINDS[s.kind], s.lecture ? 'הרצאה ' + s.lecture : '', s.why].filter(Boolean).join(' · ');
        row.querySelector('.chip').textContent = s.minutes + ' דק׳';
        if (i === 0) row.querySelector('.chip').classList.add('accent');
        row.querySelector('input').onchange = (e) => { s.on = e.target.checked; refreshButtons(); };
        box.append(row);
      });
      refreshButtons(); view('result'); icons(dialog);
    },
  };
  const chosen = () => steps.filter(s => s.on);
  const refreshButtons = () => { const none = !chosen().length; $d('[data-add]').disabled = none; $d('[data-addgo]').disabled = none; };
  coachRun = run;

  const close = () => dialog.close();
  dialog.querySelectorAll('[data-close]').forEach(b => { b.onclick = close; });
  dialog.addEventListener('close', () => { dialog.remove(); coachRun = null; });
  $d('[data-again]').onclick = () => view('form');
  $d('[data-go]').onclick = () => {
    course = $d('[data-course]').value;
    run.requestId = 'coach-' + Date.now();
    view('busy');
    send({
      type: 'stuckHelp', requestId: run.requestId, course,
      reason: dialog.querySelector('[data-reason][aria-checked="true"]').dataset.reason,
      minutes: +dialog.querySelector('[data-min][aria-checked="true"]').dataset.min,
      note: $d('[data-note]').value,
      deadlines: homeEvents().filter(e => !e.manual && e.course === course).slice(0, 8).map(e => ({ name: e.name, when: e.when, overdue: !!e.overdue })),
      tasks: (S.tasks || []).filter(t => !t.done && t.course === course).slice(0, 8).map(t => ({ title: t.title, due: t.due })),
    });
  };

  // The chosen steps become tasks for today; "what to do today" plans them from there.
  const addChosen = (start) => {
    const list = chosen(); if (!list.length) return;
    const d = new Date(), today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    list.forEach((s, i) => S.tasks.push({ id: String(Date.now()) + i + Math.random().toString(36).slice(2, 5), title: s.title, course, due: today, done: false, minutes: s.minutes, kind: s.kind, lecture: s.lecture || 0 }));
    saveTasks();
    close();
    toast(list.length === 1 ? 'נוספה מטלה להיום' : `נוספו ${list.length} מטלות להיום`);
    if (start && typeof startPomodoroFor === 'function') startPomodoroFor(list[0].title);
  };
  $d('[data-add]').onclick = () => addChosen(false);
  $d('[data-addgo]').onclick = () => addChosen(true);
  dialog.showModal();
  $d('[data-go]').focus();
}

$('todayStuck').onclick = openCoach;
