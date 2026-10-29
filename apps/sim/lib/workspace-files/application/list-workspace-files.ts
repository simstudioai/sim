import type { CursorKey } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import {
  type FolderPathFilter,
  loadActiveFolderPathIndex,
  resolveFolderPathFilter,
} from '@/lib/folders/queries'
import type { FolderIdScope } from '@/lib/folders/scope'
import {
  collectDescendantFolderIdsFrom,
  indexFolderChildren,
  resolveFolderScope,
} from '@/lib/folders/subtree'
import { attachShares } from '@/lib/public-shares/attach'
import { getWorkspaceShares, getWorkspaceSharesForResources } from '@/lib/public-shares/manager'
import {
  aggregateWorkspaceFileFolderUsage,
  findListedWorkspaceFiles,
  findWorkspaceFileFoldersMatching,
  listWorkspaceFiles,
  loadActiveWorkspaceContext,
  lookupActiveWorkspaceFiles,
  queryWorkspaceFiles,
  searchWorkspaceFileRecords,
  type WorkspaceFileRecord,
  type WorkspaceFileSortBy,
} from '@/lib/uploads/contexts/workspace'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import type { FileBrowserSize, FileBrowserType } from '@/lib/workspace-files/browser'
import { resolveWorkspaceFolderScope } from '@/lib/workspace-files/resolve-folder-scope'

export interface ListAllWorkspaceFilesInput {
  workspaceId: string
  scope: 'active' | 'archived' | 'all'
}

export interface QueryWorkspaceFilePageInput {
  workspaceId: string
  /** Lifecycle set to page over. Omission preserves the active-only default. */
  scope?: 'active' | 'archived'
  folderPath?: string
  /**
   * Whether `folderPath` covers its whole subtree rather than its direct children. Ignored
   * without a `folderPath`, which already spans the workspace. The surface decides the
   * default — see the v2 route, where a `search` implies a recursive look.
   */
  recursive?: boolean
  /** Exact file id. */
  fileId?: string
  /** Exact file name. */
  name?: string
  search?: string
  /** Files of any of these kinds. */
  kinds?: readonly FileBrowserType[]
  /** Files in any of these size buckets. */
  sizeBuckets?: readonly FileBrowserSize[]
  /** Files uploaded by any of these users. */
  uploadedBy?: readonly string[]
  sortBy: WorkspaceFileSortBy
  sortOrder: 'asc' | 'desc'
  limit: number
  after?: CursorKey[]
  /** Pre-resolved folder ids for trusted in-process callers that already loaded the tree. */
  folderScope?: FolderIdScope
  /**
   * One folder by id, `null` for the workspace root — the browser's addressing, where
   * `folderPath` is the API's. With `recursive`, the folder's whole active subtree; an id that
   * names no active folder of this workspace then matches nothing.
   */
  folderId?: string | null
}

export interface ListWorkspaceFilesInFolderScopeInput {
  workspaceId: string
  folderPaths: readonly string[]
  includeSubfolders?: boolean
  limit: number
}

async function resolveListWorkspaceFileContext(workspaceId: string) {
  const workspace = await loadActiveWorkspaceContext(workspaceId)
  if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
  return workspace
}

/**
 * The active file folder tree, capped the way the workflow, table, and knowledge lists cap
 * theirs. A truncated index would not fail — it would silently lose folders, so a real folder
 * outside the read rows would resolve to nothing and its page would come back empty. The cap
 * turns that into the same 413 the sibling lists answer.
 */
function loadFileFolderIndex(workspaceId: string) {
  return loadActiveFolderPathIndex(workspaceId, 'file', undefined, {
    maxRows: MAX_FOLDERS_PER_WORKSPACE,
  })
}

async function listAllWithShares(workspaceId: string, scope: ListAllWorkspaceFilesInput['scope']) {
  const [files, shares] = await Promise.all([
    listWorkspaceFiles(workspaceId, { scope }),
    getWorkspaceShares('file', workspaceId),
  ])
  return { files: attachShares(files, shares) }
}

