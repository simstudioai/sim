import { db } from '@sim/db'
import {
  member,
  usageLog,
  userStats,
  user as userTable,
  workflow,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import {
  checkUsageStatus,
  getOrgUsageLimit,
  maybeSendUsageThresholdEmail,
} from '@/lib/billing/core/usage'
import {
  type BillingContext,
  deriveBillingContext,
  type ModelUsageMetadata,
  recordUsage,
  stableEventKey,
} from '@/lib/billing/core/usage-log'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { redactApiKeys } from '@/lib/core/security/redaction'
import { filterForDisplay } from '@/lib/core/utils/display-filters'
import {
  collectLargeValueReferenceKeys,
  replaceLargeValueReferenceKeysWithClient,
} from '@/lib/execution/payloads/large-value-metadata'
import { emitWorkflowExecutionCompleted } from '@/lib/logs/events'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import { externalizeExecutionData, stripSpanCosts } from '@/lib/logs/execution/trace-store'
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

const logger = createLogger('ExecutionLogger')
const MAX_EXECUTION_DATA_BYTES = 3 * 1024 * 1024
const MAX_TRACE_IO_BYTES = 8 * 1024
const MAX_WORKFLOW_VALUE_BYTES = 512 * 1024
const EXECUTION_LOG_STATEMENT_TIMEOUT_MS = 30_000
const EXECUTION_LOG_LOCK_TIMEOUT_MS = 3_000
const EXECUTION_LOG_IDLE_TIMEOUT_MS = 5_000
// Bounds the wait for the per-execution usage-reconcile advisory lock. Generous
// (favor waiting over dropping a charge); only trips on a pathological lock hold.
const USAGE_RECONCILE_LOCK_TIMEOUT_MS = 10_000

type ExecutionData = WorkflowExecutionLog['executionData']

function getJsonByteSize(
  value: unknown,
  maxBytes = MAX_EXECUTION_DATA_BYTES + 1
): number | undefined {
  const seen = new WeakSet<object>()
  let bytes = 0

  const add = (amount: number) => {
    bytes += amount
    if (bytes > maxBytes) {
      throw new Error('json_size_limit_reached')
    }
  }

  const visit = (item: unknown): void => {
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
      add(4)
      return
    }
    if (item === null) {
      add(4)
      return
    }
    if (typeof item === 'string') {
      add(Buffer.byteLength(JSON.stringify(item), 'utf8'))
      return
    }
    if (typeof item === 'bigint') {
      add(Buffer.byteLength(JSON.stringify(item.toString()), 'utf8'))
      return
    }
    if (typeof item === 'number' || typeof item === 'boolean') {
      add(Buffer.byteLength(JSON.stringify(item) ?? 'null', 'utf8'))
      return
    }
    if (typeof item !== 'object') {
      add(4)
      return
    }
    if (seen.has(item)) {
      return
    }
    seen.add(item)

    if (Array.isArray(item)) {
      add(2)
      item.forEach((entry, index) => {
        if (index > 0) add(1)
        visit(entry)
      })
      return
    }

    const entries = Object.entries(item)
    add(2)
    entries.forEach(([key, entry], index) => {
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') return
      if (index > 0) add(1)
      add(Buffer.byteLength(JSON.stringify(key), 'utf8') + 1)
      visit(entry)
    })
  }

  try {
    visit(value)
    return bytes
  } catch (error) {
    if (getErrorMessage(error) === 'json_size_limit_reached') {
      return maxBytes + 1
    }
    return undefined
  }
}

function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `array with ${value.length} items`
  if (typeof value === 'string') return `string with ${value.length} characters`
  if (typeof value === 'object') return `object with ${Object.keys(value).length} keys`
  return typeof value
}

function summarizeValueForExecutionData(value: unknown, maxBytes: number): unknown {
  const size = getJsonByteSize(value, maxBytes)
  if (size === undefined || size <= maxBytes) {
    return value
  }

  return {
    _truncated: true,
    reason: 'execution_data_size_limit',
    originalBytes: size,
    summary: describeValue(value),
  }
}

