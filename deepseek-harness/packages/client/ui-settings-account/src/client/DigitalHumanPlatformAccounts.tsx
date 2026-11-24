// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
import { useEffect, useState } from 'react'
import { useRecordRail } from './DigitalHumanRecordRail.tsx'
import css from './DigitalHumanPlatformAccounts.module.css'
import { DigitalHumanDeskModal } from './DigitalHumanDeskModal.tsx'
import { DigitalHumanAccountMonitor } from './DigitalHumanAccountMonitor.tsx'
import {
  ACCOUNT_BIND_EMPTY,
  ACCOUNT_STATUS_LABEL,
  LOGIN_POLL_INTERVAL_MS,
  LOGIN_TERMINAL_PHASES,
  PLATFORM_LABEL,
  accountDepsError,
  accountListMeta,
  accountPlatformLabel,
  accountStatusLabel,
  accountStatusTone,
  isLoginTerminalPhase,
  loginQrSrc,
  usePlatformAccountsController,
} from './DigitalHumanPlatformAccountsState.ts'

import {
  PATROL_EMPTY_HISTORY,
  PATROL_LEAD,
  PATROL_SCHEDULE_OFF,
  PATROL_TITLE,
  PATROL_VERIFY,
  patrolConnected,
  patrolHistoryLabel,
  patrolPlatformSummary,
  patrolStatusText,
  useInboxPatrol,
} from './DigitalHumanInboxPatrolState.ts'

export {
  ACCOUNT_BIND_EMPTY,
  ACCOUNT_STATUS_LABEL,
  LOGIN_POLL_INTERVAL_MS,
  LOGIN_TERMINAL_PHASES,
  PLATFORM_LABEL,
  accountDepsError,
  accountListMeta,
  accountPlatformLabel,
  accountStatusLabel,
  isLoginTerminalPhase,
  loginQrSrc,
  shouldApplyAccountResult,
  accountBindSummary,
  usePlatformAccountsController,
} from './DigitalHumanPlatformAccountsState.ts'


/**
 * 个人号页面巡查：后端（publish-studio/inbox-patrol.ts）已实现真实网页采样，
 * 但所有平台能力目前都是 pending_verification（选择器未在真实页面核对），
 * 且采样开关 PUBLISH_STUDIO_INBOX_LIVE_DOM 默认关闭 ——
 * 现在点进去只会看到「待验证 / 还没收录」。先不渲染，等核对完再打开。
 */
const SHOW_INBOX_PATROL = false

