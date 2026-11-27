# 小葱剪辑台 · Windows 一键启动
#   powershell -ExecutionPolicy Bypass -File scripts\start-product.ps1
# 界面/工程/模板 → 3080；渲染内核 9001 由 3080 托管成子进程，退出时一起关。
$ErrorActionPreference = 'Stop'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $Here
$PluginDir = Join-Path $RepoRoot 'digital-human-studio'
$HarnessDir = Join-Path $RepoRoot 'deepseek-harness'
if ($env:PORT) { $Port = $env:PORT } else { $Port = '3080' }
$MinMajor = 22

if (-not (Test-Path (Join-Path $HarnessDir 'apps\cli\src\bin.ts'))) {
  Write-Host "❌ 找不到 harness：$HarnessDir" -ForegroundColor Red
  exit 2
}

# node：环境变量 > 插件自带 > 一键安装目录 > PATH
$Node = $env:XIAOCONG_NODE
if (-not $Node) {
  $c = Join-Path $PluginDir 'vendor\runtime\node\node.exe'
  if (Test-Path $c) { $Node = $c }
}
if (-not $Node) {
  $c = Join-Path $env:USERPROFILE '.dsh\runtime\node\node.exe'
  if (Test-Path $c) { $Node = $c }
}
if (-not $Node) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $Node = $cmd.Source }
}
if (-not $Node) {
  Write-Host ""
  Write-Host "❌ 这台机器上还没装 Node（剪辑台靠它启动，装完才进得了检测页）" -ForegroundColor Red
  Write-Host ""
  Write-Host "   一键装（装到 %USERPROFILE%\.dsh\runtime\node）："
  Write-Host "     powershell -ExecutionPolicy Bypass -File scripts\install-node.ps1"
  Write-Host ""
  Write-Host "   已经装过的话，用环境变量指过去："
  Write-Host "     set XIAOCONG_NODE=D:\nodejs\node.exe"
  Write-Host "     powershell -ExecutionPolicy Bypass -File scripts\start-product.ps1"
  Write-Host ""
  exit 2
}

$NodeVer = & $Node -v
$NodeMajor = [int](($NodeVer -replace '^v', '').Split('.')[0])
if ($NodeMajor -lt $MinMajor) {
  Write-Host "❌ node 版本太低（$NodeVer），需要 $MinMajor+：$Node" -ForegroundColor Red
  Write-Host "   跑 scripts\install-node.ps1 装一个带版本，然后重新启动。"
  exit 2
}

Write-Host "node: $Node ($NodeVer)"
Write-Host "仓库: $RepoRoot"

# 停掉旧进程（只停监听该端口的那个）
$conn = Get-NetTCPConnection -LocalPort ([int]$Port) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  Write-Host "$Port 已在运行（pid $($conn.OwningProcess)），先停掉再起…"
  Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}

$log = Join-Path $env:TEMP 'dsh-3080.log'
$errLog = Join-Path $env:TEMP 'dsh-3080.err.log'
$argLine = "--import tsx/esm apps/cli/src/bin.ts --profile web --no-open --port $Port"
$p = Start-Process -FilePath $Node -ArgumentList $argLine -WorkingDirectory $HarnessDir `
     -RedirectStandardOutput $log -RedirectStandardError $errLog -WindowStyle Hidden -PassThru

Start-Sleep -Seconds 2
Write-Host "剪辑台启动中：http://127.0.0.1:$Port  （引擎 9001 会随它自动起）"
Write-Host "日志：$log"
if (Test-Path $log) { Get-Content $log -Tail 3 }
Start-Process "http://127.0.0.1:$Port"
