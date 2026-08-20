import {
  type SortableResource,
  sortResources,
} from '@/app/workspace/[workspaceId]/components/folders/resource-sort'

/** A folder row a resource flyout can render, from any foldered workspace surface. */
interface FlyoutFolderSource {
  id: string
  name: string
  parentId: string | null
  updatedAt: Date | string
}

/** A resource row a flyout can render, from any foldered workspace surface. */
interface FlyoutItemSource {
  id: string
  name: string
  folderId?: string | null
  updatedAt: Date | string
}

/** One row of a resource flyout: a folder that recurses, or a linked resource. */
export type FlyoutEntry =
  | { kind: 'folder'; id: string; name: string; children: FlyoutEntry[] }
  | { kind: 'item'; id: string; name: string; href: string }

export interface BuildFlyoutEntriesParams<Item extends FlyoutItemSource> {
  folders: FlyoutFolderSource[]
  items: Item[]
  pinnedFolderIds: ReadonlySet<string>
  pinnedItemIds: ReadonlySet<string>
  hrefForItem: (item: Item) => string
}

function flyoutSortTime(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

/**
 * Builds the ordered row tree a foldered resource's flyout renders.
 *
 * Each level is sorted by the shared {@link sortResources}, on the most-recently-updated
 * key its list page defaults to — so pinned rows float, folders interleave with the
 * resources beside them, and the flyout keeps reading in the same order as the page it
 * links into rather than carrying a second copy of that rule.
 *
 * A folder whose parent no longer exists, and a resource whose `folderId` names no live
 * folder, surface at the root — the same fallback the list pages apply when a folder is
 * archived out from under its contents, so neither goes unreachable. A folder only
 * reachable through a parent cycle is dropped, as it is by the sidebar's folder tree: the
 * client folder cache is written optimistically, so a cycle is reachable there even though
 * the server rejects one, and descending it would hang the tab.
 */
export function buildFlyoutEntries<Item extends FlyoutItemSource>({
  folders,
  items,
  pinnedFolderIds,
  pinnedItemIds,
  hrefForItem,
}: BuildFlyoutEntriesParams<Item>): FlyoutEntry[] {
  const folderIds = new Set(folders.map((folder) => folder.id))

  const foldersByParent = new Map<string | null, FlyoutFolderSource[]>()
  for (const folder of folders) {
    const parentId = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : null
    const siblings = foldersByParent.get(parentId)
    if (siblings) siblings.push(folder)
    else foldersByParent.set(parentId, [folder])
  }

  const itemsByFolder = new Map<string | null, Item[]>()
  for (const item of items) {
    const folderId = item.folderId && folderIds.has(item.folderId) ? item.folderId : null
    const siblings = itemsByFolder.get(folderId)
    if (siblings) siblings.push(item)
    else itemsByFolder.set(folderId, [item])
  }

  const buildLevel = (parentId: string | null): FlyoutEntry[] => {
    const rows: SortableResource<FlyoutEntry>[] = []
    for (const folder of foldersByParent.get(parentId) ?? []) {
      rows.push({
        item: { kind: 'folder', id: folder.id, name: folder.name, children: buildLevel(folder.id) },
        pinned: pinnedFolderIds.has(folder.id),
        name: folder.name,
        key: flyoutSortTime(folder.updatedAt),
      })
    }
    for (const item of itemsByFolder.get(parentId) ?? []) {
      rows.push({
        item: { kind: 'item', id: item.id, name: item.name, href: hrefForItem(item) },
        pinned: pinnedItemIds.has(item.id),
        name: item.name,
        key: flyoutSortTime(item.updatedAt),
      })
    }
    return sortResources(rows, 'desc').map((row) => row.item)
  }

  return buildLevel(null)
}
