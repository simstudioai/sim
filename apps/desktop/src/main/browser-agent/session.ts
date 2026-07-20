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
import { nativeTheme, WebContentsView } from 'electron'
import { registerAgentWebContents } from '@/main/browser-agent/registry'
import { checkAgentUrl, isBlockedRequestUrl } from '@/main/browser-agent/url-guard'

const logger = createLogger('BrowserAgentSession')

/** Dedicated cookie jar for the agent browser; `persist:` = survives restarts. */
const AGENT_PARTITION = 'persist:sim-browser-agent'

class SessionError extends Error {}

export interface AgentTab {
  id: string
  view: WebContentsView
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
let activeTabId: string | null = null
let nextTabId = 1
let partitionConfigured = false
let events: AgentSessionEvents | null = null
let getMainWindow: () => BrowserWindow | null = () => null
/** Where the panel sits in the main window (CSS px); null = panel hidden. */
let panelBounds: BrowserPanelBounds | null = null
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

export function initSession(
  handlers: AgentSessionEvents,
  mainWindowProvider: () => BrowserWindow | null
): void {
  events = handlers
  getMainWindow = mainWindowProvider
}

/**
 * Default-deny hardening for the agent partition: no permission grants of any
 * kind, and downloads are cancelled (and surfaced to the driver) rather than
 * silently dropped on disk.
 */
function configureAgentPartition(ses: Session): void {
  if (partitionConfigured) return
  partitionConfigured = true
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
  const win = getMainWindow()
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
    if (!tab) return
    const closingLastTab = listTabs().length === 1
    closeTab(tab.id)
    const active = activeTab()
    if (closingLastTab || !active || !active.view.webContents.getURL()) {
      focusRendererOmnibox('clear')
    } else {
      active.view.webContents.focus()
    }
  })

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
  const win = getMainWindow()
  if (!active || !win || active.view.webContents.isDestroyed()) return

  const generation = ++panelSnapshotGeneration
  const tabId = active.id
  void active.view.webContents
    .capturePage(undefined, { stayHidden: true })
    .then((image) => {
      if (generation !== panelSnapshotGeneration || image.isEmpty()) return
      const snapshot: BrowserPanelSnapshot = { dataUrl: image.toDataURL(), tabId }
      getMainWindow()?.webContents.send('browser-agent:panel-snapshot', snapshot)
    })
    .catch((error) => {
      logger.warn('Could not capture browser panel snapshot', {
        error: error instanceof Error ? error.message : String(error),
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
  const win = getMainWindow()
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

/** Renderer-reported panel rect (null = panel hidden/unmounted). */
export function setPanelBounds(bounds: BrowserPanelBounds | null): void {
  panelBounds = bounds
  // A visible browser resource always represents one open browser window.
  // Materialize its initial about:blank tab before layout so the tab strip,
  // omnibox, and native session never disagree about an empty state.
  if (bounds !== null && !hasSession()) {
    ensureTab()
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
export function setPanelOccluded(occluded: boolean): void {
  if (panelOccluded === occluded) return
  panelOccluded = occluded
  if (occluded) {
    capturePanelSnapshot()
  }
  layout()
}

/** The active tab, creating the first tab when none exist. */
export function ensureTab(): AgentTab {
  let active = activeTab()
  if (!active) {
    active = addTab()
  }
  return active
}

/** The active tab without creating one. */
export function requireTab(): AgentTab {
  const active = activeTab()
  if (!active) {
    throw new SessionError('No page is open yet — call browser_navigate or browser_open_tab first.')
  }
  return active
}

export function addTab(): AgentTab {
  if (tabs.filter((tab) => !tab.view.webContents.isDestroyed()).length >= MAX_BROWSER_TABS) {
    throw new SessionError(`The browser supports up to ${MAX_BROWSER_TABS} open tabs.`)
  }
  const tab: AgentTab = { id: String(nextTabId++), view: createTabView() }
  tabs.push(tab)
  activeTabId = tab.id
  layout()
  events?.onActiveTabChanged(tab.view.webContents)
  events?.onTabsChanged()
  return tab
}

export function switchTab(tabId: string): AgentTab {
  const tab = tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  activeTabId = tab.id
  layout()
  events?.onActiveTabChanged(tab.view.webContents)
  events?.onTabsChanged()
  return tab
}

export function closeTab(tabId: string): void {
  const index = tabs.findIndex((entry) => entry.id === tabId)
  if (index < 0) throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  const [tab] = tabs.splice(index, 1)
  if (attachedView === tab.view) {
    detachAttachedView()
  }
  tab.view.webContents.close()
  if (activeTabId === tab.id) {
    activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null
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
    return
  }
  events?.onTabsChanged()
  if (!hasSession()) {
    events?.onSessionClosed()
  }
}

export function listTabs(): BrowserTabState[] {
  return tabs
    .filter((tab) => !tab.view.webContents.isDestroyed())
    .map((tab) => ({
      tabId: tab.id,
      title: tab.view.webContents.getTitle(),
      url: tab.view.webContents.getURL(),
      loading: tab.view.webContents.isLoading(),
      active: tab.id === activeTabId,
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
