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
