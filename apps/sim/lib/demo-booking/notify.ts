import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import type { DemoBookerStatus } from '@/lib/demo-booking/bookers'
import type { DemoBookingDecision } from '@/lib/demo-booking/review'

const logger = createLogger('DemoRequestNotify')

const REQUEST_TIMEOUT_MS = 10_000

/** A demo form submission, sent once the visitor's record is saved. */
interface DemoRequestSubmittedEvent {
  type: 'demo_request.submitted'
  email: string
  name: string
  phone: string | null
  companySize: string
  details: string
  attribution: string | null
  verification: DemoBookerStatus
  submittedAt: string
}

/** The decision on a requested booking, sent after the review has acted on it. */
interface DemoBookingDecidedEvent {
  type: 'demo_request.booking'
  bookingUid: string
  email: string
  name: string | null
  startTime: string | null
  decision: DemoBookingDecision
}

type DemoRequestEvent = DemoRequestSubmittedEvent | DemoBookingDecidedEvent

/**
 * Sends a demo request event to `DEMO_REQUEST_WEBHOOK_URL`, the workflow that
 * posts each request to the sales channel and lets the team confirm or decline
 * a pending booking there. Best effort: a failure is logged and never reaches
 * the visitor or Cal.com, and with no URL configured nothing is sent.
 */
export async function notifyDemoRequest(event: DemoRequestEvent): Promise<void> {
  const url = env.DEMO_REQUEST_WEBHOOK_URL
  if (!url) return

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (env.DEMO_REQUEST_WEBHOOK_TOKEN) {
    headers.Authorization = `Bearer ${env.DEMO_REQUEST_WEBHOOK_TOKEN}`
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      logger.warn('Demo request webhook rejected the event', {
        type: event.type,
        status: response.status,
      })
    }
  } catch (error) {
    logger.warn('Demo request webhook failed', { type: event.type, error })
  }
}
