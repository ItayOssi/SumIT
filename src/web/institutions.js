// The academic institutions in Israel that SumIT can work with: where each one's Moodle and personal portal are.
// Shared by the page (the picker) and the macOS host (routing). Pure data and helpers, no DOM.
//
// moodle  - the Moodle root (no trailing slash). Some institutions open a new Moodle every year (the Technion's
//           moodleNN, TAU's /YYYY, Braude's moodleNN, Haifa's mwNN, HUJI's /huNN), so the student can change it in
//           the settings. '' = not known yet: the student types it once.
// hosts   - other hosts that belong to the same Moodle (an address that redirects to it).
// portal  - the personal portal (grades, timetable). Where it is not known, the institution's site, where the
//           student finds the link.
// domain  - the institution's website, where its logo is read from.
// verified - the Moodle address was checked to answer as a Moodle (November 2026). Real sign-in was tested at HIT only.
(function (root) {
  'use strict';

  const LIST = [
    // universities
    { id: 'hit', kind: 'uni', name: 'מכון טכנולוגי חולון', short: 'HIT', domain: 'hit.ac.il', color: '#0b5aa6',
      moodle: 'https://md.hit.ac.il', portal: 'https://portal.hit.ac.il/', portalHosts: ['portal.hit.ac.il', 'webrashim.hit.ac.il'], verified: true },
    { id: 'technion', kind: 'uni', name: 'הטכניון', short: 'Technion', domain: 'technion.ac.il', color: '#0a3a7a',
      moodle: 'https://moodle26.technion.ac.il', portal: 'https://cheesefork.cf/', portalName: 'CheeseFork', portalHosts: ['cheesefork.cf', 'students.technion.ac.il'], verified: true },
    { id: 'tau', kind: 'uni', name: 'אוניברסיטת תל אביב', short: 'TAU', domain: 'tau.ac.il', color: '#0f3e72',
      moodle: 'https://moodle.tau.ac.il/2026', portal: 'https://my.tau.ac.il/', verified: true },
    { id: 'huji', kind: 'uni', name: 'האוניברסיטה העברית', short: 'HUJI', domain: 'huji.ac.il', color: '#1b4f8c',
      moodle: 'https://moodle4.cs.huji.ac.il/hu26', hosts: ['moodle.huji.ac.il'], portal: 'https://www.huji.ac.il/dataj/controller/stu/', verified: false },
    { id: 'biu', kind: 'uni', name: 'אוניברסיטת בר-אילן', short: 'BIU', domain: 'biu.ac.il', color: '#0b6b4f',
      moodle: 'https://lemida.biu.ac.il', portal: 'https://inbar.biu.ac.il/', verified: true },
    { id: 'bgu', kind: 'uni', name: 'אוניברסיטת בן-גוריון', short: 'BGU', domain: 'bgu.ac.il', color: '#e0791a',
      moodle: 'https://moodle.bgu.ac.il/moodle', portal: 'https://bgu4u.bgu.ac.il/', verified: true },
    { id: 'haifa', kind: 'uni', name: 'אוניברסיטת חיפה', short: 'Haifa', domain: 'haifa.ac.il', color: '#1d6fb8',
      moodle: 'https://mw27.haifa.ac.il', portal: 'https://www.haifa.ac.il/students/', verified: false },
    { id: 'ariel', kind: 'uni', name: 'אוניברסיטת אריאל', short: 'Ariel', domain: 'ariel.ac.il', color: '#2a6a3c',
      moodle: 'https://moodlearn.ariel.ac.il', hosts: ['moodle.ariel.ac.il'], portal: 'https://www.ariel.ac.il/', verified: true },
    { id: 'openu', kind: 'uni', name: 'האוניברסיטה הפתוחה', short: 'OpenU', domain: 'openu.ac.il', color: '#0068b3',
      moodle: 'https://opal.openu.ac.il', portal: 'https://sheilta.apps.openu.ac.il/', portalName: 'שאילתא', verified: true },
    { id: 'runi', kind: 'uni', name: 'אוניברסיטת רייכמן', short: 'RUNI', domain: 'runi.ac.il', color: '#1c2b4a',
      moodle: 'https://moodle.runi.ac.il/2026', portal: 'https://my.runi.ac.il/', verified: false },

    // academic colleges
    { id: 'afeka', kind: 'college', name: 'אפקה – המכללה האקדמית להנדסה', short: 'Afeka', domain: 'afeka.ac.il', color: '#d2232a',
      moodle: 'https://moodle.afeka.ac.il', portal: 'https://yedion.afeka.ac.il/', verified: true },
    { id: 'mta', kind: 'college', name: 'המכללה האקדמית תל אביב-יפו', short: 'MTA', domain: 'mta.ac.il', color: '#00508f',
      moodle: 'https://moodle.mta.ac.il', portal: 'https://www.mta.ac.il/', verified: true },
    { id: 'jce', kind: 'college', name: 'עזריאלי – המכללה האקדמית להנדסה ירושלים', short: 'Azrieli', domain: 'jce.ac.il', color: '#00428a',
      moodle: 'https://moodle.jce.ac.il', portal: 'https://www.jce.ac.il/', verified: true },
    { id: 'braude', kind: 'college', name: 'אורט בראודה', short: 'Braude', domain: 'braude.ac.il', color: '#0060a8',
      moodle: 'https://moodle27.braude.ac.il', portal: 'https://info.braude.ac.il/', verified: true },
    { id: 'shenkar', kind: 'college', name: 'שנקר', short: 'Shenkar', domain: 'shenkar.ac.il', color: '#222222',
      moodle: 'https://online.shenkar.ac.il', portal: 'https://www.shenkar.ac.il/', verified: true },
    { id: 'ruppin', kind: 'college', name: 'המרכז האקדמי רופין', short: 'Ruppin', domain: 'ruppin.ac.il', color: '#00748a',
      moodle: 'https://moodle.ruppin.ac.il', portal: 'https://www.ruppin.ac.il/', verified: true },
    { id: 'sapir', kind: 'college', name: 'המכללה האקדמית ספיר', short: 'Sapir', domain: 'sapir.ac.il', color: '#4f2683',
      moodle: 'https://moodle.sapir.ac.il', portal: 'https://www.sapir.ac.il/', verified: true },
    { id: 'sce', kind: 'college', name: 'סמי שמעון – המכללה האקדמית להנדסה', short: 'SCE', domain: 'sce.ac.il', color: '#003b71',
      moodle: 'https://moodle.sce.ac.il', portal: 'https://www.sce.ac.il/', verified: true },
    { id: 'jct', kind: 'college', name: 'המרכז האקדמי לב', short: 'JCT', domain: 'jct.ac.il', color: '#0b3d6e',
      moodle: 'https://moodle.jct.ac.il', portal: 'https://levnet.jct.ac.il/', portalName: 'לבנט', verified: true },
    { id: 'colman', kind: 'college', name: 'המכללה למינהל', short: 'COLMAN', domain: 'colman.ac.il', color: '#00539b',
      moodle: 'https://moodle.colman.ac.il', portal: 'https://www.colman.ac.il/', verified: true },
    { id: 'ono', kind: 'college', name: 'הקריה האקדמית אונו', short: 'Ono', domain: 'ono.ac.il', color: '#e4002b',
      moodle: '', portal: 'https://yedion.ono.ac.il/yedion/FireflyWeb.aspx?prgname=login', verified: false },
    { id: 'kinneret', kind: 'college', name: 'המכללה האקדמית כנרת', short: 'Kinneret', domain: 'kinneret.ac.il', color: '#0096c7',
      moodle: 'https://moodle.kinneret.ac.il', portal: 'https://www.kinneret.ac.il/', verified: true },
    { id: 'telhai', kind: 'college', name: 'המכללה האקדמית תל-חי', short: 'Tel-Hai', domain: 'telhai.ac.il', color: '#5a8f29',
      moodle: 'https://moodle.telhai.ac.il', portal: 'https://www.telhai.ac.il/', verified: false },
    { id: 'yvc', kind: 'college', name: 'המכללה האקדמית עמק יזרעאל', short: 'YVC', domain: 'yvc.ac.il', color: '#2e7d32',
      moodle: '', portal: 'https://yedionsso.yvc.ac.il/yedion/login.aspx', verified: false },
    { id: 'wgalil', kind: 'college', name: 'המכללה האקדמית גליל מערבי', short: 'WGalil', domain: 'wgalil.ac.il', color: '#007a99',
      moodle: 'https://moodle.wgalil.ac.il', portal: 'https://www.wgalil.ac.il/', verified: true },
    { id: 'pac', kind: 'college', name: 'המרכז האקדמי פרס', short: 'Peres', domain: 'pac.ac.il', color: '#00457c',
      moodle: '', portal: 'https://yedion.pac.ac.il/yedion/fireflyweb.aspx?appname=BSHITA&prgname=login', verified: false },
    { id: 'netanya', kind: 'college', name: 'המכללה האקדמית נתניה', short: 'Netanya', domain: 'netanya.ac.il', color: '#003e7e',
      moodle: '', portal: 'https://www.netanya.ac.il/', verified: false },
    { id: 'jmc', kind: 'college', name: 'המכללה האקדמית הדסה (ירושלים הרב-תחומית)', short: 'JMC', domain: 'jmc.ac.il', color: '#6d2077',
      moodle: '', portal: 'https://www.jmc.ac.il/', verified: false },
    { id: 'bezalel', kind: 'college', name: 'בצלאל', short: 'Bezalel', domain: 'bezalel.ac.il', color: '#111111',
      moodle: 'https://moodle.bezalel.ac.il', portal: 'https://www.bezalel.ac.il/', verified: true },
    { id: 'achva', kind: 'college', name: 'המכללה האקדמית אחוה', short: 'Achva', domain: 'achva.ac.il', color: '#00809d',
      moodle: 'https://moodle.achva.ac.il', portal: 'https://www.achva.ac.il/', verified: true },
    { id: 'zefat', kind: 'college', name: 'המכללה האקדמית צפת', short: 'Zefat', domain: 'zefat.ac.il', color: '#1b75bb',
      moodle: 'https://moodle.zefat.ac.il', portal: 'https://portal.zefat.ac.il/', verified: false },
    { id: 'aac', kind: 'college', name: 'המכללה האקדמית אשקלון', short: 'Ashkelon', domain: 'aac.ac.il', color: '#0072bc',
      moodle: 'https://moodle.aac.ac.il', portal: 'https://portal.aac.ac.il/', verified: true },
  ];

  const DEFAULT = 'hit';
  const byId = id => LIST.find(i => i.id === id) || null;

  // A Moodle root the student typed: https only, no query, no trailing slash, and without the page part
  // ("/my/", "/login/index.php", "/course/view.php?id=3" all come back to the root).
  function normalizeMoodle(s) {
    let t = String(s || '').trim();
    if (!t) return '';
    if (!/^[a-z]+:\/\//i.test(t)) t = 'https://' + t;
    let u;
    try { u = new URL(t); } catch { return ''; }
    if (u.protocol !== 'https:' || !/\./.test(u.hostname)) return '';
    let p = u.pathname.replace(/\/+$/, '');
    p = p.replace(/\/(my|login|course|mod|user|local|auth|admin|calendar|grade|message)(\/.*)?$/i, '');
    p = p.replace(/\/index\.php$/i, '');
    return (u.origin + p).replace(/\/+$/, '');
  }

  // The institution as the app uses it, with the student's own addresses (settings) over the defaults.
  // settings: { institute, moodleUrl, portalUrl }
  function resolve(settings) {
    const s = settings || {};
    const base = byId(String(s.institute || '')) || byId(DEFAULT);
    const moodle = normalizeMoodle(s.moodleUrl) || base.moodle;
    let portal = String(s.portalUrl || '').trim();
    if (portal && !/^https:\/\//i.test(portal)) portal = '';
    portal = portal || base.portal;
    const hostOf = u => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
    const moodleHosts = [hostOf(moodle)].concat((base.hosts || []).map(h => h.toLowerCase())).filter(Boolean);
    const portalHosts = [hostOf(portal)].concat((base.portalHosts || []).map(h => h.toLowerCase())).filter(Boolean);
    return {
      id: base.id, name: base.name, short: base.short, domain: base.domain, color: base.color, kind: base.kind,
      verified: !!base.verified, isHit: base.id === 'hit',
      moodle, moodleHosts: Array.from(new Set(moodleHosts)), portal, portalHosts: Array.from(new Set(portalHosts)),
      portalName: base.portalName || 'פורטל מידע אישי',
      // "סטודנט ב-HIT" / "סטודנט בטכניון" / "סטודנט באוניברסיטה העברית": the name as it reads after the Hebrew ב
      // (the definite ה goes into the ב).
      inName: base.id === 'hit' ? '-HIT' : base.name.replace(/^ה/, ''),
    };
  }

  // Whether url is a page of this Moodle (its hosts, and under its path when the root has one).
  function isMoodleUrl(inst, url) {
    let u;
    try { u = new URL(url || ''); } catch { return false; }
    if (u.protocol !== 'https:' || !inst || !inst.moodle) return false;
    const host = u.hostname.toLowerCase();
    if (!inst.moodleHosts.includes(host)) return false;
    let root;
    try { root = new URL(inst.moodle); } catch { return false; }
    if (host !== root.hostname.toLowerCase() || root.pathname === '/' || root.pathname === '') return true;
    const p = root.pathname.replace(/\/+$/, '').toLowerCase();
    const q = u.pathname.toLowerCase();
    return q === p || q.startsWith(p + '/');
  }

  function isPortalUrl(inst, url) {
    try {
      const u = new URL(url || '');
      return u.protocol === 'https:' && !!inst && inst.portalHosts.includes(u.hostname.toLowerCase());
    } catch { return false; }
  }

  // The badge shown while the logo is loading, or when there is none: up to three letters of the short name.
  function initials(inst) {
    const s = String((inst && inst.short) || '?').replace(/[^A-Za-z]/g, '');
    return (s.length <= 4 ? s : s.slice(0, 3)).toUpperCase() || '?';
  }

  // Search by Hebrew or English name, ignoring punctuation (בר אילן finds בר-אילן).
  function search(query) {
    const norm = x => String(x || '').toLowerCase().replace(/[\s\-–'"״׳.]/g, '');
    const q = norm(query);
    if (!q) return LIST.slice();
    return LIST.filter(i => norm(i.name).includes(q) || norm(i.short).includes(q) || norm(i.domain).includes(q));
  }

  const api = { LIST, DEFAULT, byId, normalizeMoodle, resolve, isMoodleUrl, isPortalUrl, initials, search };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Institutions = api;
})(typeof window !== 'undefined' ? window : globalThis);
