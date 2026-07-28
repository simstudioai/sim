'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserPanelAnchor } from '@sim/browser-protocol'
import { isBrowserTheme } from '@sim/browser-protocol'
import { Button, ChipInput, Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@sim/emcn'
import { ArrowLeft, ArrowRight, Cursor, Key, Link, RefreshCw, Search } from '@sim/emcn/icons'
import { useTheme } from 'next-themes'
import {
  isBrowserFindAvailable,
  isBrowserTabPinningAvailable,
  isBrowserTabReorderingAvailable,
  loadBrowserSuggestionSources,
  onBrowserFillAvailability,
  onBrowserFindClose,
  onBrowserFindOpen,
  onBrowserOmniboxFocus,
  reorderBrowserTab,
  reportBrowserPanelBounds,
  reportBrowserPanelFocused,
  reportBrowserTheme,
  sendBrowserPanelAction,
  setBrowserTabPinned,
  showBrowserCredentialChooser,
} from '@/lib/browser-agent/transport'
import { BROWSER_SESSION_RESOURCE_ID } from '@/lib/copilot/resources/types'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { BrowserFindBar } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-find-bar'
import { useBrowserPanelOcclusion } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-panel-occlusion'
import { BrowserTabStrip } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-tab-strip'
import {
  mergeSuggestionSources,
  moveActiveIndex,
  rankSuggestions,
  type UrlSuggestion,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/url-suggestions'
import { useBrowserSessionStore } from '@/stores/browser-session/store'
import { MOTHERSHIP_WIDTH } from '@/stores/constants'

/** Ties the omnibox to its listbox for assistive tech. */
const SUGGESTIONS_LIST_ID = 'browser-url-suggestions'

const suggestionRowId = (index: number) => `${SUGGESTIONS_LIST_ID}-${index}`

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
  const hostLike =
    /^([a-z0-9-]+(\.[a-z0-9-]+)+|localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#].*)?$/i
  if (!input.includes(' ') && hostLike.test(input)) {
    const isLocal =
      /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|\[::1?\])(:\d+)?([/?#]|$)/i.test(input)
    return `${isLocal ? 'http' : 'https'}://${input}`
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`
}

/**
 * Selects the omnibox after the pointer event that focused it has settled.
 * Selecting synchronously in `focus` lets the remainder of that click collapse
 * the selection to an arbitrary caret position.
 */
export function selectFocusedOmniboxOnNextFrame(input: HTMLInputElement): number {
  return requestAnimationFrame(() => {
    if (input.ownerDocument.activeElement === input) {
      input.select()
    }
  })
}

/**
 * Tracks interaction ownership for renderer-owned browser chrome. The native
 * page reports its own focus from Electron; this covers the tab strip,
 * omnibox, controls, and the initial resource selection before they are used.
 */
export function trackBrowserPanelFocus(
  panel: HTMLElement,
  reportFocus: (focused: boolean) => void
): () => void {
  reportFocus(true)
  const updateFocusOwner = (target: EventTarget | null) => {
    reportFocus(target instanceof Node && panel.contains(target))
  }
  const handlePointerDown = (event: PointerEvent) => updateFocusOwner(event.target)
  const handleFocusIn = (event: FocusEvent) => updateFocusOwner(event.target)
  document.addEventListener('pointerdown', handlePointerDown, true)
  document.addEventListener('focusin', handleFocusIn, true)
  return () => {
    document.removeEventListener('pointerdown', handlePointerDown, true)
    document.removeEventListener('focusin', handleFocusIn, true)
    reportFocus(false)
  }
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

export function BrowserSession({ visible }: { visible: boolean }) {
  const { theme } = useTheme()
  const pageState = useBrowserSessionStore((state) => state.pageState)
  const tabs = useBrowserSessionStore((state) => state.tabs)
  const activeTabId = useBrowserSessionStore((state) => state.activeTabId)
  const tabsSupported = useBrowserSessionStore((state) => state.tabsSupported)
  const panelSnapshot = useBrowserSessionStore((state) => state.panelSnapshot)
  const sessionAlive = useBrowserSessionStore((state) => state.sessionAlive)
  const tabPinningSupported = isBrowserTabPinningAvailable()
  const tabReorderingSupported = isBrowserTabReorderingAvailable()
  const panelRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const fillButtonRef = useRef<HTMLButtonElement>(null)
  const panelOccluded = useBrowserPanelOcclusion(hostRef, visible)
  const { removeResource } = useMothershipResources()

  // The browser session ending closes the panel, the way the terminal panel
  // goes when its last shell does. What it leaves otherwise is a tab whose
  // only content explains that there is nothing to show and that starting
  // again has to happen from somewhere else — the agent reopens the panel on
  // its next browser action anyway. Guarded on having seen a live session so
  // that opening the panel while the store still remembers a closed one does
  // not immediately close it again.
  const wasAlive = useRef(false)
  useEffect(() => {
    if (sessionAlive) {
      wasAlive.current = true
      return
    }
    if (!wasAlive.current) return
    wasAlive.current = false
    removeResource('browser', BROWSER_SESSION_RESOURCE_ID)
  }, [sessionAlive, removeResource])
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
  /** Hosts worth suggesting: signed into, holding a saved password, or imported. */
  const [suggestionCorpus, setSuggestionCorpus] = useState<UrlSuggestion[]>([])
  /** Null until the user arrows into the list, so Enter still means "go to what I typed". */
  const [activeSuggestion, setActiveSuggestion] = useState<number | null>(null)
  /** Whether the find bar is docked above the page. */
  const [findOpen, setFindOpen] = useState(false)
  const findSupported = isBrowserFindAvailable()

  useEffect(() => onBrowserFillAvailability(setFillAvailable), [])

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
  }, [panelVisible])

  useEffect(() => {
    if (isBrowserTheme(theme)) {
      reportBrowserTheme(theme)
    }
  }, [theme])

  // Claiming focus is tied to being on screen, not to being mounted: a hidden
  // panel that announced itself as focused would take keystrokes meant for
  // whichever resource is actually showing.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !panelVisible) return
    return trackBrowserPanelFocus(panel, reportBrowserPanelFocused)
  }, [panelVisible])

  useEffect(() => {
    let focusRaf: number | null = null
    const unsubscribe = onBrowserOmniboxFocus((mode) => {
      setUrlDraft(mode === 'clear' ? '' : pageUrlRef.current)
      if (focusRaf !== null) {
        cancelAnimationFrame(focusRaf)
      }
      focusRaf = requestAnimationFrame(() => {
        focusRaf = null
        urlInputRef.current?.focus()
        urlInputRef.current?.select()
      })
    })
    return () => {
      unsubscribe()
      if (focusRaf !== null) {
        cancelAnimationFrame(focusRaf)
      }
    }
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

  // Mod+F reaches the panel two different ways and neither sees the other: with
  // the embedded page focused the keystroke never becomes a renderer key event
  // at all (the shell intercepts it and calls back), and with Sim's own chrome
  // focused the shell never sees it. Both land here.
  useEffect(() => {
    if (!findSupported) return
    return onBrowserFindOpen(openFind)
  }, [findSupported, openFind])

  useEffect(() => {
    if (!findSupported) return
    return onBrowserFindClose(() => setFindOpen(false))
  }, [findSupported])

  useEffect(() => {
    if (!findSupported || !panelVisible) return
    const panel = panelRef.current
    if (!panel) return
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key !== 'f') return
      event.preventDefault()
      openFind()
    }
    panel.addEventListener('keydown', handleFindShortcut)
    return () => panel.removeEventListener('keydown', handleFindShortcut)
  }, [findSupported, panelVisible, openFind])

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
  // heartbeat renews the main-process visibility lease. Renderer overlays are
  // coordinated separately so bounds continue updating while the view hides.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // Hidden behind another resource: the native view has nowhere to sit, so
    // report it gone once and install none of the scroll/resize/heartbeat
    // machinery below — all of which would otherwise fire on every scroll and
    // resize anywhere in the app, for a panel nobody can see.
    if (!visible) {
      setPanelVisible(false)
      reportBrowserPanelBounds(null)
      return
    }
    // Resolved once: the panel is a stable ancestor for this effect's lifetime,
    // and only its inline width changes.
    const panel = host.closest<HTMLElement>('[data-mothership-panel]')

    let rafId: number | null = null
    let forceNextReport = false
    let last = ''

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
        setPanelVisible(false)
        if (last !== 'hidden') {
          last = 'hidden'
          reportBrowserPanelBounds(null)
        }
        return
      }
      setPanelVisible(true)
      const key = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
      if (force || key !== last) {
        last = key
        reportBrowserPanelBounds(bounds, describeAnchor(panel))
      }
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
    const resizeObserver = new ResizeObserver(() => reportGeometry(false))
    resizeObserver.observe(host)
    window.addEventListener('resize', handleGeometryChange)
    window.addEventListener('scroll', handleGeometryChange, true)

    const heartbeatTimer = window.setInterval(
      () => scheduleGeometryReport(true),
      PANEL_HEARTBEAT_INTERVAL_MS
    )

    scheduleGeometryReport(true)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleGeometryChange)
      window.removeEventListener('scroll', handleGeometryChange, true)
      window.clearInterval(heartbeatTimer)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      reportBrowserPanelBounds(null)
    }
  }, [visible])

  /**
   * Suggestions only exist while the omnibox is being edited. Reading them off
   * `urlDraft` rather than a separate open flag means they cannot outlive the
   * edit, so they never hang over a page the user has gone back to reading.
   */
  const suggestions = useMemo(
    () => (urlDraft === null ? [] : rankSuggestions(suggestionCorpus, urlDraft)),
    [suggestionCorpus, urlDraft]
  )

  const navigateTo = useCallback((url: string) => {
    sendBrowserPanelAction('navigate', { url })
    setActiveSuggestion(null)
    urlInputRef.current?.blur()
  }, [])

  const submitUrl = useCallback(() => {
    const highlighted = activeSuggestion === null ? undefined : suggestions[activeSuggestion]
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
  }, [activeSuggestion, navigateTo, suggestions, urlDraft])

  const handleNewTab = useCallback(() => {
    setUrlDraft('')
    sendBrowserPanelAction('new-tab')
    urlInputRef.current?.focus()
    urlInputRef.current?.select()
  }, [])

  /**
   * Opens the shell's native account chooser under the key icon. Called
   * directly from the click so the page still has an active user gesture,
   * which the shell requires before it will read anything from the vault.
   */
  const handleShowCredentials = useCallback(() => {
    const rect = fillButtonRef.current?.getBoundingClientRect()
    if (!rect) return
    showBrowserCredentialChooser({ x: rect.left, y: rect.bottom })
  }, [])

  const handleSwitchTab = useCallback((tabId: string) => {
    setUrlDraft(null)
    urlInputRef.current?.blur()
    sendBrowserPanelAction('switch-tab', { tabId })
  }, [])

  const handleCloseTab = useCallback((tabId: string) => {
    setUrlDraft(null)
    urlInputRef.current?.blur()
    sendBrowserPanelAction('close-tab', { tabId })
  }, [])

  const handleDuplicateTab = useCallback((tabId: string) => {
    sendBrowserPanelAction('duplicate-tab', { tabId })
  }, [])

  const handleSetTabPinned = useCallback((tabId: string, pinned: boolean) => {
    setBrowserTabPinned(tabId, pinned)
  }, [])

  const handleReorderTab = useCallback((tabId: string, targetIndex: number) => {
    reorderBrowserTab(tabId, targetIndex)
  }, [])

  return (
    <div ref={panelRef} className='flex h-full flex-col overflow-hidden'>
      <div className='shrink-0 border-[var(--border)] border-b bg-[var(--bg)]'>
        {tabsSupported && (
          <BrowserTabStrip
            tabs={tabs}
            activeTabId={activeTabId}
            onNewTab={handleNewTab}
            onSwitchTab={handleSwitchTab}
            onCloseTab={handleCloseTab}
            onDuplicateTab={handleDuplicateTab}
            onSetTabPinned={handleSetTabPinned}
            onReorderTab={handleReorderTab}
            pinningSupported={tabPinningSupported}
            reorderingSupported={tabReorderingSupported}
          />
        )}
        <div className='flex items-center gap-1 px-2.5 py-1.5'>
          <Button
            type='button'
            variant='ghost-secondary'
            size='sm'
            aria-label='Back'
            disabled={!pageState?.canGoBack}
            className='size-[30px] flex-shrink-0 p-0'
            onClick={() => sendBrowserPanelAction('back')}
          >
            <ArrowLeft className='size-[14px]' />
          </Button>
          <Button
            type='button'
            variant='ghost-secondary'
            size='sm'
            aria-label='Forward'
            disabled={!pageState?.canGoForward}
            className='size-[30px] flex-shrink-0 p-0'
            onClick={() => sendBrowserPanelAction('forward')}
          >
            <ArrowRight className='size-[14px]' />
          </Button>
          <Button
            type='button'
            variant='ghost-secondary'
            size='sm'
            aria-label='Reload page'
            className='size-[30px] flex-shrink-0 p-0'
            onClick={() => sendBrowserPanelAction('reload')}
          >
            <RefreshCw className='size-[14px]' />
          </Button>
          {/* URL bar: Enter navigates the agent browser. */}
          <Popover
            open={suggestions.length > 0}
            onOpenChange={(open) => {
              if (!open) setActiveSuggestion(null)
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
                  aria-expanded={suggestions.length > 0}
                  aria-controls={SUGGESTIONS_LIST_ID}
                  aria-activedescendant={
                    activeSuggestion === null ? undefined : suggestionRowId(activeSuggestion)
                  }
                  onChange={(event) => {
                    setUrlDraft(event.target.value)
                    // The old highlight pointed at a row that may no longer be
                    // in the list, let alone in the same position.
                    setActiveSuggestion(null)
                  }}
                  onFocus={(event) => {
                    setUrlDraft((current) => current ?? pageState?.url ?? '')
                    selectFocusedOmniboxOnNextFrame(event.currentTarget)
                  }}
                  onBlur={() => {
                    setUrlDraft(null)
                    setActiveSuggestion(null)
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      if (suggestions.length === 0) return
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
            >
              {suggestions.map((suggestion, index) => (
                <PopoverItem
                  key={suggestion.hostname}
                  id={suggestionRowId(index)}
                  role='option'
                  aria-selected={index === activeSuggestion}
                  active={index === activeSuggestion}
                  // Without this the input blurs first, which closes the list
                  // and the click lands on nothing.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => navigateTo(suggestion.url)}
                >
                  <div className='flex min-w-0 items-center gap-2'>
                    {suggestion.icon ? (
                      <img src={suggestion.icon} alt='' className='size-4 flex-shrink-0' />
                    ) : (
                      <Link className='size-4 flex-shrink-0 text-[var(--text-icon)]' />
                    )}
                    {suggestion.name ? (
                      <>
                        <span className='flex-shrink-0 font-medium'>{suggestion.name}</span>
                        <span className='truncate text-[var(--text-muted)]'>
                          — {suggestion.hostname}
                        </span>
                      </>
                    ) : (
                      <span className='truncate'>{suggestion.hostname}</span>
                    )}
                  </div>
                </PopoverItem>
              ))}
            </PopoverContent>
          </Popover>
          {/* Only shown when this page has a login form and a saved match. */}
          {fillAvailable && (
            <Button
              ref={fillButtonRef}
              type='button'
              variant='ghost-secondary'
              size='sm'
              aria-label='Fill a saved password'
              title='Fill a saved password'
              className='size-[30px] flex-shrink-0 p-0'
              onClick={handleShowCredentials}
            >
              <Key className='size-[14px]' />
            </Button>
          )}
        </div>
        {findOpen && <BrowserFindBar inputRef={findInputRef} onClose={closeFind} />}
      </div>
      {/* Host area: the real page is overlaid exactly on this rect. */}
      <div ref={hostRef} className='relative flex-1 overflow-hidden bg-[var(--bg)]'>
        {panelOccluded &&
          panelSnapshot &&
          (!activeTabId || panelSnapshot.tabId === activeTabId) && (
            <img
              src={panelSnapshot.dataUrl}
              alt=''
              aria-hidden
              className='pointer-events-none absolute inset-0 size-full object-fill'
            />
          )}
        {!pageState && (
          <div className='absolute inset-0 flex flex-col items-center justify-center gap-2'>
            <Cursor className='size-[18px] text-[var(--text-tertiary)]' />
            <p className='text-[var(--text-muted)] text-small'>
              Waiting for the browser session to start…
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
