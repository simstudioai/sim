import { db } from '@sim/db'
import { account, webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { validateAirtableId } from '@/lib/core/security/input-validation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  getCredentialOwner,
  getNotificationUrl,
  getProviderConfig,
} from '@/lib/webhooks/providers/subscription-utils'
import type {
  DeleteSubscriptionContext,
  FormatInputContext,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import {
  getOAuthToken,
  refreshAccessTokenIfNeeded,
  resolveOAuthAccountId,
} from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebhookProvider:Airtable')

interface AirtableChange {
  tableId: string
  recordId: string
  changeType: 'created' | 'updated'
  changedFields: Record<string, unknown>
  previousFields?: Record<string, unknown>
}

interface AirtableTableChanges {
  createdRecordsById?: Record<string, { cellValuesByFieldId?: Record<string, unknown> }>
  changedRecordsById?: Record<
    string,
    {
      current?: { cellValuesByFieldId?: Record<string, unknown> }
      previous?: { cellValuesByFieldId?: Record<string, unknown> }
    }
  >
  destroyedRecordIds?: string[]
}

/**
 * Process Airtable payloads
 */
async function fetchAndProcessAirtablePayloads(
  webhookData: Record<string, unknown>,
  workflowData: Record<string, unknown>,
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
    ...((webhookData.providerConfig as Record<string, unknown>) || {}),
  } as Record<string, unknown>

  try {
    const baseId = localProviderConfig.baseId
    const airtableWebhookId = localProviderConfig.externalId

    if (!baseId || !airtableWebhookId) {
      logger.error(
        `[${requestId}] Missing baseId or externalId in providerConfig for webhook ${webhookData.id}. Cannot fetch payloads.`
      )
      return
    }

    const credentialId = localProviderConfig.credentialId as string | undefined
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
          .where(eq(webhook.id, webhookData.id as string))

        localProviderConfig.externalWebhookCursor = null
        logger.info(`[${requestId}] Successfully initialized cursor for webhook ${webhookData.id}`)
      } catch (initError: unknown) {
        const err = initError as Error
        logger.error(`[${requestId}] Failed to initialize cursor in DB`, {
          webhookId: webhookData.id,
          error: err.message,
          stack: err.stack,
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
    } catch (tokenError: unknown) {
      const err = tokenError as Error
      logger.error(
        `[${requestId}] Failed to get Airtable OAuth token for credential ${credentialId}`,
        {
          error: err.message,
          stack: err.stack,
          credentialId,
        }
      )
      return
    }

    const airtableApiBase = 'https://api.airtable.com/v0'

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
                const tableChanges = tableChangesUntyped as AirtableTableChanges

                if (tableChanges.createdRecordsById) {
                  const createdCount = Object.keys(tableChanges.createdRecordsById).length
                  changeCount += createdCount

                  for (const [recordId, recordData] of Object.entries(
                    tableChanges.createdRecordsById
                  )) {
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

                  for (const [recordId, recordData] of Object.entries(
                    tableChanges.changedRecordsById
                  )) {
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
              .where(eq(webhook.id, webhookData.id as string))

            localProviderConfig.externalWebhookCursor = currentCursor // Update local copy too
          } catch (dbError: unknown) {
            const err = dbError as Error
            logger.error(`[${requestId}] Failed to persist Airtable cursor to DB`, {
              webhookId: webhookData.id,
              cursor: currentCursor,
              error: err.message,
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
      } catch (fetchError: unknown) {
        logger.error(
          `[${requestId}] Network error calling Airtable GET /payloads (Call ${apiCallCount}) for webhook ${webhookData.id}`,
          fetchError
        )
        // Error logging handled by logging session
        mightHaveMore = false
        break
      }
    }
    // Convert map values to array for final processing
    const finalConsolidatedChanges = Array.from(consolidatedChangesMap.values())
    logger.info(
      `[${requestId}] Consolidated ${finalConsolidatedChanges.length} Airtable changes across ${apiCallCount} API calls`
    )

    if (finalConsolidatedChanges.length > 0 || allPayloads.length > 0) {
      try {
        // Build input exposing raw payloads and consolidated changes
        const latestPayload = allPayloads.length > 0 ? allPayloads[allPayloads.length - 1] : null
        const input: Record<string, unknown> = {
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
      } catch (processingError: unknown) {
        const err = processingError as Error
        logger.error(`[${requestId}] CRITICAL_TRACE: Error processing Airtable changes`, {
          workflowId: workflowData.id,
          error: err.message,
          stack: err.stack,
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
  async createSubscription({
    webhook: webhookRecord,
    workflow,
    userId,
    requestId,
  }: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    try {
      const { path, providerConfig } = webhookRecord as Record<string, unknown>
      const config = (providerConfig as Record<string, unknown>) || {}
      const { baseId, tableId, includeCellValuesInFieldIds, credentialId } = config as {
        baseId?: string
        tableId?: string
        includeCellValuesInFieldIds?: string
        credentialId?: string
      }

      if (!baseId || !tableId) {
        logger.warn(`[${requestId}] Missing baseId or tableId for Airtable webhook creation.`, {
          webhookId: webhookRecord.id,
        })
        throw new Error(
          'Base ID and Table ID are required to create Airtable webhook. Please provide valid Airtable base and table IDs.'
        )
      }

      const baseIdValidation = validateAirtableId(baseId, 'app', 'baseId')
      if (!baseIdValidation.isValid) {
        throw new Error(baseIdValidation.error)
      }

      const tableIdValidation = validateAirtableId(tableId, 'tbl', 'tableId')
      if (!tableIdValidation.isValid) {
        throw new Error(tableIdValidation.error)
      }

      const credentialOwner = credentialId
        ? await getCredentialOwner(credentialId, requestId)
        : null
      const accessToken = credentialId
        ? credentialOwner
          ? await refreshAccessTokenIfNeeded(
              credentialOwner.accountId,
              credentialOwner.userId,
              requestId
            )
          : null
        : await getOAuthToken(userId, 'airtable')
      if (!accessToken) {
        logger.warn(
          `[${requestId}] Could not retrieve Airtable access token for user ${userId}. Cannot create webhook in Airtable.`
        )
        throw new Error(
          'Airtable account connection required. Please connect your Airtable account in the trigger configuration and try again.'
        )
      }

      const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`

      const airtableApiUrl = `https://api.airtable.com/v0/bases/${baseId}/webhooks`

      const specification: Record<string, unknown> = {
        options: {
          filters: {
            dataTypes: ['tableData'],
            recordChangeScope: tableId,
          },
        },
      }

      if (includeCellValuesInFieldIds === 'all') {
        ;(specification.options as Record<string, unknown>).includes = {
          includeCellValuesInFieldIds: 'all',
        }
      }

      const requestBody: Record<string, unknown> = {
        notificationUrl: notificationUrl,
        specification: specification,
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
          `[${requestId}] Failed to create webhook in Airtable for webhook ${webhookRecord.id}. Status: ${airtableResponse.status}`,
          { type: errorType, message: errorMessage, response: responseBody }
        )

        let userFriendlyMessage = 'Failed to create webhook subscription in Airtable'
        if (airtableResponse.status === 404) {
          userFriendlyMessage =
            'Airtable base or table not found. Please verify that the Base ID and Table ID are correct and that you have access to them.'
        } else if (errorMessage && errorMessage !== 'Unknown Airtable API error') {
          userFriendlyMessage = `Airtable error: ${errorMessage}`
        }

        throw new Error(userFriendlyMessage)
      }
      logger.info(
        `[${requestId}] Successfully created webhook in Airtable for webhook ${webhookRecord.id}.`,
        {
          airtableWebhookId: responseBody.id,
        }
      )
      return { providerConfigUpdates: { externalId: responseBody.id } }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(
        `[${requestId}] Exception during Airtable webhook creation for webhook ${webhookRecord.id}.`,
        {
          message: err.message,
          stack: err.stack,
        }
      )
      throw error
    }
  },

  async deleteSubscription({
    webhook: webhookRecord,
    workflow,
    requestId,
  }: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(webhookRecord)
      const { baseId, externalId } = config as {
        baseId?: string
        externalId?: string
      }

      if (!baseId) {
        logger.warn(`[${requestId}] Missing baseId for Airtable webhook deletion`, {
          webhookId: webhookRecord.id,
        })
        return
      }

      const baseIdValidation = validateAirtableId(baseId, 'app', 'baseId')
      if (!baseIdValidation.isValid) {
        logger.warn(`[${requestId}] Invalid Airtable base ID format, skipping deletion`, {
          webhookId: webhookRecord.id,
          baseId: baseId.substring(0, 20),
        })
        return
      }

      const credentialId = config.credentialId as string | undefined
      if (!credentialId) {
        logger.warn(
          `[${requestId}] Missing credentialId for Airtable webhook deletion ${webhookRecord.id}`
        )
        return
      }

      const credentialOwner = await getCredentialOwner(credentialId, requestId)
      const accessToken = credentialOwner
        ? await refreshAccessTokenIfNeeded(
            credentialOwner.accountId,
            credentialOwner.userId,
            requestId
          )
        : null
      if (!accessToken) {
        logger.warn(
          `[${requestId}] Could not retrieve Airtable access token. Cannot delete webhook in Airtable.`,
          { webhookId: webhookRecord.id }
        )
        return
      }

      let resolvedExternalId: string | undefined = externalId

      if (!resolvedExternalId) {
        try {
          const expectedNotificationUrl = getNotificationUrl(webhookRecord)

          const listUrl = `https://api.airtable.com/v0/bases/${baseId}/webhooks`
          const listResp = await fetch(listUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          })
          const listBody = await listResp.json().catch(() => null)

          if (listResp.ok && listBody && Array.isArray(listBody.webhooks)) {
            const match = listBody.webhooks.find((w: Record<string, unknown>) => {
              const url: string | undefined = w?.notificationUrl as string | undefined
              if (!url) return false
              return (
                url === expectedNotificationUrl ||
                url.endsWith(`/api/webhooks/trigger/${webhookRecord.path}`)
              )
            })
            if (match?.id) {
              resolvedExternalId = match.id as string
              logger.info(`[${requestId}] Resolved Airtable externalId by listing webhooks`, {
                baseId,
                externalId: resolvedExternalId,
              })
            } else {
              logger.warn(`[${requestId}] Could not resolve Airtable externalId from list`, {
                baseId,
                expectedNotificationUrl,
              })
            }
          } else {
            logger.warn(`[${requestId}] Failed to list Airtable webhooks to resolve externalId`, {
              baseId,
              status: listResp.status,
              body: listBody,
            })
          }
        } catch (e: unknown) {
          logger.warn(`[${requestId}] Error attempting to resolve Airtable externalId`, {
            error: (e as Error)?.message,
          })
        }
      }

      if (!resolvedExternalId) {
        logger.info(`[${requestId}] Airtable externalId not found; skipping remote deletion`, {
          baseId,
        })
        return
      }

      const webhookIdValidation = validateAirtableId(resolvedExternalId, 'ach', 'webhookId')
      if (!webhookIdValidation.isValid) {
        logger.warn(`[${requestId}] Invalid Airtable webhook ID format, skipping deletion`, {
          webhookId: webhookRecord.id,
          externalId: resolvedExternalId.substring(0, 20),
        })
        return
      }

      const airtableDeleteUrl = `https://api.airtable.com/v0/bases/${baseId}/webhooks/${resolvedExternalId}`
      const airtableResponse = await fetch(airtableDeleteUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!airtableResponse.ok) {
        let responseBody: unknown = null
        try {
          responseBody = await airtableResponse.json()
        } catch {
          // Ignore parse errors
        }

        logger.warn(
          `[${requestId}] Failed to delete Airtable webhook in Airtable. Status: ${airtableResponse.status}`,
          { baseId, externalId: resolvedExternalId, response: responseBody }
        )
      } else {
        logger.info(`[${requestId}] Successfully deleted Airtable webhook in Airtable`, {
          baseId,
          externalId: resolvedExternalId,
        })
      }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(`[${requestId}] Error deleting Airtable webhook`, {
        webhookId: webhookRecord.id,
        error: err.message,
        stack: err.stack,
      })
    }
  },

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
