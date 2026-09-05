import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  quickBooksWebhookEventsSchema,
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
import { verifyQuickBooksSignatureAgainstVerifierTokens } from '@/lib/webhooks/providers/quickbooks'
import { getQuickBooksWebhookVerifierTokensByAppKey } from '@/lib/webhooks/quickbooks-credentials'
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

      const verifierTokens = await getQuickBooksWebhookVerifierTokensByAppKey(appKey)
      if (verifierTokens.length === 0) {
        return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
      }
      const authError = verifyQuickBooksSignatureAgainstVerifierTokens(
        rawBody,
        request.headers.get('intuit-signature'),
        verifierTokens,
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
        appKey,
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
  }
)
