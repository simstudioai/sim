import { join } from 'node:path'
import {
  type BrowserDataKind,
  type BrowserOmniboxFocusMode,
  type BrowserTabState,
  type BrowserTabsState,
  type BrowserTheme,
  MAX_BROWSER_TABS,
} from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { BrowserWindow, CookiesSetDetails, Input, Session, WebContents } from 'electron'
import { session as electronSession, nativeTheme, WebContentsView } from 'electron'
import { attachAgentContextMenu } from '@/main/browser-agent/context-menu'
import type { BrowserCookieSignal } from '@/main/browser-agent/known-sessions'
import {
  detachAttachedView,
  detachIfAttached,
  initPanel,
  isPanelVisible,
  layout,
  panelUpdateAllowed,
  panelWindow,
} from '@/main/browser-agent/panel'
import { registerAgentWebContents } from '@/main/browser-agent/registry'
import { checkAgentUrl, isBlockedRequestUrl } from '@/main/browser-agent/url-guard'

const logger = createLogger('BrowserAgentSession')

/** Dedicated cookie jar for the agent browser; `persist:` = survives restarts. */
const AGENT_PARTITION = 'persist:sim-browser-agent'

class SessionError extends Error {}

export interface AgentTab {
  id: string
  view: WebContentsView
  pinned: boolean
}

export interface PinnedTabPersistence {
  load: () => unknown
  save: (urls: string[]) => void
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

export type BrowserShortcut = 'focus-omnibox' | 'new-tab' | 'close-tab'

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
    default:
      return null
  }
}

const tabs: AgentTab[] = []
const recentlyClosedTabUrls: string[] = []
let activeTabId: string | null = null
let nextTabId = 1
/**
 * Per-session rather than a single boolean: a process-wide flag would make the
 * SECOND partition ever configured silently skip every hardening step below —
 * a failure that type-checks and passes tests.
 */
const configuredPartitions = new WeakSet<Session>()
let events: AgentSessionEvents | null = null
let getMainWindow: () => BrowserWindow | null = () => null
let pinnedTabPersistence: PinnedTabPersistence | null = null
let pinnedTabsRestored = false
/** Serialized form of the last saved pinned-tab list, for change detection. */
let lastPersistedPinnedTabs: string | null = null
/** Browser-resource focus, including native pages and renderer-owned chrome. */
let focusedBrowserTabId: string | null = null
let focusedBrowserClearTimer: ReturnType<typeof setTimeout> | null = null
/** Raw Sim preference; `system` remains dynamic as the OS theme changes. */
let browserTheme: BrowserTheme = 'system'
/** Prevent hidden-page throttling only while an agent action needs the page to make progress. */
let automationActive = false

export function initSession(
  handlers: AgentSessionEvents,
  mainWindowProvider: () => BrowserWindow | null,
  persistence?: PinnedTabPersistence
): void {
  events = handlers
  getMainWindow = mainWindowProvider
  if (persistence) {
    pinnedTabPersistence = persistence
  }
  initPanel({
    getMainWindow: () => getMainWindow(),
    activeTab,
    ensureInitialTab: () => {
      restorePinnedTabs()
      if (!hasSession()) {
        ensureTab()
      }
    },
    onViewDetached: (view) => {
      clearFocusedBrowserTab(tabs.find((tab) => tab.view === view)?.id)
    },
  })
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
    if (urls.length >= MAX_BROWSER_TABS) break
  }
  return urls
}

function pinnedUrl(tab: AgentTab): string {
  return tab.view.webContents.getURL() || 'about:blank'
}

/**
 * Writes the pinned-tab list only when it actually changed.
 *
 * This runs on `did-navigate` and `did-navigate-in-page` for every tab, so any
 * single-page app fires it on each route change. The settings store compares
 * with `===`, so a freshly built array never matches and every call would
 * otherwise mean a synchronous mkdir + write + rename of the whole settings
 * file on the main thread — including writing `[]` over `[]` when nothing is
 * pinned at all.
 */
function persistPinnedTabs(): void {
  if (!pinnedTabPersistence || !pinnedTabsRestored) return
  const urls = tabs
    .filter((tab) => tab.pinned && !tab.view.webContents.isDestroyed())
    .map((tab) => pinnedUrl(tab))
  const fingerprint = JSON.stringify(urls)
  if (fingerprint === lastPersistedPinnedTabs) return
  lastPersistedPinnedTabs = fingerprint
  pinnedTabPersistence.save(urls)
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
  // can't slip in that way. Subresources take the cheap synchronous literal-IP
  // backstop instead of a DNS lookup per asset.
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
      void checkAgentUrl(details.url)
        .then((guard) => {
          if (!guard.ok) {
            logger.warn('Blocked agent document navigation to a private host')
          }
          callback({ cancel: !guard.ok })
        })
        .catch((error) => {
          // Fail closed: an unexpected rejection must cancel, never leave the
          // request suspended with no callback.
          logger.error('Agent SSRF check failed; cancelling request', { error })
          callback({ cancel: true })
        })
      return
    }
    callback({ cancel: isBlockedRequestUrl(details.url) })
  })
  ses.on('will-download', (_event, item) => {
    const filename = item.getFilename()
    const url = item.getURL()
    logger.info('Blocked download in agent browser', { filename })
    item.cancel()
    events?.onDownloadBlocked(filename, url)
  })
}

