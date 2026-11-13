'use strict';
// Sync with Google Drive (macOS only; no C# counterpart): the student signs in with Google once, and the study folder
// (courses, summaries, cards, visuals, the study track profile and a copy of the settings without keys or paths) is kept in
// a "SumIT" folder of their Drive, so another computer that signs in to the same account gets all of it.
//
// Sign-in: the system browser, a redirect to 127.0.0.1 on a free port, and PKCE (Google's flow for desktop apps).
// Scope: drive.file only, so the app sees only the files it created, never the rest of the Drive.
// The refresh token is kept encrypted (safeStorage, the Keychain) in the settings of this computer only.
//
// Each sync compares three things for every file: what is on this computer, what is in Drive, and what both were at the
// last sync (kept in drive-sync.json, outside the synced folder). Only what changed moves. A file changed on both sides
// keeps both versions; a deleted file goes to the Trash, not away for good; and a sync that would delete many files at
// once stops and asks first.

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Str, Dict, IsInside, fileExists, dirExists, mkdirp, readText, writeText, Protect, Unprotect } = require('../util');
const platform = require('../platform');
const C = require('../constants');

const Scope = 'https://www.googleapis.com/auth/drive.file openid email';
const FolderMime = 'application/vnd.google-apps.folder';
const MaxFile = 100 * 1024 * 1024;           // larger files stay on this computer
const SimpleUpload = 5 * 1024 * 1024;        // above this, a resumable upload
const SyncEveryMs = 5 * 60 * 1000;
const QuietMs = 5000;                        // a file written in the last seconds waits for the next sync
const MassDelete = { count: 25, share: 0.3 };
const SkipDirs = new Set(['.sumit-math', '.git', 'node_modules', '.Trash', '.sumit-sync-tmp']);
const SkipFile = /^(\.DS_Store|Thumbs\.db|desktop\.ini|~\$.*|\..*\.tmp|.*\.(tmp|partial|crdownload|rendering|part|download|sumit-download))$|^\.~/i;
const SettingsRel = '.sumit/settings-sync.json';
// Settings that are about the student, not about this computer: never keys, tokens, folders or window places.
const SettingsSkip = /key|token|secret|password|dir$|root$|path|drive|window|bounds|zoom|lastupdate|install|machine|device|calsync/i;

const enc = (s) => encodeURIComponent(s);
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const two = (n) => String(n).padStart(2, '0');

// What to do with each file. local, remote and base map a relative path to { md5 }; remote also has { id }.
// Pure, so the rules are tested without Drive.
function SyncPlan(local, remote, base) {
  const plan = [];
  const all = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)]);
  for (const rel of Array.from(all).sort()) {
    const L = local[rel], R = remote[rel], B = base[rel];
    if (L && R) {
      if (L.md5 === R.md5) plan.push({ rel, act: 'same' });
      else if (B && L.md5 === B.md5) plan.push({ rel, act: 'download' });
      else if (B && R.md5 === B.md5) plan.push({ rel, act: 'upload' });
      else plan.push({ rel, act: 'conflict' });
    } else if (L) {
      plan.push({ rel, act: B && L.md5 === B.md5 ? 'deleteLocal' : 'upload' });
    } else if (R) {
      plan.push({ rel, act: B && R.md5 === B.md5 ? 'deleteRemote' : 'download' });
    } else plan.push({ rel, act: 'forget' });
  }
  return plan;
}

// "סיכום.html" -> "סיכום (מ-Drive 13.11 21-40).html": the other side's version of a file changed on both.
function ConflictName(rel, when) {
  const d = when || new Date(), ext = path.posix.extname(rel), stem = rel.slice(0, rel.length - ext.length);
  return stem + ' (מ-Drive ' + two(d.getDate()) + '.' + two(d.getMonth() + 1) + ' ' + two(d.getHours()) + '-' + two(d.getMinutes()) + ')' + ext;
}

function SyncableSettings(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings || {})) {
    if (SettingsSkip.test(k)) continue;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
    else if (Array.isArray(v) && v.every(x => ['string', 'number', 'boolean'].includes(typeof x))) out[k] = v.slice();
  }
  return out;
}

