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

// Storage for active processing tasks to prevent garbage collection
// This keeps track of background promises that must continue running even after HTTP response
const activeProcessingTasks = new Map<string, Promise<any>>();

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
    const path = (await params).path

    // Check content type to handle different formats properly
    const contentType = request.headers.get('content-type') || ''
    
    // Clone the request to get the raw body for signature verification and content parsing
    const requestClone = request.clone()
    rawBody = await requestClone.text()
    logger.debug(`[${requestId}] Captured raw request body, length: ${rawBody.length}`)
    
    if (!rawBody || rawBody.length === 0) {
      logger.warn(`[${requestId}] Rejecting request with empty body`)
      return new NextResponse('Empty request body', { status: 400 })
    }
    // Parse the request body based on content type
    let body: any
    
    if (contentType.includes('application/json')) {
      try {
        // Parse as JSON if content type is JSON
        body = JSON.parse(rawBody || '{}')
      } catch (error) {
        logger.warn(`[${requestId}] Failed to parse request body as JSON, trying other formats`, error)
        body = {}
      }
    } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      // Handle form data (what Twilio sends)
      try {
        const formData = await request.formData()
        body = Object.fromEntries(formData.entries())
        logger.debug(`[${requestId}] Parsed form data: ${Object.keys(body).length} fields`)
      } catch (error) {
        logger.warn(`[${requestId}] Failed to parse form data, falling back to manual parsing`, error)
        
        // Fall back to manual parsing of form-urlencoded data
        try {
          if (rawBody) {
            body = Object.fromEntries(
              rawBody
                .split('&')
                .map(pair => {
                  const [key, value] = pair.split('=').map(part => decodeURIComponent(part.replace(/\+/g, ' ')))
                  return [key, value]
                })
            )
          } else {
            body = {}
          }
        } catch (innerError) {
          logger.error(`[${requestId}] Failed manual form parsing`, innerError)
          body = {}
        }
      }
    } else {
      // For other content types, try to parse as JSON first, then fall back
      try {
        body = JSON.parse(rawBody || '{}')
      } catch (error) {
        logger.warn(`[${requestId}] Unknown content type or parsing error, using raw body`, {
          contentType,
          bodyPreview: rawBody?.substring(0, 100)
        })
        body = { rawContent: rawBody }
      }
    }

    logger.info(`[${requestId}] Webhook POST request received for path: ${path}`)

    // Generate a unique request ID based on the request content
    const requestHash = await generateRequestHash(path, body)

    // Check if this exact request has been processed before
    if (await hasProcessedMessage(requestHash)) {
      logger.info(`[${requestId}] Duplicate webhook request detected with hash: ${requestHash}`)
      // Return early for duplicate requests to prevent workflow execution
      return new NextResponse('Duplicate request', { status: 200 })
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

      // Mark this request as processed to prevent duplicates
      await markMessageAsProcessed(requestHash, 60 * 60 * 24)

      // Process the webhook for Slack
      return await processWebhook(
        foundWebhook,
        foundWorkflow,
        body,
        request,
        executionId,
        requestId
      )
    } else if (foundWebhook.provider === 'whatsapp') {
      // Extract WhatsApp specific data
      const data = body?.entry?.[0]?.changes?.[0]?.value
      const messages = data?.messages || []

      if (messages.length > 0) {
        const message = messages[0]
        const messageId = message.id

        // Check if we've already processed this message using Redis
        if (messageId && (await hasProcessedMessage(messageId))) {
          logger.info(`[${requestId}] Duplicate WhatsApp message detected with ID: ${messageId}`)
          // Return early for duplicate messages to prevent workflow execution
          return new NextResponse('Duplicate message', { status: 200 })
        }

        // Store the message ID in Redis to prevent duplicate processing in future requests
        if (messageId) {
          await markMessageAsProcessed(messageId)
        }

        // Mark this request as processed to prevent duplicates
        // Use a shorter TTL for request hashes (24 hours) to save Redis memory
        await markMessageAsProcessed(requestHash, 60 * 60 * 24)

        // Process the webhook synchronously - complete the workflow before returning
        const result = await processWebhook(
          foundWebhook,
          foundWorkflow,
          body,
          request,
          executionId,
          requestId
        )

        // After workflow execution is complete, return 200 OK
        logger.info(
          `[${requestId}] Workflow execution complete for WhatsApp message ID: ${messageId}`
        )
        return result
      } else {
        // This might be a different type of notification (e.g., status update)
        logger.debug(`[${requestId}] No messages in WhatsApp payload, might be a status update`)
        return new NextResponse('OK', { status: 200 })
      }
    } else if (foundWebhook.provider === 'twilio') {
      // Process Twilio webhook request
      logger.info(`[${requestId}] Processing Twilio webhook request`)
      
      // Check if this is from Twilio based on form fields
      const isTwilioRequest = body && (body.MessageSid || body.AccountSid || body.From)
      
      if (isTwilioRequest) {
        // Extract Twilio specific data
        const messageBody = body.Body || ''
        const from = body.From || ''
        const to = body.To || ''
        const messageId = body.MessageSid || ''
        const numMedia = parseInt(body.NumMedia || '0', 10)
        
        logger.info(`[${requestId}] Received SMS from ${from} to ${to}`, {
          messagePreview: messageBody.substring(0, 50),
          numMedia,
          smsMessageSid: body.SmsMessageSid || '',
          messageSid: messageId,
          allFormFields: Object.keys(body),
        })
        
        // Store message ID in Redis to prevent duplicate processing
        if (messageId) {
          await markMessageAsProcessed(messageId)
        }
        
        // Mark this request as processed to prevent duplicates
        await markMessageAsProcessed(requestHash, 60 * 60 * 24)
        
        // Check if we need to authenticate the request
        const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
                
        // For MMS messages, extract media information
        let mediaItems: Array<{ url: string; contentType: string }> = [];
        if (numMedia > 0) {
          for (let i = 0; i < numMedia; i++) {
            const mediaUrl = body[`MediaUrl${i}`];
            const contentType = body[`MediaContentType${i}`];
            if (mediaUrl) {
              mediaItems.push({
                url: mediaUrl,
                contentType: contentType || '',
              });
            }
          }
          
          logger.debug(`[${requestId}] MMS received with ${mediaItems.length} media items`);
        }
        
        // Enrich the body with additional Twilio-specific details
        const enrichedBody = {
          ...body,
          twilio: {
            messageType: numMedia > 0 ? 'mms' : 'sms',
            body: messageBody,
            from,
            to,
            messageId,
            media: mediaItems
          }
        };
        
        // Process the webhook with enriched data
        const result = await processWebhook(
          foundWebhook,
          foundWorkflow,
          enrichedBody,
          request,
          executionId,
          requestId
        )
        
        // Check if we should send a reply
        const sendReply = providerConfig.sendReply !== false
        
        // Generate TwiML response
        const twimlResponse = generateTwiML(
          sendReply ? `Thank you for your message: "${messageBody}". Your request is being processed.` : undefined
        )

        logger.info(`[${requestId}] TwiML response generated: ${twimlResponse}`)
        
        // Return TwiML response
        return new NextResponse(twimlResponse, {
          status: 200,
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
          },
        })
      }
    }

    // Mark this request as processed to prevent duplicates
    await markMessageAsProcessed(requestHash, 60 * 60 * 24)

    // For other providers, continue with synchronous processing
    return await processWebhook(foundWebhook, foundWorkflow, body, request, executionId, requestId)
  } catch (error: any) {
    logger.error(`[${requestId}] Error processing webhook`, error)

    // Log the error if we have a workflow ID
    if (foundWorkflow?.id) {
      await persistExecutionError(foundWorkflow.id, executionId, error, 'webhook')
    }

    return new NextResponse(`Internal Server Error: ${error.message}`, {
      status: 500,
    })
  } finally {
    // Ensure Redis connection is properly closed in serverless environment
    await closeRedisConnection()
  }
}

