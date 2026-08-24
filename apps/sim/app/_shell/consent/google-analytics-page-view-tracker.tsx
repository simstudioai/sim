'use client'

import { useEffect, useRef } from 'react'
import { useConsentManager } from '@c15t/nextjs/headless'
import { usePathname } from 'next/navigation'
import { trackGooglePageView } from '@/lib/analytics/google'

/** Tracks Next.js client navigations after c15t has loaded the consent-aware tag. */
export function GoogleAnalyticsPageViewTracker() {
  const pathname = usePathname()
  const { has, hasFetchedBanner, loadedScripts } = useConsentManager()
  const lastTrackedPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!hasFetchedBanner || !has('measurement') || !loadedScripts.gtag) return

    if (lastTrackedPathRef.current === null) {
      lastTrackedPathRef.current = pathname
      return
    }
    if (lastTrackedPathRef.current === pathname) return

    lastTrackedPathRef.current = pathname
    trackGooglePageView(pathname)
  }, [has, hasFetchedBanner, loadedScripts.gtag, pathname])

  return null
}
