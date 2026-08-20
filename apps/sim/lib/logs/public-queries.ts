import { db } from '@sim/db'
import {
  jobExecutionLogs,
  pausedExecutions,
  user,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
} from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import {
  type CursorKey,
  type KeysetKey,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  numberKey,
  resumeKeyset,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
import { workflowExecutionOriginSql } from '@/lib/logs/execution-origin'
import { folderScopeCondition, type LogFolderScope } from '@/lib/logs/folder-scope'
import {
  buildJobLogFilters,
  buildLogFilters,
  getJobOrderBy,
  getOrderBy,
  jobLogsSelectable,
  type LogFilters,
} from '@/lib/logs/public-filters'

export interface PublicLogCursor {
  startedAt: string
  id: string
  order: 'asc' | 'desc'
}

export function encodePublicLogCursor(cursor: PublicLogCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64')
}

/**
 * Reads the keyset this list resumes from, or `null` for a token that names no
 * position.
 *
 * `id` is checked for content rather than only for type: it is one half of the
 * `(startedAt, id)` tuple the query compares against, so an empty one is a
 * position no row can sit after, and accepting it would answer a truncated page
 * as though it were a complete one. It is the same looseness the wrapping
 * envelope had — see `readScopedCursor` — one layer down.
 */
export function decodePublicLogCursor(
  cursor: string,
  expectedOrder: 'asc' | 'desc'
): PublicLogCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString()) as Record<string, unknown>
    const order = parsed.order === undefined ? expectedOrder : parsed.order
    if (
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0 ||
      (order !== 'asc' && order !== 'desc') ||
      order !== expectedOrder
    ) {
      return null
    }
    const startedAt = new Date(parsed.startedAt)
    if (Number.isNaN(startedAt.getTime())) return null
    return { startedAt: parsed.startedAt, id: parsed.id, order }
  } catch {
    return null
  }
}

export interface ListPublicWorkflowLogsInput {
  filters: LogFilters
  limit: number
  includeExecutionData: boolean
  folderScope?: LogFolderScope
  /**
   * Whether Chat and Sim-agent job runs join the sequence.
   *
   * The union is keyset-safe because both tables order by `(startedAt, id)` and
   * both ids are globally unique text primary keys, so the tuple the cursor
   * compares stays unique across the merged sequence.
   */
  includeJobRuns?: boolean
}

/**
 * Reads one page of workflow-execution log rows for the public adapters. Folder
 * path resolution remains an adapter concern; this query takes the resulting ids
 * and applies one coherent root/non-root predicate.
 */
function readWorkflowLogRows(input: ListPublicWorkflowLogsInput) {
  const filters = input.folderScope ? { ...input.filters, folderIds: undefined } : input.filters
  const folderCondition = input.folderScope ? folderScopeCondition(input.folderScope) : undefined

  return db
    .select({
      id: workflowExecutionLogs.id,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      executionId: workflowExecutionLogs.executionId,
      deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
      status: workflowExecutionLogs.status,
      level: workflowExecutionLogs.level,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      costTotal: workflowExecutionLogs.costTotal,
      files: workflowExecutionLogs.files,
      executionData: input.includeExecutionData ? workflowExecutionLogs.executionData : sql`null`,
      workflowName: workflow.name,
      workflowDescription: workflow.description,
      workflowFolderId: workflow.folderId,
      workflowUserId: workflow.userId,
      workflowWorkspaceId: workflow.workspaceId,
      workflowCreatedAt: workflow.createdAt,
      workflowUpdatedAt: workflow.updatedAt,
      workflowArchivedAt: workflow.archivedAt,
    })
    .from(workflowExecutionLogs)
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .where(and(buildLogFilters(filters), folderCondition))
    .orderBy(...getOrderBy(input.filters.order))
    .limit(input.limit + 1)
}

/**
 * Reads one page of Chat / Sim-agent job-run rows.
 *
 * The projection is deliberately narrower than the workflow one: a job run has
 * no workflow, no deployment version, and no attachment list, so those fields
 * are absent from the row rather than reported as null-valued versions of a
 * thing that does not exist.
 */
