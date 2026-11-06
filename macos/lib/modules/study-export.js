'use strict';
// Study tools that take the student's material to other places (macOS). Nothing here needs a service or the college site:
//   - the study blocks of the week as an iCal file, to open in Google or Apple Calendar on the phone;
//   - a folder of sources for one course, ready to upload to NotebookLM (summary PDFs, the course information, the cards as questions and answers);
//   - the memory cards as a text file that Anki imports.
// NotebookLM has no open API for a personal account, so the bundle is uploaded by hand, and the app opens the page for that.

const fs = require('fs');
const os = require('os');
const path = require('path');
const platform = require('../platform');
const C = require('../constants');
const { Str, Int, Trunc, SafeName, readText, writeText, fileExists, dirExists, mkdirp } = require('../util');

const MaxSources = 50;      // NotebookLM takes 50 sources in a notebook
const pad = (n) => String(n).padStart(2, '0');
const arr = (x) => (Array.isArray(x) ? x : []);
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const same = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };

// ---------- iCal ----------

const icsEscape = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// A line of an iCal file is at most 75 bytes; a longer one continues on the next line, which starts with a space. Cut between characters, never inside one.
function icsFold(line) {
  const out = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

const icsLocal = (d) => '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
const icsUtc = (d) => '' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';

// The blocks of one week. Times are local ("floating"), so a block at 10:00 is at 10:00 wherever the calendar is opened.
function buildIcs(blocks, weekStart, now) {
  const p = String(weekStart).split('-').map(Number);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SumIT//Study blocks//HE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:SumIT - בלוקי למידה'];
  for (const b of arr(blocks)) {
    const h = /^(\d{1,2}):(\d{2})$/.exec(b.start || ''); if (!h) continue;
    const start = new Date(p[0], p[1] - 1, p[2] + Int(b, 'day'), Number(h[1]), Number(h[2]));
    const end = new Date(start.getTime() + Math.max(10, Int(b, 'minutes')) * 60000);
    lines.push('BEGIN:VEVENT', 'UID:' + String(b.id).replace(/[^\w-]/g, '') + '-' + weekStart + '@sumit.local', 'DTSTAMP:' + icsUtc(now || new Date()),
      'DTSTART:' + icsLocal(start), 'DTEND:' + icsLocal(end), 'SUMMARY:' + icsEscape('לימוד: ' + b.course), 'DESCRIPTION:' + icsEscape(b.goal),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape('לימוד: ' + b.course), 'TRIGGER:-PT10M', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

// A link that opens Google Calendar with one block filled in; the student only presses Save. The times are local, so Google puts them in the calendar's own time zone.
function googleUrl(b, weekStart) {
  const p = String(weekStart).split('-').map(Number), h = /^(\d{1,2}):(\d{2})$/.exec(b && b.start || '');
  if (!h || p.length !== 3 || p.some(n => !Number.isFinite(n))) return '';
  const start = new Date(p[0], p[1] - 1, p[2] + Int(b, 'day'), Number(h[1]), Number(h[2]));
  const end = new Date(start.getTime() + Math.max(10, Int(b, 'minutes')) * 60000);
  const q = { action: 'TEMPLATE', text: 'לימוד: ' + b.course, details: String(b.goal || ''), dates: icsLocal(start) + '/' + icsLocal(end) };
  return 'https://calendar.google.com/calendar/render?' + Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k])).join('&');
}

// ---------- Anki ----------

const html = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
const tag = (s) => String(s || '').trim().replace(/[\s"'`\\]+/g, '_');

// Anki reads the first lines that start with # as settings: tab between the fields, HTML in the text, the third column is the tags.
function ankiText(cards) {
  const lines = ['#separator:tab', '#html:true', '#tags column:3'];
  for (const c of arr(cards)) {
    if (!c || !norm(c.front) || !norm(c.back)) continue;
    lines.push([html(c.front), html(c.back), ['SumIT', tag(c.course), c.num ? 'הרצאה_' + c.num : ''].filter(Boolean).join(' ')].join('\t'));
  }
  return lines.join('\n') + '\n';
}

// ---------- NotebookLM ----------

function cardsMarkdown(course, sets) {
  const out = ['# שאלות ותשובות - ' + course, ''];
  for (const s of sets) {
    out.push('## הרצאה ' + s.num + (s.title ? ': ' + s.title : ''), '');
    for (const c of s.cards) out.push('**שאלה:** ' + String(c.front).replace(/\s+/g, ' ').trim(), '', '**תשובה:** ' + String(c.back).replace(/\s+/g, ' ').trim(), '');
  }
  return out.join('\n');
}

function infoMarkdown(course, i) {
  const out = ['# על הקורס: ' + course, ''];
  const grading = arr(i.grading).filter(g => g && Str(g, 'component'));
  if (grading.length) out.push('## מבנה הציון', ...grading.map(g => '- ' + Str(g, 'component') + ': ' + Int(g, 'weight') + '%'), '');
  if (Str(i, 'examFormat')) out.push('## מבנה המבחן', Str(i, 'examFormat'), '');
  if (Str(i, 'materialsAllowed')) out.push('## חומר מותר במבחן', Str(i, 'materialsAllowed'), '');
  const dates = arr(i.importantDates).filter(d => d && Str(d, 'what'));
  if (dates.length) out.push('## תאריכים חשובים', ...dates.map(d => '- ' + Str(d, 'date') + ': ' + Str(d, 'what')), '');
  const tips = arr(i.tips).map(String).filter(Boolean);
  if (tips.length) out.push('## טיפים', ...tips.map(t => '- ' + t), '');
  return out.join('\n');
}

module.exports = {
  methods: {
    ToolsIcs(blocks, weekStart, now) { return buildIcs(blocks, weekStart, now); },
    ToolsGoogleUrl(block, weekStart) { return googleUrl(block, weekStart); },
    ToolsAnki(cards) { return ankiText(cards); },
    ToolsCardsMarkdown(course, sets) { return cardsMarkdown(course, sets); },
    ToolsInfoMarkdown(course, info) { return infoMarkdown(course, info); },
    ToolsFold(line) { return icsFold(line); },

    // The folder of the course in the study folder whose name matches the name in the profile (the folder often has a semester in it).
    ToolsFolder(name) {
      let names = [];
      try { names = fs.readdirSync(this.StudyRoot).filter(n => { try { return fs.statSync(path.join(this.StudyRoot, n)).isDirectory(); } catch { return false; } }).sort(); } catch { }
      return names.find(n => n === name || n === SafeName(name)) || names.find(n => same(n, name)) || '';
    },

    // One message from the page: { type: 'exportTool', op: 'ics' | 'gcal' | 'gcalBlock' | 'anki' | 'notebook', course }.
    async ExportToolHandle(m) {
      const op = Str(m, 'op'), course = Trunc(norm(Str(m, 'course')), 120);
      const home = os.homedir();
      try {
        if (op === 'ics') {
          const profile = this.TrackLoad(), blocks = profile.plan.blocks.filter(b => !b.done);
          if (!profile.plan.weekStart || !blocks.length) { this.Toast('אין בלוקים לייצוא. בנה קודם שבוע במסלול הלמידה.', true); return; }
          const file = await this.savePath('ייצוא הבלוקים ליומן', path.join(home, 'SumIT-study-blocks.ics'), [{ name: 'iCalendar', extensions: ['ics'] }]);
          if (!file) return;
          writeText(file, buildIcs(blocks, profile.plan.weekStart));
          this.Toast(blocks.length + ' בלוקים יוצאו. פתח את הקובץ ביומן של Google או של Apple.', false);
          return;
        }

        // Google Calendar: no sign-in or key inside the app. One block opens a filled-in Google page; all the blocks go as a file that Google imports.
        if (op === 'gcalBlock') {
          const profile = this.TrackLoad(), b = profile.plan.blocks.find(x => x.id === Str(m, 'id')), url = b && googleUrl(b, profile.plan.weekStart);
          if (!url) { this.Toast('הבלוק לא נמצא', true); return; }
          platform.openExternal(url);
          return;
        }
        if (op === 'gcal') {
          const profile = this.TrackLoad(), blocks = profile.plan.blocks.filter(b => !b.done);
          if (!profile.plan.weekStart || !blocks.length) { this.Toast('אין בלוקים לייצוא. בנה קודם שבוע במסלול הלמידה.', true); return; }
          const file = path.join(this.AppRoot, 'SumIT-study-blocks.ics');
          mkdirp(this.AppRoot); writeText(file, buildIcs(blocks, profile.plan.weekStart));
          platform.revealInFinder(file);
          platform.openExternal(C.Sites.googleCalendarImport);
          this.Toast(blocks.length + ' בלוקים מוכנים. ב-Google Calendar: ייבוא, בחר את הקובץ שנפתח, ולחץ ייבוא.', false);
          return;
        }

        if (op === 'anki') {
          const sets = this.ReviewSets().filter(s => !course || same(s.course, course));
          const cards = sets.flatMap(s => s.cards.map(c => ({ front: Str(c, 'front'), back: Str(c, 'back'), course: s.course, num: s.num })));
          if (!cards.length) { this.Toast(course ? 'אין כרטיסי זיכרון בקורס "' + course + '". צור כרטיסים מסיכום של הרצאה.' : 'אין עדיין כרטיסי זיכרון.', true); return; }
          const file = await this.savePath('ייצוא כרטיסים ל-Anki', path.join(home, 'SumIT-anki' + (course ? '-' + SafeName(course) : '') + '.txt'), [{ name: 'טקסט ל-Anki', extensions: ['txt'] }]);
          if (!file) return;
          writeText(file, ankiText(cards));
          this.Toast(cards.length + ' כרטיסים יוצאו. ב-Anki: File, Import.', false);
          return;
        }

        if (op === 'notebook') {
          const folder = course ? this.ToolsFolder(course) : '';
          if (!folder) { this.Toast('לא מצאתי תיקייה של הקורס "' + course + '" באפליקציה. הורד קודם את חומרי הקורס.', true); return; }
          const dir = this.CourseDir(folder);
          const out = path.join(this.AppRoot, 'NotebookLM', SafeName(folder));
          const files = [];
          const put = (name, write) => { if (files.length >= MaxSources) return; mkdirp(out); const f = path.join(out, name); write(f); files.push(f); };

          const meta = this.LoadMeta(folder);
          const rows = arr(meta.lectures).filter(r => Int(r, 'num') >= 1).sort((a, b) => Int(a, 'num') - Int(b, 'num'));
          let lectures = 0;
          for (const r of rows) {
            const num = Int(r, 'num'), n2 = pad(num), pdf = this.LecturePdfPath(folder, num), digest = path.join(dir, path.normalize(this.DigestRel(num)));
            if (fileExists(pdf)) { put('הרצאה ' + n2 + ' - סיכום.pdf', f => fs.copyFileSync(pdf, f)); lectures++; }
            else if (fileExists(digest)) { put('הרצאה ' + n2 + ' - תקציר.md', f => fs.copyFileSync(digest, f)); lectures++; }
          }
          if (!lectures) { this.Toast('אין עדיין סיכומים לקורס "' + folder + '". צור סיכום להרצאה ונסה שוב.', true); return; }

          const sets = this.ReviewSets().filter(s => s.course === folder);
          if (sets.length) put('שאלות ותשובות - כרטיסי זיכרון.md', f => writeText(f, cardsMarkdown(folder, sets)));
          try {
            const j = path.join(dir, C.CourseJson);
            if (fileExists(j)) { const text = infoMarkdown(folder, JSON.parse(readText(j)) || {}); if (text.split('\n').length > 3) put('על הקורס.md', f => writeText(f, text)); }
          } catch { }

          platform.revealInFinder(files[0]);
          platform.openExternal(C.Sites.notebooklm);
          this.Toast('החבילה מוכנה (' + files.length + ' מקורות). ב-NotebookLM: מחברת חדשה, הוסף מקורות, ובחר את הקבצים.', false);
        }
      } catch (ex) { this.Toast('הייצוא נכשל: ' + (ex.message || String(ex)), true); }
    },
  },
};
