'use client'

import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/core/utils/cn'

interface NavbarShellProps {
  children: ReactNode
}

/** Frosted near-white surface for the scrolled bar — `--bg` at 88% + a 16px blur, edge to edge. */
const GLASS_SURFACE = 'bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] backdrop-blur-lg'

/**
 * Sticky navbar chrome that frosts to glass once the page scrolls.
 *
 * At the very top the bar is transparent, seamless over the hero canvas. A 1px
 * sentinel at the top of the scroll content is watched by an
 * {@link IntersectionObserver} — no scroll listener (landing perf rules) and no
 * per-frame work; it fires once when the sentinel leaves the viewport. Past
 * that point the bar gains a translucent near-white fill (`--bg` at 80% via
 * `color-mix`) and a 12px backdrop blur — a white/glass surface built entirely
 * from the platform's light tokens, not invented colors.
 *
 * The sentinel's height is cancelled by `-mb-px` so it contributes nothing to
 * layout flow: the sticky header sits at `y=0` from the start and never creeps
 * the 1px between its flowing and stuck positions as you begin scrolling.
 *
 * Only this shell hydrates; the nav content is server-rendered and passed
 * through as {@link children}, so the wordmark and links stay zero-hydration
 * and crawlable.
 */
export function NavbarShell({ children }: NavbarShellProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting))
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <div ref={sentinelRef} aria-hidden='true' className='-mb-px h-px' />
      <header
        className={cn(
          'sticky top-0 z-50 transition-[background-color,backdrop-filter] duration-200 motion-reduce:transition-none',
          scrolled ? GLASS_SURFACE : 'bg-transparent'
        )}
      >
        {children}
      </header>
    </>
  )
}
