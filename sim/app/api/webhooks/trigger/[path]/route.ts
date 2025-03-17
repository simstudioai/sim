import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { persistExecutionError, persistExecutionLogs } from '@/lib/logs/execution-logger'
import { closeRedisConnection, hasProcessedMessage, markMessageAsProcessed } from '@/lib/redis'
import { decryptSecret } from '@/lib/utils'
import { mergeSubblockStateAsync } from '@/stores/workflows/utils'
import { db } from '@/db'
import { environment, webhook, workflow } from '@/db/schema'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'

const logger = createLogger('WebhookTriggerAPI')

// Force dynamic rendering for webhook endpoints
export const dynamic = 'force-dynamic'
// Increase the response size limit for webhook payloads
export const maxDuration = 300 // 5 minutes max execution time for long-running webhooks

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
  const executionId = uuidv4()
  let foundWorkflow: any = null

  try {
    const path = (await params).path

    // Parse the request body
    const body = await request.json().catch(() => ({}))
    logger.info(`[${requestId}] Webhook POST request received for path: ${path}`)

    // Generate a unique request ID based on the request content
    const requestHash = await generateRequestHash(path, body)

    // Check if this exact request has been processed before
    if (await hasProcessedMessage(requestHash)) {
      logger.info(`[${requestId}] Duplicate webhook request detected with hash: ${requestHash}`)
      // Return early for duplicate requests to prevent workflow execution
      return new NextResponse('Duplicate request', { status: 200 })
    }

    // Find the webhook in the database
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

    const { webhook: foundWebhook, workflow: workflowData } = webhooks[0]
    foundWorkflow = workflowData

    logger.info(`[${requestId}] Found webhook for path ${path}`, {
      webhookId: foundWebhook.id,
      provider: foundWebhook.provider,
      workflowId: foundWorkflow.id,
    })

    // For WhatsApp, also check for duplicate messages using their message ID
    if (foundWebhook.provider === 'whatsapp') {
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
    }

    return `request:${path}:${hash}`
  } catch (error) {
    // If hashing fails, use a UUID as fallback
    return `request:${path}:${uuidv4()}`
  }
}

/**
 * Normalize webhook body by removing fields that might change between identical requests
 * This helps with more accurate deduplication
 */
function normalizeBody(body: any): any {
  if (!body || typeof body !== 'object') return body

  // Create a copy to avoid modifying the original
  const result = Array.isArray(body) ? [...body] : { ...body }

  // Fields to remove (common timestamp/random fields)
  const fieldsToRemove = ['timestamp', 'random', 'nonce', 'requestId']

  if (Array.isArray(result)) {
    // Handle arrays
    return result.map((item) => normalizeBody(item))
  } else {
    // Handle objects
    for (const key in result) {
      if (fieldsToRemove.includes(key.toLowerCase())) {
        delete result[key]
      } else if (typeof result[key] === 'object' && result[key] !== null) {
        result[key] = normalizeBody(result[key])
      }
    }
    return result
  }
}

/**
 * Process a webhook synchronously
 */
