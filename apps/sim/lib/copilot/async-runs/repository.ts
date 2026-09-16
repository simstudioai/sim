import { trace } from '@opentelemetry/api'
import { db } from '@sim/db'
import {
  type CopilotAsyncToolStatus,
  type CopilotRunStatus,
  type CopilotToolPermissionDecision,
  copilotAsyncToolCalls,
  copilotRuns,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { filterUndefined } from '@sim/utils/object'
import { sanitizeValueForJsonb } from '@sim/utils/string'
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { AsyncToolCallOwnershipError } from '@/lib/copilot/async-runs/errors'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { markSpanForError } from '@/lib/copilot/request/otel'
import {
  ASYNC_TOOL_STATUS,
  type AsyncCompletionData,
  type AsyncTerminalStatus,
  EXECUTABLE_TOOL_PERMISSION_DECISIONS,
} from './lifecycle'

const logger = createLogger('CopilotAsyncRunsRepo')
const WORKFLOW_EXECUTION_CLAIM_PREFIX = 'workflow:'
// Resolve the tracer lazily per-call to avoid capturing the NoOp tracer
// before NodeSDK installs the global TracerProvider (Next.js 16/Turbopack
// can evaluate modules before instrumentation-node.ts finishes).
const getAsyncRunsTracer = () => trace.getTracer('sim-copilot-async-runs', '1.0.0')

/**
 * Wrap an async DB op in a client-kind span with canonical `db.*` attrs.
 * Cancellation is routed through `markSpanForError` so aborts record the
 * exception event but don't paint spans red.
 *
 * Every caller writes `return await withDbSpan(...)`. The `await` is
 * load-bearing, not redundant: Next 16.3.0's Turbopack optimizer models a bare
 * `return <asyncCall>()` tail call as returning the promise object, then
 * propagates that always-truthy fact through the caller's `await`. It deleted
 * the entire insert path from `upsertAsyncToolCall` in the shipped bundle
 * because `if (existing) return existing` looked always-taken.
 */
async function withDbSpan<T>(
  name: string,
  op: string,
  table: string,
  attrs: Record<string, string | number | boolean | undefined>,
  fn: () => Promise<T>
): Promise<T> {
  const span = getAsyncRunsTracer().startSpan(name, {
    attributes: {
      [TraceAttr.DbSystem]: 'postgresql',
      [TraceAttr.DbOperation]: op,
      [TraceAttr.DbSqlTable]: table,
      ...filterUndefined(attrs),
    },
  })
  try {
    return await fn()
  } catch (error) {
    markSpanForError(span, error)
    throw error
  } finally {
    span.end()
  }
}

export interface CreateRunSegmentInput {
  id?: string
  executionId: string
  parentRunId?: string | null
  chatId: string
  userId: string
  workflowId?: string | null
  workspaceId?: string | null
  streamId: string
  agent?: string | null
  model?: string | null
  provider?: string | null
  requestContext?: Record<string, unknown>
  status?: CopilotRunStatus
}

export async function createRunSegment(input: CreateRunSegmentInput) {
  return await withDbSpan(
    TraceSpan.CopilotAsyncRunsCreateRunSegment,
    'INSERT',
    'copilot_runs',
    {
      [TraceAttr.CopilotExecutionId]: input.executionId,
      [TraceAttr.ChatId]: input.chatId,
      [TraceAttr.StreamId]: input.streamId,
      [TraceAttr.UserId]: input.userId,
      [TraceAttr.CopilotRunParentId]: input.parentRunId ?? undefined,
      [TraceAttr.CopilotRunAgent]: input.agent ?? undefined,
      [TraceAttr.CopilotRunModel]: input.model ?? undefined,
      [TraceAttr.CopilotRunProvider]: input.provider ?? undefined,
      [TraceAttr.CopilotRunStatus]: input.status ?? 'active',
    },
    async () => {
      const [run] = await db
        .insert(copilotRuns)
        .values({
          ...(input.id ? { id: input.id } : {}),
          executionId: input.executionId,
          parentRunId: input.parentRunId ?? null,
          chatId: input.chatId,
          userId: input.userId,
          workflowId: input.workflowId ?? null,
          workspaceId: input.workspaceId ?? null,
          streamId: input.streamId,
          agent: input.agent ?? null,
          model: input.model ?? null,
          provider: input.provider ?? null,
          requestContext: input.requestContext ?? {},
          status: input.status ?? 'active',
        })
        .returning()
      return run
    }
  )
}

export async function updateRunStatus(
  runId: string,
  status: CopilotRunStatus,
  updates: {
    completedAt?: Date | null
    error?: string | null
    requestContext?: Record<string, unknown>
  } = {}
) {
  return await withDbSpan(
    TraceSpan.CopilotAsyncRunsUpdateRunStatus,
    'UPDATE',
    'copilot_runs',
    {
      [TraceAttr.RunId]: runId,
      [TraceAttr.CopilotRunStatus]: status,
      [TraceAttr.CopilotRunHasError]: !!updates.error,
      [TraceAttr.CopilotRunHasCompletedAt]: !!updates.completedAt,
    },
    async () => {
      const [run] = await db
        .update(copilotRuns)
        .set({
          status,
          completedAt: updates.completedAt,
          error: updates.error,
          requestContext: updates.requestContext,
          updatedAt: new Date(),
        })
        .where(eq(copilotRuns.id, runId))
        .returning()
      return run ?? null
    }
  )
}

// Un-instrumented: called from a 4 Hz resume poll; per-call spans
// swamped traces. Use Prom histograms if latency visibility is needed.
export async function getLatestRunForStream(streamId: string, userId?: string) {
  const conditions = userId
    ? and(eq(copilotRuns.streamId, streamId), eq(copilotRuns.userId, userId))
    : eq(copilotRuns.streamId, streamId)
  const [run] = await db
    .select()
    .from(copilotRuns)
    .where(conditions)
    .orderBy(desc(copilotRuns.startedAt))
    .limit(1)
  return run ?? null
}

export async function getRunSegment(runId: string) {
  return await withDbSpan(
    TraceSpan.CopilotAsyncRunsGetRunSegment,
    'SELECT',
    'copilot_runs',
    { [TraceAttr.RunId]: runId },
    async () => {
      const [run] = await db
        .select({
          id: copilotRuns.id,
          userId: copilotRuns.userId,
          status: copilotRuns.status,
          workflowId: copilotRuns.workflowId,
          // Needed to scope an "allow for this chat" decision to its chat.
          chatId: copilotRuns.chatId,
          // Needed to resolve the deciding user's permission group.
          workspaceId: copilotRuns.workspaceId,
        })
        .from(copilotRuns)
        .where(eq(copilotRuns.id, runId))
        .limit(1)
      return run ?? null
    }
  )
}

export async function upsertAsyncToolCall(input: {
  runId?: string | null
  checkpointId?: string | null
  toolCallId: string
  toolName: string
  args?: Record<string, unknown>
  status?: CopilotAsyncToolStatus
  sealedContext?: AsyncCompletionData
}) {
  return await withDbSpan(
    TraceSpan.CopilotAsyncRunsUpsertAsyncToolCall,
    'UPSERT',
    'copilot_async_tool_calls',
    {
      [TraceAttr.ToolCallId]: input.toolCallId,
      [TraceAttr.ToolName]: input.toolName,
      [TraceAttr.CopilotAsyncToolStatus]: input.status ?? 'pending',
      [TraceAttr.RunId]: input.runId ?? undefined,
    },
    async () => {
      const existing = await getAsyncToolCall(input.toolCallId)
      if (existing) {
        if (input.runId && existing.runId !== input.runId) {
          throw new AsyncToolCallOwnershipError()
        }
        return existing
      }

      const incomingStatus = input.status ?? 'pending'
      const effectiveRunId = input.runId ?? null
      if (!effectiveRunId) {
        logger.warn('upsertAsyncToolCall missing runId and no existing row', {
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          status: input.status ?? 'pending',
        })
        return null
      }

      const now = new Date()
      const args = sanitizeValueForJsonb(input.args ?? {})
      const sealedContext = sanitizeValueForJsonb(input.sealedContext)
      const [row] = await db
        .insert(copilotAsyncToolCalls)
        .values({
          runId: effectiveRunId,
          checkpointId: input.checkpointId ?? null,
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          args,
          status: incomingStatus,
          ...(sealedContext !== undefined ? { result: sealedContext } : {}),
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning()

      const persisted = row ?? (await getAsyncToolCall(input.toolCallId))
      if (persisted && persisted.runId !== effectiveRunId) {
        throw new AsyncToolCallOwnershipError()
      }
      return persisted
    }
  )
}

export async function getAsyncToolCall(toolCallId: string) {
  return await withDbSpan(
    TraceSpan.CopilotAsyncRunsGetAsyncToolCall,
    'SELECT',
    'copilot_async_tool_calls',
    { [TraceAttr.ToolCallId]: toolCallId },
    async () => {
      const [row] = await db
        .select()
        .from(copilotAsyncToolCalls)
        .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
        .limit(1)
      return row ?? null
    }
  )
}

async function markAsyncToolStatus(
  toolCallId: string,
  status: CopilotAsyncToolStatus,
  updates: {
    claimedBy?: string | null
    claimedAt?: Date | null
    result?: AsyncCompletionData | null
    error?: string | null
    completedAt?: Date | null
  } = {},
  expectedStatuses?: CopilotAsyncToolStatus[],
  expectedClaimedBy?: string
) {
  return await withDbSpan(
    TraceSpan.CopilotAsyncRunsMarkAsyncToolStatus,
    'UPDATE',
    'copilot_async_tool_calls',
    {
      [TraceAttr.ToolCallId]: toolCallId,
      [TraceAttr.CopilotAsyncToolStatus]: status,
      [TraceAttr.CopilotAsyncToolHasError]: !!updates.error,
      [TraceAttr.CopilotAsyncToolClaimedBy]: expectedClaimedBy ?? updates.claimedBy ?? undefined,
    },
    async () => {
      const claimedAt =
        updates.claimedAt !== undefined
          ? updates.claimedAt
          : status === 'running' && updates.claimedBy
            ? new Date()
            : undefined

      const [row] = await db
        .update(copilotAsyncToolCalls)
        .set({
          status,
          claimedBy: updates.claimedBy,
          claimedAt,
          // Results carry client/page-derived text; lone UTF-16 surrogates or
          // NULs in it would make the jsonb write throw (invalid JSON input).
          result: sanitizeValueForJsonb(updates.result),
          error: updates.error,
          completedAt: updates.completedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(copilotAsyncToolCalls.toolCallId, toolCallId),
            expectedStatuses ? inArray(copilotAsyncToolCalls.status, expectedStatuses) : undefined,
            expectedClaimedBy ? eq(copilotAsyncToolCalls.claimedBy, expectedClaimedBy) : undefined
          )
        )
        .returning()

      return row ?? null
    }
  )
}

export async function markAsyncToolRunning(toolCallId: string, claimedBy: string) {
  return markAsyncToolStatus(toolCallId, 'running', { claimedBy })
}

export function getClaimedWorkflowExecutionId(claimedBy: string | null | undefined) {
  if (!claimedBy?.startsWith(WORKFLOW_EXECUTION_CLAIM_PREFIX)) return undefined
  const executionId = claimedBy.slice(WORKFLOW_EXECUTION_CLAIM_PREFIX.length)
  return executionId.length > 0 ? executionId : undefined
}

export async function claimWorkflowToolExecution(toolCallId: string, executionId: string) {
  const claimedBy = `${WORKFLOW_EXECUTION_CLAIM_PREFIX}${executionId}`
  return await withDbSpan(
    TraceSpan.CopilotAsyncRunsMarkAsyncToolStatus,
    'UPDATE',
    'copilot_async_tool_calls',
    {
      [TraceAttr.ToolCallId]: toolCallId,
      [TraceAttr.CopilotAsyncToolClaimedBy]: claimedBy,
    },
    async () => {
      const now = new Date()
      const [row] = await db
        .update(copilotAsyncToolCalls)
        .set({
          status: sql`CASE WHEN ${copilotAsyncToolCalls.status} = ${ASYNC_TOOL_STATUS.pending} THEN ${ASYNC_TOOL_STATUS.running} ELSE ${copilotAsyncToolCalls.status} END`,
          claimedBy,
          claimedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(copilotAsyncToolCalls.toolCallId, toolCallId),
            isNull(copilotAsyncToolCalls.claimedBy),
            or(
              inArray(copilotAsyncToolCalls.status, [
                ASYNC_TOOL_STATUS.running,
                ASYNC_TOOL_STATUS.delivered,
              ]),
              and(
                eq(copilotAsyncToolCalls.status, ASYNC_TOOL_STATUS.pending),
                inArray(copilotAsyncToolCalls.permissionDecision, [
                  ...EXECUTABLE_TOOL_PERMISSION_DECISIONS,
                ])
              )
            )
          )
        )
        .returning()
      return row ?? null
    }
  )
}

export async function releaseWorkflowToolExecutionClaim(toolCallId: string, executionId: string) {
  const claimedBy = `${WORKFLOW_EXECUTION_CLAIM_PREFIX}${executionId}`
  return await withDbSpan(
    TraceSpan.CopilotAsyncRunsReleaseClaim,
    'UPDATE',
    'copilot_async_tool_calls',
    {
      [TraceAttr.ToolCallId]: toolCallId,
      [TraceAttr.CopilotAsyncToolClaimedBy]: claimedBy,
    },
    async () => {
      const [row] = await db
        .update(copilotAsyncToolCalls)
        .set({
          claimedBy: null,
          claimedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(copilotAsyncToolCalls.toolCallId, toolCallId),
            eq(copilotAsyncToolCalls.claimedBy, claimedBy),
            inArray(copilotAsyncToolCalls.status, [
              ASYNC_TOOL_STATUS.running,
              ASYNC_TOOL_STATUS.delivered,
            ])
          )
        )
        .returning()
      return row ?? null
    }
  )
}

/**
 * Atomically claims a pending client tool exactly once. Native browser actions
 * use this before crossing the Electron boundary so a replayed renderer event
 * cannot click, type, submit, or navigate twice.
 */
export async function claimPendingAsyncToolCall(toolCallId: string, claimedBy: string) {
  return await withDbSpan(
    TraceSpan.CopilotAsyncRunsMarkAsyncToolStatus,
    'UPDATE',
    'copilot_async_tool_calls',
    {
      [TraceAttr.ToolCallId]: toolCallId,
      [TraceAttr.CopilotAsyncToolStatus]: ASYNC_TOOL_STATUS.running,
      [TraceAttr.CopilotAsyncToolClaimedBy]: claimedBy,
    },
    async () => {
      const now = new Date()
      const [row] = await db
        .update(copilotAsyncToolCalls)
        .set({
          status: ASYNC_TOOL_STATUS.running,
          claimedBy,
          claimedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(copilotAsyncToolCalls.toolCallId, toolCallId),
            eq(copilotAsyncToolCalls.status, ASYNC_TOOL_STATUS.pending)
          )
        )
        .returning()
      return row ?? null
    }
  )
}

interface CompleteAsyncToolCallInput {
  toolCallId: string
  status: Extract<CopilotAsyncToolStatus, 'completed' | 'failed' | 'cancelled'>
  result?: AsyncCompletionData | null
  error?: string | null
}

async function completeAsyncToolCallFromStatuses(
  input: CompleteAsyncToolCallInput,
  expectedStatuses: CopilotAsyncToolStatus[],
  expectedClaimedBy?: string
) {
  return await markAsyncToolStatus(
    input.toolCallId,
    input.status,
    {
      claimedBy: null,
      claimedAt: null,
      result: input.result ?? null,
      error: input.error ?? null,
      completedAt: new Date(),
    },
    expectedStatuses,
    expectedClaimedBy
  )
}

export async function completeAsyncToolCall(input: CompleteAsyncToolCallInput) {
  return await completeAsyncToolCallFromStatuses(input, [
    ASYNC_TOOL_STATUS.pending,
    ASYNC_TOOL_STATUS.running,
  ])
}

/**
 * Finalizes a client tool only while it remains unclaimed. This is the inverse
 * CAS of `claimPendingAsyncToolCall`: exactly one of a renderer-side preclaim
 * failure or the native authorization claim may transition the pending row.
 */
export async function completePendingAsyncToolCall(input: CompleteAsyncToolCallInput) {
  return await completeAsyncToolCallFromStatuses(input, [ASYNC_TOOL_STATUS.pending])
}

/** Finalizes only the exact native claim that won a pending completion race. */
export async function completeClaimedAsyncToolCall(
  input: CompleteAsyncToolCallInput,
  claimedBy: string
) {
  return await completeAsyncToolCallFromStatuses(input, [ASYNC_TOOL_STATUS.running], claimedBy)
}

/**
 * Atomically detaches a live client tool after the browser reports that it is
 * continuing in the background. Whichever terminal or detach transition wins
 * is the only result eligible for publication.
 */
export async function detachAsyncToolCall(
  toolCallId: string,
  options?: { preserveClaim?: boolean }
) {
  return markAsyncToolStatus(
    toolCallId,
    ASYNC_TOOL_STATUS.delivered,
    options?.preserveClaim ? {} : { claimedBy: null, claimedAt: null },
    [ASYNC_TOOL_STATUS.pending, ASYNC_TOOL_STATUS.running]
  )
}

/**
 * Replaces an already-terminal async tool call from a trusted producer.
 *
 * Client workflow confirmations are persisted structurally first. The live
 * Copilot waiter uses this guarded update only after it has restored and
 * projected the server-owned workflow result.
 */
export async function replaceTerminalAsyncToolCallResult(input: {
  toolCallId: string
  status: AsyncTerminalStatus
  result: AsyncCompletionData | null
  error: string | null
}) {
  return await withDbSpan(
    TraceSpan.CopilotAsyncRunsMarkAsyncToolStatus,
    'UPDATE',
    'copilot_async_tool_calls',
    {
      [TraceAttr.ToolCallId]: input.toolCallId,
      [TraceAttr.CopilotAsyncToolStatus]: input.status,
      [TraceAttr.CopilotAsyncToolHasError]: !!input.error,
    },
    async () => {
      const [row] = await db
        .update(copilotAsyncToolCalls)
        .set({
          status: input.status,
          result: sanitizeValueForJsonb(input.result),
          error: input.error,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(copilotAsyncToolCalls.toolCallId, input.toolCallId),
            eq(copilotAsyncToolCalls.status, input.status)
          )
        )
        .returning()

      return row ?? null
    }
  )
}

/**
 * Records the user's answer to a tool permission prompt, exactly once.
 *
 * The `IS NULL` guard is what makes a decision final: two tabs (or a click
 * plus an "allow all") racing on the same prompt resolve to whichever write
 * lands first, and the loser gets `null` back rather than overwriting an
 * answer the orchestrator may already have acted on.
 */
export async function recordToolPermissionDecision(
  toolCallId: string,
  decision: CopilotToolPermissionDecision
) {
  return await withDbSpan(
    TraceSpan.CopilotAsyncRunsMarkAsyncToolStatus,
    'UPDATE',
    'copilot_async_tool_calls',
    {
      [TraceAttr.ToolCallId]: toolCallId,
      [TraceAttr.CopilotAsyncToolPermissionDecision]: decision,
    },
    async () => {
      const now = new Date()
      const [row] = await db
        .update(copilotAsyncToolCalls)
        .set({
          permissionDecision: decision,
          permissionDecidedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(copilotAsyncToolCalls.toolCallId, toolCallId),
            isNull(copilotAsyncToolCalls.permissionDecision),
            eq(copilotAsyncToolCalls.status, ASYNC_TOOL_STATUS.pending)
          )
        )
        .returning()
      return row ?? null
    }
  )
}

export async function getAsyncToolCalls(toolCallIds: string[]) {
  if (toolCallIds.length === 0) return []
  return await withDbSpan(
    TraceSpan.CopilotAsyncRunsGetMany,
    'SELECT',
    'copilot_async_tool_calls',
    { [TraceAttr.CopilotAsyncToolIdsCount]: toolCallIds.length },
    async () =>
      db
        .select()
        .from(copilotAsyncToolCalls)
        .where(inArray(copilotAsyncToolCalls.toolCallId, toolCallIds))
  )
}

export async function claimCompletedAsyncToolCall(toolCallId: string, workerId: string) {
  return await withDbSpan(
    TraceSpan.CopilotAsyncRunsClaimCompleted,
    'UPDATE',
    'copilot_async_tool_calls',
    {
      [TraceAttr.ToolCallId]: toolCallId,
      [TraceAttr.CopilotAsyncToolWorkerId]: workerId,
    },
    async () => {
      const [row] = await db
        .update(copilotAsyncToolCalls)
        .set({
          claimedBy: workerId,
          claimedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(copilotAsyncToolCalls.toolCallId, toolCallId),
            inArray(copilotAsyncToolCalls.status, ['completed', 'failed', 'cancelled']),
            isNull(copilotAsyncToolCalls.claimedBy)
          )
        )
        .returning()
      return row ?? null
    }
  )
}
