// The student's calendars (iCal): the card in the settings, and the events that the plan and "next up" use. The host (macOS) only
// fetches and keeps the text; it is read here, with ical.js. The card stays hidden until the host answers, so it is not shown
// where the host has no calendars.
S.calendars = null;     // [{ id, name, source, host, updated, error, ics }] as the host sent them
S.calOcc = [];          // the occurrences from yesterday to 60 days ahead, all calendars together, in order
S.calBusy = false;
let calSeen = new Map();   // id -> the "updated" time that was drawn last, to flash a row that has just been refreshed
let calDay = '';

const dayKey = (d) => d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();

function askCalendars() { send({ type: 'getCalendars' }); }

function readCalendars() {
  const now = new Date(), from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime(), to = from + 62 * 86400000;
  const occ = [];
  for (const c of S.calendars || []) {
    try { for (const o of ICal.expand(c.ics, from, to)) { o.calendar = c.name; occ.push(o); } } catch { }
  }
  S.calOcc = occ.sort((a, b) => a.start - b.start || a.end - b.end);
  calDay = dayKey(now);
}

// The next events that have not ended, within two days: for the "next up" card.
function nextCalendarEvents(n) {
  const now = Date.now();
  return S.calOcc.filter(o => !o.allDay && o.end > now && o.start < now + 48 * 3600000).slice(0, n);
}

function calendarsEvent(m) {
  if (m.type === 'calendarStatus') {
    S.calBusy = !!m.busy;
    if (!m.busy && m.text) toast(m.text, m.error ? { error: true } : {});
    renderCalendars();
    return;
  }
  S.calendars = m.list || [];
  readCalendars();
  $('calendarsCard').hidden = false;
  renderCalendars();
  if (typeof renderToday === 'function') renderToday();
  if (typeof renderTimetable === 'function') renderTimetable(); else if (typeof renderNextUp === 'function') renderNextUp();
}

function agoLabel(ms) {
  if (!ms) return 'לא עודכן עדיין';
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? 'עודכן ממש עכשיו' : m < 60 ? `עודכן לפני ${m} דקות` : m < 1440 ? `עודכן לפני ${Math.round(m / 60)} שעות` : `עודכן לפני ${Math.round(m / 1440)} ימים`;
}

