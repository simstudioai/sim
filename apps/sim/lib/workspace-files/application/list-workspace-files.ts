import type { CursorKey } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex, resolveFolderPathFilter } from '@/lib/folders/queries'
import type { FolderIdScope } from '@/lib/folders/scope'
import { resolveFolderScope } from '@/lib/folders/subtree'
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
  /** Pre-resolved folder ids for trusted in-process callers that already loaded the tree. */
  folderScope?: FolderIdScope
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
    if (input.folderPath !== undefined && input.folderScope !== undefined) {
      throw new OrchestrationError(
        'validation',
        'Specify either folderPath or folderScope, not both'
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
      folderScope: input.folderScope,
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
