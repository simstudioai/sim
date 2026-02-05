import { db } from '@sim/db'
import {
  member,
  userStats,
  user as userTable,
  workflow,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import {
  checkUsageStatus,
  getOrgUsageLimit,
  maybeSendUsageThresholdEmail,
} from '@/lib/billing/core/usage'
import { logWorkflowUsageBatch } from '@/lib/billing/core/usage-log'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { redactApiKeys } from '@/lib/core/security/redaction'
import { filterForDisplay } from '@/lib/core/utils/display-filters'
import { emitWorkflowExecutionCompleted } from '@/lib/logs/events'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import type {
  BlockOutputData,
  ExecutionEnvironment,
  ExecutionTrigger,
  ExecutionLoggerService as IExecutionLoggerService,
  TraceSpan,
  WorkflowExecutionLog,
  WorkflowExecutionSnapshot,
  WorkflowState,
} from '@/lib/logs/types'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'

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

export class ExecutionLogger implements IExecutionLoggerService {
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

    logger.debug(`Starting workflow execution ${executionId} for workflow ${workflowId}`)

    // Check if execution log already exists (idempotency check)
    const existingLog = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (existingLog.length > 0) {
      logger.debug(
        `Execution log already exists for ${executionId}, skipping duplicate INSERT (idempotent)`
      )
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
        id: uuidv4(),
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

    logger.debug(`Created workflow log ${workflowLog.id} for execution ${executionId}`)

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
          tokens: { input: number; output: number; total: number }
        }
      >
    }
    finalOutput: BlockOutputData
    traceSpans?: TraceSpan[]
    workflowInput?: any
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
      isResume,
      level: levelOverride,
      status: statusOverride,
    } = params

    logger.debug(`Completing workflow execution ${executionId}`, { isResume })

    // If this is a resume, fetch the existing log to merge data
    let existingLog: any = null
    if (isResume) {
      const [existing] = await db
        .select()
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, executionId))
        .limit(1)
      existingLog = existing
    }

    // Determine if workflow failed by checking trace spans for errors
    // Use the override if provided (for cost-only fallback scenarios)
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

    const level = levelOverride ?? (hasErrors ? 'error' : 'info')
    const status = statusOverride ?? (hasErrors ? 'failed' : 'completed')

    // Extract files from trace spans, final output, and workflow input
    const executionFiles = this.extractFilesFromExecution(traceSpans, finalOutput, workflowInput)

    // For resume executions, rebuild trace spans from the aggregated logs
    const mergedTraceSpans = isResume
      ? traceSpans && traceSpans.length > 0
        ? traceSpans
        : existingLog?.executionData?.traceSpans || []
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

    const [updatedLog] = await db
      .update(workflowExecutionLogs)
      .set({
        level,
        status,
        endedAt: new Date(endedAt),
        totalDurationMs: totalDuration,
        files: executionFiles.length > 0 ? executionFiles : null,
        executionData: {
          traceSpans: redactedTraceSpans,
          finalOutput: redactedFinalOutput,
          tokens: {
            input: executionCost.tokens.input,
            output: executionCost.tokens.output,
            total: executionCost.tokens.total,
          },
          models: executionCost.models,
        },
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
      if (wf) {
        const [usr] = await db
          .select({ id: userTable.id, email: userTable.email, name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, wf.userId))
          .limit(1)

        if (usr?.email) {
          const sub = await getHighestPrioritySubscription(usr.id)

          const costDelta = costSummary.totalCost

          const planName = sub?.plan || 'Free'
          const scope: 'user' | 'organization' =
            sub && (sub.plan === 'team' || sub.plan === 'enterprise') ? 'organization' : 'user'

          if (scope === 'user') {
            const before = await checkUsageStatus(usr.id)

            await this.updateUserStats(
              updatedLog.workflowId,
              costSummary,
              updatedLog.trigger as ExecutionTrigger['type'],
              executionId
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
            const orgUsageBeforeNum = Number.parseFloat(
              (orgUsageBefore as any)?.toString?.() || '0'
            )

            await this.updateUserStats(
              updatedLog.workflowId,
              costSummary,
              updatedLog.trigger as ExecutionTrigger['type'],
              executionId
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
            executionId
          )
        }
      } else {
        await this.updateUserStats(
          updatedLog.workflowId,
          costSummary,
          updatedLog.trigger as ExecutionTrigger['type'],
          executionId
        )
      }
    } catch (e) {
      try {
        await this.updateUserStats(
          updatedLog.workflowId,
          costSummary,
          updatedLog.trigger as ExecutionTrigger['type'],
          executionId
        )
      } catch {}
      logger.warn('Usage threshold notification check failed (non-fatal)', { error: e })
    }

    logger.debug(`Completed workflow execution ${executionId}`)

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
      cost: updatedLog.cost as any,
      createdAt: updatedLog.createdAt.toISOString(),
    }

    emitWorkflowExecutionCompleted(completedLog).catch((error) => {
      logger.error('Failed to emit workflow execution completed event', {
        error,
        executionId,
      })
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
      cost: workflowLog.cost as any,
      createdAt: workflowLog.createdAt.toISOString(),
    }
  }

  /**
   * Updates user stats with cost and token information
   * Maintains same logic as original execution logger for billing consistency
   */
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
          tokens: { input: number; output: number; total: number }
        }
      >
    },
    trigger: ExecutionTrigger['type'],
    executionId?: string
  ): Promise<void> {
    if (!isBillingEnabled) {
      logger.debug('Billing is disabled, skipping user stats cost update')
      return
    }

    if (costSummary.totalCost <= 0) {
      logger.debug('No cost to update in user stats')
      return
    }

    if (!workflowId) {
      logger.debug('Workflow was deleted, skipping user stats update')
      return
    }

    try {
      // Get the workflow record to get workspace and fallback userId
      const [workflowRecord] = await db
        .select()
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflowRecord) {
        logger.error(`Workflow ${workflowId} not found for user stats update`)
        return
      }

      let billingUserId: string | null = null
      if (workflowRecord.workspaceId) {
        billingUserId = await getWorkspaceBilledAccountUserId(workflowRecord.workspaceId)
      }

      const userId = billingUserId || workflowRecord.userId
      const costToStore = costSummary.totalCost

      const existing = await db.select().from(userStats).where(eq(userStats.userId, userId))
      if (existing.length === 0) {
        logger.error('User stats record not found - should be created during onboarding', {
          userId,
          trigger,
        })
        return
      }

      // All costs go to currentPeriodCost - credits are applied at end of billing cycle
      const updateFields: any = {
        totalTokensUsed: sql`total_tokens_used + ${costSummary.totalTokens}`,
        totalCost: sql`total_cost + ${costToStore}`,
        currentPeriodCost: sql`current_period_cost + ${costToStore}`,
        lastActive: new Date(),
      }

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
        case 'mcp':
          updateFields.totalMcpExecutions = sql`total_mcp_executions + 1`
          break
        case 'a2a':
          updateFields.totalA2aExecutions = sql`total_a2a_executions + 1`
          break
      }

      await db.update(userStats).set(updateFields).where(eq(userStats.userId, userId))

      logger.debug('Updated user stats record with cost data', {
        userId,
        trigger,
        addedCost: costToStore,
        addedTokens: costSummary.totalTokens,
      })

      // Log usage entries for auditing (batch insert for performance)
      await logWorkflowUsageBatch({
        userId,
        workspaceId: workflowRecord.workspaceId ?? undefined,
        workflowId,
        executionId,
        baseExecutionCharge: costSummary.baseExecutionCharge,
        models: costSummary.models,
      })

      // Check if user has hit overage threshold and bill incrementally
      await checkAndBillOverageThreshold(userId)
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
