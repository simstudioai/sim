'use client'

import { type ConsentManagerOptions, ConsentManagerProvider } from '@c15t/nextjs/headless'
import {
  CONSENT_BACKEND_URL,
  CONSENT_CATEGORIES,
  DEV_CONSENT_COUNTRY,
} from '@/lib/consent/constants'
import { ConsentBanner } from '@/app/_shell/consent/consent-banner'

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
  ...(DEV_CONSENT_COUNTRY ? { overrides: { country: DEV_CONSENT_COUNTRY } } : {}),
} satisfies ConsentManagerOptions

export function ConsentRuntime() {
  return (
    <ConsentManagerProvider options={CONSENT_OPTIONS}>
      <ConsentBanner />
    </ConsentManagerProvider>
  )
}
