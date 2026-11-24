# Xiaocongseek Windows x64 未签名测试包 —— 一键打包
# 前置：Node 24.x、pnpm 11.28.5、Git、PowerShell 7(pwsh)、Python 3.11+、
#       Visual Studio Build Tools(C++ 桌面开发)+Windows SDK、tar
# 用法：在仓库根目录（本脚本所在目录）执行  pwsh -File build-win.ps1
#       先只做预检：pwsh -File build-win.ps1 -CheckOnly

param(
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

function Fail($msg) { Write-Host "[失败] $msg" -ForegroundColor Red; exit 1 }

# ---------- 1. 工具自检 ----------
Write-Host "== 1/4 工具自检 ==" -ForegroundColor Cyan
$nodeVersion = (& node -v) 2>$null
if (-not $nodeVersion) { Fail "找不到 node，请安装 Node 24.x（https://nodejs.org）" }
if ($nodeVersion -notmatch '^v24\.') { Fail "需要 Node 24.x，当前 $nodeVersion（可用 nvm-windows 切换）" }
Write-Host "  node  $nodeVersion"

$pnpmVersion = (& pnpm -v) 2>$null
if (-not $pnpmVersion) { Fail "找不到 pnpm，执行：corepack enable  或  npm i -g pnpm@11.28.5" }
if ($pnpmVersion -notmatch '^11\.') { Fail "需要 pnpm 11.x（仓库 packageManager=pnpm@11.28.5），当前 $pnpmVersion" }
Write-Host "  pnpm  $pnpmVersion"

foreach ($tool in @('git', 'tar', 'python')) {
  $present = Get-Command $tool -ErrorAction SilentlyContinue
  if (-not $present) { Write-Host "  [警告] 未找到 $tool（打包可能失败，见 README）" -ForegroundColor Yellow }
  else { Write-Host "  $tool  已找到" }
}

if (-not (Get-Command pwsh -ErrorAction SilentlyContinue)) {
  Write-Host "  提示：当前可能不是 PowerShell 7，打包脚本内部会要求 pwsh，请先安装 PowerShell 7" -ForegroundColor Yellow
}

# ---------- 1.5 配置文件 ----------
$envFile = Join-Path $PSScriptRoot 'apps\desktop\.env.windows'
$envExample = Join-Path $PSScriptRoot 'apps\desktop\.env.windows.xiaocong-example'
if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
  Copy-Item $envExample $envFile
  Write-Host "  已从示例生成 apps\desktop\.env.windows（可自行调整 origin）" -ForegroundColor Yellow
}

# ---------- 2. 安装依赖 ----------
Write-Host "== 2/4 安装依赖（首次约 10-20 分钟，需访问 npm registry）==" -ForegroundColor Cyan
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Fail "pnpm install 失败" }

# ---------- 3. 配置预检 ----------
Write-Host "== 3/4 配置与工具预检 ==" -ForegroundColor Cyan
pnpm run package:desktop:win:x64:unsigned -- --check
if ($LASTEXITCODE -ne 0) { Fail "预检未通过，按上面的报错修改 apps/desktop/.env.windows 后重试" }

if ($CheckOnly) { Write-Host "预检通过（-CheckOnly，结束）" -ForegroundColor Green; exit 0 }

# ---------- 4. 打包 ----------
Write-Host "== 4/4 打包（含完整构建，约 15-40 分钟）==" -ForegroundColor Cyan
pnpm run package:desktop:win:x64:unsigned
if ($LASTEXITCODE -ne 0) { Fail "打包失败，阶段日志在 apps\desktop\.desktop-build\packaging-runs\" }

$out = Join-Path $PSScriptRoot 'apps\desktop\.desktop-build\targets\win-x64\unsigned-artifacts'
Write-Host "== 完成 ==" -ForegroundColor Green
Get-ChildItem $out -Filter *.exe | ForEach-Object { Write-Host ("  " + $_.FullName + "  (" + [math]::Round($_.Length/1MB,1) + " MB)") }
Write-Host "双击该 exe 安装（未签名，SmartScreen 会提示，选「更多信息」→「仍要运行」）"
