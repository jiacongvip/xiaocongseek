/** Plugin transforms applied to the composer draft at the real submit snapshot. */

export type ComposerSubmitHook = (draft: string, sessionId: string | undefined) => string

const hooks = new Set<ComposerSubmitHook>()

/** Register a transform that runs when the user actually sends (click or Enter). */
export function registerComposerSubmitHook(hook: ComposerSubmitHook): () => void {
  hooks.add(hook)
  return () => { hooks.delete(hook) }
}

/** Apply every registered transform; a throwing hook is skipped. */
export function applyComposerSubmitHooks(draft: string, sessionId: string | undefined): string {
  let next = draft
  for (const hook of hooks) {
    try {
      const value = hook(next, sessionId)
      if (typeof value === 'string') next = value
    } catch {
      /* a plugin hook cannot block send */
    }
  }
  return next
}
