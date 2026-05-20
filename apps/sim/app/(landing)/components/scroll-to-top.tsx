'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Module-level flag so the popstate signal survives layout remounts when the
 * user navigates across sections (e.g., blog ↔ integrations ↔ models), where
 * the outgoing layout — and its component instances — unmount before the
 * incoming layout's effect runs.
 */
let isPopNavigation = false

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    isPopNavigation = true
  })
}

/**
 * Resets window scroll to the top on App Router pathname changes.
 *
 * Next.js's default scroll handling only brings the new Page element into view,
 * which often resolves to "no scroll" inside shared layouts (see vercel/next.js#64435).
 *
 * Popstate-driven navigations are skipped so browser back/forward scroll
 * restoration is preserved, and hash-anchor navigations are skipped so the
 * browser's native anchor scroll wins.
 */
export function ScrollToTop() {
  const pathname = usePathname()

  useEffect(() => {
    if (isPopNavigation) {
      isPopNavigation = false
      return
    }
    if (window.location.hash) return
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
