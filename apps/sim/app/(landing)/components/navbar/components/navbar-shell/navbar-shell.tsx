'use client'

import type { ReactNode } from 'react'
import { createContext, use, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import colorMixFallbacks from '@/app/(landing)/components/shared/color-mix-fallbacks/color-mix-fallbacks.module.css'

/**
 * Frosted near-white surface for the scrolled bar - `--bg` at 92% + a strong 40px
 * blur, edge to edge. Exported as the single source of truth so the mobile
 * dropdown sheet ({@link MobileNav}) wears the exact same glass as the bar and the
 * two can never drift.
 */
export const NAVBAR_GLASS_SURFACE = cn(colorMixFallbacks.navbarGlass, 'backdrop-blur-2xl')

interface NavbarFrostContextValue {
  /**
   * Reported independently by the desktop and mobile menus so shared shell
   * effects remain active until every open navigation surface has closed.
   */
  setMenuOpen: (source: 'desktop' | 'mobile', open: boolean) => void
}

const NavbarFrostContext = createContext<NavbarFrostContextValue | null>(null)

/** Lets each nav surface report its open state so the shell can coordinate shared effects. */
export function useNavbarFrost(): NavbarFrostContextValue | null {
  return use(NavbarFrostContext)
}

interface NavbarShellProps {
  children: ReactNode
}

/**
 * Sticky navbar chrome that frosts to glass once the page scrolls or while a
 * desktop or mobile navigation menu is open.
 *
 * At the very top the bar uses the same solid canvas token as the hero, so it is
 * visually seamless while still preventing route content from painting through
 * the sticky header. A 1px sentinel at the top of the landing shell's internal
 * scroll port is watched by an {@link IntersectionObserver} - no scroll listener
 * and no per-frame work. Past that point the bar gains the shared
 * {@link NAVBAR_GLASS_SURFACE} (`--bg` at 92% via `color-mix` plus a strong 40px
 * backdrop blur) - a white/glass surface built entirely from the platform's
 * light tokens, not invented colors.
 *
 * Only `background-color` is transitioned, NOT `backdrop-filter`: animating the
 * blur re-runs every time the threshold is re-crossed, which on mobile reads as a
 * vertical wobble of the bar's text as you scroll near the top. The blur snaps in
 * while the fill still fades, so the frost appears smoothly without the jitter.
 *
 * The measured header height anchors the desktop panel and bounds the mobile
 * sheet, including changes to the announcement strip or text sizing. The same
 * height offsets native page and hash scrolling inside the landing scroll port.
 *
 * Both navigation surfaces report open state through {@link NavbarFrostContext}.
 * While either is open, the shell locks its actual scroll port, preserves the
 * scrollbar gutter, frosts the header, and fades page content beneath a fixed
 * veil. The sticky bar, trigger, and menu remain one stationary foreground layer.
 *
 * The frost lives on a separate sibling layer (`absolute inset-0 -z-10`) behind
 * the nav content rather than on the `<header>` element itself. This is
 * deliberate: a `backdrop-filter` ancestor establishes a backdrop root that
 * starves any descendant's own `backdrop-filter`, so a header that carried the
 * blur would render the mobile dropdown's identical glass at a fraction of the
 * strength (the dropdown is nested inside the header). With the blur on a sibling
 * layer instead, the `<header>` has no backdrop-filter, so the dropdown samples
 * the page directly and frosts at the exact same strength as the bar.
 *
 * The sentinel's height is cancelled by `-mb-px` so it contributes nothing to
 * layout flow: the sticky header sits at `y=0` from the start and never creeps
 * the 1px between its flowing and stuck positions as you begin scrolling.
 *
 * Only this shell hydrates; the nav content is server-rendered and passed through
 * as {@link children}, so the wordmark and links stay zero-hydration and crawlable.
 */
export function NavbarShell({ children }: NavbarShellProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const [menuOpenBySource, setMenuOpenBySource] = useState({ desktop: false, mobile: false })
  const menuOpen = menuOpenBySource.desktop || menuOpenBySource.mobile

  useEffect(() => {
    const header = headerRef.current
    const scrollPort = sentinelRef.current?.parentElement
    if (!header || !scrollPort) return

    const previousScrollPaddingTop = scrollPort.style.scrollPaddingTop
    let previousHeight = 0
    const updateHeight = () => {
      const height = header.getBoundingClientRect().height
      if (height === previousHeight) return
      previousHeight = height
      header.style.setProperty('--landing-header-height', `${height}px`)
      scrollPort.style.scrollPaddingTop = `${height}px`
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(header)
    return () => {
      observer.disconnect()
      scrollPort.style.scrollPaddingTop = previousScrollPaddingTop
    }
  }, [])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const scrollPort = sentinel.parentElement
    if (!scrollPort) return

    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting), {
      root: scrollPort,
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!menuOpen) return

    const scrollPort = sentinelRef.current?.parentElement
    if (!scrollPort) return

    const root = document.documentElement
    const previousOverflowY = scrollPort.style.overflowY
    const previousPaddingRight = scrollPort.style.paddingRight
    const previousRootOverscrollY = root.style.overscrollBehaviorY
    const scrollbarWidth = scrollPort.offsetWidth - scrollPort.clientWidth

    scrollPort.style.overflowY = 'hidden'
    if (scrollbarWidth > 0) scrollPort.style.paddingRight = `${scrollbarWidth}px`
    /**
     * A hidden-overflow port is no longer a scroll target, so wheel gestures
     * over the open menu chain to the viewport and rubber-band the document
     * past the top, carrying the sticky bar away from the fixed panel. The
     * root's overscroll setting is what the viewport consults, so pin it for
     * the lock's lifetime.
     */
    root.style.overscrollBehaviorY = 'none'

    return () => {
      scrollPort.style.overflowY = previousOverflowY
      scrollPort.style.paddingRight = previousPaddingRight
      root.style.overscrollBehaviorY = previousRootOverscrollY
    }
  }, [menuOpen])

  const frost = useMemo<NavbarFrostContextValue>(
    () => ({
      setMenuOpen: (source, open) => {
        setMenuOpenBySource((current) =>
          current[source] === open ? current : { ...current, [source]: open }
        )
      },
    }),
    []
  )

  return (
    <NavbarFrostContext value={frost}>
      <div ref={sentinelRef} aria-hidden='true' className='-mb-px h-px' />
      <header
        ref={headerRef}
        data-landing-header
        className='sticky top-0 z-50 [--landing-header-height:calc(1.95rem_+_62px)]'
      >
        <div
          aria-hidden='true'
          className={cn(
            '-z-10 pointer-events-none absolute inset-0 transition-[background-color] duration-200 motion-reduce:transition-none',
            scrolled || menuOpen ? NAVBAR_GLASS_SURFACE : 'bg-[var(--bg)]'
          )}
        />
        {children}
      </header>
      <div
        aria-hidden='true'
        data-navigation-backdrop
        className={cn(
          'pointer-events-none fixed inset-0 z-40 bg-[var(--bg)] transition-opacity duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
          menuOpen ? 'opacity-75' : 'opacity-0'
        )}
      />
    </NavbarFrostContext>
  )
}
