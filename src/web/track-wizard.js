// The study-track wizard (macOS host: study-track.js), built like the first-run wizard (#wizard in ui.html): a card over a blurred
// page, a banner with an animated scene, and the SumIT mascot, who greets the student, talks in a speech bubble at every step,
// thinks while the plan is built and celebrates at the end.
// Steps: welcome, the student's day, what is already taken (the connected calendars and things added by hand), the courses of the
// semester, a difficulty and an energy for each course (suggested by the app, decided by the student), the plan, and done.
// Nothing is saved until "build"; closing in the middle keeps the answers for this session.
const TW_STEPS = [
  { key: 'welcome', title: 'בוא נבנה לך תוכנית לימודים', next: 'בוא נתחיל', say: 'היי! אני אעזור לך לבנות שבוע לימודים שמתאים לחיים שלך, ולא להפך.' },
  { key: 'day', title: 'איך נראה היום שלך?', next: 'המשך', say: 'ספר לי קצת על השגרה שלך. אפשר לשנות הכל אחר כך.' },
  { key: 'busy', title: 'מה כבר תפוס בשבוע?', next: 'המשך', say: 'עבודה, אימון, משמרת? את הזמן הזה אני לא נוגע בו.' },
  { key: 'courses', title: 'אילו קורסים יש לך הסמסטר?', next: 'המשך', say: 'סמן את מה שאתה לומד עכשיו.' },
  { key: 'rate', title: 'מה קשה, ומה דורש אנרגיה?', next: 'המשך', say: 'סימנתי הצעה לכל קורס. אתה מחליט.' },
  { key: 'plan', title: 'זו התוכנית שלך', next: 'בנה את התוכנית שלי', say: 'הכל מוכן. לחיצה אחת ואני בונה לך את השבוע.' },
  { key: 'done', title: 'יש תוכנית!', next: 'לתוכנית שלי', say: 'יאללה, בהצלחה! אני פה אם צריך לשנות משהו.' },
];
const TW_PEAKS = [['morning', 'בוקר', 'עד 12:00', 'sunrise'], ['noon', 'צהריים', '12:00–16:00', 'sun'], ['evening', 'ערב', 'מ-16:00', 'moon']];
const TW_BLOCKS = [[30, 'חצי שעה'], [45, '45 דקות'], [60, 'שעה'], [90, 'שעה וחצי']];
const TW_LEVELS = [[1, 'קל'], [2, 'בינוני'], [3, 'קשה']];
const TW_ENERGY = [[1, 'נמוכה'], [2, 'בינונית'], [3, 'גבוהה']];
S.tw = null;            // the open wizard: { step, routine, scan, courses, ratings, busy, el }
S.twDismissed = false;  // closed without finishing: not opened again by itself in this session

const twMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const twSame = (a, b) => a.day === b.day && a.start === b.start && a.end === b.end;
const twReduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- Small icons, and the scenes of the banner, one per step (330×200, like ART in art.js)
const TW_ICON = {
  sunrise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 4v3M5.6 8.6l1.8 1.8M18.4 8.6l-1.8 1.8M3 14h2M19 14h2"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
};
const TW_ART = {
  welcome: () => ART.welcome(),
  day: () => `<svg viewBox="0 0 330 200" fill="none">
    <ellipse cx="160" cy="184" rx="92" ry="7" fill="rgba(0,0,0,.15)"/>
    <g class="float"><circle cx="160" cy="100" r="62" fill="#fff"/><circle cx="160" cy="100" r="52" fill="#eef2ff"/>
      ${Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6, r1 = i % 3 ? 44 : 40; return `<line x1="${(160 + Math.sin(a) * r1).toFixed(1)}" y1="${(100 - Math.cos(a) * r1).toFixed(1)}" x2="${(160 + Math.sin(a) * 48).toFixed(1)}" y2="${(100 - Math.cos(a) * 48).toFixed(1)}" stroke="#1e1b4b" stroke-width="${i % 3 ? 2 : 4}" stroke-linecap="round"/>`; }).join('')}
      <line class="tw-hand-h" x1="160" y1="100" x2="160" y2="72" stroke="#1e1b4b" stroke-width="6" stroke-linecap="round"/>
      <line class="tw-hand-m" x1="160" y1="100" x2="160" y2="60" stroke="#2f8fe8" stroke-width="4" stroke-linecap="round"/>
      <circle cx="160" cy="100" r="6" fill="#f59e0b"/></g>
    <g transform="translate(270 52)"><g class="tw-rays">${Array.from({ length: 8 }, (_, i) => `<rect x="-2.5" y="-30" width="5" height="11" rx="2.5" fill="#fbbf24" transform="rotate(${i * 45})"/>`).join('')}</g><circle r="15" fill="#fbbf24"/></g>
    <path class="twinkle d2" d="M58 50a16 16 0 1 0 18 22 13 13 0 0 1-18-22z" fill="#fff"/>
    <g fill="#fff"><path class="twinkle" d="M280 138l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/><circle class="twinkle d2" cx="48" cy="130" r="4"/></g>
  </svg>`,
  busy: () => `<svg viewBox="0 0 330 200" fill="none">
    <ellipse cx="165" cy="184" rx="104" ry="7" fill="rgba(0,0,0,.15)"/>
    <g class="float"><rect x="78" y="34" width="174" height="140" rx="16" fill="#fff"/><path d="M78 50a16 16 0 0 1 16-16h142a16 16 0 0 1 16 16v14H78z" fill="#ef4444"/>
      <rect x="112" y="24" width="8" height="22" rx="4" fill="#1e1b4b"/><rect x="210" y="24" width="8" height="22" rx="4" fill="#1e1b4b"/>
      ${Array.from({ length: 15 }, (_, i) => { const x = 92 + (i % 5) * 30, y = 76 + Math.floor(i / 5) * 30, k = [1, 3, 6, 8, 12].indexOf(i); return `<rect class="${k >= 0 ? 'tw-pop' : ''}" style="--i:${Math.max(0, k)}" x="${x}" y="${y}" width="24" height="22" rx="6" fill="${k >= 0 ? ['#f472b6', '#38bdf8', '#fbbf24', '#34d399', '#a78bfa'][k] : '#eef2ff'}"/>`; }).join('')}</g>
    <g fill="#fff"><path class="twinkle" d="M276 52l4 9 9 4-9 4-4 9-4-9-9-4 9-4z"/><circle class="twinkle d2" cx="52" cy="70" r="4"/></g>
  </svg>`,
  courses: () => ART.welcome(),
  rate: () => `<svg viewBox="0 0 330 200" fill="none">
    <ellipse cx="165" cy="184" rx="100" ry="7" fill="rgba(0,0,0,.15)"/>
    <g class="float"><path d="M75 150a90 90 0 0 1 180 0" stroke="#fff" stroke-width="22" stroke-linecap="round"/>
      <path d="M75 150a90 90 0 0 1 45-78" stroke="#34d399" stroke-width="22" stroke-linecap="round"/>
      <path d="M128 66a90 90 0 0 1 76 0" stroke="#fbbf24" stroke-width="22"/>
      <path d="M210 72a90 90 0 0 1 45 78" stroke="#f472b6" stroke-width="22" stroke-linecap="round"/>
      <g class="tw-needle"><path d="M165 150 160 80h10z" fill="#1e1b4b"/></g><circle cx="165" cy="150" r="13" fill="#1e1b4b"/><circle cx="165" cy="150" r="5" fill="#fbbf24"/></g>
    <g fill="#fde047"><path class="twinkle" d="M276 50 266 70h8l-4 16 14-22h-8l4-14z"/><path class="twinkle d2" d="M56 62 48 78h6l-3 12 11-17h-6l3-11z"/></g>
  </svg>`,
  plan: () => `<svg viewBox="0 0 330 200" fill="none">
    <ellipse cx="165" cy="184" rx="112" ry="7" fill="rgba(0,0,0,.15)"/>
    <g class="float"><rect x="62" y="30" width="206" height="144" rx="16" fill="#fff"/>
      ${Array.from({ length: 5 }, (_, i) => `<rect x="${76 + i * 38}" y="42" width="30" height="10" rx="5" fill="#c7d2fe"/>`).join('')}
      ${[[0, 0, 34, '#38bdf8'], [0, 1, 22, '#fbbf24'], [1, 0, 26, '#f472b6'], [2, 0, 40, '#34d399'], [2, 1, 20, '#38bdf8'], [3, 0, 24, '#a78bfa'], [4, 0, 30, '#fbbf24'], [4, 1, 24, '#f472b6']].map(([c, r, hgt, col], i) =>
        `<rect class="tw-drop" style="--i:${i}" x="${76 + c * 38}" y="${62 + r * 50}" width="30" height="${hgt}" rx="7" fill="${col}"/>`).join('')}</g>
    <g class="tw-badge"><circle cx="258" cy="160" r="22" fill="#34d399"/><path d="M247 160l8 8 15-16" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>
    <g fill="#fff"><path class="twinkle" d="M44 56l4 9 9 4-9 4-4 9-4-9-9-4 9-4z"/><circle class="twinkle d2" cx="290" cy="46" r="4"/></g>
  </svg>`,
  done: () => ART.done(),
};

