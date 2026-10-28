'use client'

import { useCaptureWhenReady } from '@/hooks/use-capture-when-ready'

export function LandingAnalytics() {
  useCaptureWhenReady('landing_page_viewed', {})
  return null
}
