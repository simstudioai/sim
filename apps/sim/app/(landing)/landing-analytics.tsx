'use client'

import { useEffect } from 'react'
import { captureClientEvent } from '@/lib/posthog/client'

export function LandingAnalytics() {
  useEffect(() => {
    captureClientEvent('landing_page_viewed', {})
  }, [])

  return null
}
