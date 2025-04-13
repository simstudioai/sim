import { NextRequest, NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { persistExecutionError, persistExecutionLogs } from '@/lib/logs/execution-logger'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
import { decryptSecret } from '@/lib/utils'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { mergeSubblockStateAsync } from '@/stores/workflows/utils'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { environment, userStats, webhook, workflow } from '@/db/schema'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { getRedisClient, hasProcessedMessage, markMessageAsProcessed, acquireLock } from '@/lib/redis'

const logger = createLogger('WebhookUtils')

/**
 * Handle WhatsApp verification requests
 */
export async function handleWhatsAppVerification(
  requestId: string,
  path: string,
  mode: string | null,
  token: string | null,
  challenge: string | null
): Promise<NextResponse | null> {
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

  return null
}

/**
 * Handle Slack verification challenges
 */
export function handleSlackChallenge(
  body: any
): NextResponse | null {
  if (body.type === 'url_verification' && body.challenge) {
    return NextResponse.json({ challenge: body.challenge })
  }
  
  return null
}

/**
 * Validates a Slack webhook request signature using HMAC SHA-256
 * @param signingSecret - Slack signing secret for validation
 * @param signature - X-Slack-Signature header value
 * @param timestamp - X-Slack-Request-Timestamp header value
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */

export async function validateSlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): Promise<boolean> {
  try {
    // Basic validation first
    if (!signingSecret || !signature || !timestamp || !body) {
      return false
    }

    // Check if the timestamp is too old (> 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000)
    if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
      return false
    }

    // Compute the signature
    const encoder = new TextEncoder()
    const baseString = `v0:${timestamp}:${body}`

    // Create the HMAC with the signing secret
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(signingSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(baseString))

    // Convert the signature to hex
    const signatureHex = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // Prepare the expected signature format
    const computedSignature = `v0=${signatureHex}`

    // Constant-time comparison to prevent timing attacks
    if (computedSignature.length !== signature.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < computedSignature.length; i++) {
      result |= computedSignature.charCodeAt(i) ^ signature.charCodeAt(i)
    }

    return result === 0
  } catch (error) {
    console.error('Error validating Slack signature:', error)
    return false
  }
}


/**
 * Process WhatsApp message deduplication
 */
export async function processWhatsAppDeduplication(
  requestId: string,
  messages: any[]
): Promise<NextResponse | null> {
  if (messages.length > 0) {
    const message = messages[0]
    const messageId = message.id
    
    if (messageId) {
      const whatsappMsgKey = `whatsapp:msg:${messageId}`
      
      try {
        const isDuplicate = await hasProcessedMessage(whatsappMsgKey)
        if (isDuplicate) {
          logger.info(`[${requestId}] Duplicate WhatsApp message detected: ${messageId}`)
          return new NextResponse('Duplicate message', { status: 200 })
        }
        
        // Mark as processed BEFORE processing
        await markMessageAsProcessed(whatsappMsgKey, 60 * 60 * 24)
      } catch (error) {
        logger.error(`[${requestId}] Error in WhatsApp deduplication`, error)
        // Continue processing
      }
    }
  }
  
  return null
}

/**
 * Process generic deduplication using request hash
 */
export async function processGenericDeduplication(
  requestId: string,
  path: string,
  body: any
): Promise<NextResponse | null> {
  try {
    const requestHash = await generateRequestHash(path, body)
    const genericMsgKey = `generic:${requestHash}`
    
    const isDuplicate = await hasProcessedMessage(genericMsgKey)
    if (isDuplicate) {
      logger.info(`[${requestId}] Duplicate request detected with hash: ${requestHash}`)
      return new NextResponse('Duplicate request', { status: 200 })
    }
    
    // Mark as processed
    await markMessageAsProcessed(genericMsgKey, 60 * 60 * 24)
  } catch (error) {
    logger.error(`[${requestId}] Error in generic deduplication`, error)
    // Continue processing
  }
  
  return null
}

/**
 * Format webhook input based on provider
 */
export function formatWebhookInput(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: NextRequest
): any {
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
      
      return {
        whatsapp: {
          data: {
            messageId,
            from,
            phoneNumberId,
            text,
            timestamp,
            raw: message,
          }
        },
        webhook: {
          data: {
            provider: 'whatsapp',
            path: foundWebhook.path,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          }
        },
        workflowId: foundWorkflow.id
      }
    } else {
      return null
    }
  } else {
    // Generic format for Slack and other providers
    return {
      webhook: {
        data: {
          path: foundWebhook.path,
          provider: foundWebhook.provider,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        }
      },
      workflowId: foundWorkflow.id
    }
  }
}

