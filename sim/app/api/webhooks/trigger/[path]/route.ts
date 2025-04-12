import { NextRequest, NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { webhook, workflow } from '@/db/schema'
import { acquireLock, hasProcessedMessage, markMessageAsProcessed } from '@/lib/redis'
import { 
  handleWhatsAppVerification,
  handleSlackChallenge,
  processWhatsAppDeduplication,
  processGenericDeduplication,
  processWebhook,
  fetchAndProcessAirtablePayloads
} from '@/lib/webhooks/utils'

const logger = createLogger('WebhookTriggerAPI')

// Ensure dynamic rendering to support real-time webhook processing
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes max execution time for long-running webhooks

/**
 * Webhook Verification Handler (GET)
 * 
 * Handles verification requests from webhook providers:
 * - WhatsApp: Responds to hub.challenge verification
 * - Generic: Confirms webhook endpoint exists and is active
 * 
 * @param request The incoming HTTP request
 * @param params Route parameters containing the webhook path
 * @returns HTTP response appropriate for the verification type
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const path = (await params).path
    const url = new URL(request.url)

    // --- WhatsApp Verification ---
    // Extract WhatsApp challenge parameters
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    // Handle WhatsApp verification if applicable
    const whatsAppResponse = await handleWhatsAppVerification(requestId, path, mode, token, challenge)
    if (whatsAppResponse) {
      return whatsAppResponse
    }

    // --- General Webhook Verification ---
    logger.debug(`[${requestId}] Looking for webhook with path: ${path}`)

    // Find the webhook in the database
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

    // For all other providers, confirm the webhook endpoint exists
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
 * Processes incoming webhook payloads from all supported providers:
 * - Validates and parses the request body
 * - Performs provider-specific deduplication
 * - Acquires distributed processing lock
 * - Executes the associated workflow
 * 
 * Performance optimizations:
 * - Fast response time (2.5s timeout) to acknowledge receipt
 * - Background processing for long-running operations
 * - Robust deduplication to prevent duplicate executions
 * 
 * @param request The incoming HTTP request with webhook payload
 * @param params Route parameters containing the webhook path
 * @returns HTTP response (may respond before processing completes)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  let foundWorkflow: any = null
  let foundWebhook: any = null
  
  // --- PHASE 1: Request validation and parsing ---
  
  // Extract and validate the raw request body
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
    logger.error(`[${requestId}] Failed to read request body`, {
      error: bodyError instanceof Error ? bodyError.message : String(bodyError),
    })
    return new NextResponse('Failed to read request body', { status: 400 })
  }
  
  // Parse the body as JSON
  let body: any
  try {
    body = JSON.parse(rawBody)
    
    if (Object.keys(body).length === 0) {
      logger.warn(`[${requestId}] Rejecting empty JSON object`)
      return new NextResponse('Empty JSON payload', { status: 400 })
    }
  } catch (parseError) {
    logger.error(`[${requestId}] Failed to parse JSON body`, {
      error: parseError instanceof Error ? parseError.message : String(parseError),
    })
    return new NextResponse('Invalid JSON payload', { status: 400 })
  }
  
  // --- PHASE 2: Early Slack deduplication ---
  
  // Handle Slack-specific message deduplication to prevent duplicates
  const messageId = body?.event_id
  const slackRetryNum = request.headers.get('x-slack-retry-num')
  const slackRetryReason = request.headers.get('x-slack-retry-reason')
  
  if (body?.type === 'event_callback') {
    logger.debug(`[${requestId}] Slack event received with event_id: ${messageId || 'missing'}, retry: ${slackRetryNum || 'none'}`)
    
    // Create a robust deduplication key (works even if messageId is missing)
    const dedupeKey = messageId ? 
      `slack:msg:${messageId}` : 
      `slack:${body?.team_id || ''}:${body?.event?.ts || body?.event?.event_ts || Date.now()}`
    
    try {
      // Check if this message was already processed
      const isDuplicate = await hasProcessedMessage(dedupeKey)
      if (isDuplicate) {
        logger.info(`[${requestId}] Duplicate Slack message detected: ${dedupeKey}, retry: ${slackRetryNum || 'none'}`)
        return new NextResponse('Duplicate message', { status: 200 })
      }
      
      // Mark as processed immediately to prevent race conditions
      await markMessageAsProcessed(dedupeKey, 60 * 60 * 24) // 24 hour TTL
      logger.debug(`[${requestId}] Marked Slack message as processed with key: ${dedupeKey}`)
      
      // Log retry information if present
      if (slackRetryNum) {
        logger.info(`[${requestId}] Processing Slack retry #${slackRetryNum} for message, reason: ${slackRetryReason || 'unknown'}`)
      }
    } catch (error) {
      logger.error(`[${requestId}] Error in Slack deduplication`, error)
      // Continue processing - better to risk a duplicate than fail to process
    }
  }
  
  // --- PHASE 3: Set up fast response timeout and distributed processing ---
  
  // Ensure we respond quickly to the webhook provider
  // This prevents them from retrying the webhook and creating duplicates
  const timeoutPromise = new Promise<NextResponse>((resolve) => {
    setTimeout(() => {
      logger.warn(`[${requestId}] Request processing timeout, sending acknowledgment`)
      resolve(new NextResponse('Request received', { status: 200 }))
    }, 2500) // 2.5 second timeout for fast response
  })

  // Set up distributed processing lock to prevent duplicate processing
  let hasExecutionLock = false
  
  // Create a provider-specific lock key
  let executionLockKey: string
  if (body?.type === 'event_callback') {
    // For Slack events, use the same scheme as deduplication
    executionLockKey = messageId ? 
      `execution:lock:slack:${messageId}` : 
      `execution:lock:slack:${body?.team_id || ''}:${body?.event?.ts || body?.event?.event_ts || Date.now()}`
  } else {
    // Default fallback for other providers
    executionLockKey = `execution:lock:${requestId}:${crypto.randomUUID()}`
  }
  
  try {
    // Attempt to acquire a distributed processing lock
    hasExecutionLock = await acquireLock(executionLockKey, requestId, 30) // 30 second TTL
    logger.debug(`[${requestId}] Execution lock acquisition ${hasExecutionLock ? 'successful' : 'failed'} for key: ${executionLockKey}`)
  } catch (lockError) {
    logger.error(`[${requestId}] Error acquiring execution lock`, lockError)
    // Proceed without lock in case of Redis failure (fallback to best-effort)
  }

  // --- PHASE 4: Main processing logic ---
  const processingPromise = (async () => {
    try {
      const path = (await params).path
      logger.info(`[${requestId}] Processing webhook request for path: ${path}`)
      
      // Handle Slack URL verification challenge (special fast path)
      const slackChallengeResponse = handleSlackChallenge(body)
      if (slackChallengeResponse) {
        logger.info(`[${requestId}] Responding to Slack URL verification challenge`)
        return slackChallengeResponse
      }
      
      // Skip processing if another instance is already handling this request
      if (!hasExecutionLock) {
        logger.info(`[${requestId}] Skipping execution as lock was not acquired. Another instance is processing this request.`)
        return new NextResponse('Request is being processed by another instance', { status: 200 })
      }
      
      // Look up the webhook and its associated workflow
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
      
      // --- PHASE 5: Provider-specific processing ---
      
      // --- Airtable Processing (Polling-based) ---
      if (foundWebhook.provider === 'airtable') {
        logger.info(`[${requestId}] Airtable webhook ping received for webhook: ${foundWebhook.id}`)

        // Airtable deduplication using notification ID
        const notificationId = body.notificationId || null
        if (notificationId) {
          try {
            const processedKey = `airtable-webhook-${foundWebhook.id}-${notificationId}`

            // Check if this notification was already processed
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
              logger.info(
                `[${requestId}] Duplicate Airtable notification detected: ${notificationId}`,
                { webhookId: foundWebhook.id }
              )
              return new NextResponse('Notification already processed', { status: 200 })
            }

            // Store notification ID to prevent duplicate processing
            const providerConfig = foundWebhook.providerConfig || {}
            const processedNotifications = providerConfig.processedNotifications || []
            processedNotifications.push(processedKey)
            
            // Keep only the last 100 notifications to prevent unlimited growth
            const limitedNotifications = processedNotifications.slice(-100)

            // Update the webhook record
            await db
              .update(webhook)
              .set({
                providerConfig: {
                  ...providerConfig,
                  processedNotifications: limitedNotifications,
                },
                updatedAt: new Date(),
              })
              .where(eq(webhook.id, foundWebhook.id))
          } catch (error) {
            // If deduplication fails, log and continue processing
            logger.warn(`[${requestId}] Airtable deduplication check failed, continuing with processing`, {
              error: error instanceof Error ? error.message : String(error),
              webhookId: foundWebhook.id,
            })
          }
        }

        // Process Airtable payloads synchronously
        try {
          logger.info(`[${requestId}] Starting synchronous Airtable payload processing...`, {
            webhookId: foundWebhook.id,
            workflowId: foundWorkflow.id,
          })
          
          // This function fetches all changes from Airtable API and triggers workflow execution
          await fetchAndProcessAirtablePayloads(
            foundWebhook,
            foundWorkflow,
            requestId // Pass the original request ID for consistent logging
          )
          
          logger.info(`[${requestId}] Synchronous Airtable payload processing finished.`, {
            webhookId: foundWebhook.id,
          })
          
          return new NextResponse('Airtable ping processed successfully', { status: 200 })
        } catch (error: any) {
          logger.error(`[${requestId}] Error during synchronous Airtable processing`, {
            webhookId: foundWebhook.id,
            error: error.message,
            stack: error.stack,
          })
          return new NextResponse(`Error processing Airtable webhook: ${error.message}`, {
            status: 500,
          })
        }
      }
      
      // --- WhatsApp & Other Providers Processing ---
      
      // Generate a unique execution ID for this webhook trigger
      const executionId = uuidv4()
      
      // WhatsApp-specific deduplication
      if (foundWebhook.provider === 'whatsapp') {
        const data = body?.entry?.[0]?.changes?.[0]?.value
        const messages = data?.messages || []
        
        const whatsappDuplicateResponse = await processWhatsAppDeduplication(requestId, messages)
        if (whatsappDuplicateResponse) {
          return whatsappDuplicateResponse
        }
      } 
      // Generic deduplication for other providers (excluding Slack which was handled earlier)
      else if (foundWebhook.provider !== 'slack') {
        const genericDuplicateResponse = await processGenericDeduplication(requestId, path, body)
        if (genericDuplicateResponse) {
          return genericDuplicateResponse
        }
      }
      
      // --- Execute workflow for the webhook event ---
      logger.info(`[${requestId}] Executing workflow for ${foundWebhook.provider} webhook`)
      
      // Process the webhook and return the response
      // This function handles formatting input, executing the workflow, and persisting results
      return await processWebhook(foundWebhook, foundWorkflow, body, request, executionId, requestId)
      
    } catch (error: any) {
      logger.error(`[${requestId}] Error processing webhook:`, error)
      return new NextResponse(`Internal server error: ${error.message}`, { status: 500 })
    }
  })()
  
  // Race the processing against the timeout to ensure fast response
  return Promise.race([timeoutPromise, processingPromise])
}
