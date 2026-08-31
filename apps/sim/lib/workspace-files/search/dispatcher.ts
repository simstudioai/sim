import { db } from '@sim/db'
import {
  workspaceFileSearchBackfill,
  workspaceFileSearchDispatchQueue,
  workspaceFileSearchIndex,
  workspaceFileSearchSegment,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  and,
  asc,
  count,
  eq,
  exists,
  gt,
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
  FILE_SEARCH_INDEX_DISPATCH_WORKSPACES,
  FILE_SEARCH_INDEX_MAX_OUTSTANDING,
  FILE_SEARCH_INDEX_STALE_DISPATCH_MS,
  FILE_SEARCH_INDEX_STALE_REAP_LIMIT,
  FILE_SEARCH_INDEX_WORKSPACE_OUTSTANDING,
} from '@/lib/workspace-files/search/constants'
import {
  indexWorkspaceFileForSearch,
  markWorkspaceFileSearchIndexFailed,
  type WorkspaceFileSearchIndexPayload,
} from '@/lib/workspace-files/search/indexing'
import type { workspaceFileSearchIndexTask } from '@/background/workspace-file-search-index'

const logger = createLogger('WorkspaceFileSearchDispatcher')
const DISPATCH_LOCK_NAME = 'workspace-file-search-dispatch'
const BACKFILL_CURSOR_ID = 'workspace-file-search-v1'

interface RevisionIdentity {
  fileId: string
  sourceContentUpdatedAt: Date
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
      idempotencyKey: `workspace-file-search:${payload.fileId}:${payload.sourceContentUpdatedAt}`,
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
        eq(workspaceFileSearchIndex.fileId, row.fileId),
        eq(workspaceFileSearchIndex.sourceContentUpdatedAt, row.sourceContentUpdatedAt)
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
  if (!cursor || cursor.completedAt) return 0

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
        cursor.afterWorkspaceId && cursor.afterFileId
          ? or(
              gt(workspaceFiles.workspaceId, cursor.afterWorkspaceId),
              and(
                eq(workspaceFiles.workspaceId, cursor.afterWorkspaceId),
                gt(workspaceFiles.id, cursor.afterFileId)
              )
            )
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
      .insert(workspaceFileSearchIndex)
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
      afterWorkspaceId: last?.workspaceId ?? cursor.afterWorkspaceId,
      afterFileId: last?.fileId ?? cursor.afterFileId,
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
      workspaceId: workspaceFileSearchIndex.workspaceId,
      fileId: workspaceFileSearchIndex.fileId,
      sourceContentUpdatedAt: workspaceFileSearchIndex.sourceContentUpdatedAt,
      currentFileId: workspaceFiles.id,
    })
    .from(workspaceFileSearchIndex)
    .leftJoin(
      workspaceFiles,
      and(
        eq(workspaceFiles.id, workspaceFileSearchIndex.fileId),
        eq(workspaceFiles.workspaceId, workspaceFileSearchIndex.workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt),
        eq(workspaceFiles.contentUpdatedAt, workspaceFileSearchIndex.sourceContentUpdatedAt)
      )
    )
    .where(
      and(
        eq(workspaceFileSearchIndex.status, 'pending'),
        isNotNull(workspaceFileSearchIndex.dispatchedAt),
        lt(workspaceFileSearchIndex.dispatchedAt, staleBefore)
      )
    )
    .orderBy(asc(workspaceFileSearchIndex.dispatchedAt), asc(workspaceFileSearchIndex.fileId))
    .limit(FILE_SEARCH_INDEX_STALE_REAP_LIMIT)
    .for('update', { of: workspaceFileSearchIndex, skipLocked: true })

  const current = rows.filter((row) => row.currentFileId !== null)
  const obsolete = rows.filter((row) => row.currentFileId === null)
  const currentFilter = revisionFilter(current)
  if (currentFilter) {
    await tx
      .update(workspaceFileSearchIndex)
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
    await tx
      .delete(workspaceFileSearchSegment)
      .where(
        or(
          ...obsolete.map((row) =>
            and(
              eq(workspaceFileSearchSegment.fileId, row.fileId),
              eq(workspaceFileSearchSegment.sourceContentUpdatedAt, row.sourceContentUpdatedAt)
            )
          )
        )
      )
    await tx.delete(workspaceFileSearchIndex).where(obsoleteFilter)
  }
  return rows.length
}

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
    sourceContentUpdatedAt: Date
  }>(sql`
    WITH selected_workspace(workspace_id) AS (
      VALUES ${workspaceValues}
    ),
    workspace_active AS (
      SELECT search_index.workspace_id, count(*)::int AS active_count
      FROM workspace_file_search_index AS search_index
      INNER JOIN selected_workspace AS selected
        ON selected.workspace_id = search_index.workspace_id
      WHERE search_index.status = 'pending'
        AND search_index.dispatched_at IS NOT NULL
      GROUP BY search_index.workspace_id
    ),
    ranked AS (
      SELECT
        search_index.workspace_id,
        search_index.file_id,
        search_index.source_content_updated_at,
        search_index.updated_at,
        coalesce(workspace_active.active_count, 0) AS active_count,
        row_number() OVER (
          PARTITION BY search_index.workspace_id
          ORDER BY
            search_index.updated_at,
            search_index.file_id,
            search_index.source_content_updated_at
        ) AS workspace_rank
      FROM workspace_file_search_index AS search_index
      INNER JOIN selected_workspace AS selected
        ON selected.workspace_id = search_index.workspace_id
      INNER JOIN workspace_files AS file
        ON file.id = search_index.file_id
        AND file.workspace_id = search_index.workspace_id
        AND file.context = 'workspace'
        AND file.deleted_at IS NULL
        AND file.content_updated_at = search_index.source_content_updated_at
      LEFT JOIN workspace_active
        ON workspace_active.workspace_id = search_index.workspace_id
      WHERE search_index.status = 'pending'
        AND search_index.dispatched_at IS NULL
    ),
    candidates AS (
      SELECT workspace_id, file_id, source_content_updated_at
      FROM ranked
      WHERE workspace_rank <= ${FILE_SEARCH_INDEX_WORKSPACE_OUTSTANDING} - active_count
      ORDER BY updated_at, workspace_id, file_id, source_content_updated_at
      LIMIT ${remainingGlobalCapacity}
    )
    UPDATE workspace_file_search_index AS search_index
    SET dispatched_at = ${now.toISOString()}::timestamp
    FROM candidates
    WHERE search_index.file_id = candidates.file_id
      AND search_index.source_content_updated_at = candidates.source_content_updated_at
      AND search_index.status = 'pending'
      AND search_index.dispatched_at IS NULL
    RETURNING
      search_index.workspace_id AS "workspaceId",
      search_index.file_id AS "fileId",
      search_index.source_content_updated_at AS "sourceContentUpdatedAt"
  `)

  const remainingForWorkspace = tx
    .select({ fileId: workspaceFileSearchIndex.fileId })
    .from(workspaceFileSearchIndex)
    .innerJoin(
      workspaceFiles,
      and(
        eq(workspaceFiles.id, workspaceFileSearchIndex.fileId),
        eq(workspaceFiles.workspaceId, workspaceFileSearchDispatchQueue.workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt),
        eq(workspaceFiles.contentUpdatedAt, workspaceFileSearchIndex.sourceContentUpdatedAt)
      )
    )
    .where(
      and(
        eq(workspaceFileSearchIndex.workspaceId, workspaceFileSearchDispatchQueue.workspaceId),
        eq(workspaceFileSearchIndex.status, 'pending'),
        isNull(workspaceFileSearchIndex.dispatchedAt)
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
  }))
}

