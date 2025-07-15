import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getCostMultiplier } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { snapshotService } from '@/lib/logs/snapshot-service'
import { db } from '@/db'
import { userStats, workflow, workflowExecutionBlocks, workflowExecutionLogs } from '@/db/schema'
import type {
  BlockExecutionLog,
  BlockInputData,
  BlockOutputData,
  CostBreakdown,
  ExecutionEnvironment,
  ExecutionTrigger,
  ExecutionLoggerService as IExecutionLoggerService,
  TraceSpan,
  WorkflowExecutionLog,
  WorkflowExecutionSnapshot,
  WorkflowState,
} from './types'

export interface ToolCall {
  name: string
  duration: number // in milliseconds
  startTime: string // ISO timestamp
  endTime: string // ISO timestamp
  status: 'success' | 'error'
  input?: Record<string, any>
  output?: Record<string, any>
  error?: string
}

const logger = createLogger('EnhancedExecutionLogger')

export class EnhancedExecutionLogger implements IExecutionLoggerService {
  async startWorkflowExecution(params: {
    workflowId: string
    executionId: string
    trigger: ExecutionTrigger
    environment: ExecutionEnvironment
    workflowState: WorkflowState
  }): Promise<{
    workflowLog: WorkflowExecutionLog
    snapshot: WorkflowExecutionSnapshot
  }> {
    const { workflowId, executionId, trigger, environment, workflowState } = params

    logger.debug(`Starting workflow execution ${executionId} for workflow ${workflowId}`)

    const snapshotResult = await snapshotService.createSnapshotWithDeduplication(
      workflowId,
      workflowState
    )

    const startTime = new Date()

    const [workflowLog] = await db
      .insert(workflowExecutionLogs)
      .values({
        id: uuidv4(),
        workflowId,
        executionId,
        stateSnapshotId: snapshotResult.snapshot.id,
        level: 'info',
        message: `${this.getTriggerPrefix(trigger.type)} execution started`,
        trigger: trigger.type,
        startedAt: startTime,
        endedAt: null,
        totalDurationMs: null,
        blockCount: 0,
        successCount: 0,
        errorCount: 0,
        skippedCount: 0,
        totalCost: null,
        totalInputCost: null,
        totalOutputCost: null,
        totalTokens: null,
        metadata: {
          environment,
          trigger,
        },
      })
      .returning()

    logger.debug(`Created workflow log ${workflowLog.id} for execution ${executionId}`)

    return {
      workflowLog: {
        id: workflowLog.id,
        workflowId: workflowLog.workflowId,
        executionId: workflowLog.executionId,
        stateSnapshotId: workflowLog.stateSnapshotId,
        level: workflowLog.level as 'info' | 'error',
        message: workflowLog.message,
        trigger: workflowLog.trigger as ExecutionTrigger['type'],
        startedAt: workflowLog.startedAt.toISOString(),
        endedAt: workflowLog.endedAt?.toISOString() || workflowLog.startedAt.toISOString(),
        totalDurationMs: workflowLog.totalDurationMs || 0,
        blockCount: workflowLog.blockCount,
        successCount: workflowLog.successCount,
        errorCount: workflowLog.errorCount,
        skippedCount: workflowLog.skippedCount,
        totalCost: Number(workflowLog.totalCost) || 0,
        totalInputCost: Number(workflowLog.totalInputCost) || 0,
        totalOutputCost: Number(workflowLog.totalOutputCost) || 0,
        totalTokens: workflowLog.totalTokens || 0,
        metadata: workflowLog.metadata as WorkflowExecutionLog['metadata'],
        createdAt: workflowLog.createdAt.toISOString(),
      },
      snapshot: snapshotResult.snapshot,
    }
  }

