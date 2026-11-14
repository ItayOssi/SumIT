'use strict';
// The institutions' logos for the picker (macOS only). No logo ships inside the app: the first time the picker needs
// one, it is read from where the list says the real logo is (the institution's page on the Hebrew Wikipedia, or its own
// site), and only when that fails, from the site's icons (apple-touch-icon / icon links, or /favicon.ico). It is kept in
// DataRoot/inst-logos. The page gets it as a data: URL, so its security policy (img-src 'self' data:) stays as is.
// Without a network, or when the site has no usable icon, the page keeps the initials badge.

const fs = require('fs');
const path = require('path');
const platform = require('../platform');
const Inst = require('../institution');
const { Str } = require('../util');

const MaxBytes = 400 * 1024;
const CacheVer = 2;                         // 2: the real logos (1.0.50); older caches held the site icons
const UA = 'SumIT/' + require('../constants').Version + ' (https://github.com/ItayOssi/SumIT; institution logos)';
const FreshMs = 30 * 24 * 3600 * 1000;      // a logo is read again after a month
const RetryMs = 24 * 3600 * 1000;           // a site that had none is asked again after a day
const Types = { 'image/png': 1, 'image/svg+xml': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/x-icon': 1, 'image/vnd.microsoft.icon': 1, 'image/gif': 1 };

// The icons a home page offers, best first: apple-touch-icon (large), then the biggest declared icon, SVG before
// bitmaps of unknown size, then /favicon.ico.
function IconCandidates(html, pageUrl) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const tag = m[0];
    const rel = (/\brel\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1] || '';
    const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1] || '';
    if (!/icon/i.test(rel) || !href || /mask-icon/i.test(rel)) continue;
    let url;
    try { url = new URL(href.replace(/&amp;/g, '&'), pageUrl); } catch { continue; }
    if (url.protocol !== 'https:') continue;
    const sizes = (/\bsizes\s*=\s*["'](\d+)x\d+["']/i.exec(tag) || [])[1];
    const svg = /\.svg(\?|$)/i.test(url.pathname) || /svg/i.test((/\btype\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1] || '');
    const score = /apple-touch/i.test(rel) ? 1000 + (Number(sizes) || 180) : svg ? 900 : (Number(sizes) || 16);
    out.push({ url: url.href, score });
  }
  out.sort((a, b) => b.score - a.score);
  try { out.push({ url: new URL('/favicon.ico', pageUrl).href, score: 0 }); } catch { }
  const seen = new Set();
  return out.filter(c => !seen.has(c.url) && seen.add(c.url)).map(c => c.url);
}

function MimeOf(contentType, buf, url) {
  let t = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!Types[t]) {
    const head = buf.subarray(0, 16);
    if (head[0] === 0x89 && head[1] === 0x50) t = 'image/png';
    else if (head[0] === 0xff && head[1] === 0xd8) t = 'image/jpeg';
    else if (head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0) t = 'image/x-icon';
    else if (/<svg[\s>]/i.test(buf.subarray(0, 600).toString('utf8'))) t = 'image/svg+xml';
    else if (/\.ico(\?|$)/i.test(url)) t = 'image/x-icon';
  }
  return Types[t] ? t : '';
}

async function Get(url, ms) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(ms), headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res;
}

module.exports = {
  IconCandidates,
  MimeOf,
  methods: {
    InstLogoDir() { return this.instLogoDir || path.join(platform.DataRoot, 'inst-logos'); },
    InstLogoFile(id) { return path.join(this.InstLogoDir(), id + '.v' + CacheVer + '.json'); },

    // The cached logo of one institution: { src } (a data: URL), { none: true } when the site had none lately, or null.
    InstLogoCached(id, now = Date.now()) {
      try {
        const o = JSON.parse(fs.readFileSync(this.InstLogoFile(id), 'utf8'));
        if (o && o.mime && o.b64 && now - Number(o.at) < FreshMs) return { src: 'data:' + o.mime + ';base64,' + o.b64 };
        if (o && o.none && now - Number(o.at) < RetryMs) return { none: true };
        if (o && o.mime && o.b64) return { src: 'data:' + o.mime + ';base64,' + o.b64, stale: true };
      } catch { }
      return null;
    },

    // Reads the logo from the institution's site and keeps it. fetcher is injectable for the tests.
    async InstLogoFetch(inst, fetcher = Get) {
      const keep = (url, buf, mime) => {
        const rec = { mime, b64: buf.toString('base64'), at: Date.now(), from: url };
        fs.mkdirSync(this.InstLogoDir(), { recursive: true });
        fs.writeFileSync(this.InstLogoFile(inst.id), JSON.stringify(rec));
        return 'data:' + mime + ';base64,' + rec.b64;
      };
      const tryImage = async (url) => {
        const r = await fetcher(url, 10000);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 64 || buf.length > MaxBytes) return '';
        const mime = MimeOf(r.headers && r.headers.get ? r.headers.get('content-type') : '', buf, url);
        return mime ? keep(url, buf, mime) : '';
      };
      // 1. The real logo, where the list says it is.
      for (const url of (Array.isArray(inst.logos) ? inst.logos : []).filter(u => /^https:\/\//.test(u)).slice(0, 3)) {
        try { const src = await tryImage(url); if (src) return src; } catch { }
      }
      // 2. The site's own icons.
      const pages = ['https://www.' + inst.domain + '/', 'https://' + inst.domain + '/'];
      let html = '', pageUrl = pages[0];
      for (const p of pages) {
        try { const r = await fetcher(p, 8000); html = await r.text(); pageUrl = r.url || p; break; } catch { }
      }
      for (const url of IconCandidates(html, pageUrl).slice(0, 5)) {
        try { const src = await tryImage(url); if (src) return src; } catch { }
      }
      try {
        fs.mkdirSync(this.InstLogoDir(), { recursive: true });
        fs.writeFileSync(this.InstLogoFile(inst.id), JSON.stringify({ none: true, at: Date.now() }));
      } catch { }
      return '';
    },

    // The page asks for the logos it shows ({ ids }): the cached ones at once, the rest as they arrive.
    SendInstLogos(m) {
      const ids = (Array.isArray(m && m.ids) ? m.ids : []).map(x => Str({ x }, 'x')).filter(id => Inst.I.byId(id)).slice(0, 60);
      const todo = [];
      for (const id of ids) {
        const c = this.InstLogoCached(id);
        if (c && c.src) this.Send({ type: 'instLogo', id, src: c.src });
        if (!c || c.stale) todo.push(id);
      }
      if (!todo.length) return;
      this.instLogoBusy = this.instLogoBusy || new Set();
      const queue = todo.filter(id => !this.instLogoBusy.has(id));
      queue.forEach(id => this.instLogoBusy.add(id));
      const worker = async () => {
        while (queue.length) {
          const id = queue.shift();
          try {
            const src = await this.InstLogoFetch(Inst.I.byId(id));
            if (src) this.Send({ type: 'instLogo', id, src });
          } catch { } finally { this.instLogoBusy.delete(id); }
        }
      };
      for (let i = 0; i < 4; i++) worker();
    },
  },
};