/** Attaches public share state to a bounded set of files, reading only their shares. */
async function withShares(workspaceId: string, files: WorkspaceFileRecord[]) {
  const shares = await getWorkspaceSharesForResources(
    'file',
    workspaceId,
    files.map((file) => file.id)
  )
  return attachShares(files, shares)
}

export const listAllWorkspaceFiles = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.list,
  resolveContext: ({ input }: { input: ListAllWorkspaceFilesInput }) =>
    resolveListWorkspaceFileContext(input.workspaceId),
  execute: ({ input, context }) => listAllWithShares(context.workspaceId, input.scope),
})

interface FindActiveWorkspaceFilesByReferenceInput {
  workspaceId: string
  references: readonly string[]
}

/**
 * The active workspace file a listing-based lookup would pick for each reference (an id, a
 * VFS path, or a bare name), under the same list authorization, without reading the listing.
 * Workspace files only: chat uploads and owned files are never matched.
 */
export const findActiveWorkspaceFilesByReference = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.list,
  resolveContext: ({ input }: { input: FindActiveWorkspaceFilesByReferenceInput }) =>
    resolveListWorkspaceFileContext(input.workspaceId),
  async execute({ input, context }) {
    return { files: await findListedWorkspaceFiles(context.workspaceId, input.references) }
  },
})

export interface LookupWorkspaceFilesInput {
  workspaceId: string
  ids?: readonly string[]
  keys?: readonly string[]
  references?: readonly string[]
}

/**
 * Resolves a bounded batch of live workspace files by id, storage key, and reference (an id,
 * a VFS path, or a bare name) in one call, under list authorization. Each resolved file
 * appears once in `files`; `references` reports, per reference in request order, the id it
 * resolved to or `null`. Ids and keys of another workspace's files, deleted files, chat uploads,
 * and owned files are simply absent. The route's contract caps each list.
 */
export const lookupWorkspaceFiles = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.list,
  resolveContext: ({ input }: { input: LookupWorkspaceFilesInput }) =>
    resolveListWorkspaceFileContext(input.workspaceId),
  async execute({ input, context }) {
    const references = [...new Set(input.references ?? [])]
    const found = await lookupActiveWorkspaceFiles(context.workspaceId, {
      ids: [...new Set(input.ids ?? [])],
      keys: [...new Set(input.keys ?? [])],
      references,
    })
    return {
      files: await withShares(context.workspaceId, found.files),
      references: references.map((reference) => ({
        reference,
        fileId: found.references.get(reference)?.id ?? null,
      })),
    }
  },
})

export interface GetWorkspaceFileFolderStatsInput {
  workspaceId: string
  /** The folder whose child folders to report, `null` for the workspace root. */
  parentId: string | null
}

/**
 * For each direct child folder of `parentId`, the live files and bytes in its whole subtree.
 * One grouped aggregate over the subtrees' folder ids, rolled up against the active folder
 * tree; root files are never read. A `parentId` naming no active folder reports no children.
 */
export const getWorkspaceFileFolderStats = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.list,
  resolveContext: ({ input }: { input: GetWorkspaceFileFolderStatsInput }) =>
    resolveListWorkspaceFileContext(input.workspaceId),
  async execute({ input, context }) {
    const folderIndex = await loadFileFolderIndex(context.workspaceId)
    if (input.parentId !== null && !folderIndex.rowById.has(input.parentId)) {
      return { folders: [] }
    }
    const rows = [...folderIndex.rowById.values()]
    // One child index for every subtree: `resolveFolderScope` would rebuild it per child.
    const childrenByParent = indexFolderChildren(rows)
    const subtrees = rows
      .filter((row) => (row.parentId ?? null) === input.parentId)
      .map((row) => ({
        folderId: row.id,
        ids: [row.id, ...collectDescendantFolderIdsFrom(childrenByParent, row.id)],
      }))
    const usage = await aggregateWorkspaceFileFolderUsage(
      context.workspaceId,
      subtrees.flatMap((subtree) => subtree.ids)
    )
    return {
      folders: subtrees.map(({ folderId, ids }) =>
        ids.reduce(
          (total, id) => ({
            folderId,
            fileCount: total.fileCount + (usage.get(id)?.fileCount ?? 0),
            sizeBytes: total.sizeBytes + (usage.get(id)?.sizeBytes ?? 0),
          }),
          { folderId, fileCount: 0, sizeBytes: 0 }
        )
      ),
    }
  },
})

