/**
 * Browser-agent driver: executes the copilot's `browser_*` tools against the
 * agent browser (session.ts) and keeps the renderer's panel header fed with
 * live page state.
 *
 * Perception drives through injected page functions (element registry with a
 * structural outline). Keyboard actuation (press_key, type) goes through
 * TRUSTED CDP input events — synthetic DOM KeyboardEvents never trigger
 * default editing actions (select-all, deletion, character insertion) and are
 * ignored by code editors, so they exist only as a fallback. Top-page clicks
 * use trusted CDP pointer input after page-side target/hit checks; focusable
 * cross-origin controls use trusted keyboard activation where possible. The user needs
 * no input translation at all — the real page is embedded in the Sim window,
 * so their clicks and typing are native. Tool calls serialize through a
 * queue — one real browser can only do one thing at a time — and every call
 * is bounded by a watchdog so the Sim side always gets a response instead of
 * waiting out its own timeout against silence.
 */
import {
  BROWSER_DATA_KINDS,
  type BrowserDataKind,
  type BrowserKnownSessionsState,
  type BrowserPageState,
  type BrowserPanelAction,
  type BrowserTabsState,
  type BrowserToolName,
} from '@sim/browser-protocol'
import type { BrowserDownloadsState, BrowserToolbarCommand } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { isRecordLike, omit, toRecord } from '@sim/utils/object'
import type { BrowserWindow, MenuItemConstructorOptions, WebContents, WebFrameMain } from 'electron'
import { Menu } from 'electron'
import * as cdp from '@/main/browser-agent/cdp'
import { steppedZoomFactor, zoomPercentOf } from '@/main/browser-agent/context-menu'
import { ToolError } from '@/main/browser-agent/errors'
import {
  comboTouchesClipboard,
  dispatchKeyCombo,
  KeyDispatchError,
  parseKeyCombo,
} from '@/main/browser-agent/keyboard'
import { BrowserKnownSessionRegistry } from '@/main/browser-agent/known-sessions'
import {
  activeElementSecrecy,
  clickElement,
  collectSnapshot,
  describeFocusedEditable,
  describePointTarget,
  focusElementForTyping,
  getViewportInfo,
  hoverElement,
  pageContainsText,
  pressKeyOnPage,
  readActiveElementState,
  readChildFrameElementState,
  readPageActionState,
  readPageText,
  readSelectElementState,
  scrollPage,
  selectOptionInElement,
  typeIntoElement,
} from '@/main/browser-agent/page-functions'
import * as session from '@/main/browser-agent/session'
import { checkAgentUrl } from '@/main/browser-agent/url-guard'
import { clearCredentials, fillCoordinator, initFillCoordinator } from '@/main/browser-credentials'
import type { ConfigStore } from '@/main/config'

const logger = createLogger('BrowserAgentDriver')

const NAVIGATION_TIMEOUT_MS = 25_000
const NAVIGATION_SETTLE_MS = 400
const DEFAULT_WAIT_FOR_TIMEOUT_MS = 10_000
const MAX_WAIT_FOR_TIMEOUT_MS = 120_000
const TAKEOVER_POLL_MS = 1_500
/**
 * Hard ceiling on any single tool execution (takeover excepted): whatever
 * goes wrong, the Sim side always gets a response. Sits above the longest
 * legitimate tool (browser_wait_for caps at 120s).
 */
const DEFAULT_TOOL_WATCHDOG_MS = 20_000
const NAVIGATION_TOOL_WATCHDOG_MS = 30_000
const WAIT_FOR_TOOL_WATCHDOG_GRACE_MS = 5_000
const MAX_CROSS_ORIGIN_SNAPSHOT_FRAMES = 8
const MAX_CROSS_ORIGIN_SCAN_FRAMES = 32
const COMBINED_SNAPSHOT_LINE_CAP = 900
const BROWSER_AGENT_ISOLATED_WORLD_ID = 1001

type PageExecutionTarget = WebContents | WebFrameMain

export type BrowserSessionPersistence = session.BrowserSessionPersistence

export interface DriverCallbacks {
  onPageState: (state: BrowserPageState) => void
  onTabsState: (state: BrowserTabsState) => void
  onSessionStatus: (alive: boolean, scopeId: string) => void
  /** Whether the active tab shows a login form Sim holds a credential for. */
  onFillAvailability: (available: boolean, scopeId: string) => void
  /** Live native download state for one isolated browser scope. */
  onDownloadsChanged?: (state: BrowserDownloadsState) => void
}

let driverCallbacks: DriverCallbacks | null = null
let knownSessions: BrowserKnownSessionRegistry | null = null
/** Kept so teardown can force its erasures past the settings write debounce. */
let configStore: ConfigStore | null = null

/**
 * Page states auto-handled since the last tool result (currently dismissed
 * dialogs). Attached to the next tool result so the model reacts to what
 * actually happened on the page.
 */
interface DriverScopeState {
  pendingNotices: string[]
  takeoverActive: boolean
  takeoverDone: boolean
  takeoverResponse: string | null
  /** Invocation that currently owns the shared takeover response state. */
  takeoverInvocationEpoch: number | null
  /** Monotonic browser-tool invocation id used to supersede an abandoned takeover. */
  toolInvocationEpoch: number
  /** Exact client tool currently at the head of this scope's serialized queue. */
  activeToolCallId: string | null
  /** Rejects the active queue entry while its underlying Chromium work winds down. */
  activeToolCancel: (() => void) | null
  /** Invalidates every invocation already queued when a scope-level cancel establishes a boundary. */
  toolQueueCancellationEpoch: number
  lastTabsStateFingerprint: string | null
  toolQueue: Promise<unknown>
  /** True while activation is the only operation that has touched this scope. */
  activationOnly: boolean
  /** Tab whose latest monotonic element refs are valid for element actions. */
  snapshotTabId: string | null
  /** Routes each snapshot ref to the frame whose page-world registry owns it. */
  snapshotTargets: Map<number, PageExecutionTarget>
  /** Monotonic ref floor shared by every frame in this browser scope. */
  nextElementRefId: number
  /** Invalidates captures that finish after a tab/navigation/timeout race. */
  snapshotCaptureEpoch: number
  /** Cancels a timed-out multi-step action before any later native dispatch. */
  toolExecutionEpoch: number
}

/** Captures the native queue boundary before an async authorization round trip. */
export interface BrowserToolQueueBoundary {
  scopeId: string
  cancellationEpoch: number
}

function createDriverScopeState(): DriverScopeState {
  return {
    pendingNotices: [],
    takeoverActive: false,
    takeoverDone: false,
    takeoverResponse: null,
    takeoverInvocationEpoch: null,
    toolInvocationEpoch: 0,
    activeToolCallId: null,
    activeToolCancel: null,
    toolQueueCancellationEpoch: 0,
    lastTabsStateFingerprint: null,
    toolQueue: Promise.resolve(),
    activationOnly: true,
    snapshotTabId: null,
    snapshotTargets: new Map(),
    nextElementRefId: 0,
    snapshotCaptureEpoch: 0,
    toolExecutionEpoch: 0,
  }
}

function invalidateSnapshot(state = driverScopeState()): void {
  state.snapshotTabId = null
  state.snapshotTargets.clear()
  state.snapshotCaptureEpoch++
}

/**
 * Cross-document navigation counters, bumped by tab instrumentation. A live
 * SPA rewrites its URL with pushState/replaceState between a snapshot and the
 * input dispatched from it, so URL equality cannot distinguish "the document
 * the model saw is gone" from routine same-document churn — only a real
 * document swap increments these.
 */
const crossDocumentNavigations = new WeakMap<WebContents, number>()
const crossDocumentFrameNavigations = new WeakMap<WebContents, Map<string, number>>()

function navigationEpoch(contents: WebContents): number {
  return crossDocumentNavigations.get(contents) ?? 0
}

function frameEpochKey(processId: number, routingId: number): string {
  return `${processId}:${routingId}`
}

function frameNavigationEpoch(contents: WebContents, frame: WebFrameMain): number {
  const key = frameEpochKey(frame.processId, frame.routingId)
  return crossDocumentFrameNavigations.get(contents)?.get(key) ?? 0
}

const driverScopeStates = new Map<string, DriverScopeState>()
const driverScopeAliases = new Map<string, string>()
const CANCELLED_TOOL_TTL_MS = 5 * 60_000
const MAX_CANCELLED_TOOL_TOMBSTONES = 256
const cancelledToolCallIds = new Map<string, number>()

function pruneCancelledToolCallIds(now = Date.now()): void {
  for (const [toolCallId, expiresAt] of cancelledToolCallIds) {
    if (expiresAt > now && cancelledToolCallIds.size <= MAX_CANCELLED_TOOL_TOMBSTONES) break
    cancelledToolCallIds.delete(toolCallId)
  }
}

function isToolCallCancelled(toolCallId: string | undefined): boolean {
  if (!toolCallId) return false
  pruneCancelledToolCallIds()
  return cancelledToolCallIds.has(toolCallId)
}

function resolveDriverScopeId(scopeId: string): string {
  let resolved = scopeId
  const visited = new Set<string>()
  while (driverScopeAliases.has(resolved) && !visited.has(resolved)) {
    visited.add(resolved)
    resolved = driverScopeAliases.get(resolved) as string
  }
  return session.resolveBrowserScopeId(resolved)
}

function driverScopeState(scopeId = session.getBrowserScopeId()): DriverScopeState {
  const resolved = resolveDriverScopeId(scopeId)
  let state = driverScopeStates.get(resolved)
  if (!state) {
    state = createDriverScopeState()
    driverScopeStates.set(resolved, state)
  }
  return state
}

export function captureBrowserToolQueueBoundary(scopeId: string): BrowserToolQueueBoundary {
  const resolvedScopeId = resolveDriverScopeId(scopeId)
  return {
    scopeId: resolvedScopeId,
    cancellationEpoch: driverScopeState(resolvedScopeId).toolQueueCancellationEpoch,
  }
}

function isBrowserToolQueueBoundaryCurrent(boundary: BrowserToolQueueBoundary): boolean {
  const state = driverScopeStates.get(resolveDriverScopeId(boundary.scopeId))
  return state?.toolQueueCancellationEpoch === boundary.cancellationEpoch
}

function recordNotice(notice: string): void {
  const state = driverScopeState()
  state.activationOnly = false
  if (state.pendingNotices.length < 10) state.pendingNotices.push(notice)
}

/**
 * True while browser_request_takeover waits on the user. The question card on
 * the chat's takeover tool row completes it via the `takeover-done` panel action;
 * the state lives here (session-level, not in the page) so it survives
 * navigations and tab switches.
 */
function pageStateFor(contents: WebContents, tabId: string): BrowserPageState {
  const issue = session.pageIssueForContents(contents)
  return {
    scopeId: session.getBrowserScopeId(),
    tabId,
    url: issue?.url ?? contents.getURL(),
    title: issue?.kind === 'load-error' ? '' : contents.getTitle(),
    loading: issue ? false : contents.isLoadingMainFrame(),
    canGoBack: session.canGoBack(contents),
    canGoForward: session.canGoForward(contents),
    ...(issue ? { issue } : {}),
  }
}

function pushPageState(contents: WebContents): void {
  if (contents.isDestroyed()) return
  const active = session.activeTab()
  if (active?.view.webContents !== contents) return
  driverCallbacks?.onPageState(pageStateFor(contents, active.id))
}

/**
 * Pushes the tab list to the renderer, skipping a push identical to the last.
 *
 * Every tab's load and title events call this, background tabs included, and a
 * site that rewrites its title on a timer fires them continuously — each an
 * unconditional broadcast that rebuilt the whole strip. The fingerprint drops
 * the repeats, matching what the terminal side already does with emitTabs.
 */
function pushTabsState(): void {
  const state = session.getTabsState()
  const fingerprint = JSON.stringify(state)
  const driverState = driverScopeState()
  if (fingerprint === driverState.lastTabsStateFingerprint) return
  driverState.lastTabsStateFingerprint = fingerprint
  driverCallbacks?.onTabsState(state)
}

/** Instruments a fresh tab: CDP dialog handling + page-state pushes. */
function instrumentTab(contents: WebContents): void {
  const scopeId = session.browserScopeIdForContents(contents) ?? session.getBrowserScopeId()
  const inScope =
    <Args extends unknown[]>(fn: (...args: Args) => void) =>
    (...args: Args) =>
      session.withBrowserScope(scopeId, () => fn(...args))

  const callbacks = {
    onDialog: inScope((dialog: cdp.PageDialog) => {
      recordNotice(
        dialog.handled
          ? `The page showed a ${dialog.type} dialog ("${dialog.message}") which was auto-dismissed.`
          : `The page showed a ${dialog.type} dialog ("${dialog.message}") which could not be dismissed and may still be blocking the page.`
      )
    }),
  }
  void (async () => {
    let lastError: unknown
    for (let attempt = 0; attempt < 3 && !contents.isDestroyed(); attempt++) {
      try {
        await cdp.ensureInstrumented(contents, callbacks)
        await session.withBrowserScope(scopeId, () =>
          cdp.setColorScheme(contents, session.getBrowserTheme())
        )
        return
      } catch (error) {
        lastError = error
        if (attempt < 2) await sleep(250 * 2 ** attempt)
      }
    }
    logger.warn('CDP instrumentation failed after retries', {
      error: getErrorMessage(lastError),
    })
  })()
  contents.on(
    'did-navigate',
    inScope(() => {
      crossDocumentNavigations.set(contents, navigationEpoch(contents) + 1)
      if (session.automationTab()?.view.webContents === contents) {
        invalidateSnapshot()
      }
      knownSessions?.noteTopLevelNavigation(contents.getURL())
      pushPageState(contents)
      pushTabsState()
    })
  )
  contents.on(
    'did-fail-load',
    inScope((_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === 0 || errorCode === -3) return
      session.recordPageLoadFailure(contents, {
        kind: 'load-error',
        code: errorCode,
        description: errorDescription,
        url: validatedURL || contents.getURL(),
      })
    })
  )
  contents.on(
    'did-frame-navigate',
    inScope(
      (_event, _url, _httpResponseCode, _httpStatusText, _isMainFrame, processId, routingId) => {
        const frames = crossDocumentFrameNavigations.get(contents) ?? new Map<string, number>()
        const key = frameEpochKey(processId, routingId)
        frames.set(key, (frames.get(key) ?? 0) + 1)
        crossDocumentFrameNavigations.set(contents, frames)
      }
    )
  )
  // Same-document navigation deliberately does NOT invalidate the snapshot: a
  // live SPA (Slack) pushStates continuously, and invalidating here made every
  // ref die between snapshot and act. Element-level identity checks and the
  // in-page ref resolver keep individual actions honest instead.
  for (const event of [
    'did-navigate-in-page',
    'page-title-updated',
    'did-finish-load',
    'did-stop-loading',
  ] as const) {
    contents.on(
      event as 'did-navigate',
      inScope(() => {
        pushPageState(contents)
        pushTabsState()
      })
    )
  }
  contents.on(
    'did-start-loading',
    inScope(() => {
      session.notePageLoadStarted(contents)
      pushPageState(contents)
      pushTabsState()
    })
  )
  driverCallbacks?.onSessionStatus(true, scopeId)
}

export function initDriver(
  callbacks: DriverCallbacks,
  getMainWindow: () => BrowserWindow | null,
  config?: ConfigStore,
  persistence?: BrowserSessionPersistence,
  downloadSettings?: session.BrowserDownloadSettings
): void {
  driverCallbacks = callbacks
  knownSessions = config ? new BrowserKnownSessionRegistry(config) : null
  configStore = config ?? null
  // The rest of this module's state is per-session too. Left behind, a new
  // session inherits the previous one's pending notices, a takeover still
  // waiting on a user who is gone, and a fingerprint that suppresses its very
  // first tab push as a duplicate.
  driverScopeStates.clear()
  driverScopeAliases.clear()
  cancelledToolCallIds.clear()
  // The serialization chain, too. A takeover from the previous session can sit
  // unresolved indefinitely, and its `takeoverDone` flag is reset above — so
  // leaving the old chain head in place would queue the new session's first
  // tool call behind a promise nothing can ever settle.
  initFillCoordinator({
    getActiveContents: (scopeId) => {
      const activeScopeId = session.getActiveBrowserScopeId()
      if (!activeScopeId) return null
      const requestedScopeId = session.resolveBrowserScopeId(scopeId ?? activeScopeId)
      if (requestedScopeId !== activeScopeId) return null
      return session.withBrowserScope(
        requestedScopeId,
        () => session.activeTab()?.view.webContents ?? null
      )
    },
    scopeOwnsContents: (scopeId, contents) =>
      session.resolveBrowserScopeId(scopeId) === session.browserScopeIdForContents(contents),
    onAvailabilityChanged: (available, contents) => {
      const scopeId = contents
        ? session.browserScopeIdForContents(contents)
        : session.getActiveBrowserScopeId()
      if (scopeId) callbacks.onFillAvailability(available, scopeId)
    },
  })
  session.initSession(
    {
      onSessionClosed: () => {
        driverCallbacks?.onSessionStatus(false, session.getBrowserScopeId())
      },
      onTabCreated: instrumentTab,
      onTabNavigated: (contents, sameDocument) =>
        fillCoordinator()?.noteNavigation(contents, sameDocument),
      onTabClosed: (contents) => fillCoordinator()?.forget(contents),
      onActiveTabChanged: (contents) => {
        invalidateSnapshot()
        pushPageState(contents)
        // The fill affordance belongs to whichever page is in front.
        void fillCoordinator()?.refreshAvailability(true)
      },
      onPageStateChanged: pushPageState,
      onTabsChanged: pushTabsState,
      onTabThemeChanged: (contents, theme) => {
        void cdp.setColorScheme(contents, theme).catch((error) => {
          logger.warn('Could not update browser tab theme', {
            error: getErrorMessage(error),
          })
        })
      },
      onDownloadsChanged: (state) => callbacks.onDownloadsChanged?.(state),
    },
    getMainWindow,
    persistence,
    downloadSettings
  )
}

