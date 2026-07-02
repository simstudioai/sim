'use client'

import type { ReactNode } from 'react'
import { createContext, use, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@sim/emcn'

/**
 * Frosted near-white surface for the scrolled bar - `--bg` at 92% + a strong 40px
 * blur, edge to edge. Exported as the single source of truth so the mobile
 * dropdown sheet ({@link MobileNav}) wears the exact same glass as the bar and the
 * two can never drift.
 */
export const NAVBAR_GLASS_SURFACE =
  'bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] backdrop-blur-2xl'

interface NavbarFrostContextValue {
  /**
   * Reported by the mobile sheet as it opens/closes so the bar frosts to glass
   * while the menu is open - the bar and the dropdown then read as one continuous
   * frosted panel instead of a transparent bar over a separate sheet.
   */
  setMenuOpen: (open: boolean) => void
}

const NavbarFrostContext = createContext<NavbarFrostContextValue | null>(null)

/** Lets the mobile nav report its open state up to the shell so the bar can frost in sync. */
export function useNavbarFrost(): NavbarFrostContextValue | null {
  return use(NavbarFrostContext)
}

interface NavbarShellProps {
  children: ReactNode
}

/**
 * Sticky navbar chrome that frosts to glass once the page scrolls (or, on mobile,
 * while the dropdown menu is open).
 *
 * At the very top the bar is transparent, seamless over the hero canvas. A 1px
 * sentinel at the top of the scroll content is watched by an
 * {@link IntersectionObserver} - no scroll listener (landing perf rules) and no
 * per-frame work; it fires once when the sentinel leaves the viewport. Past that
 * point the bar gains the shared {@link NAVBAR_GLASS_SURFACE} (`--bg` at 92% via
 * `color-mix` plus a strong 40px backdrop blur) - a white/glass surface built
 * entirely from the platform's light tokens, not invented colors.
 *
 * Only `background-color` is transitioned, NOT `backdrop-filter`: animating the
 * blur re-runs every time the threshold is re-crossed, which on mobile reads as a
 * vertical wobble of the bar's text as you scroll near the top. The blur snaps in
 * while the fill still fades, so the frost appears smoothly without the jitter.
 *
 * The mobile sheet reports its open state through {@link NavbarFrostContext}, so
 * opening the menu also frosts the bar - the bar and the dropdown then form one
 * continuous glass panel with no transparent seam between them.
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
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting))
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  const frost = useMemo<NavbarFrostContextValue>(() => ({ setMenuOpen }), [])

  return (
    <NavbarFrostContext value={frost}>
      <div ref={sentinelRef} aria-hidden='true' className='-mb-px h-px' />
      <header className='sticky top-0 z-50'>
        <div
          aria-hidden='true'
          className={cn(
            '-z-10 absolute inset-0 transition-[background-color] duration-200 motion-reduce:transition-none',
            scrolled || menuOpen ? NAVBAR_GLASS_SURFACE : 'bg-transparent'
          )}
        />
        {children}
      </header>
    </NavbarFrostContext>
  )
}