export interface SearchWorkspaceFilesInput {
  workspaceId: string
  query: string
  /** The folder searched, `null` for the root; absent, the whole workspace. */
  folderId?: string | null
  /** Whether `folderId`'s subfolders are searched too. */
  recursive: boolean
  limit: number
}

/**
 * Live files a palette-style query finds, best match first (see `searchWorkspaceFileRecords`):
 * by name — exactly, by prefix, by substring, then fuzzily — and then by the folders they sit
 * under, so a query naming a folder finds the files anywhere beneath it. Each file carries its
 * public share state. A folder id naming no active folder of this workspace finds nothing.
 */
export const searchWorkspaceFiles = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.list,
  resolveContext: ({ input }: { input: SearchWorkspaceFilesInput }) =>
    resolveListWorkspaceFileContext(input.workspaceId),
  async execute({ input, context }) {
    const [folderIndex, matchedFolders] = await Promise.all([
      loadFileFolderIndex(context.workspaceId),
      findWorkspaceFileFoldersMatching(context.workspaceId, input.query),
    ])
    let folderId: string | null | string[] | undefined
    if (input.folderId === null) {
      folderId = input.recursive ? undefined : null
    } else if (input.folderId !== undefined) {
      if (!folderIndex.rowById.has(input.folderId)) return { files: [] }
      folderId = input.recursive
        ? resolveFolderScope(folderIndex, { kind: 'folder', folderId: input.folderId }, true)
        : input.folderId
    }
    const folders = [...folderIndex.rowById.values()]
    const childrenByParent = indexFolderChildren(folders)
    const pathFolderIds = new Set<string>()
    for (const matched of matchedFolders) {
      if (!folderIndex.rowById.has(matched)) continue
      pathFolderIds.add(matched)
      for (const id of collectDescendantFolderIdsFrom(childrenByParent, matched)) {
        pathFolderIds.add(id)
      }
    }
    const files = await searchWorkspaceFileRecords(context.workspaceId, {
      query: input.query,
      folderId,
      pathFolderIds: [...pathFolderIds],
      limit: input.limit,
      folders,
    })
    return { files: await withShares(context.workspaceId, files) }
  },
})

/**
 * One filtered, sorted, bounded page of a workspace's files, the folder filter given by path,
 * by id, or pre-resolved. The body every paged list surface shares once authorized.
 */
