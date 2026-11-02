'use strict';
// Offline unit & regression test suite for the macOS Electron port (mirrors tests/RegressionTests.cs).

const fs = require('fs');
const http = require('http');
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
      app.UnpackZip(spath, sOut, 'syllabus', 0, 'סילבוס syllabus.zip') === 1 && listFiles(sOut).length === 1
    );

    const zdir = path.join(root, 'zip-exams');
    mkdirp(zdir);
    const zpath = path.join(zdir, 'exams.zip');
    createZip(zpath, { '2023/exam a.pdf': 'x', '2023/solution a.pdf': 'x', '../evil.exe': 'x', 'run.bat': 'x' });
    const unpacked = app.UnpackZip(zpath, zdir);
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
    buildSummaryShare(shareRoot, page, '', zip);
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

