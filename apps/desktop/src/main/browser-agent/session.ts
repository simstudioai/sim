import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  BrowserDataKind,
  BrowserFindRequest,
  BrowserFindResult,
  BrowserMediaDevice,
  BrowserMediaPermissionRequest,
  BrowserOmniboxFocusMode,
  BrowserPageIssue,
  BrowserSitePermissionRequest,
  BrowserTabState,
  BrowserTabsState,
  BrowserTheme,
} from '@sim/browser-protocol'
import type {
  BrowserAddToChatPayload,
  BrowserDownloadInfo,
  BrowserDownloadsState,
  DesktopAppearanceTheme,
  DesktopZoomPercent,
} from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type {
  BrowserWindow,
  CookiesSetDetails,
  DownloadItem,
  Input,
  MenuItemConstructorOptions,
  Session,
  WebContents,
} from 'electron'
import {
  app,
  dialog,
  session as electronSession,
  Menu,
  nativeTheme,
  shell,
  systemPreferences,
  WebContentsView,
} from 'electron'
import { isDispatchingAgentInput } from '@/main/browser-agent/cdp'
import {
  attachAgentContextMenu,
  BASE_ZOOM_FACTOR,
  steppedZoomFactor,
} from '@/main/browser-agent/context-menu'
import type { BrowserCookieSignal } from '@/main/browser-agent/known-sessions'
import {
  activatePanelScope,
  detachIfAttached,
  initPanel,
  isPanelVisible,
  layout,
  migratePanelScope,
  panelUpdateAllowed,
  panelWindow,
} from '@/main/browser-agent/panel'
import { registerAgentWebContents } from '@/main/browser-agent/registry'
import {
  checkAgentUrl,
  clearHostVerdictCache,
  isBlockedRequestUrl,
  isBlockedSubresourceUrl,
  subresourceNeedsResolution,
} from '@/main/browser-agent/url-guard'
import { browserUserAgent } from '@/main/browser-agent/user-agent'
import type { BrowserSessionSnapshot } from '@/main/desktop-chat-session-store'
import { suggestedFilename, uniqueDownloadPath } from '@/main/downloads'
import {
  type FocusedResourceShortcut,
  isResourceTabSelectionShortcut,
  resourceTabTargetIndex,
  zoomActionForShortcut,
} from '@/main/resource-shortcuts'

const logger = createLogger('BrowserAgentSession')

/** Dedicated cookie jar for the agent browser; `persist:` = survives restarts. */
const AGENT_PARTITION = 'persist:sim-browser-agent'

class SessionError extends Error {}

export interface AgentTab {
  id: string
  scopeId: string
  view: WebContentsView
  pinned: boolean
  pendingRestoreUrl?: string
  pendingRestore?: PendingTabRestore
  pageIssue?: BrowserPageIssue
  syntheticForward?: { url: string; baseHistoryIndex: number }
  preserveSyntheticForwardOnNextNavigation?: boolean
  recoveringUnresponsive?: boolean
  pendingMediaPermission?: PendingMediaPermission
  mediaPermissionGrant?: MediaPermissionGrant
  pendingSitePermission?: PendingSitePermission
  lastRealUserGestureAt?: number
}

interface PendingMediaPermission {
  request: BrowserMediaPermissionRequest
  documentUrl: string
  callback: (permissionGranted: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}

interface MediaPermissionGrant {
  origin: string
  devices: Set<BrowserMediaDevice>
}

interface PendingSitePermission {
  request: BrowserSitePermissionRequest
  /** Exact committed document from which the suspended request originated. */
  documentUrl: string
  /** Exact destination retained only in main-process memory for receipt validation. */
  destinationUrl: string
  contents: WebContents
  networkRequestId: number
  resolve: (allowed: boolean) => void
  timeout: ReturnType<typeof setTimeout>
  nativePromptController?: AbortController
}

export interface BrowserSessionPersistence {
  load: (scopeId: string) => BrowserSessionSnapshot | null
  save: (scopeId: string, snapshot: BrowserSessionSnapshot) => boolean
  migrateScope: (fromScopeId: string, toScopeId: string) => boolean
  disposeScope: (scopeId: string) => void
}

export interface BrowserDownloadSettings {
  /** Resolves the current destination when a download starts. */
  getDirectory: () => string
  /** Overrides the destination filesystem's available-byte lookup. */
  getFreeDiskBytes?: (directory: string) => number | Promise<number>
  /** Overrides asynchronous destination collision checks. */
  pathExists?: (path: string) => boolean | Promise<boolean>
}

export interface AgentSessionEvents {
  /** The browser session ended (all tabs gone). */
  onSessionClosed: () => void
  /** A newly created tab's WebContents, for the driver to instrument. */
  onTabCreated: (contents: WebContents) => void
  /**
   * A tab navigated, including in-page. Anything bound to the previous
   * document — notably a pending credential fill — must be invalidated.
   * `sameDocument` lets the credential preload republish state that survived
   * the navigation instead of waiting for a full reload.
   */
  onTabNavigated: (contents: WebContents, sameDocument: boolean) => void
  /** A tab's WebContents is going away, so per-tab state can be dropped. */
  onTabClosed: (contents: WebContents) => void
  /** The active tab changed (new tab, switch, close). */
  onActiveTabChanged: (contents: WebContents) => void
  /** The active tab's recoverable page state changed without a navigation. */
  onPageStateChanged: (contents: WebContents) => void
  /** Whether the current app renderer can present and answer a site-origin prompt. */
  sitePermissionPromptSupported: (scopeId: string) => boolean
  /** The tab list or active tab changed. */
  onTabsChanged: () => void
  /** Sim's appearance preference changed for an existing tab. */
  onTabThemeChanged: (contents: WebContents, theme: BrowserTheme) => void
  /** A download started, progressed, or finished inside one chat's browser. */
  onDownloadsChanged?: (state: BrowserDownloadsState) => void
}

/**
 * Bounds reports are a LEASE, not a one-shot: the renderer re-reports the
 * panel rect continuously while the panel is visible, and the view is hidden
 * when the lease expires. This is the liveness guard — a renderer that
 * reloads, crashes, or hard-navigates never gets to send "hide", so the view
 * must never outlive the reports.
 */
const MAX_RECENTLY_CLOSED_TABS = 10
const MAX_LIVE_TABS_PER_SCOPE = 32
const MAX_LIVE_TABS_GLOBAL = 96
/**
 * Admission reserves active downloads' worst-case remaining bytes so concurrent
 * downloads cannot collectively consume the disk floor; unknown sizes reserve
 * the per-file cap.
 */
const MAX_BROWSER_DOWNLOAD_BYTES = 2 * 1024 ** 3
const MAX_ACTIVE_BROWSER_DOWNLOADS_PER_SCOPE = 2
const MAX_ACTIVE_BROWSER_DOWNLOADS_GLOBAL = 6
const MIN_BROWSER_DOWNLOAD_FREE_DISK_BYTES = 1024 ** 3
const BROWSER_DOWNLOAD_DISK_CHECK_INTERVAL_MS = 1_000
const BROWSER_DOWNLOAD_DISK_CHECK_TIMEOUT_MS = 5_000
const BROWSER_DOWNLOAD_PATH_ALLOCATION_TIMEOUT_MS = 5_000
/** One foreground reservation keeps a selected tab responsive under background restore load. */
const MAX_TAB_RESTORE_CONCURRENCY = 4
const MAX_BACKGROUND_TAB_RESTORE_CONCURRENCY = 3
const BACKGROUND_TAB_RESTORE_TIMEOUT_MS = 15_000
const FOREGROUND_TAB_RESTORE_TIMEOUT_MS = 20_000
const MEDIA_PERMISSION_GESTURE_WINDOW_MS = 10_000
const MEDIA_PERMISSION_PROMPT_TIMEOUT_MS = 30_000
const SITE_PERMISSION_PROMPT_TIMEOUT_MS = 20_000
const MAX_SITE_ORIGIN_GRANTS_PER_SCOPE = 64

export type BrowserShortcut = 'focus-omnibox' | 'new-tab' | 'close-tab' | 'find'

type BrowserShortcutInput = Pick<
  Input,
  'type' | 'key' | 'isAutoRepeat' | 'isComposing' | 'shift' | 'control' | 'alt' | 'meta'
>

/**
 * Resolves browser-level shortcuts using Command on macOS and Control
 * elsewhere. Modified/composing/repeated keystrokes stay with the page.
 */
export function browserShortcutForInput(
  input: BrowserShortcutInput,
  platform: NodeJS.Platform = process.platform
): BrowserShortcut | null {
  if (
    input.type !== 'keyDown' ||
    input.isAutoRepeat ||
    input.isComposing ||
    input.shift ||
    input.alt
  ) {
    return null
  }
  const primaryModifier = platform === 'darwin' ? input.meta : input.control
  if (!primaryModifier) return null

  switch (input.key.toLowerCase()) {
    case 'l':
      return 'focus-omnibox'
    case 't':
      return 'new-tab'
    case 'w':
      return 'close-tab'
    case 'f':
      return 'find'
    default:
      return null
  }
}

interface BrowserScopeState {
  tabs: AgentTab[]
  recentlyClosedTabUrls: string[]
  activeTabId: string | null
  automationTabId: string | null
  visibleTabUserSelected: boolean
  nextTabId: number
  /** True until anything beyond scope activation inspects or materializes this state. */
  activationOnly: boolean
  restored: boolean
  restoring: boolean
  lastPersistedSnapshot: string | null
  focusedBrowserTabId: string | null
  focusedBrowserClearTimer: ReturnType<typeof setTimeout> | null
  automationActive: boolean
  automationNeedsAttention: boolean
  /**
   * Tab a find is currently running on. Tracked because the find outlives the
   * call that started it — Chromium keeps the highlights until it is told to
   * stop, so leaving a tab (or navigating it) has to clear the find explicitly
   * or the old matches stay lit under a match count that no longer describes
   * anything on screen.
   */
  findingTabId: string | null
  findingRequestId: number | null
  /** Memory-bounded, task-local origins explicitly reached or approved by the user. */
  siteOriginGrants: Map<string, true>
}

function createBrowserScopeState(): BrowserScopeState {
  return {
    tabs: [],
    recentlyClosedTabUrls: [],
    activeTabId: null,
    automationTabId: null,
    visibleTabUserSelected: false,
    nextTabId: 1,
    activationOnly: true,
    restored: false,
    restoring: false,
    lastPersistedSnapshot: null,
    focusedBrowserTabId: null,
    focusedBrowserClearTimer: null,
    automationActive: false,
    automationNeedsAttention: false,
    findingTabId: null,
    findingRequestId: null,
    siteOriginGrants: new Map(),
  }
}

function liveBrowserTabCount(): number {
  let count = 0
  for (const state of browserScopeStates.values()) count += state.tabs.length
  return count
}

function assertTabCapacity(): void {
  if (tabs.length >= MAX_LIVE_TABS_PER_SCOPE) {
    throw new SessionError(`A task browser can have at most ${MAX_LIVE_TABS_PER_SCOPE} open tabs.`)
  }
  if (liveBrowserTabCount() >= MAX_LIVE_TABS_GLOBAL) {
    throw new SessionError(
      `Sim can have at most ${MAX_LIVE_TABS_GLOBAL} live browser tabs. Close a tab in another task and try again.`
    )
  }
}

const browserScopeStorage = new AsyncLocalStorage<string>()
const browserScopeStates = new Map<string, BrowserScopeState>()
const browserScopeAliases = new Map<string, string>()
/**
 * Soft-deleted tasks retain an encrypted descriptor but must not be
 * materialized by a stale renderer heartbeat or panel action in another
 * window. Only an explicit task activation clears this process-local
 * tombstone.
 */
const suspendedBrowserScopes = new Set<string>()
let activeBrowserScopeId: string | null = null

export function resolveBrowserScopeId(scopeId: string): string {
  let resolved = scopeId
  const visited = new Set<string>()
  while (browserScopeAliases.has(resolved) && !visited.has(resolved)) {
    visited.add(resolved)
    resolved = browserScopeAliases.get(resolved) as string
  }
  return resolved
}

export function getBrowserScopeId(): string {
  const scopeId = browserScopeStorage.getStore() ?? activeBrowserScopeId
  if (!scopeId) throw new SessionError('No browser chat scope is active.')
  return resolveBrowserScopeId(scopeId)
}

export function getActiveBrowserScopeId(): string | null {
  return activeBrowserScopeId ? resolveBrowserScopeId(activeBrowserScopeId) : null
}

function browserScopeState(scopeId = getBrowserScopeId()): BrowserScopeState {
  const resolved = resolveBrowserScopeId(scopeId)
  let state = browserScopeStates.get(resolved)
  if (!state) {
    state = createBrowserScopeState()
    browserScopeStates.set(resolved, state)
  }
  return state
}

export function withBrowserScope<T>(scopeId: string, fn: () => T): T {
  return browserScopeStorage.run(resolveBrowserScopeId(scopeId), fn)
}

function bindToBrowserScope<Args extends unknown[], Result>(
  scopeId: string,
  fn: (...args: Args) => Result
): (...args: Args) => Result {
  return (...args) => withBrowserScope(scopeId, () => fn(...args))
}

/**
 * Array proxy retained to keep the tab-management code readable while every
 * operation resolves against the AsyncLocalStorage-bound chat scope.
 */
function scopedArray<Key extends 'tabs' | 'recentlyClosedTabUrls'>(
  key: Key
): BrowserScopeState[Key] {
  return new Proxy([] as unknown[], {
    get: (_target, property) => {
      const array = browserScopeState()[key] as unknown[]
      const value = Reflect.get(array, property, array)
      return typeof value === 'function' ? value.bind(array) : value
    },
    set: (_target, property, value) =>
      Reflect.set(browserScopeState()[key] as unknown[], property, value),
  }) as BrowserScopeState[Key]
}

const tabs = scopedArray('tabs')
const recentlyClosedTabUrls = scopedArray('recentlyClosedTabUrls')
const currentScope = new Proxy({} as BrowserScopeState, {
  get: (_target, property) =>
    browserScopeState()[
      property as keyof BrowserScopeState
    ] as BrowserScopeState[keyof BrowserScopeState],
  set: (_target, property, value) => {
    Reflect.set(browserScopeState(), property, value)
    return true
  },
})
/**
 * Per-session rather than a single boolean: a process-wide flag would make the
 * SECOND partition ever configured silently skip every hardening step below —
 * a failure that type-checks and passes tests.
 */
const configuredPartitions = new WeakSet<Session>()
let events: AgentSessionEvents | null = null
let getMainWindow: () => BrowserWindow | null = () => null
let browserSessionPersistence: BrowserSessionPersistence | null = null
let browserDownloadSettings: BrowserDownloadSettings | null = null
/** Raw Sim preference; `system` remains dynamic as the OS theme changes. */
let browserTheme: BrowserTheme = 'system'
let browserAppTheme: BrowserTheme = 'system'
let browserAppearanceTheme: DesktopAppearanceTheme = 'app'
let browserDefaultZoom: DesktopZoomPercent = 100
type TrackedBrowserDownload = BrowserDownloadInfo & {
  savePath?: string
  interruptionReason?: string
}
type BrowserFinishedDownload = Omit<TrackedBrowserDownload, 'state'> & {
  state: Exclude<BrowserDownloadInfo['state'], 'progressing'>
  savePath: string
}

interface ActiveBrowserDownload {
  directory: string
  download: TrackedBrowserDownload
  item: DownloadItem
  diskCheckInFlight: boolean
  lastDiskCheckAt: number
  savePath?: string
  scopeId: string
  terminal: boolean
  limitReason?: string
}

const activeDownloadPaths = new Map<string, ActiveBrowserDownload>()

interface PendingTabRestore {
  generation: number
  tab: AgentTab
  url: string
  priority: 'foreground' | 'background'
  ready: Promise<boolean>
  resolveReady: (loaded: boolean) => void
  started: boolean
  settled: boolean
  requeueAfterPreemption: boolean
  cancelLoad?: () => void
  grantSitePermissionGrace?: () => void
  promoteToForeground?: () => void
}

const browserDownloadsByScope = new Map<string, TrackedBrowserDownload[]>()
const activeBrowserDownloads = new Set<ActiveBrowserDownload>()
const pendingForegroundTabRestores: PendingTabRestore[] = []
const pendingBackgroundTabRestores: PendingTabRestore[] = []
const activeTabRestores = new Set<PendingTabRestore>()
const activeBackgroundTabRestores = new Set<PendingTabRestore>()
let backgroundTabRestoreGeneration = 0

/** Mirrors the compact recent-downloads panel used by mainstream browsers. */
const MAX_RECENT_FINISHED_DOWNLOADS = 5

function browserDownloadsState(scopeId: string): BrowserDownloadsState {
  const resolved = resolveBrowserScopeId(scopeId)
  return {
    scopeId: resolved,
    downloads: (browserDownloadsByScope.get(resolved) ?? []).map(
      ({ savePath: _savePath, interruptionReason: _interruptionReason, ...item }) => ({ ...item })
    ),
  }
}

function publishBrowserDownloads(scopeId: string): void {
  events?.onDownloadsChanged?.(browserDownloadsState(scopeId))
}

function trimBrowserDownloads(scopeId: string): void {
  const downloads = browserDownloadsByScope.get(scopeId)
  if (!downloads) return
  let finished = 0
  browserDownloadsByScope.set(
    scopeId,
    downloads.filter((download) => {
      if (download.state === 'progressing') return true
      finished += 1
      return finished <= MAX_RECENT_FINISHED_DOWNLOADS
    })
  )
}

function updateDownloadProgress(download: BrowserDownloadInfo, item: DownloadItem): void {
  download.receivedBytes = Math.max(0, item.getReceivedBytes())
  download.totalBytes = Math.max(0, item.getTotalBytes())
}

function activeBrowserDownloadCount(scopeId?: string): number {
  if (!scopeId) return activeBrowserDownloads.size
  const resolved = resolveBrowserScopeId(scopeId)
  let count = 0
  for (const active of activeBrowserDownloads) {
    if (resolveBrowserScopeId(active.scopeId) === resolved) count += 1
  }
  return count
}

function withBrowserDownloadTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  onTimeout?: () => void
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      onTimeout?.()
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })
  return Promise.race([operation, expiry]).finally(() => clearTimeout(timeout))
}

