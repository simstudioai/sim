import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { SIM_SITE_URL } from '@sim/utils/site'
import { env } from '@/lib/core/config/env'
import { type DemoBookerLookup, takeDemoBooker } from '@/lib/demo-booking/bookers'

const logger = createLogger('DemoBookingReview')

const CAL_API_URL = 'https://api.cal.com/v2'
const CAL_API_VERSION = '2026-02-25'
const MAX_ATTEMPTS = 2
const REQUEST_TIMEOUT_MS = 10_000
const DECLINE_REASON = `Please book your demo through ${SIM_SITE_URL}/demo.`

/**
 * What happened to a requested booking. `pending` leaves it in Cal.com's
 * unconfirmed list for the team to review by hand, so it never reaches a
 * calendar unless someone approves it.
 */
type DemoBookingDecision = 'confirmed' | 'declined' | 'pending'

interface DemoBookingRequest {
  bookingUid: string
  attendeeEmail: string
}

/**
 * Calls one Cal.com booking action. Network failures and 5xx responses are
 * retried once; a 4xx is terminal. Returns whether Cal.com accepted the call.
 */
async function callBookingAction(
  apiKey: string,
  bookingUid: string,
  action: 'confirm' | 'decline',
  body?: Record<string, string>
): Promise<boolean> {
  const url = `${CAL_API_URL}/bookings/${encodeURIComponent(bookingUid)}/${action}`
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let status: number | undefined
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'cal-api-version': CAL_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      status = response.status
      if (response.ok) return true
      if (status < 500) {
        logger.warn('Cal.com rejected the booking action', { action, status })
        return false
      }
    } catch (error) {
      logger.warn('Cal.com booking action failed', { action, attempt, error })
    }
    if (attempt < MAX_ATTEMPTS) await sleep(backoffWithJitter(attempt, null))
    else logger.error('Cal.com booking action gave up', { action, status })
  }
  return false
}

/**
 * Decides a requested demo booking from what the demo form recorded for its
 * attendee's email:
 *
 * - `verified`: confirmed, so it lands on the host's calendar.
 * - `unverified`: left pending for a person to review.
 * - `unseen`: declined. No form submission vouches for the email, which is what
 *   a bot booking the public Cal.com link directly looks like.
 *
 * Without an API key, or when the record cannot be read, every request is left
 * pending: failing closed here only costs the team a manual approval.
 */
export async function reviewDemoBookingRequest({
  bookingUid,
  attendeeEmail,
}: DemoBookingRequest): Promise<DemoBookingDecision> {
  const apiKey = env.CAL_API_KEY
  if (!apiKey) return 'pending'

  let booker: DemoBookerLookup
  try {
    booker = await takeDemoBooker(attendeeEmail)
  } catch (error) {
    logger.warn('Could not read the demo booker record', { error })
    return 'pending'
  }

  if (booker === 'verified') {
    return (await callBookingAction(apiKey, bookingUid, 'confirm')) ? 'confirmed' : 'pending'
  }
  if (booker === 'unseen') {
    const declined = await callBookingAction(apiKey, bookingUid, 'decline', {
      reason: DECLINE_REASON,
    })
    return declined ? 'declined' : 'pending'
  }
  return 'pending'
}
