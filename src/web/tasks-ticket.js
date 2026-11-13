// The tasks ticket in the sidebar: pure functions (no DOM), so they can be tested in Node. Everything that is due, from four places
// the page already has: the student's own tasks, the Moodle deadlines, the homework dates typed for a lecture, and the important
// dates the AI read from the syllabus. Sorted by date, and on the same day by how much it matters.
(function (root) {
  const SYLLABUS_DAYS = 60;   // a date from the syllabus further away than this is not shown yet
  const MOODLE_PAST_DAYS = 3;   // a Moodle deadline that passed stays this long, as on the home page
  // On the same day: a Moodle submission first, then homework, the student's own task, and a date from the syllabus.
  const RANK = { moodle: 0, homework: 1, mine: 2, syllabus: 3 };
  const EXAM = /מבחן|בוחן|מועד|בחינה|exam|quiz|test|midterm/i;
  const GROUPS = [['overdue', 'באיחור'], ['today', 'היום'], ['tomorrow', 'מחר'], ['week', 'השבוע'], ['later', 'בהמשך'], ['none', 'בלי תאריך']];

  const pad = (n) => String(n).padStart(2, '0');
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const localDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  // Whole days from one YYYY-MM-DD to another (UTC on both sides, so a change of clock does not matter).
  const days = (from, to) => { const u = (s) => { const p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }; return Math.round((u(to) - u(from)) / 86400000); };
  const groupOf = (d) => d == null ? 'none' : d < 0 ? 'overdue' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : d <= 7 ? 'week' : 'later';
  // A short stable id for a date from the syllabus, so adding it to the student's own tasks hides the original.
  function syllabusId(course, date, what) {
    let h = 5381; const s = course + '|' + date + '|' + what;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return 'syl-' + date + '-' + h.toString(36);
  }

  // { tasks, events, courses, today: 'YYYY-MM-DD' } -> the open items, most pressing first.
  function items(input) {
    const o = input || {}, today = isDate(o.today) ? o.today : localDate(new Date());
    const tasks = Array.isArray(o.tasks) ? o.tasks : [], events = Array.isArray(o.events) ? o.events : [], courses = Array.isArray(o.courses) ? o.courses : [];
    const taskIds = new Set(tasks.map(t => t && t.id).filter(Boolean));
    const out = [];
    const add = (it) => { const d = it.date ? days(today, it.date) : null; out.push(Object.assign(it, { days: d, overdue: d != null && d < 0, group: groupOf(d) })); };
    for (const t of tasks) {
      if (!t || t.done || !String(t.title || '').trim()) continue;
      add({ id: 'mine-' + t.id, source: 'mine', title: String(t.title).trim(), course: t.course || '', date: isDate(t.due) ? t.due : '', exam: false, taskId: t.id });
    }
    for (const e of events) {
      if (!e || e.manual || !e.when) continue;
      const date = localDate(new Date(e.when * 1000));
      if (days(today, date) < -MOODLE_PAST_DAYS) continue;
      add({ id: 'moodle-' + (e.id || e.name), source: 'moodle', title: String(e.name || e.title || 'מטלה ב-Moodle'), course: e.course || '', date, exam: EXAM.test(e.name || ''), url: e.url || '' });
    }
    for (const c of courses) {
      const local = c && c.local; if (!local) continue;
      for (const l of Array.isArray(local.lectures) ? local.lectures : []) {
        if (!l || !isDate(l.due) || days(today, l.due) < 0) continue;
        add({ id: 'homework-' + c.name + '-' + l.num, source: 'homework', title: 'תרגיל בית של הרצאה ' + l.num + (l.title ? ' · ' + l.title : ''), course: c.name, date: l.due, exam: false, courseId: c.id, lecture: l.num });
      }
      const info = local.info;
      for (const x of info && Array.isArray(info.importantDates) ? info.importantDates : []) {
        if (!x || !isDate(x.date) || !String(x.what || '').trim()) continue;
        const d = days(today, x.date); if (d < 0 || d > SYLLABUS_DAYS) continue;
        const sid = syllabusId(c.name, x.date, String(x.what).trim());
        if (taskIds.has(sid)) continue;   // already copied to the student's own tasks
        add({ id: sid, source: 'syllabus', title: String(x.what).trim(), course: c.name, date: x.date, exam: EXAM.test(x.what), courseId: c.id });
      }
    }
    // An exam moves ahead of everything else on its day.
    const rank = (it) => it.exam ? -1 : RANK[it.source];
    out.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || rank(a) - rank(b) || a.title.localeCompare(b.title));
    return out;
  }

  // For the chip: how many, how urgent (bad: overdue or today, warn: within 3 days) and the nearest one.
  function summary(list) {
    const open = Array.isArray(list) ? list : [];
    const level = open.some(i => i.days != null && i.days <= 0) ? 'bad' : open.some(i => i.days != null && i.days <= 3) ? 'warn' : '';
    const next = open.find(i => i.date) || open[0] || null;
    return { count: open.length, level, next };
  }

  // The items the host reminds about the day before (macOS): those due within the next two days.
  function reminders(list) {
    return (Array.isArray(list) ? list : []).filter(i => i.days != null && i.days >= 0 && i.days <= 2)
      .slice(0, 50).map(i => ({ id: i.id, title: i.title, course: i.course, date: i.date }));
  }

  // The words for when it is due, as on the home page.
  function when(it) {
    const d = it.days;
    return d == null ? 'בלי תאריך' : d < -1 ? 'לפני ' + -d + ' ימים' : d === -1 ? 'אתמול' : d === 0 ? 'היום' : d === 1 ? 'מחר' : 'בעוד ' + d + ' ימים';
  }

  const api = { GROUPS, items, summary, reminders, when, syllabusId, localDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TasksTicket = api;
})(typeof window !== 'undefined' ? window : globalThis);
