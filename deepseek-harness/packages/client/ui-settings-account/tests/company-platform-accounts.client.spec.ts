// @ts-nocheck — 半成品数字人 UI，打包先过类型门禁（登录链路不受影响）
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  ACCOUNT_STATUS_LABEL,
  LOGIN_POLL_INTERVAL_MS,
  LOGIN_TERMINAL_PHASES,
  accountDepsError,
  accountListMeta,
  accountPlatformLabel,
  accountStatusLabel,
  confirmPlatformAccountRemove,
  isLoginTerminalPhase,
  loginQrSrc,
} from '../src/client/DigitalHumanPlatformAccounts.tsx'

const root = dirname(fileURLToPath(import.meta.url))
const accountsUi = readFileSync(join(root, '../src/client/DigitalHumanPlatformAccounts.tsx'), 'utf8')
const accountsState = readFileSync(join(root, '../src/client/DigitalHumanPlatformAccountsState.ts'), 'utf8')
const accountsSrc = `${accountsState}\n${accountsUi}`
const accountsCss = readFileSync(join(root, '../src/client/DigitalHumanPlatformAccounts.module.css'), 'utf8')
const panelSrc = readFileSync(join(root, '../src/client/DigitalHumanPanel.tsx'), 'utf8')
const packsSrc = readFileSync(join(root, '../src/client/DigitalHumanPublishPacks.tsx'), 'utf8')
const accountsBranch = panelSrc.slice(
  panelSrc.indexOf(") : appPage === 'platform-accounts' ? ("),
  panelSrc.indexOf(") : appPage === 'calendar' ? ("),
)

describe('platform account labels and list meta', () => {
  it('maps real enums to short Chinese labels and never invents statuses', () => {
    expect(accountPlatformLabel('douyin')).toBe('抖音')
    expect(accountPlatformLabel('xiaohongshu')).toBe('小红书')
    expect(accountPlatformLabel('unknown-key')).toBe('unknown-key')
    expect(accountStatusLabel('unconfigured')).toBe('未登录')
    expect(accountStatusLabel('waiting_scan')).toBe('等待扫码')
    expect(accountStatusLabel('waiting_browser')).toBe('等待登录')
    expect(accountStatusLabel('waiting_human_login')).toBe('等待登录')
    expect(accountStatusLabel('starting')).toBe('正在准备')
    expect(accountStatusLabel('authorized')).toBe('已授权')
    expect(accountStatusLabel('ready')).toBe('已授权')
    expect(accountStatusLabel('expired')).toBe('已过期')
    expect(accountStatusLabel('failed')).toBe('失败')
    expect(accountStatusLabel('cancelled')).toBe('已取消')
    expect(accountStatusLabel('invalid')).toBe('无效')
    expect(accountStatusLabel('not-a-real-status')).toBe('not-a-real-status')
    expect(Object.keys(ACCOUNT_STATUS_LABEL).sort()).toEqual([
      'authorized', 'cancelled', 'expired', 'failed', 'invalid',
      'ready', 'starting', 'unconfigured', 'waiting_browser', 'waiting_human_login', 'waiting_scan',
    ].sort())
  })

  it('list meta is platform · status, with a short reason only for expired/failed', () => {
    expect(accountListMeta({ platform: 'douyin', status: 'authorized', reason: '不该出现' })).toBe('抖音 · 已授权')
    expect(accountListMeta({ platform: 'douyin', status: 'unconfigured' })).toBe('抖音 · 未登录')
    expect(accountListMeta({ platform: 'xiaohongshu', status: 'expired', reason: '授权过期' })).toBe('小红书 · 已过期 · 授权过期')
    expect(accountListMeta({ platform: 'kuaishou', status: 'failed', message: '扫码失败' })).toBe('快手 · 失败 · 扫码失败')
    expect(accountListMeta({ platform: 'kuaishou', status: 'failed' })).toBe('快手 · 失败')
    expect(accountDepsError({ ready: true, message: '登录运行时已就绪（Playwright/Chromium 探针通过）。' })).toBe('')
    expect(accountDepsError(null)).toBe('')
    expect(accountDepsError({ ready: false, message: '缺少 Chromium' })).toBe('运行依赖未就绪：缺少 Chromium')
    expect(accountDepsError({ ready: false, phase: 'missing' })).toBe('运行依赖未就绪（missing）')
  })
})

