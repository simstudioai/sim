'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { useMutation } from '@tanstack/react-query'

const logger = createLogger('ReferralAttribution')

const COOKIE_NAME = 'sim_utm'

const TERMINAL_REASONS = new Set([
  'invalid_cookie',
  'no_utm_cookie',
  'no_matching_campaign',
  'already_attributed',
])

async function postAttribution(): Promise<{
  attributed?: boolean
  bonusAmount?: number
  reason?: string
  error?: string
}> {
  const response = await fetch('/api/attribution', { method: 'POST' })
  if (!response.ok) {
    throw new Error(`Attribution request failed: ${response.status}`)
  }
  return response.json()
}

/**
 * Fires a one-shot `POST /api/attribution` when a `sim_utm` cookie is present.
 * Retries on transient failures; stops on terminal outcomes.
 */
export function useReferralAttribution() {
  const calledRef = useRef(false)

  const { mutate } = useMutation({
    mutationFn: postAttribution,
    retry: (failureCount, error) => {
      if (failureCount >= 3) return false
      logger.warn('Referral attribution failed, will retry', { error })
      return true
    },
    onSuccess: (data) => {
      if (data.attributed) {
        logger.info('Referral attribution successful', { bonusAmount: data.bonusAmount })
      } else if (data.error || TERMINAL_REASONS.has(data.reason ?? '')) {
        logger.info('Referral attribution skipped', { reason: data.reason || data.error })
      } else {
        calledRef.current = false
      }
    },
    onError: () => {
      calledRef.current = false
    },
  })

  useEffect(() => {
    if (calledRef.current) return
    if (!document.cookie.includes(COOKIE_NAME)) return

    calledRef.current = true
    mutate()
  }, [mutate])
}
