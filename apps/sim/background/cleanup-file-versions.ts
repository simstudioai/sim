import { dbFor } from '@sim/db'
import { workspaceFileVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { task } from '@trigger.dev/sdk'
import { and, count, gt, inArray, isNotNull, lt, min, or, sql } from 'drizzle-orm'
import type { CleanupJobPayload } from '@/lib/billing/cleanup-dispatcher'
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_DELETE_CHUNK_SIZE,
  DEFAULT_MAX_BATCHES_PER_TABLE,
  DEFAULT_WORKSPACE_CHUNK_SIZE,
} from '@/lib/cleanup/batch-delete'
import { retentionCleanupQueue } from '@/lib/cleanup/queue'
import { enqueueWorkspaceFileStorageCleanups } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import { MAX_SUPERSEDED_FILE_VERSIONS } from '@/lib/uploads/contexts/workspace/workspace-file-versions'

const logger = createLogger('CleanupFileVersions')

/** All cleanup queries run on the dedicated cleanup pool. */
const cleanupDb = dbFor('cleanup')

/** Candidate files whose histories are ranked in one query. */
const FILES_PER_QUERY = 500

/**
 * Bounds one run like the other cleanup jobs: {@link DEFAULT_MAX_BATCHES_PER_TABLE} batches per
 * workspace chunk and this many versions overall. The next run resumes where this one stopped.
 */
const MAX_VERSIONS_PER_RUN = DEFAULT_BATCH_SIZE * DEFAULT_MAX_BATCHES_PER_TABLE

/**
 * Superseded versions a free file keeps (its newest 100 with the current one); versions beyond it
 * are pruned whatever their age. Paid plans are bounded only by the inline write-time ceiling.
 */
const FREE_MAX_SUPERSEDED_VERSIONS = 99

/**
 * Newest superseded versions retention never prunes, whatever their age, so a file always keeps its
 * newest ten versions with the current one.
 */
const KEEP_SUPERSEDED = 9

/**
 * Files in the group that can lose any version: more superseded versions than the keep-latest floor,
 * and either one older than the cutoff or more than the plan allows. Ranking only these keeps the
 * sort to the histories that need pruning instead of every superseded row in the group.
 */
async function selectCandidateFileIds(
  workspaceIds: string[],
  cutoff: Date,
  maxSuperseded: number
): Promise<string[]> {
  const rows = await cleanupDb
    .select({ fileId: workspaceFileVersion.fileId })
    .from(workspaceFileVersion)
    .where(
      and(
        inArray(workspaceFileVersion.workspaceId, workspaceIds),
        isNotNull(workspaceFileVersion.supersededAt)
      )
    )
    .groupBy(workspaceFileVersion.fileId)
    .having(
      and(
        gt(count(), KEEP_SUPERSEDED),
        or(
          lt(
            min(workspaceFileVersion.supersededAt),
            sql.param(cutoff, workspaceFileVersion.supersededAt)
          ),
          gt(count(), maxSuperseded)
        )
      )
    )
  return rows.map((row) => row.fileId)
}

/**
 * Superseded versions of the given files past retention: older than the cutoff or beyond the plan's
 * count, but never among the newest {@link KEEP_SUPERSEDED} superseded versions of a file.
 */
function selectExpiredVersions(
  fileIds: string[],
  cutoff: Date,
  maxSuperseded: number,
  batchSize: number
) {
  const ranked = cleanupDb
    .select({
      id: workspaceFileVersion.id,
      supersededAt: workspaceFileVersion.supersededAt,
      rank: sql<number>`row_number() over (partition by ${workspaceFileVersion.fileId} order by ${workspaceFileVersion.version} desc)`.as(
        'rank'
      ),
    })
    .from(workspaceFileVersion)
    .where(
      and(
        inArray(workspaceFileVersion.fileId, fileIds),
        isNotNull(workspaceFileVersion.supersededAt)
      )
    )
    .as('ranked')

  return cleanupDb
    .select({ id: ranked.id })
    .from(ranked)
    .where(
      and(
        gt(ranked.rank, KEEP_SUPERSEDED),
        or(lt(ranked.supersededAt, cutoff), gt(ranked.rank, maxSuperseded))
      )
    )
    .limit(batchSize)
}

/**
 * Deletes the expired version rows and enqueues their stored objects on the storage-cleanup outbox
 * in the same transaction, so a row never outlives its release and every released object is
 * deleted durably — the outbox retries failures and treats an already-missing object as done.
 */
function deleteVersions(rows: Array<{ id: string }>): Promise<number> {
  return cleanupDb.transaction(async (tx) => {
    const removed = await tx
      .delete(workspaceFileVersion)
      .where(
        and(
          inArray(
            workspaceFileVersion.id,
            rows.map((row) => row.id)
          ),
          isNotNull(workspaceFileVersion.supersededAt)
        )
      )
      .returning({ key: workspaceFileVersion.key })
    await enqueueWorkspaceFileStorageCleanups(
      tx,
      removed.map((row) => row.key)
    )
    return removed.length
  })
}

export async function runCleanupFileVersions(payload: CleanupJobPayload): Promise<void> {
  const startTime = Date.now()
  const { workspaceIds, retentionHours, label, plan } = payload
  if (workspaceIds.length === 0) {
    logger.info(`[${label}] No workspaces to process`)
    return
  }

  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000)
  const maxSuperseded =
    plan === 'free' ? FREE_MAX_SUPERSEDED_VERSIONS : MAX_SUPERSEDED_FILE_VERSIONS
  logger.info(
    `[${label}] Processing ${workspaceIds.length} workspaces, cutoff: ${cutoff.toISOString()}`
  )

  let deleted = 0
  let attempted = 0
  for (const group of chunkArray(workspaceIds, DEFAULT_WORKSPACE_CHUNK_SIZE)) {
    if (attempted >= MAX_VERSIONS_PER_RUN) break
    const candidates = await selectCandidateFileIds(group, cutoff, maxSuperseded)
    let batches = 0
    for (const fileIds of chunkArray(candidates, FILES_PER_QUERY)) {
      let exhausted = false
      while (
        !exhausted &&
        batches < DEFAULT_MAX_BATCHES_PER_TABLE &&
        attempted < MAX_VERSIONS_PER_RUN
      ) {
        batches++
        const batchSize = Math.min(DEFAULT_DELETE_CHUNK_SIZE, MAX_VERSIONS_PER_RUN - attempted)
        const expired = await selectExpiredVersions(fileIds, cutoff, maxSuperseded, batchSize)
        attempted += expired.length
        const removed = expired.length > 0 ? await deleteVersions(expired) : 0
        deleted += removed
        exhausted = expired.length < batchSize || removed === 0
      }
      if (!exhausted) break
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  logger.info(`[${label}] File version cleanup: ${deleted} released in ${elapsed}s`)
}

export const cleanupFileVersionsTask = task({
  id: 'cleanup-file-versions',
  machine: 'large-1x',
  queue: retentionCleanupQueue,
  retry: { maxAttempts: 1 },
  run: runCleanupFileVersions,
})