  async logBlockExecution(params: {
    executionId: string
    workflowId: string
    blockId: string
    blockName: string
    blockType: string
    input: BlockInputData
    output: BlockOutputData
    timing: {
      startedAt: string
      endedAt: string
      durationMs: number
    }
    status: BlockExecutionLog['status']
    error?: {
      message: string
      stackTrace?: string
    }
    cost?: CostBreakdown
    metadata?: BlockExecutionLog['metadata']
    toolCalls?: ToolCall[]
  }): Promise<BlockExecutionLog> {
    const {
      executionId,
      workflowId,
      blockId,
      blockName,
      blockType,
      input,
      output,
      timing,
      status,
      error,
      cost,
      metadata,
      toolCalls,
    } = params

    logger.debug(`Logging block execution ${blockId} for execution ${executionId}`)

    const blockLogId = uuidv4()

    const [blockLog] = await db
      .insert(workflowExecutionBlocks)
      .values({
        id: blockLogId,
        executionId,
        workflowId,
        blockId,
        blockName,
        blockType,
        startedAt: new Date(timing.startedAt),
        endedAt: new Date(timing.endedAt),
        durationMs: timing.durationMs,
        status,
        errorMessage: error?.message || null,
        errorStackTrace: error?.stackTrace || null,
        inputData: input,
        outputData: output,
        costInput: cost?.input ? cost.input.toString() : null,
        costOutput: cost?.output ? cost.output.toString() : null,
        costTotal: cost?.total ? cost.total.toString() : null,
        tokensPrompt: cost?.tokens?.prompt || null,
        tokensCompletion: cost?.tokens?.completion || null,
        tokensTotal: cost?.tokens?.total || null,
        modelUsed: cost?.model || null,
        metadata: {
          ...(metadata || {}),
          ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
        },
      })
      .returning()

    logger.debug(`Created block log ${blockLog.id} for block ${blockId}`)

    return {
      id: blockLog.id,
      executionId: blockLog.executionId,
      workflowId: blockLog.workflowId,
      blockId: blockLog.blockId,
      blockName: blockLog.blockName || '',
      blockType: blockLog.blockType,
      startedAt: blockLog.startedAt.toISOString(),
      endedAt: blockLog.endedAt?.toISOString() || timing.endedAt,
      durationMs: blockLog.durationMs || timing.durationMs,
      status: blockLog.status as BlockExecutionLog['status'],
      errorMessage: blockLog.errorMessage || undefined,
      errorStackTrace: blockLog.errorStackTrace || undefined,
      inputData: input,
      outputData: output,
      cost: cost || null,
      metadata: (blockLog.metadata as BlockExecutionLog['metadata']) || {},
      createdAt: blockLog.createdAt.toISOString(),
    }
  }

  async completeWorkflowExecution(params: {
    executionId: string
    endedAt: string
    totalDurationMs: number
    costSummary: {
      totalCost: number
      totalInputCost: number
      totalOutputCost: number
      totalTokens: number
      totalPromptTokens: number
      totalCompletionTokens: number
      models: Record<
        string,
        {
          input: number
          output: number
          total: number
          tokens: { prompt: number; completion: number; total: number }
        }
      >
    }
    finalOutput: BlockOutputData
    traceSpans?: TraceSpan[]
  }): Promise<WorkflowExecutionLog> {
    const { executionId, endedAt, totalDurationMs, costSummary, finalOutput, traceSpans } = params

    logger.debug(`Completing workflow execution ${executionId}`)

    // Determine if workflow failed by checking trace spans for errors
    const hasErrors = traceSpans?.some((span: any) => {
      const checkSpanForErrors = (s: any): boolean => {
        if (s.status === 'error') return true
        if (s.children && Array.isArray(s.children)) {
          return s.children.some(checkSpanForErrors)
        }
        return false
      }
      return checkSpanForErrors(span)
    })

    const level = hasErrors ? 'error' : 'info'
    const message = hasErrors ? 'Workflow execution failed' : 'Workflow execution completed'

    const [updatedLog] = await db
      .update(workflowExecutionLogs)
      .set({
        level,
        message,
        endedAt: new Date(endedAt),
        totalDurationMs,
        blockCount: 0,
        successCount: 0,
        errorCount: 0,
        skippedCount: 0,
        totalCost: costSummary.totalCost.toString(),
        totalInputCost: costSummary.totalInputCost.toString(),
        totalOutputCost: costSummary.totalOutputCost.toString(),
        totalTokens: costSummary.totalTokens,
        metadata: {
          traceSpans,
          finalOutput,
          tokenBreakdown: {
            prompt: costSummary.totalPromptTokens,
            completion: costSummary.totalCompletionTokens,
            total: costSummary.totalTokens,
          },
          models: costSummary.models,
        },
      })
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .returning()

    if (!updatedLog) {
      throw new Error(`Workflow log not found for execution ${executionId}`)
    }

    // Update user stats with cost information (same logic as original execution logger)
    await this.updateUserStats(
      updatedLog.workflowId,
      costSummary,
      updatedLog.trigger as ExecutionTrigger['type']
    )

    logger.debug(`Completed workflow execution ${executionId}`)

    return {
      id: updatedLog.id,
      workflowId: updatedLog.workflowId,
      executionId: updatedLog.executionId,
      stateSnapshotId: updatedLog.stateSnapshotId,
      level: updatedLog.level as 'info' | 'error',
      message: updatedLog.message,
      trigger: updatedLog.trigger as ExecutionTrigger['type'],
      startedAt: updatedLog.startedAt.toISOString(),
      endedAt: updatedLog.endedAt?.toISOString() || endedAt,
      totalDurationMs: updatedLog.totalDurationMs || totalDurationMs,
      blockCount: updatedLog.blockCount,
      successCount: updatedLog.successCount,
      errorCount: updatedLog.errorCount,
      skippedCount: updatedLog.skippedCount,
      totalCost: Number(updatedLog.totalCost) || 0,
      totalInputCost: Number(updatedLog.totalInputCost) || 0,
      totalOutputCost: Number(updatedLog.totalOutputCost) || 0,
      totalTokens: updatedLog.totalTokens || 0,
      metadata: updatedLog.metadata as WorkflowExecutionLog['metadata'],
      createdAt: updatedLog.createdAt.toISOString(),
    }
  }

