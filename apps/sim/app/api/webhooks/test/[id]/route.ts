import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  checkRateLimits,
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

  const rateLimitError = await checkRateLimits(foundWorkflow, foundWebhook, requestId)
  if (rateLimitError) {
    return rateLimitError
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
