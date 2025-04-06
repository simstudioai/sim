import { NextRequest, NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { persistExecutionError, persistExecutionLogs } from '@/lib/logs/execution-logger'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
import {
  acquireLock,
  closeRedisConnection,
  getLockValue,
  hasProcessedMessage,
  markMessageAsProcessed,
  releaseLock,
} from '@/lib/redis'
import { decryptSecret } from '@/lib/utils'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { mergeSubblockStateAsync } from '@/stores/workflows/utils'
import { db } from '@/db'
import { account, environment, userStats, webhook, workflow } from '@/db/schema'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { validateSlackSignature } from '../../utils'

const logger = createLogger('WebhookTriggerAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes max execution time for long-running webhooks

// --- Placeholder Function to Get OAuth Token (copied from webhooks/route.ts) ---
// NOTE: Replace this with your actual implementation for fetching stored OAuth tokens
async function getOAuthToken(userId: string, providerId: string): Promise<string | null> {
  logger.debug(`Attempting to fetch OAuth token for user ${userId}, provider ${providerId}`)
  const connections = await db
    .select({ accessToken: account.accessToken })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))
    .orderBy(account.createdAt) // Consider filtering by expiration or using a specific 'active' flag
    .limit(1)

  if (connections.length > 0 && connections[0].accessToken) {
    logger.info(`Found OAuth token for user ${userId}, provider ${providerId}`)
    // TODO: Add token decryption if necessary
    // TODO: Add token refresh logic if necessary
    return connections[0].accessToken
  }

  logger.warn(`No valid OAuth token found for user ${userId}, provider ${providerId}`)
  return null
}
// --- End Placeholder ---

