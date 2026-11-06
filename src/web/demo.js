// Demo host for ui.html?demo=1: answers the page with sample data, for screenshots and visual QA.
(function () {
  const listeners = [];
  // A calendar for the screenshots: a meeting today, one tomorrow, and a weekly one.
  const demoCalendar = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0'), stamp = (x, h, m) => '' + x.getFullYear() + p(x.getMonth() + 1) + p(x.getDate()) + 'T' + p(h) + p(m) + '00';
    const later = new Date(d.getTime() + 3 * 3600000), tomorrow = new Date(d.getTime() + 86400000);
    const ev = (uid, title, s, e, extra) => ['BEGIN:VEVENT', 'UID:' + uid, 'SUMMARY:' + title, 'DTSTART:' + s, 'DTEND:' + e].concat(extra || [], ['END:VEVENT']).join('\r\n');
    return { id: '0123456789abcdef0123456789abcdef', name: 'Google', source: 'url', host: 'calendar.google.com', updated: Date.now() - 4 * 60000, error: '',
      ics: ['BEGIN:VCALENDAR', 'VERSION:2.0',
        ev('1', 'פגישה עם המנחה', stamp(later, later.getHours(), 0), stamp(later, later.getHours() + 1, 0), ['LOCATION:חדר 304']),
        ev('2', 'אימון כושר', stamp(tomorrow, 9, 30), stamp(tomorrow, 10, 30)),
        ev('3', 'קבוצת לימוד', stamp(d, 19, 0), stamp(d, 20, 0), ['RRULE:FREQ=WEEKLY']), 'END:VCALENDAR'].join('\r\n') };
  };
  const emit = (data, delay = 250) => setTimeout(() => listeners.forEach(fn => fn({ data })), delay);
  const now = Math.floor(Date.now() / 1000);
  // The study track (track-ui.js): a small profile kept in memory, so that every button of the page does something in the demo.
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const trackProfile = { version: 1, name: '', created: iso(new Date()), strategies: {}, plan: { weekStart: '', blocks: [] }, progress: {}, log: [],
    courses: [{ name: 'מבני נתונים', level: 3, hoursPerWeek: 0, examDate: iso(new Date(Date.now() + 12 * 86400000)), notes: '', manual: false }, { name: 'אלגברה לינארית 2', level: 2, hoursPerWeek: 0, examDate: '', notes: '', manual: false }] };
  const trackSnapshot = (extra) => {
    const today = new Date(), ws = new Date(today); ws.setDate(ws.getDate() - ws.getDay());
    const p = trackProfile, wsIso = iso(ws), wl = p.log.filter(e => e.date >= wsIso), per = {};
    p.courses.forEach(c => { per[c.name] = { week: wl.filter(e => e.course === c.name).reduce((n, e) => n + e.minutes, 0), total: p.log.filter(e => e.course === c.name).reduce((n, e) => n + e.minutes, 0), topicsDone: ((p.progress[c.name] || {}).topics || []).filter(t => t.done).length, topics: ((p.progress[c.name] || {}).topics || []).length }; });
    const bl = p.plan.blocks;
    return Object.assign({ type: 'trackState', profile: JSON.parse(JSON.stringify(p)), today: iso(today), weekStart: wsIso, classes: 0,
      suggested: ['פיזיקה 1', 'חשבון אינפיניטסימלי 2'].filter(n => !p.courses.some(c => c.name === n)).map(name => ({ name, where: 'מערכת השעות' })),
      stats: { weekStart: wsIso, plannedMinutes: bl.reduce((n, b) => n + b.minutes, 0), plannedBlocks: bl.length, doneBlocks: bl.filter(b => b.done).length, weekMinutes: wl.reduce((n, e) => n + e.minutes, 0), totalMinutes: p.log.reduce((n, e) => n + e.minutes, 0), streak: p.log.length ? 1 : 0, perCourse: per } }, extra || {});
  };
  const trackDemo = (m) => {
    const p = trackProfile, c = p.courses.find(x => x.name === m.course);
    if (m.op === 'load') return emit(trackSnapshot(), 200);
    if (m.op === 'addCourses') (m.courses || []).forEach(x => { if (!p.courses.some(y => y.name === x.name)) p.courses.push({ name: x.name, level: 2, hoursPerWeek: 0, examDate: x.examDate || '', notes: '', manual: !!x.manual }); });
    if (m.op === 'editCourse' && c) Object.assign(c, m.values);
    if (m.op === 'removeCourse') p.courses = p.courses.filter(x => x.name !== m.course);
    if (m.op === 'name') p.name = m.value;
    if (m.op === 'log' && c) p.log.push({ date: iso(new Date()), course: m.course, minutes: m.minutes, note: '', block: '' });
    if (m.op === 'topic' && c) { const row = p.progress[m.course] || (p.progress[m.course] = { topics: [] }); if (m.act === 'add') row.topics.push({ id: 't' + row.topics.length + Date.now(), title: m.title, done: false }); const t = row.topics.find(x => x.id === m.id); if (t && m.act === 'toggle') t.done = !t.done; if (t && m.act === 'remove') row.topics = row.topics.filter(x => x !== t); }
    if (m.op === 'done' || m.op === 'undo') { const b = p.plan.blocks.find(x => x.id === m.id); if (b) { p.log = p.log.filter(e => e.block !== b.id); b.done = m.op === 'done'; b.doneMinutes = b.done ? b.minutes : 0; if (b.done) p.log.push({ date: iso(new Date()), course: b.course, minutes: b.minutes, note: b.goal, block: b.id }); } }
    if (m.op === 'blockSave') {
      const ws = trackSnapshot().weekStart; if (!p.plan.weekStart) p.plan.weekStart = ws;
      const b = p.plan.blocks.find(x => x.id === m.id);
      if (b) Object.assign(b, { course: m.course, day: m.day, start: m.start, minutes: m.minutes, goal: m.goal || 'לימוד' });
      else p.plan.blocks.push({ id: 'm' + Date.now(), day: m.day, start: m.start, minutes: m.minutes, course: m.course, goal: m.goal || 'לימוד', done: false, doneMinutes: 0 });
      p.plan.blocks.sort((a, c) => a.day - c.day || a.start.localeCompare(c.start));
    }
    if (m.op === 'removeBlock') p.plan.blocks = p.plan.blocks.filter(x => x.id !== m.id);
    if (m.op === 'build') {
      const ws = trackSnapshot().weekStart, goals = ['חזרה על ההרצאה האחרונה: קרא את הסיכום ושלוף מהזיכרון מה שזכרת', 'תרגול: פתור תרגילים בעצמך לפני שאתה מסתכל בפתרון'];
      p.plan = { weekStart: ws, blocks: p.courses.flatMap((x, i) => [0, 1].map(k => ({ id: 'b' + (i * 2 + k + 1), day: (i + k * 2) % 5, start: i ? '14:00' : '10:00', minutes: 60, course: x.name, goal: goals[k], done: false, doneMinutes: 0 }))).sort((a, b) => a.day - b.day) };
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
    lec(1, 'אינטגרל רימן', [{ mod: 'resource', name: 'הרצאה 1 - אינטגרל רימן' }, { mod: 'assign', name: 'תרגיל בית 1', dates: 'הגשה: 12 בנובמבר' }, { mod: 'zoom', name: 'הקלטת ההרצאה' }], { exists: true, files: 4, videos: 1, transcripts: 1, studyPage: 'x', lecturePdf: 'x' }),
    lec(2, 'המשפט היסודי', [{ mod: 'resource', name: 'הרצאה 2 - המשפט היסודי' }, { mod: 'resource', name: 'תרגול 2' }, { mod: 'zoom', name: 'הקלטה' }], { exists: true, files: 3 }),
    lec(3, 'שיטות אינטגרציה', [{ mod: 'resource', name: 'הרצאה 3' }, { mod: 'assign', name: 'תרגיל בית 3' }]),
    lec(4, 'אינטגרלים מוכללים', [{ mod: 'resource', name: 'הרצאה 4' }, { mod: 'url', name: 'קישור להקלטה' }])
  ];
  const ai = { provider: 'claude', ready: true, setup: '', claude: { installed: true, loggedIn: true, email: 'student@example.com', plan: 'pro' }, gemini: { installed: false, hasKey: false } };
  const info = { lecturer: 'ד"ר כהן', officeHours: 'יום ב׳ 12:00-13:00', homeworkRequired: true, homeworkNote: '10% מהציון, צריך להגיש 8 מתוך 10',
    examFormat: '3 שעות, 5 שאלות פתוחות', materialsAllowed: 'דף נוסחאות אישי', attendance: 'לא חובה',
    grading: [{ component: 'מבחן סופי', weight: 80 }, { component: 'תרגילי בית', weight: 10 }, { component: 'בוחן אמצע', weight: 10 }],
    importantDates: [{ date: '2026-12-10', what: 'בוחן אמצע' }, { date: '2027-02-01', what: 'מועד א' }], tips: ['המרצה אוהב לשאול על התכנסות אינטגרלים מוכללים', 'בתרגילים - חובה לנמק כל מעבר'] };

  window.DemoEmit = emit;
  window.DemoHost = {
    addEventListener: (t, fn) => listeners.push(fn),
    postMessage: (m) => {
      switch (m.type) {
        case 'ready':
          emit({ type: 'settings', studyRoot: 'D:\\HIT\\Courses', recordingsDir: 'D:\\HIT\\Zoom Recordings', notabilityDir: '', aiProvider: 'claude', hasGeminiKey: false, onboarded: !location.search.includes('wizard'), userName: 'נועה לוי', version: '2.0.0' });
          emit({ type: 'aiStatus', status: ai }, 500);
          emit({ type: 'moodle', state: 'ready' }, 700);
          emit({ type: 'home', events, name: 'נועה לוי' }, 1100);
          emit({ type: 'courses', data: courses }, 1300);
          emit({ type: 'job', id: 1, name: 'שיעור 2', state: 'running', status: 'מוריד וידאו · 46% מתוך 273MiB · נשארו 00:14', progress: 46 }, 1400);
          emit({ type: 'job', id: 2, name: 'שיעור 1', state: 'done', status: 'הווידאו והתמלול נשמרו', progress: 100, hasVideo: true, hasTranscript: true }, 1450);
          break;
        case 'loadCourses': emit({ type: 'courses', data: courses }, 600); break;
        case 'coachPing': emit({ type: 'coachReady' }, 300); break;
        case 'trackPing': emit({ type: 'trackReady' }, 300); break;
        case 'track': trackDemo(m); break;
        case 'exportTool': emit({ type: 'toast', text: 'בדמו לא נכתבים קבצים. באפליקציה האמיתית נפתח חלון שמירה.', error: false }, 300); break;
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
        case 'getReviewQueue': emit({ type: 'reviewQueue', count: 14, due: 6, fresh: 8, overdueDays: 2, courses: { 'מבני נתונים': 6 } }, 400); break;
        case 'startReview': emit({ type: 'reviewSession', cards: [
          { key: 'a1b2c3d4e5f6', front: 'מה הסיבוכיות של חיפוש בינארי במערך ממוין?', back: 'O(log n): בכל צעד חצי מהמערך נפסל.', tag: 'סיבוכיות', course: 'מבני נתונים', title: 'הרצאה 3', num: 3, path: '/x/3.html' },
          { key: 'b1b2c3d4e5f6', front: 'הגדר: גבול של סדרה', back: 'לכל $\\varepsilon>0$ קיים $N$ כך שלכל $n>N$ מתקיים $|a_n-L|<\\varepsilon$.', tag: 'הגדרה', course: 'חשבון אינפיניטסימלי 2', title: 'הרצאה 5', num: 5, path: '/x/5.html' },
          { key: 'c1b2c3d4e5f6', front: 'מתי מטריצה הפיכה?', back: 'כשהדטרמיננטה שלה שונה מאפס.', tag: '', course: 'אלגברה לינארית 2', title: 'הרצאה 2', num: 2, path: '/x/2.html' }] }, 200); break;
        case 'rateCard': case 'savePlanner': break;
        case 'openCourse': {
          const c = courses.find(x => x.id === m.id);
          emit({ type: 'course', id: m.id, name: c.name, folder: 'D:\\HIT\\Courses\\' + c.name, sections, lecturer: 'ד"ר כהן', lecturerGuess: [],
            local: { dir: 'x', exists: true, exams: 8, notes: 12, studyPages: 6, info, examPrep: 'x', lecturerProfile: 'x', courseInfoMd: 'x' },
            notability: { configured: true, linked: 'אינפי 2', subjects: ['אינפי 2', 'מבני נתונים', 'פיזיקה'], notes: 12 } }, 900);
          emit({ type: 'newMaterial', course: c.name, items: [{ num: 4, title: 'אינטגרלים מוכללים', name: 'תרגיל בית 4', mod: 'assign' }, { num: 4, title: 'אינטגרלים מוכללים', name: 'פתרון תרגיל 3', mod: 'resource' }] }, 1300);
          break;
        }
        case 'lecturePdf': {
          const steps = ['קורא את חומרי הקורס', 'כותב את הסיכום', 'מסמן רמזים בדפי התרגיל', 'מכין את קובץ ה-PDF...'];
          steps.forEach((t, i) => emit({ type: 'sectionStatus', course: m.course, num: m.num, text: t, busy: true }, 300 + i * 700));
          emit({ type: 'sectionStatus', course: m.course, num: m.num, text: 'קובץ ה-PDF של ההרצאה מוכן ✨', busy: false }, 3300);
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
