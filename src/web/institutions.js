// The academic institutions in Israel that SumIT can work with: where each one's Moodle and personal portal are.
// Shared by the page (the picker) and the macOS host (routing). Pure data and helpers, no DOM.
//
// moodle  - the Moodle root (no trailing slash). Some institutions open a new Moodle every year (the Technion's
//           moodleNN, TAU's /YYYY, Braude's moodleNN, Haifa's mwNN, HUJI's /huNN), so the student can change it in
//           the settings. '' = not known yet: the student types it once.
// hosts   - other hosts that belong to the same Moodle (an address that redirects to it).
// portal  - the personal portal (grades, timetable). Where it is not known, the institution's site, where the
//           student finds the link.
// domain  - the institution's website.
// logos   - where its real logo is (its page on the Hebrew Wikipedia, or its own site), best first. The app reads it
//           the first time and keeps it; the site's icon is the fallback.
// verified - the Moodle address was checked to answer as a Moodle (November 2026). Real sign-in was tested at HIT only.
(function (root) {
  'use strict';

  const LIST = [
    // universities
    { id: 'hit', kind: 'uni', name: 'מכון טכנולוגי חולון', short: 'HIT', domain: 'hit.ac.il', color: '#0b5aa6',
      moodle: 'https://md.hit.ac.il', portal: 'https://portal.hit.ac.il/', portalHosts: ['portal.hit.ac.il', 'webrashim.hit.ac.il'], verified: true,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Holon_Institute_of_Technology_logo.svg?width=320'] },
    { id: 'technion', kind: 'uni', name: 'הטכניון', short: 'Technion', domain: 'technion.ac.il', color: '#0a3a7a',
      moodle: 'https://moodle26.technion.ac.il', portal: 'https://cheesefork.cf/', portalName: 'CheeseFork', portalHosts: ['cheesefork.cf', 'students.technion.ac.il'], verified: true,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Technion_logo.svg?width=320'] },
    { id: 'tau', kind: 'uni', name: 'אוניברסיטת תל אביב', short: 'TAU', domain: 'tau.ac.il', color: '#0f3e72',
      moodle: 'https://moodle.tau.ac.il/2026', portal: 'https://my.tau.ac.il/', verified: true,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Tel_Aviv_university_logo_-_Hebrew.png?width=320'] },
    { id: 'huji', kind: 'uni', name: 'האוניברסיטה העברית', short: 'HUJI', domain: 'huji.ac.il', color: '#1b4f8c',
      moodle: 'https://moodle4.cs.huji.ac.il/hu26', hosts: ['moodle.huji.ac.il'], portal: 'https://www.huji.ac.il/dataj/controller/stu/', verified: false,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Hebrew_University_Logo.svg?width=320'] },
    { id: 'biu', kind: 'uni', name: 'אוניברסיטת בר-אילן', short: 'BIU', domain: 'biu.ac.il', color: '#0b6b4f',
      moodle: 'https://lemida.biu.ac.il', portal: 'https://inbar.biu.ac.il/', verified: true,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Bar_Ilan_logo.png?width=320'] },
    { id: 'bgu', kind: 'uni', name: 'אוניברסיטת בן-גוריון', short: 'BGU', domain: 'bgu.ac.il', color: '#e0791a',
      moodle: 'https://moodle.bgu.ac.il/moodle', portal: 'https://bgu4u.bgu.ac.il/', verified: true,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Ben-Gurion_University_of_the_Negev_logo.svg?width=320'] },
    { id: 'haifa', kind: 'uni', name: 'אוניברסיטת חיפה', short: 'Haifa', domain: 'haifa.ac.il', color: '#1d6fb8',
      moodle: 'https://mw27.haifa.ac.il', portal: 'https://www.haifa.ac.il/students/', verified: false,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Haifa_logo_official_apperence_dark_%28cropped%29.png?width=320', 'https://www.haifa.ac.il/wp-content/uploads/2025/02/univlogo-header.svg'] },
    { id: 'ariel', kind: 'uni', name: 'אוניברסיטת אריאל', short: 'Ariel', domain: 'ariel.ac.il', color: '#2a6a3c',
      moodle: 'https://moodlearn.ariel.ac.il', hosts: ['moodle.ariel.ac.il'], portal: 'https://www.ariel.ac.il/', verified: true,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Ariel_university.logo.jpg?width=320'] },
    { id: 'openu', kind: 'uni', name: 'האוניברסיטה הפתוחה', short: 'OpenU', domain: 'openu.ac.il', color: '#0068b3',
      moodle: 'https://opal.openu.ac.il', portal: 'https://sheilta.apps.openu.ac.il/', portalName: 'שאילתא', verified: true,
      logos: ['https://www.openu.ac.il/_layouts/15/OpenU_WWW/Theming/Global/images/LOGO_OU_BLACK.svg', 'https://he.wikipedia.org/wiki/Special:FilePath/Open_university_israel_logo.svg?width=320'] },
    { id: 'runi', kind: 'uni', name: 'אוניברסיטת רייכמן', short: 'RUNI', domain: 'runi.ac.il', color: '#1c2b4a',
      moodle: 'https://moodle.runi.ac.il/2026', portal: 'https://my.runi.ac.il/', verified: false,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/ReichmanUni.svg?width=320'] },
    { id: 'telhai', kind: 'uni', name: 'תל-חי – אוניברסיטת קריית שמונה בגליל', short: 'Tel-Hai', domain: 'telhai.ac.il', color: '#5a8f29',
      moodle: 'https://moodle.telhai.ac.il', portal: 'https://www.telhai.ac.il/', verified: false,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Logo-greenkiryatshmonaUniversity.svg?width=320', 'https://he.wikipedia.org/wiki/Special:FilePath/TelHaiAcademicCollege.svg?width=320'] },

    // academic colleges
    { id: 'afeka', kind: 'college', name: 'אפקה – המכללה האקדמית להנדסה', short: 'Afeka', domain: 'afeka.ac.il', color: '#d2232a',
      moodle: 'https://moodle.afeka.ac.il', portal: 'https://yedion.afeka.ac.il/', verified: true,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Afeka_College_of_Engineering_logo.svg?width=320', 'https://www.afeka.ac.il/media/owsb1xq5/logo-1.svg'] },
    { id: 'mta', kind: 'college', name: 'המכללה האקדמית תל אביב-יפו', short: 'MTA', domain: 'mta.ac.il', color: '#00508f',
      moodle: 'https://moodle.mta.ac.il', portal: 'https://www.mta.ac.il/', verified: true,
      logos: ['https://www.mta.ac.il/wp-content/uploads/2026/11/mta_logo_1252_594_trans3.png'] },
    { id: 'jce', kind: 'college', name: 'עזריאלי – המכללה האקדמית להנדסה ירושלים', short: 'Azrieli', domain: 'jce.ac.il', color: '#00428a',
      moodle: 'https://moodle.jce.ac.il', portal: 'https://www.jce.ac.il/', verified: true,
      logos: ['https://www.jce.ac.il/wp-content/uploads/2024/11/JCE-logo-original.svg'] },
    { id: 'braude', kind: 'college', name: 'אורט בראודה', short: 'Braude', domain: 'braude.ac.il', color: '#0060a8',
      moodle: 'https://moodle27.braude.ac.il', portal: 'https://info.braude.ac.il/', verified: true,
      logos: ['https://w3.braude.ac.il/wp-content/uploads/2022/12/92349-9_NEW-LOGO-2.png'] },
    { id: 'shenkar', kind: 'college', name: 'שנקר', short: 'Shenkar', domain: 'shenkar.ac.il', color: '#222222',
      moodle: 'https://online.shenkar.ac.il', portal: 'https://www.shenkar.ac.il/', verified: true,
      logos: ['https://www.shenkar.ac.il/wp-content/uploads/2026/01/mobile-logo.svg'] },
    { id: 'ruppin', kind: 'college', name: 'המרכז האקדמי רופין', short: 'Ruppin', domain: 'ruppin.ac.il', color: '#00748a',
      moodle: 'https://moodle.ruppin.ac.il', portal: 'https://www.ruppin.ac.il/', verified: true,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Ruppin_Academic_Center_Logo.svg?width=320'] },
    { id: 'sapir', kind: 'college', name: 'המכללה האקדמית ספיר', short: 'Sapir', domain: 'sapir.ac.il', color: '#4f2683',
      moodle: 'https://moodle.sapir.ac.il', portal: 'https://www.sapir.ac.il/', verified: true,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Logo_Sapir_NEW-16.png?width=320', 'https://he.wikipedia.org/wiki/Special:FilePath/Sapir_new_logo.svg?width=320'] },
    { id: 'sce', kind: 'college', name: 'סמי שמעון – המכללה האקדמית להנדסה', short: 'SCE', domain: 'sce.ac.il', color: '#003b71',
      moodle: 'https://moodle.sce.ac.il', portal: 'https://www.sce.ac.il/', verified: true,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/SCE_logo.png?width=320'] },
    { id: 'jct', kind: 'college', name: 'המרכז האקדמי לב', short: 'JCT', domain: 'jct.ac.il', color: '#0b3d6e',
      moodle: 'https://moodle.jct.ac.il', portal: 'https://levnet.jct.ac.il/', portalName: 'לבנט', verified: true,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Jerusalem_College_of_Technology_Logo.png?width=320'] },
    { id: 'colman', kind: 'college', name: 'המכללה למינהל', short: 'COLMAN', domain: 'colman.ac.il', color: '#00539b',
      moodle: 'https://moodle.colman.ac.il', portal: 'https://www.colman.ac.il/', verified: true,
      logos: ['https://www.colman.ac.il/content/images/logo.png', 'https://he.wikipedia.org/wiki/Special:FilePath/The_College_of_Management_Academic_Studies_logo.png?width=320'] },
    { id: 'ono', kind: 'college', name: 'הקריה האקדמית אונו', short: 'Ono', domain: 'ono.ac.il', color: '#e4002b',
      moodle: '', portal: 'https://yedion.ono.ac.il/yedion/FireflyWeb.aspx?prgname=login', verified: false,
      logos: ['https://www.ono.ac.il/wp-content/uploads/2021/11/logo.png'] },
    { id: 'kinneret', kind: 'college', name: 'המכללה האקדמית כנרת', short: 'Kinneret', domain: 'kinneret.ac.il', color: '#0096c7',
      moodle: 'https://moodle.kinneret.ac.il', portal: 'https://www.kinneret.ac.il/', verified: true,
      logos: ['https://kinneret.ac.il/wp-content/uploads/2026/01/Kinneret_Logo_RGB_Hebrew_01.png'] },
    { id: 'yvc', kind: 'college', name: 'המכללה האקדמית עמק יזרעאל', short: 'YVC', domain: 'yvc.ac.il', color: '#2e7d32',
      moodle: '', portal: 'https://yedionsso.yvc.ac.il/yedion/login.aspx', verified: false,
      logos: ['https://yvcwebsite.s3.eu-west-1.amazonaws.com/wp-content/uploads/2022/05/03074336/logo_header.png'] },
    { id: 'wgalil', kind: 'college', name: 'המכללה האקדמית גליל מערבי', short: 'WGalil', domain: 'wgalil.ac.il', color: '#007a99',
      moodle: 'https://moodle.wgalil.ac.il', portal: 'https://www.wgalil.ac.il/', verified: true,
      logos: ['https://wgalil.ac.il/wp-content/themes/Wgalil_ass/images/logo.png'] },
    { id: 'pac', kind: 'college', name: 'המרכז האקדמי פרס', short: 'Peres', domain: 'pac.ac.il', color: '#00457c',
      moodle: '', portal: 'https://yedion.pac.ac.il/yedion/fireflyweb.aspx?appname=BSHITA&prgname=login', verified: false,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/PeresAcademic.svg?width=320'] },
    { id: 'netanya', kind: 'college', name: 'המכללה האקדמית נתניה', short: 'Netanya', domain: 'netanya.ac.il', color: '#003e7e',
      moodle: '', portal: 'https://www.netanya.ac.il/', verified: false,
      logos: ['https://www.netanya.ac.il/wp-content/uploads/2023/10/netay2Logo.png'] },
    { id: 'jmc', kind: 'college', name: 'המכללה האקדמית הדסה (ירושלים הרב-תחומית)', short: 'JMC', domain: 'jmc.ac.il', color: '#6d2077',
      moodle: '', portal: 'https://www.jmc.ac.il/', verified: false,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/Hadasa_College_Jerusalem_Logo.png?width=320'] },
    { id: 'bezalel', kind: 'college', name: 'בצלאל', short: 'Bezalel', domain: 'bezalel.ac.il', color: '#111111',
      moodle: 'https://moodle.bezalel.ac.il', portal: 'https://www.bezalel.ac.il/', verified: true,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/BezalelLogo.svg?width=320'] },
    { id: 'achva', kind: 'college', name: 'המכללה האקדמית אחוה', short: 'Achva', domain: 'achva.ac.il', color: '#00809d',
      moodle: 'https://moodle.achva.ac.il', portal: 'https://www.achva.ac.il/', verified: true,
      logos: ['https://he.wikipedia.org/wiki/Special:FilePath/%D7%9C%D7%95%D7%92%D7%95_%D7%90%D7%97%D7%95%D7%94_%D7%9E%D7%A2%D7%95%D7%93%D7%9B%D7%9F_21.png?width=320'] },
    { id: 'zefat', kind: 'college', name: 'המכללה האקדמית צפת', short: 'Zefat', domain: 'zefat.ac.il', color: '#1b75bb',
      moodle: 'https://moodle.zefat.ac.il', portal: 'https://portal.zefat.ac.il/', verified: false,
      logos: ['https://www.zefat.ac.il/img/brand2026.png'] },
    { id: 'aac', kind: 'college', name: 'המכללה האקדמית אשקלון', short: 'Ashkelon', domain: 'aac.ac.il', color: '#0072bc',
      moodle: 'https://moodle.aac.ac.il', portal: 'https://portal.aac.ac.il/', verified: true,
      logos: ['https://www.aac.ac.il/wp-content/uploads/2016/12/logo.jpg'] },
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
