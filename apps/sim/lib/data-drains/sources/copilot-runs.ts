import { copilotRuns } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { DATA_DRAIN_LIMITS } from '@/lib/data-drains/limits'
import {
  decodeTimeCursor,
  encodeTimeCursor,
  timeCursorOrderBy,
  timeCursorPredicate,
  timeCursorStabilityBound,
} from '@/lib/data-drains/sources/cursor'
import { readBoundedSourcePage, workspaceInOrganization } from '@/lib/data-drains/sources/helpers'
import type { Cursor, DrainSource, SourcePageInput } from '@/lib/data-drains/types'

type CopilotRunRow = typeof copilotRuns.$inferSelect

/**
 * Cursors on terminal `completedAt` so in-flight runs (mutable `status`,
 * `error`, `completedAt`) are not exported until they reach a terminal state.
 */
async function* pages(input: SourcePageInput): AsyncIterable<CopilotRunRow[]> {
  let cursor = decodeTimeCursor(input.cursor)
  while (!input.signal.aborted) {
    const cursorClause = timeCursorPredicate(copilotRuns.completedAt, copilotRuns.id, cursor)
    const orderBy = timeCursorOrderBy(copilotRuns.completedAt, copilotRuns.id)
    const rows = await readBoundedSourcePage({
      table: copilotRuns,
      idColumn: copilotRuns.id,
      condition: and(
        or(
          workspaceInOrganization(copilotRuns.workspaceId, input.organizationId),
          and(isNull(copilotRuns.workspaceId), eq(copilotRuns.organizationId, input.organizationId))
        ),
        isNotNull(copilotRuns.completedAt),
        timeCursorStabilityBound(copilotRuns.completedAt),
        cursorClause
      ),
      orderBy,
      chunkSize: input.chunkSize,
      read: (tx, ids) =>
        tx
          .select()
          .from(copilotRuns)
          .where(inArray(copilotRuns.id, ids))
          .orderBy(...orderBy),
    })

    if (rows.length === 0) return
    yield rows
    const last = rows[rows.length - 1]
    cursor = { ts: last.completedAt!.toISOString(), id: last.id }
    if (rows.length < Math.min(input.chunkSize, DATA_DRAIN_LIMITS.pageRows)) return
  }
}

export const copilotRunsSource: DrainSource<CopilotRunRow> = {
  type: 'copilot_runs',
  displayName: 'Chat runs',
  pages,
  serialize(row) {
    return {
      id: row.id,
      executionId: row.executionId,
      parentRunId: row.parentRunId,
      chatId: row.chatId,
      userId: row.userId,
      workflowId: row.workflowId,
      workspaceId: row.workspaceId,
      streamId: row.streamId,
      agent: row.agent,
      model: row.model,
      provider: row.provider,
      status: row.status,
      requestContext: isRecordLike(row.requestContext)
        ? {
            ...(typeof row.requestContext.requestId === 'string'
              ? { requestId: row.requestContext.requestId.slice(0, 128) }
              : {}),
            ...(typeof row.requestContext.source === 'string'
              ? { source: row.requestContext.source.slice(0, 128) }
              : {}),
          }
        : null,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      error: row.error,
    }
  },
  cursorAfter(row): Cursor {
    return encodeTimeCursor({ ts: row.completedAt!.toISOString(), id: row.id })
  },
}