async function browserDownloadFreeDiskBytes(directory: string): Promise<number | null> {
  try {
    const configured = browserDownloadSettings?.getFreeDiskBytes?.(directory)
    const lookup =
      configured === undefined
        ? statfs(directory).then((stats) => stats.bavail * stats.bsize)
        : Promise.resolve(configured)
    const available = await withBrowserDownloadTimeout(
      lookup,
      BROWSER_DOWNLOAD_DISK_CHECK_TIMEOUT_MS,
      'Browser download disk-space check timed out'
    )
    if (!Number.isFinite(available) || available < 0) return null
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(available))
  } catch (error) {
    logger.warn('Could not determine free disk space for agent browser download', {
      error: getErrorMessage(error),
    })
    return null
  }
}

function browserDownloadSizeLimitReason(): string {
  return `Stopped: exceeds the ${formatBrowserDownloadBytes(MAX_BROWSER_DOWNLOAD_BYTES)} download limit`
}

function browserDownloadDiskLimitReason(): string {
  return `Stopped: not enough disk space to finish safely while keeping ${formatBrowserDownloadBytes(MIN_BROWSER_DOWNLOAD_FREE_DISK_BYTES)} free`
}

function downloadRemainingReservation(item: DownloadItem): number {
  const receivedBytes = Math.max(0, item.getReceivedBytes())
  const totalBytes = Math.max(0, item.getTotalBytes())
  const targetBytes = totalBytes > 0 ? totalBytes : MAX_BROWSER_DOWNLOAD_BYTES
  return Math.max(0, targetBytes - receivedBytes)
}

function activeDownloadReservations(through?: ActiveBrowserDownload): number {
  let reservedBytes = 0
  for (const active of activeBrowserDownloads) {
    if (!active.limitReason) {
      reservedBytes += downloadRemainingReservation(active.item)
    }
    if (active === through) break
  }
  return reservedBytes
}

function browserDownloadAdmissionReason(scopeId: string, item: DownloadItem): string | null {
  if (Math.max(0, item.getTotalBytes()) > MAX_BROWSER_DOWNLOAD_BYTES) {
    return browserDownloadSizeLimitReason()
  }
  if (activeBrowserDownloadCount(scopeId) >= MAX_ACTIVE_BROWSER_DOWNLOADS_PER_SCOPE) {
    return `Stopped: this task already has ${MAX_ACTIVE_BROWSER_DOWNLOADS_PER_SCOPE} downloads in progress`
  }
  if (activeBrowserDownloadCount() >= MAX_ACTIVE_BROWSER_DOWNLOADS_GLOBAL) {
    return `Stopped: Sim already has ${MAX_ACTIVE_BROWSER_DOWNLOADS_GLOBAL} browser downloads in progress`
  }
  return null
}

function browserDownloadSizeLimitReasonForItem(item: DownloadItem): string | null {
  if (
    Math.max(0, item.getReceivedBytes()) > MAX_BROWSER_DOWNLOAD_BYTES ||
    Math.max(0, item.getTotalBytes()) > MAX_BROWSER_DOWNLOAD_BYTES
  ) {
    return browserDownloadSizeLimitReason()
  }
  return null
}

function createTrackedBrowserDownload(
  item: DownloadItem,
  state: BrowserDownloadInfo['state'],
  interruptionReason?: string
): TrackedBrowserDownload {
  const filename = suggestedFilename(item.getFilename(), item.getMimeType())
  return {
    id: generateId(),
    filename,
    state,
    receivedBytes: Math.max(0, item.getReceivedBytes()),
    totalBytes: Math.max(0, item.getTotalBytes()),
    startedAt: new Date().toISOString(),
    interruptionReason,
  }
}

function recordBrowserDownload(scopeId: string, download: TrackedBrowserDownload): void {
  browserDownloadsByScope.set(scopeId, [download, ...(browserDownloadsByScope.get(scopeId) ?? [])])
  trimBrowserDownloads(scopeId)
  publishBrowserDownloads(scopeId)
}

function cancelBrowserDownloadForLimit(active: ActiveBrowserDownload, reason: string): void {
  if (active.limitReason) return
  active.limitReason = reason
  active.download.interruptionReason = reason
  active.download.state = 'interrupted'
  try {
    active.item.cancel()
  } catch (error) {
    logger.warn('Could not cancel an agent browser download after a safety limit', {
      error: getErrorMessage(error),
    })
  }
}

function publishActiveBrowserDownload(active: ActiveBrowserDownload): void {
  const liveScopeId = resolveBrowserScopeId(active.scopeId)
  if (
    suspendedBrowserScopes.has(liveScopeId) ||
    !browserScopeStates.has(liveScopeId) ||
    !browserDownloadsByScope.get(liveScopeId)?.includes(active.download)
  ) {
    return
  }
  publishBrowserDownloads(liveScopeId)
}

function checkBrowserDownloadDiskSpace(
  active: ActiveBrowserDownload,
  check: 'admission' | 'progress',
  now = Date.now()
): void {
  if (active.terminal || active.limitReason || active.diskCheckInFlight) return
  if (
    check === 'progress' &&
    now - active.lastDiskCheckAt < BROWSER_DOWNLOAD_DISK_CHECK_INTERVAL_MS
  ) {
    return
  }

  active.lastDiskCheckAt = now
  active.diskCheckInFlight = true
  void browserDownloadFreeDiskBytes(active.directory)
    .then((freeDiskBytes) => {
      if (active.terminal || active.limitReason || !activeBrowserDownloads.has(active)) {
        return
      }
      const requiredFreeDiskBytes =
        MIN_BROWSER_DOWNLOAD_FREE_DISK_BYTES +
        activeDownloadReservations(check === 'admission' ? active : undefined)
      if (freeDiskBytes === null) {
        cancelBrowserDownloadForLimit(active, 'Stopped: available disk space could not be checked')
        publishActiveBrowserDownload(active)
        return
      }
      if (freeDiskBytes < requiredFreeDiskBytes) {
        cancelBrowserDownloadForLimit(active, browserDownloadDiskLimitReason())
        publishActiveBrowserDownload(active)
        return
      }
      if (check === 'admission' && active.download.state === 'progressing') active.item.resume()
    })
    .catch((error) => {
      if (active.terminal || active.limitReason || !activeBrowserDownloads.has(active)) return
      logger.warn('Could not complete an agent browser download disk-space check', {
        error: getErrorMessage(error),
      })
      cancelBrowserDownloadForLimit(active, 'Stopped: available disk space could not be checked')
      publishActiveBrowserDownload(active)
    })
    .finally(() => {
      active.diskCheckInFlight = false
    })
}

function releaseActiveBrowserDownload(active: ActiveBrowserDownload): void {
  if (active.terminal) return
  active.terminal = true
  activeBrowserDownloads.delete(active)
  releaseActiveBrowserDownloadPath(active)
}

function releaseActiveBrowserDownloadPath(
  active: ActiveBrowserDownload,
  savePath = active.savePath
): void {
  if (savePath && activeDownloadPaths.get(savePath) === active) {
    activeDownloadPaths.delete(savePath)
  }
}

function cancelActiveBrowserDownloads(scopeId?: string): void {
  const resolvedScopeId = scopeId === undefined ? null : resolveBrowserScopeId(scopeId)
  const downloads = [...activeBrowserDownloads].filter(
    (active) =>
      resolvedScopeId === null || resolveBrowserScopeId(active.scopeId) === resolvedScopeId
  )
  for (const active of downloads) releaseActiveBrowserDownload(active)
  const cancelledDownloads = new Set(downloads.map((active) => active.download))
  for (const [downloadScopeId, trackedDownloads] of browserDownloadsByScope) {
    if (resolvedScopeId !== null && resolveBrowserScopeId(downloadScopeId) !== resolvedScopeId) {
      continue
    }
    const retainedDownloads = trackedDownloads.filter(
      (download) => !cancelledDownloads.has(download)
    )
    if (retainedDownloads.length > 0) {
      browserDownloadsByScope.set(downloadScopeId, retainedDownloads)
    } else {
      browserDownloadsByScope.delete(downloadScopeId)
    }
  }
  for (const active of downloads) {
    try {
      active.item.cancel()
    } catch (error) {
      logger.warn('Could not cancel an active browser download while tearing down the session', {
        error: getErrorMessage(error),
      })
    }
  }
}

function isFinishedBrowserDownload(
  download: TrackedBrowserDownload
): download is BrowserFinishedDownload {
  return download.state !== 'progressing' && typeof download.savePath === 'string'
}

/** Returns safe metadata only; local paths stay in the Electron main process. */
export function getBrowserDownloadsState(scopeId: string): BrowserDownloadsState {
  return browserDownloadsState(scopeId)
}

/** Human-readable byte count for the native recent-downloads menu. */
function formatBrowserDownloadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unitIndex
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function downloadMenuDetail(download: TrackedBrowserDownload): string {
  const received = formatBrowserDownloadBytes(download.receivedBytes)
  if (download.state === 'progressing') {
    return download.totalBytes > 0
      ? `${received} / ${formatBrowserDownloadBytes(download.totalBytes)}`
      : `${received} · Downloading`
  }
  if (download.state === 'interrupted') {
    return `${received} · ${download.interruptionReason ?? 'Failed'}`
  }
  if (download.state === 'cancelled') return `${received} · Cancelled`
  return received
}

/** Opens above the native page, unlike renderer popovers beneath a WebContentsView. */
export function showBrowserDownloadsMenu(
  scopeId: string,
  ownerWindow: BrowserWindow,
  anchor: { x: number; y: number }
): boolean {
  if (ownerWindow.isDestroyed()) return false
  const resolved = resolveBrowserScopeId(scopeId)
  const downloads = browserDownloadsByScope.get(resolved) ?? []
  const template: MenuItemConstructorOptions[] =
    downloads.length === 0
      ? [{ label: 'No downloads yet', enabled: false }]
      : downloads.map((download) => {
          const revealable =
            download.state === 'completed' &&
            typeof download.savePath === 'string' &&
            existsSync(download.savePath)
          return {
            label: download.filename,
            sublabel: downloadMenuDetail(download),
            enabled: revealable,
            click: revealable
              ? () => {
                  showBrowserDownloadInFolder(resolved, download.id)
                }
              : undefined,
          }
        })
  Menu.buildFromTemplate(template).popup({
    window: ownerWindow,
    x: Math.round(anchor.x),
    y: Math.round(anchor.y),
  })
  return true
}

/** Reveals a completed download without launching the downloaded file. */
export function showBrowserDownloadInFolder(scopeId: string, downloadId: string): boolean {
  const resolved = resolveBrowserScopeId(scopeId)
  const download = browserDownloadsByScope
    .get(resolved)
    ?.find((candidate) => candidate.id === downloadId)
  if (
    !download ||
    download.state !== 'completed' ||
    typeof download.savePath !== 'string' ||
    !existsSync(download.savePath)
  ) {
    return false
  }
  shell.showItemInFolder(download.savePath)
  return true
}

/**
 * Returns the module to the state it had before any session ran.
 *
 * {@link initSession} names itself as the session boundary but set three of
 * these fields and left the rest, so a second call would inherit the first
 * session's tab id counter, theme, pinned-restore latch and persisted-list
 * digest — the last of which would then suppress the new session's first save
 * as an unchanged write. Nothing re-inits in production today, which is
 * exactly why the gap stayed invisible, and why the tests had to reset the
 * whole MODULE (`vi.resetModules()`, which the root CLAUDE.md forbids) just to
 * get a clean one.
 */
function resetSessionState(): void {
  for (const scopeId of browserScopeStates.keys()) {
    withBrowserScope(scopeId, closeLiveTabs)
  }
  browserScopeStates.clear()
  browserScopeAliases.clear()
  suspendedBrowserScopes.clear()
  activeBrowserScopeId = null
  browserSessionPersistence = null
  browserDownloadSettings = null
  browserTheme = 'system'
  browserAppTheme = 'system'
  browserAppearanceTheme = 'app'
  browserDefaultZoom = 100
  browserDownloadsByScope.clear()
  cancelActiveBrowserDownloads()
  backgroundTabRestoreGeneration += 1
  pendingForegroundTabRestores.length = 0
  pendingBackgroundTabRestores.length = 0
  activeTabRestores.clear()
  activeBackgroundTabRestores.clear()
  activatePanelScope(null)
}

export function initSession(
  handlers: AgentSessionEvents,
  mainWindowProvider: () => BrowserWindow | null,
  persistence?: BrowserSessionPersistence,
  downloadSettings?: BrowserDownloadSettings
): void {
  resetSessionState()
  events = handlers
  getMainWindow = mainWindowProvider
  browserSessionPersistence = persistence ?? null
  browserDownloadSettings = downloadSettings ?? null
  initPanel({
    getMainWindow: () => getMainWindow(),
    activeTab: () => {
      const scopeId = getActiveBrowserScopeId()
      return scopeId ? withBrowserScope(scopeId, activeTab) : null
    },
    backgroundColor: browserBackgroundColor,
    ensureInitialTab: () => {
      const scopeId = getActiveBrowserScopeId()
      if (!scopeId) return
      withBrowserScope(scopeId, () => {
        restoreBrowserSession()
        if (!hasSession()) {
          ensureTab()
        }
      })
    },
    onViewDetached: (view) => {
      if (!view) return
      const scopeId = browserScopeIdForView(view)
      if (scopeId) {
        withBrowserScope(scopeId, () => {
          clearFocusedBrowserTab(tabs.find((tab) => tab.view === view)?.id)
        })
      }
    },
  })
}

export function browserScopeIdForContents(contents: WebContents): string | null {
  for (const [scopeId, state] of browserScopeStates) {
    if (state.tabs.some((tab) => tab.view.webContents === contents)) return scopeId
  }
  return null
}

function browserScopeIdForView(view: WebContentsView): string | null {
  for (const [scopeId, state] of browserScopeStates) {
    if (state.tabs.some((tab) => tab.view === view)) return scopeId
  }
  return null
}

/**
 * Selects which chat owns the single native compositor. Scope state remains
 * live while hidden; only its view is detached until that chat is activated.
 */
export function activateBrowserScope(scopeId: string): string {
  const resolved = resolveBrowserScopeId(scopeId)
  suspendedBrowserScopes.delete(resolved)
  browserScopeState(resolved)
  activeBrowserScopeId = resolved
  activatePanelScope(resolved)
  return resolved
}