async function readWorkspaceFilePage(
  workspaceId: string,
  input: Omit<QueryWorkspaceFilePageInput, 'workspaceId'>
): Promise<{ files: WorkspaceFileRecord[]; nextKeys: CursorKey[] | null }> {
  const folderFilters = [input.folderPath, input.folderScope, input.folderId].filter(
    (filter) => filter !== undefined
  )
  if (folderFilters.length > 1) {
    throw new OrchestrationError(
      'validation',
      'Specify only one of folderPath, folderScope, or folderId'
    )
  }
  // The folder tree, when a filter needs it, also hydrates the page's folder paths.
  let folderIndex: Awaited<ReturnType<typeof loadFileFolderIndex>> | undefined
  let folderId: string | null | string[] | undefined
  if (input.folderPath !== undefined || input.folderId !== undefined) {
    folderIndex = await loadFileFolderIndex(workspaceId)
    const folderFilter: FolderPathFilter =
      input.folderPath !== undefined
        ? resolveFolderPathFilter(folderIndex, input.folderPath)
        : { kind: 'folder', folderId: input.folderId ?? null }
    // A subtree is the active tree's; a folder outside it has none, so its recursive page is empty.
    const outsideTree =
      folderFilter.kind === 'folder' &&
      folderFilter.folderId !== null &&
      !folderIndex.rowById.has(folderFilter.folderId)
    if (folderFilter.kind === 'noMatch' || (outsideTree && input.recursive)) {
      return { files: [], nextKeys: null }
    }
    folderId = resolveFolderScope(folderIndex, folderFilter, input.recursive)
  }

  const { files, nextKeys } = await queryWorkspaceFiles(workspaceId, {
    scope: input.scope,
    folderId,
    folderScope: input.folderScope,
    fileIds: input.fileId === undefined ? undefined : [input.fileId],
    name: input.name,
    search: input.search,
    kinds: input.kinds,
    sizeBuckets: input.sizeBuckets,
    uploadedBy: input.uploadedBy,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    limit: input.limit,
    after: input.after,
    // The active tree covers every folder a live file sits in; an archived page reads the whole tree.
    folders:
      folderIndex && (input.scope ?? 'active') === 'active'
        ? [...folderIndex.rowById.values()]
        : undefined,
  })
  return { files, nextKeys }
}

export const queryWorkspaceFilePage = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.list,
  resolveContext: ({ input }: { input: QueryWorkspaceFilePageInput }) =>
    resolveListWorkspaceFileContext(input.workspaceId),
  execute: ({ input, context }) => readWorkspaceFilePage(context.workspaceId, input),
})

type WorkspaceFilePageQuery = Omit<QueryWorkspaceFilePageInput, 'workspaceId' | 'scope'>

export interface ListWorkspaceFileCollectionInput {
  workspaceId: string
  scope: 'active' | 'archived'
  /** A bounded page; omitted, the whole scope, as {@link listAllWorkspaceFiles} reads it. */
  page?: WorkspaceFilePageQuery
}

/**
 * The browser's file collection: one bounded page when `page` is given, else the whole scope,
 * each file carrying its public share state either way. The page shares
 * {@link queryWorkspaceFilePage}'s implementation, and reads only its own files' shares.
 */
export const listWorkspaceFileCollection = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.list,
  resolveContext: ({ input }: { input: ListWorkspaceFileCollectionInput }) =>
    resolveListWorkspaceFileContext(input.workspaceId),
  async execute({ input, context }) {
    if (!input.page) {
      return { ...(await listAllWithShares(context.workspaceId, input.scope)), nextKeys: null }
    }
    const { files, nextKeys } = await readWorkspaceFilePage(context.workspaceId, {
      ...input.page,
      scope: input.scope,
    })
    return { files: await withShares(context.workspaceId, files), nextKeys }
  },
})

/**
 * Resolves one or more canonical folder paths and returns a bounded page of the
 * files they cover. The scope is pushed into SQL, so a small folder never
 * requires materializing every file in its workspace first.
 */
export const listWorkspaceFilesInFolderScope = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.list,
  resolveContext: ({ input }: { input: ListWorkspaceFilesInFolderScopeInput }) =>
    resolveListWorkspaceFileContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const folderScope = await resolveWorkspaceFolderScope({
      principal,
      workspaceId: context.workspaceId,
      folderPaths: input.folderPaths,
      includeSubfolders: input.includeSubfolders,
    })
    const { files, nextKeys } = await queryWorkspaceFiles(context.workspaceId, {
      scope: 'active',
      folderScope,
      sortBy: 'uploadedAt',
      sortOrder: 'asc',
      limit: input.limit,
    })
    return { files, truncated: nextKeys !== null }
  },
})
