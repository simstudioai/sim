import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { lockWorkspaceProject } from '@/lib/projects/membership'
import { listFileFolders, loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'
import { authorizeWorkspaceFileAccess } from '@/lib/workspace-files/application/authorization'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { reportWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveWorkspaceFolderScope } from '@/lib/workspace-files/resolve-folder-scope'
import {
  loadFileSearchDelivery,
  resolveFileSearchFolderScope,
} from '@/lib/workspace-files/search/delivery'
import { WorkspaceFileSearchUnavailableError } from '@/lib/workspace-files/search/errors'
import {
  compileFileSearchPattern,
  type FileSearchMode,
  FileSearchPatternError,
} from '@/lib/workspace-files/search/pattern'
import {
  searchFileIndex,
  toWorkspaceFileSearchResult,
} from '@/lib/workspace-files/search/repository'

export interface SearchWorkspaceFileContentInput {
  workspaceId: string
  query: string
  mode: FileSearchMode
  maxResults: number
  /** Canonical folder paths the search is confined to. Absent searches the workspace. */
  folderPaths?: readonly string[]
  /** Whether the scope descends into nested folders. Absent means yes. */
  includeSubfolders?: boolean
  signal?: AbortSignal
}

async function resolveSearchWorkspaceFileContext(input: SearchWorkspaceFileContentInput) {
  input.signal?.throwIfAborted()
  const workspace = await loadActiveWorkspaceContext(input.workspaceId)
  input.signal?.throwIfAborted()
  if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
  return workspace
}

export const searchWorkspaceFileContent = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.searchContent,
  resolveContext: ({ input }: { input: SearchWorkspaceFileContentInput }) =>
    resolveSearchWorkspaceFileContext(input),
  execute: async ({ principal, input, context, request }) => {
    const signal = input.signal ?? request?.signal
    signal?.throwIfAborted()
    /**
     * Resolved here rather than at the surface so every caller (the File
     * block, the v2 route) is confined by the same check. A folder tree
     * holding one subtree per user makes this scope the isolation boundary,
     * not a convenience filter.
     */
    /**
     * `!== undefined`, not a length check: an explicitly empty list is a scope
     * that names no folder, which must match nothing. Treating it as "absent"
     * would answer a request for nothing with the whole workspace.
     */
    const folderScope =
      input.folderPaths !== undefined
        ? await resolveWorkspaceFolderScope({
            principal,
            workspaceId: context.workspaceId,
            folderPaths: input.folderPaths,
            includeSubfolders: input.includeSubfolders,
          })
        : undefined
    signal?.throwIfAborted()

    try {
      const owner = { entityType: 'workspace' as const, entityId: context.workspaceId }
      const result = await searchFileIndex({
        owner,
        pattern: compileFileSearchPattern(input.query, input.mode),
        maxResults: input.maxResults,
        folderScope,
        signal,
      })
      const provenance = await db.transaction(async (tx) => {
        await lockWorkspaceProject(tx, context.workspaceId)
        const [current] = await tx
          .select({
            workspaceId: workspace.id,
            workspaceOrganizationId: workspace.organizationId,
            allowPersonalApiKeys: workspace.allowPersonalApiKeys,
          })
          .from(workspace)
          .where(and(eq(workspace.id, context.workspaceId), isNull(workspace.archivedAt)))
          .for('share')
        if (!current) throw new OrchestrationError('not_found', 'Workspace not found')
        if (current.workspaceOrganizationId)
          await acquirePermissionGroupOrgLock(tx, current.workspaceOrganizationId)
        await authorizeWorkspaceFileAccess(principal, fileOperations.searchContent, current, {
          executor: tx,
          forUpdate: true,
        })
        const folders = input.folderPaths === undefined ? [] : await listFileFolders(owner, {}, tx)
        return loadFileSearchDelivery(tx, {
          owner,
          prepared: result,
          scope: resolveFileSearchFolderScope(folders, input),
          signal,
        })
      })
      await reportWorkspaceFileDelivery(provenance)
      return toWorkspaceFileSearchResult(result)
    } catch (error) {
      /**
       * A rejected or too-expensive pattern is the caller's to fix, and the
       * message names the construct and the supported alternative — so it is
       * classified rather than left to become the surface's generic failure text.
       */
      if (error instanceof FileSearchPatternError) {
        throw new OrchestrationError('validation', error.message)
      }
      /** Nothing is wrong with the query, so the caller is told to retry, not to rewrite it. */
      if (['55P03', '25P04'].includes(getPostgresErrorCode(error) ?? '')) {
        throw new OrchestrationError(
          'locked',
          'File search is briefly unavailable. Try again shortly.'
        )
      }
      if (error instanceof WorkspaceFileSearchUnavailableError) {
        throw new OrchestrationError('locked', error.message)
      }
      throw error
    }
  },
})
