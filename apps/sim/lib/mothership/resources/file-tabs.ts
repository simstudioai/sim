import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { and, inArray, notInArray } from 'drizzle-orm'

/** Row contexts that open as a file tab: workspace files and chat uploads. */
const FILE_TAB_CONTEXTS = ['workspace', 'mothership']

/**
 * The ids among `fileIds` whose rows must not open as a file tab: any context other than a
 * workspace file or chat upload belongs to another resource (a test's source, for one), which
 * opens as that resource instead.
 */
export async function findNonTabFileIds(fileIds: string[]): Promise<Set<string>> {
  if (fileIds.length === 0) return new Set()
  const rows = await db
    .select({ id: workspaceFiles.id })
    .from(workspaceFiles)
    .where(
      and(
        inArray(workspaceFiles.id, fileIds),
        notInArray(workspaceFiles.context, FILE_TAB_CONTEXTS)
      )
    )
  return new Set(rows.map((row) => row.id))
}
