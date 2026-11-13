'use strict';
// Offline unit & regression test suite for the macOS Electron port (mirrors tests/RegressionTests.cs).

const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  Str, Bool, Int, SafeName, Q, IsInside, Protect, Unprotect, VttToText,
  delay, guidN, fileExists, dirExists, listFiles, mkdirp, readText, writeText,
} = require('../lib/util');
const platform = require('../lib/platform');
const C = require('../lib/constants');
const { Host } = require('../lib/host');

platform.extendPath();

function createZip(zipPath, entries) {
  const py = `
import sys, zipfile, json
zp = sys.argv[1]
items = json.loads(sys.argv[2])
with zipfile.ZipFile(zp, 'w') as z:
    for name, content in items.items():
        z.writestr(name, content)
`;
  const r = spawnSync('/usr/bin/python3', ['-c', py, zipPath, JSON.stringify(entries)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Failed to create test zip: ' + r.stderr);
}

async function run() {
  const app = new Host(['--demo']);
  app.SaveSettings = () => { }; // Do not overwrite the user's real settings.json during offline tests
  app.LoadSettings();
  const root = path.join(platform.TempDir, 'sumit-regression-' + guidN());
  mkdirp(root);
  app.settings.studyRoot = root;
  // The tests never reach the student's real Calendar: the sync is off, remembers in a temporary file, and its script is a missing program
  // (runCalendarSyncTests puts a fake one in its place).
  delete app.settings.calSync;
  app.calSyncFile = path.join(root, 'calendar-sync.json');
  process.env.SUMIT_OSASCRIPT = path.join(root, 'no-osascript');

  let passed = 0;
  const check = (label, ok) => {
    if (!ok) throw new Error('FAIL: ' + label);
    passed++;
    console.log('PASS: ' + label);
  };

  try {
    // 1. Pure helpers & defaults
    check('SafeName strips path parts', SafeName('..\\..\\evil/../x.pdf') === '_.._evil_.._x.pdf');
    check('SafeName handles dots', SafeName('..') === 'Untitled');
    check('SafeName reserved names', SafeName('CON.pdf') === '_CON.pdf');
    check('Q quotes', Q('a "b" c\\') === '"a \\"b\\" c\\\\"');
    check('IsInside blocks traversal', !IsInside('/Users/test/HIT/Courses/../secret.txt', '/Users/test/HIT/Courses'));
    check('IsInside allows children', IsInside('/Users/test/HIT/Courses/a/b.pdf', '/Users/test/HIT/Courses'));
    check('Secrets round-trip', Unprotect(Protect('abc')) === 'abc' && Protect('abc') !== 'abc');
    const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nDr. Cohen: שלום\n\n2\n00:00:05.000 --> 00:00:08.000\nDr. Cohen: היום נלמד\n';
    check('VttToText merges speaker lines', VttToText(vtt, 'T').includes('[00:00:01] Dr. Cohen: שלום היום נלמד'));
    check('updates default to consent', !app.Option('autoUpdate'));
    check('automatic downloads off', !app.Option('autoSync') && !app.Option('autoRecordings'));

    // Mac updates: the newest v<version>-mac release, with this chip's zip and its sha256.
    const dl = 'https://github.com/' + C.MacRepo + '/releases/download/';
    const macReleases = [
      { tag_name: 'v9.0.0', html_url: 'win', assets: [{ name: 'SumIT.zip', browser_download_url: 'https://github.com/' + C.Repo + '/releases/download/v9.0.0/SumIT.zip' }] },
      { tag_name: 'v1.0.30-mac', draft: true, assets: [] },
      { tag_name: 'v1.0.25-mac', html_url: 'page25', body: 'notes', assets: [
        { name: 'SumIT-1.0.25-arm64.zip', size: 123, digest: 'sha256:' + 'ab'.repeat(32), browser_download_url: dl + 'v1.0.25-mac/SumIT-1.0.25-arm64.zip' },
        { name: 'SumIT-1.0.25-arm64.dmg', browser_download_url: dl + 'v1.0.25-mac/SumIT-1.0.25-arm64.dmg' },
        { name: 'SumIT-1.0.25-x64.zip', browser_download_url: dl + 'v1.0.25-mac/SumIT-1.0.25-x64.zip' },
        { name: 'SumIT-1.0.25-arm64.zip', browser_download_url: 'https://evil.example/SumIT-1.0.25-arm64.zip' }] },
      { tag_name: 'v1.0.24-mac', assets: [] },
    ];
    const picked = app.PickMacRelease(macReleases, 'arm64');
    check(
      'a Mac update comes from the newest -mac release, not the Windows one or a draft',
      picked && picked.version === '1.0.25' && picked.page === 'page25' && picked.zipUrl === dl + 'v1.0.25-mac/SumIT-1.0.25-arm64.zip'
        && picked.zipSha256 === 'ab'.repeat(32) && picked.zipSize === 123 && picked.dmgUrl.endsWith('-arm64.dmg')
    );
    check('an Intel Mac gets the Intel zip', app.PickMacRelease(macReleases, 'x64').zipUrl.endsWith('-x64.zip'));
    check('outside a packaged app nothing is replaced', app.UpdatableAppPath() === null);
    const swapDir = path.join(root, 'swap');
    const installed = path.join(swapDir, 'Applications', 'SumIT.app');
    const staged = path.join(swapDir, 'sumit-update-1.0.25', 'SumIT.app');
    mkdirp(installed); mkdirp(staged);
    writeText(path.join(installed, 'v.txt'), 'old'); writeText(path.join(staged, 'v.txt'), 'new');
    const swapScript = path.join(swapDir, 'swap.sh');
    writeText(swapScript, Host.UpdateSwapScript);
    const swapped = spawnSync('/bin/bash', [swapScript, '999999', staged, installed, '0'], { encoding: 'utf8' });
    check(
      'after the app quits, the new SumIT.app takes the old one\'s place',
      swapped.status === 0 && readText(path.join(installed, 'v.txt')) === 'new' && !dirExists(installed + '.old-update') && !dirExists(path.dirname(staged))
    );

    // 2. Course & Lecture management
    const course = 'test-course';
    app.SaveLecture(course, { num: 1, title: 'Lecture 1', date: '2026-10-25', due: '' });
    check('lecture persists', app.ManualLectures(course).length === 1);
    const dir = app.LectureDir(course, 1);
    check('separate student lecture directory', dir.endsWith(path.join('הרצאות', 'הרצאה 1')));
    check('homework directory', dirExists(path.join(dir, C.Exercises)));
    check('notebook directory', dirExists(path.join(dir, C.Notebook)));
    check('lecturer notes directory', dirExists(path.join(dir, C.LecturerNotes)));
    check(
      "a lecture's files are routed to the right folder",
      app.LectureSubdir(dir, '', 'slides.pdf') === path.join(dir, C.LecturerNotes)
        && app.LectureSubdir(dir, '', 'Sol_List_1.pdf') === path.join(dir, C.Exercises)
        && app.LectureSubdir(dir, 'notes', 'my.pdf') === path.join(dir, C.Notebook)
    );
    check(
      'summary lives in its own folder inside the lecture',
      app.StudyPagePath(course, 1) === path.join(dir, C.SummaryName, C.SummaryHtmlName)
        && app.LecturePdfPath(course, 1) === path.join(dir, C.SummaryName, C.SummaryPdfName)
    );
    check('the interactive page and the PDF have different names', C.SummaryHtmlName !== C.SummaryPdfName);
    check(
      "a lecture's subfolders are valid save destinations",
      app.SafeDownloadFolder('הרצאות\\הרצאה 1\\תרגילים') === path.join(app.LectureFolderName(1), C.Exercises)
        && app.SafeDownloadFolder('הרצאות\\הרצאה 1\\..') === SafeName('הרצאות\\הרצאה 1\\..')
    );
    check('default courses folder ends with HIT/קורסים', app.DefaultStudyRootForTest().endsWith(path.join('HIT', 'קורסים')));
    check('nested download destination', app.SafeDownloadFolder('הרצאות\\הרצאה 1') === app.LectureFolderName(1));
    check('download traversal is flattened', !app.SafeDownloadFolder('..\\..\\outside').includes('/') && !app.SafeDownloadFolder('..\\..\\outside').includes('\\'));

    app.SaveLecture(course, { num: 2, date: '2026-02-31' });
    check('invalid dates do not create lecture', app.ManualLectures(course).length === 1);
    app.SaveLecture(course, { num: 2, title: 'Lecture 2' });
    writeText(path.join(dir, 'source.txt'), 'version one');
    const original = app.LectureFingerprint(course, 2);
    check('fingerprint stable', original === app.LectureFingerprint(course, 2));
    writeText(path.join(dir, 'source.txt'), 'version two');
    check('prior lecture edit invalidates later summary', original !== app.LectureFingerprint(course, 2));
    const current = app.LectureFingerprint(course, 1);
    writeText(path.join(app.LectureDir(course, 2), 'later.txt'), 'future');
    check('future lecture excluded', current === app.LectureFingerprint(course, 1));
    mkdirp(path.join(dir, C.SummaryName));
    writeText(path.join(dir, C.SummaryName, C.SummaryPdfName), 'generated');
    writeText(path.join(dir, C.SummaryName, C.SummaryHtmlName), 'generated');
    check('the summary files themselves do not change the fingerprint', current === app.LectureFingerprint(course, 1));
    writeText(path.join(dir, 'unrelated.mp4'), 'not a recording');
    const local = app.LocalInfo(course, 1);
    check('unrelated MP4 not listed as recording', Int(local, 'videos') === 0);

    // 3. Recording queue
    app.working = true;
    check('automatic recording refused', !app.QueueRecording(course, 1, 'https://hit-ac-il.zoom.us/rec/play/test', false));
    check('manual recording accepted', app.QueueRecording(course, 1, 'https://hit-ac-il.zoom.us/rec/play/test', true, 'My lecture'));
    check('recording stored in current lecture', app.jobs[app.jobs.length - 1].Dir === path.join(dir, C.RecordingFolder) && app.jobs[app.jobs.length - 1].Lecture === 1);
    check('custom file name retained', app.jobs[app.jobs.length - 1].Name === 'My lecture');
    app.QueueRecording(course, 1, 'https://hit-ac-il.zoom.us/rec/play/second', true, 'My lecture');
    check('recording name collisions preserved', app.jobs[app.jobs.length - 1].Name === 'My lecture (2)');

    // 4. Moodle item picking & ZIP unpacking
    const sections = [
      { num: 0, title: 'כללי', items: [{ mod: 'resource', name: 'סילבוס הקורס', url: 'u1' }, { mod: 'forum', name: 'הודעות', url: 'u2' }] },
      { num: 3, title: 'מבחנים לדוגמה', items: [{ mod: 'resource', name: 'מבחן 2023 מועד א', url: 'u3' }, { mod: 'resource', name: 'פתרון', url: 'u4' }, { mod: 'folder', name: 'עוד', url: 'u5' }] },
      { num: 4, title: 'הרצאה 1', items: [{ mod: 'resource', name: 'שקפים', url: 'u6' }, { mod: 'resource', name: 'מבחן אמצע 2022', url: 'u7' }] },
    ];
    const exams = app.PickMoodleItems(sections, 'exams');
    check(
      'every item of the exams section is taken, with the solutions',
      JSON.stringify(exams.map(i => Str(i, 'url')).sort()) === JSON.stringify(['u3', 'u4', 'u5', 'u7'])
    );
    check('an exam named inside a lecture section is taken too, the slides are not', !exams.some(i => Str(i, 'url') === 'u6'));
    const syllabus = app.PickMoodleItems(sections, 'syllabus');
    check(
      'only the syllabus is taken for the course information',
      syllabus.filter(x => !Bool(x, 'discoveryOnly')).length === 1 && syllabus.some(x => Str(x, 'url') === 'u1')
    );
    const info = app.PickMoodleItems([{ num: 0, title: 'מידע על הקורס', items: [{ mod: 'resource', name: 'הודעה על שינוי חדר', url: 'i1' }] }], 'syllabus');
    check('an item in the course-info section is checked, not taken as the syllabus', info.length === 1 && Bool(info[0], 'discoveryOnly'));
    check(
      'lectures, homework and exams are not syllabus candidates',
      app.NotSyllabusName('הרצאה 3.pdf') && app.NotSyllabusName('תרגיל 2.pdf') && app.NotSyllabusName('מבחן 2023.pdf') && !app.NotSyllabusName('סילבוס תרגילים.pdf')
    );
    check('a passing mention of the syllabus is not a syllabus', !app.LooksLikeSyllabus('=== hw2.pdf\nתרגיל 2\nכפי שמופיע בסילבוס, יש להגיש את התרגיל עד יום ראשון.'));
    check('a syllabus is recognised by its title and parts', app.LooksLikeSyllabus('=== a.pdf\nסילבוס - מבני נתונים\nמטרות הקורס: ...\nהרכב הציון: מבחן 80%'));
    check('a syllabus without the word is recognised by three parts', app.LooksLikeSyllabus('מבני נתונים\nמטרות הקורס\nדרישות קדם: מבוא\nהרכב הציון: מבחן 80%'));
    const sdir = path.join(root, 'zip-syllabus');
    mkdirp(sdir);
    const spath = path.join(sdir, 'syllabus.zip');
    createZip(spath, { 'סילבוס/סילבוס.pdf': 'x', 'סילבוס/הרצאה 1.pdf': 'x' });
    const sOut = path.join(sdir, 'out');
    check(
      'a syllabus zip gives only the syllabus, not the lectures in it',
      (await app.UnpackZip(spath, sOut, 'syllabus', 0, 'סילבוס syllabus.zip')) === 1 && listFiles(sOut).length === 1
    );

    // Python runs without blocking the app (ExecOut, in place of spawnSync).
    const { ExecOut } = require('../lib/util');
    const outErr = await ExecOut('/bin/sh', ['-c', 'printf out; printf err >&2; exit 3']);
    check('a helper process gives its exit code with stdout and stderr apart', outErr.code === 3 && outErr.stdout === 'out' && outErr.stderr === 'err');
    let ticked = false; const tick = setTimeout(() => { ticked = true; }, 20);
    const slow = await ExecOut('/bin/sh', ['-c', 'sleep 0.3']);
    check('the app keeps running while a helper process works', slow.code === 0 && ticked); clearTimeout(tick);
    check('a helper process that prints too much is stopped', (await ExecOut('/bin/sh', ['-c', 'yes'], { maxBytes: 1024 })).code === -3);
    check('a helper program that does not exist gives an error, not a crash', (await ExecOut(path.join(root, 'no-such-python'), [])).code === -1);

    const zdir = path.join(root, 'zip-exams');
    mkdirp(zdir);
    const zpath = path.join(zdir, 'exams.zip');
    createZip(zpath, { '2023/exam a.pdf': 'x', '2023/solution a.pdf': 'x', '../evil.exe': 'x', 'run.bat': 'x' });
    const unpacked = await app.UnpackZip(zpath, zdir);
    check(
      'zip opened safely and original archive is preserved',
      unpacked === 2
        && fileExists(path.join(zdir, '2023_exam a.pdf'))
        && fileExists(path.join(zdir, '2023_solution a.pdf'))
        && fileExists(zpath)
        && !fileExists(path.join(zdir, 'evil.exe'))
        && !fileExists(path.join(zdir, 'run.bat'))
    );

    // 5. Lifecycle, Queue & Study Rendering
    await runLifecycleTests(app, root, check);

    // 6. Helper HTTP tests
    await runHelperTests(app, root, check);

    // 6b. Spaced repetition of the flashcards, and "what to do today"
    await runReviewAndPlannerTests(app, root, check);

    // 6c. Pomodoro timer
    await runPomodoroTests(app, check);

    // 6d. Calendars (iCal): the reader, and the host that fetches them
    await runCalendarTests(app, root, check);

    // 6e. "I'm stuck": the steps, from the data of the course
    await runCoachTests(app, root, check);

    // 6f. "What to do in this block?": a plan that fills a block of the calendar
    await runBlockPlanTests(app, check);

    // 6f2. "המחשה חזותית": the spec, the sandboxed frame and the request from the summary page
    await runVisualTests(app, root, check);

    // 6f3. Sync with Google Drive: the rules, sign-in and two computers, through a fake Google
    await runDriveTests(app, root, check);

    // 6g. Study track (beta): the profile, the strategy, the week of blocks and the progress
    await runStudyTrackTests(app, root, check);

    // 6h. Study tools: iCal for the blocks, a NotebookLM bundle, Anki cards
    await runStudyExportTests(app, root, check);
    await runCalendarSyncTests(app, root, check);

    // 6i. Courses open offline: the saved list, the quiet background reads
    await runOfflineCoursesTests(app, root, check);

    // 7. Brain CLI & Second Opinion tests
    await runBrainTests(app, root, check);

    // 8. Summary Share and Study Policy port verification
    const { buildSummaryShare } = require('../lib/modules/summary-share');
    const { missingQuestionStatements } = require('../lib/modules/study-policy');
    const shareRoot = path.join(platform.TempDir, 'sumit-share-test-' + guidN());
    mkdirp(path.join(shareRoot, 'summary', '.math', 'fonts'));
    mkdirp(path.join(shareRoot, 'exercises'));
    const page = path.join(shareRoot, 'summary', 'page.html'), zip = path.join(shareRoot, 'test.zip');
    writeText(path.join(shareRoot, 'summary', '.math', 'style.css'), "@font-face{src:url('fonts/test.woff2')}");
    writeText(path.join(shareRoot, 'summary', '.math', 'fonts', 'test.woff2'), 'font');
    writeText(path.join(shareRoot, 'exercises', 'תרגיל.pdf'), 'pdf');
    writeText(path.join(shareRoot, 'private-notebook.pdf'), 'private');
    writeText(page, "<link href='.math/style.css'><a href='../exercises/%D7%AA%D7%A8%D7%92%D7%99%D7%9C.pdf#page=2'>PDF</a><a href='#x'>anchor</a><a href='https://example.org/'>web</a>");
    await buildSummaryShare(shareRoot, page, '', zip);
    check('SummaryShare exports valid zip file', fileExists(zip) && fs.statSync(zip).size > 100);

    // Study policy tests
    const statement = "<section class='question-statement' data-source='sheet.pdf, p1, Q1'><h4>Question</h4><p>A train moves at 34 m/s. Find its distance after 10 seconds.</p></section>";
    const card = (body) => "<details class='q' id='use-1'><summary>Question</summary><div class='qbody'>" + body + "</div></details>";
    check('complete sourced statement before solution accepted', missingQuestionStatements(card(statement + "<details class='reveal'><summary>Solution</summary>340 m</details>")).length === 0);
    check('solution without question rejected', missingQuestionStatements(card("<p>Hint only</p><details><summary>Solution</summary>340 m</details>")).length === 1);
    check('missing exercise section rejected', missingQuestionStatements('<h1>Summary without exercises</h1>').length === 1);
    try { fs.rmSync(shareRoot, { recursive: true, force: true }); } catch { }


    console.log(`\nALL ${passed} OFFLINE REGRESSION CHECKS PASSED.`);
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { }
  }
}

async function runLifecycleTests(app, root, check) {
  let resolveGate;
  const gate = new Promise(r => { resolveGate = r; });
  let operations = 0;
  const a = app.RunCourseOperation('A', 'info', async () => { operations++; await gate; });
  const duplicate = app.RunCourseOperation('A', 'info', () => { operations++; return gate; });
  const b = app.RunCourseOperation('B', 'info', async () => { operations++; await gate; });
  await delay(10);
  check('course operations are independent and duplicate clicks do not restart work', operations === 2 && app.courseOperations.size === 2);
  resolveGate(true);
  await Promise.all([a, b, duplicate]);
  await app.RunCourseOperation('A', 'info', () => { throw new Error('expected failure'); });
  check('completed and failed course operations release their busy state', app.courseOperations.size === 0);

  let active = 0, peak = 0, calls = 0;
  app.summaryWorkOverride = async (course, num) => {
    active++; peak = Math.max(peak, active); calls++;
    await delay(40);
    const page = app.StudyPagePath(course, num);
    writeText(page, '<html><body>complete</body></html>');
    active--;
    return { Provider: 'claude', Error: false };
  };
  await Promise.all([
    app.LecturePdfAsync('queue-a', 1, 'one'),
    app.LecturePdfAsync('queue-b', 1, 'two'),
    app.LecturePdfAsync('queue-a', 1, 'one'),
  ]);
  check('multiple courses serialize and duplicate clicks do not spend tokens', calls === 2 && peak === 1 && app.summaryQueued.size === 0);

  const previous = app.StudyPagePath('queue-a', 1);
  app.summaryWorkOverride = async () => {
    writeText(previous, 'broken partial output');
    return { Error: true };
  };
  await app.LecturePdfAsync('queue-a', 1, 'one', false, true);
  check(
    'failed regeneration restores the last complete summary',
    readText(previous).includes('complete') && readText(previous + '.interrupted').includes('broken')
  );

  app.summaryWorkOverride = async () => {
    app.shuttingDown = true;
    writeText(previous, 'interrupted on close');
    return { Error: true };
  };
  await app.LecturePdfAsync('queue-a', 1, 'one', false, true);
  app.shuttingDown = false;
  check(
    'closing retains a durable pending job and the previous page',
    fileExists(app.PendingSummary('queue-a', 1)) && readText(previous).includes('complete')
  );

  app.summaryWorkOverride = async () => ({ Error: true, Text: 'test only' });
  const notesMessage = { course: 'queue-a', num: 1, title: 'one', notes: 'רק שאלות 1–2; לפרט את השיטה' };
  app.StartLectureSummary(notesMessage);
  check('summary notes saved per lecture without leaking to other courses', app.SummaryNotes('queue-a', 1).includes('1–2') && app.SummaryNotes('queue-b', 1) === '');
  await delay(10);
  notesMessage.notes = '';
  app.StartLectureSummary(notesMessage);
  check('summary notes can be cleared', app.SummaryNotes('queue-a', 1) === '');
  await delay(10);
  app.summaryWorkOverride = null;

  const fixture = path.join(root, 'math', 'lesson.html');
  writeText(fixture, "<html><head><script src='https://cdn.example/katex.min.js'></script></head><body dir='rtl'>מהירות $v^2-v_0^2=2a\\Delta x$ וגם \\(x+1\\) <details><summary>פתרון</summary>עברית ואנגלית</details></body></html>");
  app.PrepareStudyPage(fixture);
  app.PrepareStudyPage(fixture);
  const repaired = readText(fixture);
  check(
    'study page repair is offline, idempotent and preserves interaction',
    repaired.includes('.sumit-math/katex.min.js')
      && !repaired.includes('cdn.example')
      && (repaired.match(/sumit-render-start/g) || []).length === 1
      && repaired.includes('<details>')
  );

  const bookPage = path.join(root, 'math', 'book.html');
  writeText(
    bookPage,
    '<!doctype html><html dir="rtl"><head><meta charset="utf-8"></head><body><div class="wrap"><header class="top"><h1>נושא</h1></header><nav class="toc"><a href="#must">חובה</a><a href="#core">ליבה</a><a href="#use">תרגילים</a></nav><h2 id="must">🎯 מה חובה</h2><p>מהירות $v=x/t$</p><h2 id="core">הסבר</h2><p>$$a=\\frac{\\Delta v}{\\Delta t}$$</p><h2 id="use">🎯 שימוש בתרגילים</h2><p>שאלה 1</p><footer>f</footer></div></body></html>'
  );
  app.PrepareStudyPage(bookPage);
  app.PrepareStudyPage(bookPage);
  const bookHtml = readText(bookPage);
  check(
    'diagram support is offline and added once',
    (bookHtml.match(/data-sumit-diagrams/g) || []).length === 1
      && fileExists(path.join(path.dirname(bookPage), '.sumit-math', 'study-diagrams.js'))
  );
  check(
    'the study page becomes a book, added once',
    (bookHtml.match(/data-sumit-book/g) || []).length === 2
      && fileExists(path.join(path.dirname(bookPage), '.sumit-math', 'study-book.js'))
      && bookHtml.includes('sumit-render-start')
  );
}

async function runHelperTests(app, root, check) {
  const requests = [];
  const heads = [];
  let geminiStatus = 200;
  let openaiStatus = 200;

  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', d => body += d);
    req.on('end', () => {
      requests.push(req.url + ' ' + body);
      heads.push((req.headers['x-goog-api-key'] || '') + '|' + (req.headers['authorization'] || ''));
      const gem = req.url.includes('generateContent');
      const claude = req.url.includes('/v1/messages');
      const status = gem ? (req.url.includes('missing-model') ? 404 : geminiStatus) : claude ? 200 : openaiStatus;
      const reply = status !== 200
        ? '{"error":{"message":"quota"}}'
        : gem
          ? '{"candidates":[{"content":{"parts":[{"text":"תשובה מ-Gemini $x^2$"}]}}]}'
          : claude
            ? '{"content":[{"type":"text","text":"תשובה מ-Claude"}]}'
            : '{"choices":[{"message":{"content":"תשובה מ-ChatGPT"}}]}';
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(reply);
    });
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  process.env.SUMIT_GEMINI_URL = baseUrl;
  process.env.SUMIT_OPENAI_URL = baseUrl;
  process.env.SUMIT_ANTHROPIC_URL = baseUrl;

  try {
    app.geminiSignedOverride = false;
    app.codexSignedIn = false;
    delete app.settings.geminiKey;
    delete app.settings.openaiKey;
    app.settings.helperPref = 'auto';
    check('no helper without a key', app.HelperOrder().length === 0);

    app.settings.geminiKey = Protect('g'.repeat(30));
    app.settings.openaiKey = Protect('o'.repeat(30));
    check('auto: Gemini first, then ChatGPT', app.HelperOrder().join(',') === 'gemini,openai');
    app.settings.helperPref = 'openai';
    check('the student can prefer ChatGPT', app.HelperOrder().join(',') === 'openai,gemini');
    app.settings.helperPref = 'claude';
    check('Claude only means no helpers', app.HelperOrder().length === 0);
    app.settings.helperPref = 'auto';

    const msgs = [['user', 'מה זה אינטגרל?']];
    let r = await app.HelperAsk('system text', msgs);
    check('Gemini answers', !r.Error && r.Provider === 'gemini' && r.Text.includes('Gemini'));
    check(
      'the key travels in a header and the system text and question in the body',
      heads[0].startsWith('g'.repeat(30))
        && requests[0].includes('system text')
        && requests[0].includes('systemInstruction')
        && !requests[0].includes('g'.repeat(30))
    );

    geminiStatus = 429;
    r = await app.HelperAsk('system text', msgs);
    check(
      'a limit on Gemini passes the question to ChatGPT',
      !r.Error && r.Provider === 'openai' && r.Text.includes('ChatGPT') && heads[heads.length - 1].includes('Bearer ' + 'o'.repeat(30))
    );
    geminiStatus = 200;

    const course = 'helper-course';
    mkdirp(path.join(app.CourseDir(course), C.SumitDir, 'digests'));
    writeText(path.join(app.CourseDir(course), C.SumitDir, 'digests', 'הרצאה 1.md'), 'DIGEST-ONE נוסחת רימן');
    check('nothing to read yet: the question goes to Claude', app.HelperContext('empty-course', 'lesson:1') === null && app.HelperContext(course, 'course') === null);
    check('a later lecture is built on the earlier digests', app.HelperContext(course, 'lesson:3').includes('DIGEST-ONE'));

    app.SaveLecture(course, { num: 2, title: 'L2' });
    writeText(app.StudyPagePath(course, 2), '<html><style>.x{}</style><body><h2>SECTION-TWO</h2><script>alert(1)</script><p>טקסט <b>חשוב</b> &amp; נוסחה $a+b$</p></body></html>');
    const ctx = app.HelperContext(course, 'lesson:2');
    check(
      'the context holds the earlier digest and the summary text, without markup',
      ctx !== null && ctx.includes('DIGEST-ONE') && ctx.includes('SECTION-TWO') && ctx.includes('חשוב') && ctx.includes('$a+b$') && !ctx.includes('<b>') && !ctx.includes('alert(1)')
    );
    check('a later lecture is not mixed in', !app.HelperContext(course, 'lesson:1').includes('SECTION-TWO'));
    check('the lecture\'s own summary comes before the digests', ctx.indexOf('SECTION-TWO') < ctx.indexOf('DIGEST-ONE'));

    // Token budget: a long course sends its nearest material and stays under the cap.
    for (let k = 3; k <= 12; k++) writeText(path.join(app.CourseDir(course), C.SumitDir, 'digests', 'הרצאה ' + k + '.md'), 'DIGEST-' + k + ' ' + 'ד'.repeat(9000));
    app.SaveLecture(course, { num: 12, title: 'L12' });
    writeText(app.StudyPagePath(course, 12), '<html><body><h2>PAGE-TWELVE</h2><p>' + 'ס'.repeat(80000) + '</p></body></html>');
    const big = app.HelperContext(course, 'lesson:12');
    check('a long course stays within the context budget', big.length <= 60000);
    check('the budget keeps the lecture\'s summary and its own digest', big.includes('PAGE-TWELVE') && big.includes('DIGEST-12') && big.includes('DIGEST-11'));
    check('the budget drops the oldest digests first', !big.includes('DIGEST-ONE') && !big.includes('DIGEST-3 '));

    // Claude through an API key: the current Haiku, a cached system text, no temperature.
    delete app.settings.claudeModel;
    let cr = await app.HelperCall('claude', 'c'.repeat(30), 'SYSTEM-CLAUDE', [['user', 'שאלה']]);
    const creq = requests[requests.length - 1];
    check('Claude by key answers on the current Haiku', !cr.Error && cr.Text.includes('Claude') && creq.includes('"model":"claude-haiku-5-5"'));
    check('the Claude system text is cached', creq.includes('"cache_control":{"type":"ephemeral"}') && creq.includes('SYSTEM-CLAUDE'));
    check('no temperature goes to Claude, and the effort is low', !creq.includes('temperature') && creq.includes('"effort":"low"'));
    app.settings.claudeModel = 'claude-3-5-haiku-latest';
    check('a saved retired Claude 3 model moves to the current Haiku', app.ClaudeModel === 'claude-haiku-5-5');
    app.settings.claudeModel = 'claude-sonnet-5-5';
    check('a chosen current Claude model is kept', app.ClaudeModel === 'claude-sonnet-5-5');
    delete app.settings.claudeModel;

    const said = [];
    const answered = await app.HelperChat(course, 'lesson:2', 'תסביר לי', (role, t) => said.push(role + ':' + t));
    check(
      'the chat is answered by a helper and remembered',
      answered && said.length === 1 && said[0].startsWith('assistant:') && 'lectureChatHistories' in app.LoadMeta(course)
    );
    check('the question reached the helper with the lecture\'s text', requests[requests.length - 1].includes('SECTION-TWO') && requests[requests.length - 1].includes('תסביר לי'));

    // geminiSignedOverride is still false and geminiKey is still set → mode === 'key'
    const sgr = await app.SummaryGemini('system text', [['user', 'מה זה?']], null, null);
    check('SummaryGemini resolves with API key without throwing', !sgr.Error && sgr.Provider === 'gemini');

    let n0 = requests.length;
    await app.SummaryGemini('system text', [['user', 'מה זה?']], null, null, null, { maxTokens: 350 });
    check('the summary chat caps the answer at 350 tokens', requests[n0].includes('"maxOutputTokens":350'));
    n0 = requests.length;
    await app.SummaryGemini('system text', [['user', 'מה זה?']], null, null);
    check('flashcards keep the full answer length', requests[n0].includes('"maxOutputTokens":2048'));
    app.settings.geminiModel = 'missing-model';
    n0 = requests.length;
    const moved = await app.SummaryGemini('system text', [['user', 'מה זה?']], null, null);
    check('a Gemini model that no longer exists moves to gemini-flash-latest', !moved.Error && requests.length === n0 + 2 && requests[n0 + 1].includes('/models/gemini-flash-latest:'));
    delete app.settings.geminiModel;
    app.settings.claudeKey = Protect('c'.repeat(30));
    geminiStatus = 500;
    openaiStatus = 500;
    const switched = [];
    const realSend = app.Send;
    app.Send = (msg) => { if (msg.type === 'summaryChatProvider') switched.push(msg.text); };
    const conversation = [['user', 'שאלה ראשונה'], ['assistant', 'תשובה ראשונה'], ['user', 'שאלה שנייה']];
    const fromClaude = await app.SummaryGemini('system text', conversation, null, null, null, { maxTokens: 350 });
    app.Send = realSend;
    check(
      'Gemini and ChatGPT down: Claude answers with the whole conversation',
      !fromClaude.Error && fromClaude.Provider === 'claude' && fromClaude.Text.includes('Claude')
        && requests[requests.length - 1].includes('תשובה ראשונה') && requests[requests.length - 1].includes('"max_tokens":350')
    );
    check('the student sees which AI took over', switched.length === 2 && switched[0].includes('ממשיך עם ChatGPT') && switched[1] === 'ChatGPT לא זמין — ממשיך עם Claude');
    geminiStatus = 200;
    openaiStatus = 200;
    delete app.settings.claudeKey;
    check(
      'a pasted question loses its markup and extra spaces, not its math',
      app.CleanChatText('  מה  זה <span style="x">אינטגרל</span>?\n\n\n\nאם a<b and c>d  ') === 'מה זה אינטגרל?\n\nאם a<b and c>d'
    );

    app.settings.studyRoot = path.join(root, 'courses');
    app.ApplySchedule({
      classes: [{ day: 'ראשון', start: '08:30', end: '11:00', course: 'אינפי' }],
      exams: [{ course: 'אינפי', moed: 'א', date: '2027-02-03' }],
      semesterStart: '2026-10-18',
      holidays: [{ name: 'חנוכה', from: '2026-12-06', to: '2026-12-07' }],
    });
    app.ApplySchedule({
      classes: [],
      exams: [{ course: 'פיזיקה', moed: 'א', date: '2027-02-10' }],
      holidays: [],
    });
    const tt = JSON.parse(readText(app.TimetableJson));
    const ac = JSON.parse(readText(app.AcademicJson));
    check('a second page keeps the classes and adds the exam', tt.classes.length === 1 && tt.exams.length === 2);
    check('the semester start and holidays are kept', Str(ac, 'semesterStart') === '2026-10-18' && ac.holidays.length === 1);
    check('JSON is found inside a code fence', app.JsonFromAnswer('```json\n{"a":1}\n```') !== null && app.JsonFromAnswer('no json here') === null);
  } finally {
    await new Promise(r => server.close(r));
    delete process.env.SUMIT_GEMINI_URL;
    delete process.env.SUMIT_OPENAI_URL;
  }
}

async function runBrainTests(app, root, check) {
  const fakes = path.join(root, 'fakes');
  mkdirp(fakes);

  const scriptBody = `#!/usr/bin/env python3
import os, sys, time, re

name = os.environ.get('FAKE_NAME', '')
args = ' '.join(sys.argv[1:])

if 'login' in args and 'status' in args:
    print('Logged in using ChatGPT')
    sys.exit(0)

if os.environ.get('FAKE_AGY_LOGIN') == '1':
    if 'READY' in args:
        if os.environ.get('FAKE_VERIFY_WAIT') == '1':
            time.sleep(60)
        print('READY')
        sys.exit(0)
    if os.environ.get('FAKE_AGY_WAIT') == '1':
        time.sleep(60)
        sys.exit(0)
    time.sleep(0.5)
    with open(os.environ['FAKE_AGY_CRED'], 'w') as f:
        f.write('saved')
    time.sleep(60)
    sys.exit(0)

if os.environ.get('FAKE_LOGIN') == '1':
    if os.environ.get('CI'):
        sys.stderr.write('non-interactive session\\n')
        sys.exit(41)
    sys.stdout.write('Opening authentication page in your browser. Do you want to continue? [Y/n]: ')
    sys.stdout.flush()
    line = sys.stdin.readline().strip()
    if line == 'Y':
        with open(os.environ['FAKE_LOGIN_FLAG'], 'w') as f:
            f.write('signed-in')
        print('https://accounts.example/login?x=1')
        time.sleep(0.3)
    sys.exit(0)

if name == 'gemini':
    with open('material.txt', 'r', encoding='utf-8') as f:
        text = f.read()
else:
    text = sys.stdin.read()

if os.environ.get('FAKE_FAIL') == '1':
    sys.stderr.write('usage limit reached\\n')
    sys.exit(1)

ans = os.environ.get('FAKE_REPLY') or f"{name} saw {len(text)} chars; marker={'True' if 'MARKER-Q' in text else 'False'}"
if name == 'codex' and '-o' in sys.argv:
    idx = sys.argv.index('-o')
    with open(sys.argv[idx + 1], 'w', encoding='utf-8') as f:
        f.write(ans)
else:
    print(ans)
`;

  const pyScript = path.join(fakes, 'fake.py');
  writeText(pyScript, scriptBody);
  fs.chmodSync(pyScript, 0o755);

  for (const name of ['codex', 'gemini']) {
    const sh = path.join(fakes, 'fake-' + name);
    writeText(sh, `#!/bin/sh\nexport FAKE_NAME=${name}\nexec /usr/bin/python3 "${pyScript}" "$@"\n`);
    fs.chmodSync(sh, 0o755);
  }

  process.env.SUMIT_CODEX = path.join(fakes, 'fake-codex');
  process.env.SUMIT_AGY = path.join(fakes, 'fake-gemini');

  try {
    delete app.settings.geminiKey;
    delete app.settings.openaiKey;
    app.settings.helperPref = 'auto';
    app.codexSignedIn = false;
    app.geminiSignedOverride = false;
    check('not signed in: no helper', app.HelperOrder().length === 0);

    app.codexSignedIn = true;
    app.geminiSignedOverride = true;
    check(
      'signed in with the accounts: both helpers, Gemini first',
      app.HelperOrder().join(',') === 'gemini,openai'
        && app.HelperMode('gemini') === 'account'
        && app.HelperMode('openai') === 'account'
    );

    const msgs = [['user', 'MARKER-Q ' + 'x'.repeat(120000)]];
    let r = await app.HelperAsk('system', msgs);
    check(
      'Gemini answers through the account, a long text goes in via file',
      !r.Error && r.Provider === 'gemini' && r.Text.includes('gemini saw') && r.Text.includes('marker=True') && !r.Text.includes('saw 0 ')
    );
    r = await app.HelperAsk('system', msgs, 'openai');
    check('ChatGPT answers through the account', !r.Error && r.Provider === 'openai' && r.Text.includes('codex saw') && r.Text.includes('marker=True'));

    process.env.FAKE_FAIL = '1';
    r = await app.HelperAsk('system', msgs);
    check('a limit on the subscription is reported as a limit', r.Error && r.Limit);
    delete process.env.FAKE_FAIL;

    const flag = path.join(fakes, 'signed.txt');
    process.env.FAKE_LOGIN = '1';
    process.env.FAKE_LOGIN_FLAG = flag;
    await app.RunLogin(path.join(fakes, 'fake-gemini'), ['-p', 'hello'], 'gemini', () => fileExists(flag), true);
    check('the sign-in is answered by the app', fileExists(flag));
    delete process.env.FAKE_LOGIN;

    const credFlag = path.join(fakes, 'agy-credential.txt');
    process.env.FAKE_AGY_LOGIN = '1';
    process.env.FAKE_AGY_CRED = credFlag;
    process.env.SUMIT_AGY_CRED = credFlag;
    app.settings.agyOk = false;
    app.geminiSignedOverride = null;
    let signedIn = await app.LoginAgy();
    check('Gemini sign-in: once the account is saved the app is connected', signedIn && Bool(app.settings, 'agyOk') && app.HelperMode('gemini') === 'account');
    fs.unlinkSync(credFlag);

    process.env.FAKE_AGY_WAIT = '1';
    app.AgyLoginTimeoutSeconds = 1;
    const t0 = Date.now();
    signedIn = await app.LoginAgy();
    check('Gemini sign-in times out without claiming connected', !signedIn && !Bool(app.settings, 'agyOk') && (Date.now() - t0) < 10000);
    app.AgyLoginTimeoutSeconds = 300;
    const t1 = Date.now();
    const pendingCancel = app.LoginAgy();
    await delay(200);
    app.CancelAgyLogin();
    signedIn = await pendingCancel;
    check('Gemini sign-in can be cancelled promptly', !signedIn && app.agyLoginProcess === null && (Date.now() - t1) < 10000);
    delete process.env.FAKE_AGY_WAIT;
    delete process.env.FAKE_AGY_LOGIN;
    delete process.env.SUMIT_AGY_CRED;

    app.codexSignedIn = true;
    app.geminiSignedOverride = true;
    const wasLogged = app.claudeLoggedIn;
    app.claudeLoggedIn = true;
    process.env.SUMIT_CLAUDE = path.join(fakes, 'fake-codex');
    const routed = [];
    app.aiWorkOverride = async (provider) => {
      routed.push(provider);
      return { Error: provider !== 'gemini', Text: provider !== 'gemini' ? 'usage limit reached' : 'ready' };
    };
    const routedResult = await app.RunAi('routing', root, 'test', null, null, null);
    check('generation falls back Claude then ChatGPT then Gemini', routed.join(',') === 'claude,openai,gemini' && routedResult.Provider === 'gemini' && !routedResult.Error);

    routed.length = 0;
    app.aiWorkOverride = async (provider) => {
      routed.push(provider);
      return { Error: true, Text: 'invalid input' };
    };
    await app.RunAi('routing', root, 'test', null, null, null);
    check('non-quota errors do not spend another provider', routed.length === 1);
    app.aiWorkOverride = null;

    // Claude CLI: none of the student's own MCP servers, and a lighter model for chats and short reading jobs.
    delete app.settings.claudeCliModel;
    const sumArgs = app.ClaudeArgs('sum|c|1', null, null);
    const chatArgs = app.ClaudeArgs('chat|c|lesson:1', 'S1', 'SYS');
    check('Claude runs without the student\'s MCP servers', sumArgs.includes('--strict-mcp-config') && chatArgs.includes('--strict-mcp-config'));
    check('a study page keeps the account\'s own model', !sumArgs.includes('--model') && app.ClaudeModelFor('exam|c', {}) === null && app.ClaudeModelFor('hw|c', {}) === null);
    check('a chat, the timetable and the syllabus run on Sonnet',
      chatArgs[chatArgs.indexOf('--model') + 1] === 'sonnet' && app.ClaudeModelFor('timetable', {}) === 'sonnet' && app.ClaudeModelFor('info|c', {}) === 'sonnet');
    check('a chat resumes its session with its system text', chatArgs[chatArgs.indexOf('--resume') + 1] === 'S1' && chatArgs[chatArgs.indexOf('--append-system-prompt') + 1] === 'SYS');
    check('the model setting overrides the choice', app.ClaudeModelFor('chat|c', { claudeCliModel: 'default' }) === null && app.ClaudeModelFor('sum|c', { claudeCliModel: 'opus' }) === 'opus');

    // A long Claude chat starts a new session with the last turns as text, instead of resending everything.
    const chatCourse = 'chat-session-course';
    app.SaveLecture(chatCourse, { num: 1, title: 'L1' });
    writeText(path.join(app.LectureDir(chatCourse, 1), 'slides.txt'), 'חומר');
    const savedPref = app.settings.helperPref;
    app.settings.helperPref = 'claude';
    const realRunAi = app.RunAi;
    const seen = [];
    let nextSession = 'SESSION-A';
    app.RunAi = async (key, cwd, prompt, session) => {
      seen.push({ key, prompt, session });
      return { Error: false, Text: 'תשובה ' + seen.length, Session: session || nextSession, Provider: 'claude' };
    };
    for (let i = 0; i < 9; i++) await app.Chat(chatCourse, 'שאלה ' + (i + 1), 'lesson:1');
    check('the first questions of a chat resume one session', seen[0].session === null && seen.slice(1, 8).every(s => s.session === 'SESSION-A'));
    check('after 8 questions the chat starts a new session', seen[8].session === null);
    check('the new session gets the last turns as text', seen[8].prompt.includes('השיחה עד עכשיו') && seen[8].prompt.includes('שאלה 8') && seen[8].prompt.includes('שאלה 9') && !seen[8].prompt.includes('שאלה 1\n'));
    nextSession = 'SESSION-B';
    await app.Chat(chatCourse, 'שאלה 10', 'lesson:1');
    check('the turn count starts again with the new session', Int(app.LoadMeta(chatCourse).lectureChatTurns, 'lesson:1') === 2 && seen[9].session === 'SESSION-A');
    app.RunAi = realRunAi;
    app.settings.helperPref = savedPref;
    app.claudeLoggedIn = wasLogged;
    delete process.env.SUMIT_CLAUDE;

    // Second opinion test
    const course = 'review-course';
    app.SaveLecture(course, { num: 1, title: 'L1' });
    writeText(app.StudyPagePath(course, 1), '<html><body><h1>סיכום</h1><p>שאלה 2: התשובה היא 5</p></body></html>');
    process.env.FAKE_REPLY = '{"verdict":"issues","issues":[{"where":"שאלה 2","problem":"החישוב שגוי","old":"התשובה היא 5","new":"התשובה היא 7"},{"where":"שאלה 9","problem":"לא ניתן לצטט","old":"","new":""}]}';
    let note = await app.SecondOpinion(course, 1, 'claude');
    let html = readText(app.StudyPagePath(course, 1));
    check(
      "a reviewer's correction is made in the page itself, quietly",
      note !== null && note.includes('תיקן') && html.includes('התשובה היא 7') && !html.includes('התשובה היא 5') && html.includes('<h1>סיכום</h1>')
    );
    check('what could not be quoted stays as a small closed note', html.includes('הערות לבדיקה') && !html.includes('<section id="second-opinion'));

    process.env.FAKE_REPLY = '{"verdict":"ok","issues":[]}';
    writeText(app.StudyPagePath(course, 1), html.replace('התשובה היא 7', 'התשובה היא 7 (בדיקה)'));
    note = await app.SecondOpinion(course, 1, 'claude');
    html = readText(app.StudyPagePath(course, 1));
    check('a clean check says so and clears the old note', note.includes('לא מצא טעויות') && !html.includes('הערות לבדיקה'));

    process.env.FAKE_REPLY = '{"verdict":"issues","issues":[{"where":"x","problem":"y","old":"","new":""}]}';
    note = await app.SecondOpinion(course, 1, 'claude');
    check('unchanged review reuses cached result', note.includes('לא מצא טעויות'));
    delete process.env.FAKE_REPLY;
  } finally {
    delete process.env.SUMIT_CODEX;
    delete process.env.SUMIT_AGY;
    delete process.env.FAKE_AGY_LOGIN;
    delete process.env.FAKE_FAIL;
    delete process.env.FAKE_REPLY;
    delete process.env.FAKE_LOGIN;
    delete process.env.FAKE_LOGIN_FLAG;
    delete process.env.SUMIT_AGY_CRED;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function runReviewAndPlannerTests(app, root, check) {
  const T = '2026-11-10';
  // The schedule: good goes 1, 3, 7 days, then grows by the ease; again starts over; hard grows slowly.
  let st = app.ReviewNextState(undefined, 'good', T);
  check('a new card rated "good" comes back tomorrow', st.interval === 1 && st.due === '2026-11-11' && st.reps === 1);
  st = app.ReviewNextState(st, 'good', '2026-11-11');
  const s3 = st.interval;
  st = app.ReviewNextState(st, 'good', '2026-11-14');
  const s7 = st.interval;
  st = app.ReviewNextState(st, 'good', '2026-11-21');
  check('"good" repeated: 3 days, 7 days, then more than a week', s3 === 3 && s7 === 7 && st.interval > 7 && st.ease > 2.5);
  st = app.ReviewNextState(st, 'again', '2026-12-10');
  check('"again" starts over from tomorrow and counts the lapse', st.interval === 1 && st.reps === 0 && st.lapses === 1 && st.due === '2026-12-11' && st.ease === 2.5);
  let hard = app.ReviewNextState({ interval: 10, ease: 1.35, reps: 4, lapses: 0 }, 'hard', T);
  check('"hard" grows slowly and the ease never drops below 1.3', hard.interval === 12 && hard.ease === 1.3);
  check('the schedule survives a damaged state', app.ReviewNextState({ interval: 'x', ease: 99, reps: -4 }, 'good', T).interval === 1);
  check('dates cross a month end', app.ReviewAddDays('2026-11-30', 1) === '2026-12-01' && app.ReviewAddDays('2026-03-01', -1) === '2026-02-28');
  check('a card keeps its key when only the spaces change', app.ReviewCardKey('מה זה  אינטגרל?') === app.ReviewCardKey(' מה זה אינטגרל? ') && app.ReviewCardKey('א') !== app.ReviewCardKey('ב'));

  // The queue: two courses, one summary with 14 never-seen cards, one with a card due today and one for later.
  const saved = app.settings.studyRoot;
  app.settings.studyRoot = path.join(root, 'review-courses');
  const cardsOf = (n, p) => Array.from({ length: n }, (_, i) => ({ front: p + ' שאלה ' + i, back: p + ' תשובה ' + i, tag: 't' }));
  const make = (course, num, cards, state) => {
    app.SaveLecture(course, { num, title: 'הרצאה ' + num });
    const page = app.StudyPagePath(course, num);
    mkdirp(path.dirname(page)); writeText(page, '<html></html>');
    writeText(app.FlashcardsFile(page), JSON.stringify({ summaryMtime: 1, cards }));
    if (state) writeText(app.ReviewsFile(page), JSON.stringify(state));
    return page;
  };
  const many = make('קורס-א', 1, cardsOf(14, 'א'));
  const dueCards = cardsOf(2, 'ב');
  const later = make('קורס-ב', 2, dueCards, {
    [app.ReviewCardKey(dueCards[0].front)]: { interval: 3, ease: 2.5, reps: 2, lapses: 0, due: '2026-11-08', last: '2026-11-05' },
    [app.ReviewCardKey(dueCards[1].front)]: { interval: 7, ease: 2.5, reps: 3, lapses: 0, due: '2026-11-20', last: '2026-11-13' },
  });
  const sum = app.ReviewSummary(T);
  check('review counts: one due, 14 new (10 may join), the later one waits', sum.due === 1 && sum.fresh === 14 && sum.count === 11 && sum.overdueDays === 2 && sum.courses['קורס-ב'] === 1);
  const cards = app.ReviewCards(T);
  check('a review starts with what is due, then at most 10 new cards', cards.length === 11 && cards[0].course === 'קורס-ב' && cards.slice(1).every(c => c.course === 'קורס-א'));

  const sent = [];
  const realSend = app.Send, realToast = app.Toast;
  app.Send = (m) => sent.push(m); app.Toast = () => { };
  app.RateCard({ course: 'קורס-ב', path: later, key: app.ReviewCardKey(dueCards[0].front), grade: 'good' });
  const after = app.LoadReviews(later)[app.ReviewCardKey(dueCards[0].front)];
  check('rating a card saves its schedule next to the summary and refreshes the count', after.reps === 3 && after.interval === 7 && after.due === app.ReviewAddDays(app.ReviewToday(), 7) && sent.some(m => m.type === 'reviewQueue'));
  const before = JSON.stringify(app.LoadReviews(many));
  app.RateCard({ course: 'קורס-א', path: many, key: 'not-a-key', grade: 'good' });
  app.RateCard({ course: 'קורס-א', path: many, key: app.ReviewCardKey('x'), grade: 'perfect' });
  app.RateCard({ course: 'קורס-א', path: path.join(root, 'outside.html'), key: app.ReviewCardKey('x'), grade: 'good' });
  check('a bad key, a bad grade or a path outside the course is refused', JSON.stringify(app.LoadReviews(many)) === before && !fileExists(path.join(root, 'חזרות.json')));
  // Cards sent to the page carry their key, so the page can rate them.
  const cachedPage = make('קורס-ג', 1, cardsOf(2, 'ג'));
  writeText(app.FlashcardsFile(cachedPage), JSON.stringify({ summaryMtime: fs.statSync(cachedPage).mtimeMs, cards: cardsOf(2, 'ג') }));
  sent.length = 0;
  await app.MakeFlashcards({ requestId: 'r1', course: 'קורס-ג', path: cachedPage });
  const result = sent.find(m => m.type === 'flashcardsResult');
  check('cards sent to the page carry the key that the review schedule uses', result && !result.error && result.cards.length === 2 && result.cards.every(c => c.key === app.ReviewCardKey(c.front)));
  app.Send = realSend; app.Toast = realToast;
  app.settings.studyRoot = saved;

  // The tasks ticket in the sidebar: everything due, from the student's tasks, Moodle, homework dates and the syllabus.
  {
    const T = require('../../src/web/tasks-ticket.js');
    const sylId = T.syllabusId('פיזיקה', '2099-01-05', 'הגשת דוח מעבדה');
    const input = {
      today: '2099-01-02',
      tasks: [{ id: 'a', title: 'לקנות מחשבון', course: '', due: '2099-01-03', done: false }, { id: 'b', title: 'בוצע', due: '2099-01-02', done: true },
        { id: 'c', title: 'בלי תאריך', due: '', done: false }, { id: 'd', title: 'פספסתי', due: '2098-12-30', done: false }],
      events: [{ id: 7, name: 'תרגיל 3', course: 'אלגוריתמים', when: new Date(2099, 0, 3, 23, 59).getTime() / 1000, url: 'https://moodle/x' },
        { id: 8, name: 'ישן', course: 'אלגוריתמים', when: new Date(2098, 11, 20, 12).getTime() / 1000 }],
      courses: [
        { id: 1, name: 'אלגוריתמים', local: { lectures: [{ num: 2, title: 'גרפים', due: '2099-01-03' }, { num: 1, due: '2098-12-31' }], info: { importantDates: [{ date: '2099-01-03', what: 'בוחן אמצע' }, { date: '2099-06-01', what: 'רחוק מדי' }, { date: '2098-12-01', what: 'עבר' }] } } },
        { id: 2, name: 'פיזיקה', local: { lectures: [], info: { importantDates: [{ date: '2099-01-05', what: 'הגשת דוח מעבדה' }] } } },
      ],
    };
    const list = T.items(input), ids = list.map(i => i.id);
    check('the ticket takes the four sources and leaves out done tasks, past homework and syllabus dates past or too far',
      ['mine-a', 'mine-c', 'mine-d', 'moodle-7', 'homework-אלגוריתמים-2', sylId].every(x => ids.includes(x)) && !ids.includes('mine-b') && !ids.includes('moodle-8') && !ids.includes('homework-אלגוריתמים-1') && list.filter(i => i.source === 'syllabus').length === 2);
    const day3 = list.filter(i => i.date === '2099-01-03').map(i => i.source);
    check('on the same day: an exam first, then Moodle, homework, the own task', JSON.stringify(day3) === JSON.stringify(['syllabus', 'moodle', 'homework', 'mine']) && list[0].id === 'mine-d' && list[list.length - 1].id === 'mine-c');
    check('the groups: overdue, tomorrow, this week, no date', list.find(i => i.id === 'mine-d').group === 'overdue' && list.find(i => i.id === 'moodle-7').group === 'tomorrow' && list.find(i => i.id === sylId).group === 'week' && list.find(i => i.id === 'mine-c').group === 'none');
    const copied = T.items(Object.assign({}, input, { tasks: input.tasks.concat([{ id: sylId, title: 'הגשת דוח מעבדה', course: 'פיזיקה', due: '2099-01-05', done: true }]) }));
    check('a syllabus date copied to the own tasks is not shown twice, and not again once done', !copied.some(i => i.id === sylId || i.id === 'mine-' + sylId));
    const sum = T.summary(list);
    check('the chip: the count, red for an overdue task, and the nearest dated item', sum.count === list.length && sum.level === 'bad' && sum.next.id === 'mine-d');
    check('the chip is orange when the nearest is within three days, and plain when nothing is', T.summary(T.items({ today: '2099-01-02', tasks: [{ id: 'x', title: 'y', due: '2099-01-04' }] })).level === 'warn' && T.summary(T.items({ today: '2099-01-02', tasks: [{ id: 'x', title: 'y', due: '2099-02-04' }] })).level === '');
    check('the host is told only about what is due in the next two days', JSON.stringify(T.reminders(list).map(r => r.id).sort()) === JSON.stringify(['homework-אלגוריתמים-2', 'mine-a', 'moodle-7', T.syllabusId('אלגוריתמים', '2099-01-03', 'בוחן אמצע')].sort()));

    // The reminder of the host, the day before (macOS).
    const remDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sumit-ticket-'));
    const saved = { p: app.ticketRemindedPath, r: app.ticketReminded, list: app.ticketReminders };
    app.ticketRemindedPath = path.join(remDir, 'task-reminders.json'); app.ticketReminded = undefined;
    const kept = app.TicketSetReminders([{ id: 'm1', title: 'תרגיל 3', course: 'אלגוריתמים', date: '2099-01-03' }, { id: 'm2', title: 'היום', date: '2099-01-02' }, { id: 'm3', title: 'בעוד יומיים', date: '2099-01-04' }, { id: '', title: 'x', date: '2099-01-03' }, { id: 'z', title: 'bad', date: 'מחר' }]);
    const told = []; const notify = (t, b) => told.push(t + '|' + b);
    check('the host keeps only items with an id, a title and a date', kept.length === 3);
    check('nothing is said before nine in the morning', app.TicketRemind(new Date(2099, 0, 2, 8, 30), notify).length === 0 && told.length === 0);
    app.TicketRemind(new Date(2099, 0, 2, 9, 5), notify);
    check('from nine, one notification for what is due tomorrow, and not for today or the day after', told.length === 1 && told[0].includes('תרגיל 3') && told[0].includes('אלגוריתמים'));
    app.TicketRemind(new Date(2099, 0, 2, 9, 6), notify); app.ticketReminded = undefined; app.TicketRemind(new Date(2099, 0, 2, 18, 0), notify);
    check('it is said once, also after the app starts again', told.length === 1 && fileExists(app.ticketRemindedPath));
    app.TicketSetReminders([{ id: 'm1', title: 'תרגיל 3', course: 'אלגוריתמים', date: '2099-01-04' }]);
    app.TicketRemind(new Date(2099, 0, 3, 10, 0), notify);
    check('a task whose date moved is reminded again', told.length === 2);
    const pingSent = []; const realSend2 = app.Send; app.Send = (m) => pingSent.push(m);
    await app.HandleUiMessage({ type: 'ticketPing' });
    app.Send = realSend2;
    check('the page is told the ticket reminders exist (macOS only)', pingSent.some(m => m.type === 'ticketReady'));
    app.ticketRemindedPath = saved.p; app.ticketReminded = saved.r; app.ticketReminders = saved.list;
    try { fs.rmSync(remDir, { recursive: true, force: true }); } catch { }
  }

  // "What to do today".
  const P = require('../../src/web/planner.js');
  const day = (h, m) => new Date(2026, 10, 10, h, m);   // Tuesday
  const tt = { classes: [{ day: 'שלישי', start: '10:00', end: '12:00', course: 'אלגברה' }], exams: [{ course: 'אלגברה', date: '2026-11-20', time: '09:00' }] };
  const slots = P.freeSlots(day(8, 0), { studyFrom: '08:00', studyTo: '14:00' }, tt);
  check('free time is the study window without the class, from five minutes from now', JSON.stringify(slots.map(s => [P.fmt(s.start), P.fmt(s.end), s.energy])) === '[["08:05","10:00","high"],["12:00","14:00","medium"]]');
  check('a free window is split where the part of the day changes', JSON.stringify(P.freeSlots(day(10, 0), { studyFrom: '11:00', studyTo: '13:00' }, null).map(s => [P.fmt(s.start), P.fmt(s.end), s.energy])) === '[["11:00","12:00","high"],["12:00","13:00","medium"]]');
  check('a block of the student (work) takes its hours too', P.freeSlots(day(8, 0), { studyFrom: '08:00', studyTo: '14:00', blocks: [{ day: 'שלישי', from: '12:00', to: '13:30', name: 'עבודה' }] }, tt).every(s => s.end <= 12 * 60 || s.start >= 13 * 60 + 30));
  check('after the study window there is no free time', P.freeSlots(day(23, 0), {}, tt).length === 0);
  const events = [
    { name: 'תרגיל 3', course: 'אלגברה', when: new Date(2026, 10, 10, 23, 59).getTime() / 1000, overdue: false },
    { name: 'דוח מעבדה', course: 'פיזיקה', when: new Date(2026, 10, 8, 23, 59).getTime() / 1000, overdue: true },
    { name: 'הגשה רחוקה', course: 'מבוא', when: new Date(2026, 10, 30, 23, 59).getTime() / 1000, overdue: false },
  ];
  const ctx = { now: day(8, 0), events, timetable: tt, review: { count: 20, overdueDays: 2 }, planner: { studyFrom: '08:00', studyTo: '20:00', energy: { morning: 'high', noon: 'low', evening: 'medium', night: 'low' } } };
  const cand = P.candidates(ctx);
  check('the overdue deadline comes first, then the one due today, a far one is left out', cand[0].title === 'דוח מעבדה' && cand[1].title === 'תרגיל 3' && !cand.some(i => i.title === 'הגשה רחוקה'));
  check('an exam in 10 days and a pile of reviews are candidates, the exam outweighs the reviews', cand.some(i => i.kind === 'exam' && i.title.includes('אלגברה')) && cand.find(i => i.kind === 'exam').score > cand.find(i => i.kind === 'review').score);
  const plan = P.planDay(ctx);
  const heavy = plan.items.filter(i => i.heavy), light = plan.items.filter(i => !i.heavy);
  check('the plan fits the free time and never fills more than 80% of it', plan.items.length >= 3 && plan.items.reduce((n, i) => n + i.minutes, 0) <= plan.freeMinutes * 0.8);
  check('heavy work is placed in high-energy hours, the light review in low ones', heavy.length > 0 && heavy[0].energy === 'high' && light.every(i => i.energy === 'low' || i.energy === 'medium'));
  check('nothing overlaps and everything is after now', plan.items.every((i, k) => i.start >= 8 * 60 + 5 && (k === 0 || i.start >= plan.items[k - 1].end)));
  const quick = P.planDay(ctx, { quick: 30 });
  check('"only 30 minutes" takes the most important things that fit, without times', quick.items.length >= 1 && quick.items.reduce((n, i) => n + i.minutes, 0) <= 30 && quick.items[0].start === null);
  const late = P.planDay(Object.assign({}, ctx, { now: day(23, 0) }));
  check('when the day is over the top items are listed without times, not hidden', late.noSlots === true && late.items.length > 0);
  check('nothing to do gives an empty plan', P.planDay({ now: day(9, 0), events: [], timetable: null, review: null, planner: {} }).items.length === 0);
  // What the host keeps of the student's hours: only valid fields, and defaults for the rest.
  const clean = app.CleanPlanner({ setup: true, studyFrom: '9:30', studyTo: '23:15', energy: { morning: 'low', noon: 'huge' }, blocks: [
    { day: 'שלישי', from: '13:00', to: '17:00', name: 'עבודה'.repeat(40) }, { day: 'שלישי', from: '17:00', to: '13:00', name: 'הפוך' }, { day: 'x', from: '01:00', to: '02:00' }, 'junk', { day: 'שני', from: '25:00', to: '26:00' }], extra: 'drop-me' });
  check('the host keeps valid hours and block, drops a reversed, unknown or broken block and extra fields',
    clean.setup === true && clean.studyFrom === '09:30' && clean.studyTo === '23:15' && clean.energy.morning === 'low' && clean.energy.noon === 'medium'
      && clean.blocks.length === 1 && clean.blocks[0].name.length < 70 && !('extra' in clean));
  check('a reversed study window goes back to the defaults, and nothing at all is valid too', app.CleanPlanner({ studyFrom: '20:00', studyTo: '08:00' }).studyFrom === '08:00' && app.CleanPlanner(null).studyTo === '22:00' && app.CleanPlanner([]).setup === false);
  check('broken settings fall back to the defaults', P.settings({ studyFrom: 'x', studyTo: '03:00', energy: { morning: 'huge' }, blocks: [{ day: 'x' }] }).from === 8 * 60);
}

async function runPomodoroTests(app, check) {
  const P = require('../../src/web/pomodoro.js');
  const cfg = P.config(null), T0 = Date.UTC(2026, 10, 10, 8, 0, 0), MIN = 60000;
  check('the classic timer is 25/5, a long break of 15 every 4 rounds', cfg.focus === 25 && cfg.short === 5 && cfg.long === 15 && cfg.rounds === 4 && cfg.auto && cfg.sound && cfg.notify);
  const custom = P.config({ preset: 'custom', focus: 500, short: 'x', long: 0, rounds: 99, auto: false });
  check('custom values are kept within limits, a bad value falls back to the classic one', custom.focus === 120 && custom.short === 5 && custom.long === 1 && custom.rounds === 8 && custom.auto === false && P.config({ preset: 'nope' }).focus === 25);
  check('the sound style and volume are kept within what exists, and a bad value falls back', cfg.soundKind === 'bell' && cfg.volume === 60 && P.config({ soundKind: 'soft', volume: 5 }).soundKind === 'soft' && P.config({ soundKind: 'soft', volume: 5 }).volume === 10 && P.config({ soundKind: 'x', volume: 'loud' }).soundKind === 'bell' && P.config({ volume: 900 }).volume === 100);
  check('a ready preset ignores stray numbers', P.config({ preset: 'deep', focus: 3 }).focus === 50);

  let s = P.start(P.initial(), cfg, T0, 'תרגיל 3');
  check('a round starts running and ends 25 minutes later, with its label', s.phase === 'focus' && s.running && s.endsAt === T0 + 25 * MIN && s.label === 'תרגיל 3' && s.round === 1);
  check('the time left and the progress follow the clock', P.remaining(s, cfg, T0 + 5 * MIN) === 20 * MIN && Math.abs(P.progress(s, cfg, T0 + 12.5 * MIN) - 0.5) < 1e-9 && P.fmt(20 * MIN) === '20:00' && P.fmt(1) === '00:01' && P.fmt(0) === '00:00');
  check('nothing happens before the end', P.tick(s, cfg, T0 + 25 * MIN - 1).event === null);
  let r = P.tick(s, cfg, T0 + 25 * MIN + 2000);
  check('at the end the break starts by itself and the page is told once', r.event && r.event.type === 'end' && r.event.phase === 'focus' && r.state.phase === 'short' && r.state.running && r.state.endsAt === T0 + 25 * MIN + 2000 + 5 * MIN);
  check('the break is followed by a round that waits for the student', (() => { const n = P.tick(r.state, cfg, r.state.endsAt).state; return n.phase === 'focus' && !n.running && n.round === 2 && n.remainingMs === 25 * MIN && n.label === 'תרגיל 3'; })());

  // The fourth round is followed by the long break, and after it the count starts again.
  let x = Object.assign(P.start(P.initial(), cfg, T0), { round: 4 });
  const fourth = P.tick(x, cfg, x.endsAt);
  check('after the fourth round comes the long break', fourth.state.phase === 'long' && fourth.state.endsAt - x.endsAt === 15 * MIN);
  check('after the long break the first round again', P.tick(fourth.state, cfg, fourth.state.endsAt).state.round === 1);

  // Pause and resume keep the time that was left.
  const paused = P.pause(s, T0 + 10 * MIN);
  check('a paused timer stops and keeps what is left', !paused.running && paused.remainingMs === 15 * MIN && paused.endsAt === null && P.remaining(paused, cfg, T0 + 99 * MIN) === 15 * MIN);
  const back = P.resume(paused, T0 + 40 * MIN);
  check('resuming counts from the new time', back.running && back.endsAt === T0 + 55 * MIN && P.pause(P.initial(), T0).phase === 'idle');

  check('skipping a round goes to its break, skipping a break to the next round', (() => { const k = P.skip(s, cfg, T0); const j = P.skip(k, cfg, T0); return k.phase === 'short' && k.running && j.phase === 'focus' && !j.running && j.round === 2; })());
  check('with the automatic break off, the break waits too', (() => { const n = P.tick(s, Object.assign({}, cfg, { auto: false }), s.endsAt).state; return n.phase === 'short' && !n.running && n.remainingMs === 5 * MIN; })());
  const late = P.tick(s, cfg, s.endsAt + 40 * MIN);
  check('a computer that slept past the end does not start a break that is already over', late.event.late === 40 * MIN && late.state.phase === 'short' && !late.state.running);
  check('reset goes back to nothing', P.reset().phase === 'idle');

  check('a state that was stored is read back safely', (() => {
    const ok = P.sanitize({ phase: 'focus', running: true, endsAt: T0 + MIN, round: 9, label: 'x'.repeat(500), extra: 1 }, cfg);
    return ok.running && ok.endsAt === T0 + MIN && ok.round === 4 && ok.label.length === 120 && !('extra' in ok)
      && P.sanitize('junk', cfg).phase === 'idle' && P.sanitize({ phase: 'boom' }, cfg).phase === 'idle'
      && P.sanitize({ phase: 'short', running: false, remainingMs: 9e9 }, cfg).remainingMs === 5 * MIN;
  })());

  // The alert of the system, from the host: on time, one at a time, cancelled, and only for a sensible time.
  const shown = [];
  app.PomodoroNotify = (title, body) => shown.push(title + '|' + body);
  const wait = (ms) => new Promise(res => setTimeout(res, ms));
  app.SchedulePomodoroAlert({ endsAt: Date.now() + 60, title: 'הריכוז הסתיים', body: 'זמן להפסקה' });
  await wait(250);
  check('the alert arrives when the phase ends', shown.length === 1 && shown[0] === 'הריכוז הסתיים|זמן להפסקה');
  app.SchedulePomodoroAlert({ endsAt: Date.now() + 80, title: 'ראשון', body: '' });
  app.SchedulePomodoroAlert({ endsAt: Date.now() + 80, title: 'שני', body: '' });
  await wait(250);
  check('a new alert replaces the one that was waiting', shown.length === 2 && shown[1].startsWith('שני'));
  app.SchedulePomodoroAlert({ endsAt: Date.now() + 80, title: 'מבוטל', body: '' });
  app.SchedulePomodoroAlert({ cancel: true });
  app.SchedulePomodoroAlert({ endsAt: Date.now() - 5000, title: 'עבר', body: '' });
  app.SchedulePomodoroAlert({ endsAt: Date.now() + 9 * 3600 * 1000, title: 'רחוק', body: '' });
  app.SchedulePomodoroAlert({ endsAt: 'soon', title: 'לא מספר', body: '' });
  await wait(250);
  check('a cancelled, past, too distant or broken alert never shows', shown.length === 2 && app.pomodoroTimer === null);
  delete app.PomodoroNotify;
}

async function runCalendarTests(app, root, check) {
  const ICal = require('../../src/web/ical.js');
  const ics = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.map(e => ['BEGIN:VEVENT', ...e, 'END:VEVENT'].join('\r\n')), 'END:VCALENDAR'].join('\r\n');
  const win = (a, b) => [Date.UTC(...a), Date.UTC(...b)];
  const iso = (o) => new Date(o.start).toISOString().replace('.000Z', 'Z');

  // Reading: folded lines, escapes, UTC, zones with summer time, a Windows zone name.
  let [from, to] = win([2026, 10, 1], [2026, 10, 30]);
  let occ = ICal.expand(ics(['UID:1', 'SUMMARY:שיעור\\, אלגברה', ' ' + ' לינארית', 'DTSTART:20261110T090000Z', 'DTEND:20261110T103000Z', 'LOCATION:חדר 5']), from, to);
  check('a folded title with an escaped comma is read as one line', occ.length === 1 && occ[0].title === 'שיעור, אלגברה לינארית');
  check('a UTC event keeps its time and length', occ[0].start === Date.UTC(2026, 10, 10, 9) && occ[0].end === Date.UTC(2026, 10, 10, 10, 30) && occ[0].location === 'חדר 5' && occ[0].busy);
  const zone = (z, d) => ICal.expand(ics(['UID:z', 'SUMMARY:x', 'DTSTART;TZID=' + z + ':' + d, 'DTEND;TZID=' + z + ':' + d.replace('10', '11')]), Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1))[0];
  check('10:00 in Jerusalem is 08:00 UTC in winter and 07:00 UTC in summer', zone('Asia/Jerusalem', '20261110T100000').start === Date.UTC(2026, 10, 10, 8) && zone('Asia/Jerusalem', '20260715T100000').start === Date.UTC(2026, 6, 15, 7));
  check('a Windows zone name is understood', zone('Israel Standard Time', '20261110T100000').start === Date.UTC(2026, 10, 10, 8));
  check('an unknown zone does not break the event (the computer\'s own time is used)', Number.isFinite(zone('Nowhere/Land', '20261110T100000').start));

  // Repeating: the wall-clock time stays the same through the change of summer time.
  const weekly = ICal.expand(ics(['UID:w', 'SUMMARY:תרגול', 'DTSTART;TZID=Asia/Jerusalem:20260906T100000', 'DTEND;TZID=Asia/Jerusalem:20260906T113000', 'RRULE:FREQ=WEEKLY;BYDAY=SU,WE']), Date.UTC(2026, 9, 15), Date.UTC(2026, 10, 10));
  check('a weekly lesson on two days keeps 10:00 local before and after summer time ends (Oct 25)',
    weekly.map(iso).join(',') === ['2026-10-18T07:00:00Z', '2026-10-21T07:00:00Z', '2026-10-25T08:00:00Z', '2026-10-28T08:00:00Z', '2026-11-01T08:00:00Z', '2026-11-04T08:00:00Z', '2026-11-08T08:00:00Z'].join(','));
  check('every occurrence keeps the length of the event', weekly.every(o => o.end - o.start === 90 * 60000));
  const every2 = ICal.expand(ics(['UID:e', 'SUMMARY:x', 'DTSTART:20261101T080000Z', 'DTEND:20261101T090000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU']), from, Date.UTC(2026, 11, 31));
  check('every second week is every second week', every2.map(iso).join(',') === '2026-11-01T08:00:00Z,2026-11-15T08:00:00Z,2026-11-29T08:00:00Z,2026-12-13T08:00:00Z,2026-12-27T08:00:00Z');
  const counted = ICal.expand(ics(['UID:c', 'SUMMARY:x', 'DTSTART:20261102T080000Z', 'DTEND:20261102T090000Z', 'RRULE:FREQ=DAILY;COUNT=3']), from, Date.UTC(2027, 0, 1));
  check('COUNT limits a series', counted.length === 3);
  const until = ICal.expand(ics(['UID:u', 'SUMMARY:x', 'DTSTART:20261102T080000Z', 'DTEND:20261102T090000Z', 'RRULE:FREQ=DAILY;UNTIL=20261104T080000Z']), from, Date.UTC(2027, 0, 1));
  check('UNTIL limits a series, and includes its last day', until.length === 3);
  const first = ICal.expand(ics(['UID:m', 'SUMMARY:x', 'DTSTART:20261102T080000Z', 'DTEND:20261102T090000Z', 'RRULE:FREQ=MONTHLY;BYDAY=1MO']), from, Date.UTC(2027, 1, 1));
  check('the first Monday of each month', first.map(iso).join(',') === '2026-11-02T08:00:00Z,2026-12-07T08:00:00Z,2027-01-04T08:00:00Z');
  const lastDay = ICal.expand(ics(['UID:l', 'SUMMARY:x', 'DTSTART:20261130T080000Z', 'DTEND:20261130T090000Z', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1']), from, Date.UTC(2027, 2, 1));
  check('the last day of each month, February included', lastDay.map(o => new Date(o.start).getUTCDate()).join(',') === '30,31,31,28');
  const lastFri = ICal.expand(ics(['UID:f', 'SUMMARY:x', 'DTSTART:20261127T080000Z', 'DTEND:20261127T090000Z', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR']), from, Date.UTC(2027, 0, 1));
  check('the last Friday of each month', lastFri.map(iso).join(',') === '2026-11-27T08:00:00Z,2026-12-25T08:00:00Z');
  const yearly = ICal.expand(ics(['UID:y', 'SUMMARY:x', 'DTSTART:20240229T080000Z', 'DTEND:20240229T090000Z', 'RRULE:FREQ=YEARLY']), Date.UTC(2024, 0, 1), Date.UTC(2029, 0, 1));
  check('a yearly event on Feb 29 comes back only in leap years', yearly.map(o => new Date(o.start).getUTCFullYear()).join(',') === '2024,2028');

  // One occurrence removed, one moved, one cancelled.
  const series = ['UID:s', 'SUMMARY:הרצאה', 'DTSTART:20261102T080000Z', 'DTEND:20261102T090000Z', 'RRULE:FREQ=WEEKLY'];
  const exd = ICal.expand(ics([...series, 'EXDATE:20261109T080000Z']), from, Date.UTC(2026, 10, 23));
  check('EXDATE removes one occurrence', exd.map(iso).join(',') === '2026-11-02T08:00:00Z,2026-11-16T08:00:00Z');
  const moved = ICal.expand(ics(series, ['UID:s', 'SUMMARY:הרצאה (הועברה)', 'RECURRENCE-ID:20261109T080000Z', 'DTSTART:20261110T140000Z', 'DTEND:20261110T150000Z']), from, Date.UTC(2026, 10, 23));
  check('a moved occurrence appears once, at its new time', moved.length === 3 && moved.some(o => o.start === Date.UTC(2026, 10, 10, 14) && o.title.includes('הועברה')) && !moved.some(o => o.start === Date.UTC(2026, 10, 9, 8)));
  const cancelledOne = ICal.expand(ics(series, ['UID:s', 'SUMMARY:x', 'RECURRENCE-ID:20261109T080000Z', 'DTSTART:20261109T080000Z', 'DTEND:20261109T090000Z', 'STATUS:CANCELLED']), from, Date.UTC(2026, 10, 23));
  check('a cancelled occurrence is gone, the rest stay', cancelledOne.length === 2);

  // Which events block time.
  const kinds = ICal.expand(ics(['UID:a', 'SUMMARY:יום הולדת', 'DTSTART;VALUE=DATE:20261110', 'DTEND;VALUE=DATE:20261111'], ['UID:b', 'SUMMARY:פנוי', 'DTSTART:20261110T080000Z', 'DTEND:20261110T090000Z', 'TRANSP:TRANSPARENT'], ['UID:c', 'SUMMARY:בוטל', 'DTSTART:20261110T080000Z', 'DTEND:20261110T090000Z', 'STATUS:CANCELLED'], ['UID:d', 'SUMMARY:פגישה', 'DTSTART:20261110T100000Z', 'DURATION:PT45M']), from, to);
  check('a whole day or a "free" event does not block, a cancelled one is not there, DURATION gives the end',
    kinds.length === 3 && kinds.find(o => o.title === 'יום הולדת').allDay && !kinds.find(o => o.title === 'יום הולדת').busy && !kinds.find(o => o.title === 'פנוי').busy
      && kinds.find(o => o.title === 'פגישה').busy && kinds.find(o => o.title === 'פגישה').end - kinds.find(o => o.title === 'פגישה').start === 45 * 60000);
  check('an event that began before the window and runs into it is included, one outside is not',
    ICal.expand(ics(['UID:o', 'SUMMARY:x', 'DTSTART:20261031T220000Z', 'DTEND:20261101T020000Z'], ['UID:p', 'SUMMARY:y', 'DTSTART:20261201T080000Z', 'DTEND:20261201T090000Z']), from, to).length === 1);
  const approx = ICal.expand(ics(['UID:b', 'SUMMARY:x', 'DTSTART:20261102T080000Z', 'DTEND:20261102T090000Z', 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1']), from, Date.UTC(2027, 0, 1));
  check('a rule that is not supported shows the first occurrence, marked approximate, and does not fail', approx.length === 1 && approx[0].approx === true);
  check('garbage is not an error', ICal.expand('not a calendar', from, to).length === 0 && ICal.expand('', from, to).length === 0 && ICal.expand(null, from, to).length === 0
    && ICal.expand('BEGIN:VEVENT\r\nSUMMARY:no start\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:junk\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20261110T0', from, to).length === 0);

  // A big calendar, and a series that began years ago, are read quickly.
  const many = [];
  for (let i = 0; i < 1000; i++) many.push(['UID:g' + i, 'SUMMARY:אירוע ' + i, 'DTSTART;TZID=Asia/Jerusalem:2015' + String(1 + i % 12).padStart(2, '0') + '10T090000', 'DTEND;TZID=Asia/Jerusalem:2015' + String(1 + i % 12).padStart(2, '0') + '10T100000', i % 2 ? 'RRULE:FREQ=WEEKLY;BYDAY=MO' : 'RRULE:FREQ=DAILY']);
  const t0 = Date.now();
  const bigOcc = ICal.expand(ics(...many), from, Date.UTC(2027, 0, 1));
  check('1,000 repeating events since 2015 are read for two months in under 3 seconds', Date.now() - t0 < 3000 && bigOcc.length > 20000);
  check('a daily series from 2015 gives the right days in the window', ICal.expand(ics(['UID:d', 'SUMMARY:x', 'DTSTART:20150101T080000Z', 'DTEND:20150101T090000Z', 'RRULE:FREQ=DAILY']), Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 4)).length === 3);

  // The week on the screen (the timetable grid): every occurrence is cut into the days it touches, and overlapping items stand side by side.
  const wk = new Date(2026, 10, 8).getTime(), lt = (d, hh, mi) => new Date(2026, 10, d, hh, mi || 0).getTime();
  const wp = ICal.dayParts([{ start: lt(9, 23), end: lt(10, 1, 30), title: 'לילה' }, { start: lt(11, 0), end: lt(13, 0), allDay: true, title: 'חופשה' },
    { start: lt(12, 9, 30), end: lt(12, 10, 30), title: 'אימון' }, { start: lt(15, 9), end: lt(15, 10), title: 'שבוע הבא' }, { start: lt(8, 7), end: lt(8, 7), title: 'רגע' }], wk, 7);
  const wpOf = (title) => wp.filter(x => x.occ.title === title).map(x => [x.day, x.from, x.to, x.allDay].join());
  check('an event that crosses midnight is drawn in both days, each part until midnight',
    wpOf('לילה').join('|') === '1,1380,1440,false|2,0,90,false');
  check('an event of two whole days is in both, an event of one hour in its day by the clock, and an event of another week is out',
    wpOf('חופשה').join('|') === '3,0,1440,true|4,0,1440,true' && wpOf('אימון').join('|') === '4,570,630,false' && wpOf('שבוע הבא').length === 0);
  check('an event with no length still shows in its day, and no events give no parts', wpOf('רגע').join('|') === '0,420,420,false' && ICal.dayParts(null, wk, 7).length === 0);
  const ln = ICal.lanes([{ id: 'a', from: 600, to: 720 }, { id: 'b', from: 600, to: 660 }, { id: 'c', from: 660, to: 700 }, { id: 'd', from: 900, to: 960 }, { id: 'e', from: 960, to: 1020 }, { id: 'f', from: 600, to: 605 }], 30);
  const lane = (id) => { const x = ln.find(y => y.id === id); return x.lane + '/' + x.lanes; };
  check('items that overlap stand side by side, and one that starts when another ended takes its lane',
    lane('a') === '0/3' && lane('b') === '1/3' && lane('f') === '2/3' && lane('c') === '1/3');
  check('items that do not overlap keep the full width, and back-to-back items do not count as overlapping', lane('d') === '0/1' && lane('e') === '0/1');
  check('a very short item counts as long as it is drawn, so the next one does not sit on it',
    ICal.lanes([{ from: 600, to: 605 }, { from: 610, to: 640 }], 30).map(x => x.lane + '/' + x.lanes).join() === '0/2,1/2' && ICal.lanes([], 30).length === 0);

  // The planner: an event of the calendar takes its hours out of today.
  const P = require('../../src/web/planner.js');
  const now = new Date(2026, 10, 10, 8, 0);
  const todayEv = (h1, m1, h2, m2, extra) => Object.assign({ start: new Date(2026, 10, 10, h1, m1).getTime(), end: new Date(2026, 10, 10, h2, m2).getTime(), busy: true, allDay: false }, extra);
  const slots = (cal) => P.freeSlots(now, { studyFrom: '08:00', studyTo: '14:00' }, null, cal).map(x => [P.fmt(x.start), P.fmt(x.end)]).join(' ');
  check('a meeting in the calendar takes its hours out of today', slots([todayEv(9, 0, 10, 30)]) === '08:05,09:00 10:30,12:00 12:00,14:00');
  check('a whole-day event, a free event and another day\'s event do not block', slots([todayEv(9, 0, 10, 0, { allDay: true, busy: false }), todayEv(9, 0, 10, 0, { busy: false }), { start: new Date(2026, 10, 11, 9).getTime(), end: new Date(2026, 10, 11, 10).getTime(), busy: true, allDay: false }]) === slots([]));
  check('an event that crosses midnight blocks only the part that is today', slots([{ start: new Date(2026, 10, 9, 22).getTime(), end: new Date(2026, 10, 10, 9, 0).getTime(), busy: true, allDay: false }]).startsWith('09:00,'));

  // The host: a calendar from a local server.
  const http = require('http');
  const secret = 'SECRET-' + guidN();
  let version = 1, mode = 'ok';
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/private-' + secret)) {
      if (mode === 'down') { res.writeHead(500); res.end('oops'); return; }
      res.writeHead(200, { 'Content-Type': 'text/calendar' });
      res.end(ics(['UID:h', 'SUMMARY:גרסה ' + version, 'DTSTART:20261110T090000Z', 'DTEND:20261110T100000Z']));
    } else if (req.url === '/notcal') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>login</html>'); }
    else if (req.url === '/gone') { res.writeHead(404); res.end(); }
    else if (req.url === '/big') { res.writeHead(200); res.write('BEGIN:VCALENDAR\n'); const chunk = 'X'.repeat(1024 * 1024); for (let i = 0; i < 6; i++) res.write(chunk); res.end(); }
    else if (req.url === '/bounce') { res.writeHead(302, { Location: 'http://localhost:' + server.address().port + '/private-' + secret }); res.end(); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  process.env.SUMIT_CALENDAR_TEST_HOST = '127.0.0.1';
  const savedDir = app.calendarsDir, savedCals = app.settings.calendars, realSend = app.Send;
  app.calendarsDir = path.join(root, 'calendars-test'); app.settings.calendars = [];
  const sent = []; app.Send = (m) => sent.push(m);
  const last = (type) => sent.filter(m => m.type === type).pop();
  const url = base + '/private-' + secret + '/basic.ics';
  try {
    delete process.env.SUMIT_CALENDAR_TEST_HOST;
    const bad = ['http://calendar.example.com/x.ics', 'https://localhost/x.ics', 'https://192.168.1.5/x.ics', 'https://10.1.2.3/x.ics', 'https://172.20.0.1/x.ics', 'https://169.254.169.254/x.ics', 'https://127.1/x.ics', 'https://[::1]/x.ics', 'https://user:pw@calendar.example.com/x.ics', 'https://printer.local/x.ics', 'https://intranet/x.ics', 'not a url', ''];
    check('only a real https address on the internet is accepted', bad.every(u => !app.CalendarUrlCheck(u).ok) && app.CalendarUrlCheck('https://calendar.google.com/calendar/ical/a%40b.com/private-abc/basic.ics').ok
      && app.CalendarUrlCheck('webcal://p01-caldav.icloud.com/published/2/x').url.startsWith('https://') && !app.CalendarUrlCheck(url).ok);
    process.env.SUMIT_CALENDAR_TEST_HOST = '127.0.0.1';
    check('a test server is allowed only when the test says so', app.CalendarUrlCheck(url).ok);

    await app.AddCalendar({ name: 'הלימודים', url });
    const added = last('calendars'), cal = app.settings.calendars[0];
    check('a calendar is added, fetched and sent to the page with its text', added && added.list.length === 1 && added.list[0].name === 'הלימודים' && added.list[0].ics.includes('גרסה 1') && last('calendarStatus').error === false);
    check('the secret address is kept encrypted and never sent to the page', cal.url !== url && !JSON.stringify(app.settings.calendars).includes(secret) && !JSON.stringify(sent).includes(secret) && Unprotect(cal.url) === app.CalendarUrlCheck(url).url && added.list[0].host === '127.0.0.1');
    check('the text of the calendar is kept in the data folder of the app', fileExists(path.join(app.calendarsDir, cal.id + '.ics')));
    await app.AddCalendar({ name: 'שוב', url });
    check('the same address is not added twice', app.settings.calendars.length === 1 && last('calendarStatus').error === true);

    version = 2; await app.RefreshCalendars(true);
    check('a refresh brings the new version', last('calendars').list[0].ics.includes('גרסה 2') && last('calendars').list[0].error === '' && last('calendarStatus').busy === false);
    mode = 'down'; await app.RefreshCalendars(false);
    check('when the server fails the last copy stays and the reason is shown', last('calendars').list[0].ics.includes('גרסה 2') && last('calendars').list[0].error.includes('500'));
    mode = 'ok'; await app.RefreshCalendars(false);
    check('the next refresh clears the error', last('calendars').list[0].error === '');

    const stale = Date.now(); app.lastCalendarRefresh = stale; app.RefreshCalendarsIfStale();
    check('a calendar is not refreshed again before half an hour', app.lastCalendarRefresh === stale);

    const tries = async (u) => { await app.AddCalendar({ name: 'x', url: u }); return last('calendarStatus'); };
    check('an address that is not a calendar is refused', (await tries(base + '/notcal')).error === true);
    const gone = await tries(base + '/gone');
    check('a cancelled address says so', gone.error === true && gone.text.includes('בוטלה'));
    check('a calendar over 5MB is refused', (await tries(base + '/big')).error === true);
    check('an address that redirects to a forbidden one is refused', (await tries(base + '/bounce')).error === true);
    check('none of the failed ones was kept', app.settings.calendars.length === 1);

    // A file.
    const good = path.join(root, 'לימודים.ics'), junk = path.join(root, 'junk.ics'), huge = path.join(root, 'huge.ics');
    writeText(good, ics(['UID:f', 'SUMMARY:מקובץ', 'DTSTART:20261110T090000Z', 'DTEND:20261110T100000Z']));
    writeText(junk, 'hello'); writeText(huge, 'BEGIN:VCALENDAR\n' + 'X'.repeat(6 * 1024 * 1024));
    await app.ImportCalendarPath(good);
    const imported = last('calendars').list.find(c => c.source === 'file');
    check('an .ics file is imported with its name, and refresh leaves it alone', imported && imported.name === 'לימודים' && imported.ics.includes('מקובץ') && imported.host === '');
    await app.ImportCalendarPath(junk); const j = last('calendarStatus');
    await app.ImportCalendarPath(huge);
    check('a file that is not a calendar, or is too big, is refused', j.error === true && last('calendarStatus').error === true && app.settings.calendars.length === 2);

    for (let i = 0; i < 6; i++) await app.ImportCalendarPath(good);
    check('at most five calendars', app.settings.calendars.length === 5 && last('calendarStatus').error === true);

    const gonePath = path.join(app.calendarsDir, cal.id + '.ics');
    app.RemoveCalendar({ id: 'not-an-id' }); app.RemoveCalendar({ id: cal.id });
    check('removing a calendar deletes its text and its secret', !fileExists(gonePath) && !app.settings.calendars.some(c => c.id === cal.id) && !JSON.stringify(app.settings).includes(secret));
  } finally {
    server.close(); delete process.env.SUMIT_CALENDAR_TEST_HOST;
    app.Send = realSend; app.calendarsDir = savedDir; app.settings.calendars = savedCals;
  }
}

// Study tools (study-export.js): the files that take the material to a calendar, to NotebookLM and to Anki.
async function runStudyExportTests(app, root, check) {
  const unfold = (t) => t.replace(/\r\n /g, '');
  const blocks = [{ id: 'b1', day: 2, start: '10:00', minutes: 60, course: 'אלגברה', goal: 'תרגול, חזרה; ושאלות\nשורה שנייה' }, { id: 'b2', day: 3, start: '23:30', minutes: 60, course: 'מבני נתונים', goal: 'ש'.repeat(300) }, { id: 'bad', day: 1, start: 'x', minutes: 60, course: 'ללא שעה', goal: '' }];
  const ics = app.ToolsIcs(blocks, '2026-11-01', new Date(Date.UTC(2026, 10, 1, 8, 0, 0)));
  const un = unfold(ics);
  check('the blocks become an iCal file with CRLF lines, one event per valid block, and a reminder', ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n') && !/[^\r]\n/.test(ics) && (un.match(/BEGIN:VEVENT/g) || []).length === 2 && (un.match(/BEGIN:VALARM/g) || []).length === 2 && un.includes('TRIGGER:-PT10M'));
  check('the times are the local times of the block, and a block that crosses midnight ends on the next day', un.includes('DTSTART:20261103T100000') && un.includes('DTEND:20261103T110000') && un.includes('DTSTART:20261104T233000') && un.includes('DTEND:20261105T003000') && un.includes('DTSTAMP:20261101T080000Z'));
  check('commas, semicolons and new lines in the text are escaped', un.includes('DESCRIPTION:תרגול\\, חזרה\\; ושאלות\\nשורה שנייה') && un.includes('SUMMARY:לימוד: אלגברה'));
  check('no line is longer than 75 bytes, a cut never splits a letter, and the long text comes back whole', ics.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75) && un.includes('ש'.repeat(300)) && !ics.includes('�'));
  const gu = app.ToolsGoogleUrl(blocks[0], '2026-11-01'), gq = new URLSearchParams(gu.split('?')[1] || '');
  check('a block becomes a Google Calendar link with the title, the goal and the local start and end', gu.startsWith('https://calendar.google.com/calendar/render?') && gq.get('action') === 'TEMPLATE' && gq.get('text') === 'לימוד: אלגברה' && gq.get('details').startsWith('תרגול, חזרה;') && gq.get('dates') === '20261103T100000/20261103T110000');
  check('a block without a valid time or a plan without a date gives no link', app.ToolsGoogleUrl(blocks[2], '2026-11-01') === '' && app.ToolsGoogleUrl(blocks[0], '') === '' && app.ToolsGoogleUrl(null, '2026-11-01') === '');

  const anki = app.ToolsAnki([{ front: 'מהו <b>בסיס</b>?', back: 'שורה 1\nשורה\t2 & עוד', course: 'אלגברה לינארית 2', num: 2 }, { front: '', back: 'x' }, { front: 'y', back: ' ' }, null, { front: 'ללא קורס', back: 'ת' }]);
  const rows = anki.trim().split('\n');
  check('the cards file tells Anki the separator, that the text is HTML, and which column has the tags', rows[0] === '#separator:tab' && rows[1] === '#html:true' && rows[2] === '#tags column:3');
  check('every card is one line of three fields, the tags have no spaces, and cards without a front or a back are skipped', rows.length === 5 && rows.slice(3).every(r => r.split('\t').length === 3) && rows[3].split('\t')[2] === 'SumIT אלגברה_לינארית_2 הרצאה_2' && rows[4].split('\t')[2] === 'SumIT');
  check('the text of a card is made safe: tags shown as text, new lines as breaks, tabs as spaces', rows[3].includes('&lt;b&gt;בסיס&lt;/b&gt;') && rows[3].includes('שורה 1<br>שורה 2 &amp; עוד'));
  const md = app.ToolsCardsMarkdown('קורס', [{ num: 2, title: 'מרחבים', cards: [{ front: 'מהו בסיס?', back: 'קבוצה' }] }]);
  const info = app.ToolsInfoMarkdown('קורס', { grading: [{ component: 'מבחן', weight: 80 }], examFormat: 'סגור', tips: ['לפתור'], importantDates: [{ date: '2026-12-01', what: 'בוחן' }] });
  check('the cards and the course information are written as markdown that NotebookLM reads', md.includes('## הרצאה 2: מרחבים') && md.includes('**שאלה:** מהו בסיס?') && md.includes('**תשובה:** קבוצה') && info.includes('- מבחן: 80%') && info.includes('## מבנה המבחן') && info.includes('- 2026-12-01: בוחן'));

  // The files, through the host: a course with a PDF summary, a digest only, and nothing; another course with cards.
  const saved = app.settings.studyRoot;
  app.settings.studyRoot = path.join(root, 'export-app', 'קורסים');
  const course = 'אלגברה לינארית 2 - תשפז', other = 'פיזיקה 1 - תשפז', empty = 'היסטוריה - תשפז';
  const page = (c, n) => { app.SaveLecture(c, { num: n, title: 'נושא ' + n }); const f = app.StudyPagePath(c, n); mkdirp(path.dirname(f)); writeText(f, '<html></html>'); return f; };
  const p1 = page(course, 1), p2 = page(course, 2); app.SaveLecture(course, { num: 3, title: 'ללא סיכום' });
  mkdirp(path.dirname(app.LecturePdfPath(course, 1))); fs.writeFileSync(app.LecturePdfPath(course, 1), '%PDF-1.4 test');
  mkdirp(path.join(app.CourseDir(course), '.sumit', 'digests')); writeText(path.join(app.CourseDir(course), '.sumit', 'digests', 'הרצאה 2.md'), '# תקציר\nבסיס וממד');
  writeText(app.FlashcardsFile(p2), JSON.stringify({ cards: [{ front: 'מהו בסיס?', back: 'ב' }, { front: 'מהו ממד?', back: 'מ' }] }));
  writeText(path.join(app.CourseDir(course), C.CourseJson), JSON.stringify({ grading: [{ component: 'מבחן', weight: 100 }], examFormat: 'סגור' }));
  const po = page(other, 1); writeText(app.FlashcardsFile(po), JSON.stringify({ cards: [{ front: 'מהו כוח?', back: 'מסה כפול תאוצה' }] }));
  page(empty, 1);

  const toasts = [], opened = [], realToast = app.Toast, realSave = app.savePath, realOpen = platform.openExternal, realReveal = platform.revealInFinder;
  app.Toast = (text, error) => toasts.push({ text, error: !!error });
  platform.openExternal = (u) => { opened.push(u); return Promise.resolve(); }; platform.revealInFinder = () => { };
  const last = () => toasts[toasts.length - 1];

  check('the folder of a course is found by a name that is part of it, and a course that is not there is not found', app.ToolsFolder('אלגברה לינארית 2') === course && app.ToolsFolder(course) === course && app.ToolsFolder('קורס שאין') === '' && app.ToolsFolder('') === '');
  await app.ExportToolHandle({ op: 'notebook', course: 'אלגברה לינארית 2' });
  const bundle = path.join(app.AppRoot, 'NotebookLM', course);
  const names = fs.existsSync(bundle) ? fs.readdirSync(bundle).sort() : [];
  check('the NotebookLM bundle has the PDF summary, the digest of a lecture with no PDF, the cards and the course information, and nothing for a lecture with no summary',
    names.includes('הרצאה 01 - סיכום.pdf') && names.includes('הרצאה 02 - תקציר.md') && names.includes('שאלות ותשובות - כרטיסי זיכרון.md') && names.includes('על הקורס.md') && names.length === 4 && !names.some(n => n.includes('03')));
  check('the bundle is opened for upload: NotebookLM is opened, and the student is told how many sources there are', opened.length === 1 && opened[0].includes('notebooklm.google.com') && last().text.includes('4 מקורות') && !last().error);
  check('the cards in the bundle are the cards of this course only', readText(path.join(bundle, 'שאלות ותשובות - כרטיסי זיכרון.md')).includes('מהו בסיס?') && !readText(path.join(bundle, 'שאלות ותשובות - כרטיסי זיכרון.md')).includes('כוח'));
  opened.length = 0;
  await app.ExportToolHandle({ op: 'notebook', course: 'היסטוריה' });
  check('a course with no summary gets a clear message, no folder and no page opened', last().error && last().text.includes('אין עדיין סיכומים') && !fs.existsSync(path.join(app.AppRoot, 'NotebookLM', empty)) && opened.length === 0);
  await app.ExportToolHandle({ op: 'notebook', course: 'קורס שאין' });
  await app.ExportToolHandle({ op: 'notebook', course: '' });
  check('an unknown course or no course is refused with a message', last().error && opened.length === 0);

  // iCloud Drive: the summary PDFs of a course as Lecture_NN_<topic>.pdf with a metadata.json, and a file the student wrote on is never overwritten.
  check('the iCloud file name has the lecture number with two digits and the topic with _ for spaces, and a missing or long title is handled',
    app.ToolsICloudName(3, 'מרחבים  וקטוריים') === 'Lecture_03_מרחבים_וקטוריים.pdf' && app.ToolsICloudName(12, '') === 'Lecture_12.pdf' && app.ToolsICloudName(1, 'a/b:c?.') === 'Lecture_01_a_b_c.pdf'
    && app.ToolsICloudName(2, 'ש'.repeat(90)).length === 'Lecture_02_'.length + 60 + 4);
  const plan = app.ToolsICloudPlan([{ num: 1, file: 'a.pdf', sha: 'x' }, { num: 2, file: 'b.pdf', sha: 'y' }, { num: 3, file: 'c.pdf', sha: 'z' }, { num: 4, file: 'd2.pdf', sha: 'w' }, { num: 5, file: 'e.pdf', sha: 'v' }],
    [{ num: 2, file: 'b.pdf', sha256: 'old' }, { num: 3, file: 'c.pdf', sha256: 'old' }, { num: 4, file: 'd.pdf', sha256: 'q' }],
    f => ({ 'a.pdf': 'x', 'b.pdf': 'old', 'c.pdf': 'edited', 'd.pdf': 'q', 'e.pdf': 'other' })[f] || null);
  check('the iCloud plan skips a file that is the same, overwrites what SumIT wrote, keeps a file that was edited, and removes the file of an old title',
    plan.map(p => p.action).join() === 'skip,overwrite,keepOld,write,keepOld' && plan[3].remove === 'd.pdf' && !plan[0].remove && !plan[2].remove);

  const icloud = path.join(root, 'icloud-drive'), savedEnv = process.env.SUMIT_ICLOUD_DIR, realSend = app.Send, sent = [];
  process.env.SUMIT_ICLOUD_DIR = icloud;
  app.Send = (m) => sent.push(m);
  const lastIc = () => sent.filter(m => m.type === 'icloudExport').pop() || {};
  try {
    await app.ExportToolHandle({ op: 'icloud', course: 'אלגברה לינארית 2' });
    check('with no iCloud Drive on the Mac, the export says so and writes nothing', lastIc().state === 'error' && lastIc().error.includes('iCloud Drive') && !fs.existsSync(icloud));
    mkdirp(icloud);
    const m0 = app.LoadMeta(course); m0.courseId = 4242; app.SaveMeta(course, m0);
    sent.length = 0;
    await app.ExportToolHandle({ op: 'icloud', course: 'אלגברה לינארית 2' });
    const dir = path.join(icloud, 'SumIT', course), f1 = path.join(dir, 'Lecture_01_נושא_1.pdf');
    const ls = () => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
    const md1 = fs.existsSync(path.join(dir, 'metadata.json')) ? JSON.parse(readText(path.join(dir, 'metadata.json'))) : {};
    const sha = (t) => require('crypto').createHash('sha256').update(t).digest('hex');
    check('the export writes the PDF of a lecture that has one, the Markdown summary of a lecture that has only that, the cards and metadata.json, and no temporary files',
      ls().join('|') === 'Lecture_01_נושא_1.pdf|Lecture_02_נושא_2.md|cards.json|metadata.json' && readText(f1) === '%PDF-1.4 test' && readText(path.join(dir, 'Lecture_02_נושא_2.md')).includes('בסיס וממד'));
    check('metadata.json has schema 1, the Moodle course id, the course, and per lecture its files with their sha256 and the number of cards',
      md1.schema === 1 && md1.moodleCourseId === 4242 && md1.course === course && md1.app === 'SumIT' && md1.cardsFile === 'cards.json' && md1.lectures.length === 2
      && md1.lectures[0].num === 1 && md1.lectures[0].file === 'Lecture_01_נושא_1.pdf' && md1.lectures[0].sha256 === sha('%PDF-1.4 test') && md1.lectures[0].summaryFile === null && md1.lectures[0].cards === 0
      && md1.lectures[1].num === 2 && md1.lectures[1].file === null && md1.lectures[1].summaryFile === 'Lecture_02_נושא_2.md' && md1.lectures[1].summarySha256 === sha('# תקציר\nבסיס וממד') && md1.lectures[1].cards === 2 && 'date' in md1.lectures[1]);
    const cj = JSON.parse(readText(path.join(dir, 'cards.json')));
    check('cards.json has the cards of this course only, each with its lecture and a key made from its question',
      cj.schema === 1 && cj.cards.length === 2 && cj.cards.every(c => c.num === 2 && /^2-[0-9a-f]{12}$/.test(c.key)) && cj.cards[0].front === 'מהו בסיס?' && cj.cards[0].back === 'ב' && cj.cards[0].key !== cj.cards[1].key && !readText(path.join(dir, 'cards.json')).includes('כוח'));
    const ix = JSON.parse(readText(path.join(icloud, 'SumIT', 'index.json')));
    check('SumIT/index.json lists the course with its folder, Moodle id and counts', ix.schema === 1 && ix.courses.length === 1 && ix.courses[0].folder === course && ix.courses[0].moodleCourseId === 4242 && ix.courses[0].lectures === 2 && ix.courses[0].cards === 2);
    const states = sent.filter(m => m.type === 'icloudExport').map(m => m.state);
    check('the page hears busy and then done, with how many were added', states[0] === 'busy' && states[states.length - 1] === 'done' && lastIc().added === 2 && lastIc().course === 'אלגברה לינארית 2');

    const t1 = fs.statSync(f1).mtimeMs;
    await new Promise(r => setTimeout(r, 20));
    await app.ExportToolHandle({ op: 'icloud', course: 'אלגברה לינארית 2' });
    check('a second export with nothing new writes nothing again', fs.statSync(f1).mtimeMs === t1 && lastIc().unchanged === 2 && lastIc().added === 0 && JSON.parse(readText(path.join(dir, 'cards.json'))).cards[0].key === cj.cards[0].key && lastIc().text.includes('כבר מעודכנות'));

    fs.writeFileSync(app.LecturePdfPath(course, 1), '%PDF-1.4 new summary');
    await app.ExportToolHandle({ op: 'icloud', course: 'אלגברה לינארית 2' });
    check('a summary that changed replaces the file SumIT wrote before', readText(f1) === '%PDF-1.4 new summary' && ls().length === 4 && lastIc().updated === 1 && lastIc().unchanged === 1);

    fs.writeFileSync(f1, '%PDF-1.4 with my notes from the iPad');
    fs.writeFileSync(app.LecturePdfPath(course, 1), '%PDF-1.4 third summary');
    await app.ExportToolHandle({ op: 'icloud', course: 'אלגברה לינארית 2' });
    const keptFile = ls().find(n => /^Lecture_01_נושא_1_\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/.test(n));
    check('a file the student wrote on is kept under a dated name, and the new summary is written', !!keptFile && readText(path.join(dir, keptFile)) === '%PDF-1.4 with my notes from the iPad' && readText(f1) === '%PDF-1.4 third summary' && lastIc().kept === 1);

    fs.rmSync(path.join(dir, keptFile));
    app.SaveLecture(course, { num: 1, title: 'בסיס וממד' });
    await app.ExportToolHandle({ op: 'icloud', course: 'אלגברה לינארית 2' });
    check('when the title changes, the file under the old title is removed and the new name is written', ls().join('|') === 'Lecture_01_בסיס_וממד.pdf|Lecture_02_נושא_2.md|cards.json|metadata.json');

    await app.ExportToolHandle({ op: 'icloud', course: 'פיזיקה 1' });
    const ix2 = JSON.parse(readText(path.join(icloud, 'SumIT', 'index.json')));
    check('a course with no summary is refused and index.json stays as it was', lastIc().state === 'error' && ix2.courses.length === 1);
    mkdirp(path.dirname(app.LecturePdfPath(other, 1))); fs.writeFileSync(app.LecturePdfPath(other, 1), '%PDF-1.4 physics');
    await app.ExportToolHandle({ op: 'icloud', course: 'פיזיקה 1' });
    const ix3 = JSON.parse(readText(path.join(icloud, 'SumIT', 'index.json')));
    fs.rmSync(path.join(icloud, 'SumIT', other), { recursive: true, force: true });
    await app.ExportToolHandle({ op: 'icloud', course: 'אלגברה לינארית 2' });
    const ix4 = JSON.parse(readText(path.join(icloud, 'SumIT', 'index.json')));
    check('index.json keeps every exported course, and drops a course whose folder was deleted', ix3.courses.length === 2 && ix3.courses.some(c => c.course === other && c.cards === 1 && c.moodleCourseId === null) && ix4.courses.length === 1 && ix4.courses[0].course === course);

    const before = sent.length;
    await app.ExportToolHandle({ op: 'icloud', course: 'היסטוריה' });
    await app.ExportToolHandle({ op: 'icloud', course: 'קורס שאין' });
    const errs = sent.slice(before).filter(m => m.type === 'icloudExport');
    check('a course with no PDF summary or no folder gets an error and no folder in iCloud', errs.length === 2 && errs.every(m => m.state === 'error') && errs[0].error.includes('אין עדיין סיכומים') && !fs.existsSync(path.join(icloud, 'SumIT', empty)));
  } finally {
    app.Send = realSend;
    if (savedEnv === undefined) delete process.env.SUMIT_ICLOUD_DIR; else process.env.SUMIT_ICLOUD_DIR = savedEnv;
  }

  const out = path.join(root, 'export-out.txt');
  app.savePath = async () => out;
  await app.ExportToolHandle({ op: 'anki', course: 'פיזיקה 1' });
  check('the cards of one course are exported', readText(out).includes('מהו כוח?') && !readText(out).includes('בסיס') && last().text.includes('1 כרטיסים'));
  await app.ExportToolHandle({ op: 'anki', course: '' });
  check('with no course, the cards of all courses are exported', readText(out).includes('מהו כוח?') && readText(out).includes('מהו בסיס?') && last().text.includes('3 כרטיסים'));
  fs.rmSync(out, { force: true });
  await app.ExportToolHandle({ op: 'anki', course: 'היסטוריה' });
  check('a course with no cards gets a message and no file', last().error && !fs.existsSync(out));
  app.savePath = async () => null;
  await app.ExportToolHandle({ op: 'anki', course: '' });
  check('a cancelled save dialog writes nothing and says nothing', !fs.existsSync(out));

  // The blocks of the week to a calendar file: only what is not done, and only when there is a plan.
  const ical = path.join(root, 'export-out.ics');
  app.savePath = async () => ical;
  await app.ExportToolHandle({ op: 'ics' });
  check('with no plan there is nothing to export, and a message says so', last().error && !fs.existsSync(ical));
  const prof = app.TrackLoad(); prof.courses = [{ name: 'אלגברה', level: 2, hoursPerWeek: 0, examDate: '', notes: '', manual: false }];
  prof.plan = { weekStart: '2026-11-01', blocks: [{ id: 'b1', day: 1, start: '10:00', minutes: 60, course: 'אלגברה', goal: 'תרגול', done: false, doneMinutes: 0 }, { id: 'b2', day: 2, start: '10:00', minutes: 60, course: 'אלגברה', goal: 'סיכום', done: true, doneMinutes: 60 }] };
  app.TrackSave(prof);
  await app.ExportToolHandle({ op: 'ics' });
  const file = readText(ical);
  check('the calendar file has the blocks that are not done yet', (file.match(/BEGIN:VEVENT/g) || []).length === 1 && file.includes('DTSTART:20261102T100000') && last().text.includes('1 בלוקים'));

  app.Toast = realToast; app.savePath = realSave; platform.openExternal = realOpen; platform.revealInFinder = realReveal;
  app.settings.studyRoot = saved;
}

// Study track (study-track.js): the profile on disk, a strategy per course, a week of blocks around the timetable, and the progress.
async function runOfflineCoursesTests(app, root, check) {
  const saved = { studyRoot: app.settings.studyRoot, send: app.Send, ensure: app.EnsureMoodle, withMoodle: app.WithMoodle, last: app.lastCourses, fresh: app.coursesFresh, toFront: app.bringToFront };
  app.settings.studyRoot = path.join(root, 'offline-courses');
  const cacheFile = app.MoodleCacheFile; // follows the study folder
  try { fs.unlinkSync(cacheFile); } catch { }
  app.lastCourses = null; app.coursesFresh = false;
  const sent = [], interactive = [];
  app.Send = (m) => sent.push(m); app.bringToFront = () => { };
  app.EnsureMoodle = async (inter) => { interactive.push(inter); throw new Error('Moodle is down'); };
  const real = saved.withMoodle;
  const messages = () => { const o = sent.slice(); sent.length = 0; return o; };

  check('with nothing saved and no folders there are no offline courses', app.OfflineCourses().length === 0);
  app.SaveMeta('קורס אופליין', { courseId: 4321 }); app.SaveMeta('בלי מזהה', { x: 1 });
  check('the course folders that remember their Moodle id are the offline courses', app.OfflineCourses().length === 1 && app.OfflineCourses()[0].id === 4321 && app.OfflineCourses()[0].name === 'קורס אופליין');

  app.WriteMoodleCache('courses', [{ id: 7, name: 'קורס שמור', short: 'ק', category: '', current: true }, { id: 8, noName: true }, 'x']);
  check('the saved list wins over the folders, and rows without a name are dropped', app.OfflineCourses().length === 1 && app.OfflineCourses()[0].name === 'קורס שמור' && !fs.existsSync(cacheFile + '.tmp'));
  fs.writeFileSync(cacheFile, '{not json'); 
  check('a broken cache file is ignored and the folders are used', app.OfflineCourses().length === 1 && app.OfflineCourses()[0].name === 'קורס אופליין');
  app.WriteMoodleCache('courses', [{ id: 7, name: 'קורס שמור' }]);

  await app.LoadCourses(true);
  let out = messages();
  check('cachedOnly shows the saved courses and never asks Moodle', out.length === 1 && out[0].type === 'courses' && out[0].cached === true && out[0].data[0].name === 'קורס שמור' && interactive.length === 0);
  app.lastCourses = null;
  await app.LoadCourses(false);
  out = messages();
  check('when Moodle is down the saved courses stay, with no error and no sign-in window', out.length === 1 && out[0].cached === true && !out.some(m => m.type === 'moodle' && m.state === 'error') && interactive.length === 1 && interactive[0] === false);

  fs.unlinkSync(cacheFile); fs.rmSync(app.CourseDir('קורס אופליין'), { recursive: true, force: true });
  interactive.length = 0; app.lastCourses = null;
  await app.LoadCourses(false);
  out = messages();
  check('with nothing saved a failure is still shown to the student, and Moodle may ask to sign in', out.some(m => m.type === 'moodle' && m.state === 'error') && interactive[0] === true);

  app.WriteMoodleCache('home', { name: 'סטודנט', events: [{ name: 'מבחן' }] });
  interactive.length = 0; app.coursesFresh = false; app.lastCourses = [{ id: 1, name: 'x' }];
  await app.LoadHome();
  out = messages();
  const home = out.find(m => m.type === 'home');
  check('the home page falls back to the last known week when Moodle is down', home && home.events.length === 1 && home.name === 'סטודנט' && !out.some(m => m.type === 'moodle' && m.state === 'error') && interactive[0] === false);

  app.SaveMeta('קורס מקומי', { courseId: 55 });
  interactive.length = 0;
  await app.OpenCourse(55, 'קורס מקומי');
  out = messages();
  check('a course already on this Mac opens without Moodle, with no error', out.some(m => m.type === 'course' && m.cached) && !out.some(m => m.type === 'courseError') && interactive[0] === false);
  await app.OpenCourse(66, 'קורס שאין לו תיקייה');
  out = messages();
  check('a course that is not on this Mac still reports the failure', out.some(m => m.type === 'courseError'));

  fs.rmSync(app.CourseDir('קורס מקומי'), { recursive: true, force: true });
  try { fs.unlinkSync(cacheFile); } catch { }
  app.settings.studyRoot = saved.studyRoot; app.Send = saved.send; app.EnsureMoodle = saved.ensure; app.lastCourses = saved.last; app.coursesFresh = saved.fresh; app.bringToFront = saved.toFront;
}

async function runStudyTrackTests(app, root, check) {
  const sumMin = (blocks) => blocks.reduce((n, b) => n + b.minutes, 0);
  const mins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

  // A profile from any source (file, page, import) comes out clean.
  const bad = app.TrackClean({ name: 'ש'.repeat(200), courses: [{ name: '  א   ב  ', level: 9, hoursPerWeek: 99, examDate: 'לא תאריך' }, { name: 'א ב' }, { name: '' }, 'x', null].concat(Array.from({ length: 100 }, (_, i) => ({ name: 'קורס' + i }))),
    strategies: { 'א ב': { summary: 's', steps: [{ title: '1' }, { title: '2' }, { title: '3' }] }, 'קורס שאין': { summary: 's', steps: [{ title: '1' }, { title: '2' }, { title: '3' }] } },
    plan: { weekStart: '2026-11-01', blocks: [{ id: 'b1', day: 9, start: '10:00', minutes: 60, course: 'א ב' }, { id: 'b2', day: 1, start: '25:99', minutes: 60, course: 'א ב' }, { id: 'b3', day: 1, start: '10:00', minutes: 9999, course: 'א ב', done: true }] },
    log: [{ date: 'x', minutes: 5 }, { date: '2026-11-02', course: 'א ב', minutes: 5000 }] });
  check('a profile is cleaned: short name, at most 40 courses, no duplicates, level and hours in range, a bad date dropped', bad.name.length <= 63 && bad.courses.length === 40 && bad.courses[0].name === 'א ב' && bad.courses.filter(c => c.name === 'א ב').length === 1 && bad.courses[0].level === 3 && bad.courses[0].hoursPerWeek === 30 && bad.courses[0].examDate === '');
  check('only a strategy of a known course is kept, and blocks with a bad day or time are dropped', Object.keys(bad.strategies).join() === 'א ב' && bad.plan.blocks.length === 1 && bad.plan.blocks[0].id === 'b3' && bad.plan.blocks[0].minutes === 240 && bad.plan.blocks[0].doneMinutes <= 600);
  check('a log entry needs a real date, and its minutes are limited', bad.log.length === 1 && bad.log[0].minutes === 600);
  check('anything that is not a profile gives an empty one', app.TrackClean(null).courses.length === 0 && app.TrackClean('x').log.length === 0 && app.TrackClean([1]).version === 1);
  check('the week starts on Sunday', app.TrackWeekStart('2026-11-05') === '2026-11-01' && app.TrackWeekStart('2026-11-01') === '2026-11-01' && app.TrackWeekStart('2026-11-07') === '2026-11-01' && app.TrackWeekStart('2026-11-08') === '2026-11-08');

  // The week: time by difficulty and exam, around the classes, with no overlap.
  const profile = app.TrackClean({ courses: [{ name: 'מבני נתונים', level: 3, examDate: '2026-11-12' }, { name: 'אלגברה', level: 2 }, { name: 'היסטוריה', level: 1, hoursPerWeek: 2 }] });
  const classes = [{ day: 'ראשון', start: '10:00', end: '12:00', course: 'אלגברה' }, { day: 'שני', start: '08:00', end: '21:00', course: 'מעבדה' }];
  const week = app.TrackBuildWeek(profile, classes, { weekStart: '2026-11-01', today: '2026-10-30', hours: 10, days: [0, 1, 2, 3, 4], from: '09:00', to: '20:00' });
  check('every course gets its time: what was set exactly, the rest by difficulty and a close exam, and all of it fits', week.unplaced === 0 && week.perCourse['היסטוריה'] === 120 && week.perCourse['מבני נתונים'] === 360 && week.perCourse['אלגברה'] === 120 && sumMin(week.blocks) === 600);
  const byDay = (d) => week.blocks.filter(b => b.day === d).sort((a, b) => mins(a.start) - mins(b.start));
  check('no block on a day that is full of classes, and none inside a class or a quarter of an hour around it', byDay(1).length === 0 && byDay(0).every(b => mins(b.start) + b.minutes <= 585 || mins(b.start) >= 735));
  check('blocks stay inside the hours, are at least half an hour, and leave a gap between them', week.blocks.every(b => mins(b.start) >= 540 && mins(b.start) + b.minutes <= 1200 && b.minutes >= 30)
    && [0, 1, 2, 3, 4].every(d => byDay(d).every((b, i, a) => i === 0 || mins(a[i - 1].start) + a[i - 1].minutes + 10 <= mins(b.start))));
  check('block ids are unique, and a course with an exam in a month gets a past-exam block', new Set(week.blocks.map(b => b.id)).size === week.blocks.length && week.blocks.some(b => b.course === 'מבני נתונים' && b.goal.includes('מבחן קודם')) && !week.blocks.some(b => b.course === 'אלגברה' && b.goal.includes('מבחן קודם')));
  check('a course is not studied twice on the same day when there is room', [...new Set(week.blocks.map(b => b.course))].every(c => new Set(week.blocks.filter(b => b.course === c).map(b => b.day)).size === week.blocks.filter(b => b.course === c).length || week.blocks.filter(b => b.course === c).length > 4));

  const mid = app.TrackBuildWeek(profile, classes, { weekStart: '2026-11-01', today: '2026-11-03', nowMin: 900, hours: 10, days: [0, 1, 2, 3, 4] });
  check('days that have passed get no blocks, and today starts after now', mid.blocks.every(b => b.day >= 2) && mid.blocks.filter(b => b.day === 2).every(b => mins(b.start) >= 915));
  const tight = app.TrackBuildWeek(profile, [], { weekStart: '2026-11-01', today: '2026-10-30', hours: 10, days: [0], from: '09:00', to: '10:00' });
  check('what does not fit is counted, not squeezed in', tight.unplaced > 0 && sumMin(tight.blocks) <= 60 && sumMin(tight.blocks) + tight.unplaced === 600);
  check('no courses, no days, or no hours give an empty week', app.TrackBuildWeek(app.TrackNew(), [], { weekStart: '2026-11-01' }).blocks.length === 0 && app.TrackBuildWeek(profile, [], { weekStart: '2026-11-01', days: [] }).blocks.length === 0 && app.TrackBuildWeek(profile, [], { weekStart: '2026-11-01', from: '09:00', to: '09:10' }).blocks.length === 0);

  const kept = JSON.parse(JSON.stringify(profile));
  kept.plan = { weekStart: '2026-11-01', blocks: week.blocks.map((b, i) => (i === 0 ? Object.assign({}, b, { done: true, doneMinutes: b.minutes }) : b)) };
  const again = app.TrackBuildWeek(kept, classes, { weekStart: '2026-11-01', today: '2026-10-30', hours: 10, days: [0, 1, 2, 3, 4] });
  const first = kept.plan.blocks[0];
  check('a block that was done stays when the week is built again, with its id, and nothing is placed over it', again.blocks.filter(b => b.id === first.id).length === 1 && again.blocks.find(b => b.id === first.id).done
    && new Set(again.blocks.map(b => b.id)).size === again.blocks.length && again.blocks.filter(b => b.id !== first.id && b.day === first.day).every(b => mins(b.start) >= mins(first.start) + first.minutes + 10 || mins(b.start) + b.minutes <= mins(first.start)));

  // Progress: minutes of the week, the streak, topics.
  const logged = app.TrackClean({ courses: [{ name: 'א' }, { name: 'ב' }], progress: { א: { topics: [{ id: 'x', title: 'עצים', done: true }, { id: 'y', title: 'גרפים' }] } },
    log: [{ date: '2026-11-05', course: 'א', minutes: 30, block: 'b1' }, { date: '2026-11-04', course: 'א', minutes: 45, block: 'b2' }, { date: '2026-11-03', course: 'ב', minutes: 20, block: 'b3' }, { date: '2026-10-30', course: 'ב', minutes: 60, block: 'b4' }] });
  const st = app.TrackStats(logged, '2026-11-05');
  check('progress: minutes of this week, the total, a streak that skips the older day, and the topics', st.weekMinutes === 95 && st.totalMinutes === 155 && st.streak === 3 && st.perCourse['א'].week === 75 && st.perCourse['ב'].total === 80 && st.perCourse['א'].topicsDone === 1 && st.perCourse['א'].topics === 2);
  check('a streak survives a day that has not been logged yet, and ends after two', app.TrackStats(logged, '2026-11-06').streak === 3 && app.TrackStats(logged, '2026-11-07').streak === 0);

  // The streak, as in Duolingo: only days something was finished in, freezes earned every 7 days, the week, milestones and the reminder.
  const dayN = (n) => { const d = new Date(2026, 10, 1 + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const handOnly = app.TrackClean({ courses: [{ name: 'א' }], log: [{ date: '2026-11-05', course: 'א', minutes: 90 }, { date: '2026-11-04', course: 'א', minutes: 60 }] });
  check('time logged by hand alone does not light the streak', app.TrackStreak(handOnly, '2026-11-05').current === 0 && app.TrackStats(handOnly, '2026-11-05').weekMinutes === 150);
  const topicDay = app.TrackClean({ courses: [{ name: 'א' }], progress: { א: { topics: [{ id: 'x', title: 'עצים', done: true, doneDate: '2026-11-05' }, { id: 'y', title: 'גרפים', done: false, doneDate: '2026-11-04' }] } } });
  const tds = app.TrackStreak(topicDay, '2026-11-05');
  check('a topic finished today counts, a topic that is not done does not', tds.current === 1 && tds.todayDone && !tds.atRisk && topicDay.progress['א'].topics[1].doneDate === '');
  const run = (days) => app.TrackClean({ courses: [{ name: 'א' }], log: days.map((n, i) => ({ date: dayN(n), course: 'א', minutes: 30, block: 'k' + i })) });
  const week7 = app.TrackStreak(run([0, 1, 2, 3, 4, 5, 6]), dayN(6));
  check('seven days in a row: a milestone today and a freeze earned', week7.current === 7 && week7.best === 7 && week7.milestone === 7 && week7.freezes === 1 && week7.next === 14 && week7.prev === 7);
  const saved1 = app.TrackStreak(run([0, 1, 2, 3, 4, 5, 6, 8]), dayN(8));
  check('a freeze covers one missed day by itself, and the streak goes on', saved1.current === 8 && saved1.freezes === 0 && saved1.week.find(d => d.date === dayN(7)).state === 'frozen');
  check('without a freeze, a missed day ends the streak; the best stays', app.TrackStreak(run([0, 1, 2, 3, 4, 5, 6, 8, 9]), dayN(11)).current === 0 && app.TrackStreak(run([0, 1, 2, 3, 4, 5, 6, 8, 9]), dayN(11)).best === 9
    && app.TrackStreak(run([0, 1, 2, 4]), dayN(4)).current === 1);
  const risk = app.TrackStreak(run([0, 1, 2]), dayN(3));
  check('a streak that waits for today is "at risk", and the week shows each day',
    risk.current === 3 && risk.atRisk && !risk.todayDone && risk.week.length === 7 && risk.week[0].date === '2026-11-01' && risk.week.map(d => d.state).join(',') === 'done,done,done,today,future,future,future');
  const remFile = path.join(root, 'streak-profile.json'); writeText(remFile, JSON.stringify(run([0, 1, 2])));
  Object.defineProperty(app, 'TrackFile', { value: remFile, configurable: true });
  const said = [], note = (t, b) => said.push(t + ' ' + b);
  delete app.streakReminded;
  const early = app.TrackStreakReminder(new Date(2026, 10, 4, 18, 0), note), late = app.TrackStreakReminder(new Date(2026, 10, 4, 20, 30), note), again2 = app.TrackStreakReminder(new Date(2026, 10, 4, 21, 0), note);
  check('in the evening a streak at risk gets one reminder a day, not before 20:00 and not twice', early === '' && /3 ימים/.test(late) && again2 === '' && said.length === 1 && /בסכנה/.test(said[0]));
  writeText(remFile, JSON.stringify(run([0, 1, 2, 3]))); delete app.streakReminded;
  check('no reminder when today already counts', app.TrackStreakReminder(new Date(2026, 10, 4, 20, 30), note) === '' && said.length === 1);
  delete app.TrackFile; delete app.streakReminded;

  // The strategy: by the kind of course, from the exam, and cleaned when it comes from an AI.
  check('courses are told apart by name', app.TrackKind('חדו"א 1') === 'math' && app.TrackKind('מבני נתונים') === 'theory' && app.TrackKind('תכנות בשפת C') === 'code' && app.TrackKind('פסיכולוגיה') === 'general');
  const codeS = app.TrackFallback({ course: 'תכנות בשפת C', level: 2 }), mathS = app.TrackFallback({ course: 'אלגברה לינארית', level: 2 });
  check('a strategy by rules is different for code and for math, and passes the same cleaning as an AI answer', codeS.summary !== mathS.summary && JSON.stringify(codeS.steps) !== JSON.stringify(mathS.steps) && [codeS, mathS, app.TrackFallback({ course: 'x', level: 3, examDays: 5 })].every(s => app.TrackCleanStrategy(s) && s.steps.length >= 3));
  const near = app.TrackFallback({ course: 'אלגברה', level: 2, examDays: 5 }), far = app.TrackFallback({ course: 'אלגברה', level: 2, examDays: 60 });
  check('a close exam puts the exam first, a far one does not', near.steps[0].title.includes('5 ימים') && !far.steps.some(s => s.title.includes('המבחן בעוד')));
  check('an AI strategy needs a summary and at least three steps, and is cut down', app.TrackCleanStrategy({ summary: 'ס', steps: [{ title: 'א' }] }) === null && app.TrackCleanStrategy({ steps: [{ title: 'א' }, { title: 'ב' }, { title: 'ג' }] }) === null && app.TrackCleanStrategy('x') === null
    && app.TrackCleanStrategy({ summary: 'ס', steps: Array.from({ length: 9 }, (_, i) => ({ title: 'צעד ' + i, detail: 'ד'.repeat(500) })), routine: Array.from({ length: 9 }, () => 'ר'), avoid: 'לא מערך' }).steps.length === 6);

  const wk = app.TrackFallback({ course: 'אלגברה', level: 2, cardsDue: 7, pastExams: 2, examDays: 10, lectureList: [{ num: 3, title: 'מרחבים', hasSummary: false }], progress: { openTopics: ['בסיסים'], daysSinceStudy: 6 } });
  check('the strategy by rules gives up to three actions for this week, from cards, lectures, topics and days without study', wk.thisWeek.length === 3 && wk.thisWeek[0].includes('7') && app.TrackFallback({ course: 'x', level: 2 }).thisWeek.length === 0 && app.TrackCleanStrategy(wk).thisWeek.length === 3);
  const sys = app.StrategySystem('code'), pmt = JSON.parse(app.StrategyPrompt({ course: 'ג', level: 3, examDays: 4, lectures: 5, progress: { weekMinutes: 90, daysSinceStudy: 2, openTopics: ['א'], topics: 3, topicsDone: 1 } }));
  check('the AI instructions follow the kind of course, name the learning principles, and the question carries the progress', sys.includes('קורס תכנות') && app.StrategySystem('math').includes('קורס מתמטיקה') && sys.includes('thisWeek') && sys.includes('שליפה פעילה') && pmt.התקדמות.דקות_למידה_השבוע === 90 && pmt.התקדמות.נושאים_פתוחים[0] === 'א');
  const prof = app.TrackNew('2099-01-07'); prof.courses.push({ name: 'ק', level: 2, hoursPerWeek: 0, examDate: '', notes: '', manual: true });
  prof.log.push({ date: '2099-01-03', course: 'ק', minutes: 40, note: '', block: '' }); prof.progress['ק'] = { topics: [{ id: 'a', title: 'פתוח', done: false }, { id: 'b', title: 'סגור', done: true }] };
  const pg = app.TrackProgressOf('ק', prof, '2099-01-07');
  check('the progress of one course counts the days since the last study and the open topics', pg.daysSinceStudy === 4 && pg.openTopics.length === 1 && pg.openTopics[0] === 'פתוח' && pg.topicsDone === 1 && app.TrackProgressOf('אחר', prof, '2099-01-07').daysSinceStudy === null);

  // The whole thing through the host, with the file on disk and the AI stubbed.
  const saved = app.settings.studyRoot;
  app.settings.studyRoot = path.join(root, 'track-app', 'קורסים');
  const sent = [], realSend = app.Send, realAsk = app.ask, realSave = app.savePath, realPick = app.pickFiles, realToast = app.Toast;
  app.Send = (m) => sent.push(m); app.Toast = () => { };
  const op = async (m) => { sent.length = 0; await app.TrackHandle(Object.assign({ type: 'track' }, m)); return sent.find(x => x.type === (m.op === 'strategy' ? 'trackStrategy' : 'trackState')) || sent[0]; };
  let state = await op({ op: 'load', courses: ['קורס מהאפליקציה'] });
  check('a new profile is empty, and suggests the courses the app knows', state.profile.courses.length === 0 && state.suggested.some(s => s.name === 'קורס מהאפליקציה'));
  writeText(app.TimetableJson, JSON.stringify({ classes: [{ day: 'ראשון', start: '10:00', end: '12:00', course: 'מבני נתונים' }], exams: [{ course: 'מבני נתונים', date: '2099-01-10', moed: 'א' }] }));
  state = await op({ op: 'load' });
  check('the timetable and the exams give suggestions too, with the date of the exam', state.suggested.some(s => s.name === 'מבני נתונים' && s.examDate === '2099-01-10'));
  state = await op({ op: 'addCourses', courses: [{ name: 'מבני נתונים', examDate: '2099-01-10' }, { name: 'קורס ידני', manual: true }, { name: 'מבני נתונים' }] });
  check('courses are added once, and are saved in a file that is written whole', state.profile.courses.length === 2 && fileExists(app.TrackFile) && !fileExists(app.TrackFile + '.tmp') && app.TrackLoad().courses.length === 2 && !state.suggested.some(s => s.name === 'מבני נתונים'));
  state = await op({ op: 'editCourse', course: 'קורס ידני', values: { level: 17, hoursPerWeek: 3.3, examDate: 'bad', notes: 'ה'.repeat(500) } });
  const manual = state.profile.courses.find(c => c.name === 'קורס ידני');
  check('editing a course keeps it in range', manual.level === 3 && manual.hoursPerWeek === 3.25 && manual.examDate === '' && manual.notes.length <= 303);

  let asks = 0, seen = '';
  app.HelperOrder = () => ['gemini'];
  app.HelperAsk = async (system, messages) => { asks++; seen = messages[0][1]; return { Error: false, Text: '{"summary":"סיכום","steps":[{"title":"א","detail":"ד"},{"title":"ב"},{"title":"ג"},{"title":"ד"}],"routine":["ר"],"avoid":["ל"]}' }; };
  app.CoachContext = () => { throw new Error('no folder'); };
  let res = await op({ op: 'strategy', course: 'מבני נתונים' });
  check('a strategy comes from the AI, with the course, the difficulty and the exam, and is saved', res.type === 'trackStrategy' && res.strategy.source === 'ai' && asks === 1 && seen.includes('מבני נתונים') && seen.includes('ימים_למבחן') && app.TrackLoad().strategies['מבני נתונים'].summary === 'סיכום');
  res = await op({ op: 'strategy', course: 'מבני נתונים' });
  check('a saved strategy is shown without asking again, and "again" asks again', res.strategy.summary === 'סיכום' && asks === 1 && (await op({ op: 'strategy', course: 'מבני נתונים', refresh: true }), asks === 2));
  app.HelperAsk = async () => ({ Error: true, Text: 'limit' });
  res = await op({ op: 'strategy', course: 'קורס ידני', refresh: true });
  check('without a usable AI answer the strategy is made by rules', res.strategy.source === 'rules' && res.strategy.steps.length >= 3 && !res.error);
  res = await op({ op: 'strategy', course: 'קורס שאין' });
  check('a strategy for a course that is not in the profile is refused', !!res.error);
  delete app.HelperOrder; delete app.HelperAsk; delete app.CoachContext;

  // Blocks: built, done, undone. A fixed plan, so that the result does not depend on the day of the week.
  const fixed = app.TrackLoad();
  const nowD = new Date(), localToday = nowD.getFullYear() + '-' + String(nowD.getMonth() + 1).padStart(2, '0') + '-' + String(nowD.getDate()).padStart(2, '0');
  fixed.plan = { weekStart: app.TrackWeekStart(localToday), blocks: [{ id: 'b1', day: 1, start: '10:00', minutes: 60, course: 'מבני נתונים', goal: 'תרגול', done: false, doneMinutes: 0 }, { id: 'b2', day: 2, start: '10:00', minutes: 45, course: 'קורס ידני', goal: 'סיכום', done: false, doneMinutes: 0 }] };
  app.TrackSave(fixed);
  state = await op({ op: 'done', id: 'b1', minutes: 50 });
  check('a block marked done puts its minutes in the log, and the stats follow', state.profile.plan.blocks[0].done && state.profile.plan.blocks[0].doneMinutes === 50 && state.profile.log.length === 1 && state.stats.weekMinutes === 50 && state.stats.doneBlocks === 1 && state.stats.streak === 1);
  state = await op({ op: 'done', id: 'b1', minutes: 40 });
  check('marking it twice does not count it twice', state.profile.log.length === 1 && state.profile.log[0].minutes === 40);
  state = await op({ op: 'undo', id: 'b1' });
  check('undo takes the minutes out again', !state.profile.plan.blocks[0].done && state.profile.log.length === 0 && state.stats.totalMinutes === 0);
  state = await op({ op: 'log', course: 'מבני נתונים', minutes: 25, note: 'חזרה' });
  await op({ op: 'log', course: 'קורס שאין', minutes: 25 });
  await op({ op: 'log', course: 'מבני נתונים', minutes: 0 });
  state = app.TrackSnapshot();
  check('time can be logged by hand, only for a course in the profile and only when above zero', state.profile.log.length === 1 && state.stats.perCourse['מבני נתונים'].total === 25);
  state = await op({ op: 'removeBlock', id: 'b2' });
  check('a block can be removed', state.profile.plan.blocks.length === 1);
  // A block by hand goes to the day that was chosen, can be changed and moved, and bad input saves nothing.
  const nBefore = state.profile.plan.blocks.length;
  state = await op({ op: 'blockSave', course: 'מבני נתונים', day: 2, start: '18:30', minutes: 50, goal: 'תרגיל בית 3' });
  const hand = state.profile.plan.blocks.find(b => b.goal === 'תרגיל בית 3');
  check('a block made by hand lands on the day that was chosen, with its time and length', state.profile.plan.blocks.length === nBefore + 1 && hand.day === 2 && hand.start === '18:30' && hand.minutes === 50 && hand.course === 'מבני נתונים' && !hand.done);
  state = await op({ op: 'blockSave', id: hand.id, course: 'מבני נתונים', day: 4, start: '09:15', minutes: 5000, goal: '' });
  const moved = state.profile.plan.blocks.find(b => b.id === hand.id);
  check('a block can be moved to another day, the length is kept in range and an empty goal gets a default', state.profile.plan.blocks.length === nBefore + 1 && moved.day === 4 && moved.start === '09:15' && moved.minutes === 240 && moved.goal.length > 0);
  const badN = state.profile.plan.blocks.length;
  await op({ op: 'blockSave', course: 'קורס שאין', day: 1, start: '10:00', minutes: 30 }); await op({ op: 'blockSave', course: 'מבני נתונים', day: 9, start: '10:00', minutes: 30 }); await op({ op: 'blockSave', course: 'מבני נתונים', day: 1, start: '25:99', minutes: 30 });
  check('a block for an unknown course, a bad day or a bad time is not saved', app.TrackSnapshot().profile.plan.blocks.length === badN);
  const days = app.TrackSnapshot().profile.plan.blocks.map(b => b.day); 
  check('the blocks stay in the order of the week', days.every((d, i) => i === 0 || days[i - 1] <= d));
  state = await op({ op: 'build', hours: 8, days: [0, 1, 2, 3, 4, 5], from: '09:00', to: '20:00' });
  check('building the week answers with the new plan, for this week or the next', !!state.built && state.profile.plan.weekStart >= state.weekStart && state.profile.plan.blocks.length === state.built.blocks);

  // Topics.
  state = await op({ op: 'topic', course: 'מבני נתונים', act: 'add', title: 'עצי חיפוש' });
  await op({ op: 'topic', course: 'מבני נתונים', act: 'add', title: 'גרפים' });
  const tid = state.profile.progress['מבני נתונים'].topics[0].id;
  state = await op({ op: 'topic', course: 'מבני נתונים', act: 'toggle', id: tid });
  check('topics are added and ticked, and show in the stats', state.stats.perCourse['מבני נתונים'].topics === 2 && state.stats.perCourse['מבני נתונים'].topicsDone === 1);
  state = await op({ op: 'topic', course: 'מבני נתונים', act: 'remove', id: tid });
  check('a topic can be removed', state.stats.perCourse['מבני נתונים'].topics === 1);

  // Export and import: the file can move to another computer, and a bad file changes nothing.
  const out = path.join(root, 'track-export.json');
  app.savePath = async () => out; app.pickFiles = async () => [out]; app.ask = async () => true;
  await op({ op: 'export' });
  const exported = JSON.parse(readText(out));
  check('the profile is exported to a file', exported.courses.length === 2 && exported.log.length === 1);
  state = await op({ op: 'removeCourse', course: 'קורס ידני' });
  check('removing a course removes its blocks, log and strategy too', state.profile.courses.length === 1 && !state.profile.strategies['קורס ידני'] && state.profile.plan.blocks.every(b => b.course !== 'קורס ידני'));
  state = await op({ op: 'import' });
  check('importing brings back the exported profile, replacing the current one', state.profile.courses.length === 2 && state.profile.log.length === 1);
  writeText(out, '{ not json');
  const before = readText(app.TrackFile);
  await op({ op: 'import' });
  check('a file that is not a profile changes nothing', readText(app.TrackFile) === before);
  writeText(out, JSON.stringify({ courses: [{ name: 'ייבוא' }], log: [{ date: 'x', minutes: 5 }, { date: '2026-11-02', course: 'ייבוא', minutes: 5000 }] }));
  state = await op({ op: 'import' });
  check('an imported file is cleaned like any other source', state.profile.courses.length === 1 && state.profile.log.length === 1 && state.profile.log[0].minutes === 600);
  app.ask = async () => false;
  await op({ op: 'removeCourse', course: 'ייבוא' });
  check('removing a course asks first, and "no" keeps it', app.TrackLoad().courses.length === 1);
  const keptProfile = app.TrackLoad(); app.TrackSave(keptProfile); app.TrackSave(keptProfile);
  writeText(app.TrackFile, '{ broken');
  check('a profile file that is broken is read from the copy kept by the last save, and the broken file is kept aside',
    app.TrackLoad().courses.length === keptProfile.courses.length && keptProfile.courses.length > 0 && readText(app.TrackFile + '.broken') === '{ broken');
  app.TrackSave(app.TrackLoad());
  check('saving after a broken file does not copy the broken file over the good copy', JSON.parse(readText(app.TrackFile + '.bak')).courses.length === keptProfile.courses.length);
  writeText(app.TrackFile, '{ broken'); fs.unlinkSync(app.TrackFile + '.bak');
  check('a profile file that is broken with no copy gives an empty profile, not a crash', app.TrackLoad().courses.length === 0);

  // ---- The wizard: the routine, the calendar, difficulty and energy, and a plan that follows them.
  const rtBad = app.TrackCleanRoutine({ wake: '25:00', sleep: 'x', peak: 'night', days: [9, 1, 1, 'a', 3], hours: 500, block: 77, done: 'yes',
    commitments: [{ day: 1, start: '15:00', end: '20:00', title: '  עבודה   במשמרת ', source: 'calendar' }, { day: 2, start: '10:00', end: '09:00' }, { day: 8, start: '10:00', end: '11:00' }, { day: 0, start: '08:00', end: '09:00', id: 'x' }, { day: 0, start: '07:00', end: '07:30', id: 'x' }] });
  check('a routine is cleaned: times, peak and block size fall back to defaults, days and hours are kept in range, done must be true',
    rtBad.wake === '07:30' && rtBad.sleep === '23:30' && rtBad.peak === 'morning' && rtBad.days.join() === '1,3' && rtBad.hours === 60 && rtBad.block === 45 && rtBad.done === false);
  check('commitments need a real day and an end after the start, get unique ids and a clean title, and are sorted by the week',
    rtBad.commitments.length === 3 && rtBad.commitments[0].start === '07:00' && rtBad.commitments[2].title === 'עבודה במשמרת' && rtBad.commitments[2].source === 'calendar' && new Set(rtBad.commitments.map(c => c.id)).size === 3);
  check('a profile without a routine gets the default one, and every course has an energy in range',
    app.TrackClean({ courses: [{ name: 'א', energy: 9 }, { name: 'ב' }] }).routine.done === false && app.TrackClean({ courses: [{ name: 'א', energy: 9 }] }).courses[0].energy === 3 && app.TrackClean({ courses: [{ name: 'ב' }] }).courses[0].energy === 2);
  check('the study window is an hour after getting up until an hour before sleep, and a sleep after midnight ends the day at 23:45',
    JSON.stringify(app.TrackRoutineWindow({ wake: '07:30', sleep: '23:30' })) === '{"from":"08:30","to":"22:30"}' && app.TrackRoutineWindow({ wake: '09:10', sleep: '01:00' }).to === '23:45' && app.TrackRoutineWindow({ wake: '09:10', sleep: '01:00' }).from === '10:15');

  // The calendar: work every Monday 15:00-20:00 for four weeks is a commitment; a one-off meeting, an all-day event and a "free" event are not.
  const at = (y, mo, d, hh, mi) => new Date(y, mo - 1, d, hh, mi).getTime();
  const nowCal = new Date(2026, 10, 11, 12, 0);   // a Wednesday
  const evs = [];
  for (const d of [12, 19, 26]) evs.push({ start: at(2026, 10, d, 15, 0), end: at(2026, 10, d, 20, 0), title: 'עבודה', busy: true, allDay: false });
  evs.push({ start: at(2026, 11, 2, 15, 0), end: at(2026, 11, 2, 20, 0), title: 'עבודה', busy: true, allDay: false });
  evs.push({ start: at(2026, 11, 9, 15, 0), end: at(2026, 11, 9, 20, 0), title: 'עבודה', busy: true, allDay: false });
  evs.push({ start: at(2026, 11, 4, 9, 0), end: at(2026, 11, 4, 10, 0), title: 'פגישה עם המנחה', busy: true, allDay: false });
  evs.push({ start: at(2026, 11, 5, 0, 0), end: at(2026, 11, 6, 0, 0), title: 'יום הולדת', busy: false, allDay: true });
  for (const d of [3, 10]) evs.push({ start: at(2026, 11, d, 18, 0), end: at(2026, 11, d, 19, 0), title: 'אולי', busy: false, allDay: false });
  const rf = app.TrackRoutineFromEvents(evs, nowCal);
  check('an event that comes back every week at the same hours is a commitment, with the number of weeks; one-off, all-day and free events are not',
    rf.commitments.length === 1 && rf.commitments[0].title === 'עבודה' && rf.commitments[0].day === 1 && rf.commitments[0].start === '15:00' && rf.commitments[0].end === '20:00' && rf.commitments[0].weeks === 5 && rf.commitments[0].source === 'calendar');
  check('the busy minutes of an average weekday count the last four weeks only', rf.busyByDay[1] === 300 && rf.busyByDay[3] === 15 && rf.busyByDay[0] === 0 && rf.firstStart !== '' && rf.events === 5);
  check('no events give no commitments and no crash', app.TrackRoutineFromEvents([], nowCal).commitments.length === 0 && app.TrackRoutineFromEvents(null, nowCal).firstStart === '');

  // The same through the calendars the app keeps, read with the page's iCal reader (a weekly rule, local time).
  const savedCalDir = app.calendarsDir, savedCalList = app.settings.calendars;
  app.calendarsDir = path.join(root, 'track-calendars'); app.settings.calendars = [{ id: 'a'.repeat(32), name: 'Google', source: 'url', url: 'https://calendar.google.com/x.ics' }];
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:gym', 'SUMMARY:אימון', 'DTSTART:20261001T180000', 'DTEND:20261001T193000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  mkdirp(app.calendarsDir); writeText(app.CalendarFile('a'.repeat(32)), ics);
  const scan = app.TrackCalendarScan(nowCal);
  check('the connected calendar is read, and a weekly event becomes a commitment on its weekday', scan.calendars === 1 && scan.commitments.length === 1 && scan.commitments[0].title === 'אימון' && scan.commitments[0].day === 4 && scan.commitments[0].start === '18:00' && scan.commitments[0].end === '19:30');
  const scan2 = app.TrackCalendarScan(nowCal); scan2.commitments.length = 0;
  check('a calendar that did not change is not expanded again, and the answer kept is a copy', app.TrackCalendarScan(nowCal).commitments.length === 1 && app.trackCalCache && app.trackCalCache.stamp.includes('a'.repeat(32) + ':'));
  writeText(app.CalendarFile('a'.repeat(32)), ics.replace('180000', '170000').replace('193000', '183000'));
  fs.utimesSync(app.CalendarFile('a'.repeat(32)), new Date(), new Date(Date.now() + 5000));
  check('a calendar that changed is read again', app.TrackCalendarScan(nowCal).commitments[0].start === '17:00');
  app.settings.calendars = [];
  check('with no calendar the scan says so and finds nothing', app.TrackCalendarScan(nowCal).calendars === 0 && app.TrackCalendarScan(nowCal).commitments.length === 0);
  app.calendarsDir = savedCalDir; app.settings.calendars = savedCalList;

  // Difficulty and energy, suggested.
  const sMath = app.TrackSuggestRating('אלגברה לינארית', { examDays: null }), sGen = app.TrackSuggestRating('פסיכולוגיה', { examDays: null });
  const sNear = app.TrackSuggestRating('פסיכולוגיה', { examDays: 9, lectures: 6, summarized: 1, info: { grading: [{ component: 'מבחן סופי', weight: 90 }] } });
  check('a math course is suggested as hard and needing much energy, a course of concepts as medium and low energy, each with a reason',
    sMath.level === 3 && sMath.energy === 3 && sGen.level === 2 && sGen.energy === 1 && sMath.reasons.length >= 1 && sGen.reasons.length >= 1);
  check('a close exam and lectures without summaries make a course harder, and the reasons say so', sNear.level === 3 && sNear.reasons.some(r => r.includes('9 ימים')) && sNear.reasons.length === 3 && sNear.reasons.some(r => r.includes('מסוכמות')));

  // The week with a routine: heavy courses in the hours of most energy, light ones out of them, nothing over a commitment, blocks of the chosen length.
  const rp = app.TrackClean({ courses: [{ name: 'כבד', level: 3, energy: 3, hoursPerWeek: 2 }, { name: 'קל', level: 1, energy: 1, hoursPerWeek: 2 }] });
  const blockedC = [{ day: 0, start: '12:00', end: '13:00' }, { day: 1, start: '09:00', end: '11:00' }];
  const wkM = app.TrackBuildWeek(rp, [], { weekStart: '2026-11-01', today: '2026-10-30', days: [0, 1, 2], from: '08:00', to: '22:00', peak: 'morning', block: 60, blocked: blockedC });
  const heavyB = wkM.blocks.filter(b => b.course === 'כבד'), lightB = wkM.blocks.filter(b => b.course === 'קל');
  check('with a morning peak, the heavy course is in the morning and the light one after it', heavyB.length > 0 && lightB.length > 0 && heavyB.every(b => mins(b.start) + b.minutes <= 720) && lightB.every(b => mins(b.start) >= 720));
  check('no block is over a commitment or the quarter hour around it', wkM.blocks.every(b => blockedC.every(c => b.day !== c.day || mins(b.start) + b.minutes <= mins(c.start) - 15 || mins(b.start) >= mins(c.end) + 15)));
  const wkE = app.TrackBuildWeek(rp, [], { weekStart: '2026-11-01', today: '2026-10-30', days: [0, 1, 2], from: '08:00', to: '22:00', peak: 'evening', block: 30 });
  check('with an evening peak the heavy course moves to the evening, and short blocks give short sessions', wkE.blocks.filter(b => b.course === 'כבד').every(b => mins(b.start) >= 960) && wkE.blocks.every(b => b.minutes <= 45) && sumMin(wkE.blocks) === 240);
  const wkN = app.TrackBuildWeek(rp, [], { weekStart: '2026-11-01', today: '2026-10-30', days: [0, 1, 2], from: '08:00', to: '22:00' });
  check('without a peak the week is built as before, from the earliest free time', wkN.blocks.every(b => mins(b.start) < 720));

  // Through the host: scan, ratings and finishing the wizard, which saves the routine and the courses and builds the week.
  app.calendarsDir = path.join(root, 'track-calendars'); app.settings.calendars = [{ id: 'a'.repeat(32), name: 'Google', source: 'url', url: 'https://calendar.google.com/x.ics' }];
  sent.length = 0; await app.TrackHandle({ type: 'track', op: 'routineScan' });
  check('the wizard asks for the calendar and gets its commitments', sent[0] && sent[0].type === 'trackRoutineScan' && sent[0].calendars === 1 && Array.isArray(sent[0].commitments));
  app.calendarsDir = savedCalDir; app.settings.calendars = savedCalList;
  sent.length = 0; await app.TrackHandle({ type: 'track', op: 'ratings', courses: ['חדו"א 1', 'פסיכולוגיה', '', 'פסיכולוגיה'], exams: { 'פסיכולוגיה': '2000-01-01' } });
  const rts = sent[0] && sent[0].ratings;
  check('ratings are suggested for each course that was asked about, and an old exam date is ignored', sent[0].type === 'trackRatings' && Object.keys(rts).length === 2 && rts['חדו"א 1'].level === 3 && rts['פסיכולוגיה'].energy === 1 && !rts['פסיכולוגיה'].reasons.some(r => r.includes('המבחן בעוד')));
  app.ask = async () => false;
  const beforeWiz = app.TrackLoad().courses.map(c => c.name);
  state = await op({ op: 'wizardFinish', routine: { wake: '08:00', sleep: '23:00', peak: 'evening', days: [0, 1, 2, 3, 4], hours: 6, block: 45, commitments: [{ id: 'w', title: 'עבודה', day: 1, start: '16:00', end: '20:00', source: 'calendar' }] },
    courses: [{ name: 'חדו"א 1', level: 3, energy: 3, manual: true }, { name: 'פסיכולוגיה', level: 1, energy: 1 }] });
  const wizP = state.profile;
  check('finishing the wizard saves the routine as done, with its commitments', state.wizardDone === true && wizP.routine.done && wizP.routine.peak === 'evening' && wizP.routine.commitments.length === 1 && wizP.routine.updated !== '' && app.TrackLoad().routine.done);
  check('the chosen courses are added with their difficulty and energy, and a course that was not chosen stays when the student says no',
    wizP.courses.find(c => c.name === 'חדו"א 1').energy === 3 && wizP.courses.find(c => c.name === 'פסיכולוגיה').level === 1 && beforeWiz.every(n => wizP.courses.some(c => c.name === n)));
  const wizB = wizP.plan.blocks.filter(b => !b.done);
  check('the week is built from the routine: inside its window, not over the commitment, and the heavy course in the evening',
    !!state.built && wizB.length > 0 && wizB.every(b => mins(b.start) >= 540 && mins(b.start) + b.minutes <= 1320) && wizB.every(b => b.day !== 1 || mins(b.start) + b.minutes <= 945 || mins(b.start) >= 1215) && wizB.filter(b => b.course === 'חדו"א 1').every(b => mins(b.start) >= 960));
  const lateThu = app.TrackBuildFromRoutine(wizP, [], '2026-11-12', new Date(2026, 10, 12, 22, 39)), thuEvening = app.TrackBuildFromRoutine(wizP, [], '2026-11-12', new Date(2026, 10, 12, 18, 0));
  check('after the window of the last study day the week is built for the next week, not left empty; earlier that day it is still this week',
    lateThu.weekStart === '2026-11-15' && lateThu.blocks.length > 0 && thuEvening.weekStart === '2026-11-08' && thuEvening.blocks.length > 0 && thuEvening.blocks.every(b => b.day === 4 && mins(b.start) >= 1095));
  app.ask = async () => true;
  state = await op({ op: 'wizardFinish', routine: { days: [0, 1] }, courses: [{ name: 'פסיכולוגיה', level: 2, energy: 2 }] });
  check('a course that was not chosen is removed when the student agrees', state.profile.courses.length === 1 && state.profile.courses[0].name === 'פסיכולוגיה' && state.profile.courses[0].level === 2);
  sent.length = 0; await app.TrackHandle({ type: 'track', op: 'wizardFinish', routine: {}, courses: [] });
  check('finishing with no course is refused and saves nothing', sent.some(m => m.type === 'trackWizard' && m.error) && app.TrackLoad().courses.length === 1);
  state = await op({ op: 'editCourse', course: 'פסיכולוגיה', values: { energy: 3 } });
  check('the energy of a course can be changed from the course list', state.profile.courses[0].energy === 3);
  state = await op({ op: 'build', hours: 4, days: [0, 1, 2, 3, 4, 5, 6] });
  check('building again with a routine keeps working, and the snapshot has the window of the routine', !!state.built && state.window && state.window.from === '08:30');

  // ---- Study tasks from the course folders.
  const recs = app.TrackRecommend([
    { course: 'מבני נתונים', folder: 'מבני נתונים - תשפז', level: 3, examDays: 6, pastExams: 2, cardsDue: 12, lectures: [
      { num: 1, title: 'מבוא', hasSummary: true, cards: 5, files: 2, exercises: 3 },
      { num: 2, title: 'ערימות', hasSummary: true, cards: 0, files: 1 },
      { num: 3, title: 'עצי AVL', hasSummary: false, files: 3, transcripts: 1, videos: 2, due: '2026-11-12' },
      { num: 4, title: '', hasSummary: false, files: 0, transcripts: 0, videos: 0 }] },
    { course: 'היסטוריה', level: 1, examDays: null, pastExams: 3, cardsDue: 0, lectures: [{ num: 1, title: 'א', hasSummary: true, cards: 2, due: '2026-12-30' }] },
  ], '2026-11-10');
  const kinds = recs.filter(r => r.course === 'מבני נתונים').map(r => r.kind);
  check('the tasks come from the folder: homework due soon, a past exam before a close exam, cards due, a summary, cards and exercises, and a recording to transcribe',
    ['homework', 'exam', 'review', 'summary', 'cards', 'practice', 'transcribe'].every(k => kinds.includes(k)) && kinds.filter(k => k === 'summary').length === 1);
  const hw = recs.find(r => r.kind === 'homework'), sm = recs.find(r => r.kind === 'summary');
  check('each task names the lecture and says why, from the material', hw.title.includes('הרצאה 3 (עצי AVL)') && hw.why.includes('בעוד 2 ימים') && sm.why.includes('4 קבצים') && recs.find(r => r.kind === 'cards').lecture === 2 && recs.find(r => r.kind === 'practice').lecture === 1);
  check('the most urgent comes first, a lecture with no material gives no task, and a far deadline or no exam gives nothing',
    recs[0].kind === 'homework' && !recs.some(r => r.lecture === 4) && recs.filter(r => r.course === 'היסטוריה').length === 0 && app.TrackRecommend([], '2026-11-10').length === 0 && app.TrackRecommend(null, '2026-11-10').length === 0);
  const goals = app.TrackGoals(recs);
  check('the tasks become goals of the blocks, by course and in order, without the transcription', goals['מבני נתונים'][0] === hw.title && !goals['מבני נתונים'].some(g => g.startsWith('תמלל')));
  const gp = app.TrackClean({ courses: [{ name: 'מבני נתונים', level: 3, hoursPerWeek: 3 }] });
  const gw = app.TrackBuildWeek(gp, [], { weekStart: '2026-11-01', today: '2026-10-30', days: [0, 1, 2, 3, 4], goals });
  check('a week built with tasks uses them as the goals of its blocks, and the general goals after them', gw.blocks.length >= 3 && gw.blocks.some(b => b.goal === hw.title) && gw.blocks.every(b => b.goal.length > 0));

  // Through the host, from a real folder: lecture 1 with material and no summary, lecture 2 with a summary and no cards, a past exam.
  const tCourse = 'אלגוריתמים - תשפז';
  app.SaveLecture(tCourse, { num: 1, title: 'מיון' }); app.SaveLecture(tCourse, { num: 2, title: 'גרפים' });
  writeText(path.join(app.LectureDir(tCourse, 1), 'slides.pdf'), '%PDF-1.4 x');
  const tPage = app.StudyPagePath(tCourse, 2); mkdirp(path.dirname(tPage)); writeText(tPage, '<html></html>');
  writeText(path.join(app.CourseDir(tCourse), C.Exams, 'מבחן 2025.pdf'), '%PDF-1.4 y');
  const tProf = app.TrackClean({ courses: [{ name: 'אלגוריתמים', level: 2, examDate: '2099-01-10' }, { name: 'קורס בלי תיקייה' }] });
  const hostTasks = app.TrackTasks(tProf, '2099-01-01');
  check('the host finds the folder of a course by its name, and reads the tasks from it', hostTasks.some(t => t.kind === 'summary' && t.lecture === 1 && t.folder === tCourse && t.course === 'אלגוריתמים') && hostTasks.some(t => t.kind === 'cards' && t.lecture === 2) && hostTasks.some(t => t.kind === 'exam' && t.why.includes('9 ימים')) && !hostTasks.some(t => t.course === 'קורס בלי תיקייה'));
  // The tasks are kept for a minute: asking again reads no folder, until a lecture changes.
  let ctxReads = 0; const realCtx = app.CoachContext; app.CoachContext = function (...a) { ctxReads++; return realCtx.apply(this, a); };
  const tasksAgain = app.TrackTasks(tProf, '2099-01-01');
  check('the tasks are kept for a short while: asking again for the same day and courses reads no folder', ctxReads === 0 && tasksAgain.length === hostTasks.length);
  tasksAgain[0].title = 'שונה';
  check('changing the tasks the host returned does not change the kept ones', app.TrackTasks(tProf, '2099-01-01')[0].title === hostTasks[0].title);
  app.TrackTasks(tProf, '2099-01-02');
  check('another day reads the folders again', ctxReads === 1);
  app.SaveLecture(tCourse, { num: 3, title: 'עצים' });
  app.TrackTasks(tProf, '2099-01-02');
  check('a lecture that changed reads the folders again', ctxReads === 2);
  app.CoachContext = realCtx;
  app.TrackSave(tProf);
  sent.length = 0; await app.TrackHandle({ type: 'track', op: 'tasks' });
  const nowTasks = app.TrackTasks(app.TrackLoad(), localToday);
  check('the page gets the tasks with how many there are', sent[0] && sent[0].type === 'trackTasks' && nowTasks.length > 0 && sent[0].tasks.length === Math.min(10, nowTasks.length) && sent[0].total === nowTasks.length);

  app.Send = realSend; app.ask = realAsk; app.savePath = realSave; app.pickFiles = realPick; app.Toast = realToast;
  app.settings.studyRoot = saved;
}

// Study blocks into the Calendar app (calendar-sync.js). The Calendar app is a fake program here: it keeps "events" in a file.
async function runCalendarSyncTests(app, root, check) {
  const CS = require('../lib/modules/calendar-sync');
  const at = (d, hh, mi) => new Date(2026, 10, d, hh, mi || 0).getTime();

  // One block -> one event.
  const ev = CS.blockEvent({ id: 'b2', day: 2, start: '14:30', minutes: 45, course: 'מבני נתונים', goal: 'תרגול עצים', done: false }, '2026-11-08');
  check('a block becomes an event at its day and hour, named after the course, with the goal as its notes',
    ev.start === at(10, 14, 30) && ev.end === at(10, 15, 15) && ev.title === 'לימוד: מבני נתונים' && ev.notes === 'תרגול עצים' && ev.key === 'b2@2026-11-08');
  check('a block that was done is marked in its title, and a block without a real hour or id gives no event',
    CS.blockEvent({ id: 'b2', day: 0, start: '09:00', minutes: 30, course: 'א', done: true }, '2026-11-08').title === '✓ לימוד: א'
    && CS.blockEvent({ id: 'b2', day: 0, start: 'x', minutes: 30, course: 'א' }, '2026-11-08') === null && CS.blockEvent({ day: 0, start: '09:00', course: 'א' }, '2026-11-08') === null
    && CS.planEvents({ weekStart: '', blocks: [{ id: 'b1', start: '09:00' }] }).length === 0);

  // What to write.
  const target = { calendar: 'Google', nth: 0 }, now = at(10, 12);
  const e1 = { key: 'b1@w', title: 'לימוד: א', notes: '', start: at(10, 9), end: at(10, 10), done: false }, e2 = { key: 'b2@w', title: 'לימוד: ב', notes: '', start: at(11, 9), end: at(11, 10), done: false };
  const first = CS.syncOps([e1, e2], {}, target, now, false);
  check('new blocks are created, with a reminder only for the one that has not started yet',
    first.ops.length === 2 && first.ops.every(o => o.op === 'put' && o.uid === '' && o.calendar === 'Google') && first.ops[0].alarm === 0 && first.ops[1].alarm === 10);
  const known = CS.syncResult(first.ops, [{ key: 'b1@w', ok: true, uid: 'U1' }, { key: 'b2@w', ok: true, uid: 'U2' }], first.keep, {}).next;
  check('what was written is remembered with its event', known['b1@w'].uid === 'U1' && known['b2@w'].uid === 'U2' && known['b2@w'].calendar === 'Google');
  check('nothing changed: nothing is written', CS.syncOps([e1, e2], known, target, now, false).ops.length === 0);
  const moved = CS.syncOps([e1, Object.assign({}, e2, { start: at(11, 14), end: at(11, 15) })], known, target, now, false);
  check('a block that moved changes its own event', moved.ops.length === 1 && moved.ops[0].op === 'put' && moved.ops[0].uid === 'U2' && moved.ops[0].start === at(11, 14));
  const gone = CS.syncOps([e1], known, target, now, false);
  check('a block that was removed has its event deleted', gone.ops.length === 1 && gone.ops[0].op === 'delete' && gone.ops[0].uid === 'U2' && !gone.keep['b2@w']);
  const doneKnown = Object.assign({}, known, { 'b1@w': Object.assign({}, known['b1@w'], { done: true }) });
  const nextWeek = CS.syncOps([], doneKnown, target, now, false);
  check('when a new week replaces the plan, a block that was studied stays in the calendar and the others are deleted',
    nextWeek.ops.length === 1 && nextWeek.ops[0].uid === 'U2' && Object.keys(nextWeek.keep).length === 0);
  const other = CS.syncOps([e1], { 'b1@w': known['b1@w'] }, { calendar: 'לוח שנה', nth: 0 }, now, false);
  check('another calendar: the event is deleted in the old one and created in the new one',
    other.ops.length === 2 && other.ops[0].op === 'delete' && other.ops[0].calendar === 'Google' && other.ops[1].op === 'put' && other.ops[1].calendar === 'לוח שנה' && other.ops[1].uid === '');
  check('"sync now" writes everything again, to its own events', CS.syncOps([e1, e2], known, target, now, true).ops.map(o => o.uid).join() === 'U1,U2');
  const half = CS.syncResult(moved.ops, [{ key: 'b2@w', ok: false, error: 'x' }], moved.keep, known);
  check('a write that failed keeps what was remembered, to try again', half.failed.length === 1 && half.next['b2@w'].uid === 'U2' && half.next['b2@w'].hash === known['b2@w'].hash);
  const delFail = CS.syncResult(gone.ops, [], gone.keep, known);
  check('a delete that failed is remembered too', delFail.failed.length === 1 && delFail.next['b2@w'].uid === 'U2');

  // The real script is JavaScript that macOS can compile (it is run only on a student's Mac, never here).
  const scriptFile = path.join(__dirname, '..', 'lib', 'scripts', 'calendar-sync.jxa.js');
  if (process.platform === 'darwin' && fileExists('/usr/bin/osacompile')) {
    const c = spawnSync('/usr/bin/osacompile', ['-l', 'JavaScript', '-o', path.join(root, 'calendar-sync.scpt'), scriptFile], { encoding: 'utf8' });
    check('the Calendar script compiles on macOS', c.status === 0);
  }

  // Through the host, with a fake Calendar app.
  const store = path.join(root, 'fake-calendar.json'), fake = path.join(root, 'fake-osascript');
  const read = () => JSON.parse(readText(store)), write = (x) => writeText(store, JSON.stringify(x));
  write({ calendars: [{ name: 'Google', nth: 0, writable: true }, { name: 'חגים', nth: 0, writable: false }, { name: 'לוח שנה', nth: 0, writable: true }], events: {}, seq: 0, calls: [], fail: '' });
  writeText(fake, `#!/usr/bin/env node
const fs = require('fs'), a = process.argv.slice(2), s = JSON.parse(fs.readFileSync(${JSON.stringify(store)}, 'utf8'));
const req = JSON.parse(a[a.length - 1]);
s.calls.push(req.op + (a[0] === '-l' && a[1] === 'JavaScript' && a[2] === '-e' && a[3].includes("Application('Calendar')") ? '' : ':bad-args'));
let out;
if (s.fail) { fs.writeFileSync(${JSON.stringify(store)}, JSON.stringify(s)); process.stderr.write(s.fail); process.exit(1); }
if (req.op === 'list') out = { ok: true, calendars: s.calendars };
else out = { ok: true, results: req.ops.map(o => {
  if (!s.calendars.some(c => c.name === o.calendar && c.nth === o.nth)) return { key: o.key, ok: false, error: 'no-calendar' };
  const cal = o.calendar + '#' + o.nth, has = o.uid && s.events[o.uid] && s.events[o.uid].cal === cal;
  if (o.op === 'delete') { if (has) delete s.events[o.uid]; return { key: o.key, ok: true }; }
  const uid = has ? o.uid : 'U' + (++s.seq);
  s.events[uid] = { cal, title: o.title, notes: o.notes, start: o.start, end: o.end, alarm: o.alarm };
  return { key: o.key, ok: true, uid };
}) };
fs.writeFileSync(${JSON.stringify(store)}, JSON.stringify(s));
process.stdout.write(JSON.stringify(out));
`);
  fs.chmodSync(fake, 0o755);
  const savedScript = process.env.SUMIT_OSASCRIPT, savedRoot = app.settings.studyRoot, realSend = app.Send, sent = [];
  process.env.SUMIT_OSASCRIPT = fake; app.settings.studyRoot = root; app.calSyncDelay = 0;
  app.Send = (m) => sent.push(m);
  const last = (type) => sent.filter(m => m.type === type).pop();
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise(r => setTimeout(r, 25)); return fn(); };
  const titles = () => Object.values(read().events).map(e => e.title).sort().join('|');
  try {
    // A week from tomorrow, so the blocks are in the future whatever the day the tests run.
    const d0 = new Date(Date.now() + 86400000), ws = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
    const prof = app.TrackLoad();
    prof.courses = [{ name: 'אלגברה', level: 2, energy: 2, hoursPerWeek: 0, examDate: '', notes: '', manual: true }];
    prof.plan = { weekStart: ws, blocks: [{ id: 'b0', day: 0, start: '09:00', minutes: 60, course: 'אלגברה', goal: 'תרגול', done: false, doneMinutes: 0 }, { id: 'b1', day: 1, start: '10:00', minutes: 45, course: 'אלגברה', goal: 'חזרה', done: false, doneMinutes: 0 }] };
    app.TrackSave(prof);
    await new Promise(r => setTimeout(r, 80));
    check('with the sync off, saving the plan does not touch the calendar', read().calls.length === 0);

    await app.CalSyncHandle({ action: 'list' });
    check('the page gets the calendars that can be written to, by name', last('calSync').calendars.map(c => c.name).join() === 'Google,לוח שנה' && !read().calls.join().includes('bad-args'));
    sent.length = 0;
    await app.CalSyncHandle({ action: 'set', calendar: 'Google', nth: 0 });
    check('turning the sync on writes the blocks of the plan to the chosen calendar, with a reminder',
      Object.keys(read().events).length === 2 && titles() === 'לימוד: אלגברה|לימוד: אלגברה' && Object.values(read().events).every(e => e.cal === 'Google#0' && e.alarm === 10)
      && app.settings.calSync.on === true && last('calSync').on && last('calSync').count === 2 && last('calSync').error === '' && last('toast').text.includes('2 אירועים'));

    // A change in the app reaches the calendar by itself.
    const uids = Object.keys(read().events).sort().join();
    const p2 = app.TrackLoad(); p2.plan.blocks[0].done = true; p2.plan.blocks[0].doneMinutes = 60; p2.plan.blocks[1].start = '16:00';
    const callsBefore = read().calls.length;
    app.TrackSave(p2); app.TrackSave(p2);
    check('a block marked as done, and one that moved, change their own events a moment later, in one write',
      await until(() => titles() === 'לימוד: אלגברה|✓ לימוד: אלגברה' && Object.values(read().events).some(e => new Date(e.start).getHours() === 16))
      && Object.keys(read().events).sort().join() === uids && read().calls.length === callsBefore + 1);
    const p3 = app.TrackLoad(); p3.plan.blocks = p3.plan.blocks.slice(0, 1); app.TrackSave(p3);
    check('a block that was removed leaves the calendar', await until(() => Object.keys(read().events).length === 1) && titles() === '✓ לימוד: אלגברה');
    const calls3 = read().calls.length; app.TrackSave(app.TrackLoad()); await new Promise(r => setTimeout(r, 120));
    check('a save that changes no block writes nothing', read().calls.length === calls3);

    // macOS did not allow it: said clearly, nothing forgotten.
    const s1 = read(); s1.fail = 'execution error: Error: Not authorized to send Apple events to Calendar. (-1743)'; write(s1);
    sent.length = 0;
    const p4 = app.TrackLoad(); p4.plan.blocks.push({ id: 'b5', day: 2, start: '11:00', minutes: 30, course: 'אלגברה', goal: 'x', done: false, doneMinutes: 0 }); app.TrackSave(p4);
    check('without the permission of macOS the student is told where to allow it, once',
      await until(() => !!last('toast')) && last('toast').error && last('toast').text.includes('אוטומציה') && last('calSync').error.includes('הרשאה') && Object.keys(read().events).length === 1);
    sent.length = 0; app.TrackSave(app.TrackLoad()); await until(() => sent.some(m => m.type === 'calSync'));
    check('the same failure again is not announced again, and the event that was written is still remembered', !last('toast') && Object.keys(app.CalSyncLoad().events).length === 1);
    const s2 = read(); s2.fail = ''; write(s2);
    sent.length = 0; await app.CalSyncHandle({ action: 'now' });
    check('"sync now" after the permission was given writes what was missing and clears the error', Object.keys(read().events).length === 2 && last('calSync').error === '' && !last('toast').error);

    // Another calendar, a calendar that is gone, and turning it off.
    await app.CalSyncHandle({ action: 'set', calendar: 'לוח שנה', nth: 0 });
    check('choosing another calendar moves the events there', Object.values(read().events).length === 2 && Object.values(read().events).every(e => e.cal === 'לוח שנה#0'));
    sent.length = 0; await app.CalSyncHandle({ action: 'set', calendar: 'אין כזה', nth: 0 });
    check('a calendar that is not in the Calendar app gives a clear message', last('toast').error && last('toast').text.includes('לא נמצא'));
    await app.CalSyncHandle({ action: 'set', calendar: 'לוח שנה', nth: 0 });
    await app.CalSyncHandle({ action: 'off', remove: true });
    check('"off and remove" deletes the events the app wrote and stops the sync', Object.keys(read().events).length === 0 && app.settings.calSync.on === false && Object.keys(app.CalSyncLoad().events).length === 0 && last('calSync').on === false);
    const callsOff = read().calls.length; app.TrackSave(app.TrackLoad()); await new Promise(r => setTimeout(r, 120));
    check('after it is off, saving the plan does not touch the calendar', read().calls.length === callsOff);
    await app.CalSyncHandle({ action: 'set', calendar: 'Google', nth: 0 });
    await app.CalSyncHandle({ action: 'off', remove: false });
    check('"off" alone leaves the events in the calendar and forgets them', Object.keys(read().events).length === 2 && Object.keys(app.CalSyncLoad().events).length === 0);
    sent.length = 0; await app.CalSyncHandle({ action: 'now' });
    check('"sync now" while it is off says so and writes nothing', last('toast').error && Object.keys(read().events).length === 2);
    process.env.SUMIT_OSASCRIPT = path.join(root, 'no-osascript');
    sent.length = 0; await app.CalSyncHandle({ action: 'list' });
    check('a Mac where the script cannot run gives a message, not a crash', last('toast').error && !!last('calSync').listError);
  } finally {
    clearTimeout(app.calSyncTimer);
    delete app.settings.calSync; delete app.calSyncDelay;
    process.env.SUMIT_OSASCRIPT = savedScript; app.settings.studyRoot = savedRoot; app.Send = realSend;
  }
}

// "What to do in this block?" (block-plan.js): a plan that fills exactly the block, by rules or from an AI answer.
async function runBlockPlanTests(app, check) {
  const kinds = ['recall', 'learn', 'practice', 'review', 'break', 'plan'];
  const sum = (steps) => steps.reduce((n, s) => n + s.minutes, 0);
  const sound = (steps, minutes) => steps.length >= 3 && steps.length <= 8 && sum(steps) === minutes && steps[0].kind === 'recall' && steps[0].minutes <= 5
    && steps.every(s => s.title && s.minutes >= 2 && kinds.includes(s.kind));

  const req = app.BlockRequest({ requestId: 'r', title: 'ל'.repeat(300), minutes: 9999, note: 'ה'.repeat(500), course: 'ק'.repeat(300) });
  check('a block request is cut down: a short title, a length within range, a short note', req.title.length <= 123 && req.minutes === 240 && req.note.length <= 303 && req.course.length <= 123 && app.BlockRequest({ title: 'x', minutes: 3 }).minutes === 10 && app.BlockRequest({ title: 'x' }).minutes === 60);

  const titles = ['ללמוד שפת C', 'לימוד פייתון', 'חזרה על חדו"א', 'Study Linux'];
  const lengths = [10, 15, 20, 30, 45, 60, 75, 90, 120, 180, 240];
  const all = [];
  for (const title of titles) for (const minutes of lengths) all.push([minutes, app.BlockFallback({ title, minutes })]);
  check('for every block length the plan fills exactly the block, starts small from memory and has known kinds', all.every(([m, steps]) => sound(steps, m)));
  check('a long block has a break in the middle and a short one has none', all.filter(([m]) => m >= 75).every(([, s]) => s.some(x => x.kind === 'break') && s[s.length - 1].kind !== 'break') && all.filter(([m]) => m < 75).every(([, s]) => !s.some(x => x.kind === 'break')));
  const c60 = app.BlockFallback({ title: 'ללמוד שפת C', minutes: 60 }).map(s => s.title).join('|');
  check('the word "study" is dropped from the topic, and a programming topic is practised by writing and running code', c60.includes('"שפת C"') && !c60.includes('"ללמוד') && c60.includes('כתוב והרץ'));
  check('a topic that is not programming gets exercises instead of code', app.BlockFallback({ title: 'חזרה על חדו"א', minutes: 60 }).some(s => s.kind === 'practice' && !s.title.includes('כתוב והרץ')));

  // What an AI answers: trusted only after cleaning.
  const raw = [{ title: 'שלוף מהזיכרון', minutes: 40, kind: 'recall' }, { title: 'למד', minutes: 25, kind: 'magic', why: 'א' }, { title: '', minutes: 5 }, { title: 'תרגל', minutes: 20, kind: 'practice' }];
  const clean = app.BlockCleanSteps(raw, { minutes: 60 });
  check('an AI plan is cleaned: a small first step, an unknown kind fixed, and the total is exactly the block', clean.length === 3 && clean[0].minutes <= 10 && clean[1].kind === 'learn' && sum(clean) === 60);
  const short = app.BlockCleanSteps([{ title: 'א', minutes: 5, kind: 'recall' }, { title: 'ב', minutes: 10, kind: 'learn' }], { minutes: 60 });
  check('a plan that is too short gets the missing minutes in its longest step', sum(short) === 60 && short[1].minutes === 55);
  const long = app.BlockCleanSteps(Array.from({ length: 5 }, (_, i) => ({ title: 'צעד ' + i, minutes: 30, kind: 'learn' })), { minutes: 60 });
  check('a plan that is too long is shortened to the block', sum(long) <= 60 && long.length >= 2 && long.every(s => s.minutes >= 2));
  check('an answer that is not a list of steps is not used', app.BlockCleanSteps(null, { minutes: 60 }) === null && app.BlockCleanSteps('x', { minutes: 60 }) === null && app.BlockCleanSteps([{ title: 'אחד' }], { minutes: 60 }) === null);

  // The whole request, with the AI stubbed.
  const sent = [], realSend = app.Send, realCtx = app.CoachContext, realPrompt = app.CoachPrompt;
  app.Send = (m) => sent.push(m);
  const ask = async (extra) => { sent.length = 0; await app.BlockHelp(Object.assign({ requestId: 'q', title: 'ללמוד שפת C', minutes: 60 }, extra)); return sent.find(m => m.type === 'blockResult'); };
  let seen = null;
  app.HelperOrder = () => ['gemini'];
  app.HelperAsk = async (system, messages) => { seen = { system, user: messages[0][1] }; return { Error: false, Text: '```json\n{"steps":[{"title":"שלוף מהזיכרון","minutes":5,"kind":"recall"},{"title":"למד מצביעים","minutes":40,"kind":"learn"},{"title":"סכם","minutes":15,"kind":"review"}]}\n```' }; };
  let res = await ask({ note: 'מצביעים' });
  check('with an AI the plan comes from its answer, made from the title, the length and the note', res.source === 'ai' && res.steps.length === 3 && sum(res.steps) === 60 && seen.user.includes('שפת C') && seen.user.includes('60') && seen.user.includes('מצביעים') && seen.system.includes('JSON'));
  check('a block that is not a course sends no course data', !seen.user.includes('נתוני הקורס'));
  app.CoachContext = () => ({ course: 'x' }); app.CoachPrompt = () => 'DATA-OF-THE-COURSE';
  await ask({ title: 'אלגברה', course: 'אלגברה לינארית 2' });
  check('a block of one of the courses sends the data of that course', seen.user.includes('DATA-OF-THE-COURSE'));
  app.CoachContext = () => { throw new Error('no folder'); };
  res = await ask({ title: 'אלגברה', course: 'קורס שאין' });
  check('a course that cannot be read does not stop the plan', res.source === 'ai' && res.steps.length === 3 && !seen.user.includes('DATA-OF-THE-COURSE'));
  app.CoachContext = realCtx; app.CoachPrompt = realPrompt;
  app.HelperAsk = async () => ({ Error: true, Text: 'limit', Limit: true });
  res = await ask();
  check('when the AI fails the plan is made by rules and still fills the block', res.source === 'rules' && sound(res.steps, 60));
  app.HelperAsk = async () => ({ Error: false, Text: 'אין לי מה להגיד' });
  res = await ask({ minutes: 45 });
  check('an answer that is not JSON is not an error, the rules take over', res.source === 'rules' && sound(res.steps, 45));
  let called = 0;
  app.HelperOrder = () => []; app.HelperAsk = async () => { called++; return { Error: true }; };
  res = await ask();
  check('with no AI connected there is no call, and still a plan', called === 0 && res.source === 'rules' && res.steps.length >= 3);
  app.HelperOrder = () => ['gemini'];
  app.HelperAsk = async () => { await new Promise(r => setTimeout(r, 80)); return { Error: true }; };
  sent.length = 0;
  await Promise.all([app.BlockHelp({ requestId: 'a', title: 'ללמוד C', minutes: 60 }), app.BlockHelp({ requestId: 'b', title: 'ללמוד C', minutes: 60 })]);
  check('one request at a time', sent.find(m => m.requestId === 'b').error === true && sent.find(m => m.requestId === 'a').steps.length >= 3);
  res = await ask({ title: '  ' });
  check('a block without a name is refused with a clear message', res.error === true && !app.blockBusy);
  delete app.HelperOrder; delete app.HelperAsk; app.Send = realSend;
}

// A fake Google (sign-in and Drive) on 127.0.0.1: the tests never reach the real one.
function fakeGoogle() {
  const crypto = require('crypto');
  const g = { files: new Map(), n: 0, revoked: [], tokens: new Set(), refresh: 'rt-1', challenge: '', fail401: 0, uploads: { multipart: 0, resumable: 0 }, resumable: new Map() };
  const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
  const make = (meta, content) => { const id = 'f' + (++g.n); g.files.set(id, { id, name: meta.name, mimeType: meta.mimeType || 'application/octet-stream', parents: meta.parents || [], appProperties: meta.appProperties || {}, trashed: false, content: content || null }); return g.files.get(id); };
  const out = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, md5Checksum: f.content ? md5(f.content) : undefined, size: f.content ? String(f.content.length) : undefined });
  const multipart = (buf, type) => {
    const boundary = /boundary=([^;]+)/.exec(type)[1], s = buf.toString('latin1'), parts = s.split('--' + boundary).slice(1, -1);
    const body = (p) => { const i = p.indexOf('\r\n\r\n'); return p.slice(i + 4, p.length - 2); };
    return { meta: JSON.parse(Buffer.from(body(parts[0]), 'latin1').toString('utf8')), content: Buffer.from(body(parts[1]), 'latin1') };
  };
  g.server = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      const buf = Buffer.concat(chunks), u = new URL(req.url, 'http://x'), json = (code, o, headers) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json' }, headers || {})); res.end(JSON.stringify(o)); };
      if (u.pathname === '/token') {
        const f = new URLSearchParams(buf.toString());
        if (f.get('grant_type') === 'authorization_code') {
          const ok = f.get('code') === 'good-code' && f.get('client_secret') === 'test-secret' && crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') === g.challenge;
          if (!ok) return json(400, { error: 'invalid_grant' });
          const t = 'at-' + (++g.n); g.tokens.add(t);
          const idt = 'x.' + Buffer.from(JSON.stringify({ email: 'student@gmail.com' })).toString('base64url') + '.y';
          return json(200, { access_token: t, expires_in: 3600, refresh_token: g.refresh, id_token: idt });
        }
        if (f.get('grant_type') === 'refresh_token') {
          if (f.get('refresh_token') !== g.refresh || g.revoked.includes(f.get('refresh_token'))) return json(400, { error: 'invalid_grant' });
          const t = 'at-' + (++g.n); g.tokens.add(t); return json(200, { access_token: t, expires_in: 3600 });
        }
        return json(400, { error: 'unsupported' });
      }
      if (u.pathname === '/revoke') { g.revoked.push(u.searchParams.get('token')); return json(200, {}); }
      const auth = (req.headers.authorization || '').replace('Bearer ', '');
      if (!g.tokens.has(auth)) return json(401, { error: 'auth' });
      if (g.fail401 > 0) { g.fail401--; g.tokens.delete(auth); return json(401, { error: 'expired' }); }
      if (u.pathname.startsWith('/resumable/')) {
        const r = g.resumable.get(u.pathname.slice(11)); if (!r) return json(404, {});
        const f = r.id ? g.files.get(r.id) : make(r.meta, null); f.content = buf; g.uploads.resumable++; return json(200, out(f));
      }
      const up = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(u.pathname);
      if (up) {
        if (u.searchParams.get('uploadType') === 'resumable') { const k = 'r' + (++g.n); g.resumable.set(k, { id: up[1], meta: JSON.parse(buf.toString() || '{}') }); res.writeHead(200, { location: 'http://127.0.0.1:' + g.server.address().port + '/resumable/' + k }); return res.end(); }
        const mp = multipart(buf, req.headers['content-type']); g.uploads.multipart++;
        const f = up[1] ? g.files.get(up[1]) : make(mp.meta, null); f.content = mp.content; return json(200, out(f));
      }
      const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
      if (one) {
        const f = g.files.get(decodeURIComponent(one[1])); if (!f) return json(404, {});
        if (req.method === 'PATCH') { Object.assign(f, JSON.parse(buf.toString() || '{}')); return json(200, { id: f.id }); }
        if (u.searchParams.get('alt') === 'media') { res.writeHead(200); return res.end(f.content); }
        return json(200, out(f));
      }
      if (u.pathname === '/drive/v3/files') {
        if (req.method === 'POST') { const f = make(JSON.parse(buf.toString()), null); return json(200, { id: f.id }); }
        const q = u.searchParams.get('q') || '', rootQ = q.includes('sumitRoot');
        const list = Array.from(g.files.values()).filter(f => !f.trashed && (rootQ ? f.appProperties.sumitRoot === '1' : f.appProperties.sumit === '1'));
        return json(200, { files: list.map(out) });
      }
      json(404, { error: 'unknown ' + u.pathname });
    });
  });
  return g;
}

async function runDriveTests(app, root, check) {
  const D = require('../lib/modules/drive-sync');
  // The rules of a sync, without Drive.
  const P = (local, remote, base) => Object.fromEntries(D.SyncPlan(local, remote, base).map(p => [p.rel, p.act]));
  const x = { md5: 'x' }, y = { md5: 'y' }, z = { md5: 'z' };
  const plan = P({ same: x, mine: y, theirs: x, both: y, newHere: x, goneThere: x, changedAfterGone: y }, { same: x, mine: x, theirs: y, both: z, newThere: x, goneHere: x, changedThere: y }, { mine: x, theirs: x, both: x, goneThere: x, goneHere: x, changedAfterGone: x, changedThere: x, gone: x });
  check('a sync moves only what changed, and on the side that changed', plan.same === 'same' && plan.mine === 'upload' && plan.theirs === 'download' && plan.newHere === 'upload' && plan.newThere === 'download');
  check('a file changed on both sides keeps both, and so does one both computers had before they were joined', plan.both === 'conflict' && P({ a: x }, { a: y }, {}).a === 'conflict');
  check('a delete on one side goes to the other only when the file did not change there', plan.goneThere === 'deleteLocal' && plan.goneHere === 'deleteRemote' && plan.changedAfterGone === 'upload' && plan.changedThere === 'download' && plan.gone === 'forget');
  check('the other version of a file has the date in its name', D.ConflictName('קורסים/א/סיכום.html', new Date(2026, 10, 13, 9, 5)) === 'קורסים/א/סיכום (מ-Drive 13.11 09-05).html');
  const ss = D.SyncableSettings({ helperPref: 'openai', theme: 'dark', geminiKey: 'SECRET', claudeKey: 'S2', studyRoot: '/x', recordingsDir: '/y', drive: { refresh: 'r' }, calSync: { on: 1 }, order: ['a', 'b'], deep: { a: 1 } });
  check('the settings that travel are the student\'s choices: no keys, folders, account or objects', JSON.stringify(ss) === JSON.stringify({ helperPref: 'openai', theme: 'dark', order: ['a', 'b'] }));

  const tl = D.SyncableSettings({ tasks: [{ id: 'a', title: 'להגיש', due: '2099-01-01', done: false, deep: { x: 1 } }, 'junk'], calendars: [{ url: 'https://secret' }] });
  check('the student\'s own tasks travel with the settings, other lists of records do not', JSON.stringify(tl) === JSON.stringify({ tasks: [{ id: 'a', title: 'להגיש', due: '2099-01-01', done: false }] }));
  const tok = (o) => 'h.' + Buffer.from(JSON.stringify(o)).toString('base64') + '.s';
  check('the name and the picture of the account are read from Google\'s answer', JSON.stringify(D.IdTokenProfile(tok({ email: 'a@b.c', name: 'נועה לוי', given_name: 'נועה', picture: 'https://lh3/p=s96-c' }))) === JSON.stringify({ email: 'a@b.c', name: 'נועה', picture: 'https://lh3/p=s96-c' }) && D.IdTokenProfile('broken').email === '');
  {
    // The first sign-in fills an empty profile from Google, and never replaces what the student set.
    const pdir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sumit-photo-'));
    const keep = { name: app.settings.displayName, pf: app.profileImageFile, bytes: app.SetProfileImageBytes, send: app.SendSettings, fetch: global.fetch };
    const asked = []; global.fetch = async (u) => { asked.push(u); return { ok: true, arrayBuffer: async () => Buffer.from('JPEGDATA') }; };
    app.SetProfileImageBytes = (buf) => fs.writeFileSync(app.ProfileImageFile, buf); app.SendSettings = () => { };
    app.profileImageFile = path.join(pdir, 'A.jpg'); app.settings.displayName = '';
    await app.DriveFillProfile({ name: 'נועה', picture: 'https://lh3.googleusercontent.com/a/x=s96-c' });
    check('an empty profile gets the name and a bigger copy of the picture of the Google account', app.settings.displayName === 'נועה' && readText(app.ProfileImageFile) === 'JPEGDATA' && asked[0].endsWith('=s256-c'));
    app.settings.displayName = 'השם שלי'; fs.writeFileSync(app.ProfileImageFile, 'MINE');
    await app.DriveFillProfile({ name: 'נועה', picture: 'https://lh3.googleusercontent.com/a/x=s96-c' });
    check('a name and a picture the student set are kept', app.settings.displayName === 'השם שלי' && readText(app.ProfileImageFile) === 'MINE' && asked.length === 1);

    // The picture and the tasks reach another computer with the settings.
    const RA = path.join(pdir, 'rootA'), RB = path.join(pdir, 'rootB'); mkdirp(RA); mkdirp(RB);
    const keepDrive = app.settings.drive, keepTasks = app.settings.tasks, keepPhoto = app.settings.photo;
    app.settings.drive = {}; app.settings.tasks = [{ id: 't1', title: 'להגיש תרגיל', course: '', due: '2099-01-03', done: false }];
    app.DriveSettingsOut(RA);
    check('the picture is put next to the settings, and the settings name it by its md5', readText(path.join(RA, '.sumit', 'profile.jpg')) === 'MINE' && JSON.parse(readText(path.join(RA, '.sumit', 'settings-sync.json'))).settings.photo === crypto.createHash('md5').update('MINE').digest('hex'));
    fs.cpSync(path.join(RA, '.sumit'), path.join(RB, '.sumit'), { recursive: true });   // what the sync carries to the other computer
    app.profileImageFile = path.join(pdir, 'B.jpg'); app.settings.drive = {}; app.settings.tasks = []; app.settings.displayName = '';
    const took = app.DriveSettingsIn(RB);
    check('another computer takes the name, the picture and the tasks', took && app.settings.displayName === 'השם שלי' && readText(app.ProfileImageFile) === 'MINE' && app.settings.tasks.length === 1 && app.settings.tasks[0].title === 'להגיש תרגיל');
    app.profileImageFile = path.join(pdir, 'A.jpg'); fs.unlinkSync(app.ProfileImageFile); app.settings.drive = { settingsSig: 'old', settingsApplied: '9999' };
    app.DriveSettingsOut(RA); fs.rmSync(path.join(RB, '.sumit'), { recursive: true }); fs.cpSync(path.join(RA, '.sumit'), path.join(RB, '.sumit'), { recursive: true });
    app.profileImageFile = path.join(pdir, 'B.jpg'); app.settings.drive = { settingsApplied: '' };
    app.DriveSettingsIn(RB);
    check('a picture removed on one computer is removed on the other', !fileExists(path.join(RA, '.sumit', 'profile.jpg')) && !fileExists(app.ProfileImageFile));
    app.settings.drive = keepDrive; app.settings.tasks = keepTasks; app.settings.photo = keepPhoto;
    app.settings.displayName = keep.name; app.profileImageFile = keep.pf; app.SetProfileImageBytes = keep.bytes; app.SendSettings = keep.send; global.fetch = keep.fetch;
    try { fs.rmSync(pdir, { recursive: true, force: true }); } catch { }
  }

  const downloaded = JSON.stringify({ installed: { client_id: 'id.apps.googleusercontent.com', client_secret: 'GOCSPX-abc', redirect_uris: ['http://localhost'] } });
  check('the client secret is sent bare, also when the whole downloaded client JSON was stored', D.ClientSecret(downloaded) === 'GOCSPX-abc' && D.ClientSecret(' GOCSPX-abc\n') === 'GOCSPX-abc' && D.ClientSecret('{oops') === '' && D.ClientSecret('') === '');

  // Two computers, one Google account, through the fake Google.
  const g = fakeGoogle();
  await new Promise(r => g.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + g.server.address().port;
  const env = { SUMIT_DRIVE_API: base, SUMIT_GOOGLE_TOKEN_URL: base + '/token', SUMIT_GOOGLE_REVOKE_URL: base + '/revoke', SUMIT_GOOGLE_AUTH_URL: base + '/auth', SUMIT_GOOGLE_CLIENT_ID: 'test-client', SUMIT_GOOGLE_CLIENT_SECRET: 'test-secret' };
  const savedEnv = {}; for (const k of Object.keys(env)) { savedEnv[k] = process.env[k]; process.env[k] = env[k]; }
  const saved = { study: app.settings.studyRoot, rec: app.settings.recordingsDir, drive: app.settings.drive, send: app.Send, helper: app.settings.helperPref, gkey: app.settings.geminiKey };
  const sent = []; app.Send = (m) => sent.push(m); app.driveFast = true;
  const old = Date.now() / 1000 - 3600;
  const put = (dir, rel, content) => { const f = path.join(dir, ...rel.split('/')); mkdirp(path.dirname(f)); fs.writeFileSync(f, content); fs.utimesSync(f, old, old); return f; };
  const A = path.join(root, 'drive-A'), B = path.join(root, 'drive-B');
  const useA = () => { app.settings.studyRoot = path.join(A, 'קורסים'); app.settings.recordingsDir = path.join(A, 'הקלטות'); app.driveStateFile = path.join(root, 'drive-state-A.json'); app.driveAccess = null; };
  const useB = () => { app.settings.studyRoot = path.join(B, 'קורסים'); app.settings.recordingsDir = path.join(B, 'הקלטות'); app.driveStateFile = path.join(root, 'drive-state-B.json'); app.driveAccess = null; };
  const trashed = []; app.driveTrash = async (f) => { trashed.push(f); fs.rmSync(f, { force: true }); };
  try {
    useA();
    put(A, 'קורסים/מבני נתונים/הרצאות/הרצאה 1/סיכום.html', '<h1>סיכום 1</h1>');
    put(A, 'קורסים/מבני נתונים/הרצאות/הרצאה 1/.sumit-math/katex.min.js', 'copy');
    put(A, 'קורסים/מבני נתונים/.DS_Store', 'x');
    put(A, 'הקלטות/שיעור 1.mp4', 'video');
    put(A, 'פרופיל/profile.json', '{"streak":1}');
    const big = crypto.randomBytes(6 * 1024 * 1024); put(A, 'קורסים/מבני נתונים/הרצאות/הרצאה 1/הרצאה.pdf', big);
    delete app.settings.drive;
    app.settings.helperPref = 'openai'; app.settings.geminiKey = 'SECRET-KEY';

    // Signing in: PKCE, only drive.file, the answer on 127.0.0.1, and a stranger's answer is ignored.
    let authUrl = null;
    const email = await app.DriveConnect(async (url) => {
      authUrl = new URL(url); g.challenge = authUrl.searchParams.get('code_challenge');
      const redirect = authUrl.searchParams.get('redirect_uri');
      await fetch(redirect + '/?code=evil&state=wrong').catch(() => { });
      await fetch(redirect + '/?code=good-code&state=' + authUrl.searchParams.get('state'));
    });
    check('signing in asks for drive.file only (and the name and picture of the account), with PKCE, offline access and a redirect to this computer',
      authUrl.searchParams.get('scope') === 'https://www.googleapis.com/auth/drive.file openid email profile' && authUrl.searchParams.get('code_challenge_method') === 'S256'
        && authUrl.searchParams.get('access_type') === 'offline' && /^http:\/\/127\.0\.0\.1:\d+$/.test(authUrl.searchParams.get('redirect_uri')) && authUrl.searchParams.get('client_id') === 'test-client');
    check('the account is connected, and its token is kept encrypted', email === 'student@gmail.com' && app.DriveConnected() && app.settings.drive.refresh !== 'rt-1' && Unprotect(app.settings.drive.refresh) === 'rt-1');

    const c1 = await app.DriveSync();
    const remoteNames = Array.from(g.files.values()).map(f => f.name);
    check('the first sync uploads the study folder into a "SumIT" folder of Drive', c1.up === 4 && remoteNames.includes('SumIT') && remoteNames.includes('סיכום.html') && remoteNames.includes('profile.json') && remoteNames.includes('settings-sync.json'));
    check('copies made again by the app, system files and the recordings stay on the computer', !remoteNames.includes('katex.min.js') && !remoteNames.includes('.DS_Store') && !remoteNames.includes('שיעור 1.mp4'));
    check('a big file goes up in a resumable upload, small ones in one request', g.uploads.resumable === 1 && g.uploads.multipart === 3);
    const settingsFile = Array.from(g.files.values()).find(f => f.name === 'settings-sync.json');
    check('the settings in Drive carry the choices but never the keys', /openai/.test(settingsFile.content.toString()) && !/SECRET-KEY/.test(settingsFile.content.toString()));
    const c2 = await app.DriveSync();
    check('a second sync with nothing changed moves nothing', c2.up === 0 && c2.down === 0 && c2.same === 4);

    // The second computer: it had its own copy of one summary, and different settings.
    useB();
    put(B, 'קורסים/מבני נתונים/הרצאות/הרצאה 1/סיכום.html', '<h1>סיכום 1 עם הערות שלי</h1>');
    app.settings.helperPref = 'gemini'; app.settings.geminiKey = 'OTHER-KEY'; app.settings.drive.settingsSig = ''; app.settings.drive.settingsApplied = '';
    fs.rmSync(path.join(B, '.sumit'), { recursive: true, force: true });
    const c3 = await app.DriveSync();
    const conflictCopy = fs.readdirSync(path.join(B, 'קורסים', 'מבני נתונים', 'הרצאות', 'הרצאה 1')).find(n => n.includes('מ-Drive'));
    check('another computer gets everything, and a file it already had differently keeps both versions',
      c3.down >= 2 && c3.conflicts === 1 && fileExists(path.join(B, 'פרופיל', 'profile.json')) && fs.readFileSync(path.join(B, 'קורסים', 'מבני נתונים', 'הרצאות', 'הרצאה 1', 'הרצאה.pdf')).equals(big)
        && !!conflictCopy && readText(path.join(B, 'קורסים', 'מבני נתונים', 'הרצאות', 'הרצאה 1', conflictCopy)) === '<h1>סיכום 1</h1>' && app.settings.drive.conflicts.length === 1);
    check('the settings of the first computer arrive, and this computer keeps its own key', app.settings.helperPref === 'openai' && app.settings.geminiKey === 'OTHER-KEY');

    // A change on one computer reaches the other; a delete goes to the Trash there.
    put(B, 'קורסים/מבני נתונים/הרצאות/הרצאה 2/סיכום.html', '<h1>סיכום 2</h1>');
    await app.DriveSync();
    useA();
    const c4 = await app.DriveSync();
    check('what the second computer added comes down to the first', fileExists(path.join(A, 'קורסים', 'מבני נתונים', 'הרצאות', 'הרצאה 2', 'סיכום.html')) && c4.down >= 2
      && readText(path.join(A, 'קורסים', 'מבני נתונים', 'הרצאות', 'הרצאה 1', 'סיכום.html')) === '<h1>סיכום 1 עם הערות שלי</h1>');
    fs.rmSync(path.join(A, 'קורסים', 'מבני נתונים', 'הרצאות', 'הרצאה 2', 'סיכום.html'));
    const c5 = await app.DriveSync();
    useB();
    const c6 = await app.DriveSync();
    check('a file deleted on one computer goes to Drive\'s trash and to the Trash of the other', c5.deleted === 1 && c6.deleted === 1 && trashed.some(f => f.endsWith(path.join('הרצאה 2', 'סיכום.html')))
      && Array.from(g.files.values()).some(f => f.trashed && f.name === 'סיכום.html'));

    // Many deletes at once (a wrong folder, say) stop the sync until the student says yes.
    useA();
    for (let i = 0; i < 30; i++) put(A, 'קורסים/תרגילים/ת' + i + '.txt', 'תרגיל ' + i);
    await app.DriveSync();
    fs.rmSync(path.join(A, 'קורסים', 'תרגילים'), { recursive: true, force: true });
    let stopped = null; try { await app.DriveSync(); } catch (ex) { stopped = ex; }
    check('a sync that would delete many files at once stops and asks', stopped && stopped.massDelete === 30 && Array.from(g.files.values()).filter(f => /^ת\d+\.txt$/.test(f.name) && !f.trashed).length === 30);
    const c7 = await app.DriveSync({ allowDeletes: true });
    check('after the student says yes, it goes on', c7.deleted === 30);
    useB();
    let stoppedB = null; try { await app.DriveSync(); } catch (ex) { stoppedB = ex; }
    check('the other computer is not asked about files it never had', !stoppedB);

    // A token that ran out is renewed by itself; one taken back in the Google account disconnects this computer.
    g.fail401 = 1; useA();
    const c8 = await app.DriveSync();
    check('an expired access token is renewed without the student', c8 && c8.failed === undefined);
    sent.length = 0;
    await app.DriveHandle({ action: 'state' });
    check('the settings card gets the account and the last sync', sent[0].type === 'driveSync' && sent[0].connected && sent[0].configured && sent[0].email === 'student@gmail.com' && !!sent[0].last);
    await app.DriveDisconnect();
    check('disconnecting takes the permission back from Google and forgets it here, and the files stay', g.revoked.includes('rt-1') && !app.DriveConnected() && !fileExists(app.driveStateFile) && fileExists(path.join(A, 'פרופיל', 'profile.json')));
    app.settings.drive = { refresh: Protect('rt-1'), email: 'x' }; app.driveAccess = null;
    let gone = null; try { await app.DriveSync(); } catch (ex) { gone = ex; }
    check('a permission taken back in the Google account disconnects this computer and says so', gone && /פגה/.test(gone.message) && !app.DriveConnected());
  } finally {
    g.server.close();
    for (const k of Object.keys(env)) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
    app.settings.studyRoot = saved.study; app.settings.recordingsDir = saved.rec; app.Send = saved.send; app.settings.helperPref = saved.helper; app.settings.geminiKey = saved.gkey;
    if (saved.drive === undefined) delete app.settings.drive; else app.settings.drive = saved.drive;
    delete app.driveStateFile; delete app.driveTrash; delete app.driveAccess; delete app.driveFast;
  }
}

async function runVisualTests(app, root, check) {
  const V = require(path.join(platform.WebDir, 'viz-runtime.js'));
  const val = (src, scope, vars) => V.compile(src, vars || Object.keys(scope || {}))(scope || {});
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };

  // Expressions: parsed, never eval'd.
  check('an expression keeps the order of operations, powers to the right and a minus before a power',
    val('1+2*3^2') === 19 && val('2^3^2') === 512 && val('-x^2', { x: 3 }) === -9 && val('2^-1') === 0.5);
  check('an expression takes 2x, 3(x+1), functions, pi and a parameter',
    val('2x', { x: 4 }) === 8 && val('3(x+1)', { x: 1 }) === 6 && Math.abs(val('sin(pi/2)+a*cos(0)', { a: 2 }) - 3) < 1e-12 && val('max(1,x,3)', { x: 7 }) === 7);
  check('an expression with an unknown name, code or a stray sign is refused',
    throws(() => V.compile('constructor', ['x'])) && throws(() => V.compile('alert(1)', ['x'])) && throws(() => V.compile('x;fetch(1)', ['x']))
      && throws(() => V.compile('y', ['x'])) && throws(() => V.compile('(x', ['x'])) && throws(() => V.compile('x'.repeat(300), ['x'])) && throws(() => V.compile('', ['x'])));

  // The spec.
  check('a spec with a broken expression is refused before it is drawn', throws(() => V.normalize({ kind: 'plot', curves: [{ expr: 'a*sin(x)' }, { expr: 'bad(' }] })));
  const plotOk = V.normalize({ kind: 'plot', x: [0, 10], curves: [{ expr: 'a*sin(x)', label: 'y' }], points: [{ x: 'pi', y: 'a', label: 'P' }, { x: 'q', y: 1 }],
    params: [{ name: 'a', min: 0, max: 5, value: 9 }, { name: 'x', min: 0, max: 1 }, { name: 'sin', min: 0, max: 1 }, { name: 'b', min: 3, max: 1 }, { name: 'a', min: 0, max: 1 }],
    steps: [{ text: 'שלב', show: [0, 1, 7, -1, 1.5], set: { a: 99, zz: 1 } }, { text: '' }] });
  check('parameters: a variable, a function, a duplicate or an empty range is dropped, and a value is kept in its range',
    plotOk.params.length === 1 && plotOk.params[0].name === 'a' && plotOk.params[0].value === 5 && plotOk.points.length === 1);
  check('steps: only items that exist, and a parameter set within its range',
    plotOk.steps.length === 1 && JSON.stringify(plotOk.steps[0].show) === '[0,1]' && plotOk.steps[0].set.a === 5 && !('zz' in plotOk.steps[0].set));
  check('an unknown kind or an empty answer is refused', throws(() => V.normalize({ kind: 'script' })) && throws(() => V.normalize(null)));
  const circ = V.normalize({ kind: 'circuit', parts: [{ type: 'R', a: [0, 0], b: [2, 0], label: 'R={R}' }, { type: 'X', a: [0, 0], b: [1, 1] }, { type: 'W', a: [1, 1], b: [1, 1] }, { type: 'C', a: [0, 0], b: [99, 0] }, { type: 'G', a: [2, 0] }], params: [{ name: 'R', min: 1, max: 100, value: 10 }] });
  check('a circuit keeps only known parts on the grid with two different ends (ground has one)', circ.parts.length === 2 && circ.parts[1].type === 'G' && circ.parts[1].b === null);
  const mesh = V.normalize({ kind: 'circuit', style: 'board', parts: [{ type: 'B', a: [0, 6], b: [0, 3], label: '17V', color: 'cyan' }, { type: 'R', a: [0, 0], b: [0, 3], color: 'hotpink' }],
    loops: [{ box: [0, 0, 3, 6], label: 'I_1', dir: 'cw', color: 'blue' }, { box: [3, 3, 1, 1] }, { box: [3, 0, 6, 3] }],
    equations: ['12 I_1 - 3 I_2 = 17', '<script>x</script>'], steps: [{ text: 'לולאה', loops: [0, 5], eq: 9 }, { text: 'הכל' }] });
  check('the board style: a battery, a named color only, loops on the grid and equations as plain math text',
    mesh.style === 'board' && mesh.parts[0].type === 'B' && mesh.parts[0].color === 'cyan' && mesh.parts[1].color === '' && mesh.loops.length === 2 && mesh.loops[0].dir === 'cw'
      && mesh.loops[1].label === 'I_2' && mesh.loops[1].dir === 'ccw' && mesh.equations.length === 1);
  check('a step highlights only loops that exist and shows at most the equations there are',
    JSON.stringify(mesh.steps[0].loops) === '[0]' && mesh.steps[0].eq === 1 && mesh.steps[1].loops === null && mesh.steps[1].eq === null && V.normalize({ kind: 'plot', style: 'neon', curves: [{ expr: 'x' }] }).style === '');
  check('the board frame says so on its <html>', /<html[^>]*data-style="board"/.test(app.VisualSrcdoc(mesh)) && !/<html[^>]*data-style/.test(app.VisualSrcdoc(circ)));
  check('a circuit with no usable part is refused', throws(() => V.normalize({ kind: 'circuit', parts: [{ type: 'X', a: [0, 0], b: [1, 0] }] })));
  const f3 = V.normalize({ kind: 'field3d', range: 500, n: 20, field: ['-y', 'x', '0'], points: [{ x: 0, y: 0, z: 1, label: 'q' }] });
  check('a 3D field: the range and the grid are capped, and it needs a field, a curve or a surface',
    f3.range === 100 && f3.n === 7 && f3.field.length === 3 && throws(() => V.normalize({ kind: 'field3d' })) && throws(() => V.normalize({ kind: 'field3d', field: ['x', 'q', '0'] })));
  check('a wave adds the sum only with two waves or more',
    V.normalize({ kind: 'wave', curves: [{ expr: 'sin(x-t)' }], sum: true }).sum === false && V.normalize({ kind: 'wave', waves: [{ expr: 'sin(x-t)' }, { expr: 'sin(x+t)' }], sum: true }).sum === true);

  // The custom kind: small, and nothing that reaches the network or the page around it.
  check('a custom visual passes when it is small and stays in its frame', V.normalize({ kind: 'custom', html: '<svg width="10"></svg><script>let a=1</script>' }).html.includes('<svg'));
  check('a custom visual that is too big, or reaches the network or the page, is refused',
    throws(() => V.normalize({ kind: 'custom', html: 'x'.repeat(V.MaxCustom + 1) })) && throws(() => V.normalize({ kind: 'custom', html: '<script>fetch("https://e.x")</script>' }))
      && throws(() => V.normalize({ kind: 'custom', html: '<img src="https://e.x/a.png">' })) && throws(() => V.normalize({ kind: 'custom', html: '<script>parent.document.body</script>' }))
      && throws(() => V.normalize({ kind: 'custom', html: '<iframe></iframe>' })) && throws(() => V.normalize({ kind: 'custom', html: '<script>new WebSocket("x")</script>' })));

  // The AI's answer and the frame.
  check('the answer is read from inside a code fence', app.ParseVisual('הנה:\n```json\n{"kind":"plot","curves":[{"expr":"x^2"}]}\n```').spec.curves[0].expr === 'x^2');
  check('an answer that is not JSON, or does not pass, says why', app.ParseVisual('אין לי מושג').error === 'התשובה אינה JSON' && /סוג המחשה/.test(app.ParseVisual('{"kind":"nope"}').error));
  const evil = V.normalize({ kind: 'plot', title: '</script><script>alert(1)</script>', curves: [{ expr: 'x', label: '<!--' }] });
  const doc = app.VisualSrcdoc(evil);
  check('the frame has no network and nothing else outside it',
    doc.includes("connect-src 'none'") && doc.includes("default-src 'none'") && doc.includes("frame-src 'none'") && doc.includes('data-theme="light"'));
  check('text from the AI cannot close the frame\'s script', (doc.match(/<\/script>/gi) || []).length === 2 && !doc.includes('<script>alert(1)') && doc.includes('SumitViz.mount'));
  check('the renderer itself never closes its script early', !fs.readFileSync(path.join(platform.WebDir, 'viz-runtime.js'), 'utf8').match(/<\/script/i));
  const customDoc = app.VisualSrcdoc(V.normalize({ kind: 'custom', title: '<b>ש</b>', html: '<p>hi</p>' }));
  check('a custom frame gets only its own HTML, with its title escaped', customDoc.includes('<p>hi</p>') && customDoc.includes('&lt;b&gt;') && !customDoc.includes('SumitViz.mount'));

  // The request from the summary page.
  const saved = { root: app.settings.studyRoot, demo: app.demo, ask: app.SummaryGemini, site: app.site };
  app.settings.studyRoot = path.join(root, 'viz-courses');
  const pageFile = path.join(app.settings.studyRoot, 'פיזיקה 1', 'הרצאות', 'הרצאה 3', 'סיכום.html');
  mkdirp(path.dirname(pageFile)); writeText(pageFile, '<html><body>סוד-של-הסיכום</body></html>');
  const sent = [], scripts = [];
  app.site = { source: require('url').pathToFileURL(pageFile).href, wc: { isDestroyed: () => false, send: (ch, msg) => sent.push(msg) }, executeScript: async (js) => { scripts.push(js); } };
  app.demo = false;
  try {
    await app.InjectVisualTools();
    check('a summary gets the button script with a fresh token', scripts.length === 1 && app.vizToken && scripts[0].includes(JSON.stringify(app.vizToken)) && scripts[0].includes('sumitVizLoaded'));
    const question = 'שאלה 2: מסה m=2 ק"ג תלויה על קפיץ עם קבוע k=8 ניוטון למטר. מצא את תדירות התנודה ושרטט את המיקום כפונקציה של הזמן.';
    const calls = [];
    const good = '{"kind":"plot","x":[0,10],"params":[{"name":"k","min":1,"max":20,"value":8}],"curves":[{"expr":"cos(sqrt(k/2)*x)","label":"x(t)"}]}';
    let answers = ['זה לא JSON', good];
    app.SummaryGemini = async (system, messages, img, extra, onChunk, opts) => { calls.push({ system, messages, opts }); return { Provider: 'gemini', Error: false, Text: answers.shift() }; };
    const token = app.vizToken;
    await app.VisualRequest({ type: 'vizRequest', token: 'wrong', id: 'v1', question });
    check('a request with another token does nothing', sent.length === 0 && calls.length === 0);
    await app.VisualRequest({ type: 'vizRequest', token, id: 'v1', question });
    check('a bad first answer is sent back once with the reason, and the fixed one is shown',
      calls.length === 2 && calls[1].messages.length === 3 && /לא עברה בדיקה/.test(calls[1].messages[2][1]) && sent.map(m => m.state).join(',') === 'busy,done' && sent[1].srcdoc.includes('SumitViz.mount') && sent[1].provider === 'Gemini');
    check('only the question goes to the AI, not the summary, with a short answer cap',
      calls[0].messages.length === 1 && calls[0].messages[0][1] === 'השאלה:\n' + question && !JSON.stringify(calls).includes('סוד-של-הסיכום') && calls[0].opts.maxTokens <= 1500);
    const cache = app.VisualCacheFile(pageFile, question);
    check('the visual is kept next to the summary', fileExists(cache) && JSON.parse(readText(cache)).spec.kind === 'plot');
    sent.length = 0;
    await app.VisualRequest({ type: 'vizRequest', token, id: 'v1', question });
    check('opening it again costs no AI call', calls.length === 2 && sent.length === 1 && sent[0].state === 'done' && sent[0].cached === true);
    sent.length = 0; answers = [good];
    await app.VisualRequest({ type: 'vizRequest', token, id: 'v1', question, force: true });
    check('"build again" asks the AI again', calls.length === 3 && sent.map(m => m.state).join(',') === 'busy,done' && !sent[1].cached);
    sent.length = 0; answers = ['{"kind":"nope"}', '{"kind":"nope"}'];
    await app.VisualRequest({ type: 'vizRequest', token, id: 'v2', question: question + ' (ב)' });
    check('two bad answers end in an error the student can retry', sent.map(m => m.state).join(',') === 'busy,error' && /אפשר לנסות שוב/.test(sent[1].text) && !fileExists(app.VisualCacheFile(pageFile, question + ' (ב)')));
    sent.length = 0;
    app.SummaryGemini = async () => ({ Provider: 'gemini', Error: true, Text: 'אין מנוע AI מחובר.' });
    await app.VisualRequest({ type: 'vizRequest', token, id: 'v3', question: question + ' (ג)' });
    check('no AI connected: the page says so', sent.map(m => m.state).join(',') === 'busy,error' && /אין מנוע/.test(sent[1].text));
    sent.length = 0;
    let release; app.SummaryGemini = () => new Promise((r) => { release = () => r({ Provider: 'gemini', Error: false, Text: good }); });
    const first = app.VisualRequest({ type: 'vizRequest', token, id: 'v4', question: question + ' (ד)' });
    await app.VisualRequest({ type: 'vizRequest', token, id: 'v5', question: question + ' (ה)' });
    release(); await first;
    check('one visual at a time: a second button waits for the first', sent.some(m => m.id === 'v5' && m.state === 'error' && /כבר בונה/.test(m.text)) && sent.some(m => m.id === 'v4' && m.state === 'done'));
    sent.length = 0;
    await app.VisualRequest({ type: 'vizRequest', token, id: 'v6', question: 'קצר' });
    await app.VisualRequest({ type: 'vizRequest', token, id: '../x', question });
    check('a question too short, or a bad button id, gets nothing from the AI', sent.length === 1 && sent[0].state === 'error');
    app.site.source = 'https://moodle.hitsmart.ac.il/course/view.php?id=1';
    scripts.length = 0; sent.length = 0;
    await app.InjectVisualTools();
    await app.VisualRequest({ type: 'vizRequest', token, id: 'v1', question });
    check('a web page in the site view gets no buttons, and an old token stops counting', scripts.length === 0 && app.vizToken === '' && sent.length === 0);
    app.site.source = require('url').pathToFileURL(path.join(root, 'outside.html')).href; writeText(path.join(root, 'outside.html'), 'x');
    await app.InjectVisualTools();
    check('an HTML file outside the study folder gets no buttons', scripts.length === 0 && app.vizToken === '');
    app.demo = true;
    check('the demo makes a visual without an AI', (await app.MakeVisual(question)).spec.kind === 'plot');
  } finally {
    app.settings.studyRoot = saved.root; app.demo = saved.demo; app.SummaryGemini = saved.ask; app.site = saved.site;
    delete app.vizToken; delete app.vizPage;
  }
}

async function runCoachTests(app, root, check) {
  const saved = { root: app.settings.studyRoot };
  app.settings.studyRoot = path.join(root, 'coach-courses');
  const T = '2026-11-10', course = 'אלגברה לינארית 2 - תשפז', other = 'פיזיקה סודית';
  const page = (c, n) => { app.SaveLecture(c, { num: n, title: 'הרצאה ' + n + ' ' + c }); const f = app.StudyPagePath(c, n); mkdirp(path.dirname(f)); writeText(f, '<html></html>'); return f; };
  // The course: lecture 1 (summary, a digest), lecture 2 (summary, 3 cards, 2 of them due), lecture 3 (no summary, homework due in two days).
  const p1 = page(course, 1), p2 = page(course, 2);
  app.SaveLecture(course, { num: 3, title: 'הרצאה 3', due: '2026-11-12' });
  mkdirp(path.join(app.CourseDir(course), '.sumit', 'digests'));
  writeText(path.join(app.CourseDir(course), '.sumit', 'digests', 'הרצאה 1.md'), 'מרחבים וקטוריים: בסיס וממד. '.repeat(30));
  const cards = [{ front: 'מהו בסיס?', back: 'ב' }, { front: 'מהו ממד?', back: 'מ' }, { front: 'מהי תלות לינארית?', back: 'ת' }];
  writeText(app.FlashcardsFile(p2), JSON.stringify({ summaryMtime: 1, cards }));
  writeText(app.ReviewsFile(p2), JSON.stringify({ [app.ReviewCardKey(cards[0].front)]: { interval: 3, ease: 2.5, reps: 2, lapses: 0, due: '2026-11-09' }, [app.ReviewCardKey(cards[1].front)]: { interval: 7, ease: 2.5, reps: 3, lapses: 0, due: '2026-12-30' } }));
  writeText(path.join(app.CourseDir(course), C.CourseJson), JSON.stringify({ grading: [{ component: 'מבחן', weight: 80 }, { component: 'תרגילים', weight: 20 }], examFormat: 'מבחן סגור, 3 שעות', homeworkRequired: false, importantDates: [{ date: '2026-12-01', what: 'בוחן' }], tips: ['לפתור מבחנים'] }));
  mkdirp(path.join(app.CourseDir(course), C.Exams)); writeText(path.join(app.CourseDir(course), C.Exams, 'מבחן 2023.pdf'), 'x'); writeText(path.join(app.CourseDir(course), C.Exams, 'פתרון 2023.pdf'), 'x');
  mkdirp(path.dirname(app.TimetableJson)); writeText(app.TimetableJson, JSON.stringify({ classes: [], exams: [{ course: 'אלגברה לינארית 2', moed: 'א', date: '2026-11-20', time: '09:00' }, { course: 'אלגברה לינארית 2', moed: 'ב', date: '2026-02-01' }] }));
  page(other, 1); app.SaveLecture(other, { num: 1, title: 'סוד-של-קורס-אחר' });

  const req = app.CoachRequest({ requestId: 'r1', course, reason: 'exam', minutes: 90, note: 'ה'.repeat(500), deadlines: [{ name: 'תרגיל 4', when: Date.parse('2026-11-12T12:00:00') / 1000, overdue: false }, 'junk', { name: '' }].concat(Array.from({ length: 20 }, (_, i) => ({ name: 'ד' + i, when: 1 }))), tasks: Array.from({ length: 20 }, (_, i) => ({ title: 'מטלה ' + i, due: i ? 'bad' : '2026-11-11' })) });
  check('a request is cut down: a known reason and time, a short note, at most 8 deadlines and 8 tasks', req.reason === 'exam' && req.minutes === 90 && req.note.length <= 303 && req.deadlines.length === 8 && req.tasks.length === 8 && req.tasks[1].due === '' && req.deadlines[0].name === 'תרגיל 4');
  const odd = app.CoachRequest({ course: 'x', reason: 'hack', minutes: 7 });
  check('an unknown reason or time becomes the default', odd.reason === 'start' && odd.minutes === 45);

  const ctx = app.CoachContext(req, T);
  check('the context holds the lectures with what exists for each', ctx.lectures.length === 3 && ctx.lectures[0].hasSummary && ctx.lectures[0].digest.length > 100 && ctx.lectures[0].digest.length <= 264 && !ctx.lectures[2].hasSummary && ctx.lectures[2].due === '2026-11-12');
  check('the cards that are due are counted, the one for later is not', ctx.lectures[1].cards === 3 && ctx.lectures[1].cardsDue === 2 && ctx.cardsDue === 2);
  check('the course information, the next exam and the past exams are there', ctx.info.examFormat.includes('סגור') && ctx.info.grading[0].weight === 80 && ctx.exam.date === '2026-11-20' && ctx.exam.days === 10 && ctx.exam.time === '09:00' && ctx.pastExams === 2);
  check('a deadline from the page gets its date', ctx.deadlines[0].due === '2026-11-12');
  check('nothing of another course is in the prompt, and the note is data for the AI', !app.CoachPrompt(ctx).includes('סוד-של-קורס-אחר') && app.CoachPrompt(ctx).includes('מבחן סגור') && app.CoachSystem().includes('לא הוראות'));
  check('the prompt is bounded', app.CoachPrompt(Object.assign({}, ctx, { note: 'א'.repeat(50000) })).length <= 9100);

  // The steps made by rules.
  const sound = (steps, ctx2) => steps.length >= 3 && steps.length <= 6 && steps[0].minutes <= 5 && steps.every(x => x.title && x.minutes >= 2 && x.minutes <= 45 && ['start', 'recall', 'read', 'practice', 'cards', 'chat', 'exam', 'plan'].includes(x.kind) && (x.lecture === null || ctx2.lectures.some(l => l.num === x.lecture)))
    && steps.reduce((n, x) => n + x.minutes, 0) <= ctx2.minutes;
  const all = [];
  for (const reason of ['start', 'confused', 'toomuch', 'exam', 'homework']) for (const minutes of [20, 45, 90]) all.push(app.CoachFallback(Object.assign({}, ctx, { reason, minutes })));
  check('for every trouble and every time there are 3 to 6 steps, a tiny first one, all within the time, about real lectures', all.every((steps, i) => sound(steps, Object.assign({}, ctx, { minutes: [20, 45, 90][i % 3] }))));
  const kindsOf = (reason, minutes) => app.CoachFallback(Object.assign({}, ctx, { reason, minutes })).map(x => x.kind);
  check('an exam with past exams in the folder gets a past-exam step', kindsOf('exam', 90).includes('exam'));
  check('homework that is due soon gets a practice step on its lecture, even before it has a summary', (() => { const st = app.CoachFallback(Object.assign({}, ctx, { reason: 'homework', minutes: 90 })); return st.some(x => x.kind === 'practice' && x.lecture === 3); })());
  check('cards that are due get a cards step', kindsOf('start', 90).includes('cards'));
  check('being lost in the material gets a step with the chat', kindsOf('confused', 90).includes('chat'));
  const withNote = (note, reason) => app.CoachFallback(Object.assign({}, ctx, { reason: reason || 'homework', minutes: 90, note }));
  const n2 = withNote('נתקעתי בתרגיל של הרצאה 2');
  check('a lecture named in the note is the one the steps are about, even when another has homework due', n2.some(x => x.lecture === 2) && !n2.some(x => x.kind === 'practice' && x.lecture === 3));
  check('the note is in the first step, in the student\'s words', withNote('לא מצליח למצוא בסיס למרחב')[0].title.includes('לא מצליח למצוא בסיס למרחב') && withNote('', 'homework')[0].title.includes('נתון'));
  check('without a note, or a note that matches nothing, the lectures chosen do not change', JSON.stringify(withNote('נתקעתי').map(x => x.lecture)) === JSON.stringify(withNote('').map(x => x.lecture)) && JSON.stringify(withNote('xyz qqq').map(x => x.lecture)) === JSON.stringify(withNote('').map(x => x.lecture)));
  check('the AI is told that the note is the main thing and not to pick a lecture because it is first', app.CoachSystem().includes('הערת הסטודנט היא הדבר החשוב') && app.CoachSystem().includes('ראשונה או אחרונה'));
  check('the AI prompts carry the study-coach principles: hints and not full solutions, burnout, rest, a weekly review', app.CoachSystem().includes('לעולם לא פתרון מלא') && app.CoachSystem().includes('שחיקה') && app.StrategySystem('math').includes('20 אחוז') && app.StrategySystem('code').includes('חמש דקות בסוף כל שבוע') && app.BlockSystem().includes('לא פתרון מלא'));
  const nothing = { course: 'קורס ריק', reason: 'start', note: '', minutes: 20, today: T, info: null, lectures: [], cardsDue: 0, exam: null, pastExams: 0, deadlines: [], tasks: [] };
  check('a course with nothing in it still gets steps', sound(app.CoachFallback(nothing), nothing) && app.CoachFallback(nothing).every(x => x.lecture === null));

  // What an AI answers: trusted only after cleaning.
  const raw = [{ title: 'צעד ראשון גדול', minutes: 30, kind: 'start', lecture: 2, why: 'א' }, { title: 'צעד', minutes: 500, kind: 'magic', lecture: 99 }, { title: '', minutes: 5 }, 'junk', { title: 'שלישי', minutes: 'x', kind: 'cards' }];
  const clean = app.CleanCoachSteps(raw, Object.assign({}, ctx, { minutes: 90 }));
  check('an AI answer is cleaned: a tiny first step, minutes in range, an unknown kind and a lecture that does not exist are fixed', clean.length === 3 && clean[0].minutes === 5 && clean[0].lecture === 2 && clean[1].minutes === 45 && clean[1].kind === 'read' && clean[1].lecture === null && clean[2].minutes === 10);
  check('an answer that does not fit the time loses its last steps', app.CleanCoachSteps(Array.from({ length: 6 }, (_, i) => ({ title: 'צעד ' + i, minutes: 40 })), Object.assign({}, ctx, { minutes: 45 })).length < 6);
  check('an answer that is not a list of steps is not used', app.CleanCoachSteps(null, ctx) === null && app.CleanCoachSteps('x', ctx) === null && app.CleanCoachSteps([{ title: 'אחד' }], ctx) === null && app.CleanCoachSteps(Array.from({ length: 12 }, (_, i) => ({ title: 'צעד ' + i, minutes: 2 })), ctx).length === 6);

  // The whole request, with the AI stubbed.
  const sent = [], realSend = app.Send;
  app.Send = (m) => sent.push(m);
  const ask = async (extra) => { sent.length = 0; await app.StuckHelp(Object.assign({ requestId: 'q', course, reason: 'start', minutes: 45, note: 'מה לעשות' }, extra)); return sent.find(m => m.type === 'stuckResult'); };
  let seen = null;
  app.HelperOrder = () => ['gemini'];
  app.HelperAsk = async (system, messages) => { seen = { system, user: messages[0][1] }; return { Error: false, Text: '```json\n{"steps":[{"title":"כתוב מה אתה זוכר מהרצאה 1","minutes":4,"kind":"recall","lecture":1,"why":"שליפה"},{"title":"פתור את התרגיל של הרצאה 2","minutes":20,"kind":"practice","lecture":2,"why":"תרגול"}]}\n```' }; };
  let res = await ask();
  check('with an AI the steps come from its answer, made from the data of the course', res.source === 'ai' && res.steps.length === 2 && res.steps[0].lecture === 1 && seen.user.includes('מבחן סגור') && seen.user.includes('מה לעשות') && !seen.user.includes('סוד-של-קורס-אחר'));
  app.HelperAsk = async () => ({ Error: true, Text: 'limit', Limit: true });
  res = await ask();
  check('when the AI fails the steps are made by rules', res.source === 'rules' && sound(res.steps, ctx));
  app.HelperAsk = async () => ({ Error: false, Text: 'אני מצטער, אין לי מה להגיד' });
  res = await ask();
  check('an answer that is not JSON is not an error, the rules take over', res.source === 'rules' && res.steps.length >= 3);
  let called = 0;
  app.HelperOrder = () => []; app.HelperAsk = async () => { called++; return { Error: true }; };
  res = await ask();
  check('with no AI connected there is no call, and still steps', called === 0 && res.source === 'rules' && res.steps.length >= 3);
  app.HelperOrder = () => ['gemini'];
  app.HelperAsk = async () => { await new Promise(r => setTimeout(r, 80)); return { Error: true }; };
  sent.length = 0;
  const first = app.StuckHelp({ requestId: 'a', course, reason: 'start', minutes: 45 }), second = app.StuckHelp({ requestId: 'b', course, reason: 'start', minutes: 45 });
  await Promise.all([first, second]);
  check('one request at a time', sent.find(m => m.requestId === 'b').error === true && sent.find(m => m.requestId === 'a').steps.length >= 3);
  res = await ask({ course: '' });
  check('no course is refused with a clear message', res.error === true && !app.coachBusy);
  let opts = null;
  app.HelperAsk = async (system, messages, only, onChunk, o) => { opts = o; return { Error: true }; };
  await ask();
  check('the coach asks the quick way, with a deadline', opts && opts.fast === true && opts.timeoutMs > 0 && opts.timeoutMs <= 30000);
  delete app.HelperAsk;

  // One deadline for the whole question: a slow first provider leaves no time for the second, and the CLI gets what is left.
  const realMode = app.HelperMode, realCli = app.HelperCallCli, realHas = app.HasHelperKey, realCall = app.HelperCall;
  const cliCalls = [];
  app.HelperOrder = () => ['gemini', 'openai']; app.HelperMode = () => 'account'; app.HasHelperKey = () => false;
  app.HelperCall = async () => { cliCalls.push('http'); return { Error: true }; };
  app.HelperCallCli = async (provider, system, messages, img, o) => { cliCalls.push({ provider, fast: o.fast, timeoutMs: o.timeoutMs }); await new Promise(r => setTimeout(r, o.timeoutMs)); return { Error: true, Text: 'הזמן הקצוב נגמר' }; };
  const t0 = Date.now();
  const late = await app.HelperAsk('s', [['user', 'u']], null, null, { fast: true, timeoutMs: 1500 });
  check('a slow helper is cut at the deadline and the next one is not started', late.Error && cliCalls.length === 1 && cliCalls[0].fast === true && cliCalls[0].timeoutMs <= 1500 && Date.now() - t0 < 2500);
  app.HelperMode = realMode; app.HelperCallCli = realCli; app.HasHelperKey = realHas; app.HelperCall = realCall;

  app.HelperOrder = () => ['gemini'];
  app.coachAiMs = 1200;
  app.HelperAsk = async (system, messages, only, onChunk, o) => { await new Promise(r => setTimeout(r, o.timeoutMs + 50)); return { Error: true, Text: 'הזמן הקצוב נגמר' }; };
  const t1 = Date.now();
  res = await ask();
  check('when the AI is too slow the steps made by rules come at the deadline', res.source === 'rules' && res.steps.length >= 3 && Date.now() - t1 < 2500);
  delete app.coachAiMs;

  // A CLI run that passes its time is stopped, not waited for.
  const t2 = Date.now();
  const slow = await app.RunCli('/bin/sleep', ['5'], null, null, 200);
  check('a CLI run is stopped at its timeout', slow.code === -2 && Date.now() - t2 < 2000);
  delete app.HelperOrder; delete app.HelperAsk; app.Send = realSend;

  // A task made from a step keeps its length, kind and lecture, and nothing else.
  const tasks = app.CleanTasks([{ id: 'a', title: 'צעד', course, due: '2026-11-10', done: false, minutes: 15, kind: 'cards', lecture: 3, extra: 'x' }, { id: 'b', title: 'רע', minutes: 1, kind: 'hack', lecture: 999 }]);
  check('a task keeps its minutes, kind and lecture when they are valid', tasks[0].minutes === 15 && tasks[0].kind === 'cards' && tasks[0].lecture === 3 && !('extra' in tasks[0]) && !('minutes' in tasks[1]) && !('kind' in tasks[1]) && !('lecture' in tasks[1]));

  // In the plan: a card review step is light work, a practice step heavy, and each keeps its own length.
  const P = require('../../src/web/planner.js');
  const ev = (name, kind, minutes) => ({ name, course, when: new Date(2026, 10, 10, 23, 59).getTime() / 1000, manual: true, kind, minutes, overdue: false });
  const plan = P.planDay({ now: new Date(2026, 10, 10, 8, 0), events: [ev('תרגול', 'practice', 25), ev('כרטיסים', 'cards', 5)], timetable: null, review: null, planner: { studyFrom: '08:00', studyTo: '22:00', energy: { morning: 'high', noon: 'medium', evening: 'medium', night: 'low' } } });
  const byTitle = Object.fromEntries(plan.items.map(i => [i.title, i]));
  check('a practice step is heavy and a card step light, each with its own length', byTitle['תרגול'].heavy === true && byTitle['תרגול'].minutes === 25 && byTitle['כרטיסים'].heavy === false && byTitle['כרטיסים'].minutes === 5 && byTitle['תרגול'].energy === 'high' && byTitle['כרטיסים'].energy === 'low');
  app.settings.studyRoot = saved.root;
}

