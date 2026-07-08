import { backgroundWorkStatus, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, inArray, isNull, lt, lte, or, type SQL, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('ForkBackgroundWork')

export type BackgroundWorkKind =
  | 'deployment_side_effects'
  | 'fork_content_copy'
  | 'fork_sync'
  | 'fork_rollback'
export type BackgroundWorkStatusValue =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'

/** Statuses surfaced as recent jobs - active, completed, or a recent issue. */
const SURFACED_STATUSES: BackgroundWorkStatusValue[] = [
  'pending',
  'processing',
  'completed',
  'completed_with_warnings',
  'failed',
]

/** Default page size for the workspace's Activity tab (mirrors the audit log's). */
const BACKGROUND_WORK_PAGE_SIZE = 50

/** Server-side cap on the requested page size (mirrors the audit log's). */
const BACKGROUND_WORK_PAGE_SIZE_MAX = 100

/**
 * An active (pending/processing) row older than this is treated as abandoned: the
 * worker crashed or restarted before {@link finishBackgroundWork}, and a hard crash
 * (Trigger CRASHED / process death) fires no in-task hook. The outbox-processor cron
 * sweeps these via {@link reapStaleBackgroundWork}, marking them `failed` so the UI
 * surfaces the failure instead of spinning forever.
 */
const STALE_ACTIVE_MS = 30 * 60 * 1000

/** Terminal rows older than this are pruned by the cron so the audit trail stays bounded. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export interface BackgroundWorkRow {
  id: string
  workspaceId: string
  workflowId: string | null
  kind: BackgroundWorkKind
  status: BackgroundWorkStatusValue
  message: string | null
  error: string | null
  metadata: unknown
  startedAt: Date
  completedAt: Date | null
  updatedAt: Date
}

/**
 * Begin tracking a unit of background work, returning its id. Any prior row for the
 * same scope (workspace + workflow + kind) is removed first so exactly one status per
 * scope is live - a fresh run supersedes a stale completed/failed one.
 */
export async function startBackgroundWork(
  executor: DbOrTx,
  params: {
    workspaceId: string
    workflowId?: string | null
    kind: BackgroundWorkKind
    message?: string
    metadata?: unknown
    /**
     * Replace any prior row for the same scope (workspace + workflow + kind) so exactly
     * one status per scope is live (default). Pass `false` to keep an append-only audit
     * trail - e.g. fork jobs, where each fork is a distinct historical entry.
     */
    supersede?: boolean
  }
): Promise<string> {
  const { workspaceId, workflowId = null, kind, message, metadata, supersede = true } = params
  if (supersede) {
    await executor
      .delete(backgroundWorkStatus)
      .where(
        and(
          eq(backgroundWorkStatus.workspaceId, workspaceId),
          eq(backgroundWorkStatus.kind, kind),
          workflowId == null
            ? isNull(backgroundWorkStatus.workflowId)
            : eq(backgroundWorkStatus.workflowId, workflowId)
        )
      )
  }
  const id = generateId()
  const now = new Date()
  await executor.insert(backgroundWorkStatus).values({
    id,
    workspaceId,
    workflowId,
    kind,
    status: 'processing',
    message: message ?? null,
    metadata: metadata ?? null,
    startedAt: now,
    updatedAt: now,
  })
  return id
}

/**
 * Record a synchronous operation directly as a terminal audit entry (no `processing`
 * phase). Append-only - used by sync/rollback, which complete in-request, so they show
 * up in the same workspace audit log as fork jobs.
 */
export async function recordBackgroundWork(
  executor: DbOrTx,
  params: {
    workspaceId: string
    kind: BackgroundWorkKind
    status: Extract<BackgroundWorkStatusValue, 'completed' | 'completed_with_warnings' | 'failed'>
    message?: string
    error?: string
    metadata?: unknown
  }
): Promise<void> {
  const now = new Date()
  await executor.insert(backgroundWorkStatus).values({
    id: generateId(),
    workspaceId: params.workspaceId,
    workflowId: null,
    kind: params.kind,
    status: params.status,
    message: params.message ?? null,
    error: params.error ?? null,
    metadata: params.metadata ?? null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
  })
}

/** Mark a tracked unit of work terminal (completed / completed_with_warnings / failed). */
export async function finishBackgroundWork(
  executor: DbOrTx,
  id: string,
  params: {
    status: Extract<BackgroundWorkStatusValue, 'completed' | 'completed_with_warnings' | 'failed'>
    message?: string
    error?: string
    metadata?: unknown
  }
): Promise<void> {
  const now = new Date()
  // Merge metadata so terminal counts (copied/failed) augment what start recorded
  // (child name, per-kind plan) instead of replacing it.
  let metadata: unknown
  if (params.metadata !== undefined) {
    const [existing] = await executor
      .select({ metadata: backgroundWorkStatus.metadata })
      .from(backgroundWorkStatus)
      .where(eq(backgroundWorkStatus.id, id))
      .limit(1)
    metadata = { ...toMetadataRecord(existing?.metadata), ...toMetadataRecord(params.metadata) }
  }
  await executor
    .update(backgroundWorkStatus)
    .set({
      status: params.status,
      message: params.message ?? null,
      error: params.error ?? null,
      ...(params.metadata !== undefined ? { metadata } : {}),
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(backgroundWorkStatus.id, id))
}

/** Coerce an unknown jsonb metadata value to a plain record for safe merging. */
function toMetadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Keyset position of the last row of a page: `updatedAt` plus the `id` tiebreaker. */
interface BackgroundWorkCursorData {
  updatedAt: string
  id: string
}

/** Encodes the keyset position as an opaque base64 cursor (mirrors the audit log's). */
function encodeCursor(data: BackgroundWorkCursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64')
}

function decodeCursor(cursor: string): BackgroundWorkCursorData | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString())
  } catch {
    return null
  }
}

