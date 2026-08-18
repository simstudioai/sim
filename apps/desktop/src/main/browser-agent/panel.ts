/**
 * Compositing for the embedded browser: where the native view sits inside a
 * Sim window, when it is visible, and which window owns it.
 *
 * The browser is ONE native surface shared by every app window, so exactly one
 * window may drive it at a time. That and the renderer bounds lease are kept
 * here, apart from tab bookkeeping.
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
import { zoomPercentOf } from '@/main/browser-agent/context-menu'
import type { AgentTab } from '@/main/browser-agent/session'
import { reassertTabThrottling } from '@/main/browser-agent/session'

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
  /** Native backdrop used by a blank tab before its first page paint. */
  backgroundColor: () => string
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
  backgroundColor: () => '#ffffff',
  ensureInitialTab: () => {},
  onViewDetached: () => {},
}

/** Where the panel sits in the window (CSS px); null = panel hidden. */
let panelBounds: BrowserPanelBounds | null = null
/** How {@link panelBounds} derives from the viewport, when the renderer said. */
let panelAnchor: BrowserPanelAnchor | null = null
/** True only after a replacement frame has painted in Sim's renderer. */
let panelOccluded = false
/** Window whose renderer currently owns the native-surface replacement lease. */
let occlusionOwnerWindow: BrowserWindow | null = null
/** Invalidates captures when ownership, scope, or panel visibility changes. */
let panelCaptureGeneration = 0
let panelLeaseAt = 0
let leaseTimer: ReturnType<typeof setInterval> | null = null
/** Chat whose native browser surface may currently be composited. */
let activePanelScopeId: string | null = null
/** The window currently hosting the active view, for re-parenting checks. */
let hostedWindow: BrowserWindow | null = null
/** The app window whose renderer most recently leased the visible panel. */
let panelOwnerWindow: BrowserWindow | null = null
/** The view attached to the host window (attach only on change — re-adding an
 * attached view re-stacks it and can flicker the composite). */
let attachedView: WebContentsView | null = null
let lastAppliedBounds = ''
let lastAppliedVisibility: boolean | null = null
interface OccludablePanelFrame {
  view: WebContentsView
  win: BrowserWindow
  scopeId: string
  tabId: string
  shellZoom: number
  nativeBounds: BrowserPanelBounds
}
/** Geometry of the painted frame that is currently allowed to replace the view. */
let occludableFrame: OccludablePanelFrame | null = null
/** The host window whose `resize` currently drives {@link layout}, if any. */
let resizeBoundWindow: BrowserWindow | null = null
/** Captures nothing, so one instance serves every window it is bound to. */
const onHostResize = () => layout()

export function initPanel(panelHost: PanelHost): void {
  // A real reset, not a partial setter. Everything below is per-session state,
  // and this call IS the session boundary — anything left behind is inherited
  // by the next session: a stale owner window that rejects legitimate panel
  // updates, a lease timer polling for a panel that no longer exists, a
  // `lastApplied*` value that dedupes away the first layout of the new one.
  detachAttachedView()
  resetOcclusion()
  if (leaseTimer !== null) {
    clearInterval(leaseTimer)
    leaseTimer = null
  }
  host = panelHost
  panelBounds = null
  panelAnchor = null
  panelLeaseAt = 0
  panelOwnerWindow = null
  activePanelScopeId = null
}

/**
 * Moves the singleton compositor to another chat. Bounds are renderer leases,
 * so the new chat must report its own rect before any native page is shown.
 */
export function activatePanelScope(scopeId: string | null): void {
  if (activePanelScopeId === scopeId) return
  activePanelScopeId = scopeId
  resetOcclusion()
  detachAttachedView()
  panelBounds = null
  panelAnchor = null
  panelLeaseAt = 0
  panelOwnerWindow = null
}

/** Retags an active pending scope without tearing down the compositor. */
export function migratePanelScope(fromScopeId: string, toScopeId: string): void {
  if (activePanelScopeId !== fromScopeId) return
  activePanelScopeId = toScopeId
  panelCaptureGeneration++
}

