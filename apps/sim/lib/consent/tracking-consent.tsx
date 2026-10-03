'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { useConsentManager } from '@c15t/nextjs/headless'

interface TrackingConsent {
  isResolved: boolean
  measurement: boolean
  marketing: boolean
}

interface TrackingConsentProviderProps {
  children: ReactNode
}

const DEFAULT_TRACKING_CONSENT: TrackingConsent = {
  isResolved: false,
  measurement: false,
  marketing: false,
}

const TrackingConsentContext = createContext<TrackingConsent>(DEFAULT_TRACKING_CONSENT)

/**
 * Projects c15t's wider store into the small, safe contract used by analytics
 * consumers. The default denies every optional category, so components remain
 * safe when rendered by a self-hosted deployment without the c15t provider.
 */
export function TrackingConsentProvider({ children }: TrackingConsentProviderProps) {
  const { has, hasFetchedBanner } = useConsentManager()

  return (
    <TrackingConsentContext.Provider
      value={{
        isResolved: hasFetchedBanner,
        measurement: hasFetchedBanner && has('measurement'),
        marketing: hasFetchedBanner && has('marketing'),
      }}
    >
      {children}
    </TrackingConsentContext.Provider>
  )
}

/** Returns the settled tracking permissions, defaulting to deny outside hosted Sim. */
export function useTrackingConsent(): TrackingConsent {
  return useContext(TrackingConsentContext)
}