/**
 * Execute workflow with the provided input
 */
export async function executeWorkflowFromPayload(
  foundWorkflow: any,
  input: any, 
  executionId: string,
  requestId: string
): Promise<void> {
  // Add log at the beginning of this function for clarity
  logger.info(`[${requestId}] Preparing to execute workflow`, {
    workflowId: foundWorkflow.id,
    executionId,
    triggerSource: 'webhook-payload',
  })
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

    logger.debug(`[${requestId}] Starting workflow execution`, {
      executionId,
      blockCount: Object.keys(processedBlockStates).length,
    })
    const executor = new Executor(
      serializedWorkflow,
      processedBlockStates,
      decryptedEnvVars,
      input, // Use the provided input (might be single event or batch)
      workflowVariables
    )
    const result = await executor.execute(foundWorkflow.id)

    logger.info(`[${requestId}] Workflow execution finished`, {
      executionId,
      success: result.success,
      durationMs: result.metadata?.duration,
    })

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
    logger.error(`[${requestId}] Error executing workflow`, {
      workflowId: foundWorkflow.id,
      executionId,
      error: error.message,
      stack: error.stack,
    })
    // Persist the error for this execution using the standard 'webhook' trigger type
    await persistExecutionError(foundWorkflow.id, executionId, error, 'webhook')
    // Re-throw the error so the caller (fetchAndProcessAirtablePayloads) knows it failed
    throw error
  }
}

/**
 * Process webhook provider-specific verification
 */
export function verifyProviderWebhook(
  foundWebhook: any,
  request: NextRequest,
  requestId: string
): NextResponse | null {
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
  
  return null
}

/**
 * Process Airtable payloads
 */
