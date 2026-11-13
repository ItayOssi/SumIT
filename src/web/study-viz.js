// "המחשה חזותית" (macOS): a button on each homework question of a summary. The host adds this script to the page it shows (it is
// not written into the summary file), answers with a ready-made frame (srcdoc), and the frame is sandboxed: scripts only, no
// same-origin, no network. It sits inside the question, so it moves with the question when study-book.js pins it beside the text.
(function () {
  'use strict';
  if (window.sumitVizLoaded) return;
  window.sumitVizLoaded = true;
  // preload-site.js gives window.sumitBridge; window.chrome.webview is not there in Electron (it already has its own window.chrome).
  var token = window.sumitVizToken, bridge = window.sumitBridge || (window.chrome && window.chrome.webview);
  if (!token || !bridge) return;
  var boxes = {}, seq = 0;
  var GuardMs = 6000, MaxQuestion = 4000, MaxHeight = 1600;

  var style = document.createElement('style');
  style.textContent = [
    '.sumit-viz{--sv-accent:var(--accent,#4f6bff);--sv-accent2:#8b5cf6;--sv-line:var(--line,#e2dfd6);--sv-surface:var(--surface,#fff);--sv-surface2:var(--surface2,#f4f3ef);--sv-text:var(--text,#1d1d1f);--sv-muted:var(--muted,#6b6a66);margin:16px 0 6px}',
    '.sumit-viz-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
    '.sumit-viz-go{display:inline-flex;align-items:center;gap:10px;padding:8px 16px 8px 14px;border:0;border-radius:999px;cursor:pointer;color:#fff;font:inherit;font-size:14.5px;font-weight:650;',
    'background:linear-gradient(135deg,var(--sv-accent),var(--sv-accent2));box-shadow:0 6px 16px -6px color-mix(in srgb,var(--sv-accent) 70%,transparent);transition:transform .15s,box-shadow .15s,filter .15s}',
    '.sumit-viz-go:hover{transform:translateY(-1px);box-shadow:0 10px 22px -8px color-mix(in srgb,var(--sv-accent) 75%,transparent)}',
    '.sumit-viz-go:active{transform:none}.sumit-viz-go:disabled{cursor:default;filter:saturate(.6) opacity(.75);transform:none}',
    '.sumit-viz-go .sv-ico{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,.22);font-size:13px}',
    '.sumit-viz-go small{font-weight:500;opacity:.85;font-size:12px}',
    '.sumit-viz-status{font-size:12.5px;color:var(--sv-muted)}',
    '.sumit-viz-error{display:flex;align-items:center;gap:10px;margin-top:10px;padding:10px 14px;border-radius:12px;font-size:13.5px;',
    'background:var(--err-soft,#fbe4e7);color:var(--err,#b42335);border:1px solid color-mix(in srgb,var(--err,#b42335) 25%,transparent)}',
    '.sumit-viz [hidden]{display:none!important}',
    '.sumit-viz-card{margin-top:12px;border-radius:18px;overflow:hidden;background:var(--sv-surface);border:1px solid var(--sv-line);',
    'box-shadow:0 1px 2px rgba(20,30,60,.05),0 12px 30px -12px rgba(20,30,60,.22);animation:svIn .3s ease-out}',
    '@keyframes svIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
    '.sumit-viz-head{display:flex;align-items:center;gap:8px;padding:9px 12px 9px 10px;border-bottom:1px solid var(--sv-line);',
    'background:linear-gradient(90deg,color-mix(in srgb,var(--sv-accent) 7%,var(--sv-surface)),var(--sv-surface))}',
    '.sumit-viz-head b{font-size:13.5px;margin-inline-end:auto}',
    '.sumit-viz-chip{font-size:11.5px;padding:2px 9px;border-radius:999px;color:var(--sv-accent);background:color-mix(in srgb,var(--sv-accent) 12%,transparent)}',
    '.sumit-viz-act{font:inherit;font-size:12.5px;padding:4px 10px;border-radius:999px;border:1px solid var(--sv-line);background:var(--sv-surface);color:var(--sv-text);cursor:pointer;transition:background .15s}',
    '.sumit-viz-act:hover{background:var(--sv-surface2)}.sumit-viz-act:disabled{opacity:.5;cursor:default}',
    '.sumit-viz-card iframe{display:block;width:100%;height:420px;border:0;background:var(--sv-surface);transition:height .25s ease}',
    '.sumit-viz-skeleton{padding:16px}',
    '.sumit-viz-skeleton i{display:block;border-radius:12px;margin-bottom:10px;background:linear-gradient(90deg,var(--sv-surface2) 0%,color-mix(in srgb,var(--sv-accent) 10%,var(--sv-surface2)) 50%,var(--sv-surface2) 100%);',
    'background-size:200% 100%;animation:svShimmer 1.3s linear infinite}',
    '.sumit-viz-skeleton i:nth-child(1){height:22px;width:45%}.sumit-viz-skeleton i:nth-child(2){height:220px}.sumit-viz-skeleton i:nth-child(3){height:14px;width:70%}',
    '.sumit-viz-skeleton p{margin:4px 0 0;color:var(--sv-muted);font-size:13px}',
    '@keyframes svShimmer{from{background-position:200% 0}to{background-position:-200% 0}}',
    '.sumit-viz-spin{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-inline-end-color:transparent;border-radius:50%;animation:svSpin .8s linear infinite}',
    '@keyframes svSpin{to{transform:rotate(360deg)}}',
    '@media (prefers-reduced-motion:reduce){.sumit-viz-card,.sumit-viz-skeleton i,.sumit-viz-spin{animation:none}}',
    '@media print{.sumit-viz{display:none!important}}',
  ].join('');
  document.head.appendChild(style);

  // Light or dark as the page really looks: the background color of the body (the page may follow the system or the student's choice).
  function theme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(document.body).backgroundColor || '');
    if (m && (m[4] === undefined || +m[4] > 0.5)) return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) < 128 ? 'dark' : 'light';
    return 'light';
  }

  // The question as text for the AI: the math as its TeX, without this button's own words or the diagrams' drawing code.
  function questionText(details) {
    var c = details.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('.sumit-viz,script,style,svg,.diagram-legend,button'), function (e) { e.remove(); });
    Array.prototype.forEach.call(c.querySelectorAll('.katex'), function (k) {
      var a = k.querySelector('annotation[encoding="application/x-tex"]');
      k.replaceWith(document.createTextNode(a ? ' $' + a.textContent.trim() + '$ ' : k.textContent));
    });
    Array.prototype.forEach.call(c.querySelectorAll('p,li,div,br,h1,h2,h3,h4,h5,tr,summary,pre'), function (e) { e.appendChild(document.createTextNode('\n')); });
    var group = details.closest('.qgroup'), head = group && group.querySelector('.qghead');
    var t = (head ? head.textContent.replace('לא לעשות עדיין', '').trim() + '\n' : '') + c.textContent;
    return t.replace(/[ \t ]+/g, ' ').replace(/ *\n[\s]*/g, '\n').trim().slice(0, MaxQuestion);
  }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function goLabel(box, text, sub, busy) {
    box.go.textContent = '';
    var ico = el('span', 'sv-ico'); if (busy) ico.appendChild(el('span', 'sumit-viz-spin')); else ico.textContent = '✨';
    box.go.appendChild(ico); box.go.appendChild(el('span', '', text));
    if (sub) box.go.appendChild(el('small', '', sub));
  }

  function setState(box, state, text) {
    box.state = state;
    box.error.hidden = state !== 'error';
    box.skeleton.hidden = state !== 'busy';
    box.card.hidden = !(state === 'busy' || state === 'shown');
    box.go.hidden = state === 'shown';
    box.go.disabled = state === 'busy';
    box.again.disabled = state === 'busy';
    if (state === 'busy') goLabel(box, text || 'בונה המחשה…', '', true);
    else if (state === 'idle' && box.srcdoc) goLabel(box, 'הצג את ההמחשה', '');
    else goLabel(box, 'המחשה חזותית', 'גרף, מעגל או מרחב שאפשר להזיז');
    if (state === 'error') { box.errorText.textContent = text || 'לא הצלחתי לבנות המחשה.'; }
  }

  function request(box, force) {
    removeFrame(box);
    box.chip.textContent = '';
    setState(box, 'busy');
    bridge.postMessage({ type: 'vizRequest', token: token, id: box.id, question: questionText(box.details), force: !!force });
  }

  function removeFrame(box) {
    if (box.guard) { clearTimeout(box.guard); box.guard = null; }
    if (box.frame) { box.frame.remove(); box.frame = null; }
  }

  function showFrame(box, srcdoc) {
    removeFrame(box);
    box.srcdoc = srcdoc;
    var f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('title', 'המחשה חזותית');
    f.srcdoc = theme() === 'dark' ? srcdoc.replace('data-theme="light"', 'data-theme="dark"') : srcdoc;
    if (box.height) f.style.height = box.height + 'px';
    box.frame = f; box.card.appendChild(f);
    setState(box, 'shown');
    box.guard = setTimeout(function () {
      removeFrame(box);
      setState(box, 'error', 'ההמחשה לא נטענה. אפשר לבנות אותה מחדש.');
    }, GuardMs);
  }

  function add(details) {
    if (details.querySelector(':scope > .sumit-viz')) return;
    var id = 'v' + (++seq), root = el('div', 'sumit-viz'); root.dir = 'rtl';
    var bar = el('div', 'sumit-viz-bar'), go = el('button', 'sumit-viz-go'); go.type = 'button';
    var status = el('span', 'sumit-viz-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    bar.appendChild(go); bar.appendChild(status);
    var error = el('div', 'sumit-viz-error'), errorText = el('span'), retry = el('button', 'sumit-viz-act', 'נסה שוב'); retry.type = 'button';
    error.appendChild(el('span', '', '⚠️')); error.appendChild(errorText); error.appendChild(retry); errorText.style.marginInlineEnd = 'auto';
    var card = el('div', 'sumit-viz-card'), head = el('div', 'sumit-viz-head'), chip = el('span', 'sumit-viz-chip');
    var again = el('button', 'sumit-viz-act', '↻ בנה מחדש'), hide = el('button', 'sumit-viz-act', '✕ הסתר'); again.type = hide.type = 'button';
    head.appendChild(el('b', '', '🔬 המחשה חזותית')); head.appendChild(chip); head.appendChild(again); head.appendChild(hide);
    var skeleton = el('div', 'sumit-viz-skeleton'); skeleton.appendChild(el('i')); skeleton.appendChild(el('i')); skeleton.appendChild(el('i')); skeleton.appendChild(el('p', '', 'ה-AI קורא את השאלה ובונה המחשה שאפשר להזיז…'));
    card.appendChild(head); card.appendChild(skeleton);
    root.appendChild(bar); root.appendChild(error); root.appendChild(card);
    details.appendChild(root);
    var box = { id: id, details: details, root: root, go: go, status: status, error: error, errorText: errorText, card: card, chip: chip, again: again, skeleton: skeleton, frame: null, guard: null, srcdoc: '', height: 0, state: 'idle' };
    boxes[id] = box;
    setState(box, 'idle');
    go.onclick = function () { if (box.srcdoc) showFrame(box, box.srcdoc); else request(box, false); };
    retry.onclick = function () { request(box, !!box.srcdoc); };
    again.onclick = function () { request(box, true); };
    hide.onclick = function () { removeFrame(box); setState(box, 'idle'); };
  }

  function scan() {
    var qs = document.querySelectorAll('details.q');
    if (!qs.length) qs = Array.prototype.filter.call(document.querySelectorAll('details'), function (d) { var s = d.querySelector('summary'); return s && /שאלה\s*\d/.test(s.textContent); });
    Array.prototype.forEach.call(qs, add);
  }

  // From the host: the visual's state for one button.
  bridge.addEventListener('message', function (ev) {
    var m = ev && ev.data;
    if (!m || m.type !== 'vizState' || m.token !== token) return;
    var box = boxes[m.id];
    if (!box) return;
    if (m.state === 'busy') { setState(box, 'busy', m.text); return; }
    if (m.state === 'error') { setState(box, 'error', m.text); return; }
    if (m.state === 'done' && typeof m.srcdoc === 'string') {
      box.chip.textContent = m.cached ? 'נשמרה מהפעם הקודמת' : (m.provider ? 'נבנתה עם ' + m.provider : '');
      box.chip.hidden = !box.chip.textContent;
      showFrame(box, m.srcdoc);
    }
  });

  // From a frame: its height, and that it came up. Only from one of our frames, found by its window.
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.sumitViz !== true) return;
    for (var k in boxes) {
      var box = boxes[k];
      if (!box.frame || box.frame.contentWindow !== ev.source) continue;
      if (d.ready && box.guard) { clearTimeout(box.guard); box.guard = null; }
      if (isFinite(d.height) && d.height > 0) { box.height = Math.min(MaxHeight, Math.max(140, Math.round(d.height) + 2)); box.frame.style.height = box.height + 'px'; }
      return;
    }
  });

  // The student switches light and dark on the page: the open visuals follow.
  new MutationObserver(function () {
    for (var k in boxes) if (boxes[k].frame && boxes[k].srcdoc) showFrame(boxes[k], boxes[k].srcdoc);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  scan();
})();
