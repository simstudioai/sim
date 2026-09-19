import { dbFor } from '@sim/db'
import { workspaceFileVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { task } from '@trigger.dev/sdk'
import { and, count, gt, inArray, isNotNull, lt, min, or, sql } from 'drizzle-orm'
import type { CleanupJobPayload } from '@/lib/billing/cleanup-dispatcher'
import type { PlanCategory } from '@/lib/billing/plan-helpers'
import { DEFAULT_DELETE_CHUNK_SIZE } from '@/lib/cleanup/batch-delete'
import { retentionCleanupQueue } from '@/lib/cleanup/queue'
import { enqueueWorkspaceFileStorageCleanups } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import {
  FILE_VERSION_RETENTION_KEEP_LATEST,
  MAX_SUPERSEDED_FILE_VERSIONS,
} from '@/lib/uploads/contexts/workspace/workspace-file-versions'

const logger = createLogger('CleanupFileVersions')

/** All cleanup queries run on the dedicated cleanup pool. */
const cleanupDb = dbFor('cleanup')

/** Workspaces whose candidate files are found in one query. */
const WORKSPACES_PER_QUERY = 50
/** Candidate files whose histories are ranked in one query. */
const FILES_PER_QUERY = 500
const VERSIONS_PER_BATCH = 1000
/** Bounds one run's work per file chunk; the next daily run continues where this stopped. */
const MAX_BATCHES_PER_CHUNK = 50

/**
 * Most superseded versions a file keeps, per plan; any beyond it are pruned whatever their age. Free
 * keeps its newest 100 versions (the current one included); every other plan is bounded only by the
 * inline write-time ceiling.
 */
const MAX_SUPERSEDED_VERSIONS_BY_PLAN: Record<PlanCategory, number> = {
  free: 99,
  pro: MAX_SUPERSEDED_FILE_VERSIONS,
  team: MAX_SUPERSEDED_FILE_VERSIONS,
  enterprise: MAX_SUPERSEDED_FILE_VERSIONS,
}

/** Newest superseded versions a file keeps whatever their age (the current version is the tenth). */
const KEEP_SUPERSEDED = FILE_VERSION_RETENTION_KEEP_LATEST - 1

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
 * count, but never among the newest {@link FILE_VERSION_RETENTION_KEEP_LATEST} versions of a file.
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
    .limit(VERSIONS_PER_BATCH)
}

/**
 * Deletes the expired version rows and enqueues their stored objects on the storage-cleanup outbox
 * in the same transaction, so a row never outlives its release and every released object is
 * deleted durably — the outbox retries failures and treats an already-missing object as done.
 */
async function deleteVersions(rows: Array<{ id: string }>) {
  let deleted = 0
  for (const batch of chunkArray(rows, DEFAULT_DELETE_CHUNK_SIZE)) {
    deleted += await cleanupDb.transaction(async (tx) => {
      const removed = await tx
        .delete(workspaceFileVersion)
        .where(
          and(
            inArray(
              workspaceFileVersion.id,
              batch.map((row) => row.id)
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
  return deleted
}

export async function runCleanupFileVersions(payload: CleanupJobPayload): Promise<void> {
  const startTime = Date.now()
  const { workspaceIds, retentionHours, label, plan } = payload
  if (workspaceIds.length === 0) {
    logger.info(`[${label}] No workspaces to process`)
    return
  }

  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000)
  const maxSuperseded = MAX_SUPERSEDED_VERSIONS_BY_PLAN[plan]
  logger.info(
    `[${label}] Processing ${workspaceIds.length} workspaces, cutoff: ${cutoff.toISOString()}`
  )

  let deleted = 0
  for (const group of chunkArray(workspaceIds, WORKSPACES_PER_QUERY)) {
    const candidates = await selectCandidateFileIds(group, cutoff, maxSuperseded)
    for (const fileIds of chunkArray(candidates, FILES_PER_QUERY)) {
      for (let batch = 0; batch < MAX_BATCHES_PER_CHUNK; batch++) {
        const expired = await selectExpiredVersions(fileIds, cutoff, maxSuperseded)
        if (expired.length === 0) break
        const removed = await deleteVersions(expired)
        deleted += removed
        if (expired.length < VERSIONS_PER_BATCH || removed === 0) break
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
