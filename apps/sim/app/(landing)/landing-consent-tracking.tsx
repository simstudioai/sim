'use client'

import { useConsentScript } from '@c15t/nextjs/headless'
import { X_PIXEL_SCRIPT } from '@/lib/consent/scripts'
import { XPageViewTracker } from '@/app/(landing)/x-page-view-tracker'

export function LandingConsentTracking() {
  const xPixel = useConsentScript({ script: X_PIXEL_SCRIPT, unmountBehavior: 'keep' })

  return xPixel.status === 'ready' ? <XPageViewTracker /> : null
}
