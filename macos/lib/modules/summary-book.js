'use strict';
// Port of src/SummaryBook.cs

const fs = require('fs');
const path = require('path');
const { fileExists, mkdirp, readText, writeText } = require('../util');
const platform = require('../platform');

const SummaryFonts = ['assistant', 'rubik'];   // the folders in web/vendor/fonts that study-book.css uses
// The Fluent emojis that study-book.css draws (web/vendor/emoji/flat), and their license.
const SummaryEmoji = ['target', 'book', 'pencil', 'bulb', 'cap', 'warning', 'compass', 'zap', 'memo', 'sparkles', 'sun', 'moon'];

module.exports = {
  methods: {
    AddBookLayout(page) {
      try {
        if (!fileExists(page)) return;
        const dir = path.join(path.dirname(page), '.sumit-math');
        mkdirp(dir);
        for (const f of ['study-book.js', 'study-book.css', 'study-diagrams.js']) {
          fs.copyFileSync(path.join(platform.WebDir, f), path.join(dir, f));
        }
        // The fonts that study-book.css names (Assistant and Rubik), next to it, so the page needs no network.
        for (const font of SummaryFonts) {
          const from = path.join(platform.WebDir, 'vendor', 'fonts', font), to = path.join(dir, 'fonts', font);
          if (!fs.existsSync(from)) continue;
          mkdirp(to);
          for (const f of fs.readdirSync(from)) {
            const src = path.join(from, f), dest = path.join(to, f);
            try { if (!fileExists(dest) || fs.statSync(dest).size !== fs.statSync(src).size) fs.copyFileSync(src, dest); } catch { }
          }
        }
        // The emojis of the menu and the titles (SumIT 2.0), next to the style that names them.
        const emojiDir = path.join(dir, 'emoji'); mkdirp(emojiDir);
        for (const f of SummaryEmoji.map(n => path.join('flat', n + '.svg')).concat(['LICENSE.txt'])) {
          const src = path.join(platform.WebDir, 'vendor', 'emoji', f), dest = path.join(emojiDir, path.basename(f));
          try { if (fileExists(src) && (!fileExists(dest) || fs.statSync(dest).size !== fs.statSync(src).size)) fs.copyFileSync(src, dest); } catch { }
        }
        let html = readText(page);
        const orig = html;
        html = html.replace(/<style id="sumit-book">[\s\S]*?<\/style>/g, '');
        html = html.replace(/<script id="sumit-book-js">[\s\S]*?<\/script>/g, '');
        if (!html.includes('data-sumit-book')) {
          const tags = '<link rel="stylesheet" href=".sumit-math/study-book.css" data-sumit-book><script defer src=".sumit-math/study-book.js" data-sumit-book></script>';
          const h = html.toLowerCase().lastIndexOf('</head>');
          html = h >= 0 ? html.slice(0, h) + tags + html.slice(h) : tags + html;
        }
        if (!html.includes('data-sumit-diagrams')) {
          const diagrams = '<script defer src=".sumit-math/study-diagrams.js" data-sumit-diagrams></script>';
          const end = html.toLowerCase().lastIndexOf('</head>');
          html = end >= 0 ? html.slice(0, end) + diagrams + html.slice(end) : diagrams + html;
        }
        if (html !== orig) writeText(page, html);
      } catch { }
    },
  },
};