/**
 * Consolidated webhook trigger endpoint for all providers
 * Handles both WhatsApp verification and other webhook providers
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const path = (await params).path
    const url = new URL(request.url)

    // Check if this is a WhatsApp verification request
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode && token && challenge) {
      // This is a WhatsApp verification request
      logger.info(`[${requestId}] WhatsApp verification request received for path: ${path}`)

      if (mode !== 'subscribe') {
        logger.warn(`[${requestId}] Invalid WhatsApp verification mode: ${mode}`)
        return new NextResponse('Invalid mode', { status: 400 })
      }

      // Find all active WhatsApp webhooks
      const webhooks = await db
        .select()
        .from(webhook)
        .where(and(eq(webhook.provider, 'whatsapp'), eq(webhook.isActive, true)))

      // Check if any webhook has a matching verification token
      for (const wh of webhooks) {
        const providerConfig = (wh.providerConfig as Record<string, any>) || {}
        const verificationToken = providerConfig.verificationToken

        if (!verificationToken) {
          logger.debug(`[${requestId}] Webhook ${wh.id} has no verification token, skipping`)
          continue
        }

        if (token === verificationToken) {
          logger.info(`[${requestId}] WhatsApp verification successful for webhook ${wh.id}`)
          // Return ONLY the challenge as plain text (exactly as WhatsApp expects)
          return new NextResponse(challenge, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
            },
          })
        }
      }

      logger.warn(`[${requestId}] No matching WhatsApp verification token found`)
      return new NextResponse('Verification failed', { status: 403 })
    }

    // For non-WhatsApp verification requests
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

    // For other providers, just return a 200 OK
    logger.info(`[${requestId}] Webhook verification successful for path: ${path}`)
    return new NextResponse('OK', { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Error processing webhook verification`, error)
    return new NextResponse(`Internal Server Error: ${error.message}`, {
      status: 500,
    })
  } finally {
    // Ensure Redis connection is properly closed in serverless environment
    await closeRedisConnection()
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  let foundWorkflow: any = null
  let rawBody: string | null = null
  let foundWebhook: any = null // Define here for broader scope

  try {
    const path = (await params).path

    const requestClone = request.clone()
    rawBody = await requestClone.text()
    const body = JSON.parse(rawBody || '{}')
    logger.info(`[${requestId}] Webhook POST request received for path: ${path}`)

    // --- Find Webhook and Workflow ---
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

    // Assign to the higher-scoped variables
    foundWebhook = webhooks[0].webhook
    foundWorkflow = webhooks[0].workflow

    logger.info(`[${requestId}] Found webhook for path ${path}`, {
      webhookId: foundWebhook.id,
      provider: foundWebhook.provider,
      workflowId: foundWorkflow.id,
    })

    // --- Provider Specific Logic ---

    // --- Airtable Ping Handling with Debounce ---
    if (foundWebhook.provider === 'airtable') {
      logger.info(`[${requestId}] Airtable webhook ping received for webhook: ${foundWebhook.id}`)

      // Define lock key and expiry (e.g., 30 seconds)
      const lockKey = `airtable_processing:${foundWebhook.id}`
      const lockExpirySeconds = 30

      // Attempt to acquire the lock
      const lockAcquired = await acquireLock(lockKey, requestId, lockExpirySeconds)

      if (!lockAcquired) {
        logger.info(
          `[${requestId}] Processing already in progress for webhook ${foundWebhook.id}. Skipping this ping.`
        )
        return new NextResponse('Processing already in progress', { status: 200 }) // Acknowledge ping but don't process
      }

      logger.info(`[${requestId}] Acquired processing lock for webhook ${foundWebhook.id}.`)

      // TODO: Implement Airtable Signature Verification if needed
      // ... (Signature verification logic) ...

      // Acknowledge the ping immediately AFTER acquiring lock
      logger.debug(`[${requestId}] Acknowledging Airtable ping for webhook ${foundWebhook.id}.`)
      // Use request.waitUntil for Vercel edge functions to allow background tasks
      const backgroundTaskPromise = fetchAndProcessAirtablePayloads(
        foundWebhook,
        foundWorkflow,
        requestId, // Pass the original request ID
        lockKey // Pass the lock key to release it later
      )
      if (typeof (request as any).waitUntil === 'function') {
        ;(request as any).waitUntil(backgroundTaskPromise)
        logger.info(`[${requestId}] Scheduled Airtable payload fetch via waitUntil.`)
      } else {
        // For non-edge environments, run async but don't await the main handler
        logger.info(`[${requestId}] Running Airtable payload fetch asynchronously (non-edge).`)
        backgroundTaskPromise.catch((err) => {
          logger.error(`[${requestId}] Uncaught error in background Airtable processing.`, err)
          // Persist internal polling error - use original requestId as a prefix
          persistExecutionError(foundWorkflow.id, `poll-${requestId}-uncaught`, err, 'webhook')
          // Ensure lock is released even on uncaught error
          releaseLock(lockKey).catch((releaseErr) =>
            logger.error(`Failed to release lock on uncaught error for ${lockKey}`, releaseErr)
          )
        })
      }

      // Return immediately after scheduling the background task
      return new NextResponse('Airtable ping acknowledged, processing started', { status: 200 })
    }

    // --- Existing Deduplication and Processing for other providers ---
    // Generate hash *only* for non-Airtable requests now
    const requestHash = await generateRequestHash(path, body)
    if (await hasProcessedMessage(requestHash)) {
      logger.info(
        `[${requestId}] Duplicate webhook request detected (non-Airtable) with hash: ${requestHash}`
      )
      return new NextResponse('Duplicate request', { status: 200 })
    }
    // Mark as processed *only* for non-Airtable requests needing this body-based dedup
    await markMessageAsProcessed(`req:${requestHash}`, 60 * 60 * 24) // Use prefix for clarity

    // --- Slack Specific Handling ---
    if (foundWebhook.provider === 'slack') {
      const executionId = uuidv4() // Generate unique ID for this execution
      // (Keep existing Slack signature validation and message ID deduplication)
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const signingSecret = providerConfig.signingSecret
      if (signingSecret) {
        // Validate the Slack signature
        const slackSignature = request.headers.get('x-slack-signature')
        const slackTimestamp = request.headers.get('x-slack-request-timestamp')

        if (!slackSignature || !slackTimestamp || !rawBody) {
          logger.warn(`[${requestId}] Missing Slack signature headers`, {
            hasSignature: !!slackSignature,
            hasTimestamp: !!slackTimestamp,
            hasBody: !!rawBody,
          })
          return NextResponse.json({ error: 'Invalid Slack request' }, { status: 400 })
        }

        const isValid = await validateSlackSignature(
          signingSecret,
          slackSignature,
          slackTimestamp,
          rawBody
        )
        if (!isValid) {
          logger.warn(`[${requestId}] Invalid Slack signature`)
          return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
        }
        logger.info(`[${requestId}] Slack signature validated successfully`)
        if (body.type === 'url_verification' && body.challenge) {
          logger.info(`[${requestId}] Responding to Slack URL verification challenge`)
          return NextResponse.json({ challenge: body.challenge })
        }
      }
      const messageId = body?.event?.event_id // Slack message ID
      // Use full prefix for clarity and avoid collision with general keys
      const slackMsgKey = `slack:msg:${messageId}`
      if (messageId && (await hasProcessedMessage(slackMsgKey))) {
        logger.info(`[${requestId}] Duplicate Slack message detected with ID: ${messageId}`)
        return new NextResponse('Duplicate message', { status: 200 })
      }
      if (messageId) {
        await markMessageAsProcessed(slackMsgKey) // Use specific key
      }
      // Process Slack webhook using the existing function
      return await processWebhook(
        foundWebhook,
        foundWorkflow,
        body,
        request,
        executionId, // Use the generated executionId for Slack
        requestId
      )
    }

    // --- WhatsApp Specific Handling ---
    else if (foundWebhook.provider === 'whatsapp') {
      const executionId = uuidv4() // Generate unique ID for this execution
      // (Keep existing WhatsApp message ID deduplication)
      const data = body?.entry?.[0]?.changes?.[0]?.value
      const messages = data?.messages || []
      if (messages.length > 0) {
        const message = messages[0]
        const messageId = message.id // WhatsApp message ID
        // Use full prefix for clarity
        const whatsappMsgKey = `whatsapp:msg:${messageId}`
        if (messageId && (await hasProcessedMessage(whatsappMsgKey))) {
          logger.info(`[${requestId}] Duplicate WhatsApp message detected with ID: ${messageId}`)
          return new NextResponse('Duplicate message', { status: 200 })
        }
        if (messageId) {
          await markMessageAsProcessed(whatsappMsgKey) // Use specific key
        }
        // Process WhatsApp webhook using the existing function
        const result = await processWebhook(
          foundWebhook,
          foundWorkflow,
          body,
          request,
          executionId, // Use the generated executionId for WhatsApp
          requestId
        )
        logger.info(
          `[${requestId}] Workflow execution complete for WhatsApp message ID: ${messageId}`
        )
        return result
      } else {
        logger.debug(`[${requestId}] No messages in WhatsApp payload, might be status update.`)
        return new NextResponse('OK', { status: 200 })
      }
    }

    // --- Generic/Other Provider Processing ---
    const executionId = uuidv4() // Generate unique ID for this execution
    // (Uses the requestHash deduplication from earlier)
    logger.info(`[${requestId}] Processing generic/other webhook: ${foundWebhook.provider}`)
    return await processWebhook(
      foundWebhook,
      foundWorkflow,
      body, // Pass the original body
      request,
      executionId, // Use the generated executionId for generic
      requestId
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error in main POST handler`, error)
    // Use a generic execution ID for errors before specific handlers are reached
    const errorExecutionId = `error-${requestId}`
    return new NextResponse(`Internal Server Error: ${error.message}`, {
      status: 500,
    })
  } finally {
    // Close Redis connection ONLY if not processing Airtable in background
    // If Airtable is handled, the background task will close it.
    if (foundWebhook?.provider !== 'airtable') {
      await closeRedisConnection()
    }
  }
}

// --- Helper Functions ---

/**
 * Fetches all available payloads from Airtable API after a ping
 * and triggers a single workflow execution with the batch of payloads.
 * Releases the processing lock upon completion or error.
 */
