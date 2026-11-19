// "שיחה חיה" (macOS host: live-notes.js). A card at the top of a course's "הקלטות" tab starts recording a live call
// (a study group, office hours, a lecture on Zoom that nobody records); a small bar stays on screen with the time and a
// stop button, on every page of the app. When the call ends, the notes open as a page, and the audio is deleted.
// The card stays hidden until the host answers, so it is not shown on Windows.
let liveInfo = null;      // { available, system, needsKey }
let liveState = null;     // the call being recorded or written up, from the host
let livePending = [];     // calls whose notes were not written (no network...): retry or delete
const liveLists = {};     // course -> saved notes
let liveLevel = { sys: 0, mic: 0, seconds: 0 };

function askLive() { send({ type: 'live', op: 'ping' }); }

function liveEvent(m) {
  if (m.op === 'ready') {
    liveInfo = { available: !!m.available, system: !!m.system, needsKey: !!m.needsKey };
    livePending = m.pending || [];
    liveState = m.state || null;
    liveBar(); liveRefreshCard();
    return;
  }
  if (m.op === 'state') { liveState = m.state; if (!liveState) liveLevel = { sys: 0, mic: 0, seconds: 0 }; liveBar(); liveRefreshCard(); return; }
  if (m.op === 'level') { if (liveState && m.id === liveState.id) { liveLevel = m; liveState.seconds = m.seconds; liveBarTick(); } return; }
  if (m.op === 'list') { liveLists[m.course] = m.items || []; livePending = m.pending || livePending; liveRefreshCard(); return; }
  if (m.op === 'done') { toast('ההערות מהשיחה מוכנות. ההקלטה נמחקה.', { action: 'פתח', onAction: () => liveOpen(m.path, m.title), ms: 12000 }); return; }
  if (m.op === 'empty') { toast('לא נשמע דיבור בהקלטה, אז לא נכתבו הערות. ההקלטה נמחקה.', { error: true, ms: 8000 }); return; }
  if (m.op === 'failed') { toast(m.text + '. ההקלטה נשמרה, ואפשר לנסות שוב מלשונית ההקלטות של הקורס.', { error: true, action: 'נסה שוב', onAction: () => send({ type: 'live', op: 'retry', course: m.course, id: m.id }), ms: 15000 }); }
}

function liveOpen(path, title) { openViewer(path, title || 'הערות משיחה', '', 0); }
const liveClock = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
function liveRefreshCard() { if (S.view === 'course' && S.tab === 'recs' && typeof renderRecs === 'function') renderRecs(); }

// The card in the course's "הקלטות" tab.
function liveRecsCard(p) {
  if (!liveInfo || !liveInfo.available || !S.course) return;
  const course = S.course.name;
  if (!(course in liveLists)) { liveLists[course] = []; send({ type: 'live', op: 'list', course }); }
  const busy = !!liveState;
  const here = busy && liveState.course === course;
  const card = h(`<div class="card pad-lg live-card" style="margin-bottom:14px">
    <div class="row" style="gap:14px;align-items:flex-start"><span class="live-ic" data-ic="mic"></span>
    <div class="grow"><h2>הערות משיחה חיה</h2>
    <p class="muted" style="margin:4px 0 12px">קבוצת לימוד, שעת קבלה, פגישת פרויקט או שיעור ב-Zoom שאף אחד לא מקליט. SumIT שומע את השיחה ואותך, וכשהיא נגמרת הוא כותב לך את הנקודות העיקריות. ההקלטה עצמה נמחקת, ונשארות רק ההערות.</p>
    <div data-form class="row wrap" style="gap:8px"><input type="text" data-title maxlength="80" placeholder="על מה השיחה? (לא חובה)" style="flex:1;min-width:200px"><button class="primary" data-start><span data-ic="mic"></span>התחל הקלטה</button></div>
    <label class="row live-mic" style="gap:6px;margin-top:8px"><input type="checkbox" data-mic checked> גם המיקרופון שלי</label>
    <p class="muted live-note" data-note hidden></p></div></div>
    <div data-lists></div></div>`);
  const note = card.querySelector('[data-note]');
  const notes = [];
  if (liveInfo.needsKey) notes.push('צריך מפתח Gemini כדי לכתוב הערות (הוא זול, ומתמלל עברית טוב). הוסף אותו בהגדרות, תחת מנועי AI.');
  if (!liveInfo.system) notes.push('ב-macOS הזה נשמע רק המיקרופון. כדי לשמוע גם את הצד השני בשיחה צריך macOS 14.2 ומעלה.');
  if (busy) notes.push(here ? 'מקליט עכשיו את השיחה של הקורס הזה. הפס למטה מראה את הזמן ועוצר.' : 'מקליט עכשיו שיחה בקורס ' + liveState.course + '.');
  if (notes.length) { note.hidden = false; note.textContent = notes.join(' '); }
  const start = card.querySelector('[data-start]');
  start.disabled = busy || liveInfo.needsKey;
  start.onclick = () => liveConsent(() => send({ type: 'live', op: 'start', course, title: card.querySelector('[data-title]').value.trim(), mic: card.querySelector('[data-mic]').checked }));
  if (liveInfo.needsKey) { const b = h('<button class="soft small" style="margin-top:8px">פתח את ההגדרות</button>'); b.onclick = () => show('settings'); note.after(b); }

  const lists = card.querySelector('[data-lists]');
  const pending = livePending.filter(x => x.course === course);
  for (const x of pending) {
    const row = h(`<div class="check-row live-row"><div class="ci">${IC.alert}</div><div class="grow"><b dir="auto"></b><small dir="auto"></small></div><button class="soft small" data-retry>נסה שוב</button><button class="ghost small" data-del aria-label="מחק את ההקלטה">${IC.trash}</button></div>`);
    row.querySelector('b').textContent = (x.title || 'שיחה') + ' · ' + new Date(x.started).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
    row.querySelector('small').textContent = (x.error || 'ההערות לא נכתבו עדיין') + ' · ההקלטה נמחקת לבד אחרי שבוע';
    row.querySelector('[data-retry]').onclick = () => send({ type: 'live', op: 'retry', course, id: x.id });
    row.querySelector('[data-del]').onclick = () => { if (confirm('למחוק את ההקלטה של השיחה בלי לכתוב הערות?')) send({ type: 'live', op: 'discard', course, id: x.id }); };
    lists.append(row);
  }
  const saved = liveLists[course] || [];
  if (saved.length) {
    lists.append(h('<b class="live-sub">שיחות קודמות</b>'));
    for (const x of saved.slice(0, 12)) {
      const row = h(`<button class="check-row live-row live-open"><div class="ci">${IC.note}</div><div class="grow"><b dir="auto"></b><small></small></div></button>`);
      row.querySelector('b').textContent = x.title;
      row.querySelector('small').textContent = new Date(x.mtime).toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
      row.onclick = () => liveOpen(x.path, x.title);
      lists.append(row);
    }
  }
  p.append(card);
}

