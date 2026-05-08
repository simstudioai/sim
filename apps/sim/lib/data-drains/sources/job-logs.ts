import { db } from '@sim/db'
import { jobExecutionLogs } from '@sim/db/schema'
import { and, inArray, isNotNull } from 'drizzle-orm'
import {
  decodeTimeCursor,
  encodeTimeCursor,
  timeCursorOrderBy,
  timeCursorPredicate,
} from '@/lib/data-drains/sources/cursor'
import { getOrganizationWorkspaceIds } from '@/lib/data-drains/sources/helpers'
import type { Cursor, DrainSource, SourcePageInput } from '@/lib/data-drains/types'

type JobLogRow = typeof jobExecutionLogs.$inferSelect

/**
 * Cursors on terminal `endedAt` so in-flight rows (mutable `status`, `endedAt`,
 * `totalDurationMs`, `executionData`) are not exported until finalized.
 */
async function* pages(input: SourcePageInput): AsyncIterable<JobLogRow[]> {
  const workspaceIds = await getOrganizationWorkspaceIds(input.organizationId)
  if (workspaceIds.length === 0) return

  let cursor = decodeTimeCursor(input.cursor)
  while (!input.signal.aborted) {
    const cursorClause = timeCursorPredicate(jobExecutionLogs.endedAt, jobExecutionLogs.id, cursor)

    const rows = await db
      .select()
      .from(jobExecutionLogs)
      .where(
        and(
          inArray(jobExecutionLogs.workspaceId, workspaceIds),
          isNotNull(jobExecutionLogs.endedAt),
          cursorClause
        )
      )
      .orderBy(...timeCursorOrderBy(jobExecutionLogs.endedAt, jobExecutionLogs.id))
      .limit(input.chunkSize)

    if (rows.length === 0) return
    yield rows
    const last = rows[rows.length - 1]
    cursor = { ts: last.endedAt!.toISOString(), id: last.id }
    if (rows.length < input.chunkSize) return
  }
}

export const jobLogsSource: DrainSource<JobLogRow> = {
  type: 'job_logs',
  displayName: 'Job execution logs',
  pages,
  serialize(row) {
    return {
      id: row.id,
      executionId: row.executionId,
      scheduleId: row.scheduleId,
      workspaceId: row.workspaceId,
      level: row.level,
      status: row.status,
      trigger: row.trigger,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      totalDurationMs: row.totalDurationMs,
      executionData: row.executionData,
      cost: row.cost,
      createdAt: row.createdAt.toISOString(),
    }
  },
  cursorAfter(row): Cursor {
    return encodeTimeCursor({ ts: row.endedAt!.toISOString(), id: row.id })
  },
}
