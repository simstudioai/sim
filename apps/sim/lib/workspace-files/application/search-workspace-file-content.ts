import { OrchestrationError } from '@/lib/core/orchestration/types'
import { loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { searchWorkspaceFileIndex } from '@/lib/workspace-files/search/repository'
import { isFileSearchCaseSensitive } from '@/lib/workspace-files/search/text'

export interface SearchWorkspaceFileContentInput {
  workspaceId: string
  query: string
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
  execute: ({ input, context }) =>
    searchWorkspaceFileIndex({
      workspaceId: context.workspaceId,
      query: input.query,
      maxResults: input.maxResults,
      caseSensitive: isFileSearchCaseSensitive(input.query),
      signal: input.signal,
    }),
})
