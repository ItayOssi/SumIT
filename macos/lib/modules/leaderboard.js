'use strict';
// A leaderboard of sparks among friends (macOS only; no C# counterpart). A student makes a group and gets a code of six
// letters; friends who type the code join it, and each one sees where they stand this week, by the sparks of the study track.
//
// Where it lives: Firestore of a Firebase project of SumIT (C.Firebase), reached through its REST API. Signing in is the Google
// account the app is already connected to (drive-sync.js): Google's id_token is handed to Firebase Auth, which answers with a
// token of its own. The rules of the project (macos/firebase/firestore.rules) let a student write only their own row, and read
// the rows of a group only when they are in it. What goes up: the name, the Google picture, the sparks of this week and in all,
// the level and the streak. Nothing of the summaries, the courses or the calendar.
//
// The rows of the others are read when the page asks; this student's row goes up a few seconds after the profile changes.

const crypto = require('crypto');
const { Str, Trunc, fileExists } = require('../util');
const C = require('../constants');

const CodeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // no I, O, 0 or 1: easy to read out loud
const MaxGroups = 5;
const MaxMembers = 50;
const PushQuietMs = 15000;
const PhotoBytes = 200 * 1024;

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return localDate(d); };
const weekStartOf = (s) => addDays(s, -parseDate(s).getDay());   // Sunday, as in the study track
const enc = encodeURIComponent;

