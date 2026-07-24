'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isBrowserTheme } from '@sim/browser-protocol'
import { Button, ChipInput, Tooltip } from '@sim/emcn'
import { ArrowLeft, ArrowRight, Cursor, RefreshCw, Search } from '@sim/emcn/icons'
import { useTheme } from 'next-themes'
import {
  isBrowserTabPinningAvailable,
  onBrowserOmniboxFocus,
  reportBrowserPanelBounds,
  reportBrowserPanelFocused,
  reportBrowserTheme,
  sendBrowserPanelAction,
  setBrowserTabPinned,
} from '@/lib/browser-agent/transport'
import { useBrowserPanelOcclusion } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-panel-occlusion'
import { BrowserTabStrip } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-tab-strip'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

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

export function BrowserSession() {
  const { theme } = useTheme()
  const pageState = useBrowserSessionStore((state) => state.pageState)
  const tabs = useBrowserSessionStore((state) => state.tabs)
  const activeTabId = useBrowserSessionStore((state) => state.activeTabId)
  const tabsSupported = useBrowserSessionStore((state) => state.tabsSupported)
  const panelSnapshot = useBrowserSessionStore((state) => state.panelSnapshot)
  const sessionAlive = useBrowserSessionStore((state) => state.sessionAlive)
  const tabPinningSupported = isBrowserTabPinningAvailable()
  const panelRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const panelOccluded = useBrowserPanelOcclusion(hostRef)
  const pageUrlRef = useRef(pageState?.url ?? '')
  pageUrlRef.current = pageState?.url ?? ''
  /** Non-null while the user is editing the URL bar; otherwise it mirrors the page. */
  const [urlDraft, setUrlDraft] = useState<string | null>(null)

  useEffect(() => {
    if (isBrowserTheme(theme)) {
      reportBrowserTheme(theme)
    }
  }, [theme])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    return trackBrowserPanelFocus(panel, reportBrowserPanelFocused)
  }, [])

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
        if (last !== 'hidden') {
          last = 'hidden'
          reportBrowserPanelBounds(null)
        }
        return
      }
      const key = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
      if (force || key !== last) {
        last = key
        reportBrowserPanelBounds(bounds)
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
  }, [])

  const submitUrl = useCallback(() => {
    const raw = (urlDraft ?? '').trim()
    if (raw) {
      sendBrowserPanelAction('navigate', { url: resolveUrlBarInput(raw) })
    }
    urlInputRef.current?.blur()
  }, [urlDraft])

  const handleNewTab = useCallback(() => {
    setUrlDraft('')
    sendBrowserPanelAction('new-tab')
    urlInputRef.current?.focus()
    urlInputRef.current?.select()
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

  const handleSetTabPinned = useCallback((tabId: string, pinned: boolean) => {
    setBrowserTabPinned(tabId, pinned)
  }, [])

  return (
    <div ref={panelRef} className='flex h-full flex-col overflow-hidden'>
      {tabsSupported && (
        <BrowserTabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          onNewTab={handleNewTab}
          onSwitchTab={handleSwitchTab}
          onCloseTab={handleCloseTab}
          onSetTabPinned={handleSetTabPinned}
          pinningSupported={tabPinningSupported}
        />
      )}
      <div className='flex items-center gap-1 border-[var(--border)] border-b px-2.5 py-1.5'>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
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
          </Tooltip.Trigger>
          <Tooltip.Content side='bottom'>Back</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
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
          </Tooltip.Trigger>
          <Tooltip.Content side='bottom'>Forward</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
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
          </Tooltip.Trigger>
          <Tooltip.Content side='bottom'>Reload page</Tooltip.Content>
        </Tooltip.Root>
        {/* URL bar: Enter navigates the agent browser. */}
        <ChipInput
          ref={urlInputRef}
          type='text'
          icon={Search}
          spellCheck={false}
          aria-label='Search Google or enter a URL — press Enter'
          className='min-w-0 flex-1'
          value={urlDraft ?? pageState?.url ?? ''}
          placeholder='Search Google or enter a URL'
          autoComplete='off'
          onChange={(event) => setUrlDraft(event.target.value)}
          onFocus={(event) => {
            setUrlDraft((current) => current ?? pageState?.url ?? '')
            selectFocusedOmniboxOnNextFrame(event.currentTarget)
          }}
          onBlur={() => setUrlDraft(null)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') submitUrl()
            if (event.key === 'Escape') urlInputRef.current?.blur()
          }}
        />
      </div>
      {/* Host area: the real page is overlaid exactly on this rect. */}
      <div ref={hostRef} className='relative flex-1 overflow-hidden bg-[var(--surface-secondary)]'>
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
        {(!pageState || !sessionAlive) && (
          <div className='absolute inset-0 flex flex-col items-center justify-center gap-2'>
            <Cursor className='size-[18px] text-[var(--text-tertiary)]' />
            <p className='text-[var(--text-muted)] text-small'>
              {sessionAlive
                ? 'Waiting for the browser session to start…'
                : 'The browser session was closed — ask Sim to navigate again to start a new one.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
