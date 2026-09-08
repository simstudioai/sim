'use client'

import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react'
import { cn } from '@sim/emcn'
import { ArrowLeft, ArrowRight, PanelLeft } from '@sim/emcn/icons'
import { usePathname } from 'next/navigation'
import { getDesktopBridge } from '@/lib/desktop'
import { applyDesktopTitleBarMode, type DesktopTitleBarMode } from '@/app/_shell/desktop-title-bar'
import { SidebarChromeProvider } from '@/app/workspace/[workspaceId]/components/workspace-chrome/sidebar-chrome-context'
import { useSidebarPeek } from '@/app/workspace/[workspaceId]/components/workspace-chrome/use-sidebar-peek'
import { SidebarTooltip } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-tooltip'
import { useFullscreenOriginStore } from '@/stores/fullscreen-origin'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { useSidebarStore } from '@/stores/sidebar/store'

const FULLSCREEN_SUFFIXES = ['/upgrade'] as const

/**
 * The peek card's floating chrome.
 *
 * Every value is an existing token: `rounded-lg` is `--radius`, matching the content
 * pane it floats beside; `--border` is that pane's border; `--z-modal` is what the
 * app's other edge-anchored panels use. The card's fill is the sidebar's own
 * `--surface-1`, so docked and floating are the same surface.
 *
 * Deliberately unshadowed. It separates on the same `--border` hairline the content
 * pane beside it uses; `--shadow-overlay` reads as too heavy at this size, where the
 * card abuts the window edge rather than floating over the middle of the page.
 *
 * The card hugs its content and caps at the pane height less the lane and the bottom
 * gutter — pinning both edges left a tall empty slab below short lists. It is a flex
 * column so the shell can shrink inside that cap and the sidebar's own scroll region
 * still bounds itself; see the `[data-peek]` rule in `globals.css`.
 *
 * `w-auto` shrink-wraps the inner shell, which `[data-peek]` has already put at the
 * expanded width. It must not be a length: `width` cannot interpolate to or from
 * `auto`, so entering and leaving the peek snap instead of animating — otherwise the
 * card widens as it appears and leaves a shrinking ghost on retract.
 */
const PEEK_CARD_CHROME =
  'absolute top-[var(--desktop-title-bar-height)] left-2 z-[var(--z-modal)] flex max-h-[calc(100%-var(--desktop-title-bar-height)-8px)] w-auto flex-col origin-top-left rounded-lg border border-[var(--border)]'

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

/**
 * The divider between the rail and the content pane, dropped when there is no rail
 * beside it: collapsed to nothing in the desktop shell, where the pane sits hard
 * against the window edge. A fullscreen route drops it through React state instead,
 * since that is a navigation rather than a pre-paint attribute.
 *
 * Keyed off the ancestor attributes rather than React state on purpose: the title-bar
 * attribute is written pre-paint, so a state-driven rule would flash the line on
 * first paint before hydration settles.
 */
const CONTENT_PANE_DIVIDER =
  'border-l border-[var(--border)] [[data-sim-desktop-title-bar=inset]_[data-sidebar-collapsed]_&]:border-l-0'

interface WorkspaceChromeProps {
  children: ReactNode
  /**
   * The rail this chrome hosts. Rendered once inside the shell and never re-mounted
   * across collapse, peek, or fullscreen; it reads collapse and peek state through
   * {@link useSidebarChrome}. The workspace passes its own `Sidebar`; the organization
   * surface passes `OrganizationSidebar`.
   */
  sidebar: ReactNode
  /** Cookie-derived collapse state from the server layout; seeds the sidebar's first render. */
  initialSidebarCollapsed?: boolean
}

/** Chromium Navigation API slice (absent from TS lib.dom). */
type ChromiumNavigation = EventTarget & { canGoBack: boolean; canGoForward: boolean }

const LANE_NAV_BUTTON =
  'flex size-[var(--desktop-title-bar-control-size)] items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-40 hover-hover:bg-[var(--surface-active)]'
const LANE_NAV_ICON = 'size-[var(--desktop-title-bar-control-icon-size)] text-[var(--text-icon)]'

/**
 * Back/forward history arrows in the desktop title-bar lane, right of the
 * sidebar toggle. Only the macOS shell sets the inset attribute, so the web
 * app never shows them; the shell's renderer is Chromium, so the Navigation
 * API is always there for the arrow state.
 */