/** Safe recent download metadata for one chat; host paths never cross the bridge. */
export function getDownloadsState(scopeId: string): BrowserDownloadsState {
  return session.getBrowserDownloadsState(scopeId)
}

/** Opens one chat's recent downloads as a native menu above the browser page. */
export function showDownloadsMenu(
  scopeId: string,
  ownerWindow: BrowserWindow,
  anchor: { x: number; y: number }
): boolean {
  return session.showBrowserDownloadsMenu(scopeId, ownerWindow, anchor)
}

/** Opens the browser's native overflow menu above the embedded page. */
export function showToolbarMenu(
  scopeId: string,
  ownerWindow: BrowserWindow,
  anchor: { x: number; y: number }
): boolean {
  if (ownerWindow.isDestroyed()) return false
  const resolved = session.resolveBrowserScopeId(scopeId)
  const contents = session.withBrowserScope(resolved, () => session.activeTab()?.view.webContents)
  const pageAvailable = Boolean(contents && !contents.isDestroyed())
  const defaultZoomFactor = session.getBrowserDefaultZoomFactor()
  const zoomFactor = pageAvailable
    ? (contents?.getZoomFactor() ?? defaultZoomFactor)
    : defaultZoomFactor
  const zoomIn = steppedZoomFactor(zoomFactor, 1)
  const zoomOut = steppedZoomFactor(zoomFactor, -1)
  const sendCommand = (command: BrowserToolbarCommand) => {
    if (ownerWindow.isDestroyed()) return
    ownerWindow.webContents.send('browser-agent:toolbar-command', command, resolved)
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Find in Page',
      accelerator: 'CommandOrControl+F',
      enabled: pageAvailable,
      click: () => {
        if (!ownerWindow.isDestroyed()) {
          ownerWindow.webContents.send('browser-agent:open-find', resolved)
        }
      },
    },
    { type: 'separator' },
    {
      label: `Zoom (${zoomPercentOf(zoomFactor)}%)`,
      enabled: pageAvailable,
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CommandOrControl+Plus',
          enabled: zoomIn !== zoomFactor,
          click: () => contents?.setZoomFactor(zoomIn),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CommandOrControl+-',
          enabled: zoomOut !== zoomFactor,
          click: () => contents?.setZoomFactor(zoomOut),
        },
        {
          label: 'Actual Size',
          accelerator: 'CommandOrControl+0',
          enabled: zoomFactor !== defaultZoomFactor,
          click: () => contents?.setZoomFactor(defaultZoomFactor),
        },
      ],
    },
    { type: 'separator' },
    { label: 'Import Passwords', click: () => sendCommand('import') },
    { type: 'separator' },
    { label: 'Browser Settings', click: () => sendCommand('browser-settings') },
  ]
  Menu.buildFromTemplate(template).popup({
    window: ownerWindow,
    x: Math.round(anchor.x),
    y: Math.round(anchor.y),
  })
  return true
}

/** Reveals a completed browser download without opening the downloaded file. */
export function showDownloadInFolder(scopeId: string, downloadId: string): boolean {
  return session.showBrowserDownloadInFolder(scopeId, downloadId)
}

/** Activates a chat's isolated browser state and publishes its current header. */
export function activateBrowserScope(scopeId: string): string {
  const resolved = session.activateBrowserScope(scopeId)
  driverScopeState(resolved)
  session.withBrowserScope(resolved, () => {
    pushTabsState()
    const active = session.activeTab()
    if (active) pushPageState(active.view.webContents)
    driverCallbacks?.onSessionStatus(session.hasSession(), resolved)
  })
  // Availability is scoped UI state. Replay it on every chat activation even
  // when its boolean matches the chat that previously owned the compositor.
  void fillCoordinator()?.refreshAvailability(true)
  return resolved
}

/**
 * Materializes a lazily activated chat without changing which chat owns the
 * singleton compositor. Used before page-dependent tools so persisted tabs can
 * wake even while their resource panel is hidden.
 */
export function restoreBrowserScope(scopeId: string): BrowserTabsState {
  const resolved = resolveDriverScopeId(scopeId)
  if (session.isBrowserScopeSuspended(resolved)) {
    return session.withBrowserScope(resolved, () => session.peekTabsState())
  }
  const state = driverScopeState(resolved)
  state.activationOnly = false
  return session.withBrowserScope(resolved, () => {
    session.restoreBrowserSession()
    return session.peekTabsState()
  })
}

/** Moves pending-new-chat driver and tab state to the server-issued chat id. */
export function migrateBrowserScope(fromScopeId: string, toScopeId: string): boolean {
  const from = resolveDriverScopeId(fromScopeId)
  const to = resolveDriverScopeId(toScopeId)
  if (from === to) return true
  const state = driverScopeStates.get(from)
  const destinationState = driverScopeStates.get(to)
  if (destinationState && !destinationState.activationOnly) return false
  if (!session.migrateBrowserScope(from, to)) return false
  if (destinationState) driverScopeStates.delete(to)
  if (state) {
    driverScopeStates.delete(from)
    driverScopeStates.set(to, state)
  }
  driverScopeAliases.set(from, to)
  return true
}

export function disposeBrowserScope(scopeId: string): void {
  const wasAlias = session.resolveBrowserScopeId(scopeId) !== scopeId
  const resolved = resolveDriverScopeId(scopeId)
  session.disposeBrowserScope(scopeId)
  if (wasAlias) {
    driverScopeAliases.delete(scopeId)
    return
  }

  driverScopeStates.delete(resolved)
  for (const [alias, target] of driverScopeAliases) {
    if (alias === resolved || resolveDriverScopeId(target) === resolved) {
      driverScopeAliases.delete(alias)
    }
  }
}

/**
 * Stops one soft-deleted chat's live browser while retaining its persisted
 * strip. Driver-only notices and takeover state are intentionally ephemeral;
 * a restored chat receives fresh WebContents and a fresh automation queue.
 */
export function suspendBrowserScope(scopeId: string): boolean {
  const resolved = resolveDriverScopeId(scopeId)
  if (!session.suspendBrowserScope(resolved)) return false
  driverScopeStates.delete(resolved)
  return true
}

export async function getKnownSessions(): Promise<BrowserKnownSessionsState> {
  if (!knownSessions) return { sessions: [] }
  const cookieSignals = await session.listAgentCookieSignals()
  return knownSessions.list(cookieSignals)
}

/**
 * Cookies, site storage, cache, and the remembered browsing trail.
 *
 * Saved passwords are deliberately NOT touched. "Clear browsing data" is about
 * signing out of websites, and a user who wanted to erase their password vault
 * would have to say so separately — silently taking their credentials with it
 * would be a destructive surprise.
 */
export async function clearBrowsingData(
  kinds: readonly BrowserDataKind[] = BROWSER_DATA_KINDS
): Promise<void> {
  // The remembered browsing trail is the local mirror of the cookie jar, so it
  // goes when cookies do and stays when they do not.
  if (kinds.includes('cookies')) knownSessions?.clear()
  await session.clearAgentData(kinds)
}

/**
 * Everything the embedded browser holds for the signed-in user, including the
 * credential vault. This is the Sim sign-out path: a different account signing
 * in on the same machine must not inherit the previous user's sessions or
 * passwords.
 */
export async function clearBrowserProfile(): Promise<void> {
  knownSessions?.clear()
  await session.clearProfileStorage()
  await clearCredentials()
  // Last, covering the pinned-tab list `clearProfileStorage` just emptied.
  // Settings writes coalesce, and an erasure that is still sitting in that
  // window when the process dies leaves the previous account's data on disk
  // after sign-out already told the user it was gone.
  configStore?.flush()
}

function str(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/**
 * Native execution must time out before the renderer gives up (30s default,
 * 45s navigation, requested wait + 15s). Otherwise the abandoned native
 * promise keeps owning the serialized queue and every later browser action
 * times out behind it.
 */
export function browserToolWatchdogMs(
  tool: BrowserToolName,
  params: Record<string, unknown>
): number | null {
  if (tool === 'browser_request_takeover') return null
  if (
    tool === 'browser_navigate' ||
    tool === 'browser_open_url' ||
    tool === 'browser_go_back' ||
    tool === 'browser_go_forward' ||
    tool === 'browser_open_tab'
  ) {
    return NAVIGATION_TOOL_WATCHDOG_MS
  }
  if (tool === 'browser_wait_for') {
    const requested = Math.min(
      num(params, 'timeoutMs') ?? DEFAULT_WAIT_FOR_TIMEOUT_MS,
      MAX_WAIT_FOR_TIMEOUT_MS
    )
    return requested + WAIT_FOR_TOOL_WATCHDOG_GRACE_MS
  }
  return DEFAULT_TOOL_WATCHDOG_MS
}

function requireStr(params: Record<string, unknown>, key: string): string {
  const value = str(params, key)
  if (value === undefined) throw new ToolError(`Missing required parameter "${key}"`)
  return value
}

function requireNum(params: Record<string, unknown>, key: string): number {
  const value = num(params, key)
  if (value === undefined) throw new ToolError(`Missing required numeric parameter "${key}"`)
  return value
}

/**
 * Serializes a self-contained page function with JSON-encoded arguments.
 * WebContents runs it in a persistent isolated world so page scripts cannot
 * replace the ref registry or built-ins. Child WebFrameMain targets use a CDP
 * isolated world mapped to that exact Chromium frame; test doubles without a
 * frameTreeNodeId alone retain the legacy executeJavaScript fallback.
 */
async function execInPage<Args extends unknown[], Result>(
  target: PageExecutionTarget,
  fn: (...args: Args) => Result,
  args: Args,
  userGesture = false,
  notAfter?: number
): Promise<Result> {
  const url = 'getURL' in target ? target.getURL() : target.url
  if (url === '' || url === 'about:blank') {
    throw new ToolError(
      'The active tab is blank. Call browser_navigate before using page inspection or interaction tools.'
    )
  }
  const invocation = `(${String(fn)}).apply(null, ${JSON.stringify(args)})`
  const expression =
    typeof notAfter === 'number'
      ? `(Date.now() >= ${Math.floor(notAfter)} ? ({error: "expired"}) : ${invocation})`
      : invocation
  try {
    if (
      'executeJavaScriptInIsolatedWorld' in target &&
      typeof target.executeJavaScriptInIsolatedWorld === 'function'
    ) {
      return (await target.executeJavaScriptInIsolatedWorld(
        BROWSER_AGENT_ISOLATED_WORLD_ID,
        [{ code: expression }],
        userGesture
      )) as Result
    }
    if ('frameTreeNodeId' in target && typeof target.frameTreeNodeId === 'number') {
      const contents = session.automationTab()?.view.webContents
      const frame = target as WebFrameMain
      if (
        !contents ||
        contents.isDestroyed() ||
        !contents.mainFrame.framesInSubtree.includes(frame)
      ) {
        throw new Error('The frame no longer belongs to the active browser tab')
      }
      return (await cdp.evaluateInIsolatedFrame(contents, frame, expression, userGesture)) as Result
    }
    // Unit-test WebFrame mocks omit Electron's immutable frameTreeNodeId. Real
    // WebFrameMain instances always take the isolated CDP branch above.
    return (await target.executeJavaScript(expression, userGesture)) as Result
  } catch (error) {
    const message = getErrorMessage(error)
    throw new ToolError(
      `Cannot act on this page (${message}). Browser-internal pages cannot be automated — ` +
        'navigate to a regular website first.'
    )
  }
}

/**
 * The completion endpoint ultimately stores browser results as Postgres jsonb.
 * JavaScript strings may contain NUL or lone UTF-16 surrogates that JSON can
 * spell but Postgres cannot store as text. Normalize them at the native bridge
 * boundary so one hostile title/label cannot strand the async checkpoint.
 */
function sanitizeBrowserResult(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
  fieldName = ''
): unknown {
  if (typeof value === 'string') {
    const maxLength =
      fieldName === 'title'
        ? 500
        : fieldName === 'url'
          ? 4096
          : fieldName === 'error' || fieldName === 'note'
            ? 4000
            : fieldName === 'outline'
              ? 500_000
              : fieldName === 'text'
                ? 30_000
                : fieldName === 'dataUrl' && value.startsWith('data:image/')
                  ? 8_000_000
                  : 100_000
    let clean = ''
    for (let index = 0; index < value.length && clean.length < maxLength; index++) {
      const code = value.charCodeAt(index)
      if (code === 0) {
        clean += '\uFFFD'
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1)
        if (next >= 0xdc00 && next <= 0xdfff) {
          if (clean.length + 2 > maxLength) break
          clean += value[index] + value[index + 1]
          index++
        } else {
          clean += '\uFFFD'
        }
      } else {
        clean += code >= 0xdc00 && code <= 0xdfff ? '\uFFFD' : value[index]
      }
    }
    return clean
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (value === null || typeof value !== 'object') return value
  if (depth >= 40 || seen.has(value)) return '[unserializable browser result]'
  seen.add(value)
  if (Array.isArray(value)) {
    const result = value
      .slice(0, 2000)
      .map((entry) => sanitizeBrowserResult(entry, seen, depth + 1, fieldName))
    seen.delete(value)
    return result
  }
  const result: Record<string, unknown> = Object.create(null)
  for (const [key, entry] of Object.entries(value).slice(0, 2000)) {
    const safeKey = String(sanitizeBrowserResult(key, undefined, 0, 'title'))
    result[safeKey] = sanitizeBrowserResult(entry, seen, depth + 1, safeKey)
  }
  seen.delete(value)
  return result
}

/**
 * Covers focusing, clicking, and typing: the agent has no legitimate reason to
 * reach a credential field, and takeover is the sanctioned path when a task
 * needs one.
 */
const PASSWORD_REFUSAL =
  'Refusing to act on a password field. Call browser_request_takeover so the user ' +
  'can enter their credentials themselves.'

/** Maps sentinel `{ error: ... }` results from injected functions to ToolErrors. */
function unwrapPageResult(result: unknown): unknown {
  if (isRecordLike(result) && 'error' in result) {
    const code = (result as { error: string }).error
    if (code === 'stale') {
      const reason =
        isRecordLike(result) && typeof result.reason === 'string' && result.reason
          ? result.reason
          : 'the page changed since the last snapshot'
      throw new ToolError(
        `That element id is stale (${reason}). Call browser_snapshot again and use a fresh id.`
      )
    }
    if (code === 'password') {
      throw new ToolError(PASSWORD_REFUSAL)
    }
    if (code === 'file-input') {
      throw new ToolError(
        'Refusing to click a file input because it opens a native chooser the browser agent cannot inspect or complete. Ask the user to upload the file themselves.'
      )
    }
    if (code === 'expired') {
      throw new ToolError('This browser action expired before it could change the page.')
    }
    if (code === 'not-visible') {
      throw new ToolError(
        'That element is no longer visibly rendered. Take a fresh browser_snapshot and use its current field or control.'
      )
    }
    if (code === 'obstructed') {
      const blocker = String((result as { blocker?: unknown }).blocker || 'another element')
      throw new ToolError(
        `That element is covered by ${blocker}. Close or move the overlay, then take a fresh browser_snapshot.`
      )
    }
    if (code === 'nested-control') {
      const blocker = String((result as { blocker?: unknown }).blocker || 'a nested control')
      throw new ToolError(
        `The point you targeted lands on ${blocker}, which is its own control inside that element — nothing is covering it. Take a fresh browser_snapshot and use the id of the control you actually want.`
      )
    }
    if (code === 'suggestions-open') {
      throw new ToolError(
        'That editable field is already focused and covered by its own suggestions popup. Use browser_type on the same element; do not dismiss the popup first.'
      )
    }
    if (code === 'not-editable') {
      const tag = isRecordLike(result) ? String(result.elementTag ?? '') : ''
      const role = isRecordLike(result) ? String(result.elementRole ?? '') : ''
      const described = [tag ? `<${tag}>` : '', role ? `role="${role}"` : '']
        .filter(Boolean)
        .join(' ')
      throw new ToolError(
        `That element is not a text input${described ? ` (it is ${described})` : ''} — take a fresh browser_snapshot and target the editable field itself.`
      )
    }
    if (code === 'outside-viewport') {
      throw new ToolError(
        'That point is outside the visible viewport. Coordinates are CSS pixels within the current viewport — when reading them off a browser_screenshot, divide image pixels by its scale, and scroll the target into view first.'
      )
    }
    if (code === 'ambiguous-editable') {
      const candidates =
        isRecordLike(result) && Array.isArray(result.candidates)
          ? result.candidates.map(String).filter(Boolean)
          : []
      throw new ToolError(
        `That composite control contains multiple editable fields${
          candidates.length > 0 ? ` (${candidates.join(', ')})` : ''
        }. Take a fresh browser_snapshot and target the exact field.`
      )
    }
    if (code === 'different') {
      throw new ToolError(
        'A different field took focus before the action. No text was entered; take a fresh browser_snapshot and try again.'
      )
    }
    if (code === 'disabled') {
      throw new ToolError('That control is disabled and cannot be operated by the user.')
    }
    if (code === 'readonly') {
      throw new ToolError('That field is read-only and cannot be changed.')
    }
    if (code === 'not-select') {
      throw new ToolError('That element is not a <select> dropdown.')
    }
    if (code === 'no-option') {
      const options = (result as { options?: string[] }).options ?? []
      throw new ToolError(
        `No option matched that label or value. Available options: ${options.join(', ')}`
      )
    }
  }
  return result
}

function waitForLoadComplete(contents: WebContents, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let sawStart = contents.isLoading()
    const cleanup = () => {
      contents.removeListener('did-start-loading', start)
      contents.removeListener('did-stop-loading', finish)
      contents.removeListener('did-fail-load', fail)
      contents.removeListener('destroyed', destroyed)
      clearTimeout(startGrace)
      clearTimeout(timer)
    }
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const start = () => {
      sawStart = true
    }
    const destroyed = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new ToolError('The tab was closed during navigation.'))
    }
    const fail = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      _validatedUrl: string,
      isMainFrame?: boolean
    ) => {
      if (isMainFrame === false || errorCode === -3) return
      if (settled) return
      settled = true
      cleanup()
      reject(
        new ToolError(
          `The page failed to load (${String(errorDescription || errorCode).slice(0, 300)}).`
        )
      )
    }
    const timer = setTimeout(finish, timeoutMs)
    // Give Electron one turn to emit did-start-loading. The old immediate
    // `!isLoading()` check won the race before loadURL/history had started.
    const startGrace = setTimeout(() => {
      if (!sawStart && !contents.isLoading()) finish()
      else sawStart = true
    }, 100)
    contents.on('did-start-loading', start)
    contents.on('did-stop-loading', finish)
    contents.on('did-fail-load', fail)
    contents.on('destroyed', destroyed)
  })
}