async function fetchAndProcessAirtablePayloads(
  webhookData: any,
  workflowData: any,
  requestId: string, // Original request ID from the ping, used for the final execution log & lock value
  lockKey: string // Lock key to check and release
) {
  // Use a prefix derived from requestId for *internal* polling logs/errors
  const internalPollIdPrefix = `poll-${requestId}`
  let currentCursor: number | null = null
  let mightHaveMore = true
  let payloadsFetched = 0 // Track total payloads fetched
  let apiCallCount = 0
  // Use a Map to consolidate changes per record ID
  const consolidatedChangesMap = new Map<string, AirtableChange>()
  let localProviderConfig = { ...((webhookData.providerConfig as Record<string, any>) || {}) } // Local copy

  try {
    // --- Essential IDs & Config from localProviderConfig ---
    const baseId = localProviderConfig.baseId
    const airtableWebhookId = localProviderConfig.externalId

    if (!baseId || !airtableWebhookId) {
      logger.error(
        `[${requestId}] Missing baseId or externalId in providerConfig for webhook ${webhookData.id}. Cannot fetch payloads.`
      )
      await persistExecutionError(
        workflowData.id,
        `${internalPollIdPrefix}-config-error`,
        new Error('Missing Airtable baseId or externalId in providerConfig'),
        'webhook'
      )
      return // Exit early, lock will be released in finally block
    }

    // --- Retrieve Stored Cursor from localProviderConfig ---
    const storedCursor = localProviderConfig.externalWebhookCursor
    if (storedCursor && typeof storedCursor === 'number') {
      currentCursor = storedCursor
      logger.info(
        `[${requestId}] Retrieved stored cursor from providerConfig for Airtable webhook ${webhookData.id}: ${currentCursor}`
      )
    } else {
      logger.info(
        `[${requestId}] No valid stored cursor in providerConfig for Airtable webhook ${webhookData.id}, starting poll.`
      )
      currentCursor = null // Airtable API defaults to 1 if omitted
    }

    // --- Get OAuth Token ---
    let accessToken: string | null = null
    try {
      accessToken = await getOAuthToken(workflowData.userId, 'airtable')
      if (!accessToken) {
        throw new Error('Airtable access token not found.')
      }
    } catch (tokenError: any) {
      logger.error(
        `[${requestId}] Failed to get Airtable OAuth token for user ${workflowData.userId}`,
        tokenError
      )
      await persistExecutionError(
        workflowData.id,
        `${internalPollIdPrefix}-token-error`,
        tokenError,
        'webhook'
      )
      return // Exit early, lock will be released in finally block
    }

    const airtableApiBase = 'https://api.airtable.com/v0'

    // --- Polling Loop ---
    while (mightHaveMore) {
      apiCallCount++
      // Safety break
      if (apiCallCount > 10) {
        logger.warn(
          `[${requestId}] Reached maximum polling limit (10 calls) for webhook ${webhookData.id}. Processing ${consolidatedChangesMap.size} consolidated changes.`
        )
        mightHaveMore = false
        break
      }

      const apiUrl = `${airtableApiBase}/bases/${baseId}/webhooks/${airtableWebhookId}/payloads`
      const queryParams = new URLSearchParams()
      if (currentCursor !== null) {
        queryParams.set('cursor', currentCursor.toString())
      }
      const fullUrl = `${apiUrl}?${queryParams.toString()}`
      logger.info(`[${requestId}] Calling Airtable GET /payloads (Call ${apiCallCount})`, {
        url: apiUrl,
        cursor: currentCursor,
      })

      try {
        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        })
        const responseBody = await response.json()

        if (!response.ok || responseBody.error) {
          const errorMessage =
            responseBody.error?.message ||
            responseBody.error ||
            `Airtable API error Status ${response.status}`
          logger.error(
            `[${requestId}] Failed to fetch Airtable payloads (Call ${apiCallCount}) for webhook ${webhookData.id}. Status: ${response.status}`,
            { error: errorMessage }
          )
          await persistExecutionError(
            workflowData.id,
            `${internalPollIdPrefix}-api-error-${apiCallCount}`,
            new Error(`Airtable API Error: ${errorMessage}`),
            'webhook'
          )
          mightHaveMore = false
          break
        }

        const receivedPayloads = responseBody.payloads || []
        logger.info(
          `[${requestId}] Received ${receivedPayloads.length} payloads from Airtable (Call ${apiCallCount}). mightHaveMore: ${responseBody.mightHaveMore}`
        )

        // --- Process and Consolidate Changes ---
        if (receivedPayloads.length > 0) {
          payloadsFetched += receivedPayloads.length
          for (const payload of receivedPayloads) {
            if (payload.changedTablesById) {
              for (const [tableId, tableChangesUntyped] of Object.entries(
                payload.changedTablesById
              )) {
                const tableChanges = tableChangesUntyped as any // Assert type

                // Handle created records
                if (tableChanges.createdRecordsById) {
                  for (const [recordId, recordDataUntyped] of Object.entries(
                    tableChanges.createdRecordsById
                  )) {
                    const recordData = recordDataUntyped as any // Assert type
                    const existingChange = consolidatedChangesMap.get(recordId)
                    if (existingChange) {
                      // Record was created and possibly updated within the same batch
                      existingChange.changedFields = {
                        ...existingChange.changedFields,
                        ...(recordData.cellValuesByFieldId || {}),
                      }
                      // Keep changeType as 'created' if it started as created
                    } else {
                      // New creation
                      consolidatedChangesMap.set(recordId, {
                        tableId: tableId,
                        recordId: recordId,
                        changeType: 'created',
                        changedFields: recordData.cellValuesByFieldId || {},
                      })
                    }
                  }
                }

                // Handle updated records
                if (tableChanges.changedRecordsById) {
                  for (const [recordId, recordDataUntyped] of Object.entries(
                    tableChanges.changedRecordsById
                  )) {
                    const recordData = recordDataUntyped as any // Assert type
                    const existingChange = consolidatedChangesMap.get(recordId)
                    const currentFields = recordData.current?.cellValuesByFieldId || {}

                    if (existingChange) {
                      // Existing record was updated again
                      existingChange.changedFields = {
                        ...existingChange.changedFields,
                        ...currentFields,
                      }
                      // Ensure type is 'updated' if it was previously 'created'
                      existingChange.changeType = 'updated'
                      // Do not update previousFields again
                    } else {
                      // First update for this record in the batch
                      const newChange: AirtableChange = {
                        tableId: tableId,
                        recordId: recordId,
                        changeType: 'updated',
                        changedFields: currentFields,
                      }
                      if (recordData.previous?.cellValuesByFieldId) {
                        newChange.previousFields = recordData.previous.cellValuesByFieldId
                      }
                      consolidatedChangesMap.set(recordId, newChange)
                    }
                  }
                }
                // TODO: Handle deleted records (`destroyedRecordIds`) if needed
              }
            }
          }
        }

        const nextCursor = responseBody.cursor
        mightHaveMore = responseBody.mightHaveMore || false

        if (nextCursor && typeof nextCursor === 'number' && nextCursor !== currentCursor) {
          logger.info(
            `[${requestId}] Updating cursor in providerConfig for Airtable webhook ${webhookData.id} to ${nextCursor}`
          )
          currentCursor = nextCursor
          try {
            const updatedConfig = { ...localProviderConfig, externalWebhookCursor: currentCursor }
            await db
              .update(webhook)
              .set({ providerConfig: updatedConfig, updatedAt: new Date() })
              .where(eq(webhook.id, webhookData.id))
            localProviderConfig.externalWebhookCursor = currentCursor // Update local copy too
          } catch (dbError: any) {
            logger.error(
              `[${requestId}] Failed to persist updated cursor ${currentCursor} in providerConfig for Airtable webhook ${webhookData.id}`,
              dbError
            )
            await persistExecutionError(
              workflowData.id,
              `${internalPollIdPrefix}-cursor-persist-error`,
              dbError,
              'webhook'
            )
            mightHaveMore = false
          }
        } else if (!nextCursor || typeof nextCursor !== 'number') {
          logger.warn(
            `[${requestId}] Invalid or missing cursor from Airtable API (Call ${apiCallCount}). Stopping poll. Cursor: ${nextCursor}`
          )
          mightHaveMore = false
        } else {
          logger.debug(
            `[${requestId}] Cursor unchanged (${currentCursor}) after call ${apiCallCount}. mightHaveMore is ${mightHaveMore}.`
          )
        }
      } catch (fetchError: any) {
        logger.error(
          `[${requestId}] Network error calling Airtable GET /payloads (Call ${apiCallCount}) for webhook ${webhookData.id}`,
          fetchError
        )
        await persistExecutionError(
          workflowData.id,
          `${internalPollIdPrefix}-fetch-error-${apiCallCount}`,
          fetchError,
          'webhook'
        )
        mightHaveMore = false
        break
      }
    }
    // --- End Polling Loop ---

    // Convert map values to array for final processing
    const finalConsolidatedChanges = Array.from(consolidatedChangesMap.values())

    logger.info(
      `[${requestId}] Finished polling Airtable for webhook ${webhookData.id}. Processed ${payloadsFetched} payloads into ${finalConsolidatedChanges.length} consolidated change entries.`
    )

    // --- Verify Lock and Execute Workflow ONCE ---
    if (finalConsolidatedChanges.length > 0) {
      // Check if our lock is still valid before executing
      const currentLockValue = await getLockValue(lockKey)
      if (currentLockValue === requestId) {
        logger.info(
          `[${requestId}] Lock verified. Triggering single workflow execution for ${finalConsolidatedChanges.length} consolidated Airtable changes.`
        )
        try {
          // Format the input for the executor using the consolidated changes
          const input = { airtableChanges: finalConsolidatedChanges } // Use the consolidated array
          // Execute using the original requestId as the executionId
          await executeWorkflowFromPayload(workflowData, input, requestId, requestId)
        } catch (executionError: any) {
          // Errors logged within executeWorkflowFromPayload
          logger.error(
            `[${requestId}] Error during the final workflow execution after polling`,
            executionError
          )
        }
      } else {
        logger.info(
          `[${requestId}] Lock was overwritten or expired (current value: ${currentLockValue}). Aborting execution for stale data.`
        )
        // Do not execute the workflow as a newer ping likely started processing.
      }
    } else {
      logger.info(
        `[${requestId}] No new changes collected from Airtable for webhook ${webhookData.id}. Workflow not executed.`
      )
    }
  } catch (error) {
    // Catch any unexpected errors during the setup/polling logic itself
    logger.error(
      `[${requestId}] Unexpected error during Airtable payload processing for webhook ${webhookData.id}`,
      error
    )
    // Persist this higher-level error
    await persistExecutionError(
      workflowData.id,
      `${internalPollIdPrefix}-processing-error`,
      error as Error,
      'webhook'
    )
  } finally {
    // Ensure the lock is released regardless of success or failure
    // Only release if WE still hold the lock (value matches our requestId)
    // This prevents releasing a lock acquired by a newer process.
    const finalLockValue = await getLockValue(lockKey)
    if (finalLockValue === requestId) {
      logger.info(`[${requestId}] Releasing processing lock for webhook ${webhookData.id}.`)
      await releaseLock(lockKey)
    } else {
      logger.warn(
        `[${requestId}] Did not release lock ${lockKey} as its value (${finalLockValue}) does not match our requestId.`
      )
    }
    // Ensure Redis connection is closed after background task is done
    await closeRedisConnection()
  }
}

