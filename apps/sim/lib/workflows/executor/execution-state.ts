import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { and, desc, eq, or, sql } from 'drizzle-orm'
import { materializeExecutionData, TRACE_STORE_REF_KEY } from '@/lib/logs/execution/trace-store'
import type { SerializableExecutionState } from '@/executor/execution/types'
import {
  isResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceProvenanceV1,
} from '@/executor/utils/resolved-secret-trace-registry'

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

function extractLegacyWorkflowInput(executionData: Record<string, unknown>): unknown | undefined {
  if (!isRecordLike(executionData.executionState)) return undefined
  const { blockStates } = executionData.executionState
  if (!isRecordLike(blockStates)) return undefined

  for (const state of Object.values(blockStates)) {
    if (
      isRecordLike(state) &&
      state.executed === false &&
      state.executionTime === 0 &&
      state.output != null
    ) {
      return state.output
    }
  }

  return undefined
}

interface ExecutionStateRow {
  executionId: string
  workflowId: string | null
  workspaceId: string
  status?: string
  executionData: unknown
}

interface TrustedWorkflowToolExecutionBase {
  executionId: string
  workflowId: string
  status: 'completed' | 'failed' | 'cancelled'
}

export interface TrustedWorkflowToolExecutionWithoutContent
  extends TrustedWorkflowToolExecutionBase {
  contentAvailable: false
}

export interface TrustedWorkflowToolExecutionWithContent extends TrustedWorkflowToolExecutionBase {
  contentAvailable: true
  finalOutput?: unknown
  error?: string
  blockLogs: SerializableExecutionState['blockLogs']
  provenance: ResolvedSecretTraceProvenanceV1
}

export type TrustedWorkflowToolExecution =
  | TrustedWorkflowToolExecutionWithoutContent
  | TrustedWorkflowToolExecutionWithContent

async function getExecutionStateRow(
  executionId: string,
  workflowId: string
): Promise<ExecutionStateRow | undefined> {
  const [row] = await db
    .select({
      executionId: workflowExecutionLogs.executionId,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      status: workflowExecutionLogs.status,
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

  return row
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
  const row = await getExecutionStateRow(executionId, workflowId)
  return extractExecutionStateFromRow(row)
}

/** Loads a terminal workflow result only when its server-persisted Copilot binding matches. */
export async function getTrustedWorkflowToolExecution(
  executionId: string,
  workflowId: string,
  copilotToolCallId: string
): Promise<TrustedWorkflowToolExecution | null> {
  const row = await getExecutionStateRow(executionId, workflowId)
  if (
    !row ||
    (row.status !== 'completed' && row.status !== 'failed' && row.status !== 'cancelled')
  ) {
    return null
  }

  const executionData = await materializeExecutionDataFromRow(row)
  const state = extractExecutionState(executionData)
  const provenance = state?.resolvedSecretTraceProvenance
  const topLevelCorrelation = executionData?.correlation
  const triggerCorrelation = isRecordLike(executionData?.trigger)
    ? executionData.trigger.data
    : undefined
  const correlation = isRecordLike(topLevelCorrelation)
    ? topLevelCorrelation
    : isRecordLike(triggerCorrelation) && isRecordLike(triggerCorrelation.correlation)
      ? triggerCorrelation.correlation
      : undefined

  if (
    !executionData ||
    !isRecordLike(correlation) ||
    correlation.copilotToolCallId !== copilotToolCallId
  ) {
    return null
  }

  if (!state || !isResolvedSecretTraceProvenanceV1(provenance)) {
    return {
      executionId,
      workflowId,
      status: row.status,
      contentAvailable: false,
    }
  }

  return {
    executionId,
    workflowId,
    status: row.status,
    contentAvailable: true,
    ...(Object.hasOwn(executionData, 'finalOutput')
      ? { finalOutput: executionData.finalOutput }
      : {}),
    ...(typeof executionData.error === 'string' ? { error: executionData.error } : {}),
    blockLogs: state.blockLogs,
    provenance,
  }
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
  const row = await getExecutionStateRow(executionId, workflowId)

  if (!row) {
    return { found: false }
  }

  const data = await materializeExecutionDataFromRow(row)
  if (!data) return { found: true }
  if (Object.hasOwn(data, 'workflowInput')) {
    return { found: true, input: data.workflowInput }
  }
  return { found: true, input: extractLegacyWorkflowInput(data) }
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