export async function prepareWorkspaceFileSearchDispatch(): Promise<PreparedDispatch> {
  return db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${DISPATCH_LOCK_NAME}, 0)) AS acquired`
    )
    if (!lock?.acquired) {
      return { payloads: [], backfilledFiles: 0, reapedClaims: 0, lockAcquired: false }
    }

    const now = new Date()
    const backfilledFiles = await seedBackfillPage(tx, now)
    const reapedClaims = await reapStaleClaims(tx, now)
    const [{ active }] = await tx
      .select({ active: count() })
      .from(workspaceFileSearchIndex)
      .where(
        and(
          eq(workspaceFileSearchIndex.status, 'pending'),
          isNotNull(workspaceFileSearchIndex.dispatchedAt)
        )
      )
    const remainingGlobalCapacity = Math.max(0, FILE_SEARCH_INDEX_MAX_OUTSTANDING - Number(active))
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

    const payloads = await claimQueuedWorkspaceJobs(
      tx,
      workspaces.map((workspace) => workspace.workspaceId),
      remainingGlobalCapacity,
      now
    )
    return { payloads, backfilledFiles, reapedClaims, lockAcquired: true }
  })
}

async function releaseDispatchClaims(payloads: readonly WorkspaceFileSearchIndexPayload[]) {
  if (payloads.length === 0) return
  const rows = payloads.map((payload) => ({
    workspaceId: payload.workspaceId,
    fileId: payload.fileId,
    sourceContentUpdatedAt: new Date(payload.sourceContentUpdatedAt),
  }))
  await db.transaction(async (tx) => {
    const filter = revisionFilter(rows)
    if (filter) {
      await tx
        .update(workspaceFileSearchIndex)
        .set({ dispatchedAt: null, updatedAt: new Date() })
        .where(and(filter, eq(workspaceFileSearchIndex.status, 'pending')))
    }
    await enqueueWorkspaces(
      tx,
      rows.map((row) => row.workspaceId),
      new Date()
    )
  })
}

async function dispatchPreparedJobs(
  payloads: readonly WorkspaceFileSearchIndexPayload[]
): Promise<number> {
  if (payloads.length === 0) return 0
  if (!shouldUseWorkspaceFileSearchTrigger(isTriggerDevEnabled, isInsideTriggerRun())) {
    runDetached('workspace-file-search-index', async () => {
      for (const payload of payloads) {
        try {
          await indexWorkspaceFileForSearch(payload, new AbortController().signal)
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
  const prepared = await prepareWorkspaceFileSearchDispatch()
  if (!prepared.lockAcquired || prepared.payloads.length === 0) {
    return {
      dispatchedFiles: 0,
      backfilledFiles: prepared.backfilledFiles,
      reapedClaims: prepared.reapedClaims,
      lockAcquired: prepared.lockAcquired,
    }
  }
  try {
    const dispatchedFiles = await dispatchPreparedJobs(prepared.payloads)
    return {
      dispatchedFiles,
      backfilledFiles: prepared.backfilledFiles,
      reapedClaims: prepared.reapedClaims,
      lockAcquired: prepared.lockAcquired,
    }
  } catch (error) {
    await releaseDispatchClaims(prepared.payloads)
    logger.error('Failed to dispatch workspace file search indexing batch', {
      files: prepared.payloads.length,
      error: getErrorMessage(error),
    })
    throw error
  }
}
