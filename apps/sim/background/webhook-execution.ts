import { db } from '@sim/db'
import { webhook, workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getHighestPrioritySubscription } from '@/lib/billing'
import {
  createTimeoutAbortController,
  getExecutionTimeout,
  getTimeoutErrorMessage,
} from '@/lib/core/execution-limits'
import { IdempotencyService, webhookIdempotency } from '@/lib/core/idempotency'
import type { SubscriptionPlan } from '@/lib/core/rate-limiter/types'
import { processExecutionFiles } from '@/lib/execution/files'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { WebhookAttachmentProcessor } from '@/lib/webhooks/attachment-processor'
import { fetchAndProcessAirtablePayloads, formatWebhookInput } from '@/lib/webhooks/utils.server'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { getWorkflowById } from '@/lib/workflows/utils'
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
  credentialId?: string
  credentialAccountUserId?: string
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

  const userSubscription = await getHighestPrioritySubscription(payload.userId)
  const asyncTimeout = getExecutionTimeout(
    userSubscription?.plan as SubscriptionPlan | undefined,
    'async'
  )
  const timeoutController = createTimeoutAbortController(asyncTimeout)

  let deploymentVersionId: string | undefined

  try {
    const workflowData = await loadDeployedWorkflowState(payload.workflowId)
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

    const wfRows = await db
      .select({ workspaceId: workflowTable.workspaceId, variables: workflowTable.variables })
      .from(workflowTable)
      .where(eq(workflowTable.id, payload.workflowId))
      .limit(1)
    const workspaceId = wfRows[0]?.workspaceId
    if (!workspaceId) {
      throw new Error(`Workflow ${payload.workflowId} has no associated workspace`)
    }
    const workflowVariables = (wfRows[0]?.variables as Record<string, any>) || {}

    // Handle special Airtable case
    if (payload.provider === 'airtable') {
      logger.info(`[${requestId}] Processing Airtable webhook via fetchAndProcessAirtablePayloads`)

      // Load the actual webhook record from database to get providerConfig
      const [webhookRecord] = await db
        .select()
        .from(webhook)
        .where(eq(webhook.id, payload.webhookId))
        .limit(1)

      if (!webhookRecord) {
        throw new Error(`Webhook record not found: ${payload.webhookId}`)
      }

      const webhookData = {
        id: payload.webhookId,
        provider: payload.provider,
        providerConfig: webhookRecord.providerConfig,
      }

      // Create a mock workflow object for Airtable processing
      const mockWorkflow = {
        id: payload.workflowId,
        userId: payload.userId,
      }

      // Get the processed Airtable input
      const airtableInput = await fetchAndProcessAirtablePayloads(
        webhookData,
        mockWorkflow,
        requestId
      )

      // If we got input (changes), execute the workflow like other providers
      if (airtableInput) {
        logger.info(`[${requestId}] Executing workflow with Airtable changes`)

        // Get workflow for core execution
        const workflow = await getWorkflowById(payload.workflowId)
        if (!workflow) {
          throw new Error(`Workflow ${payload.workflowId} not found`)
        }

        const metadata: ExecutionMetadata = {
          requestId,
          executionId,
          workflowId: payload.workflowId,
          workspaceId,
          userId: payload.userId,
          sessionUserId: undefined,
          workflowUserId: workflow.userId,
          triggerType: payload.provider || 'webhook',
          triggerBlockId: payload.blockId,
          useDraftState: false,
          startTime: new Date().toISOString(),
          isClientSession: false,
          credentialAccountUserId: payload.credentialAccountUserId,
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
          workflow,
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

      // Start logging session so the complete call has a log entry to update
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
    // Load the actual webhook to get providerConfig (needed for Teams credentialId)
    const webhookRows = await db
      .select()
      .from(webhook)
      .where(eq(webhook.id, payload.webhookId))
      .limit(1)

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

      // Start logging session so the complete call has a log entry to update
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
            logger.debug(`[${requestId}] Processing trigger ${resolvedTriggerId} file outputs`)
            const processedInput = await processTriggerFileOutputs(input, triggerConfig.outputs, {
              workspaceId,
              workflowId: payload.workflowId,
              executionId,
              requestId,
              userId: payload.userId,
            })
            safeAssign(input, processedInput as Record<string, unknown>)
          }
        } else {
          logger.debug(`[${requestId}] No valid triggerId found for block ${payload.blockId}`)
        }
      } catch (error) {
        logger.error(`[${requestId}] Error processing trigger file outputs:`, error)
        // Continue without processing attachments rather than failing execution
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
          logger.debug(`[${requestId}] Processing generic webhook files from inputFormat`)

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
        // Continue without processing files rather than failing execution
      }
    }

    logger.info(`[${requestId}] Executing workflow for ${payload.provider} webhook`)

    // Get workflow for core execution
    const workflow = await getWorkflowById(payload.workflowId)
    if (!workflow) {
      throw new Error(`Workflow ${payload.workflowId} not found`)
    }

    const metadata: ExecutionMetadata = {
      requestId,
      executionId,
      workflowId: payload.workflowId,
      workspaceId,
      userId: payload.userId,
      sessionUserId: undefined,
      workflowUserId: workflow.userId,
      triggerType: payload.provider || 'webhook',
      triggerBlockId: payload.blockId,
      useDraftState: false,
      startTime: new Date().toISOString(),
      isClientSession: false,
      credentialAccountUserId: payload.credentialAccountUserId,
      workflowStateOverride: {
        blocks,
        edges,
        loops: loops || {},
        parallels: parallels || {},
        deploymentVersionId,
      },
    }

    const triggerInput = input || {}

    const snapshot = new ExecutionSnapshot(metadata, workflow, triggerInput, workflowVariables, [])

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
      const wfRow = await db
        .select({ workspaceId: workflowTable.workspaceId })
        .from(workflowTable)
        .where(eq(workflowTable.id, payload.workflowId))
        .limit(1)
      const errorWorkspaceId = wfRow[0]?.workspaceId

      if (!errorWorkspaceId) {
        logger.warn(
          `[${requestId}] Cannot log error: workflow ${payload.workflowId} has no workspace`
        )
        throw error
      }

      await loggingSession.safeStart({
        userId: payload.userId,
        workspaceId: errorWorkspaceId,
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
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: WebhookExecutionPayload) => executeWebhookJob(payload),
})
