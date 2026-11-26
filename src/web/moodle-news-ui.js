// "הודעות מהמרצים" (macOS host: moodle-news.js). The announcements forum of each course, read in the background: a card in
// the home pane "מה מחכה לי" with the latest ones, and a banner at the top of a course for an important one not read yet
// (a cancelled lesson, a change of time or room, an exam or a submission). Hidden until the host answers, so not on Windows.
let newsInfo = null;          // { available }
let newsItems = [];
let newsOpenId = '';          // the announcement shown open in the home card
let newsChecking = false;

const NewsKinds = {
  cancel: { label: 'בוטל', cls: 'bad', emo: '🚫' },
  change: { label: 'שינוי', cls: 'warn', emo: '🔁' },
  exam: { label: 'מבחן / הגשה', cls: 'info', emo: '📝' },
  general: { label: 'עדכון', cls: '', emo: '📣' },
};

function askNews() { send({ type: 'news', op: 'ping' }); }

function newsEvent(m) {
  if (m.op === 'ready') { newsInfo = { available: !!m.available }; newsItems = m.items || []; newsRefresh(); return; }
  if (m.op === 'list') { newsItems = m.items || []; newsRefresh(); return; }
  if (m.op === 'checking') { newsChecking = true; newsHome(); return; }
  if (m.op === 'checked') { newsChecking = false; newsHome(); toast('בדקתי את לוחות ההודעות של הקורסים.', { ms: 4000 }); return; }
  if (m.op === 'show') { newsOpenId = m.id; show('home'); newsHome(); const c = $('newsCard'); if (c) c.scrollIntoView({ block: 'nearest' }); }
}

function newsRefresh() { newsHome(); newsCourseBanner(); }

const newsWhen = (t) => {
  const d = Math.floor((Date.now() - t) / 60000);
  if (d < 60) return d <= 1 ? 'עכשיו' : `לפני ${d} דקות`;
  if (d < 24 * 60) { const x = Math.floor(d / 60); return x === 1 ? 'לפני שעה' : `לפני ${x} שעות`; }
  const days = Math.floor(d / 1440);
  return days === 1 ? 'אתמול' : days < 7 ? `לפני ${days} ימים` : new Date(t).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
};

function newsRead(it) { if (!it.read) { it.read = true; send({ type: 'news', op: 'read', id: it.id }); } }

function newsOpenInMoodle(it) { newsRead(it); if (it.url) openSite('moodle', it.url); }

// The card at the top of the home pane "מה מחכה לי": the last two weeks, newest first, important ones marked.
function newsHome() {
  const pane = document.querySelector('#homeTrack .home-pane[data-pane="1"]');
  if (!pane || !newsInfo || !newsInfo.available) return;
  let card = $('newsCard');
  if (!card) { card = h('<div class="card news-card" id="newsCard"></div>'); pane.prepend(card); }
  const recent = newsItems.filter(x => Date.now() - x.when < 14 * 86400000).sort((a, b) => b.when - a.when);
  const unread = recent.filter(x => !x.read).length;
  card.innerHTML = `<div class="card-head"><span class="ic other" data-ic="bell"></span><h2>הודעות מהמרצים</h2>${unread ? `<span class="chip warn">${unread} חדשות</span>` : ''}
    <button class="small ghost" data-check ${newsChecking ? 'disabled' : ''}>${newsChecking ? 'בודק...' : 'בדוק עכשיו'}</button>${unread ? '<button class="small ghost" data-all>סמן הכל כנקרא</button>' : ''}</div><div data-list></div>`;
  card.querySelector('[data-check]').onclick = () => send({ type: 'news', op: 'check' });
  const all = card.querySelector('[data-all]');
  if (all) all.onclick = () => { recent.forEach(x => x.read = true); send({ type: 'news', op: 'readAll' }); newsRefresh(); };
  const list = card.querySelector('[data-list]');
  if (!recent.length) {
    list.append(h('<p class="muted news-empty">אין הודעות חדשות מהשבועיים האחרונים. SumIT בודק את לוח ההודעות של כל קורס שהגדרת, כל שעתיים.</p>'));
  }
  for (const it of recent.slice(0, 6)) {
    const k = NewsKinds[it.kind] || NewsKinds.general;
    const open = newsOpenId === it.id;
    const row = h(`<div class="news-row${it.read ? '' : ' unread'}${open ? ' open' : ''}"><button class="news-head"><span class="news-emo">${emo(k.emo)}</span>
      <div class="grow"><b dir="auto"></b><small dir="auto"></small></div><span class="chip ${k.cls}">${k.label}</span></button>
      <div class="news-body" ${open ? '' : 'hidden'}><p dir="auto"></p><div class="row" style="gap:8px"></div></div></div>`);
    row.querySelector('b').textContent = it.subject;
    row.querySelector('small').textContent = it.course + (it.author ? ' · ' + it.author : '') + ' · ' + newsWhen(it.when);
    row.querySelector('.news-body p').textContent = it.text || 'הטקסט של ההודעה לא נקרא. אפשר לפתוח אותה ב-Moodle.';
    const acts = row.querySelector('.news-body .row');
    if (it.url) { const b = h('<button class="soft small">פתח ב-Moodle</button>'); b.onclick = () => newsOpenInMoodle(it); acts.append(b); }
    row.querySelector('.news-head').onclick = () => { newsOpenId = open ? '' : it.id; newsRead(it); newsHome(); newsCourseBanner(); };
    list.append(row);
  }
  icons(card);
}

// In a course: the newest important announcement not read yet.
function newsCourseBanner() {
  const old = $('newsBanner'); if (old) old.remove();
  if (!newsInfo || !newsInfo.available || S.view !== 'course' || !S.course || !$('courseStatus')) return;
  if (typeof inSetup === 'function' && inSetup()) return;
  const it = newsItems.filter(x => x.course === S.course.name && !x.read && x.kind !== 'general').sort((a, b) => b.when - a.when)[0];
  if (!it) return;
  const k = NewsKinds[it.kind];
  const el = h(`<div class="new-material news-banner news-${it.kind}" id="newsBanner"><span class="news-emo big">${emo(k.emo, true)}</span>
    <div class="grow"><b dir="auto"></b><small dir="auto"></small></div><div class="row"></div></div>`);
  el.querySelector('b').textContent = 'הודעה מהמרצה: ' + it.subject;
  el.querySelector('small').textContent = (it.text || '').replace(/\s+/g, ' ').slice(0, 220) + ' · ' + newsWhen(it.when);
  const acts = el.querySelector('.row');
  if (it.url) { const b = h('<button class="primary small">פתח ב-Moodle</button>'); b.onclick = () => { newsOpenInMoodle(it); el.remove(); }; acts.append(b); }
  const ok = h('<button class="ghost small">הבנתי</button>');
  ok.onclick = () => { newsRead(it); newsRefresh(); };
  acts.append(ok);
  $('courseStatus').before(el);
}
