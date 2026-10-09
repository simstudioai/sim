import { createLogger, setRequestAuth } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  shopifyPrivacyPayloadSchemas,
  shopifyPrivacyTopicSchema,
  shopifyPrivacyWebhookContract,
} from '@/lib/api/contracts/shopify-privacy'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { OrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { receiveShopifyPrivacyRequest } from '@/lib/shopify/privacy/application/receive-request'
import {
  authenticateShopifyPrivacy,
  parseShopifyPrivacyJson,
} from '@/lib/shopify/privacy/authentication'
import { WEBHOOK_MAX_BODY_BYTES } from '@/lib/webhooks/constants'

const logger = createLogger('ShopifyPrivacyWebhook')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Shopify authenticates the original bytes, so this protocol adapter precedes JSON parsing. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const ticket = tryAdmit()
  if (!ticket) return admissionRejectedResponse()
  try {
    assertContentLengthWithinLimit(
      request.headers,
      WEBHOOK_MAX_BODY_BYTES,
      'Shopify privacy webhook'
    )
    const bytes = await readStreamToBufferWithLimit(request.body, {
      maxBytes: WEBHOOK_MAX_BODY_BYTES,
      label: 'Shopify privacy webhook',
    })
    const principal = authenticateShopifyPrivacy(
      bytes,
      request.headers.get('x-shopify-hmac-sha256')
    )
    setRequestAuth({ kind: principal.kind, clientId: principal.clientId })
    const topic = shopifyPrivacyTopicSchema.safeParse(request.headers.get('x-shopify-topic'))
    const webhookId = request.headers.get('x-shopify-webhook-id')
    if (!topic.success || !webhookId || !/^[A-Za-z0-9_-]{1,200}$/.test(webhookId)) {
      return NextResponse.json({ error: 'Invalid privacy delivery metadata' }, { status: 400 })
    }
    let rawBody: string
    let json: unknown
    try {
      rawBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      json = parseShopifyPrivacyJson(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid privacy JSON payload' }, { status: 400 })
    }
    const payload = shopifyPrivacyPayloadSchemas[topic.data].safeParse(json)
    const headerDomain = request.headers.get('x-shopify-shop-domain')
    if (!payload.success || (headerDomain && headerDomain !== payload.data.shop_domain)) {
      return NextResponse.json(
        { error: 'Invalid privacy payload or shop identity' },
        { status: 400 }
      )
    }
    await receiveShopifyPrivacyRequest.execute({
      principal,
      input: { topic: topic.data, webhookId, rawBody },
    })
    return NextResponse.json(
      shopifyPrivacyWebhookContract.response.schema.parse({ accepted: true })
    )
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
    }
    if (error instanceof OrchestrationError) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForOrchestrationError(error.code) }
      )
    }
    logger.error('Unable to durably accept Shopify privacy request')
    return NextResponse.json({ error: 'Privacy intake temporarily unavailable' }, { status: 503 })
  } finally {
    ticket.release()
  }
})