describe('platform account confirm, poll and API contract', () => {
  it('keeps the original remove confirm text and only removes after yes', () => {
    const calls: string[] = []
    confirmPlatformAccountRemove('抖音号A', message => {
      expect(message).toBe('从本公司移除「抖音号A」绑定？\n不会注销平台账号，也不会删除媒体素材。')
      return false
    }, () => calls.push('removed'))
    expect(calls).toEqual([])
    confirmPlatformAccountRemove('抖音号A', () => true, () => calls.push('removed'))
    expect(calls).toEqual(['removed'])
  })

  it('keeps publication-management payloads, poll interval, QR URL and terminal phases', () => {
    expect(LOGIN_POLL_INTERVAL_MS).toBe(1500)
    expect([...LOGIN_TERMINAL_PHASES]).toEqual(['authorized', 'failed', 'expired', 'cancelled'])
    expect(isLoginTerminalPhase('authorized')).toBe(true)
    expect(isLoginTerminalPhase('waiting_scan')).toBe(false)
    expect(loginQrSrc('space-1', 'sess-9')).toBe('/publish-studio/login-qr?space=space-1&sessionId=sess-9')
    expect(accountsSrc).toContain("fetch('/digital-human-studio/publication-management'")
    expect(accountsSrc).toContain("body: JSON.stringify({ space: spaceId, action, ...extra })")
    expect(accountsSrc).toContain("postPlatformAccount(requestSpaceId, 'studio.accounts.platforms')")
    expect(accountsSrc).toContain("postPlatformAccount(requestSpaceId, 'studio.accounts.list')")
    expect(accountsSrc).toContain("postPlatformAccount(requestSpaceId, 'studio.runtime.deps')")
    expect(accountsSrc).toContain("postPlatformAccount(requestSpaceId, 'studio.accounts.create', { platform, label: label || PLATFORM_LABEL[platform] || platform })")
    expect(accountsSrc).toContain("postPlatformAccount(requestSpaceId, 'studio.accounts.login.start', { id: account.id, revision: account.revision })")
    expect(accountsSrc).toContain("postPlatformAccount(requestSpaceId, 'studio.accounts.login.poll', { sessionId })")
    expect(accountsSrc).toContain("postPlatformAccount(requestSpaceId, 'studio.accounts.login.cancel', { sessionId })")
    expect(accountsSrc).toContain("postPlatformAccount(requestSpaceId, 'studio.accounts.remove', { id: account.id, revision: account.revision, confirm: true })")
    expect(accountsSrc).toContain('if (raw.spaceId && raw.spaceId !== spaceId) throw new Error(\'公司响应不匹配\')')
    expect(accountsSrc).toContain('}, [spaceId])')
    expect(accountsSrc).toContain("setLogin(null)")
    expect(accountsSrc).toContain("setAdding(false)")
    expect(accountsSrc).toContain("setLabel('')")
    expect(accountsSrc).toContain("setBusy(true)")
    expect(accountsSrc).toContain('shouldApplyAccountResult')
    expect(accountsSrc).toContain('if (isLoginTerminalPhase(v.phase))')
    expect(accountsSrc).toContain("disabled={ctrl.busy || ['authorized', 'cancelled'].includes(ctrl.login.phase)}")
    expect(accountsSrc).toContain('const closeAccountModal = () => {')
    expect(accountsSrc).toContain('void cancelLogin(session.sessionId, requestSpaceId)')
    expect(accountsSrc).toContain('if (session && !isLoginTerminalPhase(session.phase) && session.sessionId)')
  })
})

