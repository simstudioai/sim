import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { tiktokWebhookEnvelopeSchema } from '@/lib/api/contracts/webhooks'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { env } from '@/lib/core/config/env'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { WEBHOOK_MAX_BODY_BYTES } from '@/lib/webhooks/constants'
import { verifyTikTokSignature } from '@/lib/webhooks/providers/tiktok'
import {
  enqueueTikTokWebhookIngress,
  type TikTokWebhookIngressPayload,
} from '@/background/tiktok-webhook-ingress'

const logger = createLogger('TikTokWebhookIngress')

const TIKTOK_BODY_LABEL = 'TikTok webhook body'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

async function readTikTokBody(req: Request): Promise<string> {
  assertContentLengthWithinLimit(req.headers, WEBHOOK_MAX_BODY_BYTES, TIKTOK_BODY_LABEL)
  const buffer = await readStreamToBufferWithLimit(req.body, {
    maxBytes: WEBHOOK_MAX_BODY_BYTES,
    label: TIKTOK_BODY_LABEL,
  })
  return new TextDecoder().decode(buffer)
}

/**
 * App-level TikTok webhook Callback URL.
 * Portal: `{APP_URL}/api/webhooks/tiktok` (e.g. https://www.sim.ai/api/webhooks/tiktok).
 * Verifies TikTok-Signature and durably accepts the delivery before background target fanout.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const ticket = tryAdmit()
  if (!ticket) {
    return admissionRejectedResponse()
  }

  const requestId = generateRequestId()
  const receivedAt = Date.now()

  try {
    let rawBody: string
    try {
      rawBody = await readTikTokBody(request)
    } catch (bodyError) {
      if (isPayloadSizeLimitError(bodyError)) {
        logger.warn(`[${requestId}] Rejected oversized TikTok webhook body`, {
          maxBytes: WEBHOOK_MAX_BODY_BYTES,
          observedBytes: bodyError.observedBytes,
        })
        return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
      }
      throw bodyError
    }

    const authError = verifyTikTokSignature(
      rawBody,
      request.headers.get('TikTok-Signature'),
      requestId
    )
    if (authError) {
      return authError
    }

    let parsedJson: unknown
    try {
      parsedJson = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      logger.warn(`[${requestId}] TikTok webhook body is not valid JSON`)
      // Ack to avoid retry storms on malformed payloads after a valid signature.
      return NextResponse.json({ ok: true })
    }

    const envelopeResult = tiktokWebhookEnvelopeSchema.safeParse(parsedJson)
    if (!envelopeResult.success) {
      logger.warn(`[${requestId}] Invalid TikTok webhook envelope`, {
        issues: envelopeResult.error.issues,
      })
      return NextResponse.json({ ok: true })
    }

    const envelope = envelopeResult.data
    if (!env.TIKTOK_CLIENT_ID || envelope.client_key !== env.TIKTOK_CLIENT_ID) {
      logger.warn(`[${requestId}] TikTok webhook client_key does not match configured app`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload: TikTokWebhookIngressPayload = {
      envelope,
      headers: {
        'content-type': request.headers.get('content-type') ?? 'application/json',
      },
      requestId,
      receivedAt,
    }
    const jobId = await enqueueTikTokWebhookIngress(payload)

    logger.info(`[${requestId}] Accepted TikTok webhook delivery`, {
      event: envelope.event,
      jobId,
      userOpenIdPrefix: envelope.user_openid.slice(0, 12),
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error(`[${requestId}] TikTok webhook ingress error`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return NextResponse.json({ error: 'Temporarily unable to accept webhook' }, { status: 503 })
  } finally {
    ticket.release()
  }
})
