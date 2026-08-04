import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { quickBooksWebhookEventsSchema } from '@/lib/api/contracts/webhooks'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { WEBHOOK_MAX_BODY_BYTES } from '@/lib/webhooks/constants'
import { verifyQuickBooksSignature } from '@/lib/webhooks/providers/quickbooks'
import {
  enqueueQuickBooksWebhookIngress,
  type QuickBooksWebhookIngressPayload,
} from '@/background/quickbooks-webhook-ingress'

const logger = createLogger('QuickBooksWebhookIngress')
const BODY_LABEL = 'QuickBooks webhook body'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

async function readBody(request: Request): Promise<string> {
  assertContentLengthWithinLimit(request.headers, WEBHOOK_MAX_BODY_BYTES, BODY_LABEL)
  const buffer = await readStreamToBufferWithLimit(request.body, {
    maxBytes: WEBHOOK_MAX_BODY_BYTES,
    label: BODY_LABEL,
  })
  return new TextDecoder().decode(buffer)
}

/** App-level Intuit callback. Verifies raw bytes and durably accepts before fanout. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const ticket = tryAdmit()
  if (!ticket) return admissionRejectedResponse()

  const requestId = generateRequestId()
  const receivedAt = Date.now()
  try {
    let rawBody: string
    try {
      rawBody = await readBody(request)
    } catch (error) {
      if (isPayloadSizeLimitError(error)) {
        return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
      }
      throw error
    }

    const authError = verifyQuickBooksSignature(
      rawBody,
      request.headers.get('intuit-signature'),
      requestId
    )
    if (authError) return authError

    let json: unknown
    try {
      json = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = quickBooksWebhookEventsSchema.safeParse(json)
    if (!parsed.success) {
      logger.warn(`[${requestId}] Invalid QuickBooks webhook envelope`, {
        issues: parsed.error.issues,
      })
      return NextResponse.json({ error: 'Invalid webhook envelope' }, { status: 400 })
    }

    const payload: QuickBooksWebhookIngressPayload = {
      events: parsed.data,
      headers: {
        'content-type': request.headers.get('content-type') ?? 'application/json',
      },
      requestId,
      receivedAt,
    }
    const jobId = await enqueueQuickBooksWebhookIngress(payload)
    logger.info(`[${requestId}] Accepted QuickBooks webhook delivery`, {
      eventCount: parsed.data.length,
      jobId,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error(`[${requestId}] QuickBooks webhook ingress error`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return NextResponse.json({ error: 'Temporarily unable to accept webhook' }, { status: 503 })
  } finally {
    ticket.release()
  }
})
