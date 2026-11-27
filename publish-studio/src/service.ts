import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isSpaceId } from './paths.js'
import { publicAuthSettings, saveAuthSettings, acknowledgeQuotaBaseline, loginWithPassword, activateWithCode, clearAuthSession, authSessionPublic, assertPublishAllowed } from './auth.js'
import { currentUsage } from './quota.js'
import { listAccountSummaries, saveAccountBinding } from './accounts.js'
import { listLoginPlatforms, createPlatformAccount, startPlatformLogin, pollPlatformLogin, cancelPlatformLogin, removePlatformAccount } from './platform-login.js'
import { getPatrolState, savePatrolPolicy, runPatrol, requestPatrolStop, prepareReplyDraft, rejectPatrolSend, maybeTickPatrol, listAccountOptions, verifyPatrolPage, rejectMarkVerified } from './inbox-patrol.js'
import { runtimeStatus, listTasks, getTask, prepareTask, challenge, submit, cancelTask, submitGranted } from './execution.js'
import { stageCompanyMedia } from './media.js'
import { readRuntimePublicStatus } from './runtime.js'

export type PublishStudioApi = ReturnType<typeof createPublishStudio>

const root = dirname(fileURLToPath(import.meta.url))

export function platforms() {
  const rows = JSON.parse(readFileSync(join(root, '..', 'publishing', 'platforms.json'), 'utf8'))
  return rows.filter((p: any) => p.kind === 'publisher-adapter')
}

