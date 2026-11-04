// "What to do in this block?" (macOS host: block-plan.js). Under "what to do today" it lists the blocks of the student's calendars that
// have not ended yet, and a button on each one gives a small plan that fills exactly that block: a warm-up from memory, learning and
// practice, a break in a long block, a recap. The list stays hidden until the host answers, so it is not shown on Windows.
const BLOCK_KINDS = { recall: 'שליפה מהזיכרון', learn: 'למידה', practice: 'תרגול', review: 'סיכום', break: 'הפסקה', plan: 'תכנון' };
S.blockOk = false;
S.blockPlans = {};      // "uid|start|minutes" -> the answer of the host, so that opening a block again does not ask again
let blockRun = null;    // { requestId, show } while the dialog is open

function askBlocks() { send({ type: 'blockPing' }); }

function blockEvent(m) {
  if (m.type === 'blockReady') { S.blockOk = true; renderBlocks(); return; }
  if (m.type === 'blockResult' && blockRun && m.requestId === blockRun.requestId) blockRun.show(m);
}

const blockTime = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

// The blocks of today that have not ended, in order. A short meeting (under 15 minutes) is not a block to study in.
function todayBlocks() {
  const now = Date.now(), end = new Date(); end.setHours(24, 0, 0, 0);
  return (S.calOcc || []).filter(o => !o.allDay && o.busy && o.title && o.end > now && o.start < end.getTime() && o.end - o.start >= 15 * 60000).slice(0, 8);
}

// The course of the student that the block is about, when its name is in the title of the block (or the other way round).
function blockCourse(title) {
  const t = String(title || '').toLowerCase();
  const hit = (S.courses || []).map(c => c.name).find(n => { const x = String(n || '').toLowerCase(); return x.length >= 3 && (t.includes(x) || x.includes(t)); });
  return hit || '';
}

function renderBlocks() {
  const box = $('todayBlocks'); if (!box) return;
  const list = S.blockOk ? todayBlocks() : [];
  box.hidden = !list.length;
  box.innerHTML = '';
  if (!list.length) return;
  box.append(h('<div class="muted today-note block-head">הבלוקים שלך ביומן היום. לא יודע מה לעשות באחד מהם?</div>'));
  for (const o of list) {
    const row = h('<div class="today-row"><span dir="ltr" class="chip"></span><div class="grow"><b dir="auto"></b><small class="muted" dir="auto"></small></div><button class="soft small" data-plan><span data-ic="sparkles"></span>מה לעשות בבלוק?</button></div>');
    row.querySelector('.chip').textContent = blockTime(o.start) + '–' + blockTime(o.end);
    row.querySelector('b').textContent = o.title;
    row.querySelector('small').textContent = [o.calendar, minLabel(Math.round((o.end - o.start) / 60000))].filter(Boolean).join(' · ');
    row.querySelector('[data-plan]').onclick = () => openBlock(o);
    box.append(row);
  }
  icons(box);
}

function openBlock(o) {
  if (blockRun) return;
  // A block that has already started is planned from now to its end.
  const from = Math.max(Date.now(), o.start), minutes = Math.max(10, Math.round((o.end - from) / 60000));
  const key = (o.uid || o.title) + '|' + o.start + '|' + minutes;
  const dialog = h(`<dialog class="summary-options coach-dialog" dir="rtl" aria-labelledby="blockTitle">
    <div class="row"><h2 id="blockTitle" class="grow"></h2><button class="ghost small" data-close aria-label="סגור">×</button></div>
    <div data-busy><div class="coach-busy"><span data-ic="spin"></span><b>בונה תוכנית לבלוק...</b></div><div class="skeleton" style="height:56px;border-radius:14px;margin:10px 0"></div><div class="skeleton" style="height:56px;border-radius:14px;margin:10px 0"></div></div>
    <div data-result hidden><p class="muted" data-source></p><div data-steps></div><div class="row wrap coach-actions"><button class="primary" data-start><span data-ic="clock"></span>התחל סבב ריכוז</button><button class="soft" data-again><span data-ic="refresh"></span>תוכנית אחרת</button><div class="grow"></div><button class="ghost" data-close>סגור</button></div></div>
  </dialog>`);
  dialog.querySelector('#blockTitle').textContent = o.title + ' · ' + blockTime(from) + '–' + blockTime(o.end);
  document.body.append(dialog);
  const $d = (s) => dialog.querySelector(s);
  const view = (name) => { $d('[data-busy]').hidden = name !== 'busy'; $d('[data-result]').hidden = name !== 'result'; };
  icons(dialog);

  let steps = [];
  const run = {
    requestId: '',
    show(m) {
      if (m.error) { dialog.close(); toast(m.text || 'לא הצלחתי לבנות תוכנית', { error: true }); return; }
      S.blockPlans[key] = m;
      steps = m.steps || [];
      $d('[data-source]').textContent = m.source === 'ai' ? 'התוכנית נבנתה לפי שם הבלוק' + (blockCourse(o.title) ? ' והחומר של הקורס שלך.' : '.') : 'התוכנית נבנתה לפי כללים, כי אין AI מחובר או שהוא לא ענה.';
      const box = $d('[data-steps]'); box.innerHTML = '';
      let t = from;
      steps.forEach((s, i) => {
        const row = h(`<div class="coach-step" style="--i:${i}"><div class="grow"><b dir="auto"></b><small class="muted" dir="auto"></small></div><span class="chip" dir="ltr"></span></div>`);
        row.querySelector('b').textContent = s.title;
        row.querySelector('small').textContent = [BLOCK_KINDS[s.kind], s.minutes + ' דק׳', s.why].filter(Boolean).join(' · ');
        row.querySelector('.chip').textContent = blockTime(t) + '–' + blockTime(t + s.minutes * 60000);
        if (i === 0) row.querySelector('.chip').classList.add('accent');
        t += s.minutes * 60000;
        box.append(row);
      });
      $d('[data-start]').disabled = !steps.length;
      view('result'); icons(dialog);
    },
  };
  blockRun = run;

  const ask = () => {
    view('busy');
    run.requestId = 'block-' + Date.now();
    send({ type: 'blockPlan', requestId: run.requestId, title: o.title, minutes, course: blockCourse(o.title) });
  };
  dialog.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dialog.close(); });
  dialog.addEventListener('close', () => { dialog.remove(); blockRun = null; });
  $d('[data-again]').onclick = () => { delete S.blockPlans[key]; ask(); };
  $d('[data-start]').onclick = () => { if (steps.length && typeof startPomodoroFor === 'function') startPomodoroFor(steps[0].title); dialog.close(); };
  dialog.showModal();
  if (S.blockPlans[key]) run.show(S.blockPlans[key]); else ask();
}
