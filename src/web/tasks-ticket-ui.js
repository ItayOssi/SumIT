// The tasks ticket in the sidebar (the list itself is tasks-ticket.js). It stays visible on every screen: how many things are due
// and the nearest one, and a click shows all of them. On macOS the host also reminds the day before; the page only sends it the
// items once the host has answered, so Windows gets nothing.
const TICKET_SOURCE = { mine: 'שלי', moodle: 'Moodle', homework: 'תרגיל בית', syllabus: 'מהסילבוס (AI)' };
let ticketSent = '';

function ticketList() {
  return TasksTicket.items({ tasks: S.tasks, events: S.events, courses: thisSemester(S.courses || []), today: TasksTicket.localDate(new Date()) });
}

function ticketEvent(m) {
  if (m.type === 'ticketReady') { S.ticketOk = true; ticketSent = ''; ticketRender(); return; }
  if (m.type === 'ticketOpen') ticketOpen();
}

function ticketRender() {
  const el = $('taskTicket'); if (!el) return;
  const list = ticketList(), s = TasksTicket.summary(list);
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = '<button class="theme-toggle ticket-btn"><span class="ticket-ic" data-ic="bell"></span><span class="ticket-text nav-text"><b></b><small dir="auto"></small></span><span class="ticket-count"></span></button>';
    icons(el);
    el.querySelector('button').onclick = ticketOpen;
  }
  el.dataset.level = s.level;
  el.querySelector('.ticket-count').textContent = s.count;
  el.querySelector('.ticket-count').hidden = !s.count;
  el.querySelector('b').textContent = s.count ? (s.count === 1 ? 'מטלה אחת פתוחה' : s.count + ' מטלות פתוחות') : 'אין מטלות פתוחות';
  el.querySelector('small').textContent = s.next ? (s.next.date ? TasksTicket.when(s.next) + ': ' : '') + s.next.title + (s.next.course ? ' · ' + s.next.course : '') : 'הכל בשליטה';
  el.querySelector('button').title = el.querySelector('button').ariaLabel = el.querySelector('b').textContent + (s.next ? '. הקרובה: ' + el.querySelector('small').textContent : '');
  if (S.ticketOk) {
    const r = JSON.stringify(TasksTicket.reminders(list));
    if (r !== ticketSent) { ticketSent = r; send({ type: 'ticketReminders', items: JSON.parse(r) }); }
  }
  ticketListRender();
}

function ticketOpen() {
  if ($('ticketDlg')) return;
  const dialog = h(`<dialog class="summary-options ticket-dlg" id="ticketDlg" dir="rtl" aria-labelledby="ticketTitle">
    <div class="row"><h2 id="ticketTitle" class="grow">מה מחכה לי</h2><button class="ghost small" data-close aria-label="סגור">×</button></div>
    <form class="ticket-add"><input data-title placeholder="להוסיף מטלה? למשל: להגיש תרגיל 3" maxlength="200" autocomplete="off"><input type="date" data-due class="ltr" aria-label="עד תאריך"><button class="primary" type="submit"><span data-ic="plus"></span>הוסף</button></form>
    <div class="ticket-list"></div>
    <div class="row"><button class="ghost small" data-all>לכל המטלות שלי</button></div>
  </dialog>`);
  document.body.append(dialog);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
    else if (e.target.closest('[data-all]')) { dialog.close(); show('tasks'); }
  });
  dialog.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    const t = dialog.querySelector('[data-title]'), title = t.value.trim(); if (!title) return t.focus();
    S.tasks.push({ id: String(Date.now()) + Math.random().toString(36).slice(2, 6), title, course: '', due: dialog.querySelector('[data-due]').value, done: false });
    t.value = ''; dialog.querySelector('[data-due]').value = '';
    saveTasks();
  };
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  ticketListRender();
}

function ticketListRender() {
  const box = document.querySelector('#ticketDlg .ticket-list'); if (!box) return;
  const list = ticketList();
  box.innerHTML = '';
  if (!list.length) { box.append(h('<div class="empty" style="border:none;padding:16px"><b>הכל בשליטה</b>אין מטלות פתוחות.</div>')); return; }
  for (const [g, title] of TasksTicket.GROUPS) {
    const rows = list.filter(i => i.group === g); if (!rows.length) continue;
    const sec = h(`<div class="ticket-group" data-g="${g}"><h3>${title}<span class="chip">${rows.length}</span></h3></div>`);
    rows.forEach(i => sec.append(ticketRow(i)));
    box.append(sec);
  }
}

function ticketRow(it) {
  const el = h(`<div class="task ticket-row" data-src="${it.source}">${it.source === 'mine' ? '<label class="task-check"><input type="checkbox"><span class="box"></span></label>' : ''}
    <div class="grow"><b dir="auto"></b><small class="muted" dir="auto"></small></div>
    <span class="chip${it.overdue || it.days === 0 ? ' bad' : it.days != null && it.days <= 3 ? ' warn' : ''}">${esc(TasksTicket.when(it))}</span></div>`);
  el.querySelector('b').textContent = it.title + (it.exam && it.source !== 'mine' ? ' 📝' : '');
  el.querySelector('small').textContent = [TICKET_SOURCE[it.source], it.course, it.date ? it.date.split('-').reverse().join('/') : ''].filter(Boolean).join(' · ');
  if (it.source === 'mine') {
    el.querySelector('input').onchange = () => { const t = S.tasks.find(x => x.id === it.taskId); if (t) { t.done = true; saveTasks(); toast('סומן כבוצע'); } };
  } else if (it.source === 'syllabus') {
    const b = h('<button class="small soft" title="להוסיף למטלות שלי, כדי לסמן כשסיימת"><span data-ic="plus"></span>הוסף למטלות שלי</button>');
    b.onclick = () => { S.tasks.push({ id: it.id, title: it.title, course: it.course, due: it.date, done: false }); saveTasks(); toast('נוסף למטלות שלי'); };
    el.append(b);
  }
  const open = () => {
    const d = $('ticketDlg');
    if (it.source === 'moodle') { if (d) d.close(); openSite('moodle', it.url); }
    else if (it.source === 'homework' || it.source === 'syllabus') { const c = (S.courses || []).find(x => x.id === it.courseId || x.name === it.course); if (c) { if (d) d.close(); openCourse(c); } }
  };
  if (it.source !== 'mine') { el.classList.add('clickable'); el.querySelector('.grow').onclick = open; }
  return el;
}
