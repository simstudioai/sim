import {
  type SortableResource,
  sortResources,
} from '@/app/workspace/[workspaceId]/components/folders'

/** One row of the Files list, before it becomes a `ResourceRow`. */
export type FileListEntry<Folder, File> =
  | { kind: 'folder'; folder: Folder; pinned: boolean }
  | { kind: 'file'; file: File; pinned: boolean }

interface MergeFileListEntriesInput<Folder, File> {
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
  isFolderPinned: (folder: Folder) => boolean
  isFilePinned: (file: File) => boolean
  folderId: (folder: Folder) => string
  fileId: (file: File) => string
  folderName: (folder: Folder) => string
  fileName: (file: File) => string
  /** Each row's value for the active sort column, comparable across folders and files. */
  /** `null` for a row the column has no value for (a file without a member owner): last either way. */
  folderKey: (folder: Folder) => string | number | null
  fileKey: (file: File) => string | number | null
  direction: 'asc' | 'desc'
}

function compareKeys(a: string | number, b: string | number): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
}

/**
 * Orders the Files list: pinned rows first, then folders interleaved with the server-paged
 * files as ONE list by the active sort.
 *
 * The files keep the order the server paged them in — re-sorting them here could disagree with
 * the server's collation and move a later page's rows above ones already on screen. Each folder
 * is placed in front of the first file it sorts at or before. A folder that sorts after the last
 * loaded file is withheld while more pages remain, since the file it belongs in front of may be
 * on one of them; it appears once a page reaches past it, so loading more only ever appends.
 *
 * A folder tying with a file on the column goes by name A→Z, and a row without a value goes
 * last in either direction — the rules `sortResources` orders a fully loaded list by, which also
 * orders the pinned rows among themselves.
 */
export function mergeFileListEntries<Folder, File>(
  input: MergeFileListEntriesInput<Folder, File>
): FileListEntry<Folder, File>[] {
  const { direction } = input
  const pinnedFileIds = new Set<string>()
  const pinned: SortableResource<FileListEntry<Folder, File>>[] = []
  const unpinnedFolders: SortableResource<FileListEntry<Folder, File>>[] = []

  for (const folder of input.folders) {
    const entry = {
      item: { kind: 'folder' as const, folder, pinned: input.isFolderPinned(folder) },
      pinned: input.isFolderPinned(folder),
      name: input.folderName(folder),
      key: input.folderKey(folder),
    }
    if (entry.pinned) pinned.push(entry)
    else unpinnedFolders.push(entry)
  }
  const addPinnedFile = (file: File) => {
    const id = input.fileId(file)
    if (pinnedFileIds.has(id)) return
    pinnedFileIds.add(id)
    pinned.push({
      item: { kind: 'file', file, pinned: true },
      pinned: true,
      name: input.fileName(file),
      key: input.fileKey(file),
    })
  }
  for (const file of input.pinnedFiles) addPinnedFile(file)
  for (const file of input.files) if (input.isFilePinned(file)) addPinnedFile(file)

  const entries = sortResources(pinned, direction).map((entry) => entry.item)
  const folders = sortResources(unpinnedFolders, direction)
  /** Whether `folder` sorts at or before a file whose key is `fileKey` and name is `fileName`. */
  const precedes = (
    folder: SortableResource<FileListEntry<Folder, File>>,
    fileKey: string | number | null,
    fileName: string
  ) => {
    if (folder.key === null || fileKey === null) {
      if (folder.key !== fileKey) return fileKey === null
      return folder.name.localeCompare(fileName) <= 0
    }
    const cmp = compareKeys(folder.key, fileKey)
    if (cmp !== 0) return direction === 'asc' ? cmp < 0 : cmp > 0
    return folder.name.localeCompare(fileName) <= 0
  }

  let nextFolder = 0
  for (const file of input.files) {
    if (pinnedFileIds.has(input.fileId(file))) continue
    const key = input.fileKey(file)
    const name = input.fileName(file)
    while (nextFolder < folders.length) {
      const folder = folders[nextFolder]
      if (!precedes(folder, key, name)) break
      entries.push(folder.item)
      nextFolder++
    }
    entries.push({ kind: 'file', file, pinned: false })
  }
  if (!input.hasMore) {
    for (; nextFolder < folders.length; nextFolder++) entries.push(folders[nextFolder].item)
  }
  return entries
}
