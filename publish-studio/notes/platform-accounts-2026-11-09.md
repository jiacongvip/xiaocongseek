# 平台账号功能落地（2026-11-09 13:00 Asia/Shanghai）

用户授权：「你弄下」(pt33u)。

## 可用入口
- 数字人工作台右侧竖菜单「平台账号」→ DigitalHumanPlatformAccounts
- 动作经 /digital-human-studio/publication-management → studio.accounts.* → publish-studio accounts.*
- QR：/publish-studio/login-qr（需 3080 加载新 publish-studio 后）

## 已实现平台/方法
- 21 平台，全部 browser_official_login（官方页受控浏览器，非捏造 QR）
- 成功判定：personal_url/离开登录页 + storage_state；关闭窗口不算成功

## 测试
- PASS：independence / service / platform-login（mock runner）
- PASS：publish-nav / publication-runtime / DH bridge 7
- 前端 HTTP 已提供含「添加并登录」「studio.accounts.login.start」的新 bundle
- 未实登；未重启 3080（PID 8021）；login-qr 现 404 待重启

## 缺依赖
- 本机已可 import playwright；真实登录仍需 Chromium 内核可用，缺则 failed+missing，不回退 GEO

## 备份
- .backup-platform-accounts-20261109-124556
- .backup-platform-accounts-20261109-fix-render