function readJobLogRows(input: ListPublicWorkflowLogsInput) {
  return db
    .select({
      id: jobExecutionLogs.id,
      workspaceId: jobExecutionLogs.workspaceId,
      executionId: jobExecutionLogs.executionId,
      level: jobExecutionLogs.level,
      trigger: jobExecutionLogs.trigger,
      startedAt: jobExecutionLogs.startedAt,
      endedAt: jobExecutionLogs.endedAt,
      totalDurationMs: jobExecutionLogs.totalDurationMs,
      cost: jobExecutionLogs.cost,
    })
    .from(jobExecutionLogs)
    .where(buildJobLogFilters(input.filters))
    .orderBy(...getJobOrderBy(input.filters.order))
    .limit(input.limit + 1)
}

export type PublicWorkflowLogListRow = Awaited<ReturnType<typeof readWorkflowLogRows>>[number]
export type PublicJobLogListRow = Awaited<ReturnType<typeof readJobLogRows>>[number]

/**
 * One row of the public log sequence, tagged by which table it came from.
 *
 * The tag is not cosmetic: a job run and a workflow run whose workflow has been
 * deleted both report `workflowId: null` on the wire, so without a discriminator
 * a caller cannot tell "this run never had a workflow" from "its workflow is
 * gone" — two different answers.
 */
export type PublicLogListRow =
  | ({ kind: 'workflow' } & PublicWorkflowLogListRow)
  | ({ kind: 'job' } & PublicJobLogListRow)

/**
 * Merges the two branches into the single `(startedAt, id)` ordering both were
 * read under, so the page boundary and its cursor mean the same thing whether or
 * not job runs were included.
 */