export function isBrowserScopeSuspended(scopeId: string): boolean {
  return suspendedBrowserScopes.has(resolveBrowserScopeId(scopeId))
}

/**
 * Whether a destination exists only because the renderer activated its chat.
 *
 * Activation deliberately stays lazy, so this state carries no browser
 * ownership of its own and may safely be replaced by a pending chat adopting
 * the same durable id.
 */
function isActivationOnlyBrowserScope(scopeId: string): boolean {
  const state = browserScopeStates.get(resolveBrowserScopeId(scopeId))
  return (
    state?.activationOnly === true &&
    state.tabs.length === 0 &&
    state.recentlyClosedTabUrls.length === 0 &&
    state.activeTabId === null &&
    state.automationTabId === null &&
    state.nextTabId === 1 &&
    !state.restored &&
    !state.restoring
  )
}

/**
 * Retags a pending-new-chat scope once the server assigns the durable chat id.
 * Aliasing keeps callbacks captured before the migration on the same state.
 */
export function migrateBrowserScope(fromScopeId: string, toScopeId: string): boolean {
  const from = resolveBrowserScopeId(fromScopeId)
  const to = resolveBrowserScopeId(toScopeId)
  if (from === to) return true
  const state = browserScopeStates.get(from)
  const destinationState = browserScopeStates.get(to)
  if (destinationState) {
    if (!isActivationOnlyBrowserScope(to)) return false
    try {
      /**
       * An activated-but-unhydrated durable scope may still own a persisted
       * strip from an earlier app run. That is material state and must win.
       */
      if (browserSessionPersistence?.load(to)) return false
    } catch (error) {
      logger.warn('Could not inspect persisted browser chat session before migration', {
        error: getErrorMessage(error),
      })
      return false
    }
  }

  try {
    if (browserSessionPersistence) {
      if (!browserSessionPersistence.migrateScope(from, to)) return false
    }
  } catch (error) {
    logger.warn('Could not migrate persisted browser chat session', {
      error: getErrorMessage(error),
    })
    return false
  }
  if (state) {
    browserScopeStates.delete(from)
    if (destinationState) browserScopeStates.delete(to)
    browserScopeStates.set(to, state)
    for (const tab of state.tabs) tab.scopeId = to
  } else if (destinationState) {
    browserScopeStates.delete(to)
  }
  const sourceDownloads = browserDownloadsByScope.get(from)
  if (sourceDownloads) {
    const destinationDownloads = browserDownloadsByScope.get(to) ?? []
    browserDownloadsByScope.set(to, [...sourceDownloads, ...destinationDownloads])
    browserDownloadsByScope.delete(from)
    trimBrowserDownloads(to)
    publishBrowserDownloads(to)
  }
  browserScopeAliases.set(from, to)
  if (
    (activeBrowserScopeId && resolveBrowserScopeId(activeBrowserScopeId) === to) ||
    activeBrowserScopeId === from
  ) {
    activeBrowserScopeId = to
  }
  migratePanelScope(from, to)
  return true
}

/** Destroys one chat's live browser state without touching the shared profile. */
export function disposeBrowserScope(scopeId: string): void {
  const resolved = resolveBrowserScopeId(scopeId)
  if (resolved !== scopeId) {
    suspendedBrowserScopes.delete(scopeId)
    browserDownloadsByScope.delete(scopeId)
    try {
      browserSessionPersistence?.disposeScope(scopeId)
    } catch (error) {
      logger.warn('Could not dispose persisted browser chat session', {
        error: getErrorMessage(error),
      })
    }
    return
  }
  browserDownloadsByScope.delete(resolved)
  cancelActiveBrowserDownloads(resolved)

  suspendedBrowserScopes.delete(resolved)
  const state = browserScopeStates.get(resolved)
  if (state) {
    withBrowserScope(resolved, () => {
      closeLiveTabs()
      events?.onTabsChanged()
      events?.onSessionClosed()
    })
    browserScopeStates.delete(resolved)
  }
  for (const [alias, target] of browserScopeAliases) {
    if (alias === resolved || resolveBrowserScopeId(target) === resolved) {
      browserScopeAliases.delete(alias)
    }
  }
  try {
    browserSessionPersistence?.disposeScope(resolved)
  } catch (error) {
    logger.warn('Could not dispose persisted browser chat session', {
      error: getErrorMessage(error),
    })
  }
  if (getActiveBrowserScopeId() === resolved) {
    activeBrowserScopeId = null
    activatePanelScope(null)
  }
}

/**
 * Saves and tears down one durable chat's live views without deleting its
 * descriptor. Reopening the chat creates fresh WebContents from that snapshot.
 *
 * No empty-strip/session-closed events are published: soft deletion removes
 * the resource's UI separately, and those events would overwrite its retained
 * renderer descriptor before the chat can be restored.
 *
 * The persist is best-effort: suspension accompanies chat deletion, and a
 * descriptor that could not be saved must never leave the deleted chat's
 * pages loaded invisibly. A restore after a failed save falls back to the
 * last successfully saved descriptor.
 */
export function suspendBrowserScope(scopeId: string): boolean {
  const resolved = resolveBrowserScopeId(scopeId)
  const state = browserScopeStates.get(resolved)
  if (!state) {
    suspendedBrowserScopes.add(resolved)
    cancelActiveBrowserDownloads(resolved)
    return true
  }

  withBrowserScope(resolved, () => {
    if (hasSession()) persistBrowserSession()
    suspendedBrowserScopes.add(resolved)
    cancelActiveBrowserDownloads(resolved)
    closeLiveTabs()
  })

  browserScopeStates.delete(resolved)
  if (getActiveBrowserScopeId() === resolved) {
    activeBrowserScopeId = null
    activatePanelScope(null)
  }
  return true
}

/**
 * Accepts only what is safe to navigate back to later: http(s), no embedded
 * credentials, bounded length. Closed and duplicated tab locations outlive
 * the navigation that produced them and must not revive a `user:pass@host`
 * URL.
 */
function sanitizeRestorableUrl(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || candidate.length > 8_192) return null
  if (candidate === 'about:blank') return candidate
  try {
    const url = new URL(candidate)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) {
      return url.href
    }
  } catch {}
  return null
}

function tabUrl(tab: AgentTab): string {
  return tab.pendingRestoreUrl || tab.view.webContents.getURL() || 'about:blank'
}

function browserSessionSnapshot(): BrowserSessionSnapshot {
  const liveTabs = tabs.filter((tab) => !tab.view.webContents.isDestroyed())
  const activeIndex = liveTabs.findIndex((tab) => tab.id === currentScope.activeTabId)
  const downloads = (browserDownloadsByScope.get(getBrowserScopeId()) ?? [])
    .filter(isFinishedBrowserDownload)
    .slice(0, MAX_RECENT_FINISHED_DOWNLOADS)
    .map(({ interruptionReason: _interruptionReason, ...download }) => ({ ...download }))
  return {
    v: 1,
    tabs: liveTabs.map((tab) => ({ url: tabUrl(tab), pinned: tab.pinned })),
    activeIndex,
    downloads,
  }
}

/**
 * Saves the complete tab strip for this chat. Hydration is transactional:
 * creating each WebContents must not write a series of one-tab prefixes over
 * the complete snapshot that is still being restored.
 */
function persistBrowserSession(): boolean {
  if (!currentScope.restored || currentScope.restoring) return false
  const snapshot = browserSessionSnapshot()
  const fingerprint = JSON.stringify(snapshot)
  if (fingerprint === currentScope.lastPersistedSnapshot) return true

  try {
    if (
      browserSessionPersistence &&
      !browserSessionPersistence.save(getBrowserScopeId(), snapshot)
    ) {
      return false
    }
    currentScope.lastPersistedSnapshot = fingerprint
    return true
  } catch (error) {
    logger.warn('Could not persist browser chat session', {
      error: getErrorMessage(error),
    })
    return false
  }
}

/** Read cookie metadata from the dedicated profile without exposing values. */
export async function listAgentCookieSignals(): Promise<BrowserCookieSignal[]> {
  const cookies = await electronSession.fromPartition(AGENT_PARTITION).cookies.get({})
  return cookies.flatMap(({ domain }) => (typeof domain === 'string' ? [{ domain }] : []))
}

/**
 * Writes imported cookies into the dedicated profile.
 *
 * Electron's cookie API is deliberately the only writer: Chromium owns the
 * destination store's format, and editing that SQLite file directly would
 * couple Sim to internals it does not control and risk corrupting the profile.
 * It is also the enforcement point — Chromium rejects a cookie whose
 * attributes are inconsistent (`SameSite=None` without `Secure`, a domain the
 * URL cannot set), so a row that would only import under weaker terms fails
 * here and is counted rather than being quietly relaxed.
 *
 * Failures are per-cookie: one rejected cookie must not cost the user the
 * rest. Nothing about a cookie is logged.
 */
export async function importAgentCookies(
  cookies: CookiesSetDetails[]
): Promise<{ imported: number; failed: number }> {
  const jar = electronSession.fromPartition(AGENT_PARTITION).cookies
  let imported = 0
  let failed = 0
  for (const cookie of cookies) {
    try {
      await jar.set(cookie)
      imported += 1
    } catch {
      failed += 1
    }
  }
  return { imported, failed }
}

/**
 * The single site permission a browsing surface cannot withhold: the one every
 * "Copy" button on the web goes through. Blanket-denying it made
 * `navigator.clipboard.writeText` reject with `NotAllowedError`, so those
 * buttons did nothing at all — no error, no copied text — while the legacy
 * `document.execCommand('copy')` path kept working, which is why only some
 * sites looked broken.
 *
 * Granting it hands the page no reach it lacked: Chromium still requires the
 * document to be focused and to hold a transient user activation, and a
 * sanitized write only places text the page already renders onto the clipboard.
 * Reading stays denied — that is the direction that would leak whatever the
 * user last copied from anywhere else.
 */
const ALLOWED_SITE_PERMISSIONS = new Set(['clipboard-sanitized-write'])

async function ensureOsMediaAccess(devices: readonly BrowserMediaDevice[]): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  for (const device of devices) {
    if (systemPreferences.getMediaAccessStatus(device) === 'granted') continue
    const granted = await systemPreferences.askForMediaAccess(device).catch(() => false)
    if (!granted) return false
  }
  return true
}

function mediaOrigin(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || candidate.length > 8_192) return null
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

function withoutUrlFragment(url: string): string {
  const fragmentIndex = url.indexOf('#')
  return fragmentIndex < 0 ? url : url.slice(0, fragmentIndex)
}

function requestedMediaDevices(candidate: unknown): BrowserMediaDevice[] | null {
  if (!Array.isArray(candidate) || candidate.length === 0) return null
  const devices = new Set<BrowserMediaDevice>()
  for (const type of candidate) {
    if (type === 'audio') devices.add('microphone')
    else if (type === 'video') devices.add('camera')
    else return null
  }
  return [...devices]
}

function scopedTabForContents(contents: WebContents): { scopeId: string; tab: AgentTab } | null {
  const scopeId = browserScopeIdForContents(contents)
  if (!scopeId) return null
  const tab = browserScopeStates
    .get(scopeId)
    ?.tabs.find((candidate) => candidate.view.webContents === contents)
  return tab ? { scopeId, tab } : null
}

function mediaRequestIsUserInitiated(scopeId: string, tab: AgentTab): boolean {
  const win = panelWindow()
  return (
    resolveBrowserScopeId(scopeId) === getActiveBrowserScopeId() &&
    browserScopeStates.get(scopeId)?.activeTabId === tab.id &&
    isPanelVisible() &&
    Boolean(win && !win.isDestroyed() && win.isFocused()) &&
    tab.view.webContents.isFocused() &&
    typeof tab.lastRealUserGestureAt === 'number' &&
    Date.now() - tab.lastRealUserGestureAt <= MEDIA_PERMISSION_GESTURE_WINDOW_MS
  )
}

function settleMediaPermission(tab: AgentTab, allowed: boolean): boolean {
  const pending = tab.pendingMediaPermission
  if (!pending) return false
  tab.pendingMediaPermission = undefined
  clearTimeout(pending.timeout)
  try {
    pending.callback(allowed)
  } catch (error) {
    logger.warn('Could not answer a browser media permission request', {
      error: getErrorMessage(error),
    })
  }
  return true
}

function revokeTabMediaPermissions(tab: AgentTab, publish = true): void {
  const hadPrompt = settleMediaPermission(tab, false)
  tab.mediaPermissionGrant = undefined
  tab.lastRealUserGestureAt = undefined
  if (hadPrompt && publish) publishPageIssue(tab)
}

/** Pending prompt metadata for the renderer-owned permission bubble. */
export function mediaPermissionRequestForContents(
  contents: WebContents
): BrowserMediaPermissionRequest | undefined {
  return tabForContents(contents)?.pendingMediaPermission?.request
}

/** Applies the user's response only to the exact live document that requested it. */
export async function respondToMediaPermission(requestId: string, allowed: boolean): Promise<void> {
  const tab = activeTab()
  const pending = tab?.pendingMediaPermission
  if (!tab || !pending || pending.request.requestId !== requestId) return

  if (!allowed) {
    settleMediaPermission(tab, false)
    publishPageIssue(tab)
    return
  }

  const contents = tab.view.webContents
  const currentOrigin = mediaOrigin(contents.getURL())
  if (
    currentOrigin !== pending.request.origin ||
    contents.getURL() !== pending.documentUrl ||
    getBrowserScopeId() !== getActiveBrowserScopeId() ||
    !isPanelVisible()
  ) {
    settleMediaPermission(tab, false)
    publishPageIssue(tab)
    return
  }

  const osAllowed = await ensureOsMediaAccess(pending.request.devices)
  if (
    tab.pendingMediaPermission !== pending ||
    tab.view.webContents.isDestroyed() ||
    mediaOrigin(contents.getURL()) !== pending.request.origin ||
    contents.getURL() !== pending.documentUrl ||
    tab.id !== currentScope.activeTabId ||
    getBrowserScopeId() !== getActiveBrowserScopeId() ||
    !isPanelVisible()
  ) {
    if (tab.pendingMediaPermission === pending) {
      settleMediaPermission(tab, false)
      publishPageIssue(tab)
    }
    return
  }

  if (osAllowed) {
    tab.mediaPermissionGrant = {
      origin: pending.request.origin,
      devices: new Set(pending.request.devices),
    }
  }
  settleMediaPermission(tab, osAllowed)
  publishPageIssue(tab)
}

function grantSiteOrigin(state: BrowserScopeState, origin: string): void {
  state.siteOriginGrants.delete(origin)
  state.siteOriginGrants.set(origin, true)
  while (state.siteOriginGrants.size > MAX_SITE_ORIGIN_GRANTS_PER_SCOPE) {
    const oldest = state.siteOriginGrants.keys().next().value
    if (typeof oldest !== 'string') break
    state.siteOriginGrants.delete(oldest)
  }
}

function hasSiteOriginGrant(state: BrowserScopeState, origin: string): boolean {
  if (!state.siteOriginGrants.has(origin)) return false
  grantSiteOrigin(state, origin)
  return true
}

function publishSitePermissionState(scopeId: string): void {
  const resolved = resolveBrowserScopeId(scopeId)
  const state = browserScopeStates.get(resolved)
  if (!state) return
  const active = state.tabs.find((tab) => tab.id === state.activeTabId)
  if (active && !active.view.webContents.isDestroyed()) {
    withBrowserScope(resolved, () => events?.onPageStateChanged(active.view.webContents))
  }
}

function settleSitePermission(tab: AgentTab, allowed: boolean, publish = true): boolean {
  const pending = tab.pendingSitePermission
  if (!pending) return false
  tab.pendingSitePermission = undefined
  clearTimeout(pending.timeout)
  pending.nativePromptController?.abort()
  pending.resolve(allowed)
  if (publish) publishSitePermissionState(tab.scopeId)
  return true
}

function scopedTabForRequest(details: {
  webContents?: WebContents
  webContentsId?: number
}): { scopeId: string; tab: AgentTab } | null {
  if (details.webContents) return scopedTabForContents(details.webContents)
  if (typeof details.webContentsId !== 'number') return null
  for (const [scopeId, state] of browserScopeStates) {
    const tab = state.tabs.find(
      (candidate) => candidate.view.webContents.id === details.webContentsId
    )
    if (tab) return { scopeId, tab }
  }
  return null
}

