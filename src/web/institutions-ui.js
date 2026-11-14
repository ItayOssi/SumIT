// The institution picker (the wizard's second step and the settings), and everything on screen that names the
// institution. The list and the routing rules are in institutions.js; the logos come from the macOS host
// (inst-logos.js) as data: URLs. Where the host does not answer (Windows), the initials badges stay.

const instLogos = new Map();
const instLogosAsked = new Set();

function instCurrent() {
  const s = S.settings || {};
  return Institutions.resolve({ institute: s.institute, moodleUrl: s.moodleUrl, portalUrl: s.portalUrl });
}
// "HIT" for HIT (as students say it), the Hebrew name for everyone else.
function instShortName(inst = instCurrent()) { return inst.isHit ? 'HIT' : inst.name; }

function instBadge(inst) {
  const b = document.createElement('span');
  b.className = 'inst-badge';
  b.dataset.instLogo = inst.id;
  b.style.background = inst.color || 'var(--accent)';
  b.textContent = Institutions.initials(inst);
  return b;
}
function instLogoEl(inst) {
  const src = instLogos.get(inst.id);
  if (!src) return instBadge(inst);
  const img = document.createElement('img');
  img.src = src; img.alt = ''; img.dataset.instLogo = inst.id;
  img.onerror = () => { instLogos.delete(inst.id); img.replaceWith(instBadge(inst)); };
  return img;
}
function instAskLogos(ids) {
  const need = ids.filter(id => !instLogos.has(id) && !instLogosAsked.has(id));
  if (!need.length) return;
  need.forEach(id => instLogosAsked.add(id));
  send({ type: 'instLogos', ids: need });
}
function instLogoArrived(m) {
  if (!m || !Institutions.byId(m.id) || !/^data:image\/(png|svg\+xml|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon);base64,/.test(m.src || '')) return;
  instLogos.set(m.id, m.src);
  const inst = Institutions.byId(m.id);
  document.querySelectorAll(`[data-inst-logo="${m.id}"]`).forEach(el => el.replaceWith(instLogoEl(inst)));
}

// A search box and the institutions as cards, universities first. onPick(inst) runs on a click.
function instPicker(selected, onPick) {
  const box = h(`<div class="inst-picker">
    <input class="inst-search" type="search" placeholder="חפש את המוסד שלך… (למשל: טכניון, TAU, אפקה)" aria-label="חיפוש מוסד">
    <div class="inst-groups"></div></div>`);
  const input = box.querySelector('input'), groups = box.querySelector('.inst-groups');
  const draw = () => {
    groups.innerHTML = '';
    const list = Institutions.search(input.value);
    for (const [kind, title] of [['uni', 'אוניברסיטאות'], ['college', 'מכללות אקדמיות']]) {
      const items = list.filter(i => i.kind === kind);
      if (!items.length) continue;
      const g = h(`<div class="inst-group"><div class="inst-group-title">${title}</div><div class="inst-grid"></div></div>`);
      for (const inst of items) {
        const card = h(`<button type="button" class="inst-card" data-inst="${inst.id}"><span class="inst-logo"></span><span class="inst-name" dir="auto"></span></button>`);
        card.classList.toggle('on', inst.id === selected);
        card.querySelector('.inst-name').textContent = inst.name;
        card.querySelector('.inst-logo').append(instLogoEl(inst));
        if (!inst.verified) card.append(h('<span class="inst-exp" title="הכתובות נבדקו, אבל עוד אף סטודנט מהמוסד הזה לא דיווח שהכניסה עובדת">ניסיוני</span>'));
        card.onclick = () => {
          selected = inst.id;
          groups.querySelectorAll('.inst-card').forEach(c => c.classList.toggle('on', c.dataset.inst === inst.id));
          onPick(inst);
        };
        g.querySelector('.inst-grid').append(card);
      }
      groups.append(g);
    }
    if (!list.length) groups.append(h('<div class="muted" style="padding:10px 2px">לא מצאתי מוסד בשם הזה. נסה שם אחר, או את השם באנגלית.</div>'));
    instAskLogos(list.map(i => i.id));
  };
  input.oninput = draw;
  draw();
  return box;
}

