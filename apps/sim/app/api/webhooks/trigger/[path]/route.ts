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
export const maxDuration = 300
export const runtime = 'nodejs'

/**
 * Webhook Verification Handler (GET)
 *
 * Handles verification requests from webhook providers and confirms endpoint exists.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string }> }) {
  const requestId = generateRequestId()
  const path = (await params).path

  try {
    const challengeResponse = await handleProviderChallenges({}, request, requestId, path)
    if (challengeResponse) {
      return challengeResponse
    }

    const result = await findWebhookAndWorkflow({ requestId, path })
    if (!result) {
      logger.warn(`[${requestId}] No active webhook found for path: ${path}`)
      return new NextResponse('Webhook not found', { status: 404 })
    }

    logger.info(`[${requestId}] Webhook verification successful for path: ${path}`)
    return new NextResponse('OK', { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Error processing webhook verification`, error)
    return new NextResponse(`Internal Server Error: ${error.message}`, {
      status: 500,
    })
  }
}

/**
 * Webhook Payload Handler (POST)
 *
 * Processes incoming webhook payloads from all supported providers.
 * Fast acknowledgment with async processing for most providers except Airtable.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string }> }
) {
  const requestId = generateRequestId()
  const path = (await params).path
  logger.info(`[${requestId}] Processing webhook request for path: ${path}`)

  const parseResult = await parseWebhookBody(request, requestId)
  if (parseResult instanceof NextResponse) {
    return parseResult
  }

  const { body, rawBody } = parseResult

  const challengeResponse = await handleProviderChallenges(body, request, requestId, path)
  if (challengeResponse) {
    return challengeResponse
  }

  const result = await findWebhookAndWorkflow({ requestId, path })
  if (!result) {
    logger.warn(`[${requestId}] No active webhook found for path: ${path}`)
    return new NextResponse('Webhook not found', { status: 404 })
  }

  const { webhook: foundWebhook, workflow: foundWorkflow } = result

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