/** Highest-priority exact site request: visible tab, automation tab, then task tab order. */
export function sitePermissionRequestForScope(): BrowserSitePermissionRequest | undefined {
  const state = browserScopeState()
  const active = state.tabs.find((tab) => tab.id === state.activeTabId)?.pendingSitePermission
  if (active) return active.request
  const automation = state.tabs.find(
    (tab) => tab.id === state.automationTabId
  )?.pendingSitePermission
  if (automation) return automation.request
  return state.tabs.find((tab) => tab.pendingSitePermission)?.pendingSitePermission?.request
}

function grantSiteOriginForExplicitNavigation(contents: WebContents, destination: string): boolean {
  const scoped = scopedTabForContents(contents)
  const origin = mediaOrigin(destination)
  if (!scoped || !origin) return false
  const state = browserScopeStates.get(scoped.scopeId)
  if (!state || scoped.tab.view.webContents !== contents || contents.isDestroyed()) return false
  grantSiteOrigin(state, origin)
  return true
}

/** Grants only the destination origin entered through a native-activation-gated user action. */
export function grantSiteOriginForUserNavigation(
  contents: WebContents,
  destination: string
): boolean {
  return grantSiteOriginForExplicitNavigation(contents, destination)
}

/** Grants the exact destination origin after the browser driver has completed its SSRF check. */
export function grantSiteOriginForAgentNavigation(
  contents: WebContents,
  destination: string
): boolean {
  return grantSiteOriginForExplicitNavigation(contents, destination)
}

/** Applies a response only to the exact live task, tab, document, and suspended network request. */
export function respondToSitePermission(requestId: string, allowed: boolean): boolean {
  const scopeId = getBrowserScopeId()
  const state = browserScopeStates.get(scopeId)
  const tab = state?.tabs.find(
    (candidate) => candidate.pendingSitePermission?.request.requestId === requestId
  )
  const pending = tab?.pendingSitePermission
  if (!state || !tab || !pending) return false

  if (!allowed) return settleSitePermission(tab, false)

  const contents = tab.view.webContents
  const live =
    !contents.isDestroyed() &&
    pending.contents === contents &&
    pending.request.tabId === tab.id &&
    pending.documentUrl === contents.getURL() &&
    mediaOrigin(pending.destinationUrl) === pending.request.origin &&
    scopeId === resolveBrowserScopeId(tab.scopeId) &&
    scopeId === getActiveBrowserScopeId() &&
    isPanelVisible()
  if (!live) return settleSitePermission(tab, false)

  grantSiteOrigin(state, pending.request.origin)
  return settleSitePermission(tab, true)
}

async function requestSitePermission(details: {
  id: number
  url: string
  webContents?: WebContents
  webContentsId?: number
}): Promise<boolean> {
  const origin = mediaOrigin(details.url)
  const scoped = scopedTabForRequest(details)
  if (!origin || !scoped || suspendedBrowserScopes.has(scoped.scopeId)) return false
  const state = browserScopeStates.get(scoped.scopeId)
  const contents = scoped.tab.view.webContents
  if (!state || contents.isDestroyed()) return false

  if (mediaOrigin(contents.getURL()) === origin || hasSiteOriginGrant(state, origin)) return true
  if (scoped.scopeId !== getActiveBrowserScopeId() || !isPanelVisible()) return false
  const win = panelWindow()
  if (!win || win.isDestroyed()) return false

  settleSitePermission(scoped.tab, false, false)
  revokeTabMediaPermissions(scoped.tab, false)
  const request: BrowserSitePermissionRequest = {
    requestId: generateId(),
    tabId: scoped.tab.id,
    origin,
  }
  const allowed = new Promise<boolean>((resolve) => {
    scoped.tab.pendingSitePermission = {
      request,
      documentUrl: contents.getURL(),
      destinationUrl: details.url,
      contents,
      networkRequestId: details.id,
      resolve,
      timeout: setTimeout(
        bindToBrowserScope(scoped.scopeId, () => {
          const pending = scoped.tab.pendingSitePermission
          if (
            pending?.request.requestId !== request.requestId ||
            pending.networkRequestId !== details.id
          ) {
            return
          }
          settleSitePermission(scoped.tab, false)
        }),
        SITE_PERMISSION_PROMPT_TIMEOUT_MS
      ),
    }
  })
  scoped.tab.pendingRestore?.grantSitePermissionGrace?.()
  if (events?.sitePermissionPromptSupported(scoped.scopeId)) {
    win.focus()
    win.webContents.focus()
    publishSitePermissionState(scoped.scopeId)
  } else {
    const nativePromptController = new AbortController()
    const pending = scoped.tab.pendingSitePermission
    if (!pending || pending.request.requestId !== request.requestId) return await allowed
    pending.nativePromptController = nativePromptController
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        buttons: ['Block', 'Allow'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        signal: nativePromptController.signal,
        message: `Allow this browser task to open ${request.origin}?`,
        detail: 'Only allow this site if it is expected for the current task.',
      })
      .then(({ response }) => {
        withBrowserScope(scoped.scopeId, () => {
          respondToSitePermission(request.requestId, response === 1)
        })
      })
      .catch((error) => {
        if (!nativePromptController.signal.aborted) {
          logger.warn('Could not present the native site permission prompt', {
            error: getErrorMessage(error),
          })
        }
        withBrowserScope(scoped.scopeId, () => {
          respondToSitePermission(request.requestId, false)
        })
      })
  }
  return await allowed
}

/**
 * Default-deny hardening for the agent partition. Site permissions remain
 * denied apart from ALLOWED_SITE_PERMISSIONS. Media is granted only after a
 * renderer-owned, document-scoped prompt validates the requesting origin,
 * active visible tab, recent native user input, and operating-system grant.
 * Uploads use Chromium's native file chooser and downloads are saved into the
 * device-level browser download directory.
 */
function configureAgentPartition(ses: Session): void {
  if (configuredPartitions.has(ses)) return
  configuredPartitions.add(ses)
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission === 'media') {
      const scoped = scopedTabForContents(contents)
      const request = details as {
        isMainFrame?: boolean
        mediaTypes?: readonly string[]
        requestingUrl?: string
        securityOrigin?: string
      }
      const devices = requestedMediaDevices(request.mediaTypes)
      const requestingOrigin = mediaOrigin(request.requestingUrl)
      const securityOrigin = mediaOrigin(request.securityOrigin)
      const currentOrigin = mediaOrigin(contents.getURL())
      if (
        !scoped ||
        request.isMainFrame !== true ||
        !devices ||
        !requestingOrigin ||
        (securityOrigin !== null && securityOrigin !== requestingOrigin) ||
        currentOrigin !== requestingOrigin ||
        !mediaRequestIsUserInitiated(scoped.scopeId, scoped.tab)
      ) {
        callback(false)
        return
      }

      revokeTabMediaPermissions(scoped.tab, false)
      const prompt: BrowserMediaPermissionRequest = {
        requestId: generateId(),
        origin: requestingOrigin,
        devices,
      }
      scoped.tab.pendingMediaPermission = {
        request: prompt,
        documentUrl: contents.getURL(),
        callback,
        timeout: setTimeout(
          bindToBrowserScope(scoped.scopeId, () => {
            if (scoped.tab.pendingMediaPermission?.request.requestId !== prompt.requestId) return
            settleMediaPermission(scoped.tab, false)
            publishPageIssue(scoped.tab)
          }),
          MEDIA_PERMISSION_PROMPT_TIMEOUT_MS
        ),
      }
      const win = panelWindow()
      if (win && !win.isDestroyed()) win.webContents.focus()
      withBrowserScope(scoped.scopeId, () => publishPageIssue(scoped.tab))
      return
    }
    callback(ALLOWED_SITE_PERMISSIONS.has(permission))
  })
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if (permission === 'media') {
      if (!contents || details.isMainFrame !== true) return false
      const scoped = scopedTabForContents(contents)
      const grant = scoped?.tab.mediaPermissionGrant
      const checkedOrigins = [
        mediaOrigin(details.securityOrigin),
        mediaOrigin(requestingOrigin),
        mediaOrigin(details.requestingUrl),
      ].filter((origin): origin is string => origin !== null)
      const currentOrigin = mediaOrigin(contents.getURL())
      const device =
        details.mediaType === 'audio'
          ? 'microphone'
          : details.mediaType === 'video'
            ? 'camera'
            : null
      return Boolean(
        scoped &&
          grant &&
          device &&
          checkedOrigins.length > 0 &&
          checkedOrigins.every((origin) => origin === grant.origin) &&
          currentOrigin === grant.origin &&
          grant.devices.has(device) &&
          (process.platform !== 'darwin' ||
            systemPreferences.getMediaAccessStatus(device) === 'granted')
      )
    }
    return ALLOWED_SITE_PERMISSIONS.has(permission)
  })
  // Service workers do not inherit a tab's user agent. With only the tab's set,
  // the document request carries the browser string while the worker's own
  // script request still announces Electron — and on a site that routes its
  // fetches through a worker, that is the one the server sees.
  ses.setUserAgent(browserUserAgent())
  // SSRF choke point for the agent partition. Document navigations (top-level +
  // iframes) get the full DNS-resolving check — the one seam every navigation
  // passes through, including page-initiated ones the driver never sees (server
  // redirects, link clicks, location.href, meta-refresh) — so an internal host
  // can't slip in that way.
  //
  // Subresources that come back readable, render into screenshots, or execute
  // get the resolving check too, cached per host; fonts keep the cheap
  // synchronous path. See isBlockedSubresourceUrl and
  // subresourceNeedsResolution for why each way round.
  ses.webRequest.onBeforeRequest((details, callback) => {
    // Answered exactly once, and never throwing. A throw inside the `then`
    // below would otherwise land in the `catch` and answer a second time, and
    // by the time an async check settles the request's loader may be gone —
    // now the case for most subresources, not just the odd navigation.
    let settled = false
    const settle = (cancel: boolean) => {
      if (settled) return
      settled = true
      try {
        callback({ cancel })
      } catch (error) {
        logger.warn('Could not answer an agent request', { error: getErrorMessage(error) })
      }
    }
    if (details.resourceType === 'mainFrame') {
      void checkAgentUrl(details.url)
        .then(async (guard) => {
          if (!guard.ok) {
            logger.warn('Blocked agent document navigation to a private host')
            settle(true)
            return
          }
          settle(!(await requestSitePermission(details)))
        })
        .catch((error) => {
          // Fail closed: an unexpected rejection must cancel, never leave the
          // request suspended with no callback.
          logger.error('Agent SSRF check failed; cancelling request', { error })
          settle(true)
        })
      return
    }
    if (details.resourceType === 'subFrame') {
      void checkAgentUrl(details.url)
        .then((guard) => {
          if (!guard.ok) logger.warn('Blocked agent document navigation to a private host')
          settle(!guard.ok)
        })
        .catch((error) => {
          logger.error('Agent SSRF check failed; cancelling request', { error })
          settle(true)
        })
      return
    }
    if (!subresourceNeedsResolution(details.resourceType)) {
      settle(isBlockedRequestUrl(details.url))
      return
    }
    void isBlockedSubresourceUrl(details.url)
      .then((blocked) => settle(blocked))
      .catch((error) => {
        logger.error('Agent subresource SSRF check failed; cancelling request', { error })
        settle(true)
      })
  })
  ses.on('will-download', (_event, item, contents) => {
    const directory = browserDownloadSettings?.getDirectory()
    if (!directory) {
      logger.warn('Agent browser download has no configured destination')
      item.cancel()
      return
    }
    const scopeId = browserScopeIdForContents(contents) ?? getActiveBrowserScopeId()
    if (!scopeId) {
      item.cancel()
      return
    }
    const admissionReason = browserDownloadAdmissionReason(scopeId, item)
    if (admissionReason) {
      item.cancel()
      const rejected = createTrackedBrowserDownload(item, 'interrupted', admissionReason)
      recordBrowserDownload(scopeId, rejected)
      withBrowserScope(scopeId, persistBrowserSession)
      logger.warn('Agent browser download rejected by a safety limit', {
        filename: rejected.filename,
        reason: admissionReason,
      })
      return
    }

    const download = createTrackedBrowserDownload(item, 'progressing')
    const { filename } = download
    try {
      item.pause()
    } catch (error) {
      const reason = 'Stopped: the download could not be paused for a disk-space safety check'
      download.interruptionReason = reason
      download.state = 'interrupted'
      try {
        item.cancel()
      } catch (cancelError) {
        logger.warn('Could not cancel an agent browser download after pause failed', {
          error: getErrorMessage(cancelError),
          filename,
        })
      }
      recordBrowserDownload(scopeId, download)
      withBrowserScope(scopeId, persistBrowserSession)
      logger.warn('Agent browser download could not be paused for admission', {
        error: getErrorMessage(error),
        filename,
      })
      return
    }
    const active: ActiveBrowserDownload = {
      directory,
      download,
      item,
      diskCheckInFlight: false,
      lastDiskCheckAt: 0,
      scopeId,
      terminal: false,
    }
    activeBrowserDownloads.add(active)
    recordBrowserDownload(scopeId, download)
    logger.info('Agent browser download started', { filename })
    item.on('updated', (_updatedEvent, state) => {
      updateDownloadProgress(download, item)
      if (state === 'interrupted') {
        download.state = 'interrupted'
      } else {
        const limitReason = browserDownloadSizeLimitReasonForItem(item)
        if (limitReason) cancelBrowserDownloadForLimit(active, limitReason)
        else {
          download.state = 'progressing'
          if (active.savePath) checkBrowserDownloadDiskSpace(active, 'progress')
        }
      }

      const liveScopeId = resolveBrowserScopeId(scopeId)
      if (
        suspendedBrowserScopes.has(liveScopeId) ||
        !browserScopeStates.has(liveScopeId) ||
        !browserDownloadsByScope.get(liveScopeId)?.includes(download)
      ) {
        return
      }
      publishBrowserDownloads(liveScopeId)
    })
    item.once('done', (_doneEvent, state) => {
      releaseActiveBrowserDownload(active)
      const liveScopeId = resolveBrowserScopeId(scopeId)
      if (
        suspendedBrowserScopes.has(liveScopeId) ||
        !browserScopeStates.has(liveScopeId) ||
        !browserDownloadsByScope.get(liveScopeId)?.includes(download)
      ) {
        return
      }
      updateDownloadProgress(download, item)
      download.state = active.limitReason ? 'interrupted' : state
      trimBrowserDownloads(liveScopeId)
      publishBrowserDownloads(liveScopeId)
      withBrowserScope(liveScopeId, persistBrowserSession)
      if (download.state === 'completed') {
        logger.info('Agent browser download completed', { filename })
        if (process.platform === 'darwin' && active.savePath) {
          app.dock?.downloadFinished(active.savePath)
        }
      } else if (download.state === 'interrupted') {
        logger.warn('Agent browser download interrupted', {
          filename,
          reason: download.interruptionReason,
        })
      }
    })
    let allocationExpired = false
    const allocation = uniqueDownloadPath(directory, filename, {
      isActive: () =>
        !allocationExpired &&
        !active.terminal &&
        !active.limitReason &&
        activeBrowserDownloads.has(active),
      pathExists: browserDownloadSettings?.pathExists,
      reservePath: (candidate) => {
        if (
          allocationExpired ||
          active.terminal ||
          active.limitReason ||
          !activeBrowserDownloads.has(active) ||
          activeDownloadPaths.has(candidate)
        ) {
          return false
        }
        activeDownloadPaths.set(candidate, active)
        active.savePath = candidate
        return true
      },
    })
    void withBrowserDownloadTimeout(
      allocation,
      BROWSER_DOWNLOAD_PATH_ALLOCATION_TIMEOUT_MS,
      'Browser download path allocation timed out',
      () => {
        allocationExpired = true
      }
    )
      .then((savePath) => {
        if (active.terminal || !activeBrowserDownloads.has(active)) {
          releaseActiveBrowserDownloadPath(active, savePath ?? undefined)
          return
        }
        if (!savePath) {
          cancelBrowserDownloadForLimit(
            active,
            'Stopped: a safe non-conflicting download filename could not be allocated'
          )
          publishActiveBrowserDownload(active)
          return
        }
        download.savePath = savePath
        try {
          item.setSavePath(savePath)
        } catch (error) {
          releaseActiveBrowserDownloadPath(active, savePath)
          active.savePath = undefined
          download.savePath = undefined
          logger.warn('Could not set the destination for an agent browser download', {
            error: getErrorMessage(error),
            filename,
          })
          cancelBrowserDownloadForLimit(
            active,
            'Stopped: the download destination could not be prepared safely'
          )
          publishActiveBrowserDownload(active)
          return
        }
        checkBrowserDownloadDiskSpace(active, 'admission')
      })
      .catch((error) => {
        if (active.terminal || !activeBrowserDownloads.has(active)) return
        logger.warn('Could not allocate an agent browser download destination', {
          error: getErrorMessage(error),
          filename,
        })
        cancelBrowserDownloadForLimit(
          active,
          'Stopped: the download destination could not be prepared safely'
        )
        publishActiveBrowserDownload(active)
      })
  })
}

