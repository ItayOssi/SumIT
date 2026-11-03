// "What to do today": pure functions (no DOM), so they can be tested in Node. From the deadlines, the exam dates, the cards
// waiting for review, the timetable and the student's own hours and energy, it picks a few things for today and puts each one
// in a free window: heavy work (homework, exam prep) in the hours with the most energy, light work (card reviews) in the low ones.
(function (root) {
  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  // Parts of the day the student rates (minutes from midnight).
  const BANDS = [[0, 360, 'night'], [360, 720, 'morning'], [720, 960, 'noon'], [960, 1260, 'evening'], [1260, 1440, 'night']];
  const LEVELS = ['high', 'medium', 'low'];
  const DEFAULTS = {
    studyFrom: '08:00', studyTo: '22:00',
    energy: { morning: 'high', noon: 'medium', evening: 'medium', night: 'low' },
    blocks: [],
  };
  const MIN_SLOT = 15, FILL = 0.8, MAX_ITEMS = 5;

  const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim()); return m ? Math.min(1440, +m[1] * 60 + +m[2]) : null; };
  const fmt = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  const dayName = (date) => DAYS[date.getDay()];
  const bandOf = (min) => (BANDS.find(b => min >= b[0] && min < b[1]) || BANDS[0])[2];

  // The student's settings with every missing or invalid field replaced by its default.
  function settings(p) {
    p = p && typeof p === 'object' ? p : {};
    let from = toMin(p.studyFrom), to = toMin(p.studyTo);
    if (from == null || to == null || to - from < MIN_SLOT) { from = toMin(DEFAULTS.studyFrom); to = toMin(DEFAULTS.studyTo); }
    const energy = {};
    for (const b of ['morning', 'noon', 'evening', 'night']) energy[b] = LEVELS.includes(p.energy && p.energy[b]) ? p.energy[b] : DEFAULTS.energy[b];
    const blocks = (Array.isArray(p.blocks) ? p.blocks : []).map(b => ({ day: String(b && b.day || ''), from: toMin(b && b.from), to: toMin(b && b.to), name: String(b && b.name || '').slice(0, 60) }))
      .filter(b => DAYS.includes(b.day) && b.from != null && b.to != null && b.to > b.from).slice(0, 40);
    return { from, to, energy, blocks };
  }

  // Free time left today as slots { start, end, energy }, split where the part of the day changes.
  // calendar: the occurrences of the student's calendars ({ start, end } in ms, busy, allDay), see ical.js.
  function freeSlots(now, planner, timetable, calendar) {
    const p = settings(planner), today = dayName(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const busy = [];
    for (const c of (timetable && timetable.classes) || []) {
      if (String(c.day || '').replace(/^יום\s*/, '').trim() !== today) continue;
      const a = toMin(c.start), b = toMin(c.end);
      if (a != null && b != null && b > a) busy.push([a, b]);
    }
    const ymd = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    for (const x of (timetable && timetable.exams) || []) {
      const a = toMin(x.time);
      if (x.date === ymd && a != null) busy.push([Math.max(0, a - 30), a + 180]);
    }
    for (const b of p.blocks) if (b.day === today) busy.push([b.from, b.to]);
    // A meeting of the calendar takes only the part that falls today. A whole day or a "free" event takes nothing.
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const minOf = (ms) => (ms >= dayEnd ? 1440 : ms <= dayStart ? 0 : new Date(ms).getHours() * 60 + new Date(ms).getMinutes());
    for (const o of calendar || []) {
      if (!o || !o.busy || o.allDay || !(o.end > dayStart && o.start < dayEnd)) continue;
      const a = minOf(o.start), b = minOf(o.end);
      if (b > a) busy.push([a, b]);
    }
    busy.sort((a, b) => a[0] - b[0]);

    const start = Math.max(p.from, Math.ceil((nowMin + 5) / 5) * 5);
    const free = [];
    let cur = start;
    for (const [a, b] of busy) {
      if (b <= cur) continue;
      if (a > cur) free.push([cur, Math.min(a, p.to)]);
      cur = Math.max(cur, b);
      if (cur >= p.to) break;
    }
    if (cur < p.to) free.push([cur, p.to]);

    const slots = [];
    for (const [a, b] of free) {
      let s = a;
      while (s < b) {
        const band = BANDS.find(x => s >= x[0] && s < x[1]) || BANDS[0];
        const e = Math.min(b, band[1]);
        if (e - s >= MIN_SLOT) slots.push({ start: s, end: e, energy: p.energy[band[2]] });
        s = e;
      }
    }
    return slots;
  }

  // How much an item matters now. Overdue and near deadlines first, then a close exam, then reviews, then undated tasks.
  function score(item) {
    if (item.kind === 'deadline') {
      if (item.days == null) return 10;
      return item.days < 0 ? 100 : item.days < 1 ? 80 : item.days < 2 ? 60 : item.days <= 7 ? 30 : 0;
    }
    if (item.kind === 'exam') return item.days <= 14 ? 50 + Math.max(0, 14 - item.days) : 0;
    if (item.kind === 'review') return 40 + Math.min(10, item.overdueDays || 0) * 2;
    return 0;
  }

  const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);
  const dayDiff = (a, b) => Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);

  // What could be done: deadlines (Moodle and the student's own tasks), the next exam of each course, and the card reviews.
  function candidates(ctx) {
    const now = ctx.now || new Date();
    const items = [];
    for (const e of ctx.events || []) {
      if (!e.when) { if (e.manual) items.push({ kind: 'deadline', title: e.name, course: e.course === 'מטלה אישית' ? '' : e.course, days: null, minutes: 45, heavy: true, ref: e }); continue; }
      const days = dayDiff(new Date(e.when * 1000), now);
      if (days > 7) continue;
      items.push({ kind: 'deadline', title: e.name, course: e.course === 'מטלה אישית' ? '' : e.course, days: e.overdue ? Math.min(-1, days) : days, minutes: 60, heavy: true, ref: e });
    }
    const seen = new Set();
    for (const x of ((ctx.timetable && ctx.timetable.exams) || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      if (!x.date || seen.has(x.course)) continue;
      const days = dayDiff(new Date(x.date + 'T12:00:00'), now);
      if (days < 0) continue;
      seen.add(x.course);
      if (days <= 21) items.push({ kind: 'exam', title: 'הכנה למבחן: ' + x.course, course: x.course, days, minutes: 90, heavy: true, ref: x });
    }
    const r = ctx.review;
    if (r && r.count > 0) items.push({ kind: 'review', title: 'חזרה על כרטיסי זיכרון (' + r.count + ')', course: '', cards: r.count, overdueDays: r.overdueDays || 0, minutes: Math.min(30, round5(r.count * 0.4)), heavy: false, ref: r });
    for (const it of items) it.score = score(it);
    return items.filter(i => i.score > 0).sort((a, b) => b.score - a.score);
  }

  // The plan for today. With opts.quick (minutes) the times are dropped and the most important things that fit are taken.
  function planDay(ctx, opts) {
    opts = opts || {};
    const now = ctx.now || new Date();
    const items = candidates(ctx);
    if (opts.quick > 0) {
      const out = []; let left = opts.quick;
      for (const it of items) {
        const minutes = it.kind === 'review' ? Math.min(it.minutes, left) : it.minutes;
        if (minutes < 5 || (it.kind !== 'review' && minutes > left)) continue;
        out.push(Object.assign({}, it, { minutes, start: null, end: null })); left -= minutes;
        if (out.length >= MAX_ITEMS || left < 5) break;
      }
      return { items: out, quick: true, freeMinutes: opts.quick, noSlots: false };
    }
    const slots = freeSlots(now, ctx.planner, ctx.timetable, ctx.calendar);
    const total = slots.reduce((n, s) => n + (s.end - s.start), 0);
    if (!total) return { items: items.slice(0, 3).map(i => Object.assign({}, i, { start: null, end: null })), freeMinutes: 0, noSlots: true };
    const order = (heavy) => (heavy ? ['high', 'medium', 'low'] : ['low', 'medium', 'high']);
    const out = []; let used = 0;
    for (const it of items) {
      if (out.length >= MAX_ITEMS) break;
      if (out.length && used + it.minutes > total * FILL) continue;
      let slot = null;
      for (const level of order(it.heavy)) {
        slot = slots.find(s => s.energy === level && s.end - s.start >= it.minutes);
        if (slot) break;
      }
      if (!slot) continue;
      out.push(Object.assign({}, it, { start: slot.start, end: slot.start + it.minutes, energy: slot.energy }));
      slot.start += it.minutes; used += it.minutes;
    }
    out.sort((a, b) => a.start - b.start);
    return { items: out, freeMinutes: total, noSlots: false };
  }

  const api = { DAYS, DEFAULTS, toMin, fmt, bandOf, settings, freeSlots, score, candidates, planDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Planner = api;
})(typeof window !== 'undefined' ? window : globalThis);
