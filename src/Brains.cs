using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

// ChatGPT and Gemini on the student's own subscription - no API key. Each has a command-line tool that signs in with the
// account in the browser (like logging in to the website) and can then answer a question without any window:
//   ChatGPT:  codex login / codex exec     (a ChatGPT plan)
//   Gemini:   gemini  / gemini -p          (a Google account)
// The app installs them in its own folder, opens the sign-in, and then uses them as helpers next to Claude.
partial class HitStudent
{
    // What the last check found; read without waiting (the check itself runs in the background, see RefreshBrains).
    internal bool codexSignedIn;
    internal bool? geminiSignedOverride;   // tests

    // Test hooks: a fake tool in place of the real one.
    static string FindCodex()
    {
        string fake = Environment.GetEnvironmentVariable("SUMIT_CODEX");
        if (!string.IsNullOrEmpty(fake) && File.Exists(fake)) return fake;
        if (FindNode() == null) return null;
        string own = Path.Combine(LocalNpmPrefix, "codex.cmd");
        if (File.Exists(own)) return own;
        string global = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"npm\codex.cmd");
        return File.Exists(global) ? global : FindOnPath("codex.cmd", "codex.exe");
    }

    // Gemini on the student's Google account goes through Google's Antigravity CLI ("agy"): Google ended Gemini CLI for personal accounts
    // on 2026-06-18. The app can't ask agy "am I signed in" without spending a question, so it remembers that a test question was answered.
    static string FindAgy()
    {
        string fake = Environment.GetEnvironmentVariable("SUMIT_AGY");
        if (!string.IsNullOrEmpty(fake) && File.Exists(fake)) return fake;
        string own = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"agy\bin\agy.exe");
        return File.Exists(own) ? own : FindOnPath("agy.exe");
    }
    bool GeminiAccountReady() { return FindAgy() != null && (geminiSignedOverride ?? Bool(settings, "agyOk")); }
    bool ChatGptAccountReady() { return FindCodex() != null && codexSignedIn && (Bool(settings, "chatgptOk") || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("SUMIT_CODEX"))); }

    // "account" (the subscription), "key" (an API key), or "" (not connected).
    string HelperMode(string provider)
    {
        if (provider == "gemini") return GeminiAccountReady() ? "account" : HasHelperKey("gemini") ? "key" : "";
        return ChatGptAccountReady() ? "account" : HasHelperKey("openai") ? "key" : "";
    }

    static Dictionary<string, string> CliEnv()
    {
        return new Dictionary<string, string> { { "PATH", NodePath() }, { "NO_COLOR", "1" }, { "CI", "1" } };
    }

    // Runs a tool with the prompt on its standard input (so a long text is no problem) and returns exit code, output, errors.
    async Task<Tuple<int, string, string>> RunCli(string exe, string args, string stdin, string cwd, int timeoutMs)
    {
        var psi = new ProcessStartInfo(exe, args)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = cwd
        };
        foreach (var kv in CliEnv()) psi.EnvironmentVariables[kv.Key] = kv.Value;
        using (var p = Process.Start(psi))
        {
            var outTask = p.StandardOutput.ReadToEndAsync();
            var errTask = p.StandardError.ReadToEndAsync();
            try
            {
                if (stdin != null) { var bytes = new UTF8Encoding(false).GetBytes(stdin); await p.StandardInput.BaseStream.WriteAsync(bytes, 0, bytes.Length); }
                p.StandardInput.Close();
            }
            catch { }
            bool done = await Task.Run(() => p.WaitForExit(timeoutMs));
            if (!done) { KillTree(p); return Tuple.Create(-2, "", "הזמן הקצוב נגמר"); }
            // The tool's own child processes may keep the pipes open for a moment.
            await Task.WhenAny(Task.WhenAll(outTask, errTask), Task.Delay(4000));
            return Tuple.Create(p.ExitCode, outTask.IsCompleted ? outTask.Result : "", errTask.IsCompleted ? errTask.Result : "");
        }
    }

    // The whole conversation as one text for a tool that takes a single prompt.
    static string CliPrompt(string system, List<Tuple<string, string>> messages)
    {
        var sb = new StringBuilder(system).Append("\n\n=== השיחה ===\n");
        foreach (var m in messages) sb.Append(m.Item1 == "assistant" ? "עוזר: " : "סטודנט: ").Append(m.Item2).Append("\n\n");
        return sb.Append("ענה עכשיו להודעה האחרונה של הסטודנט, לפי ההנחיות והחומר שלמעלה. אל תשתמש בכלים ואל תקרא או תכתוב קבצים.").ToString();
    }

    // One question, through the subscription.
    async Task<HelperReply> HelperCallCli(string provider, string system, List<Tuple<string, string>> messages)
    {
        var reply = new HelperReply { Provider = provider };
        string dir = Path.Combine(Path.GetTempPath(), "SumIT-brain-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);   // an empty folder: the tool has nothing else to read
        try
        {
            string prompt = CliPrompt(system, messages);
            Tuple<int, string, string> r;
            string text = "";
            if (provider == "gemini")
            {
                // Antigravity can't take a long text on its input, so the conversation is a file in the empty folder, read-only ("plan") mode,
                // and the short instruction on the command line says to read it.
                File.WriteAllText(Path.Combine(dir, "material.txt"), prompt, new UTF8Encoding(false));
                string exe = FindAgy();
                r = await RunCli(exe, "-p " + Q("Read the file material.txt in the current folder. It holds instructions, background material and a conversation. Answer the last student message exactly as the instructions say, in the language they ask for. Do not run commands, do not change files, and reply with the answer only.") + " --mode plan", null, dir, 300000);
                text = r.Item2.Trim();
                if (r.Item3.IndexOf("Authentication required", StringComparison.OrdinalIgnoreCase) >= 0 || r.Item3.IndexOf("authentication failed", StringComparison.OrdinalIgnoreCase) >= 0)
                { settings["agyOk"] = false; SaveSettings(); reply.Error = true; reply.Text = "ההתחברות ל-Google פגה. התחבר שוב בהגדרות"; return reply; }
            }
            else
            {
                string exe = FindCodex();
                string answer = Path.Combine(dir, "answer.txt");
                r = await RunCli(exe, "exec --ignore-user-config --skip-git-repo-check -s read-only --ephemeral -o " + Q(answer) + " -", prompt, dir, 240000);
                text = File.Exists(answer) ? File.ReadAllText(answer, Encoding.UTF8).Trim() : "";
            }
            if (r.Item1 != 0 || text.Length == 0)
            {
                reply.Error = true;
                string err = (r.Item3 + " " + r.Item2).ToLowerInvariant();
                reply.Limit = err.Contains("usage limit") || err.Contains("rate limit") || err.Contains("quota") || err.Contains("429");
                reply.Text = reply.Limit ? "המכסה של המנוי נגמרה לעכשיו" : err.Contains("not logged in") || err.Contains("log in") || err.Contains("401") ? "ההתחברות פגה. התחבר שוב בהגדרות" : Trunc((r.Item3.Length > 0 ? r.Item3 : r.Item2).Trim(), 200);
                if (reply.Text.Length == 0) reply.Text = "ה-AI לא החזיר תשובה";
                return reply;
            }
            reply.Text = text;
            return reply;
        }
        catch (Exception ex) { reply.Error = true; reply.Text = ex.Message; return reply; }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    // ---------- Installing and signing in ----------

    async Task InstallCli(string package, string state)
    {
        if (FindNpm() == null)
        {
            setupState = "installing-node"; await SendAiStatus();
            await InstallPortableNode();
            if (FindNpm() == null) throw new Exception("ההתקנה של Node.js נכשלה");
        }
        setupState = state; await SendAiStatus();
        Directory.CreateDirectory(LocalNpmPrefix);
        var r = await Exec(FindNpm(), "install -g --prefix " + Q(LocalNpmPrefix) + " " + package, null, 900000, new Dictionary<string, string> { { "PATH", NodePath() } });
        if (r.Item1 != 0) throw new Exception("ההתקנה נכשלה. " + Trunc(r.Item2, 200));
    }

    // Runs a sign-in tool until it ends, showing its web address in the app if the browser doesn't open by itself.
    async Task RunLogin(string exe, string args, string kind, Func<bool> signedIn, bool answerYes)
    {
        var psi = new ProcessStartInfo(exe, args)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = Path.GetTempPath()
        };
        foreach (var kv in CliEnv()) psi.EnvironmentVariables[kv.Key] = kv.Value;
        // A tool that sees CI in its environment never opens a browser (Gemini says "non-interactive session"), so sign-in runs without it.
        psi.EnvironmentVariables.Remove("CI");
        var seen = new StringBuilder();
        string urlSent = null;
        using (var p = Process.Start(psi))
        {
            bool answered = false;
            // The question "[Y/n]:" has no line break after it, so the output is read as it comes, not line by line.
            Action<StreamReader> pump = (reader) => Task.Run(() =>
            {
                var buf = new char[512];
                int n;
                try
                {
                    while ((n = reader.Read(buf, 0, buf.Length)) > 0)
                    {
                        string all;
                        lock (seen) { seen.Append(buf, 0, n); all = seen.ToString(); }
                        if (answerYes && !answered && all.IndexOf("[Y/n]", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            answered = true;
                            try { var yes = new byte[] { (byte)'Y', 13, 10 }; p.StandardInput.BaseStream.Write(yes, 0, yes.Length); p.StandardInput.BaseStream.Flush(); } catch { }   // raw bytes: no encoding preamble in front of the Y
                        }
                    }
                }
                catch { }
            });
            pump(p.StandardOutput); pump(p.StandardError);
            if (!answerYes) { try { p.StandardInput.Close(); } catch { } }
            var started = DateTime.UtcNow;
            while (!p.HasExited && (DateTime.UtcNow - started).TotalMinutes < 6)
            {
                await Task.Delay(1500);
                if (signedIn()) break;
                string text; lock (seen) text = seen.ToString();
                var m = Regex.Match(text, "https://[^\\s\"']+");
                if (m.Success && urlSent != m.Value && (DateTime.UtcNow - started).TotalSeconds > 6)
                { urlSent = m.Value; Send(new { type = "loginUrl", kind = kind, url = m.Value }); }
            }
            if (!p.HasExited) { await Task.Delay(1500); KillTree(p); }
        }
    }

    // Google's own installer for Antigravity CLI (it checks the download's SHA-512 itself and puts agy.exe in the user's folder).
    async Task InstallAgy()
    {
        string script = Path.Combine(Path.GetTempPath(), "sumit-agy-install-" + Guid.NewGuid().ToString("N") + ".ps1");
        try
        {
            using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) })
                File.WriteAllText(script, await http.GetStringAsync("https://antigravity.google/cli/install.ps1"), new UTF8Encoding(false));
            var r = await Exec("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " + Q(script), null, 900000);
            if (FindAgy() == null) throw new Exception("ההתקנה של Gemini נכשלה. " + Trunc(r.Item2, 200));
        }
        finally { try { File.Delete(script); } catch { } }
    }

    Process agyLogin;

    // Signs in to Antigravity: it prints a Google address, the browser opens it, and the student either is signed in on its own or
    // pastes the code Google shows (submitAuthCode). Ends when the tool answers a tiny test question, which proves the sign-in works.
    async Task<bool> LoginAgy()
    {
        string dir = Path.Combine(Path.GetTempPath(), "SumIT-agy-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var seen = new StringBuilder();
        string urlSent = null;
        try
        {
            var psi = new ProcessStartInfo(FindAgy(), "-p " + Q("Reply with exactly: READY") + " --mode plan")
            {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = dir
            };
            foreach (var kv in CliEnv()) psi.EnvironmentVariables[kv.Key] = kv.Value;
            psi.EnvironmentVariables.Remove("CI");
            using (var p = Process.Start(psi))
            {
                agyLogin = p;
                Action<StreamReader> pump = (reader) => Task.Run(() =>
                {
                    var buf = new char[512]; int n;
                    try { while ((n = reader.Read(buf, 0, buf.Length)) > 0) lock (seen) seen.Append(buf, 0, n); } catch { }
                });
                pump(p.StandardOutput); pump(p.StandardError);
                var started = DateTime.UtcNow;
                while (!p.HasExited && (DateTime.UtcNow - started).TotalSeconds < 150)
                {
                    await Task.Delay(700);
                    string text; lock (seen) text = seen.ToString();
                    var m = Regex.Match(text, "https://accounts\\.google\\.com/[^\\s\"']+");
                    if (m.Success && urlSent != m.Value)
                    {
                        urlSent = m.Value;
                        if (Environment.GetEnvironmentVariable("SUMIT_AGY") == null) OpenExternal(m.Value);   // a stand-in tool in the tests must not open a browser
                        Send(new { type = "authCode", kind = "gemini", state = "wait", url = m.Value });
                    }
                }
                if (!p.HasExited) KillTree(p);
                else await Task.Delay(300);
                string all; lock (seen) all = seen.ToString();
                bool ok = p.HasExited && p.ExitCode == 0 && all.IndexOf("READY", StringComparison.OrdinalIgnoreCase) >= 0;
                settings["agyOk"] = ok; SaveSettings();
                return ok;
            }
        }
        finally
        {
            agyLogin = null;
            Send(new { type = "authCode", kind = "gemini", state = "done" });
            try { Directory.Delete(dir, true); } catch { }
        }
    }

    // The code Google showed after the sign-in, typed into the app: passed on to the waiting sign-in. Only the characters of such a code.
    void SubmitAuthCode(string code)
    {
        code = (code ?? "").Trim();
        if (code.Length == 0 || code.Length > 600 || !Regex.IsMatch(code, @"^[A-Za-z0-9/_\-\.~%+=]+$")) { Toast("זה לא נראה כמו הקוד של Google", true); return; }
        try { var p = agyLogin; if (p != null && !p.HasExited) { var b = Encoding.ASCII.GetBytes(code + "\r\n"); p.StandardInput.BaseStream.Write(b, 0, b.Length); p.StandardInput.BaseStream.Flush(); } }
        catch { }
    }

    // Tells Gemini's tool to sign in with a Google account (without it, a tool run without a window has no way to ask which kind of sign-in).
    // Existing settings are kept; only the sign-in type is added when it is missing.
    void EnsureGeminiGoogleAuth()
    {
        try
        {
            Directory.CreateDirectory(GeminiDir);
            string file = Path.Combine(GeminiDir, "settings.json");
            var root = new Dictionary<string, object>();
            if (File.Exists(file))
            {
                try { root = json.DeserializeObject(File.ReadAllText(file, Encoding.UTF8)) as Dictionary<string, object> ?? root; }
                catch { return; }   // a settings file we can't read is left alone
            }
            var security = root.ContainsKey("security") ? root["security"] as Dictionary<string, object> : null;
            if (security == null) { security = new Dictionary<string, object>(); root["security"] = security; }
            var auth = security.ContainsKey("auth") ? security["auth"] as Dictionary<string, object> : null;
            if (auth == null) { auth = new Dictionary<string, object>(); security["auth"] = auth; }
            if (auth.ContainsKey("selectedType")) return;
            auth["selectedType"] = "oauth-personal";
            File.WriteAllText(file, json.Serialize(root), new UTF8Encoding(false));
        }
        catch { }
    }

    async void ConnectBrain(string kind)
    {
        if (setupState.Length > 0) return;
        try
        {
            if (kind == "chatgpt")
            {
                if (FindCodex() == null) await InstallCli("@openai/codex", "installing-codex");
                setupState = "login-chatgpt"; await SendAiStatus();
                await RefreshBrains();   // already signed in on this PC: no browser, the student only links it here
                if (!codexSignedIn) { await RunLogin(FindCodex(), "login", kind, () => false, false); await RefreshBrains(); }
                settings["chatgptOk"] = codexSignedIn; SaveSettings();
                Toast(codexSignedIn ? "ChatGPT חובר, והוא עוזר ל-Claude" : "ההתחברות ל-ChatGPT לא הסתיימה. אפשר לנסות שוב", !codexSignedIn);
            }
            else
            {
                if (FindAgy() == null) { setupState = "installing-gemini"; await SendAiStatus(); await InstallAgy(); }
                setupState = "login-gemini"; await SendAiStatus();
                bool signedIn = await LoginAgy();
                Toast(signedIn ? "Gemini חובר, והוא עוזר ל-Claude" : "ההתחברות ל-Google לא הסתיימה. אפשר לנסות שוב", !signedIn);
            }
        }
        catch (Exception ex) { Toast(ex.Message, true); }
        setupState = "";
        await SendAiStatus();
        SendSettings();
    }

    // "Does it really work?": one tiny question to the AI, so the student sees an answer and how long it took.
    // Claude is only asked about its sign-in (a real question would spend its quota for nothing).
    async void TestBrain(string kind)
    {
        string who = kind == "gemini" ? "gemini" : kind == "chatgpt" ? "openai" : "claude";
        var sw = Stopwatch.StartNew();
        try
        {
            if (who == "claude")
            {
                var st = await AiStatus();
                var readyProp = st == null ? null : st.GetType().GetProperty("ready");
                bool claudeReady = readyProp != null && (readyProp.GetValue(st, null) as bool? ?? false);
                Send(new { type = "brainTest", kind = kind, ok = claudeReady, ms = (int)sw.ElapsedMilliseconds, text = claudeReady ? "מחובר" : "לא מחובר" });
                return;
            }
            await RefreshBrains();
            if (HelperMode(who).Length == 0) { Send(new { type = "brainTest", kind = kind, ok = false, ms = 0, text = "לא מחובר" }); return; }
            var r = await HelperAsk("ענה במילה אחת בלבד.", new List<Tuple<string, string>> { Tuple.Create("user", "ענה: מוכן") }, who);
            bool ok = r != null && !r.Error;
            Send(new { type = "brainTest", kind = kind, ok = ok, ms = (int)sw.ElapsedMilliseconds, text = r == null ? "לא מחובר" : Trunc(r.Text.Trim(), 80), mode = HelperMode(who) });
        }
        catch (Exception ex) { Send(new { type = "brainTest", kind = kind, ok = false, ms = (int)sw.ElapsedMilliseconds, text = ex.Message }); }
    }

    async void DisconnectBrain(string kind)
    {
        try
        {
            if (kind == "chatgpt") { settings["chatgptOk"] = false; SaveSettings(); if (FindCodex() != null) await Exec(FindCodex(), "logout", null, 30000, CliEnv()); codexSignedIn = false; }
            else
            {
                // Signs the Google account out of Antigravity (its token is kept in the Windows credential store) and forgets the link.
                settings["agyOk"] = false; SaveSettings();
                if (Environment.GetEnvironmentVariable("SUMIT_AGY") == null) await Exec("cmdkey", "/delete:gemini:antigravity", null, 15000);
            }
        }
        catch (Exception ex) { Toast(ex.Message, true); }
        await RefreshBrains();
        await SendAiStatus();
        SendSettings();
    }

    // Is ChatGPT's tool signed in? Asked in the background, whenever the status is refreshed.
    async Task RefreshBrains()
    {
        string codex = FindCodex();
        if (codex == null) { codexSignedIn = false; return; }
        try
        {
            var r = await Exec(codex, "login status", null, 20000, CliEnv());
            codexSignedIn = r.Item1 == 0 && r.Item2.IndexOf("Logged in", StringComparison.OrdinalIgnoreCase) >= 0;
        }
        catch { codexSignedIn = false; }
    }
}
