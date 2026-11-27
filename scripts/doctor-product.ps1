# 小葱剪辑台 · Windows 环境体检（只读：不安装、不修改、不启动）
#   powershell -ExecutionPolicy Bypass -File scripts\doctor-product.ps1
# 退出码：0 全部就绪；1 有致命缺失；2 仅警告
$ErrorActionPreference = 'Continue'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $Here
$PluginDir = Join-Path $RepoRoot 'digital-human-studio'
$Vectcut = Join-Path $PluginDir 'vendor\vectcut'
$Fatal = 0
$Warn = 0

function Ok($msg)   { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Bad($msg)  { Write-Host "  [缺]   $msg" -ForegroundColor Red; $script:Fatal++ }
function Warn2($msg){ Write-Host "  [提示] $msg" -ForegroundColor Yellow; $script:Warn++ }

Write-Host "== 小葱剪辑台 · Windows 体检 =="
Write-Host "仓库：$RepoRoot"

# 1. Node（插件自带 > 一键安装目录 > PATH，和 start-product.ps1 同一顺序）
$node = Join-Path $PluginDir 'vendor\runtime\node\node.exe'
if (-not (Test-Path $node)) {
  $node = Join-Path $env:USERPROFILE '.dsh\runtime\node\node.exe'
}
if (-not (Test-Path $node)) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $node = $cmd.Source }
}
if (Test-Path $node) {
  $v = & $node -v
  $major = [int](($v -replace '^v', '').Split('.')[0])
  if ($major -ge 22) { Ok "node $v ($node)" } else { Bad "node 版本太低 $v，需要 22+（跑 install-node.ps1）" }
} else {
  Bad "没有 Node。跑 scripts\install-node.ps1"
}

# 2. 引擎 venv
$py = Join-Path $Vectcut '.venv\Scripts\python.exe'
if (Test-Path $py) {
  & $py -c "import flask, faster_whisper, PIL" 2>$null
  if ($LASTEXITCODE -eq 0) { Ok "渲染引擎 venv（flask / faster-whisper / pillow）" }
  else { Bad "引擎 venv 缺依赖，跑 bootstrap-product.ps1" }
} else {
  Bad "没有引擎 venv：$py（跑 bootstrap-product.ps1）"
}

# 3. ffmpeg
$ff = Join-Path $PluginDir 'vendor\runtime\bin\ffmpeg.exe'
if (-not (Test-Path $ff)) {
  $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($cmd) { $ff = $cmd.Source }
}
if (Test-Path $ff) { Ok "ffmpeg $ff" } else { Bad "缺 ffmpeg.exe（vendor\runtime\bin 里要放 Windows 版）" }

# 4. 字体
$fontsDir = Join-Path $Vectcut 'fonts'
if (Test-Path $fontsDir) {
  $n = (Get-ChildItem $fontsDir -File | Where-Object { $_.Extension -in '.otf', '.ttf', '.ttc' }).Count
  if ($n -gt 0) { Ok "字体库 $n 个文件（其余可在剪辑台里点选下载）" } else { Bad "字体目录是空的，模板出字会回退" }
} else {
  Bad "缺字体目录 $fontsDir"
}

# 5. ASR 模型
$asr = Join-Path $env:USERPROFILE '.vectcut\cache\asr-models'
if (Test-Path $asr) {
  $c = (Get-ChildItem $asr -Recurse -File -ErrorAction SilentlyContinue).Count
  if ($c -gt 0) { Ok "转写模型已就绪（$c 个文件）" } else { Warn2 "转写模型目录是空的（准备页可一键下，约 480MB）" }
} else {
  Warn2 "还没下转写模型（准备页可一键下，约 480MB）"
}

# 6. 采集
$mcRoot = Join-Path $PluginDir 'vendor\media-crawler'
$mcPy = Join-Path $mcRoot '.venv\Scripts\python.exe'
if (Test-Path $mcPy) { Ok "采集 venv $mcPy" } else { Warn2 "采集 venv 没建（跑 bootstrap-product.ps1）" }

# 7. 发布运行时
$rt = Join-Path $env:USERPROFILE '.dsh\publish-studio\runtime\status.json'
if (Test-Path $rt) { Ok "发布运行时已装（$rt）" } else { Warn2 "发布运行时未装（准备页可一键装，约 613MB）" }

# 8. 数据目录
$data = Join-Path $env:USERPROFILE '.dsh\digital-human-studio'
if (Test-Path $data) { Ok "工作目录 $data" } else { Warn2 "工作目录还没建（首次启动会自动建）" }

Write-Host ""
if ($Fatal -gt 0) { Write-Host "结论：$Fatal 项缺（产品跑不起来）" -ForegroundColor Red; exit 1 }
if ($Warn -gt 0)  { Write-Host "结论：能跑，$Warn 项可选功能还没装" -ForegroundColor Yellow; exit 2 }
Write-Host "结论：全部就绪" -ForegroundColor Green
exit 0
