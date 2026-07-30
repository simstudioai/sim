'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { PanelLeft } from '@sim/emcn/icons'
import { usePathname } from 'next/navigation'
import { getDesktopBridge } from '@/lib/desktop'
import { applyDesktopTitleBarMode, type DesktopTitleBarMode } from '@/app/_shell/desktop-title-bar'
import { useSidebarPeek } from '@/app/workspace/[workspaceId]/components/workspace-chrome/use-sidebar-peek'
import { Sidebar, SidebarTooltip } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import { useFullscreenOriginStore } from '@/stores/fullscreen-origin'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { useSidebarStore } from '@/stores/sidebar/store'

const FULLSCREEN_SUFFIXES = ['/upgrade'] as const

/** Slide timing for the fullscreen sidebar collapse and content shift. */
const SLIDE_TRANSITION =
  'duration-[175ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none'

/**
 * The peek card's floating chrome.
 *
 * Every value is an existing token: `rounded-lg` is `--radius`, matching the content
 * pane it floats beside; `--border` is that pane's border; `shadow-overlay` and
 * `--z-modal` are what the app's other edge-anchored panels use. The card's fill is
 * the sidebar's own `--surface-1`, so docked and floating are the same surface.
 *
 * `w-auto` shrink-wraps the inner shell, which `[data-peek]` has already put at the
 * expanded width. It must not be a length: `width` cannot interpolate to or from
 * `auto`, so entering and leaving the peek snap instead of animating — otherwise the
 * card widens as it appears and leaves a shrinking ghost on retract.
 */
const PEEK_CARD_CHROME =
  'absolute top-[var(--desktop-title-bar-height)] bottom-2 left-2 z-[var(--z-modal)] w-auto origin-top-left rounded-lg border border-[var(--border)] shadow-overlay'

/**
 * Peek card enter/exit — the popper idiom rather than a slide, since the card is
 * anchored to the title-bar toggle and grows out of that corner exactly as emcn's
 * Radix surfaces do (`dropdown-menu.tsx`: `fade-in-0 zoom-in-95`).
 *
 * Animations rather than transitions: an animation runs from mount, so the card needs
 * no hidden "from" frame and no `requestAnimationFrame` to step into — rAF is throttled
 * in an unfocused window, which would strand the card mounted-but-invisible.
 *
 * `duration-150` must match {@link PEEK_EXIT_DURATION_MS}.
 */
const PEEK_CARD_ENTER = cn(
  PEEK_CARD_CHROME,
  'animate-in fade-in-0 zoom-in-95 duration-150 ease-out motion-reduce:animate-none'
)
const PEEK_CARD_EXIT = cn(
  PEEK_CARD_CHROME,
  'pointer-events-none animate-out fade-out-0 zoom-out-95 fill-mode-forwards duration-150 ease-out motion-reduce:animate-none'
)

/** The docked rail: in flow, width-animated by the collapse toggle. */
const SIDEBAR_SHELL_IN_FLOW = cn('transition-[width]', SLIDE_TRANSITION)

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
 *
 * On the macOS desktop shell, where collapsing hides the rail entirely, the same
 * wrapper doubles as the hover-peek card: hovering the title-bar sidebar toggle
 * takes it out of flow, floats it over the content inset from the window edge, and
 * re-points `--sidebar-width` at the restore width. The sidebar is never re-mounted
 * or duplicated for this — see {@link useSidebarPeek}.
 */
