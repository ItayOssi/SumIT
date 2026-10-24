$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$out = Join-Path $repo 'build\browser-tests'
New-Item -ItemType Directory -Force $out | Out-Null
$lib = Join-Path $repo 'build\webview2-1.0.4314.35\pkg\lib\net462'
Copy-Item "$lib\Microsoft.Web.WebView2.Core.dll", "$lib\Microsoft.Web.WebView2.WinForms.dll" $out -Force
Copy-Item (Join-Path $repo 'build\webview2-1.0.4314.35\pkg\runtimes\win-x64\native\WebView2Loader.dll') $out -Force
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$sources = (Get-ChildItem (Join-Path $repo 'src') -Filter *.cs).FullName
& $csc /nologo /target:exe /main:BrowserDownloadTests /platform:x64 /codepage:65001 "/out:$out\BrowserDownloadTests.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Net.Http.dll /r:System.Security.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll "/r:$lib\Microsoft.Web.WebView2.Core.dll" "/r:$lib\Microsoft.Web.WebView2.WinForms.dll" $sources (Join-Path $repo 'tests\BrowserDownloadTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Regression build failed' }
& "$out\BrowserDownloadTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Regression tests failed' }

