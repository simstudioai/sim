import { db } from '@sim/db'
import { copilotRuns } from '@sim/db/schema'
import { and, inArray, isNotNull } from 'drizzle-orm'
import {
  decodeTimeCursor,
  encodeTimeCursor,
  timeCursorOrderBy,
  timeCursorPredicate,
} from '@/lib/data-drains/sources/cursor'
import { getOrganizationWorkspaceIds } from '@/lib/data-drains/sources/helpers'
import type { Cursor, DrainSource, SourcePageInput } from '@/lib/data-drains/types'

type CopilotRunRow = typeof copilotRuns.$inferSelect

/**
 * Cursors on terminal `completedAt` so in-flight runs (mutable `status`,
 * `error`, `completedAt`) are not exported until they reach a terminal state.
 */
async function* pages(input: SourcePageInput): AsyncIterable<CopilotRunRow[]> {
  const workspaceIds = await getOrganizationWorkspaceIds(input.organizationId)
  if (workspaceIds.length === 0) return

  let cursor = decodeTimeCursor(input.cursor)
  while (!input.signal.aborted) {
    const cursorClause = timeCursorPredicate(copilotRuns.completedAt, copilotRuns.id, cursor)

    const rows = await db
      .select()
      .from(copilotRuns)
      .where(
        and(
          inArray(copilotRuns.workspaceId, workspaceIds),
          isNotNull(copilotRuns.completedAt),
          cursorClause
        )
      )
      .orderBy(...timeCursorOrderBy(copilotRuns.completedAt, copilotRuns.id))
      .limit(input.chunkSize)

    if (rows.length === 0) return
    yield rows
    const last = rows[rows.length - 1]
    cursor = { ts: last.completedAt!.toISOString(), id: last.id }
    if (rows.length < input.chunkSize) return
  }
}

export const copilotRunsSource: DrainSource<CopilotRunRow> = {
  type: 'copilot_runs',
  displayName: 'Copilot runs',
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
      requestContext: row.requestContext,
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
