'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { cn } from '@sim/emcn'
import { PanelLeft } from '@sim/emcn/icons'
import { usePathname } from 'next/navigation'
import { getDesktopBridge } from '@/lib/desktop'
import { Sidebar, SidebarTooltip } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import { useFullscreenOriginStore } from '@/stores/fullscreen-origin'
import { useSidebarStore } from '@/stores/sidebar/store'

const FULLSCREEN_SUFFIXES = ['/upgrade'] as const

/** Slide timing for the fullscreen sidebar collapse and content shift. */
const SLIDE_TRANSITION =
  'duration-[175ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none'

interface WorkspaceChromeProps {
  children: React.ReactNode
  /** Cookie-derived collapse state from the server layout; seeds the sidebar's first render. */
  initialSidebarCollapsed?: boolean
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
 */
export function WorkspaceChrome({
  children,
  initialSidebarCollapsed = false,
}: WorkspaceChromeProps) {
  const rafRef = useRef(0)

  const pathname = usePathname()
  const isFullscreen = isFullscreenPath(pathname)

  const setOrigin = useFullscreenOriginStore((s) => s.setOrigin)

  const storeIsCollapsed = useSidebarStore((s) => s.isCollapsed)
  const hasHydrated = useSidebarStore((s) => s._hasHydrated)
  const syncSidebarWidth = useSidebarStore((s) => s.syncWidth)
  const toggleSidebar = useSidebarStore((s) => s.toggleCollapsed)

  /**
   * Single source of collapse for the whole chrome, driving the rail's structure,
   * labels, and width. The server renders from the `sidebar_collapsed` cookie
   * (`initialSidebarCollapsed`) and the store seeds from the same cookie — after
   * the pre-paint script migrates any legacy `localStorage` flag — so prop and
   * store agree. The prop is used until the store hydrates (keeping the first
   * client render identical to the server), then the store takes over.
   */
  const isCollapsed = hasHydrated ? storeIsCollapsed : initialSidebarCollapsed

  /**
   * Suppresses sidebar transitions across the initial hydration window. The
   * pre-paint script already set the correct `--sidebar-width`, but the store
   * rehydration below re-applies it a tick later; without this guard that
   * re-apply animates the rail, reading as a collapse -> expand flash on a
   * fresh load. Applied before the rehydrate effect so the class is in place
   * ahead of the width mutation, then lifted after the first paint so
   * user-driven collapse toggles and the fullscreen slide still animate.
   */
  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.add('sidebar-booting')
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => root.classList.remove('sidebar-booting'))
      rafRef.current = raf2
    })
    rafRef.current = raf1
    return () => {
      cancelAnimationFrame(rafRef.current)
      root.classList.remove('sidebar-booting')
    }
  }, [])

  // Hydrate the persisted width before paint (collapse comes from the cookie/prop).
  useLayoutEffect(() => {
    void useSidebarStore.persist.rehydrate()
  }, [])

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

  useEffect(() => {
    return getDesktopBridge()?.onCommand?.((command) => {
      if (command === 'toggle-sidebar') {
        useSidebarStore.getState().toggleCollapsed()
      }
    })
  }, [])

  useEffect(() => {
    const windowState = getDesktopBridge()?.windowState
    if (!windowState) return

    let disposed = false
    const applyWindowState = ({ isFullScreen }: { isFullScreen: boolean }) => {
      if (!disposed) {
        document.documentElement.setAttribute(
          'data-sim-desktop-title-bar',
          isFullScreen ? 'fullscreen' : 'inset'
        )
      }
    }
    const unsubscribe = windowState.onStateChange(applyWindowState)
    void windowState
      .getState()
      .then(applyWindowState)
      .catch(() => {})

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

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
    <div
      className='desktop-workspace-window-frame relative flex min-h-0 flex-1'
      data-sidebar-collapsed={isCollapsed || undefined}
    >
      <div
        aria-hidden
        className={cn(
          'desktop-window-drag-region desktop-workspace-window-drag-region',
          isCollapsed ? 'h-9' : 'h-2'
        )}
      />
      <div
        className={cn(
          'sidebar-shell-outer shrink-0 overflow-hidden transition-[width]',
          SLIDE_TRANSITION,
          isFullscreen ? 'w-0' : 'w-[var(--sidebar-width)]'
        )}
        data-collapsed={isCollapsed || undefined}
        aria-hidden={isFullscreen || undefined}
        suppressHydrationWarning
      >
        <div
          className={cn(
            'sidebar-shell-inner h-full w-[var(--sidebar-width)] shrink-0 transition-transform',
            SLIDE_TRANSITION,
            isFullscreen && '-translate-x-full'
          )}
        >
          <Sidebar isCollapsed={isCollapsed} />
        </div>
      </div>
      <div
        className={cn(
          'workspace-content-shell flex min-w-0 flex-1 flex-col p-[8px] transition-[padding]',
          SLIDE_TRANSITION,
          !isFullscreen && 'pl-0',
          isCollapsed && '[[data-sim-desktop-title-bar=inset]_&]:p-0'
        )}
        data-sidebar-collapsed={isCollapsed || undefined}
      >
        <div className='flex-1 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg)]'>
          {children}
        </div>
      </div>
      {!isFullscreen && (
        <SidebarTooltip
          label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          enabled
          side='bottom'
          shortcut='⌘B'
        >
          <button
            type='button'
            onClick={toggleSidebar}
            className='absolute top-1 left-[83px] z-30 hidden h-[30px] w-[30px] items-center justify-center rounded-lg [-webkit-app-region:no-drag] hover-hover:bg-[var(--surface-active)] [[data-sim-desktop-title-bar=inset]_&]:flex'
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <PanelLeft className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
          </button>
        </SidebarTooltip>
      )}
    </div>
  )
}