async function navigationResult(
  contents: WebContents,
  completion = waitForLoadComplete(contents, NAVIGATION_TIMEOUT_MS)
): Promise<Record<string, unknown>> {
  await completion
  await sleep(NAVIGATION_SETTLE_MS)
  if (contents.isDestroyed()) throw new ToolError('The tab was closed during navigation.')
  return { url: contents.getURL(), title: contents.getTitle() }
}

async function loadUrlAndGetResult(
  contents: WebContents,
  url: string
): Promise<Record<string, unknown>> {
  const beforeUrl = contents.getURL()
  try {
    await contents.loadURL(url)
  } catch (error) {
    const candidate = error as { code?: unknown; errno?: unknown }
    const routineAbort =
      candidate.code === 'ERR_ABORTED' ||
      candidate.errno === -3 ||
      /ERR_ABORTED/i.test(getErrorMessage(error))
    if (!routineAbort) {
      throw new ToolError(`The page failed to load (${getErrorMessage(error)}).`)
    }
    // Redirect/client-abort races can reject the initiating promise even
    // though a replacement navigation committed. Accept only concrete URL
    // progress; an unchanged URL is a real failure, not a successful load.
    await sleep(100)
    if (!contents.getURL() || contents.getURL() === beforeUrl) {
      throw new ToolError(`The navigation was aborted (${getErrorMessage(error)}).`)
    }
  }
  return await navigationResult(contents)
}

/**
 * Bounds a tool call, always clearing the timer once the race settles.
 *
 * Not `sleep()` — that timer cannot be cancelled, so racing against it leaves
 * one pending for the full watchdog window (up to two minutes) after the tool
 * has already finished, dozens at a time over an agent run.
 */
function raceAgainstWatchdog<T>(
  execution: Promise<T>,
  watchdogMs: number,
  onTimeout?: () => void
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout?.()
      reject(
        new ToolError(
          'The browser did not finish this action in time. Take a browser_snapshot to see the current page state.'
        )
      )
    }, watchdogMs)
  })
  return Promise.race([execution, expiry]).finally(() => clearTimeout(timer))
}

/**
 * Post-action readback so the model sees the real effect (selection size,
 * value length) instead of assuming the key "worked".
 */
async function activeElementState(target: PageExecutionTarget): Promise<Record<string, unknown>> {
  const state = await execInPage(target, readActiveElementState, []).catch(() => null)
  return toRecord(state)
}

function requireSnapshotForElementAction(): void {
  const tab = session.requireAutomationTab()
  if (driverScopeState().snapshotTabId === tab.id) return
  throw new ToolError(
    'Element ids are not valid in this tab. Call browser_snapshot and use an id from that result.'
  )
}

function pageTargetForElement(contents: WebContents, elementId: number): PageExecutionTarget {
  requireSnapshotForElementAction()
  const target = driverScopeState().snapshotTargets.get(elementId)
  if (!target || ('isDestroyed' in target && target.isDestroyed())) {
    throw new ToolError(
      'That element id is not present in the current snapshot. Call browser_snapshot and use a visible ref from that result.'
    )
  }
  return target
}

// The user's claim on the visible tab (visibleTabUserSelected) deliberately
// does NOT gate input here: the user clicking or typing in the panel must
// never leave the agent unable to act — hand-off is cooperative via
// browser_request_takeover, whose serialized tool slot already keeps agent
// input out while the user drives.
/**
 * The click-that-navigates race: a press submits a form, the navigation tears
 * the origin document down, and everything AFTER the dispatch — the CDP call's
 * own completion, the confirmation probe, the postcondition reads — fails
 * against a destroyed context. Reporting that as a failed click is wrong twice
 * over: the press reached the page, and the navigation IS the strongest
 * possible evidence it worked. This detects that case at the driver level,
 * where the navigation epoch and URL survive the renderer teardown.
 *
 * Returns a success result when the page provably navigated since dispatch
 * began, and null otherwise (caller keeps its original failure).
 */
function navigationRescue(
  contents: WebContents,
  epochAtDispatch: number,
  urlAtDispatch: string,
  base: { trusted: boolean; activation: string }
): Record<string, unknown> | null {
  if (contents.isDestroyed()) return null
  const navigated =
    navigationEpoch(contents) !== epochAtDispatch || contents.getURL() !== urlAtDispatch
  if (!navigated) return null
  return {
    dispatched: true,
    trusted: base.trusted,
    activation: base.activation,
    effectObserved: true,
    possibleEffectObserved: true,
    navigatedDuringDispatch: true,
    effect: { urlChanged: true },
    dialogs: [],
    note: 'The click triggered a page navigation, and the origin document was torn down before its result could be read — that teardown is why no postconditions are reported, not a failure. Take a fresh browser_snapshot of the new page.',
  }
}

function assertActiveContents(contents: WebContents, expectedNavigationEpoch?: number): void {
  const active = session.automationTab()
  if (
    !active ||
    active.view.webContents !== contents ||
    contents.isDestroyed() ||
    (expectedNavigationEpoch !== undefined && navigationEpoch(contents) !== expectedNavigationEpoch)
  ) {
    throw new ToolError('The active tab or page changed before input could be dispatched.')
  }
}

function assertElementActionCurrent(
  contents: WebContents,
  elementId: number,
  target: PageExecutionTarget
): void {
  assertActiveContents(contents)
  const state = driverScopeState()
  const active = session.automationTab()
  if (state.snapshotTabId !== active?.id || state.snapshotTargets.get(elementId) !== target) {
    throw new ToolError(
      'The page changed before input could be dispatched. Take a fresh browser_snapshot and try again.'
    )
  }
}

function focusedPageTarget(contents: WebContents): PageExecutionTarget {
  const focused = contents.focusedFrame
  return focused && focused !== contents.mainFrame && !focused.isDestroyed() ? focused : contents
}

function sameWebFrame(left: WebFrameMain, right: WebFrameMain): boolean {
  if (left === right) return true
  if (Number.isSafeInteger(left.frameTreeNodeId) && Number.isSafeInteger(right.frameTreeNodeId)) {
    return left.frameTreeNodeId === right.frameTreeNodeId
  }
  if (
    Number.isSafeInteger(left.processId) &&
    Number.isSafeInteger(right.processId) &&
    Number.isSafeInteger(left.routingId) &&
    Number.isSafeInteger(right.routingId)
  ) {
    return left.processId === right.processId && left.routingId === right.routingId
  }
  return false
}

function assertFocusedTargetUnchanged(
  contents: WebContents,
  target: PageExecutionTarget,
  expectedFrameNavigationEpoch?: number
): void {
  const focused = focusedPageTarget(contents)
  const unchanged =
    target === contents
      ? focused === contents
      : focused !== contents && sameWebFrame(focused as WebFrameMain, target as WebFrameMain)
  if (!unchanged) {
    throw new ToolError(
      'Focus moved to a different page or frame before the keystroke. No retry was attempted; inspect the page first.'
    )
  }
  if (target !== contents) {
    const frame = target as WebFrameMain
    if (
      frame.isDestroyed() ||
      frame.detached ||
      (expectedFrameNavigationEpoch !== undefined &&
        frameNavigationEpoch(contents, frame) !== expectedFrameNavigationEpoch) ||
      !contents.mainFrame.framesInSubtree.some((candidate) => sameWebFrame(candidate, frame))
    ) {
      throw new ToolError(
        'The focused frame navigated or was replaced before the keystroke. Inspect the page before continuing.'
      )
    }
  }
}

function frameExecutionTarget(
  target: PageExecutionTarget,
  contents: WebContents
): WebFrameMain | null {
  return target === contents ? null : (target as WebFrameMain)
}

async function prepareElementSurface(
  target: PageExecutionTarget,
  elementId: number,
  executionDeadline?: number,
  allowDisabled = false
): Promise<Record<string, unknown>> {
  const prepared = unwrapPageResult(
    await execInPage(
      target,
      clickElement,
      [elementId, false, false, allowDisabled],
      false,
      executionDeadline
    )
  )
  if (
    !isRecordLike(prepared) ||
    typeof prepared.x !== 'number' ||
    !Number.isFinite(prepared.x) ||
    typeof prepared.y !== 'number' ||
    !Number.isFinite(prepared.y)
  ) {
    throw new ToolError('Could not verify that element on the visible page surface.')
  }
  return prepared
}

async function prepareTypingSurface(
  target: PageExecutionTarget,
  elementId: number,
  moveFocus: boolean,
  executionDeadline?: number,
  settleGraceMs = 0
): Promise<Record<string, unknown>> {
  const prepared = unwrapPageResult(
    settleGraceMs > 0
      ? await execInPageWithSettleGrace(
          target,
          focusElementForTyping,
          [elementId, moveFocus],
          executionDeadline,
          settleGraceMs
        )
      : await execInPage(
          target,
          focusElementForTyping,
          [elementId, moveFocus],
          false,
          executionDeadline
        )
  )
  if (
    !isRecordLike(prepared) ||
    prepared.focused !== true ||
    typeof prepared.x !== 'number' ||
    !Number.isFinite(prepared.x) ||
    typeof prepared.y !== 'number' ||
    !Number.isFinite(prepared.y)
  ) {
    throw new ToolError('Could not verify and focus that editable element.')
  }
  return prepared
}

const TRANSIENT_PROBE_ERRORS = new Set(['stale', 'not-visible', 'not-editable'])
const SETTLE_GRACE_MS = 1_000
const SETTLE_PROBE_INTERVAL_MS = 250

/**
 * First-touch page probe with a short settle grace. A live view re-rendering
 * under the agent (Slack's virtualized sidebar, its late-mounting composer)
 * can transiently report an element as stale, invisible, or not yet editable
 * while its replacement mounts one frame later. These call sites run before
 * anything is dispatched, so a bounded reprobe safely turns that churn into a
 * recovery instead of a dead ref.
 */
async function execInPageWithSettleGrace<Args extends unknown[], Result>(
  target: PageExecutionTarget,
  fn: (...args: Args) => Result,
  args: Args,
  executionDeadline?: number,
  graceMs = SETTLE_GRACE_MS
): Promise<Result> {
  const graceDeadline = Date.now() + graceMs
  for (;;) {
    const result = await execInPage(target, fn, args, false, executionDeadline)
    const code =
      isRecordLike(result) && typeof result.error === 'string' ? String(result.error) : null
    if (
      code === null ||
      !TRANSIENT_PROBE_ERRORS.has(code) ||
      Date.now() + SETTLE_PROBE_INTERVAL_MS > graceDeadline ||
      (executionDeadline !== undefined &&
        Date.now() + SETTLE_PROBE_INTERVAL_MS >= executionDeadline)
    ) {
      return result
    }
    await sleep(SETTLE_PROBE_INTERVAL_MS)
  }
}

function pointFromPrepared(prepared: Record<string, unknown>): { x: number; y: number } {
  return { x: prepared.x as number, y: prepared.y as number }
}

async function pageActionState(
  target: PageExecutionTarget,
  resetMutationRevision = false,
  elementId?: number
): Promise<Record<string, unknown>> {
  const state = await execInPage(target, readPageActionState, [
    resetMutationRevision,
    elementId,
  ]).catch(() => null)
  return toRecord(state)
}

/**
 * Which signals each tool accepts as proof its action reached the page.
 *
 * The tools deliberately do NOT share one predicate — the differences are real,
 * and flattening them would make every tool wrong in a different direction:
 *
 * - `browser_drag` is the only tool that trusts `domChanged`, because a drop
 *   that reorders a list may change nothing else observable. Everywhere else
 *   background churn (Slack, Gmail) would forge success for an ignored action.
 * - `browser_hover` ignores `fieldChanged` and `focusChanged`: hovering does not
 *   type or focus, so those would only ever be someone else's effect.
 * - `browser_click` / `browser_click_at` count `focusChanged` only when the
 *   target was editable — otherwise a click that merely moved focus reads as
 *   success.
 * - `targetChanged` requires a `targetState`, which `pageActionState` captures
 *   only when given an `elementId`. Tools without one (click_at, insert_text,
 *   drag, press_key) cannot use it; listing it there read as coverage they did
 *   not have, and it was silently always false.
 *
 * What IS shared is this function: every signal is computed here once, so a
 * tool's formula is a statement about which evidence it trusts, not a private
 * re-derivation of what changed.
 */
function pageEffect(
  beforePage: Record<string, unknown>,
  afterPage: Record<string, unknown>,
  beforeElement: Record<string, unknown>,
  afterElement: Record<string, unknown>
): {
  effectObserved: boolean
  possibleEffectObserved: boolean
  effect: Record<string, boolean>
} {
  const changed = (key: string): boolean =>
    key in beforePage && key in afterPage && beforePage[key] !== afterPage[key]
  const effect = {
    urlChanged: changed('url'),
    titleChanged: changed('title'),
    focusChanged: changed('focus'),
    domChanged: typeof afterPage.mutationRevision === 'number' && afterPage.mutationRevision > 0,
    dialogChanged:
      'dialogs' in beforePage &&
      'dialogs' in afterPage &&
      JSON.stringify(beforePage.dialogs) !== JSON.stringify(afterPage.dialogs),
    popupChanged:
      'popups' in beforePage &&
      'popups' in afterPage &&
      JSON.stringify(beforePage.popups) !== JSON.stringify(afterPage.popups),
    scrollChanged:
      'scroll' in beforePage &&
      'scroll' in afterPage &&
      JSON.stringify(beforePage.scroll) !== JSON.stringify(afterPage.scroll),
    fieldChanged:
      Object.keys(beforeElement).length > 0 &&
      Object.keys(afterElement).length > 0 &&
      JSON.stringify(beforeElement) !== JSON.stringify(afterElement),
    targetChanged:
      'targetState' in beforePage &&
      'targetState' in afterPage &&
      JSON.stringify(beforePage.targetState) !== JSON.stringify(afterPage.targetState),
  }
  // Generic DOM churn and title badges are weak evidence in Slack/Gmail: both
  // update in the background while an ignored shortcut is in flight. Keep
  // those signals for diagnosis, but never let them alone prove success.
  const effectObserved =
    effect.urlChanged ||
    effect.focusChanged ||
    effect.dialogChanged ||
    effect.popupChanged ||
    effect.fieldChanged ||
    effect.targetChanged
  return {
    effectObserved,
    possibleEffectObserved:
      effectObserved || effect.titleChanged || effect.domChanged || effect.scrollChanged,
    effect,
  }
}