function focusRendererOmnibox(mode: BrowserOmniboxFocusMode): void {
  if (getBrowserScopeId() !== getActiveBrowserScopeId()) return
  const win = panelWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.focus()
  win.webContents.send('browser-agent:focus-omnibox', mode, getBrowserScopeId())
}

function tabForContents(contents: WebContents): AgentTab | null {
  return tabs.find((tab) => tab.view.webContents === contents) ?? null
}

function publishPageIssue(tab: AgentTab, focusRecovery = false): void {
  events?.onTabsChanged()
  if (tab.id !== currentScope.activeTabId) return
  if (focusRecovery && getBrowserScopeId() === getActiveBrowserScopeId() && isPanelVisible()) {
    const win = panelWindow()
    if (win && !win.isDestroyed()) win.webContents.focus()
  }
  events?.onPageStateChanged(tab.view.webContents)
}

/** Returns the recoverable problem currently replacing a tab's native page. */
export function pageIssueForContents(contents: WebContents): BrowserPageIssue | undefined {
  return tabForContents(contents)?.pageIssue
}

/** Records a failed main-frame navigation without losing the last committed page. */
export function recordPageLoadFailure(
  contents: WebContents,
  issue: Extract<BrowserPageIssue, { kind: 'load-error' }>
): void {
  const tab = tabForContents(contents)
  if (!tab) return
  tab.pageIssue = issue
  tab.syntheticForward = undefined
  publishPageIssue(tab, true)
}

/** Clears transient recovery state when Chromium begins loading a new document. */
export function notePageLoadStarted(contents: WebContents): void {
  const tab = tabForContents(contents)
  if (!tab) return
  const changed = Boolean(tab.pageIssue)
  tab.pageIssue = undefined
  if (changed) publishPageIssue(tab)
}

function notePageNavigationStarted(contents: WebContents): void {
  const tab = tabForContents(contents)
  if (!tab) return
  if (tab.preserveSyntheticForwardOnNextNavigation) {
    tab.preserveSyntheticForwardOnNextNavigation = false
  } else {
    tab.syntheticForward = undefined
  }
}

/** Includes Sim's failed-navigation entry in the browser's Back availability. */
export function canGoBack(contents: WebContents): boolean {
  return (
    pageIssueForContents(contents)?.kind === 'load-error' || contents.navigationHistory.canGoBack()
  )
}

/** Includes a dismissed failed navigation in the browser's Forward availability. */
export function canGoForward(contents: WebContents): boolean {
  return (
    Boolean(tabForContents(contents)?.syntheticForward) || contents.navigationHistory.canGoForward()
  )
}

/** Traverses backward while preserving a failed navigation as a forward entry. */
export function goBack(contents: WebContents): boolean {
  const tab = tabForContents(contents)
  if (!tab) return false
  if (tab.pageIssue?.kind === 'load-error') {
    prepareExplicitNavigation(contents)
    tab.syntheticForward = {
      url: tab.pageIssue.url,
      baseHistoryIndex: contents.navigationHistory.getActiveIndex(),
    }
    tab.pageIssue = undefined
    publishPageIssue(tab)
    return true
  }
  if (!contents.navigationHistory.canGoBack()) return false
  prepareExplicitNavigation(contents)
  tab.preserveSyntheticForwardOnNextNavigation = Boolean(tab.syntheticForward)
  contents.navigationHistory.goBack()
  return true
}

/** Traverses forward through native history before retrying a failed navigation. */
export function goForward(contents: WebContents): boolean {
  const tab = tabForContents(contents)
  if (!tab) return false
  const syntheticForward = tab.syntheticForward
  if (syntheticForward) {
    if (
      contents.navigationHistory.getActiveIndex() < syntheticForward.baseHistoryIndex &&
      contents.navigationHistory.canGoForward()
    ) {
      prepareExplicitNavigation(contents)
      tab.preserveSyntheticForwardOnNextNavigation = true
      contents.navigationHistory.goForward()
      return true
    }
    prepareExplicitNavigation(contents)
    tab.syntheticForward = undefined
    void contents.loadURL(syntheticForward.url).catch(() => {})
    return true
  }
  if (!contents.navigationHistory.canGoForward()) return false
  prepareExplicitNavigation(contents)
  contents.navigationHistory.goForward()
  return true
}

/** Retries the appropriate recovery path for a failed, crashed, or hung page. */
export function reloadPage(contents: WebContents): void {
  const tab = tabForContents(contents)
  prepareExplicitNavigation(contents)
  const issue = tab?.pageIssue
  if (issue?.kind === 'load-error') {
    void contents.loadURL(issue.url).catch(() => {})
    return
  }
  if (issue?.kind === 'unresponsive' && tab) {
    tab.recoveringUnresponsive = true
    contents.forcefullyCrashRenderer()
    return
  }
  contents.reload()
}

/** Hands one page selection to the exact app window and chat hosting its tab. */
function addPageSelectionToChat(contents: WebContents, text: string): void {
  if (!text.trim() || getBrowserScopeId() !== getActiveBrowserScopeId()) return
  const tab = tabs.find((entry) => entry.view.webContents === contents)
  const win = panelWindow()
  if (!tab || !win || win.isDestroyed()) return

  const currentUrl = contents.getURL()
  const title = contents.getTitle().trim()
  const payload: BrowserAddToChatPayload = {
    text,
    tabId: tab.id,
    scopeId: getBrowserScopeId(),
    ...(/^https?:\/\//i.test(currentUrl) ? { url: currentUrl } : {}),
    ...(title ? { title } : {}),
  }
  win.webContents.focus()
  win.webContents.send('browser-agent:add-to-chat', payload)
}

/**
 * Opens the renderer's find bar and moves keyboard focus to it. The bar is
 * docked browser chrome rather than an overlay on the page, so the native page
 * remains visible while the search controls are open.
 */
function openRendererFind(): void {
  if (getBrowserScopeId() !== getActiveBrowserScopeId()) return
  const win = panelWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.focus()
  win.webContents.send('browser-agent:open-find', getBrowserScopeId())
}

/**
 * Drops a tab's highlights and stops treating it as the tab being searched.
 * Leaves the renderer's bar alone — emptying the find box and searching a
 * different tab both end a find while the user is still typing in the bar.
 */
function stopFindOnTab(tabId: string | null): void {
  if (tabId === null) return
  const tab = tabs.find((entry) => entry.id === tabId)
  if (tab && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.stopFindInPage('clearSelection')
  }
  if (currentScope.findingTabId === tabId) {
    currentScope.findingTabId = null
    currentScope.findingRequestId = null
  }
}

/**
 * Stops the find and dismisses the renderer's bar, for when the page it was
 * run against is gone — a navigation or a tab switch. Chrome dismisses find on
 * navigation too, and a count for the previous document is worse than no bar.
 */
function dismissFind(tabId: string | null): void {
  if (tabId === null) return
  const wasFinding = currentScope.findingTabId === tabId
  stopFindOnTab(tabId)
  if (!wasFinding || getBrowserScopeId() !== getActiveBrowserScopeId()) return
  const win = panelWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('browser-agent:close-find', getBrowserScopeId())
  }
}

/**
 * Runs Chromium's own find against the active tab. An empty query stops the
 * find rather than searching for nothing, matching what emptying Chrome's find
 * box does — the bar stays open and ready for the next query.
 */
export function findInActiveTab(request: BrowserFindRequest): void {
  const tab = activeTab()
  if (!tab) return
  if (request.query === '') {
    stopFindOnTab(tab.id)
    return
  }
  // A find started on another tab has to go before this one begins, or its
  // highlights survive on a page the user can no longer see them on.
  if (currentScope.findingTabId !== null && currentScope.findingTabId !== tab.id) {
    stopFindOnTab(currentScope.findingTabId)
  }
  currentScope.findingTabId = tab.id
  currentScope.findingRequestId = tab.view.webContents.findInPage(request.query, {
    forward: request.forward,
    // Electron's name is misleading: true begins a new finding session, while
    // false advances the session already running.
    findNext: request.newSession,
  })
}

/**
 * Stops the running find.
 *
 * `focusPage` distinguishes the user dismissing the bar — where focus is being
 * pulled out from under them and Chrome leaves it on the page — from the bar
 * merely unmounting because the browser panel went away. Only the renderer can
 * tell those apart: the panel's own teardown reports bounds after its
 * children's cleanups run, so by the time this is reached the panel still
 * looks visible either way, and focusing the page on teardown would drag the
 * user back to a browser they just navigated away from.
 */
export function stopFindInActiveTab(focusPage: boolean): void {
  stopFindOnTab(currentScope.findingTabId)
  if (!focusPage) return
  // Deliberately the ACTIVE tab, not whichever tab was being searched: there is
  // often no search running at all (the bar was opened and closed without a
  // query, or the box was emptied first, both of which clear the searched tab).
  // Keying focus off the search left those cases with focus on the input that
  // just unmounted, which lands on <body> — from there the page cannot receive
  // the next Mod+F for the shell to intercept, and the renderer's own handler
  // is scoped to the panel, so find became unopenable until something else was
  // clicked.
  const tab = activeTab()
  if (tab) tab.view.webContents.focus()
}

/**
 * Opens a link from a page in another tab of this browser. Shared by the
 * window.open interception and the page's right-click menu — both have to stay
 * inside the browser resource rather than spawn a native window, and both are
 * reached from an untrusted page, so the scheme is checked here once.
 */