function summarizeTextForExecutionData(value: string | undefined): string | undefined {
  if (!value) return value
  const size = getJsonByteSize(value, MAX_TRACE_IO_BYTES)
  if (size === undefined || size <= MAX_TRACE_IO_BYTES) {
    return value
  }
  return `[Truncated ${size} byte text value due to execution log size limit]`
}

function summarizeTraceSpansForExecutionData(traceSpans?: TraceSpan[]): TraceSpan[] | undefined {
  if (!traceSpans) {
    return traceSpans
  }

  return traceSpans.map((span) => {
    const { input, output, children, thinking, modelToolCalls, ...rest } = span
    const summarized: TraceSpan = { ...rest }

    if (input !== undefined) {
      summarized.input = summarizeValueForExecutionData(input, MAX_TRACE_IO_BYTES) as Record<
        string,
        unknown
      >
    }
    if (output !== undefined) {
      summarized.output = summarizeValueForExecutionData(output, MAX_TRACE_IO_BYTES) as Record<
        string,
        unknown
      >
    }
    if (children?.length) {
      summarized.children = summarizeTraceSpansForExecutionData(children)
    }
    if (thinking !== undefined) {
      summarized.thinking = summarizeTextForExecutionData(thinking)
    }
    if (
      modelToolCalls !== undefined &&
      (getJsonByteSize(modelToolCalls, MAX_TRACE_IO_BYTES) ?? 0) <= MAX_TRACE_IO_BYTES
    ) {
      summarized.modelToolCalls = modelToolCalls
    }

    return summarized
  })
}

function summarizeTraceSpansWithoutIo(traceSpans?: TraceSpan[]): TraceSpan[] | undefined {
  if (!traceSpans) {
    return traceSpans
  }

  return traceSpans.map((span) => {
    const {
      input: _input,
      output: _output,
      children,
      thinking: _thinking,
      modelToolCalls: _modelToolCalls,
      ...rest
    } = span
    return {
      ...rest,
      ...(children?.length ? { children: summarizeTraceSpansWithoutIo(children) } : {}),
    }
  })
}

function summarizeExecutionState(executionState?: SerializableExecutionState) {
  if (!executionState) {
    return undefined
  }

  return {
    executedBlockCount: executionState.executedBlocks.length,
    blockLogCount: executionState.blockLogs.length,
    completedLoopCount: executionState.completedLoops.length,
    activeExecutionPathLength: executionState.activeExecutionPath.length,
    pendingQueueLength: executionState.pendingQueue?.length ?? 0,
  }
}

function recordStoredByteSize(executionData: ExecutionData): {
  executionData: ExecutionData
  storedBytes?: number
} {
  const firstBytes = getJsonByteSize(executionData)
  if (firstBytes === undefined) {
    return { executionData }
  }

  const withFirstSize = { ...executionData, executionDataStoredBytes: firstBytes }
  const secondBytes = getJsonByteSize(withFirstSize)
  if (secondBytes === undefined || secondBytes === firstBytes) {
    return { executionData: withFirstSize, storedBytes: secondBytes ?? firstBytes }
  }

  const withSecondSize = { ...executionData, executionDataStoredBytes: secondBytes }
  return {
    executionData: withSecondSize,
    storedBytes: getJsonByteSize(withSecondSize) ?? secondBytes,
  }
}

async function setExecutionLogWriteTimeouts(trx: Pick<typeof db, 'execute'>): Promise<void> {
  await trx.execute(
    sql.raw(`SET LOCAL statement_timeout = '${EXECUTION_LOG_STATEMENT_TIMEOUT_MS}ms'`)
  )
  await trx.execute(sql.raw(`SET LOCAL lock_timeout = '${EXECUTION_LOG_LOCK_TIMEOUT_MS}ms'`))
  await trx.execute(
    sql.raw(`SET LOCAL idle_in_transaction_session_timeout = '${EXECUTION_LOG_IDLE_TIMEOUT_MS}ms'`)
  )
}

function countTraceSpans(traceSpans?: TraceSpan[]): number {
  if (!Array.isArray(traceSpans) || traceSpans.length === 0) {
    return 0
  }

  return traceSpans.reduce((count, span) => count + 1 + countTraceSpans(span.children), 0)
}

