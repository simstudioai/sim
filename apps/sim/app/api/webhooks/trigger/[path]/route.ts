import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { generateRequestId } from '@/lib/utils'
import {
  checkRateLimits,
  checkUsageLimits,
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

  const authError = await verifyProviderAuth(foundWebhook, request, rawBody, requestId)
  if (authError) {
    return authError
  }

  const rateLimitError = await checkRateLimits(foundWorkflow, foundWebhook, requestId)
  if (rateLimitError) {
    return rateLimitError
  }

  const usageLimitError = await checkUsageLimits(foundWorkflow, foundWebhook, requestId, false)
  if (usageLimitError) {
    return usageLimitError
  }

  if (foundWebhook.blockId) {
    const blockExists = await blockExistsInDeployment(foundWorkflow.id, foundWebhook.blockId)
    if (!blockExists) {
      logger.warn(
        `[${requestId}] Trigger block ${foundWebhook.blockId} not found in deployment for workflow ${foundWorkflow.id}`
      )

      const executionId = uuidv4()
      const loggingSession = new LoggingSession(foundWorkflow.id, executionId, 'webhook', requestId)

      const actorUserId = foundWorkflow.workspaceId
        ? (await import('@/lib/workspaces/utils')).getWorkspaceBilledAccountUserId(
            foundWorkflow.workspaceId
          ) || foundWorkflow.userId
        : foundWorkflow.userId

      await loggingSession.safeStart({
        userId: actorUserId,
        workspaceId: foundWorkflow.workspaceId || '',
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message: `Trigger block not deployed. The webhook trigger (block ${foundWebhook.blockId}) is not present in the deployed workflow. Please redeploy the workflow.`,
          stackTrace: undefined,
        },
        traceSpans: [],
      })

      return new NextResponse('Trigger block not deployed', { status: 404 })
    }
  }

  return queueWebhookExecution(foundWebhook, foundWorkflow, body, request, {
    requestId,
    path,
    testMode: false,
    executionTarget: 'deployed',
  })
}
