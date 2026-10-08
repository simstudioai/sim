'use client'

import { useEffect } from 'react'
import { clearAttributionCookies } from '@/lib/analytics/attribution'
import { useTrackingConsent } from '@/lib/consent/tracking-consent'

/**
 * Drops both attribution cookies once consent resolves without measurement,
 * on every route, so a withdrawn or expired grant can never be attributed by
 * the server, which only sees the cookies. Withdrawal reloads the page, so
 * this runs before any later sign-up.
 */
export function AttributionCookieGuard() {
  const { isResolved, measurement } = useTrackingConsent()

  useEffect(() => {
    if (isResolved && !measurement) clearAttributionCookies()
  }, [isResolved, measurement])

  return null
}
