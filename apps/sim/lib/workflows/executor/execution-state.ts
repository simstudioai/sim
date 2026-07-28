import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { and, desc, eq, or, sql } from 'drizzle-orm'
import { materializeExecutionData, TRACE_STORE_REF_KEY } from '@/lib/logs/execution/trace-store'
import type { SerializableExecutionState } from '@/executor/execution/types'

const LATEST_EXECUTION_STATE_CANDIDATE_LIMIT = 10

interface ExecutionStateRecord {
  executionId: string
  state: SerializableExecutionState
}

function isSerializableExecutionState(value: unknown): value is SerializableExecutionState {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  return (
    typeof state.blockStates === 'object' &&
    Array.isArray(state.executedBlocks) &&
    Array.isArray(state.blockLogs) &&
    typeof state.decisions === 'object' &&
    Array.isArray(state.completedLoops) &&
    Array.isArray(state.activeExecutionPath)
  )
}

function extractExecutionState(executionData: unknown): SerializableExecutionState | null {
  if (!executionData || typeof executionData !== 'object') return null
  const state = (executionData as Record<string, unknown>).executionState
  return isSerializableExecutionState(state) ? state : null
}

interface ExecutionStateRow {
  executionId: string
  workflowId: string | null
  workspaceId: string
  executionData: unknown
}

async function materializeExecutionDataFromRow(
  row: ExecutionStateRow | undefined
): Promise<Record<string, unknown> | null> {
  if (!row) return null

  return materializeExecutionData(row.executionData as Record<string, unknown> | null, {
    workspaceId: row.workspaceId,
    workflowId: row.workflowId,
    executionId: row.executionId,
  })
}

async function extractExecutionStateFromRow(
  row: ExecutionStateRow | undefined
): Promise<SerializableExecutionState | null> {
  const executionData = await materializeExecutionDataFromRow(row)
  return extractExecutionState(executionData)
}

export async function getExecutionStateForWorkflow(
  executionId: string,
  workflowId: string
): Promise<SerializableExecutionState | null> {
  const [row] = await db
    .select({
      executionId: workflowExecutionLogs.executionId,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      executionData: workflowExecutionLogs.executionData,
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, executionId),
        eq(workflowExecutionLogs.workflowId, workflowId)
      )
    )
    .limit(1)

  return extractExecutionStateFromRow(row)
}

/**
 * Returns the workflow input recorded for a past execution so a new run can
 * reuse it by reference. `found` distinguishes a missing execution from an
 * execution that recorded no input.
 */
export async function getExecutionInputForWorkflow(
  executionId: string,
  workflowId: string
): Promise<{ found: boolean; input?: unknown }> {
  const [row] = await db
    .select({
      executionId: workflowExecutionLogs.executionId,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      executionData: workflowExecutionLogs.executionData,
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, executionId),
        eq(workflowExecutionLogs.workflowId, workflowId)
      )
    )
    .limit(1)

  if (!row) {
    return { found: false }
  }

  const data = await materializeExecutionDataFromRow(row)
  return { found: true, input: data?.workflowInput }
}

export async function getLatestExecutionStateWithExecutionId(
  workflowId: string
): Promise<ExecutionStateRecord | null> {
  const rows = await db
    .select({
      executionId: workflowExecutionLogs.executionId,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      executionState: sql<unknown>`${workflowExecutionLogs.executionData} -> 'executionState'`,
      traceStoreRef: sql<unknown>`${workflowExecutionLogs.executionData} -> ${TRACE_STORE_REF_KEY}`,
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.workflowId, workflowId),
        or(
          sql`${workflowExecutionLogs.executionData} -> 'executionState' IS NOT NULL`,
          sql`${workflowExecutionLogs.executionData} -> ${TRACE_STORE_REF_KEY} IS NOT NULL`
        )
      )
    )
    .orderBy(desc(workflowExecutionLogs.startedAt))
    .limit(LATEST_EXECUTION_STATE_CANDIDATE_LIMIT)

  for (const row of rows) {
    const state = await extractExecutionStateFromRow({
      executionId: row.executionId,
      workflowId: row.workflowId,
      workspaceId: row.workspaceId,
      executionData: {
        ...(row.executionState !== null && row.executionState !== undefined
          ? { executionState: row.executionState }
          : {}),
        ...(row.traceStoreRef !== null && row.traceStoreRef !== undefined
          ? { [TRACE_STORE_REF_KEY]: row.traceStoreRef }
          : {}),
      },
    })
    if (state) return { executionId: row.executionId, state }
  }

  return null
}
