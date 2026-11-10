'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BrowserFindResult,
  BrowserMediaPermissionRequest,
  BrowserPagePromptResponse,
  BrowserPanelAnchor,
  BrowserPanelBounds,
  BrowserPanelSnapshot,
  BrowserSitePermissionRequest,
} from '@sim/browser-protocol'
import { isBrowserTheme } from '@sim/browser-protocol'
import type {
  BrowserAddToChatPayload,
  BrowserDownloadInfo,
  BrowserToolbarCommand,
  DesktopAppearanceTheme,
} from '@sim/desktop-bridge'
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
  loadBrowserDownloads,
  onBrowserAddToChat,
  onBrowserAppearanceThemeChanged,
  onBrowserDownloadsState,
  onBrowserFillAvailability,
  onBrowserFindClose,
  onBrowserFindOpen,
  onBrowserFindResult,
  onBrowserToolbarCommand,
  reportBrowserPanelBounds,
  reportBrowserPanelFocused,
  reportBrowserTheme,
  sendBrowserPanelAction,
  setBrowserPanelOccluded,
  showBrowserCredentialChooser,
  showBrowserDownloadInFolder,
  showBrowserDownloadsMenu,
  showBrowserToolbarMenu,
  stopBrowserFind,
  supportsAtomicBrowserPanelOcclusion,
} from '@/lib/browser-agent/transport'
import { getDesktopBridge } from '@/lib/desktop'
import {
  loadDesktopBrowserAppearanceTheme,
  resolveDesktopAppearanceTheme,
} from '@/lib/desktop/appearance'
import { trackPanelFocus } from '@/lib/desktop/panel-focus'
import { addMothershipContexts } from '@/lib/mothership/events'
import {
  type BrowserPageIssueCopy,
  browserPageIssueCopy,
} from '@/platform/lib/data/browser-page-issue'
import { useSurfaceTheme } from '@/platform/lib/data/surface-theme'
import { useBrowserSessionStore } from '@/stores/browser-session/store'
import { MOTHERSHIP_WIDTH } from '@/stores/constants'

/** The page selection the shell hands over from its Add to chat menu, as a chat context. */
function browserSelectionContext({ text, tabId, url, title }: BrowserAddToChatPayload) {
  return {
    kind: 'browser_tab' as const,
    tabId,
    label: 'Browser',
    selection: { text, ...(url ? { url } : {}), ...(title ? { title } : {}) },
  }
}

/** Keeps a click or keystroke aimed at the page from answering a prompt as it appears. */
const ACTIVATION_DELAY_MS = 500

/**
 * False until a page-raised prompt has been on screen long enough to be read. Hiding it disarms it
 * again, so a prompt shown after waiting behind another dialog starts its delay when it appears.
 */
export function useActivationDelay(visible: boolean): boolean {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!visible) {
      setArmed(false)
      return
    }
    const timer = setTimeout(() => setArmed(true), ACTIVATION_DELAY_MS)
    return () => clearTimeout(timer)
  }, [visible])
  return armed
}

/** Covers every prompt kind across the admitted native tabs without unbounded retention. */
const MAX_ANSWERED_REQUESTS = 256

/** Claims the one renderer answer the shell accepts for a page request. */
function claimAnswer(answered: Set<string>, requestId: string): boolean {
  if (answered.has(requestId)) return false
  answered.add(requestId)
  while (answered.size > MAX_ANSWERED_REQUESTS) {
    const oldest = answered.values().next().value
    if (typeof oldest !== 'string') break
    answered.delete(oldest)
  }
  return true
}

type PermissionRequest = BrowserMediaPermissionRequest | BrowserSitePermissionRequest

/** What a page's permission request asks, in the words the legacy browser used. */
function permissionCopy(request: PermissionRequest): { title: string; description: string } {
  if ('tabId' in request)
    return {
      title: 'Open another website',
      description: `This page wants to open ${request.origin}. Allow this destination for the rest of this browser task? Only continue if you trust this website.`,
    }
  const devices = request.devices.join(' and ')
  return {
    title: `Allow ${request.origin} to use your ${devices}`,
    description: `Allowing gives this page access to your ${devices} until it navigates. Block if you did not expect this request.`,
  }
}

/** Aggregate byte progress for the toolbar rail; unknown-size downloads are ignored. */
function aggregateDownloadPercent(downloads: BrowserDownloadInfo[]): number | null {
  const measurable = downloads.filter(
    (download) => download.state === 'progressing' && download.totalBytes > 0
  )
  const total = measurable.reduce((sum, download) => sum + download.totalBytes, 0)
  if (total <= 0) return null
  const received = measurable.reduce((sum, download) => sum + download.receivedBytes, 0)
  return Math.min(100, Math.max(0, Math.round((received / total) * 100)))
}

/** Compact, stable byte labels for the right edge of a download row. */
function formatDownloadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

