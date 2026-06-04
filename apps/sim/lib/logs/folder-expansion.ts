import { db } from '@sim/db'
import { workflowFolder } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'

/**
 * Expands a CSV of selected folder IDs to include every descendant folder in the
 * workspace, so that filtering by a parent folder also matches workflows that
 * live in nested subfolders.
 *
 * Returns the original CSV when there are no descendants (or when the input is
 * empty / undefined). Unknown IDs are preserved so the caller's `inArray` check
 * behaves the same as today (matches nothing).
 *
 * Server-only: pulls in the database client. Keep separate from `filters.ts`
 * (imported by client hooks) to avoid leaking postgres into the browser bundle.
 */
export async function expandFolderIdsWithDescendants(
  workspaceId: string,
  folderIdsCsv: string | undefined
): Promise<string | undefined> {
  if (!folderIdsCsv) return folderIdsCsv
  const seedIds = folderIdsCsv.split(',').filter(Boolean)
  if (seedIds.length === 0) return folderIdsCsv

  const rows = await db
    .select({ id: workflowFolder.id, parentId: workflowFolder.parentId })
    .from(workflowFolder)
    .where(and(eq(workflowFolder.workspaceId, workspaceId), isNull(workflowFolder.archivedAt)))

  const childrenByParent = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.parentId) continue
    const list = childrenByParent.get(row.parentId)
    if (list) list.push(row.id)
    else childrenByParent.set(row.parentId, [row.id])
  }

  const expanded = new Set<string>(seedIds)
  const queue = [...seedIds]
  while (queue.length > 0) {
    const current = queue.pop() as string
    const children = childrenByParent.get(current)
    if (!children) continue
    for (const childId of children) {
      if (!expanded.has(childId)) {
        expanded.add(childId)
        queue.push(childId)
      }
    }
  }

  return Array.from(expanded).join(',')
}
