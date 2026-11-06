import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import { admitEach, mustClassifyContent } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { listFileFolders, loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'
import { authorizeWorkspaceFileAccess } from '@/lib/workspace-files/application/authorization'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { assertOwnedFileAccess } from '@/lib/workspace-files/application/file-context'
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
     * block, the v2 route) narrows by the same rules. `!== undefined`, not a
     * length check: an explicitly empty list is a scope that names no folder,
     * which must match nothing rather than the whole workspace.
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
      const classified = mustClassifyContent(principal)
      const owner = { entityType: 'workspace' as const, entityId: context.workspaceId }
      const result = await searchFileIndex({
        owner,
        pattern: compileFileSearchPattern(input.query, input.mode),
        maxResults: input.maxResults,
        folderScope,
        signal,
      })
      if (!classified) {
        const ownedInputs = new Map(
          result.sources.flatMap((source) =>
            source.dependencies
              .filter((dependency) => dependency.context !== 'workspace')
              .map((dependency) => [dependency.fileId, dependency] as const)
          )
        )
        for (const dependency of ownedInputs.values())
          await assertOwnedFileAccess(principal, {
            ...context,
            fileId: dependency.fileId,
            fileContext: dependency.context ?? '',
          })
        return toWorkspaceFileSearchResult(result)
      }
      // One repeatable-read snapshot keeps the folder scope and file rows consistent with each other.
      // Admission runs after commit, so row or advisory locks would fence nothing.
      const delivery = await db.transaction(
        async (tx) => {
          const [current] = await tx
            .select({
              workspaceId: workspace.id,
              billedAccountUserId: workspace.billedAccountUserId,
              workspaceOrganizationId: workspace.organizationId,
              allowPersonalApiKeys: workspace.allowPersonalApiKeys,
            })
            .from(workspace)
            .where(and(eq(workspace.id, context.workspaceId), isNull(workspace.archivedAt)))
          if (!current) throw new OrchestrationError('not_found', 'Workspace not found')
          await authorizeWorkspaceFileAccess(principal, fileOperations.searchContent, current, {
            executor: tx,
          })
          const folders =
            input.folderPaths === undefined ? [] : await listFileFolders(owner, {}, tx)
          const loaded = await loadFileSearchDelivery(tx, {
            owner,
            prepared: result,
            scope: resolveFileSearchFolderScope(folders, input),
            signal,
            classify: classified,
          })
          for (const dependency of loaded.inputs)
            await assertOwnedFileAccess(principal, { ...current, ...dependency }, tx)
          return loaded
        },
        { isolationLevel: 'repeatable read' }
      )
      const inScope = result.sources.filter(
        (source) => !delivery.outOfScope.has(source.identity.fileId)
      )
      const admitted = await admitEach(principal, inScope, async (sources) =>
        sources.map((source) => ({
          kind: 'workspace-file' as const,
          id: source.identity.fileId,
          provenance: delivery.provenance.get(source.identity.fileId) ?? {
            status: 'unknown' as const,
          },
          view: 'excerpt' as const,
        }))
      )
      const admittedIds = new Set(admitted.map((source) => source.identity.fileId))
      const results = result.results
        .filter((hit) => !delivery.outOfScope.has(hit.fileId))
        .map((hit) =>
          admittedIds.has(hit.fileId)
            ? hit
            : {
                ...hit,
                text: '[Preview withheld: read or grep this file to inspect protected text.]',
              }
        )
      return toWorkspaceFileSearchResult({
        ...result,
        results,
        count: results.length,
        sources: admitted,
      })
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
