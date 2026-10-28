import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import type { FreebuffConversionEvent } from '@/lib/analytics/freebuff'
import { env } from '@/lib/core/config/env'

const logger = createLogger('FreebuffConversions')

const FREEBUFF_CONVERSIONS_URL = 'https://freebuff.com/api/advertisers/conversions'
const MAX_ATTEMPTS = 4
const REQUEST_TIMEOUT_MS = 10_000

/** Mirrors the tag's own click-id check, so a tampered cookie is never forwarded. */
const CLICK_ID_SHAPE = /^bfc_[A-Za-z0-9._-]{1,508}$/

interface FreebuffConversion {
  clickId: string
  eventType: FreebuffConversionEvent
  /** Idempotency key, shared with the tag call for the same conversion. */
  eventId: string
  occurredAt: Date
}

/**
 * Server-to-server conversion postback. Network failures and 5xx responses are
 * retried with the same `eventId` and `occurredAt`; every 4xx is terminal. A
 * `deduped` answer means the tag already reported it and is a success. Never
 * throws, so a caller can fire and forget.
 */
export async function reportFreebuffConversion(conversion: FreebuffConversion): Promise<void> {
  const apiKey = env.FREEBUFF_API_KEY
  if (!apiKey || !CLICK_ID_SHAPE.test(conversion.clickId)) return

  const body = JSON.stringify({
    clickId: conversion.clickId,
    eventType: conversion.eventType,
    eventId: conversion.eventId,
    occurredAt: conversion.occurredAt.toISOString(),
  })
  const context = { eventType: conversion.eventType, eventId: conversion.eventId }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let status: number | undefined
    try {
      const response = await fetch(FREEBUFF_CONVERSIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      status = response.status
      const result = await response.text().catch(() => '')
      if (response.ok) {
        logger.info('Freebuff conversion recorded', { ...context, result })
        return
      }
      if (status < 500) {
        logger.warn('Freebuff conversion rejected', { ...context, status, result })
        return
      }
    } catch (error) {
      logger.warn('Freebuff conversion request failed', { ...context, attempt, error })
    }
    if (attempt < MAX_ATTEMPTS) await sleep(backoffWithJitter(attempt, null))
    else logger.error('Freebuff conversion postback gave up', { ...context, status })
  }
}
