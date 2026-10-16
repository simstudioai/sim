import type { db } from '@sim/db'
import { resumeQueue, workflow, workflowExecutionLogs, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { describeError } from '@sim/utils/errors'
import { chunkArray } from '@sim/utils/helpers'
import { and, asc, eq, inArray, or, type SQL } from 'drizzle-orm'
import { enqueueOutboxEvents, MAX_BULK_ENQUEUE_EVENTS } from '@/lib/core/outbox/service'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { markExecutionCancelled } from '@/lib/execution/cancellation'
import { abortManualExecution } from '@/lib/execution/manual-cancellation'
import { EXECUTION_REMOVAL_STOP_EVENT } from '@/lib/execution/removal-stop-event'

const logger = createLogger('ExecutionRemovalStopRecords')

/** Executions one event signals; bounds the payload of a workspace with many live runs. */
const EXECUTIONS_PER_EVENT = 500
const SIGNAL_CONCURRENCY = 10
/** Bounds an inline signal pass; whatever it leaves, the outbox stop signals again. */
const SIGNAL_DEADLINE_MS = 10_000

/**
 * What is being removed. Runs of a removed workspace or workflow lose the rows the ordinary
 * cancel path reads (or, for an archive, the access they ran under), so they are stopped here:
 * every in-flight execution gets the cancellation signal its engine watches, and every queued,
 * delayed or running job enqueued for a removed workspace is cancelled in the job queue.
 */
interface ExecutionStopScope {
  workspaceIds: readonly string[]
  /** An account whose workflows are removed wherever they live, not only in `workspaceIds`. */
  workflowsCreatedBy?: string
}

interface PlannedExecutionStop {
  executionId: string
  executionDeadlineAt: Date | null
  workspaceId: string | null
}

/** Read before a removal erases the rows it names; enqueue with {@link enqueueExecutionStops}. */
export interface ExecutionStopPlan {
  workspaceIds: string[]
  executions: PlannedExecutionStop[]
}

interface ExecutionStopPayload {
  /** Workspace whose queued and running jobs this event sweeps. */
  workspaceId?: string
  executions: { executionId: string; executionDeadlineAt: string | null }[]
}

function scopeCondition(executor: DbOrTx, scope: ExecutionStopScope): SQL | undefined {
  const conditions: SQL[] = []
  if (scope.workspaceIds.length > 0) {
    conditions.push(inArray(workflowExecutionLogs.workspaceId, [...scope.workspaceIds]))
  }
  if (scope.workflowsCreatedBy) {
    conditions.push(
      inArray(
        workflowExecutionLogs.workflowId,
        executor
          .select({ id: workflow.id })
          .from(workflow)
          .where(eq(workflow.userId, scope.workflowsCreatedBy))
      )
    )
  }
  return conditions.length > 1 ? or(...conditions) : conditions[0]
}

/**
 * Reads the executions a removal must stop. Run it in the removal's transaction (or, where the
 * removal is not transactional, immediately before it): a cascade erases these rows. An active
 * resume runs under its own execution id, so the claimed resume of a paused run is included.
 */
export async function collectExecutionStops(
  executor: DbOrTx,
  scope: ExecutionStopScope
): Promise<ExecutionStopPlan> {
  const workspaceIds = [...new Set(scope.workspaceIds)]
  const inScope = scopeCondition(executor, scope)
  if (!inScope) return { workspaceIds, executions: [] }

  const running = await executor
    .select({
      executionId: workflowExecutionLogs.executionId,
      executionDeadlineAt: workflowExecutionLogs.executionDeadlineAt,
      workspaceId: workflowExecutionLogs.workspaceId,
    })
    .from(workflowExecutionLogs)
    .where(and(eq(workflowExecutionLogs.status, 'running'), inScope))
  const resuming = await executor
    .select({
      executionId: resumeQueue.newExecutionId,
      executionDeadlineAt: workflowExecutionLogs.executionDeadlineAt,
      workspaceId: workflowExecutionLogs.workspaceId,
    })
    .from(workflowExecutionLogs)
    .innerJoin(
      resumeQueue,
      and(
        eq(resumeQueue.parentExecutionId, workflowExecutionLogs.executionId),
        eq(resumeQueue.status, 'claimed')
      )
    )
    .where(and(inArray(workflowExecutionLogs.status, ['running', 'pending', 'paused']), inScope))

  const executions = new Map<string, PlannedExecutionStop>()
  for (const row of [...running, ...resuming]) {
    if (!executions.has(row.executionId)) executions.set(row.executionId, row)
  }
  return { workspaceIds, executions: [...executions.values()] }
}

/**
 * For a bare `DELETE FROM "user"`, which cascades every workspace the account owns (archived or
 * not) and every workflow it created, wherever that workflow lives.
 */
export async function collectAccountRemovalStops(
  executor: DbOrTx,
  userId: string
): Promise<ExecutionStopPlan> {
  const owned = await executor
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.ownerId, userId))
  return collectExecutionStops(executor, {
    workspaceIds: owned.map((row) => row.id),
    workflowsCreatedBy: userId,
  })
}