  async getBlockExecutionsForWorkflow(executionId: string): Promise<BlockExecutionLog[]> {
    const blockLogs = await db
      .select()
      .from(workflowExecutionBlocks)
      .where(eq(workflowExecutionBlocks.executionId, executionId))
      .orderBy(workflowExecutionBlocks.startedAt)

    return blockLogs.map((log) => ({
      id: log.id,
      executionId: log.executionId,
      workflowId: log.workflowId,
      blockId: log.blockId,
      blockName: log.blockName || '',
      blockType: log.blockType,
      startedAt: log.startedAt.toISOString(),
      endedAt: log.endedAt?.toISOString() || log.startedAt.toISOString(),
      durationMs: log.durationMs || 0,
      status: log.status as BlockExecutionLog['status'],
      errorMessage: log.errorMessage || undefined,
      errorStackTrace: log.errorStackTrace || undefined,
      inputData: log.inputData as BlockInputData,
      outputData: log.outputData as BlockOutputData,
      cost: log.costTotal
        ? {
            input: Number(log.costInput) || 0,
            output: Number(log.costOutput) || 0,
            total: Number(log.costTotal) || 0,
            tokens: {
              prompt: log.tokensPrompt || 0,
              completion: log.tokensCompletion || 0,
              total: log.tokensTotal || 0,
            },
            model: log.modelUsed || '',
            pricing: {
              input: 0,
              output: 0,
              updatedAt: new Date().toISOString(),
            },
          }
        : null,
      metadata: (log.metadata as BlockExecutionLog['metadata']) || {},
      createdAt: log.createdAt.toISOString(),
    }))
  }

  async getWorkflowExecution(executionId: string): Promise<WorkflowExecutionLog | null> {
    const [workflowLog] = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (!workflowLog) return null

    return {
      id: workflowLog.id,
      workflowId: workflowLog.workflowId,
      executionId: workflowLog.executionId,
      stateSnapshotId: workflowLog.stateSnapshotId,
      level: workflowLog.level as 'info' | 'error',
      message: workflowLog.message,
      trigger: workflowLog.trigger as ExecutionTrigger['type'],
      startedAt: workflowLog.startedAt.toISOString(),
      endedAt: workflowLog.endedAt?.toISOString() || workflowLog.startedAt.toISOString(),
      totalDurationMs: workflowLog.totalDurationMs || 0,
      blockCount: workflowLog.blockCount,
      successCount: workflowLog.successCount,
      errorCount: workflowLog.errorCount,
      skippedCount: workflowLog.skippedCount,
      totalCost: Number(workflowLog.totalCost) || 0,
      totalInputCost: Number(workflowLog.totalInputCost) || 0,
      totalOutputCost: Number(workflowLog.totalOutputCost) || 0,
      totalTokens: workflowLog.totalTokens || 0,
      metadata: workflowLog.metadata as WorkflowExecutionLog['metadata'],
      createdAt: workflowLog.createdAt.toISOString(),
    }
  }