export class ExecutionLogger implements IExecutionLoggerService {
  private compactExecutionDataForStorage(
    executionData: ExecutionData,
    executionId: string
  ): ExecutionData {
    const originalBytes = getJsonByteSize(executionData)
    if (originalBytes === undefined || originalBytes <= MAX_EXECUTION_DATA_BYTES) {
      return executionData
    }

    const { executionState: _executionState, ...executionDataWithoutState } = executionData
    const summarized: ExecutionData = {
      ...executionDataWithoutState,
      traceSpans: summarizeTraceSpansForExecutionData(executionData.traceSpans),
      finalOutput: summarizeValueForExecutionData(
        executionData.finalOutput,
        MAX_WORKFLOW_VALUE_BYTES
      ) as BlockOutputData,
      executionDataTruncated: true,
      executionDataOriginalBytes: originalBytes,
      executionDataMaxBytes: MAX_EXECUTION_DATA_BYTES,
      executionDataTruncationReason:
        'Execution log exceeded the maximum stored payload size, so large inputs and outputs were summarized.',
    }

    if (executionData.workflowInput !== undefined) {
      summarized.workflowInput = summarizeValueForExecutionData(
        executionData.workflowInput,
        MAX_WORKFLOW_VALUE_BYTES
      )
    }

    if (executionData.executionState) {
      summarized.executionStateSummary = summarizeExecutionState(executionData.executionState)
    }

    const summarizedWithSize = recordStoredByteSize(summarized)
    if (
      summarizedWithSize.storedBytes !== undefined &&
      summarizedWithSize.storedBytes <= MAX_EXECUTION_DATA_BYTES
    ) {
      logger.warn('Summarized oversized workflow execution data before storing log', {
        executionId,
        originalBytes,
        storedBytes: summarizedWithSize.storedBytes,
        maxBytes: MAX_EXECUTION_DATA_BYTES,
      })
      return summarizedWithSize.executionData
    }

    const minimal: ExecutionData = {
      ...(executionData.environment ? { environment: executionData.environment } : {}),
      ...(executionData.trigger ? { trigger: executionData.trigger } : {}),
      ...(executionData.correlation ? { correlation: executionData.correlation } : {}),
      ...(executionData.error ? { error: executionData.error } : {}),
      ...(executionData.lastStartedBlock
        ? { lastStartedBlock: executionData.lastStartedBlock }
        : {}),
      ...(executionData.lastCompletedBlock
        ? { lastCompletedBlock: executionData.lastCompletedBlock }
        : {}),
      ...(executionData.completionFailure
        ? { completionFailure: executionData.completionFailure }
        : {}),
      ...(executionData.finalizationPath
        ? { finalizationPath: executionData.finalizationPath }
        : {}),
      hasTraceSpans: executionData.hasTraceSpans,
      traceSpanCount: executionData.traceSpanCount,
      traceSpans: summarizeTraceSpansWithoutIo(executionData.traceSpans),
      finalOutput: summarizeValueForExecutionData(executionData.finalOutput, MAX_TRACE_IO_BYTES) as
        | BlockOutputData
        | undefined,
      tokens: executionData.tokens,
      models: executionData.models,
      executionStateSummary: summarizeExecutionState(executionData.executionState),
      executionDataTruncated: true,
      executionDataOriginalBytes: originalBytes,
      executionDataMaxBytes: MAX_EXECUTION_DATA_BYTES,
      executionDataTruncationReason:
        'Execution log exceeded the maximum stored payload size after summarization, so trace payload details were omitted.',
    }

    const minimalWithSize = recordStoredByteSize(minimal)

    if (
      minimalWithSize.storedBytes !== undefined &&
      minimalWithSize.storedBytes > MAX_EXECUTION_DATA_BYTES
    ) {
      const metadataOnly: ExecutionData = {
        hasTraceSpans: executionData.hasTraceSpans,
        traceSpanCount: executionData.traceSpanCount,
        tokens: executionData.tokens,
        models: executionData.models,
        executionDataTruncated: true,
        executionDataOriginalBytes: originalBytes,
        executionDataMaxBytes: MAX_EXECUTION_DATA_BYTES,
        executionDataTruncationReason:
          'Execution log exceeded the maximum stored payload size after minimal summarization, so only execution metadata was stored.',
      }

      const metadataOnlyWithSize = recordStoredByteSize(metadataOnly)
      logger.warn(
        'Stored metadata-only workflow execution data after oversized log summarization',
        {
          executionId,
          originalBytes,
          storedBytes: metadataOnlyWithSize.storedBytes,
          minimalBytes: minimalWithSize.storedBytes,
          summarizedBytes: summarizedWithSize.storedBytes,
          maxBytes: MAX_EXECUTION_DATA_BYTES,
        }
      )

      return metadataOnlyWithSize.executionData
    }

    logger.warn('Stored minimal workflow execution data after oversized log summarization', {
      executionId,
      originalBytes,
      storedBytes: minimalWithSize.storedBytes,
      summarizedBytes: summarizedWithSize.storedBytes,
      maxBytes: MAX_EXECUTION_DATA_BYTES,
    })

    return minimalWithSize.executionData
  }

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
    workflowInput?: unknown
  }): WorkflowExecutionLog['executionData'] {
    const {
      existingExecutionData,
      traceSpans,
      finalOutput,
      finalizationPath,
      completionFailure,
      executionCost,
      executionState,
      workflowInput,
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
      ...(workflowInput !== undefined ? { workflowInput } : {}),
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
      charges?: Record<string, { total: number }>
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

    // For resume executions, rebuild trace spans from the aggregated logs
    const mergedTraceSpans = isResume
      ? traceSpans && traceSpans.length > 0
        ? traceSpans
        : existingExecutionData?.traceSpans || []
      : traceSpans

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

    const boundedExecutionData = this.compactExecutionDataForStorage(
      this.buildCompletedExecutionData({
        existingExecutionData,
        traceSpans: mergedTraceSpans,
        finalOutput,
        finalizationPath,
        completionFailure,
        executionCost,
        executionState,
        workflowInput,
      }),
      executionId
    )

    const executionFiles = this.extractFilesFromExecution(
      boundedExecutionData.traceSpans,
      boundedExecutionData.finalOutput,
      boundedExecutionData.workflowInput
    )

    const filteredTraceSpans = filterForDisplay(boundedExecutionData.traceSpans)
    const filteredFinalOutput = filterForDisplay(boundedExecutionData.finalOutput)
    const filteredWorkflowInput =
      boundedExecutionData.workflowInput !== undefined
        ? filterForDisplay(boundedExecutionData.workflowInput)
        : undefined
    const redactedTraceSpans = redactApiKeys(filteredTraceSpans)
    const redactedFinalOutput = redactApiKeys(filteredFinalOutput)
    const redactedWorkflowInput =
      filteredWorkflowInput !== undefined ? redactApiKeys(filteredWorkflowInput) : undefined

    const rawDurationMs =
      isResume && existingLog?.startedAt
        ? new Date(endedAt).getTime() - new Date(existingLog.startedAt).getTime()
        : totalDurationMs
    const totalDuration =
      typeof rawDurationMs === 'number' && Number.isFinite(rawDurationMs)
        ? Math.max(0, Math.round(rawDurationMs))
        : 0

    const completedExecutionData = this.compactExecutionDataForStorage(
      {
        ...boundedExecutionData,
        traceSpans: redactedTraceSpans,
        finalOutput: redactedFinalOutput,
        ...(redactedWorkflowInput !== undefined ? { workflowInput: redactedWorkflowInput } : {}),
      },
      executionId
    )

    stripSpanCosts((completedExecutionData as Record<string, unknown>).traceSpans)

    // Externalization requires the execution owner (workspace_files.user_id is
    // NOT NULL). billingUserId comes from environment.userId and is effectively
    // always present for a real run; if it's somehow absent, keep data inline.
    let storedExecutionData = completedExecutionData as Record<string, unknown>
    if (billingUserId) {
      storedExecutionData = await externalizeExecutionData(storedExecutionData, {
        workspaceId: existingLog?.workspaceId ?? null,
        workflowId: existingLog?.workflowId ?? null,
        executionId,
        userId: billingUserId,
      })
    } else {
      execLog.warn('Skipping execution-data externalization: missing owner userId', {
        executionId,
      })
    }
    const completedExecutionLargeValueKeys = collectLargeValueReferenceKeys(storedExecutionData)

    const updatedLog = await db.transaction(async (tx) => {
      await setExecutionLogWriteTimeouts(tx)

      const [log] = await tx
        .update(workflowExecutionLogs)
        .set({
          level,
          status,
          endedAt: new Date(endedAt),
          totalDurationMs: totalDuration,
          files: executionFiles.length > 0 ? executionFiles : null,
          executionData: storedExecutionData,
          // Faithful projection of the usage_log ledger. Neither cost_total nor
          // models_used may regress below a prior boundary: a paused run that
          // resumes into an empty-span error/cancel/cost-only fallback produces a
          // base-only summary. GREATEST keeps the higher cumulative cost_total,
          // and models_used is overwritten only when this boundary actually has
          // models — so both stay == SUM(usage_log) on every monotonic path.
          costTotal: sql`GREATEST(COALESCE(${workflowExecutionLogs.costTotal}, 0), ${costSummary.totalCost.toString()}::numeric)`,
          ...(Object.keys(costSummary.models).length > 0
            ? { modelsUsed: Object.keys(costSummary.models) }
            : {}),
        })
        .where(eq(workflowExecutionLogs.executionId, executionId))
        .returning()

      if (!log) {
        throw new Error(`Workflow log not found for execution ${executionId}`)
      }

      await replaceLargeValueReferenceKeysWithClient(
        tx,
        {
          workspaceId: log.workspaceId,
          workflowId: log.workflowId,
          executionId,
          source: 'execution_log',
        },
        completedExecutionLargeValueKeys
      )

      return log
    })

    try {
      // Skip workflow lookup if workflow was deleted.
      const wf = updatedLog.workflowId
        ? (await db.select().from(workflow).where(eq(workflow.id, updatedLog.workflowId)))[0]
        : undefined

      const usr =
        wf && billingUserId
          ? (
              await db
                .select({ id: userTable.id, email: userTable.email, name: userTable.name })
                .from(userTable)
                .where(eq(userTable.id, billingUserId))
                .limit(1)
            )[0]
          : undefined

      // Resolve the billing context + the pre-increment usage snapshot for the
      // threshold email BEFORE recording, so currentUsageAfter = before +
      // costDelta doesn't double-count this boundary's own increment.
      type EmailContext =
        | {
            scope: 'user'
            userId: string
            userEmail: string
            userName: string | null
            planName: string
            before: Awaited<ReturnType<typeof checkUsageStatus>>
          }
        | {
            scope: 'organization'
            organizationId: string
            planName: string
            orgLimit: number
            orgUsageBefore: number
          }
      let billingContext: BillingContext | undefined
      let emailContext: EmailContext | undefined

      if (usr?.email) {
        const sub = await getHighestPrioritySubscription(usr.id)
        // Derive the billing context once from the subscription we just fetched
        // and thread it into recordExecutionUsage so recordUsage doesn't
        // re-resolve the subscription on the hot completion path.
        billingContext = deriveBillingContext(usr.id, sub)

        const { getDisplayPlanName } = await import('@/lib/billing/plan-helpers')
        const { isOrgScopedSubscription } = await import('@/lib/billing/subscriptions/utils')
        const planName = getDisplayPlanName(sub?.plan)

        if (isOrgScopedSubscription(sub, usr.id) && sub?.referenceId) {
          const { limit: orgLimit } = await getOrgUsageLimit(sub.referenceId, sub.plan, sub.seats)
          const [{ sum: orgBaselineSum }] = await db
            .select({ sum: sql`COALESCE(SUM(${userStats.currentPeriodCost}), 0)` })
            .from(member)
            .leftJoin(userStats, eq(member.userId, userStats.userId))
            .where(eq(member.organizationId, sub.referenceId))
            .limit(1)
          // currentPeriodCost is only a baseline; add the org's attributed
          // usage_log for the period so the threshold email reflects real usage.
          const { getBillingPeriodUsageCost } = await import('@/lib/billing/core/usage-log')
          const orgLedger =
            sub.periodStart && sub.periodEnd
              ? await getBillingPeriodUsageCost(
                  { type: 'organization', id: sub.referenceId },
                  { start: sub.periodStart, end: sub.periodEnd }
                )
              : 0
          emailContext = {
            scope: 'organization',
            organizationId: sub.referenceId,
            planName,
            orgLimit,
            orgUsageBefore: Number.parseFloat(String(orgBaselineSum ?? '0')) + orgLedger,
          }
        } else {
          emailContext = {
            scope: 'user',
            userId: usr.id,
            userEmail: usr.email,
            userName: usr.name,
            planName,
            before: await checkUsageStatus(usr.id),
          }
        }
      }

      // Record usage exactly once for every path. costDelta is the amount
      // actually recorded at this boundary (the increment), not the cumulative
      // run total — so resumed runs don't double-count pre-pause cost below.
      const costDelta = await this.recordExecutionUsage(
        updatedLog.workflowId,
        costSummary,
        updatedLog.trigger as ExecutionTrigger['type'],
        executionId,
        billingUserId,
        billingContext
      )

      // Best-effort usage-threshold email.
      if (emailContext?.scope === 'user') {
        const limit = emailContext.before.usageData.limit
        const percentBefore = emailContext.before.usageData.percentUsed
        const percentAfter =
          limit > 0 ? Math.min(100, percentBefore + (costDelta / limit) * 100) : percentBefore
        const currentUsageAfter = emailContext.before.usageData.currentUsage + costDelta

        await maybeSendUsageThresholdEmail({
          scope: 'user',
          userId: emailContext.userId,
          userEmail: emailContext.userEmail,
          userName: emailContext.userName || undefined,
          planName: emailContext.planName,
          percentBefore,
          percentAfter,
          currentUsageAfter,
          limit,
        })
      } else if (emailContext?.scope === 'organization') {
        const { orgLimit, orgUsageBefore } = emailContext
        const percentBefore = orgLimit > 0 ? Math.min(100, (orgUsageBefore / orgLimit) * 100) : 0
        const percentAfter =
          orgLimit > 0 ? Math.min(100, percentBefore + (costDelta / orgLimit) * 100) : percentBefore
        const currentUsageAfter = orgUsageBefore + costDelta

        await maybeSendUsageThresholdEmail({
          scope: 'organization',
          organizationId: emailContext.organizationId,
          planName: emailContext.planName,
          percentBefore,
          percentAfter,
          currentUsageAfter,
          limit: orgLimit,
        })
      }
    } catch (e) {
      // Safety net: if a step above threw BEFORE the single record call, ensure
      // the run is still billed. Reconciliation is idempotent, so re-recording
      // after a successful call is a no-op.
      try {
        await this.recordExecutionUsage(
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
      // Return the full in-memory execution data (cost-stripped, with traceSpans
      // and finalOutput), not the slim externalized row — downstream consumers
      // (notification delivery, events) need the complete payload without an
      // extra storage round-trip.
      executionData: completedExecutionData as WorkflowExecutionLog['executionData'],
      // From the in-memory cost summary (not the deprecated cost jsonb column).
      cost: executionCost as WorkflowExecutionLog['cost'],
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
      // cost_total projection of the usage_log ledger (not the deprecated jsonb).
      cost: (workflowLog.costTotal != null
        ? { total: Number(workflowLog.costTotal) }
        : null) as WorkflowExecutionLog['cost'],
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

  private async recordExecutionUsage(
    workflowId: string | null,
    costSummary: {
      totalCost: number
      totalInputCost: number
      totalOutputCost: number
      totalTokens: number
      totalPromptTokens: number
      totalCompletionTokens: number
      baseExecutionCharge: number
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
      charges?: Record<string, { total: number }>
    },
    trigger: ExecutionTrigger['type'],
    executionId?: string,
    billingUserId?: string | null,
    // Pre-resolved billing context. The completion path already fetches the
    // subscription for usage-threshold emails; passing the derived context here
    // lets recordUsage skip a redundant subscription lookup per completion.
    billingContext?: BillingContext
  ): Promise<number> {
    const statsLog = logger.withMetadata({ workflowId: workflowId ?? undefined, executionId })

    // The usage ledger (recordUsage below) is written regardless of
    // BILLING_ENABLED so cost is available everywhere (incl. self-hosted).
    // Only enforcement (overage/Stripe) is gated on the flag.
    // Returns the amount actually recorded at THIS boundary (the increment), so
    // callers drive usage-threshold math off the delta rather than the
    // cumulative run total (which would double-count pre-pause cost on resume).

    if (!workflowId) {
      statsLog.debug('Workflow was deleted, skipping usage recording')
      return 0
    }

    let recordedIncrement = 0
    try {
      const [workflowRecord] = await db
        .select()
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflowRecord) {
        statsLog.error('Workflow not found for usage recording')
        return 0
      }

      const userId = billingUserId?.trim() || null
      if (!userId) {
        statsLog.error('Missing billing actor in execution context; skipping usage recording', {
          trigger,
        })
        return 0
      }

      // Build the run's *cumulative* target ledger lines from the cost summary.
      // The usage_log is then reconciled to these targets: at each completion
      // boundary (pause or terminal) we record only the increment versus what
      // is already billed for this execution. This bills the full run exactly
      // once across pause/resume without double-charging on resume, and keeps
      // pre-pause work billed even if the run is later abandoned.
      type TargetLine = {
        category: 'model' | 'fixed' | 'tool'
        description: string
        target: number
        metadata?: ModelUsageMetadata | null
      }
      const targets: TargetLine[] = []

      if (costSummary.baseExecutionCharge > 0) {
        targets.push({
          category: 'fixed',
          description: 'execution_fee',
          target: costSummary.baseExecutionCharge,
        })
      }

      if (costSummary.models) {
        for (const [modelName, modelData] of Object.entries(costSummary.models)) {
          if (modelData.total > 0) {
            targets.push({
              category: 'model',
              description: modelName,
              target: modelData.total,
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

      // Non-model billable charges (standalone hosted-key tool/integration
      // blocks). These derive from already-gated span costs in
      // calculateCostSummary — BYOK'd tools produce no cost upstream, so they
      // never create a row here. Recording them closes the standalone-tool gap
      // so the ledger fully reconciles with the run total (no double charge:
      // agent-embedded tool cost stays folded into its model row).
      if (costSummary.charges) {
        for (const [description, charge] of Object.entries(costSummary.charges)) {
          if (charge.total > 0) {
            targets.push({ category: 'tool', description, target: charge.total })
          }
        }
      }

      if (targets.length === 0) {
        statsLog.debug('No cost to record')
        return 0
      }

      // Matches the billedBefore key resolution (toFixed(8)): a delta below this
      // is finer than the idempotency key can distinguish across boundaries, so
      // ignoring it keeps the key and the gate consistent.
      const COST_EPSILON = 1e-8

      // Build the positive-increment ledger entries for a given already-billed
      // snapshot. The eventKey is scoped by the already-billed-so-far amount so
      // increments across boundaries never collide, while a retried boundary
      // (same already-billed) dedups via onConflictDoNothing.
      //
      // Reconciliation keys on `description` (model name / tool name), which is
      // the billing identity — DO NOT normalize or relabel it. Correctness
      // across pause/resume relies on the same usage carrying the same
      // description at every boundary; the paused snapshot retains each block's
      // original model label, so pre-pause cost stays under its original key
      // (delta 0 at terminal) and only genuinely new usage is charged. A future
      // change that relabels historical spans would break this invariant.
      const buildDeltaEntries = (alreadyBilled: Map<string, number>) => {
        const entries: Array<{
          category: 'model' | 'fixed' | 'tool'
          source: 'workflow'
          description: string
          cost: number
          eventKey: string
          metadata?: ModelUsageMetadata | null
        }> = []
        for (const line of targets) {
          const billed = alreadyBilled.get(`${line.category}::${line.description}`) ?? 0
          const delta = line.target - billed
          if (delta <= COST_EPSILON) continue
          entries.push({
            category: line.category,
            source: 'workflow',
            description: line.description,
            cost: delta,
            eventKey: stableEventKey({
              executionId: executionId ?? '',
              category: line.category,
              description: line.description,
              billedBefore: billed.toFixed(8),
            }),
            ...(line.metadata !== undefined ? { metadata: line.metadata } : {}),
          })
        }
        return entries
      }

      if (executionId) {
        // Serialize concurrent completion boundaries for this execution so the
        // read-then-insert reconciliation cannot race. pg_advisory_xact_lock is
        // transaction-scoped (auto-released on commit/rollback, pool-safe) and
        // bounded by lock_timeout. The critical section is one SELECT + one
        // INSERT; the lock is uncontended in the normal (already-serialized)
        // flow and only matters under a cross-process double-completion of the
        // same execution, where it stops a stale already-billed read from
        // dropping the larger delta.
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`select set_config('lock_timeout', ${`${USAGE_RECONCILE_LOCK_TIMEOUT_MS}ms`}, true)`
          )
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${executionId}, 0))`)

          // Already-billed for this execution, scoped to the rows this path owns
          // (source='workflow') so a same-executionId row from another source
          // can't suppress a charge.
          const billedRows = await tx
            .select({
              category: usageLog.category,
              description: usageLog.description,
              cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`,
            })
            .from(usageLog)
            .where(and(eq(usageLog.executionId, executionId), eq(usageLog.source, 'workflow')))
            .groupBy(usageLog.category, usageLog.description)

          const alreadyBilled = new Map<string, number>()
          for (const row of billedRows) {
            alreadyBilled.set(
              `${row.category}::${row.description}`,
              Number.parseFloat(row.cost ?? '0')
            )
          }

          const entries = buildDeltaEntries(alreadyBilled)
          if (entries.length > 0) {
            await recordUsage({
              userId,
              entries,
              workspaceId: workflowRecord.workspaceId ?? undefined,
              workflowId,
              executionId,
              tx,
              ...(billingContext ?? {}),
            })
            recordedIncrement = entries.reduce((acc, e) => acc + e.cost, 0)

            // Refine cost_total to the EXACT post-reconciliation ledger sum,
            // inside the same advisory-locked tx so it is atomic with the inserts
            // and can't be clobbered by a concurrent boundary. Exact by
            // construction: under the lock no delta collides, so the new sum is
            // the prior workflow-source sum plus the deltas just inserted. This
            // supersedes the main-transaction GREATEST baseline (which remains for
            // early-return / no-executionId / failed-reconcile paths).
            const ledgerSum =
              [...alreadyBilled.values()].reduce((acc, v) => acc + v, 0) + recordedIncrement
            await tx
              .update(workflowExecutionLogs)
              .set({ costTotal: ledgerSum.toString() })
              .where(eq(workflowExecutionLogs.executionId, executionId))
          }
        })
      } else {
        // No execution scope to reconcile/lock against (not expected at a
        // workflow completion): record the full targets directly.
        const entries = buildDeltaEntries(new Map())
        if (entries.length > 0) {
          await recordUsage({
            userId,
            entries,
            workspaceId: workflowRecord.workspaceId ?? undefined,
            workflowId,
            ...(billingContext ?? {}),
          })
          recordedIncrement = entries.reduce((acc, e) => acc + e.cost, 0)
        }
      }

      // Enforcement only when billing is enabled: the ledger above is always
      // written, but overage/Stripe billing is gated on BILLING_ENABLED.
      if (isBillingEnabled) {
        await checkAndBillOverageThreshold(userId)
      }
    } catch (error) {
      // Swallowed so a billing-write failure never fails the execution. The
      // reconciliation self-heals on a later boundary; a TERMINAL-boundary
      // failure leaves the run under-billed (and cost_total may then exceed
      // SUM(usage_log)), so log loudly enough to alert / reconcile out of band.
      statsLog.error(
        'Failed to record execution usage to usage_log ledger; charge may be unbilled',
        {
          error,
          billingUserId,
          costSummary,
        }
      )
    }

    return recordedIncrement
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
    const seenObjects = new WeakSet<object>()

    // Helper function to extract files from any object
    const extractFilesFromObject = (obj: any, source: string) => {
      if (!obj || typeof obj !== 'object') return
      if (seenObjects.has(obj)) return
      seenObjects.add(obj)

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
