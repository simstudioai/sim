import { collectFolderDepths } from '@/lib/folders/subtree'

export interface DirectoryFolder {
  id: string
  parentId: string | null
  name: string
  /** Canonical percent-encoded path. */
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

export interface DirectoryFile {
  id: string
  name: string
  folderId: string | null
  size: number
  type: string
  updatedAt: string
}

/**
 * One child of the listed folder. `kind` is the discriminant, so a consumer can
 * narrow before reaching for the fields only one side has — a folder has a path
 * of its own, a file has the folder it sits in.
 */
export type DirectoryEntry =
  | {
      kind: 'folder'
      id: string
      name: string
      path: string
      parentPath: string
      depth: number
      createdAt: string
      updatedAt: string
    }
  | {
      kind: 'file'
      id: string
      name: string
      folderPath: string
      depth: number
      size: number
      type: string
      updatedAt: string
    }

export interface DirectoryListing {
  entries: DirectoryEntry[]
  /** True when `limit` cut the listing short, so a caller can say so rather than imply completeness. */
  truncated: boolean
}

export interface DirectoryListingOptions {
  /** The folder being listed; `null` is the workspace root. */
  rootId: string | null
  /** The root's own canonical path, used as the folder path of its direct files. */
  rootPath: string
  /** Deepest level to include, counted from the listed folder. 1 is direct children. */
  maxDepth: number
  /** Case-insensitive substring match against an entry's name. */
  search?: string
  limit: number
}

/**
 * Lists what is inside a folder: its subfolders and its files together, because
 * "what is in here" is one question and answering it in two calls makes the
 * caller reassemble an ordering it should not have to know.
 *
 * Depth is counted from the listed folder, and a file sits one level below the
 * folder holding it — so a non-recursive listing (`maxDepth` 1) is the direct
 * subfolders plus the files directly inside, and nothing from a level down.
 *
 * Search filters the result rather than the traversal: a match deep in the tree
 * is still reported at its real depth, and its unmatched ancestors are simply
 * absent. Filtering the traversal instead would hide anything under a folder
 * whose own name did not match.
 */
export function selectDirectoryEntries(
  folders: readonly DirectoryFolder[],
  files: readonly DirectoryFile[],
  options: DirectoryListingOptions
): DirectoryListing {
  const folderDepths = collectFolderDepths(folders, options.rootId, { maxDepth: options.maxDepth })
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))

  const depthOf = (folderId: string | null): number | undefined => {
    if (folderId === options.rootId) return 0
    if (folderId === null) return undefined
    return folderDepths.get(folderId)
  }

  const needle = options.search?.trim().toLowerCase()
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle)

  const entries: DirectoryEntry[] = []

  for (const [folderId, depth] of folderDepths) {
    const folder = folderById.get(folderId)
    if (!folder || !matches(folder.name)) continue
    entries.push({
      kind: 'folder',
      id: folder.id,
      name: folder.name,
      path: folder.path,
      parentPath: folder.parentPath,
      depth,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    })
  }

  for (const file of files) {
    const parentDepth = depthOf(file.folderId)
    if (parentDepth === undefined) continue
    const depth = parentDepth + 1
    if (depth > options.maxDepth || !matches(file.name)) continue
    entries.push({
      kind: 'file',
      id: file.id,
      name: file.name,
      folderPath:
        file.folderId === options.rootId
          ? options.rootPath
          : (folderById.get(file.folderId ?? '')?.path ?? options.rootPath),
      depth,
      size: file.size,
      type: file.type,
      updatedAt: file.updatedAt,
    })
  }

  /* Shallowest first, folders before files, then by name — the order a file browser shows. */
  entries.sort(
    (a, b) =>
      a.depth - b.depth ||
      (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) ||
      a.name.localeCompare(b.name)
  )

  return {
    entries: entries.slice(0, options.limit),
    truncated: entries.length > options.limit,
  }
}
