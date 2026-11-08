'use strict';
// Study tools that take the student's material to other places (macOS). Nothing here needs a service or the college site:
//   - the study blocks of the week as an iCal file, to open in Google or Apple Calendar on the phone;
//   - a folder of sources for one course, ready to upload to NotebookLM (summary PDFs, the course information, the cards as questions and answers);
//   - the memory cards as a text file that Anki imports;
//   - the summary PDFs of a course in iCloud Drive (SumIT/<course>/Lecture_NN_<topic>.pdf with a metadata.json), to open on the iPad in Notability, Goodnotes or Files.
// NotebookLM has no open API for a personal account, so the bundle is uploaded by hand, and the app opens the page for that.

const fs = require('fs');
const os = require('os');
const path = require('path');
const platform = require('../platform');
const C = require('../constants');
const { Str, Int, Trunc, SafeName, readText, writeText, fileExists, dirExists, mkdirp, sha256Hex } = require('../util');

const MaxSources = 50;      // NotebookLM takes 50 sources in a notebook
const Schema = 1;           // the version of the iCloud files (docs/icloud-format.md); raise it only for a change an older iPad app cannot read
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

// ---------- iCloud Drive ----------

// Lecture_03_<topic>.pdf: the number with two digits so the files sort, the title of the lecture with _ for spaces (Hebrew stays), at most 60 letters.
function icloudFileName(num, title) {
  let t = norm(title);
  if (t) t = SafeName(t).replace(/[\s.]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (t.length > 60) t = t.slice(0, 60).replace(/_+$/, '');
  return 'Lecture_' + pad(Math.max(0, Number(num) || 0)) + (t ? '_' + t : '') + '.pdf';
}

// What to do with each summary. items: [{ num, file, sha }]; prev: the lectures of the last metadata.json; shaOf(file): the sha256 of a file in the folder, or null.
//   skip      the same file is already there;
//   write     nothing there yet;
//   overwrite the file there is the one SumIT put there last time, so it is replaced;
//   keepOld   the file there is not what SumIT wrote (the student wrote on it on the iPad): it is kept under a dated name and the new one is written.
// remove: the file of the lecture under its old title, when the title changed and the old file was not touched.
function icloudPlan(items, prev, shaOf) {
  const byNum = new Map(arr(prev).filter(p => p && p.num).map(p => [Number(p.num), p]));
  return arr(items).map(it => {
    const p = byNum.get(Number(it.num)) || null, there = shaOf(it.file);
    let action = 'write';
    if (there === it.sha) action = 'skip';
    else if (there != null) action = p && p.file === it.file && p.sha256 === there ? 'overwrite' : 'keepOld';
    const remove = p && p.file && p.file !== it.file && shaOf(p.file) === p.sha256 ? p.file : '';
    return { num: it.num, file: it.file, action, remove, known: !!p };
  });
}

const stamp = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());

// Copy through a hidden temporary file and rename it, so iCloud never uploads half a file.
function atomicCopy(src, dst) {
  const tmp = path.join(path.dirname(dst), '.' + path.basename(dst) + '.tmp');
  try { fs.copyFileSync(src, tmp); fs.renameSync(tmp, dst); } catch (ex) { try { fs.rmSync(tmp, { force: true }); } catch { } throw ex; }
}
function atomicWrite(dst, text) {
  const tmp = path.join(path.dirname(dst), '.' + path.basename(dst) + '.tmp');
  try { fs.writeFileSync(tmp, text, 'utf8'); fs.renameSync(tmp, dst); } catch (ex) { try { fs.rmSync(tmp, { force: true }); } catch { } throw ex; }
}
const fileSha = (f) => { try { return fs.statSync(f).isFile() ? sha256Hex(fs.readFileSync(f)) : null; } catch { return null; } };