function toPayloadExecutions(
  executions: readonly PlannedExecutionStop[]
): ExecutionStopPayload['executions'] {
  return executions.map(({ executionId, executionDeadlineAt }) => ({
    executionId,
    executionDeadlineAt: executionDeadlineAt?.toISOString() ?? null,
  }))
}

/** One event per removed workspace carries its sweep; executions beyond one event's share spill over. */
function buildPayloads(plan: ExecutionStopPlan): ExecutionStopPayload[] {
  const byWorkspace = new Map<string, PlannedExecutionStop[]>(
    plan.workspaceIds.map((workspaceId) => [workspaceId, []])
  )
  const elsewhere: PlannedExecutionStop[] = []
  for (const execution of plan.executions) {
    const removed = execution.workspaceId ? byWorkspace.get(execution.workspaceId) : undefined
    if (removed) removed.push(execution)
    else elsewhere.push(execution)
  }

  const payloads: ExecutionStopPayload[] = []
  for (const [workspaceId, executions] of byWorkspace) {
    const [first = [], ...rest] = chunkArray(executions, EXECUTIONS_PER_EVENT)
    payloads.push({ workspaceId, executions: toPayloadExecutions(first) })
    for (const chunk of rest) payloads.push({ executions: toPayloadExecutions(chunk) })
  }
  for (const chunk of chunkArray(elsewhere, EXECUTIONS_PER_EVENT)) {
    payloads.push({ executions: toPayloadExecutions(chunk) })
  }
  return payloads
}

/**
 * Records the stops as outbox events. In the removal's transaction they commit or roll back with
 * it; the outbox worker retries each one until it is delivered.
 */
export async function enqueueExecutionStops(
  executor: Pick<typeof db, 'insert'>,
  plan: ExecutionStopPlan
): Promise<void> {
  for (const chunk of chunkArray(buildPayloads(plan), MAX_BULK_ENQUEUE_EVENTS)) {
    await enqueueOutboxEvents(executor, EXECUTION_REMOVAL_STOP_EVENT, chunk)
  }
}

/**
 * {@link collectExecutionStops} then {@link enqueueExecutionStops}, in the caller's transaction.
 * Returns the executions, to signal at once with {@link signalExecutionStops} after commit.
 */
export async function recordExecutionStops(
  executor: DbTransaction,
  scope: ExecutionStopScope & {
    /**
     * Stop only the workspaces this user still owns. Their rows are held `FOR SHARE` until the
     * caller commits, so an ownership transfer racing the stop waits for it instead of having its
     * new owner's runs stopped. Only workspace rows are locked, so no lock order is inverted.
     */
    ownerId?: string
  }
): Promise<ExecutionStopPlan['executions']> {
  let { workspaceIds } = scope
  if (scope.ownerId && workspaceIds.length > 0) {
    const stillOwned = await executor
      .select({ id: workspace.id })
      .from(workspace)
      .where(and(inArray(workspace.id, [...workspaceIds]), eq(workspace.ownerId, scope.ownerId)))
      .orderBy(asc(workspace.id))
      .for('share')
    workspaceIds = stillOwned.map((row) => row.id)
    if (workspaceIds.length === 0 && !scope.workflowsCreatedBy) return []
  }
  const plan = await collectExecutionStops(executor, { ...scope, workspaceIds })
  await enqueueExecutionStops(executor, plan)
  return plan.executions
}

/**
 * Sets the cancellation flag each execution's engine watches, and aborts the ones this process
 * runs, without the queue sweep or the retry the outbox event adds. Callers whose module graph
 * cannot load the delivery stop in-flight runs with it at once and leave the rest to the outbox
 * worker. The deadline (`signal`, else {@link SIGNAL_DEADLINE_MS}) bounds only the Redis writes;
 * every execution this process runs is aborted first. Returns how many flags Redis refused or
 * the deadline left unsent; never throws.
 *
 * Without Redis at all the flag is process-local by design (`markExecutionCancelled`) and a
 * retry from any process could reach no further, so that outcome does not count as refused.
 */
export async function signalExecutionStops(
  executions: readonly Pick<PlannedExecutionStop, 'executionId' | 'executionDeadlineAt'>[],
  signal?: AbortSignal
): Promise<number> {
  for (const { executionId } of executions) {
    try {
      abortManualExecution(executionId)
    } catch (error) {
      logger.warn('Failed to abort a local execution being stopped', {
        executionId,
        error: describeError(error),
      })
    }
  }
  const deadline = signal ?? AbortSignal.timeout(SIGNAL_DEADLINE_MS)
  let refused = 0
  await mapWithConcurrency(executions, SIGNAL_CONCURRENCY, async (execution) => {
    if (deadline.aborted) {
      refused += 1
      return
    }
    try {
      const result = await markExecutionCancelled(execution.executionId, {
        executionDeadlineAt: execution.executionDeadlineAt,
      })
      if (!result.durablyRecorded && result.reason !== 'redis_unavailable') refused += 1
    } catch (error) {
      refused += 1
      logger.warn('Failed to signal an execution being stopped', {
        executionId: execution.executionId,
        error: describeError(error),
      })
    }
  })
  return refused
}
