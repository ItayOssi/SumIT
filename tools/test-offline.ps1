$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$out = Join-Path $repo 'build\regression'
New-Item -ItemType Directory -Force $out | Out-Null
$lib = Join-Path $repo 'build\webview2-1.0.4314.35\pkg\lib\net462'
Copy-Item "$lib\Microsoft.Web.WebView2.Core.dll", "$lib\Microsoft.Web.WebView2.WinForms.dll" $out -Force
$testWeb = [IO.Path]::GetFullPath((Join-Path $out 'web'))
if (-not $testWeb.StartsWith([IO.Path]::GetFullPath($repo) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test directory' }
Remove-Item -LiteralPath $testWeb -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $repo 'src\web') (Join-Path $out 'web') -Recurse -Force
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$sources = (Get-ChildItem (Join-Path $repo 'src') -Filter *.cs).FullName
& $csc /nologo /target:exe /main:RegressionTests /platform:x64 /codepage:65001 "/out:$out\RegressionTests.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Net.Http.dll /r:System.Security.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll "/r:$lib\Microsoft.Web.WebView2.Core.dll" "/r:$lib\Microsoft.Web.WebView2.WinForms.dll" $sources (Join-Path $repo 'tests\RegressionTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Regression build failed' }
& "$out\RegressionTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Regression tests failed' }