function openTabWithUrl(
  url: string,
  { agentOwned, userAuthorized }: { agentOwned: boolean; userAuthorized: boolean }
): void {
  if (!/^https?:\/\//i.test(url)) return
  try {
    const tab = agentOwned ? addAutomationTab() : addTab()
    if (userAuthorized) grantSiteOriginForUserNavigation(tab.view.webContents, url)
    void tab.view.webContents.loadURL(url).catch(() => {})
  } catch (error) {
    logger.warn('Could not open a link in a new browser tab', {
      error: getErrorMessage(error),
    })
  }
}

function createTabView(): WebContentsView {
  const scopeId = getBrowserScopeId()
  const view = new WebContentsView({
    webPreferences: {
      partition: AGENT_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      // A minimal, isolated preload that reports login-form presence and
      // performs user-authorized credential fills. It exposes nothing to the
      // page, and runs in the top-level frame only.
      preload: join(__dirname, 'browser-preload.cjs'),
      // Throttled by default: a hidden tab should idle. The one exception is
      // the active tab while a tool waits on it, applied explicitly by
      // applyActiveTabThrottling — never blanket across every tab.
      backgroundThrottling: true,
      spellcheck: false,
      // The default every origin this tab visits starts at; a per-origin zoom
      // the user sets from the page menu still wins and still persists.
      zoomFactor: getBrowserDefaultZoomFactor(),
    },
  })
  try {
    return initializeTabView(view, scopeId)
  } catch (error) {
    if (!view.webContents.isDestroyed()) view.webContents.close()
    throw error
  }
}

function initializeTabView(view: WebContentsView, scopeId: string): WebContentsView {
  view.setBackgroundColor(browserBackgroundColor())
  const contents = view.webContents
  registerAgentWebContents(contents)
  configureAgentPartition(contents.session)
  // The session default does not reach a WebContents that already exists, and
  // the first tab is what brings the session into being, so each tab sets its
  // own as well — otherwise tab one browses as Electron and the rest as Chrome.
  contents.setUserAgent(browserUserAgent())
  attachAgentContextMenu(contents, {
    addToChat: (text) => withBrowserScope(scopeId, () => addPageSelectionToChat(contents, text)),
    openTab: (url) =>
      withBrowserScope(scopeId, () =>
        openTabWithUrl(url, { agentOwned: false, userAuthorized: true })
      ),
    defaultZoomFactor: getBrowserDefaultZoomFactor,
  })

  contents.on(
    'focus',
    bindToBrowserScope(scopeId, () => {
      if (currentScope.focusedBrowserClearTimer !== null) {
        clearTimeout(currentScope.focusedBrowserClearTimer)
        currentScope.focusedBrowserClearTimer = null
      }
      const tab = tabs.find((entry) => entry.view.webContents === contents)
      currentScope.focusedBrowserTabId = tab?.id ?? currentScope.activeTabId
    })
  )
  contents.on(
    'before-mouse-event',
    bindToBrowserScope(scopeId, (_event, mouse) => {
      if (
        isDispatchingAgentInput(contents) ||
        !['mouseDown', 'contextMenu', 'mouseWheel'].includes(mouse.type)
      ) {
        return
      }
      const tab = tabs.find((entry) => entry.view.webContents === contents)
      if (tab?.id === currentScope.activeTabId) {
        currentScope.visibleTabUserSelected = true
        if (mouse.type === 'mouseDown') tab.lastRealUserGestureAt = Date.now()
      }
    })
  )
  contents.on(
    'blur',
    bindToBrowserScope(scopeId, () => {
      const tab = tabs.find((entry) => entry.view.webContents === contents)
      if (!tab || currentScope.focusedBrowserTabId !== tab.id) return
      if (currentScope.focusedBrowserClearTimer !== null) {
        clearTimeout(currentScope.focusedBrowserClearTimer)
      }
      // Electron can emit blur while resolving an application-menu accelerator.
      // Defer the clear for one event-loop turn so the synchronous menu callback
      // can still identify which native tab owned the keystroke.
      currentScope.focusedBrowserClearTimer = setTimeout(
        bindToBrowserScope(scopeId, () => {
          currentScope.focusedBrowserClearTimer = null
          if (currentScope.focusedBrowserTabId === tab.id && !contents.isFocused()) {
            currentScope.focusedBrowserTabId = null
          }
        }),
        0
      )
    })
  )

  // Keep popups inside the browser resource: http(s) window.open and
  // target=_blank requests become a new internal tab, never a native window.
  contents.setWindowOpenHandler((details) => {
    withBrowserScope(scopeId, () =>
      openTabWithUrl(details.url, {
        agentOwned: agentOwnsPopupFrom(contents),
        userAuthorized: false,
      })
    )
    return { action: 'deny' }
  })

  // A page can call window.resizeTo/window.moveTo, and Electron otherwise
  // applies that request to the BrowserWindow which owns this view. Controlled
  // pages must never be able to move or resize the Sim desktop window.
  contents.on('content-bounds-updated', (event) => {
    event.preventDefault()
  })

  // Pages may hold navigation hostage with beforeunload dialogs nobody can
  // see; always let the unload proceed.
  contents.on('will-prevent-unload', (event) => {
    event.preventDefault()
  })
  contents.on(
    'render-process-gone',
    bindToBrowserScope(scopeId, (_event, details) => {
      const tab = tabs.find((entry) => entry.view === view)
      if (!tab) return
      if (tab.recoveringUnresponsive) {
        tab.recoveringUnresponsive = false
        contents.reload()
        return
      }
      dismissFind(tab.id)
      settleSitePermission(tab, false)
      revokeTabMediaPermissions(tab, false)
      tab.pageIssue = {
        kind: 'crashed',
        reason: details.reason,
        url: tab.pendingRestoreUrl || contents.getURL(),
      }
      tab.syntheticForward = undefined
      logger.warn('Browser tab renderer exited', { reason: details.reason })
      publishPageIssue(tab, true)
    })
  )
  contents.on(
    'unresponsive',
    bindToBrowserScope(scopeId, () => {
      const tab = tabs.find((entry) => entry.view === view)
      if (!tab || tab.pageIssue?.kind === 'crashed') return
      dismissFind(tab.id)
      settleSitePermission(tab, false)
      revokeTabMediaPermissions(tab, false)
      tab.pageIssue = {
        kind: 'unresponsive',
        url: tab.pendingRestoreUrl || contents.getURL(),
      }
      publishPageIssue(tab, true)
    })
  )
  contents.on(
    'responsive',
    bindToBrowserScope(scopeId, () => {
      const tab = tabs.find((entry) => entry.view === view)
      if (!tab || tab.pageIssue?.kind !== 'unresponsive') return
      tab.pageIssue = undefined
      publishPageIssue(tab)
    })
  )
  contents.on(
    'before-input-event',
    bindToBrowserScope(scopeId, (event, input) => {
      const tab = tabs.find((entry) => entry.view === view)
      if (!isDispatchingAgentInput(contents) && tab?.id === currentScope.activeTabId) {
        currentScope.visibleTabUserSelected = true
        if (input.type === 'keyDown' && !input.isAutoRepeat) tab.lastRealUserGestureAt = Date.now()
      }
      const shortcut = browserShortcutForInput(input)
      if (!shortcut) return

      event.preventDefault()
      if (shortcut === 'focus-omnibox') {
        focusRendererOmnibox('select')
        return
      }
      if (shortcut === 'find') {
        openRendererFind()
        return
      }
      if (shortcut === 'new-tab') {
        addTab()
        focusRendererOmnibox('clear')
        return
      }

      if (tab) closeTabFromUser(tab.id)
    })
  )
  contents.on(
    'found-in-page',
    bindToBrowserScope(scopeId, (_event, result) => {
      const tab = tabs.find((entry) => entry.view === view)
      // Counts from a tab the user has already left would relabel the bar for
      // whatever page is on screen now.
      if (
        !tab ||
        tab.id !== currentScope.findingTabId ||
        result.requestId !== currentScope.findingRequestId ||
        getBrowserScopeId() !== getActiveBrowserScopeId()
      ) {
        return
      }
      const win = panelWindow()
      if (!win || win.isDestroyed()) return
      const payload: BrowserFindResult = {
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
        final: result.finalUpdate,
      }
      win.webContents.send('browser-agent:find-result', payload, getBrowserScopeId())
    })
  )
  // A document load replaces what the find was pointing at. Same-document
  // route changes do not, and Chromium keeps the highlights across them, so
  // only real navigations dismiss the bar.
  contents.on(
    'did-start-navigation',
    bindToBrowserScope(scopeId, (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      const tab = tabs.find((entry) => entry.view === view)
      if (tab) dismissFind(tab.id)
    })
  )
  // A pinned tab persists its latest top-level location, including
  // user-driven navigations that do not pass through the driver.
  contents.on(
    'did-navigate',
    bindToBrowserScope(scopeId, () => {
      const tab = tabs.find((entry) => entry.view.webContents === contents)
      if (tab) tab.pendingRestoreUrl = undefined
      persistBrowserSession()
    })
  )
  contents.on(
    'did-navigate-in-page',
    bindToBrowserScope(scopeId, (_event, _url, isMainFrame) => {
      if (isMainFrame) persistBrowserSession()
    })
  )
  // Both document loads and same-document route changes invalidate anything
  // bound to the previous page: a single-page app can replace a login form
  // with another site's UI without ever loading a new document.
  contents.on(
    'did-start-navigation',
    bindToBrowserScope(scopeId, (details) => {
      if (!details.isMainFrame) return
      const tab = tabs.find((entry) => entry.view === view)
      if (tab) {
        if (
          tab.pendingSitePermission &&
          withoutUrlFragment(tab.pendingSitePermission.destinationUrl) !==
            withoutUrlFragment(details.url)
        ) {
          settleSitePermission(tab, false)
        }
        revokeTabMediaPermissions(tab)
      }
      notePageNavigationStarted(contents)
      events?.onTabNavigated(contents, false)
    })
  )
  contents.on(
    'did-navigate',
    bindToBrowserScope(scopeId, () => events?.onTabNavigated(contents, false))
  )
  contents.on(
    'did-navigate-in-page',
    bindToBrowserScope(scopeId, (_event, _url, isMainFrame) => {
      if (isMainFrame) events?.onTabNavigated(contents, true)
    })
  )
  contents.on(
    'destroyed',
    bindToBrowserScope(scopeId, () => {
      const tab = tabs.find((entry) => entry.view === view)
      if (tab) {
        settleSitePermission(tab, false)
        revokeTabMediaPermissions(tab, false)
      }
      events?.onTabClosed(contents)
    })
  )

  events?.onTabCreated(contents)
  return view
}

/** True while any tab exists. */
export function hasSession(): boolean {
  return tabs.some((tab) => !tab.view.webContents.isDestroyed())
}

/**
 * Keeps the ACTIVE tab responsive during an agent action, then returns it to
 * normal background throttling.
 *
 * Only the active tab, deliberately. The agent drives one tab at a time — the
 * active one — possibly while the panel is hidden and even that view is
 * detached, so it is the only tab that must not be throttled mid-tool. Waking
 * every tab, as this once did, meant an agent run kept all N-1 background
 * renderers at full speed for the length of the run, which is the browser
 * side of the multi-tab lag. Nothing depends on a background tab staying
 * awake: switching to one activates it (and re-applies this) before any tool
 * touches it, and network loading is not throttled anyway.
 */
export function setAutomationActive(active: boolean): void {
  if (currentScope.automationActive === active) return
  currentScope.automationActive = active
  applyActiveTabThrottling()
  events?.onTabsChanged()
}

export function setAutomationNeedsAttention(needsAttention: boolean): void {
  if (currentScope.automationNeedsAttention === needsAttention) return
  currentScope.automationNeedsAttention = needsAttention
  events?.onTabsChanged()
}

/**
 * Unthrottles the active tab while automation is active, and throttles every
 * other tab. Call after anything that changes which tab is active, so the
 * exemption follows the active tab rather than being stranded on the old one.
 */
/**
 * Re-applies the tab throttling policy after a caller temporarily suspended it
 * (the panel's reveal pulse). Exempts the automation-active tab exactly as the
 * internal policy does.
 */
export function reassertTabThrottling(): void {
  applyActiveTabThrottling()
}

function applyActiveTabThrottling(): void {
  for (const tab of tabs) {
    if (tab.view.webContents.isDestroyed()) continue
    const exempt = currentScope.automationActive && tab.id === currentScope.automationTabId
    tab.view.webContents.setBackgroundThrottling(!exempt)
  }
}

/** A closed target must not transfer its activity marker to a replacement tab. */
function clearAutomationIndicatorsForTab(tabId: string): void {
  if (currentScope.automationTabId !== tabId) return
  currentScope.automationActive = false
  currentScope.automationNeedsAttention = false
}

function browserBackgroundColor(): string {
  const dark =
    browserTheme === 'dark' || (browserTheme === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? '#0c0c0c' : '#ffffff'
}

function updateTabBackgrounds(): void {
  const color = browserBackgroundColor()
  for (const tab of tabs) {
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.setBackgroundColor(color)
    }
  }
}

/**
 * Applies Sim's raw appearance preference to every current and future tab.
 * Page media-query emulation stays in the CDP layer; this module owns the
 * native view backdrop used before and between page paints.
 */
export function setBrowserTheme(theme: BrowserTheme): void {
  if (browserTheme === theme) return
  browserTheme = theme
  for (const scopeId of browserScopeStates.keys()) {
    withBrowserScope(scopeId, () => {
      updateTabBackgrounds()
      for (const tab of tabs) {
        if (!tab.view.webContents.isDestroyed()) {
          events?.onTabThemeChanged(tab.view.webContents, theme)
        }
      }
    })
  }
}

/** Records Sim's theme and applies it only while the browser is set to follow Sim. */
export function setBrowserAppTheme(theme: BrowserTheme): void {
  browserAppTheme = theme
  if (browserAppearanceTheme === 'app') setBrowserTheme(theme)
}

/** Resolves the persisted browser choice against the latest theme reported by Sim. */
export function setBrowserAppearanceTheme(theme: DesktopAppearanceTheme): void {
  browserAppearanceTheme = theme
  setBrowserTheme(theme === 'app' ? browserAppTheme : theme)
}

/** Converts the user-facing percentage into Chromium's panel-relative factor. */
export function getBrowserDefaultZoomFactor(): number {
  return BASE_ZOOM_FACTOR * (browserDefaultZoom / 100)
}

/** Applies and retains the default zoom for every current and future tab. */
export function setBrowserDefaultZoom(zoom: DesktopZoomPercent): void {
  browserDefaultZoom = zoom
  const factor = getBrowserDefaultZoomFactor()
  for (const scopeId of browserScopeStates.keys()) {
    withBrowserScope(scopeId, () => {
      for (const tab of tabs) {
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.setZoomFactor(factor)
      }
    })
  }
}

export function getBrowserTheme(): BrowserTheme {
  return browserTheme
}

nativeTheme.on('updated', () => {
  if (browserTheme === 'system') {
    for (const scopeId of browserScopeStates.keys()) {
      withBrowserScope(scopeId, updateTabBackgrounds)
    }
  }
})

/** The active tab, creating the first tab when none exist. */
export function ensureTab(): AgentTab {
  restoreBrowserSession()
  let active = activeTab()
  if (!active) {
    active = addTabInternal()
  }
  return active
}

/** The active tab without creating one. */
export function requireTab(): AgentTab {
  restoreBrowserSession()
  const active = activeTab()
  if (!active) {
    throw new SessionError('No page is open yet — call browser_navigate or browser_open_tab first.')
  }
  return active
}

interface AddTabOptions {
  pinned?: boolean
  activate?: boolean
  notify?: boolean
}

/** Pinned tabs join the stable group at the far left; regular tabs append. */
function insertPinnedAware(tab: AgentTab): void {
  if (tab.pinned) {
    const firstRegularTab = tabs.findIndex((entry) => !entry.pinned)
    tabs.splice(firstRegularTab < 0 ? tabs.length : firstRegularTab, 0, tab)
  } else {
    tabs.push(tab)
  }
}

function addTabInternal({
  pinned = false,
  activate = true,
  notify = true,
}: AddTabOptions = {}): AgentTab {
  assertTabCapacity()
  const previousActiveTab = activeTab()
  const transferBrowserFocus =
    activate &&
    (currentScope.focusedBrowserTabId !== null ||
      tabs.some((tab) => tab.view.webContents.isFocused()))
  const tab: AgentTab = {
    id: String(currentScope.nextTabId++),
    scopeId: getBrowserScopeId(),
    view: createTabView(),
    pinned,
  }
  insertPinnedAware(tab)
  if (currentScope.automationTabId === null) currentScope.automationTabId = tab.id
  if (activate || currentScope.activeTabId === null) {
    if (previousActiveTab && previousActiveTab.id !== tab.id) {
      revokeTabMediaPermissions(previousActiveTab, false)
    }
    currentScope.activeTabId = tab.id
    applyActiveTabThrottling()
    if (!currentScope.restoring) layout()
    if (transferBrowserFocus) currentScope.focusedBrowserTabId = tab.id
    if (notify && !currentScope.restoring) events?.onActiveTabChanged(tab.view.webContents)
  }
  if (notify && !currentScope.restoring) {
    persistBrowserSession()
    events?.onTabsChanged()
  }
  return tab
}

function closeTabAfterFailedRestore(tab: AgentTab): void {
  try {
    revokeTabMediaPermissions(tab, false)
  } catch (error) {
    logger.warn('Could not revoke media permissions after browser restore failed', {
      error: getErrorMessage(error),
    })
  }
  try {
    detachIfAttached(tab.view)
  } catch (error) {
    logger.warn('Could not detach browser tab after browser restore failed', {
      error: getErrorMessage(error),
    })
  }
  try {
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
  } catch (error) {
    logger.warn('Could not close browser tab after browser restore failed', {
      error: getErrorMessage(error),
    })
  }
}

function isPendingTabRestoreLive(pending: PendingTabRestore): boolean {
  if (pending.generation !== backgroundTabRestoreGeneration) return false
  const state = browserScopeStates.get(resolveBrowserScopeId(pending.tab.scopeId))
  return Boolean(
    state?.tabs.includes(pending.tab) &&
      !pending.tab.view.webContents.isDestroyed() &&
      pending.tab.pendingRestoreUrl === pending.url
  )
}

function loadPendingTabRestore(pending: PendingTabRestore, timeoutMs: number): Promise<boolean> {
  if (!isPendingTabRestoreLive(pending) || pending.url === 'about:blank') {
    return Promise.resolve(false)
  }
  const contents = pending.tab.view.webContents
  return new Promise((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()
    let hardDeadlineAt = startedAt + timeoutMs + SITE_PERMISSION_PROMPT_TIMEOUT_MS
    let deadlineAt = startedAt + timeoutMs
    let foregroundDeadlineGranted = pending.priority === 'foreground'
    let sitePermissionGraceGranted = false
    const finish = (loaded: boolean) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      pending.cancelLoad = undefined
      pending.grantSitePermissionGrace = undefined
      pending.promoteToForeground = undefined
      if (!loaded) settleSitePermission(pending.tab, false)
      if (
        loaded &&
        isPendingTabRestoreLive(pending) &&
        pending.tab.pendingRestoreUrl === pending.url
      ) {
        pending.tab.pendingRestoreUrl = undefined
      }
      resolve(loaded)
    }
    const stopLoad = (timedOut: boolean) => {
      try {
        if (!contents.isDestroyed()) contents.stop()
      } catch (error) {
        logger.warn('Could not stop a deferred browser tab restore', {
          error: getErrorMessage(error),
        })
      } finally {
        if (timedOut && isPendingTabRestoreLive(pending)) {
          withBrowserScope(pending.tab.scopeId, () => {
            recordPageLoadFailure(contents, {
              kind: 'load-error',
              code: -7,
              description: 'ERR_TIMED_OUT',
              url: pending.url,
            })
          })
        }
        finish(false)
      }
    }
    pending.cancelLoad = () => stopLoad(false)
    const scheduleDeadline = () => {
      if (settled) return
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => stopLoad(true), Math.max(0, deadlineAt - Date.now()))
    }
    pending.grantSitePermissionGrace = () => {
      if (settled || sitePermissionGraceGranted) return
      sitePermissionGraceGranted = true
      deadlineAt = Math.min(deadlineAt + SITE_PERMISSION_PROMPT_TIMEOUT_MS, hardDeadlineAt)
      scheduleDeadline()
    }
    pending.promoteToForeground = () => {
      if (settled || foregroundDeadlineGranted) return
      foregroundDeadlineGranted = true
      hardDeadlineAt =
        startedAt + FOREGROUND_TAB_RESTORE_TIMEOUT_MS + SITE_PERMISSION_PROMPT_TIMEOUT_MS
      deadlineAt = Math.min(
        Math.max(deadlineAt, Date.now() + FOREGROUND_TAB_RESTORE_TIMEOUT_MS),
        hardDeadlineAt
      )
      scheduleDeadline()
    }
    scheduleDeadline()
    try {
      void Promise.resolve(contents.loadURL(pending.url)).then(
        () => finish(true),
        () => finish(false)
      )
    } catch {
      finish(false)
    }
  })
}

function createPendingTabRestore(
  tab: AgentTab,
  url: string,
  priority: PendingTabRestore['priority']
): PendingTabRestore {
  let resolveReady = (_loaded: boolean) => {}
  const ready = new Promise<boolean>((resolve) => {
    resolveReady = resolve
  })
  const pending: PendingTabRestore = {
    generation: backgroundTabRestoreGeneration,
    tab,
    url,
    priority,
    ready,
    resolveReady,
    started: false,
    settled: false,
    requeueAfterPreemption: false,
  }
  tab.pendingRestore = pending
  return pending
}

function settlePendingTabRestore(pending: PendingTabRestore, loaded = false): void {
  if (pending.settled) return
  pending.settled = true
  if (pending.tab.pendingRestore === pending) pending.tab.pendingRestore = undefined
  pending.resolveReady(loaded)
}