function focusRendererOmnibox(mode: BrowserOmniboxFocusMode): void {
  const win = panelWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.focus()
  win.webContents.send('browser-agent:focus-omnibox', mode)
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
    },
  })
  view.setBackgroundColor(browserBackgroundColor())
  const contents = view.webContents
  registerAgentWebContents(contents)
  configureAgentPartition(contents.session)
  attachAgentContextMenu(contents, { openTab: openTabWithUrl })

  contents.on('focus', () => {
    if (focusedBrowserClearTimer !== null) {
      clearTimeout(focusedBrowserClearTimer)
      focusedBrowserClearTimer = null
    }
    const tab = tabs.find((entry) => entry.view.webContents === contents)
    focusedBrowserTabId = tab?.id ?? activeTabId
  })
  contents.on('blur', () => {
    const tab = tabs.find((entry) => entry.view.webContents === contents)
    if (!tab || focusedBrowserTabId !== tab.id) return
    if (focusedBrowserClearTimer !== null) clearTimeout(focusedBrowserClearTimer)
    // Electron can emit blur while resolving an application-menu accelerator.
    // Defer the clear for one event-loop turn so the synchronous menu callback
    // can still identify which native tab owned the keystroke.
    focusedBrowserClearTimer = setTimeout(() => {
      focusedBrowserClearTimer = null
      if (focusedBrowserTabId === tab.id && !contents.isFocused()) {
        focusedBrowserTabId = null
      }
    }, 0)
  })

  // Keep popups inside the browser resource: http(s) window.open and
  // target=_blank requests become a new internal tab, never a native window.
  contents.setWindowOpenHandler((details) => {
    openTabWithUrl(details.url)
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
  contents.on('render-process-gone', (_event, details) => {
    const tab = tabs.find((entry) => entry.view === view)
    if (!tab) return
    logger.warn('Browser tab renderer exited; dropping the tab', { reason: details.reason })
    forgetTab(tab)
  })
  contents.on('before-input-event', (event, input) => {
    const shortcut = browserShortcutForInput(input)
    if (!shortcut) return

    event.preventDefault()
    if (shortcut === 'focus-omnibox') {
      focusRendererOmnibox('select')
      return
    }
    if (shortcut === 'new-tab') {
      if (listTabs().length < MAX_BROWSER_TABS) {
        addTab()
        focusRendererOmnibox('clear')
      }
      return
    }

    const tab = tabs.find((entry) => entry.view === view)
    if (tab) closeTabFromUser(tab.id)
  })
  // A pinned tab persists its latest top-level location, including
  // user-driven navigations that do not pass through the driver.
  contents.on('did-navigate', persistPinnedTabs)
  contents.on('did-navigate-in-page', persistPinnedTabs)
  // Both document loads and same-document route changes invalidate anything
  // bound to the previous page: a single-page app can replace a login form
  // with another site's UI without ever loading a new document.
  contents.on('did-start-navigation', () => events?.onTabNavigated(contents))
  contents.on('did-navigate', () => events?.onTabNavigated(contents))
  contents.on('did-navigate-in-page', () => events?.onTabNavigated(contents))
  contents.on('destroyed', () => events?.onTabClosed(contents))

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
  automationActive = active
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
    const exempt = automationActive && tab.id === activeTabId
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
  updateTabBackgrounds()
  for (const tab of tabs) {
    if (!tab.view.webContents.isDestroyed()) {
      events?.onTabThemeChanged(tab.view.webContents, theme)
    }
  }
}

export function getBrowserTheme(): BrowserTheme {
  return browserTheme
}

nativeTheme.on('updated', () => {
  if (browserTheme === 'system') {
    updateTabBackgrounds()
  }
})

/** The active tab, creating the first tab when none exist. */
export function ensureTab(): AgentTab {
  restorePinnedTabs()
  let active = activeTab()
  if (!active) {
    active = addTabInternal()
  }
  return active
}

/** The active tab without creating one. */
export function requireTab(): AgentTab {
  restorePinnedTabs()
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
  if (tabs.filter((tab) => !tab.view.webContents.isDestroyed()).length >= MAX_BROWSER_TABS) {
    throw new SessionError(`The browser supports up to ${MAX_BROWSER_TABS} open tabs.`)
  }
  const transferBrowserFocus =
    activate &&
    (focusedBrowserTabId !== null || tabs.some((tab) => tab.view.webContents.isFocused()))
  const tab: AgentTab = { id: String(nextTabId++), view: createTabView(), pinned }
  if (pinned) {
    const firstRegularTab = tabs.findIndex((entry) => !entry.pinned)
    tabs.splice(firstRegularTab < 0 ? tabs.length : firstRegularTab, 0, tab)
  } else {
    tabs.push(tab)
  }
  if (activate || activeTabId === null) {
    activeTabId = tab.id
    applyActiveTabThrottling()
    layout()
    if (transferBrowserFocus) focusedBrowserTabId = tab.id
    if (notify) events?.onActiveTabChanged(tab.view.webContents)
  }
  if (notify) events?.onTabsChanged()
  return tab
}

function restorePinnedTabs(): void {
  if (pinnedTabsRestored) return
  pinnedTabsRestored = true
  const urls = sanitizePinnedTabUrls(pinnedTabPersistence?.load())
  // Seed the change detector from what is already on disk, so the first
  // navigation after launch does not rewrite an identical list.
  lastPersistedPinnedTabs = JSON.stringify(urls)
  for (const url of urls) {
    const tab = addTabInternal({ pinned: true, activate: false, notify: false })
    if (url !== 'about:blank') {
      void tab.view.webContents.loadURL(url).catch(() => {})
    }
  }
  const active = activeTab()
  if (active) {
    layout()
    events?.onActiveTabChanged(active.view.webContents)
    events?.onTabsChanged()
  }
}

export function addTab(): AgentTab {
  restorePinnedTabs()
  return addTabInternal()
}

/** Restores the most recently closed regular tab for the current app session. */
export function reopenClosedTab(): AgentTab | null {
  restorePinnedTabs()
  if (listTabs().length >= MAX_BROWSER_TABS) return null
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
  restorePinnedTabs()
  const source = tabs.find((entry) => entry.id === tabId)
  if (!source || listTabs().length >= MAX_BROWSER_TABS) return null

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
  restorePinnedTabs()
  const tab = tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  const transferBrowserFocus =
    focusedBrowserTabId !== null || tabs.some((entry) => entry.view.webContents.isFocused())
  activeTabId = tab.id
  // The automation exemption follows the active tab, so a mid-tool switch
  // unthrottles the new one and re-throttles the old.
  applyActiveTabThrottling()
  layout()
  if (transferBrowserFocus) focusedBrowserTabId = tab.id
  events?.onActiveTabChanged(tab.view.webContents)
  events?.onTabsChanged()
  return tab
}

/**
 * Moves a tab to a final list index while preserving the pinned/regular
 * boundary. Dragging across that boundary moves to its nearest valid edge.
 */
export function reorderTab(tabId: string, targetIndex: number): AgentTab {
  restorePinnedTabs()
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
  if (tab.pinned) persistPinnedTabs()
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
  tabs.splice(index, 1)
  const transferBrowserFocus = focusedBrowserTabId === tab.id
  clearFocusedBrowserTab(tab.id)
  detachIfAttached(tab.view)
  if (tab.pinned) persistPinnedTabs()
  if (activeTabId === tab.id) {
    activeTabId = (tabs[index] ?? tabs[index - 1])?.id ?? null
    layout()
    const active = activeTab()
    if (active) {
      events?.onActiveTabChanged(active.view.webContents)
    }
  }
  if (!hasSession() && isPanelVisible()) {
    addTab()
    if (transferBrowserFocus) focusedBrowserTabId = activeTabId
    return
  }
  if (transferBrowserFocus) focusedBrowserTabId = activeTabId
  events?.onTabsChanged()
  if (!hasSession()) {
    events?.onSessionClosed()
  }
}

export function closeTab(tabId: string): void {
  restorePinnedTabs()
  const index = tabs.findIndex((entry) => entry.id === tabId)
  if (index < 0) throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  if (tabs[index].pinned) {
    throw new SessionError('Pinned tabs cannot be closed. Unpin the tab first.')
  }
  const [tab] = tabs.splice(index, 1)
  recentlyClosedTabUrls.unshift(
    sanitizeRestorableUrl(tab.view.webContents.getURL()) ?? 'about:blank'
  )
  if (recentlyClosedTabUrls.length > MAX_RECENTLY_CLOSED_TABS) {
    recentlyClosedTabUrls.length = MAX_RECENTLY_CLOSED_TABS
  }
  const transferBrowserFocus = focusedBrowserTabId === tab.id || tab.view.webContents.isFocused()
  clearFocusedBrowserTab(tab.id)
  detachIfAttached(tab.view)
  tab.view.webContents.close()
  if (activeTabId === tab.id) {
    activeTabId = (tabs[index] ?? tabs[index - 1])?.id ?? null
    layout()
    const active = activeTab()
    if (active) {
      events?.onActiveTabChanged(active.view.webContents)
    }
  }
  // Closing the last tab must not leave a visible browser resource with an
  // empty strip. Replace it with a fresh New tab, matching normal browser UI.
  if (!hasSession() && isPanelVisible()) {
    addTab()
    if (transferBrowserFocus) focusedBrowserTabId = activeTabId
    return
  }
  if (transferBrowserFocus) focusedBrowserTabId = activeTabId
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
  restorePinnedTabs()
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
  persistPinnedTabs()
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
  if (!panelUpdateAllowed(ownerWindow ?? undefined)) return false
  const focusedTab = tabs.find(
    (tab) =>
      !tab.view.webContents.isDestroyed() &&
      (tab.id === focusedBrowserTabId || tab.view.webContents.isFocused())
  )
  if (!focusedTab) return false
  closeTabFromUser(focusedTab.id)
  return true
}

/** Reopens the latest closed tab only while the browser owns interaction focus. */
export function reopenFocusedTab(ownerWindow?: BrowserWindow | null): boolean {
  if (!panelUpdateAllowed(ownerWindow ?? undefined)) return false
  const browserFocused = tabs.some(
    (tab) =>
      !tab.view.webContents.isDestroyed() &&
      (tab.id === focusedBrowserTabId || tab.view.webContents.isFocused())
  )
  if (!browserFocused) return false

  const reopened = reopenClosedTab()
  if (!reopened) return false
  reopened.view.webContents.focus()
  return true
}

/** Marks renderer-owned browser chrome as focused or releases browser focus. */
export function setPanelFocused(focused: boolean, ownerWindow?: BrowserWindow): void {
  if (!panelUpdateAllowed(ownerWindow)) return
  if (!focused) {
    clearFocusedBrowserTab()
    return
  }
  if (focusedBrowserClearTimer !== null) {
    clearTimeout(focusedBrowserClearTimer)
    focusedBrowserClearTimer = null
  }
  focusedBrowserTabId = activeTab()?.id ?? null
}

function clearFocusedBrowserTab(tabId?: string): void {
  if (tabId && focusedBrowserTabId !== tabId) return
  if (focusedBrowserClearTimer !== null) {
    clearTimeout(focusedBrowserClearTimer)
    focusedBrowserClearTimer = null
  }
  focusedBrowserTabId = null
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
  detachAttachedView()
  for (const tab of tabs.splice(0)) {
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close()
    }
  }
  recentlyClosedTabUrls.length = 0
  activeTabId = null
  clearFocusedBrowserTab()
}

