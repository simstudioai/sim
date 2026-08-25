'use client'

import type { ReactNode } from 'react'
import { TrackingConsentProvider } from '@/lib/consent/tracking-consent'
import { ConsentBanner } from '@/app/_shell/consent/consent-banner'
import { ConsentStoreProvider } from '@/app/_shell/consent/consent-store-provider'
import { GoogleAnalyticsPageViewTracker } from '@/app/_shell/consent/google-analytics-page-view-tracker'

interface ConsentProviderProps {
  children: ReactNode
}

/**
 * Owns hosted Sim's consent lifecycle across every route. The banner stays off
 * until the resolved jurisdiction policy requires it and then appears on every
 * entry route, including a direct workspace visit. Privacy settings remain the
 * durable control after the initial decision.
 */
export function ConsentProvider({ children }: ConsentProviderProps) {
  return (
    <ConsentStoreProvider>
      <TrackingConsentProvider>
        {children}
        <GoogleAnalyticsPageViewTracker />
        <ConsentBanner />
      </TrackingConsentProvider>
    </ConsentStoreProvider>
  )
}
