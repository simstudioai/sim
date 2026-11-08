import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { toast } from '@/platform/shared/toast'

/** The part of a folder the list's helpers read; every resource tree's folder has it. */
export interface TreeFolder {
  id: string
  name: string
  parentId: string | null
  sortOrder?: number
}

/**
 * A list row's id: folders and resources share one selection, one menu handler and one drop
 * target, so a folder's id carries a prefix and a resource keeps its own.
 */
const FOLDER_ROW_PREFIX = 'folder:'

export function folderRowId(folderId: string) {
  return `${FOLDER_ROW_PREFIX}${folderId}`
}

export function parseRowId(rowId: string): { kind: 'folder' | 'resource'; id: string } {
  return rowId.startsWith(FOLDER_ROW_PREFIX)
    ? { kind: 'folder', id: rowId.slice(FOLDER_ROW_PREFIX.length) }
    : { kind: 'resource', id: rowId }
}

/** A selection of row ids, split into the two id lists every bulk operation takes. */
export function splitRowIds(rowIds: Iterable<string>) {
  const folderIds: string[] = []
  const resourceIds: string[] = []
  for (const rowId of rowIds) {
    const parsed = parseRowId(rowId)
    if (parsed.kind === 'folder') folderIds.push(parsed.id)
    else resourceIds.push(parsed.id)
  }
  return { folderIds, resourceIds }
}

/** Every folder's transitive descendants, so a folder never moves into its own subtree. */
export function descendantIndex(folders: readonly TreeFolder[]): Map<string, Set<string>> {
  const children = new Map<string, string[]>()
  for (const folder of folders) {
    if (!folder.parentId) continue
    const siblings = children.get(folder.parentId)
    if (siblings) siblings.push(folder.id)
    else children.set(folder.parentId, [folder.id])
  }
  const result = new Map<string, Set<string>>()
  const collect = (folderId: string, seen: Set<string>): Set<string> => {
    const cached = result.get(folderId)
    if (cached) return cached
    if (seen.has(folderId)) return new Set()
    const nextSeen = new Set(seen).add(folderId)
    const descendants = new Set<string>()
    for (const childId of children.get(folderId) ?? []) {
      if (nextSeen.has(childId)) continue
      descendants.add(childId)
      for (const nested of collect(childId, nextSeen)) descendants.add(nested)
    }
    result.set(folderId, descendants)
    return descendants
  }
  for (const folder of folders) collect(folder.id, new Set())
  return result
}

/**
 * Root-first ancestors of `folderId`, the folder last. A chain that does not reach the root is
 * not a shorter path but a wrong one, so it comes back empty, as legacy treats it.
 */
export function folderPath<T extends TreeFolder>(
  folderById: ReadonlyMap<string, T>,
  folderId: string | null | undefined
): T[] {
  const chain: T[] = []
  const seen = new Set<string>()
  let current = folderId ? folderById.get(folderId) : undefined
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.unshift(current)
    current = current.parentId ? folderById.get(current.parentId) : undefined
  }
  return chain.length === 0 || chain[0].parentId === null ? chain : []
}

/** Where a row lives while searching: its folders joined by `/`, or the list's root. */
export function folderLocation(
  folderById: ReadonlyMap<string, TreeFolder>,
  folderId: string | null | undefined,
  rootLabel: string
) {
  if (!folderId) return rootLabel
  const chain = folderPath(folderById, folderId)
  return chain.length ? chain.map((folder) => folder.name).join(' / ') : 'Unknown'
}

/** The first `New folder` / `New folder (n)` not taken by a sibling under `parentId`. */
export function nextFolderName(folders: readonly TreeFolder[], parentId: string | null) {
  const taken = new Set(
    folders.filter((folder) => (folder.parentId ?? null) === parentId).map((folder) => folder.name)
  )
  const base = 'New folder'
  if (!taken.has(base)) return base
  let suffix = 1
  while (taken.has(`${base} (${suffix})`)) suffix += 1
  return `${base} (${suffix})`
}

/** One sortable row: precomputed so the comparator never re-derives a key. */
export interface SortEntry<T> {
  item: T
  pinned: boolean
  name: string
  /** The active column's value; `null` where it does not apply sorts last either way. */
  key: string | number | null
}

/**
 * Folders and resources sort as one list: pinned rows first, then the active column, then the
 * name. `pinned` leads only when it should, so a search or filter passes `false` throughout.
 */
