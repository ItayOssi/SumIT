// Demo host for ui.html?demo=1: answers the page with sample data, for screenshots and visual QA.
(function () {
  const listeners = [];
  // The goals of the demo blocks: study methods, as study-track.js makes them from the course folders.
  // Each course has its own goals: homework and a past exam first, then one method a lecture (theory: Feynman first; math: exercises
  // first), and fewer than 15 cards due at the end of the first block.
  const DEMO_GOALS = {
    'מבני נתונים': ['פתור את תרגיל הבית של הרצאה 4 (עצי AVL)',
      'תרגיל מבחן קודם בתנאי מבחן, ובדיקה של מה לקח הכי הרבה זמן',
      'שיטת פיינמן: בחר רעיון מרכזי מהסיכום של הרצאה 3 (ערימות) והסבר אותו בקול במילים פשוטות, כאילו אתה מלמד חבר. איפה שנתקעת, חזור לסיכום',
      'תרגול: פתור 2 תרגילים מדף התרגול של הרצאה 2 לבד, ורק אז הצץ בפתרון'],
    'אלגברה לינארית 2': ['תרגול: פתור 2 תרגילים מדף התרגול של הרצאה 5 (ערכים עצמיים) לבד, ורק אז הצץ בפתרון, ובסוף הבלוק: 14 כרטיסיות שמחכות לחזרה',
      'שיטת פיינמן: בחר רעיון מרכזי מהסיכום של הרצאה 4 והסבר אותו בקול במילים פשוטות, כאילו אתה מלמד חבר. איפה שנתקעת, חזור לסיכום',
      'בוחן: ענה על הבוחן של הרצאה 3 בלי להציץ בסיכום, וחזור רק לשאלות שטעית בהן'],
  };
  const DEMO_OTHER = ['שיטת פיינמן: בחר רעיון אחד מההרצאה האחרונה והסבר אותו בקול במילים פשוטות, כאילו אתה מלמד חבר. איפה שנתקעת, חזור לחומר',
    'שליפה מהזיכרון: כתוב על דף ריק כל מה שאתה זוכר מההרצאה האחרונה, ואז השווה לחומר וסמן מה חסר'];
  const demoGoal = (course, k) => (DEMO_GOALS[course] || DEMO_OTHER)[k % (DEMO_GOALS[course] || DEMO_OTHER).length];
  // A calendar for the screenshots: a meeting today, one tomorrow, and a weekly one.
  const demoCalendar = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0'), stamp = (x, h, m) => '' + x.getFullYear() + p(x.getMonth() + 1) + p(x.getDate()) + 'T' + p(h) + p(m) + '00';
    const later = new Date(d.getTime() + 3 * 3600000), tomorrow = new Date(d.getTime() + 86400000);
    const ev = (uid, title, s, e, extra) => ['BEGIN:VEVENT', 'UID:' + uid, 'SUMMARY:' + title, 'DTSTART:' + s, 'DTEND:' + e].concat(extra || [], ['END:VEVENT']).join('\r\n');
    return { id: '0123456789abcdef0123456789abcdef', name: 'Google', source: 'url', host: 'calendar.google.com', updated: Date.now() - 4 * 60000, error: '',
      ics: ['BEGIN:VCALENDAR', 'VERSION:2.0',
        ev('1', 'פגישה עם המנחה', stamp(later, later.getHours(), 0), stamp(later, later.getHours() + 1, 0), ['LOCATION:חדר 304']),
        ev('2', 'אימון כושר', stamp(tomorrow, 9, 30), stamp(tomorrow, 10, 30)),
        ev('3', 'קבוצת לימוד', stamp(d, 19, 0), stamp(d, 20, 0), ['RRULE:FREQ=WEEKLY']),
        ev('4', 'עבודה', stamp(d, 15, 0), stamp(d, 18, 30), ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE']),
        ev('5', 'רופא שיניים', stamp(d, 10, 15), stamp(d, 11, 0), ['RRULE:FREQ=WEEKLY;COUNT=1;BYDAY=TU']),
        ['BEGIN:VEVENT', 'UID:6', 'SUMMARY:יום הולדת לאמא', 'DTSTART;VALUE=DATE:' + stamp(tomorrow, 0, 0).slice(0, 8), 'END:VEVENT'].join('\r\n'), 'END:VCALENDAR'].join('\r\n') };
  };
  const emit = (data, delay = 250) => setTimeout(() => listeners.forEach(fn => fn({ data })), delay);
  const now = Math.floor(Date.now() / 1000);
  // The study track (track-ui.js): a small profile kept in memory, so that every button of the page does something in the demo.
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const trackProfile = { version: 1, name: '', created: iso(new Date()), strategies: {}, plan: { weekStart: '', blocks: [] }, progress: {}, log: [],
    routine: { done: false, wake: '07:30', sleep: '23:30', peak: 'morning', days: [0, 1, 2, 3, 4], hours: 10, block: 45, commitments: [], updated: '' },
    courses: [{ name: 'מבני נתונים', level: 3, hoursPerWeek: 0, examDate: iso(new Date(Date.now() + 12 * 86400000)), notes: '', manual: false }, { name: 'אלגברה לינארית 2', level: 2, hoursPerWeek: 0, examDate: '', notes: '', manual: false }] };
  // The demo's streak: 4 days before today were done (one kept by a freeze), so the flame waits for a block marked done today.
  const demoStreak = (p, today) => {
    const t = iso(today), back = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
    const done = new Set([back(5), back(4), back(3), back(1)].concat(p.log.filter(e => e.block).map(e => e.date))), frozen = back(2), todayDone = done.has(t);
    const current = 4 + (todayDone ? 1 : 0), ws = new Date(today); ws.setDate(ws.getDate() - ws.getDay());
    const week = []; for (let i = 0; i < 7; i++) { const d = new Date(ws); d.setDate(d.getDate() + i); const di = iso(d); week.push({ date: di, state: done.has(di) ? 'done' : di === frozen ? 'frozen' : di === t ? 'today' : di > t ? 'future' : 'missed' }); }
    return { current, best: Math.max(9, current), todayDone, atRisk: !todayDone, freezes: 1, week, next: 7, prev: 3, milestone: 0 };
  };
  // Sparks for the demo, shaped like sparksInfo in study-track.js (the real numbers come from the host).
  const DEMO_W = [[/^(תרגיל מבחן קודם|פתור מבחן קודם)/, 3], [/^(פתור את תרגיל הבית|תרגול)/, 2.5], [/^(שיטת פיינמן|שליפה)/, 2], [/^בוחן/, 1.5], [/^(כרטיסיות|חזרה מרווחת)/, 1]];
  const demoBase = (b) => Math.round(Math.min(180, b.minutes) / 15 * 10 * ((DEMO_W.find(x => x[0].test(b.goal || '')) || [0, 1])[1]));
  const DEMO_AWARDS = [['flame', 'streak', 'fire', 'להבה בוערת', 'ימים ברצף', [3, 7, 14], 12], ['freeze', 'streak', 'ice', 'שומר על הקור', 'הקפאות שהצילו את הרצף', [1, 3, 10], 1],
    ['perfect', 'streak', 'calendar', 'שבוע מושלם', 'שבועות שכל הבלוקים בהם בוצעו', [1, 5, 15], 1], ['spread', 'streak', 'books', 'פיזור חכם', 'שבועות שבהם כל קורס קיבל בלוק', [1, 5, 10], 6],
    ['crown', 'streak', 'crown', 'מאה ימים', 'רצף ארוך במיוחד', [30, 100, 365], 12], ['practice', 'methods', 'muscle', 'מכונת תרגול', 'תרגילים מדפי התרגול ומתרגילי הבית', [25, 100, 250], 23],
    ['feynman', 'methods', 'speak', 'מורה מלידה', 'בלוקים בשיטת פיינמן', [10, 25, 50], 32], ['elephant', 'methods', 'elephant', 'זיכרון של פיל', 'כרטיסיות שעברת', [100, 500, 1000], 1240],
    ['recall', 'methods', 'brain', 'דף ריק', 'שליפות מהזיכרון', [5, 15, 30], 9], ['exam', 'methods', 'shield', 'מוכן לקרב', 'מבחנים קודמים בשבועיים שלפני המבחן', [1, 3, 6], 0],
    ['perfectQuiz', 'quiz', 'hundred', 'מושלם', '100% בבוחן', [1, 5, 10], 5], ['comeback', 'quiz', 'rocket', 'קאמבק', 'שיפור של 30% ויותר בבוחן חוזר', [1, 3, 5], 1],
    ['early', 'quiz', 'sunrise', 'ציפור מוקדמת', 'בלוקים שהתחילו לפני 8:00', [1, 5, 15], 2], ['variety', 'quiz', 'gem', 'שלוש שיטות ביום', 'ימים עם שלוש שיטות למידה שונות', [1, 5, 10], 0],
    ['return', 'quiz', 'star', 'חוזר לעניינים', 'רצף חדש אחרי שהקודם נשבר', [1, 3, 5], 0]];
  const demoSparks = (p) => {
    const done = p.plan.blocks.filter(b => b.done).reduce((n, b) => n + Math.round(demoBase(b) * 1.1), 0), total = 1240 + done;
    const lv = total >= 1400 ? { level: 8, name: 'מומחה', from: 1400, to: 1960, next: 'מומחה' } : { level: 7, name: 'מתרגל', from: 920, to: 1400, next: 'מומחה' };
    const awards = DEMO_AWARDS.map(([id, group, emoji, title, desc, tiers, value]) => { if (id === 'practice') value += p.plan.blocks.filter(b => b.done && /^תרגול/.test(b.goal)).length * 2; const tier = tiers.filter(t => value >= t).length; return { id, group, emoji, title, desc, hidden: ['early', 'variety', 'return'].includes(id), tier, value, tiers, next: tiers[tier] || 0 }; });
    const blocks = {}; p.plan.blocks.forEach(b => { blocks[b.id] = demoBase(b); });
    const t = [1, 2, 3].map(k => awards.filter(a => a.tier >= k).length);
    const str = demoStreak(p, new Date()).current, tiers = [[3, 1.1], [7, 1.25], [14, 1.5], [30, 2]], mult = tiers.reduce((m, [d, x]) => (str >= d ? x : m), 1), nt = tiers.find(([d]) => d > str);
    return { total, bonus: 0, level: lv, streak: str, mult, multNext: mult, nextTier: nt ? { days: nt[0] - str, mult: nt[1] } : null, tiers, today: done, week: { earned: 246 + done, goal: 520 }, blocks, awards,
      count: { bronze: t[0], silver: t[1], gold: t[2], reached: t[0], all: awards.length, hidden: awards.filter(a => a.hidden && !a.tier).length } };
  };
  const trackSnapshot = (extra) => {
    const today = new Date(), ws = new Date(today); ws.setDate(ws.getDate() - ws.getDay());
    const p = trackProfile, wsIso = iso(ws), wl = p.log.filter(e => e.date >= wsIso), per = {};
    p.courses.forEach(c => { per[c.name] = { week: wl.filter(e => e.course === c.name).reduce((n, e) => n + e.minutes, 0), total: p.log.filter(e => e.course === c.name).reduce((n, e) => n + e.minutes, 0), topicsDone: ((p.progress[c.name] || {}).topics || []).filter(t => t.done).length, topics: ((p.progress[c.name] || {}).topics || []).length }; });
    const bl = p.plan.blocks;
    return Object.assign({ type: 'trackState', profile: JSON.parse(JSON.stringify(p)), today: iso(today), weekStart: wsIso, classes: 0, calendars: 1, window: { from: '08:30', to: '22:30' },
      suggested: ['פיזיקה 1', 'חשבון אינפיניטסימלי 2'].filter(n => !p.courses.some(c => c.name === n)).map(name => ({ name, where: 'מערכת השעות' })),
      sparks: demoSparks(p),
      stats: { weekStart: wsIso, plannedMinutes: bl.reduce((n, b) => n + b.minutes, 0), plannedBlocks: bl.length, doneBlocks: bl.filter(b => b.done).length, weekMinutes: wl.reduce((n, e) => n + e.minutes, 0), totalMinutes: p.log.reduce((n, e) => n + e.minutes, 0), streak: demoStreak(p, today).current, streakInfo: demoStreak(p, today), perCourse: per } }, extra || {});
  };
  let demoBoard = null;
  const trackDemo = (m) => {
    const p = trackProfile, c = p.courses.find(x => x.name === m.course);
    if (m.op === 'load') return emit(trackSnapshot(), 200);
    if (m.op === 'addCourses') (m.courses || []).forEach(x => { if (!p.courses.some(y => y.name === x.name)) p.courses.push({ name: x.name, level: 2, hoursPerWeek: 0, examDate: x.examDate || '', notes: '', manual: !!x.manual }); });
    if (m.op === 'editCourse' && c) Object.assign(c, m.values);
    if (m.op === 'removeCourse') p.courses = p.courses.filter(x => x.name !== m.course);
    if (m.op === 'name') p.name = m.value;
    if (m.op === 'log' && c) p.log.push({ date: iso(new Date()), course: m.course, minutes: m.minutes, note: '', block: '' });
    if (m.op === 'topic' && c) { const row = p.progress[m.course] || (p.progress[m.course] = { topics: [] }); if (m.act === 'add') row.topics.push({ id: 't' + row.topics.length + Date.now(), title: m.title, done: false }); const t = row.topics.find(x => x.id === m.id); if (t && m.act === 'toggle') t.done = !t.done; if (t && m.act === 'remove') row.topics = row.topics.filter(x => x !== t); }
    if (m.op === 'done' || m.op === 'undo') { const b = p.plan.blocks.find(x => x.id === m.id); if (b) { p.log = p.log.filter(e => e.block !== b.id); b.done = m.op === 'done'; b.doneMinutes = b.done ? b.minutes : 0; if (b.done) p.log.push({ date: iso(new Date()), course: b.course, minutes: b.minutes, note: b.goal, block: b.id }); }
      // Done: the sparks it gave, and on the first one an achievement, as the host sends them.
      if (b && b.done) {
        const before = demoSparks(Object.assign({}, p, { plan: { blocks: p.plan.blocks.filter(x => x !== b) } })), after = demoSparks(p);
        const unlocked = p.plan.blocks.filter(x => x.done).length === 1 ? [{ id: 'practice', title: 'מכונת תרגול', desc: 'תרגילים מדפי התרגול ומתרגילי הבית', emoji: 'muscle', tier: 1, sparks: 50 }] : [];
        return emit(trackSnapshot({ sparkGain: { points: after.total - before.total, mult: after.mult, total: after.total }, unlocked, levelUp: after.level.level > before.level.level ? after.level : null, sparkBlock: b.id }), 150);
      }
    }
    if (m.op === 'blockSave') {
      const ws = trackSnapshot().weekStart; if (!p.plan.weekStart) p.plan.weekStart = ws;
      const b = p.plan.blocks.find(x => x.id === m.id);
      if (b) Object.assign(b, { course: m.course, day: m.day, start: m.start, minutes: m.minutes, goal: m.goal || 'לימוד' });
      else p.plan.blocks.push({ id: 'm' + Date.now(), day: m.day, start: m.start, minutes: m.minutes, course: m.course, goal: m.goal || 'לימוד', done: false, doneMinutes: 0 });
      p.plan.blocks.sort((a, c) => a.day - c.day || a.start.localeCompare(c.start));
    }
    if (m.op === 'removeBlock') p.plan.blocks = p.plan.blocks.filter(x => x.id !== m.id);
    // The wizard: two weekly commitments "from the calendar", ratings by the course name, and a plan built like the demo build.
    // The tasks, one of each kind, without what the week already has as a goal (as study-track.js does).
    if (m.op === 'tasks') {
      const all = [
        { id: 'h', course: 'מבני נתונים', folder: 'מבני נתונים', kind: 'homework', lecture: 4, title: 'פתור את תרגיל הבית של הרצאה 4 (עצי AVL)', why: 'ההגשה בעוד 2 ימים, והתרגיל בתיקייה', minutes: 60 },
        { id: 'e', course: 'מבני נתונים', folder: 'מבני נתונים', kind: 'exam', lecture: null, title: 'פתור מבחן קודם בתנאי מבחן, ורשום מה לקח הכי הרבה זמן', why: 'המבחן בעוד 12 ימים, ויש 3 מבחנים קודמים בתיקייה', minutes: 90 },
        { id: 's', course: 'אלגברה לינארית 2', folder: 'אלגברה לינארית 2', kind: 'summary', lecture: 5, title: 'צור סיכום להרצאה 5 (ערכים עצמיים) ולמד ממנו', why: 'יש 3 קבצים בתיקייה של ההרצאה, ועדיין אין סיכום, ועוד הרצאה אחת בלי סיכום', minutes: 30 },
        { id: 'r', course: 'אלגברה לינארית 2', folder: 'אלגברה לינארית 2', kind: 'review', lecture: null, title: 'חזור על 14 כרטיסי זיכרון', why: 'הגיע הזמן לחזור עליהם, לפי החזרה המרווחת', minutes: 15 },
        { id: 'c', course: 'מבני נתונים', folder: 'מבני נתונים', kind: 'cards', lecture: 3, title: 'צור כרטיסי זיכרון מהסיכום של הרצאה 3 (ערימות)', why: 'יש סיכום, ועוד אין ממנו כרטיסים לחזרה, ועוד 2 סיכומים בלי כרטיסים', minutes: 15 }];
      const planned = (t) => p.plan.blocks.some(b => b.course === t.course && (t.kind === 'homework' ? b.goal.startsWith(t.title)
        : t.kind === 'exam' ? b.goal.startsWith('תרגיל מבחן קודם') : t.kind === 'review' ? !b.done && b.goal.includes('כרטיסיות שמחכות') : false));
      const tasks = all.filter(t => !planned(t));
      return emit({ type: 'trackTasks', total: tasks.length, tasks }, 700);
    }
    if (m.op === 'routineScan') return emit({ type: 'trackRoutineScan', calendars: 1, events: 23, firstStart: '08:30', lastEnd: '19:00', busyByDay: [180, 420, 120, 390, 60, 0, 0],
      commitments: [{ title: 'עבודה', day: 1, start: '15:00', end: '20:00', weeks: 4, source: 'calendar' }, { title: 'אימון כושר', day: 3, start: '18:00', end: '19:30', weeks: 3, source: 'calendar' }],
      upcoming: [{ title: 'תור לרופא שיניים', date: iso(new Date(Date.now() + 3 * 86400000)), day: new Date(Date.now() + 3 * 86400000).getDay(), start: '10:00', end: '11:00', source: 'calendar' }] }, 900);
    if (m.op === 'ratings') {
      const ratings = {};
      (m.courses || []).forEach(n => { ratings[n] = /אלגברה|אינפי|פיזיקה|חשבון/.test(n) ? { level: 3, energy: 3, reasons: ['קורס מתמטי: לומדים דרך פתרון, וזה דורש ריכוז מלא'] } : /מבני נתונים/.test(n) ? { level: 3, energy: 2, reasons: ['קורס תיאוריה: הוכחות והבנה של למה', 'המבחן בעוד 12 ימים'] } : { level: 2, energy: 1, reasons: ['קורס של מושגים וזיכרון: אפשר ללמוד גם בשעות של פחות אנרגיה'] }; });
      return emit({ type: 'trackRatings', ratings }, 700);
    }
    if (m.op === 'wizardFinish') {
      p.routine = Object.assign({}, m.routine, { done: true, updated: iso(new Date()) });
      p.courses = (m.courses || []).map(c => Object.assign({ hoursPerWeek: 0, notes: '' }, p.courses.find(x => x.name === c.name) || {}, c));
      const ws = trackSnapshot().weekStart;
      p.plan = { weekStart: ws, blocks: p.courses.flatMap((x, i) => [0, 1].map(k => ({ id: 'b' + (i * 2 + k + 1), day: (i + k * 2) % 5, start: x.level * x.energy >= 6 ? '09:00' : '16:30', minutes: m.routine.block || 45, course: x.name, goal: demoGoal(x.name, k), done: false, doneMinutes: 0 }))).sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)) };
      return emit(trackSnapshot({ built: { unplaced: 0, blocks: p.plan.blocks.length }, wizardDone: true }), 1100);
    }
    if (m.op === 'build') {
      const ws = trackSnapshot().weekStart;
      p.plan = { weekStart: ws, blocks: p.courses.flatMap((x, i) => [0, 1].map(k => ({ id: 'b' + (i * 2 + k + 1), day: (i + k * 2) % 5, start: i ? '14:00' : '10:00', minutes: 60, course: x.name, goal: demoGoal(x.name, k), done: false, doneMinutes: 0 }))).sort((a, b) => a.day - b.day) };
      return emit(trackSnapshot({ built: { unplaced: 0, blocks: p.plan.blocks.length } }), 500);
    }
    if (m.op === 'strategy') {
      const days = c && c.examDate ? Math.round((new Date(c.examDate) - new Date(iso(new Date()))) / 86400000) : null, exam = days !== null && days >= 0 && days <= 21;
      const kinds = {
        'מבני נתונים': { summary: 'במבני נתונים מבינים דרך ציור והסבר בקול: כל מבנה מציירים לפני שמקודדים אותו.', steps: [
          { title: 'אחרי כל הרצאה: הסבר בקול (10 דקות)', detail: 'הסבר לעצמך את הרעיון המרכזי בשלוש משפטים, בלי להסתכל. הצלחת אם לא נתקעת באמצע.' },
          { title: 'צייר מצב לפני, צעד, מצב אחרי', detail: 'לכל פעולה על עץ או גרף צייר שלושה שלבים על דף, ובדוק מול הסיכום.' },
          { title: 'שחזר הוכחה אחת בשבוע', detail: 'קרא, סגור וכתוב. מה שלא יצא, קרא שוב ונסה שוב למחרת.' },
          { title: 'תרגיל בית: 15 דקות לבד', detail: 'כתוב מה ניסית לפני שאתה מסתכל ברמז.' }],
          thisWeek: ['כתוב מהזיכרון את הרעיון של ההרצאה האחרונה', 'חזור על 8 כרטיסי זיכרון שהגיע זמנם'], routine: ['הוכחה אחת בשבוע מהזיכרון', 'עשר דקות כרטיסים בכל יום'], avoid: ['לא לשנן הוכחה בלי להבין את הצעד הראשון'] },
        'אלגברה לינארית 2': { summary: 'באלגברה מבינים דרך פתרון: קריאת פתרון נותנת תחושה שהבנת, וזה לא אותו דבר.', steps: [
          { title: 'אחרי כל הרצאה: הגדרות ומשפטים', detail: 'כתוב כל הגדרה בלשון שלך ובדוגמה קטנה אחת. הצלחת אם אתה מסביר בלי הדף.' },
          { title: 'תרגול: 10 דקות לפני פתרון', detail: 'נסה לבד, ורק אז בדוק ורשום איפה נתקעת.' },
          { title: 'מחברת טעויות', detail: 'כל טעות עם הסיבה שלה, ושורה אחת על איך לזהות אותה בפעם הבאה.' },
          { title: 'חזרה אחרי יום, שלושה ימים ושבוע', detail: 'חמש דקות שליפה על כל נושא, ללא דף.' }],
          thisWeek: ['פתור שני תרגילים ממשפחה שטעית בה השבוע', 'עבור על ההגדרות של שני הפרקים האחרונים'], routine: ['תרגיל או שניים בכל יום', 'פעם בשבוע מבחן קטן על נייר'], avoid: ['לא לדלג על הגדרות כדי להגיע ישר לתרגילים'] },
      };
      const k = kinds[m.course] || { summary: 'בקורס כזה הזיכרון הוא העיקר: שליפה פעילה וחזרה מרווחת מנצחות קריאה חוזרת.', steps: [
        { title: 'אחרי כל הרצאה: סיכום מהזיכרון (10 דקות)', detail: 'סגור את החומר וכתוב מה שזכרת, ורק אז פתח והשלם.' },
        { title: 'כרטיסי זיכרון לכל מושג', detail: 'שאלה בצד אחד ותשובה בצד שני, ועשר דקות בכל יום.' },
        { title: 'דוגמה לכל מושג', detail: 'מושג בלי דוגמה נשכח מהר.' },
        { title: 'חזרה מרווחת', detail: 'אחרי יום, שלושה ימים ושבוע.' }], thisWeek: [], routine: ['עשר דקות כרטיסים בכל יום'], avoid: ['לא להשאיר הכל לשבוע האחרון'] };
      const steps = exam ? [{ title: 'המבחן בעוד ' + (days === 0 ? 'פחות מיום' : days + ' ימים'), detail: 'פתור מבחן קודם בתנאי מבחן, והתחל מהנושאים שאתה הכי פחות בטוח בהם.' }].concat(k.steps) : k.steps;
      return emit({ type: 'trackStrategy', course: m.course, strategy: { source: 'ai', summary: k.summary + (exam ? ' המבחן קרוב, אז מבחנים קודמים קודם.' : ''), steps, thisWeek: k.thisWeek, routine: k.routine, avoid: k.avoid } }, 900);
    }
    emit(trackSnapshot(), 120);
  };
  const courses = [
    { id: 101, name: 'חשבון אינפיניטסימלי 2', category: 'מדעי המחשב · שנה א', current: true, local: { exists: true, studyPages: 6, exams: 8 } },
    { id: 102, name: 'מבני נתונים', category: 'מדעי המחשב · שנה א', current: true, local: { exists: true, studyPages: 3, exams: 4 } },
    { id: 103, name: 'פיזיקה 1', category: 'הנדסת חשמל · שנה א', current: true, local: { exists: false } },
    { id: 104, name: 'אלגברה לינארית 2', category: 'מדעי המחשב · שנה א', current: true, local: { exists: true, studyPages: 1 } },
    { id: 105, name: 'מבוא למדעי המחשב', category: 'שנה קודמת', current: false, local: { exists: true, studyPages: 11 } }
  ];
  const events = [
    { name: 'תרגיל בית 5', course: 'חשבון אינפיניטסימלי 2', when: now + 26 * 3600, url: '', overdue: false },
    { name: 'מטלה 3: עצי AVL', course: 'מבני נתונים', when: now + 3 * 86400, url: '', overdue: false },
    { name: 'בוחן אמצע', course: 'פיזיקה 1', when: now + 9 * 86400, url: '', overdue: false },
    { name: 'תרגיל 4 - ערכים עצמיים', course: 'אלגברה לינארית 2', when: now + 12 * 86400, url: '', overdue: false }
  ];
  const lec = (num, title, items, local) => ({ num, title, items, local: Object.assign({ dir: 'D:\\HIT\\Courses\\x\\שיעור ' + num, exists: false, files: 0, videos: 0, transcripts: 0, studyPage: null }, local || {}) });
  const sections = [
    lec(0, 'מידע כללי', [{ mod: 'resource', name: 'סילבוס הקורס תשפ"ו' }, { mod: 'forum', name: 'הודעות' }]),
    lec(1, 'אינטגרל רימן', [{ mod: 'resource', name: 'הרצאה 1 - אינטגרל רימן' }, { mod: 'assign', name: 'תרגיל בית 1', dates: 'הגשה: 12 בנובמבר' }, { mod: 'zoom', name: 'הקלטת ההרצאה' }], { exists: true, files: 4, videos: 1, transcripts: 1, studyPage: 'x', lecturePdf: 'x', extraSummaries: [{ name: 'תמציתי · הכנה למבחן', page: 'x', pdf: 'x', notes: 'לכתוב סיכום תמציתי: רק העיקר, בלי הרחבות.' }] }),
    lec(2, 'המשפט היסודי', [{ mod: 'resource', name: 'הרצאה 2 - המשפט היסודי' }, { mod: 'resource', name: 'תרגול 2' }, { mod: 'zoom', name: 'הקלטה' }], { exists: true, files: 3, studyPage: 'x' }),
    lec(3, 'שיטות אינטגרציה', [{ mod: 'resource', name: 'הרצאה 3' }, { mod: 'assign', name: 'תרגיל בית 3' }], { exists: true, files: 2 }),
    lec(4, 'אינטגרלים מוכללים', [{ mod: 'resource', name: 'הרצאה 4' }, { mod: 'url', name: 'קישור להקלטה' }])
  ];
  const ai = { provider: 'claude', ready: true, setup: '', claude: { installed: true, loggedIn: true, email: 'student@example.com', plan: 'pro' }, gemini: { installed: false, hasKey: false } };
  const info = { lecturer: 'ד"ר כהן', officeHours: 'יום ב׳ 12:00-13:00', homeworkRequired: true, homeworkNote: '10% מהציון, צריך להגיש 8 מתוך 10',
    examFormat: '3 שעות, 5 שאלות פתוחות', materialsAllowed: 'דף נוסחאות אישי', attendance: 'לא חובה',
    grading: [{ component: 'מבחן סופי', weight: 80 }, { component: 'תרגילי בית', weight: 10 }, { component: 'בוחן אמצע', weight: 10 }],
    importantDates: [{ date: '2026-12-10', what: 'בוחן אמצע' }, { date: '2027-02-01', what: 'מועד א' }], tips: ['המרצה אוהב לשאול על התכנסות אינטגרלים מוכללים', 'בתרגילים - חובה לנמק כל מעבר'] };

  window.DemoEmit = emit;
  let demoSettings = null;
  window.DemoHost = {
    addEventListener: (t, fn) => listeners.push(fn),
    postMessage: (m) => {
      switch (m.type) {
        case 'ready':
          emit(demoSettings = { type: 'settings', institute: 'hit', moodleUrl: '', portalUrl: '', studyRoot: 'D:\\HIT\\Courses', recordingsDir: 'D:\\HIT\\Zoom Recordings', notabilityDir: '', aiProvider: 'claude', hasGeminiKey: false, onboarded: !location.search.includes('wizard'), userName: 'נועה לוי', version: '2.0.0' });
          emit({ type: 'aiStatus', status: ai }, 500);
          emit({ type: 'moodle', state: 'ready' }, 700);
          emit({ type: 'home', events: location.search.includes('empty') ? [] : events, name: 'נועה לוי' }, 1100);
          emit({ type: 'courses', data: courses }, 1300);
          {
            const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
            const cls = (d, start, end, course, kind, room) => ({ day: d, start, end, course, kind, room, lecturer: '' });
            emit({ type: 'timetable', data: {
              classes: [cls('ראשון', '10:00', '12:00', 'חשבון אינפיניטסימלי 2', 'הרצאה', 'בניין 8, 204'), cls('ראשון', '14:00', '16:00', 'מבני נתונים', 'הרצאה', 'בניין 2, 101'),
                cls('שני', '09:00', '11:00', 'אלגברה לינארית 2', 'הרצאה', 'בניין 8, 310'), cls('שלישי', '12:00', '14:00', 'פיזיקה 1', 'הרצאה', 'בניין 3, 015'),
                cls('רביעי', '10:00', '12:00', 'חשבון אינפיניטסימלי 2', 'תרגול', 'בניין 8, 112'), cls('חמישי', '14:00', '16:00', 'מבני נתונים', 'תרגול', 'בניין 2, 008')],
              exams: [{ course: 'חשבון אינפיניטסימלי 2', date: day(12), moed: 'א', time: '09:00', room: '' }, { course: 'מבני נתונים', date: day(19), moed: 'א', time: '13:00', room: '' },
                { course: 'אלגברה לינארית 2', date: day(26), moed: 'א', time: '09:00', room: '' }] } }, 1350);
          }
          emit({ type: 'job', id: 1, name: 'שיעור 2', state: 'running', status: 'מוריד וידאו · 46% מתוך 273MiB · נשארו 00:14', progress: 46 }, 1400);
          emit({ type: 'job', id: 2, name: 'שיעור 1', state: 'done', status: 'הווידאו והתמלול נשמרו', progress: 100, hasVideo: true, hasTranscript: true }, 1450);
          break;
        case 'loadCourses': emit({ type: 'courses', data: courses }, 600); break;
        case 'coachPing': emit({ type: 'coachReady' }, 300); break;
        case 'ticketPing': emit({ type: 'ticketReady' }, 300); break;
        // The institution: the choice is kept for the session; logos are not fetched in the demo (the badges stay).
        case 'setInstitute':
          demoSettings = Object.assign({}, demoSettings, { institute: m.institute, moodleUrl: m.moodleUrl || '', portalUrl: m.portalUrl || '' });
          emit(demoSettings, 120); break;
        case 'trackPing': emit({ type: 'trackReady' }, 300); break;
        // The Drive sync card: in the demo nothing reaches Google; "connect" pretends the browser said yes.
        case 'driveSync': {
          const base = { type: 'driveSync', ready: true, configured: true, busy: false, conflicts: [] };
          if (m.action === 'connect') { emit(Object.assign({}, base, { connecting: true, connected: false }), 100); emit(Object.assign({}, base, { connected: true, email: 'noa.levi@gmail.com', busy: true, progress: { done: 3, total: 8 } }), 1400); emit(Object.assign({}, base, { connected: true, email: 'noa.levi@gmail.com', last: new Date().toISOString(), text: 'סונכרן: 8 עלו. (בדמו לא עולים קבצים)' }), 2600); }
          else if (m.action === 'now') emit(Object.assign({}, base, { connected: true, email: 'noa.levi@gmail.com', last: new Date().toISOString(), text: 'הכל מעודכן.' }), 600);
          else if (m.action === 'disconnect') emit(Object.assign({}, base, { connected: false, text: 'התנתקת. הקבצים נשארו במחשב וב-Drive.' }), 300);
          else emit(Object.assign({}, base, { connected: false }), 200);
          break;
        }
        case 'track': trackDemo(m); break;
        // The friends leaderboard: two groups of made-up students, nothing leaves the page.
        case 'board': {
          const me = { uid: 'me', name: 'נועה', photo: '', me: true, level: 7, streak: 4, total: 1240, week: 0 };
          const sp = trackProfile && trackProfile.plan ? trackProfile.plan.blocks.filter(b => b.done).length * 60 : 0;
          me.week = 410 + sp;
          const rank = (list) => { list.sort((a, b) => b.week - a.week); list.forEach((x, i) => { x.rank = i > 0 && list[i - 1].week === x.week ? list[i - 1].rank : i + 1; }); return list; };
          if (!demoBoard) demoBoard = { groups: [{ code: 'K7Q2MX', name: 'חבורת אינפי 2' }, { code: 'FRND22', name: 'מבני נתונים' }] };
          if (m.op === 'create') { const code = 'H3WP8N'; demoBoard.groups.push({ code, name: (m.name || '').trim() || 'הקבוצה שלי' }); demoBoard.created = code; }
          if (m.op === 'join') { const code = String(m.code || '').toUpperCase().replace(/[\s-]/g, ''); if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) { emit({ type: 'board', configured: true, connected: true, groups: demoBoard.groups, max: 5, error: 'הקוד הוא 6 אותיות ומספרים, למשל K7Q2MX.' }, 200); break; } if (!demoBoard.groups.some(g => g.code === code)) demoBoard.groups.push({ code, name: 'סטטיסטיקה' }); demoBoard.joined = code; }
          if (m.op === 'leave') demoBoard.groups = demoBoard.groups.filter(g => g.code !== m.code);
          const people = {
            K7Q2MX: [{ uid: 'a', name: 'אורי', level: 9, streak: 12, total: 2860, week: 640 }, { uid: 'b', name: 'מאיה', level: 6, streak: 5, total: 1105, week: 455 },
              { uid: 'c', name: 'יונתן', level: 5, streak: 0, total: 830, week: 210 }, { uid: 'd', name: 'שירה', level: 3, streak: 2, total: 320, week: 95 }, { uid: 'e', name: 'דניאל', level: 2, streak: 0, total: 140, week: 0 }],
            FRND22: [{ uid: 'f', name: 'עידו', level: 4, streak: 3, total: 600, week: 120 }],
          };
          const list = demoBoard.groups.map(g => ({ code: g.code, name: g.name, members: rank([Object.assign({}, me)].concat((people[g.code] || []).map(x => Object.assign({ photo: '', me: false }, x)))) }));
          const out = { type: 'board', configured: true, connected: true, groups: demoBoard.groups.slice(), max: 5, list };
          if (m.op === 'create') { out.created = out.focus = demoBoard.created; }
          if (m.op === 'join') { out.joined = out.focus = demoBoard.joined; }
          emit(out, m.op === 'state' ? 150 : 500); break;
        }
        case 'exportTool':
          if (m.op === 'icloud') { [1, 2, 3].forEach(i => emit({ type: 'icloudExport', state: 'busy', course: m.course, done: i - 1, total: 3 }, 250 * i)); emit({ type: 'icloudExport', state: 'done', course: m.course, total: 3, added: 3, updated: 0, unchanged: 0, kept: 0, text: '3 סיכומים סונכרנו ל-iCloud (בדמו לא נכתבים קבצים)' }, 1100); break; }
          if (m.op === 'icloudReveal') break;
          emit({ type: 'toast', text: 'בדמו לא נכתבים קבצים. באפליקציה האמיתית נפתח חלון שמירה.', error: false }, 300); break;
        case 'blockPing': emit({ type: 'blockReady' }, 300); break;
        case 'blockPlan': emit({ type: 'blockResult', requestId: m.requestId, source: 'ai', minutes: m.minutes, steps: [
          { title: 'כתוב על דף מה אתה כבר יודע על "' + m.title + '", בלי להסתכל בשום דבר', minutes: 5, kind: 'recall', why: 'מתחילים משליפה מהזיכרון.' },
          { title: 'למד נושא אחד חדש, והעתק לדף את הדוגמה הקטנה ביותר שלו', minutes: Math.max(5, Math.round(m.minutes * 0.4)), kind: 'learn', why: 'נושא אחד בכל פעם.' },
          { title: 'נסה לעשות בעצמך משהו קטן עם מה שלמדת', minutes: Math.max(5, m.minutes - 5 - Math.max(5, Math.round(m.minutes * 0.4)) - 5), kind: 'practice', why: 'ניסיון בעצמך מחזק זיכרון.' },
          { title: 'סגור הכל וכתוב מה למדת ומה עדיין לא ברור', minutes: 5, kind: 'review', why: 'שליפה מהזיכרון בסוף.' }] }, 1200); break;
        case 'stuckHelp': emit({ type: 'stuckResult', requestId: m.requestId, source: 'ai', steps: [
          { title: 'כתוב על דף שלושה דברים שאתה זוכר מהקורס "' + m.course + '", בלי להסתכל בשום דבר', minutes: 3, kind: 'start', lecture: null, why: 'מתחילים משליפה מהזיכרון, וזה גם מראה מה כבר יודעים.' },
          { title: 'נסה את שיעורי הבית של הרצאה 5 לפני שאתה מסתכל בפתרון המודרך', minutes: 25, kind: 'practice', lecture: 5, why: 'ההגשה בעוד יומיים, וניסיון לפתור מחזק זיכרון.' },
          { title: 'חזור על 12 כרטיסי זיכרון של הקורס', minutes: 5, kind: 'cards', lecture: null, why: 'חזרה קצרה מונעת שכחה.' },
          { title: 'קבע מתי אתה חוזר לזה מחר, ורשום את זה', minutes: 3, kind: 'plan', lecture: null, why: 'כשקובעים מתי, יותר סיכוי שעושים.' }] }, 1300); break;
        case 'getCalendars': case 'refreshCalendars': case 'addCalendar': emit({ type: 'calendars', list: [demoCalendar()] }, 350); if (m.type !== 'getCalendars') emit({ type: 'calendarStatus', busy: false, text: m.type === 'addCalendar' ? 'היומן נוסף' : '', error: false }, 700); break;
        case 'importCalendarFile': case 'removeCalendar': break;
        case 'calSync': {
          const cs = window.__demoCalSync || (window.__demoCalSync = { on: false, calendar: '', nth: 0, count: 0, last: 0 });
          if (m.action === 'list') { emit(Object.assign({ type: 'calSync', error: '', busy: false, calendars: [{ name: 'לוח שנה', nth: 0 }, { name: 'noa@gmail.com', nth: 0 }, { name: 'משפחה', nth: 0 }] }, cs), 500); break; }
          if (m.action === 'set') Object.assign(cs, { on: true, calendar: m.calendar, nth: m.nth || 0, count: 4, last: Date.now() });
          if (m.action === 'now') cs.last = Date.now();
          if (m.action === 'off') Object.assign(cs, { on: false, count: 0 });
          emit(Object.assign({ type: 'calSync', error: '', busy: false }, cs), m.action === 'state' ? 150 : 600);
          if (m.action === 'set' || m.action === 'now') emit({ type: 'toast', text: 'היומן עודכן: 4 אירועים' }, 650);
          break;
        }
        case 'getReviewQueue': emit({ type: 'reviewQueue', count: 14, due: 6, fresh: 8, overdueDays: 2, courses: { 'מבני נתונים': 6 } }, 400); break;
        case 'startReview': emit({ type: 'reviewSession', cards: [
          { key: 'a1b2c3d4e5f6', front: 'מה הסיבוכיות של חיפוש בינארי במערך ממוין?', back: 'O(log n): בכל צעד חצי מהמערך נפסל.', tag: 'סיבוכיות', course: 'מבני נתונים', title: 'הרצאה 3', num: 3, path: '/x/3.html' },
          { key: 'b1b2c3d4e5f6', front: 'הגדר: גבול של סדרה', back: 'לכל $\\varepsilon>0$ קיים $N$ כך שלכל $n>N$ מתקיים $|a_n-L|<\\varepsilon$.', tag: 'הגדרה', course: 'חשבון אינפיניטסימלי 2', title: 'הרצאה 5', num: 5, path: '/x/5.html' },
          { key: 'c1b2c3d4e5f6', front: 'מתי מטריצה הפיכה?', back: 'כשהדטרמיננטה שלה שונה מאפס.', tag: '', course: 'אלגברה לינארית 2', title: 'הרצאה 2', num: 2, path: '/x/2.html' }] }, 200); break;
        case 'rateCard': case 'savePlanner': break;
        case 'quiz': {
          ['מחלץ רעיונות וטעויות נפוצות', 'כותב שאלות', 'בודק מול הסיכום'].forEach((text, i) => emit({ type: 'quizProgress', requestId: m.requestId, path: m.path, step: i + 1, steps: 3, text }, 250 + i * 600));
          emit({ type: 'quizResult', requestId: m.requestId, path: m.path, attempts: [{ date: '2026-11-12', right: 4, total: 6 }], questions: [
            { type: 'mcq', tag: 'סכומי רימן', q: 'חלוקה $P$ של $[0,1]$ מעודנת לחלוקה $P\'$ (נוספו נקודות). מה נכון תמיד?',
              options: ['$U(f,P\') \\le U(f,P)$ ו-$L(f,P\') \\ge L(f,P)$', '$U(f,P\') \\ge U(f,P)$ ו-$L(f,P\') \\le L(f,P)$', '$U(f,P\') = U(f,P)$ כי $f$ לא השתנתה', 'אין קשר בין הסכומים לפני העידון ואחריו'],
              answer: 0, why: ['עידון רק מקטין את הסכום העליון ומגדיל את התחתון: בכל תת-קטע ה-sup קטן או שווה.', 'זה הכיוון ההפוך, טעות נפוצה כשמבלבלים sup ו-inf.', 'הסכום תלוי בחלוקה, לא רק בפונקציה.', 'יש קשר: זו בדיוק הלמה שעליה נשען קריטריון האינטגרביליות.'] },
            { type: 'tf', tag: 'אינטגרביליות', q: 'כל פונקציה חסומה על $[a,b]$ היא אינטגרבילית רימן.', answer: false, why: 'לא נכון: פונקציית דיריכלה חסומה אבל $U-L=1$ לכל חלוקה. חסימות היא תנאי הכרחי, לא מספיק.' },
            { type: 'cloze', tag: 'המשפט היסודי', q: 'אם $f$ רציפה ו-$F(x)=\\int_a^x f(t)\\,dt$ אז $F\'(x)=$ ____', answer: 'f(x)', accept: ['f'], why: 'זה החלק הראשון של המשפט היסודי: הגזירה "מבטלת" את האינטגרל העליון.' },
            { type: 'mcq', tag: 'קריטריון רימן', q: 'מה צריך להראות כדי להוכיח ש-$f$ אינטגרבילית לפי קריטריון רימן?',
              options: ['שלכל $\\varepsilon>0$ קיימת חלוקה $P$ עם $U(f,P)-L(f,P)<\\varepsilon$', 'שקיימת חלוקה אחת שבה $U(f,P)=L(f,P)$', 'ש-$f$ גזירה בכל הקטע', 'ש-$\\lim_{n\\to\\infty} U(f,P_n)$ קיים לסדרה כלשהי של חלוקות'],
              answer: 0, why: ['זה הקריטריון בדיוק.', 'שוויון בחלוקה אחת קורה כמעט רק לפונקציה קבועה; צריך הפרש קטן כרצוננו.', 'גזירות מספיקה אבל היא חזקה בהרבה ממה שצריך.', 'הגבול של העליונים לבד לא מספיק; צריך שגם התחתונים יתכנסו לאותו ערך.'] },
            { type: 'tf', tag: 'המשפט היסודי', q: 'אם $f$ אינטגרבילית ול-$f$ יש פונקציה קדומה $F$, אז $\\int_a^b f = F(b)-F(a)$.', answer: true, why: 'נכון: זה החלק השני של המשפט היסודי (נוסחת ניוטון-לייבניץ), גם בלי רציפות של $f$.' },
            { type: 'cloze', tag: 'סכומי רימן', q: 'עבור $f(x)=x$ על $[0,1]$ וחלוקה ל-$n$ חלקים שווים, $U(f,P_n)=\\frac{n+1}{2n}$, ולכן הגבול הוא ____', answer: '1/2', accept: ['0.5', '\\frac{1}{2}', 'חצי'], why: 'כאשר $n\\to\\infty$ מתקבל $\\frac12$, וזה ערך האינטגרל.' },
          ] }, 2200);
          break;
        }
        case 'quizAttempt': break;
        case 'flashcards': {
          ['מחלץ נוסחאות והגדרות', 'כותב שאלות', 'בודק מול הסיכום'].forEach((text, i) => emit({ type: 'flashcardsProgress', requestId: m.requestId, step: i + 1, steps: 3, text }, 200 + i * 400));
          emit({ type: 'flashcardsResult', requestId: m.requestId, cards: [
            { front: 'מה קורה לסכום העליון $U(f,P)$ כשמעדנים את החלוקה $P$?', back: 'הוא **קטן או נשאר**: בכל תת-קטע ה-sup יכול רק לרדת. הסכום התחתון, להפך, רק עולה.', tag: 'סכומי רימן', key: 'd1' },
            { front: 'מה התנאי של רימן לאינטגרביליות?', back: 'לכל $\\varepsilon>0$ יש חלוקה $P$ שבה $U(f,P)-L(f,P)<\\varepsilon$.', tag: 'אינטגרביליות', key: 'd2' },
            { front: 'למה פונקציית דיריכלה אינה אינטגרבילית ב-$[0,1]$?', back: 'בכל תת-קטע יש רציונלי ואי-רציונלי, אז $M_i=1$, $m_i=0$, וההפרש תמיד 1.', tag: 'דוגמה נגדית', key: 'd3' }] }, 1500);
          break;
        }
        case 'openCourse': {
          const c = courses.find(x => x.id === m.id);
          emit({ type: 'course', id: m.id, name: c.name, folder: 'D:\\HIT\\Courses\\' + c.name, sections, lecturer: 'ד"ר כהן', lecturerGuess: [],
            local: { dir: 'x', exists: true, exams: 8, notes: 12, studyPages: 6, lectures: sections, info, examPrep: 'x', lecturerProfile: 'x', courseInfoMd: 'x' },
            notability: { configured: true, linked: 'אינפי 2', subjects: ['אינפי 2', 'מבני נתונים', 'פיזיקה'], notes: 12 } }, 900);
          emit({ type: 'newMaterial', course: c.name, items: [{ num: 4, title: 'אינטגרלים מוכללים', name: 'תרגיל בית 4', mod: 'assign' }, { num: 4, title: 'אינטגרלים מוכללים', name: 'פתרון תרגיל 3', mod: 'resource' }] }, 1300);
          break;
        }
        case 'lecturePdf': {
          const steps = ['קורא את חומרי הקורס', 'כותב את הסיכום', 'מסמן רמזים בדפי התרגיל', 'מכין את קובץ ה-PDF...'];
          steps.forEach((t, i) => emit({ type: 'sectionStatus', course: m.course, num: m.num, text: t, busy: true }, 300 + i * 700));
          emit({ type: 'sectionStatus', course: m.course, num: m.num, text: m.extra ? 'הסיכום הנוסף "' + m.extra + '" מוכן ✨' : 'קובץ ה-PDF של ההרצאה מוכן ✨', busy: false }, 3300);
          break;
        }
        case 'chat':
          emit({ type: 'chatTool', course: m.course, text: 'קורא שיעור 4/הרצאה 4.pdf' }, 600);
          emit({ type: 'chat', course: m.course, role: 'assistant', text: 'בשיעור 4 למדתם על **אינטגרלים מוכללים**:\n- סוג ראשון: גבול אינסופי\n- סוג שני: פונקציה לא חסומה\n\nהמרצה מדגיש תמיד את **מבחן ההשוואה**. רוצה שנעבור על שאלה 2 מתרגיל הבית?' }, 1800);
          emit({ type: 'chatDone', course: m.course }, 1900);
          break;
        case 'syncSection':
          emit({ type: 'sectionStatus', course: m.course, num: m.section.num, text: 'מוריד 2/3: הרצאה', busy: true }, 200);
          emit({ type: 'sectionStatus', course: m.course, num: m.section.num, text: 'נשמרו 3 קבצים · הקלטה אחת בדרך', busy: false }, 1600);
          break;
      }
    }
  };
})();
