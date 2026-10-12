import { jobExecutionLogs } from '@sim/db/schema'
import { and, inArray, isNotNull } from 'drizzle-orm'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
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
import { materializeExecutionDataForDisplay } from '@/lib/logs/execution/trace-store'

type JobLogRow = typeof jobExecutionLogs.$inferSelect

/**
 * Cursors on terminal `endedAt` so in-flight rows (mutable `status`, `endedAt`,
 * `totalDurationMs`, `executionData`) are not exported until finalized.
 */
async function* pages(input: SourcePageInput): AsyncIterable<JobLogRow[]> {
  let cursor = decodeTimeCursor(input.cursor)
  while (!input.signal.aborted) {
    const cursorClause = timeCursorPredicate(jobExecutionLogs.endedAt, jobExecutionLogs.id, cursor)

    const orderBy = timeCursorOrderBy(jobExecutionLogs.endedAt, jobExecutionLogs.id)
    const rows = await readBoundedSourcePage({
      table: jobExecutionLogs,
      idColumn: jobExecutionLogs.id,
      condition: and(
        workspaceInOrganization(jobExecutionLogs.workspaceId, input.organizationId),
        isNotNull(jobExecutionLogs.endedAt),
        timeCursorStabilityBound(jobExecutionLogs.endedAt),
        cursorClause
      ),
      orderBy,
      chunkSize: input.chunkSize,
      read: (tx, ids) =>
        tx
          .select()
          .from(jobExecutionLogs)
          .where(inArray(jobExecutionLogs.id, ids))
          .orderBy(...orderBy),
    })

    if (rows.length === 0) return
    const displayExecutionData = await mapWithConcurrency(rows, 2, (row) =>
      materializeExecutionDataForDisplay(row.executionData as Record<string, unknown> | null, {
        workspaceId: row.workspaceId,
        workflowId: null,
        executionId: row.executionId,
        maxBytes: DATA_DRAIN_LIMITS.maxRowBytes,
      })
    )
    for (let index = 0; index < rows.length; index += 1) {
      rows[index].executionData = displayExecutionData[index] as JobLogRow['executionData']
    }
    yield rows
    const last = rows[rows.length - 1]
    cursor = { ts: last.endedAt!.toISOString(), id: last.id }
    if (rows.length < Math.min(input.chunkSize, DATA_DRAIN_LIMITS.pageRows)) return
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