export async function fetchAndProcessAirtablePayloads(
  webhookData: any,
  workflowData: any,
  requestId: string // Original request ID from the ping, used for the final execution log
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
      return // Exit early
    }

    // --- Retrieve Stored Cursor from localProviderConfig ---
    const storedCursor = localProviderConfig.externalWebhookCursor

    // Initialize cursor in provider config if missing
    if (storedCursor === undefined || storedCursor === null) {
      // Update the local copy
      localProviderConfig.externalWebhookCursor = null

      // Add cursor to the database immediately to fix the configuration
      try {
        await db
          .update(webhook)
          .set({
            providerConfig: { ...localProviderConfig, externalWebhookCursor: null },
            updatedAt: new Date(),
          })
          .where(eq(webhook.id, webhookData.id))

        localProviderConfig.externalWebhookCursor = null // Update local copy too
      } catch (initError: any) {
        logger.error(`[${requestId}] Failed to initialize cursor in DB`, {
          webhookId: webhookData.id,
          error: initError.message,
          stack: initError.stack,
        })
        // Persist the error specifically for cursor initialization failure
        await persistExecutionError(
          workflowData.id,
          `${internalPollIdPrefix}-cursor-init-error`,
          initError,
          'webhook'
        )
      }
    }

    if (storedCursor && typeof storedCursor === 'number') {
      currentCursor = storedCursor
    } else {
      currentCursor = null // Airtable API defaults to 1 if omitted
    }

    // --- Get OAuth Token ---
    let accessToken: string | null = null
    try {
      accessToken = await getOAuthToken(workflowData.userId, 'airtable')
      if (!accessToken) {
        logger.error(
          `[${requestId}] Failed to obtain valid Airtable access token. Cannot proceed.`,
          { userId: workflowData.userId }
        )
        throw new Error('Airtable access token not found.')
      }

      logger.info(`[${requestId}] Successfully obtained Airtable access token`)
    } catch (tokenError: any) {
      logger.error(
        `[${requestId}] Failed to get Airtable OAuth token for user ${workflowData.userId}`,
        {
          error: tokenError.message,
          stack: tokenError.stack,
          userId: workflowData.userId,
        }
      )
      await persistExecutionError(
        workflowData.id,
        `${internalPollIdPrefix}-token-error`,
        tokenError,
        'webhook'
      )
      return // Exit early
    }

    const airtableApiBase = 'https://api.airtable.com/v0'

    // --- Polling Loop ---
    while (mightHaveMore) {
      apiCallCount++
      // Safety break
      if (apiCallCount > 10) {
        logger.warn(`[${requestId}] Reached maximum polling limit (10 calls)`, {
          webhookId: webhookData.id,
          consolidatedCount: consolidatedChangesMap.size,
        })
        mightHaveMore = false
        break
      }

      const apiUrl = `${airtableApiBase}/bases/${baseId}/webhooks/${airtableWebhookId}/payloads`
      const queryParams = new URLSearchParams()
      if (currentCursor !== null) {
        queryParams.set('cursor', currentCursor.toString())
      }
      const fullUrl = `${apiUrl}?${queryParams.toString()}`

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
            `[${requestId}] Airtable API request to /payloads failed (Call ${apiCallCount})`,
            { webhookId: webhookData.id, status: response.status, error: errorMessage }
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
          currentCursor = nextCursor
          // --- Add logging before and after DB update ---
          const updatedConfig = { ...localProviderConfig, externalWebhookCursor: currentCursor }
          try {
            // Force a complete object update to ensure consistency in serverless env
            await db
              .update(webhook)
              .set({
                providerConfig: updatedConfig, // Use full object
                updatedAt: new Date(),
              })
              .where(eq(webhook.id, webhookData.id))

            localProviderConfig.externalWebhookCursor = currentCursor // Update local copy too
          } catch (dbError: any) {
            logger.error(`[${requestId}] Failed to persist Airtable cursor to DB`, {
              webhookId: webhookData.id,
              cursor: currentCursor,
              error: dbError.message,
            })
            await persistExecutionError(
              workflowData.id,
              `${internalPollIdPrefix}-cursor-persist-error`,
              dbError,
              'webhook'
            )
            mightHaveMore = false
            throw new Error('Failed to save Airtable cursor, stopping processing.') // Re-throw to break loop clearly
          }
        } else if (!nextCursor || typeof nextCursor !== 'number') {
          logger.warn(`[${requestId}] Invalid or missing cursor received, stopping poll`, {
            webhookId: webhookData.id,
            apiCall: apiCallCount,
            receivedCursor: nextCursor,
          })
          mightHaveMore = false
        } else {
          mightHaveMore = false // Explicitly stop if cursor hasn't changed
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

    // --- Execute Workflow if we have changes (simplified - no lock check) ---
    if (finalConsolidatedChanges.length > 0) {
      try {
        // Format the input for the executor using the consolidated changes
        const input = { airtableChanges: finalConsolidatedChanges } // Use the consolidated array
        // Execute using the original requestId as the executionId
        await executeWorkflowFromPayload(workflowData, input, requestId, requestId)
      } catch (executionError: any) {
        // Errors logged within executeWorkflowFromPayload
        logger.error(
          `[${requestId}] Error during workflow execution triggered by Airtable polling`,
          executionError
        )
      }
    }
  } catch (error) {
    // Catch any unexpected errors during the setup/polling logic itself
    logger.error(
      `[${requestId}] Unexpected error during asynchronous Airtable payload processing task`,
      {
        webhookId: webhookData.id,
        workflowId: workflowData.id,
        error: (error as Error).message,
        stack: (error as Error).stack,
      }
    )
    // Persist this higher-level error
    await persistExecutionError(
      workflowData.id,
      `${internalPollIdPrefix}-processing-error`,
      error as Error,
      'webhook'
    )
  }
}

/**
 * Process webhook verification and authorization
 */
export async function processWebhook(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: NextRequest,
  executionId: string,
  requestId: string
): Promise<NextResponse> {
  try {
    // --- Provider-specific Auth/Verification (excluding Airtable/WhatsApp/Slack handled earlier) ---
    if (
      foundWebhook.provider &&
      !['airtable', 'whatsapp', 'slack'].includes(foundWebhook.provider)
    ) {
      const verificationResponse = verifyProviderWebhook(foundWebhook, request, requestId)
      if (verificationResponse) {
        return verificationResponse
      }
    }

    // --- Format Input based on provider (excluding Airtable) ---
    const input = formatWebhookInput(foundWebhook, foundWorkflow, body, request)
    
    if (!input && foundWebhook.provider === 'whatsapp') {
      return new NextResponse('No messages in WhatsApp payload', { status: 200 })
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

/**
 * Generate a hash for request deduplication
 */
export async function generateRequestHash(path: string, body: any): Promise<string> {
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

/**
 * Normalize the body for consistent hashing
 */
export function normalizeBody(body: any): any {
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

// Define an interface for AirtableChange
export interface AirtableChange {
  tableId: string
  recordId: string
  changeType: 'created' | 'updated'
  changedFields: Record<string, any> // { fieldId: newValue }
  previousFields?: Record<string, any> // { fieldId: previousValue } (optional)
}
