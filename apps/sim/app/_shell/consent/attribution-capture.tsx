'use client'

import { useEffect } from 'react'
import { recordAttributionTouch } from '@/lib/analytics/attribution'
import { getStoredConsentExpiry } from '@/lib/consent/storage'
import { useTrackingConsent } from '@/lib/consent/tracking-consent'

let landingHref: string | undefined
let hasRecordedTouch = false

/**
 * The page this document was loaded on, with its original query. Consent can
 * resolve after a client navigation has dropped the campaign parameters, so
 * the navigation entry is preferred — but only when this component mounted on
 * that very page. Otherwise the entry may be an app or token-bearing utility
 * page, and the current page (a marketing or sign-in page, by where this is
 * mounted) is used instead.
 */
function resolveLandingHref(): string {
  const [navigation] = performance.getEntriesByType('navigation')
  if (navigation?.name) {
    try {
      if (new URL(navigation.name).pathname === window.location.pathname) return navigation.name
    } catch {}
  }
  return window.location.href
}

/**
 * Records the landing touch for this document once measurement consent is
 * granted. Mounted only by the marketing and sign-in layouts, so app pages,
 * customers' deployed chats, and token-bearing utility links are never
 * recorded as landing pages.
 */
export function AttributionCapture() {
  const { isResolved, measurement } = useTrackingConsent()

  useEffect(() => {
    landingHref ??= resolveLandingHref()
    if (!isResolved || !measurement || hasRecordedTouch) return
    hasRecordedTouch = true
    recordAttributionTouch({
      href: landingHref,
      referrer: document.referrer,
      now: new Date(),
      consentExpiresAt: getStoredConsentExpiry(),
    })
  }, [isResolved, measurement])

  return null
}