module.exports = {
  methods: {
    ToolsICloudName(num, title) { return icloudFileName(num, title); },
    ToolsICloudPlan(items, prev, shaOf) { return icloudPlan(items, prev, shaOf); },

    // iCloud Drive on this Mac (SUMIT_ICLOUD_DIR in the tests).
    ICloudRoot() { return process.env.SUMIT_ICLOUD_DIR || path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs'); },
    ICloudCourseDir(folder) { return path.join(this.ICloudRoot(), 'SumIT', SafeName(folder)); },

    // One course to iCloud Drive, for the SumIT iPad app and for Notability / Goodnotes. The format is in docs/icloud-format.md (schema 1):
    //   SumIT/index.json                    the courses that were exported;
    //   SumIT/<course>/metadata.json        the course, its Moodle id, and per lecture its files and their sha256;
    //   SumIT/<course>/Lecture_NN_<t>.pdf   the summary PDF, when there is one;
    //   SumIT/<course>/Lecture_NN_<t>.md    the short summary in Markdown, when there is one;
    //   SumIT/<course>/cards.json           the memory cards of the course.
    // The page hears { type: 'icloudExport', state: 'busy' | 'done' | 'error', course, ... }.
    async ICloudExport(name) {
      const say = (state, x) => this.Send(Object.assign({ type: 'icloudExport', state, course: name }, x || {}));
      const folder = name ? this.ToolsFolder(name) : '';
      if (!folder) { say('error', { error: 'לא מצאתי תיקייה של הקורס "' + name + '" באפליקציה. הורד קודם את חומרי הקורס.' }); return; }
      this.icloudRunning = this.icloudRunning || new Set();
      if (this.icloudRunning.has(folder)) return;
      const root = this.ICloudRoot();
      if (!dirExists(root)) { say('error', { error: 'iCloud Drive לא מופעל במק הזה. הפעל אותו בהגדרות המערכת, Apple ID, iCloud, iCloud Drive.' }); return; }

      const meta = this.LoadMeta(folder), courseDir = this.CourseDir(folder);
      const items = arr(meta.lectures).filter(r => r && Int(r, 'num') >= 1).sort((a, b) => Int(a, 'num') - Int(b, 'num'))
        .map(r => {
          const num = Int(r, 'num'), title = Str(r, 'title'), base = icloudFileName(num, title).replace(/\.pdf$/, '');
          const pdf = this.LecturePdfPath(folder, num), md = path.join(courseDir, path.normalize(this.DigestRel(num)));
          return { num, title, date: Str(r, 'date'), pdf: fileExists(pdf) ? pdf : '', md: fileExists(md) ? md : '', pdfFile: base + '.pdf', mdFile: base + '.md' };
        })
        .filter(r => r.pdf || r.md);
      if (!items.length) { say('error', { error: 'אין עדיין סיכומים לקורס "' + folder + '". צור סיכום להרצאה ונסה שוב.' }); return; }

      this.icloudRunning.add(folder);
      const top = path.join(root, 'SumIT'), dir = this.ICloudCourseDir(folder), metaFile = path.join(dir, 'metadata.json');
      try {
        mkdirp(dir);
        let prev = [];
        try { prev = arr((JSON.parse(readText(metaFile)) || {}).lectures); } catch { }
        const shaOf = f => fileSha(path.join(dir, path.basename(f)));
        // The PDFs and the Markdown files go through the same plan, each against what was written for it last time.
        const kinds = [
          { src: 'pdf', file: 'pdfFile', prevFile: 'file', prevSha: 'sha256' },
          { src: 'md', file: 'mdFile', prevFile: 'summaryFile', prevSha: 'summarySha256' },
        ];
        const jobs = [];
        for (const k of kinds) {
          const list = items.filter(it => it[k.src]).map(it => ({ num: it.num, file: it[k.file], sha: fileSha(it[k.src]), it, k }));
          const old = prev.filter(x => x && Str(x, k.prevFile)).map(x => ({ num: Number(x.num), file: Str(x, k.prevFile), sha256: Str(x, k.prevSha) }));
          icloudPlan(list, old, shaOf).forEach((p, i) => jobs.push(Object.assign(p, list[i])));
        }
        const now = new Date(), counts = { added: 0, updated: 0, unchanged: 0, kept: 0 }, touched = new Map();
        say('busy', { done: 0, total: jobs.length });
        for (let i = 0; i < jobs.length; i++) {
          const j = jobs[i], dst = path.join(dir, j.file);
          if (j.action === 'keepOld') {
            const ext = path.extname(j.file), base = j.file.slice(0, -ext.length) + '_' + stamp(now);
            let old = path.join(dir, base + ext);
            for (let n = 2; fs.existsSync(old); n++) old = path.join(dir, base + '-' + n + ext);
            fs.renameSync(dst, old); counts.kept++;
          }
          if (j.action !== 'skip') atomicCopy(j.it[j.k.src], dst);
          if (j.remove) { try { fs.rmSync(path.join(dir, path.basename(j.remove)), { force: true }); } catch { } }
          const was = touched.get(j.num) || 'skip';
          touched.set(j.num, j.action === 'skip' ? was : (j.known || j.action !== 'write' || was === 'updated' ? 'updated' : (was === 'skip' ? 'added' : was)));
          j.it[j.k.src + 'Sha'] = j.sha;
          say('busy', { done: i + 1, total: jobs.length });
        }
        for (const v of touched.values()) counts[v === 'skip' ? 'unchanged' : v]++;

        // The cards of the course. Each has a key that stays the same while its question does, so the iPad updates a card and does not add it again.
        const cards = this.ReviewSets().filter(st => st.course === folder).sort((a, b) => a.num - b.num)
          .flatMap(st => st.cards.map(c => ({ num: st.num, key: st.num + '-' + sha256Hex(Buffer.from(norm(Str(c, 'front')), 'utf8')).slice(0, 12), front: Str(c, 'front'), back: Str(c, 'back'), tag: Str(c, 'tag') })));
        const cardsFile = path.join(dir, 'cards.json'), cardsText = JSON.stringify({ schema: Schema, course: folder, cards }, null, 2);
        if (cards.length) { if (!fileExists(cardsFile) || readText(cardsFile) !== cardsText) atomicWrite(cardsFile, cardsText); }
        else fs.rmSync(cardsFile, { force: true });
        const cardsPer = cards.reduce((m, c) => (m[c.num] = (m[c.num] || 0) + 1, m), {});

        const at = (num) => touched.get(num) === 'skip' ? (Str(prev.find(x => x && Number(x.num) === num) || {}, 'exportedAt') || now.toISOString()) : now.toISOString();
        // Lectures that have no summary now keep their line while one of their files is still there.
        const keptRows = prev.filter(x => x && Number(x.num) && !items.some(it => it.num === Number(x.num))
          && [Str(x, 'file'), Str(x, 'summaryFile')].some(f => f && fileExists(path.join(dir, path.basename(f)))));
        const lectures = items.map(it => ({
          num: it.num, title: it.title, date: /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : null,
          file: it.pdf ? it.pdfFile : null, sha256: it.pdf ? it.pdfSha : null,
          summaryFile: it.md ? it.mdFile : null, summarySha256: it.md ? it.mdSha : null,
          cards: cardsPer[it.num] || 0, exportedAt: at(it.num),
        })).concat(keptRows).sort((a, b) => a.num - b.num);
        const moodleCourseId = Int(meta, 'courseId') || null;
        atomicWrite(metaFile, JSON.stringify({ schema: Schema, app: 'SumIT', version: C.Version, course: folder, moodleCourseId, exportedAt: now.toISOString(), cardsFile: cards.length ? 'cards.json' : null, lectures }, null, 2));

        // SumIT/index.json: one line per course, so the iPad picks the SumIT folder once and finds every course in it.
        const indexFile = path.join(top, 'index.json');
        let courses = [];
        try { courses = arr((JSON.parse(readText(indexFile)) || {}).courses); } catch { }
        courses = courses.filter(x => x && Str(x, 'folder') && Str(x, 'folder') !== SafeName(folder) && dirExists(path.join(top, path.basename(Str(x, 'folder')))));
        courses.push({ folder: SafeName(folder), course: folder, moodleCourseId, lectures: lectures.length, cards: cards.length, exportedAt: now.toISOString() });
        courses.sort((a, b) => String(a.course).localeCompare(String(b.course), 'he'));
        atomicWrite(indexFile, JSON.stringify({ schema: Schema, app: 'SumIT', version: C.Version, updatedAt: now.toISOString(), courses }, null, 2));

        const changed = counts.added + counts.updated;
        const text = changed ? changed + ' הרצאות סונכרנו ל-iCloud' + (counts.unchanged ? ' (' + counts.unchanged + ' כבר היו מעודכנות)' : '') : 'כל ' + items.length + ' ההרצאות כבר מעודכנות ב-iCloud';
        say('done', Object.assign({ total: items.length, cards: cards.length, text: text + (counts.kept ? '. ' + counts.kept + ' קבצים שנערכו באייפד נשמרו בשם עם תאריך.' : '') }, counts));
        if (changed && typeof this.PomodoroNotify === 'function') this.PomodoroNotify('SumIT · ' + folder, text + '. הם יופיעו באייפד בתיקייה iCloud Drive/SumIT.');
      } catch (ex) {
        const code = ex && ex.code;
        say('error', { error: code === 'EACCES' || code === 'EPERM' ? 'אין הרשאת גישה לתיקיית iCloud Drive. אשר ל-SumIT גישה בהגדרות המערכת, פרטיות ואבטחה, קבצים ותיקיות.' : code === 'ENOSPC' ? 'אין מספיק מקום פנוי בדיסק.' : 'הייצוא ל-iCloud נכשל: ' + (ex.message || String(ex)) });
      } finally { this.icloudRunning.delete(folder); }
    },

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
        if (op === 'icloud') { await this.ICloudExport(course); return; }
        if (op === 'icloudReveal') { const folder = this.ToolsFolder(course), dir = folder && this.ICloudCourseDir(folder); if (dir && dirExists(dir)) platform.revealInFinder(path.join(dir, 'metadata.json')); return; }
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