function mergeByKeyset(rows: PublicLogListRow[], order: 'asc' | 'desc'): PublicLogListRow[] {
  const direction = order === 'asc' ? 1 : -1
  return rows.sort((a, b) => {
    const byTime = a.startedAt.getTime() - b.startedAt.getTime()
    if (byTime !== 0) return direction * byTime
    return direction * (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  })
}

/**
 * Reads the log page shared by the v1 and v2 public adapters, optionally unioned
 * with the workspace's Chat and Sim-agent job runs.
 *
 * Each branch over-fetches one row so the merged set can answer "is there
 * another page" without a count, exactly as the single-table read did.
 *
 * The overloads keep the narrower row type for callers that never opt in — a
 * caller that cannot receive a job run should not have to narrow a union it can
 * never observe.
 */
export async function listPublicWorkflowLogs(
  input: ListPublicWorkflowLogsInput & { includeJobRuns?: false }
): Promise<{
  data: Array<{ kind: 'workflow' } & PublicWorkflowLogListRow>
  nextCursor: string | null
}>
export async function listPublicWorkflowLogs(
  input: ListPublicWorkflowLogsInput
): Promise<{ data: PublicLogListRow[]; nextCursor: string | null }>
export async function listPublicWorkflowLogs(
  input: ListPublicWorkflowLogsInput
): Promise<{ data: PublicLogListRow[]; nextCursor: string | null }> {
  // `folderScope` is checked separately from `jobLogsSelectable`, which reads
  // `filters.folderIds`. The public surface never sets that field — its input
  // type omits it and carries the folder filter in `folderScope` instead — so
  // gating on the filters alone let a folder-scoped page union in every job run
  // in the workspace, which is the "one filter means two different things
  // across the union" answer the guard exists to refuse.
  const includeJobRuns =
    Boolean(input.includeJobRuns) && !input.folderScope && jobLogsSelectable(input.filters)

  const [workflowRows, jobRows] = await Promise.all([
    readWorkflowLogRows(input),
    includeJobRuns ? readJobLogRows(input) : Promise.resolve([] as PublicJobLogListRow[]),
  ])

  const order = input.filters.order ?? 'desc'
  const merged = mergeByKeyset(
    [
      ...workflowRows.map((row): PublicLogListRow => ({ kind: 'workflow', ...row })),
      ...jobRows.map((row): PublicLogListRow => ({ kind: 'job', ...row })),
    ],
    order
  )

  const hasMore = merged.length > input.limit
  const data = merged.slice(0, input.limit)
  const last = data.at(-1)
  const nextCursor =
    hasMore && last
      ? encodePublicLogCursor({
          startedAt: last.startedAt.toISOString(),
          id: last.id,
          order,
        })
      : null

  return { data, nextCursor }
}

/** The columns `POST /api/v2/logs/query` can order by. */
export const PUBLIC_LOG_SORT_FIELDS = ['startedAt', 'durationMs', 'cost', 'status'] as const

export type PublicLogSortField = (typeof PUBLIC_LOG_SORT_FIELDS)[number]

/**
 * Sentinel the two nullable sort columns are read through.
 *
 * `total_duration_ms` and `cost_total` are null for a run that has not settled,
 * and a keyset cannot compare against null — `value < NULL` is unknown, so a null
 * row is neither before nor after the cursor and pages either duplicate or drop
 * it. Coalescing makes the ordering total, at the cost of one documented
 * decision: an unsettled run sorts as though its duration and cost were below
 * every real value. Both columns are non-negative, so the sentinel cannot
 * collide with a genuine measurement.
 */
const UNSETTLED_SORT_VALUE = -1

/**
 * The keyset for one sort field, always ending in `id`.
 *
 * The trailing unique key is what separates rows that tie on the leading column
 * — every one of these columns can tie, `status` on most of a page — so without
 * it the page boundary repeats or drops the tied rows.
 */
function publicLogKeyset(sortBy: PublicLogSortField): KeysetKey<PublicWorkflowLogListRow>[] {
  const idKey = textKey<PublicWorkflowLogListRow>(workflowExecutionLogs.id, (row) => row.id)
  switch (sortBy) {
    case 'durationMs':
      return [
        numberKey<PublicWorkflowLogListRow>(
          sql`COALESCE(${workflowExecutionLogs.totalDurationMs}, ${UNSETTLED_SORT_VALUE})`,
          (row) => row.totalDurationMs ?? UNSETTLED_SORT_VALUE
        ),
        idKey,
      ]
    case 'cost':
      return [
        numberKey<PublicWorkflowLogListRow>(
          sql`COALESCE(${workflowExecutionLogs.costTotal}, ${UNSETTLED_SORT_VALUE})`,
          (row) => (row.costTotal == null ? UNSETTLED_SORT_VALUE : Number(row.costTotal))
        ),
        idKey,
      ]
    case 'status':
      return [
        textKey<PublicWorkflowLogListRow>(workflowExecutionLogs.status, (row) => row.status),
        idKey,
      ]
    default:
      return [
        timestampKey<PublicWorkflowLogListRow>(
          workflowExecutionLogs.startedAt,
          (row) => row.startedAt
        ),
        idKey,
      ]
  }
}

export interface QueryPublicWorkflowLogsInput {
  filters: LogFilters
  folderScope?: LogFolderScope
  sortBy: PublicLogSortField
  sortOrder: ListSortOrder
  cursorKeys: CursorKey[] | undefined
  limit: number
}

/**
 * The rich-read half of the public log surface: the same filter set as the list,
 * ordered by any of {@link PUBLIC_LOG_SORT_FIELDS} rather than by start time
 * alone.
 *
 * Job runs are deliberately absent. `job_execution_logs` stores cost as a jsonb
 * document and has no comparable persisted status, so ordering the two tables
 * together on those columns would compare values that do not mean the same
 * thing. `GET /api/v2/logs?includeJobRuns=true` is the surface for the union,
 * where the ordering is start time, which both tables record identically.
 */
export async function queryPublicWorkflowLogs(input: QueryPublicWorkflowLogsInput) {
  const keys = publicLogKeyset(input.sortBy)
  const rows = await db
    .select({
      id: workflowExecutionLogs.id,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      executionId: workflowExecutionLogs.executionId,
      deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
      status: workflowExecutionLogs.status,
      level: workflowExecutionLogs.level,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      costTotal: workflowExecutionLogs.costTotal,
      files: workflowExecutionLogs.files,
      executionData: sql`null`,
      workflowName: workflow.name,
      workflowDescription: workflow.description,
      workflowFolderId: workflow.folderId,
      workflowUserId: workflow.userId,
      workflowWorkspaceId: workflow.workspaceId,
      workflowCreatedAt: workflow.createdAt,
      workflowUpdatedAt: workflow.updatedAt,
      workflowArchivedAt: workflow.archivedAt,
    })
    .from(workflowExecutionLogs)
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .where(
      and(
        buildLogFilters(input.filters),
        input.folderScope ? folderScopeCondition(input.folderScope) : undefined,
        resumeKeyset(keys, input.cursorKeys, input.sortOrder)
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), input.sortOrder))
    .limit(input.limit + 1)

  return keysetPage(keys, rows, input.limit)
}

