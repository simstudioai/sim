import { db } from '@sim/db'
import { account, webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createTimeoutAbortController, getTimeoutErrorMessage } from '@/lib/core/execution-limits'
import { IdempotencyService, webhookIdempotency } from '@/lib/core/idempotency'
import { processExecutionFiles } from '@/lib/execution/files'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { WebhookAttachmentProcessor } from '@/lib/webhooks/attachment-processor'
import { fetchAndProcessAirtablePayloads, formatWebhookInput } from '@/lib/webhooks/utils.server'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { resolveOAuthAccountId } from '@/app/api/auth/oauth/utils'
import { getBlock } from '@/blocks'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { safeAssign } from '@/tools/safe-assign'
import { getTrigger, isTriggerValid } from '@/triggers'

const logger = createLogger('TriggerWebhookExecution')

/**
 * Process trigger outputs based on their schema definitions
 * Finds outputs marked as 'file' or 'file[]' and uploads them to execution storage
 */
async function processTriggerFileOutputs(
  input: any,
  triggerOutputs: Record<string, any>,
  context: {
    workspaceId: string
    workflowId: string
    executionId: string
    requestId: string
    userId?: string
  },
  path = ''
): Promise<any> {
  if (!input || typeof input !== 'object') {
    return input
  }

  const processed: any = Array.isArray(input) ? [] : {}

  for (const [key, value] of Object.entries(input)) {
    const currentPath = path ? `${path}.${key}` : key
    const outputDef = triggerOutputs[key]
    const val: any = value

    // If this field is marked as file or file[], process it
    if (outputDef?.type === 'file[]' && Array.isArray(val)) {
      try {
        processed[key] = await WebhookAttachmentProcessor.processAttachments(val as any, context)
      } catch (error) {
        processed[key] = []
      }
    } else if (outputDef?.type === 'file' && val) {
      try {
        const [processedFile] = await WebhookAttachmentProcessor.processAttachments(
          [val as any],
          context
        )
        processed[key] = processedFile
      } catch (error) {
        logger.error(`[${context.requestId}] Error processing ${currentPath}:`, error)
        processed[key] = val
      }
    } else if (
      outputDef &&
      typeof outputDef === 'object' &&
      (outputDef.type === 'object' || outputDef.type === 'json') &&
      outputDef.properties
    ) {
      // Explicit object schema with properties - recurse into properties
      processed[key] = await processTriggerFileOutputs(
        val,
        outputDef.properties,
        context,
        currentPath
      )
    } else if (outputDef && typeof outputDef === 'object' && !outputDef.type) {
      // Nested object in schema (flat pattern) - recurse with the nested schema
      processed[key] = await processTriggerFileOutputs(val, outputDef, context, currentPath)
    } else {
      // Not a file output - keep as is
      processed[key] = val
    }
  }

  return processed
}

export type WebhookExecutionPayload = {
  webhookId: string
  workflowId: string
  userId: string
  provider: string
  body: any
  headers: Record<string, string>
  path: string
  blockId?: string
  workspaceId?: string
  credentialId?: string
}

export async function executeWebhookJob(payload: WebhookExecutionPayload) {
  const executionId = uuidv4()
  const requestId = executionId.slice(0, 8)

  logger.info(`[${requestId}] Starting webhook execution`, {
    webhookId: payload.webhookId,
    workflowId: payload.workflowId,
    provider: payload.provider,
    userId: payload.userId,
    executionId,
  })

  const idempotencyKey = IdempotencyService.createWebhookIdempotencyKey(
    payload.webhookId,
    payload.headers,
    payload.body,
    payload.provider
  )

  const runOperation = async () => {
    return await executeWebhookJobInternal(payload, executionId, requestId)
  }

  return await webhookIdempotency.executeWithIdempotency(
    payload.provider,
    idempotencyKey,
    runOperation
  )
}

/**
 * Resolve the account userId for a credential
 */
async function resolveCredentialAccountUserId(credentialId: string): Promise<string | undefined> {
  const resolved = await resolveOAuthAccountId(credentialId)
  if (!resolved) {
    return undefined
  }
  const [credentialRecord] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(eq(account.id, resolved.accountId))
    .limit(1)
  return credentialRecord?.userId
}

