'use strict';
// Port of src/MoodleDownloads.cs

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Str, Bool, Int, SafeName, Trunc, guidN, fileExists, mkdirp, listFiles } = require('../util');
const platform = require('../platform');
const C = require('../constants');

const ExamSectionName = /(מבחן|מבחנ|בחינ|מועד [אבג]|exam|midterm)/i;
const SkippedMods = new Set(['forum', 'quiz', 'label', 'choice', 'feedback', 'lti', 'h5pactivity', 'zoom']);
const ZipKeep = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.txt', '.html', '.htm', '.xlsx']);
// The syllabus download keeps lectures, homework and exams out of the course information.
const LectureName = /(הרצא|שקפים|מצגת|lecture|slides|tutorial|שיעור \d)/i;
const SyllabusTitle = /(סילבוס|סילאבוס|syllabus|course outline|תכנית הקורס|תוכנית הקורס)/i;
const SyllabusMarks = [/מטרות הקורס/, /דרישות (?:הקורס|קדם)/, /(?:מבנה|הרכב) הציון/, /ביבליוגרפיה|רשימת קריאה/, /נושאי הקורס/, /שעות קבלה/,
  /course objectives|learning outcomes/i, /prerequisites/i, /grading/i, /bibliography/i];

function htmlDecode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