/**
 * Generate a unique hash for a webhook request based on its path and body
 * This is used to deduplicate webhook requests
 */
async function generateRequestHash(path: string, body: any): Promise<string> {
  try {
    // Create a string representation of the request
    // Remove any timestamp or random fields that would make identical requests look different
    const normalizedBody = normalizeBody(body)
    const requestString = `${path}:${JSON.stringify(normalizedBody)}`

    // Use a simple hash function for the request
    let hash = 0
    for (let i = 0; i < requestString.length; i++) {
      const char = requestString.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    } catch (error) {
      logger.error(`[${requestId}] Error in Slack deduplication`, error)
      // Continue processing - better to risk a duplicate than fail to process
    }
  }
  
  // --- PHASE 3: Set up processing framework ---
  
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
  
  // We can't detect Airtable webhooks reliably from the body alone
  // We'll handle provider-specific logic after loading the webhook from the database
  
  try {
    // Attempt to acquire a distributed processing lock
    hasExecutionLock = await acquireLock(executionLockKey, requestId, 30) // 30 second TTL
    logger.debug(`[${requestId}] Execution lock acquisition ${hasExecutionLock ? 'successful' : 'failed'} for key: ${executionLockKey}`)
  } catch (lockError) {
    logger.error(`[${requestId}] Error acquiring execution lock`, lockError)
    // Proceed without lock in case of Redis failure (fallback to best-effort)
  }

  // --- PHASE 4: First identify the webhook to determine the execution path ---
  const path = (await params).path
  logger.info(`[${requestId}] Processing webhook request for path: ${path}`)
  
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
  
  // NOW we can detect the provider correctly from the database record
  const isAirtableWebhook = foundWebhook.provider === 'airtable';
  
  // Special handling for Slack challenge verification - must be checked before timeout
  const slackChallengeResponse = body?.type === 'url_verification' ? handleSlackChallenge(body) : null;
  if (slackChallengeResponse) {
    logger.info(`[${requestId}] Responding to Slack URL verification challenge`);
    return slackChallengeResponse;
  }
  
  // Skip processing if another instance is already handling this request
  if (!hasExecutionLock) {
    logger.info(`[${requestId}] Skipping execution as lock was not acquired. Another instance is processing this request.`);
    return new NextResponse('Request is being processed by another instance', { status: 200 });
  }
  
  // --- PHASE 5: Branch based on provider type ---
  
  // For Airtable, use fully synchronous processing without timeouts
  if (isAirtableWebhook) {
    try {
      logger.info(`[${requestId}] Airtable webhook ping received for webhook: ${foundWebhook.id}`);
      
      // DEBUG: Log webhook and workflow IDs to trace execution
      logger.debug(`[${requestId}] EXECUTION_TRACE: Airtable webhook handling started`, {
        webhookId: foundWebhook.id,
        workflowId: foundWorkflow.id,
        bodyKeys: Object.keys(body)
      });

      // Airtable deduplication using notification ID 
      const notificationId = body.notificationId || null;
      if (notificationId) {
        try {
          const processedKey = `airtable-webhook-${foundWebhook.id}-${notificationId}`;

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
            .limit(1);

          if (alreadyProcessed.length > 0) {
            logger.info(
              `[${requestId}] Duplicate Airtable notification detected: ${notificationId}`,
              { webhookId: foundWebhook.id }
            );
            return new NextResponse('Notification already processed', { status: 200 });
          }

          // Store notification ID to prevent duplicate processing
          const providerConfig = foundWebhook.providerConfig || {};
          const processedNotifications = providerConfig.processedNotifications || [];
          processedNotifications.push(processedKey);
          
          // Keep only the last 100 notifications to prevent unlimited growth
          const limitedNotifications = processedNotifications.slice(-100);

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
            .where(eq(webhook.id, foundWebhook.id));
            
          // DEBUG: Log successful deduplication
          logger.debug(`[${requestId}] EXECUTION_TRACE: Deduplication successful, notification ID stored`, {
            notificationId,
            processedKey,
            totalNotificationsStored: limitedNotifications.length
          });
        } catch (error) {
          // If deduplication fails, log and continue processing
          logger.warn(`[${requestId}] Airtable deduplication check failed, continuing with processing`, {
            error: error instanceof Error ? error.message : String(error),
            webhookId: foundWebhook.id,
          });
        }
      }

      // Process Airtable payloads COMPLETELY SYNCHRONOUSLY with NO TIMEOUT
      try {
        // Explicitly use the synchronous approach that worked before
        logger.info(`[${requestId}] Starting synchronous Airtable payload processing...`, {
          webhookId: foundWebhook.id,
          workflowId: foundWorkflow.id,
        });
        
        // DEBUG: Log processing start time for timing analysis
        const processingStartTime = Date.now();
        logger.debug(`[${requestId}] EXECUTION_TRACE: About to call fetchAndProcessAirtablePayloads`, {
          webhookId: foundWebhook.id,
          workflowId: foundWorkflow.id,
          timestamp: new Date().toISOString()
        });
        
        // Process the ping SYNCHRONOUSLY - directly await it with NO timeout
        await fetchAndProcessAirtablePayloads(
          foundWebhook,
          foundWorkflow,
          requestId // Pass the original request ID for consistent logging
        );
        
        // DEBUG: Log processing duration
        const processingDuration = Date.now() - processingStartTime;
        logger.debug(`[${requestId}] EXECUTION_TRACE: fetchAndProcessAirtablePayloads completed`, {
          duration: `${processingDuration}ms`,
          webhookId: foundWebhook.id,
          workflowId: foundWorkflow.id
        });
        
        logger.info(`[${requestId}] Synchronous Airtable payload processing finished.`, {
          webhookId: foundWebhook.id,
        });
        
        // Return success after SYNCHRONOUS processing completes - exactly like old code
        return new NextResponse('Airtable ping processed successfully', { status: 200 });
      } catch (error: any) {
        // DEBUG: Log detailed error information
        logger.error(`[${requestId}] EXECUTION_TRACE: Error during Airtable processing`, {
          webhookId: foundWebhook.id,
          workflowId: foundWorkflow.id,
          errorType: error.constructor.name, 
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        });
        
        logger.error(`[${requestId}] Error during synchronous Airtable processing`, {
          webhookId: foundWebhook.id,
          error: error.message,
          stack: error.stack,
        });
        return new NextResponse(`Error processing Airtable webhook: ${error.message}`, {
          status: 500,
        });
      }
    } catch (error: any) {
      logger.error(`[${requestId}] Error in Airtable processing branch:`, error);
      return new NextResponse(`Internal server error: ${error.message}`, { status: 500 });
    }
  }
  
  // For all other webhook types, use the timeout mechanism
  // Create timeout promise for non-Airtable webhooks
  const timeoutDuration = 2500; // 2.5 seconds for non-Airtable webhooks
  const timeoutPromise = new Promise<NextResponse>((resolve) => {
    setTimeout(() => {
      logger.warn(`[${requestId}] Request processing timeout (${timeoutDuration}ms), sending acknowledgment`);
      resolve(new NextResponse('Request received', { status: 200 }));
    }, timeoutDuration);
  });
  
  // Create the processing promise for non-Airtable webhooks
  const processingPromise = (async () => {
    try {
      // WhatsApp-specific deduplication
      if (foundWebhook.provider === 'whatsapp') {
        const data = body?.entry?.[0]?.changes?.[0]?.value;
        const messages = data?.messages || [];
        
        const whatsappDuplicateResponse = await processWhatsAppDeduplication(requestId, messages);
        if (whatsappDuplicateResponse) {
          return whatsappDuplicateResponse;
        }
      } 
      // Generic deduplication for other providers (excluding Slack which was handled earlier)
      else if (foundWebhook.provider !== 'slack') {
        const genericDuplicateResponse = await processGenericDeduplication(requestId, path, body);
        if (genericDuplicateResponse) {
          return genericDuplicateResponse;
        }
      }
      
      // --- Execute workflow for the webhook event ---
      logger.info(`[${requestId}] Executing workflow for ${foundWebhook.provider} webhook`);
      
      // Generate a unique execution ID for this webhook trigger
      const executionId = uuidv4();
      
      // Process the webhook and return the response
      // This function handles formatting input, executing the workflow, and persisting results
      return await processWebhook(foundWebhook, foundWorkflow, body, request, executionId, requestId);
      
    } catch (error: any) {
      logger.error(`[${requestId}] Error processing webhook:`, error);
      return new NextResponse(`Internal server error: ${error.message}`, { status: 500 });
    }
  })();
  
  // Race the processing against the timeout to ensure fast response (for non-Airtable)
  return Promise.race([timeoutPromise, processingPromise]);
}

/**
 * Generate a TwiML response
 */
function generateTwiML(message?: string): string {
  if (!message) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>'
  }
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${message}</Message>
</Response>`
}
