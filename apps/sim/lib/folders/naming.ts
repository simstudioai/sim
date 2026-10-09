import type { db } from '@sim/db'
import { folder as folderTable } from '@sim/db/schema'
import { truncateAtCodePoint } from '@sim/utils/string'
import { and, eq, isNull } from 'drizzle-orm'
import type { FolderResourceType } from '@/lib/api/contracts/folders'

type DbOrTx = Pick<typeof db, 'select'>

/**
 * Returns `requestedName`, or the first `"<name> (N)"` variant not already taken by an
 * active sibling under `parentId`.
 *
 * The generic `folder` table has a partial unique index on active
 * `(workspaceId, resourceType, parentId, name)`, so any path that makes a row active with a
 * caller-supplied name has to either dedup here or handle a 23505. Use this where the user
 * has no opportunity to choose a different name (duplicate, restore); return a conflict
 * instead where they do (create, rename).
 *
 * The `" (N)"` shape deliberately matches both the client-side dedup in
 * `nextUntitledFolderName` and the backfill in migration 0272, so a deduped name reads the
 * same however it was produced.
 * An optional length cap reserves room for the suffix without splitting Unicode pairs;
 * callers still validate the requested name before attempting a mutation.
 */
export async function deduplicateFolderName(
  tx: DbOrTx,
  workspaceId: string,
  parentId: string | null,
  requestedName: string,
  resourceType: FolderResourceType,
  maxLength?: number
): Promise<string> {
  const siblingRows = await tx
    .select({ name: folderTable.name })
    .from(folderTable)
    .where(
      and(
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, resourceType),
        parentId ? eq(folderTable.parentId, parentId) : isNull(folderTable.parentId),
        isNull(folderTable.deletedAt)
      )
    )

  const siblingNames = new Set(siblingRows.map((row) => row.name))
  if (!siblingNames.has(requestedName)) return requestedName

  let suffix = 1
  while (true) {
    const ending = ` (${suffix})`
    if (maxLength !== undefined && ending.length >= maxLength) {
      throw new Error('Folder name limit cannot accommodate a unique suffix')
    }
    const stem =
      maxLength === undefined
        ? requestedName
        : truncateAtCodePoint(requestedName, maxLength - ending.length, '')
    const candidate = `${stem}${ending}`
    if (!siblingNames.has(candidate)) return candidate
    suffix += 1
  }
}
