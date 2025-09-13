import { tasks } from '@trigger.dev/sdk'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { env, isTruthy } from '@/lib/env'
import { IdempotencyService, webhookIdempotency } from '@/lib/idempotency/service'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  handleSlackChallenge,
  handleWhatsAppVerification,
  validateMicrosoftTeamsSignature,
} from '@/lib/webhooks/utils'
import { executeWebhookJob } from '@/background/webhook-execution'
import { db } from '@/db'
import { webhook, workflow } from '@/db/schema'
import { RateLimiter } from '@/services/queue'

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

  try {
    const path = (await params).path
    const url = new URL(request.url)

    // Handle WhatsApp specific verification challenge
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    const whatsAppResponse = await handleWhatsAppVerification(
      requestId,
      path,
      mode,
      token,
      challenge
    )
    if (whatsAppResponse) {
      return whatsAppResponse
    }

    // Verify webhook exists in database
    const webhooks = await db
      .select({
        webhook: webhook,
      })
      .from(webhook)
      .where(and(eq(webhook.path, path), eq(webhook.isActive, true)))
      .limit(1)

    if (webhooks.length === 0) {
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
  let foundWorkflow: any = null
  let foundWebhook: any = null

  // --- PHASE 1: Request validation and parsing ---
  let rawBody: string | null = null
  try {
    const requestClone = request.clone()
    rawBody = await requestClone.text()

    if (!rawBody || rawBody.length === 0) {
      logger.warn(`[${requestId}] Rejecting request with empty body`)
      return new NextResponse('Empty request body', { status: 400 })
    }
  } catch (bodyError) {
    logger.error(`[${requestId}] Failed to read request body`, {
      error: bodyError instanceof Error ? bodyError.message : String(bodyError),
    })
    return new NextResponse('Failed to read request body', { status: 400 })
  }

  // Parse the body - handle both JSON and form-encoded payloads
  let body: any
  try {
    // Check content type to handle both JSON and form-encoded payloads
    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('application/x-www-form-urlencoded')) {
      // GitHub sends form-encoded data with JSON in the 'payload' field
      const formData = new URLSearchParams(rawBody)
      const payloadString = formData.get('payload')

      if (!payloadString) {
        logger.warn(`[${requestId}] No payload field found in form-encoded data`)
        return new NextResponse('Missing payload field', { status: 400 })
      }

      body = JSON.parse(payloadString)
      logger.debug(`[${requestId}] Parsed form-encoded GitHub webhook payload`)
    } else {
      // Default to JSON parsing
      body = JSON.parse(rawBody)
      logger.debug(`[${requestId}] Parsed JSON webhook payload`)
    }

    if (Object.keys(body).length === 0) {
      logger.warn(`[${requestId}] Rejecting empty JSON object`)
      return new NextResponse('Empty JSON payload', { status: 400 })
    }
  } catch (parseError) {
    logger.error(`[${requestId}] Failed to parse webhook body`, {
      error: parseError instanceof Error ? parseError.message : String(parseError),
      contentType: request.headers.get('content-type'),
      bodyPreview: `${rawBody?.slice(0, 100)}...`,
    })
    return new NextResponse('Invalid payload format', { status: 400 })
  }

  // Handle Slack challenge
  const slackResponse = handleSlackChallenge(body)
  if (slackResponse) {
    return slackResponse
  }

  // --- PHASE 2: Webhook identification ---
  const path = (await params).path
  logger.info(`[${requestId}] Processing webhook request for path: ${path}`)

  // Find webhook and associated workflow
  const webhooks = await db
    .select({
      webhook: webhook,
      workflow: workflow,
    })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .where(and(eq(webhook.path, path), eq(webhook.isActive, true)))
    .limit(1)

  if (webhooks.length === 0) {
    logger.warn(`[${requestId}] No active webhook found for path: ${path}`)
    return new NextResponse('Webhook not found', { status: 404 })
  }

  foundWebhook = webhooks[0].webhook
  foundWorkflow = webhooks[0].workflow

  // Handle Microsoft Teams signature verification if needed
  if (foundWebhook.provider === 'microsoftteams') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    if (providerConfig.hmacSecret) {
      const authHeader = request.headers.get('authorization')

      if (!authHeader || !authHeader.startsWith('HMAC ')) {
        logger.warn(
          `[${requestId}] Microsoft Teams outgoing webhook missing HMAC authorization header`
        )
        return new NextResponse('Unauthorized - Missing HMAC signature', { status: 401 })
      }

      const isValidSignature = validateMicrosoftTeamsSignature(
        providerConfig.hmacSecret,
        authHeader,
        rawBody
      )

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Microsoft Teams HMAC signature verification failed`)
        return new NextResponse('Unauthorized - Invalid HMAC signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Microsoft Teams HMAC signature verified successfully`)
    }
  }

  // Handle generic webhook authentication if enabled
  if (foundWebhook.provider === 'generic') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    if (providerConfig.requireAuth) {
      const configToken = providerConfig.token
      const secretHeaderName = providerConfig.secretHeaderName

      // --- Token Validation ---
      if (configToken) {
        let isTokenValid = false

        if (secretHeaderName) {
          // Check custom header (headers are case-insensitive)
          const headerValue = request.headers.get(secretHeaderName.toLowerCase())
          if (headerValue === configToken) {
            isTokenValid = true
          }
        } else {
          // Check standard Authorization header (case-insensitive Bearer keyword)
          const authHeader = request.headers.get('authorization')

          // Case-insensitive comparison for "Bearer" keyword
          if (authHeader?.toLowerCase().startsWith('bearer ')) {
            const token = authHeader.substring(7) // Remove "Bearer " (7 characters)
            if (token === configToken) {
              isTokenValid = true
            }
          }
        }

        if (!isTokenValid) {
          const expectedHeader = secretHeaderName || 'Authorization: Bearer TOKEN'
          logger.warn(
            `[${requestId}] Generic webhook authentication failed. Expected header: ${expectedHeader}`
          )
          return new NextResponse('Unauthorized - Invalid authentication token', { status: 401 })
        }
      } else {
        logger.warn(`[${requestId}] Generic webhook requires auth but no token configured`)
        return new NextResponse('Unauthorized - Authentication required but not configured', {
          status: 401,
        })
      }
    }
  }

  // --- PHASE 3: Rate limiting for webhook execution ---
  try {
    // Get user subscription for rate limiting (checks both personal and org subscriptions)
    const userSubscription = await getHighestPrioritySubscription(foundWorkflow.userId)

    // Check async rate limits (webhooks are processed asynchronously)
    const rateLimiter = new RateLimiter()
    const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
      foundWorkflow.userId,
      userSubscription,
      'webhook',
      true // isAsync = true for webhook execution
    )

    if (!rateLimitCheck.allowed) {
      logger.warn(`[${requestId}] Rate limit exceeded for webhook user ${foundWorkflow.userId}`, {
        provider: foundWebhook.provider,
        remaining: rateLimitCheck.remaining,
        resetAt: rateLimitCheck.resetAt,
      })

      // Return 200 to prevent webhook provider retries, but indicate rate limit
      if (foundWebhook.provider === 'microsoftteams') {
        // Microsoft Teams requires specific response format
        return NextResponse.json({
          type: 'message',
          text: 'Rate limit exceeded. Please try again later.',
        })
      }

      // Simple error response for other providers (return 200 to prevent retries)
      return NextResponse.json({ message: 'Rate limit exceeded' }, { status: 200 })
    }

    logger.debug(`[${requestId}] Rate limit check passed for webhook`, {
      provider: foundWebhook.provider,
      remaining: rateLimitCheck.remaining,
      resetAt: rateLimitCheck.resetAt,
    })
  } catch (rateLimitError) {
    logger.error(`[${requestId}] Error checking webhook rate limits:`, rateLimitError)
    // Continue processing - better to risk rate limit bypass than fail webhook
  }

  // --- PHASE 4: Usage limit check ---
  try {
    const usageCheck = await checkServerSideUsageLimits(foundWorkflow.userId)
    if (usageCheck.isExceeded) {
      logger.warn(
        `[${requestId}] User ${foundWorkflow.userId} has exceeded usage limits. Skipping webhook execution.`,
        {
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
          workflowId: foundWorkflow.id,
          provider: foundWebhook.provider,
        }
      )

      // Return 200 to prevent webhook provider retries, but indicate usage limit exceeded
      if (foundWebhook.provider === 'microsoftteams') {
        // Microsoft Teams requires specific response format
        return NextResponse.json({
          type: 'message',
          text: 'Usage limit exceeded. Please upgrade your plan to continue.',
        })
      }

      // Simple error response for other providers (return 200 to prevent retries)
      return NextResponse.json({ message: 'Usage limit exceeded' }, { status: 200 })
    }

    logger.debug(`[${requestId}] Usage limit check passed for webhook`, {
      provider: foundWebhook.provider,
      currentUsage: usageCheck.currentUsage,
      limit: usageCheck.limit,
    })
  } catch (usageError) {
    logger.error(`[${requestId}] Error checking webhook usage limits:`, usageError)
    // Continue processing - better to risk usage limit bypass than fail webhook
  }

  // --- PHASE 5: Idempotent webhook execution ---
  try {
    const payload = {
      webhookId: foundWebhook.id,
      workflowId: foundWorkflow.id,
      userId: foundWorkflow.userId,
      provider: foundWebhook.provider,
      body,
      headers: Object.fromEntries(request.headers.entries()),
      path,
      blockId: foundWebhook.blockId,
    }

    const idempotencyKey = IdempotencyService.createWebhookIdempotencyKey(
      foundWebhook.id,
      body,
      Object.fromEntries(request.headers.entries())
    )

    const result = await webhookIdempotency.executeWithIdempotency(
      foundWebhook.provider,
      idempotencyKey,
      async () => {
        const useTrigger = isTruthy(env.TRIGGER_DEV_ENABLED)

        if (useTrigger) {
          const handle = await tasks.trigger('webhook-execution', payload)
          logger.info(
            `[${requestId}] Queued webhook execution task ${handle.id} for ${foundWebhook.provider} webhook`
          )
          return {
            method: 'trigger.dev',
            taskId: handle.id,
            status: 'queued',
          }
        }
        // Fire-and-forget direct execution to avoid blocking webhook response
        void executeWebhookJob(payload).catch((error) => {
          logger.error(`[${requestId}] Direct webhook execution failed`, error)
        })
        logger.info(
          `[${requestId}] Queued direct webhook execution for ${foundWebhook.provider} webhook (Trigger.dev disabled)`
        )
        return {
          method: 'direct',
          status: 'queued',
        }
      }
    )

    logger.debug(`[${requestId}] Webhook execution result:`, result)

    // Return immediate acknowledgment with provider-specific format
    if (foundWebhook.provider === 'microsoftteams') {
      // Microsoft Teams requires specific response format
      return NextResponse.json({
        type: 'message',
        text: 'Sim',
      })
    }

    return NextResponse.json({ message: 'Webhook processed' })
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to queue webhook execution:`, error)

    // Still return 200 to prevent webhook provider retries
    if (foundWebhook.provider === 'microsoftteams') {
      // Microsoft Teams requires specific response format
      return NextResponse.json({
        type: 'message',
        text: 'Webhook processing failed',
      })
    }

    return NextResponse.json({ message: 'Internal server error' }, { status: 200 })
  }
}
