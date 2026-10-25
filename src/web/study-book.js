// A study page as a small book: the pages are listed on the right (overview, summary, homework); the homework is grouped by question,
// questions that are not for this lecture are set apart, and a "not yet" note lives only on the homework page.
(function () {
  var NAMES = { over: 'סקירה', sum: 'הסיכום', hw: 'שיעורי בית' };
  var ICONS = { over: '🎯', sum: '📖', hw: '✏️' };
  var LONG = { over: 'סקירה: מה חובה לדעת', sum: 'הסיכום', hw: 'שיעורי בית' };

  function kindOf(h) {
    var id = h.id || '', t = h.textContent || '';
    if (/^use/.test(id) || /שיעורי בית|שימוש בתרגילים|תרגילים|פתרונות/.test(t)) return 'hw';
    if (/^(must|cheat)$/.test(id) || /חובה|לדלג|קבועים|יחידות/.test(t)) return 'over';
    return 'sum';
  }
  function isNotYet(el) {
    if (!el.classList) return false;
    if (el.classList.contains('notyet')) return true;
    if (el.tagName === 'DETAILS' || el.tagName === 'H2' || el.querySelector('details')) return false;
    return /לא לעשות עדיין/.test((el.textContent || '').slice(0, 200)) && /callout|alert|note|warn|err/.test(el.className || '');
  }  function numbersIn(text) {
    var out = {}, re = /שאל(?:ה|ות)\s*((?:\d+\s*(?:,|ו-?|-|–)?\s*)+)/g, m, d;
    while ((m = re.exec(text))) { var ds = m[1].match(/\d+/g) || []; for (d = 0; d < ds.length; d++) out[ds[d]] = true; }
    return out;
  }

  function build() {
    var wrap = document.querySelector('.wrap');
    if (!wrap || wrap.getAttribute('data-book')) return;
    var kids = Array.prototype.slice.call(wrap.children), first = -1, i;
    for (i = 0; i < kids.length; i++) if (kids[i].tagName === 'H2') { first = i; break; }
    if (first < 0) return;

    var g = { over: [], sum: [], hw: [] }, cur = 'sum', ended = false, notyet = [], lead = [];
    for (i = 0; i < first; i++) {
      var p = kids[i];
      if (p.tagName === 'HEADER' || p.tagName === 'NAV' || p.tagName === 'STYLE' || p.tagName === 'SCRIPT') continue;
      if (isNotYet(p)) notyet.push(p); else lead.push(p);
    }
    for (i = first; i < kids.length; i++) {
      var k = kids[i];
      if (k.tagName === 'FOOTER' || k.tagName === 'SCRIPT' || k.tagName === 'STYLE') ended = true;
      if (ended) continue;
      if (k.tagName === 'H2') cur = kindOf(k);
      if (isNotYet(k)) { notyet.push(k); continue; }
      g[cur].push(k);
    }
    var order = ['over', 'sum', 'hw'].filter(function (n) { return g[n].length > 0; });
    if (order.length < 2) return;
    if (notyet.length && order.indexOf('hw') < 0) { g.hw = []; order.push('hw'); }
    wrap.setAttribute('data-book', '1');

    var toc = wrap.querySelector('nav.toc');
    var grid = document.createElement('div'); grid.className = 'bookgrid';
    var side = document.createElement('aside'); side.className = 'booktabs';
    var main = document.createElement('div'); main.className = 'bookmain';
    grid.appendChild(side); grid.appendChild(main);
    wrap.insertBefore(grid, kids[first]);
    if (toc) main.appendChild(toc);

    var pages = {};
    order.forEach(function (n) {
      var s = document.createElement('section'); s.className = 'bookpage'; s.id = 'bp-' + n; main.appendChild(s); pages[n] = s;
      var h = document.createElement('h1'); h.className = 'bookpage-title print-only'; h.textContent = ICONS[n] + ' ' + LONG[n]; s.appendChild(h);
    });
    lead.forEach(function (e) { (pages.over || pages.sum).appendChild(e); });
    order.forEach(function (n) { g[n].forEach(function (e) { pages[n].appendChild(e); }); });
    if (pages.hw && notyet.length) {
      var title = pages.hw.querySelector('.bookpage-title');
      notyet.slice().reverse().forEach(function (e) { e.classList.add('notyet'); pages.hw.insertBefore(e, title.nextSibling); });
    }
    // Tabs on the right, with a number: the student sees there are pages and where he is.
    var label = document.createElement('div'); label.className = 'booklabel'; label.textContent = 'עמודים'; side.appendChild(label);
    order.forEach(function (n, ix) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-p', n);
      b.innerHTML = '<span class="bn">' + (ix + 1) + '</span><span class="bt">' + ICONS[n] + ' ' + NAMES[n] + '</span>';
      b.onclick = function () { show(n, true); };
      side.appendChild(b);
    });

    // Bottom of each page: the way to the next one.
    order.forEach(function (n, ix) {
      if (ix >= order.length - 1) return;
      var nav = document.createElement('div'); nav.className = 'pagenav';
      var next = document.createElement('button'); next.type = 'button'; next.textContent = 'לעמוד הבא: ' + ICONS[order[ix + 1]] + ' ' + NAMES[order[ix + 1]] + ' ←';
      next.onclick = function () { show(order[ix + 1], true); };
      nav.appendChild(next); pages[n].appendChild(nav);
    });

    if (pages.hw) groupQuestions(pages.hw, notyet);

    function pageOf(el) { var p = el.closest ? el.closest('.bookpage') : null; return p ? p.id.slice(3) : null; }
    function show(n, top) {
      order.forEach(function (x) { pages[x].classList.toggle('on', x === n); });
      Array.prototype.forEach.call(side.querySelectorAll('button'), function (b) { b.classList.toggle('on', b.getAttribute('data-p') === n); });
      Array.prototype.forEach.call(document.querySelectorAll('nav.toc a[href^="#"]'), function (a) {
        var t = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))), pg = t ? pageOf(t) : null;
        a.style.display = (pg && pg !== n) ? 'none' : '';
      });
      if (top) { try { grid.scrollIntoView(); } catch (e) { } }
    }
    function goHash() {
      var id = decodeURIComponent(location.hash.slice(1)), t = id && document.getElementById(id), pg = t && pageOf(t);
      if (pg) { show(pg, false); if (t.tagName === 'DETAILS') t.open = true; t.scrollIntoView(); }
    }
    Array.prototype.forEach.call(document.querySelectorAll('nav.toc a[href^="#"]'), function (a) {
      a.addEventListener('click', function (ev) {
        var t = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))), pg = t && pageOf(t);
        if (pg) { ev.preventDefault(); show(pg, false); t.scrollIntoView(); }
      });
    });
    // A link inside the text to another page's section opens that page first.
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest ? ev.target.closest('a[href^="#"]') : null; if (!a || a.closest('nav.toc')) return;
      var t = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))), pg = t && pageOf(t);
      if (pg) { ev.preventDefault(); show(pg, false); if (t.tagName === 'DETAILS') t.open = true; t.scrollIntoView(); }
    });
    addEventListener('hashchange', goHash);
    show(order[0], false); goHash();
  }

  // The homework, question by question: one block for each, the parts (א, ב, ...) inside it. A question that is not for this lecture
  // (the lecturer said to skip it, or it needs what has not been taught yet) is set apart and says so.
  function groupQuestions(page, notyet) {
    var later = {};
    notyet.forEach(function (e) { var n = numbersIn(e.textContent || ''); for (var k in n) later[k] = true; });
    var items = Array.prototype.slice.call(page.querySelectorAll('details.q')), groups = {}, any = false;
    items.forEach(function (d) {
      var t = (d.querySelector('summary') || d).textContent || '', m = /שאלה\s*(\d+)/.exec(t);
      if (!m) return;
      any = true;
      var n = m[1], gr = groups[n];
      if (!gr) {
        gr = document.createElement('section'); gr.className = 'qgroup' + (later[n] || d.classList.contains('notyet') ? ' later' : '');
        var h = document.createElement('h3'); h.className = 'qghead'; h.textContent = 'שאלה ' + n;
        if (gr.classList.contains('later')) { var bd = document.createElement('span'); bd.className = 'qbadge'; bd.textContent = 'לא להרצאה הזו'; h.appendChild(bd); }
        gr.appendChild(h); d.parentNode.insertBefore(gr, d); groups[n] = gr;
      }
      gr.appendChild(d);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
