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

// openid, email and profile: the name and the picture of the account fill the student's profile when it is still empty.
const Scope = 'https://www.googleapis.com/auth/drive.file openid email profile';
const FolderMime = 'application/vnd.google-apps.folder';
const MaxFile = 100 * 1024 * 1024;           // larger files stay on this computer
const SimpleUpload = 5 * 1024 * 1024;        // above this, a resumable upload
const SyncEveryMs = 5 * 60 * 1000;
const QuietMs = 5000;                        // a file written in the last seconds waits for the next sync
const MassDelete = { count: 25, share: 0.3 };
const SkipDirs = new Set(['.sumit-math', '.git', 'node_modules', '.Trash', '.sumit-sync-tmp']);
const SkipFile = /^(\.DS_Store|Thumbs\.db|desktop\.ini|~\$.*|\..*\.tmp|.*\.(tmp|partial|crdownload|rendering|part|download|sumit-download))$|^\.~/i;
const SettingsRel = '.sumit/settings-sync.json';
const PhotoRel = '.sumit/profile.jpg';   // the profile picture travels next to the settings; settings.photo is its md5
// Settings that are about the student, not about this computer: never keys, tokens, folders or window places.
const SettingsSkip = /key|token|secret|password|dir$|root$|path|drive|window|bounds|zoom|lastupdate|install|machine|device|calsync/i;
// Lists of records that are also about the student: their own tasks.
const SettingsLists = new Set(['tasks']);

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

// The page the browser shows after Google's answer, in the colors of the app (light or dark, as the system). logo is a data: URL.
function DonePage(ok, error, logo) {
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const title = ok ? 'SumIT מחובר לחשבון Google' : 'ההתחברות לא הושלמה';
  const text = ok ? 'הפרופיל, הסיכומים והמטלות שלך יישמרו עכשיו ב-Google\u00a0Drive, ויחזרו בכל מחשב שתתחבר ממנו.'
    : error === 'access_denied' ? 'האישור בוטל, ולכן SumIT לא קיבל גישה. אפשר לנסות שוב מתי שתרצה.' : 'Google לא אישר את ההתחברות. חזור ל-SumIT ונסה שוב.';
  const hint = ok ? 'אפשר לסגור את הכרטיסייה הזו ולחזור ל-SumIT. הסנכרון הראשון כבר התחיל.' : 'אפשר לסגור את הכרטיסייה הזו. ב-SumIT לוחצים על התמונה שלך, ואז "התחבר עם Google".';
  const mark = ok ? '<path d="M7 12.5l3.2 3.2L17 9"/>' : '<path d="M12 7.5v5.5M12 16.5v.2"/>';
  return '<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><style>'
    + ':root{--bg:#f1f5fc;--bg2:#dfe9fb;--card:#fff;--text:#14213d;--muted:#5b6b86;--line:#d3dff0;--accent:#1f64d8;--accent2:#2f8fe8;--state:' + (ok ? '#16a34a' : '#dc2626') + ';color-scheme:light dark}'
    + '@media (prefers-color-scheme:dark){:root{--bg:#0a1830;--bg2:#13305e;--card:#11274c;--text:#eaf1ff;--muted:#9fb1d0;--line:#24467c;--state:' + (ok ? '#22c55e' : '#f87171') + '}}'
    + '*{box-sizing:border-box}html,body{height:100%;margin:0}'
    + 'body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"SF Hebrew","Segoe UI",Arial,sans-serif;color:var(--text);background:radial-gradient(900px 520px at 85% -10%,var(--bg2),transparent 70%),radial-gradient(700px 480px at 0% 110%,var(--bg2),transparent 70%),var(--bg);display:grid;place-items:center;padding:24px}'
    + '.card{width:min(460px,100%);background:var(--card);border:1px solid var(--line);border-radius:28px;padding:40px 32px 30px;text-align:center;box-shadow:0 24px 60px -24px rgba(16,40,90,.35);animation:rise .55s cubic-bezier(.2,.8,.2,1) both}'
    + '.logo{position:relative;width:112px;height:112px;margin:0 auto 22px}'
    + '.logo img,.logo .ph{width:112px;height:112px;border-radius:50%;display:block;box-shadow:0 0 0 5px var(--card),0 0 0 8px var(--accent2)}'
    + '.logo .ph{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font:800 34px/112px inherit}'
    + '.badge{position:absolute;bottom:-4px;left:-4px;width:40px;height:40px;border-radius:50%;background:var(--state);border:4px solid var(--card);display:grid;place-items:center;animation:pop .45s .35s cubic-bezier(.3,1.6,.5,1) both}'
    + '.badge svg{width:22px;height:22px;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}'
    + '.badge path{stroke-dasharray:24;stroke-dashoffset:24;animation:draw .4s .65s ease-out forwards}'
    + 'h1{font-size:23px;line-height:1.3;margin:0 0 10px}p{margin:0 0 6px;color:var(--muted)}'
    + '.hint{margin-top:22px;padding:12px 14px;border-radius:14px;background:color-mix(in srgb,var(--accent) 9%,transparent);color:var(--text);font-size:14px}'
    + '.brand{margin-top:22px;font-size:12px;color:var(--muted);letter-spacing:.02em}'
    + '@keyframes rise{from{opacity:0;transform:translateY(14px) scale(.98)}}@keyframes pop{from{transform:scale(0)}}@keyframes draw{to{stroke-dashoffset:0}}'
    + '@media (prefers-reduced-motion:reduce){*{animation:none!important}.badge path{stroke-dashoffset:0}}'
    + '</style></head><body><main class="card" role="main">'
    + '<div class="logo">' + (logo ? '<img src="' + esc(logo) + '" alt="SumIT">' : '<div class="ph" aria-hidden="true">S</div>')
    + '<span class="badge" aria-hidden="true"><svg viewBox="0 0 24 24">' + mark + '</svg></span></div>'
    + '<h1>' + esc(title) + '</h1><p>' + esc(text) + '</p><div class="hint">' + esc(hint) + '</div><div class="brand">SumIT · כל הלימודים במקום אחד</div>'
    + '</main></body></html>';
}