module.exports = {
  SyncPlan, ConflictName, SyncableSettings,
  methods: {
    DrivePlan(local, remote, base) { return SyncPlan(local, remote, base); },
    DriveConflictName(rel, when) { return ConflictName(rel, when); },
    DriveSyncableSettings(s) { return SyncableSettings(s); },

    // ---------- configuration ----------
    get DriveClientId() { return process.env.SUMIT_GOOGLE_CLIENT_ID || C.GoogleClientId || ''; },
    // The secret of a desktop client is not a real secret (Google says so), but it stays out of the public code:
    // the release workflow writes lib/google-oauth.json from a repository secret, and a developer sets the environment.
    get DriveClientSecret() {
      if (process.env.SUMIT_GOOGLE_CLIENT_SECRET) return process.env.SUMIT_GOOGLE_CLIENT_SECRET;
      try { return Str(JSON.parse(readText(path.join(__dirname, '..', 'google-oauth.json'))), 'secret'); } catch { return ''; }
    },
    get DriveApi() { return (process.env.SUMIT_DRIVE_API || 'https://www.googleapis.com').replace(/\/+$/, ''); },
    get DriveTokenUrl() { return process.env.SUMIT_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token'; },
    get DriveRevokeUrl() { return process.env.SUMIT_GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke'; },
    get DriveAuthUrl() { return process.env.SUMIT_GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth'; },
    get DriveStateFile() { return this.driveStateFile || path.join(platform.DataRoot, 'drive-sync.json'); },
    DriveConnected() { return !!Str(Dict(this.settings, 'drive') || {}, 'refresh'); },

    DriveStatus(extra) {
      const d = Dict(this.settings, 'drive') || {};
      return Object.assign({ type: 'driveSync', ready: true, configured: !!(this.DriveClientId && this.DriveClientSecret), connected: this.DriveConnected(),
        email: Str(d, 'email'), last: Str(d, 'last'), busy: !!this.driveBusy, conflicts: Array.isArray(d.conflicts) ? d.conflicts.slice(-10) : [] }, extra || {});
    },
    DriveSend(extra) { this.Send(this.DriveStatus(extra)); },

    // ---------- signing in ----------
    // Opens Google's page in the browser and waits for its answer on 127.0.0.1. open(url) is the browser (tests pass their own).
    async DriveConnect(open) {
      if (!this.DriveClientId || !this.DriveClientSecret) throw new Error('החיבור ל-Google עוד לא מוגדר בגרסה הזו של SumIT.');
      const verifier = b64url(crypto.randomBytes(32)), challenge = b64url(crypto.createHash('sha256').update(verifier).digest()), state = b64url(crypto.randomBytes(16));
      let finish;
      const answer = new Promise((resolve, reject) => { finish = { resolve, reject }; });
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
        const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html dir="rtl" lang="he"><meta charset="utf-8"><title>SumIT</title><body style="font:16px -apple-system,sans-serif;display:grid;place-items:center;height:90vh;margin:0">'
          + (ok ? '<div style="text-align:center"><div style="font-size:42px">✓</div><h2>SumIT מחובר ל-Google Drive</h2><p>אפשר לסגור את החלון ולחזור לאפליקציה.</p></div>'
            : '<div style="text-align:center"><h2>ההתחברות לא הושלמה</h2><p>חזור ל-SumIT ונסה שוב.</p></div>') + '</body></html>');
        if (u.searchParams.get('state') !== state) return;   // not our request: keep waiting
        if (ok) finish.resolve(u.searchParams.get('code')); else finish.reject(new Error(u.searchParams.get('error') === 'access_denied' ? 'ההתחברות בוטלה.' : 'Google לא אישר את ההתחברות.'));
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const redirect = 'http://127.0.0.1:' + server.address().port;
      const url = this.DriveAuthUrl + '?' + [['client_id', this.DriveClientId], ['redirect_uri', redirect], ['response_type', 'code'], ['scope', Scope], ['code_challenge', challenge],
        ['code_challenge_method', 'S256'], ['state', state], ['access_type', 'offline'], ['prompt', 'consent']].map(([k, v]) => k + '=' + enc(v)).join('&');
      this.driveLogin = { cancel: () => finish.reject(new Error('ההתחברות בוטלה.')) };
      const timer = setTimeout(() => finish.reject(new Error('ההתחברות לא הושלמה בזמן. נסה שוב.')), 5 * 60 * 1000);
      try {
        (open || ((u) => require('electron').shell.openExternal(u)))(url);
        const code = await answer;
        const tok = await this.DriveTokenRequest({ code, client_id: this.DriveClientId, client_secret: this.DriveClientSecret, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect });
        if (!tok.refresh_token) throw new Error('Google לא החזיר הרשאה קבועה. נסה להתחבר שוב.');
        let email = '';
        try { email = Str(JSON.parse(Buffer.from(String(tok.id_token || '').split('.')[1] || '', 'base64').toString('utf8')), 'email'); } catch { }
        this.settings.drive = { refresh: Protect(tok.refresh_token), email, connected: new Date().toISOString(), last: '', root: '' };
        this.driveAccess = { token: tok.access_token, until: Date.now() + (Number(tok.expires_in) || 3000) * 1000 };
        this.SaveSettings();
        return email;
      } finally { clearTimeout(timer); server.close(); this.driveLogin = null; }
    },

    async DriveTokenRequest(form) {
      const res = await fetch(this.DriveTokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(body.error === 'invalid_grant' ? 'ההרשאה של Google פגה. התחבר שוב.' : 'Google לא אישר את ההתחברות (' + (body.error || res.status) + ').'); e.grant = body.error === 'invalid_grant'; throw e; }
      return body;
    },

    async DriveToken() {
      if (this.driveAccess && this.driveAccess.until - 60000 > Date.now()) return this.driveAccess.token;
      const refresh = Unprotect(Str(Dict(this.settings, 'drive') || {}, 'refresh'));
      if (!refresh) throw new Error('לא מחובר ל-Google Drive.');
      try {
        const tok = await this.DriveTokenRequest({ refresh_token: refresh, client_id: this.DriveClientId, client_secret: this.DriveClientSecret, grant_type: 'refresh_token' });
        this.driveAccess = { token: tok.access_token, until: Date.now() + (Number(tok.expires_in) || 3000) * 1000 };
        return tok.access_token;
      } catch (ex) {
        // Revoked in the Google account, or expired: this computer is no longer connected (its files stay).
        if (ex.grant) { delete this.settings.drive; this.driveAccess = null; this.SaveSettings(); }
        throw ex;
      }
    },

    async DriveDisconnect() {
      const refresh = Unprotect(Str(Dict(this.settings, 'drive') || {}, 'refresh'));
      if (refresh) { try { await fetch(this.DriveRevokeUrl + '?token=' + enc(refresh), { method: 'POST' }); } catch { } }
      delete this.settings.drive; this.driveAccess = null; this.SaveSettings();
      try { fs.unlinkSync(this.DriveStateFile); } catch { }
    },

    // ---------- Drive requests ----------
    // One request with the token; again after a new token on 401, and after a pause on 429 or a server error.
    async DriveFetch(url, opts = {}, tries = 4) {
      for (let i = 0; ; i++) {
        const token = await this.DriveToken();
        const res = await fetch(url.startsWith('http') ? url : this.DriveApi + url, Object.assign({}, opts, { headers: Object.assign({ authorization: 'Bearer ' + token }, opts.headers || {}) }));
        if (res.ok) return res;
        if (res.status === 401 && i < tries) { this.driveAccess = null; continue; }
        if ((res.status === 429 || res.status >= 500 || res.status === 403) && i < tries) {
          const text = res.status === 403 ? await res.text() : '';
          if (res.status !== 403 || /rateLimit|userRateLimit/i.test(text)) { await sleep(Math.min(8000, 500 * 2 ** i) * (this.driveFast ? 0.01 : 1)); continue; }
          throw new Error('Google Drive סירב (' + res.status + ').');
        }
        const msg = await res.text().catch(() => '');
        throw new Error('Google Drive: ' + res.status + (msg ? ' ' + msg.slice(0, 160) : ''));
      }
    },
    async DriveJson(url, opts) { return (await this.DriveFetch(url, opts)).json(); },

    // All the files and folders SumIT made, with their paths under the root "SumIT" folder.
    async DriveListRemote(rootId) {
      const items = [];
      let page = '';
      do {
        const q = enc("trashed=false and appProperties has { key='sumit' and value='1' }");
        const r = await this.DriveJson('/drive/v3/files?q=' + q + '&pageSize=1000&spaces=drive&fields=' + enc('nextPageToken,files(id,name,mimeType,md5Checksum,size,parents)') + (page ? '&pageToken=' + enc(page) : ''));
        items.push(...(r.files || [])); page = r.nextPageToken || '';
      } while (page);
      const byId = new Map(items.map(f => [f.id, f]));
      const relOf = (f, depth = 0) => {
        if (depth > 40) return null;
        const parent = (f.parents || [])[0];
        if (parent === rootId) return f.name;
        const p = byId.get(parent);
        if (!p || p.mimeType !== FolderMime) return null;
        const up = relOf(p, depth + 1);
        return up === null ? null : up + '/' + f.name;
      };
      const files = {}, folders = {};
      for (const f of items) {
        const rel = relOf(f);
        if (rel === null) continue;
        if (f.mimeType === FolderMime) folders[rel] = f.id;
        else if (f.md5Checksum && !files[rel]) files[rel] = { id: f.id, md5: f.md5Checksum, size: Number(f.size) || 0 };
      }
      return { files, folders };
    },

    async DriveRoot() {
      const d = this.settings.drive;
      const q = enc("trashed=false and mimeType='" + FolderMime + "' and appProperties has { key='sumitRoot' and value='1' }");
      const found = await this.DriveJson('/drive/v3/files?q=' + q + '&spaces=drive&fields=' + enc('files(id,name)'));
      if (found.files && found.files.length) { d.root = found.files[0].id; return d.root; }
      const made = await this.DriveJson('/drive/v3/files?fields=id', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'SumIT', mimeType: FolderMime, appProperties: { sumitRoot: '1' } }) });
      d.root = made.id; return d.root;
    },

    async DriveFolder(relDir, ctx) {
      if (!relDir) return ctx.root;
      if (ctx.folders[relDir]) return ctx.folders[relDir];
      const parent = await this.DriveFolder(path.posix.dirname(relDir) === '.' ? '' : path.posix.dirname(relDir), ctx);
      const made = await this.DriveJson('/drive/v3/files?fields=id', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: path.posix.basename(relDir), mimeType: FolderMime, parents: [parent], appProperties: { sumit: '1' } }) });
      ctx.folders[relDir] = made.id;
      return made.id;
    },

    // A new file (id empty) or new content for one that is there.
    async DriveUpload(rel, buf, id, ctx) {
      const meta = id ? {} : { name: path.posix.basename(rel), parents: [await this.DriveFolder(path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), ctx)], appProperties: { sumit: '1' } };
      const base = '/upload/drive/v3/files' + (id ? '/' + id : '');
      const method = id ? 'PATCH' : 'POST';
      if (buf.length <= SimpleUpload) {
        const boundary = 'sumit' + crypto.randomBytes(8).toString('hex');
        const body = Buffer.concat([Buffer.from('--' + boundary + '\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary + '\r\ncontent-type: application/octet-stream\r\n\r\n'), buf, Buffer.from('\r\n--' + boundary + '--')]);
        return this.DriveJson(base + '?uploadType=multipart&fields=id,md5Checksum', { method, headers: { 'content-type': 'multipart/related; boundary=' + boundary }, body });
      }
      const start = await this.DriveFetch(base + '?uploadType=resumable&fields=id,md5Checksum', { method, headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'application/octet-stream' }, body: JSON.stringify(meta) });
      const where = start.headers.get('location');
      if (!where) throw new Error('Google Drive לא פתח העלאה.');
      return this.DriveJson(where, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: buf });
    },

    async DriveDownload(id) { return Buffer.from(await (await this.DriveFetch('/drive/v3/files/' + enc(id) + '?alt=media')).arrayBuffer()); },
    async DriveTrashRemote(id) { await this.DriveFetch('/drive/v3/files/' + enc(id) + '?fields=id', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); },

    // ---------- this computer ----------
    DriveSkip(full, name, isDir) {
      if (isDir) return SkipDirs.has(name) || (this.RecordingsDir && IsInside(full, this.RecordingsDir)) || full === this.RecordingsDir;
      return SkipFile.test(name);
    },

    // Every file of the study folder with its md5 (from the last sync when its size and time did not change).
    DriveScanLocal(root, known) {
      const out = {}, now = Date.now();
      const walk = (dir, rel) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const full = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
          if (e.isSymbolicLink()) continue;
          if (e.isDirectory()) { if (!this.DriveSkip(full, e.name, true)) walk(full, r); continue; }
          if (!e.isFile() || this.DriveSkip(full, e.name, false)) continue;
          let st; try { st = fs.statSync(full); } catch { continue; }
          if (st.size > MaxFile) continue;
          if (now - st.mtimeMs < QuietMs && r !== SettingsRel) { out[r] = { busy: true }; continue; }   // (the settings file is written by the sync itself)
          const k = known[r];
          const sum = k && k.size === st.size && k.mtime === Math.round(st.mtimeMs) && k.md5 ? k.md5 : md5(fs.readFileSync(full));
          out[r] = { md5: sum, size: st.size, mtime: Math.round(st.mtimeMs) };
        }
      };
      walk(root, '');
      return out;
    },

    DriveLoadState(root) {
      try {
        const s = JSON.parse(readText(this.DriveStateFile));
        // The base belongs to one folder and one Drive folder: after a change of either, nothing is known (so nothing is deleted).
        if (s && s.root === root && s.remoteRoot === Str(this.settings.drive, 'root') && s.files) return s;
      } catch { }
      return { root, remoteRoot: Str(this.settings.drive, 'root'), files: {} };
    },
    DriveSaveState(state) { try { mkdirp(path.dirname(this.DriveStateFile)); writeText(this.DriveStateFile, JSON.stringify(state)); } catch { } },

    // Deleted here because it was deleted in Drive: to the Trash, so it can come back.
    async DriveTrashLocal(full) {
      if (this.driveTrash) return this.driveTrash(full);
      try { await require('electron').shell.trashItem(full); } catch { fs.rmSync(full, { force: true }); }
    },

    // The settings that travel: written into the synced folder when they changed here, taken from it when another computer changed them.
    DriveSettingsOut(root) {
      const file = path.join(root, SettingsRel), mine = SyncableSettings(this.settings), d = this.settings.drive;
      const sig = JSON.stringify(mine);
      if (d.settingsSig === sig && fileExists(file)) return;
      let cur = null; try { cur = JSON.parse(readText(file)); } catch { }
      if (cur && JSON.stringify(cur.settings) === sig) { d.settingsSig = sig; return; }
      if (cur && d.settingsSig && cur.updated > (d.settingsApplied || '')) return;   // another computer's newer settings wait to be taken in
      const updated = new Date().toISOString();
      mkdirp(path.dirname(file)); writeText(file, JSON.stringify({ updated, settings: mine }, null, 1));
      d.settingsSig = sig; d.settingsApplied = updated;   // our own, not something to take in
    },
    DriveSettingsIn(root) {
      const file = path.join(root, SettingsRel), d = this.settings.drive;
      let cur = null; try { cur = JSON.parse(readText(file)); } catch { return false; }
      if (!cur || !cur.settings || !cur.updated || cur.updated <= (d.settingsApplied || '')) return false;
      for (const [k, v] of Object.entries(SyncableSettings(cur.settings))) this.settings[k] = v;
      d.settingsApplied = cur.updated; d.settingsSig = JSON.stringify(SyncableSettings(this.settings));
      return true;
    },

    // ---------- the sync ----------
    async DriveSync(opts = {}) {
      if (!this.DriveConnected()) return null;
      if (this.driveBusy) return null;
      this.driveBusy = true;
      const counts = { up: 0, down: 0, deleted: 0, conflicts: 0, same: 0 }, conflicts = [];
      const root = this.AppRoot;
      try {
        if (!root || !dirExists(root)) throw new Error('תיקיית הקורסים לא נמצאה.');
        this.DriveSend({ busy: true, progress: { done: 0, total: 0 } });
        const rootId = await this.DriveRoot();
        const state = this.DriveLoadState(root);
        state.remoteRoot = rootId;
        const remote = await this.DriveListRemote(rootId);
        // A computer that joins an account takes the settings that are there first; its own go up from the next sync.
        if (!remote.files[SettingsRel] || state.files[SettingsRel]) this.DriveSettingsOut(root);
        const local = this.DriveScanLocal(root, state.files);
        const busy = new Set(Object.keys(local).filter(r => local[r].busy));
        for (const r of busy) delete local[r];
        const plan = SyncPlan(local, remote.files, state.files).filter(p => !busy.has(p.rel));
        const deletes = plan.filter(p => p.act === 'deleteLocal' || p.act === 'deleteRemote').length;
        const known = Object.keys(state.files).length;
        if (!opts.allowDeletes && deletes >= MassDelete.count && deletes > known * MassDelete.share) {
          const e = new Error('הסנכרון עצר: הוא היה מוחק ' + deletes + ' קבצים בבת אחת. בדוק שתיקיית הקורסים נכונה, ואם כן, אשר את הסנכרון.'); e.massDelete = deletes; throw e;
        }
        const ctx = { root: rootId, folders: remote.folders };
        const work = plan.filter(p => p.act !== 'same' && p.act !== 'forget');
        let done = 0;
        const step = () => { done++; if (done % 5 === 0 || done === work.length) this.DriveSend({ busy: true, progress: { done, total: work.length } }); };
        for (const p of plan) {
          const full = path.join(root, ...p.rel.split('/'));
          if (!IsInside(full, root)) continue;
          const L = local[p.rel], R = remote.files[p.rel];
          try {
            if (p.act === 'same') { state.files[p.rel] = { id: R.id, md5: L.md5, size: L.size, mtime: L.mtime }; counts.same++; continue; }
            if (p.act === 'forget') { delete state.files[p.rel]; continue; }
            if (p.act === 'upload') {
              const r = await this.DriveUpload(p.rel, fs.readFileSync(full), R ? R.id : '', ctx);
              state.files[p.rel] = { id: r.id, md5: r.md5Checksum || L.md5, size: L.size, mtime: L.mtime }; counts.up++;
            } else if (p.act === 'download') {
              const buf = await this.DriveDownload(R.id);
              mkdirp(path.dirname(full)); const tmp = full + '.sumit-download'; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, full);
              const st = fs.statSync(full);
              state.files[p.rel] = { id: R.id, md5: md5(buf), size: st.size, mtime: Math.round(st.mtimeMs) }; counts.down++;
            } else if (p.act === 'deleteLocal') {
              await this.DriveTrashLocal(full); delete state.files[p.rel]; counts.deleted++;
            } else if (p.act === 'deleteRemote') {
              await this.DriveTrashRemote(R.id); delete state.files[p.rel]; counts.deleted++;
            } else if (p.act === 'conflict') {
              // Both changed: Drive's version is kept here under another name (and goes up as a new file), this computer's goes up in its place.
              const other = ConflictName(p.rel, new Date()), otherFull = path.join(root, ...other.split('/'));
              const buf = await this.DriveDownload(R.id);
              fs.writeFileSync(otherFull, buf);
              const up1 = await this.DriveUpload(other, buf, '', ctx), st1 = fs.statSync(otherFull);
              state.files[other] = { id: up1.id, md5: md5(buf), size: st1.size, mtime: Math.round(st1.mtimeMs) };
              const up2 = await this.DriveUpload(p.rel, fs.readFileSync(full), R.id, ctx);
              state.files[p.rel] = { id: up2.id, md5: up2.md5Checksum || L.md5, size: L.size, mtime: L.mtime };
              counts.conflicts++; conflicts.push(other);
            }
          } catch (ex) { if (/401|לא מחובר|פגה/.test(ex.message)) throw ex; counts.failed = (counts.failed || 0) + 1; this.Diagnostic && this.Diagnostic('drive-sync', p.act, ex.message); }
          step();
        }
        state.root = root;
        this.DriveSaveState(state);
        const settingsChanged = this.DriveSettingsIn(root);
        const d = this.settings.drive;
        d.last = new Date().toISOString();
        if (conflicts.length) d.conflicts = (Array.isArray(d.conflicts) ? d.conflicts : []).concat(conflicts).slice(-20);
        this.SaveSettings();
        if (settingsChanged && typeof this.SendSettings === 'function') { try { this.SendSettings(); } catch { } }   // the page shows the new choices
        this.driveLastRun = Date.now();
        return counts;
      } finally {
        this.driveBusy = false;
      }
    },

    // From the settings page: connect, sync now, disconnect, or the state for the card.
    async DriveHandle(m) {
      const action = Str(m, 'action');
      try {
        if (action === 'state') { this.DriveSend(); return; }
        if (action === 'connect') {
          if (this.driveLogin) return;
          this.DriveSend({ connecting: true });
          const email = await this.DriveConnect();
          this.DriveSend({ text: 'מחובר' + (email ? ' כ-' + email : '') + '. מסנכרן…' });
          const c = await this.DriveSync();
          this.DriveSend({ done: c, text: this.DriveDoneText(c, true) });
          return;
        }
        if (action === 'cancel') { if (this.driveLogin) this.driveLogin.cancel(); return; }
        if (action === 'now' || action === 'confirmDeletes') {
          const c = await this.DriveSync({ allowDeletes: action === 'confirmDeletes' });
          this.DriveSend({ done: c, text: c ? this.DriveDoneText(c) : '' });
          return;
        }
        if (action === 'disconnect') { await this.DriveDisconnect(); this.DriveSend({ text: 'התנתקת. הקבצים נשארו במחשב וב-Drive.' }); return; }
        if (action === 'clearConflicts') { if (this.settings.drive) { this.settings.drive.conflicts = []; this.SaveSettings(); } this.DriveSend(); return; }
      } catch (ex) {
        this.DriveSend({ error: ex.message || String(ex), massDelete: ex.massDelete || 0 });
      }
    },

    DriveDoneText(c, first) {
      if (!c) return '';
      const parts = [];
      if (c.down) parts.push(c.down + ' ירדו');
      if (c.up) parts.push(c.up + ' עלו');
      if (c.deleted) parts.push(c.deleted + ' נמחקו (לאשפה)');
      if (c.conflicts) parts.push(c.conflicts + ' עם שתי גרסאות');
      if (c.failed) parts.push(c.failed + ' לא הצליחו, ינסו שוב');
      return parts.length ? 'סונכרן: ' + parts.join(', ') + '.' : first ? 'הכל מסונכרן.' : 'הכל מעודכן.';
    },

    // Every few minutes from the status timer, and at the start.
    async DriveTick() {
      if (!this.DriveConnected() || this.driveBusy) return;
      if (this.driveLastRun && Date.now() - this.driveLastRun < SyncEveryMs) return;
      try {
        const c = await this.DriveSync();
        if (c) this.DriveSend({ done: c, quiet: true, text: this.DriveDoneText(c) });
      } catch (ex) { this.driveLastRun = Date.now(); this.DriveSend({ error: ex.message || String(ex), massDelete: ex.massDelete || 0, quiet: true }); }
    },
  },
};