function crossOriginBoundaryFrames(contents: WebContents): WebFrameMain[] {
  const mainFrame = contents.mainFrame
  if (!mainFrame) return []
  return mainFrame.framesInSubtree.filter((frame) => {
    if (sameWebFrame(frame, mainFrame) || frame.detached || frame.isDestroyed() || !frame.parent) {
      return false
    }
    if (!/^https?:\/\//i.test(frame.url)) return false
    return frame.origin !== frame.parent.origin
  })
}

function frameIsWithin(frame: WebFrameMain | null, ancestor: WebFrameMain): boolean {
  for (let current = frame; current; current = current.parent) {
    if (sameWebFrame(current, ancestor)) return true
  }
  return false
}

async function inspectFrameEmbedding(
  frame: WebFrameMain,
  point?: { x: number; y: number },
  notAfter?: number
): Promise<{
  known: boolean
  visible: boolean
  blocker?: string
  point?: { x: number; y: number }
  nativePointReliable: boolean
}> {
  let child = frame
  let childX = point?.x
  let childY = point?.y
  let nativePointReliable = true
  while (child.parent) {
    const parent = child.parent
    const childIndex = Array.isArray(parent.frames)
      ? parent.frames.findIndex((candidate) => sameWebFrame(candidate, child))
      : -1
    const raw = await execInPage(
      parent,
      readChildFrameElementState,
      [child.name, child.url, child.origin, childIndex, childX, childY],
      false,
      notAfter
    ).catch(() => null)
    if (!isRecordLike(raw) || raw.known !== true) {
      return { known: false, visible: false, nativePointReliable: false }
    }
    if (raw.pointMappingReliable === false) nativePointReliable = false
    if (raw.visible !== true) {
      return {
        known: true,
        visible: false,
        nativePointReliable,
        ...(typeof raw.blocker === 'string' && raw.blocker ? { blocker: raw.blocker } : {}),
      }
    }
    if (
      typeof raw.mappedX !== 'number' ||
      !Number.isFinite(raw.mappedX) ||
      typeof raw.mappedY !== 'number' ||
      !Number.isFinite(raw.mappedY)
    ) {
      return { known: false, visible: false, nativePointReliable: false }
    }
    childX = raw.mappedX
    childY = raw.mappedY
    child = parent
  }
  return {
    known: true,
    visible: true,
    nativePointReliable,
    ...(typeof childX === 'number' &&
    Number.isFinite(childX) &&
    typeof childY === 'number' &&
    Number.isFinite(childY)
      ? { point: { x: childX, y: childY } }
      : {}),
  }
}

async function assertFrameEmbeddingVisible(
  frame: WebFrameMain,
  point?: { x: number; y: number },
  notAfter?: number
): Promise<{ point?: { x: number; y: number }; nativePointReliable: boolean }> {
  const embedding = await inspectFrameEmbedding(frame, point, notAfter)
  if (!embedding.known) {
    throw new ToolError(
      'The frame containing that element could not be matched to a visible page surface. Take a fresh browser_snapshot and try again.'
    )
  }
  if (!embedding.visible) {
    throw new ToolError(
      embedding.blocker
        ? `The frame containing that element is covered by ${embedding.blocker}. Close or move the overlay first.`
        : 'The frame containing that element is hidden, offscreen, or covered.'
    )
  }
  return { point: embedding.point, nativePointReliable: embedding.nativePointReliable }
}

async function visibleFrameTargets(
  contents: WebContents,
  notAfter?: number
): Promise<{
  targets: WebFrameMain[]
  hidden: number
  unreadable: number
  truncated: boolean
}> {
  const mainFrame = contents.mainFrame
  const descendants = mainFrame.framesInSubtree
    .filter(
      (frame) =>
        !sameWebFrame(frame, mainFrame) &&
        !frame.detached &&
        !frame.isDestroyed() &&
        Boolean(frame.parent) &&
        /^https?:\/\//i.test(frame.url)
    )
    .slice(0, MAX_CROSS_ORIGIN_SCAN_FRAMES)
  const targets: WebFrameMain[] = []
  let hidden = 0
  let unreadable = 0
  let considered = 0
  for (const frame of descendants) {
    if (targets.length >= MAX_CROSS_ORIGIN_SNAPSHOT_FRAMES) break
    considered++
    const embedding = await inspectFrameEmbedding(frame, undefined, notAfter).catch(() => null)
    if (!embedding?.known) {
      unreadable++
    } else if (!embedding.visible) {
      hidden++
    } else {
      targets.push(frame)
    }
  }
  return {
    targets,
    hidden,
    unreadable,
    truncated:
      mainFrame.framesInSubtree.length - 1 > descendants.length || considered < descendants.length,
  }
}

async function readWholePageText(
  contents: WebContents,
  notAfter?: number
): Promise<Record<string, unknown>> {
  const top = await execInPage(contents, readPageText, [undefined], false, notAfter)
  if (!isRecordLike(top) || typeof top.text !== 'string') {
    throw new ToolError('The page did not return readable text.')
  }
  const frames = await visibleFrameTargets(contents, notAfter)
  const maxCombinedChars = 30_000
  const sections: string[] = [top.text.slice(0, 20_000)]
  let used = sections[0].length
  let framesRead = 0
  let unreadableFrames = frames.unreadable
  let truncated = top.truncated === true || top.text.length > sections[0].length || frames.truncated
  for (const frame of frames.targets) {
    if (used >= maxCombinedChars) {
      truncated = true
      break
    }
    try {
      const result = await execInPage(frame, readPageText, [undefined], false, notAfter)
      if (!isRecordLike(result) || typeof result.text !== 'string') {
        unreadableFrames++
        continue
      }
      const label = String(result.title || frame.name || frame.url)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
      const header = `\n\n[Frame: ${label}]\n`
      const remaining = maxCombinedChars - used - header.length
      if (remaining <= 0) {
        truncated = true
        break
      }
      const frameText = result.text.slice(0, Math.min(5_000, remaining))
      sections.push(`${header}${frameText}`)
      used += header.length + frameText.length
      framesRead++
      if (result.truncated === true || frameText.length < result.text.length) truncated = true
    } catch {
      unreadableFrames++
    }
  }
  return {
    ...top,
    text: sections.join(''),
    truncated,
    framesRead,
    unreadableFrames,
    hiddenFrames: frames.hidden,
  }
}

function validateSnapshotRefs(
  snapshot: Record<string, unknown>,
  startingElementId: number
): { refs: number[]; nextElementId: number; lineIndexes: Map<number, number> } | null {
  if (typeof snapshot.outline !== 'string' || snapshot.outline.length > 500_000) return null
  if (!Array.isArray(snapshot.refIds) || snapshot.refIds.length > 300) return null
  const nextElementId = snapshot.nextElementId
  if (
    typeof nextElementId !== 'number' ||
    !Number.isSafeInteger(nextElementId) ||
    nextElementId < startingElementId ||
    nextElementId - startingElementId > 100_000
  ) {
    return null
  }
  const refs: number[] = []
  const unique = new Set<number>()
  const rawLineIndexes = snapshot.refLineIndexes
  if (!isRecordLike(rawLineIndexes)) return null
  const outlineLines = snapshot.outline.length > 0 ? snapshot.outline.split('\n') : []
  const lineIndexes = new Map<number, number>()
  const uniqueLineIndexes = new Set<number>()
  for (const value of snapshot.refIds) {
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < startingElementId ||
      value >= nextElementId ||
      unique.has(value)
    ) {
      return null
    }
    unique.add(value)
    refs.push(value)
    const lineIndex = rawLineIndexes[String(value)]
    if (
      typeof lineIndex !== 'number' ||
      !Number.isSafeInteger(lineIndex) ||
      lineIndex < 0 ||
      lineIndex >= outlineLines.length ||
      uniqueLineIndexes.has(lineIndex)
    ) {
      return null
    }
    const refToken = `[ref=${value}]`
    const tokens = outlineLines[lineIndex].match(/\[ref=\d+\]/g) ?? []
    if (tokens.length !== 1 || tokens[0] !== refToken) return null
    uniqueLineIndexes.add(lineIndex)
    lineIndexes.set(value, lineIndex)
  }
  return { refs, nextElementId, lineIndexes }
}

/**
 * Captures the top page plus each cross-origin boundary frame in its own
 * isolated world. CDP is the privileged bridge the top document's same-origin
 * policy intentionally lacks; password redaction still runs inside every frame
 * before any result crosses back to the driver.
 */
async function captureSnapshot(contents: WebContents, notAfter?: number): Promise<unknown> {
  const state = driverScopeState()
  const tab = session.requireAutomationTab()
  if (tab.view.webContents !== contents) {
    throw new ToolError('The active tab changed before the snapshot started. Try again.')
  }
  invalidateSnapshot(state)
  const captureEpoch = state.snapshotCaptureEpoch
  const capturedTabId = tab.id
  const capturedNavigationEpoch = navigationEpoch(contents)
  const targets = new Map<number, PageExecutionTarget>()
  const targetLineIndexes = new Map<number, number>()
  const stillCurrent = (): boolean => {
    const active = session.automationTab()
    return (
      state.snapshotCaptureEpoch === captureEpoch &&
      active?.id === capturedTabId &&
      active.view.webContents === contents &&
      !contents.isDestroyed() &&
      // Same-document URL drift (SPA pushState) must not abort the capture;
      // only a cross-document navigation makes the collected refs meaningless.
      navigationEpoch(contents) === capturedNavigationEpoch
    )
  }

  const mainStartingElementId = state.nextElementRefId
  const mainSnapshot = await execInPage(
    contents,
    collectSnapshot,
    [mainStartingElementId],
    false,
    notAfter
  )
  if (!stillCurrent()) {
    throw new ToolError('The tab changed while its snapshot was being captured. Try again.')
  }
  if (
    !isRecordLike(mainSnapshot) ||
    typeof mainSnapshot.outline !== 'string' ||
    !Array.isArray(mainSnapshot.refIds)
  ) {
    throw new ToolError('The page returned an incomplete snapshot. Try browser_snapshot again.')
  }
  const mainRefs = validateSnapshotRefs(mainSnapshot, mainStartingElementId)
  if (!mainRefs) {
    throw new ToolError('The page returned invalid element ids. Try browser_snapshot again.')
  }

  let nextElementId = mainRefs.nextElementId
  for (const ref of mainRefs.refs) {
    targets.set(ref, contents)
    targetLineIndexes.set(ref, mainRefs.lineIndexes.get(ref) as number)
  }

  const mainOutline = String(mainSnapshot.outline ?? '')
  const sections = mainOutline ? [mainOutline] : []
  let combinedLineCount = mainOutline ? mainOutline.split('\n').length : 0
  let truncated = mainSnapshot.truncated === true
  let capturedCrossOriginFrames = 0
  let unreadableCrossOriginFrames = 0
  let hiddenCrossOriginFrames = 0
  const boundaryFrames = crossOriginBoundaryFrames(contents)
  const frames = boundaryFrames.slice(0, MAX_CROSS_ORIGIN_SCAN_FRAMES)
  if (boundaryFrames.length > frames.length) truncated = true

  for (const frame of frames) {
    if (capturedCrossOriginFrames >= MAX_CROSS_ORIGIN_SNAPSHOT_FRAMES) {
      truncated = true
      break
    }
    try {
      const embedding = await inspectFrameEmbedding(frame, undefined, notAfter)
      if (!embedding.known) {
        unreadableCrossOriginFrames++
        continue
      }
      if (!embedding.visible) {
        hiddenCrossOriginFrames++
        continue
      }
      const frameUrl = frame.url
      const frameStartingElementId = nextElementId
      const frameSnapshot = await execInPage(
        frame,
        collectSnapshot,
        [frameStartingElementId],
        false,
        notAfter
      )
      if (!stillCurrent()) {
        throw new ToolError('The tab changed while its frames were being captured. Try again.')
      }
      if (frame.isDestroyed() || frame.detached || frame.url !== frameUrl) {
        unreadableCrossOriginFrames++
        continue
      }
      if (
        !isRecordLike(frameSnapshot) ||
        typeof frameSnapshot.outline !== 'string' ||
        !Array.isArray(frameSnapshot.refIds)
      ) {
        unreadableCrossOriginFrames++
        continue
      }
      const frameRefs = validateSnapshotRefs(frameSnapshot, frameStartingElementId)
      if (!frameRefs) {
        unreadableCrossOriginFrames++
        continue
      }
      nextElementId = frameRefs.nextElementId
      const outline = frameSnapshot.outline.trim()
      // Hidden tracking/auth frames commonly have no rendered structure but
      // used to consume the eight-frame budget ahead of Gmail's visible OGS UI.
      if (!outline) continue
      const label = String(frameSnapshot.title || frame.origin || frame.url)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
      const frameLines = outline.split('\n')
      const sectionStartLine = combinedLineCount
      sections.push(
        `- cross-origin iframe ${JSON.stringify(label)}:\n${frameLines
          .map((line) => `  ${line}`)
          .join('\n')}`
      )
      for (const ref of frameRefs.refs) {
        targets.set(ref, frame)
        targetLineIndexes.set(
          ref,
          sectionStartLine + 1 + (frameRefs.lineIndexes.get(ref) as number)
        )
      }
      combinedLineCount += 1 + frameLines.length
      capturedCrossOriginFrames++
      if (frameSnapshot.truncated === true) truncated = true
    } catch {
      if (!stillCurrent()) {
        throw new ToolError('The tab changed while its frames were being captured. Try again.')
      }
      unreadableCrossOriginFrames++
    }
  }

  if (!stillCurrent()) {
    throw new ToolError('The tab changed before its snapshot could be committed. Try again.')
  }
  state.nextElementRefId = nextElementId
  const outlineLines = sections.join('\n').split('\n')
  if (outlineLines.length > COMBINED_SNAPSHOT_LINE_CAP) truncated = true
  const visibleOutlineLines = outlineLines.slice(0, COMBINED_SNAPSHOT_LINE_CAP)
  state.snapshotTargets = new Map(
    Array.from(targets).filter(
      ([elementId]) =>
        (targetLineIndexes.get(elementId) ?? Number.POSITIVE_INFINITY) < visibleOutlineLines.length
    )
  )
  state.snapshotTabId = capturedTabId
  return {
    ...omit(mainSnapshot, ['refIds', 'refLineIndexes', 'nextElementId']),
    outline: visibleOutlineLines.join('\n'),
    truncated,
    capturedCrossOriginFrames,
    unreadableCrossOriginFrames,
    hiddenCrossOriginFrames,
  }
}

/**
 * Hands control to the user: the page is already natively interactive in the
 * panel, and the chat's takeover tool row shows the reason as a question.
 * The tool resolves when that question sends the `takeover-done` panel action.
 * Nothing is injected into the page, so nothing covers page content and the
 * pending state survives navigations.
 */
async function runTakeover(purpose: string | undefined, invocationEpoch: number): Promise<unknown> {
  const tab = session.ensureAutomationTab()
  const contents = tab.view.webContents
  const state = driverScopeState()
  state.takeoverActive = true
  state.takeoverDone = false
  state.takeoverResponse = null
  state.takeoverInvocationEpoch = invocationEpoch
  session.setAutomationNeedsAttention(true)

  const startedAt = Date.now()
  try {
    for (;;) {
      await sleep(TAKEOVER_POLL_MS)
      if (!session.hasSession() || contents.isDestroyed()) {
        throw new ToolError(
          'The browser session was closed during takeover. Ask the user what happened, then reopen with browser_navigate.'
        )
      }
      if (state.toolInvocationEpoch !== invocationEpoch) {
        throw new ToolError('The browser takeover was superseded by a newer browser action.')
      }
      if (state.takeoverDone) {
        if (purpose === 'sign_in') {
          const activeContents = session.automationTab()?.view.webContents
          if (activeContents && !activeContents.isDestroyed()) {
            knownSessions?.noteSignInCompleted(activeContents.getURL())
          }
        }
        return {
          completed: true,
          elapsedMs: Date.now() - startedAt,
          ...(state.takeoverResponse ? { userInstruction: state.takeoverResponse } : {}),
        }
      }
    }
  } finally {
    // Cancellation releases the serialized tool queue before this polling
    // loop observes its superseding epoch. Never let that delayed cleanup
    // erase a newer takeover that has already claimed the same scope state.
    if (state.takeoverInvocationEpoch === invocationEpoch) {
      session.setAutomationNeedsAttention(false)
      state.takeoverActive = false
      state.takeoverDone = false
      state.takeoverResponse = null
      state.takeoverInvocationEpoch = null
    }
  }
}

