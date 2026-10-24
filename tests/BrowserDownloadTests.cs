using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
class BrowserDownloadTests
{
    [STAThread] static void Main()
    {
        Application.EnableVisualStyles();
        var form = new Form { ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Location = new System.Drawing.Point(-3000, -3000) };
        form.Load += async delegate {
            try { await HitStudent.RunBrowserDownloadTests(form); }
            catch (Exception ex) { Console.Error.WriteLine(ex); Environment.ExitCode = 1; }
            finally { form.Close(); }
        };
        Application.Run(form);
    }
}
partial class HitStudent
{
    public static async Task RunBrowserDownloadTests(Form host)
    {
        var server = new TcpListener(IPAddress.Loopback, 0); server.Start();
        int port = ((IPEndPoint)server.LocalEndpoint).Port;
        string baseUrl = "http://127.0.0.1:" + port;
        var serve = Task.Run(async () => {
            try {
                while (true) {
                    var accepted = await server.AcceptTcpClientAsync();
                    var request = Task.Run(async () => {
                    using (var client = accepted)
                    using (var stream = client.GetStream()) {
                        var reader = new StreamReader(stream, Encoding.ASCII, false, 4096, true);
                        string line = await reader.ReadLineAsync();
                        if (line == null) return;
                        string path = line.Split(' ')[1];
                        Console.WriteLine("HTTP " + path);
                        while (!string.IsNullOrEmpty(await reader.ReadLineAsync())) { }
                        bool attachment = path.StartsWith("/file");
                        string body = attachment ? "download-fixture" : path.StartsWith("/popup")
                            ? "<script>onload=()=>{const a=document.createElement('a');a.href=window.URL.createObjectURL(new Blob(['popup-fixture']));a.download='popup.txt';document.body.append(a);a.click()}</script>"
                            : "<a id='direct' href='/file'>download</a><a id='popup' href='/popup' target='_blank'>popup</a><button id='blob' onclick=\"const a=document.createElement('a');a.href=window.URL.createObjectURL(new Blob(['blob-fixture']));a.download='blob.txt';document.body.append(a);a.click()\">blob</button>";
                        byte[] bytes = Encoding.UTF8.GetBytes(body);
                        string headers = "HTTP/1.1 200 OK\r\nContent-Type: " + (attachment ? "application/octet-stream" : "text/html") + "\r\n" + (attachment ? "Content-Disposition: attachment; filename=direct.txt\r\n" : "") + "Content-Length: " + bytes.Length + "\r\nConnection: close\r\n\r\n";
                        byte[] head = Encoding.ASCII.GetBytes(headers);
                        await stream.WriteAsync(head,0,head.Length); await stream.WriteAsync(bytes,0,bytes.Length);
                    }
                    });
                }
            } catch (ObjectDisposedException) {} catch (SocketException) {}
        });
        using (var app = new HitStudent(new[] { "--demo", "--selftest" }))
        using (var view = new WebView2 { Dock = DockStyle.Fill })
        {
            string root = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "downloads-" + Guid.NewGuid().ToString("N"));
            app.settings["studyRoot"] = root;
            host.Controls.Add(view);
            Console.WriteLine("Initializing native browser");
            app.env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(root,"profile"));
            await view.EnsureCoreWebView2Async(app.env);
            app.DownloadPermissionPrompt = origin => origin == baseUrl;
            view.CoreWebView2.PermissionRequested += app.OnDownloadPermission;
            view.CoreWebView2.DownloadStarting += app.OnSiteDownload;
            view.CoreWebView2.DownloadStarting += (s,e) => Console.WriteLine("Download event: " + e.ResultFilePath);
            view.CoreWebView2.NewWindowRequested += app.OpenSitePopup;
            var loaded = new TaskCompletionSource<bool>();
            view.CoreWebView2.NavigationCompleted += (s,e)=>loaded.TrySetResult(true);
            view.CoreWebView2.Navigate(baseUrl);
            if (await Task.WhenAny(loaded.Task, Task.Delay(15000)) != loaded.Task) throw new Exception("Navigation timeout");
            Console.WriteLine("Loaded: " + await view.CoreWebView2.ExecuteScriptAsync("document.body.innerHTML"));
            foreach (string test in new[] { "direct", "blob", "popup" })
            {
                view.CoreWebView2.CloseDefaultDownloadDialog();
                Console.WriteLine(await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.evaluate", app.json.Serialize(new { expression = "document.getElementById('" + test + "').click()", userGesture = true, returnByValue = true })));
                string file = Path.Combine(root, "הורדות", test + ".txt");
                for(int i=0;i<100 && !File.Exists(file);i++) await Task.Delay(100);
                if (!File.Exists(file)) throw new Exception("Download missing: " + test);
                string expected = test == "direct" ? "download-fixture" : test + "-fixture";
                bool valid = false;
                for(int i=0;i<100;i++) {
                    try { valid = File.ReadAllText(file) == expected; if (valid) break; } catch (IOException) { }
                    await Task.Delay(100);
                }
                if (!valid) throw new Exception("Incorrect download content: " + test);
                Console.WriteLine("PASS: native WebView2 " + test + " download");
            }
            foreach (Form popup in host.OwnedForms) popup.Close();
            foreach (Form popup in app.OwnedForms) popup.Close();
        }
        server.Stop(); await serve;
    }
}






