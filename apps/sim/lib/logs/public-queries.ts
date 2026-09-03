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
import { and, type Column, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  type CursorKey,
  decimalKey,
  type KeysetKey,
  type KeysetPage,
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
import { handledErrorSpanCondition } from '@/lib/logs/handled-errors'
import {
  buildJobLogFilters,
  buildLogFilters,
  jobLogsSelectable,
  type LogFilters,
} from '@/lib/logs/public-filters'

/** Distinguishes the workflow-owner join from the execution-actor join on `user`. */
const workflowOwner = alias(user, 'workflow_owner')

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
 * The workflow-log projection, as one query builder so its row type can be
 * derived without the reader that pages it referring to itself.
 */
function workflowLogQuery(includeExecutionData: boolean) {
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
      /** Published on every row: a handled block error is invisible in `level`. */
      hasHandledErrors: handledErrorSpanCondition(),
      executionData: includeExecutionData ? workflowExecutionLogs.executionData : sql`null`,
      workflowName: workflow.name,
      workflowDescription: workflow.description,
      workflowFolderId: workflow.folderId,
      workflowWorkspaceId: workflow.workspaceId,
      workflowCreatedAt: workflow.createdAt,
      workflowUpdatedAt: workflow.updatedAt,
      workflowArchivedAt: workflow.archivedAt,
    })
    .from(workflowExecutionLogs)
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
}

/**
 * The job-run projection.
 *
 * Deliberately narrower than the workflow one: a job run has no workflow, no
 * deployment version, and no attachment list, so those fields are absent from
 * the row rather than reported as null-valued versions of a thing that does not
 * exist.
 */
function jobLogQuery() {
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
}

export type PublicWorkflowLogListRow = Awaited<ReturnType<typeof workflowLogQuery>>[number]
export type PublicJobLogListRow = Awaited<ReturnType<typeof jobLogQuery>>[number]

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
 *
 * The comparison is at millisecond precision because that is the precision the
 * keyset orders and compares at — see {@link timestampKey}. Anything finer would
 * put the merged order out of step with the boundary the cursor names.
 */