async function processWebhook(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: NextRequest,
  executionId: string,
  requestId: string
): Promise<NextResponse> {
  try {
    // Handle provider-specific verification and authentication
    if (foundWebhook.provider && foundWebhook.provider !== 'whatsapp') {
      const authHeader = request.headers.get('authorization')
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

      switch (foundWebhook.provider) {
        case 'github':
          // GitHub doesn't require verification in this implementation
          break

        case 'stripe':
          // Stripe verification would go here if needed
          break

        default:
          // For generic webhooks, check for a token if provided in providerConfig
          if (providerConfig.token) {
            const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
            if (!providedToken || providedToken !== providerConfig.token) {
              logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
              return new NextResponse('Unauthorized', { status: 401 })
            }
          }
      }
    }

    // Format the input based on provider
    let input = {}

    if (foundWebhook.provider === 'whatsapp') {
      // Extract WhatsApp specific data
      const data = body?.entry?.[0]?.changes?.[0]?.value
      const messages = data?.messages || []

      if (messages.length > 0) {
        const message = messages[0]
        const phoneNumberId = data.metadata?.phone_number_id
        const from = message.from
        const messageId = message.id
        const timestamp = message.timestamp
        const text = message.text?.body

        logger.info(`[${requestId}] Processing WhatsApp message from ${from}`, {
          messageId,
          textPreview: text
            ? `${text.substring(0, 30)}${text.length > 30 ? '...' : ''}`
            : '[no text]',
        })

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
        }
      } else {
        return new NextResponse('OK', { status: 200 })
      }
    } else {
      // Generic format for other providers
      input = {
        webhook: {
          data: {
            path: foundWebhook.path,
            provider: foundWebhook.provider,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
      }
    }

    // Get the workflow state
    if (!foundWorkflow.state) {
      logger.error(`[${requestId}] Workflow ${foundWorkflow.id} has no state`)
      return new NextResponse('Workflow state not found', { status: 500 })
    }

    logger.info(
      `[${requestId}] Executing workflow ${foundWorkflow.id} for webhook ${foundWebhook.id}`
    )

    // Get the workflow state
    const state = foundWorkflow.state as any
    const { blocks, edges, loops } = state

    // Use the async version of mergeSubblockState to ensure all values are properly resolved
    logger.debug(`[${requestId}] Merging subblock states for workflow ${foundWorkflow.id}`)
    const mergedStates = await mergeSubblockStateAsync(blocks, foundWorkflow.id)

    // Retrieve environment variables for this user
    const [userEnv] = await db
      .select()
      .from(environment)
      .where(eq(environment.userId, foundWorkflow.userId))
      .limit(1)

    // Create a map of decrypted environment variables
    let decryptedEnvVars: Record<string, string> = {}
    if (userEnv) {
      const decryptionPromises = Object.entries(userEnv.variables as Record<string, string>).map(
        async ([key, encryptedValue]) => {
          try {
            const { decrypted } = await decryptSecret(encryptedValue)
            return [key, decrypted] as const
          } catch (error: any) {
            logger.error(`[${requestId}] Failed to decrypt environment variable "${key}"`, error)
            throw new Error(`Failed to decrypt environment variable "${key}": ${error.message}`)
          }
        }
      )

      const decryptedEntries = await Promise.all(decryptionPromises)
      decryptedEnvVars = Object.fromEntries(decryptedEntries)
    }

    // Process the block states to extract values from subBlocks
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

    // Serialize and execute the workflow
    const serializedWorkflow = new Serializer().serializeWorkflow(mergedStates as any, edges, loops)

    // Add workflowId to the input for OAuth credential resolution
    const enrichedInput = {
      ...input,
      workflowId: foundWorkflow.id,
    }

    // Process the block states to ensure response formats are properly parsed
    const processedBlockStates = Object.entries(currentBlockStates).reduce(
      (acc, [blockId, blockState]) => {
        // Create a copy of the block state to avoid modifying the original
        const processedState = { ...blockState }

        // Check if this block has a responseFormat that needs to be parsed
        if (processedState.responseFormat) {
          try {
            // If responseFormat is a string, parse it
            if (typeof processedState.responseFormat === 'string') {
              processedState.responseFormat = JSON.parse(processedState.responseFormat)
            }

            // Ensure the responseFormat is properly structured for OpenAI
            if (
              processedState.responseFormat &&
              typeof processedState.responseFormat === 'object'
            ) {
              // Make sure it has the required properties
              if (!processedState.responseFormat.schema && !processedState.responseFormat.name) {
                // If it's just a raw schema, wrap it properly
                processedState.responseFormat = {
                  name: 'response_schema',
                  schema: processedState.responseFormat,
                  strict: true,
                }
              }
            }

            acc[blockId] = processedState
          } catch (error) {
            logger.warn(`[${requestId}] Failed to parse responseFormat for block ${blockId}`, error)
            acc[blockId] = blockState
          }
        } else {
          acc[blockId] = blockState
        }
        return acc
      },
      {} as Record<string, Record<string, any>>
    )

    logger.debug(
      `[${requestId}] Starting workflow execution with ${Object.keys(processedBlockStates).length} blocks`
    )

    const executor = new Executor(
      serializedWorkflow,
      processedBlockStates,
      decryptedEnvVars,
      enrichedInput
    )
    const result = await executor.execute(foundWorkflow.id)

    logger.info(`[${requestId}] Successfully executed workflow ${foundWorkflow.id}`, {
      success: result.success,
      executionTime: result.metadata?.duration,
    })

    // Log each execution step and the final result
    await persistExecutionLogs(foundWorkflow.id, executionId, result, 'webhook')

    // Return the execution result
    return NextResponse.json(result, { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Error processing webhook`, error)

    // Log the error if we have a workflow ID
    if (foundWorkflow?.id) {
      await persistExecutionError(foundWorkflow.id, executionId, error, 'webhook')
    }

    return new NextResponse(`Internal Server Error: ${error.message}`, {
      status: 500,
    })
  }
}