export function compareEntries(
  left: Omit<SortEntry<unknown>, 'item'>,
  right: Omit<SortEntry<unknown>, 'item'>,
  direction: 'asc' | 'desc'
) {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
  if (left.key === null || right.key === null) {
    if (left.key !== right.key) return left.key === null ? 1 : -1
  } else {
    const order =
      typeof left.key === 'number' && typeof right.key === 'number'
        ? left.key - right.key
        : String(left.key).localeCompare(String(right.key))
    if (order !== 0) return direction === 'asc' ? order : -order
  }
  return left.name.localeCompare(right.name)
}

export function sortEntries<T>(entries: SortEntry<T>[], direction: 'asc' | 'desc') {
  return [...entries].sort((left, right) => compareEntries(left, right, direction))
}

/**
 * The items a foldered list shows: the open folder's children, or, while searching, every match
 * in the workspace, since a half-remembered name is exactly the one whose folder is unknown.
 */
export function scopeItems<T>(
  items: readonly T[],
  options: {
    folderId: string | null
    search: string
    parentOf: (item: T) => string | null
    searchText: (item: T) => readonly (string | null | undefined)[]
  }
) {
  const needle = options.search.trim().toLowerCase()
  if (!needle) return items.filter((item) => options.parentOf(item) === options.folderId)
  return items.filter((item) =>
    options.searchText(item).some((field) => field?.toLowerCase().includes(needle))
  )
}

/**
 * The "Move to" destinations: the root first, then the folder tree. A folder with children opens
 * a submenu led by "Move here". `exclude` drops the moved folders and everything beneath them.
 */
export function moveDestinations(options: {
  folders: readonly TreeFolder[]
  rootLabel: string
  exclude?: readonly string[]
  descendants?: ReadonlyMap<string, ReadonlySet<string>>
  onMove: (folderId: string | null) => void
}): [MenuAction, ...MenuAction[]] {
  const excluded = new Set(options.exclude)
  for (const id of options.exclude ?? [])
    for (const descendant of options.descendants?.get(id) ?? []) excluded.add(descendant)
  const byParent = new Map<string | null, TreeFolder[]>()
  for (const folder of options.folders) {
    if (excluded.has(folder.id)) continue
    const siblings = byParent.get(folder.parentId ?? null)
    if (siblings) siblings.push(folder)
    else byParent.set(folder.parentId ?? null, [folder])
  }
  const branch = (parentId: string | null): MenuAction[] =>
    [...(byParent.get(parentId) ?? [])]
      .sort(
        (left, right) =>
          (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.name.localeCompare(right.name)
      )
      .map((folder, index): MenuAction => {
        const children = branch(folder.id)
        const base = { id: folder.id, label: folder.name, icon: 'I100' as const }
        const placed = parentId === null && index === 0 ? { separatorBefore: true } : {}
        if (!children.length)
          return { ...base, ...placed, onSelect: () => options.onMove(folder.id) }
        const [first, ...rest] = children
        return {
          ...base,
          ...placed,
          children: [
            {
              id: `${folder.id}:here`,
              label: 'Move here',
              icon: 'I100',
              onSelect: () => options.onMove(folder.id),
            },
            { ...first, separatorBefore: true },
            ...rest,
          ],
        }
      })
  return [
    {
      id: 'root',
      label: options.rootLabel,
      icon: 'I100',
      onSelect: () => options.onMove(null),
    },
    ...branch(null),
  ]
}

/** Names a selection in a confirmation: one row reads as itself, several as a count. */
export function selectionName(count: number, firstName: string | undefined) {
  return count === 1 ? (firstName ?? 'selected item') : `${count} selected items`
}

/** A command's label for a selection: "Delete" for one row, "Delete 3 items" for several. */
export function selectionAction(action: string, count: number, single = action) {
  return count <= 1 ? single : `${action} ${count} items`
}

interface BulkOutcome {
  failed: readonly { name: string; reason: string }[]
  notFound: readonly { id: string }[]
}

/**
 * Says out loud what a bulk operation could not do: a row the server refused or one that had
 * vanished. Success stays silent, as a single move or delete does.
 */
export function reportBulkOutcome(outcome: BulkOutcome, verb: string) {
  const [first] = outcome.failed
  if (first) {
    toast.error(
      outcome.failed.length === 1
        ? `${first.name} could not be ${verb}: ${first.reason}`
        : `${outcome.failed.length} items could not be ${verb}. ${first.name}: ${first.reason}`
    )
    return
  }
  if (outcome.notFound.length)
    toast.error(
      outcome.notFound.length === 1
        ? `One item was no longer available and was not ${verb}.`
        : `${outcome.notFound.length} items were no longer available and were not ${verb}.`
    )
}