function mergeByKeyset(rows: PublicLogListRow[], order: ListSortOrder): PublicLogListRow[] {
  const direction = order === 'asc' ? 1 : -1
  return rows.sort((a, b) => {
    const byTime = a.startedAt.getTime() - b.startedAt.getTime()
    if (byTime !== 0) return direction * byTime
    return direction * (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  })
}

/** The columns `GET /api/v2/logs` can order by. */
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
 * {@link UNSETTLED_SORT_VALUE} as the `numeric` cursor key spells it.
 *
 * `cost_total` is an unconstrained `numeric`, so its keyset travels as the digit
 * string Postgres returned rather than as a JS number — see {@link decimalKey}.
 * The sentinel has to be written the same way or an unsettled anchor could not
 * be bound back.
 */
const UNSETTLED_COST_VALUE = String(UNSETTLED_SORT_VALUE)

/**
 * The columns the sortable keyset compares on — every row shape it pages carries
 * these, whether or not it also selects the run's execution data.
 */
type PublicLogKeysetRow = Pick<
  PublicWorkflowLogListRow,
  'id' | 'status' | 'startedAt' | 'totalDurationMs' | 'costTotal'
>

/**
 * The `(startedAt, id)` keyset, over whichever table's columns are given.
 *
 * Both log tables are ordered by it, and both spell it identically, so the
 * merged sequence a unioned page returns resumes from one set of cursor keys.
 */
function startedAtKeyset<Row extends { id: string; startedAt: Date }>(
  startedAtColumn: Column,
  idColumn: Column
): KeysetKey<Row>[] {
  return [
    timestampKey<Row>(startedAtColumn, (row) => row.startedAt),
    textKey<Row>(idColumn, (row) => row.id),
  ]
}

/**
 * The keyset for one sort field, always ending in `id`.
 *
 * The trailing unique key is what separates rows that tie on the leading column
 * — every one of these columns can tie, `status` on most of a page — so without
 * it the page boundary repeats or drops the tied rows.
 */
function publicLogKeyset<Row extends PublicLogKeysetRow>(
  sortBy: PublicLogSortField
): KeysetKey<Row>[] {
  const idKey = textKey<Row>(workflowExecutionLogs.id, (row) => row.id)
  switch (sortBy) {
    case 'durationMs':
      return [
        numberKey<Row>(
          sql`COALESCE(${workflowExecutionLogs.totalDurationMs}, ${UNSETTLED_SORT_VALUE})`,
          (row) => row.totalDurationMs ?? UNSETTLED_SORT_VALUE
        ),
        idKey,
      ]
    case 'cost':
      return [
        decimalKey<Row>(
          sql`COALESCE(${workflowExecutionLogs.costTotal}, ${UNSETTLED_SORT_VALUE})`,
          (row) => row.costTotal ?? UNSETTLED_COST_VALUE
        ),
        idKey,
      ]
    case 'status':
      return [textKey<Row>(workflowExecutionLogs.status, (row) => row.status), idKey]
    default:
      return startedAtKeyset<Row>(workflowExecutionLogs.startedAt, workflowExecutionLogs.id)
  }
}

export interface ReadPublicLogPageInput {
  filters: LogFilters
  limit: number
  includeExecutionData: boolean
  folderScope?: LogFolderScope
  includeJobRuns?: boolean
  sortBy: PublicLogSortField
  sortOrder: ListSortOrder
  cursorKeys: CursorKey[] | undefined
}

function readWorkflowLogRows(
  input: ReadPublicLogPageInput,
  keys: readonly KeysetKey<PublicWorkflowLogListRow>[]
) {
  const filters = input.folderScope ? { ...input.filters, folderIds: undefined } : input.filters
  const folderCondition = input.folderScope ? folderScopeCondition(input.folderScope) : undefined

  return workflowLogQuery(input.includeExecutionData)
    .where(
      and(
        buildLogFilters(filters),
        folderCondition,
        resumeKeyset(keys, input.cursorKeys, input.sortOrder)
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), input.sortOrder))
    .limit(input.limit + 1)
}

function readJobLogRows(
  input: ReadPublicLogPageInput,
  keys: readonly KeysetKey<PublicJobLogListRow>[]
) {
  return jobLogQuery()
    .where(
      and(buildJobLogFilters(input.filters), resumeKeyset(keys, input.cursorKeys, input.sortOrder))
    )
    .orderBy(...listOrderBy(keysetColumns(keys), input.sortOrder))
    .limit(input.limit + 1)
}

/**
 * Reads one page of the public log sequence, ordered by any of
 * {@link PUBLIC_LOG_SORT_FIELDS} and resumed from a shared keyset cursor.
 *
 * Job runs join the sequence only under `startedAt`. `job_execution_logs` stores
 * cost as a jsonb document and records no comparable persisted status, so
 * ordering the two tables together on those columns would compare values that do
 * not mean the same thing; the contract refuses the combination at the boundary,
 * and this guard is the second half of that rule rather than a silent narrowing.
 *
 * Each branch over-fetches one row so the merged set can answer "is there
 * another page" without a count.
 */