async function executeToolInner(
  tool: BrowserToolName,
  params: Record<string, unknown>,
  assertCurrentExecution: () => void,
  executionDeadline: number | undefined,
  invocationEpoch: number
): Promise<unknown> {
  switch (tool) {
    case 'browser_navigate': {
      const url = requireStr(params, 'url')
      invalidateSnapshot()
      // Up-front SSRF check for a clean model-facing error. The partition's
      // onBeforeRequest is the actual enforcement seam (it also catches
      // page-initiated navigations); this pre-check exists because loadURL's
      // rejection is swallowed below, so a blocked nav would otherwise surface
      // as a blank page with no error.
      const guard = await checkAgentUrl(url)
      if (!guard.ok) {
        throw new ToolError(guard.error ?? 'That address was blocked.')
      }
      assertCurrentExecution()
      const tab = session.ensureAutomationTab()
      const contents = tab.view.webContents
      assertCurrentExecution()
      return await loadUrlAndGetResult(contents, url)
    }

    case 'browser_open_url': {
      // Composite navigate + snapshot: one round trip for the copilot's
      // direct "open this page and look at it" tool, instead of two
      // checkpoint/resume cycles for browser_navigate then browser_snapshot.
      const url = requireStr(params, 'url')
      invalidateSnapshot()
      const guard = await checkAgentUrl(url)
      if (!guard.ok) {
        throw new ToolError(guard.error ?? 'That address was blocked.')
      }
      assertCurrentExecution()
      const tab = session.ensureAutomationTab()
      const contents = tab.view.webContents
      assertCurrentExecution()
      const nav = await loadUrlAndGetResult(contents, url)
      // A failed snapshot (browser-internal page, injection error) should not
      // fail the open itself — the page is on screen either way.
      assertCurrentExecution()
      const snapshot = await captureSnapshot(contents, executionDeadline).catch(() => null)
      return snapshot === null
        ? { ...nav, note: 'The page loaded but a snapshot could not be captured.' }
        : { ...nav, snapshot }
    }

    case 'browser_go_back':
    case 'browser_go_forward': {
      invalidateSnapshot()
      const contents = session.requireAutomationTab().view.webContents
      const history = contents.navigationHistory
      assertCurrentExecution()
      let completion: Promise<void>
      if (tool === 'browser_go_back') {
        if (!history.canGoBack()) throw new ToolError('Cannot go back — no earlier history entry.')
        completion = waitForLoadComplete(contents, NAVIGATION_TIMEOUT_MS)
        history.goBack()
      } else {
        if (!history.canGoForward()) {
          throw new ToolError('Cannot go forward — no later history entry.')
        }
        completion = waitForLoadComplete(contents, NAVIGATION_TIMEOUT_MS)
        history.goForward()
      }
      return await navigationResult(contents, completion)
    }

    case 'browser_open_tab': {
      invalidateSnapshot()
      const url = str(params, 'url')
      if (url) {
        const guard = await checkAgentUrl(url)
        if (!guard.ok) {
          throw new ToolError(guard.error ?? 'That address was blocked.')
        }
      }
      assertCurrentExecution()
      // The agent chose to open this page to work in, so the panel follows it.
      const tab = session.addAutomationTab({ reveal: true })
      const contents = tab.view.webContents
      if (url) {
        assertCurrentExecution()
        const result = await loadUrlAndGetResult(contents, url)
        return { tabId: tab.id, ...result }
      }
      return { tabId: tab.id, url: '', title: '' }
    }

    case 'browser_switch_tab': {
      invalidateSnapshot()
      const tab = session.switchAutomationTab(requireStr(params, 'tabId'))
      const contents = tab.view.webContents
      return { tabId: tab.id, url: contents.getURL(), title: contents.getTitle() }
    }

    case 'browser_close_tab': {
      invalidateSnapshot()
      const tabId = requireStr(params, 'tabId')
      session.closeAutomationTab(tabId)
      return { closed: tabId }
    }

    case 'browser_list_tabs': {
      session.restoreBrowserSession()
      return session.getAutomationTabsState()
    }

    case 'browser_list_sessions': {
      return await getKnownSessions()
    }

    case 'browser_wait_for': {
      const text = str(params, 'text')
      const timeoutMs = Math.min(
        num(params, 'timeoutMs') ?? DEFAULT_WAIT_FOR_TIMEOUT_MS,
        MAX_WAIT_FOR_TIMEOUT_MS
      )
      const startedAt = Date.now()
      if (!text) {
        await sleep(timeoutMs)
        return { waitedMs: timeoutMs }
      }
      const waitedTab = session.requireAutomationTab()
      const contents = waitedTab.view.webContents
      while (Date.now() - startedAt < timeoutMs) {
        const active = session.automationTab()
        if (active?.id !== waitedTab.id || active.view.webContents !== contents) {
          throw new ToolError(
            'The active tab changed while waiting. Start browser_wait_for again on the tab you want to inspect.'
          )
        }
        const foundTop = await execInPage(
          contents,
          pageContainsText,
          [text],
          false,
          executionDeadline
        ).catch(() => false)
        if (foundTop) return { found: true, elapsedMs: Date.now() - startedAt }
        const frames = await visibleFrameTargets(contents, executionDeadline)
        let foundInFrame = false
        for (const frame of frames.targets) {
          foundInFrame = await execInPage(
            frame,
            pageContainsText,
            [text],
            false,
            executionDeadline
          ).catch(() => false)
          if (foundInFrame) break
        }
        if (foundInFrame) {
          return { found: true, elapsedMs: Date.now() - startedAt, foundInFrame: true }
        }
        await sleep(300)
      }
      return {
        found: false,
        elapsedMs: Date.now() - startedAt,
        note: 'Text did not appear before the timeout. Take a browser_snapshot to see the current page state.',
      }
    }

    case 'browser_snapshot': {
      const contents = session.requireAutomationTab().view.webContents
      assertCurrentExecution()
      return await captureSnapshot(contents, executionDeadline)
    }

    case 'browser_read_text': {
      const contents = session.requireAutomationTab().view.webContents
      const elementId = num(params, 'elementId')
      if (elementId === undefined) return await readWholePageText(contents, executionDeadline)
      const target = pageTargetForElement(contents, elementId)
      return unwrapPageResult(
        await execInPage(target, readPageText, [elementId], false, executionDeadline)
      )
    }

    case 'browser_screenshot': {
      const contents = session.requireAutomationTab().view.webContents
      const shot = await cdp.captureScreenshot(contents).catch(() => null)
      if (shot === null) {
        throw new ToolError(
          'Could not capture the page. Use browser_snapshot or browser_read_text instead.'
        )
      }
      if (shot.dataUrl.length > 8_000_000) {
        throw new ToolError(
          'The screenshot result was too large to return safely. Use browser_snapshot or browser_read_text instead.'
        )
      }
      const viewport = await execInPage(contents, getViewportInfo, []).catch(() => null)
      // scale maps image pixels back to CSS viewport pixels for the
      // coordinate tools: cssX = imageX / scale.
      return { dataUrl: shot.dataUrl, viewport, scale: shot.scale }
    }

    case 'browser_extract': {
      const instruction = requireStr(params, 'instruction')
      const contents = session.requireAutomationTab().view.webContents
      const page = await readWholePageText(contents, executionDeadline)
      return { instruction, page }
    }

    case 'browser_click': {
      const clickedTab = session.requireAutomationTab()
      const contents = clickedTab.view.webContents
      const elementId = requireNum(params, 'elementId')
      const target = pageTargetForElement(contents, elementId)
      const targetFrame = frameExecutionTarget(target, contents)
      let trusted = false
      let activation = 'synthetic-pointer'
      let prepared: Record<string, unknown>
      let preparedTopPoint: { x: number; y: number } | undefined
      let nativeFramePointReliable = false

      if (!targetFrame) {
        assertCurrentExecution()
        const first = unwrapPageResult(
          await execInPageWithSettleGrace(
            target,
            clickElement,
            [elementId, false, false],
            executionDeadline
          )
        )
        if (!isRecordLike(first)) throw new ToolError('Could not resolve that click target.')
        prepared = first

        // Moving the native pointer can reveal a hover overlay or make a
        // virtualized row move. Re-hit-test after the move and require a stable
        // point before pressing so the click cannot silently land elsewhere.
        let stable = false
        for (let attempt = 0; attempt < 2; attempt++) {
          const x = prepared.x
          const y = prepared.y
          if (typeof x !== 'number' || typeof y !== 'number') {
            throw new ToolError('Could not determine where to click that element.')
          }
          assertCurrentExecution()
          assertElementActionCurrent(contents, elementId, target)
          await cdp.moveMouse(contents, x, y)
          const checked = unwrapPageResult(
            await execInPage(
              target,
              clickElement,
              [elementId, false, false],
              false,
              executionDeadline
            )
          )
          if (!isRecordLike(checked)) throw new ToolError('Could not re-check that click target.')
          stable =
            typeof checked.x === 'number' &&
            typeof checked.y === 'number' &&
            Math.abs(checked.x - x) < 1 &&
            Math.abs(checked.y - y) < 1
          prepared = checked
          if (stable) break
        }
        if (!stable) {
          throw new ToolError(
            'The click target kept moving or was replaced. Take a fresh browser_snapshot and try again.'
          )
        }
      } else {
        assertCurrentExecution()
        await assertFrameEmbeddingVisible(targetFrame, undefined, executionDeadline)
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        const focused = unwrapPageResult(
          await execInPageWithSettleGrace(
            target,
            clickElement,
            [elementId, false, true],
            executionDeadline
          )
        )
        if (!isRecordLike(focused)) throw new ToolError('Could not resolve that click target.')
        prepared = focused
        let embedding = await assertFrameEmbeddingVisible(
          targetFrame,
          pointFromPrepared(prepared),
          executionDeadline
        )
        nativeFramePointReliable = embedding.nativePointReliable && Boolean(embedding.point)
        preparedTopPoint = embedding.point
        if (nativeFramePointReliable && preparedTopPoint) {
          let topPoint = preparedTopPoint
          let stable = false
          for (let attempt = 0; attempt < 2; attempt++) {
            assertCurrentExecution()
            assertElementActionCurrent(contents, elementId, target)
            await cdp.moveMouse(contents, topPoint.x, topPoint.y)
            const checked = await prepareElementSurface(target, elementId, executionDeadline)
            assertCurrentExecution()
            assertElementActionCurrent(contents, elementId, target)
            embedding = await assertFrameEmbeddingVisible(
              targetFrame,
              pointFromPrepared(checked),
              executionDeadline
            )
            const checkedPoint = embedding.point
            stable = Boolean(
              embedding.nativePointReliable &&
                checkedPoint &&
                Math.abs(checkedPoint.x - topPoint.x) < 1 &&
                Math.abs(checkedPoint.y - topPoint.y) < 1
            )
            prepared = checked
            preparedTopPoint = checkedPoint
            if (checkedPoint) topPoint = checkedPoint
            nativeFramePointReliable = embedding.nativePointReliable && Boolean(checkedPoint)
            if (stable) break
          }
          if (!stable) {
            throw new ToolError(
              'The framed click target kept moving or was replaced. Take a fresh browser_snapshot and try again.'
            )
          }
        }
      }

      const observeTopPage = targetFrame !== null || Number(prepared.frameDepth || 0) > 0
      const epochAtDispatch = navigationEpoch(contents)
      const urlAtDispatch = contents.getURL()
      const beforePage = await pageActionState(target, true, elementId)
      const beforeElement = await activeElementState(target)
      const beforeTopPage = observeTopPage ? await pageActionState(contents, true) : beforePage
      const beforeTopElement = observeTopPage ? await activeElementState(contents) : beforeElement

      if (!targetFrame) {
        // This is deliberately the final renderer round trip before the native
        // press. Baseline reads above can give a virtualized app time to move,
        // replace, or cover the row.
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        const finalCheck = unwrapPageResult(
          await execInPage(
            target,
            clickElement,
            [elementId, false, false],
            false,
            executionDeadline
          )
        )
        if (!isRecordLike(finalCheck)) throw new ToolError('Could not re-check that click target.')
        const x = finalCheck.x
        const y = finalCheck.y
        if (typeof x !== 'number' || typeof y !== 'number') {
          throw new ToolError('Could not determine where to click that element.')
        }
        if (
          typeof prepared.x !== 'number' ||
          typeof prepared.y !== 'number' ||
          Math.abs(x - prepared.x) >= 1 ||
          Math.abs(y - prepared.y) >= 1
        ) {
          throw new ToolError(
            'The click target moved during its final safety check. Take a fresh browser_snapshot and try again.'
          )
        }
        prepared = finalCheck
        try {
          assertCurrentExecution()
          assertElementActionCurrent(contents, elementId, target)
          await cdp.clickAt(contents, x, y, false)
          trusted = true
          activation = 'native-pointer'
        } catch (error) {
          const rescued = navigationRescue(contents, epochAtDispatch, urlAtDispatch, {
            trusted: true,
            activation: 'native-pointer',
          })
          if (rescued) return rescued
          throw new ToolError(
            `Native click dispatch failed (${getErrorMessage(error)}). The action was not retried because a partial pointer press may already have reached the page. Take a fresh snapshot before continuing.`
          )
        }
      } else {
        const finalSurface = await prepareElementSurface(target, elementId, executionDeadline)
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        const finalEmbedding = await assertFrameEmbeddingVisible(
          targetFrame,
          pointFromPrepared(finalSurface),
          executionDeadline
        )
        const finalTopPoint = finalEmbedding.point
        if (
          nativeFramePointReliable &&
          finalEmbedding.nativePointReliable &&
          preparedTopPoint &&
          finalTopPoint
        ) {
          if (
            Math.abs(finalTopPoint.x - preparedTopPoint.x) >= 1 ||
            Math.abs(finalTopPoint.y - preparedTopPoint.y) >= 1
          ) {
            throw new ToolError(
              'The framed click target moved during its final safety check. Take a fresh browser_snapshot and try again.'
            )
          }
          try {
            assertCurrentExecution()
            assertElementActionCurrent(contents, elementId, target)
            await cdp.clickAt(contents, finalTopPoint.x, finalTopPoint.y, false)
            trusted = true
            activation = 'native-pointer'
            prepared = finalSurface
          } catch (error) {
            const rescued = navigationRescue(contents, epochAtDispatch, urlAtDispatch, {
              trusted: true,
              activation: 'native-pointer',
            })
            if (rescued) return rescued
            throw new ToolError(
              `Native framed click dispatch failed (${getErrorMessage(error)}). The action was not retried because a partial pointer press may already have reached the page. Take a fresh snapshot before continuing.`
            )
          }
        } else {
          const activationKey = prepared.activationKey
          if (prepared.focusSucceeded === true && typeof activationKey === 'string') {
            // Observation probes above give the app time to open a modal, move a
            // virtualized row, or cover a still-focused control. Keyboard
            // activation can otherwise fire through that overlay, so repeat the
            // target's own hit test and then verify its exact embedding point.
            const focusedFrame = contents.focusedFrame
            if (!frameIsWithin(focusedFrame, targetFrame)) {
              throw new ToolError(
                'The requested frame control lost focus before activation. Take a fresh browser_snapshot and try again.'
              )
            }
            const focusStatus = await execInPage(target, activeElementSecrecy, [elementId]).catch(
              () => 'opaque'
            )
            if (focusStatus === 'secret' || focusStatus === 'opaque') {
              throw new ToolError(PASSWORD_REFUSAL)
            }
            if (focusStatus !== 'safe') {
              throw new ToolError(
                'The requested control lost focus before activation. Take a fresh browser_snapshot and try again.'
              )
            }
            try {
              assertCurrentExecution()
              assertElementActionCurrent(contents, elementId, target)
              await dispatchKeyCombo(contents, parseKeyCombo(activationKey))
              trusted = true
              activation = 'native-keyboard'
            } catch (error) {
              const uncertain = error instanceof KeyDispatchError && error.keyDownDispatched
              throw new ToolError(
                uncertain
                  ? 'The frame activation key-down may have reached the control, but dispatch did not complete. It was not retried; inspect the page and take a fresh snapshot before continuing.'
                  : `Trusted frame activation failed (${getErrorMessage(error)}). Take a fresh snapshot before retrying.`
              )
            }
          } else {
            assertCurrentExecution()
            assertElementActionCurrent(contents, elementId, target)
            let synthetic: unknown
            try {
              synthetic = unwrapPageResult(
                await execInPage(
                  target,
                  clickElement,
                  [elementId, true, false],
                  true,
                  executionDeadline
                )
              )
            } catch (error) {
              // A synchronous form-submit navigation destroys the context
              // before the dispatch's return value crosses the bridge.
              const rescued = navigationRescue(contents, epochAtDispatch, urlAtDispatch, {
                trusted: false,
                activation: 'synthetic',
              })
              if (rescued) return rescued
              throw error
            }
            if (!isRecordLike(synthetic) || synthetic.dispatched !== true) {
              const rescued = navigationRescue(contents, epochAtDispatch, urlAtDispatch, {
                trusted: false,
                activation: 'synthetic',
              })
              if (rescued) return rescued
              throw new ToolError('The frame did not confirm synthetic click dispatch.')
            }
          }
        }
      }
      await sleep(150)
      const afterElement = await activeElementState(target)
      const afterPage = await pageActionState(target, false, elementId)
      const afterTopPage = observeTopPage ? await pageActionState(contents) : afterPage
      const afterTopElement = observeTopPage ? await activeElementState(contents) : afterElement
      const observation = pageEffect(beforePage, afterPage, beforeElement, afterElement)
      const topObservation = observeTopPage
        ? pageEffect(beforeTopPage, afterTopPage, beforeTopElement, afterTopElement)
        : observation
      const activeTab = session.automationTab()
      const tabChanged = activeTab?.id !== clickedTab.id
      const effect = {
        ...observation.effect,
        ...(!observeTopPage
          ? {}
          : Object.fromEntries(
              Object.entries(topObservation.effect).map(([key, value]) => [
                `top${key[0].toUpperCase()}${key.slice(1)}`,
                value,
              ])
            )),
        tabChanged,
      }
      // Page-read URLs go blind when the click navigated and the origin
      // context died: the after-state reads {} and urlChanged computes false
      // for a maximally successful click. The driver-level epoch/URL survive
      // the teardown, so fold them in.
      const navigatedByDriver =
        !contents.isDestroyed() &&
        (navigationEpoch(contents) !== epochAtDispatch || contents.getURL() !== urlAtDispatch)
      const clickEffectObserved =
        observation.effect.urlChanged ||
        observation.effect.dialogChanged ||
        observation.effect.popupChanged ||
        observation.effect.targetChanged ||
        (prepared.editable === true && observation.effect.focusChanged)
      const topClickEffectObserved =
        observeTopPage &&
        (topObservation.effect.urlChanged ||
          topObservation.effect.dialogChanged ||
          topObservation.effect.popupChanged ||
          topObservation.effect.targetChanged)
      const effectObserved =
        clickEffectObserved || topClickEffectObserved || tabChanged || navigatedByDriver
      const possibleEffectObserved =
        observation.possibleEffectObserved ||
        topObservation.possibleEffectObserved ||
        tabChanged ||
        navigatedByDriver
      const dialogs = Array.from(
        new Set([
          ...(Array.isArray(afterPage.dialogs) ? afterPage.dialogs.map(String) : []),
          ...(Array.isArray(afterTopPage.dialogs) ? afterTopPage.dialogs.map(String) : []),
        ])
      )
      const navigated =
        observation.effect.urlChanged ||
        topObservation.effect.urlChanged ||
        tabChanged ||
        navigatedByDriver
      // Only a dialog that ARRIVED with the navigation obstructs it. Comparing
      // against the union of what was already open stops the false positive
      // that fires on every SPA route change under a persistent `role=dialog`
      // (a cookie banner, a side drawer, an emoji picker) — those are not
      // blocking anything, and reporting them made successful clicks read as
      // failures.
      const dialogsBefore = new Set([
        ...(Array.isArray(beforePage.dialogs) ? beforePage.dialogs.map(String) : []),
        ...(Array.isArray(beforeTopPage.dialogs) ? beforeTopPage.dialogs.map(String) : []),
      ])
      const newDialogs = dialogs.filter((dialog) => !dialogsBefore.has(dialog))
      const obstructedAfterNavigation = navigated && newDialogs.length > 0
      const notes: string[] = []
      if (obstructedAfterNavigation) {
        notes.push(`The page navigated, but a dialog opened above it (${newDialogs.join(', ')}).`)
      }
      if (!effectObserved) {
        notes.push(
          possibleEffectObserved
            ? 'Only background DOM/title churn followed the click; inspect the page before treating it as successful.'
            : 'No strong observable page change followed the click; inspect the page before treating it as successful.'
        )
      }
      return {
        dispatched: true,
        trusted,
        activation,
        element: prepared.element,
        refRecovered: prepared.refRecovered === true,
        effectObserved,
        possibleEffectObserved,
        effect,
        dialogs,
        obstructedAfterNavigation,
        ...(tabChanged && activeTab
          ? { activeTab: { tabId: activeTab.id, url: activeTab.view.webContents.getURL() } }
          : {}),
        ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
      }
    }

    case 'browser_type': {
      const elementId = requireNum(params, 'elementId')
      const text = requireStr(params, 'text')
      const submit = params.submit === true
      const contents = session.requireAutomationTab().view.webContents
      const target = pageTargetForElement(contents, elementId)
      const targetFrame = frameExecutionTarget(target, contents)

      // Native path: focus + select current content, then insert through the
      // IME pipeline so the text REPLACES what's there — the only write path
      // code editors (CodeMirror/Monaco) honor. The DOM selection set by the
      // page function covers plain fields; the real select-all keystroke
      // right after covers editors that track selection in their own model
      // (their keymaps handle it synchronously, where DOM-selection sync is
      // async and can lose a race with the insert). Falls back to the
      // synthetic value-setter when CDP is unavailable.
      assertCurrentExecution()
      assertElementActionCurrent(contents, elementId, target)
      // The settle grace covers a composer whose real contenteditable mounts a
      // beat after the surrounding view renders (Slack); nothing has been
      // dispatched yet, so reprobing is safe.
      const initialSurface = await prepareTypingSurface(
        target,
        elementId,
        true,
        executionDeadline,
        SETTLE_GRACE_MS
      )
      assertCurrentExecution()
      assertElementActionCurrent(contents, elementId, target)
      if (targetFrame) {
        await assertFrameEmbeddingVisible(
          targetFrame,
          pointFromPrepared(initialSurface),
          executionDeadline
        )
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
      }
      let trusted = true
      let nativeInserted = false
      let nativeInsertAttempted = false
      try {
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        await dispatchKeyCombo(
          contents,
          parseKeyCombo(process.platform === 'darwin' ? 'Cmd+A' : 'Control+A')
        )
        // The guard above vetted the element we asked to focus, but the insert
        // below goes wherever focus actually is now, a round trip later. Login
        // forms that auto-advance from username to password move it in exactly
        // that window, so re-check the real target before sending text.
        // Deliberately after the select-all rather than before it: this needs
        // to sit as close to the write as possible. The cost is that a field
        // which stole focus may end up with its contents selected — it is
        // never read, and nothing is inserted into it.
        const beforePage = await pageActionState(target, true, elementId)
        const beforeElement = await activeElementState(target)
        const beforeTopPage = targetFrame ? await pageActionState(contents, true) : beforePage
        const beforeTopElement = targetFrame ? await activeElementState(contents) : beforeElement
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        const finalSurface = await prepareTypingSurface(target, elementId, false, executionDeadline)
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        if (targetFrame) {
          await assertFrameEmbeddingVisible(
            targetFrame,
            pointFromPrepared(finalSurface),
            executionDeadline
          )
          assertCurrentExecution()
          assertElementActionCurrent(contents, elementId, target)
        }
        if (targetFrame && !frameIsWithin(contents.focusedFrame, targetFrame)) {
          throw new ToolError(
            'The requested field lost frame focus before text insertion. Take a fresh browser_snapshot and try again.'
          )
        }
        if (targetFrame) {
          // Parent-frame hit testing can trigger app work. Verify the exact
          // focused editable once more without moving focus, and refuse if its
          // child-frame point changed while the embedding was inspected.
          const finalFocusSurface = await prepareTypingSurface(
            target,
            elementId,
            false,
            executionDeadline
          )
          if (
            Math.abs((finalFocusSurface.x as number) - (finalSurface.x as number)) >= 1 ||
            Math.abs((finalFocusSurface.y as number) - (finalSurface.y as number)) >= 1
          ) {
            throw new ToolError(
              'The requested field moved before text insertion. Take a fresh browser_snapshot and try again.'
            )
          }
        }
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        nativeInsertAttempted = true
        await cdp.insertText(contents, text)
        nativeInserted = true

        let submitted = false
        let submitDispatched = false
        let submitUncertain = false
        let submissionEffectObserved = false
        let submitNote = ''
        if (submit) {
          // Establish a post-type baseline so a field value change cannot be
          // mistaken for proof that Enter submitted anything.
          await sleep(25)
          const beforeSubmitPage = await pageActionState(target, true, elementId)
          const beforeSubmitElement = await activeElementState(target)
          const beforeSubmitTopPage = targetFrame
            ? await pageActionState(contents, true)
            : beforeSubmitPage
          const beforeSubmitTopElement = targetFrame
            ? await activeElementState(contents)
            : beforeSubmitElement
          const frameStillFocused =
            !targetFrame || frameIsWithin(contents.focusedFrame, targetFrame)
          const submitFocus = frameStillFocused
            ? await execInPage(
                target,
                focusElementForTyping,
                [elementId, false],
                false,
                executionDeadline
              ).catch(() => null)
            : null
          const submitFocusError =
            isRecordLike(submitFocus) && typeof submitFocus.error === 'string'
              ? submitFocus.error
              : ''
          if (!isRecordLike(submitFocus) || submitFocus.focused !== true) {
            submitNote =
              submitFocusError === 'password' || !submitFocus
                ? 'Text was entered, but Enter was withheld because focus moved to an uninspectable or secret field.'
                : 'Text was entered, but Enter was withheld because the requested field lost focus.'
          } else {
            try {
              assertCurrentExecution()
              assertElementActionCurrent(contents, elementId, target)
              await dispatchKeyCombo(contents, parseKeyCombo('Enter'))
              submitDispatched = true
            } catch (error) {
              submitUncertain = error instanceof KeyDispatchError && error.keyDownDispatched
              submitNote = submitUncertain
                ? 'Enter key-down may have reached the page, but dispatch did not complete; submission is uncertain and was not retried.'
                : `Text was entered, but Enter dispatch failed (${getErrorMessage(error)}).`
            }
            await sleep(25)
            const afterSubmitElement = await activeElementState(target)
            const afterSubmitPage = await pageActionState(target, false, elementId)
            const submitObservation = pageEffect(
              beforeSubmitPage,
              afterSubmitPage,
              beforeSubmitElement,
              afterSubmitElement
            )
            const afterSubmitTopPage = targetFrame
              ? await pageActionState(contents)
              : afterSubmitPage
            const afterSubmitTopElement = targetFrame
              ? await activeElementState(contents)
              : afterSubmitElement
            const submitTopObservation = targetFrame
              ? pageEffect(
                  beforeSubmitTopPage,
                  afterSubmitTopPage,
                  beforeSubmitTopElement,
                  afterSubmitTopElement
                )
              : submitObservation
            submissionEffectObserved =
              submitObservation.effectObserved || submitTopObservation.effectObserved
            submitted = submitDispatched && submissionEffectObserved
          }
        }
        await sleep(50)
        const state = await activeElementState(target)
        const afterPage = await pageActionState(target, false, elementId)
        const observation = pageEffect(beforePage, afterPage, beforeElement, state)
        const afterTopPage = targetFrame ? await pageActionState(contents) : afterPage
        const afterTopElement = targetFrame ? await activeElementState(contents) : state
        const topObservation = targetFrame
          ? pageEffect(beforeTopPage, afterTopPage, beforeTopElement, afterTopElement)
          : observation
        const combinedObservation = {
          effectObserved: observation.effectObserved || topObservation.effectObserved,
          possibleEffectObserved:
            observation.possibleEffectObserved || topObservation.possibleEffectObserved,
          effect: {
            ...observation.effect,
            ...(targetFrame
              ? Object.fromEntries(
                  Object.entries(topObservation.effect).map(([key, value]) => [
                    `top${key[0].toUpperCase()}${key.slice(1)}`,
                    value,
                  ])
                )
              : {}),
          },
        }
        const notes: string[] = []
        if (submitNote) notes.push(submitNote)
        if (!combinedObservation.effectObserved) {
          notes.push(
            combinedObservation.possibleEffectObserved
              ? 'Only weak background churn followed the text dispatch; inspect the field before treating it as changed.'
              : 'The field readback did not change after text dispatch; inspect it before treating the type as successful.'
          )
        }
        return {
          dispatched: true,
          trusted,
          replacedExisting: true,
          submitRequested: submit,
          submitDispatched,
          submitted,
          submitUncertain,
          submissionEffectObserved,
          ...state,
          ...combinedObservation,
          ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
        }
      } catch (error) {
        // A refusal is a decision, not a CDP failure — it must not be retried
        // through the synthetic path.
        if (error instanceof ToolError) throw error
        if (nativeInserted) {
          throw new ToolError(
            `Text was inserted, but post-input verification failed (${getErrorMessage(error)}). The write was not retried; inspect the field before continuing.`
          )
        }
        if (nativeInsertAttempted) {
          throw new ToolError(
            `Native text dispatch did not acknowledge completion (${getErrorMessage(error)}). The write may have reached the field and was not retried; inspect it before continuing.`
          )
        }
        trusted = false
        const beforePage = await pageActionState(target, true, elementId)
        const beforeElement = await activeElementState(target)
        const beforeTopPage = targetFrame ? await pageActionState(contents, true) : beforePage
        const beforeTopElement = targetFrame ? await activeElementState(contents) : beforeElement
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        const fallbackSurface = await prepareElementSurface(target, elementId, executionDeadline)
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        if (targetFrame) {
          await assertFrameEmbeddingVisible(
            targetFrame,
            pointFromPrepared(fallbackSurface),
            executionDeadline
          )
          assertCurrentExecution()
          assertElementActionCurrent(contents, elementId, target)
        }
        const fallback = unwrapPageResult(
          await execInPage(
            target,
            typeIntoElement,
            [elementId, text, submit],
            true,
            executionDeadline
          )
        )
        if (!isRecordLike(fallback) || fallback.dispatched !== true) {
          throw new ToolError('Synthetic typing did not report a completed field write.')
        }
        await sleep(50)
        const state = await activeElementState(target)
        const afterPage = await pageActionState(target, false, elementId)
        const observation = pageEffect(beforePage, afterPage, beforeElement, state)
        const afterTopPage = targetFrame ? await pageActionState(contents) : afterPage
        const afterTopElement = targetFrame ? await activeElementState(contents) : state
        const topObservation = targetFrame
          ? pageEffect(beforeTopPage, afterTopPage, beforeTopElement, afterTopElement)
          : observation
        const combinedObservation = {
          effectObserved: observation.effectObserved || topObservation.effectObserved,
          possibleEffectObserved:
            observation.possibleEffectObserved || topObservation.possibleEffectObserved,
          effect: {
            ...observation.effect,
            ...(targetFrame
              ? Object.fromEntries(
                  Object.entries(topObservation.effect).map(([key, value]) => [
                    `top${key[0].toUpperCase()}${key.slice(1)}`,
                    value,
                  ])
                )
              : {}),
          },
        }
        return {
          ...fallback,
          trusted,
          ...state,
          ...combinedObservation,
          submitRequested: submit,
          submitDispatched: fallback.submitDispatched === true,
          submitted: false,
          submitUncertain: false,
          submissionEffectObserved: false,
          ...(!combinedObservation.effectObserved
            ? {
                note: 'Synthetic typing produced no strong field/page change; inspect before continuing.',
              }
            : submit
              ? {
                  note: 'Text changed and Enter was dispatched synthetically, but submission was not independently proven; inspect the page.',
                }
              : {}),
        }
      }
    }

    case 'browser_press_key': {
      const requestedKey = requireStr(params, 'key')
      const combo = parseKeyCombo(requestedKey)
      const contents = session.requireAutomationTab().view.webContents
      const pressedNavigationEpoch = navigationEpoch(contents)
      let target: PageExecutionTarget = focusedPageTarget(contents)
      let pressedFrameEpoch =
        target === contents ? undefined : frameNavigationEpoch(contents, target as WebFrameMain)
      // Pasting would move the user's clipboard into the page, where the next
      // snapshot reports it as an ordinary field value — clipboards routinely
      // hold a password copied out of a password manager. Copy and cut would
      // overwrite whatever the user had there.
      if (comboTouchesClipboard(combo)) {
        throw new ToolError(
          'Refusing to use a clipboard shortcut. The clipboard belongs to the user and may ' +
            'hold credentials. Use browser_type to enter text.'
        )
      }
      let beforePage = await pageActionState(target, true)
      let beforeElement = await activeElementState(target)
      // Focus can move while the two observation probes above run. Re-resolve
      // the actual focused frame and install a fresh baseline there if needed,
      // then make the secrecy probe the final round trip before CDP dispatch.
      const dispatchTarget = focusedPageTarget(contents)
      if (dispatchTarget !== target) {
        target = dispatchTarget
        pressedFrameEpoch =
          target === contents ? undefined : frameNavigationEpoch(contents, target as WebFrameMain)
        beforePage = await pageActionState(target, true)
        beforeElement = await activeElementState(target)
      }
      const pressTargetFrame = frameExecutionTarget(target, contents)
      const beforeTopPage = pressTargetFrame ? await pageActionState(contents, true) : beforePage
      const beforeTopElement = pressTargetFrame ? await activeElementState(contents) : beforeElement
      const secrecy = await execInPage(target, activeElementSecrecy, []).catch(() => 'opaque')
      if (secrecy === 'secret') {
        throw new ToolError(PASSWORD_REFUSAL)
      }
      const opaqueSafeKeys = new Set([
        'Escape',
        'Tab',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ])
      const safeForOpaqueFocus =
        opaqueSafeKeys.has(combo.key) && !combo.ctrl && !combo.meta && !combo.alt
      if (secrecy === 'opaque' && !safeForOpaqueFocus) {
        throw new ToolError(
          'Focus is inside a cross-origin frame whose contents cannot be inspected, so this ' +
            'keystroke could mutate or activate a password field. Call browser_request_takeover if the ' +
            'user needs to type here.'
        )
      }
      let trusted = true
      let fallbackState: Record<string, unknown> = {}
      try {
        assertCurrentExecution()
        assertActiveContents(contents, pressedNavigationEpoch)
        assertFocusedTargetUnchanged(contents, target, pressedFrameEpoch)
        await dispatchKeyCombo(contents, combo)
      } catch (error) {
        if (error instanceof KeyDispatchError && error.keyDownDispatched) {
          throw new ToolError(
            'The key-down may have reached the page but dispatch did not complete. The keystroke was not retried to avoid a duplicate action; inspect the page before continuing.'
          )
        }
        trusted = false
        // CDP unavailable (debugger detached): synthetic DOM fallback. It
        // cannot trigger default editing actions, so say so in the result.
        assertCurrentExecution()
        assertActiveContents(contents, pressedNavigationEpoch)
        assertFocusedTargetUnchanged(contents, target, pressedFrameEpoch)
        const fallbackSecrecy = await execInPage(target, activeElementSecrecy, []).catch(
          () => 'opaque'
        )
        if (fallbackSecrecy === 'secret') throw new ToolError(PASSWORD_REFUSAL)
        if (fallbackSecrecy === 'opaque' && !safeForOpaqueFocus) {
          throw new ToolError(
            'Focus became uninspectable before synthetic key dispatch; the key was withheld.'
          )
        }
        assertCurrentExecution()
        assertActiveContents(contents, pressedNavigationEpoch)
        assertFocusedTargetUnchanged(contents, target, pressedFrameEpoch)
        const fallback = unwrapPageResult(
          await execInPage(
            target,
            pressKeyOnPage,
            [combo.key, combo.code, combo.keyCode, combo.ctrl, combo.meta, combo.shift, combo.alt],
            true,
            executionDeadline
          )
        )
        if (
          !isRecordLike(fallback) ||
          fallback.pressed !== combo.key ||
          typeof fallback.target !== 'string'
        ) {
          throw new ToolError('The page did not confirm synthetic key dispatch.')
        }
        fallbackState = fallback
      }
      await sleep(150)
      const state = await activeElementState(target)
      const afterPage = await pageActionState(target)
      const observation = pageEffect(beforePage, afterPage, beforeElement, state)
      const afterTopPage = pressTargetFrame ? await pageActionState(contents) : afterPage
      const afterTopElement = pressTargetFrame ? await activeElementState(contents) : state
      const topObservation = pressTargetFrame
        ? pageEffect(beforeTopPage, afterTopPage, beforeTopElement, afterTopElement)
        : observation
      const combinedEffect = {
        ...observation.effect,
        ...(pressTargetFrame
          ? Object.fromEntries(
              Object.entries(topObservation.effect).map(([key, value]) => [
                `top${key[0].toUpperCase()}${key.slice(1)}`,
                value,
              ])
            )
          : {}),
      }
      const scrollKey =
        combo.key === 'PageUp' ||
        combo.key === 'PageDown' ||
        combo.key === 'ArrowUp' ||
        combo.key === 'ArrowDown' ||
        combo.key === 'Home' ||
        combo.key === 'End' ||
        combo.key === ' '
      const effectObserved =
        observation.effectObserved ||
        topObservation.effectObserved ||
        (scrollKey && (observation.effect.scrollChanged || topObservation.effect.scrollChanged))
      const possibleEffectObserved =
        effectObserved ||
        observation.possibleEffectObserved ||
        topObservation.possibleEffectObserved ||
        observation.effect.scrollChanged ||
        topObservation.effect.scrollChanged
      const dialogs = Array.from(
        new Set([
          ...(Array.isArray(afterPage.dialogs) ? afterPage.dialogs.map(String) : []),
          ...(Array.isArray(afterTopPage.dialogs) ? afterTopPage.dialogs.map(String) : []),
        ])
      )
      const notes: string[] = []
      if (!trusted) {
        notes.push('Delivered as a synthetic page event; editing shortcuts may not take effect.')
      }
      if (!effectObserved) {
        notes.push(
          observation.possibleEffectObserved
            ? 'Only background DOM/title churn followed the keystroke; the page may not support that shortcut.'
            : 'No strong observable page change followed the keystroke; the page may not support that shortcut.'
        )
      }
      return {
        ...fallbackState,
        pressed: requestedKey,
        primaryModifier: process.platform === 'darwin' ? 'Cmd' : 'Control',
        trusted,
        ...state,
        effect: combinedEffect,
        effectObserved,
        possibleEffectObserved,
        dialogs,
        ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
      }
    }

    case 'browser_scroll': {
      const contents = session.requireAutomationTab().view.webContents
      const elementId = num(params, 'elementId')
      const target =
        elementId !== undefined
          ? pageTargetForElement(contents, elementId)
          : focusedPageTarget(contents)
      const targetFrame = frameExecutionTarget(target, contents)
      assertCurrentExecution()
      if (elementId !== undefined) assertElementActionCurrent(contents, elementId, target)
      else assertActiveContents(contents)
      if (targetFrame) {
        await assertFrameEmbeddingVisible(targetFrame, undefined, executionDeadline)
        assertCurrentExecution()
        if (elementId !== undefined) assertElementActionCurrent(contents, elementId, target)
        else assertActiveContents(contents)
      }
      const scrolled = unwrapPageResult(
        await execInPage(
          target,
          scrollPage,
          [requireStr(params, 'direction'), num(params, 'amount'), elementId],
          false,
          executionDeadline
        )
      )
      if (
        !isRecordLike(scrolled) ||
        typeof scrolled.movedBy !== 'number' ||
        !Number.isFinite(scrolled.movedBy)
      ) {
        throw new ToolError('The page did not return a valid scroll result.')
      }
      return scrolled
    }

    case 'browser_select_option': {
      const contents = session.requireAutomationTab().view.webContents
      const elementId = requireNum(params, 'elementId')
      const target = pageTargetForElement(contents, elementId)
      const targetFrame = frameExecutionTarget(target, contents)
      assertCurrentExecution()
      assertElementActionCurrent(contents, elementId, target)
      let surface = await prepareElementSurface(target, elementId, executionDeadline)
      assertCurrentExecution()
      assertElementActionCurrent(contents, elementId, target)
      if (targetFrame) {
        await assertFrameEmbeddingVisible(
          targetFrame,
          pointFromPrepared(surface),
          executionDeadline
        )
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        // Parent-frame hit testing can itself trigger app work. Re-resolve the
        // target and verify the exact point once more immediately before the
        // DOM selection write.
        surface = await prepareElementSurface(target, elementId, executionDeadline)
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        await assertFrameEmbeddingVisible(
          targetFrame,
          pointFromPrepared(surface),
          executionDeadline
        )
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
      }
      const selected = unwrapPageResult(
        await execInPage(
          target,
          selectOptionInElement,
          [elementId, requireStr(params, 'value')],
          false,
          executionDeadline
        )
      )
      if (
        !isRecordLike(selected) ||
        typeof selected.selected !== 'string' ||
        typeof selected.value !== 'string'
      ) {
        throw new ToolError('The page did not confirm the requested dropdown selection.')
      }
      await sleep(50)
      const state = unwrapPageResult(await execInPage(target, readSelectElementState, [elementId]))
      const effectObserved =
        isRecordLike(state) &&
        selected.selected === state.selected &&
        selected.value === state.value
      return {
        ...selected,
        effectObserved,
        readback: state,
        ...(!effectObserved
          ? { note: 'The dropdown did not retain the requested option; inspect before continuing.' }
          : {}),
      }
    }

    case 'browser_hover': {
      const contents = session.requireAutomationTab().view.webContents
      const elementId = requireNum(params, 'elementId')
      const target = pageTargetForElement(contents, elementId)
      const targetFrame = frameExecutionTarget(target, contents)
      let beforePage = await pageActionState(target, true, elementId)
      let beforeElement = await activeElementState(target)
      let beforeTopPage = targetFrame ? await pageActionState(contents, true) : beforePage
      let beforeTopElement = targetFrame ? await activeElementState(contents) : beforeElement
      // Preparing the surface scrolls the element into view, so a baseline
      // taken before it always reports scrollChanged — the tool's own probe,
      // not the hover's effect. That pinned every unproductive hover to
      // "background churn" instead of the honest "nothing happened", and hid
      // real scrolling caused by the hover itself. Re-baseline once the scroll
      // has settled and before the pointer moves.
      const rebaseline = async (): Promise<void> => {
        beforePage = await pageActionState(target, true, elementId)
        beforeElement = await activeElementState(target)
        beforeTopPage = targetFrame ? await pageActionState(contents, true) : beforePage
        beforeTopElement = targetFrame ? await activeElementState(contents) : beforeElement
      }
      let trusted = false
      let result: unknown
      if (!targetFrame) {
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        let prepared = await prepareElementSurface(target, elementId, executionDeadline, true)
        await rebaseline()
        let stable = false
        for (let attempt = 0; attempt < 2; attempt++) {
          assertCurrentExecution()
          assertElementActionCurrent(contents, elementId, target)
          await cdp.moveMouse(contents, prepared.x as number, prepared.y as number)
          const checked = await prepareElementSurface(target, elementId, executionDeadline, true)
          stable =
            Math.abs((checked.x as number) - (prepared.x as number)) < 1 &&
            Math.abs((checked.y as number) - (prepared.y as number)) < 1
          prepared = checked
          if (stable) break
        }
        if (!stable) {
          throw new ToolError(
            'The hover target kept moving or was replaced. Take a fresh browser_snapshot and try again.'
          )
        }
        result = { hovered: true, element: prepared.element, refRecovered: prepared.refRecovered }
        trusted = true
      } else {
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        let surface = await prepareElementSurface(target, elementId, executionDeadline, true)
        await rebaseline()
        assertCurrentExecution()
        assertElementActionCurrent(contents, elementId, target)
        let embedding = await assertFrameEmbeddingVisible(
          targetFrame,
          pointFromPrepared(surface),
          executionDeadline
        )
        if (embedding.nativePointReliable && embedding.point) {
          let topPoint = embedding.point
          let stable = false
          for (let attempt = 0; attempt < 2; attempt++) {
            assertCurrentExecution()
            assertElementActionCurrent(contents, elementId, target)
            await cdp.moveMouse(contents, topPoint.x, topPoint.y)
            const checked = await prepareElementSurface(target, elementId, executionDeadline, true)
            embedding = await assertFrameEmbeddingVisible(
              targetFrame,
              pointFromPrepared(checked),
              executionDeadline
            )
            const checkedPoint = embedding.point
            stable = Boolean(
              embedding.nativePointReliable &&
                checkedPoint &&
                Math.abs(checkedPoint.x - topPoint.x) < 1 &&
                Math.abs(checkedPoint.y - topPoint.y) < 1
            )
            surface = checked
            if (checkedPoint) topPoint = checkedPoint
            if (stable) break
          }
          if (!stable) {
            throw new ToolError(
              'The framed hover target kept moving or was replaced. Take a fresh browser_snapshot and try again.'
            )
          }
          result = {
            hovered: true,
            element: surface.element,
            refRecovered: surface.refRecovered,
          }
          trusted = true
        } else {
          assertCurrentExecution()
          assertElementActionCurrent(contents, elementId, target)
          surface = await prepareElementSurface(target, elementId, executionDeadline, true)
          await assertFrameEmbeddingVisible(
            targetFrame,
            pointFromPrepared(surface),
            executionDeadline
          )
          assertCurrentExecution()
          assertElementActionCurrent(contents, elementId, target)
          result = unwrapPageResult(
            await execInPage(target, hoverElement, [elementId], true, executionDeadline)
          )
        }
      }
      if (!isRecordLike(result) || result.hovered !== true) {
        throw new ToolError('The page did not confirm hover dispatch.')
      }
      await sleep(150)
      const afterElement = await activeElementState(target)
      const afterPage = await pageActionState(target, false, elementId)
      const observation = pageEffect(beforePage, afterPage, beforeElement, afterElement)
      const afterTopPage = targetFrame ? await pageActionState(contents) : afterPage
      const afterTopElement = targetFrame ? await activeElementState(contents) : afterElement
      const topObservation = targetFrame
        ? pageEffect(beforeTopPage, afterTopPage, beforeTopElement, afterTopElement)
        : observation
      const effectObserved =
        observation.effect.urlChanged ||
        observation.effect.dialogChanged ||
        observation.effect.popupChanged ||
        observation.effect.targetChanged ||
        topObservation.effect.urlChanged ||
        topObservation.effect.dialogChanged ||
        topObservation.effect.popupChanged ||
        topObservation.effect.targetChanged
      const possibleEffectObserved =
        observation.possibleEffectObserved || topObservation.possibleEffectObserved
      const effect = {
        ...observation.effect,
        ...(targetFrame
          ? Object.fromEntries(
              Object.entries(topObservation.effect).map(([key, value]) => [
                `top${key[0].toUpperCase()}${key.slice(1)}`,
                value,
              ])
            )
          : {}),
      }
      return {
        ...result,
        trusted,
        effect,
        possibleEffectObserved,
        effectObserved,
        ...(!effectObserved
          ? {
              // A capped scan cannot claim nothing appeared: overlays are
              // commonly portalled to the END of <body>, which is exactly the
              // part a truncated walk misses. Say so instead of reporting a
              // partial look with full confidence.
              note:
                afterPage.observationTruncated === true ||
                afterTopPage.observationTruncated === true
                  ? 'This page is too large to scan completely, so a tooltip or menu that opened may not have been seen. Confirm with browser_snapshot or browser_screenshot before concluding the hover did nothing.'
                  : possibleEffectObserved
                    ? 'Only background DOM/title churn followed the hover; a tooltip/menu was not confirmed.'
                    : 'No tooltip, menu, focus, or other strong hover effect was observed.',
            }
          : {}),
      }
    }

    case 'browser_click_at': {
      const clickedTab = session.requireAutomationTab()
      const contents = clickedTab.view.webContents
      const x = requireNum(params, 'x')
      const y = requireNum(params, 'y')
      const clickCount = num(params, 'clickCount') ?? 1
      if (![1, 2, 3].includes(clickCount)) {
        throw new ToolError('clickCount must be 1 (click), 2 (double-click), or 3 (triple-click).')
      }
      const clickNavigationEpoch = navigationEpoch(contents)
      const urlAtDispatch = contents.getURL()
      assertCurrentExecution()
      assertActiveContents(contents)
      const pointTarget = unwrapPageResult(
        await execInPage(contents, describePointTarget, [x, y], false, executionDeadline)
      )
      if (!isRecordLike(pointTarget) || pointTarget.found !== true) {
        throw new ToolError(
          'Nothing is rendered at that point. Coordinates are CSS pixels in the current viewport — when reading them off a browser_screenshot, divide image pixels by its scale.'
        )
      }
      if (pointTarget.fileInput === true) {
        throw new ToolError(
          'Refusing to click a file input because it opens a native chooser the browser agent cannot inspect or complete. Ask the user to upload the file themselves.'
        )
      }
      const beforePage = await pageActionState(contents, true)
      const beforeElement = await activeElementState(contents)
      assertCurrentExecution()
      assertActiveContents(contents, clickNavigationEpoch)
      try {
        await cdp.clickAt(contents, x, y, true, clickCount)
      } catch (error) {
        const rescued = navigationRescue(contents, clickNavigationEpoch, urlAtDispatch, {
          trusted: true,
          activation: 'native-pointer',
        })
        if (rescued) return rescued
        throw new ToolError(
          `Native click dispatch failed (${getErrorMessage(error)}). The action was not retried because a partial pointer press may already have reached the page. Take a fresh snapshot before continuing.`
        )
      }
      await sleep(150)
      const afterElement = await activeElementState(contents)
      const afterPage = await pageActionState(contents)
      const observation = pageEffect(beforePage, afterPage, beforeElement, afterElement)
      const activeTab = session.automationTab()
      const tabChanged = activeTab?.id !== clickedTab.id
      // targetChanged is deliberately absent: this tool has no elementId, so
      // pageActionState captures no targetState and the term could only ever
      // be false. Listing it read as coverage this tool does not have.
      const effectObserved =
        observation.effect.urlChanged ||
        observation.effect.dialogChanged ||
        observation.effect.popupChanged ||
        (pointTarget.editable === true && observation.effect.focusChanged) ||
        tabChanged
      const dialogs = Array.isArray(afterPage.dialogs) ? afterPage.dialogs.map(String) : []
      const notes: string[] = []
      if (pointTarget.secret === true) {
        notes.push(
          'The point resolves to a password field. Focusing it is fine, but typing there is refused — call browser_request_takeover for credentials.'
        )
      }
      if (pointTarget.crossOriginFrame === true) {
        notes.push(
          'The point lands inside an embedded frame that could not be inspected; the click was dispatched but its target is unverified.'
        )
      }
      if (!effectObserved) {
        notes.push(
          observation.possibleEffectObserved || tabChanged
            ? 'Only background DOM/title churn followed the click; inspect the page before treating it as successful.'
            : 'No strong observable page change followed the click; inspect the page before treating it as successful.'
        )
      }
      return {
        dispatched: true,
        trusted: true,
        activation: 'native-pointer',
        clickedAt: { x, y },
        clickCount,
        target: pointTarget.element,
        targetCursor: pointTarget.cursor,
        effectObserved,
        possibleEffectObserved: observation.possibleEffectObserved || tabChanged,
        effect: { ...observation.effect, tabChanged },
        dialogs,
        ...(tabChanged && activeTab
          ? { activeTab: { tabId: activeTab.id, url: activeTab.view.webContents.getURL() } }
          : {}),
        ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
      }
    }

    case 'browser_insert_text': {
      const text = requireStr(params, 'text')
      const submit = params.submit === true
      const contents = session.requireAutomationTab().view.webContents
      const insertNavigationEpoch = navigationEpoch(contents)
      const target: PageExecutionTarget = focusedPageTarget(contents)
      const secrecy = await execInPage(target, activeElementSecrecy, []).catch(() => 'opaque')
      if (secrecy === 'secret') throw new ToolError(PASSWORD_REFUSAL)
      if (secrecy === 'opaque') {
        throw new ToolError(
          'Focus is inside a cross-origin frame whose contents cannot be inspected, so this ' +
            'insertion could reach a password field. Call browser_request_takeover if the user needs to type here.'
        )
      }
      const focusState = unwrapPageResult(
        await execInPage(target, describeFocusedEditable, [], false, executionDeadline)
      )
      if (!isRecordLike(focusState) || focusState.editable !== true) {
        const reason = isRecordLike(focusState) ? String(focusState.reason || '') : ''
        // Name the element that actually held focus. Without it the agent
        // cannot tell "I focused the wrong thing" from "this tool cannot type
        // here", and it retries variations of the same failing approach.
        const focused = isRecordLike(focusState)
          ? [
              focusState.focusedTag ? `<${String(focusState.focusedTag)}>` : '',
              focusState.focusedRole ? `role="${String(focusState.focusedRole)}"` : '',
              focusState.contentEditable && focusState.contentEditable !== 'unset'
                ? `contenteditable="${String(focusState.contentEditable)}"`
                : '',
            ]
              .filter(Boolean)
              .join(' ')
          : ''
        throw new ToolError(
          reason === 'none'
            ? 'No element is focused. Click the field first (browser_click or browser_click_at), then insert text.'
            : `The focused element does not accept text${reason ? ` (${reason})` : ''}${
                focused ? `; focus is on ${focused}` : ''
              }. Click the field you want to type into, then insert text.`
        )
      }
      const beforePage = await pageActionState(target, true)
      const beforeElement = await activeElementState(target)
      // Observe the TOP document too when typing inside a frame. A submit that
      // navigates the top page is invisible to a frame-scoped observation, so a
      // successful send reported effectObserved: false. Newly reachable now
      // that the focus check descends into frames at all.
      const insertInFrame = target !== contents
      const beforeTopPage = insertInFrame ? await pageActionState(contents, true) : beforePage
      assertCurrentExecution()
      assertActiveContents(contents, insertNavigationEpoch)
      assertFocusedTargetUnchanged(contents, target)
      try {
        await cdp.insertText(contents, text)
      } catch (error) {
        throw new ToolError(
          `Native text insertion failed (${getErrorMessage(error)}). Take a fresh snapshot before retrying.`
        )
      }
      let submitDispatched = false
      if (submit) {
        await sleep(25)
        assertCurrentExecution()
        assertActiveContents(contents, insertNavigationEpoch)
        try {
          await dispatchKeyCombo(contents, parseKeyCombo('Enter'))
          submitDispatched = true
        } catch {
          // Reported below through submitDispatched: false.
        }
      }
      await sleep(150)
      const state = await activeElementState(target)
      const afterPage = await pageActionState(target)
      const observation = pageEffect(beforePage, afterPage, beforeElement, state)
      const topObservation = insertInFrame
        ? pageEffect(beforeTopPage, await pageActionState(contents, true), beforeElement, state)
        : observation
      // targetChanged is deliberately absent: this tool has no elementId, so
      // pageActionState captures no targetState and the term could only ever
      // be false. Listing it read as coverage this tool does not have.
      const effectObserved =
        observation.effect.fieldChanged ||
        observation.effect.urlChanged ||
        observation.effect.dialogChanged ||
        topObservation.effect.urlChanged ||
        topObservation.effect.dialogChanged
      return {
        dispatched: true,
        trusted: true,
        kind: focusState.kind,
        insertedChars: text.length,
        ...state,
        effectObserved,
        possibleEffectObserved: observation.possibleEffectObserved,
        effect: observation.effect,
        submitRequested: submit,
        submitDispatched,
        ...(focusState.kind === 'canvas' || focusState.kind === 'textbox-role'
          ? {
              note: 'The focused editor is canvas/model-backed, so field readback cannot confirm the text — verify visually with browser_screenshot.',
            }
          : !effectObserved
            ? {
                note: 'Insertion produced no observable field or page change; inspect the page before continuing.',
              }
            : {}),
      }
    }

    case 'browser_drag': {
      const draggedTab = session.requireAutomationTab()
      const contents = draggedTab.view.webContents
      const dragNavigationEpoch = navigationEpoch(contents)

      const resolveEndpoint = async (
        which: 'from' | 'to'
      ): Promise<{ x: number; y: number; element?: string }> => {
        const elementId = num(params, `${which}ElementId`)
        if (elementId !== undefined) {
          const target = pageTargetForElement(contents, elementId)
          if (frameExecutionTarget(target, contents)) {
            throw new ToolError(
              `Dragging elements inside embedded frames is not supported. Use ${which}X/${which}Y viewport coordinates instead.`
            )
          }
          const prepared = unwrapPageResult(
            await execInPageWithSettleGrace(
              target,
              clickElement,
              [elementId, false, false],
              executionDeadline
            )
          )
          if (
            !isRecordLike(prepared) ||
            typeof prepared.x !== 'number' ||
            typeof prepared.y !== 'number'
          ) {
            throw new ToolError(`Could not resolve the ${which} element for the drag.`)
          }
          return {
            x: prepared.x,
            y: prepared.y,
            ...(typeof prepared.element === 'string' ? { element: prepared.element } : {}),
          }
        }
        const pointX = num(params, `${which}X`)
        const pointY = num(params, `${which}Y`)
        if (pointX === undefined || pointY === undefined) {
          throw new ToolError(
            `Provide either ${which}ElementId or both ${which}X and ${which}Y for the drag ${which === 'from' ? 'source' : 'target'}.`
          )
        }
        const probe = unwrapPageResult(
          await execInPage(
            contents,
            describePointTarget,
            [pointX, pointY],
            false,
            executionDeadline
          )
        )
        if (!isRecordLike(probe) || probe.found !== true) {
          throw new ToolError(
            `Nothing is rendered at the ${which} point. Coordinates are CSS pixels in the current viewport — when reading them off a browser_screenshot, divide image pixels by its scale.`
          )
        }
        return {
          x: pointX,
          y: pointY,
          ...(typeof probe.element === 'string' ? { element: probe.element } : {}),
        }
      }

      assertCurrentExecution()
      assertActiveContents(contents)
      const from = await resolveEndpoint('from')
      const to = await resolveEndpoint('to')
      if (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1) {
        throw new ToolError('The drag source and target are the same point; nothing to drag.')
      }
      const beforePage = await pageActionState(contents, true)
      const beforeElement = await activeElementState(contents)
      assertCurrentExecution()
      assertActiveContents(contents, dragNavigationEpoch)
      let interception: { nativeDragIntercepted: boolean }
      try {
        interception = await cdp.dragPointer(contents, from, to)
      } catch (error) {
        throw new ToolError(
          `Native drag dispatch failed (${getErrorMessage(error)}). The pointer may have been mid-drag; take a fresh snapshot to see the page's current state before retrying.`
        )
      }
      await sleep(200)
      const afterElement = await activeElementState(contents)
      const afterPage = await pageActionState(contents)
      const observation = pageEffect(beforePage, afterPage, beforeElement, afterElement)
      // targetChanged is deliberately absent: this tool has no elementId, so
      // pageActionState captures no targetState and the term could only ever be
      // false. domChanged IS trusted here — unlike every other tool — because a
      // drop that reorders a list may change nothing else observable.
      const effectObserved =
        observation.effect.domChanged ||
        observation.effect.urlChanged ||
        observation.effect.dialogChanged ||
        observation.effect.scrollChanged
      const dialogs = Array.isArray(afterPage.dialogs) ? afterPage.dialogs.map(String) : []
      return {
        dispatched: true,
        trusted: true,
        nativeHtml5Drag: interception.nativeDragIntercepted,
        from,
        to,
        effectObserved,
        possibleEffectObserved: observation.possibleEffectObserved,
        effect: observation.effect,
        dialogs,
        ...(!effectObserved
          ? {
              note: 'No observable page change followed the drag. Verify with browser_snapshot or browser_screenshot; some drop targets only commit on their own animation frame.',
            }
          : {}),
      }
    }

    case 'browser_request_takeover': {
      // The reason renders in the chat's tool row, not here — but require it
      // so the model always tells the user why control was handed over.
      requireStr(params, 'reason')
      return await runTakeover(str(params, 'purpose'), invocationEpoch)
    }

    default: {
      const exhaustive: never = tool
      throw new ToolError(`Unknown tool: ${String(exhaustive)}`)
    }
  }
}