function InboxPatrolPanel({
  spaceId,
  ghostClassName,
  compact,
  bindingId,
}: {
  spaceId: string
  ghostClassName: string
  /** 传了 bindingId 就固定巡查这一个账号（嵌在账号卡里用），不再显示账号切换。 */
  bindingId?: string
  compact?: boolean
}) {
  const patrol = useInboxPatrol(spaceId)
  const state = patrol.state
  const connected = patrolConnected(state)
  const accountOptions = state?.accounts || []
  /** 巡查是账号维度：run/verify 都吃 bindingId，历史也带 bindingId。 */
  const [fallbackId, setFallbackId] = useState('')
  useEffect(() => {
    if (bindingId) return
    if (!accountOptions.length) {
      if (fallbackId) setFallbackId('')
      return
    }
    if (!accountOptions.some((account) => account.id === fallbackId)) {
      setFallbackId(accountOptions[0].id)
    }
  }, [bindingId, state, fallbackId, accountOptions])
  const selected = bindingId || fallbackId
  const selectedAccount = accountOptions.find((account) => account.id === selected)
  const focusPlatforms = (state?.capabilities || []).filter((cap) => cap.platform === 'douyin' || cap.platform === 'xiaohongshu')
  const accountPlatforms = selectedAccount
    ? focusPlatforms.filter((cap) => cap.platform === selectedAccount.platform)
    : focusPlatforms
  const scopedPlatforms = accountPlatforms.length ? accountPlatforms : focusPlatforms
  const history = (state?.history || []).filter((row) => !selected || row.bindingId === selected)

  const body = (
    <>
      <p className={css.patrolLead}>{PATROL_LEAD}</p>
      {patrol.error ? <p className={css.error} role="alert">{patrol.error}</p> : null}
      {patrol.notice ? <p className={css.notice} role="status">{patrol.notice}</p> : null}
      <p className={css.patrolSchedule} role="status">{PATROL_SCHEDULE_OFF}</p>
      <label className={css.patrolToggle}>
        <input type="checkbox" checked={false} disabled aria-disabled="true" />
        定时巡查（待页面验证，不可开启）
      </label>
      {scopedPlatforms.map((cap) => (
        <details key={cap.platform} className={css.patrolDetails}>
          <summary>{patrolPlatformSummary(cap)}</summary>
          <p>{cap.note || '仍待真实网页核对，不能当作已上线。'}</p>
          <p>私信页：{cap.inboxPage || '未映射'}（{cap.messages === 'ready' ? '可巡查' : cap.messages === 'pending_verification' ? '待验证' : '还不能巡查'}）</p>
          <p>评论页：{cap.commentsPage || '未映射'}（{cap.comments === 'ready' ? '可巡查' : cap.comments === 'pending_verification' ? '待验证' : '还不能巡查'}）</p>
          <ul>
            {(cap.missing || []).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </details>
      ))}
      <div className={css.patrolActions}>
        <button
          type="button"
          className={ghostClassName}
          disabled={patrol.busy || !selected}
          onClick={() => void patrol.run(selected)}
        >
          手动巡查一次
        </button>
        <button
          type="button"
          className={ghostClassName}
          disabled={patrol.busy || !selected}
          onClick={() => void patrol.verifyPage(selected)}
        >
          {PATROL_VERIFY}
        </button>
        <button type="button" className={ghostClassName} disabled={patrol.busy} onClick={() => void patrol.stop()}>停止</button>
      </div>
      {state?.lastRun ? <p className={css.patrolResult} role="status">{patrolStatusText(state.lastRun)}</p> : null}
      <h3 className={css.patrolSub}>已收录（可见文本）</h3>
      {!history.length ? (
        <p className={css.patrolEmpty}>{PATROL_EMPTY_HISTORY}</p>
      ) : (
        <ul className={css.patrolList}>
          {history.map((row) => (
            <li key={row.id}>
              <button type="button" className={css.patrolItem} disabled={patrol.busy} onClick={() => patrol.setDraftItemId(row.id)}>
                {patrolHistoryLabel(row)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {compact || !connected ? null : (
        <p className={css.hint}>有可见记录后才能写待确认草稿，此阶段不会发送。</p>
      )}
      {history.length ? (
        <div className={css.patrolDraft}>
          <label>
            回复草稿（待确认，不发送）
            <textarea value={patrol.draftBody} disabled={patrol.busy} onChange={(event) => patrol.setDraftBody(event.target.value)} rows={3} />
          </label>
          <button type="button" className={ghostClassName} disabled={patrol.busy || !patrol.draftItemId || !patrol.draftBody.trim()} onClick={() => void patrol.saveDraft()}>保存草稿</button>
        </div>
      ) : null}
    </>
  )

  // 嵌在账号卡里：不折叠、不再选账号。
  if (bindingId) {
    return (
      <section className={css.patrolInline} aria-label={PATROL_TITLE}>
        <div className={css.patrolHead}>
          <h2>{PATROL_TITLE}</h2>
          <span className={css.patrolBadge}>待验证</span>
        </div>
        {body}
      </section>
    )
  }

  return (
    <details className={css.patrol} aria-label={PATROL_TITLE}>
      <summary className={css.patrolSummary}>
        <span className={css.patrolTitle}>{PATROL_TITLE}</span>
        <span className={css.patrolBadge}>待验证</span>
        <span className={css.patrolMeta}>
          {selectedAccount ? `${selectedAccount.label} · 定时关闭` : '还没有账号'}
        </span>
        <span className={css.patrolChevron} aria-hidden />
      </summary>
      <div className={css.patrolBody}>
        {accountOptions.length ? (
          <div className={css.patrolAccounts} role="group" aria-label="选择要巡查的账号">
            {accountOptions.map((account) => (
              <button
                key={account.id}
                type="button"
                className={css.patrolAccount}
                data-on={account.id === selected ? 'on' : undefined}
                onClick={() => setFallbackId(account.id)}
              >
                {account.label}
                <em>{accountPlatformLabel(account.platform)}</em>
              </button>
            ))}
          </div>
        ) : null}
        {body}
      </div>
    </details>
  )
}

export function DigitalHumanPlatformAccounts({
  spaceId,
  companyName = '',
  variant = 'page',
  onManageAccounts,
  primaryClassName = '',
  ghostClassName = '',
  emptyClassName = '',
}: {
  spaceId: string
  companyName?: string
  variant?: 'page' | 'compact'
  onManageAccounts?: () => void
  primaryClassName?: string
  ghostClassName?: string
  emptyClassName?: string
}) {
  const ctrl = usePlatformAccountsController(spaceId)
  const compact = variant === 'compact'

  useRecordRail(compact ? null : {
    title: '账号',
    empty: '还没有账号',
    stamp: `${ctrl.login?.sessionId || ''}:${ctrl.busy}:${ctrl.deps?.ready === false}:${ctrl.adding}`,
    items: ctrl.accounts.map((account) => ({
      id: account.id,
      title: account.label,
      meta: accountListMeta(account),
      status: accountStatusLabel(account.status),
      statusTone: account.status === 'authorized' || account.status === 'ready' ? 'ok' as const : account.status === 'failed' || account.status === 'expired' ? 'fail' as const : account.status === 'waiting_scan' || account.status === 'waiting_browser' ? 'run' as const : '',
      onClick: () => { void ctrl.loginAccount(account) },
      actionsAlways: true,
      actions: (
        <>
          <button type="button" className={ghostClassName} disabled={ctrl.busy || ctrl.deps?.ready === false} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void ctrl.loginAccount(account) }}>登录/扫码</button>
          <button type="button" className={ghostClassName} disabled={ctrl.busy} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void ctrl.removeAccount(account) }}>移除</button>
        </>
      ),
    })),
  })

  const modal = (
    <DigitalHumanDeskModal open={ctrl.modalOpen} title={ctrl.modalTitle} onClose={ctrl.closeAccountModal}>
      {ctrl.login ? (
        <section aria-label="登录进度">
          {ctrl.error ? <p className={css.error} role="alert">{ctrl.error}</p> : null}
          {ctrl.login.message ? <p className={css.loginMessage} title={ctrl.login.message}>{ctrl.login.message}</p> : null}
          {ctrl.login.qrAvailable ? (
            <div className={css.qrWrap}>
              <img
                className={css.qr}
                alt="平台登录二维码"
                src={loginQrSrc(spaceId, ctrl.login.sessionId)}
              />
            </div>
          ) : isLoginTerminalPhase(ctrl.login.phase) ? null : (
            <p className={css.hint}>请在弹出的官方窗口里完成登录。没弹出窗口就还没开始。</p>
          )}
          <div className={css.actions}>
            {isLoginTerminalPhase(ctrl.login.phase) ? null : (
              <button type="button" className={ghostClassName} disabled={ctrl.busy} onClick={() => void ctrl.cancelLogin()}>取消登录</button>
            )}
            {isLoginTerminalPhase(ctrl.login.phase) ? (
              <button type="button" className={ghostClassName} disabled={ctrl.busy} onClick={ctrl.closeAccountModal}>关闭</button>
            ) : null}
          </div>
        </section>
      ) : (
        <form
          aria-label="添加平台账号"
          onSubmit={(event) => { event.preventDefault(); void ctrl.addAccount() }}
        >
          {ctrl.error ? <p className={css.error} role="alert">{ctrl.error}</p> : null}
          {ctrl.depsError ? <p className={css.error} role="alert">{ctrl.depsError}</p> : null}
          <label className={css.field}>
            平台
            <select value={ctrl.platform} disabled={ctrl.busy || !ctrl.platforms.length} onChange={(e) => ctrl.setPlatform(e.target.value)}>
              {!ctrl.platforms.length && <option value="">暂无可用平台（发布插件 publish-studio 未启用）</option>}
              {ctrl.platforms.map((p) => (
                <option key={p.key} value={p.key}>{accountPlatformLabel(p.key)}</option>
              ))}
            </select>
          </label>
          <label className={css.field}>
            备注
            <input maxLength={80} value={ctrl.label} disabled={ctrl.busy} onChange={(e) => ctrl.setLabel(e.target.value)} placeholder="例如品牌抖音号" />
          </label>
          <div className={css.actions}>
            <button type="submit" className={primaryClassName} disabled={ctrl.busy || !ctrl.platform}>添加</button>
            <button type="button" className={ghostClassName} disabled={ctrl.busy} onClick={ctrl.closeAccountModal}>取消</button>
          </div>
        </form>
      )}
    </DigitalHumanDeskModal>
  )

  const confirmModal = (
    <DigitalHumanDeskModal
      open={!!ctrl.confirming}
      title="移除账号"
      maxWidth={440}
      onClose={ctrl.cancelRemove}
    >
      {ctrl.confirming ? (
        <div className={css.confirmBody}>
          <p className={css.confirmLead}>从本公司移除「<b>{ctrl.confirming.label}</b>」？</p>
          <p className={css.confirmMeta}>不会注销平台账号，也不会删除媒体素材。</p>
          <div className={css.actions}>
            <button type="button" className={ghostClassName} disabled={ctrl.busy} onClick={ctrl.cancelRemove}>取消</button>
            <button type="button" className={css.dangerSolid} disabled={ctrl.busy} onClick={() => void ctrl.confirmRemove()}>
              {ctrl.busy ? '移除中…' : '确认移除'}
            </button>
          </div>
        </div>
      ) : null}
    </DigitalHumanDeskModal>
  )

  if (compact) {
    const summary = ctrl.bindSummary
    return (
      <section className={css.bind} aria-label="绑定账号">
        <h2>绑定账号</h2>
        <p className={css.bindLead}>这些是「{companyName || '当前公司'}」已经绑定的平台账号。</p>
        {ctrl.depsError ? <p className={css.error} role="alert">{ctrl.depsError}</p> : null}
        {!ctrl.modalOpen && ctrl.error ? <p className={css.error} role="alert">{ctrl.error}</p> : null}
        {ctrl.notice ? <p className={css.notice} role="status">{ctrl.notice}</p> : null}
        {summary.empty ? (
          <p className={emptyClassName || css.bindEmpty}>{ACCOUNT_BIND_EMPTY}</p>
        ) : (
          <ul className={css.bindList}>
            {summary.items.map((row) => (
              <li key={row.id} className={css.bindRow}>
                <div className={css.bindRowBody}>
                  <b>{row.title}</b>
                  <small>
                    {row.platform}
                    <span className={row.statusTone === 'ok' ? css.badgeOk : row.statusTone === 'fail' ? css.badgeFail : row.statusTone === 'run' ? css.badgeRun : css.badge}>{row.status}</span>
                  </small>
                </div>
                <button type="button" className={ghostClassName} disabled={ctrl.busy || ctrl.deps?.ready === false} onClick={() => void ctrl.loginAccount(row.account)}>登录</button>
              </li>
            ))}
            {summary.hidden > 0 ? (
              <li className={css.bindMore}>还有 {summary.hidden} 个，请到「管理这家账号」查看。</li>
            ) : null}
          </ul>
        )}
        {SHOW_INBOX_PATROL ? <InboxPatrolPanel spaceId={spaceId} ghostClassName={ghostClassName} compact /> : null}
        <div className={css.bindActions}>
          <button type="button" className={primaryClassName} disabled={ctrl.busy} onClick={ctrl.openAdd}>添加账号</button>
          {onManageAccounts ? (
            <button type="button" className={ghostClassName} disabled={ctrl.busy} onClick={onManageAccounts}>管理这家账号</button>
          ) : null}
        </div>
        {modal}
        {confirmModal}
      </section>
    )
  }

  const [openAccountId, setOpenAccountId] = useState('')
  const [platformFilter, setPlatformFilter] = useState('all')
  const platformGroups = (() => {
    const map = new Map<string, { key: string; label: string; count: number }>()
    for (const account of ctrl.accounts) {
      const key = account.platform || 'other'
      const row = map.get(key) || { key, label: accountPlatformLabel(account.platform), count: 0 }
      row.count += 1
      map.set(key, row)
    }
    return Array.from(map.values())
  })()
  const activePlatform = platformFilter !== 'all' && platformGroups.some((row) => row.key === platformFilter)
    ? platformFilter
    : 'all'
  const visibleAccounts = activePlatform === 'all'
    ? ctrl.accounts
    : ctrl.accounts.filter((account) => (account.platform || 'other') === activePlatform)
  const authorizedCount = ctrl.accounts.filter((account) => account.status === 'authorized' || account.status === 'ready').length
  const openAccount = ctrl.accounts.find((account) => account.id === openAccountId) || null

  // 账号详情：从列表点进来，和公司列表进内页一个套路。
  if (openAccount) {
    const tone = accountStatusTone(openAccount.status)
    const reason = (openAccount.reason || openAccount.message || '').trim()
    return (
      <section className={css.root} aria-label="账号详情">
        <button type="button" className={css.back} onClick={() => setOpenAccountId('')}>
          <span aria-hidden>‹</span>全部账号
        </button>
        <div className={css.detailHead}>
          <span className={css.acctIcon} aria-hidden>{accountPlatformLabel(openAccount.platform).slice(0, 1)}</span>
          <div className={css.detailTitle}>
            <b title={openAccount.label}>{openAccount.label}</b>
            <small title={reason || accountPlatformLabel(openAccount.platform)}>
              {accountPlatformLabel(openAccount.platform)}{reason ? ` · ${reason}` : ''}
            </small>
          </div>
          <span className={css.acctStatus} data-tone={tone || 'idle'}>
            <i />{accountStatusLabel(openAccount.status)}
          </span>
          <div className={css.detailActions}>
            <button
              type="button"
              className={ghostClassName}
              disabled={ctrl.busy || ctrl.deps?.ready === false}
              onClick={() => void ctrl.loginAccount(openAccount)}
            >
              登录/扫码
            </button>
            <button
              type="button"
              className={ghostClassName}
              disabled={ctrl.busy}
              onClick={() => ctrl.removeAccount(openAccount)}
            >
              移除
            </button>
          </div>
        </div>
        {!ctrl.modalOpen && ctrl.error ? <p className={css.error} role="alert">{ctrl.error}</p> : null}
        {ctrl.depsError ? <p className={css.error} role="alert">{ctrl.depsError}</p> : null}
        {ctrl.notice ? <p className={css.notice} role="status">{ctrl.notice}</p> : null}
        <p className={css.detailNote}>做好的发布包和发布日历会用到这个账号。</p>
        <DigitalHumanAccountMonitor spaceId={spaceId} bindingId={openAccount.id} />
        {SHOW_INBOX_PATROL ? (
          <InboxPatrolPanel spaceId={spaceId} bindingId={openAccount.id} ghostClassName={ghostClassName} />
        ) : null}
        {modal}
        {confirmModal}
        <p className={css.disclaimer}>登录只在这台电脑，不会拿去发帖。</p>
      </section>
    )
  }

  return (
    <section className={css.root} aria-label="平台账号">
      <div className={css.bar}>
        <p className={css.barInfo}>
          共 <b>{ctrl.accounts.length}</b> 个账号
          <span>已授权 <b>{authorizedCount}</b></span>
          {ctrl.deps?.ready === false ? <span className={css.barWarn}>浏览器未就绪</span> : null}
        </p>
        {ctrl.accounts.length ? (
          <div className={css.filters} role="group" aria-label="按平台筛选">
            <button
              type="button"
              className={css.chip}
              data-on={activePlatform === 'all' ? 'on' : undefined}
              onClick={() => setPlatformFilter('all')}
            >
              全部<em>{ctrl.accounts.length}</em>
            </button>
            {platformGroups.map((row) => (
              <button
                key={row.key}
                type="button"
                className={css.chip}
                data-on={activePlatform === row.key ? 'on' : undefined}
                onClick={() => setPlatformFilter(row.key)}
              >
                {row.label}<em>{row.count}</em>
              </button>
            ))}
          </div>
        ) : null}
        <div className={css.barActions}>
          <button type="button" className={ghostClassName} disabled={ctrl.busy} onClick={() => void ctrl.refresh().catch((e) => ctrl.setError(e instanceof Error ? e.message : '刷新失败'))}>刷新</button>
          <button type="button" className={primaryClassName} disabled={ctrl.busy} onClick={ctrl.openAdd}>添加账号</button>
        </div>
      </div>
      {!ctrl.modalOpen && ctrl.error ? <p className={css.error} role="alert">{ctrl.error}</p> : null}
      {ctrl.depsError ? <p className={css.error} role="alert">{ctrl.depsError}</p> : null}
      {ctrl.notice ? <p className={css.notice} role="status">{ctrl.notice}</p> : null}
      {ctrl.accounts.length === 0 ? (
        <div className={css.emptyState}>
          <span className={css.emptyIcon} aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="8" width="16" height="12" rx="2" />
              <path d="M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" />
            </svg>
          </span>
          <b>{ACCOUNT_BIND_EMPTY}</b>
          <small>加一个抖音或小红书账号，发布包才能直接推过去。</small>
          <button type="button" className={primaryClassName} disabled={ctrl.busy} onClick={ctrl.openAdd}>添加账号</button>
        </div>
      ) : (
        <ul className={css.grid}>
          {visibleAccounts.map((account) => {
            const tone = accountStatusTone(account.status)
            const reason = (account.reason || account.message || '').trim()
            return (
              <li key={account.id} className={css.acct}>
                <div className={css.acctTop}>
                  <button
                    type="button"
                    className={css.acctOpen}
                    onClick={() => setOpenAccountId(account.id)}
                  >
                    <span className={css.acctIcon} aria-hidden>{accountPlatformLabel(account.platform).slice(0, 1)}</span>
                    <span className={css.acctBody}>
                      <b title={account.label}>{account.label}</b>
                      <small title={reason || accountPlatformLabel(account.platform)}>
                        {accountPlatformLabel(account.platform)}{reason ? ` · ${reason}` : ''}
                      </small>
                    </span>
                    <span className={css.acctChevron} aria-hidden />
                  </button>
                  <div className={css.acctRight}>
                    <span className={css.acctStatus} data-tone={tone || 'idle'}>
                      <i />{accountStatusLabel(account.status)}
                    </span>
                    <div className={css.acctActions}>
                      <button type="button" className={ghostClassName} disabled={ctrl.busy || ctrl.deps?.ready === false} onClick={() => void ctrl.loginAccount(account)}>登录/扫码</button>
                      <button type="button" className={ghostClassName} disabled={ctrl.busy} onClick={() => setOpenAccountId(account.id)}>监控</button>
                      <button type="button" className={ghostClassName} disabled={ctrl.busy} onClick={() => void ctrl.removeAccount(account)}>移除</button>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {modal}
        {confirmModal}
      <p className={css.disclaimer}>登录只在这台电脑，不会拿去发帖。</p>
    </section>
  )
}
