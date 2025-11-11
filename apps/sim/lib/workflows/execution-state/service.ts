import { db } from '@sim/db'
import { workflowExecutionStates } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import type { SerializableExecutionState } from '@/executor/execution/snapshot'
import type { SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('WorkflowExecutionStateService')

export type WorkflowExecutionStateStatus = 'success' | 'failed' | 'paused'

export interface WorkflowExecutionStateRecord {
  id: string
  workflowId: string
  triggerBlockId: string
  executionId: string
  runVersion: string | null
  serializedState: SerializableExecutionState
  serializedWorkflow?: SerializedWorkflow
  resolvedInputs: Record<string, any>
  resolvedOutputs: Record<string, any>
  status: WorkflowExecutionStateStatus
  attemptAt: string
}

export interface UpsertWorkflowExecutionStateParams {
  workflowId: string
  triggerBlockId: string
  executionId: string
  runVersion?: string | null
  serializedState: SerializableExecutionState
  serializedWorkflow?: SerializedWorkflow
  resolvedInputs: Record<string, any>
  resolvedOutputs: Record<string, any>
  status: WorkflowExecutionStateStatus
  attemptAt?: Date
}

export async function upsertWorkflowExecutionState(
  params: UpsertWorkflowExecutionStateParams
): Promise<WorkflowExecutionStateRecord> {
  const {
    workflowId,
    triggerBlockId,
    executionId,
    runVersion = null,
    serializedState,
    serializedWorkflow,
    resolvedInputs,
    resolvedOutputs,
    status,
  } = params
  const attemptAt = params.attemptAt ?? new Date()

  const insertValues = {
    id: uuidv4(),
    workflowId,
    triggerBlockId,
    executionId,
    runVersion,
    serializedState,
    serializedWorkflow,
    resolvedInputs,
    resolvedOutputs,
    status,
    attemptAt,
  }

  const [row] = await db
    .insert(workflowExecutionStates)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [workflowExecutionStates.workflowId, workflowExecutionStates.triggerBlockId],
      set: {
        executionId,
        runVersion,
        serializedState,
        serializedWorkflow,
        resolvedInputs,
        resolvedOutputs,
        status,
        attemptAt,
      },
    })
    .returning()

  if (!row) {
    throw new Error('Failed to upsert workflow execution state')
  }

  logger.info('Persisted workflow execution state', {
    workflowId,
    triggerBlockId,
    executionId,
    status,
  })

  return mapRow(row)
}

export async function getWorkflowExecutionState(
  workflowId: string,
  triggerBlockId: string
): Promise<WorkflowExecutionStateRecord | null> {
  const [row] = await db
    .select()
    .from(workflowExecutionStates)
    .where(
      and(
        eq(workflowExecutionStates.workflowId, workflowId),
        eq(workflowExecutionStates.triggerBlockId, triggerBlockId)
      )
    )
    .limit(1)

  if (!row) {
    return null
  }

  return mapRow(row)
}

function mapRow(row: typeof workflowExecutionStates.$inferSelect): WorkflowExecutionStateRecord {
  return {
    id: row.id,
    workflowId: row.workflowId,
    triggerBlockId: row.triggerBlockId,
    executionId: row.executionId,
    runVersion: row.runVersion,
    serializedState: row.serializedState as SerializableExecutionState,
    serializedWorkflow: row.serializedWorkflow as SerializedWorkflow | undefined,
    resolvedInputs: row.resolvedInputs as Record<string, any>,
    resolvedOutputs: row.resolvedOutputs as Record<string, any>,
    status: row.status as WorkflowExecutionStateStatus,
    attemptAt: row.attemptAt.toISOString(),
  }
}

