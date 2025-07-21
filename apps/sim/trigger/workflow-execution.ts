import { task } from '@trigger.dev/sdk/v3'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { EnhancedLoggingSession } from '@/lib/logs/enhanced-logging-session'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
import { decryptSecret } from '@/lib/utils'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { db } from '@/db'
import { environment as environmentTable, userStats } from '@/db/schema'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('TriggerWorkflowExecution')

export const workflowExecution = task({
  id: 'workflow-execution',
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: {
    workflowId: string
    userId: string
    input?: any
    triggerType?: string
    metadata?: Record<string, any>
  }) => {
    const workflowId = payload.workflowId
    const executionId = uuidv4()
    const requestId = executionId.slice(0, 8)

    logger.info(`[${requestId}] Starting Trigger.dev workflow execution: ${workflowId}`, {
      userId: payload.userId,
      triggerType: payload.triggerType,
      executionId,
    })

    // Initialize enhanced logging session
    const triggerType =
      (payload.triggerType as 'api' | 'webhook' | 'schedule' | 'manual' | 'chat') || 'api'
    const loggingSession = new EnhancedLoggingSession(
      workflowId,
      executionId,
      triggerType,
      requestId
    )

    try {
      // Load workflow data from normalized tables
      const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
      if (!normalizedData) {
        logger.error(`[${requestId}] Workflow not found in normalized tables: ${workflowId}`)
        throw new Error(`Workflow ${workflowId} data not found in normalized tables`)
      }

      logger.info(`[${requestId}] Workflow loaded successfully: ${workflowId}`)

      const { blocks, edges, loops, parallels } = normalizedData

      // Merge subblock states (server-safe version doesn't need workflowId)
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

      // Get environment variables
      const [userEnv] = await db
        .select()
        .from(environmentTable)
        .where(eq(environmentTable.userId, payload.userId))
        .limit(1)

      let decryptedEnvVars: Record<string, string> = {}
      if (userEnv) {
        const decryptionPromises = Object.entries((userEnv.variables as any) || {}).map(
          async ([key, encryptedValue]) => {
            try {
              const { decrypted } = await decryptSecret(encryptedValue as string)
              return [key, decrypted] as const
            } catch (error: any) {
              logger.error(`[${requestId}] Failed to decrypt environment variable "${key}":`, error)
              throw new Error(`Failed to decrypt environment variable "${key}": ${error.message}`)
            }
          }
        )

        const decryptedPairs = await Promise.all(decryptionPromises)
        decryptedEnvVars = Object.fromEntries(decryptedPairs)
      }

      // Start enhanced logging session
      await loggingSession.safeStart({
        userId: payload.userId,
        workspaceId: '', // TODO: Get from workflow if needed
        variables: decryptedEnvVars,
      })

      // Create serialized workflow
      const serializer = new Serializer()
      const serializedWorkflow = serializer.serializeWorkflow(
        mergedStates,
        edges,
        loops || {},
        parallels || {}
      )

      // Create executor and execute
      const executor = new Executor(
        serializedWorkflow,
        processedBlockStates,
        decryptedEnvVars,
        payload.input || {},
        {} // workflow variables
      )

      // Set up enhanced logging on the executor
      loggingSession.setupExecutor(executor)

      const result = await executor.execute(workflowId)

      // Handle streaming vs regular result
      const executionResult =
        'stream' in result && 'execution' in result ? result.execution : result

      logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
        success: executionResult.success,
        executionTime: executionResult.metadata?.duration,
        executionId,
      })

      // Update workflow run counts on success
      if (executionResult.success) {
        await updateWorkflowRunCounts(workflowId)

        // Track execution in user stats
        const statsUpdate =
          triggerType === 'api'
            ? { totalApiCalls: sql`total_api_calls + 1` }
            : triggerType === 'webhook'
              ? { totalWebhookTriggers: sql`total_webhook_triggers + 1` }
              : triggerType === 'schedule'
                ? { totalScheduledExecutions: sql`total_scheduled_executions + 1` }
                : { totalManualExecutions: sql`total_manual_executions + 1` }

        await db
          .update(userStats)
          .set({
            ...statsUpdate,
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
        metadata: payload.metadata,
      }
    } catch (error: any) {
      logger.error(`[${requestId}] Workflow execution failed: ${workflowId}`, {
        error: error.message,
        stack: error.stack,
      })

      await loggingSession.safeCompleteWithError({
        endedAt: new Date().toISOString(),
        totalDurationMs: 0,
        error: {
          message: error.message || 'Workflow execution failed',
          stackTrace: error.stack,
        },
      })

      throw error // Let Trigger.dev handle retries
    }
  },
})
