'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BrowserFindResult,
  BrowserPanelAnchor,
  BrowserPanelBounds,
  BrowserPanelSnapshot,
} from '@sim/browser-protocol'
import type { BrowserToolbarCommand } from '@sim/desktop-bridge'
import {
  type BrowserPanelSnapshotLayer,
  createBrowserPanelGeometryOcclusionLease,
  hasNativeSurfaceOcclusion,
  mutationsTouchNativeSurfaceOcclusion,
  NATIVE_SURFACE_OCCLUSION_ATTRIBUTES,
  useBrowserPanelOcclusion,
} from '@/lib/browser-agent/panel-occlusion'
import {
  findInBrowserPage,
  onBrowserFindClose,
  onBrowserFindOpen,
  onBrowserFindResult,
  onBrowserToolbarCommand,
  reportBrowserPanelBounds,
  reportBrowserPanelFocused,
  sendBrowserPanelAction,
  setBrowserPanelOccluded,
  showBrowserToolbarMenu,
  stopBrowserFind,
  supportsAtomicBrowserPanelOcclusion,
} from '@/lib/browser-agent/transport'
import { trackPanelFocus } from '@/lib/desktop/panel-focus'
import {
  type BrowserPageIssueCopy,
  browserPageIssueCopy,
  resolveUrlBarInput,
} from '@/platform/lib/data/browser-page-issue'
import { useBrowserSessionStore } from '@/stores/browser-session/store'
import { MOTHERSHIP_WIDTH } from '@/stores/constants'

/** Re-report unchanged bounds before the main-process visibility lease expires. */
const PANEL_HEARTBEAT_INTERVAL_MS = 1_000

/** The page the desktop browser shows for this chat, as the panel's toolbar reads it. */
interface BrowserPanelPage {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  issue?: BrowserPageIssueCopy
  /** A new tab with nothing loaded; the panel draws its own start view over it. */
  blank: boolean
}

/** Where find-in-page stands: closed, or open with Chromium's latest counts. */
interface BrowserPanelFind {
  open: boolean
  result: BrowserFindResult | null
}

/**
 * Declares how the panel's width follows the viewport, so the shell can re-derive the rect during
 * a live window resize instead of holding one that is a frame stale. A divider drag pins an inline
 * px width on the panel; otherwise it is half the viewport.
 */
function describeAnchor(panel: HTMLElement | null): BrowserPanelAnchor | null {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  if (viewportWidth <= 0 || viewportHeight <= 0) return null
  const pinned = panel?.style.width.endsWith('px') ?? false
  return {
    viewportWidth,
    viewportHeight,
    widthRatio: pinned ? 0 : MOTHERSHIP_WIDTH.DEFAULT_RATIO,
  }
}

/** Places the captured frame on the native view's exact viewport rectangle, below the overlay. */
function placeSnapshot(
  image: HTMLImageElement,
  snapshot: BrowserPanelSnapshot,
  layer: BrowserPanelSnapshotLayer
) {
  image.dataset.layer = layer
  const bounds = snapshot.viewportBounds
  if (!bounds) {
    image.dataset.placement = 'host'
    return
  }
  image.dataset.placement = 'viewport'
  image.style.top = `${bounds.y}px`
  image.style.left = `${bounds.x}px`
  image.style.width = `${bounds.width}px`
  image.style.height = `${bounds.height}px`
}

interface BrowserPanelOptions {
  scopeId: string
  /** Whether this tab is the one on screen in an open panel. */
  visible: boolean
  /** Opens Browser settings at the view a native toolbar command names. */
  onSettings: (query: string) => void
}

/**
 * Hosts the desktop app's native browser view in the chat panel, as the legacy browser tab did:
 * reports the host rect (with a heartbeat that renews the shell's visibility lease), hands the page
 * a captured frame while a dialog, menu or tooltip overlaps it, routes toolbar and find commands,
 * and tells the shell when the panel's own chrome owns keyboard shortcuts.
 */
