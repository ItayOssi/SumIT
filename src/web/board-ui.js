// The friends leaderboard (macOS only, leaderboard.js on the host): the "חברים" tab of the study track. A group has a code of
// six letters; whoever has it joins, and everyone sees the sparks of this week. The tab is shown only when the host answers
// that a Firebase project is set up.

function boardSend(m) { send(Object.assign({ type: 'board' }, m)); }

function boardEvent(m) {
  const was = S.board || {};
  S.board = Object.assign({}, was, m);
  if (!m.list) S.board.list = m.groups && m.groups.length ? was.list : [];
  S.board.busy = false;
  if (m.focus) S.boardFocus = m.focus;
  if (m.created) toast('הקבוצה נוצרה. שלח לחברים את הקוד ' + m.created);
  if (m.joined) toast('הצטרפת לקבוצה');
  if (m.error) toast(m.error, { error: true });
  // A change in the list of groups opens the right one; asked once after the state is known.
  if (m.configured && m.connected && m.groups && m.groups.length && !m.list && !S.boardListed) { S.boardListed = true; S.board.busy = true; boardSend({ op: 'list' }); }
  if (S.track && typeof renderTrack === 'function' && $('view-track') && $('view-track').classList.contains('active')) renderTrack();
}

const boardAvatar = (m, size) => {
  const el = h(`<span class="board-av" style="--av:${size || 40}px"></span>`);
  if (m.photo) { const i = document.createElement('img'); i.src = m.photo; i.alt = ''; el.append(i); }
  else {
    let n = 0; for (const ch of m.name) n = (n * 31 + ch.charCodeAt(0)) % 360;
    el.style.setProperty('--hue', n); el.classList.add('initials'); el.textContent = m.name.trim().slice(0, 1);
  }
  return el;
};
const boardNum = (n) => Number(n || 0).toLocaleString('he-IL');

function trackBoardPane(pane) {
  const b = S.board || {};
  if (!b.connected) {
    const c = h(`<div class="card pad-lg board-empty">${sparkImg('trophy', 'board-hero-ic')}<div class="grow"><h3>טבלת החברים</h3>
      <p class="muted">רואים מי צבר הכי הרבה ניצוצות השבוע, עם החברים שלך מהתואר. כדי שכל אחד יופיע בשם שלו, מתחברים עם חשבון Google, באותו חיבור של הגיבוי ב-Drive בפרופיל.</p>
      <button class="primary" data-go><span data-ic="user"></span>התחבר עם Google בפרופיל</button></div></div>`);
    c.querySelector('[data-go]').onclick = () => openProfile();
    pane.append(c); return;
  }
  const groups = b.groups || [];
  const lists = b.list || [];
  if (!groups.some(g => g.code === S.boardFocus)) S.boardFocus = groups.length ? groups[0].code : '';
  if (!groups.length) S.boardAdding = true;

  // The groups, as chips, and "+ קבוצה".
  if (groups.length) {
    const bar = h('<div class="board-groups" role="tablist" aria-label="הקבוצות שלי"></div>');
    for (const g of groups) {
      const chip = h('<button type="button" role="tab" class="board-chip"></button>');
      chip.textContent = g.name; chip.classList.toggle('on', g.code === S.boardFocus && !S.boardAdding); chip.setAttribute('aria-selected', String(g.code === S.boardFocus && !S.boardAdding));
      chip.onclick = () => { S.boardFocus = g.code; S.boardAdding = false; renderTrack(); };
      bar.append(chip);
    }
    if (groups.length < (b.max || 5)) {
      const add = h('<button type="button" class="board-chip add"><span data-ic="plus"></span>קבוצה</button>');
      add.classList.toggle('on', !!S.boardAdding);
      add.onclick = () => { S.boardAdding = !S.boardAdding; renderTrack(); };
      bar.append(add);
    }
    const refresh = h('<button type="button" class="ghost small board-refresh" title="רענן את הטבלה"><span data-ic="refresh"></span></button>');
    refresh.onclick = () => { S.board.busy = true; renderTrack(); boardSend({ op: 'list' }); };
    bar.append(refresh);
    pane.append(bar);
  }

  if (S.boardAdding) { pane.append(boardAddCard(groups.length)); return; }

  const g = groups.find(x => x.code === S.boardFocus);
  const data = lists.find(x => x.code === S.boardFocus);
  const card = h(`<div class="card pad-lg board-card"><div class="board-head"><div class="grow"><h3></h3><small class="muted">הניצוצות של השבוע · מתחיל מחדש ביום ראשון</small></div>
    <button type="button" class="board-code" title="העתק את קוד ההזמנה"><span class="board-code-t"><small>קוד הזמנה · לחץ להעתקה</small><b dir="ltr"></b></span><span data-ic="copy"></span></button></div></div>`);
  card.querySelector('h3').textContent = g.name;
  card.querySelector('.board-code b').textContent = g.code;
  card.querySelector('.board-code').onclick = () => {
    const text = 'בוא/י להתחרות איתי בניצוצות ב-SumIT: מסלול למידה ← חברים ← הצטרף, עם הקוד ' + g.code;
    try { navigator.clipboard.writeText(text).then(() => toast('הקוד הועתק עם הזמנה קצרה. שלח אותו לחברים.'), () => toast('הקוד: ' + g.code)); } catch { toast('הקוד: ' + g.code); }
  };

  if (!data || b.busy) {
    card.append(h('<div class="board-loading"><span class="spinner"></span><span class="muted">טוען את הטבלה…</span></div>'));
    if (!data && !b.busy) { S.board.busy = true; boardSend({ op: 'list' }); }
  } else if (data.error) {
    const e = h('<p class="muted board-err"></p>'); e.textContent = data.error; card.append(e);
  } else {
    const ms = data.members;
    if (ms.length >= 2) card.append(boardPodium(ms.slice(0, 3)));
    const list = h('<ol class="board-list"></ol>');
    for (const m of ms) {
      const row = h(`<li class="board-row${m.me ? ' me' : ''}"><span class="board-rank"></span><span class="board-who"><b></b><small class="muted"></small></span>
        <span class="board-streak" title="ימים ברצף"></span><span class="board-pts"><b></b>${sparkImg('sparkles', 'board-spark')}</span></li>`);
      row.querySelector('.board-rank').textContent = m.rank;
      row.querySelector('.board-who').before(boardAvatar(m, 36));
      row.querySelector('.board-who b').textContent = m.name + (m.me ? ' (אני)' : '');
      row.querySelector('.board-who small').textContent = 'רמה ' + m.level + ' · ' + boardNum(m.total) + ' בסך הכל';
      const s = row.querySelector('.board-streak');
      if (m.streak > 0) { s.innerHTML = sparkImg('fire', 'board-fire'); s.append(document.createTextNode(m.streak)); } else s.remove();
      row.querySelector('.board-pts b').textContent = boardNum(m.week);
      list.append(row);
    }
    card.append(list);
    if (ms.length < 2) card.append(h('<p class="muted board-alone">עוד אין כאן אף אחד חוץ ממך. העתק את הקוד ושלח אותו לחברים מהקורס.</p>'));
  }
  const foot = h('<div class="board-foot"><small class="muted">חברי הקבוצה רואים את השם, התמונה, הניצוצות, הרמה והרצף שלך. לא את הסיכומים, הקורסים או היומן.</small><button type="button" class="ghost small" data-leave>עזוב את הקבוצה</button></div>');
  foot.querySelector('[data-leave]').onclick = () => {
    if (!confirm('לעזוב את "' + g.name + '"? השורה שלך תימחק מהטבלה. אפשר לחזור עם אותו קוד.')) return;
    S.board.busy = true; renderTrack(); boardSend({ op: 'leave', code: g.code });
  };
  card.append(foot);
  pane.append(card);
}

