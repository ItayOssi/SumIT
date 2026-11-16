// SumIT 2.0: the emojis of the app are Fluent Emoji (Microsoft, MIT, vendor/emoji/LICENSE.txt), kept in the app so
// they look the same on macOS and on Windows. Flat in the text; 3D only for the big moments (the streak flame,
// a celebration, the greeting). An emoji not in the list stays as the system draws it.
const EMOJI = {
  '✨': 'sparkles', '🎯': 'target', '🔥': 'fire', '🧊': 'ice', '⚠️': 'warning', '⚠': 'warning', '🧭': 'compass',
  '📝': 'memo', '💡': 'bulb', '👋': 'wave', '🎉': 'party', '⚡': 'zap', '☕': 'coffee', '🌙': 'moon', '☀️': 'sun',
  '☀': 'sun', '📊': 'chart', '❓': 'question', '🎓': 'cap',
};
const EMOJI_3D = new Set(['sparkles', 'fire', 'ice', 'wave', 'party', 'coffee', 'cap', 'bulb', 'memo']);
const EMOJI_RE = new RegExp(Object.keys(EMOJI).sort((a, b) => b.length - a.length).join('|'), 'gu');
// One emoji as an <img>. The alt is the emoji itself, so copied text and screen readers still get it.
function emo(ch, big) {
  const n = EMOJI[ch]; if (!n) return esc(ch);
  const d3 = !!big && EMOJI_3D.has(n);
  return `<img class="emo${d3 ? ' emo-3d' : ''}" src="vendor/emoji/${d3 ? '3d/' + n + '.png' : 'flat/' + n + '.svg'}" alt="${ch}" draggable="false">`;
}
// Plain text with its emojis drawn: the text is escaped, only the emojis become HTML.
function emoHtml(text, big) { return esc(text).replace(EMOJI_RE, (ch) => emo(ch, big)); }
function setEmo(el, text, big) { if (el) el.innerHTML = emoHtml(text, big); }
