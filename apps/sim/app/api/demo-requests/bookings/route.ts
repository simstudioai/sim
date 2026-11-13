import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { after, type NextRequest, NextResponse } from 'next/server'
import {
  calBookingRequestSchema,
  type calBookingWebhookContract,
  calWebhookEnvelopeSchema,
} from '@/lib/api/contracts/demo-requests'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'
import { env } from '@/lib/core/config/env'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { notifyDemoRequest } from '@/lib/demo-booking/notify'
import { reviewDemoBookingRequest } from '@/lib/demo-booking/review'
import { WEBHOOK_MAX_BODY_BYTES } from '@/lib/webhooks/constants'

const logger = createLogger('DemoBookingWebhookAPI')

const BODY_LABEL = 'Cal.com booking webhook body'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type WebhookResponse = ContractJsonResponse<typeof calBookingWebhookContract>

const ACKNOWLEDGED: WebhookResponse = { ok: true }

async function readBody(request: NextRequest): Promise<string> {
  assertContentLengthWithinLimit(request.headers, WEBHOOK_MAX_BODY_BYTES, BODY_LABEL)
  const buffer = await readStreamToBufferWithLimit(request.body, {
    maxBytes: WEBHOOK_MAX_BODY_BYTES,
    label: BODY_LABEL,
  })
  return new TextDecoder().decode(buffer)
}

/**
 * Cal.com webhook for the `/demo` event type, which requires confirmation, so
 * every booking arrives as a request that stays off calendars until decided.
 * Subscribe it to `BOOKING_REQUESTED` on that event type only, signed with
 * `CAL_WEBHOOK_SECRET`. The signature is an HMAC-SHA256 hex digest of the raw
 * body in `x-cal-signature-256`. {@link reviewDemoBookingRequest} confirms,
 * declines, or leaves each request for manual review, and every booking it does
 * not decline is reported to the sales channel, where a pending one is
 * confirmed or declined by hand.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const secret = env.CAL_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let rawBody: string
  try {
    rawBody = await readBody(request)
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
    }
    throw error
  }

  const signature = request.headers.get('x-cal-signature-256')
  if (!signature || !safeCompare(signature, hmacSha256Hex(rawBody, secret))) {
    logger.warn('Rejected a demo booking webhook with an invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const envelope = calWebhookEnvelopeSchema.safeParse(json)
  if (!envelope.success || envelope.data.triggerEvent !== 'BOOKING_REQUESTED') {
    return NextResponse.json(ACKNOWLEDGED)
  }

  const booking = calBookingRequestSchema.safeParse(envelope.data.payload)
  if (!booking.success) {
    logger.warn('Demo booking request is missing its uid or attendee')
    return NextResponse.json(ACKNOWLEDGED)
  }

  const { uid, startTime, attendees } = booking.data
  const attendee = attendees[0]
  const decision = await reviewDemoBookingRequest({
    bookingUid: uid,
    attendeeEmail: attendee.email,
  })
  logger.info('Demo booking request reviewed', { decision })

  // A declined booking had no form submission behind it, which is what a bot
  // booking the public link looks like, so the sales channel never hears of it.
  if (decision !== 'declined') {
    after(() =>
      notifyDemoRequest({
        type: 'demo_request.booking',
        bookingUid: uid,
        email: attendee.email,
        name: attendee.name ?? null,
        startTime: startTime ?? null,
        decision,
      })
    )
  }
  return NextResponse.json<WebhookResponse>({ ok: true, decision })
})
