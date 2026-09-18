import { db } from '@sim/db'
import {
  workspaceFileSearchBackfill,
  workspaceFileSearchDispatchQueue,
  workspaceFileSearchRevision,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { isInsideTriggerRun } from '@/lib/core/config/trigger-runtime'
import { runDetached } from '@/lib/core/utils/background'
import type { DbTransaction } from '@/lib/db/types'
import {
  FILE_SEARCH_BACKFILL_PAGE_SIZE,
  FILE_SEARCH_CLEANUP_BACKLOG_ROWS,
  FILE_SEARCH_DISPATCH_LOCK_TIMEOUT_MS,
  FILE_SEARCH_DISPATCH_STATEMENT_TIMEOUT_MS,
  FILE_SEARCH_DISPATCH_TRANSACTION_TIMEOUT_MS,
  FILE_SEARCH_INDEX_DISPATCH_WORKSPACES,
  FILE_SEARCH_INDEX_GLOBAL_CONCURRENCY,
  FILE_SEARCH_INDEX_MAX_DURATION_SECONDS,
  FILE_SEARCH_INDEX_MAX_OUTSTANDING,
  FILE_SEARCH_INDEX_STALE_DISPATCH_MS,
  FILE_SEARCH_INDEX_STALE_REAP_LIMIT,
  FILE_SEARCH_INDEX_WORKSPACE_OUTSTANDING,
  FILE_SEARCH_RECONCILE_INTERVAL_MS,
} from '@/lib/workspace-files/search/constants'
import { cleanupFileSearchBuilds } from '@/lib/workspace-files/search/index-state'
import {
  indexWorkspaceFileForSearch,
  markWorkspaceFileSearchIndexFailed,
  type WorkspaceFileSearchIndexPayload,
} from '@/lib/workspace-files/search/indexing'
import { configureFileSearchTransaction } from '@/lib/workspace-files/search/transaction'
import type { workspaceFileSearchIndexTask } from '@/background/workspace-file-search-index'

const logger = createLogger('WorkspaceFileSearchDispatcher')
const DISPATCH_LOCK_NAME = 'workspace-file-search-dispatch'
const BACKFILL_CURSOR_ID = 'workspace-file-search-chunks-v2'

async function runDispatchPhase<T>(phase: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now()
  logger.info('Workspace file search dispatch phase started', { phase })
  try {
    const result = await operation()
    logger.info('Workspace file search dispatch phase completed', {
      phase,
      durationMs: Date.now() - startedAt,
    })
    return result
  } catch (error) {
    logger.error('Workspace file search dispatch phase failed', {
      phase,
      durationMs: Date.now() - startedAt,
      code: getPostgresErrorCode(error),
      error: truncate(getErrorMessage(error).split('\nparams: ')[0], 500),
    })
    throw error
  }
}

interface RevisionIdentity {
  fileId: string
  sourceContentUpdatedAt: Date
  dispatchToken?: string
}

interface PreparedDispatch {
  payloads: WorkspaceFileSearchIndexPayload[]
  backfilledFiles: number
  reapedClaims: number
  lockAcquired: boolean
}

export interface WorkspaceFileSearchDispatchResult {
  dispatchedFiles: number
  backfilledFiles: number
  reapedClaims: number
  lockAcquired: boolean
}

export function shouldUseWorkspaceFileSearchTrigger(
  triggerDevEnabled: boolean,
  insideTriggerRun: boolean
): boolean {
  return triggerDevEnabled || insideTriggerRun
}

export function buildWorkspaceFileSearchTriggerItems(
  payloads: readonly WorkspaceFileSearchIndexPayload[],
  region: string
) {
  return payloads.map((payload) => ({
    payload,
    options: {
      idempotencyKey: `workspace-file-search-v2:${payload.fileId}:${payload.sourceContentUpdatedAt}:${payload.dispatchToken ?? 'initial'}`,
      idempotencyKeyTTL: '1h' as const,
      tags: [`workspaceId:${payload.workspaceId}`, `fileId:${payload.fileId}`],
      region,
    },
  }))
}

function revisionFilter(rows: readonly RevisionIdentity[]): SQL | undefined {
  return or(
    ...rows.map((row) =>
      and(
        eq(workspaceFileSearchRevision.fileId, row.fileId),
        eq(workspaceFileSearchRevision.sourceContentUpdatedAt, row.sourceContentUpdatedAt),
        row.dispatchToken
          ? eq(workspaceFileSearchRevision.dispatchedAt, new Date(row.dispatchToken))
          : undefined
      )
    )
  )
}

async function enqueueWorkspaces(
  tx: DbTransaction,
  workspaceIds: readonly string[],
  now: Date
): Promise<void> {
  const uniqueWorkspaceIds = [...new Set(workspaceIds)]
  if (uniqueWorkspaceIds.length === 0) return
  await tx
    .insert(workspaceFileSearchDispatchQueue)
    .values(
      uniqueWorkspaceIds.map((workspaceId) => ({
        workspaceId,
        enqueuedAt: now,
        updatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: workspaceFileSearchDispatchQueue.workspaceId,
      set: { updatedAt: now },
    })
}

/**
 * Seeds one page of the backfill that walks every live workspace file into the revision table.
 *
 * Two things keep this page cheap, and losing either one reintroduces a dispatch that times out.
 *
 * `workspace_files_workspace_active_keyset_idx` supplies the `(workspace_id, id)` order under this
 * exact filter. Without it nothing does, so the page sorts every remaining row instead of reading
 * only the thousand it returns.
 *
 * The cursor is then compared row-wise so that order becomes a seek. The equivalent
 * `workspace_id > :ws OR (workspace_id = :ws AND id > :id)` spelling is not something the planner
 * can turn into an index condition; it stays a filter, so each page restarts at the low end of the
 * index and re-reads every page before it, making the walk quadratic in the file count.
 */
async function seedBackfillPage(tx: DbTransaction, now: Date): Promise<number> {
  await tx
    .insert(workspaceFileSearchBackfill)
    .values({ id: BACKFILL_CURSOR_ID, updatedAt: now })
    .onConflictDoNothing()

  const [cursor] = await tx
    .select()
    .from(workspaceFileSearchBackfill)
    .where(eq(workspaceFileSearchBackfill.id, BACKFILL_CURSOR_ID))
    .for('update')
    .limit(1)
  if (
    !cursor ||
    (cursor.completedAt &&
      now.getTime() - cursor.completedAt.getTime() < FILE_SEARCH_RECONCILE_INTERVAL_MS)
  )
    return 0
  const afterWorkspaceId = cursor.completedAt ? null : cursor.afterWorkspaceId
  const afterFileId = cursor.completedAt ? null : cursor.afterFileId

  const rows = await tx
    .select({
      workspaceId: workspaceFiles.workspaceId,
      fileId: workspaceFiles.id,
      sourceContentUpdatedAt: workspaceFiles.contentUpdatedAt,
    })
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt),
        isNotNull(workspaceFiles.workspaceId),
        afterWorkspaceId && afterFileId
          ? sql`(${workspaceFiles.workspaceId}, ${workspaceFiles.id}) > (${afterWorkspaceId}, ${afterFileId})`
          : undefined
      )
    )
    .orderBy(asc(workspaceFiles.workspaceId), asc(workspaceFiles.id))
    .limit(FILE_SEARCH_BACKFILL_PAGE_SIZE)
    .for('share', { of: workspaceFiles })

  const files = rows.filter(
    (row): row is typeof row & { workspaceId: string } => row.workspaceId !== null
  )
  if (files.length > 0) {
    await tx
      .insert(workspaceFileSearchRevision)
      .values(
        files.map((file) => ({
          workspaceId: file.workspaceId,
          fileId: file.fileId,
          sourceContentUpdatedAt: file.sourceContentUpdatedAt,
          status: 'pending' as const,
          updatedAt: now,
        }))
      )
      .onConflictDoNothing()
    await enqueueWorkspaces(
      tx,
      files.map((file) => file.workspaceId),
      now
    )
  }

  const last = files.at(-1)
  await tx
    .update(workspaceFileSearchBackfill)
    .set({
      afterWorkspaceId: last?.workspaceId ?? afterWorkspaceId,
      afterFileId: last?.fileId ?? afterFileId,
      completedAt: rows.length < FILE_SEARCH_BACKFILL_PAGE_SIZE ? now : null,
      updatedAt: now,
    })
    .where(eq(workspaceFileSearchBackfill.id, BACKFILL_CURSOR_ID))
  return files.length
}

