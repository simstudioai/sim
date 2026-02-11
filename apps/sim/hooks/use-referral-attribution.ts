'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'

const logger = createLogger('ReferralAttribution')

const COOKIE_NAME = 'sim_utm'

/** Terminal reasons that should not be retried. */
const TERMINAL_REASONS = new Set(['account_predates_cookie', 'invalid_cookie'])

export function useReferralAttribution() {
  const calledRef = useRef(false)

  useEffect(() => {
    if (calledRef.current) return
    if (!document.cookie.includes(COOKIE_NAME)) return

    calledRef.current = true

    fetch('/api/attribution', { method: 'POST' })
      .then((res) => res.json())
      .then((data) => {
        if (data.attributed) {
          logger.info('Referral attribution successful', { bonusAmount: data.bonusAmount })
        } else if (data.error || TERMINAL_REASONS.has(data.reason)) {
          // Terminal — don't retry
          logger.info('Referral attribution skipped', { reason: data.reason || data.error })
        } else {
          // Non-terminal (e.g. transient failure) — allow retry on next mount
          calledRef.current = false
        }
      })
      .catch((err) => {
        logger.warn('Referral attribution failed, will retry', { error: err })
        calledRef.current = false
      })
  }, [])
}
