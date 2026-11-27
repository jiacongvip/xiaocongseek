# 小葱剪辑台 · Windows 换机自愈
#   把整个仓库复制到新机器后跑一次：
#   powershell -ExecutionPolicy Bypass -File scripts\bootstrap-product.ps1
#
# 做三件事：
#   1. 用插件自带的 standalone Python（vendor\runtime\cpython-3.12*-win64）重建两套 venv
#      —— venv 里的解释器路径是绝对的，换机必断，只能重建，不能复制。
#   2. 装依赖（联网走清华源）。
#   3. 跑一遍 scripts\doctor-product.ps1。
# 幂等：已经能用的 venv 不会被重建。
$ErrorActionPreference = 'Stop'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $Here
$PluginDir = Join-Path $RepoRoot 'digital-human-studio'
$Mirror = 'https://pypi.tuna.tsinghua.edu.cn/simple'

function Find-Python {
  $hits = Get-ChildItem (Join-Path $PluginDir 'vendor\runtime') -Directory -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -like 'cpython-3.12*win*' } |
          ForEach-Object { Join-Path $_.FullName 'python.exe' } |
          Where-Object { Test-Path $_ }
  if ($hits) { return $hits[0] }
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) { return $py.Source }
  return $null
}

$Python = Find-Python
if (-not $Python) {
  Write-Host "❌ 这台机器上没有 Python。装一个 3.12（勾选 Add to PATH）后重跑。" -ForegroundColor Red
  exit 1
}
Write-Host "python: $Python"

function New-Venv($venvPath) {
  if (Test-Path (Join-Path $venvPath 'Scripts\python.exe')) { return }
  Write-Host "→ 建 venv：$venvPath"
  & $Python -m venv $venvPath
}

# ── 1. 引擎 venv（flask / faster-whisper / pillow）
$engineVenv = Join-Path $PluginDir 'vendor\vectcut\.venv'
$enginePy = Join-Path $engineVenv 'Scripts\python.exe'
$engineOk = $false
if (Test-Path $enginePy) {
  & $enginePy -c "import flask, faster_whisper, PIL" 2>$null
  if ($LASTEXITCODE -eq 0) { $engineOk = $true }
}
if (-not $engineOk) {
  if (Test-Path $engineVenv) { Remove-Item $engineVenv -Recurse -Force }
  New-Venv $engineVenv
  $req = Join-Path $PluginDir 'vendor\vectcut\requirements.txt'
  if (Test-Path $req) {
    & $enginePy -m pip install --upgrade pip -i $Mirror
    & $enginePy -m pip install -r $req pillow faster-whisper -i $Mirror
  } else {
    & $enginePy -m pip install --upgrade pip -i $Mirror
    & $enginePy -m pip install flask psutil imageio requests pillow faster-whisper -i $Mirror
  }
  & $enginePy -c "import flask, faster_whisper, PIL"
  if ($LASTEXITCODE -ne 0) { Write-Host "❌ 引擎依赖装完但 import 失败" -ForegroundColor Red; exit 1 }
}
Write-Host "✅ 引擎 venv 就绪" -ForegroundColor Green

# ── 2. 采集 venv（httpx / playwright / pandas）
$mcRoot = Join-Path $PluginDir 'vendor\media-crawler'
if (Test-Path $mcRoot) {
  $mcVenv = Join-Path $mcRoot '.venv'
  $mcPy = Join-Path $mcVenv 'Scripts\python.exe'
  $mcOk = $false
  if (Test-Path $mcPy) {
    & $mcPy -c "import httpx" 2>$null
    if ($LASTEXITCODE -eq 0) { $mcOk = $true }
  }
  if (-not $mcOk) {
    if (Test-Path $mcVenv) { Remove-Item $mcVenv -Recurse -Force }
    New-Venv $mcVenv
    $req = Join-Path $mcRoot 'requirements.txt'
    & $mcPy -m pip install --upgrade pip -i $Mirror
    if (Test-Path $req) { & $mcPy -m pip install -r $req -i $Mirror } else { & $mcPy -m pip install httpx pandas -i $Mirror }
    Write-Host "→ 采集浏览器（可选，约 120MB）：& $mcPy -m playwright install chromium"
  }
  Write-Host "✅ 采集 venv 就绪" -ForegroundColor Green
}

# ── 3. 界面依赖（tsx 在 deepseek-harness/node_modules，Mac 的装不上 Windows）
$HarnessDir = Join-Path $RepoRoot 'deepseek-harness'
$TsxPkg = Join-Path $HarnessDir 'node_modules\tsx\package.json'
$NodeExe = Join-Path $PluginDir 'vendor\runtime\node\node.exe'
if (-not (Test-Path $TsxPkg)) {
  if (-not (Test-Path $NodeExe)) {
    Write-Host "❌ 缺 node.exe，界面依赖装不了" -ForegroundColor Red
    exit 1
  }
  $Corepack = Join-Path $PluginDir 'vendor\runtime\node\node_modules\corepack\dist\corepack.js'
  Write-Host "→ 安装界面依赖（pnpm，首次需要联网，大约几分钟）"
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
  Push-Location $HarnessDir
  & $NodeExe $Corepack pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "❌ pnpm install 失败" -ForegroundColor Red; exit 1 }
  Pop-Location
}
if (-not (Test-Path $TsxPkg)) { Write-Host "❌ 装完仍然没有 tsx" -ForegroundColor Red; exit 1 }
Write-Host "✅ 界面依赖就绪" -ForegroundColor Green

# ── 4. 体检
& (Join-Path $Here 'doctor-product.ps1')