function openTrackWizard() {
  if (!S.track) return;
  if (S.tw && S.tw.el) return;
  const t = S.track, p = t.profile, rt = p.routine || {};
  // Answers from an earlier wizard in this session win; then the saved routine; then sensible defaults.
  const w = S.twAnswers || {
    step: 0,
    routine: { wake: rt.wake || '07:30', sleep: rt.sleep || '23:30', peak: rt.peak || 'morning', days: (rt.days || [0, 1, 2, 3, 4]).slice(), hours: rt.hours || 10, block: rt.block || 45,
      commitments: (rt.commitments || []).map(c => Object.assign({ on: true }, c)) },
    scan: null, scanning: false, ratings: {}, ratingsAsked: '',
    // The first time, every course starts from the app's suggestion; after that, from what the student chose last time.
    courses: p.courses.map(c => ({ name: c.name, on: true, level: rt.done ? c.level : 0, energy: rt.done ? (c.energy || 2) : 0, examDate: c.examDate || '', mine: !!rt.done }))
      .concat((t.suggested || []).map(s => ({ name: s.name, on: !p.courses.length, where: s.where, examDate: s.examDate || '', level: 0, energy: 0 }))),
  };
  if (w.step >= 6) w.step = 0;
  w.busy = false; w.dir = 1;
  S.tw = w;
  const el = h(`<div class="overlay tw-overlay" role="dialog" aria-modal="true" aria-labelledby="twTitle">
    <div class="wizard tw-wizard" dir="rtl">
      <div class="art-top tw-stage">
        <div class="tw-hero"><div class="tw-mascot"></div><div class="tw-bubble" aria-live="polite"><span></span></div></div>
        <div class="tw-scene" aria-hidden="true"></div>
      </div>
      <div class="content">
        <div class="tw-step"><h1 id="twTitle"></h1><div class="tw-body"></div></div>
        <div class="foot">
          <div class="steps tw-steps" aria-hidden="true">${TW_STEPS.map(() => '<i></i>').join('')}</div>
          <span class="muted tw-count"></span>
          <div class="grow"></div>
          <button class="ghost" data-later>אחר כך</button>
          <button class="ghost" data-back>חזרה</button>
          <button class="primary big" data-next></button>
        </div>
      </div>
    </div>
  </div>`);
  w.el = el;
  document.body.append(el);
  const close = (finished) => {
    if (!finished) { S.twDismissed = true; S.twAnswers = w; } else S.twAnswers = null;
    clearInterval(w.typer); document.removeEventListener('keydown', w.keys);
    w.el = null; S.tw = null;
    el.classList.add('tw-out'); setTimeout(() => el.remove(), twReduced() ? 0 : 260);
  };
  w.close = close;
  w.keys = (e) => { if (e.key === 'Escape' && !w.busy) { e.preventDefault(); close(w.step === 6); } };
  document.addEventListener('keydown', w.keys);
  el.querySelector('[data-later]').onclick = () => close(false);
  el.querySelector('[data-back]').onclick = () => { if (w.step > 0 && !w.busy) { w.step--; w.dir = -1; twRender(true); } };
  el.querySelector('[data-next]').onclick = () => twNext();
  twRender(true);
}

