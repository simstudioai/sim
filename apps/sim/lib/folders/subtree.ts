/** Minimal shape needed to walk a folder hierarchy — any row with an id and a parent. */
export interface FolderNode {
  id: string
  parentId: string | null
}

/** Child ids keyed by parent id — the shape a descendant walk reads. */
export type FolderChildrenIndex = ReadonlyMap<string, string[]>

/**
 * Indexes a flat folder list by parent id.
 *
 * Exported so a caller walking many folders of the same list builds the index
 * once instead of once per folder: {@link collectDescendantFolderIds} rebuilds
 * it on every call, which is O(rows) each time, and a workspace's tree is
 * bounded only by `MAX_FOLDERS_PER_WORKSPACE`.
 */
export function indexFolderChildren(folders: Iterable<FolderNode>): FolderChildrenIndex {
  const childrenByParent = new Map<string, string[]>()

  for (const folder of folders) {
    if (!folder.parentId) continue
    const children = childrenByParent.get(folder.parentId)
    if (children) children.push(folder.id)
    else childrenByParent.set(folder.parentId, [folder.id])
  }

  return childrenByParent
}

/**
 * Returns every descendant of `folderId` from a prebuilt {@link FolderChildrenIndex},
 * excluding `folderId` itself.
 *
 * Tracks `seen` so a cycle (which the DB permits between constraint checks) terminates the
 * walk instead of recursing forever.
 */
export function collectDescendantFolderIdsFrom(
  childrenByParent: FolderChildrenIndex,
  folderId: string
): string[] {
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

/**
 * Returns every descendant of `folderId` from a flat folder list, excluding `folderId`
 * itself. The caller supplies the rows, so this stays a pure function usable against a
 * query result, a transaction snapshot, or test fixtures.
 *
 * Indexes children by parent once up front rather than rescanning the list per level. A
 * caller resolving descendants for several folders of the SAME list should index once with
 * {@link indexFolderChildren} and walk with {@link collectDescendantFolderIdsFrom} instead,
 * so the index is not rebuilt and discarded per folder.
 */
export function collectDescendantFolderIds(folders: FolderNode[], folderId: string): string[] {
  return collectDescendantFolderIdsFrom(indexFolderChildren(folders), folderId)
}