// Define the simplified structure (can be moved to a types file later)
interface AirtableChange {
  tableId: string
  recordId: string
  changeType: 'created' | 'updated'
  changedFields: Record<string, any> // { fieldId: newValue }
  previousFields?: Record<string, any> // { fieldId: previousValue } (optional)
}

/**
 * REFACTORED: Core workflow execution logic.
 * Executes the workflow and persists logs/errors with 'webhook' trigger type.
 */
async function executeWorkflowFromPayload(
  foundWorkflow: any,
  input: any, // The formatted input for the workflow
  executionId: string, // Unique ID for this specific execution
  requestId: string // Original request ID for logging context
): Promise<void> {
  // Returns void as errors are handled internally
  try {
    // Get the workflow state
    if (!foundWorkflow.state) {
      throw new Error(`Workflow ${foundWorkflow.id} has no state`)
    }
    const state = foundWorkflow.state as any
    const { blocks, edges, loops } = state

    logger.debug(
      `[${requestId}] Merging subblock states for workflow ${foundWorkflow.id} (Execution: ${executionId})`
    )
    const mergedStates = await mergeSubblockStateAsync(blocks, foundWorkflow.id)

    // Retrieve and decrypt environment variables
    const [userEnv] = await db
      .select()
      .from(environment)
      .where(eq(environment.userId, foundWorkflow.userId))
      .limit(1)
    let decryptedEnvVars: Record<string, string> = {}
    if (userEnv) {
      // Decryption logic
      const decryptionPromises = Object.entries(userEnv.variables as Record<string, string>).map(
        async ([key, encryptedValue]) => {
          try {
            const { decrypted } = await decryptSecret(encryptedValue)
            return [key, decrypted] as const
          } catch (error: any) {
            logger.error(
              `[${requestId}] Failed to decrypt environment variable "${key}" (Execution: ${executionId})`,
              error
            )
            throw new Error(`Failed to decrypt environment variable "${key}": ${error.message}`)
          }
        }
      )
      const decryptedEntries = await Promise.all(decryptionPromises)
      decryptedEnvVars = Object.fromEntries(decryptedEntries)
    }

    // Process block states (extract subBlock values, parse responseFormat)
    const currentBlockStates = Object.entries(mergedStates).reduce(
      (acc, [id, block]) => {
        acc[id] = Object.entries(block.subBlocks).reduce(
          (subAcc, [key, subBlock]) => {
            subAcc[key] = subBlock.value
            return subAcc
          },
          {} as Record<string, any>
        )
        return acc
      },
      {} as Record<string, Record<string, any>>
    )

    const processedBlockStates = Object.entries(currentBlockStates).reduce(
      (acc, [blockId, blockState]) => {
        const processedState = { ...blockState }
        if (processedState.responseFormat) {
          try {
            if (typeof processedState.responseFormat === 'string') {
              processedState.responseFormat = JSON.parse(processedState.responseFormat)
            }
            if (
              processedState.responseFormat &&
              typeof processedState.responseFormat === 'object'
            ) {
              if (!processedState.responseFormat.schema && !processedState.responseFormat.name) {
                processedState.responseFormat = {
                  name: 'response_schema',
                  schema: processedState.responseFormat,
                  strict: true,
                }
              }
            }
            acc[blockId] = processedState
          } catch (error) {
            logger.warn(
              `[${requestId}] Failed to parse responseFormat for block ${blockId} (Execution: ${executionId})`,
              error
            )
            acc[blockId] = blockState
          }
        } else {
          acc[blockId] = blockState
        }
        return acc
      },
      {} as Record<string, Record<string, any>>
    )

    // Serialize and get workflow variables
    const serializedWorkflow = new Serializer().serializeWorkflow(mergedStates as any, edges, loops)
    let workflowVariables = {}
    if (foundWorkflow.variables) {
      try {
        if (typeof foundWorkflow.variables === 'string') {
          workflowVariables = JSON.parse(foundWorkflow.variables)
        } else {
          workflowVariables = foundWorkflow.variables
        }
      } catch (error) {
        logger.error(
          `[${requestId}] Failed to parse workflow variables: ${foundWorkflow.id} (Execution: ${executionId})`,
          error
        )
      }
    }

    logger.debug(
      `[${requestId}] Starting workflow execution ${executionId} with ${Object.keys(processedBlockStates).length} blocks`
    )
    const executor = new Executor(
      serializedWorkflow,
      processedBlockStates,
      decryptedEnvVars,
      input, // Use the provided input (might be single event or batch)
      workflowVariables
    )
    const result = await executor.execute(foundWorkflow.id)

    logger.info(
      `[${requestId}] Successfully executed workflow ${foundWorkflow.id} (Execution: ${executionId})`,
      {
        success: result.success,
        executionTime: result.metadata?.duration,
      }
    )

    // Update counts and stats if successful
    if (result.success) {
      await updateWorkflowRunCounts(foundWorkflow.id)
      await db
        .update(userStats)
        .set({
          totalWebhookTriggers: sql`total_webhook_triggers + 1`,
          lastActive: new Date(),
        })
        .where(eq(userStats.userId, foundWorkflow.userId))
    }

    // Build and enrich result with trace spans
    const { traceSpans, totalDuration } = buildTraceSpans(result)
    const enrichedResult = { ...result, traceSpans, totalDuration }

    // Persist logs for this execution using the standard 'webhook' trigger type
    await persistExecutionLogs(foundWorkflow.id, executionId, enrichedResult, 'webhook')
  } catch (error: any) {
    logger.error(
      `[${requestId}] Error executing workflow ${foundWorkflow.id} (Execution: ${executionId})`,
      error
    )
    // Persist the error for this execution using the standard 'webhook' trigger type
    await persistExecutionError(foundWorkflow.id, executionId, error, 'webhook')
    // Re-throw the error so the caller (fetchAndProcessAirtablePayloads) knows it failed
    throw error
  }
}

