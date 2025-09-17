import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
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

const logger = createLogger('WebhookTriggerAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string }> }
) {
  const requestId = generateRequestId()
  const { path } = await params

  const { body, rawBody } = await parseWebhookBody(request, path, requestId)

  const challengeResponse = await handleProviderChallenges(request, body, requestId)
  if (challengeResponse) {
    return challengeResponse
  }

  const { webhook: foundWebhook, workflow: foundWorkflow } = await findWebhookAndWorkflow(
    path,
    requestId
  )

  if (!foundWebhook || !foundWorkflow) {
    logger.warn(`[${requestId}] Webhook or workflow not found for path: ${path}`)
    return new NextResponse('Not Found', { status: 404 })
  }

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

  return queueWebhookExecution(foundWebhook, foundWorkflow, body, request, {
    requestId,
    path,
    testMode: false,
    executionTarget: 'deployed',
  })
}
