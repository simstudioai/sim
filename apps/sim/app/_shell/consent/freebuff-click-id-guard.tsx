'use client'

import { useEffect } from 'react'
import { clearFreebuffClickId } from '@/lib/analytics/freebuff'
import { useTrackingConsent } from '@/lib/consent/tracking-consent'

/**
 * Drops a stored Freebuff click id once consent resolves without marketing, so
 * a withdrawn or expired grant can never be attributed by the server postback,
 * which only sees the cookie. Withdrawal reloads the page, so this runs before
 * any later signup.
 */
export function FreebuffClickIdGuard() {
  const { isResolved, marketing } = useTrackingConsent()

  useEffect(() => {
    if (isResolved && !marketing) clearFreebuffClickId()
  }, [isResolved, marketing])

  return null
}