export async function readPublicLogPage(
  input: ReadPublicLogPageInput
): Promise<KeysetPage<PublicLogListRow>> {
  const keys = publicLogKeyset<PublicWorkflowLogListRow>(input.sortBy)

  // `folderScope` is checked separately from `jobLogsSelectable`, which reads
  // `filters.folderIds`. The public surface never sets that field — its input
  // type omits it and carries the folder filter in `folderScope` instead — so
  // gating on the filters alone let a folder-scoped page union in every job run
  // in the workspace, which is the "one filter means two different things
  // across the union" answer the guard exists to refuse.
  const includeJobRuns =
    input.sortBy === 'startedAt' &&
    Boolean(input.includeJobRuns) &&
    !input.folderScope &&
    jobLogsSelectable(input.filters)

  const [workflowRows, jobRows] = await Promise.all([
    readWorkflowLogRows(input, keys),
    includeJobRuns
      ? readJobLogRows(
          input,
          startedAtKeyset<PublicJobLogListRow>(jobExecutionLogs.startedAt, jobExecutionLogs.id)
        )
      : Promise.resolve([] as PublicJobLogListRow[]),
  ])

  if (!includeJobRuns) {
    const page = keysetPage(keys, workflowRows, input.limit)
    return {
      data: page.data.map((row): PublicLogListRow => ({ kind: 'workflow', ...row })),
      nextCursorKeys: page.nextCursorKeys,
    }
  }

  const merged = mergeByKeyset(
    [
      ...workflowRows.map((row): PublicLogListRow => ({ kind: 'workflow', ...row })),
      ...jobRows.map((row): PublicLogListRow => ({ kind: 'job', ...row })),
    ],
    input.sortOrder
  )
  return keysetPage(
    startedAtKeyset<PublicLogListRow>(workflowExecutionLogs.startedAt, workflowExecutionLogs.id),
    merged,
    input.limit
  )
}

/**
 * The v1 adapter's log page: {@link readPublicLogPage} ordered by start time,
 * with the keyset carried by v1's own opaque `(startedAt, id)` token.
 *
 * v2 reads {@link readPublicLogPage} directly and carries the keyset in the
 * shared v2 cursor codec. This wrapper exists so v1's published token keeps its
 * shape while both surfaces page over one query.
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
  const order = input.filters.order ?? 'desc'
  const { data, nextCursorKeys } = await readPublicLogPage({
    filters: { ...input.filters, cursor: undefined },
    limit: input.limit,
    includeExecutionData: input.includeExecutionData,
    folderScope: input.folderScope,
    includeJobRuns: input.includeJobRuns,
    sortBy: 'startedAt',
    sortOrder: order,
    cursorKeys: input.filters.cursor
      ? [input.filters.cursor.startedAt, input.filters.cursor.id]
      : undefined,
  })

  const [startedAt, id] = nextCursorKeys ?? []
  const nextCursor =
    typeof startedAt === 'string' && typeof id === 'string'
      ? encodePublicLogCursor({ startedAt, id, order })
      : null

  return { data, nextCursor }
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
      executedByEmail: user.email,
      workflowOwnerEmail: workflowOwner.email,
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
    /**
     * The identity the run ACTED as, read from the attribution the run itself
     * captured — not the workflow owner, who contributes nothing to a run beyond
     * a personal-variable fallback and whose row can be reassigned long after the
     * fact. Joining the immutable per-run actor keeps a historical log honest
     * about who it ran as.
     *
     * Null on a run that failed before an actor was resolved (a webhook rejected
     * during setup), which is the truthful answer for those: there was no actor.
     */
    .leftJoin(
      user,
      eq(sql`${workflowExecutionLogs.executionData}->'billingAttribution'->>'actorUserId'`, user.id)
    )
    /**
     * Kept only to serve the deprecated `workflow.ownerEmail`, which was a
     * required field of the published v2 log schema before `executedByEmail`
     * replaced it. Removing it outright would break typed clients, so it stays
     * until that field does. Aliased because the actor join above already holds
     * `user` — the two identities coincide on an interactive run and diverge on
     * every background one, which is the whole reason the field was replaced.
     */
    .leftJoin(workflowOwner, eq(workflow.userId, workflowOwner.id))
    .where(
      and(
        lookupCondition,
        workspaceId ? eq(workflowExecutionLogs.workspaceId, workspaceId) : undefined
      )
    )
    .limit(1)

  return rows[0] ?? null
}
