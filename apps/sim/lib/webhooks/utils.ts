import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { webhook } from '@/db/schema'

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
export function handleSlackChallenge(body: any): NextResponse | null {
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
    if (Math.abs(currentTime - Number.parseInt(timestamp)) > 300) {
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
        workflowId: foundWorkflow.id,
      }
    }
    return null
  }

  if (foundWebhook.provider === 'telegram') {
    // Telegram input formatting logic
    const message =
      body?.message || body?.edited_message || body?.channel_post || body?.edited_channel_post

    if (message) {
      // Extract message text with fallbacks for different content types
      let input = ''

      if (message.text) {
        input = message.text
      } else if (message.caption) {
        input = message.caption
      } else if (message.photo) {
        input = 'Photo message'
      } else if (message.document) {
        input = `Document: ${message.document.file_name || 'file'}`
      } else if (message.audio) {
        input = `Audio: ${message.audio.title || 'audio file'}`
      } else if (message.video) {
        input = 'Video message'
      } else if (message.voice) {
        input = 'Voice message'
      } else if (message.sticker) {
        input = `Sticker: ${message.sticker.emoji || '🎭'}`
      } else if (message.location) {
        input = 'Location shared'
      } else if (message.contact) {
        input = `Contact: ${message.contact.first_name || 'contact'}`
      } else if (message.poll) {
        input = `Poll: ${message.poll.question}`
      } else {
        input = 'Message received'
      }

      return {
        input, // Primary workflow input - the message content
        telegram: {
          message: {
            id: message.message_id,
            text: message.text,
            caption: message.caption,
            date: message.date,
            messageType: message.photo
              ? 'photo'
              : message.document
                ? 'document'
                : message.audio
                  ? 'audio'
                  : message.video
                    ? 'video'
                    : message.voice
                      ? 'voice'
                      : message.sticker
                        ? 'sticker'
                        : message.location
                          ? 'location'
                          : message.contact
                            ? 'contact'
                            : message.poll
                              ? 'poll'
                              : 'text',
            raw: message,
          },
          sender: message.from
            ? {
                id: message.from.id,
                firstName: message.from.first_name,
                lastName: message.from.last_name,
                username: message.from.username,
                languageCode: message.from.language_code,
                isBot: message.from.is_bot,
              }
            : null,
          chat: message.chat
            ? {
                id: message.chat.id,
                type: message.chat.type,
                title: message.chat.title,
                username: message.chat.username,
                firstName: message.chat.first_name,
                lastName: message.chat.last_name,
              }
            : null,
          updateId: body.update_id,
          updateType: body.message
            ? 'message'
            : body.edited_message
              ? 'edited_message'
              : body.channel_post
                ? 'channel_post'
                : body.edited_channel_post
                  ? 'edited_channel_post'
                  : 'unknown',
        },
        webhook: {
          data: {
            provider: 'telegram',
            path: foundWebhook.path,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
        workflowId: foundWorkflow.id,
      }
    }

    // Fallback for unknown Telegram update types
    logger.warn('Unknown Telegram update type', {
      updateId: body.update_id,
      bodyKeys: Object.keys(body || {}),
    })

    return {
      input: 'Telegram update received',
      telegram: {
        updateId: body.update_id,
        updateType: 'unknown',
        raw: body,
      },
      webhook: {
        data: {
          provider: 'telegram',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'gmail') {
    if (body && typeof body === 'object' && 'email' in body) {
      return body // { email: {...}, timestamp: ... }
    }
    return body
  }

  if (foundWebhook.provider === 'microsoftteams') {
    // Microsoft Teams outgoing webhook - Teams sending data to us
    const messageText = body?.text || ''
    const messageId = body?.id || ''
    const timestamp = body?.timestamp || body?.localTimestamp || ''
    const from = body?.from || {}
    const conversation = body?.conversation || {}

    return {
      input: messageText, // Primary workflow input - the message text
      microsoftteams: {
        message: {
          id: messageId,
          text: messageText,
          timestamp,
          type: body?.type || 'message',
          serviceUrl: body?.serviceUrl,
          channelId: body?.channelId,
          raw: body,
        },
        from: {
          id: from.id,
          name: from.name,
          aadObjectId: from.aadObjectId,
        },
        conversation: {
          id: conversation.id,
          name: conversation.name,
          conversationType: conversation.conversationType,
          tenantId: conversation.tenantId,
        },
        activity: {
          type: body?.type,
          id: body?.id,
          timestamp: body?.timestamp,
          localTimestamp: body?.localTimestamp,
          serviceUrl: body?.serviceUrl,
          channelId: body?.channelId,
        },
      },
      webhook: {
        data: {
          provider: 'microsoftteams',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

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
      },
    },
    workflowId: foundWorkflow.id,
  }
}

/**
 * Validates a Microsoft Teams outgoing webhook request signature using HMAC SHA-256
 * @param hmacSecret - Microsoft Teams HMAC secret (base64 encoded)
 * @param signature - Authorization header value (should start with 'HMAC ')
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */
export function validateMicrosoftTeamsSignature(
  hmacSecret: string,
  signature: string,
  body: string
): boolean {
  try {
    // Basic validation first
    if (!hmacSecret || !signature || !body) {
      return false
    }

    // Check if signature has correct format
    if (!signature.startsWith('HMAC ')) {
      return false
    }

    const providedSignature = signature.substring(5) // Remove 'HMAC ' prefix

    // Compute HMAC SHA256 signature using Node.js crypto
    const crypto = require('crypto')
    const secretBytes = Buffer.from(hmacSecret, 'base64')
    const bodyBytes = Buffer.from(body, 'utf8')
    const computedHash = crypto.createHmac('sha256', secretBytes).update(bodyBytes).digest('base64')

    // Constant-time comparison to prevent timing attacks
    if (computedHash.length !== providedSignature.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < computedHash.length; i++) {
      result |= computedHash.charCodeAt(i) ^ providedSignature.charCodeAt(i)
    }

    return result === 0
  } catch (error) {
    console.error('Error validating Microsoft Teams signature:', error)
    return false
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
    case 'gmail':
      if (providerConfig.secret) {
        const secretHeader = request.headers.get('X-Webhook-Secret')
        if (!secretHeader || secretHeader.length !== providerConfig.secret.length) {
          logger.warn(`[${requestId}] Invalid Gmail webhook secret`)
          return new NextResponse('Unauthorized', { status: 401 })
        }
        let result = 0
        for (let i = 0; i < secretHeader.length; i++) {
          result |= secretHeader.charCodeAt(i) ^ providerConfig.secret.charCodeAt(i)
        }
        if (result !== 0) {
          logger.warn(`[${requestId}] Invalid Gmail webhook secret`)
          return new NextResponse('Unauthorized', { status: 401 })
        }
      }
      break
    case 'telegram': {
      // Check User-Agent to ensure it's not blocked by middleware
      // Log the user agent for debugging purposes
      const userAgent = request.headers.get('user-agent') || ''
      logger.debug(`[${requestId}] Telegram webhook request received with User-Agent: ${userAgent}`)

      // Check if the user agent is empty and warn about it
      if (!userAgent) {
        logger.warn(
          `[${requestId}] Telegram webhook request has empty User-Agent header. This may be blocked by middleware.`
        )
      }

      // We'll accept the request anyway since we're in the provider-specific logic,
      // but we'll log the information for debugging

      // Telegram uses IP addresses in specific ranges
      // This is optional verification that could be added if IP verification is needed
      const clientIp =
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        request.headers.get('x-real-ip') ||
        'unknown'

      logger.debug(`[${requestId}] Telegram webhook request from IP: ${clientIp}`)

      break
    }
    case 'microsoftteams':
      // Microsoft Teams webhook authentication is handled separately in the main flow
      // due to the need for raw body access for HMAC verification
      break
    case 'generic':
      // Generic auth logic: requireAuth, token, secretHeaderName, allowedIps
      if (providerConfig.requireAuth) {
        let isAuthenticated = false
        // Check for token in Authorization header (Bearer token)
        if (providerConfig.token) {
          const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
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
          return new NextResponse('Forbidden - IP not allowed', {
            status: 403,
          })
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
  // Logging handles all error logging
  let currentCursor: number | null = null
  let mightHaveMore = true
  let payloadsFetched = 0 // Track total payloads fetched
  let apiCallCount = 0
  // Use a Map to consolidate changes per record ID
  const consolidatedChangesMap = new Map<string, AirtableChange>()
  const localProviderConfig = {
    ...((webhookData.providerConfig as Record<string, any>) || {}),
  } // Local copy

  // DEBUG: Log start of function execution with critical info
  logger.debug(`[${requestId}] TRACE: fetchAndProcessAirtablePayloads started`, {
    webhookId: webhookData.id,
    workflowId: workflowData.id,
    hasBaseId: !!localProviderConfig.baseId,
    hasExternalId: !!localProviderConfig.externalId,
  })

  try {
    // --- Essential IDs & Config from localProviderConfig ---
    const baseId = localProviderConfig.baseId
    const airtableWebhookId = localProviderConfig.externalId

    if (!baseId || !airtableWebhookId) {
      logger.error(
        `[${requestId}] Missing baseId or externalId in providerConfig for webhook ${webhookData.id}. Cannot fetch payloads.`
      )
      // Error logging handled by logging session
      return // Exit early
    }

    // --- Retrieve Stored Cursor from localProviderConfig ---
    const storedCursor = localProviderConfig.externalWebhookCursor

    // Initialize cursor in provider config if missing
    if (storedCursor === undefined || storedCursor === null) {
      logger.info(
        `[${requestId}] No cursor found in providerConfig for webhook ${webhookData.id}, initializing...`
      )
      // Update the local copy
      localProviderConfig.externalWebhookCursor = null

      // Add cursor to the database immediately to fix the configuration
      try {
        await db
          .update(webhook)
          .set({
            providerConfig: {
              ...localProviderConfig,
              externalWebhookCursor: null,
            },
            updatedAt: new Date(),
          })
          .where(eq(webhook.id, webhookData.id))

        localProviderConfig.externalWebhookCursor = null // Update local copy too
        logger.info(`[${requestId}] Successfully initialized cursor for webhook ${webhookData.id}`)
      } catch (initError: any) {
        logger.error(`[${requestId}] Failed to initialize cursor in DB`, {
          webhookId: webhookData.id,
          error: initError.message,
          stack: initError.stack,
        })
        // Error logging handled by logging session
      }
    }

    if (storedCursor && typeof storedCursor === 'number') {
      currentCursor = storedCursor
      logger.debug(
        `[${requestId}] Using stored cursor: ${currentCursor} for webhook ${webhookData.id}`
      )
    } else {
      currentCursor = null // Airtable API defaults to 1 if omitted
      logger.debug(
        `[${requestId}] No valid stored cursor for webhook ${webhookData.id}, starting from beginning`
      )
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
      // Error logging handled by logging session
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

      logger.debug(`[${requestId}] Fetching Airtable payloads (call ${apiCallCount})`, {
        url: fullUrl,
        webhookId: webhookData.id,
      })

      try {
        const fetchStartTime = Date.now()
        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })

        // DEBUG: Log API response time
        logger.debug(`[${requestId}] TRACE: Airtable API response received`, {
          status: response.status,
          duration: `${Date.now() - fetchStartTime}ms`,
          hasBody: true,
          apiCall: apiCallCount,
        })

        const responseBody = await response.json()

        if (!response.ok || responseBody.error) {
          const errorMessage =
            responseBody.error?.message ||
            responseBody.error ||
            `Airtable API error Status ${response.status}`
          logger.error(
            `[${requestId}] Airtable API request to /payloads failed (Call ${apiCallCount})`,
            {
              webhookId: webhookData.id,
              status: response.status,
              error: errorMessage,
            }
          )
          // Error logging handled by logging session
          mightHaveMore = false
          break
        }

        const receivedPayloads = responseBody.payloads || []
        logger.debug(
          `[${requestId}] Received ${receivedPayloads.length} payloads from Airtable (call ${apiCallCount})`
        )

        // --- Process and Consolidate Changes ---
        if (receivedPayloads.length > 0) {
          payloadsFetched += receivedPayloads.length
          let changeCount = 0
          for (const payload of receivedPayloads) {
            if (payload.changedTablesById) {
              // DEBUG: Log tables being processed
              const tableIds = Object.keys(payload.changedTablesById)
              logger.debug(`[${requestId}] TRACE: Processing changes for tables`, {
                tables: tableIds,
                payloadTimestamp: payload.timestamp,
              })

              for (const [tableId, tableChangesUntyped] of Object.entries(
                payload.changedTablesById
              )) {
                const tableChanges = tableChangesUntyped as any // Assert type

                // Handle created records
                if (tableChanges.createdRecordsById) {
                  const createdCount = Object.keys(tableChanges.createdRecordsById).length
                  changeCount += createdCount
                  // DEBUG: Log created records count
                  logger.debug(
                    `[${requestId}] TRACE: Processing ${createdCount} created records for table ${tableId}`
                  )

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
                  const updatedCount = Object.keys(tableChanges.changedRecordsById).length
                  changeCount += updatedCount
                  // DEBUG: Log updated records count
                  logger.debug(
                    `[${requestId}] TRACE: Processing ${updatedCount} updated records for table ${tableId}`
                  )

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

          // DEBUG: Log totals for this batch
          logger.debug(
            `[${requestId}] TRACE: Processed ${changeCount} changes in API call ${apiCallCount}`,
            {
              currentMapSize: consolidatedChangesMap.size,
            }
          )
        }

        const nextCursor = responseBody.cursor
        mightHaveMore = responseBody.mightHaveMore || false

        if (nextCursor && typeof nextCursor === 'number' && nextCursor !== currentCursor) {
          logger.debug(`[${requestId}] Updating cursor from ${currentCursor} to ${nextCursor}`)
          currentCursor = nextCursor

          // Follow exactly the old implementation - use awaited update instead of parallel
          const updatedConfig = {
            ...localProviderConfig,
            externalWebhookCursor: currentCursor,
          }
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
            // Error logging handled by logging session
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
        } else if (nextCursor === currentCursor) {
          logger.debug(`[${requestId}] Cursor hasn't changed (${currentCursor}), stopping poll`)
          mightHaveMore = false // Explicitly stop if cursor hasn't changed
        }
      } catch (fetchError: any) {
        logger.error(
          `[${requestId}] Network error calling Airtable GET /payloads (Call ${apiCallCount}) for webhook ${webhookData.id}`,
          fetchError
        )
        // Error logging handled by logging session
        mightHaveMore = false
        break
      }
    }
    // --- End Polling Loop ---

    // Convert map values to array for final processing
    const finalConsolidatedChanges = Array.from(consolidatedChangesMap.values())
    logger.info(
      `[${requestId}] Consolidated ${finalConsolidatedChanges.length} Airtable changes across ${apiCallCount} API calls`
    )

    // --- Execute Workflow if we have changes (simplified - no lock check) ---
    if (finalConsolidatedChanges.length > 0) {
      try {
        // Format the input for the executor using the consolidated changes
        const input = { airtableChanges: finalConsolidatedChanges } // Use the consolidated array

        // CRITICAL EXECUTION TRACE POINT
        logger.info(
          `[${requestId}] CRITICAL_TRACE: Beginning workflow execution with ${finalConsolidatedChanges.length} Airtable changes`,
          {
            workflowId: workflowData.id,
            recordCount: finalConsolidatedChanges.length,
            timestamp: new Date().toISOString(),
            firstRecordId: finalConsolidatedChanges[0]?.recordId || 'none',
          }
        )

        // Return the processed input for the trigger.dev task to handle
        logger.info(`[${requestId}] CRITICAL_TRACE: Airtable changes processed, returning input`, {
          workflowId: workflowData.id,
          recordCount: finalConsolidatedChanges.length,
          timestamp: new Date().toISOString(),
        })

        return input
      } catch (processingError: any) {
        logger.error(`[${requestId}] CRITICAL_TRACE: Error processing Airtable changes`, {
          workflowId: workflowData.id,
          error: processingError.message,
          stack: processingError.stack,
          timestamp: new Date().toISOString(),
        })

        throw processingError
      }
    } else {
      // DEBUG: Log when no changes are found
      logger.info(`[${requestId}] TRACE: No Airtable changes to process`, {
        workflowId: workflowData.id,
        apiCallCount,
        webhookId: webhookData.id,
      })
    }
  } catch (error) {
    // Catch any unexpected errors during the setup/polling logic itself
    logger.error(
      `[${requestId}] Unexpected error during asynchronous Airtable payload processing task`,
      {
        webhookId: webhookData.id,
        workflowId: workflowData.id,
        error: (error as Error).message,
      }
    )
    // Error logging handled by logging session
  }

  // DEBUG: Log function completion
  logger.debug(`[${requestId}] TRACE: fetchAndProcessAirtablePayloads completed`, {
    totalFetched: payloadsFetched,
    totalApiCalls: apiCallCount,
    totalChanges: consolidatedChangesMap.size,
    timestamp: new Date().toISOString(),
  })
}

// Define an interface for AirtableChange
export interface AirtableChange {
  tableId: string
  recordId: string
  changeType: 'created' | 'updated'
  changedFields: Record<string, any> // { fieldId: newValue }
  previousFields?: Record<string, any> // { fieldId: previousValue } (optional)
}

/**
 * Configure Gmail polling for a webhook
 */
export async function configureGmailPolling(
  userId: string,
  webhookData: any,
  requestId: string
): Promise<boolean> {
  const logger = createLogger('GmailWebhookSetup')
  logger.info(`[${requestId}] Setting up Gmail polling for webhook ${webhookData.id}`)

  try {
    const accessToken = await getOAuthToken(userId, 'google-email')
    if (!accessToken) {
      logger.error(`[${requestId}] Failed to retrieve Gmail access token for user ${userId}`)
      return false
    }

    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}

    const maxEmailsPerPoll =
      typeof providerConfig.maxEmailsPerPoll === 'string'
        ? Number.parseInt(providerConfig.maxEmailsPerPoll, 10) || 25
        : providerConfig.maxEmailsPerPoll || 25

    const pollingInterval =
      typeof providerConfig.pollingInterval === 'string'
        ? Number.parseInt(providerConfig.pollingInterval, 10) || 5
        : providerConfig.pollingInterval || 5

    const now = new Date()

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerConfig,
          userId, // Store user ID for OAuth access during polling
          maxEmailsPerPoll,
          pollingInterval,
          markAsRead: providerConfig.markAsRead || false,
          includeRawEmail: providerConfig.includeRawEmail || false,
          labelIds: providerConfig.labelIds || ['INBOX'],
          labelFilterBehavior: providerConfig.labelFilterBehavior || 'INCLUDE',
          lastCheckedTimestamp: now.toISOString(),
          setupCompleted: true,
        },
        updatedAt: now,
      })
      .where(eq(webhook.id, webhookData.id))

    logger.info(
      `[${requestId}] Successfully configured Gmail polling for webhook ${webhookData.id}`
    )
    return true
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to configure Gmail polling`, {
      webhookId: webhookData.id,
      error: error.message,
      stack: error.stack,
    })
    return false
  }
}

/**
 * Configure Outlook polling for a webhook
 */
export async function configureOutlookPolling(
  userId: string,
  webhookData: any,
  requestId: string
): Promise<boolean> {
  const logger = createLogger('OutlookWebhookSetup')
  logger.info(`[${requestId}] Setting up Outlook polling for webhook ${webhookData.id}`)
  logger.info(`[${requestId}] Setting up Outlook polling for webhook ${webhookData.id}`)

  try {
    const accessToken = await getOAuthToken(userId, 'outlook')
    if (!accessToken) {
      logger.error(`[${requestId}] Failed to retrieve Outlook access token for user ${userId}`)
      return false
    }

    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}

    const maxEmailsPerPoll =
      typeof providerConfig.maxEmailsPerPoll === 'string'
        ? Number.parseInt(providerConfig.maxEmailsPerPoll, 10) || 25
        : providerConfig.maxEmailsPerPoll || 25

    const pollingInterval =
      typeof providerConfig.pollingInterval === 'string'
        ? Number.parseInt(providerConfig.pollingInterval, 10) || 5
        : providerConfig.pollingInterval || 5

    const now = new Date()

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerConfig,
          userId, // Store user ID for OAuth access during polling
          maxEmailsPerPoll,
          pollingInterval,
          markAsRead: providerConfig.markAsRead || false,
          includeRawEmail: providerConfig.includeRawEmail || false,
          folderIds: providerConfig.folderIds || ['inbox'],
          folderFilterBehavior: providerConfig.folderFilterBehavior || 'INCLUDE',
          lastCheckedTimestamp: now.toISOString(),
          setupCompleted: true,
        },
        updatedAt: now,
      })
      .where(eq(webhook.id, webhookData.id))

    logger.info(
      `[${requestId}] Successfully configured Outlook polling for webhook ${webhookData.id}`
    )
    return true
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to configure Outlook polling`, {
      webhookId: webhookData.id,
      error: error.message,
      stack: error.stack,
    })
    return false
  }
}