// Before the first recording of a session: the people in the call should know.
let liveConsented = false;
function liveConsent(go) {
  if (liveConsented) { go(); return; }
  const d = h(`<dialog class="summary-options" dir="rtl" aria-labelledby="liveConsentTitle">
    <div class="row"><h2 id="liveConsentTitle" class="grow">לפני שמקליטים</h2><button class="ghost small" data-close aria-label="סגור">×</button></div>
    <p>ספר למשתתפים בשיחה שאתה מקליט כדי לכתוב הערות. יש מרצים ומוסדות שלא מרשים להקליט שיעורים, אז כדאי לשאול קודם.</p>
    <p class="muted">השמע נשמר רק במחשב שלך עד שההערות נכתבות, נשלח ל-Gemini עם המפתח שלך לתמלול, ואז נמחק.</p>
    <div class="row"><div class="grow"></div><button class="primary" data-go><span data-ic="mic"></span>הבנתי, התחל</button><button class="ghost" data-close>ביטול</button></div></dialog>`);
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.querySelectorAll('[data-close]').forEach(b => b.onclick = () => d.close());
  d.querySelector('[data-go]').onclick = () => { liveConsented = true; d.close(); go(); };
  d.showModal();
}

// The bar on screen while a call is recorded or written up.
function liveBar() {
  let bar = document.getElementById('liveBar');
  document.body.classList.toggle('live-on', !!liveState);
  if (!liveState) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = h(`<div id="liveBar" class="live-bar" role="status" dir="rtl">
      <span class="live-dot"></span><div class="grow"><b data-head></b><small data-sub dir="auto"></small></div>
      <span class="live-meters" aria-hidden="true"><i data-sys></i><i data-mic></i></span><b class="live-time" data-time></b>
      <button class="primary small" data-stop><span data-ic="stop"></span>סיים וכתוב הערות</button>
      <button class="ghost small" data-cancel aria-label="בטל ומחק את ההקלטה">${IC.trash}</button></div>`);
    document.body.append(bar);
    bar.querySelector('[data-stop]').onclick = () => send({ type: 'live', op: 'stop' });
    bar.querySelector('[data-cancel]').onclick = () => { if (confirm('לבטל את ההקלטה ולמחוק אותה, בלי הערות?')) send({ type: 'live', op: 'cancel' }); };
  }
  const st = liveState.state;
  const recording = st === 'recording';
  bar.classList.toggle('working', !recording);
  bar.querySelector('[data-head]').textContent = recording ? 'מקליט שיחה' : st === 'stopping' ? 'עוצר את ההקלטה...' : 'כותב את ההערות...';
  const sub = [liveState.course];
  if (liveState.title) sub.push(liveState.title);
  if (!recording && liveState.parts) sub.push('תומללו ' + liveState.done + ' מתוך ' + liveState.parts + ' קטעים');
  if (recording && liveState.warn === 'system') sub.push('השמע של המחשב לא נשמע: אשר את SumIT בהגדרות המערכת › פרטיות ואבטחה › הקלטת שמע');
  if (recording && liveState.warn === 'mic') sub.push('המיקרופון לא נשמע: אשר את SumIT בהגדרות המערכת › פרטיות ואבטחה › מיקרופון');
  bar.querySelector('[data-sub]').textContent = sub.join(' · ');
  bar.querySelector('[data-stop]').hidden = !recording;
  bar.querySelector('[data-cancel]').hidden = !recording;
  bar.querySelector('.live-meters').hidden = !recording;
  liveBarTick();
}
function liveBarTick() {
  const bar = document.getElementById('liveBar');
  if (!bar || !liveState) return;
  bar.querySelector('[data-time]').textContent = liveClock(liveState.seconds);
  const lv = (x) => Math.min(100, Math.round(Math.sqrt(Math.max(0, x)) * 260)) + '%';
  bar.querySelector('[data-sys]').style.height = lv(liveLevel.sys);
  bar.querySelector('[data-mic]').style.height = lv(liveLevel.mic);
}
