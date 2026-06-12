'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/core/utils/cn'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useFullscreenOriginStore } from '@/stores/fullscreen-origin'
import { useSidebarStore } from '@/stores/sidebar/store'

const FULLSCREEN_SUFFIXES = ['/upgrade'] as const

/** Slide timing for the fullscreen sidebar collapse and content shift. */
const SLIDE_TRANSITION =
  'duration-[175ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none'

interface WorkspaceChromeProps {
  children: React.ReactNode
}

function isFullscreenPath(pathname: string | null): boolean {
  return FULLSCREEN_SUFFIXES.some((s) => pathname?.endsWith(s))
}

/**
 * Renders the workspace chrome as a single persistent tree. The sidebar is
 * always mounted; on a fullscreen route (`/upgrade`) its wrapper collapses to
 * zero width while the inner shell slides off the left edge, revealing the route
 * content. Because this component lives in the workspace layout it persists
 * across navigations, so the pathname-driven class toggle animates smoothly.
 *
 * Leaving a fullscreen route is instant: App Router swaps `children` to the
 * origin page and the fullscreen page is simply unmounted, while the sidebar
 * slides back in. There is no exit fade — the new page just loads in place.
 *
 * Because the chrome observes every pathname transition, it records the page a
 * fullscreen route was launched from into {@link useFullscreenOriginStore}. The
 * route's Back control reads that origin to return deterministically, so any
 * trigger that merely pushes a fullscreen route gets correct return-to-origin
 * without per-call-site wiring.
 *
 * On a direct load of a fullscreen route the wrapper mounts already collapsed,
 * so no slide plays (CSS transitions don't run on mount).
 *
 * The sidebar's single control is the `SidebarToggle` at the top-left of page
 * title bars. While the sidebar is hidden, hovering that toggle opens the
 * floating menu panel this chrome owns, anchored underneath the title bar so
 * the toggle stays visible; an invisible left-edge hover zone opens it on
 * pages without a title-bar toggle. Clicking the toggle pins the sidebar open.
 */
export function WorkspaceChrome({ children }: WorkspaceChromeProps) {
  const pathname = usePathname()
  const isFullscreen = isFullscreenPath(pathname)

  const setOrigin = useFullscreenOriginStore((s) => s.setOrigin)

  const hasHydrated = useSidebarStore((s) => s._hasHydrated)
  const syncSidebarWidth = useSidebarStore((s) => s.syncWidth)
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const isFlyoutOpen = useSidebarStore((s) => s.isFlyoutOpen)
  const openFlyout = useSidebarStore((s) => s.openFlyout)
  const scheduleFlyoutClose = useSidebarStore((s) => s.scheduleFlyoutClose)
  const closeFlyout = useSidebarStore((s) => s.closeFlyout)
  const storeStageFloating = useSidebarStore((s) => s.isStageFloating)

  // The store flag only flips after hydration, but the frame must already be
  // gone in server HTML and the streaming/loading window. Until hydration,
  // derive the same answer the workflow shell will reach from the URL alone;
  // afterwards the store is the single source (replaceState URL changes are
  // invisible to useSearchParams, so the URL goes stale in-session).
  const searchParams = useSearchParams()
  const urlStageFloating = /\/w\/[^/]+$/.test(pathname) && searchParams.has('resource')
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  const isStageFloating = hydrated ? storeStageFloating : urlStageFloating

  // Hide the flyout after navigating from it.
  useEffect(() => {
    closeFlyout()
  }, [pathname, closeFlyout])

  // Remember the last non-fullscreen page so a fullscreen route's Back control
  // can return there, deterministically and for any trigger.
  useEffect(() => {
    if (pathname && !isFullscreen) setOrigin(pathname)
  }, [pathname, isFullscreen, setOrigin])

  // Re-apply the sidebar width whenever this persistent shell sees a navigation.
  // The blocking script in the document head only runs on full page loads and
  // store rehydration only fires once, so a soft navigation can leave
  // `--sidebar-width` stuck at its `0px` default — collapsing the sidebar to
  // nothing with no reachable control to bring it back. Re-syncing here recovers
  // that state. Gated on hydration so it never clobbers the persisted value with
  // store defaults during the pre-hydration window.
  useEffect(() => {
    if (hasHydrated) syncSidebarWidth()
  }, [pathname, hasHydrated, syncSidebarWidth])

  // Re-clamp the width when the window shrinks below what the persisted width
  // allows, so the sidebar can never grow wider than the viewport permits.
  useEffect(() => {
    let rafId: number | null = null
    const onResize = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        syncSidebarWidth()
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
    }
  }, [syncSidebarWidth])

  return (
    <div className='relative flex min-h-0 flex-1'>
      <div
        className={cn(
          'sidebar-shell-outer shrink-0 overflow-hidden transition-[width]',
          SLIDE_TRANSITION,
          isFullscreen ? 'w-0' : 'w-[var(--sidebar-width)]'
        )}
        aria-hidden={isFullscreen || isCollapsed || undefined}
        suppressHydrationWarning
      >
        <div
          className={cn(
            'sidebar-shell-inner h-full w-[var(--sidebar-width)] shrink-0 transition-transform',
            SLIDE_TRANSITION,
            isFullscreen && '-translate-x-full'
          )}
        >
          {!isCollapsed && <Sidebar />}
        </div>
      </div>
      {/* Sidebar hidden → content goes full-bleed to the browser edge; sidebar
          visible (or fullscreen route) → framed card with the 8px gutter. */}
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col transition-[padding]',
          SLIDE_TRANSITION,
          isFullscreen ? 'p-[8px]' : isCollapsed ? 'p-0' : 'p-[8px] pl-0'
        )}
      >
        <div
          className={cn(
            'flex-1 overflow-hidden',
            // Floating-stage mode: the content renders as detached cards on
            // the chrome backdrop, so the content card frame disappears.
            isStageFloating ? 'bg-[var(--surface-1)]' : 'bg-[var(--bg)]',
            (isFullscreen || !isCollapsed) &&
              !isStageFloating &&
              'rounded-[8px] border border-[var(--border)]'
          )}
        >
          {children}
        </div>
      </div>
      {isCollapsed && !isFullscreen && (
        <>
          {/* Invisible hover zone so the flyout is reachable from the screen
              edge on pages whose header has no SidebarFlyoutTrigger. */}
          <div
            className='absolute top-0 bottom-0 left-0 z-40 w-[10px]'
            onMouseEnter={openFlyout}
            onMouseLeave={scheduleFlyoutClose}
          />
          {/* Anchored below the page title bar so the SidebarToggle that opened
              it stays visible above the panel. Chrome mirrors the canonical
              popover surface (rounded-xl, --border-1, --bg, shadow-sm) and enter
              motion (fade + zoom + slide from top, 150ms ease-out). Content-fit
              like a dropdown: height tracks the menu, capped so it scrolls
              internally instead of overflowing the viewport. */}
          <div
            onMouseEnter={openFlyout}
            onMouseLeave={scheduleFlyoutClose}
            className={cn(
              'absolute top-[50px] left-[8px] z-50 flex max-h-[calc(100%-58px)] w-[var(--sidebar-width)] flex-col overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--bg)] shadow-sm',
              'origin-top-left transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none',
              isFlyoutOpen
                ? 'translate-y-0 scale-100 opacity-100'
                : '-translate-y-2 pointer-events-none scale-95 opacity-0'
            )}
            style={{ '--sidebar-width': `${SIDEBAR_WIDTH.DEFAULT}px` } as React.CSSProperties}
          >
            <Sidebar variant='flyout' />
          </div>
        </>
      )}
    </div>
  )
}