async function reapStaleClaims(tx: DbTransaction, now: Date): Promise<number> {
  const staleBefore = new Date(now.getTime() - FILE_SEARCH_INDEX_STALE_DISPATCH_MS)
  const rows = await tx
    .select({
      workspaceId: workspaceFileSearchRevision.workspaceId,
      fileId: workspaceFileSearchRevision.fileId,
      sourceContentUpdatedAt: workspaceFileSearchRevision.sourceContentUpdatedAt,
      currentFileId: workspaceFiles.id,
    })
    .from(workspaceFileSearchRevision)
    .leftJoin(
      workspaceFiles,
      and(
        eq(workspaceFiles.id, workspaceFileSearchRevision.fileId),
        eq(workspaceFiles.workspaceId, workspaceFileSearchRevision.workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt),
        eq(workspaceFiles.contentUpdatedAt, workspaceFileSearchRevision.sourceContentUpdatedAt)
      )
    )
    .where(
      and(
        eq(workspaceFileSearchRevision.status, 'pending'),
        isNotNull(workspaceFileSearchRevision.dispatchedAt),
        lt(workspaceFileSearchRevision.dispatchedAt, staleBefore)
      )
    )
    .orderBy(asc(workspaceFileSearchRevision.dispatchedAt), asc(workspaceFileSearchRevision.fileId))
    .limit(FILE_SEARCH_INDEX_STALE_REAP_LIMIT)
    .for('update', { of: workspaceFileSearchRevision, skipLocked: true })

  const current = rows.filter((row) => row.currentFileId !== null)
  const obsolete = rows.filter((row) => row.currentFileId === null)
  const currentFilter = revisionFilter(current)
  if (currentFilter) {
    await tx
      .update(workspaceFileSearchRevision)
      .set({ dispatchedAt: null, updatedAt: now })
      .where(currentFilter)
    await enqueueWorkspaces(
      tx,
      current.map((row) => row.workspaceId),
      now
    )
  }
  const obsoleteFilter = revisionFilter(obsolete)
  if (obsoleteFilter) {
    await tx.delete(workspaceFileSearchRevision).where(obsoleteFilter)
  }
  return rows.length
}

