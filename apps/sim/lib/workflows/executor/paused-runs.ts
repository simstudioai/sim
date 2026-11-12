import { db } from '@sim/db'
import { pausedExecutions, workflow } from '@sim/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  type CursorKey,
  encodeKeyset,
  type KeysetKey,
  type KeysetPage,
  keysetOrderBy,
  keysetPage,
  type ListSortOrder,
  preciseTimestampKey,
  preciseTimestampText,
  resumeKeyset,
  textKey,
} from '@/lib/api/list-query'
import { PAUSE_POINT_ROWS } from '@/lib/workflows/executor/pause-point-sql'

/** A paused run of an active workflow, with the raw `pause_points` its detail is built from. */
interface WorkspacePausedRunRow {
  id: string
  workflowId: string
  workflowName: string
  executionId: string
  pausedAt: Date
  pausedAtCursor: string
  pausePoints: unknown
}

const PAUSED_RUN_KEYS: readonly KeysetKey<WorkspacePausedRunRow>[] = [
  preciseTimestampKey(pausedExecutions.pausedAt, (row) => row.pausedAtCursor),
  textKey(pausedExecutions.id, (row) => row.id),
]

/** Whether `point.value` is a pause point still waiting on a human, with `mapPausePoints`' defaults. */
const POINT_WAITS_ON_HUMAN = sql`coalesce(point.value ->> 'pauseKind', 'human') <> 'time'
    and coalesce(point.value ->> 'resumeStatus', 'paused') = 'paused'`

/** A paused run with a pause point still waiting on a human. */
const WAITS_ON_HUMAN = sql`exists (select 1 from ${PAUSE_POINT_ROWS} where ${POINT_WAITS_ON_HUMAN})`

/** The cursor that resumes the list after `row`. */
export function pausedRunCursorKeys(row: WorkspacePausedRunRow): CursorKey[] {
  return encodeKeyset(PAUSED_RUN_KEYS, row)
}

/**
 * One page of a workspace's paused runs that wait on at least one human pause
 * point, ordered by when they paused. Runs of archived workflows are excluded.
 * Authorization is the caller's.
 */
export async function listWorkspacePausedRuns(input: {
  workspaceId: string
  sortOrder: ListSortOrder
  cursorKeys?: CursorKey[]
  limit: number
}): Promise<KeysetPage<WorkspacePausedRunRow>> {
  const rows = await db
    .select({
      id: pausedExecutions.id,
      workflowId: pausedExecutions.workflowId,
      workflowName: workflow.name,
      executionId: pausedExecutions.executionId,
      pausedAt: pausedExecutions.pausedAt,
      pausedAtCursor: preciseTimestampText(pausedExecutions.pausedAt),
      pausePoints: pausedExecutions.pausePoints,
    })
    .from(pausedExecutions)
    .innerJoin(workflow, eq(workflow.id, pausedExecutions.workflowId))
    .where(
      and(
        eq(workflow.workspaceId, input.workspaceId),
        isNull(workflow.archivedAt),
        inArray(pausedExecutions.status, ['paused', 'partially_resumed']),
        WAITS_ON_HUMAN,
        resumeKeyset(PAUSED_RUN_KEYS, input.cursorKeys, input.sortOrder)
      )
    )
    .orderBy(...keysetOrderBy(PAUSED_RUN_KEYS, input.sortOrder))
    .limit(input.limit + 1)
  return keysetPage(PAUSED_RUN_KEYS, rows, input.limit)
}
