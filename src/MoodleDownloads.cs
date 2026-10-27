using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

// One button: the app goes through the course's Moodle page by itself and downloads what the student needs for the
// whole course - every past exam with its solutions, or the syllabus (which it then reads into the course information).
partial class HitStudent
{
    static readonly Regex ExamSectionName = new Regex("(מבחן|מבחנ|בחינ|מועד [אבג]|exam|midterm)", RegexOptions.IgnoreCase);
    static readonly string[] SkippedMods = { "forum", "quiz", "label", "choice", "feedback", "lti", "h5pactivity", "zoom" };
    readonly HashSet<string> moodleDownloading = new HashSet<string>();
    // The syllabus download keeps lectures, homework and exams out of the course information.
    static readonly Regex LectureName = new Regex(@"(הרצא|שקפים|מצגת|lecture|slides|tutorial|שיעור \d)", RegexOptions.IgnoreCase);
    static readonly Regex SyllabusTitle = new Regex("(סילבוס|סילאבוס|syllabus|course outline|תכנית הקורס|תוכנית הקורס)", RegexOptions.IgnoreCase);
    static readonly Regex[] SyllabusMarks = {
        new Regex("מטרות הקורס"), new Regex("דרישות (?:הקורס|קדם)"), new Regex("(?:מבנה|הרכב) הציון"), new Regex("ביבליוגרפיה|רשימת קריאה"), new Regex("נושאי הקורס"), new Regex("שעות קבלה"),
        new Regex("course objectives|learning outcomes", RegexOptions.IgnoreCase), new Regex("prerequisites", RegexOptions.IgnoreCase), new Regex("grading", RegexOptions.IgnoreCase), new Regex("bibliography", RegexOptions.IgnoreCase) };

    // A file named like a lecture, homework or exam (and not like a syllabus).
    internal static bool NotSyllabusName(string name)
    {
        name = name ?? "";
        return !SyllabusName.IsMatch(name) && (LectureName.IsMatch(name) || ExerciseName.IsMatch(name) || ExamName.IsMatch(name));
    }

    // Only the first pages count: a title like "סילבוס" with one syllabus part, or three syllabus parts.
    // A passing "כפי שמופיע בסילבוס" in homework is not enough.
    internal static bool LooksLikeSyllabus(string text)
    {
        string t = Regex.Replace(text ?? "", @"^=== .*\r?\n", "");
        if (t.Length > 8000) t = t.Substring(0, 8000);
        int marks = SyllabusMarks.Count(re => re.IsMatch(t));
        return (SyllabusTitle.IsMatch(t.Length > 3000 ? t.Substring(0, 3000) : t) && marks >= 1) || marks >= 3;
    }

    // Whether a downloaded file goes into the course information folder.
    async Task<bool> KeepForSyllabus(string file, string mod, bool discover)
    {
        string name = Path.GetFileName(file);
        if (SyllabusName.IsMatch(name)) return true;
        if (!discover && (mod == "resource" || mod == "file")) return true; // the item itself is named like a syllabus
        if (NotSyllabusName(name)) return false;
        if (mod != "resource" && mod != "file") return true; // reached through a link labelled like a syllabus
        return LooksLikeSyllabus(await ExtractTexts(new[] { file }));
    }

    // What belongs: for exams, everything in a section about exams and any item named like an exam; for the syllabus, items named like one.
    internal static List<Dictionary<string, object>> PickMoodleItems(List<Dictionary<string, object>> sections, string what)
    {
        var picked = new List<Dictionary<string, object>>();
        var urls = new HashSet<string>();
        foreach (var s in sections)
        {
            bool wholeSection = what == "exams" && ExamSectionName.IsMatch(Str(s, "title"));
            bool infoSection = what == "syllabus" && SyllabusName.IsMatch(Str(s, "title")) && Str(s, "title").Length < 40;
            foreach (Dictionary<string, object> it in (s.ContainsKey("items") ? s["items"] as ArrayList : null) ?? new ArrayList())
            {
                if (SkippedMods.Contains(Str(it, "mod")) || Str(it, "url").Length == 0) continue;
                string name = Str(it, "name");
                bool match = what == "exams" ? (wholeSection || ExamName.IsMatch(name)) : SyllabusName.IsMatch(name);
                bool container = new[] { "folder", "page", "url" }.Contains(Str(it, "mod")) || Regex.IsMatch(name + " " + Str(it, "url"), @"\.zip(?:$|[?\s])", RegexOptions.IgnoreCase);
                // In a "מידע על הקורס" section, an item not named like a syllabus still has its content checked.
                if ((match || container || infoSection) && urls.Add(Str(it, "url"))) {
                    var candidate = new Dictionary<string, object>(it); candidate["discoveryOnly"] = !match;
                    if (infoSection && !match) candidate["infoSection"] = true;
                    picked.Add(candidate);
                }
            }
        }
        return picked;
    }

