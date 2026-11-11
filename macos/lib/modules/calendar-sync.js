'use strict';
// Study blocks into the Calendar app of macOS, as they change (macOS only, no C# counterpart). The student picks one calendar of the
// Calendar app; when it belongs to their Google account, macOS carries every change on to Google Calendar by itself, so the app
// needs no Google sign-in and no key. Every change of the plan (a new week, a block added, moved, done or removed) is written a
// moment later. The app only touches events it created: it remembers them, by the block and the week, in a file on this computer.
// The Calendar app is reached with a script (lib/scripts/calendar-sync.jxa.js) that macOS runs; the first time, macOS asks the
// student to let SumIT control Calendar.

const fs = require('fs');
const path = require('path');
const { Str, Int, Bool, Trunc, readText, writeText, fileExists, sha256Hex, ExecOut } = require('../util');
const platform = require('../platform');

const ScriptFile = path.join(__dirname, '..', 'scripts', 'calendar-sync.jxa.js');
const DebounceMs = 1200, ScriptTimeoutMs = 90000, AlarmMinutes = 10;
const arr = (v) => Array.isArray(v) ? v : [];
const obj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};

// The event of one block of the plan: when it is, what it is called, and the key the app remembers it by (the block and its week,
// because the blocks of a new week reuse the ids of the last one).
function blockEvent(b, weekStart) {
  const p = String(weekStart).split('-').map(Number), h = /^(\d{1,2}):(\d{2})$/.exec(b && b.start || '');
  if (!h || p.length !== 3 || p.some(n => !Number.isFinite(n)) || !Str(b, 'id')) return null;
  const start = new Date(p[0], p[1] - 1, p[2] + Int(b, 'day'), Number(h[1]), Number(h[2])).getTime();
  const done = !!b.done;
  return { key: Str(b, 'id') + '@' + weekStart, title: (done ? '✓ ' : '') + 'לימוד: ' + Str(b, 'course'), notes: Trunc(Str(b, 'goal'), 500), start, end: start + Math.max(10, Int(b, 'minutes')) * 60000, done };
}

function planEvents(plan) {
  const p = obj(plan);
  return p.weekStart ? arr(p.blocks).map(b => blockEvent(b, p.weekStart)).filter(Boolean) : [];
}

const hashOf = (e, target) => sha256Hex(Buffer.from(JSON.stringify([e.title, e.notes, e.start, e.end, target.calendar, target.nth]), 'utf8')).slice(0, 16);

// What to write so that the calendar shows `wanted`: the events to create or change, and the ones to delete.
//   - An event the app wrote and that did not change is left alone (unless `force`).
//   - A block that left the plan: its event is deleted, except a block that was done and is over, which stays as a record.
//   - After the student picks another calendar, the events move: deleted in the old one, created in the new one.
// Returns { ops, keep }: `keep` is what stays remembered whatever the script answers.
function syncOps(wanted, known, target, now, force) {
  const ops = [], keep = {}, seen = new Set();
  for (const e of arr(wanted)) {
    seen.add(e.key);
    const prev = obj(known)[e.key], hash = hashOf(e, target);
    const moved = prev && (prev.calendar !== target.calendar || (prev.nth || 0) !== (target.nth || 0));
    if (moved && prev.uid) ops.push({ key: 'old:' + e.key, op: 'delete', calendar: prev.calendar, nth: prev.nth || 0, uid: prev.uid });
    if (prev && !moved && prev.hash === hash && prev.uid && !force) { keep[e.key] = prev; continue; }
    if (prev && !moved) keep[e.key] = prev;   // if the write fails, the event that is there is still remembered
    ops.push({ key: e.key, op: 'put', calendar: target.calendar, nth: target.nth || 0, uid: prev && !moved ? prev.uid || '' : '', title: e.title, notes: e.notes, start: e.start, end: e.end,
      alarm: e.done || e.start <= now ? 0 : AlarmMinutes, hash, done: e.done });
  }
  for (const key of Object.keys(obj(known))) {
    if (seen.has(key)) continue;
    const prev = known[key];
    if (prev.done && prev.end <= now) continue;   // a block that was studied stays in the calendar, and is no longer the app's to change
    if (prev.uid) ops.push({ key, op: 'delete', calendar: prev.calendar, nth: prev.nth || 0, uid: prev.uid });
  }
  return { ops, keep };
}

