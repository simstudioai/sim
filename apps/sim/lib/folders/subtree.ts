/** Minimal shape needed to walk a folder hierarchy — any row with an id and a parent. */
export interface FolderNode {
  id: string
  parentId: string | null
}

/**
 * Returns every descendant of `folderId` from a flat folder list, excluding `folderId`
 * itself. The caller supplies the rows, so this stays a pure function usable against a
 * query result, a transaction snapshot, or test fixtures.
 *
 * Indexes children by parent once up front rather than rescanning the list per level, and
 * tracks `seen` so a cycle (which the DB permits between constraint checks) terminates the
 * walk instead of recursing forever.
 */
export function collectDescendantFolderIds(folders: FolderNode[], folderId: string): string[] {
  const childrenByParent = new Map<string, string[]>()

  for (const folder of folders) {
    if (!folder.parentId) continue
    const children = childrenByParent.get(folder.parentId)
    if (children) children.push(folder.id)
    else childrenByParent.set(folder.parentId, [folder.id])
  }

  const descendants: string[] = []
  const seen = new Set([folderId])

  const visit = (id: string) => {
    for (const childId of childrenByParent.get(id) ?? []) {
      if (seen.has(childId)) continue
      seen.add(childId)
      descendants.push(childId)
      visit(childId)
    }
  }
  visit(folderId)

  return descendants
}
