'use strict';
// The pomodoro timer lives in the page (src/web/pomodoro.js). This only schedules the system notification for the moment a
// phase ends, so it arrives on time even when the window is in the background and its timers are slowed down.

const { Str, Trunc } = require('../util');

const MaxAheadMs = 4 * 3600 * 1000;

module.exports = {
  methods: {
    // Shows the notification, unless the student is looking at the app (the page has its own message and sound).
    PomodoroNotify(title, body) {
      try {
        const { Notification } = require('electron');
        if (!Notification || !Notification.isSupported()) return;
        if (this.win && typeof this.win.isFocused === 'function' && this.win.isFocused()) return;
        new Notification({ title, body, silent: false }).show();
      } catch { }
    },

    CancelPomodoroAlert() {
      if (this.pomodoroTimer) { clearTimeout(this.pomodoroTimer); this.pomodoroTimer = null; }
    },

    // { endsAt (ms), title, body } schedules the alert, { cancel: true } removes it. One alert at a time.
    SchedulePomodoroAlert(m) {
      this.CancelPomodoroAlert();
      if (m && m.cancel === true) return;
      const delay = Number(m && m.endsAt) - Date.now();
      if (!Number.isFinite(delay) || delay < 0 || delay > MaxAheadMs) return;
      const title = Trunc(Str(m, 'title').trim(), 80) || 'SumIT', body = Trunc(Str(m, 'body').trim(), 160);
      this.pomodoroTimer = setTimeout(() => { this.pomodoroTimer = null; this.PomodoroNotify(title, body); }, delay);
      if (this.pomodoroTimer.unref) this.pomodoroTimer.unref();
    },
  },
};