function downloadDetail(download: BrowserDownloadInfo): string {
  if (download.state === 'progressing' && download.totalBytes > 0) {
    return `${formatDownloadBytes(download.receivedBytes)} / ${formatDownloadBytes(download.totalBytes)}`
  }
  return formatDownloadBytes(Math.max(download.receivedBytes, download.totalBytes))
}

/** How long the toolbar shows a check after a download finishes. */
const DOWNLOAD_COMPLETED_FLASH_MS = 1_200

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
 * Hosts the desktop app's native browser view in the chat panel:
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
  const answeredRef = useRef<Set<string> | null>(null)
  const answered = (answeredRef.current ??= new Set())
  const permission = pageState?.sitePermissionRequest ?? pageState?.mediaPermissionRequest
  const [answeredPermission, setAnsweredPermission] = useState<string | null>(null)
  const decidePermission = useCallback(
    (request: PermissionRequest, allowed: boolean) => {
      if (!claimAnswer(answered, request.requestId)) return
      setAnsweredPermission(request.requestId)
      sendBrowserPanelAction(
        'tabId' in request ? 'respond-site-permission' : 'respond-media-permission',
        { requestId: request.requestId, allowed },
        scopeId
      )
    },
    [answered, scopeId]
  )
  // A permission request on a tab nobody can see is refused rather than left waiting.
  useEffect(() => {
    if (!visible && permission) decidePermission(permission, false)
  }, [visible, permission, decidePermission])
  // The shell answers page dialogs and refuses page prompts until the panel says it shows them.
  useEffect(() => {
    sendBrowserPanelAction('enable-page-dialogs', { pagePrompts: true }, scopeId)
  }, [scopeId])
  const panelRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const getHostRect = useCallback(() => hostRef.current?.getBoundingClientRect() ?? null, [])
  /** Whether the host is actually on screen; the tab can stay mounted while hidden. */
  const [panelVisible, setPanelVisible] = useState(false)
  const [find, setFind] = useState<BrowserPanelFind>({ open: false, result: null })
  const {
    activeOverlay,
    requestOverlay,
    closeOverlay,
    snapshot,
    snapshotLayer,
    onSnapshotError,
    shouldKeepNativeHidden,
  } = useBrowserPanelOcclusion(scopeId, activeTabId, panelVisible, getHostRect)
  const requestSuggestions = useCallback(
    () => void requestOverlay('suggestions', () => {}),
    [requestOverlay]
  )
  const closeSuggestions = useCallback(() => void closeOverlay('suggestions'), [closeOverlay])
  const [fillAvailable, setFillAvailable] = useState(false)
  useEffect(() => onBrowserFillAvailability(setFillAvailable, scopeId), [scopeId])
  const onSettingsRef = useRef(onSettings)
  onSettingsRef.current = onSettings
  const [panelElement, setPanelElement] = useState<HTMLDivElement | null>(null)
  const surfaceTheme = useSurfaceTheme(panelElement)
  const [appearanceTheme, setAppearanceTheme] = useState<DesktopAppearanceTheme | null>(null)

  // Embedded pages follow Sim's appearance, or the browser's own choice in desktop settings.
  useEffect(() => {
    let active = true
    void loadDesktopBrowserAppearanceTheme().then((next) => {
      if (active) setAppearanceTheme(next)
    })
    const unsubscribe = onBrowserAppearanceThemeChanged(setAppearanceTheme)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  useEffect(() => {
    if (!appearanceTheme) return
    const next = resolveDesktopAppearanceTheme(appearanceTheme, surfaceTheme)
    if (isBrowserTheme(next)) reportBrowserTheme(next)
  }, [appearanceTheme, surfaceTheme])

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

  const [downloads, setDownloads] = useState<BrowserDownloadInfo[]>([])
  const downloadsRef = useRef<BrowserDownloadInfo[]>([])
  /** A download finished since the list was last opened. */
  const [unviewedCompletion, setUnviewedCompletion] = useState(false)
  /** Briefly true after a download finishes, while the toolbar shows a check. */
  const [justCompleted, setJustCompleted] = useState(false)
  useEffect(() => {
    let active = true
    let flashTimer: number | null = null
    downloadsRef.current = []
    setDownloads([])
    setUnviewedCompletion(false)
    setJustCompleted(false)
    void loadBrowserDownloads(scopeId).then((state) => {
      if (!active) return
      downloadsRef.current = state.downloads
      setDownloads(state.downloads)
    })
    const unsubscribe = onBrowserDownloadsState((state) => {
      const prior = new Map(downloadsRef.current.map((download) => [download.id, download.state]))
      const completed = state.downloads.some(
        (download) => download.state === 'completed' && prior.get(download.id) !== 'completed'
      )
      downloadsRef.current = state.downloads
      setDownloads(state.downloads)
      if (!completed) return
      setUnviewedCompletion(true)
      setJustCompleted(true)
      if (flashTimer !== null) window.clearTimeout(flashTimer)
      flashTimer = window.setTimeout(() => {
        flashTimer = null
        setJustCompleted(false)
      }, DOWNLOAD_COMPLETED_FLASH_MS)
    }, scopeId)
    return () => {
      active = false
      unsubscribe()
      if (flashTimer !== null) window.clearTimeout(flashTimer)
    }
  }, [scopeId])

  useEffect(
    () =>
      onBrowserAddToChat((payload) => {
        addMothershipContexts([browserSelectionContext(payload)])
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

  const permissionShown =
    visible && permission && permission.requestId !== answeredPermission ? permission : null
  const inProgress = downloads.filter((download) => download.state === 'progressing').length
  /** Runs a menu action once the menu's overlay has handed the page back. */
  const afterMenuClose = (action: () => void) => () => void closeOverlay('toolbar').then(action)
  return {
    page,
    /** Whether the host is on screen; the tab stays mounted while hidden. */
    panelVisible,
    /** Sim draws its own start or issue view, so there is no native page to cover. */
    rendererPage: hasRendererPage,
    /** A permission or page prompt owns the panel, so no list may hang over it. */
    blocked: Boolean(permission || pageState?.prompt),
    /** The address bar list's lease on the captured frame. */
    suggestionsOverlay: {
      open: activeOverlay === 'suggestions',
      request: requestSuggestions,
      close: closeSuggestions,
    },
    /** A permission prompt waiting on the reader, with its question. */
    permission: permissionShown
      ? {
          requestId: permissionShown.requestId,
          ...permissionCopy(permissionShown),
          decide: (allowed: boolean) => decidePermission(permissionShown, allowed),
        }
      : null,
    /** A Leave page? question the page is holding navigation for; a permission prompt goes first. */
    dialog: visible && !permissionShown ? (pageState?.dialog ?? null) : null,
    /** A sign-in or app-launch decision; it waits behind a permission prompt and a page dialog. */
    prompt: visible && !permissionShown && !pageState?.dialog ? (pageState?.prompt ?? null) : null,
    launchNotice: pageState?.appLaunchNotice ?? null,
    answerDialog: (requestId: string, accept: boolean) => {
      if (claimAnswer(answered, requestId))
        sendBrowserPanelAction('respond-dialog', { requestId, allowed: accept }, scopeId)
    },
    respondPrompt: (requestId: string, response: BrowserPagePromptResponse) => {
      if (claimAnswer(answered, requestId))
        sendBrowserPanelAction('respond-prompt', { requestId, response }, scopeId)
    },
    panelRef: (element: HTMLDivElement | null) => {
      panelRef.current = element
      setPanelElement(element)
    },
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
    /** Navigates to an address the address bar already resolved. */
    navigateTo: (url: string) => sendBrowserPanelAction('navigate', { url }, scopeId),
    /**
     * This chat's recent downloads. The list opens in Sim once the page is swapped for its captured
     * frame; when that handshake fails, the shell's native list opens instead.
     */
    downloads: downloads.length
      ? {
          inProgress,
          percent: inProgress ? aggregateDownloadPercent(downloads) : null,
          justCompleted,
          unviewed: unviewedCompletion,
          rows: downloads.map((download) => ({
            id: download.id,
            filename: download.filename,
            state: download.state,
            detail: downloadDetail(download),
          })),
          open: activeOverlay === 'downloads',
          onOpenChange: (open: boolean, anchor: HTMLElement | null) => {
            if (!open) {
              void closeOverlay('downloads')
              return
            }
            setUnviewedCompletion(false)
            void requestOverlay('downloads', () => {
              const rect = anchor?.getBoundingClientRect()
              if (rect) showBrowserDownloadsMenu({ x: rect.left, y: rect.bottom }, scopeId)
            })
          },
          /** Reveals a completed download in Finder or the platform's file manager. */
          reveal: (id: string) => void showBrowserDownloadInFolder(id, scopeId),
        }
      : null,
    /**
     * The browser menu in Sim; when the page cannot be swapped for its captured
     * frame, the shell's native menu opens instead.
     */
    menu: {
      open: activeOverlay === 'toolbar',
      onOpenChange: (open: boolean, anchor: HTMLElement | null) => {
        if (!open) {
          void closeOverlay('toolbar')
          return
        }
        void requestOverlay('toolbar', () => {
          const rect = anchor?.getBoundingClientRect()
          if (rect) showBrowserToolbarMenu({ x: rect.left, y: rect.bottom }, scopeId)
        })
      },
      afterClose: afterMenuClose,
      fillAvailable,
      canImport: Boolean(getDesktopBridge()?.browserImport?.importFromChrome),
      zoom: (action: 'zoom-in' | 'zoom-out' | 'zoom-reset') =>
        sendBrowserPanelAction(action, {}, scopeId),
      /** The shell's account chooser needs the click's live gesture and an on-screen anchor. */
      fillPassword: (anchor: HTMLElement | null) => {
        const rect = anchor?.getBoundingClientRect()
        if (rect) showBrowserCredentialChooser({ x: rect.left, y: rect.bottom }, scopeId)
      },
      settings: (query: string) => onSettingsRef.current(query),
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
