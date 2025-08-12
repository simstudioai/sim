import { task } from '@trigger.dev/sdk/v3'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { decryptSecret } from '@/lib/utils'
import { fetchAndProcessAirtablePayloads, formatWebhookInput } from '@/lib/webhooks/utils'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { db } from '@/db'
import { environment as environmentTable, userStats, webhook } from '@/db/schema'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('TriggerWebhookExecution')

export const webhookExecution = task({
  id: 'webhook-execution',
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: {
    webhookId: string
    workflowId: string
    userId: string
    provider: string
    body: any
    headers: Record<string, string>
    path: string
    blockId?: string
  }) => {
    const executionId = uuidv4()
    const requestId = executionId.slice(0, 8)

    logger.info(`[${requestId}] Starting webhook execution via trigger.dev`, {
      webhookId: payload.webhookId,
      workflowId: payload.workflowId,
      provider: payload.provider,
      userId: payload.userId,
      executionId,
    })

    // Initialize logging session outside try block so it's available in catch
    const loggingSession = new LoggingSession(payload.workflowId, executionId, 'webhook', requestId)

    try {
      // Check usage limits first
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

      // Load workflow from normalized tables
      const workflowData = await loadWorkflowFromNormalizedTables(payload.workflowId)
      if (!workflowData) {
        throw new Error(`Workflow not found: ${payload.workflowId}`)
      }

      const { blocks, edges, loops, parallels } = workflowData

      // Get environment variables (matching workflow-execution pattern)
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

      // Start logging session
      await loggingSession.safeStart({
        userId: payload.userId,
        workspaceId: '', // TODO: Get from workflow if needed
        variables: decryptedEnvVars,
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
        logger.info(
          `[${requestId}] Processing Airtable webhook via fetchAndProcessAirtablePayloads`
        )

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
              workspaceId: '',
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
          workspaceId: '', // TODO: Get from workflow if needed - see comment on line 103
        },
      })

      // Set up logging on the executor
      loggingSession.setupExecutor(executor)

      logger.info(`[${requestId}] Executing workflow for ${payload.provider} webhook`)

      // Execute the workflow
      const result = await executor.execute(payload.workflowId, payload.blockId)

      // Check if we got a StreamingExecution result
      const executionResult =
        'stream' in result && 'execution' in result ? result.execution : result

      logger.info(`[${requestId}] Webhook execution completed`, {
        success: executionResult.success,
        workflowId: payload.workflowId,
        provider: payload.provider,
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
    } catch (error: any) {
      logger.error(`[${requestId}] Webhook execution failed`, {
        error: error.message,
        stack: error.stack,
        workflowId: payload.workflowId,
        provider: payload.provider,
      })

      // Complete logging session with error (matching workflow-execution pattern)
      try {
        await loggingSession.safeCompleteWithError({
          endedAt: new Date().toISOString(),
          totalDurationMs: 0,
          error: {
            message: error.message || 'Webhook execution failed',
            stackTrace: error.stack,
          },
        })
      } catch (loggingError) {
        logger.error(`[${requestId}] Failed to complete logging session`, loggingError)
      }

      throw error // Let Trigger.dev handle retries
    }
  },
})
