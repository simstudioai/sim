import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { and, inArray, isNotNull } from 'drizzle-orm'
import {
  decodeTimeCursor,
  encodeTimeCursor,
  timeCursorOrderBy,
  timeCursorPredicate,
} from '@/lib/data-drains/sources/cursor'
import { getOrganizationWorkspaceIds } from '@/lib/data-drains/sources/helpers'
import type { Cursor, DrainSource, SourcePageInput } from '@/lib/data-drains/types'

type WorkflowLogRow = typeof workflowExecutionLogs.$inferSelect

/**
 * Cursors on `endedAt` (terminal timestamp) rather than `startedAt`. A running
 * row's mutable fields (`endedAt`, `status`, `totalDurationMs`, `executionData`)
 * would otherwise be exported mid-flight and never re-emitted with their final
 * values. Filtering on `endedAt IS NOT NULL` guarantees rows are immutable
 * once visible to the drain.
 */
async function* pages(input: SourcePageInput): AsyncIterable<WorkflowLogRow[]> {
  const workspaceIds = await getOrganizationWorkspaceIds(input.organizationId)
  if (workspaceIds.length === 0) return

  let cursor = decodeTimeCursor(input.cursor)
  while (!input.signal.aborted) {
    const cursorClause = timeCursorPredicate(
      workflowExecutionLogs.endedAt,
      workflowExecutionLogs.id,
      cursor
    )

    const rows = await db
      .select()
      .from(workflowExecutionLogs)
      .where(
        and(
          inArray(workflowExecutionLogs.workspaceId, workspaceIds),
          isNotNull(workflowExecutionLogs.endedAt),
          cursorClause
        )
      )
      .orderBy(...timeCursorOrderBy(workflowExecutionLogs.endedAt, workflowExecutionLogs.id))
      .limit(input.chunkSize)

    if (rows.length === 0) return
    yield rows
    const last = rows[rows.length - 1]
    cursor = { ts: last.endedAt!.toISOString(), id: last.id }
    if (rows.length < input.chunkSize) return
  }
}

export const workflowLogsSource: DrainSource<WorkflowLogRow> = {
  type: 'workflow_logs',
  displayName: 'Workflow execution logs',
  pages,
  serialize(row) {
    return {
      id: row.id,
      executionId: row.executionId,
      workflowId: row.workflowId,
      workspaceId: row.workspaceId,
      stateSnapshotId: row.stateSnapshotId,
      deploymentVersionId: row.deploymentVersionId,
      level: row.level,
      status: row.status,
      trigger: row.trigger,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      totalDurationMs: row.totalDurationMs,
      executionData: row.executionData,
      cost: row.cost,
      files: row.files,
      createdAt: row.createdAt.toISOString(),
    }
  },
  cursorAfter(row): Cursor {
    return encodeTimeCursor({ ts: row.endedAt!.toISOString(), id: row.id })
  },
}
