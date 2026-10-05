import { dbFor } from '@sim/db'
import { workspaceFileVersion } from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { and, count, gt, inArray, isNotNull, lt, min, or, sql } from 'drizzle-orm'
import {
  DEFAULT_DELETE_CHUNK_SIZE,
  DEFAULT_MAX_BATCHES_PER_TABLE,
  DEFAULT_WORKSPACE_CHUNK_SIZE,
} from '@/lib/cleanup/batch-delete'
import type { FileRetentionOptions, FileVersionCleanupResult } from '@/lib/file-retention/types'
import {
  FILES_PER_QUERY,
  KEEP_SUPERSEDED,
  releaseExpiredFileVersions,
  selectExpiredFileVersions,
} from '@/lib/file-retention/versions'
import { MAX_SUPERSEDED_FILE_VERSIONS } from '@/lib/uploads/contexts/workspace/workspace-file-versions'

const cleanupDb = dbFor('cleanup')
const FREE_MAX_SUPERSEDED_VERSIONS = 99

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

/** Preserve workspace batching and the queued workspace retention policy. */
export async function cleanupWorkspaceFileVersions(
  workspaceIds: string[],
  { cutoff, plan }: FileRetentionOptions,
  limit: number
): Promise<FileVersionCleanupResult> {
  const maxSuperseded =
    plan === 'free' ? FREE_MAX_SUPERSEDED_VERSIONS : MAX_SUPERSEDED_FILE_VERSIONS
  let deleted = 0
  let attempted = 0
  for (const group of chunkArray(workspaceIds, DEFAULT_WORKSPACE_CHUNK_SIZE)) {
    if (attempted >= limit) break
    const candidates = await selectCandidateFileIds(group, cutoff, maxSuperseded)
    let batches = 0
    for (const fileIds of chunkArray(candidates, FILES_PER_QUERY)) {
      let exhausted = false
      while (!exhausted && batches < DEFAULT_MAX_BATCHES_PER_TABLE && attempted < limit) {
        batches++
        const batchSize = Math.min(DEFAULT_DELETE_CHUNK_SIZE, limit - attempted)
        const expired = await selectExpiredFileVersions(
          cleanupDb,
          fileIds,
          cutoff,
          maxSuperseded,
          batchSize
        )
        attempted += expired.length
        const removed =
          expired.length > 0
            ? await cleanupDb.transaction((tx) =>
                releaseExpiredFileVersions(tx, expired, 'workspace')
              )
            : 0
        deleted += removed
        exhausted = expired.length < batchSize || removed === 0
      }
      if (!exhausted) break
    }
  }

  return { deleted, attempted }
}