    // A zip of past exams ("מבחנים משנים קודמות") is opened into the same folder: only documents, flat names, nothing outside the folder.
    // Returns how many files came out (the zip itself is then removed).
    static readonly string[] ZipKeep = { ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".txt", ".html", ".htm", ".xlsx" };
    int UnpackZip(string zipPath, string dest, string filter = null, int depth = 0, string context = "", ArchiveBudget budget = null)
    {
        if (!string.Equals(Path.GetExtension(zipPath), ".zip", StringComparison.OrdinalIgnoreCase) || depth > 3) return 0;
        budget = budget ?? new ArchiveBudget(); int n = 0;
        using (var za = System.IO.Compression.ZipFile.OpenRead(zipPath))
        foreach (var en in za.Entries)
        {
            if (++budget.Entries > 1000 || en.Length > 100L * 1024 * 1024 || (budget.Bytes += en.Length) > 300L * 1024 * 1024) throw new IOException("הארכיון גדול מדי לחילוץ אוטומטי");
            if (string.IsNullOrEmpty(en.Name)) continue;
            string ext = Path.GetExtension(en.Name).ToLowerInvariant();
            string label = context + " " + en.FullName;
            if (ext == ".zip") {
                string nested = Path.Combine(Path.GetTempPath(), "sumit-archive-" + Guid.NewGuid().ToString("N") + ".zip");
                try { using (var inp = en.Open()) using (var output = File.Create(nested)) inp.CopyTo(output); n += UnpackZip(nested, dest, filter, depth + 1, label, budget); }
                finally { if (File.Exists(nested)) File.Delete(nested); }
                continue;
            }
            if (!ZipKeep.Contains(ext) || (filter == "syllabus" && (!SyllabusName.IsMatch(label) || NotSyllabusName(en.Name))) || (filter == "exams" && !ExamName.IsMatch(label))) continue;
            // Flatten archive paths: traversal and absolute names never become output paths.
            string path = Path.Combine(dest, SafeName(en.FullName.Replace('\\', '_').Replace('/', '_')));
            Directory.CreateDirectory(dest);
            if (File.Exists(path) && new FileInfo(path).Length == en.Length) { n++; continue; }
            string tmp = path + ".part";
            using (var inp = en.Open()) using (var output = File.Create(tmp)) inp.CopyTo(output);
            File.Copy(tmp, path, true); File.Delete(tmp); n++;
        }
        return n;
    }
    class ArchiveBudget { public int Entries; public long Bytes; }

    async Task<List<string>> DiscoverMoodleFiles(HttpClient http, string url, string what)
    {
        var found = new HashSet<string>(); var visited = new HashSet<string>();
        var pending = new Queue<Tuple<string, int>>(); pending.Enqueue(Tuple.Create(url, 0));
        while (pending.Count > 0 && visited.Count < 60)
        {
            var next = pending.Dequeue(); if (!IsMoodleUrl(next.Item1) || !visited.Add(next.Item1)) continue;
            string html;
            try { html = await http.GetStringAsync(next.Item1); } catch { continue; }
            foreach (Match link in Regex.Matches(html, @"<a\b[^>]*href\s*=\s*['""]([^'""]+)['""][^>]*>([\s\S]*?)</a>", RegexOptions.IgnoreCase))
            {
                Uri target; if (!Uri.TryCreate(new Uri(next.Item1), System.Net.WebUtility.HtmlDecode(link.Groups[1].Value), out target) || !IsMoodleUrl(target.AbsoluteUri)) continue;
                string label = Uri.UnescapeDataString(target.AbsoluteUri) + " " + HtmlToText(link.Groups[2].Value);
                bool relevant = what == "exams" ? ExamName.IsMatch(label) : SyllabusName.IsMatch(label);
                bool archive = target.AbsolutePath.EndsWith(".zip", StringComparison.OrdinalIgnoreCase);
                if (target.AbsolutePath.Contains("pluginfile.php") && (relevant || archive)) found.Add(target.AbsoluteUri);
                else if (relevant && target.AbsolutePath.Contains("/mod/resource/view.php")) found.Add(target.AbsoluteUri + "&redirect=1");
                else if (next.Item2 < 3 && Regex.IsMatch(target.AbsolutePath, @"/mod/(folder|page|resource|url)/view\.php$") && !visited.Contains(target.AbsoluteUri)) pending.Enqueue(Tuple.Create(target.AbsoluteUri, next.Item2 + 1));
            }
        }
        return found.ToList();
    }

