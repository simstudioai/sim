import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/db'
import { workflowExecutionBlocks, workflowExecutionLogs } from '@/db/schema'
import { createLogger } from './console-logger'
import { snapshotService } from './snapshot-service'
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
        metadata: metadata || {},
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
    blockStats: {
      total: number
      success: number
      error: number
      skipped: number
    }
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
    const {
      executionId,
      endedAt,
      totalDurationMs,
      blockStats,
      costSummary,
      finalOutput,
      traceSpans,
    } = params

    logger.debug(`Completing workflow execution ${executionId}`)

    const level = blockStats.error > 0 ? 'error' : 'info'
    const message =
      blockStats.error > 0
        ? `Workflow execution failed: ${blockStats.error} error(s), ${blockStats.success} success(es)`
        : `Workflow execution completed: ${blockStats.success} block(s) executed successfully`

    const [updatedLog] = await db
      .update(workflowExecutionLogs)
      .set({
        level,
        message,
        endedAt: new Date(endedAt),
        totalDurationMs,
        blockCount: blockStats.total,
        successCount: blockStats.success,
        errorCount: blockStats.error,
        skippedCount: blockStats.skipped,
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
