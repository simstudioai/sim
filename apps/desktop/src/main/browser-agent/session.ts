import type { BrowserPanelBounds } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import type { BrowserWindow, Session, WebContents } from 'electron'
import { WebContentsView } from 'electron'
import { registerAgentWebContents } from '@/main/browser-agent/registry'

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

const tabs: AgentTab[] = []
let activeTabId: string | null = null
let nextTabId = 1
let partitionConfigured = false
let events: AgentSessionEvents | null = null
let getMainWindow: () => BrowserWindow | null = () => null
/** Where the panel sits in the main window (CSS px); null = panel hidden. */
let panelBounds: BrowserPanelBounds | null = null
let panelLeaseAt = 0
let leaseTimer: ReturnType<typeof setInterval> | null = null
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
  ses.on('will-download', (_event, item) => {
    const filename = item.getFilename()
    const url = item.getURL()
    logger.info('Blocked download in agent browser', { filename })
    item.cancel()
    events?.onDownloadBlocked(filename, url)
  })
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
      // Pages keep running (timers, fetches) while the panel is hidden or
      // covered — automation must not depend on panel visibility.
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  const contents = view.webContents
  registerAgentWebContents(contents)
  configureAgentPartition(contents.session)

  // Popup-neutralize: window.open and target=_blank navigate the SAME view
  // instead of spawning windows — the agent browses one page per tab.
  contents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) {
      void contents.loadURL(details.url).catch(() => {})
    }
    return { action: 'deny' }
  })

  // Pages may hold navigation hostage with beforeunload dialogs nobody can
  // see; always let the unload proceed.
  contents.on('will-prevent-unload', (event) => {
    event.preventDefault()
  })

  events?.onTabCreated(contents)
  return view
}

/** True while any tab exists. */
export function hasSession(): boolean {
  return tabs.some((tab) => !tab.view.webContents.isDestroyed())
}

/** The view currently attached to the host window (attach only on change —
 * re-adding an attached view re-stacks it and can flicker the composite). */
let attachedView: WebContentsView | null = null
let lastAppliedBounds = ''

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

  if (!showing || hostedWindow !== win || attachedView !== active?.view) {
    if (attachedView) {
      hostedWindow?.contentView.removeChildView(attachedView)
      attachedView = null
      lastAppliedBounds = ''
    }
  }
  if (!showing || !active || !win || panelBounds === null) {
    return
  }

  if (attachedView !== active.view) {
    win.contentView.addChildView(active.view)
    hostedWindow = win
    attachedView = active.view
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
    active.view.setVisible(true)
  }
}

/** Renderer-reported panel rect (null = panel hidden/unmounted). */
export function setPanelBounds(bounds: BrowserPanelBounds | null): void {
  panelBounds = bounds
  panelLeaseAt = Date.now()
  if (bounds !== null && leaseTimer === null) {
    leaseTimer = setInterval(() => {
      if (panelBounds !== null && Date.now() - panelLeaseAt > PANEL_LEASE_TTL_MS) {
        logger.info('Panel bounds lease expired; hiding embedded browser view')
        panelBounds = null
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
  const tab: AgentTab = { id: String(nextTabId++), view: createTabView() }
  tabs.push(tab)
  activeTabId = tab.id
  layout()
  events?.onActiveTabChanged(tab.view.webContents)
  return tab
}

export function switchTab(tabId: string): AgentTab {
  const tab = tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  activeTabId = tab.id
  layout()
  events?.onActiveTabChanged(tab.view.webContents)
  return tab
}

export function closeTab(tabId: string): void {
  const index = tabs.findIndex((entry) => entry.id === tabId)
  if (index < 0) throw new SessionError(`No tab with id ${tabId} — call browser_list_tabs.`)
  const [tab] = tabs.splice(index, 1)
  if (attachedView === tab.view) {
    hostedWindow?.contentView.removeChildView(tab.view)
    attachedView = null
    lastAppliedBounds = ''
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
  if (!hasSession()) {
    events?.onSessionClosed()
  }
}

export function listTabs(): Array<{ tabId: string; title: string; url: string; active: boolean }> {
  return tabs
    .filter((tab) => !tab.view.webContents.isDestroyed())
    .map((tab) => ({
      tabId: tab.id,
      title: tab.view.webContents.getTitle(),
      url: tab.view.webContents.getURL(),
      active: tab.id === activeTabId,
    }))
}

export function activeTab(): AgentTab | null {
  const tab = tabs.find((entry) => entry.id === activeTabId) ?? null
  if (!tab || tab.view.webContents.isDestroyed()) return null
  return tab
}
