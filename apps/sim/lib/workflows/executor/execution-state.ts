import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { SerializableExecutionState } from '@/executor/execution/types'

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

export async function getExecutionState(
  executionId: string
): Promise<SerializableExecutionState | null> {
  const [row] = await db
    .select({ executionData: workflowExecutionLogs.executionData })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
    .limit(1)

  return extractExecutionState(row?.executionData)
}

export async function getLatestExecutionState(
  workflowId: string
): Promise<SerializableExecutionState | null> {
  const [row] = await db
    .select({ executionData: workflowExecutionLogs.executionData })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.workflowId, workflowId),
        sql`${workflowExecutionLogs.executionData} -> 'executionState' IS NOT NULL`
      )
    )
    .orderBy(desc(workflowExecutionLogs.startedAt))
    .limit(1)

  return extractExecutionState(row?.executionData)
}
