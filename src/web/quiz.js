// The quiz for the summary on screen, in the same column as the flashcards (the "בוחן" tab). The host writes it in three
// passes and keeps it next to the summary (macos/lib/modules/quiz.js); every answer is checked here, by quiz-core.js.
// Before checking, the student can say how sure they are: a mistake made while sure is the one worth stopping on.
const quizSets = new Map();   // summary path -> { questions, attempts, order, i, results, picked, sure, checked, ended, retry }
let quizJob = null;           // { requestId, path, step, steps, text }
let practiceMode = 'cards';

const QZ_KIND = { mcq: 'אמריקאי', tf: 'נכון או לא נכון', cloze: 'השלמה' };
const QZ_LETTER = ['א', 'ב', 'ג', 'ד', 'ה'];

function quizSet() { return S.viewer ? quizSets.get(S.viewer.path) : null; }

// The column opens on the tab that was used last.
function practiceOpen(regenerate) { practiceMode === 'quiz' ? openQuiz(regenerate) : openFlashcards(regenerate); }
function practiceTab(mode) {
  practiceMode = mode;
  $('modeCards').setAttribute('aria-selected', mode === 'cards');
  $('modeQuiz').setAttribute('aria-selected', mode === 'quiz');
  $('cardsPane').hidden = mode !== 'cards';
  $('quizPane').hidden = mode !== 'quiz';
}

function openQuiz(regenerate) {
  if (!S.viewer || !S.course) return;
  $('summaryChat').hidden = true;
  $('flashcards').hidden = false;
  practiceTab('quiz');
  const path = S.viewer.path;
  if (quizJob && quizJob.path !== path) $('quizPane').dataset.error = 'מכין עכשיו בוחן לסיכום אחר. נסה שוב בעוד רגע.';
  else if ((!quizSets.has(path) || regenerate) && !quizJob) {
    const requestId = 'quiz-' + Date.now();
    quizJob = { requestId, path, step: 0, steps: 3, text: 'מתחיל…' };
    $('quizPane').dataset.error = '';
    send({ type: 'quiz', requestId, course: S.course.name, path, title: S.viewer.title || '', regenerate: !!regenerate });
  }
  renderQuiz();
  requestAnimationFrame(() => placeSite(false));
}

function startRound(set, order, retry) {
  Object.assign(set, { order, i: 0, results: [], picked: null, sure: '', checked: false, ended: false, retry: !!retry });
}

function quizEvent(m) {
  if (!quizJob || m.requestId !== quizJob.requestId) return;
  if (m.type === 'quizProgress') { Object.assign(quizJob, { step: m.step, steps: m.steps, text: m.text }); renderQuiz(); return; }
  const path = quizJob.path; quizJob = null;
  $('quizPane').dataset.error = m.error ? m.text : '';
  if (!m.error) {
    const set = { questions: m.questions, attempts: m.attempts || [] };
    startRound(set, m.questions.map((_, i) => i));
    quizSets.set(path, set);
  } else if (S.viewer?.path !== path || $('flashcards').hidden) toast(m.text, { error: true });
  renderQuiz();
}