/** Probe each workspace's available slots and lock candidates before the update, skipping busy rows. */
async function claimQueuedWorkspaceJobs(
  tx: DbTransaction,
  workspaceIds: readonly string[],
  remainingGlobalCapacity: number,
  now: Date
): Promise<WorkspaceFileSearchIndexPayload[]> {
  if (workspaceIds.length === 0 || remainingGlobalCapacity <= 0) return []
  const workspaceValues = sql.join(
    workspaceIds.map((workspaceId) => sql`(${workspaceId})`),
    sql`, `
  )
  const rows = await tx.execute<{
    workspaceId: string
    fileId: string
    sourceContentUpdatedAt: string
  }>(sql`
    WITH selected_workspace(workspace_id) AS (
      VALUES ${workspaceValues}
    ),
    candidates AS MATERIALIZED (
      SELECT queued.*
      FROM selected_workspace AS selected
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS active_count
        FROM (
          SELECT 1 FROM workspace_file_search_revision AS active
          WHERE active.workspace_id = selected.workspace_id
            AND active.status = 'pending' AND active.dispatched_at IS NOT NULL
          LIMIT ${FILE_SEARCH_INDEX_WORKSPACE_OUTSTANDING}
        ) AS active_claims
      ) AS workspace_active
      CROSS JOIN LATERAL (
        SELECT search_index.workspace_id, search_index.file_id,
          search_index.source_content_updated_at, search_index.updated_at
        FROM workspace_file_search_revision AS search_index
        INNER JOIN workspace_files AS file
          ON file.id = search_index.file_id
          AND file.workspace_id = search_index.workspace_id
          AND file.context = 'workspace'
          AND file.deleted_at IS NULL
          AND file.content_updated_at = search_index.source_content_updated_at
        WHERE search_index.workspace_id = selected.workspace_id
          AND search_index.status = 'pending' AND search_index.dispatched_at IS NULL
        ORDER BY search_index.updated_at, search_index.file_id, search_index.source_content_updated_at
        LIMIT greatest(0, ${FILE_SEARCH_INDEX_WORKSPACE_OUTSTANDING} - workspace_active.active_count)
        FOR UPDATE OF search_index SKIP LOCKED
      ) AS queued
      ORDER BY queued.updated_at, queued.workspace_id, queued.file_id, queued.source_content_updated_at
      LIMIT ${remainingGlobalCapacity}
    )
    UPDATE workspace_file_search_revision AS search_index
    SET dispatched_at = ${now.toISOString()}::timestamp
    FROM candidates
    WHERE search_index.file_id = candidates.file_id
      AND search_index.source_content_updated_at = candidates.source_content_updated_at
      AND search_index.status = 'pending'
      AND search_index.dispatched_at IS NULL
    RETURNING
      search_index.workspace_id AS "workspaceId",
      search_index.file_id AS "fileId",
      search_index.source_content_updated_at AT TIME ZONE 'UTC' AS "sourceContentUpdatedAt"
  `)

  const remainingForWorkspace = tx
    .select({ fileId: workspaceFileSearchRevision.fileId })
    .from(workspaceFileSearchRevision)
    .innerJoin(
      workspaceFiles,
      and(
        eq(workspaceFiles.id, workspaceFileSearchRevision.fileId),
        eq(workspaceFiles.workspaceId, workspaceFileSearchDispatchQueue.workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt),
        eq(workspaceFiles.contentUpdatedAt, workspaceFileSearchRevision.sourceContentUpdatedAt)
      )
    )
    .where(
      and(
        eq(workspaceFileSearchRevision.workspaceId, workspaceFileSearchDispatchQueue.workspaceId),
        eq(workspaceFileSearchRevision.status, 'pending'),
        isNull(workspaceFileSearchRevision.dispatchedAt)
      )
    )
  await tx
    .update(workspaceFileSearchDispatchQueue)
    .set({ lastDispatchedAt: now, updatedAt: now })
    .where(
      and(
        inArray(workspaceFileSearchDispatchQueue.workspaceId, workspaceIds),
        exists(remainingForWorkspace)
      )
    )
  await tx
    .delete(workspaceFileSearchDispatchQueue)
    .where(
      and(
        inArray(workspaceFileSearchDispatchQueue.workspaceId, workspaceIds),
        notExists(remainingForWorkspace)
      )
    )

  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    fileId: row.fileId,
    sourceContentUpdatedAt: new Date(row.sourceContentUpdatedAt).toISOString(),
    dispatchToken: now.toISOString(),
  }))
}