// ---- Moving between steps
function twNext() {
  const w = S.tw; if (!w || w.busy) return;
  if (w.step === 1) {
    const r = w.routine;
    if (!(twMin(r.wake) >= 0) || !(twMin(r.sleep) >= 0)) { toast('מלא שעת קימה ושעת שינה', { error: true }); return; }
    if (!r.days.length) { toast('בחר לפחות יום אחד ללמידה', { error: true }); return; }
  }
  if (w.step === 3 && !w.courses.some(c => c.on)) { toast('בחר לפחות קורס אחד', { error: true }); return; }
  if (w.step === 5) { twFinish(); return; }
  if (w.step === 6) {
    w.close(true);
    requestAnimationFrame(() => { const wk = document.querySelector('.track-week'); if (wk) wk.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    return;
  }
  w.step++; w.dir = 1;
  twRender(true);
}

function twFinish() {
  const w = S.tw; if (!w) return;
  w.busy = true; twRender(false);
  twSay('רגע, אני מסדר לך את הבלוקים בשבוע...', 'think');
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
    if (w.step === 2) { twRender(false); twSay(m.commitments.length ? 'מצאתי ביומן ' + m.commitments.length + ' דברים שחוזרים כל שבוע. סמן מה תופס לך זמן.' : 'לא מצאתי ביומן דברים שחוזרים כל שבוע. אפשר להוסיף ידנית.'); }
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
    if (w.step === 4) twRender(false);
    return;
  }
  if (m.type === 'trackWizard' && w) { w.busy = false; twRender(false); twSay('משהו חסר. בדוק את הקורסים ונסה שוב.'); return; }
  if (m.type === 'trackState' && m.wizardDone && w) {
    w.busy = false; w.built = m.built || { blocks: 0, unplaced: 0 }; w.step = 6; w.dir = 1;
    twRender(true);
    if (w.built.blocks && typeof confetti === 'function' && !twReduced()) confetti();
  }
}

// The mascot says something: the bubble pops, and the text is typed out. mood: '' | 'think' | 'cheer'.
function twSay(text, mood) {
  const w = S.tw; if (!w || !w.el) return;
  const bubble = w.el.querySelector('.tw-bubble'), span = bubble.querySelector('span'), hero = w.el.querySelector('.tw-hero');
  hero.classList.toggle('think', mood === 'think');
  hero.classList.toggle('cheer', mood === 'cheer');
  bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
  clearInterval(w.typer);
  if (twReduced()) { span.textContent = text; return; }
  let i = 0; span.textContent = '';
  w.typer = setInterval(() => { i += 2; span.textContent = text.slice(0, i); if (i >= text.length) clearInterval(w.typer); }, 28);
}

// ---- Drawing the current step. fresh: a new step (the scene, the mascot and the text come in again).
function twRender(fresh) {
  const w = S.tw; if (!w || !w.el) return;
  const el = w.el, st = TW_STEPS[w.step];
  el.querySelector('#twTitle').textContent = w.step === 6 && w.built && !w.built.blocks ? 'כמעט' : st.title;
  el.querySelectorAll('.tw-steps i').forEach((d, i) => { d.className = i === w.step ? 'on' : i < w.step ? 'done' : ''; });
  el.querySelector('.tw-count').textContent = w.step > 0 && w.step < 6 ? 'שלב ' + w.step + ' מתוך 5' : '';
  const back = el.querySelector('[data-back]'), later = el.querySelector('[data-later]'), next = el.querySelector('[data-next]');
  back.hidden = w.step === 0 || w.step === 6; back.disabled = !!w.busy;
  later.hidden = w.step === 6; later.disabled = !!w.busy;
  next.disabled = !!w.busy;
  next.innerHTML = w.busy ? '<span data-ic="spin"></span>בונה...' : (w.step === 5 ? '<span data-ic="sparkles"></span>' : '') + st.next;
  if (fresh) {
    el.querySelector('.tw-scene').innerHTML = TW_ART[st.key]();
    const mascot = el.querySelector('.tw-mascot');
    mascot.innerHTML = ART.mascot('wave');          // a new copy, so the thumbs-up plays again
    mascot.classList.remove('hop'); void mascot.offsetWidth; mascot.classList.add('hop');
    const box = el.querySelector('.tw-step');
    box.classList.remove('in', 'back'); void box.offsetWidth; box.classList.add('in'); if (w.dir < 0) box.classList.add('back');
  }
  const body = el.querySelector('.tw-body');
  body.innerHTML = '';
  [twStepWelcome, twStepDay, twStepBusy, twStepCourses, twStepRate, twStepPlan, twStepDone][w.step](body, w);
  if (w.busy) body.append(h('<div class="check-row"><div class="ci"><span class="spinner"></span></div><div class="grow"><b>בונה את השבוע שלך...</b><small>מסדר את הבלוקים סביב ההרצאות וההתחייבויות</small></div></div>'));
  icons(el);
  if (fresh) twSay(w.step === 6 ? twDoneLine(w) : st.say, w.step === 6 && w.built && w.built.blocks ? 'cheer' : '');
}

const twDoneLine = (w) => (w.built && w.built.blocks ? 'יש לך ' + w.built.blocks + ' בלוקים השבוע. בהצלחה, אני סומך עליך!' : 'לא מצאתי זמן פנוי לבלוקים. נסה להוסיף ימים או שעות.');

// A row of chips that work like radio buttons (or checkboxes).
function twChips(items, isOn, onPick, label, cls) {
  const wrap = h(`<div class="coach-chips tw-chips ${cls || ''}" role="group"></div>`);
  if (label) wrap.setAttribute('aria-label', label);
  for (const [value, text, sub, icon] of items) {
    const b = h('<button type="button" class="coach-chip" role="checkbox"></button>');
    // 'bolt*3': the icon three times (the energy buttons show one, two or three bolts).
    if (icon) { const [ic, n] = icon.split('*'); b.insertAdjacentHTML('beforeend', '<span class="tw-icons">' + ('<span class="tw-ic">' + TW_ICON[ic] + '</span>').repeat(Number(n) || 1) + '</span>'); }
    b.append(document.createTextNode(text));
    if (sub) { const s = document.createElement('small'); s.className = 'tw-sub'; s.textContent = sub; b.append(s); }
    b.setAttribute('aria-checked', String(isOn(value)));
    b.onclick = () => { onPick(value); twRender(false); };
    wrap.append(b);
  }
  return wrap;
}

function twField(label, el) { const l = h('<label class="tw-field"><span></span></label>'); l.firstChild.textContent = label; l.append(el); return l; }
const twLead = (body, html) => body.append(h('<p class="lead">' + html + '</p>'));
const twQ = (body, text) => { const q = h('<h3 class="tw-q"></h3>'); q.textContent = text; body.append(q); };

// A row like the first-run wizard's: an icon in a circle, a title and a line under it. With a checkbox when it can be chosen.
function twRow(icon, title, sub, opts) {
  const o = opts || {};
  const tag = o.check ? 'label' : 'div';
  const row = h(`<${tag} class="check-row tw-row${o.ok ? ' ok' : ''}"><div class="ci" data-ic="${icon}"></div><div class="grow"><b dir="auto"></b><small dir="auto"></small></div></${tag}>`);
  row.querySelector('b').textContent = title;
  row.querySelector('small').textContent = sub || '';
  if (o.check) {
    const box = h('<input type="checkbox" class="tw-check">');
    box.checked = !!o.checked;
    row.classList.toggle('ok', box.checked);
    box.onchange = () => { row.classList.toggle('ok', box.checked); o.onChange(box.checked); };
    row.append(box);
  }
  if (o.chip) { const c = h('<span class="chip"></span>'); c.textContent = o.chip; row.append(c); }
  if (o.onRemove) { const x = h('<button type="button" class="ghost small" aria-label="הסר">×</button>'); x.onclick = (e) => { e.preventDefault(); o.onRemove(); }; row.append(x); }
  if (o.i !== undefined) row.style.setProperty('--i', o.i);
  return row;
}

// Step 0: welcome.
function twStepWelcome(body) {
  twLead(body, 'חמישה צעדים קצרים, ואני בונה לך שבוע של בלוקי למידה סביב החיים שלך: בשעות שבהן יש לך הכי הרבה כוח, ובלי לגעת בזמן שכבר תפוס.');
  body.append(twRow('clock', 'היום שלך', 'מתי אתה קם, מתי יש לך הכי הרבה אנרגיה, וכמה זמן אתה מצליח להתרכז', { i: 0 }));
  body.append(twRow('calendar', 'מה כבר תפוס', 'אני קורא את היומן המחובר ומוצא מה חוזר כל שבוע', { i: 1 }));
  body.append(twRow('brain', 'הקורסים, הקושי והאנרגיה', 'אני מציע, אתה מחליט, ומזה יוצא סדר העדיפות', { i: 2 }));
}

// Step 1: the day.
function twStepDay(body, w) {
  const r = w.routine;
  const times = h('<div class="row wrap tw-times"></div>');
  const wake = h('<input type="time" dir="ltr">'); wake.value = r.wake; wake.onchange = () => { r.wake = wake.value; };
  const sleep = h('<input type="time" dir="ltr">'); sleep.value = r.sleep; sleep.onchange = () => { r.sleep = sleep.value; };
  const hours = h('<input type="number" min="1" max="60" step="1">'); hours.value = r.hours; hours.onchange = () => { r.hours = Math.max(1, Math.min(60, Number(hours.value) || 10)); };
  times.append(twField('מתי אתה בדרך כלל קם?', wake), twField('ומתי הולך לישון?', sleep), twField('שעות למידה בשבוע, מעבר להרצאות', hours));
  body.append(times);
  twQ(body, 'מתי יש לך הכי הרבה אנרגיה וריכוז?');
  body.append(twChips(TW_PEAKS, v => r.peak === v, v => { r.peak = v; twSay({ morning: 'אדם של בוקר! את הקורסים הכבדים נשים מוקדם.', noon: 'צהריים זה זמן מצוין. שם ייכנסו הקורסים הכבדים.', evening: 'ינשוף לילה! הקורסים הכבדים יחכו לערב.' }[v]); }, 'שעות האנרגיה', 'tw-peaks'));
  twQ(body, 'באילו ימים אתה יכול ללמוד?');
  body.append(twChips(TRACK_DAYS.map((n, i) => [i, n]), v => r.days.includes(v), v => { r.days = r.days.includes(v) ? r.days.filter(x => x !== v) : r.days.concat(v).sort((a, b) => a - b); }, 'ימי למידה'));
  twQ(body, 'כמה זמן אתה מצליח להתרכז ברצף?');
  body.append(twChips(TW_BLOCKS, v => r.block === v, v => { r.block = v; }, 'אורך ריכוז'));
}

// Step 2: what is taken. The calendars are read once per wizard; things can be added by hand.
function twStepBusy(body, w) {
  const r = w.routine, t = S.track;
  if (!w.scan && !w.scanning && t.calendars) { w.scanning = true; send({ type: 'track', op: 'routineScan' }); }
  twLead(body, 'כל מה שחוזר כל שבוע. הבלוקים לא ייכנסו לזמן הזה, וגם לא לשעות ההרצאות במערכת השעות.');
  if (!t.calendars) {
    const row = twRow('calendar', 'לא חיברת עדיין יומן', 'חבר את Google Calendar בהגדרות, יומנים. אחר כך חזור ולחץ "השגרה שלי": התשובות שלך נשמרות.');
    const go = h('<button class="soft small">להגדרות היומן</button>');
    go.onclick = () => { if (w.close) w.close(false); show('settings'); setTimeout(() => { const c = $('calendarsCard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200); };
    row.append(go); body.append(row);
  } else if (w.scanning) {
    body.append(h('<div class="check-row"><div class="ci"><span class="spinner"></span></div><div class="grow"><b>קורא את היומן...</b><small>מחפש אירועים שחוזרים כל שבוע</small></div></div>'));
  } else if (w.scan) {
    const s = w.scan, busiest = (s.busyByDay || []).map((m, i) => [m, i]).filter(x => x[0] >= 120).sort((a, b) => b[0] - a[0]).slice(0, 2);
    const sub = [busiest.length ? 'הכי עמוס: ' + busiest.map(x => TRACK_DAYS[x[1]] + ' (' + minLabel(x[0]) + ')').join(', ') : '', s.firstStart ? 'היום ביומן מתחיל בדרך כלל ב-' + s.firstStart + ' ונגמר ב-' + s.lastEnd : ''].filter(Boolean).join(' · ');
    body.append(twRow('calendar', s.commitments.length ? 'מצאתי ' + s.commitments.length + ' אירועים קבועים ביומן' : 'אין ביומן אירועים קבועים', sub || 'מתוך ' + s.events + ' אירועים בארבעת השבועות האחרונים', { ok: true }));
  }
  const list = h('<div class="tw-list"></div>');
  r.commitments.forEach((c, i) => list.append(twRow(c.source === 'calendar' ? 'calendar' : 'clock', c.title, 'יום ' + TRACK_DAYS[c.day] + ' · ' + c.start + '–' + c.end + (c.weeks ? ' · ב-' + c.weeks + ' השבועות האחרונים' : ''),
    { check: true, checked: c.on !== false, onChange: (v) => { c.on = v; }, chip: c.source === 'calendar' ? 'מהיומן' : '', onRemove: () => { r.commitments = r.commitments.filter(x => x !== c); twRender(false); }, i })));
  body.append(list);

  const add = h(`<div class="row wrap tw-add"><input type="text" data-title maxlength="60" placeholder="הוסף: עבודה, אימון..." class="grow">
    <select data-day>${TRACK_DAYS.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select>
    <input type="time" data-start value="17:00" dir="ltr"><span class="muted">עד</span><input type="time" data-end value="20:00" dir="ltr">
    <button type="button" class="soft" data-add><span data-ic="plus"></span>הוסף</button></div>`);
  add.querySelector('[data-add]').onclick = () => {
    const title = add.querySelector('[data-title]').value.trim(), day = Number(add.querySelector('[data-day]').value), start = add.querySelector('[data-start]').value, end = add.querySelector('[data-end]').value;
    if (!(twMin(end) > twMin(start))) { toast('השעה של הסוף צריכה להיות אחרי ההתחלה', { error: true }); return; }
    if (r.commitments.length >= 40) return;
    r.commitments.push({ id: 'h' + Date.now().toString(36), title: title || 'התחייבות', day, start, end, source: 'manual', on: true });
    r.commitments.sort((a, b) => a.day - b.day || twMin(a.start) - twMin(b.start));
    twRender(false); twSay('רשמתי. את הזמן הזה אני משאיר לך.');
  };
  body.append(add);
}

// Step 3: the courses of this semester.
function twStepCourses(body, w) {
  twLead(body, 'מצאתי את הקורסים האלה במערכת השעות, בלוח המבחנים ובקורסים של הסמסטר. סמן את אלה שאתה לומד עכשיו.');
  if (!w.courses.length) body.append(twRow('alert', 'לא מצאתי קורסים', 'הוסף אותם למטה'));
  const list = h('<div class="tw-list"></div>');
  w.courses.forEach((c, i) => list.append(twRow('book', c.name, [c.where || (c.manual ? 'הוספת ידנית' : 'כבר במסלול'), c.examDate ? 'מבחן ב-' + trackDM(c.examDate) : ''].filter(Boolean).join(' · '),
    { check: true, checked: c.on, onChange: (v) => { c.on = v; }, i })));
  body.append(list);
  const add = h('<div class="row tw-add"><input type="text" maxlength="120" placeholder="קורס שלא ברשימה, למשל: מבני נתונים" class="grow"><button type="button" class="soft"><span data-ic="plus"></span>הוסף</button></div>');
  const go = () => { const v = add.querySelector('input').value.replace(/\s+/g, ' ').trim(); if (!v || w.courses.some(c => c.name === v)) return; w.courses.push({ name: v, on: true, manual: true, level: 0, energy: 0, examDate: '' }); twRender(false); };
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
  twLead(body, '<b>קושי</b>: כמה הקורס קשה לך. קורס קשה מקבל יותר זמן. <b>אנרגיה</b>: כמה ריכוז טרי הוא דורש. קורס תובעני ייכנס לשעות שבהן יש לך הכי הרבה כוח.');
  if (w.ratingsBusy) body.append(h('<div class="check-row"><div class="ci"><span class="spinner"></span></div><div class="grow"><b>מכין הצעה לכל קורס...</b><small>לפי סוג הקורס, המבחן והסיכומים שכבר יש</small></div></div>'));
  const list = h('<div class="tw-rate-list"></div>');
  on.forEach((c, i) => {
    const r = w.ratings[c.name];
    const row = h('<div class="tw-rate"><div class="row"><b class="grow" dir="auto"></b><span class="chip" data-mine hidden>מהפעם הקודמת</span></div><small class="muted tw-why"></small><div class="tw-rate-grid"><div><span class="muted">קושי</span></div><div><span class="muted">אנרגיה</span></div></div></div>');
    row.style.setProperty('--i', i);
    row.querySelector('b').textContent = c.name;
    row.querySelector('[data-mine]').hidden = !(r && r.mine);
    row.querySelector('.tw-why').textContent = r && r.reasons && r.reasons.length && !r.mine ? 'ההצעה שלי: ' + r.reasons.join(' · ') : '';
    const cells = row.querySelectorAll('.tw-rate-grid > div');
    cells[0].append(twChips(TW_LEVELS, v => (c.level || 0) === v, v => { c.level = v; }, 'קושי של ' + c.name));
    cells[1].append(twChips(TW_ENERGY.map(([v, n]) => [v, n, '', 'bolt*' + v]), v => (c.energy || 0) === v, v => { c.energy = v; }, 'אנרגיה של ' + c.name, 'tw-energy'));
    list.append(row);
  });
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
  const r = w.routine, order = twOrder(w, S.track.today), win = twWindow(r);
  const peak = TW_PEAKS.find(x => x[0] === r.peak);
  const heavy = order.filter(c => (c.level || 2) * (c.energy || 2) >= 6), light = order.filter(c => (c.level || 2) * (c.energy || 2) <= 2), taken = r.commitments.filter(c => c.on).length;
  const rows = [
    ['clock', r.hours + ' שעות בשבוע', 'בימים ' + r.days.map(d => TRACK_DAYS[d]).join(', ') + ', בין ' + win.from + ' ל-' + win.to],
    ['calendar', taken ? taken + ' התחייבויות קבועות נשארות פנויות' : 'ההרצאות נשארות פנויות', taken ? 'וגם ההרצאות במערכת השעות' : 'הבלוקים נבנים סביב מערכת השעות'],
    ['sparkles', 'בלוקים של ' + TW_BLOCKS.find(x => x[0] === r.block)[1], 'עם הפסקה של 10 דקות לפחות ביניהם'],
    ['brain', heavy.length ? 'בשעות ה' + peak[1] + ': ' + heavy.map(c => c.name).join(', ') : 'אין קורס קשה ותובעני במיוחד', heavy.length ? 'הקורסים הכי תובעניים, בשעות שבהן יש לך הכי הרבה כוח' : 'הבלוקים מסודרים לפי הסדר הרגיל'],
  ];
  if (light.length) rows.push(['book', 'מחוץ לשעות האלה: ' + light.map(c => c.name).join(', '), 'קורסים קלים לא תופסים את השעות הטובות']);
  rows.push(['check', 'הכי הרבה זמן: ' + order.slice(0, 3).map(c => c.name).join(', '), 'לפי הקושי והמבחן הקרוב']);
  twLead(body, 'זה מה שאבנה. אחרי הבנייה אפשר להזיז, להוסיף ולמחוק בלוקים, ולבנות שוב בכל שבוע.');
  rows.forEach(([ic, b, s], i) => body.append(twRow(ic, b, s, { ok: true, i })));
}

// Step 6: done.
function twStepDone(body, w) {
  const b = w.built || { blocks: 0, unplaced: 0 };
  twLead(body, b.blocks ? 'השבוע שלך מחכה במסלול הלמידה. סמן "בוצע" אחרי כל בלוק, וההתקדמות תתעדכן.' : 'לא מצאתי זמן פנוי לבלוקים. אפשר לחזור לאשף מ"השגרה שלי" ולהוסיף ימים או שעות.');
  if (b.blocks) body.append(twRow('check', b.blocks + ' בלוקים נכנסו לשבוע', 'בתוך חלון היום שלך, מחוץ להתחייבויות ולהרצאות', { ok: true, i: 0 }));
  if (b.unplaced) body.append(twRow('alert', minLabel(b.unplaced) + ' לא נכנסו', 'אפשר להוסיף ימים או שעות, ולבנות שוב', { i: 1 }));
  body.append(twRow('sparkles', 'מה כדאי לעשות עכשיו', 'במסלול יש גם משימות שנגזרות מהחומר בתיקיות הקורסים', { i: 2 }));
}

// The same window as routineWindow in study-track.js: an hour after getting up, until an hour before sleep (at most 23:45).
function twWindow(r) {
  const hm = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'), cl = (n) => Math.max(0, Math.min(1425, n));
  const wake = twMin(r.wake), sleep = twMin(r.sleep), from = Math.ceil((wake + 60) / 15) * 15, to = sleep > wake ? Math.floor((sleep - 60) / 15) * 15 : 1425;
  return { from: hm(cl(from)), to: hm(cl(Math.max(to, from + 60))) };
}