/**
 * Ends the live session without touching the profile or the pinned-tab list on
 * disk, so the strip comes back intact next time. Turning the agent browser
 * off in settings runs this; a sign-out wipe runs {@link clearProfileStorage}.
 */
export function closeSession(): void {
  closeLiveTabs()
  // Left unrestored so the next opening reads the pinned strip from disk
  // rather than the emptied in-memory copy. Persistence is gated on the same
  // flag, so nothing can save over that list in the meantime.
  pinnedTabsRestored = false
  events?.onTabsChanged()
  events?.onSessionClosed()
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
  closeLiveTabs()
  // Stays true so a later restore cannot re-read the list being erased here.
  pinnedTabsRestored = true
  pinnedTabPersistence?.save([])
  lastPersistedPinnedTabs = '[]'
  events?.onTabsChanged()
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
  if (kinds.includes('cache')) await ses.clearCache()
}

export function listTabs(): BrowserTabState[] {
  restorePinnedTabs()
  return tabs
    .filter((tab) => !tab.view.webContents.isDestroyed())
    .map((tab) => ({
      tabId: tab.id,
      title: tab.view.webContents.getTitle(),
      url: tab.view.webContents.getURL(),
      loading: tab.view.webContents.isLoading(),
      active: tab.id === activeTabId,
      pinned: tab.pinned,
    }))
}

export function getTabsState(): BrowserTabsState {
  return {
    tabs: listTabs(),
    activeTabId: activeTab()?.id ?? null,
  }
}

export function activeTab(): AgentTab | null {
  const tab = tabs.find((entry) => entry.id === activeTabId) ?? null
  if (!tab || tab.view.webContents.isDestroyed()) return null
  return tab
}
