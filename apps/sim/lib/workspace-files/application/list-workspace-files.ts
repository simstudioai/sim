import type { CursorKey } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex, resolveFolderPathFilter } from '@/lib/folders/queries'
import { collectDescendantFolderIdsFrom, indexFolderChildren } from '@/lib/folders/subtree'
import { getWorkspaceShares } from '@/lib/public-shares/share-manager'
import {
  listWorkspaceFiles,
  loadActiveWorkspaceContext,
  queryWorkspaceFiles,
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
  search?: string
  sortBy: 'name' | 'size' | 'uploadedAt' | 'updatedAt'
  sortOrder: 'asc' | 'desc'
  limit: number
  after?: CursorKey[]
}

export interface ListWorkspaceFilesInFolderScopeInput {
  workspaceId: string
  folderPaths: readonly string[]
  includeSubfolders?: boolean
  limit: number
}

/**
 * Which folders a page covers, in the shape {@link queryWorkspaceFiles} takes: one id, `null`
 * for the workspace root, several ids for a subtree, or `undefined` for the whole workspace.
 *
 * `unfiltered` (no `folderPath`) and a recursive filter on the root both mean the whole
 * workspace, so both drop the folder predicate. A recursive filter on a real folder names
 * every folder in its subtree, which the query takes as one `IN (...)` over the index already
 * loaded for the path lookup — no second read, and no recursive CTE.
 */
function resolveFolderScope(
  folderIndex: Awaited<ReturnType<typeof loadActiveFolderPathIndex>>,
  folderFilter: ReturnType<typeof resolveFolderPathFilter>,
  recursive: boolean | undefined
): string | null | string[] | undefined {
  if (folderFilter.kind !== 'folder') return undefined
  if (!recursive) return folderFilter.folderId
  if (folderFilter.folderId === null) return undefined
  const childrenByParent = indexFolderChildren(folderIndex.rowById.values())
  return [
    folderFilter.folderId,
    ...collectDescendantFolderIdsFrom(childrenByParent, folderFilter.folderId),
  ]
}

async function resolveListWorkspaceFileContext(workspaceId: string) {
  const workspace = await loadActiveWorkspaceContext(workspaceId)
  if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
  return workspace
}

export const listAllWorkspaceFiles = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.list,
  resolveContext: ({ input }: { input: ListAllWorkspaceFilesInput }) =>
    resolveListWorkspaceFileContext(input.workspaceId),
  async execute({ input, context }) {
    const files = await listWorkspaceFiles(context.workspaceId, { scope: input.scope })
    const shares = await getWorkspaceShares('file', context.workspaceId)
    return {
      files: files.map((file) => ({ ...file, share: shares.get(file.id) ?? null })),
    }
  },
})

export const queryWorkspaceFilePage = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.list,
  resolveContext: ({ input }: { input: QueryWorkspaceFilePageInput }) =>
    resolveListWorkspaceFileContext(input.workspaceId),
  async execute({ input, context }) {
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
      const folderIndex = await loadActiveFolderPathIndex(context.workspaceId, 'file', undefined, {
        maxRows: MAX_FOLDERS_PER_WORKSPACE,
      })
      const folderFilter = resolveFolderPathFilter(folderIndex, input.folderPath)
      if (folderFilter.kind === 'noMatch') return { files: [], nextKeys: null }
      folderId = resolveFolderScope(folderIndex, folderFilter, input.recursive)
    }

    const { files, nextKeys } = await queryWorkspaceFiles(context.workspaceId, {
      scope: input.scope,
      folderId,
      search: input.search,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      limit: input.limit,
      after: input.after,
    })
    return { files, nextKeys }
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
