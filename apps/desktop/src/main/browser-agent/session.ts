import { AsyncLocalStorage } from 'node:async_hooks'
import { join } from 'node:path'
import type {
  BrowserDataKind,
  BrowserFindRequest,
  BrowserFindResult,
  BrowserOmniboxFocusMode,
  BrowserTabState,
  BrowserTabsState,
  BrowserTheme,
} from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { BrowserWindow, CookiesSetDetails, Input, Session, WebContents } from 'electron'
import { session as electronSession, nativeTheme, WebContentsView } from 'electron'
import { attachAgentContextMenu, BASE_ZOOM_FACTOR } from '@/main/browser-agent/context-menu'
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

const logger = createLogger('BrowserAgentSession')

/** Dedicated cookie jar for the agent browser; `persist:` = survives restarts. */
const AGENT_PARTITION = 'persist:sim-browser-agent'

class SessionError extends Error {}

export interface AgentTab {
  id: string
  scopeId?: string
  view: WebContentsView
  pinned: boolean
  pendingRestoreUrl?: string
}

export interface PinnedTabPersistence {
  load: () => unknown
  save: (urls: string[]) => void
  /** Forces a migrated legacy value to disk before another chat can claim it. */
  flush?: () => boolean | undefined
}

export interface BrowserSessionSnapshotV1 {
  v: 1
  tabs: Array<{
    url: string
    pinned: boolean
  }>
  activeIndex: number
}

export interface BrowserSessionPersistence {
  load: (scopeId: string) => unknown
  save: (scopeId: string, snapshot: BrowserSessionSnapshotV1) => boolean | undefined
  migrateScope: (fromScopeId: string, toScopeId: string) => boolean | undefined
  /** Synchronously confirms a durable write before retiring legacy fallback data. */
  flush?: () => boolean | undefined
  disposeScope?: (scopeId: string) => void
}

export interface AgentSessionEvents {
  /** The browser session ended (all tabs gone). */
  onSessionClosed: () => void
  /** A newly created tab's WebContents, for the driver to instrument. */
  onTabCreated: (contents: WebContents) => void
  /**
   * A tab navigated, including in-page. Anything bound to the previous
   * document — notably a pending credential fill — must be invalidated.
   */
  onTabNavigated: (contents: WebContents) => void
  /** A tab's WebContents is going away, so per-tab state can be dropped. */
  onTabClosed: (contents: WebContents) => void
  /** The active tab changed (new tab, switch, close). */
  onActiveTabChanged: (contents: WebContents) => void
  /** The tab list or active tab changed. */
  onTabsChanged: () => void
  /** Sim's appearance preference changed for an existing tab. */
  onTabThemeChanged: (contents: WebContents, theme: BrowserTheme) => void
  /** A download was blocked on the agent partition. */
  onDownloadBlocked: (filename: string, url: string) => void
}

/**
 * Bounds reports are a LEASE, not a one-shot: the renderer re-reports the
 * panel rect continuously while the panel is visible, and the view is hidden
 * when the lease expires. This is the liveness guard — a renderer that
 * reloads, crashes, or hard-navigates never gets to send "hide", so the view
 * must never outlive the reports.
 */
const MAX_RECENTLY_CLOSED_TABS = 10

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

export const LEGACY_BROWSER_SCOPE = 'legacy'

interface BrowserScopeState {
  tabs: AgentTab[]
  recentlyClosedTabUrls: string[]
  activeTabId: string | null
  nextTabId: number
  /** True until anything beyond scope activation inspects or materializes this state. */
  activationOnly: boolean
  restored: boolean
  restoring: boolean
  lastPersistedSnapshot: string | null
  focusedBrowserTabId: string | null
  focusedBrowserClearTimer: ReturnType<typeof setTimeout> | null
  automationActive: boolean
  findingTabId: string | null
}

