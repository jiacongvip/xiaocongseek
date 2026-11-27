import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  IS_WIN,
  PATH_DELIMITER,
  engineStartCommand,
  findBundledPython,
  findMediaTool,
  resolveEngineVenvPython,
  runtimeBin,
  systemPythonNames,
  venvPython,
} from './platform.js'
import { publicationAction, publicationHumanAction, publicationGeoAction, publicationTaskMedia, configurePublishStudio } from './publication-service.js'
import { loadPacks, packOptions, packView, savePack, checkPack, deletePack, packDownload } from './publish-packs.js'
import { requireCalendarSpace, loadPublishCalendar, upsertPublishPlan, deletePublishPlan, calendarWorks, setPlanAuto, markPlanPublished } from './publish-calendar.js'
import { autoPublishTick, autoPublishOverview, autoPublishEnabled, publishPlanNow, lastPublishNow } from './auto-publish.js'
// digital-human-studio — HOST half: Xiaocongcut task-console + Agent tools (MVP).
// Browser half talks to HTTP routes; Agent chat uses ctx.tools (defineTool).
import type { Context } from '@deepseek-ai/cordis'
import { syncNewApiCredential } from './new-api-credential.js'
import { buildCapabilities } from './capabilities.js'
import { normalizeRecipeFonts } from './font-paths.js'
import { readPublishRuntimeStatus, startPublishInstall, publishInstallState, waitPublishInstall } from './setup-center.js'
import {
  listLocalTextStyles,
  renderLocalStyledText,
  localStyledTextRuntimeCheck,
  readLocalStyledTextMeta,
  addOwnTextLayer,
  updateOwnTextLayer,
  listOwnTextLayers,
  exportOwnTextComposition,
  precheckOwnTextNativeExport,
  mapOwnStyleToNative,
  type OwnTextLayer,
} from './local-styled-text.js'
import { exportOwnTextDualPathCore } from './own-text-dual-export.js'
import { resolveImageIntroForDraft, KNOWN_IMAGE_INTRO_TYPES } from './image-intro-map.js'
import {
  processSaveDraftResponse,
  toLosslessJson,
} from './save-draft-result.js'
import { listNativeTextEffects, resolveNativeFlowerEffectId, resolveNativeBubbleIds, resolveFlowerStyleAlias } from './native-text-effects.js'
import { precheckLocalExport, exportDraftLocalFfmpeg, getLocalExportJob, probeMedia } from './local-draft-export.js'
import { registerExport, backfillExports, exportFilePath, ensureExportThumb, exportCoverFramePath, extractExportFrame, importExport, deleteExportArtifacts } from './export-history.js'
import { installBundledSkillsOnBoot } from './install-skills.js'
import { normalizeCues, sfxCatalogForAgent, sfxItem, sfxPath } from './sfx.js'
import { syncNewApiModels } from './new-api-models.js'
import { diagnoseEngine, installEngine } from './engine-provision.js'
import { canonicalImageModelId, isImageModelId } from './image-models.js'
import {
  decodeImageDataUrl,
  extensionForImage,
  getImageJob,
  currentImageLayout,
  imageLayoutForSpace,
  withImageLayout,
  isImageTaskId,
  parseImageGenerationResult,
  publicImageJob,
  ratioToImageSize,
  readImageFile,
  seedImageJob,
  setImageLayout,
  upsertImageJob,
  writeImageBytes,
  type ImageJob,
} from './image-jobs.js'
import {
  DEFAULT_SPACE_ID,
  SPACE_STORE_PATH,
  briefHasContent,
  createSpace,
  currentSpace,
  deleteSpace,
  ensureSessionSpace,
  ensureSpaceDisk,
  formatBriefForPrompt,
  formatEmptyBriefForPrompt,
  pickViralRecipe,
  isSpaceId,
  loadSpaceStore,
  patchSpace,
  publicSpaces,
  removeSpaceDisk,
  saveSpaceStore,
  selectSpace,
  spaceAssetRoot,
  spaceForSession,
  spaceWorkspace,
  type SpaceStore,
} from './spaces.js'
import { platformsFor, refreshPlatforms } from './platform-feed.js'
import { briefChatPrompts, briefDraftPrompts, listKnowledge, normalizeBriefChat, normalizeBriefDraft, recentKnowledgeText, saveKnowledge } from './brief-ai.js'
import type { StudioHistoryItem } from './studio-history.js'
import {
  findAndPatchStudioHistory,
  historyTitle,
  loadStudioHistory,
  patchStudioHistory,
  removeStudioHistory,
  saveStudioHistory,
  taskIdFromResult,
  upsertStudioHistory,
} from './studio-history.js'
import { callModel, copyPrompts, coverPromptOf, defaultModelInfo, extractJson, mergeCopyRevision, mergePlatformRevision, normalizeCopy, probeSeconds, revisePlatformPrompts, revisePrompts } from './work-copy.js'
import {
  addStudioMaterial,
  findStudioMaterial,
  ingestLocalFolder,
  isMaterialSlot,
  materialAbsolutePath,
  materialMime,
  openMaterialsDirectory,
  publicStudioMaterials,
  removeStudioMaterial,
  renameStudioMaterial,
  updateStudioMaterialMeta,
} from './studio-materials.js'
import { downloadNarrationAudio, probeAudioDuration } from './mixcut-tts.js'
import { MIXCUT_VOICES, pickMixcutVoice, voiceChoiceMenu } from './mixcut-voices.js'
import { MIXCUT_MUSIC, findMixcutMusic, mixcutMusicFile, mixcutMusicReady, musicChoiceMenu, pickMixcutMusic } from './mixcut-music.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  classifyMediaLink,
  getIngestTask,
  listIngestTasks,
  mediCrawlerCapabilityReport,
  runMediaLinkIngest,
} from './media-link-ingest.js'
import {
  cancelMcTask,
  DETECTABLE_MC_ROOT,
  defaultMcRoot,
  defaultProductionRunner,
  getMcTask,
  listMcTasks,
  liveMcRunner,
  mediacrawlerCapabilityReport,
  parsePlatformMediaLink,
  runPlatformMediaDownload,
  runPlatformKeywordSearch,
  normalizeBrowserMode,
  normalizeCdpPort,
  type MediaCrawlerRuntimeConfig,
} from './mediacrawler-adapter.js'
import {
  runCommentWordcloud,
  listWordcloudTasks,
  getWordcloudTask,
  cancelWordcloudTask,
  commentWordcloudCapability,
  resolveWordcloudAsset,
  parseCommentImport,
  publicWordcloudTask,
} from './comment-wordcloud.js'
import { probeChromeCdp, runChromeCdpPageMediaDownload, pageMediaCapabilityReport, listPageMediaTasks } from './chrome-cdp-page-media.js'
import {
  industryHotboardCapability,
  loadIndustryHotboard,
  resolveIndustryHotboardQuery,
  runIndustryHotboard,
} from './industry-hotboard.js'
import {
  computeRetroInsights,
  exportRetroRules,
  loadRetroReview,
  proposeRetroRules,
  retroReviewCapability,
  saveRetroReview,
  scanMediaCrawlerForRetro,
  type RetroRule,
} from './retro-review.js'
import { accountMonitor, accountMonitorCapability, spaceAccountWorks } from './account-monitor.js'
import { diagnoseMcEnv, provisionMcEnv, mcVendorRoot } from './mediacrawler-provision.js'
import { setupStatus, setupFootprint, installAsrModel } from './setup-center.js'

async function runDyDownloadPreferringCdp(args: {
  spaceId: string
  slot: string
  source: string
  pluginConfig: any
  browserMode?: unknown
}) {
  const source = String(args.source || '')
  const isDy = /douyin\.com|iesdouyin\.com/i.test(source)
  const mode = normalizeBrowserMode(args.browserMode ?? args.pluginConfig?.mediaCrawlerBrowserMode)
  // Match original MediaCrawler: QR/login window, then HTTP in the CLI process.
  // Do not steal the user's daily Chrome unless they explicitly pick cdp_existing.
  if (mode === 'cdp_existing' && isDy) {
    const probe = await probeChromeCdp()
    if (probe.ok) {
      const cdpResult = await runChromeCdpPageMediaDownload({
        spaceId: args.spaceId,
        slot: args.slot,
        source,
      })
      return {
        ...cdpResult,
        capability: {
          ...mediacrawlerCapabilityReport(args.pluginConfig),
          pageMedia: pageMediaCapabilityReport(),
          selectedRunner: 'chrome-cdp-page-media',
          cdpBrowser: probe.browser,
        },
      }
    }
  }
  const result = await runPlatformMediaDownload({
    spaceId: args.spaceId,
    slot: args.slot,
    source,
    pluginConfig: args.pluginConfig,
  })
  return {
    ...result,
    capability: {
      ...result.capability,
      pageMedia: pageMediaCapabilityReport(),
      selectedRunner: 'mediacrawler-documented-cli',
      cdp: await probeChromeCdp(),
    },
  }
}

import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
  openSync,
  closeSync,
  chmodSync,
  rmSync,
  unlinkSync,
  renameSync,
  cpSync,
} from 'node:fs'
import { dirname, join, basename, resolve, isAbsolute, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import { spawn, execFileSync } from 'node:child_process'

export const name = 'digital-human-studio'
export const inject = ['webServer', 'tools']

interface RouteSpec {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: any, res: any) => void
}
type WebServer = { register: (spec: RouteSpec) => () => void }

const DEFAULT_BASE = 'http://127.0.0.1:9001'
const PLUGIN_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLED_XIAOCONGCUT_ROOT = join(PLUGIN_ROOT_DIR, 'vendor', 'xiaocongcut')
/** 引擎优先用插件自带的 vendor/xiaocongcut；没有才回退到家目录那份（老机器兼容）。 */
const DEFAULT_XIAOCONGCUT_ROOT = existsSync(join(BUNDLED_XIAOCONGCUT_ROOT, 'capcut_server.py'))
  ? BUNDLED_XIAOCONGCUT_ROOT
  : join(homedir(), 'XiaocongcutAPI')
const CONFIG_PATH = join(homedir(), '.dsh', 'digital-human-studio.json')
const XIAOCONGCUT_LOG = join(tmpdir(), 'xiaocongcut.log')
const PLUGIN_VERSION = '0.9.11'

let activeSpaceId = DEFAULT_SPACE_ID
let spaceStore: SpaceStore = loadSpaceStore()
/** Next timeline insert point (seconds) per Xiaocongcut draft_id. Avoid stacking every clip at 0. */
const timelineCursorByDraft = new Map<string, number>()

function assetRoot(spaceId = activeSpaceId): string {
  return spaceAssetRoot(spaceId)
}
const UPLOAD_MAX_BYTES = 200 * 1024 * 1024
const DIGITAL_HUMAN_MODELS = [
  'xdh-avatar-video',
  'xdh-audio',
  'xdh-image',
  'xdh-avatar-clone',
  'xdh-voice-clone',
]

/**
 * 注册即记录：能力清单要的是"当前这份代码真正注册了哪些工具"，
 * 所以注册时留一份副本，不再依赖任何预生成文件。
 */
const registeredTools: Array<{ name: string; desc: string }> = []

function trackTool(ctx: any, tool: any): any {
  try {
    const name = String((tool as { name?: unknown })?.name || '')
    if (name && !registeredTools.some(t => t.name === name)) {
      const desc = String((tool as { description?: unknown })?.description || '')
      registeredTools.push({ name, desc: desc.replace(/\s+/g, ' ').trim() })
    }
  } catch {
    // 记录失败不能影响工具注册本身
    void 0
  }
  return ctx.tools.register(tool)
}

/** Resolve Xiaocongseek static assets shipped beside the plugin (or fork ../assets). */
function resolveXiaocongAsset(filename: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const pluginRoot = resolve(here, '..')
  const candidates = [
    join(pluginRoot, 'assets', filename),
    join(pluginRoot, '..', 'assets', filename),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return candidates[0]
}

const XIAOCONG_ONLY_PNG = resolveXiaocongAsset('xiaocong-only.png')
const DEFAULT_NEW_API = (process.env.XIAOCONG_NEW_API_BASE || '').trim() || 'https://xiaocongapi.azheteng.cn'

function defaultDraftFolder(): string {
  const home = homedir()
  const tail = ['User Data', 'Projects', 'com.lveditor.draft'] as const
  const candidates = IS_WIN
    ? [
        join(home, 'AppData', 'Local', 'JianyingPro', ...tail),
        join(home, 'AppData', 'Local', 'CapCut', ...tail),
      ]
    : [
        join(home, 'Movies', 'JianyingPro', ...tail),
        join(home, 'Movies', 'CapCut', ...tail),
      ]
  return candidates.find(path => existsSync(path)) ?? candidates[0] ?? ''
}

const DEFAULT_FOLDER = defaultDraftFolder()

type StudioConfig = {
  newApiBaseUrl: string
  newApiToken: string
  newApiEnabled: boolean
  newApiUsername: string
  newApiUserId: number | null
  newApiModels: string[]
  xiaocongcutBaseUrl: string
  xiaocongcutRoot: string
  lastProjectFolder: string
  lastDraftId: string
  lastDraftPath: string
  enginePid: number | null
  /** MediaCrawler project root (main.py). Empty = try detectable local candidate at runtime. */
  mediaCrawlerRoot: string
  /** Python interpreter for MC CLI; empty = <root>/.venv/bin/python */
  mediaCrawlerPython: string
  mediaCrawlerTimeoutMs: number
  mediaCrawlerEnabled: boolean
  /** standard | cdp_existing | cdp_launch — process-scoped via sidecar; default standard */
  mediaCrawlerBrowserMode: 'standard' | 'cdp_existing' | 'cdp_launch'
  mediaCrawlerCdpPort: number
}

type DraftEntry = {
  name: string
  path: string
  draft_id: string
  modified_time: string
  has_draft_content: boolean
  has_draft_info: boolean
  is_locked: boolean
  source: 'folder' | 'xiaocongcut'
}

type OpResult = Record<string, any> & { success: boolean }

function loadConfig(): StudioConfig {
  const fallback: StudioConfig = {
    newApiBaseUrl: DEFAULT_NEW_API,
    newApiToken: '',
    newApiEnabled: false,
    newApiUsername: '',
    newApiUserId: null,
    newApiModels: [],
    xiaocongcutBaseUrl: DEFAULT_BASE,
    xiaocongcutRoot: existsSync(DEFAULT_XIAOCONGCUT_ROOT) ? DEFAULT_XIAOCONGCUT_ROOT : '',
    lastProjectFolder: existsSync(DEFAULT_FOLDER) ? DEFAULT_FOLDER : '',
    lastDraftId: '',
    lastDraftPath: '',
    enginePid: null,
    mediaCrawlerRoot: '',
    mediaCrawlerPython: '',
    mediaCrawlerTimeoutMs: 300000,
    mediaCrawlerEnabled: true,
    mediaCrawlerBrowserMode: 'standard',
    mediaCrawlerCdpPort: 9222,
  }
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<StudioConfig> & {
        enginePid?: number | null
        /** Legacy keys before the VectCut → Xiaocongcut rename. */
        vectcutBaseUrl?: string
        vectcutRoot?: string
      }
      const pidRaw = raw.enginePid
      const enginePid =
        typeof pidRaw === 'number' && Number.isFinite(pidRaw) && pidRaw > 0
          ? Math.floor(pidRaw)
          : null
      return {
        ...raw,
        newApiBaseUrl: String(raw.newApiBaseUrl || DEFAULT_NEW_API).replace(/\/+$/, ''),
        newApiToken: String(raw.newApiToken || ''),
        newApiEnabled: raw.newApiEnabled === true,
        newApiUsername: String(raw.newApiUsername || ''),
        newApiUserId: Number(raw.newApiUserId) || null,
        newApiModels: Array.isArray(raw.newApiModels)
          ? raw.newApiModels.map((id: unknown) => String(id)).filter(Boolean)
          : [],
        xiaocongcutBaseUrl: String(raw.xiaocongcutBaseUrl || raw.vectcutBaseUrl || DEFAULT_BASE).replace(/\/$/, ''),
        xiaocongcutRoot: String(raw.xiaocongcutRoot || raw.vectcutRoot || fallback.xiaocongcutRoot || ''),
        lastProjectFolder: String(raw.lastProjectFolder || fallback.lastProjectFolder || ''),
        lastDraftId: String(raw.lastDraftId || ''),
        lastDraftPath: String(raw.lastDraftPath || ''),
        enginePid,
        mediaCrawlerRoot: String(raw.mediaCrawlerRoot || ''),
        mediaCrawlerPython: String(raw.mediaCrawlerPython || ''),
        mediaCrawlerTimeoutMs: Math.max(
          30000,
          Math.min(30 * 60_000, Number(raw.mediaCrawlerTimeoutMs) || 300000),
        ),
        mediaCrawlerEnabled: raw.mediaCrawlerEnabled !== false,
        mediaCrawlerBrowserMode: normalizeBrowserMode(raw.mediaCrawlerBrowserMode),
        mediaCrawlerCdpPort: normalizeCdpPort(raw.mediaCrawlerCdpPort, 9222),
      }
    }
  } catch (e) {
    console.warn('[digital-human-studio] config load failed:', e)
  }
  return fallback
}

function saveConfig(cfg: StudioConfig) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 })
  chmodSync(CONFIG_PATH, 0o600)
}

function mediaCrawlerPluginConfig(cfg: StudioConfig): MediaCrawlerRuntimeConfig {
  return {
    mediaCrawlerRoot: cfg.mediaCrawlerRoot,
    mediaCrawlerPython: cfg.mediaCrawlerPython,
    mediaCrawlerTimeoutMs: cfg.mediaCrawlerTimeoutMs,
    mediaCrawlerEnabled: cfg.mediaCrawlerEnabled,
    mediaCrawlerBrowserMode: normalizeBrowserMode(cfg.mediaCrawlerBrowserMode),
    mediaCrawlerCdpPort: normalizeCdpPort(cfg.mediaCrawlerCdpPort, 9222),
  }
}

function sendJson(res: any, status: number, body: unknown) {
  const buf = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
  })
  res.end(buf)
}

function sendHtml(res: any, status: number, html: string) {
  const buf = Buffer.from(html, 'utf8')
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
  })
  res.end(buf)
}

function sendBinary(res: any, status: number, buf: Buffer, contentType: string, cache = 'public, max-age=86400') {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': buf.length,
    'cache-control': cache,
  })
  res.end(buf)
}


function readJson(req: any): Promise<any> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      // 换装/素材类请求要带 base64 图片，放宽到 6MB
      if (size > 6_000_000) { reject(new Error('请求内容过大')); return }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim()
        resolvePromise(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('无效的 JSON 请求'))
      }
    })
    req.on('error', reject)
  })
}

type LocalAsset = {
  id: string
  type: 'avatar' | 'voice'
  name: string
  modelCode: string
  coverUrl: string
  sampleUrl: string
  localCover: string
  localSample: string
  width?: number
  height?: number
  isDefault?: boolean
  createdAt: string
  updatedAt: string
}

type AssetLibrary = { version: 1; avatars: LocalAsset[]; voices: LocalAsset[] }

const EMPTY_LIBRARY: AssetLibrary = { version: 1, avatars: [], voices: [] }
const ASSET_DIR: Record<'avatar' | 'voice', string> = { avatar: 'avatars', voice: 'voices' }

function loadAssetLibrary(): AssetLibrary {
  try {
    const indexPath = join(assetRoot(), 'library.json')
    if (!existsSync(indexPath)) return structuredClone(EMPTY_LIBRARY)
    const raw = JSON.parse(readFileSync(indexPath, 'utf8')) as Partial<AssetLibrary>
    const library: AssetLibrary = {
      version: 1,
      avatars: Array.isArray(raw.avatars) ? raw.avatars.filter(isLocalAsset) : [],
      voices: Array.isArray(raw.voices) ? raw.voices.filter(isLocalAsset) : [],
    }
    if (fillMissingAssetSizes(library)) saveAssetLibrary(library)
    return library
  } catch {
    return structuredClone(EMPTY_LIBRARY)
  }
}

function isLocalAsset(value: unknown): value is LocalAsset {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<LocalAsset>
  return typeof row.id === 'string' && row.id !== '' && (row.type === 'avatar' || row.type === 'voice')
}

function saveAssetLibrary(library: AssetLibrary) {
  const root = assetRoot()
  const indexPath = join(root, 'library.json')
  mkdirSync(root, { recursive: true })
  writeFileSync(indexPath, JSON.stringify(library, null, 2), { encoding: 'utf8', mode: 0o600 })
  chmodSync(indexPath, 0o600)
}

function safeAssetName(id: string): string {
  const cleaned = String(id || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)
  return cleaned || 'asset'
}

function assetExtension(contentType: string, url: string, kind: 'image' | 'audio' | 'video' | ''): string {
  const type = contentType.split(';')[0].trim().toLowerCase()
  const byType: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  }
  if (byType[type]) return byType[type]
  const match = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url)
  if (match) return match[1].toLowerCase()
  if (kind === 'video') return 'mp4'
  if (kind === 'audio') return 'mp3'
  if (kind === 'image') return 'jpg'
  return 'bin'
}

function looksLikeImage(contentType: string, url: string): boolean {
  return /^image\//i.test(contentType) || /\.(png|jpe?g|webp|gif|bmp|avif)([?#]|$)/i.test(url)
}

function looksLikeAudio(contentType: string, url: string): boolean {
  return /^audio\//i.test(contentType) || /\.(mp3|wav|m4a|aac|ogg|flac)([?#]|$)/i.test(url)
}

function looksLikeVideo(contentType: string, url: string): boolean {
  return /^video\//i.test(contentType) || /\.(mp4|mov|webm|mkv|m4v)([?#]|$)/i.test(url)
}

function sniffMediaKind(buffer: Buffer, contentType: string, url: string): 'image' | 'audio' | 'video' | '' {
  if (looksLikeImage(contentType, url)) return 'image'
  if (looksLikeAudio(contentType, url)) return 'audio'
  if (looksLikeVideo(contentType, url)) return 'video'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image'
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return 'image'
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'video'
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'RIFF') return 'audio'
  if (buffer.length >= 3 && buffer.toString('ascii', 0, 3) === 'ID3') return 'audio'
  return ''
}

function resolveFfprobe(): string {
  const bundled = findMediaTool(PLUGIN_ROOT_DIR, 'ffprobe')
  if (bundled) return bundled
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) return ''
  const probe = ffmpeg.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1')
  return existsSync(probe) ? probe : ''
}

function probeMediaDuration(absolute: string): number {
  if (!absolute || !existsSync(absolute)) return 0
  const ffprobe = resolveFfprobe()
  if (!ffprobe) return 0
  try {
    const out = execFileSync(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      absolute,
    ], { encoding: 'utf8', timeout: 8000 }).trim()
    const seconds = Number(out)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  } catch {
    return 0
  }
}

function probeMediaSize(absolute: string): { width?: number; height?: number } {
  if (!absolute || !existsSync(absolute)) return {}
  const ffprobe = resolveFfprobe()
  if (ffprobe) {
    try {
      const out = execFileSync(ffprobe, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=p=0:s=x',
        absolute,
      ], { encoding: 'utf8', timeout: 8000 }).trim()
      const [width, height] = out.split(/[x,]/).map(Number)
      if (width > 0 && height > 0) return { width, height }
    } catch { /* try sips next */ }
  }
  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', absolute], {
      encoding: 'utf8',
      timeout: 8000,
    })
    const width = Number(/pixelWidth:\s+(\d+)/.exec(out)?.[1] || 0)
    const height = Number(/pixelHeight:\s+(\d+)/.exec(out)?.[1] || 0)
    if (width > 0 && height > 0) return { width, height }
  } catch { /* ignore */ }
  return {}
}

function fillAssetSize(asset: LocalAsset): boolean {
  if (asset.width && asset.height) return false
  const sampleAbs = asset.localSample ? join(assetRoot(), asset.localSample) : ''
  const coverAbs = asset.localCover ? join(assetRoot(), asset.localCover) : ''
  const fromSample = probeMediaSize(sampleAbs)
  const size = fromSample.width && fromSample.height ? fromSample : probeMediaSize(coverAbs)
  if (!size.width || !size.height) return false
  asset.width = size.width
  asset.height = size.height
  return true
}

function fillMissingAssetSizes(library: AssetLibrary): boolean {
  let dirty = false
  for (const asset of library.avatars) {
    if (fillAssetSize(asset)) dirty = true
  }
  return dirty
}

function resolveFfmpeg(): string {
  return findMediaTool(PLUGIN_ROOT_DIR, 'ffmpeg')
}

function extractFirstFrame(videoAbsolute: string, coverAbsolute: string): boolean {
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg || !existsSync(videoAbsolute)) return false
  mkdirSync(dirname(coverAbsolute), { recursive: true })
  try {
    execFileSync(ffmpeg, ['-y', '-ss', '0.3', '-i', videoAbsolute, '-frames:v', '1', '-q:v', '2', coverAbsolute], {
      timeout: 20_000,
      stdio: 'ignore',
    })
    return existsSync(coverAbsolute) && statSync(coverAbsolute).size > 32
  } catch {
    try {
      execFileSync(ffmpeg, ['-y', '-i', videoAbsolute, '-frames:v', '1', '-q:v', '2', coverAbsolute], {
        timeout: 20_000,
        stdio: 'ignore',
      })
      return existsSync(coverAbsolute) && statSync(coverAbsolute).size > 32
    } catch {
      return false
    }
  }
}

const ASSET_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024

/** Download one asset file into the library folder; returns its relative path or ''. */
async function downloadAssetFile(type: 'avatar' | 'voice', id: string, url: string, kind: 'cover' | 'sample'): Promise<string> {
  const target = String(url || '').trim()
  if (!/^https?:\/\//i.test(target)) return ''
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  try {
    const response = await fetch(target, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) return ''
    const contentType = String(response.headers.get('content-type') || '')
    const length = Number(response.headers.get('content-length') || 0)
    if (length > ASSET_DOWNLOAD_MAX_BYTES) return ''
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0 || buffer.length > ASSET_DOWNLOAD_MAX_BYTES) return ''
    const mediaKind = sniffMediaKind(buffer, contentType, target)
    if (!mediaKind) return ''
    if (kind === 'cover' && mediaKind !== 'image' && mediaKind !== 'video') return ''
    const relative = join(ASSET_DIR[type], safeAssetName(id), `${kind}.${assetExtension(contentType, target, mediaKind)}`)
    const absolute = join(assetRoot(), relative)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, buffer, { mode: 0o600 })
    return relative
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

async function materializeAssetMedia(
  type: 'avatar' | 'voice',
  id: string,
  coverUrl: string,
  sampleUrl: string,
  previous?: LocalAsset,
): Promise<{ coverUrl: string; sampleUrl: string; localCover: string; localSample: string }> {
  const nextCoverUrl = String(coverUrl || previous?.coverUrl || '').trim()
  const nextSampleUrl = String(sampleUrl || previous?.sampleUrl || '').trim()
  let localCover = previous?.localCover || ''
  let localSample = previous?.localSample || ''

  if (nextSampleUrl && (nextSampleUrl !== previous?.sampleUrl || !localSample)) {
    const downloaded = await downloadAssetFile(type, id, nextSampleUrl, 'sample')
    if (downloaded) localSample = downloaded
  }
  if (nextCoverUrl && looksLikeImage('', nextCoverUrl) && (nextCoverUrl !== previous?.coverUrl || !localCover)) {
    const downloaded = await downloadAssetFile(type, id, nextCoverUrl, 'cover')
    if (downloaded) localCover = downloaded
  }

  if (!localCover && localSample) {
    const sampleAbsolute = join(assetRoot(), localSample)
    if (looksLikeVideo('', localSample) || looksLikeVideo('', nextSampleUrl)) {
      const relative = join(ASSET_DIR[type], safeAssetName(id), 'cover.jpg')
      if (extractFirstFrame(sampleAbsolute, join(assetRoot(), relative))) {
        localCover = relative
      }
    } else if (looksLikeImage('', localSample) || looksLikeImage('', nextCoverUrl) || looksLikeImage('', nextSampleUrl)) {
      const relative = join(ASSET_DIR[type], safeAssetName(id), 'cover.jpg')
      const coverAbsolute = join(assetRoot(), relative)
      try {
        mkdirSync(dirname(coverAbsolute), { recursive: true })
        copyFileSync(sampleAbsolute, coverAbsolute)
        localCover = relative
      } catch {
        localCover = localSample
      }
    }
  }

  return { coverUrl: nextCoverUrl, sampleUrl: nextSampleUrl, localCover, localSample }
}

function publicAsset(asset: LocalAsset) {
  fillAssetSize(asset)
  const base = `/digital-human-studio/digital-human/asset?type=${asset.type}&space=${encodeURIComponent(activeSpaceId)}`
  const cover = asset.localCover ? `${base}&file=${encodeURIComponent(asset.localCover)}` : asset.coverUrl
  const sample = asset.localSample ? `${base}&file=${encodeURIComponent(asset.localSample)}` : asset.sampleUrl
  return {
    ...asset,
    resource_id: asset.type === 'avatar' ? asset.id : undefined,
    model_id: asset.type === 'avatar' ? asset.id : undefined,
    voice_id: asset.type === 'voice' ? asset.id : undefined,
    model_code: asset.modelCode,
    cover_url: cover,
    preview_url: cover,
    sample_url: sample,
    width: asset.width,
    height: asset.height,
    is_default: asset.isDefault ? 1 : 0,
  }
}

function pickDefaultAsset(list: LocalAsset[]): LocalAsset | undefined {
  return list.find(item => item.isDefault) || list[0]
}

function markDefault(library: AssetLibrary, type: 'avatar' | 'voice', id: string) {
  const list = type === 'avatar' ? library.avatars : library.voices
  if (!list.some(item => item.id === id)) throw new Error('资源不存在')
  for (const item of list) item.isDefault = item.id === id
}

function ensureDefault(list: LocalAsset[], asset: LocalAsset) {
  if (!list.some(item => item.isDefault)) asset.isDefault = true
}

function lastAssistantText(agent: { session?: { snapshotEvents?: () => unknown[] } }): string {
  const events = agent.session?.snapshotEvents?.()
  if (!Array.isArray(events)) return ''
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index] as { type?: string; data?: { message?: { content?: unknown } } }
    if (event?.type !== 'assistant/message') continue
    const content = event.data?.message?.content
    if (!Array.isArray(content)) continue
    const text = content
      .flatMap(block => {
        if (!block || typeof block !== 'object') return []
        const row = block as { type?: unknown; text?: unknown }
        return row.type === 'text' && typeof row.text === 'string' ? [row.text] : []
      })
      .join('')
      .trim()
    if (text) return text
  }
  return ''
}

function clipNarration(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length <= 5000 ? trimmed : trimmed.slice(0, 5000)
}

function taskString(task: any, key: string): string {
  if (!task || typeof task !== 'object') return ''
  const data = task.data && typeof task.data === 'object' && !Array.isArray(task.data)
    ? task.data as Record<string, unknown>
    : undefined
  const nested = data?.data && typeof data.data === 'object' && !Array.isArray(data.data)
    ? data.data as Record<string, unknown>
    : undefined
  const input = data?.input && typeof data.input === 'object' && !Array.isArray(data.input)
    ? data.input as Record<string, unknown>
    : undefined
  for (const value of [data?.[key], nested?.[key], input?.[key], task[key]]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function isGatewayArtifactURL(url: string): boolean {
  return /\/v1\/tasks\/.+\/artifacts\//.test(url) || /localhost|127\.0\.0\.1/.test(url)
}

function taskMediaUrl(task: any): string {
  for (const key of ['video_url', 'audio_url', 'audio_oss_url', 'url']) {
    const url = taskString(task, key)
    if (url && !isGatewayArtifactURL(url)) return url
  }
  return ''
}

function recordStudioTask(
  spaceId: string,
  kind: string,
  args: Record<string, unknown> = {},
  result: unknown = {},
  extra: Partial<StudioHistoryItem> = {},
) {
  const id = String(extra.id || taskIdFromResult(result) || '').trim()
  if (!id) return
  const prompt = String(extra.prompt ?? args.text ?? args.prompt ?? args.name ?? '')
  upsertStudioHistory(spaceId || activeSpaceId, {
    id,
    kind: kind || extra.kind || '',
    title: String(extra.title || args.title || args.name || '') || historyTitle(kind, prompt),
    at: extra.at || Date.now(),
    status: extra.status || String((result as { status?: unknown } | null)?.status || 'QUEUED'),
    progress: extra.progress,
    prompt,
    modelCode: extra.modelCode || String(args.model_code || args.model || ''),
    coverUrl: extra.coverUrl || taskString(result, 'cover_url') || undefined,
    mediaUrl: extra.mediaUrl || taskMediaUrl(result) || undefined,
    source: extra.source || 'studio',
  })
}

function patchHistoryFromTask(task: unknown, fallbackId = '') {
  const id = String(taskIdFromResult(task) || fallbackId || '').trim()
  if (!id) return
  findAndPatchStudioHistory(spaceStore.spaces, id, {
    status: String((task as { status?: unknown } | null)?.status || ''),
    progress: String((task as { progress?: unknown } | null)?.progress || ''),
    mediaUrl: taskMediaUrl(task) || undefined,
    coverUrl: taskString(task, 'cover_url') || undefined,
  })
}

function avatarForTask(task: any): LocalAsset | undefined {
  const library = loadAssetLibrary()
  const id = taskString(task, 'selected_avatar_model_id') || taskString(task, 'avatar_id') || taskString(task, 'model_id')
  return library.avatars.find(item => item.id === id) || pickDefaultAsset(library.avatars)
}

function citePayloadFromTask(task: any, taskId: string) {
  const avatar = avatarForTask(task)
  const published = avatar ? publicAsset(avatar) : undefined
  return {
    v: 1 as const,
    cite: true,
    task_id: String(task?.task_id || task?.id || taskId),
    text: clipNarration(taskString(task, 'text') || taskString(task, 'prompt') || taskString(task, 'script') || ''),
    video_url: taskMediaUrl(task),
    cover_url: published?.cover_url || taskString(task, 'cover_url'),
    avatar_name: avatar?.name || '',
    avatar_id: avatar?.id || '',
    model_code: avatar?.modelCode || '',
  }
}

type DigitalHumanCite = {
  task_id: string
  text: string
  video_url: string
  cover_url: string
  avatar_name: string
  cite: boolean
}

const citesBySession = new Map<string, Map<string, DigitalHumanCite>>()

function sessionIdOf(agent: { session?: { id?: unknown; snapshotEvents?: () => unknown[] } } | undefined): string {
  const id = agent?.session?.id
  return typeof id === 'string' && id.trim() ? id.trim() : ''
}

function asDigitalHumanCite(payload: unknown): DigitalHumanCite | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const row = payload as Record<string, unknown>
  if (row.v !== 1) return undefined
  const taskId = String(row.task_id || '').trim()
  if (!taskId) return undefined
  return {
    task_id: taskId,
    text: typeof row.text === 'string' ? clipNarration(row.text) : '',
    video_url: typeof row.video_url === 'string' ? row.video_url.trim() : '',
    cover_url: typeof row.cover_url === 'string' ? row.cover_url.trim() : '',
    avatar_name: typeof row.avatar_name === 'string' ? row.avatar_name.trim() : '',
    cite: row.cite === true,
  }
}

function rememberDigitalHumanCite(sessionId: string, payload: DigitalHumanCite) {
  if (!sessionId) return
  let bucket = citesBySession.get(sessionId)
  if (!bucket) {
    bucket = new Map()
    citesBySession.set(sessionId, bucket)
  }
  bucket.set(payload.task_id, payload)
}

function eventRecord(value: unknown): { type?: string; data?: Record<string, unknown> } {
  if (!value || typeof value !== 'object') return {}
  const row = value as { type?: unknown; data?: unknown }
  return {
    type: typeof row.type === 'string' ? row.type : undefined,
    data: row.data && typeof row.data === 'object' && !Array.isArray(row.data)
      ? row.data as Record<string, unknown>
      : undefined,
  }
}

function digitalHumanCitesFromAgent(agent: unknown): DigitalHumanCite[] {
  const typed = agent as { session?: { snapshotEvents?: () => unknown[]; id?: unknown } } | undefined
  const found = new Map<string, DigitalHumanCite>()
  const sessionId = sessionIdOf(typed)
  const remembered = sessionId ? citesBySession.get(sessionId) : undefined
  if (remembered) {
    for (const cite of remembered.values()) found.set(cite.task_id, cite)
  }
  const events = typed?.session?.snapshotEvents?.()
  if (!Array.isArray(events)) return [...found.values()]
  const dhIds = new Set<string>()
  for (const raw of events) {
    const event = eventRecord(raw)
    const commandId = typeof event.data?.commandId === 'string' ? event.data.commandId : ''
    if (event.type === 'command/run' && event.data?.name === 'dh' && commandId) dhIds.add(commandId)
  }
  for (const raw of events) {
    const event = eventRecord(raw)
    if (event.type !== 'command/done' || event.data?.kind !== 'success') continue
    const commandId = typeof event.data?.commandId === 'string' ? event.data.commandId : ''
    if (!commandId || !dhIds.has(commandId)) continue
    const text = typeof event.data?.text === 'string' ? event.data.text : ''
    if (!text) continue
    try {
      const cite = asDigitalHumanCite(JSON.parse(text))
      if (cite) found.set(cite.task_id, cite)
    } catch {
      /* command output is not a digital-human payload */
    }
  }
  return [...found.values()]
}

function digitalHumanCiteContextText(assemble: { agent?: unknown }): string {
  const cites = digitalHumanCitesFromAgent(assemble.agent)
  if (!cites.length) return ''
  const lines = cites.map((cite, index) => {
    const title = cite.avatar_name || cite.text || cite.task_id
    const kind = cite.cite ? 'cited talking-head video' : 'generated talking-head video'
    const url = cite.video_url ? ` ${cite.video_url}` : ''
    return `${index + 1}. [${kind}] ${title}${url}`
  })
  return [
    `Digital human videos in this conversation: ${cites.length}.`,
    `本对话里已经有 ${cites.length} 个数字人视频。它们显示在对话卡片里，不是工作区文件，也不是普通附件。`,
    '回答「能看到几个视频 / 可以看到几个视频」时必须报这个数字，不要说 0 个、看不到、没有附件，也不要用 ls 工作目录来判断。',
    ...lines,
  ].join('\n')
}

function isFirstUserTurn(agent: unknown): boolean {
  const typed = agent as { session?: { snapshotEvents?: () => unknown[] } } | undefined
  const events = typed?.session?.snapshotEvents?.()
  if (!Array.isArray(events)) return true
  let count = 0
  for (const raw of events) {
    const event = eventRecord(raw)
    if (event.type !== 'user/message') continue
    const source = event.data?.source
    const kind = source && typeof source === 'object' && !Array.isArray(source)
      ? String((source as { kind?: unknown }).kind || '')
      : ''
    if (kind && kind !== 'user') continue
    count += 1
    if (count > 1) return false
  }
  return true
}

function spaceForAgent(agent: unknown) {
  const sessionId = sessionIdOf(agent as { session?: { id?: unknown } })
  if (!sessionId) return currentSpace(spaceStore)
  const bound = spaceStore.sessionSpaces?.[sessionId]
  if (!bound || !spaceStore.spaces.some(item => item.id === bound)) {
    spaceStore = ensureSessionSpace(spaceStore, sessionId)
  }
  const space = spaceForSession(spaceStore, sessionId)
  if (spaceStore.currentId !== space.id) {
    spaceStore = selectSpace(spaceStore, space.id, sessionId)
  }
  if (activeSpaceId !== space.id) activeSpaceId = space.id
  saveSpaceStore(spaceStore)
  return space
}

function clientBriefContextText(assemble: { agent?: unknown } = {}): string {
  const space = spaceForAgent(assemble.agent)
  // 平台不写进档案，直接看这家公司已授权的账号；取不到就沿用上次结果。
  void refreshPlatforms(space.id)
  const recipeOpts = { lastViralRecipe: space.lastViralRecipe, platforms: platformsFor(space.id) }
  if (!briefHasContent(space.brief)) {
    return formatEmptyBriefForPrompt(space.name, space.id, { firstTurn: isFirstUserTurn(assemble.agent), ...recipeOpts })
  }
  return formatBriefForPrompt(space.name, space.id, space.brief, recipeOpts)
}

function publicClientBrief(agent?: unknown) {
  const space = spaceForAgent(agent)
  return {
    success: true,
    spaceId: space.id,
    spaceName: space.name,
    filled: briefHasContent(space.brief),
    brief: space.brief,
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('已取消'), { name: 'AbortError' }))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('已取消'), { name: 'AbortError' }))
    }, { once: true })
  })
}

function cloneAssetFromTask(task: any): { type: 'avatar' | 'voice'; id: string; name: string; modelCode: string } | null {
  const data = task?.data && typeof task.data === 'object' && !Array.isArray(task.data) ? task.data as Record<string, unknown> : {}
  const taskType = String(data.task_type || task?.action || '')
  const name = String(data.name || '').trim()
  const modelCode = String(data.model_code || data.modelCode || '').trim()
  if (taskType === 'avatar_clone' || taskType === 'xdh-avatar-clone') {
    const id = String(data.model_id || data.profile_id || data.id || '').trim()
    if (!id) return null
    return { type: 'avatar', id, name: name || `形象 ${id}`, modelCode }
  }
  if (taskType === 'voice_clone' || taskType === 'xdh-voice-clone') {
    const id = String(data.voice_id || data.profile_id || data.id || '').trim()
    if (!id) return null
    return { type: 'voice', id, name: name || `音色 ${id}`, modelCode }
  }
  return null
}

function cloneMediaFromTask(task: any): { coverUrl: string; sampleUrl: string } {
  const data = task?.data && typeof task.data === 'object' && !Array.isArray(task.data) ? task.data as Record<string, unknown> : {}
  const sampleUrl = String(data.sample_url || data.video_url || data.audio_url || task?.url || '').trim()
  const coverUrl = String(data.cover_url || data.preview_url || '').trim()
  return { coverUrl, sampleUrl }
}

async function upsertCloneAssetFromTask(task: any) {
  if (String(task?.status || '') !== 'SUCCESS') return
  const identity = cloneAssetFromTask(task)
  if (!identity) return
  const media = cloneMediaFromTask(task)
  const library = loadAssetLibrary()
  const list = identity.type === 'avatar' ? library.avatars : library.voices
  const index = list.findIndex(item => item.id === identity.id)
  const now = new Date().toISOString()
  const previous = index >= 0 ? list[index] : undefined
  const stored = await materializeAssetMedia(identity.type, identity.id, media.coverUrl, media.sampleUrl, previous)
  const asset: LocalAsset = {
    id: identity.id,
    type: identity.type,
    name: identity.name || previous?.name || identity.id,
    modelCode: identity.modelCode || previous?.modelCode || '',
    coverUrl: stored.coverUrl,
    sampleUrl: stored.sampleUrl,
    localCover: stored.localCover,
    localSample: stored.localSample,
    width: previous?.width,
    height: previous?.height,
    isDefault: previous?.isDefault,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  }
  fillAssetSize(asset)
  if (index >= 0) list[index] = asset
  else list.unshift(asset)
  ensureDefault(list, asset)
  saveAssetLibrary(library)
}

async function backfillMissingCovers(library: AssetLibrary): Promise<AssetLibrary> {
  let changed = false
  for (const asset of [...library.avatars, ...library.voices]) {
    if (asset.localCover || (!asset.sampleUrl && !asset.coverUrl)) continue
    const stored = await materializeAssetMedia(asset.type, asset.id, asset.coverUrl, asset.sampleUrl, asset)
    if (stored.localCover !== asset.localCover || stored.localSample !== asset.localSample) {
      asset.coverUrl = stored.coverUrl
      asset.sampleUrl = stored.sampleUrl
      asset.localCover = stored.localCover
      asset.localSample = stored.localSample
      asset.updatedAt = new Date().toISOString()
      changed = true
    }
  }
  if (changed) saveAssetLibrary(library)
  return library
}

async function syncLibraryCoversFromGateway(
  request: (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<any>,
) {
  const library = loadAssetLibrary()
  const missing = library.avatars.filter(asset => !asset.localCover)
  if (!missing.length) return
  const remote = await request('GET', '/v1/xiaocong/digital-human/avatars')
  const rows = Array.isArray(remote?.data?.avatars) ? remote.data.avatars : []
  const byId = new Map<string, any>(rows.map((row: any) => [String(row?.model_id || row?.id || ''), row]))
  let changed = false
  for (const asset of missing) {
    const row = byId.get(asset.id)
    const sampleUrl = String(row?.sample_url || '').trim()
    const coverUrl = String(row?.cover_url || '').trim()
    if (!sampleUrl && !coverUrl) continue
    const stored = await materializeAssetMedia(asset.type, asset.id, coverUrl, sampleUrl, asset)
    if (
      stored.localCover !== asset.localCover ||
      stored.localSample !== asset.localSample ||
      stored.sampleUrl !== asset.sampleUrl
    ) {
      asset.coverUrl = stored.coverUrl
      asset.sampleUrl = stored.sampleUrl
      asset.localCover = stored.localCover
      asset.localSample = stored.localSample
      asset.updatedAt = new Date().toISOString()
      if (!asset.modelCode && row?.model_code) asset.modelCode = String(row.model_code)
      changed = true
    }
  }
  if (changed) saveAssetLibrary(library)
}

function readRawBody(req: any, limit: number): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('文件超过 200 MB'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function normalizeVideoUrl(input: string): string {
  const s = String(input || '').trim()
  if (!s) return s
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('file://')) {
    try {
      return decodeURIComponent(s.replace(/^file:\/\//, ''))
    } catch {
      return s.replace(/^file:\/\//, '')
    }
  }
  return s
}

function audioContentType(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase() || ''
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'm4a' || ext === 'mp4' || ext === 'aac') return 'audio/mp4'
  if (ext === 'flac') return 'audio/flac'
  if (ext === 'ogg') return 'audio/ogg'
  if (ext === 'webm') return 'audio/webm'
  return 'audio/mpeg'
}

function expandPath(input: string): string {
  const s = String(input || '').trim()
  if (!s) return ''
  if (s.startsWith('~/')) return join(homedir(), s.slice(2))
  if (s === '~') return homedir()
  return isAbsolute(s) ? s : resolve(s)
}

function looksLikeDraftDir(dir: string): {
  ok: boolean
  has_draft_content: boolean
  has_draft_info: boolean
} {
  const content = join(dir, 'draft_content.json')
  const info = join(dir, 'draft_info.json')
  const meta = join(dir, 'draft_meta_info.json')
  let hasContent = existsSync(content)
  const hasInfo = existsSync(info) || existsSync(meta)
  if (!hasContent) {
    const timelines = join(dir, 'Timelines')
    if (existsSync(timelines)) {
      try {
        for (const sub of readdirSync(timelines)) {
          const subPath = join(timelines, sub)
          try {
            if (!statSync(subPath).isDirectory()) continue
          } catch {
            continue
          }
          if (
            existsSync(join(subPath, 'draft_content.json')) ||
            existsSync(join(subPath, 'draft_info.json'))
          ) {
            hasContent = true
            break
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return {
    ok: hasContent || hasInfo,
    has_draft_content: hasContent,
    has_draft_info: hasInfo,
  }
}

function scanDraftFolder(folder: string): DraftEntry[] {
  const root = expandPath(folder)
  if (!root || !existsSync(root)) return []
  let st
  try {
    st = statSync(root)
  } catch {
    return []
  }

  const out: DraftEntry[] = []
  const pushDir = (dir: string, name: string) => {
    const mark = looksLikeDraftDir(dir)
    if (!mark.ok) return
    let mtime = 0
    try {
      mtime = statSync(dir).mtimeMs
    } catch {
      mtime = 0
    }
    out.push({
      name,
      path: dir,
      draft_id: name,
      modified_time: mtime ? new Date(mtime).toISOString() : '',
      has_draft_content: mark.has_draft_content,
      has_draft_info: mark.has_draft_info,
      is_locked: existsSync(join(dir, '.locked')),
      source: 'folder',
    })
  }

  if (st.isDirectory() && looksLikeDraftDir(root).ok) {
    pushDir(root, basename(root))
  }

  if (st.isDirectory()) {
    let names: string[] = []
    try {
      names = readdirSync(root)
    } catch {
      names = []
    }
    for (const name of names) {
      if (!name || name.startsWith('.')) continue
      const item = join(root, name)
      try {
        if (!statSync(item).isDirectory()) continue
      } catch {
        continue
      }
      pushDir(item, name)
    }
  }

  out.sort((a, b) => String(b.modified_time).localeCompare(String(a.modified_time)))
  const seen = new Set<string>()
  return out.filter((d) => {
    if (seen.has(d.path)) return false
    seen.add(d.path)
    return true
  })
}

function readLocalSummary(draftPath: string): Record<string, unknown> {
  const pickFile = (): string | null => {
    const rootContent = join(draftPath, 'draft_content.json')
    if (existsSync(rootContent)) return rootContent
    const rootInfo = join(draftPath, 'draft_info.json')
    if (existsSync(rootInfo)) return rootInfo
    const timelines = join(draftPath, 'Timelines')
    if (existsSync(timelines)) {
      try {
        for (const sub of readdirSync(timelines)) {
          const subPath = join(timelines, sub)
          try {
            if (!statSync(subPath).isDirectory()) continue
          } catch {
            continue
          }
          const c = join(subPath, 'draft_content.json')
          if (existsSync(c)) return c
          const i = join(subPath, 'draft_info.json')
          if (existsSync(i)) return i
        }
      } catch {
        /* ignore */
      }
    }
    return null
  }

  const file = pickFile()
  if (!file) {
    return {
      project_name: basename(draftPath),
      path: draftPath,
      duration_us: 0,
      fps: 30,
      canvas_config: {},
      tracks_count: 0,
      materials_summary: { videos: 0, audios: 0, texts: 0 },
      note: 'no draft_content/draft_info found',
    }
  }

  try {
    const draftData = JSON.parse(readFileSync(file, 'utf8'))
    const materials = draftData.materials || {}
    return {
      project_name: basename(draftPath),
      path: draftPath,
      duration_us: draftData.duration || 0,
      fps: draftData.fps || 30,
      canvas_config: draftData.canvas_config || {},
      tracks_count: Array.isArray(draftData.tracks) ? draftData.tracks.length : 0,
      materials_summary: {
        videos: Array.isArray(materials.videos) ? materials.videos.length : 0,
        audios: Array.isArray(materials.audios) ? materials.audios.length : 0,
        texts: Array.isArray(materials.texts) ? materials.texts.length : 0,
      },
      source_file: file,
    }
  } catch (e: any) {
    return {
      project_name: basename(draftPath),
      path: draftPath,
      error: e?.message || String(e),
    }
  }
}

async function xiaocongcutFetch(
  baseUrl: string,
  path: string,
  body?: unknown,
  method?: string,
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const m = method || (body === undefined ? 'GET' : 'POST')
  try {
    const res = await fetch(url, {
      method: m,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text }
    }
    return { ok: res.ok, status: res.status, data }
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: e?.message || String(e),
    }
  }
}

/**
 * 界面「包装设置」→ 配方补丁。
 * 只改用户勾了的那几项，其余原样保留；返回值里带 applied，界面能显示这次到底改了什么。
 */
function applyPackPatch(recipe: any, pack: any): { recipe: any; applied: string[] } {
  const applied: string[] = []
  if (!pack || typeof pack !== 'object') return { recipe, applied }
  const next: any = { ...recipe }

  if (pack.avoid_person) {
    const texts = Array.isArray(next.texts) ? next.texts : []
    if (texts.length) {
      next.texts = texts.map((t: any) => ({ ...t, avoid: 'person' }))
      applied.push('花字避让')
    }
  }

  if (pack.cut_on_pause) {
    next.rhythm = { ...(next.rhythm || {}), cut_on_pause: true }
    applied.push('按停顿切镜')
  }

  const hasSubs = next.subtitles && typeof next.subtitles === 'object'
  if (hasSubs) {
    const subs: any = { ...next.subtitles }
    if (pack.subtitle_style) {
      subs.style = String(pack.subtitle_style)
      applied.push('字幕样式')
    }
    if (pack.highlight_color) {
      subs.highlight = { color: String(pack.highlight_color), max_per_line: 2 }
      applied.push('关键词标色')
    }
    next.subtitles = subs
  }

  const look: any = { ...(next.look || {}) }
  if (pack.lut) {
    if (pack.lut === 'none') {
      delete look.lut
      applied.push('调色（原片）')
    } else {
      look.lut = String(pack.lut)
      look.strength = look.strength === undefined ? 0.8 : look.strength
      applied.push('调色')
    }
  }
  if (pack.bg_blur) {
    look.bg_blur = Number(pack.bg_blur) || 0
    applied.push('背景虚化')
  }
  if (Object.keys(look).length) next.look = look

  if (pack.intro && typeof pack.intro === 'object' && pack.intro.text) {
    const { text, sub, dur, accent } = pack.intro
    next.intro = {
      dur: Number(dur) || 2.2,
      accent: accent || '#ffd600',
      text: String(text),
      ...(sub ? { sub: String(sub) } : {}),
    }
    applied.push('片头')
  }
  if (pack.outro && typeof pack.outro === 'object' && pack.outro.text) {
    const { text, sub, dur } = pack.outro
    next.outro = {
      dur: Number(dur) || 2.4,
      text: String(text),
      ...(sub ? { sub: String(sub) } : {}),
    }
    applied.push('片尾')
  }

  if (pack.graphic && pack.graphic.type) {
    const g = {
      at: 1, dur: 1.6, x: 0.7, y: 0.5, size: 0.22, color: '#ffd600',
      ...pack.graphic,
    }
    next.graphics = [...(Array.isArray(next.graphics) ? next.graphics : []), g]
    applied.push('图形标注')
  }

  if (pack.bgm_auto) {
    next.audio = { ...(next.audio || {}), bgm: { mode: 'auto', volume: 0.12 } }
    applied.push('BGM 自动选曲')
  }

  return { recipe: next, applied }
}

/**
 * 解析当前生效的剪辑引擎根目录：
 * - 若配置里手动指定了 xiaocongcutRoot 且目录下确实有 capcut_server.py，则沿用它；
 * - 若配置的目录已失效（例如之前从卸载掉的 DMG 路径保存的），自动回退到随包自带的 DEFAULT_XIAOCONGCUT_ROOT；
 * - 所有检测（/setup/status）、安装（/setup/install）、启动（engineStart）必须共用此解析结果，
 *   避免「安装检查 A 目录已就绪、状态页却盯着 B 目录报红」的错位。
 */
function resolveActiveEngineRoot(cfg: Pick<StudioConfig, 'xiaocongcutRoot'>): string {
  const configured = expandPath(cfg.xiaocongcutRoot || '')
  if (configured && existsSync(join(configured, 'capcut_server.py'))) return configured
  return DEFAULT_XIAOCONGCUT_ROOT
}

function startGuidance(cfg: StudioConfig) {
  const root = resolveActiveEngineRoot(cfg)
  const py = resolveEngineVenvPython(root)
  const hasVenv = existsSync(py)
  const script = join(root, 'capcut_server.py')
  const cmd = engineStartCommand(root, hasVenv)
  return {
    xiaocongcutRoot: root,
    script,
    has_venv: hasVenv,
    start_command: cmd,
    log: XIAOCONGCUT_LOG,
    note:
      'Xiaocongcut offline: use dh_engine_start / panel 「启动引擎」, or run start_command (default port 9001).',
  }
}

function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function processCommand(pid: number): string | null {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
    }).trim()
    return out || null
  } catch {
    return null
  }
}

function looksLikeXiaocongcut(cmd: string | null): boolean {
  if (!cmd) return false
  return /capcut_server\.py/.test(cmd) || /XiaocongcutAPI/.test(cmd)
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}



/** DeepSeek-style authorize confirm when New API session cookie still exists. */
function authorizePageHtml(returnUrl: string, loginUrl: string): string {
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
    .brand img.mark { height: 56px; width: auto; display: block; object-fit: contain; }
    .brand .logo { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: #4d6bfe; }
    .brand .badge { background: #111; color: #fff; font-size: 11px; font-weight: 700; letter-spacing: .06em; padding: 4px 8px; border-radius: 4px; }
    .title { margin: 0 0 28px; font-size: 16px; color: #333; font-weight: 500; }
    .card { width: min(420px, 100%); background: #f0f1f3; border-radius: 14px; padding: 14px 14px 14px 16px; display: flex; align-items: center; gap: 12px; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg,#6b8cff,#4d6bfe); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 16px; flex-shrink: 0; overflow: hidden; }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
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
    <div class="brand"><img class="mark" src="/digital-human-studio/assets/xiaocong-only.png" alt="小葱" /><span class="logo">Xiaocongseek</span></div>
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
        var u = new URL('/digital-human-studio/auth/authorized', location.origin);
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
          var refresh = await fetch('/api/user/auth/refresh', {
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
          var claimRes = await fetch('/digital-human-studio/auth/claim', {
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
          await fetch('/api/user/auth/logout', {
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

/** DeepSeek-style post-login page served in the New API popup after claim. */
function authorizedPageHtml(returnUrl: string): string {
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
    .hero::after { content: "欢迎使用数字人混剪工作台 / XiaocongAPI 已授权"; position: absolute; inset: auto 48px 64px 48px; color: rgba(255,255,255,.28); font-size: 22px; line-height: 1.5; }
    .brand { display: flex; align-items: center; gap: 12px; font-size: 14px; letter-spacing: .08em; color: rgba(255,255,255,.55); margin-bottom: 48px; text-transform: uppercase; }
    .brand img.mark { height: 48px; width: auto; object-fit: contain; display: block; }
    h1 { margin: 0 0 16px; font-size: 40px; font-weight: 600; }
    p { margin: 0 0 36px; color: rgba(255,255,255,.62); font-size: 16px; line-height: 1.6; }
    button { appearance: none; border: 0; border-radius: 10px; background: #111; color: #fff; border: 1px solid rgba(255,255,255,.14); width: 100%; height: 48px; font-size: 16px; cursor: pointer; }
    button:hover { background: #1c1c1c; }
    .hint { margin-top: 18px; font-size: 13px; color: rgba(255,255,255,.38); }
  </style>
</head>
<body>
  <section class="panel">
    <div class="brand"><img class="mark" src="/digital-human-studio/assets/xiaocong-only.png" alt="小葱" /><span>Xiaocongseek · XiaocongAPI</span></div>
    <h1>登录成功</h1>
    <p>你可以关闭此页面，返回工作台继续工作。</p>
    <button type="button" id="open-app">打开应用</button>
    <div class="hint">若未自动返回，请点击上方按钮，或直接回到工作台标签页。</div>
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
        setTimeout(function () {
          try { window.close(); } catch (e) {}
          // Popup close blocked: navigate opener-less tab back to harness.
          try { location.replace(returnUrl); } catch (e2) {}
        }, 250);
      }
      document.getElementById('open-app').addEventListener('click', go);
      go();
    })();
  </script>
</body>
</html>`
}

const MCP_BRIDGE_TOKEN_SYMBOL = Symbol.for('xiaocong.mcp.bridgeToken')

/** Verify an in-process loopback request coming from the shell-owned xiaocong-mcp server. */
function isMcpBridgeRequest(req: any): boolean {
  const expected = (globalThis as Record<symbol, unknown>)[MCP_BRIDGE_TOKEN_SYMBOL]
  if (typeof expected !== 'string' || expected.length < 32) return false
  const remote = String(req?.socket?.remoteAddress || '')
  if (remote && remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') return false
  const raw = req?.headers?.['x-xiaocong-mcp-bridge']
  const provided = Array.isArray(raw) ? String(raw[0] || '') : String(raw || '')
  if (provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))
  } catch {
    return false
  }
}

export async function apply(ctx: Context) {
  const denyUnlessTrustedStudio = (req: any, res: any): boolean => {
    if (isMcpBridgeRequest(req)) return false
    const connection = ctx.get('connection') as { requestRejection?: (req: { headers: unknown }) => number | undefined } | undefined
    if (!connection?.requestRejection) {
      sendJson(res, 403, { success: false, error: '未授权' })
      return true
    }
    const denied = connection.requestRejection({ headers: req.headers })
    if (denied || !sameOrigin(req)) {
      sendJson(res, denied || 403, { success: false, error: '未授权或来源无效' })
      return true
    }
    return false
  }
  // 宿主只扫 $DSH_HOME/skills，不会来插件目录里找；启动时铺一次，用户装上插件即有手法可用。
  installBundledSkillsOnBoot()
  const publicationSessionSalt=randomBytes(32)
  // The publish service comes from the separate publish-studio plugin, but it is NOT a
  // hard dependency of this plugin. Declaring it through Cordis inject kept this plugin
  // pending whenever publish-studio failed to activate (e.g. a duplicated route on a
  // stale profile), which also took every /digital-human-studio/* route down — including
  // the company workbench. So bridge immediately if the service is already there, else
  // poll in the background and keep serving routes; publishing stays blocked until ready.
  configurePublishStudio(undefined)
  const adoptPublishStudio = (studio: any): boolean => {
    if (!studio) return false
    try {
      configurePublishStudio(studio)
      console.info('[digital-human-studio] publish-studio bridge connected (independent plugin)')
      return true
    } catch (error: any) {
      configurePublishStudio(undefined)
      console.warn('[digital-human-studio] publish-studio 注入无效；发布执行保持 blocked，不会回退原GEO /postVideo', error?.message || error)
      return false
    }
  }
  let publishStudioBridged = false
  try {
    publishStudioBridged = adoptPublishStudio((ctx as any).get?.('publishStudio'))
  } catch {
    publishStudioBridged = false
  }
  if (!publishStudioBridged) {
    ctx.effect(() => {
      let attempts = 0
      const timer = setInterval(() => {
        attempts += 1
        let studio: any
        try { studio = (ctx as any).get?.('publishStudio') } catch { studio = undefined }
        if (adoptPublishStudio(studio) || attempts >= 300) clearInterval(timer)
      }, 1000)
      if (typeof (timer as any).unref === 'function') (timer as any).unref()
      return () => clearInterval(timer)
    })
    console.warn('[digital-human-studio] publish-studio 尚未就绪；发布执行保持 blocked，等待服务注入，不会回退原GEO /postVideo')
  }
  const ws = (ctx as unknown as { webServer: WebServer }).webServer
  let config = loadConfig()
  spaceStore = loadSpaceStore(SPACE_STORE_PATH, {
    lastProjectFolder: config.lastProjectFolder,
    lastDraftId: config.lastDraftId,
    lastDraftPath: config.lastDraftPath,
  })
  const bootSpace = currentSpace(spaceStore)
  activeSpaceId = bootSpace.id
  ensureSpaceDisk(activeSpaceId)
  setImageLayout(imageLayoutForSpace(activeSpaceId))
  if (bootSpace.lastProjectFolder || bootSpace.lastDraftId || bootSpace.lastDraftPath) {
    config = {
      ...config,
      lastProjectFolder: bootSpace.lastProjectFolder,
      lastDraftId: bootSpace.lastDraftId,
      lastDraftPath: bootSpace.lastDraftPath,
    }
  } else {
    spaceStore = patchSpace(spaceStore, DEFAULT_SPACE_ID, {
      lastProjectFolder: config.lastProjectFolder,
      lastDraftId: config.lastDraftId,
      lastDraftPath: config.lastDraftPath,
    })
  }
  saveSpaceStore(spaceStore)
  const persistSpaceWorkspace = () => {
    spaceStore = patchSpace(spaceStore, activeSpaceId, {
      lastProjectFolder: config.lastProjectFolder,
      lastDraftId: config.lastDraftId,
      lastDraftPath: config.lastDraftPath,
    })
    saveSpaceStore(spaceStore)
  }
  const saveWorkspaceConfig = (next: StudioConfig) => {
    config = next
    saveConfig(config)
    persistSpaceWorkspace()
  }
  const applySpaceStore = (next: SpaceStore) => {
    spaceStore = next
    activeSpaceId = currentSpace(spaceStore).id
    ensureSpaceDisk(activeSpaceId)
    setImageLayout(imageLayoutForSpace(activeSpaceId))
    const row = currentSpace(spaceStore)
    config = {
      ...config,
      lastProjectFolder: row.lastProjectFolder,
      lastDraftId: row.lastDraftId,
      lastDraftPath: row.lastDraftPath,
    }
    saveSpaceStore(spaceStore)
    saveConfig(config)
  }
  // Cordis 4.1 has no required:false injection metadata. ctx.get is its
  // optional-service seam (also used by llm-pi-ai); do not require credentials.
  const syncCredential = () => syncNewApiCredential(ctx,
    config.newApiEnabled && config.newApiToken ? config.newApiToken : undefined)
  const readShellCredentialToken = (): string => {
    try {
      const credPath = join(homedir(), '.dsh', '.credentials.yaml')
      if (!existsSync(credPath)) return ''
      const raw = readFileSync(credPath, 'utf8')
      const m = /(?:^|\n)\s*NEW_API_TOKEN\s*:\s*['"]?([^\s'"#]+)['"]?/.exec(raw)
      return m?.[1]?.trim() || ''
    } catch {
      return ''
    }
  }
  const adoptShellNewApiToken = async (): Promise<string> => {
    if (config.newApiToken) return config.newApiToken
    try {
      const resolved = await (ctx.get('credentials') as { resolve?: (ref: string) => Promise<{ value: string } | undefined> } | undefined)?.resolve?.('NEW_API_TOKEN')
      const tok = String(resolved?.value || readShellCredentialToken() || '').trim()
      if (!tok) return ''
      const shellStatePath = join(homedir(), '.dsh', 'xiaocong-auth.json')
      const shellState = existsSync(shellStatePath) ? JSON.parse(readFileSync(shellStatePath, 'utf8')) : null
      config = {
        ...config,
        newApiBaseUrl: String(shellState?.baseUrl || config.newApiBaseUrl || DEFAULT_NEW_API),
        newApiToken: tok,
        newApiEnabled: true,
        newApiUsername: String(shellState?.username || config.newApiUsername || ''),
        newApiUserId: Number(shellState?.userId ?? config.newApiUserId ?? 0) || null,
      }
      saveConfig(config)
      return tok
    } catch {
      return ''
    }
  }
  if (config.newApiEnabled && config.newApiToken) {
    await syncCredential()
  } else {
    // Adopt an existing shell-managed NEW_API_TOKEN instead of wiping it when
    // digital-human-studio.json has not been populated yet.
    await adoptShellNewApiToken()
  }

  // Never expose credentials through the older config endpoint either.
  const publicConfig = () => ({ ...config, newApiToken: undefined })
  const authStatus = (): OpResult => ({
    success: true, enabled: config.newApiEnabled, baseUrl: config.newApiBaseUrl,
    username: config.newApiUsername, userId: config.newApiUserId,
    hasToken: !!config.newApiToken,
    tokenPreview: config.newApiToken ? `sk-••••${config.newApiToken.length > 12 ? config.newApiToken.slice(-4) : ''}` : '',
    models: config.newApiModels,
    modelCount: config.newApiModels.length,
  })
  const normalizeToken = (value: string) => {
    const token = value.trim()
    return token && !token.startsWith('sk-') ? `sk-${token}` : token
  }
  const validateBase = (value: unknown) => {
    const url = new URL(String(value))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('服务地址必须是无凭据的 HTTP(S) URL')
    // Passwords must never traverse plain HTTP outside this machine.
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      throw new Error('非本机 XiaocongAPI 地址必须使用 HTTPS')
    return url.toString().replace(/\/+$/, '')
  }
  const newApiRequest = async (
    base: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    method?: 'GET' | 'POST' | 'PUT',
  ) => {
    const response = await fetch(`${base}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'), redirect: 'error',
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const data: any = await response.json().catch(() => null)
    if (!response.ok || !data || data.success === false)
      throw new Error(`XiaocongAPI 请求失败 (${response.status})`)
    return data
  }
  /**
   * Account and key balance for the signed-in XiaocongAPI user.
   * Quota → money follows the gateway's own display rule (`quota_display_type`,
   * `quota_per_unit`, `usd_exchange_rate`), so the shell shows the number the
   * site itself renders. Only derived amounts leave this route; the key never does.
   */
  const BALANCE_TTL_MS = 15_000
  let balanceCache: { at: number; key: string; body: OpResult } | undefined
  const readAccountBalance = async (): Promise<OpResult> => {
    if (!config.newApiToken) return { success: false, error: '尚未设置 XiaocongAPI 令牌' }
    const base = validateBase(config.newApiBaseUrl)
    const token = normalizeToken(config.newApiToken)
    const cacheKey = `${base}\u0000${token}`
    if (balanceCache && balanceCache.key === cacheKey && Date.now() - balanceCache.at < BALANCE_TTL_MS) {
      return balanceCache.body
    }
    const num = (value: unknown, fallback: number) => {
      const parsed = Number(value)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
    }
    // /api/usage/token/ is the one balance read a plain sk- key is allowed to make;
    // it carries both the key quota and the owning account's quota. The trailing
    // slash is required: New API answers the bare path with a 301 redirect, and
    // newApiRequest rejects redirects.
    const usage = await newApiRequest(base, '/api/usage/token/', undefined, { Authorization: `Bearer ${token}` })
    const status = await newApiRequest(base, '/api/status').catch(() => null)
    const data: any = usage?.data ?? {}
    const meta: any = status?.data ?? {}
    const quotaPerUnit = num(meta.quota_per_unit, 500000)
    const displayType = String(meta.quota_display_type || 'USD').toUpperCase()
    const customSymbol = String(meta.custom_currency_symbol || '').trim()
    const money = displayType === 'CNY'
      ? { symbol: '¥', currency: 'CNY', rate: num(meta.usd_exchange_rate, 1) }
      : displayType === 'CUSTOM' && customSymbol
        ? { symbol: customSymbol, currency: 'USD', rate: num(meta.custom_currency_exchange_rate, 1) }
        : { symbol: '$', currency: 'USD', rate: 1 }
    const toMoney = (quota: unknown): number | null => {
      const value = typeof quota === 'number' ? quota : Number(quota)
      if (!Number.isFinite(value)) return null
      return Math.max(0, (value / quotaPerUnit) * money.rate)
    }
    const amount = (value: number | null) => (value === null ? null : value.toFixed(2))
    const account = toMoney(data?.user_quota?.total_available)
    const tokenAvailable = toMoney(data?.total_available)
    const body: OpResult = {
      success: true,
      baseUrl: base,
      displayType,
      quotaPerUnit,
      account: {
        currency: money.currency,
        symbol: money.symbol,
        available: amount(account),
        used: amount(toMoney(data?.user_quota?.total_used)),
        display: account === null ? null : `${money.symbol}${account.toFixed(2)}`,
      },
      token: {
        name: typeof data?.name === 'string' ? data.name : '',
        unlimited: Boolean(data?.unlimited_quota),
        available: amount(tokenAvailable),
        granted: amount(toMoney(data?.total_granted)),
        used: amount(toMoney(data?.total_used)),
      },
    }
    balanceCache = { at: Date.now(), key: cacheKey, body }
    return body
  }
  /**
   * Call a XiaocongAPI digital-human task route with the stored sk- token.
   * The PHP portal is never called from the desktop; this is the unified gateway path.
   */
  const digitalHumanRequest = async (method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 15000): Promise<any> => {
    const rawToken = await adoptShellNewApiToken()
    if (!rawToken) throw new Error('尚未设置 XiaocongAPI 令牌')
    const base = validateBase(config.newApiBaseUrl)
    const token = normalizeToken(rawToken)
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data: any = await response.json().catch(() => null)
    if (!response.ok || !data || data.success === false) {
      const message = data?.message || data?.error?.message || `XiaocongAPI 请求失败 (${response.status})`
      throw new Error(String(message))
    }
    return data
  }

  const imageGatewayRequest = async (method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 180000): Promise<any> => {
    const rawToken = await adoptShellNewApiToken()
    if (!rawToken) throw new Error('尚未设置 XiaocongAPI 令牌')
    const base = validateBase(config.newApiBaseUrl)
    const token = normalizeToken(rawToken)
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { /* non-JSON error page */ }
    if (!response.ok || data?.success === false) {
      const message = data?.error?.message || data?.message || data?.error || `XiaocongAPI 生图失败 (${response.status})`
      throw new Error(String(message))
    }
    return data
  }

  /** 换装/融合要几张图同时进模型：先把图传成公网地址（走网关七牛），再交给图生图 */
  const uploadImageForFusion = async (image: string, fileName: string, selfBase = ''): Promise<string> => {
    const rawToken = await adoptShellNewApiToken()
    if (!rawToken) throw new Error('尚未设置 XiaocongAPI 令牌')
    const base = validateBase(config.newApiBaseUrl)
    const token = normalizeToken(rawToken)
    let buf: Buffer
    let mime = 'image/jpeg'
    const asRemote = (url: string) => url.startsWith('/') && selfBase ? `${selfBase}${url}` : url
    if (image.startsWith('data:')) {
      const matched = /^data:([^;]+);base64,(.*)$/i.exec(image)
      if (!matched) throw new Error('图片数据格式不对')
      mime = matched[1] || 'image/jpeg'
      buf = Buffer.from(matched[2], 'base64')
    } else if (existsSync(image)) {
      // 本地封面、素材原图这类绝对路径
      buf = readFileSync(image)
      mime = /\.png$/i.test(image) ? 'image/png' : 'image/jpeg'
    } else {
      // 站内素材路由（/digital-human-studio/materials/file?...）或外部链接，都要下载
      const url = asRemote(image)
      const remote = await fetch(url.startsWith('http') ? url : `http://127.0.0.1:3080${image}`, { signal: AbortSignal.timeout(30000) })
      if (!remote.ok) throw new Error(`下载参考图失败 (${remote.status})`)
      mime = String(remote.headers.get('content-type') || 'image/jpeg')
      buf = Buffer.from(await remote.arrayBuffer())
    }
    const response = await fetch(`${base}/v1/xiaocong/uploads`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': mime,
        'x-file-name': fileName,
      },
      body: buf,
      signal: AbortSignal.timeout(60000),
    })
    const value = await response.json().catch(() => null) as any
    if (!response.ok || value?.success === false) throw new Error(value?.error || value?.message || '图片上传失败')
    const url = String(value?.data?.url || '').trim()
    if (!url) throw new Error('图片上传后没拿到公网地址')
    return url
  }

  const listImageModels = async (): Promise<{ models: string[]; note?: string }> => {
    const payload = await imageGatewayRequest('GET', '/v1/models', undefined, 15000)
    const ids: string[] = []
    const seen = new Set<string>()
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : []
    for (const item of rows) {
      const raw = typeof item === 'string' ? item.trim()
        : item && typeof item === 'object' && typeof item.id === 'string' ? String(item.id).trim()
          : ''
      if (!raw || !isImageModelId(raw)) continue
      const id = canonicalImageModelId(raw)
      if (!id || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
    return {
      models: ids,
      note: ids.length ? undefined : '小葱 API 还没有可用的生图模型。请先在管理端添加图片渠道。',
    }
  }

  const resolveImageUrl = (url: string): string => {
    const value = url.trim()
    if (!value) return ''
    if (/^https?:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('/digital-human-studio/')) return value
    if (value.startsWith('/')) return `${validateBase(config.newApiBaseUrl)}${value}`
    return value
  }

  const downloadImageBytes = async (url: string): Promise<{ bytes: Buffer; contentType: string } | undefined> => {
    const dataUrl = decodeImageDataUrl(url)
    if (dataUrl) return { bytes: dataUrl.bytes, contentType: dataUrl.mime }
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) return undefined
    const response = await fetch(resolveImageUrl(url).replace(/http:\/\/host\.docker\.internal(?=[:/])/g, 'http://127.0.0.1'), { signal: AbortSignal.timeout(60000) })
    if (!response.ok) return undefined
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length) return undefined
    return { bytes, contentType: response.headers.get('content-type') || 'image/png' }
  }

  const materializeImage = async (job: ImageJob, source: { url?: string; b64?: string; mime?: string }): Promise<string> => {
    if (source.b64) {
      const bytes = Buffer.from(source.b64, 'base64')
      return writeImageBytes(job.task_id, bytes, extensionForImage(source.mime || 'image/png'))
    }
    const url = String(source.url || '').trim()
    if (!url) return ''
    const local = await downloadImageBytes(url)
    if (local) return writeImageBytes(job.task_id, local.bytes, extensionForImage(local.contentType, url))
    if (url.startsWith('/digital-human-studio/')) return url
    return resolveImageUrl(url)
  }

  const finishImageJob = async (job: ImageJob, payload: unknown): Promise<ImageJob> => {
    const parsed = parseImageGenerationResult(payload)
    if (parsed.kind === 'async') {
      return upsertImageJob({
        ...job,
        status: 'IN_PROGRESS',
        progress: job.progress || '30%',
        upstream_task_id: parsed.taskId,
      })
    }
    const url = await materializeImage(job, parsed.images[0] || {})
    if (!url) throw new Error('生图完成，但没有可用的图片地址')
    const now = Date.now()
    return upsertImageJob({
      ...job,
      status: 'SUCCESS',
      progress: '100%',
      url,
      finished_at: now,
      data: { ...job.data, image_url: url, cover_url: url, url },
    })
  }

  const refreshImageJob = async (job: ImageJob): Promise<ImageJob> => {
    return withImageLayout({ ...currentImageLayout() }, async () => {
      if (job.status === 'SUCCESS' || job.status === 'FAILURE' || !job.upstream_task_id) return job
      const task = await imageGatewayRequest('GET', `/v1/tasks/${encodeURIComponent(job.upstream_task_id)}`, undefined, 30000)
      const status = String(task?.status || '').toUpperCase()
      const url = String(task?.url || task?.data?.image_url || task?.data?.url || '').trim()
      if (status === 'FAILURE' || status === 'FAILED' || status === 'ERROR') {
        return upsertImageJob({
          ...job,
          status: 'FAILURE',
          progress: '100%',
          fail_reason: String(task?.fail_reason || task?.error || '生图失败'),
          finished_at: Date.now(),
        })
      }
      if (url || status === 'SUCCESS' || status === 'SUCCEEDED' || status === 'SUCCEED') {
        return finishImageJob(job, task?.data?.image ? { data: [{ url: task.data.image }] } : (url ? { data: [{ url }] } : task))
      }
      return upsertImageJob({
        ...job,
        status: 'IN_PROGRESS',
        progress: String(task?.progress || job.progress || '45%'),
      })
    })
  }

  const createImageJob = async (raw: Record<string, unknown>, agent?: unknown): Promise<any> => {
    const spaceId = spaceForAgent(agent).id
    return withImageLayout(imageLayoutForSpace(spaceId), async () => {
      const prompt = String(raw.prompt || raw.text || '').trim()
      const model = canonicalImageModelId(String(raw.model || raw.model_code || '').trim())
      const ratio = String(raw.ratio || '1:1').trim() || '1:1'
      if (!prompt) throw new Error('prompt 不能为空')
      if (!model) throw new Error('请选择一个生图模型')
      if (model.startsWith('xdh-')) throw new Error('图片生成请使用小葱 API 的生图模型，不要走数字人渠道')
      const listed = await listImageModels()
      if (!listed.models.length) throw new Error(listed.note || '小葱 API 还没有可用的生图模型')
      if (!listed.models.includes(model)) throw new Error(`当前令牌下没有生图模型 ${model}`)
      const job = upsertImageJob(seedImageJob({ prompt, model, ratio }))
      try {
        const payload = await imageGatewayRequest('POST', '/v1/images/generations', {
          model,
          prompt,
          n: 1,
          size: ratioToImageSize(ratio, model),
          response_format: 'url',
        }, /gpt-image/i.test(model) ? 300000 : 180000)
        const published = publicImageJob(await finishImageJob(job, payload))
        recordStudioTask(spaceId, 'ximg', { prompt, model, title: raw.title }, published, {
          prompt,
          modelCode: model,
          mediaUrl: String(published.url || ''),
          status: String(published.status || 'SUCCESS'),
          source: agent ? 'chat' : 'studio',
        })
        return published
      } catch (error: any) {
        const published = publicImageJob(upsertImageJob({
          ...job,
          status: 'FAILURE',
          progress: '100%',
          fail_reason: String(error?.message || '生图失败'),
          finished_at: Date.now(),
        }))
        recordStudioTask(spaceId, 'ximg', { prompt, model, title: raw.title }, published, {
          prompt,
          modelCode: model,
          status: 'FAILURE',
          source: agent ? 'chat' : 'studio',
        })
        return published
      }
    })
  }

  const waitForAudioUrl = async (taskId: string, signal?: AbortSignal): Promise<string> => {
    for (let attempt = 0; attempt < 25; attempt++) {
      if (signal?.aborted) throw new Error('已取消')
      const task = await digitalHumanRequest('GET', `/v1/tasks/${encodeURIComponent(taskId)}`, undefined, 30000)
      patchHistoryFromTask(task, taskId)
      const url = taskString(task, 'audio_url') || taskString(task, 'audio_oss_url')
      if (url && !isGatewayArtifactURL(url)) return url
      const status = String(task?.status || '').toUpperCase()
      if (status === 'FAILURE' || status === 'FAILED' || status === 'ERROR') {
        throw new Error(String(task?.fail_reason || task?.error || '配音失败'))
      }
      if (status === 'SUCCESS' || status === 'SUCCEEDED' || status === 'SUCCEED') {
        throw new Error('语音合成已完成，但未返回音频地址')
      }
      await sleep(800, signal)
    }
    throw new Error('配音超时')
  }

  const speakTalkingHead = async (rawText: string, signal?: AbortSignal, agent?: unknown) => {
    const text = clipNarration(rawText)
    if (!text) throw new Error('没有口播文案')
    if (signal?.aborted) throw new Error('已取消')
    const spaceId = spaceForAgent(agent).id
    const library = loadAssetLibrary()
    const avatar = pickDefaultAsset(library.avatars)
    const voice = pickDefaultAsset(library.voices)
    if (!avatar) throw new Error('还没有默认形象。请先在「工作台」里选一个形象。')
    const published = publicAsset(avatar)
    const modelCode = avatar.modelCode || 'VPro'
    const audioModel = modelCode === 'VPro' || modelCode === 'XPro' ? 'Pro' : modelCode
    const mixcutVoice = pickMixcutVoice('warm_boss') || MIXCUT_VOICES[0]
    const audioBody: Record<string, unknown> = {
      model: 'xdh-audio',
      model_code: audioModel,
      text,
      selected_voice_id: voice?.id || mixcutVoice.voiceId,
      instruction: mixcutVoice.instruction,
      model_type: voice?.id ? 2 : 1,
    }
    const audio = await digitalHumanRequest('POST', '/v1/tasks/xiaocong-digital-human', audioBody, 120000)
    const audioId = String(audio?.task_id || audio?.id || '')
    if (!audioId) throw new Error('配音接口未返回任务 ID')
    recordStudioTask(spaceId, 'xdh-audio', audioBody, audio, {
      title: historyTitle('xdh-audio', text),
      prompt: text,
      source: 'chat',
    })
    const immediateAudio = taskString(audio, 'audio_url') || taskString(audio, 'audio_oss_url')
    const audioUrl = immediateAudio && !isGatewayArtifactURL(immediateAudio)
      ? immediateAudio
      : await waitForAudioUrl(audioId, signal)
    if (signal?.aborted) throw new Error('已取消')
    const videoBody: Record<string, unknown> = {
      model: 'xdh-avatar-video',
      model_code: modelCode,
      text,
      audio_url: audioUrl,
      selected_avatar_model_id: avatar.id,
    }
    if (voice?.id) videoBody.selected_voice_id = voice.id
    const video = await digitalHumanRequest('POST', '/v1/tasks/xiaocong-digital-human', videoBody, 120000)
    const videoId = String(video?.task_id || video?.id || '')
    if (!videoId) throw new Error('视频接口未返回任务 ID')
    recordStudioTask(spaceId, 'xdh-avatar-video', videoBody, video, {
      title: historyTitle('xdh-avatar-video', text),
      prompt: text,
      coverUrl: published.cover_url,
      modelCode,
      source: 'chat',
    })
    return {
      v: 1 as const,
      task_id: videoId,
      audio_task_id: audioId,
      text,
      avatar_id: avatar.id,
      avatar_name: avatar.name,
      voice_id: voice?.id || '',
      voice_name: voice?.name || '',
      model_code: modelCode,
      cover_url: published.cover_url,
    }
  }

  const readCurrentDefaultModel = (): string | undefined => {
    try {
      const adm = ctx.get('agentDefaultModel') as { currentSelection?: () => { provider?: string; model?: string } } | undefined
      const sel = adm?.currentSelection?.()
      if (sel?.provider === 'newapi' && typeof sel.model === 'string' && sel.model) return sel.model
    } catch { /* optional service */ }
    return undefined
  }

  /** Pull /v1/models for the saved sk- and write into llm-pi-ai newapi (+ studio cache). */
  const syncModelsFromToken = async (): Promise<OpResult> => {
    if (!config.newApiToken) return { success: false, error: '尚未设置 XiaocongAPI 令牌' }
    try {
      const base = validateBase(config.newApiBaseUrl)
      const token = normalizeToken(config.newApiToken)
      const result = await syncNewApiModels(ctx, {
        baseUrl: base,
        token,
        currentDefault: readCurrentDefaultModel(),
        fetchModels: async () => newApiRequest(base, '/v1/models', undefined, {
          Authorization: `Bearer ${token}`,
        }),
      })
      if (result.models.length) {
        config = { ...config, newApiModels: result.models }
        saveConfig(config)
      }
      return {
        ...authStatus(),
        modelCount: result.models.length || config.newApiModels.length,
        models: result.models.length ? result.models : config.newApiModels,
        defaultModel: result.defaultModel,
        defaultChanged: result.defaultChanged,
        modelsSyncedLive: result.appliedLive,
        modelsPatchedFiles: result.patchedFiles,
        ...(result.warning ? { warning: result.warning, note: result.warning } : {
          note: result.models.length
            ? `已同步 ${result.models.length} 个模型到 XiaocongAPI 列表`
            : '鉴权成功；暂无可用模型，请在 XiaocongAPI 控制台配置渠道。',
        }),
      }
    } catch {
      return { success: false, error: '同步 XiaocongAPI 模型失败，请检查服务地址、令牌与渠道配置' }
    }
  }

  const authProbe = async (): Promise<OpResult> => {
    if (!config.newApiToken) return { success: false, error: '尚未设置 XiaocongAPI 令牌' }
    // Probe also refreshes the picker from the live key so channels added in console show up.
    const synced = await syncModelsFromToken()
    if (!synced.success) return synced
    return { ...synced, status: 200 }
  }

  if (config.newApiEnabled && config.newApiToken) {
    void syncModelsFromToken().catch(() => { /* boot soft-fail */ })
  }
  /** Stable studio model-token name; older claims used timestamped digital-human-studio-* names. */
  const STUDIO_TOKEN_NAME = 'digital-human-studio'
  const STUDIO_TOKEN_PREFIX = 'digital-human-studio'

  const probeInferenceKey = async (base: string, key: string): Promise<boolean> => {
    try {
      await newApiRequest(base, '/v1/models', undefined, {
        Authorization: `Bearer ${normalizeToken(key)}`,
      })
      return true
    } catch { return false }
  }

  const keyFromBatch = (keys: any, id: number): string => {
    const keyData = keys?.data?.keys || keys?.data
    const entry = Array.isArray(keyData)
      ? keyData.find((item: any) => Number(item.id) === Number(id))
      : keyData?.[String(id)]
    const key = typeof entry === 'string' ? entry : entry?.key
    return typeof key === 'string' ? key : ''
  }

  const persistStudioKey = async (
    base: string,
    key: string,
    userId: number,
    username: string,
    claimed: string,
  ): Promise<OpResult> => {
    config = {
      ...config,
      newApiBaseUrl: base,
      newApiToken: normalizeToken(key),
      newApiEnabled: true,
      newApiUsername: username,
      newApiUserId: userId,
    }
    saveConfig(config)
    await syncCredential()
    const synced = await syncModelsFromToken()
    return { ...authStatus(), claimed, ...(synced.success ? {
      models: synced.models,
      modelCount: synced.modelCount,
      defaultModel: synced.defaultModel,
      defaultChanged: synced.defaultChanged,
      modelsSyncedLive: synced.modelsSyncedLive,
      note: synced.note,
      warning: synced.warning,
    } : { warning: synced.error || '模型同步失败' }) }
  }

  /**
   * Exchange a transient New API access_token for a persisted sk- model token.
   * Reuse a still-valid local NEW_API_TOKEN or an existing studio token on New API;
   * create a new model key only when none are usable.
   */
  const claimFromAccess = async (opts: {
    baseUrl?: string
    accessToken: string
    userId: number | string
    username?: string
  }): Promise<OpResult> => {
    const base = validateBase(opts.baseUrl ?? config.newApiBaseUrl)
    const access = String(opts.accessToken || '').trim()
    const userId = Number(opts.userId)
    if (!access) throw new Error('缺少 access_token')
    if (!Number.isFinite(userId) || userId <= 0) throw new Error('缺少有效用户 id')
    const username = String(opts.username || config.newApiUsername || '')
    const headers = { Authorization: `Bearer ${access}`, 'New-Api-User': String(userId) }
    const followUserWallet = async (item: any) => {
      if (!item || Number(item.id) <= 0 || item.unlimited_quota === true) return
      try {
        await newApiRequest(base, '/api/token/', {
          id: Number(item.id),
          name: String(item.name || STUDIO_TOKEN_NAME),
          expired_time: item.expired_time ?? -1,
          remain_quota: Math.max(0, Number(item.remain_quota) || 0),
          unlimited_quota: true,
          model_limits_enabled: Boolean(item.model_limits_enabled),
          group: typeof item.group === 'string' && item.group ? item.group : 'default',
        }, headers, 'PUT')
      } catch { /* live tokens are repaired in the console; claim can still persist the key */ }
    }

    // 1) Local sk- still valid for this gateway → keep it.
    if (config.newApiToken && config.newApiBaseUrl === base) {
      if (await probeInferenceKey(base, config.newApiToken)) {
        return persistStudioKey(base, config.newApiToken, userId, username || config.newApiUsername, 'reused-local')
      }
    }

    // 2) Reuse an existing New API studio token (stable name or older timestamped names).
    try {
      const found = await newApiRequest(
        base,
        `/api/token/search?keyword=${encodeURIComponent(STUDIO_TOKEN_PREFIX)}`,
        undefined,
        headers,
      )
      const items = Array.isArray(found.data) ? found.data : found.data?.items || []
      const nowSec = Math.floor(Date.now() / 1000)
      const candidates = (items as any[])
        .filter((item) => typeof item?.name === 'string'
          && (item.name === STUDIO_TOKEN_NAME || item.name.startsWith(`${STUDIO_TOKEN_PREFIX}-`))
          && Number(item.id) > 0
          && !(Number(item.expired_time) > 0 && Number(item.expired_time) < nowSec)
          && item.status !== 0 && item.status !== false && item.status !== 'disabled')
        .sort((a, b) => {
          const aExact = a.name === STUDIO_TOKEN_NAME ? 1 : 0
          const bExact = b.name === STUDIO_TOKEN_NAME ? 1 : 0
          if (aExact !== bExact) return bExact - aExact
          return Number(b.id) - Number(a.id)
        })
      for (const item of candidates.slice(0, 8)) {
        const id = Number(item.id)
        try {
          const keys = await newApiRequest(base, '/api/token/batch/keys', { ids: [id] }, headers)
          const key = keyFromBatch(keys, id)
          if (!key) continue
          if (await probeInferenceKey(base, key)) {
            await followUserWallet(item)
            return persistStudioKey(base, key, userId, username, 'reused-remote')
          }
        } catch { /* try next candidate */ }
      }
    } catch { /* search unavailable; fall through to create */ }

    // 3) Create only when missing / invalid / revoked.
    const tokenName = STUDIO_TOKEN_NAME
    const created = await newApiRequest(base, '/api/token/', {
      name: tokenName, expired_time: -1, remain_quota: 0, unlimited_quota: true,
      model_limits_enabled: false, group: 'default',
    }, headers)
    let id = created.data?.id
    if (!id) {
      const found = await newApiRequest(base, `/api/token/search?keyword=${encodeURIComponent(tokenName)}`, undefined, headers)
      const items = Array.isArray(found.data) ? found.data : found.data?.items || []
      id = items.find((item: any) => item.name === tokenName)?.id
    }
    if (!id) throw new Error('令牌已创建但无法定位，请在 XiaocongAPI 控制台查看并粘贴令牌')
    const keys = await newApiRequest(base, '/api/token/batch/keys', { ids: [Number(id)] }, headers)
    const key = keyFromBatch(keys, Number(id))
    if (!key) throw new Error('无法取得完整令牌，请在 XiaocongAPI 控制台查看并粘贴令牌')
    return persistStudioKey(base, key, userId, username, 'created')
  }

  const authLogin = async (body: any): Promise<OpResult> => {
    const base = validateBase(body.baseUrl ?? config.newApiBaseUrl)
    if (typeof body.username !== 'string' || !body.username.trim() || typeof body.password !== 'string' || !body.password)
      throw new Error('请输入用户名与密码')
    // Account access token and password are transient; only the inference key is persisted.
    const login = await newApiRequest(base, '/api/user/login', { username: body.username.trim(), password: body.password })
    const data = login.data || {}
    const access = data.access_token || data.token
    const user = data.user || data
    if (!access || !user.id) throw new Error('登录未完成（可能需要二次验证），请在控制台登录后粘贴令牌')
    return claimFromAccess({
      baseUrl: base,
      accessToken: access,
      userId: user.id,
      username: String(user.username || body.username.trim()),
    })
  }

  /**
   * Browser Sign-in auto-claim:
   * - empty body / no accessToken: if sk- already saved, re-sync and succeed
   * - {accessToken,userId}: exchange for sk- (from same-host /api/user/auth/refresh proxy)
   */
  const authClaim = async (body: any = {}): Promise<OpResult> => {
    const access = typeof body?.accessToken === 'string' ? body.accessToken.trim()
      : typeof body?.access_token === 'string' ? body.access_token.trim() : ''
    if (access) {
      const userId = body.userId ?? body.user_id ?? body.id
      const username = typeof body.username === 'string' ? body.username : undefined
      return claimFromAccess({
        baseUrl: body.baseUrl,
        accessToken: access,
        userId,
        username,
      })
    }
    if (config.newApiToken) {
      const base = validateBase(config.newApiBaseUrl)
      if (await probeInferenceKey(base, config.newApiToken)) {
        await syncCredential()
        const synced = await syncModelsFromToken()
        return { ...authStatus(), claimed: 'reused-local', ...(synced.success ? {
          models: synced.models, modelCount: synced.modelCount, defaultModel: synced.defaultModel,
          note: synced.note, warning: synced.warning, modelsSyncedLive: synced.modelsSyncedLive,
        } : { warning: synced.error || '模型同步失败' }) }
      }
      // Stored key is dead; require a session claim (or password login) to recover/create.
      return { success: false, error: '本地令牌已失效，请重新登录 XiaocongAPI', needsLogin: true, hasToken: true }
    }
    return { success: false, error: '尚未登录 XiaocongAPI，且本机无已保存令牌', needsLogin: true }
  }

  /** Same-host proxies for New API auth cookie paths (Path=/api/user/auth). */
  const proxyNewApiAuth = (upstreamPath: '/api/user/auth/refresh' | '/api/user/auth/logout') =>
    async (req: any, res: any) => {
      if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
      if (req.headers.origin) {
        try {
          if (new URL(req.headers.origin).host !== req.headers.host) {
            sendJson(res, 403, { success: false, error: 'origin not allowed' }); return
          }
        } catch { sendJson(res, 403, { success: false }); return }
      }
      const base = validateBase(config.newApiBaseUrl)
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (typeof req.headers.cookie === 'string' && req.headers.cookie) headers.cookie = req.headers.cookie
      if (typeof req.headers['x-auth-session'] === 'string' && req.headers['x-auth-session']) {
        headers['X-Auth-Session'] = req.headers['x-auth-session']
      }
      const upstream = await fetch(`${base}${upstreamPath}`, {
        method: 'POST',
        redirect: 'error',
        headers,
        body: undefined,
        signal: AbortSignal.timeout(15000),
      })
      const raw = Buffer.from(await upstream.arrayBuffer())
      const outHeaders: Record<string, string | string[]> = {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'content-length': String(raw.length),
        'cache-control': 'no-store',
      }
      const setCookies = typeof (upstream.headers as any).getSetCookie === 'function'
        ? (upstream.headers as any).getSetCookie() as string[]
        : []
      if (setCookies.length) outHeaders['set-cookie'] = setCookies
      else {
        const single = upstream.headers.get('set-cookie')
        if (single) outHeaders['set-cookie'] = single
      }
      res.writeHead(upstream.status, outHeaders)
      res.end(raw)
    }
  const proxyNewApiAuthRefresh = proxyNewApiAuth('/api/user/auth/refresh')
  const proxyNewApiAuthLogout = proxyNewApiAuth('/api/user/auth/logout')


  const getWorkspace = (spaceId = activeSpaceId, workspaceConfig = configForSpace(spaceId)): OpResult => toLosslessJson({
    success: true,
    workspace: {
      folder: workspaceConfig.lastProjectFolder,
      draft_id: workspaceConfig.lastDraftId,
      draft_path: workspaceConfig.lastDraftPath,
      xiaocongcutBaseUrl: workspaceConfig.xiaocongcutBaseUrl,
      xiaocongcutRoot: workspaceConfig.xiaocongcutRoot,
      spaceId,
      spaceName: (spaceStore.spaces.find(space => space.id === spaceId) || currentSpace(spaceStore)).name,
      brief: (spaceStore.spaces.find(space => space.id === spaceId) || currentSpace(spaceStore)).brief,
      briefFilled: briefHasContent((spaceStore.spaces.find(space => space.id === spaceId) || currentSpace(spaceStore)).brief),
      materials: publicStudioMaterials(spaceId),
    },
    ...publicSpaces(spaceStore),
  })

  const probeOnline = async (): Promise<{
    online: boolean
    reachable: boolean
    status: number
    lastProbe: Record<string, unknown>
  }> => {
    const probe = await xiaocongcutFetch(config.xiaocongcutBaseUrl, '/get_font_types')
    const reachable = probe.status !== 0
    // /get_font_types may 404 on some builds; any HTTP response means the server is up.
    const online = reachable && probe.status !== 0
    return {
      online,
      reachable,
      status: probe.status,
      lastProbe: probe.error
        ? { error: probe.error }
        : { ok: probe.ok, httpStatus: probe.status },
    }
  }

  const getStatus = async (): Promise<OpResult> => {
    const probe = await probeOnline()
    const guide = startGuidance(config)
    const pid = config.enginePid
    const pidAlive = pid != null ? isPidAlive(pid) : false
    const pidCmd = pidAlive && pid != null ? processCommand(pid) : null
    const managed = !!(pid && pidAlive && looksLikeXiaocongcut(pidCmd))
    if (pid && !pidAlive) {
      config = { ...config, enginePid: null }
      saveConfig(config)
    }
    return {
      success: true,
      host: { ok: true, plugin: 'digital-human-studio', version: PLUGIN_VERSION },
      xiaocongcut: {
        baseUrl: config.xiaocongcutBaseUrl,
        online: probe.online,
        reachable: probe.reachable,
        status: probe.status,
        lastProbe: probe.lastProbe,
        enginePid: config.enginePid,
        managed,
        pidAlive,
        log: XIAOCONGCUT_LOG,
        start: probe.online ? null : guide,
      },
      workspace: {
        folder: config.lastProjectFolder,
        draft_id: config.lastDraftId,
        draft_path: config.lastDraftPath,
        spaceId: activeSpaceId,
        spaceName: currentSpace(spaceStore).name,
      },
      ...publicSpaces(spaceStore),
    }
  }

  const waitUntilOnline = async (timeoutMs = 20000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const probe = await probeOnline()
      if (probe.online) return true
      await sleep(400)
    }
    return false
  }

  const engineStart = async (): Promise<OpResult> => {
    const before = await probeOnline()
    if (before.online) {
      return {
        success: true,
        already_running: true,
        online: true,
        enginePid: config.enginePid,
        managed: !!(config.enginePid && isPidAlive(config.enginePid)),
        baseUrl: config.xiaocongcutBaseUrl,
        log: XIAOCONGCUT_LOG,
        note: 'Xiaocongcut already online; start is a no-op.',
      }
    }

    // Reuse tracked PID if it is still starting.
    if (config.enginePid && isPidAlive(config.enginePid)) {
      const cmd = processCommand(config.enginePid)
      if (looksLikeXiaocongcut(cmd)) {
        const online = await waitUntilOnline(15000)
        if (online) {
          return {
            success: true,
            already_running: true,
            waited: true,
            online: true,
            enginePid: config.enginePid,
            managed: true,
            baseUrl: config.xiaocongcutBaseUrl,
            log: XIAOCONGCUT_LOG,
          }
        }
      }
    }

    const root = resolveActiveEngineRoot(config)
    if (!root || !existsSync(root)) {
      return {
        success: false,
        error: `xiaocongcutRoot not found: ${root || '(empty)'}`,
        start: startGuidance(config),
      }
    }
    const script = join(root, 'capcut_server.py')
    if (!existsSync(script)) {
      return { success: false, error: `missing ${script}`, start: startGuidance(config) }
    }
    const venvPy = resolveEngineVenvPython(root)
    const py = existsSync(venvPy)
      ? venvPy
      : (findBundledPython(PLUGIN_ROOT_DIR) || (IS_WIN ? 'python' : 'python3'))

    let logFd: number
    try {
      logFd = openSync(XIAOCONGCUT_LOG, 'a')
    } catch (e: any) {
      return { success: false, error: `cannot open log ${XIAOCONGCUT_LOG}: ${e?.message || e}` }
    }

    let child
    try {
      // 渲染要调 ffmpeg/ffprobe。桌面进程的 PATH 往往没有 ~/.local/bin，
      // 不补进来会出现「渲染失败：No such file or directory: 'ffprobe'」。
      // 优先插件自带的 runtime/bin（ffmpeg/ffprobe 随包走），再兜底系统路径。
      const bundledBin = runtimeBin(PLUGIN_ROOT_DIR)
      const extraPath = [bundledBin, join(homedir(), '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin']
        .filter((p) => existsSync(p))
      const childPath = [...extraPath, process.env.PATH || ''].filter(Boolean).join(PATH_DELIMITER)
      const ffmpegBin = findMediaTool(PLUGIN_ROOT_DIR, 'ffmpeg')
      const ffprobeBin = findMediaTool(PLUGIN_ROOT_DIR, 'ffprobe')
      let targetPort = '9001'
      try {
        const parsedPort = new URL(config.xiaocongcutBaseUrl || DEFAULT_BASE).port
        if (parsedPort) targetPort = parsedPort
      } catch { /* ignore */ }
      if (ffmpegBin) {
        const ffDir = dirname(ffmpegBin)
        if (existsSync(ffDir) && !extraPath.includes(ffDir)) extraPath.unshift(ffDir)
      }
      const childPath2 = [...extraPath, process.env.PATH || process.env.Path || ''].filter(Boolean).join(PATH_DELIMITER)
      child = spawn(py, ['capcut_server.py'], {
        cwd: root,
        detached: !IS_WIN,
        windowsHide: true,
        stdio: ['ignore', logFd, logFd],
        env: {
          ...process.env,
          PATH: childPath2,
          XIAOCONGCUT_PORT: targetPort,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          ...(ffmpegBin && !process.env.XCY_FFMPEG ? { XCY_FFMPEG: ffmpegBin } : {}),
          ...(ffprobeBin && !process.env.XCY_FFPROBE ? { XCY_FFPROBE: ffprobeBin } : {}),
        },
      })
    } catch (e: any) {
      try {
        closeSync(logFd)
      } catch {
        /* ignore */
      }
      return { success: false, error: `spawn failed: ${e?.message || e}`, start: startGuidance(config) }
    }
    try {
      closeSync(logFd)
    } catch {
      /* ignore */
    }
    child.unref()

    const pid = child.pid
    if (!pid) {
      return { success: false, error: 'spawn returned no pid', start: startGuidance(config) }
    }

    config = { ...config, enginePid: pid, xiaocongcutRoot: root }
    saveConfig(config)

    const online = await waitUntilOnline(20000)
    if (!online) {
      return {
        success: false,
        error: `Xiaocongcut spawned (pid ${pid}) but did not become online within 20s. Check ${XIAOCONGCUT_LOG}`,
        enginePid: pid,
        managed: true,
        online: false,
        log: XIAOCONGCUT_LOG,
        start: startGuidance(config),
      }
    }

    return {
      success: true,
      started: true,
      online: true,
      enginePid: pid,
      managed: true,
      baseUrl: config.xiaocongcutBaseUrl,
      xiaocongcutRoot: root,
      log: XIAOCONGCUT_LOG,
    }
  }

  const engineStop = async (): Promise<OpResult> => {
    const pid = config.enginePid
    if (!pid) {
      const probe = await probeOnline()
      if (probe.online) {
        return {
          success: false,
          error:
            'Xiaocongcut is online but not managed by this plugin (no tracked enginePid). Refusing to kill unrelated processes. Start via the plugin next time so stop can manage it.',
          online: true,
          managed: false,
          log: XIAOCONGCUT_LOG,
        }
      }
      return {
        success: true,
        already_stopped: true,
        online: false,
        managed: false,
        log: XIAOCONGCUT_LOG,
      }
    }

    if (!isPidAlive(pid)) {
      config = { ...config, enginePid: null }
      saveConfig(config)
      const probe = await probeOnline()
      return {
        success: true,
        already_stopped: true,
        cleared_stale_pid: pid,
        online: probe.online,
        managed: false,
        log: XIAOCONGCUT_LOG,
      }
    }

    const cmd = processCommand(pid)
    if (!looksLikeXiaocongcut(cmd)) {
      return {
        success: false,
        error: `refusing to kill pid ${pid}: command does not look like Xiaocongcut (${cmd || 'unknown'})`,
        enginePid: pid,
        managed: false,
      }
    }

    try {
      process.kill(pid, 'SIGTERM')
    } catch (e: any) {
      return { success: false, error: `SIGTERM failed for pid ${pid}: ${e?.message || e}`, enginePid: pid }
    }

    const deadline = Date.now() + 8000
    while (Date.now() < deadline && isPidAlive(pid)) {
      await sleep(200)
    }
    if (isPidAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* ignore */
      }
      await sleep(300)
    }

    const stillAlive = isPidAlive(pid)
    if (!stillAlive) {
      config = { ...config, enginePid: null }
      saveConfig(config)
    }

    const probe = await probeOnline()
    return {
      success: !stillAlive,
      stopped: !stillAlive,
      enginePid: stillAlive ? pid : null,
      online: probe.online,
      managed: stillAlive,
      log: XIAOCONGCUT_LOG,
      error: stillAlive ? `pid ${pid} still alive after SIGKILL` : undefined,
    }
  }

  const configForSpace = (spaceId: string): StudioConfig => ({ ...config, ...spaceWorkspace(spaceStore, spaceId) })

  // 引擎自愈：9001 没起或中途挂了时，先自动拉起一次再重试；
  // 覆盖草稿、片段、花字、渲染等全部剪辑工具，避免「引擎离线、调用失败」。
  const vcFetch = async (path: string, body?: unknown, method?: string, baseUrl?: string) => {
    const base = baseUrl || config.xiaocongcutBaseUrl
    const first = await xiaocongcutFetch(base, path, body, method)
    if (first.status !== 0) return first
    try {
      console.log(`[digital-human-studio] engine unreachable on ${path}; auto-starting Xiaocongcut…`)
      await engineStart()
      await sleep(400)
    } catch (e: any) {
      console.log(`[digital-human-studio] engine auto-start failed: ${e?.message || e}`)
    }
    return xiaocongcutFetch(base, path, body, method)
  }
  const saveCompanyWorkspace = (spaceId: string, next: StudioConfig) => {
    if (!spaceStore.spaces.some(space => space.id === spaceId)) return // deleted while task was running
    const patch = { lastProjectFolder: next.lastProjectFolder, lastDraftId: next.lastDraftId, lastDraftPath: next.lastDraftPath }
    spaceStore = patchSpace(spaceStore, spaceId, patch)
    saveSpaceStore(spaceStore)
    if (activeSpaceId === spaceId) {
      config = { ...config, ...patch }
      saveConfig(config)
    }
  }

  const listDrafts = async (folderInput?: string, spaceId = activeSpaceId): Promise<OpResult> => {
    let operationConfig = configForSpace(spaceId)
    const saveOperationWorkspace = (next: StudioConfig) => {
      operationConfig = next
      saveCompanyWorkspace(spaceId, next)
    }
    let folder = expandPath(folderInput || operationConfig.lastProjectFolder)
    if (!folder) {
      return { success: false, error: 'folder required', hint: DEFAULT_FOLDER }
    }
    if (!existsSync(folder)) {
      return { success: false, error: `folder not found: ${folder}`, folder }
    }
    const drafts = scanDraftFolder(folder)
    saveOperationWorkspace({ ...operationConfig, lastProjectFolder: folder })

    let xiaocongcutProjects: any[] = []
    const vc = await vcFetch('/list_projects', {}, undefined, operationConfig.xiaocongcutBaseUrl)
    if (vc.data?.success && Array.isArray(vc.data?.output?.projects)) {
      xiaocongcutProjects = vc.data.output.projects
    }

    return {
      success: true,
      folder,
      count: drafts.length,
      drafts,
      xiaocongcut_projects: xiaocongcutProjects,
      workspace: {
        folder: operationConfig.lastProjectFolder,
        draft_id: operationConfig.lastDraftId,
        draft_path: operationConfig.lastDraftPath,
      },
    }
  }

  const loadDraft = async (args: {
    path?: string
    draft_path?: string
    name?: string
    project_name?: string
    draft_id?: string
    folder?: string
  }, spaceId = activeSpaceId): Promise<OpResult> => {
    let operationConfig = configForSpace(spaceId)
    const saveOperationWorkspace = (next: StudioConfig) => {
      operationConfig = next
      saveCompanyWorkspace(spaceId, next)
    }
    let draftPath = expandPath(String(args.path || args.draft_path || ''))
    const name = String(args.name || args.project_name || args.draft_id || '').trim()
    const folderHint = expandPath(String(args.folder || operationConfig.lastProjectFolder || ''))

    if (!draftPath && name && folderHint) {
      const candidate = join(folderHint, name)
      draftPath = existsSync(candidate) ? candidate : expandPath(name)
    }
    if (!draftPath && name) draftPath = expandPath(name)

    if (!draftPath || !existsSync(draftPath)) {
      return {
        success: false,
        error: `draft path not found: ${draftPath || name || '(empty)'}`,
      }
    }

    let st
    try {
      st = statSync(draftPath)
    } catch {
      return { success: false, error: `cannot stat: ${draftPath}` }
    }
    if (!st.isDirectory()) {
      return { success: false, error: 'draft path must be a directory' }
    }

    let summary: Record<string, unknown> | null = null
    let fromXiaocongcut = false
    const vc = await vcFetch('/read_project', {
      project_name: draftPath,
    }, undefined, operationConfig.xiaocongcutBaseUrl)
    if (vc.data?.success && vc.data?.output) {
      summary = vc.data.output
      fromXiaocongcut = true
    } else {
      summary = readLocalSummary(draftPath)
    }

    const draftId = basename(draftPath)
    const parentFolder = dirname(draftPath)
    const loadedDuration = Number((summary as any)?.duration_us || (summary as any)?.duration || 0)
    timelineCursorByDraft.set(draftId, loadedDuration > 1000 ? loadedDuration / 1_000_000 : (loadedDuration > 0 ? loadedDuration : 0))
    saveOperationWorkspace({
      ...operationConfig,
      lastProjectFolder: folderHint || parentFolder,
      lastDraftId: draftId,
      lastDraftPath: draftPath,
    })

    const canvas = (summary as any)?.canvas_config || {}
    return {
      success: true,
      draft_id: draftId,
      draft_path: draftPath,
      draft_folder: parentFolder,
      project_name: (summary as any)?.project_name || draftId,
      summary,
      from_xiaocongcut: fromXiaocongcut,
      width: Number(canvas.width) || undefined,
      height: Number(canvas.height) || undefined,
      workspace: {
        folder: operationConfig.lastProjectFolder,
        draft_id: operationConfig.lastDraftId,
        draft_path: operationConfig.lastDraftPath,
      },
    }
  }

  const createDraft = async (args: { width?: number; height?: number } = {}, spaceId = activeSpaceId): Promise<OpResult> => {
    let operationConfig = configForSpace(spaceId)
    const saveOperationWorkspace = (next: StudioConfig) => {
      operationConfig = next
      saveCompanyWorkspace(spaceId, next)
    }
    const width = Number(args.width) || 1080
    const height = Number(args.height) || 1920
    const result = await vcFetch('/create_draft', { width, height }, undefined, operationConfig.xiaocongcutBaseUrl)
    if (result.error) {
      return {
        success: false,
        error: `Xiaocongcut unreachable at ${operationConfig.xiaocongcutBaseUrl}: ${result.error}`,
        start: startGuidance(operationConfig),
      }
    }
    if (result.data?.success && result.data?.output?.draft_id) {
      const createdId = String(result.data.output.draft_id)
      timelineCursorByDraft.set(createdId, 0)
      saveOperationWorkspace({
        ...operationConfig,
        lastDraftId: createdId,
        lastDraftPath: '',
      })
    }
    if (result.data && typeof result.data === 'object') {
      return { ...result.data, workspace: getWorkspace(spaceId, operationConfig).workspace }
    }
    return { success: false, error: 'empty response from Xiaocongcut create_draft' }
  }

  const addVideo = async (args: {
    draft_id?: string
    paths?: string[]
    video_url?: string
    path?: string
    width?: number
    height?: number
    start?: number
    end?: number
    target_start?: number
    volume?: number
    speed?: number
    track_name?: string
    duration?: number
    draft_folder?: string
    transition?: string
    transition_duration?: number
  }, spaceId = activeSpaceId): Promise<OpResult> => {
    let operationConfig = configForSpace(spaceId)
    const saveOperationWorkspace = (next: StudioConfig) => {
      operationConfig = next
      saveCompanyWorkspace(spaceId, next)
    }
    const draft_id = args.draft_id || operationConfig.lastDraftId
    const paths: string[] = Array.isArray(args.paths)
      ? args.paths
      : args.video_url
        ? [args.video_url]
        : args.path
          ? [args.path]
          : []

    if (!paths.length) {
      return { success: false, error: 'paths / video_url / path required' }
    }
    if (!draft_id) {
      return { success: false, error: 'draft_id required (create or load a draft first)' }
    }

    const width = Number(args.width) || 1080
    const height = Number(args.height) || 1920
    const start = Number(args.start) > 0 ? Number(args.start) : 0
    const requestedEnd = Number(args.end)
    const speed = Number(args.speed) > 0 ? Number(args.speed) : 1.0
    const userSetTarget = args.target_start != null && Number.isFinite(Number(args.target_start))
    const results: any[] = []
    let currentDraftId = draft_id
    let cursor = userSetTarget ? Math.max(0, Number(args.target_start)) : (timelineCursorByDraft.get(currentDraftId) || 0)

    for (const raw of paths) {
      const video_url = normalizeVideoUrl(raw)
      if (!video_url) continue
      const localPath = expandPath(video_url)
      const probed = probeMediaDuration(localPath)
      const materialDuration = Number(args.duration) > 0 ? Number(args.duration) : probed
      const end = Number.isFinite(requestedEnd) && requestedEnd > start
        ? requestedEnd
        : (materialDuration > start ? materialDuration : 0)
      if (!(end > start)) {
        return {
          success: false,
          error: `无法确定素材时长，请为 ${raw} 指定 start 和 end（秒）`,
          results,
          draft_id: currentDraftId,
        }
      }
      const payload: Record<string, unknown> = {
        video_url,
        draft_id: currentDraftId,
        width,
        height,
        start,
        end,
        target_start: cursor,
        volume: args.volume == null ? 1.0 : Number(args.volume),
        speed,
        track_name: args.track_name || 'video_main',
      }
      if (materialDuration > 0) payload.duration = materialDuration
      if (args.draft_folder) payload.draft_folder = args.draft_folder
      if (args.transition) {
        payload.transition = String(args.transition)
        payload.transition_duration = args.transition_duration ?? 0.5
      }

      const result = await vcFetch('/add_video', payload, undefined, operationConfig.xiaocongcutBaseUrl)
      if (result.error) {
        return {
          success: false,
          error: `Xiaocongcut unreachable: ${result.error}`,
          results,
          start: startGuidance(operationConfig),
        }
      }
      results.push(result.data)
      if (!result.data?.success) {
        return {
          success: false,
          error: result.data?.error || 'add_video failed',
          results,
          draft_id: currentDraftId,
        }
      }
      const out = result.data.output || {}
      if (out.draft_id) currentDraftId = out.draft_id
      cursor += (end - start) / speed
      timelineCursorByDraft.set(currentDraftId, cursor)
    }

    const last = results[results.length - 1]
    if (currentDraftId) {
      timelineCursorByDraft.set(currentDraftId, cursor)
      saveOperationWorkspace({ ...operationConfig, lastDraftId: String(currentDraftId) })
    }
    return {
      success: true,
      draft_id: currentDraftId || last?.output?.draft_id,
      draft_url: last?.output?.draft_url,
      added: results.length,
      results,
      workspace: getWorkspace(spaceId, operationConfig).workspace,
    }
  }

  const addAudio = async (args: {
    draft_id?: string
    path?: string
    audio_url?: string
    start?: number
    end?: number
    target_start?: number
    volume?: number
    speed?: number
    duration?: number
    track_name?: string
    width?: number
    height?: number
  }, spaceId = activeSpaceId): Promise<OpResult> => {
    let operationConfig = configForSpace(spaceId)
    const draft_id = args.draft_id || operationConfig.lastDraftId
    const audio_url = normalizeVideoUrl(String(args.path || args.audio_url || ''))
    if (!audio_url) return { success: false, error: 'path / audio_url required' }
    if (!draft_id) return { success: false, error: 'draft_id required (create or load a draft first)' }
    const localPath = expandPath(audio_url)
    const probed = probeAudioDuration(localPath) || probeMediaDuration(localPath)
    const duration = Number(args.duration) > 0 ? Number(args.duration) : probed
    const start = Number(args.start) > 0 ? Number(args.start) : 0
    const requestedEnd = Number(args.end)
    const end = Number.isFinite(requestedEnd) && requestedEnd > start
      ? requestedEnd
      : (duration > start ? duration : 0)
    if (!(end > start)) {
      return { success: false, error: `无法确定音频时长，请为 ${audio_url} 指定 end（秒）` }
    }
    const speed = Number(args.speed) > 0 ? Number(args.speed) : 1
    const userSetTarget = args.target_start != null && Number.isFinite(Number(args.target_start))
    const target_start = userSetTarget ? Math.max(0, Number(args.target_start)) : 0
    const payload: Record<string, unknown> = {
      audio_url,
      draft_id,
      start,
      end,
      target_start,
      duration,
      volume: args.volume == null ? 1 : Number(args.volume),
      speed,
      track_name: args.track_name || 'audio_main',
      width: Number(args.width) || 1080,
      height: Number(args.height) || 1920,
    }
    const result = await vcFetch('/add_audio', payload, undefined, operationConfig.xiaocongcutBaseUrl)
    if (result.error) {
      return { success: false, error: `Xiaocongcut unreachable: ${result.error}`, start: startGuidance(operationConfig) }
    }
    if (!result.data?.success) {
      return { success: false, error: result.data?.error || 'add_audio failed', draft_id }
    }
    const out = result.data.output || {}
    const nextId = String(out.draft_id || draft_id)
    if (nextId) saveCompanyWorkspace(spaceId, { ...operationConfig, lastDraftId: nextId })
    return toLosslessJson({
      success: true,
      draft_id: nextId,
      draft_url: out.draft_url || '',
      path: localPath,
      start,
      end,
      target_start,
      duration,
      workspace: getWorkspace(spaceId).workspace,
    })
  }

  const rememberVoice = (spaceId: string, voiceId: string) => {
    applySpaceStore(patchSpace(spaceStore, spaceId, { preferredVoiceId: voiceId }))
  }

  const narrationChoices = () => ({
    choices: voiceChoiceMenu(),
    presets: MIXCUT_VOICES.map(item => ({ id: item.id, name: item.name })),
    cloned: loadAssetLibrary().voices.map(item => ({ id: item.id, name: item.name })),
  })

  const resolveNarrationVoice = (spaceId: string, wanted = ''): {
    voiceId: string
    name: string
    instruction: string
    modelType: 1 | 2
    style: string
  } | { needChoice: true } | { needClone: true } => {
    const space = spaceStore.spaces.find(item => item.id === spaceId) || currentSpace(spaceStore)
    const asked = String(wanted || '').trim()
    const stored = String(space.preferredVoiceId || '').trim()
    const key = asked || stored
    if (!key) return { needChoice: true }
    if (/我的声音|自己的声音|克隆我/.test(key)) {
      const cloned = loadAssetLibrary().voices.find(item => item.id === stored) || loadAssetLibrary().voices[0]
      if (!cloned?.id) return { needClone: true }
      return {
        voiceId: cloned.id,
        name: cloned.name || '我的声音',
        instruction: '用这个人平时说话的语气，自然、有情绪，不要播音腔。',
        modelType: 2,
        style: cloned.id,
      }
    }
    const preset = pickMixcutVoice(key)
    if (preset) {
      return {
        voiceId: preset.voiceId,
        name: preset.name,
        instruction: preset.instruction,
        modelType: 1,
        style: preset.id,
      }
    }
    const cloned = loadAssetLibrary().voices.find(item => item.id === key || item.name === key)
    if (cloned?.id) {
      return {
        voiceId: cloned.id,
        name: cloned.name || '我的声音',
        instruction: '用这个人平时说话的语气，自然、有情绪，不要播音腔。',
        modelType: 2,
        style: cloned.id,
      }
    }
    return { needChoice: true }
  }

  const uploadPublicAudio = async (abs: string): Promise<string> => {
    if (!existsSync(abs)) throw new Error(`找不到录音：${abs}`)
    const body = readFileSync(abs)
    if (body.length < 8_000) throw new Error('录音太短，说满十来秒再传')
    if (body.length > 30 * 1024 * 1024) throw new Error('录音不要超过 30MB')
    if (!config.newApiToken) throw new Error('尚未设置 XiaocongAPI 令牌')
    const response = await fetch(`${validateBase(config.newApiBaseUrl)}/v1/xiaocong/uploads`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${normalizeToken(config.newApiToken)}`,
        accept: 'application/json',
        'content-type': audioContentType(abs),
        'x-file-name': encodeURIComponent(basename(abs)),
      },
      body,
      signal: AbortSignal.timeout(120_000),
    })
    const value = await response.json().catch(() => null) as any
    const url = String(value?.data?.url || value?.url || '').trim()
    if (!response.ok || !/^https?:\/\//i.test(url)) throw new Error(String(value?.error || value?.message || '录音上传失败'))
    return url
  }

  const waitForClonedVoice = async (taskId: string): Promise<any> => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const task = await digitalHumanRequest('GET', `/v1/tasks/${encodeURIComponent(taskId)}`, undefined, 30000)
      const status = String(task?.status || '').toUpperCase()
      if (status === 'SUCCESS' || status === 'SUCCEEDED' || status === 'SUCCEED') return task
      if (status === 'FAILURE' || status === 'FAILED' || status === 'ERROR') {
        throw new Error(String(task?.fail_reason || task?.error || '声音克隆失败'))
      }
      await sleep(1500)
    }
    throw new Error('声音还在克隆，过一会儿再配')
  }

  const cloneVoiceFromFile = async (spaceId: string, filePath: string, name = '我的声音') => {
    const abs = expandPath(filePath)
    const sampleUrl = await uploadPublicAudio(abs)
    const created = await digitalHumanRequest('POST', '/v1/tasks/xiaocong-digital-human', {
      model: 'xdh-voice-clone',
      name: name || '我的声音',
      sample_url: sampleUrl,
      language: 'zh',
      model_code: 'SPro',
    }, 120000)
    const taskId = String(created?.task_id || created?.data?.task_id || created?.id || created?.data?.id || '').trim()
    const task = taskId ? await waitForClonedVoice(taskId) : created
    await upsertCloneAssetFromTask(task)
    const identity = cloneAssetFromTask(task)
    if (!identity?.id) throw new Error('克隆完成了，但没有拿到音色编号')
    rememberVoice(spaceId, identity.id)
    return { voiceId: identity.id, name: identity.name || name || '我的声音', sampleUrl }
  }

  const addNarration = async (args: {
    text?: string
    voice?: string
    draft_id?: string
    target_start?: number
    volume?: number
    track_name?: string
  }, spaceId = activeSpaceId): Promise<OpResult> => {
    const text = clipNarration(String(args.text || ''))
    if (!text) throw new Error('没有口播文案')
    const voice = resolveNarrationVoice(spaceId, String(args.voice || ''))
    if ('needClone' in voice) {
      return toLosslessJson({
        success: false,
        needClone: true,
        ...narrationChoices(),
        hint: '客户要自己的声音。让他把一段十到三十秒的说话录音丢进对话，再 dh_clone_voice。',
      })
    }
    if ('needChoice' in voice) {
      return toLosslessJson({
        success: false,
        needVoice: true,
        ...narrationChoices(),
        hint: `先问客户：「配音用哪个？${voiceChoiceMenu()}。」选好后 dh_set_voice，再配。`,
      })
    }
    const payload = await digitalHumanRequest('POST', '/v1/xiaocong/digital-human/tts', {
      text,
      voice_id: voice.voiceId,
      instruction: voice.instruction,
      model_type: voice.modelType,
      language: 'zh',
    }, 120000)
    const audioUrl = String(payload?.data?.audio_url || payload?.audio_url || '').trim()
    if (!/^https?:\/\//i.test(audioUrl)) throw new Error('配音没返回音频地址')
    const clip = await downloadNarrationAudio(audioUrl, join(spaceAssetRoot(spaceId), 'narration'))
    const added = await addAudio({
      draft_id: args.draft_id,
      path: clip.path,
      end: clip.duration,
      duration: clip.duration,
      target_start: args.target_start,
      volume: args.volume,
      track_name: args.track_name || 'audio_main',
    }, spaceId)
    return toLosslessJson({
      ...added,
      narration: {
        ...clip,
        style: voice.style,
        voice: voice.name,
        voiceId: voice.voiceId,
      },
      hint: added.success
        ? `口播已用「${voice.name}」挂上时间线。垫的画面 volume 设 0。`
        : '配音文件已生成，但没挂上草稿。先建草稿再 dh_add_audio。',
    })
  }

  const rememberMusic = (spaceId: string, musicId: string) => {
    applySpaceStore(patchSpace(spaceStore, spaceId, { preferredMusic: musicId }))
  }

  const addMusicBed = async (args: {
    music?: string
    path?: string
    draft_id?: string
    volume?: number
  }, spaceId = activeSpaceId): Promise<OpResult> => {
    const own = String(args.path || '').trim()
    if (own) {
      const added = await addAudio({
        draft_id: args.draft_id,
        path: own,
        volume: args.volume == null ? 0.4 : Number(args.volume),
        track_name: 'audio_bed',
        target_start: 0,
      }, spaceId)
      return toLosslessJson({
        ...added,
        music: '自己的曲子',
        hint: added.success ? '已垫上客户的曲子，声音压在口播下面。' : '曲子没挂上。先建草稿。',
      })
    }
    const space = spaceStore.spaces.find(item => item.id === spaceId) || currentSpace(spaceStore)
    const picked = pickMixcutMusic(String(args.music || space.preferredMusic || ''))
    if (picked == null) {
      return toLosslessJson({
        success: false,
        needMusic: true,
        choices: musicChoiceMenu(),
        hint: `先问客户：「要不要垫一段音乐？${musicChoiceMenu()}。」选好后 dh_set_music，再 dh_add_music。`,
      })
    }
    if (picked === 'none') {
      return toLosslessJson({ success: true, skipped: true, hint: '客户说先不要音乐。' })
    }
    if (!mixcutMusicReady(picked)) throw new Error('内置垫乐文件缺失')
    const added = await addAudio({
      draft_id: args.draft_id,
      path: mixcutMusicFile(picked),
      volume: args.volume == null ? picked.volume : Number(args.volume),
      track_name: 'audio_bed',
      target_start: 0,
    }, spaceId)
    return toLosslessJson({
      ...added,
      music: picked.name,
      hint: added.success ? `已垫上「${picked.name}」，音量已经在人声下面，不要再改，也不要测分贝。` : '垫乐没挂上。先建草稿。',
    })
  }

  const addNativeText = async (args: {
    draft_id?: string
    text: string
    font_size?: number
    font_color?: string
    shadow_enabled?: boolean
    border_width?: number
    intro_animation?: string
    outro_animation?: string
    start?: number
    end?: number
    transform_y?: number
    track_name?: string
    effect_effect_id?: string
    flower_style?: string
    bubble_effect_id?: string
    bubble_resource_id?: string
    font?: string
  }, spaceId = activeSpaceId): Promise<OpResult> => {
    const operationConfig = configForSpace(spaceId)
    const draft_id = args.draft_id || operationConfig.lastDraftId
    if (!draft_id) return { success: false, error: 'draft_id required (create or load a draft first)' }
    if (!String(args.text || '').trim()) return { success: false, error: 'text required' }

    // Prefer human alias flower_style; digit effect_effect_id also accepted.
    const aliasOrId = (args.flower_style && String(args.flower_style).trim()) || args.effect_effect_id
    const flower = (args.flower_style && String(args.flower_style).trim() && !/^\d+$/.test(String(args.flower_style).trim()))
      ? resolveFlowerStyleAlias(args.flower_style)
      : (aliasOrId ? ( /^\d+$/.test(String(aliasOrId).trim())
          ? resolveNativeFlowerEffectId(String(aliasOrId))
          : resolveFlowerStyleAlias(String(aliasOrId)) )
        : { ok: true as const })
    if (!flower.ok) {
      return JSON.parse(JSON.stringify({
        success: false,
        error: flower.error,
        hint: '先调 dh_list_native_text_effects；或传 flower_style=默认花字 / 目录中文名。不要用手填云端编码ID。原生可改字≠PNG(dh_add_local_styled_text)。',
      }))
    }
    const bubble = resolveNativeBubbleIds({
      bubble_effect_id: args.bubble_effect_id,
      bubble_resource_id: args.bubble_resource_id,
    })
    if (!bubble.ok) {
      return JSON.parse(JSON.stringify({ success: false, error: bubble.error }))
    }

    const payload: Record<string, unknown> = {
      draft_id,
      text: String(args.text).trim().slice(0, 80),
      font_size: args.font_size ?? 8.0,
      font_color: args.font_color || '#ffffff',
      shadow_enabled: !!args.shadow_enabled,
      border_width: args.border_width ?? 0,
      start: args.start ?? 0,
      end: args.end ?? 3,
      transform_y: args.transform_y ?? -0.8,
      track_name: args.track_name || 'text_main',
    }
    if (args.font) payload.font = String(args.font)
    if (args.intro_animation) payload.intro_animation = args.intro_animation
    if (args.outro_animation) payload.outro_animation = args.outro_animation
    if (flower.id) payload.effect_effect_id = flower.id
    if (bubble.bubble_effect_id && bubble.bubble_resource_id) {
      payload.bubble_effect_id = bubble.bubble_effect_id
      payload.bubble_resource_id = bubble.bubble_resource_id
    }

    const result = await vcFetch('/add_text', payload, undefined, operationConfig.xiaocongcutBaseUrl)
    if (result.error) return { success: false, error: `Xiaocongcut unreachable: ${result.error}`, start: startGuidance(operationConfig) }
    if (!result.data?.success) return { success: false, error: result.data?.error || 'add_text failed', draft_id }

    const warnings: string[] = []
    if (flower.warning) warnings.push(flower.warning)
    if (bubble.warning) warnings.push(bubble.warning)
    if (flower.id) {
      warnings.push('text_effect resource is NOT bundled; Jianying/CapCut may download on open. UI editability not verified in this session.')
    }
    return JSON.parse(JSON.stringify({
      success: true,
      draft_id,
      output: result.data.output,
      native: {
        editable_text: true,
        kind: flower.id ? 'native_text_plus_text_effect_ref' : 'native_text_basic',
        effect_effect_id: flower.id || null,
        bubble_effect_id: bubble.bubble_effect_id || null,
        bubble_resource_id: bubble.bubble_resource_id || null,
        not_png_overlay: true,
        not_xiaocongcut_cloud_effect_id: true,
      },
      warnings,
      note: flower.id
        ? '已调用本地9001 /add_text：原生可编辑文字 + text_effect 平台ID引用（非PNG、非云端Effect编码）'
        : '已调用本地9001 /add_text：原生可编辑文字（无花字引用）',
    }))
  }

  const flowerPlace = (style: string) => {
    const key = style.trim()
    if (key === 'hook_yellow' || key === '黄底大字') return { transform_y: 0.52, start: 0, end: 3 }
    if (key === 'warn_orange' || key === '橙色提醒') return { transform_y: 0.46, start: 0, end: 3 }
    if (key === 'shop_sign' || key === '店招红金') return { transform_y: 0.68, start: 0, end: 15 }
    if (key === 'subtitle_white' || key === '白字黑边') return { transform_y: -0.72, start: 0, end: 15 }
    // 图形类（配包装动效）：位置按各自用途定，别都堆在同一处
    if (key === 'stamp_seal' || key === '印章') return { transform_y: 0.12, start: 0, end: 2.5 }
    if (key === 'info_card' || key === '深色卡片') return { transform_y: 0.28, start: 0, end: 4 }
    if (key === 'check_mark' || key === '对勾') return { transform_y: 0.18, start: 0, end: 2 }
    if (key === 'big_number' || key === '数字放大') return { transform_y: 0.3, start: 0, end: 3 }
    if (key === 'sheen_text' || key === '银灰金属字' || key === '高光字') return { transform_y: -0.42, start: 0, end: 3 }
    return { transform_y: -0.58, start: 0, end: 3 }
  }

  const addLocalStyledTextToDraft = async (args: {
    draft_id?: string
    text: string
    style: string
    entrance?: string
    start?: number
    end?: number
    intro_animation?: string
    with_preview_video?: boolean
    transform_y?: number
  }, spaceId = activeSpaceId): Promise<OpResult> => {
    const rendered: any = renderLocalStyledText({
      spaceId,
      text: args.text,
      style: args.style,
      entrance: args.entrance,
      withPreviewVideo: args.with_preview_video !== false,
    })
    if (!rendered.success || !rendered.item) {
      return JSON.parse(JSON.stringify({ success: false, error: rendered.error || '本地花字渲染失败', missing: rendered.missing || [], runtime: rendered.runtime || null }))
    }
    const operationConfig = configForSpace(spaceId)
    const draft_id = args.draft_id || operationConfig.lastDraftId
    const honesty = '本层为本地栅格化透明PNG叠层，不是剪映原生 effect_effect_id，也不走Xiaocongcut云端。'
    if (!draft_id) {
      return {
        success: true,
        addedToDraft: false,
        item: rendered.item,
        honesty,
        note: '已渲染到本公司目录；当前无草稿，请先 create_draft 后再调用本工具把叠层加入草稿。',
      }
    }
    // Prefer bare absolute path (Xiaocongcut treats non-http as local). file:// also accepted after server normalize.
    const image_url = rendered.item.png
    const resolvedIntro = resolveImageIntroForDraft({
      entrance: args.entrance,
      intro_animation: args.intro_animation,
    })
    if (!resolvedIntro.ok) {
      return {
        success: false,
        addedToDraft: false,
        item: rendered.item,
        honesty,
        error: resolvedIntro.error,
        unsupportedAnimation: resolvedIntro.unsupported,
        supportedImageIntros: resolvedIntro.supported,
        note: '未调用 /add_image，避免半成品草稿；PNG 已保留在本公司目录。',
      }
    }
    const place = flowerPlace(String(args.style || ''))
    const payload: Record<string, unknown> = {
      draft_id,
      image_url,
      start: args.start ?? place.start,
      end: args.end ?? place.end,
      track_name: 'local_styled_text',
      // CapCut/Jianying: transform_y unit = half canvas height; negative moves down.
      // Explicit args.transform_y always wins when provided.
      transform_y: args.transform_y != null ? Number(args.transform_y) : place.transform_y,
      scale_x: 1,
      scale_y: 1,
    }
    // Optional CapCut image intro on the raster layer (still not Effect ID 花字)
    if (resolvedIntro.intro) {
      payload.intro_animation = resolvedIntro.intro
      payload.intro_animation_duration = 0.45
    }
    const result = await vcFetch('/add_image', payload, undefined, operationConfig.xiaocongcutBaseUrl)
    if (result.error) {
      return {
        success: true,
        addedToDraft: false,
        item: rendered.item,
        honesty,
        warning: `本地花字已渲染，但9001不可达未写入草稿：${result.error}`,
        start: startGuidance(operationConfig),
      }
    }
    if (!result.data?.success) {
      return {
        success: true,
        addedToDraft: false,
        item: rendered.item,
        honesty,
        warning: result.data?.error || 'add_image failed；PNG已保留在本公司目录',
      }
    }
    return {
      success: true,
      addedToDraft: true,
      draft_id: result.data.output?.draft_id || draft_id,
      item: rendered.item,
      draftOutput: result.data.output,
      honesty,
      imageIntro: resolvedIntro.intro || null,
      imageIntroNote: resolvedIntro.note || null,
      imageIntroMappedFrom: resolvedIntro.mappedFrom || null,
      note: '已将本地花字PNG叠层加入当前草稿（可编辑的是图片轨，不是原生花字Effect）。',
    }
  }



  const saveDraft = async (args: {
    draft_id?: string
    draft_folder?: string
    project_name?: string
    auto_deploy?: boolean
    auto_reload?: boolean
  } = {}, spaceId = activeSpaceId): Promise<OpResult> => {
    const operationConfig = configForSpace(spaceId)
    const draft_id = args.draft_id || operationConfig.lastDraftId
    if (!draft_id) {
      return { success: false, error: 'draft_id required' }
    }
    const draft_folder =
      args.draft_folder ||
      (operationConfig.lastDraftPath ? dirname(operationConfig.lastDraftPath) : operationConfig.lastProjectFolder) ||
      undefined
    const payload = {
      draft_id,
      draft_folder,
      project_name: args.project_name || draft_id,
      auto_deploy: args.auto_deploy ?? true,
      auto_reload: args.auto_reload ?? false,
    }
    const result = await vcFetch('/save_draft', payload, undefined, operationConfig.xiaocongcutBaseUrl)
    if (result.error) {
      return toLosslessJson({
        success: false,
        saved: false,
        error: `Xiaocongcut unreachable: ${result.error}`,
        start: startGuidance(operationConfig),
        assetCheck: null,
        finalize: { ran: false, ok: false, error: 'xiaocongcut unreachable' },
      })
    }
    if (result.data && typeof result.data === 'object') {
      const { finalizeSavedDraftAssets } = await import('./draft-save-finalize.js')
      const saved = await processSaveDraftResponse({
        xiaocongcutData: result.data as any,
        draftId: draft_id,
        projectName: String(payload.project_name || draft_id),
        draftFolder: draft_folder || null,
        allowRoots: [draft_folder || '', operationConfig.lastProjectFolder || ''].filter(Boolean),
        workspace: getWorkspace(spaceId, operationConfig).workspace,
        finalizeFn: finalizeSavedDraftAssets as any,
      })
      const space = spaceStore.spaces.find(item => item.id === spaceId)
      const used = pickViralRecipe({ lastId: space?.lastViralRecipe, seed: spaceId })
      applySpaceStore(patchSpace(spaceStore, spaceId, { lastViralRecipe: used.id }))
      return saved as any
    }
    return toLosslessJson({
      success: false,
      saved: false,
      error: 'empty response from Xiaocongcut save_draft',
      assetCheck: null,
      finalize: { ran: false, ok: false, error: 'empty response' },
    })
  }

  /** Dual-path wrapper → own-text-dual-export core (local MP4 + native texts). */
  const exportOwnTextDualPath = async (args: {
    layer_ids?: string[]
    target?: string
    accept_native_approx?: boolean
    width?: number
    height?: number
    duration?: number
    bg_color?: string
    project_name?: string
  } = {}, spaceId = activeSpaceId): Promise<OpResult> => {
    const operationConfig = configForSpace(spaceId)
    const result = await exportOwnTextDualPathCore({
      spaceId,
      xiaocongcutBaseUrl: operationConfig.xiaocongcutBaseUrl,
      fetch: xiaocongcutFetch as any,
      createDraft: async (a, sid) => createDraft(a, sid),
      saveDraft: async (a, sid) => saveDraft(a, sid),
      getLastDraftId: (sid) => String(configForSpace(sid).lastDraftId || ''),
      layer_ids: args.layer_ids,
      target: args.target,
      accept_native_approx: args.accept_native_approx,
      width: args.width,
      height: args.height,
      duration: args.duration,
      bg_color: args.bg_color,
      project_name: args.project_name,
    })
    // 花字成品同样进成片库，否则成片页看不到自己导出的视频
    const localOut = (result as any)?.local_mp4
    if (localOut?.success && localOut?.output_path) {
      try {
        const item = registerExport(spaceId, String(localOut.output_path), { title: args.project_name ? `花字成品_${args.project_name}` : '' })
        if (item && result && typeof result === 'object') (result as any).history_id = item.id
      } catch {
        /* 登记失败不影响导出 */
      }
    }
    return result as OpResult
  }

  const exportDraft = async (args: {
    draft_id?: string
    output_path?: string
    draft_folder?: string
    draft_dir?: string
    engine?: string
    confirm_downgrade_unsupported?: boolean
  } = {}, spaceId = activeSpaceId): Promise<OpResult> => {
    const operationConfig = configForSpace(spaceId)
    const draft_id = args.draft_id || operationConfig.lastDraftId
    const engine = String(args.engine || 'local_ffmpeg')
    const workspace = getWorkspace(spaceId, operationConfig).workspace as string
    const pluginRoot = PLUGIN_ROOT_DIR
    // Prefer explicit draft_dir; else lastDraftPath; never read Movies/Containers Projects here.
    let draftDir = args.draft_dir ? expandPath(String(args.draft_dir)) : ''
    if (!draftDir && operationConfig.lastDraftPath) draftDir = expandPath(String(operationConfig.lastDraftPath))
    const allowRoots = [
      workspace,
      pluginRoot,
      join(pluginRoot, 'artifacts'),
      operationConfig.lastProjectFolder || '',
      args.draft_folder ? expandPath(String(args.draft_folder)) : '',
      draftDir ? dirname(draftDir) : '',
    ].filter(Boolean)

    if (engine === 'local_ffmpeg' || engine === 'auto' || engine === 'local') {
      if (!draftDir) {
        return JSON.parse(JSON.stringify({
          success: false,
          error: 'local_ffmpeg 导出需要 draft_dir 或已保存的 lastDraftPath（先 dh_save_draft 到隔离目录）',
          engine: 'local_ffmpeg',
          hint: '公开 Xiaocongcut /export_draft_to_video 在本机9001为404；上游文档有该接口但本构建未实现。本地用 FFmpeg 渲染受控草稿。',
          public_refs: [
            'https://github.com/sun-guannan/XiaocongcutAPI/blob/main/xiaocongcut-skill/skill/references/api_reference.md',
            'https://github.com/sun-guannan/XiaocongcutAPI',
          ],
        }))
      }
      const outRoot = join(workspace || pluginRoot, 'exports')
      mkdirSync(outRoot, { recursive: true })
      const pre = precheckLocalExport(draftDir, [...allowRoots, outRoot, draftDir])
      if (pre.status === 'needs_confirmation' && !args.confirm_downgrade_unsupported) {
        return JSON.parse(JSON.stringify({
          success: false,
          needs_confirmation: true,
          engine: 'local_ffmpeg',
          precheck: pre,
          error: '草稿含无法保真的原生效果；确认降级后重试 confirm_downgrade_unsupported=true',
        }))
      }
      const job = await exportDraftLocalFfmpeg({
        draftDir,
        allowRoots: [...allowRoots, outRoot, draftDir],
        outputDir: outRoot,
        confirmDowngradeUnsupported: !!args.confirm_downgrade_unsupported,
      })
      const probe = job.output_path ? probeMedia(job.output_path) : null
      // 成品进成片库：导出成功就把 mp4 收进本空间 exports 并登记，成片页才看得到
      let exportItem: { id?: string } | null = null
      if (job.status === 'done' && job.output_path) {
        try {
          exportItem = registerExport(spaceId, job.output_path, draft_id ? { title: `剪映成品_${draft_id}` } : {})
        } catch {
          /* 登记失败不影响导出本身 */
        }
      }
      return JSON.parse(JSON.stringify({
        success: job.status === 'done',
        engine: 'local_ffmpeg',
        task_id: job.task_id,
        status: job.status,
        progress: job.progress,
        message: job.message,
        output_path: job.output_path || null,
        history_id: exportItem?.id || null,
        downgraded: job.downgraded || [],
        precheck: job.precheck || pre,
        probe,
        error: job.error || null,
        honesty: pre.honesty,
        draft_id: draft_id || null,
        xiaocongcut_cloud: false,
      }))
    }

    // Optional legacy Xiaocongcut path (usually 404 on this build)
    if (!draft_id) return { success: false, error: 'draft_id required for xiaocongcut engine' }
    const payload: Record<string, unknown> = { draft_id }
    if (args.output_path) payload.output_path = args.output_path
    if (args.draft_folder) payload.draft_folder = args.draft_folder
    const result = await vcFetch('/export_draft_to_video', payload, undefined, operationConfig.xiaocongcutBaseUrl)
    if (result.error) {
      return { success: false, error: `Xiaocongcut unreachable: ${result.error}`, start: startGuidance(operationConfig) }
    }
    if (result.status === 404) {
      return JSON.parse(JSON.stringify({
        success: false,
        error: '本机 Xiaocongcut 无 /export_draft_to_video（404）。请用 engine=local_ffmpeg。',
        export_available: false,
        draft_id,
        hint: 'local_ffmpeg 不经过剪映会员导出，也不走云端渲染。',
      }))
    }
    if (result.data && typeof result.data === 'object') {
      return { ...result.data, export_available: true, workspace: getWorkspace(spaceId, operationConfig).workspace }
    }
    return { success: false, error: `export failed (HTTP ${result.status})`, raw: result.data }
  }

  const exportStatus = async (args: { task_id?: string; draft_id?: string } = {}): Promise<OpResult> => {
    if (args.task_id) {
      const local = getLocalExportJob(String(args.task_id))
      if (local) {
        return JSON.parse(JSON.stringify({ success: true, ...local }))
      }
    }
    const q = new URLSearchParams()
    if (args.task_id) q.set('task_id', args.task_id)
    if (args.draft_id) q.set('draft_id', args.draft_id)
    const path = `/export_status${q.toString() ? `?${q}` : ''}`
    const result = await vcFetch(path, undefined, 'GET', config.xiaocongcutBaseUrl)
    if (result.status === 404) {
      return JSON.parse(JSON.stringify({
        success: false,
        error: '无 Xiaocongcut /export_status；本地任务请传 task_id 查询 local_ffmpeg 作业。',
        export_available: false,
        engine: 'local_ffmpeg',
      }))
      }
    if (result.error) {
      return { success: false, error: `Xiaocongcut unreachable: ${result.error}`, start: startGuidance(config) }
    }
    if (result.data && typeof result.data === 'object') {
      return { ...result.data, export_available: true }
    }
    return { success: false, error: `export_status failed (HTTP ${result.status})`, raw: result.data }
  }

  /** Accept same-origin browser requests; non-browser callers send no Origin. */
  const sameOrigin = (req: any): boolean => {
    if (!req.headers.origin) return true
    try {
      return new URL(req.headers.origin).host === req.headers.host
    } catch {
      return false
    }
  }
  const register = (path: string, handler: (req: any, res: any) => void | Promise<void>): (() => void) | undefined => {
    try {
      return ws.register({
        kind: 'exact',
        path,
        handler: (req, res) => {
          Promise.resolve(handler(req, res)).catch((e) => {
            console.error(`[digital-human-studio] ${path} error:`, e)
            if (!res.headersSent) sendJson(res, 500, { success: false, error: String(e?.message || e) })
          })
        },
      }) as unknown as (() => void) | undefined
    } catch {
      // The shell owns this path (e.g. /digital-human-studio/account/balance);
      // a duplicate registration must not abort the remaining routes.
      return undefined
    }
  }
  // 动态注册过的 matte 文件路由（name 不变时不用重复注册）
  const matteFileRegistered = new Set<string>()
  // 动态注册过的字体文件路由
  const fontFileRegistered = new Set<string>()

  const httpStatusFor = (body: OpResult): number => {
    if (body.success) return 200
    const err = String(body.error || '')
    if (err.includes('not found')) return 404
    if (err.includes('required') || err.includes('must be')) return 400
    if (err.includes('unreachable')) return 502
    return 200
  }

      // ── 轻剪辑：工程（= 配方文件）读写 / 版本 / 媒体流 ──
      const recipesDir = join(BUNDLED_XIAOCONGCUT_ROOT, 'recipes')
      const historyDir = join(recipesDir, '.history')

      // ── 工程素材引用：缺失检测 / 重连 / 另存为 ──

      // 递归收集工程里所有本地媒体绝对路径（clips.source / bgm.path / 其他音轨）
      const MEDIA_EXT_RE = /\.(mp4|mov|m4v|mp3|wav|m4a|aac|flac|aiff|png|jpg|jpeg|webp|gif)$/i
      const collectMediaRefs = (recipe: any): Array<{ from: string; exists: boolean }> => {
        const seen = new Set<string>()
        const list: Array<{ from: string; exists: boolean }> = []
        const walk = (node: any, depth: number) => {
          if (!node || depth > 8) return
          if (Array.isArray(node)) {
            node.forEach((x) => walk(x, depth + 1))
            return
          }
          if (typeof node !== 'object') return
          for (const v of Object.values(node)) {
            if (typeof v === 'string') {
              if (MEDIA_EXT_RE.test(v) && (v.startsWith('/') || v.startsWith('~')) && !seen.has(v)) {
                seen.add(v)
                const absolute = expandPath(v)
                list.push({ from: v, exists: !!absolute && existsSync(absolute) })
              }
            } else if (v && typeof v === 'object') {
              walk(v, depth + 1)
            }
          }
        }
        walk(recipe, 0)
        return list
      }

      const relinkSearchRoots = (): string[] => [
        join(homedir(), 'Downloads', '剪辑素材'),
        join(homedir(), 'Downloads'),
        join(homedir(), '.dsh', 'digital-human-assets'),
        join(BUNDLED_XIAOCONGCUT_ROOT, 'assets'),
        join(homedir(), 'Movies'),
      ]

      const scanByName = (dir: string, name: string, depth: number): string => {
        if (depth > 6) return ''
        let entries: any[] = []
        try {
          entries = readdirSync(dir, { withFileTypes: true }) as any
        } catch {
          return ''
        }
        for (const e of entries) {
          if (e.name === name && e.isFile()) return join(dir, e.name)
        }
        for (const e of entries) {
          if (!e.isDirectory()) continue
          if (e.name.startsWith('.') || e.name === 'node_modules') continue
          const hit = scanByName(join(dir, e.name), name, depth + 1)
          if (hit) return hit
        }
        return ''
      }

      const findSameName = (missPath: string): string => {
        const base = basename(missPath)
        for (const root of relinkSearchRoots()) {
          if (!existsSync(root)) continue
          const hit = scanByName(root, base, 0)
          if (hit) return hit
        }
        return ''
      }

      const applyMediaMap = (node: any, map: Map<string, string>, depth: number): any => {
        if (!node || depth > 8) return node
        if (typeof node === 'string') return map.get(node) || node
        if (Array.isArray(node)) return node.map((x) => applyMediaMap(x, map, depth + 1))
        if (typeof node !== 'object') return node
        const out: any = {}
        for (const [k, v] of Object.entries(node)) out[k] = applyMediaMap(v, map, depth + 1)
        return out
      }


      const templateDir = () => join(homedir(), '.dsh', 'digital-human-studio', 'templates')
      const templateSlug = (name: string) =>
        String(name || '').replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 48) || `tpl-${Date.now().toString(36)}`
      const projectIdOf = (file: string) => file.replace(/\.json$/, '')
      const safeProjectPath = (id: string) => {
        if (!id || /[\\/]/.test(id) || id.startsWith('.')) return null
        return join(recipesDir, `${id}.json`)
      }
      const snapshotProject = (id: string, content: string) => {
        try {
          const dir = join(historyDir, id)
          mkdirSync(dir, { recursive: true })
          const stamp = new Date()
          const name = [
            stamp.getFullYear(),
            String(stamp.getMonth() + 1).padStart(2, '0'),
            String(stamp.getDate()).padStart(2, '0'),
            '-',
            String(stamp.getHours()).padStart(2, '0'),
            String(stamp.getMinutes()).padStart(2, '0'),
            String(stamp.getSeconds()).padStart(2, '0'),
          ].join('')
          writeFileSync(join(dir, `${name}.json`), content, 'utf8')
          const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
          for (const old of files.slice(0, Math.max(0, files.length - 30))) {
            try {
              unlinkSync(join(dir, old))
            } catch {
              /* 清历史失败不影响保存 */
            }
          }
          return name
        } catch {
          return null
        }
      }


  ctx.effect(() => {
    const disposers = [
      register('/digital-human-studio/assets/xiaocong-only.png', async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { success: false, error: 'method not allowed' }); return
        }
        try {
          if (!existsSync(XIAOCONG_ONLY_PNG)) {
            sendJson(res, 404, { success: false, error: 'xiaocong-only.png missing' }); return
          }
          const buf = readFileSync(XIAOCONG_ONLY_PNG)
          if (req.method === 'HEAD') {
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length, 'cache-control': 'public, max-age=86400' })
            res.end(); return
          }
          sendBinary(res, 200, buf, 'image/png')
        } catch (e: any) {
          sendJson(res, 500, { success: false, error: e?.message || String(e) })
        }
      }),
      register('/digital-human-studio/auth/authorize', async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { success: false, error: 'method not allowed' }); return
        }
        let returnUrl = 'http://127.0.0.1:3080/'
        let loginUrl = 'https://xiaocongapi.azheteng.cn/login?redirect=' + encodeURIComponent('http://127.0.0.1:3080/digital-human-studio/auth/authorize?auto=1')
        try {
          const host = String(req.headers.host || '127.0.0.1:3080')
          const proto = host.startsWith('127.') || host.startsWith('localhost') ? 'http' : 'https'
          const origin = `${proto}://${host}`
          returnUrl = `${origin}/`
          const url = new URL(req.url || '/', returnUrl)
          const q = url.searchParams.get('return')
          if (q) {
            const parsed = new URL(q)
            if (['http:', 'https:'].includes(parsed.protocol)
              && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
              returnUrl = parsed.toString()
            }
          }
          const authorizeHere = new URL('/digital-human-studio/auth/authorize', origin)
          authorizeHere.searchParams.set('return', returnUrl)
          authorizeHere.searchParams.set('auto', '1')
          const login = new URL('/login', `${validateBase(config.newApiBaseUrl)}/`)
          login.searchParams.set('redirect', authorizeHere.toString())
          loginUrl = login.toString()
        } catch { /* keep defaults */ }
        sendHtml(res, 200, authorizePageHtml(returnUrl, loginUrl))
      }),
      register('/digital-human-studio/auth/authorized', async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { success: false, error: 'method not allowed' }); return
        }
        let returnUrl = 'http://127.0.0.1:3080/'
        try {
          const host = String(req.headers.host || '127.0.0.1:3080')
          const proto = host.startsWith('127.') || host.startsWith('localhost') ? 'http' : 'https'
          returnUrl = `${proto}://${host}/`
          const url = new URL(req.url || '/', returnUrl)
          const q = url.searchParams.get('return')
          if (q) {
            const parsed = new URL(q)
            if (['http:', 'https:'].includes(parsed.protocol)
              && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
              returnUrl = parsed.toString()
            }
          }
        } catch { /* keep default */ }
        sendHtml(res, 200, authorizedPageHtml(returnUrl))
      }),
      register('/api/user/auth/refresh', proxyNewApiAuthRefresh),
      register('/api/user/auth/logout', proxyNewApiAuthLogout),
      ...['status', 'login', 'logout', 'save', 'probe', 'claim'].map((action) =>
        register(`/digital-human-studio/auth/${action}`, async (req, res) => {
          const expected = action === 'status' ? 'GET' : 'POST'
          if (req.method !== expected) { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
          // Same-origin JSON requests only: prevent drive-by credential/config writes.
          if (req.headers.origin) {
            try {
              if (new URL(req.headers.origin).host !== req.headers.host) {
                sendJson(res, 403, { success: false, error: 'origin not allowed' }); return
              }
            } catch { sendJson(res, 403, { success: false }); return }
          }
          if (expected === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
            sendJson(res, 415, { success: false, error: 'application/json required' }); return
          }
          try {
            if (action === 'status') { sendJson(res, 200, authStatus()); return }
            if (action === 'probe') { sendJson(res, 200, await authProbe()); return }
            const body = await readJson(req)
            if (action === 'claim') { sendJson(res, 200, await authClaim(body)); return }
            if (action === 'login') { sendJson(res, 200, await authLogin(body)); return }
            if (action === 'logout') {
              config = { ...config, newApiToken: '', newApiEnabled: false, newApiUsername: '', newApiUserId: null, newApiModels: [] }
              saveConfig(config)
              await syncCredential()
              sendJson(res, 200, authStatus())
              return
            } else {
              const base = validateBase(body.baseUrl ?? config.newApiBaseUrl)
              if (body.token !== undefined && typeof body.token !== 'string') throw new Error('令牌必须是文本')
              if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new Error('enabled 必须为布尔值')
              const changedBase = base !== config.newApiBaseUrl
              // 界面承诺「令牌留空不更换」：空串/未传都视为不更换，只有真的换了地址才清空。
              const providedToken = body.token !== undefined ? normalizeToken(String(body.token)) : undefined
              const token = providedToken ? providedToken : changedBase ? '' : config.newApiToken
              config = { ...config, newApiBaseUrl: base, newApiToken: token,
                newApiEnabled: !!token && (body.enabled ?? true),
                newApiUsername: changedBase || body.token !== undefined ? '' : config.newApiUsername,
                newApiUserId: changedBase || body.token !== undefined ? null : config.newApiUserId }
            }
            saveConfig(config)
            await syncCredential()
            if (config.newApiToken) {
              sendJson(res, 200, await syncModelsFromToken())
            } else {
              sendJson(res, 200, authStatus())
            }
          } catch (e: any) {
            // Do not return upstream payloads (which can contain keys or account tokens).
            sendJson(res, 400, { success: false, error: e instanceof TypeError ? 'XiaocongAPI 请求失败，请检查服务地址' : e.message || '授权失败' })
          }
        })),
      register('/digital-human-studio/account/balance', async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { success: false, error: 'method not allowed' }); return
        }
        // Same-origin reads only: the balance belongs to the gateway account.
        if (req.headers.origin) {
          try {
            if (new URL(req.headers.origin).host !== req.headers.host) {
              sendJson(res, 403, { success: false, error: 'origin not allowed' }); return
            }
          } catch { sendJson(res, 403, { success: false }); return }
        }
        try {
          sendJson(res, 200, await readAccountBalance())
        } catch {
          sendJson(res, 200, { success: false, error: '读取 XiaocongAPI 余额失败，请检查服务地址与令牌' })
        }
      }),
      register('/digital-human-studio/digital-human/status', async (req, res) => {
        if (req.method !== 'GET') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        sendJson(res, 200, {
          success: true,
          baseUrl: config.newApiBaseUrl,
          hasToken: !!config.newApiToken,
          tokenPreview: config.newApiToken ? `sk-••••${config.newApiToken.length > 12 ? config.newApiToken.slice(-4) : ''}` : '',
          models: Array.from(new Set([...DIGITAL_HUMAN_MODELS, ...config.newApiModels.filter((model) => model.startsWith('xdh-'))])),
        })
      }),
      register('/digital-human-studio/image/models', async (req, res) => {
        if (req.method !== 'GET') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        try {
          const listed = await listImageModels()
          sendJson(res, 200, { success: true, ...listed })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '读取生图模型失败', models: [] })
        }
      }),
      register('/digital-human-studio/image/create', async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          sendJson(res, 415, { success: false, error: 'application/json required' }); return
        }
        try {
          sendJson(res, 200, await createImageJob(await readJson(req)))
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '创建生图任务失败' })
        }
      }),
      register('/digital-human-studio/image/task', async (req, res) => {
        if (req.method !== 'GET') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        try {
          const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
          const id = String(url.searchParams.get('id') || '').trim()
          if (!isImageTaskId(id)) throw new Error('id 不能为空')
          const current = getImageJob(id)
          if (!current) throw new Error('找不到这个生图任务')
          sendJson(res, 200, publicImageJob(await refreshImageJob(current)))
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '读取生图任务失败' })
        }
      }),
      register('/digital-human-studio/image/file', async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { success: false, error: 'method not allowed' }); return
        }
        try {
          const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
          const id = String(url.searchParams.get('id') || '').trim()
          const ext = String(url.searchParams.get('ext') || '').trim()
          const space = String(url.searchParams.get('space') || activeSpaceId).trim() || DEFAULT_SPACE_ID
          if (!isSpaceId(space)) throw new Error('非法空间')
          const file = readImageFile(id, ext, space)
          if (!file) { sendJson(res, 404, { success: false, error: '找不到这张图片' }); return }
          sendBinary(res, 200, readFileSync(file.path), file.contentType, 'private, max-age=86400')
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '读取图片失败' })
        }
      }),
      register('/digital-human-studio/digital-human/create', async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          sendJson(res, 415, { success: false, error: 'application/json required' }); return
        }
        try {
          const body = await readJson(req)
          const model = typeof body.model === 'string' ? body.model.trim() : ''
          if (!model.startsWith('xdh-')) throw new Error('model 必须是数字人模型（xdh-*）')
          const taskSpaceId = activeSpaceId
          const result = await digitalHumanRequest('POST', '/v1/tasks/xiaocong-digital-human', body, 120000)
          recordStudioTask(taskSpaceId, model, body, result, { source: 'studio' })
          sendJson(res, 200, result)
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '创建数字人任务失败' })
        }
      }),
      register('/digital-human-studio/digital-human/task', async (req, res) => {
        if (req.method !== 'GET') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        try {
          const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
          const id = String(url.searchParams.get('id') || '').trim()
          if (!id) throw new Error('id 不能为空')
          if (id.startsWith('exp-')) {
            const reqSpace = String(url.searchParams.get('space') || '').trim()
            const spaceIds = Array.from(new Set([reqSpace, activeSpaceId, ...spaceStore.spaces.map(s => s.id)].filter(Boolean)))
            let foundSpace = ''
            let foundItem: StudioHistoryItem | undefined
            for (const sid of spaceIds) {
              const hit = loadStudioHistory(sid).find(row => row.id === id)
              if (hit) { foundSpace = sid; foundItem = hit; break }
            }
            if (!foundItem) {
              sendJson(res, 404, { success: false, error: '找不到这条本地成片记录' })
              return
            }
            const mediaUrl = foundItem.mediaUrl || `/digital-human-studio/works/file?space=${encodeURIComponent(foundSpace)}&id=${encodeURIComponent(id)}`
            const thumbUrl = foundItem.coverUrl || `/digital-human-studio/works/thumb?space=${encodeURIComponent(foundSpace)}&id=${encodeURIComponent(id)}`
            sendJson(res, 200, {
              task_id: id,
              id,
              status: 'SUCCESS',
              progress: '100%',
              url: mediaUrl,
              data: { video_url: mediaUrl, cover_url: thumbUrl, title: foundItem.title },
            })
            return
          }
          const task = await digitalHumanRequest('GET', `/v1/tasks/${encodeURIComponent(id)}`, undefined, 30000)
          patchHistoryFromTask(task, id)
          sendJson(res, 200, task)
          void upsertCloneAssetFromTask(task).catch(() => { /* library save is best effort */ })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '读取数字人任务失败' })
        }
      }),
      register('/digital-human-studio/digital-human/artifacts', async (req, res) => {
        if (req.method !== 'GET') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        try {
          const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
          const id = String(url.searchParams.get('id') || '').trim()
          if (!id) throw new Error('id 不能为空')
          sendJson(res, 200, await digitalHumanRequest('GET', `/v1/tasks/${encodeURIComponent(id)}/artifacts`))
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '读取数字人产物失败' })
        }
      }),
      register('/digital-human-studio/digital-human/resources', async (req, res) => {
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        const method = String(req.method || 'GET').toUpperCase()
        if (method === 'GET') {
          const library = loadAssetLibrary()
          sendJson(res, 200, {
            success: true,
            avatars: library.avatars.map(publicAsset),
            voices: library.voices.map(publicAsset),
          })
          void (async () => {
            await backfillMissingCovers(library)
            await syncLibraryCoversFromGateway(digitalHumanRequest)
          })().catch(() => { /* cover sync is best effort */ })
          return
        }
        if (method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          sendJson(res, 415, { success: false, error: 'application/json required' }); return
        }
        try {
          const body = await readJson(req)
          const action = String(body.action || 'save')
          const type = body.type === 'voice' ? 'voice' : body.type === 'avatar' ? 'avatar' : ''
          const id = String(body.id || '').trim()
          if (!type || !id) throw new Error('type 和 id 不能为空')
          const library = loadAssetLibrary()
          const list = type === 'avatar' ? library.avatars : library.voices
          const index = list.findIndex(item => item.id === id)
          if (action === 'delete') {
            const wasDefault = index >= 0 && list[index]?.isDefault
            if (index >= 0) list.splice(index, 1)
            if (wasDefault && list[0]) list[0].isDefault = true
            saveAssetLibrary(library)
            try { rmSync(join(assetRoot(), ASSET_DIR[type], safeAssetName(id)), { recursive: true, force: true }) } catch { /* best effort */ }
            sendJson(res, 200, { success: true, avatars: library.avatars.map(publicAsset), voices: library.voices.map(publicAsset) })
            return
          }
          if (action === 'default') {
            markDefault(library, type, id)
            saveAssetLibrary(library)
            sendJson(res, 200, {
              success: true,
              avatars: library.avatars.map(publicAsset),
              voices: library.voices.map(publicAsset),
            })
            return
          }
          if (action !== 'save') throw new Error('未知操作')
          const now = new Date().toISOString()
          const previous = index >= 0 ? list[index] : undefined
          const name = String(body.name || '').trim() || previous?.name || `${type === 'avatar' ? '形象' : '音色'} ${id}`
          const modelCode = String(body.modelCode || body.model_code || '').trim() || previous?.modelCode || ''
          const coverUrl = String(body.coverUrl || body.cover_url || '').trim() || previous?.coverUrl || ''
          const sampleUrl = String(body.sampleUrl || body.sample_url || '').trim() || previous?.sampleUrl || ''
          const stored = await materializeAssetMedia(type, id, coverUrl, sampleUrl, previous)
          const asset: LocalAsset = {
            id, type, name, modelCode,
            coverUrl: stored.coverUrl, sampleUrl: stored.sampleUrl,
            localCover: stored.localCover, localSample: stored.localSample,
            width: previous?.width, height: previous?.height,
            isDefault: previous?.isDefault,
            createdAt: previous?.createdAt || now, updatedAt: now,
          }
          fillAssetSize(asset)
          if (index >= 0) list[index] = asset
          else list.unshift(asset)
          ensureDefault(list, asset)
          saveAssetLibrary(library)
          sendJson(res, 200, { success: true, asset: publicAsset(asset), avatars: library.avatars.map(publicAsset), voices: library.voices.map(publicAsset) })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '保存本地资源失败' })
        }
      }),
      register('/digital-human-studio/digital-human/defaults', async (req, res) => {
        if (req.method !== 'GET') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        const library = loadAssetLibrary()
        const avatar = pickDefaultAsset(library.avatars)
        const voice = pickDefaultAsset(library.voices)
        sendJson(res, 200, {
          success: true,
          avatar: avatar ? publicAsset(avatar) : null,
          voice: voice ? publicAsset(voice) : null,
        })
      }),
      register('/digital-human-studio/digital-human/speak', async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          sendJson(res, 415, { success: false, error: 'application/json required' }); return
        }
        try {
          const body = await readJson(req)
          sendJson(res, 200, { success: true, ...(await speakTalkingHead(String(body.text || ''), undefined)) })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '生成数字人失败' })
        }
      }),
      register('/digital-human-studio/digital-human/asset', async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        try {
          const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
          const type = url.searchParams.get('type') === 'voice' ? 'voice' : 'avatar'
          const relative = url.searchParams.get('file') || ''
          const space = String(url.searchParams.get('space') || activeSpaceId).trim() || DEFAULT_SPACE_ID
          if (!relative) throw new Error('file 不能为空')
          if (!isSpaceId(space)) throw new Error('非法空间')
          const expectedPrefix = `${ASSET_DIR[type]}/`
          if (!relative.startsWith(expectedPrefix) || relative.includes('..')) throw new Error('非法资源路径')
          const root = assetRoot(space)
          const absolute = resolve(root, relative)
          if (!absolute.startsWith(resolve(root) + '/')) throw new Error('非法资源路径')
          if (!existsSync(absolute)) { sendJson(res, 404, { success: false, error: '资源文件不存在' }); return }
          const ext = absolute.split('.').pop()?.toLowerCase() || ''
          const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif'
            : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav' : ext === 'm4a' ? 'audio/mp4'
            : ext === 'ogg' ? 'audio/ogg'
            : ext === 'mp4' || ext === 'm4v' ? 'video/mp4' : ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime'
            : 'application/octet-stream'
          const buf = readFileSync(absolute)
          if (req.method === 'HEAD') {
            res.writeHead(200, { 'content-type': mime, 'content-length': buf.length, 'cache-control': 'private, max-age=3600' })
            res.end(); return
          }
          sendBinary(res, 200, buf, mime, 'private, max-age=3600')
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '读取本地资源失败' })
        }
      }),
      register('/digital-human-studio/upload', async (req, res) => {
        if (req.method !== 'GET') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        const rawToken = await adoptShellNewApiToken()
        if (!rawToken) {
          sendJson(res, 200, { success: true, configured: false, error: '请先登录 XiaocongAPI' }); return
        }
        try {
          const response = await fetch(`${config.newApiBaseUrl}/v1/xiaocong/uploads/status`, {
            headers: { authorization: `Bearer ${normalizeToken(rawToken)}`, accept: 'application/json' },
          })
          const value = await response.json().catch(() => null) as any
          if (!response.ok || value?.success === false) throw new Error(value?.error || '读取上传配置失败')
          sendJson(res, 200, { success: true, configured: !!value?.data?.configured, host: value?.data?.host || '' })
        } catch (e: any) {
          sendJson(res, 200, { success: true, configured: false, error: e?.message || '读取上传配置失败' })
        }
      }),
      register('/digital-human-studio/upload/file', async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        const rawToken = await adoptShellNewApiToken()
        if (!rawToken) {
          sendJson(res, 401, { success: false, error: '请先登录 XiaocongAPI' }); return
        }
        try {
          const body = await readRawBody(req, 200 * 1024 * 1024)
          if (body.length === 0) throw new Error('文件为空')
          const headers: Record<string, string> = {
            authorization: `Bearer ${normalizeToken(rawToken)}`,
            accept: 'application/json',
            'content-type': String(req.headers['content-type'] || 'application/octet-stream'),
          }
          if (req.headers['x-file-name']) headers['x-file-name'] = String(req.headers['x-file-name'])
          const response = await fetch(`${config.newApiBaseUrl}/v1/xiaocong/uploads`, { method: 'POST', headers, body })
          const value = await response.json().catch(() => null) as any
          if (!response.ok || value?.success === false) throw new Error(value?.error || value?.message || '上传失败')
          sendJson(res, 200, { success: true, url: value?.data?.url, key: value?.data?.key, name: value?.data?.name, size: value?.data?.size })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '上传失败' })
        }
      }),
      register('/digital-human-studio/upload/local', async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        const rawToken = await adoptShellNewApiToken()
        if (!rawToken) { sendJson(res, 401, { success: false, error: '请先登录 XiaocongAPI' }); return }
        try {
          const body = await readJson(req)
          const filePath = expandPath(String((body as any)?.path || ''))
          if (!filePath || !existsSync(filePath)) throw new Error(`找不到本地文件：${filePath || '(空)'}`)
          const bytes = readFileSync(filePath)
          if (!bytes.length) throw new Error('文件为空')
          if (bytes.length > UPLOAD_MAX_BYTES) throw new Error('文件超过 200MB 上限')
          const ext = filePath.split('.').pop()?.toLowerCase() || ''
          const contentType = ext === 'png' ? 'image/png'
            : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'webp' ? 'image/webp'
            : ext === 'gif' ? 'image/gif'
            : ext === 'mp3' ? 'audio/mpeg'
            : ext === 'wav' ? 'audio/wav'
            : ext === 'm4a' ? 'audio/mp4'
            : ext === 'ogg' ? 'audio/ogg'
            : ext === 'mp4' || ext === 'm4v' ? 'video/mp4'
            : ext === 'mov' ? 'video/quicktime'
            : ext === 'webm' ? 'video/webm'
            : 'application/octet-stream'
          const response = await fetch(`${validateBase(config.newApiBaseUrl)}/v1/xiaocong/uploads`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${normalizeToken(rawToken)}`,
              accept: 'application/json',
              'content-type': contentType,
              'x-file-name': encodeURIComponent(basename(filePath)),
            },
            body: bytes,
            signal: AbortSignal.timeout(120_000),
          })
          const value = await response.json().catch(() => null) as any
          const url = String(value?.data?.url || value?.url || '').trim()
          if (!response.ok || value?.success === false || !/^https?:\/\//i.test(url)) {
            throw new Error(String(value?.error || value?.message || '上传失败'))
          }
          sendJson(res, 200, {
            success: true,
            url,
            key: value?.data?.key || '',
            name: value?.data?.name || basename(filePath),
            size: bytes.length,
            contentType,
          })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '上传本地文件失败' })
        }
      }),
      register('/digital-human-studio/voices', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'GET') {
          sendJson(res, 405, { success: false, error: 'method not allowed' }); return
        }
        try {
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          const spaceQuery = String(url.searchParams.get('space') || '').trim()
          const spaceId = isSpaceId(spaceQuery) ? spaceQuery : activeSpaceId
          const space = spaceStore.spaces.find(item => item.id === spaceId) || currentSpace(spaceStore)
          const lib = loadAssetLibrary()
          sendJson(res, 200, {
            success: true,
            spaceId,
            preferredVoiceId: space?.preferredVoiceId || '',
            choices: voiceChoiceMenu(),
            presets: MIXCUT_VOICES.map(item => ({
              id: item.id,
              name: item.name,
              voiceId: item.voiceId,
              instruction: item.instruction,
            })),
            cloned: lib.voices.map(publicAsset),
          })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '读取音色列表失败' })
        }
      }),
      register('/digital-human-studio/tts', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: 'method not allowed' }); return
        }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        try {
          const body = await readJson(req)
          const text = clipNarration(String((body as any)?.text || ''))
          if (!text) throw new Error('缺少配音文案 text')
          const spaceQuery = String((body as any)?.space || '').trim()
          const spaceId = isSpaceId(spaceQuery) ? spaceQuery : activeSpaceId
          const directVoiceId = String((body as any)?.voice_id || '').trim()
          const wantedVoice = String((body as any)?.voice || '').trim()
          const customInstruction = String((body as any)?.instruction || '').trim()
          const language = String((body as any)?.language || 'zh').trim() || 'zh'
          let voiceId = directVoiceId
          let voiceName = wantedVoice || directVoiceId
          let instruction = customInstruction
          let modelType: 1 | 2 = Number((body as any)?.model_type) === 1 ? 1 : 2
          let style = wantedVoice || directVoiceId
          if (!voiceId) {
            let resolved = resolveNarrationVoice(spaceId, wantedVoice)
            if ('needChoice' in resolved) {
              resolved = resolveNarrationVoice(spaceId, 'warm_boss')
            }
            if ('needClone' in resolved) {
              throw new Error('还没有克隆音色，请先克隆声音或指定预设音色（如 warm_boss / 热心老板）')
            }
            if ('needChoice' in resolved) {
              throw new Error(`未找到匹配音色，可选：${voiceChoiceMenu()}`)
            }
            voiceId = resolved.voiceId
            voiceName = resolved.name
            instruction = customInstruction || resolved.instruction
            modelType = resolved.modelType
            style = resolved.style
          } else if (!instruction) {
            instruction = '自然口播语气，清晰流畅，不要机械播音腔。'
          }
          const payload = await digitalHumanRequest('POST', '/v1/xiaocong/digital-human/tts', {
            text,
            voice_id: voiceId,
            instruction,
            model_type: modelType,
            language,
          }, 120_000)
          const audioUrl = String(payload?.data?.audio_url || payload?.audio_url || '').trim()
          if (!/^https?:\/\//i.test(audioUrl)) throw new Error('配音接口未返回音频地址')
          const clip = await downloadNarrationAudio(audioUrl, join(spaceAssetRoot(spaceId), 'narration'))
          sendJson(res, 200, {
            success: true,
            spaceId,
            path: clip.path,
            duration: clip.duration,
            audio_url: audioUrl,
            voice: voiceName,
            voiceId,
            style,
            instruction,
          })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '配音合成失败' })
        }
      }),
      register('/digital-human-studio/music', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'GET') {
          sendJson(res, 405, { success: false, error: 'method not allowed' }); return
        }
        try {
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          const spaceQuery = String(url.searchParams.get('space') || '').trim()
          const spaceId = isSpaceId(spaceQuery) ? spaceQuery : activeSpaceId
          const space = spaceStore.spaces.find(item => item.id === spaceId) || currentSpace(spaceStore)
          const engineBgm = await vcFetch('/xcy/bgm', undefined, 'GET').catch(() => ({ ok: false, data: null }))
          sendJson(res, 200, {
            success: true,
            spaceId,
            preferredMusic: space?.preferredMusic || '',
            choices: musicChoiceMenu(),
            presets: MIXCUT_MUSIC.map(item => ({
              id: item.id,
              name: item.name,
              volume: item.volume,
              ready: mixcutMusicReady(item),
              path: mixcutMusicReady(item) ? mixcutMusicFile(item) : '',
            })),
            engineBgm: engineBgm.ok ? engineBgm.data : null,
          })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '读取音乐列表失败' })
        }
      }),
      register('/digital-human-studio/spaces', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        if (method === 'GET') {
          let sessionId = ''
          let includeKnowledge = false
          try {
            const u = new URL(String(req.url || ''), 'http://127.0.0.1')
            sessionId = String(u.searchParams.get('sessionId') || '').trim()
            includeKnowledge = u.searchParams.get('includeKnowledge') === '1'
          } catch {
            sessionId = ''
          }
          const bound = sessionId ? spaceForSession(spaceStore, sessionId) : currentSpace(spaceStore)
          const pub = publicSpaces(spaceStore)
          const spaces = includeKnowledge
            ? pub.spaces.map((item) => {
                const raw = spaceStore.spaces.find((s) => s.id === item.id)
                return {
                  ...item,
                  preferredVoiceId: raw?.preferredVoiceId || '',
                  preferredMusic: raw?.preferredMusic || '',
                  knowledgeFiles: listKnowledge(item.id),
                  knowledgeSummary: recentKnowledgeText(item.id, 4, 4000),
                }
              })
            : pub.spaces
          sendJson(res, 200, {
            success: true,
            ...pub,
            spaces,
            currentId: bound.id,
            workspace: getWorkspace().workspace,
          })
          return
        }
        if (method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          sendJson(res, 415, { success: false, error: 'application/json required' }); return
        }
        try {
          const body = await readJson(req)
          const action = String(body.action || '').trim()
          const id = String(body.id || '').trim()
          if (action === 'portrait-restyle') {
            // 形象换装/换背景：拿人物照片当参考图，只改衣服和背景，脸保持不变
            // personImage 可以是用户自己上传的照片（data URL），不传就用形象封面
            const personImage = String(body.personImage || '').trim()
            const avatarList = loadAssetLibrary().avatars
            const wanted = String(body.avatarId || '').trim()
            const avatar = wanted ? avatarList.find((item) => item.id === wanted) : pickDefaultAsset(avatarList)
            if (!avatar && !personImage) { sendJson(res, 400, { success: false, error: '还没有数字人形象，先去克隆一个，或者上传一张人物照片' }); return }
            const clothing = String(body.clothing || '').trim()
            const scene = String(body.scene || '').trim()
            const extra = String(body.extra || '').trim()
            const mode = String(body.mode || '').trim()
            // 用户自带背景图/服装图：多张图一起进模型做真实融合，不是靠文字描述
            const backdropImage = String(body.backdropImage || '').trim()
            const outfitImage = String(body.outfitImage || '').trim()
            if (!clothing && !scene && !extra && !backdropImage && !outfitImage) { sendJson(res, 400, { success: false, error: '说一下要换什么：衣服、背景，或一句描述' }); return }
            // 参考图：用户上传的 > 本地封面 > 远程 coverUrl
            // localCover 有的存成 avatars/<id>/cover.jpg，有的只存文件名，两种都要认
            const avatarCoverFile = (() => {
              if (!avatar || !avatar.localCover) return ''
              const raw = String(avatar.localCover)
              const candidates = raw.startsWith('avatars/')
                ? [join(assetRoot(), raw), join(assetRoot(), 'avatars', avatar.id, raw.replace(/^avatars\//, ''))]
                : [join(assetRoot(), 'avatars', avatar.id, raw), join(assetRoot(), raw)]
              return candidates.find((file) => existsSync(file)) || ''
            })()
            let coverData = ''
            if (!personImage && avatarCoverFile) {
              try {
                const mime = /\.png$/i.test(avatarCoverFile) ? 'image/png' : 'image/jpeg'
                coverData = `data:${mime};base64,${readFileSync(avatarCoverFile).toString('base64')}`
              } catch { /* 读不到就走远程图 */ }
            }
            // 远程 coverUrl 是站内相对路由，上传七牛要用能读到的本地文件
            const coverUploadSource = avatarCoverFile || ''
            const imageRef = personImage || coverData || avatar?.coverUrl || ''
            if (!imageRef) { sendJson(res, 400, { success: false, error: '这个形象没有封面图，先在形象里补一张' }); return }
            const ratio = String(body.ratio || '3:4')
            const count = Math.min(4, Math.max(1, Number(body.count || 1)))
            // 服装图：后台服装套装库里选的那套衣服，跟人物一起进模型
            if (backdropImage || outfitImage) {
              // 多图融合：人物图 +（服装图）+（场景图）都先变成公网地址，再让模型合成
              try {
                const personSource = personImage || coverData || coverUploadSource || avatar?.coverUrl || ''
                if (!personSource) throw new Error('这张形象没有可用封面，先上传一张人物照片')
                const localPort = (req.socket && (req.socket as any).localPort) || 3080
                const selfBase = `http://127.0.0.1:${localPort}`
                const [personUrl, outfitUrl, backdropUrl] = await Promise.all([
                  uploadImageForFusion(personSource, 'restyle-person.jpg', selfBase),
                  outfitImage ? uploadImageForFusion(outfitImage, 'restyle-outfit.jpg', selfBase) : Promise.resolve(''),
                  backdropImage ? uploadImageForFusion(backdropImage, 'restyle-backdrop.jpg', selfBase) : Promise.resolve(''),
                ])
                const urls = [personUrl, outfitUrl, backdropUrl].filter(Boolean)
                const outfitAt = outfitUrl ? urls.indexOf(outfitUrl) + 1 : 0
                const backdropAt = backdropUrl ? urls.indexOf(backdropUrl) + 1 : 0
                const fusePrompt = [
                  '第1张是人物照片。',
                  '人物的五官、脸型、发型、发际线、年龄、性别、肤色、体型必须保持不变，不要换人、不要美颜、不要磨皮、不要变年轻。',
                  outfitAt ? `第${outfitAt}张是一套衣服，把人物身上的衣服换成这一套，版型、颜色、材质、领口、长短跟图上保持一致。` : '',
                  backdropAt ? `第${backdropAt}张是场景，把人物自然地放进这个场景里，人物的光线、阴影、透视跟场景一致。` : '',
                  !outfitAt && clothing ? `衣服换成${clothing}。` : '',
                  !backdropAt && scene ? `背景换成${scene}。` : '',
                  extra ? `${extra}。` : '',
                  '像真实拍摄的照片，不要文字、不要水印、不要多人。',
                ].filter(Boolean).join('')
                const payload = await imageGatewayRequest('POST', '/v1/images/generations', {
                  model: 'gpt-image-2',
                  prompt: fusePrompt,
                  n: count,
                  size: ratioToImageSize(ratio, 'gpt-image-2'),
                  response_format: 'url',
                  image: urls.length === 1 ? urls[0] : urls,
                }, 300000)
                const rows = Array.isArray(payload?.data) ? payload.data : []
                const fused = rows.map((item: any) => {
                  if (item?.url) return String(item.url)
                  if (item?.b64_json) return `data:image/png;base64,${String(item.b64_json)}`
                  return ''
                }).filter(Boolean)
                if (!fused.length) { sendJson(res, 502, { success: false, error: '模型没返回图片，换个场景图再试' }); return }
                sendJson(res, 200, { success: true, images: fused, prompt: fusePrompt, avatarId: avatar && avatar.id, avatarName: avatar && avatar.name })
              } catch (e: any) {
                sendJson(res, 502, { success: false, error: e?.message || '融合失败' })
              }
              return
            }
            const prompt = [
              '第一张图就是同一个人，这是给同一个人改照片，不是重新画一个新人。',
              '人物必须完全一致：五官、脸型、眼距、鼻子、嘴型、眉形、发型、发际线、年龄、性别、肤色、体型都不能变，不要美颜、不要磨皮、不要变年轻、不要换成别人。',
              mode === 'clothing' && clothing ? `只把衣服换成${clothing}，背景保持原样。` : (clothing ? `只把衣服换成${clothing}。` : ''),
              mode === 'background' && scene ? `只把背景换成${scene}，衣服保持原样。` : (scene ? `只把背景换成${scene}。` : ''),
              extra ? `${extra}。` : '',
              '照片级真实，自然光，不要文字、不要水印、不要多人。',
            ].filter(Boolean).join('')
            try {
              const payload = await imageGatewayRequest('POST', '/v1/images/generations', {
                model: 'gpt-image-2',
                prompt,
                n: count,
                size: ratioToImageSize(ratio, 'gpt-image-2'),
                response_format: 'url',
                image: imageRef,
              }, 300000)
              const rows = Array.isArray(payload?.data) ? payload.data : []
              const images = rows.map((item: any) => {
                if (item?.url) return String(item.url)
                if (item?.b64_json) return `data:image/png;base64,${String(item.b64_json)}`
                return ''
              }).filter(Boolean)
              if (!images.length) { sendJson(res, 502, { success: false, error: '模型没返回图片，换个说法再试' }); return }
              sendJson(res, 200, { success: true, images, prompt, avatarId: avatar && avatar.id, avatarName: avatar && avatar.name })
            } catch (e: any) {
              sendJson(res, 502, { success: false, error: e?.message || '换装失败' })
            }
            return
          }
          if (action === 'brief-chat') {
            // 对话式档案助手：老板说一句，模型回人话 + 要改的字段；本轮资料也进知识库
            const targetId = id || activeSpaceId
            const space = spaceStore.spaces.find((item) => item.id === targetId) || currentSpace(spaceStore)
            const message = String(body.message || '').trim()
            const notes = String(body.notes || '').trim()
            const files = Array.isArray(body.files) ? body.files : []
            const historyRaw = Array.isArray(body.history) ? body.history : []
            const history = historyRaw
              .map((item: unknown) => {
                const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
                const role = row.role === 'assistant' ? 'assistant' as const : 'user' as const
                return { role, text: String(row.text || '').trim().slice(0, 500) }
              })
              .filter((item: { role: 'user' | 'assistant'; text: string }) => item.text)
              .slice(-8)
            const saved: string[] = []
            const parts: string[] = []
            if (notes) {
              saved.push(saveKnowledge(space.id, '贴进来的资料.txt', notes))
              parts.push(notes)
            }
            for (const raw of files) {
              const file = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
              const text = String(file.text || '').trim()
              if (!text) continue
              const name = String(file.name || '资料.txt')
              saved.push(saveKnowledge(space.id, name, text))
              parts.push(`【${name}】\n${text}`)
            }
            const newBlob = parts.join('\n\n').trim()
            if (!message && !newBlob) { sendJson(res, 400, { success: false, error: '说点什么，或贴点资料' }); return }
            if (newBlob.length > 30000) { sendJson(res, 413, { success: false, error: '资料太多了，一次别超过 3 万字' }); return }
            if (!defaultModelInfo(ctx)) { sendJson(res, 409, { success: false, error: '当前没有可用模型，先在设置里选一个默认模型' }); return }
            try {
              // 知识库：把本轮资料放最前面，再接旧的
              const knowledge = [newBlob, recentKnowledgeText(space.id)].filter(Boolean).join('\n\n')
              const prompts = briefChatPrompts({
                spaceName: space.name,
                brief: space.brief,
                knowledge,
                history,
                message: message || '（刚贴了资料，帮我整理进档案）',
              })
              let parsed: { reply: string; updates: Record<string, string>; missing: string } = { reply: '', updates: {}, missing: '' }
              for (let attempt = 0; attempt < 2 && !parsed.reply && !Object.keys(parsed.updates).length; attempt += 1) {
                const { text } = await callModel(ctx, { ...prompts, maxTokens: 2200 })
                const got = normalizeBriefChat(extractJson(text))
                parsed = { reply: got.reply, updates: got.updates as Record<string, string>, missing: got.missing }
                if (!parsed.reply && !Object.keys(parsed.updates).length) console.warn('[digital-human-studio] brief chat json miss:', text.slice(0, 300))
              }
              if (!parsed.reply) parsed.reply = '我没太明白，换个说法试试？'
              sendJson(res, 200, {
                success: true,
                reply: parsed.reply,
                updates: parsed.updates,
                missing: parsed.missing,
                files: saved.map((path) => path.split('/').pop()),
                knowledgeCount: listKnowledge(space.id).length,
              })
            } catch (e: any) {
              sendJson(res, 502, { success: false, error: e?.message || 'AI 回复失败' })
            }
            return
          }
          if (action === 'brief-ai') {
            // 客户把资料丢进来 → 落进知识库 → 模型归纳成档案草稿，不直接覆盖档案
            const targetId = id || activeSpaceId
            const space = spaceStore.spaces.find((item) => item.id === targetId) || currentSpace(spaceStore)
            const notes = String(body.notes || '').trim()
            const files = Array.isArray(body.files) ? body.files : []
            const saved: string[] = []
            const parts: string[] = []
            if (notes) {
              saved.push(saveKnowledge(space.id, '贴进来的资料.txt', notes))
              parts.push(notes)
            }
            for (const raw of files) {
              const file = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
              const text = String(file.text || '').trim()
              if (!text) continue
              const name = String(file.name || '资料.txt')
              saved.push(saveKnowledge(space.id, name, text))
              parts.push(`【${name}】\n${text}`)
            }
            const blob = parts.join('\n\n').trim()
            if (!blob) { sendJson(res, 400, { success: false, error: '先贴点资料再让 AI 整理' }); return }
            if (blob.length > 30000) { sendJson(res, 413, { success: false, error: '资料太多了，一次别超过 3 万字' }); return }
            if (!defaultModelInfo(ctx)) { sendJson(res, 409, { success: false, error: '当前没有可用模型，先在设置里选一个默认模型' }); return }
            try {
              const prompts = briefDraftPrompts({ spaceName: space.name, brief: space.brief, blob })
              let draft: Record<string, string> = {}
              let missing = ''
              for (let attempt = 0; attempt < 2 && !Object.keys(draft).length; attempt += 1) {
                const { text } = await callModel(ctx, { ...prompts, maxTokens: 2000 })
                const parsed = normalizeBriefDraft(extractJson(text))
                draft = parsed.draft as Record<string, string>
                missing = parsed.missing
                if (!Object.keys(draft).length) console.warn('[digital-human-studio] brief draft json miss:', text.slice(0, 300))
              }
              if (!Object.keys(draft).length) { sendJson(res, 502, { success: false, error: '模型没整理出东西，换个说法再试一次' }); return }
              sendJson(res, 200, {
                success: true,
                draft,
                missing,
                files: saved.map((path) => path.split('/').pop()),
                knowledgeCount: listKnowledge(space.id).length,
              })
            } catch (e: any) {
              sendJson(res, 502, { success: false, error: e?.message || 'AI 整理失败' })
            }
            return
          }
          if (action === 'create') {
            persistSpaceWorkspace()
            const created = createSpace(spaceStore, String(body.name || ''), {
              lastProjectFolder: body.lastProjectFolder != null
                ? expandPath(String(body.lastProjectFolder))
                : config.lastProjectFolder,
              lastDraftId: '',
              lastDraftPath: '',
            })
            ensureSpaceDisk(created.space.id)
            applySpaceStore(created.store)
            sendJson(res, 200, { success: true, space: created.space, ...publicSpaces(spaceStore), workspace: getWorkspace().workspace })
            return
          }
          if (action === 'select') {
            persistSpaceWorkspace()
            applySpaceStore(selectSpace(spaceStore, id, String(body.sessionId || '').trim() || undefined))
            sendJson(res, 200, {
              success: true,
              ...publicSpaces(spaceStore),
              currentId: spaceForSession(spaceStore, String(body.sessionId || '').trim() || undefined).id,
              workspace: getWorkspace().workspace,
            })
            return
          }
          if (action === 'rename') {
            applySpaceStore(patchSpace(spaceStore, id, { name: String(body.name || '') }))
            sendJson(res, 200, { success: true, ...publicSpaces(spaceStore), workspace: getWorkspace().workspace })
            return
          }
          if (action === 'folder') {
            const folder = body.lastProjectFolder != null ? expandPath(String(body.lastProjectFolder)) : ''
            if (id && id !== activeSpaceId) {
              applySpaceStore(patchSpace(spaceStore, id, { lastProjectFolder: folder }))
            } else {
              saveWorkspaceConfig({ ...config, lastProjectFolder: folder })
            }
            sendJson(res, 200, { success: true, ...publicSpaces(spaceStore), workspace: getWorkspace().workspace })
            return
          }
          if (action === 'brief') {
            const targetId = id || activeSpaceId
            const brief = body.brief != null ? body.brief : {
              identity: body.identity,
              business: body.business,
              audience: body.audience,
              tone: body.tone,
              avoid: body.avoid,
              sample: body.sample,
              brand: body.brand,
              pains: body.pains,
              proof: body.proof,
              cta: body.cta,
              voice: body.voice,
              keywords: body.keywords,
              videoFormat: body.videoFormat,
              editStyle: body.editStyle,
              visualStyle: body.visualStyle,
              audioStyle: body.audioStyle,
              outroTemplate: body.outroTemplate,
            }
            applySpaceStore(patchSpace(spaceStore, targetId, { brief }))
            sendJson(res, 200, { success: true, ...publicSpaces(spaceStore), workspace: getWorkspace().workspace, brief: currentSpace(spaceStore).brief })
            return
          }
          if (action === 'delete') {
            persistSpaceWorkspace()
            const next = deleteSpace(spaceStore, id)
            removeSpaceDisk(id)
            applySpaceStore(next)
            sendJson(res, 200, { success: true, ...publicSpaces(spaceStore), workspace: getWorkspace().workspace })
            return
          }
          throw new Error('未知操作')
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '公司空间操作失败' })
        }
      }),

      register('/digital-human-studio/history', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        if (method !== 'GET' && method !== 'POST') {
          sendJson(res, 405, { success: false, error: 'method not allowed' })
          return
        }
        if (method === 'POST' && !sameOrigin(req)) {
          sendJson(res, 403, { success: false, error: 'origin not allowed' })
          return
        }
        let sessionId = ''
        let spaceQuery = ''
        let all = false
        try {
          const url = new URL(String(req.url || '/'), `http://${req.headers.host || '127.0.0.1'}`)
          sessionId = String(url.searchParams.get('sessionId') || '').trim()
          spaceQuery = String(url.searchParams.get('space') || '').trim()
          all = url.searchParams.get('all') === '1'
        } catch {
          /* ignore */
        }
        const spaceId = isSpaceId(spaceQuery)
          ? spaceQuery
          : (sessionId ? spaceForSession(spaceStore, sessionId).id : activeSpaceId)
        if (method === 'GET') {
          if (all) {
            sendJson(res, 200, {
              success: true,
              spaces: spaceStore.spaces.map(space => ({ spaceId: space.id, items: loadStudioHistory(space.id) })),
            })
            return
          }
          sendJson(res, 200, { success: true, spaceId, items: loadStudioHistory(spaceId) })
          return
        }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          sendJson(res, 415, { success: false, error: 'application/json required' })
          return
        }
        try {
          const body = await readJson(req)
          const action = String(body.action || 'upsert').trim()
          const target = isSpaceId(String(body.space || '')) ? String(body.space) : spaceId
          if (action !== 'remove' && action !== 'clear' && action !== 'upsert') {
            sendJson(res, 400, { success: false, error: `不认识的 history 动作：${action}` })
            return
          }
          if (action === 'remove') {
            const id = String(body.id || '').trim()
            if (!id) throw new Error('缺少成片 id')
            const items = loadStudioHistory(target)
            const item = items.find(row => row.id === id)
            if (!item) {
              sendJson(res, 404, { success: false, error: '这条件片不存在或已经删掉了' })
              return
            }
            const running = ['IN_PROGRESS', 'PROCESSING', 'RUNNING', 'PENDING', 'QUEUED', 'WORKING', 'WAITING'].includes(String(item.status || '').toUpperCase())
            if (running) {
              sendJson(res, 409, { success: false, error: '这条还在生成/导出中，等它完成再删' })
              return
            }
            const plans = loadPublishCalendar(target).filter(plan => plan.historyId === id)
            const cascade = body.cascade === true || body.cascade === 'true'
            const planLabel = (at: string) => {
              const value = String(at || '')
              const month = Number(value.slice(5, 7))
              const day = Number(value.slice(8, 10))
              const time = value.slice(11, 16)
              return month && day ? `${month}月${day}日 ${time}` : value
            }
            // 只有「还没到点、确实要发」的排期才算真风险，需要用户再确认一次；
            // 已发过的、以及时间已经过去的排期，直接跟着成片一起删，不让用户白跑一趟日历。
            const now = Date.now()
            const blocking = plans.filter(plan => plan.status === 'pending' && (Date.parse(plan.scheduledAt) || 0) > now)
            if (blocking.length && !cascade) {
              sendJson(res, 409, {
                success: false,
                error: `这条成片还有 ${blocking.length} 条没到点的排期（${blocking.slice(0, 2).map(plan => planLabel(plan.scheduledAt)).join('、')}），删成片会一起删掉这些排期`,
                plans: blocking.map(plan => ({ id: plan.id, scheduledAt: plan.scheduledAt, label: planLabel(plan.scheduledAt), status: plan.status })),
                canCascade: true,
              })
              return
            }
            for (const plan of plans) deletePublishPlan(target, plan.id)
            const { items: rest } = removeStudioHistory(target, id)
            let removedFiles = 0
            if (item.kind === 'xdh-export-video') {
              removedFiles = deleteExportArtifacts(target, id, item.localFile)
            } else if (item.kind === 'ximg' || item.kind === 'xdh-image') {
              const image = readImageFile(id, '', target)
              if (image) {
                try {
                  unlinkSync(image.path)
                  removedFiles = 1
                } catch {
                  /* 图片文件可能已被别处引用，删记录即可 */
                }
              }
            }
            sendJson(res, 200, { success: true, spaceId: target, items: rest, removedFiles })
            return
          }
          if (action === 'clear') {
            saveStudioHistory(target, [])
            sendJson(res, 200, { success: true, spaceId: target, items: [] })
            return
          }
          const raw = body.item && typeof body.item === 'object' ? body.item : body
          const items = upsertStudioHistory(target, {
            id: String(raw.id || ''),
            kind: String(raw.kind || 'xdh-avatar-video'),
            title: String(raw.title || ''),
            at: Number(raw.at) || Date.now(),
            status: raw.status != null ? String(raw.status) : undefined,
            progress: raw.progress != null ? String(raw.progress) : undefined,
            prompt: raw.prompt != null ? String(raw.prompt) : undefined,
            modelCode: raw.modelCode != null ? String(raw.modelCode) : undefined,
            coverUrl: raw.coverUrl != null ? String(raw.coverUrl) : undefined,
            mediaUrl: raw.mediaUrl != null ? String(raw.mediaUrl) : undefined,
            source: String(raw.source || 'chat'),
          })
          sendJson(res, 200, { success: true, spaceId: target, items })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '写入记录失败' })
        }
      }),

      register('/digital-human-studio/publication-geo-connection',async(req,res)=>{
        // Compatibility path renamed in behavior: independent publish-studio auth only; original GEO /postVideo bridge stays disabled.
        res.setHeader?.('cache-control','no-store')
        const connection=ctx.get('connection') as {requestRejection?:(req:{headers:unknown})=>number|undefined}|undefined
        if(!connection?.requestRejection){sendJson(res,403,{success:false,error:'未授权'});return}
        const denied=connection.requestRejection({headers:req.headers});if(denied || !sameOrigin(req)){sendJson(res,denied || 403,{success:false,error:'未授权或来源无效'});return}
        if(String(req.method || 'GET').toUpperCase()!=='POST'){sendJson(res,405,{success:false,error:'POST required'});return}
        if(!String(req.headers['content-type'] || '').startsWith('application/json')){sendJson(res,415,{success:false,error:'application/json required'});return}
        try{
          const body=await readJson(req),space=requireCalendarSpace(spaceStore,body.space),{space:ignored,action:rawAction,...rest}=body
          const map:Record<string,string>={status:'studio.auth.settings.get',connect:'studio.auth.settings.get',login:'studio.auth.login',activate:'studio.auth.activate',renew:'studio.auth.settings.get',logout:'studio.auth.logout',baseline:'studio.auth.baseline','settings.save':'studio.auth.settings.save'}
          const action=map[String(rawAction||'status')] || 'studio.auth.settings.get'
          const result=await publicationAction(space,'ui',{action,...rest})
          sendJson(res,result.success===false?409:200,result)
        }catch(error:any){sendJson(res,400,{success:false,error:error?.message || '独立发布授权未完成；不会回退原GEO，不会输出登录资料'})}
      }),
      register('/digital-human-studio/publication-confirmation', async (req,res)=>{
        res.setHeader?.('cache-control','no-store')
        const connection=ctx.get('connection') as {requestRejection?:(req:{headers:unknown})=>number|undefined}|undefined
        if(!connection?.requestRejection){sendJson(res,403,{success:false,error:'未授权'});return}
        const denied=connection.requestRejection({headers:req.headers})
        if(denied || !sameOrigin(req)){sendJson(res,denied || 403,{success:false,error:'未授权或来源无效'});return}
        if(String(req.method || 'GET').toUpperCase()!=='POST'){sendJson(res,405,{success:false,error:'POST required'});return}
        if(!String(req.headers['content-type'] || '').startsWith('application/json')){sendJson(res,415,{success:false,error:'application/json required'});return}
        try{
          const body=await readJson(req),space=requireCalendarSpace(spaceStore,body.space),{space:ignored,...input}=body
          // Only a salted digest is retained; never log, return or persist host cookies/tokens.
          const session=createHmac('sha256',publicationSessionSalt).update(String(req.headers.authorization || '')+'\0'+String(req.headers.cookie || '')).digest('hex')
          const result=await publicationHumanAction(space,input,session)
          sendJson(res,result.success===false?409:200,result)
        }catch(error:any){sendJson(res,400,{success:false,error:error?.message || '用户确认失败；未批准新发布'})}
      }),
      register('/digital-human-studio/publication-task-media',async(req,res)=>{
        res.setHeader?.('cache-control','no-store')
        const connection=ctx.get('connection') as {requestRejection?:(req:{headers:unknown})=>number|undefined}|undefined
        if(!connection?.requestRejection){sendJson(res,403,{success:false,error:'未授权'});return}
        const denied=connection.requestRejection({headers:req.headers});if(denied || !sameOrigin(req)){sendJson(res,denied || 403,{success:false,error:'未授权或来源无效'});return}
        if(String(req.method || 'GET').toUpperCase()!=='GET'){sendJson(res,405,{success:false,error:'GET required'});return}
        try{const url=new URL(String(req.url), 'http://127.0.0.1'),space=requireCalendarSpace(spaceStore,url.searchParams.get('space')),file=await publicationTaskMedia(space,String(url.searchParams.get('id') || ''),String(url.searchParams.get('kind') || ''))
          const {createReadStream}=await import('node:fs');res.writeHead(200,{'content-type':file.mime,'cache-control':'no-store','x-content-type-options':'nosniff'});const stream=createReadStream(file.path!);stream.on('error',()=>res.destroy());stream.pipe(res)
        }catch{sendJson(res,400,{success:false,error:'本公司任务媒体不可用或已变化，未提供预览'})}
      }),

      register('/digital-human-studio/publication-management', async (req, res) => {
        res.setHeader?.('cache-control','no-store')
        if(denyUnlessTrustedStudio(req, res)) return
        try{
          const method=String(req.method || 'GET').toUpperCase(),url=new URL(String(req.url || '/'),'http://127.0.0.1')
          if(method!=='GET' && method!=='POST'){sendJson(res,405,{success:false,error:'method not allowed'});return}
          let space:string,input:Record<string,unknown>
          if(method==='GET'){
            space=requireCalendarSpace(spaceStore,url.searchParams.get('space'))
            const action=url.searchParams.get('action') || 'overview'
            if(!['overview','tasks.list','tasks.get','pack.list','pack.get','calendar.list'].includes(action))throw new Error('GET仅可查询')
            input={action,id:url.searchParams.get('id')}
          }else{
            if(!String(req.headers['content-type'] || '').startsWith('application/json')){sendJson(res,415,{success:false,error:'application/json required'});return}
            const body=await readJson(req);space=requireCalendarSpace(spaceStore,body.space)
            const {space:ignored,...rest}=body;input=rest
          }
          const result=await publicationAction(space,'ui',input)
          sendJson(res,result.success===false?409:200,result)
        }catch(error:any){sendJson(res,400,{success:false,error:error?.message || '发布管理操作失败'})}
      }),

      register('/digital-human-studio/publish-packs', async (req, res) => {
        res.setHeader?.('cache-control', 'no-store')
        if (denyUnlessTrustedStudio(req, res)) return
        try {
          const url=new URL(String(req.url || '/'),'http://127.0.0.1')
          const method=String(req.method || 'GET').toUpperCase()
          if (method!=='GET' && method!=='POST') {sendJson(res,405,{success:false,error:'method not allowed'});return}
          if (method==='GET') {
            const space=requireCalendarSpace(spaceStore,url.searchParams.get('space'))
            if (url.searchParams.has('download')) {
              const file=packDownload(space,url.searchParams.get('id'),String(url.searchParams.get('download')))
              res.setHeader('content-disposition',`attachment; filename="${file.name}"`)
              if ('bytes' in file) sendBinary(res,200,file.bytes!,file.mime,'no-store')
              else {
                const { createReadStream } = await import('node:fs')
                res.writeHead(200,{'content-type':file.mime,'cache-control':'no-store'})
                const stream=createReadStream(file.path!);stream.on('error',()=>res.destroy());stream.pipe(res)
              }
              return
            }
            sendJson(res,200,{success:true,spaceId:space,items:loadPacks(space).map(p=>packView(space,p)),...packOptions(space)});return
          }
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) {sendJson(res,415,{success:false,error:'application/json required'});return}
          const body=await readJson(req), space=requireCalendarSpace(spaceStore,body.space)
          if (!['save','check','delete'].includes(body.action)) throw new Error('未知发布包操作')
          await publicationAction(space,'ui',{action:`pack.${body.action}`,id:body.id,revision:body.revision,item:body.item || {}})
          sendJson(res,200,{success:true,spaceId:space,items:loadPacks(space).map(p=>packView(space,p)),...packOptions(space)})
        } catch (error:any) {sendJson(res,400,{success:false,error:error?.message || '发布包操作失败'})}
      }),

      register('/digital-human-studio/publish-calendar', async (req, res) => {
        res.setHeader?.('cache-control', 'no-store')
        if (denyUnlessTrustedStudio(req, res)) return
        const method = String(req.method || 'GET').toUpperCase()
        if (method !== 'GET' && method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        try {
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          if (method === 'GET') {
            const spaceId = requireCalendarSpace(spaceStore, url.searchParams.get('space'))
            sendJson(res, 200, { success: true, spaceId, items: loadPublishCalendar(spaceId), works: calendarWorks(spaceId), timeZone: 'Asia/Shanghai' })
            return
          }
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) { sendJson(res, 415, { success: false, error: 'application/json required' }); return }
          const body = await readJson(req)
          const spaceId = requireCalendarSpace(spaceStore, body.space)
          if (body.action === 'upsert') upsertPublishPlan(spaceId, body.item || {})
          else if (body.action === 'delete') {
            if (!deletePublishPlan(spaceId, body.id)) { sendJson(res, 404, { success: false, error: '找不到这家公司的排期' }); return }
          } else throw new Error('未知日历操作')
          sendJson(res, 200, { success: true, spaceId, items: loadPublishCalendar(spaceId), works: calendarWorks(spaceId), timeZone: 'Asia/Shanghai' })
        } catch (error: any) { sendJson(res, 400, { success: false, error: error?.message || '日历操作失败' }) }
      }),

      // 现在发：列出可发账号 / 勾选后立即发送（复用自动发的安全链路）
      register('/digital-human-studio/publish-now', async (req, res) => {
        res.setHeader?.('cache-control', 'no-store')
        if (denyUnlessTrustedStudio(req, res)) return
        if (String(req.method || 'GET').toUpperCase() !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) { sendJson(res, 415, { success: false, error: 'application/json required' }); return }
        try {
          const body = await readJson(req)
          const spaceId = requireCalendarSpace(spaceStore, body.space)
          if (body.action === 'accounts') {
            const listed = await publicationAction(spaceId, 'ui', { action: 'studio.accounts.list' })
            const items = ((listed && (listed as any).items) || []).map((b: any) => ({
              id: b.id, platform: b.platform, name: b.name || b.label || b.accountLabel || '',
              enabled: b.enabled !== false, status: b.status || '',
              hasCredentialFile: b.hasCredentialFile !== false,
            }))
            sendJson(res, 200, { success: true, spaceId, items, enabled: autoPublishEnabled() })
            return
          }
          if (body.action === 'fire') {
            const ids = Array.isArray(body.bindingIds) ? body.bindingIds.map(String) : []
            // 后台发送，立即返回；前端轮询 tasks 看进度。showBrowser=false 时无头执行。
            const results = await publishPlanNow(spaceId, String(body.planId || ''), ids, { background: true, headless: body.showBrowser === false })
            sendJson(res, 200, { success: true, spaceId, started: true, results, last: lastPublishNow(spaceId), items: loadPublishCalendar(spaceId) })
            return
          }
          if (body.action === 'retry') {
            // 手动重发：沿用原任务的发布包 + 账号，重新建任务并派发（失败/取消的才能重发）
            const taskId = String(body.taskId || '')
            const listed = await publicationAction(spaceId, 'ui', { action: 'tasks.list' })
            const list = ((listed && (listed as any).items) || []) as any[]
            const task = list.find((t: any) => t.id === taskId)
            if (!task) throw new Error('找不到这条任务')
            if (!['failed', 'cancelled', 'unknown'].includes(String(task.state))) throw new Error('这条任务还在进行中或已发出，不能重发')
            const packId = String(task.snapshot?.packId || '')
            const bindingId = String(task.snapshot?.bindingId || '')
            const pack = loadPacks(spaceId).find((p: any) => p.id === packId)
            if (!pack) throw new Error('这条任务的发布包已不存在，请到发布包重新写文案后再发')
            if (!pack.planId) throw new Error('这条任务缺少对应排期')
            if (!bindingId) throw new Error('这条任务缺少账号，请到「账号」重新选择')
            const results = await publishPlanNow(spaceId, pack.planId, [bindingId], { background: true, headless: body.showBrowser === false })
            sendJson(res, 200, { success: true, spaceId, started: true, results, last: lastPublishNow(spaceId), items: loadPublishCalendar(spaceId) })
            return
          }
          if (body.action === 'tasks') {
            const listed = await publicationAction(spaceId, 'ui', { action: 'tasks.list' })
            const rawTasks = ((listed && (listed as any).items) || []) as any[]
            // 平台已确认发出的任务 → 对应排期自动标已发，用户不用再手动点
            let calendarChanged = false
            for (const t of rawTasks) {
              const planId = String(t.snapshot?.planId || '')
              const okTask = t.state === 'accepted' || t.receipt?.verified?.ok === true
              if (!planId || !okTask) continue
              const before = loadPublishCalendar(spaceId).find((row) => row.id === planId)
              if (before && before.status !== 'published') {
                markPlanPublished(spaceId, planId)
                calendarChanged = true
              }
            }
            const items = rawTasks.map((t: any) => ({
              id: t.id, state: t.state, updatedAt: t.updatedAt, createdAt: t.createdAt,
              planId: String(t.snapshot?.planId || ''),
              dispatchStartedAt: t.dispatchStartedAt || 0,
              title: t.snapshot?.title || '', platform: t.snapshot?.platform || '',
              accountLabel: t.snapshot?.accountLabel || '',
              events: (t.events || []).slice(-6), error: t.receipt?.error || '',
              verified: t.receipt?.verified || null,
              summary: t.receipt?.adapterSummary || '',
            }))
            sendJson(res, 200, { success: true, spaceId, items, last: lastPublishNow(spaceId), calendarChanged, calendar: calendarChanged ? loadPublishCalendar(spaceId) : undefined })
            return
          }
          throw new Error('未知操作')
        } catch (error: any) { sendJson(res, 400, { success: false, error: error?.message || '现在发操作失败' }) }
      }),

      // 到点自动发：查看哪几条会自动发 / 手动跑一次 / 关掉某条的自动发
      register('/digital-human-studio/auto-publish', async (req, res) => {
        res.setHeader?.('cache-control', 'no-store')
        const connection = ctx.get('connection') as { requestRejection?: (req: { headers: unknown }) => number | undefined } | undefined
        if (!connection?.requestRejection) { sendJson(res, 403, { success: false, error: '未授权' }); return }
        const rejection = connection.requestRejection({ headers: req.headers })
        if (rejection) { sendJson(res, rejection, { success: false, error: '未授权' }); return }
        if (!sameOrigin(req)) { sendJson(res, 403, { success: false, error: 'origin not allowed' }); return }
        const method = String(req.method || 'GET').toUpperCase()
        try {
          if (method === 'GET') {
            const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
            const spaceId = requireCalendarSpace(spaceStore, url.searchParams.get('space'))
            sendJson(res, 200, { success: true, spaceId, ...autoPublishOverview(spaceId) })
            return
          }
          if (method !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) { sendJson(res, 415, { success: false, error: 'application/json required' }); return }
          const body = await readJson(req)
          const spaceId = requireCalendarSpace(spaceStore, body.space)
          if (body.action === 'tick') {
            const report = await autoPublishTick({ spaceId, dryRun: body.dryRun === true })
            sendJson(res, 200, { success: true, spaceId, report, ...autoPublishOverview(spaceId) })
            return
          }
          if (body.action === 'disable' || body.action === 'enable') {
            const id = String(body.id || '')
            const plan = loadPublishCalendar(spaceId).find(p => p.id === id)
            if (!plan) throw new Error('找不到这条排期')
            const next = upsertPublishPlan(spaceId, { ...plan, autoSend: body.action === 'enable' })
            sendJson(res, 200, { success: true, spaceId, item: next, ...autoPublishOverview(spaceId) })
            return
          }
          throw new Error('未知自动发操作')
        } catch (error: any) { sendJson(res, 400, { success: false, error: error?.message || '自动发操作失败' }) }
      }),

      // 公共造型素材库（由小葱 API 后台维护）：只读转发，和企业素材一起给前端
      register('/digital-human-studio/style-library', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'GET') {
          sendJson(res, 405, { success: false, error: 'method not allowed' })
          return
        }
        try {
          if (!config.newApiToken) throw new Error('尚未设置 XiaocongAPI 令牌')
          const base = validateBase(config.newApiBaseUrl)
          const token = normalizeToken(config.newApiToken)
          const response = await fetch(`${base}/v1/xiaocong/style-library`, {
            headers: { accept: 'application/json', authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15000),
          })
          const payload = await response.json().catch(() => null) as any
          if (!response.ok || payload?.success === false) throw new Error(payload?.error || payload?.message || '公共造型素材库读取失败')
          const data = payload?.data || {}
          sendJson(res, 200, {
            success: true,
            scenes: Array.isArray(data.scenes) ? data.scenes : [],
            outfits: Array.isArray(data.outfits) ? data.outfits : [],
          })
        } catch (error: any) {
          sendJson(res, 200, { success: false, scenes: [], outfits: [], error: error?.message || '公共造型素材库读取失败' })
        }
      }),

      register('/digital-human-studio/materials', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        if (method !== 'GET' && method !== 'POST') {
          sendJson(res, 405, { success: false, error: 'method not allowed' })
          return
        }
        let spaceQuery = ''
        try {
          const url = new URL(String(req.url || '/'), `http://${req.headers.host || '127.0.0.1'}`)
          spaceQuery = String(url.searchParams.get('space') || '').trim()
        } catch {
          /* ignore */
        }
        const spaceId = isSpaceId(spaceQuery) ? spaceQuery : activeSpaceId
        if (method === 'GET') {
          sendJson(res, 200, { success: true, ...publicStudioMaterials(spaceId) })
          return
        }
        if (!sameOrigin(req)) {
          sendJson(res, 403, { success: false, error: 'origin not allowed' })
          return
        }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          sendJson(res, 415, { success: false, error: 'application/json required' })
          return
        }
        try {
          const body = await readJson(req)
          const action = String(body.action || '').trim()
          const target = isSpaceId(String(body.space || '')) ? String(body.space) : spaceId
          if (action === 'delete') {
            removeStudioMaterial(target, String(body.id || ''))
            sendJson(res, 200, { success: true, ...publicStudioMaterials(target) })
            return
          }
          if (action === 'rename') {
            const item = renameStudioMaterial(target, String(body.id || ''), String(body.name || ''))
            sendJson(res, 200, { success: true, item, ...publicStudioMaterials(target) })
            return
          }
          if (action === 'open') {
            const slot = String(body.slot || '').trim()
            const opened = openMaterialsDirectory(target, slot)
            sendJson(res, 200, {
              success: true,
              ...publicStudioMaterials(target),
              slot: slot || '',
              path: opened.path,
              opened: opened.opened,
              ...(opened.note ? { note: opened.note } : {}),
            })
            return
          }
          throw new Error('未知操作')
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '素材操作失败' })
        }
      }),

      register('/digital-human-studio/materials/file', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        if (method === 'GET' || method === 'HEAD') {
          try {
            const url = new URL(String(req.url || '/'), `http://${req.headers.host || '127.0.0.1'}`)
            const spaceId = String(url.searchParams.get('space') || '').trim() || activeSpaceId
            if (!isSpaceId(spaceId)) throw new Error('非法空间')
            const id = String(url.searchParams.get('id') || '').trim()
            if (!id) throw new Error('id 不能为空')
            const item = findStudioMaterial(spaceId, id)
            if (!item) throw new Error('找不到这个素材')
            const buf = readFileSync(materialAbsolutePath(spaceId, item))
            const mime = materialMime(item.name || item.file)
            if (method === 'HEAD') {
              res.writeHead(200, { 'content-type': mime, 'content-length': buf.length, 'cache-control': 'private, max-age=3600' })
              res.end()
              return
            }
            sendBinary(res, 200, buf, mime, 'private, max-age=3600')
          } catch (e: any) {
            sendJson(res, 400, { success: false, error: e?.message || '读取素材失败' })
          }
          return
        }
        if (method !== 'POST') {
          sendJson(res, 405, { success: false, error: 'method not allowed' })
          return
        }
        if (!sameOrigin(req)) {
          sendJson(res, 403, { success: false, error: 'origin not allowed' })
          return
        }
        try {
          const slot = String(req.headers['x-slot'] || '').trim()
          if (!isMaterialSlot(slot)) throw new Error('槽位只能是产品、门店、Logo、场景背景或服装套装')
          const spaceId = String(req.headers['x-space'] || '').trim() || activeSpaceId
          if (!isSpaceId(spaceId)) throw new Error('非法空间')
          let fileName = String(req.headers['x-file-name'] || 'file').trim()
          try {
            fileName = decodeURIComponent(fileName)
          } catch {
            /* keep raw */
          }
          const body = await readRawBody(req, 200 * 1024 * 1024)
          const item = addStudioMaterial(spaceId, slot, fileName, body)
          sendJson(res, 200, { success: true, item, ...publicStudioMaterials(spaceId) })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '上传素材失败' })
        }
      }),

      // 成品视频文件（只读，仅限本空间 exports 里已登记的记录）
      register('/digital-human-studio/works/file', async (req, res) => {
        res.setHeader?.('cache-control', 'private, max-age=3600')
        const connection = ctx.get('connection') as { requestRejection?: (req: { headers: unknown }) => number | undefined } | undefined
        if (!connection?.requestRejection) { sendJson(res, 403, { success: false, error: '未授权' }); return }
        const denied = connection.requestRejection({ headers: req.headers })
        if (denied || !sameOrigin(req)) { sendJson(res, denied || 403, { success: false, error: '未授权或来源无效' }); return }
        const method = String(req.method || 'GET').toUpperCase()
        if (method !== 'GET' && method !== 'HEAD') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        try {
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          const space = requireCalendarSpace(spaceStore, url.searchParams.get('space'))
          const file = exportFilePath(space, String(url.searchParams.get('id') || ''))
          if (!file) { sendJson(res, 404, { success: false, error: '找不到这个成品，或记录已失效' }); return }
          const { createReadStream } = await import('node:fs')
          const { statSync } = await import('node:fs')
          const size = statSync(file.path).size
          const range = String(req.headers?.range || '').trim()
          res.setHeader?.('accept-ranges', 'bytes')
          if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range)
            if (!match || (!match[1] && !match[2])) { res.writeHead?.(416, { 'content-range': `bytes */${size}` }); res.end?.(); return }
            let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
            let end = match[1] && match[2] ? Number(match[2]) : size - 1
            if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
              res.writeHead?.(416, { 'content-range': `bytes */${size}` }); res.end?.(); return
            }
            end = Math.min(end, size - 1)
            res.writeHead?.(206, {
              'content-type': file.mime,
              'content-length': end - start + 1,
              'content-range': `bytes ${start}-${end}/${size}`,
              'accept-ranges': 'bytes',
              'cache-control': 'private, max-age=3600',
            })
            if (method === 'HEAD') { res.end?.(); return }
            const partial = createReadStream(file.path, { start, end })
            partial.on('error', () => res.destroy?.())
            partial.pipe(res)
            return
          }
          res.writeHead(200, { 'content-type': file.mime, 'content-length': size, 'cache-control': 'private, max-age=3600' })
          if (method === 'HEAD') { res.end(); return }
          const stream = createReadStream(file.path)
          stream.on('error', () => res.destroy())
          stream.pipe(res)
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '读取成品失败' })
        }
      }),

      // 成品封面图：ffmpeg 抽一帧当 poster；抽不出来就 404，前端退回视频元素
      register('/digital-human-studio/works/thumb', async (req, res) => {
        res.setHeader?.('cache-control', 'private, max-age=3600')
        const connection = ctx.get('connection') as { requestRejection?: (req: { headers: unknown }) => number | undefined } | undefined
        if (!connection?.requestRejection) { sendJson(res, 403, { success: false, error: '未授权' }); return }
        const denied = connection.requestRejection({ headers: req.headers })
        if (denied || !sameOrigin(req)) { sendJson(res, denied || 403, { success: false, error: '未授权或来源无效' }); return }
        const method = String(req.method || 'GET').toUpperCase()
        if (method !== 'GET' && method !== 'HEAD') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        try {
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          const space = requireCalendarSpace(spaceStore, url.searchParams.get('space'))
          const item = await ensureExportThumb(space, String(url.searchParams.get('id') || ''))
          if (!item) { sendJson(res, 404, { success: false, error: '没有可用封面' }); return }
          const { createReadStream, statSync } = await import('node:fs')
          const size = statSync(item.path).size
          res.writeHead?.(200, { 'content-type': item.mime, 'content-length': size, 'cache-control': 'private, max-age=3600' })
          if (method === 'HEAD') { res.end?.(); return }
          createReadStream(item.path).pipe(res)
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '生成封面失败' })
        }
      }),

      // 成片 → 文案 + 封面：照自媒体工作台的思路，用当前默认模型写，用小葱 API 的生图模型画封面
      register('/digital-human-studio/works/copy', async (req, res) => {
        res.setHeader?.('cache-control', 'no-store')
        if (denyUnlessTrustedStudio(req, res)) return
        if (String(req.method || 'GET').toUpperCase() !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        try {
          const body = await readJson(req)
          const space = requireCalendarSpace(spaceStore, body.space)
          const id = String(body.id || '').trim()
          const item = loadStudioHistory(space).find(row => row.id === id)
          if (!item) { sendJson(res, 404, { success: false, error: '这条件片不存在或已经删掉了' }); return }
          if (!defaultModelInfo(ctx)) { sendJson(res, 409, { success: false, error: '当前没有可用模型，先在设置里选一个默认模型' }); return }
          const file = item.kind === 'xdh-export-video' ? exportFilePath(space, id) : null
          const seconds = file ? await probeSeconds(file.path) : null
          const company = spaceStore.spaces.find(row => row.id === space)?.name
          const platformList = Array.isArray(body.platforms) ? (body.platforms as unknown[]).map(String).filter(key => key === 'douyin' || key === 'xiaohongshu' || key === 'shipinhao') : []
          const prompts = copyPrompts({ title: item.title, kind: item.kind, seconds, company, note: item.prompt, platforms: platformList })
          // 模型偶尔会把 JSON 写坏（多段解释、缺字段），重试一次比让用户自己点重试快
          let result: { text: string; model: string } | null = null
          let parsed = null
          for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
            result = await callModel(ctx, prompts)
            parsed = normalizeCopy(extractJson(result.text), result.model)
            if (!parsed) console.warn('[digital-human-studio] copy json miss:', result.text.slice(0, 500))
          }
          if (!parsed || !result) { sendJson(res, 502, { success: false, error: '模型返回的文案格式不对，再生成一次试试' }); return }
          const model = result.model
          // 封面：有生图模型就画；没有就如实记下原因，前端用大字封面兜底
          let coverUrl = ''
          let coverError = ''
          try {
            const listed = await listImageModels()
            if (!listed.models.length) coverError = listed.note || '小葱 API 还没有可用的生图模型'
            else {
              const preferred = listed.models.find(name => /gpt-image/i.test(name)) || listed.models[0]
              const knownIds = new Set(loadStudioHistory(space).map(row => row.id))
              const job = await createImageJob({ prompt: coverPromptOf(parsed, item.title), model: preferred, ratio: '16:9', title: `${item.title} 封面` })
              coverUrl = String(job?.url || '')
              // 封面只是这条成片的配图，生图任务自己那条记录不要留在成片库里
              if (job?.id) removeStudioHistory(space, String(job.id))
              for (const row of loadStudioHistory(space)) {
                if (!knownIds.has(row.id) && row.kind === 'ximg') removeStudioHistory(space, row.id)
              }
              if (!coverUrl) coverError = job?.fail_reason || '生图没有返回图片'
            }
          } catch (error: any) {
            coverError = String(error?.message || '封面没画出来')
          }
          const copy = { ...parsed, model, at: Date.now(), ...(coverUrl ? { coverUrl } : {}), ...(coverError ? { coverError } : {}) }
          patchStudioHistory(space, id, { copy } as any)
          sendJson(res, 200, { success: true, spaceId: space, copy, item: { ...item, copy } })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '生成文案失败' })
        }
      }),

      // 文案改稿：用户说一句「标题再短一点」，模型只改它提到的字段
      register('/digital-human-studio/works/copy/revise', async (req, res) => {
        res.setHeader?.('cache-control', 'no-store')
        if (denyUnlessTrustedStudio(req, res)) return
        if (String(req.method || 'GET').toUpperCase() !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        try {
          const body = await readJson(req)
          const space = requireCalendarSpace(spaceStore, body.space)
          const id = String(body.id || '').trim()
          const instruction = String(body.instruction || '').trim().slice(0, 400)
          if (!instruction) { sendJson(res, 400, { success: false, error: '想怎么改？说一句' }); return }
          const item = loadStudioHistory(space).find(row => row.id === id)
          if (!item?.copy) { sendJson(res, 409, { success: false, error: '这条件片还没有文案，先生成一次' }); return }
          if (!defaultModelInfo(ctx)) { sendJson(res, 409, { success: false, error: '当前没有可用模型，先在设置里选一个默认模型' }); return }
          const chat = Array.isArray(item.copy.chat) ? item.copy.chat : []
          const platform = ['douyin', 'xiaohongshu', 'shipinhao'].includes(String(body.platform || '')) ? String(body.platform) as 'douyin' | 'xiaohongshu' | 'shipinhao' : undefined
          const platformView = platform ? (item.copy as any).platforms?.[platform] : undefined
          const prompts = platform && platformView ? revisePlatformPrompts(item.copy as any, platform, instruction, chat) : revisePrompts(item.copy, instruction, chat)
          const { text, model } = await callModel(ctx, prompts)
          const patch = extractJson(text)
          if (!patch || typeof patch !== 'object') { sendJson(res, 502, { success: false, error: '模型没给出改动，再说一次试试' }); return }
          const merged = platform && platformView ? mergePlatformRevision(item.copy as any, platform, patch) : mergeCopyRevision(item.copy as any, patch)
          const platformLabel = platform === 'xiaohongshu' ? '小红书' : platform === 'shipinhao' ? '视频号' : platform === 'douyin' ? '抖音' : ''
          const nextChat = [
            ...chat.slice(-12),
            { role: 'user', text: instruction, at: Date.now() },
            { role: 'ai', text: platformLabel ? `改好了（${platformLabel}版）` : '改好了', at: Date.now() + 1 },
          ]
          const copy = { ...merged, model, at: Date.now(), chat: nextChat }
          patchStudioHistory(space, id, { copy } as any)
          sendJson(res, 200, { success: true, spaceId: space, copy, item: { ...item, copy } })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '改稿失败' })
        }
      }),

      // 只重画封面：文案不动，画面换一张
      register('/digital-human-studio/works/copy/cover', async (req, res) => {
        res.setHeader?.('cache-control', 'no-store')
        if (denyUnlessTrustedStudio(req, res)) return
        if (String(req.method || 'GET').toUpperCase() !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        try {
          const body = await readJson(req)
          const space = requireCalendarSpace(spaceStore, body.space)
          const id = String(body.id || '').trim()
          const item = loadStudioHistory(space).find(row => row.id === id)
          if (!item?.copy) { sendJson(res, 409, { success: false, error: '这条件片还没有文案，先生成一次' }); return }
          const listed = await listImageModels()
          if (!listed.models.length) { sendJson(res, 409, { success: false, error: listed.note || '小葱 API 还没有可用的生图模型' }); return }
          const preferred = listed.models.find(name => /gpt-image/i.test(name)) || listed.models[0]
          const edited = String(body.prompt || '').trim().slice(0, 800)
          const prompt = edited || coverPromptOf(item.copy as any, item.title)
          const knownIds = new Set(loadStudioHistory(space).map(row => row.id))
          const job = await createImageJob({ prompt, model: preferred, ratio: '16:9', title: `${item.title} 封面` })
          if (job?.id) removeStudioHistory(space, String(job.id))
          for (const row of loadStudioHistory(space)) {
            if (!knownIds.has(row.id) && row.kind === 'ximg') removeStudioHistory(space, row.id)
          }
          const url = String(job?.url || '')
          if (!url) { sendJson(res, 502, { success: false, error: job?.fail_reason || '生图没有返回图片' }); return }
          const copy = { ...item.copy, coverUrl: url, coverError: undefined, at: Date.now(), ...(edited ? { coverPrompt: edited } : {}) }
          patchStudioHistory(space, id, { copy } as any)
          sendJson(res, 200, { success: true, spaceId: space, copy, item: { ...item, copy } })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '重画封面失败' })
        }
      }),

      // 帧 + 大字合成封面：前端 canvas 合成后传 dataURL，落 covers/<id>-cover.jpg
      register('/digital-human-studio/works/cover-text', async (req, res) => {
        res.setHeader?.('cache-control', 'no-store')
        if (denyUnlessTrustedStudio(req, res)) return
        if (String(req.method || 'GET').toUpperCase() !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        try {
          const body = await readJson(req)
          const space = requireCalendarSpace(spaceStore, body.space)
          const id = String(body.id || '').trim()
          const item = loadStudioHistory(space).find(row => row.id === id)
          if (!item?.copy) { sendJson(res, 409, { success: false, error: '这条件片还没有文案，先生成一次' }); return }
          const dataUrl = String(body.image || '')
          const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(dataUrl)
          if (!match) { sendJson(res, 400, { success: false, error: '图片数据无效' }); return }
          const bytes = Buffer.from(match[2], 'base64')
          if (!bytes.length || bytes.length > 8 * 1024 * 1024) { sendJson(res, 400, { success: false, error: '图片为空或超过 8MB' }); return }
          const out = exportCoverFramePath(space, id)
          const { mkdirSync, writeFileSync } = await import('node:fs')
          const { dirname } = await import('node:path')
          mkdirSync(dirname(out), { recursive: true, mode: 0o700 })
          writeFileSync(out, bytes, { mode: 0o600 })
          const coverUrl = `/digital-human-studio/works/cover-file?space=${encodeURIComponent(space)}&id=${encodeURIComponent(id)}&t=${Date.now()}`
          const copy = { ...item.copy, coverUrl, coverError: undefined, at: Date.now() }
          patchStudioHistory(space, id, { copy } as any)
          sendJson(res, 200, { success: true, spaceId: space, copy, item: { ...item, copy }, coverUrl })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '合成封面失败' })
        }
      }),

      // 取帧封面：预览 / 确认。apply=false 只抽帧不落库，apply=true 写进这条成片的 copy.coverUrl。
      register('/digital-human-studio/works/cover-frame', async (req, res) => {
        res.setHeader?.('cache-control', 'no-store')
        if (denyUnlessTrustedStudio(req, res)) return
        if (String(req.method || 'GET').toUpperCase() !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        try {
          const body = await readJson(req)
          const space = requireCalendarSpace(spaceStore, body.space)
          const id = String(body.id || '').trim()
          const item = loadStudioHistory(space).find(row => row.id === id)
          if (!item) { sendJson(res, 404, { success: false, error: '这条件片不存在或已经删掉了' }); return }
          const file = exportFilePath(space, id)
          if (!file) { sendJson(res, 409, { success: false, error: '只有剪映导出的视频能取帧做封面' }); return }
          const apply = body.apply === true
          const at = Math.max(0, Math.min(Number(body.at) || 0, 6 * 3600))
          if (apply && !item.copy) { sendJson(res, 409, { success: false, error: '这条件片还没有文案，先生成一次' }); return }
          const frame = await extractExportFrame(space, id, at)
          if (!frame) { sendJson(res, 502, { success: false, error: '抽帧失败：没找到 ffmpeg 或视频读不了' }); return }
          const stamp = Date.now()
          const coverUrl = `/digital-human-studio/works/cover-file?space=${encodeURIComponent(space)}&id=${encodeURIComponent(id)}&t=${stamp}`
          const duration = (await probeSeconds(file.path)) || 0
          if (apply) {
            const copy = { ...item.copy, coverUrl, coverError: undefined, at: Date.now() }
            patchStudioHistory(space, id, { copy } as any)
            sendJson(res, 200, { success: true, spaceId: space, copy, item: { ...item, copy }, coverUrl, duration })
          } else {
            sendJson(res, 200, { success: true, spaceId: space, frameUrl: coverUrl, duration })
          }
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '取帧失败' })
        }
      }),

      // 取帧封面的文件：只读 covers/<id>-cover.jpg，不做任何生成。
      register('/digital-human-studio/works/cover-file', async (req, res) => {
        res.setHeader?.('cache-control', 'no-store')
        const connection = ctx.get('connection') as { requestRejection?: (req: { headers: unknown }) => number | undefined } | undefined
        if (!connection?.requestRejection) { sendJson(res, 403, { success: false, error: '未授权' }); return }
        const denied = connection.requestRejection({ headers: req.headers })
        if (denied || !sameOrigin(req)) { sendJson(res, denied || 403, { success: false, error: '未授权或来源无效' }); return }
        const method = String(req.method || 'GET').toUpperCase()
        if (method !== 'GET' && method !== 'HEAD') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        try {
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          const space = requireCalendarSpace(spaceStore, url.searchParams.get('space'))
          const path = exportCoverFramePath(space, String(url.searchParams.get('id') || ''))
          const { createReadStream, statSync } = await import('node:fs')
          const size = statSync(path).size
          res.writeHead?.(200, { 'content-type': 'image/jpeg', 'content-length': size, 'cache-control': 'no-store' })
          if (method === 'HEAD') { res.end?.(); return }
          createReadStream(path).pipe(res)
        } catch (e: any) {
          sendJson(res, 404, { success: false, error: e?.message || '没有可用封面' })
        }
      }),

      // 导入剪映剪好的成品（支持二进制原样上传，也支持 JSON { path, space?, name? } 从本机路径导入）
      register('/digital-human-studio/works/import', async (req, res) => {
        res.setHeader?.('cache-control', 'no-store')
        if (denyUnlessTrustedStudio(req, res)) return
        if (String(req.method || 'GET').toUpperCase() !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        try {
          const ct = String(req.headers['content-type'] || '')
          if (ct.startsWith('application/json')) {
            const payload = await readJson(req)
            const space = requireCalendarSpace(spaceStore, (payload as any)?.space || activeSpaceId)
            const filePath = expandPath(String((payload as any)?.path || ''))
            if (!filePath || !existsSync(filePath)) throw new Error(`找不到视频文件：${filePath || '(空)'}`)
            const fileName = String((payload as any)?.name || basename(filePath) || 'import.mp4').trim()
            const bytes = readFileSync(filePath)
            const item = importExport(space, fileName, bytes)
            sendJson(res, 200, { success: true, spaceId: space, item })
            return
          }
          const space = requireCalendarSpace(spaceStore, req.headers['x-space'])
          let fileName = String(req.headers['x-file-name'] || 'import.mp4').trim()
          try { fileName = decodeURIComponent(fileName) } catch { /* keep raw */ }
          const body = await readRawBody(req, 500 * 1024 * 1024)
          const item = importExport(space, fileName, body)
          sendJson(res, 200, { success: true, spaceId: space, item })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '导入成品失败' })
        }
      }),

      // 回填：把之前导出过、但没登记进成片库的成品补登记
      register('/digital-human-studio/works/backfill', async (req, res) => {
        res.setHeader?.('cache-control', 'no-store')
        const connection = ctx.get('connection') as { requestRejection?: (req: { headers: unknown }) => number | undefined } | undefined
        if (!connection?.requestRejection) { sendJson(res, 403, { success: false, error: '未授权' }); return }
        const denied = connection.requestRejection({ headers: req.headers })
        if (denied || !sameOrigin(req)) { sendJson(res, denied || 403, { success: false, error: '未授权或来源无效' }); return }
        if (String(req.method || 'GET').toUpperCase() !== 'POST') { sendJson(res, 405, { success: false, error: 'method not allowed' }); return }
        try {
          const body = await readJson(req)
          const space = requireCalendarSpace(spaceStore, body.space || (req.headers['x-space'] as string) || '')
          const result = backfillExports(space)
          sendJson(res, 200, { success: true, spaceId: space, ...result })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '回填失败' })
        }
      }),



      

      register('/digital-human-studio/comment-wordcloud', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        let spaceQuery = ''
        let idQuery = ''
        let kindQuery = ''
        try {
          const url = new URL(String(req.url || '/'), `http://${req.headers.host || '127.0.0.1'}`)
          spaceQuery = String(url.searchParams.get('space') || '').trim()
          idQuery = String(url.searchParams.get('id') || '').trim()
          kindQuery = String(url.searchParams.get('kind') || '').trim()
        } catch { /* ignore */ }
        const spaceId = isSpaceId(spaceQuery) ? spaceQuery : activeSpaceId
        if (method === 'GET') {
          try {
            if (idQuery && (kindQuery === 'png' || kindQuery === 'freq')) {
              const file = resolveWordcloudAsset(spaceId, idQuery, kindQuery === 'png' ? 'png' : 'freq')
              if (!file) {
                sendJson(res, 404, { success: false, error: '结果文件不存在' })
                return
              }
              const buf = readFileSync(file)
              res.statusCode = 200
              res.setHeader('content-type', kindQuery === 'png' ? 'image/png' : 'application/json; charset=utf-8')
              res.setHeader('cache-control', 'private, max-age=60')
              res.end(buf)
              return
            }
            if (idQuery) {
              const task = getWordcloudTask(spaceId, idQuery)
              if (!task) {
                sendJson(res, 404, { success: false, error: '任务不存在' })
                return
              }
              sendJson(res, 200, { success: true, task: publicWordcloudTask(task), capability: commentWordcloudCapability(mediaCrawlerPluginConfig(config)) })
              return
            }
            sendJson(res, 200, {
              success: true,
              tasks: listWordcloudTasks(spaceId).map((x) => publicWordcloudTask(x)),
              capability: commentWordcloudCapability(mediaCrawlerPluginConfig(config)),
            })
          } catch (e: any) {
            sendJson(res, 400, { success: false, error: e?.message || '查询失败', code: e?.code })
          }
          return
        }
        if (method !== 'POST') {
          sendJson(res, 405, { success: false, error: 'method not allowed' })
          return
        }
        if (!sameOrigin(req)) {
          sendJson(res, 403, { success: false, error: 'origin not allowed' })
          return
        }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          sendJson(res, 415, { success: false, error: 'application/json required' })
          return
        }
        try {
          const body = await readJson(req)
          const target = isSpaceId(String(body.space || '')) ? String(body.space) : spaceId
          const action = String(body.action || 'analyze').trim()
          if (action === 'cancel') {
            const task = cancelWordcloudTask(target, String(body.id || ''))
            if (!task) {
              sendJson(res, 404, { success: false, error: '任务不存在' })
              return
            }
            sendJson(res, 200, { success: true, task: publicWordcloudTask(task), capability: commentWordcloudCapability(mediaCrawlerPluginConfig(config)) })
            return
          }
          if (action === 'validate') {
            const parsed = parseCommentImport({
              text: String(body.text || body.content || ''),
              filename: String(body.filename || ''),
              fixtureLabeled: !!body.fixtureLabeled,
            })
            sendJson(res, parsed.ok ? 200 : 400, { success: parsed.ok, ...parsed, capability: commentWordcloudCapability(mediaCrawlerPluginConfig(config)) })
            return
          }
          const result = await runCommentWordcloud({
            spaceId: target,
            text: String(body.text || body.content || ''),
            filename: String(body.filename || ''),
            fixtureLabeled: !!body.fixtureLabeled,
            sourceLabel: String(body.sourceLabel || body.filename || '').slice(0, 120),
            mediaCrawlerRoot: mediaCrawlerPluginConfig(config).mediaCrawlerRoot,
            mediaCrawlerPython: mediaCrawlerPluginConfig(config).mediaCrawlerPython,
          })
          sendJson(res, result.success ? 200 : 400, { ...result, task: publicWordcloudTask(result.task) })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '词云分析失败', code: e?.code })
        }
      }),

      register('/digital-human-studio/industry-hotboard', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        let spaceQuery = ''
        try {
          const url = new URL(String(req.url || '/'), `http://${req.headers.host || '127.0.0.1'}`)
          spaceQuery = String(url.searchParams.get('space') || '').trim()
        } catch { /* ignore */ }
        const spaceId = isSpaceId(spaceQuery) ? spaceQuery : activeSpaceId
        const space = spaceStore.spaces.find(item => item.id === spaceId) || currentSpace(spaceStore)
        const capability = {
          ...mediacrawlerCapabilityReport(mediaCrawlerPluginConfig(config)),
          ...industryHotboardCapability(),
        }
        if (method === 'GET') {
          try {
            const preview = resolveIndustryHotboardQuery({
              spaceName: space?.name,
              brief: space?.brief,
            })
            sendJson(res, 200, {
              success: true,
              preview,
              board: loadIndustryHotboard(spaceId),
              capability,
            })
          } catch (e: any) {
            sendJson(res, 400, { success: false, error: e?.message || '查询失败' })
          }
          return
        }
        if (method !== 'POST') {
          sendJson(res, 405, { success: false, error: 'method not allowed' })
          return
        }
        if (!sameOrigin(req)) {
          sendJson(res, 403, { success: false, error: 'origin not allowed' })
          return
        }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          sendJson(res, 415, { success: false, error: 'application/json required' })
          return
        }
        try {
          const body = await readJson(req)
          const target = isSpaceId(String(body.space || '')) ? String(body.space) : spaceId
          const targetSpace = spaceStore.spaces.find(item => item.id === target) || currentSpace(spaceStore)
          const result = await runIndustryHotboard({
            spaceId: target,
            spaceName: targetSpace?.name,
            brief: targetSpace?.brief,
            keywords: String(body.keywords || body.keyword || body.q || '').trim(),
            platform: (String(body.platform || 'xhs').trim() || 'xhs') as any,
            maxNotes: Math.min(10, Math.max(1, Number(body.maxNotes || body.limit || 10) || 10)),
            browserMode: normalizeBrowserMode(body.browserMode ?? config.mediaCrawlerBrowserMode),
            cdpPort: normalizeCdpPort(body.cdpPort ?? config.mediaCrawlerCdpPort, 9222),
            pluginConfig: mediaCrawlerPluginConfig(config),
          })
          sendJson(res, result.success ? 200 : 400, { ...result, capability: { ...result.capability, ...capability } })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '行业热榜刷新失败' })
        }
      }),

      // ── 一键检测中心：客户拿到桌面端，先来这里把环境装齐
      // 前端默认目录：不要让浏览器猜 ~ 在哪，统一由后端给（换机器也不会写死用户名）
      register('/digital-human-studio/paths', async (_req, res) => {
        const home = homedir()
        sendJson(res, 200, {
          success: true,
          home,
          exportDir: join(home, 'Movies', 'xcy-out'),
          previewDir: join(home, '.xiaocongcut', 'cache', 'preview'),
          dataDir: join(home, '.dsh'),
        })
      }),

      register('/digital-human-studio/setup/status', async (_req, res) => {
        try {
          const engineRoot = resolveActiveEngineRoot(config)
          const st = setupStatus({ engineRoot })
          sendJson(res, 200, { success: true, ...st, footprint: setupFootprint({ engineRoot }) })
        } catch (e: any) {
          sendJson(res, 500, { success: false, error: e?.message || '检测失败' })
        }
      }),

      register('/digital-human-studio/publish/runtime', async (req, res) => {
        res.setHeader?.('cache-control', 'no-store')
        const rt = readPublishRuntimeStatus()
        sendJson(res, 200, {
          success: true,
          ...rt,
          installing: publishInstallState().running,
          startedAt: publishInstallState().startedAt || undefined,
          lastError: publishInstallState().ok === false ? String(publishInstallState().text || '').slice(-600) : undefined,
        })
      }),

      register('/digital-human-studio/publish/runtime/ensure', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        if (!sameOrigin(req)) {
          sendJson(res, 403, { success: false, error: 'origin not allowed' })
          return
        }
        const r = startPublishInstall()
        sendJson(res, 200, { success: true, ...r, runtime: readPublishRuntimeStatus() })
      }),

      register('/digital-human-studio/setup/install', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        if (!sameOrigin(req)) {
          sendJson(res, 403, { success: false, error: 'origin not allowed' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const key = String((body as any)?.key || '')
        const root = resolveActiveEngineRoot(config)
        try {
          if (key === 'engine') {
            const r = await installEngine(root, join(tmpdir(), 'dsh-engine-install.log'))
            sendJson(res, r.success ? 200 : 500, { success: r.success, key, detail: r.hint || '渲染引擎已就绪', steps: r.steps })
            return
          }
          if (key === 'crawler') {
            const r = await provisionMcEnv({ confirm: true, logFile: join(tmpdir(), 'dsh-crawler-install.log') })
            sendJson(res, r.success ? 200 : 500, { success: r.success, key, detail: r.hint || '采集环境已就绪', steps: r.steps })
            return
          }
          if (key === 'asr') {
            const r = await installAsrModel(root, 'small', join(tmpdir(), 'dsh-asr-install.log'))
            sendJson(res, r.success ? 200 : 500, { success: r.success, key, detail: r.detail })
            return
          }
          if (key === 'node') {
            const script = [
              resolve(PLUGIN_ROOT_DIR, 'scripts', 'install-node.sh'),
              resolve(PLUGIN_ROOT_DIR, '..', 'scripts', 'install-node.sh'),
            ].find(path => existsSync(path)) || ''
            // Windows 上没有 bash：直接下 node 的 win-x64.zip，用 powershell 解压到 ~/.dsh/runtime/node
            if (IS_WIN) {
              try {
                const out = await installNodeOnWindows()
                sendJson(res, 200, { success: true, key, detail: `Node 已装到 ${out.dest}（${out.version}，下次启动生效）` })
              } catch (e: any) {
                sendJson(res, 500, { success: false, key, detail: String(e?.message || e).slice(-3000) })
              }
              return
            }
            if (!existsSync(script)) {
              sendJson(res, 400, { success: false, key, detail: '找不到 scripts/install-node.sh（安装包不完整）' })
              return
            }
            const out = await new Promise<{ ok: boolean; text: string }>((done) => {
              const child = spawn('bash', [script], { cwd: dirname(script), env: process.env })
              let buf = ''
              child.stdout.on('data', (c) => { buf += c.toString() })
              child.stderr.on('data', (c) => { buf += c.toString() })
              child.on('error', (e) => done({ ok: false, text: String(e?.message || e) }))
              child.on('close', (code) => done({ ok: code === 0, text: buf.slice(-3000) }))
            })
            sendJson(res, out.ok ? 200 : 500, {
              success: out.ok,
              key,
              detail: out.ok ? 'Node 已装到 ~/.dsh/runtime/node（下次启动生效）' : out.text,
            })
            return
          }
          if (key === 'publish') {
            const started = startPublishInstall()
            if (started.ready) { sendJson(res, 200, { success: true, key, detail: '发布运行时已就绪' }); return }
            if (!started.running) {
              sendJson(res, 500, { success: false, key, detail: publishInstallState().text || '发布安装没能启动' })
              return
            }
            // 阻塞到装完（最长 20 分钟）：客户点的是「安装」，要看到结果
            await waitPublishInstall(20 * 60 * 1000)
            const done = readPublishRuntimeStatus()
            sendJson(res, done.ready ? 200 : 500, {
              success: done.ready,
              key,
              detail: done.ready ? '发布运行时已就绪' : (publishInstallState().text || done.message || '安装未完成'),
            })
            return
          }
          sendJson(res, 400, { success: false, key, detail: '这一项不支持自动安装' })
        } catch (e: any) {
          sendJson(res, 500, { success: false, key, detail: e?.message || '安装失败' })
        }
      }),

      register('/digital-human-studio/mediacrawler/env', async (req, res) => {
        try {
          sendJson(res, 200, { success: true, status: diagnoseMcEnv() })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '采集环境探测失败' })
        }
      }),

      register('/digital-human-studio/mediacrawler/setup', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: 'method not allowed' })
          return
        }
        if (!sameOrigin(req)) {
          sendJson(res, 403, { success: false, error: 'origin not allowed' })
          return
        }
        try {
          const body = await readJson(req).catch(() => ({} as any))
          const result = await provisionMcEnv({ confirm: body.confirm === true, logFile: join(tmpdir(), 'dsh-mc-setup.log') })
          sendJson(res, result.success ? 200 : 400, result)
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '采集环境初始化失败' })
        }
      }),

      register('/digital-human-studio/retro-review', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        const origin = String(req.headers.origin || '')
        if (origin) {
          res.setHeader('access-control-allow-origin', origin)
          res.setHeader('vary', 'Origin')
        }
        let spaceQuery = ''
        try {
          const url = new URL(String(req.url || '/'), `http://${req.headers.host || '127.0.0.1'}`)
          spaceQuery = String(url.searchParams.get('space') || '').trim()
        } catch { /* ignore */ }
        const spaceId = isSpaceId(spaceQuery) ? spaceQuery : activeSpaceId
        const space = spaceStore.spaces.find(item => item.id === spaceId) || currentSpace(spaceStore)
        const capability = retroReviewCapability()
        if (method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-origin': String(req.headers.origin || '*'),
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers': 'content-type',
            'access-control-max-age': '600',
          })
          res.end()
          return
        }
        if (method === 'GET') {
          const snapshot = loadRetroReview(spaceId)
          const mcRoot = String(config.mediaCrawlerRoot || '').trim() || defaultMcRoot()
          const scanned = scanMediaCrawlerForRetro(mcRoot)
          // 主数据 = 本 space 已授权账号自己的作品（本机登录态同步落盘）
          const owned = spaceAccountWorks(spaceId)
          const primary = owned.metrics.length > 0 ? owned.metrics : scanned.metrics
          const payload = {
            metrics: primary,
            comments: scanned.comments,
            platforms: [...new Set(primary.map(m => m.platform))],
            errors: scanned.errors,
          }
          const insights = computeRetroInsights(payload)
          sendJson(res, 200, {
            success: true,
            insights,
            dataSource: {
              mode: owned.metrics.length > 0 ? 'account' : 'sample',
              accounts: owned.accounts,
              accountWorks: owned.metrics.length,
              sampleWorks: scanned.metrics.length,
              sampleComments: scanned.comments.length,
              sampleRoot: mcRoot,
              note:
                owned.metrics.length > 0
                  ? '主数据是本机已授权账号自己的作品（本机登录态直连，不是第三方接口）；评论热词仍来自 MediaCrawler 搜索样本。'
                  : '还没有账号作品缓存，当前显示 MediaCrawler 搜索样本；到账号详情点一次「刷新监控」同步后再看。',
            },
            scan: {
              at: Date.now(),
              source: owned.metrics.length > 0 ? 'account-works' : mcRoot,
              works: primary.length,
              comments: scanned.comments.length,
              platforms: payload.platforms,
              errors: scanned.errors,
            },
            snapshot,
            capability,
            company: { id: spaceId, name: space?.name || '默认' },
          })
          return
        }
        if (method !== 'POST') {
          sendJson(res, 405, { success: false, error: 'method not allowed' })
          return
        }
        if (!sameOrigin(req)) {
          sendJson(res, 403, { success: false, error: 'origin not allowed' })
          return
        }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          sendJson(res, 415, { success: false, error: 'application/json required' })
          return
        }
        try {
          const body = await readJson(req)
          const target = isSpaceId(String(body.space || '')) ? String(body.space) : spaceId
          const targetSpace = spaceStore.spaces.find(item => item.id === target) || currentSpace(spaceStore)
          const action = String(body.action || 'refresh').trim()
          const mcRoot = String(config.mediaCrawlerRoot || '').trim() || defaultMcRoot()
          const scanned = scanMediaCrawlerForRetro(mcRoot)
          const owned = spaceAccountWorks(target)
          const primary = owned.metrics.length > 0 ? owned.metrics : scanned.metrics
          const primaryPlatforms = [...new Set(primary.map((m: any) => m.platform))]
          const primarySource = owned.metrics.length > 0 ? 'account-works' : mcRoot
          const primaryPayload = { metrics: primary, comments: scanned.comments, platforms: primaryPlatforms, errors: scanned.errors }
          if (action === 'refresh') {
            const insights = computeRetroInsights(primaryPayload)
            sendJson(res, 200, {
              success: true,
              insights,
              scan: {
                at: Date.now(),
                source: primarySource,
                works: primary.length,
                comments: scanned.comments.length,
                platforms: primaryPlatforms,
                errors: scanned.errors,
              },
              capability,
            })
            return
          }
          if (action === 'learn') {
            const insights = computeRetroInsights(primaryPayload)
            // 账号作品模式下评论仍来自搜索样本，不据此生成「回应评论区」规则，避免给出与账号无关的建议
            const ruleInsights = owned.metrics.length > 0 ? { ...insights, commentWords: [] } : insights
            const snapshot = loadRetroReview(target) ?? {
              version: 1 as const,
              spaceId: target,
              skills: [] as RetroRule[],
              lastScan: { at: 0, source: '', works: 0, comments: 0, platforms: [] as string[], errors: [] as string[] },
            }
            const fresh = proposeRetroRules(ruleInsights, snapshot.skills)
            const skills = [...snapshot.skills, ...fresh]
            saveRetroReview(target, {
              version: 1,
              spaceId: target,
              skills,
              lastScan: { at: Date.now(), source: primarySource, works: primary.length, comments: scanned.comments.length, platforms: primaryPlatforms, errors: scanned.errors },
            })
            sendJson(res, 200, { success: true, skills, added: fresh.map(r => r.id), capability })
            return
          }
          if (action === 'activate' || action === 'deactivate') {
            const id = String(body.id || '')
            const snapshot = loadRetroReview(target)
            if (!snapshot) {
              sendJson(res, 404, { success: false, error: '还没有复盘规则，先点「提炼规则」' })
              return
            }
            const skills = snapshot.skills.map((r: RetroRule) => {
              if (r.id !== id) return r
              return { ...r, status: action === 'activate' ? ('active' as const) : ('proposed' as const) }
            })
            saveRetroReview(target, { ...snapshot, skills })
            sendJson(res, 200, { success: true, skills, capability })
            return
          }
          if (action === 'export') {
            const snapshot = loadRetroReview(target)
            if (!snapshot) {
              sendJson(res, 404, { success: false, error: '还没有复盘规则，先点「提炼规则」' })
              return
            }
            const path = exportRetroRules(target, snapshot.skills, targetSpace?.name || '公司')
            const skills = snapshot.skills.map((r: RetroRule) => ({ ...r, status: 'exported' as const }))
            saveRetroReview(target, { ...snapshot, skills })
            sendJson(res, 200, { success: true, path, skills, capability })
            return
          }
          sendJson(res, 400, { success: false, error: `未知动作：${action}` })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '复盘失败' })
        }
      }),

      register('/digital-human-studio/account-monitor', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        const origin = String(req.headers.origin || '')
        if (origin) {
          res.setHeader('access-control-allow-origin', origin)
          res.setHeader('vary', 'Origin')
        }
        let spaceQuery = ''
        let accountQuery = ''
        let syncQuery = ''
        try {
          const url = new URL(String(req.url || '/'), `http://${req.headers.host || '127.0.0.1'}`)
          spaceQuery = String(url.searchParams.get('space') || '').trim()
          accountQuery = String(url.searchParams.get('account') || url.searchParams.get('binding') || '').trim()
          syncQuery = String(url.searchParams.get('sync') || '').trim()
        } catch { /* ignore */ }
        if (method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-origin': String(req.headers.origin || '*'),
            'access-control-allow-methods': 'GET, OPTIONS',
            'access-control-allow-headers': 'content-type',
            'access-control-max-age': '600',
          })
          res.end()
          return
        }
        if (method !== 'GET') {
          sendJson(res, 405, { success: false, error: 'method not allowed' })
          return
        }
        const spaceId = isSpaceId(spaceQuery) ? spaceQuery : activeSpaceId
        try {
          const mcRoot = String(config.mediaCrawlerRoot || '').trim() || defaultMcRoot()
          const payload = await accountMonitor(spaceId, accountQuery, mcRoot, {
            sync: syncQuery === '1' || syncQuery === 'true',
          })
          sendJson(res, 200, { success: true, ...payload, capability: accountMonitorCapability() })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '账号监控读取失败' })
        }
      }),

      register('/digital-human-studio/platform-media', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        let spaceQuery = ''
        try {
          const url = new URL(String(req.url || '/'), `http://${req.headers.host || '127.0.0.1'}`)
          spaceQuery = String(url.searchParams.get('space') || '').trim()
        } catch { /* ignore */ }
        const spaceId = isSpaceId(spaceQuery) ? spaceQuery : activeSpaceId
        if (method === 'GET') {
          try {
            const url = new URL(String(req.url || '/'), `http://${req.headers.host || '127.0.0.1'}`)
            const id = String(url.searchParams.get('id') || '').trim()
            if (id) {
              const task = getMcTask(spaceId, id)
              if (!task) {
                sendJson(res, 404, { success: false, error: '任务不存在' })
                return
              }
              sendJson(res, 200, { success: true, task, capability: mediacrawlerCapabilityReport(mediaCrawlerPluginConfig(config)) })
              return
            }
            sendJson(res, 200, {
              success: true,
              tasks: [...listPageMediaTasks(spaceId), ...listMcTasks(spaceId)].sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 30),
              capability: {
                ...mediacrawlerCapabilityReport(mediaCrawlerPluginConfig(config)),
                pageMedia: pageMediaCapabilityReport(),
                cdp: await probeChromeCdp(),
              },
            })
          } catch (e: any) {
            sendJson(res, 400, { success: false, error: e?.message || '查询失败' })
          }
          return
        }
        if (method !== 'POST') {
          sendJson(res, 405, { success: false, error: 'method not allowed' })
          return
        }
        if (!sameOrigin(req)) {
          sendJson(res, 403, { success: false, error: 'origin not allowed' })
          return
        }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          sendJson(res, 415, { success: false, error: 'application/json required' })
          return
        }
        try {
          const body = await readJson(req)
          const target = isSpaceId(String(body.space || '')) ? String(body.space) : spaceId
          const action = String(body.action || 'download').trim()
          if (action === 'classify') {
            try {
              const parsed = parsePlatformMediaLink(String(body.source || body.url || ''))
              sendJson(res, 200, { success: true, parsed, capability: mediacrawlerCapabilityReport(mediaCrawlerPluginConfig(config)) })
            } catch (e: any) {
              sendJson(res, 400, { success: false, error: e?.message || '无法识别链接', code: e?.code || 'classify_failed' })
            }
            return
          }
          if (action === 'cancel') {
            const task = cancelMcTask(target, String(body.id || ''))
            if (!task) {
              sendJson(res, 404, { success: false, error: '任务不存在' })
              return
            }
            sendJson(res, 200, { success: true, task, capability: mediacrawlerCapabilityReport(mediaCrawlerPluginConfig(config)) })
            return
          }
          if (action === 'keyword-search' || action === 'search') {
            const result = await runPlatformKeywordSearch({
              spaceId: target,
              platform: (String(body.platform || 'dy').trim() || 'dy') as any,
              keywords: String(body.keywords || body.keyword || body.q || '').trim(),
              maxNotes: Math.min(10, Math.max(1, Number(body.maxNotes || body.limit || 10) || 10)),
              browserMode: normalizeBrowserMode(body.browserMode ?? config.mediaCrawlerBrowserMode),
              cdpPort: normalizeCdpPort(body.cdpPort ?? config.mediaCrawlerCdpPort, 9222),
              pluginConfig: mediaCrawlerPluginConfig(config),
            })
            sendJson(res, result.success ? 200 : 400, result)
            return
          }
          const result = await runDyDownloadPreferringCdp({
            spaceId: target,
            slot: String(body.slot || 'product'),
            source: String(body.source || body.url || ''),
            pluginConfig: mediaCrawlerPluginConfig(config),
            browserMode: body.browserMode ?? config.mediaCrawlerBrowserMode,
          })
          sendJson(res, result.success ? 200 : 400, result)
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '平台媒体任务失败' })
        }
      }),

      register('/digital-human-studio/media-ingest', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        let spaceQuery = ''
        try {
          const url = new URL(String(req.url || '/'), `http://${req.headers.host || '127.0.0.1'}`)
          spaceQuery = String(url.searchParams.get('space') || '').trim()
        } catch { /* ignore */ }
        const spaceId = isSpaceId(spaceQuery) ? spaceQuery : activeSpaceId
        if (method === 'GET') {
          try {
            const url = new URL(String(req.url || '/'), `http://${req.headers.host || '127.0.0.1'}`)
            const id = String(url.searchParams.get('id') || '').trim()
            if (id) {
              const task = getIngestTask(spaceId, id)
              if (!task) {
                sendJson(res, 404, { success: false, error: '任务不存在', mediCrawlerIntegrated: false })
                return
              }
              sendJson(res, 200, { success: true, task, capability: mediCrawlerCapabilityReport() })
              return
            }
            sendJson(res, 200, {
              success: true,
              tasks: listIngestTasks(spaceId),
              capability: mediCrawlerCapabilityReport(),
            })
          } catch (e: any) {
            sendJson(res, 400, { success: false, error: e?.message || '查询失败', mediCrawlerIntegrated: false })
          }
          return
        }
        if (method !== 'POST') {
          sendJson(res, 405, { success: false, error: 'method not allowed' })
          return
        }
        if (!sameOrigin(req)) {
          sendJson(res, 403, { success: false, error: 'origin not allowed' })
          return
        }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          sendJson(res, 415, { success: false, error: 'application/json required' })
          return
        }
        try {
          const body = await readJson(req)
          const target = isSpaceId(String(body.space || '')) ? String(body.space) : spaceId
          const result = await runMediaLinkIngest({
            spaceId: target,
            slot: String(body.slot || 'product'),
            source: String(body.source || body.url || ''),
            fileName: body.fileName ? String(body.fileName) : undefined,
          })
          sendJson(res, result.success ? 200 : 400, result)
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '入库失败', mediCrawlerIntegrated: false })
        }
      }),

      register('/digital-human-studio/ping' , (_req, res) => {
        sendJson(res, 200, {
          ok: true,
          plugin: 'digital-human-studio',
          version: PLUGIN_VERSION,
          time: new Date().toISOString(),
          xiaocongcutBaseUrl: config.xiaocongcutBaseUrl,
          lastProjectFolder: config.lastProjectFolder,
          lastDraftId: config.lastDraftId,
          spaceId: activeSpaceId,
          spaceName: currentSpace(spaceStore).name,
          enginePid: config.enginePid,
          tools: [
            'dh_auth_status', 'dh_auth_probe',
            'dh_get_workspace',
            'dh_get_brief',
            'dh_list_materials',
            'dh_ingest_local_folder',
            'dh_label_materials',
            'dh_ingest_media_link',
            'dh_media_ingest_status',
            'dh_mediacrawler_capability',
            'dh_platform_media_capability',
            'dh_platform_media_download',
            'dh_platform_media_status',
            'dh_platform_keyword_search',
            'dh_comment_wordcloud',
            'dh_platform_media_cancel',
            'dh_update_brief',
            'dh_list_drafts',
            'dh_load_draft',
            'dh_create_draft',
            'dh_add_video',
            'dh_add_audio',
            'dh_list_voices',
            'dh_set_voice',
            'dh_clone_voice',
            'dh_add_narration',
            'dh_list_music',
            'dh_find_music',
            'dh_set_music',
            'dh_add_music',
            'dh_save_draft',
            'dh_export_draft',
            'dh_export_status',
            'dh_own_text_add',
            'dh_own_text_update',
            'dh_own_text_list',
            'dh_own_text_export',
            'dh_engine_status',
            'dh_engine_start',
            'dh_engine_stop',
          ],
        })
      }),

      // 字体清单：以随包清单为准（35 款全列出来），已装/未装分别标 installed。
      // 未装的点「下载」才把文件放进 fonts/（引擎 libass 的 fontsdir 就是这个目录）。
      register('/digital-human-studio/fonts', async (_req, res) => {
        try {
          const root = resolveActiveEngineRoot(config)
          const dir = join(root, 'fonts')
          const manifestPath = join(root, 'fonts-manifest.json')
          let manifest: any = null
          if (existsSync(manifestPath)) {
            try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { manifest = null }
          }
          if (!manifest || !Array.isArray(manifest.fonts) || !manifest.fonts.length) {
            // 没有清单就退回引擎直查（兼容没做过按需改造的包）
            const r = await vcFetch('/xcy/fonts', undefined, 'GET')
            sendJson(res, 200, r)
            return
          }
          const list = manifest.fonts.map((f: any) => {
            const file = String(f.file || '')
            const hit = file ? join(dir, file) : ''
            const installed = !!hit && existsSync(hit)
            return {
              family: f.family, kind: f.kind, label: f.label, weight: f.weight,
              file, size: typeof f.size === 'number' ? f.size : undefined,
              installed, path: installed ? hit : undefined,
            }
          })
          sendJson(res, 200, {
            success: true,
            fonts: list,
            installedCount: list.filter((x: any) => x.installed).length,
            total: list.length,
          })
        } catch (e: any) {
          sendJson(res, 502, { success: false, error: e?.message || '字体清单读不到' })
        }
      }),

      register('/digital-human-studio/fonts/install', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        if (!sameOrigin(req)) {
          sendJson(res, 403, { success: false, error: 'origin not allowed' })
          return
        }
        try {
          const body = await readJson(req).catch(() => ({}))
          const file = basename(String((body as any)?.file || ''))
          const root = resolveActiveEngineRoot(config)
          const dir = join(root, 'fonts')
          const manifestPath = join(root, 'fonts-manifest.json')
          let allowed: string[] = []
          try {
            const m: any = JSON.parse(readFileSync(manifestPath, 'utf8'))
            allowed = (m.fonts || []).map((f: any) => String(f.file || ''))
          } catch { /* 没清单就不放行 */ }
          if (!file || !allowed.includes(file)) {
            sendJson(res, 400, { success: false, error: '字体清单里没有这一款' })
            return
          }
          const dest = join(dir, file)
          if (existsSync(dest)) {
            sendJson(res, 200, { success: true, file, detail: 'already-installed', size: statSync(dest).size })
            return
          }
          // 源：环境变量（目录或 http 基址）> 插件 font-pack > 用户目录 font-pack > 旧 XiaocongcutAPI
          let lastCdnError = ''
          const sources = [
            String(process.env.XC_FONT_SOURCE || '').trim(),
            join(root, 'font-pack'),
            join(homedir(), '.dsh', 'font-pack'),
            join(BUNDLED_XIAOCONGCUT_ROOT, 'fonts'),
          ].filter(Boolean)
          for (const src of sources) {
            if (/^https?:/i.test(src)) {
              try {
                const url = src.replace(/\/+$/, '') + '/' + encodeURIComponent(file)
                const resp = await fetch(url)
                if (resp.ok) {
                  const buf = Buffer.from(await resp.arrayBuffer())
                  mkdirSync(dir, { recursive: true })
                  writeFileSync(dest, buf)
                  sendJson(res, 200, { success: true, file, size: buf.length, source: url })
                  return
                }
              } catch { /* 换下一个源 */ }
              continue
            }
            const p = join(src, file)
            if (existsSync(p)) {
              mkdirSync(dir, { recursive: true })
              copyFileSync(p, dest)
              sendJson(res, 200, { success: true, file, size: statSync(dest).size, source: p })
              return
            }
          }
          // 云端分片源：fonts-cdn.json 记录每款字体的分片地址（七牛单次上传有 8MB 上限，故切片上传、下载后拼接）
          // 客户机没带 font-pack 时走这里，点一下直接从云端拉
          const cdnPath = join(root, 'fonts-cdn.json')
          if (existsSync(cdnPath)) {
            try {
              const cdn: any = JSON.parse(readFileSync(cdnPath, 'utf8'))
              const rec = cdn && cdn[file]
              if (rec && Array.isArray(rec.parts) && rec.parts.length) {
                const bufs: Buffer[] = []
                for (const u of rec.parts) {
                  const resp = await fetch(String(u))
                  if (!resp.ok) throw new Error(`分片下载失败 HTTP ${resp.status}`)
                  bufs.push(Buffer.from(await resp.arrayBuffer()))
                }
                const buf = Buffer.concat(bufs)
                if (rec.size && buf.length !== Number(rec.size)) throw new Error(`拼接大小不符 ${buf.length} != ${rec.size}`)
                if (rec.sha256) {
                  const h = createHash('sha256').update(buf).digest('hex')
                  if (h !== String(rec.sha256)) throw new Error('sha256 校验不一致，分片可能损坏')
                }
                mkdirSync(dir, { recursive: true })
                writeFileSync(dest, buf)
                sendJson(res, 200, {
                  success: true, file, size: buf.length,
                  source: `cdn:${rec.parts.length}片`,
                  sha256: rec.sha256 || undefined,
                })
                return
              }
            } catch (e: any) {
              // 云端取不到时继续冲突其它源；下面 404 会带上原因
              lastCdnError = e?.message || String(e)
            }
          }
          sendJson(res, 404, {
            success: false,
            error: lastCdnError
              ? `云端下载失败：${lastCdnError}`
              : '找不到字体源：把 font-pack 目录放到产品同级，或设 XC_FONT_SOURCE 指向字体包目录 / 下载地址',
          })
        } catch (e: any) {
          sendJson(res, 500, { success: false, error: e?.message || '字体下载失败' })
        }
      }),

      register('/digital-human-studio/matte_webm', async (req, res) => {
        // 预览实时抠像分层：src → 引擎抠像转 vp9 alpha webm（缓存），返回前端可播的代理地址。
        // ws.register 是 exact 全串匹配（含 query），所以文件路由按 name 动态注册固定路径。
        try {
          const body = (await readJson(req)) || {}
          const r = await vcFetch('/xcy/matte_webm', body, 'POST')
          if (!r.ok || r.status === 0) {
            sendJson(res, 502, { ok: false, error: r.error || '引擎不可用' })
            return
          }
          const d = (r.data && typeof r.data === 'object') ? r.data : {}
          const name = String(d.name || '')
          const filePath = `/digital-human-studio/matte_file/${name}`
          if (name && !matteFileRegistered.has(filePath)) {
            matteFileRegistered.add(filePath)
            register(filePath, async (_req2, res2) => {
              try {
                const resp = await fetch(`${config.xiaocongcutBaseUrl}/xcy/matte_file/${name}`)
                if (!resp.ok) {
                  sendJson(res2, resp.status, { error: 'matte file missing' })
                  return
                }
                const buf = Buffer.from(await resp.arrayBuffer())
                res2.writeHead(200, {
                  'Content-Type': 'video/webm',
                  'Content-Length': buf.length,
                  'Cache-Control': 'private, max-age=86400',
                })
                res2.end(buf)
              } catch (e: any) {
                sendJson(res2, 502, { error: e?.message || 'matte file fetch failed' })
              }
            })
          }
          sendJson(res, 200, { ok: true, name, url: filePath })
        } catch (e: any) {
          sendJson(res, 502, { ok: false, error: e?.message || '抠像接口不可用' })
        }
      }),

      register('/digital-human-studio/config', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        if (method === 'GET') {
          sendJson(res, 200, { success: true, config: publicConfig() })
          return
        }
        if (method === 'POST') {
          const body = await readJson(req)
          const nextUrl = String(body.xiaocongcutBaseUrl || config.xiaocongcutBaseUrl).trim().replace(/\/$/, '')
          if (!/^https?:\/\//i.test(nextUrl)) {
            sendJson(res, 400, { success: false, error: 'xiaocongcutBaseUrl must be http(s) URL' })
            return
          }
          const folder =
            body.lastProjectFolder != null
              ? expandPath(String(body.lastProjectFolder))
              : config.lastProjectFolder
          const root =
            body.xiaocongcutRoot != null ? expandPath(String(body.xiaocongcutRoot)) : config.xiaocongcutRoot
          const mcRoot =
            body.mediaCrawlerRoot != null
              ? expandPath(String(body.mediaCrawlerRoot))
              : config.mediaCrawlerRoot
          const mcPython =
            body.mediaCrawlerPython != null
              ? expandPath(String(body.mediaCrawlerPython))
              : config.mediaCrawlerPython
          const mcTimeout =
            body.mediaCrawlerTimeoutMs != null
              ? Math.max(30000, Math.min(30 * 60_000, Number(body.mediaCrawlerTimeoutMs) || config.mediaCrawlerTimeoutMs))
              : config.mediaCrawlerTimeoutMs
          const mcEnabled =
            body.mediaCrawlerEnabled != null ? body.mediaCrawlerEnabled === true || body.mediaCrawlerEnabled === 'true' : config.mediaCrawlerEnabled
          const mcBrowserMode =
            body.mediaCrawlerBrowserMode != null
              ? normalizeBrowserMode(body.mediaCrawlerBrowserMode)
              : normalizeBrowserMode(config.mediaCrawlerBrowserMode)
          const mcCdpPort =
            body.mediaCrawlerCdpPort != null
              ? normalizeCdpPort(body.mediaCrawlerCdpPort, 9222)
              : normalizeCdpPort(config.mediaCrawlerCdpPort, 9222)
          saveWorkspaceConfig({
            ...config,
            xiaocongcutBaseUrl: nextUrl,
            xiaocongcutRoot: root,
            lastProjectFolder: folder,
            lastDraftId:
              body.lastDraftId != null ? String(body.lastDraftId) : config.lastDraftId,
            lastDraftPath:
              body.lastDraftPath != null
                ? expandPath(String(body.lastDraftPath))
                : config.lastDraftPath,
            enginePid: config.enginePid,
            mediaCrawlerRoot: mcRoot,
            mediaCrawlerPython: mcPython,
            mediaCrawlerTimeoutMs: mcTimeout,
            mediaCrawlerEnabled: mcEnabled,
            mediaCrawlerBrowserMode: mcBrowserMode,
            mediaCrawlerCdpPort: mcCdpPort,
          })
          sendJson(res, 200, { success: true, config: publicConfig(), ...publicSpaces(spaceStore) })
          return
        }
        sendJson(res, 405, { success: false, error: 'method not allowed' })
      }),

      register('/digital-human-studio/workspace', (_req, res) => {
        sendJson(res, 200, getWorkspace())
      }),

      register('/digital-human-studio/status', async (_req, res) => {
        sendJson(res, 200, await getStatus())
      }),

      register('/digital-human-studio/engine_start', async (_req, res) => {
        const body = await engineStart()
        sendJson(res, httpStatusFor(body), body)
      }),

      // 内核守护状态：界面问「引擎还活着吗、被自动拉过几次、是不是已经放弃」
      register('/digital-human-studio/engine/guard', async (_req, res) => {
        // 前端会隔十几秒来问一次，太勤会把守护节奏催快：8 秒内直接给缓存
        const g = Date.now() - kernelGuard.checkedAt < 8000 ? kernelGuard : await guardTick()
        sendJson(res, 200, {
          success: true,
          ...g,
          managedPid: config.enginePid,
          baseUrl: config.xiaocongcutBaseUrl,
          maxRestarts: GUARD_MAX_RESTARTS,
          killedWithStudio: true,
        })
      }),

      // 人工重试：把失败计数清零后再拉一次，给界面上的「重试」按钮用
      register('/digital-human-studio/engine/guard/retry', async (_req, res) => {
        kernelGuard.failed = false
        kernelGuard.restarts = 0
        kernelGuard.lastError = ''
        const g = await guardTick()
        if (kernelGuard.online) { kernelGuard.restarts = 0; kernelGuard.lastError = '' }
        sendJson(res, 200, { success: !!(g as any).online, ...kernelGuard })
      }),

      register('/digital-human-studio/engine_stop', async (_req, res) => {
        const body = await engineStop()
        sendJson(res, httpStatusFor(body), body)
      }),

      // 只看不动：告诉界面缺什么，装不装由人决定。
      register('/digital-human-studio/engine/doctor', async (_req, res) => {
        const root = resolveActiveEngineRoot(config)
        const probe = await probeOnline()
        sendJson(res, 200, {
          success: true,
          online: probe.online,
          baseUrl: config.xiaocongcutBaseUrl,
          ...diagnoseEngine(root),
        })
      }),

      // 装引擎：客户点一次，缺代码就 clone、缺环境就建 venv、缺依赖就 pip install。
      register('/digital-human-studio/engine/install', async (req, res) => {
        const body = await readJson(req).catch(() => ({}))
        if ((body as any)?.confirm !== true) {
          sendJson(res, 400, { success: false, error: '安装引擎需要在界面上点确认' })
          return
        }
        const root = resolveActiveEngineRoot(config)
        const result = await installEngine(root, XIAOCONGCUT_LOG)
        sendJson(res, result.success ? 200 : 500, result)
      }),

      // 「主页」用：结构化能力清单。脚本生成到 dist/capabilities.json（随包发布），
      // 花字与音效每次现读，所以改了样式表或音效库不重新生成也是新的。
      register('/digital-human-studio/capabilities', async (_req, res) => {
        const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
        let styles: Array<{ id: string; label: string; note: string; calls: string[] }> = []
        let sfx: Array<{ id: string; use: string; dur: number; gain: number }> = []
        try {
          const live = listLocalTextStyles()
          styles = (live.styles || []).map((s: any) => ({
            id: String(s.id), label: String(s.label || s.id), note: String(s.note || ''), calls: [],
          }))
        } catch {
          // 缺 Python 时花字留空，其余照常返回
          void 0
        }
        try {
          sfx = sfxCatalogForAgent()
        } catch {
          void 0
        }
        sendJson(res, 200, buildCapabilities(pluginRoot, registeredTools, styles, sfx))
      }),

      // ── 配方渲染：配方进、mp4 出，不经过剪映 ──
      register('/digital-human-studio/recipes', async (_req, res) => {
        const dir = join(BUNDLED_XIAOCONGCUT_ROOT, 'recipes')
        const items: Array<{ name: string; path: string; updated: string; error?: string }> = []
        try {
          for (const file of readdirSync(dir)) {
            if (!file.endsWith('.json')) continue
            const full = join(dir, file)
            let title = file.replace(/\.json$/, '')
            try {
              const raw = JSON.parse(readFileSync(full, 'utf8'))
              title = String(raw?.name || title)
            } catch {
              title = `${title}（JSON 有问题）`
            }
            items.push({ name: title, path: full, updated: statSync(full).mtime.toISOString() })
          }
        } catch (error) {
          sendJson(res, 200, { success: false, dir, items, error: String((error as Error)?.message || error) })
          return
        }
        sendJson(res, 200, { success: true, dir, items })
      }),

      register('/digital-human-studio/projects', (_req, res) => {
        const items: Array<{ id: string; name: string; path: string; updated: string; error?: string }> = []
        try {
          for (const file of readdirSync(recipesDir)) {
            if (!file.endsWith('.json') || file.startsWith('.')) continue
            const full = join(recipesDir, file)
            let title = projectIdOf(file)
            let error: string | undefined
            try {
              const raw = JSON.parse(readFileSync(full, 'utf8'))
              title = String(raw?.name || title)
            } catch {
              error = 'JSON 有问题'
            }
            items.push({
              id: projectIdOf(file), name: title, path: full,
              updated: statSync(full).mtime.toISOString(),
              ...(error ? { error } : {}),
            })
          }
        } catch (error) {
          sendJson(res, 200, {
            success: false, dir: recipesDir, items,
            error: String((error as Error)?.message || error),
          })
          return
        }
        items.sort((a, b) => b.updated.localeCompare(a.updated))
        sendJson(res, 200, { success: true, dir: recipesDir, items })
      }),

      register('/digital-human-studio/project', async (req, res) => {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        const idParam = url.searchParams.get('id') || ''
        const pathParam = url.searchParams.get('path') || ''
        const target = pathParam
          ? expandPath(pathParam)
          : (safeProjectPath(idParam) || '')
        if (!target) {
          sendJson(res, 400, { success: false, error: '缺 id 或 path' })
          return
        }
        if (!existsSync(target)) {
          sendJson(res, 404, { success: false, error: `工程不存在：${target}` })
          return
        }
        let recipe: any
        try {
          recipe = JSON.parse(readFileSync(target, 'utf8'))
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: `JSON 读不了：${e?.message || e}` })
          return
        }
        // 老配方里字体可能是作者本机的绝对路径，统一重定向到随包字体
        recipe = normalizeRecipeFonts(recipe)
        // 时间计算交给引擎，前端只显示——避免界面 6 秒、成片 5.9 秒
        const norm = await vcFetch('/xcy/recipe_normalize', {
          recipe,
          base_dir: dirname(target),
        })
        if (!norm.ok || !norm.data?.recipe) {
          sendJson(res, 502, {
            success: false,
            error: norm.data?.error || norm.error || '规整失败',
          })
          return
        }
        const refs = collectMediaRefs(norm.data.recipe)
        sendJson(res, 200, {
          success: true,
          id: basename(target, '.json'),
          path: target,
          name: String(norm.data.recipe.name || projectIdOf(target)),
          recipe: norm.data.recipe,
          timeline: norm.data.timeline || null,
          warnings: norm.data.warnings || [],
          duration: norm.data.duration,
          missing: refs.filter((r) => !r.exists).map((r) => r.from),
          updated: statSync(target).mtime.toISOString(),
        })
      }),

      register('/digital-human-studio/project/save', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const id = String((body as any)?.id || '').trim()
        const pathIn = String((body as any)?.path || '').trim()
        const recipe = (body as any)?.recipe
        if (!recipe || typeof recipe !== 'object') {
          sendJson(res, 400, { success: false, error: '缺 recipe' })
          return
        }
        const target = pathIn ? expandPath(pathIn) : (safeProjectPath(id) || '')
        if (!target || !target.endsWith('.json')) {
          sendJson(res, 400, { success: false, error: '工程 id 或 path 不合法' })
          return
        }
        const pid = basename(target, '.json')
        let previous: string | null = null
        if (existsSync(target)) {
          try {
            previous = readFileSync(target, 'utf8')
          } catch {
            previous = null
          }
        }
        const stamp = snapshotProject(pid, previous ?? '{}')
        const payload = JSON.stringify(
          {
            ...recipe,
            id: recipe.id || pid,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        )
        const tmp = `${target}.tmp-${randomBytes(4).toString('hex')}`
        try {
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(tmp, payload, 'utf8')
          renameSync(tmp, target)
        } catch (e: any) {
          try {
            unlinkSync(tmp)
          } catch {
            /* ignore */
          }
          sendJson(res, 500, { success: false, error: `保存失败：${e?.message || e}` })
          return
        }
        sendJson(res, 200, {
          success: true,
          id: pid,
          path: target,
          savedAt: new Date().toISOString(),
          snapshot: stamp,
        })
      }),

      // 缺失素材检测
      register('/digital-human-studio/project/missing', (req, res) => {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        const id = url.searchParams.get('id') || ''
        const target = safeProjectPath(id)
        if (!target || !existsSync(target)) {
          sendJson(res, 404, { success: false, error: '工程不存在' })
          return
        }
        let recipe: any = null
        try {
          recipe = JSON.parse(readFileSync(target, 'utf8'))
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: `JSON 读不了：${e?.message || e}` })
          return
        }
        const refs = collectMediaRefs(recipe)
        sendJson(res, 200, {
          success: true,
          id,
          total: refs.length,
          missing: refs.filter((r) => !r.exists).map((r) => r.from),
        })
      }),

      // 重连素材：默认按同名文件在常见目录里找回，也支持手动映射
      register('/digital-human-studio/project/relink', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const id = String((body as any)?.id || '').trim()
        const auto = (body as any)?.auto !== false
        const mapping: Array<{ from: string; to: string }> =
          Array.isArray((body as any)?.mapping) ? (body as any).mapping : []
        const target = safeProjectPath(id)
        if (!target || !existsSync(target)) {
          sendJson(res, 404, { success: false, error: '工程不存在' })
          return
        }
        let recipe: any = null
        try {
          recipe = JSON.parse(readFileSync(target, 'utf8'))
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: `JSON 读不了：${e?.message || e}` })
          return
        }
        const refs = collectMediaRefs(recipe)
        const map = new Map<string, string>()
        const resolved: Array<{ from: string; to: string; by: string }> = []
        for (const r of refs) {
          if (r.exists) continue
          const manual = mapping.find((m) => m && m.from === r.from && m.to)
          let to = manual ? expandPath(String(manual.to)) : ''
          let by = 'manual'
          if (!to && auto) {
            to = findSameName(r.from)
            by = 'auto'
          }
          if (to && existsSync(to)) {
            map.set(r.from, to)
            resolved.push({ from: r.from, to, by })
          }
        }
        if (!resolved.length) {
          sendJson(res, 200, { success: true, id, resolved: [], stillMissing: refs.filter((r) => !r.exists).map((r) => r.from) })
          return
        }
        const next = applyMediaMap(recipe, map, 0)
        const previous = readFileSync(target, 'utf8')
        snapshotProject(id, previous)
        const payload = JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2)
        try {
          writeFileSync(target, payload, 'utf8')
        } catch (e: any) {
          sendJson(res, 500, { success: false, error: `写回失败：${e?.message || e}` })
          return
        }
        const after = collectMediaRefs(next)
        sendJson(res, 200, {
          success: true,
          id,
          resolved,
          stillMissing: after.filter((r) => !r.exists).map((r) => r.from),
        })
      }),

      // 另存为：把当前工程复制成一个新工程（不动原文件）
      // ---------- 工程模板 / 一键套片 ----------
      register('/digital-human-studio/templates', async (req, res) => {
        const dir = templateDir()
        const items: any[] = []
        try {
          mkdirSync(dir, { recursive: true })
          for (const f of readdirSync(dir)) {
            if (!f.endsWith('.json')) continue
            try {
              const j = JSON.parse(readFileSync(join(dir, f), 'utf8'))
              items.push({
                slug: basename(f, '.json'),
                name: String(j.name || basename(f, '.json')),
                slots: Number(j.slots) || 0,
                duration: Math.round(Number(j.duration) || 0),
                createdAt: String(j.createdAt || ''),
                from: String(j.from || ''),
              })
            } catch {
              /* 跳过坏文件 */
            }
          }
        } catch {
          /* 目录不存在就是空 */
        }
        items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        sendJson(res, 200, { success: true, dir, items })
      }),

      register('/digital-human-studio/templates/save', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body: any = await readJson(req).catch(() => ({}))
        const name = String(body?.name || '').trim()
        const recipeIn = body?.recipe
        if (!name) {
          sendJson(res, 400, { success: false, error: '缺模板名' })
          return
        }
        if (!recipeIn || typeof recipeIn !== 'object') {
          sendJson(res, 400, { success: false, error: '缺 recipe' })
          return
        }
        const recipe: any = JSON.parse(JSON.stringify(recipeIn))
        const clips: any[] = Array.isArray(recipe.clips) ? recipe.clips : []
        for (const c of clips) {
          delete c.source
          delete c.path
        }
        const overlays: any[] = Array.isArray(recipe.overlays) ? recipe.overlays : []
        for (const o of overlays) {
          // fixed 层是模板自带的装饰（标题条/箭头卡图），套片时不该被素材顶掉
          if ((o as any)?.fixed) continue
          delete o.source
        }
        const duration = clips.reduce((acc: number, c: any) => {
          const st = Number(c?.start) || 0
          const en = Number(c?.end) || 0
          const sp = Number(c?.speed) || 1
          const d = Number(c?.duration) || (en > st ? (en - st) / (sp || 1) : 0)
          return acc + d
        }, 0)
        const meta = {
          name,
          slots: clips.length,
          duration: Math.round(duration * 10) / 10,
          createdAt: new Date().toISOString(),
          from: String(body?.from || ''),
          recipe,
        }
        try {
          mkdirSync(templateDir(), { recursive: true })
          const file = join(templateDir(), `${templateSlug(name)}.json`)
          writeFileSync(file, JSON.stringify(meta, null, 2), 'utf8')
          sendJson(res, 200, { success: true, slug: basename(file, '.json'), name, slots: clips.length, duration: meta.duration })
        } catch (err: any) {
          sendJson(res, 500, { success: false, error: String(err?.message || err) })
        }
      }),

      register('/digital-human-studio/templates/apply', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body: any = await readJson(req).catch(() => ({}))
        const slug = String(body?.slug || '').trim()
        if (!slug || /[\\/]/.test(slug)) {
          sendJson(res, 400, { success: false, error: '模板 slug 不合法' })
          return
        }
        const file = join(templateDir(), `${slug}.json`)
        if (!existsSync(file)) {
          sendJson(res, 404, { success: false, error: '模板不存在' })
          return
        }
        const tpl: any = JSON.parse(readFileSync(file, 'utf8'))
        const sources = Array.isArray(body?.sources)
          ? (body.sources as any[]).map((x) => String(x || '').trim()).filter(Boolean)
          : []
        if (!sources.length) {
          sendJson(res, 400, { success: false, error: '至少给一条素材路径' })
          return
        }
        const missing = sources.filter((x) => !existsSync(x))
        if (missing.length) {
          sendJson(res, 400, { success: false, error: `素材不存在：${missing[0]}` })
          return
        }
        const recipe: any = JSON.parse(JSON.stringify(tpl.recipe || {}))
        const clips: any[] = Array.isArray(recipe.clips) ? recipe.clips : []
        clips.forEach((c: any, i: number) => {
          c.source = sources[i % sources.length]
        })
        const overlays: any[] = Array.isArray(recipe.overlays) ? recipe.overlays : []
        overlays.forEach((o: any, i: number) => {
          if (o?.fixed) return
          o.source = sources[i % sources.length]
        })
        const pid = String(body?.id || '').trim() || `${slug}-套片-${Date.now().toString(36)}`
        const target = safeProjectPath(pid)
        if (!target) {
          sendJson(res, 400, { success: false, error: '工程 id 不合法' })
          return
        }
        recipe.id = pid
        recipe.name = `${String(tpl.name || slug)} · 套片`
        recipe.template = slug
        recipe.updatedAt = new Date().toISOString()
        try {
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, JSON.stringify(recipe, null, 2), 'utf8')
          sendJson(res, 200, {
            success: true,
            id: pid,
            path: target,
            clips: clips.length,
            overlays: overlays.length,
            sources: sources.length,
            markers: Array.isArray(recipe.markers) ? recipe.markers.length : 0,
          })
        } catch (err: any) {
          sendJson(res, 500, { success: false, error: String(err?.message || err) })
        }
      }),

      register('/digital-human-studio/project/saveas', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const id = String((body as any)?.id || '').trim()
        const name = String((body as any)?.name || '').trim()
        if (!name || name.length > 60) {
          sendJson(res, 400, { success: false, error: '新工程名不合法' })
          return
        }
        const target = safeProjectPath(id)
        if (!target || !existsSync(target)) {
          sendJson(res, 404, { success: false, error: '原工程不存在' })
          return
        }
        const newId = name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
        if (!newId) {
          sendJson(res, 400, { success: false, error: '新工程名不合法' })
          return
        }
        const dest = join(recipesDir, `${newId}.json`)
        if (existsSync(dest)) {
          sendJson(res, 409, { success: false, error: '同名工程已存在' })
          return
        }
        let recipe: any = null
        try {
          recipe = JSON.parse(readFileSync(target, 'utf8'))
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: `JSON 读不了：${e?.message || e}` })
          return
        }
        const payload = JSON.stringify({ ...recipe, id: newId, name, updatedAt: new Date().toISOString() }, null, 2)
        try {
          writeFileSync(dest, payload, 'utf8')
        } catch (e: any) {
          sendJson(res, 500, { success: false, error: `另存失败：${e?.message || e}` })
          return
        }
        sendJson(res, 200, { success: true, id: newId, path: dest, from: id })
      }),

      register('/digital-human-studio/project/history', (req, res) => {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        const id = url.searchParams.get('id') || ''
        if (!id || /[\\/]/.test(id)) {
          sendJson(res, 400, { success: false, error: 'id 不合法' })
          return
        }
        const dir = join(historyDir, id)
        const items: Array<{ version: string; size: number; updated: string }> = []
        try {
          for (const file of readdirSync(dir)) {
            if (!file.endsWith('.json')) continue
            const full = join(dir, file)
            items.push({
              version: file.replace(/\.json$/, ''),
              size: statSync(full).size,
              updated: statSync(full).mtime.toISOString(),
            })
          }
        } catch {
          /* 没历史就是空列表 */
        }
        items.sort((a, b) => b.version.localeCompare(a.version))
        sendJson(res, 200, { success: true, id, items })
      }),

      register('/digital-human-studio/project/restore', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const id = String((body as any)?.id || '')
        const version = String((body as any)?.version || '')
        if (!id || /[\\/]/.test(id) || !version || /[\\/]/.test(version)) {
          sendJson(res, 400, { success: false, error: 'id/version 不合法' })
          return
        }
        const target = safeProjectPath(id)
        const from = join(historyDir, id, `${version}.json`)
        if (!target || !existsSync(from)) {
          sendJson(res, 404, { success: false, error: '版本不存在' })
          return
        }
        try {
          if (existsSync(target)) snapshotProject(id, readFileSync(target, 'utf8'))
          writeFileSync(target, readFileSync(from, 'utf8'), 'utf8')
        } catch (e: any) {
          sendJson(res, 500, { success: false, error: `回滚失败：${e?.message || e}` })
          return
        }
        sendJson(res, 200, { success: true, id, version, path: target })
      }),

      // 带 Range 的媒体流：<video> 能任意拖动靠它（206 + Content-Range）
      register('/digital-human-studio/media', async (req, res) => {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        const raw = url.searchParams.get('path') || ''
        const target = expandPath(raw)
        const mimeByExt: Record<string, string> = {
          '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
          '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
          '.aac': 'audio/aac', '.aiff': 'audio/aiff', '.flac': 'audio/flac',
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.otf': 'font/otf', '.ttf': 'font/ttf',
        }
        const ext = extname(target).toLowerCase()
        const mime = mimeByExt[ext]
        if (!target || !mime) {
          sendJson(res, 400, { success: false, error: '只支持常见音视频/图片' })
          return
        }
        if (!existsSync(target)) {
          sendJson(res, 404, { success: false, error: `文件不存在：${target}` })
          return
        }
        const size = statSync(target).size
        const range = String((req.headers as any)?.range || '')
        const { createReadStream } = await import('node:fs')
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range)
          const start = m && m[1] ? Number(m[1]) : 0
          const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
          if (start >= size || start > end) {
            res.writeHead(416, { 'content-range': `bytes */${size}` })
            res.end()
            return
          }
          res.writeHead(206, {
            'content-type': mime,
            'content-length': String(end - start + 1),
            'content-range': `bytes ${start}-${end}/${size}`,
            'accept-ranges': 'bytes',
            'cache-control': 'no-store',
          })
          const stream = createReadStream(target, { start, end })
          stream.on('error', () => res.destroy())
          stream.pipe(res)
          return
        }
        res.writeHead(200, {
          'content-type': mime,
          'content-length': String(size),
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
        })
        const stream = createReadStream(target)
        stream.on('error', () => res.destroy())
        stream.pipe(res)
      }),

      register('/digital-human-studio/font_file', async (req, res) => {
        // 预览字体对齐：传字体文件绝对路径 → 动态注册固定路径并返回 {ok,url,family}
        // （ws.register 是 exact 全串匹配，带 query/编码路径不可靠，故按 basename 注册固定路径）
        try {
          const body = (await readJson(req)) || {}
          const path = String(body.path || '').trim()
          if (!path || !existsSync(path) || !/\.(otf|ttf|ttc)$/i.test(path)) {
            sendJson(res, 404, { ok: false, error: '字体文件不存在' })
            return
          }
          const base = basename(path).replace(/\.(otf|ttf|ttc)$/i, '')
          const safe = base.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'font'
          const filePath = `/digital-human-studio/font_file/${safe}`
          if (!fontFileRegistered.has(filePath)) {
            fontFileRegistered.add(filePath)
            register(filePath, async (_req2, res2) => {
              try {
                const size = statSync(path).size
                const ext = extname(path).toLowerCase()
                const mime = ext === '.ttc' ? 'font/collection' : (ext === '.ttf' ? 'font/ttf' : 'font/otf')
                const { createReadStream } = await import('node:fs')
                res2.writeHead(200, {
                  'Content-Type': mime,
                  'Content-Length': size,
                  'Cache-Control': 'private, max-age=86400',
                })
                const stream = createReadStream(path)
                stream.on('error', () => res2.destroy())
                stream.pipe(res2)
              } catch (e: any) {
                sendJson(res2, 502, { error: e?.message || 'font file fetch failed' })
              }
            })
          }
          sendJson(res, 200, { ok: true, url: filePath, family: base })
        } catch (e: any) {
          sendJson(res, 502, { ok: false, error: e?.message || '字体端点不可用' })
        }
      }),

      // V1 时间线胶片带：在 [start,end] 内均匀抽 n 帧，横向 tile 拼成一张雪碧图
      register('/digital-human-studio/media/filmstrip', async (req, res) => {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        const raw = url.searchParams.get('path') || ''
        const start = Math.max(0, Number(url.searchParams.get('start') || 0) || 0)
        const end = Math.max(start + 0.05, Number(url.searchParams.get('end') || 0) || start + 1)
        let n = Math.max(1, Math.min(24, Math.round(Number(url.searchParams.get('n') || 6) || 6)))
        const height = Math.max(24, Math.min(120, Math.round(Number(url.searchParams.get('h') || 48) || 48)))
        const frameW = Math.max(0, Math.min(600, Math.round(Number(url.searchParams.get('w') || 0) || 0)))
        const totalW = Math.max(0, Math.min(1600, Math.round(Number(url.searchParams.get('total') || 0) || 0)))
        const target = expandPath(raw)
        if (!target || !existsSync(target)) {
          sendJson(res, 404, { success: false, error: `文件不存在：${target}` })
          return
        }
        // 按容器总宽 + 素材原始宽高比推导帧数，让雪碧图宽度≈片段宽度，避免拉伸
        if (totalW > 0 && frameW === 0) {
          const { width: sw, height: sh } = probeMediaSize(target)
          const aspect = sw && sh ? sw / sh : 0
          const guess = Math.max(8, Math.round(height * (aspect || 0.8)))
          n = Math.max(1, Math.min(30, Math.round(totalW / guess)))
        }
        const { createHash } = await import('node:crypto')
        const key = createHash('sha1').update(`${target}|${start}|${end}|${n}|${height}|${frameW}|${totalW}`).digest('hex').slice(0, 20)
        const cacheDir = join(homedir(), '.xiaocongcut', 'cache', 'filmstrips')
        const out = join(cacheDir, `${key}.jpg`)
        if (!existsSync(out) || statSync(out).size < 32) {
          const ffmpeg = resolveFfmpeg()
          if (!ffmpeg) {
            sendJson(res, 503, { success: false, error: '找不到 ffmpeg' })
            return
          }
          mkdirSync(cacheDir, { recursive: true })
          const dur = Math.max(0.05, end - start)
          const fps = Math.max(0.02, n / dur)
          const vf = frameW > 0
            ? `fps=${fps.toFixed(4)},scale=${frameW}:${height}:force_original_aspect_ratio=decrease,pad=${frameW}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x14171c,tile=${n}x1`
            : `fps=${fps.toFixed(4)},scale=-2:${height},tile=${n}x1`
          try {
            execFileSync(ffmpeg, ['-y', '-ss', String(start), '-i', target, '-t', String(dur), '-vf', vf, '-frames:v', '1', '-q:v', '4', out], {
              timeout: 30_000,
              stdio: 'ignore',
            })
          } catch { /* 失败走 404 */ }
        }
        if (!existsSync(out)) {
          sendJson(res, 404, { success: false, error: '胶片带生成失败' })
          return
        }
        const { createReadStream } = await import('node:fs')
        res.writeHead(200, {
          'content-type': 'image/jpeg',
          'content-length': String(statSync(out).size),
          'cache-control': 'max-age=86400',
        })
        createReadStream(out).on('error', () => res.destroy()).pipe(res)
      }),

      register('/digital-human-studio/media/thumb', async (req, res) => {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        const raw = url.searchParams.get('path') || ''
        const at = Math.max(0, Number(url.searchParams.get('t') || 0.3) || 0.3)
        const target = expandPath(raw)
        if (!target || !existsSync(target)) {
          sendJson(res, 404, { success: false, error: `文件不存在：${target}` })
          return
        }
        const { createHash } = await import('node:crypto')
        const key = createHash('sha1').update(`${target}|${at}`).digest('hex').slice(0, 20)
        const cacheDir = join(homedir(), '.xiaocongcut', 'cache', 'thumbs')
        const out = join(cacheDir, `${key}.jpg`)
        if (!existsSync(out) || statSync(out).size < 32) {
          const ffmpeg = resolveFfmpeg()
          if (!ffmpeg) {
            sendJson(res, 503, { success: false, error: '找不到 ffmpeg' })
            return
          }
          mkdirSync(cacheDir, { recursive: true })
          try {
            execFileSync(ffmpeg, ['-y', '-ss', String(at), '-i', target, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '3', out], {
              timeout: 20_000,
              stdio: 'ignore',
            })
          } catch {
            try {
              execFileSync(ffmpeg, ['-y', '-i', target, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '3', out], {
                timeout: 20_000,
                stdio: 'ignore',
              })
            } catch { /* 返回 404 */ }
          }
        }
        if (!existsSync(out)) {
          sendJson(res, 404, { success: false, error: '缩略图生成失败' })
          return
        }
        const { createReadStream } = await import('node:fs')
        res.writeHead(200, {
          'content-type': 'image/jpeg',
          'content-length': String(statSync(out).size),
          'cache-control': 'max-age=86400',
        })
        createReadStream(out).on('error', () => res.destroy()).pipe(res)
      }),

      // 音效库：给剪辑页直接列 assets/sfx 里的可插入音效
      register('/digital-human-studio/sfx', async (_req, res) => {
        const items = sfxCatalogForAgent()
          .map((x) => {
            const item = sfxItem(x.id)
            const path = sfxPath(x.id)
            return {
              ...x,
              file: item ? item.file : '',
              path: path || '',
              url: `/digital-human-studio/media/sfx?id=${encodeURIComponent(x.id)}`,
            }
          })
          .filter((x) => x.path)
        sendJson(res, 200, { success: true, items })
      }),

      register('/digital-human-studio/media/sfx', async (req, res) => {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        const id = String(url.searchParams.get('id') || '').trim()
        const target = sfxPath(id)
        if (!target) {
          sendJson(res, 404, { success: false, error: `音效不存在：${id}` })
          return
        }
        const { createReadStream } = await import('node:fs')
        res.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': String(statSync(target).size),
          'cache-control': 'max-age=86400',
        })
        createReadStream(target).on('error', () => res.destroy()).pipe(res)
      }),

      // A1 真实波形：用 ffmpeg showwavespic 生成一条缓存 PNG，前端铺在口播轨上
      register('/digital-human-studio/media/waveform', async (req, res) => {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        const raw = url.searchParams.get('path') || ''
        const target = expandPath(raw)
        if (!target || !existsSync(target)) {
          sendJson(res, 404, { success: false, error: `文件不存在：${target}` })
          return
        }
        const w = Math.max(160, Math.min(1600, Number(url.searchParams.get('w') || 800) || 800))
        const h = Math.max(24, Math.min(160, Number(url.searchParams.get('h') || 48) || 48))
        const color = String(url.searchParams.get('color') || '0x3ecf8e').replace(/[^0-9a-zA-Z#x]/g, '').slice(0, 20) || '0x3ecf8e'
        const start = Math.max(0, Number(url.searchParams.get('start') || 0) || 0)
        const end = Math.max(0, Number(url.searchParams.get('end') || 0) || 0)
        const span = end > start + 0.05 ? end - start : 0
        const { createHash } = await import('node:crypto')
        const key = createHash('sha1').update(`${target}|${w}|${h}|${color}|${start.toFixed(3)}|${span.toFixed(3)}`).digest('hex').slice(0, 20)
        const cacheDir = join(homedir(), '.xiaocongcut', 'cache', 'waveforms')
        const out = join(cacheDir, `${key}.png`)
        if (!existsSync(out) || statSync(out).size < 32) {
          const ffmpeg = resolveFfmpeg()
          if (!ffmpeg) {
            sendJson(res, 503, { success: false, error: '找不到 ffmpeg' })
            return
          }
          mkdirSync(cacheDir, { recursive: true })
          try {
            const args = ['-y']
            if (start > 0) args.push('-ss', start.toFixed(3))
            args.push('-i', target)
            if (span > 0) args.push('-t', span.toFixed(3))
            args.push('-filter_complex', `showwavespic=s=${w}x${h}:colors=${color}`, '-frames:v', '1', '-f', 'image2', out)
            execFileSync(ffmpeg, args, { timeout: 20_000, stdio: 'ignore' })
          } catch { /* 无音轨 / 损坏文件：交给下面统一返回 */ }
        }
        if (!existsSync(out) || statSync(out).size < 32) {
          sendJson(res, 404, { success: false, error: '这个片段没有可读音轨' })
          return
        }
        const { createReadStream } = await import('node:fs')
        res.writeHead(200, {
          'content-type': 'image/png',
          'content-length': String(statSync(out).size),
          'cache-control': 'max-age=86400',
        })
        createReadStream(out).on('error', () => res.destroy()).pipe(res)
      }),

      register('/digital-human-studio/media/proxy', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const r = await vcFetch('/xcy/proxy', {
          path: (body as any)?.path,
          height: (body as any)?.height,
          base_dir: (body as any)?.base_dir,
        })
        sendJson(res, r.ok ? 200 : 502, r.data ?? { success: false, error: r.error })
      }),

      register('/digital-human-studio/trendy_koubo', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: 'method not allowed' })
          return
        }
        if (!sameOrigin(req)) {
          sendJson(res, 403, { success: false, error: 'origin not allowed' })
          return
        }
        try {
          const body = await readJson(req)
          const payload = {
            export_jianying_draft: true,
            ...(config.lastProjectFolder ? { draft_folder: config.lastProjectFolder } : {}),
            ...(body && typeof body === 'object' ? body : {}),
          }
          const r = await vcFetch('/xcy/trendy_koubo', payload)
          sendJson(res, r.ok ? 200 : 502, r.data ?? { success: false, error: r.error || '提交网感口播失败' })
        } catch (e: any) {
          sendJson(res, 400, { success: false, error: e?.message || '请求无效' })
        }
      }),

      register('/digital-human-studio/render', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const r = await vcFetch('/xcy/render', body)
        sendJson(res, r.ok ? 200 : 502, r.data ?? { success: false, error: r.error })
      }),

      register('/digital-human-studio/render_status', async (req, res) => {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        const taskId = url.searchParams.get('task_id') || ''
        if (!taskId) {
          sendJson(res, 400, { success: false, error: '缺 task_id' })
          return
        }
        const r = await vcFetch(`/xcy/render/${encodeURIComponent(taskId)}`,
          undefined,
          'GET',
        )
        const data = r.data
        if (r.ok && data && String(data.status) === 'done' && typeof data.out === 'string' && existsSync(data.out)) {
          const item = registerExport(activeSpaceId, data.out)
          if (item) {
            sendJson(res, 200, {
              ...data,
              work: {
                id: item.id,
                title: item.title,
                spaceId: activeSpaceId,
                mediaUrl: item.mediaUrl,
                thumbUrl: `/digital-human-studio/works/thumb?space=${encodeURIComponent(activeSpaceId)}&id=${encodeURIComponent(item.id)}`,
              },
            })
            return
          }
        }
        sendJson(res, r.ok ? 200 : 502, data ?? { success: false, error: r.error })
      }),

      register('/digital-human-studio/render_batch', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const r = await vcFetch('/xcy/render_batch', body)
        sendJson(res, r.ok ? 200 : 502, r.data ?? { success: false, error: r.error })
      }),

      register('/digital-human-studio/render_batch_status', async (req, res) => {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        const batchId = url.searchParams.get('batch_id') || ''
        if (!batchId) {
          sendJson(res, 400, { success: false, error: '缺 batch_id' })
          return
        }
        const r = await vcFetch(`/xcy/render_batch/${encodeURIComponent(batchId)}`, undefined, 'GET',
        )
        sendJson(res, r.ok ? 200 : 502, r.data ?? { success: false, error: r.error })
      }),

      // 「包装设置」的数据源：字幕样式 / LUT / 图形种类 / BGM 曲库，前端一次拿全
      register('/digital-human-studio/preview_range', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const r = await vcFetch('/xcy/render_preview', {
          recipe: (body as any)?.recipe,
          base_dir: (body as any)?.base_dir,
          start: Number((body as any)?.start || 0),
          end: Number((body as any)?.end || 0),
        })
        sendJson(res, r.ok ? 200 : 502, r.data ?? { success: false, error: r.error })
      }),

      // 异步区间预览：命中缓存秒回 out；否则拿 task_id 轮询 preview_status。
      // 引擎侧同一时刻只跑一个预览，新请求自动取消旧的排队/运行中预览。
      register('/digital-human-studio/preview_range_async', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const r = await vcFetch('/xcy/render_preview_async', {
          recipe: (body as any)?.recipe,
          base_dir: (body as any)?.base_dir,
          start: Number((body as any)?.start || 0),
          end: Number((body as any)?.end || 0),
        })
        sendJson(res, r.ok ? 200 : 502, r.data ?? { success: false, error: r.error })
      }),

      register('/digital-human-studio/preview_status', async (req, res) => {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        const taskId = url.searchParams.get('task_id') || ''
        if (!taskId) {
          sendJson(res, 400, { success: false, error: '缺 task_id' })
          return
        }
        const r = await vcFetch(`/xcy/render/${encodeURIComponent(taskId)}`, undefined, 'GET')
        sendJson(res, r.ok ? 200 : 502, r.data ?? { success: false, error: r.error })
      }),

      // 音量包络：成片出完后按关键帧把整体音轨乘增益（引擎只认标量音量）
      register('/digital-human-studio/audio_env', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const target = expandPath(String((body as any)?.out || (body as any)?.path || ''))
        const dstHint = expandPath(String((body as any)?.dst || ''))
        const keys = Array.isArray((body as any)?.keys) ? (body as any).keys : []
        if (!target || !existsSync(target)) {
          sendJson(res, 400, { success: false, error: `成片不存在：${target}` })
          return
        }
        if (!keys.length) {
          sendJson(res, 200, { success: true, skipped: true })
          return
        }
        const ffmpeg = resolveFfmpeg()
        if (!ffmpeg) {
          sendJson(res, 503, { success: false, error: '本机找不到 ffmpeg' })
          return
        }
        const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'audio_envelope.py')
        if (!existsSync(script)) {
          sendJson(res, 503, { success: false, error: `脚本缺失：${script}` })
          return
        }
        const tmpDir = join(homedir(), '.dsh', 'digital-human-studio', 'audio-env')
        if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
        const stamp = `${Date.now()}`
        const srcWav = join(tmpDir, `in-${stamp}.wav`)
        const dstWav = join(tmpDir, `out-${stamp}.wav`)
        const merged = join(tmpDir, `mix-${stamp}.mp4`)
        try {
          execFileSync(ffmpeg, ['-y', '-i', target, '-vn', '-ar', '44100',
            '-c:a', 'pcm_s16le', '-f', 'wav', srcWav], { timeout: 600000, stdio: 'ignore' })
          const py = execFileSync('python3', [script, '--src', srcWav, '--dst', dstWav,
            '--keys', JSON.stringify(keys)], { encoding: 'utf8', timeout: 600000 })
          execFileSync(ffmpeg, ['-y', '-i', target, '-i', dstWav, '-map', '0:v:0', '-map', '1:a:0',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', merged], { timeout: 600000, stdio: 'ignore' })
          const outPath = dstHint || target
          if (dstHint) {
            const dstDir = dirname(dstHint)
            if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true })
          }
          renameSync(merged, outPath)
          let info: any = {}
          try { info = JSON.parse(String(py).trim().split('\n').pop() || '{}') } catch { info = {} }
          sendJson(res, 200, { success: true, keys: keys.length, out: outPath, source: target, ...info })
        } catch (e: any) {
          sendJson(res, 500, { success: false, error: `包络处理失败：${e?.message || e}` })
        } finally {
          for (const p of [srcWav, dstWav, merged]) {
            try { if (existsSync(p)) unlinkSync(p) } catch { /* 清理失败忽略 */ }
          }
        }
      }),

      // 片段级画面预处理：裁切 / 旋转 / 镜像 → 生成中间素材（按参数+源 mtime 哈希缓存复用）
      register('/digital-human-studio/clip_prep', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const items: any[] = Array.isArray((body as any)?.items) ? (body as any).items.slice(0, 30) : []
        if (!items.length) {
          sendJson(res, 200, { success: true, items: [] })
          return
        }
        const sizeRaw = (body as any)?.size
        const size = Array.isArray(sizeRaw) && sizeRaw.length === 2 && Number(sizeRaw[0]) > 0 && Number(sizeRaw[1]) > 0
          ? [Number(sizeRaw[0]), Number(sizeRaw[1])]
          : null
        const ffmpeg = resolveFfmpeg()
        if (!ffmpeg) {
          sendJson(res, 503, { success: false, error: '本机找不到 ffmpeg' })
          return
        }
        const cacheDir = join(homedir(), '.dsh', 'digital-human-studio', 'clip-prep')
        if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
        const results: any[] = []
        for (const it of items) {
          const srcRaw = String((it && it.source) || '')
          const src = expandPath(srcRaw)
          if (!src || !existsSync(src)) {
            results.push({ source: srcRaw, out: '', error: '源文件不存在' })
            continue
          }
          const cropRaw = it && it.crop
          const crop = cropRaw && Number(cropRaw.w) >= 0.02 && Number(cropRaw.h) >= 0.02
            && Number(cropRaw.w) <= 1 && Number(cropRaw.h) <= 1
            ? {
              x: Math.min(1 - Number(cropRaw.w), Math.max(0, Number(cropRaw.x) || 0)),
              y: Math.min(1 - Number(cropRaw.h), Math.max(0, Number(cropRaw.y) || 0)),
              w: Number(cropRaw.w),
              h: Number(cropRaw.h),
            }
            : null
          const rotate = [90, 180, 270].includes(Number(it && it.rotate)) ? Number(it.rotate) : 0
          const flip = ['h', 'v', 'hv'].includes(String((it && it.flip) || '')) ? String(it.flip) : ''
          if (!crop && !rotate && !flip) {
            results.push({ source: srcRaw, out: '', skipped: true })
            continue
          }
          const key = createHash('sha1')
            .update(JSON.stringify({ s: src, m: statSync(src).mtimeMs, crop, rotate, flip, size }))
            .digest('hex').slice(0, 12)
          const dst = join(cacheDir, `${basename(src).replace(/[^\w.-]+/g, '_')}-${key}.mp4`)
          if (!existsSync(dst)) {
            const vf: string[] = []
            if (crop) vf.push(`crop=iw*${crop.w}:ih*${crop.h}:iw*${crop.x}:ih*${crop.y}`)
            if (rotate === 90) vf.push('transpose=1')
            else if (rotate === 180) vf.push('transpose=1', 'transpose=1')
            else if (rotate === 270) vf.push('transpose=2')
            if (flip === 'h') vf.push('hflip')
            else if (flip === 'v') vf.push('vflip')
            else if (flip === 'hv') vf.push('hflip', 'vflip')
            if (size) vf.push(`scale=${size[0]}:${size[1]}:force_original_aspect_ratio=increase`, `crop=${size[0]}:${size[1]}`)
            const args = ['-y', '-i', src, '-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'veryfast',
              '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', dst]
            let ok = false
            try {
              execFileSync(ffmpeg, args, { timeout: 600000, stdio: 'ignore' })
              ok = true
            } catch (e: any) {
              // 个别素材音频 copy 失败时退回 -an
              try {
                execFileSync(ffmpeg, ['-y', '-i', src, '-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'veryfast',
                  '-crf', '18', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', dst], { timeout: 600000, stdio: 'ignore' })
                ok = true
              } catch (e2: any) {
                results.push({ source: srcRaw, out: '', error: `预处理失败：${e2?.message || e2}` })
                continue
              }
            }
            if (!ok) {
              results.push({ source: srcRaw, out: '', error: '预处理失败' })
              continue
            }
          }
          results.push({ source: srcRaw, out: dst })
        }
        sendJson(res, 200, { success: true, items: results })
      }),

      // SRT 导出：前端生成文本 → 写盘（不覆盖已有同名文件，自动加时间戳）
      register('/digital-human-studio/srt_export', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const text = String((body as any)?.text || '')
        if (!text.trim()) {
          sendJson(res, 400, { success: false, error: '没有字幕内容' })
          return
        }
        const dir = expandPath(String((body as any)?.dir || join(homedir(), 'Movies', 'xcy-out')))
        const rawName = String((body as any)?.name || '字幕').replace(/\.srt$/i, '')
        const safe = rawName.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim().slice(0, 80) || '字幕'
        try {
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
          const stamp = `${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`
          let path = join(dir, `${safe}.srt`)
          if (existsSync(path)) path = join(dir, `${safe}-${stamp}.srt`)
          writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
          const count = text.split(/\n\s*\n/).filter((b) => b.includes('-->')).length
          sendJson(res, 200, { success: true, path, bytes: statSync(path).size, count, dir })
        } catch (e: any) {
          sendJson(res, 500, { success: false, error: `写 SRT 失败：${e?.message || e}` })
        }
      }),

      register('/digital-human-studio/cache_clean', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const r = await vcFetch('/xcy/cache_clean', {
          max_gb: Number((body as any)?.max_gb ?? 2),
          max_age_days: Number((body as any)?.max_age_days ?? 7),
          dry_run: !!(body as any)?.dry_run,
        })
        sendJson(res, r.ok ? 200 : 502, r.data ?? { success: false, error: r.error })
      }),

      register('/digital-human-studio/pack_options', async (_req, res) => {
        const [styles, luts, graphics, bgm] = await Promise.all([
          vcFetch('/xcy/subtitle_styles', undefined, 'GET'),
          vcFetch('/xcy/luts', undefined, 'GET'),
          vcFetch('/xcy/graphics', undefined, 'GET'),
          vcFetch('/xcy/bgm', undefined, 'GET'),
        ])
        sendJson(res, 200, {
          success: true,
          subtitle_styles: styles.data ?? null,
          luts: luts.data ?? null,
          graphics: graphics.data ?? null,
          bgm: bgm.data ?? null,
          errors: [styles, luts, graphics, bgm]
            .filter((r) => !r.ok)
            .map((r) => r.error || `HTTP ${r.status}`),
        })
      }),

      // 界面「带包装出片」：读配方 → 按勾选项打补丁 → 直接渲 mp4。
      // dry_run=true 只返回合并后的配方，用来核对，不占渲染资源。
      // 转写模型按需下载：装机包不带 2G 模型，第一次点“语音转字幕”才拉。
      register('/digital-human-studio/asr/status', async (req, res) => {
        try {
          let model = 'small'
          try {
            const url = new URL(String(req.url || '/'), `http://${req.headers.host || '127.0.0.1'}`)
            model = String(url.searchParams.get('model') || 'small')
          } catch { /* ignore */ }
          const r = await vcFetch(`/xcy/asr/status?model=${encodeURIComponent(model)}`, undefined, 'GET')
          sendJson(res, r.ok ? 200 : 502, r.ok ? r.data : { success: false, error: (r.data as any)?.error || '读不到转写模型状态' })
        } catch (e: any) {
          sendJson(res, 502, { success: false, error: e?.message || '读不到转写模型状态' })
        }
      }),

      register('/digital-human-studio/asr/prepare', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const model = String((body as any)?.model || 'small')
        try {
          if (!(await probeOnline()).online) {
            await engineStart()
          }
          const r = await vcFetch('/xcy/asr/prepare', { model }, 'POST')
          sendJson(res, r.ok ? 200 : 502, r.ok ? r.data : { success: false, error: (r.data as any)?.error || '模型下载没起来' })
        } catch (e: any) {
          sendJson(res, 502, { success: false, error: e?.message || '模型下载没起来' })
        }
      }),

      register('/digital-human-studio/transcribe', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const p = expandPath(String((body as any)?.path || ''))
        if (!p || !existsSync(p)) {
          sendJson(res, 400, { success: false, error: `素材不存在：${p}` })
          return
        }
        const r = await vcFetch('/xcy/transcribe', {
          path: p,
          language: String((body as any)?.language || 'zh'),
          max_chars: Number((body as any)?.max_chars || 14),
          force: true,
        })
        sendJson(res, r.ok ? 200 : 502, r.ok ? r.data : { success: false, error: (r.data as any)?.error || '转写失败' })
      }),

      register('/digital-human-studio/render_pack', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        let recipe = (body as any)?.recipe
        if (!recipe && (body as any)?.path) {
          const p = expandPath(String((body as any).path))
          if (!existsSync(p)) {
            sendJson(res, 400, { success: false, error: `配方文件不存在：${p}` })
            return
          }
          try {
            recipe = JSON.parse(readFileSync(p, 'utf8'))
          } catch (e: any) {
            sendJson(res, 400, { success: false, error: `配方 JSON 读不了：${e?.message || e}` })
            return
          }
        }
        if (!recipe || typeof recipe !== 'object') {
          sendJson(res, 400, { success: false, error: '缺 recipe 或 path' })
          return
        }
        recipe = normalizeRecipeFonts(recipe)
        const merged = applyPackPatch(recipe, (body as any)?.pack)
        if ((body as any)?.dry_run) {
          sendJson(res, 200, { success: true, applied: merged.applied, recipe: merged.recipe })
          return
        }
        const payload: any = {
          recipe: merged.recipe,
          preset: String((body as any)?.preset || 'final'),
        }
        // 导出参数：hardware=硬件编码（快）、false 走 libx264 crf20（更清晰但慢）
        if (typeof (body as any)?.hardware === 'boolean') payload.hardware = (body as any).hardware
        if (typeof (body as any)?.qc === 'boolean') payload.qc = (body as any).qc
        if ((body as any)?.out) payload.out = String((body as any).out)
        const r = await vcFetch('/xcy/render', payload)
        sendJson(res, r.ok ? 200 : 502, {
          ...(r.data || {}),
          applied: merged.applied,
          error: r.ok ? undefined : (r.data?.error || r.error),
        })
      }),

      // 画中画合层：主片出完后，把 recipe.overlays 真实叠到成片上（换掉原文件）
      register('/digital-human-studio/overlay_preview', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') { sendJson(res, 405, { success: false, error: '用 POST' }); return }
        const body = (await readJson(req).catch(() => ({}))) as any
        const src = expandPath(String((body && body.source) || ''))
        if (!src || !existsSync(src)) { sendJson(res, 400, { success: false, error: '素材不存在：' + src }); return }
        const dir = join(homedir(), '.dsh', 'digital-human-studio', 'fx')
        mkdirSync(dir, { recursive: true })
        const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'overlay_preview.py')
        if (!existsSync(script)) { sendJson(res, 503, { success: false, error: '脚本缺失：' + script }); return }
        const at = String(Number(body && body.at) || 0)
        const ch = JSON.stringify((body && body.chroma) || {})
        const mk = JSON.stringify((body && body.mask) || {})
        const key = createHash('md5').update(src + '|' + at + '|' + ch + '|' + mk).digest('hex').slice(0, 12)
        const out = join(dir, 'fx-' + key + '.png')
        let info: any = {}
        {
          try {
            const py = execFileSync('python3', [script, '--source', src, '--at', at, '--out', out, '--chroma', ch, '--mask', mk], { encoding: 'utf8', timeout: 120000 })
            info = JSON.parse(String(py).trim().split('\n').pop() || '{}')
            if (!info.success) { sendJson(res, 500, { success: false, error: info.error || '预览失败' }); return }
          } catch (err: any) {
            sendJson(res, 500, { success: false, error: String(err && err.message ? err.message : err).slice(0, 300) })
            return
          }
        }
        const url = '/digital-human-studio/media?path=' + encodeURIComponent(out)
        sendJson(res, 200, { success: true, width: info.width, height: info.height, kept: info.kept, url: url, out: out })
      }),

      register('/digital-human-studio/overlay_compose', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const out = expandPath(String((body as any)?.out || ''))
        const overlays: any[] = Array.isArray((body as any)?.overlays) ? (body as any).overlays : []
        if (!out || !existsSync(out)) {
          sendJson(res, 400, { success: false, error: `成片不存在：${out}` })
          return
        }
        if (!overlays.length) {
          sendJson(res, 200, { success: true, skipped: true, out })
          return
        }
        const { width: W, height: H } = probeMediaSize(out)
        if (!W || !H) {
          sendJson(res, 400, { success: false, error: '读不到成片分辨率' })
          return
        }
        const ffmpeg = resolveFfmpeg()
        if (!ffmpeg) {
          sendJson(res, 503, { success: false, error: '找不到 ffmpeg' })
          return
        }
        const used: any[] = []
        for (const o of overlays) {
          const src = expandPath(String((o as any)?.source || ''))
          if (!src || !existsSync(src)) continue
          used.push({ ...(o as any), _src: src })
        }
        if (!used.length) {
          sendJson(res, 200, { success: true, skipped: true, out, reason: '叠加素材都不存在' })
          return
        }
        const tmpOut = out.replace(/\.mp4$/, '') + `.pp-${Date.now().toString(36)}.mp4`
        // 任何一层带运动关键帧 → 交给逐帧 PIL 合成（位置/宽度/透明度都能连续变化）
        const dynLayers = used.filter((o) => (Array.isArray((o as any).keyframes) && (o as any).keyframes.length > 0)
          || !!((o as any).chroma && (o as any).chroma.on)
          || String(((o as any).mask && (o as any).mask.shape) || 'none') !== 'none')
        // 透明 PNG 浮层也走逐帧合成：ffmpeg 链式 overlay 对静态图的 enable 窗口不可靠
        const imgLayers = used.filter((o) => /\.(png|jpe?g|webp|bmp)$/i.test(String((o as any)._src || '')))
        if (imgLayers.length || dynLayers.length) {
          const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'overlay_render.py')
          if (!existsSync(script)) {
            sendJson(res, 503, { success: false, error: `脚本缺失：${script}` })
            return
          }
          const payload = used.map((o: any) => {
            const isImg = /\.(png|jpe?g|webp|bmp)$/i.test(String(o._src || ''))
            // 静态图的 start 就是"上屏时刻"，没有素材内裁剪这回事：
            // 转成脚本认识的 target=上屏时刻、start=0、end=窗口长度
            const win0 = Math.max(0, Number(o.start) || 0)
            const win1 = Math.max(win0 + 0.05, Number(o.end) || (win0 + 3))
            const t0 = isImg ? win0 : Math.max(0, Number(o.target) || 0)
            const s0 = isImg ? 0 : win0
            const e0 = isImg ? (win1 - win0) : Math.max(win0 + 0.05, Number(o.end) || (win0 + 3))
            const t1 = t0 + (e0 - s0)
            const kfs = (Array.isArray(o.keyframes) && o.keyframes.length)
              ? o.keyframes
              : [{ at: t0, x: Number(o.x) || 0, y: Number(o.y) || 0, w: Number(o.width) || 0.3, opacity: o.opacity == null ? 1 : Number(o.opacity) },
                 { at: t1, x: Number(o.x) || 0, y: Number(o.y) || 0, w: Number(o.width) || 0.3, opacity: o.opacity == null ? 1 : Number(o.opacity) }]
            return {
              source: o._src, start: s0, end: e0, target: t0, keyframes: kfs,
              chroma: (o as any).chroma || null,
              mask: (o as any).mask || null,
            }
          })
          let info: any = {}
          try {
            const py = execFileSync('python3', [script, '--base', out, '--out', tmpOut,
              '--fps', '30', '--layers', JSON.stringify(payload)], { encoding: 'utf8', timeout: 1_800_000 })
            info = JSON.parse(String(py).trim().split('\n').pop() || '{}')
          } catch (e: any) {
            try { if (existsSync(tmpOut)) unlinkSync(tmpOut) } catch { /* ignore */ }
            sendJson(res, 500, { success: false, error: `关键帧合成失败：${e?.message || e}` })
            return
          }
          if (!info || !info.success || !existsSync(tmpOut) || statSync(tmpOut).size < 64) {
            try { if (existsSync(tmpOut)) unlinkSync(tmpOut) } catch { /* ignore */ }
            sendJson(res, 500, { success: false, error: `关键帧合成失败：${(info && info.error) || '输出为空'}` })
            return
          }
          try { renameSync(tmpOut, out) } catch (e: any) {
            try { if (existsSync(tmpOut)) unlinkSync(tmpOut) } catch { /* ignore */ }
            sendJson(res, 500, { success: false, error: `替换成片失败：${e?.message || e}` })
            return
          }
          sendJson(res, 200, {
            success: true, out, layers: used.length, dynamic: dynLayers.length,
            frames: info.frames, composited: info.composited,
            size: statSync(out).size, width: W, height: H,
          })
          return
        }
        const args: string[] = ['-y', '-i', out]
        const isImgSrc = (p: string) => /\.(png|jpe?g|webp|bmp)$/i.test(p)
        used.forEach((o) => {
          if (isImgSrc(o._src)) {
            // 静态图循环到自己的窗口结束时刻，时间轴从 0 起；显示窗口交给 overlay 的 enable 控
            const s0 = Math.max(0, Number((o as any).start) || 0)
            const e0 = Math.max(s0 + 0.05, Number((o as any).end) || (s0 + 3))
            const t0 = Math.max(0, Number((o as any).target) || 0)
            args.push('-loop', '1', '-t', (t0 + (e0 - s0)).toFixed(3), '-i', o._src)
          } else {
            args.push('-i', o._src)
          }
        })
        const chains: string[] = []
        let prev = '0:v'
        used.forEach((o, i) => {
          const t0 = Math.max(0, Number(o.target) || 0)
          const s0 = Math.max(0, Number(o.start) || 0)
          const e0 = Math.max(s0 + 0.05, Number(o.end) || s0 + 3)
          const dur = e0 - s0
          const t1 = t0 + dur
          const wpx = Math.max(16, Math.round(W * Math.min(1, Math.max(0.05, Number(o.width) || 0.3))))
          const xf = Math.min(1, Math.max(0, Number(o.x) || 0))
          const yf = Math.min(1, Math.max(0, Number(o.y) || 0))
          const alpha = Math.min(1, Math.max(0, Number(o.opacity) == null ? 1 : Number(o.opacity)))
          const label = `pp${i}`
          if (isImgSrc(o._src)) {
            chains.push(`[${i + 1}:v]setpts=PTS-STARTPTS,scale=${wpx}:-2,format=rgba,colorchannelmixer=aa=${alpha},setsar=1[${label}]`)
          } else {
            chains.push(`[${i + 1}:v]trim=start=${s0}:end=${e0},setpts=PTS-STARTPTS+${t0}/TB,scale=${wpx}:-2,format=rgba,colorchannelmixer=aa=${alpha}[${label}]`)
          }
          const next = `ppv${i}`
          chains.push(`[${prev}][${label}]overlay=x=(W-w)*${xf}:y=(H-h)*${yf}:enable='between(t,${t0},${t1})':eof_action=repeat:format=auto[${next}]`)
          prev = next
        })
        args.push('-filter_complex', chains.join(';'))
        args.push('-map', `[${prev}]`, '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20')
        args.push('-c:a', 'copy', '-movflags', '+faststart', tmpOut)
        let ok = true
        let errMsg = ''
        try {
          execFileSync(ffmpeg, args, { timeout: 600_000, stdio: 'ignore' })
        } catch (e: any) {
          ok = false
          errMsg = String(e?.message || e)
        }
        if (!ok || !existsSync(tmpOut) || statSync(tmpOut).size < 64) {
          try { unlinkSync(tmpOut) } catch { /* ignore */ }
          sendJson(res, 500, { success: false, error: `合层失败：${errMsg || '输出为空'}` })
          return
        }
        try {
          renameSync(tmpOut, out)
        } catch (e: any) {
          try { unlinkSync(tmpOut) } catch { /* ignore */ }
          sendJson(res, 500, { success: false, error: `替换成片失败：${e?.message || e}` })
          return
        }
        sendJson(res, 200, {
          success: true, out, layers: used.length,
          size: statSync(out).size, width: W, height: H,
        })
      }),

      // 画面变换合层：引擎只做 zoompan 缩放，位置/旋转/透明度由插件按关键帧逐帧合成
      register('/digital-human-studio/motion_compose', async (req, res) => {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { success: false, error: '用 POST' })
          return
        }
        const body = await readJson(req).catch(() => ({}))
        const out = expandPath(String((body as any)?.out || ''))
        const segs: any[] = Array.isArray((body as any)?.segments) ? (body as any).segments : []
        if (!out || !existsSync(out)) {
          sendJson(res, 400, { success: false, error: `成片不存在：${out}` })
          return
        }
        const usable = segs
          .filter((sg) => sg && Array.isArray(sg.keys) && sg.keys.length)
          .map((sg) => {
            const t0 = Math.max(0, Number(sg.t0) || 0)
            const t1 = Math.max(t0 + 0.05, Number(sg.t1) || t0 + 1)
            const keys = sg.keys
              .map((k: any) => ({
                at: Math.min(1, Math.max(0, Number(k.at) || 0)),
                x: Math.min(0.5, Math.max(-0.5, Number(k.x) || 0)),
                y: Math.min(0.5, Math.max(-0.5, Number(k.y) || 0)),
                scale: Math.min(3, Math.max(0.5, Number(k.scale) || 1)),
                rotate: Math.min(180, Math.max(-180, Number(k.rotate) || 0)),
                opacity: Math.min(1, Math.max(0, k.opacity == null ? 1 : Number(k.opacity))),
              }))
              .sort((a: any, b: any) => a.at - b.at)
            const flat = keys.every((k: any) => Math.abs(k.x) < 1e-4 && Math.abs(k.y) < 1e-4
              && Math.abs(k.scale - 1) < 1e-4 && Math.abs(k.rotate) < 1e-4 && k.opacity > 0.999)
            return { t0, t1, keys, flat }
          })
          .filter((sg) => !sg.flat)
        if (!usable.length) {
          sendJson(res, 200, { success: true, skipped: true, out, reason: '没有需要合成的画面变换' })
          return
        }
        const { width: W, height: H } = probeMediaSize(out)
        if (!W || !H) {
          sendJson(res, 400, { success: false, error: '读不到成片分辨率' })
          return
        }
        const fps = Math.max(1, Math.min(120, Number((body as any)?.fps) || 30))
        const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'motion_render.py')
        if (!existsSync(scriptPath)) {
          sendJson(res, 503, { success: false, error: `找不到逐帧合成脚本：${scriptPath}` })
          return
        }
        const segPayload = usable.map((sg) => ({
          t0: sg.t0,
          t1: sg.t1,
          keys: sg.keys.map((k: any) => ({
            at: k.at, x: k.x, y: k.y, scale: k.scale, rotate: k.rotate, opacity: k.opacity,
          })),
        }))
        const tmpOut = out.replace(/\.mp4$/, '') + `.motion-${Date.now().toString(36)}.mp4`
        let ok = false
        let errMsg = ''
        const pyArgs = [
          scriptPath, '--src', out, '--dst', tmpOut,
          '--fps', String(fps), '--segments', JSON.stringify(segPayload),
        ]
        const pyCands = IS_WIN
          ? ['python', 'py', ...systemPythonNames()]
          : ['python3', '/usr/bin/python3', '/opt/homebrew/bin/python3']
        for (const py of [...new Set(pyCands)]) {
          try {
            execFileSync(py, pyArgs, { timeout: 1_800_000, stdio: 'ignore' })
            ok = true
            errMsg = ''
            break
          } catch (e: any) {
            ok = false
            errMsg = String(e?.message || e)
          }
        }
        if (!ok || !existsSync(tmpOut) || statSync(tmpOut).size < 64) {
          try { unlinkSync(tmpOut) } catch { /* ignore */ }
          sendJson(res, 500, { success: false, error: `画面变换合成失败：${errMsg || '输出为空'}` })
          return
        }
        try {
          renameSync(tmpOut, out)
        } catch (e: any) {
          try { unlinkSync(tmpOut) } catch { /* ignore */ }
          sendJson(res, 500, { success: false, error: `替换成片失败：${e?.message || e}` })
          return
        }
        sendJson(res, 200, {
          success: true, out, segments: usable.length,
          size: statSync(out).size, width: W, height: H, fps,
        })
      }),

      // 引擎自报的接口清单（/xcy 能力索引），主页用它，避免前端硬编码过期
      register('/digital-human-studio/engine_capabilities', async (_req, res) => {
        const r = await vcFetch('/xcy', undefined, 'GET')
        sendJson(res, r.ok ? 200 : 502, r.data ?? { success: false, error: r.error })
      }),

      register('/digital-human-studio/qc', async (req, res) => {
        const body = await readJson(req).catch(() => ({}))
        const r = await vcFetch('/xcy/qc', body)
        sendJson(res, r.ok ? 200 : 502, r.data ?? { success: false, error: r.error })
      }),

      register('/digital-human-studio/render_cancel', async (req, res) => {
        const body = await readJson(req).catch(() => ({}))
        const taskId = String((body as any)?.task_id || '')
        if (!taskId) {
          sendJson(res, 400, { success: false, error: '缺 task_id' })
          return
        }
        const r = await vcFetch(`/xcy/render/${encodeURIComponent(taskId)}/cancel`,
          {},
        )
        sendJson(res, r.ok ? 200 : 502, r.data ?? { success: false, error: r.error })
      }),

      register('/digital-human-studio/list_drafts', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        let folder = config.lastProjectFolder
        if (method === 'POST') {
          const body = await readJson(req)
          if (body.folder != null) folder = String(body.folder)
        } else if (req.url) {
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            if (u.searchParams.get('folder')) folder = u.searchParams.get('folder') || folder
          } catch {
            /* ignore */
          }
        }
        const body = await listDrafts(folder)
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/load_draft', async (req, res) => {
        const bodyIn = await readJson(req)
        const body = await loadDraft(bodyIn)
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/create_draft', async (req, res) => {
        const bodyIn = await readJson(req)
        const body = await createDraft(bodyIn)
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/add_video', async (req, res) => {
        const bodyIn = await readJson(req)
        const body = await addVideo(bodyIn)
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/save_draft', async (req, res) => {
        const bodyIn = await readJson(req)
        const body = await saveDraft(bodyIn)
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/export', async (req, res) => {
        const bodyIn = await readJson(req)
        const body = await exportDraft(bodyIn)
        sendJson(res, httpStatusFor(body), body)
      }),

      register('/digital-human-studio/export_status', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        let args: any = {}
        if (method === 'POST') {
          args = await readJson(req)
        } else if (req.url) {
          try {
            const u = new URL(req.url, 'http://127.0.0.1')
            args = {
              task_id: u.searchParams.get('task_id') || undefined,
              draft_id: u.searchParams.get('draft_id') || undefined,
            }
          } catch {
            /* ignore */
          }
        }
        const body = await exportStatus(args)
        sendJson(res, httpStatusFor(body), body)
      }),
    ]

    console.log(
      `[digital-human-studio] routes+tools registered; Xiaocongcut → ${config.xiaocongcutBaseUrl}; space → ${currentSpace(spaceStore).name}; folder → ${config.lastProjectFolder || '(none)'}`,
    )

    // 开机自检：桌面一开就探一次 9001，不在就自动拉起（失败只记日志，不影响 3080）。
    void (async () => {
      try {
        const probe = await probeOnline()
        if (probe.online) return
        console.log('[digital-human-studio] engine offline at boot; auto-starting Xiaocongcut…')
        const started = await engineStart()
        console.log(
          `[digital-human-studio] engine auto-start: success=${started.success} online=${(started as any).online} pid=${(started as any).enginePid || '-'}${started.error ? ` error=${started.error}` : ''}`,
        )
      } catch (e: any) {
        console.log(`[digital-human-studio] engine boot check failed: ${e?.message || e}`)
      }
    })()

    // 开机自检：采集环境。缺就后台补一次（约 300MB，联网），不阻塞 3080 起服务。
    // 采集代码随插件走（vendor/media-crawler），因此「插件起来 = 采集可用」，只差 Python 环境。
    const mcBootTimer = setTimeout(() => {
      void (async () => {
        try {
          const mc = diagnoseMcEnv()
          if (mc.ready) {
            console.log(`[digital-human-studio] media-crawler ready: ${mc.python}`)
            return
          }
          const missing = mc.steps.filter((x) => !x.ok).map((x) => x.key).join(',')
          console.log(`[digital-human-studio] media-crawler not ready (${missing})`)
          if (mc.diskFreeMb != null && mc.diskFreeMb < 1500) {
            console.log(`[digital-human-studio] media-crawler auto-setup skipped: only ${mc.diskFreeMb}MB free`)
            return
          }
          console.log('[digital-human-studio] media-crawler auto-setup starting…')
          const r = await provisionMcEnv({ confirm: true, logFile: join(tmpdir(), 'dsh-mc-setup.log') })
          console.log(`[digital-human-studio] media-crawler auto-setup: success=${r.success}${r.hint ? ` hint=${r.hint}` : ''}`)
        } catch (e: any) {
          console.log(`[digital-human-studio] media-crawler boot check failed: ${e?.message || e}`)
        }
      })()
    }, 15000)
    if (typeof (mcBootTimer as any).unref === 'function') (mcBootTimer as any).unref()

    return () => {
      for (const d of disposers) d?.()
    }
  }, 'digital-human-studio: routes')

  // Agent-facing tools (chat can call these by name).
  const renderJson = (_args: unknown, value: unknown) => [
    { type: 'text' as const, text: jsonText(value) },
  ]
  const createDigitalHumanTask = async (model: string, args: Record<string, unknown>, exec?: { agent?: unknown }) => {
    const taskSpaceId = spaceForAgent(exec?.agent).id
    const result = await digitalHumanRequest('POST', '/v1/tasks/xiaocong-digital-human', { ...args, model }, 120000)
    recordStudioTask(taskSpaceId, model, args, result, {
      source: exec?.agent ? 'chat' : 'studio',
    })
    return result
  }

  /** 将配方/快剪渲染完成的 mp4 自动登记进当前公司空间的「成片库」，便于预览、写文案、排期与发布。 */
  const registerRenderedWork = (spaceId: string, outPath: unknown, title?: string) => {
    const file = typeof outPath === 'string' ? expandPath(outPath.trim()) : ''
    if (!file || !existsSync(file)) return null
    const item = registerExport(spaceId, file, title ? { title } : {})
    if (!item) return null
    return {
      id: item.id,
      title: item.title,
      spaceId,
      mediaUrl: item.mediaUrl || `/digital-human-studio/works/file?space=${encodeURIComponent(spaceId)}&id=${encodeURIComponent(item.id)}`,
      thumbUrl: `/digital-human-studio/works/thumb?space=${encodeURIComponent(spaceId)}&id=${encodeURIComponent(item.id)}`,
    }
  }

  // These tools never accept space/actor/credentials/confirmation tokens from the model.
  const publicationTool=(name:string,description:string,parameters:any,convert:(args:Record<string,unknown>)=>Record<string,unknown>)=>trackTool(ctx, defineTool({
    name,description,parameters,output:{schema:{type:'object',additionalProperties:true},render:renderJson},
    async execute(args,exec){
      if(!sessionIdOf(exec?.agent as {session?:{id?:unknown}}))throw new Error('发布管理需要明确的会话公司，请先进入公司空间，不使用全局当前公司猜测')
      const space=spaceForAgent(exec?.agent).id
      for(const k of ['space','spaceId','actor','nonce','token','cookie','path','url'])if(k in args)throw new Error('AI不接受公司覆盖、凭据或发布确认授权')
      return publicationAction(space,'ai',convert(args as Record<string,unknown>))
    },
    presentCall:args=>({card:'generic',title:name,kind:'other',rawInput:args}),
  }))

  ctx.effect(() => {
    const tools = [
      publicationTool('dh_publication_overview','查询本会话公司的可用平台源码清单、账号摘要和任务。源码保全不代表真实发布可用；不登录、不发送。',{},()=>({action:'overview'})),
      publicationTool('dh_publish_packages','查询/编辑本会话公司发布包。operation=list/read/save/delete/calendar；read/delete/calendar必须明确id；save必须给完整item与revision（新增0），先读后改。不得猜“这个”。复制/保存/关联排期不代表发布，不能代替人工检查或批准。删除记录前必须取得用户明确同意。',{
        operation:{type:'string',description:'list/read/save/delete/calendar'},id:{type:'string'},revision:{type:'integer'},item:{type:'object',additionalProperties:true},
      },args=>{const map:Record<string,string>={list:'pack.list',read:'pack.get',save:'pack.save',delete:'pack.delete',calendar:'pack.calendar'};if(!map[String(args.operation)])throw new Error('请明确发布包操作');return {...args,action:map[String(args.operation)]}}),
      publicationTool('dh_publish_calendar','查询/新增/修改本会话公司发布日历。operation=list/save/delete；save给完整item，修改/删除必须先读取并传expectedUpdatedAt。时间均北京时间UTC+8，scheduledAt必须明确YYYY-MM-DDTHH:mm，用户时间或计划不明确须询问；不能把准备/执行任务当成已发布。删除前须用户明确同意。',{
        operation:{type:'string',description:'list/save/delete'},id:{type:'string'},expectedUpdatedAt:{type:'integer'},item:{type:'object',additionalProperties:true},
      },args=>{const map:Record<string,string>={list:'calendar.list',save:'calendar.save',delete:'calendar.delete'};if(!map[String(args.operation)])throw new Error('请明确日历操作');return {...args,action:map[String(args.operation)]}}),
      publicationTool('dh_publish_tasks','查询本会话公司发布任务，id为空列出全部。operation=cancel仅在用户明确要求时取消尚未执行任务，不表示平台内容撤回；运行中不可取消。平台受理/结果未知不代表已发布，未知结果不得自动重试。',{id:{type:'string'},operation:{type:'string'}},args=>({action:args.operation==='cancel'?'task.cancel':args.id?'tasks.get':'tasks.list',id:args.id})),
      publicationTool('dh_prepare_publication','仅准备当前公司已人工检查发布包的发布确认草稿。必须明确packId、packRevision、bindingId；不明确要询问。不会签发/消费用户确认授权、上传、发送或启动定时器。真实发布必须用户到界面检查和确认，未配置则blocked。',{
        packId:{type:'string'},packRevision:{type:'integer'},bindingId:{type:'string'},
      },args=>({...args,action:'task.prepare'})),
      ...(['dh_auth_status' , 'dh_auth_probe'] as const).map((toolName) => trackTool(ctx, defineTool({
        name: toolName,
        description: toolName === 'dh_auth_status' ? '查看 XiaocongAPI 授权状态（仅脱敏信息）' : '使用已保存令牌探测 XiaocongAPI 模型接口；不接收密码或令牌',
        parameters: {}, output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
        async execute() { return toolName === 'dh_auth_status' ? authStatus() : authProbe() },
        presentCall: () => ({ card: 'generic', title: toolName, kind: 'other' }),
      }))),
      trackTool(ctx, 
        defineTool({
          name: 'dh_get_workspace',
          description:
            'Digital Human Studio: return the current company space, Jianying folder, draft_id, the short client brief, and that company\'s mixcut materials (产品/门店/Logo) with local paths.',
          parameters: {},
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(_args, exec) {
            return getWorkspace(spaceForAgent(exec?.agent).id)
          },
          presentCall: () => ({ card: 'generic', title: 'dh_get_workspace', kind: 'other' }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_list_materials',
          description:
            '列出当前公司素材目录卡（产品/门店/Logo）。混剪只读 ready 条目的 path、时长、useFor 和详细维度 environment/lighting/quality/speaker/speech，按这些挑素材，不要凭文件名猜内容。pending 只看 coverPath 封面，再 dh_label_materials 逐项详细标注。用户给了本地文件夹时必须先 dh_ingest_local_folder 入库，禁止直接去原目录读全部视频。',
          parameters: {
            slot: { type: 'string', description: 'Optional slot: product, store, or logo.' },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            const all = publicStudioMaterials(space.id)
            const slot = String(args.slot || '').trim()
            const items = isMaterialSlot(slot) ? all.items.filter(item => item.slot === slot) : all.items
            const pending = isMaterialSlot(slot) ? all.pending.filter(item => item.slot === slot) : all.pending
            return toLosslessJson({
              success: true,
              spaceId: space.id,
              spaceName: space.name,
              slot: slot || '',
              counts: all.counts,
              pendingCount: all.pendingCount,
              readyCount: all.readyCount,
              hint: all.hint,
              root: all.root,
              items,
              pending,
            })
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_list_materials', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_ingest_local_folder',
          description:
            '把用户指出的本地文件夹（视频/图片）拷进当前公司素材库。用户说「这个目录有几个视频，帮我混剪」时必须先调用本工具，禁止直接 dh_add_video 原路径。可按文件名猜产品/门店/Logo。入库后看 pending 封面，用 dh_label_materials 按环境/光线/画质/说话人/说话内容逐项详细标注，不要只写一句用途。',
          parameters: {
            folder: { type: 'string', description: '本地文件夹绝对路径或 ~/...' },
            slot: { type: 'string', description: '可选：product / store / logo。不填则按文件名猜。' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            const result = ingestLocalFolder(space.id, String(args.folder || ''), String(args.slot || ''))
            return toLosslessJson({ success: true, spaceId: space.id, spaceName: space.name, ...result })
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_ingest_local_folder', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_label_materials',
          description:
            '给素材写详细目录卡。视频必须逐项描述：环境（在哪拍、背景有什么）、光线（自然光/灯光、明暗、色温、是否逆光）、质量（清晰度、抖动、构图、能不能用）、说话人（谁出镜、穿着、是否露脸、人数）、说话内容（尽量逐字写清说了什么、语气、关键词；无对白写「无对白」，听不清写「听不清」）。只看 coverPath 封面/首帧和已知的字幕/转写，不要通读整段视频；不知道的维度写「未识别」，不要编造。已标注过的素材也可以重新调用补充维度，只传要补的字段即可，不会丢原内容。混剪之后只读这些卡片。',
          parameters: {
            items: {
              type: 'array',
              description: '要标注的素材列表',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  id: { type: 'string' },
                  slot: { type: 'string', description: 'product / store / logo，分错了可改' },
                  role: { type: 'string', description: 'product_detail | store_front | store_in | process | talking | logo | other' },
                  useFor: { type: 'string', description: '人话用途，例如 产品特写、进门、铺砖现场（≤200字）' },
                  summary: { type: 'string', description: '画面内容概述，尽量具体（≤600字）' },
                  environment: { type: 'string', description: '拍摄环境：室内/室外、具体场所、背景陈设、周边人物、有无杂物（≤300字）' },
                  lighting: { type: 'string', description: '光线：自然光还是灯光、明暗、色温冷暖、逆光/曝光、有无反光和阴影（≤300字）' },
                  quality: { type: 'string', description: '画面质量：清晰度/分辨率、是否抖动、噪点、构图与画幅、有无字幕水印、整体可用度（≤300字）' },
                  speaker: { type: 'string', description: '说话人：谁在说、人数、性别年龄感、穿着、是否露脸、出镜方式、声音特点（≤300字）' },
                  speech: { type: 'string', description: '说话内容：尽量逐字写出对白/口播，含语气和关键信息；无对白或听不清要写明（≤2000字）' },
                },
              },
            },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            const rows = Array.isArray(args.items) ? args.items : []
            const updated = []
            const errors = []
            for (const row of rows) {
              try {
                updated.push(updateStudioMaterialMeta(space.id, String((row as any).id || ''), {
                  slot: (row as any).slot,
                  role: (row as any).role,
                  useFor: (row as any).useFor,
                  summary: (row as any).summary,
                  environment: (row as any).environment,
                  lighting: (row as any).lighting,
                  quality: (row as any).quality,
                  speaker: (row as any).speaker,
                  speech: (row as any).speech,
                }))
              } catch (error: any) {
                errors.push({ id: String((row as any).id || ''), error: String(error?.message || error) })
              }
            }
            const all = publicStudioMaterials(space.id)
            return toLosslessJson({ success: errors.length === 0, updated, errors, pendingCount: all.pendingCount, readyCount: all.readyCount })
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_label_materials', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_mediacrawler_capability',
          description:
            'Alias of dh_platform_media_capability: MediaCrawler documented-CLI adapter status (not a claim of live crawl).',
          parameters: {},
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute() {
            return { success: true, ...mediacrawlerCapabilityReport(mediaCrawlerPluginConfig(config)), productionRunnerIsLive: defaultProductionRunner() === liveMcRunner } as any
          },
          presentCall: () => ({ card: 'generic', title: 'dh_mediacrawler_capability', kind: 'other' }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_ingest_media_link',
          description:
            'Local-only media ingest (fixture: or 127.0.0.1/localhost). NOT MediaCrawler and NOT platform download. For 小红书/抖音/快手/B站/微博 use dh_platform_media_download.',
          parameters: {
            source: { type: 'string', description: 'fixture:name or loopback http(s) URL' },
            slot: { type: 'string', description: 'product | store | logo (default product)' },
            fileName: { type: 'string', description: 'Optional display file name' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            return (await runMediaLinkIngest({
              spaceId: space.id,
              slot: String(args.slot || 'product'),
              source: String(args.source || ''),
              fileName: args.fileName ? String(args.fileName) : undefined,
            })) as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_ingest_media_link', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_media_ingest_status',
          description: 'List or get media-link ingest tasks for the current company space (independent of MediaCrawler).',
          parameters: {
            id: { type: 'string', description: 'Optional task id' },
            limit: { type: 'number', description: 'Max tasks when listing (default 20)' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            const id = String(args.id || '').trim()
            if (id) {
              const task = getIngestTask(space.id, id)
              if (!task) return { success: false, error: '任务不存在', mediCrawlerIntegrated: false } as any
              return { success: true, task, capability: mediCrawlerCapabilityReport() } as any
            }
            const limit = Number(args.limit || 20)
            return {
              success: true,
              tasks: listIngestTasks(space.id, Number.isFinite(limit) ? limit : 20),
              capability: mediCrawlerCapabilityReport(),
            } as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_media_ingest_status', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_platform_media_capability',
          description:
            'MediaCrawler documented-CLI adapter capability: which platforms support media download (xhs/dy/ks/bili/wb), CLI argv shape, isolation save_data_path, login gap (needs_login), runner=fake|live. Does not read cookies or run live by default.',
          parameters: {},
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute() {
            return { success: true, ...mediacrawlerCapabilityReport(mediaCrawlerPluginConfig(config)), productionRunnerIsLive: defaultProductionRunner() === liveMcRunner } as any
          },
          presentCall: () => ({ card: 'generic', title: 'dh_platform_media_capability', kind: 'other' }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_platform_media_download',
          description:
            'Download platform media into company materials via MediaCrawler CLI (login window then HTTP, same as original MC). Chrome CDP page-media only if browserMode=cdp_existing. No cookie-file reads, no captcha/DRM bypass, no publish-session reuse.',
          parameters: {
            source: { type: 'string', description: 'Full platform post/video URL' },
            slot: { type: 'string', description: 'product | store | logo' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            return (await runDyDownloadPreferringCdp({
              spaceId: space.id,
              slot: String(args.slot || 'product'),
              source: String(args.source || ''),
              pluginConfig: mediaCrawlerPluginConfig(config),
            })) as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_platform_media_download', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_platform_media_status',
          description: 'List or get MediaCrawler-adapter download tasks for the current company space (fake or live).',
          parameters: {
            id: { type: 'string', description: 'Optional task id' },
            limit: { type: 'number', description: 'Max tasks when listing' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            const id = String(args.id || '').trim()
            if (id) {
              const task = getMcTask(space.id, id)
              if (!task) return { success: false, error: '任务不存在' } as any
              return { success: true, task, capability: mediacrawlerCapabilityReport(mediaCrawlerPluginConfig(config)) } as any
            }
            const limit = Number(args.limit || 20)
            return {
              success: true,
              tasks: listMcTasks(space.id, Number.isFinite(limit) ? limit : 20),
              capability: mediacrawlerCapabilityReport(mediaCrawlerPluginConfig(config)),
            } as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_platform_media_status', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_platform_keyword_search',
          description:
            'Keyword search via MediaCrawler --type search (NOT a platform hot-board). Returns metadata hits with sourceKind=keyword_search, collectedAt, and sample like/comment counts when present. No media/comment download. Cap <=10. Does not read cookies or reuse publish sessions.',
          parameters: {
            keywords: { type: 'string', description: 'Search keyword (required)' },
            platform: { type: 'string', description: 'dy|xhs|ks|bili|wb (default dy)' },
            maxNotes: { type: 'number', description: '1-10, default 10' },
            browserMode: {
              type: 'string',
              description: 'standard | cdp_existing | cdp_launch (process-scoped; cdp_existing uses already-open 9222 Chrome)',
            },
            cdpPort: { type: 'number', description: 'Existing Chrome debug port (only 9222 allowed)' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            return (await runPlatformKeywordSearch({
              spaceId: space.id,
              platform: (String(args.platform || 'dy').trim() || 'dy') as any,
              keywords: String(args.keywords || '').trim(),
              maxNotes: Math.min(10, Math.max(1, Number(args.maxNotes || 10) || 10)),
              browserMode: normalizeBrowserMode(args.browserMode ?? config.mediaCrawlerBrowserMode),
              cdpPort: normalizeCdpPort((args as any).cdpPort ?? config.mediaCrawlerCdpPort, 9222),
              pluginConfig: mediaCrawlerPluginConfig(config),
            })) as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_platform_keyword_search', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_comment_wordcloud',
          description:
            'Import existing comments (UTF-8 txt/json/jsonl) and run MediaCrawler AsyncWordCloudGenerator locally. Reuses MC tools/words.py. Does NOT crawl new comments, NOT hot-board, NOT AI sentiment. Strips author/PII; output is word frequency + wordcloud PNG only.',
          parameters: {
            text: { type: 'string', description: 'Comment payload text (required unless using fixture)' },
            filename: { type: 'string', description: 'Optional .txt/.json/.jsonl name for format hint' },
            fixtureLabeled: { type: 'boolean', description: 'Mark as 测试示例 (not real crawl)' },
            sourceLabel: { type: 'string', description: 'Short label for the import source' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            return (await runCommentWordcloud({
              spaceId: space.id,
              text: String(args.text || ''),
              filename: String(args.filename || ''),
              fixtureLabeled: !!(args as any).fixtureLabeled,
              sourceLabel: String((args as any).sourceLabel || args.filename || '').slice(0, 120),
              mediaCrawlerRoot: mediaCrawlerPluginConfig(config).mediaCrawlerRoot,
              mediaCrawlerPython: mediaCrawlerPluginConfig(config).mediaCrawlerPython,
            })) as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_comment_wordcloud', kind: 'other', rawInput: args }),
        }),
      ),

      trackTool(ctx, 
        defineTool({
          name: 'dh_platform_media_cancel',
          description: 'Cancel a running MediaCrawler platform-media download task for the current company space.',
          parameters: {
            id: { type: 'string', description: 'Task id from dh_platform_media_download / status' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            const task = cancelMcTask(space.id, String(args.id || ''))
            if (!task) return { success: false, error: '任务不存在' } as any
            return { success: true, task, capability: mediacrawlerCapabilityReport(mediaCrawlerPluginConfig(config)) } as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_platform_media_cancel', kind: 'other', rawInput: args }),
        }),
      ),

      trackTool(ctx, 
        defineTool({
          name: 'dh_get_brief',
          description:
            'Digital Human Studio: read the current company-space client brief (identity, offer, audience, tone, forbid, sample). Use this when writing 口播/文案 if the injected context is not enough.',
          parameters: {},
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(_args, exec) {
            return publicClientBrief(exec?.agent)
          },
          presentCall: () => ({ card: 'generic', title: 'dh_get_brief', kind: 'other' }),
        }),
      ),
      trackTool(ctx,
        defineTool({
          name: 'dh_save_work_copy',
          description:
            '把写好的平台文案存回成片库里指定的那条成片（写完必须调用它，存完前端成片卡片的按钮就从「写文案」变成「文案」，可以直接排期/发布）。抖音、小红书、视频号各一版短文案：抖音/视频号正文 60–120 字，小红书 150–250 字，各带 3–5 个话题标签，不要 Markdown 符号。title/body 传抖音那一版（发布默认用抖音），三个平台的完整内容放 platforms。',
          parameters: {
            id: { type: 'string', description: '成片 ID，exp- 开头，例如 exp-24f2ff0c6eaca58154ff006e99abb751' },
            title: { type: 'string', description: '抖音标题，30 字以内，口语、有钩子' },
            body: { type: 'string', description: '抖音版正文，60–120 字，第一人称口语，不要 # * - 这类符号，分段用换行' },
            platforms: {
              type: 'object',
              description: '三个平台各自的文案：{ douyin: {title,body,tags}, xiaohongshu: {title,body,tags}, shipinhao: {title,body,tags} }。抖音/视频号 60–120 字，小红书 150–250 字，tags 为 3–5 个不带 # 的话题词',
              additionalProperties: true,
            },
            coverText: { type: 'string', description: '封面大字，10 字以内' },
            coverPrompt: { type: 'string', description: '封面画面怎么画，一句话' },
            shots: {
              type: 'array',
              description: '分镜脚本，可选，每项 {shot,visual,voice,seconds}',
              items: { type: 'object', additionalProperties: true },
            },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args: any, exec: any) {
            const space = spaceForAgent(exec?.agent)
            const id = String(args?.id || '').trim()
            const item = loadStudioHistory(space.id).find((row: any) => row.id === id)
            if (!item) throw new Error('这条成片不存在或已经删掉了：' + id)
            const parsed = normalizeCopy({ ...args, coverText: args?.coverText || args?.title, coverPrompt: args?.coverPrompt }, 'ai-chat')
            if (!parsed) throw new Error('文案不合格：标题要有、正文至少 30 字，重写一版再存')
            const copy = { ...parsed, coverError: '' }
            patchStudioHistory(space.id, id, { copy } as any)
            return { ok: true, id, title: copy.title, bodyLength: copy.body.length, platforms: Object.keys(copy.platforms || {}) }
          },
          presentCall: (args: any) => ({ card: 'generic', title: 'dh_save_work_copy', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx,
        defineTool({
          name: 'dh_paint_work_cover',
          description:
            '给成片库里的一条成片画一张封面并发回成片：先取这条视频的真实画面当参考图（useFrame=true），人物、场景跟参考图保持一致，不要虚构人物；再按 prompt 画 16:9 封面，画好把封面写回这条成片，前端封面卡立刻更新。只换封面，不动文案。用户让你「给这条成片画封面/换封面」时用它。',
          parameters: {
            id: { type: 'string', description: '成片 ID，exp- 开头' },
            prompt: { type: 'string', description: '封面画面提示词，中文一句话：画什么画面、构图、光线、留白放大字；画面里不要出现文字' },
            coverText: { type: 'string', description: '封面大字，可选；传了就顺手更新' },
            useFrame: { type: 'boolean', description: 'true=先取视频真实帧当参考图再画（默认，人物不虚构）；false=只按文字画，适合插画封面' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args: any, exec: any) {
            const space = spaceForAgent(exec?.agent)
            const id = String(args?.id || '').trim()
            const item = loadStudioHistory(space.id).find((row: any) => row.id === id)
            if (!item) throw new Error('这条成片不存在或已经删掉了：' + id)
            if (!item.copy) throw new Error('这条成片还没有文案，先用 dh_save_work_copy 写一版再画封面')
            const listed = await listImageModels()
            if (!listed.models.length) throw new Error(listed.note || '小葱 API 还没有可用的生图模型')
            const preferred = listed.models.find((name: string) => /gpt-image/i.test(name)) || listed.models[0]
            const prompt = String(args?.prompt || '').trim() || coverPromptOf(item.copy as any, item.title)
            const useFrame = args?.useFrame !== false
            // 先准备参考帧：优先用已经取好的帧/合成封面，没有就从视频抽一帧
            let refUrl = ''
            let frameNote = ''
            if (useFrame) {
              try {
                let framePath = exportCoverFramePath(space.id, id)
                if (!existsSync(framePath)) {
                  const got = await extractExportFrame(space.id, id, 3)
                  if (got?.path) framePath = got.path
                }
                if (existsSync(framePath)) {
                  refUrl = await uploadImageForFusion(framePath, `cover-${id}.jpg`)
                  if (!refUrl) frameNote = '参考帧上传失败，已按文字画'
                } else {
                  frameNote = '这条成片取不到帧，已按文字画'
                }
              } catch (e: any) {
                refUrl = ''
                frameNote = '参考帧不可用，已按文字画'
              }
            }
            let url = ''
            if (refUrl) {
              // 图生图：参考帧 + 提示词，人物场景保持一致
              const model = preferred
              const fusePrompt = [
                '第一张是这条视频的真实画面，是参考图。人物的长相、发型、年龄、体型、场景都以参考图为准，不要换人、不要虚构人物。',
                prompt,
                '画面里不要出现任何文字、字母、logo、水印。',
              ].join('')
              const payload = await imageGatewayRequest('POST', '/v1/images/generations', {
                model,
                prompt: fusePrompt,
                n: 1,
                size: ratioToImageSize('16:9', model),
                response_format: 'url',
                image: refUrl,
              }, 300000)
              const rows = Array.isArray(payload?.data) ? payload.data : []
              const first = rows[0] || {}
              url = String(first.url || '')
              if (!url && first.b64_json) {
                const bytes = Buffer.from(String(first.b64_json), 'base64')
                const out = exportCoverFramePath(space.id, id)
                mkdirSync(dirname(out), { recursive: true, mode: 0o700 })
                writeFileSync(out, bytes, { mode: 0o600 })
                url = `/digital-human-studio/works/cover-file?space=${encodeURIComponent(space.id)}&id=${encodeURIComponent(id)}&t=${Date.now()}`
              }
            } else {
              const knownIds = new Set(loadStudioHistory(space.id).map((row: any) => row.id))
              const job = await createImageJob({ prompt, model: preferred, ratio: '16:9', title: `${item.title} 封面` })
              if (job?.id) removeStudioHistory(space.id, String(job.id))
              for (const row of loadStudioHistory(space.id)) {
                if (!knownIds.has(row.id) && row.kind === 'ximg') removeStudioHistory(space.id, row.id)
              }
              url = String(job?.url || '')
              if (!url) throw new Error(job?.fail_reason || '生图没有返回图片，换个提示词再试')
            }
            if (!url) throw new Error('生图没有返回图片，换个提示词再试')
            const coverText = String(args?.coverText || '').trim() || item.copy.coverText
            const copy = { ...item.copy, coverUrl: url, coverPrompt: prompt, coverText, coverError: undefined, at: Date.now() }
            patchStudioHistory(space.id, id, { copy } as any)
            return { ok: true, id, coverUrl: url, coverText, basedOnFrame: Boolean(refUrl), note: frameNote }
          },
          presentCall: (args: any) => ({ card: 'generic', title: 'dh_paint_work_cover', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_update_brief',
          description:
            '把当前公司的客户档案写进去或改一处。从对话里归纳对外身份、主营/卖点、对谁说、口吻、不要说、范例口播、品牌事实、痛点原话、证据、结尾目标、自称习惯立刻存上。客户不专业：用人话问，不要让他们填工作台或说行话。目的可以用「想来店 / 想私信 / 想记住店」记进对谁说。只传有内容的字段，短句即可。',
          parameters: {
            identity: { type: 'string', description: '对外身份，例如瓷砖店老板出镜口播。' },
            business: { type: 'string', description: '主营和卖点。' },
            audience: { type: 'string', description: '对谁说。' },
            tone: { type: 'string', description: '口吻。' },
            avoid: { type: 'string', description: '不要说的话。' },
            sample: { type: 'string', description: '一段已经满意的范例口播。' },
            brand: { type: 'string', description: '品牌事实：店名全称、城市/区域、门店数、做几年、价格带、资质。用来防编造。' },
            pains: { type: 'string', description: '客户痛点原话，一行一条，2-3 条。钩子从这几句里挑。' },
            proof: { type: 'string', description: '证据：案例数量、具体数据、客户评价原话、施工前后对比。' },
            cta: { type: 'string', description: '结尾目标动作：到店/私信/评论关键词/领券/加微信，只写一句。' },
            voice: { type: 'string', description: '自称与说话习惯：用我/我们、方言、句子长短、能不能开玩笑。' },
            keywords: { type: 'string', description: '核心关键词与固定话题词（逗号隔开），同时用于文案 #话题 和字幕关键词标色。' },
            videoFormat: { type: 'string', description: '默认画幅与目标时长，例如：竖屏 9:16 · 20-45秒，或横屏 16:9 · 1-3分钟。' },
            editStyle: { type: 'string', description: '剪辑节奏与风格，例如：口播停顿快切（开 cut_on_pause）/ 多段实拍混剪 / 沉稳讲解 / 写实包装。' },
            visualStyle: { type: 'string', description: '字幕、花字与调色规范，例如：关键词标色（keyword）+ 避脸 + 暖调 warm_soft。' },
            audioStyle: { type: 'string', description: '声音与 BGM 偏好，例如：人声降噪 clean + 自动轻快 BGM 压人声。' },
            outroTemplate: { type: 'string', description: '固定片头/片尾落版文案，例如：片尾 3 秒展示店名 + 评论领清单。' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            applySpaceStore(patchSpace(spaceStore, space.id, { brief: args }))
            return publicClientBrief(exec?.agent)
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_update_brief', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_engine_status',
          description:
            'Digital Human Studio: check whether local Xiaocongcut (default http://127.0.0.1:9001) is online, and whether this plugin manages its PID. If offline, returns a start_command / use dh_engine_start.',
          parameters: {},
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute() {
            return getStatus()
          },
          presentCall: () => ({ card: 'generic', title: 'dh_engine_status', kind: 'other' }),
        }),
      ),
      trackTool(ctx,
        defineTool({
          name: 'dh_render_batch',
          description:
            'Digital Human Studio: 批量渲染。传一份含 videos[] 的配方文件路径（或 recipes 数组），一次出多条 mp4，默认并发 2 且每条出完自动质检。返回 batch_id，用 dh_render_status 传 batch_id 也能查（同一接口）。',
          parameters: {
            path: { type: 'string', description: '含 {"videos":[...]} 的配方文件路径' },
            concurrency: { type: 'number', description: '并发数 1–4，默认 2' },
            preset: { type: 'string', description: 'final（默认）/ preview' },
            out_dir: { type: 'string', description: '输出目录，默认 ~/Movies/xcy-out' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args: any = {}) {
            if (!args.path) return { success: false, error: '需要 path（含 videos[] 的配方）' }
            const body: Record<string, unknown> = {
              path: expandPath(String(args.path)),
              concurrency: Number(args.concurrency || 2),
              preset: String(args.preset || 'final'),
            }
            if (args.out_dir) body.out_dir = expandPath(String(args.out_dir))
            const r = await vcFetch('/xcy/render_batch', body)
            return r.data ?? { success: false, error: r.error }
          },
          presentCall: () => ({ card: 'generic', title: 'dh_render_batch', kind: 'other' }),
        }),
      ),
      trackTool(ctx,
        defineTool({
          name: 'dh_qc_video',
          description:
            'Digital Human Studio: 给成片做质检（黑帧 / 静音 / 响度 / 时长 / 分辨率），返回 pass / warn / fail 与逐项原因。',
          parameters: {
            path: { type: 'string', description: 'mp4 路径' },
            expected_duration: { type: 'number', description: '期望时长（秒），用于比对' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args: any = {}) {
            if (!args.path) return { success: false, error: '需要 path' }
            const r = await vcFetch('/xcy/qc', {
              path: expandPath(String(args.path)),
              expected_duration: args.expected_duration,
            })
            return r.data ?? { success: false, error: r.error }
          },
          presentCall: () => ({ card: 'generic', title: 'dh_qc_video', kind: 'other' }),
        }),
      ),
      trackTool(ctx,
        defineTool({
          name: 'dh_probe_video',
          description:
            'Digital Human Studio: 探测本地视频/图片/音频素材元数据（时长 duration、宽高 width/height、帧率 fps、类型 kind、是否存在）。剪辑或决定横竖屏前先调这个，不要猜时长。',
          parameters: {
            path: { type: 'string', description: '单个素材的本地绝对路径或 ~/...' },
            paths: {
              type: 'array',
              description: '多个素材的本地路径数组（最多 100 个）',
              items: { type: 'string' },
            },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args: any = {}) {
            const list: string[] = []
            if (Array.isArray(args.paths)) {
              for (const p of args.paths) if (p) list.push(expandPath(String(p)))
            }
            if (args.path) list.push(expandPath(String(args.path)))
            const unique = Array.from(new Set(list)).slice(0, 100)
            if (!unique.length) return { success: false, error: '请提供 path 或 paths' }
            const r = await vcFetch('/xcy/probe', { paths: unique })
            return r.data ?? { success: false, error: r.error || '探测失败' }
          },
          presentCall: () => ({ card: 'generic', title: 'dh_probe_video', kind: 'other' }),
        }),
      ),
      trackTool(ctx,
        defineTool({
          name: 'dh_transcribe',
          description:
            'Digital Human Studio: 本地语音转字幕（faster-whisper，不上传云端）。输入视频或音频路径，返回带时间戳的句子数组 segments（含 start/end/text，words=true 时含词级时间），可选导出 .srt。适合听清口播内容、找气口/金句再下刀剪辑。',
          parameters: {
            path: { type: 'string', description: '本地视频或音频路径' },
            language: { type: 'string', description: '语言代码，默认 zh' },
            model: { type: 'string', description: '模型名，默认 small' },
            words: { type: 'boolean', description: 'true = 返回词级时间戳（逐字字幕/卡点用）' },
            max_chars: { type: 'number', description: '单句字幕最大字数，默认 14' },
            srt_out: { type: 'string', description: '可选：顺便保存 .srt 文件路径' },
            force: { type: 'boolean', description: 'true = 忽略缓存重新转写' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args: any = {}) {
            const src = expandPath(String(args.path || '').trim())
            if (!src) return { success: false, error: '请提供本地音视频 path' }
            const body: Record<string, unknown> = {
              path: src,
              language: String(args.language || 'zh'),
              model: String(args.model || 'small'),
              words: Boolean(args.words),
              max_chars: Number(args.max_chars || 14),
              force: Boolean(args.force),
            }
            if (args.srt_out) body.srt_out = expandPath(String(args.srt_out))
            const r = await vcFetch('/xcy/transcribe', body)
            return r.data ?? { success: false, error: r.error || '转写失败' }
          },
          presentCall: () => ({ card: 'generic', title: 'dh_transcribe', kind: 'other' }),
        }),
      ),
      trackTool(ctx,
        defineTool({
          name: 'dh_list_editing_presets',
          description:
            'Digital Human Studio: 一次性查询本机剪辑引擎的全部可用预设（字幕样式 subtitle_styles、调色 luts、包装图形 graphics、BGM 曲库 bgm、人声增强档位 voice_fx、花字预设 styles、以及现成配方 recipes）。调 dh_quick_edit 或 dh_render_recipe 前不确定的参数可以一次查清。',
          parameters: {
            category: {
              type: 'string',
              description: '可选：all（默认）/ recipes / subtitles / luts / graphics / bgm / voice_fx / styles',
            },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args: any = {}) {
            const cat = String(args.category || 'all').toLowerCase()
            const want = (k: string) => cat === 'all' || cat === k
            const out: Record<string, any> = { success: true }
            const jobs: Array<Promise<void>> = []
            const pull = (key: string, endpoint: string) => {
              jobs.push(
                vcFetch(endpoint, undefined, 'GET').then((r) => {
                  out[key] = r.ok ? r.data : { error: r.error || `HTTP ${r.status}` }
                }),
              )
            }
            if (want('subtitles')) pull('subtitle_styles', '/xcy/subtitle_styles')
            if (want('luts')) pull('luts', '/xcy/luts')
            if (want('graphics')) pull('graphics', '/xcy/graphics')
            if (want('bgm')) pull('bgm', '/xcy/bgm')
            if (want('voice_fx')) pull('voice_fx', '/xcy/voice_fx')
            if (want('styles')) pull('styles', '/xcy/styles')
            if (want('recipes')) {
              const dirs = Array.from(new Set([
                join(BUNDLED_XIAOCONGCUT_ROOT, 'recipes'),
                join(expandPath(config.xiaocongcutRoot || DEFAULT_XIAOCONGCUT_ROOT), 'recipes'),
              ]))
              const recipes: Array<{ name: string; path: string; title?: string }> = []
              const seen = new Set<string>()
              for (const dir of dirs) {
                if (!existsSync(dir)) continue
                try {
                  for (const file of readdirSync(dir)) {
                    if (!file.endsWith('.json') || seen.has(file)) continue
                    seen.add(file)
                    const full = join(dir, file)
                    let title = ''
                    try {
                      const raw = JSON.parse(readFileSync(full, 'utf8'))
                      title = String(raw?.name || raw?.title || '')
                    } catch { /* ignore */ }
                    recipes.push({ name: file, path: full, ...(title ? { title } : {}) })
                  }
                } catch { /* ignore */ }
              }
              out.recipes = recipes.slice(0, 60)
            }
            await Promise.all(jobs)
            return out
          },
          presentCall: () => ({ card: 'generic', title: 'dh_list_editing_presets', kind: 'other' }),
        }),
      ),
      trackTool(ctx,
        defineTool({
          name: 'dh_quick_edit',
          description:
            'Digital Human Studio: 【推荐优先使用】一步到位快速剪辑并直出 mp4（无需剪映，渲染完成后自动入「成片库」）。只需传入本地视频/图片路径数组 clips，可选开启自动识别字幕（含关键词标色/逐字/避脸）、按停顿切镜推拉、人声降噪、自动配 BGM 压人声、调色 LUT、背景虚化、片头片尾、花字与音效。适合「帮我把这段视频加字幕/去气口/配音乐/混剪成片」等 90% 日常快剪需求。',
          parameters: {
            paths: {
              type: 'array',
              description: '最简传法：要剪辑的本地视频/图片路径数组（与 clips 二选一，顺序即时间线顺序）',
              items: { type: 'string' },
            },
            clips: {
              type: 'array',
              description:
                '精细传法：片段对象数组（与 paths 二选一），每项 { source, start?, end?, duration?, speed?, volume?, transition_in?: { type, duration } }',
              items: { type: 'object', additionalProperties: true },
            },
            title: { type: 'string', description: '成片标题（可选，用于输出文件名和成片库展示）' },
            orientation: {
              type: 'string',
              description: '画幅方向：auto（默认，按第一段素材自动判竖屏 1080x1920 或横屏 1920x1080）/ portrait / landscape',
            },
            subtitles: {
              type: 'string',
              description:
                '自动烧入字幕样式：off（关闭）/ trendy_red（网感口播高级红，思源粗宋双语错落）/ trendy_gold（黑金杂志）/ trendy_cyan（极简白青）/ douyin_bottom（白字黑边）/ bar_bottom（半透明底条）/ keyword（关键词标色）/ karaoke（逐字点亮）',
            },
            theme: {
              type: 'string',
              description: '可选高颜值一键视觉皮肤：trendy_red（网感口播·高级红）/ trendy_gold（黑金杂志）/ trendy_cyan（极简白青）；传了会自动套用对应字幕与双行反色标题风格',
            },
            top_title: { type: 'string', description: '可选：前 5 秒顶部双行大标题上行（≤8 字，配合 theme 使用）' },
            bottom_title: { type: 'string', description: '可选：前 5 秒顶部双行大标题下行（≤8 字，配合 theme 使用）' },
            highlight_keywords: { type: 'boolean', description: '字幕自动关键词标色（当开启字幕时生效）' },
            cut_on_pause: { type: 'boolean', description: '口播按停顿自动切镜并交替轻微推拉（注意：与 bg_blur 互斥）' },
            voice_fx: { type: 'string', description: '人声增强降噪：off / clean（默认）/ strong' },
            bgm: { type: 'string', description: '背景音乐：auto（默认，自动选曲并压人声）/ off / 或本地 mp3 绝对路径' },
            bgm_volume: { type: 'number', description: 'BGM 音量 0–1，默认 0.12' },
            lut: { type: 'string', description: '调色 LUT 预设名（如 warm_soft），可用 dh_list_editing_presets 查看' },
            lut_strength: { type: 'number', description: '调色强度 0–1，默认 0.8' },
            bg_blur: { type: 'number', description: '背景虚化强度 0–1（如 0.6；开启后会自动跳过 cut_on_pause）' },
            intro: {
              type: 'object',
              additionalProperties: true,
              description: '可选片头卡：{ text, sub?, dur? }（加时长，不盖开头画面）',
            },
            outro: {
              type: 'object',
              additionalProperties: true,
              description: '可选片尾卡：{ text, sub?, dur? }',
            },
            texts: {
              type: 'array',
              description:
                '可选花字层数组：每项 { text, style?: "hook_yellow"|"subtitle_white"|"warn_orange"|"shop_sign"|"title_gold"|"plain", start, end, pos?: "top"|"center"|"lower_third"|"auto", avoid?: "person", intro?: "Fade_In"|"Slide_Up"|"Mini_Zoom" }',
              items: { type: 'object', additionalProperties: true },
            },
            sfx: {
              type: 'array',
              description: '可选音效数组：每项 { name?: "whoosh"|"riser"|"ding"|"stamp"|"count"|"check", path?, at, volume? }',
              items: { type: 'object', additionalProperties: true },
            },
            preset: { type: 'string', description: '渲染档位：final（默认高清）/ preview（半分辨率快渲预览）' },
            out: { type: 'string', description: '可选输出 mp4 路径；默认 ~/Movies/xcy-out/' },
            wait_sec: { type: 'number', description: '等待出片秒数，默认 120；传 0 立即返回 task_id' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args: any = {}, exec?: { agent?: unknown }) {
            const rawClips = [
              ...(Array.isArray(args.paths) ? args.paths : []),
              ...(Array.isArray(args.clips) ? args.clips : []),
            ]
            if (!rawClips.length) {
              return { success: false, error: 'paths 或 clips 至少传一个本地视频/图片路径' }
            }
            const clips: Array<Record<string, unknown>> = []
            for (const item of rawClips) {
              if (typeof item === 'string' && item.trim()) {
                clips.push({ source: expandPath(item.trim()) })
              } else if (item && typeof item === 'object' && item.source) {
                const c: Record<string, unknown> = { ...item, source: expandPath(String(item.source).trim()) }
                clips.push(c)
              }
            }
            if (!clips.length) {
              return { success: false, error: 'clips 中没有有效的本地文件路径（需要 source）' }
            }

            // 探测第一段素材以自动决定画幅（orientation=auto）并检查文件是否存在
            let size: [number, number] = [1080, 1920]
            const orient = String(args.orientation || 'auto').toLowerCase()
            if (orient === 'landscape' || orient === '16:9') {
              size = [1920, 1080]
            } else if (orient === 'portrait' || orient === '9:16') {
              size = [1080, 1920]
            } else {
              const probed = await vcFetch('/xcy/probe', { paths: clips.map(c => String(c.source)) })
              const items = Array.isArray(probed.data?.items) ? probed.data.items : []
              const missing = items.filter((it: any) => !it.exists).map((it: any) => it.path)
              if (missing.length) {
                return { success: false, error: `以下素材不存在或不可读：${missing.join(', ')}` }
              }
              const first = items[0]
              if (first && Number(first.width) > Number(first.height) && Number(first.height) > 0) {
                size = [1920, 1080]
              }
            }

            const title = String(args.title || '').trim() || `快剪成片`
            const recipe: Record<string, unknown> = {
              name: title,
              size,
              clips,
            }

            // 字幕配置（若指定 theme 则默认走对应网感口播皮肤，否则白字黑边 + 自动避脸）
            const themeKey = ['trendy_red', 'trendy_gold', 'trendy_cyan'].includes(String(args.theme || '').trim())
              ? String(args.theme).trim()
              : ''
            const subArg = args.subtitles
            if (subArg !== false && String(subArg || '').toLowerCase() !== 'off' && String(subArg || '').toLowerCase() !== 'none') {
              const style = typeof subArg === 'string' && subArg.trim() && subArg !== 'true'
                ? subArg.trim()
                : (themeKey || (args.highlight_keywords ? 'keyword' : 'douyin_bottom'))
              const subCfg: Record<string, unknown> = {
                mode: 'auto',
                source: 'clips[0]',
                style,
                avoid_face: true,
                language: 'zh',
                ...(style.startsWith('trendy_') ? { max_chars: 12 } : {}),
              }
              if (args.highlight_keywords || style === 'keyword' || style.startsWith('trendy_')) {
                subCfg.highlight = { mode: 'auto' }
              }
              recipe.subtitles = subCfg
            }
            // 若传了 top_title / bottom_title，自动叠加前 5 秒双行反色大标题
            const heroTexts: Array<Record<string, unknown>> = []
            const heroTheme = themeKey || 'trendy_red'
            if (typeof args.top_title === 'string' && args.top_title.trim()) {
              heroTexts.push({
                text: args.top_title.trim(),
                style: `${heroTheme}_top`,
                start: 0,
                end: 5,
                font_size: size[0] <= 1080 ? 92 : 76,
                pos: { an: 9, x: 0.92, y: 0.11 },
                intro: 'Fade_In',
              })
            }
            if (typeof args.bottom_title === 'string' && args.bottom_title.trim()) {
              heroTexts.push({
                text: args.bottom_title.trim(),
                style: `${heroTheme}_bottom`,
                start: 0,
                end: 5,
                font_size: size[0] <= 1080 ? 98 : 82,
                pos: { an: 9, x: 0.92, y: 0.185 },
                intro: 'Fade_In',
              })
            }
            if (heroTexts.length) {
              recipe.texts = [...heroTexts, ...(Array.isArray(args.texts) ? args.texts : [])]
            }

            // 声音层（人声增强 + BGM）
            const audioCfg: Record<string, unknown> = {}
            const voiceFx = String(args.voice_fx || 'clean').toLowerCase()
            if (['off', 'clean', 'strong'].includes(voiceFx)) {
              audioCfg.voice_fx = voiceFx
            }
            const bgmArg = args.bgm === undefined ? 'auto' : String(args.bgm).trim()
            if (bgmArg && bgmArg.toLowerCase() !== 'off' && bgmArg.toLowerCase() !== 'none') {
              const vol = Number(args.bgm_volume ?? 0.12)
              if (bgmArg.toLowerCase() === 'auto') {
                audioCfg.bgm = { mode: 'auto', volume: vol, duck: true }
              } else {
                audioCfg.bgm = { path: expandPath(bgmArg), volume: vol, duck: true }
              }
            }
            if (Object.keys(audioCfg).length) recipe.audio = audioCfg

            // 画面调色 / 背景虚化
            const lookCfg: Record<string, unknown> = {}
            if (args.lut && String(args.lut).toLowerCase() !== 'none' && String(args.lut).toLowerCase() !== 'off') {
              lookCfg.lut = String(args.lut)
              lookCfg.strength = Number(args.lut_strength ?? 0.8)
            }
            if (typeof args.bg_blur === 'number' && args.bg_blur > 0) {
              lookCfg.bg_blur = Math.min(1, Math.max(0, args.bg_blur))
            }
            if (Object.keys(lookCfg).length) recipe.look = lookCfg

            // 停顿切镜
            if (args.cut_on_pause) {
              recipe.rhythm = { cut_on_pause: true }
            }

            // 片头片尾 / 花字 / 音效
            if (args.intro && typeof args.intro === 'object' && args.intro.text) recipe.intro = args.intro
            if (args.outro && typeof args.outro === 'object' && args.outro.text) recipe.outro = args.outro
            if (!heroTexts.length && Array.isArray(args.texts) && args.texts.length) recipe.texts = args.texts
            if (Array.isArray(args.sfx) && args.sfx.length) {
              const resolvedSfx: Array<Record<string, unknown>> = []
              for (const s of args.sfx) {
                if (!s || typeof s !== 'object') continue
                let p = typeof s.path === 'string' && s.path.trim() ? expandPath(s.path.trim()) : ''
                if (!p && typeof s.name === 'string' && s.name.trim()) {
                  const found = sfxPath(s.name.trim())
                  if (found) p = found
                } else if (p && !existsSync(p)) {
                  const found = sfxPath(String(s.path).trim())
                  if (found) p = found
                }
                if (!p) continue
                resolvedSfx.push({
                  path: p,
                  at: Number(s.at ?? 0),
                  volume: Number(s.volume ?? 0.55),
                  ...(s.fade_in !== undefined ? { fade_in: Number(s.fade_in) } : {}),
                  ...(s.fade_out !== undefined ? { fade_out: Number(s.fade_out) } : {}),
                })
              }
              if (resolvedSfx.length) recipe.sfx = resolvedSfx
            }

            const body: Record<string, unknown> = {
              recipe: normalizeRecipeFonts(recipe),
              preset: String(args.preset || 'final'),
            }
            if (args.out) body.out = expandPath(String(args.out))

            const submitted = await vcFetch('/xcy/render', body)
            if (!submitted.ok || !submitted.data?.task_id) {
              return { success: false, error: submitted.error || submitted.data?.error || '提交快速剪辑任务失败' }
            }
            const taskId = String(submitted.data.task_id)
            const waitSec = args.wait_sec === 0 ? 0 : Math.max(5, Number(args.wait_sec || 120))
            if (!waitSec) {
              return {
                success: true,
                task_id: taskId,
                status: 'queued',
                recipe_summary: { size, clips: clips.length, subtitles: !!recipe.subtitles, bgm: !!audioCfg.bgm },
              }
            }

            const deadline = Date.now() + waitSec * 1000
            let last: any = { status: 'queued', progress: 0 }
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 1500))
              const r = await vcFetch(`/xcy/render/${encodeURIComponent(taskId)}`, undefined, 'GET')
              if (r.ok && r.data) last = r.data
              if (['done', 'error', 'cancelled'].includes(String(last.status))) break
            }
            const done = String(last.status) === 'done'
            const spaceId = spaceForAgent(exec?.agent).id
            const work = done ? registerRenderedWork(spaceId, last.out, title) : null
            return {
              success: done,
              task_id: taskId,
              ...last,
              ...(work ? { work, hint: '成片已自动加入当前空间的「成片库」，可在工作台预览、写文案或排期发布。' } : {}),
            }
          },
          presentCall: (args) => ({
            card: 'generic',
            title: `快速剪辑：${String((args as any)?.title || '成片')}`,
            kind: 'other',
          }),
        }),
      ),
      trackTool(ctx,
        defineTool({
          name: 'dh_trendy_koubo',
          description:
            'Digital Human Studio: 【网感口播一键直出】按「高级红 trendy_red / 黑金杂志 trendy_gold / 极简白青 trendy_cyan」规范直接本机渲染 mp4 并自动入「成片库」+ 保存可编辑剪辑工程。原生支持前 5 秒双行反色大标题、思源粗宋中英双语、8–12 字左上/右下错落分层、关键词放大厚描边弹动、金句 1.18x 缩放、段间转场、提示音与低音量 BGM 压人声。',
          parameters: {
            video_path: { type: 'string', description: '口播视频本地绝对路径（单段时传此项）' },
            clips: {
              type: 'array',
              description: '可选：多段视频/去气口切分后的片段数组 [{ source, start?, end? }]',
              items: { type: 'object', additionalProperties: true },
            },
            theme: { type: 'string', description: '视觉皮肤：trendy_red（默认，高级红）/ trendy_gold（黑金杂志）/ trendy_cyan（极简白青）' },
            name: { type: 'string', description: '成片与工程名称（可选）' },
            title: {
              type: 'object',
              additionalProperties: true,
              description: '前 5 秒双行反色大标题：{ top_title: "≤8字", bottom_title?: "≤8字", duration?: 5 }',
            },
            subtitle_items: {
              type: 'array',
              description: '可选：语义规划后的字幕数组，每项 { text: "≤12字", en?: "≤8词英文", keyword?: "高亮词", start?: 秒, end?: 秒, layered?: boolean }；不传则自动转写+自动标词',
              items: { type: 'object', additionalProperties: true },
            },
            remove_silence: { type: 'boolean', description: '是否开启自动去停顿切镜（默认 true）' },
            transitions: {
              type: 'array',
              description: '多段转场：[{ seg_index, type: "向右"|"向左"|"竖向模糊", duration?: 0.4 }]',
              items: { type: 'object', additionalProperties: true },
            },
            zoom: {
              type: 'object',
              additionalProperties: true,
              description: '全片金句强调缩放：{ trigger_sub_index: number, scale?: 1.18 }',
            },
            tone_presets: {
              type: 'array',
              description: '提示音效：[{ tone_type: "emphasis"|"result", trigger_sub_index: number }]',
              items: { type: 'object', additionalProperties: true },
            },
            bgm: { type: 'string', description: '背景音乐：auto（默认）/ off / 本地 mp3 路径' },
            bgm_volume: { type: 'number', description: 'BGM 音量 0–1，默认 0.10' },
            voice_fx: { type: 'string', description: '人声增强：clean（默认）/ strong / off' },
            lut: { type: 'string', description: '可选轻调色 LUT 预设名' },
            preset: { type: 'string', description: '渲染档位：final（默认）/ preview' },
            render_mp4: { type: 'boolean', description: '是否本机渲染 mp4 成片（默认 true；传 false 跳过视频编码，1-2 秒仅导出剪映草稿）' },
            export_jianying_draft: { type: 'boolean', description: '是否同步导出可直接在剪映 Pro 打开的多轨草稿（默认 true）' },
            draft_folder: { type: 'string', description: '可选剪映草稿目录，默认使用已配置的剪映草稿目录' },
            out: { type: 'string', description: '可选输出 mp4 路径' },
            wait_sec: { type: 'number', description: '等待出片秒数，默认 120；传 0 立即返回 task_id' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args: any = {}, exec?: { agent?: unknown }) {
            const renderMp4 = args.render_mp4 !== false
            const payload: Record<string, unknown> = {
              render_mp4: renderMp4,
              export_jianying_draft: renderMp4 ? (args.export_jianying_draft !== false) : true,
              ...(config.lastProjectFolder ? { draft_folder: config.lastProjectFolder } : {}),
              ...args,
            }
            if (!renderMp4) payload.export_jianying_draft = true
            if (typeof args.video_path === 'string' && args.video_path.trim()) {
              payload.video_path = expandPath(args.video_path.trim())
            }
            if (Array.isArray(args.clips)) {
              payload.clips = args.clips.map((c: any) => (
                typeof c === 'string'
                  ? { source: expandPath(c.trim()) }
                  : (c && typeof c === 'object' && c.source ? { ...c, source: expandPath(String(c.source).trim()) } : c)
              ))
            }
            if (typeof args.out === 'string' && args.out.trim()) {
              payload.out = expandPath(args.out.trim())
            }
            if (typeof args.draft_folder === 'string' && args.draft_folder.trim()) {
              payload.draft_folder = expandPath(args.draft_folder.trim())
            }
            if (typeof args.bgm === 'string' && args.bgm.trim() && !['auto', 'off', 'none'].includes(args.bgm.trim().toLowerCase())) {
              payload.bgm = expandPath(args.bgm.trim())
            }
            const submitted = await vcFetch('/xcy/trendy_koubo', payload)
            if (!renderMp4) {
              const jianyingDraft = submitted.data?.jianying_draft || null
              const ok = Boolean(submitted.ok && submitted.data?.success && jianyingDraft?.ok)
              return {
                success: ok,
                status: ok ? 'done' : 'error',
                render_mp4: false,
                theme: submitted.data?.theme || args.theme || 'trendy_red',
                project_path: String(submitted.data?.project_path || ''),
                jianying_draft: jianyingDraft,
                ...(ok
                  ? { hint: `已秒出剪映多轨草稿「${jianyingDraft?.project_name || args.name || '网感口播'}」（未渲染 mp4），打开剪映 Pro 即可直接二次编辑。` }
                  : { error: submitted.error || submitted.data?.error || jianyingDraft?.error || '仅导出剪映草稿失败' }),
              }
            }
            if (!submitted.ok || !submitted.data?.task_id) {
              return { success: false, error: submitted.error || submitted.data?.error || '提交网感口播任务失败' }
            }
            const taskId = String(submitted.data.task_id)
            const projectPath = String(submitted.data.project_path || '')
            const jianyingDraft = submitted.data.jianying_draft || null
            const workTitle = String(args.name || args.title?.top_title || '网感口播成片').trim()
            const waitSec = args.wait_sec === 0 ? 0 : Math.max(5, Number(args.wait_sec || 120))
            if (!waitSec) {
              return {
                success: true,
                task_id: taskId,
                status: 'queued',
                theme: submitted.data.theme || args.theme || 'trendy_red',
                project_path: projectPath,
                ...(jianyingDraft ? { jianying_draft: jianyingDraft } : {}),
              }
            }
            const deadline = Date.now() + waitSec * 1000
            let last: any = { status: 'queued', progress: 0 }
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 1500))
              const r = await vcFetch(`/xcy/render/${encodeURIComponent(taskId)}`, undefined, 'GET')
              if (r.ok && r.data) last = r.data
              if (['done', 'error', 'cancelled'].includes(String(last.status))) break
            }
            const done = String(last.status) === 'done'
            const spaceId = spaceForAgent(exec?.agent).id
            const work = done ? registerRenderedWork(spaceId, last.out, workTitle) : null
            return {
              success: done,
              task_id: taskId,
              theme: submitted.data.theme || args.theme || 'trendy_red',
              project_path: projectPath,
              ...(jianyingDraft ? { jianying_draft: jianyingDraft } : {}),
              ...last,
              ...(work ? {
                work,
                hint: jianyingDraft?.ok
                  ? `网感口播成片已自动入「成片库」，同时已导出剪映草稿「${jianyingDraft.project_name || workTitle}」到剪映草稿目录（打开剪映 Pro 即可直接二次编辑）。`
                  : '网感口播成片已自动入「成片库」，工程也已保存到「剪辑台」可随时微调。',
              } : {}),
            }
          },
          presentCall: (args) => ({
            card: 'generic',
            title: `网感口播：${String((args as any)?.name || (args as any)?.title?.top_title || '高级红成片')}`,
            kind: 'other',
          }),
        }),
      ),
      trackTool(ctx,
        defineTool({
          name: 'dh_render_status',
          description:
            'Digital Human Studio: 查配方渲染进度。传 task_id；返回 status（queued/running/done/error）、progress、stage、out 路径。完成时自动登记到「成片库」。',
          parameters: {
            task_id: { type: 'string', description: 'dh_render_recipe / dh_quick_edit 返回的 task_id' },
            cancel: { type: 'boolean', description: 'true = 取消这个渲染' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args: any = {}, exec?: { agent?: unknown }) {
            const asBatch = String(args.task_id || '').startsWith('bat_')
            const taskId = String(args.task_id || '')
            if (!taskId) return { success: false, error: '缺 task_id' }
            if (asBatch) {
              const r = await vcFetch(`/xcy/render_batch/${encodeURIComponent(taskId)}`,
                undefined,
                'GET',
              )
              return r.data ?? { success: false, error: r.error }
            }
            if (args.cancel) {
              const r = await vcFetch(`/xcy/render/${encodeURIComponent(taskId)}/cancel`,
                {},
              )
              return r.data ?? { success: false, error: r.error }
            }
            const r = await vcFetch(`/xcy/render/${encodeURIComponent(taskId)}`,
              undefined,
              'GET',
            )
            const data = r.data
            if (data && String(data.status) === 'done' && data.out) {
              const work = registerRenderedWork(spaceForAgent(exec?.agent).id, data.out)
              if (work) return { ...data, work }
            }
            return data ?? { success: false, error: r.error }
          },
          presentCall: () => ({ card: 'generic', title: 'dh_render_status', kind: 'other' }),
        }),
      ),
      trackTool(ctx,
        defineTool({
          name: 'dh_render_recipe',
          description:
            'Digital Human Studio: 把自定义配方直接渲染成 mp4（不经过剪映，也不写草稿，完成后自动登记到「成片库」）。传 recipe 对象或 path（配方文件路径）。异步任务，返回 task_id；wait_sec 内会等到出片（默认 90 秒，长片建议传 0 只要 task_id 再用 dh_render_status 轮询）。',
          parameters: {
            path: { type: 'string', description: '配方文件绝对路径；与 recipe 二选一' },
            recipe: { type: 'object', additionalProperties: true, description: '配方对象；与 path 二选一' },
            out: { type: 'string', description: '输出 mp4 路径，默认 ~/Movies/xcy-out/<名字>-时间.mp4' },
            preset: { type: 'string', description: 'final（默认）/ preview（半分辨率快渲）' },
            wait_sec: { type: 'number', description: '等待出片的秒数，0 = 立即返回 task_id' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args: any = {}, exec?: { agent?: unknown }) {
            const body: Record<string, unknown> = {}
            if (args.path) body.path = expandPath(String(args.path))
            if (args.recipe) body.recipe = normalizeRecipeFonts(args.recipe)
            if (!body.path && !body.recipe) {
              return { success: false, error: 'path 或 recipe 至少给一个' }
            }
            if (args.out) body.out = expandPath(String(args.out))
            if (args.preset) body.preset = String(args.preset)

            const submitted = await vcFetch('/xcy/render', body)
            if (!submitted.ok || !submitted.data?.task_id) {
              return { success: false, error: submitted.error || submitted.data?.error || '提交失败' }
            }
            const taskId = String(submitted.data.task_id)
            const waitSec = args.wait_sec === 0 ? 0 : Math.max(5, Number(args.wait_sec || 90))
            if (!waitSec) return { success: true, task_id: taskId, status: 'queued' }

            const deadline = Date.now() + waitSec * 1000
            let last: any = { status: 'queued', progress: 0 }
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 1500))
              const r = await vcFetch(`/xcy/render/${encodeURIComponent(taskId)}`,
                undefined,
                'GET',
              )
              if (r.ok && r.data) last = r.data
              if (['done', 'error', 'cancelled'].includes(String(last.status))) break
            }
            const done = String(last.status) === 'done'
            const title = typeof args.recipe?.name === 'string' ? args.recipe.name : undefined
            const work = done ? registerRenderedWork(spaceForAgent(exec?.agent).id, last.out, title) : null
            return {
              success: done,
              task_id: taskId,
              ...last,
              ...(work ? { work } : {}),
            }
          },
          presentCall: () => ({ card: 'generic', title: 'dh_render_recipe', kind: 'other' }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_engine_start',
          description:
            'Digital Human Studio: start the local Xiaocongcut server (capcut_server.py) if it is down. No-op success when already online. Logs to /tmp/xiaocongcut.log and tracks PID in ~/.dsh/digital-human-studio.json.',
          parameters: {},
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute() {
            return engineStart()
          },
          presentCall: () => ({ card: 'generic', title: 'dh_engine_start', kind: 'other' }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_engine_stop',
          description:
            'Digital Human Studio: stop the Xiaocongcut process previously started by this plugin (tracked enginePid only). Refuses to kill unrelated processes.',
          parameters: {},
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute() {
            return engineStop()
          },
          presentCall: () => ({ card: 'generic', title: 'dh_engine_stop', kind: 'other' }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_list_drafts',
          description:
            'Digital Human Studio: scan a local Jianying/Xiaocongcut project folder for drafts. Pass folder or omit to use the last selected folder. Remembers the folder for later chat/panel use.',
          parameters: {
            folder: {
              type: 'string',
              description:
                'Absolute path to the drafts parent folder (e.g. ~/Movies/JianyingPro/.../com.lveditor.draft). Optional if already selected.',
            },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args, exec) {
            return listDrafts(args.folder, spaceForAgent(exec?.agent).id)
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_list_drafts',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_load_draft',
          description:
            'Digital Human Studio: load a draft by absolute path or by name inside the selected folder. Sets it as the active draft for subsequent add/save/export tools.',
          parameters: {
            path: { type: 'string', description: 'Absolute draft directory path.' },
            name: {
              type: 'string',
              description: 'Draft folder name / draft_id inside the selected project folder.',
            },
            folder: {
              type: 'string',
              description: 'Optional project folder override when resolving name.',
            },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args, exec) {
            return loadDraft(args, spaceForAgent(exec?.agent).id)
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_load_draft',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_create_draft',
          description:
            'Digital Human Studio: create a new Xiaocongcut draft (default 1080x1920). Returns draft_id used by later tools.',
          parameters: {
            width: { type: 'integer', description: 'Canvas width, default 1080.' },
            height: { type: 'integer', description: 'Canvas height, default 1920.' },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args, exec) {
            return createDraft(args, spaceForAgent(exec?.agent).id)
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_create_draft',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_add_video',
          description:
            'Digital Human Studio: add one local clip into the active draft. Mixcut must pass start/end in seconds (source in/out). Do not dump whole files with paths[] unless the user asked to concatenate full clips.',
          parameters: {
            draft_id: {
              type: 'string',
              description: 'Draft id. Optional if a draft is already selected/created.',
            },
            path: { type: 'string', description: 'Single local video path or URL. Prefer one shot per call.' },
            paths: {
              type: 'array',
              description: 'Only for concatenating full files. Mixcut should use path + start + end per shot instead.',
              items: { type: 'string' },
            },
            start: { type: 'number', description: 'Source in-point in seconds. Default 0.' },
            end: { type: 'number', description: 'Source out-point in seconds. Required for mixcut shots. Omit only to use full remaining duration.' },
            target_start: { type: 'number', description: 'Timeline start in seconds. 0 = append after previous clip.' },
            duration: { type: 'number', description: 'Full source media duration in seconds if already known.' },
            volume: { type: 'number', description: 'Clip volume, 1 = original. Use 0 to mute B-roll.' },
            speed: { type: 'number', description: 'Playback speed, default 1.' },
            track_name: { type: 'string', description: 'Track name, default video_main.' },
            width: { type: 'integer', description: 'Canvas width override.' },
            height: { type: 'integer', description: 'Canvas height override.' },
            transition: { type: 'string', description: 'Optional local CapCut/Jianying transition enum name (via local 9001 /add_video).' },
            transition_duration: { type: 'number', description: 'Transition duration seconds, default 0.5.' },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args, exec) {
            return addVideo({
              draft_id: args.draft_id ? String(args.draft_id) : undefined,
              path: args.path ? String(args.path) : undefined,
              paths: Array.isArray(args.paths) ? args.paths.map(item => String(item)) : undefined,
              width: args.width != null ? Number(args.width) : undefined,
              height: args.height != null ? Number(args.height) : undefined,
              start: args.start != null ? Number(args.start) : undefined,
              end: args.end != null ? Number(args.end) : undefined,
              target_start: args.target_start != null ? Number(args.target_start) : undefined,
              duration: args.duration != null ? Number(args.duration) : undefined,
              volume: args.volume != null ? Number(args.volume) : undefined,
              speed: args.speed != null ? Number(args.speed) : undefined,
              track_name: args.track_name ? String(args.track_name) : undefined,
              transition: args.transition ? String(args.transition) : undefined,
              transition_duration: args.transition_duration != null ? Number(args.transition_duration) : undefined,
            }, spaceForAgent(exec?.agent).id)
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_add_video',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_add_audio',
          description:
            '把本地音频挂到当前草稿。混剪口播优先用 dh_add_narration（文案直接合成并上轨）。已有 wav/mp3 才用本工具。',
          parameters: {
            draft_id: { type: 'string', description: '草稿 id，可省略则用当前草稿' },
            path: { type: 'string', description: '本地音频绝对路径' },
            start: { type: 'number', description: '音频入点秒，默认 0' },
            end: { type: 'number', description: '音频出点秒，默认整段' },
            target_start: { type: 'number', description: '时间线起点秒，口播通常 0' },
            volume: { type: 'number', description: '音量，默认 1' },
            track_name: { type: 'string', description: '默认 audio_main' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            return addAudio({
              draft_id: args.draft_id ? String(args.draft_id) : undefined,
              path: args.path ? String(args.path) : undefined,
              start: args.start != null ? Number(args.start) : undefined,
              end: args.end != null ? Number(args.end) : undefined,
              target_start: args.target_start != null ? Number(args.target_start) : undefined,
              volume: args.volume != null ? Number(args.volume) : undefined,
              track_name: args.track_name ? String(args.track_name) : undefined,
            }, spaceForAgent(exec?.agent).id)
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_add_audio', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_list_voices',
          description:
            '列出混剪配音选项：热心老板、避坑提醒、稳重师傅、带看效果，以及这家已经克隆的声音。做口播前先给客户选。',
          parameters: {},
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(_args, exec) {
            const space = spaceForAgent(exec?.agent)
            return toLosslessJson({
              success: true,
              current: space.preferredVoiceId || '',
              ...narrationChoices(),
              ask: `配音用哪个？${voiceChoiceMenu()}。`,
            })
          },
          presentCall: () => ({ card: 'generic', title: 'dh_list_voices', kind: 'other' }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_set_voice',
          description:
            '记下客户选的配音。voice 用热心老板 / 避坑提醒 / 稳重师傅 / 带看效果 / 用我的声音，或已克隆音色的 id。选「用我的声音」但还没克隆时，改走 dh_clone_voice。不要把中文名当 voice_id 去查公模，合成只走 dh_add_narration。',
          parameters: {
            voice: { type: 'string', description: '客户选的名字或音色 id' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            const picked = resolveNarrationVoice(space.id, String(args.voice || ''))
            if ('needClone' in picked) {
              return toLosslessJson({ success: false, needClone: true, hint: '还没有他的声音。让他把一段十到三十秒的说话录音丢进对话，再 dh_clone_voice。' })
            }
            if ('needChoice' in picked) {
              return toLosslessJson({ success: false, needVoice: true, ask: `配音用哪个？${voiceChoiceMenu()}。` })
            }
            rememberVoice(space.id, picked.style)
            return toLosslessJson({ success: true, voice: picked.name, voiceId: picked.voiceId, style: picked.style })
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_set_voice', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_clone_voice',
          description:
            '客户要自己的声音时：把对话里的本地录音上传并克隆成这家店的配音，之后 dh_add_narration 用这个声音。录音大约十到三十秒，安静、正常说话。',
          parameters: {
            path: { type: 'string', description: '本地录音绝对路径（wav/mp3/m4a）' },
            name: { type: 'string', description: '音色名，默认「我的声音」' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            const cloned = await cloneVoiceFromFile(space.id, String(args.path || ''), String(args.name || '我的声音'))
            return toLosslessJson({ success: true, ...cloned, hint: '声音好了。接下来 dh_add_narration 会用这个声音。' })
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_clone_voice', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_add_narration',
          description:
            '混剪口播：用客户已选的配音合成并挂到草稿。没选过会返回选项，先问客户。不要本机 say。垫的画面 volume 设 0。',
          parameters: {
            text: { type: 'string', description: '口播文案，两三句人话' },
            voice: { type: 'string', description: '可选。客户刚选的名字；不填则用这家已记住的配音' },
            draft_id: { type: 'string', description: '草稿 id，可省略' },
            target_start: { type: 'number', description: '时间线起点秒，默认 0' },
            volume: { type: 'number', description: '口播音量，默认 1' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            return addNarration({
              text: String(args.text || ''),
              voice: args.voice ? String(args.voice) : undefined,
              draft_id: args.draft_id ? String(args.draft_id) : undefined,
              target_start: args.target_start != null ? Number(args.target_start) : undefined,
              volume: args.volume != null ? Number(args.volume) : undefined,
            }, spaceForAgent(exec?.agent).id)
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_add_narration', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_list_music',
          description:
            '列出混剪垫乐：热闹一点、稳一点、先不要。做视频时先问客户要不要垫音乐。',
          parameters: {},
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(_args, exec) {
            const space = spaceForAgent(exec?.agent)
            return toLosslessJson({
              success: true,
              current: space.preferredMusic || '',
              choices: musicChoiceMenu(),
              beds: MIXCUT_MUSIC.map(item => ({ id: item.id, name: item.name })),
              ask: `要不要垫一段音乐？${musicChoiceMenu()}。`,
            })
          },
          presentCall: () => ({ card: 'generic', title: 'dh_list_music', kind: 'other' }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_find_music',
          description:
            '按气氛在内置垫乐、~/.dsh/music 曲库、当前公司素材柜的音频里自己找曲子。做视频时按这条片子的气氛传 query（热闹、稳、轻快、无歌词），用 recommended.path 调 dh_add_music。不要去网上搜歌或下载。没有合适的就用 recommended 为空时的内置热闹一点 / 稳一点。',
          parameters: {
            query: { type: 'string', description: '气氛或文件名关键词，如 热闹、稳、轻快、钢琴' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            const cabinet = publicStudioMaterials(space.id).items
              .filter(item => item.kind === 'audio' && item.path)
              .map(item => ({
                name: item.name,
                path: item.path,
                note: [item.useFor, item.summary].filter(Boolean).join(' '),
              }))
            const found = findMixcutMusic(String(args.query || ''), cabinet)
            return toLosslessJson({
              success: true,
              ...found,
              hint: found.recommended
                ? `用「${found.recommended.name}」。dh_add_music 传 path。不要改音量，不要去网上再找。`
                : '曲库和素材柜没有更贴的。改用热闹一点或稳一点，dh_add_music 的 music 填这两个名字之一。',
            })
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_find_music', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_set_music',
          description:
            '记下客户选的垫乐。music 用热闹一点 / 稳一点 / 先不要。',
          parameters: {
            music: { type: 'string', description: '热闹一点、稳一点，或先不要' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            const picked = pickMixcutMusic(String(args.music || ''))
            if (picked == null) {
              return toLosslessJson({ success: false, needMusic: true, ask: `要不要垫一段音乐？${musicChoiceMenu()}。` })
            }
            const id = picked === 'none' ? 'none' : picked.id
            rememberMusic(space.id, id)
            return toLosslessJson({ success: true, music: picked === 'none' ? '先不要' : picked.name, id })
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_set_music', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_add_music',
          description:
            '把已选垫乐挂到草稿的 audio_bed。默认音量已经能听见、又在人声下面。不要测分贝，不要改音乐文件，不要自己重渲。没选过会先返回选项。客户丢了自己的曲子就传 path。',
          parameters: {
            music: { type: 'string', description: '可选。热闹一点 / 稳一点 / 先不要；不填用这家已记住的' },
            path: { type: 'string', description: '可选。客户自己的音频绝对路径' },
            draft_id: { type: 'string', description: '草稿 id，可省略' },
            volume: { type: 'number', description: '一般省略。内置垫乐默认 0.45，已在人声下面' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            return addMusicBed({
              music: args.music ? String(args.music) : undefined,
              path: args.path ? String(args.path) : undefined,
              draft_id: args.draft_id ? String(args.draft_id) : undefined,
              volume: args.volume != null ? Number(args.volume) : undefined,
            }, spaceForAgent(exec?.agent).id)
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_add_music', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_list_sfx',
          description:
            '查可用的音效（本地合成，无版权）。返回 id / 时长 / 用途 / 默认音量。配音效前先查这张表，不要凭名字猜——同名不同用途的声音差很远。',
          parameters: {},
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(_args, exec) {
            void exec
            const items = sfxCatalogForAgent()
            return toLosslessJson({
              count: items.length,
              items,
              hint: items.length
                ? '按「这一下要表达什么」挑，不要按名字挑。用 dh_add_sfx 铺到时间线上。'
                : '音效库为空，先跑 scripts/gen-sfx.py。',
            })
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_list_sfx', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_add_sfx',
          description:
            '把音效按时间点铺进草稿的音效轨（audio_sfx）。不改画面、不动原音轨、不动垫乐。at 是时间线秒数，对齐到动作落点；元素出现可提前 0.02~0.05s。一次可传多个点，按需挑重点，不要整片铺满。',
          parameters: {
            cues: {
              type: 'array',
              description: '音效点数组，按时间正序最好',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  at: { type: 'number', description: '时间线第几秒响，单位秒' },
                  id: { type: 'string', description: '音效 id，见 dh_list_sfx' },
                  gain: { type: 'number', description: '一般省略，用 manifest 里的默认音量' },
                },
              },
            },
            draft_id: { type: 'string', description: '草稿 id，可省略' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const spaceId = spaceForAgent(exec?.agent).id
            const cues = normalizeCues((args as any).cues)
            const draftId = (args as any).draft_id ? String((args as any).draft_id) : undefined
            const applied: Array<{ at: number; id: string; gain: number; duration: number }> = []
            const failed: Array<{ at: number; id: string; error: string }> = []
            for (const cue of cues) {
              const item = sfxItem(cue.id)
              const file = sfxPath(cue.id)
              if (!item || !file) {
                failed.push({ at: cue.at, id: cue.id, error: '音效文件缺失' })
                continue
              }
              const gain = cue.gain == null ? item.gain : cue.gain
              const result = await addAudio(
                { draft_id: draftId, path: file, volume: gain, track_name: 'audio_sfx', target_start: cue.at },
                spaceId,
              )
              if ((result as any)?.success === false) {
                failed.push({ at: cue.at, id: cue.id, error: String((result as any)?.error || 'add_audio failed') })
              } else {
                applied.push({ at: cue.at, id: cue.id, gain, duration: item.dur })
              }
            }
            return toLosslessJson({
              success: failed.length === 0,
              total: cues.length,
              applied,
              failed,
              hint:
                failed.length === 0
                  ? `已铺 ${applied.length} 个音效到音效轨，画面、原音轨、垫乐都没动。`
                  : `有 ${failed.length} 个没铺上，看 failed 里的原因；其余已经生效，不用重铺。`,
            })
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_add_sfx', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_list_local_text_styles',
          description:
            'List local offline styled-text (花字-like) presets: gradient/emboss/multi-stroke/glow. These are self-rendered raster overlays, NOT Xiaocongcut cloud Effect IDs.',
          parameters: {},
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(_args, exec) {
            void exec
            return listLocalTextStyles() as any
          },
          presentCall: () => ({ card: 'generic', title: 'dh_list_local_text_styles', kind: 'other', rawInput: {} }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_render_local_styled_text',
          description:
            'Render Chinese text with a local style preset into the current company folder (transparent PNG + optional preview mp4). Does not call Xiaocongcut cloud.',
          parameters: {
            text: { type: 'string', description: 'Text content, up to 40 chars.' },
            style: { type: 'string', description: 'Style id from dh_list_local_text_styles.' },
            entrance: { type: 'string', description: 'none|fade_in|slide_up|pop for preview video.' },
            with_preview_video: { type: 'boolean', description: 'Also make a short preview mp4. Default true.' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            return renderLocalStyledText({
              spaceId: space.id,
              text: String(args.text || ''),
              style: String(args.style || ''),
              entrance: args.entrance ? String(args.entrance) : 'fade_in',
              withPreviewVideo: args.with_preview_video !== false,
            }) as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_render_local_styled_text', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_add_local_styled_text',
          description:
            '混剪花字：把一句短字画成花字或图形叠到草稿上，渲染器内置 23 种样式。设计款：基础描边 / 手写笔刷 / 斜体字幕 / 粗斜字幕 / 蓝白科技 / 暖金标题 / 红白标题 / 薄荷纸签 / 金色斜体字幕 / 渐变金 / 立体字 / 多重描边 / 霓虹字 / 渐变青。功能款：黄底大字 / 白字黑边 / 店招红金 / 橙色提醒。包装图形：印章 / 深色卡片 / 对勾 / 数字放大 / 银灰金属字。按场合挑，一条片子 2–3 种、3–5 个，不要全片只用一种黄底大字。字不超过 8 个。位置和时间有默认，不要手填编号。',
          parameters: {
            text: { type: 'string', description: '画面上的短句，最多 8 个字更好' },
            style: { type: 'string', description: '设计款：基础描边 / 手写笔刷 / 斜体字幕 / 粗斜字幕 / 蓝白科技 / 暖金标题 / 红白标题 / 薄荷纸签 / 金色斜体字幕 / 渐变金 / 立体字 / 多重描边 / 霓虹字 / 渐变青；功能款：黄底大字 / 白字黑边 / 店招红金 / 橙色提醒；包装图形：印章 / 深色卡片 / 对勾 / 数字放大 / 银灰金属字（对勾可传空文字）' },
            entrance: { type: 'string', description: 'none|fade_in|slide_up|pop. Draft mapping: Fade_In/Slide_Up/Mini_Zoom (pop≠Pop_Up; unsupported enums fail clearly, never silent static).' },
            transform_y: { type: 'number', description: 'Optional CapCut transform_y (half-canvas; negative=down). Default -0.58 lower-third.' },
            draft_id: { type: 'string', description: 'Optional draft id.' },
            start: { type: 'number', description: 'Overlay start second.' },
            end: { type: 'number', description: 'Overlay end second.' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            return addLocalStyledTextToDraft({
              draft_id: args.draft_id ? String(args.draft_id) : undefined,
              text: String(args.text || ''),
              style: String(args.style || ''),
              entrance: args.entrance ? String(args.entrance) : 'fade_in',
              start: args.start != null ? Number(args.start) : undefined,
              end: args.end != null ? Number(args.end) : undefined,
              transform_y: args.transform_y != null ? Number(args.transform_y) : undefined,
            }, space.id) as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_add_local_styled_text', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_own_text_add',
          description:
            '【自有可编辑文字引擎】添加一层参数化文字（text/style/position/timing/entrance），持久化稳定 id+revision。可改字再渲。底层可栅格化导出，但不是剪映原生 text_effect，也不冒充剪映内可改字花字。',
          parameters: {
            text: { type: 'string', description: '文字，最多40字' },
            style: { type: 'string', description: 'gradient_gold|emboss_3d|multi_stroke|glow_neon|gradient_cyan' },
            entrance: { type: 'string', description: 'none|fade_in|slide_up|pop' },
            font_size: { type: 'number', description: '字号 36-160，默认96' },
            transform_x: { type: 'number', description: '水平位置 -1..1' },
            transform_y: { type: 'number', description: '垂直位置 -1..1（负=偏下）' },
            start: { type: 'number', description: '开始秒' },
            duration: { type: 'number', description: '持续秒' },
            render_preview: { type: 'boolean', description: '是否立刻栅格预览，默认 true' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            return addOwnTextLayer({
              spaceId: space.id,
              text: String(args.text || ''),
              style: String(args.style || ''),
              entrance: args.entrance ? String(args.entrance) : 'fade_in',
              fontSize: args.font_size != null ? Number(args.font_size) : undefined,
              transformX: args.transform_x != null ? Number(args.transform_x) : undefined,
              transformY: args.transform_y != null ? Number(args.transform_y) : undefined,
              startSec: args.start != null ? Number(args.start) : undefined,
              durationSec: args.duration != null ? Number(args.duration) : undefined,
              renderPreview: args.render_preview !== false,
            }) as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_own_text_add', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_own_text_update',
          description:
            '【自有可编辑文字】按 id + expected_revision 改文字/样式/位置/时序/动画。源参数持久化，改字后可再导出。revision 冲突会拒绝，不破坏旧产物。非剪映原生编辑。',
          parameters: {
            id: { type: 'string', description: 'otxt-… 层 id' },
            expected_revision: { type: 'integer', description: '当前已知 revision' },
            text: { type: 'string', description: '新文字' },
            style: { type: 'string', description: '样式白名单' },
            entrance: { type: 'string', description: '入场动画白名单' },
            font_size: { type: 'number' },
            transform_x: { type: 'number' },
            transform_y: { type: 'number' },
            start: { type: 'number' },
            duration: { type: 'number' },
            render_preview: { type: 'boolean' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            const patch: Record<string, unknown> = {}
            if (args.text != null) patch.text = String(args.text)
            if (args.style != null) patch.style = String(args.style)
            if (args.entrance != null) patch.entrance = String(args.entrance)
            if (args.font_size != null) patch.fontSize = Number(args.font_size)
            if (args.transform_x != null) patch.transformX = Number(args.transform_x)
            if (args.transform_y != null) patch.transformY = Number(args.transform_y)
            if (args.start != null) patch.startSec = Number(args.start)
            if (args.duration != null) patch.durationSec = Number(args.duration)
            return updateOwnTextLayer({
              spaceId: space.id,
              id: String(args.id || ''),
              expectedRevision: Number(args.expected_revision),
              patch,
              renderPreview: args.render_preview !== false,
            }) as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_own_text_update', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_own_text_list',
          description: '查询本公司自有可编辑文字层（源参数 id/revision/text/style/位置/时序）。非剪映草稿文字列表。',
          parameters: {
            id: { type: 'string', description: '可选，只查一层' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            return listOwnTextLayers(space.id, args.id ? String(args.id) : undefined) as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_own_text_list', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_own_text_export',
          description:
            '【自有文字双路】同一源参数：local_mp4=自有栅格FFmpeg；jianying_native=Xiaocongcut /add_text 明文 materials.texts（非PNG、非原生花字特效包）。target=local_mp4|jianying_native|both。渐变/霓虹等原生侧仅为近似，需 accept_native_approx=true，否则 needs_confirmation，禁止静默降级。',
          parameters: {
            target: { type: 'string', description: 'local_mp4 | jianying_native | both（默认 both）' },
            accept_native_approx: { type: 'boolean', description: '接受原生侧近似样式（渐变→纯色等）时必须 true' },
            layer_ids: { type: 'array', items: { type: 'string' }, description: '可选；默认导出全部层' },
            width: { type: 'integer', description: '默认 720' },
            height: { type: 'integer', description: '默认 1280' },
            duration: { type: 'number', description: '成片秒数，默认覆盖所有层' },
            bg_color: { type: 'string', description: '本地MP4背景，如 0x1a2030' },
            project_name: { type: 'string', description: '隔离原生草稿项目名' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            return exportOwnTextDualPath({
              target: args.target ? String(args.target) : 'both',
              accept_native_approx: !!args.accept_native_approx,
              layer_ids: Array.isArray(args.layer_ids) ? args.layer_ids.map(String) : undefined,
              width: args.width != null ? Number(args.width) : undefined,
              height: args.height != null ? Number(args.height) : undefined,
              duration: args.duration != null ? Number(args.duration) : undefined,
              bg_color: args.bg_color ? String(args.bg_color) : undefined,
              project_name: args.project_name ? String(args.project_name) : undefined,
            }, space.id) as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_own_text_export', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_list_native_text_effects',
          description:
            '列出可供 AI 选用的【原生花字/气泡】公开数字ID与中文名（开源 demo/元数据核实）。给 dh_add_text 的 flower_style 用。不是 PNG 样式列表（PNG 见 dh_list_local_text_styles）。不下载资源；本机缓存/VIP 打开剪映前未知。',
          parameters: {
            kind: { type: 'string', description: 'Optional filter: text_effect | bubble' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args) {
            const kind = args.kind ? String(args.kind) : undefined
            return listNativeTextEffects(
              kind === 'text_effect' || kind === 'bubble' ? { kind: kind as any } : undefined,
            ) as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_list_native_text_effects', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_add_text',
          description:
            '【原生可改字文字/花字】经本地9001 /add_text 写入 materials.texts（剪映可改字）。要用花字请传 flower_style（推荐「默认花字」或 dh_list_native_text_effects 里的中文名），也可传纯数字 effect_effect_id。效果资源可能需剪映联网下载；VIP/缓存未保证。绝不是 PNG：PNG 请用 dh_add_local_styled_text。',
          parameters: {
            text: { type: 'string', description: 'Text content (editable in Jianying as native text).' },
            draft_id: { type: 'string', description: 'Optional draft id.' },
            font_size: { type: 'number', description: 'Font size for local draft text.' },
            font_color: { type: 'string', description: 'Hex color like #ffffff.' },
            font: { type: 'string', description: 'Optional Font_type name already supported by Xiaocongcut (e.g. 文轩体).' },
            shadow_enabled: { type: 'boolean', description: 'Enable native shadow.' },
            border_width: { type: 'number', description: 'Native border width.' },
            intro_animation: { type: 'string', description: 'Native text intro enum, e.g. Typewriter / Fade_In.' },
            outro_animation: { type: 'string', description: 'Optional native text outro enum.' },
            transform_y: { type: 'number', description: 'CapCut transform_y (half-canvas; negative=down). Default -0.8.' },
            flower_style: {
              type: 'string',
              description:
                '推荐：花字中文名或「默认花字」。由 dh_list_native_text_effects 映射到平台数字ID，免手填抽象ID。与 effect_effect_id 二选一（都传时优先可解析的别名）。',
            },
            effect_effect_id: {
              type: 'string',
              description:
                '可选：原生 text_effect 纯数字ID（16–22位）。优先用 flower_style。拒绝 UUID/云端编码。资源可能需剪映下载；VIP/缓存未验证。',
            },
            bubble_effect_id: { type: 'string', description: 'Optional bubble effect digit id; requires bubble_resource_id.' },
            bubble_resource_id: { type: 'string', description: 'Optional bubble resource digit id; requires bubble_effect_id.' },
            start: { type: 'number' },
            end: { type: 'number' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const space = spaceForAgent(exec?.agent)
            return addNativeText({
              draft_id: args.draft_id ? String(args.draft_id) : undefined,
              text: String(args.text || ''),
              font_size: args.font_size != null ? Number(args.font_size) : undefined,
              font_color: args.font_color ? String(args.font_color) : undefined,
              font: args.font ? String(args.font) : undefined,
              shadow_enabled: !!args.shadow_enabled,
              border_width: args.border_width != null ? Number(args.border_width) : undefined,
              intro_animation: args.intro_animation ? String(args.intro_animation) : undefined,
              outro_animation: args.outro_animation ? String(args.outro_animation) : undefined,
              transform_y: args.transform_y != null ? Number(args.transform_y) : undefined,
              effect_effect_id: args.effect_effect_id != null ? String(args.effect_effect_id) : undefined,
              flower_style: args.flower_style != null ? String(args.flower_style) : undefined,
              bubble_effect_id: args.bubble_effect_id != null ? String(args.bubble_effect_id) : undefined,
              bubble_resource_id: args.bubble_resource_id != null ? String(args.bubble_resource_id) : undefined,
              start: args.start != null ? Number(args.start) : undefined,
              end: args.end != null ? Number(args.end) : undefined,
            }, space.id) as any
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_add_text', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_save_draft',
          description:
            'Digital Human Studio: save the active Xiaocongcut draft into a local Jianying/CapCut draft folder (auto_deploy).',
          parameters: {
            draft_id: { type: 'string', description: 'Draft id. Optional if already selected.' },
            draft_folder: {
              type: 'string',
              description: 'Parent folder to write the draft into. Defaults to selected project folder.',
            },
            project_name: { type: 'string', description: 'Saved project name. Defaults to draft_id.' },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args, exec) {
            return saveDraft(args, spaceForAgent(exec?.agent).id)
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_save_draft',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_export_draft',
          description:
            '【本地FFmpeg导出MP4】默认 engine=local_ffmpeg：解析已保存隔离草稿（draft_dir/lastDraftPath），渲染视频剪切/音轨/基础文字/透明PNG。本机Xiaocongcut无云导出端点。含原生text_effect等无法保真时预检 needs_confirmation，需 confirm_downgrade_unsupported=true（基础文字降级，不假装花字1:1）。非剪映会员导出、非云端Xiaocongcut。',
          parameters: {
            draft_id: { type: 'string', description: 'Draft id（可选）。' },
            draft_dir: { type: 'string', description: '已保存草稿目录绝对路径（推荐，须在受控根下）。' },
            draft_folder: { type: 'string', description: '可选父目录（受控根提示）。' },
            engine: { type: 'string', description: 'local_ffmpeg（默认）| xiaocongcut（本机通常404）。' },
            confirm_downgrade_unsupported: {
              type: 'boolean',
              description: '草稿含 text_effect/转场/动画等时必须为 true 才继续；会诚实降级，不会自动丢效果装成功。',
            },
            output_path: { type: 'string', description: '可选；本地引擎主要写 workspace/exports。' },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args, exec) {
            return exportDraft({
              draft_id: args.draft_id ? String(args.draft_id) : undefined,
              draft_dir: args.draft_dir ? String(args.draft_dir) : undefined,
              draft_folder: args.draft_folder ? String(args.draft_folder) : undefined,
              output_path: args.output_path ? String(args.output_path) : undefined,
              engine: args.engine ? String(args.engine) : 'local_ffmpeg',
              confirm_downgrade_unsupported: !!args.confirm_downgrade_unsupported,
            }, spaceForAgent(exec?.agent).id) as any
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_export_draft',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_export_status',
          description:
            'Digital Human Studio: poll Xiaocongcut /export_status for an export task. Returns a clear error if the endpoint is missing.',
          parameters: {
            task_id: { type: 'string', description: 'Export task id if known.' },
            draft_id: { type: 'string', description: 'Draft id to query.' },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: renderJson,
          },
          async execute(args) {
            return exportStatus(args)
          },
          presentCall: (args) => ({
            card: 'generic',
            title: 'dh_export_status',
            kind: 'other',
            rawInput: args,
          }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_avatar_create_video',
          description:
            'Digital Human Studio: create a digital human talking video through XiaocongAPI (xdh-avatar-video). Pass the narration text; omitted avatar/voice ids use the workbench default.',
          parameters: {
            text: { type: 'string', description: 'Narration text spoken by the digital human.' },
            model_code: { type: 'string', description: 'Upstream digital human model code, e.g. VPro, Pro, Max, XPro.' },
            selected_avatar_local_id: { type: 'string', description: 'Avatar local id from the resource list, e.g. digitalavatar_public_avatar_4.' },
            selected_avatar_model_id: { type: 'string', description: 'Avatar resource id from the resource list.' },
            selected_voice_local_id: { type: 'string', description: 'Voice local id from the resource list.' },
            selected_voice_id: { type: 'string', description: 'Voice resource id from the resource list.' },
            title: { type: 'string', description: 'Optional task title.' },
            language: { type: 'string', description: 'Optional language code, e.g. zh.' },
            speed: { type: 'number', description: 'Optional speech speed.' },
            pitch: { type: 'number', description: 'Optional pitch.' },
            volume: { type: 'number', description: 'Optional volume.' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            if (!String(args.text || '').trim()) throw new Error('text 不能为空')
            const library = loadAssetLibrary()
            const avatar = pickDefaultAsset(library.avatars)
            const voice = pickDefaultAsset(library.voices)
            const filled: Record<string, unknown> = { ...args }
            if (!String(filled.selected_avatar_model_id || '').trim() && avatar) {
              filled.selected_avatar_model_id = avatar.id
              if (!String(filled.model_code || '').trim()) filled.model_code = avatar.modelCode || 'VPro'
            }
            if (!String(filled.selected_voice_id || '').trim() && voice) filled.selected_voice_id = voice.id
            return createDigitalHumanTask('xdh-avatar-video', filled, exec)
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_avatar_create_video', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_avatar_create_audio',
          description:
            'Digital Human Studio: synthesize speech through XiaocongAPI (xdh-audio). Pass the text and an optional voice selection.',
          parameters: {
            text: { type: 'string', description: 'Text to synthesize.' },
            model_code: { type: 'string', description: 'Upstream speech model code, e.g. SPro, Pro, Max, NWMax.' },
            selected_voice_local_id: { type: 'string', description: 'Voice local id from the resource list.' },
            selected_voice_id: { type: 'string', description: 'Voice resource id from the resource list.' },
            title: { type: 'string', description: 'Optional task title.' },
            language: { type: 'string', description: 'Optional language code, e.g. zh.' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            if (!String(args.text || '').trim()) throw new Error('text 不能为空')
            const filled: Record<string, unknown> = { ...args }
            if (!String(filled.selected_voice_id || '').trim()) {
              const voice = pickDefaultAsset(loadAssetLibrary().voices)
              if (voice) filled.selected_voice_id = voice.id
            }
            if (!String(filled.selected_voice_id || '').trim()) {
              const mixcutVoice = pickMixcutVoice('warm_boss') || MIXCUT_VOICES[0]
              filled.selected_voice_id = mixcutVoice.voiceId
              filled.model_type = 1
              if (!filled.instruction) filled.instruction = mixcutVoice.instruction
            }
            return createDigitalHumanTask('xdh-audio', filled, exec)
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_avatar_create_audio', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_avatar_create_image',
          description:
            'Digital Human Studio: generate an image through XiaocongAPI POST /v1/images/generations. Pass the prompt and a XiaocongAPI image model id.',
          parameters: {
            prompt: { type: 'string', description: 'Image prompt.' },
            model: { type: 'string', description: 'XiaocongAPI image model id from the image models list.' },
            model_code: { type: 'string', description: 'Alias of model.' },
            ratio: { type: 'string', description: 'Optional aspect ratio, e.g. 1:1, 9:16, 16:9.' },
            title: { type: 'string', description: 'Optional task title.' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            if (!String(args.prompt || '').trim()) throw new Error('prompt 不能为空')
            const listed = await listImageModels()
            const requested = String(args.model || args.model_code || '').trim()
            const model = requested || listed.models[0] || ''
            if (!model) throw new Error(listed.note || '小葱 API 还没有可用的生图模型')
            return createImageJob({ ...args, model }, exec?.agent)
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_avatar_create_image', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_avatar_clone_avatar',
          description:
            'Digital Human Studio: clone an avatar from a video or image sample through XiaocongAPI (xdh-avatar-clone).',
          parameters: {
            name: { type: 'string', description: 'Avatar name.' },
            sample_url: { type: 'string', description: 'Public sample media URL.' },
            model_code: { type: 'string', description: 'Upstream clone model code, e.g. VPro, Pro, Max, XPro.' },
            cover_url: { type: 'string', description: 'Optional cover image URL.' },
            sex: { type: 'integer', description: 'Optional 0 female / 1 male.' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            if (!String(args.name || '').trim()) throw new Error('name 不能为空')
            if (!String(args.sample_url || '').trim()) throw new Error('sample_url 不能为空')
            return createDigitalHumanTask('xdh-avatar-clone', args, exec)
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_avatar_clone_avatar', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_avatar_clone_voice',
          description:
            'Digital Human Studio: clone a voice from an audio sample through XiaocongAPI (xdh-voice-clone).',
          parameters: {
            name: { type: 'string', description: 'Voice name.' },
            sample_url: { type: 'string', description: 'Public sample audio URL.' },
            model_code: { type: 'string', description: 'Upstream clone model code, e.g. SPro, Pro, Max, NWMax.' },
            language: { type: 'string', description: 'Optional language code, e.g. zh.' },
            language_boost: { type: 'string', description: 'Optional language boost.' },
            instruction: { type: 'string', description: 'Optional voice instruction.' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            if (!String(args.name || '').trim()) throw new Error('name 不能为空')
            if (!String(args.sample_url || '').trim()) throw new Error('sample_url 不能为空')
            return createDigitalHumanTask('xdh-voice-clone', args, exec)
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_avatar_clone_voice', kind: 'other', rawInput: args }),
        }),
      ),
      trackTool(ctx, 
        defineTool({
          name: 'dh_avatar_task',
          description:
            'Digital Human Studio: read one XiaocongAPI digital human task by id. Returns status, progress, result URLs, and failure reason.',
          parameters: {
            task_id: { type: 'string', description: 'Gateway task id returned by a create tool.' },
          },
          output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
          async execute(args, exec) {
            const id = String(args.task_id || '').trim()
            if (!id) throw new Error('task_id 不能为空')
            if (isImageTaskId(id)) {
              return withImageLayout(imageLayoutForSpace(spaceForAgent(exec?.agent).id), async () => {
                const job = getImageJob(id)
                if (!job) throw new Error('找不到这个生图任务')
                const published = publicImageJob(await refreshImageJob(job))
                patchHistoryFromTask(published, id)
                return published
              })
            }
            const task = await digitalHumanRequest('GET', `/v1/tasks/${encodeURIComponent(id)}`)
            patchHistoryFromTask(task, id)
            return task
          },
          presentCall: (args) => ({ card: 'generic', title: 'dh_avatar_task', kind: 'other', rawInput: args }),
        }),
      ),
    ]

    console.log(`[digital-human-studio] registered ${tools.length} Agent tools (dh_*)`)
    return () => {
      for (const d of tools) d()
    }
  }, 'digital-human-studio: tools')

  const injectOptional = (ctx as Context & { inject?: (names: string[], callback: (scope: Context) => void) => void }).inject
  injectOptional?.(['commands'], (scope) => {
    const host = scope as Context & {
      commands: {
        register: (definition: {
          name: string
          description: string
          input?: { hint: string }
          handler: (invocation: {
            rawInput: string
            agent: { session: { snapshotEvents: () => unknown[] } }
            signal: AbortSignal
          }) => Promise<{ kind: 'success' | 'error'; text: string }>
        }) => () => void
      }
    }
    host.commands.register({
      name: 'dh',
      description: '把口播文案做成数字人视频',
      input: { hint: '口播文案' },
      handler: async (invocation) => {
        const raw = String(invocation.rawInput || '').trim()
        const show = /^(?:show|引用|cite)\s+(\S+)$/i.exec(raw)
        if (/^(?:show|引用|cite)\b/i.test(raw) && !show) {
          return { kind: 'error', text: '请先在数字人工作台打开成片，再点「发送到当前对话」。' }
        }
        if (show) {
          const taskId = show[1]
          try {
            const task = await digitalHumanRequest('GET', `/v1/tasks/${encodeURIComponent(taskId)}`, undefined, 30000)
            const payload = citePayloadFromTask(task, taskId)
            rememberDigitalHumanCite(sessionIdOf(invocation.agent), payload)
            return { kind: 'success', text: JSON.stringify(payload) }
          } catch (error: any) {
            return { kind: 'error', text: error?.message || '找不到这个数字人视频' }
          }
        }
        try {
          const text = clipNarration(raw) || lastAssistantText(invocation.agent)
          if (!text) return { kind: 'error', text: '没有口播文案。在输入框写一段话再点「口播成片」，或先让助手回复一段话。' }
          const payload = await speakTalkingHead(text, invocation.signal, invocation.agent)
          const cite = asDigitalHumanCite(payload)
          if (cite) rememberDigitalHumanCite(sessionIdOf(invocation.agent), cite)
          return { kind: 'success', text: JSON.stringify(payload) }
        } catch (error: any) {
          const message = String(error?.message || '生成数字人失败')
          return { kind: 'error', text: message === '已取消' ? '已取消数字人生成' : message }
        }
      },
    })
    console.log('[digital-human-studio] registered /dh command')
  })

  // 到点自动发：每分钟扫一次所有公司的日历。小葱没开 / 电脑休眠时不会发；
  // 开回来只补 1 小时内的窗口，错过就留给人工，避免几小时后突然发出旧片子。
  if (autoPublishEnabled()) {
    ctx.effect(() => {
      let running = false
      const tick = async () => {
        if (running) return
        running = true
        try {
          const report = await autoPublishTick()
          if (report.fired.length) {
            for (const row of report.fired) {
              console.log(`[digital-human-studio] auto-publish ${row.planId} → ${row.state}${row.error ? ` (${row.error})` : ''}`)
            }
          }
        } catch (error: any) {
          console.log('[digital-human-studio] auto-publish tick failed:', String(error?.message || error))
        } finally {
          running = false
        }
      }
      const timer = setInterval(() => { void tick() }, 60 * 1000)
      const boot = setTimeout(() => { void tick() }, 8000)
      return () => { clearInterval(timer); clearTimeout(boot) }
    })
    console.log('[digital-human-studio] auto-publish scheduler armed (every 60s, grace 1h)')
  }

  // ── 引擎一体托管 ──
  // 本机 Xiaocongcut 是这套剪辑台的内核，不再当成外部服务：
  // 启动时若引擎没在线就由本插件后台拉起（子进程），退出时把自己拉起的那只带走。
  // 界面/模板/会话都在 3080 这边，9001 只是本机内网渲染内核，不对外暴露。
  // ── 内核守护：崩了自己爬回来，连续 3 次就停手等人 ──
  const kernelGuard = { online: false, restarts: 0, failed: false, lastError: '', checkedAt: 0 }
  const GUARD_MAX_RESTARTS = 3
  const guardTick = async () => {
    kernelGuard.checkedAt = Date.now()
    try {
      const st = await probeOnline()
      kernelGuard.online = !!(st as any).online
      if (kernelGuard.online) {
        if (kernelGuard.restarts > 0) {
          console.log(`[digital-human-studio] kernel back online, reset restart counter (was ${kernelGuard.restarts})`)
        }
        kernelGuard.restarts = 0
        kernelGuard.failed = false
        return kernelGuard
      }
      if (kernelGuard.failed) return kernelGuard
      if (kernelGuard.restarts >= GUARD_MAX_RESTARTS) {
        kernelGuard.failed = true
        if (!kernelGuard.lastError) kernelGuard.lastError = `kernel offline after ${GUARD_MAX_RESTARTS} restarts`
        console.log('[digital-human-studio] kernel restart limit reached; auto-restart paused')
        return kernelGuard
      }
      console.log(`[digital-human-studio] kernel offline; restarting (${kernelGuard.restarts + 1}/${GUARD_MAX_RESTARTS})`)
      const r = await engineStart()
      kernelGuard.restarts += 1
      kernelGuard.online = !!r.success
      if (!r.success) kernelGuard.lastError = String(r.error || 'engine start failed')
    } catch (e: any) {
      kernelGuard.lastError = String(e?.message || e)
    }
    return kernelGuard
  }
  const guardTimer = setInterval(() => { void guardTick() }, 20000)
  guardTimer.unref?.()

  const stopManagedEngine = (signal: string) => {
    const pid = config.enginePid
    if (!pid) return
    try {
      if (isPidAlive(pid) && looksLikeXiaocongcut(processCommand(pid))) {
        process.kill(pid, 'SIGTERM')
        console.log(`[digital-human-studio] managed engine pid ${pid} stopped on ${signal}`)
      }
    } catch (e: any) {
      console.log(`[digital-human-studio] engine shutdown failed: ${e?.message || e}`)
    }
  }
  process.once('SIGINT', () => stopManagedEngine('SIGINT'))
  process.once('SIGTERM', () => stopManagedEngine('SIGTERM'))
  process.once('exit', () => stopManagedEngine('exit'))
  console.log('[digital-human-studio] engine supervision armed (kernel is stopped with the studio)')

  injectOptional?.(['systemPrompt'], (scope) => {
    const host = scope as Context & {
      systemPrompt: {
        context: (entry: {
          name: string
          order: number
          interpolate?: boolean
          required?: boolean
          text: string | ((context: { agent?: unknown }) => string)
        }) => () => void
      }
    }
    host.systemPrompt.context({
      name: 'digital-human-studio:client-brief',
      order: 84,
      interpolate: false,
      required: true,
      text: context => clientBriefContextText(context),
    })
    host.systemPrompt.context({
      name: 'digital-human-studio:cites',
      order: 85,
      interpolate: false,
      required: true,
      text: context => digitalHumanCiteContextText(context),
    })
    console.log('[digital-human-studio] registered digital-human brief + cite context')
  })
}

/**
 * Windows 专用：装 Node 22 到 ~/.dsh/runtime/node。
 * 不依赖 bash / winget，走 nodejs.org 官方 zip + powershell 解压，装完把 node.exe 同级目录整体搬过去。
 */
async function installNodeOnWindows(): Promise<{ dest: string; version: string }> {
  const { tmpdir } = await import('node:os')
  const base = 'https://nodejs.org/dist/latest-v22.x'
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text()
  const pick = sums.split('\n').map((l) => l.trim().split(/\s+/)).find((t) => /^node-v22\.\d+\.\d+-win-x64\.zip$/.test(t[1] || ''))
  if (!pick || !pick[1]) throw new Error('官方清单里没找到 win-x64 包')
  const file = pick[1]
  const tmpZip = join(tmpdir(), file)
  const resp = await fetch(`${base}/${file}`)
  if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`)
  writeFileSync(tmpZip, Buffer.from(await resp.arrayBuffer()))
  const tmpDir = join(tmpdir(), `node-unzip-${Date.now().toString(36)}`)
  mkdirSync(tmpDir, { recursive: true })
  await new Promise<void>((done, fail) => {
    const ps = spawn('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${tmpZip}" -DestinationPath "${tmpDir}" -Force`])
    let err = ''
    ps.stderr.on('data', (c) => { err += c.toString() })
    ps.on('error', (e) => fail(new Error(`解压失败：${e?.message || e}`)))
    ps.on('close', (code) => {
      if (code === 0) done()
      else fail(new Error(`解压失败：${err.slice(-500)}`))
    })
  })
  const inner = readdirSync(tmpDir).find((n) => /^node-v22/.test(n))
  if (!inner) throw new Error('解压后的目录结构不认识')
  const srcDir = join(tmpDir, inner)
  const dest = join(homedir(), '.dsh', 'runtime', 'node')
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  // node.exe 在包根；npm 在 node_modules 下，整目录搬
  cpSync(srcDir, dest, { recursive: true })
  rmSync(tmpDir, { recursive: true, force: true })
  rmSync(tmpZip, { force: true })
  const exe = join(dest, 'node.exe')
  if (!existsSync(exe)) throw new Error(`装完找不到 ${exe}`)
  const version = String(execFileSync(exe, ['-v'], { encoding: 'utf8' })).trim()
  return { dest, version }
}
