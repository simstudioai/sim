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
  type WebhookDispatchResult,
} from '@/lib/webhooks/processor'
import { acceptsPathWebhookDelivery } from '@/lib/webhooks/providers'
import {
  dispatchSlackCustomBotCredential,
  getLegacySlackCustomBotCredentialId,
  verifySlackCustomBotCredentialRequest,
} from '@/lib/webhooks/slack-custom-ingress'

const logger = createLogger('WebhookTriggerAPI')
const MAX_LEGACY_SLACK_CREDENTIALS_PER_PATH = 25

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

    return (
      (await handlePreLookupWebhookVerification(request.method, undefined, requestId, path)) ||
      new NextResponse('Method not allowed', { status: 405 })
    )
  }
)

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ path: string }> }) => {
    const ticket = tryAdmit()
    if (!ticket) {
      return admissionRejectedResponse()
    }

    try {
      return await handleWebhookPost(request, context)
    } finally {
      ticket.release()
    }
  }
)

async function handleWebhookPost(
  request: NextRequest,
  context: { params: Promise<{ path: string }> }
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
  const parsed = await parseRequest(webhookTriggerPostContract, request, context)
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

  const webhooksForPath = allWebhooksForPath.filter(({ webhook: foundWebhook }) =>
    acceptsPathWebhookDelivery(foundWebhook.provider)
  )

  if (allWebhooksForPath.length > 0 && webhooksForPath.length === 0) {
    logger.warn(`[${requestId}] Rejected HTTP delivery to non-path trigger: ${path}`)
    return new NextResponse('Not Found', { status: 404 })
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
    return new NextResponse('Not Found', { status: 404 })
  }

  const legacySlackCredentialIds = new Set<string>()
  const directWebhooksForPath = webhooksForPath.filter(({ webhook: foundWebhook }) => {
    const credentialId = getLegacySlackCustomBotCredentialId(foundWebhook)
    if (!credentialId) return true
    legacySlackCredentialIds.add(credentialId)
    return false
  })
  if (legacySlackCredentialIds.size > MAX_LEGACY_SLACK_CREDENTIALS_PER_PATH) {
    throw new Error(
      `Webhook path resolves more than ${MAX_LEGACY_SLACK_CREDENTIALS_PER_PATH} legacy Slack credentials`
    )
  }

  let authenticatedLegacySlackAlias = false
  let firstLegacySlackAuthError: NextResponse | null = null
  const legacySlackDispatchResults: WebhookDispatchResult[] = []
  for (const credentialId of legacySlackCredentialIds) {
    const authError = await verifySlackCustomBotCredentialRequest({
      credentialId,
      request,
      rawBody,
      requestId,
    })
    if (authError) {
      firstLegacySlackAuthError ??= authError
      continue
    }

    const dispatchResults = await dispatchSlackCustomBotCredential({
      credentialId,
      body,
      request,
      requestId,
      receivedAt,
    })
    authenticatedLegacySlackAlias = true
    legacySlackDispatchResults.push(...dispatchResults)
  }

  if (
    legacySlackCredentialIds.size > 0 &&
    !authenticatedLegacySlackAlias &&
    directWebhooksForPath.length === 0
  ) {
    return (
      firstLegacySlackAuthError ??
      new NextResponse('Unauthorized - Invalid Slack signature', { status: 401 })
    )
  }

  /**
   * Process each unmarked webhook matched on this path. Marked Slack rows were
   * already included in the routing-key fan-out and must not run twice.
   */
  const responses: NextResponse[] = []
  const failures: NextResponse[] = []
  for (const dispatchResult of legacySlackDispatchResults) {
    if (dispatchResult.outcome === 'failed' || dispatchResult.reason === 'block-missing') {
      failures.push(dispatchResult.response)
      continue
    }
    responses.push(dispatchResult.response)
  }
  const dispatchTargetCount = directWebhooksForPath.length + legacySlackDispatchResults.length

  for (const { webhook: foundWebhook, workflow: foundWorkflow } of directWebhooksForPath) {
    const provider = foundWebhook.provider
    if (!provider) {
      const missingProviderResponse = NextResponse.json(
        { error: 'Webhook provider is missing' },
        { status: 500 }
      )
      if (dispatchTargetCount > 1) {
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
      if (dispatchTargetCount > 1) {
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
      if (dispatchTargetCount > 1) {
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