function createBrowserScopeState(): BrowserScopeState {
  return {
    tabs: [],
    recentlyClosedTabUrls: [],
    activeTabId: null,
    nextTabId: 1,
    activationOnly: true,
    restored: false,
    restoring: false,
    lastPersistedSnapshot: null,
    focusedBrowserTabId: null,
    focusedBrowserClearTimer: null,
    automationActive: false,
    findingTabId: null,
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
let activeBrowserScopeId = LEGACY_BROWSER_SCOPE

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
  return resolveBrowserScopeId(browserScopeStorage.getStore() ?? activeBrowserScopeId)
}

export function getActiveBrowserScopeId(): string {
  return resolveBrowserScopeId(activeBrowserScopeId)
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
let legacyPinnedTabPersistence: PinnedTabPersistence | null = null
let legacyPinnedFallbackClaimedBy: string | null = null
let legacyPinnedFallbackPersistedFor: string | null = null
/** Raw Sim preference; `system` remains dynamic as the OS theme changes. */
let browserTheme: BrowserTheme = 'system'

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
  activeBrowserScopeId = LEGACY_BROWSER_SCOPE
  browserSessionPersistence = null
  legacyPinnedTabPersistence = null
  legacyPinnedFallbackClaimedBy = null
  legacyPinnedFallbackPersistedFor = null
  browserTheme = 'system'
  activatePanelScope(LEGACY_BROWSER_SCOPE)
}

export function initSession(
  handlers: AgentSessionEvents,
  mainWindowProvider: () => BrowserWindow | null,
  legacyPersistence?: PinnedTabPersistence,
  persistence?: BrowserSessionPersistence
): void {
  resetSessionState()
  events = handlers
  getMainWindow = mainWindowProvider
  legacyPinnedTabPersistence = legacyPersistence ?? null
  browserSessionPersistence = persistence ?? null
  initPanel({
    getMainWindow: () => getMainWindow(),
    activeTab: () => withBrowserScope(getActiveBrowserScopeId(), activeTab),
    ensureInitialTab: () => {
      withBrowserScope(getActiveBrowserScopeId(), () => {
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

function isDurableBrowserScope(scopeId: string): boolean {
  return scopeId !== LEGACY_BROWSER_SCOPE && !scopeId.startsWith('pending:')
}

function clearLegacyPinnedFallback(adoptedByScopeId: string): boolean {
  if (!legacyPinnedTabPersistence || !isDurableBrowserScope(adoptedByScopeId)) return false
  try {
    legacyPinnedTabPersistence.save([])
    if (legacyPinnedTabPersistence.flush?.() === false) return false
    legacyPinnedFallbackClaimedBy = adoptedByScopeId
    return true
  } catch (error) {
    logger.warn('Could not clear migrated legacy pinned browser tabs', {
      error: getErrorMessage(error),
    })
    return false
  }
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
export function isActivationOnlyBrowserScope(scopeId: string): boolean {
  const state = browserScopeStates.get(resolveBrowserScopeId(scopeId))
  return (
    state?.activationOnly === true &&
    state.tabs.length === 0 &&
    state.recentlyClosedTabUrls.length === 0 &&
    state.activeTabId === null &&
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

  let persistedMigrationSucceeded = false
  try {
    if (browserSessionPersistence) {
      const migrated = browserSessionPersistence.migrateScope(from, to)
      if (migrated === false) return false
      persistedMigrationSucceeded = true
    }
  } catch (error) {
    logger.warn('Could not migrate persisted browser chat session', {
      error: getErrorMessage(error),
    })
  }
  if (
    persistedMigrationSucceeded &&
    legacyPinnedFallbackClaimedBy === from &&
    legacyPinnedFallbackPersistedFor === from
  ) {
    legacyPinnedFallbackClaimedBy = to
    legacyPinnedFallbackPersistedFor = to
    if (flushBrowserSessionPersistence()) clearLegacyPinnedFallback(to)
  }
  if (state) {
    browserScopeStates.delete(from)
    if (destinationState) browserScopeStates.delete(to)
    browserScopeStates.set(to, state)
    for (const tab of state.tabs) tab.scopeId = to
  } else if (destinationState) {
    browserScopeStates.delete(to)
  }
  browserScopeAliases.set(from, to)
  if (resolveBrowserScopeId(activeBrowserScopeId) === to || activeBrowserScopeId === from) {
    activeBrowserScopeId = to
  }
  migratePanelScope(from, to)
  return true
}

/** Destroys one chat's live browser state without touching the shared profile. */
export function disposeBrowserScope(scopeId: string): void {
  const resolved = resolveBrowserScopeId(scopeId)
  // A migrated provisional id is only an alias. Disposing that spelling must
  // never destroy the durable chat state it now points at.
  if (resolved !== scopeId) {
    browserScopeAliases.delete(scopeId)
    suspendedBrowserScopes.delete(scopeId)
    try {
      browserSessionPersistence?.disposeScope?.(scopeId)
    } catch (error) {
      logger.warn('Could not dispose persisted browser chat session', {
        error: getErrorMessage(error),
      })
    }
    return
  }

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
    browserSessionPersistence?.disposeScope?.(resolved)
  } catch (error) {
    logger.warn('Could not dispose persisted browser chat session', {
      error: getErrorMessage(error),
    })
  }
  if (legacyPinnedFallbackClaimedBy === resolved) {
    legacyPinnedFallbackClaimedBy = null
    legacyPinnedFallbackPersistedFor = null
  }

  if (getActiveBrowserScopeId() === resolved) {
    activeBrowserScopeId = LEGACY_BROWSER_SCOPE
    activatePanelScope(LEGACY_BROWSER_SCOPE)
  }
}

/**
 * Saves and tears down one durable chat's live views without deleting its
 * descriptor. Reopening the chat creates fresh WebContents from that snapshot.
 *
 * No empty-strip/session-closed events are published: soft deletion removes
 * the resource's UI separately, and those events would overwrite its retained
 * renderer descriptor before the chat can be restored.
 */
export function suspendBrowserScope(scopeId: string): boolean {
  const resolved = resolveBrowserScopeId(scopeId)
  const state = browserScopeStates.get(resolved)
  if (!state) {
    suspendedBrowserScopes.add(resolved)
    return true
  }

  let persisted = true
  withBrowserScope(resolved, () => {
    if (hasSession()) persisted = persistBrowserSession()
    if (persisted) closeLiveTabs()
  })
  if (!persisted) return false

  suspendedBrowserScopes.add(resolved)
  browserScopeStates.delete(resolved)
  if (getActiveBrowserScopeId() === resolved) {
    activeBrowserScopeId = LEGACY_BROWSER_SCOPE
    activatePanelScope(LEGACY_BROWSER_SCOPE)
  }
  return true
}

/**
 * Accepts only what is safe to navigate back to later: http(s), no embedded
 * credentials, bounded length. Shared by the pinned-tab list and the
 * closed-tab list, both of which outlive the tab they came from and so must
 * not be able to revive a `user:pass@host` URL.
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

function sanitizePinnedTabUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const urls: string[] = []
  for (const candidate of value) {
    const url = sanitizeRestorableUrl(candidate)
    if (url !== null) urls.push(url)
  }
  return urls
}

function tabUrl(tab: AgentTab): string {
  return tab.pendingRestoreUrl || tab.view.webContents.getURL() || 'about:blank'
}

function sanitizeBrowserSessionSnapshot(value: unknown): BrowserSessionSnapshotV1 | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as {
    v?: unknown
    tabs?: unknown
    activeIndex?: unknown
  }
  if (raw.v !== 1 || !Array.isArray(raw.tabs)) return null

  const restoredTabs: BrowserSessionSnapshotV1['tabs'] = []
  for (const candidate of raw.tabs) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const entry = candidate as { url?: unknown; pinned?: unknown }
    const url = sanitizeRestorableUrl(entry.url)
    if (url === null) continue
    restoredTabs.push({ url, pinned: entry.pinned === true })
  }

  const requestedIndex =
    typeof raw.activeIndex === 'number' && Number.isFinite(raw.activeIndex)
      ? Math.trunc(raw.activeIndex)
      : 0
  return {
    v: 1,
    tabs: restoredTabs,
    activeIndex:
      restoredTabs.length === 0
        ? -1
        : Math.max(0, Math.min(restoredTabs.length - 1, requestedIndex)),
  }
}

function browserSessionSnapshot(): BrowserSessionSnapshotV1 {
  const liveTabs = tabs.filter((tab) => !tab.view.webContents.isDestroyed())
  const activeIndex = liveTabs.findIndex((tab) => tab.id === currentScope.activeTabId)
  return {
    v: 1,
    tabs: liveTabs.map((tab) => ({ url: tabUrl(tab), pinned: tab.pinned })),
    activeIndex,
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
    if (browserSessionPersistence) {
      const saved = browserSessionPersistence.save(getBrowserScopeId(), snapshot)
      if (saved === false) return false
      if (legacyPinnedFallbackClaimedBy === getBrowserScopeId()) {
        legacyPinnedFallbackPersistedFor = getBrowserScopeId()
      }
    } else {
      // Compatibility for callers that have not installed the scoped store yet.
      legacyPinnedTabPersistence?.save(
        snapshot.tabs.filter((tab) => tab.pinned).map((tab) => tab.url)
      )
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

function flushBrowserSessionPersistence(): boolean {
  if (!browserSessionPersistence?.flush) return true
  try {
    return browserSessionPersistence.flush() !== false
  } catch (error) {
    logger.warn('Could not flush persisted browser chat sessions', {
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
 * Default-deny hardening for the agent partition: no permission grants of any
 * kind, and downloads are cancelled (and surfaced to the driver) rather than
 * silently dropped on disk.
 */
function configureAgentPartition(ses: Session): void {
  if (configuredPartitions.has(ses)) return
  configuredPartitions.add(ses)
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  // SSRF choke point for the agent partition. Document navigations (top-level +
  // iframes) get the full DNS-resolving check — the one seam every navigation
  // passes through, including page-initiated ones the driver never sees (server
  // redirects, link clicks, location.href, meta-refresh) — so an internal host
  // can't slip in that way.
  //
  // Subresources that come back readable or that execute get the resolving
  // check too, cached per host; images and fonts keep the cheap synchronous
  // path. See isBlockedSubresourceUrl and subresourceNeedsResolution for why
  // each way round.
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
    if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
      void checkAgentUrl(details.url)
        .then((guard) => {
          if (!guard.ok) {
            logger.warn('Blocked agent document navigation to a private host')
          }
          settle(!guard.ok)
        })
        .catch((error) => {
          // Fail closed: an unexpected rejection must cancel, never leave the
          // request suspended with no callback.
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
    const filename = item.getFilename()
    const url = item.getURL()
    logger.info('Blocked download in agent browser', { filename })
    item.cancel()
    const scopeId = browserScopeIdForContents(contents)
    if (scopeId) {
      withBrowserScope(scopeId, () => events?.onDownloadBlocked(filename, url))
    }
  })
}

function focusRendererOmnibox(mode: BrowserOmniboxFocusMode): void {
  if (getBrowserScopeId() !== getActiveBrowserScopeId()) return
  const win = panelWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.focus()
  win.webContents.send('browser-agent:focus-omnibox', mode, getBrowserScopeId())
}

/**
 * Opens the renderer's find bar and moves keyboard focus to it. The bar is
 * renderer chrome rather than an overlay on the page: a renderer element that
 * overlapped the native view would trip the occlusion path and hide the very
 * page being searched.
 */
function openRendererFind(): void {
  if (getBrowserScopeId() !== getActiveBrowserScopeId()) return
  const win = panelWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.focus()
  win.webContents.send('browser-agent:open-find', getBrowserScopeId())
}

/**
 * Tab a find is currently running on. Tracked because the find outlives the
 * call that started it — Chromium keeps the highlights until it is told to
 * stop, so leaving a tab (or navigating it) has to clear the find explicitly
 * or the old matches stay lit under a match count that no longer describes
 * anything on screen.
 */
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
  if (currentScope.findingTabId === tabId) currentScope.findingTabId = null
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
  tab.view.webContents.findInPage(request.query, {
    forward: request.forward,
    findNext: request.findNext,
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
function openTabWithUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  try {
    const tab = addTab()
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
      zoomFactor: BASE_ZOOM_FACTOR,
    },
  })
  view.setBackgroundColor(browserBackgroundColor())
  const contents = view.webContents
  registerAgentWebContents(contents)
  configureAgentPartition(contents.session)
  attachAgentContextMenu(contents, {
    openTab: (url) => withBrowserScope(scopeId, () => openTabWithUrl(url)),
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
    withBrowserScope(scopeId, () => openTabWithUrl(details.url))
    return { action: 'deny' }
  })

  // Pages may hold navigation hostage with beforeunload dialogs nobody can
  // see; always let the unload proceed.
  contents.on('will-prevent-unload', (event) => {
    event.preventDefault()
  })
  // A crashed renderer would otherwise stay in `tabs` forever: `activeTab()`
  // filters it out and returns null while `activeTabId` still names it, so
  // `requireTab()` reports "no page is open" even with other tabs open, and
  // the panel goes blank with no way back.
  contents.on(
    'render-process-gone',
    bindToBrowserScope(scopeId, (_event, details) => {
      const tab = tabs.find((entry) => entry.view === view)
      if (!tab) return
      logger.warn('Browser tab renderer exited; dropping the tab', { reason: details.reason })
      forgetTab(tab)
    })
  )
  contents.on(
    'before-input-event',
    bindToBrowserScope(scopeId, (event, input) => {
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

      const tab = tabs.find((entry) => entry.view === view)
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
  contents.on('did-navigate-in-page', bindToBrowserScope(scopeId, persistBrowserSession))
  // Both document loads and same-document route changes invalidate anything
  // bound to the previous page: a single-page app can replace a login form
  // with another site's UI without ever loading a new document.
  contents.on(
    'did-start-navigation',
    bindToBrowserScope(scopeId, () => events?.onTabNavigated(contents))
  )
  contents.on(
    'did-navigate',
    bindToBrowserScope(scopeId, () => events?.onTabNavigated(contents))
  )
  contents.on(
    'did-navigate-in-page',
    bindToBrowserScope(scopeId, () => events?.onTabNavigated(contents))
  )
  contents.on(
    'destroyed',
    bindToBrowserScope(scopeId, () => events?.onTabClosed(contents))
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
  currentScope.automationActive = active
  applyActiveTabThrottling()
}

/**
 * Unthrottles the active tab while automation is active, and throttles every
 * other tab. Call after anything that changes which tab is active, so the
 * exemption follows the active tab rather than being stranded on the old one.
 */
function applyActiveTabThrottling(): void {
  for (const tab of tabs) {
    if (tab.view.webContents.isDestroyed()) continue
    const exempt = currentScope.automationActive && tab.id === currentScope.activeTabId
    tab.view.webContents.setBackgroundThrottling(!exempt)
  }
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

function addTabInternal({
  pinned = false,
  activate = true,
  notify = true,
}: AddTabOptions = {}): AgentTab {
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
  if (pinned) {
    const firstRegularTab = tabs.findIndex((entry) => !entry.pinned)
    tabs.splice(firstRegularTab < 0 ? tabs.length : firstRegularTab, 0, tab)
  } else {
    tabs.push(tab)
  }
  if (activate || currentScope.activeTabId === null) {
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

export function restoreBrowserSession(): void {
  if (isBrowserScopeSuspended(getBrowserScopeId())) {
    throw new SessionError('This task browser is suspended until the task is reopened.')
  }
  if (currentScope.restored) return
  currentScope.activationOnly = false
  currentScope.restored = true
  currentScope.restoring = true

  const scopeId = getBrowserScopeId()
  let snapshot: BrowserSessionSnapshotV1 | null = null
  let importedLegacyPinnedTabs = false
  if (browserSessionPersistence) {
    try {
      snapshot = sanitizeBrowserSessionSnapshot(browserSessionPersistence.load(scopeId))
    } catch (error) {
      logger.warn('Could not restore browser chat session', {
        error: getErrorMessage(error),
      })
    }
  }

  const mayClaimLegacyFallback =
    legacyPinnedFallbackClaimedBy === null ||
    legacyPinnedFallbackClaimedBy === scopeId ||
    (legacyPinnedFallbackClaimedBy === LEGACY_BROWSER_SCOPE && isDurableBrowserScope(scopeId))
  if (!snapshot && legacyPinnedTabPersistence && mayClaimLegacyFallback) {
    let urls: string[] = []
    try {
      urls = sanitizePinnedTabUrls(legacyPinnedTabPersistence.load())
    } catch (error) {
      logger.warn('Could not restore legacy pinned browser tabs', {
        error: getErrorMessage(error),
      })
    }
    if (urls.length > 0) {
      legacyPinnedFallbackClaimedBy = scopeId
      snapshot = {
        v: 1,
        tabs: urls.map((url) => ({ url, pinned: true })),
        activeIndex: 0,
      }
      importedLegacyPinnedTabs = true
    }
  }

  const restoredTabs: AgentTab[] = []
  if (snapshot) {
    for (const entry of snapshot.tabs) {
      const tab = addTabInternal({ pinned: entry.pinned, activate: false, notify: false })
      tab.pendingRestoreUrl = entry.url
      restoredTabs.push(tab)
      if (entry.url !== 'about:blank') {
        void tab.view.webContents.loadURL(entry.url).catch(() => {})
      }
    }
    currentScope.activeTabId = restoredTabs[snapshot.activeIndex]?.id ?? restoredTabs[0]?.id ?? null
    currentScope.lastPersistedSnapshot = importedLegacyPinnedTabs ? null : JSON.stringify(snapshot)
  }

  currentScope.restoring = false
  applyActiveTabThrottling()
  const active = activeTab()
  if (active) {
    layout()
    events?.onActiveTabChanged(active.view.webContents)
    events?.onTabsChanged()
  }

  if (importedLegacyPinnedTabs) {
    const persisted = persistBrowserSession()
    if (
      persisted &&
      browserSessionPersistence &&
      isDurableBrowserScope(scopeId) &&
      flushBrowserSessionPersistence()
    ) {
      clearLegacyPinnedFallback(scopeId)
    }
  }
}

export function addTab(): AgentTab {
  restoreBrowserSession()
  return addTabInternal()
}

/** Restores the most recently closed regular tab for the current app session. */
export function reopenClosedTab(): AgentTab | null {
  restoreBrowserSession()
  const url = recentlyClosedTabUrls.shift()
  if (!url) return null

  const tab = addTabInternal()
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
 * Opens a copy of a tab at the same URL. A duplicate is a fresh load rather
 * than a clone of the original's session history: the history belongs to the
 * WebContents, and there is no way to fork it.
 */
export function duplicateTab(tabId: string): AgentTab | null {
  restoreBrowserSession()
  const source = tabs.find((entry) => entry.id === tabId)
  if (!source) return null

  const url = sanitizeRestorableUrl(source.view.webContents.getURL())
  const tab = addTabInternal()
  if (url && url !== 'about:blank') {
    // Sanitized to http(s) without embedded credentials above, and the
    // partition's onBeforeRequest still runs the full SSRF check on the load —
    // same reasoning as reopenClosedTab, and this is likewise a user action.
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
  currentScope.activeTabId = tab.id
  // The automation exemption follows the active tab, so a mid-tool switch
  // unthrottles the new one and re-throttles the old.
  applyActiveTabThrottling()
  layout()
  if (transferBrowserFocus) currentScope.focusedBrowserTabId = tab.id
  persistBrowserSession()
  events?.onActiveTabChanged(tab.view.webContents)
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

/**
 * Drops a tab whose renderer is already gone. Unlike {@link closeTab} this
 * takes no view down (there is nothing left to close), applies to pinned tabs
 * too — a crashed pinned tab is no more usable than any other — and does not
 * offer the page for Reopen Closed Tab, since the user did not close it.
 */
function forgetTab(tab: AgentTab): void {
  const index = tabs.indexOf(tab)
  if (index < 0) return
  // Before the splice, while the tab is still resolvable: a find left running
  // on a tab that is going away keeps `findingTabId` naming a dead tab and
  // leaves the bar open counting matches on a page nobody can see.
  dismissFind(tab.id)
  tabs.splice(index, 1)
  const transferBrowserFocus = currentScope.focusedBrowserTabId === tab.id
  clearFocusedBrowserTab(tab.id)
  detachIfAttached(tab.view)
  if (currentScope.activeTabId === tab.id) {
    currentScope.activeTabId = (tabs[index] ?? tabs[index - 1])?.id ?? null
    layout()
    const active = activeTab()
    if (active) {
      events?.onActiveTabChanged(active.view.webContents)
    }
  }
  if (!hasSession() && getBrowserScopeId() === getActiveBrowserScopeId() && isPanelVisible()) {
    addTab()
    if (transferBrowserFocus) currentScope.focusedBrowserTabId = currentScope.activeTabId
    return
  }
  if (transferBrowserFocus) currentScope.focusedBrowserTabId = currentScope.activeTabId
  persistBrowserSession()
  events?.onTabsChanged()
  if (!hasSession()) {
    events?.onSessionClosed()
  }
}

export function closeTab(tabId: string): void {
  restoreBrowserSession()
  const index = tabs.findIndex((entry) => entry.id === tabId)
  if (index < 0) throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  if (tabs[index].pinned) {
    throw new SessionError('Pinned tabs cannot be closed. Unpin the tab first.')
  }
  // Before the splice, while the tab is still resolvable — see forgetTab.
  dismissFind(tabId)
  const [tab] = tabs.splice(index, 1)
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
    events?.onSessionClosed()
  }
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
  if (pinned) {
    const firstRegularTab = tabs.findIndex((entry) => !entry.pinned)
    tabs.splice(firstRegularTab < 0 ? tabs.length : firstRegularTab, 0, tab)
  } else {
    tabs.push(tab)
  }
  persistBrowserSession()
  events?.onTabsChanged()
  return tab
}

/**
 * Closes the active tab when the browser resource currently owns the user's
 * interaction context. Application menu accelerators run before a
 * WebContentsView's `before-input-event`, so Mod+W must route through this
 * function instead of Electron's global close role. Returns false when focus
 * belongs to the rest of the app.
 */
export function closeFocusedTab(ownerWindow?: BrowserWindow | null): boolean {
  if (!panelUpdateAllowed(ownerWindow ?? undefined, getBrowserScopeId())) return false
  const focusedTab = tabs.find(
    (tab) =>
      !tab.view.webContents.isDestroyed() &&
      (tab.id === currentScope.focusedBrowserTabId || tab.view.webContents.isFocused())
  )
  if (!focusedTab) return false
  closeTabFromUser(focusedTab.id)
  return true
}

/** Reopens the latest closed tab only while the browser owns interaction focus. */
export function reopenFocusedTab(ownerWindow?: BrowserWindow | null): boolean {
  if (!panelUpdateAllowed(ownerWindow ?? undefined, getBrowserScopeId())) return false
  const browserFocused = tabs.some(
    (tab) =>
      !tab.view.webContents.isDestroyed() &&
      (tab.id === currentScope.focusedBrowserTabId || tab.view.webContents.isFocused())
  )
  if (!browserFocused) return false

  const reopened = reopenClosedTab()
  if (!reopened) return false
  reopened.view.webContents.focus()
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
  if (tabs.find((tab) => tab.id === tabId)?.pinned) return
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
    detachIfAttached(tab.view)
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close()
    }
  }
  recentlyClosedTabUrls.length = 0
  currentScope.activeTabId = null
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
      // Stays true so a later restore cannot re-read the list being erased here.
      currentScope.restored = true
      currentScope.restoring = false
      currentScope.lastPersistedSnapshot = JSON.stringify({
        v: 1,
        tabs: [],
        activeIndex: -1,
      } satisfies BrowserSessionSnapshotV1)
      browserSessionPersistence?.save(scopeId, { v: 1, tabs: [], activeIndex: -1 })
      events?.onTabsChanged()
    })
  }
  legacyPinnedTabPersistence?.save([])
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
    .map((tab) => ({
      tabId: tab.id,
      title: tab.view.webContents.getTitle(),
      url: tab.pendingRestoreUrl || tab.view.webContents.getURL(),
      loading: tab.view.webContents.isLoading(),
      active: tab.id === currentScope.activeTabId,
      pinned: tab.pinned,
    }))
}

export function getTabsState(): BrowserTabsState {
  return {
    scopeId: getBrowserScopeId(),
    tabs: listTabs(),
    activeTabId: activeTab()?.id ?? null,
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