describe('platform accounts desk UI source scope', () => {
  it('uses exclusive desk CSS, collapsed add form, and workbench copy', () => {
    expect(accountsSrc).toContain("from './DigitalHumanPlatformAccounts.module.css'")
    expect(accountsSrc).not.toContain('DigitalHumanCalendar.module.css')
    expect(accountsSrc).not.toContain('<h1>')
    expect(accountsSrc).not.toContain('登录态只保存在本机')
    expect(accountsSrc).not.toContain('不会发给 AI')
    expect(accountsSrc).not.toContain('添加并登录')
    expect(accountsSrc).not.toContain('loginUrlHost}')
    expect(accountsSrc).not.toContain('继续刷新状态')
    expect(accountsSrc).not.toContain('登录运行时已就绪')
    expect(accountsSrc).not.toContain('不会假装已打开浏览器')
    expect(accountsSrc).not.toContain('最近检查')
    expect(accountsSrc).not.toContain('#ddd')
    expect(accountsSrc).toContain("useState(false)")
    expect(accountsSrc).toContain('setAdding(true)')
    expect(accountsSrc).toContain("setAdding(false)")
    expect(accountsSrc).toContain('添加账号')
    expect(accountsSrc).toContain('placeholder="例如品牌抖音号"')
    expect(accountsSrc).toContain('{accountPlatformLabel(p.key)}')
    expect(accountsSrc).toContain("empty: '还没有账号'")
    expect(accountsSrc).toContain('登录只在这台电脑，不会拿去发帖。')
    expect(accountsSrc).toContain('请在弹出的官方窗口里完成登录。没弹出窗口就还没开始。')
    expect(accountsSrc).toContain('登录 · ${accountStatusLabel(login.phase)}')
    expect(accountsSrc).toContain('DigitalHumanDeskModal')
    expect(accountsSrc).toContain('备注')
    expect(accountsSrc).toContain('aria-label="添加平台账号"')
    expect(accountsSrc).not.toContain('className={css.card}')
    expect(accountsSrc).toContain('disabled={ctrl.busy || ctrl.deps?.ready === false}')
    expect(accountsSrc).toContain('>登录/扫码<')
    expect(accountsSrc).toContain('>移除<')
    expect(accountsSrc).toContain('>关闭<')
    expect(accountsSrc).not.toContain('服务地址')
    expect(accountsSrc).not.toContain('激活码')
    expect(accountsSrc).not.toContain('用户名')
    expect(accountsSrc).not.toContain('立即发送')
    expect(accountsSrc).not.toContain('准备确认')
    expect(accountsSrc).not.toContain('GEO')
    expect(accountsCss).toContain('--purple: #1b1b1d')
    expect(accountsCss).toContain('-webkit-line-clamp: 3')
    expect(accountsCss).toContain('width: 240px')
    expect(accountsCss).not.toMatch(/\.root\s+button/)
    expect(accountsCss).not.toContain('#8a59d6')
    expect(accountsCss).not.toContain('#cdb4ee')
    expect(accountsBranch).toContain("renderCompanyDeskHead(spaceId, 'platform-accounts'")
    expect(accountsBranch).toContain('绑好抖音/小红书，登录在官方页完成。')
    expect(accountsBranch).toContain("subtitle: '绑好抖音/小红书，登录在官方页完成。'")
    expect(accountsBranch).toContain('css.deskPrimary')
    expect(panelSrc).toContain("setAppPage('companies'); setCompanyOpen(false); setSpaceMenu('closed')")
    expect(accountsBranch).not.toContain('全部公司')
    expect(panelSrc.slice(panelSrc.indexOf('const renderCompanyDeskHead'), panelSrc.indexOf('const withCompanyRail')).match(/全部公司/g)?.length).toBe(1)
    expect(packsSrc).toContain('if (abandon()) onAccounts()')
    expect(packsSrc).not.toContain('DigitalHumanPublicationManagement')
    expect(packsSrc).not.toContain('setManaging')
    expect(panelSrc).toContain('今天先补档案或做一条')
    expect(panelSrc).toContain('点一天看排期，发完自己标已发。')
  })
})
