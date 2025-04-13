import { NextRequest, NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { webhook, workflow } from '@/db/schema'
import { 
  handleWhatsAppVerification,
  handleSlackChallenge,
  processWhatsAppDeduplication,
  processGenericDeduplication,
  processWebhook,
  fetchAndProcessAirtablePayloads
} from '@/lib/webhooks/utils'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { acquireLock, hasProcessedMessage, markMessageAsProcessed } from '@/lib/redis'

// Set dynamic rendering and maximum duration for long-running webhook triggers
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes

const logger = createLogger('WebhookTriggerAPI')

/**
 * GET handler for webhook verification.
 *
 * This handles provider-specific challenges (e.g. WhatsApp, Slack) as well as generic endpoint checks.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  try {
    const { path } = await params
    const url = new URL(request.url)

    // --- WhatsApp Verification ---
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    const whatsAppResponse = await handleWhatsAppVerification(requestId, path, mode, token, challenge)
    if (whatsAppResponse) {
      return whatsAppResponse
    }

    // --- General Verification ---
    logger.debug(`[${requestId}] Looking for webhook with path: ${path}`)

    // Query the database for an active webhook matching the provided path
    const webhooks = await db
      .select({ webhook })
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
    return new NextResponse(`Internal Server Error: ${error.message}`, { status: 500 })
  }
}

/**
 * POST handler for processing incoming webhook payloads.
 *
 * This function handles:
 *  - Parsing and validation of the incoming request
 *  - Provider-specific deduplication (e.g. Slack and WhatsApp)
 *  - Immediate fast response via a timeout while processing continues in the background
 *  - Looking up the webhook & workflow in the database
 *  - For Airtable webhooks:
 *      • Augmenting the logic by ensuring that an Airtable subscription is set up
 *      • Deduplicating notifications (if a notificationId is provided)
 *      • Starting asynchronous payload fetching via polling
 *  - For other providers, executing the workflow as usual.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string }> }
): Promise<NextResponse> {
  const requestId = crypto.randomUUID().slice(0, 8)
  let foundWorkflow: any = null
  let foundWebhook: any = null

  // --- PHASE 1: Request validation and parsing ---
  let rawBody: string | null = null
  try {
    const requestClone = request.clone()
    rawBody = await requestClone.text()
    logger.debug(`[${requestId}] Captured raw request body, length: ${rawBody.length}`)
    if (!rawBody || rawBody.length === 0) {
      logger.warn(`[${requestId}] Rejecting request with empty body`)
      return new NextResponse('Empty request body', { status: 400 })
    }
  } catch (bodyError) {
    logger.error(`[${requestId}] Failed to read request body`, { error: bodyError instanceof Error ? bodyError.message : String(bodyError) })
    return new NextResponse('Failed to read request body', { status: 400 })
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
    if (Object.keys(body).length === 0) {
      logger.warn(`[${requestId}] Rejecting empty JSON object`)
      return new NextResponse('Empty JSON payload', { status: 400 })
    }
  } catch (parseError) {
    logger.error(`[${requestId}] Failed to parse JSON body`, { error: parseError instanceof Error ? parseError.message : String(parseError) })
    return new NextResponse('Invalid JSON payload', { status: 400 })
  }

  // --- PHASE 2: Early Slack deduplication ---
  const messageId = body?.event_id
  const slackRetryNum = request.headers.get('x-slack-retry-num')
  const slackRetryReason = request.headers.get('x-slack-retry-reason')

  if (body?.type === 'event_callback') {
    logger.debug(
      `[${requestId}] Slack event received with event_id: ${messageId || 'missing'}, retry: ${slackRetryNum || 'none'}`
    )
    const dedupeKey = messageId
      ? `slack:msg:${messageId}`
      : `slack:${body?.team_id || ''}:${body?.event?.ts || body?.event?.event_ts || Date.now()}`

    try {
      const isDuplicate = await hasProcessedMessage(dedupeKey)
      if (isDuplicate) {
        logger.info(`[${requestId}] Duplicate Slack message detected: ${dedupeKey}, retry: ${slackRetryNum || 'none'}`)
        return new NextResponse('Duplicate message', { status: 200 })
      }
      await markMessageAsProcessed(dedupeKey, 60 * 60 * 24) // 24 hour TTL
      logger.debug(`[${requestId}] Marked Slack message as processed with key: ${dedupeKey}`)
      if (slackRetryNum) {
        logger.info(`[${requestId}] Processing Slack retry #${slackRetryNum} for message, reason: ${slackRetryReason || 'unknown'}`)
      }
    } catch (error) {
      logger.error(`[${requestId}] Error in Slack deduplication`, error)
    }
  }

  // --- PHASE 3: Fast response timeout and distributed lock ---
  const timeoutPromise = new Promise<NextResponse>((resolve) => {
    setTimeout(() => {
      logger.warn(`[${requestId}] Request processing timeout, sending acknowledgment`)
      resolve(new NextResponse('Request received', { status: 200 }))
    }, 2500) // 2.5 second timeout
  })

  let hasExecutionLock = false
  // Build a provider-specific lock key
  let executionLockKey: string
  if (body?.type === 'event_callback') {
    executionLockKey = messageId
      ? `execution:lock:slack:${messageId}`
      : `execution:lock:slack:${body?.team_id || ''}:${body?.event?.ts || body?.event?.event_ts || Date.now()}`
  } else {
    executionLockKey = `execution:lock:${requestId}:${crypto.randomUUID()}`
  }
  
  try {
    hasExecutionLock = await acquireLock(executionLockKey, requestId, 30) // 30 second TTL
    logger.debug(`[${requestId}] Execution lock acquisition ${hasExecutionLock ? 'successful' : 'failed'} for key: ${executionLockKey}`)
  } catch (lockError) {
    logger.error(`[${requestId}] Error acquiring execution lock`, lockError)
  }

  // --- PHASE 4: Main processing logic ---
  const processingPromise = (async () => {
    try {
      const { path } = await params
      logger.info(`[${requestId}] Processing webhook request for path: ${path}`)

      // Handle Slack URL verification challenge (fast path)
      const slackChallengeResponse = handleSlackChallenge(body)
      if (slackChallengeResponse) {
        logger.info(`[${requestId}] Responding to Slack URL verification challenge`)
        return slackChallengeResponse
      }

      // If another instance is processing this request, skip duplicate processing.
      if (!hasExecutionLock) {
        logger.info(`[${requestId}] Skipping execution as lock was not acquired. Another instance is processing this request.`)
        return new NextResponse('Request is being processed by another instance', { status: 200 })
      }

      // --- PHASE 5: Look up the webhook & workflow ---
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

      // --- Augment Airtable logic: Ensure subscription exists ---
      if (foundWebhook.provider === 'airtable') {
        const providerConfig = foundWebhook.providerConfig || {}
        if (!providerConfig.externalId) {
          logger.info(`[${requestId}] Missing externalId for Airtable webhook ${foundWebhook.id}. Attempting to create subscription...`)
          await createAirtableWebhookSubscription(request, foundWorkflow.userId, foundWebhook, requestId)
          // Optionally refresh the webhook record after subscription creation
          const refreshed = await db
            .select({ webhook })
            .from(webhook)
            .where(eq(webhook.id, foundWebhook.id))
            .limit(1)
          if (refreshed.length > 0) {
            foundWebhook = refreshed[0].webhook
          }
        }
      }

      // --- Provider-specific processing ---
      // Airtable Processing (Polling-based)
      if (foundWebhook.provider === 'airtable') {
        logger.info(`[${requestId}] Airtable webhook ping received for webhook: ${foundWebhook.id}`)

        // Airtable deduplication using notification ID
        const notificationId = body.notificationId || null
        if (notificationId) {
          try {
            const processedKey = `airtable-webhook-${foundWebhook.id}-${notificationId}`
            const alreadyProcessed = await db
              .select({ id: webhook.id })
              .from(webhook)
              .where(
                and(
                  eq(webhook.id, foundWebhook.id),
                  sql`(webhook.provider_config->>'processedNotifications')::jsonb ? ${processedKey}`
                )
              )
              .limit(1)
            if (alreadyProcessed.length > 0) {
              logger.info(`[${requestId}] Duplicate Airtable notification detected: ${notificationId}`, { webhookId: foundWebhook.id })
              return new NextResponse('Notification already processed', { status: 200 })
            }
            // Append notification key to provider config (capping history to last 100 notifications)
            const providerConfig = foundWebhook.providerConfig || {}
            const processedNotifications = providerConfig.processedNotifications || []
            processedNotifications.push(processedKey)
            const limitedNotifications = processedNotifications.slice(-100)
            await db
              .update(webhook)
              .set({
                providerConfig: { ...providerConfig, processedNotifications: limitedNotifications },
                updatedAt: new Date(),
              })
              .where(eq(webhook.id, foundWebhook.id))
          } catch (error) {
            logger.warn(`[${requestId}] Airtable deduplication check failed, continuing with processing`, {
              error: error instanceof Error ? error.message : String(error),
              webhookId: foundWebhook.id,
            })
          }
        }

        // Start asynchronous Airtable payload processing in the background
        logger.info(`[${requestId}] Starting Airtable payload processing...`, {
          webhookId: foundWebhook.id,
          workflowId: foundWorkflow.id,
        })
        fetchAndProcessAirtablePayloads(foundWebhook, foundWorkflow, requestId).catch((err: any) => {
          logger.error(`[${requestId}] Error during Airtable processing`, {
            webhookId: foundWebhook.id,
            error: err.message,
            stack: err.stack,
          })
        })

        // Immediately return acknowledgment without waiting for background processing
        return new NextResponse('Airtable ping acknowledged, processing started', { status: 200 })
      }

      // --- WhatsApp & other providers ---
      const executionId = uuidv4()
      if (foundWebhook.provider === 'whatsapp') {
        const data = body?.entry?.[0]?.changes?.[0]?.value
        const messages = data?.messages || []
        const whatsappDuplicateResponse = await processWhatsAppDeduplication(requestId, messages)
        if (whatsappDuplicateResponse) {
          return whatsappDuplicateResponse
        }
      } else if (foundWebhook.provider !== 'slack') {
        const genericDuplicateResponse = await processGenericDeduplication(requestId, path, body)
        if (genericDuplicateResponse) {
          return genericDuplicateResponse
        }
      }

      // --- Execute the workflow for the webhook event ---
      logger.info(`[${requestId}] Executing workflow for ${foundWebhook.provider} webhook`)
      return await processWebhook(foundWebhook, foundWorkflow, body, request, executionId, requestId)
    } catch (error: any) {
      logger.error(`[${requestId}] Error processing webhook:`, error)
      return new NextResponse(`Internal server error: ${error.message}`, { status: 500 })
    }
  })()

  // Race processingPromise against the fast timeout response.
  return Promise.race([timeoutPromise, processingPromise])
}

/**
 * Helper function to create a subscription with Airtable.
 *
 * This logic is taken from the legacy route and attempts to register the webhook with Airtable.
 * On success, it stores the externalId (Airtable webhook ID) in the provider configuration.
 *
 * @param request The original NextRequest.
 * @param userId The user ID associated with the workflow.
 * @param webhookData The webhook record from the database.
 * @param requestId A short unique request ID for logging.
 */
async function createAirtableWebhookSubscription(
  request: NextRequest,
  userId: string,
  webhookData: any,
  requestId: string
) {
  try {
    const { path, providerConfig } = webhookData
    const { baseId, tableId, includeCellValuesInFieldIds } = providerConfig || {}

    if (!baseId || !tableId) {
      logger.warn(`[${requestId}] Missing baseId or tableId for Airtable webhook creation.`, {
        webhookId: webhookData.id,
      })
      return // Cannot proceed without essential IDs
    }

    const accessToken = await getOAuthToken(userId, 'airtable')
    if (!accessToken) {
      logger.warn(`[${requestId}] Could not retrieve Airtable access token for user ${userId}. Cannot create webhook in Airtable.`)
      return
    }

    const requestOrigin = new URL(request.url).origin
    // Remap localhost origins if necessary
    const effectiveOrigin = requestOrigin.includes('localhost')
      ? process.env.NEXT_PUBLIC_APP_URL || requestOrigin
      : requestOrigin

    const notificationUrl = `${effectiveOrigin}/api/webhooks/trigger/${path}`
    if (effectiveOrigin !== requestOrigin) {
      logger.debug(`[${requestId}] Remapped localhost origin to ${effectiveOrigin} for notificationUrl`)
    }

    const airtableApiUrl = `https://api.airtable.com/v0/bases/${baseId}/webhooks`

    const specification: any = {
      options: {
        filters: {
          dataTypes: ['tableData'],
          recordChangeScope: tableId,
        },
      },
    }

    if (includeCellValuesInFieldIds === 'all') {
      specification.options.includes = {
        includeCellValuesInFieldIds: 'all',
      }
    }

    const requestBody: any = {
      notificationUrl,
      specification,
    }

    const airtableResponse = await fetch(airtableApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const responseBody = await airtableResponse.json()

    if (!airtableResponse.ok || responseBody.error) {
      const errorMessage =
        responseBody.error?.message || responseBody.error || 'Unknown Airtable API error'
      const errorType = responseBody.error?.type
      logger.error(
        `[${requestId}] Failed to create webhook in Airtable for webhook ${webhookData.id}. Status: ${airtableResponse.status}`,
        { type: errorType, message: errorMessage, response: responseBody }
      )
    } else {
      logger.info(
        `[${requestId}] Successfully created webhook in Airtable for webhook ${webhookData.id}.`,
        { airtableWebhookId: responseBody.id }
      )
      // Store the externalId in the provider configuration
      try {
        const currentConfig = (webhookData.providerConfig as Record<string, any>) || {}
        const updatedConfig = { ...currentConfig, externalId: responseBody.id }
        await db
          .update(webhook)
          .set({ providerConfig: updatedConfig, updatedAt: new Date() })
          .where(eq(webhook.id, webhookData.id))
      } catch (dbError: any) {
        logger.error(
          `[${requestId}] Failed to store externalId in providerConfig for webhook ${webhookData.id}.`,
          dbError
        )
      }
    }
  } catch (error: any) {
    logger.error(
      `[${requestId}] Exception during Airtable webhook creation for webhook ${webhookData.id}.`,
      { message: error.message, stack: error.stack }
    )
  }
}
