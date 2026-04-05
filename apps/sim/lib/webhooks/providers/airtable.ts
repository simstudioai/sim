import { db } from '@sim/db'
import { account, webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { FormatInputContext, WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { refreshAccessTokenIfNeeded, resolveOAuthAccountId } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebhookProvider:Airtable')

interface AirtableChange {
  tableId: string
  recordId: string
  changeType: 'created' | 'updated'
  changedFields: Record<string, any> // { fieldId: newValue }
  previousFields?: Record<string, any> // { fieldId: previousValue } (optional)
}

/**
 * Process Airtable payloads
 */
async function fetchAndProcessAirtablePayloads(
  webhookData: any,
  workflowData: any,
  requestId: string // Original request ID from the ping, used for the final execution log
) {
  // Logging handles all error logging
  let currentCursor: number | null = null
  let mightHaveMore = true
  let payloadsFetched = 0
  let apiCallCount = 0
  // Use a Map to consolidate changes per record ID
  const consolidatedChangesMap = new Map<string, AirtableChange>()
  // Capture raw payloads from Airtable for exposure to workflows
  const allPayloads = []
  const localProviderConfig = {
    ...((webhookData.providerConfig as Record<string, any>) || {}),
  }

  try {
    // --- Essential IDs & Config from localProviderConfig ---
    const baseId = localProviderConfig.baseId
    const airtableWebhookId = localProviderConfig.externalId

    if (!baseId || !airtableWebhookId) {
      logger.error(
        `[${requestId}] Missing baseId or externalId in providerConfig for webhook ${webhookData.id}. Cannot fetch payloads.`
      )
      return
    }

    const credentialId: string | undefined = localProviderConfig.credentialId
    if (!credentialId) {
      logger.error(
        `[${requestId}] Missing credentialId in providerConfig for Airtable webhook ${webhookData.id}.`
      )
      return
    }

    const resolvedAirtable = await resolveOAuthAccountId(credentialId)
    if (!resolvedAirtable) {
      logger.error(
        `[${requestId}] Could not resolve credential ${credentialId} for Airtable webhook`
      )
      return
    }

    let ownerUserId: string | null = null
    try {
      const rows = await db
        .select()
        .from(account)
        .where(eq(account.id, resolvedAirtable.accountId))
        .limit(1)
      ownerUserId = rows.length ? rows[0].userId : null
    } catch (_e) {
      ownerUserId = null
    }

    if (!ownerUserId) {
      logger.error(
        `[${requestId}] Could not resolve owner for Airtable credential ${credentialId} on webhook ${webhookData.id}`
      )
      return
    }

    const storedCursor = localProviderConfig.externalWebhookCursor

    if (storedCursor === undefined || storedCursor === null) {
      logger.info(
        `[${requestId}] No cursor found in providerConfig for webhook ${webhookData.id}, initializing...`
      )
      localProviderConfig.externalWebhookCursor = null

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

        localProviderConfig.externalWebhookCursor = null
        logger.info(`[${requestId}] Successfully initialized cursor for webhook ${webhookData.id}`)
      } catch (initError: any) {
        logger.error(`[${requestId}] Failed to initialize cursor in DB`, {
          webhookId: webhookData.id,
          error: initError.message,
          stack: initError.stack,
        })
      }
    }

    if (storedCursor && typeof storedCursor === 'number') {
      currentCursor = storedCursor
    } else {
      currentCursor = null
    }

    let accessToken: string | null = null
    try {
      accessToken = await refreshAccessTokenIfNeeded(
        resolvedAirtable.accountId,
        ownerUserId,
        requestId
      )
      if (!accessToken) {
        logger.error(
          `[${requestId}] Failed to obtain valid Airtable access token via credential ${credentialId}.`
        )
        throw new Error('Airtable access token not found.')
      }
    } catch (tokenError: any) {
      logger.error(
        `[${requestId}] Failed to get Airtable OAuth token for credential ${credentialId}`,
        {
          error: tokenError.message,
          stack: tokenError.stack,
          credentialId,
        }
      )
      return
    }

    const airtableApiBase = 'https://api.airtable.com/v0'

    // --- Polling Loop ---
    while (mightHaveMore) {
      apiCallCount++
      // Safety break
      if (apiCallCount > 10) {
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
        const fetchStartTime = Date.now()
        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
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

        // --- Process and Consolidate Changes ---
        if (receivedPayloads.length > 0) {
          payloadsFetched += receivedPayloads.length
          // Keep the raw payloads for later exposure to the workflow
          for (const p of receivedPayloads) {
            allPayloads.push(p)
          }
          let changeCount = 0
          for (const payload of receivedPayloads) {
            if (payload.changedTablesById) {
              for (const [tableId, tableChangesUntyped] of Object.entries(
                payload.changedTablesById
              )) {
                const tableChanges = tableChangesUntyped as any // Assert type

                // Handle created records
                if (tableChanges.createdRecordsById) {
                  const createdCount = Object.keys(tableChanges.createdRecordsById).length
                  changeCount += createdCount

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
    if (finalConsolidatedChanges.length > 0 || allPayloads.length > 0) {
      try {
        // Build input exposing raw payloads and consolidated changes
        const latestPayload = allPayloads.length > 0 ? allPayloads[allPayloads.length - 1] : null
        const input: any = {
          // Raw Airtable payloads as received from the API
          payloads: allPayloads,
          latestPayload,
          // Consolidated, simplified changes for convenience
          airtableChanges: finalConsolidatedChanges,
          // Include webhook metadata for resolver fallbacks
          webhook: {
            data: {
              provider: 'airtable',
              providerConfig: webhookData.providerConfig,
              payload: latestPayload,
            },
          },
        }

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
          rawPayloadCount: allPayloads.length,
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
}

export const airtableHandler: WebhookProviderHandler = {
  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    if (typeof obj.cursor === 'string') {
      return obj.cursor
    }
    return null
  },

  async formatInput({ webhook, workflow, requestId }: FormatInputContext) {
    logger.info(`[${requestId}] Processing Airtable webhook via fetchAndProcessAirtablePayloads`)

    const webhookData = {
      id: webhook.id,
      provider: webhook.provider,
      providerConfig: webhook.providerConfig,
    }

    const mockWorkflow = {
      id: workflow.id,
      userId: workflow.userId,
    }

    const airtableInput = await fetchAndProcessAirtablePayloads(
      webhookData,
      mockWorkflow,
      requestId
    )

    if (airtableInput) {
      logger.info(`[${requestId}] Executing workflow with Airtable changes`)
      return { input: airtableInput }
    }

    logger.info(`[${requestId}] No Airtable changes to process`)
    return { input: null, skip: { message: 'No Airtable changes to process' } }
  },
}
