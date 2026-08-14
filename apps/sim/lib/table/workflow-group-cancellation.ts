import { db } from '@sim/db'
import { tableRowExecutions, userTableDefinitions, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, inArray } from 'drizzle-orm'
import { cancelledExecutionLogFields } from '@/lib/logs/execution/cancellation'
import { appendTableEvent } from '@/lib/table/events'

const logger = createLogger('WorkflowGroupCancellation')
const ACTIVE_WORKFLOW_GROUP_STATUSES = ['queued', 'running', 'pending'] as const

interface CancelWorkflowGroupExecutionOptions {
  workspaceId: string
  workflowId: string
  executionId: string
}

export interface CancelledWorkflowGroupExecution {
  kind: 'cancelled'
  tableId: string
  rowId: string
  groupId: string
  blockErrors?: Record<string, string>
}

export interface AlreadyCancelledWorkflowGroupExecution {
  kind: 'already_cancelled'
  tableId: string
  rowId: string
  groupId: string
  blockErrors?: Record<string, string>
}

export type PublishableWorkflowGroupCancellation =
  | CancelledWorkflowGroupExecution
  | AlreadyCancelledWorkflowGroupExecution

/**
 * The durable terminal writes this request's own transaction performed. Each
 * flag is read off that statement's returned row, so it cannot drift from the
 * write: the transaction updates the workflow log only, the cell sidecar only,
 * or both, and `kind` alone collapses those cases.
 */
export interface WorkflowGroupCancellationWrites {
  /** This transaction moved the workflow execution log to `cancelled`. */
  workflowLogTerminalized: boolean
  /** This transaction moved the table cell sidecar to `cancelled`. */
  sidecarCancelled: boolean
}

type WithCancellationWrites<TResult> = TResult & { writes: WorkflowGroupCancellationWrites }

export type WorkflowGroupExecutionCancellationResult =
  | WithCancellationWrites<{ kind: 'not_workflow_group' }>
  | WithCancellationWrites<{ kind: 'conflict'; status: string }>
  | WithCancellationWrites<{ kind: 'cancelled_without_sidecar' }>
  | WithCancellationWrites<{ kind: 'already_cancelled_without_sidecar' }>
  | WithCancellationWrites<CancelledWorkflowGroupExecution>
  | WithCancellationWrites<AlreadyCancelledWorkflowGroupExecution>

interface WorkflowGroupExecutionTarget {
  tableId: string
  rowId: string
  groupId: string
  status: string
  blockErrors: unknown
}

function normalizeBlockErrors(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const blockErrors: Record<string, string> = {}
  for (const [blockId, error] of Object.entries(value)) {
    if (typeof error === 'string') blockErrors[blockId] = error
  }
  return Object.keys(blockErrors).length > 0 ? blockErrors : undefined
}

function getExecutionCorrelationSource(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const executionData = value as Record<string, unknown>
  const correlation = executionData.correlation
  if (!correlation || typeof correlation !== 'object' || Array.isArray(correlation)) return null
  const source = (correlation as Record<string, unknown>).source
  return typeof source === 'string' ? source : null
}

function hasDurableWorkflowGroupOrigin(executionData: unknown): boolean {
  return getExecutionCorrelationSource(executionData) === 'workflow_group'
}

/**
 * Cancels exactly one workflow-group cell attempt identified by its workflow log.
 * Durable workflow-group origin remains authoritative after a row, group, or table
 * deletion removes the cell sidecar: in that case only the exact workflow log is
 * terminalized. A stale or terminal sidecar conflicts instead of falling through,
 * so this request cannot cancel a replacement.
 *
 * The workflow log is locked before the table sidecar to match the executor's terminal
 * write order. Both terminal claims are then committed in one transaction. Completion
 * therefore either wins before this transaction and leaves both records untouched, or
 * observes the committed cancellation and cannot overwrite either record afterward.
 * A locked `cancelled` workflow log proves cancellation owns the terminal outcome, so
 * its exact sidecar can be safely canonicalized from `error` to `cancelled`.
 *
 * This helper only claims durable database state. Publish its `cancelled` result after
 * the exact execution has been signalled with `publishWorkflowGroupCancellationEvent`.
 *
 * Every result carries `writes`, the terminal writes this transaction actually
 * performed, so a caller reporting durability never has to infer it from `kind`.
 */