// What is remembered after the script answered: an event that was written, with its uid; a delete that failed stays remembered, to try again.
function syncResult(ops, results, keep, known) {
  const next = Object.assign({}, keep), failed = [];
  const by = new Map(arr(results).map(r => [r.key, r]));
  for (const o of ops) {
    const r = by.get(o.key);
    if (o.op === 'put') {
      if (r && r.ok && r.uid) next[o.key] = { uid: r.uid, hash: o.hash, end: o.end, done: !!o.done, calendar: o.calendar, nth: o.nth };
      else failed.push(r && r.error || 'no answer');
    } else if (!(r && r.ok)) {
      failed.push(r && r.error || 'no answer');
      if (!o.key.startsWith('old:') && known[o.key]) next[o.key] = known[o.key];
    }
  }
  return { next, failed };
}

module.exports = {
  blockEvent, planEvents, syncOps, syncResult,
  methods: {
    get CalSyncFile() { return this.calSyncFile || path.join(platform.DataRoot, 'calendar-sync.json'); },

    CalSyncConfig() {
      const c = obj(this.settings.calSync);
      return { on: Bool(c, 'on') && !!Str(c, 'calendar'), calendar: Trunc(Str(c, 'calendar'), 200), nth: Math.max(0, Int(c, 'nth')) };
    },

    CalSyncLoad() {
      try { if (fileExists(this.CalSyncFile)) { const s = JSON.parse(readText(this.CalSyncFile)); return { events: obj(s.events), last: Number(s.last) || 0, error: Str(s, 'error') }; } } catch { }
      return { events: {}, last: 0, error: '' };
    },
    CalSyncSave(state) { try { writeText(this.CalSyncFile, JSON.stringify(state)); } catch { } },

    // One request to the Calendar app. Returns the script's answer, or { ok: false, error } in words the student can act on.
    async CalSyncScript(req) {
      let source;
      try { source = fs.readFileSync(ScriptFile, 'utf8'); } catch { return { ok: false, error: 'קובץ הסנכרון חסר בהתקנה' }; }
      const r = await ExecOut(process.env.SUMIT_OSASCRIPT || '/usr/bin/osascript', ['-l', 'JavaScript', '-e', source, JSON.stringify(req)], { timeoutMs: ScriptTimeoutMs, maxBytes: 4 * 1024 * 1024 });
      if (r.code === 0) { try { const a = JSON.parse(r.stdout.trim()); if (a && typeof a === 'object') return a; } catch { } return { ok: false, error: 'Calendar החזיר תשובה לא צפויה' }; }
      const text = r.stderr + r.stdout;
      if (/-1743|not authori[sz]ed/i.test(text)) return { ok: false, denied: true, error: 'אין ל-SumIT הרשאה לשלוט ב-Calendar. בהגדרות המערכת ← פרטיות ואבטחה ← אוטומציה, מפעילים את "לוח שנה" תחת SumIT.' };
      if (r.code === -2) return { ok: false, error: 'Calendar לא ענה בזמן. אם מופיעה שאלה של macOS על הרשאה, אשר אותה ונסה שוב.' };
      if (r.code === -1) return { ok: false, error: 'לא ניתן להפעיל את הסנכרון במק הזה' };
      return { ok: false, error: 'הסנכרון ל-Calendar נכשל: ' + Trunc(text.replace(/\s+/g, ' ').trim(), 160) };
    },

    CalSyncStatus(extra) {
      const cfg = this.CalSyncConfig(), st = this.CalSyncLoad();
      this.Send(Object.assign({ type: 'calSync', on: cfg.on, calendar: cfg.calendar, nth: cfg.nth, count: Object.keys(st.events).length, last: st.last, error: st.error, busy: !!this.calSyncRunning }, extra || {}));
    },

    // Called after every save of the study-track profile: the calendar follows a moment later (several quick changes go as one).
    CalSyncSchedule() {
      if (!this.CalSyncConfig().on) return;
      clearTimeout(this.calSyncTimer);
      this.calSyncTimer = setTimeout(() => { this.CalSyncRun(false).catch(() => { }); }, this.calSyncDelay != null ? this.calSyncDelay : DebounceMs);
      if (this.calSyncTimer.unref) this.calSyncTimer.unref();
    },

    // Brings the calendar to the plan. One run at a time: a change that arrives in the middle starts another run when this one ends.
    // `manual`: the student asked for it, so everything is written again and the result is said out loud.
    async CalSyncRun(manual) {
      if (this.calSyncRunning) { this.calSyncAgain = true; return; }
      const cfg = this.CalSyncConfig();
      if (!cfg.on) return;
      this.calSyncRunning = true;
      try {
        const state = this.CalSyncLoad(), before = state.error;
        const wanted = planEvents(this.TrackLoad().plan);
        const { ops, keep } = syncOps(wanted, state.events, cfg, Date.now(), !!manual);
        let error = '', written = 0;
        if (ops.length) {
          if (manual) this.CalSyncStatus({ busy: true });
          const answer = await this.CalSyncScript({ op: 'apply', ops: ops.map(o => ({ key: o.key, op: o.op, calendar: o.calendar, nth: o.nth, uid: o.uid, title: o.title, notes: o.notes, start: o.start, end: o.end, alarm: o.alarm })) });
          if (answer.ok) {
            const res = syncResult(ops, answer.results, keep, state.events);
            state.events = res.next; written = ops.length - res.failed.length;
            if (res.failed.length) error = res.failed.includes('no-calendar') ? 'היומן "' + cfg.calendar + '" לא נמצא ב-Calendar. בחר יומן אחר.' : res.failed.length + ' אירועים לא נכתבו ליומן. הסנכרון ינסה שוב בשינוי הבא.';
          } else error = answer.error || 'הסנכרון נכשל';
        } else state.events = keep;
        if (!error) state.last = Date.now();
        state.error = error;
        this.CalSyncSave(state);
        this.calSyncRunning = false;
        this.CalSyncStatus();
        if (error && (manual || error !== before)) this.Toast(error, true);
        else if (manual) this.Toast(written ? 'היומן עודכן: ' + written + ' אירועים' : 'היומן כבר מעודכן', false);
      } finally {
        this.calSyncRunning = false;
        if (this.calSyncAgain) { this.calSyncAgain = false; this.CalSyncSchedule(); }
      }
    },

    // The page: { type: 'calSync', action: 'state' | 'list' | 'set' | 'now' | 'off', calendar, nth, remove }.
    async CalSyncHandle(m) {
      const action = Str(m, 'action');
      try {
        if (action === 'state') { this.CalSyncStatus(); return; }
        if (action === 'list') {
          this.CalSyncStatus({ busy: true });
          const a = await this.CalSyncScript({ op: 'list' });
          if (!a.ok) { this.CalSyncStatus({ listError: a.error }); this.Toast(a.error, true); return; }
          this.CalSyncStatus({ calendars: arr(a.calendars).filter(c => c && c.writable && Str(c, 'name')).map(c => ({ name: Trunc(Str(c, 'name'), 200), nth: Math.max(0, Int(c, 'nth')) })) });
          return;
        }
        if (action === 'set') {
          const calendar = Trunc(Str(m, 'calendar'), 200);
          if (!calendar) { this.Toast('בחר יומן', true); return; }
          this.settings.calSync = { on: true, calendar, nth: Math.max(0, Int(m, 'nth')) };
          this.SaveSettings();
          await this.CalSyncRun(true);
          return;
        }
        if (action === 'now') {
          if (!this.CalSyncConfig().on) { this.Toast('הסנכרון ליומן כבוי', true); return; }
          await this.CalSyncRun(true);
          return;
        }
        if (action === 'off') {
          const cfg = this.CalSyncConfig(), state = this.CalSyncLoad();
          clearTimeout(this.calSyncTimer);
          this.settings.calSync = { on: false, calendar: cfg.calendar, nth: cfg.nth };
          this.SaveSettings();
          if (Bool(m, 'remove')) {
            const ops = Object.keys(state.events).filter(k => state.events[k].uid).map(k => ({ key: k, op: 'delete', calendar: state.events[k].calendar, nth: state.events[k].nth || 0, uid: state.events[k].uid }));
            const a = ops.length ? await this.CalSyncScript({ op: 'apply', ops }) : { ok: true, results: [] };
            if (!a.ok) { this.CalSyncStatus(); this.Toast(a.error, true); return; }
            const res = syncResult(ops, a.results, {}, state.events);
            this.CalSyncSave({ events: res.next, last: state.last, error: '' });
            this.Toast(res.failed.length ? res.failed.length + ' אירועים לא הוסרו מהיומן' : 'הסנכרון כבוי, והבלוקים הוסרו מהיומן', res.failed.length > 0);
          } else {
            this.CalSyncSave({ events: {}, last: state.last, error: '' });   // the events stay in the calendar, and are the student's from now on
            this.Toast('הסנכרון כבוי. הבלוקים שכבר ביומן נשארים בו.', false);
          }
          this.CalSyncStatus();
        }
      } catch (ex) {
        this.Toast('הסנכרון ליומן נכשל: ' + (ex && ex.message || ex), true);
        this.CalSyncStatus();
      }
    },
  },
};
