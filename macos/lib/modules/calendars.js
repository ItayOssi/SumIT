'use strict';
// Calendars (iCal) for "what to do today": the student pastes the secret iCal address of a calendar (Google Calendar, Outlook,
// iCloud) or picks an .ics file. The host only fetches and keeps the text; the page reads it (src/web/ical.js), and the events
// block time in the plan. The secret address is a key to read the calendar, so it is kept encrypted like an API key and is never
// sent to the page again. The calendar text stays on this computer, not in the OneDrive folder.

const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const { Str, Trunc, Protect, Unprotect, guidN, fileExists, mkdirp, readText, writeText } = require('../util');
const platform = require('../platform');
const C = require('../constants');

const MaxBytes = 5 * 1024 * 1024, MaxCalendars = 5, RefreshMs = 30 * 60 * 1000;

// An IPv4 address that is not on the internet: this computer, the home or office network, link-local, shared.
function PrivateIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [+m[1], +m[2]];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

module.exports = {
  methods: {
    CalendarsDir() { return this.calendarsDir || path.join(platform.DataRoot, 'calendars'); },
    CalendarFile(id) { return path.join(this.CalendarsDir(), id + '.ics'); },
    CalendarList() { return Array.isArray(this.settings.calendars) ? this.settings.calendars.filter(c => c && /^[0-9a-f]{32}$/.test(Str(c, 'id'))) : []; },

    // The address of a calendar as the app will fetch it: https only, and not an address inside the student's own network.
    // (For tests, SUMIT_CALENDAR_TEST_HOST allows one more host, over http too.)
    CalendarUrlCheck(raw) {
      let u;
      try { u = new URL(String(raw || '').trim().replace(/^webcals?:\/\//i, 'https://')); } catch { return { ok: false, text: 'הכתובת לא תקינה' }; }
      const host = u.hostname.toLowerCase(), test = (process.env.SUMIT_CALENDAR_TEST_HOST || '').toLowerCase();
      if (test && host === test) return { ok: true, url: u.href };
      if (u.protocol !== 'https:') return { ok: false, text: 'אפשר רק כתובת שמתחילה ב-https' };
      if (u.username || u.password) return { ok: false, text: 'הכתובת לא יכולה לכלול שם משתמש וסיסמה' };
      if (host === 'localhost' || !host.includes('.') || host.startsWith('[') || /\.(local|localhost|internal|lan|home|corp)$/.test(host) || PrivateIPv4(host))
        return { ok: false, text: 'הכתובת צריכה להיות של שרת ברשת, לא של המחשב או הרשת הביתית' };
      return { ok: true, url: u.href };
    },

    CheckedCalendarText(text) {
      text = String(text || '').replace(/^﻿/, '');
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('זה לא קובץ יומן (iCal)');
      return text;
    },

    async FetchCalendarText(raw) {
      const chk = this.CalendarUrlCheck(raw);
      if (!chk.ok) throw new Error(chk.text);
      const resp = await fetch(chk.url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'SumIT/' + C.Version, Accept: 'text/calendar, text/plain, */*' } });
      if (!this.CalendarUrlCheck(resp.url || chk.url).ok) throw new Error('הכתובת הפנתה לכתובת שאסור להתחבר אליה');
      if (!resp.ok) throw new Error('השרת ענה ' + resp.status + (resp.status === 404 || resp.status === 410 ? '. הכתובת כנראה בוטלה או שונתה, צריך להדביק כתובת חדשה' : ''));
      if (Number(resp.headers.get('content-length')) > MaxBytes) throw new Error('היומן גדול מדי');
      const chunks = []; let total = 0;
      const reader = resp.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MaxBytes) { try { await reader.cancel(); } catch { } throw new Error('היומן גדול מדי'); }
        chunks.push(Buffer.from(value));
      }
      return this.CheckedCalendarText(Buffer.concat(chunks).toString('utf8'));
    },

    SaveCalendarFile(id, text) { mkdirp(this.CalendarsDir()); writeText(this.CalendarFile(id), text); },

    SendCalendars() {
      const list = this.CalendarList().map(c => {
        let ics = '';
        try { const f = this.CalendarFile(c.id); if (fileExists(f)) ics = readText(f); } catch { }
        return { id: c.id, name: Str(c, 'name'), source: Str(c, 'source'), host: Str(c, 'host'), updated: Number(c.updated) || 0, error: Str(c, 'error'), ics };
      });
      this.Send({ type: 'calendars', list });
    },

    CalendarStatus(busy, text, error) { this.Send({ type: 'calendarStatus', busy: !!busy, text: text || '', error: !!error }); },

    async AddCalendar(m) {
      try {
        const list = this.CalendarList();
        if (list.length >= MaxCalendars) throw new Error('אפשר לחבר עד ' + MaxCalendars + ' יומנים');
        const chk = this.CalendarUrlCheck(Str(m, 'url'));
        if (!chk.ok) throw new Error(chk.text);
        if (list.some(c => c.source === 'url' && Unprotect(Str(c, 'url')) === chk.url)) throw new Error('היומן הזה כבר מחובר');
        this.CalendarStatus(true, 'מוריד את היומן...');
        const text = await this.FetchCalendarText(chk.url);
        const id = guidN(), host = new URL(chk.url).hostname;
        this.SaveCalendarFile(id, text);
        list.push({ id, name: Trunc(Str(m, 'name').trim(), 60) || host, source: 'url', url: Protect(chk.url), host, updated: Date.now(), error: '' });
        this.settings.calendars = list; this.SaveSettings();
        this.SendCalendars(); this.CalendarStatus(false, 'היומן נוסף', false);
      } catch (ex) { this.CalendarStatus(false, ex.message || String(ex), true); }
    },

    async ImportCalendarFile() {
      if (!dialog || !dialog.showOpenDialog) return;
      const res = await dialog.showOpenDialog(this.win, { title: 'בחר קובץ יומן (ICS)', filters: [{ name: 'יומן', extensions: ['ics', 'ical', 'ifb'] }], properties: ['openFile'] });
      if (!res.canceled && res.filePaths.length) await this.ImportCalendarPath(res.filePaths[0]);
    },

    async ImportCalendarPath(file) {
      try {
        const list = this.CalendarList();
        if (list.length >= MaxCalendars) throw new Error('אפשר לחבר עד ' + MaxCalendars + ' יומנים');
        if (fs.statSync(file).size > MaxBytes) throw new Error('הקובץ גדול מדי');
        const text = this.CheckedCalendarText(fs.readFileSync(file, 'utf8'));
        const id = guidN();
        this.SaveCalendarFile(id, text);
        list.push({ id, name: Trunc(path.basename(file, path.extname(file)), 60) || 'יומן', source: 'file', host: '', updated: Date.now(), error: '' });
        this.settings.calendars = list; this.SaveSettings();
        this.SendCalendars(); this.CalendarStatus(false, 'היומן יובא מהקובץ', false);
      } catch (ex) { this.CalendarStatus(false, ex.message || String(ex), true); }
    },

    RemoveCalendar(m) {
      const id = Str(m, 'id');
      if (!/^[0-9a-f]{32}$/.test(id)) return;
      this.settings.calendars = this.CalendarList().filter(c => c.id !== id);
      this.SaveSettings();
      try { const f = this.CalendarFile(id); if (fileExists(f)) fs.unlinkSync(f); } catch { }
      this.SendCalendars();
    },

    // Every calendar that came from an address, fetched again. A failure keeps the last copy and says why.
    async RefreshCalendars(manual) {
      if (this.calendarRefreshing) return;
      this.calendarRefreshing = true;
      this.lastCalendarRefresh = Date.now();
      try {
        const list = this.CalendarList();
        if (manual) this.CalendarStatus(true, 'מרענן...');
        let changed = false;
        for (const c of list) {
          if (c.source !== 'url') continue;
          try { this.SaveCalendarFile(c.id, await this.FetchCalendarText(Unprotect(Str(c, 'url')))); c.updated = Date.now(); c.error = ''; }
          catch (ex) { c.error = Trunc(ex.message || String(ex), 160); }
          changed = true;
        }
        if (changed) { this.settings.calendars = list; this.SaveSettings(); }
        this.SendCalendars();
        if (manual) this.CalendarStatus(false, '', false);
      } finally { this.calendarRefreshing = false; }
    },

    RefreshCalendarsIfStale() {
      if (!this.CalendarList().some(c => c.source === 'url')) return;
      if (Date.now() - (this.lastCalendarRefresh || 0) > RefreshMs) this.RefreshCalendars(false);
    },
  },
};
