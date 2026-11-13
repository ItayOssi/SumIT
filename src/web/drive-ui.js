// Sync with Google Drive (macOS): the card in the settings. It stays hidden until the host answers (Windows never does).
let driveState = null;

function driveEvent(m) {
  const first = !driveState;
  driveState = Object.assign({}, driveState || {}, m);
  if (!m.error) delete driveState.error;
  if (!m.busy) { delete driveState.progress; driveState.busy = false; }
  if (m.connecting === undefined) driveState.connecting = false;
  renderDrive();
  if (m.error && !m.quiet) toast(m.error, { error: true });
  else if (m.text && !m.quiet && !first) toast(m.text);
}

function renderDrive() {
  const card = $('driveCard'), body = $('driveBody'), s = driveState;
  renderDriveAccount();
  if (!card || !s) return;
  card.hidden = false;
  const chip = $('driveChip');
  chip.textContent = s.connected ? (s.busy ? 'מסנכרן…' : 'מחובר') : 'לא מחובר';
  chip.className = 'chip' + (s.connected ? ' ok' : '');
  body.innerHTML = '';
  if (!s.connected) {
    const row = h(`<div class="setting"><div class="grow"><b>כל החומר שלך, בכל מחשב</b>
      <small>התחבר עם חשבון Google, והקורסים, הסיכומים, הכרטיסים, ההמחשות ומסלול הלמידה יישמרו בתיקייה "SumIT" ב-Google Drive שלך. במחשב אחר מתחברים לאותו חשבון, והכל יורד אליו.
      ל-SumIT יש גישה רק לקבצים שהוא עצמו יצר, לא לשאר ה-Drive. מפתחות ה-AI לא עולים לענן.</small></div>
      <button class="primary" data-connect><span data-ic="cloud"></span></button></div>`);
    const b = row.querySelector('[data-connect]');
    b.append(document.createTextNode(s.connecting ? 'ממתין לאישור בדפדפן…' : 'התחבר עם Google'));
    b.disabled = !!s.connecting || s.configured === false;
    b.onclick = () => { driveState.connecting = true; renderDrive(); send({ type: 'driveSync', action: 'connect' }); };
    body.append(row);
    if (s.connecting) {
      const c = h('<div class="setting"><div class="grow"><small>נפתח חלון של Google בדפדפן. אשר שם את הגישה, ותחזור לכאן.</small></div><button class="ghost small" data-cancel>ביטול</button></div>');
      c.querySelector('[data-cancel]').onclick = () => send({ type: 'driveSync', action: 'cancel' });
      body.append(c);
    }
    if (s.configured === false) body.append(h('<p class="muted" style="margin:6px 0 0">החיבור ל-Google עוד לא מוגדר בגרסה הזו.</p>'));
  } else {
    const row = h(`<div class="setting"><div class="grow"><b data-email></b><small data-last></small><div class="drive-progress" hidden><i></i></div></div>
      <button class="soft" data-now><span data-ic="refresh"></span>סנכרן עכשיו</button><button class="ghost" data-off>התנתק</button></div>`);
    row.querySelector('[data-email]').textContent = s.email ? 'מחובר כ-' + s.email : 'מחובר ל-Google Drive';
    const when = s.last ? new Date(s.last) : null;
    row.querySelector('[data-last]').textContent = s.busy ? 'מסנכרן את הקבצים…' : when ? 'סונכרן לאחרונה ' + when.toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) + '. מסתנכרן לבד כל כמה דקות.' : 'עוד לא סונכרן.';
    const prog = row.querySelector('.drive-progress');
    if (s.busy && s.progress && s.progress.total) { prog.hidden = false; prog.querySelector('i').style.width = Math.round(s.progress.done / s.progress.total * 100) + '%'; }
    const now = row.querySelector('[data-now]'); now.disabled = !!s.busy;
    now.onclick = () => { driveState.busy = true; renderDrive(); send({ type: 'driveSync', action: 'now' }); };
    row.querySelector('[data-off]').onclick = () => { if (confirm('להתנתק מ-Google Drive? הקבצים יישארו גם במחשב וגם ב-Drive, רק הסנכרון ייעצר.')) send({ type: 'driveSync', action: 'disconnect' }); };
    body.append(row);
    if (s.massDelete) {
      const w = h(`<div class="setting drive-warn"><div class="grow"><b>הסנכרון עצר כדי לא למחוק הרבה קבצים</b><small></small></div><button class="soft small" data-yes>כן, סנכרן</button></div>`);
      w.querySelector('small').textContent = 'הסנכרון היה מוחק ' + s.massDelete + ' קבצים (לאשפה). זה קורה אם החלפת את תיקיית הקורסים או מחקת הרבה בכוונה. אם זה בכוונה, אשר.';
      w.querySelector('[data-yes]').onclick = () => { driveState.massDelete = 0; driveState.busy = true; renderDrive(); send({ type: 'driveSync', action: 'confirmDeletes' }); };
      body.append(w);
    }
    if (s.conflicts && s.conflicts.length) {
      const c = h(`<div class="setting"><div class="grow"><b>קבצים ששונו בשני מחשבים</b><small>שתי הגרסאות נשמרו. הגרסה מ-Drive קיבלה שם עם "מ-Drive" ותאריך:</small><ul class="drive-conflicts"></ul></div><button class="ghost small" data-clear>הבנתי</button></div>`);
      s.conflicts.slice(-5).forEach(n => { const li = document.createElement('li'); li.textContent = n; li.dir = 'auto'; c.querySelector('ul').append(li); });
      c.querySelector('[data-clear]').onclick = () => send({ type: 'driveSync', action: 'clearConflicts' });
      body.append(c);
    }
  }
  icons(card);
}