// The wizard step: pick, and type the Moodle address when the list has none for that institution.
function renderWizardInstitute() {
  const box = $('wizInst'); if (!box) return;
  const inst = instCurrent();
  box.innerHTML = '';
  box.append(instPicker(inst.id, (i) => { send({ type: 'setInstitute', institute: i.id }); S.instPicked = true; }));
  const need = h(`<div class="check-row inst-need" hidden><div class="ci" data-ic="globe"></div><div class="grow"><b>מה הכתובת של ה-Moodle אצלכם?</b>
    <small>עוד אין לי אותה. פתח את ה-Moodle בדפדפן והעתק לכאן את הכתובת מהשורה למעלה.</small>
    <input dir="ltr" class="ltr" placeholder="https://moodle.example.ac.il" style="margin-top:8px"></div><button class="primary">שמור</button></div>`);
  need.hidden = !!inst.moodle;
  need.querySelector('button').onclick = () => send({ type: 'setInstitute', institute: instCurrent().id, moodleUrl: need.querySelector('input').value });
  box.append(need);
  if (typeof icons === 'function') icons(box);
}

// The settings card: the institution, a button to change it, and the advanced addresses.
function renderInstCard() {
  const card = $('instCard'); if (!card) return;
  const inst = instCurrent(), s = S.settings || {};
  const logo = $('instCardLogo'); logo.innerHTML = ''; logo.append(instLogoEl(inst)); instAskLogos([inst.id]);
  $('instCardName').textContent = inst.name;
  const sub = $('instCardSub'); sub.textContent = '';
  if (inst.moodle) {
    const addr = document.createElement('bdi'); addr.dir = 'ltr'; addr.textContent = inst.moodle.replace(/^https:\/\//, '');
    sub.append('ה-Moodle: ', addr, inst.verified ? '' : ' · ניסיוני');
  } else sub.textContent = 'עוד לא הוגדרה כתובת Moodle. הוסף אותה למטה, ב"כתובות".';
  const mu = $('instMoodleUrl'), pu = $('instPortalUrl');
  if (document.activeElement !== mu) { mu.value = s.moodleUrl || ''; mu.placeholder = (Institutions.byId(inst.id) || {}).moodle || 'https://moodle.example.ac.il'; }
  if (document.activeElement !== pu) { pu.value = s.portalUrl || ''; pu.placeholder = (Institutions.byId(inst.id) || {}).portal || ''; }
  if (!inst.moodle) $('instAdv').open = true;
}

function openInstDialog() {
  let dlg = $('instDlg');
  if (!dlg) {
    dlg = h(`<dialog id="instDlg" class="inst-dlg"><div class="inst-dlg-head"><h2>באיזה מוסד אתה לומד?</h2><button class="ghost" data-x aria-label="סגור">✕</button></div>
      <p class="muted">רשימת הקורסים תיטען מחדש מה-Moodle של המוסד שתבחר. הקבצים והסיכומים שכבר במחשב לא ייגעו.</p><div data-p></div></dialog>`);
    document.body.append(dlg);
    dlg.querySelector('[data-x]').onclick = () => dlg.close();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }
  const host = dlg.querySelector('[data-p]'); host.innerHTML = '';
  host.append(instPicker(instCurrent().id, (i) => {
    if (i.id === instCurrent().id) { dlg.close(); return; }
    send({ type: 'setInstitute', institute: i.id });
    S.courses = null;
    toast('עברת ל' + i.name + (i.moodle ? '. בכניסה הבאה ל-Moodle תתבקש להתחבר מחדש.' : '. עכשיו הוסף את כתובת ה-Moodle בהגדרות.'), { ms: 6000 });
    dlg.close();
  }));
  dlg.showModal();
  const q = dlg.querySelector('.inst-search'); if (q) q.focus();
}

// Everything that names the institution or depends on it, after every settings message.
function applyInstitute() {
  const inst = instCurrent();
  document.body.classList.toggle('inst-hit', inst.isHit);
  document.querySelectorAll('[data-inst-name]').forEach(e => { e.textContent = instShortName(inst); });
  document.querySelectorAll('[data-site-link="portal"] .nav-text, [data-site="portal"]').forEach(e => { e.textContent = inst.portalName; });
  renderInstCard();
  if (!$('wizard').hidden && typeof wizStep !== 'undefined' && wizStep === WIZ_INST) {
    const need = document.querySelector('#wizInst .inst-need');
    if (need) need.hidden = !!inst.moodle;
  }
}

(function wireInstitute() {
  const btn = $('instChange'); if (btn) btn.onclick = openInstDialog;
  const save = $('instSaveUrls');
  if (save) save.onclick = () => send({ type: 'setInstitute', institute: instCurrent().id, moodleUrl: $('instMoodleUrl').value, portalUrl: $('instPortalUrl').value });
  const reset = $('instResetUrls');
  if (reset) reset.onclick = () => { $('instMoodleUrl').value = ''; $('instPortalUrl').value = ''; send({ type: 'setInstitute', institute: instCurrent().id }); };
})();