export function useBrowserPanel({ scopeId, visible, onSettings }: BrowserPanelOptions) {
  const pageState = useBrowserSessionStore((state) => state.sessions[scopeId]?.pageState ?? null)
  const activeTabId = useBrowserSessionStore(
    (state) => state.sessions[scopeId]?.activeTabId ?? null
  )
  const suspended = useBrowserSessionStore((state) => state.sessions[scopeId]?.suspended ?? false)
  const blank = Boolean(
    pageState &&
      !pageState.loading &&
      !pageState.issue &&
      (!pageState.url || pageState.url === 'about:blank')
  )
  const hasRendererPage = Boolean(pageState?.issue) || blank
  const panelRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const getHostRect = useCallback(() => hostRef.current?.getBoundingClientRect() ?? null, [])
  /** Whether the host is actually on screen; the tab can stay mounted while hidden. */
  const [panelVisible, setPanelVisible] = useState(false)
  const [find, setFind] = useState<BrowserPanelFind>({ open: false, result: null })
  const { snapshot, snapshotLayer, onSnapshotError, shouldKeepNativeHidden } =
    useBrowserPanelOcclusion(scopeId, activeTabId, panelVisible, getHostRect)
  const onSettingsRef = useRef(onSettings)
  onSettingsRef.current = onSettings

  useEffect(
    () =>
      onBrowserToolbarCommand((command: BrowserToolbarCommand) => {
        onSettingsRef.current(
          command === 'passwords'
            ? '?browserView=passwords'
            : command === 'import'
              ? '?browserImport=1'
              : ''
        )
      }, scopeId),
    [scopeId]
  )

  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !panelVisible) return
    return trackPanelFocus(panel, (focused) => reportBrowserPanelFocused(focused, scopeId))
  }, [panelVisible, scopeId])

  const openFind = useCallback(() => setFind((current) => ({ ...current, open: true })), [])
  useEffect(() => onBrowserFindOpen(openFind, scopeId), [openFind, scopeId])
  useEffect(
    () => onBrowserFindClose(() => setFind({ open: false, result: null }), scopeId),
    [scopeId]
  )
  useEffect(
    () => onBrowserFindResult((result) => setFind((current) => ({ ...current, result })), scopeId),
    [scopeId]
  )

  // Mod+F with Sim's own chrome focused never reaches the shell; with the page focused the shell
  // calls back through onBrowserFindOpen instead.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !panelVisible) return
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      openFind()
    }
    panel.addEventListener('keydown', handleFindShortcut)
    return () => panel.removeEventListener('keydown', handleFindShortcut)
  }, [panelVisible, openFind])

  // Keeps the embedded view glued to the host rect without forcing layout every frame.
  // ResizeObserver covers panel drags and transitions and reports post-layout; viewport resize and
  // captured scroll defer to the next frame; a one-second heartbeat renews the shell's lease.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (!visible || suspended) {
      setPanelVisible(false)
      reportBrowserPanelBounds(null, null, scopeId)
      return
    }
    if (hasRendererPage) {
      setPanelVisible(true)
      reportBrowserPanelBounds(null, null, scopeId)
      return
    }
    const panel = host.closest<HTMLElement>('[data-mothership-panel]')

    let rafId: number | null = null
    let forceNextReport = false
    let last = ''
    let disposed = false
    let occlusionRequest = 0
    const atomicPanelOcclusion = supportsAtomicBrowserPanelOcclusion()
    const hasRequestedOcclusion = () =>
      atomicPanelOcclusion && (hasNativeSurfaceOcclusion() || shouldKeepNativeHidden())
    let occlusionPresent = hasRequestedOcclusion()
    const geometryOcclusionLease = createBrowserPanelGeometryOcclusionLease((occluded) => {
      if (!occluded && shouldKeepNativeHidden()) return Promise.resolve(true)
      return setBrowserPanelOccluded(occluded, scopeId, occluded).catch(() => false)
    })

    const commitGeometry = (
      bounds: BrowserPanelBounds,
      anchor: BrowserPanelAnchor | null,
      force: boolean
    ) => {
      if (disposed) return
      setPanelVisible(true)
      const key = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
      if (force || key !== last) {
        last = key
        reportBrowserPanelBounds(bounds, anchor, scopeId)
      }
    }

    const reportGeometry = (force: boolean) => {
      const rect = host.getBoundingClientRect()
      const bounds = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
      // A collapsed panel reports null so the native view, which floats above all renderer
      // content, hides now instead of lingering until its lease expires.
      if (bounds.width <= 0 || bounds.height <= 0) {
        occlusionRequest++
        geometryOcclusionLease.assumeRevealed()
        void geometryOcclusionLease.setDesired(false)
        setPanelVisible(false)
        if (last !== 'hidden') {
          last = 'hidden'
          reportBrowserPanelBounds(null, null, scopeId)
        }
        return
      }

      const anchor = describeAnchor(panel)
      const nativeSurfaceOcclusionPresent = hasRequestedOcclusion()
      const request = ++occlusionRequest

      if (
        nativeSurfaceOcclusionPresent ||
        geometryOcclusionLease.isOccluded() ||
        geometryOcclusionLease.isTransitioning()
      ) {
        // A Browser that becomes visible under an open dialog has no painted frame to swap, so the
        // hidden lease is established before the bounds: the view attaches hidden from its first
        // frame. The reassert is real each heartbeat, recovering a lease the shell let expire.
        if (nativeSurfaceOcclusionPresent) geometryOcclusionLease.assumeRevealed()
        void geometryOcclusionLease.setDesired(nativeSurfaceOcclusionPresent).then((settled) => {
          if (disposed) return
          if (
            request !== occlusionRequest ||
            hasRequestedOcclusion() !== nativeSurfaceOcclusionPresent
          ) {
            scheduleGeometryReport(true)
            return
          }
          if (!settled) return
          commitGeometry(bounds, anchor, force)
        })
        return
      }

      commitGeometry(bounds, anchor, force)
    }

    const scheduleGeometryReport = (force = false) => {
      forceNextReport ||= force
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const shouldForce = forceNextReport
        forceNextReport = false
        reportGeometry(shouldForce)
      })
    }

    const handleGeometryChange = () => scheduleGeometryReport()
    // A chat may be open in more than one window: reclaim the native view on OS focus.
    const handleWindowFocus = () => scheduleGeometryReport(true)
    const resizeObserver = new ResizeObserver(() => reportGeometry(false))
    const occlusionObserver = new MutationObserver((records) => {
      if (!mutationsTouchNativeSurfaceOcclusion(records)) return
      const next = hasRequestedOcclusion()
      if (next === occlusionPresent) return
      occlusionPresent = next
      scheduleGeometryReport(true)
    })
    resizeObserver.observe(host)
    if (atomicPanelOcclusion) {
      occlusionObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: NATIVE_SURFACE_OCCLUSION_ATTRIBUTES,
      })
    }
    window.addEventListener('resize', handleGeometryChange)
    window.addEventListener('scroll', handleGeometryChange, true)
    window.addEventListener('focus', handleWindowFocus)
    const heartbeatTimer = window.setInterval(
      () => scheduleGeometryReport(true),
      PANEL_HEARTBEAT_INTERVAL_MS
    )
    scheduleGeometryReport(true)

    return () => {
      disposed = true
      occlusionRequest++
      resizeObserver.disconnect()
      occlusionObserver.disconnect()
      window.removeEventListener('resize', handleGeometryChange)
      window.removeEventListener('scroll', handleGeometryChange, true)
      window.removeEventListener('focus', handleWindowFocus)
      window.clearInterval(heartbeatTimer)
      if (rafId !== null) cancelAnimationFrame(rafId)
      geometryOcclusionLease.assumeRevealed()
      void geometryOcclusionLease.setDesired(false)
      reportBrowserPanelBounds(null, null, scopeId)
    }
  }, [hasRendererPage, visible, suspended, scopeId, shouldKeepNativeHidden])

  const shownSnapshot =
    snapshot && (snapshotLayer === 'modal' || !activeTabId || snapshot.tabId === activeTabId)
      ? snapshot
      : null
  const snapshotRef = useCallback(
    (image: HTMLImageElement | null) => {
      if (image && shownSnapshot) placeSnapshot(image, shownSnapshot, snapshotLayer)
    },
    [shownSnapshot, snapshotLayer]
  )

  const page: BrowserPanelPage | null = pageState
    ? {
        url: pageState.url,
        title: pageState.title,
        loading: pageState.loading,
        canGoBack: pageState.canGoBack,
        canGoForward: pageState.canGoForward,
        issue: pageState.issue ? browserPageIssueCopy(pageState.issue) : undefined,
        blank,
      }
    : null

  return {
    page,
    panelRef,
    hostRef,
    snapshot: shownSnapshot
      ? {
          src: shownSnapshot.dataUrl,
          ref: snapshotRef,
          /** Positioned on the viewport, outside any containing block; otherwise it fills the host. */
          viewport: Boolean(shownSnapshot.viewportBounds),
        }
      : null,
    onSnapshotError,
    find,
    back: () => sendBrowserPanelAction('back', {}, scopeId),
    forward: () => sendBrowserPanelAction('forward', {}, scopeId),
    reload: () => sendBrowserPanelAction('reload', {}, scopeId),
    navigate: (raw: string) => {
      if (raw.trim()) sendBrowserPanelAction('navigate', { url: resolveUrlBarInput(raw) }, scopeId)
    },
    /** Opens the shell's native toolbar menu, which draws above the page with no capture. */
    openMenu: (anchor: HTMLElement) => {
      const rect = anchor.getBoundingClientRect()
      showBrowserToolbarMenu({ x: rect.left, y: rect.bottom }, scopeId)
    },
    openFind,
    search: (query: string, forward: boolean, newSession: boolean) => {
      if (!query) {
        stopBrowserFind(false, scopeId)
        setFind({ open: true, result: null })
        return
      }
      findInBrowserPage({ query, forward, newSession }, scopeId)
    },
    closeFind: () => {
      stopBrowserFind(true, scopeId)
      setFind({ open: false, result: null })
    },
  }
}
