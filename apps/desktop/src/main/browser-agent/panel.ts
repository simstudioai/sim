/**
 * Compositing for the embedded browser: where the native view sits inside a
 * Sim window, when it is visible, and which window owns it.
 *
 * The browser is ONE native surface shared by every app window, so exactly one
 * window may drive it at a time. That, the renderer bounds lease, and the
 * occlusion snapshot are the intricate parts of the browser and are kept here,
 * apart from tab bookkeeping.
 *
 * Depends on the session only through {@link PanelHost}, injected once at
 * startup. Tab state changes are pushed in by the session calling {@link layout};
 * this module never reaches back into it, so the import graph stays one-way.
 */
import type { BrowserPanelBounds, BrowserPanelSnapshot } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { BrowserWindow, WebContentsView } from 'electron'
import type { AgentTab } from '@/main/browser-agent/session'

const logger = createLogger('BrowserAgentPanel')

/**
 * The renderer renews the panel rect on a heartbeat. If it goes quiet — the
 * page crashed, unmounted, or wedged — the lease expires and the native view
 * is hidden rather than left floating over whatever replaced the panel.
 */
const PANEL_LEASE_TTL_MS = 2_500
const PANEL_LEASE_CHECK_MS = 1_000

/** What the panel needs from the session, supplied once by {@link initPanel}. */
export interface PanelHost {
  getMainWindow: () => BrowserWindow | null
  /** The tab whose view should be composited, or null when there is none. */
  activeTab: () => AgentTab | null
  /**
   * Materializes the initial tab when the panel first becomes visible: a
   * visible browser resource always represents one open browser window, and
   * the tab strip, omnibox, and native session must not disagree about that.
   */
  ensureInitialTab: () => void
  /** Lets the session drop focus tracking for a view that is no longer attached. */
  onViewDetached: (view: WebContentsView | null) => void
}

let host: PanelHost = {
  getMainWindow: () => null,
  activeTab: () => null,
  ensureInitialTab: () => {},
  onViewDetached: () => {},
}

/** Where the panel sits in the window (CSS px); null = panel hidden. */
let panelBounds: BrowserPanelBounds | null = null
/** True while renderer-owned UI overlaps the native browser surface. */
let panelOccluded = false
let panelLeaseAt = 0
let leaseTimer: ReturnType<typeof setInterval> | null = null
let panelSnapshotGeneration = 0
/** The window currently hosting the active view, for re-parenting checks. */
let hostedWindow: BrowserWindow | null = null
/** The app window whose renderer most recently leased the visible panel. */
let panelOwnerWindow: BrowserWindow | null = null
/** The view attached to the host window (attach only on change — re-adding an
 * attached view re-stacks it and can flicker the composite). */
let attachedView: WebContentsView | null = null
let lastAppliedBounds = ''
let lastAppliedVisibility: boolean | null = null
/**
 * The panel's geometry relative to the window content box (DIP), captured at
 * the last renderer-reported layout. Used to reposition the view synchronously
 * on window `resize` — the renderer's report round-trips layout → observe →
 * IPC and trails a live drag by several frames, which reads as the browser
 * "swimming" inside the window. The panel is right-anchored with a fixed width
 * (vertically it stretches between fixed top and bottom chrome), so the
 * prediction translates the view with the right window edge at constant width
 * and stretches only its height; the next renderer report is authoritative and
 * corrects any drift.
 */
let panelAnchor: { y: number; right: number; bottom: number; width: number } | null = null

export function initPanel(panelHost: PanelHost): void {
  host = panelHost
}

/**
 * The window owning the visible panel, or null. Self-healing: a destroyed
 * owner is forgotten here rather than left to reject panel updates from a
 * window that is legitimately showing the browser.
 */
function panelOwner(): BrowserWindow | null {
  if (panelOwnerWindow?.isDestroyed()) {
    panelOwnerWindow = null
  }
  return panelOwnerWindow
}

/** The window the panel's native view and pushes belong to. */
export function panelWindow(): BrowserWindow | null {
  return panelOwner() ?? host.getMainWindow()
}

/**
 * Whether a window may act on the panel. An unowned panel accepts anyone; once
 * owned, only the owner — so a stale report from a second window cannot hide
 * or steal the singleton browser surface.
 */
export function panelUpdateAllowed(ownerWindow?: BrowserWindow): boolean {
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

/** True while the renderer is reporting a panel rect. */
export function isPanelVisible(): boolean {
  return panelBounds !== null
}

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
export function detachAttachedView(): void {
  const view = attachedView
  const win = hostedWindow
  attachedView = null
  hostedWindow = null
  lastAppliedBounds = ''
  lastAppliedVisibility = null
  panelAnchor = null
  host.onViewDetached(view)

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
 * Detaches only when this exact view is the attached one. Closing a background
 * tab must not pull the visible tab out of the window.
 */
export function detachIfAttached(view: WebContentsView): void {
  if (attachedView === view) {
    detachAttachedView()
  }
}

/**
 * Captures the current browser frame for the renderer to display while the
 * native view is hidden beneath an overlay. Captures stay hidden so Chromium
 * never promotes an occluded page back into the compositor.
 */
function capturePanelSnapshot(): void {
  const active = host.activeTab()
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
 * Repositions the active view over the panel rect inside its window
 * (re-parenting if that window was recreated), and detaches it when the panel
 * is hidden. CSS pixels scale to DIP by the page's zoom factor. Idempotent:
 * repeated calls with unchanged inputs perform no view mutations.
 */
export function layout(): void {
  const win = panelWindow()
  const active = host.activeTab()
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
    panelOwnerWindow = ownerWindow ?? host.getMainWindow()
  } else {
    panelOwnerWindow = null
  }
  panelBounds = bounds
  if (bounds !== null) {
    host.ensureInitialTab()
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
 * keeps its bounds while hidden, avoiding the flicker and restacking caused by
 * removing and re-adding it for every tooltip or menu.
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
