/**
 * Shell-owned sign-in pages.
 *
 * These used to be rendered by the digital-human-studio plugin, which meant a
 * missing/failed plugin turned sign-in into a 404. They are now plain string
 * builders owned by the Host, self-contained (inline logo, no plugin assets),
 * and they call only shell routes.
 */

import { ROUTE } from './shared.js'

/** Inline mark: no plugin asset URL, so the page renders with no plugin installed. */
const MARK = `<svg class="mark" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><defs><linearGradient id="xg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b8cff"/><stop offset="1" stop-color="#4d6bfe"/></linearGradient></defs><rect x="4" y="4" width="40" height="40" rx="12" fill="url(#xg)"/><path d="M17 16l7 8-7 8M31 16l-7 8 7 8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></rect></svg>`

/**
 * Confirm page: reached with a XiaocongAPI session already present.
 * Confirming claims the key and lands on the success page instead of the console.
 * @param returnUrl Local harness URL the flow returns to.
 * @param loginUrl XiaocongAPI `/login?redirect=` used by "switch account".
 */
export function authorizePageHtml(returnUrl: string, loginUrl: string): string {
  const safeReturn = JSON.stringify(returnUrl)
  const safeLogin = JSON.stringify(loginUrl)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>授权登录 · Xiaocongseek</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; background: #f7f8fa; color: #1f1f1f; }
    body { display: flex; flex-direction: column; min-height: 100vh; }
    .banner { background: #eaf3ff; color: #3b6ea5; font-size: 13px; line-height: 1.55; padding: 10px 20px; text-align: center; border-bottom: 1px solid #d6e7ff; }
    .main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 20px 64px; }
    .brand { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-bottom: 28px; }
    .brand .mark { height: 56px; width: 56px; display: block; }
    .brand .logo { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: #4d6bfe; }
    .title { margin: 0 0 28px; font-size: 16px; color: #333; font-weight: 500; }
    .card { width: min(420px, 100%); background: #f0f1f3; border-radius: 14px; padding: 14px 14px 14px 16px; display: flex; align-items: center; gap: 12px; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg,#6b8cff,#4d6bfe); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 16px; flex-shrink: 0; overflow: hidden; }
    .meta { flex: 1; min-width: 0; }
    .name { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { margin-top: 2px; font-size: 12px; color: #8a8a8a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .login-btn { appearance: none; border: 0; border-radius: 8px; background: #111; color: #fff; height: 36px; padding: 0 18px; font-size: 14px; font-weight: 600; cursor: pointer; flex-shrink: 0; }
    .login-btn:disabled { opacity: .55; cursor: default; }
    .login-btn:not(:disabled):hover { background: #2a2a2a; }
    .legal { margin-top: 18px; font-size: 12px; color: #9a9a9a; }
    .legal a { color: #333; text-decoration: underline; text-underline-offset: 2px; }
    .switch { margin-top: 28px; font-size: 14px; color: #4d6bfe; background: none; border: 0; cursor: pointer; padding: 0; }
    .switch:hover { text-decoration: underline; }
    .status { margin-top: 16px; font-size: 13px; color: #8a8a8a; min-height: 1.2em; }
    .status.error { color: #c0392b; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="banner">请确认你信任当前客户端。完成登录后，它将获得调用 XiaocongAPI 模型的账号授权，来源不明或经修改的客户端可能滥用授权凭证，产生未经授权的调用及费用。</div>
  <div class="main">
    <div class="brand">${MARK}<span class="logo">Xiaocongseek</span></div>
    <p class="title">使用 XiaocongAPI 账号登录 Xiaocongseek</p>
    <div id="card" class="card hidden">
      <div class="avatar" id="avatar">N</div>
      <div class="meta">
        <div class="name" id="name">—</div>
        <div class="sub" id="sub">XiaocongAPI 会话已就绪</div>
      </div>
      <button type="button" class="login-btn" id="login">登录</button>
    </div>
    <div class="legal">注册登录即代表已阅读并同意我们的 <a href="https://www.deepseek.com/zh/user-agreement" target="_blank" rel="noopener">用户协议</a> 与 <a href="https://www.deepseek.com/zh/privacy" target="_blank" rel="noopener">隐私政策</a></div>
    <button type="button" class="switch" id="switch">切换其他账号登录</button>
    <div class="status" id="status">正在检查登录状态…</div>
  </div>
  <script>
    (function () {
      var returnUrl = ${safeReturn};
      var loginUrl = ${safeLogin};
      var accessToken = null;
      var userId = null;
      var username = null;
      var statusEl = document.getElementById('status');
      var card = document.getElementById('card');
      var loginBtn = document.getElementById('login');
      var nameEl = document.getElementById('name');
      var subEl = document.getElementById('sub');
      var avatarEl = document.getElementById('avatar');

      var autoClaim = false;
      try { autoClaim = new URLSearchParams(location.search).get('auto') === '1'; } catch (e) {}

      function setStatus(text, isError) {
        statusEl.textContent = text || '';
        statusEl.className = 'status' + (isError ? ' error' : '');
      }

      function showUser(user) {
        username = (user && (user.username || user.display_name || user.name)) || 'XiaocongAPI';
        var display = username;
        var contact = (user && (user.email || user.phone || user.remark)) || '';
        nameEl.textContent = display;
        subEl.textContent = contact || ('用户 ID ' + (user && user.id != null ? user.id : '—'));
        var initial = String(display).trim().charAt(0) || 'N';
        avatarEl.textContent = initial.toUpperCase();
        card.classList.remove('hidden');
        setStatus('');
      }

      function authorizedHref() {
        var u = new URL(${JSON.stringify(ROUTE.authorized)}, location.origin);
        u.searchParams.set('return', returnUrl);
        return u.toString();
      }

      function notifyClaimed() {
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'dsh-newapi-claimed', username: username || 'XiaocongAPI' }, returnUrl);
          }
        } catch (e) {}
      }

      function claimFromHash() {
        var raw = String(location.hash || '').replace(/^#/, '');
        if (!raw) return null;
        var q;
        try { q = new URLSearchParams(raw); } catch (e) { return null; }
        var token = q.get('dsh_access_token');
        var id = Number(q.get('dsh_user_id'));
        if (!token || !id) return null;
        return { token: token, userId: id, username: q.get('dsh_username') || '' };
      }

      async function loadSession() {
        setStatus('正在检查登录状态…');
        try {
          var refresh = await fetch(${JSON.stringify(ROUTE.refresh)}, {
            method: 'POST', credentials: 'include',
            headers: { 'content-type': 'application/json' },
          });
          if (refresh.status === 429) {
            setStatus('请求过于频繁，请稍后再试（429）', true);
            return;
          }
          if (!refresh.ok) {
            if (autoClaim) {
              setStatus('未检测到有效会话，请使用其他账号登录', true);
              return;
            }
            try { location.replace(loginUrl); } catch (e2) { location.href = loginUrl; }
            return;
          }
          var payload = await refresh.json().catch(function () { return null; });
          var data = (payload && payload.data) || payload || {};
          accessToken = data.access_token || data.token || null;
          var user = data.user || data;
          userId = user && user.id;
          if (!accessToken || !userId) {
            setStatus('会话无效，请使用其他账号登录', true);
            return;
          }
          showUser(user);
          if (autoClaim) loginBtn.click();
        } catch (e) {
          setStatus('检查登录状态失败，请重试', true);
        }
      }

      loginBtn.addEventListener('click', async function () {
        if (!accessToken || !userId) return;
        loginBtn.disabled = true;
        setStatus('正在授权…');
        try {
          var claimRes = await fetch(${JSON.stringify(ROUTE.claim)}, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              accessToken: accessToken,
              userId: userId,
              username: username,
            }),
          });
          var claimed = await claimRes.json().catch(function () { return null; });
          if (!(claimed && claimed.success && claimed.hasToken)) {
            setStatus((claimed && claimed.error) || '授权失败，请重试', true);
            loginBtn.disabled = false;
            return;
          }
          if (claimed.username) username = claimed.username;
          notifyClaimed();
          location.replace(authorizedHref());
        } catch (e) {
          setStatus('授权失败，请重试', true);
          loginBtn.disabled = false;
        }
      });

      document.getElementById('switch').addEventListener('click', async function () {
        setStatus('正在切换账号…');
        try {
          await fetch(${JSON.stringify(ROUTE.clearSession)}, {
            method: 'POST', credentials: 'include',
            headers: { 'content-type': 'application/json' },
          });
        } catch (e) {}
        try { location.replace(loginUrl); } catch (e2) { location.href = loginUrl; }
      });

      var hashed = claimFromHash();
      if (hashed) {
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
        accessToken = hashed.token;
        userId = hashed.userId;
        showUser({ username: hashed.username, id: hashed.userId });
        loginBtn.click();
      } else {
        loadSession();
      }
    })();
  </script>
</body>
</html>`
}

/** Post-login page shown in the popup / external browser once the claim landed. */
export function authorizedPageHtml(returnUrl: string): string {
  const safeReturn = JSON.stringify(returnUrl)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>登录成功</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; background: #0f0f0f; color: #f5f5f5; }
    body { display: flex; min-height: 100%; }
    .panel { width: min(520px, 100%); padding: 48px 40px; display: flex; flex-direction: column; justify-content: center; background: #161616; }
    .hero { flex: 1; display: none; background: #0a0a0a; position: relative; overflow: hidden; }
    @media (min-width: 900px) { .hero { display: block; } }
    .hero::after { content: "欢迎使用 Xiaocongseek / XiaocongAPI 已授权"; position: absolute; inset: auto 48px 64px 48px; color: rgba(255,255,255,.28); font-size: 22px; line-height: 1.5; }
    .brand { display: flex; align-items: center; gap: 12px; font-size: 14px; letter-spacing: .08em; color: rgba(255,255,255,.55); margin-bottom: 48px; text-transform: uppercase; }
    .brand .mark { height: 48px; width: 48px; display: block; }
    h1 { margin: 0 0 16px; font-size: 40px; font-weight: 600; }
    p { margin: 0 0 36px; color: rgba(255,255,255,.62); font-size: 16px; line-height: 1.6; }
    button { appearance: none; border-radius: 10px; background: #111; color: #fff; border: 1px solid rgba(255,255,255,.14); width: 100%; height: 48px; font-size: 16px; cursor: pointer; }
    button:hover { background: #1c1c1c; }
    .hint { margin-top: 18px; font-size: 13px; color: rgba(255,255,255,.38); }
  </style>
</head>
<body>
  <section class="panel">
    <div class="brand">${MARK}<span>Xiaocongseek · XiaocongAPI</span></div>
    <h1>登录成功</h1>
    <p>已连接到 Xiaocongseek，请关闭此页面并回到桌面端继续。</p>
    <button type="button" id="open-app">打开 Xiaocongseek</button>
    <div class="hint">桌面端会自动完成登录，这个页面不需要再做其他操作。</div>
  </section>
  <aside class="hero" aria-hidden="true"></aside>
  <script>
    (function () {
      var returnUrl = ${safeReturn};
      function go() {
        try {
          if (window.opener && !window.opener.closed) {
            try { window.opener.focus(); } catch (e) {}
            try { window.opener.postMessage({ type: 'dsh-newapi-authorized' }, returnUrl); } catch (e) {}
          }
        } catch (e) {}
        try { location.href = 'dsh://open'; } catch (e) {}
      }
      // 交给用户自己决定何时离开，不自动关窗/跳转，避免页面一闪而过。
      document.getElementById('open-app').addEventListener('click', go);
    })();
  </script>
</body>
</html>`
}

/**
 * Silent hop that names the browser window before handing it to the console.
 *
 * The console only appends its transient token when the receiving window is named
 * `dsh-newapi-login`; `shell.openExternal` opens an unnamed window, so this page
 * sets the name first and then forwards to the console `/login` page. The name and
 * the loopback referrer both survive the cross-origin redirect, which lets the
 * console rebuild the legacy approve URL on its own.
 *
 * @param loginUrl Console `/login?redirect=` address that leads back to the shell.
 * @returns a one-line redirect page carrying no credentials.
 */
export function bootstrapPageHtml(loginUrl: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>正在打开登录…</title>
  <style>
    :root { color-scheme: light dark; }
    html, body { margin: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
    body { display: flex; align-items: center; justify-content: center; color: #8a8a8a; font-size: 14px; background: Canvas; }
  </style>
</head>
<body>
  <div>正在打开 XiaocongAPI 登录…</div>
  <script>
    try { window.name = 'dsh-newapi-login' } catch (e) {}
    try { location.replace(${JSON.stringify(loginUrl)}) } catch (e) {}
  </script>
</body>
</html>`
}
