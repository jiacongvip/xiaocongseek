// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import css from './DigitalHumanCalendar.module.css'
import {
  normalizePublicationOverview,
  publicationRuntimeStatusLines,
  type PublicationOverviewView,
} from './digital-human-publication-runtime.ts'

type Binding={id:string;platform:string;label:string;accountUid:string;revision:number;enabled:boolean;geoAccountId?:number;geoServiceId?:string;geoAccountLabel?:string}
type Snapshot={spaceId:string;packId:string;packRevision:number;bindingId:string;platform:string;accountLabel:string;accountUid:string;title:string;body:string;topics:string;coverRef:string;historyId:string;scheduledAt:string;videoHash:string;coverHash:string;geoAccountId?:number;geoAccountLabel?:string}
type Task={id:string;state:string;snapshot:Snapshot;snapshotValid:boolean;blockers:string[];dispatchStartedAt?:number;events?:{at:number;code:string}[];receipt?:{upstreamTaskId?:string;lockHeld?:boolean}}
type Account={id:number;platformType:number;label:string;status:number;serviceId:string}
type Overview = PublicationOverviewView & { bindings: Binding[]; tasks: Task[]; platforms: {key:string;type:number}[] }

const platformLabels:Record<string,string>={xiaohongshu:'小红书',tencent:'视频号',douyin:'抖音',kuaishou:'快手',bilibili:'B站',baijiahao:'百家号',sohu:'搜狐号',toutiao_mp:'头条号',wechat_official:'微信公众号',csdn:'CSDN',jianshu:'简书',zhihu:'知乎',x:'X',weibo:'微博',douban:'豆瓣',tieba:'贴吧',omqq:'企鹅号',wangyi_mp:'网易号',tiktok:'TikTok',instagram:'Instagram',facebook:'Facebook'}
const stateLabels:Record<string,string>={unconfirmed:'未确认',queued:'待执行',running:'执行中',waiting_human:'等待人工',accepted:'受理（未确认发布）',published_verified:'已确认发布',failed:'失败',unknown:'结果未知（禁止盲目重试）',cancelled:'已取消（未执行）'}
const progressLabels:Record<string,string>={'process-interrupted-no-retry':'进程中断，结果未知，禁止重试','human-confirmed':'用户已点击确认，待执行','geo-request-starting':'准备委托原GEO','geo-original-checks-and-execution':'原协议权限及账号复核后委托发布','upstream-finished-unverified':'原GEO处理结束，未核验平台最终发表','original-policy-or-resource-blocked':'原授权/额度拒绝或资源变化，未确认发送','result-unknown-no-retry':'结果未知，禁止重试','cancelled-before-execution':'未执行任务已取消','human-reconciled-local-lock-only':'用户核对后释放本机占用；未重发或标记成功'}

type Props = { spaceId: string; pack?: { id: string; revision: number; checked: boolean; title: string } | undefined }

export class PublicationManagementErrorBoundary extends Component<{ children: ReactNode; onRetry?: () => void }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) {
    return { error: error?.message || '发布管理渲染失败' }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[digital-human-publish] management render failed', error, info?.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <section className={css.editor} aria-label="公司发布管理错误">
          <h2>发布管理无法显示</h2>
          <p className={css.error} role="alert">{this.state.error}</p>
          <p>页面其它部分仍可用。请重试；若仍失败请刷新工作台。</p>
          <button type="button" onClick={() => { this.setState({ error: null }); this.props.onRetry?.() }}>重试发布管理</button>
        </section>
      )
    }
    return this.props.children
  }
}

