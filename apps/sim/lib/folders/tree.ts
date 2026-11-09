/** The minimum a node must expose to be walked upward. */
export interface FolderAncestorNode {
  id: string
  parentId: string | null
}

/**
 * Root-first ancestor chain of `folderId`, that folder last. The one upward walk in the app —
 * every folder path, breadcrumb trail, and drop-target check goes through it.
 *
 * `lookup` rather than a fixed container because the folder index exists in three shapes
 * (a `Record` from `useFolderMap`, a `Map` built by `useFolderAncestors`, the Files tree's own
 * rows), and generic over the node so callers keep their own row type.
 *
 * Truncates at the first unresolvable link, returning what it walked. `visited` is not
 * defensive padding: the client folder map is written optimistically by `useReorderFolders`,
 * which sets `parentId` without validating the result, so a cycle is reachable in cache even
 * though the server rejects one. Without the guard this loops forever and hangs the tab.
 */
export function folderAncestorChain<T extends FolderAncestorNode>(
  folderId: string | null | undefined,
  lookup: (id: string) => T | undefined
): T[] {
  const chain: T[] = []
  const visited = new Set<string>()
  let currentId: string | null | undefined = folderId

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const folder = lookup(currentId)
    if (!folder) break
    chain.unshift(folder)
    currentId = folder.parentId
  }

  return chain
}