// The Google account where the student meets it: in the profile (a click on the picture), in the setup wizard, and as a ring
// around the picture in the sidebar (green: synced, orange: syncing, none: not connected).
function renderDriveAccount() {
  const s = driveState, logo = $('navLogo');
  if (logo) logo.dataset.cloud = !s || s.configured === false ? '' : !s.connected ? 'off' : s.error ? 'bad' : s.busy ? 'busy' : 'ok';
  for (const id of ['profileGoogle', 'wizGoogle']) {
    const box = $(id); if (!box) continue;
    box.hidden = !s || s.configured === false;
    if (box.hidden) continue;
    box.innerHTML = '';
    const row = h(`<div class="check-row${s.connected ? ' ok' : ''}"><div class="ci" data-ic="cloud"></div><div class="grow"><b></b><small></small></div></div>`);
    const when = s.last ? new Date(s.last).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    row.querySelector('b').textContent = s.connected ? (s.email ? 'מחובר כ-' + s.email : 'מחובר ל-Google') : s.connecting ? 'ממתין לאישור בדפדפן…' : 'לא מחובר לחשבון Google';
    row.querySelector('small').textContent = s.connected ? (s.busy ? 'מסנכרן…' : when ? 'סונכרן לאחרונה ' + when + '. הפרופיל, הסיכומים והמטלות נשמרים ב-Drive.' : 'מסנכרן בפעם הראשונה…')
      : 'התחבר, והשם, התמונה, הסיכומים והמטלות שלך יישמרו ב-Drive ויחזרו בכל מחשב.';
    if (!s.connected) {
      const b = h('<button class="primary"><span data-ic="cloud"></span></button>');
      b.append(document.createTextNode(s.connecting ? 'ממתין…' : 'התחבר עם Google'));
      b.disabled = !!s.connecting;
      b.onclick = () => { driveState.connecting = true; renderDrive(); send({ type: 'driveSync', action: 'connect' }); };
      row.append(b);
      if (s.connecting) { const c = h('<button class="ghost small">ביטול</button>'); c.onclick = () => send({ type: 'driveSync', action: 'cancel' }); row.append(c); }
    } else if (id === 'profileGoogle') {
      const b = h('<button class="soft small"><span data-ic="refresh"></span>סנכרן עכשיו</button>');
      b.disabled = !!s.busy;
      b.onclick = () => { driveState.busy = true; renderDrive(); send({ type: 'driveSync', action: 'now' }); };
      row.append(b);
    }
    box.append(row); icons(box);
  }
}

function askDrive() { send({ type: 'driveSync', action: 'state' }); }
