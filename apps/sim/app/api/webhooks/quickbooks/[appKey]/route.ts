import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type QuickBooksWebhookEvent,
  quickBooksWebhookEventSchema,
  quickBooksWebhookParamsSchema,
} from '@/lib/api/contracts/webhooks'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { WEBHOOK_MAX_BODY_BYTES } from '@/lib/webhooks/constants'
import { verifyQuickBooksSignatureAgainstVerifierTokenStream } from '@/lib/webhooks/providers/quickbooks'
import { streamQuickBooksWebhookVerifierTokensByAppKey } from '@/lib/webhooks/quickbooks-credentials'
import {
  enqueueQuickBooksWebhookIngress,
  type QuickBooksWebhookIngressPayload,
} from '@/background/quickbooks-webhook-ingress'

const logger = createLogger('QuickBooksWebhookIngress')
const BODY_LABEL = 'QuickBooks webhook body'
/** Mirrors the batch ceiling `quickBooksWebhookEventsSchema` declares for the same envelope. */
const MAX_WEBHOOK_EVENTS = 1000

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

/** Verifies one user-owned Intuit app before durably accepting its CloudEvents batch. */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ appKey: string }> }) => {
    const ticket = tryAdmit()
    if (!ticket) return admissionRejectedResponse()

    const requestId = generateRequestId()
    const receivedAt = Date.now()
    try {
      const parsedParams = quickBooksWebhookParamsSchema.safeParse(await context.params)
      if (!parsedParams.success) {
        return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
      }
      const { appKey } = parsedParams.data

      let rawBody: string
      try {
        rawBody = await readBody(request)
      } catch (error) {
        if (isPayloadSizeLimitError(error)) {
          return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
        }
        throw error
      }

      const authError = await verifyQuickBooksSignatureAgainstVerifierTokenStream(
        rawBody,
        request.headers.get('intuit-signature'),
        streamQuickBooksWebhookVerifierTokensByAppKey(appKey),
        requestId
      )
      if (authError) return authError

      let json: unknown
      try {
        json = JSON.parse(rawBody)
      } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
      }
      if (!Array.isArray(json) || json.length === 0 || json.length > MAX_WEBHOOK_EVENTS) {
        logger.warn(`[${requestId}] Invalid QuickBooks webhook envelope`)
        return NextResponse.json({ error: 'Invalid webhook envelope' }, { status: 400 })
      }

      const events: QuickBooksWebhookEvent[] = []
      let droppedCount = 0
      for (const entry of json) {
        const parsedEvent = quickBooksWebhookEventSchema.safeParse(entry)
        if (parsedEvent.success) events.push(parsedEvent.data)
        else droppedCount += 1
      }
      if (droppedCount > 0) {
        logger.warn(`[${requestId}] Dropped unmodelled QuickBooks webhook events`, {
          droppedCount,
          eventCount: json.length,
        })
      }
      if (events.length === 0) return NextResponse.json({ ok: true })

      const payload: QuickBooksWebhookIngressPayload = {
        appKey,
        events,
        headers: {
          'content-type': request.headers.get('content-type') ?? 'application/json',
        },
        requestId,
        receivedAt,
      }
      const jobId = await enqueueQuickBooksWebhookIngress(payload)
      logger.info(`[${requestId}] Accepted QuickBooks webhook delivery`, {
        eventCount: events.length,
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
  }
)