function NewCode(bytes) {
  const b = bytes || crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += CodeChars[b[i] % CodeChars.length];
  return s;
}
// What the student typed: spaces, dashes and small letters are fine.
function CleanCode(s) { return String(s || '').toUpperCase().replace(/[\s\-_.]/g, ''); }
function CodeOk(s) { return new RegExp('^[' + CodeChars + ']{6}$').test(s); }
function PhotoOk(url) { return /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\/[^\s"'<>]{1,400}$/.test(String(url || '')); }

// Firestore keeps typed values: { fields: { name: { stringValue } , n: { integerValue: "5" } } }.
function ToFields(o) {
  const fields = {};
  for (const [k, v] of Object.entries(o)) fields[k] = typeof v === 'number' ? { integerValue: String(Math.max(0, Math.round(v) || 0)) } : { stringValue: String(v == null ? '' : v) };
  return { fields };
}
function FromDoc(doc) {
  const o = { id: String((doc && doc.name) || '').split('/').pop() };
  for (const [k, v] of Object.entries((doc && doc.fields) || {})) {
    if (!v || typeof v !== 'object') continue;
    if ('integerValue' in v) o[k] = Number(v.integerValue) || 0;
    else if ('doubleValue' in v) o[k] = Number(v.doubleValue) || 0;
    else if ('stringValue' in v) o[k] = String(v.stringValue);
  }
  return o;
}

// The rows of a group, as the page shows them: the sparks of another week count as 0, a streak not reported since yesterday
// is over, and equal sparks share a place.
function Ranking(rows, me, today) {
  const week = weekStartOf(today), yesterday = addDays(today, -1);
  const list = (rows || []).map(r => ({
    uid: Str(r, 'id'), name: Trunc(Str(r, 'name').trim(), 40) || 'סטודנט', photo: PhotoOk(r.photo) ? r.photo : '',
    week: Str(r, 'week') === week ? Math.max(0, Number(r.weekSparks) || 0) : 0, total: Math.max(0, Number(r.total) || 0),
    level: Math.max(1, Number(r.level) || 1), streak: Str(r, 'day') >= yesterday ? Math.max(0, Number(r.streak) || 0) : 0, me: Str(r, 'id') === me,
  }));
  list.sort((a, b) => b.week - a.week || b.total - a.total || a.name.localeCompare(b.name, 'he'));
  list.forEach((m, i) => { m.rank = i > 0 && list[i - 1].week === m.week ? list[i - 1].rank : i + 1; });
  return list;
}

module.exports = {
  NewCode, CleanCode, CodeOk, PhotoOk, ToFields, FromDoc, Ranking,
  methods: {
    get BoardConfig() {
      const f = C.Firebase || {};
      return { apiKey: process.env.SUMIT_FIREBASE_API_KEY || f.apiKey || '', project: process.env.SUMIT_FIREBASE_PROJECT || f.projectId || '' };
    },
    get BoardAuthUrl() { return (process.env.SUMIT_FIREBASE_AUTH_URL || 'https://identitytoolkit.googleapis.com/v1').replace(/\/+$/, ''); },
    get BoardDbUrl() {
      const base = (process.env.SUMIT_FIRESTORE_URL || 'https://firestore.googleapis.com/v1').replace(/\/+$/, '');
      return base + '/projects/' + enc(this.BoardConfig.project) + '/databases/(default)/documents';
    },
    BoardConfigured() { const c = this.BoardConfig; return !!(c.apiKey && c.project); },
    BoardGroups() { return Array.isArray(this.settings.boardGroups) ? this.settings.boardGroups.filter(g => g && CodeOk(Str(g, 'code'))) : []; },
    BoardSaveGroups(list) { this.settings.boardGroups = list.slice(0, MaxGroups).map(g => ({ code: g.code, name: Trunc(Str(g, 'name'), 40) })); this.SaveSettings(); },

    // Google's id_token (from the connection to Drive) for a token of Firebase, kept until a few minutes before it ends.
    async BoardAuth() {
      if (this.boardAuth && this.boardAuth.until - 120000 > Date.now()) return this.boardAuth;
      if (!this.DriveConnected()) throw new Error('צריך להתחבר עם Google בפרופיל.');
      const google = await this.DriveIdToken();
      const res = await fetch(this.BoardAuthUrl + '/accounts:signInWithIdp?key=' + enc(this.BoardConfig.apiKey), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postBody: 'id_token=' + enc(google.token) + '&providerId=google.com', requestUri: 'http://localhost', returnIdpCredential: false, returnSecureToken: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.idToken) throw new Error('טבלת החברים לא זמינה כרגע (' + ((body.error && body.error.message) || res.status) + ').');
      this.boardAuth = { token: body.idToken, uid: Str(body, 'localId'), photo: google.picture || Str(body, 'photoUrl'), until: Date.now() + (Number(body.expiresIn) || 3600) * 1000 };
      return this.boardAuth;
    },
    // One request to Firestore; once more with a new token on 401. 404 is null.
    async BoardFetch(rel, opts = {}) {
      for (let i = 0; ; i++) {
        const auth = await this.BoardAuth();
        const res = await fetch(this.BoardDbUrl + rel, Object.assign({}, opts, { headers: Object.assign({ authorization: 'Bearer ' + auth.token, 'content-type': 'application/json' }, opts.headers || {}) }));
        if (res.ok) return res.status === 204 ? {} : res.json().catch(() => ({}));
        if (res.status === 401 && i === 0) { this.boardAuth = null; continue; }
        if (res.status === 404) return null;
        const e = new Error(res.status === 403 ? 'אין הרשאה לקבוצה הזו.' : 'טבלת החברים לא זמינה כרגע (' + res.status + ').'); e.status = res.status; throw e;
      }
    },

    // This student's row: from the profile of the study track (zeros without one).
    BoardRow(auth, today) {
      let info = null;
      try { if (typeof this.TrackSparks === 'function' && fileExists(this.TrackFile)) info = this.TrackSparks(this.TrackLoad(), today); } catch { }
      return {
        name: Trunc(Str(this.settings, 'displayName').trim(), 40) || 'סטודנט', photo: PhotoOk(auth.photo) ? auth.photo : '',
        week: weekStartOf(today), weekSparks: info ? info.week.earned : 0, total: info ? info.total : 0, level: info ? info.level.level : 1,
        streak: info ? info.streak : 0, day: today, updated: new Date().toISOString(),
      };
    },
    async BoardWriteRow(code, auth, today) {
      await this.BoardFetch('/groups/' + enc(code) + '/members/' + enc(auth.uid), { method: 'PATCH', body: JSON.stringify(ToFields(this.BoardRow(auth, today))) });
    },
    async BoardPush() {
      const groups = this.BoardGroups();
      if (!groups.length || !this.BoardConfigured() || !this.DriveConnected()) return 0;
      const auth = await this.BoardAuth(), today = localDate(new Date());
      for (const g of groups) { try { await this.BoardWriteRow(g.code, auth, today); } catch { } }
      return groups.length;
    },
    // After the profile was saved: the row goes up when things are quiet for a few seconds.
    BoardSoon() {
      if (!this.BoardGroups().length || !this.BoardConfigured()) return;
      clearTimeout(this.boardTimer);
      this.boardTimer = setTimeout(() => { this.BoardPush().catch(() => { }); }, this.boardQuietMs != null ? this.boardQuietMs : PushQuietMs);
      if (this.boardTimer.unref) this.boardTimer.unref();
    },

    async BoardCreate(name) {
      if (this.BoardGroups().length >= MaxGroups) throw new Error('אפשר להיות בעד ' + MaxGroups + ' קבוצות.');
      const title = Trunc(String(name || '').trim(), 40) || 'הקבוצה שלי';
      const auth = await this.BoardAuth(), today = localDate(new Date());
      for (let i = 0; i < 6; i++) {
        const code = NewCode(this.boardRandom ? this.boardRandom() : null);
        try {
          await this.BoardFetch('/groups?documentId=' + code, { method: 'POST', body: JSON.stringify(ToFields({ name: title, owner: auth.uid, created: new Date().toISOString() })) });
        } catch (ex) { if (ex.status === 409) continue; throw ex; }   // the code is taken: another one
        await this.BoardWriteRow(code, auth, today);
        this.BoardSaveGroups(this.BoardGroups().concat([{ code, name: title }]));
        return code;
      }
      throw new Error('לא הצלחתי ליצור קבוצה. נסה שוב.');
    },
    async BoardJoin(typed) {
      const code = CleanCode(typed);
      if (!CodeOk(code)) throw new Error('הקוד הוא 6 אותיות ומספרים, למשל K7Q2MX.');
      if (this.BoardGroups().some(g => g.code === code)) return code;
      if (this.BoardGroups().length >= MaxGroups) throw new Error('אפשר להיות בעד ' + MaxGroups + ' קבוצות.');
      const group = await this.BoardFetch('/groups/' + code);
      if (!group) throw new Error('לא מצאתי קבוצה עם הקוד ' + code + '.');
      const auth = await this.BoardAuth();
      await this.BoardWriteRow(code, auth, localDate(new Date()));
      this.BoardSaveGroups(this.BoardGroups().concat([{ code, name: Str(FromDoc(group), 'name') || 'קבוצה' }]));
      return code;
    },
    async BoardLeave(code) {
      const auth = await this.BoardAuth().catch(() => null);
      if (auth) { try { await this.BoardFetch('/groups/' + enc(code) + '/members/' + enc(auth.uid), { method: 'DELETE' }); } catch { } }
      this.BoardSaveGroups(this.BoardGroups().filter(g => g.code !== code));
    },
    async BoardList() {
      const auth = await this.BoardAuth(), today = localDate(new Date()), out = [];
      for (const g of this.BoardGroups()) {
        try {
          await this.BoardWriteRow(g.code, auth, today);
          const body = await this.BoardFetch('/groups/' + enc(g.code) + '/members?pageSize=' + MaxMembers);
          const rows = ((body && body.documents) || []).map(FromDoc);
          const members = Ranking(rows, auth.uid, today);
          for (const m of members) m.photo = m.photo ? await this.BoardPhoto(m.photo) : '';
          out.push({ code: g.code, name: g.name, members });
        } catch (ex) { out.push({ code: g.code, name: g.name, members: [], error: ex.message }); }
      }
      return out;
    },
    // The page loads images only from itself: a Google picture comes to it as a data: URL, kept for the session.
    async BoardPhoto(url) {
      this.boardPhotos = this.boardPhotos || new Map();
      if (this.boardPhotos.has(url)) return this.boardPhotos.get(url);
      let data = '';
      try {
        const res = await fetch(url.replace(/=s\d+(-c)?$/, '=s96-c'));
        const type = res.headers.get('content-type') || '';
        const buf = Buffer.from(await res.arrayBuffer());
        if (res.ok && /^image\/(png|jpeg|webp|gif)/.test(type) && buf.length <= PhotoBytes) data = 'data:' + type.split(';')[0] + ';base64,' + buf.toString('base64');
      } catch { }
      this.boardPhotos.set(url, data);
      return data;
    },

    BoardState(extra) {
      return Object.assign({ type: 'board', configured: this.BoardConfigured(), connected: this.DriveConnected(), groups: this.BoardGroups(), max: MaxGroups }, extra || {});
    },
    async BoardHandle(m) {
      const op = Str(m, 'op');
      try {
        if (op === 'state' || !this.BoardConfigured()) { this.Send(this.BoardState()); return; }
        if (op === 'create') { const code = await this.BoardCreate(m.name); this.Send(this.BoardState({ list: await this.BoardList(), focus: code, created: code })); return; }
        if (op === 'join') { const code = await this.BoardJoin(m.code); this.Send(this.BoardState({ list: await this.BoardList(), focus: code, joined: code })); return; }
        if (op === 'leave') { await this.BoardLeave(Str(m, 'code')); this.Send(this.BoardState({ list: this.BoardGroups().length ? await this.BoardList() : [] })); return; }
        if (op === 'list') { this.Send(this.BoardState({ list: this.BoardGroups().length && this.DriveConnected() ? await this.BoardList() : [] })); return; }
      } catch (ex) { this.Send(this.BoardState({ error: ex.message || String(ex) })); }
    },
  },
};