export function createPublishStudio(options?: { fetchImpl?: typeof fetch }) {
  const transport = options?.fetchImpl || fetch
  async function action(space: string, actor: 'ui' | 'ai', input: Record<string, unknown>) {
    if (!isSpaceId(space)) throw new Error('非法公司')
    for (const key of ['space', 'spaceId', 'actor', 'nonce', 'cookie', 'token', 'path', 'url', 'authorization']) {
      if (key in input) throw new Error('不接受公司覆盖、凭据或确认授权参数')
    }
    const op = String(input.action || '')
    if (op === 'runtime') return { success: true, spaceId: space, runtime: runtimeStatus(), platforms: platforms(), usage: currentUsage(), deps: readRuntimePublicStatus() }
    if (op === 'runtime.deps') return { success: true, spaceId: space, deps: readRuntimePublicStatus() }
    if (op === 'auth.settings.get') return { success: true, spaceId: space, settings: publicAuthSettings(), session: authSessionPublic() }
    if (op === 'auth.settings.save') {
      if (actor !== 'ui') throw new Error('仅用户可修改授权设置')
      return { success: true, spaceId: space, settings: saveAuthSettings((input.settings || {}) as any) }
    }
    if (op === 'auth.baseline') {
      if (actor !== 'ui') throw new Error('仅用户可确认额度基线')
      return { success: true, spaceId: space, settings: acknowledgeQuotaBaseline(Number(input.priorUsed), String(input.note || '')) }
    }
    if (op === 'auth.login') {
      if (actor !== 'ui') throw new Error('仅用户可登录授权')
      return { success: true, spaceId: space, session: await loginWithPassword({ username: String(input.username || ''), password: String(input.password || '') }, transport) }
    }
    if (op === 'auth.activate') {
      if (actor !== 'ui') throw new Error('仅用户可激活授权')
      return { success: true, spaceId: space, session: await activateWithCode({ authCode: String(input.authCode || '') }, transport) }
    }
    if (op === 'auth.logout') {
      if (actor !== 'ui') throw new Error('仅用户可退出授权会话')
      return { success: true, spaceId: space, session: clearAuthSession() }
    }
    if (op === 'accounts.list') return { success: true, spaceId: space, items: listAccountSummaries(space) }
    if (op === 'accounts.save') {
      if (actor !== 'ui') throw new Error('仅用户可保存账号绑定')
      return { success: true, spaceId: space, item: saveAccountBinding(space, (input.item || {}) as any) }
    }
    if (op === 'accounts.platforms') return { success: true, spaceId: space, items: listLoginPlatforms() }
    if (op === 'accounts.create') {
      if (actor !== 'ui') throw new Error('仅用户可添加平台账号')
      return { success: true, spaceId: space, item: createPlatformAccount(space, String(input.platform || ''), input.label ? String(input.label) : undefined) }
    }
    if (op === 'accounts.login.start') {
      if (actor !== 'ui') throw new Error('仅用户可发起平台登录')
      return { success: true, ...startPlatformLogin(space, String(input.id || ''), Number(input.revision), { mockScenario: process.env.PUBLISH_STUDIO_LOGIN_MOCK || (input.mockScenario && process.env.PUBLISH_STUDIO_ALLOW_LOGIN_MOCK === '1' ? String(input.mockScenario) : undefined) }), spaceId: space }
    }
    if (op === 'accounts.login.poll') {
      if (actor !== 'ui') throw new Error('仅用户可轮询登录状态')
      return { success: true, ...pollPlatformLogin(space, String(input.sessionId || '')), spaceId: space }
    }
    if (op === 'accounts.login.cancel') {
      if (actor !== 'ui') throw new Error('仅用户可取消登录')
      return { success: true, ...cancelPlatformLogin(space, String(input.sessionId || '')), spaceId: space }
    }
    if (op === 'accounts.remove') {
      if (actor !== 'ui') throw new Error('仅用户可移除账号绑定')
      return { ...removePlatformAccount(space, String(input.id || ''), Number(input.revision), input.confirm === true), success: true, spaceId: space }
    }
    if (op === 'accounts.patrol.get' || op === 'accounts.patrol.history') return { ...getPatrolState(space), accounts: listAccountOptions(space) }
    if (op === 'accounts.patrol.save') {
      if (actor !== 'ui') throw new Error('仅用户可保存巡查策略')
      return savePatrolPolicy(space, input)
    }
    if (op === 'accounts.patrol.run') {
      if (actor !== 'ui') throw new Error('仅用户可发起页面巡查')
      return runPatrol(space, input)
    }
    if (op === 'accounts.patrol.verify_page') {
      if (actor !== 'ui') throw new Error('仅用户可发起只读页面核对')
      return verifyPatrolPage(space, input)
    }
    if (op === 'accounts.patrol.mark_verified') {
      rejectMarkVerified()
    }
    if (op === 'accounts.patrol.stop') {
      if (actor !== 'ui') throw new Error('仅用户可停止巡查')
      return requestPatrolStop(space)
    }
    if (op === 'accounts.patrol.draft.save') {
      if (actor !== 'ui') throw new Error('仅用户可保存回复草稿')
      return prepareReplyDraft(space, String(input.itemId || ''), String(input.body || ''))
    }
    if (op === 'accounts.patrol.send' || op === 'accounts.patrol.draft.send') {
      rejectPatrolSend()
    }
    if (op === 'accounts.patrol.tick') return maybeTickPatrol(space)

    if (op === 'accounts.beginLogin') {
      if (actor !== 'ui') throw new Error('仅用户可发起平台登录')
      // Compat: forward to real start
      return { success: true, ...startPlatformLogin(space, String(input.id || ''), Number(input.revision)), spaceId: space }
    }
    if (op === 'tasks.list') return { success: true, spaceId: space, items: listTasks(space) }
    if (op === 'tasks.get') return { success: true, spaceId: space, item: getTask(space, String(input.id || '')) }
    if (op === 'task.prepare') {
      let videoPath = String(input.videoPath || '')
      let coverPath = String(input.coverPath || '')
      // Optional staging from trusted local paths provided by host sibling plugins (not from AI/browser).
      if (input.stageVideoPath || input.stageCoverPath) {
        if (actor !== 'ui' && actor !== 'ai') throw new Error('非法演员')
        // AI may prepare but staging source paths must already be host-validated by caller; still copy into sandbox.
        const staged = await stageCompanyMedia(space, {
          videoPath: String(input.stageVideoPath || videoPath),
          coverPath: String(input.stageCoverPath || coverPath),
          tag: String(input.packId || 'pack'),
        })
        videoPath = staged.videoPath
        coverPath = staged.coverPath
      }
      return { success: true, spaceId: space, ...(await prepareTask(space, {
        packId: String(input.packId || ''),
        packRevision: Number(input.packRevision),
        bindingId: String(input.bindingId || ''),
        platform: String(input.platform || ''),
        title: String(input.title || ''),
        body: String(input.body || ''),
        topics: String(input.topics || ''),
        videoPath,
        coverPath,
      })), note: '仅准备确认草稿，未批准、未上传、未发布' }
    }
    if (op === 'task.cancel') {
      return { success: true, spaceId: space, item: cancelTask(space, String(input.id || '')) }
    }
    if (op === 'confirmation.request' || op === 'confirmation.submit') {
      if (actor !== 'ui') throw new Error('AI不能批准或执行对外发布')
      return { success: false, blocked: true, error: '请使用用户确认专用入口' }
    }
    throw new Error('未知或禁止的发布动作')
  }

  async function humanAction(space: string, input: Record<string, unknown>, session: string, opts?: { dryRun?: boolean }) {
    if (!isSpaceId(space) || !session) throw new Error('公司或确认会话无效')
    const allowed = ['action', 'id', 'challenge', 'csrf', 'dryRun']
    if (Object.keys(input).some(k => !allowed.includes(k))) throw new Error('确认接口参数无效')
    const id = String(input.id || '')
    if (input.action === 'challenge') return challenge(space, id, session)
    if (input.action === 'submit') return submit(space, id, session, String(input.challenge || ''), String(input.csrf || ''), { dryRun: !!opts?.dryRun || input.dryRun === true })
    throw new Error('未知用户确认操作')
  }

  /** 宿主定时器专用入口：不再走 HTTP，也不接受 AI 调用。
   * 用户勾选「到点自动发」即视为对该排期一次发送的预先确认；这里只执行已准备快照，不改内容、不重试。 */
  async function autoSend(space: string, input: Record<string, unknown>) {
    if (!isSpaceId(space)) throw new Error('非法公司')
    const id = String(input.id || '')
    if (!/^task-[a-f0-9]{32}$/.test(id)) throw new Error('任务ID无效')
    const result = await submitGranted(space, id, { headless: input.headless === true })
    return { ...result, spaceId: space }
  }

  return {
    id: 'publish-studio',
    independent: true as const,
    requiresOriginalGeoProcess: false as const,
    action,
    humanAction,
    autoSend,
    runtimeStatus,
    assertPublishAllowed,
    platforms,
  }
}
