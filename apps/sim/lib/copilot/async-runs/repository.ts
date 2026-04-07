import { db } from '@sim/db'
import {
  type CopilotAsyncToolStatus,
  type CopilotRunStatus,
  copilotAsyncToolCalls,
  copilotRunCheckpoints,
  copilotRuns,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { ASYNC_TOOL_STATUS, isDeliveredAsyncStatus, isTerminalAsyncStatus } from './lifecycle'

const logger = createLogger('CopilotAsyncRunsRepo')

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

export async function updateRunStatus(
  runId: string,
  status: CopilotRunStatus,
  updates: {
    completedAt?: Date | null
    error?: string | null
    requestContext?: Record<string, unknown>
  } = {}
) {
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

export async function getLatestRunForExecution(executionId: string) {
  const [run] = await db
    .select()
    .from(copilotRuns)
    .where(eq(copilotRuns.executionId, executionId))
    .orderBy(desc(copilotRuns.startedAt))
    .limit(1)

  return run ?? null
}

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
  const [run] = await db.select().from(copilotRuns).where(eq(copilotRuns.id, runId)).limit(1)
  return run ?? null
}

export async function createRunCheckpoint(input: {
  runId: string
  pendingToolCallId: string
  conversationSnapshot: Record<string, unknown>
  agentState: Record<string, unknown>
  providerRequest: Record<string, unknown>
}) {
  const [checkpoint] = await db
    .insert(copilotRunCheckpoints)
    .values({
      runId: input.runId,
      pendingToolCallId: input.pendingToolCallId,
      conversationSnapshot: input.conversationSnapshot,
      agentState: input.agentState,
      providerRequest: input.providerRequest,
    })
    .returning()

  return checkpoint
}

export async function upsertAsyncToolCall(input: {
  runId?: string | null
  checkpointId?: string | null
  toolCallId: string
  toolName: string
  args?: Record<string, unknown>
  status?: CopilotAsyncToolStatus
}) {
  const existing = await getAsyncToolCall(input.toolCallId)
  const incomingStatus = input.status ?? 'pending'
  if (
    existing &&
    (isTerminalAsyncStatus(existing.status) || isDeliveredAsyncStatus(existing.status)) &&
    !isTerminalAsyncStatus(incomingStatus) &&
    !isDeliveredAsyncStatus(incomingStatus)
  ) {
    logger.info('Ignoring async tool upsert that would downgrade terminal state', {
      toolCallId: input.toolCallId,
      existingStatus: existing.status,
      incomingStatus,
    })
    return existing
  }
  const effectiveRunId = input.runId ?? existing?.runId ?? null
  if (!effectiveRunId) {
    logger.warn('upsertAsyncToolCall missing runId and no existing row', {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      status: input.status ?? 'pending',
    })
    return null
  }

  const now = new Date()
  const [row] = await db
    .insert(copilotAsyncToolCalls)
    .values({
      runId: effectiveRunId,
      checkpointId: input.checkpointId ?? null,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      args: input.args ?? {},
      status: incomingStatus,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: copilotAsyncToolCalls.toolCallId,
      set: {
        runId: effectiveRunId,
        checkpointId: input.checkpointId ?? null,
        toolName: input.toolName,
        args: input.args ?? {},
        status: incomingStatus,
        updatedAt: now,
      },
    })
    .returning()

  return row
}

export async function getAsyncToolCall(toolCallId: string) {
  const [row] = await db
    .select()
    .from(copilotAsyncToolCalls)
    .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
    .limit(1)

  return row ?? null
}

export async function markAsyncToolStatus(
  toolCallId: string,
  status: CopilotAsyncToolStatus,
  updates: {
    claimedBy?: string | null
    claimedAt?: Date | null
    result?: Record<string, unknown> | null
    error?: string | null
    completedAt?: Date | null
  } = {}
) {
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
      result: updates.result,
      error: updates.error,
      completedAt: updates.completedAt,
      updatedAt: new Date(),
    })
    .where(eq(copilotAsyncToolCalls.toolCallId, toolCallId))
    .returning()

  return row ?? null
}

export async function markAsyncToolRunning(toolCallId: string, claimedBy: string) {
  return markAsyncToolStatus(toolCallId, 'running', { claimedBy })
}

export async function completeAsyncToolCall(input: {
  toolCallId: string
  status: Extract<CopilotAsyncToolStatus, 'completed' | 'failed' | 'cancelled'>
  result?: Record<string, unknown> | null
  error?: string | null
}) {
  const existing = await getAsyncToolCall(input.toolCallId)

  if (!existing) {
    logger.warn('completeAsyncToolCall called before pending row existed', {
      toolCallId: input.toolCallId,
      status: input.status,
    })
    return null
  }

  if (isTerminalAsyncStatus(existing.status) || isDeliveredAsyncStatus(existing.status)) {
    return existing
  }

  return markAsyncToolStatus(input.toolCallId, input.status, {
    claimedBy: null,
    claimedAt: null,
    result: input.result ?? null,
    error: input.error ?? null,
    completedAt: new Date(),
  })
}

export async function markAsyncToolDelivered(toolCallId: string) {
  return markAsyncToolStatus(toolCallId, ASYNC_TOOL_STATUS.delivered, {
    claimedBy: null,
    claimedAt: null,
  })
}

export async function listAsyncToolCallsForRun(runId: string) {
  return db
    .select()
    .from(copilotAsyncToolCalls)
    .where(eq(copilotAsyncToolCalls.runId, runId))
    .orderBy(desc(copilotAsyncToolCalls.createdAt))
}

export async function getAsyncToolCalls(toolCallIds: string[]) {
  if (toolCallIds.length === 0) return []
  return db
    .select()
    .from(copilotAsyncToolCalls)
    .where(inArray(copilotAsyncToolCalls.toolCallId, toolCallIds))
}

export async function claimCompletedAsyncToolCall(toolCallId: string, workerId: string) {
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

export async function releaseCompletedAsyncToolClaim(toolCallId: string, workerId: string) {
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
        inArray(copilotAsyncToolCalls.status, ['completed', 'failed', 'cancelled']),
        eq(copilotAsyncToolCalls.claimedBy, workerId)
      )
    )
    .returning()

  return row ?? null
}
