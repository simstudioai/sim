'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

let hasTrackedInitialPageView = false

/**
 * The consent-gated HubSpot loader auto-tracks its first page. Pushes a manual
 * pageview through `_hsq` for later client navigations.
 */
export function HubspotPageViewTracker() {
  const pathname = usePathname()
  const lastTrackedPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (lastTrackedPathRef.current === pathname) return
    lastTrackedPathRef.current = pathname

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
