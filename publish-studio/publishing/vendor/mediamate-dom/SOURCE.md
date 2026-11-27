# MediaMate comment DOM excerpt

This directory holds a **read-only excerpt** of official-page comment list selectors from MediaMate. It is not a checkout of that repository, and this product does not install or run MediaMate, its auto-reply, or any send path.

## Source

- Repository: https://github.com/git-rumengai/MediaMate
- Default-branch commit: `5504d3374f9294c3dfbc2c3077413d9e8216dbe7`
- Commit time: 2024-09-11 13:13:40 Asia/Shanghai (commit stamped 2024-09-11 05:13:40 UTC)
- License: MIT, with an actual `LICENSE` file in the upstream repository
- Copyright: Copyright (c) 2024 RuMengAI

The MIT license grants use, copy, and modification, provided the copyright notice and permission notice are included in all copies or substantial portions. That notice is reproduced below and in `extracted-dom.json`.

## What was adopted

Only facts needed to map a **visible official-page comment list** for personal Douyin / Xiaohongshu accounts:

- Douyin creator-center comment management list selectors from `mediamate/static/elements/douyin/creator.yaml` (comment_list / username / content / empty and page-chrome hints).
- Xiaohongshu official note-page comment list selectors from `mediamate/static/elements/xiaohongshu/home.yaml` (comments-container, author, content, no-comments-text).

Upstream raw files (for attribution, not executed here):

- https://github.com/git-rumengai/MediaMate/blob/5504d3374f9294c3dfbc2c3077413d9e8216dbe7/mediamate/static/elements/douyin/creator.yaml
- https://github.com/git-rumengai/MediaMate/blob/5504d3374f9294c3dfbc2c3077413d9e8216dbe7/mediamate/static/elements/xiaohongshu/home.yaml
- https://github.com/git-rumengai/MediaMate/blob/5504d3374f9294c3dfbc2c3077413d9e8216dbe7/LICENSE

## Official comment page URLs recorded with this excerpt

- Douyin comment management (official creator center, 互动管理 / 评论管理): `https://creator.douyin.com/creator-micro/interactive/comment`. This matches the MediaMate creator-center `#comment_manage` page, and is the public official URL for that function.
- Xiaohongshu comment notifications (official www host): `https://www.xiaohongshu.com/notification?type=comment`. The URL was independently fetched on 2026-11-10 (Asia/Shanghai) and returned official logged-out Notifications chrome, so the address exists on the official host. It was also cited as a public URL fact in `Fisher0012/xhs-auto-reply`. That repository has **no LICENSE file**; **no code, selectors, or wording were copied from it**. `mustcanbedo/comment_copilot` likewise has **no GitHub LICENSE** (license field is null); **no code was copied**. User authorization obtained for BiliGo does **not** cover these other projects.

MediaMate itself maps Xiaohongshu comments on the official **note detail** comment list, not the notification inbox. Selectors for the notification list therefore remain **pending live page verification** and are not guessed as already verified. The parseable Xiaohongshu comment shape in this excerpt is the MediaMate MIT note-page list.

## Explicitly excluded

- Reply / send / textarea locators and any auto-send or auto-reply logic
- Cookie, token, or login-store export
- Private or hidden HTTP APIs, signature reverse-engineering, XHR sniffing
- Anti-detection, CAPTCHA bypass, webdriver hiding
- Running MediaMate, launching a real browser, or reading a live account

Mapping plus fixture tests is **not** live page verification. Status stays “已适配，待实页验证” until a coordinated real-page walkthrough is done.

## MIT license text (upstream)

MIT License

Copyright (c) 2024 RuMengAI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
