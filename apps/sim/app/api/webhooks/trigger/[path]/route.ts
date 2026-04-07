import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import { DispatchQueueFullError } from '@/lib/core/workspace-dispatch'
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

const logger = createLogger('WebhookTriggerAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string }> }) {
  const requestId = generateRequestId()
  const { path } = await params

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string }> }
) {
  const ticket = tryAdmit()
  if (!ticket) {
    return admissionRejectedResponse()
  }

  try {
    return await handleWebhookPost(request, params)
  } finally {
    ticket.release()
  }
}

async function handleWebhookPost(
  request: NextRequest,
  params: Promise<{ path: string }>
): Promise<NextResponse> {
  const requestId = generateRequestId()
  const { path } = await params

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

  // Find all webhooks for this path (supports credential set fan-out where multiple webhooks share a path)
  const webhooksForPath = await findAllWebhooksForPath({ requestId, path })

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

  // Process each webhook
  // For credential sets with shared paths, each webhook represents a different credential
  const responses: NextResponse[] = []

  for (const { webhook: foundWebhook, workflow: foundWorkflow } of webhooksForPath) {
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

    try {
      const response = await queueWebhookExecution(foundWebhook, foundWorkflow, body, request, {
        requestId,
        path,
        actorUserId: preprocessResult.actorUserId,
        executionId: preprocessResult.executionId,
        correlation: preprocessResult.correlation,
      })
      responses.push(response)
    } catch (error) {
      if (error instanceof DispatchQueueFullError) {
        return NextResponse.json(
          {
            error: 'Service temporarily at capacity',
            message: error.message,
            retryAfterSeconds: 10,
          },
          { status: 503, headers: { 'Retry-After': '10' } }
        )
      }
      throw error
    }
  }

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