/**
 * Attaches auto-handled page-state notices (currently dismissed dialogs) to
 * the outgoing result so the model learns what happened without a dedicated
 * tool.
 */
function withNotices(result: unknown): unknown {
  const state = driverScopeState()
  if (state.pendingNotices.length === 0) return result
  const notices = state.pendingNotices
  state.pendingNotices = []
  if (isRecordLike(result)) {
    return { ...(result as Record<string, unknown>), notices }
  }
  return { value: result, notices }
}

export async function executeTool(
  scopeId: string,
  tool: BrowserToolName,
  params: Record<string, unknown>,
  toolCallId?: string,
  authorizationBoundary?: BrowserToolQueueBoundary
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const resolvedScopeId = resolveDriverScopeId(scopeId)
  if (session.isBrowserScopeSuspended(resolvedScopeId)) {
    return {
      ok: false,
      error: 'This task browser is suspended until the task is reopened.',
    }
  }
  const state = driverScopeState(resolvedScopeId)
  state.activationOnly = false
  const invocationEpoch = ++state.toolInvocationEpoch
  const queueCancellationEpoch = state.toolQueueCancellationEpoch
  const run = async () => {
    if (
      (authorizationBoundary && !isBrowserToolQueueBoundaryCurrent(authorizationBoundary)) ||
      queueCancellationEpoch !== state.toolQueueCancellationEpoch ||
      isToolCallCancelled(toolCallId)
    ) {
      throw new ToolError('This browser action was cancelled before it started.')
    }
    state.activeToolCallId = toolCallId ?? null
    let cancelActiveExecution: () => void = () => {}
    const cancellation = new Promise<never>((_resolve, reject) => {
      cancelActiveExecution = () => reject(new ToolError('This browser action was cancelled.'))
    })
    state.activeToolCancel = cancelActiveExecution
    return await session.withBrowserScope(resolvedScopeId, async () => {
      logger.info('Executing browser tool', { tool, scopeId: resolvedScopeId })
      const keepHiddenPageActive = tool !== 'browser_request_takeover'
      if (keepHiddenPageActive) {
        session.setAutomationActive(true)
      }
      try {
        const executionEpoch = ++state.toolExecutionEpoch
        const watchdogMs = browserToolWatchdogMs(tool, params)
        const executionDeadline = watchdogMs === null ? undefined : Date.now() + watchdogMs
        const assertCurrentExecution = () => {
          if (state.toolExecutionEpoch !== executionEpoch) {
            throw new ToolError('This browser action expired before it could dispatch input.')
          }
        }
        const execution = executeToolInner(
          tool,
          params,
          assertCurrentExecution,
          executionDeadline,
          invocationEpoch
        )
        const guardedExecution =
          watchdogMs === null
            ? execution
            : raceAgainstWatchdog(execution, watchdogMs, () => {
                if (state.toolExecutionEpoch === executionEpoch) state.toolExecutionEpoch++
                if (tool === 'browser_snapshot' || tool === 'browser_open_url') {
                  invalidateSnapshot(state)
                }
              })
        return withNotices(await Promise.race([guardedExecution, cancellation]))
      } finally {
        if (keepHiddenPageActive) {
          session.setAutomationActive(false)
        }
        if (state.activeToolCancel === cancelActiveExecution) {
          state.activeToolCallId = null
          state.activeToolCancel = null
        }
      }
    })
  }

  const settled = state.toolQueue.then(run, run)
  state.toolQueue = settled.catch(() => {})
  try {
    return { ok: true, result: sanitizeBrowserResult(await settled) }
  } catch (error) {
    // The watchdog cannot cancel an in-flight renderer promise. Invalidate its
    // capture token before releasing the queue so a late snapshot cannot
    // overwrite refs belonging to a newer tab or snapshot.
    if (tool === 'browser_snapshot' || tool === 'browser_open_url') {
      invalidateSnapshot(state)
    }
    const message = String(sanitizeBrowserResult(getErrorMessage(error), undefined, 0, 'error'))
    logger.warn('Browser tool failed', { tool, error: message })
    return { ok: false, error: message }
  }
}

