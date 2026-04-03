'use client'

import { useEffect } from 'react'
import { usePostHog } from 'posthog-js/react'

/**
 * Fires a `landing_page_viewed` PostHog event on mount.
 * Renders nothing — exists only to bridge the server/client boundary
 * so the server-rendered landing page can emit analytics.
 */
export function LandingAnalytics() {
  const posthog = usePostHog()

  useEffect(() => {
    posthog?.capture('landing_page_viewed', {})
  }, [posthog])

  return null
}
