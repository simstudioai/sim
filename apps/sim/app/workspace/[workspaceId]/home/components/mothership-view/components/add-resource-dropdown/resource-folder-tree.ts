export type AvailableItem = { id: string; name: string; [key: string]: unknown }

export type ResourceTreeNode =
  | { kind: 'item'; id: string; item: AvailableItem }
  | { kind: 'folder'; id: string; name: string; children: ResourceTreeNode[] }

export interface BuildResourceFolderTreeOptions {
  /**
   * Interleave folders and items at each level by their `sortOrder`, mirroring
   * the workflow sidebar's manual ordering. Otherwise folders come first, then
   * items, each in source order.
   */
  orderBySortOrder?: boolean
  /**
   * Drop folders holding no items at any depth. Callers derive this from
   * whether the folder is selectable: one the user cannot select is dead UI
   * when empty, while a selectable one must stay reachable.
   */
  pruneEmpty?: boolean
}

/**
 * Nests flat item and folder lists into the hierarchy the browse menus render.
 * Shared by every foldered resource family (workflows, files, tables, knowledge
 * bases); the families differ only in the options above and in whether the
 * caller renders folders as selectable.
 *
 * Items and folders whose parent does not resolve to a known folder surface at
 * the root rather than vanishing, matching how the resource pages heal orphans.
 * Folders forming a parent cycle resolve to no root-reachable parent and are
 * therefore skipped, so the walk always terminates.
 */
export function buildResourceFolderTree(
  items: AvailableItem[],
  folders: AvailableItem[],
  options?: BuildResourceFolderTreeOptions
): ResourceTreeNode[] {
  const knownFolderIds = new Set(folders.map((folder) => folder.id))

  const parentOf = (entry: AvailableItem, key: 'parentId' | 'folderId'): string | null => {
    const id = (entry[key] as string | null | undefined) ?? null
    return id && knownFolderIds.has(id) ? id : null
  }

  const bucket = (
    map: Map<string | null, AvailableItem[]>,
    key: string | null,
    value: AvailableItem
  ) => {
    const existing = map.get(key)
    if (existing) existing.push(value)
    else map.set(key, [value])
  }

  const foldersByParent = new Map<string | null, AvailableItem[]>()
  for (const folder of folders) bucket(foldersByParent, parentOf(folder, 'parentId'), folder)

  const itemsByFolder = new Map<string | null, AvailableItem[]>()
  for (const item of items) bucket(itemsByFolder, parentOf(item, 'folderId'), item)

  const sortOrderOf = (entry: AvailableItem) => (entry.sortOrder as number | undefined) ?? 0

  const buildLevel = (parentId: string | null): ResourceTreeNode[] => {
    const childFolders = foldersByParent.get(parentId) ?? []
    const childItems = itemsByFolder.get(parentId) ?? []

    // Folders first, then items — the default order. `sources[i]` is the record
    // `nodes[i]` was built from; the sort below permutes by index against that
    // pairing.
    const sources: AvailableItem[] = []
    const nodes: ResourceTreeNode[] = []

    for (const folder of childFolders) {
      const children = buildLevel(folder.id)
      if (options?.pruneEmpty && children.length === 0) continue
      sources.push(folder)
      nodes.push({ kind: 'folder', id: folder.id, name: folder.name, children })
    }
    for (const item of childItems) {
      sources.push(item)
      nodes.push({ kind: 'item', id: item.id, item })
    }

    if (!options?.orderBySortOrder) return nodes

    return nodes
      .map((_, index) => index)
      .sort((a, b) => {
        const delta = sortOrderOf(sources[a]) - sortOrderOf(sources[b])
        return delta !== 0 ? delta : sources[a].id.localeCompare(sources[b].id)
      })
      .map((index) => nodes[index])
  }

  return buildLevel(null)
}
