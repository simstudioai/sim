import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  checkWebhookPreprocessing,
  findWebhookAndWorkflow,
  handleProviderChallenges,
  parseWebhookBody,
  queueWebhookExecution,
  verifyProviderAuth,
} from '@/lib/webhooks/processor'
import { blockExistsInDeployment } from '@/lib/workflows/db-helpers'

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

  const findResult = await findWebhookAndWorkflow({ requestId, path })

  if (!findResult) {
    logger.warn(`[${requestId}] Webhook or workflow not found for path: ${path}`)

    return new NextResponse('Not Found', { status: 404 })
  }

  const { webhook: foundWebhook, workflow: foundWorkflow } = findResult

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
    return authError
  }

  // Wrap preprocessing in try-catch to handle unexpected exceptions that might prevent
  // proper execution log completion (e.g., programming errors, out-of-memory, etc.)
  let preprocessError: NextResponse | null = null
  try {
    preprocessError = await checkWebhookPreprocessing(
      foundWorkflow,
      foundWebhook,
      requestId,
      false // testMode
    )
    if (preprocessError) {
      return preprocessError
    }
  } catch (error) {
    // Handle unexpected preprocessing failures to ensure proper error response
    logger.error(`[${requestId}] Unexpected error during webhook preprocessing`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      webhookId: foundWebhook.id,
      workflowId: foundWorkflow.id,
    })

    // Return provider-specific error response
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
      logger.info(
        `[${requestId}] Trigger block ${foundWebhook.blockId} not found in deployment for workflow ${foundWorkflow.id}`
      )
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
          `[${requestId}] Stripe event type '${eventType}' not in allowed list, skipping execution`
        )
        return new NextResponse('Event type filtered', { status: 200 })
      }
    }
  }

  return queueWebhookExecution(foundWebhook, foundWorkflow, body, request, {
    requestId,
    path,
    testMode: false,
    executionTarget: 'deployed',
  })
}
