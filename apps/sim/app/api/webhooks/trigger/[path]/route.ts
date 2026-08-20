import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { webhookTriggerGetContract, webhookTriggerPostContract } from '@/lib/api/contracts/webhooks'
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

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ path: string }> }) => {
    const requestId = generateRequestId()
    const parsed = await parseRequest(webhookTriggerGetContract, request, context)
    if (!parsed.success) return parsed.response
    const { path } = parsed.data.params

    // Handle provider-specific GET verifications (Microsoft Graph, WhatsApp, etc.)
    const challengeResponse = await handleProviderChallenges({}, request, requestId, path)
    if (challengeResponse) {
      return challengeResponse
    }

    const verificationResponse = await handlePreLookupWebhookVerification(
      request.method,
      undefined,
      requestId,
      path
    )
    if (verificationResponse) {
      return verificationResponse
    }

    const ticket = tryAdmit()
    if (!ticket) {
      return admissionRejectedResponse()
    }

    try {
      return await handleWebhookDelivery(request, context, webhookTriggerGetContract)
    } finally {
      ticket.release()
    }
  }
)

const handleBodyDelivery = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ path: string }> }) => {
    const ticket = tryAdmit()
    if (!ticket) {
      return admissionRejectedResponse()
    }

    try {
      return await handleWebhookDelivery(request, context, webhookTriggerPostContract)
    } finally {
      ticket.release()
    }
  }
)

export const POST = handleBodyDelivery

/**
 * Methods a provider must opt into via `extraDeliveryMethods`. A delivery to a path whose
 * triggers have not opted in gets a 405 from `handleWebhookDelivery`.
 */
export const PUT = handleBodyDelivery
export const PATCH = handleBodyDelivery
export const DELETE = handleBodyDelivery

async function handleWebhookDelivery(
  request: NextRequest,
  context: { params: Promise<{ path: string }> },
  contract: typeof webhookTriggerGetContract | typeof webhookTriggerPostContract
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

  const requestId = generateRequestId()
  const parsed = await parseRequest(contract, request, context)
  if (!parsed.success) return parsed.response
  const { path } = parsed.data.params

  const earlyChallenge = await handleProviderChallenges({}, request, requestId, path)
  if (earlyChallenge) {
    return earlyChallenge
  }

  const parseResult = await parseWebhookBody(request, requestId)

  // Check if parseWebhookBody returned an error response
  if (parseResult instanceof NextResponse) {
    return parseResult
  }

  const { body, rawBody } = parseResult

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
    return new NextResponse('Not Found', { status: 404 })
  }

  const webhooksForPath = pathWebhooks.filter(({ webhook: foundWebhook }) =>
    acceptsWebhookDeliveryMethod(foundWebhook.provider, request.method)
  )

  if (pathWebhooks.length > 0 && webhooksForPath.length === 0) {
    logger.warn(
      `[${requestId}] Rejected ${request.method} delivery to path ${path}: no trigger on this path accepts that method`
    )
    return new NextResponse('Method not allowed', { status: 405 })
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
    // Unknown paths keep answering 405 on GET so probes cannot tell an unknown path
    // from one whose trigger only accepts POST.
    return request.method === 'POST'
      ? new NextResponse('Not Found', { status: 404 })
      : new NextResponse('Method not allowed', { status: 405 })
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
