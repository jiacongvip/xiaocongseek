/** Thin host bridge to the independent publish-studio plugin. No original GEO /postVideo. */
export type PublishStudioLike = {
  independent: true
  requiresOriginalGeoProcess: false
  action: (space: string, actor: 'ui' | 'ai', input: Record<string, unknown>) => Promise<any>
  humanAction: (space: string, input: Record<string, unknown>, session: string, opts?: { dryRun?: boolean }) => Promise<any>
  /** 宿主机定时器专用：执行用户已勾选「到点自动发」的已准备任务。不对外开放 HTTP。 */
  autoSend?: (space: string, input: Record<string, unknown>) => Promise<any>
  runtimeStatus: () => { enabled: boolean; mode: string; reasons: string[] }
}

let api: PublishStudioLike | undefined

export function configurePublishStudio(next?: PublishStudioLike) {
  if (next && (next.requiresOriginalGeoProcess !== false || next.independent !== true)) {
    throw new Error('拒绝注册依赖原GEO进程的发布后端')
  }
  api = next
}

export function getPublishStudio() {
  return api
}

export function publishStudioRuntime() {
  if (!api) {
    return {
      enabled: false,
      mode: 'publish-studio-missing',
      reasons: ['未启用独立发布插件 publish-studio。不会回退原GEO /postVideo。请按 publish-studio/ENABLE.md 链接到 web profile 后重启加载。'],
    }
  }
  return api.runtimeStatus()
}