function startCountedTabRestore(pending: PendingTabRestore): void {
  pending.started = true
  activeTabRestores.add(pending)
  if (pending.priority === 'background') activeBackgroundTabRestores.add(pending)
  const timeoutMs =
    pending.priority === 'foreground'
      ? FOREGROUND_TAB_RESTORE_TIMEOUT_MS
      : BACKGROUND_TAB_RESTORE_TIMEOUT_MS
  void loadPendingTabRestore(pending, timeoutMs)
    .then((loaded) => {
      if (pending.requeueAfterPreemption && !loaded && isPendingTabRestoreLive(pending)) {
        pending.requeueAfterPreemption = false
        pending.started = false
        const queue =
          pending.priority === 'foreground'
            ? pendingForegroundTabRestores
            : pendingBackgroundTabRestores
        queue.push(pending)
        return
      }
      settlePendingTabRestore(pending, loaded)
    })
    .finally(() => {
      if (pending.generation !== backgroundTabRestoreGeneration) return
      activeTabRestores.delete(pending)
      activeBackgroundTabRestores.delete(pending)
      drainTabRestores()
    })
}

/**
 * Globally bounds restore work. Foreground entries have priority while one
 * process-wide slot remains unavailable to background loads. The queues are
 * bounded by the 96-live-tab process invariant.
 */
function drainTabRestores(): void {
  while (activeTabRestores.size < MAX_TAB_RESTORE_CONCURRENCY) {
    const pending =
      pendingForegroundTabRestores.shift() ??
      (activeBackgroundTabRestores.size < MAX_BACKGROUND_TAB_RESTORE_CONCURRENCY
        ? pendingBackgroundTabRestores.shift()
        : undefined)
    if (!pending) break
    if (!isPendingTabRestoreLive(pending)) {
      settlePendingTabRestore(pending)
      continue
    }
    startCountedTabRestore(pending)
  }
  if (
    pendingForegroundTabRestores.length > 0 &&
    activeTabRestores.size >= MAX_TAB_RESTORE_CONCURRENCY
  ) {
    const preempted = activeBackgroundTabRestores.values().next().value
    if (preempted) {
      activeBackgroundTabRestores.delete(preempted)
      activeTabRestores.delete(preempted)
      preempted.requeueAfterPreemption = true
      preempted.cancelLoad?.()
      drainTabRestores()
    }
  }
}

function queueBackgroundTabRestore(tab: AgentTab, url: string): void {
  if (url === 'about:blank') return
  if (tab.pendingRestore) return
  pendingBackgroundTabRestores.push(createPendingTabRestore(tab, url, 'background'))
  drainTabRestores()
}

function promotePendingTabRestore(tab: AgentTab): PendingTabRestore | undefined {
  const url = tab.pendingRestoreUrl
  if (!url || url === 'about:blank') return undefined
  let pending = tab.pendingRestore
  if (pending && activeBackgroundTabRestores.has(pending)) {
    activeBackgroundTabRestores.delete(pending)
    pending.priority = 'foreground'
    pending.promoteToForeground?.()
    drainTabRestores()
    return pending
  }
  if (!pending) pending = createPendingTabRestore(tab, url, 'foreground')
  if (!pending.started) {
    const queueIndex = pendingBackgroundTabRestores.indexOf(pending)
    if (queueIndex >= 0) pendingBackgroundTabRestores.splice(queueIndex, 1)
    pending.priority = 'foreground'
    if (!pendingForegroundTabRestores.includes(pending)) pendingForegroundTabRestores.push(pending)
    drainTabRestores()
  }
  return pending
}

function discardPendingTabRestore(tab: AgentTab): void {
  for (let index = pendingForegroundTabRestores.length - 1; index >= 0; index -= 1) {
    if (pendingForegroundTabRestores[index]?.tab === tab) {
      pendingForegroundTabRestores.splice(index, 1)
    }
  }
  for (let index = pendingBackgroundTabRestores.length - 1; index >= 0; index -= 1) {
    if (pendingBackgroundTabRestores[index]?.tab === tab) {
      pendingBackgroundTabRestores.splice(index, 1)
    }
  }
  const pending = tab.pendingRestore
  if (!pending) return
  pending.cancelLoad?.()
  settlePendingTabRestore(pending)
}

export async function waitForPendingTabRestore(tab: AgentTab): Promise<boolean> {
  const pending = promotePendingTabRestore(tab)
  return pending ? await pending.ready : true
}

/** Prevents a delayed restore slot from overwriting a newer explicit navigation. */
export function prepareExplicitNavigation(contents: WebContents): void {
  const tab = tabForContents(contents)
  if (!tab) return
  settleSitePermission(tab, false)
  tab.pendingRestoreUrl = undefined
  discardPendingTabRestore(tab)
}

/** Marks the visible page as user-selected without blocking automation on it. */
export function claimActiveTabForUser(): AgentTab | null {
  const tab = activeTab()
  if (!tab) return null
  currentScope.visibleTabUserSelected = true
  return tab
}

/** Explicit hand-back after takeover lets automation resume in the same page. */
export function returnAutomationTabToAgent(): void {
  if (currentScope.activeTabId === currentScope.automationTabId) {
    currentScope.visibleTabUserSelected = false
  }
}

export function restoreBrowserSession(): void {
  if (isBrowserScopeSuspended(getBrowserScopeId())) {
    throw new SessionError('This task browser is suspended until the task is reopened.')
  }
  if (currentScope.restored) return
  currentScope.activationOnly = false

  const scopeId = getBrowserScopeId()
  let snapshot: BrowserSessionSnapshot | null = null
  if (browserSessionPersistence) {
    try {
      snapshot = browserSessionPersistence.load(scopeId)
    } catch (error) {
      logger.warn('Could not restore browser chat session', {
        error: getErrorMessage(error),
      })
    }
  }

  const selectedIndexes = new Set<number>()
  if (snapshot) {
    for (
      let index = 0;
      index < snapshot.tabs.length && selectedIndexes.size < MAX_LIVE_TABS_PER_SCOPE;
      index++
    ) {
      if (snapshot.tabs[index]?.pinned) selectedIndexes.add(index)
    }
    if (selectedIndexes.size < MAX_LIVE_TABS_PER_SCOPE && snapshot.tabs[snapshot.activeIndex]) {
      selectedIndexes.add(snapshot.activeIndex)
    }
    for (
      let index = 0;
      index < snapshot.tabs.length && selectedIndexes.size < MAX_LIVE_TABS_PER_SCOPE;
      index++
    ) {
      selectedIndexes.add(index)
    }
  }
  const selectedEntries = snapshot
    ? [...selectedIndexes]
        .sort((left, right) => left - right)
        .map((index) => ({ entry: snapshot.tabs[index], sourceIndex: index }))
    : []
  const availableSlots = Math.max(0, MAX_LIVE_TABS_GLOBAL - liveBrowserTabCount())
  if (selectedEntries.length > availableSlots) {
    throw new SessionError(
      `Sim can have at most ${MAX_LIVE_TABS_GLOBAL} live browser tabs. Close a tab in another task and try again.`
    )
  }

  const state = browserScopeState(scopeId)
  const previousState = {
    tabs: [...state.tabs],
    activeTabId: state.activeTabId,
    automationTabId: state.automationTabId,
    nextTabId: state.nextTabId,
    restored: state.restored,
    lastPersistedSnapshot: state.lastPersistedSnapshot,
    siteOriginGrants: new Map(state.siteOriginGrants),
  }
  const previousDownloads = browserDownloadsByScope.get(scopeId)
  const restoredTabs: AgentTab[] = []
  const restoredLoads: Array<{ tab: AgentTab; url: string }> = []
  state.restoring = true
  try {
    if (snapshot) {
      browserDownloadsByScope.set(
        scopeId,
        snapshot.downloads.map((download) => ({ ...download }))
      )
      for (const { entry } of selectedEntries) {
        const tab = addTabInternal({ pinned: entry.pinned, activate: false, notify: false })
        tab.pendingRestoreUrl = entry.url
        const restoredOrigin = mediaOrigin(entry.url)
        if (restoredOrigin) grantSiteOrigin(state, restoredOrigin)
        restoredTabs.push(tab)
        restoredLoads.push({ tab, url: entry.url })
      }
      const restoredActiveIndex = selectedEntries.findIndex(
        ({ sourceIndex }) => sourceIndex === snapshot.activeIndex
      )
      state.activeTabId = restoredTabs[restoredActiveIndex]?.id ?? restoredTabs[0]?.id ?? null
      state.automationTabId = state.activeTabId
      state.lastPersistedSnapshot = JSON.stringify(browserSessionSnapshot())
    }

    state.restored = true
  } catch (error) {
    for (const tab of restoredTabs) closeTabAfterFailedRestore(tab)
    state.tabs = previousState.tabs
    state.activeTabId = previousState.activeTabId
    state.automationTabId = previousState.automationTabId
    state.nextTabId = previousState.nextTabId
    state.restored = previousState.restored
    state.lastPersistedSnapshot = previousState.lastPersistedSnapshot
    state.siteOriginGrants = previousState.siteOriginGrants
    if (previousDownloads) browserDownloadsByScope.set(scopeId, previousDownloads)
    else browserDownloadsByScope.delete(scopeId)
    applyActiveTabThrottling()
    throw error
  } finally {
    state.restoring = false
  }

  applyActiveTabThrottling()
  const restoredActive = restoredLoads.find(({ tab }) => tab.id === state.activeTabId)
  if (restoredActive) {
    pendingForegroundTabRestores.push(
      createPendingTabRestore(restoredActive.tab, restoredActive.url, 'foreground')
    )
    drainTabRestores()
  }
  for (const restore of restoredLoads) {
    if (restore !== restoredActive) queueBackgroundTabRestore(restore.tab, restore.url)
  }
  if (snapshot) publishBrowserDownloads(scopeId)
  const active = activeTab()
  if (active) {
    layout()
    events?.onActiveTabChanged(active.view.webContents)
    events?.onTabsChanged()
  }
}

export function addTab(): AgentTab {
  restoreBrowserSession()
  currentScope.visibleTabUserSelected = true
  return addTabInternal()
}

/**
 * Opens a tab for agent work.
 *
 * `reveal` is for the agent deliberately opening a page to work in
 * (`browser_open_tab`): the panel follows it, so the user watches the work
 * instead of staring at a page where nothing is happening. It is NOT set when a
 * page spawns a tab on its own (popups, `target="_blank"`) — that is the site
 * grabbing the view, not the agent choosing a workspace.
 *
 * Even with `reveal`, a tab the user claimed themselves wins: pulling the view
 * off the page they are reading is the same interruption as a window stealing
 * focus mid-sentence. The work still starts, just in the background, and the
 * tab strip shows it arriving.
 */
export function addAutomationTab({ reveal = false }: { reveal?: boolean } = {}): AgentTab {
  restoreBrowserSession()
  const followTheWork = reveal && !currentScope.visibleTabUserSelected
  const tab = addTabInternal({ activate: followTheWork, notify: false })
  currentScope.automationTabId = tab.id
  applyActiveTabThrottling()
  persistBrowserSession()
  events?.onTabsChanged()
  return tab
}

/** Agent target, creating or adopting a page without changing visible selection. */
export function ensureAutomationTab(): AgentTab {
  restoreBrowserSession()
  let tab = automationTab()
  if (tab) return tab
  tab = activeTab()
  if (tab) {
    currentScope.automationTabId = tab.id
    applyActiveTabThrottling()
    events?.onTabsChanged()
    return tab
  }
  return addAutomationTab()
}

/** Current agent target without creating one. */
export function requireAutomationTab(): AgentTab {
  restoreBrowserSession()
  const tab = automationTab()
  if (!tab) {
    throw new SessionError('No page is open yet — call browser_navigate or browser_open_tab first.')
  }
  return tab
}

/** Restores the most recently closed regular tab for the current app session. */
export function reopenClosedTab(): AgentTab | null {
  restoreBrowserSession()
  const url = recentlyClosedTabUrls.shift()
  if (!url) return null

  currentScope.visibleTabUserSelected = true
  const tab = addTabInternal()
  if (url !== 'about:blank') {
    // No checkAgentUrl here, unlike the tool-driven navigations: the stored
    // URL was already sanitized to http(s) on close, and the partition's
    // onBeforeRequest still runs the full DNS-resolving SSRF check on the
    // document load. Pre-checking would only buy a nicer error, and there is
    // no model to report one to — this path is a user keystroke.
    grantSiteOriginForUserNavigation(tab.view.webContents, url)
    void tab.view.webContents.loadURL(url).catch(() => {})
  }
  return tab
}

/**
 * Opens a copy of a tab at the same URL. A duplicate is a fresh load rather
 * than a clone of the original's session history: the history belongs to the
 * WebContents, and there is no way to fork it.
 */
export function duplicateTab(tabId: string): AgentTab | null {
  restoreBrowserSession()
  const source = tabs.find((entry) => entry.id === tabId)
  if (!source) return null

  const url = sanitizeRestorableUrl(source.view.webContents.getURL())
  currentScope.visibleTabUserSelected = true
  const tab = addTabInternal()
  if (url && url !== 'about:blank') {
    // Sanitized to http(s) without embedded credentials above, and the
    // partition's onBeforeRequest still runs the full SSRF check on the load —
    // same reasoning as reopenClosedTab, and this is likewise a user action.
    grantSiteOriginForUserNavigation(tab.view.webContents, url)
    void tab.view.webContents.loadURL(url).catch(() => {})
  }
  return tab
}

export function switchTab(tabId: string): AgentTab {
  restoreBrowserSession()
  const tab = tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  // The find belongs to the page it was typed against, not to the browser.
  if (currentScope.findingTabId !== null && currentScope.findingTabId !== tab.id) {
    dismissFind(currentScope.findingTabId)
  }
  const transferBrowserFocus =
    currentScope.focusedBrowserTabId !== null ||
    tabs.some((entry) => entry.view.webContents.isFocused())
  const previousActiveTab = activeTab()
  if (previousActiveTab && previousActiveTab.id !== tab.id) {
    revokeTabMediaPermissions(previousActiveTab, false)
  }
  currentScope.activeTabId = tab.id
  currentScope.visibleTabUserSelected = true
  promotePendingTabRestore(tab)
  // Visible selection does not move the automation exemption; the user may
  // inspect another page while a tool continues in its background tab.
  applyActiveTabThrottling()
  layout()
  if (transferBrowserFocus) currentScope.focusedBrowserTabId = tab.id
  persistBrowserSession()
  events?.onActiveTabChanged(tab.view.webContents)
  events?.onTabsChanged()
  return tab
}

/** Moves the agent cursor without moving or focusing the user's visible tab. */
export function switchAutomationTab(tabId: string): AgentTab {
  restoreBrowserSession()
  const tab = tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  currentScope.automationTabId = tab.id
  applyActiveTabThrottling()
  events?.onTabsChanged()
  return tab
}

/**
 * Moves a tab to a final list index while preserving the pinned/regular
 * boundary. Dragging across that boundary moves to its nearest valid edge.
 */
export function reorderTab(tabId: string, targetIndex: number): AgentTab {
  restoreBrowserSession()
  if (!Number.isFinite(targetIndex)) {
    throw new SessionError('Browser tab target index must be a finite number.')
  }
  const currentIndex = tabs.findIndex((entry) => entry.id === tabId)
  if (currentIndex < 0) {
    throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  }
  const tab = tabs[currentIndex]
  const pinnedCount = tabs.filter((entry) => entry.pinned).length
  const minIndex = tab.pinned ? 0 : pinnedCount
  const maxIndex = tab.pinned ? pinnedCount - 1 : tabs.length - 1
  const nextIndex = Math.max(minIndex, Math.min(maxIndex, Math.trunc(targetIndex)))
  if (nextIndex === currentIndex) return tab

  tabs.splice(currentIndex, 1)
  tabs.splice(nextIndex, 0, tab)
  persistBrowserSession()
  events?.onTabsChanged()
  return tab
}