    // what = "exams" | "syllabus"
    async void DownloadFromMoodle(string course, int courseId, string what)
    {
        string key = what + "|" + course;
        if (!moodleDownloading.Add(key)) return;
        Send(new { type = "operationStatus", course = course, operation = what, busy = true });
        string label = what == "exams" ? "המבחנים והפתרונות" : "הסילבוס";
        Action<string, int?> status = (t, pct) => Send(new { type = "courseStatus", course = course, busy = true, text = t, pct = pct });
        int saved = 0, failed = 0;
        string discoveryRoot = null, discoveryDir = null;
        try
        {
            discoveryRoot = Path.Combine(CourseDir(course), SumitDir, "discovery");
            discoveryDir = Path.Combine(discoveryRoot, what);
            status("מחפש את " + label + " ב-Moodle...", 0);
            if (courseId <= 0) courseId = Int(LoadMeta(course), "courseId");
            if (courseId <= 0) { Send(new { type = "courseStatus", course = course, busy = false, text = "לא מצאתי את הקורס ב-Moodle. פתח אותו מהרשימה ונסה שוב", error = true }); return; }
            string v = await WithMoodle(() => EvalAsync(moodle, SectionsJs.Replace("COURSE_ID", courseId.ToString()), 120000));
            var sections = json.Deserialize<List<Dictionary<string, object>>>(v);

            var picked = PickMoodleItems(sections, what);
            foreach (var section in sections)
                foreach (Dictionary<string, object> item in (section.ContainsKey("items") ? section["items"] as ArrayList : null) ?? new ArrayList())
                    if (Str(item, "mod") == "resource" && !picked.Any(p => Str(p, "url") == Str(item, "url"))
                        && !(what == "syllabus" && NotSyllabusName(Str(item, "name")))) {
                        var candidate = new Dictionary<string, object>(item); candidate["discoveryOnly"] = true; picked.Add(candidate);
                    }
            // The syllabus itself first, so the 80-item cap never cuts it.
            if (what == "syllabus")
                picked = picked.OrderBy(p => !Bool(p, "discoveryOnly") ? 0 : Bool(p, "infoSection") ? 1 : Str(p, "mod") != "resource" ? 2 : 3).ToList();
            picked = picked.Take(80).ToList();
            if (picked.Count == 0)
            {
                Send(new { type = "courseStatus", course = course, busy = false, error = true,
                    text = what == "exams" ? "לא מצאתי ב-Moodle של הקורס מבחנים. אפשר להוסיף מ-CS24 או מהמחשב." : "לא מצאתי ב-Moodle של הקורס סילבוס. אפשר להוסיף אותו מהמחשב." });
                return;
            }

            string dest = Path.Combine(CourseDir(course), what == "exams" ? Exams : CourseInfoFolder);
            Directory.CreateDirectory(dest);
            using (var http = await MoodleHttp())
            {
                for (int i = 0; i < picked.Count; i++)
                {
                    var it = picked[i];
                    string mod = Str(it, "mod"), name = Str(it, "name"), url = Str(it, "url");
                    status("מוריד את " + label + " (" + (i + 1) + " מתוך " + picked.Count + "): " + Trunc(name, 60), (int)(100.0 * i / picked.Count));
                    try
                    {
                        if (!IsMoodleUrl(url)) continue;
                        bool discover = Bool(it, "discoveryOnly");
                        var urls = mod == "resource" ? new List<string> { url + (url.Contains("?") ? "&" : "?") + "redirect=1" }
                            : mod == "file" ? new List<string> { url }
                            : discover ? await DiscoverMoodleFiles(http, url, what) : await PluginFiles(http, url);
                        foreach (string f in urls.Distinct()) {
                            // Syllabus files are staged first and only what passes the checks reaches the course information.
                            string downloadDir = discover || what == "syllabus" ? discoveryDir : dest;
                            string path = await DownloadFile(http, f, downloadDir, true, discover ? 64L * 1024 * 1024 : 0); if (path == null) continue;
                            if (Path.GetExtension(path).Equals(".zip", StringComparison.OrdinalIgnoreCase)) saved += UnpackZip(path, dest, discover || what == "syllabus" ? what : null, 0, name + " " + Path.GetFileName(path));
                            else if (what == "syllabus") { if (await KeepForSyllabus(path, mod, discover)) { File.Copy(path, Path.Combine(dest, Path.GetFileName(path)), true); saved++; } }
                            else if (!discover) saved++;
                            else {
                                bool matches = ExamName.IsMatch(Path.GetFileName(path)) || (mod != "resource" && mod != "file");
                                if (matches) { File.Copy(path, Path.Combine(dest, Path.GetFileName(path)), true); saved++; }
                            }
                        }

                    }
                    catch (Exception ex) { failed++; Toast(Trunc(name, 40) + ": " + ex.Message, true); }
                }
            }
            Send(new { type = "courseStatus", course = course, busy = false, text = saved > 0 ? "ירדו " + saved + " קבצים: " + label + (failed > 0 ? " (" + failed + " נכשלו)" : "") : "לא ירד שום קובץ", error = saved == 0 });
            SendCourseLocal(course);
            // The syllabus is read straight away: one click does both.
            if (what == "syllabus" && saved > 0) await AnalyzeCourseAsync(course);
        }
        catch (Exception ex) { Send(new { type = "courseStatus", course = course, busy = false, text = ex.Message, error = true }); }
        finally {
            moodleDownloading.Remove(key);
            // Staged downloads (and loose files left by older versions) are not kept.
            try { if (discoveryDir != null && Directory.Exists(discoveryDir)) Directory.Delete(discoveryDir, true); } catch { }
            try { if (discoveryRoot != null && Directory.Exists(discoveryRoot)) foreach (string f in Directory.GetFiles(discoveryRoot)) try { File.Delete(f); } catch { } } catch { }
            Send(new { type = "operationStatus", course = course, operation = what, busy = false }); }
    }
}