/**
 * Keyset condition for rows strictly after the cursor position in
 * `updatedAt DESC, id DESC` order: older `updatedAt`, or the same `updatedAt`
 * (which is not unique) with a smaller `id`. Null for an invalid cursor, which
 * degrades to the first page rather than erroring.
 */
function buildCursorCondition(cursor: string): SQL<unknown> | null {
  const cursorData = decodeCursor(cursor)
  if (!cursorData?.updatedAt || !cursorData.id) return null

  const cursorDate = new Date(cursorData.updatedAt)
  if (Number.isNaN(cursorDate.getTime())) return null

  return or(
    lt(backgroundWorkStatus.updatedAt, cursorDate),
    and(eq(backgroundWorkStatus.updatedAt, cursorDate), lt(backgroundWorkStatus.id, cursorData.id))
  )!
}

export interface BackgroundWorkPage {
  rows: BackgroundWorkRow[]
  /** Cursor for the next page; null when this page is the last. */
  nextCursor: string | null
}

/**
 * Recent background-work jobs involving a workspace - the durable audit record the
 * Activity view renders, most-recent first and keyset-paginated (`updatedAt DESC,
 * id DESC`, cursor + limit mirroring the audit log's `queryAuditLogs`). Fork jobs
 * are append-only (one row per fork), so this is the workspace's fork history;
 * older rows are pruned by the cron.
 *
 * Every fork event is recorded ONCE, keyed to the workspace it was initiated from
 * (fork-create → the parent; sync/rollback/sync-copy → the workspace whose page ran
 * it), so "involving" matches both sides of each edge without double-writing rows:
 *
 * - rows keyed to this workspace (its own forks, syncs it ran, its rollbacks);
 * - rows whose `metadata.childWorkspaceId` is this workspace (its own creation,
 *   recorded on the parent);
 * - rows whose `metadata.otherWorkspaceId` is this workspace (the other side of a
 *   sync/rollback/sync-copy edge);
 * - sync/rollback rows keyed to one of this workspace's forks - a fork's only sync
 *   edge is its parent, so these are guaranteed edge events (covers rows written
 *   before `metadata.otherWorkspaceId` existed).
 */
