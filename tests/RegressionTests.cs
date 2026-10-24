using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows.Forms;
class RegressionTests
{
    [STAThread] static void Main() { HitStudent.RunOfflineRegressionTests(); }
}
partial class HitStudent
{
    public static void RunOfflineRegressionTests()
    {
        using (var app = new HitStudent(new[] { "--demo" }))
        {
            string root = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "regression-" + Guid.NewGuid().ToString("N"));
            app.settings["studyRoot"] = root;
            Action<string, bool> check = (label, ok) => { if (!ok) throw new Exception(label); Console.WriteLine("PASS: " + label); };
            check("updates default to consent", !app.Option("autoUpdate"));
            check("automatic downloads off", !app.Option("autoSync") && !app.Option("autoRecordings"));
            string course = "test-course";
            app.SaveLecture(course, new Dictionary<string, object> { { "num", 1 }, { "title", "Lecture 1" }, { "date", "2026-10-25" }, { "due", "" } });
            check("lecture persists", app.ManualLectures(course).Count == 1);
            string dir = app.LectureDir(course, 1);
            check("separate student lecture directory", dir.EndsWith(@"הרצאות\הרצאה 1"));
            check("homework directory", Directory.Exists(Path.Combine(dir, Exercises)));
            check("notebook directory", Directory.Exists(Path.Combine(dir, Notebook)));
            check("lecturer notes directory", Directory.Exists(Path.Combine(dir, LecturerNotes)));
            check("a lecture's files are routed to the right folder",
                HitStudent.LectureSubdir(dir, "", "slides.pdf") == Path.Combine(dir, LecturerNotes)
                && HitStudent.LectureSubdir(dir, "", "Sol_List_1.pdf") == Path.Combine(dir, Exercises)
                && HitStudent.LectureSubdir(dir, "notes", "my.pdf") == Path.Combine(dir, Notebook));
            check("summary lives in its own folder inside the lecture", app.StudyPagePath(course, 1) == Path.Combine(dir, SummaryName, SummaryHtmlName) && app.LecturePdfPath(course, 1) == Path.Combine(dir, SummaryName, SummaryPdfName));
            check("the interactive page and the PDF have different names", SummaryHtmlName != SummaryPdfName);
            check("a lecture's subfolders are valid save destinations", app.SafeDownloadFolder(@"הרצאות\הרצאה 1\תרגילים") == Path.Combine(LectureFolderName(1), Exercises)
                && app.SafeDownloadFolder(@"הרצאות\הרצאה 1\..") == SafeName(@"הרצאות\הרצאה 1\.."));
            check("default courses folder is HIT\\קורסים", HitStudent.DefaultStudyRootForTest().EndsWith(@"HIT\קורסים"));
            check("nested download destination", app.SafeDownloadFolder(@"הרצאות\הרצאה 1") == LectureFolderName(1));
            check("download traversal is flattened", !app.SafeDownloadFolder(@"..\..\outside").Contains("\\"));
            app.SaveLecture(course, new Dictionary<string, object> { { "num", 2 }, { "date", "2026-02-31" } });
            check("invalid dates do not create lecture", app.ManualLectures(course).Count == 1);
            app.SaveLecture(course, new Dictionary<string, object> { { "num", 2 }, { "title", "Lecture 2" } });
            File.WriteAllText(Path.Combine(dir, "source.txt"), "version one");
            string original = app.LectureFingerprint(course, 2);
            check("fingerprint stable", original == app.LectureFingerprint(course, 2));
            File.WriteAllText(Path.Combine(dir, "source.txt"), "version two");
            check("prior lecture edit invalidates later summary", original != app.LectureFingerprint(course, 2));
            string current = app.LectureFingerprint(course, 1);
            File.WriteAllText(Path.Combine(app.LectureDir(course, 2), "later.txt"), "future");
            check("future lecture excluded", current == app.LectureFingerprint(course, 1));
            Directory.CreateDirectory(Path.Combine(dir, SummaryName)); File.WriteAllText(Path.Combine(dir, SummaryName, SummaryPdfName), "generated"); File.WriteAllText(Path.Combine(dir, SummaryName, SummaryHtmlName), "generated");
            check("the summary files themselves do not change the fingerprint", current == app.LectureFingerprint(course, 1));
            File.WriteAllText(Path.Combine(dir, "unrelated.mp4"), "not a recording");
            var local = app.json.Deserialize<Dictionary<string,object>>(app.json.Serialize(app.LocalInfo(course, 1)));
            check("unrelated MP4 not listed as recording", Int(local, "videos") == 0);
            app.working = true; // Exercise queue construction without using Zoom or network.
            check("automatic recording refused", !app.QueueRecording(course, 1, "https://hit-ac-il.zoom.us/rec/play/test", false));
            check("manual recording accepted", app.QueueRecording(course, 1, "https://hit-ac-il.zoom.us/rec/play/test", true, "My lecture"));
            check("recording stored in current lecture", app.jobs.Last().Dir == Path.Combine(dir, RecordingFolder) && app.jobs.Last().Lecture == 1);
            check("custom file name retained", app.jobs.Last().Name == "My lecture");
            app.QueueRecording(course, 1, "https://hit-ac-il.zoom.us/rec/play/second", true, "My lecture");
            check("recording name collisions preserved", app.jobs.Last().Name == "My lecture (2)");
            // The course page of the lecturer: exams in an "exams" section (with solutions), formula sheets, a syllabus, a forum.
            var sections = app.json.Deserialize<List<Dictionary<string, object>>>("[{\"num\":0,\"title\":\"כללי\",\"items\":[{\"mod\":\"resource\",\"name\":\"סילבוס הקורס\",\"url\":\"u1\"},{\"mod\":\"forum\",\"name\":\"הודעות\",\"url\":\"u2\"}]},"
                + "{\"num\":3,\"title\":\"מבחנים לדוגמה\",\"items\":[{\"mod\":\"resource\",\"name\":\"מבחן 2023 מועד א\",\"url\":\"u3\"},{\"mod\":\"resource\",\"name\":\"פתרון\",\"url\":\"u4\"},{\"mod\":\"folder\",\"name\":\"עוד\",\"url\":\"u5\"}]},"
                + "{\"num\":4,\"title\":\"הרצאה 1\",\"items\":[{\"mod\":\"resource\",\"name\":\"שקפים\",\"url\":\"u6\"},{\"mod\":\"resource\",\"name\":\"מבחן אמצע 2022\",\"url\":\"u7\"}]}]");
            var exams = HitStudent.PickMoodleItems(sections, "exams");
            check("every item of the exams section is taken, with the solutions", exams.Select(i => Str(i, "url")).OrderBy(x => x).SequenceEqual(new[] { "u3", "u4", "u5", "u7" }));
            check("an exam named inside a lecture section is taken too, the slides are not", !exams.Any(i => Str(i, "url") == "u6"));
            var syllabus = HitStudent.PickMoodleItems(sections, "syllabus");
            check("only the syllabus is taken for the course information", syllabus.Count == 1 && Str(syllabus[0], "url") == "u1");
            RunHelperTests(app, root, check);
            RunBrainTests(app, root, check);
            Console.WriteLine("Offline regression checks complete. Fixtures: " + root);
        }
    }

    // The form installs a WinForms synchronization context, so awaits would wait for a message loop that is not running here.
    static T Run<T>(Func<System.Threading.Tasks.Task<T>> work) { return System.Threading.Tasks.Task.Run(work).GetAwaiter().GetResult(); }

    // Gemini / ChatGPT helpers against a fake local server: nothing here touches the internet or a real key.
    static void RunHelperTests(HitStudent app, string root, Action<string, bool> check)
    {
        var requests = new List<string>();
        var heads = new List<string>();
        int geminiStatus = 200;
        var listener = new System.Net.HttpListener();
        string baseUrl = "http://127.0.0.1:" + new Random().Next(20000, 40000) + "/";
        listener.Prefixes.Add(baseUrl);
        listener.Start();
        var serve = System.Threading.Tasks.Task.Run(() =>
        {
            while (listener.IsListening)
            {
                System.Net.HttpListenerContext c;
                try { c = listener.GetContext(); } catch { return; }
                string body = new StreamReader(c.Request.InputStream, System.Text.Encoding.UTF8).ReadToEnd();
                lock (requests) { requests.Add(c.Request.Url.AbsolutePath + " " + body); heads.Add((c.Request.Headers["x-goog-api-key"] ?? "") + "|" + (c.Request.Headers["Authorization"] ?? "")); }
                bool gem = c.Request.Url.AbsolutePath.Contains("generateContent");
                int status = gem ? geminiStatus : 200;
                string reply = status != 200 ? "{\"error\":{\"message\":\"quota\"}}"
                    : gem ? "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"תשובה מ-Gemini $x^2$\"}]}}]}"
                    : "{\"choices\":[{\"message\":{\"content\":\"תשובה מ-ChatGPT\"}}]}";
                byte[] bytes = System.Text.Encoding.UTF8.GetBytes(reply);
                c.Response.StatusCode = status; c.Response.ContentType = "application/json";
                c.Response.OutputStream.Write(bytes, 0, bytes.Length); c.Response.Close();
            }
        });
        Environment.SetEnvironmentVariable("SUMIT_GEMINI_URL", baseUrl.TrimEnd('/'));
        Environment.SetEnvironmentVariable("SUMIT_OPENAI_URL", baseUrl.TrimEnd('/'));
        try
        {
            check("no helper without a key", app.HelperOrder().Count == 0);
            app.settings["geminiKey"] = Protect(new string('g', 30)); app.settings["openaiKey"] = Protect(new string('o', 30));
            check("auto: Gemini first, then ChatGPT", string.Join(",", app.HelperOrder()) == "gemini,openai");
            app.settings["helperPref"] = "openai";
            check("the student can prefer ChatGPT", string.Join(",", app.HelperOrder()) == "openai,gemini");
            app.settings["helperPref"] = "claude";
            check("Claude only means no helpers", app.HelperOrder().Count == 0);
            app.settings["helperPref"] = "auto";

            var msgs = new List<Tuple<string, string>> { Tuple.Create("user", "מה זה אינטגרל?") };
            var r = Run(() => app.HelperAsk("system text", msgs));
            check("Gemini answers", !r.Error && r.Provider == "gemini" && r.Text.Contains("Gemini"));
            check("the key travels in a header and the system text and question in the body", heads[0].StartsWith(new string('g', 30)) && requests[0].Contains("system text") && requests[0].Contains("systemInstruction") && !requests[0].Contains(new string('g', 30)));
            geminiStatus = 429;
            r = Run(() => app.HelperAsk("system text", msgs));
            check("a limit on Gemini passes the question to ChatGPT", !r.Error && r.Provider == "openai" && r.Text.Contains("ChatGPT") && heads.Last().Contains("Bearer " + new string('o', 30)));
            geminiStatus = 200;

            // A lecture question is answered from the digests and the summary the app already has.
            string course = "helper-course";
            Directory.CreateDirectory(Path.Combine(app.CourseDir(course), SumitDir, "digests"));
            File.WriteAllText(Path.Combine(app.CourseDir(course), SumitDir, "digests", "הרצאה 1.md"), "DIGEST-ONE נוסחת רימן");
            check("nothing to read yet: the question goes to Claude", app.HelperContext("empty-course", "lesson:1") == null && app.HelperContext(course, "course") == null);
            check("a later lecture is built on the earlier digests", app.HelperContext(course, "lesson:3").Contains("DIGEST-ONE"));
            app.SaveLecture(course, new Dictionary<string, object> { { "num", 2 }, { "title", "L2" } });
            Directory.CreateDirectory(Path.GetDirectoryName(app.StudyPagePath(course, 2)));
            File.WriteAllText(app.StudyPagePath(course, 2), "<html><style>.x{}</style><body><h2>SECTION-TWO</h2><script>alert(1)</script><p>טקסט <b>חשוב</b> &amp; נוסחה $a+b$</p></body></html>");
            string ctx = app.HelperContext(course, "lesson:2");
            check("the context holds the earlier digest and the summary text, without markup", ctx != null && ctx.Contains("DIGEST-ONE") && ctx.Contains("SECTION-TWO") && ctx.Contains("חשוב") && ctx.Contains("$a+b$") && !ctx.Contains("<b>") && !ctx.Contains("alert(1)"));
            check("a later lecture is not mixed in", !app.HelperContext(course, "lesson:1").Contains("SECTION-TWO"));
            var said = new List<string>();
            bool answered = Run(() => app.HelperChat(course, "lesson:2", "תסביר לי", (role, t) => said.Add(role + ":" + t)));
            check("the chat is answered by a helper and remembered", answered && said.Count == 1 && said[0].StartsWith("assistant:") && app.LoadMeta(course).ContainsKey("lectureChatHistories"));
            check("the question reached the helper with the lecture's text", requests.Last().Contains("SECTION-TWO") && requests.Last().Contains("תסביר לי"));

            // A page read by a helper updates the timetable, the exams and the holidays.
            app.settings["studyRoot"] = Path.Combine(root, "courses");
            var data = app.json.Deserialize<Dictionary<string, object>>("{\"classes\":[{\"day\":\"ראשון\",\"start\":\"08:30\",\"end\":\"11:00\",\"course\":\"אינפי\"}],\"exams\":[{\"course\":\"אינפי\",\"moed\":\"א\",\"date\":\"2027-02-03\"}],\"semesterStart\":\"2026-10-18\",\"holidays\":[{\"name\":\"חנוכה\",\"from\":\"2026-12-06\",\"to\":\"2026-12-07\"}]}");
            app.ApplySchedule(data);
            var data2 = app.json.Deserialize<Dictionary<string, object>>("{\"classes\":[],\"exams\":[{\"course\":\"פיזיקה\",\"moed\":\"א\",\"date\":\"2027-02-10\"}],\"holidays\":[]}");
            app.ApplySchedule(data2);
            var tt = app.json.Deserialize<Dictionary<string, object>>(File.ReadAllText(app.TimetableJson));
            var ac = app.json.Deserialize<Dictionary<string, object>>(File.ReadAllText(app.AcademicJson));
            check("a second page keeps the classes and adds the exam", ((System.Collections.ArrayList)tt["classes"]).Count == 1 && ((System.Collections.ArrayList)tt["exams"]).Count == 2);
            check("the semester start and holidays are kept", Str(ac, "semesterStart") == "2026-10-18" && ((System.Collections.ArrayList)ac["holidays"]).Count == 1);
            check("JSON is found inside a code fence", JsonFromAnswer("```json\n{\"a\":1}\n```", app.json) != null && JsonFromAnswer("no json here", app.json) == null);
        }
        finally { listener.Stop(); Environment.SetEnvironmentVariable("SUMIT_GEMINI_URL", null); Environment.SetEnvironmentVariable("SUMIT_OPENAI_URL", null); }
    }

    // ChatGPT and Gemini on the student's subscription, with fake command-line tools that behave like the real ones.
    static void RunBrainTests(HitStudent app, string root, Action<string, bool> check)
    {
        string fakes = Path.Combine(root, "fakes");
        Directory.CreateDirectory(fakes);
        File.WriteAllText(Path.Combine(fakes, "fake.ps1"), @"[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$argline = $env:FAKE_ARGS
if ($argline -match 'login' -and $argline -match 'status') { 'Logged in using ChatGPT'; exit 0 }
if ($env:FAKE_LOGIN -eq '1') {
  Write-Host 'Opening authentication page in your browser. Do you want to continue? [Y/n]:'
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)   # like node: the input is UTF-8 (the app may put a byte-order mark in front)
  $line = [Console]::In.ReadLine()
  if ($line -and $line.Trim().TrimStart([char]0xFEFF) -eq 'Y') { Set-Content -Path $env:FAKE_LOGIN_FLAG -Value 'signed-in'; Write-Host 'https://accounts.example/login?x=1'; Start-Sleep 1 }
  exit 0
}
$text = [Console]::In.ReadToEnd()
if ($env:FAKE_FAIL -eq '1') { [Console]::Error.WriteLine('usage limit reached'); exit 1 }
if ($env:FAKE_REPLY) { $ans = $env:FAKE_REPLY } else { $ans = $env:FAKE_NAME + ' saw ' + $text.Length + ' chars; marker=' + ($text -match 'MARKER-Q') }
$m = [regex]::Match($argline, '\s-o\s+(\S+)')
if ($env:FAKE_NAME -eq 'codex' -and $m.Success) {
  $outFile = $m.Groups[1].Value.Trim('""')
  [System.IO.File]::WriteAllText($outFile, [string]$ans, (New-Object System.Text.UTF8Encoding($false)))
} else { $ans }
");
        foreach (string name in new[] { "codex", "gemini" })
            File.WriteAllText(Path.Combine(fakes, "fake-" + name + ".cmd"), "@echo off\r\nset FAKE_NAME=" + name + "\r\nset FAKE_ARGS=%*\r\npowershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0fake.ps1\"\r\n");
        Environment.SetEnvironmentVariable("SUMIT_CODEX", Path.Combine(fakes, "fake-codex.cmd"));
        Environment.SetEnvironmentVariable("SUMIT_GEMINI", Path.Combine(fakes, "fake-gemini.cmd"));
        try
        {
            // Nothing connected by key; both signed in by account.
            app.settings.Remove("geminiKey"); app.settings.Remove("openaiKey"); app.settings["helperPref"] = "auto";
            app.codexSignedIn = false; app.geminiSignedOverride = false;
            check("not signed in: no helper", app.HelperOrder().Count == 0);
            app.codexSignedIn = true; app.geminiSignedOverride = true;
            check("signed in with the accounts: both helpers, Gemini first", string.Join(",", app.HelperOrder()) == "gemini,openai" && app.HelperMode("gemini") == "account" && app.HelperMode("openai") == "account");

            var msgs = new List<Tuple<string, string>> { Tuple.Create("user", "MARKER-Q " + new string('x', 120000)) };
            var r = Run(() => app.HelperAsk("system", msgs));
            check("Gemini answers through the account, a long text goes in on stdin", !r.Error && r.Provider == "gemini" && r.Text.Contains("gemini saw") && r.Text.Contains("marker=True") && !r.Text.Contains("saw 0 "));
            r = Run(() => app.HelperAsk("system", msgs, "openai"));
            check("ChatGPT answers through the account", !r.Error && r.Provider == "openai" && r.Text.Contains("codex saw") && r.Text.Contains("marker=True"));

            Environment.SetEnvironmentVariable("FAKE_FAIL", "1");
            r = Run(() => app.HelperAsk("system", msgs));
            check("a limit on the subscription is reported as a limit", r.Error && r.Limit);
            Environment.SetEnvironmentVariable("FAKE_FAIL", null);

            // The sign-in: the tool asks "[Y/n]", the app answers, the browser would open, the account is signed in.
            string flag = Path.Combine(fakes, "signed.txt");
            Environment.SetEnvironmentVariable("FAKE_LOGIN", "1"); Environment.SetEnvironmentVariable("FAKE_LOGIN_FLAG", flag);
            Run(async () => { await app.RunLogin(Path.Combine(fakes, "fake-gemini.cmd"), "-p hello", "gemini", () => File.Exists(flag), true); return 0; });
            check("the sign-in is answered by the app", File.Exists(flag));
            Environment.SetEnvironmentVariable("FAKE_LOGIN", null);

            // A second opinion on a lecture summary: the notes are added to the page, and a repeat replaces them.
            string course = "review-course";
            app.SaveLecture(course, new Dictionary<string, object> { { "num", 1 }, { "title", "L1" } });
            Directory.CreateDirectory(Path.GetDirectoryName(app.StudyPagePath(course, 1)));
            File.WriteAllText(app.StudyPagePath(course, 1), "<html><body><h1>סיכום</h1><p>שאלה 2: התשובה היא 5</p></body></html>");
            Environment.SetEnvironmentVariable("FAKE_REPLY", "{\"verdict\":\"issues\",\"issues\":[{\"where\":\"שאלה 2\",\"problem\":\"החישוב שגוי\",\"fix\":\"התשובה היא 7\"}]}");
            string note = Run(() => app.SecondOpinion(course, 1));
            string html = File.ReadAllText(app.StudyPagePath(course, 1));
            check("a second AI's notes are added to the summary", note != null && note.Contains("הערות") && html.Contains("id=\"second-opinion\"") && html.Contains("החישוב שגוי") && html.Contains("התשובה היא 7") && html.Contains("<h1>סיכום</h1>"));
            Environment.SetEnvironmentVariable("FAKE_REPLY", "{\"verdict\":\"ok\",\"issues\":[]}");
            note = Run(() => app.SecondOpinion(course, 1));
            html = File.ReadAllText(app.StudyPagePath(course, 1));
            check("a repeated check replaces the notes, and a clean one says so", note.Contains("לא מצא טעויות") && System.Text.RegularExpressions.Regex.Matches(html, "id=\"second-opinion\"").Count == 1 && !html.Contains("החישוב שגוי") && html.Contains("לא נמצאו טעויות"));
            Environment.SetEnvironmentVariable("FAKE_REPLY", null);
            app.codexSignedIn = false; app.geminiSignedOverride = false;
            check("with no other AI the check is skipped", Run(() => app.SecondOpinion(course, 1)) == null);

            // The real thing, when asked for: a tiny question through the ChatGPT subscription that is signed in on this PC.
            string realCodex = Environment.GetEnvironmentVariable("SUMIT_REAL_CODEX");
            if (!string.IsNullOrEmpty(realCodex) && File.Exists(realCodex))
            {
                Environment.SetEnvironmentVariable("SUMIT_CODEX", realCodex);
                Run(() => { var t = app.RefreshBrains(); return t.ContinueWith(_ => 0); });
                check("REAL: ChatGPT is signed in on this PC", app.codexSignedIn);
                var real = Run(() => app.HelperCallCli("openai", "Answer with one word.", new List<Tuple<string, string>> { Tuple.Create("user", "Reply with exactly one word: ok") }));
                check("REAL: ChatGPT answers through the subscription", !real.Error && real.Text.ToLowerInvariant().Contains("ok"));
            }
        }
        finally
        {
            foreach (string v in new[] { "SUMIT_CODEX", "SUMIT_GEMINI", "FAKE_FAIL", "FAKE_REPLY", "FAKE_LOGIN", "FAKE_LOGIN_FLAG" }) Environment.SetEnvironmentVariable(v, null);
        }
    }
}
