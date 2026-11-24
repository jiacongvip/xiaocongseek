/** Normalize publication overview runtime for UI. Never invent connected:true. */
export type PublicationConnection = {
  connected: boolean
  baseUrl: string
  authRequired: boolean | null
  authenticated: boolean
  permissionsEnforced: boolean | null
  authCenterOrigin: string
}

export type PublicationRuntimeView = {
  enabled: boolean
  mode: string
  reasons: string[]
  connection: PublicationConnection | null
  independent: boolean
}

export type PublicationOverviewView = {
  success: true
  spaceId: string
  platforms: { key: string; type: number }[]
  bindings: unknown[]
  tasks: unknown[]
  runtime: PublicationRuntimeView
  error?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

/** Map backend overview JSON into a render-safe view. Throws on invalid/mismatched company payload. */
export function normalizePublicationOverview(raw: unknown, spaceId: string): PublicationOverviewView {
  const body = asRecord(raw)
  if (!body) throw new Error('发布管理响应无效')
  if (body.success === false) throw new Error(String(body.error || '读取本公司发布管理失败'))
  if (body.success !== true) throw new Error(String(body.error || '读取本公司发布管理失败'))
  if (String(body.spaceId || '') !== spaceId) throw new Error('公司响应不匹配')

  const runtimeRaw = asRecord(body.runtime) || {}
  const reasons = Array.isArray(runtimeRaw.reasons)
    ? runtimeRaw.reasons.map(item => String(item || '')).filter(Boolean)
    : []
  const mode = typeof runtimeRaw.mode === 'string' && runtimeRaw.mode
    ? runtimeRaw.mode
    : (runtimeRaw.enabled ? 'unknown-enabled' : 'unknown-disabled')
  const connectionRaw = asRecord(runtimeRaw.connection)
  let connection: PublicationConnection | null = null
  if (connectionRaw) {
    connection = {
      connected: connectionRaw.connected === true,
      baseUrl: typeof connectionRaw.baseUrl === 'string' ? connectionRaw.baseUrl : '',
      authRequired: typeof connectionRaw.authRequired === 'boolean' ? connectionRaw.authRequired : null,
      authenticated: connectionRaw.authenticated === true,
      permissionsEnforced: typeof connectionRaw.permissionsEnforced === 'boolean' ? connectionRaw.permissionsEnforced : null,
      authCenterOrigin: typeof connectionRaw.authCenterOrigin === 'string' ? connectionRaw.authCenterOrigin : '',
    }
  }
  const independent = mode.includes('independent') || mode.includes('publish-studio') || connection == null
  return {
    success: true,
    spaceId: String(body.spaceId),
    platforms: Array.isArray(body.platforms) ? body.platforms as { key: string; type: number }[] : [],
    bindings: Array.isArray(body.bindings) ? body.bindings : [],
    tasks: Array.isArray(body.tasks) ? body.tasks : [],
    runtime: {
      enabled: runtimeRaw.enabled === true,
      mode,
      reasons,
      connection,
      independent,
    },
  }
}

/** Status lines for the management header; never claims connected without explicit connection.connected===true. */
export function publicationRuntimeStatusLines(runtime: PublicationRuntimeView): string[] {
  const lines: string[] = []
  if (runtime.independent || !runtime.connection) {
    lines.push(`独立发布插件：${runtime.enabled ? '已就绪（仍受授权/额度约束）' : '未就绪 / blocked'}`)
    lines.push(`模式：${runtime.mode}`)
  } else {
    lines.push(`连接：${runtime.connection.connected ? '已连接' : '未连接'}`)
  }
  if (!runtime.enabled) lines.push('当前不可真实发送（blocked），不会伪装为已可发布。')
  for (const reason of runtime.reasons) lines.push(reason)
  if (!lines.length) lines.push('运行状态未知，请重试读取。')
  return lines
}
