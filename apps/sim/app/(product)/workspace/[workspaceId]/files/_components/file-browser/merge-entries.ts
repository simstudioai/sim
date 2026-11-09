import {
  compareEntries,
  type SortEntry,
  sortEntries,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/folder-tree'

/** One row of the Files list, before it becomes a table row. */
type FileEntry<Folder, File> = { kind: 'folder'; folder: Folder } | { kind: 'file'; file: File }

interface Named {
  id: string
  name: string
}

/**
 * Orders the Files list as legacy does: pinned rows first, then folders interleaved with the
 * server-paged files by the active sort. The files keep the server's order, so loading another page
 * only ever appends; a folder that sorts after the last loaded file waits until a page reaches it.
 */
export function mergeFileEntries<Folder extends Named, File extends Named>(input: {
  folders: readonly Folder[]
  /** The loaded files, in the order the server paged them. */
  files: readonly File[]
  /** Pinned files the pages may not have reached, shown first. */
  pinnedFiles: readonly File[]
  hasMore: boolean
  pinnedFolderIds: ReadonlySet<string>
  pinnedFileIds: ReadonlySet<string>
  folderKey: (folder: Folder) => string | number | null
  fileKey: (file: File) => string | number | null
  direction: 'asc' | 'desc'
}): FileEntry<Folder, File>[] {
  const shownPins = new Set<string>()
  const pinned: SortEntry<FileEntry<Folder, File>>[] = []
  const unpinnedFolders: SortEntry<FileEntry<Folder, File>>[] = []
  for (const folder of input.folders) {
    const isPinned = input.pinnedFolderIds.has(folder.id)
    const entry = {
      item: { kind: 'folder' as const, folder },
      pinned: isPinned,
      name: folder.name,
      key: input.folderKey(folder),
    }
    if (isPinned) pinned.push(entry)
    else unpinnedFolders.push(entry)
  }
  const addPinnedFile = (file: File) => {
    if (shownPins.has(file.id)) return
    shownPins.add(file.id)
    pinned.push({
      item: { kind: 'file', file },
      pinned: true,
      name: file.name,
      key: input.fileKey(file),
    })
  }
  for (const file of input.pinnedFiles) addPinnedFile(file)
  for (const file of input.files) if (input.pinnedFileIds.has(file.id)) addPinnedFile(file)

  const entries = sortEntries(pinned, input.direction).map((entry) => entry.item)
  const folders = sortEntries(unpinnedFolders, input.direction)
  let next = 0
  for (const file of input.files) {
    if (shownPins.has(file.id)) continue
    const position = { pinned: false, name: file.name, key: input.fileKey(file) }
    while (next < folders.length && compareEntries(folders[next], position, input.direction) <= 0) {
      entries.push(folders[next].item)
      next++
    }
    entries.push({ kind: 'file', file })
  }
  if (!input.hasMore) for (; next < folders.length; next++) entries.push(folders[next].item)
  return entries
}
