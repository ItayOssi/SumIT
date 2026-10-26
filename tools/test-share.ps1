$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$out = Join-Path $repo 'build\share-tests'
New-Item -ItemType Directory -Force $out | Out-Null
$lib = Join-Path $repo 'build\webview2-1.0.4314.35\pkg\lib\net462'
Copy-Item "$lib\Microsoft.Web.WebView2.Core.dll", "$lib\Microsoft.Web.WebView2.WinForms.dll" $out -Force
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$references = @('/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', '/r:System.Net.Http.dll', '/r:System.Security.dll', '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll', "/r:$out\Microsoft.Web.WebView2.Core.dll", "/r:$out\Microsoft.Web.WebView2.WinForms.dll")
$sources = (Get-ChildItem -LiteralPath (Join-Path $repo 'src') -Filter '*.cs').FullName
& $compiler /nologo /target:exe /main:ShareTests /platform:x64 /codepage:65001 "/out:$out\ShareTests.exe" $references $sources (Join-Path $repo 'tests\ShareTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Share test compile failed' }
& "$out\ShareTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Share tests failed' }
