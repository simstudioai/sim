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

/**
 * Depth of every descendant of `rootId`, keyed by folder id. A direct child is
 * depth 1; `rootId` itself is never included.
 *
 * `rootId` of `null` walks from the workspace root, so top-level folders are the
 * depth-1 children. {@link indexFolderChildren} deliberately omits parentless
 * folders, so those roots are seeded here rather than by widening the index and
 * changing what every other caller sees.
 *
 * Walking `parentId` rather than comparing path strings is what keeps this
 * correct for free: `/a/b` and `/a/bc` share a textual prefix but not a parent,
 * and the two folder surfaces encode paths differently (percent-encoded for
 * knowledge and tables, backslash-escaped for workspace files) while both store
 * the same `parentId`.
 *
 * Cycles terminate on `seen`, matching {@link collectDescendantFolderIdsFrom} —
 * the database permits one between constraint checks.
 */
export function collectFolderDepths(
  folders: readonly FolderNode[],
  rootId: string | null,
  options?: { maxDepth?: number }
): Map<string, number> {
  const maxDepth = options?.maxDepth ?? Number.POSITIVE_INFINITY
  const depths = new Map<string, number>()
  if (maxDepth < 1) return depths

  const childrenByParent = indexFolderChildren(folders)
  const seed =
    rootId === null
      ? folders.filter((folder) => !folder.parentId).map((folder) => folder.id)
      : (childrenByParent.get(rootId) ?? [])

  const seen = new Set<string>(rootId === null ? [] : [rootId])
  let level = seed.filter((id) => !seen.has(id))
  for (let depth = 1; depth <= maxDepth && level.length > 0; depth++) {
    const next: string[] = []
    for (const id of level) {
      if (seen.has(id)) continue
      seen.add(id)
      depths.set(id, depth)
      next.push(...(childrenByParent.get(id) ?? []))
    }
    level = next
  }

  return depths
}

/**
 * Narrows already-queried rows to the subtree under `rootId`, preserving the
 * query's ordering so a caller's `sortBy` still decides the result order.
 *
 * `tree` is the workspace's full folder set, deliberately separate from `rows`:
 * depths must come from the real hierarchy, or a `search` that excludes an
 * intermediate folder would orphan its matching descendants.
 */
export function selectFolderSubtreeRows<Row extends { id: string }>(
  rows: readonly Row[],
  tree: readonly FolderNode[],
  rootId: string | null,
  maxDepth?: number
): Row[] {
  const depths = collectFolderDepths(tree, rootId, { maxDepth })
  return rows.filter((row) => depths.has(row.id))
}
