import { db } from '@sim/db'
import { pausedExecutions, workflowExecutionLogs } from '@sim/db/schema'
import { filterUndefined, isRecordLike } from '@sim/utils/object'
import { and, desc, eq, ne, or, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { materializeExecutionData, TRACE_STORE_REF_KEY } from '@/lib/logs/execution/trace-store'
import { forceFailedMessage } from '@/lib/workflows/executor/failure-message'
import { buildResumeUiUrl } from '@/executor/constants'
import type { SerializableExecutionState } from '@/executor/execution/types'
import type { PausePoint } from '@/executor/types'
import {
  isResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceProvenanceV1,
} from '@/executor/utils/resolved-secret-trace-registry'
import { TEST_TRIGGER } from '@/stores/logs/filters/types'

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
  trigger?: string
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
      trigger: workflowExecutionLogs.trigger,
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

/**
 * The execution state a run that starts from a block reuses as its source. A test run (a dry run
 * or a workflow test) answered its writes with placeholders, so its state is the source only of
 * another dry run, which says so with `allowTestRun`; any other run is refused it.
 */
export async function getExecutionStateForWorkflow(
  executionId: string,
  workflowId: string,
  { allowTestRun = false }: { allowTestRun?: boolean } = {}
): Promise<SerializableExecutionState | null> {
  const row = await getExecutionStateRow(executionId, workflowId)
  if (row?.trigger === TEST_TRIGGER && !allowTestRun) {
    throw new OrchestrationError(
      'validation',
      `Execution "${executionId}" is a test run (a dry run or a workflow test): its outputs hold placeholders for the writes it did not send, so only a dry run can start from it. Start from a run that was not a test, or run dry.`
    )
  }
  return extractExecutionStateFromRow(row)
}

/** The status of an execution's workflow log, or `undefined` when it never started one. */
export async function getWorkflowExecutionLogStatus(
  executionId: string,
  workflowId: string
): Promise<string | undefined> {
  const [row] = await db
    .select({ status: workflowExecutionLogs.status })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, executionId),
        eq(workflowExecutionLogs.workflowId, workflowId)
      )
    )
    .limit(1)
  return row?.status
}

/** The log's own correlation wins; older logs carried it only on the trigger data. */
function selectCorrelation(
  topLevel: unknown,
  fromTrigger: unknown
): Record<string, unknown> | undefined {
  if (isRecordLike(topLevel)) return topLevel
  return isRecordLike(fromTrigger) ? fromTrigger : undefined
}

/**
 * The Copilot tool call an execution was launched for, from the server-persisted
 * correlation on its log, or `undefined` when no Copilot tool call bound it.
 */
export async function getWorkflowExecutionCopilotToolCallId(
  executionId: string,
  workflowId: string
): Promise<string | undefined> {
  const [row] = await db
    .select({
      correlation: sql<unknown>`${workflowExecutionLogs.executionData} -> 'correlation'`,
      triggerCorrelation: sql<unknown>`${workflowExecutionLogs.executionData} #> '{trigger,data,correlation}'`,
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, executionId),
        eq(workflowExecutionLogs.workflowId, workflowId)
      )
    )
    .limit(1)
  const toolCallId = selectCorrelation(row?.correlation, row?.triggerCorrelation)?.copilotToolCallId
  return typeof toolCallId === 'string' ? toolCallId : undefined
}

/** A paused execution's pause points, stored keyed by context id (older rows: an array). */
/**
 * A point still waiting on a human: not a time pause, and not yet resumed or resuming. The
 * paused-run list admits runs by this rule; `paused-runs.ts` spells it in SQL.
 */
export function isWaitingHumanPausePoint(point: PausePoint): boolean {
  return point.pauseKind !== 'time' && point.resumeStatus === 'paused'
}

export function normalizePausePoints(raw: unknown): PausePoint[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw as PausePoint[]
  if (typeof raw === 'object') return Object.values(raw as Record<string, PausePoint>)
  return []
}

/**
 * The page where a person answers the execution's open pauses, or null when nothing waits on a
 * person: the run is not paused, or is paused only on time and resumes itself.
 */
export async function getHumanPauseResumeUrl(
  executionId: string,
  workflowId: string
): Promise<string | null> {
  const [paused] = await db
    .select({ status: pausedExecutions.status, pausePoints: pausedExecutions.pausePoints })
    .from(pausedExecutions)
    .where(
      and(
        eq(pausedExecutions.executionId, executionId),
        eq(pausedExecutions.workflowId, workflowId)
      )
    )
    .limit(1)
  if (!paused || (paused.status !== 'paused' && paused.status !== 'partially_resumed')) {
    return null
  }
  const waitsOnPerson = normalizePausePoints(paused.pausePoints).some(isWaitingHumanPausePoint)
  return waitsOnPerson ? buildResumeUiUrl(getBaseUrl(), workflowId, executionId) : null
}

/**
 * A terminal run's failure message: its own `error`, else {@link forceFailedMessage}. Unlike
 * `runFailureMessage` it skips `completionFailure`: it reads completed and cancelled runs too, and
 * a completion that fell back to a cost-only log records why there (`Failed to store trace
 * spans: …`, `Run was cancelled`), which is a logging note, not the run's error. A failed run's
 * error is already its own `error` or its forced finalization's message.
 */
function readFailureMessage(executionData: Record<string, unknown>): string | undefined {
  if (typeof executionData.error === 'string') return executionData.error
  return forceFailedMessage(executionData)
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
  const triggerData = isRecordLike(executionData?.trigger) ? executionData.trigger.data : undefined
  const correlation = selectCorrelation(
    executionData?.correlation,
    isRecordLike(triggerData) ? triggerData.correlation : undefined
  )

  if (!executionData || correlation?.copilotToolCallId !== copilotToolCallId) {
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
    ...filterUndefined({ error: readFailureMessage(executionData) }),
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

/**
 * The newest run of the workflow with execution state, the source a run from a block reuses when
 * it names none. Never a test run: see {@link getExecutionStateForWorkflow}.
 */
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
        ne(workflowExecutionLogs.trigger, TEST_TRIGGER),
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
