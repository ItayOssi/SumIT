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
    static readonly Regex ExamSectionName = new Regex("(מבחנ|בחינ|מועד [אבג]|exam|midterm)", RegexOptions.IgnoreCase);
    static readonly string[] SkippedMods = { "forum", "quiz", "label", "choice", "feedback", "lti", "h5pactivity", "zoom", "url" };
    readonly HashSet<string> moodleDownloading = new HashSet<string>();

    // What belongs: for exams, everything in a section about exams and any item named like an exam; for the syllabus, items named like one.
    internal static List<Dictionary<string, object>> PickMoodleItems(List<Dictionary<string, object>> sections, string what)
    {
        var picked = new List<Dictionary<string, object>>();
        foreach (var s in sections)
        {
            bool wholeSection = what == "exams" && ExamSectionName.IsMatch(Str(s, "title"));
            foreach (Dictionary<string, object> it in (s.ContainsKey("items") ? s["items"] as ArrayList : null) ?? new ArrayList())
            {
                if (SkippedMods.Contains(Str(it, "mod")) || Str(it, "url").Length == 0) continue;
                string name = Str(it, "name");
                bool match = what == "exams" ? (wholeSection || ExamName.IsMatch(name)) : (SyllabusName.IsMatch(name) || (SyllabusName.IsMatch(Str(s, "title")) && Str(s, "title").Length < 40));
                if (match) picked.Add(it);
            }
        }
        return picked;
    }

    // what = "exams" | "syllabus"
    async void DownloadFromMoodle(string course, int courseId, string what)
    {
        string key = what + "|" + course;
        if (!moodleDownloading.Add(key)) return;
        string label = what == "exams" ? "המבחנים והפתרונות" : "הסילבוס";
        Action<string, int?> status = (t, pct) => Send(new { type = "courseStatus", course = course, busy = true, text = t, pct = pct });
        int saved = 0, failed = 0;
        try
        {
            status("מחפש את " + label + " ב-Moodle...", 0);
            if (courseId <= 0) courseId = Int(LoadMeta(course), "courseId");
            if (courseId <= 0) { Send(new { type = "courseStatus", course = course, busy = false, text = "לא מצאתי את הקורס ב-Moodle. פתח אותו מהרשימה ונסה שוב", error = true }); return; }
            string v = await WithMoodle(() => EvalAsync(moodle, SectionsJs.Replace("COURSE_ID", courseId.ToString()), 120000));
            var sections = json.Deserialize<List<Dictionary<string, object>>>(v);

            var picked = PickMoodleItems(sections, what);
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
                        if (mod == "resource") { if (await DownloadFile(http, url + (url.Contains("?") ? "&" : "?") + "redirect=1", dest, true) != null) saved++; }
                        else if (mod == "file") { if (await DownloadFile(http, url, dest, true) != null) saved++; }
                        else foreach (string f in await PluginFiles(http, url)) if (await DownloadFile(http, f, dest, true) != null) saved++;
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
        finally { moodleDownloading.Remove(key); }
    }
}
