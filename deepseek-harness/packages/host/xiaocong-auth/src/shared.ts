/**
 * Wire contract shared by the Host half and the browser settings panel.
 *
 * Sign-in lives on the shell, not on a workspace plugin: these routes stay
 * registered even when no workspace plugin is installed, activated or running.
 */

/** Shell-owned sign-in routes. All of them are same-origin JSON/HTML endpoints. */
export const ROUTE = {
  /** Interactive confirm page: a XiaocongAPI session already exists. */
  authorize: '/auth/xiaocong/authorize',
  /** Post-login page shown in the popup / external browser after a claim. */
  authorized: '/auth/xiaocong/authorized',
  /** Read-only sign-in state (never returns the token itself). */
  status: '/auth/xiaocong/status',
  /** Exchange a transient access_token for the persisted `sk-` key. */
  claim: '/auth/xiaocong/claim',
  /** Shell-side sign-out: drop the key, keep the XiaocongAPI session cookie. */
  logout: '/auth/xiaocong/logout',
  /** Same-origin proxy for XiaocongAPI `/api/user/auth/refresh`. */
  refresh: '/auth/xiaocong/refresh',
  /** Same-origin proxy for XiaocongAPI `/api/user/auth/logout` (switch account). */
  clearSession: '/auth/xiaocong/clear-session',
  /**
   * Legacy alias paths. The XiaocongAPI console only appends `dsh_access_token` to a
   * redirect whose pathname matches `/digital-human-studio/auth/(authorize|authorized)`,
   * so the shell serves these exact paths whenever the workspace plugin does not own them.
   */
  legacyAuthorize: '/digital-human-studio/auth/authorize',
  legacyAuthorized: '/digital-human-studio/auth/authorized',
  /**
   * Silent hop used by the desktop shell. The console only hands the transient
   * token back to a browser window named `dsh-newapi-login`, which `shell.openExternal`
   * cannot produce on its own; this page sets the name and forwards to `/login`.
   */
  bootstrap: '/auth/xiaocong/bootstrap',
} as const

/** Sign-in state as the settings panel consumes it. */
export interface XcyAuthStatus {
  success: boolean
  /** True when a shell-owned key exists and is meant to be used. */
  enabled: boolean
  baseUrl: string
  username: string
  userId: number | null
  hasToken: boolean
  /** Last four characters only, never the key. */
  tokenPreview: string
  error?: string
}

/** Claim request body: omit accessToken to re-validate the stored key. */
export interface XcyClaimBody {
  baseUrl?: string
  accessToken?: string
  access_token?: string
  userId?: number | string
  user_id?: number | string
  id?: number | string
  username?: string
}