module.exports = {
  init(host) {
    host.moodleDownloading = new Set();
  },
  methods: {
    // A file named like a lecture, homework or exam (and not like a syllabus).
    NotSyllabusName(name) {
      name = name || '';
      return !this.SyllabusNameRe().test(name) && (LectureName.test(name) || this.ExerciseNameRe().test(name) || this.ExamNameRe().test(name));
    },

    // Only the first pages count: a title like "סילבוס" with one syllabus part, or three syllabus parts.
    // A passing "כפי שמופיע בסילבוס" in homework is not enough.
    LooksLikeSyllabus(text) {
      const t = String(text || '').replace(/^=== .*\n/, '').substring(0, 8000);
      const marks = SyllabusMarks.filter(re => re.test(t)).length;
      return (SyllabusTitle.test(t.substring(0, 3000)) && marks >= 1) || marks >= 3;
    },

    // Whether a downloaded file goes into the course information folder.
    async KeepForSyllabus(file, mod, discover) {
      const base = path.basename(file);
      if (this.SyllabusNameRe().test(base)) return true;
      if (!discover && (mod === 'resource' || mod === 'file')) return true; // the item itself is named like a syllabus
      if (this.NotSyllabusName(base)) return false;
      if (mod !== 'resource' && mod !== 'file') return true; // reached through a link labelled like a syllabus
      return this.LooksLikeSyllabus(await this.ExtractTexts([file]));
    },

    PickMoodleItems(sections, what) {
      const picked = [];
      const urls = new Set();
      for (const s of sections || []) {
        const wholeSection = what === 'exams' && ExamSectionName.test(Str(s, 'title'));
        const infoSection = what === 'syllabus' && this.SyllabusNameRe().test(Str(s, 'title')) && Str(s, 'title').length < 40;
        const items = Array.isArray(s.items) ? s.items : [];
        for (const it of items) {
          if (!it || SkippedMods.has(Str(it, 'mod')) || Str(it, 'url').length === 0) continue;
          const name = Str(it, 'name');
          const match = what === 'exams'
            ? (wholeSection || this.ExamNameRe().test(name))
            : this.SyllabusNameRe().test(name);
          const container = ['folder', 'page', 'url'].includes(Str(it, 'mod')) || /\.zip(?:$|[?\s])/i.test(name + ' ' + Str(it, 'url'));
          // In a "מידע על הקורס" section, an item not named like a syllabus still has its content checked.
          if ((match || container || infoSection) && !urls.has(Str(it, 'url'))) {
            urls.add(Str(it, 'url'));
            picked.push(Object.assign({}, it, { discoveryOnly: !match }, infoSection && !match ? { infoSection: true } : {}));
          }
        }
      }
      return picked;
    },

    // Uses Python's built-in zipfile module (or /usr/bin/unzip) to inspect and safely extract archives with budget limits.
    UnpackZip(zipPath, dest, filter = null, depth = 0, context = '', budget = null) {
      if (path.extname(zipPath).toLowerCase() !== '.zip' || depth > 3) return 0;
      budget = budget || { Entries: 0, Bytes: 0 };
      const tmpExtract = path.join(platform.TempDir, 'sumit-unzip-' + guidN());
      mkdirp(tmpExtract);
      let n = 0;
      try {
        const py = `
import sys, zipfile, json, os
zp, outdir = sys.argv[1], sys.argv[2]
entries = []
with zipfile.ZipFile(zp, 'r') as z:
    for idx, info in enumerate(z.infolist()):
        if info.is_dir(): continue
        target = os.path.join(outdir, str(idx))
        with z.open(info) as src, open(target, 'wb') as dst:
            dst.write(src.read())
        entries.append({'idx': idx, 'name': os.path.basename(info.filename), 'full': info.filename, 'size': info.file_size})
print(json.dumps(entries))
`;
        const pyExe = this.FindPython() || '/usr/bin/python3';
        const r = spawnSync(pyExe, ['-c', py, zipPath, tmpExtract], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        if (r.status !== 0) return 0;
        const list = JSON.parse((r.stdout || '[]').trim());
        for (const en of list) {
          if (++budget.Entries > 1000 || en.size > 100 * 1024 * 1024 || (budget.Bytes += en.size) > 300 * 1024 * 1024) {
            throw new Error('הארכיון גדול מדי לחילוץ אוטומטי');
          }
          if (!en.name) continue;
          const ext = path.extname(en.name).toLowerCase();
          const label = context + ' ' + en.full;
          const extractedFile = path.join(tmpExtract, String(en.idx));
          if (ext === '.zip') {
            const nested = path.join(platform.TempDir, 'sumit-archive-' + guidN() + '.zip');
            try {
              fs.copyFileSync(extractedFile, nested);
              n += this.UnpackZip(nested, dest, filter, depth + 1, label, budget);
            } finally {
              try { if (fileExists(nested)) fs.unlinkSync(nested); } catch { }
            }
            continue;
          }
          if (!ZipKeep.has(ext)
            || (filter === 'syllabus' && (!this.SyllabusNameRe().test(label) || this.NotSyllabusName(en.name)))
            || (filter === 'exams' && !this.ExamNameRe().test(label))) continue;
          const outPath = path.join(dest, SafeName(en.full.replace(/\\/g, '_').replace(/\//g, '_')));
          mkdirp(dest);
          if (fileExists(outPath) && fs.statSync(outPath).size === en.size) { n++; continue; }
          const tmp = outPath + '.part';
          fs.copyFileSync(extractedFile, tmp);
          fs.renameSync(tmp, outPath);
          n++;
        }
      } finally {
        try { fs.rmSync(tmpExtract, { recursive: true, force: true }); } catch { }
      }
      return n;
    },

    async DiscoverMoodleFiles(http, url, what) {
      const found = new Set();
      const visited = new Set();
      const pending = [[url, 0]];
      while (pending.length > 0 && visited.size < 60) {
        const [curUrl, depth] = pending.shift();
        if (!this.IsMoodleUrl(curUrl) || visited.has(curUrl)) continue;
        visited.add(curUrl);
        let html;
        try { html = await http.getString(curUrl); } catch { continue; }
        const re = /<a\b[^>]*href\s*=\s*['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
          let target;
          try { target = new URL(htmlDecode(m[1]), curUrl); } catch { continue; }
          if (!this.IsMoodleUrl(target.href)) continue;
          const label = decodeURIComponent(target.href) + ' ' + this.HtmlToText(m[2]);
          const relevant = what === 'exams' ? this.ExamNameRe().test(label) : this.SyllabusNameRe().test(label);
          const archive = target.pathname.toLowerCase().endsWith('.zip');
          if (target.pathname.includes('pluginfile.php') && (relevant || archive)) found.add(target.href);
          else if (relevant && target.pathname.includes('/mod/resource/view.php')) found.add(target.href + '&redirect=1');
          else if (depth < 3 && /\/mod\/(folder|page|resource|url)\/view\.php$/.test(target.pathname) && !visited.has(target.href)) {
            pending.push([target.href, depth + 1]);
          }
        }
      }
      return Array.from(found);
    },

    async DownloadFromMoodle(course, courseId, what) {
      const key = what + '|' + course;
      if (this.moodleDownloading.has(key)) return;
      this.moodleDownloading.add(key);
      this.Send({ type: 'operationStatus', course, operation: what, busy: true });
      const label = what === 'exams' ? 'המבחנים והפתרונות' : 'הסילבוס';
      const status = (t, pct) => this.Send({ type: 'courseStatus', course, busy: true, text: t, pct });
      let saved = 0, failed = 0;
      let discoveryRoot = null, discoveryDir = null;
      try {
        discoveryRoot = path.join(this.CourseDir(course), C.SumitDir, 'discovery');
        discoveryDir = path.join(discoveryRoot, what);
        status('מחפש את ' + label + ' ב-Moodle...', 0);
        if (courseId <= 0) courseId = Int(this.LoadMeta(course), 'courseId');
        if (courseId <= 0) {
          this.Send({ type: 'courseStatus', course, busy: false, text: 'לא מצאתי את הקורס ב-Moodle. פתח אותו מהרשימה ונסה שוב', error: true });
          return;
        }
        const v = await this.WithMoodle(() => this.EvalAsync(this.moodle, this.SectionsJs().replace(/COURSE_ID/g, String(courseId)), 120000));
        const sections = JSON.parse(v) || [];

        let picked = this.PickMoodleItems(sections, what);
        for (const section of sections) {
          for (const item of Array.isArray(section.items) ? section.items : []) {
            if (Str(item, 'mod') === 'resource' && !picked.some(p => Str(p, 'url') === Str(item, 'url'))
              && !(what === 'syllabus' && this.NotSyllabusName(Str(item, 'name')))) {
              picked.push(Object.assign({}, item, { discoveryOnly: true }));
            }
          }
        }
        if (what === 'syllabus') {
          // The syllabus itself first, so the 80-item cap never cuts it.
          const rank = it => !Bool(it, 'discoveryOnly') ? 0 : Bool(it, 'infoSection') ? 1 : Str(it, 'mod') !== 'resource' ? 2 : 3;
          picked.sort((a, b) => rank(a) - rank(b));
        }
        picked = picked.slice(0, 80);
        if (picked.length === 0) {
          this.Send({
            type: 'courseStatus', course, busy: false, error: true,
            text: what === 'exams'
              ? 'לא מצאתי ב-Moodle של הקורס מבחנים. אפשר להוסיף מ-CS24 או מהמחשב.'
              : 'לא מצאתי ב-Moodle של הקורס סילבוס. אפשר להוסיף אותו מהמחשב.',
          });
          return;
        }

        const dest = path.join(this.CourseDir(course), what === 'exams' ? C.Exams : C.CourseInfoFolder);
        mkdirp(dest);
        const http = await this.MoodleHttp();
        for (let i = 0; i < picked.length; i++) {
          const it = picked[i];
          const mod = Str(it, 'mod'), name = Str(it, 'name'), url = Str(it, 'url');
          status('מוריד את ' + label + ' (' + (i + 1) + ' מתוך ' + picked.length + '): ' + Trunc(name, 60), Math.floor(100 * i / picked.length));
          try {
            if (!this.IsMoodleUrl(url)) continue;
            const discover = Bool(it, 'discoveryOnly');
            const urls = mod === 'resource' ? [url + (url.includes('?') ? '&' : '?') + 'redirect=1']
              : mod === 'file' ? [url]
              : discover ? await this.DiscoverMoodleFiles(http, url, what) : await this.PluginFiles(http, url);
            for (const f of Array.from(new Set(urls))) {
              // Syllabus files are staged first and only what passes the checks reaches the course information.
              const downloadDir = discover || what === 'syllabus' ? discoveryDir : dest;
              const dlPath = await this.DownloadFile(http, f, downloadDir, true, discover ? 64 * 1024 * 1024 : 0);
              if (!dlPath) continue;
              if (path.extname(dlPath).toLowerCase() === '.zip') {
                saved += this.UnpackZip(dlPath, dest, discover || what === 'syllabus' ? what : null, 0, name + ' ' + path.basename(dlPath));
              } else if (what === 'syllabus') {
                if (await this.KeepForSyllabus(dlPath, mod, discover)) {
                  fs.copyFileSync(dlPath, path.join(dest, path.basename(dlPath)));
                  saved++;
                }
              } else if (!discover) {
                saved++;
              } else {
                const matches = this.ExamNameRe().test(path.basename(dlPath)) || (mod !== 'resource' && mod !== 'file');
                if (matches) {
                  fs.copyFileSync(dlPath, path.join(dest, path.basename(dlPath)));
                  saved++;
                }
              }
            }
          } catch (ex) {
            failed++;
            this.Toast(Trunc(name, 40) + ': ' + (ex.message || String(ex)), true);
          }
        }
        this.Send({
          type: 'courseStatus', course, busy: false,
          text: saved > 0 ? 'ירדו ' + saved + ' קבצים: ' + label + (failed > 0 ? ' (' + failed + ' נכשלו)' : '') : 'לא ירד שום קובץ',
          error: saved === 0,
        });
        this.SendCourseLocal(course);
        if (what === 'syllabus' && saved > 0) await this.AnalyzeCourseAsync(course);
      } catch (ex) {
        this.Send({ type: 'courseStatus', course, busy: false, text: ex.message || String(ex), error: true });
      } finally {
        this.moodleDownloading.delete(key);
        // Staged downloads (and loose files left by older versions) are not kept.
        if (discoveryDir) {
          try { fs.rmSync(discoveryDir, { recursive: true, force: true }); } catch { }
          for (const f of listFiles(discoveryRoot, false)) { try { fs.unlinkSync(f); } catch { } }
        }
        this.Send({ type: 'operationStatus', course, operation: what, busy: false });
      }
    },
  },
};