export function WorkspaceChrome({
  children,
  initialSidebarCollapsed = false,
}: WorkspaceChromeProps) {
  const rafRef = useRef(0)

  const pathname = usePathname()
  const isFullscreen = isFullscreenPath(pathname)

  const setOrigin = useFullscreenOriginStore((s) => s.setOrigin)

  /**
   * Which title-bar treatment the host is using. `inset` is the macOS desktop shell,
   * where collapsing hides the rail entirely (`--sidebar-collapsed-width: 0`) — the
   * only host where the hover-peek applies. `null` is the web app (icon rail).
   */
  const [titleBarMode, setTitleBarMode] = useState<DesktopTitleBarMode>(null)

  /**
   * The search palette is the one overlay reachable from the peeked card that renders
   * a full-screen scrim, so the card yields to it. Read from the store rather than
   * sniffed off the DOM — the store is the modal's own source of truth.
   */
  const isSearchModalOpen = useSearchModalStore((s) => s.isOpen)

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
   * The hover-peek only exists where collapsing leaves nothing behind — the macOS
   * desktop shell. The web app keeps a 51px icon rail (with its own hover flyouts),
   * and native fullscreen falls back to that same rail.
   */
  const peekEnabled = isCollapsed && !isFullscreen && titleBarMode === 'inset'
  const { isPeekActive, isPeekOpen, cardRef, triggerRef, onTriggerEnter, onTriggerLeave } =
    useSidebarPeek(peekEnabled, isSearchModalOpen)

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
    // Seed from the attribute the pre-paint script already wrote, so the peek is armed
    // on the first hover instead of waiting for the async bridge below to resolve.
    const initial = document.documentElement.getAttribute('data-sim-desktop-title-bar')
    if (initial === 'inset' || initial === 'fullscreen') setTitleBarMode(initial)

    const windowState = getDesktopBridge()?.windowState
    if (!windowState) return

    let disposed = false
    const applyWindowState = ({ isFullScreen }: { isFullScreen: boolean }) => {
      if (!disposed) {
        const mode: DesktopTitleBarMode = isFullScreen ? 'fullscreen' : 'inset'
        applyDesktopTitleBarMode(document.documentElement, mode)
        setTitleBarMode(mode)
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
          isCollapsed ? 'h-[var(--desktop-title-bar-height)]' : 'h-2'
        )}
      />
      <div
        ref={cardRef}
        className={cn(
          'sidebar-shell-outer shrink-0 overflow-hidden',
          isPeekActive
            ? isPeekOpen
              ? PEEK_CARD_ENTER
              : PEEK_CARD_EXIT
            : cn(isFullscreen ? 'w-0' : 'w-[var(--sidebar-width)]', SIDEBAR_SHELL_IN_FLOW)
        )}
        data-collapsed={isCollapsed || undefined}
        data-peek={isPeekActive || undefined}
        /* Also hidden mid-exit, where the card is mounted but invisible. */
        aria-hidden={isFullscreen || (isPeekActive && !isPeekOpen) || undefined}
        suppressHydrationWarning
      >
        <div
          className={cn(
            'sidebar-shell-inner h-full w-[var(--sidebar-width)] shrink-0 transition-transform',
            SLIDE_TRANSITION,
            isFullscreen && '-translate-x-full'
          )}
        >
          <Sidebar isCollapsed={isCollapsed} isPeeking={isPeekActive} />
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
        /**
         * The hover region lives on this wrapper, not the button: `SidebarTooltip`
         * returns bare `children` when disabled, so suppressing the tooltip while
         * peeking swaps the element tree and remounts the button. A ref on the
         * button would go null mid-hover and retract the card; the wrapper never
         * unmounts, so it stays a stable anchor for the pointer hit-test.
         */
        <div
          ref={triggerRef}
          onMouseEnter={onTriggerEnter}
          onMouseLeave={onTriggerLeave}
          className='absolute top-[var(--desktop-title-bar-control-offset)] left-[var(--desktop-title-bar-inset-x)] z-30 hidden size-[var(--desktop-title-bar-control-size)] [-webkit-app-region:no-drag] [[data-sim-desktop-title-bar=inset]_&]:block'
        >
          <SidebarTooltip
            label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            /* Gated on `peekEnabled`, not on the card being open: hovering always
               opens the card, so a tooltip tied to visibility would flash for the
               dwell and then vanish under it. When peek is armed the card IS the
               affordance; when it isn't (expanded, or web), the tooltip behaves
               exactly as before. Stable across a hover, so no remount mid-gesture. */
            enabled={!peekEnabled}
            side='bottom'
            shortcut='⌘B'
          >
            <button
              type='button'
              onClick={toggleSidebar}
              className='flex size-full items-center justify-center rounded-lg transition-colors hover-hover:bg-[var(--surface-active)]'
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <PanelLeft className='size-[var(--desktop-title-bar-control-icon-size)] text-[var(--text-icon)]' />
            </button>
          </SidebarTooltip>
        </div>
      )}
    </div>
  )
}
