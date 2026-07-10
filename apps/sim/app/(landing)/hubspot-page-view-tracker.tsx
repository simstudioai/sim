'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

declare global {
  interface Window {
    _hsq?: unknown[][]
  }
}

/**
 * The HubSpot loader auto-tracks only the initial page load. LandingLayout
 * persists across client-side navigations between landing routes (see its
 * TSDoc), so HubSpot never sees those route changes on its own. Push a
 * manual pageview through HubSpot's `_hsq` queue on every navigation after
 * the first.
 */
export function HubspotPageViewTracker() {
  const pathname = usePathname()
  const isInitialRender = useRef(true)

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false
      return
    }

    window._hsq = window._hsq || []
    window._hsq.push(['setPath', pathname])
    window._hsq.push(['trackPageView'])
  }, [pathname])

  return null
}
