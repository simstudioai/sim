import { db } from '@sim/db'
import { userStats, webhook, workflow as workflowTable } from '@sim/db/schema'
import { task } from '@trigger.dev/sdk'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { IdempotencyService, webhookIdempotency } from '@/lib/idempotency'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { decryptSecret } from '@/lib/utils'
import { fetchAndProcessAirtablePayloads, formatWebhookInput } from '@/lib/webhooks/utils'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { Executor } from '@/executor'
import type { ExecutionResult } from '@/executor/types'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('TriggerWebhookExecution')

export type WebhookExecutionPayload = {
  webhookId: string
  workflowId: string
  userId: string
  provider: string
  body: any
  headers: Record<string, string>
  path: string
  blockId?: string
  testMode?: boolean
  executionTarget?: 'deployed' | 'live'
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
    payload.headers
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
  const loggingSession = new LoggingSession(payload.workflowId, executionId, 'webhook', requestId)

  try {
    const usageCheck = await checkServerSideUsageLimits(payload.userId)
    if (usageCheck.isExceeded) {
      logger.warn(
        `[${requestId}] User ${payload.userId} has exceeded usage limits. Skipping webhook execution.`,
        {
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
          workflowId: payload.workflowId,
        }
      )
      throw new Error(
        usageCheck.message ||
          'Usage limit exceeded. Please upgrade your plan to continue using webhooks.'
      )
    }

    // Load workflow state based on execution target
    const workflowData =
      payload.executionTarget === 'live'
        ? await loadWorkflowFromNormalizedTables(payload.workflowId)
        : await loadDeployedWorkflowState(payload.workflowId)
    if (!workflowData) {
      throw new Error(`Workflow ${payload.workflowId} has no live normalized state`)
    }

    const { blocks, edges, loops, parallels } = workflowData

    const wfRows = await db
      .select({ workspaceId: workflowTable.workspaceId })
      .from(workflowTable)
      .where(eq(workflowTable.id, payload.workflowId))
      .limit(1)
    const workspaceId = wfRows[0]?.workspaceId || undefined

    const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
      payload.userId,
      workspaceId
    )
    const mergedEncrypted = { ...personalEncrypted, ...workspaceEncrypted }
    const decryptedPairs = await Promise.all(
      Object.entries(mergedEncrypted).map(async ([key, encrypted]) => {
        const { decrypted } = await decryptSecret(encrypted)
        return [key, decrypted] as const
      })
    )
    const decryptedEnvVars: Record<string, string> = Object.fromEntries(decryptedPairs)

    // Start logging session
    await loggingSession.safeStart({
      userId: payload.userId,
      workspaceId: workspaceId || '',
      variables: decryptedEnvVars,
      triggerData: {
        isTest: payload.testMode === true,
        executionTarget: payload.executionTarget || 'deployed',
      },
    })

    // Merge subblock states (matching workflow-execution pattern)
    const mergedStates = mergeSubblockState(blocks, {})

    // Process block states for execution
    const processedBlockStates = Object.entries(mergedStates).reduce(
      (acc, [blockId, blockState]) => {
        acc[blockId] = Object.entries(blockState.subBlocks).reduce(
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

    // Handle workflow variables (for now, use empty object since we don't have workflow metadata)
    const workflowVariables = {}

    // Create serialized workflow
    const serializer = new Serializer()
    const serializedWorkflow = serializer.serializeWorkflow(
      mergedStates,
      edges,
      loops || {},
      parallels || {},
      true // Enable validation during execution
    )

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

        // Create executor and execute (same as standard webhook flow)
        const executor = new Executor({
          workflow: serializedWorkflow,
          currentBlockStates: processedBlockStates,
          envVarValues: decryptedEnvVars,
          workflowInput: airtableInput,
          workflowVariables,
          contextExtensions: {
            executionId,
            workspaceId: workspaceId || '',
            isDeployedContext: !payload.testMode,
          },
        })

        // Set up logging on the executor
        loggingSession.setupExecutor(executor)

        // Execute the workflow
        const result = await executor.execute(payload.workflowId, payload.blockId)

        // Check if we got a StreamingExecution result
        const executionResult =
          'stream' in result && 'execution' in result ? result.execution : result

        logger.info(`[${requestId}] Airtable webhook execution completed`, {
          success: executionResult.success,
          workflowId: payload.workflowId,
        })

        // Update workflow run counts on success
        if (executionResult.success) {
          await updateWorkflowRunCounts(payload.workflowId)

          // Track execution in user stats
          await db
            .update(userStats)
            .set({
              totalWebhookTriggers: sql`total_webhook_triggers + 1`,
              lastActive: sql`now()`,
            })
            .where(eq(userStats.userId, payload.userId))
        }

        // Build trace spans and complete logging session
        const { traceSpans, totalDuration } = buildTraceSpans(executionResult)

        await loggingSession.safeComplete({
          endedAt: new Date().toISOString(),
          totalDurationMs: totalDuration || 0,
          finalOutput: executionResult.output || {},
          traceSpans: traceSpans as any,
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
    const mockWebhook = {
      provider: payload.provider,
      blockId: payload.blockId,
    }
    const mockWorkflow = {
      id: payload.workflowId,
      userId: payload.userId,
    }
    const mockRequest = {
      headers: new Map(Object.entries(payload.headers)),
    } as any

    const input = formatWebhookInput(mockWebhook, mockWorkflow, payload.body, mockRequest)

    if (!input && payload.provider === 'whatsapp') {
      logger.info(`[${requestId}] No messages in WhatsApp payload, skipping execution`)
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

    // Create executor and execute
    const executor = new Executor({
      workflow: serializedWorkflow,
      currentBlockStates: processedBlockStates,
      envVarValues: decryptedEnvVars,
      workflowInput: input || {},
      workflowVariables,
      contextExtensions: {
        executionId,
        workspaceId: workspaceId || '',
        isDeployedContext: !payload.testMode,
      },
    })

    // Set up logging on the executor
    loggingSession.setupExecutor(executor)

    logger.info(`[${requestId}] Executing workflow for ${payload.provider} webhook`)

    // Execute the workflow
    const result = await executor.execute(payload.workflowId, payload.blockId)

    // Check if we got a StreamingExecution result
    const executionResult = 'stream' in result && 'execution' in result ? result.execution : result

    logger.info(`[${requestId}] Webhook execution completed`, {
      success: executionResult.success,
      workflowId: payload.workflowId,
      provider: payload.provider,
    })

    // Update workflow run counts on success
    if (executionResult.success) {
      await updateWorkflowRunCounts(payload.workflowId)

      // Track execution in user stats (skip in test mode)
      if (!payload.testMode) {
        await db
          .update(userStats)
          .set({
            totalWebhookTriggers: sql`total_webhook_triggers + 1`,
            lastActive: sql`now()`,
          })
          .where(eq(userStats.userId, payload.userId))
      }
    }

    // Build trace spans and complete logging session
    const { traceSpans, totalDuration } = buildTraceSpans(executionResult)

    await loggingSession.safeComplete({
      endedAt: new Date().toISOString(),
      totalDurationMs: totalDuration || 0,
      finalOutput: executionResult.output || {},
      traceSpans: traceSpans as any,
    })

    return {
      success: executionResult.success,
      workflowId: payload.workflowId,
      executionId,
      output: executionResult.output,
      executedAt: new Date().toISOString(),
      provider: payload.provider,
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Webhook execution failed`, {
      error: error.message,
      stack: error.stack,
      workflowId: payload.workflowId,
      provider: payload.provider,
    })

    // Complete logging session with error (matching workflow-execution pattern)
    try {
      const executionResult = (error?.executionResult as ExecutionResult | undefined) || {
        success: false,
        output: {},
        logs: [],
      }
      const { traceSpans } = buildTraceSpans(executionResult)

      await loggingSession.safeCompleteWithError({
        endedAt: new Date().toISOString(),
        totalDurationMs: 0,
        error: {
          message: error.message || 'Webhook execution failed',
          stackTrace: error.stack,
        },
        traceSpans,
      })
    } catch (loggingError) {
      logger.error(`[${requestId}] Failed to complete logging session`, loggingError)
    }

    throw error
  }
}

export const webhookExecution = task({
  id: 'webhook-execution',
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: WebhookExecutionPayload) => executeWebhookJob(payload),
})
