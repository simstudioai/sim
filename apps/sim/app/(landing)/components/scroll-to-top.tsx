'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Timestamp of the most recent popstate. Module-scoped so it survives layout
 * remounts when navigating across sections (e.g., blog ↔ integrations ↔ models),
 * where the outgoing layout's component instances unmount before the incoming
 * layout's effect runs.
 *
 * Initialized to `-Infinity` so initial mounts don't mimic a recent popstate.
 * Consumed on first use (reset back to `-Infinity`) so a real link navigation
 * immediately after Back isn't swallowed. The timestamp window provides a
 * safety net for popstates that never trigger a pathname effect (e.g.,
 * hash-only back/forward), letting the signal self-expire.
 */
let lastPopstateAt = Number.NEGATIVE_INFINITY
const POPSTATE_WINDOW_MS = 200

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    lastPopstateAt = performance.now()
  })
}

/**
 * Resets window scroll to the top on App Router pathname changes.
 *
 * Next.js's default scroll handling only brings the new Page element into view,
 * which often resolves to "no scroll" inside shared layouts (see vercel/next.js#64435).
 *
 * Skipped when the pathname change closely follows a popstate (preserving browser
 * back/forward scroll restoration) or when a hash anchor is targeted (letting the
 * browser's native anchor scroll win).
 */
export function ScrollToTop() {
  const pathname = usePathname()

  useEffect(() => {
    if (performance.now() - lastPopstateAt < POPSTATE_WINDOW_MS) {
      lastPopstateAt = Number.NEGATIVE_INFINITY
      return
    }
    if (window.location.hash) return
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
