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
import type {
  BrowserPanelAnchor,
  BrowserPanelBounds,
  BrowserPanelSnapshot,
} from '@sim/browser-protocol'
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
/** How {@link panelBounds} derives from the viewport, when the renderer said. */
let panelAnchor: BrowserPanelAnchor | null = null
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
/** The host window whose `resize` currently drives {@link layout}, if any. */
let resizeBoundWindow: BrowserWindow | null = null
/** Captures nothing, so one instance serves every window it is bound to. */
const onHostResize = () => layout()

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

/**
 * Re-lays-out on the host window's own `resize` (~68/sec during a live drag, one
 * per resize step) so the view tracks the frame it is actually in.
 *
 * @see layout — the resize is a trigger, never a source of bounds.
 */
function bindHostResize(win: BrowserWindow): void {
  if (resizeBoundWindow === win) return
  unbindHostResize()
  win.on('resize', onHostResize)
  resizeBoundWindow = win
}

function unbindHostResize(): void {
  if (resizeBoundWindow && !resizeBoundWindow.isDestroyed()) {
    resizeBoundWindow.removeListener('resize', onHostResize)
  }
  resizeBoundWindow = null
}

/**
 * Re-derives the rect for a viewport the renderer has not measured yet, from the
 * rule it declared plus the rect it measured at `anchor`'s own viewport.
 * Everything but the width ratio falls out of that pair: the insets are
 * size-invariant, and the width residual is whatever the ratio leaves over.
 *
 * Null when the viewport still matches the measured one, so the measurement
 * wins wherever it is exact and a wrong ratio can only reach live-resize frames.
 */
function evaluateAnchor(
  anchor: BrowserPanelAnchor | null,
  measured: BrowserPanelBounds,
  viewportWidth: number,
  viewportHeight: number
): BrowserPanelBounds | null {
  if (
    anchor === null ||
    (viewportWidth === anchor.viewportWidth && viewportHeight === anchor.viewportHeight)
  ) {
    return null
  }
  const widthOffset = measured.width - anchor.viewportWidth * anchor.widthRatio
  const rightInset = anchor.viewportWidth - (measured.x + measured.width)
  const bottom = anchor.viewportHeight - (measured.y + measured.height)
  const width = viewportWidth * anchor.widthRatio + widthOffset
  return {
    x: viewportWidth - rightInset - width,
    y: measured.y,
    width,
    height: viewportHeight - measured.y - bottom,
  }
}

/**
 * Confines a rect to the window's content box, and owns the 1px floor for the
 * whole path. Pure constraint — it needs no model of where the panel sits.
 */
function clampToContent(
  rect: BrowserPanelBounds,
  contentWidth: number,
  contentHeight: number
): BrowserPanelBounds {
  const x = Math.min(Math.max(0, rect.x), Math.max(0, contentWidth - 1))
  const y = Math.min(Math.max(0, rect.y), Math.max(0, contentHeight - 1))
  return {
    x,
    y,
    width: Math.max(1, Math.min(rect.width, contentWidth - x)),
    height: Math.max(1, Math.min(rect.height, contentHeight - y)),
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
  unbindHostResize()
  host.onViewDetached(view)

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
 *
 * The renderer's measured report is the ONLY writer of bounds. This module
 * used to also predict a rect on the window's own `resize` event, on the
 * premise that the panel was right-anchored at a constant width — true only
 * after a divider drag pins an inline pixel width. The panel's default is
 * `w-1/2`, so the prediction was wrong by half the frame's window travel and,
 * because it shared this dedup key, the two writers each invalidated the
 * other's key and applied a different rect twice per frame. That double
 * compositor resize was the "swimming" the prediction was meant to prevent.
 * A divider drag still gets a predicted rect, from the renderer, where the
 * arithmetic is exact because only the panel's left edge moves.
 *
 * The window's `resize` does drive this function (see {@link bindHostResize}),
 * but only as a trigger — it supplies no rect. The report the renderer already
 * sent is re-clamped against the new content box, so a shrink can never leave
 * the view overhanging the frame while that report is one frame stale. The
 * clamp needs no model of where the panel sits, which is exactly what the
 * reverted prediction did need. Bounds keep one writer and one dedup key, so
 * the contention above cannot recur: on a grow the clamp is inert and the key
 * is unchanged, costing no view mutation at all.
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
    hostedWindow = win
    attachedView = active.view
    if (panelOccluded && activeViewChanged) {
      capturePanelSnapshot()
    }
  }
  bindHostResize(win)
  const zoom = win.webContents.getZoomFactor()
  const [contentWidth, contentHeight] = win.getContentSize()
  // The anchor is declared in the renderer's CSS pixels, so compare and
  // evaluate there, then scale the result the same way a measured rect is.
  const rect =
    evaluateAnchor(panelAnchor, panelBounds, contentWidth / zoom, contentHeight / zoom) ??
    panelBounds
  const bounds = clampToContent(
    {
      x: Math.round(rect.x * zoom),
      y: Math.round(rect.y * zoom),
      width: Math.round(rect.width * zoom),
      height: Math.round(rect.height * zoom),
    },
    contentWidth,
    contentHeight
  )
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
  ownerWindow?: BrowserWindow,
  anchor?: BrowserPanelAnchor
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
  panelAnchor = bounds === null ? null : (anchor ?? null)
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