/**
 * Cancels one exact browser tool, including a cancellation that arrives while
 * its authorization IPC is still in flight. The bounded tombstone lets that
 * later invocation observe the stop without retaining call ids indefinitely.
 */
export function cancelTool(scopeId: string, toolCallId: string): boolean {
  pruneCancelledToolCallIds()
  cancelledToolCallIds.set(toolCallId, Date.now() + CANCELLED_TOOL_TTL_MS)
  pruneCancelledToolCallIds()

  const resolvedScopeId = resolveDriverScopeId(scopeId)
  const state = driverScopeStates.get(resolvedScopeId)
  if (!state || state.activeToolCallId !== toolCallId) return true

  state.toolInvocationEpoch++
  state.toolExecutionEpoch++
  state.activeToolCancel?.()
  void session.withBrowserScope(resolvedScopeId, () => {
    session.setAutomationActive(false)
    session.setAutomationNeedsAttention(false)
  })
  return true
}

/** Cancels the active tool and every older invocation already queued for this scope. */
export function cancelActiveTool(scopeId: string): boolean {
  const resolvedScopeId = resolveDriverScopeId(scopeId)
  const state = driverScopeStates.get(resolvedScopeId)
  if (!state) return false
  state.toolQueueCancellationEpoch++
  const toolCallId = state.activeToolCallId
  return toolCallId ? cancelTool(resolvedScopeId, toolCallId) : false
}