function renderQuiz() {
  if (!S.viewer || $('flashcards').hidden || practiceMode !== 'quiz') return;
  const set = quizSet(), busy = quizJob?.path === S.viewer.path, err = $('quizPane').dataset.error || '';
  $('quizProgress').hidden = !busy;
  if (busy) {
    $('quizStep').textContent = `שלב ${Math.max(1, quizJob.step)} מתוך ${quizJob.steps}: ${quizJob.text}`;
    $('quizBar').style.width = Math.round((Math.max(1, quizJob.step) - 0.5) / quizJob.steps * 100) + '%';
  }
  $('quizError').hidden = busy || !err;
  $('quizError').textContent = err;
  $('cardsRedo').disabled = practiceMode === 'quiz' ? !!quizJob : !!cardsJob;
  const show = !busy && set && set.questions.length;
  $('quizDots').hidden = $('quizCard').hidden = !show || set.ended;
  $('quizEnd').hidden = !show || !set.ended;
  if (!show) return;
  if (set.ended) { renderQuizEnd(set); return; }

  $('quizDots').innerHTML = set.order.map((qi, k) => {
    const r = set.results[qi];
    return `<i class="${k === set.i ? 'now' : r ? (r.correct ? 'right' : 'wrong') : ''}"></i>`;
  }).join('');

  const qi = set.order[set.i], q = set.questions[qi], r = set.results[qi];
  const checked = set.checked, card = $('quizCard');
  let text = md(q.q);
  if (q.type === 'cloze') text = text.replace('____', `<span class="qz-blank">${checked ? esc(q.answer) : '?'}</span>`);
  let body = '';
  if (q.type === 'mcq') {
    body = '<div class="qz-opts">' + q.options.map((o, k) => {
      let cls = '';
      if (checked) cls = k === q.answer ? 'right' : k === set.picked ? 'wrong' : 'dim';
      else if (k === set.picked) cls = 'picked';
      const why = checked && (k === q.answer || k === set.picked) && q.why[k] ? `<span class="qz-why">${md(q.why[k])}</span>` : '';
      return `<button class="qz-opt ${cls}" data-k="${k}" ${checked ? 'disabled' : ''}><span class="qz-letter">${QZ_LETTER[k]}</span><span class="qz-body">${md(o)}${why}</span></button>`;
    }).join('') + '</div>';
  } else if (q.type === 'tf') {
    body = '<div class="qz-opts qz-tf">' + [[true, 'נכון'], [false, 'לא נכון']].map(([v, label]) => {
      let cls = '';
      if (checked) cls = v === q.answer ? 'right' : v === set.picked ? 'wrong' : 'dim';
      else if (v === set.picked) cls = 'picked';
      return `<button class="qz-opt ${cls}" data-v="${v}" ${checked ? 'disabled' : ''}>${label}</button>`;
    }).join('') + '</div>';
  } else {
    body = `<div class="qz-cloze"><input id="quizInput" dir="auto" autocomplete="off" spellcheck="false" placeholder="מה חסר?" aria-label="ההשלמה שלך" ${checked ? 'disabled' : ''} class="${checked ? (r.correct ? 'right' : 'wrong') : ''}"></div>`;
  }
  const sure = checked ? '' : `<div class="qz-sure" role="group" aria-label="כמה אתה בטוח"><span>כמה אתה בטוח?</span>${[['sure', 'בטוח'], ['think', 'חושב שכן'], ['guess', 'מנחש']]
    .map(([v, l]) => `<button data-sure="${v}" aria-pressed="${set.sure === v}">${l}</button>`).join('')}</div>`;
  let feedback = '';
  if (checked) {
    const why = q.type === 'mcq' ? '' : q.why;
    const yours = q.type === 'cloze' && !r.correct ? `<div>כתבת: <b style="display:inline">${esc(r.typed || '')}</b> · התשובה: <b style="display:inline">${esc(q.answer)}</b></div>` : '';
    const alarm = !r.correct && set.sure === 'sure' ? '<span class="qz-alarm">טעית כשהיית בטוח. זו הטעות שהכי שווה לעצור עליה רגע.</span>' : '';
    feedback = `<div class="qz-feedback ${r.correct ? 'right' : 'wrong'}"><b>${r.correct ? emo('✨') + ' נכון!' : emo('💡') + ' לא נכון, וזה מה שחשוב לזכור'}</b>${yours}${why ? md(why) : ''}${alarm}</div>`;
  }
  const last = set.i === set.order.length - 1;
  const action = checked
    ? `<button class="primary small" id="quizNext">${last ? 'לתוצאות' : 'לשאלה הבאה'}</button>`
    : `<button class="primary small" id="quizCheck" ${set.picked === null ? 'disabled' : ''}>בדוק</button><small class="muted grow">${q.type === 'mcq' ? 'מקשים 1-' + q.options.length + ', ואז Enter' : 'Enter לבדיקה'}</small>`;
  card.innerHTML = `<div class="qz-head"><span class="qz-kind">${QZ_KIND[q.type]}</span>${q.tag ? `<span class="qz-tag">${esc(q.tag)}</span>` : ''}<span class="grow"></span><span>שאלה ${set.i + 1} מתוך ${set.order.length}</span></div>
    <div class="qz-q">${text}</div>${body}${sure}${feedback}<div class="qz-actions">${action}</div>`;

  const input = card.querySelector('#quizInput');
  if (input) {
    if (checked) input.value = r.typed || '';
    else { input.value = set.picked || ''; input.oninput = () => { set.picked = input.value.trim() ? input.value : null; card.querySelector('#quizCheck').disabled = set.picked === null; }; }
  }
  card.querySelectorAll('.qz-opt:not([disabled])').forEach(b => b.onclick = () => {
    set.picked = b.dataset.k !== undefined ? Number(b.dataset.k) : b.dataset.v === 'true';
    renderQuiz();
  });
  card.querySelectorAll('[data-sure]').forEach(b => b.onclick = () => { set.sure = set.sure === b.dataset.sure ? '' : b.dataset.sure; renderQuiz(); });
  const check = card.querySelector('#quizCheck'); if (check) check.onclick = () => checkQuiz(set);
  const next = card.querySelector('#quizNext'); if (next) { next.onclick = () => nextQuiz(set); next.focus({ preventScroll: true }); }
  if (input && !checked) input.focus({ preventScroll: true });
}

