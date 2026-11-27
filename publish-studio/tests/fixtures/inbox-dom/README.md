# Controlled inbox / comment DOM fixtures

These HTML files are **synthetic samples**. They are not captured from a live Douyin or Xiaohongshu account, and they contain no real user messages or comments.

They only reproduce a **public DOM shape** already documented in licensed or authorized excerpts, or official visible chrome (tab labels) used to prove a negative case:

- Douyin / Xiaohongshu **private message** lists: BiliGo-authorized selectors (see `publishing/vendor/biligo-dom/`).
- Douyin **creator comment management**: MediaMate MIT selectors (see `publishing/vendor/mediamate-dom/`).
- Xiaohongshu **note-page** `comments-container` fixtures exist only to prove they must **not** be treated as the notification inbox list.
- `xhs-notification-chrome.html` reproduces official visible tabs 「评论和@」「赞和收藏」「新增关注」 and `.reds-tab-item`. It has no list-item contract. Parsing it must return `selector_mismatch`, never an empty success.

Passing these fixtures is not live page verification. A collector reading a fixture is not a real-page sample.
