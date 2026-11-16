using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

// A finished study page becomes a small book (see web\study-book.js): the pages are on the right, the homework is grouped by question.
// The script and the style sit next to the page and are refreshed each time it is opened, so an improvement reaches the pages made before.
partial class HitStudent
{
    // The folders in web\vendor\fonts that study-book.css uses.
    internal static readonly string[] SummaryFonts = { "assistant", "rubik" };
    // The Fluent emojis that study-book.css draws (web/vendor/emoji/flat), and their license.
    internal static readonly string[] SummaryEmoji = { "target", "book", "pencil", "bulb", "cap", "warning", "compass", "zap", "memo", "sparkles", "sun", "moon" };

    internal void AddBookLayout(string page)
    {
        try
        {
            if (!File.Exists(page)) return;
            string dir = Path.Combine(Path.GetDirectoryName(page), ".sumit-math");
            Directory.CreateDirectory(dir);
            foreach (string f in new[] { "study-book.js", "study-book.css", "study-diagrams.js" }) File.Copy(Path.Combine(WebDir, f), Path.Combine(dir, f), true);
            // The fonts that study-book.css names (Assistant and Rubik), next to it, so the page needs no network.
            foreach (string font in SummaryFonts)
            {
                string from = Path.Combine(WebDir, "vendor", "fonts", font), to = Path.Combine(dir, "fonts", font);
                if (!Directory.Exists(from)) continue;
                Directory.CreateDirectory(to);
                foreach (string src in Directory.GetFiles(from))
                {
                    string dest = Path.Combine(to, Path.GetFileName(src));
                    try { if (!File.Exists(dest) || new FileInfo(dest).Length != new FileInfo(src).Length) File.Copy(src, dest, true); } catch { }
                }
            }
            // The emojis of the menu and the titles (SumIT 2.0), next to the style that names them.
            string emojiDir = Path.Combine(dir, "emoji");
            Directory.CreateDirectory(emojiDir);
            foreach (string f in SummaryEmoji.Select(n => Path.Combine("flat", n + ".svg")).Concat(new[] { "LICENSE.txt" }))
            {
                string src = Path.Combine(WebDir, "vendor", "emoji", f), dest = Path.Combine(emojiDir, Path.GetFileName(f));
                try { if (File.Exists(src) && (!File.Exists(dest) || new FileInfo(dest).Length != new FileInfo(src).Length)) File.Copy(src, dest, true); } catch { }
            }
            string html = File.ReadAllText(page, Encoding.UTF8), orig = html;
            // The first version of the book was written into the page itself.
            html = Regex.Replace(html, "<style id=\"sumit-book\">.*?</style>", "", RegexOptions.Singleline);
            html = Regex.Replace(html, "<script id=\"sumit-book-js\">.*?</script>", "", RegexOptions.Singleline);
            if (html.IndexOf("data-sumit-book", StringComparison.Ordinal) < 0)
            {
                const string tags = "<link rel=\"stylesheet\" href=\".sumit-math/study-book.css\" data-sumit-book><script defer src=\".sumit-math/study-book.js\" data-sumit-book></script>";
                int h = html.LastIndexOf("</head>", StringComparison.OrdinalIgnoreCase);
                html = h >= 0 ? html.Insert(h, tags) : tags + html;
            }
            if (!html.Contains("data-sumit-diagrams")) {
                const string diagrams = "<script defer src=\".sumit-math/study-diagrams.js\" data-sumit-diagrams></script>";
                int end = html.LastIndexOf("</head>", StringComparison.OrdinalIgnoreCase);
                html = end >= 0 ? html.Insert(end, diagrams) : diagrams + html;
            }
            if (html != orig) File.WriteAllText(page, html, new UTF8Encoding(false));
        }
        catch { }
    }
}