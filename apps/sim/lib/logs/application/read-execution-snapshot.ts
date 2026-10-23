import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { jobExecutionLogs, workflowExecutionLogs, workflowExecutionSnapshots } from '@sim/db/schema'
import { eq, inArray } from 'drizzle-orm'
import type { ExecutionSnapshotData } from '@/lib/api/contracts/logs'
import { defineAuthorizedWorkspaceUseCase, type OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  isConcealedLogAuthorizationError,
  logDelegationAuthorization,
} from '@/lib/logs/application/authorization'
import { logOperations } from '@/lib/logs/application/operations'
import { hydrateChildTraces } from '@/lib/logs/execution/hydrate-child-traces'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import {
  logProjectionSubjectUserId,
  projectCostTotal,
  resolveLogFieldProjection,
} from '@/lib/logs/projection'
import type { TraceSpan, WorkflowExecutionLog } from '@/lib/logs/types'
import {
  type ActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/context'

const SNAPSHOT_QUERY_CHUNK_SIZE = 1_000

interface WorkflowExecutionRecord {
  kind: 'workflow'
  id: string
  workflowId: string | null
  workspaceId: string
  executionId: string
  stateSnapshotId: string
  trigger: string | null
  startedAt: Date
  endedAt: Date | null
  totalDurationMs: number | null
  costTotal: string | null
}

interface JobExecutionRecord {
  kind: 'job'
  id: string
  workspaceId: string
  executionId: string
  trigger: string
  startedAt: Date
  endedAt: Date | null
  totalDurationMs: number | null
  cost: unknown
}

interface ExecutionSnapshotContext extends ActiveWorkspaceApplicationContext {
  executionId: string
  record: WorkflowExecutionRecord | JobExecutionRecord
}

export interface ReadExecutionSnapshotInput {
  executionId: string
  signal?: AbortSignal
}

async function resolveExecutionSnapshotContext(
  input: ReadExecutionSnapshotInput
): Promise<ExecutionSnapshotContext> {
  input.signal?.throwIfAborted()
  const { executionId } = input
  const [workflowRecord] = await db
    .select({
      id: workflowExecutionLogs.id,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      executionId: workflowExecutionLogs.executionId,
      stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      costTotal: workflowExecutionLogs.costTotal,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
    .limit(1)
  input.signal?.throwIfAborted()

  if (workflowRecord) {
    const workspace = await resolveActiveWorkspaceApplicationContext(workflowRecord.workspaceId)
    input.signal?.throwIfAborted()
    return {
      ...workspace,
      executionId,
      record: { kind: 'workflow', ...workflowRecord },
    }
  }

  const [jobRecord] = await db
    .select({
      id: jobExecutionLogs.id,
      workspaceId: jobExecutionLogs.workspaceId,
      executionId: jobExecutionLogs.executionId,
      trigger: jobExecutionLogs.trigger,
      startedAt: jobExecutionLogs.startedAt,
      endedAt: jobExecutionLogs.endedAt,
      totalDurationMs: jobExecutionLogs.totalDurationMs,
      cost: jobExecutionLogs.cost,
    })
    .from(jobExecutionLogs)
    .where(eq(jobExecutionLogs.executionId, executionId))
    .limit(1)
  input.signal?.throwIfAborted()

  if (!jobRecord) throw new OrchestrationError('not_found', 'Workflow execution not found')
  const workspace = await resolveActiveWorkspaceApplicationContext(jobRecord.workspaceId)
  input.signal?.throwIfAborted()
  return { ...workspace, executionId, record: { kind: 'job', ...jobRecord } }
}

async function readSnapshotStates(
  ids: string[],
  signal: AbortSignal | undefined
): Promise<Map<string, unknown>> {
  const states = new Map<string, unknown>()
  for (let index = 0; index < ids.length; index += SNAPSHOT_QUERY_CHUNK_SIZE) {
    signal?.throwIfAborted()
    const rows = await db
      .select({
        id: workflowExecutionSnapshots.id,
        stateData: workflowExecutionSnapshots.stateData,
      })
      .from(workflowExecutionSnapshots)
      .where(
        inArray(workflowExecutionSnapshots.id, ids.slice(index, index + SNAPSHOT_QUERY_CHUNK_SIZE))
      )
    for (const row of rows) states.set(row.id, row.stateData)
  }
  return states
}

/**
 * The run's execution data with the fields a completion write changes alongside it,
 * read in one statement after authorization: a caller the use case refuses never
 * fetches the payload, and a run finishing mid-request cannot pair new data with
 * stale timing or cost.
 */
async function readRunCompletion(executionId: string) {
  const [row] = await db
    .select({
      executionData: workflowExecutionLogs.executionData,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      costTotal: workflowExecutionLogs.costTotal,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
    .limit(1)
  return row
}

function collectChildSnapshotIds(traceSpans: TraceSpan[]): string[] {
  const ids = new Set<string>()
  const pending = [...traceSpans]
  while (pending.length > 0) {
    const span = pending.pop()
    if (!span) continue
    if (typeof span.childWorkflowSnapshotId === 'string') ids.add(span.childWorkflowSnapshotId)
    if (span.children?.length) pending.push(...span.children)
  }
  return [...ids]
}

const authorizedReadExecutionSnapshotUseCase = defineAuthorizedWorkspaceUseCase({
  operation: logOperations.readExecutionSnapshot,
  resolveContext: ({ input }: { input: ReadExecutionSnapshotInput }) =>
    resolveExecutionSnapshotContext(input),
  authorizationOptions: logDelegationAuthorization<ExecutionSnapshotContext>(),
  async execute({ principal, input, context }): Promise<ExecutionSnapshotData> {
    input.signal?.throwIfAborted()
    const record = context.record

    /**
     * A projection rather than a refusal, resolved through the shared helper the
     * log-detail and v1 paths read — see {@link resolveLogFieldProjection}. Applied
     * here in the use case so both doors onto this read inherit it: the internal
     * snapshot route and the `logs_get_execution` Copilot tool.
     *
     * `cost` is the only field on the withheld list this resource carries. The
     * snapshot's other payloads are the workflow's own definition — its state
     * snapshot and any child-workflow snapshots — which neither capability
     * withholds, and the execution data is read only to collect child snapshot
     * ids; no trace span, block execution, input or final output is returned.
     *
     * permission-group-enforced: logs.cost
     */
    const projection = await resolveLogFieldProjection(
      logProjectionSubjectUserId(principal),
      context.workspaceId,
      context.workspaceOrganizationId
    )

    if (record.kind === 'job') {
      return {
        executionId: record.executionId,
        workflowId: null,
        workflowState: null,
        childWorkflowSnapshots: {},
        executionMetadata: {
          trigger: record.trigger,
          startedAt: record.startedAt.toISOString(),
          endedAt: record.endedAt?.toISOString(),
          totalDurationMs: record.totalDurationMs,
          cost: projection.hideCostInfo ? null : record.cost || null,
        },
      }
    }

    const workflowState = (await readSnapshotStates([record.stateSnapshotId], input.signal)).get(
      record.stateSnapshotId
    )
    if (workflowState === undefined) {
      throw new OrchestrationError('not_found', 'Workflow state snapshot not found')
    }

    input.signal?.throwIfAborted()
    const completion = await readRunCompletion(record.executionId)
    if (!completion) throw new OrchestrationError('not_found', 'Workflow execution not found')
    const executionData = (await materializeExecutionData(
      completion.executionData as Record<string, unknown> | null,
      {
        workspaceId: context.workspaceId,
        workflowId: record.workflowId,
        executionId: record.executionId,
      }
    )) as WorkflowExecutionLog['executionData']
    const traceSpans = (executionData?.traceSpans as TraceSpan[]) || []
    if (traceSpans.length > 0) {
      // Attribution, not authorization: the publisher's policy is the only gate,
      // and an actorless run has no user to name.
      await hydrateChildTraces(traceSpans, {
        viewerUserId: resolvePrincipalSubjectUserId(principal),
      })
    }

    const childWorkflowSnapshots = await readSnapshotStates(
      collectChildSnapshotIds(traceSpans),
      input.signal
    )

    input.signal?.throwIfAborted()
    return {
      executionId: record.executionId,
      workflowId: record.workflowId,
      workflowState: workflowState as Record<string, unknown>,
      childWorkflowSnapshots: Object.fromEntries(childWorkflowSnapshots),
      executionMetadata: {
        trigger: record.trigger,
        startedAt: record.startedAt.toISOString(),
        endedAt: completion.endedAt?.toISOString(),
        totalDurationMs: completion.totalDurationMs,
        cost: projectCostTotal(completion.costTotal, projection),
      },
    }
  },
})

export const readExecutionSnapshotUseCase: OperationUseCase<
  typeof logOperations.readExecutionSnapshot,
  ReadExecutionSnapshotInput,
  ExecutionSnapshotData
> = {
  operation: logOperations.readExecutionSnapshot,
  async execute(args) {
    try {
      return await authorizedReadExecutionSnapshotUseCase.execute(args)
    } catch (error) {
      if (isConcealedLogAuthorizationError(error)) {
        throw new OrchestrationError('not_found', 'Workflow execution not found')
      }
      throw error
    }
  },
}
