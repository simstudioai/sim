'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

declare global {
  interface Window {
    _hsq?: unknown[][]
  }
}

// next/script dedupes by id and never reloads on remount, so this must be
// module-scope (not a ref) to survive LandingLayout unmounting/remounting.
let hasTrackedInitialPageView = false

/**
 * The HubSpot loader only auto-tracks the first page load; LandingLayout
 * persists across client-side navigations, so HubSpot never sees the rest.
 * Pushes a manual pageview through `_hsq` on every navigation after the first.
 */
export function HubspotPageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams.toString()

  useEffect(() => {
    if (!hasTrackedInitialPageView) {
      hasTrackedInitialPageView = true
      return
    }

    window._hsq = window._hsq || []
    window._hsq.push(['setPath', query ? `${pathname}?${query}` : pathname])
    window._hsq.push(['trackPageView'])
  }, [pathname, query])

  return null
}
