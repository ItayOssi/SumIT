'use strict';
// The tasks ticket (macOS only, no C# counterpart; the ticket itself is src/web/tasks-ticket-ui.js). The page sends the items due
// in the next two days; from 09:00 each one due tomorrow gets one system notification, and a click on it opens the ticket.
// What was already said is kept as "id|date", so a task whose date moves is reminded again.

const path = require('path');
const platform = require('../platform');
const { Str, Trunc, readText, writeText, fileExists } = require('../util');

const RemindHour = 9, MaxItems = 50, MaxKept = 200;
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

module.exports = {
  methods: {
    TicketRemindedPath() { return this.ticketRemindedPath || path.join(platform.DataRoot, 'task-reminders.json'); },

    // The items from the page: { id, title, course, date }; anything else is dropped.
    TicketSetReminders(raw) {
      const list = [];
      for (const o of Array.isArray(raw) ? raw.slice(0, MaxItems) : []) {
        if (!o || typeof o !== 'object') continue;
        const id = Trunc(Str(o, 'id'), 120), title = Trunc(Str(o, 'title').trim(), 200), date = Str(o, 'date');
        if (!id || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        list.push({ id, title, course: Trunc(Str(o, 'course').trim(), 120), date });
      }
      this.ticketReminders = list;
      return list;
    },

    // Called on every tick of the status timer. Returns the bodies of the notifications it showed.
    TicketRemind(now, notify) {
      if (!Array.isArray(this.ticketReminders) || !this.ticketReminders.length || now.getHours() < RemindHour) return [];
      const tomorrow = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
      if (!Array.isArray(this.ticketReminded)) {
        try { const p = this.TicketRemindedPath(); this.ticketReminded = fileExists(p) ? JSON.parse(readText(p)) : []; } catch { this.ticketReminded = []; }
        if (!Array.isArray(this.ticketReminded)) this.ticketReminded = [];
      }
      const said = [];
      for (const it of this.ticketReminders) {
        const key = it.id + '|' + it.date;
        if (it.date !== tomorrow || this.ticketReminded.includes(key)) continue;
        this.ticketReminded.push(key);
        const body = it.title + (it.course ? ' · ' + it.course : '');
        (notify || ((t, b) => this.TicketNotify(t, b)))('⏰ מחר: ' + Trunc(it.title, 60), body);
        said.push(body);
      }
      if (said.length) {
        this.ticketReminded = this.ticketReminded.slice(-MaxKept);
        try { writeText(this.TicketRemindedPath(), JSON.stringify(this.ticketReminded)); } catch { }
      }
      return said;
    },

    // Shown also while the app is in front (it is said once); a click brings the window up with the ticket open.
    TicketNotify(title, body) {
      try {
        const { Notification } = require('electron');
        if (!Notification || !Notification.isSupported()) return;
        const n = new Notification({ title, body, silent: false });
        n.on('click', () => {
          try { if (this.win && !this.win.isDestroyed()) { this.win.show(); this.win.focus(); } } catch { }
          this.Send({ type: 'ticketOpen' });
        });
        n.show();
      } catch { }
    },
  },
};