// The first three, on a podium: second, first, third.
function boardPodium(top) {
  const el = h('<div class="board-podium"></div>');
  const order = [top[1], top[0], top[2]].filter(Boolean);
  for (const m of order) {
    const place = top.indexOf(m) + 1;
    const col = h(`<div class="board-place p${place}${m.me ? ' me' : ''}"><div class="board-place-av"></div><b class="board-place-name"></b><span class="board-place-pts"><b></b>${sparkImg('sparkles', 'board-spark')}</span><div class="board-step"><span></span></div></div>`);
    const av = col.querySelector('.board-place-av');
    av.append(boardAvatar(m, place === 1 ? 64 : 52));
    if (m.rank === 1) av.insertAdjacentHTML('afterbegin', sparkImg('crown', 'board-crown'));
    col.querySelector('.board-place-name').textContent = m.name;
    col.querySelector('.board-place-pts b').textContent = boardNum(m.week);
    col.querySelector('.board-step span').textContent = m.rank;
    el.append(col);
  }
  return el;
}

// Making a group, or joining one with a code.
function boardAddCard(have) {
  const card = h(`<div class="board-add">
    <div class="card pad-lg"><h3>קבוצה חדשה</h3><p class="muted">תקבל קוד של 6 אותיות לשלוח לחברים.</p>
      <div class="row"><input type="text" maxlength="40" placeholder="למשל: חבורת אינפי 2" data-name><button class="primary" data-create>צור קבוצה</button></div></div>
    <div class="card pad-lg"><h3>יש לי קוד</h3><p class="muted">חבר שלח לך קוד? הקלד אותו כאן.</p>
      <div class="row"><input type="text" maxlength="9" placeholder="K7Q2MX" dir="ltr" class="board-code-in" data-code><button class="primary" data-join>הצטרף</button></div></div>
  </div>`);
  const name = card.querySelector('[data-name]'), code = card.querySelector('[data-code]');
  const busy = (on) => card.querySelectorAll('button').forEach(x => { x.disabled = on; });
  card.querySelector('[data-create]').onclick = () => { busy(true); S.boardAdding = false; boardSend({ op: 'create', name: name.value }); };
  card.querySelector('[data-join]').onclick = () => {
    if (!code.value.trim()) { code.focus(); return; }
    busy(true); S.boardAdding = false; boardSend({ op: 'join', code: code.value });
  };
  name.onkeydown = (e) => { if (e.key === 'Enter') card.querySelector('[data-create]').click(); };
  code.onkeydown = (e) => { if (e.key === 'Enter') card.querySelector('[data-join]').click(); };
  if (!have) card.prepend(h(`<div class="card pad-lg board-intro">${sparkImg('trophy', 'board-hero-ic')}<div><h3>מתחרים עם חברים</h3><p class="muted">כל אחד לומד בקצב שלו, והניצוצות של השבוע קובעים מי למעלה. ביום ראשון הטבלה מתחילה מחדש, אז תמיד אפשר לעקוף.</p></div></div>`));
  return card;
}