export async function prepareWorkspaceFileSearchDispatch(
  maxOutstanding = FILE_SEARCH_INDEX_MAX_OUTSTANDING
): Promise<PreparedDispatch> {
  return runDispatchPhase('prepare-transaction', () =>
    db.transaction(async (tx) => {
      await runDispatchPhase('configure-timeouts', () =>
        configureFileSearchTransaction(tx, {
          statementTimeout: FILE_SEARCH_DISPATCH_STATEMENT_TIMEOUT_MS,
          lockTimeout: FILE_SEARCH_DISPATCH_LOCK_TIMEOUT_MS,
          transactionTimeout: FILE_SEARCH_DISPATCH_TRANSACTION_TIMEOUT_MS,
        })
      )
      return runDispatchPhase('prepare', async () => {
        const [lock] = await tx.execute<{ acquired: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${DISPATCH_LOCK_NAME}, 0)) AS acquired`
        )
        if (!lock?.acquired) {
          return { payloads: [], backfilledFiles: 0, reapedClaims: 0, lockAcquired: false }
        }

        const now = new Date()
        const backfilledFiles = await runDispatchPhase('backfill', () => seedBackfillPage(tx, now))
        const reapedClaims = await runDispatchPhase('reap', () => reapStaleClaims(tx, now))
        const [{ active, cleanupBacklogged }] = await tx.execute<{
          active: number
          cleanupBacklogged: boolean
        }>(sql`
          SELECT count(*)::int AS active,
            (SELECT count(*) >= ${FILE_SEARCH_CLEANUP_BACKLOG_ROWS} FROM (
              SELECT 1 FROM workspace_file_search_build build
              CROSS JOIN LATERAL (
                SELECT 1 FROM workspace_file_search_chunk chunk WHERE chunk.build_id = build.id
                LIMIT ${FILE_SEARCH_CLEANUP_BACKLOG_ROWS}
              ) retired_chunk
              WHERE build.expires_at <= now() LIMIT ${FILE_SEARCH_CLEANUP_BACKLOG_ROWS}
            ) retired) AS "cleanupBacklogged"
          FROM (
            SELECT 1 FROM workspace_file_search_revision
            WHERE status = 'pending' AND dispatched_at IS NOT NULL
            LIMIT ${FILE_SEARCH_INDEX_MAX_OUTSTANDING}
          ) AS active_claims`)
        if (cleanupBacklogged) {
          logger.info('Workspace file search dispatch paused for cleanup')
          return { payloads: [], backfilledFiles, reapedClaims, lockAcquired: true }
        }
        const remainingGlobalCapacity = Math.max(0, maxOutstanding - Number(active))
        if (remainingGlobalCapacity === 0) {
          return { payloads: [], backfilledFiles, reapedClaims, lockAcquired: true }
        }

        const workspaces = await tx
          .select({ workspaceId: workspaceFileSearchDispatchQueue.workspaceId })
          .from(workspaceFileSearchDispatchQueue)
          .orderBy(
            sql`${workspaceFileSearchDispatchQueue.lastDispatchedAt} ASC NULLS FIRST`,
            asc(workspaceFileSearchDispatchQueue.enqueuedAt),
            asc(workspaceFileSearchDispatchQueue.workspaceId)
          )
          .limit(Math.min(FILE_SEARCH_INDEX_DISPATCH_WORKSPACES, remainingGlobalCapacity))
          .for('update', { skipLocked: true })

        const payloads = await runDispatchPhase('claim', () =>
          claimQueuedWorkspaceJobs(
            tx,
            workspaces.map((workspace) => workspace.workspaceId),
            remainingGlobalCapacity,
            now
          )
        )
        return { payloads, backfilledFiles, reapedClaims, lockAcquired: true }
      })
    })
  )
}

async function releaseDispatchClaims(payloads: readonly WorkspaceFileSearchIndexPayload[]) {
  if (payloads.length === 0) return
  const rows = payloads.map((payload) => ({
    workspaceId: payload.workspaceId,
    fileId: payload.fileId,
    sourceContentUpdatedAt: new Date(payload.sourceContentUpdatedAt),
    dispatchToken: payload.dispatchToken,
  }))
  await runDispatchPhase('release-claims', () =>
    db.transaction(async (tx) => {
      const filter = revisionFilter(rows)
      if (filter) {
        await tx
          .update(workspaceFileSearchRevision)
          .set({ dispatchedAt: null, updatedAt: new Date() })
          .where(and(filter, eq(workspaceFileSearchRevision.status, 'pending')))
      }
      await enqueueWorkspaces(
        tx,
        rows.map((row) => row.workspaceId),
        new Date()
      )
    })
  )
}

async function dispatchPreparedJobs(
  payloads: readonly WorkspaceFileSearchIndexPayload[]
): Promise<number> {
  if (payloads.length === 0) return 0
  if (!shouldUseWorkspaceFileSearchTrigger(isTriggerDevEnabled, isInsideTriggerRun())) {
    runDetached('workspace-file-search-index', async () => {
      for (const payload of payloads) {
        try {
          await indexWorkspaceFileForSearch(
            payload,
            AbortSignal.timeout(FILE_SEARCH_INDEX_MAX_DURATION_SECONDS * 1000)
          )
        } catch {
          await markWorkspaceFileSearchIndexFailed(payload)
        }
      }
    })
    return payloads.length
  }

  const [{ tasks }, { resolveTriggerRegion }] = await Promise.all([
    import('@trigger.dev/sdk'),
    import('@/lib/core/async-jobs/region'),
  ])
  const region = await resolveTriggerRegion()
  const result = await tasks.batchTrigger<typeof workspaceFileSearchIndexTask>(
    'workspace-file-search-index',
    buildWorkspaceFileSearchTriggerItems(payloads, region)
  )
  logger.info('Dispatched workspace file search indexing batch', {
    batchId: result.batchId,
    files: payloads.length,
  })
  return payloads.length
}

export async function dispatchWorkspaceFileSearchIndexJobs(): Promise<WorkspaceFileSearchDispatchResult> {
  await cleanupFileSearchBuilds().catch((error: unknown) => {
    logger.warn('Workspace file search cleanup deferred', { code: getPostgresErrorCode(error) })
  })
  const prepared = await prepareWorkspaceFileSearchDispatch(
    shouldUseWorkspaceFileSearchTrigger(isTriggerDevEnabled, isInsideTriggerRun())
      ? FILE_SEARCH_INDEX_MAX_OUTSTANDING
      : FILE_SEARCH_INDEX_GLOBAL_CONCURRENCY
  )
  if (!prepared.lockAcquired || prepared.payloads.length === 0) {
    return {
      dispatchedFiles: 0,
      backfilledFiles: prepared.backfilledFiles,
      reapedClaims: prepared.reapedClaims,
      lockAcquired: prepared.lockAcquired,
    }
  }
  try {
    const dispatchedFiles = await runDispatchPhase('enqueue', () =>
      dispatchPreparedJobs(prepared.payloads)
    )
    return {
      dispatchedFiles,
      backfilledFiles: prepared.backfilledFiles,
      reapedClaims: prepared.reapedClaims,
      lockAcquired: prepared.lockAcquired,
    }
  } catch (error) {
    logger.error('Failed to dispatch workspace file search indexing batch', {
      files: prepared.payloads.length,
      error: truncate(getErrorMessage(error).split('\nparams: ')[0], 500),
    })
    try {
      await releaseDispatchClaims(prepared.payloads)
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        'File search enqueue and claim release failed',
        {
          cause: error,
        }
      )
    }
    throw error
  }
}
