// A calendar (iCal / .ics) read for "what to do today": the events, with the repeating ones expanded into their occurrences in a
// window of time. Pure functions, no DOM, so they are tested in Node. Time zones are done with Intl, so summer time is right.
// What is not supported (a rule with BYSETPOS, for instance) is not an error: the first occurrence is shown, marked approximate.
(function (root) {
  const WINDOWS_ZONES = {
    'Israel Standard Time': 'Asia/Jerusalem', 'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin',
    'Central Europe Standard Time': 'Europe/Budapest', 'Romance Standard Time': 'Europe/Paris', 'E. Europe Standard Time': 'Europe/Chisinau',
    'FLE Standard Time': 'Europe/Kiev', 'Russian Standard Time': 'Europe/Moscow', 'Turkey Standard Time': 'Europe/Istanbul',
    'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
    'Pacific Standard Time': 'America/Los_Angeles', 'Arab Standard Time': 'Asia/Riyadh', 'Jordan Standard Time': 'Asia/Amman',
    'Egypt Standard Time': 'Africa/Cairo', 'India Standard Time': 'Asia/Kolkata', 'UTC': 'UTC', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
  };
  const DAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const MAX_PER_EVENT = 5000, MAX_STEPS = 40000;

  // ---------- reading the text ----------
  const unfold = (text) => String(text || '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const unescape = (v) => String(v).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

  // "DTSTART;TZID=Asia/Jerusalem:20261110T090000" -> { name, params, value }
  function parseLine(line) {
    let inQuote = false, colon = -1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuote = !inQuote; else if (c === ':' && !inQuote) { colon = i; break; }
    }
    if (colon < 1) return null;
    const head = line.slice(0, colon), value = line.slice(colon + 1);
    const parts = [];
    let cur = '', q = false;
    for (const c of head) { if (c === '"') q = !q; if (c === ';' && !q) { parts.push(cur); cur = ''; } else cur += c; }
    parts.push(cur);
    const params = {};
    for (const p of parts.slice(1)) { const eq = p.indexOf('='); if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, ''); }
    return { name: parts[0].toUpperCase(), params, value };
  }

  // ---------- time zones ----------
  const formatters = new Map();
  function zoneName(tzid) {
    if (!tzid) return null;
    const name = WINDOWS_ZONES[tzid] || tzid.replace(/^\//, '');
    if (!formatters.has(name)) {
      try { formatters.set(name, new Intl.DateTimeFormat('en-US', { timeZone: name, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })); }
      catch { formatters.set(name, null); }
    }
    return formatters.get(name) ? name : null;
  }
  // How far the zone is ahead of UTC at that instant, in ms.
  function offsetAt(utcMs, zone) {
    const p = {};
    for (const x of formatters.get(zone).formatToParts(new Date(utcMs))) p[x.type] = +x.value;
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
  }
  // A wall-clock time in a zone (null zone: the computer's own) as an instant.
  function toUtc(y, mo, d, h, mi, s, zone) {
    if (zone === 'UTC') return Date.UTC(y, mo - 1, d, h, mi, s);
    if (!zone) return new Date(y, mo - 1, d, h, mi, s).getTime();
    const guess = Date.UTC(y, mo - 1, d, h, mi, s);
    let utc = guess - offsetAt(guess, zone);
    utc = guess - offsetAt(utc, zone);
    return utc;
  }

  // "20261110T090000Z", "20261110T090000" (+TZID) or "20261110" (a whole day) -> { y, mo, d, h, mi, s, zone, allDay, utc }
  function parseTime(value, params) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(String(value || '').trim());
    if (!m) return null;
    const allDay = m[4] === undefined || (params && params.VALUE === 'DATE');
    const t = { y: +m[1], mo: +m[2], d: +m[3], h: allDay ? 0 : +m[4], mi: allDay ? 0 : +m[5], s: allDay ? 0 : +(m[6] || 0), allDay };
    t.zone = allDay ? null : m[7] ? 'UTC' : zoneName(params && params.TZID);
    t.utc = toUtc(t.y, t.mo, t.d, t.h, t.mi, t.s, t.zone);
    return Number.isFinite(t.utc) ? t : null;
  }

  function parseDuration(v) {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(v || '').trim());
    if (!m) return null;
    const ms = ((+m[2] || 0) * 7 * 86400 + (+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
    return m[1] === '-' ? -ms : ms;
  }

  // ---------- events ----------
  function parse(text) {
    const events = [];
    let ev = null, alarm = 0;
    for (const line of unfold(text)) {
      if (!line) continue;
      const u = line.toUpperCase();
      if (u === 'BEGIN:VEVENT') { ev = { exdates: [], rules: null }; alarm = 0; continue; }
      if (u === 'END:VEVENT') { if (ev && ev.start) events.push(ev); ev = null; continue; }
      if (!ev) continue;
      if (u === 'BEGIN:VALARM') { alarm++; continue; }
      if (u === 'END:VALARM') { alarm = Math.max(0, alarm - 1); continue; }
      if (alarm) continue;
      const p = parseLine(line);
      if (!p) continue;
      switch (p.name) {
        case 'UID': ev.uid = p.value.trim(); break;
        case 'SUMMARY': ev.title = unescape(p.value).trim(); break;
        case 'LOCATION': ev.location = unescape(p.value).trim(); break;
        case 'STATUS': ev.status = p.value.trim().toUpperCase(); break;
        case 'TRANSP': ev.transp = p.value.trim().toUpperCase(); break;
        case 'DTSTART': ev.start = parseTime(p.value, p.params); break;
        case 'DTEND': ev.end = parseTime(p.value, p.params); break;
        case 'DURATION': ev.duration = parseDuration(p.value); break;
        case 'RRULE': ev.rrule = p.value.trim(); ev.rules = parseRule(p.value); break;
        case 'EXDATE': for (const v of p.value.split(',')) { const t = parseTime(v, p.params); if (t) ev.exdates.push(t); } break;
        case 'RECURRENCE-ID': ev.recurrenceId = parseTime(p.value, p.params); break;
        default: break;
      }
    }
    return events;
  }

  function parseRule(value) {
    const r = { freq: '', interval: 1, count: 0, until: null, byday: [], bymonthday: [], bymonth: [], wkst: 1, approx: false };
    for (const part of String(value).split(';')) {
      const [k, v] = part.split('=');
      if (!v) continue;
      switch (k.toUpperCase()) {
        case 'FREQ': r.freq = v.toUpperCase(); break;
        case 'INTERVAL': r.interval = Math.max(1, parseInt(v, 10) || 1); break;
        case 'COUNT': r.count = Math.max(0, parseInt(v, 10) || 0); break;
        case 'UNTIL': r.until = parseTime(v, {}); break;
        case 'BYDAY': r.byday = v.split(',').map(x => { const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(x.trim()); return m ? { n: m[1] ? parseInt(m[1], 10) : 0, day: DAY[m[2].toUpperCase()] } : null; }).filter(Boolean); break;
        case 'BYMONTHDAY': r.bymonthday = v.split(',').map(x => parseInt(x, 10)).filter(n => n && Math.abs(n) <= 31); break;
        case 'BYMONTH': r.bymonth = v.split(',').map(x => parseInt(x, 10)).filter(n => n >= 1 && n <= 12); break;
        case 'WKST': r.wkst = DAY[v.toUpperCase()] != null ? DAY[v.toUpperCase()] : 1; break;
        case 'BYSETPOS': case 'BYWEEKNO': case 'BYYEARDAY': case 'BYHOUR': case 'BYMINUTE': case 'BYSECOND': r.approx = true; break;
        default: break;
      }
    }
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.freq)) r.approx = true;
    return r;
  }

  // ---------- civil dates (year, month, day) as day numbers, with no time zone in the way ----------
  const dayNum = (y, mo, d) => Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
  const civil = (n) => { const x = new Date(n * 86400000); return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate() }; };
  const weekday = (n) => ((n % 7) + 11) % 7;   // day 0 (1970-01-01) was a Thursday
  const daysInMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

  // The days of one month that a rule picks: BYMONTHDAY, BYDAY with an order (the 2nd Monday, the last Friday) or the plain day.
  function monthDays(y, mo, rule, startDay) {
    const n = daysInMonth(y, mo), out = new Set();
    if (rule.bymonthday.length) for (const d of rule.bymonthday) { const v = d > 0 ? d : n + d + 1; if (v >= 1 && v <= n) out.add(v); }
    else if (rule.byday.length) {
      for (const b of rule.byday) {
        const all = []; for (let d = 1; d <= n; d++) if (weekday(dayNum(y, mo, d)) === b.day) all.push(d);
        if (!b.n) all.forEach(d => out.add(d)); else { const v = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (v) out.add(v); }
      }
    } else if (startDay <= n) out.add(startDay);
    return [...out].sort((a, b) => a - b);
  }

  // The dates of a repeating event, in order, as day numbers; the generator stops by itself at `lastDay`.
  // skipTo (a day number, or -Infinity) lets a daily or weekly series that began long ago jump to the window.
  function* dates(start, rule, lastDay, skipTo) {
    const s0 = dayNum(start.y, start.mo, start.d), interval = rule.interval;
    if (rule.freq === 'DAILY') {
      const first = skipTo > s0 ? Math.floor((skipTo - s0) / interval) : 0;
      for (let i = 0, n = s0 + first * interval; n <= lastDay && i < MAX_STEPS; i++, n += interval) yield n;
    } else if (rule.freq === 'WEEKLY') {
      const days = rule.byday.length ? rule.byday.map(b => b.day) : [weekday(s0)];
      const weekStart = s0 - ((weekday(s0) - rule.wkst + 7) % 7);
      const firstWeek = skipTo > s0 ? Math.max(0, Math.floor((skipTo - weekStart) / (7 * interval)) - 1) : 0;
      for (let w = firstWeek; w < firstWeek + MAX_STEPS; w++) {
        const base = weekStart + w * 7 * interval;
        if (base > lastDay) return;
        const week = days.map(d => base + ((d - rule.wkst + 7) % 7)).sort((a, b) => a - b);
        for (const n of week) if (n >= s0 && n <= lastDay) yield n;
      }
    } else if (rule.freq === 'MONTHLY') {
      for (let i = 0, y = start.y, mo = start.mo; i < MAX_STEPS; i++) {
        if (dayNum(y, mo, 1) > lastDay) return;
        if (!rule.bymonth.length || rule.bymonth.includes(mo)) for (const d of monthDays(y, mo, rule, start.d)) { const n = dayNum(y, mo, d); if (n >= s0 && n <= lastDay) yield n; }
        mo += interval; y += Math.floor((mo - 1) / 12); mo = ((mo - 1) % 12) + 1;
      }
    } else if (rule.freq === 'YEARLY') {
      for (let i = 0, y = start.y; i < MAX_STEPS; i++, y += interval) {
        if (dayNum(y, 1, 1) > lastDay) return;
        const months = rule.bymonth.length ? rule.bymonth : [start.mo];
        for (const mo of months.slice().sort((a, b) => a - b)) for (const d of monthDays(y, mo, rule, start.d)) { const n = dayNum(y, mo, d); if (n >= s0 && n <= lastDay) yield n; }
      }
    }
  }

  // ---------- occurrences ----------
  // The occurrences of the events in [from, to) (ms), in order: { start, end, title, location, allDay, busy, approx }.
  // An occurrence is "busy" when it blocks time: not a whole day, not cancelled, not marked free.
  function expand(input, from, to) {
    const events = typeof input === 'string' ? parse(input) : Array.isArray(input) ? input : [];
    const out = [];
    const overrides = new Map();   // uid -> Set of the original starts that another event replaces
    for (const e of events) if (e.recurrenceId && e.uid) { if (!overrides.has(e.uid)) overrides.set(e.uid, new Set()); overrides.get(e.uid).add(e.recurrenceId.allDay ? 'd' + dayNum(e.recurrenceId.y, e.recurrenceId.mo, e.recurrenceId.d) : e.recurrenceId.utc); }

    const make = (e, start, end, approx) => {
      const cancelled = e.status === 'CANCELLED';
      if (cancelled || end <= from || start >= to) return;
      out.push({ start, end, title: e.title || '', location: e.location || '', allDay: !!e.start.allDay, busy: !e.start.allDay && e.transp !== 'TRANSPARENT', approx: !!approx, uid: e.uid || '' });
    };

    for (const e of events) {
      let length = e.end ? e.end.utc - e.start.utc : e.duration != null ? e.duration : e.start.allDay ? 86400000 : 0;
      if (!(length >= 0)) length = 0;
      if (e.recurrenceId || !e.rules) { make(e, e.start.utc, e.start.utc + length, false); continue; }

      const rule = e.rules;
      const ex = new Set(e.exdates.map(t => (t.allDay ? 'd' + dayNum(t.y, t.mo, t.d) : t.utc)));
      const replaced = overrides.get(e.uid);
      if (rule.approx) { make(e, e.start.utc, e.start.utc + length, true); continue; }

      const lastDay = Math.floor(to / 86400000) + 1, firstDay = Math.floor(from / 86400000) - 2;
      const untilMs = rule.until ? (rule.until.allDay ? toUtc(rule.until.y, rule.until.mo, rule.until.d, 23, 59, 59, e.start.zone) : rule.until.utc) : Infinity;
      const untilDay = Number.isFinite(untilMs) ? Math.floor(untilMs / 86400000) + 1 : Infinity;
      let count = 0, emitted = 0;
      // Before the window only the count matters (a series with COUNT is counted from its start), so no time zone work is done there.
      for (const n of dates(e.start, rule, lastDay, rule.count ? -Infinity : firstDay)) {
        if (n > untilDay) break;
        if (n < firstDay) { if (rule.count && ++count > rule.count) break; continue; }
        const c = civil(n);
        const start = e.start.allDay ? new Date(c.y, c.mo - 1, c.d).getTime() : toUtc(c.y, c.mo, c.d, e.start.h, e.start.mi, e.start.s, e.start.zone);
        if (start > untilMs) break;
        if (rule.count && ++count > rule.count) break;
        const key = e.start.allDay ? 'd' + n : start;
        if (ex.has(key) || (replaced && replaced.has(key))) continue;
        if (start >= to || emitted >= MAX_PER_EVENT) break;
        const before = out.length;
        make(e, start, start + length, false);
        emitted += out.length - before;
      }
    }
    return out.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  // ---------- a week on the screen ----------
  // The part of each occurrence that falls in each of the `days` days from `weekStart` (a local midnight, ms), cut at midnight:
  // { day, from, to, allDay, occ }, with from/to in minutes of that day by the clock on the wall (so a day of 23 or 25 hours stays right).
  function dayParts(occ, weekStart, days) {
    const out = [], clock = (ms) => { const x = new Date(ms); return x.getHours() * 60 + x.getMinutes(); };
    for (let d = 0; d < days; d++) {
      const a = new Date(weekStart); a.setDate(a.getDate() + d);
      const b = new Date(a.getTime()); b.setDate(b.getDate() + 1);
      const ds = a.getTime(), de = b.getTime();
      for (const o of occ || []) {
        const end = Math.max(o.end, o.start + 1);
        if (!(o.start < de && end > ds)) continue;
        if (o.allDay) { out.push({ day: d, from: 0, to: 1440, allDay: true, occ: o }); continue; }
        const from = o.start <= ds ? 0 : clock(o.start), to = o.end >= de ? 1440 : clock(o.end);
        out.push({ day: d, from, to: Math.max(to, from), allDay: false, occ: o });
      }
    }
    return out;
  }

  // Items that overlap in time ({ from, to }) get a lane each, side by side: every item gets `lane` (0..) and `lanes`
  // (how many lanes its group of overlapping items needs). An item shorter than `min` counts as `min` long, as it is drawn.
  function lanes(items, min) {
    const m = min || 0, endOf = (x) => Math.max(x.to, x.from + m);
    const list = (items || []).slice().sort((a, b) => a.from - b.from || endOf(b) - endOf(a));
    let group = [], ends = [], groupEnd = -Infinity;
    const close = () => { for (const x of group) x.lanes = ends.length; group = []; ends = []; };
    for (const x of list) {
      if (group.length && x.from >= groupEnd) close();
      let i = ends.findIndex(e => e <= x.from);
      if (i < 0) { i = ends.length; ends.push(0); }
      ends[i] = endOf(x); x.lane = i; group.push(x); groupEnd = Math.max(groupEnd, endOf(x));
    }
    close();
    return list;
  }

  const api = { parse, expand, parseLine, parseTime, parseDuration, toUtc, dayParts, lanes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ICal = api;
})(typeof window !== 'undefined' ? window : globalThis);