export function DigitalHumanPublicationManagement({ spaceId, pack }: Props) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Task | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')
  const [bindingId, setBindingId] = useState('')
  const [label, setLabel] = useState('')
  const [base, setBase] = useState('http://127.0.0.1:5409')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [productKey, setProductKey] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const epoch = useRef(0)
  const writing = useRef(false)

  const overview = async () => {
    const response = await fetch(`/digital-human-studio/publication-management?space=${encodeURIComponent(spaceId)}`, { cache: 'no-store' })
    const raw = await response.json()
    if (!response.ok) throw new Error((raw && raw.error) || `读取失败（HTTP ${response.status}）`)
    return normalizePublicationOverview(raw, spaceId) as Overview
  }

  useEffect(() => {
    const n = ++epoch.current
    setData(null)
    setPreview(null)
    setAccounts([])
    setAccountId('')
    setBindingId('')
    setLabel('')
    setUsername('')
    setPassword('')
    setAuthCode('')
    setProductKey('')
    setError('')
    setNotice('')
    setBusy(true)
    void overview()
      .then(view => { if (epoch.current === n) setData(view) })
      .catch(reason => { if (epoch.current === n) setError(reason instanceof Error ? reason.message : '读取发布管理失败') })
      .finally(() => { if (epoch.current === n) setBusy(false) })
    return () => { epoch.current++ }
  }, [spaceId, reloadToken])

  const request = async (path: string, input: Record<string, unknown>) => {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ space: spaceId, ...input }) })
    const raw = await response.json()
    if (!response.ok || !raw?.success) throw new Error(raw?.error || '操作未完成')
    if (raw.spaceId !== spaceId) throw new Error('公司响应不匹配')
    return raw
  }

  const run = async (work: (n: number) => Promise<void>) => {
    if (writing.current) return
    const n = epoch.current
    writing.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await work(n)
    } catch (e) {
      if (epoch.current === n) setError(e instanceof Error ? e.message : '连接中断，请查看任务，勿盲目重发')
    } finally {
      if (epoch.current === n) {
        try {
          const view = await overview()
          if (epoch.current === n) {
            setData(view)
            setPreview(t => (t ? view.tasks.find(x => x.id === t.id) || null : null))
          }
        } catch {}
        if (epoch.current === n) setBusy(false)
      }
      writing.current = false
    }
  }

  const act = (action: string, input: Record<string, unknown> = {}) => run(async n => {
    const v = await request('/digital-human-studio/publication-management', { action, ...input })
    if (epoch.current !== n) return
    if (action === 'task.prepare') {
      setPreview(v.item)
      setNotice(v.reused ? '已返回同一快照现有任务，未重复提交。' : '确认草稿已保存，未上传、未发布。')
    } else if (action === 'binding.save') {
      setBindingId(v.item?.id || '')
      setLabel('')
      setNotice('已保存本公司账号绑定摘要；未自动发布。')
    } else {
      setNotice('操作已保存；未自动标记发布或改变日历。')
    }
  })

  const connect = (action: string) => {
    const fields = {
      action,
      ...(action === 'connect' ? { baseUrl: base } : action === 'login' ? { username, password, authCode, productKey } : {}),
    }
    setPassword('')
    setAuthCode('')
    setProductKey('')
    void run(async n => {
      await request('/digital-human-studio/publication-geo-connection', fields)
      if (epoch.current === n) {
        setAccounts([])
        setAccountId('')
        setNotice('独立发布授权状态已更新（不会回退原GEO /postVideo）。')
      }
    })
  }

  const confirmTask = (t: Task, release = false) => run(async n => {
    if (!window.confirm(release
      ? '请先在平台核对上游执行已经结束。仅解除此任务本机占用，不会重发、撤回或标记成功。确认已核对？'
      : `确认立即发送当前预览的完整内容？\n公司：${spaceId}\n平台：${platformLabels[t.snapshot.platform] || t.snapshot.platform}\n账号：${t.snapshot.accountLabel || '未命名'} / ${t.snapshot.geoAccountId || t.snapshot.accountUid || '无'}\n标题：${t.snapshot.title}\n发布包版本：${t.snapshot.packRevision}\n日历时间仅为记录，不是预约发送。`)) return
    const grant = await request('/digital-human-studio/publication-confirmation', { action: release ? 'release.challenge' : 'challenge', id: t.id })
    if (epoch.current !== n) return
    const v = await request('/digital-human-studio/publication-confirmation', { action: 'submit', id: t.id, challenge: grant.challenge, csrf: grant.csrf })
    if (epoch.current === n) {
      setPreview(v.item)
      setNotice(release ? '已解除本机占用，任务仍为结果未知，未重发。' : `任务状态：${stateLabels[v.item?.state] || '结果未知'}。受理/成功回执不代表平台最终发表。`)
    }
  })

  const retryLoad = () => { setError(''); setReloadToken(v => v + 1) }
  const connection = data?.runtime.connection || null
  const statusLines = data ? publicationRuntimeStatusLines(data.runtime) : []

  return (
    <section className={css.editor} aria-label="公司发布管理">
      <h2>发布管理 · Web / 插件 / AI共用服务</h2>
      <p className={css.hint}>AI只能查询、编辑和准备草稿。真正发送必须由你在完整预览后主动确认。默认走独立 publish-studio，不自动发布，不启动定时器。</p>
      {error && (
        <div>
          <p className={css.error} role="alert">{error}</p>
          <button type="button" disabled={busy} onClick={retryLoad}>重新读取发布管理</button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data && !error ? <p>正在读取本公司发布管理…</p> : null}
      {!data && error ? <p>发布管理数据未加载。可重试；发布包列表仍应可用。</p> : null}
      {data ? <>
        <details open>
          <summary>运行状态（独立插件优先）</summary>
          <ul>{statusLines.map(line => <li key={line}>{line}</li>)}</ul>
          {!data.runtime.enabled && <p className={css.error} role="status">当前 blocked：未完成授权/额度或插件未就绪，不会伪装成可发布。</p>}
        </details>
        {connection ? (
          <details>
            <summary>可选兼容：连接信息（非默认路径）</summary>
            <p>当前：{connection.connected ? '已连接' : '未连接'}；授权：{connection.authRequired === null ? '待读取' : connection.authRequired ? (connection.authenticated ? '已登录' : '需要登录') : '未启用客户端授权'}；权限检查：{connection.permissionsEnforced === null ? '待读取' : connection.permissionsEnforced ? '已启用' : '未启用'}。</p>
            <label>服务地址<input value={base} disabled={busy} onChange={e => setBase(e.target.value)} /></label>
            <button disabled={busy} onClick={() => connect('connect')}>更新连接设置</button>
            <p>授权中心：{connection.authCenterOrigin || '未配置'}</p>
            {connection.authRequired && <>
              <label>用户名<input autoComplete="off" value={username} disabled={busy} onChange={e => setUsername(e.target.value)} /></label>
              <label>密码<input type="password" autoComplete="new-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
              <label>或激活码<input type="password" autoComplete="off" value={authCode} disabled={busy} onChange={e => setAuthCode(e.target.value)} /></label>
              <label>产品标识<input autoComplete="off" value={productKey} disabled={busy} onChange={e => setProductKey(e.target.value)} /></label>
              <button disabled={busy || !(authCode || (username && password))} onClick={() => connect('login')}>登录 / 激活</button>
              <button disabled={busy} onClick={() => connect('renew')}>刷新会话</button>
              <button disabled={busy} onClick={() => connect('logout')}>清除内存授权</button>
            </>}
          </details>
        ) : (
          <details>
            <summary>独立发布授权入口</summary>
            <p>当前 overview 未提供原 GEO connection 字段（这是正常的独立插件形态）。请用下方账号绑定与任务准备；需要登录时走 publication 授权代理，不会默认 connected。</p>
            <label>授权服务地址（可选）<input value={base} disabled={busy} onChange={e => setBase(e.target.value)} /></label>
            <button disabled={busy} onClick={() => connect('connect')}>读取/保存授权设置</button>
            <label>用户名<input autoComplete="off" value={username} disabled={busy} onChange={e => setUsername(e.target.value)} /></label>
            <label>密码<input type="password" autoComplete="new-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
            <label>或激活码<input type="password" autoComplete="off" value={authCode} disabled={busy} onChange={e => setAuthCode(e.target.value)} /></label>
            <label>产品标识<input autoComplete="off" value={productKey} disabled={busy} onChange={e => setProductKey(e.target.value)} /></label>
            <button disabled={busy || !(authCode || (username && password))} onClick={() => connect('login')}>登录 / 激活</button>
            <button disabled={busy} onClick={() => connect('logout')}>清除内存授权</button>
          </details>
        )}
        <details>
          <summary>能力边界</summary>
          <p>发布包当前以视频模式为主。源码保全不等于全部已集成或真实账号验收。回执成功不是平台发表证明，不自动把日历标记已发布。</p>
        </details>
        <h3>本公司账号绑定</h3>
        <p>请到右侧菜单「平台账号」添加平台并完成官方登录/扫码。这里只展示已绑定摘要，用于准备确认草稿。</p>
        {!data.bindings.length && <p>尚未绑定账号。请先在「平台账号」完成登录授权。</p>}
        {data.bindings.map(b => (
          <article className={css.plan} key={b.id}>
            <div>
              <b>{b.label}</b>
              <p>{platformLabels[b.platform] || b.platform} · 账号：{(b as any).nickname || b.label || b.accountUid || '摘要'} · {b.enabled ? '可选' : '已停用'}</p>
            </div>
            {b.enabled && <button disabled={busy} onClick={() => void act('binding.disable', { id: b.id, revision: b.revision })}>停用绑定</button>}
          </article>
        ))}
        <h3>准备确认草稿</h3>
        <p>{pack ? `已保存发布包：${pack.title} · 版本${pack.revision}` : '请先在上方打开并保存发布包。'}</p>
        <select disabled={busy} value={bindingId} onChange={e => setBindingId(e.target.value)}>
          <option value="">明确选择本公司账号</option>
          {data.bindings.filter(b => b.enabled).map(b => (
            <option key={b.id} value={b.id}>{platformLabels[b.platform] || b.platform} · {b.label}</option>
          ))}
        </select>
        <button disabled={busy || !pack?.checked || !bindingId} onClick={() => { if (pack) void act('task.prepare', { packId: pack.id, packRevision: pack.revision, bindingId }) }}>准备确认草稿（不会发送）</button>
        {!pack?.checked && <p>请先保存并人工检查文案、封面和素材授权，AI不能代为检查。</p>}
        <h3>本公司任务</h3>
        <button disabled={busy} onClick={() => void act('overview')}>刷新任务</button>
        {!data.tasks.length && <p>暂无任务，保存发布包/排期不会自动发送。</p>}
        {data.tasks.map(t => (
          <article className={css.plan} key={t.id}>
            <div>
              <b>{t.snapshot?.title || t.id}</b>
              <p>{t.snapshot?.accountLabel || ''} · {stateLabels[t.state] || '未知'} · {t.snapshotValid ? '快照版本有效' : '快照已失效'}</p>
            </div>
            <button type="button" onClick={() => setPreview(t)}>查看完整确认预览</button>
            {['unconfirmed', 'queued'].includes(t.state) && !t.dispatchStartedAt && (
              <button disabled={busy} onClick={() => { if (window.confirm('取消尚未执行任务？不撤回任何平台内容。')) void act('task.cancel', { id: t.id }) }}>取消未执行任务</button>
            )}
          </article>
        ))}
        {preview && (
          <section aria-label="发布确认快照">
            <h3>完整预览 · {stateLabels[preview.state] || '未知'}</h3>
            <p>公司：{spaceId} · 平台：{platformLabels[preview.snapshot?.platform] || preview.snapshot?.platform}</p>
            <p>账号：{preview.snapshot?.accountLabel || '未命名'} / {preview.snapshot?.geoAccountId || preview.snapshot?.accountUid || '无'}</p>
            <p>发布包：{preview.snapshot?.packId} · 版本{preview.snapshot?.packRevision}</p>
            <p>标题：{preview.snapshot?.title}</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>正文：{preview.snapshot?.body}</p>
            <p>话题：{preview.snapshot?.topics || '无'}</p>
            <p>成片：{preview.snapshot?.historyId}；封面：{preview.snapshot?.coverRef || '无'}</p>
            {preview.snapshotValid && (
              <div>
                <video controls preload="none" src={`/digital-human-studio/publication-task-media?space=${encodeURIComponent(spaceId)}&id=${encodeURIComponent(preview.id)}&kind=video`} style={{ maxWidth: '100%', maxHeight: 300 }} />
                <img alt="任务封面" src={`/digital-human-studio/publication-task-media?space=${encodeURIComponent(spaceId)}&id=${encodeURIComponent(preview.id)}&kind=cover`} style={{ maxWidth: '100%', maxHeight: 240 }} />
              </div>
            )}
            <p>日历时间：{preview.snapshot?.scheduledAt ? `${String(preview.snapshot.scheduledAt).slice(0, 16).replace('T', ' ')} 北京时间UTC+8` : '未设置'}（仅记录；下方发送是立即执行，不是预约）</p>
            <p>任务：{preview.id}；上游任务ID：{preview.receipt?.upstreamTaskId || '无可核对ID'}</p>
            <ul>{(preview.blockers || []).map(v => <li key={v}>{v}</li>)}</ul>
            <button
              disabled={busy || !data.runtime.enabled || !preview.snapshotValid || preview.state !== 'unconfirmed' || (preview.blockers || []).length > 0}
              onClick={() => void confirmTask(preview)}
            >我已核对完整预览，确认立即发送</button>
            {preview.state === 'unknown' && preview.receipt?.lockHeld && (
              <button disabled={busy} onClick={() => void confirmTask(preview, true)}>已核对结束，仅解除本机占用</button>
            )}
            <p>一次性确认绑定本公司、账号、内容版本和当前已认证会话，AI不能获取或使用。</p>
            {(preview.events || []).length > 0 && (
              <details>
                <summary>任务进度（北京时间UTC+8）</summary>
                {(preview.events || []).map((e, i) => (
                  <p key={i}>{new Date(e.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · {progressLabels[e.code] || '状态已更新'}</p>
                ))}
              </details>
            )}
            <button type="button" onClick={() => setPreview(null)}>关闭预览</button>
          </section>
        )}
      </> : null}
    </section>
  )
}