function TitleBarHistoryNav() {
  const [can, setCan] = useState({ back: false, forward: false })

  useEffect(() => {
    const nav = (window as { navigation?: ChromiumNavigation }).navigation
    if (!nav) return
    let disposed = false
    // currententrychange dispatches SYNCHRONOUSLY from the history mutation
    // that caused it, which can originate inside another component's
    // useInsertionEffect (style libraries navigate during commit). Scheduling
    // state there is forbidden ("useInsertionEffect must not schedule
    // updates"), so the update defers to a microtask, which flushes after
    // the commit's synchronous work unwinds.
    const sync = () => {
      queueMicrotask(() => {
        if (!disposed) setCan({ back: nav.canGoBack, forward: nav.canGoForward })
      })
    }
    sync()
    nav.addEventListener('currententrychange', sync)
    return () => {
      disposed = true
      nav.removeEventListener('currententrychange', sync)
    }
  }, [])

  return (
    <div className='absolute top-[var(--desktop-title-bar-control-offset)] left-[calc(var(--desktop-title-bar-inset-x)+var(--desktop-title-bar-control-size)+4px)] z-30 hidden h-[var(--desktop-title-bar-control-size)] items-center gap-[2px] [-webkit-app-region:no-drag] [[data-sim-desktop-title-bar=inset]_&]:flex'>
      <button
        type='button'
        aria-label='Back'
        disabled={!can.back}
        onClick={() => window.history.back()}
        className={LANE_NAV_BUTTON}
      >
        <ArrowLeft className={LANE_NAV_ICON} />
      </button>
      <button
        type='button'
        aria-label='Forward'
        disabled={!can.forward}
        onClick={() => window.history.forward()}
        className={LANE_NAV_BUTTON}
      >
        <ArrowRight className={LANE_NAV_ICON} />
      </button>
    </div>
  )
}

function isFullscreenPath(pathname: string | null): boolean {
  return FULLSCREEN_SUFFIXES.some((s) => pathname?.endsWith(s))
}

/**
 * Renders the app chrome as a single persistent tree — the workspace layout and the
 * organization layout both mount it, each with its own sidebar. The sidebar is
 * always mounted; on a fullscreen route (`/upgrade`) its wrapper collapses to
 * zero width, revealing the route content. Because this component lives in the
 * layout it persists across navigations, so the rail never re-mounts.
 *
 * Nothing here animates: collapse, expand, and the fullscreen swap all apply in
 * one frame. The rail and the pane meet on a single hairline divider with no
 * gutter, radius, or shift between states.
 *
 * Because the chrome observes every pathname transition, it records the page a
 * fullscreen route was launched from into {@link useFullscreenOriginStore}. The
 * route's Back control reads that origin to return deterministically, so any
 * trigger that merely pushes a fullscreen route gets correct return-to-origin
 * without per-call-site wiring.
 *
 * On the macOS desktop shell, where collapsing hides the rail entirely, the same
 * wrapper doubles as the hover-peek card: hovering the title-bar sidebar toggle
 * takes it out of flow, floats it over the content inset from the window edge, and
 * re-points `--sidebar-width` at the restore width. The sidebar is never re-mounted
 * or duplicated for this — see {@link useSidebarPeek}.
 */
export function WorkspaceChrome({
  children,
  sidebar,
  initialSidebarCollapsed = false,
}: WorkspaceChromeProps) {
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
        return
      }
      // The shell's View > Search claims `Mod+K` before the renderer sees it, so
      // this must mirror the `open-search` global command — a toggle, not an open.
      if (command === 'open-search') {
        const searchModal = useSearchModalStore.getState()
        searchModal.setOpen(!searchModal.isOpen)
      }
    })
  }, [])

  /**
   * A layout effect, not a passive one: the seed below arms the peek, and a passive
   * effect lands after paint — long enough for a `mouseenter` on the toggle to be
   * dropped while the peek still reads disabled, with nothing to retry it until the
   * pointer leaves and returns. Everything here is a cheap synchronous read plus a
   * subscription; the bridge's `getState` stays async and blocks nothing.
   */
  useLayoutEffect(() => {
    // Seed from the attribute the pre-paint script already wrote, rather than waiting
    // for the async bridge below to resolve.
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
            : isFullscreen
              ? 'w-0'
              : 'w-[var(--sidebar-width)]'
        )}
        data-collapsed={isCollapsed || undefined}
        data-peek={isPeekActive || undefined}
        /* Also hidden mid-exit, where the card is mounted but invisible. */
        aria-hidden={isFullscreen || (isPeekActive && !isPeekOpen) || undefined}
        suppressHydrationWarning
      >
        <div className='sidebar-shell-inner h-full w-[var(--sidebar-width)] shrink-0'>
          <SidebarChromeProvider isCollapsed={isCollapsed} isPeeking={isPeekActive}>
            {sidebar}
          </SidebarChromeProvider>
        </div>
      </div>
      <div
        className='workspace-content-shell flex min-w-0 flex-1 flex-col'
        data-sidebar-collapsed={isCollapsed || undefined}
        /* A fullscreen route slides the sidebar away without collapsing it, so the pane
           inherits the traffic-light lane the same way a collapsed sidebar does. */
        data-content-fullscreen={isFullscreen || undefined}
      >
        <div
          className={cn(
            'flex-1 overflow-hidden bg-[var(--bg)]',
            CONTENT_PANE_DIVIDER,
            isFullscreen && 'border-l-0'
          )}
        >
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
      {!isFullscreen && <TitleBarHistoryNav />}
    </div>
  )
}
