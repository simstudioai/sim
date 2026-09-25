import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync } from 'node:fs'
import { rename, rm, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  BrowserDataKind,
  BrowserFindRequest,
  BrowserFindResult,
  BrowserMediaDevice,
  BrowserMediaPermissionRequest,
  BrowserOmniboxFocusMode,
  BrowserPageIssue,
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
import { generateId, generateShortId } from '@sim/utils/id'
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  CookiesSetDetails,
  DownloadItem,
  Input,
  MenuItemConstructorOptions,
  Session,
  WebContents,
  WebContentsViewConstructorOptions,
} from 'electron'
import {
  app,
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
import {
  agentAppOrigin,
  type BrowserPermissionHandlers,
  isAgentWebContents,
  registerAgentNavigation,
  registerAgentWebContents,
} from '@/main/browser-agent/registry'
import { handleBrowserRequest } from '@/main/browser-agent/request-policy'
import { clearHostVerdictCache } from '@/main/browser-agent/url-guard'
import type { BrowserSessionSnapshot } from '@/main/desktop-chat-session-store'
import { suggestedFilename, uniqueDownloadPath } from '@/main/downloads'
import { isAppOrigin } from '@/main/navigation'
import {
  type FocusedResourceShortcut,
  isResourceTabSelectionShortcut,
  resourceTabTargetIndex,
  zoomActionForShortcut,
} from '@/main/resource-shortcuts'

const logger = createLogger('BrowserAgentSession')

/** Dedicated cookie jar for the agent browser; `persist:` = survives restarts. */
const AGENT_PARTITION = 'persist:sim-browser-agent'

/** The existing app session is borrowed only by views confined to this origin. */
export interface BrowserAppSession {
  origin: string
  session: Session
}

let browserAppSession: BrowserAppSession | undefined
const configuredDownloadSessions = new WeakSet<Session>()
const routedNavigations = new WeakMap<WebContents, AgentTab>()

class SessionError extends Error {}

export interface AgentTab {
  id: string
  scopeId: string
  view: WebContentsView
  pendingRestoreUrl?: string
  pendingRestore?: PendingTabRestore
  pageIssue?: BrowserPageIssue
  syntheticForward?: { url: string; baseHistoryIndex: number }
  preserveSyntheticForwardOnNextNavigation?: boolean
  recoveringUnresponsive?: boolean
  pendingMediaPermission?: PendingMediaPermission
  mediaPermissionGrant?: MediaPermissionGrant
  lastRealUserGestureAt?: number
  /** The tab whose page opened this one; agent work returns there when this tab closes. */
  openerTabId?: string
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
  /** The native page moved or its visibility changed. */
  onPanelGeometryChanged?: () => void
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
  }
}

function liveBrowserTabCount(): number {
  let count = 0
  for (const state of browserScopeStates.values()) count += state.tabs.length
  return count
}

