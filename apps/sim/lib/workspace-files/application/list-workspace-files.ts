import { MAX_WORKSPACE_FILE_LOOKUP_ENTRIES } from '@/lib/api/contracts/workspace-files'
import type { CursorKey } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex, resolveFolderPathFilter } from '@/lib/folders/queries'
import type { FolderIdScope } from '@/lib/folders/scope'
import {
  collectDescendantFolderIdsFrom,
  indexFolderChildren,
  resolveFolderScope,
} from '@/lib/folders/subtree'
import { getWorkspaceShares, getWorkspaceSharesForResources } from '@/lib/public-shares/manager'
import {
  aggregateWorkspaceFileFolderUsage,
  findActiveWorkspaceFilesByKeys,
  findListedWorkspaceFiles,
  listWorkspaceFiles,
  loadActiveWorkspaceContext,
  queryWorkspaceFiles,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
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
  sortBy: 'name' | 'size' | 'uploadedAt' | 'updatedAt'
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

async function listAllWithShares(workspaceId: string, scope: ListAllWorkspaceFilesInput['scope']) {
  const files = await listWorkspaceFiles(workspaceId, { scope })
  const shares = await getWorkspaceShares('file', workspaceId)
  return { files: files.map((file) => ({ ...file, share: shares.get(file.id) ?? null })) }
}

/** Attaches public share state to a bounded set of files, reading only their shares. */
async function withShares(workspaceId: string, files: WorkspaceFileRecord[]) {
  const shares = await getWorkspaceSharesForResources(
    'file',
    workspaceId,
    files.map((file) => file.id)
  )
  return files.map((file) => ({ ...file, share: shares.get(file.id) ?? null }))
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
 * and owned files are simply absent.
 */
export const lookupWorkspaceFiles = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.list,
  resolveContext: ({ input }: { input: LookupWorkspaceFilesInput }) =>
    resolveListWorkspaceFileContext(input.workspaceId),
  async execute({ input, context }) {
    const ids = [...new Set(input.ids ?? [])]
    const keys = [...new Set(input.keys ?? [])]
    const references = [...new Set(input.references ?? [])]
    for (const list of [ids, keys, references]) {
      if (list.length > MAX_WORKSPACE_FILE_LOOKUP_ENTRIES) {
        throw new OrchestrationError(
          'validation',
          `A lookup accepts at most ${MAX_WORKSPACE_FILE_LOOKUP_ENTRIES} ids, keys, or references each`
        )
      }
    }
    const [byId, byKey, byReference] = await Promise.all([
      ids.length === 0
        ? []
        : queryWorkspaceFiles(context.workspaceId, {
            scope: 'active',
            fileIds: ids,
            sortBy: 'name',
            sortOrder: 'asc',
            limit: ids.length,
          }).then((page) => page.files),
      findActiveWorkspaceFilesByKeys(context.workspaceId, keys),
      findListedWorkspaceFiles(context.workspaceId, references),
    ])
    const files = new Map<string, WorkspaceFileRecord>()
    for (const file of [...byId, ...byKey, ...byReference.values()]) {
      if (file && !files.has(file.id)) files.set(file.id, file)
    }
    return {
      files: await withShares(context.workspaceId, [...files.values()]),
      references: references.map((reference) => ({
        reference,
        fileId: byReference.get(reference)?.id ?? null,
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
    const folderIndex = await loadActiveFolderPathIndex(context.workspaceId, 'file', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    const rows = [...folderIndex.rowById.values()]
    if (input.parentId !== null && !folderIndex.rowById.has(input.parentId)) {
      return { folders: [] }
    }
    const childrenByParent = indexFolderChildren(rows)
    const children = rows
      .filter((row) => (row.parentId ?? null) === input.parentId)
      .map((row) => row.id)
    const subtrees = new Map(
      children.map((childId) => [
        childId,
        [childId, ...collectDescendantFolderIdsFrom(childrenByParent, childId)],
      ])
    )
    const usage = await aggregateWorkspaceFileFolderUsage(context.workspaceId, [
      ...new Set([...subtrees.values()].flat()),
    ])
    return {
      folders: children.map((folderId) => {
        let fileCount = 0
        let sizeBytes = 0
        for (const id of subtrees.get(folderId) ?? []) {
          const held = usage.get(id)
          if (!held) continue
          fileCount += held.fileCount
          sizeBytes += held.sizeBytes
        }
        return { folderId, fileCount, sizeBytes }
      }),
    }
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
  /**
   * Capped the way the workflow, table, and knowledge lists cap theirs. A
   * truncated index does not fail — it silently loses paths, and the only
   * consumer here is the `folderPath` filter, so a real folder outside the
   * read rows would resolve to nothing and the caller would get an empty page
   * for a folder that has files in it. The cap turns that into the same 413
   * the sibling lists answer.
   */
  let folderId: string | null | string[] | undefined
  if (input.folderPath !== undefined) {
    const folderIndex = await loadActiveFolderPathIndex(workspaceId, 'file', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    const folderFilter = resolveFolderPathFilter(folderIndex, input.folderPath)
    if (folderFilter.kind === 'noMatch') return { files: [], nextKeys: null }
    folderId = resolveFolderScope(folderIndex, folderFilter, input.recursive)
  } else if (input.folderId !== undefined) {
    if (input.folderId === null || !input.recursive) {
      folderId = input.recursive ? undefined : input.folderId
    } else {
      const folderIndex = await loadActiveFolderPathIndex(workspaceId, 'file', undefined, {
        maxRows: MAX_FOLDERS_PER_WORKSPACE,
      })
      if (!folderIndex.rowById.has(input.folderId)) return { files: [], nextKeys: null }
      folderId = resolveFolderScope(folderIndex, { kind: 'folder', folderId: input.folderId }, true)
    }
  }

  const { files, nextKeys } = await queryWorkspaceFiles(workspaceId, {
    scope: input.scope,
    folderId,
    folderScope: input.folderScope,
    fileIds: input.fileId === undefined ? undefined : [input.fileId],
    name: input.name,
    search: input.search,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    limit: input.limit,
    after: input.after,
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