export async function listSurfacedBackgroundWork(
  executor: DbOrTx,
  workspaceId: string,
  options?: { cursor?: string; limit?: number }
): Promise<BackgroundWorkPage> {
  const limit = Math.min(
    Math.max(options?.limit ?? BACKGROUND_WORK_PAGE_SIZE, 1),
    BACKGROUND_WORK_PAGE_SIZE_MAX
  )

  const childRows = await executor
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.forkedFromWorkspaceId, workspaceId), isNull(workspace.archivedAt)))
  const childWorkspaceIds = childRows.map((row) => row.id)

  const involvesWorkspace = or(
    eq(backgroundWorkStatus.workspaceId, workspaceId),
    sql`${backgroundWorkStatus.metadata} ->> 'childWorkspaceId' = ${workspaceId}`,
    sql`${backgroundWorkStatus.metadata} ->> 'otherWorkspaceId' = ${workspaceId}`,
    ...(childWorkspaceIds.length > 0
      ? [
          and(
            inArray(backgroundWorkStatus.workspaceId, childWorkspaceIds),
            inArray(backgroundWorkStatus.kind, ['fork_sync', 'fork_rollback'])
          ),
        ]
      : [])
  )

  const conditions = [involvesWorkspace, inArray(backgroundWorkStatus.status, SURFACED_STATUSES)]
  if (options?.cursor) {
    const cursorCondition = buildCursorCondition(options.cursor)
    if (cursorCondition) conditions.push(cursorCondition)
  }

  // Over-fetch by one row to learn whether another page exists (audit-log pattern).
  const rows = (await executor
    .select()
    .from(backgroundWorkStatus)
    .where(and(...conditions))
    .orderBy(desc(backgroundWorkStatus.updatedAt), desc(backgroundWorkStatus.id))
    .limit(limit + 1)) as BackgroundWorkRow[]

  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor =
    hasMore && last ? encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id }) : null
  return { rows: page, nextCursor }
}

/**
 * Fail background-work rows stuck in an active state past {@link STALE_ACTIVE_MS}: the
 * worker crashed or restarted before writing a terminal status, and a hard crash has
 * no in-task hook to recover from. Marks them `failed` so the UI shows the failure
 * rather than an indefinitely-spinning banner. Touches ONLY `background_work_status`.
 * Returns the count reaped; invoked from the outbox-processor cron.
 */
export async function reapStaleBackgroundWork(executor: DbOrTx): Promise<number> {
  const now = new Date()
  const cutoff = new Date(now.getTime() - STALE_ACTIVE_MS)
  const reaped = await executor
    .update(backgroundWorkStatus)
    .set({
      status: 'failed',
      error: 'Background work did not finish in time (the worker may have restarted).',
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        inArray(backgroundWorkStatus.status, ['pending', 'processing']),
        lte(backgroundWorkStatus.startedAt, cutoff)
      )
    )
    .returning({ id: backgroundWorkStatus.id })

  // Retention: the append-only fork audit trail would otherwise grow forever, so drop
  // terminal rows past the retention window. The Activity tab paginates separately.
  await executor
    .delete(backgroundWorkStatus)
    .where(
      and(
        inArray(backgroundWorkStatus.status, ['completed', 'completed_with_warnings', 'failed']),
        lte(backgroundWorkStatus.updatedAt, new Date(now.getTime() - RETENTION_MS))
      )
    )

  if (reaped.length > 0) {
    logger.warn('Reaped stale background-work rows', {
      count: reaped.length,
      thresholdMs: STALE_ACTIVE_MS,
    })
  }
  return reaped.length
}
