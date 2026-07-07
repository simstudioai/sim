import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { webhookTriggerGetContract, webhookTriggerPostContract } from '@/lib/api/contracts/webhooks'
import { parseRequest } from '@/lib/api/server'
import {
  API_EXECUTION_REQUIRES_PAID_PLAN_MESSAGE,
  isWorkspaceApiExecutionEntitled,
} from '@/lib/billing/core/api-access'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  checkWebhookPreprocessing,
  findAllWebhooksForPath,
  handlePreDeploymentVerification,
  handlePreLookupWebhookVerification,
  handleProviderChallenges,
  handleProviderReachabilityTest,
  parseWebhookBody,
  queueWebhookExecution,
  shouldSkipWebhookEvent,
  verifyProviderAuth,
} from '@/lib/webhooks/processor'
import { blockExistsInDeployment } from '@/lib/workflows/persistence/utils'
import { isInternalTriggerProvider } from '@/triggers/constants'

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

  // Internal trigger providers (sim, table) are fired in-process, never over
  // HTTP. Their rows still register a path, so reject deliveries here to keep
  // forged events out.
  const webhooksForPath = allWebhooksForPath.filter(
    ({ webhook: foundWebhook }) => !isInternalTriggerProvider(foundWebhook.provider)
  )

  if (allWebhooksForPath.length > 0 && webhooksForPath.length === 0) {
    logger.warn(`[${requestId}] Rejected HTTP delivery to internal trigger path: ${path}`)
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

  // Process each webhook matched on this path
  const responses: NextResponse[] = []
  let billingBlocked = false

  for (const { webhook: foundWebhook, workflow: foundWorkflow } of webhooksForPath) {
    // Generic ("custom") webhooks are an unauthenticated programmatic execution
    // surface, so they fall under the same paid-plan gate as the API. Provider
    // webhooks (slack, github, ...) are unaffected.
    if (
      foundWebhook.provider === 'generic' &&
      !(await isWorkspaceApiExecutionEntitled(foundWorkflow.workspaceId))
    ) {
      logger.warn(`[${requestId}] Generic webhook blocked: workspace on free plan`)
      billingBlocked = true
      if (webhooksForPath.length > 1) continue
      return NextResponse.json({ error: API_EXECUTION_REQUIRES_PAID_PLAN_MESSAGE }, { status: 402 })
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

    const reachabilityResponse = handleProviderReachabilityTest(foundWebhook, body, requestId)
    if (reachabilityResponse) {
      return reachabilityResponse
    }

    const preprocessResult = await checkWebhookPreprocessing(foundWorkflow, foundWebhook, requestId)
    if (preprocessResult.error) {
      if (webhooksForPath.length > 1) {
        logger.warn(
          `[${requestId}] Preprocessing failed for webhook ${foundWebhook.id}, continuing to next`
        )
        continue
      }
      return preprocessResult.error
    }

    if (foundWebhook.blockId) {
      const blockExists = await blockExistsInDeployment(foundWorkflow.id, foundWebhook.blockId)
      if (!blockExists) {
        const preDeploymentResponse = handlePreDeploymentVerification(foundWebhook, requestId)
        if (preDeploymentResponse) {
          return preDeploymentResponse
        }

        logger.info(
          `[${requestId}] Trigger block ${foundWebhook.blockId} not found in deployment for workflow ${foundWorkflow.id}`
        )
        if (webhooksForPath.length > 1) {
          continue
        }
        return new NextResponse('Trigger block not found in deployment', { status: 404 })
      }
    }

    if (shouldSkipWebhookEvent(foundWebhook, body, requestId)) {
      continue
    }
    const response = await queueWebhookExecution(foundWebhook, foundWorkflow, body, request, {
      requestId,
      path,
      actorUserId: preprocessResult.actorUserId,
      executionId: preprocessResult.executionId,
      correlation: preprocessResult.correlation,
      receivedAt,
      triggerTimestampMs: Number.isFinite(triggerTimestampMs) ? triggerTimestampMs : undefined,
    })
    responses.push(response)
  }

  if (responses.length === 0) {
    if (billingBlocked) {
      return NextResponse.json({ error: API_EXECUTION_REQUIRES_PAID_PLAN_MESSAGE }, { status: 402 })
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
