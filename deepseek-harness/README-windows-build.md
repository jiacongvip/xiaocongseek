# Xiaocongseek Windows x64 未签名测试包

## 先看结论

Windows 安装包**只能在 Windows x64 机器上打**。仓库里 `apps/desktop/scripts/package-target.ts` 有硬性校验：

```
desktop package: win-x64 requires a Windows x64 build host
```

原因是打包过程要在宿主机准备 Windows 原生依赖（koffi / sharp / node-pty 的 win 二进制）、Windows 运行时和 NSIS 安装器编译器，Mac 上交叉打包一律被拒。Linux 也不是受支持的桌面目标。

所以：**找一台 Windows 10/11 x64 电脑（或 Windows 云主机），把本压缩包解压过去，跑一条脚本。**

## 机器要求

| 项 | 要求 |
|---|---|
| 系统 | Windows 10/11 x64，或 Windows Server 2022 x64（云主机可行） |
| Node | **24.x**（`node -v` 必须是 v24.*） |
| pnpm | **11.x**（仓库锁定 pnpm@11.28.5，用 `corepack enable` 最稳） |
| Git | 任意版本（打包要读 commit 信息） |
| PowerShell | **7**（`pwsh`），不是系统自带 5.1 |
| Python | 3.11+，且加入 PATH（否则设 `PYTHON` 环境变量） |
| 编译工具 | Visual Studio Build Tools 的「使用 C++ 的桌面开发」+ Windows SDK |
| 其他 | tar（Win10+ 自带 `C:\Windows\System32\tar.exe`）、能访问 npm registry |

磁盘至少留 15 GB（依赖 2.5 GB + 运行时准备 + 打包产物）。

## 打包步骤

解压后**在仓库根目录**（能看到 `package.json`、`build-win.ps1` 的那层）打开 PowerShell 7：

```powershell
# 1) 先预检（检查 Node/pnpm/配置/外部工具，不构建）
pwsh -File .\build-win.ps1 -CheckOnly

# 2) 正式打包（依赖安装 + 完整构建 + 安装包）
pwsh -File .\build-win.ps1
```

脚本做的事等价于手动三条命令：

```powershell
pnpm install --frozen-lockfile
pnpm run package:desktop:win:x64:unsigned -- --check
pnpm run package:desktop:win:x64:unsigned
```

打包命令内部会自己跑完整构建（`build --profile local`），**不需要**手动 build:lib。

## 产物

```
apps\desktop\.desktop-build\targets\win-x64\unsigned-artifacts\<name>-0.2.2-rc.1-win-x64-unsigned.exe
```

双击安装即可。未签名包首次运行会被 SmartScreen 拦：点「更多信息」→「仍要运行」。
阶段日志在 `apps\desktop\.desktop-build\packaging-runs\`，构建成功不等于安装包验收通过。

## 配置（已预填）

`apps\desktop\.env.windows` 已填好，关键字段：

```
DSH_DESKTOP_APP_ID=com.xiaocong.seek
DSH_DESKTOP_AUTO_UPDATE_ENV=test
DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN=https://xiaocongapi.azheteng.cn
DSH_DESKTOP_MANDATORY_UPDATE_CONFIG='{"allowedAuthOrigins":["https://xiaocongapi.azheteng.cn"]}'
```

未签名模式不读签名相关字段。若 `--check` 报错，按提示改这个文件即可（origin 必须是纯 `https://域名` 形式，不能带路径/查询）。

网络慢时可选镜像（在 PowerShell 里先设再打包）：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS = "600000"
```

## 这台 Windows 包能测什么

可以测：整体界面、品牌文案（小葱 / Xiaocong / Xiaocongseek）、登录、对话、剪辑台、MCP 服务、更新面板的「检查更新」、下载进度条，以及「运行安装器」。

Windows 的更新包走 `exeUrl` 字段（macOS 走 `dmgUrl`）。下载完成后按钮文案是「运行安装器」，点击会直接拉起下载好的 `.exe` 安装向导；安装器若提示「程序正在运行」，先退出 Xiaocongseek 再继续。macOS 上的同一按钮仍是「安装更新」，行为是挂载 DMG。

## 在 Windows 上验证更新链路（可选）

打包出 exe 之后，想验证「发现新版本 → 下载进度条 → 运行安装器」这套流程，用仓库自带的本地测试源：

1. 建一个目录（如 `C:\xcy-feed`），把刚打出的 exe 和 `test-feed.mjs`、`generate-latest.mjs` 放进去。
2. 生成指向本机的清单，`version` 要大于已安装的 `0.2.2-rc.1`（例如 `0.2.3`）：

```powershell
node generate-latest.mjs --exe .\xiaocongseek-0.2.2-rc.1-win-x64-unsigned.exe `
  --base http://127.0.0.1:18948 --version 0.2.3 --out latest.json
```

3. 启动测试源（限速约 12 MB/s，300 MB 的包大约 30 秒走完，进度条看得见）：

```powershell
node test-feed.mjs
```

4. 带环境变量启动已安装的 App，让它去读本地测试源：

```powershell
set XIAOCONG_UPDATE_URL=http://127.0.0.1:18948/latest.json
& "$env:LOCALAPPDATA\Programs\Xiaocongseek\Xiaocongseek.exe"
```

5. 设置 → 通用设置 → 更新检测 → 检查更新（显示「发现新版本 0.2.3」）→ 下载更新（进度条走动）→ 运行安装器（弹出安装向导）。

注意这一步只验证链路：测试源里的安装包还是 0.2.2-rc.1，装完版本号不会变。

## 没有 Windows 电脑时的备选

1. 云 Windows 主机：腾讯云/阿里云买一台 Windows Server 2022 x64（8C16G，按量计费），远程桌面进去装工具，同上流程打包，出包后拷回本机再用。
2. 仓库自带 GitHub Actions 工作流 `.github/workflows/windows-package.yml`，但它绑定自托管 runner 标签 `dsh-win-package-trial`，需要自建 Windows runner，不适合临时验证。
3. 交叉打包（Mac 上直接出 exe）**不支持**，不要尝试绕过平台校验。

## 版本号

当前源码版本 `0.2.2-rc.1`（apps/desktop 与根 package.json 一致）。测试包默认沿用；要换版本号时传 `-- --build-version <版本>`，且必须与源码版本前缀匹配。
