import type { db } from '@sim/db'
import { workspaceFileVersion } from '@sim/db/schema'
import { and, gt, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import { enqueueWorkspaceFileStorageCleanups } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'

/** Always retain the current head and its newest nine predecessors. */
export const KEEP_SUPERSEDED = 9
export const FILES_PER_QUERY = 500

/** Rank each file independently; expiry never removes its protected recent history. */
export function selectExpiredFileVersions(
  executor: Pick<typeof db, 'select'>,
  fileIds: string[],
  cutoff: Date,
  maxSuperseded: number,
  limit: number
) {
  const ranked = executor
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
  return executor
    .select({ id: ranked.id })
    .from(ranked)
    .where(
      and(
        gt(ranked.rank, KEEP_SUPERSEDED),
        or(lt(ranked.supersededAt, cutoff), gt(ranked.rank, maxSuperseded))
      )
    )
    .limit(limit)
}

/** Release history and its storage-cleanup intent in the caller's existing transaction. */
export async function releaseExpiredFileVersions(
  tx: DbTransaction,
  rows: Array<{ id: string }>,
  context: 'workspace' | 'project'
): Promise<number> {
  if (!rows.length) return 0
  const removed = await tx
    .delete(workspaceFileVersion)
    .where(
      and(
        inArray(
          workspaceFileVersion.id,
          rows.map(({ id }) => id)
        ),
        isNotNull(workspaceFileVersion.supersededAt)
      )
    )
    .returning({ key: workspaceFileVersion.key })
  await enqueueWorkspaceFileStorageCleanups(
    tx,
    removed.map(({ key }) => key),
    context === 'workspace' ? undefined : context
  )
  return removed.length
}
