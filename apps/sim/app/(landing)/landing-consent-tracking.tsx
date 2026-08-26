'use client'

import { useConsentScript } from '@c15t/nextjs/headless'
import { HUBSPOT_SCRIPT, X_PIXEL_SCRIPT } from '@/lib/consent/scripts'
import { HubspotPageViewTracker } from '@/app/(landing)/hubspot-page-view-tracker'
import { XPageViewTracker } from '@/app/(landing)/x-page-view-tracker'

export function LandingConsentTracking() {
  const hubspot = useConsentScript({ script: HUBSPOT_SCRIPT, unmountBehavior: 'keep' })
  const xPixel = useConsentScript({ script: X_PIXEL_SCRIPT, unmountBehavior: 'keep' })

  return (
    <>
      {hubspot.status === 'ready' && <HubspotPageViewTracker />}
      {xPixel.status === 'ready' && <XPageViewTracker />}
    </>
  )
}