function hasTabCapacity(): boolean {
  return tabs.length < MAX_LIVE_TABS_PER_SCOPE && liveBrowserTabCount() < MAX_LIVE_TABS_GLOBAL
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
  /**
   * Electron's download delegate opens a native Save dialog unless a path is
   * set before `will-download` returns, so bytes land in this randomly named
   * dot-file (hidden on POSIX) and move to the asynchronously allocated
   * `savePath` on completion.
   */
  stagingPath: string
  /** The reserved final destination, once allocation has chosen one. */
  savePath?: string
  /** Settles with the final destination, or null when allocation failed. */
  destination: Promise<string | null>
  /** Set once Electron reports the item done, so a late disk check never resumes or cancels it. */
  finished: boolean
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
  if (active.terminal || active.finished || active.limitReason || active.diskCheckInFlight) return
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

function discardStagedBrowserDownload(active: ActiveBrowserDownload): void {
  void rm(active.stagingPath, { force: true }).catch((error) => {
    logger.warn('Could not remove a staged agent browser download', {
      error: getErrorMessage(error),
      filename: active.download.filename,
    })
  })
}

/** Moves a completed staging file to its final name; resolves to that name. */
async function moveStagedBrowserDownload(active: ActiveBrowserDownload): Promise<string> {
  const destination = await active.destination
  if (!destination || active.limitReason || active.terminal) {
    throw new Error(
      active.limitReason ?? 'Stopped: the download destination could not be prepared safely'
    )
  }
  try {
    await rename(active.stagingPath, destination)
  } catch (error) {
    logger.warn('Could not move a finished agent browser download to its destination', {
      error: getErrorMessage(error),
      filename: active.download.filename,
    })
    throw new Error('Stopped: the finished download could not be moved to its destination')
  }
  return destination
}

function finishBrowserDownload(active: ActiveBrowserDownload): void {
  const { download } = active
  const liveScopeId = resolveBrowserScopeId(active.scopeId)
  if (
    suspendedBrowserScopes.has(liveScopeId) ||
    !browserScopeStates.has(liveScopeId) ||
    !browserDownloadsByScope.get(liveScopeId)?.includes(download)
  ) {
    return
  }
  trimBrowserDownloads(liveScopeId)
  publishBrowserDownloads(liveScopeId)
  withBrowserScope(liveScopeId, persistBrowserSession)
  if (download.state === 'completed') {
    logger.info('Agent browser download completed', { filename: download.filename })
    if (process.platform === 'darwin' && download.savePath) {
      app.dock?.downloadFinished(download.savePath)
    }
  } else if (download.state === 'interrupted') {
    logger.warn('Agent browser download interrupted', {
      filename: download.filename,
      reason: download.interruptionReason,
    })
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

/** A finished download of this scope whose file is still on disk. */
export function completedBrowserDownload(
  scopeId: string,
  downloadId: string
): { filename: string; savePath: string } | null {
  const download = browserDownloadsByScope
    .get(resolveBrowserScopeId(scopeId))
    ?.find((candidate) => candidate.id === downloadId)
  if (
    !download ||
    download.state !== 'completed' ||
    typeof download.savePath !== 'string' ||
    !existsSync(download.savePath)
  ) {
    return null
  }
  return { filename: download.filename, savePath: download.savePath }
}

/** Reveals a completed download without launching the downloaded file. */
export function showBrowserDownloadInFolder(scopeId: string, downloadId: string): boolean {
  const download = completedBrowserDownload(scopeId, downloadId)
  if (!download) return false
  shell.showItemInFolder(download.savePath)
  return true
}

/**
 * Returns the module to the state it had before any session ran.
 *
 * {@link initSession} names itself as the session boundary but set three of
 * these fields and left the rest, so a second call would inherit the first
 * session's tab id counter, theme, restore latch and persisted-list
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
  downloadSettings?: BrowserDownloadSettings,
  appSession?: BrowserAppSession
): void {
  resetSessionState()
  browserAppSession = appSession
  events = handlers
  getMainWindow = mainWindowProvider
  browserSessionPersistence = persistence ?? null
  browserDownloadSettings = downloadSettings ?? null
  initPanel({
    onGeometryChanged: () => events?.onPanelGeometryChanged?.(),
    getMainWindow: () => getMainWindow(),
    activeTab: () => {
      const scopeId = getActiveBrowserScopeId()
      return scopeId ? withBrowserScope(scopeId, activeTab) : null
    },
    backgroundColor: browserBackgroundColor,
    restoreActiveScope: () => {
      const scopeId = getActiveBrowserScopeId()
      if (!scopeId) return
      withBrowserScope(scopeId, restoreBrowserSession)
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
    tabs: liveTabs.map((tab) => ({ url: tabUrl(tab) })),
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
  if (imported > 0) await jar.flushStore()
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

const browserPermissions: BrowserPermissionHandlers = {
  request: (contents, permission, callback, details) => {
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
  },
  check: (contents, permission, requestingOrigin, details) => {
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
  },
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
  ses.setPermissionRequestHandler(browserPermissions.request)
  ses.setPermissionCheckHandler(browserPermissions.check)
  ses.webRequest.onBeforeRequest((details, callback) => {
    handleBrowserRequest(details, callback)
  })
  configureBrowserDownloads(ses)
}

/** Borrowing app authentication must not replace its permission or request handlers. */
function configureBrowserDownloads(ses: Session): void {
  if (configuredDownloadSessions.has(ses)) return
  configuredDownloadSessions.add(ses)
  ses.on('will-download', (_event, item, contents) => {
    if (!isAgentWebContents(contents)) return
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
    const failDownloadSetup = (reason: string, message: string, error: unknown) => {
      download.interruptionReason = reason
      download.state = 'interrupted'
      try {
        item.cancel()
      } catch (cancelError) {
        logger.warn('Could not cancel an agent browser download after setup failed', {
          error: getErrorMessage(cancelError),
          filename,
        })
      }
      recordBrowserDownload(scopeId, download)
      withBrowserScope(scopeId, persistBrowserSession)
      logger.warn(message, { error: getErrorMessage(error), filename })
    }
    const stagingPath = join(directory, `.sim-download-${generateShortId()}`)
    try {
      item.setSavePath(stagingPath)
    } catch (error) {
      failDownloadSetup(
        'Stopped: the download destination could not be prepared safely',
        'Could not set the staging destination for an agent browser download',
        error
      )
      return
    }
    try {
      item.pause()
    } catch (error) {
      failDownloadSetup(
        'Stopped: the download could not be paused for a disk-space safety check',
        'Agent browser download could not be paused for admission',
        error
      )
      return
    }
    const active: ActiveBrowserDownload = {
      directory,
      download,
      item,
      diskCheckInFlight: false,
      lastDiskCheckAt: 0,
      stagingPath,
      /** Replaced below by the allocation, whose callbacks need this record to exist first. */
      destination: Promise.resolve(null),
      finished: false,
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
      active.finished = true
      updateDownloadProgress(download, item)
      if (state !== 'completed' || active.limitReason || active.terminal) {
        releaseActiveBrowserDownload(active)
        discardStagedBrowserDownload(active)
        download.savePath = active.savePath
        download.state = active.limitReason ? 'interrupted' : state
        finishBrowserDownload(active)
        return
      }
      void moveStagedBrowserDownload(active)
        .then(
          (savePath) => {
            download.savePath = savePath
            download.state = 'completed'
          },
          (error: unknown) => {
            discardStagedBrowserDownload(active)
            download.savePath = active.savePath
            download.interruptionReason = getErrorMessage(error)
            download.state = 'interrupted'
          }
        )
        .finally(() => {
          releaseActiveBrowserDownload(active)
          finishBrowserDownload(active)
        })
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
    active.destination = withBrowserDownloadTimeout(
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
          return null
        }
        if (!savePath) {
          cancelBrowserDownloadForLimit(
            active,
            'Stopped: a safe non-conflicting download filename could not be allocated'
          )
          publishActiveBrowserDownload(active)
          return null
        }
        checkBrowserDownloadDiskSpace(active, 'admission')
        return savePath
      })
      .catch((error) => {
        if (active.terminal || !activeBrowserDownloads.has(active)) return null
        logger.warn('Could not allocate an agent browser download destination', {
          error: getErrorMessage(error),
          filename,
        })
        cancelBrowserDownloadForLimit(
          active,
          'Stopped: the download destination could not be prepared safely'
        )
        publishActiveBrowserDownload(active)
        return null
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
  if ((issue.code === -2 || issue.code === -3) && routedNavigations.has(contents)) return
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
 * Whether a page's popup can become a tab that keeps its opener: http(s), within the tab
 * limits, and in the opener's own session (a session boundary needs a separate, opener-less tab).
 */
function canAdoptPopup(opener: WebContents, url: string): boolean {
  if (!/^https?:\/\//i.test(url) || !hasTabCapacity()) return false
  return (
    !browserAppSession ||
    isAppOrigin(url, browserAppSession.origin) === Boolean(agentAppOrigin(opener))
  )
}

/** Registers a page-opened window as a tab that remembers its opener. */
function adoptPopupTab(
  opener: WebContents,
  url: string,
  popup: PopupWindowOptions,
  agentOwned: boolean
): WebContents {
  const openerTabId = tabForContents(opener)?.id
  const tab = agentOwned ? addAutomationTab(url, popup) : addTab(url, popup)
  tab.openerTabId = openerTabId
  const contents = tab.view.webContents
  // A background-tab disposition defers creation, so Chromium supplies no contents to adopt.
  if (!popup.webContents) void contents.loadURL(url).catch(() => {})
  return contents
}

/**
 * Opens a link from a page in another tab of this browser. Shared by the
 * window.open interception and the page's right-click menu — both have to stay
 * inside the browser resource rather than spawn a native window, and both are
 * reached from an untrusted page, so the scheme is checked here once.
 */
function openTabWithUrl(url: string, { agentOwned }: { agentOwned: boolean }): void {
  if (!/^https?:\/\//i.test(url)) return
  try {
    const tab = agentOwned ? addAutomationTab(url) : addTab(url)
    void tab.view.webContents.loadURL(url).catch(() => {})
  } catch (error) {
    logger.warn('Could not open a link in a new browser tab', {
      error: getErrorMessage(error),
    })
  }
}

/**
 * The options Electron hands `createWindow`. Its typings omit the Chromium-created `webContents`
 * the documented adoption pattern forwards (absent only for a deferred background-tab popup).
 */
type PopupWindowOptions = BrowserWindowConstructorOptions & WebContentsViewConstructorOptions

/**
 * Creates a tab's view. `popup` adopts a page-opened window's WebContents, which Chromium created
 * with the opener's (identical) web preferences, so the opener relationship and its session stay
 * intact; callers only adopt popups whose URL belongs to the opener's session.
 */
function createTabView(url?: string, popup?: PopupWindowOptions): WebContentsView {
  const appSession =
    url && browserAppSession && isAppOrigin(url, browserAppSession.origin)
      ? browserAppSession
      : undefined
  const scopeId = getBrowserScopeId()
  const view = popup?.webContents ? new WebContentsView(popup) : createFreshTabView(appSession)
  try {
    /** Detached tabs must lay out before a foreground panel owns their native view. */
    const [width, height] = getMainWindow()?.getContentSize() ?? [1280, 720]
    view.setBounds({ x: 0, y: 0, width: Math.max(1, width), height: Math.max(1, height) })
    return initializeTabView(view, scopeId, appSession?.origin)
  } catch (error) {
    if (!view.webContents.isDestroyed()) view.webContents.close()
    throw error
  }
}

function createFreshTabView(appSession: BrowserAppSession | undefined): WebContentsView {
  return new WebContentsView({
    webPreferences: {
      ...(appSession ? { session: appSession.session } : { partition: AGENT_PARTITION }),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      // Electron's plugin switch only admits its internal plugins; the built-in
      // PDF viewer is one, and without it a PDF renders as an empty frame.
      plugins: true,
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
}

function initializeTabView(
  view: WebContentsView,
  scopeId: string,
  appOrigin?: string
): WebContentsView {
  view.setBackgroundColor(browserBackgroundColor())
  const contents = view.webContents
  registerAgentWebContents(contents, appOrigin, browserPermissions)
  if (appOrigin) configureBrowserDownloads(contents.session)
  else configureAgentPartition(contents.session)
  const routeNavigation = (url: string, method: string): boolean => {
    if (!/^https?:\/\//i.test(url) || !browserAppSession) return false
    const wantsAppSession = isAppOrigin(url, browserAppSession.origin)
    if (wantsAppSession === Boolean(appOrigin)) {
      routedNavigations.delete(contents)
      return false
    }
    /** Never turn a form POST or a method-preserving redirect into a GET in another session. */
    if (method !== 'GET') return true
    try {
      return withBrowserScope(scopeId, () => {
        const target = tabForNavigation(contents, url, { reuseBlank: false })
        if (target === contents) return false
        void target.loadURL(url).catch(() => {})
        return true
      })
    } catch (error) {
      logger.warn('Could not route browser navigation to its session', {
        error: getErrorMessage(error),
      })
      return true
    }
  }
  registerAgentNavigation(contents, routeNavigation)
  attachAgentContextMenu(contents, {
    addToChat: (text) => withBrowserScope(scopeId, () => addPageSelectionToChat(contents, text)),
    openTab: (url) => withBrowserScope(scopeId, () => openTabWithUrl(url, { agentOwned: false })),
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
  // A same-session popup adopts Chromium's own WebContents so window.opener
  // survives (sign-in and "connect" popups post their result back to it).
  contents.setWindowOpenHandler((details) =>
    withBrowserScope(scopeId, () => {
      const agentOwned = agentOwnsPopupFrom(contents)
      if (!canAdoptPopup(contents, details.url)) {
        openTabWithUrl(details.url, { agentOwned })
        return { action: 'deny' }
      }
      return {
        action: 'allow',
        outlivesOpener: true,
        createWindow: (options) =>
          withBrowserScope(scopeId, () =>
            adoptPopupTab(contents, details.url, options, agentOwned)
          ),
      }
    })
  )

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
  // A tab persists its latest top-level location, including user-driven
  // navigations that do not pass through the driver.
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
      // closeTab unlists a tab before closing it, so a listed tab here closed itself
      // (window.close() at the end of a sign-in popup). Electron has already dropped
      // the view's contents, so remove it without touching them.
      const tab = tabs.find((entry) => entry.view === view)
      if (tab) removeTab(tab, null)
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
  activate?: boolean
  notify?: boolean
  url?: string
  popup?: PopupWindowOptions
}

function addTabInternal({
  activate = true,
  notify = true,
  url,
  popup,
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
    view: createTabView(url, popup),
  }
  tabs.push(tab)
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
    let deadlineAt = Date.now() + timeoutMs
    let foregroundDeadlineGranted = pending.priority === 'foreground'
    const finish = (loaded: boolean) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      pending.cancelLoad = undefined
      pending.promoteToForeground = undefined
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
    pending.promoteToForeground = () => {
      if (settled || foregroundDeadlineGranted) return
      foregroundDeadlineGranted = true
      deadlineAt = Date.now() + FOREGROUND_TAB_RESTORE_TIMEOUT_MS
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

/**
 * A session boundary opens a separate tab, preserving the source's native history.
 * A blank tab can adopt the target session before its first navigation instead.
 */
export function tabForNavigation(
  contents: WebContents,
  url: string,
  options: { agentOwned?: boolean; reuseBlank?: boolean } = {}
): WebContents {
  const tab = tabForContents(contents)
  if (!tab || !browserAppSession) return contents
  const wantsAppSession = isAppOrigin(url, browserAppSession.origin)
  if (wantsAppSession === Boolean(agentAppOrigin(contents))) return contents
  if (options.reuseBlank !== false && (!contents.getURL() || contents.getURL() === 'about:blank')) {
    const view = createTabView(url)
    detachIfAttached(tab.view)
    tab.view = view
    contents.close()
    applyActiveTabThrottling()
    layout()
    events?.onActiveTabChanged(view.webContents)
    return view.webContents
  }
  const target =
    (options.agentOwned ?? agentOwnsPopupFrom(contents)) ? addAutomationTab(url) : addTab(url)
  routedNavigations.set(contents, target)
  return target.view.webContents
}

/** Follows an intercepted redirect without treating its cancelled source load as a failure. */
export function navigationTarget(contents: WebContents): WebContents {
  let current = contents
  for (let count = 0; count < 20; count++) {
    const target = routedNavigations.get(current)
    if (!target || target.view.webContents.isDestroyed()) return current
    current = target.view.webContents
  }
  throw new SessionError('Too many browser session redirects.')
}

/** Prevents a delayed restore slot from overwriting a newer explicit navigation. */
export function prepareExplicitNavigation(contents: WebContents): void {
  routedNavigations.delete(contents)
  const tab = tabForContents(contents)
  if (!tab) return
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
  // Every chat is hydrated as soon as it is opened so its pages can be listed
  // as tabs. Only a chat that actually had pages holds browser state of its
  // own; one without stays replaceable by a pending chat adopting its id.
  if (snapshot) currentScope.activationOnly = false

  const selectedIndexes = new Set<number>()
  if (snapshot) {
    if (snapshot.tabs[snapshot.activeIndex]) selectedIndexes.add(snapshot.activeIndex)
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
        const tab = addTabInternal({ activate: false, notify: false, url: entry.url })
        tab.pendingRestoreUrl = entry.url
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

export function addTab(url?: string, popup?: PopupWindowOptions): AgentTab {
  restoreBrowserSession()
  currentScope.visibleTabUserSelected = true
  return addTabInternal({ url, popup })
}

/**
 * Opens a tab for agent work in the background. Which page is visible is the
 * renderer's decision: every page is a resource tab there, and it shows the
 * agent's tab or badges it depending on what the user is doing.
 */
export function addAutomationTab(url?: string, popup?: PopupWindowOptions): AgentTab {
  restoreBrowserSession()
  const tab = addTabInternal({ activate: false, notify: false, url, popup })
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
  const tab = addTabInternal({ url })
  if (url !== 'about:blank') {
    // No checkAgentUrl here, unlike the tool-driven navigations: the stored
    // URL was already sanitized to http(s) on close, and the partition's
    // onBeforeRequest still runs the full DNS-resolving SSRF check on the
    // document load. Pre-checking would only buy a nicer error, and there is
    // no model to report one to — this path is a user keystroke.
    void tab.view.webContents.loadURL(url).catch(() => {})
  }
  return tab
}

/**
 * Shows a tab. `claim` records the visible page as the user's own; a switch
 * that only mirrors the renderer's strip selection passes false so the agent
 * can still close or adopt the page as its own.
 */
export function switchTab(tabId: string, { claim = true }: { claim?: boolean } = {}): AgentTab {
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
  if (claim) currentScope.visibleTabUserSelected = true
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
 * Moves a tab to a final list index. The renderer's resource strip owns tab
 * order; this keeps the native list — what restore and `browser_list_tabs`
 * report — in the same order.
 */
export function reorderTab(tabId: string, targetIndex: number): AgentTab {
  restoreBrowserSession()
  const currentIndex = tabs.findIndex((entry) => entry.id === tabId)
  if (currentIndex < 0) {
    throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  }
  const tab = tabs[currentIndex]
  const nextIndex = Math.max(0, Math.min(tabs.length - 1, Math.trunc(targetIndex)))
  if (nextIndex === currentIndex) return tab

  tabs.splice(currentIndex, 1)
  tabs.splice(nextIndex, 0, tab)
  persistBrowserSession()
  events?.onTabsChanged()
  return tab
}

/**
 * Closes a tab. When the agent closes its own working tab it moves on to the
 * neighbour so its next page tool has a target; a close the user made leaves
 * the agent cursor unset instead of announcing a page the agent never chose.
 */
export function closeTab(
  tabId: string,
  { adoptNeighborForAgent = false }: { adoptNeighborForAgent?: boolean } = {}
): void {
  restoreBrowserSession()
  const tab = tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  removeTab(tab, tab.view.webContents, adoptNeighborForAgent)
}

/**
 * Unlists a tab and moves selection off it. `contents` is null when the page already
 * closed itself; the tab then leaves no reopenable history entry.
 */
function removeTab(
  tab: AgentTab,
  contents: WebContents | null,
  adoptNeighborForAgent = false
): void {
  const index = tabs.indexOf(tab)
  // Before the splice, while the tab is still resolvable, stop page-owned UI.
  if (contents) dismissFind(tab.id)
  clearAutomationIndicatorsForTab(tab.id)
  tabs.splice(index, 1)
  if (!contents) dismissFind(tab.id)
  discardPendingTabRestore(tab)
  revokeTabMediaPermissions(tab, false)
  if (contents) {
    recentlyClosedTabUrls.unshift(sanitizeRestorableUrl(tabUrl(tab)) ?? 'about:blank')
    if (recentlyClosedTabUrls.length > MAX_RECENTLY_CLOSED_TABS) {
      recentlyClosedTabUrls.length = MAX_RECENTLY_CLOSED_TABS
    }
  }
  const transferBrowserFocus =
    currentScope.focusedBrowserTabId === tab.id || Boolean(contents?.isFocused())
  clearFocusedBrowserTab(tab.id)
  detachIfAttached(tab.view)
  if (contents && !contents.isDestroyed()) contents.close()
  if (currentScope.activeTabId === tab.id) {
    currentScope.activeTabId = (tabs[index] ?? tabs[index - 1])?.id ?? null
    layout()
    const active = activeTab()
    if (active) {
      events?.onActiveTabChanged(active.view.webContents)
    }
  }
  if (currentScope.automationTabId === tab.id) {
    const opener = tabs.find((entry) => entry.id === tab.openerTabId)
    currentScope.automationTabId =
      opener?.id ?? (adoptNeighborForAgent ? ((tabs[index] ?? tabs[index - 1])?.id ?? null) : null)
    applyActiveTabThrottling()
  }
  if (transferBrowserFocus) currentScope.focusedBrowserTabId = currentScope.activeTabId
  persistBrowserSession()
  events?.onTabsChanged()
  if (!hasSession()) {
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
  closeTab(tabId, { adoptNeighborForAgent: true })
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
 * Ends the live session without touching the profile or the saved tab list on
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
 * Reopen Closed Tab, the saved tab lists, and all site data and cache in
 * the agent partition. Sim sign-out runs this so the next account signing in
 * on this machine cannot inherit the previous user's authenticated sessions,
 * saved tabs, or browsing trail.
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
 * Unlike {@link clearProfileStorage} this leaves tabs open and the saved strip
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
