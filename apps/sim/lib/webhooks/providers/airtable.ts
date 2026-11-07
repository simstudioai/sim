import { db } from '@sim/db'
import { account, webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import { validateAirtableId } from '@/lib/core/security/input-validation'
import {
  getOAuthToken,
  refreshAccessTokenIfNeeded,
  resolveOAuthAccountId,
} from '@/lib/oauth/credential-service'
import {
  getCredentialAccessToken,
  getNotificationUrl,
  getProviderConfig,
} from '@/lib/webhooks/provider-subscription-utils'
import { WebhookDeploymentConfigurationError } from '@/lib/webhooks/providers/errors'
import type {
  DeleteSubscriptionContext,
  FormatInputContext,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

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
  let apiCallCount = 0
  // Use a Map to consolidate changes per record ID
  const consolidatedChangesMap = new Map<string, AirtableChange>()
  // Capture raw payloads from Airtable for exposure to workflows
  const allPayloads = []
  const localProviderConfig: Record<string, unknown> = {
    ...toRecord(webhookData.providerConfig),
  }

  try {
    const baseId = localProviderConfig.baseId
    const airtableWebhookId = localProviderConfig.externalId

    if (!baseId || !airtableWebhookId) {
      logger.error(
        `Missing baseId or externalId in providerConfig for webhook ${webhookData.id}. Cannot fetch payloads.`,
        { requestId }
      )
      return
    }

    const credentialId = localProviderConfig.credentialId as string | undefined
    if (!credentialId) {
      logger.error(
        `Missing credentialId in providerConfig for Airtable webhook ${webhookData.id}.`,
        { requestId }
      )
      return
    }

    const resolvedAirtable = await resolveOAuthAccountId(credentialId)
    if (!resolvedAirtable) {
      logger.error(`Could not resolve credential ${credentialId} for Airtable webhook`, {
        requestId,
      })
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
        `Could not resolve owner for Airtable credential ${credentialId} on webhook ${webhookData.id}`,
        { requestId }
      )
      return
    }

    const storedCursor = localProviderConfig.externalWebhookCursor

    if (storedCursor === undefined || storedCursor === null) {
      logger.info(
        `No cursor found in providerConfig for webhook ${webhookData.id}, initializing...`,
        { requestId }
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
        logger.info(`Successfully initialized cursor for webhook ${webhookData.id}`, { requestId })
      } catch (initError: unknown) {
        const err = initError as Error
        logger.error('Failed to initialize cursor in DB', {
          requestId,
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
          `Failed to obtain valid Airtable access token via credential ${credentialId}.`,
          { requestId }
        )
        throw new Error('Airtable access token not found.')
      }
    } catch (tokenError: unknown) {
      const err = tokenError as Error
      logger.error(`Failed to get Airtable OAuth token for credential ${credentialId}`, {
        requestId,
        error: err.message,
        stack: err.stack,
        credentialId,
      })
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
          logger.error(`Airtable API request to /payloads failed (Call ${apiCallCount})`, {
            requestId,
            webhookId: webhookData.id,
            status: response.status,
            error: errorMessage,
          })
          // Error logging handled by logging session
          mightHaveMore = false
          break
        }

        const receivedPayloads = responseBody.payloads || []

        if (receivedPayloads.length > 0) {
          // Keep the raw payloads for later exposure to the workflow
          for (const p of receivedPayloads) {
            allPayloads.push(p)
          }
          for (const payload of receivedPayloads) {
            if (payload.changedTablesById) {
              for (const [tableId, tableChangesUntyped] of Object.entries(
                payload.changedTablesById
              )) {
                const tableChanges = tableChangesUntyped as AirtableTableChanges

                if (tableChanges.createdRecordsById) {
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
            logger.error('Failed to persist Airtable cursor to DB', {
              requestId,
              webhookId: webhookData.id,
              cursor: currentCursor,
              error: err.message,
            })
            // Error logging handled by logging session
            mightHaveMore = false
            throw new Error('Failed to save Airtable cursor, stopping processing.') // Re-throw to break loop clearly
          }
        } else if (!nextCursor || typeof nextCursor !== 'number') {
          logger.warn('Invalid or missing cursor received, stopping poll', {
            requestId,
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
          `Network error calling Airtable GET /payloads (Call ${apiCallCount}) for webhook ${webhookData.id}`,
          fetchError,
          { requestId }
        )
        // Error logging handled by logging session
        mightHaveMore = false
        break
      }
    }
    // Convert map values to array for final processing
    const finalConsolidatedChanges = Array.from(consolidatedChangesMap.values())
    logger.info(
      `Consolidated ${finalConsolidatedChanges.length} Airtable changes across ${apiCallCount} API calls`,
      { requestId }
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
          `CRITICAL_TRACE: Beginning workflow execution with ${finalConsolidatedChanges.length} Airtable changes`,
          {
            requestId,
            workflowId: workflowData.id,
            recordCount: finalConsolidatedChanges.length,
            timestamp: new Date().toISOString(),
            firstRecordId: finalConsolidatedChanges[0]?.recordId || 'none',
          }
        )

        // Return the processed input for the trigger.dev task to handle
        logger.info('CRITICAL_TRACE: Airtable changes processed, returning input', {
          requestId,
          workflowId: workflowData.id,
          recordCount: finalConsolidatedChanges.length,
          rawPayloadCount: allPayloads.length,
          timestamp: new Date().toISOString(),
        })

        return input
      } catch (processingError: unknown) {
        const err = processingError as Error
        logger.error('CRITICAL_TRACE: Error processing Airtable changes', {
          requestId,
          workflowId: workflowData.id,
          error: err.message,
          stack: err.stack,
          timestamp: new Date().toISOString(),
        })

        throw processingError
      }
    } else {
      // DEBUG: Log when no changes are found
      logger.info('TRACE: No Airtable changes to process', {
        requestId,
        workflowId: workflowData.id,
        apiCallCount,
        webhookId: webhookData.id,
      })
    }
  } catch (error) {
    // Catch any unexpected errors during the setup/polling logic itself
    logger.error('Unexpected error during asynchronous Airtable payload processing task', {
      requestId,
      webhookId: webhookData.id,
      workflowId: workflowData.id,
      error: (error as Error).message,
    })
    // Error logging handled by logging session
  }
}

export const airtableHandler: WebhookProviderHandler = {
  async createSubscription({
    webhook: webhookRecord,
    userId,
    requestId,
  }: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    try {
      const config = getProviderConfig(webhookRecord)
      const { includeCellValuesInFieldIds, credentialId } = config as {
        includeCellValuesInFieldIds?: string
        credentialId?: string
      }
      const baseId = toStringOrNull(config.baseId)
      const tableId = toStringOrNull(config.tableId)

      if (!baseId || !tableId) {
        logger.warn('Missing baseId or tableId for Airtable webhook creation.', {
          requestId,
          webhookId: webhookRecord.id,
        })
        throw new WebhookDeploymentConfigurationError(
          'Base ID and Table ID are required to create Airtable webhook. Please provide valid Airtable base and table IDs.'
        )
      }

      const baseIdValidation = validateAirtableId(baseId, 'app', 'baseId')
      if (!baseIdValidation.isValid) {
        throw new WebhookDeploymentConfigurationError(baseIdValidation.error)
      }

      const tableIdValidation = validateAirtableId(tableId, 'tbl', 'tableId')
      if (!tableIdValidation.isValid) {
        throw new WebhookDeploymentConfigurationError(tableIdValidation.error)
      }

      const accessToken = credentialId
        ? await getCredentialAccessToken(credentialId, requestId)
        : await getOAuthToken(userId, 'airtable')
      if (!accessToken) {
        logger.warn(
          `Could not retrieve Airtable access token for user ${userId}. Cannot create webhook in Airtable.`,
          { requestId }
        )
        throw new Error(
          'Airtable account connection required. Please connect your Airtable account in the trigger configuration and try again.'
        )
      }

      const notificationUrl = getNotificationUrl(webhookRecord)

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
          `Failed to create webhook in Airtable for webhook ${webhookRecord.id}. Status: ${airtableResponse.status}`,
          { requestId, type: errorType, message: errorMessage, response: responseBody }
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
      logger.info(`Successfully created webhook in Airtable for webhook ${webhookRecord.id}.`, {
        requestId,
        airtableWebhookId: responseBody.id,
      })
      return { providerConfigUpdates: { externalId: responseBody.id } }
    } catch (error: unknown) {
      if (error instanceof WebhookDeploymentConfigurationError) throw error
      const err = error as Error
      logger.error(`Exception during Airtable webhook creation for webhook ${webhookRecord.id}.`, {
        requestId,
        message: err.message,
        stack: err.stack,
      })
      throw error
    }
  },

  async deleteSubscription({
    webhook: webhookRecord,
    requestId,
    strict,
  }: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(webhookRecord)
      const { baseId, externalId } = config as {
        baseId?: string
        externalId?: string
      }

      if (!baseId) {
        logger.warn('Missing baseId for Airtable webhook deletion', {
          requestId,
          webhookId: webhookRecord.id,
        })
        if (strict) throw new Error('Missing Airtable baseId for webhook deletion')
        return
      }

      const baseIdValidation = validateAirtableId(baseId, 'app', 'baseId')
      if (!baseIdValidation.isValid) {
        logger.warn('Invalid Airtable base ID format, skipping deletion', {
          requestId,
          webhookId: webhookRecord.id,
          baseId: baseId.substring(0, 20),
        })
        if (strict) throw new Error('Invalid Airtable baseId for webhook deletion')
        return
      }

      const credentialId = config.credentialId as string | undefined
      if (!credentialId) {
        logger.warn(`Missing credentialId for Airtable webhook deletion ${webhookRecord.id}`, {
          requestId,
        })
        if (strict) throw new Error('Missing Airtable credentialId for webhook deletion')
        return
      }

      const accessToken = await getCredentialAccessToken(credentialId, requestId)
      if (!accessToken) {
        const message =
          'Could not retrieve Airtable access token. Cannot delete webhook in Airtable.'
        logger.warn(message, { requestId, webhookId: webhookRecord.id })
        if (strict) throw new Error(message)
        return
      }

      let resolvedExternalId: string | undefined = externalId
      let externalIdLookupFailed = false

      if (!resolvedExternalId && strict) {
        logger.warn(
          'Missing Airtable externalId during strict cleanup; skipping unsafe URL-based remote deletion',
          { requestId, webhookId: webhookRecord.id, baseId }
        )
        throw new Error('Missing Airtable externalId for strict cleanup')
      }

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
              logger.info('Resolved Airtable externalId by listing webhooks', {
                requestId,
                baseId,
                externalId: resolvedExternalId,
              })
            } else {
              logger.warn('Could not resolve Airtable externalId from list', {
                requestId,
                baseId,
                expectedNotificationUrl,
              })
            }
          } else {
            externalIdLookupFailed = true
            logger.warn('Failed to list Airtable webhooks to resolve externalId', {
              requestId,
              baseId,
              status: listResp.status,
              body: listBody,
            })
          }
        } catch (e: unknown) {
          externalIdLookupFailed = true
          logger.warn('Error attempting to resolve Airtable externalId', {
            requestId,
            error: (e as Error)?.message,
          })
        }
      }

      if (!resolvedExternalId) {
        logger.info('Airtable externalId not found; skipping remote deletion', {
          requestId,
          baseId,
          confirmedAbsent: !externalIdLookupFailed,
        })
        if (strict && externalIdLookupFailed) {
          throw new Error('Could not resolve Airtable externalId for strict cleanup')
        }
        return
      }

      const webhookIdValidation = validateAirtableId(resolvedExternalId, 'ach', 'webhookId')
      if (!webhookIdValidation.isValid) {
        logger.warn('Invalid Airtable webhook ID format, skipping deletion', {
          requestId,
          webhookId: webhookRecord.id,
          externalId: resolvedExternalId.substring(0, 20),
        })
        if (strict) throw new Error('Invalid Airtable webhook ID for deletion')
        return
      }

      const airtableDeleteUrl = `https://api.airtable.com/v0/bases/${baseId}/webhooks/${resolvedExternalId}`
      const airtableResponse = await fetch(airtableDeleteUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!airtableResponse.ok && airtableResponse.status !== 404) {
        let responseBody: unknown = null
        try {
          responseBody = await airtableResponse.json()
        } catch {}

        logger.warn(
          `Failed to delete Airtable webhook in Airtable. Status: ${airtableResponse.status}`,
          { requestId, baseId, externalId: resolvedExternalId, response: responseBody }
        )
        if (strict) throw new Error(`Failed to delete Airtable webhook: ${airtableResponse.status}`)
      } else {
        logger.info('Successfully deleted Airtable webhook in Airtable', {
          requestId,
          baseId,
          externalId: resolvedExternalId,
          alreadyDeleted: airtableResponse.status === 404,
        })
      }
    } catch (error: unknown) {
      const err = error as Error
      logger.error('Error deleting Airtable webhook', {
        requestId,
        webhookId: webhookRecord.id,
        error: err.message,
        stack: err.stack,
      })
      if (strict) throw error
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
    logger.info('Processing Airtable webhook via fetchAndProcessAirtablePayloads', { requestId })

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
      logger.info('Executing workflow with Airtable changes', { requestId })
      return { input: airtableInput }
    }

    logger.info('No Airtable changes to process', { requestId })
    return { input: null, skip: { message: 'No Airtable changes to process' } }
  },
}
