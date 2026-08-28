import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
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
import type { TraceSpan, WorkflowExecutionLog } from '@/lib/logs/types'
import {
  type ActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'

const CHILD_SNAPSHOT_QUERY_CHUNK_SIZE = 1_000

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
  executionData: unknown
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
      executionData: workflowExecutionLogs.executionData,
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
          cost: record.cost || null,
        },
      }
    }

    const [snapshot] = await db
      .select()
      .from(workflowExecutionSnapshots)
      .where(eq(workflowExecutionSnapshots.id, record.stateSnapshotId))
      .limit(1)
    if (!snapshot) {
      throw new OrchestrationError('not_found', 'Workflow state snapshot not found')
    }

    const executionData = (await materializeExecutionData(
      record.executionData as Record<string, unknown> | null,
      {
        workspaceId: context.workspaceId,
        workflowId: record.workflowId,
        executionId: record.executionId,
      }
    )) as WorkflowExecutionLog['executionData']
    const traceSpans = (executionData?.traceSpans as TraceSpan[]) || []
    if (traceSpans.length > 0) {
      await hydrateChildTraces(traceSpans, {
        viewerUserId: requirePrincipalSubjectUserId(principal),
      })
    }

    const childSnapshotIds = collectChildSnapshotIds(traceSpans)
    const childWorkflowSnapshots: Array<{ id: string; stateData: unknown }> = []
    for (let index = 0; index < childSnapshotIds.length; index += CHILD_SNAPSHOT_QUERY_CHUNK_SIZE) {
      input.signal?.throwIfAborted()
      childWorkflowSnapshots.push(
        ...(await db
          .select({
            id: workflowExecutionSnapshots.id,
            stateData: workflowExecutionSnapshots.stateData,
          })
          .from(workflowExecutionSnapshots)
          .where(
            inArray(
              workflowExecutionSnapshots.id,
              childSnapshotIds.slice(index, index + CHILD_SNAPSHOT_QUERY_CHUNK_SIZE)
            )
          ))
      )
    }

    input.signal?.throwIfAborted()
    return {
      executionId: record.executionId,
      workflowId: record.workflowId,
      workflowState: snapshot.stateData as Record<string, unknown>,
      childWorkflowSnapshots: Object.fromEntries(
        childWorkflowSnapshots.map((child) => [child.id, child.stateData])
      ),
      executionMetadata: {
        trigger: record.trigger,
        startedAt: record.startedAt.toISOString(),
        endedAt: record.endedAt?.toISOString(),
        totalDurationMs: record.totalDurationMs,
        cost: record.costTotal != null ? { total: Number(record.costTotal) } : null,
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
