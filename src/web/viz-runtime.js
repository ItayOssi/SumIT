// "המחשה חזותית" (macOS): draws a visual for one homework question from a short spec the AI writes.
// It runs only inside a sandboxed frame (srcdoc, no same-origin, no network); the host also requires this file in Node to check a spec
// before it is shown. Expressions are parsed here, never eval'd: + - * / ^, functions, the spec's parameters and x, y, z, t, s.
(function (root) {
  'use strict';
  var Kinds = ['plot', 'wave', 'circuit', 'field3d', 'custom'];
  var Parts = ['W', 'R', 'C', 'L', 'V', 'B', 'I', 'S', 'D', 'G', 'A', 'M'];
  // Named colors the AI may use (for a part, a loop): the same hue in every theme, so a color always means the same thing.
  var Named = { yellow: '#e8c068', cyan: '#6cc4df', purple: '#a874d6', red: '#d0546a', blue: '#5b8bd6', green: '#5fbf8f', orange: '#ec9a4a', white: '#f2f2ef' };
  var Styles = ['', 'board'];
  var Funcs = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2, sqrt: Math.sqrt, abs: Math.abs, sign: Math.sign, floor: Math.floor,
    ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max, pow: Math.pow, atan2: Math.atan2, hypot: Math.hypot,
    step: function (v) { return v >= 0 ? 1 : 0; }, sec: function (v) { return 1 / Math.cos(v); }, cot: function (v) { return 1 / Math.tan(v); },
  };
  var Consts = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };
  var MaxExpr = 240, MaxCustom = 8000;

  // ----- expressions -----
  function tokens(src) {
    var out = [], i = 0, s = String(src).replace(/\*\*/g, '^').replace(/[·×]/g, '*').replace(/−/g, '-').replace(/π/g, 'pi');
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      var num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
      if (num) { out.push({ t: 'n', v: parseFloat(num[0]) }); i += num[0].length; continue; }
      var id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
      if (id) { out.push({ t: 'i', v: id[0] }); i += id[0].length; continue; }
      if ('+-*/^(),'.indexOf(c) >= 0) { out.push({ t: c }); i++; continue; }
      throw new Error('תו לא מוכר בביטוי: ' + c);
    }
    return out;
  }
  // Returns f(scope) -> number. vars: the names the expression may use.
  function compile(src, vars) {
    src = String(src == null ? '' : src);
    if (!src.trim()) throw new Error('ביטוי ריק');
    if (src.length > MaxExpr) throw new Error('ביטוי ארוך מדי');
    var tk = tokens(src), p = 0, allowed = Object.create(null);   // no prototype: "constructor" is not a variable
    (vars || []).forEach(function (v) { allowed[v] = true; });
    function peek(t) { return tk[p] && tk[p].t === t; }
    function eat(t) { if (!peek(t)) throw new Error('ביטוי לא תקין: ' + src); return tk[p++]; }
    function startsPrimary() { return tk[p] && (tk[p].t === 'n' || tk[p].t === 'i' || tk[p].t === '('); }
    function expr() {
      var a = term();
      while (peek('+') || peek('-')) {
        var op = tk[p++].t, b = term(), l = a;
        a = op === '+' ? (function (l, b) { return function (s) { return l(s) + b(s); }; })(l, b) : (function (l, b) { return function (s) { return l(s) - b(s); }; })(l, b);
      }
      return a;
    }
    function term() {
      var a = unary();
      for (;;) {
        var l = a, b;
        if (peek('*')) { p++; b = unary(); a = (function (l, b) { return function (s) { return l(s) * b(s); }; })(l, b); }
        else if (peek('/')) { p++; b = unary(); a = (function (l, b) { return function (s) { return l(s) / b(s); }; })(l, b); }
        else if (startsPrimary()) { b = power(); a = (function (l, b) { return function (s) { return l(s) * b(s); }; })(l, b); }   // 2x, 3(x+1)
        else return a;
      }
    }
    function unary() {
      if (peek('-')) { p++; var u = unary(); return function (s) { return -u(s); }; }
      if (peek('+')) { p++; return unary(); }
      return power();
    }
    function power() {
      var a = primary();
      if (peek('^')) { p++; var b = unary(); return function (s) { return Math.pow(a(s), b(s)); }; }
      return a;
    }
    function primary() {
      var t = tk[p];
      if (!t) throw new Error('ביטוי לא שלם: ' + src);
      if (t.t === 'n') { p++; var v = t.v; return function () { return v; }; }
      if (t.t === '(') { p++; var e = expr(); eat(')'); return e; }
      if (t.t === 'i') {
        p++;
        var name = t.v;
        if (Object.prototype.hasOwnProperty.call(Funcs, name) && peek('(')) {
          p++; var args = [];
          if (!peek(')')) { args.push(expr()); while (peek(',')) { p++; args.push(expr()); } }
          eat(')');
          var fn = Funcs[name];
          return function (s) { var a = []; for (var k = 0; k < args.length; k++) a.push(args[k](s)); return fn.apply(null, a); };
        }
        if (allowed[name]) return function (s) { return s[name]; };
        if (Object.prototype.hasOwnProperty.call(Consts, name)) { var c = Consts[name]; return function () { return c; }; }
        throw new Error('משתנה לא מוכר בביטוי: ' + name);
      }
      throw new Error('ביטוי לא תקין: ' + src);
    }
    var f = expr();
    if (p !== tk.length) throw new Error('ביטוי לא תקין: ' + src);
    return f;
  }

  // ----- the spec: checked and cut down to what the renderers draw -----
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function text(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 120); }
  function range(v, d) { return Array.isArray(v) && v.length === 2 && isFinite(+v[0]) && isFinite(+v[1]) && +v[1] > +v[0] ? [+v[0], +v[1]] : d; }
  function list(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }
  function exprOf(v, vars) { if (typeof v === 'number' && isFinite(v)) return String(v); var s = text(v, MaxExpr); compile(s, vars); return s; }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('ההמחשה שהתקבלה אינה תקינה');
    var kind = String(raw.kind || '');
    if (Kinds.indexOf(kind) < 0) throw new Error('סוג המחשה לא מוכר: ' + text(kind, 20));
    var out = { kind: kind, title: text(raw.title, 90), note: text(raw.note, 300), style: Styles.indexOf(raw.style) > 0 ? raw.style : '' };
    if (kind === 'custom') {
      var html = String(raw.html || '');
      if (!html.trim()) throw new Error('ההמחשה ריקה');
      if (html.length > MaxCustom) throw new Error('ההמחשה גדולה מדי');
      if (/<\s*(iframe|object|embed|link|meta|base|form)\b|\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon)\b|\bimport\s*\(|\b(top|parent|opener)\s*\.\s*(location|postMessage|document)|\bsrc\s*=\s*["']?\s*(https?:|\/\/)/i.test(html)) throw new Error('ההמחשה ניסתה לגשת לרשת או לדף, והיא לא תוצג');
      out.html = html;
      return out;
    }
    var params = [], names = {};
    list(raw.params, 6).forEach(function (q) {
      var name = String(q && q.name || '');
      if (!/^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(name) || names[name] || Funcs[name] || Consts[name] || /^[xyzts]$/.test(name)) return;
      var min = num(q.min, 0), max = num(q.max, 10);
      if (!(max > min)) return;
      var value = Math.min(max, Math.max(min, num(q.value, min)));
      var step = num(q.step, (max - min) / 100);
      if (!(step > 0)) step = (max - min) / 100;
      names[name] = true;
      params.push({ name: name, label: text(q.label, 40) || name, min: min, max: max, step: step, value: value, unit: text(q.unit, 12) });
    });
    out.params = params;
    var pn = params.map(function (q) { return q.name; });
    out.readouts = [];
    list(raw.readouts, 6).forEach(function (r) {
      try { out.readouts.push({ label: text(r.label, 40), expr: exprOf(r.expr, pn.concat(['t'])), unit: text(r.unit, 12) }); } catch (e) { }
    });
    var items = 0;
    if (kind === 'plot' || kind === 'wave') {
      var vars = pn.concat(kind === 'wave' ? ['x', 't'] : ['x']);
      out.x = range(raw.x, kind === 'wave' ? [0, 10] : [-5, 5]);
      out.y = range(raw.y, null);
      out.xLabel = text(raw.xLabel, 30); out.yLabel = text(raw.yLabel, 30);
      out.curves = [];
      list(raw.curves || raw.waves, 6).forEach(function (c) {
        if (!c) return;
        out.curves.push({ expr: exprOf(c.expr, vars), label: text(c.label, 50), dashed: !!c.dashed });
      });
      if (!out.curves.length) throw new Error('אין עקומות בהמחשה');
      out.points = [];
      if (kind === 'plot') list(raw.points, 8).forEach(function (q) {
        try { out.points.push({ x: exprOf(q.x, pn), y: exprOf(q.y, pn), label: text(q.label, 40) }); } catch (e) { }
      });
      if (kind === 'wave') { out.sum = !!raw.sum && out.curves.length > 1; out.speed = Math.min(5, Math.max(0.05, num(raw.speed, 1))); }
      items = out.curves.length + out.points.length + (out.sum ? 1 : 0);
    } else if (kind === 'circuit') {
      out.parts = [];
      list(raw.parts, 40).forEach(function (q) {
        if (!q || Parts.indexOf(String(q.type)) < 0) return;
        var a = Array.isArray(q.a) ? [num(q.a[0], NaN), num(q.a[1], NaN)] : null, b = Array.isArray(q.b) ? [num(q.b[0], NaN), num(q.b[1], NaN)] : null;
        if (!a || !isFinite(a[0]) || !isFinite(a[1]) || a[0] < 0 || a[1] < 0 || a[0] > 20 || a[1] > 20) return;
        if (q.type !== 'G' && (!b || !isFinite(b[0]) || !isFinite(b[1]) || b[0] < 0 || b[1] < 0 || b[0] > 20 || b[1] > 20 || (a[0] === b[0] && a[1] === b[1]))) return;
        out.parts.push({ type: String(q.type), a: a, b: q.type === 'G' ? null : b, label: text(q.label, 30), color: Named[q.color] ? String(q.color) : '' });
      });
      if (!out.parts.length) throw new Error('אין רכיבים במעגל');
      out.nodes = [];
      list(raw.nodes, 20).forEach(function (q) { if (q && Array.isArray(q.at)) out.nodes.push({ at: [num(q.at[0], 0), num(q.at[1], 0)], label: text(q.label, 12) }); });
      // Mesh currents: a cell of the grid, a direction, a label like I_1 and a color.
      out.loops = [];
      list(raw.loops, 6).forEach(function (q) {
        var bx = Array.isArray(q && q.box) ? q.box.map(Number) : [];
        if (bx.length !== 4 || !bx.every(isFinite) || bx[2] <= bx[0] || bx[3] <= bx[1] || bx.some(function (v) { return v < 0 || v > 20; })) return;
        out.loops.push({ box: bx, label: text(q.label, 8) || ('I_' + (out.loops.length + 1)), dir: q.dir === 'cw' ? 'cw' : 'ccw', color: Named[q.color] ? String(q.color) : ['blue', 'purple', 'red', 'green', 'orange', 'cyan'][out.loops.length] });
      });
      // Equations under the circuit, written as text ("12 I_1 - 3 I_2 = 17"); each I_n takes the color of its loop.
      out.equations = list(raw.equations, 6).map(function (e) { return text(e, 90); }).filter(function (e) { return e && /^[0-9A-Za-z_{}\s+\-−=.,·*/()]+$/.test(e); });
      items = out.parts.length;
    } else if (kind === 'field3d') {
      var v3 = pn.concat(['x', 'y', 'z']);
      out.range = Math.min(100, Math.max(0.1, num(raw.range, 2)));
      out.n = Math.min(7, Math.max(3, Math.round(num(raw.n, 5))));
      out.field = null; out.curve = null; out.surface = null;
      if (Array.isArray(raw.field) && raw.field.length === 3) out.field = raw.field.map(function (e) { return exprOf(e, v3); });
      if (raw.curve && typeof raw.curve === 'object') {
        var cs = pn.concat(['s']);
        out.curve = { x: exprOf(raw.curve.x, cs), y: exprOf(raw.curve.y, cs), z: exprOf(raw.curve.z, cs), s: range(raw.curve.s, [0, 2 * Math.PI]), label: text(raw.curve.label, 40) };
      }
      if (raw.surface && typeof raw.surface === 'object') out.surface = { z: exprOf(raw.surface.z, pn.concat(['x', 'y'])), label: text(raw.surface.label, 40) };
      out.points = [];
      list(raw.points, 8).forEach(function (q) {
        try { out.points.push({ x: exprOf(q.x, pn), y: exprOf(q.y, pn), z: exprOf(q.z, pn), label: text(q.label, 30) }); } catch (e) { }
      });
      if (!out.field && !out.curve && !out.surface) throw new Error('אין שדה, עקומה או משטח בהמחשה');
      items = 3 + out.points.length;
    }
    out.steps = [];
    list(raw.steps, 8).forEach(function (s) {
      if (!s) return;
      var show = Array.isArray(s.show) ? s.show.map(Number).filter(function (n) { return n >= 0 && n < items && Math.floor(n) === n; }).slice(0, 40) : null;
      var st = { text: text(s.text, 220), show: show };
      var set = {};
      if (s.set && typeof s.set === 'object') params.forEach(function (q) { if (isFinite(+s.set[q.name])) set[q.name] = Math.min(q.max, Math.max(q.min, +s.set[q.name])); });
      st.set = set;
      if (kind === 'circuit') {
        st.loops = Array.isArray(s.loops) ? s.loops.map(Number).filter(function (n) { return n >= 0 && n < out.loops.length && Math.floor(n) === n; }) : null;
        st.eq = isFinite(+s.eq) ? Math.max(0, Math.min(out.equations.length, Math.floor(+s.eq))) : null;
      }
      if (st.text) out.steps.push(st);
    });
    return out;
  }

  // ----- drawing (browser only) -----
  var KindInfo = { plot: ['📈', 'גרף אינטראקטיבי'], wave: ['〰️', 'גלים בתנועה'], circuit: ['⚡', 'מעגל חשמלי'], field3d: ['🧭', 'מרחב תלת-ממדי'] };

  function mount(host, spec) {
    var doc = host.ownerDocument, win = doc.defaultView;
    var css = getComputedStyle(doc.documentElement);
    var color = function (n, d) { return (css.getPropertyValue(n) || '').trim() || d; };
    var C = { fg: color('--fg', '#1c2233'), muted: color('--muted', '#6b7385'), grid: color('--grid', 'rgba(110,120,150,.13)'), axis: color('--axis', 'rgba(90,100,130,.55)'),
      accent: color('--accent', '#4f6bff'), accent2: color('--accent2', '#8b5cf6'), bg: color('--bg', '#ffffff'), bg2: color('--bg2', '#f6f7fb'), line: color('--line', '#e6e8f0') };
    var palette = [C.accent, '#ff6b6b', '#20c997', '#f59f00', C.accent2, '#22b8cf'];
    var el = function (tag, cls, txt) { var e = doc.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    var post = function (m) { try { win.parent.postMessage(Object.assign({ sumitViz: true }, m), '*'); } catch (e) { } };
    var info = KindInfo[spec.kind];

    // The header: what kind of visual this is, and its title.
    var head = el('div', 'viz-head'), titles = el('div');
    head.appendChild(el('span', 'viz-badge', info[0]));
    titles.appendChild(el('h3', 'viz-title', spec.title || info[1]));
    if (spec.title) titles.appendChild(el('small', 'viz-kind', info[1]));
    head.appendChild(titles); host.appendChild(head);

    var scope = {}, step = -1, off = {}, draw = function () { };
    spec.params.forEach(function (q) { scope[q.name] = q.value; });
    var fill = function (label) { return String(label || '').replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, function (m, n) { return n in scope ? fmt(scope[n]) : m; }); };
    var stepShows = function (i) { return step < 0 || !spec.steps[step].show || spec.steps[step].show.indexOf(i) >= 0; };
    var visible = function (i) { return !off[i] && stepShows(i); };

    var legend = el('div', 'viz-legend'), chips = [];
    host.appendChild(legend);
    var stage = el('div', 'viz-stage'); host.appendChild(stage);
    var overlay = el('div', 'viz-overlay'); stage.appendChild(overlay);

    // Steps of the solution: dots to jump, the text, and the way back and forward (also with the arrow keys).
    var stepBox = null, stepText = null, stepCount = null, dots = [], prev = null, next = null;
    if (spec.steps.length) {
      stepBox = el('div', 'viz-steps'); host.appendChild(stepBox);
      var bar = el('div', 'viz-step-bar'), dotRow = el('div', 'viz-dots');
      stepCount = el('b', 'viz-step-count');
      spec.steps.forEach(function (s, i) { var d = el('button', 'viz-dot'); d.type = 'button'; d.setAttribute('aria-label', 'שלב ' + (i + 1)); d.onclick = function () { go(i); }; dots.push(d); dotRow.appendChild(d); });
      prev = el('button', 'viz-btn', 'הקודם'); next = el('button', 'viz-btn primary', 'השלב הבא'); var all = el('button', 'viz-btn', 'הכל');
      prev.type = next.type = all.type = 'button';
      prev.onclick = function () { go(Math.max(0, step - 1)); };
      next.onclick = function () { go(Math.min(spec.steps.length - 1, step + 1)); };
      all.onclick = function () { go(-1); };
      bar.appendChild(stepCount); bar.appendChild(dotRow); bar.appendChild(prev); bar.appendChild(next); bar.appendChild(all);
      stepText = el('p', 'viz-step-text');
      stepBox.appendChild(bar); stepBox.appendChild(stepText);
      doc.addEventListener('keydown', function (e) {
        if (e.target && e.target.tagName === 'INPUT') return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); next.click(); } else if (e.key === 'ArrowRight') { e.preventDefault(); prev.click(); }
      });
    }

    var reads = el('div', 'viz-readouts'), readFns = spec.readouts.map(function (r) { return compile(r.expr, spec.params.map(function (q) { return q.name; }).concat(['t'])); });
    if (spec.readouts.length) host.appendChild(reads);

    // The parameters: a slider each, its value in a chip, the track filled up to the thumb.
    var sliders = {};
    if (spec.params.length) {
      var params = el('div', 'viz-params'); params.appendChild(el('div', 'viz-section', '🎛️ שנה את הנתונים'));
      spec.params.forEach(function (q) {
        var row = el('label', 'viz-param'), top = el('div', 'viz-param-top'), val = el('bdi', 'viz-param-value');
        var input = el('input'); input.type = 'range'; input.dir = 'ltr'; input.min = q.min; input.max = q.max; input.step = q.step; input.value = q.value;
        var show = function () { val.textContent = fmt(scope[q.name]) + (q.unit ? ' ' + q.unit : ''); input.style.setProperty('--p', ((scope[q.name] - q.min) / (q.max - q.min) * 100) + '%'); };
        input.oninput = function () { scope[q.name] = +input.value; show(); redraw(); };
        sliders[q.name] = { input: input, show: show };
        top.appendChild(el('span', 'viz-param-name', q.label)); top.appendChild(val);
        row.appendChild(top); row.appendChild(input); params.appendChild(row); show();
      });
      host.appendChild(params);
    }
    if (spec.note) host.appendChild(el('p', 'viz-note', spec.note));

    function go(i) {
      step = i;
      if (i >= 0) { var set = spec.steps[i].set; for (var k in set) { scope[k] = set[k]; sliders[k].input.value = set[k]; sliders[k].show(); } }
      stepCount.textContent = i < 0 ? 'כל השלבים' : 'שלב ' + (i + 1) + ' / ' + spec.steps.length;
      stepText.textContent = i < 0 ? 'כל השלבים מוצגים יחד. לחץ על נקודה כדי לחזור לשלב.' : spec.steps[i].text;
      stepText.style.animation = 'none'; void stepText.offsetWidth; stepText.style.animation = '';
      dots.forEach(function (d, k) { d.classList.toggle('on', k === i); d.classList.toggle('done', i < 0 || k < i); });
      prev.disabled = i <= 0; next.disabled = i >= spec.steps.length - 1;
      redraw();
    }

    function redraw() {
      chips.forEach(function (c) { c.el.classList.toggle('off', !!off[c.i]); c.el.hidden = !stepShows(c.i); });
      draw();
      spec.readouts.forEach(function (r, i) {
        var v; try { v = readFns[i](Object.assign({ t: scope.t || 0 }, scope)); } catch (e) { v = NaN; }
        var tile = reads.children[i] || reads.appendChild(el('div', 'viz-tile'));
        tile.textContent = ''; tile.appendChild(el('small', '', fill(r.label))); tile.appendChild(el('b', '', fmt(v) + (r.unit ? ' ' + r.unit : '')));
      });
    }

    function addChips(items) {
      if (!items.length) { legend.remove(); return; }
      items.forEach(function (it) {
        var b = el('button', 'viz-chip'), dot = el('i', it.dashed ? 'dash' : '');
        b.type = 'button'; b.style.setProperty('--c', it.color); b.title = 'הצג או הסתר';
        b.appendChild(dot); b.appendChild(el('span', '', it.label));
        b.onclick = function () { off[it.i] = !off[it.i]; redraw(); };
        legend.appendChild(b); chips.push({ el: b, i: it.i });
      });
    }

    var canvas = null, ctx = null, W = 0, H = 0;
    function makeCanvas(ratio) {
      canvas = el('canvas', 'viz-canvas'); stage.insertBefore(canvas, overlay); ctx = canvas.getContext('2d');
      var size = function () {
        var w = Math.max(240, Math.round(stage.clientWidth || 480)), h = Math.round(Math.min(440, Math.max(220, w * ratio))), d = win.devicePixelRatio || 1;
        if (w === W && h === H) return;
        W = w; H = h; canvas.width = w * d; canvas.height = h * d; canvas.style.height = h + 'px'; ctx.setTransform(d, 0, 0, d, 0, 0); draw();
      };
      // Resized on the next frame, not inside the observer: a new canvas height there would make it run again in the same frame.
      var pending = false;
      new win.ResizeObserver(function () { if (pending) return; pending = true; win.requestAnimationFrame(function () { pending = false; size(); }); }).observe(stage); size();
    }
    function label(t, x, y, opts) {
      t = fill(t); if (!t) return; opts = opts || {};
      ctx.save(); ctx.font = (opts.bold ? '600 ' : '') + (opts.size || 12) + 'px -apple-system, "SF Pro Text", sans-serif';
      ctx.direction = /[֐-׿]/.test(t) ? 'rtl' : 'ltr'; ctx.textAlign = opts.align || 'center'; ctx.textBaseline = opts.base || 'middle';
      if (opts.halo !== false) { ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = C.bg2; ctx.strokeText(t, x, y); }
      ctx.fillStyle = opts.color || C.fg; ctx.fillText(t, x, y); ctx.restore();
    }
    function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function overlayButton(text, title, onclick) { var b = el('button', 'viz-round', text); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.onclick = onclick; overlay.appendChild(b); return b; }

    if (spec.kind === 'plot' || spec.kind === 'wave') plot();
    else if (spec.kind === 'circuit') circuit();
    else field3d();
    if (spec.steps.length) go(0); else redraw();
    return finish();

    function plot() {
      var wave = spec.kind === 'wave', vars = spec.params.map(function (q) { return q.name; }).concat(wave ? ['x', 't'] : ['x']);
      var fns = spec.curves.map(function (c) { return compile(c.expr, vars); });
      var pts = spec.points.map(function (q) { var pv = spec.params.map(function (x) { return x.name; }); return { x: compile(q.x, pv), y: compile(q.y, pv), label: q.label }; });
      var x0 = spec.x[0], x1 = spec.x[1], hover = null, playing = wave, last = 0;
      var series = fns.map(function (f, i) { return { f: f, i: i, c: palette[i % palette.length], label: spec.curves[i].label, dashed: spec.curves[i].dashed }; });
      if (spec.sum) series.push({ f: function (s) { var v = 0; fns.forEach(function (g) { v += g(s); }); return v; }, i: fns.length, c: C.fg, label: 'סכום', bold: true });
      addChips(series.filter(function (s) { return s.label; }).map(function (s) { return { i: s.i, label: s.label, color: s.c, dashed: s.dashed }; }));
      scope.t = 0;
      var yRange = function () {
        if (spec.y) return spec.y;
        var lo = Infinity, hi = -Infinity, ts = wave ? [0, 0.7, 1.9, 3.3] : [0];
        fns.forEach(function (f) { ts.forEach(function (t) { for (var i = 0; i <= 80; i++) { var v = f(Object.assign({}, scope, { x: x0 + (x1 - x0) * i / 80, t: t })); if (isFinite(v) && Math.abs(v) < 1e6) { lo = Math.min(lo, v); hi = Math.max(hi, v); } } }); });
        if (spec.sum) { lo *= fns.length; hi *= fns.length; }
        if (!isFinite(lo)) return [-1, 1];
        if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
        var pad = (hi - lo) * 0.12; return [lo - pad, hi + pad];
      };
      makeCanvas(0.6);
      if (wave) {
        var play = overlayButton('❚❚', 'עצור או נגן', function () { playing = !playing; play.textContent = playing ? '❚❚' : '▶'; if (playing) { last = 0; win.requestAnimationFrame(tick); } });
        var tick = function (now) { if (!playing) return; if (last) scope.t += (now - last) / 1000 * spec.speed; last = now; redraw(); win.requestAnimationFrame(tick); };
        win.requestAnimationFrame(tick);
      }
      canvas.addEventListener('pointermove', function (e) { var r = canvas.getBoundingClientRect(); hover = e.clientX - r.left; draw(); });
      canvas.addEventListener('pointerleave', function () { hover = null; draw(); });
      draw = function () {
        if (!W) return;
        var yr = yRange();
        var m = { l: 46, r: 16, t: 16, b: 32 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
        var X = function (x) { return m.l + (x - x0) / (x1 - x0) * pw; }, Y = function (y) { return m.t + (yr[1] - y) / (yr[1] - yr[0]) * ph; };
        ctx.clearRect(0, 0, W, H);
        axes(X, Y, x0, x1, yr[0], yr[1], m, pw, ph);
        ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
        var filled = false;
        series.forEach(function (s) {
          if (!visible(s.i)) return;
          var runs = [], run = [], prevY = null;
          for (var i = 0; i <= pw; i++) {
            var x = x0 + (x1 - x0) * i / pw, v = s.f(Object.assign({}, scope, { x: x })), py = Y(v);
            if (!isFinite(v) || Math.abs(py) > 1e5 || (prevY !== null && Math.abs(py - prevY) > ph * 2)) { if (run.length) runs.push(run); run = []; prevY = null; continue; }
            run.push([m.l + i, py]); prevY = py;
          }
          if (run.length) runs.push(run);
          // The first solid curve gets a soft fill down to the axis: the eye finds the main curve at once.
          if (!filled && !s.dashed && !s.bold) {
            filled = true;
            var base = Math.max(m.t, Math.min(m.t + ph, Y(Math.max(yr[0], Math.min(yr[1], 0))))), gr = ctx.createLinearGradient(0, m.t, 0, m.t + ph);
            gr.addColorStop(0, alpha(s.c, 0.22)); gr.addColorStop(1, alpha(s.c, 0.02));
            runs.forEach(function (r) { ctx.beginPath(); ctx.moveTo(r[0][0], base); r.forEach(function (p) { ctx.lineTo(p[0], p[1]); }); ctx.lineTo(r[r.length - 1][0], base); ctx.closePath(); ctx.fillStyle = gr; ctx.fill(); });
          }
          ctx.strokeStyle = s.c; ctx.lineWidth = s.bold ? 3.2 : 2.6; ctx.lineJoin = ctx.lineCap = 'round'; ctx.setLineDash(s.dashed ? [7, 6] : []);
          ctx.shadowColor = alpha(s.c, 0.35); ctx.shadowBlur = s.dashed ? 0 : 8;
          runs.forEach(function (r) { ctx.beginPath(); r.forEach(function (p, k) { if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke(); });
          ctx.shadowBlur = 0;
        });
        ctx.restore(); ctx.setLineDash([]);
        pts.forEach(function (q, k) {
          if (!visible(fns.length + k)) return;
          var px = q.x(scope), py = q.y(scope); if (!isFinite(px) || !isFinite(py)) return;
          ring(X(px), Y(py), C.accent);
          pill(fill(q.label) || ('(' + fmt(px) + ', ' + fmt(py) + ')'), X(px), Y(py) - 20);
        });
        if (spec.xLabel) label(spec.xLabel, m.l + pw, H - 8, { align: 'right', color: C.muted });
        if (spec.yLabel) label(spec.yLabel, m.l + 6, m.t + 2, { align: 'left', color: C.muted, base: 'top' });
        if (hover !== null && hover >= m.l && hover <= m.l + pw) {
          var hx = x0 + (hover - m.l) / pw * (x1 - x0), rows = [];
          ctx.strokeStyle = C.axis; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(hover, m.t); ctx.lineTo(hover, m.t + ph); ctx.stroke(); ctx.setLineDash([]);
          series.forEach(function (s) { if (!visible(s.i)) return; var v = s.f(Object.assign({}, scope, { x: hx })); if (!isFinite(v)) return; ring(hover, Y(v), s.c, 4); rows.push([s.c, fmt(v)]); });
          tooltip(hover, m.t + 8, 'x = ' + fmt(hx), rows, m.l, m.l + pw);
        }
      };
    }

    function ring(x, y, c, r) { ctx.beginPath(); ctx.arc(x, y, (r || 5) + 2.5, 0, 7); ctx.fillStyle = C.bg; ctx.shadowColor = alpha(c, 0.4); ctx.shadowBlur = 6; ctx.fill(); ctx.shadowBlur = 0; ctx.beginPath(); ctx.arc(x, y, r || 5, 0, 7); ctx.fillStyle = c; ctx.fill(); }
    function pill(text, x, y) {
      ctx.save(); ctx.font = '600 12px -apple-system, sans-serif'; ctx.direction = /[֐-׿]/.test(text) ? 'rtl' : 'ltr';
      var w = ctx.measureText(text).width + 16; roundRect(x - w / 2, y - 11, w, 22, 11); ctx.fillStyle = C.bg; ctx.shadowColor = 'rgba(20,30,60,.18)'; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = C.line; ctx.stroke(); ctx.fillStyle = C.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5); ctx.restore();
    }
    // A small card next to the cursor: x, then the value of each curve with its color.
    function tooltip(x, y, title, rows, minX, maxX) {
      ctx.save(); ctx.font = '12px -apple-system, sans-serif'; ctx.direction = 'ltr';
      var w = Math.max(ctx.measureText(title).width, Math.max.apply(null, rows.map(function (r) { return ctx.measureText(r[1]).width + 16; }).concat([0]))) + 20, h = 24 + rows.length * 18;
      var left = x + 12 + w > maxX ? x - 12 - w : x + 12; left = Math.max(minX, left);
      roundRect(left, y, w, h, 10); ctx.fillStyle = alpha(C.bg, 0.94); ctx.shadowColor = 'rgba(20,30,60,.22)'; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = C.line; ctx.stroke();
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = C.muted; ctx.fillText(title, left + 10, y + 13);
      rows.forEach(function (r, i) { var ry = y + 31 + i * 18; ctx.beginPath(); ctx.arc(left + 14, ry, 4, 0, 7); ctx.fillStyle = r[0]; ctx.fill(); ctx.fillStyle = C.fg; ctx.font = '600 12px -apple-system, sans-serif'; ctx.fillText(r[1], left + 24, ry); });
      ctx.restore();
    }

    function axes(X, Y, x0, x1, y0, y1, m, pw, ph) {
      ctx.lineWidth = 1;
      var tx = ticks(x0, x1, Math.max(3, Math.round(pw / 70))), ty = ticks(y0, y1, Math.max(3, Math.round(ph / 45)));
      ctx.strokeStyle = C.grid;
      tx.forEach(function (v) { ctx.beginPath(); ctx.moveTo(X(v), m.t); ctx.lineTo(X(v), m.t + ph); ctx.stroke(); label(fmt(v), X(v), m.t + ph + 14, { color: C.muted, size: 11, halo: false }); });
      ty.forEach(function (v) { ctx.beginPath(); ctx.moveTo(m.l, Y(v)); ctx.lineTo(m.l + pw, Y(v)); ctx.stroke(); label(fmt(v), m.l - 8, Y(v), { align: 'right', color: C.muted, size: 11, halo: false }); });
      ctx.strokeStyle = C.axis; ctx.lineWidth = 1.4;
      if (y0 < 0 && y1 > 0) { ctx.beginPath(); ctx.moveTo(m.l, Y(0)); ctx.lineTo(m.l + pw, Y(0)); ctx.stroke(); }
      if (x0 < 0 && x1 > 0) { ctx.beginPath(); ctx.moveTo(X(0), m.t); ctx.lineTo(X(0), m.t + ph); ctx.stroke(); }
    }

    function circuit() {
      var ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg'), board = spec.style === 'board';
      var xs = [], ys = [];
      spec.parts.forEach(function (q) { xs.push(q.a[0]); ys.push(q.a[1]); if (q.b) { xs.push(q.b[0]); ys.push(q.b[1]); } });
      spec.nodes.forEach(function (n) { xs.push(n.at[0]); ys.push(n.at[1]); });
      var minX = Math.min.apply(null, xs) - 1.3, minY = Math.min.apply(null, ys) - 0.9, maxX = Math.max.apply(null, xs) + 1.3, maxY = Math.max.apply(null, ys) + 0.9, U = 60;
      var vb = [minX * U, minY * U, (maxX - minX) * U, (maxY - minY) * U];
      svg.setAttribute('viewBox', vb.join(' '));
      svg.setAttribute('class', 'viz-circuit'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', spec.title || 'מעגל');
      stage.insertBefore(svg, overlay);
      legend.remove();
      var eqBox = null, midX = (minX + maxX) / 2 * U;
      if (board) svg.classList.add('big');
      if (spec.equations.length) { eqBox = el('div', 'viz-eqs'); stage.appendChild(eqBox); }
      var wire = board ? '#f2f2ef' : C.fg, valueColor = board ? Named.yellow : C.fg, sourceColor = board ? Named.cyan : C.fg;
      var paint = function (name) { return Named[name] || ''; };
      var loopColor = function (L) { return paint(L.color) || C.accent; };
      // A part that runs along one side of a loop's cell is part of that loop.
      var onLoop = function (q, L) {
        if (!q.b) return false;
        var b = L.box, ax = q.a[0], ay = q.a[1], bx = q.b[0], by = q.b[1], eps = 1e-6;
        var inX = function (x) { return x >= b[0] - eps && x <= b[2] + eps; }, inY = function (y) { return y >= b[1] - eps && y <= b[3] + eps; };
        if (Math.abs(ax - bx) < eps && (Math.abs(ax - b[0]) < eps || Math.abs(ax - b[2]) < eps)) return inY(ay) && inY(by);
        if (Math.abs(ay - by) < eps && (Math.abs(ay - b[1]) < eps || Math.abs(ay - b[3]) < eps)) return inX(ax) && inX(bx);
        return false;
      };
      var mk = function (tag, attrs, parent) { var e = doc.createElementNS(ns, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; };
      // "I_2" as I with a small 2 below.
      var sub = function (t, textEl) {
        var m = /^([A-Za-z]+)_\{?([A-Za-z0-9]+)\}?$/.exec(t);
        if (!m) { textEl.textContent = t; return; }
        mk('tspan', {}, textEl).textContent = m[1];
        mk('tspan', { 'font-size': '62%', dy: '0.35em', 'font-style': 'normal' }, textEl).textContent = m[2];
      };
      draw = function () {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        var defs = mk('defs', {}), pat = mk('pattern', { id: 'board', width: U, height: U, patternUnits: 'userSpaceOnUse' }, defs);
        if (board) mk('path', { d: 'M' + U + ' 0H0V' + U, fill: 'none', stroke: 'rgba(255,255,255,.07)', 'stroke-width': 1 }, pat);
        else { pat.setAttribute('width', U / 2); pat.setAttribute('height', U / 2); mk('circle', { cx: 1.5, cy: 1.5, r: 1.3, fill: C.grid }, pat); }
        mk('rect', { x: vb[0], y: vb[1], width: vb[2], height: vb[3], fill: 'url(#board)' });
        var st = step >= 0 ? spec.steps[step] : null, hi = st && st.show, activeLoops = st && st.loops;
        // The loops, behind the circuit: a rounded frame inside the cell, a turning arrow and the current's name.
        spec.loops.forEach(function (L, i) {
          var active = !activeLoops || activeLoops.indexOf(i) >= 0, c = loopColor(L), b = L.box, pad = 0.26;
          var x0 = (b[0] + pad) * U, y0 = (b[1] + pad) * U, w = (b[2] - b[0] - 2 * pad) * U, h = (b[3] - b[1] - 2 * pad) * U, cx = x0 + w / 2, cy = y0 + h / 2;
          var g = mk('g', { opacity: active ? (activeLoops ? 1 : 0.8) : 0.16, class: 'viz-loop' });
          mk('rect', { x: x0, y: y0, width: w, height: h, rx: 16, fill: active && activeLoops ? alpha(c, 0.07) : 'none', stroke: c, 'stroke-width': 3, opacity: 0.85 }, g);
          var r = Math.min(w, h) * 0.3, sweep = L.dir === 'cw' ? 1 : 0, a0 = -Math.PI / 2, a1 = a0 + (L.dir === 'cw' ? 1 : -1) * Math.PI * 1.55;
          var sx = cx + r * Math.cos(a0), sy = cy + r * Math.sin(a0), ex = cx + r * Math.cos(a1), ey = cy + r * Math.sin(a1);
          var arrow = mk('g', { class: active && activeLoops ? 'viz-turn' + (L.dir === 'cw' ? '' : ' ccw') : '', style: 'transform-origin:' + cx + 'px ' + cy + 'px' }, g);
          mk('path', { d: 'M' + sx + ' ' + sy + 'A' + r + ' ' + r + ' 0 1 ' + sweep + ' ' + ex + ' ' + ey, fill: 'none', stroke: c, 'stroke-width': 5, 'stroke-linecap': 'round' }, arrow);
          var tx = L.dir === 'cw' ? -Math.sin(a1) : Math.sin(a1), ty = L.dir === 'cw' ? Math.cos(a1) : -Math.cos(a1), nx = -ty, ny = tx, hs = 13;
          mk('path', { d: 'M' + (ex + tx * hs) + ' ' + (ey + ty * hs) + 'L' + (ex + nx * hs * 0.65) + ' ' + (ey + ny * hs * 0.65) + 'L' + (ex - nx * hs * 0.65) + ' ' + (ey - ny * hs * 0.65) + 'Z', fill: c }, arrow);
          sub(fill(L.label), mk('text', { x: cx, y: cy + 9, 'text-anchor': 'middle', direction: 'ltr', fill: c, 'font-size': Math.max(22, Math.min(34, r * 0.55)), 'font-style': 'italic', class: 'viz-serif' }, g));
        });
        spec.parts.forEach(function (q, i) {
          var on = !hi || hi.indexOf(i) >= 0, lit = !!hi && on;
          var loopHit = activeLoops ? spec.loops.filter(function (L, k) { return activeLoops.indexOf(k) >= 0 && onLoop(q, L); })[0] : null;
          var stroke = loopHit ? loopColor(loopHit) : paint(q.color) || (lit ? C.accent : wire);
          var g = mk('g', { stroke: stroke, fill: 'none', 'stroke-width': lit || loopHit ? 3.6 : board ? 3 : 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: on ? 1 : 0.22 });
          if (lit || loopHit) g.setAttribute('style', 'filter:drop-shadow(0 0 5px ' + alpha(stroke, 0.6) + ')');
          var labelC = loopHit ? stroke : paint(q.color) || (/^[VBI]$/.test(q.type) ? sourceColor : valueColor);
          part(q, g, stroke, labelC);
          if (q.type === 'W' && on && !board && (lit || !spec.steps.length)) mk('path', { d: 'M' + q.a[0] * U + ' ' + q.a[1] * U + 'L' + q.b[0] * U + ' ' + q.b[1] * U, class: 'viz-flow', stroke: lit ? C.accent2 : alpha(C.accent, 0.8), 'stroke-width': 3.2, 'stroke-linecap': 'round', fill: 'none' });
        });
        spec.nodes.forEach(function (n) {
          mk('circle', { cx: n.at[0] * U, cy: n.at[1] * U, r: board ? 7 : 5.5, fill: wire, stroke: board ? 'none' : C.bg2, 'stroke-width': 2.5 });
          if (n.label) { var t = mk('text', { x: n.at[0] * U + 10, y: n.at[1] * U - 10, fill: C.fg, 'font-size': 15, 'font-weight': 700, direction: 'ltr', 'text-anchor': 'start', style: 'paint-order:stroke;stroke:' + C.bg2 + ';stroke-width:5px;stroke-linejoin:round' }); t.textContent = fill(n.label); }
        });
        if (eqBox) equations(st);
      };
      // The equations, one line each, revealed step by step; I_n in its loop's color, the number after "=" in the source's color.
      function equations(st) {
        var count = st && st.eq != null ? st.eq : spec.equations.length;
        eqBox.textContent = '';
        spec.equations.slice(0, count).forEach(function (e, k) {
          var line = el('div', 'viz-eq' + (st && st.eq === k + 1 ? ' new' : '')), after = false;
          var re = /(\d+(?:\.\d+)?)?\s*([A-Za-z])_\{?([A-Za-z0-9]+)\}?|(\d+(?:\.\d+)?)|(=)|([+\-−·*/(),])|\s+/g, m, last = 0;
          while ((m = re.exec(e)) && m[0].length) {
            if (m.index > last) line.appendChild(doc.createTextNode(e.slice(last, m.index)));
            last = re.lastIndex;
            if (m[2]) {
              var L = spec.loops.filter(function (x) { return x.label.replace(/[{}]/g, '') === m[2] + '_' + m[3]; })[0], term = el('span', 'viz-term');
              term.style.color = L ? loopColor(L) : C.fg;
              if (m[1]) term.appendChild(doc.createTextNode(m[1]));
              term.appendChild(el('i', '', m[2])); term.appendChild(el('sub', '', m[3])); line.appendChild(term);
            } else if (m[4]) { var nspan = el('span', '', m[4]); if (after) nspan.style.color = sourceColor; line.appendChild(nspan); }
            else if (m[5]) { after = true; line.appendChild(el('span', 'viz-op', '=')); }
            else if (m[6]) line.appendChild(el('span', 'viz-op', m[6] === '-' ? '−' : m[6]));
          }
          if (last < e.length) line.appendChild(doc.createTextNode(e.slice(last)));
          eqBox.appendChild(line);
        });
      }
      function part(q, g, stroke, labelColor) {
        var ax = q.a[0] * U, ay = q.a[1] * U;
        if (q.type === 'G') { mk('path', { d: 'M' + ax + ' ' + ay + 'v12m-14 0h28m-20 6h12m-9 6h6' }, g); return; }
        var bx = q.b[0] * U, by = q.b[1] * U, len = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
        var body = mk('g', { transform: 'translate(' + ax + ' ' + ay + ') rotate(' + ang + ')' }, g), mid = len / 2, half = Math.min(26, len / 2 - 2);
        var lead = function () { mk('path', { d: 'M0 0H' + (mid - half) + 'M' + (mid + half) + ' 0H' + len }, body); };
        var t = q.type;
        if (t === 'W') mk('path', { d: 'M0 0H' + len }, body);
        else if (t === 'R') { lead(); var d = 'M' + (mid - half) + ' 0'; for (var k = 0; k < 6; k++) d += 'L' + (mid - half + (k + 0.5) * half / 3) + ' ' + (k % 2 ? 9 : -9); mk('path', { d: d + 'L' + (mid + half) + ' 0' }, body); }
        else if (t === 'C') { mk('path', { d: 'M0 0H' + (mid - 5) + 'M' + (mid + 5) + ' 0H' + len + 'M' + (mid - 5) + ' -14V14M' + (mid + 5) + ' -14V14' }, body); }
        else if (t === 'L') { lead(); var dl = 'M' + (mid - half) + ' 0'; for (var j = 0; j < 4; j++) dl += 'a' + half / 4 + ' ' + half / 4 + ' 0 0 1 ' + half / 2 + ' 0'; mk('path', { d: dl }, body); }
        else if (t === 'B') {   // a battery: the long thin plate is + (at b), the short thick one is −
          mk('path', { d: 'M0 0H' + (mid - 6) + 'M' + (mid + 6) + ' 0H' + len }, body);
          mk('path', { d: 'M' + (mid + 6) + ' -24V24' }, body);
          mk('path', { d: 'M' + (mid - 6) + ' -13V13', 'stroke-width': 7 }, body);
        }
        else if (t === 'V' || t === 'I' || t === 'A' || t === 'M') {
          var r = Math.min(16, len / 2 - 2); mk('path', { d: 'M0 0H' + (mid - r) + 'M' + (mid + r) + ' 0H' + len }, body); mk('circle', { cx: mid, cy: 0, r: r, fill: C.bg2 }, body);
          if (t === 'V') mk('path', { d: 'M' + (mid - r * 0.55) + ' -4v8M' + (mid - r * 0.55 - 4) + ' 0h8M' + (mid + r * 0.35) + ' -4v8', 'stroke-width': 2 }, body);
          else if (t === 'I') mk('path', { d: 'M' + (mid - r * 0.5) + ' 0H' + (mid + r * 0.5) + 'm-6 -5l6 5l-6 5', 'stroke-width': 2 }, body);
          else { var tt = mk('text', { x: mid, y: 5, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: stroke, stroke: 'none', transform: 'rotate(' + (-ang) + ' ' + mid + ' 0)' }, body); tt.textContent = t === 'A' ? 'A' : 'V'; }
        }
        else if (t === 'S') { mk('path', { d: 'M0 0H' + (mid - half) + 'L' + (mid + half * 0.8) + ' -14M' + (mid + half) + ' 0H' + len }, body); mk('circle', { cx: mid - half, cy: 0, r: 3, fill: stroke }, body); }
        else if (t === 'D') { lead(); mk('path', { d: 'M' + (mid - 9) + ' -10L' + (mid + 9) + ' 0L' + (mid - 9) + ' 10ZM' + (mid + 9) + ' -10V10', fill: stroke }, body); }
        if (q.label) {
          // Beside the part: above a level one, to the side of an upright one (anchored there, so a long label doesn't cover it).
          var nx = -(by - ay) / len, ny = (bx - ax) / len; if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
          // An upright part's label goes on the outer side: right of a part in the right half of the circuit, left of one in the left half.
          if (Math.abs(nx) > 0.7 && ((ax + bx) / 2 > midX) !== (nx > 0)) { nx = -nx; ny = -ny; }
          var txt = fill(q.label), heb = /[֐-׿]/.test(txt), side = Math.abs(nx) > 0.7;
          var anchor = !side ? 'middle' : (nx < 0) !== heb ? 'end' : 'start';
          var lt = mk('text', { x: (ax + bx) / 2 + nx * (side ? 30 : 30), y: (ay + by) / 2 + ny * 30 + 7, 'text-anchor': anchor, direction: heb ? 'rtl' : 'ltr', 'font-size': board ? 21 : 14, 'font-weight': board ? 400 : 600, fill: labelColor, stroke: 'none',
            class: board ? 'viz-serif' : '', style: board ? '' : 'paint-order:stroke;stroke:' + C.bg2 + ';stroke-width:5px;stroke-linejoin:round' }, g);
          lt.textContent = txt;
        }
      }
    }

    function field3d() {
      var R = spec.range, n = spec.n, yaw = -0.7, pitch = 0.45, spin = true, pn = spec.params.map(function (q) { return q.name; });
      var F = spec.field && spec.field.map(function (e) { return compile(e, pn.concat(['x', 'y', 'z'])); });
      var cv = spec.curve && { x: compile(spec.curve.x, pn.concat(['s'])), y: compile(spec.curve.y, pn.concat(['s'])), z: compile(spec.curve.z, pn.concat(['s'])) };
      var sf = spec.surface && compile(spec.surface.z, pn.concat(['x', 'y']));
      var pts = spec.points.map(function (q) { return { x: compile(q.x, pn), y: compile(q.y, pn), z: compile(q.z, pn), label: q.label }; });
      stage.classList.add('space');
      var items = [];
      if (F) items.push({ i: 0, label: 'השדה', color: palette[0] });
      if (cv) items.push({ i: 1, label: spec.curve.label || 'העקומה', color: palette[1] });
      if (sf) items.push({ i: 2, label: spec.surface.label || 'המשטח', color: palette[2] });
      addChips(items.length > 1 ? items : []);
      makeCanvas(0.72);
      // It turns slowly by itself until the student takes it; the button puts the view back.
      var drag = null, loop = function () { if (!spin) return; yaw += 0.0035; draw(); win.requestAnimationFrame(loop); };
      canvas.addEventListener('pointerdown', function (e) { spin = false; drag = [e.clientX, e.clientY, yaw, pitch]; canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener('pointermove', function (e) { if (!drag) return; yaw = drag[2] + (e.clientX - drag[0]) * 0.01; pitch = Math.max(-1.45, Math.min(1.45, drag[3] + (e.clientY - drag[1]) * 0.01)); draw(); });
      canvas.addEventListener('pointerup', function () { drag = null; });
      overlayButton('⟲', 'איפוס תצוגה', function () { spin = false; yaw = -0.7; pitch = 0.45; draw(); });
      stage.appendChild(el('small', 'viz-hint', 'גרור כדי לסובב'));
      if (F) { var sc = el('div', 'viz-scale'); sc.appendChild(el('span', '', 'חלש')); sc.appendChild(el('b')); sc.appendChild(el('span', '', 'חזק')); stage.appendChild(sc); }
      win.requestAnimationFrame(loop);
      draw = function () {
        if (!W) return;
        ctx.clearRect(0, 0, W, H);
        var k = Math.min(W, H) * 0.36 / R, cx = W / 2, cy = H / 2;
        var P = function (x, y, z) {   // z is up; the third value is the depth (larger is farther)
          var x1 = x * Math.cos(yaw) - y * Math.sin(yaw), y1 = x * Math.sin(yaw) + y * Math.cos(yaw);
          var y2 = y1 * Math.cos(pitch) - z * Math.sin(pitch), z2 = y1 * Math.sin(pitch) + z * Math.cos(pitch);
          return [cx + x1 * k, cy - z2 * k, y2];
        };
        var fade = function (d) { return Math.max(0.35, Math.min(1, 0.7 - d / (R * 3.4))); };
        var line = function (a, b, c, w) { ctx.beginPath(); ctx.strokeStyle = c; ctx.lineWidth = w || 1; ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
        // The floor: a soft grid at z = -R.
        ctx.globalAlpha = 0.6;
        for (var gi = 0; gi <= 4; gi++) { var gv = -R + 2 * R * gi / 4; line(P(gv, -R, -R), P(gv, R, -R), C.grid); line(P(-R, gv, -R), P(R, gv, -R), C.grid); }
        ctx.globalAlpha = 1;
        [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]].forEach(function (ax) {
          var e = ax[1], a = P(-e[0] * R, -e[1] * R, -e[2] * R), b = P(e[0] * R * 1.15, e[1] * R * 1.15, e[2] * R * 1.15);
          line(a, b, C.axis, 1.3); label(ax[0], b[0], b[1], { color: C.muted, bold: true });
        });
        if (sf && visible(2)) {
          var m = 18, grid = [], zl = Infinity, zh = -Infinity;
          for (var i = 0; i <= m; i++) { grid.push([]); for (var j = 0; j <= m; j++) { var x = -R + 2 * R * i / m, y = -R + 2 * R * j / m, z = sf(Object.assign({}, scope, { x: x, y: y })); z = isFinite(z) ? Math.max(-3 * R, Math.min(3 * R, z)) : NaN; if (isFinite(z)) { zl = Math.min(zl, z); zh = Math.max(zh, z); } grid[i].push(isFinite(z) ? { p: P(x, y, z), z: z } : null); } }
          var zc = function (a, b) { return 'hsla(' + (190 - 150 * (((a.z + b.z) / 2 - zl) / ((zh - zl) || 1))) + ',75%,50%,.85)'; };
          for (var a = 0; a <= m; a++) for (var b2 = 0; b2 < m; b2++) {
            if (grid[a][b2] && grid[a][b2 + 1]) line(grid[a][b2].p, grid[a][b2 + 1].p, zc(grid[a][b2], grid[a][b2 + 1]), 1.1);
            if (grid[b2][a] && grid[b2 + 1][a]) line(grid[b2][a].p, grid[b2 + 1][a].p, zc(grid[b2][a], grid[b2 + 1][a]), 1.1);
          }
        }
        if (F && visible(0)) {
          var arrows = [], maxM = 0;
          for (var ii = 0; ii < n; ii++) for (var jj = 0; jj < n; jj++) for (var kk = 0; kk < n; kk++) {
            var px = -R + 2 * R * ii / (n - 1), py = -R + 2 * R * jj / (n - 1), pz = -R + 2 * R * kk / (n - 1), s = Object.assign({}, scope, { x: px, y: py, z: pz });
            var v = [F[0](s), F[1](s), F[2](s)], mag = Math.hypot(v[0], v[1], v[2]);
            if (!isFinite(mag) || mag < 1e-12) continue;
            maxM = Math.max(maxM, mag); arrows.push({ p: [px, py, pz], v: v, m: mag });
          }
          var cell = 2 * R / (n - 1) * 0.42;
          arrows.map(function (q) { var L = cell * (0.35 + 0.65 * Math.log1p(q.m) / Math.log1p(maxM || 1)); var u = [q.v[0] / q.m * L, q.v[1] / q.m * L, q.v[2] / q.m * L]; return { a: P(q.p[0], q.p[1], q.p[2]), b: P(q.p[0] + u[0], q.p[1] + u[1], q.p[2] + u[2]), m: q.m }; })
            .sort(function (x, y) { return y.a[2] - x.a[2]; })
            .forEach(function (q) {
              var c = heat(q.m / (maxM || 1)); ctx.globalAlpha = fade(q.a[2]); line(q.a, q.b, c, 1.8);
              var dx = q.b[0] - q.a[0], dy = q.b[1] - q.a[1], l = Math.hypot(dx, dy) || 1, h = Math.min(7, l * 0.45);
              ctx.beginPath(); ctx.fillStyle = c; ctx.moveTo(q.b[0], q.b[1]);
              ctx.lineTo(q.b[0] - dx / l * h - dy / l * h * 0.5, q.b[1] - dy / l * h + dx / l * h * 0.5);
              ctx.lineTo(q.b[0] - dx / l * h + dy / l * h * 0.5, q.b[1] - dy / l * h - dx / l * h * 0.5); ctx.fill();
            });
          ctx.globalAlpha = 1;
        }
        if (cv && visible(1)) {
          ctx.beginPath(); ctx.strokeStyle = palette[1]; ctx.lineWidth = 3; ctx.lineJoin = ctx.lineCap = 'round'; ctx.shadowColor = alpha(palette[1], 0.5); ctx.shadowBlur = 10; var first = true;
          for (var q = 0; q <= 240; q++) {
            var sv = spec.curve.s[0] + (spec.curve.s[1] - spec.curve.s[0]) * q / 240, ss = Object.assign({}, scope, { s: sv });
            var p3 = [cv.x(ss), cv.y(ss), cv.z(ss)]; if (!p3.every(isFinite)) { first = true; continue; }
            var pp = P(p3[0], p3[1], p3[2]); if (first) { ctx.moveTo(pp[0], pp[1]); first = false; } else ctx.lineTo(pp[0], pp[1]);
          }
          ctx.stroke(); ctx.shadowBlur = 0;
        }
        pts.forEach(function (q, i) {
          if (!visible(3 + i)) return;
          var x = q.x(scope), y = q.y(scope), z = q.z(scope); if (![x, y, z].every(isFinite)) return;
          var pp = P(x, y, z); ring(pp[0], pp[1], C.accent, 4.5); if (q.label) pill(fill(q.label), pp[0], pp[1] - 20);
        });
      };
    }

    function finish() {
      // A frame may run before it has a size, or while it is not painted (no ResizeObserver then): it also reports on load and a little later.
      var sent = 0, report = function () { var h = Math.ceil(Math.max(doc.body.scrollHeight, doc.body.getBoundingClientRect().height)); if (h > 0 && h !== sent) { sent = h; post({ height: h }); } };
      new win.ResizeObserver(report).observe(doc.body); report(); post({ ready: true });
      win.addEventListener('load', report); [120, 600, 1500].forEach(function (ms) { setTimeout(report, ms); });
      return { redraw: function () { draw(); } };
    }
  }

  // A color with an alpha, for canvas strokes and fills: #rgb, #rrggbb and rgb() are understood; anything else is used as it is.
  function alpha(c, a) {
    c = String(c).trim();
    var h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
    if (h) { var s = h[1].length === 3 ? h[1].replace(/./g, '$&$&') : h[1]; return 'rgba(' + parseInt(s.slice(0, 2), 16) + ',' + parseInt(s.slice(2, 4), 16) + ',' + parseInt(s.slice(4, 6), 16) + ',' + a + ')'; }
    var r = /^rgba?\(([^)]+)\)$/i.exec(c);
    if (r) { var p = r[1].split(',').slice(0, 3).join(','); return 'rgba(' + p + ',' + a + ')'; }
    return c;
  }
  function heat(t) { t = Math.max(0, Math.min(1, t)); var h = 220 - 200 * t; return 'hsl(' + h + ',80%,' + (52 - 8 * t) + '%)'; }
  function ticks(a, b, count) {
    var span = b - a, raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag, st = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = [];
    for (var v = Math.ceil(a / st) * st; v <= b + st * 1e-9; v += st) out.push(Math.abs(v) < st * 1e-9 ? 0 : v);
    return out;
  }
  function fmt(v) {
    if (!isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2).replace('e', '·10^');
    return String(Math.round(v * 1000) / 1000);
  }

  var api = { compile: compile, normalize: normalize, mount: mount, alpha: alpha, Named: Named, Kinds: Kinds, Parts: Parts, MaxCustom: MaxCustom };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SumitViz = api;
})(this);
