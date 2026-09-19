import { dbFor } from '@sim/db'
import { workspaceFileVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { task } from '@trigger.dev/sdk'
import { and, count, gt, inArray, isNotNull, lt, min, or, sql } from 'drizzle-orm'
import type { CleanupJobPayload } from '@/lib/billing/cleanup-dispatcher'
import {
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
function selectExpiredVersions(fileIds: string[], cutoff: Date, maxSuperseded: number) {
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
    .limit(DEFAULT_DELETE_CHUNK_SIZE)
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
  for (const group of chunkArray(workspaceIds, DEFAULT_WORKSPACE_CHUNK_SIZE)) {
    const candidates = await selectCandidateFileIds(group, cutoff, maxSuperseded)
    for (const fileIds of chunkArray(candidates, FILES_PER_QUERY)) {
      for (let batch = 0; batch < DEFAULT_MAX_BATCHES_PER_TABLE; batch++) {
        const expired = await selectExpiredVersions(fileIds, cutoff, maxSuperseded)
        if (expired.length === 0) break
        const removed = await deleteVersions(expired)
        deleted += removed
        if (expired.length < DEFAULT_DELETE_CHUNK_SIZE || removed === 0) break
      }
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
