import { db } from '@sim/db'
import { sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { MAX_FOLDER_PATH_SEGMENTS } from '@/lib/folders/paths'

interface FolderAncestor {
  id: string
  name: string
  parentId: string | null
}

/** Reads at most one bounded ancestry chain, failing closed on missing, archived, or cyclic parents. */
export async function readActiveFolderAncestry(
  workspaceId: string,
  folderId: string,
  executor: DbOrTx = db
): Promise<FolderAncestor[] | null> {
  const rows = await executor.execute<
    FolderAncestor & { depth: number } & Record<string, unknown>
  >(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_id, 1 AS depth, ARRAY[id] AS visited
      FROM folder
      WHERE id = ${folderId} AND workspace_id = ${workspaceId}
        AND resource_type = 'file' AND deleted_at IS NULL
      UNION ALL
      SELECT parent.id, parent.name, parent.parent_id, child.depth + 1,
        child.visited || parent.id
      FROM folder parent
      JOIN ancestors child ON parent.id = child.parent_id
      WHERE parent.workspace_id = ${workspaceId} AND parent.resource_type = 'file'
        AND parent.deleted_at IS NULL AND child.depth < ${MAX_FOLDER_PATH_SEGMENTS}
        AND NOT parent.id = ANY(child.visited)
    )
    SELECT id, name, parent_id AS "parentId", depth FROM ancestors ORDER BY depth DESC
  `)
  if (!rows.length || rows[0].parentId !== null) return null
  return rows.map(({ id, name, parentId }) => ({ id, name, parentId }))
}
