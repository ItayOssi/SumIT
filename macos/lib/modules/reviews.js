'use strict';
// Spaced repetition for the flashcards. Each summary's cards keep their schedule in "חזרות.json" next to
// "כרטיסי זיכרון.json" (so it syncs with the course folder in OneDrive). A card is known by a hash of its question, so a card
// that survives a regeneration keeps its schedule. Dates are local calendar days.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Str, Int, readText, writeText, fileExists, dirExists, mkdirp } = require('../util');

const SessionLimit = 30;     // cards in one review
const NewPerSession = 10;    // cards never seen before that may join a review
const MinEase = 1.3, MaxEase = 3.0, StartEase = 2.5;
const Grades = new Set(['again', 'hard', 'good']);

function LocalDate(d) {
  d = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function AddDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return LocalDate(new Date(y, m - 1, d + n));
}

function DaysBetween(from, to) {
  const f = from.split('-').map(Number), t = to.split('-').map(Number);
  return Math.round((new Date(t[0], t[1] - 1, t[2]) - new Date(f[0], f[1] - 1, f[2])) / 86400000);
}

function CardKey(front) {
  return crypto.createHash('sha1').update(String(front || '').trim().replace(/\s+/g, ' ')).digest('hex').substring(0, 12);
}

// A simple SM-2: "good" goes 1, 3, 7 days and then grows by the card's ease; "hard" grows slowly and lowers the ease;
// "again" starts over from tomorrow. prev is undefined for a card never rated.
function NextState(prev, grade, today) {
  const s = { interval: 0, ease: StartEase, reps: 0, lapses: 0 };
  if (prev && typeof prev === 'object') {
    s.interval = Math.max(0, Int(prev, 'interval')); s.reps = Math.max(0, Int(prev, 'reps')); s.lapses = Math.max(0, Int(prev, 'lapses'));
    if (typeof prev.ease === 'number' && prev.ease >= MinEase && prev.ease <= MaxEase) s.ease = prev.ease;
  }
  if (grade === 'again') {
    s.reps = 0; s.interval = 1; s.lapses++; s.ease = Math.max(MinEase, s.ease - 0.2);
  } else if (grade === 'hard') {
    s.reps = Math.max(1, s.reps); s.interval = s.interval < 1 ? 1 : Math.max(s.interval + 1, Math.round(s.interval * 1.2)); s.ease = Math.max(MinEase, s.ease - 0.15);
  } else {
    s.reps++;
    s.interval = s.reps === 1 ? 1 : s.reps === 2 ? 3 : s.reps === 3 ? 7 : Math.max(s.interval + 1, Math.round(s.interval * s.ease));
    s.ease = Math.min(MaxEase, s.ease + 0.05);
  }
  s.ease = Math.round(s.ease * 100) / 100;
  s.due = AddDays(today || LocalDate(), s.interval);
  s.last = today || LocalDate();
  return s;
}

module.exports = {
  methods: {
    ReviewCardKey(front) { return CardKey(front); },
    ReviewNextState(prev, grade, today) { return NextState(prev, grade, today); },
    ReviewToday() { return LocalDate(); },
    ReviewAddDays(date, n) { return AddDays(date, n); },
    ReviewsFile(summaryPath) { return path.join(path.dirname(summaryPath), 'חזרות.json'); },

    LoadReviews(summaryPath) {
      try {
        const f = this.ReviewsFile(summaryPath);
        if (fileExists(f)) {
          const o = JSON.parse(readText(f));
          if (o && typeof o === 'object' && !Array.isArray(o)) return o;
        }
      } catch { }
      return {};
    },

    // Every summary that has cards: { course, num, title, path, cards, state, mtime }.
    ReviewSets() {
      const sets = [];
      const root = this.StudyRoot;
      if (!root || !dirExists(root)) return sets;
      let names = [];
      try { names = fs.readdirSync(root); } catch { return sets; }
      for (const course of names) {
        let rows;
        try {
          if (!fs.statSync(path.join(root, course)).isDirectory()) continue;
          const meta = this.LoadMeta(course);
          rows = Array.isArray(meta.lectures) ? meta.lectures : [];
        } catch { continue; }
        for (const r of rows) {
          const num = Int(r, 'num');
          if (num < 1) continue;
          const page = this.StudyPagePath(course, num);
          const cardsFile = this.FlashcardsFile(page);
          if (!fileExists(cardsFile)) continue;
          try {
            const saved = JSON.parse(readText(cardsFile));
            const cards = (Array.isArray(saved.cards) ? saved.cards : []).filter(c => c && Str(c, 'front') && Str(c, 'back'));
            if (!cards.length) continue;
            sets.push({ course, num, title: Str(r, 'title'), path: page, cards, state: this.LoadReviews(page), mtime: fs.statSync(cardsFile).mtimeMs });
          } catch { }
        }
      }
      return sets;
    },

    // What is waiting: cards whose day has come, cards never seen (a few at a time), per course.
    ReviewSummary(today) {
      today = today || LocalDate();
      let due = 0, fresh = 0, overdueDays = 0;
      const courses = {};
      for (const set of this.ReviewSets()) {
        for (const c of set.cards) {
          const st = set.state[CardKey(c.front)];
          const isDue = st ? Str(st, 'due') <= today && Str(st, 'due') !== '' : false;
          if (isDue) { due++; courses[set.course] = (courses[set.course] || 0) + 1; overdueDays = Math.max(overdueDays, DaysBetween(Str(st, 'due'), today)); }
          else if (!st) fresh++;
        }
      }
      const newCards = Math.min(fresh, NewPerSession);
      return { due, fresh, overdueDays, count: Math.min(SessionLimit, due + newCards), courses };
    },

    // The cards of one review: the most overdue first, then some new ones (newest summaries first).
    ReviewCards(today) {
      today = today || LocalDate();
      const dueList = [], freshList = [];
      for (const set of this.ReviewSets()) {
        for (const c of set.cards) {
          const key = CardKey(c.front), st = set.state[key];
          const item = { key, front: c.front, back: c.back, tag: Str(c, 'tag'), course: set.course, title: set.title, num: set.num, path: set.path };
          if (st) { if (Str(st, 'due') && Str(st, 'due') <= today) dueList.push({ item, due: Str(st, 'due') }); }
          else freshList.push({ item, mtime: set.mtime });
        }
      }
      dueList.sort((a, b) => a.due.localeCompare(b.due));
      freshList.sort((a, b) => b.mtime - a.mtime);
      return dueList.map(x => x.item).concat(freshList.slice(0, NewPerSession).map(x => x.item)).slice(0, SessionLimit);
    },

    SendReviewSummary() {
      const s = this.ReviewSummary();
      this.Send({ type: 'reviewQueue', due: s.due, fresh: s.fresh, overdueDays: s.overdueDays, count: s.count, courses: s.courses });
    },

    StartReview() {
      this.Send({ type: 'reviewSession', cards: this.ReviewCards() });
    },

    RateCard(m) {
      try {
        const grade = Str(m, 'grade'), key = Str(m, 'key');
        if (!Grades.has(grade) || !/^[0-9a-f]{12}$/.test(key)) throw new Error('דירוג לא תקין');
        const page = this.CheckedSummaryPath(m);
        const state = this.LoadReviews(page);
        state[key] = NextState(state[key], grade, LocalDate());
        mkdirp(path.dirname(page));
        writeText(this.ReviewsFile(page), JSON.stringify(state));
        this.SendReviewSummary();
      } catch (ex) {
        this.Toast('לא הצלחתי לשמור את הדירוג: ' + (ex.message || String(ex)), true);
      }
    },
  },
};
