# BiliGo 官方网页 DOM 摘录说明

- 上游仓库：https://github.com/Chiyang001/BiliGo
- 采用提交：`7b95f3057659b0febecc25f47940fc79e2c7e07d`（2026-11-05 21:57，Asia/Shanghai；核实时仍为默认分支最新提交）
- 来源文件（仅远程只读，未 clone、未整仓下载、未安装或运行上游 bot）：
  - https://github.com/Chiyang001/BiliGo/blob/7b95f3057659b0febecc25f47940fc79e2c7e07d/douyin_playwright.py
  - https://github.com/Chiyang001/BiliGo/blob/7b95f3057659b0febecc25f47940fc79e2c7e07d/xiaohongshu_playwright.py
- 授权：用户已说明已取得上游使用授权（对话 t163 / pt163u）。本目录不伪造 MIT 或其他开源许可证；BiliGo 仓库本身未见 LICENSE。授权使用不等于允许绕过本产品控制、读取 Cookie/令牌、调用私有接口，或自动发送消息。

## 采用范围

只摘录官方网页可见 DOM 的列表读取所需信息：

- 抖音私信页：`https://www.douyin.com/message`
- 小红书私信页：`https://www.xiaohongshu.com/chat`
- 会话列表 CSS/属性选择器，以及空列表、登录墙的可见文案提示

详见同目录 `extracted-dom.json`。

## 明确不采用、也不会在运行时执行

- 私有/网页内部 IM 接口常量与请求（例如小红书 edith 接口、监听页面 IM JSON 响应）
- 签名、Cookie/storage 导出、用 Cookie 另开通道
- 反检测/隐匿 webdriver、绕过验证码
- 发送路径（填写输入框、点击发送、图片发送等）。上游虽有发送实现，本产品不触发发送适配能力
- B 站评论 Cookie/WBI 接口（不能搬来当抖音或小红书评论）
- 上游完整 bot、安装脚本、自动回复循环

完整上游文件因混有上述不采用内容，不放入本仓库 vendor。运行代码只引用本目录的 DOM 摘录，并仍标记为「待页面验证」。