// The name and the picture in Google's id_token (no check of the signature: it came straight from Google's token endpoint over TLS).
function IdTokenProfile(idToken) {
  try {
    const j = JSON.parse(Buffer.from(String(idToken || '').split('.')[1] || '', 'base64').toString('utf8'));
    return { email: Str(j, 'email'), name: Str(j, 'given_name') || Str(j, 'name'), picture: Str(j, 'picture') };
  } catch { return { email: '', name: '', picture: '' }; }
}

// The client secret as Google's console hands it out can be the bare "GOCSPX-..." or the whole downloaded client JSON
// ({"installed": {"client_secret": ...}}); Google answers invalid_client to anything but the bare secret.
function ClientSecret(value) {
  const v = String(value || '').trim();
  if (!v.startsWith('{')) return v;
  try { const j = JSON.parse(v); return Str(Dict(j, 'installed') || Dict(j, 'web') || j, 'client_secret').trim(); } catch { return ''; }
}

function SyncableSettings(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings || {})) {
    if (SettingsSkip.test(k)) continue;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
    else if (Array.isArray(v) && v.every(x => ['string', 'number', 'boolean'].includes(typeof x))) out[k] = v.slice();
    else if (SettingsLists.has(k) && Array.isArray(v)) out[k] = v.filter(x => x && typeof x === 'object' && !Array.isArray(x)).map(x => {
      const o = {}; for (const [a, b] of Object.entries(x)) if (b === null || ['string', 'number', 'boolean'].includes(typeof b)) o[a] = b; return o;
    });
  }
  return out;
}

