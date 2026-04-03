'use client'

import { useEffect } from 'react'
import { usePostHog } from 'posthog-js/react'
import { captureEvent } from '@/lib/posthog/client'

export function LandingAnalytics() {
  const posthog = usePostHog()

  useEffect(() => {
    captureEvent(posthog, 'landing_page_viewed', {})
  }, [posthog])

  return null
}
