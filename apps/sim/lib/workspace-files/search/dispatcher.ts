import { db } from '@sim/db'
import {
  fileSearchDispatchQueue,
  workspaceFileSearchBackfill,
  workspaceFileSearchBuild,
  workspaceFileSearchRevision,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  getErrorMessage,
  getPostgresCancellationReason,
  getPostgresErrorCode,
} from '@sim/utils/errors'
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
  lte,
  notExists,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { isInsideTriggerRun } from '@/lib/core/config/trigger-runtime'
import { runDetached } from '@/lib/core/utils/background'
import { tryAcquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbTransaction } from '@/lib/db/types'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import {
  FILE_SEARCH_BACKFILL_PAGE_SIZE,
  FILE_SEARCH_CLEANUP_BACKLOG_ROWS,
  FILE_SEARCH_DISPATCH_HANDOFF_MS,
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
import { lockFileSearchOwners } from '@/lib/workspace-files/search/owner-policy'
import {
  currentFileSearchDependencies,
  fileSearchOwnerFields,
  resolveFileSearchOwner,
} from '@/lib/workspace-files/search/scope'
import { configureFileSearchTransaction } from '@/lib/workspace-files/search/transaction'
import type { workspaceFileSearchIndexTask } from '@/background/workspace-file-search-index'

const logger = createLogger('WorkspaceFileSearchDispatcher')
const DISPATCH_LOCK_NAME = 'workspace-file-search-dispatch'
const BACKFILL_CURSOR_ID = 'file-search-owners-v3'

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
    const databaseReason = getPostgresCancellationReason(error)
    logger.error('Workspace file search dispatch phase failed', {
      phase,
      durationMs: Date.now() - startedAt,
      code: getPostgresErrorCode(error),
      ...(databaseReason ? { databaseReason } : {}),
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
  /** Of the reaped claims, those released because their handoff deadline passed. */
  abandonedClaims: number
  lockAcquired: boolean
}

export interface WorkspaceFileSearchDispatchResult {
  dispatchedFiles: number
  backfilledFiles: number
  reapedClaims: number
  /** Of the reaped claims, those released because their handoff deadline passed. */
  abandonedClaims: number
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
      tags: [
        `fileOwner:${resolveFileSearchOwner(payload).entityType}:${resolveFileSearchOwner(payload).entityId}`,
        `fileId:${payload.fileId}`,
      ],
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

function rowOwner(row: { entityType: string; entityId: string }): EditableFileOwner {
  return resolveFileSearchOwner({ owner: row })
}

async function enqueueOwners(
  tx: DbTransaction,
  owners: readonly EditableFileOwner[],
  now: Date
): Promise<void> {
  const unique = [...new Map(owners.map((owner) => [JSON.stringify(owner), owner])).values()]
  if (unique.length === 0) return
  await tx
    .insert(fileSearchDispatchQueue)
    .values(unique.map((owner) => ({ ...owner, enqueuedAt: now, updatedAt: now })))
    .onConflictDoUpdate({
      target: [fileSearchDispatchQueue.entityType, fileSearchDispatchQueue.entityId],
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
  const afterEntityType = cursor.completedAt ? null : cursor.afterEntityType
  const afterEntityId = cursor.completedAt ? null : cursor.afterEntityId
  const afterFileId = cursor.completedAt ? null : cursor.afterFileId

  const rows = await tx
    .select({
      entityType: sql<string>`coalesce(${workspaceFiles.entityType}, 'workspace')`,
      entityId: sql<string>`coalesce(${workspaceFiles.entityId}, ${workspaceFiles.workspaceId})`,
      fileId: workspaceFiles.id,
      sourceContentUpdatedAt: workspaceFiles.contentUpdatedAt,
    })
    .from(workspaceFiles)
    .where(
      and(
        sql`((${workspaceFiles.context} = 'workspace' AND ${workspaceFiles.workspaceId} IS NOT NULL) OR (${workspaceFiles.context} = 'project' AND ${workspaceFiles.entityType} = 'project' AND ${workspaceFiles.entityId} IS NOT NULL))`,
        isNull(workspaceFiles.deletedAt),
        afterEntityType && afterEntityId && afterFileId
          ? sql`(coalesce(${workspaceFiles.entityType}, 'workspace'), coalesce(${workspaceFiles.entityId}, ${workspaceFiles.workspaceId}), ${workspaceFiles.id}) > (${afterEntityType}, ${afterEntityId}, ${afterFileId})`
          : undefined
      )
    )
    .orderBy(
      sql`coalesce(${workspaceFiles.entityType}, 'workspace')`,
      sql`coalesce(${workspaceFiles.entityId}, ${workspaceFiles.workspaceId})`,
      asc(workspaceFiles.id)
    )
    .limit(FILE_SEARCH_BACKFILL_PAGE_SIZE)
    .for('share', { of: workspaceFiles })

  const files = rows.map((row) => ({ ...row, owner: rowOwner(row) }))
  if (files.length > 0) {
    await tx
      .insert(workspaceFileSearchRevision)
      .values(
        files.map((file) => ({
          ...fileSearchOwnerFields(file.owner),
          fileId: file.fileId,
          sourceContentUpdatedAt: file.sourceContentUpdatedAt,
          status: 'pending' as const,
          updatedAt: now,
        }))
      )
      .onConflictDoNothing()
    await enqueueOwners(
      tx,
      files.map((file) => file.owner),
      now
    )
  }

  const last = files.at(-1)
  await tx
    .update(workspaceFileSearchBackfill)
    .set({
      afterEntityType: last?.entityType ?? afterEntityType,
      afterEntityId: last?.entityId ?? afterEntityId,
      afterFileId: last?.fileId ?? afterFileId,
      completedAt: rows.length < FILE_SEARCH_BACKFILL_PAGE_SIZE ? now : null,
      updatedAt: now,
    })
    .where(eq(workspaceFileSearchBackfill.id, BACKFILL_CURSOR_ID))
  return files.length
}

/**
 * Releases claims that are not expected to finish, returning their files and slots to the queue. A
 * claim whose handoff deadline has passed has no run known to exist, normally because its dispatcher
 * stopped between the claim's commit and its enqueue. A claim past the stale-dispatch window has
 * outlasted the retries its run is expected to make.
 *
 * A released claim is claimed again under a new token rather than re-sent, so recovery never has to
 * deduplicate against a run the original claim did get: that run is fenced out by the old token.
 */
async function reapStaleClaims(
  tx: DbTransaction,
  now: Date
): Promise<{ reaped: number; abandoned: number }> {
  const staleBefore = new Date(now.getTime() - FILE_SEARCH_INDEX_STALE_DISPATCH_MS)
  const rows = await tx
    .select({
      entityType: sql<string>`coalesce(${workspaceFileSearchRevision.entityType}, 'workspace')`,
      entityId: sql<string>`coalesce(${workspaceFileSearchRevision.entityId}, ${workspaceFileSearchRevision.workspaceId})`,
      fileId: workspaceFileSearchRevision.fileId,
      sourceContentUpdatedAt: workspaceFileSearchRevision.sourceContentUpdatedAt,
      currentFileId: workspaceFiles.id,
      handoffExpired: sql<boolean>`coalesce(${workspaceFileSearchRevision.handoffExpiresAt} <= clock_timestamp(), false)`,
    })
    .from(workspaceFileSearchRevision)
    .leftJoin(
      workspaceFiles,
      and(
        eq(workspaceFiles.id, workspaceFileSearchRevision.fileId),
        sql`coalesce(${workspaceFiles.entityType}, 'workspace') = coalesce(${workspaceFileSearchRevision.entityType}, 'workspace')`,
        sql`coalesce(${workspaceFiles.entityId}, ${workspaceFiles.workspaceId}) = coalesce(${workspaceFileSearchRevision.entityId}, ${workspaceFileSearchRevision.workspaceId})`,
        sql`${workspaceFiles.context} = coalesce(${workspaceFileSearchRevision.entityType}, 'workspace')`,
        isNull(workspaceFiles.deletedAt),
        eq(workspaceFiles.contentUpdatedAt, workspaceFileSearchRevision.sourceContentUpdatedAt)
      )
    )
    .where(
      and(
        eq(workspaceFileSearchRevision.status, 'pending'),
        isNotNull(workspaceFileSearchRevision.dispatchedAt),
        or(
          lt(workspaceFileSearchRevision.dispatchedAt, staleBefore),
          lte(workspaceFileSearchRevision.handoffExpiresAt, sql`clock_timestamp()`)
        )
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
      .set({ dispatchedAt: null, handoffExpiresAt: null, updatedAt: now })
      .where(currentFilter)
    await enqueueOwners(tx, current.map(rowOwner), now)
  }
  const obsoleteFilter = revisionFilter(obsolete)
  if (obsoleteFilter) {
    await tx.delete(workspaceFileSearchRevision).where(obsoleteFilter)
  }
  return { reaped: rows.length, abandoned: current.filter((row) => row.handoffExpired).length }
}

/**
 * Probe each workspace's available slots and lock candidates before the update, skipping busy rows.
 *
 * The live-file check is a correlated LATERAL with `LIMIT 1` rather than a join. `FOR UPDATE`
 * forbids parallel plans and the planner estimates the timestamp equi-join at about one row, so
 * a join becomes a hash join over every file and every pending revision of the workspace before
 * the top-N sort, which exceeds the statement timeout on a large backlog. A LATERAL with LIMIT
 * cannot be flattened into that join, so the claim stays an ordered walk of the pending index
 * that stops after the batch size.
 */
async function reconcileOwnerDependencies(
  tx: DbTransaction,
  owners: readonly EditableFileOwner[],
  now: Date
) {
  for (const owner of owners) {
    const stale = await tx
      .select({ fileId: workspaceFiles.id, buildId: workspaceFileSearchRevision.buildId })
      .from(workspaceFileSearchRevision)
      .innerJoin(workspaceFiles, eq(workspaceFiles.id, workspaceFileSearchRevision.fileId))
      .where(
        and(
          sql`coalesce(${workspaceFileSearchRevision.entityType}, 'workspace') = ${owner.entityType}`,
          sql`coalesce(${workspaceFileSearchRevision.entityId}, ${workspaceFileSearchRevision.workspaceId}) = ${owner.entityId}`,
          eq(workspaceFileSearchRevision.status, 'ready'),
          sql`NOT (${currentFileSearchDependencies(workspaceFileSearchRevision.buildId, owner)})`
        )
      )
      .orderBy(asc(workspaceFiles.id))
      .limit(FILE_SEARCH_BACKFILL_PAGE_SIZE)
      .for('update', { of: workspaceFiles, skipLocked: true })
    for (const row of stale) {
      if (!row.buildId) continue
      await tx
        .update(workspaceFileSearchBuild)
        .set({ expiresAt: now })
        .where(eq(workspaceFileSearchBuild.id, row.buildId))
      await tx
        .update(workspaceFileSearchRevision)
        .set({
          status: 'pending',
          buildId: null,
          dispatchedAt: null,
          handoffExpiresAt: null,
          failureReason: null,
          lineCount: 0,
          chunkCount: 0,
          indexedBytes: 0,
          updatedAt: now,
        })
        .where(
          and(
            eq(workspaceFileSearchRevision.fileId, row.fileId),
            eq(workspaceFileSearchRevision.buildId, row.buildId)
          )
        )
    }
  }
}

async function claimQueuedOwnerJobs(
  tx: DbTransaction,
  owners: readonly EditableFileOwner[],
  remainingGlobalCapacity: number,
  now: Date
): Promise<WorkspaceFileSearchIndexPayload[]> {
  if (owners.length === 0 || remainingGlobalCapacity <= 0) return []
  const ownerValues = sql.join(
    owners.map((owner) => sql`(${owner.entityType}, ${owner.entityId})`),
    sql`, `
  )
  const rows = await tx.execute<{
    entityType: string
    entityId: string
    fileId: string
    sourceContentUpdatedAt: string
  }>(sql`
    WITH selected_owner(entity_type, entity_id) AS (VALUES ${ownerValues}), candidates AS MATERIALIZED (
      SELECT queued.* FROM selected_owner selected
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS active_count FROM (
          SELECT 1 FROM workspace_file_search_revision active
          WHERE coalesce(active.entity_type, 'workspace') = selected.entity_type
            AND coalesce(active.entity_id, active.workspace_id) = selected.entity_id
            AND active.status = 'pending' AND active.dispatched_at IS NOT NULL
          LIMIT ${FILE_SEARCH_INDEX_WORKSPACE_OUTSTANDING}
        ) active_claims
      ) owner_active
      CROSS JOIN LATERAL (
        SELECT search_index.file_id, search_index.source_content_updated_at, search_index.updated_at,
          coalesce(search_index.entity_type, 'workspace') entity_type, coalesce(search_index.entity_id, search_index.workspace_id) entity_id
        FROM workspace_file_search_revision search_index
        CROSS JOIN LATERAL (
          SELECT 1 FROM workspace_files file WHERE file.id = search_index.file_id
            AND file.context = selected.entity_type
            AND coalesce(file.entity_type, 'workspace') = selected.entity_type
            AND coalesce(file.entity_id, file.workspace_id) = selected.entity_id
            AND file.deleted_at IS NULL AND file.content_updated_at = search_index.source_content_updated_at
          LIMIT 1
        ) live_file
        WHERE coalesce(search_index.entity_type, 'workspace') = selected.entity_type
          AND coalesce(search_index.entity_id, search_index.workspace_id) = selected.entity_id
          AND search_index.status = 'pending' AND search_index.dispatched_at IS NULL
        ORDER BY search_index.updated_at, search_index.file_id, search_index.source_content_updated_at
        LIMIT greatest(0, ${FILE_SEARCH_INDEX_WORKSPACE_OUTSTANDING} - owner_active.active_count)
        FOR UPDATE OF search_index SKIP LOCKED
      ) queued
      ORDER BY queued.updated_at, queued.entity_type, queued.entity_id, queued.file_id, queued.source_content_updated_at
      LIMIT ${remainingGlobalCapacity}
    ) UPDATE workspace_file_search_revision search_index
      SET dispatched_at = ${now.toISOString()}::timestamp,
        handoff_expires_at = clock_timestamp() + ${FILE_SEARCH_DISPATCH_HANDOFF_MS} * interval '1 millisecond'
      FROM candidates WHERE search_index.file_id = candidates.file_id
        AND search_index.source_content_updated_at = candidates.source_content_updated_at
        AND search_index.status = 'pending' AND search_index.dispatched_at IS NULL
      RETURNING coalesce(search_index.entity_type, 'workspace') AS "entityType",
        coalesce(search_index.entity_id, search_index.workspace_id) AS "entityId",
        search_index.file_id AS "fileId", search_index.source_content_updated_at AT TIME ZONE 'UTC' AS "sourceContentUpdatedAt"
  `)
  const remaining = tx
    .select({ fileId: workspaceFileSearchRevision.fileId })
    .from(workspaceFileSearchRevision)
    .where(
      and(
        sql`coalesce(${workspaceFileSearchRevision.entityType}, 'workspace') = ${fileSearchDispatchQueue.entityType}`,
        sql`coalesce(${workspaceFileSearchRevision.entityId}, ${workspaceFileSearchRevision.workspaceId}) = ${fileSearchDispatchQueue.entityId}`,
        or(
          and(
            eq(workspaceFileSearchRevision.status, 'pending'),
            isNull(workspaceFileSearchRevision.dispatchedAt)
          ),
          and(
            eq(workspaceFileSearchRevision.status, 'ready'),
            sql`EXISTS (SELECT 1 FROM file_search_dependency dependency LEFT JOIN workspace_files input ON input.id = dependency.file_id WHERE dependency.build_id = ${workspaceFileSearchRevision.buildId} AND (input.id IS NULL OR input.deleted_at IS NOT NULL OR input.key <> dependency.key OR input.content_updated_at <> dependency.source_content_updated_at))`
          )
        )
      )
    )
  const selected = or(
    ...owners.map((owner) =>
      and(
        eq(fileSearchDispatchQueue.entityType, owner.entityType),
        eq(fileSearchDispatchQueue.entityId, owner.entityId)
      )
    )
  )
  await tx
    .update(fileSearchDispatchQueue)
    .set({ lastDispatchedAt: now, updatedAt: now })
    .where(and(selected, exists(remaining)))
  await tx.delete(fileSearchDispatchQueue).where(and(selected, notExists(remaining)))
  return rows.map((row) => ({
    owner: rowOwner(row),
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
        const acquired = await tryAcquireAdvisoryXactLock(
          tx,
          'workspace_file_search_dispatch',
          DISPATCH_LOCK_NAME
        )
        if (!acquired) {
          return {
            payloads: [],
            backfilledFiles: 0,
            reapedClaims: 0,
            abandonedClaims: 0,
            lockAcquired: false,
          }
        }

        const now = new Date()
        const backfilledFiles = await runDispatchPhase('backfill', () => seedBackfillPage(tx, now))
        const { reaped: reapedClaims, abandoned: abandonedClaims } = await runDispatchPhase(
          'reap',
          () => reapStaleClaims(tx, now)
        )
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
          return {
            payloads: [],
            backfilledFiles,
            reapedClaims,
            abandonedClaims,
            lockAcquired: true,
          }
        }
        const remainingGlobalCapacity = Math.max(0, maxOutstanding - Number(active))
        if (remainingGlobalCapacity === 0) {
          return {
            payloads: [],
            backfilledFiles,
            reapedClaims,
            abandonedClaims,
            lockAcquired: true,
          }
        }

        const queued = await tx
          .select({
            entityType: fileSearchDispatchQueue.entityType,
            entityId: fileSearchDispatchQueue.entityId,
          })
          .from(fileSearchDispatchQueue)
          .orderBy(
            sql`${fileSearchDispatchQueue.lastDispatchedAt} ASC NULLS FIRST`,
            asc(fileSearchDispatchQueue.enqueuedAt),
            asc(fileSearchDispatchQueue.entityType),
            asc(fileSearchDispatchQueue.entityId)
          )
          .limit(Math.min(FILE_SEARCH_INDEX_DISPATCH_WORKSPACES, remainingGlobalCapacity))
        const owners = await lockFileSearchOwners(tx, queued.map(rowOwner), { skipBusy: true })
        await reconcileOwnerDependencies(tx, owners, now)
        const payloads = await runDispatchPhase('claim', () =>
          claimQueuedOwnerJobs(tx, owners, remainingGlobalCapacity, now)
        )
        return { payloads, backfilledFiles, reapedClaims, abandonedClaims, lockAcquired: true }
      })
    })
  )
}

function dispatchedRevisions(payloads: readonly WorkspaceFileSearchIndexPayload[]) {
  return payloads.map((payload) => ({
    owner: resolveFileSearchOwner(payload),
    fileId: payload.fileId,
    sourceContentUpdatedAt: new Date(payload.sourceContentUpdatedAt),
    dispatchToken: payload.dispatchToken,
  }))
}

async function releaseDispatchClaims(payloads: readonly WorkspaceFileSearchIndexPayload[]) {
  if (payloads.length === 0) return
  const rows = dispatchedRevisions(payloads)
  await runDispatchPhase('release-claims', () =>
    db.transaction(async (tx) => {
      const filter = revisionFilter(rows)
      if (filter) {
        await tx
          .update(workspaceFileSearchRevision)
          .set({ dispatchedAt: null, handoffExpiresAt: null, updatedAt: new Date() })
          .where(and(filter, eq(workspaceFileSearchRevision.status, 'pending')))
      }
      await enqueueOwners(
        tx,
        rows.map((row) => row.owner),
        new Date()
      )
    })
  )
}

/**
 * Records that each claim now has a run, so a later dispatch leaves it to that run. The token in the
 * filter keeps a late write from completing a claim that was released and claimed again.
 *
 * A row another transaction holds is skipped, not waited on: its run is beginning the build, which
 * completes the handoff itself, or a file change or a release is replacing the claim. Waiting would
 * keep the rows already written locked against runs beginning on them, and would deadlock with a
 * bulk file change that reaches the same rows in another order.
 */
async function completeDispatchHandoff(payloads: readonly WorkspaceFileSearchIndexPayload[]) {
  const filter = revisionFilter(dispatchedRevisions(payloads))
  if (!filter) return
  await db.transaction(async (tx) => {
    await configureFileSearchTransaction(tx, {
      statementTimeout: FILE_SEARCH_DISPATCH_STATEMENT_TIMEOUT_MS,
      lockTimeout: FILE_SEARCH_DISPATCH_LOCK_TIMEOUT_MS,
      transactionTimeout: FILE_SEARCH_DISPATCH_TRANSACTION_TIMEOUT_MS,
    })
    const unclaimedByRun = tx
      .select({ fileId: workspaceFileSearchRevision.fileId })
      .from(workspaceFileSearchRevision)
      .where(
        and(
          filter,
          eq(workspaceFileSearchRevision.status, 'pending'),
          isNotNull(workspaceFileSearchRevision.handoffExpiresAt)
        )
      )
      .for('update', { skipLocked: true })
    await tx
      .update(workspaceFileSearchRevision)
      .set({ handoffExpiresAt: null })
      .where(inArray(workspaceFileSearchRevision.fileId, unclaimedByRun))
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
  if (prepared.abandonedClaims > 0) {
    logger.warn('Released workspace file search claims with no run known to exist', {
      claims: prepared.abandonedClaims,
    })
  }
  if (!prepared.lockAcquired || prepared.payloads.length === 0) {
    return {
      dispatchedFiles: 0,
      backfilledFiles: prepared.backfilledFiles,
      reapedClaims: prepared.reapedClaims,
      abandonedClaims: prepared.abandonedClaims,
      lockAcquired: prepared.lockAcquired,
    }
  }
  let dispatchedFiles: number
  try {
    dispatchedFiles = await runDispatchPhase('enqueue', () =>
      dispatchPreparedJobs(prepared.payloads)
    )
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
  /**
   * The runs exist whether or not this write lands, so its failure is only logged. A claim whose run
   * has not begun by the deadline is then released, and its token fences out the run it already has.
   */
  await runDispatchPhase('handoff', () => completeDispatchHandoff(prepared.payloads)).catch(
    () => undefined
  )
  return {
    dispatchedFiles,
    backfilledFiles: prepared.backfilledFiles,
    reapedClaims: prepared.reapedClaims,
    abandonedClaims: prepared.abandonedClaims,
    lockAcquired: prepared.lockAcquired,
  }
}
