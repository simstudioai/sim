import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  checkWebhookPreprocessing,
  findAllWebhooksForPath,
  handleProviderChallenges,
  handleProviderReachabilityTest,
  parseWebhookBody,
  queueWebhookExecution,
  verifyProviderAuth,
} from '@/lib/webhooks/processor'
import { blockExistsInDeployment } from '@/lib/workflows/persistence/utils'

const logger = createLogger('WebhookTriggerAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string }> }) {
  const requestId = generateRequestId()
  const { path } = await params

  // Handle Microsoft Graph subscription validation
  const url = new URL(request.url)
  const validationToken = url.searchParams.get('validationToken')

  if (validationToken) {
    logger.info(`[${requestId}] Microsoft Graph subscription validation for path: ${path}`)
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  // Handle other GET-based verifications if needed
  const challengeResponse = await handleProviderChallenges({}, request, requestId, path)
  if (challengeResponse) {
    return challengeResponse
  }

  return new NextResponse('Method not allowed', { status: 405 })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string }> }
) {
  const requestId = generateRequestId()
  const { path } = await params

  // Log ALL incoming webhook requests for debugging
  logger.info(`[${requestId}] Incoming webhook request`, {
    path,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
  })

  // Handle Microsoft Graph subscription validation (some environments send POST with validationToken)
  try {
    const url = new URL(request.url)
    const validationToken = url.searchParams.get('validationToken')
    if (validationToken) {
      logger.info(`[${requestId}] Microsoft Graph subscription validation (POST) for path: ${path}`)
      return new NextResponse(validationToken, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }
  } catch {
    // ignore URL parsing errors; proceed to normal handling
  }

  const parseResult = await parseWebhookBody(request, requestId)

  // Check if parseWebhookBody returned an error response
  if (parseResult instanceof NextResponse) {
    return parseResult
  }

  const { body, rawBody } = parseResult

  const challengeResponse = await handleProviderChallenges(body, request, requestId, path)
  if (challengeResponse) {
    return challengeResponse
  }

  // Find all webhooks for this path (supports credential set fan-out where multiple webhooks share a path)
  const webhooksForPath = await findAllWebhooksForPath({ requestId, path })

  if (webhooksForPath.length === 0) {
    logger.warn(`[${requestId}] Webhook or workflow not found for path: ${path}`)
    return new NextResponse('Not Found', { status: 404 })
  }

  // Process each webhook
  // For credential sets with shared paths, each webhook represents a different credential
  const responses: NextResponse[] = []

  for (const { webhook: foundWebhook, workflow: foundWorkflow } of webhooksForPath) {
    // Log HubSpot webhook details for debugging
    if (foundWebhook.provider === 'hubspot') {
      const events = Array.isArray(body) ? body : [body]
      const firstEvent = events[0]

      logger.info(`[${requestId}] HubSpot webhook received`, {
        path,
        subscriptionType: firstEvent?.subscriptionType,
        objectId: firstEvent?.objectId,
        portalId: firstEvent?.portalId,
        webhookId: foundWebhook.id,
        workflowId: foundWorkflow.id,
        triggerId: foundWebhook.providerConfig?.triggerId,
        eventCount: events.length,
      })
    }

    const authError = await verifyProviderAuth(
      foundWebhook,
      foundWorkflow,
      request,
      rawBody,
      requestId
    )
    if (authError) {
      // For multi-webhook, log and continue to next webhook
      if (webhooksForPath.length > 1) {
        logger.warn(`[${requestId}] Auth failed for webhook ${foundWebhook.id}, continuing to next`)
        continue
      }
      return authError
    }

    const reachabilityResponse = handleProviderReachabilityTest(foundWebhook, body, requestId)
    if (reachabilityResponse) {
      // Reachability test should return immediately for the first webhook
      return reachabilityResponse
    }

    let preprocessError: NextResponse | null = null
    try {
      preprocessError = await checkWebhookPreprocessing(foundWorkflow, foundWebhook, requestId)
      if (preprocessError) {
        if (webhooksForPath.length > 1) {
          logger.warn(
            `[${requestId}] Preprocessing failed for webhook ${foundWebhook.id}, continuing to next`
          )
          continue
        }
        return preprocessError
      }
    } catch (error) {
      logger.error(`[${requestId}] Unexpected error during webhook preprocessing`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        webhookId: foundWebhook.id,
        workflowId: foundWorkflow.id,
      })

      if (webhooksForPath.length > 1) {
        continue
      }

      if (foundWebhook.provider === 'microsoft-teams') {
        return NextResponse.json(
          {
            type: 'message',
            text: 'An unexpected error occurred during preprocessing',
          },
          { status: 500 }
        )
      }

      return NextResponse.json(
        { error: 'An unexpected error occurred during preprocessing' },
        { status: 500 }
      )
    }

    if (foundWebhook.blockId) {
      const blockExists = await blockExistsInDeployment(foundWorkflow.id, foundWebhook.blockId)
      if (!blockExists) {
        // For Grain, if block doesn't exist in deployment, treat as verification request
        // Grain validates webhook URLs during creation, and the block may not be deployed yet
        if (foundWebhook.provider === 'grain') {
          logger.info(
            `[${requestId}] Grain webhook verification - block not in deployment, returning 200 OK`
          )
          return NextResponse.json({ status: 'ok', message: 'Webhook endpoint verified' })
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

    if (foundWebhook.provider === 'stripe') {
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const eventTypes = providerConfig.eventTypes

      if (eventTypes && Array.isArray(eventTypes) && eventTypes.length > 0) {
        const eventType = body?.type

        if (eventType && !eventTypes.includes(eventType)) {
          logger.info(
            `[${requestId}] Stripe event type '${eventType}' not in allowed list for webhook ${foundWebhook.id}, skipping`
          )
          continue
        }
      }
    }

    const response = await queueWebhookExecution(foundWebhook, foundWorkflow, body, request, {
      requestId,
      path,
      testMode: false,
      executionTarget: 'deployed',
    })
    responses.push(response)
  }

  // Return the last successful response, or a combined response for multiple webhooks
  if (responses.length === 0) {
    return new NextResponse('No webhooks processed successfully', { status: 500 })
  }

  if (responses.length === 1) {
    return responses[0]
  }

  // For multiple webhooks, return success if at least one succeeded
  logger.info(
    `[${requestId}] Processed ${responses.length} webhooks for path: ${path} (credential set fan-out)`
  )
  return NextResponse.json({
    success: true,
    webhooksProcessed: responses.length,
  })
}