function checkQuiz(set) {
  if (set.checked || set.picked === null) return;
  const qi = set.order[set.i], q = set.questions[qi];
  const correct = QuizCore.isCorrect(q, set.picked);
  set.results[qi] = { correct, sure: set.sure === 'sure', typed: q.type === 'cloze' ? set.picked : undefined };
  set.checked = true;
  renderQuiz();
}

function nextQuiz(set) {
  if (set.i < set.order.length - 1) { Object.assign(set, { i: set.i + 1, picked: null, sure: '', checked: false }); renderQuiz(); return; }
  set.ended = true;
  if (!set.retry && S.course && S.viewer) {
    const s = QuizCore.score(set.questions, set.results);
    send({ type: 'quizAttempt', course: S.course.name, path: S.viewer.path, right: s.right, total: s.total });
    set.prevAttempt = (set.attempts || []).slice(-1)[0] || null;
    set.attempts = (set.attempts || []).concat([{ date: '', right: s.right, total: s.total }]);
  }
  renderQuiz();
}

function renderQuizEnd(set) {
  const qs = set.order.map(i => set.questions[i]), rs = set.order.map(i => set.results[i]);
  const s = QuizCore.score(qs, rs);
  const verdict = s.percent >= 85 ? 'שולט בחומר. חזור על הבוחן בעוד כמה ימים כדי שזה יישאר.'
    : s.percent >= 60 ? 'בכיוון. שווה לעבור שוב על מה שטעית, ואז לנסות שוב.'
    : 'זה בדיוק הזמן לחזור לסיכום, לנושאים שלמטה, ולנסות שוב.';
  const weak = s.weak.length ? `<div class="qz-weak"><b>כדאי לחזור על:</b> ${s.weak.map(t => `<span class="qz-tag">${esc(t)}</span>`).join('')}</div>` : '';
  const sure = s.confidentWrong ? `<div class="qz-weak">${emo('⚠️')} ${s.confidentWrong === 1 ? 'טעות אחת' : s.confidentWrong + ' טעויות'} כשהיית בטוח. אלה הנקודות שהכי כדאי לבדוק בסיכום.</div>` : '';
  const prior = set.prevAttempt;
  const prev = !set.retry && prior ? `<div class="qz-prev">בפעם הקודמת ${prior.date ? '(' + esc(prior.date) + ')' : ''}: ${prior.right} מתוך ${prior.total}</div>` : '';
  const wrong = set.order.filter(i => set.results[i] && !set.results[i].correct);
  const medal = emo(s.percent >= 85 ? '🎉' : s.percent >= 60 ? '✨' : '💡', true);
  $('quizEnd').innerHTML = `<div class="qz-medal">${medal}</div><div class="qz-ring" style="--p:${s.percent}"><div class="qz-score" dir="ltr">${s.right}<small> / ${s.total}</small></div></div>
    <b>${set.retry ? 'סבב תיקון: ' : ''}${verdict}</b>${weak}${sure}${prev}
    <div class="qz-end-actions">${wrong.length ? `<button class="primary small" id="quizRetryWrong">תרגל שוב את ${wrong.length === 1 ? 'השאלה שטעית בה' : wrong.length + ' השאלות שטעית בהן'}</button>` : ''}
    <button class="soft small" id="quizRestart">מההתחלה</button><button class="soft small" id="quizFresh">בוחן חדש מהסיכום</button></div>`;
  const rw = $('quizEnd').querySelector('#quizRetryWrong'); if (rw) rw.onclick = () => { startRound(set, wrong, true); renderQuiz(); };
  $('quizEnd').querySelector('#quizRestart').onclick = () => { startRound(set, set.questions.map((_, i) => i)); renderQuiz(); };
  $('quizEnd').querySelector('#quizFresh').onclick = () => openQuiz(true);
}

$('modeCards').onclick = () => { practiceTab('cards'); openFlashcards(false); };
$('modeQuiz').onclick = () => openQuiz(false);
$('quizPane').addEventListener('keydown', (e) => {
  const set = quizSet(); if (!set || set.ended || $('quizCard').hidden) return;
  const q = set.questions[set.order[set.i]];
  if (e.key === 'Enter') { e.preventDefault(); set.checked ? nextQuiz(set) : checkQuiz(set); return; }
  if (e.target.tagName === 'INPUT' || set.checked) return;
  const n = Number(e.key);
  if (q.type === 'mcq' && n >= 1 && n <= q.options.length) { set.picked = n - 1; renderQuiz(); $('quizCard').querySelector('.qz-opt.picked')?.focus(); }
});
