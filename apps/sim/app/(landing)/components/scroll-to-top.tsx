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

/**
 * Captured at module evaluation time. When this module is bundled into the
 * initial page payload (direct load / reload of a shelled route), readyState
 * is still `loading` or `interactive`, the browser will restore scroll on
 * reload, and we should skip the first reset. When the module is dynamically
 * imported during a client-side navigation (e.g., user clicked from `/` into
 * `/blog/x`), readyState is already `complete` and the first mount is a real
 * route change that should scroll to top.
 */
const wasInitialPageLoad = typeof document !== 'undefined' && document.readyState !== 'complete'

/**
 * Tracks whether any `ScrollToTop` instance has run its mount effect yet.
 * Module-scoped so cross-section navigation (which mounts a fresh instance)
 * doesn't re-trigger the initial-mount guard.
 */
let hasMounted = false

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
 * Skipped on the very first mount of an initial page load (so browser scroll
 * restoration on reload wins), when the pathname change closely follows a
 * popstate (preserving browser back/forward restoration), and when a hash
 * anchor is targeted (letting the browser's native anchor scroll win).
 */
export function ScrollToTop() {
  const pathname = usePathname()

  useEffect(() => {
    if (!hasMounted) {
      hasMounted = true
      if (wasInitialPageLoad) return
    }
    if (performance.now() - lastPopstateAt < POPSTATE_WINDOW_MS) {
      lastPopstateAt = Number.NEGATIVE_INFINITY
      return
    }
    if (window.location.hash) return
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
