'use client'

import type { ReactNode } from 'react'
import { type ConsentManagerOptions, ConsentManagerProvider } from '@c15t/nextjs/headless'
import { ConsentBanner } from '@/app/_shell/consent/consent-banner'
import { CONSENT_BACKEND_URL, CONSENT_CATEGORIES } from '@/app/_shell/consent/constants'

/**
 * Imported from `@c15t/nextjs/headless`, not the package root: the headless
 * entry ships the store and hooks without the runtime's own components or
 * stylesheet, so {@link ConsentBanner} is the only consent UI that exists and
 * nothing can leak styles into the app.
 */
const CONSENT_OPTIONS = {
  mode: 'hosted',
  backendURL: CONSENT_BACKEND_URL,
  consentCategories: [...CONSENT_CATEGORIES],
} satisfies ConsentManagerOptions

interface ConsentProviderProps {
  /**
   * Mounts the consent runtime. Pass `isHosted` — a self-hosted deployment sets
   * no cookies on Sim's behalf and must never see the banner or reach Sim's
   * consent backend, so the whole runtime stays unmounted rather than being
   * mounted and hidden.
   */
  enabled: boolean
  children: ReactNode
}

export function ConsentProvider({ enabled, children }: ConsentProviderProps) {
  if (!enabled) {
    return <>{children}</>
  }

  return (
    <ConsentManagerProvider options={CONSENT_OPTIONS}>
      {children}
      <ConsentBanner />
    </ConsentManagerProvider>
  )
}