export function getActivePanelScopeId(): string | null {
  return activePanelScopeId
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
export function panelUpdateAllowed(
  ownerWindow?: BrowserWindow,
  scopeId = activePanelScopeId
): boolean {
  if (!scopeId || scopeId !== activePanelScopeId) return false
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
  focusedWindow: BrowserWindow | null,
  scopeId = activePanelScopeId
): boolean {
  if (!scopeId || scopeId !== activePanelScopeId) return false
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
function detachAttachedView(): void {
  const view = attachedView
  const win = hostedWindow
  attachedView = null
  hostedWindow = null
  lastAppliedBounds = ''
  lastAppliedVisibility = null
  occludableFrame = null
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

/** Reveals the native view and invalidates every frame captured for its old state. */
function resetOcclusion(): void {
  panelOccluded = false
  occlusionOwnerWindow = null
  occludableFrame = null
  panelCaptureGeneration++
}

/**
 * Stops the attached view painting without giving up its compositor surface,
 * so showing it again is immediate when the browser resource becomes visible.
 */
function hideAttachedView(): void {
  const view = attachedView
  if (!view || lastAppliedVisibility === false) return
  lastAppliedVisibility = false
  // Nothing to re-lay-out while hidden; the showing path rebinds.
  unbindHostResize()
  try {
    if (!view.webContents.isDestroyed()) view.setVisible(false)
  } catch (error) {
    logger.warn('Could not hide embedded browser view', {
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

  // Detach only when the attached view cannot stay where it is: no tab is
  // active, a different tab took over, or the hosting window changed.
  //
  // A panel hidden behind another resource keeps its view attached and invisible:
  // removing the view gives up its compositor surface, and rebuilding it is a
  // blank repaint that reads as the page having reloaded. Every switch to
  // another resource and back hides the panel, so that was every switch.
  if (
    attachedView !== null &&
    (active === null || win === null || hostedWindow !== win || attachedView !== active.view)
  ) {
    detachAttachedView()
  }
  if (!showing || !active || !win || panelBounds === null) {
    hideAttachedView()
    return
  }

  if (attachedView !== active.view) {
    // addChildView hands keyboard focus to the newly attached WebContentsView.
    // Agent-driven attaches happen while the user may be typing in the chat
    // composer, so if the renderer held focus before the attach, give it back —
    // automation drives the page over CDP and never needs OS focus.
    const rendererHadFocus = !win.webContents.isDestroyed() && win.webContents.isFocused()
    win.contentView.addChildView(active.view)
    hostedWindow = win
    attachedView = active.view
    if (rendererHadFocus) {
      win.webContents.focus()
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
    occludableFrame = null
    active.view.setBounds(bounds)
  }
  const visible = !panelOccluded
  if (lastAppliedVisibility !== visible) {
    lastAppliedVisibility = visible
    active.view.setVisible(visible)
    if (visible && !active.view.webContents.isDestroyed()) {
      // invalidate() recomposites the LAST frame — which is blank when the
      // page finished loading while this view was hidden and background
      // throttling suspended the rAF its SPA paints from. The page then sits
      // "loaded" but white until the user re-navigates by hand. Pulse
      // throttling off so the renderer actually produces a first frame, then
      // hand the policy back to the session (which keeps the automation-tab
      // exemption intact).
      const contents = active.view.webContents
      contents.setBackgroundThrottling(false)
      contents.invalidate()
      setTimeout(() => {
        if (!contents.isDestroyed()) reassertTabThrottling()
      }, 1_000)
    }
  }
}

/** Converts the applied native DIP rectangle back into Sim viewport CSS pixels. */
function viewportBoundsFor(
  nativeBounds: BrowserPanelBounds,
  shellZoom: number
): BrowserPanelBounds {
  return {
    x: nativeBounds.x / shellZoom,
    y: nativeBounds.y / shellZoom,
    width: nativeBounds.width / shellZoom,
    height: nativeBounds.height / shellZoom,
  }
}

function sameBounds(left: BrowserPanelBounds, right: BrowserPanelBounds): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

function frameGeometryIsCurrent(frame: OccludablePanelFrame): boolean {
  return (
    activePanelScopeId === frame.scopeId &&
    host.activeTab()?.id === frame.tabId &&
    attachedView === frame.view &&
    panelWindow() === frame.win &&
    !frame.win.isDestroyed() &&
    !frame.view.webContents.isDestroyed() &&
    frame.win.webContents.getZoomFactor() === frame.shellZoom &&
    sameBounds(frame.view.getBounds(), frame.nativeBounds)
  )
}

/** A blank tab needs only its native backdrop, not a compositor capture. */
function blankSnapshot(
  scopeId: string,
  tabId: string,
  zoomPercent: number,
  viewportBounds: BrowserPanelBounds
): BrowserPanelSnapshot {
  return {
    scopeId,
    tabId,
    zoomPercent,
    viewportBounds,
    dataUrl: `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path fill="${host.backgroundColor()}" d="M0 0h1v1H0z"/></svg>`
    )}`,
  }
}

/**
 * Captures the compositor surface without resizing or lossy encoding.
 *
 * This image temporarily replaces the native view while renderer-owned chrome
 * is open, so any scaling or JPEG compression is visible as a veil over the
 * page. Keeping the frame at native resolution and in PNG makes that surface
 * swap visually seamless.
 */
export async function capturePanelSnapshot(
  ownerWindow?: BrowserWindow,
  scopeId = activePanelScopeId
): Promise<BrowserPanelSnapshot | null> {
  if (
    !scopeId ||
    !panelUpdateAllowed(ownerWindow, scopeId) ||
    panelBounds === null ||
    panelOccluded
  ) {
    return null
  }
  const active = host.activeTab()
  const win = panelWindow()
  if (!active || !win || active.view.webContents.isDestroyed()) return null

  // Ensure the snapshot describes the bounds Electron is actually painting,
  // not merely the renderer host that requested them.
  layout()
  if (attachedView !== active.view) return null

  const generation = ++panelCaptureGeneration
  occludableFrame = null
  const tabId = active.id
  const contents = active.view.webContents
  const shellZoom = win.webContents.getZoomFactor()
  const nativeBounds = active.view.getBounds()
  const frame: OccludablePanelFrame = {
    view: active.view,
    win,
    scopeId,
    tabId,
    shellZoom,
    nativeBounds,
  }
  const viewportBounds = viewportBoundsFor(nativeBounds, shellZoom)
  const zoomPercent = zoomPercentOf(contents.getZoomFactor())
  const url = contents.getURL()
  if (url === '' || url === 'about:blank') {
    if (!frameGeometryIsCurrent(frame)) return null
    occludableFrame = frame
    return blankSnapshot(scopeId, tabId, zoomPercent, viewportBounds)
  }
  try {
    const image = await contents.capturePage(undefined, { stayHidden: false })
    if (
      generation !== panelCaptureGeneration ||
      scopeId !== activePanelScopeId ||
      host.activeTab()?.id !== tabId ||
      panelWindow() !== win ||
      win.isDestroyed() ||
      !frameGeometryIsCurrent(frame) ||
      image.isEmpty()
    ) {
      return null
    }
    const snapshot: BrowserPanelSnapshot = {
      scopeId,
      tabId,
      zoomPercent,
      viewportBounds,
      dataUrl: image.toDataURL(),
    }
    occludableFrame = frame
    return snapshot
  } catch (error) {
    logger.warn('Could not capture browser panel for a toolbar menu', {
      error: getErrorMessage(error, 'unknown'),
    })
    return null
  }
}

/**
 * Swaps the native page only after the renderer confirms its exact frame has
 * painted. Hiding changes visibility alone: bounds and compositor attachment
 * remain untouched, so revealing cannot relayout or restack the page.
 */
export function setPanelOccluded(
  occluded: boolean,
  ownerWindow?: BrowserWindow,
  scopeId = activePanelScopeId,
  force = false
): boolean {
  if (!scopeId) return false

  if (scopeId !== activePanelScopeId) {
    const currentOwner = occlusionOwnerWindow ?? panelOwner() ?? host.getMainWindow()
    const requesterOwnsNativeSurface =
      !ownerWindow || currentOwner === null || ownerWindow === currentOwner

    // Every app window has its own renderer modal state, but the Browser is a
    // singleton native surface hosted by only one of them. A background
    // renderer on another chat therefore has nothing local to hide or reveal.
    // Acknowledge its forced modal lease as a scoped no-op so its strict
    // pre-paint gate can proceed, while still rejecting stale requests from
    // the window that actually owns the native surface.
    if (!requesterOwnsNativeSurface && !occluded) return true
    if (
      !requesterOwnsNativeSurface &&
      force &&
      ownerWindow &&
      !ownerWindow.isDestroyed() &&
      !ownerWindow.isFocused()
    ) {
      return true
    }
    return false
  }

  // Once ownership has transferred, an old renderer still needs to retire its
  // local replacement when its modal closes. The old lease was released by
  // the transfer, so revealing an already-visible panel is a scoped no-op.
  if (!occluded && !panelOccluded) return true
  // Another focused window may have replaced this renderer's lease with its
  // own modal lease. Retiring the displaced renderer's local snapshot is also
  // a no-op: it must not reveal the CURRENT owner's still-occluded view.
  if (!occluded && ownerWindow && occlusionOwnerWindow && ownerWindow !== occlusionOwnerWindow) {
    return true
  }

  const panelAllowed = panelUpdateAllowed(ownerWindow, scopeId)
  const focusedForceTransfer =
    occluded &&
    force &&
    !panelAllowed &&
    Boolean(ownerWindow && !ownerWindow.isDestroyed() && ownerWindow.isFocused())
  const forceWithoutLocalSurface =
    occluded &&
    force &&
    !panelAllowed &&
    Boolean(ownerWindow && !ownerWindow.isDestroyed() && !ownerWindow.isFocused())
  // An unfocused non-owner window has no native view in its compositor. It can
  // safely open its own renderer modal without mutating the focused/owning
  // window's lease. If it later gains focus while the marker remains, the
  // bounds-report guard establishes a real hidden lease before transfer.
  if (forceWithoutLocalSurface) return true
  if (!panelAllowed && !focusedForceTransfer) return false

  // A focused second window can open a modal before its next rAF reports new
  // panel bounds. Transfer a HIDDEN, bounds-less lease atomically: the old
  // window stops painting now and the new window's first bounds attach the
  // singleton already hidden. Clearing the old rect also prevents a reveal at
  // another window's geometry if the modal closes unusually quickly.
  if (focusedForceTransfer && ownerWindow) {
    panelOwnerWindow = ownerWindow
    panelBounds = null
    panelAnchor = null
    panelLeaseAt = 0
    panelOccluded = true
    occlusionOwnerWindow = ownerWindow
    occludableFrame = null
    panelCaptureGeneration++
    layout()
    return true
  }

  if (!occluded) {
    if (ownerWindow && occlusionOwnerWindow && ownerWindow !== occlusionOwnerWindow) return false
    panelOccluded = false
    occlusionOwnerWindow = null
    occludableFrame = null
    layout()
    return true
  }

  // A pre-paint modal handshake can arrive one React commit before the panel
  // reports its first bounds. A forced lease must still stick in that state so
  // a view attached later in the same frame starts hidden, rather than briefly
  // punching through the already-visible renderer effect.
  if (occluded && (panelBounds === null || host.activeTab() === null) && !force) return false
  if (panelOccluded) {
    return !ownerWindow || !occlusionOwnerWindow || ownerWindow === occlusionOwnerWindow
  }
  layout()
  // The lossless frame is the normal path. A full-screen renderer effect
  // may explicitly force the final fallback after capture/geometry retries:
  // a temporarily blank/blurred host is preferable to a native rectangle
  // punching above a modal or global takeover. Ordinary popovers never force
  // this path because they must remain pixel-neutral.
  if ((!occludableFrame || !frameGeometryIsCurrent(occludableFrame)) && !force) return false
  panelOccluded = true
  occlusionOwnerWindow = ownerWindow ?? panelWindow()
  occludableFrame = null
  layout()
  return true
}

/**
 * Renderer-reported panel rect (null = panel hidden/unmounted). When an owner
 * is supplied, stale reports from another app window cannot steal or hide the
 * singleton browser surface.
 */
export function setPanelBounds(
  bounds: BrowserPanelBounds | null,
  ownerWindow?: BrowserWindow,
  anchor?: BrowserPanelAnchor,
  scopeId = activePanelScopeId
): void {
  if (!scopeId || scopeId !== activePanelScopeId) return
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
    const nextOwner = ownerWindow ?? host.getMainWindow()
    // Occlusion belongs to a renderer window, not to the mutable singleton.
    // Moving the native view to another window releases the previous window's
    // lease; the new owner must establish its own if it also has a modal.
    if (occlusionOwnerWindow && nextOwner !== occlusionOwnerWindow) resetOcclusion()
    panelOwnerWindow = nextOwner
  } else {
    panelOwnerWindow = null
  }
  panelBounds = bounds
  panelAnchor = bounds === null ? null : (anchor ?? null)
  if (bounds !== null) {
    host.ensureInitialTab()
  } else {
    resetOcclusion()
  }
  panelLeaseAt = Date.now()
  if (bounds !== null && leaseTimer === null) {
    leaseTimer = setInterval(() => {
      if (panelBounds !== null && Date.now() - panelLeaseAt > PANEL_LEASE_TTL_MS) {
        logger.info('Panel bounds lease expired; hiding embedded browser view')
        panelBounds = null
        panelOwnerWindow = null
        resetOcclusion()
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