/**
 * Original webhook processing function (now mainly for non-Airtable).
 * It calls the refactored executeWorkflowFromPayload.
 */
async function processWebhook(
  foundWebhook: any,
  foundWorkflow: any,
  body: any, // Payload from the initial request (Slack, WhatsApp, Generic)
  request: NextRequest,
  executionId: string, // Execution ID for this specific webhook trigger
  requestId: string
): Promise<NextResponse> {
  try {
    // --- Provider-specific Auth/Verification (excluding Airtable/WhatsApp/Slack handled earlier) ---
    if (
      foundWebhook.provider &&
      !['airtable', 'whatsapp', 'slack'].includes(foundWebhook.provider)
    ) {
      const authHeader = request.headers.get('authorization')
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      // Keep existing switch statement for github, stripe, generic, default
      switch (foundWebhook.provider) {
        case 'github':
          break // No specific auth here
        case 'stripe':
          break // Stripe verification would go here
        case 'generic':
          // Generic auth logic: requireAuth, token, secretHeaderName, allowedIps
          if (providerConfig.requireAuth) {
            let isAuthenticated = false
            // Check for token in Authorization header (Bearer token)
            if (providerConfig.token) {
              const providedToken = authHeader?.startsWith('Bearer ')
                ? authHeader.substring(7)
                : null
              if (providedToken === providerConfig.token) {
                isAuthenticated = true
              }
              // Check for token in custom header if specified
              if (!isAuthenticated && providerConfig.secretHeaderName) {
                const customHeaderValue = request.headers.get(providerConfig.secretHeaderName)
                if (customHeaderValue === providerConfig.token) {
                  isAuthenticated = true
                }
              }
              // Return 401 if authentication failed
              if (!isAuthenticated) {
                logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
                return new NextResponse('Unauthorized', { status: 401 })
              }
            }
          }
          // IP restriction check
          if (
            providerConfig.allowedIps &&
            Array.isArray(providerConfig.allowedIps) &&
            providerConfig.allowedIps.length > 0
          ) {
            const clientIp =
              request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
              request.headers.get('x-real-ip') ||
              'unknown'

            if (clientIp === 'unknown' || !providerConfig.allowedIps.includes(clientIp)) {
              logger.warn(
                `[${requestId}] Forbidden webhook access attempt - IP not allowed: ${clientIp}`
              )
              return new NextResponse('Forbidden - IP not allowed', { status: 403 })
            }
          }
          break
        default:
          if (providerConfig.token) {
            const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
            if (!providedToken || providedToken !== providerConfig.token) {
              logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
              return new NextResponse('Unauthorized', { status: 401 })
            }
          }
      }
    }

    // --- Format Input based on provider (excluding Airtable) ---
    let input = {}
    if (foundWebhook.provider === 'whatsapp') {
      // WhatsApp input formatting logic
      const data = body?.entry?.[0]?.changes?.[0]?.value
      const messages = data?.messages || []
      if (messages.length > 0) {
        const message = messages[0]
        const phoneNumberId = data.metadata?.phone_number_id
        const from = message.from
        const messageId = message.id
        const timestamp = message.timestamp
        const text = message.text?.body
        input = {
          whatsapp: {
            data: {
              messageId,
              from,
              phoneNumberId,
              text,
              timestamp,
              raw: message,
            },
          },
          webhook: {
            data: {
              provider: 'whatsapp',
              path: foundWebhook.path,
              providerConfig: foundWebhook.providerConfig,
              payload: body,
              headers: Object.fromEntries(request.headers.entries()),
              method: request.method,
            },
          },
          workflowId: foundWorkflow.id, // Add workflowId for context
        }
      } else {
        return new NextResponse('OK', { status: 200 }) // Should not happen if checked earlier, but safe fallback
      }
    } else {
      // Generic format for Slack, GitHub, Stripe, Generic, etc.
      input = {
        webhook: {
          data: {
            path: foundWebhook.path,
            provider: foundWebhook.provider,
            providerConfig: foundWebhook.providerConfig,
            payload: body, // Use the direct payload
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
        workflowId: foundWorkflow.id, // Add workflowId for context
      }
    }

    // --- Execute Workflow ---
    logger.info(
      `[${requestId}] Executing workflow ${foundWorkflow.id} for webhook ${foundWebhook.id} (Execution: ${executionId})`
    )
    // Call the refactored execution function
    await executeWorkflowFromPayload(foundWorkflow, input, executionId, requestId)

    // Since executeWorkflowFromPayload handles logging and errors internally,
    // we just need to return a standard success response for synchronous webhooks.
    // Note: The actual result isn't typically returned in the webhook response itself.
    return NextResponse.json({ message: 'Webhook processed' }, { status: 200 })
  } catch (error: any) {
    // Catch errors *before* calling executeWorkflowFromPayload (e.g., auth errors)
    logger.error(
      `[${requestId}] Error in processWebhook *before* execution for ${foundWebhook.id} (Execution: ${executionId})`,
      error
    )
    return new NextResponse(`Internal Server Error: ${error.message}`, {
      status: 500,
    })
  }
}

// generateRequestHash and normalizeBody remain unchanged
// ...
async function generateRequestHash(path: string, body: any): Promise<string> {
  try {
    const normalizedBody = normalizeBody(body)
    const requestString = `${path}:${JSON.stringify(normalizedBody)}`
    let hash = 0
    for (let i = 0; i < requestString.length; i++) {
      const char = requestString.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }
    return `request:${path}:${hash}`
  } catch (error) {
    return `request:${path}:${uuidv4()}`
  }
}

function normalizeBody(body: any): any {
  if (!body || typeof body !== 'object') return body
  const result = Array.isArray(body) ? [...body] : { ...body }
  const fieldsToRemove = [
    'timestamp',
    'random',
    'nonce',
    'requestId',
    'event_id',
    'event_time' /* Add other volatile fields */,
  ] // Made case-insensitive check below
  if (Array.isArray(result)) {
    return result.map((item) => normalizeBody(item))
  } else {
    for (const key in result) {
      // Use lowercase check for broader matching
      if (fieldsToRemove.includes(key.toLowerCase())) {
        delete result[key]
      } else if (typeof result[key] === 'object' && result[key] !== null) {
        result[key] = normalizeBody(result[key])
      }
    }
    return result
  }
}
