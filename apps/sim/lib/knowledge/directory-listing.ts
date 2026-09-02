import { collectFolderDepths } from '@/lib/folders/subtree'

export interface KnowledgeDirectoryFolder {
  id: string
  parentId: string | null
  name: string
  /** Canonical percent-encoded path. */
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

export interface KnowledgeDirectoryBase {
  id: string
  name: string
  description: string | null
  folderId: string | null
  docCount: number
  tokenCount: number
  createdAt: string
  updatedAt: string
}

/**
 * One child of the listed folder. `kind` is the discriminant, so a consumer can
 * narrow before reaching for the fields only one side has — a folder has a path
 * of its own, a knowledge base has the path of the folder holding it.
 */
export type KnowledgeDirectoryEntry =
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
      kind: 'knowledge_base'
      id: string
      name: string
      description: string | null
      folderPath: string
      depth: number
      docCount: number
      tokenCount: number
      createdAt: string
      updatedAt: string
    }

export interface KnowledgeDirectoryListing {
  entries: KnowledgeDirectoryEntry[]
  /** True when `limit` cut the listing short, so a caller can say so rather than imply completeness. */
  truncated: boolean
}

export interface KnowledgeDirectoryListingOptions {
  /** The folder being listed; `null` is the workspace root. */
  rootId: string | null
  /** The root's own canonical path, used as the folder path of the knowledge bases directly in it. */
  rootPath: string
  /** Deepest level to include, counted from the listed folder. 1 is direct children. */
  maxDepth: number
  /** Case-insensitive substring match against an entry's name. */
  search?: string
  limit: number
}

/**
 * Lists what is inside a knowledge folder: its subfolders and its knowledge
 * bases together, because "what is in here" is one question and answering it in
 * two calls makes the caller reassemble an ordering it should not have to know.
 *
 * Depth is counted from the listed folder, and a knowledge base sits one level
 * below the folder holding it — so a non-recursive listing (`maxDepth` 1) is the
 * direct subfolders plus the knowledge bases directly inside, and nothing from a
 * level down.
 *
 * Search filters the result rather than the traversal: a match deep in the tree
 * is still reported at its real depth, and its unmatched ancestors are simply
 * absent. Filtering the traversal instead would hide anything under a folder
 * whose own name did not match.
 *
 * Depths come from {@link collectFolderDepths}, which walks `parentId` rather
 * than comparing path strings — so a folder genuinely named `Q3/Q4` is one level
 * here no matter how its path is spelled.
 *
 * Traversal, depth, search and sort are the same logic as
 * `lib/workspace-files/directory-listing.ts`; only the non-folder payload
 * differs. Kept separate for now because that module belongs to the File slice
 * this branch is stacked on, and a shared generic is worth extracting once both
 * have landed rather than editing an in-review file from downstream.
 */
export function selectKnowledgeDirectoryEntries(
  folders: readonly KnowledgeDirectoryFolder[],
  knowledgeBases: readonly KnowledgeDirectoryBase[],
  options: KnowledgeDirectoryListingOptions
): KnowledgeDirectoryListing {
  const folderDepths = collectFolderDepths(folders, options.rootId, { maxDepth: options.maxDepth })
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))

  const depthOf = (folderId: string | null): number | undefined => {
    if (folderId === options.rootId) return 0
    if (folderId === null) return undefined
    return folderDepths.get(folderId)
  }

  const needle = options.search?.trim().toLowerCase()
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle)

  const entries: KnowledgeDirectoryEntry[] = []

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

  for (const knowledgeBase of knowledgeBases) {
    const parentDepth = depthOf(knowledgeBase.folderId)
    if (parentDepth === undefined) continue
    const depth = parentDepth + 1
    if (depth > options.maxDepth || !matches(knowledgeBase.name)) continue
    entries.push({
      kind: 'knowledge_base',
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      folderPath:
        knowledgeBase.folderId === options.rootId
          ? options.rootPath
          : (folderById.get(knowledgeBase.folderId ?? '')?.path ?? options.rootPath),
      depth,
      docCount: knowledgeBase.docCount,
      tokenCount: knowledgeBase.tokenCount,
      createdAt: knowledgeBase.createdAt,
      updatedAt: knowledgeBase.updatedAt,
    })
  }

  /* Shallowest first, folders before knowledge bases, then by name — the order a browser shows. */
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