function renderCalendars() {
  const body = $('calBody'); if (!body || !S.calendars) return;
  const draft = { name: body.querySelector('[data-cal-name]')?.value || '', url: body.querySelector('[data-cal-url]')?.value || '' };
  const focused = document.activeElement && body.contains(document.activeElement) ? document.activeElement.dataset.calName !== undefined ? 'name' : document.activeElement.dataset.calUrl !== undefined ? 'url' : '' : '';
  body.innerHTML = '';
  $('calCount').textContent = S.calendars.length ? S.calendars.length + (S.calendars.length === 1 ? ' יומן' : ' יומנים') : '';

  S.calendars.forEach((c, i) => {
    const count = S.calOcc.filter(o => o.calendar === c.name && !o.allDay).length;
    const row = h(`<div class="cal-row" style="--i:${i}"><span class="ic zoom" data-ic="calendar"></span><div class="grow"><b dir="auto"></b><small class="muted" dir="auto"></small></div><span class="chip"></span><button class="ghost small" data-rm title="הסר את היומן" aria-label="הסר את היומן"><span data-ic="trash"></span></button></div>`);
    row.querySelector('b').textContent = c.name;
    row.querySelector('small').textContent = [c.source === 'file' ? 'קובץ' : c.host, c.source === 'file' ? '' : agoLabel(c.updated), `${count} אירועים בחודשיים הקרובים`].filter(Boolean).join(' · ');
    const chip = row.querySelector('.chip');
    chip.textContent = c.error ? 'לא עודכן' : c.source === 'file' ? 'קובץ' : 'מחובר';
    chip.classList.add(c.error ? 'bad' : c.source === 'file' ? 'accent' : 'ok');
    if (c.error) { chip.title = c.error; row.querySelector('small').textContent += ' · ' + c.error; }
    // A new row slides in once; a row that was just refreshed flashes; a redraw for another reason stays still.
    if (!calSeen.has(c.id)) row.classList.add('enter'); else if (calSeen.get(c.id) !== c.updated) row.classList.add('flash');
    calSeen.set(c.id, c.updated);
    row.querySelector('[data-rm]').onclick = () => { if (confirm('להסיר את היומן "' + c.name + '"? הוא ייעלם מהתוכנית.')) send({ type: 'removeCalendar', id: c.id }); };
    body.append(row);
  });
  if (!S.calendars.length) body.append(h('<div class="muted" style="padding:6px 4px">עוד לא חיברת יומן. אירועים מהיומן יחסמו זמן בתוכנית "מה לעשות היום" ויופיעו ב"הבא בתור".</div>'));

  const form = h(`<form class="cal-add" autocomplete="off">
    <input data-cal-name maxlength="60" placeholder="שם היומן (למשל: Google)" aria-label="שם היומן">
    <input data-cal-url dir="ltr" placeholder="הדבק כאן את הכתובת הסודית בפורמט iCal" aria-label="הכתובת הסודית של היומן" spellcheck="false">
    <button class="primary" type="submit"><span data-ic="plus"></span>הוסף יומן</button>
    <button class="soft" type="button" data-file><span data-ic="file"></span>ייבוא קובץ ICS</button>
    <button class="soft cal-refresh" type="button" data-refresh title="רענן עכשיו"><span data-ic="refresh"></span>רענן</button>
  </form>`);
  form.querySelector('[data-cal-name]').value = draft.name; form.querySelector('[data-cal-url]').value = draft.url;
  const busy = S.calBusy;
  form.querySelectorAll('button').forEach(b => { b.disabled = busy; });
  form.querySelector('[data-refresh]').classList.toggle('busy', busy);
  form.querySelector('[data-refresh]').disabled = busy || !S.calendars.some(c => c.source === 'url');
  form.onsubmit = (e) => {
    e.preventDefault();
    const url = form.querySelector('[data-cal-url]').value.trim();
    if (!url) return form.querySelector('[data-cal-url]').focus();
    S.calBusy = true;
    send({ type: 'addCalendar', name: form.querySelector('[data-cal-name]').value.trim(), url });
    form.querySelector('[data-cal-url]').value = ''; renderCalendars();
  };
  form.querySelector('[data-file]').onclick = () => send({ type: 'importCalendarFile' });
  form.querySelector('[data-refresh]').onclick = () => { S.calBusy = true; send({ type: 'refreshCalendars' }); renderCalendars(); };
  body.append(form);
  body.append(h(`<details class="cal-help"><summary>איפה מוצאים את הכתובת ב-Google Calendar?</summary><ol>
    <li>ב-Google Calendar במחשב, לוחצים על גלגל השיניים ← <b>הגדרות</b>.</li>
    <li>ברשימה משמאל, תחת "הגדרות של יומנים אחרים" או "הגדרות היומן שלי", בוחרים את היומן.</li>
    <li>בקטע <b>שילוב יומן</b> מעתיקים את <b>הכתובת הסודית בפורמט iCal</b>.</li>
    <li>מדביקים כאן ולוחצים "הוסף יומן". האפליקציה מרעננת אותו לבד כל חצי שעה.</li></ol>
    <p class="muted">הכתובת הזאת נותנת גישת קריאה ליומן לכל מי שמחזיק בה. היא נשמרת מוצפנת במחשב הזה ואינה נשלחת לשום מקום חוץ מ-Google. אם היא נחשפה, אפשר ליצור כתובת חדשה באותו מסך. עובד גם עם Outlook ו-iCloud, או עם קובץ ICS מייצוא של היומן.</p></details>`));
  icons(body);
  if (focused) body.querySelector(focused === 'name' ? '[data-cal-name]' : '[data-cal-url]')?.focus();
}

// The plan and "next up" use today's date: when the page wakes up on another day, read the calendars again.
function calendarsNewDay() {
  if (S.calendars && calDay && calDay !== dayKey(new Date())) { readCalendars(); if (typeof renderToday === 'function') renderToday(); if (typeof renderTimetable === 'function') renderTimetable(); else if (typeof renderNextUp === 'function') renderNextUp(); }
}
window.addEventListener('focus', calendarsNewDay);
document.addEventListener('visibilitychange', () => { if (!document.hidden) calendarsNewDay(); });