export function closeTab(tabId: string): void {
  restoreBrowserSession()
  const index = tabs.findIndex((entry) => entry.id === tabId)
  if (index < 0) throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  if (tabs[index].pinned) {
    throw new SessionError('Pinned tabs cannot be closed. Unpin the tab first.')
  }
  // Before the splice, while the tab is still resolvable, stop page-owned UI.
  dismissFind(tabId)
  clearAutomationIndicatorsForTab(tabId)
  const [tab] = tabs.splice(index, 1)
  discardPendingTabRestore(tab)
  settleSitePermission(tab, false)
  revokeTabMediaPermissions(tab, false)
  recentlyClosedTabUrls.unshift(sanitizeRestorableUrl(tabUrl(tab)) ?? 'about:blank')
  if (recentlyClosedTabUrls.length > MAX_RECENTLY_CLOSED_TABS) {
    recentlyClosedTabUrls.length = MAX_RECENTLY_CLOSED_TABS
  }
  const transferBrowserFocus =
    currentScope.focusedBrowserTabId === tab.id || tab.view.webContents.isFocused()
  clearFocusedBrowserTab(tab.id)
  detachIfAttached(tab.view)
  tab.view.webContents.close()
  if (currentScope.activeTabId === tab.id) {
    currentScope.activeTabId = (tabs[index] ?? tabs[index - 1])?.id ?? null
    layout()
    const active = activeTab()
    if (active) {
      events?.onActiveTabChanged(active.view.webContents)
    }
  }
  if (currentScope.automationTabId === tab.id) {
    currentScope.automationTabId = (tabs[index] ?? tabs[index - 1])?.id ?? null
    applyActiveTabThrottling()
  }
  // Closing the last tab must not leave a visible browser resource with an
  // empty strip. Replace it with a fresh New tab, matching normal browser UI.
  if (!hasSession() && getBrowserScopeId() === getActiveBrowserScopeId() && isPanelVisible()) {
    addTab()
    if (transferBrowserFocus) currentScope.focusedBrowserTabId = currentScope.activeTabId
    return
  }
  if (transferBrowserFocus) currentScope.focusedBrowserTabId = currentScope.activeTabId
  persistBrowserSession()
  events?.onTabsChanged()
  if (!hasSession()) {
    currentScope.siteOriginGrants.clear()
    events?.onSessionClosed()
  }
}

/** Closes agent-owned work while protecting a visible tab the user claimed. */
export function closeAutomationTab(tabId: string): void {
  if (tabId === currentScope.activeTabId && currentScope.visibleTabUserSelected) {
    throw new SessionError(
      'That tab is currently being used by the user. Switch to another agent tab instead of closing it.'
    )
  }
  closeTab(tabId)
}

/**
 * Pins or unpins a live tab. Pinned tabs form a stable group at the far left,
 * and their latest URLs are persisted locally for the next browser opening.
 */
export function setTabPinned(tabId: string, pinned: boolean): AgentTab {
  restoreBrowserSession()
  const index = tabs.findIndex((entry) => entry.id === tabId)
  if (index < 0) throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  const tab = tabs[index]
  if (tab.pinned === pinned) return tab

  tabs.splice(index, 1)
  tab.pinned = pinned
  insertPinnedAware(tab)
  persistBrowserSession()
  events?.onTabsChanged()
  return tab
}

/** Opens tab actions as a native menu so the embedded page never has to be hidden. */
export function showTabContextMenu(tabId: string): void {
  const scopeId = getBrowserScopeId()
  const tab = tabs.find((entry) => entry.id === tabId)
  if (!tab || tab.view.webContents.isDestroyed()) return

  const inOwningScope = (action: () => void) => () => withBrowserScope(scopeId, action)

  Menu.buildFromTemplate([
    {
      label: tab.pinned ? 'Unpin Tab' : 'Pin Tab',
      click: inOwningScope(() => setTabPinned(tabId, !tab.pinned)),
    },
    { label: 'Duplicate Tab', click: inOwningScope(() => duplicateTab(tabId)) },
    { type: 'separator' },
    {
      label: 'Close Tab',
      enabled: !tab.pinned,
      click: inOwningScope(() => closeTab(tabId)),
    },
  ]).popup()
}

/** The live page whose browser surface owns a menu accelerator. */
function focusedTabForShortcut(ownerWindow?: BrowserWindow | null): AgentTab | null {
  if (!isPanelVisible() || !panelUpdateAllowed(ownerWindow ?? undefined, getBrowserScopeId())) {
    return null
  }
  return (
    tabs.find(
      (tab) =>
        !tab.view.webContents.isDestroyed() &&
        (tab.id === currentScope.focusedBrowserTabId || tab.view.webContents.isFocused())
    ) ?? null
  )
}

/** The active tab while this window owns an on-screen browser panel. */
function visibleActiveTab(ownerWindow?: BrowserWindow | null): AgentTab | null {
  if (!isPanelVisible() || !panelUpdateAllowed(ownerWindow ?? undefined, getBrowserScopeId())) {
    return null
  }
  return activeTab()
}

/**
 * Claims a global resource shortcut only while this browser owns interaction.
 *
 * Returning true means the Browser claimed the keystroke, not necessarily
 * that state changed. In particular, an empty reopen history is still handled
 * here so Cmd-Shift-T cannot leak through to another resource.
 */
export function handleFocusedShortcut(
  shortcut: FocusedResourceShortcut,
  ownerWindow?: BrowserWindow | null
): boolean {
  // Tab-management accelerators belong to the visible Browser even after
  // focus moves into Sim chrome. Otherwise Cmd-T/L/Shift-T silently stop
  // behaving like browser shortcuts, and Cmd-W becomes especially unsafe.
  const visibleBrowserShortcut =
    shortcut === 'close-tab' ||
    shortcut === 'new-tab' ||
    shortcut === 'reopen-closed-tab' ||
    shortcut === 'focus-omnibox'
  const shortcutTab =
    focusedTabForShortcut(ownerWindow) ??
    (visibleBrowserShortcut ? visibleActiveTab(ownerWindow) : null)
  if (!shortcutTab) return false

  if (isResourceTabSelectionShortcut(shortcut)) {
    const targetIndex = resourceTabTargetIndex(
      shortcut,
      tabs.length,
      tabs.findIndex((tab) => tab.id === shortcutTab.id)
    )
    const target = targetIndex === null ? null : tabs[targetIndex]
    if (target) {
      switchTab(target.id)
      target.view.webContents.focus()
    }
    return true
  }

  switch (shortcut) {
    case 'new-tab':
      addTab()
      focusRendererOmnibox('clear')
      return true
    case 'reopen-closed-tab': {
      const reopened = reopenClosedTab()
      reopened?.view.webContents.focus()
      return true
    }
    case 'close-tab':
      closeTabFromUser(shortcutTab.id)
      return true
    case 'focus-omnibox':
      focusRendererOmnibox('select')
      return true
    case 'reload-or-clear':
      reloadPage(shortcutTab.view.webContents)
      return true
    case 'hard-reload':
      prepareExplicitNavigation(shortcutTab.view.webContents)
      shortcutTab.view.webContents.reloadIgnoringCache()
      return true
  }

  const zoomAction = zoomActionForShortcut(shortcut)
  const contents = shortcutTab.view.webContents
  const factor =
    zoomAction === 'reset'
      ? getBrowserDefaultZoomFactor()
      : steppedZoomFactor(contents.getZoomFactor(), zoomAction === 'in' ? 1 : -1)
  contents.setZoomFactor(factor)
  return true
}

/** Marks renderer-owned browser chrome as focused or releases browser focus. */
export function setPanelFocused(
  focused: boolean,
  ownerWindow?: BrowserWindow,
  scopeId = getBrowserScopeId()
): void {
  withBrowserScope(scopeId, () => {
    if (!panelUpdateAllowed(ownerWindow, getBrowserScopeId())) return
    if (!focused) {
      clearFocusedBrowserTab()
      return
    }
    if (currentScope.focusedBrowserClearTimer !== null) {
      clearTimeout(currentScope.focusedBrowserClearTimer)
      currentScope.focusedBrowserClearTimer = null
    }
    currentScope.focusedBrowserTabId = activeTab()?.id ?? null
    currentScope.visibleTabUserSelected = true
  })
}

function clearFocusedBrowserTab(tabId?: string): void {
  if (tabId && currentScope.focusedBrowserTabId !== tabId) return
  if (currentScope.focusedBrowserClearTimer !== null) {
    clearTimeout(currentScope.focusedBrowserClearTimer)
    currentScope.focusedBrowserClearTimer = null
  }
  currentScope.focusedBrowserTabId = null
}

function closeTabFromUser(tabId: string): void {
  if (tabs.find((tab) => tab.id === tabId)?.pinned) {
    shell.beep()
    return
  }
  const closingLastTab = listTabs().length === 1
  closeTab(tabId)
  const active = activeTab()
  if (closingLastTab || !active || !active.view.webContents.getURL()) {
    focusRendererOmnibox('clear')
    return
  }
  active.view.webContents.focus()
}

/** Destroys every live view and forgets which one was active. */
function closeLiveTabs(): void {
  dismissFind(currentScope.findingTabId)
  for (const tab of tabs.splice(0)) {
    discardPendingTabRestore(tab)
    settleSitePermission(tab, false, false)
    revokeTabMediaPermissions(tab, false)
    detachIfAttached(tab.view)
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close()
    }
  }
  recentlyClosedTabUrls.length = 0
  currentScope.activeTabId = null
  currentScope.automationTabId = null
  currentScope.automationActive = false
  currentScope.automationNeedsAttention = false
  currentScope.visibleTabUserSelected = false
  currentScope.siteOriginGrants.clear()
  clearFocusedBrowserTab()
}

/**
 * Persists and closes every live browser view without publishing an empty tab
 * strip or a session-closed event. This is the administrative shutdown path:
 * the renderer must keep its browser resource descriptor so it can remount and
 * lazily restore the saved strip after relaunch.
 */
export function quiesceBrowserSessions(): void {
  for (const scopeId of browserScopeStates.keys()) {
    withBrowserScope(scopeId, () => {
      /**
       * A lazy activation has no live state to publish; saving its empty
       * in-memory shell would overwrite the durable strip it has not restored.
       */
      if (hasSession()) persistBrowserSession()
      closeLiveTabs()
    })
  }
}

/**
 * Ends the live session without touching the profile or the pinned-tab list on
 * disk, so the strip comes back intact next time. Turning the agent browser
 * off in settings runs this; a sign-out wipe runs {@link clearProfileStorage}.
 */
export function closeSession(): void {
  for (const scopeId of browserScopeStates.keys()) {
    withBrowserScope(scopeId, () => {
      closeLiveTabs()
      currentScope.restored = false
      currentScope.restoring = false
      currentScope.lastPersistedSnapshot = null
      currentScope.nextTabId = 1
      events?.onTabsChanged()
      events?.onSessionClosed()
    })
  }
  layout()
}

/**
 * Wipes the embedded browser's profile: open tabs, the in-memory list behind
 * Reopen Closed Tab, the persisted pinned tabs, and all site data and cache in
 * the agent partition. Sim sign-out runs this so the next account signing in
 * on this machine cannot inherit the previous user's authenticated sessions,
 * pinned tabs, or browsing trail.
 */
export async function clearProfileStorage(): Promise<void> {
  // Cached DNS verdicts are part of the browsing trail: without this a wipe
  // leaves up to the TTL of resolved-host classifications behind.
  clearHostVerdictCache()
  for (const scopeId of browserScopeStates.keys()) {
    withBrowserScope(scopeId, () => {
      closeLiveTabs()
      browserDownloadsByScope.delete(scopeId)
      // Stays true so a later restore cannot re-read the list being erased here.
      currentScope.restored = true
      currentScope.restoring = false
      currentScope.lastPersistedSnapshot = JSON.stringify({
        v: 1,
        tabs: [],
        activeIndex: -1,
        downloads: [],
      } satisfies BrowserSessionSnapshot)
      browserSessionPersistence?.save(scopeId, { v: 1, tabs: [], activeIndex: -1, downloads: [] })
      events?.onTabsChanged()
    })
  }
  browserDownloadsByScope.clear()
  cancelActiveBrowserDownloads()
  layout()

  const ses = electronSession.fromPartition(AGENT_PARTITION)
  // No `storages` filter: a profile wipe should leave nothing behind, and an
  // allowlist would silently miss whatever Chromium adds next.
  await ses.clearStorageData()
  await ses.clearCache()
}

/**
 * Site storage other than cookies. Named explicitly rather than by omission so
 * a new Chromium storage type is not silently swept into "site data" — the
 * whole-profile wipe is the one that deliberately takes everything.
 */
const SITE_DATA_STORAGES = [
  'filesystem',
  'indexdb',
  'localstorage',
  'shadercache',
  'websql',
  'serviceworkers',
  'cachestorage',
] as const

/**
 * Erases selected kinds of browsing data without ending the session.
 *
 * Unlike {@link clearProfileStorage} this leaves tabs open and the pinned strip
 * intact: the user asked to clear data, not to close their browser. Saved
 * passwords live in a separate vault and are never touched here.
 */
export async function clearAgentData(kinds: readonly BrowserDataKind[]): Promise<void> {
  const ses = electronSession.fromPartition(AGENT_PARTITION)
  const storages: string[] = []
  if (kinds.includes('cookies')) storages.push('cookies')
  if (kinds.includes('site-data')) storages.push(...SITE_DATA_STORAGES)

  if (storages.length > 0) {
    await ses.clearStorageData({ storages } as Parameters<Session['clearStorageData']>[0])
  }
  if (kinds.includes('cache')) {
    await ses.clearCache()
    // Resolved-host verdicts are a cache too, and a user clearing the cache
    // means all of it.
    clearHostVerdictCache()
  }
}

export function listTabs(): BrowserTabState[] {
  return tabs
    .filter((tab) => !tab.view.webContents.isDestroyed())
    .map((tab) => {
      const issue = tab.pageIssue
      return {
        tabId: tab.id,
        title: issue?.kind === 'load-error' ? '' : tab.view.webContents.getTitle(),
        url: issue?.url || tab.pendingRestoreUrl || tab.view.webContents.getURL(),
        loading: issue ? false : tab.view.webContents.isLoadingMainFrame(),
        active: tab.id === currentScope.activeTabId,
        pinned: tab.pinned,
        ...(issue ? { issue } : {}),
      }
    })
}

export function getTabsState(): BrowserTabsState {
  return {
    scopeId: getBrowserScopeId(),
    tabs: listTabs(),
    activeTabId: activeTab()?.id ?? null,
    automationTabId: automationTab()?.id ?? null,
    automationActive: currentScope.automationActive,
    automationNeedsAttention: currentScope.automationNeedsAttention,
  }
}

/** Tool-facing tab list whose active marker follows the agent cursor. */
export function getAutomationTabsState(): BrowserTabsState {
  const automationTabId = automationTab()?.id ?? null
  return {
    scopeId: getBrowserScopeId(),
    tabs: listTabs().map((tab) => ({ ...tab, active: tab.tabId === automationTabId })),
    activeTabId: automationTabId,
    automationTabId,
    automationActive: currentScope.automationActive,
    automationNeedsAttention: currentScope.automationNeedsAttention,
  }
}

/** Explicit non-hydrating alias for IPC paths that only need cached live state. */
export function peekTabsState(): BrowserTabsState {
  return getTabsState()
}

export function activeTab(): AgentTab | null {
  const tab = tabs.find((entry) => entry.id === currentScope.activeTabId) ?? null
  if (!tab || tab.view.webContents.isDestroyed()) return null
  return tab
}

export function automationTab(): AgentTab | null {
  const tab = tabs.find((entry) => entry.id === currentScope.automationTabId) ?? null
  if (!tab || tab.view.webContents.isDestroyed()) return null
  return tab
}

/**
 * Whether the user has interacted with the visible tab while it is also the
 * agent's automation tab. Governs panel-level ownership only — popup
 * adoption and protection against the agent closing the tab out from under
 * the user. It must never gate agent input: the user clicking or typing in
 * the panel does not revoke the agent's ability to act there.
 */
export function automationTabClaimedByUser(): boolean {
  return (
    currentScope.visibleTabUserSelected &&
    currentScope.activeTabId !== null &&
    currentScope.activeTabId === currentScope.automationTabId
  )
}

/** Keeps page-created tabs with the input owner that opened them. */
function agentOwnsPopupFrom(contents: WebContents): boolean {
  if (isDispatchingAgentInput(contents)) return true
  if (automationTab()?.view.webContents !== contents) return false
  if (automationTabClaimedByUser()) return false
  return currentScope.automationActive
}
