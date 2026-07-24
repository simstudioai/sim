import {
  type BrowserOmniboxFocusMode,
  type BrowserPanelBounds,
  type BrowserPanelSnapshot,
  type BrowserTabState,
  type BrowserTabsState,
  type BrowserTheme,
  MAX_BROWSER_TABS,
} from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { BrowserWindow, Input, Session, WebContents } from 'electron'
import { session as electronSession, nativeTheme, WebContentsView } from 'electron'
import type { BrowserCookieSignal } from '@/main/browser-agent/known-sessions'
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
const PANEL_LEASE_TTL_MS = 2_500
const PANEL_LEASE_CHECK_MS = 1_000
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
/** Where the panel sits in the main window (CSS px); null = panel hidden. */
let panelBounds: BrowserPanelBounds | null = null
/** Browser-resource focus, including native pages and renderer-owned chrome. */
let focusedBrowserTabId: string | null = null
let focusedBrowserClearTimer: ReturnType<typeof setTimeout> | null = null
/** True while renderer-owned UI overlaps the native browser surface. */
let panelOccluded = false
let panelLeaseAt = 0
let leaseTimer: ReturnType<typeof setInterval> | null = null
let panelSnapshotGeneration = 0
/** Raw Sim preference; `system` remains dynamic as the OS theme changes. */
let browserTheme: BrowserTheme = 'system'
/** Prevent hidden-page throttling only while an agent action needs the page to make progress. */
let automationActive = false
/** The window currently hosting the active view, for re-parenting checks. */
let hostedWindow: BrowserWindow | null = null
/** The app window whose renderer most recently leased the visible browser panel. */
let panelOwnerWindow: BrowserWindow | null = null

/**
 * The window owning the visible browser panel, or null. Self-healing: a
 * destroyed owner is forgotten here rather than left to reject panel updates
 * from a window that is legitimately showing the browser.
 */
function panelOwner(): BrowserWindow | null {
  if (panelOwnerWindow?.isDestroyed()) {
    panelOwnerWindow = null
  }
  return panelOwnerWindow
}

/** The window the panel's native view and pushes belong to. */
function panelWindow(): BrowserWindow | null {
  return panelOwner() ?? getMainWindow()
}

/**
 * Whether a window may act on the panel. An unowned panel accepts anyone;
 * once owned, only the owner — so a stale report from a second window cannot
 * hide or steal the singleton browser surface.
 */
function panelUpdateAllowed(ownerWindow?: BrowserWindow): boolean {
  if (!ownerWindow) return true
  const owner = panelOwner()
  return owner === null || owner === ownerWindow
}

/**
 * Whether a window may report panel bounds, given which Sim window has OS
 * focus. Ownership transfers only to the focused window: when Sim is in the
 * background nothing is focused, and without this rule every window with the
 * panel mounted would reclaim it on its next heartbeat, re-parenting the
 * native view back and forth about once a second.
 */
export function canReportPanelBounds(
  win: BrowserWindow,
  focusedWindow: BrowserWindow | null
): boolean {
  const owner = panelOwner()
  return owner === null || owner === win || focusedWindow === win
}

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

function createTabView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      partition: AGENT_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      // Visible pages remain full speed. Hidden pages may be throttled unless
      // a browser tool is actively waiting on them.
      backgroundThrottling: !automationActive,
      spellcheck: false,
    },
  })
  view.setBackgroundColor(browserBackgroundColor())
  const contents = view.webContents
  registerAgentWebContents(contents)
  configureAgentPartition(contents.session)

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
    if (/^https?:\/\//i.test(details.url)) {
      try {
        const tab = addTab()
        void tab.view.webContents.loadURL(details.url).catch(() => {})
      } catch (error) {
        logger.warn('Could not open browser popup in a new tab', {
          error: getErrorMessage(error),
        })
      }
    }
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

  events?.onTabCreated(contents)
  return view
}

/** True while any tab exists. */
export function hasSession(): boolean {
  return tabs.some((tab) => !tab.view.webContents.isDestroyed())
}

/**
 * Keeps hidden pages responsive during an agent action, then returns them to
 * Chromium's normal background throttling so they cannot contend with Sim.
 */
