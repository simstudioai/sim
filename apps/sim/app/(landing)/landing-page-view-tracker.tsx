'use client'

import { usePathname } from 'next/navigation'
import { useCaptureWhenReady } from '@/hooks/use-capture-when-ready'

/**
 * Sends PostHog's `$pageview` for every marketing route, including client
 * navigations between them, so pricing, demo, and enterprise visits feed
 * PostHog funnels and web analytics. `capture_pageview` stays off app-wide;
 * this layout is the only place page views are wanted.
 */
export function LandingPageViewTracker() {
  useCaptureWhenReady('$pageview', {}, usePathname())
  return null
}
