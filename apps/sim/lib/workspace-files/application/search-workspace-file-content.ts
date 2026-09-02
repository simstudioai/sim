import { OrchestrationError } from '@/lib/core/orchestration/types'
import { loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  compileFileSearchPattern,
  type FileSearchMode,
  FileSearchPatternError,
} from '@/lib/workspace-files/search/pattern'
import {
  searchWorkspaceFileIndex,
  WorkspaceFileSearchUnavailableError,
} from '@/lib/workspace-files/search/repository'

export interface SearchWorkspaceFileContentInput {
  workspaceId: string
  query: string
  mode: FileSearchMode
  maxResults: number
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
  execute: async ({ input, context }) => {
    try {
      return await searchWorkspaceFileIndex({
        workspaceId: context.workspaceId,
        pattern: compileFileSearchPattern(input.query, input.mode),
        maxResults: input.maxResults,
        signal: input.signal,
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
      if (error instanceof WorkspaceFileSearchUnavailableError) {
        throw new OrchestrationError('locked', error.message)
      }
      throw error
    }
  },
})