export function setAutomationActive(active: boolean): void {
  automationActive = active
  for (const tab of tabs) {
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.setBackgroundThrottling(!active)
    }
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

/** The view currently attached to the host window (attach only on change —
 * re-adding an attached view re-stacks it and can flicker the composite). */
let attachedView: WebContentsView | null = null
let lastAppliedBounds = ''
let lastAppliedVisibility: boolean | null = null
/**
 * The panel's geometry relative to the window content box (DIP), captured at
 * the last renderer-reported layout. Used to reposition the view
 * synchronously on window `resize` — the renderer's report round-trips
 * layout → observe → IPC and trails a live drag by several frames, which
 * reads as the browser "swimming" inside the window. The panel is
 * right-anchored with a fixed width (vertically it stretches between fixed
 * top and bottom chrome), so the prediction translates the view with the
 * right window edge at constant width and stretches only its height; the
 * next renderer report is authoritative and corrects any drift (e.g. the
 * proportional default width before the first divider drag).
 */
let panelAnchor: { y: number; right: number; bottom: number; width: number } | null = null

function predictPanelBoundsForResize(): void {
  const win = hostedWindow
  const view = attachedView
  if (!win || !view || win.isDestroyed() || panelAnchor === null) return
  const [contentWidth, contentHeight] = win.getContentSize()
  const width = Math.max(1, Math.min(panelAnchor.width, contentWidth - panelAnchor.right))
  const bounds = {
    x: Math.max(0, contentWidth - panelAnchor.right - width),
    y: panelAnchor.y,
    width,
    height: Math.max(1, contentHeight - panelAnchor.y - panelAnchor.bottom),
  }
  const boundsKey = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
  if (boundsKey !== lastAppliedBounds) {
    lastAppliedBounds = boundsKey
    view.setBounds(bounds)
  }
}

/**
 * Clears the tracked attachment before touching Electron objects so a stale
 * host or child view cannot leave layout permanently wedged after teardown.
 */
function detachAttachedView(): void {
  const view = attachedView
  const win = hostedWindow
  attachedView = null
  hostedWindow = null
  lastAppliedBounds = ''
  lastAppliedVisibility = null
  panelAnchor = null
  const detachedTab = tabs.find((tab) => tab.view === view)
  clearFocusedBrowserTab(detachedTab?.id)

  if (win) {
    win.removeListener('resize', predictPanelBoundsForResize)
  }
  if (!view || !win) return
  try {
    if (win.isDestroyed() || view.webContents.isDestroyed()) return
    win.contentView.removeChildView(view)
  } catch (error) {
    logger.warn('Could not detach embedded browser view', {
      error: getErrorMessage(error, 'unknown'),
    })
  }
}

/**
 * Captures the current browser frame for the renderer to display while the
 * native view is hidden beneath an overlay. Captures stay hidden so Chromium
 * never promotes an occluded page back into the compositor.
 */
function capturePanelSnapshot(): void {
  const active = activeTab()
  const win = panelWindow()
  if (!active || !win || active.view.webContents.isDestroyed()) return

  const generation = ++panelSnapshotGeneration
  const tabId = active.id
  void active.view.webContents
    .capturePage(undefined, { stayHidden: true })
    .then((image) => {
      if (generation !== panelSnapshotGeneration || image.isEmpty()) return
      // Ownership can move while the capture is in flight. This frame is a
      // picture of the page, so it goes to the window still showing the
      // browser or nowhere at all.
      if (panelWindow() !== win || win.isDestroyed()) return
      const snapshot: BrowserPanelSnapshot = { dataUrl: image.toDataURL(), tabId }
      win.webContents.send('browser-agent:panel-snapshot', snapshot)
    })
    .catch((error) => {
      logger.warn('Could not capture browser panel snapshot', {
        error: getErrorMessage(error),
      })
    })
}

/**
 * Repositions the active view over the panel rect inside the main window
 * (re-parenting if the main window was recreated), and detaches it when the
 * panel is hidden. CSS pixels scale to DIP by the main page's zoom factor.
 * Idempotent: repeated calls with unchanged inputs perform no view mutations.
 */
function layout(): void {
  const win = panelWindow()
  const active = activeTab()
  const showing = active !== null && panelBounds !== null && win !== null
  const activeViewChanged = showing && attachedView !== active?.view

  if (!showing || hostedWindow !== win || attachedView !== active?.view) {
    if (attachedView) {
      detachAttachedView()
    }
  }
  if (!showing || !active || !win || panelBounds === null) {
    return
  }

  if (attachedView !== active.view) {
    win.contentView.addChildView(active.view)
    if (hostedWindow !== win) {
      win.on('resize', predictPanelBoundsForResize)
    }
    hostedWindow = win
    attachedView = active.view
    if (panelOccluded && activeViewChanged) {
      capturePanelSnapshot()
    }
  }
  const zoom = win.webContents.getZoomFactor()
  const bounds = {
    x: Math.round(panelBounds.x * zoom),
    y: Math.round(panelBounds.y * zoom),
    width: Math.max(1, Math.round(panelBounds.width * zoom)),
    height: Math.max(1, Math.round(panelBounds.height * zoom)),
  }
  const [contentWidth, contentHeight] = win.getContentSize()
  panelAnchor = {
    y: bounds.y,
    right: contentWidth - bounds.x - bounds.width,
    bottom: contentHeight - bounds.y - bounds.height,
    width: bounds.width,
  }
  const boundsKey = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
  if (boundsKey !== lastAppliedBounds) {
    lastAppliedBounds = boundsKey
    active.view.setBounds(bounds)
  }
  const visible = !panelOccluded
  if (visible !== lastAppliedVisibility) {
    lastAppliedVisibility = visible
    active.view.setVisible(visible)
  }
}

/**
 * Renderer-reported panel rect (null = panel hidden/unmounted). When an owner
 * is supplied, stale reports from another app window cannot steal or hide the
 * singleton browser surface.
 */
export function setPanelBounds(
  bounds: BrowserPanelBounds | null,
  ownerWindow?: BrowserWindow
): void {
  // A closing window releases the panel from its `closed` handler, by which
  // point Electron has already destroyed it. That release has to be honoured
  // or the panel stays "visible" with a dead owner, and the next layout
  // re-parents the native view onto whatever window is active — over a UI
  // that never asked for it — until the bounds lease expires.
  if (bounds !== null && ownerWindow?.isDestroyed()) return
  // Only the owner may hide the panel; a stale report from another window
  // must not pull the browser out from under the window displaying it.
  if (bounds === null && !panelUpdateAllowed(ownerWindow)) return
  if (bounds !== null) {
    panelOwnerWindow = ownerWindow ?? getMainWindow()
  } else {
    panelOwnerWindow = null
  }
  panelBounds = bounds
  // A visible browser resource always represents one open browser window.
  // Materialize its initial about:blank tab before layout so the tab strip,
  // omnibox, and native session never disagree about an empty state.
  if (bounds !== null) {
    restorePinnedTabs()
    if (!hasSession()) {
      ensureTab()
    }
  }
  if (bounds === null) {
    panelOccluded = false
    panelSnapshotGeneration++
  }
  panelLeaseAt = Date.now()
  if (bounds !== null && leaseTimer === null) {
    leaseTimer = setInterval(() => {
      if (panelBounds !== null && Date.now() - panelLeaseAt > PANEL_LEASE_TTL_MS) {
        logger.info('Panel bounds lease expired; hiding embedded browser view')
        panelBounds = null
        panelOwnerWindow = null
        panelOccluded = false
        panelSnapshotGeneration++
        layout()
      }
      if (panelBounds === null && leaseTimer !== null) {
        clearInterval(leaseTimer)
        leaseTimer = null
      }
    }, PANEL_LEASE_CHECK_MS)
  }
  layout()
}

/**
 * Renderer-reported native-surface occlusion. The view stays attached and
 * keeps its bounds while hidden, avoiding the flicker and restacking caused
 * by removing and re-adding it for every tooltip or menu.
 */
export function setPanelOccluded(occluded: boolean, ownerWindow?: BrowserWindow): void {
  if (!panelUpdateAllowed(ownerWindow)) return
  if (panelOccluded === occluded) return
  panelOccluded = occluded
  if (occluded) {
    capturePanelSnapshot()
  }
  layout()
}

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

export function switchTab(tabId: string): AgentTab {
  restorePinnedTabs()
  const tab = tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  const transferBrowserFocus =
    focusedBrowserTabId !== null || tabs.some((entry) => entry.view.webContents.isFocused())
  activeTabId = tab.id
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
  if (attachedView === tab.view) {
    detachAttachedView()
  }
  if (tab.pinned) persistPinnedTabs()
  if (activeTabId === tab.id) {
    activeTabId = (tabs[index] ?? tabs[index - 1])?.id ?? null
    layout()
    const active = activeTab()
    if (active) {
      events?.onActiveTabChanged(active.view.webContents)
    }
  }
  if (!hasSession() && panelBounds !== null) {
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
  if (attachedView === tab.view) {
    detachAttachedView()
  }
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
  if (!hasSession() && panelBounds !== null) {
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

/**
 * Wipes the embedded browser's profile: open tabs, the in-memory list behind
 * Reopen Closed Tab, the persisted pinned tabs, and all site data and cache in
 * the agent partition. Sim sign-out runs this so the next account signing in
 * on this machine cannot inherit the previous user's authenticated sessions,
 * pinned tabs, or browsing trail.
 */
export async function clearBrowserProfile(): Promise<void> {
  if (attachedView) {
    detachAttachedView()
  }
  for (const tab of tabs.splice(0)) {
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close()
    }
  }
  recentlyClosedTabUrls.length = 0
  activeTabId = null
  clearFocusedBrowserTab()
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
