'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Chip, Tooltip } from '@sim/emcn'
import { ArrowLeft, ArrowRight, Cursor, RefreshCw } from '@sim/emcn/icons'
import { reportBrowserPanelBounds, sendBrowserPanelAction } from '@/lib/browser-agent/transport'
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

export function BrowserSession() {
  const pageState = useBrowserSessionStore((state) => state.pageState)
  const sessionAlive = useBrowserSessionStore((state) => state.sessionAlive)
  const hostRef = useRef<HTMLDivElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  /** Non-null while the user is editing the URL bar; otherwise it mirrors the page. */
  const [urlDraft, setUrlDraft] = useState<string | null>(null)

  // Keep the embedded view glued to the host rect: rAF loop that reports on
  // change (layout shifts, sidebar resizes, and scrolling all reflow the
  // panel without firing any single event reliably) AND re-reports at least
  // once a second as a liveness heartbeat — the main process treats bounds as
  // a short lease and hides the view when reports stop, so a reloaded or
  // crashed renderer can never leave the page stuck over the app. Unmount
  // additionally reports null for an instant hide.
  useEffect(() => {
    let rafId = 0
    let last = ''
    let lastSentAt = 0
    const tick = () => {
      const host = hostRef.current
      if (host) {
        const rect = host.getBoundingClientRect()
        const bounds = {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }
        const key = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
        const now = Date.now()
        if ((key !== last || now - lastSentAt > 1000) && bounds.width > 0 && bounds.height > 0) {
          last = key
          lastSentAt = now
          reportBrowserPanelBounds(bounds)
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafId)
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

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <div className='flex items-center gap-2 border-[var(--border)] border-b px-3 py-2'>
        <Cursor className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type='button'
              aria-label='Back'
              disabled={!pageState?.canGoBack}
              className='flex-shrink-0 text-[var(--text-icon)] transition-colors enabled:hover:text-[var(--text-primary)] disabled:opacity-40'
              onClick={() => sendBrowserPanelAction('back')}
            >
              <ArrowLeft className='size-[14px]' />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content side='bottom'>Back</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type='button'
              aria-label='Forward'
              disabled={!pageState?.canGoForward}
              className='flex-shrink-0 text-[var(--text-icon)] transition-colors enabled:hover:text-[var(--text-primary)] disabled:opacity-40'
              onClick={() => sendBrowserPanelAction('forward')}
            >
              <ArrowRight className='size-[14px]' />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content side='bottom'>Forward</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type='button'
              aria-label='Reload page'
              className='flex-shrink-0 text-[var(--text-icon)] transition-colors hover:text-[var(--text-primary)]'
              onClick={() => sendBrowserPanelAction('reload')}
            >
              <RefreshCw className='size-[14px]' />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content side='bottom'>Reload page</Tooltip.Content>
        </Tooltip.Root>
        {/* URL bar: Enter navigates the agent browser. */}
        <input
          ref={urlInputRef}
          type='text'
          spellCheck={false}
          aria-label='Search Google or enter a URL — press Enter'
          className='h-[24px] min-w-0 flex-1 rounded-[6px] border border-[var(--border-1)] bg-transparent px-2 text-[var(--text-muted)] text-caption outline-none focus:text-[var(--text-primary)]'
          value={urlDraft ?? pageState?.url ?? ''}
          placeholder='Search Google or enter a URL'
          onChange={(event) => setUrlDraft(event.target.value)}
          onFocus={(event) => {
            setUrlDraft(pageState?.url ?? '')
            event.target.select()
          }}
          onBlur={() => setUrlDraft(null)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') submitUrl()
            if (event.key === 'Escape') urlInputRef.current?.blur()
          }}
        />
      </div>
      {/* Takeover strip: sits in the panel chrome ABOVE the page rect, so it
          never covers page content. Done hands control back to Sim. */}
      {typeof pageState?.takeoverReason === 'string' && (
        <div className='flex items-center gap-2 border-[var(--border)] border-b px-3 py-1.5'>
          <p className='min-w-0 flex-1 truncate text-[var(--text-muted)] text-caption'>
            {pageState.takeoverReason.trim()
              ? `Sim is waiting for you — ${pageState.takeoverReason.trim()}`
              : 'Sim is waiting for you'}
          </p>
          <Chip variant='primary' onClick={() => sendBrowserPanelAction('takeover-done')}>
            Done
          </Chip>
        </div>
      )}
      {/* Host area: the real page is overlaid exactly on this rect. */}
      <div ref={hostRef} className='relative flex-1 overflow-hidden bg-[var(--surface-secondary)]'>
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