  /**
   * Updates user stats with cost and token information
   * Maintains same logic as original execution logger for billing consistency
   */
  private async updateUserStats(
    workflowId: string,
    costSummary: {
      totalCost: number
      totalInputCost: number
      totalOutputCost: number
      totalTokens: number
      totalPromptTokens: number
      totalCompletionTokens: number
    },
    trigger: ExecutionTrigger['type']
  ): Promise<void> {
    if (costSummary.totalCost <= 0) {
      logger.debug('No cost to update in user stats')
      return
    }

    try {
      // Get the workflow record to get the userId
      const [workflowRecord] = await db
        .select()
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflowRecord) {
        logger.error(`Workflow ${workflowId} not found for user stats update`)
        return
      }

      const userId = workflowRecord.userId
      const costMultiplier = getCostMultiplier()
      const costToStore = costSummary.totalCost * costMultiplier

      // Check if user stats record exists
      const userStatsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))

      if (userStatsRecords.length === 0) {
        // Create new user stats record with trigger-specific counts
        const triggerCounts = this.getTriggerCounts(trigger)

        await db.insert(userStats).values({
          id: crypto.randomUUID(),
          userId: userId,
          totalManualExecutions: triggerCounts.manual,
          totalApiCalls: triggerCounts.api,
          totalWebhookTriggers: triggerCounts.webhook,
          totalScheduledExecutions: triggerCounts.schedule,
          totalChatExecutions: triggerCounts.chat,
          totalTokensUsed: costSummary.totalTokens,
          totalCost: costToStore.toString(),
          currentPeriodCost: costToStore.toString(), // Initialize current period usage
          lastActive: new Date(),
        })

        logger.debug('Created new user stats record with cost data', {
          userId,
          trigger,
          totalCost: costToStore,
          totalTokens: costSummary.totalTokens,
        })
      } else {
        // Update existing user stats record with trigger-specific increments
        const updateFields: any = {
          totalTokensUsed: sql`total_tokens_used + ${costSummary.totalTokens}`,
          totalCost: sql`total_cost + ${costToStore}`,
          currentPeriodCost: sql`current_period_cost + ${costToStore}`, // Track current billing period usage
          lastActive: new Date(),
        }

        // Add trigger-specific increment
        switch (trigger) {
          case 'manual':
            updateFields.totalManualExecutions = sql`total_manual_executions + 1`
            break
          case 'api':
            updateFields.totalApiCalls = sql`total_api_calls + 1`
            break
          case 'webhook':
            updateFields.totalWebhookTriggers = sql`total_webhook_triggers + 1`
            break
          case 'schedule':
            updateFields.totalScheduledExecutions = sql`total_scheduled_executions + 1`
            break
          case 'chat':
            updateFields.totalChatExecutions = sql`total_chat_executions + 1`
            break
        }

        await db.update(userStats).set(updateFields).where(eq(userStats.userId, userId))

        logger.debug('Updated existing user stats record with cost data', {
          userId,
          trigger,
          addedCost: costToStore,
          addedTokens: costSummary.totalTokens,
        })
      }
    } catch (error) {
      logger.error('Error updating user stats with cost information', {
        workflowId,
        error,
        costSummary,
      })
      // Don't throw - we want execution to continue even if user stats update fails
    }
  }

  /**
   * Get trigger counts for new user stats records
   */
  private getTriggerCounts(trigger: ExecutionTrigger['type']): {
    manual: number
    api: number
    webhook: number
    schedule: number
    chat: number
  } {
    const counts = { manual: 0, api: 0, webhook: 0, schedule: 0, chat: 0 }
    switch (trigger) {
      case 'manual':
        counts.manual = 1
        break
      case 'api':
        counts.api = 1
        break
      case 'webhook':
        counts.webhook = 1
        break
      case 'schedule':
        counts.schedule = 1
        break
      case 'chat':
        counts.chat = 1
        break
    }
    return counts
  }

  private getTriggerPrefix(triggerType: ExecutionTrigger['type']): string {
    switch (triggerType) {
      case 'api':
        return 'API'
      case 'webhook':
        return 'Webhook'
      case 'schedule':
        return 'Scheduled'
      case 'manual':
        return 'Manual'
      case 'chat':
        return 'Chat'
      default:
        return 'Unknown'
    }
  }
}

export const enhancedExecutionLogger = new EnhancedExecutionLogger()
