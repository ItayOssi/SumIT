using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

// Small helpers shared by the rest of the app (C# 5: no "using static", so they live on the form class).
partial class HitStudent
{
    public static string Str(Dictionary<string, object> d, string key)
    {
        object v;
        return d != null && d.TryGetValue(key, out v) && v != null ? v.ToString() : "";
    }

    public static bool Bool(Dictionary<string, object> d, string key)
    {
        object v;
        return d != null && d.TryGetValue(key, out v) && v is bool && (bool)v;
    }

    public static int Int(Dictionary<string, object> d, string key)
    {
        object v;
        int n;
        return d != null && d.TryGetValue(key, out v) && v != null && int.TryParse(v.ToString(), out n) ? n : 0;
    }

    public static Dictionary<string, object> Dict(Dictionary<string, object> d, string key)
    {
        object v;
        return d != null && d.TryGetValue(key, out v) ? v as Dictionary<string, object> : null;
    }

    // Quotes one command-line argument the way CommandLineToArgvW reads it back.
    public static string Q(string s)
    {
        var sb = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in s ?? "")
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { sb.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
            sb.Append('\\', slashes).Append(c);
            slashes = 0;
        }
        sb.Append('\\', slashes * 2).Append('"');
        return sb.ToString();
    }

    public static string SafeName(string name)
    {
        name = name ?? "";
        foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
        name = Regex.Replace(name, @"\s+", " ").Trim().Trim('.').Trim();
        if (Regex.IsMatch(name, @"^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\..*)?$", RegexOptions.IgnoreCase)) name = "_" + name;
        if (name.Length > 120) name = name.Substring(0, 120).Trim();
        return name.Length > 0 ? name : "Untitled";
    }

    public static string Trunc(string s, int max)
    {
        s = (s ?? "").Replace("\r", " ").Replace("\n", " ");
        return s.Length <= max ? s : s.Substring(0, max) + "...";
    }

    public static bool IsInside(string path, string root)
    {
        if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(root)) return false;
        string full = Path.GetFullPath(path).TrimEnd('\\') + "\\";
        string r = Path.GetFullPath(root).TrimEnd('\\') + "\\";
        return full.StartsWith(r, StringComparison.OrdinalIgnoreCase);
    }

    public static string Protect(string secret)
    {
        if (string.IsNullOrEmpty(secret)) return "";
        byte[] data = ProtectedData.Protect(Encoding.UTF8.GetBytes(secret), null, DataProtectionScope.CurrentUser);
        return Convert.ToBase64String(data);
    }

    public static string Unprotect(string blob)
    {
        try
        {
            if (string.IsNullOrEmpty(blob)) return "";
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(blob), null, DataProtectionScope.CurrentUser));
        }
        catch { return ""; }
    }

    // Runs a hidden process and returns its exit code and output.
    public static Task<Tuple<int, string>> Exec(string exe, string args, string cwd = null, int timeoutMs = 600000, Dictionary<string, string> env = null)
    {
        var tcs = new TaskCompletionSource<Tuple<int, string>>();
        var output = new StringBuilder();
        try
        {
            var psi = new ProcessStartInfo(exe, args)
            {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            if (cwd != null) psi.WorkingDirectory = cwd;
            if (env != null) foreach (var kv in env) psi.EnvironmentVariables[kv.Key] = kv.Value;
            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            p.OutputDataReceived += (s, e) => { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
            p.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
            p.Exited += delegate
            {
                p.WaitForExit();
                int code = p.ExitCode;
                p.Dispose();
                lock (output) tcs.TrySetResult(Tuple.Create(code, output.ToString()));
            };
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            Task.Delay(timeoutMs).ContinueWith(_ =>
            {
                if (tcs.Task.IsCompleted) return;
                try { p.Kill(); } catch { }
                lock (output) tcs.TrySetResult(Tuple.Create(-2, output.ToString()));
            });
        }
        catch (Exception ex) { tcs.TrySetResult(Tuple.Create(-1, ex.Message)); }
        return tcs.Task;
    }

    public static void KillTree(Process p)
    {
        try { Process.Start(new ProcessStartInfo("taskkill", "/T /F /PID " + p.Id) { CreateNoWindow = true, UseShellExecute = false }); } catch { }
    }

    public static string FindOnPath(params string[] names)
    {
        foreach (string dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            foreach (string n in names)
            {
                try
                {
                    string exe = Path.Combine(dir.Trim(), n);
                    if (File.Exists(exe)) return exe;
                }
                catch { }
            }
        }
        return null;
    }

    // Normalises a name for loose matching ("אינפי 2 - תשפ\"ו" ~ "Infi 2").
    public static string Loose(string s)
    {
        s = Regex.Replace((s ?? "").ToLowerInvariant(), "[\"'`׳״()\\[\\]{}.,:;_\\-–]", " ");
        return Regex.Replace(s, @"\s+", " ").Trim();
    }

    // Zoom transcripts are WebVTT cues of "Speaker: text"; merge them into readable paragraphs
    // that start a new line when the speaker changes or a minute has passed.
    public static string VttToText(string vtt, string title)
    {
        var sb = new StringBuilder();
        sb.AppendLine(title);
        sb.AppendLine(new string('=', Math.Min(60, Math.Max(10, title.Length))));
        string speaker = null;
        double paragraphStart = -1000;
        string[] lines = vtt.Replace("\r", "").Split('\n');
        for (int i = 0; i < lines.Length; i++)
        {
            int arrow = lines[i].IndexOf("-->");
            if (arrow < 0) continue;
            string stamp = lines[i].Substring(0, arrow).Trim();
            var text = new StringBuilder();
            while (i + 1 < lines.Length && lines[i + 1].Trim().Length > 0)
                text.Append(text.Length > 0 ? " " : "").Append(lines[++i].Trim());
            if (text.Length == 0) continue;

            string cue = text.ToString();
            string who = null;
            var sm = Regex.Match(cue, @"^([^:]{1,40}):\s+(.*)$");
            if (sm.Success) { who = sm.Groups[1].Value.Trim(); cue = sm.Groups[2].Value; }

            double seconds = StampSeconds(stamp);
            if (who != speaker || seconds - paragraphStart >= 60)
            {
                sb.AppendLine().AppendLine();
                sb.Append('[').Append(stamp.Split('.')[0]).Append("] ");
                if (who != null) sb.Append(who).Append(": ");
                speaker = who;
                paragraphStart = seconds;
            }
            else sb.Append(' ');
            sb.Append(cue);
        }
        sb.AppendLine();
        return sb.ToString();
    }

    static double StampSeconds(string stamp)
    {
        double total = 0;
        foreach (string part in stamp.Split(':'))
        {
            double v;
            double.TryParse(part, NumberStyles.Float, CultureInfo.InvariantCulture, out v);
            total = total * 60 + v;
        }
        return total;
    }

    // The length of a transcript written by VttToText: its last "[hh:mm:ss]" stamp, in seconds (0 when it has none).
    public static double TranscriptSeconds(string text)
    {
        double last = 0;
        foreach (Match m in Regex.Matches(text ?? "", @"^\[(\d{1,2}:\d{2}(?::\d{2})?)\]", RegexOptions.Multiline))
            last = Math.Max(last, StampSeconds(m.Groups[1].Value));
        return last;
    }

    // Under 10 minutes a lecture recording is most likely one part of it: Zoom keeps a recording that was stopped and
    // started again as separate parts behind the same link, and only the part the link opens on is downloaded.
    public const int ShortRecordingSeconds = 600;
    public static string RecordingLength(double seconds)
    {
        int s = (int)Math.Round(seconds, MidpointRounding.AwayFromZero);
        return s < 60 ? s + " שניות" : (int)Math.Round(s / 60.0, MidpointRounding.AwayFromZero) + " דקות";
    }
    public static string ShortRecordingNote(double seconds)
    {
        if (!(seconds > 0) || seconds >= ShortRecordingSeconds) return "";
        return "ההקלטה קצרה (" + RecordingLength(seconds) + "), כנראה רק חלק מההרצאה. אם המרצה עצר והמשיך, ב-Zoom יש עוד חלקים: הדבק גם את הקישור שלהם.";
    }

    // Zoom's "play info" without what is private: links become "<url>", long ids and texts only their length.
    // Kept in diagnostics, to see how Zoom lists the parts of a recording.
    public static object PlayInfoShape(object v, int depth = 0)
    {
        if (v == null || v is bool || v is int || v is long || v is double || v is decimal) return v;
        var str = v as string;
        if (str != null) return Regex.IsMatch(str, "^https?://", RegexOptions.IgnoreCase) ? "<url>" : str.Length > 24 ? "<text " + str.Length + ">" : str;
        if (depth >= 4) return "...";
        var dict = v as IDictionary<string, object>;
        if (dict != null)
        {
            var o = new Dictionary<string, object>();
            foreach (var kv in dict) o[kv.Key] = PlayInfoShape(kv.Value, depth + 1);
            return o;
        }
        var list = v as System.Collections.IEnumerable;
        if (list == null) return v.ToString();
        var items = list.Cast<object>().ToList();
        return new Dictionary<string, object> { { "length", items.Count }, { "first", items.Take(2).Select(x => PlayInfoShape(x, depth + 1)).ToList() } };
    }

    // How many parts Zoom lists for a recording: the longest list (down to two levels) of items that name a file or a start time.
    public static int PlayInfoParts(object result)
    {
        int most = 1;
        Action<object, int> walk = null;
        walk = (v, depth) =>
        {
            if (v == null || v is string || depth > 2) return;
            var dict = v as IDictionary<string, object>;
            if (dict != null) { foreach (var kv in dict) walk(kv.Value, depth + 1); return; }
            var list = v as System.Collections.IEnumerable;
            if (list == null) return;
            var items = list.Cast<object>().ToList();
            if (items.Count > most && items.All(x =>
            {
                var d = x as IDictionary<string, object>;
                return d != null && d.Keys.Any(k => Regex.IsMatch(k, "fileid|mp4|starttime|clip", RegexOptions.IgnoreCase));
            })) most = items.Count;
            foreach (var x in items) walk(x, depth + 1);
        };
        walk(result, 0);
        return most;
    }
}
