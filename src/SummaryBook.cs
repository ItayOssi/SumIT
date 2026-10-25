using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

// A finished study page becomes a small book (see web\study-book.js): the pages are on the right, the homework is grouped by question.
// The script and the style sit next to the page and are refreshed each time it is opened, so an improvement reaches the pages made before.
partial class HitStudent
{
    internal void AddBookLayout(string page)
    {
        try
        {
            if (!File.Exists(page)) return;
            string dir = Path.Combine(Path.GetDirectoryName(page), ".sumit-math");
            Directory.CreateDirectory(dir);
            foreach (string f in new[] { "study-book.js", "study-book.css" }) File.Copy(Path.Combine(WebDir, f), Path.Combine(dir, f), true);
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
            if (html != orig) File.WriteAllText(page, html, new UTF8Encoding(false));
        }
        catch { }
    }
}