import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  webhookTriggerDeleteContract,
  webhookTriggerGetContract,
  webhookTriggerPatchContract,
  webhookTriggerPostContract,
  webhookTriggerPutContract,
} from '@/lib/api/contracts/webhooks'
import { parseRequest } from '@/lib/api/server'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  dispatchResolvedWebhookTarget,
  findAllWebhooksForPath,
  handlePreLookupWebhookVerification,
  handleProviderChallenges,
  handleProviderReachabilityTest,
  parseWebhookBody,
  verifyProviderAuth,
} from '@/lib/webhooks/processor'
import { acceptsPathWebhookDelivery, acceptsWebhookDeliveryMethod } from '@/lib/webhooks/providers'

const logger = createLogger('WebhookTriggerAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

type RouteContext = { params: Promise<{ path: string }> }

type WebhookTriggerContract =
  | typeof webhookTriggerGetContract
  | typeof webhookTriggerPostContract
  | typeof webhookTriggerPutContract
  | typeof webhookTriggerPatchContract
  | typeof webhookTriggerDeleteContract

/**
 * Shared delivery entry point, running the steps that need no body — and therefore no load-shed
 * ticket — before admission, in the order the `GET` route has always run them:
 *
 * 1. resolve the path,
 * 2. offer the request to the provider challenge handlers,
 * 3. on `GET`, answer a setup-time verification probe for a path that has no webhook row yet,
 * 4. take a ticket and hand off to the delivery path.
 *
 * Steps 2 and 3 keep their relative order because a challenge is the more specific answer: a
 * provider echoing a token it chose beats a generic "reachable" 200 when a path somehow has both
 * pending at once.
 */
function defineDeliveryRoute(
  contract: WebhookTriggerContract,
  options: { probeBeforeLookup?: boolean } = {}
) {
  return withRouteHandler(async (request: NextRequest, context: RouteContext) => {
    const requestId = generateRequestId()
    const parsed = await parseRequest(contract, request, context)
    if (!parsed.success) return parsed.response
    const { path } = parsed.data.params

    const challenge = await handleProviderChallenges({}, request, requestId, path)
    if (challenge) return challenge

    if (options.probeBeforeLookup) {
      const verification = await handlePreLookupWebhookVerification(
        request.method,
        undefined,
        requestId,
        path
      )
      if (verification) return verification
    }

    const ticket = tryAdmit()
    if (!ticket) {
      return admissionRejectedResponse()
    }

    try {
      return await handleWebhookDelivery(request, requestId, path)
    } finally {
      ticket.release()
    }
  })
}

/**
 * `GET` alone probes before the lookup, because a provider validating a URL it has not been given
 * a webhook for can only be answered there. `handleWebhookDelivery` runs the same check for every
 * method once the lookup comes back empty.
 */
export const GET = defineDeliveryRoute(webhookTriggerGetContract, { probeBeforeLookup: true })

export const POST = defineDeliveryRoute(webhookTriggerPostContract)

/**
 * Accepted only by a webhook whose provider declares the method AND whose owner has opted in.
 * Everything else gets a 405 from `handleWebhookDelivery`.
 */
export const PUT = defineDeliveryRoute(webhookTriggerPutContract)
export const PATCH = defineDeliveryRoute(webhookTriggerPatchContract)
export const DELETE = defineDeliveryRoute(webhookTriggerDeleteContract)

/**
 * A 405 response carries `Allow` per RFC 9110. Every rejection here allows exactly `POST`: a
 * webhook
 * that accepts more never reaches this branch, so the header cannot be used to tell an unknown
 * path from a configured one.
 */
function methodNotAllowedResponse(): NextResponse {
  return new NextResponse('Method not allowed', { status: 405, headers: { Allow: 'POST' } })
}

/**
 * The answer for a path that will not accept this delivery. `POST` keeps its historical 404 so
 * existing callers see no change; anything else answers 405 uniformly, whether the path is
 * unknown, holds only non-path triggers, or holds a trigger that has not opted into the method —
 * so a probe cannot tell those apart.
 */
function notDeliverableResponse(method: string): NextResponse {
  return method === 'POST'
    ? new NextResponse('Not Found', { status: 404 })
    : methodNotAllowedResponse()
}

async function handleWebhookDelivery(
  request: NextRequest,
  requestId: string,
  path: string
): Promise<NextResponse> {
  const receivedAt = Date.now()
  /**
   * Slack signs every interactive request with the originating interaction time.
   * Capturing it lets the executor surface the true trigger_id age (the window
   * that expires at 3s) instead of only the in-workflow block timings.
   */
  const slackRequestTimestamp = request.headers.get('x-slack-request-timestamp')
  const triggerTimestampMs = slackRequestTimestamp
    ? Number(slackRequestTimestamp) * 1000
    : undefined

  const parseResult = await parseWebhookBody(request, requestId)

  // Check if parseWebhookBody returned an error response
  if (parseResult instanceof NextResponse) {
    return parseResult
  }

  const { body, rawBody } = parseResult

  /**
   * Offered a second time, now with the parsed body: the pre-admission pass answers only the
   * handshakes readable from the URL, and the rest match on body shape.
   */
  const challengeResponse = await handleProviderChallenges(body, request, requestId, path, rawBody)
  if (challengeResponse) {
    return challengeResponse
  }

  // Find all webhooks for this path (multiple webhooks in one workflow may share a path)
  const allWebhooksForPath = await findAllWebhooksForPath({ requestId, path })

  const pathWebhooks = allWebhooksForPath.filter(({ webhook: foundWebhook }) =>
    acceptsPathWebhookDelivery(foundWebhook.provider)
  )

  if (allWebhooksForPath.length > 0 && pathWebhooks.length === 0) {
    logger.warn(`[${requestId}] Rejected HTTP delivery to non-path trigger: ${path}`)
    return notDeliverableResponse(request.method)
  }

  const webhooksForPath = pathWebhooks.filter(({ webhook: foundWebhook }) =>
    acceptsWebhookDeliveryMethod(foundWebhook.provider, request.method, foundWebhook.providerConfig)
  )

  if (pathWebhooks.length > 0 && webhooksForPath.length === 0) {
    logger.warn(
      `[${requestId}] Rejected ${request.method} delivery to path ${path}: no trigger on this path accepts that method`
    )
    return methodNotAllowedResponse()
  }

  if (webhooksForPath.length === 0) {
    const verificationResponse = await handlePreLookupWebhookVerification(
      request.method,
      body as Record<string, unknown> | undefined,
      requestId,
      path
    )
    if (verificationResponse) {
      return verificationResponse
    }

    logger.warn(`[${requestId}] Webhook or workflow not found for path: ${path}`)
    return notDeliverableResponse(request.method)
  }

  // Process each webhook matched on this path
  const responses: NextResponse[] = []
  const failures: NextResponse[] = []

  for (const { webhook: foundWebhook, workflow: foundWorkflow } of webhooksForPath) {
    const provider = foundWebhook.provider
    if (!provider) {
      const missingProviderResponse = NextResponse.json(
        { error: 'Webhook provider is missing' },
        { status: 500 }
      )
      if (webhooksForPath.length > 1) {
        logger.error(
          `[${requestId}] Webhook ${foundWebhook.id} has no provider, continuing to next`
        )
        continue
      }
      return missingProviderResponse
    }

    const authError = await verifyProviderAuth(
      foundWebhook,
      foundWorkflow,
      request,
      rawBody,
      requestId
    )
    if (authError) {
      if (webhooksForPath.length > 1) {
        logger.warn(`[${requestId}] Auth failed for webhook ${foundWebhook.id}, continuing to next`)
        continue
      }
      return authError
    }

    const reachabilityResponse = handleProviderReachabilityTest({ provider }, body, requestId)
    if (reachabilityResponse) {
      return reachabilityResponse
    }

    const dispatchResult = await dispatchResolvedWebhookTarget(
      foundWebhook,
      foundWorkflow,
      body,
      request,
      {
        requestId,
        path,
        receivedAt,
        triggerTimestampMs: Number.isFinite(triggerTimestampMs) ? triggerTimestampMs : undefined,
      }
    )

    if (dispatchResult.reason === 'filtered') {
      continue
    }

    if (dispatchResult.outcome === 'failed' || dispatchResult.reason === 'block-missing') {
      if (webhooksForPath.length > 1) {
        logger.warn(
          `[${requestId}] Webhook dispatch failed for ${foundWebhook.id}, continuing to next`,
          { reason: dispatchResult.reason, status: dispatchResult.response.status }
        )
        failures.push(dispatchResult.response)
        continue
      }
      return dispatchResult.response
    }

    responses.push(dispatchResult.response)
  }

  if (responses.length === 0) {
    if (failures.length > 0) {
      return failures[0]
    }
    return new NextResponse('No webhooks processed successfully', { status: 500 })
  }

  if (responses.length === 1) {
    return responses[0]
  }

  // For multiple webhooks, return success if at least one succeeded
  logger.info(`[${requestId}] Processed ${responses.length} webhooks for path: ${path}`)
  return NextResponse.json({
    success: true,
    webhooksProcessed: responses.length,
  })
}
