import {
  compareSortableResources,
  type SortableResource,
  sortResources,
} from '@/app/workspace/[workspaceId]/components/folders'

/** One row of the Files list, before it becomes a `ResourceRow`. */
export type FileListEntry<Folder, File> =
  | { kind: 'folder'; folder: Folder; pinned: boolean }
  | { kind: 'file'; file: File; pinned: boolean }

interface Named {
  id: string
  name: string
}

interface MergeFileListEntriesInput<Folder extends Named, File extends Named> {
  /** The folders the list shows, in any order. */
  folders: readonly Folder[]
  /** The loaded files, in the order the server paged them. */
  files: readonly File[]
  /**
   * Pinned files the pages may not have reached yet (looked up by id), shown first. One that
   * a page also holds is shown once, here.
   */
  pinnedFiles: readonly File[]
  /** Whether the server has more files past the last loaded one. */
  hasMore: boolean
  pinnedFolderIds: ReadonlySet<string>
  pinnedFileIds: ReadonlySet<string>
  /**
   * Each row's value for the active sort column, comparable across folders and files; `null`
   * for a row the column has no value for (a file without a member owner), last either way.
   */
  folderKey: (folder: Folder) => string | number | null
  fileKey: (file: File) => string | number | null
  direction: 'asc' | 'desc'
}

/**
 * Orders the Files list: pinned rows first, then folders interleaved with the server-paged
 * files as ONE list by the active sort.
 *
 * The files keep the order the server paged them in — re-sorting them here could disagree with
 * the server's collation and move a later page's rows above ones already on screen. Each folder
 * is placed in front of the first file it sorts at or before, by `compareSortableResources` —
 * the order `sortResources` gives a fully loaded list, which also orders the pinned rows. A
 * folder that sorts after the last loaded file is withheld while more pages remain, since the
 * file it belongs in front of may be on one of them; it appears once a page reaches past it, so
 * loading more only ever appends.
 */
export function mergeFileListEntries<Folder extends Named, File extends Named>(
  input: MergeFileListEntriesInput<Folder, File>
): FileListEntry<Folder, File>[] {
  const { direction } = input
  const shownPinnedFiles = new Set<string>()
  const pinned: SortableResource<FileListEntry<Folder, File>>[] = []
  const unpinnedFolders: SortableResource<FileListEntry<Folder, File>>[] = []

  for (const folder of input.folders) {
    const isPinned = input.pinnedFolderIds.has(folder.id)
    const entry = {
      item: { kind: 'folder' as const, folder, pinned: isPinned },
      pinned: isPinned,
      name: folder.name,
      key: input.folderKey(folder),
    }
    ;(isPinned ? pinned : unpinnedFolders).push(entry)
  }
  const addPinnedFile = (file: File) => {
    if (shownPinnedFiles.has(file.id)) return
    shownPinnedFiles.add(file.id)
    pinned.push({
      item: { kind: 'file', file, pinned: true },
      pinned: true,
      name: file.name,
      key: input.fileKey(file),
    })
  }
  for (const file of input.pinnedFiles) addPinnedFile(file)
  for (const file of input.files) if (input.pinnedFileIds.has(file.id)) addPinnedFile(file)

  const entries = sortResources(pinned, direction).map((entry) => entry.item)
  const folders = sortResources(unpinnedFolders, direction)

  let nextFolder = 0
  for (const file of input.files) {
    if (shownPinnedFiles.has(file.id)) continue
    const position = { pinned: false, name: file.name, key: input.fileKey(file) }
    while (
      nextFolder < folders.length &&
      compareSortableResources(folders[nextFolder], position, direction) <= 0
    ) {
      entries.push(folders[nextFolder].item)
      nextFolder++
    }
    entries.push({ kind: 'file', file, pinned: false })
  }
  if (!input.hasMore) {
    for (; nextFolder < folders.length; nextFolder++) entries.push(folders[nextFolder].item)
  }
  return entries
}
