// A limited-time opening: until the date below, the splash is a painted poster of student life that loads in panel by
// panel (original SumIT art in images/poster/), with the title landing over the middle. After it, the usual splash.
// Runs right after the splash markup, before the first paint.
(function () {
  const UNTIL = new Date(2026, 11, 1); // shown until 1 December 2026, local time
  const splash = document.getElementById('splash');
  if (!splash || new Date() >= UNTIL) return;
  const panels = [
    ['a', 1, '50% 8%'], ['b', 2, '50% 4%'], ['h', 8, '50% 15%'], ['e', 6, '50% 60%'],
    ['f', 3, '45% 50%'], ['g', 7, '50% 55%'], ['c', 4, '50% 30%'], ['d', 5, '50% 45%'],
  ];
  const art = document.createElement('div');
  art.className = 'poster-art';
  art.setAttribute('aria-hidden', 'true');
  art.innerHTML = '<div class="poster-grid">' + panels.map(([area, n, pos], i) =>
    `<div class="pp pp-${area}" style="animation-delay:${(0.1 + i * 0.22).toFixed(2)}s"><img src="images/poster/p${n}.jpg" alt="" style="object-position:${pos}"></div>`).join('') +
    '</div><div class="poster-title"><div class="poster-mark"><img class="poster-logo" src="images/brand.png" alt="">' +
    '<img class="poster-word" src="images/poster/sumit-word.png" alt="SumIT"><small class="poster-sub">סמסטר א׳ · מהדורה מוגבלת</small></div></div>';
  splash.prepend(art);
  document.body.classList.add('poster-splash');
})();