/** Browser-chrome commands from the panel header; fire-and-forget. */
export async function handlePanelAction(
  scopeId: string,
  action: BrowserPanelAction
): Promise<void> {
  const resolvedScopeId = resolveDriverScopeId(scopeId)
  if (session.isBrowserScopeSuspended(resolvedScopeId)) return
  return await session.withBrowserScope(resolvedScopeId, async () => {
    // The question card on the chat's takeover tool row hands control back to the
    // agent. Meaningful only while a takeover is actually waiting.
    if (action.action === 'takeover-done') {
      const state = driverScopeState()
      if (state.takeoverActive) {
        session.returnAutomationTabToAgent()
        state.takeoverResponse =
          typeof action.takeoverResponse === 'string' && action.takeoverResponse.trim()
            ? action.takeoverResponse.trim()
            : null
        state.takeoverDone = true
      }
      return
    }
    // Navigate bootstraps the session: the user can open the panel manually
    // (before the agent ever touched the browser) and drive it from the URL
    // bar. The other chrome actions need an existing page.
    if (action.action === 'navigate') {
      if (typeof action.url === 'string' && /^https?:\/\//i.test(action.url)) {
        session.claimActiveTabForUser()
        const contents = session.ensureTab().view.webContents
        void contents.loadURL(action.url).catch(() => {})
      }
      return
    }
    if (action.action === 'new-tab') {
      session.addTab()
      return
    }
    if (action.action === 'duplicate-tab') {
      if (typeof action.tabId === 'string') {
        session.duplicateTab(action.tabId)
      }
      return
    }
    if (action.action === 'switch-tab') {
      if (typeof action.tabId === 'string') {
        session.switchTab(action.tabId)
      }
      return
    }
    if (action.action === 'close-tab') {
      if (typeof action.tabId === 'string') {
        session.closeTab(action.tabId)
      }
      return
    }
    session.claimActiveTabForUser()
    const tab = session.activeTab()
    if (!tab) return
    const contents = tab.view.webContents
    switch (action.action) {
      case 'reload':
        session.reloadPage(contents)
        return
      case 'back':
        session.goBack(contents)
        return
      case 'forward':
        session.goForward(contents)
        return
      case 'print':
        contents.print({ printBackground: true })
        return
      case 'zoom-in':
        contents.setZoomFactor(steppedZoomFactor(contents.getZoomFactor(), 1))
        return
      case 'zoom-out':
        contents.setZoomFactor(steppedZoomFactor(contents.getZoomFactor(), -1))
        return
      case 'zoom-reset':
        contents.setZoomFactor(session.getBrowserDefaultZoomFactor())
        return
      default:
        return
    }
  })
}
