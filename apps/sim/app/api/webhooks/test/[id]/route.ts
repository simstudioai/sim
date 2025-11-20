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
import { verifyTestWebhookToken } from '@/lib/webhooks/test-tokens'

const logger = createLogger('WebhookTestReceiverAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const webhookId = (await params).id

  logger.info(`[${requestId}] Test webhook request received for webhook ${webhookId}`)

  const parseResult = await parseWebhookBody(request, requestId)
  if (parseResult instanceof NextResponse) {
    return parseResult
  }

  const { body, rawBody } = parseResult

  const challengeResponse = await handleProviderChallenges(body, request, requestId, '')
  if (challengeResponse) {
    return challengeResponse
  }

  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  if (!token) {
    logger.warn(`[${requestId}] Test webhook request missing token`)
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const isValid = await verifyTestWebhookToken(token, webhookId)
  if (!isValid) {
    logger.warn(`[${requestId}] Invalid test webhook token`)
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const result = await findWebhookAndWorkflow({ requestId, webhookId })
  if (!result) {
    logger.warn(`[${requestId}] No active webhook found for id: ${webhookId}`)
    return new NextResponse('Webhook not found', { status: 404 })
  }

  const { webhook: foundWebhook, workflow: foundWorkflow } = result

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
      true // testMode - skips usage limits
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

  logger.info(
    `[${requestId}] Executing TEST webhook for ${foundWebhook.provider} (workflow: ${foundWorkflow.id})`
  )

  return queueWebhookExecution(foundWebhook, foundWorkflow, body, request, {
    requestId,
    path: foundWebhook.path,
    testMode: true,
    executionTarget: 'live',
  })
}
