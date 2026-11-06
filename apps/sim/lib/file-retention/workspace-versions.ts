import { dbFor } from '@sim/db'
import { workspaceFiles, workspaceFileVersion } from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { and, asc, count, gt, inArray, isNotNull, lt, min, or, sql } from 'drizzle-orm'
import {
  DEFAULT_DELETE_CHUNK_SIZE,
  DEFAULT_MAX_BATCHES_PER_TABLE,
  DEFAULT_WORKSPACE_CHUNK_SIZE,
} from '@/lib/cleanup/batch-delete'
import type { FileRetentionOptions, FileVersionCleanupResult } from '@/lib/file-retention/types'
import {
  FILES_PER_QUERY,
  FREE_MAX_SUPERSEDED_VERSIONS,
  KEEP_SUPERSEDED,
  releaseExpiredFileVersions,
  selectExpiredFileVersions,
} from '@/lib/file-retention/versions'
import { MAX_SUPERSEDED_FILE_VERSIONS } from '@/lib/uploads/contexts/workspace/file-version-store'

const cleanupDb = dbFor('cleanup')

async function selectCandidateFileIds(
  workspaceIds: string[],
  cutoff: Date,
  maxSuperseded: number,
  afterId: string
): Promise<string[]> {
  const rows = await cleanupDb
    .select({ fileId: workspaceFileVersion.fileId })
    .from(workspaceFileVersion)
    .where(
      and(
        inArray(workspaceFileVersion.workspaceId, workspaceIds),
        isNotNull(workspaceFileVersion.supersededAt),
        gt(workspaceFileVersion.fileId, afterId)
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
    .orderBy(asc(workspaceFileVersion.fileId))
    .limit(FILES_PER_QUERY)
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
    let batches = 0
    let afterId = ''
    while (batches < DEFAULT_MAX_BATCHES_PER_TABLE && attempted < limit) {
      const fileIds = await selectCandidateFileIds(group, cutoff, maxSuperseded, afterId)
      if (fileIds.length === 0) break
      afterId = fileIds[fileIds.length - 1]
      let exhausted = false
      while (!exhausted && batches < DEFAULT_MAX_BATCHES_PER_TABLE && attempted < limit) {
        batches++
        const batchSize = Math.min(DEFAULT_DELETE_CHUNK_SIZE, limit - attempted)
        const { selected, removed } = await cleanupDb.transaction(async (tx) => {
          const locked = await tx
            .select({ id: workspaceFiles.id })
            .from(workspaceFiles)
            .where(
              and(inArray(workspaceFiles.id, fileIds), inArray(workspaceFiles.workspaceId, group))
            )
            .orderBy(asc(workspaceFiles.id))
            .for('update')
          if (!locked.length) return { selected: 0, removed: 0 }
          const expired = await selectExpiredFileVersions(
            tx,
            locked.map(({ id }) => id),
            cutoff,
            maxSuperseded,
            batchSize
          )
          return {
            selected: expired.length,
            removed: await releaseExpiredFileVersions(tx, expired, 'workspace'),
          }
        })
        attempted += selected
        deleted += removed
        exhausted = selected < batchSize || removed === 0
      }
      if (!exhausted) break
    }
  }

  return { deleted, attempted }
}
