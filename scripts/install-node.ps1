# 小葱剪辑台 · Windows 版 Node 运行时一键安装
#   powershell -ExecutionPolicy Bypass -File scripts\install-node.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-node.ps1 -Check
# 装到 %USERPROFILE%\.dsh\runtime\node，start-product.ps1 会优先用它。
param([switch]$Check)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Dest = Join-Path $env:USERPROFILE '.dsh\runtime\node'
$Exe = Join-Path $Dest 'node.exe'
$MinMajor = 22

function Get-Major($p) {
  if (-not (Test-Path $p)) { return 0 }
  $v = & $p -v
  if (-not $v) { return 0 }
  return [int](($v -replace '^v', '').Split('.')[0])
}

if ((Get-Major $Exe) -ge $MinMajor) {
  Write-Host "node 已就绪：$Exe ($(& $Exe -v))" -ForegroundColor Green
  exit 0
}
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd -and ((Get-Major $cmd.Source) -ge $MinMajor)) {
  Write-Host "PATH 里的 node 够用：$($cmd.Source) ($(& $cmd.Source -v))" -ForegroundColor Green
  exit 0
}
if ($Check) {
  Write-Host "node 缺失或低于 v$MinMajor" -ForegroundColor Yellow
  exit 1
}

$Base = 'https://nodejs.org/dist/latest-v22.x'
Write-Host "→ 取 v22 最新版本清单…"
$sums = (Invoke-WebRequest -Uri "$Base/SHASUMS256.txt" -UseBasicParsing).Content
$file = ($sums -split "`n" | Where-Object { $_ -match 'win-x64\.zip' } | Select-Object -First 1).Split(' ')[-1].Trim()
if (-not $file) { Write-Host "清单里没找到 win-x64 包" -ForegroundColor Red; exit 3 }

$zip = Join-Path $env:TEMP $file
Write-Host "→ 下载 $file（约 30MB）…"
Invoke-WebRequest -Uri "$Base/$file" -OutFile $zip -UseBasicParsing

Write-Host "→ 解压到 $Dest …"
$tmp = Join-Path $env:TEMP ('node-unzip-' + (Get-Random))
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$inner = Get-ChildItem $tmp | Select-Object -First 1
if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
New-Item -ItemType Directory -Path $Dest -Force | Out-Null
Copy-Item (Join-Path $inner.FullName '*') $Dest -Recurse -Force
Remove-Item $tmp -Recurse -Force
Remove-Item $zip -Force

if (-not (Test-Path $Exe)) { Write-Host "装完找不到 $Exe" -ForegroundColor Red; exit 4 }
Write-Host "✅ node 装好了：$Exe ($(& $Exe -v))" -ForegroundColor Green
Write-Host "   启动：powershell -ExecutionPolicy Bypass -File scripts\start-product.ps1"
exit 0
