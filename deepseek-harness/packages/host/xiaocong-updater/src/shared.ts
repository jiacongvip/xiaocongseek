/** Shell routes owned by the xiaocong-updater host plugin. */
export const ROUTE = {
  updateStatus: '/xiaocong/update/status',
  updateCheck: '/xiaocong/update/check',
  updateDownload: '/xiaocong/update/download',
  updateInstall: '/xiaocong/update/install',
} as const

/** Release feed the shell polls. Same shape the update server publishes. */
export interface XcyUpdateRelease {
  /** Newest published version, e.g. `0.2.3`. Compared against the installed version. */
  version: string
  /** Direct download URL of the macOS DMG. Omit when only a Windows build exists. */
  dmgUrl?: string
  /** Direct download URL of the Windows installer (.exe). Omit when only a macOS build exists. */
  exeUrl?: string
  /** Human-readable changelog shown in the settings panel. */
  notes?: string
  /** ISO date of publication, informational. */
  publishedAt?: string
  /** Minimum version required before upgrading; users below it are warned. */
  minVersion?: string
}

export interface XcyUpdateStatus {
  success: boolean
  /** Installed application version. */
  currentVersion: string
  /** Configured feed URL. */
  feedUrl: string
  /** Host platform of the shell (`darwin`, `win32`, …); the panel picks copy from it. */
  platform: string
  checking: boolean
  lastCheckAt: string | null
  latest: XcyUpdateRelease | null
  /** Installed version is older than the feed version. */
  hasUpdate: boolean
  /** Feed requires an upgrade from below this version (minVersion gate). */
  updateRequired: boolean
  download: {
    phase: 'idle' | 'downloading' | 'done' | 'failed'
    progress: number
    downloadedBytes: number
    totalBytes: number
    /** Absolute path of the downloaded installer once `phase === 'done'`. */
    path: string | null
  }
  error?: string
  /** Automatic background check is enabled. */
  autoCheck: boolean
}