async function executeWebhookJobInternal(
  payload: WebhookExecutionPayload,
  executionId: string,
  requestId: string
) {
  const loggingSession = new LoggingSession(
    payload.workflowId,
    executionId,
    payload.provider,
    requestId
  )

  // Resolve workflow record, billing actor, subscription, and timeout
  const preprocessResult = await preprocessExecution({
    workflowId: payload.workflowId,
    userId: payload.userId,
    triggerType: 'webhook',
    executionId,
    requestId,
    checkRateLimit: false,
    checkDeployment: false,
    skipUsageLimits: true,
    workspaceId: payload.workspaceId,
    loggingSession,
  })

  if (!preprocessResult.success) {
    throw new Error(preprocessResult.error?.message || 'Preprocessing failed in background job')
  }

  const { workflowRecord, executionTimeout } = preprocessResult
  if (!workflowRecord) {
    throw new Error(`Workflow ${payload.workflowId} not found during preprocessing`)
  }

  const workspaceId = workflowRecord.workspaceId
  if (!workspaceId) {
    throw new Error(`Workflow ${payload.workflowId} has no associated workspace`)
  }

  const workflowVariables = (workflowRecord.variables as Record<string, any>) || {}
  const asyncTimeout = executionTimeout?.async ?? 120_000
  const timeoutController = createTimeoutAbortController(asyncTimeout)

  let deploymentVersionId: string | undefined

  try {
    // Parallelize workflow state, webhook record, and credential resolution
    const [workflowData, webhookRows, resolvedCredentialUserId] = await Promise.all([
      loadDeployedWorkflowState(payload.workflowId, workspaceId),
      db.select().from(webhook).where(eq(webhook.id, payload.webhookId)).limit(1),
      payload.credentialId
        ? resolveCredentialAccountUserId(payload.credentialId)
        : Promise.resolve(undefined),
    ])
    const credentialAccountUserId = resolvedCredentialUserId
    if (payload.credentialId && !credentialAccountUserId) {
      logger.warn(
        `[${requestId}] Failed to resolve credential account for credential ${payload.credentialId}`
      )
    }

    if (!workflowData) {
      throw new Error(
        'Workflow state not found. The workflow may not be deployed or the deployment data may be corrupted.'
      )
    }

    const { blocks, edges, loops, parallels } = workflowData
    deploymentVersionId =
      'deploymentVersionId' in workflowData
        ? (workflowData.deploymentVersionId as string)
        : undefined

    // Handle special Airtable case
    if (payload.provider === 'airtable') {
      logger.info(`[${requestId}] Processing Airtable webhook via fetchAndProcessAirtablePayloads`)

      const webhookRecord = webhookRows[0]
      if (!webhookRecord) {
        throw new Error(`Webhook record not found: ${payload.webhookId}`)
      }

      const webhookData = {
        id: payload.webhookId,
        provider: payload.provider,
        providerConfig: webhookRecord.providerConfig,
      }

      const mockWorkflow = {
        id: payload.workflowId,
        userId: payload.userId,
      }

      const airtableInput = await fetchAndProcessAirtablePayloads(
        webhookData,
        mockWorkflow,
        requestId
      )

      if (airtableInput) {
        logger.info(`[${requestId}] Executing workflow with Airtable changes`)

        const metadata: ExecutionMetadata = {
          requestId,
          executionId,
          workflowId: payload.workflowId,
          workspaceId,
          userId: payload.userId,
          sessionUserId: undefined,
          workflowUserId: workflowRecord.userId,
          triggerType: payload.provider || 'webhook',
          triggerBlockId: payload.blockId,
          useDraftState: false,
          startTime: new Date().toISOString(),
          isClientSession: false,
          credentialAccountUserId,
          workflowStateOverride: {
            blocks,
            edges,
            loops: loops || {},
            parallels: parallels || {},
            deploymentVersionId,
          },
        }

        const snapshot = new ExecutionSnapshot(
          metadata,
          workflowRecord,
          airtableInput,
          workflowVariables,
          []
        )

        const executionResult = await executeWorkflowCore({
          snapshot,
          callbacks: {},
          loggingSession,
          includeFileBase64: true,
          base64MaxBytes: undefined,
          abortSignal: timeoutController.signal,
        })

        if (
          executionResult.status === 'cancelled' &&
          timeoutController.isTimedOut() &&
          timeoutController.timeoutMs
        ) {
          const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
          logger.info(`[${requestId}] Airtable webhook execution timed out`, {
            timeoutMs: timeoutController.timeoutMs,
          })
          await loggingSession.markAsFailed(timeoutErrorMessage)
        } else if (executionResult.status === 'paused') {
          if (!executionResult.snapshotSeed) {
            logger.error(`[${requestId}] Missing snapshot seed for paused execution`, {
              executionId,
            })
            await loggingSession.markAsFailed('Missing snapshot seed for paused execution')
          } else {
            try {
              await PauseResumeManager.persistPauseResult({
                workflowId: payload.workflowId,
                executionId,
                pausePoints: executionResult.pausePoints || [],
                snapshotSeed: executionResult.snapshotSeed,
                executorUserId: executionResult.metadata?.userId,
              })
            } catch (pauseError) {
              logger.error(`[${requestId}] Failed to persist pause result`, {
                executionId,
                error: pauseError instanceof Error ? pauseError.message : String(pauseError),
              })
              await loggingSession.markAsFailed(
                `Failed to persist pause state: ${pauseError instanceof Error ? pauseError.message : String(pauseError)}`
              )
            }
          }
        } else {
          await PauseResumeManager.processQueuedResumes(executionId)
        }

        logger.info(`[${requestId}] Airtable webhook execution completed`, {
          success: executionResult.success,
          workflowId: payload.workflowId,
        })

        return {
          success: executionResult.success,
          workflowId: payload.workflowId,
          executionId,
          output: executionResult.output,
          executedAt: new Date().toISOString(),
          provider: payload.provider,
        }
      }
      // No changes to process
      logger.info(`[${requestId}] No Airtable changes to process`)

      await loggingSession.safeStart({
        userId: payload.userId,
        workspaceId,
        variables: {},
        triggerData: {
          isTest: false,
        },
        deploymentVersionId,
      })

      await loggingSession.safeComplete({
        endedAt: new Date().toISOString(),
        totalDurationMs: 0,
        finalOutput: { message: 'No Airtable changes to process' },
        traceSpans: [],
      })

      return {
        success: true,
        workflowId: payload.workflowId,
        executionId,
        output: { message: 'No Airtable changes to process' },
        executedAt: new Date().toISOString(),
      }
    }

    // Format input for standard webhooks
    const actualWebhook =
      webhookRows.length > 0
        ? webhookRows[0]
        : {
            provider: payload.provider,
            blockId: payload.blockId,
            providerConfig: {},
          }

    const mockWorkflow = {
      id: payload.workflowId,
      userId: payload.userId,
    }
    const mockRequest = {
      headers: new Map(Object.entries(payload.headers)),
    } as any

    const input = await formatWebhookInput(actualWebhook, mockWorkflow, payload.body, mockRequest)

    if (!input && payload.provider === 'whatsapp') {
      logger.info(`[${requestId}] No messages in WhatsApp payload, skipping execution`)

      await loggingSession.safeStart({
        userId: payload.userId,
        workspaceId,
        variables: {},
        triggerData: {
          isTest: false,
        },
        deploymentVersionId,
      })

      await loggingSession.safeComplete({
        endedAt: new Date().toISOString(),
        totalDurationMs: 0,
        finalOutput: { message: 'No messages in WhatsApp payload' },
        traceSpans: [],
      })
      return {
        success: true,
        workflowId: payload.workflowId,
        executionId,
        output: { message: 'No messages in WhatsApp payload' },
        executedAt: new Date().toISOString(),
      }
    }

    // Process trigger file outputs based on schema
    if (input && payload.blockId && blocks[payload.blockId]) {
      try {
        const triggerBlock = blocks[payload.blockId]
        const rawSelectedTriggerId = triggerBlock?.subBlocks?.selectedTriggerId?.value
        const rawTriggerId = triggerBlock?.subBlocks?.triggerId?.value

        let resolvedTriggerId = [rawSelectedTriggerId, rawTriggerId].find(
          (candidate): candidate is string =>
            typeof candidate === 'string' && isTriggerValid(candidate)
        )

        if (!resolvedTriggerId) {
          const blockConfig = getBlock(triggerBlock.type)
          if (blockConfig?.category === 'triggers' && isTriggerValid(triggerBlock.type)) {
            resolvedTriggerId = triggerBlock.type
          } else if (triggerBlock.triggerMode && blockConfig?.triggers?.enabled) {
            const available = blockConfig.triggers?.available?.[0]
            if (available && isTriggerValid(available)) {
              resolvedTriggerId = available
            }
          }
        }

        if (resolvedTriggerId) {
          const triggerConfig = getTrigger(resolvedTriggerId)

          if (triggerConfig.outputs) {
            const processedInput = await processTriggerFileOutputs(input, triggerConfig.outputs, {
              workspaceId,
              workflowId: payload.workflowId,
              executionId,
              requestId,
              userId: payload.userId,
            })
            safeAssign(input, processedInput as Record<string, unknown>)
          }
        }
      } catch (error) {
        logger.error(`[${requestId}] Error processing trigger file outputs:`, error)
      }
    }

    // Process generic webhook files based on inputFormat
    if (input && payload.provider === 'generic' && payload.blockId && blocks[payload.blockId]) {
      try {
        const triggerBlock = blocks[payload.blockId]

        if (triggerBlock?.subBlocks?.inputFormat?.value) {
          const inputFormat = triggerBlock.subBlocks.inputFormat.value as unknown as Array<{
            name: string
            type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file[]'
          }>

          const fileFields = inputFormat.filter((field) => field.type === 'file[]')

          if (fileFields.length > 0 && typeof input === 'object' && input !== null) {
            const executionContext = {
              workspaceId,
              workflowId: payload.workflowId,
              executionId,
            }

            for (const fileField of fileFields) {
              const fieldValue = input[fileField.name]

              if (fieldValue && typeof fieldValue === 'object') {
                const uploadedFiles = await processExecutionFiles(
                  fieldValue,
                  executionContext,
                  requestId,
                  payload.userId
                )

                if (uploadedFiles.length > 0) {
                  input[fileField.name] = uploadedFiles
                  logger.info(
                    `[${requestId}] Successfully processed ${uploadedFiles.length} file(s) for field: ${fileField.name}`
                  )
                }
              }
            }
          }
        }
      } catch (error) {
        logger.error(`[${requestId}] Error processing generic webhook files:`, error)
      }
    }

    logger.info(`[${requestId}] Executing workflow for ${payload.provider} webhook`)

    const metadata: ExecutionMetadata = {
      requestId,
      executionId,
      workflowId: payload.workflowId,
      workspaceId,
      userId: payload.userId,
      sessionUserId: undefined,
      workflowUserId: workflowRecord.userId,
      triggerType: payload.provider || 'webhook',
      triggerBlockId: payload.blockId,
      useDraftState: false,
      startTime: new Date().toISOString(),
      isClientSession: false,
      credentialAccountUserId,
      workflowStateOverride: {
        blocks,
        edges,
        loops: loops || {},
        parallels: parallels || {},
        deploymentVersionId,
      },
    }

    const triggerInput = input || {}

    const snapshot = new ExecutionSnapshot(
      metadata,
      workflowRecord,
      triggerInput,
      workflowVariables,
      []
    )

    const executionResult = await executeWorkflowCore({
      snapshot,
      callbacks: {},
      loggingSession,
      includeFileBase64: true,
      abortSignal: timeoutController.signal,
    })

    if (
      executionResult.status === 'cancelled' &&
      timeoutController.isTimedOut() &&
      timeoutController.timeoutMs
    ) {
      const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
      logger.info(`[${requestId}] Webhook execution timed out`, {
        timeoutMs: timeoutController.timeoutMs,
      })
      await loggingSession.markAsFailed(timeoutErrorMessage)
    } else if (executionResult.status === 'paused') {
      if (!executionResult.snapshotSeed) {
        logger.error(`[${requestId}] Missing snapshot seed for paused execution`, {
          executionId,
        })
        await loggingSession.markAsFailed('Missing snapshot seed for paused execution')
      } else {
        try {
          await PauseResumeManager.persistPauseResult({
            workflowId: payload.workflowId,
            executionId,
            pausePoints: executionResult.pausePoints || [],
            snapshotSeed: executionResult.snapshotSeed,
            executorUserId: executionResult.metadata?.userId,
          })
        } catch (pauseError) {
          logger.error(`[${requestId}] Failed to persist pause result`, {
            executionId,
            error: pauseError instanceof Error ? pauseError.message : String(pauseError),
          })
          await loggingSession.markAsFailed(
            `Failed to persist pause state: ${pauseError instanceof Error ? pauseError.message : String(pauseError)}`
          )
        }
      }
    } else {
      await PauseResumeManager.processQueuedResumes(executionId)
    }

    logger.info(`[${requestId}] Webhook execution completed`, {
      success: executionResult.success,
      workflowId: payload.workflowId,
      provider: payload.provider,
    })

    return {
      success: executionResult.success,
      workflowId: payload.workflowId,
      executionId,
      output: executionResult.output,
      executedAt: new Date().toISOString(),
      provider: payload.provider,
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    logger.error(`[${requestId}] Webhook execution failed`, {
      error: errorMessage,
      stack: errorStack,
      workflowId: payload.workflowId,
      provider: payload.provider,
    })

    try {
      await loggingSession.safeStart({
        userId: payload.userId,
        workspaceId,
        variables: {},
        triggerData: {
          isTest: false,
        },
        deploymentVersionId,
      })

      const executionResult = hasExecutionResult(error)
        ? error.executionResult
        : {
            success: false,
            output: {},
            logs: [],
          }
      const { traceSpans } = buildTraceSpans(executionResult)

      await loggingSession.safeCompleteWithError({
        endedAt: new Date().toISOString(),
        totalDurationMs: 0,
        error: {
          message: errorMessage || 'Webhook execution failed',
          stackTrace: errorStack,
        },
        traceSpans,
      })
    } catch (loggingError) {
      logger.error(`[${requestId}] Failed to complete logging session`, loggingError)
    }

    throw error
  } finally {
    timeoutController.cleanup()
  }
}

export const webhookExecution = task({
  id: 'webhook-execution',
  machine: 'medium-1x',
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: WebhookExecutionPayload) => executeWebhookJob(payload),
})
