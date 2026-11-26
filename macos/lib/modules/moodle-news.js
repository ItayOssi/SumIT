'use strict';
// "הודעות מהמרצים" (macOS only, no C# counterpart; the UI is src/web/moodle-news-ui.js). The lecturers' announcements forum
// ("לוח הודעות") of each course that is set up is read every two hours in the student's Moodle session: the forum page
// for the list (at HIT the forum web services are closed to the page), and mod_forum_get_discussion_posts, or the
// discussion page, for the text of a new one. Each new announcement is sorted by words into a cancelled lesson, a change
// of time or room, an exam or a submission, or general; only when the words don't decide and the text speaks of a date or
// an hour does a helper AI with a key get that one announcement. The first read of a forum only remembers what is there.
// Important ones get a system notification. Everything stays in moodle-news.json on this Mac.

const path = require('path');
const platform = require('../platform');
const { Str, Int, Bool, Trunc, Unprotect, delay, readText, writeText, fileExists } = require('../util');

const CheckEvery = 2 * 3600 * 1000, MaxKept = 150, MaxText = 1500, MaxNewPerRead = 6, MaxSeen = 400, FirstKept = 3;
const Kinds = ['cancel', 'change', 'exam', 'general'];
const KindWords = {
  cancel: /(בוטל|בוטלה|בוטלו|מבוטל|ביטול|לא יתקיים|לא תתקיים|לא יתקיימו|לא תהיה הרצאה|לא יהיה שיעור|לא יהיה תרגול|לא תהיה הרצאה|אין הרצאה|אין שיעור|אין תרגול|\bcancel)/i,
  change: /(נדח[הית]|הוזז|הועבר|יועבר|תועבר|יועברו|שינוי (?:חדר|מועד|שעה|שעת|כיתה|מיקום)|חדר חדש|בחדר אחר|יתקיים (?:ב|ביום|בזום|מרחוק)|תתקיים (?:ב|ביום|בזום|מרחוק)|יתקיימו (?:ב|בזום)|במקום (?:ב|ה)|שיעור השלמה|הרצאת השלמה|תרגול השלמה|השלמת (?:שיעור|הרצאה|תרגול)|\breschedul|\bmoved to|room change)/i,
  exam: /(מבחן|מבדק|בוחן|בחינה|בחינת|מועד [אבג]['׳]?|הגשה|הגשת|להגיש|תאריך אחרון|דדליין|\bdeadline|\bexam|\bquiz|\bmidterm|submission)/i,
};
const ScheduleHint = /(\d{1,2}[./]\d{1,2}|\d{1,2}:\d{2}|יום [אבגדהו]['׳]|ביום (?:ראשון|שני|שלישי|רביעי|חמישי|שישי)|מחר|השבוע|בשבוע הבא|שעה|שעות|חדר)/;
const AnnouncementName = /(הודעות|לוח הודעות|announcement|news)/i;

// The announcement's kind from its words: a cancellation before a change, a change before an exam.
function kindOf(subject, text) {
  const s = (subject || '') + '\n' + (text || '');
  for (const k of ['cancel', 'change', 'exam']) if (KindWords[k].test(s)) return k;
  return 'general';
}

// Moodle sends HTML; the app keeps short plain text.
function plainText(html) {
  return String(html || '').replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// The announcements forum of a course, from the sections the app already read: one named like announcements, otherwise
// the first forum of the course's first section.
function pickForum(sections) {
  const forums = [];
  for (const s of Array.isArray(sections) ? sections : []) {
    for (const it of (s && Array.isArray(s.items) ? s.items : [])) {
      if (it && it.mod === 'forum' && /\/mod\/forum\/view\.php\?id=\d+/.test(Str(it, 'url'))) forums.push({ url: Str(it, 'url'), name: Str(it, 'name'), num: Int(s, 'num') });
    }
  }
  return forums.find(f => AnnouncementName.test(f.name)) || forums.find(f => f.num === 0) || null;
}

// Runs in the Moodle page: the forum's list, and the first post of each discussion it doesn't know yet.
const ForumJs = `
const known = new Set(KNOWN_IDS);
const html = await (await fetch(FORUM_URL, {credentials: 'include'})).text();
const doc = new DOMParser().parseFromString(html, 'text/html');
const rows = [];
doc.querySelectorAll('[data-region="discussion-list-item"], tr.discussion').forEach(tr => {
  const a = tr.querySelector('td.topic a[href*="discuss.php?d="], a[href*="discuss.php?d="]');
  const id = tr.getAttribute('data-discussionid') || (a ? (a.getAttribute('href').match(/[?&]d=(\\d+)/) || [])[1] : '');
  if (!id || !a || rows.some(r => r.id === id)) return;
  const t = tr.querySelector('time[data-timestamp]');
  rows.push({id: String(id), subject: a.textContent.replace(/\\s+/g, ' ').trim(), when: t ? +t.getAttribute('data-timestamp') * 1000 : 0,
    pinned: tr.classList.contains('pinned'), url: new URL(a.getAttribute('href'), location.origin).href});
});
const posts = {};
const fresh = rows.filter(r => !known.has(r.id)).sort((x, y) => y.when - x.when).slice(0, MAX_NEW);
for (const r of fresh) {
  try {
    const res = await fetch('/lib/ajax/service.php?sesskey=' + M.cfg.sesskey + '&info=mod_forum_get_discussion_posts', {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify([{index: 0, methodname: 'mod_forum_get_discussion_posts', args: {discussionid: +r.id, sortby: 'created', sortdirection: 'ASC'}}])});
    const j = await res.json();
    if (j[0].error) throw new Error('ws');
    const p = (j[0].data.posts || [])[0];
    if (p) { posts[r.id] = {html: p.message || '', author: (p.author && p.author.fullname) || '', when: (p.timecreated || 0) * 1000}; continue; }
  } catch (e) {}
  try {
    const d = new DOMParser().parseFromString(await (await fetch(r.url, {credentials: 'include'})).text(), 'text/html');
    const c = d.querySelector('.post-content-container, .posting');
    const t = d.querySelector('time[datetime]');
    const au = d.querySelector('[data-region-content="forum-post-core-author"], .author a, header a[href*="/user/view.php"]');
    if (c) posts[r.id] = {html: c.innerHTML, author: au ? au.textContent.trim() : '', when: t ? Date.parse(t.getAttribute('datetime')) || 0 : 0};
  } catch (e) {}
}
return {rows, posts};`;

const NewsSystem = 'אתה ממיין הודעה של מרצה לסטודנטים. ענה במילה אחת בלבד מתוך: cancel (שיעור, הרצאה או תרגול בוטלו), change (שינוי מועד, שעה, חדר, או מעבר לזום), exam (מבחן, בוחן או הגשה), general (כל דבר אחר).';

const DemoItems = () => {
  const now = Date.now();
  return [
    { id: 'demo:1', course: 'חשבון אינפיניטסימלי 1', subject: 'ההרצאה ביום שלישי בוטלה', author: 'ד"ר כהן', when: now - 3 * 3600000, url: '', kind: 'cancel', text: 'שלום לכולם, ההרצאה ביום שלישי הקרוב לא תתקיים. החומר יושלם בשבוע הבא.', read: false },
    { id: 'demo:2', course: 'פיסיקה 1 למהנדסים', subject: 'התרגול יתקיים בזום', author: 'גב׳ לוי', when: now - 26 * 3600000, url: '', kind: 'change', text: 'התרגול של יום חמישי יתקיים בזום. הקישור נמצא באתר הקורס.', read: false },
    { id: 'demo:3', course: 'אלגברה לינארית', subject: 'מבדק שני', author: 'פרופ׳ שמיר', when: now - 3 * 86400000, url: '', kind: 'exam', text: 'המבדק השני יתקיים בעוד שבועיים, על פרקים 3 עד 5.', read: true },
  ];
};

module.exports = {
  init(host) {
    host.lastNewsCheck = 0;
    host.newsBusy = false;
  },
  methods: {
    NewsKind(subject, text) { return kindOf(subject, text); },
    NewsPlain(html) { return plainText(html); },
    NewsPickForum(sections) { return pickForum(sections); },
    NewsForumJs() { return ForumJs; },
    NewsPath() { return this.newsPath || path.join(platform.DataRoot, 'moodle-news.json'); },

    NewsLoad() {
      let o = null;
      try { const p = this.NewsPath(); o = fileExists(p) ? JSON.parse(readText(p)) : null; } catch { }
      if (!o || typeof o !== 'object' || Array.isArray(o)) o = {};
      if (!o.seen || typeof o.seen !== 'object' || Array.isArray(o.seen)) o.seen = {};
      o.items = Array.isArray(o.items) ? o.items.filter(x => x && typeof x === 'object' && Str(x, 'id') && Kinds.includes(Str(x, 'kind'))) : [];
      return o;
    },
    NewsSave(state) {
      state.items = state.items.sort((a, b) => (b.when || 0) - (a.when || 0)).slice(0, MaxKept);
      for (const c of Object.keys(state.seen)) if (Array.isArray(state.seen[c])) state.seen[c] = state.seen[c].slice(-MaxSeen);
      try { writeText(this.NewsPath(), JSON.stringify(state)); } catch { }
    },
    NewsItems() { return this.demo ? DemoItems() : this.NewsLoad().items; },
    NewsSendList() { this.Send({ type: 'news', op: 'list', items: this.NewsItems() }); },

    // Only an AI with a key (a short call, no sign-in window), and only for one announcement at a time.
    async NewsAskAi(subject, text) {
      for (const provider of ['gemini', 'openai', 'claude']) {
        if (!this.HasHelperKey(provider)) continue;
        try {
          const key = Unprotect(Str(this.settings, provider + 'Key'));
          const r = await this.HelperCall(provider, key, NewsSystem, [['user', 'כותרת: ' + subject + '\n\n' + Trunc(text, 1200)]], null, null, null, 64, 30000);
          if (r && !r.Error) { const k = (String(r.Text || '').toLowerCase().match(/cancel|change|exam|general/) || [])[0]; if (k) return k; }
        } catch { }
        return '';
      }
      return '';
    },
    async NewsClassify(subject, text) {
      const k = kindOf(subject, text);
      if (k !== 'general' || !ScheduleHint.test(subject + '\n' + text)) return k;
      return (await this.NewsAskAi(subject, text)) || k;
    },

    // What one read of a course's forum gave ({rows, posts}): new announcements are kept, sorted and returned.
    // The first read of a course only remembers what is there, and keeps the latest few as already read.
    async NewsApply(course, result, state) {
      const rows = result && Array.isArray(result.rows) ? result.rows.filter(r => r && /^\d+$/.test(Str(r, 'id'))) : [];
      const posts = result && result.posts && typeof result.posts === 'object' ? result.posts : {};
      const first = !Array.isArray(state.seen[course]);
      const seen = new Set(first ? [] : state.seen[course]);
      const fresh = [];
      const newest = rows.slice().sort((a, b) => (b.when || 0) - (a.when || 0));
      for (const r of newest) {
        const id = Str(r, 'id');
        if (seen.has(id)) continue;
        const p = posts[id];
        if (!first && !p) continue;   // its text didn't arrive: it is read again next time
        seen.add(id);
        if (first && fresh.length >= FirstKept) continue;
        const subject = Trunc(Str(r, 'subject').trim(), 200);
        const text = Trunc(plainText(p ? p.html : ''), MaxText);
        const url = Str(r, 'url');
        fresh.push({
          id: 'md:' + id, course, subject, author: Trunc(p ? Str(p, 'author') : '', 80), when: (p && +p.when) || +r.when || Date.now(),
          url: this.IsMoodleUrl(url) ? url : '', kind: first ? kindOf(subject, text) : await this.NewsClassify(subject, text), text, read: first,
        });
      }
      state.seen[course] = Array.from(seen);
      const ids = new Set(state.items.map(x => x.id));
      for (const it of fresh) if (!ids.has(it.id)) state.items.push(it);
      return first ? [] : fresh;
    },

    // Shown also while the app is in front; a click brings the window up with the announcement open.
    NewsNotify(item) {
      const title = { cancel: '🚫 בוטל', change: '🔁 שינוי', exam: '📝 מבחן או הגשה' }[item.kind] + ' · ' + item.course;
      try {
        const { Notification } = require('electron');
        if (!Notification || !Notification.isSupported()) return;
        const n = new Notification({ title: Trunc(title, 80), body: Trunc(item.subject, 160), silent: false });
        n.on('click', () => {
          try { if (this.win && !this.win.isDestroyed()) { this.win.show(); this.win.focus(); } } catch { }
          this.Send({ type: 'news', op: 'show', id: item.id });
        });
        n.show();
      } catch { }
    },

    // Every two hours while Moodle is signed in (or now, when the student asks): the forum of each course that is set up.
    async BackgroundNewsCheck(force = false, notify = null) {
      if (this.demo || this.newsBusy || !this.lastCourses) return [];
      if (!force && Date.now() - this.lastNewsCheck < CheckEvery) return [];
      this.newsBusy = true;
      this.lastNewsCheck = Date.now();
      const told = [];
      try {
        for (const c of Array.from(this.lastCourses)) {
          const name = Str(c, 'name');
          const meta = this.LoadMeta(name);
          if (!Bool(meta, 'setupDone')) continue;
          const forum = pickForum(meta.sectionsCache);
          if (!forum || !this.IsMoodleUrl(forum.url)) continue;
          const state = this.NewsLoad();
          const known = Array.isArray(state.seen[name]) ? state.seen[name] : [];
          let result;
          try {
            const js = ForumJs.replace('FORUM_URL', JSON.stringify(forum.url)).replace('KNOWN_IDS', JSON.stringify(known)).replace('MAX_NEW', String(known.length ? MaxNewPerRead : FirstKept));
            result = await this.WithMoodleQuiet(() => this.EvalAsync(this.moodle, js, 60000));
            result = typeof result === 'string' ? JSON.parse(result) : result;
          } catch { continue; }
          const fresh = await this.NewsApply(name, result, state);
          this.NewsSave(state);
          for (const it of fresh) if (it.kind !== 'general') { (notify || ((x) => this.NewsNotify(x)))(it); told.push(it); }
          await delay(force ? 300 : 1500);
        }
      } finally { this.newsBusy = false; }
      this.NewsSendList();
      return told;
    },

    async NewsHandle(m) {
      const op = Str(m, 'op');
      if (op === 'ping') { this.Send({ type: 'news', op: 'ready', available: true, items: this.NewsItems() }); return; }
      if (op === 'read' || op === 'readAll') {
        if (this.demo) return;
        const state = this.NewsLoad();
        const id = Str(m, 'id'), course = Str(m, 'course');
        for (const it of state.items) if (op === 'read' ? it.id === id : (!course || it.course === course)) it.read = true;
        this.NewsSave(state);
        this.NewsSendList();
        return;
      }
      if (op === 'check') {
        if (this.newsBusy) return;
        this.Send({ type: 'news', op: 'checking' });
        await this.BackgroundNewsCheck(true);
        this.Send({ type: 'news', op: 'checked' });
      }
    },
  },
};