export async function cancelWorkflowGroupExecution(
  options: CancelWorkflowGroupExecutionOptions
): Promise<WorkflowGroupExecutionCancellationResult> {
  const transition = await db.transaction(async (tx) => {
    const writes: WorkflowGroupCancellationWrites = {
      workflowLogTerminalized: false,
      sidecarCancelled: false,
    }

    const workflowLog = await tx
      .select({
        status: workflowExecutionLogs.status,
        executionData: workflowExecutionLogs.executionData,
      })
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.workspaceId, options.workspaceId),
          eq(workflowExecutionLogs.workflowId, options.workflowId),
          eq(workflowExecutionLogs.executionId, options.executionId)
        )
      )
      .for('update')
      .limit(1)
      .then((rows) => rows[0])

    const target: WorkflowGroupExecutionTarget | undefined = await tx
      .select({
        tableId: tableRowExecutions.tableId,
        rowId: tableRowExecutions.rowId,
        groupId: tableRowExecutions.groupId,
        status: tableRowExecutions.status,
        blockErrors: tableRowExecutions.blockErrors,
      })
      .from(tableRowExecutions)
      .innerJoin(userTableDefinitions, eq(userTableDefinitions.id, tableRowExecutions.tableId))
      .where(
        and(
          eq(userTableDefinitions.workspaceId, options.workspaceId),
          eq(tableRowExecutions.workflowId, options.workflowId),
          eq(tableRowExecutions.executionId, options.executionId)
        )
      )
      .for('update', { of: tableRowExecutions })
      .limit(1)
      .then((rows) => rows[0])

    if (!workflowLog) {
      return { result: { kind: 'conflict', status: 'no_longer_active' } as const, writes }
    }

    if (!target) {
      if (!hasDurableWorkflowGroupOrigin(workflowLog.executionData)) {
        return { result: { kind: 'not_workflow_group' } as const, writes }
      }

      const workflowLogActive = workflowLog.status === 'running' || workflowLog.status === 'pending'
      if (!workflowLogActive && workflowLog.status !== 'cancelled') {
        return { result: { kind: 'conflict', status: workflowLog.status } as const, writes }
      }
      if (workflowLog.status === 'cancelled') {
        return { result: { kind: 'already_cancelled_without_sidecar' } as const, writes }
      }

      const cancelledAt = new Date()
      const [cancelledLog] = await tx
        .update(workflowExecutionLogs)
        .set(cancelledExecutionLogFields(cancelledAt))
        .where(
          and(
            eq(workflowExecutionLogs.workspaceId, options.workspaceId),
            eq(workflowExecutionLogs.workflowId, options.workflowId),
            eq(workflowExecutionLogs.executionId, options.executionId),
            inArray(workflowExecutionLogs.status, ['running', 'pending'])
          )
        )
        .returning({ status: workflowExecutionLogs.status })

      writes.workflowLogTerminalized = cancelledLog?.status === 'cancelled'
      if (!writes.workflowLogTerminalized) {
        throw new Error('Workflow-group cancellation lost its locked workflow-log claim')
      }
      return { result: { kind: 'cancelled_without_sidecar' } as const, writes }
    }

    const workflowLogActive = workflowLog.status === 'running' || workflowLog.status === 'pending'
    const sidecarActive = ACTIVE_WORKFLOW_GROUP_STATUSES.includes(
      target.status as (typeof ACTIVE_WORKFLOW_GROUP_STATUSES)[number]
    )
    const cancellationOwnedSidecarError =
      target.status === 'error' && workflowLog.status === 'cancelled'
    const sidecarClaimable = sidecarActive || cancellationOwnedSidecarError

    if (!workflowLogActive && workflowLog.status !== 'cancelled') {
      return { result: { kind: 'conflict', status: workflowLog.status } as const, writes }
    }
    if (!sidecarClaimable && target.status !== 'cancelled') {
      return { result: { kind: 'conflict', status: target.status } as const, writes }
    }

    const now = new Date()
    if (workflowLogActive) {
      const [cancelledLog] = await tx
        .update(workflowExecutionLogs)
        .set(cancelledExecutionLogFields(now))
        .where(
          and(
            eq(workflowExecutionLogs.workspaceId, options.workspaceId),
            eq(workflowExecutionLogs.workflowId, options.workflowId),
            eq(workflowExecutionLogs.executionId, options.executionId),
            inArray(workflowExecutionLogs.status, ['running', 'pending'])
          )
        )
        .returning({ status: workflowExecutionLogs.status })

      writes.workflowLogTerminalized = cancelledLog?.status === 'cancelled'
      if (!writes.workflowLogTerminalized) {
        throw new Error('Workflow-group cancellation lost its locked workflow-log claim')
      }
    }

    if (sidecarClaimable) {
      const claimableStatuses = cancellationOwnedSidecarError
        ? [...ACTIVE_WORKFLOW_GROUP_STATUSES, 'error']
        : ACTIVE_WORKFLOW_GROUP_STATUSES
      const [cancelledSidecar] = await tx
        .update(tableRowExecutions)
        .set({
          status: 'cancelled',
          jobId: null,
          error: 'Cancelled',
          runningBlockIds: [],
          cancelledAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(tableRowExecutions.tableId, target.tableId),
            eq(tableRowExecutions.rowId, target.rowId),
            eq(tableRowExecutions.groupId, target.groupId),
            eq(tableRowExecutions.workflowId, options.workflowId),
            eq(tableRowExecutions.executionId, options.executionId),
            inArray(tableRowExecutions.status, claimableStatuses)
          )
        )
        .returning({ status: tableRowExecutions.status })

      writes.sidecarCancelled = cancelledSidecar?.status === 'cancelled'
      if (!writes.sidecarCancelled) {
        throw new Error('Workflow-group cancellation lost its locked table-sidecar claim')
      }
    }

    const result = {
      kind: sidecarClaimable ? ('cancelled' as const) : ('already_cancelled' as const),
      tableId: target.tableId,
      rowId: target.rowId,
      groupId: target.groupId,
    }
    return { result, writes, blockErrors: target.blockErrors }
  })

  if (transition.result.kind !== 'cancelled' && transition.result.kind !== 'already_cancelled') {
    return { ...transition.result, writes: transition.writes }
  }

  const blockErrors = normalizeBlockErrors(transition.blockErrors)
  return {
    ...transition.result,
    writes: transition.writes,
    ...(blockErrors ? { blockErrors } : {}),
  }
}

/** Publishes the table-cell projection after cancellation owns the durable terminal claim. */
export async function publishWorkflowGroupCancellationEvent(
  result: PublishableWorkflowGroupCancellation,
  executionId: string
): Promise<void> {
  try {
    await appendTableEvent({
      kind: 'cell',
      tableId: result.tableId,
      rowId: result.rowId,
      groupId: result.groupId,
      status: 'cancelled',
      executionId,
      jobId: null,
      error: 'Cancelled',
      ...(result.blockErrors ? { blockErrors: result.blockErrors } : {}),
    })
  } catch (error) {
    logger.warn('Failed to publish workflow-group cancellation event', {
      tableId: result.tableId,
      rowId: result.rowId,
      groupId: result.groupId,
      executionId,
      error: toError(error).message,
    })
  }
}