module.exports = {
  SyncPlan, ConflictName, SyncableSettings, ClientSecret, IdTokenProfile, DonePage,
  methods: {
    DrivePlan(local, remote, base) { return SyncPlan(local, remote, base); },
    DriveConflictName(rel, when) { return ConflictName(rel, when); },
    DriveSyncableSettings(s) { return SyncableSettings(s); },

    // ---------- configuration ----------
    get DriveClientId() { return process.env.SUMIT_GOOGLE_CLIENT_ID || C.GoogleClientId || ''; },
    // The secret of a desktop client is not a real secret (Google says so), but it stays out of the public code:
    // the release workflow writes lib/google-oauth.json from a repository secret, and a developer sets the environment.
    get DriveClientSecret() {
      if (process.env.SUMIT_GOOGLE_CLIENT_SECRET) return ClientSecret(process.env.SUMIT_GOOGLE_CLIENT_SECRET);
      try { return ClientSecret(Str(JSON.parse(readText(path.join(__dirname, '..', 'google-oauth.json'))), 'secret')); } catch { return ''; }
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
    // { refreshProfile: true } ("switch account / update from Google" in the profile) also replaces the name and the picture.
    async DriveConnect(open, opts = {}) {
      if (!this.DriveClientId || !this.DriveClientSecret) throw new Error('החיבור ל-Google עוד לא מוגדר בגרסה הזו של SumIT.');
      const verifier = b64url(crypto.randomBytes(32)), challenge = b64url(crypto.createHash('sha256').update(verifier).digest()), state = b64url(crypto.randomBytes(16));
      let finish;
      const answer = new Promise((resolve, reject) => { finish = { resolve, reject }; });
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
        const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(DonePage(!!ok, u.searchParams.get('error') || '', this.DriveLogo()));
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
        const who = IdTokenProfile(tok.id_token);
        const before = Unprotect(Str(Dict(this.settings, 'drive') || {}, 'refresh'));
        this.settings.drive = { refresh: Protect(tok.refresh_token), email: who.email, connected: new Date().toISOString(), last: '', root: '' };
        this.driveAccess = { token: tok.access_token, until: Date.now() + (Number(tok.expires_in) || 3000) * 1000 };
        await this.DriveFillProfile(who, !!opts.refreshProfile);
        this.SaveSettings();
        // Signed in again: the permission of the previous sign-in is given back to Google.
        if (before && before !== tok.refresh_token) { try { await fetch(this.DriveRevokeUrl + '?token=' + enc(before), { method: 'POST' }); } catch { } }
        return who.email;
      } finally { clearTimeout(timer); server.close(); this.driveLogin = null; }
    },

    // The app's icon for the page after the answer, made small (as a data: URL inside the page: the server closes right after it).
    DriveLogo() {
      if (this.driveLogo !== undefined) return this.driveLogo;
      const file = path.join(platform.WebDir, 'images', 'icon.png');
      let url = '';
      try {
        const { nativeImage } = require('electron');
        const img = nativeImage && nativeImage.createFromPath(file);
        if (img && !img.isEmpty()) url = img.resize({ width: 224, height: 224, quality: 'best' }).toDataURL();
      } catch { }
      if (!url) { try { url = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'); } catch { } }
      this.driveLogo = url;
      return url;
    },

    // The first sign-in fills what the student has not set yet: the name, and the picture of the Google account. Their own is replaced
    // only when they asked for it (force).
    async DriveFillProfile(who, force) {
      let changed = false;
      if (who.name && (force || !Str(this.settings, 'displayName').trim())) { this.settings.displayName = who.name.trim().slice(0, 40); changed = true; }
      if (who.picture && /^https:\/\//.test(who.picture) && (force || !fileExists(this.ProfileImageFile))) {
        try {
          const res = await fetch(who.picture.replace(/=s\d+(-c)?$/, '=s256-c'));
          if (res.ok) { this.SetProfileImageBytes(Buffer.from(await res.arrayBuffer())); changed = true; }
        } catch { }
      }
      if (changed && typeof this.SendSettings === 'function') { try { this.SendSettings(); } catch { } }
      return changed;
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
      const photo = fileExists(this.ProfileImageFile) ? md5(fs.readFileSync(this.ProfileImageFile)) : '';
      if (Str(this.settings, 'photo') !== photo) this.settings.photo = photo;
      const file = path.join(root, SettingsRel), mine = SyncableSettings(this.settings), d = this.settings.drive;
      const sig = JSON.stringify(mine);
      if (d.settingsSig === sig && fileExists(file)) return;
      let cur = null; try { cur = JSON.parse(readText(file)); } catch { }
      if (cur && JSON.stringify(cur.settings) === sig) { d.settingsSig = sig; return; }
      if (cur && d.settingsSig && cur.updated > (d.settingsApplied || '')) return;   // another computer's newer settings wait to be taken in
      const updated = new Date().toISOString();
      mkdirp(path.dirname(file)); writeText(file, JSON.stringify({ updated, settings: mine }, null, 1));
      const photoFile = path.join(root, PhotoRel);
      try { if (photo) fs.copyFileSync(this.ProfileImageFile, photoFile); else if (fileExists(photoFile)) fs.unlinkSync(photoFile); } catch { }
      d.settingsSig = sig; d.settingsApplied = updated;   // our own, not something to take in
    },
    DriveSettingsIn(root) {
      const file = path.join(root, SettingsRel), d = this.settings.drive;
      let cur = null; try { cur = JSON.parse(readText(file)); } catch { return false; }
      if (!cur || !cur.settings || !cur.updated || cur.updated <= (d.settingsApplied || '')) return false;
      for (const [k, v] of Object.entries(SyncableSettings(cur.settings))) this.settings[k] = v;
      // The picture: the one in the folder when its md5 is the one the settings name, none when they name none.
      if ('photo' in cur.settings) {
        const want = Str(cur.settings, 'photo'), photoFile = path.join(root, PhotoRel);
        const have = fileExists(this.ProfileImageFile) ? md5(fs.readFileSync(this.ProfileImageFile)) : '';
        try {
          if (want && want !== have && fileExists(photoFile) && md5(fs.readFileSync(photoFile)) === want) { mkdirp(path.dirname(this.ProfileImageFile)); fs.copyFileSync(photoFile, this.ProfileImageFile); }
          else if (!want && have) fs.unlinkSync(this.ProfileImageFile);
        } catch { }
      }
      if (Array.isArray(this.settings.tasks) && typeof this.CleanTasks === 'function') this.settings.tasks = this.CleanTasks(this.settings.tasks);
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
          const email = await this.DriveConnect(null, { refreshProfile: m.refreshProfile === true });
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
