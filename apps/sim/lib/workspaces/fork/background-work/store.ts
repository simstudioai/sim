import { backgroundWorkStatus } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('ForkBackgroundWork')

export type BackgroundWorkKind = 'deployment_side_effects' | 'fork_content_copy'
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

/** Cap on recent jobs returned for a workspace's Activity tab. */
const BACKGROUND_WORK_LIST_LIMIT = 20

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

/**
 * Recent background-work jobs for a workspace - the durable audit record the Activity
 * tab renders, most-recent first and capped. Fork jobs are append-only (one row per
 * fork), so this is the workspace's fork history; older rows are pruned by the cron.
 */
export async function listSurfacedBackgroundWork(
  executor: DbOrTx,
  workspaceId: string
): Promise<BackgroundWorkRow[]> {
  const rows = await executor
    .select()
    .from(backgroundWorkStatus)
    .where(
      and(
        eq(backgroundWorkStatus.workspaceId, workspaceId),
        inArray(backgroundWorkStatus.status, SURFACED_STATUSES)
      )
    )
    .orderBy(desc(backgroundWorkStatus.updatedAt))
    .limit(BACKGROUND_WORK_LIST_LIMIT)
  return rows as BackgroundWorkRow[]
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
  // terminal rows past the retention window. The Activity tab caps display separately.
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
