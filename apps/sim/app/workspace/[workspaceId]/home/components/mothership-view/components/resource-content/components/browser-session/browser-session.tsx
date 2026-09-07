'use client'

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BrowserMediaPermissionRequest,
  BrowserOmniboxFocusMode,
  BrowserPanelAnchor,
  BrowserPanelBounds,
  BrowserPanelSnapshot,
  BrowserSitePermissionRequest,
  BrowserTabState,
} from '@sim/browser-protocol'
import { isBrowserTheme } from '@sim/browser-protocol'
import type {
  BrowserAddToChatPayload,
  BrowserCredentialMetadata,
  DesktopAppearanceTheme,
} from '@sim/desktop-bridge'
import {
  Button,
  ChipConfirmModal,
  ChipInput,
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  MoreHorizontal,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  toast,
} from '@sim/emcn'
import { ArrowLeft, ArrowRight, Globe, Key, Link, RefreshCw, Search } from '@sim/emcn/icons'
import { useTheme } from 'next-themes'
import { createPortal } from 'react-dom'
import { BrowserImportDialog } from '@/components/browser-import/browser-import-dialog'
import { EmptyState } from '@/components/empty-state/empty-state'
import { onFocusVisibleBrowserOmnibox } from '@/lib/browser-agent/renderer-shortcuts'
import {
  fillBrowserCredential,
  loadBrowserFillOptions,
  loadBrowserSearchSuggestions,
  loadBrowserSuggestionSources,
  onBrowserAddToChat,
  onBrowserAppearanceThemeChanged,
  onBrowserFillAvailability,
  onBrowserFindClose,
  onBrowserFindOpen,
  onBrowserOmniboxFocus,
  onBrowserToolbarCommand,
  openBrowserTab,
  reorderBrowserTab,
  reportBrowserPanelBounds,
  reportBrowserPanelFocused,
  reportBrowserTheme,
  sendBrowserPanelAction,
  setBrowserPanelOccluded,
  setBrowserTabPinned,
  showBrowserCredentialChooser,
  showBrowserTabContextMenu,
  showBrowserToolbarMenu,
  supportsAtomicBrowserPanelOcclusion,
} from '@/lib/browser-agent/transport'
import { BROWSER_SESSION_RESOURCE_ID } from '@/lib/copilot/resources/types'
import { faviconUrl } from '@/lib/core/utils/favicon'
import { getDesktopBridge } from '@/lib/desktop'
import {
  loadDesktopBrowserAppearanceTheme,
  resolveDesktopAppearanceTheme,
} from '@/lib/desktop/appearance'
import { trackPanelFocus } from '@/lib/desktop/panel-focus'
import { addMothershipContext } from '@/lib/mothership/events'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { BrowserDownloads } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-downloads'
import { BrowserFindBar } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-find-bar'
import { BrowserLoadingBar } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-loading-bar'
import { BrowserPageIssueView } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-page-issue'
import {
  type BrowserPanelOverlay,
  type BrowserPanelOverlayController,
  type BrowserPanelSnapshotLayer,
  createBrowserPanelGeometryOcclusionLease,
  hasNativeSurfaceOcclusion,
  mutationsTouchNativeSurfaceOcclusion,
  useBrowserPanelOcclusion,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-panel-occlusion'
import { BrowserTabStrip } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-tab-strip'
import { BrowserThemeNotice } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-theme-notice'
import {
  buildOmniboxSuggestions,
  googleSearchUrl,
  isSearchQueryInput,
  mergeSuggestionSources,
  moveActiveIndex,
  type OmniboxSuggestion,
  type UrlSuggestion,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/url-suggestions'
import { ResourceZoomMenuItems } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/resource-zoom-menu-items'
import { useDebounce } from '@/hooks/use-debounce'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useBrowserSessionStore } from '@/stores/browser-session/store'
import { MOTHERSHIP_WIDTH } from '@/stores/constants'
import type { ChatContext } from '@/stores/panel'

/** Ties the omnibox to its listbox for assistive tech. */
const SUGGESTIONS_LIST_ID = 'browser-url-suggestions'
const SEARCH_SUGGESTIONS_DEBOUNCE_MS = 160
const NEW_TAB_CONFIRM_TIMEOUT_MS = 10_000
const OMNIBOX_DRAG_THRESHOLD_PX = 4
const EMPTY_BROWSER_TABS: BrowserTabState[] = []

const suggestionRowId = (index: number) => `${SUGGESTIONS_LIST_ID}-${index}`

function BrowserSuggestionIcon({ suggestion }: { suggestion: UrlSuggestion }) {
  const [failed, setFailed] = useState(false)
  const source = suggestion.icon || faviconUrl(suggestion.hostname, 32)

  if (failed) {
    return <Link className='size-4 shrink-0 text-[var(--text-icon)]' />
  }

  return (
    <img
      src={source}
      alt=''
      className='size-4 shrink-0 rounded-[3px]'
      onError={() => setFailed(true)}
    />
  )
}

/** Converts the native page selection into the browser-tab mention shown in chat. */
export function browserSelectionContext({
  text,
  tabId,
  url,
  title,
}: BrowserAddToChatPayload): Extract<ChatContext, { kind: 'browser_tab' }> {
  return {
    kind: 'browser_tab',
    tabId,
    label: 'Browser',
    selection: {
      text,
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
    },
  }
}

/**
 * The browser panel. The real agent-browser page is a native view the
 * desktop app overlays EXACTLY on this component's body area — so the page
 * here is fully interactive (real clicks, typing, scrolling), not a video
 * stream. This component's jobs are geometry (continuously reporting the
 * body rect for the overlay to track) and browser chrome (URL bar,
 * back/forward, reload) driven by page-state pushes.
 */
/**
 * Omnibox-style resolution for the URL bar: explicit schemes pass through,
 * host-looking input becomes a URL (http:// for localhost/IPs since local dev
 * servers rarely speak TLS, https:// otherwise), and everything else runs as
 * a Google search — like any browser's address bar.
 */
export function resolveUrlBarInput(raw: string): string {
  const input = raw.trim()
  if (/^https?:\/\//i.test(input)) return input
  if (isSearchQueryInput(input)) return googleSearchUrl(input)
  const isLocal =
    /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|\[::1?\])(:\d+)?([/?#]|$)/i.test(input)
  return `${isLocal ? 'http' : 'https'}://${input}`
}

/** Selects after keyboard or programmatic focus has settled. */
export function selectFocusedOmniboxOnNextFrame(input: HTMLInputElement): number {
  return requestAnimationFrame(() => {
    if (input.ownerDocument.activeElement === input) {
      input.select()
    }
  })
}

/** Chromium cancels focus-click select-all once the pointer becomes a drag. */
export function exceededOmniboxDragThreshold(
  originX: number,
  originY: number,
  clientX: number,
  clientY: number
): boolean {
  return Math.hypot(clientX - originX, clientY - originY) > OMNIBOX_DRAG_THRESHOLD_PX
}

/** Removes the selection left behind when focus moves into the native page view. */
export function clearOmniboxSelection(input: HTMLInputElement): void {
  const caret = input.selectionEnd ?? input.value.length
  input.setSelectionRange(caret, caret)
}

/** Covers both prompt types across every globally admitted native tab without unbounded retention. */
const MAX_HANDLED_PERMISSION_REQUESTS = 256

/** Claims the one renderer response allowed for a native browser permission request. */
export function claimPermissionResponse(
  handledRequestIds: { current: Set<string> },
  requestId: string
): boolean {
  if (handledRequestIds.current.has(requestId)) return false
  handledRequestIds.current.add(requestId)
  while (handledRequestIds.current.size > MAX_HANDLED_PERMISSION_REQUESTS) {
    const oldest = handledRequestIds.current.values().next().value
    if (typeof oldest !== 'string') break
    handledRequestIds.current.delete(oldest)
  }
  return true
}

type BrowserPermissionRequest = BrowserMediaPermissionRequest | BrowserSitePermissionRequest

export function browserPermissionResponseAction(
  request: BrowserPermissionRequest
): 'respond-media-permission' | 'respond-site-permission' {
  return 'tabId' in request ? 'respond-site-permission' : 'respond-media-permission'
}

export function shouldShowBrowserPermissionRequest(
  requestId: string | undefined,
  answeredRequestId: string | null,
  visible: boolean
): boolean {
  return visible && requestId !== undefined && requestId !== answeredRequestId
}

export function browserPermissionPrompt(request: BrowserPermissionRequest): {
  title: string
  text: string
} {
  if ('tabId' in request) {
    return {
      title: 'Open another website?',
      text: `This page wants to open ${request.origin}. Allow this destination for the rest of this browser task? Only continue if you trust this website.`,
    }
  }

  const devices = request.devices.join(' and ')
  return {
    title: `Allow ${request.origin} to use your ${devices}?`,
    text: `Allowing gives this page access to your ${devices} until it navigates. Block if you did not expect this request.`,
  }
}

interface BrowserPermissionModalProps {
  request: BrowserPermissionRequest | undefined
  open: boolean
  onDecision: (
    requestId: string,
    action: ReturnType<typeof browserPermissionResponseAction>,
    allowed: boolean
  ) => void
}

export function BrowserPermissionModal({ request, open, onDecision }: BrowserPermissionModalProps) {
  const requestId = request?.requestId
  const responseAction = request ? browserPermissionResponseAction(request) : undefined
  useEffect(() => {
    if (!requestId || !responseAction) return
    return () => onDecision(requestId, responseAction, false)
  }, [onDecision, requestId, responseAction])

  if (!request) return null
  const prompt = browserPermissionPrompt(request)
  const activeResponseAction = browserPermissionResponseAction(request)

  return (
    <ChipConfirmModal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onDecision(request.requestId, activeResponseAction, false)
      }}
      title={prompt.title}
      text={prompt.text}
      defaultAction='dismiss'
      dismissLabel='Block'
      confirm={{
        label: 'Allow',
        onClick: () => onDecision(request.requestId, activeResponseAction, true),
        variant: 'primary',
      }}
    />
  )
}

/** Places the replacement on the native view's exact, unclipped viewport rectangle. */
export function browserPanelSnapshotStyle(
  snapshot: BrowserPanelSnapshot,
  layer: BrowserPanelSnapshotLayer = 'popover'
): CSSProperties | undefined {
  const bounds = snapshot.viewportBounds
  if (!bounds) return undefined
  return {
    position: 'fixed',
    top: bounds.y,
    left: bounds.x,
    width: bounds.width,
    height: bounds.height,
    maxWidth: 'none',
    zIndex: layer === 'modal' ? 'calc(var(--z-modal) - 1)' : 'calc(var(--z-popover) - 1)',
  }
}

interface BrowserPanelSnapshotImageProps {
  snapshot: BrowserPanelSnapshot
  layer: BrowserPanelSnapshotLayer
  onError: () => void
}

function BrowserPanelSnapshotImage({ snapshot, layer, onError }: BrowserPanelSnapshotImageProps) {
  const style = browserPanelSnapshotStyle(snapshot, layer)
  const image = (
    <img
      src={snapshot.dataUrl}
      alt=''
      aria-hidden
      draggable={false}
      onError={onError}
      style={style}
      className={cn(
        'pointer-events-none select-none object-fill',
        style ? 'block' : 'absolute inset-0 size-full max-w-none'
      )}
    />
  )
  if (!style || typeof document === 'undefined') return image
  return createPortal(image, document.body)
}

/** Re-report unchanged bounds before the main-process visibility lease expires. */
const PANEL_HEARTBEAT_INTERVAL_MS = 1_000

/**
 * Declares how the panel's width follows the viewport, so the shell can
 * re-derive the rect during a live window resize instead of holding one that is
 * a frame stale (which shows as a gap along the panel's left edge).
 *
 * Only the width rule has to cross the bridge: a divider drag pins an inline px
 * width on the panel, otherwise its `w-1/2` class halves the viewport. The shell
 * works the rest out from the rect reported alongside this.
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

interface BrowserSessionProps {
  visible: boolean
  scopeId: string
  onOverlayControllerChange?: (controller: BrowserPanelOverlayController | null) => void
}

/** Administrative suspension retains the resource even though live tabs are gone. */
export function shouldRemoveBrowserResource(
  sessionAlive: boolean,
  observedLiveSession: boolean,
  suspended: boolean
): boolean {
  return !suspended && !sessionAlive && observedLiveSession
}

/** A suspended scope never leases native compositor bounds. */
export function shouldReportBrowserBounds(visible: boolean, suspended: boolean): boolean {
  return visible && !suspended
}

/**
 * Whether the omnibox suggestion list may be shown, which is not the same
 * question as whether it has anything to show.
 *
 * Ranking a list is synchronous; making it clickable is not. The rows hang over
 * the native page, so a click only reaches them once the shell has swapped that
 * page for its captured frame — and that handshake can fail (a capture that
 * never lands, a decode or paint that times out, a hide the shell refuses).
 * Gating on the row count alone painted the list *underneath* the
 * WebContentsView on those failures: visible, arrow-key navigable, and silently
 * swallowing every click below the toolbar, while rows still inside the chrome
 * kept working.
 *
 * The other browser popovers survive the same failure because each hands
 * `requestOverlay` a native Electron menu to fall back to. An omnibox dropdown
 * has no native equivalent, so its fallback is a no-op and failure has to mean
 * "do not open" rather than "open something unusable".
 *
 * Keyed on the live overlay rather than on the request's result: the lease is
 * also lost when a modal seizes the frame or another popover takes it, neither
 * of which re-runs the request.
 */
export function shouldOpenUrlSuggestions(
  activeOverlay: BrowserPanelOverlay | null,
  suggestionCount: number
): boolean {
  return activeOverlay === 'suggestions' && suggestionCount > 0
}

/** Typed searches and new tabs select the first row; an untouched page URL remains literal. */
export function initialUrlSuggestionIndex(
  pageUrl: string | undefined,
  suggestionCount: number,
  query = ''
): number | null {
  if (suggestionCount === 0) return null
  return query.trim() || !pageUrl || pageUrl === 'about:blank' ? 0 : null
}

/** A new-tab request is complete only after the authoritative strip grows and activates a new id. */
export function hasConfirmedBrowserTabCreation(
  previousActiveTabId: string | null,
  previousTabCount: number,
  activeTabId: string | null,
  tabCount: number
): boolean {
  return tabCount > previousTabCount && activeTabId !== null && activeTabId !== previousActiveTabId
}

interface PendingNewTabFocus {
  scopeId: string
  previousActiveTabId: string | null
  previousTabCount: number
  timeoutId: number
}

interface OmniboxPointerSelection {
  pointerId: number
  originX: number
  originY: number
}

export function BrowserSession({
  visible,
  scopeId,
  onOverlayControllerChange,
}: BrowserSessionProps) {
  const { theme } = useTheme()
  const [appearanceTheme, setAppearanceTheme] = useState<DesktopAppearanceTheme | null>(null)
  const [themeNoticeVersion, setThemeNoticeVersion] = useState(0)
  const reportedBrowserThemeRef = useRef<ReturnType<typeof resolveDesktopAppearanceTheme> | null>(
    null
  )
  // Read the panel's own bucket instead of the store's active projection.
  // Chat navigation activates the desktop scope in an effect, so the projection
  // can still describe the previous chat during the first render of this keyed
  // panel. Direct selection prevents that one render from showing or acting on
  // another chat's tabs.
  const pageState = useBrowserSessionStore((state) => state.sessions[scopeId]?.pageState ?? null)
  const tabs = useBrowserSessionStore(
    (state) => state.sessions[scopeId]?.tabs ?? EMPTY_BROWSER_TABS
  )
  const activeTabId = useBrowserSessionStore(
    (state) => state.sessions[scopeId]?.activeTabId ?? null
  )
  const automationTabId = useBrowserSessionStore(
    (state) => state.sessions[scopeId]?.automationTabId ?? null
  )
  const automationActive = useBrowserSessionStore(
    (state) => state.sessions[scopeId]?.automationActive ?? false
  )
  const automationNeedsAttention = useBrowserSessionStore(
    (state) => state.sessions[scopeId]?.automationNeedsAttention ?? false
  )
  const browserAgentActive = useBrowserSessionStore(
    (state) => (state.sessions[scopeId]?.agentRunIds.length ?? 0) > 0
  )
  const sessionAlive = useBrowserSessionStore(
    (state) => state.sessions[scopeId]?.sessionAlive ?? true
  )
  const suspended = useBrowserSessionStore((state) => state.sessions[scopeId]?.suspended ?? false)
  const showEmptyState = Boolean(
    pageState &&
      !pageState.loading &&
      !pageState.issue &&
      (!pageState.url || pageState.url === 'about:blank')
  )
  const hasRendererPage = Boolean(pageState?.issue) || showEmptyState
  const [importOpen, setImportOpen] = useState(false)
  const [importVersion, setImportVersion] = useState(0)
  const canImport = Boolean(getDesktopBridge()?.browserImport?.importFromChrome)
  const mediaPermissionRequest = pageState?.mediaPermissionRequest
  const sitePermissionRequest = pageState?.sitePermissionRequest
  const permissionRequest = sitePermissionRequest ?? mediaPermissionRequest
  const panelRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  // Lets the occlusion handshake reject a capture taken before a modal's
  // scroll lock reflowed the panel — painting that stale rect is the flash.
  const getHostRect = useCallback(() => hostRef.current?.getBoundingClientRect() ?? null, [])
  const urlInputRef = useRef<HTMLInputElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const fillButtonRef = useRef<HTMLButtonElement>(null)
  const toolbarMenuButtonRef = useRef<HTMLButtonElement>(null)
  const omniboxFocusRafRef = useRef<number | null>(null)
  const omniboxPointerSelectionRef = useRef<OmniboxPointerSelection | null>(null)
  const pendingNewTabFocusRef = useRef<PendingNewTabFocus | null>(null)
  const handledPermissionRequestIdsRef = useRef<Set<string>>(new Set())
  const [answeredPermissionRequestId, setAnsweredPermissionRequestId] = useState<string | null>(
    null
  )
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const { removeResource } = useMothershipResources()
  const { navigateToSettings } = useSettingsNavigation()

  // The browser session ending closes the panel, the way the terminal panel
  // goes when its last shell does. What it leaves otherwise is a tab whose
  // only content explains that there is nothing to show and that starting
  // again has to happen from somewhere else — the agent reopens the panel on
  // its next browser action anyway. Guarded on having seen a live session so
  // that opening the panel while the store still remembers a closed one does
  // not immediately close it again.
  const observedLiveSession = useRef(false)
  useEffect(() => {
    if (suspended) {
      observedLiveSession.current = false
      return
    }
    if (sessionAlive) {
      // A new scope starts optimistically alive until the desktop answers.
      // Only a real tab proves that this panel observed a live session;
      // otherwise the expected empty response from lazy activation would look
      // like a user closing the last tab and delete the persisted resource
      // before its encrypted descriptor gets a chance to hydrate.
      if (tabs.length > 0) observedLiveSession.current = true
      return
    }
    if (!shouldRemoveBrowserResource(sessionAlive, observedLiveSession.current, suspended)) return
    observedLiveSession.current = false
    removeResource('browser', BROWSER_SESSION_RESOURCE_ID)
  }, [sessionAlive, suspended, tabs.length, removeResource])
  const pageUrlRef = useRef(pageState?.url ?? '')
  pageUrlRef.current = pageState?.url ?? ''
  /** Non-null while the user is editing the URL bar; otherwise it mirrors the page. */
  const [urlDraft, setUrlDraft] = useState<string | null>(null)
  /**
   * Whether the panel is actually on screen. The panel stays mounted while
   * another resource is showing, so "mounted" no longer implies "visible".
   */
  const [panelVisible, setPanelVisible] = useState(false)
  /** Whether the shell has a saved password for the page currently open. */
  const [fillAvailable, setFillAvailable] = useState(false)
  /** Accounts the active page can accept, loaded only when its key menu opens. */
  const [fillOptions, setFillOptions] = useState<BrowserCredentialMetadata[]>([])
  /** Visited hosts worth suggesting, optionally decorated by imported credentials. */
  const [suggestionCorpus, setSuggestionCorpus] = useState<UrlSuggestion[]>([])
  /** Highlighted row, or null when Enter should submit the omnibox text. */
  const [activeSuggestion, setActiveSuggestion] = useState<number | null>(null)
  /** Page URL captured when the current omnibox edit began. */
  const [suggestionOriginUrl, setSuggestionOriginUrl] = useState('')
  /** Whether the user has asked to see suggestions for the current omnibox edit. */
  const [suggestionsVisible, setSuggestionsVisible] = useState(false)
  /** Empty on initial focus; follows the typed text once the user edits it. */
  const [suggestionQuery, setSuggestionQuery] = useState<string | null>(null)
  /** Live completions tagged with the query that produced them, so late replies cannot leak in. */
  const [searchCompletions, setSearchCompletions] = useState<{
    query: string
    values: string[]
  }>({ query: '', values: [] })
  const debouncedSuggestionQuery = useDebounce(
    suggestionQuery ?? '',
    SEARCH_SUGGESTIONS_DEBOUNCE_MS
  )
  /** Whether the find bar is docked above the page. */
  const [findOpen, setFindOpen] = useState(false)
  const {
    activeOverlay,
    snapshot: panelSnapshot,
    snapshotLayer,
    requestOverlay,
    closeOverlay,
    onSnapshotError,
  } = useBrowserPanelOcclusion(scopeId, activeTabId, panelVisible, getHostRect)

  const respondToPermission = useCallback(
    (
      requestId: string,
      action: ReturnType<typeof browserPermissionResponseAction>,
      allowed: boolean
    ) => {
      if (!claimPermissionResponse(handledPermissionRequestIdsRef, requestId)) {
        return
      }
      setAnsweredPermissionRequestId(requestId)
      sendBrowserPanelAction(action, { requestId, allowed }, scopeId)
    },
    [scopeId]
  )

  useEffect(() => {
    if (visible || !permissionRequest) return
    respondToPermission(
      permissionRequest.requestId,
      browserPermissionResponseAction(permissionRequest),
      false
    )
  }, [permissionRequest, respondToPermission, visible])

  const permissionModalOpen = shouldShowBrowserPermissionRequest(
    permissionRequest?.requestId,
    answeredPermissionRequestId,
    visible
  )

  // The resource picker lives above this component in the panel tab bar. Give
  // that one external browser overlay access to the same capture/hide handshake
  // as the browser's own menus, without restoring a document-wide observer.
  useEffect(() => {
    if (!onOverlayControllerChange) return
    onOverlayControllerChange({ requestOverlay, closeOverlay })
    return () => onOverlayControllerChange(null)
  }, [closeOverlay, onOverlayControllerChange, requestOverlay])

  useEffect(() => onBrowserFillAvailability(setFillAvailable, scopeId), [scopeId])

  useEffect(() => {
    if (fillAvailable || activeOverlay !== 'credentials') return
    void closeOverlay('credentials')
  }, [activeOverlay, closeOverlay, fillAvailable])

  useEffect(() => {
    let active = true
    void loadDesktopBrowserAppearanceTheme().then((next) => {
      if (active) setAppearanceTheme(next)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => onBrowserAppearanceThemeChanged((next) => setAppearanceTheme(next)), [])

  useEffect(
    () =>
      onBrowserToolbarCommand((command) => {
        if (command === 'import') {
          setImportOpen(true)
          return
        }
        navigateToSettings({ section: 'browser' })
      }, scopeId),
    [navigateToSettings, scopeId]
  )

  useEffect(
    () =>
      onBrowserAddToChat(
        (payload) => addMothershipContext(browserSelectionContext(payload)),
        scopeId
      ),
    [scopeId]
  )

  // Reloaded whenever the panel comes back on screen, so an import or a fresh
  // sign-in elsewhere in the app shows up without a reload.
  useEffect(() => {
    if (!panelVisible) return
    let active = true
    void loadBrowserSuggestionSources().then(({ sessions, credentials, sites }) => {
      if (active) setSuggestionCorpus(mergeSuggestionSources(sessions, credentials, sites))
    })
    return () => {
      active = false
    }
  }, [panelVisible, importVersion])

  /** Debounced live completions never block the immediate local/search row. */
  useEffect(() => {
    const query = debouncedSuggestionQuery.trim()
    if (!suggestionsVisible || !isSearchQueryInput(query)) {
      setSearchCompletions({ query: '', values: [] })
      return
    }

    let active = true
    void loadBrowserSearchSuggestions(query).then((values) => {
      if (active) setSearchCompletions({ query, values })
    })
    return () => {
      active = false
    }
  }, [debouncedSuggestionQuery, suggestionsVisible])

  useEffect(() => {
    if (appearanceTheme) {
      const next = resolveDesktopAppearanceTheme(appearanceTheme, theme)
      if (isBrowserTheme(next)) reportBrowserTheme(next)
      if (reportedBrowserThemeRef.current && reportedBrowserThemeRef.current !== next) {
        setThemeNoticeVersion((version) => version + 1)
      }
      reportedBrowserThemeRef.current = next
    }
  }, [appearanceTheme, theme])

  // Renderer-owned browser chrome claims shortcuts only after real user
  // interaction. The desktop shell observes focus in the native page itself.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !panelVisible) return
    return trackPanelFocus(panel, (focused) => reportBrowserPanelFocused(focused, scopeId))
  }, [panelVisible, scopeId])

  const focusOmnibox = useCallback((mode: BrowserOmniboxFocusMode) => {
    // Selecting an existing URL means the user is choosing where to go next,
    // exactly like clicking the omnibox. A freshly opened blank tab stays
    // quiet until the user clicks or types.
    setSuggestionsVisible(mode === 'select')
    setSuggestionQuery(mode === 'select' ? '' : null)
    setActiveSuggestion(null)
    setSuggestionOriginUrl(mode === 'clear' ? '' : pageUrlRef.current)
    setUrlDraft(mode === 'clear' ? '' : pageUrlRef.current)
    if (omniboxFocusRafRef.current !== null) {
      cancelAnimationFrame(omniboxFocusRafRef.current)
    }
    omniboxFocusRafRef.current = requestAnimationFrame(() => {
      omniboxFocusRafRef.current = null
      if (!visibleRef.current) return
      urlInputRef.current?.focus()
      urlInputRef.current?.select()
    })
  }, [])

  const clearPendingNewTabFocus = useCallback((pending?: PendingNewTabFocus): boolean => {
    const current = pendingNewTabFocusRef.current
    if (!current || (pending && current !== pending)) return false
    window.clearTimeout(current.timeoutId)
    pendingNewTabFocusRef.current = null
    return true
  }, [])

  // New shells acknowledge tab creation directly; older installed shells only
  // publish the resulting strip. Both paths land here so neither clears the
  // current page's omnibox before a distinct tab actually exists.
  useEffect(() => {
    const pending = pendingNewTabFocusRef.current
    if (
      !pending ||
      pending.scopeId !== scopeId ||
      !hasConfirmedBrowserTabCreation(
        pending.previousActiveTabId,
        pending.previousTabCount,
        activeTabId,
        tabs.length
      )
    ) {
      return
    }
    if (!clearPendingNewTabFocus(pending)) return
    if (visible) focusOmnibox('clear')
  }, [activeTabId, clearPendingNewTabFocus, focusOmnibox, scopeId, tabs.length, visible])

  useEffect(() => {
    return () => {
      const pending = pendingNewTabFocusRef.current
      if (pending?.scopeId === scopeId) clearPendingNewTabFocus(pending)
    }
  }, [clearPendingNewTabFocus, scopeId])

  useEffect(() => onBrowserOmniboxFocus(focusOmnibox, scopeId), [focusOmnibox, scopeId])

  // Follow the agent's tab. The panel already marks the automated tab in the
  // strip; this makes it the VISIBLE one, so watching the agent never means
  // hunting for which tab it moved to. Keyed on the automation target
  // CHANGING, not on it merely being set — the user can still browse a
  // different tab mid-run and is only pulled along when the agent itself
  // moves to another tab.
  const followedAutomationTabRef = useRef<string | null>(null)
  useEffect(() => {
    if (!automationActive || !automationTabId) {
      if (!automationActive) followedAutomationTabRef.current = null
      return
    }
    if (followedAutomationTabRef.current === automationTabId) return
    followedAutomationTabRef.current = automationTabId
    if (automationTabId === activeTabId) return
    sendBrowserPanelAction('switch-tab', { tabId: automationTabId }, scopeId)
  }, [activeTabId, automationActive, automationTabId, scopeId])

  // Sim owns keyboard events while its renderer has focus. Claim Cmd+L here
  // before the workspace's global "Go to Logs" command can navigate away.
  useEffect(() => {
    if (!panelVisible || !activeTabId) return
    return onFocusVisibleBrowserOmnibox(() => focusOmnibox('select'))
  }, [activeTabId, focusOmnibox, panelVisible])

  useEffect(() => {
    return () => {
      if (omniboxFocusRafRef.current !== null) {
        cancelAnimationFrame(omniboxFocusRafRef.current)
      }
    }
  }, [])

  // The page is a separate WebContentsView, so clicking it blurs this renderer
  // without reliably blurring its active DOM input. Collapse the selection as
  // the renderer hands focus to the native page.
  useEffect(() => {
    const handleWindowBlur = () => {
      const input = urlInputRef.current
      if (!input) return
      clearOmniboxSelection(input)
      input.blur()
    }
    window.addEventListener('blur', handleWindowBlur)
    return () => window.removeEventListener('blur', handleWindowBlur)
  }, [])

  /**
   * Opens the find bar, or re-selects it when it is already open — pressing
   * Mod+F twice in Chrome selects the existing query so the next keystroke
   * replaces it.
   */
  const openFind = useCallback(() => {
    setFindOpen(true)
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [])

  /** Every toolbar menu action closes the overlay first, then runs. */
  const afterToolbarClose = (action: () => void) => () => void closeOverlay('toolbar').then(action)

  // Mod+F reaches the panel two different ways and neither sees the other: with
  // the embedded page focused the keystroke never becomes a renderer key event
  // at all (the shell intercepts it and calls back), and with Sim's own chrome
  // focused the shell never sees it. Both land here.
  useEffect(() => {
    return onBrowserFindOpen(openFind, scopeId)
  }, [openFind, scopeId])

  useEffect(() => {
    return onBrowserFindClose(() => setFindOpen(false), scopeId)
  }, [scopeId])

  useEffect(() => {
    if (!panelVisible) return
    const panel = panelRef.current
    if (!panel) return
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      // Caps Lock makes `key` 'F'. The shell-side handler already lowercases,
      // so without this Mod+F worked with the page focused and silently did
      // nothing with Sim's own chrome focused.
      if (event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      openFind()
    }
    panel.addEventListener('keydown', handleFindShortcut)
    return () => panel.removeEventListener('keydown', handleFindShortcut)
  }, [panelVisible, openFind])

  // Unmounting the bar strands focus on a removed node; the shell hands it back
  // to the page when it stops the find, which is where native focus is owned.
  const closeFind = useCallback(() => setFindOpen(false), [])

  // Keep the embedded view glued to the host rect without forcing layout on
  // every animation frame. ResizeObserver covers panel drags/transitions and
  // reports synchronously — its callbacks run post-layout, so the measure is
  // free and the bounds reach the main process within the same frame as the
  // layout change (deferring to the next rAF made the native view trail a
  // live panel drag by a full frame). Viewport resize and captured scroll
  // fire pre-layout, so those defer to rAF for a clean measure. A one-second
  // heartbeat renews the main-process visibility lease.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // Hidden behind another resource: the native view has nowhere to sit, so
    // report it gone once and install none of the scroll/resize/heartbeat
    // machinery below — all of which would otherwise fire on every scroll and
    // resize anywhere in the app, for a panel nobody can see.
    if (!shouldReportBrowserBounds(visible, suspended)) {
      setPanelVisible(false)
      reportBrowserPanelBounds(null, null, scopeId)
      return
    }
    if (hasRendererPage) {
      setPanelVisible(true)
      reportBrowserPanelBounds(null, null, scopeId)
      return
    }
    // Resolved once: the panel is a stable ancestor for this effect's lifetime,
    // and only its inline width changes.
    const panel = host.closest<HTMLElement>('[data-mothership-panel]')

    let rafId: number | null = null
    let forceNextReport = false
    let last = ''
    let disposed = false
    let occlusionRequest = 0
    const atomicPanelOcclusion = supportsAtomicBrowserPanelOcclusion()
    let occlusionPresent = atomicPanelOcclusion && hasNativeSurfaceOcclusion()
    // A full-screen marker can exist before this Browser reports its first
    // rect. In that path this bounds effect acquires a serialized hidden lease
    // before attaching geometry, including rollback if the marker disappears
    // while Electron is still processing the hide.
    const geometryOcclusionLease = createBrowserPanelGeometryOcclusionLease((occluded) =>
      setBrowserPanelOccluded(occluded, scopeId, occluded).catch(() => false)
    )

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
      // A zero-size host means the panel has visually collapsed (e.g. the
      // w-0 transition finished). Report null so the native view — which
      // floats above all renderer content — hides now instead of lingering
      // at its last sliver of a rect until the visibility lease expires.
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
      const nativeSurfaceOcclusionPresent = atomicPanelOcclusion && hasNativeSurfaceOcclusion()
      const request = ++occlusionRequest

      if (
        nativeSurfaceOcclusionPresent ||
        geometryOcclusionLease.isOccluded() ||
        geometryOcclusionLease.isTransitioning()
      ) {
        // A Browser becoming visible while a modal is already mounted has no
        // painted snapshot to swap. Establish the native hidden lease first,
        // then report bounds: the WebContentsView is attached hidden from its
        // very first compositor frame. This also reasserts the lease after a
        // minimized/throttled window temporarily loses its bounds.
        //
        // The reassert must be REAL, not deduped. Main's bounds lease expires
        // after 2.5s of missed reports (renderer jank, a skipped commit) and
        // resets panelOccluded — while this side still remembers `applied:
        // true`. Without dropping that belief, setDesired(true) is a no-op,
        // the next bounds commit lays out an unoccluded native view, and the
        // browser punches above the still-open modal with nothing left to
        // ever re-hide it. Forgetting `applied` costs one idempotent hide IPC
        // per heartbeat while a modal is up, and makes any main-side lease
        // loss self-heal within a second.
        if (nativeSurfaceOcclusionPresent) geometryOcclusionLease.assumeRevealed()
        void geometryOcclusionLease.setDesired(nativeSurfaceOcclusionPresent).then((settled) => {
          if (disposed) return
          const latestOcclusionPresent = atomicPanelOcclusion && hasNativeSurfaceOcclusion()
          if (
            request !== occlusionRequest ||
            latestOcclusionPresent !== nativeSurfaceOcclusionPresent
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
    // A chat may be open in more than one app window. Reclaim the singleton
    // native view as soon as this window receives OS focus instead of waiting
    // for the next one-second lease heartbeat; menu shortcuts arrive sooner.
    const handleWindowFocus = () => scheduleGeometryReport(true)
    const resizeObserver = new ResizeObserver(() => reportGeometry(false))
    const occlusionObserver = new MutationObserver((records) => {
      if (!mutationsTouchNativeSurfaceOcclusion(records)) return
      const next = hasNativeSurfaceOcclusion()
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
        attributeFilter: ['data-native-surface-occlusion'],
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
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      geometryOcclusionLease.assumeRevealed()
      void geometryOcclusionLease.setDesired(false)
      reportBrowserPanelBounds(null, null, scopeId)
    }
  }, [hasRendererPage, visible, suspended, scopeId])

  /**
   * Programmatic focus on a new tab keeps the omnibox ready for typing without
   * opening this list. A pointer interaction or typed edit opts into suggestions.
   */
  const suggestions = useMemo((): OmniboxSuggestion[] => {
    if (!suggestionsVisible || suggestionQuery === null) return []
    const query = suggestionQuery.trim()
    const live = searchCompletions.query === query ? searchCompletions.values : []
    return buildOmniboxSuggestions(suggestionCorpus, suggestionQuery, live)
  }, [searchCompletions, suggestionCorpus, suggestionQuery, suggestionsVisible])

  useEffect(() => {
    setActiveSuggestion(
      initialUrlSuggestionIndex(suggestionOriginUrl, suggestions.length, suggestionQuery ?? '')
    )
  }, [suggestionOriginUrl, suggestionQuery, suggestions])

  // The suggestion list is renderer UI that extends over the native page.
  // Keep the page's exact captured frame underneath it while it is open so
  // pointer events reach the Sim popover instead of the WebContentsView.
  useEffect(() => {
    if (mediaPermissionRequest || sitePermissionRequest) {
      void closeOverlay('suggestions')
      return
    }
    if (hasRendererPage) {
      void closeOverlay('suggestions')
      return
    }
    if (suggestions.length > 0) {
      void requestOverlay('suggestions', () => {})
      return
    }
    void closeOverlay('suggestions')
  }, [
    closeOverlay,
    hasRendererPage,
    mediaPermissionRequest,
    requestOverlay,
    sitePermissionRequest,
    suggestions.length,
  ])

  const suggestionsOpen = hasRendererPage
    ? suggestions.length > 0
    : shouldOpenUrlSuggestions(activeOverlay, suggestions.length)

  const navigateTo = (url: string) => {
    sendBrowserPanelAction('navigate', { url }, scopeId)
    setSuggestionsVisible(false)
    setSuggestionQuery(null)
    setActiveSuggestion(null)
    setSuggestionOriginUrl('')
    urlInputRef.current?.blur()
  }

  const submitUrl = () => {
    // Enter can only take a highlight from a list the user can actually see.
    const highlighted =
      suggestionsOpen && activeSuggestion !== null ? suggestions[activeSuggestion] : undefined
    if (highlighted) {
      navigateTo(highlighted.url)
      return
    }
    const raw = (urlDraft ?? '').trim()
    if (raw) {
      navigateTo(resolveUrlBarInput(raw))
      return
    }
    urlInputRef.current?.blur()
  }

  const handleNewTab = useCallback(() => {
    setSuggestionsVisible(false)
    setSuggestionQuery(null)
    setActiveSuggestion(null)
    setSuggestionOriginUrl('')
    clearPendingNewTabFocus()
    const pending: PendingNewTabFocus = {
      scopeId,
      previousActiveTabId: activeTabId,
      previousTabCount: tabs.length,
      timeoutId: 0,
    }
    pending.timeoutId = window.setTimeout(() => {
      if (clearPendingNewTabFocus(pending)) {
        toast.error('Could not open a new browser tab. Please try again.')
      }
    }, NEW_TAB_CONFIRM_TIMEOUT_MS)
    pendingNewTabFocusRef.current = pending
    void openBrowserTab(scopeId)
      .then((state) => {
        // Older shells resolve null and confirm through the tab-state effect.
        if (!state) return
        if (
          !hasConfirmedBrowserTabCreation(
            pending.previousActiveTabId,
            pending.previousTabCount,
            state.activeTabId,
            state.tabs.length
          )
        ) {
          throw new Error('The desktop browser did not create a distinct tab.')
        }
      })
      .catch(() => {
        if (clearPendingNewTabFocus(pending)) {
          toast.error('Could not open a new browser tab. Please try again.')
        }
      })
  }, [activeTabId, clearPendingNewTabFocus, scopeId, tabs.length])

  /**
   * Opens the shell's native account chooser under the key icon. Called
   * directly from the click so the page still has an active user gesture,
   * which the shell requires before it will read anything from the vault.
   */
  const handleShowCredentials = useCallback(() => {
    const rect = fillButtonRef.current?.getBoundingClientRect()
    if (!rect) return
    showBrowserCredentialChooser({ x: rect.left, y: rect.bottom }, scopeId)
  }, [scopeId])

  /** Swaps the native page for its captured frame before opening the emcn menu. */
  const handleOpenCredentialMenu = useCallback(async () => {
    const options = await loadBrowserFillOptions(scopeId)
    if (options.length === 0) {
      handleShowCredentials()
      return
    }
    setFillOptions(options)
    await requestOverlay('credentials', handleShowCredentials)
  }, [handleShowCredentials, requestOverlay, scopeId])

  const handleShowNativeToolbarMenu = useCallback(() => {
    const rect = toolbarMenuButtonRef.current?.getBoundingClientRect()
    if (!rect) return
    showBrowserToolbarMenu({ x: rect.left, y: rect.bottom }, scopeId)
  }, [scopeId])

  const handleSwitchTab = useCallback(
    (tabId: string) => {
      setSuggestionsVisible(false)
      setSuggestionQuery(null)
      setUrlDraft(null)
      urlInputRef.current?.blur()
      sendBrowserPanelAction('switch-tab', { tabId }, scopeId)
    },
    [scopeId]
  )

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setSuggestionsVisible(false)
      setSuggestionQuery(null)
      setUrlDraft(null)
      urlInputRef.current?.blur()
      sendBrowserPanelAction('close-tab', { tabId }, scopeId)
    },
    [scopeId]
  )

  const handleDuplicateTab = useCallback(
    (tabId: string) => {
      sendBrowserPanelAction('duplicate-tab', { tabId }, scopeId)
    },
    [scopeId]
  )

  const handleSetTabPinned = useCallback(
    (tabId: string, pinned: boolean) => {
      setBrowserTabPinned(tabId, pinned, scopeId)
    },
    [scopeId]
  )

  const handleReorderTab = useCallback(
    (tabId: string, targetIndex: number) => {
      reorderBrowserTab(tabId, targetIndex, scopeId)
    },
    [scopeId]
  )

  return (
    <div ref={panelRef} className='flex h-full flex-col overflow-hidden'>
      <div className='relative shrink-0 border-[var(--border)] border-b bg-[var(--bg)]'>
        <BrowserTabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          automationTabId={automationTabId}
          automationActive={automationActive || browserAgentActive}
          automationNeedsAttention={automationNeedsAttention}
          onNewTab={handleNewTab}
          onSwitchTab={handleSwitchTab}
          onCloseTab={handleCloseTab}
          onDuplicateTab={handleDuplicateTab}
          onSetTabPinned={handleSetTabPinned}
          onOpenTabMenu={(tabId) =>
            requestOverlay('tab', () => showBrowserTabContextMenu(tabId, scopeId))
          }
          onCloseTabMenu={() => void closeOverlay('tab')}
          onReorderTab={handleReorderTab}
          contextMenuOpen={activeOverlay === 'tab'}
        />
        <div className='flex items-center gap-1 px-2.5 py-1.5'>
          <Button
            type='button'
            variant='ghost-secondary'
            size='sm'
            aria-label='Back'
            disabled={!pageState?.canGoBack}
            className='size-[30px] shrink-0 p-0'
            onClick={() => sendBrowserPanelAction('back', {}, scopeId)}
          >
            <ArrowLeft className='size-[14px]' />
          </Button>
          <Button
            type='button'
            variant='ghost-secondary'
            size='sm'
            aria-label='Forward'
            disabled={!pageState?.canGoForward}
            className='size-[30px] shrink-0 p-0'
            onClick={() => sendBrowserPanelAction('forward', {}, scopeId)}
          >
            <ArrowRight className='size-[14px]' />
          </Button>
          <Button
            type='button'
            variant='ghost-secondary'
            size='sm'
            aria-label='Reload page'
            className='size-[30px] shrink-0 p-0'
            onClick={() => sendBrowserPanelAction('reload', {}, scopeId)}
          >
            <RefreshCw className='size-[14px]' />
          </Button>
          {/* URL bar: Enter navigates the agent browser. */}
          <Popover
            open={suggestionsOpen}
            onOpenChange={(open) => {
              if (open) return
              setSuggestionsVisible(false)
              setSuggestionQuery(null)
              setActiveSuggestion(null)
              urlInputRef.current?.blur()
            }}
            modal={false}
          >
            <PopoverAnchor asChild>
              <div className='min-w-0 flex-1'>
                <ChipInput
                  ref={urlInputRef}
                  type='text'
                  icon={Search}
                  spellCheck={false}
                  aria-label='Search Google or enter a URL — press Enter'
                  value={urlDraft ?? pageState?.url ?? ''}
                  placeholder='Search Google or enter a URL'
                  autoComplete='off'
                  role='combobox'
                  aria-autocomplete='list'
                  aria-expanded={suggestionsOpen}
                  aria-controls={SUGGESTIONS_LIST_ID}
                  aria-activedescendant={
                    suggestionsOpen && activeSuggestion !== null
                      ? suggestionRowId(activeSuggestion)
                      : undefined
                  }
                  onPointerDown={(event) => {
                    if (omniboxFocusRafRef.current !== null) {
                      cancelAnimationFrame(omniboxFocusRafRef.current)
                      omniboxFocusRafRef.current = null
                    }
                    omniboxPointerSelectionRef.current =
                      event.button === 0 && document.activeElement !== event.currentTarget
                        ? {
                            pointerId: event.pointerId,
                            originX: event.clientX,
                            originY: event.clientY,
                          }
                        : null
                    setSuggestionsVisible(true)
                    if (
                      document.activeElement !== event.currentTarget ||
                      suggestionQuery === null
                    ) {
                      setSuggestionOriginUrl(pageState?.url ?? '')
                      setSuggestionQuery('')
                    }
                  }}
                  onPointerMove={(event) => {
                    const pending = omniboxPointerSelectionRef.current
                    if (!pending || pending.pointerId !== event.pointerId) return
                    const hasSelection =
                      event.currentTarget.selectionStart !== event.currentTarget.selectionEnd
                    if (
                      hasSelection ||
                      exceededOmniboxDragThreshold(
                        pending.originX,
                        pending.originY,
                        event.clientX,
                        event.clientY
                      )
                    ) {
                      omniboxPointerSelectionRef.current = null
                    }
                  }}
                  onPointerUp={(event) => {
                    const pending = omniboxPointerSelectionRef.current
                    omniboxPointerSelectionRef.current = null
                    if (pending?.pointerId === event.pointerId && event.button === 0) {
                      event.currentTarget.select()
                    }
                  }}
                  onPointerCancel={() => {
                    omniboxPointerSelectionRef.current = null
                  }}
                  onChange={(event) => {
                    setSuggestionsVisible(true)
                    setSuggestionQuery(event.target.value)
                    setSearchCompletions({ query: '', values: [] })
                    setUrlDraft(event.target.value)
                    // The old highlight pointed at a row that may no longer be
                    // in the list, let alone in the same position.
                    setActiveSuggestion(null)
                  }}
                  onFocus={(event) => {
                    setUrlDraft((current) => current ?? pageState?.url ?? '')
                    setSuggestionOriginUrl(pageState?.url ?? '')
                    setSuggestionQuery('')
                    if (!omniboxPointerSelectionRef.current) {
                      selectFocusedOmniboxOnNextFrame(event.currentTarget)
                    }
                  }}
                  onBlur={(event) => {
                    omniboxPointerSelectionRef.current = null
                    clearOmniboxSelection(event.currentTarget)
                    setSuggestionsVisible(false)
                    setSuggestionQuery(null)
                    setUrlDraft(null)
                    setActiveSuggestion(null)
                    setSuggestionOriginUrl('')
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      // Never move a highlight through a list that is not on screen.
                      if (!suggestionsOpen) return
                      // Otherwise the caret jumps to either end of the text.
                      event.preventDefault()
                      setActiveSuggestion((current) =>
                        moveActiveIndex(
                          current,
                          event.key === 'ArrowDown' ? 1 : -1,
                          suggestions.length
                        )
                      )
                      return
                    }
                    if (event.key === 'Enter') submitUrl()
                    if (event.key === 'Escape') {
                      // Dismiss the list first; leave the omnibox only once
                      // there is no highlight left to back out of.
                      if (activeSuggestion !== null) setActiveSuggestion(null)
                      else urlInputRef.current?.blur()
                    }
                  }}
                />
              </div>
            </PopoverAnchor>
            <PopoverContent
              id={SUGGESTIONS_LIST_ID}
              align='start'
              side='bottom'
              sideOffset={4}
              className='w-[var(--radix-popover-trigger-width)] p-1'
              // Focus has to stay in the omnibox: the user is still typing, and
              // the list is driven by arrow keys rather than by tabbing into it.
              onOpenAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                if (event.target === urlInputRef.current) event.preventDefault()
              }}
            >
              {suggestions.map((suggestion, index) => (
                <PopoverItem
                  key={
                    suggestion.kind === 'site'
                      ? `site:${suggestion.hostname}`
                      : `search:${suggestion.query}`
                  }
                  id={suggestionRowId(index)}
                  role='option'
                  aria-selected={index === activeSuggestion}
                  active={index === activeSuggestion}
                  // Without this the input blurs first, which closes the list
                  // and the click lands on nothing.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => navigateTo(suggestion.url)}
                >
                  <div className='flex w-full min-w-0 items-center gap-2'>
                    {suggestion.kind === 'search' ? (
                      <>
                        <Search className='size-4 shrink-0 text-[var(--text-icon)]' />
                        <span className='truncate'>{suggestion.query}</span>
                      </>
                    ) : (
                      <BrowserSuggestionIcon suggestion={suggestion} />
                    )}
                    {suggestion.kind === 'site' && suggestion.name ? (
                      <div className='flex min-w-0 flex-1 items-center gap-1.5'>
                        <span className='min-w-0 flex-1 truncate'>{suggestion.name}</span>
                        <span className='max-w-[45%] shrink-0 truncate text-[var(--text-muted)]'>
                          — {suggestion.hostname}
                        </span>
                      </div>
                    ) : suggestion.kind === 'site' ? (
                      <span className='truncate'>{suggestion.hostname}</span>
                    ) : null}
                  </div>
                </PopoverItem>
              ))}
            </PopoverContent>
          </Popover>
          {findOpen && (
            <BrowserFindBar inputRef={findInputRef} onClose={closeFind} scopeId={scopeId} />
          )}
          {fillAvailable && (
            <DropdownMenu
              open={activeOverlay === 'credentials'}
              modal={false}
              onOpenChange={(open) => {
                if (open) void handleOpenCredentialMenu()
                else void closeOverlay('credentials')
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  ref={fillButtonRef}
                  type='button'
                  variant='ghost-secondary'
                  size='sm'
                  aria-label='Fill a saved password'
                  title='Fill a saved password'
                  className='size-[30px] shrink-0 p-0'
                >
                  <Key className='size-[14px]' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' sideOffset={5} className='w-[240px]'>
                {fillOptions.map((credential) => (
                  <DropdownMenuItem
                    key={credential.id}
                    onSelect={() => void fillBrowserCredential(credential.id, scopeId)}
                  >
                    <span className='min-w-0 flex-1 truncate'>
                      {credential.username || '(no username)'}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <BrowserDownloads
            scopeId={scopeId}
            open={activeOverlay === 'downloads'}
            requestOpen={(fallback) => void requestOverlay('downloads', fallback)}
            onClose={() => void closeOverlay('downloads')}
          />
          <DropdownMenu
            open={activeOverlay === 'toolbar'}
            modal={false}
            onOpenChange={(open) => {
              if (open) void requestOverlay('toolbar', handleShowNativeToolbarMenu)
              else void closeOverlay('toolbar')
            }}
          >
            <DropdownMenuTrigger asChild>
              <button
                ref={toolbarMenuButtonRef}
                type='button'
                aria-label='Browser menu'
                title='Browser menu'
                className={cn(chipVariants(), 'shrink-0')}
              >
                <MoreHorizontal className='size-[14px] shrink-0 text-[var(--text-icon)]' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              sideOffset={5}
              className='w-[300px]'
              // The menu's deferred focus restoration otherwise races the
              // find input opened by its own action and returns focus here.
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <DropdownMenuItem onSelect={afterToolbarClose(openFind)}>
                Find in Page
                <DropdownMenuShortcut>⌘F</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <ResourceZoomMenuItems
                onZoomIn={afterToolbarClose(() => sendBrowserPanelAction('zoom-in', {}, scopeId))}
                onZoomOut={afterToolbarClose(() => sendBrowserPanelAction('zoom-out', {}, scopeId))}
                onActualSize={afterToolbarClose(() =>
                  sendBrowserPanelAction('zoom-reset', {}, scopeId)
                )}
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={afterToolbarClose(() => setImportOpen(true))}
                disabled={!canImport}
              >
                Import Passwords
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={afterToolbarClose(() => navigateToSettings({ section: 'browser' }))}
              >
                Browser Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {themeNoticeVersion > 0 && (
          <BrowserThemeNotice key={themeNoticeVersion} scopeId={scopeId} />
        )}
        <BrowserLoadingBar loading={Boolean(pageState?.loading)} />
      </div>
      {/* Host area: the real page is overlaid exactly on this rect. */}
      <div ref={hostRef} className='relative flex-1 overflow-hidden bg-[var(--bg)]'>
        {panelSnapshot &&
          (snapshotLayer === 'modal' || !activeTabId || panelSnapshot.tabId === activeTabId) && (
            <BrowserPanelSnapshotImage
              snapshot={panelSnapshot}
              layer={snapshotLayer}
              onError={onSnapshotError}
            />
          )}
        {!pageState && (
          <div className='absolute inset-0 flex flex-col items-center justify-center gap-2'>
            <Globe className='size-[18px] text-[var(--text-tertiary)]' />
            <p className='text-[var(--text-muted)] text-small'>
              Waiting for the browser session to start…
            </p>
          </div>
        )}
        {showEmptyState && (
          <section
            aria-label='New tab'
            className='absolute inset-0 flex overflow-auto bg-[var(--bg)]'
          >
            <EmptyState
              graphic={<Globe className='size-6 text-[var(--text-icon)]' aria-hidden='true' />}
              title='Browse the web'
              description='Search or enter a URL above.'
            />
          </section>
        )}
        {pageState?.issue && (
          <BrowserPageIssueView
            issue={pageState.issue}
            focusRecovery={visible}
            onReload={() => sendBrowserPanelAction('reload', {}, scopeId)}
          />
        )}
      </div>
      <BrowserImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={async () => setImportVersion((version) => version + 1)}
      />
      <BrowserPermissionModal
        request={permissionRequest}
        open={permissionModalOpen}
        onDecision={respondToPermission}
      />
    </div>
  )
}
