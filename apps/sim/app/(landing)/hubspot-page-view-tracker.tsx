'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

declare global {
  interface Window {
    _hsq?: unknown[][]
  }
}

// next/script dedupes by id, so the HubSpot loader auto-tracks exactly one
// pageview per browser session and never reloads on remount. Track that at
// module scope so it survives LandingLayout unmounting and remounting (e.g.
// leaving the landing site and navigating back).
let hasTrackedInitialPageView = false

/**
 * The HubSpot loader auto-tracks only the very first page load. LandingLayout
 * persists across client-side navigations between landing routes (see its
 * TSDoc), so HubSpot never sees those route changes on its own. Push a
 * manual pageview through HubSpot's `_hsq` queue on every navigation after
 * the first.
 */
export function HubspotPageViewTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (!hasTrackedInitialPageView) {
      hasTrackedInitialPageView = true
      return
    }

    window._hsq = window._hsq || []
    window._hsq.push(['setPath', pathname])
    window._hsq.push(['trackPageView'])
  }, [pathname])

  return null
}
