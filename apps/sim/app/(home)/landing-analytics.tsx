'use client'

import { useEffect } from 'react'
import { usePostHog } from 'posthog-js/react'

export function LandingAnalytics() {
  const posthog = usePostHog()

  useEffect(() => {
    posthog?.capture('landing_page_viewed', {})
  }, [posthog])

  return null
}
