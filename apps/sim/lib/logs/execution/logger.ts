import { db } from '@sim/db'
import {
  member,
  userStats,
  user as userTable,
  workflow,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import {
  checkUsageStatus,
  getOrgUsageLimit,
  maybeSendUsageThresholdEmail,
} from '@/lib/billing/core/usage'
import { type ModelUsageMetadata, recordUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { redactApiKeys } from '@/lib/core/security/redaction'
import { filterForDisplay } from '@/lib/core/utils/display-filters'
import { emitWorkflowExecutionCompleted } from '@/lib/logs/events'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import type {
  BlockOutputData,
  ExecutionEnvironment,
  ExecutionFinalizationPath,
  ExecutionTrigger,
  ExecutionLoggerService as IExecutionLoggerService,
  TraceSpan,
  WorkflowExecutionLog,
  WorkflowExecutionSnapshot,
  WorkflowState,
} from '@/lib/logs/types'
import type { SerializableExecutionState } from '@/executor/execution/types'

/** Maps execution trigger types to their corresponding userStats counter columns */
const TRIGGER_COUNTER_MAP: Record<string, { key: string; column: string }> = {
  manual: { key: 'totalManualExecutions', column: 'total_manual_executions' },
  api: { key: 'totalApiCalls', column: 'total_api_calls' },
  webhook: { key: 'totalWebhookTriggers', column: 'total_webhook_triggers' },
  schedule: { key: 'totalScheduledExecutions', column: 'total_scheduled_executions' },
  chat: { key: 'totalChatExecutions', column: 'total_chat_executions' },
  mcp: { key: 'totalMcpExecutions', column: 'total_mcp_executions' },
  a2a: { key: 'totalA2aExecutions', column: 'total_a2a_executions' },
} as const

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

const logger = createLogger('ExecutionLogger')

function countTraceSpans(traceSpans?: TraceSpan[]): number {
  if (!Array.isArray(traceSpans) || traceSpans.length === 0) {
    return 0
  }

  return traceSpans.reduce((count, span) => count + 1 + countTraceSpans(span.children), 0)
}

export class ExecutionLogger implements IExecutionLoggerService {
  private buildCompletedExecutionData(params: {
    existingExecutionData?: WorkflowExecutionLog['executionData']
    traceSpans?: TraceSpan[]
    finalOutput: BlockOutputData
    finalizationPath?: ExecutionFinalizationPath
    completionFailure?: string
    executionCost: {
      tokens: {
        input: number
        output: number
        total: number
      }
      models: NonNullable<WorkflowExecutionLog['executionData']['models']>
    }
    executionState?: SerializableExecutionState
  }): WorkflowExecutionLog['executionData'] {
    const {
      existingExecutionData,
      traceSpans,
      finalOutput,
      finalizationPath,
      completionFailure,
      executionCost,
      executionState,
    } = params
    const traceSpanCount = countTraceSpans(traceSpans)

    return {
      ...(existingExecutionData?.environment
        ? { environment: existingExecutionData.environment }
        : {}),
      ...(existingExecutionData?.trigger ? { trigger: existingExecutionData.trigger } : {}),
      ...(existingExecutionData?.correlation || existingExecutionData?.trigger?.data?.correlation
        ? {
            correlation:
              existingExecutionData?.correlation ||
              existingExecutionData?.trigger?.data?.correlation,
          }
        : {}),
      ...(existingExecutionData?.error ? { error: existingExecutionData.error } : {}),
      ...(existingExecutionData?.lastStartedBlock
        ? { lastStartedBlock: existingExecutionData.lastStartedBlock }
        : {}),
      ...(existingExecutionData?.lastCompletedBlock
        ? { lastCompletedBlock: existingExecutionData.lastCompletedBlock }
        : {}),
      ...(completionFailure ? { completionFailure } : {}),
      ...(finalizationPath ? { finalizationPath } : {}),
      hasTraceSpans: traceSpanCount > 0,
      traceSpanCount,
      traceSpans,
      finalOutput,
      tokens: {
        input: executionCost.tokens.input,
        output: executionCost.tokens.output,
        total: executionCost.tokens.total,
      },
      models: executionCost.models,
      ...(executionState ? { executionState } : {}),
    }
  }

  async startWorkflowExecution(params: {
    workflowId: string
    workspaceId: string
    executionId: string
    trigger: ExecutionTrigger
    environment: ExecutionEnvironment
    workflowState: WorkflowState
    deploymentVersionId?: string
  }): Promise<{
    workflowLog: WorkflowExecutionLog
    snapshot: WorkflowExecutionSnapshot
  }> {
    const {
      workflowId,
      workspaceId,
      executionId,
      trigger,
      environment,
      workflowState,
      deploymentVersionId,
    } = params
    const execLog = logger.withMetadata({ workflowId, workspaceId, executionId })

    execLog.debug('Starting workflow execution')

    // Check if execution log already exists (idempotency check)
    const existingLog = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (existingLog.length > 0) {
      execLog.debug('Execution log already exists, skipping duplicate INSERT (idempotent)')
      const snapshot = await snapshotService.getSnapshot(existingLog[0].stateSnapshotId)
      if (!snapshot) {
        throw new Error(`Snapshot ${existingLog[0].stateSnapshotId} not found for existing log`)
      }
      return {
        workflowLog: {
          id: existingLog[0].id,
          workflowId: existingLog[0].workflowId,
          executionId: existingLog[0].executionId,
          stateSnapshotId: existingLog[0].stateSnapshotId,
          level: existingLog[0].level as 'info' | 'error',
          trigger: existingLog[0].trigger as ExecutionTrigger['type'],
          startedAt: existingLog[0].startedAt.toISOString(),
          endedAt: existingLog[0].endedAt?.toISOString() || existingLog[0].startedAt.toISOString(),
          totalDurationMs: existingLog[0].totalDurationMs || 0,
          executionData: existingLog[0].executionData as WorkflowExecutionLog['executionData'],
          createdAt: existingLog[0].createdAt.toISOString(),
        },
        snapshot,
      }
    }

    const snapshotResult = await snapshotService.createSnapshotWithDeduplication(
      workflowId,
      workflowState
    )

    const startTime = new Date()

    const [workflowLog] = await db
      .insert(workflowExecutionLogs)
      .values({
        id: generateId(),
        workflowId,
        workspaceId,
        executionId,
        stateSnapshotId: snapshotResult.snapshot.id,
        deploymentVersionId: deploymentVersionId ?? null,
        level: 'info',
        status: 'running',
        trigger: trigger.type,
        startedAt: startTime,
        endedAt: null,
        totalDurationMs: null,
        executionData: {
          environment,
          trigger,
          ...(trigger.data?.correlation ? { correlation: trigger.data.correlation } : {}),
          hasTraceSpans: false,
          traceSpanCount: 0,
        },
        cost: {
          total: BASE_EXECUTION_CHARGE,
          input: 0,
          output: 0,
          tokens: { input: 0, output: 0, total: 0 },
          models: {},
        },
      })
      .returning()

    execLog.debug('Created workflow log', { logId: workflowLog.id })

    return {
      workflowLog: {
        id: workflowLog.id,
        workflowId: workflowLog.workflowId,
        executionId: workflowLog.executionId,
        stateSnapshotId: workflowLog.stateSnapshotId,
        level: workflowLog.level as 'info' | 'error',
        trigger: workflowLog.trigger as ExecutionTrigger['type'],
        startedAt: workflowLog.startedAt.toISOString(),
        endedAt: workflowLog.endedAt?.toISOString() || workflowLog.startedAt.toISOString(),
        totalDurationMs: workflowLog.totalDurationMs || 0,
        executionData: workflowLog.executionData as WorkflowExecutionLog['executionData'],
        createdAt: workflowLog.createdAt.toISOString(),
      },
      snapshot: snapshotResult.snapshot,
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
      baseExecutionCharge: number
      modelCost: number
      models: Record<
        string,
        {
          input: number
          output: number
          total: number
          toolCost?: number
          tokens: { input: number; output: number; total: number }
        }
      >
    }
    finalOutput: BlockOutputData
    traceSpans?: TraceSpan[]
    workflowInput?: any
    executionState?: SerializableExecutionState
    finalizationPath?: ExecutionFinalizationPath
    completionFailure?: string
    isResume?: boolean
    level?: 'info' | 'error'
    status?: 'completed' | 'failed' | 'cancelled' | 'pending'
  }): Promise<WorkflowExecutionLog> {
    const {
      executionId,
      endedAt,
      totalDurationMs,
      costSummary,
      finalOutput,
      traceSpans,
      workflowInput,
      executionState,
      finalizationPath,
      completionFailure,
      isResume,
      level: levelOverride,
      status: statusOverride,
    } = params

    let execLog = logger.withMetadata({ executionId })
    execLog.debug('Completing workflow execution', { isResume })

    const [existingLog] = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)
    if (existingLog) {
      execLog = execLog.withMetadata({
        workflowId: existingLog.workflowId ?? undefined,
        workspaceId: existingLog.workspaceId ?? undefined,
      })
    }
    const billingUserId = this.extractBillingUserId(existingLog?.executionData)
    const existingExecutionData = existingLog?.executionData as
      | WorkflowExecutionLog['executionData']
      | undefined

    // Determine if workflow failed by checking trace spans for unhandled errors
    // Errors handled by error handler paths (errorHandled: true) don't count as workflow failures
    // Use the override if provided (for cost-only fallback scenarios)
    const hasErrors = traceSpans?.some((span: any) => {
      const checkSpanForErrors = (s: any): boolean => {
        if (s.status === 'error' && !s.errorHandled) return true
        if (s.children && Array.isArray(s.children)) {
          return s.children.some(checkSpanForErrors)
        }
        return false
      }
      return checkSpanForErrors(span)
    })

    const level = levelOverride ?? (hasErrors ? 'error' : 'info')
    const status = statusOverride ?? (hasErrors ? 'failed' : 'completed')

    // Extract files from trace spans, final output, and workflow input
    const executionFiles = this.extractFilesFromExecution(traceSpans, finalOutput, workflowInput)

    // For resume executions, rebuild trace spans from the aggregated logs
    const mergedTraceSpans = isResume
      ? traceSpans && traceSpans.length > 0
        ? traceSpans
        : existingExecutionData?.traceSpans || []
      : traceSpans

    const filteredTraceSpans = filterForDisplay(mergedTraceSpans)
    const filteredFinalOutput = filterForDisplay(finalOutput)
    const redactedTraceSpans = redactApiKeys(filteredTraceSpans)
    const redactedFinalOutput = redactApiKeys(filteredFinalOutput)

    const executionCost = {
      total: costSummary.totalCost,
      input: costSummary.totalInputCost,
      output: costSummary.totalOutputCost,
      tokens: {
        input: costSummary.totalPromptTokens,
        output: costSummary.totalCompletionTokens,
        total: costSummary.totalTokens,
      },
      models: costSummary.models,
    }

    const rawDurationMs =
      isResume && existingLog?.startedAt
        ? new Date(endedAt).getTime() - new Date(existingLog.startedAt).getTime()
        : totalDurationMs
    const totalDuration =
      typeof rawDurationMs === 'number' && Number.isFinite(rawDurationMs)
        ? Math.max(0, Math.round(rawDurationMs))
        : 0

    const completedExecutionData = this.buildCompletedExecutionData({
      existingExecutionData,
      traceSpans: redactedTraceSpans,
      finalOutput: redactedFinalOutput,
      finalizationPath,
      completionFailure,
      executionCost,
      executionState,
    })

    const [updatedLog] = await db
      .update(workflowExecutionLogs)
      .set({
        level,
        status,
        endedAt: new Date(endedAt),
        totalDurationMs: totalDuration,
        files: executionFiles.length > 0 ? executionFiles : null,
        executionData: completedExecutionData,
        cost: executionCost,
      })
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .returning()

    if (!updatedLog) {
      throw new Error(`Workflow log not found for execution ${executionId}`)
    }

    try {
      // Skip workflow lookup if workflow was deleted
      const wf = updatedLog.workflowId
        ? (await db.select().from(workflow).where(eq(workflow.id, updatedLog.workflowId)))[0]
        : undefined
      if (wf && billingUserId) {
        const [usr] = await db
          .select({ id: userTable.id, email: userTable.email, name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, billingUserId))
          .limit(1)

        if (usr?.email) {
          const sub = await getHighestPrioritySubscription(usr.id)

          const costDelta = costSummary.totalCost

          const { getDisplayPlanName } = await import('@/lib/billing/plan-helpers')
          const { isOrgScopedSubscription } = await import('@/lib/billing/subscriptions/utils')
          const planName = getDisplayPlanName(sub?.plan)
          const scope: 'user' | 'organization' = isOrgScopedSubscription(sub, usr.id)
            ? 'organization'
            : 'user'

          if (scope === 'user') {
            const before = await checkUsageStatus(usr.id)

            await this.updateUserStats(
              updatedLog.workflowId,
              costSummary,
              updatedLog.trigger as ExecutionTrigger['type'],
              executionId,
              billingUserId
            )

            const limit = before.usageData.limit
            const percentBefore = before.usageData.percentUsed
            const percentAfter =
              limit > 0 ? Math.min(100, percentBefore + (costDelta / limit) * 100) : percentBefore
            const currentUsageAfter = before.usageData.currentUsage + costDelta

            await maybeSendUsageThresholdEmail({
              scope: 'user',
              userId: usr.id,
              userEmail: usr.email,
              userName: usr.name || undefined,
              planName,
              percentBefore,
              percentAfter,
              currentUsageAfter,
              limit,
            })
          } else if (sub?.referenceId) {
            // Get org usage limit using shared helper
            const { limit: orgLimit } = await getOrgUsageLimit(sub.referenceId, sub.plan, sub.seats)

            const [{ sum: orgUsageBefore }] = await db
              .select({ sum: sql`COALESCE(SUM(${userStats.currentPeriodCost}), 0)` })
              .from(member)
              .leftJoin(userStats, eq(member.userId, userStats.userId))
              .where(eq(member.organizationId, sub.referenceId))
              .limit(1)
            const orgUsageBeforeNum = Number.parseFloat(String(orgUsageBefore ?? '0'))

            await this.updateUserStats(
              updatedLog.workflowId,
              costSummary,
              updatedLog.trigger as ExecutionTrigger['type'],
              executionId,
              billingUserId
            )

            const percentBefore =
              orgLimit > 0 ? Math.min(100, (orgUsageBeforeNum / orgLimit) * 100) : 0
            const percentAfter =
              orgLimit > 0
                ? Math.min(100, percentBefore + (costDelta / orgLimit) * 100)
                : percentBefore
            const currentUsageAfter = orgUsageBeforeNum + costDelta

            await maybeSendUsageThresholdEmail({
              scope: 'organization',
              organizationId: sub.referenceId,
              planName,
              percentBefore,
              percentAfter,
              currentUsageAfter,
              limit: orgLimit,
            })
          }
        } else {
          await this.updateUserStats(
            updatedLog.workflowId,
            costSummary,
            updatedLog.trigger as ExecutionTrigger['type'],
            executionId,
            billingUserId
          )
        }
      } else {
        await this.updateUserStats(
          updatedLog.workflowId,
          costSummary,
          updatedLog.trigger as ExecutionTrigger['type'],
          executionId,
          billingUserId
        )
      }
    } catch (e) {
      try {
        await this.updateUserStats(
          updatedLog.workflowId,
          costSummary,
          updatedLog.trigger as ExecutionTrigger['type'],
          executionId,
          billingUserId
        )
      } catch {}
      execLog.warn('Usage threshold notification check failed (non-fatal)', { error: e })
    }

    execLog.debug('Completed workflow execution')

    const completedLog: WorkflowExecutionLog = {
      id: updatedLog.id,
      workflowId: updatedLog.workflowId,
      executionId: updatedLog.executionId,
      stateSnapshotId: updatedLog.stateSnapshotId,
      level: updatedLog.level as 'info' | 'error',
      trigger: updatedLog.trigger as ExecutionTrigger['type'],
      startedAt: updatedLog.startedAt.toISOString(),
      endedAt: updatedLog.endedAt?.toISOString() || endedAt,
      totalDurationMs: updatedLog.totalDurationMs || totalDurationMs,
      executionData: updatedLog.executionData as WorkflowExecutionLog['executionData'],
      cost: updatedLog.cost as WorkflowExecutionLog['cost'],
      createdAt: updatedLog.createdAt.toISOString(),
    }

    emitWorkflowExecutionCompleted(completedLog).catch((error) => {
      execLog.error('Failed to emit workflow execution completed event', { error })
    })

    return completedLog
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
      trigger: workflowLog.trigger as ExecutionTrigger['type'],
      startedAt: workflowLog.startedAt.toISOString(),
      endedAt: workflowLog.endedAt?.toISOString() || workflowLog.startedAt.toISOString(),
      totalDurationMs: workflowLog.totalDurationMs || 0,
      executionData: workflowLog.executionData as WorkflowExecutionLog['executionData'],
      cost: workflowLog.cost as WorkflowExecutionLog['cost'],
      createdAt: workflowLog.createdAt.toISOString(),
    }
  }

  /**
   * Updates user stats with cost and token information
   * Maintains same logic as original execution logger for billing consistency
   */
  private extractBillingUserId(executionData: unknown): string | null {
    if (!executionData || typeof executionData !== 'object') {
      return null
    }

    const environment = (executionData as { environment?: { userId?: unknown } }).environment
    const userId = environment?.userId

    if (typeof userId !== 'string') {
      return null
    }

    const trimmedUserId = userId.trim()
    return trimmedUserId.length > 0 ? trimmedUserId : null
  }

  private async updateUserStats(
    workflowId: string | null,
    costSummary: {
      totalCost: number
      totalInputCost: number
      totalOutputCost: number
      totalTokens: number
      totalPromptTokens: number
      totalCompletionTokens: number
      baseExecutionCharge: number
      modelCost: number
      models?: Record<
        string,
        {
          input: number
          output: number
          total: number
          toolCost?: number
          tokens: { input: number; output: number; total: number }
        }
      >
    },
    trigger: ExecutionTrigger['type'],
    executionId?: string,
    billingUserId?: string | null
  ): Promise<void> {
    const statsLog = logger.withMetadata({ workflowId: workflowId ?? undefined, executionId })

    if (!isBillingEnabled) {
      statsLog.debug('Billing is disabled, skipping user stats cost update')
      return
    }

    if (costSummary.totalCost <= 0) {
      statsLog.debug('No cost to update in user stats')
      return
    }

    if (!workflowId) {
      statsLog.debug('Workflow was deleted, skipping user stats update')
      return
    }

    try {
      const [workflowRecord] = await db
        .select()
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflowRecord) {
        statsLog.error('Workflow not found for user stats update')
        return
      }

      const userId = billingUserId?.trim() || null
      if (!userId) {
        statsLog.error('Missing billing actor in execution context; skipping stats update', {
          trigger,
        })
        return
      }

      const entries: Array<{
        category: 'model' | 'fixed'
        source: 'workflow'
        description: string
        cost: number
        metadata?: ModelUsageMetadata | null
      }> = []

      if (costSummary.baseExecutionCharge > 0) {
        entries.push({
          category: 'fixed',
          source: 'workflow',
          description: 'execution_fee',
          cost: costSummary.baseExecutionCharge,
        })
      }

      if (costSummary.models) {
        for (const [modelName, modelData] of Object.entries(costSummary.models)) {
          if (modelData.total > 0) {
            entries.push({
              category: 'model',
              source: 'workflow',
              description: modelName,
              cost: modelData.total,
              metadata: {
                inputTokens: modelData.tokens.input,
                outputTokens: modelData.tokens.output,
                ...(modelData.toolCost != null &&
                  modelData.toolCost > 0 && { toolCost: modelData.toolCost }),
              },
            })
          }
        }
      }

      const additionalStats: Record<string, ReturnType<typeof sql>> = {
        totalTokensUsed: sql`total_tokens_used + ${costSummary.totalTokens}`,
      }

      const triggerCounter = TRIGGER_COUNTER_MAP[trigger]
      if (triggerCounter) {
        additionalStats[triggerCounter.key] = sql`${sql.raw(triggerCounter.column)} + 1`
      }

      await recordUsage({
        userId,
        entries,
        workspaceId: workflowRecord.workspaceId ?? undefined,
        workflowId,
        executionId,
        additionalStats,
      })

      // Check if user has hit overage threshold and bill incrementally
      await checkAndBillOverageThreshold(userId)
    } catch (error) {
      statsLog.error('Error updating user stats with cost information', {
        error,
        costSummary,
      })
      // Don't throw - we want execution to continue even if user stats update fails
    }
  }

  /**
   * Extract file references from execution trace spans, final output, and workflow input
   */
  private extractFilesFromExecution(
    traceSpans?: any[],
    finalOutput?: any,
    workflowInput?: any
  ): any[] {
    const files: any[] = []
    const seenFileIds = new Set<string>()

    // Helper function to extract files from any object
    const extractFilesFromObject = (obj: any, source: string) => {
      if (!obj || typeof obj !== 'object') return

      // Check if this object has files property
      if (Array.isArray(obj.files)) {
        for (const file of obj.files) {
          if (file?.name && file.key && file.id) {
            if (!seenFileIds.has(file.id)) {
              seenFileIds.add(file.id)
              files.push({
                id: file.id,
                name: file.name,
                size: file.size,
                type: file.type,
                url: file.url,
                key: file.key,
              })
            }
          }
        }
      }

      // Check if this object has attachments property (for Gmail and other tools)
      if (Array.isArray(obj.attachments)) {
        for (const file of obj.attachments) {
          if (file?.name && file.key && file.id) {
            if (!seenFileIds.has(file.id)) {
              seenFileIds.add(file.id)
              files.push({
                id: file.id,
                name: file.name,
                size: file.size,
                type: file.type,
                url: file.url,
                key: file.key,
              })
            }
          }
        }
      }

      // Check if this object itself is a file reference
      if (obj.name && obj.key && typeof obj.size === 'number') {
        if (!obj.id) {
          logger.warn(`File object missing ID, skipping: ${obj.name}`)
          return
        }

        if (!seenFileIds.has(obj.id)) {
          seenFileIds.add(obj.id)
          files.push({
            id: obj.id,
            name: obj.name,
            size: obj.size,
            type: obj.type,
            url: obj.url,
            key: obj.key,
            uploadedAt: obj.uploadedAt,
            expiresAt: obj.expiresAt,
            storageProvider: obj.storageProvider,
            bucketName: obj.bucketName,
          })
        }
      }

      // Recursively check nested objects and arrays
      if (Array.isArray(obj)) {
        obj.forEach((item, index) => extractFilesFromObject(item, `${source}[${index}]`))
      } else if (typeof obj === 'object') {
        Object.entries(obj).forEach(([key, value]) => {
          extractFilesFromObject(value, `${source}.${key}`)
        })
      }
    }

    // Extract files from trace spans
    if (traceSpans && Array.isArray(traceSpans)) {
      traceSpans.forEach((span, index) => {
        extractFilesFromObject(span, `trace_span_${index}`)
      })
    }

    // Extract files from final output
    if (finalOutput) {
      extractFilesFromObject(finalOutput, 'final_output')
    }

    // Extract files from workflow input
    if (workflowInput) {
      extractFilesFromObject(workflowInput, 'workflow_input')
    }

    logger.debug(`Extracted ${files.length} file(s) from execution`, {
      fileNames: files.map((f) => f.name),
    })

    return files
  }
}

export const executionLogger = new ExecutionLogger()
