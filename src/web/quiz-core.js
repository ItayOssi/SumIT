// The quiz next to a summary: pure functions (no DOM), shared by the host (macos/lib/modules/quiz.js) and the page (quiz.js),
// so they can be tested in Node. Three kinds of question, all checked on the computer with no AI call:
//   mcq   { q, options: [3..5], answer: index, why: [one per option], tag }
//   tf    { q (a statement), answer: true|false, why, tag }
//   cloze { q with ____ for the blank, answer, accept: [other ways to write it], why, tag }
(function (root) {
  const MAX = 12;
  const BLANK = /_{3,}/;
  const cut = (s, n) => { s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  // A stable 32-bit hash, so the shuffle of the options is the same every time a cached quiz opens.
  function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function shuffled(n, seed) {
    const order = Array.from({ length: n }, (_, i) => i);
    let x = seed || 1;
    for (let i = n - 1; i > 0; i--) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; const j = x % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    return order;
  }

  function truth(v) {
    if (v === true || v === false) return v;
    const s = String(v == null ? '' : v).trim().toLowerCase();
    if (['true', 'נכון', 'yes', 'כן'].includes(s)) return true;
    if (['false', 'לא נכון', 'no', 'לא'].includes(s)) return false;
    return null;
  }

  // One question from the model, cleaned, or null when it can't be checked reliably.
  function clean(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const type = String(raw.type || '').toLowerCase(), q = cut(raw.q, 600), tag = cut(raw.tag, 40);
    if (!q) return null;
    if (type === 'mcq') {
      const options = Array.isArray(raw.options) ? raw.options.map(o => cut(o, 300)) : [];
      const answer = Number(raw.answer);
      if (options.length < 3 || options.length > 5 || options.some(o => !o) || new Set(options).size !== options.length) return null;
      if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
      const why = options.map((_, i) => cut(Array.isArray(raw.why) ? raw.why[i] : '', 500));
      // The model tends to put the right answer in the same place, so the options are shuffled (the same way every time).
      const order = shuffled(options.length, hash(q));
      return { type, q, options: order.map(i => options[i]), why: order.map(i => why[i]), answer: order.indexOf(answer), tag };
    }
    if (type === 'tf') {
      const answer = truth(raw.answer);
      if (answer === null) return null;
      return { type, q, answer, why: cut(raw.why, 600), tag };
    }
    if (type === 'cloze') {
      const answer = cut(raw.answer, 120);
      if (!answer || !BLANK.test(q)) return null;
      const accept = (Array.isArray(raw.accept) ? raw.accept : []).map(a => cut(a, 120)).filter(Boolean).slice(0, 6);
      return { type, q: q.replace(/_{3,}/, '____'), answer, accept, why: cut(raw.why, 600), tag };
    }
    return null;
  }

  // The first JSON array in a model answer, as clean questions (at most 12).
  function fromAnswer(answer) {
    const text = String(answer || ''), a = text.indexOf('['), b = text.lastIndexOf(']');
    if (a < 0 || b <= a) return [];
    let list;
    try { list = JSON.parse(text.substring(a, b + 1)); } catch { return []; }
    if (!Array.isArray(list)) return [];
    const seen = new Set(), out = [];
    for (const raw of list) {
      const c = clean(raw);
      if (!c || seen.has(c.q)) continue;
      seen.add(c.q); out.push(c);
      if (out.length === MAX) break;
    }
    return out;
  }

  // A typed answer, compared without case, spaces, punctuation, niqqud, LaTeX dollars or a leading Hebrew ה/ו/ב/ל/מ/ש.
  function normalize(s) {
    return String(s == null ? '' : s).normalize('NFKC').toLowerCase()
      .replace(/[֑-ׇ]/g, '').replace(/\$/g, '').replace(/\\(left|right|,|;|!)/g, '')
      .replace(/[\s"'`׳״.,;:!?()[\]{}\-–—]/g, '');
  }
  function stripPrefix(s) { return s.length > 2 ? s.replace(/^[הובלמש]/, '') : s; }
  function clozeCorrect(question, typed) {
    const t = normalize(typed);
    if (!t) return false;
    return [question.answer].concat(question.accept || []).some(a => { const n = normalize(a); return n && (n === t || stripPrefix(n) === stripPrefix(t)); });
  }

  // Is this response right? mcq: the index; tf: true/false; cloze: the typed text.
  function isCorrect(question, response) {
    if (!question) return false;
    if (question.type === 'mcq') return Number(response) === question.answer;
    if (question.type === 'tf') return response === question.answer;
    if (question.type === 'cloze') return clozeCorrect(question, response);
    return false;
  }

  // The end of a quiz: the score, and the topics with the most mistakes (worst first).
  // results: [{ correct, sure }] in question order; sure = the student said "בטוח" before checking.
  function score(questions, results) {
    const done = results.filter(Boolean);
    const right = done.filter(r => r.correct).length;
    const byTag = {};
    questions.forEach((q, i) => {
      const r = results[i]; if (!r || r.correct || !q.tag) return;
      byTag[q.tag] = (byTag[q.tag] || 0) + 1;
    });
    const weak = Object.keys(byTag).sort((a, b) => byTag[b] - byTag[a]).slice(0, 3);
    const confidentWrong = results.reduce((n, r) => n + (r && !r.correct && r.sure ? 1 : 0), 0);
    return { right, total: questions.length, answered: done.length, percent: questions.length ? Math.round(right / questions.length * 100) : 0, weak, confidentWrong };
  }

  const api = { MAX, clean, fromAnswer, normalize, clozeCorrect, isCorrect, score, hash };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QuizCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
