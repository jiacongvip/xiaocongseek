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

# ---------- 2.5 准备 Windows 插件随包资源（编译插件 + 字体 + ffmpeg/ffprobe，不影响 macOS） ----------
Write-Host "== 2.5/4 编译插件 & 准备 Windows 随包资源 ==" -ForegroundColor Cyan
$tscJs = Join-Path $PSScriptRoot 'node_modules\typescript\bin\tsc'
$typeRoots = Join-Path $PSScriptRoot 'node_modules\@types'
$pluginRoot = Resolve-Path (Join-Path $PSScriptRoot '..\digital-human-studio')
$publishRoot = Resolve-Path (Join-Path $PSScriptRoot '..\publish-studio')

if (Test-Path $tscJs) {
  $dhsFiles = (Get-ChildItem (Join-Path $pluginRoot 'src') -Filter '*.ts').FullName
  & node $tscJs --ignoreConfig --target es2022 --lib es2022 --module esnext --moduleResolution bundler --verbatimModuleSyntax --outDir (Join-Path $pluginRoot 'dist') --rootDir (Join-Path $pluginRoot 'src') --skipLibCheck --esModuleInterop --noEmitOnError false --types node --typeRoots $typeRoots @dhsFiles | Out-Null
  $global:LASTEXITCODE = 0
  if (-not (Test-Path (Join-Path $pluginRoot 'dist\index.js'))) { Fail "digital-human-studio 编译失败（未生成 dist\index.js）" }
  Write-Host "  digital-human-studio dist/ 已编译"

  $pubFiles = (Get-ChildItem (Join-Path $publishRoot 'src') -Filter '*.ts').FullName
  & node $tscJs --ignoreConfig --target es2022 --module nodenext --moduleResolution nodenext --outDir (Join-Path $publishRoot 'dist') --rootDir (Join-Path $publishRoot 'src') --skipLibCheck --esModuleInterop --noEmitOnError false --types node --typeRoots $typeRoots @pubFiles | Out-Null
  $global:LASTEXITCODE = 0
  if (-not (Test-Path (Join-Path $publishRoot 'dist\index.js'))) { Fail "publish-studio 编译失败（未生成 dist\index.js）" }
  Write-Host "  publish-studio dist/ 已编译"
} else {
  Write-Host "  [警告] 未找到 $tscJs，跳过插件编译" -ForegroundColor Yellow
}

$fontsDstDir = Join-Path $pluginRoot 'vendor\xiaocongcut\fonts'
$fallbackFont = Join-Path $pluginRoot 'assets\fonts\NotoSansSC-Black.otf'
if (-not (Test-Path $fontsDstDir)) { New-Item -ItemType Directory -Path $fontsDstDir -Force | Out-Null }
if ((Test-Path $fallbackFont) -and -not (Test-Path (Join-Path $fontsDstDir 'NotoSansSC-Black.otf'))) {
  Copy-Item $fallbackFont (Join-Path $fontsDstDir 'NotoSansSC-Black.otf') -Force
  Write-Host "  已内置基础字体 NotoSansSC-Black.otf 到 vendor\xiaocongcut\fonts"
}

$runtimeBinDir = Join-Path $pluginRoot 'vendor\runtime\bin'
if (-not (Test-Path $runtimeBinDir)) { New-Item -ItemType Directory -Path $runtimeBinDir -Force | Out-Null }
$ffmpegDst = Join-Path $runtimeBinDir 'ffmpeg.exe'
$ffprobeDst = Join-Path $runtimeBinDir 'ffprobe.exe'
if ((Test-Path $ffmpegDst) -and (Test-Path $ffprobeDst)) {
  Write-Host "  ffmpeg.exe / ffprobe.exe 已就绪（vendor\runtime\bin）"
} else {
  $sysFfmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
  $sysFfprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
  if ($sysFfmpeg -and $sysFfprobe -and (Test-Path $sysFfmpeg.Source) -and (Test-Path $sysFfprobe.Source)) {
    Copy-Item $sysFfmpeg.Source $ffmpegDst -Force
    Copy-Item $sysFfprobe.Source $ffprobeDst -Force
    Write-Host "  已从本机 PATH 复制 ffmpeg.exe / ffprobe.exe 到随包目录"
  } elseif (-not $CheckOnly) {
    Write-Host "  未检测到本机 ffmpeg，正在下载 Windows 静态版 ffmpeg-release-essentials.zip ..." -ForegroundColor Yellow
    $tmpRoot = Join-Path $env:TEMP ("xiaocong-ffmpeg-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $zipPath = Join-Path $tmpRoot 'ffmpeg.zip'
    try {
      New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
      $ProgressPreference = 'SilentlyContinue'
      Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zipPath -TimeoutSec 300
      Expand-Archive -Path $zipPath -DestinationPath $tmpRoot -Force
      $foundFfmpeg = Get-ChildItem -Path $tmpRoot -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
      $foundFfprobe = Get-ChildItem -Path $tmpRoot -Recurse -Filter 'ffprobe.exe' | Select-Object -First 1
      if ($foundFfmpeg -and $foundFfprobe) {
        Copy-Item $foundFfmpeg.FullName $ffmpegDst -Force
        Copy-Item $foundFfprobe.FullName $ffprobeDst -Force
        Write-Host "  已下载并内置 ffmpeg.exe / ffprobe.exe 到 vendor\runtime\bin" -ForegroundColor Green
      } else {
        Write-Host "  [警告] 下载包中未找到 ffmpeg.exe / ffprobe.exe，可手动放入 digital-human-studio\vendor\runtime\bin\" -ForegroundColor Yellow
      }
    } catch {
      Write-Host ("  [警告] 自动下载 ffmpeg 失败：" + $_.Exception.Message + "（可先执行 winget install Gyan.FFmpeg 后重新打包）") -ForegroundColor Yellow
    } finally {
      if (Test-Path $tmpRoot) { Remove-Item $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue }
    }
  } else {
    Write-Host "  [提示] 正式打包时将自动下载或复制本机 ffmpeg.exe / ffprobe.exe 到 vendor\runtime\bin" -ForegroundColor Yellow
  }
}

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
