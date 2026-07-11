/**
 * Pure subtree-walk algorithm shared by every folder cascade (generic
 * `folder` table cascades in `orchestration.ts`, and the file-folder-specific
 * cascades in `uploads/contexts/workspace/workspace-file-folder-manager.ts`).
 * Kept dependency-free (no `db` import) so both call sites — one of which is
 * imported *by* `orchestration.ts` — can share it without a circular import.
 */

/** Minimal shape required to walk a `parentId` chain. */
export interface FolderSubtreeRow {
  id: string
  parentId: string | null
}

/**
 * Given a flat list of folders and a root id, returns every descendant id
 * (NOT including the root itself) reachable by walking `parentId` links.
 * Guards against cycles via a `seen` set.
 */
export function collectDescendantFolderIds<T extends FolderSubtreeRow>(
  folders: T[],
  rootId: string
): string[] {
  const childrenByParent = new Map<string, string[]>()
  for (const folder of folders) {
    if (!folder.parentId) continue
    const children = childrenByParent.get(folder.parentId) ?? []
    children.push(folder.id)
    childrenByParent.set(folder.parentId, children)
  }

  const descendants: string[] = []
  const seen = new Set([rootId])
  const visit = (id: string) => {
    for (const childId of childrenByParent.get(id) ?? []) {
      if (seen.has(childId)) continue
      seen.add(childId)
      descendants.push(childId)
      visit(childId)
    }
  }
  visit(rootId)

  return descendants
}