export type PublicWorkflowLogLookup =
  | { column: 'id'; value: string }
  | { column: 'executionId'; value: string }

/**
 * Resolves only the canonical resource scope needed to authorize a public run
 * lookup. Protected log content is loaded separately after authorization.
 */
export async function getPublicWorkflowLogScope(executionId: string) {
  const [scope] = await db
    .select({
      executionId: workflowExecutionLogs.executionId,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
    .limit(1)

  return scope ?? null
}

/**
 * Loads one workflow log and its optional workflow snapshot. The snapshot join
 * is deliberately left-sided: a missing snapshot does not make an otherwise
 * valid execution disappear from the log resource.
 */
export async function getPublicWorkflowLog(lookup: PublicWorkflowLogLookup, workspaceId?: string) {
  const lookupCondition =
    lookup.column === 'id'
      ? eq(workflowExecutionLogs.id, lookup.value)
      : eq(workflowExecutionLogs.executionId, lookup.value)

  const rows = await db
    .select({
      id: workflowExecutionLogs.id,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      executionId: workflowExecutionLogs.executionId,
      stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
      deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
      status: workflowExecutionLogs.status,
      level: workflowExecutionLogs.level,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      executionData: workflowExecutionLogs.executionData,
      costTotal: workflowExecutionLogs.costTotal,
      files: workflowExecutionLogs.files,
      createdAt: workflowExecutionLogs.createdAt,
      workflowState: workflowExecutionSnapshots.stateData,
      workflowName: workflow.name,
      workflowDescription: workflow.description,
      workflowFolderId: workflow.folderId,
      workflowUserId: workflow.userId,
      workflowOwnerEmail: user.email,
      workflowWorkspaceId: workflow.workspaceId,
      workflowCreatedAt: workflow.createdAt,
      workflowUpdatedAt: workflow.updatedAt,
      workflowArchivedAt: workflow.archivedAt,
      deploymentVersion: workflowDeploymentVersion.version,
      deploymentVersionName: workflowDeploymentVersion.name,
      pausedStatus: pausedExecutions.status,
      pausedTotalPauseCount: pausedExecutions.totalPauseCount,
      pausedResumedCount: pausedExecutions.resumedCount,
      executionOrigin: workflowExecutionOriginSql().as('execution_origin'),
    })
    .from(workflowExecutionLogs)
    .leftJoin(
      workflowExecutionSnapshots,
      eq(workflowExecutionLogs.stateSnapshotId, workflowExecutionSnapshots.id)
    )
    .leftJoin(
      workflowDeploymentVersion,
      eq(workflowDeploymentVersion.id, workflowExecutionLogs.deploymentVersionId)
    )
    .leftJoin(pausedExecutions, eq(pausedExecutions.executionId, workflowExecutionLogs.executionId))
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .leftJoin(user, eq(workflow.userId, user.id))
    .where(
      and(
        lookupCondition,
        workspaceId ? eq(workflowExecutionLogs.workspaceId, workspaceId) : undefined
      )
    )
    .limit(1)

  return rows[0] ?? null
}
