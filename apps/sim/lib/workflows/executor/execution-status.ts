import { db } from '@sim/db'
import { pausedExecutions, workflowExecutionLogs } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type { WorkflowExecutionStatusResponse } from '@/lib/api/contracts/workflows'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { getAutomaticResumeWaitingMetadata } from '@/lib/workflows/executor/paused-execution-metadata'
import type { PausePoint } from '@/executor/types'

/**
 * Reads a single execution's status resource — the log row, the paused-state
 * overlay, and (when requested) materialized outputs. Extracted so the v1 and
 * v2 status routes render the identical resource from one read path.
 * Auth is the caller's responsibility. Returns `null` when no log row exists.
 */

type LogStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

interface TraceSpanShape {
  blockId?: string
  output?: Record<string, unknown>
  children?: TraceSpanShape[]
}

interface ExecutionDataShape {
  finalOutput?: { error?: string } & Record<string, unknown>
  error?: { message?: string } | string
  completionFailure?: string
  traceSpans?: TraceSpanShape[]
}

function collectBlockOutputs(spans: TraceSpanShape[] | undefined): Map<string, unknown> {
  const map = new Map<string, unknown>()
  const visit = (list?: TraceSpanShape[]): void => {
    if (!list) return
    for (const span of list) {
      if (span.blockId && span.output !== undefined && !map.has(span.blockId)) {
        map.set(span.blockId, span.output)
      }
      if (span.children) visit(span.children)
    }
  }
  visit(spans)
  return map
}

function resolvePath(value: unknown, path: string[]): unknown {
  let current: unknown = value
  for (const segment of path) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function pickSelectedOutputs(
  selectedOutputs: string[],
  blockOutputs: Map<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const selector of selectedOutputs) {
    const [head, ...rest] = selector.split('.')
    if (!head) continue
    if (!blockOutputs.has(head)) continue
    const blockValue = blockOutputs.get(head)
    out[selector] = rest.length === 0 ? blockValue : resolvePath(blockValue, rest)
  }
  return out
}

function pickEarliestPausePoint(points: PausePoint[]): PausePoint | null {
  const active = points.filter((p) => p.resumeStatus === 'paused')
  if (active.length === 0) return null
  return active.reduce<PausePoint | null>((best, current) => {
    if (!best) return current
    if (!current.resumeAt) return best
    if (!best.resumeAt) return current
    return current.resumeAt < best.resumeAt ? current : best
  }, null)
}

function normalizePausePoints(raw: unknown): PausePoint[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw as PausePoint[]
  if (typeof raw === 'object') return Object.values(raw as Record<string, PausePoint>)
  return []
}

function extractError(executionData: unknown): string | null {
  if (!executionData || typeof executionData !== 'object') return null
  const data = executionData as ExecutionDataShape
  if (typeof data.error === 'string') return data.error
  if (data.error && typeof data.error === 'object' && typeof data.error.message === 'string') {
    return data.error.message
  }
  if (typeof data.finalOutput?.error === 'string') return data.finalOutput.error
  if (typeof data.completionFailure === 'string') return data.completionFailure
  return null
}

export interface GetWorkflowExecutionStatusInput {
  workflowId: string
  executionId: string
  includeOutput: boolean
  selectedOutputs: string[]
}

export async function getWorkflowExecutionStatus(
  input: GetWorkflowExecutionStatusInput
): Promise<WorkflowExecutionStatusResponse | null> {
  const { workflowId, executionId, includeOutput, selectedOutputs } = input

  const [logRow] = await db
    .select({
      executionId: workflowExecutionLogs.executionId,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      status: workflowExecutionLogs.status,
      level: workflowExecutionLogs.level,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      executionData: workflowExecutionLogs.executionData,
      costTotal: workflowExecutionLogs.costTotal,
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, executionId),
        eq(workflowExecutionLogs.workflowId, workflowId)
      )
    )
    .limit(1)

  if (!logRow) return null

  const [pausedRow] = await db
    .select({
      id: pausedExecutions.id,
      status: pausedExecutions.status,
      pausePoints: pausedExecutions.pausePoints,
      metadata: pausedExecutions.metadata,
      resumedCount: pausedExecutions.resumedCount,
      pausedAt: pausedExecutions.pausedAt,
      nextResumeAt: pausedExecutions.nextResumeAt,
    })
    .from(pausedExecutions)
    .where(eq(pausedExecutions.executionId, executionId))
    .limit(1)

  const isCurrentlyPaused =
    !!pausedRow && (pausedRow.status === 'paused' || pausedRow.status === 'partially_resumed')

  let status: WorkflowExecutionStatusResponse['status']
  if (isCurrentlyPaused) {
    status = 'paused'
  } else {
    status = logRow.status as LogStatus
  }

  let paused: WorkflowExecutionStatusResponse['paused'] = null
  if (isCurrentlyPaused && pausedRow) {
    const points = normalizePausePoints(pausedRow.pausePoints)
    const earliest = pickEarliestPausePoint(points)
    const automaticResumeWaiting = getAutomaticResumeWaitingMetadata(pausedRow.metadata)
    paused = {
      pausedAt: pausedRow.pausedAt.toISOString(),
      resumeAt: pausedRow.nextResumeAt?.toISOString() ?? earliest?.resumeAt ?? null,
      pauseKind: earliest?.pauseKind ?? null,
      blockedOnBlockId: earliest?.blockId ?? null,
      automaticResumeWaitingReason:
        automaticResumeWaiting?.reason ?? earliest?.automaticResumeWaitingReason ?? null,
      pausedExecutionId: pausedRow.id,
      pausePointCount: points.length,
      resumedCount: pausedRow.resumedCount,
    }
  }

  const cost = logRow.costTotal != null ? { total: Number(logRow.costTotal) } : null

  // Heavy execution data may live in object storage; resolve the pointer
  // before reading error / finalOutput / traceSpans (no-op for inline rows).
  const executionData = (await materializeExecutionData(
    logRow.executionData as Record<string, unknown> | null,
    {
      workspaceId: logRow.workspaceId,
      workflowId: logRow.workflowId,
      executionId: logRow.executionId,
    }
  )) as ExecutionDataShape | undefined

  const error = status === 'failed' ? extractError(executionData) : null

  const finalOutput =
    includeOutput && status === 'completed' && executionData
      ? (executionData.finalOutput ?? null)
      : null

  const blockOutputs =
    selectedOutputs.length > 0
      ? pickSelectedOutputs(selectedOutputs, collectBlockOutputs(executionData?.traceSpans))
      : null

  return {
    executionId: logRow.executionId,
    // Column is `set null` on workflow delete; the caller's param is the fallback.
    workflowId: logRow.workflowId ?? workflowId,
    status,
    trigger: logRow.trigger,
    level: logRow.level,
    startedAt: logRow.startedAt.toISOString(),
    endedAt: logRow.endedAt?.toISOString() ?? null,
    totalDurationMs: logRow.totalDurationMs ?? null,
    paused,
    cost,
    error,
    finalOutput,
    blockOutputs,
  }
}
