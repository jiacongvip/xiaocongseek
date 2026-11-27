# Windows 打包与运行

同一套代码，Mac 包和 Windows 包的区别只有「外部二进制」和「启动脚本」，业务代码已经做了平台分支。

## 一、Windows 包里要替换的 4 个东西

| 位置 | 现在（Mac） | Windows 要换成 | 从哪拿 |
|---|---|---|---|
| `digital-human-studio/vendor/runtime/bin/ffmpeg` `ffprobe` | mac 版 | `ffmpeg.exe` `ffprobe.exe`（必须带 libass） | gyan.dev 的 `ffmpeg-release-full`（full 版默认含 libass） |
| `digital-human-studio/vendor/runtime/node/` | mac 版 node | `node.exe`（v22+） | 让客户跑 `scripts\install-node.bat`，或直接放 node-v22-win-x64 解压后的整个目录 |
| `digital-human-studio/vendor/runtime/cpython-3.12*` | mac standalone | `cpython-3.12*-win64`（含 `python.exe`） | python-build-standalone 的 windows 版；或让客户装 Python 3.12 后跑 bootstrap |
| `~/.dsh/publish-studio/runtime`（613M Chromium） | 按需装 | 按需装（Playwright 会自动选 Windows 版） | 准备页「发布运行时」点安装即可，不用打包 |

**不要打进 Windows 包**：`vendor/vectcut/font-pack`（655M 字体扩展包）、`vendor/vectcut/.venv`（Mac 的 venv，换平台必断）。

## 二、随包要带的

- `digital-human-studio/vendor/vectcut/fonts/`：8 款核心字体，约 150MB
- `digital-human-studio/vendor/vectcut/fonts-cdn.json`：27 款扩展字体的七牛分片索引，15KB，点选下载时用
- `digital-human-studio/vendor/vectcut/` 其余引擎代码、`vendor/media-crawler/`

## 三、客户机上的流程

```
1) 解压整个仓库（路径别带空格以外的怪字符，中文可以）
2) scripts\bootstrap-product.bat     # 建两套 venv + 装依赖（走清华源）
3) scripts\doctor-product.bat        # 体检：node / 引擎 / ffmpeg / 字体 / 模型
4) scripts\start-product.bat         # 起 3080，自动开浏览器
5) 打开后进「准备」页，缺什么点什么（转写模型、发布运行时都是按需下）
```

没有 Node 的话先跑 `scripts\install-node.bat`（下 node-v22-win-x64.zip 解压到 `%USERPROFILE%\.dsh\runtime\node`）。

## 四、代码侧已经处理的平台差异

- `src/platform.ts` 收口了 venv 解释器路径：Windows `.venv\Scripts\python.exe`，其它 `.venv/bin/python`
- 找可执行文件：Windows 用 `where`，其它用 `which`（`whichSync`）
- 装 Node：Windows 走「官方 zip + PowerShell 解压」，不走 bash
- 系统字体回退：Windows 补了 `C:/Windows/Fonts/msyh.ttc`、`simhei.ttf`、`simsun.ttc`；前端 Helvetica Neue 在 Windows 回落到 Arial
- 引擎启动提示命令：Windows 用 `cd /d ... && .venv\Scripts\python.exe`，Mac 用原写法

## 五、已知坑

- **路径长度**：Windows 默认 260 字符上限，工程目录别埋太深；必要时开 `LongPathsEnabled`
- **中文路径**：Python 侧已用 UTF-8，但第三方库（个别 pip 包）打印日志可能乱码，不影响出片
- **ffmpeg 必须带 libass**：否则字幕烧不进去。装完用 `ffmpeg -version` 看有没有 `--enable-libass`
- **首次启动慢**：引擎要 import flask + faster-whisper，Windows 上冷启动 10–20 秒属正常
- **采集模块**：MediaCrawler 的 Chromium 要单独 `python -m playwright install chromium`，约 120MB
